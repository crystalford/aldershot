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
  /** Set once this account has reached Stripe checkout. Null for most. */
  stripe_customer_id?: string | null;
}

/**
 * The one account that sees the cost panel.
 *
 * Matched on the address rather than a flag passed in at signup, so the first
 * person to type it is the owner and nobody else can claim it by registering
 * a lookalike.
 */
const OWNER_EMAIL = "chrisrobtelford@gmail.com";

/**
 * A first name from an address — only when the address actually contains one.
 *
 * "chrisrobtelford@gmail.com" has no separator, so splitting on [._-] returned
 * the whole local part and the greeting read "Good morning, Chrisrobtelford."
 * Returning null instead lets the caller greet without a name, which is better
 * than greeting with a wrong one.
 *
 * A separated address ("chris.telford@") still yields "Chris", and anything a
 * provider tells us outright beats guessing entirely.
 */
function nameFromEmail(email: string): string | null {
  const local = (email.split("@")[0] ?? "").replace(/\d+$/, "");
  const first = local.split(/[._+-]+/)[0] ?? "";

  // A plausible given name: letters only, and not a run-on of a full name.
  if (!/^[a-z]+$/i.test(first) || first.length > 12) return null;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

/**
 * Clears a stored name today's rule would not have derived.
 *
 * nameFromEmail refuses a run-on longer than twelve letters precisely so
 * nobody is greeted by a mangled surname-mashup — but it only ever runs when
 * an account is CREATED, so a row made before the rule keeps its bad name for
 * ever. The owner's own Home read "Good morning, Chrisrobtelford." while the
 * function that produced it had already been fixed to refuse exactly that.
 *
 * Nulling rather than re-deriving: this product never asks for a name, and no
 * name is better than a wrong one. A name a PROVIDER gave us is left alone —
 * Google telling us who someone is beats any guess.
 */
/**
 * Bring a stored account into line with today's rules.
 *
 * A CLASS OF BUG, not one bug. Twice in a day: nameFromEmail refuses anything
 * over twelve characters, but only at INSERT, so a row written before that
 * guard kept "Chrisrobtelford" for ever and greeted its owner by it. is_owner
 * was likewise set at INSERT and nowhere else, so every cap in the product
 * applied to the account the product is built on, and a 2,674-minute upload
 * was refused on it.
 *
 * Both had the same shape — the rule is right, the row predates it — and both
 * were patched in a different place. So they live together now, under a name
 * that says what this is, because there will be a third.
 *
 * Called on the way past on Home, which is the one page everybody lands on.
 * Each repair is its own guard clause: cheap when there is nothing to do, and
 * a write only when the row actually disagrees.
 */
export async function reconcileUser(db: D1Database, user: User): Promise<User> {
  let out = user;

  /*
   * The owner is metered and never blocked. A row written before that rule —
   * or before this address was the owner's — leaves is_owner at 0, and then
   * every cap applies however the checks are written.
   */
  if (out.email === OWNER_EMAIL && (!out.is_owner || out.plan !== "studio")) {
    await db.prepare(`UPDATE v2_users SET is_owner=1, plan='studio' WHERE id=?`).bind(out.id).run();
    out = { ...out, is_owner: 1, plan: "studio" };
  }

  /*
   * A stored name today's rule would not produce. Only a name that looks
   * DERIVED from the address is up for review; anything with a space in it
   * came from somewhere that actually knows.
   *
   * Nulling is right: the product never asks for a name, and greeting someone
   * by a mangled surname-mashup is worse than dropping the vocative.
   */
  if (out.name && !out.name.includes(" ") && out.name !== nameFromEmail(out.email)) {
    await db.prepare(`UPDATE v2_users SET name=NULL WHERE id=?`).bind(out.id).run();
    out = { ...out, name: null };
  }

  return out;
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
export async function userForEmail(
  db: D1Database,
  emailRaw: string,
  /* A name the identity provider gave us. Always better than deriving one. */
  providedName?: string | null,
): Promise<User> {
  const email = emailRaw.trim().toLowerCase();
  const existing = await db.prepare(`SELECT * FROM v2_users WHERE email=?`).bind(email).first<User>();
  if (existing) {
    // Fill a name in later if we learn one — signing in with Google after an
    // email signup should stop the greeting being nameless. A provider's name
    // is better than anything derived, so this runs before the reconcile that
    // would otherwise review a derived one.
    if (!existing.name && providedName) {
      await db.prepare(`UPDATE v2_users SET name=? WHERE id=?`).bind(providedName, existing.id).run();
      return { ...existing, name: providedName };
    }
    /* Signing in is the other moment worth reconciling on, so a stale row is
       corrected before anything reads it — not only once Home is opened. */
    return await reconcileUser(db, existing);
  }

  const isOwner = email === OWNER_EMAIL;
  const user: User = {
    id: ulid(),
    email,
    name: providedName || nameFromEmail(email),
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
