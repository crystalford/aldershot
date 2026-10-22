/**
 * THE BREAKER, and the pool a job finishes on when one provider is down.
 *
 * Phase 8 accepts on this sentence: "kill a provider mid-job in staging and
 * the job completes on another pool with every item accounted for." Two
 * halves — stop calling a pool that is failing, and have somewhere else to
 * go — and the second half already existed without anybody noticing.
 *
 * THE DEGRADED PATH IS THE FREE PATH. A load-bearing capability routes to
 * Claude when a key is configured and to Workers AI when none is, and that
 * second answer is `resolveFor(cap, {})` — the same branch every account
 * without an Anthropic key uses all day. So the fallback is not a cold path
 * written for an outage and exercised during one; it is the path most of the
 * product runs on, and `npm run check` tests it on every commit.
 *
 * WHAT MAY TRIP A POOL, AND WHAT MUST NEVER. `blameFor` in src/llm.ts
 * already splits a failure four ways, and only two of them are the pool's
 * fault. A 429 on the USER's key is their account's limit; a 401 on it is
 * their key being wrong. Tripping a shared pool on either would take the
 * platform down for everybody because one person pasted a bad key — which is
 * the failure mode a breaker is most likely to introduce, so it is the first
 * thing this file refuses to do.
 *
 * THE STATE IS A ROW, NOT A SINGLETON. A Worker is stateless per request and
 * there is no isolate to hold a counter in; a module-level variable would
 * count one isolate's failures and route on them. The row is also the only
 * way a person can be shown WHY a pool is shut, which invariant 3 asks for:
 * the sentence that closed it, kept beside the count.
 */

import type { Env } from "./env.ts";
import {
  ModelCallFailed,
  callReason,
  type Blame,
  type CallOptions,
  type ReasonCall,
  type ReasonResult,
} from "./llm.ts";
import { resolveFor, type Capability, type Resolved } from "./models.ts";

/** The routes to the same model, named. A pool is a way in, not a model. */
export const POOLS = ["anthropic/user", "anthropic/platform", "workers-ai"] as const;
export type Pool = (typeof POOLS)[number];

/**
 * Failures in one window before a pool is shut.
 *
 * Five, because one is a blip and a provider having a bad minute should not
 * cost a job its quality. Not tuned against anything — there is no outage to
 * tune against — so it is a named constant with the argument beside it
 * rather than a number in a branch.
 */
export const TRIP_AFTER = 5;

/** The window the failures have to fall inside. */
export const WINDOW_MS = 120_000;

/**
 * How long a shut pool stays shut before one call is let through.
 *
 * Long enough that a provider having a real outage is not probed every few
 * seconds, short enough that a recovered one is back inside a job's
 * lifetime.
 */
export const COOLDOWN_MS = 60_000;

export interface PoolState {
  pool: Pool;
  failures: number;
  windowStartedAt: number;
  /** Null when the pool is not shut. */
  openedAt: number | null;
  /** The last thing that went wrong, in the words a person reads. */
  lastSays: string | null;
}

export const fresh = (pool: Pool): PoolState => ({
  pool,
  failures: 0,
  windowStartedAt: 0,
  openedAt: null,
  lastSays: null,
});

export type Verdict = "closed" | "open" | "half-open";

/**
 * MAY WE CALL THIS POOL?
 *
 * `half-open` is a yes that counts: one call goes through, and whatever it
 * returns decides whether the pool closes or stays shut for another
 * cooldown. Without it a pool that tripped once would never be tried again,
 * which is an outage this product caused rather than suffered.
 */
export function decide(s: PoolState, now: number): Verdict {
  if (s.openedAt === null) return "closed";
  return now - s.openedAt >= COOLDOWN_MS ? "half-open" : "open";
}

/**
 * WHETHER THIS FAILURE IS THE POOL'S FAULT.
 *
 * The whole safety of the breaker is here. `user_key_limit` and
 * `user_key_bad` belong to one account and must never shut a shared pool —
 * see the header. `provider_busy` is the provider saying so, and `ours` is a
 * 5xx or a timeout, which is the pool not answering.
 */
export const poolsFault = (blame: Blame): boolean => blame === "provider_busy" || blame === "ours";

