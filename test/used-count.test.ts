/**
 * "USED IN N EDITS" — a string that could not appear.
 *
 * `v2_clips.used_count` exists, defaults to 0, and was never once
 * incremented, so the footage card's line about it was unreachable however
 * much somebody cut with their footage.
 *
 * A COUNTER WOULD HAVE BEEN THE WRONG FIX. Invariant 1: a cut is re-produced
 * from rules and moments, never stored as an outcome. A number incremented
 * when a moment entered a cut cannot answer the question once a rule is
 * switched off, and cannot be put back when an edit is deleted — which is
 * the acceptance test 21-LIBRARIAN-BUILD-SPEC.md holds this to, and the
 * reason the spec's own wording ("increment") is overridden here.
 *
 * Derived off the beats, it is simply true.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fakeD1 } from "./helpers/fake-d1.ts";
import { listMoments } from "../src/library.ts";

function world() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE sources (id TEXT PRIMARY KEY, user_id TEXT, title TEXT, r2_key TEXT,
             proxy_r2_key TEXT, deleted_at INTEGER)`);
  db.exec(`CREATE TABLE v2_clips (id TEXT PRIMARY KEY, user_id TEXT, source_id TEXT,
             start_ms INTEGER, end_ms INTEGER, quote TEXT, why TEXT, score INTEGER, heat INTEGER,
             frame_r2_key TEXT, kept INTEGER, origin TEXT, used_count INTEGER,
             created_at INTEGER, deleted_at INTEGER)`);
  db.exec(`CREATE TABLE v2_projects (id TEXT PRIMARY KEY, user_id TEXT)`);
  db.exec(`CREATE TABLE beats (id TEXT PRIMARY KEY, project_id TEXT, idx INTEGER, kind TEXT,
             act TEXT, clip_id TEXT, text TEXT, struck TEXT, dur_ms INTEGER,
             media_r2_key TEXT, recorded_at INTEGER)`);
  db.exec(`CREATE TABLE renders (id TEXT PRIMARY KEY, clip_id TEXT, state TEXT, r2_key TEXT,
             created_at INTEGER)`);
  db.exec(`CREATE TABLE v2_threads (id TEXT PRIMARY KEY, name TEXT)`);
  db.exec(`CREATE TABLE v2_clip_threads (clip_id TEXT, thread_id TEXT, confidence REAL)`);

  db.prepare(`INSERT INTO sources VALUES ('src1','u1','A video','k.mp4',NULL,NULL)`).run();
  for (const id of ["c1", "c2"]) {
    db.prepare(
      `INSERT INTO v2_clips (id,user_id,source_id,start_ms,end_ms,quote,why,score,heat,
         frame_r2_key,kept,origin,used_count,created_at,deleted_at)
       VALUES (?, 'u1','src1',0,5000,'words',NULL,NULL,NULL,'',1,'read',0,1,NULL)`,
    ).run(id);
  }

  const useIn = (project: string, clip: string, idx = 0) => {
    db.prepare(`INSERT OR IGNORE INTO v2_projects VALUES (?, 'u1')`).run(project);
    db.prepare(
      `INSERT INTO beats (id, project_id, idx, kind, clip_id) VALUES (?, ?, ?, 'clip', ?)`,
    ).run(project + "-" + clip + "-" + idx, project, idx, clip);
  };
  const dropCut = (project: string) =>
    db.prepare(`DELETE FROM beats WHERE project_id = ?`).run(project);

  const countFor = async (clip: string) => {
    const ms = await listMoments(fakeD1(db) as never, "u1");
    return ms.find((m) => m.id === clip)!.used_count;
  };
  return { useIn, dropCut, countFor };
}

test("ACCEPTANCE: a moment nothing has cut with reads zero, not a stale number", async () => {
  const w = world();
  assert.equal(await w.countFor("c1"), 0);
});

test("ACCEPTANCE: a moment used in two edits counts two", async () => {
  const w = world();
  w.useIn("p1", "c1");
  w.useIn("p2", "c1");
  assert.equal(await w.countFor("c1"), 2);
  assert.equal(await w.countFor("c2"), 0, "the count leaked onto a moment nothing used");
});

test("ACCEPTANCE: deleting an edit puts the moment back", async () => {
  /*
   * The test a counter cannot pass, and the reason this is derived. A cut is
   * worked out from rules every time (invariant 1), so "used in" has to be a
   * question asked now rather than a tally kept since.
   */
  const w = world();
  w.useIn("p1", "c1");
  w.useIn("p2", "c1");
  assert.equal(await w.countFor("c1"), 2);

  w.dropCut("p2");
  assert.equal(await w.countFor("c1"), 1, "the count did not come back down");

  w.dropCut("p1");
  assert.equal(await w.countFor("c1"), 0);
});

test("one edit using a moment twice is one edit, not two", async () => {
  /* A montage can hold the same moment at two points. "Used in 2 edits" would
     then be a lie about how many videos it is in. COUNT(DISTINCT project_id). */
  const w = world();
  w.useIn("p1", "c1", 0);
  w.useIn("p1", "c1", 1);
  assert.equal(await w.countFor("c1"), 1);
});

test("the stored column is not what is read", () => {
  /*
   * Belt and braces against the obvious regression: somebody re-selects
   * c.used_count because it is right there in the table, and the line goes
   * dead again without any test noticing, because a fixture that happens to
   * store the right number would agree with the derivation.
   */
  const src = readFileSync(join(import.meta.dirname, "..", "src", "library.ts"), "utf8");
  const select = src.slice(src.indexOf("const SELECT_MOMENTS"), src.indexOf("FROM v2_clips c"));
  assert.ok(
    !/\bc\.used_count\b/.test(select.replace(/\/\*[\s\S]*?\*\//g, " ")),
    "the dead column is being selected again",
  );
  assert.match(select, /COUNT\(DISTINCT b\.project_id\) FROM beats b WHERE b\.clip_id = c\.id/);
});

test("a stored number that disagrees with the beats does not win", async () => {
  /* The derivation is the answer even when the column says otherwise — which
     it will, for every row written before today. */
  const w = world();
  w.useIn("p1", "c1");
  assert.equal(await w.countFor("c1"), 1);
});
