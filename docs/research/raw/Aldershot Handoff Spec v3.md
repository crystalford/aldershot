# Aldershot Handoff Spec v3

Oct 2, 2026 · @Christopher Telford

## How to use this package

This doc is the single authoritative build spec for Aldershot. Where it disagrees with an earlier report, this doc wins.

Nothing from the earlier research is thrown away. Hand Claude Code and Claude Design this doc **plus** every source report below, as an idea library. They may mine the reports for good ideas, but any idea not adopted here must be proposed to you first, never built silently.

**Authority order**

1. This spec (v3)
2. The corrections ledger (section 15), which says which earlier claims are wrong or superseded
3. The idea index (section 16), which lists every idea from every report and its status
4. The source reports themselves, newest first

**Source reports to attach**

| Code | Report | Covers |
| --- | --- | --- |
| R1 | Editorial measurement | Spoken-line numbers, Document blocks, pacing, music levels, hooks, first VO flow (superseded) |
| R2 | Making the SAID column sound human | Anti-slop evidence, talk-first drafting, linter checks |
| R3 | Script spec: locking a plain register | Register drift, beat schema, skeleton, opening templates |
| R4 | Process design: multi-pass pipeline | Claim map, receipts, verdicts, clip receipts, legal notes, question bank |
| R5 | Build Spec v2 | Data model, state machine, linter thresholds, media, recording, eval, tickets, design screens |
| R6 | Format modes and react mode | React pipeline, gap styles, YouTube policy, transcripts, fair dealing, mode table |
| R7 | Edit-plan research and steal list | Open-source parts, licences, OTIO mapping, Timeline-Bench, AI-editor complaints |
| D1 | Aldershot Edit Plan Spec (doc) | Edit plan fields, recipe library, music, agent stages, new video types |

**Rules for the agents reading this**

- Build from this doc. Use the reports for context, examples and rationale.
- If a report and this doc conflict, follow this doc and check section 15 for why.
- If you find a good idea in a report that this doc does not mention, check section 16. If it is missing there too, list it as a proposal at the end of your work.

## Product summary and glossary

Aldershot turns a one-line idea, a pile of footage or a source clip into an edited, source-grounded video. It acts like an editor: it researches, writes from your own spoken words, plans every cut, and renders.

**Shape of the product**

- Chat-first intake. The chat then launches either automated processing or the editor.
- The editor has a block timeline plus a chat sidebar rail. You can toggle options, edit blocks directly, or ask the chat for changes.
- Already built (to reconcile, see section 17): transcript-based editing, chat assistant, clipping, server-side ffmpeg rendering.
- One engine, many **mode presets** (essay, documentary, react and others). Research depth is a dial per mode.

**Glossary** (use these names in code, prompts and UI)

| Term | Meaning |
| --- | --- |
| Brief | Your starting line, plus any talk-first voice notes |
| Hypothesis | The brief rewritten as a testable question |
| Claim map | Atomic claims from both sides, typed and ranked |
| Receipt | An exact quoted span from a source, with metadata |
| Clip receipt | A receipt for video or audio: URL, speaker, timecodes, verbatim span, context span, status |
| Verdict | Per claim: supported, mixed, unsupported or untestable, with the strongest counter |
| Spine | The fixed section skeleton, filled with verdicts |
| Receipt Talk | Recorded voice reactions to each verified receipt, which become the narration |
| Script / SAID | The narration column, beat by beat |
| SHOW | What is on screen for each beat |
| Edit plan | The master artifact: every block's purpose, recipe, picture, narration, audio, text and locks |
| Block | One unit of the edit plan |
| Recipe | A named, parameterized edit move (montage, supercut and so on) |
| Lock | A field you fixed, which no later pass may change |
| Gap | In react mode, a commentary slot between source clips |
| Cue card | Keyword prompts for a freestyle take |
| Recording job | A batch of script chunks recorded in one take |
| Take | One recording of a chunk, section or gap |
| Pull list | The batched list of clips you must supply, grouped by source |
| Change card | A phone-friendly summary of what a pass changed, with accept or reject |
| Voice profile | Your measured speech habits, used as linter targets |
| Mode preset | A video type's default skeleton, passes, recipes and narration styles |

## Pipeline and state machine

Every project runs a fixed sequence of passes with three user gates. The mode preset decides which passes run. Footage logging runs on upload, in parallel with everything else.

| # | Pass | Output | UI surface | Gate | Stop condition |
| --- | --- | --- | --- | --- | --- |
| 0 | Intake | Brief (topic, subjects, hypothesis, audience, length, red lines) | Chat | Soft confirm | Fields filled; any built-in conclusion rewritten as a testable hypothesis |
| 1 | Hypothesis and claim map | Claims from detractors and defenders, typed, ranked, with mirrored for/against queries | Claim map card | **Gate 1** | At least 6 claims, at least 2 from the other side |
| 2 | Receipts | Receipts and clip receipts, your library first | Processing view | None | Two rounds add under 10% new receipts, or 8 per claim, or budget hit |
| 3 | Verdicts | Entailment label per claim-receipt pair; verdict matrix | Verdict matrix or cards | **Gate 2** | Every claim has a verdict or "insufficient evidence" |
| 3b | Receipt Talk | Your recorded reactions per receipt, transcribed | Interview mode | None (skippable) | Every eligible verdict has a take, or you skip |
| 4 | Spine and script | Beats with SAID, built from your words and quotes | Editor | None | Five checks run, one rewrite done |
| 5 | Edit plan | Blocks with recipes, picture, audio, text | Editor | None | Reviewer rules pass, or one retry then flag |
| 6 | Clip plan and pull list | Pull items, grouped by source video | Pull session | **Gate 3** | Every item supplied, kept as placeholder, or dropped |
| 7 | Voiceover | Takes aligned to blocks | Record block | Exceptions only | Every chunk has a clean take |
| 8 | Verification sweep | Every quote re-heard; attribution complete | Checklist | Fix or cut | 100% of shipped quotes verified |
| 9+ | Named refinement passes | Change cards | Chat rail | Accept or reject | You stop, or 3 passes, or no changes |
| 10 | Export | Render, captions, description, sources page, OTIO | Export screen | Confirm | Export QC passes |

**Project states:** draft, intake done, claims pending review, receipts running, verdicts pending review, interview open, scripting, script ready, planning, pull pending, recording, assembling, verifying, ready to export, exported. Side states: paused, blocked (with reason), abandoned (archived after 30 days, resumable).

**Invariants (testable)**

- Each pass run has an idempotency key from pass type, input versions and config version. Same key means no model calls.
- Passes resume per item (per claim, receipt, beat or block) after a crash.
- No pass edits an artifact in place. Every write is a new version that records which pass made it.
- Gates can only be left by a user action, logged in an append-only audit log.
- Editing an upstream artifact marks downstream ones stale. It never regenerates them silently; the chat rail offers "re-run for 3 affected beats".
- A per-project budget cap pauses the pipeline when hit (default $25 of model spend).

**Mode variations:** react and highlight-reel modes skip passes 1 to 3 unless a fact-check gap needs a verdict. Essay, investigation and rebuttal run everything. See section 5.

## The edit plan

The edit plan is the source of truth. Chat edits it, the editor shows it, the renderer executes it, and OpenTimelineIO (OTIO) is its compiled export. Nothing renders that is not in the plan.

**Plan-level fields:** mode, target length, pacing curve (energy per section), style idioms (saved editing style), music map, render targets (16:9 master plus vertical or square cut-downs).

**Block fields**

