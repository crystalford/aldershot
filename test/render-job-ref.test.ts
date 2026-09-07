/**
 * A render's job is about the render.
 *
 * It used to carry the PROJECT id, and three separate pieces of code join
 * jobs.ref_id to renders.id. All three matched nothing, silently, for the
 * life of the feature:
 *
 *   listRenders            — the export panel's live stage label
 *   secondsPerOutputSecond — "about a minute left"
 *   reapStaleJobs          — closing out the renders ROW when its job dies
 *
 * The third is why an export could sit on "putting it together" indefinitely
 * while every reaper in the system ran past it, and why the owner watched 30%
 * for hours and was told, twice, that it was probably the deploy.
 *
 * Nothing announced any of it, because a join that matches nothing looks
 * exactly like a feature with nothing to say. These are the assertions that
 * would have.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { fakeD1, schema } from "./helpers/fake-d1.ts";
import { listRenders } from "../src/render-job.ts";
import { secondsPerOutputSecond } from "../src/jobs.ts";

function world() {
  const db = new DatabaseSync(":memory:");
  schema(db);
  db.prepare(`INSERT INTO v2_projects (id,user_id,title,kind,created_at) VALUES ('p1','u1','The Cut','cut',1)`).run();
  return { db, d1: fakeD1(db) as never };
}

const addRender = (
  db: DatabaseSync,
  id: string,
  o: { state?: string; duration?: number | null; created?: number } = {},
) =>
  db
    .prepare(
      `INSERT INTO renders (id,project_id,user_id,kind,format,aspect,duration_s,state,created_at)
       VALUES (?, 'p1','u1','cut','mp4_1080','16:9',?,?,?)`,
    )
    .run(id, o.duration ?? 60, o.state ?? "running", o.created ?? Date.now());

const addJob = (
  db: DatabaseSync,
  id: string,
  refId: string,
  o: { state?: string; stage?: string; started?: number; finished?: number } = {},
) =>
  db
    .prepare(
      `INSERT INTO jobs (id,user_id,type,ref_id,state,pct,stage_label,started_at,finished_at,created_at)
       VALUES (?, 'u1','render',?,?,30,?,?,?,?)`,
    )
    .run(id, refId, o.state ?? "running", o.stage ?? "putting it together", o.started ?? 1000, o.finished ?? null, o.started ?? 1000);

test("the export panel can see what the encoder is doing", async () => {
  const w = world();
  addRender(w.db, "r1");
  addJob(w.db, "j1", "r1", { stage: "cutting — 3 of 9" });

  const [row] = await listRenders(w.d1, "p1", "u1");
  assert.equal(
    (row as { stage_label?: string }).stage_label,
    "cutting — 3 of 9",
    "the panel could not find the job for its own render",
  );
});

test("a job pointing at the project is not this render's job", async () => {
  /* The old shape, asserted as broken so nobody restores it thinking it was
     fine. The panel would show a stage belonging to whichever render happened
     to share the project. */
  const w = world();
  addRender(w.db, "r1");
  addJob(w.db, "j1", "p1", { stage: "cutting — 3 of 9" });

  const [row] = await listRenders(w.d1, "p1", "u1");
  assert.equal((row as { stage_label?: string }).stage_label, undefined);
});

test("an estimate becomes possible once three renders have finished", async () => {
  /*
   * This could never have returned a number: it joins renders to jobs on
   * ref_id, and no render job has ever carried a render id. Every export in
   * this product's history showed no time remaining for that reason alone.
   */
  const w = world();
  for (let i = 0; i < 4; i++) {
    const id = `r${i}`;
    addRender(w.db, id, { state: "ready", duration: 60 });
    /* Two minutes of encoding for sixty seconds of video: a rate of 2. */
    addJob(w.db, `j${i}`, id, { state: "ready", started: 0, finished: 120_000 });
  }

  const rate = await secondsPerOutputSecond(w.d1, "u1", "render");
  assert.equal(rate, 2, "the estimate still has nothing to learn from");
});

test("two fewer than three is still no estimate", async () => {
  /* An estimate from one sample is a guess wearing a number. */
  const w = world();
  for (let i = 0; i < 2; i++) {
    addRender(w.db, `r${i}`, { state: "ready", duration: 60 });
    addJob(w.db, `j${i}`, `r${i}`, { state: "ready", started: 0, finished: 120_000 });
  }
  assert.equal(await secondsPerOutputSecond(w.d1, "u1", "render"), null);
});

test("a finished render is left alone by the panel's enrichment", async () => {
  const w = world();
  addRender(w.db, "r1", { state: "ready" });
  addJob(w.db, "j1", "r1", { state: "ready" });
  const [row] = await listRenders(w.d1, "p1", "u1");
  assert.equal(row.state, "ready");
  assert.equal((row as { stage_label?: string }).stage_label, undefined, "a finished export claimed a stage");
});
