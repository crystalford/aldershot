/**
 * THE ITEM STATE MACHINE, and the completion invariant on top of it.
 *
 * `labs/OPERATIONS.md`, and its build order puts this first: "One state row
 * per item — footage file, segment, generated shot, render chunk — with
 * status, attempt, last_error_class, provider, cost_usd, idempotency_key,
 * deadline_at ... **A job is `complete` only when every item is terminal and
 * `failed_terminal` is zero — or the user has explicitly accepted a degraded
 * result.** A reconciler alarm re-enqueues anything past its deadline.
 * Nothing can disappear."
 *
 * That last sentence is the whole thing. Today a job in this product is ONE
 * row with a percentage on it, so "300 processed, 200 didn't" has nowhere to
 * be recorded: the job says 60% and then says ready, and the two hundred are
 * gone. Invariant 7 calls that a P1 and it is the most expensive kind of bug
 * this product can have, because the output looks finished.
 *
 * GENERAL ON PURPOSE. Scout needs it — one item per search, per scanned
 * source, per verification — and so does every read, render and score that
 * already ships. The spec's own list of items is four things and none of them
 * is Scout.
 *
 * THREE THINGS IN HERE ARE EASY TO GET SUBTLY WRONG.
 *
 * `failed_retryable` IS NOT TERMINAL. It is the state that means come back,
 * and a completion check that counted it as finished would declare a job done
 * while work was still owed. It is the single most important line in the file.
 *
 * A TERMINAL STATE IS TERMINAL. Nothing moves out of `succeeded`, and nothing
 * moves out of `failed_terminal` except by a user accepting the degraded
 * result — which is a decision ABOUT the job, not a change to the item.
 * Allowing a quiet re-run of a succeeded item is how a cache gets bypassed
 * and a bill doubles.
 *
 * THE IDEMPOTENCY KEY IS A CONTENT ADDRESS, not a job id and not a ULID. The
 * same hash keys the render cache, so a key that leaves out anything which
 * changes the output serves the wrong stored result — which is worse than
 * doing the work twice, because it is silent and it is wrong.
 */

/* ── The states ─────────────────────────────────────────────────────────── */

export const ITEM_STATUSES = [
  "pending",
  "running",
  "succeeded",
  "failed_retryable",
  "failed_terminal",
  "skipped_by_user",
] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

/**
 * The states an item never leaves.
 *
 * `failed_retryable` is deliberately absent. It is not a failure the job can
 * be finished around; it is work still owed, and the reconciler's job is to
 * put it back.
 */
export const TERMINAL: readonly ItemStatus[] = ["succeeded", "failed_terminal", "skipped_by_user"];

export const isTerminal = (s: ItemStatus): boolean => TERMINAL.includes(s);

/**
 * Which moves are legal.
 *
 * Written out rather than inferred, because every illegal move is a specific
 * bug with a specific cost. `succeeded → running` is a doubled bill.
 * `failed_terminal → succeeded` is a lie. `pending → succeeded` skipping
 * `running` is an item nobody can see in flight, which is the per-item UI the
 * build order exists for.
 */
const MOVES: Record<ItemStatus, readonly ItemStatus[]> = {
  pending: ["running", "skipped_by_user"],
  running: ["succeeded", "failed_retryable", "failed_terminal", "skipped_by_user"],
  /* Back to pending is the reconciler re-enqueueing; straight to running is a
     retry that never left the worker. Straight to failed_terminal is attempts
     having run out. */
  failed_retryable: ["pending", "running", "failed_terminal", "skipped_by_user"],
  succeeded: [],
  failed_terminal: [],
  skipped_by_user: [],
};

/** Is this move allowed? A move to the state it is already in is allowed and does nothing. */
export const canMove = (from: ItemStatus, to: ItemStatus): boolean =>
  from === to || MOVES[from].includes(to);

