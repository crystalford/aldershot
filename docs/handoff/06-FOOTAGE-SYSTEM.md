# 06 · Finding footage

The full research is `labs/FOOTAGE-SYSTEM.md` (v2). This is the build spec distilled from it.

## Reading, once

Per source, in this order, each step an item in the job:

1. **Transcribe on raw audio** (never enhanced — enhancement first made recognition worse in every tested configuration), with voice detection so nothing is invented over silence. Word timings. Disfluencies preserved in a second track (needed for filler removal).
2. **Align** with a real forced aligner (≈20 ms) when anything must hit a frame; the recogniser's own timings (≈110 ms) are for the index only.
3. **Diarise**; enrol confirmed speakers across files; keep a "several" speaker for crosstalk.
4. **Segment**: sentence-ish units → embeddings → topic breakpoints → parents; children at utterance level, 30–120 tokens, no overlap, never straddling a breakpoint.
5. **Label** each parent (one line, batched, cheap) → thread chips. Labels are a by-product, not the index.
6. **Visual** (depth setting *Words + screen* or *Pictures too*): shot boundaries → one keyframe per shot; OCR only on text-dense frames (invert dark mode first); shot embeddings only on *Pictures too*.
7. **Fingerprint** sources the user marked as other people's, for later "probable match" detection.
8. **Index**: BM25 over transcript + OCR text + labels + speaker names; dense over children (one pinned model; re-index everything on change); speaker field; provenance.

Charge the source's hours when step 8 completes. Nothing after this costs the user anything.

## Retrieving, per claim

0. Expand the claim into 3–5 spoken paraphrases (small model).
1. **BM25 and dense in parallel, independently**, top 50–75 each. Never re-score vector results with BM25 — then keywords can't surface what the vector missed. On transcripts, keyword search is a peer retriever.
2. Visual retriever only when the query has a visual component.
3. **Fuse by rank** (reciprocal rank fusion). Scores aren't comparable; ranks are.
4. **Rerank** the top 50–100 with a cross-encoder.
5. **Judge**: the top 10–20 children with parent context + the claim → per candidate `SUPPORTS | RELATED-BUT-INSUFFICIENT | UNRELATED`, the exact backing line with word-id span, a numeric score. Apply **our calibrated threshold**, not the model's verbal confidence. A cheap second verifier on everything marked SUPPORTS.

The judge's backing line is the "reason" the UI shows. Its three-way label is Shorts' Strong / Worth a look / Long shot and every other surface's pattern.

## Abstention is engineered

Models alone either never abstain or always do; near-miss evidence (same speaker, same topic, different claim) is the dominant false positive. So: three-way label; a threshold tuned on our labelled set; an eval built from near-miss negatives; false-support rate reported on its own. "Nothing here backs this" must be a reachable answer, and the rule "it watches for it" depends on it.

## Cost per hour of footage (planning figures)

Transcription $0.03–0.31 · diarisation ≈ $0.11–0.15 · embeddings < $0.01 · labels $0.01–0.03 · shot detection cents · OCR on text-dense frames $0.01–0.10 · visual embedding $0.18–2.50 (the one big optional line). **Words-only ≈ $0.05–0.40/hr; fully multimodal ≈ $1–3.50/hr; a judged claim ≈ $0.006.** This is why *how deeply it reads* is a Settings default and visual reading is a tier.

## The eval set comes first

~200 claims over ~10 hours across three kinds of footage (a stream, a meeting, a vlog), each labelled with the backing utterance or "none", plus near-miss negatives written on purpose. Labeller agreement recorded. Every retrieval and threshold choice is tuned against it; every model swap is gated by it; no vendor number is trusted until it has run on it. It is also the seed of the golden set that routes models in production (`10-OPERATIONS-AND-PRICING.md`).

## The Dossier (memory that compounds)

A ledger of moments, sources examined and searches run, with yields and dead-end flags — so the same research is never re-run and "searched 4×, nothing" is a known fact. Threads are saved queries with labels. Timelines are a sorted view. Contradictions are **user-triggered, scoped to one thread, verified in a second pass, confirmed by a human** — never always-on; most hits are "changed position over time" and are labelled so. Guardrails: extract lazily, closed schemas, ids before names, budgets on every background job, kill-switch metrics per feature.

*Rests on:* `labs/FOOTAGE-SYSTEM.md`, `labs/DOSSIER.md`, `labs/SCRIPT-AND-TIMING.md`.
