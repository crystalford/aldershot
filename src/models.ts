/**
 * Per-role model router — every AI call site reads a model id from here by
 * role, never inline. Swapping a model (a newer Llama, a faster FLUX variant)
 * is a one-line change here instead of a grep-and-replace across the codebase.
 *
 * `@cf/`-prefixed ids run natively on Cloudflare's own GPUs, billed in
 * Neurons. Bare `provider/model` ids (no `@cf/` prefix) are partner models —
 * routed through the same `env.AI.run()` call and the same Cloudflare bill,
 * but the inference itself runs on the partner's infrastructure under the
 * partner's own ToS, billed pass-through + 5% instead of in Neurons. Video
 * generation has no native option at all today — every video model in the
 * catalog is a partner model (see docs/research/feasibility.md §2).
 */
export const MODELS = {
  /** Text reasoning — arrange, compose, bridges, coherence drafting, scene-building. */
  writer: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  /** Vision — captioning + OCR for visual tagging. */
  vision: "@cf/moondream/moondream3.1-9B-A2B",
  /** Speech-to-text. */
  transcribe: "@cf/openai/whisper-large-v3-turbo",
  /** Image generation — native. Up to 4 reference images per call, the
   *  mechanism Generative uses to hold one scene's look consistent across
   *  multiple cuts. */
  stills: "@cf/black-forest-labs/flux-2-dev",
  /** Image-to-video — partner (Google, via AI Gateway pass-through). The
   *  "fast" tier by default since generated video is by far the dominant,
   *  most variable cost in this pipeline; swap to "google/veo-3.1" here if
   *  quality matters more than cost for a given release. */
  animate: "google/veo-3.1-fast",
  /** Text-to-speech — native. Not wired into any route yet. */
  voice: "@cf/deepgram/aura-2-en",
} as const;
