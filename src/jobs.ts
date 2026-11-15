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
import {
  ITEM_STATUSES,
  completion,
  progress,
  type Completion,
  type ItemStatus,
  type Progress,
} from "./items.ts";
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
  transcribe: "transcribing it",
  embed: "filing what it found",
  score: "working out what matters",
  render: "putting it together",
  proxy: "making an editing copy",
  shorts: "burning captions",
  tts: "speaking it",
  scout: "looking outside",
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
    .prepare(
      /*
       * A JOB THAT HAS FINISHED STAYS FINISHED.
       *
       * `state='running'` was unconditional, which made Stop a race it could
       * lose: the user stops a render, the row says failed, and the encode's
       * next progress write — already in flight — sets it back to running. The
       * poll that was about to notice then sees a live job and carries on
       * encoding a video nobody wants.
       *
       * The same guard matters for the reaper: a job declared dead must not be
       * quietly resurrected by whatever was still running when it was reaped.
       */
      `UPDATE jobs SET pct=?, stage_label=COALESCE(?,stage_label), state='running'
        WHERE id=? AND state NOT IN ('failed','ready')`,
    )
    .bind(clamped, label ?? null, id)
    .run();
}

/**
 * Job types that MUST register items, so forgetting to is caught.
 *
 * INVARIANT 7 IS THE ONE THIS PRODUCT CALLS A P1: "a job is complete only
 * when every item is terminal and none failed silently". src/items.ts has
 * held the whole state machine — the statuses, the legal moves,
 * completion(), the reconciler — since Scout was built, and finishJob
 * consulted none of it. It wrote state='ready', pct=100 whatever had
 * happened, for every job type in the product. Scout held itself to the rule
 * by calling completion() directly and never going through here at all.
 *
 * THE DEFAULT IS OPT-IN, AND THE FIRST VERSION HAD IT BACKWARDS. It listed
 * the types believed not to track items and enforced the invariant on
 * everything else — which would have failed every render, judge, take, pass,
 * shorts and probe job in the product, because the list was written from
 * memory and those six were not on it. A rule whose blast radius depends on
 * somebody having remembered every job type is a rule that breaks production
 * to protect it.
 *
 * So there are two ways in, and neither needs a complete list:
 *
 *   A job that HAS items is held to the invariant, whatever its type. That
 *   is the guarantee, and it switches itself on the moment a handler starts
 *   writing items.
 *
 *   A type on this list must have items, so a handler that was wired up and
 *   then stopped writing them fails instead of passing. The list grows as
 *   each job type is wired, which is the honest direction for a list to
 *   grow in.
 */
export const ITEM_TRACKED_JOB_TYPES: readonly string[] = [];

/** What a job's items say about it. */
async function itemsOf(db: D1Database, jobId: string): Promise<Array<{ id: string; status: ItemStatus }>> {
  const { results } = await db
    .prepare(`SELECT id, status FROM job_items WHERE job_id=?`)
    .bind(jobId)
    .all<{ id: string; status: string }>();
  return (results ?? []).map((r) => ({ id: r.id, status: r.status as ItemStatus }));
}

const noCounts = (): Completion["counts"] =>
  Object.fromEntries(ITEM_STATUSES.map((st) => [st, 0])) as Completion["counts"];

/**
 * Marks a job finished — IF its items agree that it is.
 *
 * A job that registered items and has not finished them does not become
 * `ready` here. It becomes `failed`, carrying completion()'s own sentence,
 * because the alternative is the silent partial result invariant 7 names: a
 * green tick over nine of ten transcripts, which the person only discovers
 * when they go looking for the tenth.
 *
 * `degradedAccepted` is the spec's other half and not a loophole. A partial
 * result somebody chose is a finished job; a partial result nobody mentioned
 * is the thing being prevented. So the caller passes it on purpose, and it is
 * never a default.
 */