| Field | Holds | OTIO mapping | FCPXML / EDL fallback |
| --- | --- | --- | --- |
| purpose, duration target | hook, setup, evidence, reaction, breather, payoff, transition; min and max | Stack or run of clips; metadata.aldershot.block | Compound clip or comment |
| recipe | Name, version, parameters | metadata.aldershot.recipe, with version for reproducible re-assembly | Lost; bake result |
| picture | Specific source ranges, or a query plus scene role and top-k candidates | Clip media reference and source range; retrieval in metadata | Clip only |
| narration | Style (scripted, freestyle, anchored, none), text or cue card, take, alignment | Separate audio track; alignment in metadata | Audio track |
| audio | Music cue, beat grid ref, duck level, SFX | Audio tracks; ducking as an effect with params | Bake into mix |
| on-screen text | Template, content, style | Generator clip or effect | FCPXML title; EDL lost |
| transitions | Cut, J-cut, L-cut, match cut, dissolve | Transition | Basic types only |
| time effects | Linear speed, ramp, freeze | LinearTimeWarp, FreezeFrame; ramps in metadata and baked | Speed effects unsupported in the FCPXML adapter; bake |
| receipts | Claim id, source, quote, verdict | One Marker per receipt over its range | FCPXML markers; EDL comment |
| locks | Which fields you fixed | metadata.aldershot.locks | Lost; NLE edits become truth on re-import |
| review | Rule results and craft signals | Timeline metadata | None |

**Agent architecture**

1. **Planner** writes the plan from the brief, verdicts, script and footage log. It may only emit recipe calls with parameters, never raw timeline math.
2. **Retriever** fills picture and audio slots from the footage log by query and scene role.
3. **Assembler** turns the plan into a timeline with fixed code: snap cuts to word boundaries or beats, then to the frame; apply 30 ms audio fades at every cut; apply ducking and transitions. No model call here.
4. **Reviewer** checks verifiable rules and measurable craft signals (section 12). A failing block goes back to the planner once, then is flagged to you.
5. **Render** a proxy preview first, then the full render after you accept.

This follows the video-use pattern (MIT): the model never watches the video. It works from transcripts and a few stills, keeps session memory in a project file, and checks renders at every cut boundary.

**Plan rules**

- Cut points use word-level timestamps, never sentence-level ones.
- Every system-filled field is marked system-chosen. Every field you touch becomes a lock. User-supplied assets can carry a "must use" lock that the reviewer enforces.
- Settings you set for a regeneration persist as locks across regenerations.
- Chat requests become plan diffs, delivered as change cards. Every agent edit is reversible in one tap.
- Any score the system shows (moment scores, retrieval ranks) comes with its reason, never as an unexplained number.
- Export to .otio from day one; .otio is the only lossless format.

## Mode presets

Every video type is a preset on one engine: a structure driver, the passes it runs, its default narration styles, its main recipes and its checks. Shorts and vertical versions are a render target that any mode can use, not a mode.

| Mode | Structure driver | Passes | Narration defaults | Main recipes | Extra checks |
| --- | --- | --- | --- | --- | --- |
| React | Source clip beats | Transcribe, beat scoring, clip pacing; verdicts only for fact-check gaps | Setup scripted; reaction freestyle; fact-check anchored | Clip-gap, freeze-frame callout | Engagement per clip, attribution, source share, reused-content |
| Rebuttal (react preset) | The opposing video's claim map | Claim extraction, research, verdicts, clip pacing | Their claim restated scripted; rebuttal anchored; close freestyle | Side-by-side, clip-gap, supercut | Fair restatement, right-of-reply note |
| Factual essay | Thesis | Full pipeline | Your words; facts anchored | Document highlight, b-roll cover, recap | Five script checks |
| Explainer | Concept | Research, glossary | Descriptive scripted; analogies freestyle | Document highlight, freeze-frame callout | Sourcing |
| Documentary | Chronology or characters | Research, interview capture, archive log | Narration scripted descriptive; reflection freestyle | Montage, b-roll cover, match cut | Archive licences, consent |
| Investigation | Reporting findings | Full pipeline plus right of reply | Findings anchored; method freestyle | Document highlight, side-by-side | Defamation review, right of reply, source protection |
| Document read-through | Document structure | Text alignment, claim map | Excerpt on screen; analysis freestyle | Document highlight | Never mostly reading (reused-content rule) |
| Fact-check short | Single claim | Claim, research, verdict | Verdict anchored; one freestyle line | Clip-gap, Document highlight | 60 s or less |
| Correction (fact-check variant) | Prior error | Diff against the original | Correction fully scripted; explanation freestyle | Side-by-side | Link to original |
| News recap | Chronology | Event extraction, dating | Events scripted descriptive; significance freestyle | Time compression, montage | News-reporting attribution |
| Developing-story update | What changed since last video | Diff, dating | Anchored | Recap | Link to prior; dated |
| Footage verification | Visual evidence | Frame and location checks, metadata | Descriptive scripted; reasoning freestyle | Freeze-frame callout, side-by-side | Attribution, privacy |
| Interview cut-down | Interview arc | Interview capture, quote selection, context check | Framing scripted; host reflection freestyle | B-roll cover, J/L cuts | Consent, context preserved |
| Supercut video | A repeated phrase | Transcript search | Analysis freestyle | Supercut, recap | Every instance re-heard and attributed |
| Highlight reel | Best moments | Moment scoring | None or short freestyle links | Highlight reel, montage | Context check per clip |
| Trailer or teaser | Hook and three beats | Moment scoring | One scripted line or none | Cold-open teaser, montage | Moments still play in context later |
| Then vs now | Two time points | Footage search by date | Scripted descriptive | Side-by-side, time compression | Both sides attributed |
| Event recap | Time order, 60 to 120 s | Footage logging | Freestyle over music | Montage, time compression | Beat alignment |
| Tutorial or walk-through | Goal and steps | Screen capture logging | Freestyle | Freeze-frame callout, time compression | None extra |

**Per-gap narration styles** apply in every mode, not just react. Any block or gap can be flipped by a tap or a chat line ("script gap 4"). Section 6 has the rules for each style.

## Script and narration spec

Narration is built from your own spoken words and verbatim quotes, held in a plain reporting register by deterministic checks. The model edits; it does not author opinion.

**Where SAID comes from**

1. Intake talk: you explain the idea aloud for 3 to 10 minutes. This seeds the brief and your voice profile.
2. Receipt Talk (after Gate 2): for each verdict cluster you see the receipt and talk for 30 to 120 seconds about what it shows, what bugs you, and what cuts against it.
3. The system assembles SAID from those transcript spans plus verbatim quotes.
4. The model may only cut, reorder, merge, split, fix tense or pronouns, and add **bridges of 25 words or fewer, at most one per beat**.
5. Target at least 80% of words per section from you or from quotes; hard floor 60%.
6. Fallback if you skip Receipt Talk: the model drafts from verdicts under register lock, every span is flagged as model-written, and the one-take recording plus "prefer what I said" becomes your talk-first step.

**Register lock (every generation call)**

- Frame the task as "report these verified claims from these receipts". Never call it a YouTube script, hook or essay.
- Generate one beat at a time. Re-send the register rules and 3 to 5 of your own plain paragraphs every call.
- Voice is yours to choose; the register rules are fixed. No second-person audience address or rhetorical questions outside the promise beat. Spoken attribution ("as X put it") only when no receipt is on screen; otherwise the on-screen card attributes.

**Beat schema:** beat id, section, claim, receipt ids, claim type (fact, inference, uncertainty, counter), confidence (established, likely, contested), SAID (3 sentences or fewer, each span tagged by origin), on-screen, show blocks, lint flags, check results.

**Skeleton (essay-family modes)**

| Section | Rule |
| --- | --- |
| Cold receipt | Opens on a real artifact; key number in beat 1 or 2 |
| Question and promise | Done by about 0:30 |
| Context | Only what the evidence run needs |
| Evidence run | Receipt change every 45 to 90 s; strongest receipt last; chapters 6 minutes or less |
| What cuts against this | Each counter refuted with a receipt or openly conceded; never mentioned and dropped |
| Verdict and limits | What is established, likely, contested; no moral, no call to action |

