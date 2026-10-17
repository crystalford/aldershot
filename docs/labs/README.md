# labs/

Explorations that are **not part of the product**. Nothing in `labs/` is linked from Home, the Editor, Settings or the Manual, and no product file imports from here. Build freely; promote by rebuilding inside the product, not by linking across.

| File | What it is |
|---|---|
| `Recce.dc.html` · `Meet Recce.dc.html` | **Recce** — the character who looks outside. A component (props `state`, `size`) built from the wordmark's three bars, and a showcase of his six states, his lines, where he appears, and why a product that bans mascots has one indicator with a shape. Placed in the Scout board header; his state follows the run. |
| `Essay to video.dc.html` | A Canopticon essay ("The Feeling of Rightness") converted by hand into a two-column AV board — what's said / what's on screen — with the written paragraph each act came from. Now carries the **director layer**: a sound role per beat (Voice over · Exhibit · Document · Card), a source per beat (shot new · archive · scout · generated), the pacing rule as live sub-shot counts, and the four rules the board runs on. The worked example for the open question: how does a finished written essay become something Aldershot can cut? |

| `Footage sets.dc.html` + `samples.js` | Four footage sets chosen to be unlike each other — the three vlogs, a 2h50 planning committee, someone else's 3-hour stream, a 1h48 lecture with slides — run through the same rule engine. Each tab shows the Read, what it noticed, the rules (switchable), the resulting cut and what was left out, and **what the set demands of the product**. The bottom block is the cross-set list of what's missing. |

| `Directed plan.dc.html` + `plan-sample.js` | **Footage + brief → the plan.** Someone else's archive (three streams, five years apart), the user's own screenshots as evidence, one brief: *"make a video about his break from reality, overlaid with my screenshots where they prove what the narration says."* Shows the Read, the five rules compiled from the brief, and the plan as 11 blocks — what's said, which of his moments back it, which screenshot proves it, what's on screen, who's speaking. The pre-production shape, for judging before any engine exists. |

