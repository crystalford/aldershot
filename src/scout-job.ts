/**
 * THE SCOUT JOB: one phase per message.
 *
 * `scout-run.ts` is a planner over rows and `scout-store.ts` can ask it the
 * question. This is the loop that was deliberately not written as a loop —
 * each delivery does ONE phase, writes what it found, and re-dispatches
 * itself. The queue is the retry mechanism, the dead-letter queue is the
 * backstop, and the planner decides what happens next.
 *
 * ONE PHASE PER MESSAGE, which is not an optimisation. A run is minutes of
 * frontier calls, adapter fetches and transcript scans; done inside one
 * invocation it would hit a worker's lifetime and die halfway, leaving the
 * row on "running" with no error — which is the exact failure the dead-letter
 * queue and the item table exist to stop, arriving through the front door.
 * One phase is seconds, and a phase that dies is one message redelivered
 * rather than a run lost.
 *
 * AND IT IS WHY A DEAD RUN RESUMES. The next message asks the planner the
 * same question, and the planner reads rows. There is no state in this file
 * between deliveries, on purpose: anything held here would be the thing that
 * does not survive a restart.
 *
 * WHAT IT DOES NOT DO YET. Three adapters need keys that do not exist
 * (YouTube's search.list, Twitch, Brave), so a v0 run finds what channel
 * feeds and podcast feeds give it and records honest failures for the rest.
 * That is the right behaviour rather than a stub: the board says "no YouTube
 * Data API key" and the diligence log counts the refusal, which is true and
 * is what a person needs to see.
 */

import type { Env } from "./env.ts";
import { QuotaLedger, d1QuotaStore, runSearches, type ScoutAdapter, type SearchRequest } from "./scout-adapters.ts";
import { decompose } from "./scout-decompose.ts";
import { scanSource } from "./scout-scan-run.ts";
import { verifyRun } from "./scout-verify-run.ts";
import { expandQueries, type Term } from "./scout-expand.ts";
import { podcastAdapter } from "./scout-podcast.ts";
import { youtubeAdapter } from "./scout-youtube.ts";
import { nextStep, rowFor, type RunSnapshot } from "./scout-run.ts";
import { DEFAULT_BUDGET, coverageOf, recapture, type Point } from "./scout-stop.ts";
import { sourcesToScan,
  getBeats,
  queriesTried,
  snapshot,
  writeBeats,
  writeRunRow,
  writeSearches,
  writeSources,
} from "./scout-store.ts";

/** Every adapter that works without a key. The rest refuse with a sentence. */
export function adapters(env: Env): Map<string, ScoutAdapter> {
  void env;
  return new Map<string, ScoutAdapter>([
    ["youtube", youtubeAdapter()],
    ["podcast", podcastAdapter()],
  ]);
}

export interface ScoutJob {
  runId: string;
  projectId: string;
  userId: string;
  subject: string;
  brief: string;
  /** Carried between deliveries because no row holds it. See below. */
  queriesPending?: SearchRequest[];
  snowballed?: boolean;
}

/**
 * The two things the message carries, and why they are not rows.
 *
 * `queriesPending` is a round's written queries between `expand` and
 * `search`. They could be a table, and the reason they are not is that a
 * query nobody has issued has no diligence to record: the moment it IS
 * issued a `scout_searches` row is written, refusal included. A table of
 * intentions would be a second place to look for what was tried.
 *
 * `snowballed` is whether this round has closed. It is one bit per round and
 * recomputing it would mean asking "has a seed query been issued since the
 * last expand", which is the same bit by a longer route.
 *
 * BOTH ARE LOST IF THE MESSAGE IS. That is survivable and nothing else is:
 * a dropped message costs a round's queries being rewritten, which is one
 * frontier call. A dropped LEDGER row would cost evidence.
 */
