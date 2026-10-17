# Aldershot Edit-Plan Research Pass: What to Steal, What's Verified, What to Fix

**Bottom line: keep the edit-plan direction, but build it as video-use's text-first architecture plus a typed, recipe-bearing plan that exports to OpenTimelineIO. The newest independent benchmark shows that agents still fail mostly on craft, not mechanics, so Aldershot's real edge has to come from deterministic recipes, verifiable reviewers and human locks, not from a smarter planner.** On Timeline-Bench (Sept 2026), the best coding agent resolved 15 of 56 real editing tasks (26.8%) and the average agent resolved 14.0%. Of the 771 unresolved runs, 562 failed only the quality test, because "agents perceive footage through stills and transcripts and check their renders for defects, not craft."\[1\]

## TL;DR
- **Steal first:** video-use (MIT) for its agent loop, cut-boundary self-check and session memory. Add OpenTimelineIO (Apache-2.0) as the canonical export, TransNetV2 (MIT) and PySceneDetect (BSD-3) for shots, Beat This (MIT code *and* weights) for beats, WhisperX (BSD-2-Clause) for word timing, and Lighthouse (Apache-2.0) for query-to-moment retrieval. **Avoid or isolate:** madmom's model weights (CC BY-NC-SA, so allin1 inherits the risk), videogrep (its pyproject declares an "Anti-Capitalist" licence even though conda lists it as MIT),\[2\]\[3\] CutClaw (no LICENSE file),\[4\] Remotion once Aldershot has 4+ people (Remotion's licence page requires a Company License from that size), and auto-editor's newer licence-key gating.
- **Evidence corrections:** LAVE's user study had **8** participants; the 110 belongs to B-Script. TransNet V2 is *not* best on RAI: it ties Hassanien et al. at 93.9, and the original TransNet scores 94.3. Beat This on GTZAN scores beat F1 ≈89.1 and downbeat F1 ≈78.3, not 89.5–97.5 and 79.6. The 80 ms beat tolerance and 0.5 s minimum hold have **no direct measured support**. Beat trackers are themselves scored with tolerance windows of tens of ms, so snap cuts to the frame and measure.
- **Schema:** keep a rich internal plan (blocks → recipe + params + locks + receipts). Compile it deterministically to an OTIO Timeline, with Aldershot data namespaced in `metadata["aldershot"]` and receipts as Markers. Treat FCPXML and EDL as lossy downstream adapters; the otio-fcpx-xml-adapter feature matrix marks both linear and "fancy" speed effects as unsupported.

## Key Findings

### (a) Ranked steal list