| `FOOTAGE-SYSTEM.md` | **How finding footage should work** — v2, two research passes (Oct 2026). Moments at two sizes (topic spans for context, utterances for matching); words-first hybrid retrieval fused by rank and reranked; a judge that returns backs-it / related-but-not-enough / nothing against a threshold we calibrate — because abstention is unsolved in the models themselves. Speaker identity across files; third-party fingerprints as "probable". Cost per hour. The evidence ledger. What to build first: the eval set. |
| `PICTURES.md` | **The gavel problem** — v2, two research passes. Why script-to-visual matching by nouns is an integrity problem (non-probative pictures raise belief, d ≈ .23) and a representation failure (every measured system keys pictures on words). The replacement: every block carries its move, the picture's *relation* to the sentence (status · job), one visible line — "after this, the viewer can say…" — and a fit-anywhere check that catches the gavel mechanically. Propositional redundancy as default, lexical redundancy banned, counterpoint budgeted. **Pictures before words**: narration written last over secured pictures. Motifs and authored repetition; pace from information load; narration in a spoken register; typography as a voice; where generated imagery earns its place; the Gavel Test Set. |
| `VISUAL-SUPPLY.md` | **Where pictures come from and how motion gets made** — code first (charts, diagrams and type are never pixels), generated stills as layered assets with motion from the compositor, paid video generation only when the subject must act and budgeted. One scene graph, many suppliers handing over layers; the evidence-bound chart compiler with its lints and the **receipt shot** (document → highlighted cells lift into the chart); the per-block quality gate; ≈ $2–4 per finished minute vs $15–72 all-generated. Style is the user's (tokens per user; quantise rasters to the palette); the constructivist look is a preset. |
| `FORMATS.md` | **Genre is an edit decision, not a writing instruction.** A genre word is a costume — the model performs the genre's surface. So the user's "make me a short" becomes a brief (facts, claim, audience, structure, spine); the genre never reaches the writer; it's applied afterwards as an edit profile. The twelve **spines** (the real modes), a stance axis, the two-spine composition rule, edit profiles as parameter sets with starting norms, the fragment self-sufficiency test, the quality map (audio first), who decides what, and the final QC gate. Resolves the earlier argument about drafting from a thesis. |
| `SCRIPT-AND-TIMING.md` | **The read is the timing master.** Everything anchored to word ids, never seconds; a real forced aligner (≈20 ms) over Whisper's (≈110 ms); re-timing rules (cuts on the stressed word, music follows speech); the teleprompter as one breath group per line with voice-following scroll, restart-from-line pickups and freestyle inserts; scratch voice for stumbles not duration; the writing rules with evidence; react mode's legal frame as design rules. **The voice-profile half of that research is tabled.** |
| `EDIT-ENGINE.md` | **The LLM directs, a solver places.** Text in, finished video out; the timeline is the engine room. Two-layer document (word-anchored intents compiled to a frame-accurate timeline); ~15 typed ops on handles, never times; every edit validated and measured before it's shown, because agents resolve ~27% of real tasks and claim success 93% of the time; a critic fed by measurements and side-by-side comparisons, two rounds max. Edits as policies ("tighten 10%" is one setting), branches as a creative tool, OTIO export as the escape hatch. Speed tiers that keep the model out of the hot path; "one step ahead"; revisions in plain feelings; messy input; CPU-only infra with external GPUs for the handoff. Confirms the product's shape. |
| `STRATEGY.md` | **Models are rented parts; the archive, the policies and the receipts are the product.** Why: video understanding climbs ~75→88% in two years, price per capability falls ~50× a year, and models still return a grounded answer with correct evidence 1% of the time. What commoditises vs what lasts; capability contracts and an eval-driven router so every model release improves the product automatically; **liquid video** (archive + policy + receipts, rendered as a view) with its measured precedents; the agent audience and the publish kit; journalism safeguards and the EU Article 50 duties; the tetrad; the position — *the edit you can interrogate*. Roadmap and big swings. |
| `Scout.dc.html` + `scout-sample.js` | **Scout, as a screen.** The DarksidePhil brief worked end to end: decomposition with rejected diagnoses → four families → metadata triage → crowd signals → chunked scan with a verifier → snowball → stop. A board grouped by beat with a balance meter, verified / crowd / trace rows, gaps with tried queries; a Sources tab showing what could be read vs only linked; a Ledger tab with the rejection rate and the stopping curve. Attach a verified moment and it rides into a plan as an external source. Not linked from the product. |
| `SCOUT.md` | **Finding clips that aren't yours yet.** A small research agent: thesis → observable behaviours and mandatory counterpoints → four parallel query families (direct, community vocabulary, crowd-indexed, counterpoint) → metadata triage → map–reduce transcript scan with a cheap model and a typed ledger → deterministic quote verification → snowball → stop on knee-plus-coverage → a board with a balance meter and a gap list. **Scouting is separated from acquiring**: YouTube is links and metadata only (its API won't give captions you don't own; scraping kills a SaaS); transcripts from open sources and the user; a companion desktop app captures on the user's machine. Scout is the open-world step in the source order, not a new surface. Phased v0–v3; nothing ships before the editor. |
| `OPERATIONS.md` | **Fast, reliable, BYOK-ready, profitable.** No frontier API is error-free (Claude ≈99.5%, generative media fails double-digit); the product can be: the same model through several capacity pools, one durable state row per item, a completion invariant, DLQs everywhere, a degradation ladder shown on the block. SLOs for one person. BYOK with envelope encryption, a capacity check on save, required credentials and blame attribution. Cost per job and pricing by footage-hour ($12) and *landed* generated second ($1 / $3.50) at ~3× cost. |
| `DOSSIER.md` | **Memory that compounds, clips that arrive.** The Dossier as a relational ledger of moments, sources and searches with embeddings — never a knowledge graph (~600× cheaper). Verdicts on twelve compounding features; the contradiction engine scoped and human-confirmed, never always-on; eight guardrails against the Neolog trap. Acquisition is hybrid: auto-fetch only where downloads exist by design, **missions** everywhere else (YouTube included), match-back by words → audio landmarks → frame hashes. Automatic attribution through the timeline. Restrained gamification: progress and state changes, never streaks or points. |
| `SOURCES.md` | **The master integrations list, by tier.** Only three kinds of source allow download-and-reuse in a published video: licensed stock APIs (Epidemic Sound, Shutterstock, Storyblocks), free stock that still issues keys (Pixabay; Pexels only if you hold a key), and public-domain archives (NASA, House/Senate floor video, PD-marked IA/Prelinger). No streaming platform is an open Scout destination (PeerTube is the only one built to serve files). YouTube since June 2026: 100 `search.list` a day per project, so discovery runs on RSS, WebSub, web search and `videos.list`; download stays prohibited; 30-day refresh. Corrections: C-SPAN, Freesound/Jamendo, X, Pexels, Canadian legislative footage. |