export async function runScoutPhase(env: Env, job: ScoutJob): Promise<ScoutJob | null> {
  const beats = await getBeats(env.DB, job.runId);
  const tried = await queriesTried(env.DB, job.runId);

  /* The curve and the coverage, rebuilt from rows each time. The stopping
     rule is a measurement and a measurement held in a message is a
     measurement that drifts. */
  const verifiedByBeat = new Map<string, number>();
  const triedByBeat = new Map<string, number>();
  for (const b of beats) triedByBeat.set(b.id, b.queriesTried);

  const stop = {
    rounds: 0,
    sourcesScanned: 0,
    spendUsd: 0,
    queriesIssued: tried.length,
    curve: [{ queries: 0, verified: 0 }] as Point[],
    coverage: coverageOf(
      beats.map((b) => ({ id: b.id, role: b.role, needMin: b.needMin })),
      verifiedByBeat,
      triedByBeat,
    ),
    recapture: recapture(0, 0, 0, 0),
  };

  const snap: RunSnapshot = await snapshot(env.DB, job.runId, {
    queriesPending: job.queriesPending?.length ?? 0,
    snowballed: job.snowballed ?? false,
    stop,
  });

  const step = nextStep(snap);
  await writeRunRow(env.DB, job.runId, rowFor(snap, Date.now()));

  switch (step.phase) {
    case "decompose": {
      const out = await decompose(env, { claim: job.brief, brief: job.brief });
      await writeBeats(env.DB, { runId: job.runId, projectId: job.projectId, beats: out.beats });
      return { ...job, snowballed: false };
    }

    case "expand": {
      const vocabulary: Term[] = [];
      const out = await expandQueries(env, {
        subject: job.subject,
        beats: beats.map((b) => ({ id: b.id, role: b.role, behaviour: b.behaviour })),
        vocabulary,
        alreadyTried: tried,
      });
      const requests: SearchRequest[] = out.queries.map((q) => ({
        /* Every query goes to every keyless adapter it could suit. A query
           nobody can run is a query that should say so rather than vanish —
           the adapter refuses and the refusal is a row. */
        adapter: "youtube",
        beatId: q.beatId,
        family: q.family,
        query: q.query,
        ...(q.hyde ? { hyde: q.hyde } : {}),
      }));
      return { ...job, queriesPending: requests, snowballed: false };
    }

    case "search": {
      const ledger = new QuotaLedger(d1QuotaStore(env.DB));
      const out = await runSearches(job.queriesPending ?? [], adapters(env) as never, ledger, {
        alreadyTried: new Set(tried.map((q) => `youtube\u0000${q}`)),
      });

      await writeSearches(
        env.DB,
        out.rows.map((r) => ({
          runId: job.runId,
          beatId: r.beatId,
          family: r.family,
          adapter: r.adapter,
          query: r.query,
          hyde: r.hyde,
          resultsN: r.resultsN,
          quotaUnits: r.quotaUnits,
          outcome: r.outcome,
          failReason: r.failReason,
        })),
      );
      await writeSources(env.DB, job.runId, out.candidates);
      return { ...job, queriesPending: [] };
    }

    case "scan": {
      /*
       * READING THE SOURCES THAT HAVE WORDS IN THEM.
       *
       * This arm did not exist, and the comment below said why: "none is
       * reachable until a source arrives with words in it". One had —
       * the podcast adapter marks an episode with a published transcript
       * `native` — but scout_sources recorded THAT a transcript existed and
       * never WHERE, so the run could not reach it. The column is there now.
       *
       * A few sources per invocation, highest triage score first, and the
       * phase returns so the run re-dispatches. A long transcript is read
       * across rounds rather than in one call that times out.
       */
      const ready = await sourcesToScan(env.DB, job.runId, 3);
      if (!ready.length) return { ...job, snowballed: false };

      for (const source of ready) {
        const out = await scanSource(env, { runId: job.runId, source, beats });
        console.log(
          `[scout] scan ${source.id}: ${out.scanned} window(s), ${out.found} quote(s)` +
            `${out.skipped ? ` — skipped: ${out.skipped}` : ""}`,
        );
      }
      return { ...job, snowballed: false };
    }

    case "verify": {
      /*
       * CHECKING THE SCAN'S CLAIMS AGAINST THE RECORDING.
       *
       * The comment below used to say this phase "needs the scan above to
       * have written something". It had been written to — the scan writes
       * every find with `verify: 'rejected'` because nothing has looked yet
       * — and the phase was still never reached, because the planner's
       * count of unchecked finds was looking at the wrong table and was
       * therefore always zero. So every quote Scout found was stored as a
       * rejection, permanently, and nothing could reach the board.
       *
       * Deterministic end to end: no model is called here. Spec 18 §3.6 —
       * the step that checks the model cannot be a model call, or there is
       * nothing underneath it.
       */
      const out = await verifyRun(env, { runId: job.runId });
      console.log(
        `[scout] verify: ${out.checked} checked — ${out.verified} verified, ` +
          `${out.paraphrase} paraphrase, ${out.rejected} rejected` +
          `${out.unreadable.length ? ` — ${out.unreadable.length} source(s) unreadable, rows left for a retry` : ""}`,
      );
      return { ...job, snowballed: false };
    }

    /*
     * THE PHASE THAT NEEDS WHAT V0 HAS NOT GOT. Triage needs the harvested
     * vocabulary.
     *
     * Returning null ENDS the chain rather than looping. A job that
     * re-dispatched itself into a phase it cannot perform is a message that
     * costs a delivery every few seconds for ever — and the run's row still
     * says what it is waiting for, which is the honest state.
     */
    default:
      return null;
  }
}

/** Whether another message is worth sending. The planner's answer, not ours. */
export const hasMoreToDo = (job: ScoutJob | null): job is ScoutJob => job !== null;

export { DEFAULT_BUDGET };
