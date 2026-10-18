/**
 * ON THE PAUSE, NOT THE PHONEME.
 *
 * Phase 1's acceptance, and the first thing forced alignment actually buys
 * the person holding the mouse. An aligner puts the end of a word at the end
 * of its last phoneme, which is earlier than where the word stops being
 * heard — the release, the breath, the room. Cut exactly there and the join
 * clicks.
 *
 * The refinement is gated on `frameAccurate`, which is the question the
 * timing contract in src/align.ts was written to make askable: a recogniser
 * timing is wrong by more than the padding is wide, so the gap it reports is
 * not a gap you can move into.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EDGE_MS, playableRanges, runRange, type Cut, type Segmentish } from "../src/cuts.ts";
import { blockRanges, buildBlocks } from "../src/blocks.ts";
import { buildEdl } from "../src/edl.ts";
import { timingOf } from "../src/align.ts";

const FORCED = timingOf("forced");
const HEARD = timingOf("recogniser");

/** Four words, 500ms apart, 300ms long: a 200ms gap between each. */
const words = [
  { w: "one", s: 0.0, e: 0.3 },
  { w: "two", s: 0.5, e: 0.8 },
  { w: "three", s: 1.0, e: 1.3 },
  { w: "four", s: 1.5, e: 1.8 },
];
const SEG: Segmentish[] = [{ idx: 0, start_ms: 0, end_ms: 2_000, words: JSON.stringify(words) }];

/* Strike word 1 ("two"), which puts a cut either side of it. */
const strike: Cut[] = [{ seg: 0, words: [1, 1] }];

test("with forced timings a cut moves halfway into the silence beside it", () => {
  const [a, b] = playableRanges(SEG, strike, FORCED);
  /*
   * The gap between "one" and "two" is 200ms, so the run ending at "one"
   * takes 100ms of it — capped at EDGE_MS, which is 60.
   */
  assert.equal(a.start_ms, 0, "the line's own start is somebody else's edge");
  assert.equal(a.end_ms, 300 + EDGE_MS);
  assert.equal(b.start_ms, 1_000 - EDGE_MS);
  assert.equal(b.end_ms, 1_800 + EDGE_MS, "and the tail, into the silence before the line ends");
});

test("with recogniser timings it cuts exactly where it always did", () => {
  /*
   * NOT A REFUSAL, A DECLINE. A recogniser timing is worth about 110ms, so
   * the next word's true onset could already be inside the room this would
   * make. The cut lands on the stated boundary, which is this product's
   * behaviour everywhere alignment has not run.
   */
  assert.deepEqual(playableRanges(SEG, strike, HEARD), [
    { start_ms: 0, end_ms: 300 },
    { start_ms: 1_000, end_ms: 1_800 },
  ]);
  assert.deepEqual(playableRanges(SEG, strike), playableRanges(SEG, strike, HEARD), "and by default");
});

test("a cut never takes more than half the gap, so two cuts cannot meet", () => {
  /*
   * Striking one word with a short gap either side: if each side took a flat
   * 60ms out of an 80ms gap the two ranges would overlap, and the render
   * would play 40ms of the struck word twice.
   */
  const tight = [
    { w: "a", s: 0.0, e: 0.3 },
    { w: "b", s: 0.38, e: 0.6 },
    { w: "c", s: 0.68, e: 1.0 },
  ];
  const seg: Segmentish[] = [{ idx: 0, start_ms: 0, end_ms: 1_200, words: JSON.stringify(tight) }];
  const [a, b] = playableRanges(seg, [{ seg: 0, words: [1, 1] }], FORCED);
  assert.equal(a.end_ms, 300 + 40, "half of the 80ms gap");
  assert.equal(b.start_ms, 680 - 40);
  assert.ok(a.end_ms <= 380 && b.start_ms >= 340);
  assert.ok(a.end_ms < b.start_ms, "and the two never cross");
});

test("words that touch make no room at all rather than negative room", () => {
  const touching = [
    { w: "a", s: 0.0, e: 0.5 },
    { w: "b", s: 0.5, e: 1.0 },
    { w: "c", s: 1.0, e: 1.5 },
  ];
  const seg: Segmentish[] = [{ idx: 0, start_ms: 0, end_ms: 1_500, words: JSON.stringify(touching) }];
  const [a, b] = playableRanges(seg, [{ seg: 0, words: [1, 1] }], FORCED);
  assert.equal(a.end_ms, 500);
  assert.equal(b.start_ms, 1_000);
});

