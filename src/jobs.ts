/**
 * Jobs — every long operation is one, and the UI can poll it for honest,
 * staged progress with a human label ("reading it for meaning"), never a
 * spinner with no stage (07-CLAUDE-CODE-BRIEF.md §Fidelity rules).
 *
 * The percentages must be real. A bar that moves on a timer while nothing
 * happens is worse than no bar, because it teaches the user not to trust it.
 * Every `advance()` here is called from the code that actually did the work.
 */

import { ulid } from "./id.ts";
import type { JobType } from "./usage.ts";

export type JobState = "queued" | "running" | "ready" | "failed";

export interface Job {
  id: string;
  user_id: string;
  type: JobType;
  ref_id: string | null;
  state: JobState;
  pct: number;
  stage_label: string | null;
  queued_overnight: number;
  error: string | null;
  started_at: number | null;
  finished_at: number | null;
  created_at: number;
}

/**
 * The stage labels, in the words the design uses. These are user-facing copy,
 * not log lines — they appear in the working row on Home and in the intake.
 */
export const STAGES: Record<string, string> = {
  probe: "looking at the file",
  frames: "pulling frames",
  transcribe: "reading it",
  embed: "filing what it found",
  score: "reading it for meaning",
  render: "putting it together",
  shorts: "burning captions",
  tts: "speaking it",
};

export async function createJob(
  db: D1Database,
  opts: { user_id: string; type: JobType; ref_id?: string | null; overnight?: boolean },
): Promise<Job> {
  const job: Job = {
    id: ulid(),
    user_id: opts.user_id,
    type: opts.type,
    ref_id: opts.ref_id ?? null,
    state: "queued",
    pct: 0,
    stage_label: STAGES[opts.type] ?? null,
    queued_overnight: opts.overnight ? 1 : 0,
    error: null,
    started_at: null,
    finished_at: null,
    created_at: Date.now(),
  };
  await db
    .prepare(
      `INSERT INTO jobs (id,user_id,type,ref_id,state,pct,stage_label,queued_overnight,error,started_at,finished_at,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      job.id, job.user_id, job.type, job.ref_id, job.state, job.pct, job.stage_label,
      job.queued_overnight, job.error, job.started_at, job.finished_at, job.created_at,
    )
    .run();
  return job;
}

/** Marks a job running. Idempotent — re-running a retried job is fine. */
export async function startJob(db: D1Database, id: string, label?: string): Promise<void> {
  await db
    .prepare(`UPDATE jobs SET state='running', started_at=COALESCE(started_at,?), stage_label=COALESCE(?,stage_label) WHERE id=?`)
    .bind(Date.now(), label ?? null, id)
    .run();
}

/**
 * Reports real progress. `pct` must come from measured work — bytes uploaded,
 * chunks transcribed, frames written — never from elapsed time.
 */
export async function advance(db: D1Database, id: string, pct: number, label?: string): Promise<void> {
  const clamped = Math.max(0, Math.min(99, Math.round(pct)));
  await db
    .prepare(`UPDATE jobs SET pct=?, stage_label=COALESCE(?,stage_label), state='running' WHERE id=?`)
    .bind(clamped, label ?? null, id)
    .run();
}

export async function finishJob(db: D1Database, id: string): Promise<void> {
  await db
    .prepare(`UPDATE jobs SET state='ready', pct=100, finished_at=? WHERE id=?`)
    .bind(Date.now(), id)
    .run();
}

/**
 * Fails a job with a plain-language reason. The message is shown to the user,
 * so it must read like a sentence, not an exception.
 */
export async function failJob(db: D1Database, id: string, error: string): Promise<void> {
  await db
    .prepare(`UPDATE jobs SET state='failed', error=?, finished_at=? WHERE id=?`)
    .bind(error, Date.now(), id)
    .run();
}

export async function getJobs(db: D1Database, ids: string[]): Promise<Job[]> {
  if (!ids.length) return [];
  const marks = ids.map(() => "?").join(",");
  const { results } = await db.prepare(`SELECT * FROM jobs WHERE id IN (${marks})`).bind(...ids).all<Job>();
  return results ?? [];
}

/** Everything still in flight for this user — drives Home's working row. */
export async function activeJobs(db: D1Database, userId: string): Promise<Job[]> {
  const { results } = await db
    .prepare(`SELECT * FROM jobs WHERE user_id=? AND state IN ('queued','running') ORDER BY created_at`)
    .bind(userId)
    .all<Job>();
  return results ?? [];
}
