# Aldershot — Vision & Architecture

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
- **Wave scoring.** Each detected trend scored on:
  - **Velocity** — how fast it's rising
  - **Saturation** — how crowded it already is (the anti-"pissing in the wind" signal)
  - **Fit** — match to operator's niche / voice / capabilities
  - **Window** — how long the wave will last
  → yields a **ride score** + recommended stage (jump now / build for later / skip).
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

---

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

## Open questions
- Operator's **niche/voice** — needed to make "fit" scoring and style packs meaningful.
- Trend **saturation** measurement — what concretely signals "too crowded"?
- Per-model **video pricing** confirmation (feasibility doc §5).
- Where the finished article/essay gets **published** (the old "Canopticon" slot).
