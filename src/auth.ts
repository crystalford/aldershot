/**
 * Email-link auth (06-BUILD-PLAN.md Phase 9).
 *
 * There are no passwords. You type an email, we send a one-time link, and
 * following it mints a session. That is the whole system, and it is chosen
 * because it removes every password-shaped failure the product would
 * otherwise have to handle — resets, reuse, leaks, a hashing choice to get
 * wrong.
 *
 * Two secrets are stored and neither is the thing sent to the user:
 *
 *  - The login token is 32 random bytes. Only its SHA-256 is written to D1, so
 *    a dump of the table cannot be replayed into anyone's account.
 *  - The session cookie is `<userId>.<expiry>.<HMAC>`, signed with SESSION_SECRET.
 *    Nothing is stored server-side for it, so signing out everywhere means
 *    rotating the secret — an accepted trade for a single-user-first product
 *    (05-INFRA-AND-COSTS.md).
 *
 * Every comparison of a secret is constant-time. A timing-variable compare on
 * an HMAC is the standard way this kind of thing is broken.
 */

const SESSION_COOKIE = "as_session";
const SESSION_DAYS = 30;
const TOKEN_MINUTES = 20;

export interface AuthEnv {
  DB: D1Database;
  SESSION_SECRET?: string;
  RESEND_API_KEY?: string;
  APP_ORIGIN?: string;
  /**
   * Development only. When set, an unauthenticated request is treated as this
   * email instead of being bounced to the landing page.
   *
   * It is a var rather than a code branch on purpose: there is no "am I in
   * production" guess to get wrong, and its presence is greppable in the
   * deployed config. It must never be set in production.
   */
  DEV_LOGIN_EMAIL?: string;
}

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const byte of b) s += String.fromCharCode(byte);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Constant-time string compare. Length is allowed to leak; content is not. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function sha256(input: string): Promise<string> {
  return b64url(await crypto.subtle.digest("SHA-256", enc.encode(input)));
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

/**
 * The signing secret.
 *
 * Missing in production is a hard failure, not a default: a fallback constant
 * would mean every deployment shares a key anyone can read in this file, and
 * session forgery becomes trivial. In development the DEV_LOGIN_EMAIL path
 * does not need a session at all, so a placeholder there is harmless.
 */
function secretOf(env: AuthEnv): string {
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  if (env.DEV_LOGIN_EMAIL) return "dev-only-not-a-secret";
  throw new Error("SESSION_SECRET is not set");
}

/* ── Sessions ─────────────────────────────────────────────────────────── */

export async function mintSession(env: AuthEnv, userId: string): Promise<string> {
  const expires = Date.now() + SESSION_DAYS * 86_400_000;
  const body = `${userId}.${expires}`;
  return `${body}.${await hmac(secretOf(env), body)}`;
}

/** Returns the user id a cookie proves, or null. Never throws on bad input. */
export async function readSession(env: AuthEnv, cookie: string | undefined): Promise<string | null> {
  if (!cookie) return null;
  const parts = cookie.split(".");
  if (parts.length !== 3) return null;
  const [userId, expiresRaw, sig] = parts;

  const expires = Number(expiresRaw);
  if (!Number.isFinite(expires) || expires < Date.now()) return null;

  let expected: string;
  try {
    expected = await hmac(secretOf(env), `${userId}.${expiresRaw}`);
  } catch {
    return null;
  }
  return safeEqual(sig, expected) ? userId : null;
}

export function sessionCookie(value: string, secure: boolean): string {
  const maxAge = SESSION_DAYS * 86_400;
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export function clearCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

export function cookieFrom(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === SESSION_COOKIE) return rest.join("=");
  }
  return undefined;
}

/* ── One-time login links ─────────────────────────────────────────────── */

export interface LoginLink {
  url: string;
  /** True when a mail provider actually accepted it. */
  sent: boolean;
}

/**
 * Mints a login link for an email address.
 *
 * The address is normalised and the token is single-use: `consumeToken` deletes
 * the row before returning, so following the same link twice fails the second
 * time even if the mail was forwarded.
 */
export async function startLogin(env: AuthEnv, emailRaw: string, origin: string): Promise<LoginLink> {
  const email = emailRaw.trim().toLowerCase();

  const raw = b64url(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB
    .prepare(`INSERT INTO auth_tokens (token_hash,email,expires_at,created_at) VALUES (?,?,?,?)`)
    .bind(await sha256(raw), email, Date.now() + TOKEN_MINUTES * 60_000, Date.now())
    .run();

  const url = `${origin}/auth/callback?token=${encodeURIComponent(raw)}`;
  return { url, sent: await sendLoginEmail(env, email, url) };
}

/**
 * Returns the email a token proves, and destroys it.
 *
 * Expired rows are deleted rather than merely ignored, so an abandoned login
 * cannot sit in the table indefinitely waiting for a leak.
 */
export async function consumeToken(env: AuthEnv, raw: string): Promise<string | null> {
  const hash = await sha256(raw);
  const row = await env.DB
    .prepare(`SELECT email, expires_at FROM auth_tokens WHERE token_hash=?`)
    .bind(hash)
    .first<{ email: string; expires_at: number }>();

  await env.DB.prepare(`DELETE FROM auth_tokens WHERE token_hash=? OR expires_at < ?`).bind(hash, Date.now()).run();

  if (!row) return null;
  return row.expires_at >= Date.now() ? row.email : null;
}

/**
 * Sends the link, if a provider is configured.
 *
 * Returns whether it was actually sent. The caller must not claim "check your
 * email" on a false — with no key configured the link is only written to the
 * log, and telling the user to check an inbox nothing was sent to is the kind
 * of quiet lie this codebase avoids elsewhere.
 */
async function sendLoginEmail(env: AuthEnv, email: string, url: string): Promise<boolean> {
  if (!env.RESEND_API_KEY) {
    console.log(`[auth] no RESEND_API_KEY set — login link for ${email}: ${url}`);
    return false;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: "Aldershot <hello@aldershot.io>",
        to: [email],
        subject: "Your Aldershot link",
        text: `Open Aldershot:\n\n${url}\n\nThe link works once and expires in ${TOKEN_MINUTES} minutes. If you didn't ask for it, ignore this.`,
      }),
    });
    if (!res.ok) {
      console.log(`[auth] resend rejected the send: ${res.status} ${await res.text()}`);
      return false;
    }
    return true;
  } catch (err) {
    console.log(`[auth] could not reach resend: ${(err as Error).message}`);
    return false;
  }
}
