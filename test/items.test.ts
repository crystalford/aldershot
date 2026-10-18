/**
 * THE ITEM STATE MACHINE, and the completion invariant on top of it.
 *
 * `labs/OPERATIONS.md` puts this first in the build order, and invariant 7
 * says why: "A job is complete only when every item is terminal and
 * failed_terminal is zero — or the user has explicitly accepted a degraded
 * result. Nothing can disappear."
 *
 * Today a job in this product is one row with a percentage on it, so "300
 * processed, 200 didn't" has nowhere to be recorded — the job says 60%, then
 * says ready, and the two hundred are gone. That is the most expensive kind
 * of bug this product can have, because the output looks finished.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  IllegalMove,
  ITEM_STATUSES,
  MAX_ATTEMPTS,
  TERMINAL,
  canMove,
  completion,
  contentAddress,
  fail,
  isTerminal,
  move,
  reconcile,
  type Item,
  type ItemStatus,
} from "../src/items.ts";

const item = (over: Partial<Item> = {}): Item => ({
  id: "i1",
  jobId: "j1",
  kind: "source",
  status: "pending",
  attempt: 0,
  lastErrorClass: null,
  provider: null,
  costUsd: 0,
  idempotencyKey: "abc",
  deadlineAt: null,
  ...over,
});

/* ── Which states are terminal ──────────────────────────────────────────── */

test("ACCEPTANCE: failed_retryable is not terminal", () => {
  /*
   * THE SINGLE MOST IMPORTANT LINE IN THE FILE. It is the state that means
   * come back, and a completion check counting it as finished would declare a
   * job done while work was still owed — which is the exact failure the
   * completion invariant exists to prevent, arriving through the one state
   * that looks like a failure and is not an outcome.
   */
  assert.equal(isTerminal("failed_retryable"), false);
  assert.ok(!TERMINAL.includes("failed_retryable"));

  assert.deepEqual([...TERMINAL].sort(), ["failed_terminal", "skipped_by_user", "succeeded"]);
  for (const s of ITEM_STATUSES) {
    assert.equal(isTerminal(s), TERMINAL.includes(s), s);
  }
  /* And pending and running are obviously not terminal, which is the easy half. */
  assert.equal(isTerminal("pending"), false);
  assert.equal(isTerminal("running"), false);
});

/* ── Which moves are legal ──────────────────────────────────────────────── */

test("ACCEPTANCE: a terminal state is terminal", () => {
  /*
   * Nothing leaves `succeeded` — a quiet re-run of a succeeded item is how a
   * cache gets bypassed and a bill doubles. Nothing leaves `failed_terminal`
   * either: accepting a degraded result is a decision ABOUT THE JOB, not a
   * change to the item, or the record of what failed is erased by the act of
   * accepting it.
   */
  for (const from of ["succeeded", "failed_terminal", "skipped_by_user"] as ItemStatus[]) {
    for (const to of ITEM_STATUSES) {
      if (to === from) continue;
      assert.equal(canMove(from, to), false, `${from} → ${to} must be refused`);
    }
    /* A move to the state it is already in is a no-op rather than an error:
       two deliveries of the same message must not throw. */
    assert.equal(canMove(from, from), true);
  }
});

test("an illegal move throws rather than returning false", () => {
  /*
   * A caller that can ignore a `false` will, and then the item stays where it
   * was while the caller believes otherwise — the same silent partial failure
   * one level down. The convention in this codebase is that an output which
   * does not fit fails visibly.
   */
  assert.throws(() => move(item({ status: "succeeded" }), "running"), IllegalMove);
  assert.throws(() => move(item({ status: "failed_terminal" }), "succeeded"), /cannot go from failed_terminal to succeeded/);
  /* And pending cannot skip running — an item nobody can see in flight is the
     per-item UI the build order exists for, missing. */
  assert.throws(() => move(item({ status: "pending" }), "succeeded"), IllegalMove);
});

