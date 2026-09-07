/**
 * One click that does the thing.
 *
 * "that's the whole point is like one click sort of does it right .. otherwise
 * i have no idea what the fuck it is doing."
 *
 * A pass used to score some moments, draw badges on them and leave the cut
 * exactly as long as it was. It writes the cut now — which means one press
 * can restructure an edit, so the boundaries are where the risk is.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyMoments, isSegmentCut, playableRanges } from "../src/cuts.ts";

/** Four lines, four seconds each. */
const SEGS = [0, 1, 2, 3].map((i) => ({
  idx: i, start_ms: i * 4000, end_ms: (i + 1) * 4000, words: null,
}));

const cutIdx = (cuts: ReturnType<typeof applyMoments>) =>
  SEGS.filter((s) => isSegmentCut(cuts, s.idx)).map((s) => s.idx);

test("keep: the moments become the cut and the rest goes", () => {
  const cuts = applyMoments(SEGS, [{ start_ms: 4000, end_ms: 8000 }], "keep");
  assert.deepEqual(cutIdx(cuts), [0, 2, 3], "the lines outside the moment should go");
});

test("cut: only the moments go and the rest stays", () => {
  const cuts = applyMoments(SEGS, [{ start_ms: 4000, end_ms: 8000 }], "cut");
  assert.deepEqual(cutIdx(cuts), [1]);
});

test("a moment clipping the corner of a line does not claim it", () => {
  /* A moment starts and ends on a thought, not on a line boundary. Half a
     line is the threshold; a 200ms overlap is not "this line is in it". */
  const cuts = applyMoments(SEGS, [{ start_ms: 3800, end_ms: 8000 }], "keep");
  assert.deepEqual(cutIdx(cuts), [0, 2, 3], "line 0 was kept on a 200ms overlap");
});

test("a moment covering most of a line does claim it", () => {
  const cuts = applyMoments(SEGS, [{ start_ms: 1000, end_ms: 8000 }], "keep");
  assert.deepEqual(cutIdx(cuts), [2, 3]);
});

test("finding nothing cuts nothing — it must not empty the edit", () => {
  /* The most dangerous case, and the first version of this test asserted the
     bug: read literally, "keep these" with an empty list means "keep none of
     it", and one press would strike every line in the transcript. */
  assert.deepEqual(applyMoments(SEGS, [], "keep"), []);
  assert.deepEqual(applyMoments(SEGS, [], "cut"), []);
});

test("several moments are all kept", () => {
  const cuts = applyMoments(SEGS, [
    { start_ms: 0, end_ms: 4000 },
    { start_ms: 12000, end_ms: 16000 },
  ], "keep");
  assert.deepEqual(cutIdx(cuts), [1, 2]);
});

test("what survives is exactly the footage of the moments", () => {
  const withWords = SEGS.map((s) => ({ ...s, words: null }));
  const cuts = applyMoments(withWords, [{ start_ms: 4000, end_ms: 8000 }], "keep");
  assert.deepEqual(playableRanges(withWords, cuts), [{ start_ms: 4000, end_ms: 8000 }]);
});

/* ── Which way round the instruction meant it ─────────────────────────── */

import { actionFor } from "../src/score.ts";

test("no offered example can read as CUT unless it means cut", () => {
  /* The property that matters. Reading a keep as a cut strikes exactly the
     moments the user asked to see; reading a keep as null falls through to
     the model, which defaults to keep — recoverable either way. So the test
     is one-directional on purpose.
     
     These are the nine chips in the editor. */
  const meansCut = new Set([
    "Cut the bits where I repeat myself",
    "Cut the false starts",
    "Cut anything I said better later",
  ]);
  const chips = [
    "Keep only the strongest points",
    "Where I actually make the point",
    "The funniest moments",
    "Cut the bits where I repeat myself",
    "Cut the false starts",
    "Cut anything I said better later",
    "Keep only the ones under 20 seconds",
    "Just the story, none of the setup",
    "Every question I ask",
  ];
  for (const text of chips) {
    const read = actionFor(text);
    if (meansCut.has(text)) assert.equal(read, "cut", text + " must cut");
    else assert.notEqual(read, "cut", text + " must never read as a cut");
  }
});

test("the button's own instruction keeps", () => {
  assert.equal(actionFor("find the strong bits"), "keep");
  assert.equal(actionFor("find the strongest moments"), "keep");
  assert.equal(actionFor("the moments worth keeping"), "keep");
});

test("removal verbs cut", () => {
  for (const t of [
    "cut the sponsor read",
    "also cut the sponsor read",
    "remove all the waffle",
    "get rid of the intro",
    "drop anything about the weather",
    "take out the long pauses",
  ]) {
    assert.equal(actionFor(t), "cut", t);
  }
});

test("\"cut it down to\" is the trap, and means keep", () => {
  /* Opens with a removal verb and means the opposite — pointed at the result
     rather than at what goes. Getting this wrong strikes exactly the moments
     the user asked to see. */
  assert.equal(actionFor("cut it down to the strong bits"), "keep");
  assert.equal(actionFor("trim it to just the argument"), "keep");
  assert.equal(actionFor("cut this down to only the good parts"), "keep");
});

test("a sentence that does not say leaves it to the model", () => {
  assert.equal(actionFor("something about gardening"), null);
  assert.equal(actionFor(""), null);
});