test("a word whose neighbour overlaps it does not pull the cut backwards", () => {
  /* Overlapping timings are real — an aligner can place a word's start before
     the previous word's end on a fast join. A negative gap must take nothing,
     not add the negative half to the boundary. */
  const over = [
    { w: "a", s: 0.0, e: 0.6 },
    { w: "b", s: 0.5, e: 1.0 },
  ];
  const seg: Segmentish[] = [{ idx: 0, start_ms: 0, end_ms: 1_000, words: JSON.stringify(over) }];
  const [r] = playableRanges(seg, [{ seg: 0, words: [0, 0] }], FORCED);
  assert.equal(r.start_ms, 500);
  assert.equal(r.end_ms, 1_000, "the line's end, not past it");
});

test("a word that overruns the next one gives back no room at either end", () => {
  /*
   * The first version only overlapped at the START of a run, so removing the
   * zero-floor from the END arithmetic passed — the end always had a
   * positive gap. Both ends take Math.max(0, …) and both ends are pinned.
   */
  const over = [
    { w: "a", s: 0.0, e: 0.2 },
    { w: "b", s: 0.4, e: 0.9 },
    { w: "c", s: 0.8, e: 1.2 },
  ];
  const seg: Segmentish[] = [{ idx: 0, start_ms: 0, end_ms: 1_400, words: JSON.stringify(over) }];
  /* Keep "b" alone: its end (900) is past "c"'s start (800). */
  const [r] = playableRanges(seg, [{ seg: 0, words: [0, 0] }, { seg: 0, words: [2, 2] }], FORCED);
  assert.equal(r.end_ms, 900, "a negative gap adds nothing, rather than subtracting");
  assert.equal(r.start_ms, 400 - EDGE_MS, "and the real gap on the other side still opens");
});

test("the padding never runs past the line it is in", () => {
  /*
   * The first and last words of a line have no neighbour, so the bound is
   * the line's own start and end — which came from the recogniser's sentence
   * split and belong to the line before and after.
   */
  const [r] = playableRanges(SEG, [], FORCED);
  assert.deepEqual(r, { start_ms: 0, end_ms: 2_000 }, "a whole line plays whole either way");
});

/* ── The render path says the same thing ────────────────────────────────── */

test("the runtime a person reads and the file they get agree", () => {
  /*
   * playableRanges and blockRanges carry a comment saying they must not
   * disagree — the footer's runtime is built from one and the rendered file
   * from the other. They each had their own copy of the run loop, and this
   * refinement would have been the third thing to go into one and not the
   * other.
   */
  const blocks = buildBlocks({
    segments: SEG.map((s) => ({ ...s, text: "one two three four", speaker: null })),
    beats: [],
    cuts: strike,
  });
  const fromBlocks = blocks
    .filter((b) => b.origin === "footage")
    .flatMap((b) => blockRanges(b, strike, FORCED));
  assert.deepEqual(fromBlocks, playableRanges(SEG, strike, FORCED));

  const heard = blocks
    .filter((b) => b.origin === "footage")
    .flatMap((b) => blockRanges(b, strike, HEARD));
  assert.deepEqual(heard, playableRanges(SEG, strike, HEARD));
});

test("the EDL the render is built from carries the timing", () => {
  /*
   * buildEdl takes the timing and hands it to blockRanges. Dropping that one
   * argument leaves every unit here green and every exported file cut on the
   * phoneme — the refinement would exist and reach nobody.
   */
  const blocks = buildBlocks({
    segments: SEG.map((s) => ({ ...s, text: "one two three four", speaker: null })),
    beats: [],
    cuts: strike,
  });
  const forced = buildEdl("u1/a.mp4", blocks, strike, undefined, FORCED);
  const heard = buildEdl("u1/a.mp4", blocks, strike, undefined, HEARD);
  assert.equal(forced.cuts[0].end_ms, 300 + EDGE_MS);
  assert.equal(heard.cuts[0].end_ms, 300);
  assert.ok(forced.durationMs > heard.durationMs, "breathing room is real runtime");
});

/* ── The primitive ──────────────────────────────────────────────────────── */

test("runRange is the whole rule, in one place", () => {
  const bounds = { start_ms: 0, end_ms: 2_000 };
  assert.deepEqual(runRange(words, 0, 3, bounds, false), { start_ms: 0, end_ms: 1_800 });
  assert.deepEqual(runRange(words, 1, 2, bounds, true), {
    start_ms: 500 - EDGE_MS,
    end_ms: 1_300 + EDGE_MS,
  });
  /* A frame and a half at 25fps: enough for a release and an onset, short
     enough that nothing of the neighbouring word arrives. */
  assert.ok(EDGE_MS > 0 && EDGE_MS < 100);
});
