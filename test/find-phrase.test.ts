/**
 * Find, and cut every match.
 *
 * This is the gesture that makes an hour of footage tractable — "find the
 * sponsor read, cut all fourteen" — so the thing it must never do is find more
 * than was said. A find that over-matches, wired to a button that says "cut
 * all", removes footage the user never asked about.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { addCuts, findPhrase, phraseCuts, playableRanges, timeSaved } from "../src/cuts.ts";

/** A word a second, starting at `base`. */
const seg = (idx: number, base: number, text: string) => ({
  idx,
  start_ms: base * 1000,
  end_ms: (base + text.split(" ").length) * 1000,
  words: JSON.stringify(text.split(" ").map((w, i) => ({ w, s: base + i, e: base + i + 1 }))),
});

const SEGMENTS = [
  seg(0, 0, "this episode is brought to you by the sponsor, a great sponsor"),
  seg(1, 12, "back to the show now that the sponsor read is done"),
];

test("finds a word wherever it was said", () => {
  const hits = findPhrase(SEGMENTS, "sponsor");
  assert.equal(hits.length, 3);
  assert.deepEqual(hits.map((h) => h.seg), [0, 0, 1]);
});

test("punctuation stuck to a spoken word does not hide it", () => {
  /* "sponsor," is the eighth word of line 0 and must match "sponsor". */
  const hits = findPhrase(SEGMENTS, "sponsor");
  assert.ok(hits.some((h) => h.seg === 0 && h.from === 8));
});

test("case is not a reason to miss a match", () => {
  assert.equal(findPhrase(SEGMENTS, "SPONSOR").length, 3);
});

test("a phrase matches across word boundaries, and only in order", () => {
  const hits = findPhrase(SEGMENTS, "sponsor read");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].seg, 1);
  assert.equal(hits[0].to - hits[0].from, 1);

  assert.equal(findPhrase(SEGMENTS, "read sponsor").length, 0);
});

test("a match carries the timings the render needs", () => {
  const [first] = findPhrase(SEGMENTS, "brought");
  assert.equal(first.start_ms, 3000);
  assert.equal(first.end_ms, 4000);
});

test("a match reads like something someone said", () => {
  const [hit] = findPhrase(SEGMENTS, "brought");
  assert.equal(hit.hit, "brought");
  assert.ok(hit.before.endsWith("is"));
  assert.ok(hit.after.startsWith("to you"));
});

test("one letter finds nothing, because cutting all of it is not a feature", () => {
  assert.deepEqual(findPhrase(SEGMENTS, "a"), []);
  assert.deepEqual(findPhrase(SEGMENTS, " "), []);
  assert.deepEqual(findPhrase(SEGMENTS, ""), []);
});

test("overlapping repeats are counted once each, never twice", () => {
  const na = [seg(0, 0, "na na na na")];
  assert.equal(findPhrase(na, "na na").length, 2);
});

test("the limit is a limit", () => {
  const many = [seg(0, 0, Array.from({ length: 50 }, () => "yes").join(" "))];
  assert.equal(findPhrase(many, "yes", 10).length, 10);
});

test("cutting every match removes exactly those words and nothing else", () => {
  const hits = findPhrase(SEGMENTS, "sponsor");
  const cuts = phraseCuts(hits);
  assert.equal(cuts.length, 3);

  /* Three words, a second each — and the figure the button shows is the
     figure the render loses. */
  assert.equal(timeSaved(SEGMENTS, [], cuts), 3000);

  const before = playableRanges(SEGMENTS, []).reduce((n, r) => n + (r.end_ms - r.start_ms), 0);
  const after = playableRanges(SEGMENTS, addCuts([], cuts)).reduce((n, r) => n + (r.end_ms - r.start_ms), 0);
  assert.equal(before - after, 3000);
});