| # | Project | Category | License | Runtime | What to take | Risk |
|---|---|---|---|---|---|---|
| 1 | **browser-use/video-use** (≈27.9k★, 3.3k forks, 22 commits, last push ~Jul 2026)\[5\]\[6\] | Agent editor (Claude Code skill)\[7\] | MIT | Python, ffmpeg, ElevenLabs API key for transcription\[8\] | Architecture: "The LLM never watches the video". The agent works from a transcript plus a few PNGs. Also take 30 ms audio fades at every cut, self-evaluation of the render at every cut boundary, session memory in `project.md`, and parallel sub-agents per animation overlay.\[6\] Read SKILL.md and helpers/ as prompt and craft references.\[5\] | Young repo (22 commits, 112 open PRs).\[6\] The ElevenLabs dependency is a vendor lock. Its "self-eval" checks defects, which Timeline-Bench shows is not enough. |
| 2 | **OpenTimelineIO** (ASWF) | Timeline interchange | Apache-2.0 | Python/C++ | Canonical export. `.otio` is the only lossless format.\[9\] Use namespaced `metadata` dicts, `Marker`, `Gap`, `Stack`, `LinearTimeWarp` and `FreezeFrame`, plus the adapter plugin system. | Adapters are lossy. The otio-fcpx-xml-adapter feature matrix marks both "Linear Speed Effects" and "Fancy Speed Effects" as unsupported, and the FCP7 adapter (otio-fcp-adapter) marks "Audio/Video Effects" as unsupported. |
| 3 | **soCzech/TransNetV2**\[10\] | Shot boundaries\[10\] | MIT (code). A third-party PyTorch weights port is labelled Apache-2.0\[10\]\[11\] | Python, TF (PyTorch ports exist), GPU optional\[12\] | Shot boundaries for the footage log. F1 is 77.9 on ClipShots, 96.2 on BBC and 93.9 on RAI (measured, repo).\[10\] | Trained on synthetic plus ClipShots data. On ice hockey and soccer broadcasts, the SportSBD paper (ACM) found its fine-tuned R(2+1)D model "consistently achieves higher precision, recall, and F1-score" than its TransNetV2 and PySceneDetect baselines. |
| 4 | **Breakthrough/PySceneDetect** | Shot boundaries / cut-rate metric\[13\] | BSD-3-Clause\[13\] | Python, OpenCV, CPU\[14\] | Cheap CPU fallback. Its AdaptiveDetector is what Timeline-Bench's quality judges use to compute cuts per minute, so reuse it for the reviewer's pacing stats.\[15\] | Weaker on gradual transitions (inference). |
| 5 | **CPJKU/beat_this** (ISMIR 2024)\[16\] | Beats/downbeats | MIT for code **and** weights\[16\] | Python, PyTorch. A C++ port exists\[17\] | Beat and downbeat grid for montage recipes, with no DBN post-processing.\[18\]\[19\]\[20\]\[21\] | The README warns that some *training data* is under limited CC licences, so users must assess that themselves.\[21\] A non-commercial claim in an unrelated README contradicts the official one; trust the official.\[22\] |
| 6 | **m-bain/whisperX** | Word-level ASR/alignment | BSD-2-Clause (code), per the m-bain/whisperX LICENSE file ("BSD 2-Clause License, Copyright (c) 2024, Max Bain") and pyproject. pyannote weights gated on HF | Python, GPU recommended, wav2vec2 alignment | Word timestamps for supercut, clip-gap and anchored narration. At a 200 ms collar, word-segmentation precision/recall is 93.2/65.4 on Switchboard and 84.1/60.3 on AMI (measured, paper via secondary).\[23\] | Alignment degrades in noise: F1 drops 76.7→59.0 on noisy synthetic speech at a 0.2 s collar (CrisperWhisper paper).\[24\] The pyannote gating adds a terms acceptance. |
| 7 | **line/lighthouse** (EMNLP 2024 demo) | Moment retrieval / highlight detection | Apache-2.0 (code)\[25\] | Python, PyTorch, CLIP/SlowFast features, GPU | One API across 7 DETR-family models (Moment-DETR, QD-DETR, CG-DETR, UVCOM…) for "footage query → time span", plus audio moment retrieval.\[26\] | Pretrained weights are trained on research datasets (QVHighlights etc.), so check dataset terms before commercial use (inference, unverified). Its own finding: newer methods "do not consistently outperform older ones."\[27\] |
| 8 | **Zulko/moviepy**, **mifi/editly**, **redotvideo/revideo** | Programmatic composition | MIT / MIT / MIT\[28\]\[29\]\[30\] | Python / Node+ffmpeg / TS+browser\[31\]\[32\] | editly: a JSON-spec-to-video renderer, a good shape reference for a deterministic assembler.\[33\] Revideo: a fully MIT TypeScript alternative to Remotion for motion graphics.\[31\] | Revideo's repo may have moved (also appears as midrender/revideo).\[31\]\[34\] Check maintenance. |
| 9 | **Remotion** | React video composition | Source-available. Per Remotion's License & Pricing page, it is free for individuals and orgs of up to 3 people, and "companies of 4+ people" need a Company License. "Remotion for Automators" costs $0.01 per render with a $100/mo minimum and covers "video editors, prompt-to-video apps, and embedding the Remotion Player"; Enterprise starts at $500/mo | Node, headless Chrome | Overlays and titles (video-use already spawns Remotion/HyperFrames).\[5\] | **Licence trap on growth.** Aldershot is a hosted video editor, exactly the use the Company License targets once it exceeds 3 people.\[35\] |
| 10 | **WyattBlue/auto-editor** (≈5.4k★) | Silence/dead-space cutting | Unlicense (source)\[36\] | Now Nim, ffmpeg | Loudness/motion-threshold silence detection logic as a reference.\[37\] | Recent releases (31.x, Jul 2026) gate higher resolutions and multi-source timeline exports behind a licence key. Binary artifacts may carry other licences, so vendor the source, not the binaries.\[36\]\[38\] |
| 11 | **mir-aidj/all-in-one** (allin1, ≈793★, last update May 2024) | Music structure (sections, beats, BPM) | MIT (code) | Python, PyTorch, Demucs, NATTEN, **madmom** | Section labels (intro/verse/chorus) for recap and cold-open recipes. A documented tip: convert MP3→WAV first to avoid 20–40 ms offsets.\[39\]\[40\] | Depends on madmom, whose **models are CC BY-NC-SA 4.0**. The fork all-in-one-infer swaps in a pure re-implementation (madmom-infer), but it still needs a licence review. Dependency breakage is reported.\[41\]\[42\]\[43\] |
| 12 | **GVCLab/CutClaw** (arXiv 2603.29664)\[44\] | Music-synced agentic editing\[44\] | **No LICENSE file** (all rights reserved by default). Paper is CC BY-NC-SA 4.0\[4\]\[45\]\[46\] | Python, multiple MLLMs\[4\]\[44\] | *Ideas only*: Playwriter (music-anchored plan) → Editor (hierarchical grounding) → Reviewer (multi-criteria validity gate), plus the joint objective visual + narrative + instruction + sync.\[44\]\[46\] | Do not copy code. |
| 13 | **antiboredom/videogrep** (≈3.5k★)\[47\] | Supercut | **Conflict:** pyproject says "Anti-Capitalist", conda-forge says MIT\[2\]\[3\] | Python, MoviePy, Vosk\[47\] | The concept and the n-gram / part-of-speech search ideas only.\[48\]\[49\] Re-implement supercut on top of WhisperX word timings. | Anti-Capitalist licensing is incompatible with a commercial product. Do not vendor. |
| 14 | **abedavis/visbeat** (Davis & Agrawala 2018)\[50\] | Visual-beat warping | **Unverified** ("Stanford" licence per a replicability index)\[51\] | Python | The algorithm idea: visual beats from motion and warping into musical beats.\[52\] | Treat as non-commercial until the LICENSE text is read. |
| 15 | madmom (CPJKU) | Beat/onset DSP | BSD code, **CC BY-NC-SA 4.0 models**\[53\] | Python, Cython | DSP utilities only. | **Model-weight trap.** The CPJKU/madmom_models README says "pickled madmom Processors using any of the files included in this repository inherit the above license", and for commercial use the madmom README says to "contact Gerhard Widmer". PyPI classifies it as "Free for non-commercial use". |

