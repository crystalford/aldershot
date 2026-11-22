# Aldershot — the handoff

**One Take — handoff v3 · 16 October 2026.** (v2 was *Rough Cut*.) This package replaces every earlier handoff. Version names follow the edit: *Rough Cut* (v2) → *One Take* (this handoff) → *Fine Cut* (the first working build on real footage) → *Picture Lock* (feature-complete) → *Answer Print* (launch). If a document anywhere else disagrees with this folder, this folder wins. The retired versions are in `archive/` and must not be read as specification.

Open `handoff/Aldershot System.dc.html` to read this package as a site.

## What Aldershot is, in three sentences

Aldershot is a hands-off video editor for people who make videos out of footage — their own, other people's, or both. You attach footage and say what you want in a sentence; it reads the footage once into an archive of *moments*, builds the video from *rules* you can see and switch off, and hands you a finished cut with a receipt for every claim. The timeline exists underneath, but the product is the conversation, the canvas, and the rules.

## How to read this package

| # | File | What it settles |
|---|---|---|
| 01 | `01-PRODUCT.md` | What the product is now, the surfaces, the principles, what's deliberately left out |
| 02 | `02-SCREENS.md` | Every screen and state, mapped to the prototype files; what the prototype fakes |
| 03 | `03-DATA-MODEL.md` | Moments, provenance, rules, projects, the evidence ledger, jobs and items |
| 04 | `04-RULE-ENGINE.md` | Rules as policies; `footage.js` as the reference engine; the directive/solver split |
| 05 | `05-PIPELINE.md` | Brief → sized → claim → beats → found → plan → first cut; the Read; feelings as rules |
| 06 | `06-FOOTAGE-SYSTEM.md` | Reading footage into moments; retrieval; the judge; the eval set |
| 07 | `07-SCOUT.md` | Looking outside: Scout, missions, ghosts, acquisition, attribution |
| 08 | `08-PICTURES-AND-VOICE.md` | What goes on screen and why; graphics as code; voice beats and recording |
| 09 | `09-EXPORT-AND-INTEGRITY.md` | Before you post, labels, cue sheet, dispute file, react rules |
| 10 | `10-OPERATIONS-AND-PRICING.md` | Jobs that never silently fail; speed tiers; BYOK; meters and plans |
| 11 | `11-BUILD-ORDER.md` | Phases with acceptance tests — the eval set first |
| 12 | `12-DEFERRED.md` | Decided and parked: integrations, companion app, standing queries, voice profile |
| 13 | `13-DECISIONS.md` | The decisions that shaped the product, with the reasoning |
| 14 | `14-GLOSSARY.md` | The vocabulary — use these words in code, copy and commits |
| 15 | `15-DESIGN-LANGUAGE.md` | The visual system the prototype uses; build UI to it |
| 16 | `16-STATE-OF-PLAY.md` | Where the repo is against the prototype and this spec; what to keep, replace, build; the first five PRs |
| 17 | `17-STORAGE-AND-NEOLOG.md` | The read vs the video; every video transcribed and searchable; reading broadly across many videos; where footage can live; importing the Neolog archive (R2 + its existing word table) |
| 18 | `18-SCOUT-BUILD-SPEC.md` | **Scout, buildable**: architecture, tables, every step with its schema and rule, the verifier, the stopping math, adapters and quotas, match-back, phases with acceptance tests |
| 19 | `19-SCOUT-EVAL.md` | What to gather for the eval, what each number means, and how each one flatters |
| 20 | `20-DESIGN-BRIEF.md` | **The handoff running the other way**: what the product IS becoming (a session, not a screen; a project that grows, not a cut delivered), why the substrate already chose that, the surfaces nothing draws, and the nine decisions only the design can make |
| 22 | `22-CANVAS-TO-CODE.md` | **The canvas, ported**: `design/canvas/` is the prototype at v73; this is the order it comes into the code, one PR per row, and what the canvas fakes |
| 21 | `21-THE-PLAN-IS-THE-ROOM.md` | **The design's answer to 20**: the plan as the room, playable from the first minute — acts → sections → the two-column script, the sound weave, ghosts by type, Rough and Drawn finishes, the crew (Aldershot · Scout · Sketch), notes at the playhead, one task at a time. Pages in `design/next/` |
| — | `PR-1-HYGIENE.md` | The first pull request for the repo, file by file |
| — | `PR-1-HYGIENE.md` | The first pull request, step by step: retire the old design, bring in the current prototype and this package, repoint the fidelity scripts, declare the dead-letter queue |
| — | `CLAUDE.md` | The short manual for Claude Code — copy to the code repo root |

The research behind these decisions is in `labs/` (twelve write-ups, indexed by `labs/README.md`). Each handoff document names the labs files it rests on. Read the handoff first; go to labs when you need the evidence or the numbers.

## The prototype

The design prototype is the behavioural spec. It is in this project's root:

- `Aldershot One Take.dc.html` — **the room**: Home and the Editor as one surface — no project (the front door and your footage) and a project (rules, the cut, the player)
- `Aldershot.dc.html` — **Settings**
- `Aldershot Manual.dc.html` — the user-facing manual (how the product explains itself)
- `Landing.dc.html` — the signed-out site
- `footage.js` — **the reference engine**: rules, the sample read and transcripts, search, the sample plan
- `labs/Directed plan.dc.html`, `labs/Scout.dc.html`, `labs/Essay to video.dc.html` — labs screens; not public, but the behaviour is spec
- `Scout.dc.html` — **Scout**, the character who looks outside (imported by the room); `labs/Meet Recce.dc.html` — his design history

Most of the prototype's *data* is canned (sample moments, scripted conversation flows). The *mechanisms* that are real are named in `02-SCREENS.md` → "What the prototype fakes".

## The ten invariants

These hold everywhere. A pull request that breaks one is wrong even if it works.

1. **Rules are the source of truth.** A cut is what the rules produce from the moments, re-applied whenever anything changes. Never store a cut as an outcome you can't regenerate.
2. **The model never outputs a timestamp.** It directs (what, why, order, visual job); a deterministic solver places. Its claim of success is never trusted — every edit is validated and measured before it is shown.
3. **Reasons, not scores.** Every judgement shows the line that caused it. Shorts say Strong / Worth a look / Long shot, never a percentage.
4. **Every claim keeps its receipt.** The moment, the quote, the timestamps, the judge's label. "Nothing backs this" is a legitimate answer and must be possible.
5. **Footage is read once; editing is free.** Hours are metered when footage is first read. No edit, cut, short or revision consumes anything.
6. **Nothing is deleted.** Cut moments go to the deleted pile for 30 days; rules switch off rather than erase.
7. **Done means every item is accounted for.** One state row per item; no job completes with a silent failure.
8. **Pictures answer "why am I seeing this".** Own footage → the user's documents → the open world → generated. Generated is never photoreal and never the proof; over a claim only as a depiction a person chose, labelled so, with the claim's receipt unchanged. (Changed 21 Nov; decision 26.)
9. **Scout finds and links; it never downloads.** Footage enters the archive by open licence, by the user, or by the user's own capture.
10. **The genre word never reaches the writer.** The model drafts from a plan in a plain register; the user's own words win wherever they exist.

## Build order, in one line

Eval set → spine (ingest · transcript · alignment · document · cuts · render) → rule engine and Editor → Home conversation and the plan pipeline → retrieval and the judge → Before you post → Scout v0/v1 → operations hardening → the deferred list. Detail and acceptance tests in `11-BUILD-ORDER.md`.