Opening templates: **A Cold Receipt** (default), **B Headline Finding**, **C Contradiction**. **D, a bare question or teaser, is banned.** A versus B is an A/B test on your channel, not settled science.

**Linter (deterministic; no model judge)**

| Check | Cold-start threshold | After your profile takes over |
| --- | --- | --- |
| Sentence length mean | 12 to 18 words | Your mean ± 3 |
| Sentence length spread (SD) | 6 or more | At least 0.8 × yours |
| Hard cap | 30 words | 30 (never relaxed) |
| Short sentences (7 words or fewer) | 15 to 30% | Yours ± 10 points |
| Punch sentence spacing | At least 1 per 6 sentences | Same |
| Em dashes | 3 per 1,000 words or fewer | Your rate + 1 |
| Participial clauses | 8 per 1,000 words or fewer | 1.5 × yours |
| Nominalizations | 25 per 1,000 words or fewer | 1.3 × yours |
| Template patterns ("it's not X, it's Y", "here's the thing", tidy-moral endings) | 0 in model spans; flagged in yours | Same |
| High-ratio AI words (delve, tapestry, crucial, underscore and others) | 0 in model spans | Your overrides allowed |
| Repeated 3-grams across beats | 2 or fewer per section | Same |
| Specifics (numbers, names, dates, places) | At least 1 per 2 sentences in the evidence run | Same |
| Contractions | At least 50% of chances | Yours ± 15 points |
| Fang Easy Listening Formula | 12 or less per sentence on average | Yours + 2 |
| Clinical labels about a real person | 0 outside a verbatim quote | Same |
| Origin share | 80% or more you or quotes (floor 60%) | Same |

Profile switch: blend 50/50 once your profile holds 1,500 words of spontaneous speech (about 10 minutes); switch fully at 5,000 words or 3 accepted projects; update after each accepted script with weight 0.2.

Flow: lint, then **one** targeted rewrite of flagged model-written spans, re-lint, then show remaining flags as named categories on spans. Your own spans are flagged, never auto-rewritten. Your edits update the profile.

**Five checks per sentence:** support (entailed by a linked receipt), unsupported sentence, register lint, structure (skeleton order, counters handled, cadence, chapters, no template D), overclaim (certainty words must match verdict confidence).

**Narration styles per gap or block**

| Style | Use for | Rules |
| --- | --- | --- |
| Scripted descriptive | Setup, context, context restore, documentary narration | Audio-description rules: describe what is seen or said, general to specific, present tense, active voice, no interpretation of emotion or motive, "then / now / later" transitions, never over essential source audio, don't fill every gap; word budget = gap seconds × your words per second minus padding; no evaluative adjectives |
| Freestyle | Opinion, reaction, close | Cue card only (template below); 2 to 3 takes, pick one |
| Anchored freestyle | Fact-checks, rebuttal points, verdicts | Cue card with locked tokens (number, name, date, verdict); the take is checked for every locked token |
| Fully scripted | Legally sensitive wording, corrections | Exact text; read verbatim |
| None | Bridges, montages | Prefer a cut |

Defaults by gap type: cold open freestyle; setup scripted; context restore scripted (quote verbatim, re-heard); reaction freestyle; fact-check anchored; rebuttal anchored; bridge none; close freestyle.

**Cue card template** (a hypothesis to test on your takes): WHAT (8 words or fewer, keywords) · WHY IT MATTERS (8 words or fewer) · RECEIPT (number, date or document; locked for fact-checks) · ANGLE (one question) · TARGET (seconds). Keywords, not sentences, so the card can't be read aloud.

**Speech rules:** never write fillers or disfluencies into a script. Trim fillers in takes toward 5 per minute or fewer, not zero; keep fillers right before new information. Flag any trim that removes more than a third of a take.

**People and psychology:** describe behaviour and cite it. Attribute interpretations to named experts or critics. Never assert a diagnosis. Lint clinical words unless quoted and attributed.

## Recording spec

You record in sections, not line by line, and the chat only interrupts for exceptions. There are no hotkeys; this is not a classic editor.

| Step | Behaviour | Acceptance |
| --- | --- | --- |
| Job | Chat issues one recording job per section (3 to 6 chunks; 1 chunk = 1 SAID sentence or 1 gap) | Job lists chunks and estimated time from your words per minute |
| Record block | Current line large, next line dimmed; scripted gaps show the line, freestyle gaps show the cue card; auto-advance on the chunk's last word plus 300 ms of silence, tap to advance as fallback | Advance within 500 ms of chunk end |
| Flubs | You just re-read; the system keeps the last clean read | Re-read detected when 60% or more of the chunk's words repeat within 10 s |
| Alignment | Forced alignment of the take to the expected text; cut per block with 80 ms padding at zero crossings | Word boundaries within 200 ms for at least 90% of words on the golden set; pin the aligner version |
| Match | Per-chunk word error rate against SAID: 10% or less clean; 10 to 25% minor mismatch (offer "update SAID to what I said"); over 25% mismatch | Thresholds configurable |
| Freestyle | 2 to 3 takes per gap; you pick one; locked tokens checked for anchored gaps | Missing or changed token flagged by name |
| Exceptions | Chat rail: "lines 4 and 7 didn't match, redo?" with one-tap redo | Only mismatches surface |
| Prefer what I said | After the first project, minor mismatches update SAID from the take, then re-run lint and support checks | Quote spans never change |
| Short VO | Inline record card in chat for single lines (a montage line) | Same alignment rules |
| Auto-transcribe every take | Transcript diffed against SAID to flag dropped or changed words | Diff shown on the block |

## Media spec

Footage is logged on upload so every recipe can search it. Rendering follows fixed audio, caption and export targets.

**Footage logging (on upload)**

| Layer | Stored per shot | Notes |
| --- | --- | --- |
| Proxies | Low-res copy for preview | Render from originals |
| Shot boundaries | Start and end | TransNet V2 primary, PySceneDetect CPU fallback |
| Transcript | Words, timestamps, speaker | WhisperX-style word alignment; quotes still re-heard |
| Caption | One-line description of subject, action, place | Search aid only, never a fact in narration |
| Tags | Shot size, camera motion, faces, on-screen text | Correctable in one tap; corrections improve search |
| Quality flags | Blur, shake, exposure, dropped audio | Flagged shots excluded from montages by default |
| Audio events | Laughter, applause, music, silence | Reliable in clean audio |
| Scene role | Subject, Counterpoint, Context, Second-Story, Trace, Red-Herring | System proposes, you confirm |
| Embedding | For semantic search | Quality depends on captions |
| Dedupe hash | For library management | Archive tier for unused footage |

**Recipe library**

| Recipe | What it does | Key parameters | Automatic checks |
| --- | --- | --- | --- |
| Montage | Compresses many shots into a beat-cut sequence | Query, role mix, length, order (chronological / energy build / match), beat level | No flagged shots, no repeats, cuts on beats |
| Supercut | Every clip of the same phrase, via transcript search | Phrase, speakers, date range, max clips | Each instance re-heard and attributed |
| Side-by-side | Claim vs reality, or then vs now | Left, right, sync point | Both attributed; neither audio buried |
| Time compression | Speed ramp or time-lapse | Speed curve, target length | Speech never sped up unless marked |
| B-roll cover | Covers jump cuts in talking footage | Coverage rule, role to fill | Every jump cut covered |
| Cold-open teaser | Strongest moment pulled to the front | Source block, length | Moment still plays in context later |
| Recap | Fast summary before payoff | Blocks to recap, length | Only verified claims |
| Highlight reel | Best moments of a long source | Scoring rubric, length | Context check per clip |
| Match cut | Cut on matching shape, motion or words | Match type | Reviewer confirms match |
| Freeze-frame callout | Freeze, zoom, label a detail | Frame, region, label | Label backed by a receipt |
| Document highlight | Real artifact with highlighter | See below | Hold-time formula |
| Clip-gap | Clip, then commentary (react) | Gap style | Engagement per clip |

