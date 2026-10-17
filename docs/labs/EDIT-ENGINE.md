# The edit engine — the LLM directs, a solver places

7 Oct 2026, from the edit-engine, speed and hands-off passes (6 and 7). Nothing here is built. This is the engine room under Home and the Editor; the product's job is to keep it a room the user never has to enter.

## The one-line version

**Text in, finished video out.** The model decides *what and why* — which moments back which point, the order, each beat's visual job, where the turn lands — as a typed directive with bounded settings and **never a timestamp**. A deterministic solver decides *exactly where* — cuts on breaths, holds, J-cuts, pacing curves, the music landing on the last frame. Every edit is a policy (a rule), re-applied whenever footage, transcript or target length changes. The timeline exists underneath; it is not the interface.

## What the evidence settles

- **Agents fail at craft and frame arithmetic, and claim success anyway.** On the newest real-task benchmark the best agent resolved 26.8% of editing tasks (average 14%) and claimed full success in 93% of runs — including 95.5% of the edits that failed. 562 of 771 failures were quality-only. Dynamic-programming and HMM placement, by contrast, has worked reliably for a decade (dialogue-scene editing, narration-to-footage alignment). **So the model never outputs times, and its own report of success is never trusted.**
- **Every edit is validated and measured before it's shown**: schema → references exist → constraints (nothing outside its media, no zero-length, protected beats untouched, dwell rules met, duration window) → compile → *measured* check (duration, cut count, median pause, longest static shot, loudness) → a diff in editor's language. On failure, a structured error with the nearest valid alternative so the model can repair.
- **The critic needs outside signals.** Deterministic checks on the render tree or a proxy render catch most first-run defects (loudness, dead air, mid-word cuts, flash frames, caption speed, safe zones). Judgment questions go to a vision model as **side-by-side comparisons, run in both orders, from a different model family** than the director; its verdicts become typed solver constraints; **two rounds maximum**. A model reviewing its own work without measurements isn't supported by anything.
- **Direct manipulation stays — as the door, not the default.** The one user study of an LLM video agent found everyone succeeded with low frustration *because* they could refine the agent's actions by hand. For a hands-off product that means: Home gives you a video back; the Editor is the engine room with a door; keyboard and block editing exist from day one for the moment the sentence isn't the right tool.

## The document — two layers, one set of ids

