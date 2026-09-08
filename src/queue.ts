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
import { advance, failJob, finishJob, getJobs, startJob } from "./jobs.ts";
import { attachProxy } from "./proxy.ts";
import { meter } from "./usage.ts";
import { getSource } from "./sources.ts";
import { readSource } from "./ingest.ts";
import { runShortRender } from "./short-render.ts";
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
  | { type: "render"; jobId: string; userId: string; projectId: string; renderId: string }
  /* A short is one clip from the library, with no project behind it. */
  | { type: "short-render"; jobId: string; userId: string; clipId: string; renderId: string }
  /*
   * The editing copy, as its own job.
   *
   * Deliberately NOT a step inside the read. A 480p pass over three hours of
   * 4K is minutes of work, and holding the transcript behind it would mean
   * staring at "reading it" long after the words were ready. The transcript
   * lands, the editor opens and plays the original, and the copy arrives
   * behind it. See src/proxy.ts.
   */
  | { type: "proxy"; jobId: string; userId: string; sourceId: string }
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
      /*
       * A place for the read to hand back follow-on work.
       *
       * Once the transcript exists, ingest starts whatever the user's brief
       * asked for (see sources.brief). We are already inside background work
       * here, so the right thing is to AWAIT that rather than fire it into a
       * waitUntil that this invocation may outlive — collecting the promises
       * keeps the consumer alive until the follow-up is really queued.
       *
       * In production dispatch() hands straight to env.JOBS and these resolve
       * immediately; this only does real waiting in dev, where there is no
       * queue and the work runs inline.
       */
      const after: Array<Promise<unknown>> = [];
      await readSource(env, src, {
        plan: msg.plan,
        diarize: msg.diarize,
        knownDurationS: msg.knownDurationS,
        jobId: msg.jobId,
        ctx: { waitUntil: (p) => void after.push(p) },
      });
      await Promise.allSettled(after);
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
    case "short-render":
      return await runShortRender(env, {
        userId: msg.userId,
        clipId: msg.clipId,
        renderId: msg.renderId,
        jobId: msg.jobId,
      });
    case "render":
      return await runRender(env, {
        userId: msg.userId,
        projectId: msg.projectId,
        renderId: msg.renderId,
        jobId: msg.jobId,
      });
    case "proxy": {
      const src = await getSource(env.DB, msg.sourceId, msg.userId);
      if (!src) return void (await failJob(env.DB, msg.jobId, "That video is no longer here."));
      await startJob(env.DB, msg.jobId, "making an editing copy");
      const out = await attachProxy(env, src, (label) => void advance(env.DB, msg.jobId, 50, label));

      /*
       * METERED whether it worked or not — a failed transcode still burned the
       * container time it burned. Every other job in this product writes a
       * usage row and this one did not, which left the cost panel blind to the
       * newest recurring cost in it.
       */
      await meter(env.DB, {
        user_id: msg.userId,
        job_id: msg.jobId,
        job_type: "proxy",
        cpu_ms: out.cpuMs,
        bytes_stored: out.bytes,
      });

      if (!out.ok) {
        /* A video with no editing copy is still a video you can cut, so this
           is a failure of the copy and not of the video. The sweep retries. */
        return void (await failJob(env.DB, msg.jobId, "Couldn't make an editing copy. It plays from the original."));
      }
      return void (await finishJob(env.DB, msg.jobId));
    }
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
      // Whatever was busy has now been busy for four minutes, so this is a
      // real failure rather than a queue that gave up too early.
      if (message.attempts >= 3) {
        const [job] = await getJobs(env.DB, [message.body.jobId]);
        if (job && job.state !== "ready" && job.state !== "failed") {
          await failJob(env.DB, message.body.jobId, `That didn't finish: ${reason}`);
        }
        message.ack();
      } else {
        /*
         * BACKOFF, or the retry walks into the same wall.
         *
         * These fail almost entirely because something was busy — a container
         * slot, a rate limit — and retrying at once asks the same question a
         * millisecond later. The delay grows with the attempt and carries a
         * little jitter, because twenty videos uploaded together fail together
         * and would otherwise retry together too, in lockstep, for ever.
         */
        const base = [20, 60, 180][Math.min(message.attempts - 1, 2)] ?? 180;
        message.retry({ delaySeconds: base + Math.floor(Math.random() * base * 0.4) });
      }
    }
  }
}
