# Aldershot Build Spec v2: consolidated handoff for Claude Code and Claude Design

Aldershot can now be built. The four reports fit together once you fix three things: the user's spoken reaction to each verified receipt is the main source of SAID, the deterministic linter starts on generic defaults and switches to the user's own profile after about 1,500 words of his speech, and clips never come from YouTube downloads by default. Everything below is stack-agnostic. Tags: **[M]** measured, **[S]** published standard or platform rule, **[I]** inference or design choice, **[F]** folklore or unverified.

---

## 1. Executive summary

**TL;DR**
- **Build order:** chat intake → Claim Map (Gate 1) → Receipts → Verdicts (Gate 2) → per-receipt "Receipt Talk" voice interview → Spine & Script, at least 80% of it the user's or quoted words → one-take VO → rough cut with Document blocks → verification sweep → export. That slice is the MVP. Everything else is a later milestone.
- **What reconciliation changed:** the reaction interview sits after Verdicts. The LLM may only cut, reorder, merge and split, plus write bridges of ≤25 words. The linter uses generic thresholds until it has a profile. Recording is one-take only. The Pull List defaults to embed/reference placeholders plus lawful files the user supplies, because YouTube's Terms forbid downloading "except as expressly authorized by the Service."\[1\]
- **Top risks:** (1) ASR hallucination in quotes. Every shipped quote must be re-heard. (2) Legal exposure: defamation, fair-dealing attribution, the ToS on clip acquisition. (3) Scope creep in the editor. (4) Cost drift from unbounded refinement loops. Hard cap is 3 passes and a per-project budget ceiling.

**Settled (no change):** beat schema and skeleton from Report 3. Pass structure and the three user gates from Report 4. Anti-slop levers from Report 2. Document-block timing and audio targets from Report 1, with corrections in §6 and §12.

**Changed after reconciliation:**

| Area | Before | After |
|---|---|---|
| SAID authorship | Ambiguous (user words vs system-written from verdicts) | User's words from Receipt Talk plus verbatim quotes. LLM edits and short bridges only. System-written SAID survives only as a flagged fallback |
| Linter thresholds | Generic only, or user profile only | Generic cold-start, then a blended switch at ≥1,500 user words, full switch at ≥5,000 |
| VO recording | Teleprompter plus hotkeys (Report 1) | One-take capture job. Record block, alignment, exception-only chat |
| Clip acquisition | Pull List implied downloading | Placeholder/embed by default. Files only from user-supplied lawful sources, with a provenance attestation |
| YouTube upload quota | "1,600 units/upload, ~6/day" (widely repeated) | Out of date. Google now gives `videos.insert` its own bucket of 100 calls/day at 1 unit per call\[2\]\[3\] |

**Top risks, ranked:**

| # | Risk | Severity | Mitigation in spec |
|---|---|---|---|
| 1 | Hallucinated or misheard quote shipped as evidence | Critical | Pass 6 re-hear gate. Quote status must be `verified_audio` before export |
| 2 | Defamation or overclaim about a real person | Critical | Overclaim check, clinical-label lint, red-line flags, "seek the subject's side" task, lawyer checklist |
| 3 | ToS breach in clip acquisition | High | Compliant default (§6.2), residual decision left to the user (§11) |
| 4 | LLM voice drift / slop | High | ≥80% user-or-quote words, deterministic linter, one rewrite and stop |
| 5 | Cost or latency blowout | Medium | Model routing, caching, per-project cap (§8.4) |
| 6 | Editor complexity eats the MVP | Medium | Block timeline only. No free-form NLE in MVP |

---

## 2. Reconciled decisions table

| # | Conflict | Resolution | Evidence basis |
|---|---|---|---|
| 1 | Talk-first user words (R2) vs "report from sources" / system-written SAID (R3–4) | **Two voice touchpoints.** (a) *Intake talk*: the user explains the hypothesis aloud in 3–10 min, and that becomes the Brief and the first voice sample. (b) *Receipt Talk*, after Gate 2: for each verdict cluster the UI shows the receipt and its verdict, and the user talks for 30–120 s ("what this shows, what bugs me, what cuts against it"). **Spine** (system) fixes beat order, the claim, and receipt_ids. **SAID** is assembled from Receipt Talk transcript spans plus verbatim quotes. LLM operations allowed: cut, reorder, merge, split, fix tense/pronouns, and **bridges ≤25 words, max 1 per beat**. Target ≥80% user-or-quote words per section, hard floor 60%. The reporting frame governs the `claim` field, bridges and all prompts. It never rewrites the user's words into a different register. **Fallback:** if the user skips Receipt Talk, the LLM drafts SAID from verdicts under register lock, every span is flagged `llm_authored`, and the one-take recording plus "prefer what you said" alignment becomes the talk-first step | R2 (structural LLM tells, own-words lever). R3 (genre/task label drives register). R4 (verdicts must precede writing) [I for the placement] |
| 2 | Generic sentence-length targets (R1) vs user profile (R2) | **Cold start:** mean 12–18 words, hard cap 30, short (≤7 words) share 15–30%, SD ≥6, one punch sentence per 4–6. **Blend** once the VoiceProfile holds ≥1,500 transcribed words of the user's *spontaneous* speech (≈10 min at 150 wpm): threshold = 0.5·generic + 0.5·user. **Full switch** at ≥5,000 words or 3 accepted projects. Update with EMA weight 0.2 per accepted script. **Never relaxed:** cap 30 words, caption limits, banned patterns | R1 measured channel profiles [M]. Switch points [I] |
| 3 | R1 teleprompter VO flow | **Superseded.** One-take capture job (§7) | User decision |
| 4 | Pull List vs YouTube ToS | **Default:** no download. Each ClipReceipt starts as a `reference` placeholder (URL, timestamps, embed link, verbatim span). Media acquisition only through `user_file` (own recordings), `licensed`, `public_domain/CC` (license recorded), `official_record` (court/government/legislature footage under its stated terms), `creator_permission` (written, stored), or `platform_authorized` (a download/export feature the platform itself offers). The user attests provenance per file. **Residual:** whether to use clips obtained any other way is the user's decision, with a lawyer (§11) | YouTube ToS: no download "except: (a) as expressly authorized by the Service; or (b) with prior written permission from YouTube and, if applicable, the respective rights holders"; embedding through "the embeddable YouTube player" permitted [S].\[1\] Fair dealing s.29.1 [S]\[4\]\[5\] |
| 5 | Passes vs hybrid UI | Mapped in §3 | [I] |
| 6 (new) | Netflix "17–20 cps" (R1) | Netflix English is 20 cps for adult content and 17 for children's.\[6\] **Use 17 cps** as the hold-time divisor (conservative). BBC 160–180 wpm ≈ 14–16 cps for captions\[7\] | Netflix English (USA) Timed Text Style Guide, §I.14: "Adult programs: Up to 20 characters per second. Children's programs: Up to 17 characters per second." [S]. BBC figure secondhand |
| 7 (new) | "−14 LUFS is YouTube spec" | Convention. YouTube turns loud uploads down and does not turn quiet ones up.\[8\]\[9\] **Target −14 LUFS integrated, ≤−1 dBTP**, accept −16 to −14\[10\] | Third-party measurements [M, weak]. No primary Google spec found |

