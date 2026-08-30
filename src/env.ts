import type { RenderContainer } from "./render.ts";

/** Shared Cloudflare bindings for the Aldershot Worker. */
export interface Env {
  AI: Ai;
  MEDIA: R2Bucket;
  DB: D1Database;
  // (no static-asset binding — every surface is server-rendered)
  // ffmpeg container — probe, frames, audio extraction, and (pending the model
  // question in 04-API-AND-JOBS.md) possibly Whisper itself. Optional so the
  // Worker still deploys before Containers are enabled.
  RENDER?: DurableObjectNamespace<RenderContainer>;

  // Clip embeddings — meaning search and thread formation (05-INFRA §Stack).
  // Optional: `wrangler deploy` hard-fails on a declared-but-missing Vectorize
  // index, so the binding stays commented out in wrangler.jsonc until the
  // index exists. Code must degrade to exact search rather than fabricate.
  VECTORIZE?: VectorizeIndex;

  // Job fan-out, one consumer per job type (04-API-AND-JOBS.md §Job pipeline).
  // Optional until the queue is provisioned.
  JOBS?: Queue;

  // R2 API token (secrets) — powers signed direct-to-storage uploads.
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;

  /**
   * Optional higher-reasoning provider. Workers AI is the default for every
   * role (see src/models.ts); when this key is present the roles marked
   * `preferAnthropic` route to Claude instead. Absent = everything stays on
   * Workers AI and the product still works.
   */
  ANTHROPIC_API_KEY?: string;

  /**
   * Public base URL of this Worker, so the render container can fetch source
   * media over HTTP. The container is a separate process: it cannot read R2
   * bindings, only URLs.
   */
  MEDIA_PUBLIC_BASE?: string;

  // Cloudflare Stream — preview playback (HLS + poster). Optional; without it
  // previews are served from R2 directly.
  STREAM_ACCOUNT_ID?: string;
  STREAM_API_TOKEN?: string;
}
