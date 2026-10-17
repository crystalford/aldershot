# The footage system — how finding relevant footage should work

v2 · 7 Oct 2026. v1 was my research pass; v2 folds in the measured-evidence pass (same day). Nothing here is built. The prototype hand-tags moments; this is what replaces the hand.

## The one-line version

**Read footage once into moments at two sizes. Index the small ones five ways on one timeline. Retrieve by words and by meaning independently, fuse by rank, rerank. Then a judge decides per claim — backs it / related but not enough / nothing — against a threshold we calibrate ourselves.** Tags are a by-product, not the index.

## What changed from v1, and why

1. **Two sizes of moment, not one.** v1 indexed ~500-token topic chunks. Measured: fact-like queries ("the budget was cut by 4%") peak on small units; larger units only help contextual queries. So: *parents* (topic spans, 2–8 min) for context, labels and the Read; *children* (one utterance or 1–3 sentences, 30–120 tokens, no overlap) for matching. The child *is* "the line that matched."
2. **Words first.** v1 said "both indexes, fused." The evidence is stronger than that: on real ASR transcripts the best embedding scored about the same as a keyword regex (F1 .71 vs .72, call-centre study), ASR noise costs ~20 retrieval points against clean text, and swapping embedding model moves results more than any chunking choice does. BM25 is a peer retriever weighted at least equally — never a re-scorer of vector results — and the claim is expanded into 3–5 spoken paraphrases before either runs.
3. **"Nothing backs this" is engineered, not asked for.** v1 said the judge "is allowed to say none." It isn't, by default — see the abstention section. Three-way label, calibrated threshold, our own near-miss eval.
4. **The visual index is narrower.** v1 called it "not optional." For talking heads and screen recordings, transcript + OCR carry nearly all the retrievable meaning; frame embeddings matter for B-roll search, not claim backing. It's also the single biggest cost line — so it's a tier.
5. **Two indexes added:** *who* (speaker identity across files) and *whose* (third-party fingerprints).
6. **An evidence ledger** — every claim remembers what backed it.

## What a moment is

- **Transcript → sentence-ish units** (punctuation, silence gaps) → embed → topic **breakpoints** (cosine-distance percentile, capped per video) → **parent spans**, never straddling a breakpoint. Each parent gets a one-line topic label (batched, cheap) → the thread chips on Home.
- **Children**: each diarised utterance, or a 1–3 sentence window, 30–120 tokens, no overlap. Retrieve on children; show and judge the child inside its parent.
- **Visual track**: shot boundaries (scene detection), one keyframe per shot; OCR only on frames flagged text-dense; invert dark-mode frames before OCR.
- Every unit carries `video_id + start_sec + end_sec`. That's how a hit becomes a playable clip, a block in the editor, and a line in the dispute file.

## The five lookups

| You ask… | Index | Notes |
|---|---|---|
| exact words — "where he says 'coordinated'" | **BM25** over transcript + OCR text + topic labels + speaker names | Names, numbers, rare words. Its own retriever. |
| by meaning — "when he blames someone else" | **dense** over children, one pinned model | Re-index the whole corpus on model change; never mix versions. |
| by what's on screen — "the frame with the dashboard" | **OCR text** (into BM25) + **shot embeddings** | Screenshots-as-evidence live in OCR. Shot embeddings mostly serve B-roll search. |
| by who — "everything Okafor said" | **speaker** field, filter | Diarisation per file + enrolment across files (below). |
| by claim — "where he contradicts the 2019 statement" | all of the above → **the judge** | Not a retriever. Candidates + claim → backing lines, labels, or nothing. |

Also indexed, not asked for: **provenance** — fingerprints of sources the user marks as other people's, and of known clips.

## Retrieval, in order