/**
 * The state after a failure. Unchanged when it was not the pool's fault.
 *
 * The window SLIDES by restarting: five failures spread over an hour are a
 * provider being normal, five in two minutes are a provider being down. A
 * count that never reset would shut every pool eventually.
 */
export function afterFailure(s: PoolState, blame: Blame, says: string, now: number): PoolState {
  if (!poolsFault(blame)) return s;
  const inWindow = now - s.windowStartedAt < WINDOW_MS;
  const failures = (inWindow ? s.failures : 0) + 1;
  return {
    ...s,
    failures,
    windowStartedAt: inWindow ? s.windowStartedAt : now,
    lastSays: says,
    /*
     * A FAILED PROBE SHUTS IT AGAIN, from now.
     *
     * The comment here used to say the opposite — that a pool stays shut
     * from when it first shut, so the cooldown is not extended — and a test
     * written to that claim failed against this line. The line was right and
     * the sentence was wrong: if `openedAt` never moved, `decide` would
     * return `half-open` for ever after the first cooldown and EVERY call
     * would probe a dead provider. That is not a breaker, it is a delay.
     *
     * So the cooldown restarts, which is what makes it one probe per
     * cooldown rather than one probe and then no protection at all.
     */
    openedAt: failures >= TRIP_AFTER ? now : s.openedAt,
  };
}

/** A success closes the pool and clears the count. It is working. */
export function afterSuccess(s: PoolState): PoolState {
  return { ...s, failures: 0, windowStartedAt: 0, openedAt: null, lastSays: null };
}

/**
 * WHAT TO USE INSTEAD, and nothing is a legitimate answer.
 *
 * For a capability that routes to Anthropic, the other pool is the Workers
 * AI model the same capability uses when no key is configured — which is
 * `resolveFor(cap, {})`, the branch most of this product runs on. So a
 * degraded answer is a normal answer from a model that is merely not the
 * best one, and it is TAGGED: every judgement already records the model that
 * made it, so a receipt produced during an outage says so afterwards.
 *
 * Null when the pool that is shut IS the free one. There is no third route
 * to invent, and pretending otherwise would be a fallback that fails.
 */
export function otherPool(cap: Capability, shut: Resolved): Resolved | null {
  if (shut.provider !== "anthropic") return null;
  const free = resolveFor(cap, {});
  return free.provider === "workers-ai" ? free : null;
}

/** Which pool a resolved model is reached through. */
export const poolOf = (model: Resolved, onUserKey: boolean): Pool =>
  model.provider !== "anthropic" ? "workers-ai" : onUserKey ? "anthropic/user" : "anthropic/platform";

/* ── The row ────────────────────────────────────────────────────────────── */

interface Row {
  pool: string;
  failures: number;
  window_started_at: number;
  opened_at: number | null;
  last_says: string | null;
}

const isPool = (v: string): v is Pool => (POOLS as readonly string[]).includes(v);

/**
 * Read a pool's health.
 *
 * A READ FAILURE NEVER SHUTS A POOL. The same rule as the spend cap: if the
 * database cannot be reached, the honest answer is to try the call, not to
 * refuse work because the bookkeeping is down.
 */
export async function healthOf(db: D1Database, pool: Pool): Promise<PoolState> {
  try {
    const r = await db
      .prepare("SELECT pool, failures, window_started_at, opened_at, last_says FROM pool_health WHERE pool = ?")
      .bind(pool)
      .first<Row>();
    if (!r || !isPool(r.pool)) return fresh(pool);
    return {
      pool: r.pool,
      failures: Number(r.failures) || 0,
      windowStartedAt: Number(r.window_started_at) || 0,
      openedAt: r.opened_at == null ? null : Number(r.opened_at),
      lastSays: r.last_says,
    };
  } catch {
    return fresh(pool);
  }
}

