# Aldershot — Feasibility Research

_Compiled 2026-06-12. Multi-source, cited. Flags where facts are uncertain or fast-moving._

Aldershot is a Cloudflare-native cinematic media engine. v1 is an **automated
video-essay engine** that mixes **generated media** (script, voiceover, stills,
motion) with **sourced real clips**, assembled into a finished cut. This doc
records what's actually possible on Cloudflare today and where the edges are.

---

## 1. Verdict: the "all-Cloudflare" thesis holds

You can run essentially the entire pipeline through Cloudflare — **one `env.AI.run()`
API and one bill** — including video generation, even though the video GPUs are
partner-operated.

| Capability | On Cloudflare? | How |
|---|---|---|
| Scripting / planning (LLM) | ✅ native | Workers AI: Llama 4, GLM, Kimi, Mistral |
| Image / stills | ✅ native | Workers AI: **FLUX.2 [dev]** (4 ref images), Leonardo, SDXL |
| Voiceover (TTS) | ✅ native | Workers AI: **Deepgram Aura-2** |
| Transcription (STT) | ✅ native | Workers AI: Whisper, Nova-3 |
| **Video generation** | ✅ **partner** | Catalog models via AI Gateway: Runway Gen-4.5, Veo 3.1, Seedance 2.0, Hailuo, Pixverse, Vidu, xAI Grok |
| Orchestration | ✅ native | **Workflows** (durable, pause/resume) |
| Heavy render (ffmpeg) | ✅ native | **Containers** (GA Apr 2026) |
| Storage / delivery | ✅ native | **R2** (zero egress), **Stream**, **Images** |
| State / search | ✅ native | **D1**, **Vectorize** |

The one nuance: video models are **not** `@cf/` native — they're partner models
with `provider/model` IDs (e.g. `runwayml/gen-4.5`, `xai/grok-imagine-video`),
billed **pass-through + 5% credit fee** rather than in neurons.

---

## 2. Cloudflare generative media — models & pricing

### Image (native, neuron-billed)
- **FLUX.2 [dev]** `@cf/black-forest-labs/flux-2-dev` — up to **4 reference images**
  (512×512) for subject consistency; output up to 4 MP. ~**$0.00041 / output
  512×512 tile / step**. (Klein 4B/9B variants also available.)
- **Leonardo Lucid Origin** `@cf/leonardo/lucid-origin` (full-HD), **Phoenix 1.0**
  `@cf/leonardo/phoenix-1.0` (strong text rendering).
- **SDXL** `@cf/stabilityai/stable-diffusion-xl-base-1.0`.

### Voice / speech (native, neuron-billed)
- **Aura-2 TTS** `@cf/deepgram/aura-2-en` / `-es` — **$0.030 / 1k input chars**;
  Aura-1 `@cf/deepgram/aura-1` at $0.015/1k with named voices + WebSocket streaming.
- **Nova-3 STT** `@cf/deepgram/nova-3` — $0.0052/audio-min (HTTP) / $0.0092 (WS).
- **Whisper** `@cf/openai/whisper-large-v3-turbo` (exact per-min price unconfirmed).

### Video (partner, AI-Gateway-billed)
Called via `env.AI.run()`; billed provider pass-through + **5%** on purchased credits.
Max resolution across catalog **1080p**; max duration **~16s** (Vidu Q3).

| Model | Resolutions | Duration | I2V / audio |
|---|---|---|---|
| `runwayml/gen-4.5` | up to 720p | 2–10s | I2V ✅ |
| `google/veo-3.1` (+ `-fast`, `veo-3`) | 720p/1080p | ≤8s | I2V ✅, audio ✅ |
| `vidu/q3-pro` / `q3-turbo` | 540/720/1080p | ≤16s | I2V ✅, audio ✅ |
| `bytedance/seedance-2.0` | — | — | multi-ref, audio, edit/extend |
| `minimax/hailuo-2.3` | — | — | "realistic human motion, cinematic VFX" |
| `pixverse/v6` / `v5.6` | ≤1080p | 1–15s | I2V ✅, audio ✅ |
| `xai/grok-imagine-video` | 480/720p | ≤15s | text/image/video in, synced audio |

⚠️ Per-clip video pricing is **not published** on Cloudflare's neuron page; it's the
upstream provider rate passed through. Third-party blogs cite ~$0.05/s (Grok) to
~$0.25/s (Runway Gen-4.5) — **confirm per-model against the live catalog**.