test("the legal moves are the ones the pipeline actually makes", () => {
  assert.ok(canMove("pending", "running"));
  assert.ok(canMove("running", "succeeded"));
  assert.ok(canMove("running", "failed_retryable"));
  assert.ok(canMove("running", "failed_terminal"));
  /* The reconciler putting work back, and a retry that never left the worker. */
  assert.ok(canMove("failed_retryable", "pending"));
  assert.ok(canMove("failed_retryable", "running"));
  /* Attempts running out. */
  assert.ok(canMove("failed_retryable", "failed_terminal"));
  /* A user may skip from anywhere that is not finished. */
  for (const from of ["pending", "running", "failed_retryable"] as ItemStatus[]) {
    assert.ok(canMove(from, "skipped_by_user"), from);
  }
  /* But a failure cannot become a success without running again. */
  assert.equal(canMove("failed_retryable", "succeeded"), false);
});

/* ── What a move records ────────────────────────────────────────────────── */

test("ACCEPTANCE: an attempt is counted on entering running, not on leaving", () => {
  /*
   * An item killed mid-flight never leaves `running`, so an attempt counted
   * on the way out would let it be retried for ever — and "for ever" is the
   * reconciler firing on the same poisonous item at whatever it costs.
   */
  const started = move(item(), "running");
  assert.equal(started.attempt, 1);
  assert.equal(move(started, "succeeded").attempt, 1, "finishing is not another attempt");

  const retried = move(move(started, "failed_retryable"), "running");
  assert.equal(retried.attempt, 2);
  /* A duplicate delivery that re-enters running from running does not count
     twice: two messages for one item is a queue, not two attempts. */
  assert.equal(move(retried, "running").attempt, 2);
});

test("cost accumulates across attempts", () => {
  /*
   * A retry that cost money and then succeeded cost both, and per-job cost is
   * "the most important number in the business". Overwriting would report the
   * last attempt's cost as the item's.
   */
  const a = move(item(), "running", { costUsd: 0.02 });
  const b = move(a, "failed_retryable", { lastErrorClass: "timeout", costUsd: 0.01 });
  const c = move(move(b, "running", { costUsd: 0.02 }), "succeeded");
  assert.ok(Math.abs(c.costUsd - 0.05) < 1e-9, `${c.costUsd}`);
});

test("a success clears the last error; a failure records its class", () => {
  /* An item that failed once and then worked would otherwise read as broken
     for ever on every surface that shows the error. */
  const failed = move(move(item(), "running"), "failed_retryable", { lastErrorClass: "upstream_5xx" });
  assert.equal(failed.lastErrorClass, "upstream_5xx");
  const worked = move(move(failed, "running"), "succeeded");
  assert.equal(worked.lastErrorClass, null);
});

test("the error is a class, not a message", () => {
  /* OPERATIONS.md says `last_error_class`. A message is unaggregatable: you
     cannot ask "how often does quota bite" of free text. */
  const f = fail(move(item(), "running"), "quota");
  assert.equal(f.lastErrorClass, "quota");
  assert.ok(!/ /.test(f.lastErrorClass!), "a class with a space in it is a sentence");
});

test("the provider and the deadline are carried, and a deadline can be cleared", () => {
  const running = move(item(), "running", { provider: "workers-ai", deadlineAt: 1000 });
  assert.equal(running.provider, "workers-ai");
  assert.equal(running.deadlineAt, 1000);
  /* Finishing clears the deadline, or the reconciler keeps finding it. */
  assert.equal(move(running, "succeeded", { deadlineAt: null }).deadlineAt, null);
  /* And a move that says nothing about the deadline leaves it alone. */
  assert.equal(move(running, "failed_retryable", { lastErrorClass: "timeout" }).deadlineAt, 1000);
});

/* ── Failing ────────────────────────────────────────────────────────────── */

test("ACCEPTANCE: attempts are counted here, not by the caller", () => {
  /*
   * A caller deciding for itself whether to retry is a caller that can loop
   * for ever. `fail` asks to retry and is refused once the attempts are spent.
   */
  let it = item();
  for (let n = 1; n <= MAX_ATTEMPTS; n++) {
    it = move(it, "running");
    assert.equal(it.attempt, n);
    it = fail(it, "timeout", { retryable: true });
    assert.equal(it.status, n < MAX_ATTEMPTS ? "failed_retryable" : "failed_terminal", `attempt ${n}`);
  }
  assert.equal(it.status, "failed_terminal");
  assert.equal(MAX_ATTEMPTS, 3);
});

