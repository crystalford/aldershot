import type { RenderContainer } from "./render";

/** Shared Cloudflare bindings for the Aldershot Worker. */
export interface Env {
  AI: Ai;
  MEDIA: R2Bucket;
  DB: D1Database;
  ASSETS?: Fetcher;
  // Optional server-side ffmpeg render container — not bound in the default
  // (Docker-free) deploy; rendering runs in the browser. Re-enable in
  // wrangler.jsonc to bring back big-file server render.
  RENDER?: DurableObjectNamespace<RenderContainer>;
}
