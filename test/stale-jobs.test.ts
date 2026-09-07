/**
 * A job that stops without saying so, and the thing it was making.
 *
 * "it's also been stuck at 30% for a long time now so i suspect something is
 * wrong.. this is the first export i've ever tried."
 *
 * 30% is the line before the encoder is called. Two things kept it there: the
 * call had no deadline, so a container that never answers is waited on for
 * ever; and the reaper's patience was three hours for everything, chosen for a
 * feature-length transcribe.
 *
 * Worse, the reaper only ever touched `jobs`. The export strip reads
 * renders.state, so a job could be dead for hours while the row still said
 * "putting it together" — a spinner with no error anywhere behind it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { advance, reapStaleJobs } from "../src/jobs.ts";

function d1(db: DatabaseSync): never {
  return {
    prepare(sql: string) {
      const stmt = db.prepare(sql);
      let args: unknown[] = [];
      const api = {
        bind(...a: unknown[]) { args = a; return api; },
        async run() { stmt.run(...(args as never[])); return { success: true }; },
        async all<T>() { return { results: stmt.all(...(args as never[])) as T[] }; },
        async first<T>() { return (stmt.get(...(args as never[])) ?? null) as T | null; },
      };
      return api;
    },
  } as never;
}

const MIN = 60 * 1000;

function world(jobs: Array<{ id: string; type: string; ref: string; agoMin: number }>) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE jobs (id TEXT PRIMARY KEY, user_id TEXT, type TEXT, ref_id TEXT,
            state TEXT, pct INTEGER DEFAULT 0, stage_label TEXT, error TEXT,
            started_at INTEGER, finished_at INTEGER, created_at INTEGER)`);
  /* created_at, because a render row is now reaped on its OWN age as well as
     through its job — see the second statement in reapStaleJobs. */
  db.exec(`CREATE TABLE renders (id TEXT PRIMARY KEY, user_id TEXT, state TEXT, error TEXT, created_at INTEGER)`);
  db.exec(`CREATE TABLE sources (id TEXT PRIMARY KEY, user_id TEXT, transcript_state TEXT)`);
  const now = Date.now();
  for (const j of jobs) {
    db.prepare(`INSERT INTO jobs VALUES (?,?,?,?,'running',0,NULL,NULL,?,NULL,?)`)
      .run(j.id, "u1", j.type, j.ref, now - j.agoMin * MIN, now - j.agoMin * MIN);
    db.prepare(`INSERT OR IGNORE INTO renders VALUES (?,?,'running',NULL,?)`).run(j.ref, "u1", now - j.agoMin * MIN);
    db.prepare(`INSERT OR IGNORE INTO sources VALUES (?,?,'running')`).run(j.ref, "u1");
  }
  return {
    db,
    job: (id: string) => (db.prepare(`SELECT state FROM jobs WHERE id=?`).get(id) as { state: string }).state,
    render: (id: string) => (db.prepare(`SELECT state, error FROM renders WHERE id=?`).get(id) as { state: string; error: string | null }),
    source: (id: string) => (db.prepare(`SELECT transcript_state FROM sources WHERE id=?`).get(id) as { transcript_state: string }).transcript_state,
  };
}

test("a render silent for 40 minutes is declared dead", async () => {
  const w = world([{ id: "j1", type: "render", ref: "r1", agoMin: 40 }]);
  await reapStaleJobs(d1(w.db), "u1");
  assert.equal(w.job("j1"), "failed");
});

test("and the export row learns about it, which is what the strip reads", async () => {
  /* The whole reason it span for ever: the job died and the render did not
     hear. */
  const w = world([{ id: "j1", type: "render", ref: "r1", agoMin: 40 }]);
  await reapStaleJobs(d1(w.db), "u1");
  const r = w.render("r1");
  assert.equal(r.state, "failed");
  assert.ok(r.error, "a failed export with no reason is still a dead end");
});

test("a render five minutes in is left alone", async () => {
  const w = world([{ id: "j1", type: "render", ref: "r1", agoMin: 5 }]);
  await reapStaleJobs(d1(w.db), "u1");
  assert.equal(w.job("j1"), "running");
  assert.equal(w.render("r1").state, "running");
});

test("a transcribe still gets its long patience", async () => {
  /* Three hours was right for this and wrong for everything else. An hour in,
     a feature-length read is still working. */
  const w = world([{ id: "j1", type: "transcribe", ref: "s1", agoMin: 60 }]);
  await reapStaleJobs(d1(w.db), "u1");
  assert.equal(w.job("j1"), "running");
  assert.equal(w.source("s1"), "running");
});