export interface Item {
  id: string;
  jobId: string;
  /** What kind of thing this is — "source", "segment", "search", "scan", "verify", "render-chunk". */
  kind: string;
  status: ItemStatus;
  attempt: number;
  /** A CLASS, not a message: "quota", "timeout", "upstream_5xx", "schema". */
  lastErrorClass: string | null;
  provider: string | null;
  costUsd: number;
  /** The content address. Equal keys are the same work. */
  idempotencyKey: string;
  /** When this item stops being believed. The reconciler reads it. */
  deadlineAt: number | null;
}

/** How many attempts an item gets before `failed_retryable` becomes terminal. */
export const MAX_ATTEMPTS = 3;

export class IllegalMove extends Error {
  readonly from: ItemStatus;
  readonly to: ItemStatus;
  constructor(from: ItemStatus, to: ItemStatus) {
    super(`an item cannot go from ${from} to ${to}`);
    this.name = "IllegalMove";
    this.from = from;
    this.to = to;
  }
}

/**
 * Moves an item, or refuses visibly.
 *
 * THROWS RATHER THAN RETURNING FALSE. An illegal move is a bug in the caller,
 * and a caller that can ignore a `false` will: the convention in this
 * codebase is that an output which does not fit fails visibly, and a state
 * machine that silently declines a move leaves the item where it was while
 * the caller believes otherwise. That is the same silent partial failure one
 * level down.
 */
export function move(
  item: Item,
  to: ItemStatus,
  patch: Partial<Pick<Item, "lastErrorClass" | "provider" | "costUsd" | "deadlineAt">> = {},
): Item {
  if (!canMove(item.status, to)) throw new IllegalMove(item.status, to);

  /* An attempt is counted on entering `running`, not on leaving it. An item
     killed mid-flight never leaves, and an attempt counted on the way out
     would let it be retried for ever. */
  const attempt = to === "running" && item.status !== "running" ? item.attempt + 1 : item.attempt;

  return {
    ...item,
    status: to,
    attempt,
    /* Cost ACCUMULATES. A retry that cost money and then succeeded cost both,
       and per-job cost is the most important number in the business. */
    costUsd: item.costUsd + (patch.costUsd ?? 0),
    lastErrorClass:
      to === "failed_retryable" || to === "failed_terminal"
        ? (patch.lastErrorClass ?? item.lastErrorClass)
        : /* A success clears the last error, or an item that failed once and
             then worked reads as broken for ever. */
          to === "succeeded"
          ? null
          : item.lastErrorClass,
    provider: patch.provider ?? item.provider,
    deadlineAt: "deadlineAt" in patch ? (patch.deadlineAt ?? null) : item.deadlineAt,
  };
}

/**
 * A failure, routed by whether there is any point trying again.
 *
 * `attempt` is checked rather than trusted from the caller: a caller deciding
 * for itself whether to retry is a caller that can loop for ever, and this is
 * the only place that counts.
 */
export function fail(item: Item, errorClass: string, opts: { retryable: boolean; costUsd?: number } = { retryable: true }): Item {
  const spent = item.attempt >= MAX_ATTEMPTS;
  const to: ItemStatus = opts.retryable && !spent ? "failed_retryable" : "failed_terminal";
  return move(item, to, { lastErrorClass: errorClass, costUsd: opts.costUsd });
}

/* ── The completion invariant ───────────────────────────────────────────── */

export interface Completion {
  complete: boolean;
  /** Every item is in a state it will not leave. */
  allTerminal: boolean;
  counts: Record<ItemStatus, number>;
  /** The items still owed, by id. Empty when allTerminal. */
  outstanding: string[];
  /** A sentence. There is no silent completion and no silent incompletion. */
  why: string;
}

