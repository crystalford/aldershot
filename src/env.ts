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

  // R2 API token (secrets) — powers signed direct-to-storage uploads.
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;

  // Signs Better Auth session tokens (see src/auth.ts). Required in production;
  // falls back to a fixed dev value locally so `wrangler dev` works unconfigured.
  BETTER_AUTH_SECRET?: string;
}
