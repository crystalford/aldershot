# What the owner needs to do

Everything below is a one-time action outside the codebase. The app works
without any of it — degraded in named ways, never pretending otherwise.

## 1. The domain

You said `aldershot.io`. Once it's registered and its nameservers point at
Cloudflare:

1. Workers & Pages → `aldershot` → Settings → Domains & Routes → add
   `aldershot.io` and `www.aldershot.io`.
2. Nothing to set. `APP_ORIGIN` = `https://aldershot.io` is committed in
   `wrangler.jsonc`'s `vars` — it is a public URL, it appears in every login
   email, and it used to be a repo secret you had to remember. **Do not also
   add it as a secret**: the deploy writes secrets *after* `wrangler deploy`,
   so one of that name would land on top of the committed value and nothing
   detects two sources for one name. Change it in `wrangler.jsonc` if the
   domain ever changes.

## 2. Sign in with Google — the fastest way to unblock yourself

**This needs no domain and no DNS, so you can do it right now.**

1. console.cloud.google.com → new project (or any existing one).
2. APIs & Services → OAuth consent screen → External. You only need an app
   name, a support email, and a developer email. Scopes: leave empty — we
   request `openid email` at request time and nothing else.
3. Credentials → Create credentials → OAuth client ID → Web application.
4. Authorised redirect URIs — add both:
   - `https://aldershot.attenuate.workers.dev/auth/google/callback`
   - `https://aldershot.io/auth/google/callback` (add once the domain is live)
5. Add the client ID and secret as repo secrets `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET`.

While the consent screen is in "Testing" mode, only accounts you add as test
users can sign in — which is fine, and is arguably what you want before
launch. Publishing it is a click when you're ready.

## 3. Email — the fallback, and the only path for people without Google

Auth is a one-time link sent by email. With no provider configured nothing
is sent, and the page says exactly that rather than claiming otherwise.

You can skip this entirely at first if you set up Google above — but you
will want it eventually, because not everyone has or wants to use a Google
account.

This uses **Cloudflare's own email service** — no third-party account, no
extra key, no second bill. 3,000 messages a month are included on the Workers
Paid plan the containers already need, then $0.35 per thousand.

1. Cloudflare dashboard → **Email** → onboard your domain as a **sending
   domain**. This is the DNS part, and it's why the domain has to come first.
2. Add the SPF/DKIM records it gives you.
3. Add a repo secret `MAIL_FROM` with the address links come from, e.g.
   `hello@yourdomain`. It has to be on the onboarded domain.

Until a sending domain is onboarded the binding can only reach addresses you
have personally verified — fine for alerts to yourself, useless for logging a
customer in. The `send_email` binding is already in `wrangler.jsonc`.

## 4. Cloudflare Queues — required for files over ~30 minutes

Long work currently runs in `waitUntil`, which is bounded by the request's
own lifetime. It's fine for short sources and will be killed partway through
a long one, leaving the job stuck on "running".

```
npx wrangler queues create aldershot-jobs
```

Then uncomment the `queues` block in `wrangler.jsonc` and deploy. No code
changes — `src/queue.ts` already falls back when the binding is absent.

**This is the one that matters for your 6–10 hour files.** The chunking to
handle them is built and tested; the lifetime to run it in is not there
until the queue exists.

## 5. Vectorize — meaning search and automatic threads

**Done, 17 October 2026.** The index `aldershot-clips` exists, its `user_id`
metadata index exists, and the binding is live in `wrangler.jsonc`. Nothing
below needs doing again; it is kept because the ORDER is the part that cannot
be recovered from, and anyone adding a second filterable property has to
follow it too.

The one thing the original instructions got wrong: `create-metadata-index`
returns "successfully enqueued", not "created". It took about 45 seconds to
appear in `wrangler vectorize list-metadata-index`, and nothing may write a
vector until it does.

**Run them in this order** — the order is not a style preference, see the
warning below:

```
npx wrangler vectorize create aldershot-clips --dimensions=1024 --metric=cosine
npx wrangler vectorize create-metadata-index aldershot-clips --propertyName=user_id --type=string
```

Then uncomment the `vectorize` block in `wrangler.jsonc` and deploy.

The first command needs an API token with **Vectorize: Edit**. The token used
here is `aldershot-claude-code-env`; the permission was added on 17 Oct 2026.

### The metadata index has to exist before the first vector

`searchMeaning` filters every query by `user_id`, and Vectorize **cannot
filter on vectors that were written before the metadata index for that
property existed**. It does not error — it simply does not match them. So a
deploy in the wrong order gives you an index full of vectors, a search that
runs cleanly, and no results, with nothing anywhere saying why. Recovering
means re-writing every vector.

