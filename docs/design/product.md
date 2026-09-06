# Aldershot — Product & Console Design

> **Superseded.** Written for the earlier "cinematic media company"
> vision (Feed/Radar, Studio generative pipeline, amber branding) — none
> of that was built. The Transcript Editor concept described in §3 below
> is the one part that survived and became the actual product. **See the
> root `README.md` for the current feature set**, and the published
> design spec linked from it for the current visual direction (dark,
> violet accent, Bricolage Grotesque + IBM Plex Sans — not the amber/serif
> direction below).

_How the thing looks, feels, and works. Web-first; native app later._

## Principles
1. **Simple over capable.** One clear primary action per screen. Not a cluttered NLE —
   text-first and AI-first. If it feels like Premiere, we failed.
2. **The model is the interface.** You direct in plain language; the system does the
   mechanical work. Taste stays human; labor goes to the machine.
3. **Fast and edge-served.** UI is instant (Cloudflare edge). Heavy work (gen, render,
   transcribe) runs async via Workflows with live status — the UI never blocks.
4. **Ship something, not nothing.** Every surface can produce *a* deliverable today,
   from a 30-second clip to a full essay.

## It's a suite, not one product
Shared brain + shared asset library (R2), several focused tools:

### 1. Feed — the home (the Radar)
What to make, right now. A scannable list of live waves with their **window** (e.g.
"Widow's Bay finale — Wed 8pm"), each expandable into **suggested angles** (the ideation
wizard) and **clippable moments** (Tier 0). One tap turns a suggestion into a project.

### 2. Studio — the generative pipeline
The cinematic essays. Ideation wizard → script → shot sheet (`ShotSpec`s) → generate
(FLUX → I2V) + voiceover (Aura) → assemble. Progress shown as a living checklist;
human-loop gates pause for your approval or clip uploads.

### 3. Transcript Editor — the Descript-style console *(you asked for this)*
Upload a video/clip → auto-transcribe (Whisper) → **edit the video by editing the text.**
Delete a sentence, the footage is cut. Highlight to make a clip. Auto-captions, filler-word
removal, export to R2/Stream. Doubles as the polish step for Studio essays *and* a
standalone-useful tool (it could even be its own entry point).

### 4. Library
Every project, asset, and style pack. R2-backed, searchable (Vectorize).

### 5. Publish *(later phase)*
The distribution/sharing layer.

## How it feels
Cinematic and editorial: near-black canvas, bone-white type, a single warm **amber**
signal accent (the "light in the dark" motif from the eulogy look). Quiet, confident,
prestige — it should feel like a film studio's tool, not a SaaS dashboard. Generous
spacing, big type, few buttons.

## How it performs
- **Frontend:** web app served from Cloudflare; talks to the existing Worker API.
- **Async everything heavy:** Workflows orchestrate gen/render/transcribe; the UI polls
  or streams status. Optimistic UI so actions feel instant.
- **Assets stream from R2/Stream**, no egress cost, fast globally.
- **Path to native app:** the web app is a thin client over the API — a native
  (iOS/desktop) shell later reuses the same backend untouched.

## Branding (v0 direction)
- **Name:** Aldershot — austere, English, a little vintage-prestige. Fits the
  prestige-TV / retro-horror / AI-culture lane.
- **Mark:** a **beacon/radar sweep** — concentric arcs from a point. Reads as both
  "signal in the dark / spot the wave" (the Radar) and a lens/aperture (cinema).
- **Palette:** near-black `#0B0B0C`, bone `#EDE8DF`, amber signal `#F2A93B`.
- **Type:** editorial serif wordmark (masthead feel) + clean sans for UI.
- First logo concept: `brand/aldershot-logo.svg`.

## Roadmap fit
- **v0/v1:** Studio spine + Transcript Editor (both immediately useful, dogfoodable).
- **v2:** Feed/Radar (Cron trend sweeps + ideation wizard + moment detector).
- **v3:** Publish. **v4:** SaaS (auth + metering) and the native app.
