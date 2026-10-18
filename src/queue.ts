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
import { alignSource } from "./align-source.ts";
import { runJudge } from "./judge-run.ts";
import { runTake } from "./take-run.ts";
import { attachProxy } from "./proxy.ts";
import { meter } from "./usage.ts";
import { getSource } from "./sources.ts";
import { readSource } from "./ingest.ts";
import { runShortRender } from "./short-render.ts";
import { runRender } from "./render-job.ts";
import { runScore } from "./begin.ts";
import { runReactions, runOutline } from "./pass-jobs.ts";
import { hasMoreToDo, runScoutPhase } from "./scout-job.ts";

/**
 * HOW MANY DELIVERIES A MESSAGE GETS, and it must equal `max_retries` on the
 * consumer in wrangler.jsonc. test/queue-retries.test.ts reads both and fails
 * if they drift, because drift in either direction is silent and bad.
 *
 * Set too HIGH here and the platform exhausts the message's retries before
 * this code ever reaches its last attempt — so the message leaves the queue
 * without this code having closed the job out, and the row sits on "running"
 * until reapStaleJobs gets to it twenty minutes to three hours later. That is
 * the silent partial failure the handoff's invariant 7 is about, and it
 * arrives by editing one number.
 *
 * There is a dead-letter queue now, which catches that and every other way a
 * message can leave without being handled, so the hole is covered twice. The
 * numbers must still agree: the DLQ is a backstop that reports a failure, and
 * agreeing numbers are what let the normal path report it with a reason.
 *
 * Set too LOW and jobs are declared failed with retries still unspent, which
 * is the cheap direction to be wrong in but still wrong: these fail mostly
 * because something was busy, and the retry is the fix.
 */
export const MAX_DELIVERIES = 3;

/** The queue a message lands on when the platform has given up on it. */
export const DEAD_LETTER_QUEUE = "aldershot-jobs-dlq";

/** Whether this delivery is the last one, so the job must be closed out. */
export const isLastDelivery = (attempts: number): boolean => attempts >= MAX_DELIVERIES;

/**
 * How long to wait before the next delivery.
 *
 * These fail almost entirely because something was busy — a container slot, a
 * rate limit — and retrying at once asks the same question a millisecond
 * later. The delay grows with the attempt and carries a little jitter, because
 * twenty videos uploaded together fail together and would otherwise retry
 * together too, in lockstep, for ever.
 *
 * Pure and exported so the schedule can be asserted rather than described: a
 * backoff that silently collapses to zero looks exactly like one that works
 * until the day everything retries at once.
 */
