# Aldershot — CLAUDE.md

Keep it short; the detail lives in `docs/handoff/` and the research in `docs/labs/`.

## What this is

Aldershot is a hands-off video editor: attach footage (yours or other people's), say what you want in a sentence, get a finished cut built from rules you can see and switch off, with a receipt for every claim. One room with two states — no project and a project — plus Settings. The timeline is the engine room, not the interface.

## Read first

- `docs/handoff/00-START-HERE.md` — the package index and the ten invariants
- `docs/handoff/11-BUILD-ORDER.md` — what to build now and how it's accepted
- `docs/handoff/14-GLOSSARY.md` — the words to use
- `design/one-take/Aldershot One Take.dc.html` is the behavioural spec; `design/one-take/footage.js` is the reference rule engine. Port it, don't reinvent it.
- Before touching Scout: `docs/handoff/18-SCOUT-BUILD-SPEC.md` (the build
  spec), then `docs/labs/SCOUT.md`, `SOURCES.md`, `DOSSIER.md` for the
  evidence. Doc 07 is the product summary only — reading it and building from
  it is the mistake this line exists to prevent.
- `docs/research/raw/` is the original research, unedited. The handoff wins
  where they disagree; the raw is there for when the handoff is silent.
- `docs/research/PASS-4-BRIEF.md` — what the research still does not answer.
  Two halves. **Selection:** `FORMATS.md` specifies the Pattern spine
  ("variation escalates; one closing instance reframes") and nothing computes
  it, so a library of a thousand clips about one subject has no mechanism for
  choosing eight of them in an order. **Composition:** the block level is
  specified (`04-RULE-ENGINE.md`'s visual job per beat, the director layer in
  `labs/Essay to video.dc.html`) and there is no object for *a video that could
  be made* — so nothing ranks angles, nothing lets a Scout find change the
  plan's mind, and nothing prices an angle that leans on ghosts.
- `docs/handoff/16-STATE-OF-PLAY.md` is a **photograph of 14 Oct 2026**, not a
  status. It lists as missing roughly twenty things that now exist, and says so
  at the top. For what is true now: `npm run check`, then the README's "Where
  the repo is ahead of the handoff", then `12-DEFERRED.md`.

## When the documents disagree

They do. The handoff and the Manual were written at different points and the
owner has said so plainly. The order of precedence, highest first:

1. **The rendered prototype.** Not the file read as text — the thing open in a
   browser. `node scripts/shoot.cjs proto Home` renders it; put it beside the
   build and look. Everything below is a description of it.
2. **`design/one-take/Aldershot Manual.dc.html`** — how the product explains
   itself to a person. Where it and the handoff differ about what the product
   IS, the Manual is the later word and the one a user would read.
3. **`docs/handoff/`** — how to build it. Authoritative on sequencing,
   acceptance and infrastructure, which the Manual says nothing about.
4. **`docs/labs/`** — the research the design rests on. Explains WHY, and
   loses to all three about what.

WHY THIS IS WRITTEN DOWN. A night was spent building the room from the handoff
documents and from grepping the prototype for strings, without once rendering
it. The words came out right and the product came out wrong — the title row
was missing, the tabs were in the centre instead of the bar, the archive
summary was a count where a paragraph goes. `scripts/shoot.cjs` existed the
whole time, pointed at the retired prototype, with a header explaining this
exact failure.

The Manual also carries two things the handoff does not weight the same way:
the conversation answering questions about your footage with timed lines, and
Scout as central rather than a later phase ("Scout is how the video gets
better than your footage alone"). Neither is built. Both are in the second
paragraph of what the product is.

## Invariants (never break these)

1. Rules are the source of truth; a cut is re-produced from rules + moments, never stored as an outcome.
2. The model never outputs a timestamp. It directs; a deterministic solver places. Validate and measure every edit before showing it; never trust the model's claim of success.
3. Reasons, not scores. No percentage reaches a user. Strong / Worth a look / Long shot, with the line that caused it.
4. Every claim keeps its receipt; "nothing backs this" must be a reachable answer.
5. Footage is read and charged once; editing is free.
6. Nothing is deleted; rules switch off; cut moments wait 30 days.
7. A job is complete only when every item is terminal and none failed silently. Silent partial failure is a P1.
8. Pictures: own footage → user's documents → open world → generated. Generated is never photoreal and never over a claim or its proof. Graphics are code, never pixels.
9. Scout finds and links; nothing in this codebase downloads audiovisual content from platforms that forbid it.
10. The genre word never reaches the writer; the user's own words win where they exist.

## Conventions

- Deterministic first: if it can be a regex, a lint or a measurement, it is not a model call.
- Every model call sits behind a typed capability contract (`Transcribe`, `Locate`, `Judge`, `Direct`, …), is tagged with its model version, and is gated by the eval set before a model swap.
- Closed schemas for anything a model returns; an output that doesn't fit fails visibly.
- Timestamps derive from word ids. Moments are word-id spans.
- One footage set, one engine: everything in the room calls the same `compute()`.
- Copy is sentences someone would say; see `15-DESIGN-LANGUAGE.md`. Use the glossary's words in code and commits (moment, block, beat, rule, ghost, mission, receipt).
- UI follows the prototype; new UI follows `15-DESIGN-LANGUAGE.md`. Inline styles and the two fonts; gold means the system.
- Simplest thing that passes the phase's acceptance tests. No speculative abstractions.

## Commands

- `npx wrangler dev --local --port 8787 --enable-containers=false` — run the app locally.
  **`--local` is load-bearing.** Without it wrangler opens a remote proxy
  session to serve `env.AI`, which needs a Cloudflare login — so the server
  starts on a machine that has one and hangs for three minutes on a machine
  that does not. CI found this; no local run ever could.
  Needs `DEV_LOGIN_EMAIL=you@example.com` in `.dev.vars` or every page is a 302.
- `npm test` — unit and engine tests. The `footage.js` port must reproduce the
  sample cut (8 of 14 moments, 5:59, 4 to-camera gaps) when it lands.
- `npm run check` — **the gate.** Typecheck, tests, container, editor, then the
  ten fidelity checks. Nothing merges red.
- `npm run schema` — rewrites `migrations/schema.sql` from the CREATE
  statements in `src/`. The numbered migrations are hand-written history and
  were never run by anything; this one file is the current shape, and `check`
  fails if it has fallen behind.
- `npm run eval` — retrieval recall@k over your own library, with
  `-- --exact` as the keyword baseline. Not yet the Phase 0 labelled set.
- `npm run labels` — what decisions exist in the database, and whether the top
  score band breaks the scoring prompt's own first two rules.

## Two rules about this codebase specifically

**`src/ui/client.ts` is one `String.raw` template.** A single backtick anywhere
in it — including inside a comment — ends the literal and breaks the whole
client. The `template` fidelity check exists because that has happened. It is
also not typechecked, so nothing else will catch it.

**Every new check is deliberately broken before it is trusted.** A test that
passes because it asserts nothing is worse than no test, and three have been
caught in this repo doing exactly that. Break each guarantee, confirm the
failure, restore. If a break does not fail the test, the test was not pinning
its claim — fix the test, not the breakage.

## Repo etiquette

- Branch per phase and feature: `phase-2/rule-effects`. Rebase on main before a PR.
- A PR that breaks an invariant is wrong even if it works.
- When a decision in `13-DECISIONS.md` seems wrong, write the counter-argument in the PR and change the doc in the same PR — don't route around it.

## Things that bite

- The model will propose timeline edits if you let it. Only accept rule objects and directives.
- Vector-only retrieval re-scored with BM25 is not hybrid; retrieve both independently and fuse by rank.
- Running speech recognition on enhanced audio makes it worse; enhance only the final mix.
- SDK retries × gateway retries × workflow retries multiply; SDK retries off.
- Queues drop messages on retry exhaustion unless a dead-letter queue exists.
  There is one now (`aldershot-jobs-dlq`), the gate fails if a consumer lacks
  one, and a DLQ is exempt from the rule because a DLQ with a DLQ is turtles.
- Most job handlers catch their own errors and write their own failure, so they
  never reach the guards in `consume`. Only `proxy`, `transcribe` and
  `short-render` throw straight out — those are the ones a test of that path
  has to use.
- A fidelity rule whose haystack includes the file it is checking is a rule
  that matches its own declarations. `reachable`'s route check did exactly
  that and never fired once; `test/gate-reachable.test.ts` pins the fix.
- YouTube: 100 `search.list` calls a day per project; store nothing audiovisual; refresh metadata every 30 days.