export async function finishJob(
  db: D1Database,
  id: string,
  opts: {
    degradedAccepted?: boolean;
    /**
     * Which types must have items, overriding the default list.
     *
     * A handler that registers items knows that it does, and saying so at
     * the call site is stronger than a central list somebody has to keep in
     * step: the declaration sits next to the code that would break it.
     */
    trackedTypes?: readonly string[];
  } = {},
): Promise<Completion> {
  const items = await itemsOf(db, id);

  const ready = async (why: string): Promise<Completion> => {
    await db
      .prepare(`UPDATE jobs SET state='ready', pct=100, finished_at=? WHERE id=?`)
      .bind(Date.now(), id)
      .run();
    return { complete: true, allTerminal: true, counts: noCounts(), outstanding: [], why };
  };

  if (!items.length) {
    const row = await db.prepare(`SELECT type FROM jobs WHERE id=?`).bind(id).first<{ type: string }>();
    const type = row?.type ?? "";
    /* A type that is supposed to track items and wrote none is a handler
       that broke, not a job that finished. completion() calls this out too;
       this is where its refusal reaches the row. */
    const tracked = opts.trackedTypes ?? ITEM_TRACKED_JOB_TYPES;
    if (!tracked.includes(type)) {
      return ready(`${type || "this job"} does not track items yet`);
    }
  }

  const done = completion(items, opts);
  if (done.complete) {
    await db
      .prepare(`UPDATE jobs SET state='ready', pct=100, finished_at=? WHERE id=?`)
      .bind(Date.now(), id)
      .run();
    return done;
  }

  /* Loudly, and with the reason the person can act on. */
  await db
    .prepare(`UPDATE jobs SET state='failed', error=?, finished_at=? WHERE id=?`)
    .bind(done.why, Date.now(), id)
    .run();
  return done;
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

/**
 * How long this kind of work has actually taken, for this account.
 *
 * "export right now just says putting it together and like.. no % or
 * anything." A render is ONE call into the encoder — nothing reports from
 * inside it — so there is no percentage to show, and this codebase does not
 * put elapsed time in a progress bar and call it progress.
 *
 * But there is something real to say. Every finished render recorded when it
 * started, when it stopped, and how many seconds of video it produced. That
 * is a measured rate, in seconds of work per second of output, and it is the
 * honest basis for "about a minute left" — the same footage on the same
 * account really does take about as long as it did last time.
 *
 * The MEDIAN, not the mean: one render that hit a cold container and took
 * four minutes should not move the estimate for the next twenty.
 *
 * Returns null with fewer than three finished runs to learn from. An estimate
 * from one sample is a guess wearing a number.
 */
export async function secondsPerOutputSecond(
  db: D1Database,
  userId: string,
  type: string,
): Promise<number | null> {
  const { results } = await db
    .prepare(
      `SELECT j.started_at, j.finished_at, r.duration_s
         FROM jobs j JOIN renders r ON r.id = j.ref_id
        WHERE j.user_id=? AND j.type=? AND j.state='ready'
          AND j.started_at IS NOT NULL AND j.finished_at IS NOT NULL
          AND r.duration_s > 0
        ORDER BY j.finished_at DESC LIMIT 20`,
    )
    .bind(userId, type)
    .all<{ started_at: number; finished_at: number; duration_s: number }>();

  const rates = (results ?? [])
    .map((r) => (r.finished_at - r.started_at) / 1000 / r.duration_s)
    .filter((n) => Number.isFinite(n) && n > 0 && n < 120)
    .sort((a, b) => a - b);

  if (rates.length < 3) return null;
  return rates[Math.floor(rates.length / 2)];
}

export async function failJob(db: D1Database, id: string, error: string): Promise<void> {
  await db
    .prepare(`UPDATE jobs SET state='failed', error=?, finished_at=? WHERE id=?`)
    .bind(error, Date.now(), id)
    .run();
}

/**
 * HOW MANY TIMES THIS HAS BEEN TRIED, AND FAILED.
 *
 * The attempt history is already in this table — one row per try, with its
 * state and when it finished — so a caller that wants to stop retrying
 * something hopeless needs no new column to count with.
 *
 * Written for proxyFirst, which had no ceiling at all: a guard that checked
 * only `queued` and `running` made a fresh job on every page view of a video
 * whose editing copy could not be made. 9,695 of them in the development
 * database, one per view, each one a container start in production.
 */
export async function countJobsFor(
  db: D1Database,
  refId: string,
  userId: string,
  type: JobType,
  state: JobState,
): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM jobs WHERE ref_id=? AND user_id=? AND type=? AND state=?`)
    .bind(refId, userId, type, state)
    .first<{ n: number }>();
  return row?.n ?? 0;
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
/*
 * How long a job may go silent before it is declared dead.
 *
 * Three hours, which was chosen for a transcribe of a feature-length video and
 * is far too patient for everything else: the owner's first export sat at 30%
 * for a long time with nothing to say, because 30% is the moment before the
 * encoder is called and nothing was going to notice for three hours.
 *
 * Per type now, from what the work actually takes. A render is one call to a
 * container that either answers or does not; a transcribe of three hours of
 * audio genuinely runs a while.
 */
const STALE_AFTER_MS = 3 * 60 * 60 * 1000;
const STALE_BY_TYPE: Record<string, number> = {
  render: 30 * 60 * 1000,
  "short-render": 20 * 60 * 1000,
  score: 30 * 60 * 1000,
  pass: 30 * 60 * 1000,
  shorts: 30 * 60 * 1000,
  proxy: 45 * 60 * 1000,
  tts: 10 * 60 * 1000,
};

/**
 * Closes out jobs that stopped without saying so.
 *
 * Called whenever active jobs are read, so the reaping happens on the surface
 * that would otherwise display the lie, and needs no scheduled trigger.
 */
export async function reapStaleJobs(db: D1Database, userId: string): Promise<void> {
  const now = Date.now();

  /* One statement per deadline, so a render is not kept alive by the patience
     a three-hour transcribe needs. */
  const deadlines = new Map<number, string[]>();
  for (const [type, ms] of Object.entries(STALE_BY_TYPE)) {
    if (!deadlines.has(ms)) deadlines.set(ms, []);
    deadlines.get(ms)!.push(type);
  }

  for (const [ms, types] of deadlines) {
    await db
      .prepare(
        `UPDATE jobs
            SET state='failed', finished_at=?,
                error='That stopped partway and didn''t report why. Try it again.'
          WHERE user_id=? AND state IN ('queued','running')
            AND type IN (${types.map(() => "?").join(",")})
            AND COALESCE(started_at, created_at) < ?`,
      )
      .bind(now, userId, ...types, now - ms)
      .run();
  }

  const rest = Object.keys(STALE_BY_TYPE);
  await db
    .prepare(
      `UPDATE jobs
          SET state='failed', finished_at=?,
              error='That stopped partway and didn''t report why. Try it again.'
        WHERE user_id=? AND state IN ('queued','running')
          AND type NOT IN (${rest.map(() => "?").join(",")})
          AND COALESCE(started_at, created_at) < ?`,
    )
    .bind(now, userId, ...rest, now - STALE_AFTER_MS)
    .run();

  /*
   * AND THE THING THE JOB WAS MAKING.
   *
   * The reaper only ever touched `jobs`. The export strip reads renders.state
   * and the video card reads sources.transcript_state, so a job could be dead
   * for hours while the row it belonged to still said "putting it together" —
   * a spinner with nothing behind it and no error anywhere. Whatever the job
   * was for has to learn that it stopped.
   */
  await db
    .prepare(
      `UPDATE renders SET state='failed',
              error=COALESCE(error,'That stopped partway and didn''t report why. Try it again.')
        WHERE user_id=? AND state IN ('queued','running')
          AND id IN (SELECT ref_id FROM jobs WHERE user_id=? AND state='failed' AND ref_id IS NOT NULL)`,
    )
    .bind(userId, userId)
    .run();

  /*
   * AND ON ITS OWN AGE, when there is no job to ask.
   *
   * The statement above needs a job whose ref_id is this render. For most of
   * this product's life no such job existed — a render's job carried the
   * PROJECT id — so it matched nothing, and an export that died stayed on
   * "putting it together" for ever. The owner watched one do it for hours
   * while every reaper in the system ran past it.
   *
   * That join is fixed now, but a row is not allowed to depend on a join to
   * stop lying. A render older than the deadline for a render is finished,
   * whatever the jobs table does or does not say about it — including the
   * rows written before the fix, which have nothing pointing at them at all.
   */
  await db
    .prepare(
      `UPDATE renders SET state='failed',
              error=COALESCE(error,'That stopped partway and didn''t report why. Try it again.')
        WHERE user_id=? AND state IN ('queued','running') AND created_at < ?`,
    )
    .bind(userId, now - STALE_BY_TYPE.render)
    .run();

  await db
    .prepare(
      `UPDATE sources SET transcript_state='failed'
        WHERE user_id=? AND transcript_state IN ('pending','running')
          AND id IN (SELECT ref_id FROM jobs WHERE user_id=? AND type='transcribe'
                       AND state='failed' AND ref_id IS NOT NULL)`,
    )
    .bind(userId, userId)
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

/**
 * A job's progress, from its items rather than from its own `pct`.
 *
 * Phase 8's per-item progress. `jobs.pct` is written by whatever stage is
 * running, which means a stage that reported 90% and then died left a job
 * claiming nine tenths of work that never happened. A count of item rows
 * cannot say that, so where a job HAS items the items are the answer and
 * `pct` is a fallback rather than the record.
 *
 * Null when the job has no items. That is not "no progress" — it is a job
 * this machinery does not track, and the caller should keep showing `pct`
 * rather than a bar at zero. ITEM_TRACKED_JOB_TYPES is opt-in for the same
 * reason.
 */
export async function itemProgress(db: D1Database, jobId: string): Promise<Progress | null> {
  try {
    const { results } = await db
      .prepare(`SELECT id, status FROM job_items WHERE job_id=?`)
      .bind(jobId)
      .all<{ id: string; status: ItemStatus }>();
    const items = results ?? [];
    return items.length ? progress(items) : null;
  } catch {
    /* A read failure is "we do not know", not "nothing is happening" — the
       same rule as the breaker and the spend cap. */
    return null;
  }
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

/**
 * WHY A RE-READ WOULD BE REFUSED, OR NULL TO GO AHEAD.
 *
 * Invariant 5: "footage is read and charged once; editing is free." A read is
 * the expensive operation here — the cost panel prices it per source minute —
 * so the two ways of paying for the same minutes twice are a source that has
 * already been read, and a second request while the first read is in flight.
 *
 * It lives here rather than inline in the route because a guard inside
 * src/index.ts cannot be tested: that file's import graph reaches a .woff2 and
 * node's type stripper refuses it. The proxy guard learned the same lesson the
 * expensive way — its missing `failed` state put 9,695 jobs in one database,
 * and no test could have caught it while the condition was an inline `if`.
 */
export async function reReadRefusedBecause(
  db: D1Database,
  source: { id: string; transcript_state?: string | null },
  userId: string,
): Promise<"already read" | "a read is already running" | null> {
  if (source.transcript_state === "ready") return "already read";
  const inFlight = await latestJobFor(db, source.id, userId, ["transcribe"]);
  if (inFlight && (inFlight.state === "queued" || inFlight.state === "running")) {
    return "a read is already running";
  }
  return null;
}