---

## 3. Pipeline state machine and UI mapping

**Pass table**

| Pass | Input → artifact | UI surface | User gate | Stop condition |
|---|---|---|---|---|
| 0 Intake | Chat plus optional voice talk → **Brief** (topic, subject(s), stance-as-hypothesis, audience, target length, red lines) | Chat-first intake. Brief card shown inline | Confirm Brief (soft) | All required Brief fields filled. Any pre-committed stance rewritten as a testable hypothesis |
| 1 Hypothesis & Claim Map | Brief → **Hypothesis**, **Claims** (detractor and defender, typed, ranked by check-worthiness, mirrored for/against queries) | Processing view → Claim Map review card (phone-OK) | **GATE 1:** approve/edit hypothesis and the top claims | ≥6 claims with ≥2 defender claims. Every claim has mirrored queries |
| 2 Receipts | Claims → **Receipts** and **ClipReceipts** (user library first, then web/transcripts; perspective questions interleaved) | Processing view (live counter: receipts per claim) | none | Saturation: 2 consecutive retrieval rounds add <10% new unique receipts, or a per-claim cap of 8 receipts, or budget hit |
| 3 Verdicts | Receipts → per-(claim, receipt) entailment → **Verdicts** (ACH-style matrix) | Verdict matrix (desktop) / verdict cards (phone) | **GATE 2:** accept/override each verdict | Every claim has a verdict, or `insufficient_evidence` |
| 3b Receipt Talk | Verdicts → **Takes** of type `interview` → transcript spans | Interview mode: receipt on screen, record button, "next receipt" | none (skippable, triggers fallback) | Every Spine-eligible verdict has ≥1 interview take, or the user skips |
| 4 Spine & Script | Verdicts + interview spans + quotes → **Spine** → **Beats** with SAID/SHOW | Editor opens. Chat rail announces the "Script ready" change card | none | All five checks run. One targeted rewrite done. Results shown |
| 5 Clip Plan & Pull List | Beats → **PullItems** (one per clip/document needed) | Pull session screen (batched) | **GATE 3:** one sitting: supply file / keep placeholder / drop, per item | Every PullItem resolved |
| VO | Script → **RecordingJob** → **Takes** → aligned per-block clips | Record block in editor. Inline record card in chat for single lines | Exceptions only | Every SAID chunk has a `clean` take |
| 6 Verification sweep | All quotes, ClipReceipts, attributions → statuses | Verification checklist screen | Fix-or-cut per failed item | 100% shipped quotes `verified_audio`/`verified_text`. Attribution complete |
| 7+ Refinement passes | Named and scoped (weakest-claim, missing-counter, quote re-verify, redundancy/length, flow/structure, register lint) → **ChangeCards** | Chat rail command or button. ChangeCard (phone-OK) | Accept/reject per card | User stops, **max 3 passes per project version**, or no changes proposed |
| Export | Timeline → render + captions + description + sources page | Export screen | Confirm metadata and disclosure toggles | Render passes the QC checks (§6.6) |

**Project states:** `draft → intake_done → claims_pending_review(G1) → receipts_running → verdicts_pending_review(G2) → interview_open → scripting → script_ready → pull_pending(G3) → recording → assembling → verifying → ready_to_export → exported`. Side states: `paused` (from any state), `blocked:{reason}`, `abandoned` (no activity 30 days → archived, resumable).

**Invariants (testable):**
- Each Pass run has an `idempotency_key = hash(pass_type, input_artifact_versions, config_version)`. Re-running with the same key returns the stored output and makes no model calls.
- Passes are resumable at item granularity (per claim, per receipt, per beat). A crash resumes from the last committed item.
- No pass mutates an artifact in place. Every write creates a new version with `created_by_pass_id`.
- Gate states can only be left through a user action recorded in the AuditEvent log.
- Editing an upstream artifact (e.g., overriding a Verdict) marks downstream artifacts `stale`. It never auto-regenerates them. The chat rail offers "Re-run Script for 3 affected beats."

---

## 4. Data model (stack-agnostic)

All entities carry `id, project_id, version, created_at, created_by (user|pass_id), supersedes_id, status`. Text fields store provenance spans: `{text, origin: user_speech|quote|llm_bridge|llm_edit|user_typed, source_ref}`.

| Entity | Key fields | Relationships |
|---|---|---|
| **Project** | title, state, target_length_s, budget_cap, config_version | has one Brief, VoiceProfile ref, many of everything |
| **Brief** | topic, subjects[], hypothesis_text, audience, red_lines[], format (commentary/investigative/explainer), intake_take_id | → Hypothesis |
| **Hypothesis** | statement, null_statement, status (open/supported/refuted/mixed) | has many Claims |
| **Claim** | text, side (detractor/defender), claim_type (fact/inference/uncertainty/counter), checkworthiness 0–1, queries_for[], queries_against[], rank | many Receipts via Verdict |
| **Receipt** | kind (document/web/transcript/clip/dataset/user_file), url, archive_url, title, author, publisher, publish_date, capture_date, content_hash, excerpt_span, paywalled bool, availability (live/deleted/archived_only) | ↔ Claims |
| **ClipReceipt** (extends Receipt) | platform, platform_id, channel, speaker, speaker_confidence, in_s, out_s, verbatim_cut_span, context_span (≥15 s either side), transcript_source (platform/asr/human), verification_status, sub_claim_id, role (evidence/illustration/object_of_critique), acquisition (reference/user_file/licensed/public_domain/official_record/creator_permission/platform_authorized), rights_note, attribution_text | → PullItem |
| **Verdict** | claim_id, receipt_id, entailment (supports/refutes/neutral), rationale_span, confidence (established/likely/contested), user_override, matrix_cell | → Beat |
| **Beat** | beat_id, section, claim_id, receipt_ids[], claim_type, confidence, said_sentences[≤3] (span-tagged), on_screen, show_block_ids[], lint_flags[], check_results{} | has Blocks, Takes |
| **Block** | type (document/clip/chart/map/timeline/text_card/lower_third/broll/record/title), start_s, dur_s, params{}, asset_ids[], beat_id | → Asset |
| **Take** | type (vo/interview/intake/montage), audio_asset_id, transcript, word_timings[], chunk_ids[], match_score, status (clean/flub/mismatch/superseded) | → Beat/Block |
| **RecordingJob** | section_id, chunk_ids[], state, takes[] | |
| **Pass** | type, idempotency_key, input_versions{}, config_version, model_route{}, tokens_in/out, cost, latency_ms, state (queued/running/done/failed/cancelled), error | → ChangeCards, AuditEvents |
| **ChangeCard** | pass_id, title, summary ≤280 chars, diffs[] (artifact, before, after), rationale, state (proposed/accepted/rejected/partially) | |
| **PullItem** | clip_receipt_id or receipt_id, needed_for_beat, resolution (file/placeholder/drop), provenance_attestation, file_asset_id | |
| **VoiceProfile** | word_count, sources[] (intake/interview/past_essay/vo), metrics{mean_len, sd_len, short_share, em_dash_per_1k, participial_per_1k, nominalization_per_1k, contraction_rate, top_lexicon[], banned_overrides[]}, blend_weight, updated_from_project_ids[] | |
| **Asset** | kind, storage_uri, sha256, duration, loudness_lufs, license, provenance, retention_policy | |
| **AuditEvent** | actor, action, artifact, before_version, after_version, pass_id, timestamp | append-only |

