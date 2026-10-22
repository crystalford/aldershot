/**
 * THE SLO DASHBOARD: four numbers about whether this product is working.
 *
 * Phase 8's last item, and the hardest thing about it is choosing what NOT
 * to show. A dashboard of everything measurable is a dashboard nobody reads,
 * and the number somebody needs at 2am is not the ninety-ninth percentile of
 * anything — it is "is the thing broken, and if so which part".
 *
 * So: four, each answering a different question, each from rows that already
 * exist rather than from a metrics pipeline that would have to be kept in
 * step with reality.
 *
 *   the canary   does the judge still give the right answer
 *   jobs         did work finish, or die
 *   items        did pieces of work fail inside jobs that reported finishing
 *   pools        is a provider shut, and why
 *
 * THE ITEM NUMBER IS THE ONE WITH TEETH. A job can report `ready` while
 * items inside it failed — that is exactly the silent partial success
 * invariant 7 forbids, and the completion invariant is what stops it. This
 * counts whether it is happening anyway, because a rule nobody measures is a
 * rule that has stopped applying without telling you.
 *
 * NULL IS NOT GREEN. Every reading distinguishes "none" from "none bad": a
 * product that has run no jobs has not got a perfect record, and saying so
 * is the same discipline as invariant 4's reachable "nothing backs this".
 */

import { canaryHealth, type Health as CanaryHealth } from "./canary.ts";
import { allHealth, type PoolState, type Verdict as PoolVerdict } from "./breaker.ts";

/** A day, which is the window all four read over. */
export const WINDOW_MS = 24 * 3600 * 1000;

export interface Reading {
  /** What it measures, in the words a person reads. */
  label: string;
  /**
   * The number, or null when there is nothing to report.
   *
   * Null means NOTHING HAPPENED, not nothing went wrong — the two look alike
   * on a dashboard and are not. `says` carries the difference.
   */
  value: number | null;
  of: number;
  /** A sentence. Never just a number, and never a bare percentage. */
  says: string;
  /** Whether somebody should look. The only thing a colour may encode. */
  attention: boolean;
}

export interface Slo {
  canary: Reading;
  jobs: Reading;
  items: Reading;
  pools: Reading;
  /** The pool rows themselves, so the panel can name the one that is shut. */
  poolRows: Array<PoolState & { verdict: PoolVerdict }>;
}

const one = (n: number, w: string, many = `${w}s`) => `${n} ${n === 1 ? w : many}`;

/** What the canary has been saying. */
export function canaryReading(h: CanaryHealth): Reading {
  if (!h.of) {
    return {
      label: "The judge, checked",
      value: null,
      of: 0,
      /* Never checked is not fine. A dashboard that showed a green tick here
         would be reporting the absence of a check as the success of one. */
      says: "nothing has checked it yet — the sweep writes the first row",
      attention: true,
    };
  }
  const bad = h.of - h.ok;
  return {
    label: "The judge, checked",
    value: h.ok,
    of: h.of,
    says: bad
      ? `${one(bad, "check")} of ${h.of} went wrong — last: ${h.last?.says ?? "no reason recorded"}`
      : `${one(h.of, "check")} today, all right — last ${h.last?.ms ?? 0}ms`,
    attention: bad > 0,
  };
}

/**
 * How many jobs finished against how many died.
 *
 * A failed job is not an emergency on its own — a user cancels, a provider
 * blips — so this asks for attention only when failures are a real share of
 * the day rather than on the first one.
 */
export const JOB_FAIL_SHARE = 0.1;

