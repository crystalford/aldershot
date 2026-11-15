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

- **Hybrid retrieval, both halves.** `src/embeddings.ts` writes the clip
  library into Vectorize from the hourly sweep, resumable and library-wide;
  the index, its `user_id` metadata index and the binding all exist as of
  17 Oct 2026. `findMaterial` runs meaning and word search as peers and fuses
  them by reciprocal rank, rather than treating words as a fallback.
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

## Where the build order stands

Every phase of `docs/handoff/11-BUILD-ORDER.md` is built. What remains needs
something this repo cannot supply itself:

- **Phase 0's labelled set** — ~200 claims over ~10 of the owner's own videos,
  with two labellers. The runner, the four numbers and the labelling surface
  all exist; the set is footage and judgement, not code. `npm run eval:set`
  prints the acceptance the moment it exists, which is also Phase 4's
  remaining acceptance.
- **An export opened in Resolve.** `npm run check:otio` proves the file parses
  and carries its credits and ghosts; opening it in Resolve itself needs
  Resolve.
- **The render container, run once.** The ENCODER is now proved on every push:
  `check:render` builds a source of twenty-four one-second colours, makes
  known edits through the real API, renders, and reads the colours back out of
  the finished file, so "second 7 was struck" is checked as "that colour is
  absent". `check:frame` proves the 9:16 reframe and `check:otio` reads the
  export back with the real OpenTimelineIO. All three are in CI (7 Nov).
  **None of them ever needed docker**, which was not understood for most of
  this project's life: `scripts/check-render.cjs` says in its own header that
  it wants ffmpeg, a dev server and `container/render.mjs` run as a plain node
  process, and every status report until now folded that into "no docker
  daemon, so the render is unverified". Docker is how the encoder is shipped,
  not how it is tested.
  What genuinely needed a daemon is the IMAGE, and a separate CI job builds it
  now, runs it, and asserts from outside the build that both approved faces
  are in it. That closes `librsvg2-bin` and the woff2→TTF conversion.
  **And `check:align` has now run too** (7 Nov), which was the last check in
  this repo that had never executed anywhere:

      align: ready — 29 tokens, 16000 Hz
      ✔ align — 9 words placed inside the hand reading, window offsets
        honoured, stereo mixed down

  The real MMS_FA model through `container/align.py` and
  `container/align.mjs`, against the torchaudio tutorial clip with a reading
  taken by hand. Its own header says how, and it works verbatim:

      python3 -m venv /tmp/align-venv
      /tmp/align-venv/bin/pip install --upgrade pip
      /tmp/align-venv/bin/pip install --index-url \
          https://download.pytorch.org/whl/cpu torch torchaudio
      /tmp/align-venv/bin/pip install numpy soundfile
      curl -fsSLO https://download.pytorch.org/torchaudio/tutorial-assets/\
          Lab41-SRI-VOiCES-src-sp0307-ch127535-sg0042.wav
      ALIGN_PYTHON=/tmp/align-venv/bin/python ALIGN_WAV=./Lab41-...wav \
          npm run check:align

  `--upgrade pip` is the one addition, and it is the same trap the Dockerfile
  hit: an older pip resolves a torch dependency to a source distribution and
  then cannot find a build backend on the CPU-only index.

  It stays out of `npm run check` on purpose — a gate that needs a 1.26 GB
  model is a gate people learn to skip — and out of CI for now, because the
  container job downloads that model anyway as part of the image. Running it
  inside the built image is the tidy version and wants a daemon to try.

Everything else in `12-DEFERRED.md` is deliberate and post-launch.

## The checks that cost money or need a tool

`npm run check` is the gate and runs on every commit. Four more exist because
they need something the gate cannot assume, and each says so rather than
passing quietly when its tool is missing:

| | what it measures | needs |
|---|---|---|
| `npm run check:duck` | the bed is down where the words are, and stays down across a short gap | ffmpeg |
| `npm run check:loudness` | three mixes land within ±1 LU of target | ffmpeg |
| `npm run check:graphics` | a generated picture carries its words in five fonts | Chromium |
| `npm run eval:model` | the judge against `eval/adversarial.jsonl` | a dev server, and it spends money |

A gate rule that silently passes when its dependency is absent is the failure
this repo keeps catching, which is why these are separate commands rather than
skipped steps.

## Why the fidelity checks exist

A previous build of this product passed every feature test and still shipped a
recognisably different product — an icon library instead of the design's SVGs,
rounded font sizes, a near-miss grey, rewritten button copy. Each substitution
was defensible; together they changed the feel.

**Substitution is the failure mode, not omission.** A missing feature is
obvious in review; a swapped icon set is invisible. So:

```bash
npx wrangler dev --local --port 8787 --enable-containers=false   # in one shell
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
