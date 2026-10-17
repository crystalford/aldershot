# Strategy — models are rented parts; the archive, the policies, the receipts are the product

7 Oct 2026, from the "ahead of its time" strategy pass. Nothing here is built. This is the argument for *why* the labs decisions are the right ones, and what to protect.

## The one-line version

**Every model Aldershot calls will be cheaper and better in a year — so engineering goes into what models can't supply:** an archive that records where every moment came from, edit rules that re-run, an evaluation suite that encodes house taste, and a publishing format that carries receipts. Do that and every model release improves the product. *Liquid video* — one archive, endless verifiable cuts — becomes the category Aldershot defines.

## The three facts the case rests on

1. **Video understanding is climbing fast.** Video-MME frontier: 75% (2024) → 84.8% (May 2025) → 88.4% (Jun 2026, self-reported). Google's agentic video mode now answers hour-long questions with 88% fewer tokens by *navigating* — `get_transcript`, `get_frames(start,end,fps)`, `get_audio(start,end)`. That is the archive-of-moments pattern rebuilt inside a model. **Expect our retrieval plumbing to be commoditised.**
2. **Price per capability is collapsing.** Epoch AI: 9×–900× per year to reach a fixed threshold, median 50×; "price of thought" falling 47% per quarter; the *newest* capabilities keep premium pricing. **Planning rule: anything we pay frontier prices for today costs 1/10–1/50 in twelve months.** Design to spend on the frontier for hard cases and fall to cheap tiers automatically.
3. **Models still can't show their evidence.** VideoZeroBench: Gemini 3 Pro at 17% on standard QA, **1.0%** when the answer must come with correct spatio-temporal evidence. Receipts — a verifiable span, checked deterministically — remain something we build. **That gap is the opening.** It is also exactly what `FOOTAGE-SYSTEM.md`'s calibrated judge and evidence ledger already decide.

