# 11 · Build order and acceptance tests

Phases are gated. A phase is done when its tests pass, not when its features exist. Build the simplest thing that passes; the prototype is the behavioural reference for every UI test.

## Phase 0 — the eval set (before any pipeline)

- ~200 claims over ~10 hours across a stream, a meeting and a vlog; each labelled with the backing utterance (word span) or "none"; near-miss negatives written on purpose; two labellers, agreement recorded.
- 50 directive tasks (brief + archive → expected plan shape) and 30 critic pairs (cut A vs cut B with a human preference).
- **Accept:** the set exists in the repo with a runner that reports recall@5, judge precision/recall per label, false-support rate, and labeller agreement.

**The runner exists**: `npm run eval:set` over `eval/set.jsonl`, exported from
`/api/eval/export` after labelling at `/eval`. It reports the set's shape, its
negatives, and labeller agreement (raw and Cohen's kappa) offline; `--live`
adds recall@5 through the same `findMaterial` the labels were collected from.
The judge's two figures are written and tested in `src/eval-metrics.ts` and
reported as *waiting* rather than as zero, because the three-way judge is
Phase 4 and does not exist yet.

A blocker was found and fixed on the way: `eval_labels` is keyed
`(claim_id, clip_id)`, so a second labeller silently overwrote the first and
the agreement figure this acceptance names could never have been computed.
`eval_judgements` adds the labeller to the key, and the page asks who is
answering. **What is still owed is the set itself** — ~200 claims over ~10
hours, two labellers — which is somebody's own footage judged by somebody who
watched it, and nothing in this repo can invent it. `eval/example.jsonl` is
three invented claims that exist only so the runner can be exercised.

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

**The cut lands on the pause**, not the phoneme, wherever the timings allow
it: a run of surviving words takes up to 60 ms of the silence at each end,
never more than half the real gap, and only when `frameAccurate()` says the
timings can carry it. `runRange` in `src/cuts.ts` is the one definition, so
the runtime in the footer and the rendered file cannot disagree about it.
With recogniser timings nothing changes — the gap they report is fuzzier
than the room this would make.

## Phase 2 — the rule engine and the Editor

Port `footage.js compute()` and `applyRule()` over the real document; the Editor with Cut mode: rules with effects, Blocks and Words zooms, hand rules, struck words, inserts, undo/history, project save/restore, the Read (observable only).

- **Accept:** the four seed rules on the sample reproduce the prototype's cut (8 of 14 moments, 5:59, 4 to-camera gaps); every rule shows an effect computed by diff; toggling a rule off and on restores the cut exactly; the sentences in `04-RULE-ENGINE.md` parse to the listed rules and an unparseable one gets the honest reply; undo restores the previous rule set; a project reopened after reload is identical.

## Phase 3 — the room's front door and the plan pipeline

The no-project state (the front door, Footage with Videos · Highlights · Projects, Mine · External · All, search across transcripts); attach/detach; the tighten and shorts flows on the real engine; the plan flow (sized → claim → beats → found → plan → first cut) with the one pause; feelings as rules; the project hand-off to the Editor.

- **Accept:** attaching two moments and typing "tighten this" produces a cut whose numbers match the Editor's for the same rules; "the start drags" adds an order rule with a diff line; the plan flow stops exactly once (at beats) on Ask and Recommend and never on Auto; Cut it saves a project the Editor restores with the plan's order as rule 03; gold chips send, grey chips fill.

## Phase 4 — retrieval and the judge

Hybrid retrieval (BM25 ∥ dense → RRF → rerank) and the three-way judge with a calibrated threshold; search in the conversation; coverage per beat in the plan flow.

**BM25 and the judge have landed.** `src/bm25.ts` is the words retriever —
IDF, saturation, length normalisation, and word boundaries rather than
substrings — over `searchAny`, which reaches the whole library rather than
the two hundred most recent moments the old ranker could see. `src/judge.ts`
answers backs / related / unrelated and cannot write the receipt: it is sent
numbered sentences and returns a NUMBER, and the line is rebuilt from our own
text.

**The threshold is structural, not numeric.** A `backs` that cannot point at
a sentence is downgraded to `related` — the model asserted support and could
not show it, which is the near-miss it was asked to separate. A numeric
threshold belongs with the set that could calibrate it, and guessing one
against nothing is the thing this codebase refuses to do elsewhere.

**The rerank and coverage per beat are the same call.** Reading six
candidates against a beat's need to say which back it IS the reranking, and
its answer is the coverage — so there is no separate reranker, and there
should not be: it would ask the same question twice and only one of the two
answers could ever be checked against anything. `src/beat-find.ts` is the
compose, and it degrades rather than failing: a judge that throws costs the
ordering and the coverage, never the beat.

"Thin" means little that BACKS a beat now, not few results. Retrieval returns
six moments for any beat with words in it, so the old count measured whether
the search box worked rather than whether the beat has an argument under it.

Still owed here: search in the conversation — and the acceptance itself,
which is numbers over a Phase 0 set that does not exist yet.
`npm run eval:set` prints all four the moment it does.

- **Accept:** on the Phase 0 set, recall@5 and false-support rate meet the targets you set from the first run and never regress in CI; "nothing here backs this" is returned on the known-none claims at the calibrated threshold; every result shows the backing line; the thread chips come from parent labels; a model swap is blocked if it fails the gate.

## Phase 5 — Shorts, pictures and voice

Shorts mode with Strong / Worth a look / Long shot and reasons, the fragment self-sufficiency test, brief compilation; the pictures move classifier and source order as a rule; voice beats with line-by-line recording and forced alignment of the take; the code-first graphics path with the receipt shot; sound rules (duck by word timings, loudness).

- **Accept:** no short ends mid-sentence or carries an unresolved referent; a pasted brief ("hooks in 2s, 20–40s, no politics, we need 8") compiles to four visible rules with a shortlist diff; a generated image can never be placed on an EVIDENCE or CLAIM block (test the refusal); a recorded take aligns to the script within one frame; a chart with a non-zero baseline fails the lint.

**The self-sufficiency test has landed**, and with it the fourth tab.
`src/shorts.ts` grades every line in a cut Strong · Worth a look · Long shot
with the fact that caused the grade — it stops mid-sentence, it opens on
"he" and nothing in it says who. Both of the acceptance's named failures are
hard; starting part-way through and length are soft, because a viewer joins
a thought in progress all the time and length is a format question rather
than a sense one.

**It is not a model call.** The grading turned out to BE the
self-sufficiency test, which is a measurement — the house rule — and that
makes the reason exact rather than an opinion. Nothing is withheld: a Long
shot is listed and pressable, because the grade says what to expect and a
person who disagrees presses it anyway.

The Shorts tab also wires `/api/projects/:id/shorts-from-line`, which the
gate had carried as unreachable-and-known since it was written.

**The brief compiler has landed** too: `src/brief.ts` turns a pasted brief
into rules, and the shortlist diff is the rules pane's own effect lines
rather than a second view. `len`, `count` and `hook` had been declared and
inert since the port — all three run now.

**The picture framework and the chart lints are built, and have no supply
yet.** `src/pictures.ts` is doc 08's table — the move's visual job, its
source order, and what it may never have — with invariant 8's refusal as a
tested function rather than an intention: a generated picture cannot carry
evidence or a claim, is never photoreal, and "nothing to show" is a result.
The chart lints are hard fails, provenance among them.

**The classifier has landed** (`src/classify.ts`), and with it the refusal
has somewhere to bite: `generated` and `stock` are two of the five kinds the
beat insert accepts, so that route is where a picture which is not your own
footage enters a cut, and the line it lands against decides whether it may.
Housekeeping never reaches the model — that is a regex this product has had
since the first scoring pass. An unanswered line is `claim`, the most
restrictive move, so a failed classification costs a generated card rather
than letting one over somebody's proof.

**A recorded take is aligned to its line** now (`src/take.ts`,
`src/take-run.ts`). The timing half is the aligner — about 20 ms, half a
frame — and it replaces `x-duration-ms`, a number the browser sent about a
file the server had not looked at. The other half is whether it reads the
line at all: a forced aligner cannot refuse, so it will place a script over
a recording of something else and report times for every word, and the
score is the only honest signal that happened. A take is never rejected;
the editor says what it turned out to be, and only when that is not what
was written.

Still owed in Phase 5: the picture supply (documents, generated layers) and
the sound rules.

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