Versioning: undo means re-pointing a "current" pointer to an earlier version. Nothing is deleted except under the user's retention policy.

---

## 5. Script spec v2

**5.1 Beat schema:** `beat_id, section, claim, receipt_ids, claim_type (fact|inference|uncertainty|counter), confidence (established|likely|contested), SAID (≤3 sentences, span-tagged by origin), on_screen`, plus `show_block_ids, lint_flags, check_results`.

**5.2 Skeleton**

| Section | Rule |
|---|---|
| Cold Receipt | Opens on a real artifact. Key number in beat 1 or 2 |
| Question & Promise | Done by ~0:30 |
| Context | Only what the Evidence Run needs |
| Evidence Run | Receipt change every 45–90 s. Strongest receipt last. Chapters ≤6 min |
| What Cuts Against This | Each counter is either refuted with a receipt or explicitly conceded. "Mentioned and moved on" fails the structure check |
| Verdict & Limits | States what is established, likely, contested. No moral, no call to action |

Opening templates: **A Cold Receipt (default)**, **B Headline Finding**, **C Contradiction**. **D bare question/teaser is banned.**

**5.3 Register rules (sent on every generation call):** frame = "report verified claims from these receipts." Send the register spec plus 3–5 of the user's own plain paragraphs (from the VoiceProfile) every call. Generate per beat. Never label the task "YouTube script."

**5.4 Linter (deterministic, no LLM-as-judge)**

| Check | Cold-start threshold | After profile switch |
|---|---|---|
| Sentence length mean | 12–18 words | user mean ±3 |
| Sentence length SD | ≥6 | ≥0.8 × user SD |
| Hard cap | 30 words | 30 (never relaxed) |
| Short-sentence (≤7 words) share | 15–30% | user ±10 pp |
| Punch sentence spacing | ≥1 per 6 sentences | same |
| Em-dash rate | ≤3 per 1,000 words | ≤ user rate + 1 |
| Participial clauses | ≤8 per 1,000 words | ≤1.5 × user |
| Nominalizations (-tion/-ment/-ness/-ity heads) | ≤25 per 1,000 words | ≤1.3 × user |
| Template patterns ("it's not X, it's Y", "here's the thing", tidy-moral endings) | 0 in LLM spans, flag in user spans | same |
| High-ratio LLM lexicon (e.g., delve, tapestry, crucial, underscore) | 0 in LLM spans | user overrides allowed |
| Repeated 3-grams across beats | ≤2 repeats per section | same |
| Specifics density (numbers, names, dates, places) | ≥1 per 2 sentences in Evidence Run | same |
| Contraction rate | ≥ 50% of opportunities | user ±15 pp |
| Fang Easy Listening Formula | ≤12 per sentence avg | user + 2 |
| Clinical labels about a real person (narcissist, psychopath, etc.) | 0 unless inside a verbatim quote | same |
| Origin share | ≥80% user/quote words per section (floor 60%) | same |

Flow: lint → **one** targeted rewrite of flagged `llm_*` spans only → re-lint → show the remaining flags as named categories on spans → stop. User spans are flagged, never auto-rewritten. Every user edit to a flagged span updates the VoiceProfile counters (EMA 0.2).

**5.5 Five checks** (each per sentence, each output pass/fail with span):
1. **Support:** sentence entailed by ≥1 linked receipt (small model, factored per receipt).
2. **Unsupported sentence:** factual sentence with no receipt → flag.
3. **Register lint:** §5.4.
4. **Structure:** skeleton order, counter handled, receipt cadence 45–90 s, chapters ≤6 min, opening template ≠ D.
5. **Overclaim:** certainty words vs Verdict confidence (e.g., "proves" on `likely` → fail).

---

## 6. Media spec

**6.1 Document block:** real artifact (screenshot/scan/PDF page). One animated highlighter span ≤20 words. Re-typed label ≤4 words. Read-aloud off by default (on only when the exact wording is the evidence). Hold = max(2 s, chars/17 + 1 s), capped at 7 s. Source and date in a lower-third for ≥2 s.

**6.2 Clip receipt rules:** acquisition default `reference`. The placeholder renders as a card with the channel, date, verbatim quote, and the URL/QR, so a rough cut is always renderable. A clip can only be `ready` if acquisition ≠ `reference` and provenance is attested. Context span ≥15 s each side is stored for verification. Attribution text = source + author/performer/maker/broadcaster where given (s. 29.1 fair dealing for criticism or review requires mentioning "the source" and, "if given in the source," the author/performer/maker/broadcaster).\[4\]\[5\]

**6.3 SHOW rules**

| Rule | Value | Tag |
|---|---|---|
| One visual beat per sentence (block change or animated change) | default | [I from R1] |
| Max static hold without motion | 7 s | [I] |
| Lower-third on every first appearance of person/source | ≥2 s, ≤6 words name + ≤6 words role | [I] |
| Auto-generatable reliably | charts from user-supplied CSV, timelines from dated receipts, maps from named places (geocoded, user-confirmed), text cards, lower-thirds, Document highlight | [I] |
| Not auto in MVP | stock b-roll selection, generative imagery | [I] |
| Stock/b-roll | only from licensed libraries with the license ID stored on the Asset; none by default | [I] |
| AI-generated realistic imagery of real people/events | off. If enabled, set YouTube "altered or synthetic" disclosure = yes\[11\]\[12\] | [S] |
| Shot length "3–5 s" | unverified. Measure reference channels with scene detection before adopting | [F] |