## Direct integrations — the no-brainers are in the prototype (15 Oct 2026)

Built as the **Stock** tab on Home's canvas (pictures: **Pixabay** on a shared key, 24 h cache, assets copied · **NASA**, keyless, credit NASA · **Internet Archive**, PD / CC0 / CC-BY per item) and as a source you add behind **+ Add footage** (**Podcasts** — a show name or a feed; episodes transcribed; moments land in External, searchable by what was said; "search podcasts for…" works in the conversation). Each asset carries licence and credit; attaching one writes the credit. Still to come: **Epidemic Sound** (partner agreement — apply now), **GDELT TV** (one live test call first), **connected accounts** (OAuth). The order below stands.

## To be developed later — direct integrations (decided 8 Oct 2026)

The founder wants the direct integrations built, in this order, as a layer under the pictures source order and the music bed. Not Scout; buttons in the product.

1. **Pixabay** — images and video, free, no credit required. 24 h response cache; copy assets to R2.
2. **NASA Image & Video Library** — images, video, audio, captions. Credit NASA.
3. **Internet Archive / Prelinger** — PD, CC0 and CC-BY items only, checked per item.
4. **Epidemic Sound Partner API** — music and SFX; **apply now**, onboarding has lead time.
5. **Podcast RSS** — public audio by design; transcribe (~$0.03/hr) where no transcript ships; short excerpts with credit.
6. **GDELT TV** — the one legitimately word-searchable news source; quote and link; **one test call first** (live status unconfirmed in 2026).
7. **Connected accounts** (tier 4): your YouTube, your Twitch (own clips, clip-from-VOD), your Vimeo — read-only, your own content.
8. **Pexels** only if a key is already held.

Searchable by what was said: GDELT, podcasts, the user's own captures. Everything else is searchable by title and tag only. Stock and archives give pictures; news and podcasts give quotable words; connected accounts give your own clips; other people's platform footage is always a mission.


- The **formula**: the standard a spoken line should follow (sentence length, breath, how a receipt is introduced). Research pending.
- **Voiceover**: record vs scratch TTS; one line prompted in the chat vs a recording session in the editor for many lines.
- **Script vs beats**: the board's working answer — a two-column script *is* the beat list.
- **Sound design**: deferred until voiceover is settled.

## What the Oct 2 research pass settled (and what it rejected)

Seven reports plus two handoff specs were read as research, not as instructions. The product does not change until a decision below is deliberately built. Chat `m0046`–`m0050` has the discussion.

