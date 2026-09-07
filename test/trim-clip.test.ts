/**
 * Trimming a short, against real SQLite.
 *
 * The clipper had one verb — "Make the video" — so this is the gesture that
 * changes what it is. It writes straight into the two columns renderShort
 * builds its plan from, which means a bug here is a video of the wrong
 * seconds rather than a wrong number on a screen.
 *
 * The rules under test are the ones a stepper can break: a boundary cannot
 * leave the video, cannot pass the other one, and cannot make a clip of
 * nothing.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { trimClip } from "../src/projects.ts";

/** node:sqlite in the shape D1 is called with. Only what trimClip uses. */
function d1(db: DatabaseSync): never {
  const wrap = {
    prepare(sql: string) {
      const stmt = db.prepare(sql);
      let args: unknown[] = [];
      const api = {
        bind(...a: unknown[]) { args = a; return api; },
        async first<T>() { return (stmt.get(...(args as never[])) ?? null) as T | null; },
        async run() { stmt.run(...(args as never[])); return { success: true }; },
      };
      return api;
    },
  };
  return wrap as never;
}

function db(clip: { start_ms: number; end_ms: number }) {
  const d = new DatabaseSync(":memory:");
  d.exec(`CREATE TABLE v2_clips (
    id TEXT PRIMARY KEY, user_id TEXT, source_id TEXT,
    start_ms INTEGER, end_ms INTEGER, quote TEXT, why TEXT, score INTEGER,
    heat TEXT, frame_r2_key TEXT, kept INTEGER, origin TEXT, used_count INTEGER,
    created_at INTEGER, deleted_at INTEGER)`);
  d.prepare(
    `INSERT INTO v2_clips (id,user_id,source_id,start_ms,end_ms,quote,origin,kept,created_at,deleted_at)
     VALUES ('c1','u1','s1',?,?,'a quote','clipping',0,1,NULL)`,
  ).run(clip.start_ms, clip.end_ms);
  return d;
}

/** A ten-minute source. */
const TEN_MIN = 600_000;

test("it moves the edge you asked for and leaves the other alone", async () => {
  const d = db({ start_ms: 10_000, end_ms: 40_000 });
  const out = await trimClip(d1(d), "c1", "u1", { start_ms: 15_000 }, TEN_MIN);
  assert.equal(out?.start_ms, 15_000);
  assert.equal(out?.end_ms, 40_000);

  /* And it is on disk, not only in the value handed back. */
  const row = d.prepare(`SELECT start_ms, end_ms FROM v2_clips WHERE id='c1'`).get() as Record<string, number>;
  assert.equal(row.start_ms, 15_000);
  assert.equal(row.end_ms, 40_000);
});

test("a boundary cannot walk off the end of the video", async () => {
  /* Without the ceiling, a tail stepper asks the encoder for footage that is
     not there. */
  const d = db({ start_ms: 10_000, end_ms: 40_000 });
  const out = await trimClip(d1(d), "c1", "u1", { end_ms: 900_000 }, TEN_MIN);
  assert.equal(out?.end_ms, TEN_MIN);
});

test("a boundary cannot go below zero", async () => {
  const d = db({ start_ms: 10_000, end_ms: 40_000 });
  const out = await trimClip(d1(d), "c1", "u1", { start_ms: -5_000 }, TEN_MIN);
  assert.equal(out?.start_ms, 0);
});

test("an inside-out clip is put back the right way round", async () => {
  const d = db({ start_ms: 10_000, end_ms: 40_000 });
  const out = await trimClip(d1(d), "c1", "u1", { start_ms: 30_000, end_ms: 12_000 }, TEN_MIN);
  assert.equal(out?.start_ms, 12_000);
  assert.equal(out?.end_ms, 30_000);
});

test("a clip of nothing renders a file of nothing, so it is given a floor", async () => {
  const d = db({ start_ms: 10_000, end_ms: 40_000 });
  const out = await trimClip(d1(d), "c1", "u1", { start_ms: 20_000, end_ms: 20_000 }, TEN_MIN);
  assert.ok(out && out.end_ms - out.start_ms >= 500, "a zero-length clip was allowed through");
});

test("the floor does not push a clip at the very end past it", async () => {
  const d = db({ start_ms: 10_000, end_ms: 40_000 });
  const out = await trimClip(d1(d), "c1", "u1", { start_ms: TEN_MIN, end_ms: TEN_MIN }, TEN_MIN);
  assert.ok(out && out.end_ms <= TEN_MIN, "it ran past the end of the video");
  assert.ok(out && out.end_ms - out.start_ms >= 500);
});

test("an unknown source length is not treated as a ceiling of zero", async () => {
  /* A source that never recorded its duration must not collapse every clip in
     it to nothing. */
  const d = db({ start_ms: 10_000, end_ms: 40_000 });
  const out = await trimClip(d1(d), "c1", "u1", { end_ms: 50_000 }, null);
  assert.equal(out?.end_ms, 50_000);
});

test("someone else's clip is not found, let alone trimmed", async () => {
  const d = db({ start_ms: 10_000, end_ms: 40_000 });
  const out = await trimClip(d1(d), "c1", "someone-else", { start_ms: 0 }, TEN_MIN);
  assert.equal(out, null);
  const row = d.prepare(`SELECT start_ms FROM v2_clips WHERE id='c1'`).get() as { start_ms: number };
  assert.equal(row.start_ms, 10_000, "another user's trim was written anyway");
});
