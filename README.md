# Aldershot

**Editing is reading now.** Drop an hour of someone else's footage, type a
sentence, get a publishable cut. No timeline, no scrubbing, no NLE.

## The spec is the prototype

`design/Aldershot.dc.html` is the product, working, as a prototype. It is
authoritative: where this repo's documentation and the prototype disagree, the
prototype wins. `design/docs/` explains how to read it — start with
`design/docs/08-HOW-TO-READ-THE-PROTOTYPE.md`, then `01-PRODUCT.md`.

Open the prototype directly in a browser; `support.js` must be a sibling.

## Why the fidelity checks exist

A previous build of this product passed every feature test and still shipped a
recognisably different product — an icon library instead of the design's SVGs,
rounded font sizes, a near-miss grey, rewritten button copy. Each substitution
was defensible; together they changed the feel.

**Substitution is the failure mode, not omission.** A missing feature is
obvious in review; a swapped icon set is invisible. So:

```bash
npx wrangler dev --port 8787 --enable-containers=false   # in one shell
node scripts/check-fidelity.cjs                          # icons, colours, strings, layout
node scripts/shoot.cjs app /                             # screenshot the build
node scripts/shoot.cjs proto Home                        # screenshot the prototype, same width
```

`check-fidelity.cjs` fails the build if an icon comes from anywhere but
`src/ui/icons.ts`, if a colour is neither a token nor in the prototype, if any
rendered string is not in the prototype verbatim, or if a page sets its own
width. `shoot.cjs` renders both sides at the same width for eyes-on comparison —
the check that actually catches drift.

Run `scripts/fetch-fixtures.sh` once first: the sandbox cannot reach Google
Fonts or unpkg, and without the local cache both sides render in a fallback
face, making every type judgement worthless.

## Layout of the code

```
src/
  index.ts        Hono routes — one real URL per surface (design/docs/10-ROUTES-AND-KEYS.md)
  schema.ts       D1 tables, lazy-created (design/docs/03-DATA-MODEL.md)
  models.ts       per-role AI model router, with the context-window constraints
  ui/
    tokens.ts     every colour, size, and radius, copied from the prototype
    icons.ts      the eight icons, verbatim. There is no icon library.
    shell.ts      nav + the 960px width law
    client.ts     the client runtime (keyboard map, composer, toasts)
    pages/        one module per surface
```

## AI models

Every role has a Workers AI default that needs no extra configuration, and an
opt-in upgrade. See `docs/decisions/models.md` — including the finding that the
previous build's text model had a 24,000-token context window and was silently
truncating every long transcript.

## Stack

Cloudflare only: Workers, D1, R2, Stream, Queues, Containers, Vectorize,
Durable Objects, Analytics Engine.

## Build order

`design/docs/06-BUILD-PLAN.md`, phase by phase, each with acceptance criteria.
Open questions for the owner are in `docs/decisions/open-questions.md`.