test("a failure that cannot be retried is terminal on the first attempt", () => {
  /* A schema error or a deleted source will fail identically three times. */
  const it = fail(move(item(), "running"), "schema", { retryable: false });
  assert.equal(it.status, "failed_terminal");
  assert.equal(it.attempt, 1);
});

/* ── The completion invariant ───────────────────────────────────────────── */

const items = (...statuses: ItemStatus[]) => statuses.map((status, i) => ({ id: "i" + i, status }));

test("ACCEPTANCE: a job is complete only when every item is terminal", () => {
  const done = completion(items("succeeded", "succeeded", "succeeded"));
  assert.equal(done.complete, true);
  assert.equal(done.allTerminal, true);
  assert.equal(done.why, "every item finished");

  /* One item still owed, whatever the rest did. */
  for (const owed of ["pending", "running", "failed_retryable"] as ItemStatus[]) {
    const c = completion(items("succeeded", "succeeded", owed));
    assert.equal(c.complete, false, owed);
    assert.equal(c.allTerminal, false, owed);
    assert.deepEqual(c.outstanding, ["i2"], owed);
    assert.match(c.why, /still owed/);
  }
});

test("ACCEPTANCE: terminal failures are a partial result until somebody accepts them", () => {
  /*
   * The spec's second half, and it is not a loophole. A degraded result the
   * user accepted is a finished job; a degraded result nobody mentioned is
   * exactly "300 processed, 200 didn't". So acceptance is a parameter rather
   * than a default, and a job with terminal failures reports itself
   * incomplete for ever until a person says otherwise — which is correct.
   */
  const partial = completion(items("succeeded", "succeeded", "failed_terminal"));
  assert.equal(partial.allTerminal, true, "every item HAS stopped");
  assert.equal(partial.complete, false, "and the job is still not complete");
  assert.match(partial.why, /1 of 3 failed for good/);
  assert.match(partial.why, /nobody has accepted it/);

  const accepted = completion(items("succeeded", "succeeded", "failed_terminal"), { degradedAccepted: true });
  assert.equal(accepted.complete, true);
  assert.match(accepted.why, /which you accepted/);
});

test("a skipped item is a finished item", () => {
  /* The user chose it. A skip that blocked completion would make a product
     where declining one thing means never finishing. */
  const c = completion(items("succeeded", "skipped_by_user"));
  assert.equal(c.complete, true);
  assert.match(c.why, /1 you skipped/);
});

test("ACCEPTANCE: a job with no items is not complete", () => {
  /*
   * It is a job whose items were never written — the first thing that goes
   * wrong when this machinery is wired up. "Vacuously true" would hide that
   * behind a green tick, and the user would be handed an empty result
   * labelled finished.
   */
  const c = completion([]);
  assert.equal(c.complete, false);
  assert.equal(c.allTerminal, false);
  assert.match(c.why, /no items/);
  /* Even with acceptance, because there is nothing to have accepted. */
  assert.equal(completion([], { degradedAccepted: true }).complete, false);
});

test("the counts are per status, and they add up", () => {
  /* The per-item UI reads these, and so does "sought 6, found 2". */
  const c = completion(items("succeeded", "succeeded", "failed_terminal", "running", "skipped_by_user"));
  assert.equal(c.counts.succeeded, 2);
  assert.equal(c.counts.failed_terminal, 1);
  assert.equal(c.counts.running, 1);
  assert.equal(c.counts.skipped_by_user, 1);
  assert.equal(c.counts.pending, 0);
  assert.equal(
    ITEM_STATUSES.reduce((n, s) => n + c.counts[s], 0),
    5,
  );
});

test("every completion carries a sentence", () => {
  /* There is no silent completion and no silent incompletion. */
  const cases = [
    completion([]),
    completion(items("running")),
    completion(items("failed_retryable")),
    completion(items("failed_terminal")),
    completion(items("failed_terminal"), { degradedAccepted: true }),
    completion(items("succeeded")),
    completion(items("skipped_by_user")),
  ];
  for (const c of cases) assert.ok(c.why.length > 15, JSON.stringify(c));
});

/* ── The reconciler ─────────────────────────────────────────────────────── */

