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
/**
 * Is this worth trying again, or is the video actually broken?
 *
 * A bulk upload of twenty videos failed six of them with "Failed to start
 * container: Maximum number of running container instances exceeded. Try
 * again later." Cloudflare said try again later; the product wrote it down as
 * a permanently failed video with a Retry button for a human to press.
 *
 * readSource catches every error and calls failJob, so nothing ever reaches
 * the queue consumer, the message is acked, and the three retries the queue
 * was configured with never happen. The distinction this function makes is
 * the difference between a busy machine and an unreadable file.
 *
 * Deliberately a SHORT list of things known to be temporary. Anything not
 * recognised fails as before: a wrong guess in this direction retries a job
 * that can never succeed, three times, and then reports the same error later
 * and more confusingly.
 */
export function isTransient(err: unknown): boolean {
  const text = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    /maximum number of running container instances/.test(text) ||
    /container instances exceeded/.test(text) ||
    /failed to start container/.test(text) ||
    /try again later/.test(text) ||
    /\b(429|503|502|504)\b/.test(text) ||
    /too many requests/.test(text) ||
    /rate limit/.test(text) ||
    /temporarily unavailable/.test(text) ||
    /timed out|timeout/.test(text) ||
    /network connection lost|connection reset/.test(text)
  );
}

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
/**
 * How long a job may sit in "running" before we stop believing it.
 *
 * Generous: a six-hour source legitimately takes a long time to read. But a
 * job that will never finish has to stop claiming it might — a drone clip was
 * killed mid-extraction by waitUntil's lifetime and left its row on "running"
 * with no error, so the surface promised progress that was never coming. That
 * is worse than a failure, because a failure has a Retry next to it.
 */
const STALE_AFTER_MS = 3 * 60 * 60 * 1000;

/**
 * Closes out jobs that stopped without saying so.
 *
 * Called whenever active jobs are read, so the reaping happens on the surface
 * that would otherwise display the lie, and needs no scheduled trigger.
 */
export async function reapStaleJobs(db: D1Database, userId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE jobs
          SET state='failed',
              finished_at=?,
              error='That stopped partway and didn''t report why. Try it again.'
        WHERE user_id=? AND state IN ('queued','running')
          AND COALESCE(started_at, created_at) < ?`,
    )
    .bind(Date.now(), userId, Date.now() - STALE_AFTER_MS)
    .run();
}

/**
 * The newest job for one thing, whatever state it is in.
 *
 * activeJobs is `state IN ('queued','running')` — correct for "what is
 * happening now", and wrong for every surface that also has to explain what
 * WENT WRONG. Those looked their job up through activeJobs, which by
 * definition can never return a failed one, so the reason a failure was
 * recorded with was fetched, discarded, and replaced by the word "Failed".
 *
 * The reasons are good ones. A real upload failure here recorded "Couldn't
 * read that video: couldn't give the extractor a way to read the file" and
 * the user was shown "Failed" and a Retry button. That is the difference
 * between knowing what to do next and concluding the product is broken.
 */
export async function latestJobFor(
  db: D1Database,
  refId: string,
  userId: string,
  /*
   * WHICH KIND of job. Not optional in practice, and the reason is a bug this
   * caused: several kinds of work hang off one ref_id — a project has scoring
   * passes AND renders — so matching on ref_id alone handed the editor the
   * newest RENDER job and let it render that as the state of the cut. Press
   * Export, and the whole editor turned into the render's status.
   *
   * A render's state belongs in the exports list, which has its own. The
   * editor wants the pass that produced the blocks.
   */
  types?: JobType[],
): Promise<Job | null> {
  const filter = types?.length ? ` AND type IN (${types.map(() => "?").join(",")})` : "";
  return await db
    .prepare(`SELECT * FROM jobs WHERE ref_id=? AND user_id=?${filter} ORDER BY created_at DESC LIMIT 1`)
    .bind(refId, userId, ...(types ?? []))
    .first<Job>();
}

export async function activeJobs(db: D1Database, userId: string): Promise<Job[]> {
  await reapStaleJobs(db, userId);
  const { results } = await db
    .prepare(`SELECT * FROM jobs WHERE user_id=? AND state IN ('queued','running') ORDER BY created_at`)
    .bind(userId)
    .all<Job>();
  return results ?? [];
}

/**
 * What finished while the user was away, newest first.
 *
 * Home's feed is built from these rather than from a separate events table:
 * every unit of work already writes a job row, so the feed cannot drift out of
 * step with what actually happened. Failures are included — a job that died
 * overnight is exactly the kind of thing the user came back to find out about.
 */
export async function recentlyFinished(
  db: D1Database,
  userId: string,
  sinceMs = 24 * 3600 * 1000,
  limit = 6,
): Promise<Job[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM jobs
        WHERE user_id=? AND state IN ('ready','failed') AND finished_at IS NOT NULL AND finished_at > ?
        ORDER BY finished_at DESC LIMIT ?`,
    )
    .bind(userId, Date.now() - sinceMs, limit)
    .all<Job>();
  return results ?? [];
}
