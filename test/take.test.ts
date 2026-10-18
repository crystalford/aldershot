/**
 * A RECORDED TAKE, CHECKED AGAINST THE LINE IT WAS MEANT TO BE.
 *
 * Phase 5's acceptance: "a recorded take aligns to the script within one
 * frame". Two halves, and only one was ever about timing.
 *
 * The timing half is forced alignment, which places words to about 20 ms —
 * half a frame. What a beat carried before was x-duration-ms, a number the
 * BROWSER sent about a file the server had not looked at.
 *
 * The other half is whether it is the same line at all. A forced aligner
 * cannot refuse: it will place a script over a recording of something else
 * and report times for every word. The score is the only honest signal.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DRIFTED_AT, MATCHES_AT, placedInOrder, readTake, scriptWords } from "../src/take.ts";
import { FRAME_MS, type Aligned } from "../src/align.ts";
import { buildBlocks } from "../src/blocks.ts";

/** n words, each 300ms long with a 200ms gap, all scoring the same. */
const run = (n: number, score = 0.95): Aligned[] =>
  Array.from({ length: n }, (_, i) => ({
    index: i,
    startMs: i * 500,
    endMs: i * 500 + 300,
    score,
  }));

/* ── The script ─────────────────────────────────────────────────────────── */

test("the line becomes the words somebody would say", () => {
  assert.deepEqual(scriptWords("The house has a room — until four."), [
    "the", "house", "has", "a", "room", "until", "four",
  ]);
  /* Numbers stay: "2019" is a word somebody says, and dropping it would
     leave the aligner a gap where a word was. */
  assert.deepEqual(scriptWords("It was 2019."), ["it", "was", "2019"]);
  assert.deepEqual(scriptWords("don't"), ["don't"]);
  assert.deepEqual(scriptWords("  "), []);
});

/* ── The verdict ────────────────────────────────────────────────────────── */

test("a clean reading of the line matches, and says so without a number", () => {
  const t = readTake(run(7), 7);
  assert.equal(t.verdict, "matches");
  assert.equal(t.reason, "it reads the line");
});

test("no SCORE reaches a person, on any verdict", () => {
  /*
   * Invariant 3, said precisely. "Only 4 of 12 words" is a count of things
   * and is the useful half of the answer; what must never appear is the
   * model's confidence — a percentage or a 0-to-1 number, which is an
   * opinion about somebody's reading dressed as a measurement.
   *
   * The first version asserted no DIGIT at all, on the one verdict whose
   * sentence happens to have none. It passed with a score spliced into the
   * sentence next to it.
   */
  const reasons = [
    readTake(run(7), 7),
    readTake(run(10), 11),
    readTake(run(7, 0.05), 7),
    readTake(run(7, 0.35), 7),
    readTake(run(4, 1), 12),
    readTake([], 7),
  ].map((t) => t.reason);

  for (const r of reasons) {
    assert.doesNotMatch(r, /%/, r);
    assert.doesNotMatch(r, /\b0?\.\d+\b/, r);
    assert.doesNotMatch(r, /\b(?:score|confidence|certainty)\b/i, r);
    /* And no bare number that is not counting words. */
    const digits = r.match(/\d+/g) ?? [];
    for (const d of digits) {
      assert.match(r, new RegExp(`${d}\\s+(?:of|words?|word)`), `${d} in "${r}" is not counting anything`);
    }
  }
});

test("a take of a different sentence is caught by how badly it matched", () => {
  /*
   * THE HALF ALIGNMENT CANNOT DO ON ITS OWN. It will place these words over
   * any audio at all and report times for every one; the score collapses
   * because the sounds are not there.
   */
  const t = readTake(run(7, 0.05), 7);
  assert.equal(t.verdict, "drifted");
  assert.match(t.reason, /not this line/);
});

test("in between is unclear, and asks for a listen rather than deciding", () => {
  const t = readTake(run(7, (MATCHES_AT + DRIFTED_AT) / 2), 7);
  assert.equal(t.verdict, "unclear");
  assert.match(t.reason, /worth listening back/);
});

test("a take that stops part-way through is drifted, however well it scores", () => {
  /*
   * Checked BEFORE the score, because the score of four words says nothing
   * about the eight that are absent.
   */
  const t = readTake(run(4, 1), 12);
  assert.equal(t.verdict, "drifted");
  assert.match(t.reason, /only 4 of 12 words/);
  assert.equal(t.unplaced, 8);
});

test("a word or two missing is still the line", () => {
  const t = readTake(run(10), 11);
  assert.equal(t.verdict, "matches");
  assert.match(t.reason, /give or take 1 word/);
});

