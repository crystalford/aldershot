/**
 * THE CANARY: does the judge still work, asked on a schedule.
 *
 * Phase 8's canaries. A load-bearing capability can break in ways nothing
 * else notices — a provider changes a response shape, a model is retired, a
 * prompt stops fitting its schema — and the first person to find out should
 * not be somebody making a receipt. So one synthetic claim goes through the
 * REAL judge every sweep, and the answer is a row somebody can look at.
 *
 * THE SHIPPING PATH, NOT A COPY OF IT. `judge()` itself, with the same
 * prompts, the same schema, the same structural downgrade, through the same
 * breaker. A canary that called a reimplementation would prove the
 * reimplementation works, which is the mistake src/judge.ts' own `opts.model`
 * comment already warns about for the eval.
 *
 * AND IT MUST NOT BE CACHED, which is the subtle one. The call cache keys on
 * the prompt version, and a canary that hit the cache would come back green
 * while the provider was down — testing our own table instead of the thing
 * it exists to watch. `promptVersion` is what makes a call cacheable, so the
 * canary simply does not pass one. That is not a workaround: a check whose
 * answer may be a month old is not a check.
 *
 * IT KNOWS THE RIGHT ANSWER. The claim and the clip are written so that one
 * backs it and one does not, which means the canary can tell "the provider
 * answered" from "the provider answered correctly" — a 200 carrying nonsense
 * is the failure a liveness probe misses and this one does not.
 */

import type { Env } from "./env.ts";
import { judge } from "./judge.ts";

/**
 * The claim, and two moments: one says it, one is near it.
 *
 * Deliberately easy. A canary is not an eval — eval/adversarial.jsonl is
 * where hard cases live and where a model swap is measured. This asks only
 * whether the thing is working at all, so a failure here means something is
 * broken rather than that a model has got slightly worse.
 */
export const CLAIM = "the launch went out before the review came in";
export const BACKS = { id: "canary-backs", quote: "The launch went out, and the review landed a week after it." };
export const NEAR = { id: "canary-near", quote: "We would never ship ahead of a review. That is not how it works here." };

export type Verdict = "ok" | "wrong" | "down";

export interface Result {
  verdict: Verdict;
  /** A sentence, for the row and for a person reading it. */
  says: string;
  model: string;
  ms: number;
}

/**
 * Ask the real judge one question whose answer is known.
 *
 * THREE OUTCOMES AND THEY MEAN DIFFERENT THINGS. `down` is the call not
 * coming back — a provider problem, which the breaker is already counting.
 * `wrong` is the call coming back with the wrong answer, which is worse and
 * quieter: nothing else in the product would notice, and it is the reason
 * this is not a liveness probe.
 */
export async function runCanary(env: Env, now = Date.now()): Promise<Result> {
  const started = now;
  try {
    /* No promptVersion, so this cannot be served from the cache. See above. */
    const out = await judge(env, CLAIM, [BACKS, NEAR]);
    const ms = Date.now() - started;
    const backs = out.judgements.find((j) => j.id === BACKS.id);
    const near = out.judgements.find((j) => j.id === NEAR.id);

    if (!backs || !near) {
      return { verdict: "wrong", says: "the judge answered about the wrong moments", model: out.model, ms };
    }
    if (!backs.answered && !near.answered) {
      /* Every moment unanswered is a call that failed rather than a judge
         with no opinions — the distinction src/judge.ts' `answered` exists
         for, and the reason it is reported rather than inferred. */
      return { verdict: "down", says: "the judge answered nothing at all", model: out.model, ms };
    }
    /*
     * FALSE SUPPORT IS CHECKED FIRST, because it is the worse failure.
     *
     * These were the other way round, and a run where BOTH went wrong
     * reported the refused support and never mentioned that a denial had
     * been called support — found by a test whose fixture broke both at
     * once. A judge that has started saying yes to a denial is producing
     * receipts that lie, which is invariant 4 failing; a judge that refuses
     * real support is only unhelpful.
     */
    if (near.said === "backs") {
      return { verdict: "wrong", says: "the judge called a denial support", model: out.model, ms };
    }
    if (backs.said !== "backs") {
      return {
        verdict: "wrong",
        says: `the judge called plain support "${backs.said}"`,
        model: out.model,
        ms,
      };
    }
    return { verdict: "ok", says: `support found, the near miss refused, in ${ms}ms`, model: out.model, ms };
  } catch (err) {
    return {
      verdict: "down",
      says: err instanceof Error ? err.message : "the judge could not be reached",
      model: "",
      ms: Date.now() - started,
    };
  }
}

/** Write it down. Best effort — a canary that cannot log still ran. */
export async function recordCanary(db: D1Database, r: Result, now = Date.now()): Promise<void> {
  try {
    await db
      .prepare("INSERT INTO canary_runs (at, verdict, says, model, ms) VALUES (?, ?, ?, ?, ?)")
      .bind(now, r.verdict, r.says, r.model, r.ms)
      .run();
  } catch {
    /* Nothing depends on the row existing; the console line above does the
       alerting until something reads these. */
  }
}

export interface Health {
  /** The most recent run, or null when none has happened. */
  last: (Result & { at: number }) | null;
  /** How many of the recent runs were ok, and how many there were. */
  ok: number;
  of: number;
}

/**
 * The last day of canary runs.
 *
 * NULL IS NOT GREEN. A product with no canary rows has never checked, which
 * is a different thing from having checked and been fine — the same
 * distinction as "we could not look" against "it is not there", and the
 * dashboard says which.
 */
export async function canaryHealth(db: D1Database, sinceMs = 24 * 3600 * 1000, now = Date.now()): Promise<Health> {
  try {
    const { results } = await db
      .prepare("SELECT at, verdict, says, model, ms FROM canary_runs WHERE at >= ? ORDER BY at DESC")
      .bind(now - sinceMs)
      .all<{ at: number; verdict: string; says: string; model: string; ms: number }>();
    const rows = results ?? [];
    const last = rows[0]
      ? {
          at: Number(rows[0].at),
          verdict: rows[0].verdict as Verdict,
          says: rows[0].says,
          model: rows[0].model,
          ms: Number(rows[0].ms),
        }
      : null;
    return { last, ok: rows.filter((r) => r.verdict === "ok").length, of: rows.length };
  } catch {
    return { last: null, ok: 0, of: 0 };
  }
}
