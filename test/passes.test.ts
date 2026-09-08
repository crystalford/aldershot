/**
 * The passes log, against real SQLite.
 *
 * The table has carried this since the first pass ever ran, and nothing read
 * it — so an instruction that matched nothing was indistinguishable from one
 * that worked. Now that it is on screen, two things have to be right, and
 * both were wrong: the number (hardcoded to 1, so an edit you had asked four
 * things of showed four rows all called 1) and the order (a history reads
 * oldest first).
 *
 * The queries are lifted out of src/passes.ts, so what is tested is the SQL
 * that ships rather than a copy that can drift away from it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const source = () => readFileSync(join(import.meta.dirname, "..", "src", "passes.ts"), "utf8");

/** A query from the source, by the text that precedes it. */
function query(after: string): string {
  const m = new RegExp(after + "[\\s\\S]*?\\.prepare\\(\\s*`([\\s\\S]*?)`").exec(source());
  assert.ok(m, "couldn't find the query after " + after);
  return m[1];
}

function db(): DatabaseSync {
  const d = new DatabaseSync(":memory:");
  d.exec(`CREATE TABLE passes (
    id TEXT PRIMARY KEY, project_id TEXT, source_id TEXT,
    n INTEGER NOT NULL, instruction TEXT NOT NULL, result TEXT NOT NULL,
    undo TEXT, undone_at INTEGER, first_change TEXT,
    model TEXT, tokens_in INTEGER, tokens_out INTEGER, created_at INTEGER NOT NULL)`);
  return d;
}

let seq = 0;
const add = (
  d: DatabaseSync,
  p: { project?: string | null; source?: string | null; n: number; instruction?: string; result?: string; at?: number },
) =>
  d
    .prepare(
      `INSERT INTO passes (id,project_id,source_id,n,instruction,result,model,tokens_in,tokens_out,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      "p" + ++seq,
      p.project ?? null,
      p.source ?? null,
      p.n,
      p.instruction ?? "do a thing",
      p.result ?? "1 moment found",
      null,
      0,
      0,
      p.at ?? Date.now() + seq,
    );

/* The two SELECTs, exactly as shipped. */
const NEXT_FOR_PROJECT = query("nextPassNumber");
const LOG = query("passLog");

test("the first pass on a cut is 1", () => {
  const d = db();
  const row = d.prepare(NEXT_FOR_PROJECT).get("proj") as { n: number | null };
  assert.equal((row?.n ?? 0) + 1, 1);
});

test("each pass after it counts on, rather than all saying 1", () => {
  const d = db();
  add(d, { project: "proj", n: 1 });
  add(d, { project: "proj", n: 2 });
  const row = d.prepare(NEXT_FOR_PROJECT).get("proj") as { n: number | null };
  assert.equal((row?.n ?? 0) + 1, 3);
});

test("another cut's passes are not counted into this one", () => {
  const d = db();
  add(d, { project: "other", n: 1 });
  add(d, { project: "other", n: 2 });
  add(d, { project: "other", n: 3 });
  const row = d.prepare(NEXT_FOR_PROJECT).get("proj") as { n: number | null };
  assert.equal((row?.n ?? 0) + 1, 1);
});

test("a clips-only pass belongs to its source, which has no project", () => {
  /* Asking for clips creates no project, so those passes are counted per
     source or every one of them would be number 1 for ever. */
  const d = db();
  const BY_SOURCE = /project_id IS NULL AND source_id=\?/.exec(source());
  assert.ok(BY_SOURCE, "the source-only branch is gone from src/passes.ts");

  add(d, { project: null, source: "src", n: 1 });
  add(d, { project: "proj", source: "src", n: 7 });
  const row = d
    .prepare(`SELECT MAX(n) AS n FROM passes WHERE project_id IS NULL AND source_id=?`)
    .get("src") as { n: number | null };
  /* 2, not 8 — the project's own pass is not this source's. */
  assert.equal((row?.n ?? 0) + 1, 2);
});

test("the log reads oldest first, so pass 1 is the brief it began as", () => {
  const d = db();
  add(d, { project: "proj", n: 1, instruction: "the funny bits", at: 100 });
  add(d, { project: "proj", n: 2, instruction: "also cut the sponsor read", at: 200 });
  add(d, { project: "proj", n: 3, instruction: "tighten the middle", at: 300 });

  /* passLog selects newest-first with a LIMIT, then reverses — so a long
     history keeps the RECENT passes and still reads in order. */
  const rows = (d.prepare(LOG).all("proj", 12) as Array<{ instruction: string }>).reverse();
  assert.deepEqual(rows.map((r) => r.instruction), [
    "the funny bits",
    "also cut the sponsor read",
    "tighten the middle",
  ]);
});

test("the limit keeps the newest, not the oldest", () => {
  const d = db();
  for (let i = 1; i <= 20; i++) add(d, { project: "proj", n: i, instruction: "pass " + i, at: i });
  const rows = (d.prepare(LOG).all("proj", 3) as Array<{ instruction: string }>).reverse();
  assert.deepEqual(rows.map((r) => r.instruction), ["pass 18", "pass 19", "pass 20"]);
});
