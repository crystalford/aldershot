# What this costs to run, and what would burn it

Audited against the metering table in `src/usage.ts`, which carries real
Cloudflare prices, and against Cloudflare's published Containers pricing.

## The AI is not the problem

A free user who burns their entire 300-minute monthly cap costs about **$0.19**:

| | |
|---|---|
| Transcription (Whisper large-v3-turbo, 46.63 neurons/audio-min) | $0.154 |
| Embeddings (bge-large, ~60k tokens) | $0.012 |
| One scoring pass (glm-5.3-flash) | $0.011 |
| Container CPU for audio extraction | ~$0.006 |

Containers are capped at `max_instances: 5`, which bounds worst-case container
spend near **$65/month in total** regardless of user count. That cap is the
single most valuable line in `wrangler.jsonc`. It is also a throughput ceiling:
five concurrent ffmpeg jobs across all users, so uploads queue behind each
other before they cost anything alarming. Raise it deliberately, not by
accident.

Note the metering under-reports containers: `PRICES.usd_per_cpu_second` is
right for CPU, but Cloudflare also bills provisioned memory for every 10ms a
container is *running*, and `sleepAfter = "15m"` in `src/render.ts` keeps one
warm long after the work is done. Cheap, bounded by max_instances, but not
counted in the cost panel.

## Storage is the problem

Four facts that compound:

1. `checkCap` caps **processing minutes only**. Settings displays a storage
   meter against a cap that nothing enforces.
2. **Nothing is ever deleted from R2.** There is no `MEDIA.delete` anywhere;
   deletes are `deleted_at` flags in D1. The bytes stay.
3. The cap is checked at *transcribe* time, after the upload has already
   landed. It refuses the cheap thing and permits the expensive one — upload
   500 GB, be refused transcription, and the 500 GB is still billed.
4. 300 minutes of 4K footage is roughly **225 GB** — $3.38/month, recurring,
   and next month adds another 225 GB. By month six that one free account
   costs $20/month and it never comes down.

Nothing here bites at ten users. All of it grows monotonically and shows up as
a surprise invoice later.

## Fixed

**/media/\* served any object to any caller.** No session, no ownership check,
`immutable` caching, no expiry — a customer's unreleased footage protected only
by an unguessable path, permanently, to whoever ended up with the URL. That is
a privacy failure, not a cost one. It now requires a session and ownership; see
`src/media-auth.ts`.

Locking it exposed a second thing: the **render path read source video through
`/media` unauthenticated**, so it only worked because the door was open.
`src/audio.ts` had already presigned for exactly this reason; render had never
been brought in line. Both presign now.

## Also fixed

**Deleting now frees R2 bytes** — from Settings' deleted pile, via "Delete for
good". Before this, NOTHING in the product had ever removed a byte from R2, so
storage only ever grew. The soft delete still leaves the bytes alone on
purpose, because undo has to be instant; reclaiming is a second, deliberate
decision made about something already deleted. Verified against a real upload:
187,221 bytes in, 187,221 reported freed, object 404s afterwards.

It is the only irreversible action in the product, which is why it is the only
one that asks first — everywhere else a confirm dialog would be theatre in
front of something Undo already covers.

## Open

- Storage cap not enforced, and enforced after the bytes land rather than
  before.
- Nothing reclaims storage automatically. Purging is manual and per-item;
  there is no "empty the bin" and no retention policy.
- No rate limiting on signup, upload or any API route.
- `ensureV2Schema` runs its `CREATE TABLE IF NOT EXISTS` batch once per cold
  isolate. **Deliberately left alone.**

  The obvious fix is a schema-version row: read it, and skip the batch when it
  matches. That trades a few D1 reads per cold isolate — against an included
  allowance of billions of rows a month — for a mechanism that silently skips a
  migration the day somebody adds a table and forgets to bump the number. This
  codebase creates its schema lazily *by design*, with no migration runner, so
  that check is the only thing standing between a deploy and a missing column.
  The saving is not worth a way to lose it.
