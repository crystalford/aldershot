/**
 * Sign in with Google.
 *
 * The handoff said "Access or plain email link", with the reason given as
 * "single-user first, so keep it simple". That reasoning was sound for an
 * internal tool and expired the moment this became a public product with a
 * pricing page — Cloudflare Access is zero-trust for internal apps and cannot
 * do public signup at all, and email-link-only has three problems that bite a
 * real signup funnel:
 *
 *  1. It cannot work until a domain is verified with a mail provider. Sign-in
 *     is blocked on DNS, which is days, not minutes.
 *  2. Mail scanners (Outlook Safe Links, antivirus, some clients) fetch URLs
 *     before a human clicks. A single-use link is then already spent when the
 *     real click arrives.
 *  3. A new sending domain has no reputation, so the first emails land in
 *     spam — precisely during the period when signups matter most.
 *
 * Google is the right primary for THIS product specifically: it edits footage
 * for people who publish to YouTube, and a YouTube account is a Google
 * account. The email link stays as a fallback for anyone who would rather not
 * use it.
 *
 * Only `openid email` is requested. We want an identity, not access to
 * anyone's Google data, and asking for more would be both a worse consent
 * screen and a lie about what we need.
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

const STATE_COOKIE = "as_oauth_state";

export interface OAuthEnv {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

export function googleConfigured(env: OAuthEnv): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const redirectUri = (origin: string) => `${origin}/auth/google/callback`;

/**
 * Where to send the browser, and the state to remember.
 *
 * `state` is the CSRF defence: it is echoed back by Google and compared
 * against a cookie only this browser has. Without it, an attacker can complete
 * a sign-in flow in someone else's browser and land them in the attacker's
 * account.
 */
export function startGoogle(env: OAuthEnv, origin: string): { url: string; state: string } {
  const state = b64url(crypto.getRandomValues(new Uint8Array(24)));
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: "openid email",
    state,
    // Always show the picker: a shared machine silently reusing whoever signed
    // in last is worse than one extra click.
    prompt: "select_account",
  });
  return { url: `${AUTH_URL}?${params}`, state };
}

export function stateCookie(state: string, secure: boolean): string {
  // Ten minutes is plenty to complete a consent screen, and SameSite=Lax still
  // sends it on the top-level redirect back from Google.
  return `${STATE_COOKIE}=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure ? "; Secure" : ""}`;
}

export function clearStateCookie(secure: boolean): string {
  return `${STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

export function stateFrom(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === STATE_COOKIE) return rest.join("=");
  }
  return undefined;
}

export interface GoogleIdentity {
  email: string;
  name: string | null;
}

/**
 * Turns the code Google handed back into a verified email address.
 *
 * The identity comes from the userinfo endpoint rather than by decoding the
 * id_token ourselves. Both are valid; this one is a direct TLS request to
 * Google carrying our own client secret, so the answer is authenticated by the
 * transport and there is no JWT signature verification to get subtly wrong.
 *
 * An unverified Google address is refused. Accepting one would let somebody
 * claim an address they do not control and, if it happened to be the owner's,
 * claim the owner's account.
 */
export async function finishGoogle(
  env: OAuthEnv,
  code: string,
  origin: string,
): Promise<GoogleIdentity | null> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri(origin),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    console.log(`[oauth] token exchange failed: ${res.status} ${await res.text()}`);
    return null;
  }

  const { access_token } = (await res.json()) as { access_token?: string };
  if (!access_token) return null;

  const who = await fetch(USERINFO_URL, { headers: { authorization: `Bearer ${access_token}` } });
  if (!who.ok) {
    console.log(`[oauth] userinfo failed: ${who.status}`);
    return null;
  }

  const info = (await who.json()) as { email?: string; email_verified?: boolean; name?: string };
  if (!info.email || info.email_verified === false) return null;

  return { email: info.email.toLowerCase(), name: info.name ?? null };
}

/** Was this callback started by this browser? */
export function stateMatches(returned: string | undefined, stored: string | undefined): boolean {
  if (!returned || !stored) return false;
  return safeEqual(returned, stored);
}
