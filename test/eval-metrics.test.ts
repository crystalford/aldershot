/**
 * THE FOUR NUMBERS, against worked examples.
 *
 * Every one of these is a figure somebody will quote in a decision about a
 * model or a threshold, so each is pinned to an example small enough to
 * check by hand. A metric nobody has arithmetic for is a number nobody has
 * reason to believe — which is the same reason the eval harness is
 * typechecked at all.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agreement,
  backingOf,
  falseSupportRate,
  perLabel,
  recallAt,
  type Prediction,
} from "../src/eval-metrics.ts";
import { VERDICTS, type Verdict } from "../src/eval-set.ts";

/* ── Recall@k ───────────────────────────────────────────────────────────── */

test("recall@5 asks only whether a backing moment made the top five", () => {
  const r = recallAt([
    { claimId: "a", ranked: ["1", "2", "3", "4", "5", "6"], backing: ["3"] },
    { claimId: "b", ranked: ["1", "2", "3", "4", "5", "6"], backing: ["6"] },
  ]);
  assert.equal(r.of, 2);
  assert.equal(r.found, 1);
  assert.equal(r.recall, 0.5);
});

test("a claim nothing backs is not a miss, it is the set's negative", () => {
  /*
   * "Nothing here backs this" is an answer this product is built to give.
   * Scoring those claims as failures would push recall down for getting the
   * right answer — and would make a system that invents support look better
   * than one that refuses.
   */
  const r = recallAt([
    { claimId: "a", ranked: ["1"], backing: ["1"] },
    { claimId: "none", ranked: ["7", "8"], backing: [] },
  ]);
  assert.equal(r.of, 1, "recall is of the claims that have something to find");
  assert.equal(r.recall, 1);
  assert.equal(r.unbacked, 1, "and the rest are counted, not hidden");
});

test("recall of a set with nothing to find is unknown, not zero", () => {
  const r = recallAt([{ claimId: "none", ranked: ["1"], backing: [] }]);
  assert.equal(r.recall, null);
});

test("k is the cut, and moving it moves the answer", () => {
  const claims = [{ claimId: "a", ranked: ["1", "2", "3", "4", "5", "6"], backing: ["6"] }];
  assert.equal(recallAt(claims, 5).recall, 0);
  assert.equal(recallAt(claims, 6).recall, 1);
});

test("a backing moment retrieval never returned is a miss", () => {
  const r = recallAt([{ claimId: "a", ranked: ["1", "2"], backing: ["9"] }]);
  assert.equal(r.recall, 0);
});

/* ── The judge, per label ───────────────────────────────────────────────── */

const p = (said: Verdict, truth: Verdict, i = 0): Prediction => ({
  claimId: "c",
  clipId: `x${i}`,
  said,
  truth,
});

test("precision and recall are per label, because overall hides the near-miss", () => {
  /*
   * A judge that never says "related, not enough" can look excellent overall
   * — near-misses are a minority of any set — while being useless at the one
   * job the threshold exists for.
   */
  const preds = [
    p("backs", "backs", 1),
    p("backs", "related", 2),
    p("unrelated", "unrelated", 3),
    p("unrelated", "related", 4),
  ];
  const s = perLabel(preds, VERDICTS);
  assert.deepEqual(s.backs, { support: 1, said: 2, hit: 1, precision: 0.5, recall: 1 });
  assert.equal(s.related.support, 2);
  assert.equal(s.related.said, 0);
  assert.equal(s.related.recall, 0, "it found none of them");
  assert.equal(s.related.precision, null, "and has no precision, which is not precision 0");
});

test("a label nobody used at all has neither figure", () => {
  const s = perLabel([p("backs", "backs")], VERDICTS);
  assert.equal(s.unrelated.precision, null);
  assert.equal(s.unrelated.recall, null);
});

/* ── False support ──────────────────────────────────────────────────────── */

test("calling a near-miss support is as wrong as calling a stranger support", () => {
  /*
   * Decision 21: three-way label, our threshold, near-miss negatives. A
   * `related` moment presented under a claim as its receipt is the exact
   * failure the whole set exists to catch, not a near-enough answer.
   */
  const r = falseSupportRate([
    p("backs", "backs", 1),
    p("backs", "related", 2),
    p("backs", "unrelated", 3),
    p("unrelated", "backs", 4),
  ]);
  assert.equal(r.said, 3, "measured over everything it called support");
  assert.equal(r.wrong, 2);
  assert.ok(Math.abs(r.rate! - 2 / 3) < 1e-9);
});