**Confirmed against primary source (Cloudflare's GitHub model catalog, 2026-06-12):**
There is **no native (`@cf/`, neuron-billed) video model — including Wan.** The `@cf/`
prefix is the tell of a Cloudflare-hosted, neuron-billed model (FLUX = `@cf/black-forest-labs/flux-2-dev`).
Every video model instead uses bare `provider/model` IDs and points to the provider's
own ToS: Wan = `alibaba/wan-2.7-i2v` (provider `alibaba`), Grok = `xai/grok-imagine-video`
(links to x.ai ToS, `"Unified"` gateway billing key), Veo = `google/veo-3`. Wan being
open-weight does **not** make it native here — Cloudflare exposes it as a partner/gateway
model; neuron pricing would require self-hosting the weights on your own GPUs. **Net:
all video = AI-Gateway pass-through + 5%, no exceptions.**

### Neuron model
- **$0.011 / 1,000 neurons**, **10,000 neurons/day free**, on Workers Paid ($5/mo).

### Cost of one ~4-minute essay (rough)
- Voiceover (~14k chars Aura-2): **~$0.42**
- ~20 FLUX.2 stills: **~$1**
- 50s generated motion: **~$2.50–12.50** (model-dependent — the swing factor)
- Sourced clips (Pexels): **$0**
- LLM scripting + render compute: **cents**
- **Total ≈ $4–15 per finished essay.** Generated video is the dominant cost.

---

## 3. Clip sourcing — the "sourcing ladder"

**Design direction: AI-native, not integration glue.** Aldershot does not wire up a
rack of bespoke stock-footage REST connectors. Sourcing is driven by **agentic AI
search** (e.g. Brave/Cloudflare AI Search) that *finds* candidate clips across the
open web, then routes them down the ladder. The pipeline never scrapes YouTube.

**Tier 1 — auto-source (when AI search lands on freely reusable footage):**
- Freely-licensed sources the agent can fetch directly — **Pexels**, **Internet
  Archive**, **Wikimedia Commons** (per-item license check; attribution / share-alike
  where required). Treated as an *optional convenience*, not a hard integration.
- **Storyblocks** remains a possible paid "insurance" source if zero-friction licensed
  footage is ever wanted — but it's not the primary path.

**Tier 2 — human-in-the-loop (the default for found clips):**
- **TikTok** (research-only, non-commercial), **Twitch** (24h cache, no re-syndication),
  **Instagram** (owned accounts only), general **Vimeo/YouTube** catalog.
- Handled via a **shot manifest**: system outputs URL + in/out timestamps + intent +
  target filename. User downloads, uploads, system resumes and edits. System does
  100% of editing; user only moves the file across the ToS boundary and owns the
  rights call.

⚠️ **Legal reality:** for "downfall-of-X" commentary, the cover is **fair use**, a
human judgment the tool cannot guarantee. UI must surface source + license so calls
are informed, not blind. (Not legal advice.)

---

## 4. Rendering / assembly on Cloudflare

- **Containers** went **GA Apr 2026** (Workers Paid). Max **4 vCPU / 12 GiB / 20 GB
  disk** per instance; **no hard request-duration wall** (lifecycle via
  `sleepAfter` / `keepAlive`); CPU billed only when active (~$0.00002/vCPU-s).
- **No customer GPU** — renders are CPU/software only.
- **ffmpeg runs cleanly** in Containers (HeyGen's `hyperframes-cloudflare-template`
  does Chromium+ffmpeg→R2 today).
- **Remotion** has an *official* Cloudflare Containers guide but flags it
  **proof-of-concept, not production-ready** (no auth/queue/progress). For scale,
  Remotion recommends **Lambda** (distributed) or **Cloud Run** (cheaper, single-machine).

**Decision:** core assembly = **ffmpeg in Containers** (all-Cloudflare, works today).
Remotion is the nicer authoring tool for kinetic-typography/motion-graphics essays
but may push heavy renders off-Cloudflare. Start ffmpeg; revisit Remotion if the
essay style demands programmatic motion graphics.

---

## 5. Open items to confirm before scaling
- Exact **per-model video pricing** (live catalog, per provider).
- Exact **Whisper** and **SDXL** neuron prices (pages were bot-blocked to fetchers).
- **GPU-on-Containers** status — Cloudflare has internal GPUs and signaled rollout;
  re-verify before assuming "CPU-only" forever.
- **Storyblocks API** pricing (sales quote).

## Primary sources
- Workers AI models: https://developers.cloudflare.com/workers-ai/models/
- Workers AI pricing: https://developers.cloudflare.com/workers-ai/platform/pricing/
- AI Gateway unified billing: https://developers.cloudflare.com/ai-gateway/features/unified-billing/
- Containers limits: https://developers.cloudflare.com/containers/platform-details/limits/
- Containers GA: https://developers.cloudflare.com/changelog/post/2026-04-13-containers-sandbox-ga/
- Remotion on Cloudflare: https://www.remotion.dev/docs/cloudflare-containers
- Pexels API/license: https://www.pexels.com/api/ · https://www.pexels.com/terms-of-service/
- Pixabay API: https://pixabay.com/api/docs/ · https://pixabay.com/service/terms/
- Internet Archive API: https://archive.org/developers/index.html
- TikTok Research API: https://developers.tiktok.com/products/research-api/
- Twitch developer agreement: https://legal.twitch.com/legal/developer-agreement/