Supporting readings: text is the cheapest, strongest video signal (Video-MME's short-to-long gap closes most with subtitles) — validates the transcript-anchored archive. Open weights trail the frontier by 6–12 months. Real-time generation (17–30 fps at 480–720p on one GPU) is research-grade; interactive generated *inserts* plausible in 12–36 months, broadcast quality speculative. World models are explainer-reconstruction engines and a liability as evidence. Descript's Underlord already sells "type what you want, get a video" with a model picker — **Aldershot cannot differentiate on chat-to-edit alone.**

## Commoditised vs durable

| Component | 12–36 months | Why |
|---|---|---|
| Transcription, diarisation, alignment | commoditised | native audio in multimodal models; per-second pricing in free fall |
| Shot / highlight detection | commoditised | agentic models locate and resample regions themselves |
| B-roll retrieval over the archive | mostly commoditised — **the index's schema and provenance persist** | the Gemini tools replicate transcript-then-frames search |
| Generic critic / judge | commoditised | judging generic quality is not a moat |
| Generative cleanup (removal, relight, dubbing, lip-sync) | commoditised — **buy, don't build** | shipped as API features by Runway, YouTube, others |
| **Archive-of-moments with provenance** | **durable** | models don't own the footage, the rights, the consent, the chain of custody; grounding is unsolved |
| **Directive / policy layer + solver** | **durable** | determinism, re-solvability and explainability are product properties |
| **Evaluation suite encoding house taste** | **durable — highest leverage** | it's what lets us swap models safely; nobody else has the golden set |
| **User preference / accept-revert data** | **durable** | the flywheel |
| **Publishing format (receipts, cut ledger, variants)** | **durable — a standard-setting opportunity** | distribution is moving to AI intermediaries that need structured, verifiable video |

The bitter lesson applies to *method*, not *ownership*. In every reported case what got outpaced was orchestration code — never customer data, evaluation, or the system of record. Descript's durable asset was the transcript-as-document and its project format; the AI layer was rebuilt on top as models improved.

## Architecture so the product improves on its own

1. **Capability contracts, not model calls.** Typed interfaces for every intelligence task — `Transcribe → WordSpans[]` · `Locate(query, archive) → EvidenceSpan[] + confidence` · `Judge(cutA, cutB, rubric) → Preference + rationale` · `Inpaint(span, mask, instruction) → Asset + provenance` · `Direct(brief, archive) → Directive`. Providers are swappable; a registry stores version, price per unit, latency, capability flags.
2. **Eval-driven routing.** A nightly run scores every provider against our golden set (fixed archives with known answers, accepted/rejected cut pairs, receipt-accuracy tests). A router picks the cheapest provider that clears the bar per contract and tier. A new model is a registry entry; if it wins, users have it next morning. *This is how falling prices are captured automatically.*
3. **Capability detection and graceful structure removal.** Each contract has a `native` path ("model returns timestamps with evidence", "model watches the archive agentically"). When a provider passes the native eval, the router bypasses our hand-built stage for it. **Keep the old path as fallback and oracle.**
4. **Determinism where it matters.** Model-free forever: the solver; timeline compilation; QC (loudness, safe areas, caption timing); provenance signing; **receipt verification** (does the span's transcript contain the quoted words? do the frames contain the claimed object — cross-checked by a second, independent provider?). *Models propose; deterministic layers dispose.*
5. **Content-addressed everything**, keyed by hash(inputs + provider version). A model swap invalidates only that provider's outputs; archives re-read themselves in the background with better models, surfacing diffs ("the new model found 3 more receipts for claim X").
6. **A data flywheel with consent.** Every directive, solver output, user edit and acceptance logged as a tuple; opt-in tuples aggregate into the golden set. Taste data makes *any* model better at *this user's* style.
7. **Escalation tiers.** Cheap model first; frontier on abstention or low confidence; human review only for journalism-critical claims.

## Liquid video

**Video stored as archive + policy + receipts, rendered as a view.** Content (moments, assets, rights), structure (beats, directives, constraints) and presentation (style, platform, language, length) are kept separate and bound as late as possible. Any viewer, platform, length, language, reading level or question yields a re-solved, signed, traceable cut. This is BBC R&D's object-based media carried to its end — assets "wrapped in useful metadata," assembled "as late as possible before they reach the user."

**Precedents, and what each measured**
- *BBC Squeezebox / Responsive Radio* — flexible-length documentaries from **priority ranks + must-keep spans**. Exactly our edits-as-policies; confirms the editorial primitive.
- *BBC CAKE* — the first failure mode of adaptive media was **playback reliability**, not storytelling (8 of 10 trial participants hit video problems).
- *Netflix artwork bandits* — a significant lift, deployed to 130m+ members. **Personalise the packaging (hook, thumbnail, length) before the substance.**
- *Bandersnatch* — 94% made choices; removed in 2025. **Viewer-driven branching is a novelty; system-driven adaptation (length, language, question) lasts.**
- *YouTube multi-language audio* — over 25% of watch time from non-primary languages; auto-dubbing to all creators Feb 2026; 6M+ daily viewers watching ≥10 min of dubbed content. **The largest measured proof that one master, many variants pays.**
- *Trust* — only 20% trust news from AI chatbots (Reuters 2026); comfort with news personalisation is low. **For journalism, personalisation must be visibly accountable or it destroys trust.**
- **Not established:** any rigorous study that adaptive video improves comprehension over a well-made linear edit. A hypothesis to measure ourselves — and a research-partnership pitch.

**Representation — three layers, all already latent in Aldershot**
- *Content*: moments with word spans, visual descriptors, rights/consent, source hash, capture provenance.
- *Structure*: beats (move, must-see proposition), **priority rank**, **must-keep / never-separate constraints** (a claim and its qualifier; an accusation and its response), the motif graph, and the **integrity envelope** — the propositions every variant must preserve.
- *Presentation*: edit profile, platform profile, locale, reading level, persona.
- A variant = solve(structure ∩ request) → timeline → render.

**Rendering tiers (cost-aware)**: canonical pre-renders (master, 60 s vertical, 15 s hook, chaptered long form) cover most views · beat-aligned, content-addressed fMP4 segments so most "new" variants are manifest generation at the edge with no re-encode · **client-side compositing of the personal layer** — kinetic type, captions in the viewer's language or reading level, lower thirds — as vector overlays on cached segments (our vector-first style is the structural advantage: the most variable layer is the cheapest to render) · on-demand GPU only for genuinely new pixels, cached forever by hash.

**Distribution**: HLS/DASH already carry renditions, alternate audio and subtitles; chapters and evidence spans as date-range metadata and as schema.org `VideoObject` + `Clip` (Google shows creator-set key moments with exact offsets and prefers them to its own detection). **Provenance across variants**: C2PA covers fragmented MP4 with per-segment hashing; every variant's manifest points to the canonical master and carries the **cut ledger** — spans removed, why, which policy and solver version; generated pixels carry the AI digital-source type so a legal label is derivable.

## The agent audience

Platforms and intermediaries increasingly re-present video rather than link to it: auto-dubbing, auto-chapters, key moments, answer engines. Social and video networks now out-rank TV and news sites for weekly news use; publishers expect search traffic to fall 43% in three years. **Your video will be watched by agents on people's behalf, and they will clip you whether or not you help.** The defence: give them structured, signed, citable clips that are easier to use than a blind re-cut.

**Publish by default**: master + canonical variants with provenance manifests · word-level transcript and chapters · schema.org `Clip` per beat (name = the beat's proposition) · a machine-readable **policy file** (beats, priorities, integrity envelope, allowed re-cuts) · a **cut ledger** per variant · an **agent endpoint** exposing `search_moments`, `get_clip(proposition | time)`, `get_receipts(claim)`, `render_variant(policy)` — enforcing the integrity envelope server-side so no agent can strip a claim from its qualifier.

## Journalism-first safeguards

**Risks**: context collapse (a claim separated from its caveat) · an inconsistent record (two viewers, two stories) · filter-bubble framing · synthetic contamination (reconstructions mistaken for evidence) · correction drift (a fix to the master not reaching cached variants) · regulatory exposure.

**Regulation (dated)**: EU AI Act Article 50 transparency duties apply from **2 August 2026**; the Commission's Code of Practice on marking and labelling (final 10 Jun 2026, judged adequate 8 Jul 2026): providers machine-mark synthetic output; deployers label deepfakes and AI-generated text on public-interest matters; **three icons** — fully AI-generated, **AI-modified (explicitly including object removal and face/voice replacement)**, interactive layer; labels perceivable at first exposure; a multi-layer approach (metadata + watermark + label) is the working standard. Aldershot is plausibly both a *provider* (when it generates pixels or voice) and a tool used by *deployers*. Build both duties in.

**Safeguards**: the **integrity envelope as a hard solver constraint** — must-co-occur propositions can never be split, and a failing variant doesn't render · a **canonical record** with a stable URL; corrections bump the master, invalidate dependents by hash, re-solve, and show in a public changelog · a viewer-facing **"what was cut"** toggle with "watch the full context" at each cut point · **evidence / illustration / synthetic typing** on every visual — synthetic can never occupy the receipt-shot role; the label renders automatically from the type · **persona limits for news**: personalise length, language, reading level and recap, never the propositions in the envelope · **receipt verification as a deterministic gate**, with a second independent model on visual claims.

## The tetrad, and the position

*Liquid video* **enhances** fit (the message conforms to time, language, platform, question; the archive becomes answerable) · **obsolesces** the fixed master as *the* work, the timeline as the editor's interface, the one-size explainer, versioning labour · **retrieves** the oral storyteller who re-tells to each audience, and Vertov's editing room as database · **reverses into** the end of a shared text — context collapse, an unverifiable record, a database without narrative — *unless receipts travel with every cut.*

*Chat-directed editing* **enhances** intention over manipulation · **obsolesces** timeline craft as a gatekeeper · **retrieves** the director–editor dialogue and the script as master document · **reverses into** taste homogenisation — every edit converging on the model's median aesthetic. (*Our answer: the user's tokens and Style Card, `VISUAL-SUPPLY.md`; the plain-register brief and genre firewall, `FORMATS.md`.*)

Manovich's inversion is the product thesis stated exactly: **the paradigm (the archive) is given material existence; the syntagm (the cut) is de-materialised.** Aldershot makes the archive the asset and the cut a disposable, re-solvable view. Bolter & Grusin add the choice: *immediacy* (the cut feels seamless and authoritative) or *hypermediacy* (the seams are shown). **For journalism, choose hypermediacy — show the joins, the ledger, the receipts.** Visible seams are the aesthetic form of the integrity commitment.

**Position: not "AI that edits your video" (Underlord already says that) but "the edit you can interrogate."** Every cut is a view of a signed archive, re-solvable to any length or question, showing what it left out.

## Roadmap

**Now (0–6 months)** — provider registry + eval router over a golden set of 50–100 archives · priority ranks and the integrity envelope in the directive schema · **elastic length**: one control, 15 s → full, re-solved from the stored policy, canonical variants pre-rendered · **ask-the-video with receipts** ("just the part about the budget" → assembled segments + a deterministic quoted-words check) · the publish kit (transcript, chapters, Clip markup, provenance manifest, cut ledger) · Article 50 by construction (evidence / illustration / synthetic typing, automatic labels).

**Next (6–18 months)** — the agent endpoint, metered · locale and reading-level variants (dubbing bought, type and captions client-side) · **packaging personalisation first** (hook, thumbnail, length per platform; substance fixed) · the taste flywheel as a reranker on solver candidates · background re-analysis with surfaced diffs.

**Later (18–36 months, partly speculative)** — streaming generated inserts, always labelled · conversational documentary (a fresh signed cut per viewer question, the canonical record one tap away) · explainable reconstructions via world models, quarantined as illustration · cross-archive federated queries with provenance chains preserved.

**Big swings** — publish an open **Liquid Video Package** spec (archive manifest + policy file + cut ledger + provenance bindings + agent endpoint) and pitch it to C2PA members and public-service broadcasters · make **receipts the product's measurable claim**: our own grounded-answer benchmark on investigative footage, pass rate published, against a 1%-grounded frontier · sell a signed clip API to AI intermediaries, turning the referral collapse into a channel · run the missing comprehension-and-trust study with a journalism school.

## What this changes in Aldershot

- **Confirms, and names, the thesis**: rules as policies, the archive as the asset, the cut as a view, receipts on everything — the shape we built, with the strategic reason attached.
- **Every labs decision gains a durability test**: *is this something a model will do for free next year?* If yes, it goes behind a contract and gets rented. The hybrid retrieval, the alignment, the critic — all behind contracts, kept as fallback and oracle. The archive schema, the policy layer, the ledger, the eval set — ours.
- **The eval set moves from "build first" to "the highest-leverage asset we own."** `FOOTAGE-SYSTEM.md`'s ~200-claim set is the seed of the golden set that routes every model.
- **Must-keep / never-separate becomes a rule kind** in the product's vocabulary (*"Keep the claim and its qualifier together"*) — and the solver constraint that makes Shorts' self-sufficiency test (`FORMATS.md`) a guarantee rather than a check.
- **Length becomes a dial, not a mode.** Cut / Shorts is two points on it; the research says the whole range re-solves from one policy.
- ***Before you post* tells the truth about labelling**: evidence / illustration / synthetic typing drives an automatic label, and the EU's "AI-modified" category explicitly includes object removal and voice replacement. *(Product copy updated.)*
- **The cut ledger is a feature**, not just a file: "what was cut, and why" is already what the editor's left-out moments show with their rule numbers. Publishing it is the step.
- **For the handoff**: provider registry, eval router, content-addressed invalidation by provider version, the integrity envelope as a solver constraint, the publish kit. Supersedes any infra note that hard-codes a model.

## Sources

- Benchmarks: Video-MME (2024 paper and 2025–26 leaderboard entries); HourVideo (NeurIPS 2024); VideoZeroBench (2026); 1H-VideoQA / LVBench / Minerva figures from Google's agentic video mode announcement (1 Sep 2026, self-reported); Qwen2-VL / Qwen2.5-VL reports.
- Prices: Epoch AI, "LLM inference price trends" and "the plunging price of thought"; Appenzeller (a16z), "LLMflation"; Gemini token accounting and pricing docs.
- Generation: Self Forcing; MotionStream; Light Forcing; streaming talking-head work; DeepMind Genie 3 / Project Genie; Runway Aleph; YouTube Expressive Speech dubbing; Descript Underlord announcements (via CreateWith).
- Strategy: Hyung Won Chung via Lance Martin; nilenso on "artisanal shims"; Hex engineering on being outpaced by model capability.
- Precedents: BBC R&D object-based media, CAKE, Squeezebox / Responsive Radio, Click 1000 (UES 3.87, self-selected); Netflix artwork personalisation; Bandersnatch; YouTube multi-language audio and auto-dubbing (Feb 2026); Reuters Institute Digital News Report 2025 and 2026; Trends and Predictions 2026.
- Standards and law: C2PA specification (fragmented MP4, live); c2pa-rs; CBC/Radio-Canada fMP4 Content Credentials demo; schema.org `VideoObject` / `Clip` / `SeekToAction`; EU AI Act Article 50; Commission Code of Practice on marking and labelling (Jun–Jul 2026).
- Theory: McLuhan's tetrad; Ong, *Orality and Literacy*; Manovich, *The Language of New Media*; Bolter & Grusin, *Remediation*.
- Caveats as stated in the pass: several 2026 figures vendor- or self-reported; benchmarks saturating; BBC trials thin on quantitative data; generation pricing untracked; regulation evolving.
