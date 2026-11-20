/**
 * A SCORE PASS ANNOTATES THE SPANS; IT IS NOT DEDUPED INTO NOTHING.
 *
 * This is the dangerous half of writing moments during the read. The spans
 * cover the whole transcript, so every clip a later score pass finds overlaps
 * one by definition. Under the old dedupe rule — "skip anything overlapping
 * an existing moment by more than 0.8" — `fresh` would have come back empty
 * and saveClips would have returned nothing.
 *
 * That is not a cosmetic bug. src/begin.ts turns what saveClips returns INTO
 * the cut ("the moments become the cut"), so a pass would have read an hour of
 * footage, scored it, and produced an empty edit.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { fakeD1 } from "./helpers/fake-d1.ts";
import { saveClips, listClipsForSource } from "../src/projects.ts";
import { momentSpans } from "../src/moments.ts";
import type { Segment } from "../src/sources.ts";

let n = 0;
const seg = (start_ms: number, end_ms: number, text: string): Segment => ({
  id: "s" + ++n, source_id: "src1", idx: n, start_ms, end_ms, speaker: null, text, words: null,
});

/** Four sentences of eleven seconds: two moments, 22s each. */
const TRANSCRIPT = [
  seg(0, 11_000, "He says the quiet part first."),
  seg(11_000, 22_000, "Then he says it again, louder."),
  seg(22_000, 33_000, "And then he denies having said it."),
  seg(33_000, 44_000, "Which is the whole story really."),
];