**6.4 Audio targets**

| Item | Target | Tag |
|---|---|---|
| Narration rate | ~165 wpm planning rate (calibrate to user's measured VO) | [M from R1] |
| Music under VO | −20 dB relative to VO (range 10–25), sidechain duck, attack ~50 ms, release ~300 ms | WCAG 1.4.7 floor [S], timings [I] |
| Music changes | only at section breaks | [I] |
| Integrated loudness | −14 LUFS (accept −16 to −14), true peak ≤−1 dBTP\[9\]\[10\] | convention [M, weak] |
| Noise cleanup | denoise before normalization. Gate the noise floor to ≤−60 dBFS between phrases. Never denoise quoted source clips beyond light hum removal | [I] |
| Music source | YouTube Audio Library by default ("copyright-safe… won't be claimed by a rights holder through the Content ID system"). Other libraries only with the license stored. Content ID does not read descriptions\[13\]\[14\] | [S] |
| Pre-publish | upload unlisted first, wait for the Content ID check, then publish | [I] |

**6.5 Captions:** sidecar (SRT/VTT) by default, burned-in only for Shorts/clips. Source = SAID text force-aligned to the final VO (not raw ASR). Quotes from clips use the verified verbatim span. Target 100% accuracy including spelling (the CRTC standard for pre-recorded broadcast English captions, used as a benchmark, not a legal obligation for a YouTube creator).\[15\]\[16\] ≤42 characters/line, ≤2 lines, ≤17 cps, cue duration 0.83–7 s, ≥2-frame gap.\[6\] Non-speech cues for music changes. Upload the caption track via API or Studio.

**6.6 Export**

| Item | Value | Tag |
|---|---|---|
| Container/codec | MP4, moov atom at front, no edit lists. H.264 High profile, progressive, 2 consecutive B-frames, closed GOP = half frame rate, CABAC, VBR, 4:2:0\[17\] | YouTube recommended settings [S] |
| Bitrate | 1080p SDR 24–30 fps: 8 Mbps (≥16 Mbps preferred) · 1080p 50/60: 12 Mbps · 4K 24–30: 35–45 Mbps\[18\] | [S] |
| Audio | AAC-LC, 48 kHz, stereo, 384 kbps\[17\]\[19\] | [S] |
| Frame rate | same as source footage\[17\] | [S] |
| QC gate | loudness within target, no black frames >1 s outside intentional, captions present, all quotes verified, attribution card present | [I] |

**6.7 Packaging**

| Item | Rule | Basis |
|---|---|---|
| Title | States the finding or contradiction (templates B/C). No bare question. ≤70 chars | Earlier finding that question/teaser headlines underperform, from prior reports, not re-verified here [I]. Robertson et al., Nature Human Behaviour (2023), analysing Upworthy archive RCTs: "For a headline of average length, each additional negative word increased the click-through rate by 2.3%." This shows CTR rewards negativity, a pressure to resist rather than a target [M] |
| Thumbnail | Real receipt fragment + ≤4 words. Generate 3 variants | [I] |
| Testing | YouTube Test & Compare: up to 3 titles/thumbnails/combos, winner by watch-time share, not CTR.\[20\]\[21\] Use it on every upload ≥ the channel's median impressions | [S, secondary] |
| Description | 1–2 sentence finding, chapters, sources list (numbered, with dates), attribution block, corrections policy link | [I] |
| Chapters | first at 00:00, ≥3, ascending, each ≥10 s.\[22\] Map to sections; keep ≤6 min | YouTube Help [S] |
| Credits/attribution block | per clip: "Source: {title}, {channel/publisher}, {date}, {URL}; used for criticism/review" | s.29.1 [S] |
| Published sources page | static page per video: every receipt, its role, archive link, capture date, verdict | [I] |
| AI disclosure | toggle "altered or synthetic" only if realistic synthetic media of real people/events/scenes is present. Scripts and captions generated by AI do not require it per YouTube\[12\] | [S] |

---

## 7. Recording spec (one-take capture)

| Step | Behaviour | Acceptance |
|---|---|---|
| 1 Job | Chat issues a RecordingJob per section (3–6 chunks; 1 chunk = 1 SAID sentence) | Job lists chunk_ids and estimated duration (words / user wpm) |
| 2 Record block | Current line large, next line dimmed. Auto-advance when alignment detects the chunk's last word + 300 ms silence. Manual tap-to-advance fallback | Advance latency ≤500 ms after chunk end |
| 3 Flubs | User just re-reads the line. The system keeps the **last** clean read per chunk | Re-read detected when ≥60% of the chunk's words repeat within 10 s |
| 4 Alignment | Forced alignment of take audio to the expected text. Cut per block with 80 ms pre/post padding at zero crossings | Word boundary error ≤200 ms for ≥90% of words on the golden set |
| 5 Match | Per chunk WER vs SAID. ≤10% = clean, 10–25% = `mismatch_minor` (offer "update SAID to what you said"), >25% = `mismatch` | Thresholds configurable |
| 6 Exceptions | Chat rail: "Lines 4 and 7 didn't match the script, redo?" with one-tap redo opening the record block at those chunks | Only mismatches surface. Clean takes are silent |
| 7 Prefer-said | Option (default on after first project): update SAID from the alignment when the mismatch is minor and not inside a quote. Re-run lint and support check on changed sentences | A quote span is never altered |
| 8 Montage/short VO | Inline record card in chat for single lines | Same alignment and match rules |

Evidence: forced alignment beats raw Whisper timing. Bain et al.'s WhisperX paper (INTERSPEECH 2023, Table 2) reports 93.2% word-segment precision on Switchboard vs 85.4% for Whisper alone, "calculated with a collar value of 200ms" (AMI: 84.1% vs 78.9%) [M]. Users report timestamp regressions in some WhisperX releases, so pin the aligner version and keep a golden-set regression test [M, anecdotal].\[23\]\[24\]

---

## 8. Evaluation harness and acceptance criteria

**8.1 Golden set:** 12 frozen projects. 4 commentary, 4 investigative, 4 explainer. Each includes 1 with no findable sources, 1 with a deleted/paywalled key source, 1 where the defender side is right, 1 with a contested clinical-label temptation, and 1 with conflicting transcripts. Each stores: Brief, expected claim set (human-labelled), receipts with gold entailment labels, a gold quote set with audio, user interview audio (recorded once, reused), and the VO take with deliberate flubs.

**8.2 Metrics and gates (testable statements)**

| Pass | Metric | Gate |
|---|---|---|
| 1 | Claim recall vs gold | ≥0.80. Defender-claim recall ≥0.70 |
| 1 | Mirrored query presence | 100% of claims |
| 2 | Receipt precision (relevant/retrieved) | ≥0.70 |
| 2 | Symmetry: receipts for vs against per claim | neither side 0 when gold has both |
| 3 | Entailment accuracy vs gold | ≥0.85. Refutes-recall ≥0.80 |
| 3b/4 | Origin share user+quote | ≥80% per section on golden projects with interviews |
| 4 | Support check: unsupported factual sentences shipped | 0 |
| 4 | Linter pass rate after one rewrite | ≥90% of LLM spans clean |
| 4 | Structure check | 100% pass on golden set |
| 4 | Overclaim false negatives | 0 on the seeded overclaim set |
| 6 | Quote verification rate | 100% of shipped quotes `verified_*`. 100% of seeded ASR hallucinations caught |
| VO | Alignment boundary error | ≤200 ms for ≥90% of words |
| VO | Flub handling | last clean read selected in ≥95% of seeded flubs |
| All | Idempotency | re-run with same key → 0 model calls |
| All | Regression vs previous release | no metric drops >2 pp. R4's warning that deep-research agents regress 16–27% of prior content when revising is the motivating risk |
| Product | User edit distance on SAID (char-level) | tracked. Target ↓ over 5 projects |
| Product | Time-to-acceptable-script (Brief → Gate-3-ready) | ≤90 min active user time for a 12-min video [I target] |

**8.3 Running it:** deterministic checks (linter, structure, chapters, captions, export QC, idempotency) run on every commit as unit tests with fixtures. Model-dependent evals run nightly and on any change to prompts, routing or model version, using the provider's batch endpoint (50% discount, asynchronous within 24 h).\[25\]\[26\] Store every run's outputs for diffing. A prompt change merges only if the eval report is attached.

**8.4 Cost, latency, routing (12-minute video ≈ 1,980 SAID words ≈ 130 sentences ≈ 50 beats)**

| Pass | Tier | Est. tokens in/out | Est. cost | Notes |
|---|---|---|---|---|
| 1 Claim map | frontier | 50k / 8k | ~$0.45 | quality-critical |
| 2 Receipts (summarize, extract) | small | 300k / 30k | ~$0.45 | parallel |
| 2 Perspective questions | mid | 50k / 10k | ~$0.30 | |
| 3 Entailment (≈150 pairs) | small | 450k / 45k | ~$0.70 | factored, cacheable |
| 3 ACH synthesis | frontier | 80k / 10k | ~$0.65 | |
| 4 Per-beat SAID assembly | mid; frontier for Cold Receipt and Verdict beats | 360k / 20k (≈50% cached) | ~$1.00 | register prefix cached |
| 4 Five checks | small (support/overclaim); deterministic rest | 400k / 20k | ~$0.50 | |
| 7+ Refinement ×3 | frontier | 300k / 30k | ~$2.25 | hard cap 3 |
| **LLM total** | | | **≈ $6–8; cap $25/project** | |
| ASR | vendor or local | ≈150 audio-min (sources + interview + VO + re-hears) | minutes × your rate | minutes are the cost driver |

Prices assume list prices reported by third parties in 2026: frontier ≈$5/$25, mid ≈$3/$15, small ≈$1/$5 per M tokens in/out.\[25\]\[27\] Cache reads cost 0.1× base input. Cache writes cost 1.25× (5-min) or 2× (1-h). Batch is −50% and stacks with caching [S, secondary; verify against current docs].\[28\]\[29\]\[30\] All estimates are [I]. Latency targets [I]: Pass 1 ≤2 min, Pass 2 ≤10 min, Pass 3 ≤5 min, Pass 4 ≤5 min, alignment ≤0.5× audio duration, change card ≤60 s. Caching keys: receipt content_hash (entailment results cached per claim_version × receipt_hash), register prefix, transcripts by media sha256.

**8.5 Failure modes and fallbacks**

| Failure | Detection | Fallback |
|---|---|---|
| No sources found for a claim | Pass 2 returns 0 receipts after saturation | Claim → `insufficient_evidence`. Script may say only "We could not find…". Chat suggests user-library upload |
| Paywalled source | fetch status / paywall flag | Ask user for PDF. Else cite with "paywalled" note and no quote |
| Deleted source | 404 or availability check | Use archive copy if one exists (capture date recorded). Else downgrade to `contested` and disclose |
| Conflicting transcripts (platform vs ASR) | word diff >5% on quote span | Mark quote `needs_rehear`. Block export until the user re-hears |
| ASR failure / hallucination | low confidence, long non-speech segments (where hallucinations cluster), or run-to-run disagreement\[31\]\[32\] | Re-transcribe with a second engine or setting. Require human re-hear for quotes |
| User abandons mid-pipeline | inactivity | State persisted. Resume card on return. Archive after 30 days |
| All verdicts unsupported | ≥80% of the hypothesis claims refuted/insufficient | Stop scripting. Chat offers "The evidence points the other way: reframe hypothesis?" (never force the original stance) |
| Legal red flag (allegation of crime, clinical label, minor, sealed proceedings, private info) | lint + overclaim + red-line rules | Hard block on export until the user resolves or acknowledges. Generates a "right of reply" task: contact the subject, log the date and response |
| Budget hit | cost meter | Pause, show remaining work and cost to finish |
| Provider outage/rate limit | 429/5xx | exponential backoff, resume per item |

---

## 9. Handoff package

**9.1 How agents consume this spec (from Anthropic's Claude Code docs)**
- "Give Claude a check it can run: tests, a build, a screenshot to compare."\[33\] Every ticket below ships with a runnable check.
- Explore → Plan → Implement → Commit. Use plan mode for multi-file tickets.\[33\]
- CLAUDE.md is loaded every session, so keep it short. For each line ask "Would removing this cause Claude to make mistakes?" Put occasional domain knowledge in **skills** (`.claude/skills/*/SKILL.md`). Put must-always-happen rules in **hooks** (deterministic, unlike advisory CLAUDE.md).\[33\]
- The most useful specs "name the files and interfaces involved, state what is out of scope, and end with an end-to-end verification step." Start a fresh session per ticket.\[33\]
- Guidance is changing quickly (versioned features such as auto mode, `/goal`). Re-check the docs when you set up.

**9.2 Recommended CLAUDE.md outline (≤150 lines)**
1. Product in 3 lines + glossary (Brief, Hypothesis, Claim Map, Receipts, Verdicts, Spine, Script, Clip Plan, Pull List, Take, ChangeCard).
2. Commands: build, test, lint, eval-fast, eval-golden (fill in from the existing repo).
3. Architecture boundaries: passes are pure functions of versioned inputs. UI never calls models directly. All model calls go through one router module.
4. IMPORTANT rules: never mutate artifacts in place. Never ship a quote that is not `verified_*`. Never download from YouTube. No LLM-as-judge for naturalness. One rewrite then stop.
5. Testing: fixtures in `/fixtures/golden/*`. Every pass has contract tests.
6. Pointers: `@docs/spec.md` (this file), `@docs/data-model.md`, `@docs/prompts/register.md`.
7. Known gotchas (append as found).
- Skills: `register-lock` (prompt assembly), `linter-rules`, `media-export`, `legal-redlines`. Hooks: run unit tests + linter after edits; block writes to `/fixtures/golden` without a flag.

**9.3 Tickets** (each: acceptance criteria = runnable tests; "→" = depends on)

| ID | Ticket | Acceptance criteria | Deps |
|---|---|---|---|
| T0 | Reconcile audit of the existing repo (read-only) | Produces `docs/reconcile.md` answering §11 checklist | — |
| T1 | Data model + migrations/schema for §4 entities with versioning | CRUD + version + supersede tests pass. AuditEvent append-only enforced | T0 |
| T2 | Pass runner: idempotency key, item-level resume, state machine §3 | Same key → 0 model calls. Kill mid-run → resume completes. Illegal transitions rejected | T1 |
| T3 | Model router + cost meter + cache keys | Per-pass tier config. Budget cap pauses run. Cache hit test | T2 |
| T4 | Chat intake → Brief (+ voice intake transcription) | Fixture chat → Brief with all fields. Stance rewritten as hypothesis | T2 |
| T5 | Pass 1 Claim Map + Gate 1 API | Golden claim recall ≥0.80 (nightly). Mirrored queries 100% | T3,T4 |
| T6 | Pass 2 Receipts (user library first, saturation stop) | Saturation rule unit-tested. Symmetry metric reported | T5 |
| T7 | Pass 3 entailment + verdict matrix + Gate 2 | Entailment ≥0.85 on golden. Override marks downstream stale | T6 |
| T8 | Receipt Talk interview capture + transcription + span store | Spans retrievable with timings. Skip → fallback flag set | T7 |
| T9 | Deterministic linter §5.4 + VoiceProfile + blend logic | Unit tests per rule with fixtures. Blend switches at 1,500/5,000 words | T1 |
| T10 | Pass 4 Spine & Script assembly (origin-tagged spans, bridges ≤25 words) | Origin share computed. ≥80% on golden interview projects. One-rewrite-then-stop enforced | T8,T9 |
| T11 | Five checks | Seeded unsupported/overclaim fixtures all caught | T10 |
| T12 | Editor shell: SAID/SHOW block timeline, chat rail | Screenshot tests vs design. Keyboard and touch reorder | T1, Design D1 |
| T13 | Document block renderer (highlight, hold formula, lower-third) | Hold = max(2, chars/17+1) ≤7 unit test. Render snapshot | T12 |
| T14 | RecordingJob + record block + flub detection | Seeded flub audio → last clean read kept ≥95% | T12 |
| T15 | Forced alignment + per-block clips + mismatch exceptions | Boundary error ≤200 ms ≥90% words. Mismatch message lists exact lines | T14 |
| T16 | Pull List + Gate 3 + provenance attestation; placeholder card renderer | No `ready` clip without attestation. Placeholder renders | T10 |
| T17 | Verification sweep (re-hear UI, statuses, export block) | Export blocked while any quote unverified | T15,T16 |
| T18 | Audio chain: denoise, duck, loudness | Output −14±1 LUFS, ≤−1 dBTP on fixtures | T15 |
| T19 | Captions from aligned SAID | ≤42 chars, ≤2 lines, ≤17 cps, durations in range | T15 |
| T20 | Rough-cut render + export QC (§6.6) | ffprobe-style checks pass on fixture | T13,T18,T19 |
| T21 | Description/chapters/sources page/attribution generator | Chapter validator (00:00, ≥3, ≥10 s). Attribution per clip | T20 |
| T22 | Refinement passes as ChangeCards (max 3) | 4th pass refused. Each card has diffs and accept/reject | T11 |
| T23 | Golden-set eval harness + CI wiring | `eval-fast` on commit, `eval-golden` nightly, report artifact | T5–T11 |
| T24 | YouTube upload (optional) | Uses OAuth. Uploads private/unlisted. Respects quotas (`videos.insert` own bucket 100/day; captions.insert 400 units; thumbnails.set 50)\[3\]\[34\] | T21 |
| T25 | Security/observability basics (§10.3) | Encrypted storage test, structured logs with pass_id | T1 |

**9.4 Claude Design brief**

*Principles:* chat-first. Gates and change cards are phone-first. The editor is desktop-first (mobile is read and record only). Provenance is always visible: span colour by origin (user / quote / LLM). Evidence status badges everywhere.

| # | Screen | Key components | States |
|---|---|---|---|
| D1 | Editor (SAID column ‖ SHOW column ‖ block timeline ‖ chat rail) | BeatRow, SpanChip (origin colour), LintFlag tag, BlockThumb, TimelineTrack, ChatRail | empty project, script generating (skeleton rows), stale beats, lint flags, offline |
| D2 | Chat intake | Message list, voice button, Brief card | first run, recording, transcription failed |
| D3 | Processing view | Pass progress list, per-claim counters, cost meter, pause | running, paused, blocked, budget hit, error w/ retry |
| D4 | Gate 1 Claim Map | ClaimCard (side, type, rank), approve/edit | loading, <6 claims warning |
| D5 | Gate 2 Verdict matrix / cards | Matrix grid (desktop), swipe cards (mobile), override sheet | all-unsupported prompt, insufficient evidence |
| D6 | Receipt Talk | Receipt viewer, big record button, timer (30–120 s guide), skip | mic denied, too quiet, silence detected |
| D7 | Record block | Current line large, next dimmed, level meter, chunk progress | flub detected, mismatch, advance manual |
| D8 | Inline record card (chat) | One-line prompt, record, playback | |
| D9 | Pull session (Gate 3) | PullItem card: supply file / keep placeholder / drop, attestation checkbox | upload failing, unsupported format |
| D10 | Verification sweep | Checklist, audio re-hear player with context span | all clear, blocking items |
| D11 | ChangeCard | Title, ≤280-char summary, diff, accept/reject/partial | |
| D12 | Export & publish | Preset, QC results, description/chapters editor, disclosure toggle, sources page preview | QC fail, rendering, done |
| D13 | Voice profile / onboarding | Word-count progress to 1,500 / 5,000, metric sparkline, overrides | cold start |
| D14 | Projects home | Project cards with state + resume | empty, archived |

Deliverable from Claude Design: handoff bundle per screen group (D1–D3 first), including empty/loading/error states and 390-px mobile variants for D2, D4, D5, D6, D8, D9, D11. Claude Design went into research preview on 17 April 2026 for Pro, Max, Team and Enterprise users. Per EdTech Innovation Hub, it "packages outputs into a handoff bundle that can be passed directly to Claude Code." Reports say it was folded into the main Claude app in September 2026 and that a design-system sync command exists.\[35\]\[36\] Treat bundle format and commands as changing and verify on the day.

---

## 10. MVP slice and milestones

**10.1 MVP (vertical slice, one project end-to-end):** T0–T17 + T20 minus polish. Brief → Claim Map (G1) → Receipts (user library + web text only) → Verdicts (G2) → Receipt Talk → Script with linter and five checks → one-take VO with alignment → rough cut with Document blocks, text cards, lower-thirds and placeholder clip cards → verification sweep → MP4 + SRT. **Done when:** one golden investigative project goes from Brief to exported MP4 with every shipped quote verified, origin share ≥80%, and no manual file surgery.

**10.2 Milestones**

| M | Scope |
|---|---|
| M1 | MVP above |
| M2 | Audio chain (T18), captions (T19), description/chapters/sources page (T21) |
| M3 | Refinement ChangeCards (T22), golden harness in CI (T23) |
| M4 | Charts/timelines/maps from data, music library integration, thumbnail variants |
| M5 | YouTube upload (T24), Test & Compare workflow, analytics read-back |

**10.3 "Works out of the box" basics:** encrypt media at rest. Signed, expiring URLs. No third-party training on user media (check provider terms). Per-provider rate-limit backoff. Structured logs keyed by project_id/pass_id. Cost dashboard. Nightly backup of artifacts and media manifest (sha256). Retention setting for raw interview audio. Export-all (project zip).

**10.4 Non-goals (MVP):** free-form NLE trimming, multi-user collaboration, stock b-roll search, generative video/imagery, voice cloning, auto-publishing, Shorts, translation/dubbing, LLM-as-judge naturalness scoring, more than 3 refinement passes, any YouTube download path.

---

## 11. Open decisions (user only) and reconcile checklist

**User decisions**
1. Clip acquisition beyond the compliant default: will you use clips obtained outside YouTube's authorized features or written permission? (Contract/ToS risk is separate from copyright fair dealing.)
2. Budget cap per project (default $25 LLM) and ASR engine (local vs hosted).
3. Whether "prefer what I said" auto-updates SAID by default.
4. Raw interview audio retention period.
5. Whether to enable AI-generated imagery at all (it triggers the disclosure toggle).

**Questions for a Canadian media lawyer**
- Does using a clip under s.29.1 fair dealing survive a platform-ToS breach in how it was obtained? Which acquisition routes do you approve?
- Is our attribution format (source + author/performer/maker/broadcaster) sufficient on screen, in the description, or both?
- For psychology-of-public-figure content: what wording keeps commentary within fair comment (WIC Radio) and avoids implied diagnosis?
- What "right of reply" steps make the responsible-communication defence (Grant v. Torstar) realistic for a solo YouTube journalist, and how long to wait for a response?
- Corrections/takedown policy wording, and Quebec/out-of-province exposure.

**Reconcile-with-existing-code checklist (T0 output)**
- [ ] Where do projects, versions and the audit log live now? Can they support immutable versions + supersede?
- [ ] Is there a job/queue runner? Does it support idempotency keys and item-level resume?
- [ ] Is there a single model-call module to become the router? Where are prompts stored?
- [ ] Existing timeline/block model: map to §4 Block types. List gaps.
- [ ] Existing chat UI: can it render cards (Brief, ChangeCard, record card)?
- [ ] Audio stack: capture sample rate (target 48 kHz), alignment tool, loudness meter present?
- [ ] Render path: can it hit the §6.6 preset? Where do captions come from today?
- [ ] Any code that downloads from YouTube → flag for removal or gating.
- [ ] Auth, storage encryption, backups, logging: present or missing.
- [ ] Test runner and fixtures location. CI present?
- [ ] Naming collisions with the glossary (e.g., existing "Clip", "Segment").

---

## 12. What the evidence does not support (folklore vs measured)

| Claim | Status |
|---|---|
| "3–5 s per shot" for essay channels | [F] No measurement found. Measure with scene detection before encoding a rule |
| "−14 LUFS is YouTube's spec" | [F as a spec] No primary Google doc found. Third-party tests show YouTube turns loud audio down and leaves quiet audio quiet\[8\]\[37\] |
| "Upload = 1,600 quota units, ~6/day" | Out of date. Google's docs: Dec 2025 cut to ~100 units, June 2026 own bucket of 100 calls/day at 1 unit each. The calculator's own summary box still says 1,600\[2\]\[34\] |
| "Netflix 17–20 cps" as one number | Imprecise: 20 adult, 17 children\[6\] |
| Whisper "~1% hallucination" as a current rate | [M, dated] Koenecke et al., "Careless Whisper" (ACM FAccT '24): "1.4% of audio segments yielded a hallucination sequence" in April–May 2023 tests on AphasiaBank speech, and "38% contain at least one of these types of harms". Hallucinations were more frequent with long pauses. Current models may differ. Re-measure on your own audio |
| Ideal video-essay length (15–25 min etc.) | [F] Creator-blog claims without disclosed data\[38\]\[39\]\[40\] |
| Question/teaser titles underperform | Carried from prior reports and not re-verified here. Upworthy-based studies measure CTR, not watch time, and part of that archive (about 22% of tests, June 2013–Jan 2014) has a known randomization flaw\[41\] |
| Linter thresholds (em-dash ≤3/1k, etc.) and switch points (1,500/5,000 words) | [I] Engineering defaults. Tune on the golden set |
| Cost/latency figures in §8.4 | [I] Estimates from third-party price lists. Re-price on setup |
| 165 wpm, 12–18 words/sentence | [M] from a small sample of channels (R1). Defaults, not truths |

## Sources

1. [Terms of Service - YouTube](https://kids.youtube.com/t/terms)
2. [Revision History | YouTube Data API | Google for Developers](https://developers.google.com/youtube/v3/revision_history)
3. [Videos: insert](https://developers.google.com/youtube/v3/docs/videos/insert)
4. [Canadian Copyright Law Q&A](https://www.transformativeworks.org/canadian-copyright-law-qa-part-1/)
5. [Overview of the Fair Dealing Exception - Copyright Information for Students - Research Guides at Queen's University Library](https://guides.library.queensu.ca/copyright/students/fairdealing)
6. [Subtitle Reading Speed: CPS & WPM Limits Explained (2026)](https://www.closedcaptioncreator.com/blog/articles/subtitle-reading-speed.html)
7. [Subtitle Reading Speed (CPS): The Limits, and Why AI Subtitles Break Them - DEV Community](https://dev.to/ray_mac/subtitle-reading-speed-cps-the-limits-and-why-ai-subtitles-break-them-892)
8. [YouTube Loudness Standards 2026: What LUFS Should You Target?](https://audio.rswaver.com/blog/youtube-loudness-standards)
9. [YouTube Loudness Normalization — Target LUFS for Video](https://www.criticallisteninglab.com/en/learn/loudness/youtube)
10. [How to Normalize Audio on YouTube (Step-by-Step Guide)](https://store.hollyland.com/blogs/creator-hub/normalize-audio-on-youtube)
11. [YouTube AI Content Disclosure Rules 2026: Complete Creator Guide](https://shortsfast.com/blog/youtube-ai-content-disclosure-rules-2026/)
12. [YouTube says it will require creators to label 'realistic' AI content](https://www.nbcnews.com/tech/tech-news/youtube-says-will-require-creators-label-ai-content-rcna143937)
13. [Copyright Free Music YouTube Audio Library: 2026 Guide - Foxi Blog](https://www.foximusic.com/blog/copyright-free-music-youtube-audio-library-guide/)
14. [Use music and sound effects from the Audio Library - YouTube Help](https://support.google.com/youtube/answer/3376882?hl=en)
15. [Broadcasting Regulatory Policy CRTC 2019-308](https://crtc.gc.ca/eng/archive/2019/2019-308.htm)
16. [Closed Captioning Standards and Protocol for Canadian ...](https://assets.corusent.com/wp-content/uploads/2021/10/Closed_Captioning_Standards_Protocol.pdf)
17. [YouTube recommended upload encoding settings - YouTube Help](https://support.google.com/youtube/answer/1722171?hl=en)
18. [YouTube Video Format: Best Upload Settings (MP4, Resolution, Ratio)](https://www.hypescribe.com/blog/format-for-youtube)
19. [Encoding YouTube Videos at the Highest Quality - Videomaker](https://www.videomaker.com/article/c05/17034-encoding-youtube-videos-at-the-highest-quality/)
20. [YouTube A/B Testing: Test & Compare Thumbnails](https://vidiq.com/blog/post/youtube-launches-new-thumbnail-testing-tool/)
21. [YouTube Thumbnail A/B Testing: How Test & Compare Works](https://blog.autonolab.com/blog/2025-09-25-thumbnail-testing-a-b-testing-visual-packaging/)
22. [Video Chapters - YouTube Help](https://support.google.com/youtube/answer/9884579?hl=en)
23. [Word-level timestamps from WhisperX are inaccurate compared to Montreal Forced Aligner (MFA) · Issue #1247 · m-bain/whisperX](https://github.com/m-bain/whisperX/issues/1247)
24. [Wrong word-level timestamps in force-alignment starting from version 3.3.3 · Issue #1220 · m-bain/whisperX](https://github.com/m-bain/whisperX/issues/1220)
25. [Anthropic API Pricing 2026: Claude Model Costs and Savings](https://fast.io/resources/anthropic-api-pricing-guide/)
26. [Claude API Pricing 2026: Opus 4.8, Sonnet 4.6, Haiku 4.5 Costs](https://www.metacto.com/blogs/anthropic-api-pricing-a-full-breakdown-of-costs-and-integration)
27. [Anthropic API Pricing 2026: Official Token Rates for Every Claude Model](https://pecollective.com/tools/anthropic-api-pricing/)
28. [Claude API Pricing (October 2026): \$1–\$50 per 1M Tokens](https://benchlm.ai/anthropic/api-pricing)
29. [Anthropic Claude prompt caching pricing: write, read, TTL math](https://technspire.com/en/blog/anthropic-prompt-caching-pricing-mechanics)
30. [Claude Sonnet 4.6 Pricing Explained — Caching, Tiers, and How to Save 45% with Crazyrouter - Crazyrouter](https://crazyrouter.com/en/blog/claude-sonnet-4-6-pricing)
31. [Careless Whisper: Speech-to-text Hallucination Harms](https://montrealethics.ai/careless-whisper-speech-to-text-hallucination-harms/)
32. [Careless Whisper: Speech-to-text Hallucination Harms Overview](https://koenecke.infosci.cornell.edu/files/CarelessWhisper_ExtendedAbstract.pdf)
33. <https://code.claude.com/docs/en/best-practices>
34. [Quota Calculator | YouTube Data API | Google for Developers](https://developers.google.com/youtube/v3/determine_quota_cost)
35. [September 2026 Update: Claude Design Now Lives Inside Claude. What's Next?](https://www.magicpatterns.com/blog/claude-design-now-lives-inside-claude)
36. [Claude Design Learns Your Brand and Hands Off to Claude Code - Design system imports, two-way /design-sync, WYSIWYG canvas editing, and direct Claude Code handoff are now live in beta on Pro and above — Vibe Coder Blog](https://blog.vibecoder.me/claude-design-system-sync-code-handoff)
37. [Youtube Loudness Normalization](https://siggidori.wixsite.com/skonrokk-studios/single-post/2017/03/28/youtube-loudness-normalization)
38. [The Ultimate Video Essay Checklist ✓](https://www.matrix.edu.au/the-ultimate-video-essay-checklist/)
39. [What Is the Ideal YouTube Video Length?](https://shortsninja.com/blog/ideal-youtube-video-length/)
40. [How Long Should Your YouTube Videos Be? - Hook Lab](https://hooklab.co.uk/blog/how-long-should-your-youtube-videos-be)
41. [TEA-Time: Transporting Effects Across Time](https://arxiv.org/pdf/2603.07018)