Write a recipe-craft guidance file (SKILL.md) for the planner. Curated editorial guidance helped the best agent on Timeline-Bench; video-use's guidance is an MIT-licensed reference.

**Planner decision layers:** Murch's Rule of Six (emotion, story, rhythm, eye trace, 2D plane, 3D space) as review vocabulary and tie-break order, not numeric weights; saved style idioms ("start wide", "no jump cuts", "cut on beats"), as in Leake et al.; scene roles to fill montage and b-roll slots.

**Cut rules:** cut on a word boundary or pause, never mid-word; in music sections cut near a beat and put the biggest visual change on a downbeat; default J/L cuts between talking blocks, hard cuts inside montages. The beat offset (draft 80 ms) and minimum hold (draft 0.5 s) are unmeasured; tune them by blind A/B (section 17).

**Music:** analyze each track once for beats, downbeats and sections (intro, verse, chorus) with Beat This; flag irregular tracks where tracking is weak and fall back to manual markers; map song sections to plan sections so music changes land at section breaks; licensed music only, YouTube Audio Library by default; upload unlisted first and wait for the Content ID check.

**Document block:** the real artifact; one animated highlighter span of 20 words or fewer; re-typed labels of 4 words or fewer; read-aloud off by default (on only when the exact wording is the evidence, and then read only the highlighted span); hold = max(2 s, characters ÷ 17 + 1 s), capped at 7 s; source and date lower-third for at least 2 s.

**SHOW rules:** one visual beat per sentence by default, not a hard cut rate (the "3 to 5 second shot" rule is unverified); no static hold over 7 s without motion; lower-third on the first appearance of each person or source; generative imagery off by default.

**Audio targets:** narration planned at about 165 words per minute, then calibrated to you; music about 20 dB under voice (range 10 to 25), sidechain duck with roughly 50 ms attack and 300 ms release; music changes at section breaks only; master at −14 LUFS integrated (accept −16 to −14), true peak −1 dBTP or lower, a convention rather than a YouTube rule; 30 ms fades at every cut; light cleanup on your own footage, loudness-matching only on source clips; a small licensed SFX set tied to recipes.

**Captions:** sidecar SRT or VTT by default, burned in only for Shorts; built from SAID force-aligned to the final VO, quotes from the verified span; 42 characters per line or fewer, 2 lines, 17 characters per second or fewer, cues 0.83 to 7 s.

**Export:** MP4 with the index at the front; H.264 High, progressive, 2 B-frames, closed GOP of half the frame rate, VBR, 4:2:0; 1080p at 24 to 30 fps at 8 Mbps or more (16 preferred), 1080p at 50 to 60 fps at 12 Mbps; AAC-LC 48 kHz stereo at 384 kbps; frame rate matches source; .otio exported alongside. QC: loudness in range, no unintended black frames over 1 s, captions present, every quote verified, attribution card present.

**Reframing and colour:** vertical cut-downs track the subject per shot and let you nudge the crop; light colour normalization per shot so mixed sources match in montages; no creative grading in the MVP.

**Packaging:** title states the finding or contradiction in 70 characters or fewer, no bare question; thumbnail is a real receipt fragment plus 4 words or fewer, 3 variants; use YouTube Test & Compare; description has the finding, chapters (first at 00:00, at least 3, each at least 10 s), numbered sources with dates, and the attribution block; a published sources page per video; AI disclosure only for realistic synthetic media.

## Research pipeline

Research tests a hypothesis from both sides and checks every quote against its source before anything is scripted. Errors are caught by outside checks (retrieval, quote matching, entailment), not by asking the model to critique itself.

**Turning a loaded brief into a hypothesis.** A brief like "why the detractors are right" presupposes its answer, and AI search amplifies built-in conclusions. The system rewrites it as a testable question ("which of the detractors' main claims hold up?"), maps the strongest claims from both sides, runs mirrored for/against queries, and reports a scorecard such as "4 of 7 supported, 2 mixed, 1 unsupported". If 80% or more of the claims fail, it stops and offers to reframe.

**Claim map:** 5 to 12 atomic claims, typed (factual, interpretive, evaluative, predictive), ranked by check-worthiness and how much the argument depends on them. Claims about someone's inner mental state are reframed as observable behaviour.

**Receipts:** your library first, then web and transcripts. Perspective questions (supporter, critic, neutral expert, the subject) interleaved with retrieval. Sources ranked primary, official, reported, commentary. Every receipt is an exact quoted span with a locator.

**Verdicts:** factored entailment per receipt (does this exact span support the claim?). The competing-hypotheses matrix logic is kept: weight evidence that tells the hypotheses apart. The ritual is dropped. A cited source is not a supported claim.

**Clip receipt fields:** source URL, platform id, channel, speaker and attribution confidence, publish date, capture date, in and out timecodes, verbatim cut span, context span (at least 15 s each side), transcript source (creator captions, auto captions, speech-to-text), verification status (located, heard, context-checked), claim id, role (evidence, illustration, object of critique), acquisition route, rights note, attribution text.

**Quote rules**

- Transcripts are an index. Every shipped quote is re-heard against the audio. Whisper invented text in 1.4% of audio segments in one study, and 38% of those inventions were harmful.
- Clip boundaries expand to the full sentence, the question being answered, and any qualifier that follows ("but", "unless", "I'm joking").
- Context check: does the wider span change the meaning (sarcasm, hypotheticals, quoting someone else, a later retraction)? If yes, the clip can't be used as evidence.

**Question bank (per pass)**

- Claim map: What does the brief presuppose? What would show it wrong? What are each side's strongest claims? Which claims carry the argument?
- Receipts: What is the strongest evidence for and against? Is it first-hand or a clip of a clip? What is the original date and venue?
- Verdicts: Does this exact span entail the claim? Which evidence tells the hypotheses apart? What context changes the meaning? What is the most charitable reading?
- Script: Does any sentence claim more than its receipt? Is every psychological statement behavioural and attributed? Is the counter the real strongest one?
- Clip plan: Which claim does this clip serve, in which role? Is it no longer than needed? Is one source dominating? Does every clip have a narration beat saying what to notice?

**Failure modes**

| Failure | Response |
| --- | --- |
| No sources for a claim | Mark insufficient evidence; script may only say "we could not find" |
| Paywalled source | Ask you for the file; otherwise cite without quoting |
| Deleted source | Use an archive copy with its capture date, or downgrade to contested |
| Conflicting transcripts | Mark the quote "needs re-hearing"; block export |
| Speech-to-text failure | Re-run with a second engine; require human re-hearing for quotes |
| All verdicts unsupported | Stop scripting; offer to reframe the hypothesis |
| Legal red flag | Block export until resolved; create a right-of-reply task |
| Budget hit | Pause and show remaining work and cost |
| Provider outage | Back off and resume per item |

## Legal and platform rules

These are design rules, not legal advice. A Canadian media lawyer should review them before you publish critique of a named living person.

**Clips and transcripts**

- No automated downloading or scraping from YouTube. Its terms bar downloading except as expressly authorized or with written permission, and bar automated access such as scrapers.
- The official YouTube API only returns captions for videos you can edit, so third-party transcripts must come another way.
- Legitimate transcript routes, safest first: your own videos via the API; a transcript or file from the creator with written permission; speech-to-text on a file you lawfully hold; YouTube's on-page "Show transcript" text pasted by you; third-party services (read their terms, many shift all risk to you).
- Clip acquisition routes: your own files, licensed, public domain or Creative Commons (licence stored), official records, creator permission (stored), or a platform's own sanctioned feature. Every clip starts as a reference placeholder card, so a rough cut always renders. A clip is "ready" only once its route is recorded and you attest to it.
- The Pull list batches everything you must supply into one sitting, grouped by source video. Dropped files auto-match to rows by duration, audio fingerprint and timecode.

