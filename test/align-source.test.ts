/**
 * RUNNING THE ALIGNER, without a container or a model.
 *
 * The container is driven for real by scripts/check-align.cjs — it needs a
 * 1.26 GB model and a torch install, which is why it is acceptance rather
 * than a test. What is left is everything around it, and one of those is the
 * single most dangerous function in the feature: `applyToSegments` writes
 * each word's new timing back, and writing them onto the wrong words is a
 * failure that looks exactly like success.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { RETRY_AFTER_MS, applyToSegments, needsAlignment } from "../src/align-source.ts";
import { indexWords } from "../src/align.ts";
import { parseWords } from "../src/cuts.ts";

const NOW = 1_700_000_000_000;

/* ── When it runs ───────────────────────────────────────────────────────── */

const src = (over: Partial<Parameters<typeof needsAlignment>[0]> = {}) => ({
  id: "s1",
  r2_key: "k",
  timing_source: null,
  aligned_at: null,
  ...over,
});

test("a source nobody has aligned is aligned", () => {
  assert.equal(needsAlignment(src(), NOW), true);
});

test("a source already aligned is never aligned again", () => {
  /*
   * Attaching the same video to four projects aligns it once. The whole
   * point of the column.
   *
   * ALIGNED LONG AGO, deliberately. The first version used `NOW - 1` and so
   * was also inside the retry window below — it passed with the `forced`
   * check deleted entirely, proving only that a recent attempt is not
   * repeated. A video aligned last year must still never be aligned again.
   */
  assert.equal(
    needsAlignment(src({ timing_source: "forced", aligned_at: NOW - RETRY_AFTER_MS * 100 }), NOW),
    false,
  );
});

test("an alignment that failed waits before it is tried again", () => {
  /*
   * A failure leaves timing_source null and aligned_at set — a video with no
   * speech in it, say. Retrying on every attach would hammer a source that
   * cannot be aligned, and attaching is a link press.
   */
  const failed = src({ aligned_at: NOW - 60_000 });
  assert.equal(needsAlignment(failed, NOW), false);
  assert.equal(needsAlignment(failed, NOW + RETRY_AFTER_MS), true, "and it is tried again eventually");
});

/* ── Writing it back ────────────────────────────────────────────────────── */

const seg = (idx: number, words: Array<[string, number, number]>) => ({
  idx,
  words: JSON.stringify(words.map(([w, s, e]) => ({ w, s, e }))),
});

test("a word's new timing lands on that word and no other", () => {
  /*
   * THE NUMBERING IS THE ADDRESS. indexWords walks segments in idx order and
   * words in stored order; applyToSegments has to walk them identically or
   * every timing lands one word along — and the transcript still reads
   * correctly, so nothing visible says anything is wrong.
   *
   * The segments are given OUT of order here on purpose: both functions sort,
   * and a version of either that trusted the query's order would pass with
   * ORDER BY idx in the SQL and fail the day somebody removed it.
   */
  const segments = [
    seg(1, [["that", 1.0, 1.2], ["one", 1.3, 1.5]]),
    seg(0, [["this", 0.1, 0.3], ["is", 0.4, 0.5]]),
  ];
  const words = indexWords(segments, parseWords);
  assert.deepEqual(words.map((w) => w.text), ["this", "is", "that", "one"]);

  /* Move word 2 — "that" — and nothing else. */
  const out = applyToSegments(segments, new Map([[2, { startMs: 1_111, endMs: 1_222 }]]));
  assert.equal(out.length, 1, "only the segment that changed is written");
  assert.equal(out[0].idx, 1);
  assert.deepEqual(JSON.parse(out[0].words), [
    { w: "that", s: 1.111, e: 1.222 },
    { w: "one", s: 1.3, e: 1.5 },
  ]);
});

test("seconds in storage, milliseconds everywhere else", () => {
  /* The landmine documented in src/cuts.ts. This is the one place that
     converts back, so this is where it is pinned. */
  const segments = [seg(0, [["a", 0, 0.1]])];
  const out = applyToSegments(segments, new Map([[0, { startMs: 2_500, endMs: 2_750 }]]));
  assert.deepEqual(JSON.parse(out[0].words), [{ w: "a", s: 2.5, e: 2.75 }]);
});

test("a word the aligner could not place keeps exactly what it had", () => {
  const segments = [seg(0, [["a", 0.1, 0.2], ["42", 0.3, 0.4], ["b", 0.5, 0.6]])];
  const out = applyToSegments(
    segments,
    new Map([
      [0, { startMs: 150, endMs: 250 }],
      [2, { startMs: 550, endMs: 650 }],
    ]),
  );
  assert.deepEqual(JSON.parse(out[0].words), [
    { w: "a", s: 0.15, e: 0.25 },
    { w: "42", s: 0.3, e: 0.4 },
    { w: "b", s: 0.55, e: 0.65 },
  ]);
});

test("a segment with no words is skipped without consuming a word id", () => {
  /*
   * indexWords numbers only the words it finds, so an empty segment
   * contributes nothing to the count. A write-back that counted it anyway
   * would shift every word after it — and empty segments are real: a pause,
   * a music cue, a transcript line the recogniser gave no words for.
   */
  const segments = [seg(0, [["a", 0, 0.1]]), { idx: 1, words: null }, seg(2, [["b", 1, 1.1]])];
  const out = applyToSegments(segments, new Map([[1, { startMs: 1_500, endMs: 1_600 }]]));
  assert.equal(out.length, 1);
  assert.equal(out[0].idx, 2, "word 1 is in segment 2, because segment 1 has none");
  assert.deepEqual(JSON.parse(out[0].words), [{ w: "b", s: 1.5, e: 1.6 }]);
});

test("nothing to move writes nothing at all", () => {
  assert.deepEqual(applyToSegments([seg(0, [["a", 0, 0.1]])], new Map()), []);
});
