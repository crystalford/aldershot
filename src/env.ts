import type { RenderContainer } from "./render";

/** Shared Cloudflare bindings for the Aldershot Worker. */
export interface Env {
  AI: Ai;
  MEDIA: R2Bucket;
  DB: D1Database;
  ASSETS?: Fetcher;
  // ffmpeg render container (Transcript Editor export → cut MP4 in R2).
  RENDER: DurableObjectNamespace<RenderContainer>;
}