Create the index, create the metadata index, *then* uncomment the binding.
That is why the binding is commented out rather than merely absent.

### Filling it

Nothing has to be re-scored. `backfillClipIndex` in `src/embeddings.ts` runs
from the hourly sweep, takes the oldest 200 clips that have no `embedded_at`
yet, and works forward through the library — so a few thousand clips are
indexed within a few hours of the binding going live, and a clip made after
that is searchable within the hour. `reapClipIndex` drops vectors for clips
you have binned, from the same sweep.

### Checking it actually works

```
npx wrangler dev --local --port 8787   # needs DEV_LOGIN_EMAIL in .dev.vars
npm run eval                        # and: npm run eval -- --exact
```

`scripts/eval-retrieval.ts` queries your own library with each kept clip's
`why` and reports recall@k — how often a clip comes back when you describe
it. `--exact` runs the same labels through the old word search, which is the
baseline meaning search has to beat to be worth paying for. Read the header
of that file before trusting a number out of it.

Until all of this happens Footage's search falls back to exact word matching
and says so on screen; Threads stays empty rather than inventing groupings.

## 6. Anthropic — optional, better reasoning

Workers AI is the default for every role and the product is complete without
this. Add `ANTHROPIC_API_KEY` as a repo secret and the roles marked
`preferAnthropic` in `src/models.ts` route to Claude instead. See
`docs/decisions/models.md`.

## 7. Containers — required for rendering

Rendering runs ffmpeg in a Container, which needs the account on Workers
Paid with Containers enabled. Without it, everything up to the render works
and the render itself fails.

---

## Secrets summary

Repo secrets (Settings → Secrets and variables → Actions):

| Secret | Needed for | Without it |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | any deploy | nothing deploys |
| `CLOUDFLARE_ACCOUNT_ID` | any deploy | nothing deploys |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | direct-to-R2 uploads | uploads go through the Worker |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google sign-in | the button is hidden; email link only |
| `MAIL_FROM` (+ an onboarded sending domain) | email sign-in | nothing is sent, and the page says so |
| `ANTHROPIC_API_KEY` | optional upgrade | everything stays on Workers AI |

`SESSION_SECRET` is generated by the deploy on first run and then left
alone — rotating it signs everyone out.

## One thing to know about the deploy

`DEV_LOGIN_EMAIL` disables authentication entirely: any unauthenticated
request is treated as that account. It lives in `.dev.vars`, which
`wrangler dev` reads and `wrangler deploy` never uploads, and the deploy
workflow hard-fails if it ever appears as a real var in `wrangler.jsonc`.

If you clone this repo fresh, `.dev.vars` won't be there (it's gitignored),
and local `wrangler dev` will show you the signed-out landing page. Create
it with two lines to get the app back:

```
DEV_LOGIN_EMAIL="you@example.com"
OWNER_EMAIL="you@example.com"
```

**Both lines, and the same address in each.** `DEV_LOGIN_EMAIL` is who you
are signed in as; `OWNER_EMAIL` is which address the product treats as the
owner, and the owner-only surfaces — the cost panel, `/api/preflight`, the
receipts admin page — answer 404 to anybody else. With only the first line
the app loads and those three pages are simply not there, which looks like a
routing bug and isn't one.

`OWNER_EMAIL` was a string literal in `src/user.ts` until 15 Nov 2026. It
became a secret when this repository went public: a hardcoded personal
address is harmless among collaborators and is an address harvester's
breakfast on a public repo. In production it is a Cloudflare secret, and
until it is set **no account is the owner** — the product works, there is no
cost panel, and setting it later promotes the account on the next page load.
The deploy readout says `OFF The owner's account — needs OWNER_EMAIL` while
it is missing.

---

## How uploads work now

Bytes go **straight from the browser to R2**. The Worker issues short-lived
presigned URLs — its job is to say who may write where, not to carry the
file — so a multi-gigabyte upload never streams through it.

Verified in production: a 25MB file uploaded direct to
`…r2.cloudflarestorage.com`, and the stored object's SHA-256 matched the
original exactly.

It survives things going wrong:

- **Navigating** — the upload runs in a service worker, so browsing the app
  does not cancel it.
- **The worker being killed** — Safari does this aggressively. The page
  notices progress has stopped and hands the job back.
- **Closing the browser entirely** — the server records each part as it
  lands, so a later session is offered *"…stopped at 41% — Finish it"*. You
  re-pick the file (a browser cannot hold one across sessions) and it sends
  only what is missing. The file is checked by name and size first.

If the R2 API credentials are ever missing, uploads fall back to going
through the Worker automatically. Slower, but nothing breaks.

Parts are sized to the file — about 100 of them, between 8MB and 64MB. A
2.14GB upload is 64 parts rather than 268.