test("the length is measured from the words, not from the file", () => {
  /*
   * x-duration-ms is what this replaces. The first word's start to the
   * last word's end — not the file's length, which includes whatever
   * silence the browser caught before and after somebody pressed a button.
   */
  /*
   * THE FIRST WORD STARTS LATE, which is the case that matters: a browser
   * catches whatever silence there was before somebody started speaking,
   * and the first version of this test began at zero — so the file's
   * length and the words' span were the same number and the test passed
   * either way.
   */
  const late = run(3).map((w) => ({ ...w, startMs: w.startMs + 2000, endMs: w.endMs + 2000 }));
  assert.equal(readTake(late, 3).durationMs, 1300, "0 to 300, 500 to 800, 1000 to 1300 — moved, not stretched");
  assert.equal(readTake(run(3), 3).durationMs, 1300);
});

test("nothing aligned, and no line to align, are different answers", () => {
  const none = readTake([], 7);
  assert.equal(none.verdict, "unclear");
  assert.match(none.reason, /nothing in the recording/);
  assert.equal(none.unplaced, 7);

  const noLine = readTake(run(3), 0);
  assert.match(noLine.reason, /no line to read/);
});

/* ── The alignment itself ───────────────────────────────────────────────── */

test("words that do not run in order are an alignment, not a take, to reject", () => {
  /*
   * Not a judgement about the recording — a judgement about the
   * alignment. One that came back confused should say so rather than have
   * a cut placed on it.
   */
  const backwards = run(3);
  backwards[2].startMs = 0;
  assert.equal(placedInOrder(backwards), false);
  const t = readTake(backwards, 3);
  assert.equal(t.verdict, "unclear");
  assert.match(t.reason, /did not line up in order/);
});

test("a word ending before it starts is the same kind of wrong", () => {
  const bad = run(2);
  bad[1].endMs = bad[1].startMs - 10;
  assert.equal(placedInOrder(bad), false);
});

test("a frame of slack, because that is the promise", () => {
  /*
   * "within one frame" is the acceptance's own measure, so a word nudged
   * less than that is in order and one nudged more is not.
   */
  const near = run(3);
  near[2].startMs = near[1].startMs - (FRAME_MS - 1);
  assert.equal(placedInOrder(near), true);

  const far = run(3);
  far[2].startMs = far[1].startMs - (FRAME_MS + 10);
  assert.equal(placedInOrder(far), false);
});

test("one word, or none, is in order by itself", () => {
  assert.equal(placedInOrder([]), true);
  assert.equal(placedInOrder(run(1)), true);
});

/* ── What the editor is told ────────────────────────────────────────────── */

test("the thresholds are far apart on purpose", () => {
  /*
   * A threshold tight enough to catch a fluffed word would reject takes a
   * person is happy with, and the person is the one who has to be happy.
   */
  assert.ok(MATCHES_AT > DRIFTED_AT * 2);
  assert.ok(MATCHES_AT < 0.9, "a good reading scores near 1, so this has room under it");
});

test("a take is never rejected — every verdict still carries its words", () => {
  /* The person was there and we were not. A drifted take is a thing the
     editor says beside the beat, not a recording thrown away. */
  for (const score of [1, 0.4, 0.01]) {
    const t = readTake(run(5, score), 5);
    assert.equal(t.words.length, 5, `score ${score} keeps its words`);
    assert.ok(t.durationMs > 0);
  }
});

test("the verdict reaches the editor, and only when it is worth saying", () => {
  /*
   * `why` on a block is the editor's one-line explanation of it, which is
   * exactly this job. "It reads the line" on every matching take would be
   * a row of reassurance nobody reads, so a match says nothing.
   */
  const beat = (over: Record<string, unknown>) => ({
    id: "b1",
    project_id: "p1",
    idx: 0,
    kind: "voice" as const,
    act: null,
    clip_id: null,
    text: "The house has a room that gets sun until four.",
    struck: null,
    dur_ms: 4000,
    media_r2_key: "u/1/beats/b1.webm",
    recorded_at: 1,
    ...over,
  });
  const whyOf = (over: Record<string, unknown>) =>
    buildBlocks({ segments: [], beats: [beat(over)], cuts: [] }).find((b) => b.origin === "voice")?.why;

  assert.equal(whyOf({ take_verdict: "matches", take_reason: "it reads the line" }), null);
  assert.equal(whyOf({ take_verdict: "drifted", take_reason: "what is said in it is not this line" }),
    "what is said in it is not this line");
  assert.equal(whyOf({ take_verdict: "unclear", take_reason: "worth listening back" }), "worth listening back");
  /* Nobody has looked yet, which is not the same as a take that failed. */
  assert.equal(whyOf({}), null);
});
