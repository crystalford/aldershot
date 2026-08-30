/**
 * The current user.
 *
 * Every row in this product is scoped by user_id and always has been, so
 * Phase 9 was a change to how the id is resolved rather than a retrofit across
 * the codebase — which is exactly what cost this project time once already.
 *
 * Resolution order:
 *   1. A valid signed session cookie.
 *   2. DEV_LOGIN_EMAIL, when set. Development only, and it must never be set
 *      in production — see src/auth.ts.
 *   3. Nobody. The caller sends them to the landing page.
 */

import { ulid } from "./id.ts";
import type { Plan } from "./plans.ts";
import { type AuthEnv, cookieFrom, readSession } from "./auth.ts";

export interface User {
  id: string;
  email: string;
  name: string | null;
  plan: Plan;
  is_owner: number;
  created_at: number;
}

/**
 * The one account that sees the cost panel.
 *
 * Matched on the address rather than a flag passed in at signup, so the first
 * person to type it is the owner and nobody else can claim it by registering
 * a lookalike.
 */
const OWNER_EMAIL = "chrisrobtelford@gmail.com";

/** A display name from an address, used until the user sets one. */
function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const first = local.split(/[._-]+/)[0] ?? local;
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : "You";
}

export async function getUserById(db: D1Database, id: string): Promise<User | null> {
  return await db.prepare(`SELECT * FROM v2_users WHERE id=?`).bind(id).first<User>();
}

/**
 * Finds or creates the account for an email address.
 *
 * Called on a proven login, so creating on first sight IS the signup — there
 * is no separate register step in an email-link product.
 */
export async function userForEmail(db: D1Database, emailRaw: string): Promise<User> {
  const email = emailRaw.trim().toLowerCase();
  const existing = await db.prepare(`SELECT * FROM v2_users WHERE email=?`).bind(email).first<User>();
  if (existing) return existing;

  const isOwner = email === OWNER_EMAIL;
  const user: User = {
    id: ulid(),
    email,
    name: nameFromEmail(email),
    // The owner is on Studio so caps never block their own testing, and
    // is_owner gates the cost panel (03-DATA-MODEL.md).
    plan: isOwner ? "studio" : "free",
    is_owner: isOwner ? 1 : 0,
    created_at: Date.now(),
  };
  await db
    .prepare(`INSERT INTO v2_users (id,email,name,plan,is_owner,created_at) VALUES (?,?,?,?,?,?)`)
    .bind(user.id, user.email, user.name, user.plan, user.is_owner, user.created_at)
    .run();
  return user;
}

/**
 * The acting user, or null when nobody is signed in.
 *
 * Returning null rather than throwing keeps the decision with the route: a
 * page redirects to the landing site, an API returns 401.
 */
export async function currentUser(env: AuthEnv, cookieHeader?: string): Promise<User | null> {
  const userId = await readSession(env, cookieFrom(cookieHeader));
  if (userId) {
    const user = await getUserById(env.DB, userId);
    if (user) return user;
    // A cookie whose user no longer exists is not an error — it is a stale
    // cookie, and the caller should treat it as signed out.
    return null;
  }

  if (env.DEV_LOGIN_EMAIL) return await userForEmail(env.DB, env.DEV_LOGIN_EMAIL);
  return null;
}
