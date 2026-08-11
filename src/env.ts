import type { RenderContainer } from "./render";

/** Shared Cloudflare bindings for the Aldershot Worker. */
export interface Env {
  AI: Ai;
  MEDIA: R2Bucket;
  DB: D1Database;
  ASSETS?: Fetcher;
  // ffmpeg container — extracts + chunks audio for long-video transcription.
  // Optional so the Worker still deploys/works before Containers are enabled.
  RENDER?: DurableObjectNamespace<RenderContainer>;

  // Clip embeddings — powers Threads' semantic clustering (see
  // src/embeddings.ts, src/threads.ts). Optional, same reasoning as RENDER:
  // the Worker still deploys/works via the tag-equality fallback before
  // `wrangler vectorize create` has been run and this binding added.
  VECTORIZE?: VectorizeIndex;

  // R2 API token (secrets) — powers signed direct-to-storage uploads.
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
}
