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

function source(): string {
  /* import.meta.dirname rather than a URL: the Workers URL global shadows
     Node's here, and fs will not take it. */
  return readFileSync(join(import.meta.dirname, "..", "src", "projects.ts"), "utf8");
}

/**
 * The UNNAMED fragment, lifted from the source.
 *
 * The shipped queries interpolate it, so a test that skipped it would be
 * testing a query the product never runs — and this fragment is precisely
 * where the risk is: it decides whether an auto-named cut counts as one the
 * user named.
 */
function unnamedFragment(): string {
  const m = /const UNNAMED = `([\s\S]*?)`;/.exec(source());
  assert.ok(m, "couldn't find UNNAMED in src/projects.ts");
  return m[1];
}

/** The shipped query, lifted from the source so the two cannot diverge. */
function reapQuery(): string {
  const m = /reapDuplicateEdits[\s\S]*?\.prepare\(\s*`([\s\S]*?)`/.exec(source());
  assert.ok(m, "couldn't find reapDuplicateEdits' query in src/projects.ts");
  return m[1].replace("${UNNAMED}", unnamedFragment());
}

/** The TOUCHED predicate — what makes an edit worth listing. */
function touchedFragment(): string {
  const m = /const TOUCHED = `([\s\S]*?)`;/.exec(source());
  assert.ok(m, "couldn't find TOUCHED in src/projects.ts");
  return m[1].replace("${UNNAMED}", unnamedFragment());
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
  /* The three eras of naming. A row titled after its footage, and a row
     titled with the name the product worked out from the transcript, are both
     rows nobody has named — and both must reap like "Untitled cut" does. */
  { id: "filenamed", user: "U1", title: "DJI 0026 D", source: "S1", brief: "", cuts: null, updated: 110 },
  { id: "autonamed", user: "U1", title: "Quartering the north field", source: "S1", brief: "", cuts: null, updated: 130 },
];

function run(): { reaped: string[]; kept: string[] } {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE v2_projects(id TEXT PRIMARY KEY, user_id TEXT, title TEXT, kind TEXT,
      source_id TEXT, brief TEXT, cuts TEXT, updated_at INTEGER, deleted_at INTEGER, archived_at INTEGER);
    CREATE TABLE beats(id TEXT PRIMARY KEY, project_id TEXT);
    CREATE TABLE renders(id TEXT PRIMARY KEY, project_id TEXT);
    CREATE TABLE sources(id TEXT PRIMARY KEY, title TEXT, cut_title TEXT);
  `);
  db.exec(`
    INSERT INTO sources VALUES('S1','DJI 0026 D','Quartering the north field');
    INSERT INTO sources VALUES('S2','GX010042',NULL);
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
  assert.deepEqual(reaped, ["autonamed", "dup1", "dup2", "filenamed"]);
  assert.ok(kept.includes("dup3"), "the newest untouched edit is the one that survives");
});

test("a name the product chose does not save a duplicate from the reap", () => {
  const { reaped } = run();
  for (const id of ["filenamed", "autonamed"]) {
    assert.ok(reaped.includes(id), `${id} carries a name nobody typed and is still a duplicate`);
  }
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

/*
 * TOUCHED decides what appears in Projects, and getting it wrong in the
 * permissive direction reproduces the complaint that made untouched edits stop
 * listing at all: "it still immediately makes an edit when I click on one of
 * the footages". Auto-naming is exactly the change that could reintroduce it,
 * because an auto-named cut has a title that differs from its filename.
 */
function listed(): string[] {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE v2_projects(id TEXT PRIMARY KEY, user_id TEXT, title TEXT, kind TEXT,
      source_id TEXT, brief TEXT, cuts TEXT, updated_at INTEGER, deleted_at INTEGER, archived_at INTEGER);
    CREATE TABLE beats(id TEXT PRIMARY KEY, project_id TEXT);
    CREATE TABLE renders(id TEXT PRIMARY KEY, project_id TEXT);
    CREATE TABLE sources(id TEXT PRIMARY KEY, title TEXT, cut_title TEXT);
    INSERT INTO sources VALUES('S1','DJI 0026 D','Quartering the north field');
    /* A source the namer never managed to name. src/naming.ts: "a source that
       could not be named keeps a null cut_title". Every fixture here used to
       have one, which is why nothing caught the NULL. */
    INSERT INTO sources VALUES('S2','GX010042',NULL);
  `);
  const rows: Array<[string, string, string | null, string, string | null]> = [
    // id, title, source_id, brief, cuts
    ["placeholder", "Untitled cut", "S1", "", null],
    ["filenamed", "DJI 0026 D", "S1", "", null],
    ["autonamed", "Quartering the north field", "S1", "", null],
    ["renamed", "My rough cut", "S1", "", null],
    ["briefed", "a supercut of the wind", "S1", "a supercut of the wind", null],
    ["cutdown", "Quartering the north field", "S1", "", '[{"seg":2,"words":null}]'],
    ["composed", "From the composer", null, "", null],
    /* The row the `=` version dropped: named by the user, no brief, no cuts,
       and a source with no cut_title — so both other branches of UNNAMED are
       false, the third is NULL, and NOT NULL is NULL. */
    ["renamed-unnamed-source", "The kitchen cut", "S2", "", null],
    /* Its controls on the same source, to show the NULL was the only problem:
       one still placeholder, one named after the footage. Both unworked, so
       both stay out whichever way the comparison is written. */
    ["placeholder-unnamed-source", "Untitled cut", "S2", "", null],
    ["filenamed-unnamed-source", "GX010042", "S2", "", null],
  ];
  const ins = db.prepare(`INSERT INTO v2_projects VALUES(?,'U1',?,'cut',?,?,?,1,NULL,NULL)`);
  for (const [id, title, src, brief, cuts] of rows) ins.run(id, title, src, brief, cuts);

  return (
    db
      .prepare(`SELECT id FROM v2_projects WHERE deleted_at IS NULL AND ${touchedFragment()}`)
      .all() as Array<{ id: string }>
  )
    .map((r) => r.id)
    .sort();
}

test("an edit you only opened stays out of Projects, whatever the product named it", () => {
  const shown = listed();
  for (const id of ["placeholder", "filenamed", "autonamed", "placeholder-unnamed-source", "filenamed-unnamed-source"]) {
    assert.ok(!shown.includes(id), `${id} carries no work and must not list`);
  }
});

test("an edit with work in it lists, including one named by the user", () => {
  assert.deepEqual(listed(), ["briefed", "composed", "cutdown", "renamed", "renamed-unnamed-source"]);
});

/*
 * THE NULL, ON ITS OWN, because the assertion above would also go red for a
 * dozen unrelated reasons and this is the one worth naming.
 *
 * `=` against a null cut_title yields NULL rather than false, the OR chain
 * comes out NULL, `NOT NULL` is NULL, and the row fails its own WHERE clause.
 * A cut the user had named themselves was absent from Projects and present at
 * its own URL. Restoring `=` in src/projects.ts must fail this.
 */
test("a cut you named lists even when its source was never named", () => {
  assert.ok(
    listed().includes("renamed-unnamed-source"),
    "UNNAMED must be null-safe: use IS, not =, or a named cut of an unnamed source silently stops listing",
  );
});
