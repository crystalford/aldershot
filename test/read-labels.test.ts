/**
 * The AUC in the label readout.
 *
 * This number decides whether somebody rewrites the scoring prompt. Every
 * wrong version of rank-based AUC returns something plausible near 0.5, so a
 * silently broken one would be read as "the scorer is weak but working" and
 * acted on. There is no output that looks like a bug.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { auc } from "../scripts/read-labels.ts";

test("perfect separation is 1, reversed is 0, interleaved is a half", () => {
  assert.equal(auc([9, 8, 7], [3, 2, 1]), 1);
  assert.equal(auc([1, 2, 3], [7, 8, 9]), 0);
  assert.equal(auc([2, 4], [1, 3]), 0.75);
  assert.equal(auc([1, 3], [2, 4]), 0.25);
});

test("a tie is worth exactly half, not whichever row came first", () => {
  /*
   * THE ONE THAT MATTERS HERE.
   *
   * `score` is a 0-100 integer a model picks round numbers from, so dozens of
   * clips share a value. A tie-blind implementation sorts them by whatever
   * order D1 returned and reports that arbitrary order as signal — which for a
   * scorer that emits mostly 80s and 90s is most of the measurement.
   */
  assert.equal(auc([5], [5]), 0.5, "one tie is a coin flip");
  assert.equal(auc([5, 5], [5, 5]), 0.5);
  /*
   * Four pairs, counted by hand so the expectation is not read off the code:
   * 9>5 = 1, 9>7 = 1, 5 vs 5 = 0.5, 5<7 = 0. That is 2.5 over 4.
   */
  assert.equal(auc([9, 5], [5, 7]), 0.625);
});

test("no positives or no negatives gives null, never a number", () => {
  /*
   * Until somebody strikes a clip inside an edit there is no negative class,
   * and the honest answer is "ask again later". Returning 0.5 for an empty
   * class would print as a real result and read as "the score is noise".
   */
  assert.equal(auc([], [1, 2]), null);
  assert.equal(auc([1, 2], []), null);
  assert.equal(auc([], []), null);
});

test("it is not affected by how many of each class there are", () => {
  /* Rank-based AUC is a rate over pairs, so an imbalanced library — which
     ours is, overwhelmingly untouched clips — does not drag it toward 0 or 1
     the way a raw accuracy would. */
  assert.equal(auc([9], [1, 2, 3, 4, 5, 6, 7, 8]), 1);
  assert.equal(auc([9, 9, 9, 9, 9, 9], [1]), 1);
});