test("ACCEPTANCE: an item past its deadline is put back", () => {
  /*
   * "A reconciler alarm re-enqueues anything past its deadline. Nothing can
   * disappear." The deadline is what makes a lost item findable: a worker
   * evicted between running and any terminal state leaves a row saying
   * running for ever, with no error anywhere.
   */
  const now = 10_000;
  const r = reconcile(
    [
      { id: "late", status: "running", attempt: 1, deadlineAt: now - 1 },
      { id: "on-time", status: "running", attempt: 1, deadlineAt: now + 1000 },
      { id: "done", status: "succeeded", attempt: 1, deadlineAt: now - 5000 },
    ],
    now,
  );
  assert.deepEqual(r.requeue, ["late"]);
  assert.deepEqual(r.giveUp, []);
});

test("ACCEPTANCE: an item out of attempts is given up on, not re-enqueued", () => {
  /*
   * The alternative is a reconciler putting the same poisonous item back every
   * time it fires, for ever, at whatever that item costs. Giving up is
   * VISIBLE: it makes the job incomplete until somebody accepts the degraded
   * result, which is the honest outcome.
   */
  const now = 10_000;
  const r = reconcile(
    [
      { id: "spent", status: "running", attempt: MAX_ATTEMPTS, deadlineAt: now - 1 },
      { id: "has-one-left", status: "running", attempt: MAX_ATTEMPTS - 1, deadlineAt: now - 1 },
    ],
    now,
  );
  assert.deepEqual(r.giveUp, ["spent"]);
  assert.deepEqual(r.requeue, ["has-one-left"]);
});

test("a failed_retryable item is picked up with or without a deadline", () => {
  /* It is the state that means come back, so the reconciler does not need a
     deadline to know that. */
  const r = reconcile([{ id: "owed", status: "failed_retryable", attempt: 1, deadlineAt: null }], 10_000);
  assert.deepEqual(r.requeue, ["owed"]);
});

test("ACCEPTANCE: an item with no deadline is left alone", () => {
  /*
   * An item nobody promised a time for. Re-enqueueing on a missing deadline
   * would re-enqueue every pending item every time the alarm fires — which
   * on a thousand-clip library is a thousand duplicate messages an hour.
   */
  const r = reconcile(
    [
      { id: "no-deadline-pending", status: "pending", attempt: 0, deadlineAt: null },
      { id: "no-deadline-running", status: "running", attempt: 1, deadlineAt: null },
    ],
    10_000,
  );
  assert.deepEqual(r.requeue, []);
  assert.deepEqual(r.giveUp, []);
});

test("a terminal item is never reconciled, however old its deadline", () => {
  const r = reconcile(
    [
      { id: "a", status: "succeeded", attempt: 1, deadlineAt: 0 },
      { id: "b", status: "failed_terminal", attempt: 3, deadlineAt: 0 },
      { id: "c", status: "skipped_by_user", attempt: 0, deadlineAt: 0 },
    ],
    10_000,
  );
  assert.deepEqual(r, { requeue: [], giveUp: [] });
});

/* ── The content address ────────────────────────────────────────────────── */

test("ACCEPTANCE: the same work has the same key, whatever order it is described in", () => {
  /*
   * "every replay, hedge or duplicate delivery collapses into one stored
   * result." A key that depended on the order a caller happened to build its
   * object in would collapse nothing.
   */
  return Promise.all([
    contentAddress({ asset: "sha-a", directive: "d1", model: "m1", temp: 0 }),
    contentAddress({ temp: 0, model: "m1", directive: "d1", asset: "sha-a" }),
  ]).then(([a, b]) => {
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{64}$/, "a SHA-256, hex");
  });
});

test("ACCEPTANCE: the model and the parameters are part of the key", () => {
  /*
   * THIS IS THE ONE THAT MATTERS. The same hash keys the render cache, so a
   * key that leaves out anything which changes the output serves the wrong
   * stored result — worse than doing the work twice, because it is silent and
   * it is wrong. A prompt change over the same footage is different work.
   */
  return Promise.all([
    contentAddress({ asset: "sha-a", directive: "d1", model: "m1" }),
    contentAddress({ asset: "sha-a", directive: "d1", model: "m2" }),
    contentAddress({ asset: "sha-a", directive: "d2", model: "m1" }),
    contentAddress({ asset: "sha-b", directive: "d1", model: "m1" }),
  ]).then((keys) => {
    assert.equal(new Set(keys).size, 4, "four different pieces of work, four keys");
  });
});