/**
 * Is this job complete?
 *
 * THE SPEC'S SENTENCE, ENFORCED: "complete only when every item is terminal
 * and `failed_terminal` is zero — or the user has explicitly accepted a
 * degraded result."
 *
 * Both halves matter and the second is not a loophole. A degraded result the
 * user accepted is a finished job; a degraded result nobody mentioned is the
 * failure this whole file exists to prevent. So acceptance is a parameter
 * rather than a default, and a job with terminal failures and no acceptance
 * reports itself incomplete for ever — which is correct, and is what a
 * reconciler alarm and a person are for.
 *
 * A JOB WITH NO ITEMS IS NOT COMPLETE. It is a job whose items were never
 * written, which is the first thing that goes wrong when this machinery is
 * wired up, and "vacuously true" would hide it behind a green tick.
 */
export function completion(
  items: Array<Pick<Item, "id" | "status">>,
  opts: { degradedAccepted?: boolean } = {},
): Completion {
  const counts = Object.fromEntries(ITEM_STATUSES.map((s) => [s, 0])) as Record<ItemStatus, number>;
  for (const i of items) counts[i.status] = (counts[i.status] ?? 0) + 1;

  const outstanding = items.filter((i) => !isTerminal(i.status)).map((i) => i.id);
  const allTerminal = outstanding.length === 0;

  if (!items.length) {
    return {
      complete: false,
      allTerminal: false,
      counts,
      outstanding: [],
      why: "this job has no items, so there is nothing to have finished",
    };
  }

  if (!allTerminal) {
    const n = outstanding.length;
    return {
      complete: false,
      allTerminal: false,
      counts,
      outstanding,
      why: `${n} of ${items.length} item${n === 1 ? " is" : "s are"} still owed`,
    };
  }

  if (counts.failed_terminal > 0 && !opts.degradedAccepted) {
    return {
      complete: false,
      allTerminal: true,
      counts,
      outstanding: [],
      why: `${counts.failed_terminal} of ${items.length} failed for good — this is a partial result and nobody has accepted it`,
    };
  }

  return {
    complete: true,
    allTerminal: true,
    counts,
    outstanding: [],
    why: counts.failed_terminal
      ? `finished with ${counts.failed_terminal} failed, which you accepted`
      : counts.skipped_by_user
        ? `every item finished; ${counts.skipped_by_user} you skipped`
        : "every item finished",
  };
}

/* ── The reconciler ─────────────────────────────────────────────────────── */

export interface Reconciliation {
  /** Put back on the queue. */
  requeue: string[];
  /** Out of attempts: terminal, and the job is now degraded. */
  giveUp: string[];
}

/**
 * What to do about items past their deadline.
 *
 * "A reconciler alarm re-enqueues anything past its deadline. Nothing can
 * disappear." The deadline is what makes a lost item findable: a worker
 * evicted between `running` and any terminal state leaves a row saying
 * running for ever, and no error anywhere.
 *
 * AN ITEM OUT OF ATTEMPTS IS GIVEN UP ON RATHER THAN RE-ENQUEUED, because the
 * alternative is a reconciler that puts the same poisonous item back every
 * time it fires — forever, at whatever that item costs. Giving up is visible:
 * it makes the job incomplete until somebody accepts the degraded result.
 */
export function reconcile(
  items: Array<Pick<Item, "id" | "status" | "attempt" | "deadlineAt">>,
  now = Date.now(),
): Reconciliation {
  const requeue: string[] = [];
  const giveUp: string[] = [];

  for (const i of items) {
    if (isTerminal(i.status)) continue;
    /* An item with no deadline is one nobody promised a time for. Left alone:
       re-enqueueing on a missing deadline would re-enqueue everything
       pending, every time the alarm fires. */
    if (i.status !== "failed_retryable" && (i.deadlineAt === null || i.deadlineAt > now)) continue;
    if (i.attempt >= MAX_ATTEMPTS) giveUp.push(i.id);
    else requeue.push(i.id);
  }

  return { requeue, giveUp };
}

/* ── The content address ────────────────────────────────────────────────── */

