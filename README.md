# Aldershot

**The edit you can interrogate.** Attach footage — yours or other people's —
say what you want in a sentence, and get a finished cut built from rules you
can see and switch off, with a receipt for every claim.

## The spec is the prototype

**`design/one-take/Aldershot One Take.dc.html` is the product** — One Take,
handoff v3, 16 October 2026. It is authoritative: where this repo's
documentation and the prototype disagree, the prototype wins. `docs/handoff/`
explains how to build it — start with `docs/handoff/00-START-HERE.md`, or open
`docs/handoff/Aldershot System.dc.html` to read the whole package as a site.
`docs/labs/` holds the research the design rests on; its behaviour is spec.

Alongside it: `Aldershot Settings.dc.html` (plan, meters, BYOK, defaults),
`Aldershot Manual.dc.html`, `Landing.dc.html`, `Scout.dc.html`, and
`footage.js` — the reference rule engine, which is to be ported rather than
reinvented (`docs/handoff/04-RULE-ENGINE.md`).

Open any prototype directly in a browser; `support.js` must be a sibling, and
in `design/one-take/` it is a symlink to the one copy in `design/`.

### What is still the OLD design, and why

`design/Aldershot.dc.html` is the **retired** monolith and `docs/archive/` the
retired handoff. Neither is a specification any more. They are still here for
one reason: **the fidelity scripts check the shipped UI against the retired
prototype, and repointing them at One Take would red-line the build on day
one** — One Take is one room where the old design had Home, Footage, Projects
and a staged Editor, so almost every rendered string would fail at once.

They get repointed per surface, as each surface is rebuilt, which is the
sequencing `docs/handoff/16-STATE-OF-PLAY.md` argues for under its own risks.
Until a surface is rebuilt, its fidelity check is measuring conformance to a
superseded design — deliberately, and only to keep the gate meaningful for the
code that has not moved yet.

## Where the repo is ahead of the handoff

`docs/handoff/16-STATE-OF-PLAY.md` was written against `main` on 14 October and
is accurate for that date. Three things it lists as missing have since landed,
and the build order should start from them rather than from zero:

- **The dense half of hybrid retrieval.** `src/embeddings.ts` writes the clip
  library into Vectorize from the hourly sweep, resumable and library-wide.
  The binding is still commented out until the index and its `user_id`
  metadata index exist, in that order — see `docs/SETUP.md` §5.
- **A retrieval eval that runs today.** `npm run eval` reports recall@k over
  your own library through the real page, using kept clips as labels, with
  `--exact` as the keyword baseline to beat. It is an upper bound rather than
  a prediction, and it is not the ~200-claim labelled set
  `docs/handoff/06-FOOTAGE-SYSTEM.md` asks for — it is what measures pipeline
  variants before that set exists.
- **A scorer readout.** `npm run labels` says which decisions exist in the
  database, refuses to print an AUC on too few, and reports how often the top
  score band breaks the scoring prompt's own first two rules
  (`src/portability.ts`).

One correction to the same document: `src/essay.ts` outlines **four** acts
(Setup · Development · Turn · Resolution), not five.

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
  index.ts        Hono routes — one real URL per surface (docs/archive/handoff-v2/10-ROUTES-AND-KEYS.md)
  schema.ts       D1 tables, lazy-created (docs/archive/handoff-v2/03-DATA-MODEL.md)
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

`docs/archive/handoff-v2/06-BUILD-PLAN.md`, phase by phase, each with acceptance criteria.
Open questions for the owner are in `docs/decisions/open-questions.md`.