**Fair dealing and fair use**

- Canada (Copyright Act s. 29.1): criticism or review is fair dealing only if the source and, where given, the author, performer, maker or broadcaster are mentioned. Attribution is a gate, not a courtesy.
- *CBC v. Conservative Party* (2021 FC 425): short clips used for criticism were fair dealing even as a substantial part; criticism can target the ideas and actions shown, not just the work; the source must be identifiable to a reasonably informed watcher.
- *United Airlines v. Cooperstock* (2017 FC 616): a parody site failed because its purpose was to punish and it took too much. Lint insult-only gaps that read as punishment.
- US: *Hosseinzadeh v. Klein* (2017) found commentary interspersed with short clips to be fair use. In 2026 a court found a nearly four-hour livestream reaction fair use as a matter of law (*Ted Entertainment v. Saber*).
- No court or policy sets a clip-to-commentary ratio.

**YouTube monetization**

- The reused-content policy allows clips for critical review and reaction videos with commentary, if viewers can tell there is a meaningful difference from the original. It applies to the whole channel and is separate from copyright and permission. YouTube said the July 2025 update made no change to it.
- The inauthentic-content policy targets templated, mass-produced, repetitive content, including generic AI content.
- Content ID can't judge fair use; disputed claims expire if the claimant doesn't respond in 30 days.

**Design rules that follow**

| Flag or check | Default |
| --- | --- |
| Max unbroken clip run | Warn; calibrate from your own measurements |
| Max share of a source used | Tracked per source |
| Max clip share of runtime | Tracked |
| Engagement per clip | On: every clip is followed by commentary about that clip |
| Voice commentary required | On: no clip-only or non-verbal-only stretches |
| Attribution on first use | On: on-screen card plus description |
| Necessity note per clip | On: one line saying why the clip is needed, kept for disputes |
| Punishment-tone lint | On |
| Single-source cap | On: no source dominates total clip time |
| Channel template variance | Warn when recent videos look near-identical |
| Channel risk dashboard | Clip share, engagement pass rate, template similarity across recent videos |
| Dispute file per video | Necessity notes, timecodes, attribution, commentary transcript |

**Defamation and people**

- Fair comment (*WIC Radio v. Simpson*, 2008 SCC 40): comment on a public-interest matter, based on proven facts, recognizable as comment.
- Responsible communication (*Grant v. Torstar*, 2009 SCC 61): seeking the subject's side is close to the core factor, so investigation and rebuttal modes create a right-of-reply task with the contact date and response logged.
- Goldwater Rule logic: no diagnosis of a named person; describe behaviour.
- Export is blocked until you resolve any red flag: an allegation of a crime, clinical labels, a minor, sealed proceedings, private information.
- AI-generated realistic people or events require YouTube's synthetic disclosure; never use an AI persona for political or legal commentary.

**Questions for a Canadian media lawyer**

1. Which version of YouTube's terms binds a Canadian user, and does fair dealing or "applicable law" permit any automated retrieval?
2. Is speech-to-text on media from a platform's offline feature a contract issue, a copyright issue, or both? Does s. 41 anti-circumvention apply regardless of fair dealing?
3. Is an on-screen source and author card at first use enough under s. 29.1, or must attribution be spoken or repeated? Is a description credit alone enough?
4. How do "amount" and "alternatives" apply when a reaction uses most of a short source?
5. Where is the line between criticism and a punishing purpose for critique of a named creator?
6. Are model-drafted lines you approve treated differently for defamation than your freestyle speech? What pre-publication review should investigation and rebuttal enforce?
7. Should Aldershot integrate third-party transcript services that make you indemnify them?
8. What is the risk of counter-noticing a US DMCA takedown, and which law likely applies?
9. Do news-reporting (s. 29.2) or criticism (s. 29.1) purposes better cover news recaps and footage verification?
10. What wording keeps psychology-of-a-public-figure commentary within fair comment?
11. What right-of-reply steps are realistic for a solo YouTube journalist, and how long to wait?
12. Corrections and takedown policy wording, and Quebec or out-of-province exposure.

## Parts list

Use permissively licensed parts and isolate or avoid the rest. Licence status was read from repo files at research time; re-check before shipping.

**Use**

| Part | Job | Licence | Notes |
| --- | --- | --- | --- |
| browser-use/video-use | Agent loop and editorial guidance reference | MIT | Young repo; depends on an ElevenLabs key for transcription; its self-check finds defects, not craft |
| OpenTimelineIO | Export and interchange | Apache-2.0 | .otio lossless; FCPXML and EDL adapters lossy |
| TransNet V2 | Shot boundaries | MIT (code) | Weaker on user-generated footage |
| PySceneDetect | Shot fallback and cuts-per-minute metric | BSD-3-Clause | CPU only |
| Beat This | Beats and downbeats | MIT (code and weights) | README warns some training data is under limited licences |
| WhisperX | Word-level alignment | BSD-2-Clause (code) | Speaker diarization model is gated; alignment degrades in noise |
| Lighthouse | "Footage query to time span" retrieval | Apache-2.0 (code) | Check pretrained-weight dataset terms |
| editly, MoviePy | Renderer shape references | MIT | JSON spec to video |
| Revideo | Motion graphics | MIT | Check current repo location |
| ffmpeg filters | Loudness, fades, LUTs, proxies | Per build | loudnorm, ebur128, afade, lut3d |

**Avoid or isolate**

| Part | Problem | Instead |
| --- | --- | --- |
| madmom models | Model weights CC BY-NC-SA (non-commercial) | Beat This |
| allin1 (music structure) | Depends on madmom models | Beat This plus section detection; review any madmom-free fork |
| videogrep | Declares an "Anti-Capitalist" licence | Build supercut on word-level transcripts |
| CutClaw | No licence file | Borrow ideas only (planner, editor, reviewer split) |
| Remotion | Company licence required at 4 or more people | Revideo or the ffmpeg assembler |
| auto-editor binaries | Newer releases gate features behind a key | Read the source (Unlicense) for ideas |
| visbeat | Licence unverified | Treat as non-commercial until confirmed |

Not verified, so don't depend on them yet: EditDuet and LAVE code availability, "VideoAgent (2026)", Shotstack schema details, Motion Canvas licence plans.

## Evaluation, acceptance and budgets

Every pass ships with a check an agent can run. Craft is measured with concrete signals, because AI editors fail mostly on craft: on Timeline-Bench (a September 2026 preprint), the best agent solved 26.8% of real editing tasks, and most failures were quality-only.

**Golden set:** 12 frozen projects (4 commentary, 4 investigative, 4 explainer), plus react and montage fixtures. Seed traps: one with no findable sources, one with a deleted or paywalled key source, one where the other side is right, one tempting a clinical label, one with conflicting transcripts, VO takes with deliberate flubs, and steady and irregular music tracks.

**Gates**

| Area | Metric | Gate |
| --- | --- | --- |
| Claim map | Claim recall vs gold | 0.80 or more; other-side recall 0.70 or more |
| Claim map | Mirrored queries present | 100% |
| Receipts | Precision | 0.70 or more |
| Receipts | Both sides found when gold has both | Neither side zero |
| Verdicts | Entailment accuracy | 0.85 or more; refute recall 0.80 or more |
| Script | Origin share (projects with Receipt Talk) | 80% or more per section |
| Script | Unsupported factual sentences shipped | 0 |
| Script | Linter pass after one rewrite | 90% of model spans clean |
| Script | Structure check | 100% |
| Script | Seeded overclaims missed | 0 |
| Verification | Shipped quotes verified | 100%; all seeded speech-to-text inventions caught |
| Recording | Alignment boundary error | 200 ms or less for 90% of words |
| Recording | Seeded flubs handled | Last clean read chosen in 95% |
| Footage | Shot boundaries | Within 2 frames of hand labels |
| Footage | Search | Labelled match in top 5 for test queries |
| Edit plan | Mid-word cuts | 0 |
| Edit plan | Montage beat alignment (steady tracks) | 90% of cuts within the tuned offset |
| Edit plan | Seeded rule violations caught by reviewer | 100% |
| Edit plan | Recipes render from fixture plans | 100% pass their checks |
| Export | .otio round trip | Same cuts and durations on reopen |
| All | Idempotency | Same key means 0 model calls |
| All | Regression | No metric drops more than 2 points release to release |
| Product | Edit distance on SAID; time to an acceptable script | Tracked; target 90 minutes of your active time for a 12-minute video |