0. **Expand the claim** into 3–5 paraphrases and likely spoken phrasings (small LLM call).
1. **BM25 and dense in parallel, independently**, top 50–75 each. The common mistake is vector-only retrieval "re-scored" with BM25 — then BM25 can never surface what the vector missed.
2. Add the **visual** retriever only when the query has a visual component.
3. **Fuse by rank** (Reciprocal Rank Fusion). BM25 scores and cosine similarities aren't comparable numbers.
4. **Rerank** the top 50–100 with a cross-encoder (bge-reranker class: ~0.15–0.25 s self-hosted; hosted APIs ~0.4–0.6 s for 100 docs).
5. **Judge**: top 10–20 children, each with parent context, plus the claim. Per candidate: `SUPPORTS` / `RELATED-BUT-INSUFFICIENT` / `UNRELATED`, the exact backing line with timestamps, a numeric score. Then **our threshold**, tuned on our labelled set — not the model's verbal confidence. A cheap second-opinion verifier (MiniCheck-class, 770M params, ≈GPT-4 accuracy at ~400× lower cost) on everything marked SUPPORTS.

## The abstention problem

This is the finding that most affects what the product promises ("it watches for it", "nothing here backs this"):

- Across 30 LLMs on a claim-verification benchmark, more than half scored under 55%; a small model's recall on "not enough info" was **0.107** — it gave a verdict on nearly every unsupported claim. Another small model flipped the other way (abstained on 95%, found only 17% of true entailments). Stronger models land at 0.78–0.87.
- Attribution checkers accept unsupported claims more readily than they reject supported ones (true-negative rate lags true-positive by >10 points on 9 of 14 datasets).
- Reasoning fine-tuning *degrades* abstention (−24% on average); scaling models barely helps.
- Near-miss evidence — same topic, overlapping words, different claim — is the dominant source of false SUPPORT.
- Moment-retrieval systems hit 98% rejection on *synthetic* negatives and fall apart on realistic near-misses.

**Decisions.** Three-way label. Threshold from a calibration set. Eval built from near-miss negatives (same speaker, same topic, different claim). False-support rate reported on its own. **In the UI this is what Shorts already does** — Strong / Worth a look / Long shot are the judge's labels, never its percentages — and "nothing qualifies" is a legitimate answer.

## Who's speaking

- Per-file diarisation: current best ≈14 DER on benchmarks; single-distant-mic meetings ≈20%; overlap is a structural floor for any one-label-per-moment system.
- For meetings: take the speaker count from the agenda or roll-call; run overlap detection; expose "two speakers" segments rather than force a name.
- Across files: a **speaker centroid** per person, built from segments the user confirmed; conservative cosine threshold; unknown stays unknown until confirmed; each confirmation updates the centroid. Expect 5–7% error cross-year / cross-mic, not the 1% of clean benchmarks. The user fixes a name once; everything downstream inherits it.

## Whose it is

- Fingerprint the sources the user marks as other people's, plus known clips; flag matches. Open-source fingerprinting under broadcast-like conditions tops out below 47% F1, and platform Content ID isn't a public API — so the flag is **"probable"**, never a clearance.
- Weak visual signals: picture-in-picture, sudden letterbox or aspect change.
- Feeds *Before you post*: attribution at first use, one-press fix, a dispute file per video.

## The evidence ledger

Every claim in a made video stores: the backing child unit, the judge's label and score, the threshold version, and the line itself. It is (a) the dispute file in *Before you post*, (b) the receipt the viewer can be shown, and (c) the training set for a specialised small verifier later, on the MiniCheck pattern. Visuals join it — see `PICTURES.md`.

## Cost per hour of footage, read once

| Step | Cost / hr | Notes |
|---|---|---|
| Transcription | $0.03 (Whisper-turbo class) – $0.31 (higher-accuracy API) | |
| Diarisation | ≈€0.11–0.15 | vendor plan pricing |
| Text embedding (children + parents) | <$0.01 | |
| Topic labels | ≈$0.01–0.03 | Flash-class LLM |
| Shot detection | cents | CPU |
| OCR, self-hosted, text-dense frames only | ≈$0.01–0.10 | a frontier VLM on *every* frame would be ≈$3.60 |
| Visual embedding | ≈$2.50 (dedicated video model) or $0.18–0.53 (full-video LLM describer) | the one big optional line |
| **Per claim at query time** | **≈$0.006** | a 10-point video ≈ $0.06 |

