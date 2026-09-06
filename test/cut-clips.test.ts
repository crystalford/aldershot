/**
 * What counts as material you can build with.
 *
 * `kept` used to decide two unrelated things — whether a moment is one you
 * want, and what was in your cut — so keeping a Clipping short changed an
 * edit's runtime. A cut is its blocks now, and the only remaining question
 * this query answers is which clips you can put INTO one.
 *
 * The shipped SQL is lifted out of the source, so the test cannot pass against
 * a copy that has drifted from what runs.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

function cutClipsQuery(): string {
  const src = readFileSync(join(import.meta.dirname, "..", "src", "projects.ts"), "utf8");
  const m = /export async function cutClips[\s\S]*?\.prepare\(\s*`([\s\S]*?)`/.exec(src);
  assert.ok(m, "couldn't find cutClips' query in src/projects.ts");
  return m[1];
}

function run(): string[] {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE v2_clips(id TEXT PRIMARY KEY, user_id TEXT, source_id TEXT,
      start_ms INTEGER, origin TEXT, kept INTEGER, deleted_at INTEGER);
  `);
  const ins = db.prepare(`INSERT INTO v2_clips VALUES(?,?,?,?,?,?,?)`);
  const rows: Array<[string, string, string, number, string, number, number | null]> = [
    // id, user, source, start_ms, origin, kept, deleted_at
    ["editor", "U1", "S1", 1000, "editor", 1, null],
    ["manual", "U1", "S1", 2000, "manual", 1, null],
    ["short", "U1", "S1", 3000, "clipping", 1, null],
    ["dropped", "U1", "S1", 4000, "editor", 0, null],
    ["binned", "U1", "S1", 5000, "editor", 1, 123],
    ["elsewhere", "U1", "S2", 6000, "editor", 1, null],
    ["notmine", "U2", "S1", 7000, "editor", 1, null],
  ];
  for (const r of rows) ins.run(...r);

  return (db.prepare(cutClipsQuery()).all("S1", "U1") as Array<{ id: string }>).map((r) => r.id);
}

test("a finished short is never offered back as material for a cut", () => {
  assert.ok(!run().includes("short"), "a 9:16 export of a block cannot go inside the cut it came from");
});

test("everything else on that source, in time order", () => {
  assert.deepEqual(run(), ["editor", "manual", "dropped"]);
});

test("kept is not the filter — a dropped clip is still material", () => {
  assert.ok(
    run().includes("dropped"),
    "kept means 'a moment I want', which is a different question from 'can I build with it'",
  );
});

test("never another account's rows, another source's, or a binned one", () => {
  const ids = run();
  for (const id of ["notmine", "elsewhere", "binned"]) assert.ok(!ids.includes(id), id);
});
