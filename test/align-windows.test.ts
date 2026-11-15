/**
 * WINDOWS, AND THE STITCH THAT PUTS THEM BACK TOGETHER.
 *
 * A ten-hour source cannot be forced-aligned in one pass — the acoustic
 * model holds activations for every sample at once — so it is aligned in
 * pieces and the pieces are joined. Both halves of that are decisions, so
 * both live in src/align.ts where a test can reach them, and the container
 * is handed windows as data. Same split render.mjs makes with the EDL.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OVERLAP_WORDS,
  WINDOW_MS,
  monotonic,
  planAlignWindows,
  stitchAlignment,
  type AlignWindow,
  type IndexedWord,
  type WindowTiming,
} from "../src/align.ts";

/** A word every `gap` ms, each `len` ms long. */
const words = (n: number, gap = 500, len = 300): IndexedWord[] =>
  Array.from({ length: n }, (_, i) => ({
    index: i,
    text: `w${i}`,
    startMs: i * gap,
    endMs: i * gap + len,
  }));

test("an empty source plans no windows rather than one empty one", () => {
  assert.deepEqual(planAlignWindows([]), []);
});

test("a short source is one window, padded either side", () => {
  const w = planAlignWindows(words(4));
  assert.equal(w.length, 1);
  assert.equal(w[0].first, 0);
  assert.equal(w[0].last, 3);
  /* The pad is audio either side of the words, for the recogniser's own
     110ms of error. It cannot go below zero: there is no audio there. */
  assert.equal(w[0].startMs, 0);
  assert.equal(w[0].endMs, 1500 + 300 + 300);
  assert.deepEqual(w[0].words, ["w0", "w1", "w2", "w3"]);
});

test("every window holds about thirty seconds and no more", () => {
  const src = words(400);
  for (const w of planAlignWindows(src)) {
    const span = src[w.last].endMs - src[w.first].startMs;
    assert.ok(span <= WINDOW_MS, `a window held ${span}ms of words`);
  }
});

test("every word lands in a window, and the overlap really overlaps", () => {
  const src = words(400);
  const plan = planAlignWindows(src);
  assert.ok(plan.length > 5, "400 words at half a second each is several windows");

  const seen = new Set<number>();
  for (const w of plan) for (let i = w.first; i <= w.last; i += 1) seen.add(i);
  assert.equal(seen.size, src.length, "a word in no window keeps a recogniser timing for ever");

  for (let i = 1; i < plan.length; i += 1) {
    assert.ok(
      plan[i].first <= plan[i - 1].last,
      "neighbours share words, so an edge reading can be beaten by an interior one",
    );
    assert.ok(plan[i].first > plan[i - 1].first, "and the plan always advances");
  }
});

test("a single absurd word is its own window rather than an endless loop", () => {
  /*
   * A recogniser timing can be nonsense — a word reported as forty seconds
   * long. The first version of the loop refused to advance past one and
   * planned windows until the process died.
   */
  const src: IndexedWord[] = [
    { index: 0, text: "a", startMs: 0, endMs: 40_000 },
    { index: 1, text: "b", startMs: 40_500, endMs: 40_800 },
  ];
  const plan = planAlignWindows(src);
  assert.ok(plan.length >= 1 && plan.length < 10);
  assert.equal(plan[0].first, 0);
  assert.ok(plan[plan.length - 1].last === 1);
});

/* ── The stitch ─────────────────────────────────────────────────────────── */

const win = (first: number, last: number, startMs: number): AlignWindow => ({
  startMs,
  endMs: startMs + 30_000,
  first,
  last,
  words: Array.from({ length: last - first + 1 }, (_, i) => `w${first + i}`),
});

const ok = (timings: WindowTiming[]) => ({ ok: true, timings });

test("a window's times are seconds inside it, and come back as source milliseconds", () => {
  const got = stitchAlignment([win(0, 1, 10_000)], [ok([[0.5, 0.75, 1], [1.0, 1.2, 1]])]);
  assert.deepEqual(got, [
    { index: 0, startMs: 10_500, endMs: 10_750, score: 1 },
    { index: 1, startMs: 11_000, endMs: 11_200, score: 1 },
  ]);
});

