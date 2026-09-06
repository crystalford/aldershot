/**
 * Rate limiting.
 *
 * There was none, anywhere. The sharpest edge is /auth/start: it takes an
 * address, writes a token and sends an email, and nothing stopped anyone
 * calling it in a loop — someone else's inbox filled with our links, our
 * Resend bill spent on it, and our sending domain's reputation with it. The
 * upload and AI routes are money rather than reputation, but the same shape.
 *
 * Implemented on D1 rather than the rate-limiting binding, for one reason: a
 * binding is per-colo, and the limit that matters here — "how many login
 * emails has this address been sent" — has to hold across all of them. D1 is
 * already on the request path for every route this protects, so the cost is a
 * row, and a fixed window is the right amount of machinery for turning an
 * unbounded loop into a bounded one.
 */

export interface Limit {
  /** How many are allowed in the window. */
  max: number;
  /** Window length in seconds. */
  windowS: number;
}

export const LIMITS = {
  /* Generous for a person, useless for a loop: nobody legitimately asks for
     five login links in five minutes, and if they do they should wait. */
  authStart: { max: 5, windowS: 300 },
  /* An upload opens a multipart and reserves storage. Twenty an hour is a
     heavy real session and a poor way to abuse anything. */
  upload: { max: 20, windowS: 3600 },
  /* Anything that spends money at a model. */
  ai: { max: 40, windowS: 3600 },
} as const;

export interface RateResult {
  ok: boolean;
  retryAfterS: number;
}

/**
 * Counts one hit against a key, and says whether it is allowed.
 *
 * The key is caller-chosen so a limit can be per-address (login) or per-user
 * (uploads). Fixed windows rather than a sliding log: a sliding window is more
 * precise and needs a row per hit, and precision is not what this is for.
 */
export async function rateLimit(
  db: D1Database,
  key: string,
  limit: Limit,
  now = Date.now(),
): Promise<RateResult> {
  const windowMs = limit.windowS * 1000;
  const windowStart = Math.floor(now / windowMs) * windowMs;

  await db
    .prepare(
      `INSERT INTO rate_limits (k, window_start, hits) VALUES (?, ?, 1)
       ON CONFLICT(k, window_start) DO UPDATE SET hits = hits + 1`,
    )
    .bind(key, windowStart)
    .run();

  const row = await db
    .prepare(`SELECT hits FROM rate_limits WHERE k=? AND window_start=?`)
    .bind(key, windowStart)
    .first<{ hits: number }>();

  const hits = row?.hits ?? 1;
  if (hits <= limit.max) return { ok: true, retryAfterS: 0 };

  return { ok: false, retryAfterS: Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000)) };
}

/**
 * Drops windows that have passed.
 *
 * Called from the hourly sweep rather than on the request path: tidying is not
 * urgent, and doing it inline would put a DELETE in front of every login.
 */
export async function reapRateLimits(db: D1Database, now = Date.now()): Promise<void> {
  await db
    .prepare(`DELETE FROM rate_limits WHERE window_start < ?`)
    .bind(now - 24 * 3600 * 1000)
    .run();
}