**Craft signals the reviewer measures:** cuts per minute (PySceneDetect), longest static stretch, integrated loudness (EBU R128), silent share, clip share, engagement per clip. Optionally a pairwise preference judge, but never as a gate for taste.

**Running it:** deterministic checks on every commit; model-dependent evals nightly and on any prompt, routing or model change, using batch pricing. A prompt change merges only with its eval report. A Timeline-Bench task subset can serve as an external regression suite if its licence allows.

**Cost and latency (estimates for a 12-minute video, about 50 beats)**

| Pass | Model tier | Estimated cost |
| --- | --- | --- |
| Claim map | Strongest | About $0.45 |
| Receipts extraction | Small | About $0.45 |
| Perspective questions | Mid | About $0.30 |
| Entailment (about 150 pairs) | Small, cached | About $0.70 |
| Verdict synthesis | Strongest | About $0.65 |
| Per-beat SAID assembly | Mid; strongest for cold open and verdict | About $1.00 |
| Five checks | Small plus deterministic | About $0.50 |
| Edit planning | Mid | Not yet estimated |
| Refinement (3 passes max) | Strongest | About $2.25 |
| Total model spend |  | About $6 to $8; cap $25 |

Speech-to-text minutes (sources, interviews, VO, re-hearing) are the main extra cost. Latency targets: claim map 2 minutes or less, receipts 10 or less, verdicts 5 or less, script 5 or less, alignment at half the audio length or less, change card within 60 s. Re-price against current rates at setup.

## Ticket order and milestones

Build the core engine first and prove it on react mode, because react reuses your existing transcript editor and needs the least research. The essay family follows. (Build Spec v2 put the essay mode first; this is flagged as a decision in section 17.)

| ID | Ticket | Acceptance check | Depends on | Milestone |
| --- | --- | --- | --- | --- |
| A01 | Read-only audit of the existing repo | docs/reconcile.md answers the section 17 checklist | None | M1 |
| A02 | Data model, immutable versions, audit log, edit-plan entities | Version and supersede tests pass; audit log append-only; locks survive every pass | A01 | M1 |
| A03 | Pass runner: idempotency, item-level resume, state machine | Same key means 0 model calls; killed run resumes; illegal transitions rejected | A02 | M1 |
| A04 | Model router, cost meter, cache keys | Per-pass tiers; budget cap pauses; cache hit test | A03 | M1 |
| A05 | Security and observability basics | Encrypted storage; logs keyed by project and pass | A02 | M1 |
| A06 | Footage logging plus proxies | Golden footage logs end to end; boundaries within 2 frames | A02 | M1 |
| A07 | Footage search by text and role | Labelled match in top 5 | A06 | M1 |
| A08 | Assembler: plan to timeline, cut rules, 30 ms fades | No mid-word cuts on the golden set | A02 | M1 |
| A09 | Reviewer: rules plus craft signals, one retry | Seeded violations all caught; second failure flags you | A08 | M1 |
| A10 | OpenTimelineIO export | .otio reopens with the same cuts and durations | A08 | M1 |
| A11 | Editor shell: block timeline, SAID/SHOW, chat rail, change cards | Screenshot tests against design; reorder by touch | A02, design D1 | M1 |
| A12 | Recording jobs, record block, flub detection | Last clean read kept for 95% of seeded flubs | A11 | M1 |
| A13 | Alignment, per-block clips, mismatch exceptions | Boundaries within 200 ms for 90% of words; exact mismatched lines named | A12 | M1 |
| A14 | Deterministic linter and voice profile | Unit test per rule; blend at 1,500 and 5,000 words | A02 | M1 |
| A15 | React mode: transcribe source, moment scoring, gap types, cue cards, pacing flags, attribution | React golden project renders with every clip followed by commentary | A07, A08, A13, A14 | M1 |
| A16 | Pull list, placeholders, provenance attestation | No clip "ready" without attestation; placeholder renders | A08 | M1 |
| A17 | Verification sweep | Export blocked while any quote is unverified | A13, A16 | M1 |
| A18 | Rough-cut render and export QC | QC checks pass on fixture | A08, A17 | M1 |
| A19 | Chat intake to brief, plus voice intake | Fixture chat produces a full brief; loaded stance rewritten | A03 | M2 |
| A20 | Claim map and Gate 1 | Claim recall 0.80 or more nightly; mirrored queries 100% | A04, A19 | M2 |
| A21 | Receipts with saturation stop | Saturation rule tested; both-sides metric reported | A20 | M2 |
| A22 | Verdicts, matrix, Gate 2 | Entailment 0.85 or more; overrides mark downstream stale | A21 | M2 |
| A23 | Receipt Talk capture and span store | Spans retrievable with timings; skip sets fallback flag | A22 | M2 |
| A24 | Spine and script assembly | Origin share 80% or more on golden interview projects; one rewrite then stop | A14, A23 | M2 |
| A25 | Five checks | All seeded unsupported sentences and overclaims caught | A24 | M2 |
| A26 | Document block renderer | Hold formula unit-tested; render snapshot | A11 | M2 |
| A27 | Planner prompt and all mode presets | Each preset produces a valid plan for its golden project | A08, A26 | M2 |
| A28 | Audio chain: cleanup, ducking, loudness | Output −14 ± 1 LUFS, −1 dBTP or lower | A13 | M3 |
| A29 | Captions from aligned SAID | Line, cps and duration limits met | A13 | M3 |
| A30 | Description, chapters, sources page, attribution | Chapter validator passes; attribution per clip | A18 | M3 |
| A31 | Recipes: supercut, side-by-side, b-roll cover, teaser, time compression, recap, freeze-frame, match cut | Each renders from a fixture plan and passes its checks | A08 | M3 |
| A32 | Music analysis and beat-synced montage | Montage cuts within the tuned offset on steady tracks | A07, A31 | M3 |
| A33 | Reframe for vertical and colour normalization | Subject stays in frame on fixtures | A08 | M3 |
| A34 | Named refinement passes (3 max) | Fourth pass refused; each change card has diffs and accept/reject | A25 | M4 |
| A35 | Golden-set eval harness and CI | Fast checks per commit; full set nightly with report | A15, A25 | M4 (fixtures start in M1) |
| A36 | Channel risk dashboard and dispute files | Dashboard shows clip share, engagement pass rate, template similarity | A15 | M4 |
| A37 | YouTube upload (optional) | Uploads private or unlisted within quota | A30 | M5 |
| A38 | Retention feedback per block | Drop-offs shown on the plan after publish | A37 | M5 |

**Milestones:** M1 core engine proven on a react video, M2 research pipeline and essay family, M3 media polish and recipes, M4 quality loop, M5 publishing and feedback.

**Non-goals for M1 and M2:** free-form NLE trimming, multi-user collaboration, stock b-roll search, generative video or imagery, voice cloning, auto-publishing, translation, model judges for naturalness, more than 3 refinement passes, any YouTube download path.

**Agent setup (from Build Spec v2):** a short CLAUDE.md (glossary, commands, architecture boundaries, hard rules: never mutate artifacts in place, never ship an unverified quote, never download from YouTube, no model judge for naturalness, one rewrite then stop). Put occasional knowledge in skills (register lock, linter rules, recipe craft, media export, legal red lines). Put must-always rules in hooks (run tests and linter after edits; block writes to golden fixtures). One fresh session per ticket, plan mode for multi-file tickets, each ticket ending in a runnable check.

