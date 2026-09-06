/**
 * The duplicate-edit reap, run against real SQLite.
 *
 * This is a destructive UPDATE against the user's own edits, so it is not
 * enough to read it and believe it. The query is pulled out of the source and
 * executed here, so what is tested is the SQL that actually ships rather than
 * a copy that can drift away from it.
 *
 * The rule under test is deliberately timid: an untouched, unbriefed, unnamed
 * duplicate goes; anything the user has touched stays, even when it looks
 * like a duplicate.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/** The shipped query, lifted from the source so the two cannot diverge. */
function reapQuery(): string {
  /* import.meta.dirname rather than a URL: the Workers URL global shadows
     Node's here, and fs will not take it. */
  const src = readFileSync(join(import.meta.dirname, "..", "src", "projects.ts"), "utf8");
  const m = /reapDuplicateEdits[\s\S]*?\.prepare\(\s*`([\s\S]*?)`/.exec(src);
  assert.ok(m, "couldn't find reapDuplicateEdits' query in src/projects.ts");
  return m[1];
}

interface Row {
  id: string;
  user: string;
  title: string;
  source: string;
  brief: string;
  cuts: string | null;
  updated: number;
}

const ROWS: Row[] = [
  { id: "dup1", user: "U1", title: "Untitled cut", source: "S1", brief: "", cuts: null, updated: 100 },
  { id: "dup2", user: "U1", title: "Untitled cut", source: "S1", brief: "", cuts: "[]", updated: 200 },
  { id: "dup3", user: "U1", title: "Untitled cut", source: "S1", brief: "", cuts: null, updated: 300 },
  { id: "worked", user: "U1", title: "Untitled cut", source: "S1", brief: "", cuts: '[{"seg":2,"words":null}]', updated: 150 },
  { id: "hasbeats", user: "U1", title: "Untitled cut", source: "S1", brief: "", cuts: null, updated: 120 },
  { id: "briefed", user: "U1", title: "a supercut", source: "S1", brief: "a supercut", cuts: null, updated: 90 },
  { id: "other", user: "U1", title: "Untitled cut", source: "S2", brief: "", cuts: null, updated: 80 },
  { id: "named", user: "U1", title: "My rough cut", source: "S1", brief: "", cuts: null, updated: 70 },
  { id: "otheruser", user: "U2", title: "Untitled cut", source: "S1", brief: "", cuts: null, updated: 60 },
];

function run(): { reaped: string[]; kept: string[] } {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE v2_projects(id TEXT PRIMARY KEY, user_id TEXT, title TEXT, kind TEXT,
      source_id TEXT, brief TEXT, cuts TEXT, updated_at INTEGER, deleted_at INTEGER, archived_at INTEGER);
    CREATE TABLE beats(id TEXT PRIMARY KEY, project_id TEXT);
    CREATE TABLE renders(id TEXT PRIMARY KEY, project_id TEXT);
  `);

  const ins = db.prepare(
    `INSERT INTO v2_projects VALUES(?,?,?,'cut',?,?,?,?,NULL,NULL)`,
  );
  for (const r of ROWS) ins.run(r.id, r.user, r.title, r.source, r.brief, r.cuts, r.updated);
  db.prepare(`INSERT INTO beats VALUES('b1','hasbeats')`).run();

  db.prepare(reapQuery()).run(Date.now(), "U1");

  const ids = (sql: string) =>
    (db.prepare(sql).all() as Array<{ id: string }>).map((r) => r.id).sort();
  return {
    reaped: ids(`SELECT id FROM v2_projects WHERE deleted_at IS NOT NULL`),
    kept: ids(`SELECT id FROM v2_projects WHERE deleted_at IS NULL`),
  };
}

test("collapses untouched duplicate edits down to the newest one", () => {
  const { reaped, kept } = run();
  assert.deepEqual(reaped, ["dup1", "dup2"]);
  assert.ok(kept.includes("dup3"), "the newest untouched edit is the one that survives");
});

test("never reaps an edit the user has actually worked on", () => {
  const { kept } = run();
  for (const id of ["worked", "hasbeats", "briefed", "named"]) {
    assert.ok(kept.includes(id), `${id} holds work and must survive`);
  }
});

test("never reaps a lone edit, or another account's", () => {
  const { kept } = run();
  assert.ok(kept.includes("other"), "the only edit of a source is not a duplicate");
  assert.ok(kept.includes("otheruser"), "the reap is scoped to one user");
});
