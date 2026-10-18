/**
 * Plans, stored and read back.
 *
 * A plan outlives the one stop — that is why it is a row rather than a
 * variable. Somebody closes the tab on the beats and comes back to the beats,
 * rather than to the beginning or to a cut nobody approved.
 */

import { ulid } from "./id.ts";
import { ROLES, type Beat, type Role } from "./plan.ts";

/** Where the flow got to. The stop is between `beats` and `found`. */
export type PlanState = "beats" | "found" | "cut";

export interface StoredBeat extends Beat {
  id: string;
  idx: number;
  kept: boolean;
  /** Clip ids retrieval found for it. Empty until after the stop. */
  found: string[];
  /** How many of them back it. Null when nobody checked — see src/plan.ts. */
  backed: number | null;
}

export interface Plan {
  id: string;
  topic: string;
  claim: string;
  state: PlanState;
  projectId: string | null;
  beats: StoredBeat[];
}

interface PlanRow {
  id: string;
  topic: string;
  claim: string | null;
  state: string;
  project_id: string | null;
}

interface BeatRow {
  id: string;
  idx: number;
  role: string;
  name: string;
  need: string;
  kept: number;
  found: string | null;
  backed: number | null;
}

export async function createPlan(
  db: D1Database,
  opts: { userId: string; topic: string; claim: string; beats: Beat[] },
): Promise<string> {
  const id = ulid();
  await db
    .prepare(`INSERT INTO plans (id,user_id,topic,claim,state,created_at) VALUES (?,?,?,?,'beats',?)`)
    .bind(id, opts.userId, opts.topic, opts.claim, Date.now())
    .run();

  if (opts.beats.length) {
    const stmt = db.prepare(
      `INSERT INTO plan_beats (id,plan_id,idx,role,name,need,kept,found) VALUES (?,?,?,?,?,?,1,NULL)`,
    );
    await db.batch(opts.beats.map((b, i) => stmt.bind(ulid(), id, i, b.role, b.name, b.need)));
  }
  return id;
}

/** Null when it is not this user's, which is the same answer as not existing. */
export async function getPlan(db: D1Database, planId: string, userId: string): Promise<Plan | null> {
  const row = await db
    .prepare(`SELECT id, topic, claim, state, project_id FROM plans WHERE id=? AND user_id=?`)
    .bind(planId, userId)
    .first<PlanRow>();
  if (!row) return null;

  const { results } = await db
    .prepare(`SELECT id, idx, role, name, need, kept, found, backed FROM plan_beats WHERE plan_id=? ORDER BY idx`)
    .bind(planId)
    .all<BeatRow>();

  return {
    id: row.id,
    topic: row.topic,
    claim: row.claim ?? "",
    state: row.state === "found" || row.state === "cut" ? row.state : "beats",
    projectId: row.project_id,
    beats: (results ?? []).map((b) => ({
      id: b.id,
      idx: b.idx,
      /* An unrecognised role reads as the case being made rather than as a
         label nobody wrote — the same defaulting parsePlan does, because a
         row can be older than the list of roles. */
      role: ((ROLES as readonly string[]).includes(b.role) ? b.role : "subject") as Role,
      name: b.name,
      need: b.need,
      kept: !!b.kept,
      found: parseIds(b.found),
      /* Null stays null: nobody checked is not nobody backed it. */
      backed: b.backed === null || b.backed === undefined ? null : Number(b.backed),
    })),
  };
}

function parseIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const ids = JSON.parse(raw) as unknown;
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
  } catch {
    /* A row that cannot be read has found nothing, which is the state it was
       in before anything looked. Better than throwing on the page that shows
       the plan. */
    return [];
  }
}

/** Keep or cut one beat. The answer to the one stop, beat by beat. */
export async function setBeatKept(db: D1Database, planId: string, beatId: string, kept: boolean): Promise<void> {
  await db
    .prepare(`UPDATE plan_beats SET kept=? WHERE id=? AND plan_id=?`)
    .bind(kept ? 1 : 0, beatId, planId)
    .run();
}

/** What retrieval found for a beat, and the plan moving past the stop. */
export async function setFound(
  db: D1Database,
  planId: string,
  found: Map<string, { ids: string[]; backed: number | null }>,
): Promise<void> {
  if (found.size) {
    const stmt = db.prepare(`UPDATE plan_beats SET found=?, backed=? WHERE id=? AND plan_id=?`);
    await db.batch(
      [...found].map(([beatId, f]) => stmt.bind(JSON.stringify(f.ids), f.backed, beatId, planId)),
    );
  }
  await db.prepare(`UPDATE plans SET state='found' WHERE id=?`).bind(planId).run();
}

/** The plan has become a cut. */
export async function setPlanProject(db: D1Database, planId: string, projectId: string): Promise<void> {
  await db.prepare(`UPDATE plans SET state='cut', project_id=? WHERE id=?`).bind(projectId, planId).run();
}