**Settled — carry into any build**
- **The model drafts from a plan in a plain register; the genre word never reaches the writer; the user's own words win wherever they exist.** (Revises the earlier "never from a brief": drafting from a thesis is fine — what failed was drafting from a *genre* with no plan. See `FORMATS.md`.) The interview ("talk to each receipt") is only for when there is no material yet.
- **Re-hear every quote before it ships.** ~1% of ASR segments are invented; cited sources are wrong 20–60% of the time. Transcripts are an index, not evidence.
- **Receipts are Document blocks.** The voice paraphrases around them; the card is verbatim with its source; read aloud only when the exact wording *is* the evidence. Highlight span ≤20 words; hold = max(2 s, chars ÷ 17 + 1 s), capped ~7 s.
- **Pose the hypothesis, not the conclusion.** One question, once, before research. "Why the detractors are right" → "which detractor claims survive?" LLM search confirms whatever it's briefed with.
- **Scripted vs spontaneous is audible** (87% identification). Scripted lines for descriptive/factual content; the user's own voice for opinion. Fillers ≤5/min, not zero.
- **Pacing default is "one visual beat per sentence."** The only pacing claim with a mechanism behind it (≈4–6 s at 165 wpm).
- **Record in the editor, line by line.** Teleprompter advances per line, the line is the retake unit, 3-second countdown. Chat is for rewriting lines between takes and for single-line exceptions. Record vs TTS is a user choice; TTS is the scratch read.
- **Music under voice ~20 dB** (WCAG 1.4.7, the only standards-body number); music changes at section breaks, not on a timer.
- **Measured spoken-line range:** 15–28 words per sentence across two successful essayists, 17–28% short sentences. Match the *user's* distribution, not a generic target.

**Rejected — do not build as rules**
- The 3–5 s shot rule. −14 LUFS as a YouTube spec. The 80 ms beat tolerance and 0.5 s minimum hold. Every clip-to-commentary ratio. Cue-card bullet counts. All folklore or vendor-blog numbers with no measurement behind them.
- A 10-pass pipeline with 3 gates and a 14-screen design brief. The *sequence* is right; most of it should be invisible. Two visible decisions — *is this the question?* and *here are the verdicts, does the title survive?* — and everything else a line in the conversation with Undo. Fits Home + Editor as built.
- A 16-threshold linter. Three deterministic checks catch what people notice: banned-word list, sentence-final participials, origin share ("did you actually say this"). The rest is tuning.
- LLM-as-judge for "sounds natural" (near chance), open-ended self-refine loops (human-rated quality falls after one iteration), AI detectors.
- Writing disfluencies into a script.

**Settled by the 7 Oct measured-evidence pass** (detail in `FOOTAGE-SYSTEM.md` and `PICTURES.md`)
- Match on utterances, give context from topic spans. Retrieve by words and by meaning independently; fuse by rank. On transcripts, keyword search is a peer, not a re-scorer.
- "Nothing backs this" has to be engineered — three-way label, our own calibrated threshold, near-miss negatives in the eval. Models alone either never abstain or always do. Shorts' Strong / Worth a look / Long shot is this pattern already.
- Visual indexing is a plan tier, not a default: it's most of the read-time cost and mostly serves B-roll search. Transcript-only ≈ $0.05–0.40/hr; multimodal ≈ $1–3.50/hr; a judged claim ≈ $0.006.
- Third-party detection is "probable", never a clearance. Speaker names are confirmed once and remembered across sources.
- The picture answers "why am I seeing this," never "what noun did the sentence contain." Own footage → documents → open world → generated, and never generated photoreal over a claim or its proof. "Nothing to show" is a result.
- *Before you post* gains a cue sheet of generated elements; every claim keeps its evidence in a ledger.
- Build the eval set (~200 claims, near-miss negatives) before the pipeline.

**Settled by the 7 Oct decision-layer pass** (detail in `PICTURES.md`)
- A plan block states what the viewer can say after it; the picture is checked against that proposition, and rejected if it would fit any sentence about the topic (the gavel detector). The relation — who leads, what the picture does to the line — is internal.
- **Pictures before words.** Argument → what must be seen → secure the picture or say "nothing to show" → write the narration last, in a spoken register. This is the pre-production order, and the reverse of today's essay flow.
- Propositional redundancy is the default; on-screen text never repeats the narration; counterpoint only on turns, jokes and endings, budgeted. Repeat a shot only on purpose.
- Judge picture choices by decomposed yes/no questions, pairwise per slot, on clips with audio — holistic taste doesn't agree with itself (κ ≈ 0.15).
- Shorts' burned-in captions are exempt — muted viewing is a different medium.