Not verified this pass, so do not cite as facts: EditDuet code availability, LAVE code availability, "VideoAgent (2026)" (the name is ambiguous, with several projects), Shotstack's JSON schema details, the internal format of video-use's EDL, and the motion-canvas licence (MIT today, but a GPL switch was proposed in a discussion).\[54\]\[55\]

### (b) Corrections to the edit-plan evidence

| Draft claim | Verdict | Corrected statement | Label |
|---|---|---|---|
| Write-A-Video (SIGGRAPH Asia 2019) | ✅ Confirmed | Wang, Yang, Hu, Yau, Shamir, ACM TOG 38(6) Art. 177. Assembly is a "hybrid optimization problem over a graph of shots" with cinematography metrics and user-chosen idioms. The authors generated 20 montages and ran an inexperienced-user study.\[56\]\[57\]\[58\] | Documented |
| Leake et al. idiom-based editing (SIGGRAPH 2017) | ✅ Confirmed + detail | TOG 36(4) Art. 130. **Each idiom is a Hidden Markov Model.** Scenes are under 2 min, 8–16 takes and 6–27 lines, and an edit generates in 2–3 s.\[59\]\[60\] This is the closest precedent for Aldershot's "named recipe with params". | Measured (runtime) |
| B-Script (CHI 2019, 110 participants) | ✅ Confirmed | Huber, Shin, Russell, Wang, Mysore (Adobe). Within-subject study, N=110, comparing timeline, transcript, and transcript+recommendations interfaces. Transcript was easier and faster, and recommendations produced "more engaging" videos. The recommender was trained on expert-annotated data.\[61\]\[62\] | Measured |
| LAVE (IUI 2024) | ⚠️ Correct the N | **8 participants** (novice to proficient), not 110. All 8 produced satisfactory videos with low frustration (mean 2, SD 1.3). Users could act through the agent *or* direct manipulation.\[63\]\[64\] | Measured (small N) |
| TransNet V2 F1 96.2 BBC / 93.9 RAI / 77.9 ClipShots | ✅ Numbers right, ⚠️ framing | On RAI it is *not* best: it ties Hassanien et al. (93.9), and the original TransNet scores 94.3. It is best on ClipShots (next best 76.1) and BBC (next best 92.9). It uses a fixed 0.5 threshold.\[65\]\[66\]\[67\] | Measured |
| Beat F1 ~89.5–97.5, downbeat ~79.6 GTZAN | ⚠️ Correct | Beat This on GTZAN: beat F1 **89.1**, downbeat F1 **78.3** (AlignBeat reproduces the paper's figures to within 0.07).\[68\] The 97.5 upper bound is not supported for GTZAN; it may come from in-domain test sets. Beat Transformer and BeatFM numbers were not verified this pass. | Measured |
| Davis & Agrawala, Visual Rhythm and Beat | ✅ Confirmed | SIGGRAPH 2018,\[50\]\[51\] TOG 37(4). Visual beats from motion analysis are warped into alignment with musical beats.\[52\]\[69\] It is a retiming technique, not a cut-placement rule. | Documented |
| EditDuet | ✅ + numbers | SIGGRAPH 2025 (Adobe Research + collaborators), Editor + Critic agents, on EditStock documentary footage, B-roll task.\[70\]\[71\] Failure rate is 8.2% (19.5% without exploration), time coverage 89.8%, repetitions 0.174.\[72\]\[73\] **Professional cuts were still preferred over EditDuet 75.1% of the time** (and over BAGEL 96.6%).\[74\] | Measured |
| CutClaw (2026) | ✅ Exists + caveats | arXiv 2603.29664, 31 Mar 2026, Zhao, Hu, Shan, Wei, Cun (Great Bay Univ / Tencent ARC). Playwriter / Editor / Reviewer.\[44\]\[75\] A secondary summary reports beat–cut offsets of Δt≤0.1 s, which I could not verify from the paper text read.\[76\] Later work (BEAT, arXiv 2605.27067) criticises it as a "black-box agentic system" and grounds alignment in a trained model instead.\[77\] | Documented; number secondary |
| VideoAgent (2026) | ❓ Unverified | The name is ambiguous. Do not cite until the specific paper is pinned. | — |
| Walter Murch "Rule of Six" | ⚠️ Heuristic | A practitioner heuristic from *In the Blink of an Eye*, not a measured result. Use it as reviewer vocabulary, not as a scoring weight. | Inference |
| video-use (Claude Code + transcripts + EDL) | ✅ Confirmed | MIT, about 27.9k★. Text-first: transcripts plus PNGs. Self-evaluates at every cut boundary.\[6\]\[78\]\[79\] | Documented |
| **NEW – strongest evidence:** Timeline-Bench (arXiv 2609.35143, 28 Sep 2026) | Add | 56 real tasks (33.0 h of source footage), 16 agents including Claude Code. Best 26.8%, average 14.0%. Editors preferred the reference in 83.5% of 2,582 blind judgments by 43 editors. 1,909 words of curated editorial guidance (SKILL.md) helped the top agent. It is a preprint by a company (TensorTest/Ritivel Labs), under review.\[1\]\[15\] | Measured |
| **80 ms beat tolerance, 0.5 s min hold** | ❌ Unsupported | No source measured perceptual tolerances for cut-to-beat offsets or minimum shot holds. Context: WhisperX word timing is evaluated at a 200 ms collar, so speech-anchored cuts carry about ±100 ms or more of label uncertainty.\[23\] Beat trackers are scored with tens-of-ms windows. A 30 fps frame is 33 ms, so 80 ms is about 2.4 frames. | Inference |

### (c) Recommended edit-plan schema mapping

Design rule: **the plan is the source of truth; OTIO is the compiled, exportable artifact.** Never let an NLE format be the internal model, because every adapter except `.otio` is lossy.\[9\]

| Plan field | Internal representation | OTIO mapping | FCPXML / CMX3600 EDL fallback |
|---|---|---|---|
| Block (purpose, duration target) | `block{id, purpose, target_dur, tolerance}` | `Stack` or a contiguous run of Clips/Gaps; `metadata.aldershot.block` | FCPXML compound clip / EDL comment line |
| Recipe + params | `recipe{name:"montage", version, params{beat_source, cut_on:"downbeat", min_hold_s, max_hold_s}}` | `metadata.aldershot.recipe` on the Stack. Store **the recipe version** so re-assembly is reproducible | Lost (bake the result) |
| Picture (specific or query + scene role) | `picture{asset_id, src_in, src_out}` or `{query, scene_role, retrieval_scores[]}` | `Clip.media_reference` + `source_range`. Keep the query and the top-k candidates in `metadata.aldershot.retrieval` | Clip only |
| Narration (style + text / cue card) | `narration{style: scripted|freestyle|anchored, text, cue, take_id, alignment}` | Separate audio `Track` (kind Audio). Word alignment goes in metadata | Separate audio track |
| Audio (music cue, ducking, SFX) | `audio{music_cue, beats_ref, duck_db, sfx[]}` | Audio Tracks. Ducking as `Effect(effect_name="aldershot.duck")` with params in metadata | Usually lost, so bake ducking in the mix |
| On-screen text | `text{template, content, style_ref}` | Clip with `GeneratorReference`, or `Effect` + metadata | FCPXML title; EDL lost |
| Transitions | `transition{type, dur}` | `Transition` | Supported basics |
| Speed ramp / freeze | `time{type: linear|ramp|freeze, …}` | `LinearTimeWarp` / `FreezeFrame`.\[80\] Ramps are **not** native, so store them in metadata and bake the render | The otio-fcpx-xml-adapter marks both linear and "fancy" speed effects unsupported |
| Receipts / provenance | `receipts[{claim_id, source_url, quote, verdict}]` | `Marker` per receipt over the relevant range, with the receipt in `marker.metadata.aldershot` | FCPXML markers; EDL `* COMMENT` |
| User locks | `locks{picture, narration, timing, order}` | `metadata.aldershot.locks`. The assembler must refuse to change locked fields | Lost (NLE edits are the new truth on re-import) |
| Reviewer results | `review{rule_id, pass, measured}` | Timeline-level metadata | — |

Borrowing notes: video-use's EDL, Shotstack JSON and Remotion compositions are useful *render-time* shapes, but they don't carry provenance or locks. Treat them as compile targets, not as the plan.

### (d) Patterns and anti-patterns from existing AI editors

| Product | Documented pattern worth copying | User complaints → anti-pattern to avoid |
|---|---|---|
| Descript Underlord | Prompt → whole workflow (rough cut, B-roll, Studio Sound). Its own primer admits it "can misunderstand", so rephrase rather than repeat.\[81\] | Trustpilot: "used all 400 of those credits in less than 15 minutes… undoing its work piece by piece is extremely time consuming."\[82\] **Anti-pattern: opaque, non-atomic agent edits with no one-click revert.** Aldershot fix: each plan revision is a diff and every recipe application is reversible. |
| Opus Clip | ClipAnything rates scenes on visual, audio and sentiment cues and assigns a 0–99 virality score; ReframeAnything uses object tracking.\[83\]\[84\]\[85\] | "3 long form videos and no usable shorts without massive editing", "funny… clips were almost always missed", and "export the clip and finish it in Premiere Pro".\[86\]\[87\]\[88\] **Anti-pattern: unexplained scores; no NLE hand-off.** |
| CapCut Auto Cut | Beat Sync, Speech Pause and Script-Based modes, with adjustable sensitivity and visible beat dots on the waveform.\[89\]\[90\] | Templates don't retime when the track is swapped (guide).\[91\] **Copy: show beat markers. Avoid: beat grids frozen to one track.** |
| invideo AI agent | Agent storyboards scenes.\[92\] | "burned through all my credits without producing a single finished video", "ignored 8 clips that I uploaded".\[93\]\[94\] **Anti-pattern: metered agents that stall mid-job; ignoring user-supplied assets.** Aldershot fix: user assets get hard "must-use" locks, and the reviewer checks their usage. |
| Kapwing | AI transcription and silence removal.\[95\] | "change the timing of a clip, it will set it to something random."\[96\] **Anti-pattern: non-deterministic manual edits.** |
| Riverside Magic Clips | "Experimental", about 2 clips per 5 min, each 30–90 s, regenerate with duration, speaker and keyword controls.\[97\] | G2: "doesn't always apply my settings when it generates new clips."\[98\] **Anti-pattern: settings not persisted across regenerations.** Persist them as locks. |
| Research (LAVE, B-Script) | Dual control (agent *or* direct manipulation). Recommendations shown inline on the transcript.\[63\]\[99\] | — |

### (e) Remaining gaps and open-source coverage

| Gap in draft spec | Why (evidence) | Open-source coverage |
|---|---|---|
| **Craft-level reviewer**, not just rule checks | Timeline-Bench: 562/771 failures were quality-only\[1\] | Copy Timeline-Bench's measurable signals: cuts/min (PySceneDetect), longest static stretch, EBU R128 loudness (ffmpeg `loudnorm`/`ebur128`), silent share. Optionally a pairwise multimodal-LLM judge, z-scored per judge.\[15\] |
| Editorial guidance file | 1,909 words of curated SKILL.md guidance were part of the best Timeline-Bench agent\[15\] | Write Aldershot's own recipe-craft SKILL.md (video-use's is an MIT reference) |
| Audio polish at cuts | video-use uses 30 ms fades at every cut\[6\] | ffmpeg `afade`/`acrossfade` |
| Reframe for vertical | Timeline-Bench: every UGC task required captions, colour matching and reframing\[15\] | Face/subject tracking (e.g. MediaPipe, Apache-2.0; not verified this pass) + a crop path smoother |
| Colour matching | Same as above | ffmpeg `lut3d`/`colorbalance`. video-use ships grade presets as ffmpeg chains\[6\] |
| Proxies | Needed for fast preview | ffmpeg proxy transcode; OTIO media references can swap proxy and full |
| Music structure | Recap and cold-open recipes need sections | allin1 (check madmom licence) or Beat This + novelty segmentation |
| Audio events / SFX | Footage log lists audio events | PANNs features (supported in Lighthouse; licence unverified)\[100\] |
| NLE hand-off | Opus users "finish it in Premiere"\[86\] | OTIO → FCPXML / EDL adapters (lossy, documented)\[9\]\[101\] |
| Version compare | Underlord undo pain; VideoDiff research on alternatives | Plan diffs (JSON Patch) + side-by-side proxy renders |
| Evaluation harness | No in-house metric yet | Timeline-Bench tasks and verifier are released.\[1\] Use a subset as Aldershot's regression suite (check licence). |