## Claude Design brief

Design chat-first, with gates, change cards, pull items and recording usable on a phone. The editor is desktop-first; on mobile it is read, review and record only.

**Principles**

- Provenance is always visible: span colour by origin (yours, quote, model-written).
- Evidence status badges everywhere (verified, needs re-hearing, placeholder).
- Every agent change is a reviewable, reversible card. Every score shows its reason.
- One brand kit: lower-thirds, title cards, colours and motion presets look the same in every video.

**Screens**

| # | Screen | Key components | States |
| --- | --- | --- | --- |
| D1 | Editor: SAID column, SHOW column, block timeline, chat rail | Beat row, origin-coloured spans, lint tags, block thumbnails, track lanes | Empty, generating, stale beats, lint flags, offline |
| D2 | Chat intake | Messages, voice button, brief card, mode picker | First run, recording, transcription failed |
| D3 | Processing view | Pass progress, per-claim counters, cost meter, pause | Running, paused, blocked, budget hit, error |
| D4 | Gate 1: claim map | Claim cards (side, type, rank), approve, edit | Too few claims warning |
| D5 | Gate 2: verdicts | Matrix on desktop, swipe cards on mobile, override sheet | All unsupported prompt, insufficient evidence |
| D6 | Receipt Talk | Receipt viewer, large record button, 30 to 120 s guide, skip | Mic denied, too quiet, silence |
| D7 | Record block | Current line large, next dimmed or cue card, level meter, chunk progress | Flub detected, mismatch, manual advance |
| D8 | Inline record card (chat) | One line, record, playback |  |
| D9 | Pull session (Gate 3) | Pull item: supply file, keep placeholder, drop; attestation | Upload failing, unsupported format |
| D10 | Verification sweep | Checklist, audio re-hear player with context span | All clear, blocking items |
| D11 | Change card | Title, summary of 280 characters or fewer, diff, accept, reject, partial |  |
| D12 | Export and publish | Preset, QC results, description and chapters editor, disclosure toggle, sources page preview, .otio download | QC fail, rendering, done |
| D13 | Voice profile | Word count toward 1,500 and 5,000, metric trends, overrides | Cold start |
| D14 | Projects home | Project cards with state and resume | Empty, archived |
| D15 | Edit plan view | Block cards with purpose, recipe chip, duration, locks, receipts | Planning, reviewer flags, regenerate block |
| D16 | Footage library and search | Search by text and role, shot thumbnails, tags, quality flags, one-tap tag fix | Logging in progress, no results |
| D17 | Music map | Waveform with beat and downbeat markers, sections, cut points | Irregular track warning, manual markers |
| D18 | React gap editor | Clip, gap, clip lanes; style toggle per gap (scripted, freestyle, anchored); cue cards; pacing flags | Unbroken clip warning, missing commentary |
| D19 | Version compare | Two plan versions side by side, diff list, proxy previews |  |
| D20 | Channel risk dashboard | Clip share, engagement pass rate, template similarity across recent videos | Warning thresholds |

Deliver empty, loading and error states for every screen, and 390-pixel mobile variants for D2, D4, D5, D6, D8, D9, D11 and D18.

## Corrections ledger

Read the source reports with this table open. Each row says what an earlier report said and what is true now.

| Item | Earlier claim (source) | Now |
| --- | --- | --- |
| VO recording flow | Editor teleprompter, hotkeys, per-line retake (R1) | One-take recording jobs per section; exceptions in chat; no hotkeys (section 7) |
| Who writes SAID | Unclear between your words and system-written from verdicts (R2–R4) | Receipt Talk transcript plus quotes; model edits and bridges only (section 6) |
| Sentence-length targets | Fixed 12–18 words (R1) vs your profile only (R2) | Cold-start defaults, blend at 1,500 words, full switch at 5,000 (section 6) |
| "3–5 s shot" rule | Implied default (R1 draft) | Unverified; one visual beat per sentence instead |
| "Change music every 20 s" | Vendor blogs (R1) | Change music at section breaks only |
| Netflix reading speed | "17–20 cps" as one number (R1) | 20 adult, 17 children; use 17 |
| −14 LUFS | "YouTube's spec" (R1 framing) | A convention; YouTube doesn't publish it as a rule |
| YouTube upload quota | 1,600 units, about 6 a day (widely repeated) | Own bucket of 100 calls a day at 1 unit (R5) |
| Pull list | Implied downloading (R4) | Reference placeholder by default; lawful routes only (section 10) |
| Fact-check gaps | "Mixed": scripted line then freestyle (chat, R6 input) | Anchored freestyle with locked tokens (R6) |
| Rebuttal | Separate mode (chat) | React preset (R6) |
| Shorts | A mode (chat) | Render target (R6) |
| Document read-through | Reading documents aloud (chat) | Must interleave analysis; mostly-reading breaks YouTube's reused-content rule (R6) |
| MVP order | Essay first (R5) | React first, then essay (this spec; your decision, section 17) |
| Reviewer | Rules only (D1) | Rules plus measured craft signals (R7) |
| LAVE study size | Sometimes paired with 110 | LAVE had 8 participants; B-Script had 110 |
| TransNet V2 | "Best" on all sets | Ties on RAI (93.9; original TransNet 94.3); best on ClipShots and BBC |
| Beat tracking on GTZAN | Beat F1 up to 97.5, downbeat 79.6 (D1) | Beat This: beat 89.1, downbeat 78.3 on GTZAN; 97.5 is not a GTZAN figure; BeatFM figures unverified |
| 80 ms beat offset, 0.5 s min hold | Defaults (D1) | Unmeasured; tune by blind A/B |
| CutClaw sync accuracy | Δt ≤ 0.1 s (secondary) | Unverified; CutClaw has no licence, ideas only |
| "VideoAgent (2026)" | Cited (D1) | Ambiguous name; don't cite |
| Murch's Rule of Six | Scoring weights (implied) | Review vocabulary and tie-break order, not weights |
| Model judges for edit quality | Used by EditDuet and CutClaw | Not trusted for taste here; professionals beat EditDuet 75.1% of the time |
| Reaction-video case law | *Hosseinzadeh* caveat that not all reactions are fair use | Still true, but *Ted Entertainment v. Saber* (2026) found a long co-viewing stream fair use |
| Clip-to-commentary ratio | "40–50% commentary" (creator blogs) | No court, policy or study sets one; use pacing flags |
| July 2025 YouTube update | "Targeted reaction channels" (blogs) | YouTube says the reused-content policy did not change |
| Licences | Not checked before R7 | madmom models non-commercial; videogrep "Anti-Capitalist"; CutClaw unlicensed; Remotion needs a company licence at 4+ people (section 11) |

## Idea index

Every distinct idea from the reports and our chats, with its status. Adopted ideas live in the section named; deferred ones wait for the milestone named; open ones need a test or your decision. If an agent finds an idea missing from this list, it should propose it.

