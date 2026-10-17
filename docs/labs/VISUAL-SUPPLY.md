# Visual supply — where pictures come from, and how motion gets made

7 Oct 2026, from the visual-supply research pass. Nothing here is built. `PICTURES.md` decides *what* a block should show; this decides *how it gets made* and what it costs.

## The one-line version

**Code first; stills as layered assets; motion from the compositor; paid video generation only when something in the picture has to act.** Words, numbers, arrows and highlights always render as code above any generated pixels — so the argument can never be corrupted by the pixel generator.

## What the evidence settles

1. **Charts, diagrams and type as code is the default, not an option.** Chart-to-code is saturated (frontier models 93–97% execution; self-correction cheap and effective). Agentic explanatory animation reaches ~94% success with a planner–coder–critic loop and a retry budget of ~5; the loop beat professional human tutorials on knowledge transfer in one study. Pixel video models cannot draw text: every model on the text benchmark scored below 0.43 ("hello" → "lhello"). **Rule: no chart, number or word is ever drawn by a diffusion model.**
2. **Image-first is right about the still, wrong about the destination.** The generated still is the *approval checkpoint* — "the expensive generation happens after the argument about composition is settled." But image-to-video's famous consistency is mostly an artefact of not moving (a *static* baseline beats real models on most I2V metrics; the most consistent model has 2.7% dynamic degree). For the subtle motion an essay needs — push-in, drift, parallax reveal — layered stills plus a compositor camera do the same job at near-zero cost with full control.
3. **I2V earns its cost only when the subject must act** (a hand signing, a crowd surging) and the action *is* the proposition. Then first/last-frame conditioning and reference images are the controls. Budget it: ≤10% of screen time, ~60 generated seconds per 10 minutes, retry twice then fall back to parallax. Best use: a "living plate" — 4–6 s of ambient motion on the *background layer only*, looped under compositor-controlled subject and type.
4. **AI imagery costs trust even when labelled.** News readers trust organisations less when images are AI-generated regardless of disclosure; a disclosure label on misinformation *raised* its credibility in one study. Labels are necessary for integrity; they don't neutralise the effect. So the defensible rules are categorical: generated imagery never on a claim or its proof, and **always visibly stylised** (vector, posterised, collage) — a design bet that stylisation reads as "illustration" not "record"; no study measures it directly.
5. **Data animation: staged, simple, ~1 s per stage.** Staged transitions improve graphical perception; complex ones and trend animations with many reversing points confuse even guided viewers. "Useful junk" is fine *if it encodes the argument*: embellished charts were read as accurately as plain ones and recalled significantly better weeks later. **Truncated axes mislead even when explained** (83.5% misjudged; broken-axis glyphs don't fix it) — the compiler enforces a zero baseline.
6. **Layout is the weak point of code graphics, not correctness** — and deterministic geometric checks (bounding-box overlap, safe areas, type size) beat a vision model eyeballing it by 10–15 points at a sixth of the cost. Spend model calls on semantic questions only.

## The architecture: one scene graph, many suppliers

Every block compiles to a **scene spec** in one compositor. Suppliers hand over **layers**, never finished video:

| Layer | Holds | Rule |
|---|---|---|
| Vector | typography, chart marks, diagram primitives, annotations — live SVG from design tokens | the only layer that may carry words or numbers |
| Evidence | document crops with provenance `{doc, page, bbox, quote hash}` + highlight / zoom / redaction masks | nothing here is ever regenerated |
| Footage | own footage, stock, I2V clips — trimmed | stock barred from claim and evidence blocks |
| Plate | generated stills decomposed into RGBA layers (subject / background / text), with a depth map for parallax | contains no data; stylised; labelled |
| Harmoniser | palette quantisation to the tokens, shared halftone and grain — raster layers only | makes a stock clip, a generated still and a code chart read as one object |

**Relation → motion grammar** (so the motion argues — from `PICTURES.md`'s jobs):
*elaborate* → hold and push in, nothing new enters · *extend* → additive build, old marks stay · *enhance* (cause, time) → directional: arrows, pushes, wipes in the causal direction · *project* (quote) → kinetic type of the verbatim words with a provenance tag · *contrast* → split, mirror, or hard cut between paired states.

**Routing by move** (what's forbidden matters more than what's preferred):

| Move | Route, in order | Forbidden |
|---|---|---|
| CLAIM | kinetic type of the claim → own footage of the speaker → evidence document | generated imagery · stock |
| EVIDENCE | document treatment (crop → zoom → highlight → annotate) → evidence-bound chart → archival footage | generated anything · stock · I2V |
| TURN | split-screen or wipe between two code-rendered states; staged chart transition | two unrelated stock clips |
| EXAMPLE | own footage → evidence screenshot → stylised still + parallax, labelled | photoreal generation of real people or events |
| CONTEXT | stock (semantic retrieval) → archival → stylised plate + compositor camera | stock with readable text or brands that imply specificity |
| JOKE | typographic punchline · freeze frame · reaction footage · deliberately crude collage | slow I2V — kills timing |
| TRANSITION | motif morph · chart-to-chart staged transition · type wipe | generic stock flyover |
| CONCLUSION | callback montage of motifs and earlier evidence frames | *new* generated imagery |

## The evidence-bound chart compiler

1. **Extraction.** A vision model reads tables and figures from the user's documents into typed datums, each carrying `{doc, page, bbox, verbatim cell}`. A second pass re-crops each bbox and string-matches; any mismatch **blocks the chart**.
2. **Spec, not code.** The model writes a declarative chart spec (Vega-Lite-like), so the lints below are enforceable.
3. **Lints (hard fails):** non-zero bar baseline · dual y-axes · area/volume encodings of 1-D data · more than 7 colour categories · unlabelled units · any datum without provenance · trend animation with >~10 moving points or reversing tracks.
4. **Render** from shared tokens; transitions staged, ~1 s per stage.
5. **The receipt shot — the house signature.** The chart's first frame is the *source document*. The highlighted cells lift off the page and become the chart marks. Likewise a quote: the words on the page lift into kinetic type. Provenance becomes a visible rhetorical act — it answers "says who?" on screen — and it inverts the truthiness problem: the most memorable images are the probative ones. This is what the Document block in `PICTURES.md` looks like in motion.

## The quality gate, per block, before render

1. **Deterministic first** (cheap): text bbox overlaps · safe areas · minimum type size · contrast against the underlying layer · **OCR of the rendered frame compared with the spec string** (catches any pixel corruption) · palette distance of raster layers from the tokens.
2. **Proposition check** (vision model, 3–5 frames, *no narration shown*): "Can a viewer who sees only these frames state the proposition?" and "Does anything here assert a fact not in the evidence?" It abstains when unsure and sends the block to the user.
3. **Gavel check:** "Would this be equally appropriate for a different sentence with the same nouns?" Yes → decorating, not arguing → re-route.
4. **Style conformance:** similarity to the style board + the palette check.
5. **Retry budgets:** 5 repair passes for code graphics · 3 for generated stills · 2 for I2V, then fall back to parallax.

## Cost per finished minute (≈12 blocks/min)

| Source | Share of screen time | Cost / finished minute |
|---|---|---|
| Code graphics and kinetic type | 40–50% | ≈ $0.02 (render compute, mostly inside an included tier) |
| Evidence documents and own footage | 20–30% | ≈ $0.01 |
| Stock (context and parallel-thread blocks only) | ~10% | $0 (free API tiers) |
| Generated stills + parallax | 10–15% | $0.16–0.54 |
| I2V | ≤10% (~6 s) | $1.50–2.70 (premium models up to $7) |
| Planning, judging, retries | — | ≈ $0.30–1.00 |
| **Total** | | **≈ $2–4 / minute** vs **$15–72** for an all-I2V minute with retakes |

Shares are a cost model for an essay, not a rule — a react piece is mostly exhibit footage. Prices are from aggregators and vary up to 10× for the same model; treat each as ±50% and measure on our own account.

## One style, many sources — but *whose* style?

The research assumes one house style ("typographic jump-cut constructivism"). That's the founder's channel, not the product. **Aldershot's contribution is the mechanism; the style is the user's:**

- **Design tokens as the single source of truth** — palette, type scale, stroke weights, grid, easings, cut tempo — in one file that the compositor, chart specs, image prompts and the harmoniser all read. Each user (or project) has their own; the constructivist set is one preset among several.
- **Quantise, don't match.** Prompt image models with the token colours and a style board, then posterise every raster layer to the palette (4–6 colours) and add shared grain. Quantisation is the strongest harmoniser there is — it makes heterogeneous sources read as one printed object (Fiore's mosaic logic).
- **Vector-native where feasible**: vector image models for flat illustration; model-written SVG only for icons and diagram primitives (it fails on complex scenes and style transfer); for rich illustration generate raster → decompose into layers → posterise.
- **Translate taste into parameters.** "Vertov meets Rodchenko" is unfollowable; "35 mm push-in, 6-colour poster palette, 4-frame cuts" is. The Style Card the editor already keeps is where these parameters accumulate.
- **A style LoRA on the user's approved frames** after the first pieces — never on reference artists' work. No published measurement of style-holding across dozens of shots exists; build the internal eval (50 prompts × the style score).
- **Typography is the spine**: live type in the compositor, never in pixels. This alone separates the product from every script-to-video tool.

## Motifs as assets

Every generated still that passes the gate becomes a **motif**: an id, its layers, a depth map, a meaning tag ("the institution", "the hidden cost"). The planner reuses motifs with transformations — scale, palette inversion, fragmentation, collage overlap — so imagery accumulates meaning across the piece (the memorability effect, applied on purpose) and reuse costs nothing. This is the asset side of `PICTURES.md`'s visual memory.

## Failure modes

| Failure | Mitigation |
|---|---|
| the gavel — noun-matched visuals | route by move and relation; gavel check; stock barred from claim/evidence |
| the generic stock look | quantise + grain; crop and recompose; stock ≤ ~10% |
| text corruption in generated video | text never in pixels; OCR check on rendered frames |
| chart swapped mid-shot by I2V | charts never I2V inputs; plates contain no data |
| static or over-animated I2V | compositor or parallax first; I2V camera-only or single-action with a last-frame lock |
| identity drift across shots | reference images; one locked character sheet; reuse plates instead of regenerating |
| layout collisions in code graphics | grid-anchored placement; geometric verifier before any model critique |
| hallucinated APIs in generated code | a typed component library — the model fills props, not raw APIs; compile-and-repair ≤5 |
| misleading charts | lints; zero baseline; the receipt shot |
| wrong extracted data | bbox-anchored datums; re-read verification; block on mismatch |
| trust penalty from AI imagery | none on claim/evidence; always stylised; per-asset label on the cue sheet |
| cost blowout | I2V budget per piece; automatic fallback to parallax |

## What this changes in Aldershot

- **The existing editor rule "Turn the numbers into an animated chart — built as code, not generated pixels" is confirmed and gets its signature**: it opens on the document the numbers came from, the highlighted cells lift off and become the chart. Same for quotes → type. *(Product copy updated.)*
- **"Generated pictures are never photoreal"** joins "never over a claim or its proof" in *Before you post*. *(Product copy updated.)*
- **Style belongs to the user.** Tokens per user/project; the Style Card is where "director–painter–cinematographer" taste becomes parameters. The constructivist look is a preset, not the product.
- **A generated-seconds budget per piece** is a rule in the product's vocabulary (*"Under a minute of generated motion per ten"*), switchable, with its cost shown — for when generation exists.
- **For the handoff:** the renderer is a scene-graph compiler (block + proposition + relation + role → layered, editable scene), not a video generator; every asset a node with provenance; every motion a typed verb; re-render when a line changes. Stack candidates (React-based compositor in containers with ffmpeg; a maths-animation library only for genuine maths, composited as a layer; Lottie for hand-made motif animation) go in `05-INFRA`, not here.

## Sources

- Chart/code: ChartMimic and its leaderboard; "From Charts to Code" (arXiv 2510.17932); TheoremExplainAgent (ACL 2025); Code2Video (NUS Show Lab); SGA geometric verifier; T2VTextBench; VidScribe.
- I2V: VBench++ I2V; MotiF; Animate-Anything; DynamiCrafter; Step-Video-TI2V; vendor docs for Veo 3.1, Kling 3.0, Seedance 2.0; Bullock, "Image First or Text to Video?" (Sep 2026).
- Trust: Toff & Simon (International Journal of Press/Politics, 2025); online experiment N=1,171 (authorship unconfirmed); JCOM N=433 disclosure study.
- Data animation: Heer & Robertson (InfoVis 2007); Robertson et al. trend animation; Bateman et al. (CHI 2010); Yang et al. and Correll et al. on axis truncation.
- Layers and depth: Qwen-Image-Layered; 3D Ken Burns; Depth Anything V2. Vector generation: SVGenius; StarVector; Recraft V3.
- Costs: vendor list prices and aggregators (±50%); Cloudflare Containers pricing; Remotion licensing and Lambda benchmark.