export function backoffSeconds(attempts: number, rand: () => number = Math.random): number {
  const base = [20, 60, 180][Math.min(attempts - 1, 2)] ?? 180;
  return base + Math.floor(rand() * base * 0.4);
}

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
  /*
   * LINING UP THE WORDS, once per source.
   *
   * It runs on attach rather than on cut (see src/align-source.ts for why it
   * is not where doc 17 puts it), which means it is started by a link press
   * and must be cheap to ask for twice. `needsAlignment` is the guard and it
   * is checked again HERE, because the question is answered at dispatch time
   * and answered by rows that a second attach may have changed since.
   */
  | { type: "align"; jobId: string; userId: string; sourceId: string }
  /*
   * THE JUDGE, over the whole eval set at once.
   *
   * A job rather than a request because it is one model call per claim and
   * the set is meant to reach two hundred judgements — minutes of calls,
   * which is a thing to watch finish rather than a page to hold open.
   */
  | { type: "judge"; jobId: string; userId: string }
  /*
   * ALIGNING A RECORDED TAKE to the line it was meant to be. A job because
   * it is a container call; the recording is already stored and already
   * usable, so this only ever improves what is known about it.
   */
  | { type: "take"; jobId: string; userId: string; beatId: string }
  | { type: "reactions"; jobId: string; userId: string; projectId: string; about: string }
  | { type: "outline"; jobId: string; userId: string; projectId: string; topic: string }
  /*
   * ONE PHASE OF A SCOUT RUN, and the message carries the run's id rather
   * than its state. A run is minutes of frontier calls, adapter fetches and
   * transcript scans; done in one invocation it would hit a worker's lifetime
   * and die halfway with the row on "running" and no error. One phase is
   * seconds, and a phase that dies is one message redelivered.
   */
  | {
      type: "scout";
      jobId: string;
      userId: string;
      runId: string;
      projectId: string;
      subject: string;
      brief: string;
      queriesPending?: unknown[];
      snowballed?: boolean;
    };

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
    case "scout": {
      /*
       * Re-dispatches ITSELF rather than looping. Each delivery does one
       * phase; the planner reads rows to decide the next, so a run that dies
       * resumes by asking the same question again.
       */
      const next = await runScoutPhase(env, {
        runId: msg.runId,
        projectId: msg.projectId,
        userId: msg.userId,
        subject: msg.subject,
        brief: msg.brief,
        queriesPending: (msg.queriesPending ?? []) as never,
        snowballed: msg.snowballed,
      });
      if (hasMoreToDo(next)) {
        await dispatch(env, { waitUntil: () => {} }, {
          ...msg,
          queriesPending: next.queriesPending as unknown[],
          snowballed: next.snowballed,
        });
        return;
      }
      /* Nothing more to do: the run's own row already says why. */
      return void (await finishJob(env.DB, msg.jobId));
    }
    case "align": {
      const src = await getSource(env.DB, msg.sourceId, msg.userId);
      if (!src) return void (await failJob(env.DB, msg.jobId, "That video is no longer here."));
      await startJob(env.DB, msg.jobId, "lining up the words");
      const out = await alignSource(env, msg.sourceId, (label, pct) =>
        void advance(env.DB, msg.jobId, pct, label),
      );
      /*
       * A RUN THAT PLACED NOTHING IS A FAILURE, and says so.
       *
       * alignSource already refuses to write `forced` in that case, so the
       * timings are still honest either way. This is the other half: a job
       * that finished green over a source that is no better than it was is
       * exactly the silent partial failure invariant 7 calls a P1.
       */
      if (!out.aligned) {
        return void (await failJob(
          env.DB,
          msg.jobId,
          "Couldn't line up the words. The cut still works, on the recogniser's own timings.",
        ));
      }
      return void (await finishJob(env.DB, msg.jobId));
    }
    case "judge": {
      await startJob(env.DB, msg.jobId, "reading the claims");
      const out = await runJudge(env, msg.userId, {
        onProgress: (done, total) =>
          void advance(env.DB, msg.jobId, Math.round((done / total) * 100), "judging"),
      });
      await meter(env.DB, {
        user_id: msg.userId,
        job_id: msg.jobId,
        job_type: "judge",
        tokens_in: out.tokensIn,
        tokens_out: out.tokensOut,
        /* Empty when it looked and found nothing to answer about, which is
           a different fact from a run that failed. The model it used is in
           every row it wrote (eval_machine.model), where it belongs — a
           usage row is about cost. */
        outcome: out.judged ? "found" : "empty",
      });
      /* Nothing judged is a failure, not a quiet success: the set is there
         and nobody has an answer about it. */
      if (!out.judged) {
        return void (await failJob(
          env.DB,
          msg.jobId,
          out.claims ? "The judge answered nothing." : "Nothing has been labelled yet.",
        ));
      }
      return void (await finishJob(env.DB, msg.jobId));
    }
    case "take": {
      await startJob(env.DB, msg.jobId, "lining up the take");
      const take = await runTake(env, msg.userId, msg.beatId);
      /*
       * A TAKE THAT DOES NOT READ THE LINE IS A FINISHED JOB, not a failed
       * one. The recording is stored, usable, and now carries what it
       * turned out to be — which is the result. Failing here would put a
       * red line against a take the person may well want.
       */
      await finishJob(env.DB, msg.jobId);
      if (take.verdict !== "matches") {
        console.log(`[take] ${msg.beatId}: ${take.verdict} — ${take.reason}`);
      }
      return;
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
  /*
   * THE FALLBACK HAD NO CATCH, and that is the one failure mode this whole
   * file exists to prevent.
   *
   * On the queue path a throw is caught by `consume`, retried, and closed out
   * honestly on the last delivery — and the dead-letter queue is behind that.
   * On the waitUntil path there was nothing: the promise rejected, the
   * runtime swallowed it, and the job row said "queued" for ever with no
   * error anywhere and nothing in the log.
   *
   * Found by running a Scout job for the first time. The POST returned 200,
   * the row said queued, no beats were written, and the wrangler log had not
   * one line about it — which is invariant 7's silent partial failure
   * arriving through the path every local developer uses, and the path
   * production uses until the queue is provisioned.
   *
   * No retry here on purpose: waitUntil has no redelivery to retry WITH, so
   * the honest thing is one attempt and a recorded failure.
   */
  ctx.waitUntil(
    runJob(env, msg).catch(async (err) => {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`job ${msg.jobId} (${msg.type}) failed outside the queue:`, err);
      try {
        const [job] = await getJobs(env.DB, [msg.jobId]);
        if (job && job.state !== "ready" && job.state !== "failed") {
          await failJob(env.DB, msg.jobId, `That didn't finish: ${reason}`);
        }
      } catch (writeErr) {
        /* The database is the last thing left. reapStaleJobs is the backstop
           it has always been — slower, and not silent. */
        console.error(`job ${msg.jobId}: could not record the failure`, writeErr);
      }
    }),
  );
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
  /* ONE DEFAULT EXPORT SERVES EVERY QUEUE, so the handler has to ask which
     one it is on. Without this the dead-letter queue would be consumed by
     runJob — which would re-run the work that already failed three times, and
     a message the platform gave up on would quietly become a fourth attempt. */
  if (batch.queue === DEAD_LETTER_QUEUE) return consumeDeadLetter(batch, env);

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
      if (isLastDelivery(message.attempts)) {
        const [job] = await getJobs(env.DB, [message.body.jobId]);
        if (job && job.state !== "ready" && job.state !== "failed") {
          await failJob(env.DB, message.body.jobId, `That didn't finish: ${reason}`);
        }
        message.ack();
      } else {
        message.retry({ delaySeconds: backoffSeconds(message.attempts) });
      }
    }
  }
}

