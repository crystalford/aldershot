# 22 · From the canvas to the code

`design/canvas/` is the prototype as of 21 November 2026, version 73 of the
owner's canvas. It is the latest word on what the product is, which puts it at
the top of CLAUDE.md's order of precedence, above `design/next/` (doc 21) and
`design/one-take/`. Render it before reading anything about it:
`cd design && python3 -m http.server 8791`, then open
`http://localhost:8791/canvas/Start here.dc.html`. The changelog at the bottom
of that page explains entries 1 to 31 in order. `Map.dc.html` lists every
feature, where it lives in the canvas, and whether it's there.

This document is the plan for porting it: one PR per row below, each behind
`npm run check`, each stacked on the one before so it can be reviewed alone.
Where a row changes a decision or an invariant, the PR that changes the code
changes the document too (CLAUDE.md, "Repo etiquette").

## What the canvas is

Two kinds of project in one room, the **Studio**:

- **Led by a script** (the essay, `Studio.dc.html`). The whole film top to
  bottom, playable from the first minute, every empty shot a drawn sketch.
  Lenses: Film, To do, Script, Argument, Rules. A shot panel on the right.
- **Led by footage** (`Cut.dc.html`). One Take's engine (`footage.js`) on the
  same room: Cut, Words, Footage, Shorts, Rules.

Around it: Home, Library, Settings (one spending limit), the Manual, the
landing page, and **Scene by scene** (`Scenes.dc.html`), the same film one
scene at a time.

## The ports, in order

| # | What | Canvas | Code today | The PR |
|---|---|---|---|---|
| 1 | The canvas itself, this plan, and generated-video pricing | everything | `design/next/` (doc 21) | This one. Doc 10 and decision 38 get the clip-based prices. |
| 2 | **A timeline your editor opens** — Final Cut 7 XML beside the `.otio`, every clip carrying a marker with its source, label and receipt; a Resolve marker file beside it | Export → the package | `src/otio.ts`, `/api/projects/:id/timeline.otio` | A pure writer beside `otio.ts`, two routes, a link on the export page, tests, and a reader check like `check:otio`. |
| 3 | **Depictions** — a generated picture may sit over a claim, labelled "Depiction · made with AI", with the claim's receipt kept. Never as the proof. A film can be set to Strict. | Studio → Rules, "Generated pictures and the facts"; shot panel note | `src/pictures.ts` `allowed()` refuses generated on `claim` and `evidence`; the beat insert in `src/index.ts` calls it; `src/cuesheet.ts` and `src/graphics.ts` say "never over a claim" | Invariant 8 and decision 26 change with the code; `evidence` stays refused. Two things to get right: an unclassified line is `claim` (`UNSURE` in `src/classify.ts`) so that a failure refuses, and under Depict that would let a failure through, so a depiction needs a line that was actually classified as a claim; and the label has to be stored with the beat at insert, because nothing downstream knows what line a beat was placed against. The Strict switch needs somewhere to live; until the Rules lens (row 9) it can be a project setting. |
| 4 | **One spending limit** — set in Settings, read by everything that spends | Settings → Spending | `src/spend.ts` has the cap and `setCap` | Settings page and the generation path read the same number. |
| 5 | **Before it goes out** — the export check: pictures, voice, claims, other people's footage, generated pictures, captions, sound, receipts; each line a sentence with the fix that matters first | Export sheet, both kinds of project | `src/beforepost.ts`, `src/ui/pages/beforepost.ts` | Bring the lines and verdicts to the canvas's eight. |
| 6 | **Voice first** — record the whole script line by line before the pictures; each shot follows the reading and keeps its planned pause | Script → "Record the whole script"; To do; the booth | `src/take.ts` checks one take against its line | A booth over `take.ts`, and shot length from the take as a rule (the film plan already derives length from rules). |
| 7 | **Every version kept** — every take of a line and every picture a shot has had, one click from coming back | Shot panel → Versions, Takes | Nothing is deleted (invariant 6), but nothing lists what a shot used to be | An append-only history per block, read by the panel. |
| 8 | **Short generated shots** — clips of up to 8 seconds; a longer shot holds, cuts between clips, or is a moving still; priced per mode | Shot panel → Generate from it | No generated video yet | Lands with generation itself (`08-PICTURES-AND-VOICE.md`), at row 1's prices. |
| 9 | **The room** — Direct it (a sentence becomes a plan of jobs with a cost), the shot ladder (every shot starts as a sketch; four moves), To do and the day's sitting | Studio | `src/ui/pages/room.ts`, `src/film-plan.ts` (doc 21 phase 1) | Doc 21's phases, with the canvas as the picture. |
| 10 | **Scene by scene** | `Scenes.dc.html` | none | A second view of the same project. |
| 11 | **The footage-led Studio** | `Cut.dc.html` | `src/ui/pages/cut.ts`, One Take's engine | The lenses and the undoable conversation. |
| 12 | The Manual and the landing copy | `Manual.dc.html`, `Landing.dc.html` | `src/ui/pages/landing.ts` | Copy, last, when the things it describes are real. |

## What the canvas fakes

The canvas runs in a browser with no server. Everything that would be a job is
a timer: Scout's finds, Sketch's drawings, generation, the crew's replies in
the conversation. Takes measure a read's length; with a microphone they keep
the sound for the tab's lifetime only. The export package is real (the canvas
builds the zip in the browser) except the render. Prices are list prices from
the research pass (Veo 3.1 Fast and Veo 3.1, November 2026) and need checking
before launch.

## Two things that disagree on purpose

- `design/next/` still renders doc 21's prototype, and `test/film-plan.test.ts`
  pins `src/film-plan.ts` to its `film.js`. The canvas has since grown the
  sample film (21 sections, not 11). The test stays on `design/next/` until
  row 9 moves the film plan to the canvas's sample in one PR.
- The canvas's `footage.js` is One Take's with one change: its frame paths
  point one folder up, so the copy renders from `design/canvas/`.