test("a judge that never claims support has no false-support rate", () => {
  /* Zero would read as perfect. It is a judge that answered nothing. */
  const r = falseSupportRate([p("unrelated", "backs")]);
  assert.equal(r.said, 0);
  assert.equal(r.rate, null);
});

/* ── Agreement ──────────────────────────────────────────────────────────── */

const m = (pairs: Array<[string, Verdict]>) => new Map<string, Verdict>(pairs);

test("agreement is only of the items both people judged", () => {
  const a = m([["1", "backs"], ["2", "related"], ["3", "unrelated"]]);
  const b = m([["1", "backs"], ["2", "unrelated"]]);
  const got = agreement(a, b, VERDICTS);
  assert.equal(got.both, 2, "item 3 is one person's opinion, not an agreement");
  assert.equal(got.same, 1);
  assert.equal(got.raw, 0.5);
});

test("two people who always say the same thing agree by chance, and kappa says so", () => {
  /*
   * THE WHOLE REASON KAPPA IS HERE. If 90% of a set is `unrelated`, two
   * labellers who answer `unrelated` to nearly everything agree nearly all
   * the time and have told you nothing about whether the set is sound.
   */
  const keys = Array.from({ length: 10 }, (_, i) => String(i));
  const a = m(keys.map((k, i) => [k, i === 0 ? "backs" : "unrelated"] as [string, Verdict]));
  const b = m(keys.map((k, i) => [k, i === 1 ? "backs" : "unrelated"] as [string, Verdict]));
  const got = agreement(a, b, VERDICTS);
  assert.equal(got.raw, 0.8, "they look like they agree");
  assert.ok(got.kappa! < 0.2, `and kappa says they barely do: ${got.kappa}`);
});

test("real agreement reads as real agreement", () => {
  const a = m([["1", "backs"], ["2", "backs"], ["3", "related"], ["4", "unrelated"]]);
  const b = m([["1", "backs"], ["2", "backs"], ["3", "related"], ["4", "unrelated"]]);
  const got = agreement(a, b, VERDICTS);
  assert.equal(got.raw, 1);
  assert.ok(got.kappa! > 0.9);
});

test("perfect agreement on one answer is not measurable, and does not claim to be", () => {
  /* Both said `unrelated` to everything. Chance agreement is also 1, so the
     formula divides by zero — and 1 would be a claim that they agree, when
     nothing has distinguished them from two people asleep. */
  const a = m([["1", "unrelated"], ["2", "unrelated"]]);
  const b = m([["1", "unrelated"], ["2", "unrelated"]]);
  const got = agreement(a, b, VERDICTS);
  assert.equal(got.raw, 1);
  assert.equal(got.kappa, null);
});

test("two people who never overlapped have no agreement to report", () => {
  const got = agreement(m([["1", "backs"]]), m([["2", "backs"]]), VERDICTS);
  assert.equal(got.both, 0);
  assert.equal(got.kappa, null);
  assert.equal(got.raw, null, "not 0 — nobody disagreed either");
});

test("total disagreement is worse than chance, and kappa goes negative", () => {
  const a = m([["1", "backs"], ["2", "unrelated"]]);
  const b = m([["1", "unrelated"], ["2", "backs"]]);
  const got = agreement(a, b, VERDICTS);
  assert.equal(got.raw, 0);
  assert.ok(got.kappa! < 0);
});

/* ── What the set says is true ──────────────────────────────────────────── */

test("a moment both labellers called support is what backs the claim", () => {
  const got = backingOf([
    { clipId: "a", verdict: "backs" },
    { clipId: "a", verdict: "backs" },
    { clipId: "b", verdict: "unrelated" },
    { clipId: "b", verdict: "unrelated" },
  ]);
  assert.deepEqual(got, ["a"]);
});

test("a moment they disagreed about is not truth", () => {
  /*
   * THE CASE THE WHOLE SET EXISTS FOR. One person says it backs the claim,
   * the other says it is near. Counting it as backing would score retrieval
   * as correct for finding something the labellers could not agree on —
   * rewarding the pipeline for the exact mistake the three-way label was
   * introduced to catch.
   */
  assert.deepEqual(
    backingOf([
      { clipId: "a", verdict: "backs" },
      { clipId: "a", verdict: "related" },
    ]),
    [],
  );
});

test("one person's answer stands when nobody else looked", () => {
  /* Throwing away single-judged moments would discard most of any real set. */
  assert.deepEqual(backingOf([{ clipId: "a", verdict: "backs" }]), ["a"]);
});

test("a claim with nothing left is a claim nothing backs, which is a result", () => {
  assert.deepEqual(backingOf([{ clipId: "a", verdict: "related" }]), []);
  assert.deepEqual(backingOf([]), []);
});
