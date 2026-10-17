# 08 · Pictures and voice

## The gavel problem

Every script-to-video tool matches nouns: "the court ruled" gets a stock gavel. That is an integrity problem, not a style one — a related but non-probative picture makes a claim more likely to be judged true. **The picture answers "why am I seeing this," never "what noun did the sentence contain."**

## The framework

1. **Classify each line's move**: CLAIM · EVIDENCE · TURN · CONTEXT · EXAMPLE · ABSTRACTION · JOKE · TRANSITION · CONCLUSION.
2. **The move sets the picture's job, its source order and its risk**:

| Move | Visual job | Source order | Forbidden |
|---|---|---|---|
| EVIDENCE | probative — the proof itself; the document with its line marked | own footage → user's documents | generated anything · stock · I2V |
| CLAIM | attribution — the speaker, a name super, kinetic type of the claim | own footage | generated · stock |
| TURN | contrast — cut back, split, reprise with new meaning | own footage, reused | two unrelated stock clips |
| CONTEXT | orientation — place, timeline | own → open world → stylised plate | stock with readable text or brands |
| EXAMPLE | one specific instance | own → documents → stylised still | photoreal generation of real people or events |
| ABSTRACTION | a diagram or chart **from real numbers** | documents → generated graphic, labelled | a stock chart |
| JOKE | timing — a hold, a reaction, nothing | own | slow generation |

3. **Score candidates**: probative value → relation fit → source priority (own 1.0 · documents 0.8 · licensed open world 0.5 · generated 0.3) → a novelty penalty against what's already been shown (deliberate reprise allowed on a TURN).
4. **"Nothing to show" is a result**: hold on the speaker or a plain card. For claims and jokes the face is usually the strongest picture.
5. **Every picture is typed** evidence / illustration / synthetic; the type sets the on-screen label and the cue-sheet entry.

The **pictures rule** exists in the product's vocabulary: *Pictures from own footage first, then your documents, then the open world — never generated over a claim or its proof.* Switchable; its off-state is named for what it is ("pictures picked by match alone — the stock-gavel problem").

## Graphics as code, never pixels

Charts, diagrams, type and annotations render as code from design tokens — no diffusion model draws a word or a number (they can't). The **evidence-bound chart compiler**: a vision pass extracts datums with `{doc, page, bbox, verbatim cell}`; a re-read verifies; any mismatch blocks the chart. Lints as hard fails: non-zero bar baseline, dual axes, area encodings of 1-D data, >7 colour categories, unlabelled units, any datum without provenance. Staged transitions, ~1 s per stage.

**The receipt shot — the house move.** The chart's first frame is the source document; the highlighted cells lift off the page and become the marks. A quote's words lift from the page into kinetic type. Provenance becomes a visible act and answers "says who?" on screen.

## Visual supply

- The generated **still is the approval checkpoint**; motion comes from the compositor (push-in, drift, parallax over layered stills), at near-zero cost.
- Video generation only when the subject must *act*, budgeted (≤10% of screen time, ~60 generated seconds per 10 minutes), retry twice then fall back to parallax. Best use: a living plate on the background layer only.
- **Generated is never photoreal** — AI imagery lowers trust even when labelled; stylisation (vector, posterised, collage) is the design bet.
- Suppliers hand over **layers**, never finished video: vector (the only layer that may carry words or numbers) · evidence (document crops with provenance; never regenerated) · footage · plate (generated stills as RGBA layers + depth) · a harmoniser quantising rasters to the palette.
- Style belongs to the user: design tokens per project; the Style Card turns taste into parameters; the constructivist look is a preset, not the product.
- Cost ≈ $2–4 per finished minute against $15–72 all-generated.

## Voice

**Voice beats** are rows in the cut: a gap after each thread (the gap rule), a narration line from a plan, an inserted line or reaction. Each is *yours to record or rewrite*. Narration appears **only where the footage can't say it**.

**Recording** happens in the Editor, line by line: a 3-second countdown, one line (one breath group, 4–7 words, the final stressed word bold), every take kept, pick a take, next beat. The prompter scroll **follows the voice**, not a fixed speed. Flubs: restart from the line start; the transcript's last complete instance wins. Ad-libs become **freestyle inserts**, not errors. Chat prompts a single line for the one gap ("say this"); the Editor runs the session for many.

**Don't over-clean.** Remove fillers only inside a breath group; shorten pauses between groups rather than delete them. Airless delivery sounds synthetic. Scripted versus spontaneous speech is audible (87%): scripted lines for descriptive content, the user's own voice for opinion.

**Timing contract.** Everything anchors to **word ids**, never seconds. A real forced aligner (≈20 ms) over the recogniser's (≈110 ms, visibly late). Cuts and type hits land on the onset of the group's final stressed word minus 1–2 frames; beat in/out points snap to breath-group pauses; **music is retimed to speech, never the reverse**.

**Scratch voice** (ElevenLabs, the user's key): for stumble detection, relative pacing and an animatic — never as a duration predictor (use the user's own measured words per minute) and never shipped. The voice profile / clone is tabled (`12-DEFERRED.md`).

**Sound rules** in the product's vocabulary (from It noticed and the plan): clean the hum · duck the music under the voice (keyed to word timings, −18 to −20 dB) · lift your voice over the other speaker · stabilise the walking shots · music only swells on a card · an exhibit's own sound takes the floor (J-cut, voice stops).

*Rests on:* `labs/PICTURES.md`, `labs/VISUAL-SUPPLY.md`, `labs/SCRIPT-AND-TIMING.md`, `labs/FORMATS.md`.