### (f) What the evidence does NOT support
1. **The 80 ms beat-cut tolerance and 0.5 s min hold.** No source measures them. Treat them as tunable parameters and A/B them.
2. **That VLM captions or tags are reliable enough for footage search on real-world footage.** I found no measured retrieval accuracy on user footage. Timeline-Bench attributes agent failures to seeing footage "through stills and transcripts", and Lighthouse found newer retrieval models don't consistently beat older ones.\[1\]\[27\]
3. **That multi-agent editors match professionals.** Professionals beat EditDuet 75.1% of the time,\[74\] and editors preferred the reference over agents in 83.5% of Timeline-Bench judgments.\[1\]
4. **That CutClaw's code is reusable or its sync numbers are verified.** It has no licence, and the Δt≤0.1 s figure is secondary.\[4\]\[76\]
5. **That learned editing beats idiom/rule-based editing for structured formats.** No head-to-head was found. Leake (HMM idioms) and Write-A-Video (optimization) remain the strongest controllable precedents.
6. **Murch's Rule of Six percentages as scoring weights.** They are a heuristic.

## Recommendations
1. **Adopt video-use's text-first loop, but make the planner emit only recipe calls.** The deterministic assembler owns all frame math (snap to beat/word, then to frame).
2. **Make OTIO the export from day one**, with `metadata["aldershot"]` for recipe, locks and receipts, and receipts as Markers. Bake speed ramps.
3. **Replace "rule-only reviewer" with "rules + measurable craft signals".** Add pacing, static picture, loudness and silence checks, and log them per block so the bounded retry has a target.
4. **Licence hygiene now:** Beat This over madmom/allin1; re-implement supercut rather than vendoring videogrep; Revideo or an ffmpeg assembler over Remotion if the team will pass 3 people.
5. **Measure the defaults:** build 20–30 internal test edits, vary beat offset (0, 1, 2, 3 frames) and min hold (0.3–1.0 s), and run blind pairwise preference. That is the only way those numbers become evidence.