/**
 * The idempotency key: a hash of everything that changes the answer.
 *
 * "The idempotency key is a content address — hash(input asset hashes +
 * directive hash + model + params) — the same hash that keys the render
 * cache, so every replay, hedge or duplicate delivery collapses into one
 * stored result."
 *
 * WHICH MEANS LEAVING SOMETHING OUT IS NOT A MISSED OPTIMISATION, it is a
 * wrong answer served silently: two different pieces of work share a key, the
 * second gets the first's stored result, and nothing anywhere says so. So the
 * model and the parameters are part of it, not just the inputs — a prompt
 * change with the same footage is different work.
 *
 * Parts are joined with a separator that cannot appear in them, because
 * "ab" + "c" and "a" + "bc" must not hash the same. Key order is fixed by
 * sorting, so a caller building the object in a different order gets the same
 * address.
 */
export async function contentAddress(parts: Record<string, string | number | boolean | null | undefined>): Promise<string> {
  const canonical = Object.keys(parts)
    .filter((k) => parts[k] !== undefined && parts[k] !== null)
    .sort()
    .map((k) => `${k}\u0000${String(parts[k])}`)
    .join("\u0001");

  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ── Per-item progress ──────────────────────────────────────────────────── */

export interface Progress {
  /** Items in a state they will not leave. */
  done: number;
  total: number;
  /** Terminal failures, counted separately — they are done AND wrong. */
  failed: number;
  /**
   * Terminal items as a percentage, capped below 100 while anything is owed.
   *
   * MEASURED BY DEFINITION, which is the point of deriving it from items
   * rather than writing it from a stage. `jobs.pct` is set by whatever stage
   * is running, so a stage that reported 90% and then died left a job
   * claiming nine tenths of work that did not happen. A count of rows cannot
   * say that.
   *
   * A percentage of PROGRESS, not of quality — invariant 3 forbids a score
   * reaching a person, and "how much of this is finished" is a measurement
   * of work done rather than an opinion about how good it is.
   */
  pct: number;
  /** What is left, in a sentence. Never a bare number. */
  says: string;
}

/** Plural without the "(s)". */
const n = (count: number, one: string, many = `${one}s`): string =>
  `${count} ${count === 1 ? one : many}`;

/**
 * HOW FAR THROUGH A JOB IS, from its items.
 *
 * Phase 8 asks for per-item progress, and the reason it is per-item rather
 * than per-stage is that a stage's own estimate of itself is the thing that
 * has already been wrong: see `advance`, whose comment asks for measured work
 * and is trusted to supply it.
 *
 * NEVER 100 WHILE ANYTHING IS OWED, and never 100 at all — the job's own
 * state says finished, and a bar at 100 beside a job still running is the
 * same lie from the other end. 99 is the ceiling `advance` already uses, kept
 * so the two cannot disagree about what full looks like.
 *
 * A JOB WITH NO ITEMS IS 0 AND SAYS SO, for the same reason `completion`
 * refuses to call it complete: items that were never written are the first
 * thing that goes wrong when this machinery is wired up, and a cheerful
 * "nothing to do" would hide it.
 */
export function progress(items: Array<Pick<Item, "id" | "status">>): Progress {
  const total = items.length;
  if (!total) {
    return { done: 0, total: 0, failed: 0, pct: 0, says: "nothing has been broken into items yet" };
  }

  const done = items.filter((i) => isTerminal(i.status)).length;
  const failed = items.filter((i) => i.status === "failed_terminal").length;
  const running = items.filter((i) => i.status === "running").length;
  const pct = Math.min(99, Math.round((done / total) * 100));

  const parts = [`${done} of ${n(total, "piece")} done`];
  if (running) parts.push(`${running} in hand`);
  /* Failures are named rather than folded into "done", because a job that
     finished with three failures is not the same thing as a job that
     finished, and invariant 7 is the rule that says so. */
  if (failed) parts.push(n(failed, "failed"));

  return { done, total, failed, pct, says: parts.join(" · ") };
}
