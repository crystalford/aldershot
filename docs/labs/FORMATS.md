# Formats — genre is an edit decision, not a writing instruction

7 Oct 2026, from the quality research pass. The founder's observation, with the mechanism under it. Nothing here is built.

## The one-line version

**A genre word is a costume.** Ask for "a documentary" and the model performs the genre's surface — the compressed narrator, the dramatic pause, the cliffhanger. Ask for an article that lays out the facts and makes the argument, and it does the work. So: the user still types "make me a short"; the system translates it into a **brief** (facts, claim, audience, structure, spine) and the genre word never reaches the writer. The genre is applied afterwards, in the edit — pace, length, cut style, captions — as an **edit profile**.

## Why the costume happens (three stacked mechanisms, all measured)

1. **Persona prompts don't buy quality.** 162 personas × 2,410 questions × 4 model families: no reliable improvement; expert roles raise terminology and *reduce* clarity. "Make a documentary" is a persona prompt's cousin.
2. **Preference tuning causes typicality bias.** Annotators prefer familiar text; reward optimisation sharpens the model toward it. A genre word narrows the prompt to a region where the most typical answer is the genre's caricature — and the stock *beat sequence*, not just the words.
3. **Instruction tuning flattens register** (noun-heavy, participial, "genre misalignment"), so performing a genre layers stereotyped markers on an already-skewed voice.

Linguistics names the split: **genre markers** are conventional and cheap to imitate (the cold open, "but what they found…"); **register** features are functional — they appear because the situation calls for them. A label hands the model the markers; a brief hands it the situation.

**Plan, then realise.** Explicit content plans cut hallucinated words from 20.9% to 8.1% in table-to-text; structural variety comes from varying the plan, not the decoder. The writer's job is narrow — realise a plan in a plain register — and that is the part models do best.

**This settles our earlier argument.** Drafting from a thesis is fine. What failed was drafting from a *genre* with no plan. The rule becomes: *the model drafts from a plan in a plain register; the genre never reaches the writer; the user's own words win wherever they exist.* No voice fine-tune needed for that.

## The pipeline

1. **Intent parse** — the only place the genre word is read. "Make me a short about the Thames Barrier" → `spine` (primary + optional secondary) · `stance` · `edit profile` · `audience` · `length` · `platform`. The word is stored in the profile and discarded downstream.
2. **Brief** — what the writer sees: exigence (the one-sentence question) · claim (what the viewer leaves with) · evidence ledger (facts with source ids) · audience · structure (the spine's moves, e.g. question → stakes → evidence 1–3 → counterpoint → resolution) · a fixed register instruction ("plain declaratives for a reader; no rhetorical questions unless listed; no teaser or cliffhanger language") · length budget from the profile's duration × the user's measured words per minute.
3. **Writer firewall** — a deterministic lint, not a model: a maintained stoplist of genre markers ("in a world", "but what happened next", "little did", "buckle up", "let's dive in", "you won't believe", "forever changed", end-of-script questions, second-person hooks outside hook beats). On a hit, regenerate that sentence only.
4. **Edit profile, applied after the read is aligned** — pace, cut grammar, captions, aspect, music bed, trimming, opening and closing. It may *select* beats (a short = the claim + its strongest evidence), *reorder* (cold-open on the best receipt), never rewrite prose — except:
5. **The one sanctioned writing touch: the hook line.** Generated *after* the essay exists, as a compression of the claim beat: "state this paragraph's claim in under 12 words, as a plain statement of fact." It inherits the argument's facts instead of inventing drama. (Openings matter — most ad viewers leave in the first quarter — but it's an *edit* problem: which beat, shot and caption come first. Not a reason to write the whole script in hook-speak.)

## Spines — the real modes

Classify by **organising principle**, not topic. This matches how scholars classify (Nichols' documentary modes are about how a film argues; platform categories are topic buckets that don't predict form; hybrids are the norm — "tutorial-vlogs" out-view plain tutorials 4:1).