| Idea | Source | Status | Where |
| --- | --- | --- | --- |
| 12–18 words per sentence as cold start; punch sentence every 4–6 | R1 | Adopted | §6 |
| 165 words per minute planning rate | R1 | Adopted | §8 |
| Breath marks: pause after each sentence, long pause plus music-change candidate at section breaks | R1 | Deferred to assembler pause rules | M3 |
| Spoken attribution only when no receipt is on screen; otherwise no "as X put it" | R1 | Adopted (add to register rules) | §6 |
| Document block: highlighter, hold formula, read only the highlighted span | R1 | Adopted | §8 |
| Match cut on the same phrase across several documents | R1 | Deferred | M3, match-cut recipe |
| Textured, physical document look (grain, paper, pins) | R1 | Deferred | Brand kit |
| Measure Vox and reference channels with scene detection | R1 | Open | §17 |
| Music about 20 dB under voice; changes at section breaks | R1 | Adopted | §8 |
| Anecdote-first vs stat-first opening A/B | R1 | Superseded by templates A/B/C; A/B kept | §6 |
| Teleprompter and hotkey recording | R1 | Rejected | §15 |
| Auto-transcribe every take and diff against SAID | R1 | Adopted | §7 |
| Voice-clone patching of single words | R1 | Rejected for M1–M2 | §13 non-goals |
| Talk-first evidence interview (Receipt Talk) | R2 | Adopted | §6 |
| 80% origin share from you or quotes | R2 | Adopted | §6 |
| Deterministic linter; one rewrite; no model judge | R2 | Adopted | §6 |
| Voice profile from intake, interviews, past essays and past videos | R2 | Adopted | §6 |
| Show two short alternative bridges for one beat | R2 | Adopted | A34 refinement |
| Learn from your edits into a personal ban list | R2 | Adopted | §6 |
| Personal fine-tune or anti-slop decoding | R2 | Deferred | After M5 |
| Flags as named categories, never one score | R2 | Adopted | §6 |
| Reporting frame, exemplars, per-beat generation | R3 | Adopted | §6 |
| Ban second-person audience address and rhetorical questions outside the promise beat | R3 | Adopted (add to linter patterns) | §6 |
| Opening templates A–C; D banned | R3 | Adopted | §6 |
| Counters refuted or conceded, never dropped | R3 | Adopted | §6 |
| Concept to outline pipeline; thesis chosen last | R3 | Adopted | §9 |
| Shared vocabulary for stages | R4 | Adopted | §2 |
| Loaded brief to hypothesis, both-sides search, scorecard | R4 | Adopted | §9 |
| Perspective questions interleaved with retrieval | R4 | Adopted | §9 |
| Factored verification; competing-hypotheses matrix | R4 | Adopted | §9 |
| Clip receipt schema; context span; context-stripping check | R4 | Adopted | §9 |
| Pull list batched by source; files auto-matched | R4 | Adopted | §10 |
| Three user gates only | R4 | Adopted | §3 |
| Named, scoped refinement passes, max 3, change cards | R4 | Adopted | §3, A34 |
| Single-source cap; no clip without a narration beat | R4 | Adopted | §10 |
| Behaviour not diagnosis; clinical-word lint | R4 | Adopted | §6, §10 |
| Question bank per pass | R4 | Adopted | §9 |
| Full data model, idempotency, stale propagation | R5 | Adopted; R5 §4 is the field-level reference | §3, A02 |
| Cost and latency budget | R5 | Adopted | §12 |
| Golden set with seeded traps | R5 | Adopted | §12 |
| CLAUDE.md, skills, hooks | R5 | Adopted | §13 |
| Captions, export, packaging targets | R5 | Adopted | §8 |
| YouTube upload via API | R5 | Deferred | M5 |
| React pipeline | R6 | Adopted | §5, A15 |
| Moment-scoring rubric (check-worthy claims, contradictions, rhetorical moves, audience response, prosody, quotability, your flag, speech-to-text confidence gate) | R6 | Adopted; R6 has the weights table | A15 |
| Gap types, styles and defaults; cue card; descriptive-line rules | R6 | Adopted | §6 |
| Pacing flags instead of a ratio | R6 | Adopted | §10 |
| Fillers trimmed to 5 per minute or fewer, not zero | R6 | Adopted | §6 |
| New modes (investigation, footage verification, explainer, developing story) | R6 | Adopted | §5 |
| Channel risk dashboard; dispute file per video | R6 | Adopted | §10, A36 |
| Annotate 20–40 react videos to calibrate pacing | R6 | Open | §17 |
| video-use loop: transcripts and stills, session memory, render self-check | R7 | Adopted | §4 |
| OTIO mapping with namespaced metadata and receipt markers | R7 | Adopted | §4 |
| Craft-signal reviewer | R7 | Adopted | §12 |
| Recipe-craft guidance file | R7 | Adopted | §8 |
| Reversible edits; persisted settings; must-use lock; explained scores; visible beat markers | R7 | Adopted | §4, §14 |
| Timeline-Bench subset as regression suite | R7 | Open (licence check) | §12 |
| Blind A/B of beat offset and minimum hold | R7 | Open | §17 |
| Lighthouse query-to-moment retrieval | R7 | Optional | §11 |
| Edit plan fields, recipes, style idioms, scene roles | D1 | Adopted | §4, §8 |
| Visual-beat motion warping | D1 | Deferred | After M3 |
| Proxies, dedupe, reframing, colour, SFX, brand kit, version compare | D1 | Adopted | §8, §14 |
| Retention feedback per block | D1 | Deferred | M5 |
| Generative fill off by default, disclosure if used | D1 | Adopted | §8 |
| Montage default order: chronological vs energy build | D1 comment | Open | §17 |
| Hybrid UI: chat-first, then processing or editor with chat rail | Chat | Adopted | §2 |
| Per-gap style toggle by tap or chat line | Chat | Adopted | §5 |
| Research depth as a per-mode dial | Chat | Adopted | §2 |
| Inline record card for short VO | Chat | Adopted | §7 |
| React-first build order | Chat | Adopted, pending your confirmation | §13, §17 |

## Open decisions, measurements and reconcile checklist

These are the only things left that research can't settle. Most get answered by building and testing.

**Decisions only you can make**

- [ ] MVP order: react first (recommended) or essay first
- [ ] Clip acquisition beyond the compliant default, after the lawyer review
- [ ] Per-project budget cap (default $25) and speech-to-text engine (local or hosted)
- [ ] Whether "prefer what I said" updates SAID by default after the first project
- [ ] How long raw interview audio is kept
- [ ] Whether AI-generated imagery is allowed at all (it triggers disclosure)
- [ ] Montage default order: chronological or energy build

**Measurements to run**

| Measurement | How | Feeds |
| --- | --- | --- |
| Your voice baseline | Record about 10 minutes of yourself talking through a topic; add past scripts if any | Linter profile switch |
| Reference channel pacing | Scene detection on 3 to 5 Vox and essay videos you rate; median and range of shot length | SHOW defaults |
| SAID counts for Vox and Johnny Harris | Hand count from transcripts, as done for Every Frame a Painting and Folding Ideas | Linter cold-start |
| React structure | Annotate 20 to 40 react, debunk and commentary videos by watching normally with a timer | Pacing flag defaults |
| Footage search quality | Label 50 shots of your own footage; test captions and tags in search | Whether to change the logging model |
| Beat offset and minimum hold | 20 to 30 test edits; vary offset (0 to 3 frames) and hold (0.3 to 1.0 s); blind pairwise preference | Cut rules |
| Opening template | A/B Cold Receipt vs Headline Finding with YouTube's 30-second intro metric | Default template |
| Linter thresholds | Tune on the golden set | Section 6 table |
| Timeline-Bench licence | Check before reusing its tasks | Regression suite |

**Reconcile with the existing code (ticket A01)**

- [ ] Where projects, versions and history live today; can they support immutable versions and supersede links
- [ ] Whether a job runner exists, and if it can take idempotency keys and item-level resume
- [ ] A single module for model calls that can become the router; where prompts live
- [ ] Existing timeline and block model mapped to edit-plan blocks; list the gaps
- [ ] Whether the chat UI can render cards (brief, change card, record card, pull item)
- [ ] Audio stack: capture at 48 kHz, an aligner, a loudness meter
- [ ] Render path: can it hit the export preset; where captions come from today
- [ ] Any code that downloads from YouTube, to remove or gate
- [ ] Auth, storage encryption, backups and logging: present or missing
- [ ] Test runner, fixture location, CI
- [ ] Name collisions with the glossary (an existing "Clip" or "Segment" type)
