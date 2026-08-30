/**
 * The current user.
 *
 * Real auth is Phase 9 (email link, per 06-BUILD-PLAN.md). Until then this is
 * a single-account product — 05-INFRA-AND-COSTS.md says as much: "single-user
 * first, so keep it simple".
 *
 * It is deliberately a real row in a real table rather than a hardcoded
 * constant, so that every query is already scoped by user_id and Phase 9 is a
 * change to how the id is resolved, not a retrofit across the codebase. That
 * retrofit is exactly what cost this project time once already.
 */

import { ulid } from "./id.ts";
import type { Plan } from "./plans.ts";

export interface User {
  id: string;
  email: string;
  name: string | null;
  plan: Plan;
  is_owner: number;
  created_at: number;
}

const OWNER_EMAIL = "owner@aldershot.io";

/** Resolves the acting user, creating the owner row on first run. */
export async function currentUser(db: D1Database): Promise<User> {
  const existing = await db.prepare(`SELECT * FROM v2_users WHERE email=?`).bind(OWNER_EMAIL).first<User>();
  if (existing) return existing;

  const user: User = {
    id: ulid(),
    email: OWNER_EMAIL,
    name: "Chris",
    // The owner is on Studio so caps never block their own testing, and
    // is_owner gates the cost panel (03-DATA-MODEL.md).
    plan: "studio",
    is_owner: 1,
    created_at: Date.now(),
  };
  await db
    .prepare(`INSERT INTO v2_users (id,email,name,plan,is_owner,created_at) VALUES (?,?,?,?,?,?)`)
    .bind(user.id, user.email, user.name, user.plan, user.is_owner, user.created_at)
    .run();
  return user;
}
