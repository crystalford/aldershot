import type { AudioContainer, RenderContainer } from "./render.ts";

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
  /**
   * The same image, sized for single-threaded work.
   *
   * Extracting the audio is `-vn` through libmp3lame, which uses one core
   * whatever it is given — see AudioContainer in src/render.ts for why that
   * makes a smaller instance strictly cheaper rather than merely smaller.
   * Optional and falls back to RENDER, so a deploy that has not created it yet
   * still reads video.
   */
  AUDIO?: DurableObjectNamespace<AudioContainer>;
  /**
   * A local encoder, for development only.
   *
   * Cloudflare Containers need a Docker daemon; `node container/render.mjs` is
   * the same server without one. Set this in .dev.vars to run the render for
   * real locally. Never set in wrangler.jsonc — env.RENDER is the binding and
   * takes precedence wherever it exists.
   */
  RENDER_URL?: string;

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
  /*
   * Cloudflare's own email send binding, and the address login links come
   * from. Not a third party: this was Resend, which meant a separate account,
   * separate keys and a separate bill for the one email this product sends.
   *
   *   MAIL_FROM is a var, not a secret — it is an address that appears in
   *   every message. The binding is configured in wrangler.jsonc.
   */
  EMAIL?: { send(message: { to: string; from: string; subject: string; text?: string; html?: string }): Promise<unknown> };
  MAIL_FROM?: string;

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

  /*
   * Cloudflare Stream: considered, priced, and NOT used. There is deliberately
   * no binding here.
   *
   * The design routes preview playback through Stream. Stream bills $5 per
   * 1,000 minutes stored per month REGARDLESS OF FILE SIZE, so a small preview
   * copy costs exactly what a 4K master costs — and this product deletes
   * nothing, so it is rent for ever on every minute anyone ever uploads. A
   * thousand accounts with ten hours each is about $3,000 a month, rising.
   * 05-INFRA-AND-COSTS.md calls it "the single easiest way to make this
   * product unprofitable".
   *
   * The same editing copy as an mp4 in R2 measured 3.5 MB a minute with no
   * egress charge — roughly a seventieth of the price for the same job. See
   * src/proxy.ts.
   *
   * Written down rather than left as two empty slots, because an unfilled
   * credential is a question somebody asks again in six months.
   */
}