function world() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE sources (id TEXT PRIMARY KEY, user_id TEXT, title TEXT)`);
  db.exec(`CREATE TABLE segments (id TEXT PRIMARY KEY, source_id TEXT, idx INTEGER, start_ms INTEGER,
             end_ms INTEGER, speaker TEXT, text TEXT, words TEXT)`);
  db.exec(`CREATE TABLE v2_clips (id TEXT PRIMARY KEY, user_id TEXT, source_id TEXT,
             start_ms INTEGER, end_ms INTEGER, start_word INTEGER, end_word INTEGER,
             quote TEXT, why TEXT, score INTEGER, heat INTEGER, frame_r2_key TEXT,
             kept INTEGER, origin TEXT, used_count INTEGER, created_at INTEGER, deleted_at INTEGER)`);
  return fakeD1(db) as never;
}

const readIn = (db: never) =>
  saveClips(db, { user_id: "u1", source_id: "src1", origin: "read", posterKey: null }, momentSpans(TRANSCRIPT));

test("the read lays down a moment for every point in the transcript", async () => {
  const db = world();
  const made = await readIn(db);
  assert.equal(made.length, 2, "44s of four sentences is two moments");
  assert.deepEqual(made.map((m) => [m.start_ms, m.end_ms]), [[0, 22_000], [22_000, 44_000]]);
  for (const m of made) {
    assert.equal(m.origin, "read");
    assert.equal(m.score, null);
    assert.equal(m.why, null);
  }
});

test("ACCEPTANCE: a score pass over the same footage returns moments, not nothing", async () => {
  /*
   * THE EMPTY-CUT BUG. The pass's clip overlaps the read's span completely,
   * so the old rule skipped it and returned []. begin.ts would then have made
   * a cut out of no moments.
   */
  const db = world();
  await readIn(db);

  const scored = await saveClips(
    db,
    { user_id: "u1", source_id: "src1", origin: "editor", posterKey: null },
    [{ start_ms: 0, end_ms: 22_000, quote: "He says the quiet part first. Then he says it again, louder.", why: "the admission", score: 88, heat: 2 }],
  );

  assert.equal(scored.length, 1, "the pass got nothing back — every cut from a pass would be empty");
  assert.equal(scored[0].score, 88);
  assert.equal(scored[0].why, "the admission");
});

test("ACCEPTANCE: it annotates the existing row rather than adding a near-duplicate", async () => {
  const db = world();
  await readIn(db);
  await saveClips(
    db,
    { user_id: "u1", source_id: "src1", origin: "editor", posterKey: null },
    [{ start_ms: 1_000, end_ms: 21_000, quote: "a slightly different range", why: "the admission", score: 88, heat: 2 }],
  );

  const all = await listClipsForSource(db, "src1", "u1");
  assert.equal(all.length, 2, "the library grew a duplicate of a moment it already had");

  const first = all.find((c) => c.start_ms === 0)!;
  assert.equal(first.score, 88, "the score did not reach the row");
  assert.equal(first.heat, 2);
  assert.equal(first.why, "the admission");
  /* The range stays the transcript's. The pass says how good it is, not where
     it is — the same division groundClips keeps one level down. */
  assert.equal(first.end_ms, 22_000, "the model's range overwrote the transcript's");
  assert.equal(first.quote, "He says the quiet part first. Then he says it again, louder.");
});

test("a re-read does not wipe a score that a pass already wrote", async () => {
  /*
   * Belt and braces, and worth saying which is which: `hit.score === null`
   * is what actually protects a scored row here, because by this point the
   * score is no longer null. The `carries` guard matters for the UNSCORED
   * rows — see the write-count test below, which is the one that pins it.
   */
  const db = world();
  await readIn(db);
  await saveClips(
    db,
    { user_id: "u1", source_id: "src1", origin: "editor", posterKey: null },
    [{ start_ms: 0, end_ms: 22_000, quote: "x", why: "the admission", score: 88, heat: 2 }],
  );

  await readIn(db);

  const all = await listClipsForSource(db, "src1", "u1");
  assert.equal(all.length, 2, "a re-read duplicated the library");
  const first = all.find((c) => c.start_ms === 0)!;
  assert.equal(first.score, 88, "the re-read nulled a real score");
  assert.equal(first.why, "the admission");
});

test("a scored moment is not re-annotated by a second pass", async () => {
  const db = world();
  await readIn(db);
  const opts = { user_id: "u1", source_id: "src1", origin: "editor" as const, posterKey: null };
  await saveClips(db, opts, [{ start_ms: 0, end_ms: 22_000, quote: "x", why: "first reason", score: 88, heat: 2 }]);
  const second = await saveClips(db, opts, [{ start_ms: 0, end_ms: 22_000, quote: "x", why: "second reason", score: 10, heat: 0 }]);

  assert.deepEqual(second, [], "the second pass overwrote a judgement that was already made");
  const first = (await listClipsForSource(db, "src1", "u1")).find((c) => c.start_ms === 0)!;
  assert.equal(first.why, "first reason");
});

test("a tighter span inside a read moment annotates it — the one real trade here", async () => {
  /*
   * I expected this to insert, and got the arithmetic wrong: overlapFraction
   * divides by the SMALLER of the two durations, so ten seconds wholly inside
   * a twenty-two second moment is 1.0, not 0.45.
   *
   * The behaviour is right and it is not new. "A clip wholly inside another is
   * dropped, not duplicated — its content is already in the cut" is what
   * dedupeOverlaps says in src/grounding.ts, and the old dedupe here did the
   * same. What changes is that such a find used to be thrown away whole;
   * now its score and its reason land on the span that contains it.
   *
   * The cost is explicit: a pass that finds a sharp ten-second line inside a
   * longer thought cannot narrow the moment to it. If that turns out to
   * matter — a short wants the punchline, not the paragraph — the fix is a
   * narrowing rule on the moment, not a second row saying nearly the same
   * thing, and this test should be the one that changes.
   */
  const db = world();
  await readIn(db);
  const made = await saveClips(
    db,
    { user_id: "u1", source_id: "src1", origin: "editor", posterKey: null },
    [{ start_ms: 11_500, end_ms: 21_500, quote: "a tighter span inside the first", why: "sharper", score: 95, heat: 2 }],
  );

  assert.equal(made.length, 1, "the find was thrown away entirely, as it used to be");
  assert.equal(made[0].origin, "read");
  assert.equal(made[0].start_ms, 0, "it annotated the containing moment");
  assert.equal(made[0].score, 95);
  assert.equal((await listClipsForSource(db, "src1", "u1")).length, 2, "the library grew a near-duplicate");
});

test("a pass finding footage the read did not cover still inserts it", async () => {
  /* The genuinely-new case: no overlap at all, so it is its own moment. */
  const db = world();
  await readIn(db);
  const made = await saveClips(
    db,
    { user_id: "u1", source_id: "src1", origin: "editor", posterKey: null },
    [{ start_ms: 60_000, end_ms: 75_000, quote: "something past the end of the read spans", why: "new", score: 70, heat: 1 }],
  );
  assert.equal(made.length, 1);
  assert.equal(made[0].origin, "editor");
  assert.equal((await listClipsForSource(db, "src1", "u1")).length, 3);
});


test("ACCEPTANCE: a re-read writes nothing at all when nothing has changed", () => {
  /*
   * WHAT `carries` IS ACTUALLY FOR, and the first version of the test above
   * claimed this and did not check it.
   *
   * Re-reading a source re-derives the same spans with no score. Without the
   * guard, every one of them matches an unscored row and is "enriched" with
   * null over null — a pointless UPDATE per moment per read, which on an hour
   * of footage is sixty writes to say nothing. `hit.score === null` cannot
   * catch this case, because for an unscored row it is true.
   *
   * Counting the writes is the only way to see it: the rows are identical
   * either way.
   */
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE v2_clips (id TEXT PRIMARY KEY, user_id TEXT, source_id TEXT,
             start_ms INTEGER, end_ms INTEGER, start_word INTEGER, end_word INTEGER,
             quote TEXT, why TEXT, score INTEGER, heat INTEGER, frame_r2_key TEXT,
             kept INTEGER, origin TEXT, used_count INTEGER, created_at INTEGER, deleted_at INTEGER)`);
  db.exec(`CREATE TABLE segments (id TEXT PRIMARY KEY, source_id TEXT, idx INTEGER, start_ms INTEGER,
             end_ms INTEGER, speaker TEXT, text TEXT, words TEXT)`);
  const real = fakeD1(db);

  let writes = 0;
  const counting = {
    prepare: (sql: string) => {
      if (/^\s*(UPDATE|INSERT)/i.test(sql)) writes += 1;
      return real.prepare(sql);
    },
    batch: real.batch.bind(real),
  } as never;

  return (async () => {
    await saveClips(counting, { user_id: "u1", source_id: "src1", origin: "read", posterKey: null }, momentSpans(TRANSCRIPT));
    const afterFirst = writes;
    assert.ok(afterFirst > 0, "the first read wrote nothing, so this test cannot see anything");

    writes = 0;
    await saveClips(counting, { user_id: "u1", source_id: "src1", origin: "read", posterKey: null }, momentSpans(TRANSCRIPT));
    assert.equal(writes, 0, "a re-read rewrote rows that had not changed");
  })();
});

test("ACCEPTANCE: one call that both inserts and annotates returns both", () => {
  /*
   * The mixed case, which is the only one the final return line serves —
   * there is an early return above it for "nothing fresh". Dropping
   * `enriched` from that line is invisible to every other test here, and it
   * is the empty-cut bug again in the case where a pass finds one new thing
   * and one it already had: the cut would be built from the new moment alone.
   */
  return (async () => {
    const db = world();
    await readIn(db);
    const made = await saveClips(
      db,
      { user_id: "u1", source_id: "src1", origin: "editor", posterKey: null },
      [
        { start_ms: 0, end_ms: 22_000, quote: "one it already had", why: "the admission", score: 88, heat: 2 },
        { start_ms: 60_000, end_ms: 75_000, quote: "one it did not", why: "new", score: 70, heat: 1 },
      ],
    );

    assert.equal(made.length, 2, "an annotated moment was dropped from what the caller builds the cut from");
    assert.deepEqual(made.map((m) => m.start_ms), [0, 60_000], "and they come back in transcript order");
    assert.deepEqual(made.map((m) => m.origin), ["read", "editor"]);
  })();
});