test("a word in two windows is taken from the one that heard it inside", () => {
  /*
   * THE WHOLE REASON WINDOWS OVERLAP. Forced alignment consumes all of the
   * audio it is given, so the word at an edge absorbs the pad and its span
   * runs long. The same word three words in has no such problem.
   */
  const a = win(0, 3, 0);
  const b = win(3, 6, 1_000);
  const got = stitchAlignment(
    [a, b],
    [
      /* w3 is LAST in a — an edge — and reads long. */
      ok([[0, 0.2, 1], [0.5, 0.7, 1], [1.0, 1.2, 1], [1.5, 2.9, 0.9]]),
      /* and FIRST in b, which is also an edge, but b has it at distance 0
         too — so the score settles it. */
      ok([[0.6, 0.75, 0.95], [1.1, 1.3, 1], [1.6, 1.8, 1], [2.1, 2.3, 1]]),
    ],
  );
  const w3 = got.find((g) => g.index === 3)!;
  assert.equal(w3.startMs, 1_600, "b's reading won on score at equal distance from an edge");
  assert.equal(got.length, 7);
});

test("the interior reading beats the edge reading even when the edge is surer", () => {
  const a = win(0, 4, 0);
  const b = win(2, 6, 1_000);
  const got = stitchAlignment(
    [a, b],
    [
      /* w4 is a's last word: distance 0, score 1. */
      ok([[0, 0.1, 1], [0.2, 0.3, 1], [0.4, 0.5, 1], [0.6, 0.7, 1], [0.8, 0.9, 1]]),
      /* w4 is b's third of five: distance 2, score 0.5. Distance wins. */
      ok([[0, 0.1, 0.5], [0.2, 0.3, 0.5], [0.4, 0.5, 0.5], [0.6, 0.7, 0.5], [0.8, 0.9, 0.5]]),
    ],
  );
  const w4 = got.find((g) => g.index === 4)!;
  assert.equal(w4.startMs, 1_400, "b's interior reading, not a's confident edge");
});

test("a window that failed costs its words nothing but their alignment", () => {
  const got = stitchAlignment(
    [win(0, 1, 0), win(2, 3, 1_000)],
    [{ ok: false }, ok([[0.1, 0.2, 1], [0.3, 0.4, 1]])],
  );
  assert.deepEqual(got.map((g) => g.index), [2, 3], "the failed window's words are simply absent");
});

test("a window that says it failed is not read, whatever else it carries", () => {
  /*
   * The first version of this only sent `{ ok: false }` with no timings, so
   * it passed with the `ok` check removed — it was proving that a window
   * with no data has no data. The aligner does not currently send both, and
   * a stitch that trusted it to keep not doing so is a stitch that reads
   * numbers from a window that told it they were wrong.
   */
  const got = stitchAlignment(
    [win(0, 1, 0)],
    [{ ok: false, timings: [[0.1, 0.2, 1], [0.3, 0.4, 1]] }],
  );
  assert.deepEqual(got, []);
});

test("a word the aligner could not place is absent, not zero", () => {
  /*
   * A number, an emoji, a script the model has no letters for. Absent means
   * the caller keeps the recogniser's timing, which is worse and is honest.
   * A zero would put the word at the start of the source.
   */
  const got = stitchAlignment([win(0, 2, 5_000)], [ok([[0.1, 0.2, 1], null, [0.5, 0.6, 1]])]);
  assert.deepEqual(got.map((g) => g.index), [0, 2]);
});

/* ── Monotonicity ───────────────────────────────────────────────────────── */

test("nothing needs repairing when the words are already in order", () => {
  const { words: out, repaired } = monotonic([
    { index: 0, startMs: 100, endMs: 200, score: 1 },
    { index: 1, startMs: 300, endMs: 400, score: 1 },
  ]);
  assert.equal(repaired, 0);
  assert.equal(out[1].startMs, 300);
});

test("a word that starts before the one in front of it is pulled forward, and counted", () => {
  /*
   * Two windows can disagree by a few milliseconds and at a seam that puts a
   * word behind its neighbour. spanFor walks words in order and
   * playableRanges builds a render from them, so one word out of order is a
   * cut that plays backwards. The COUNT is the point: one is fine, four
   * hundred is a window size or a transcript problem a silent clamp would
   * hide for ever.
   */
  const { words: out, repaired } = monotonic([
    { index: 0, startMs: 1_000, endMs: 1_200, score: 1 },
    { index: 1, startMs: 950, endMs: 1_100, score: 1 },
  ]);
  assert.equal(repaired, 1);
  assert.equal(out[1].startMs, 1_000);
});

test("a word that ends before it starts is given no length rather than a negative one", () => {
  const { words: out, repaired } = monotonic([{ index: 0, startMs: 500, endMs: 400, score: 1 }]);
  assert.equal(out[0].endMs, 500);
  assert.equal(repaired, 1);
});

test("the overlap is shared words, not shared milliseconds", () => {
  /* If OVERLAP_WORDS were ever set to 0 the stitch would still work and
     every word would be an edge reading — the quality loss would be
     invisible. This pins the constant to its purpose. */
  assert.ok(OVERLAP_WORDS >= 2, "an overlap of one word gives every word an edge reading");
});
