/**
 * The second verb, and the two places it could ruin an edit.
 *
 * A pass could only ever keep or cut. Reordering is the first thing added to
 * that vocabulary, and it has exactly two ways to do damage:
 *
 *  - deciding a trim was a reorder, and rearranging a video somebody asked to
 *    shorten;
 *  - accepting an order from the model that is not a permutation, which would
 *    drop a line out of the cut or play one twice.
 *
 * Both are checked here rather than described, for the same reason
 * actionFor's are: the sentence decides, deterministically, and a model that
 * wanders outside what it was given is corrected rather than trusted.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ARRANGE_MAX, parseOrderAnswer, permutationOf, wantsArrange } from "../src/arrange.ts";

test("a sentence about the order is a reorder", () => {
  for (const t of [
    "put the punchline first",
    "start with the strongest point",
    "move the intro to the end",
    "reorder these so the story lands last",
    "swap the last two",
    "rearrange it",
    "open with the question",
    "the setup should go up front",
  ]) {
    assert.equal(wantsArrange(t), true, t);
  }
});

test("a sentence about what stays is NOT a reorder, whatever words it contains", () => {
  /* The failure worth designing against: rearranging somebody's video when
     they asked to trim it. "Cut the bit where I move house" carries the word
     move; what the sentence OPENS with is what it is about. */
  for (const t of [
    "cut the bit where I move house",
    "cut the bits where I repeat myself",
    "remove the false starts",
    "keep only the ones under 20 seconds",
    "keep the strongest points and move on",
    "just the story, none of the setup",
    "find the funniest moments",
    "give me the part about the sponsor",
    "also cut the sponsor read",
    "drop anything I said better later",
  ]) {
    assert.equal(wantsArrange(t), false, t);
  }
});

test("a sentence about neither is not a reorder", () => {
  for (const t of ["", "   ", "the funniest moments", "where I actually make the point"]) {
    assert.equal(wantsArrange(t), false, JSON.stringify(t));
  }
});

test("an order is only used when it is exactly the set it was given", () => {
  assert.deepEqual(permutationOf([2, 0, 1], 3), [2, 0, 1]);
  assert.deepEqual(permutationOf([0, 1, 2], 3), [0, 1, 2]);

  /* A dropped line would delete it from the cut. */
  assert.equal(permutationOf([0, 1], 3), null);
  /* A repeated line would play it twice. */
  assert.equal(permutationOf([0, 0, 1], 3), null);
  /* An invented line points at nothing. */
  assert.equal(permutationOf([0, 1, 9], 3), null);
  assert.equal(permutationOf([-1, 0, 1], 3), null);
  /* Prose, an object, nothing at all. */
  assert.equal(permutationOf("0,1,2", 3), null);
  assert.equal(permutationOf(null, 3), null);
  assert.equal(permutationOf([0, 1, 2, 3], 3), null);
});

test("numbers that arrive as strings still count", () => {
  /* JSON mode here is not constrained decoding; the model answering "1"
     rather than 1 is not a reason to throw the whole order away. */
  assert.deepEqual(permutationOf(["1", "0"], 2), [1, 0]);
  assert.equal(permutationOf(["1", "x"], 2), null);
  assert.equal(permutationOf([1.5, 0], 2), null);
});

test("the order is found wherever the model puts it", () => {
  assert.deepEqual(parseOrderAnswer({ response: { order: [1, 0] } }), [1, 0]);
  assert.deepEqual(parseOrderAnswer({ result: { response: { order: [1, 0] } } }), [1, 0]);
  assert.deepEqual(parseOrderAnswer({ response: '{"order":[1,0]}' }), [1, 0]);
  assert.deepEqual(parseOrderAnswer({ order: [1, 0] }), [1, 0]);
  /* Prose is not an answer. */
  assert.equal(parseOrderAnswer({ response: "I would put the punchline first." }), null);
  assert.equal(parseOrderAnswer(null), null);
});

test("there is a stated ceiling rather than a silent one", () => {
  /* A reorder over four hundred blocks is not an edit anybody meant, and the
     whole list goes into one prompt. The cap exists so the pass can SAY so
     instead of quietly arranging the first eighty. */
  assert.ok(ARRANGE_MAX > 1 && ARRANGE_MAX <= 200);
});
