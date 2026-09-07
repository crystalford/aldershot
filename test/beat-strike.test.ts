/**
 * Putting a block back, and one verdict per moment.
 *
 * "when i cut one out, and press add back it still seems to be cut out."
 *
 * toggleBeatStruck answered "is it struck now" and the route read that as
 * "did the row exist":
 *
 *     const found = await toggleBeatStruck(...);
 *     if (!found) return c.json({ error: "that block is gone" }, 404);
 *
 * So putting a block back always looked like a failure. The database was
 * updated, the route 404'd, and the editor repainted the row as struck — then
 * pressing it again left the row and the server saying opposite things.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { toggleBeatStruck } from "../src/projects.ts";
import { buildBlocks } from "../src/blocks.ts";

function d1(db: DatabaseSync): never {
  return {
    prepare(sql: string) {
      const stmt = db.prepare(sql);
      let args: unknown[] = [];
      const api = {
        bind(...a: unknown[]) { args = a; return api; },
        async first<T>() { return (stmt.get(...(args as never[])) ?? null) as T | null; },
        async all<T>() { return { results: stmt.all(...(args as never[])) as T[] }; },
        async run() { stmt.run(...(args as never[])); return { success: true }; },
      };
      return api;
    },
  } as never;
}

function beats() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE beats (id TEXT PRIMARY KEY, project_id TEXT, struck TEXT)`);
  db.prepare(`INSERT INTO beats VALUES ('b1','p1',NULL)`).run();
  return { db, struck: () => (db.prepare(`SELECT struck FROM beats WHERE id='b1'`).get() as { struck: string | null }).struck };
}

test("striking a block reports that it is now struck", async () => {
  const w = beats();
  assert.equal(await toggleBeatStruck(d1(w.db), "p1", "b1"), true);
  assert.equal(w.struck(), "1");
});

test("putting it back is a SUCCESS, not a missing row", async () => {
  /* The whole bug: false meant "now unstruck" and was read as "not found". */
  const w = beats();
  await toggleBeatStruck(d1(w.db), "p1", "b1");
  const now = await toggleBeatStruck(d1(w.db), "p1", "b1");
  assert.equal(now, false, "it should report the new state");
  assert.notEqual(now, null, "false must be distinguishable from not-found");
  assert.equal(w.struck(), null, "the block was not actually put back");
});

test("a block that is genuinely gone says so, and says it differently", async () => {
  const w = beats();
  assert.equal(await toggleBeatStruck(d1(w.db), "p1", "nope"), null);
});

test("cut, add back, cut again — the state never inverts", async () => {
  const w = beats();
  const seen: Array<boolean | null> = [];
  for (let i = 0; i < 4; i++) seen.push(await toggleBeatStruck(d1(w.db), "p1", "b1"));
  assert.deepEqual(seen, [true, false, true, false]);
});

/* ── One verdict per moment ───────────────────────────────────────────── */

const seg = (idx: number, from: number, to: number) => ({
  idx, start_ms: from, end_ms: to, text: "line " + idx, words: null,
});

test("a moment spanning three lines is judged once, not three times", () => {
  /* The screenshot: three different lines each showing 93 with the same
     sentence under it, as if the model had rated every line identically. */
  const segments = [seg(0, 0, 4000), seg(1, 4000, 8000), seg(2, 8000, 12000)];
  const blocks = buildBlocks({
    segments,
    cuts: [],
    scores: [{ start_ms: 500, end_ms: 11500, score: 93, why: "the closer" }],
  });
  const judged = blocks.filter((b) => b.score != null);
  assert.equal(judged.length, 1);
  assert.equal(judged[0].score, 93);
  assert.equal(judged[0].why, "the closer");
});

test("two moments get a line each rather than fighting over one", () => {
  const segments = [seg(0, 0, 4000), seg(1, 4000, 8000)];
  const blocks = buildBlocks({
    segments,
    cuts: [],
    scores: [
      { start_ms: 0, end_ms: 8000, score: 70, why: "wide" },
      { start_ms: 4200, end_ms: 7800, score: 95, why: "sharp" },
    ],
  });
  const judged = blocks.filter((b) => b.score != null).map((b) => b.score);
  assert.equal(judged.length, 2);
  /* The stronger one takes the line it fits best; the other keeps a line. */
  assert.ok(judged.includes(95) && judged.includes(70));
});

test("an unscored transcript stays unscored", () => {
  const blocks = buildBlocks({ segments: [seg(0, 0, 4000)], cuts: [], scores: [] });
  assert.equal(blocks[0].score, null);
  assert.equal(blocks[0].why, null);
});
