/**
 * A PARTIAL ALIGNMENT IS NOT A FRAME-ACCURATE VIDEO.
 *
 * stitchAlignment skips a window that came back empty, without a word — the
 * words inside it keep their recogniser timings and nothing says so. The
 * source was then written as `forced` on the strength of "something moved",
 * so one failed window out of thirty produced a video claiming frame accuracy
 * with a minute of guesswork in the middle of it.
 *
 * Invariant 7's subject exactly: the job was green, the row looked right, and
 * the only way to find out was to go and look at the one place it was wrong.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { claimsFrameAccurate, failedWindowCount } from "../src/align-source.ts";
import { stitchAlignment, type AlignWindow } from "../src/align.ts";

const win = (first: number, last: number, startMs: number): AlignWindow =>
  ({ first, last, startMs, endMs: startMs + 1000, words: [] }) as AlignWindow;

test("ACCEPTANCE: one failed window withholds the frame-accurate claim", () => {
  /* The whole bug in one assertion. 29 of 30 is not 30 of 30, and the claim
     is about the video, not about the average. */
  assert.equal(claimsFrameAccurate({ moved: 2900, failedWindows: 1 }), false);
  assert.equal(claimsFrameAccurate({ moved: 3000, failedWindows: 0 }), true);
});

test("and a run that placed nothing never claimed it anyway", () => {
  /* The case the old comment covered. Still covered. */
  assert.equal(claimsFrameAccurate({ moved: 0, failedWindows: 0 }), false);
  assert.equal(claimsFrameAccurate({ moved: 0, failedWindows: 30 }), false);
});

test("a truncated batch is counted, not just an explicit failure", () => {
  /*
   * A container that dies halfway returns FEWER results than it was given
   * windows rather than a list of failures. stitchAlignment reads
   * results[wi] and skips undefined exactly as it skips !ok, so counting
   * only `!r.ok` would call a half-finished run complete.
   */
  assert.equal(failedWindowCount(4, [{ ok: true }, { ok: true }]), 2, "the missing tail was not counted");
  assert.equal(failedWindowCount(4, [{ ok: true }, { ok: false }, { ok: true }, { ok: true }]), 1);
  assert.equal(failedWindowCount(4, []), 4);
  assert.equal(failedWindowCount(0, []), 0);
});

test("the words in a failed window really are left behind, which is why it matters", () => {
  /*
   * Not a test of the fix — a test of the thing the fix is about. If
   * stitchAlignment ever started filling gaps, the claim above would be too
   * conservative and somebody should know.
   */
  const windows = [win(0, 1, 0), win(2, 3, 2000)];
  const placed = stitchAlignment(windows, [
    { ok: true, timings: [[0, 0.5, 0.9], [0.5, 1, 0.9]] },
    { ok: false },
  ]);
  assert.deepEqual(placed.map((p) => p.index), [0, 1], "it placed words from the failed window");
  assert.equal(placed.length, 2, "two of four words were left on their old timings, silently");
});

test("a window whose results are missing is skipped the same way", () => {
  const windows = [win(0, 1, 0), win(2, 3, 2000)];
  const placed = stitchAlignment(windows, [{ ok: true, timings: [[0, 0.5, 0.9], [0.5, 1, 0.9]] }]);
  assert.equal(placed.length, 2, "the absent second window contributed words from nowhere");
});
