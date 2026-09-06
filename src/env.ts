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
   * Signs session cookies (src/auth.ts). Required in production — there is no
   * fallback constant on purpose, because a shared default would make session
   * forgery trivial for anyone who can read this repository.
   *
   *   npx wrangler secret put SESSION_SECRET
   */
  SESSION_SECRET?: string;

  /** Sends the one-time login links. Without it, links are logged, not sent. */
  RESEND_API_KEY?: string;

  /**
   * Sign in with Google — the primary path (src/oauth.ts). Needs no domain and
   * no mail provider, so it works before DNS does. Without these two the
   * landing page falls back to the email link alone.
   *
   *   npx wrangler secret put GOOGLE_CLIENT_ID
   *   npx wrangler secret put GOOGLE_CLIENT_SECRET
   */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;

  /*
   * Billing. Absent until there is a Stripe account, and every surface that
   * would offer to charge checks for them first — a subscribe button that
   * 500s is worse than one that is honestly not there yet.
   *
   *   npx wrangler secret put STRIPE_SECRET_KEY
   *   npx wrangler secret put STRIPE_PRICE_ID
   *   npx wrangler secret put STRIPE_WEBHOOK_SECRET
   */
  STRIPE_SECRET_KEY?: string;
  STRIPE_PRICE_ID?: string;
  STRIPE_WEBHOOK_SECRET?: string;

  /**
   * Public origin, e.g. https://aldershot.io. Login links are built from it so
   * they point at the real site rather than whatever host served the request —
   * which matters behind a proxy, and on preview deployments.
   */
  APP_ORIGIN?: string;

  /**
   * DEVELOPMENT ONLY. Treats every unauthenticated request as this email.
   * Never set this in production — it disables authentication entirely.
   */
  DEV_LOGIN_EMAIL?: string;

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
