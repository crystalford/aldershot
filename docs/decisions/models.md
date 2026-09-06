# Model choices, and why

Verified against the Cloudflare Workers AI catalog, August 2026. Every claim
here was read off a model's own documented schema, not inferred.

## Policy: a working default, an opt-in upgrade

Every AI role has a Workers AI default that works with no extra configuration
and bills on the one Cloudflare invoice. Where a materially better option
exists, it is offered as an explicit upgrade the user chooses — never a silent
substitution, because the cost differences are large.

| Role | Default | Upgrade | Upgrade costs |
|---|---|---|---|
| Reasoning | `@cf/zai-org/glm-5.3-flash` | Claude Sonnet (Anthropic) | needs `ANTHROPIC_API_KEY` |
| Transcription | `@cf/openai/whisper-large-v3-turbo` | `@cf/deepgram/nova-3` | ~10x — $0.47 vs $0.046 per 90 min |
| Embeddings | `@cf/baai/bge-large-en-v1.5` | — | — |

## The urgent finding: our previous model could not do the job

`@cf/meta/llama-3.3-70b-instruct-fp8-fast`, used for every text role in the v1
build, **has a 24,000-token context window on Workers AI** — not the 128k the
base model advertises. Cloudflare serves it truncated.

The score pass feeds a whole 90-minute transcript: ~120k tokens in, ~20k out.
That is 5x over. Any v1 call that passed a long transcript was being silently
truncated, which would show up as the model "missing" material that was never
sent to it. This is the single most important thing the model audit turned up.

## Reasoning — `@cf/zai-org/glm-5.3-flash`

1,048,576-token window, native, supports `response_format: json_schema`,
~$0.028 for a 120k-in/20k-out run. Requires a paid billing method on the
account (as do all frontier-tier models); we are already on Workers Paid.

Cheaper alternative worth A/B testing once there is real output to judge:
`@cf/google/gemma-4-26b-a4b-it` — 256k window, json_schema, ~$0.018/run.

**Watch the window arithmetic.** 120k in + 20k out = 140k *total*, which rules
out otherwise-attractive 131k models (`glm-4.7-flash`, `llama-4-scout`). Check
the sum, not the input.

**JSON mode is not guaranteed.** Cloudflare's own docs warn the model may not
respect the schema — it is not constrained decoding. Keep the parse-and-repair
retry that `04-API-AND-JOBS.md` §Failure rules already requires. JSON mode also
does not support streaming.

Note: Cloudflare's "JSON Mode" doc page lists only a handful of old models and
is stale. `response_format` was confirmed per-model from each input schema.

## Transcription — Whisper by default, Nova-3 for speakers

**Good news:** `whisper-large-v3-turbo` does return word-level timestamps
(`segments[].words[] {word,start,end}`). The design's Script mode — where
deleting a word deletes video — depends on this, and it works out of the box.
No input flag is needed; the words array is simply part of the response.

**It cannot do diarization.** `@cf/deepgram/nova-3` is the only catalog model
that can. Two caveats before Phase 5 relies on it:
- It is a partner pass-through (Deepgram's infrastructure and ToS), not
  Cloudflare-hosted.
- Its `diarize` input param is documented, but the documented *output* schema
  does not list a `speaker` field. Deepgram's own API returns one, so this
  reads as a docs gap — but it is unverified. Confirm empirically, and degrade
  to un-diarized segments rather than inventing speaker labels.

**The open problem is length, not timestamps.** No page states a maximum audio
duration, but Cloudflare's own tutorial says to chunk at ~1MB, and each chunk's
timestamps restart at zero. For a 45–180 minute source that is 100+ round-trips
plus offset bookkeeping, and byte-slicing compressed audio splits mid-frame and
mid-word. A container running faster-whisper/WhisperX handles the whole file in
one process with globally-correct timestamps and real diarization. See
`docs/decisions/transcription.md` — decision pending a real measurement in
Phase 1.

## Embeddings — `@cf/baai/bge-large-en-v1.5`

The only Workers AI model that documents **1024-dim** output, which is what the
design's Vectorize index is specified at (`clips-1024`, 03-DATA-MODEL.md). A
Vectorize index's dimension count **cannot be changed after creation**, so this
choice is load-bearing.

- Input cap is 512 tokens. Clip quotes are short enough; anything longer must
  be windowed, not truncated.
- Pooling is `mean` (the default). Embeddings made with `cls` pooling are not
  compatible with mean-pooled ones — changing it later means a full re-embed.
- Rate limit is 1,500 req/min, lower than the 3,000/min embeddings default.

`@cf/baai/bge-m3` is 17x cheaper with a 60k context and natively produces
1024-dim vectors upstream at BAAI, but Cloudflare's page does not state its
output dimensions. Worth measuring before committing an index to it.