| Spine | Organising unit | What good looks like | Formats |
|---|---|---|---|
| **Argument** | claim + evidence | one stated claim; every assertion has an on-screen receipt; the strongest counterpoint answered; the viewer can restate the claim | essay, explainer (contested), investigation, debunk, commentary, review, breakdown |
| **Exposition** *(new)* | concept + prerequisite | dependency order; one new idea per beat; worked example before abstraction; recap | lecture, explainer (uncontested), one-concept short |
| **Chronology** | event + consequence | causal chain ("because", not "and then"); stakes before the turn; dates on screen; a plain resolution or a named open question | documentary, mini-doc, true crime, timeline, retrospective, recap, trailer |
| **Source-clip** | source moment + response | the source shown long enough to be fair; the response adds what the source lacks; clear separation of source and commentary; rights-aware lengths | reaction, rebuttal, watch-along, stitch/duet, drama commentary |
| **Person** | a moment in a life or day | specificity over summary; a want carried through; authentic sound | vlog, day-in-the-life, travel, profile, storytime |
| **Conversation** | exchange | exchanges with a turn or reveal; speakers identified; no answer edited to change meaning | interview, podcast, panel, debate |
| **Task** | step + visible outcome | nothing skipped; show then tell; before/after each step; failure points flagged | tutorial, walkthrough, devlog, teardown, case study |
| **Comparison / ranking** | item + criteria | criteria stated first and applied consistently; ranking reproducible from what's shown; ties admitted | top-N, tier list, versus, buyer's guide |
| **Pattern** | repeated instance | the repetition makes the point; variation escalates; one closing instance reframes | supercut, montage, data story |
| **Fragment** | a self-sufficient unit of a parent | understandable with zero parent context; claim + evidence in one clip; no truncated payoff; attribution | shorts, trailer, teaser, quote card, audiogram |
| **Performance** | the bit | timing; setup–payoff integrity; rhythm locked to audio | sketch, parody, mockumentary, music video, essay-film |
| **Live / ambient** *(new)* | continuous real time, low event density | uninterrupted flow; audio intimacy; navigable by chapters — mostly a *source* Aldershot edits down | let's play, livestream VOD, ASMR, study-with-me |

