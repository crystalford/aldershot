/**
 * The arithmetic in the retrieval harness.
 *
 * Six lines of counting, in a dev script nobody runs on a schedule — which is
 * exactly why it gets a test. The harness exists to decide whether clips are
 * the right retrieval unit, whether a context prefix helps, whether a reranker
 * is worth its latency. Every one of those decisions is read off these
 * numbers, so a number that is quietly 10% too kind sends the whole retrieval
 * plan the wrong way and leaves no trace of having done it.
 *
 * Both mistakes pinned here flatter the result, which is the direction a
 * mistake in an evaluation always seems to go.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { tally, idsIn } from "../scripts/eval-retrieval.ts";

test("recall@k counts a clip at rank k-1 and not one at rank k", () => {
  /* Off by one and @1 silently becomes @2: a search that puts the right clip
     second starts reporting as if it put it first. */
  const { hits } = tally([0, 1, 4, 5, 9], [1, 5, 10]);
  assert.equal(hits[1], 1, "only rank 0 is in the top 1");
  assert.equal(hits[5], 3, "ranks 0, 1 and 4 — rank 5 is the sixth result");
  assert.equal(hits[10], 5);
});

test("MRR is over every query asked, not only the ones that found something", () => {
  /*
   * THE ONE THAT MATTERS.
   *
   * Dividing by the hits instead of the queries reports a pipeline that finds
   * one clip out of a hundred as a perfect 1.0 — the most flattering possible
   * number attached to the worst possible result, and nothing about it looks
   * wrong.
   */
  const one = tally([0, ...Array(99).fill(null)]);
  assert.equal(one.n, 100);
  assert.equal(one.missing, 99);
  assert.ok(Math.abs(one.mrr - 0.01) < 1e-9, `got ${one.mrr}`);

  /* And the reciprocal itself is 1/(rank+1), so second place is worth a half. */
  assert.equal(tally([1]).mrr, 0.5);
  assert.equal(tally([]).mrr, 0, "no queries is zero, not a division by zero");
});

test("a clip that never came back is a miss, not an absence", () => {
  /* Dropping misses from the denominator is the same lie as above wearing a
     different hat: it turns "we could not find it" into "we never asked". */
  const t = tally([null, null, 0], [1]);
  assert.equal(t.n, 3);
  assert.equal(t.hits[1], 1);
  assert.ok(Math.abs(t.mrr - 1 / 3) < 1e-9);
});

test("ids come out of the page in the order the page lists them", () => {
  /*
   * Rank only means anything because searchMeaning preserves the order
   * Vectorize returned and the grid renders it in that order. If this ever
   * collected ids into a set, or sorted them, every rank would be arbitrary
   * and the recall numbers would be measuring the alphabet.
   */
  const html = `<div data-moment="c3" data-clip="c3"></div><div data-moment="c1"></div><div data-moment="c2"></div>`;
  assert.deepEqual(idsIn(html), ["c3", "c1", "c2"]);
  assert.equal(idsIn("<div>nothing here</div>").length, 0);
});
