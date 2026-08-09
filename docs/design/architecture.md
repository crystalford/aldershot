# Aldershot — Vision & Architecture

> **Superseded.** This describes an earlier, much larger vision for this
> project — an autonomous trend-detection-and-content-generation system
> ("the Radar" + "the Studio"). The product actually built is a
> Descript-style AI video editor for creators working from their own
> footage — a different, more grounded scope. Kept for history; **see the
> root `README.md` for what's actually built and shipped today.**

_Living design doc. Big-picture north star, not yet an engineering spec._
_Companion to `docs/research/feasibility.md` (what's technically possible on Cloudflare)._

---

## What Aldershot is

A **Cloudflare-native cinematic media company-in-a-box.** It decides *what* content
to make and *when*, then produces it to a high, intentional standard — generated media
mixed with sourced clips — and (later) publishes it. Built first for one operator
(dogfooded on real content), then released as a metered SaaS.

The thesis: **the models are a commodity; the moat is the workflow.** Anyone can call
Veo. Almost nobody has a system that catches a wave early *and* renders a Kubrick-grade
piece about it without the operator iterating in a prompt box for hours.

It solves two problems at once:
1. **Timing/temperament** — "I know I should ride trends, but watching them isn't my
   motivation, so I'm never prepared." → The system maintains readiness for you.
2. **Craft/iteration** — "Veo/Sora is just iterate, wait, pay." → A repeatable formula
   that produces intentional scenes without slot-machining.

---

## The two engines

```
┌─────────────────────────┐        ┌──────────────────────────┐
│   OPPORTUNITY ENGINE     │  pick  │   CINEMATIC COMPILER      │
│      "the Radar"         │ ─────▶ │      "the Studio"         │
│  what to make & when     │  an    │  how to make it beautiful │
└─────────────────────────┘ angle  └──────────────────────────┘
        │                                      │
   ideation wizard                        text→image→video
   (you = taste-maker)                    render → publish
```

### 🛰️ Opportunity Engine ("the Radar") — *what to make, and when*

The part that compensates for not naturally watching trends.

- **Signal sweep.** Agentic AI search (Cloudflare AI Search / Brave-style) on a
  schedule via **Cron Triggers** — runs itself in the cloud, no laptop. Scans what
  people are *actively consuming now*: model launches, show premieres, game drops,
  memes, news.
- **Window, not saturation.** Each trend gets a **window** — when it's live and when it
  expires (Fable: ~1 wk until pulled from Claude; Widows Bay: new ep Wed ~8pm ET). The
  point isn't a crowdedness score (operator already has trend instinct) — it's "here's
  the window, fire inside it." Once a trend is identified, **quality/insight decides**,
  not timing games. Optional **fit** flag (matches operator's lane?) is the only scoring
  that earns its keep.
- **Anticipatory calendar.** Known upcoming waves (next ChatGPT release, ongoing shows,
  holidays, sports, product launches). AI-populated + manually editable. This is the
  *preparedness* fix — pre-stage angles before the wave breaks.

### 🎬 Cinematic Compiler ("the Studio") — *how to make it beautiful*

A deterministic pipeline from idea → finished film. Stops the operator from re-prompting.

- **Treatment** — thesis, tone, visual motif, color story, emotional arc.
- **Shot list** — break into shots; each specified on controlled axes: subject &
  blocking, lens/focal length, camera height & angle, movement, lighting setup & key
  direction, palette, texture/film stock, mood, *symbolic intent*.
- **Prompt synthesis** — compile each shot spec into model-specific prompts.
- **The text→image→video backbone** (see feasibility doc): art-direct the *look* in a
  cheap native FLUX still (full control, pennies), then animate that locked frame with
  an I2V model. Less waste, more control. Route cheap I2V (Wan) for B-roll, premium
  (Veo/Runway) for hero shots.
- **Style packs** — versioned, reusable "looks" (the patented-in-spirit asset). Author
  a look once; the compiler applies it deterministically. This is what makes output
  consistent and on-brand instead of re-discovered each time.
- **Subject consistency** — first-class concern (FLUX.2 multi-reference, locked frames).

### The bridge: the ideation wizard ("generative engine for subjectiveness")

Claude-Code-style interaction. Radar surfaces a hot wave → ideation LLM pitches several
creative **angles** (funny / analytical / contrarian / explainer) → presents as
**multiple-choice** → operator approves one → develops into a script → hands to the
Studio. **Operator stays the taste-maker; the system does the watching, preparing, and
building.** Works both ways: Radar can *suggest*, or operator can *push* a topic directly.

### Ideation quality — how it gets good, and how it gets *yours*

The brain is not separate from "Claude" — it **is** a frontier model (Claude via AI
Gateway). So out of the box it ideates at frontier quality. What makes it *reliable* and
*on-brand* is three layers — an "idea compiler" mirroring the visual one:

1. **Context engineering** (biggest lever) — feed the model *real trend facts* (Radar
   research), the operator's **taste profile** (voice, no-go's, what's hit before), and
   examples. Thin prompt → clichés; rich structured context → insight. The "gentrification
   = the curse" read only existed because the show was *researched first*.
2. **The quality score** — generate N candidate angles, then score each (model-as-critic)
   on explicit axes: **insight** (non-obvious?), **timeliness** (rides the window?),
   **fit** (the voice?), **shareability** (will people repost?). Rank, surface the top few,
   optionally self-critique-and-revise.
3. **Feedback flywheel** — every operator pick (A over B) and every real outcome (views)
   feeds back into the taste profile. Over time it's not "generic Claude guessing" — it's
   a model tuned to what *this* audience shares. That tuning is the moat a cold model can't copy.

Honest bar: it won't be 100% bangers — it'll be like a strong collaborator, some great,
some mid. That's *why* the human-pick wizard exists: the system surfaces enough good
options fast; the operator's taste does the final 10%.

---

## Content spectrum — clips ↔ cinematic

Not everything needs the full compiler. Output spans a spectrum, and the Radar feeds
both ends:

- **Tier 0 — Clips / GIFs.** Zero generation. Pure **timing + recognition**: spot the
  moment that will hit (the "Patricia dancing" GIF), be *first* while the episode's fresh,
  caption/format/ship in minutes. The system's value here is a **moment detector** — as
  episodes/streams get discussed, flag the clippable beats (the dance, the line, the
  reaction), rank them for share-potential, and hand the operator a grab instruction
  (timestamp + source) routed through the human-loop gate. Solves "ship something, not
  nothing" on low-effort days.
- **Tier 1 — Essays / cinematic.** The full Studio + compiler (e.g. the Fable eulogy).

A single wave might want a clip, an essay, or both. The moment detector and the ideation
engine are the same analytical layer pointed at two different output tiers.

## End-to-end pipeline

```
Cron sweep / manual input
   → wave detected & scored
   → ideation wizard pitches angles  ──(human approves)──┐
   → script + treatment                                  │ human-loop gate
   → shot list + per-shot specs                          │
   → generate: FLUX stills → I2V motion + Aura voiceover  │
   → source clips: AI search → [auto-fetch | manifest]───┘ human-loop gate
   → assemble (ffmpeg in Containers): cut, sync, caption, grade
   → store (R2) / deliver (Stream)
   → publish (later phase)
```

Two human-loop gates, matching the "hybrid automation" requirement: **(1)** approve the
creative angle, **(2)** fetch any clips that have no legit auto-source (download → upload
→ system resumes; system does 100% of the editing).

---

## Cloudflare architecture mapping

| Concern | Cloudflare primitive |
|---|---|
| Scheduled trend sweeps | **Cron Triggers** |
| Durable multi-step pipeline + pause/resume gates | **Workflows** |
| All AI calls (LLM, FLUX, Aura, Whisper, video) | **Workers AI** (`env.AI.run()`) |
| Video gen (partner) + caching/routing/metered resale | **AI Gateway** |
| Agentic search | **AI Search** (+ external search as needed) |
| Trend clustering, dedup, asset/style search | **Vectorize** |
| Project state, calendar, wave records | **D1** |
| Media assets (stills, clips, cuts) | **R2** (zero egress) |
| Render/assembly (ffmpeg) | **Containers** |
| Encode + adaptive delivery | **Stream** / **Images** |
| SaaS auth + per-use metering | AI Gateway unified billing + Workers |

Everything runs in the cloud — **the operator's "crappy laptop" is just a browser to
the console.**

---

## Phased roadmap

- **v0 — Spine.** Manual input → script → text→image→video for ONE shot → ffmpeg
  assemble → playable clip in R2. Proves the Studio end-to-end.
- **v1 — Video-essay engine.** Full Studio: multi-shot, voiceover, sourced-clip
  human-loop gate, style pack v1, console to drive it.
- **v2 — The Radar.** Cron sweeps + wave scoring + ideation wizard + calendar.
- **v3 — Publish + distribute.** Social posting, the sharing layer.
- **v4 — SaaS.** Auth, metering, multi-tenant; expose the same machine publicly.

---

## Niche & voice (v1 working definition)
Timely, **insightful** commentary on **what people are actively consuming** — video
essays + memes. Two starting verticals: **prestige TV** (Apple TV hits — Widows Bay,
Maximum Pleasure Guaranteed, Plural) and **AI/culture moments** (Fable 5, model launches).
Bias: ship something good *now* over shipping nothing perfect.

## Open questions
- Per-model **video pricing** confirmation (feasibility doc §5).
- Where the finished essay/video gets **published** / distributed (phase v3).
- Exact v0 stack choice (Workers runtime + framework) — to be set when build starts.