**Settled by the 7 Oct visual-supply pass** (detail in `VISUAL-SUPPLY.md`)
- Charts, diagrams and type are code, never pixels; bars start at zero; every datum traces to a document cell and the chart is blocked if it doesn't. The receipt shot is the house move: the source lifts into the chart.
- The generated still is the approval checkpoint; motion comes from the compositor and parallax; video generation only where the subject must act, under a minute per ten, falling back to parallax.
- Generated imagery is never photoreal and never on a claim or its proof — AI imagery lowers trust even when labelled.
- Suppliers hand over layers, not video; words and numbers live above any generated pixels.
- Style belongs to the user: tokens per project, the Style Card turns taste into parameters, rasters are quantised to the palette.

**Settled by the 7 Oct quality and script passes** (detail in `FORMATS.md`, `SCRIPT-AND-TIMING.md`)
- Genre is an edit profile applied after the read is aligned; the writer gets a brief and a plain-register instruction and a deterministic stoplist of genre markers; the one sanctioned writing touch is a hook line compressed from the claim.
- Spines, not genres, are the modes — twelve of them plus a stance axis; one primary, at most one secondary. The user never sees the word.
- A fragment is valid only if it holds a claim and its evidence, every referent resolves, its meaning entails the parent's, and it ends on a beat boundary.
- Audio is the highest-leverage quality fix (bad audio lowers credibility, d .32–.55); loudness, ducking, captions ≤17 CPS and a subtitle file are checked on every export, not offered as fixes.
- Questions are batched at two moments — after the brief and before export — 3–5 at most. Confirms Ask · Recommend · Auto and *Before you post*.
- Timing anchors to word ids; a real forced aligner, not Whisper's; cuts land on the stressed word; music follows speech. One breath group per prompter line; don't over-clean fillers; ad-libs become blocks.
- React: commentary adjacent to every clip, warn below 1:1, clip length by need, a ±30–60 s fairness check.

**Settled by the 7 Oct edit-engine passes** (detail in `EDIT-ENGINE.md`)
- The model never outputs a timestamp and its claim of success is never trusted: it directs (what, why, order, visual job) as a typed directive; a deterministic solver places; every edit is validated and measured before it's shown as a diff in editor's language.
- Rules are policies, re-applied when anything changes — the product's thesis, confirmed by the research. "Tighten 10%" is one setting. Branches are options to compare.
- Keep the model out of the hot path: analyse once at upload, same compiler in browser and server, a router for routine commands, speculative pre-renders, content-addressed render cache. The editor is always one step ahead.
- Revisions in plain feelings ("the start drags", "hard to follow", "tighter") compile to rules — now in the product.
- Direct manipulation stays as the door, not the default. Speech recognition runs on raw audio; enhancement only on the final mix. SFX on cuts off by default.
- GPU work (segmentation, learned interpolation and stabilisation) leaves the platform; everything else is CPU. Render cost is negligible; tokens and GPUs are the spend.

**Settled by the 7 Oct strategy pass** (detail in `STRATEGY.md`)
- Anything a model will do for free next year goes behind a typed contract and gets rented; the archive schema, the policy layer, the evidence ledger, the eval set and user preference data are ours. The eval set is the highest-leverage asset we own.
- Models propose; deterministic layers dispose. Receipt verification, the solver, QC and provenance signing are model-free forever.
- The thesis, named: the archive is the asset, the cut is a view. Length is a dial re-solved from one policy; Cut / Shorts are two points on it.
- Must-keep / never-separate (a claim and its qualifier) becomes a rule kind and a solver constraint — the guarantee behind the fragment test.
- Every picture is typed evidence / illustration / synthetic and the type sets the label; EU Article 50 duties (from 2 Aug 2026) built in by construction. Hypermediacy: show the joins, the ledger, the receipts.
- Position: not "AI that edits your video" but **the edit you can interrogate**.