/** Write it back. Best effort, for the same reason as the read. */
export async function writeHealth(db: D1Database, s: PoolState, now = Date.now()): Promise<void> {
  try {
    await db
      .prepare(
        "INSERT INTO pool_health (pool, failures, window_started_at, opened_at, last_says, last_at) " +
          "VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(pool) DO UPDATE SET " +
          "failures = excluded.failures, window_started_at = excluded.window_started_at, " +
          "opened_at = excluded.opened_at, last_says = excluded.last_says, last_at = excluded.last_at",
      )
      .bind(s.pool, s.failures, s.windowStartedAt, s.openedAt, s.lastSays, now)
      .run();
  } catch {
    /* A breaker that cannot write is a breaker that does not trip, which is
       the safe direction: the calls still happen and still fail visibly. */
  }
}

/** Every pool's state, for the operator view. */
export async function allHealth(db: D1Database, now = Date.now()): Promise<Array<PoolState & { verdict: Verdict }>> {
  const out: Array<PoolState & { verdict: Verdict }> = [];
  for (const pool of POOLS) {
    const s = await healthOf(db, pool);
    out.push({ ...s, verdict: decide(s, now) });
  }
  return out;
}

/* ── The call, routed ───────────────────────────────────────────────────── */

export interface Routed extends ReasonResult {
  /** Which pool answered. Not always the one that was asked. */
  pool: Pool;
  /** True when the preferred pool was shut and another one served this. */
  degraded: boolean;
  /** Why it was shut, where it was. The sentence, not a code. */
  why: string | null;
}

/**
 * CALL A CAPABILITY, ROUTING AROUND A SHUT POOL.
 *
 * `callReason` stays the thing that knows how to speak to a provider; this
 * is the thing that knows where to speak. The split matters because the
 * routing needs the database and the speaking does not, and a `callReason`
 * that took a D1 binding would make every test of a model call need one.
 *
 * THREE OUTCOMES AND ALL OF THEM TERMINAL, which is invariant 7:
 *
 *   the preferred pool answers          — normal
 *   it is shut, the other pool answers  — degraded, tagged, and said out loud
 *   both are shut or there is no other  — it throws, with the reason
 *
 * Nothing here retries. A retry inside a breaker is the multiplication
 * CLAUDE.md warns about — "SDK retries × gateway retries × workflow retries
 * multiply" — and the queue above is already the retry mechanism.
 */
export async function callRouted(
  env: Env,
  cap: Capability,
  model: Resolved,
  call: ReasonCall,
  opts: CallOptions = {},
): Promise<Routed> {
  const now = Date.now();
  const wanted = poolOf(model, Boolean(opts.userKey?.trim()));
  const state = await healthOf(env.DB, wanted);
  const verdict = decide(state, now);

  /*
   * A SHUT POOL IS NOT TRIED AT ALL, which is the point: the cost of an
   * outage is otherwise one timeout per call per item, paid by every job
   * running. Half-open lets exactly one through to find out.
   */
  if (verdict === "open") {
    const other = otherPool(cap, model);
    if (!other) {
      throw new ModelCallFailed({
        blame: "provider_busy",
        says: state.lastSays ?? "That model provider is not answering, and there is no other route to it.",
        retryable: true,
      });
    }
    console.warn(`[pool] ${wanted} is shut — ${cap} is going to ${other.id}: ${state.lastSays ?? "no reason recorded"}`);
    const out = await callReason(env as never, other, call, opts);
    return { ...out, pool: poolOf(other, false), degraded: true, why: state.lastSays };
  }

  try {
    const out = await callReason(env as never, model, call, opts);
    /* Only write on a change — a closed pool that answers is the common
       case and does not need a write per call. */
    if (state.failures || state.openedAt !== null) await writeHealth(env.DB, afterSuccess(state), now);
    return { ...out, pool: wanted, degraded: false, why: null };
  } catch (err) {
    const failed = err instanceof ModelCallFailed ? err : null;
    const blame: Blame = failed?.blame ?? "ours";
    /* The sentence is the Error's own message — ModelCallFailed passes
       `says` to super(), so there is no second copy to drift from it. */
    const says = failed?.message ?? "That model call did not come back.";
    const next = afterFailure(state, blame, says, now);
    if (next !== state) await writeHealth(env.DB, next, now);
    if (next.openedAt !== null && state.openedAt === null) {
      console.warn(`[pool] ${wanted} is shut after ${next.failures} failures: ${says}`);
    }
    throw err;
  }
}
