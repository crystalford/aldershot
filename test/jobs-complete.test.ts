/**
 * INVARIANT 7, AT THE PLACE THAT DECIDES.
 *
 * "A job is complete only when every item is terminal and none failed
 * silently. Silent partial failure is a P1."
 *
 * src/items.ts has held the whole machine since Scout was built — statuses,
 * legal moves, completion(), the reconciler — and finishJob consulted none of
 * it. It wrote state='ready', pct=100 whatever had happened, for every job
 * type in the product. The rule was declared in one file and enforced in
 * another that only Scout called.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { ITEM_TRACKED_JOB_TYPES, finishJob } from "../src/jobs.ts";
import { ITEM_STATUSES, type ItemStatus } from "../src/items.ts";

/** The two real tables, from the real schema. */
function db() {
  const d = new DatabaseSync(":memory:");
  d.exec(`CREATE TABLE jobs (id TEXT PRIMARY KEY, user_id TEXT, type TEXT NOT NULL,
    ref_id TEXT, state TEXT NOT NULL DEFAULT 'queued', pct INTEGER NOT NULL DEFAULT 0,
    stage_label TEXT, queued_overnight INTEGER NOT NULL DEFAULT 0, error TEXT,
    started_at INTEGER, finished_at INTEGER, created_at INTEGER NOT NULL)`);
  d.exec(`CREATE TABLE job_items (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, kind TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', attempt INTEGER NOT NULL DEFAULT 0,
    last_error_class TEXT, provider TEXT, cost_usd REAL NOT NULL DEFAULT 0,
    idempotency_key TEXT NOT NULL UNIQUE, deadline_at INTEGER,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);

  const api = {
    prepare: (sql: string) => ({
      bind: (...b: unknown[]) => ({
        run: async () => { d.prepare(sql).run(...(b as never[])); },
        all: async () => ({ results: d.prepare(sql).all(...(b as never[])) }),
        first: async () => d.prepare(sql).get(...(b as never[])) ?? null,
      }),
    }),
  } as never;
  return { d, api };
}

const addJob = (d: DatabaseSync, id: string, type: string) =>
  d.prepare(`INSERT INTO jobs (id,user_id,type,state,created_at) VALUES (?,?,?,'running',1)`).run(id, "u1", type);

const addItem = (d: DatabaseSync, jobId: string, id: string, status: ItemStatus) =>
  d.prepare(
    `INSERT INTO job_items (id,job_id,kind,status,idempotency_key,created_at,updated_at)
     VALUES (?,?,?,?,?,1,1)`,
  ).run(id, jobId, "unit", status, `${jobId}:${id}`);

const stateOf = (d: DatabaseSync, id: string) =>
  d.prepare(`SELECT state, error FROM jobs WHERE id=?`).get(id) as { state: string; error: string | null };

test("ACCEPTANCE: a job with an item still running does not become ready", () => {
  /* The silent partial result the invariant is about: a green tick over nine
     of ten, found by the person who went looking for the tenth. */
  const { d, api } = db();
  addJob(d, "j1", "render");
  addItem(d, "j1", "a", "succeeded");
  addItem(d, "j1", "b", "running");

  return finishJob(api, "j1").then((done) => {
    assert.equal(done.complete, false);
    assert.match(done.why, /1 of 2 item is still owed/);
    const row = stateOf(d, "j1");
    assert.equal(row.state, "failed", "it was marked ready with work outstanding");
    assert.match(row.error ?? "", /still owed/, "and it says what is owed");
  });
});

test("ACCEPTANCE: one item failed for good is not a finished job", () => {
  const { d, api } = db();
  addJob(d, "j2", "render");
  addItem(d, "j2", "a", "succeeded");
  addItem(d, "j2", "b", "failed_terminal");

  return finishJob(api, "j2").then((done) => {
    assert.equal(done.complete, false);
    assert.match(done.why, /failed for good/);
    assert.match(done.why, /nobody has accepted it/);
    assert.equal(stateOf(d, "j2").state, "failed");
  });
});

test("unless somebody accepted the degraded result, which is the spec's other half", () => {
  /* A partial result the user chose is a finished job; a partial result
     nobody mentioned is the thing being prevented. Never a default. */
  const { d, api } = db();
  addJob(d, "j3", "render");
  addItem(d, "j3", "a", "succeeded");
  addItem(d, "j3", "b", "failed_terminal");

  return finishJob(api, "j3", { degradedAccepted: true }).then((done) => {
    assert.equal(done.complete, true);
    assert.match(done.why, /which you accepted/);
    assert.equal(stateOf(d, "j3").state, "ready");
  });
});

test("every item terminal and none failed is ready, and says so", () => {
  const { d, api } = db();
  addJob(d, "j4", "render");
  addItem(d, "j4", "a", "succeeded");
  addItem(d, "j4", "b", "skipped_by_user");

  return finishJob(api, "j4").then((done) => {
    assert.equal(done.complete, true);
    assert.equal(stateOf(d, "j4").state, "ready");
    assert.match(done.why, /you skipped/);
  });
});

test("ACCEPTANCE: a job type that is supposed to track items and wrote none fails", () => {
  /*
   * The first thing that goes wrong when this machinery is wired up is items
   * that were never written. completion() refuses to call that vacuously
   * complete, and this is where its refusal reaches the row.
   */
  const { d, api } = db();
  addJob(d, "j5", "tracked-in-test");
  return finishJob(api, "j5", { trackedTypes: ["tracked-in-test"] }).then((done) => {
    assert.equal(done.complete, false);
    assert.match(done.why, /no items/);
    assert.equal(stateOf(d, "j5").state, "failed");
  });
});

test("a job type that does not track items yet finishes as it always did", async () => {
  /*
   * THE FIRST VERSION OF THIS FILE HAD THE DEFAULT BACKWARDS.
   *
   * It listed the types believed not to track items and enforced the rule on
   * everything else — and the list was written from memory, so render, judge,
   * take, pass, shorts and probe were all missing from it and every one of
   * them would have failed. A rule whose blast radius depends on somebody
   * having remembered every job type is a rule that breaks production to
   * protect it.
   */
  for (const type of ["render", "judge", "take", "pass", "shorts", "probe", "transcribe", "align"]) {
    const { d, api } = db();
    addJob(d, `k-${type}`, type);
    const done = await finishJob(api, `k-${type}`);
    assert.equal(done.complete, true, `${type} did not finish`);
    assert.match(done.why, /does not track items yet/);
    assert.equal(stateOf(d, `k-${type}`).state, "ready");
  }
});

test("the opt-in list only grows, and growing is progress", () => {
  /*
   * Empty today: no handler writes items through this path yet, and Scout
   * calls completion() directly without ever coming here. Pinned so that
   * adding a type is a deliberate act with an argument behind it — and so
   * that the day it stops being empty is visible in a diff.
   */
  assert.deepEqual([...ITEM_TRACKED_JOB_TYPES], []);
});

test("every status the machine has is counted, so a new one cannot hide", () => {
  /* counts is keyed by ITEM_STATUSES. A status added to the machine and not
     to the counter would be invisible to completion(). */
  const { d, api } = db();
  addJob(d, "j6", "render");
  addItem(d, "j6", "a", "succeeded");
  return finishJob(api, "j6").then((done) => {
    assert.deepEqual(Object.keys(done.counts).sort(), [...ITEM_STATUSES].sort());
  });
});