**Settled by the 7 Oct Scout pass** (detail in `SCOUT.md`)
- Scout finds and links; it never downloads. Footage enters the archive by open licence, by the user, or by a companion app on the user's own machine. YouTube is metadata and deep links only.
- Behaviour-first decomposition with mandatory counterpoints; the lead model never sees a transcript, only verified ledger rows; every quote is string-matched against the stored transcript and the timestamp comes from word timings, never the model.
- Chunk-and-scan with a small model beats stuffing a VOD into a long context (accuracy halves at 32K on non-literal matching). Stop on diminishing returns *and* beat coverage, with gaps listed.
- Rage moments are where captions are worst (≈30% WER on shouted speech) — find them through crowd signals too, lag-corrected by ~20 s.
- Scout is the open-world step of the existing source order and a state of the Home canvas — no new UI vocabulary. Deferred until the editor ships.

**Settled by the 7 Oct operations pass** (detail in `OPERATIONS.md`)
- "Done" means every item is accounted for: one state row per item, a completion invariant, dead-letter queues on every consumer. Silent partial failure is a P1.
- Fail over to the same model on another host before a different model; a different model must pass the eval. Progress is per item, never a spinner; degraded results are labelled on the block.
- Meter footage-hours (read once, edit free) and generated seconds that *land in the cut*, at ~3× cost; premium generation is its own meter; a monthly spend cap. Blame attribution is a copy rule.
- BYOK covers direction and reading only; encrypted, probed on save, never falls back to our bill without opt-in.

**Settled by the 7 Oct Dossier pass** (detail in `DOSSIER.md`)
- The Dossier is a ledger with embeddings, not a graph. Extract lazily, closed schemas, ids before names, every fact carries moment ids, one retrieval path, budgets on every background job, kill-switch metrics per feature.
- Contradictions: user-triggered, scoped to a thread, verified in a second pass, confirmed by a human, labelled "changed position" when that's what it is. Never always-on.
- Footage and Scout finds are the same object with a provenance tag. Auto-fetch only from sources open by design; YouTube and the rest are missions the user completes; uploads are matched back by their words. Attribution is written automatically and removable only on purpose.
- Gamification is progress bars and state changes with newsroom copy — no streaks, points, confetti or leaderboards.
- **Ghost clips** (spec, built in the Scout screen): the cut is built from scouted moments before anything is fetched; a ghost has everything but the media; missions are generated from the cut in timeline order, expiring first; a grab fills the hole in place; a final render asks per remaining ghost — hold, drop the beat, or a quote card. The video never ships with a silent hole.
- Counterpoint balance is shown as effort as well as results ("sought: 6 searches, 2 found"); a thin corpus gets a playbook (reframe · make original material · records · widen the net · watch and wait · go shorter); the library has Mine · External · All and asks itself before the internet.

**Settled by the 7 Oct sources pass** (detail in `SOURCES.md`)
- Stock is a direct integration, not Scout: Pixabay, NASA and PD archives for pictures; Epidemic Sound for the bed. Every asset stores licence, source and credit beside its file.
- Scout's YouTube layer is discovery only — RSS, WebSub, web search, `videos.list`; `search.list` spent only on what a user typed. The Scout app is a capture tool for the user's own lawful use, never a downloader.
- GDELT TV and podcasts are the transcript backbone; streamers are metadata, crowd signals and the user's own captures.

**Tabled — not the direction (possible per-account feature much later)**
- A voice profile / fine-tune on the user's speech, a style profile, a preference-trained "voice" model, a voice clone. Light editing of a plain-register draft is enough when the material is facts plus argument.

**Filed for later — good, out of scope now**
- React mode's legal/policy material (engagement-per-clip, attribution at first use, no automated caption fetching, dispute file per video) → belongs in *Before you post*, not the editing flow.
- OTIO as the compiled export, with recipe/locks/receipts in `metadata.aldershot`.
- The open-source steal list (TransNetV2, PySceneDetect, Beat This, WhisperX, Lighthouse) and its licence traps (madmom weights, videogrep, Remotion at 4+ people).
- Voice profile from past transcripts — useful as linter *targets*, weak as generation conditioning.