/**
 * THE DEAD-LETTER QUEUE: the last thing between a job and a lie.
 *
 * `labs/OPERATIONS.md`: "Queues delete on retry exhaustion unless a
 * dead-letter queue exists — that is exactly how '300 processed, 200 didn't'
 * happens. Every consumer gets a DLQ; the DLQ consumer writes
 * `failed_terminal` and alerts."
 *
 * `consume` already closes a job out on its own last delivery, and while the
 * two retry counts agree that covers the ordinary case. This covers the rest
 * of them, and there are more than one: the worker is evicted mid-message,
 * `failJob` itself throws so the ack is never reached, the platform's own
 * count is changed in a file nobody thinks of as code, or a message is
 * malformed enough that `runJob` cannot even find a job id.
 *
 * IT DOES THE SMALLEST POSSIBLE THING, on purpose. A dead-letter queue with
 * its own dead-letter queue is turtles, so this consumer has to be the one
 * that cannot fail: it reads one row and writes one row, with no model call,
 * no R2, no container and no fetch. Where it still fails, `reapStaleJobs`
 * remains the backstop it has always been — slower, and not silent.
 *
 * It does NOT retry the work. A message arrives here because the work failed
 * three times; a fourth attempt would spend money to reach the same place and
 * delay the honest answer by another four minutes.
 */
export async function consumeDeadLetter(batch: MessageBatch<JobMessage>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    const jobId = message.body?.jobId;
    if (!jobId) {
      /* A message with no job id cannot be reported against anything. Acked
         rather than retried, because it will be just as unidentifiable in
         thirty seconds, and left in the log as the only trace it can have. */
      console.error("dead-letter: a message with no job id", JSON.stringify(message.body ?? null));
      message.ack();
      continue;
    }

    try {
      const [job] = await getJobs(env.DB, [jobId]);
      /* A job that finished on a later delivery while an earlier one was
         still in flight is not a failure. Overwriting "ready" with a failure
         would turn a working job into a broken one on the strength of a
         message the platform could not deliver. */
      if (job && job.state !== "ready" && job.state !== "failed") {
        await failJob(env.DB, jobId, "That didn't finish, and the retries ran out.");
      }
      /* Logged whether or not a row was written: invariant 7's "none failed
         silently" is about the operator as much as the user, and
         10-OPERATIONS-AND-PRICING.md pages on ANY dead-letter message. */
      console.error(`dead-letter: job ${jobId} (${message.body.type}) exhausted its retries`);
      message.ack();
    } catch (err) {
      /* The one write failed. Retried, because a busy database in a consumer
         this small is the likeliest reason and the next delivery is cheap. */
      console.error(`dead-letter: could not close out job ${jobId}`, err);
      message.retry({ delaySeconds: backoffSeconds(message.attempts) });
    }
  }
}