## Caveats
- Timeline-Bench is a four-day-old preprint from a commercial lab. Model names (e.g. GPT-6 Astra, Claude Fable 5.1) and results are not yet peer-reviewed.\[1\]
- Commercial review quotes come partly from Trustpilot, G2 and competitor blogs, and may be biased or regional.
- Licence statuses were read from repo files, README or PyPI metadata on the dates seen. Re-check before shipping, especially motion-canvas, Revideo's repo location, visbeat, and Lighthouse's weight and dataset terms.

## Sources

1. [Timeline-Bench: Evaluating Agents on Realistic Video-Editing Tasks, from Raw Footage to Final Cut](https://arxiv.org/abs/2609.35143)
2. [videogrep - conda-forge](https://anaconda.org/conda-forge/videogrep)
3. [videogrep/pyproject.toml at master · antiboredom/videogrep](https://github.com/antiboredom/videogrep/blob/master/pyproject.toml)
4. [2026年上半场AI视频开源项目全景图：11个AIGC项目的能力边界\_腾讯arc lab开源scope-CSDN博客](https://blog.csdn.net/weixin_55221858/article/details/162175221)
5. [Video Use: Video & Creative Production for AI Agents](https://www.openagentskill.com/skills/browser-use-video-use)
6. [GitHub - browser-use/video-use: Edit videos with coding agents](https://github.com/browser-use/video-use)
7. [browser-use open-source video-use skill allows automatic video editing - ABAB News](https://www.ababnews.com/news/14f21cf9-7df5-4e2d-8612-d4dbed5f3ab4)
8. [video-use/install.md at main · browser-use/video-use](https://github.com/browser-use/video-use/blob/main/install.md)
9. [OpenTimelineIO/docs/tutorials/write-an-adapter.md at main · AcademySoftwareFoundation/OpenTimelineIO](https://github.com/PixarAnimationStudios/OpenTimelineIO/blob/master/docs/tutorials/write-an-adapter.md)
10. [GitHub - soCzech/TransNetV2: TransNet V2: Shot Boundary Detection Neural Network · GitHub](https://github.com/soCzech/TransNetV2)
11. [README.md · Sn4kehead/TransNetV2 at main](https://huggingface.co/Sn4kehead/TransNetV2/blob/main/README.md)
12. [TransNetV2/inference-pytorch at master · soCzech/TransNetV2](https://github.com/soCzech/TransNetV2/tree/master/inference-pytorch)
13. [GitHub - Breakthrough/PySceneDetect: :movie\_camera: Python and OpenCV-based scene cut/transition detection program & library. · GitHub](https://github.com/Breakthrough/PySceneDetect)
14. [pypi.org](https://pypi.org/project/scenedetect/0.5.3/)
15. [Timeline-Bench: Evaluating Agents onRealistic Video-Editing Tasks,from Raw Footage to Final Cut](https://arxiv.org/html/2609.35143v1)
16. [GitHub - CPJKU/beat\_this: Accurate and general beat tracker · GitHub](https://github.com/CPJKU/beat_this)
17. [beat-this - crates.io: Rust Package Registry](https://crates.io/crates/beat-this)
18. [beat\_this/README.md at main · CPJKU/beat\_this](https://github.com/CPJKU/beat_this/blob/main/README.md)
19. [GitHub - mosynthkey/beat\_this\_cpp: C++ port of Beat This! (AI powered beat tracking) · GitHub](https://github.com/mosynthkey/beat_this_cpp)
20. [Releases · CPJKU/beat\_this](https://github.com/CPJKU/beat_this/releases)
21. [GitHub - 05Narwhal/lumen-models: On-device models for Lumen (JL Studios): CLIP ViT-B/32 image tower and Beat This! beat tracker, as ONNX. · GitHub](https://github.com/05Narwhal/lumen-models)
22. [GitHub - notiuneoffiicial/CrispASR: C++ ggml runtime hub for multilingual ASR and TTS models: Cohere Transcribe, Parakeet TDT, Voxtral, Canary 1B v2, etc, plus universal forced alignment, and more · GitHub](https://github.com/notiuneoffiicial/CrispASR)
23. [WhisperX Deep-Dive — Diarization And Word-Level Timestamps](https://www.forasoft.com/learn/ai-for-video-engineering/articles-ai/whisperx-diarization-word-level-timestamps)
24. [CrisperWhisper: Accurate Timestamps on Verbatim Speech Transcriptions](https://arxiv.org/pdf/2408.16589)
25. [lighthouse/README.md at main · line/lighthouse](https://github.com/line/lighthouse/blob/main/README.md)
26. [line/lighthouse](https://deepwiki.com/line/lighthouse)
27. [Lighthouse: A User-Friendly Library for Reproducible Video Moment Retrieval and Highlight Detection](https://arxiv.org/html/2408.02901v3)
28. [Revideo: Create videos with code](https://www.producthunt.com/products/revideo?launch=revideo&page=1)
29. [editly/LICENSE at master · mifi/editly](https://github.com/mifi/editly/blob/master/LICENSE)
30. [MoviePy documentation — MoviePy documentation](https://zulko.github.io/moviepy/)
31. [GitHub - midrender/revideo: Create Videos with Code · GitHub](https://github.com/midrender/revideo)
32. [Editly - declarative video editing - LinuxLinks](https://www.linuxlinks.com/editly-declarative-video-editing/)
33. [GitHub - mifi/editly: Slick, declarative command line video editing & API · GitHub](https://github.com/mifi/editly)
34. [Workflow runs · redotvideo/revideo](https://github.com/redotvideo/revideo/actions)
35. [Remotion Company Licensing](https://www.remotion.pro/license)
36. [Auto-Editor: install and use the CLI video cutter](https://hysenlabs.com/projects/wyattblue-auto-editor)
37. [Auto-Editor (wyattblue/auto-editor)](https://context7.com/wyattblue/auto-editor)
38. [Releases · WyattBlue/auto-editor](https://github.com/WyattBlue/auto-editor/releases)
39. [sakemin/all-in-one-music-structure-analyzer](https://replicate.com/sakemin/all-in-one-music-structure-analyzer)
40. [modal-audio-analysis/research.md at main · nsthorat/modal-audio-analysis](https://github.com/nsthorat/modal-audio-analysis/blob/main/research.md)
41. [GitHub - CPJKU/madmom\_models: Trained data models for madmom: https://github.com/CPJKU/madmom · GitHub](https://github.com/CPJKU/madmom_models)
42. [all-in-one-infer/README.md at main · openmirlab/all-in-one-infer](https://github.com/openmirlab/all-in-one-infer/blob/main/README.md)
43. [AI Song Structure Analysis: Intro, Verse, Chorus - MusicTech Lab](https://www.musictechlab.io/blog/music-data/automatic-song-structure-analysis-how-ai-detects-intro-verse-chorus)
44. [CutClaw: Agentic Hours-Long Video Editing via Music Synchronization](https://arxiv.org/abs/2603.29664)
45. [Licensing a repository - GitHub Docs](https://docs.github.com/articles/licensing-a-repository)
46. [CutClaw: Agentic Hours-Long Video Editing via Music Synchronization](https://arxiv.org/html/2603.29664v1)
47. [GitHub - antiboredom/videogrep: automatic video supercuts with python · GitHub](https://github.com/antiboredom/videogrep)
48. [Videogrep: Automatic Supercuts with Python](https://lav.io/2014/06/videogrep-automatic-supercuts-with-python/)
49. [videogrep](https://pydigger.com/pypi/videogrep)
50. [visbeat/README.md at master · abedavis/visbeat](https://github.com/abedavis/visbeat/blob/master/README.md)
51. [Visual Rhythm and Beat](https://replicability.graphics/papers/10.1145-3197517.3201371/index.html)
52. [Visual Rhythm and Beat](https://mlanthology.org/cvprw/2018/davis2018cvprw-visual/)
53. [madmom · PyPI](https://pypi.org/project/madmom/)
54. [Switching to the GNU General Public License · motion-canvas · Discussion #1015](https://github.com/orgs/motion-canvas/discussions/1015)
55. [motion-canvas/LICENSE at main · motion-canvas/motion-canvas](https://github.com/motion-canvas/motion-canvas/blob/main/LICENSE)
56. [Learning from Video - Art Gallery, Talks & Papers - acm siggraph](https://sa2019.siggraph.org/attend/art-gallery/session/115/details/22)
57. [Write-A-Video: Computational Video Montage from Themed Text](https://cg.cs.tsinghua.edu.cn/papers/TOG-2019-Write-a-Video.pdf)
58. [Computational Video Montage from Themed Text](http://miaowang.me/write-a-video/)
59. [“Computational video editing for dialogue-driven scenes” by Leake, Davis, Truong and Agrawala](https://history.siggraph.org/learning/computational-video-editing-for-dialogue-driven-scenes-by-leake-davis-truong-and-agrawala/)
60. [AVscript: Accessible Video Editing with Audio-Visual Scripts](https://arxiv.org/pdf/2302.14117)
61. [B-Script](https://dl.acm.org/doi/10.1145/3290605.3300311)
62. [B-Script: Transcript-based B-roll Video Editing with Recommendations](https://www.researchgate.net/publication/331429004_B-Script_Transcript-based_B-roll_Video_Editing_with_Recommendations)
63. [LAVE: LLM-Powered Agent Assistance and Language Augmentation for Video Editing](https://www.dgp.toronto.edu/~bryanw/lave/)
64. [LAVE: LLM-Powered Agent Assistance and Language Augmentation for Video Editing](https://dl.acm.org/doi/fullHtml/10.1145/3640543.3645143)
65. [\[2008.04838\] TransNet V2: An effective deep network architecture for fast shot transition detection](https://ar5iv.labs.arxiv.org/html/2008.04838)
66. [TransNet V2: An Effective Deep Network Architecture for Fast Shot Transition Detection \[Quick Review\]](https://liner.com/review/transnet-v2-effective-deep-network-architecture-for-fast-shot-transition)
67. [GitHub - HaoJingyuan/video-scene-split: 基于TransNet V2 镜头边界检测神经网络实现的视频场景切割 · GitHub](https://github.com/HaoJingyuan/video-scene-split)
68. [AlignBeat: A Latent Variable Model for Multi-Class Beat Tracking from Partially Labeled Data](https://arxiv.org/html/2510.14391)
69. [\[PDF\] Visual rhythm and beat](https://www.semanticscholar.org/paper/Visual-rhythm-and-beat-Davis-Agrawala/f42533857ee2e1daa91f6dc222fc0323e39131d4)
70. [Siggraph 2025 collected by Wang](https://hongsong-wang.github.io/siggraph25_abstract/)
71. [EditDuet: A Multi-Agent System for Video Non-Linear Editing](https://dl.acm.org/doi/abs/10.1145/3721238.3730761)
72. [EditDuet: A Multi-Agent System for Video Non-Linear Editing](https://dl.acm.org/doi/10.1145/3721238.3730761)
73. [EditDuet: A Multi-Agent System for Video Non-Linear Editing](https://www.alphaxiv.org/abs/2509.10761)
74. [EditDuet: A Multi-Agent System for Video Non-Linear Editing](https://arxiv.org/html/2509.10761)
75. [GitHub - GVCLab/CutClaw: Agentic Hours-Long Video Editing via Music Synchronization · GitHub](https://github.com/GVCLab/CutClaw)
76. [CutClaw: Agentic Hours-Long Video Editing via Music Synchronization](https://www.alphaxiv.org/overview/2603.29664)
77. [BEAT: Rhythm-Elastic Alignment for Agentic Music-guided Movie Trailer Generation](https://arxiv.org/html/2605.27067v1)
78. [An open-source Claude Code skill that turns a folder of raw footage into a finished video](https://medium.com/coding-nexus/an-open-source-claude-code-skill-that-turns-a-folder-of-raw-footage-into-a-finished-video-a7b64f9020c4)
79. [video-use: AI Video Editing With Claude Code 2026](https://explainx.ai/blog/video-use-claude-code-ai-video-editor-guide-2026)
80. [opentimelineio.schema package — OpenTimelineIO 0.10.0.dev1 documentation](https://opentimelineio-deb.readthedocs.io/en/latest/api/modules/opentimelineio.schema.html)
81. [How to Get Started with Underlord: An AI Video Editor Primer](https://www.descript.com/blog/article/underlord-ai-video-editor-primer)
82. [descript Reviews](https://www.trustpilot.com/review/descript.com?page=2)
83. [Opus Clip Review 2026 - Features, Pricing & Alternatives](https://www.tooljunction.io/ai-tools/opus-clip)
84. [ClipAnything - Clip any moment from any video with prompts](https://www.opus.pro/clipanything)
85. [OpusClip Review 2026: 10M Users, \$15 Plan — Worth It?](https://theplanettools.ai/tools/opusclip)
86. [OpusClip Reviews](https://ca.trustpilot.com/review/opus.pro?page=3)
87. [Clip Opus Reviews](https://www.trustpilot.com/review/clip.opus.pro)
88. [OpusClip Trustpilot Review: No Usable Shorts? Try Vyroclips](https://vyroclips.com/opusclip-trustpilot-no-usable-shorts-review)
89. [What Is Auto Cut in CapCut?](https://www.capcut.com/help/auto-cut-in-capcut)
90. [apps.apple.com](https://apps.apple.com/qa/ipad/story/id1705686145)
91. [CapCut Templates: How to Find, Use and Edit](https://capcutguide.com/capcut-templates/)
92. [invideo AI Reviews](https://nz.trustpilot.com/review/ai.invideo.io)
93. [invideo AI Reviews](https://www.trustpilot.com/review/ai.invideo.io)
94. [invideo AI Reviews](https://ca.trustpilot.com/review/ai.invideo.io?page=9)
95. [Kapwing Reviews](https://au.trustpilot.com/review/www.kapwing.com?page=3)
96. [Kapwing Reviews](https://www.trustpilot.com/review/www.kapwing.com)
97. [About Magic Clips](https://support.riverside.com/hc/en-us/articles/12124048765981-About-Magic-Clips)
98. [Riverside Reviews & Product Details](https://www.g2.com/products/riverside-com/reviews)
99. [B-Script: Transcript-based B-roll Video Editing with Recommendations](https://dl.acm.org/doi/fullHtml/10.1145/3290605.3300311)
100. [Releases · line/lighthouse](https://github.com/line/lighthouse/releases)
101. [OpenTimelineIO · PyPI](https://pypi.org/project/OpenTimelineIO/)
