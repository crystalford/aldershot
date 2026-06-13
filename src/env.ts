/** Shared Cloudflare bindings for the Aldershot Worker. */
export interface Env {
  AI: Ai;
  MEDIA: R2Bucket;
  DB: D1Database;
  ASSETS?: Fetcher;
  // RENDER container binding is added when ffmpeg export is wired (see container/).
}