- **Layer A — the edit decision graph** (what the model manipulates): ordered blocks referencing **transcript word-id spans**, each with intents — *keep*, *tighten-to 250 ms*, *J-cut 12 frames*, *hold-for-read* — and a `protected` flag.
- **Layer B — the compiled timeline** (what preview and render consume): OTIO-shaped tracks, clips, gaps, transitions, effects in rational time, frame-snapped at compile. **Never hand-edited by the model.**
- Word ids are stable across re-transcription by sequence alignment (ids carry through matches; insertions mint new ones; deletions become orphans). Blocks on orphaned words snap to the nearest survivor and are flagged, never silently dropped.
- Time is stored as integer ticks at a fine timebase and snapped to frames only at compile — word-level cuts stay exact for audio while video lands on whole frames. Cut points use **acoustic** boundaries: the lowest-energy frame within ±40 ms of the aligned word edge, preferring a breath or pause midpoint.
- `ops` log with inverse ops → undo, redo, **branches as head pointers**, snapshots every ~200 ops. A single writer per project removes the need for CRDTs; add them only for offline or comment layers.
- **Export to OTIO / FCPXML / EDL as the escape hatch** to Resolve or Premiere. Interchange is lossy (kinetic type, ducking curves and word intents won't round-trip) and that's fine — it's the anti-lock-in promise Descript and CapCut can't make.

## The directive and the ops

The model emits: beats with candidate moment ids · constraints · about 25 bounded settings (pause target, J-cut frames, dwell per role, pacing curve, duration window, protected beats). The solver (a TypeScript dynamic program for cuts and duration; an integer/constraint solver in WASM for B-roll assignment) places everything; sub-second inside a Worker is the estimate, memory the likelier bottleneck — profile it.

About fifteen typed verbs, each taking **selection handles, not times**, each supporting `dry_run`:
`select` (text, speaker, block ids, "pauses > X") · `cut` (ripple | lift) · `keep_only` · `move` · `trim` (by words or ms; ripple | roll) · `slip` / `slide` · `set_pace` (pause target, max pause, protect list) · `split_av` (J/L) · `add_overlay` (b-roll, still, text, graphic, receipt — **anchored to words**) · `set_audio` (gain, duck, enhance) · `retime` · `reframe` · `apply_template` (per spine) · `branch` / `checkout` / `undo` / `redo` · `render_preview`.

Hallucinated ids are the common agent failure: handles only, unknown ids rejected with suggestions, no raw timestamps in any argument. The model sees a **compact block table** (id, speaker, first and last six words, duration, tags) with detail on demand — not the whole timeline.

## Edits as policies — the product's thesis, confirmed

- A cut is a policy re-applied, not an outcome stored: *hold receipts for reading time*, *J-cut speaker changes 8 frames*, *under three minutes*. One brief renders a 12-minute essay, a 60-second vertical and a 15-second hook with coherent decisions. Timeline NLEs store outcomes, not reasons, so they structurally can't.
- **"Tighten 10%" is one setting, not 140 trims** — solved as an optimisation: pauses first, then fillers, then low-salience sentences, never protected beats, with a report of what was spent. **"Make this 58 seconds"** is the same solver with duration as a hard constraint and music fit in the objective.
- **Branches are a creative tool**: "punchier" and "more context" rendered side by side as proxies, diffed in editorial language, favourite blocks merged across.
- **The critic ships as a feature**: cuts per minute, pause distribution, longest static shot, dwell compliance, loudness, caption speed — against the edit profile's target curve, shown as a pacing graph.
- **Diffs are block-level with measured deltas**: "removed 14 pauses (−38 s), moved 2 blocks, 3 J-cuts added; median pause 610 → 240 ms" — ghosted strikethrough on the transcript, red/green on the blocks. This is what the Editor's rule effects and Home's "+0 moments · −1:20" already are.

## Revisions in plain feelings

The user talks the way they'd talk to an editor; the system maps feeling → parameter → re-solve (seconds, nothing rebuilt by hand):

| They say | It changes |
|---|---|
| "the start drags" | opening curve faster; open on the sharpest line; first proposition earlier |
| "she needs more room" / "rushed" | longer holds on her blocks; pause target up; fewer cuts in that span |
| "this part's confusing" / "hard to follow" | one thread at a time; a context beat added; a key term restated |
| "tighter" / "punchier" / "too long" | a cap; pauses and fillers first; protected beats untouched |
| "flat" / "nothing happens" | the turn earlier; a contrast beat; a receipt moved up |
| "I don't believe it" | the receipt shot for that claim; the counterpoint voiced |

**Autonomy scales with confidence.** When it's sure, it decides. When there's a real choice, it picks one and puts the alternative within reach ("I used her second take; the first is here"). It stops to ask only when a decision changes the meaning — an op that would remove more than ~10% of runtime, touch a protected block, or has two materially different readings — and **batches those questions into one moment**. (Ask · Recommend · Auto, and *Before you post*, confirmed.)

## Speed — keep the model out of the hot path

Four tiers, every action assigned to one: **instant** (<100 ms — scrub, trim, cut, undo, apply an accepted diff: local, in the browser) · **fast** (<1 s — deterministic server ops over precomputed data: "remove ums", "tighten 10%"; no model) · **thinking** (2–10 s — real judgment: "find where he contradicts himself", "build the argument") · **background** (minutes — final render, GPU jobs; never blocking).

- **The same compiler runs on both sides** (TypeScript in the browser and in the project's server object): edits apply optimistically, the server confirms — the Figma feel.
- **Analyse once, at upload**: silences, fillers, retakes, beats, speakers, shot boundaries, topic segments. Most chat commands become lookups.
- **A model cascade**: rules plus a small fast router send routine commands straight to ops; the frontier model only sees what needs reasoning.
- **Speculative editing**: while idle, precompute the likely next moves — the tighter cut, the short version, the no-fillers version — so the answer is already there.
- **Content-addressed render cache**: each chunk keyed by a hash of its slice of the timeline and assets; after an edit only changed chunks re-render; a revised export takes seconds.
- **Lean context**: compact block view, a cached prompt prefix (instructions, tool schemas, archive summary), only deltas per turn. **Stream the plan** and apply ops as they arrive.
- **Every accept, reject and tweak is preference data**: your pause length, cut style and how hard you tighten become your defaults; a repeated command becomes a saved policy ("my podcast clean-up"). *This is the Style Card and Recipes, confirmed.*

## One step ahead

- **At upload**: it reads everything and comes back with "here's what's in this footage — three possible videos." You pick one instead of writing a brief. *(Home's "From what's here, it could make", confirmed.)*
- **While you type**: retrieval starts before enter — intent is clear halfway through the sentence.
- **After the first draft**: shorter, punchier and more-context versions are already rendering as proxies — and so are the Shorts.
- **Before you notice**: "Point three has no visual proof. Want me to use the council minutes?" It flags the weak spots in its own cut.
- **Over time**: it learns what you always ask for second, and does it first.

The chat stops feeling like asking a tool to do something and starts feeling like choosing between options it has already made.

## Capability tiers — methods that work on CPU

1. **Clipper**: word-anchored cuts, ripple, reorder, trim by sentence; silence via VAD on aligned gaps; fillers from a disfluency-preserving transcript (Whisper normalises "um" away by default) — removed *selectively*, inside fluent clauses, kept or shortened at clause boundaries, always shown as a reviewable list; retakes by sentence similarity, last complete take by default; captions from word timings.
2. **Pacing**: pauses **shortened to a target, not deleted** (keeps the read human); cuts on breaths and stressed words; J/L-cuts by default on speaker change (audio leads 4–12 frames); dwell rules (reading time = ~0.3 s per word on screen + 1 s) enforced by the validator; "tighten X%" as above; pacing curves per edit profile.
3. **Sequences**: beat-cut montage with a CPU beat tracker (±70 ms; downbeats are much weaker — cut on beats, phrase on downbeats only when confident, let the user nudge the grid); multicam by active speaker (CPU-feasible models score 94% on the benchmark and ~82% in the wild — hysteresis, minimum shot 1.5–2 s, mic-energy fusion, manual override); B-roll anchored to word spans from the pictures layer; match cuts via frame embeddings as *suggestions*; nested sequences and templates per spine with typed slots (hook, claim, receipt, rebuttal).
4. **Direct visual edits**: 16:9 → 9:16 with a smoothed virtual camera (CPU at proxy resolution; a jerk penalty per shot); punch-ins on stressed words (110–130%, eased); speed ramps by frame blending (CPU) or optical flow (**GPU**); stabilisation two-pass (CPU) or learned (**GPU**); colour matching by per-shot statistics; kinetic type and overlays from the compositor. Object-tracked cutouts (**GPU**, segmentation models).
5. **Audio**: two-pass loudness to the profile; **ducking as gain automation generated from word timings** — deterministic, previewable, explainable in a diff — not a sidechain compressor; denoise and de-reverb on CPU (real-time factor ~0.04); stem separation on CPU (~1.5× duration) to pull speech out of source clips; music fitted to length by cutting on bars, looping a section, or stretching ≤5% so the last downbeat lands on the last frame; SFX on cuts **opt-in, default off**.

## Messy input — where "out of the box" breaks

- **Run speech recognition on the raw audio.** Cleaning first made results worse in every one of 40 tested configurations. Enhance only the final mix. Use voice detection so the transcriber doesn't invent text over silence.
- Normalise phone footage at ingest: variable frame rate → constant; rotation; HDR tone-mapped identically for preview and render. Resumable direct uploads for multi-hour files. Audio-based sync for multiple cameras.
- Speech-led types work out of the box. **Gameplay, montage, travel and sports have no speech spine** and need their own signal stack (audio events, motion, HUD text, chat activity, beat grids) and their own solver objective. Mixed languages: per-segment language id before transcription.
- **A release gate, not a demo**: a benchmark of ~480 tasks across edit types and input-quality levels, run nightly. Later: learn the solver's cost weights from professional cuts.

## For the handoff — infrastructure shape (confirm every price)

One server object per project holding both layers and the ops log (single writer; all state persisted — in-memory state dies on idle hibernation) · workflows fanning out to CPU containers for ffmpeg, the headless compositor and analysis models (return storage keys from steps, never media) · originals, proxies, renders and stems in object storage · **no GPUs on the platform** — segmentation, learned interpolation and learned stabilisation go to an external GPU host behind one job interface, results cached by (media hash, op params) · short-clip transforms only for thumbnails and filmstrips · hosted playback for review links, not as the edit proxy · **proxies self-generated at ingest** (fixed 1 s GOP, constant frame rate, 540p) because frame-accurate scrubbing needs predictable keyframes · browser preview via WebCodecs with the audio clock as master · **one compositor codebase** (a pure function of timeline and frame) in both browser and container, fonts bundled, colour managed identically · chunked render at block boundaries on closed GOPs, **audio as one continuous pass**, then mux. Cost anchor: CPU render well under a cent per finished minute; the money is in model tokens and GPU calls.

**Build order:** spine (ingest → proxy → transcript → alignment → document → text cuts → render cuts, with OTIO export) → clipper with the typed ops, dry-run diffs, undo/branch, preview → pacing engine with the validator and measured QC → compositor parity, chunked render, type, loudness, ducking, denoise → sequences (beats, multicam, B-roll, templates, stems) → the external GPU tier → the critic loop and the benchmark.

## Failure modes

agent claims success → validator + measurements + human accept · craft failure → critic with rubric and profile curves · hallucinated ids/times → handles only · lost state on long timelines → compact block view · re-alignment breaks edits → stable ids, orphan flags · VFR drift → conform at ingest · A/V drift across chunks → one audio pass, closed-GOP starts · beat and speaker errors in the wild → confidence, hysteresis, one-click override · idle hibernation → everything in storage · step output overflow → keys not media · GPU cold starts → batch per project.

## What this changes in Aldershot

- **Confirms the core bet.** Rules are policies; the Editor has no timeline; diffs are in editor's language; Recipes are saved policies; the Style Card is learned defaults; Home's "it could make" is the three-videos-at-upload move; questions batch at two moments. The research arrived at the shape we built.
- **"Revisions in plain feelings" enters the product now**: "the start drags", "hard to follow" and "tighter" compile to rules on Home and in the Editor. *(Product updated.)*
- **Alternates as options**: after a first cut, the tighter and more-room versions are pre-rendered and offered as a choice, not a request. Design decision for the Home flows.
- **Weak-spot flags**: the system names the block with no visual proof and offers the document. Belongs with the plan project.
- **The Editor stays as the door**: direct manipulation is the escape hatch the research says is non-negotiable, not a second product.
- **Infrastructure** above supersedes the earlier `05-INFRA` notes once prices are confirmed.

## Sources

- Timeline-Bench (arXiv, Sep 2026, unreviewed, commercial lab); EditDuet (SIGGRAPH 2025); LAVE (Wang et al., IUI 2024); ExpressEdit; Berthouzoz, Li & Agrawala 2012; Fried et al. 2019; QuickCut and the computational-editing literature (dialogue-scene editing, narration alignment).
- OpenTimelineIO schema and adapter feature matrices; Netflix match-cutting (Chen et al., WACV 2023); Beat This! (ISMIR 2024); Light-ASD, LoCoNet, UniTalk (arXiv 2505.21954), GateFusion (arXiv 2512.15707); SAM 2.1; RIFE/FILM; DeepFilterNet 2/3; Demucs; BS-RoFormer (SDX'23); Montreal Forced Aligner 2026 paper; ASR-on-raw-audio enhancement study (40 configurations).
- Cloudflare: Containers, Durable Objects, Workflows, R2, Media Transformations, Stream, Workers AI pricing and limits (Oct 2026 — confirm); Modal, RunPod, Replicate GPU pricing (third-party, conflicting); Remotion Lambda benchmarks; Chrome WebCodecs documentation.
- Walter Murch, *In the Blink of an Eye* (the rule of six, as a critic rubric).