**Stance** (from Nichols) is a second axis, orthogonal to spine — it sets voice and how evidence is presented, not organisation: expository (narrator argues) · observational (footage speaks) · participatory (maker on screen) · reflexive (shows its own construction) · performative (the maker's experience is the evidence) · poetic. "Make a documentary" → `spine = chronology, stance = expository | observational`, and the word is gone.

**Composition rule:** one primary spine owns the macro-structure and the claim; one secondary owns the beat interior; the profile reads the primary for pacing. Investigation = Argument × Chronology. Reaction = Source-clip × Argument (or × Person). **Never more than two** — a third means it's two videos.

## Edit profiles — genre as a parameter set

A deterministic set applied to the aligned timeline: duration (target, min, max; trimming priority by role) · pace distribution per role and a curve across the piece · cut grammar (jump-cut allowance, J/L ratio, cut-on-word vs cut-on-breath) · opening rule (which beat, seconds to first proposition) · closing rule · frame and safe zones · captions (burned/sidecar, CPS, chars per line, word-pop vs sentence) · audio (loudness, true peak, bed density, ducking depth) · typography density · beat-selection policy.

Starting defaults (measured norms named; everything else is a default to tune on our own retention data, not an industry fact):

| Profile | Duration | Pace | Opening | Captions | Loudness |
|---|---|---|---|---|---|
| long-form essay / explainer | 8–25 min | median ~3–5 s; receipts ≥ reading time | proposition by ~0:30; no cold-open cliché | sidecar + selective type; ≤17 CPS | about −14 LUFS, ≤ −1 dBTP |
| short vertical | 20–60 s | median ~1–2 s; the proposition beat may hold 2–3 s | claim or receipt in 1–3 s | burned, ≤3 words per pop; out of the bottom ~20% | −14 LUFS |
| mini-doc | 10–30 min | slower, ~4–7 s; act curve | stakes before the first turn | sidecar; speaker ids and dates burned | −14 web · −23 broadcast |
| podcast full / clip | 30–120 min / 30–90 s | cut on speaker turn; hold reactions | the answer, not the question, within 3 s (clip) | sidecar / burned word-level | −16 LUFS (spoken word) |
| tutorial | 3–20 min | dwell until each step's outcome is visible | the finished result first | sidecar + step numbers | −14 |

**Pace is a tool, not a virtue.** Dense cutting widens attention and shortens encoding right after each cut; it doesn't measurably harm cognition (19-study meta-analysis, d ≈ −0.12, n.s.). So pace is set **per beat by information load**: receipts, first appearances of a fact, and data visuals get dwell time; connective beats can run fast. Rule: *no cut within N frames of a new on-screen fact*, N from reading time. Fast tempo is legitimate as long as the proposition beats breathe.

**Captions:** target ≤17 characters per second, ceiling 20 (the streaming standard; trailers measured at these limits). Text that would exceed it is condensed, never sped through.

**One brief, every format.** Because the brief, beats, archive and aligned read are format-independent, one job can emit every profile as a *render variant* — long-form, three shorts, a trailer, an audiogram — over the same timeline, reusing the real read. The editor's Cut / Shorts toggle is already this principle in miniature.

## Fragments — the self-sufficiency test

The top complaint about AI clippers: cut mid-thought, context stripped, virality scores that rank but don't predict; users discard 20–40% of output. Highlight detection finds the *salient* moment and has no idea whether it stands alone. We know the argument, so a fragment is valid only if:

1. it contains a complete claim **and** its evidence beat — not a span picked for loudness or laughter;
2. every referent resolves — no dangling "he", "this", "that number"; unresolved ones get a one-line card ("[Thames Barrier, 1982]");
3. its meaning in isolation **entails the parent's** — the out-of-context failure is also a fairness failure for people shown;
4. it ends on a beat boundary from the alignment, never mid-sentence;
5. it's attributed to the parent.

Highlight models become the candidate generator; the beat graph plus this test is the judge. Shorts' *Strong / Worth a look / Long shot* with reasons is the right surface — "leans on the line before it" and "ends mid-thought" are reasons.

## The quality map — what's still missing, in priority order

1. **Audio.** The single highest-leverage fix: identical talks with degraded audio get rated as worse research by a less intelligent researcher; low-quality audio makes witnesses less credible (d = .32–.55) and worse remembered (d = .44). Build: noise removal and de-reverb on ingest; a per-segment intelligibility score; music ducked under voice keyed to word timings; loudness normalised to the profile (YouTube turns loud content *down* toward about −14 LUFS and never up — a quiet mix stays quiet); true-peak limiting.
2. **Captions**: reading speed enforced; placement away from UI safe zones, mouths and evidence; speaker labels; names spelled from the archive's documents; a sidecar file always exported; **detect existing burned-in subtitles so new ones never stack on them**.
3. **The opening and the payoff contract**: the proposition or its receipt within the profile's limit; whatever the title and opening promise, the body delivers — checkable from the brief.
4. **Fragment context safety** (above).
5. **Traceability**: a claim → source → timestamp manifest with every render; every on-screen number checked against its document; patch one beat → re-render every variant. Set the platform's synthetic-content disclosure automatically when generated video or voice touches a real-world depiction.
6. **Rights**: licence state per asset (owned · stock · CC-attribution · fair-use rationale · music scope); block an export whose platform is outside the music licence; record commentary-to-clip ratios as evidence of transformative use. YouTube's July 2025 "inauthentic content" policy targets mass-produced templated uploads and explicitly leaves commentary, clips and reaction unchanged — argument-first, archive-grounded, real-voice output is the structural opposite of what it targets, and the product should make that legible.
7. Colour matching across mixed sources (a strong graphic system tolerates mixed footage better than naturalistic grading). 8. Continuity errors (flash frames, orphans, accidental jump cuts, a cut on a new fact, the same shot for two propositions, text over faces or evidence). 9. A per-channel house profile inherited by every edit profile. 10. Titles and thumbnails — generated from the claim and the strongest receipt frame, promise-checked, A/B-tested natively; no rigorous public evidence worth building on.

## Who decides

- **System decides, reversibly:** loudness, captions, safe zones, flash frames, colour, reading speed, ducking.
- **System proposes, user confirms:** the claim and its counterpoint · any identifiable person shown in a critical light · fragment selection for people-focused clips · fair-use beats · title/thumbnail · anything the factual check flags.
- **User only:** publishing, disclosure overrides, licence attestations.
- **At most 3–5 questions per video, batched at two moments — after the brief and before the final render. Never mid-render.** (This is Ask · Recommend · Auto and *Before you post*, confirmed.)

## The final gate

Off-the-shelf multimodal judges agree poorly with humans on video (Spearman ~0.23 for the best; often the same score for both candidates); trained metrics and deterministic checks carry the gate. **Tier A, automatic and blocking:** container/frame-rate/aspect per profile, A/V sync ≤1 frame · loudness ±1 LU, true peak, dialogue-to-music ratio · no black/frozen/flash frames, no cut on a new fact · captions within CPS, synced within 3 frames, not stacked, not in safe zones · every on-screen number and name resolves to the ledger · licence state compatible with the platform · fragments pass self-sufficiency · writer lint clean. **Tier B, advisory with timestamps:** quality-score dips per shot vs the project median · colour mismatch · pairwise model checks ("does this receipt shot visibly support beat 4?") · pacing curve vs profile · identifiable people in counterpoint roles. **Tier C, human — 3–5 batched decisions.** Retention curves are the only ground truth for engagement; map drop-offs back to beats so analytics say "beat 3's receipt lost 18%," not a raw curve.

## What this changes in Aldershot

- **The Cut / Shorts toggle is the principle made visible**: same footage, same rules, a different edit profile. Future profiles (mini-doc, trailer, audiogram) are entries in that toggle — data, not code. The user never sees the word "spine"; Home's intent parse uses it to pick the beat template and the profile.
- **The writer firewall and the plain-register brief replace the voice-profile idea** (tabled). Light editing is enough when the material is facts plus argument.
- ***Before you post* gains the deterministic promise**: loudness, ducking, captions and a subtitle file pass every export. *(Product copy updated.)*
- **Shorts' reasons gain self-sufficiency**: "leans on the line before it", "ends mid-thought", "says what the parent doesn't" — when real footage arrives.
- **Questions stay batched at two moments** — after the brief, before export — confirming the current shape.
- Audio cleanup on ingest, caption standards, the claim manifest and licence states are backend items for the handoff.

## Sources

- Persona and typicality: Zheng et al. (EMNLP Findings 2024); Zhang et al., *Verbalized Sampling* (2025); Reinhart et al. (PNAS 2025); Doshi & Hauser 2024; PNAS Nexus homogeneity study.
- Genre vs register: Biber & Conrad, *Register, Genre, and Style*; Bitzer 1968; Swales 1990; Reiter & Dale; Puduppully et al. (AAAI 2019); Moryossef et al. 2019; Liu et al. (AAAI 2021); PlanGen (Su et al. 2021).
- Classification: Nichols' documentary modes; Burgess & Green; Cunningham & Craig; YouTube Shorts category analysis; tutorial-vlog study.
- Pace: Cutting, DeLong & Nothelfer (Psychological Science 2010); Balzarotti et al. (Cognitive Science 2021); Andreu-Sánchez et al. (EEG); Hinten et al. (Developmental Science 2025); Murphy et al. on playback speed.
- Audio: Newman & Schwarz (Science Communication 2018); Bild et al. (Law and Human Behavior 2021). Loudness: ITU-R BS.1770; EBU R128; Apple/AES spoken-word guidance; YouTube normalisation behaviour.
- Captions: Netflix Timed Text Style Guide; WCAG 2.x SC 1.2.2/1.2.5; FCC caption-quality pillars; 2025 streaming-trailer reading-speed study.
- Fragments: QVHighlights (Lei, Berg & Bansal, NeurIPS 2021); Moment-DETR; SG-DETR; reviews and tests of commercial clippers.
- Judges: VideoScore (He et al., 2024); MJ-Bench-Video (NeurIPS 2025); MLLM-as-a-Judge (Chen et al., 2024); DOVER (ICCV 2023); Q-Align; VMAF.
- Policy: YouTube monetization policy update, 15 July 2025; TikTok/Kantar Creative Codes (2022, vendor research, directional).
