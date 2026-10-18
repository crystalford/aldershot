# 11 · Build order and acceptance tests

Phases are gated. A phase is done when its tests pass, not when its features exist. Build the simplest thing that passes; the prototype is the behavioural reference for every UI test.

## Phase 0 — the eval set (before any pipeline)

- ~200 claims over ~10 hours across a stream, a meeting and a vlog; each labelled with the backing utterance (word span) or "none"; near-miss negatives written on purpose; two labellers, agreement recorded.
- 50 directive tasks (brief + archive → expected plan shape) and 30 critic pairs (cut A vs cut B with a human preference).
- **Accept:** the set exists in the repo with a runner that reports recall@5, judge precision/recall per label, false-support rate, and labeller agreement.

## Phase 1 — the spine

Ingest → proxy → transcript (raw audio, VAD) → forced alignment → the document (word table, parents, children, labels) → text cuts → render → OTIO export.

- **Accept:** a 30-minute file produces word timings within one frame on a 20-line spot check; moments never straddle a breakpoint; a word-span cut renders with the audio cut on the pause, not the phoneme; the OTIO opens in Resolve with the cuts intact; hours are charged exactly once and never again.

**Forced alignment has landed** (decision 43): torchaudio's MMS_FA in the render
container, over ~30-second overlapping windows planned in `src/align.ts`,
started when a source is attached. `npm run check:align` is the spot check in
runnable form — nine words of a known clip, a band of one frame, plus the
window-offset and mix-to-mono cases that a single window cannot test. It needs
a torch install, so it is acceptance rather than a gate; its header says how to
run it. What is still owed is the same check over thirty minutes of the owner's
own footage on a real deploy, which no sandbox can stand in for.

**OTIO has landed** too: `GET /api/projects/:id/timeline.otio`, built from the
same `edlForProject` the render uses, linked from the export panel as "Take it
elsewhere". Milliseconds are the time base rather than an assumed frame rate —
nothing in this product has ever measured one, and an NLE conforms on import.
Every clip carries `metadata.aldershot` with its source, its words and where
its timings came from, so a cut finished in somebody else's editor still knows
what it is made of. `npm run check:otio` round-trips it through
OpenTimelineIO, which is the closest a machine with no NLE can get to "opens
in Resolve"; opening it in Resolve itself is still owed.

## Phase 2 — the rule engine and the Editor

Port `footage.js compute()` and `applyRule()` over the real document; the Editor with Cut mode: rules with effects, Blocks and Words zooms, hand rules, struck words, inserts, undo/history, project save/restore, the Read (observable only).

- **Accept:** the four seed rules on the sample reproduce the prototype's cut (8 of 14 moments, 5:59, 4 to-camera gaps); every rule shows an effect computed by diff; toggling a rule off and on restores the cut exactly; the sentences in `04-RULE-ENGINE.md` parse to the listed rules and an unparseable one gets the honest reply; undo restores the previous rule set; a project reopened after reload is identical.

## Phase 3 — the room's front door and the plan pipeline

The no-project state (the front door, Footage with Videos · Highlights · Projects, Mine · External · All, search across transcripts); attach/detach; the tighten and shorts flows on the real engine; the plan flow (sized → claim → beats → found → plan → first cut) with the one pause; feelings as rules; the project hand-off to the Editor.

- **Accept:** attaching two moments and typing "tighten this" produces a cut whose numbers match the Editor's for the same rules; "the start drags" adds an order rule with a diff line; the plan flow stops exactly once (at beats) on Ask and Recommend and never on Auto; Cut it saves a project the Editor restores with the plan's order as rule 03; gold chips send, grey chips fill.

## Phase 4 — retrieval and the judge

Hybrid retrieval (BM25 ∥ dense → RRF → rerank) and the three-way judge with a calibrated threshold; search in the conversation; coverage per beat in the plan flow.

- **Accept:** on the Phase 0 set, recall@5 and false-support rate meet the targets you set from the first run and never regress in CI; "nothing here backs this" is returned on the known-none claims at the calibrated threshold; every result shows the backing line; the thread chips come from parent labels; a model swap is blocked if it fails the gate.

## Phase 5 — Shorts, pictures and voice

Shorts mode with Strong / Worth a look / Long shot and reasons, the fragment self-sufficiency test, brief compilation; the pictures move classifier and source order as a rule; voice beats with line-by-line recording and forced alignment of the take; the code-first graphics path with the receipt shot; sound rules (duck by word timings, loudness).

- **Accept:** no short ends mid-sentence or carries an unresolved referent; a pasted brief ("hooks in 2s, 20–40s, no politics, we need 8") compiles to four visible rules with a shortlist diff; a generated image can never be placed on an EVIDENCE or CLAIM block (test the refusal); a recorded take aligns to the script within one frame; a chart with a non-zero baseline fails the lint.

## Phase 6 — Before you post and export

The checklist with fixes; typed pictures → automatic labels; the cue sheet, dispute file, provenance manifest and receipts page; sidecar captions ≤17 cps; loudness normalisation; must-keep rules as solver constraints.

- **Accept:** an export with a generated segment carries the label and the cue-sheet entry without user action; an export never has a silent ghost (the render asks per ghost); a must-keep pair is never split by any length target; loudness measures within ±1 LU of target on three test mixes; the dispute file lists every external clip with fraction used.

## Phase 7 — Scout v0 and v1 (spec: `18-SCOUT-BUILD-SPEC.md`)

v0: behaviour-first decomposition, four families, metadata triage, deep links, the board, the toggle and default, External moments in the archive, ghosts in the cut, missions from the cut, attribution written. v1: map–reduce transcript scan over open sources and user captures, deterministic verification, knee + coverage stopping, gap list, diligence log, match-back by words.

- **Accept:** a brief with a psychological claim is decomposed into observable behaviours only; every board quote string-matches its stored transcript and its timestamp comes from word timings (test with a deliberately hallucinated row); the run stops with every beat covered or listed as a gap; a dropped-in capture is matched to its moment at ≥90% coverage or reported as partial/mismatch; nothing in the codebase fetches audiovisual content from YouTube or Twitch.

## Phase 8 — operations hardening

Item state machine, completion invariant, DLQs, same-model multi-pool routing, breakers, content-addressed caching, per-item progress, canaries, the SLO dashboard, metering and the spend cap, BYOK with probe-on-save.

- **Accept:** kill a provider mid-job in staging and the job completes on another pool with every item accounted for; exhaust retries on one item and it lands in the DLQ as `failed_terminal` with an alert, never silently; a job's cost appears in the owner's cost view within a day; a BYOK key over its rate limit produces "your key hit its limit" and never a platform charge; the spend cap halts top-ups.

## Then

The deferred list (`12-DEFERRED.md`), in its own order. Nothing in it blocks launch.

## Working rules for every phase

- The prototype is the UI spec; where it is silent, `15-DESIGN-LANGUAGE.md` decides.
- Deterministic first: anything that can be a regex, a lint or a measurement is not a model call.
- Every model call sits behind a contract and is tagged with its model version in the output.
- No feature without its kill-switch metric (cost per user per month; acceptance rate of its suggestions).
