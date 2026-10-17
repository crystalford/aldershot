# 16 · State of play — prototype, repo, spec

As of **14 October 2026**. Repo `crystalford/aldershot`, branch `main` (tree `1695351eddbf`), `package.json` version 0.1.0. Read with the GitHub tools on this date; re-check before acting on any line.

## In one paragraph

The repo is a real, deployable Cloudflare build of the **previous** design — Home as a composer, a Footage page, Projects, an Editor with stages ("Pick what stays · Build · Script · Shorts from this"), "Editing is reading now". It has good bones that this package keeps: grounding, intent-first-by-regex, queue-based jobs, metering, caps checked before work, fidelity discipline, self-hosted fonts, chunked transcription. It has no rule engine, no solver, no retrieval beyond tag equality, and its `design/` folder still names the retired prototype as authoritative. **Treat it as a foundation to refactor toward this package, not a diff to patch.**

## What's live in the repo (facts)

- **Stack**: Workers + Hono; D1 (migrations `0001–0006`, `0006_v2_core.sql` is the current schema); R2 (`aldershot-media`); Queues (`aldershot-jobs`, live since 6 Sep 2026, batch 1, 3 retries, concurrency 6 — **no dead-letter queue declared**); Containers (`RenderContainer` standard-4 ×12 for x264 work, `AudioContainer` standard-2 ×8 for audio extraction — the memory-per-vCPU reasoning in `wrangler.jsonc` is correct and worth keeping); Workers AI (Whisper large-v3-turbo default; Deepgram Nova-3 opt-in for diarisation, `speaker` field unverified); Vectorize **commented out** (index not created; threads fall back to tag equality); hourly cron sweep; email login via `send_email`; Analytics Engine.
- **Code**: 48 modules in `src/` (`index.ts` is 148 KB of routes; `ui/client.ts` 178 KB) and 52 tests. Server-rendered pages: `home · footage · projects · settings · cut · editor-intake · export · source · landing · empty`. `ui/tokens.ts`, `ui/icons.ts` (eight icons, no library), `ui/shell.ts` (nav + "the 960px width law").
- **Discipline**: `check-fidelity.cjs` fails the build on any icon outside `icons.ts`, any colour not a token or in the prototype, any rendered string not in the prototype verbatim, any page setting its own width; `shoot.cjs` renders app and prototype side by side. **These scripts check against the retired prototype and will fail against the new one until repointed.**
- **Docs in the repo**: `design/Aldershot.dc.html` (377 KB — the retired monolith, still with Clipping), `design/docs/` (33 files — the retired handoff), `docs/decisions/` (8: blocks, clip-ownership, cost-and-scale, empty-states, models, open-questions, pricing, transcription), `docs/design/` (architecture, fidelity-checklist, product), `docs/research/feasibility.md`, `docs/LAUNCH.md`, `docs/SETUP.md`.

## Keep (the repo already does this right)

| Repo | Why it survives | What changes |
|---|---|---|
| `grounding.ts` — the model supplies *where* and *why*; the quote is rebuilt from our segments; ranges outside the transcript are dropped not clamped; cuts snap to segment edges; overlaps deduped | This is invariant 2 and 4 in embryo | Move from `start_ms/end_ms` to **word-id spans**; the `score 0–100` field never reaches a user (reasons do) |
| `intent.ts` — regex first, model fallback, "unclear" never guesses | Matches `05-PIPELINE.md` | New intent set (tighten · shorts · plan · react · search · rule); labels rewritten; "Clipping" labels gone |
| `plans.ts` — caps checked **before** work; the owner metered, never blocked | Matches `10-OPERATIONS-AND-PRICING.md` | Re-denominate source minutes → **footage-hours**; add generated-second meters (landed only) and the spend cap; new plan set |
| `queue.ts` / `jobs.ts` — long work on a queue, not `waitUntil` | Correct | Add **items** under jobs, the completion invariant, a DLQ |
| `usage.ts` / `metering` — every job writes a usage event | The owner cost view depends on it | Add per-item cost and provider/model tags |
| `models.ts` — per-role router with context-window constraints | Becomes the capability contracts | Add the eval gate and multi-pool failover |
| chunked transcription (`longaudio.ts`, `docs/decisions/transcription.md`) | Ten-hour sources work; measured cost $0.031/hr | Run recognition on raw audio only; add forced alignment |
| self-hosted woff2 fonts | Answers the repo's open question 3 | Keep |
| fidelity scripts and `shoot.cjs` | The right discipline | Repoint at the current prototype set; allow fluid widths (Home is two panes) |
| `edl.ts` | An interchange export exists | Check what it emits; target OTIO + FCPXML + EDL per `09` |