export async function jobReading(db: D1Database, now = Date.now()): Promise<Reading> {
  try {
    const r = await db
      .prepare(
        `SELECT
           SUM(CASE WHEN state='ready' THEN 1 ELSE 0 END) AS ok,
           SUM(CASE WHEN state='failed' THEN 1 ELSE 0 END) AS bad
         FROM jobs WHERE created_at >= ?`,
      )
      .bind(now - WINDOW_MS)
      .first<{ ok: number; bad: number }>();
    const ok = Number(r?.ok) || 0;
    const bad = Number(r?.bad) || 0;
    const of = ok + bad;
    if (!of) {
      return { label: "Jobs finished", value: null, of: 0, says: "nothing has run today", attention: false };
    }
    return {
      label: "Jobs finished",
      value: ok,
      of,
      /* "1476 of 1478 jobs failed", not "1476 jobs of 1478 failed" — the
         second reads as though the first number were the total, which is
         what driving this against a dev database full of failed runs showed
         on the first look. */
      says: bad ? `${bad} of ${one(of, "job")} failed` : `${one(of, "job")}, none failed`,
      attention: bad / of > JOB_FAIL_SHARE,
    };
  } catch {
    return { label: "Jobs finished", value: null, of: 0, says: "could not be read", attention: true };
  }
}

/**
 * ITEMS THAT FAILED INSIDE JOBS THAT SAID THEY WERE READY.
 *
 * The number with teeth. Invariant 7: "a job is complete only when every
 * item is terminal and none failed silently. Silent partial failure is a
 * P1." The completion invariant exists to make this impossible, and this
 * counts whether it is happening anyway — because a rule nobody measures is
 * a rule that can stop applying without telling anybody.
 *
 * ANY AT ALL ASKS FOR ATTENTION. There is no acceptable rate of silent
 * partial failure, so unlike the job reading this has no share to clear.
 */
export async function itemReading(db: D1Database, now = Date.now()): Promise<Reading> {
  try {
    const r = await db
      .prepare(
        `SELECT COUNT(*) AS bad FROM job_items i
           JOIN jobs j ON j.id = i.job_id
          WHERE i.status = 'failed_terminal' AND j.state = 'ready' AND j.created_at >= ?`,
      )
      .bind(now - WINDOW_MS)
      .first<{ bad: number }>();
    const total = await db
      .prepare(
        `SELECT COUNT(*) AS n FROM job_items i JOIN jobs j ON j.id = i.job_id WHERE j.created_at >= ?`,
      )
      .bind(now - WINDOW_MS)
      .first<{ n: number }>();

    const bad = Number(r?.bad) || 0;
    const of = Number(total?.n) || 0;
    if (!of) {
      return {
        label: "Pieces accounted for",
        value: null,
        of: 0,
        says: "no job today was broken into pieces",
        attention: false,
      };
    }
    return {
      label: "Pieces accounted for",
      value: of - bad,
      of,
      says: bad
        ? `${bad} of ${one(of, "piece")} failed inside a job that reported finishing — invariant 7 says this is a P1`
        : `${one(of, "piece")}, none failed inside a finished job`,
      attention: bad > 0,
    };
  } catch {
    return { label: "Pieces accounted for", value: null, of: 0, says: "could not be read", attention: true };
  }
}

/** Which providers are answering. */
export function poolReading(rows: Array<PoolState & { verdict: PoolVerdict }>): Reading {
  const shut = rows.filter((r) => r.verdict !== "closed");
  return {
    label: "Providers answering",
    value: rows.length - shut.length,
    of: rows.length,
    says: shut.length
      ? `${shut.map((r) => r.pool).join(", ")} shut — ${shut[0].lastSays ?? "no reason recorded"}`
      : `all ${rows.length} answering`,
    attention: shut.length > 0,
  };
}

/** The four, read together. */
export async function slo(db: D1Database, now = Date.now()): Promise<Slo> {
  const poolRows = await allHealth(db, now);
  const [canary, jobs, items] = await Promise.all([
    canaryHealth(db, WINDOW_MS, now).then(canaryReading),
    jobReading(db, now),
    itemReading(db, now),
  ]);
  return { canary, jobs, items, pools: poolReading(poolRows), poolRows };
}
