/**
 * Script mode's promise is that striking a word removes that video. These
 * tests are that promise: `playableRanges` is what the render is built from,
 * so a bug here means an export that does not match what the user read.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  addCuts, fillerCuts, isSegmentCut, isWordCut, parseCuts,
  playableRanges, runtimeAfterCuts, toggleSegment, toggleWord,
} from "../src/cuts.ts";

/** "one two three" over 0-3s, a word a second. */
const seg = (idx: number, base: number, text: string) => ({
  idx,
  start_ms: base * 1000,
  end_ms: (base + text.split(" ").length) * 1000,
  words: JSON.stringify(
    text.split(" ").map((w, i) => ({ w, s: base + i, e: base + i + 1 })),
  ),
});

const SEGMENTS = [seg(0, 0, "one two three"), seg(1, 3, "four five six")];

test("nothing cut means everything plays", () => {
  assert.deepEqual(playableRanges(SEGMENTS, []), [{ start_ms: 0, end_ms: 6000 }]);
});

test("cutting a line removes exactly that line's footage", () => {
  const cuts = toggleSegment([], 0);
  assert.deepEqual(playableRanges(SEGMENTS, cuts), [{ start_ms: 3000, end_ms: 6000 }]);
  assert.equal(runtimeAfterCuts(SEGMENTS, cuts), 3);
});

test("striking one word removes exactly that word's footage", () => {
  // "two" spans 1-2s. Its removal must split the line, not shorten it.
  const cuts = toggleWord([], 0, 1);
  assert.deepEqual(playableRanges(SEGMENTS, cuts), [
    { start_ms: 0, end_ms: 1000 },
    { start_ms: 2000, end_ms: 3000 },
    { start_ms: 3000, end_ms: 6000 },
  ].reduce((acc, r) => {
    // touching ranges merge
    const last = acc[acc.length - 1];
    if (last && r.start_ms - last.end_ms <= 1) last.end_ms = r.end_ms;
    else acc.push({ ...r });
    return acc;
  }, [] as Array<{ start_ms: number; end_ms: number }>));
});

test("adjacent survivors are merged, so the render does not stitch needlessly", () => {
  const ranges = playableRanges(SEGMENTS, toggleWord([], 0, 0));
  // Cutting "one" leaves 1-3s, which touches segment 1 at 3s: one range.
  assert.deepEqual(ranges, [{ start_ms: 1000, end_ms: 6000 }]);
});

test("striking every word of a line removes the whole line", () => {
  let cuts = toggleWord([], 0, 0);
  cuts = toggleWord(cuts, 0, 1);
  cuts = toggleWord(cuts, 0, 2);
  assert.deepEqual(playableRanges(SEGMENTS, cuts), [{ start_ms: 3000, end_ms: 6000 }]);
});

test("a cut is a range, not a deletion — it can always be undone", () => {
  const cut = toggleSegment([], 0);
  assert.ok(isSegmentCut(cut, 0));
  const restored = toggleSegment(cut, 0);
  assert.equal(restored.length, 0);
  assert.deepEqual(playableRanges(SEGMENTS, restored), [{ start_ms: 0, end_ms: 6000 }]);
});

test("cutting a whole line supersedes word cuts inside it", () => {
  // Otherwise un-cutting the line would restore it full of holes the user
  // never asked for.
  let cuts = toggleWord([], 0, 1);
  cuts = toggleSegment(cuts, 0);
  assert.equal(cuts.filter((c) => c.seg === 0).length, 1);
  assert.deepEqual(toggleSegment(cuts, 0), []);
});

test("striking a word inside a cut line keeps the rest of the line", () => {
  // The gesture should do what it looks like it does.
  const cuts = toggleWord(toggleSegment([], 0), 0, 1);
  assert.ok(!isSegmentCut(cuts, 0));
  assert.ok(isWordCut(cuts, 0, 1));
  assert.ok(!isWordCut(cuts, 0, 0));
});

test("un-cutting a word splits the range around it", () => {
  let cuts: ReturnType<typeof toggleWord> = [{ seg: 0, words: [0, 2] }];
  cuts = toggleWord(cuts, 0, 1);
  assert.ok(isWordCut(cuts, 0, 0));
  assert.ok(!isWordCut(cuts, 0, 1));
  assert.ok(isWordCut(cuts, 0, 2));
});

test("a line with no word timings still cuts as a whole", () => {
  // Degrades rather than dropping the line silently.
  const noWords = [{ idx: 0, start_ms: 0, end_ms: 5000, words: null }];
  assert.deepEqual(playableRanges(noWords, []), [{ start_ms: 0, end_ms: 5000 }]);
  assert.deepEqual(playableRanges(noWords, toggleSegment([], 0)), []);
});

test("filler removal finds real words with real timings", () => {
  const withFillers = [seg(0, 0, "um so yeah uh right")];
  const cuts = fillerCuts(withFillers);
  assert.equal(cuts.length, 2);
  assert.ok(isWordCut(cuts, 0, 0), "um");
  assert.ok(isWordCut(cuts, 0, 3), "uh");
  assert.ok(!isWordCut(cuts, 0, 1), "so is not a filler");
});

test("applying clean-up twice does not double up", () => {
  const withFillers = [seg(0, 0, "um so yeah")];
  const once = addCuts([], fillerCuts(withFillers));
  const twice = addCuts(once, fillerCuts(withFillers));
  assert.equal(twice.length, once.length);
});

test("malformed stored cuts are treated as no cuts, never thrown", () => {
  assert.deepEqual(parseCuts("not json"), []);
  assert.deepEqual(parseCuts(null), []);
  assert.deepEqual(parseCuts('[{"nope":1}]'), []);
});