**Reading:** a transcript-only archive costs about **$0.05–0.40/hr**; fully multimodal **$1–3.50/hr**. Vendor figures, not measured by us.

## What this means for the product

- **Threads are labels, not the index.** "Everything tagged DSP" is a scope filter over sources. (unchanged)
- **The Read** is the model summarising parent labels + OCR'd numbers. (unchanged)
- **Reasons, not scores** — now specifically: the judge's backing line, and its three-way label. Shorts' Strong / Worth a look / Long shot is the pattern for every surface.
- **Visual indexing is a plan tier**, not a default — it's 70–90% of read-time cost and matters mainly for B-roll search.
- **Editing is free; reading costs.** Confirms the processing-minute model and Settings' "editing never uses any."
- **Attribution is "probable"** with a one-press fix; never a clearance.
- **Speaker names** are fixed once per source and remembered across sources.
- **The claim→moment judge is the core call**; the ledger is its memory.

## Where it fails

1. Paraphrase gap on ASR text — claim worded unlike the spoken line. *Query expansion + judge.*
2. Near-miss false support — same topic and speaker, different claim. *Near-miss eval, threshold, second verifier.*
3. Judge collapse either way — never abstains, or always does. *Calibration, not prompting.*
4. Crosstalk mis-attribution — the quote lands on the wrong councillor. *Expose "two speakers."*
5. Cross-file identity drift — new mic, years apart. *Confirm-to-update centroids.*
6. Screen content the transcript never says — dashboards, feeds, dark-mode small text. *OCR coverage.*
7. Multi-moment claims — one point backed by three scattered moments. *Judge sees candidates together; a moment graph later.*
8. Third-party audio under the user's voice. *Probable, never certain.*
9. A backing line split across a boundary. *Utterance-level children.*

## What to build first: the eval set, not the pipeline

~200 claims over ~10 hours across three kinds of footage (a stream, a meeting, a vlog), each labelled with the backing utterance or "none", plus near-miss negatives written on purpose. Every choice above is tuned against it; no vendor number is trusted until it's run on this. Only then the Read, the rules, the plan.

## Sources

- Chunking: Chroma chunking evaluation; Qu, Tu & Bao (Findings of NAACL 2025); arXiv 2603.06976; arXiv 2505.21700; arXiv 2603.24556.
- ASR text and embeddings: arXiv 2609.00330 (call-centre ASR, embedding vs regex vs LLM); SEAL / CMTEB TTS-converted retrieval; Google MSEB; arXiv 2604.06176.
- Hybrid retrieval and RRF: vectorgrep #71; CORTEX #40; Sphere, "Hybrid Search in Enterprise RAG"; Mixpeek, "What Is Hybrid Search?".
- Rerankers: Agentset reranker ELO and latency comparison; arXiv 2511.22240; Ai2 Scholar QA; MemReranker.
- Abstention and claim verification: ClaimDB; AVeriTeC (Team Papelo); Godbole & Jia 2025; MiniCheck; AbstentionBench (Kirichenko et al., NeurIPS 2025); arXiv 2605.26663; VeriFin.
- Moment retrieval: MomentSeeker; UniVTG-NA (WACV 2025); Soccer-GMR (2026); OS-VMR (arXiv 2605.29812; 2501.07972).
- Diarisation and speaker ID: pyannoteAI changelog and Precision-2/3 figures; 2026 diarisation survey (AMI-SDM, DiariZen); WeSpeaker; CNCeleb; VoxBlink2.
- Fingerprinting: BAF benchmark (ISMIR 2022).
- OCR: OmniDocBench v1.6; PaddleOCR-VL.
- Costs: Cloudflare Workers AI pricing; Twelve Labs pricing; Gemini pricing (arXiv 2606.00825).
- Earlier (v1): dev.to "Build semantic search inside video"; Elastic Search Labs "AI video search"; vidnavigator "RAG for Video Transcripts"; grasp PR #6.
