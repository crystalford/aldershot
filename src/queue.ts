/**
 * The job pipeline (04-API-AND-JOBS.md §Job pipeline).
 *
 * Every long operation used to run inside `c.executionCtx.waitUntil`. That is
 * the right SHAPE — the response goes back immediately and the client polls
 * `/api/jobs` — but the wrong LIFETIME: waitUntil is still bounded by the
 * request's limits, so a long enough read is killed halfway with the job row
 * left saying "running" forever. A six-hour source is exactly that case.
 *
 * So work is described as a message rather than captured in a closure, and
 * `dispatch` decides where it runs:
 *
 *   - `env.JOBS` bound  → the queue, with its own lifetime and its own retries
 *   - otherwise         → waitUntil, exactly as before
 *
 * The fallback is not a lesser mode to be embarrassed about; it is what makes
 * the product work before the queue is provisioned, and it keeps local
 * development free of a queue emulator. Same code path either way, because
 * `runJob` is the only thing that ever performs the work.
 *
 * A message carries IDS, never objects. The consumer re-reads every row it
 * needs, so a message that sits in the queue for a minute cannot act on a
 * stale copy of a project the user has since edited.
 */

import type { Env } from "./env.ts";
import type { Plan } from "./plans.ts";
import { failJob, getJobs } from "./jobs.ts";
import { getSource } from "./sources.ts";
import { readSource } from "./ingest.ts";
import { runShorts } from "./shorts-job.ts";
import { runRender } from "./render-job.ts";
import { runScore } from "./begin.ts";
import { runReactions, runOutline } from "./pass-jobs.ts";

export type JobMessage =
  | {
      type: "transcribe";
      jobId: string;
      userId: string;
      sourceId: string;
      plan: Plan;
      diarize?: boolean;
      knownDurationS?: number;
    }
  | {
      type: "score";
      jobId: string;
      userId: string;
      sourceId: string;
      /*
       * Null for a clips-only request. Asking for clips creates no project —
       * "they land in your footage, tagged" — so the score still runs and
       * simply has nothing to attach beats to.
       */
      projectId: string | null;
      brief: string;
      upgrade?: boolean;
    }
  | {
      type: "shorts";
      jobId: string;
      userId: string;
      sourceId: string;
      length: string;
      count: number;
      query?: string;
    }
  | { type: "render"; jobId: string; userId: string; projectId: string; renderId: string }
  | { type: "reactions"; jobId: string; userId: string; projectId: string; about: string }
  | { type: "outline"; jobId: string; userId: string; projectId: string; topic: string };

/**
 * Performs one job. The single place any long operation actually runs, whether
 * it arrived through the queue or through waitUntil.
 */
export async function runJob(env: Env, msg: JobMessage): Promise<void> {
  switch (msg.type) {
    case "transcribe": {
      const src = await getSource(env.DB, msg.sourceId, msg.userId);
      if (!src) return void (await failJob(env.DB, msg.jobId, "That video is no longer here."));
      await readSource(env, src, {
        plan: msg.plan,
        diarize: msg.diarize,
        knownDurationS: msg.knownDurationS,
        jobId: msg.jobId,
      });
      return;
    }
    case "score":
      return await runScore(env, {
        userId: msg.userId,
        sourceId: msg.sourceId,
        projectId: msg.projectId,
        brief: msg.brief,
        jobId: msg.jobId,
        upgrade: msg.upgrade,
      });
    case "shorts":
      return await runShorts(env, {
        userId: msg.userId,
        sourceId: msg.sourceId,
        jobId: msg.jobId,
        length: msg.length as never,
        count: msg.count,
        query: msg.query,
      });
    case "render":
      return await runRender(env, {
        userId: msg.userId,
        projectId: msg.projectId,
        renderId: msg.renderId,
        jobId: msg.jobId,
      });
    case "reactions":
      return await runReactions(env, msg);
    case "outline":
      return await runOutline(env, msg);
  }
}

/**
 * Sends a job to wherever it runs.
 *
 * `ctx` is the request's execution context, needed only for the fallback. It
 * is a parameter rather than read off a global so the queue consumer — which
 * has no request — can call `runJob` directly without pretending to have one.
 */
export async function dispatch(
  env: Env,
  ctx: { waitUntil(p: Promise<unknown>): void },
  msg: JobMessage,
): Promise<void> {
  if (env.JOBS) {
    await env.JOBS.send(msg);
    return;
  }
  ctx.waitUntil(runJob(env, msg));
}

/**
 * The queue consumer.
 *
 * Each message is acked or retried on its own: one poisonous job must not take
 * the batch down with it. A message that has exhausted its retries marks the
 * job failed rather than leaving a row saying "running" forever — a job that
 * silently stops is the worst outcome for a surface built around watching
 * progress.
 */
export async function consume(batch: MessageBatch<JobMessage>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    try {
      await runJob(env, message.body);
      message.ack();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);

      // `attempts` counts this delivery, so on the last allowed one there is
      // no retry left to wait for and the job has to be closed out honestly.
      if (message.attempts >= 3) {
        const [job] = await getJobs(env.DB, [message.body.jobId]);
        if (job && job.state !== "ready" && job.state !== "failed") {
          await failJob(env.DB, message.body.jobId, `That didn't finish: ${reason}`);
        }
        message.ack();
      } else {
        message.retry();
      }
    }
  }
}
