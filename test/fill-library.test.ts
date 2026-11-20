/**
 * THE READ FILLS THE LIBRARY — the step itself, against a real database.
 *
 * Nothing in test/ calls readSource: it needs a transcription model, a
 * container and R2. So this is the one new step in the read pipeline, driven
 * directly, because wiring it inline would have left it exercised by nothing
 * — and "it is wired, trust me" is how the two gate checks on this branch
 * came to be skipping for months.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fakeD1 } from "./helpers/fake-d1.ts";
import { fillLibrary } from "../src/ingest.ts";
import { listClipsForSource } from "../src/projects.ts";
import { saveSegments } from "../src/sources.ts";
import type { Source } from "../src/sources.ts";

const SRC = { id: "src1", user_id: "u1", poster_r2_key: "poster.jpg" } as Source;

function world() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE segments (id TEXT PRIMARY KEY, source_id TEXT, idx INTEGER, start_ms INTEGER,
             end_ms INTEGER, speaker TEXT, text TEXT, words TEXT)`);
  db.exec(`CREATE TABLE v2_clips (id TEXT PRIMARY KEY, user_id TEXT, source_id TEXT,
             start_ms INTEGER, end_ms INTEGER, start_word INTEGER, end_word INTEGER,
             quote TEXT, why TEXT, score INTEGER, heat INTEGER, frame_r2_key TEXT,
             kept INTEGER, origin TEXT, used_count INTEGER, created_at INTEGER, deleted_at INTEGER)`);
  return fakeD1(db) as never;
}

/** What a transcription comes back as: seconds, not ms. */
const spoken = (n: number, each = 11) =>
  Array.from({ length: n }, (_, i) => ({
    start: i * each,
    end: (i + 1) * each,
    text: "A whole sentence, said out loud.",
  }));

test("ACCEPTANCE: reading a source with no brief fills the library", async () => {
  /*
   * The defect this ends. A moment used to exist only where a brief had run a
   * score pass, so an hour uploaded with nothing said about it left a
   * transcript and nothing to retrieve.
   */
  const db = world();
  await saveSegments(db, "src1", spoken(4));

  const made = await fillLibrary(db, SRC);
  assert.equal(made, 2, "44s of four sentences is two moments");

  const rows = await listClipsForSource(db, "src1", "u1");
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.origin), ["read", "read"]);
  assert.deepEqual(rows.map((r) => r.score), [null, null]);
  assert.deepEqual(rows.map((r) => r.frame_r2_key), ["poster.jpg", "poster.jpg"]);
});

test("ACCEPTANCE: a hallucinated segment cannot become a moment", async () => {
  /*
   * Whisper emits zero-length and empty segments on silence — "Thank you for
   * watching" over a closing shot is the classic one — and a moment built
   * from one is a moment pointing at silence.
   *
   * THIS IS NOT A TEST THAT READING THE ROWS IS WHAT STOPS IT, which is what
   * it claimed when first written. Feeding the hallucination straight past
   * saveSegments failed nothing, because momentSpans rejects empty text and
   * end <= start on its own — the same two conditions saidAloud applies. Two
   * guards, and this test can only reach ONE of them: saidAloud, in
   * saveSegments. Deleting momentSpans' own `end <= start` check fails
   * nothing here, because the row never arrives. The other half is pinned in
   * test/moments.test.ts, by a test that feeds momentSpans directly.
   * src/ingest.ts now states the actual reason the rows are the input.
   */
  const db = world();
  await saveSegments(db, "src1", [
    { start: 0, end: 11, text: "A whole sentence, said out loud." },
    { start: 11, end: 11, text: "Thank you for watching." },
    { start: 11, end: 22, text: "Another whole sentence, said out loud." },
  ]);

  const rows = await listClipsForSource(db, "src1", "u1");
  assert.equal(rows.length, 0, "fixture problem: the library was not empty to start with");

  await fillLibrary(db, SRC);
  const after = await listClipsForSource(db, "src1", "u1");
  assert.equal(after.length, 1);
  assert.ok(!after[0].quote.includes("Thank you for watching"), "a hallucination reached the library");
});

test("a source nobody said anything in gets no moments, and does not throw", async () => {
  const db = world();
  assert.equal(await fillLibrary(db, SRC), 0);
  assert.equal((await listClipsForSource(db, "src1", "u1")).length, 0);
});

test("ACCEPTANCE: a broken library write does not fail the read", async () => {
  /*
   * The transcript is the expensive thing and it is already saved. Losing the
   * moments is recoverable by re-reading; losing the read is not.
   */
  const db = world();
  await saveSegments(db, "src1", spoken(4));
  /* The clips table is gone, so the insert throws. */
  const broken = {
    prepare: (sql: string) => {
      if (/v2_clips/i.test(sql)) throw new Error("no such table: v2_clips");
      return (db as never as { prepare: (s: string) => unknown }).prepare(sql);
    },
    batch: () => {
      throw new Error("no such table: v2_clips");
    },
  } as never;

  assert.equal(await fillLibrary(broken, SRC), 0, "it threw instead of reporting nothing");
});

test("reading the same source twice does not double the library", async () => {
  const db = world();
  await saveSegments(db, "src1", spoken(4));
  await fillLibrary(db, SRC);
  await fillLibrary(db, SRC);
  assert.equal((await listClipsForSource(db, "src1", "u1")).length, 2);
});

test("the read step is wired into the read, not only exported", () => {
  /*
   * The unit above proves the function works. This proves ingest calls it —
   * the half that, left unchecked, is a feature that exists and never runs.
   */
  const src = readFileSync(join(import.meta.dirname, "..", "src", "ingest.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");
  assert.match(src, /await fillLibrary\(env\.DB, src\)/, "readSource must call it");
  /* After the transcript is written, or there is nothing to make moments from. */
  assert.ok(
    src.indexOf("saveSegments(env.DB") < src.indexOf("await fillLibrary(env.DB, src)"),
    "it runs before the segments are saved",
  );
});
