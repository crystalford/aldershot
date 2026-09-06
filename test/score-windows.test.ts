/**
 * Windowing the score pass.
 *
 * The pass is divided because progress can only be honest if the work is
 * actually divided — a bar over one opaque call is a bar over nothing. So the
 * division itself has to be right: no line may be split, because a line's
 * timecode prefix is what grounds the model's answer, and nothing may be
 * dropped, because a lost window is a stretch of the video the pass silently
 * never read.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { windowSegments } from "../src/score.ts";

const seg = (idx: number, text: string) => ({
  id: `s${idx}`,
  source_id: "S1",
  idx,
  start_ms: idx * 1000,
  end_ms: idx * 1000 + 900,
  speaker: null,
  text,
  words: null,
});

const many = (n: number, chars = 100) =>
  Array.from({ length: n }, (_, i) => seg(i, "x".repeat(chars)));

test("a short transcript stays one window", () => {
  const w = windowSegments(many(5));
  assert.equal(w.length, 1);
  assert.equal(w[0].length, 5);
});

test("a long transcript is divided", () => {
  const w = windowSegments(many(400, 200));
  assert.ok(w.length > 1, `expected several windows, got ${w.length}`);
});

test("every segment survives, exactly once and in order", () => {
  const segs = many(400, 200);
  const flat = windowSegments(segs).flat();
  assert.equal(flat.length, segs.length, "a lost window is a stretch nothing ever read");
  assert.deepEqual(flat.map((s) => s.idx), segs.map((s) => s.idx));
});

test("no window is empty", () => {
  for (const w of windowSegments(many(400, 200))) assert.ok(w.length > 0);
});

test("a single segment larger than the window still goes through", () => {
  // Refusing it would mean the pass silently skips the line entirely.
  const w = windowSegments([seg(0, "x".repeat(90_000))]);
  assert.equal(w.length, 1);
  assert.equal(w[0].length, 1);
});

test("an empty transcript does not produce a phantom window of nothing", () => {
  assert.deepEqual(windowSegments([]), [[]]);
});