test("a transcribe dead for four hours takes its video down with it", async () => {
  const w = world([{ id: "j1", type: "transcribe", ref: "s1", agoMin: 240 }]);
  await reapStaleJobs(d1(w.db), "u1");
  assert.equal(w.job("j1"), "failed");
  assert.equal(w.source("s1"), "failed", "the card would still say it was reading");
});

test("each type is judged on its own clock, in one pass", async () => {
  const w = world([
    { id: "j1", type: "render", ref: "r1", agoMin: 40 },
    { id: "j2", type: "tts", ref: "r2", agoMin: 12 },
    { id: "j3", type: "transcribe", ref: "s3", agoMin: 40 },
  ]);
  await reapStaleJobs(d1(w.db), "u1");
  assert.equal(w.job("j1"), "failed", "render: 30 minutes");
  assert.equal(w.job("j2"), "failed", "tts: 10 minutes");
  assert.equal(w.job("j3"), "running", "transcribe: three hours");
});


/**
 * A render row that nothing points at.
 *
 * For most of this product's life a render's job carried the PROJECT id, so
 * the statement that closes out a renders row — which looks for a job whose
 * ref_id is the render — matched nothing, ever. An export that died sat on
 * "putting it together" indefinitely and every reaper in the system ran past
 * it. The join is fixed, but a row must not depend on a join to stop lying,
 * so age alone is enough.
 */
test("an old render row is closed out with no job pointing at it", async () => {
  const w = world([]);
  const old = Date.now() - 45 * MIN;
  w.db.prepare(`INSERT INTO renders VALUES ('r-orphan','u1','running',NULL,?)`).run(old);

  await reapStaleJobs(d1(w.db), "u1");

  assert.equal(w.render("r-orphan").state, "failed", "a row nothing points at stayed on running for ever");
  assert.match(w.render("r-orphan").error ?? "", /stopped partway/);
});

test("a young render row with no job is left alone", async () => {
  /* It may be five minutes into a perfectly healthy encode. */
  const w = world([]);
  w.db.prepare(`INSERT INTO renders VALUES ('r-young','u1','running',NULL,?)`).run(Date.now() - 5 * MIN);
  await reapStaleJobs(d1(w.db), "u1");
  assert.equal(w.render("r-young").state, "running");
});

test("a finished render is never touched by age", async () => {
  /* The one thing this must not do is throw away a video the user has. */
  const w = world([]);
  w.db.prepare(`INSERT INTO renders VALUES ('r-done','u1','ready',NULL,?)`).run(Date.now() - 300 * MIN);
  await reapStaleJobs(d1(w.db), "u1");
  assert.equal(w.render("r-done").state, "ready");
});


/**
 * Stop has to win the race against work already in flight.
 *
 * `advance` set state='running' unconditionally, so the sequence was: the user
 * presses Stop, the row says failed, the encode's next progress write lands
 * and says running again, and the poll that was about to give up sees a live
 * job and keeps encoding. The user watches a render they stopped carry on.
 */
test("a stopped job is not resurrected by work still in flight", async () => {
  const w = world([{ id: "j1", type: "render", ref: "r1", agoMin: 1 }]);
  w.db.prepare(`UPDATE jobs SET state='failed', error='You stopped this.' WHERE id='j1'`).run();

  await advance(d1(w.db), "j1", 60, "cutting — 6 of 9");

  assert.equal(w.job("j1"), "failed", "a progress write put a stopped job back to running");
});

test("a finished job is not dragged back by a late write either", async () => {
  const w = world([{ id: "j1", type: "render", ref: "r1", agoMin: 1 }]);
  w.db.prepare(`UPDATE jobs SET state='ready', pct=100 WHERE id='j1'`).run();
  await advance(d1(w.db), "j1", 80, "saving it");
  assert.equal(w.job("j1"), "ready");
});

test("a running job still advances normally", async () => {
  const w = world([{ id: "j1", type: "render", ref: "r1", agoMin: 1 }]);
  await advance(d1(w.db), "j1", 55, "cutting");
  assert.equal(w.job("j1"), "running");
  assert.equal(
    (w.db.prepare(`SELECT pct FROM jobs WHERE id='j1'`).get() as { pct: number }).pct,
    55,
  );
});