## Replace (built on the retired design)

- `ui/pages/footage.ts`, `ui/pages/projects.ts` — these surfaces no longer exist; Footage is the room's first tab; Projects is a tab in it.
- `ui/pages/editor-intake.ts`, `ui/pages/cut.ts` — the staged editor → the Editor's Cut/Shorts modes with **rules as the source of truth**.
- `essay.ts` — "five acts from kept footage" → the plan pipeline (sized → claim → beats → found → plan → first cut).
- `shell.ts`'s 960px width law → fluid two-pane layouts.
- Settings pricing (Free 300 min / Studio $29) → `10-OPERATIONS-AND-PRICING.md`.
- README's "design/Aldershot.dc.html is authoritative" → this package and the current prototype set.
- Positioning "Editing is reading now" → "The edit you can interrogate".

## Missing entirely

Rules table and engine · the solver and typed ops · rule effects · Home's conversation + canvas · the plan pipeline · hybrid retrieval and the judge (Vectorize off) · the eval set · forced alignment and word ids · provenance on moments · ghosts, missions, Scout, the outside toggle · the evidence ledger, cue sheet, dispute file · item-level job state and a DLQ · multi-pool routing · BYOK · typed pictures and automatic labels · the pictures framework · Before you post as specified.

## The repo's open questions, answered here

| # | Question | Answer |
|---|---|---|
| 1 | The editor with nothing open | Opens the last project; the sample until there is one (`02-SCREENS.md`) |
| 2 | The demo card's specific claims | Gone with the old Home; the archive is the resting canvas |
| 3 | Fonts from Google at runtime | Self-host — already done in the repo; keep |
| 4 | Diarisation `speaker` field unverified | `06-FOOTAGE-SYSTEM.md`: diarise, enrol confirmed names, keep a "several" speaker; verify Nova-3 output on real audio before any UI depends on it |
| 5 | "Good morning" at every hour | Gone with the old Home |
| 6 | Client-side poster frames | Server frame pass on shot boundaries is the planned path (`06`) |
| 7 | Transcription 16× cheaper than modelled | Confirmed; pricing re-derived in `10` |
| 8 | Audio extraction needs the container | Keep the AudioContainer path; verify on a real deploy |
| 9 | Domain | `aldershot.io`; review links `aldershot.io/r/…` |

## The first five pull requests

1. **Hygiene.** Replace `design/` with the current prototype set (`Aldershot One Take`, `Aldershot` (Settings), `Manual`, `Landing`, `Scout`, `footage.js`, `support.js`, assets) and `design/docs/` with this `handoff/`; add `labs/`; copy `handoff/CLAUDE.md` to the root; move the retired docs to `docs/archive/`; rewrite the README's first section. Repoint the fidelity scripts.
2. **The eval set skeleton** (Phase 0): the three footage kinds, the labelling format, the runner that prints recall@5, judge precision/recall per label, false-support rate, agreement.
3. **Port `footage.js`** as the rule engine with a test that reproduces the sample cut (8 of 14 moments, 5:59, 4 to-camera gaps); a `rules` table; rule effects by diff.
4. **Words and alignment**: the word table; forced alignment behind a contract; `grounding.ts` moved to word-id spans; moments as spans.
5. **Home's shell and the Editor's rules pane**: two fluid panes; the archive canvas from the existing library data; attach; the rules pane with toggles and effects; the project hand-off.

Then Phase 3 onward per `11-BUILD-ORDER.md`.

## Risks worth naming

- Two monoliths (`index.ts`, `client.ts`) will fight the refactor; split by surface as each is rebuilt, not before.
- The fidelity checks are a strength only once repointed; until then every new string fails the build.
- Vectorize needs a token with edit permission before the index exists; `wrangler deploy` hard-fails on a declared index that doesn't.
- Containers can't be exercised locally; the alignment and render paths need a real deploy to verify.
- No DLQ means retry exhaustion deletes messages today — the exact failure `10` is designed against. Add it in PR 1.