test("ACCEPTANCE: two values cannot run together into one", () => {
  /*
   * "ab" + "c" and "a" + "bc" must not hash the same, or two unrelated pieces
   * of work share a cache entry. The separators are characters that cannot
   * appear in a hash, an id or a model name.
   */
  return Promise.all([
    contentAddress({ a: "ab", b: "c" }),
    contentAddress({ a: "a", b: "bc" }),
    contentAddress({ ab: "c" }),
    contentAddress({ a: "abc" }),
  ]).then((keys) => assert.equal(new Set(keys).size, 4, JSON.stringify(keys)));
});

test("absent and empty are not the same thing", () => {
  /* A parameter nobody set and a parameter set to "" are different work, and
     undefined is dropped rather than stringified into "undefined". */
  return Promise.all([
    contentAddress({ a: "x" }),
    contentAddress({ a: "x", b: undefined }),
    contentAddress({ a: "x", b: null }),
    contentAddress({ a: "x", b: "" }),
  ]).then(([plain, undef, nul, empty]) => {
    assert.equal(plain, undef, "an unset parameter is not part of the work");
    assert.equal(plain, nul);
    assert.notEqual(plain, empty, "a parameter set to empty IS part of the work");
  });
});

test("booleans and numbers key distinctly", () => {
  return Promise.all([
    contentAddress({ diarize: true }),
    contentAddress({ diarize: false }),
    contentAddress({ diarize: 1 }),
  ]).then((keys) => assert.equal(new Set(keys).size, 3, JSON.stringify(keys)));
});

/* ── The table it lives in ──────────────────────────────────────────────── */

test("ACCEPTANCE: the idempotency key is unique in the table", () => {
  /*
   * The key is a content address and the same hash keys the render cache, so
   * UNIQUE is not tidiness. Two rows with one key is the cache miss that
   * costs twice; one key covering different work is the cache hit that
   * answers wrongly. The constraint is what turns the second into an error
   * instead of a wrong answer.
   *
   * Read out of migrations/schema.sql, which the fidelity gate guarantees
   * matches the schema that runs, rather than retyped here where it could be
   * retyped wrong in the same direction as the bug.
   */
  const sql = readFileSync(join(import.meta.dirname, "..", "migrations", "schema.sql"), "utf8");
  const ddl = sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(";")
    /* ANCHORED ON THE OPENING PAREN. Without it the pattern is a prefix
       match, so a table renamed to `job_items_renamed` satisfies it and every
       assertion below passes against a table nothing reads. The same prefix
       trap bit the XML reader. */
    .find((s) => /create table if not exists job_items\s*\(/i.test(s));
  assert.ok(ddl, "there is no job_items table — run `npm run schema`");

  assert.match(ddl, /idempotency_key\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i);
  /* Every column the spec names. */
  for (const column of [
    "status",
    "attempt",
    "last_error_class",
    "provider",
    "cost_usd",
    "idempotency_key",
    "deadline_at",
  ]) {
    assert.match(ddl, new RegExp("\\b" + column + "\\b"), `job_items has no ${column}`);
  }
  /* An item belongs to a job, or nothing can ask whether that job is done. */
  assert.match(ddl, /job_id\s+TEXT\s+NOT\s+NULL\s+REFERENCES\s+jobs\(id\)/i);
  /* And it starts pending: an item that defaulted to anything else would be
     born outside the state machine. */
  assert.match(ddl, /status\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+'pending'/i);
});

test("the reconciler has an index to read, not a table to scan", () => {
  /*
   * Its query is "everything owed, oldest deadline first", on an alarm. A scan
   * of every item ever written gets slower every day the product runs, and the
   * alarm is the thing that must not start timing out — it is what makes a
   * lost item findable at all.
   */
  const sql = readFileSync(join(import.meta.dirname, "..", "migrations", "schema.sql"), "utf8");
  assert.match(sql, /CREATE INDEX IF NOT EXISTS job_items_owed ON job_items\(status, deadline_at\)/i);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS job_items_by_job ON job_items\(job_id, status\)/i);
});
