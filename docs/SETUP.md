# What the owner needs to do

Everything below is a one-time action outside the codebase. The app works
without any of it — degraded in named ways, never pretending otherwise.

## 1. The domain

You said `aldershot.io`. Once it's registered and its nameservers point at
Cloudflare:

1. Workers & Pages → `aldershot` → Settings → Domains & Routes → add
   `aldershot.io` and `www.aldershot.io`.
2. Add a repo secret `APP_ORIGIN` = `https://aldershot.io`. Login links are
   built from it, so without it they point at whatever host served the
   request — which breaks the moment there's a proxy or a preview deploy in
   front.

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

Blocked on a permission, not on code:

```
npx wrangler vectorize create aldershot-clips --dimensions=1024 --metric=cosine
```

needs an API token with **Vectorize: Edit**. The token in
`CLOUDFLARE_API_TOKEN` doesn't have it. Add that permission, run the
command, then uncomment the `vectorize` block in `wrangler.jsonc`.

Until then Footage's search falls back to exact word matching and says so on
screen; Threads stays empty rather than inventing groupings.

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
| `APP_ORIGIN` | correct login links | links use the request's host |
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
it with one line to get the app back:

```
echo 'DEV_LOGIN_EMAIL="chrisrobtelford@gmail.com"' > .dev.vars
```

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
