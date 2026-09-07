/**
 * Whisper hallucinates on silence.
 *
 * Point it at a quiet passage and it returns runs of "you", "Thank you.",
 * "Thanks for watching!" — each with start and end collapsed onto the same
 * instant. The owner hit it: a wall of blocks reading "you", every one 0:00
 * long, in the middle of a cut. Nothing filtered them; every segment the model
 * returned went straight into the table.
 *
 * The rule is the duration, never the words. "you" is a real word.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { saidAloud } from "../src/sources.ts";

test("a zero-length segment is not something anybody said", () => {
  assert.equal(saidAloud({ start: 224.1, end: 224.1, text: "you" }), false);
});

test("the whole hallucinated run goes, however many there are", () => {
  const run = Array.from({ length: 8 }, (_, i) => ({ start: 224 + i * 0.01, end: 224 + i * 0.01, text: "you" }));
  assert.deepEqual(run.filter(saidAloud), []);
});

test("a real line survives, including one that is just \"you\"", () => {
  /* The word is not the problem and a rule that threw it away would
     eventually eat a real line. */
  assert.equal(saidAloud({ start: 10, end: 10.4, text: "you" }), true);
  assert.equal(saidAloud({ start: 10, end: 12.5, text: "Thank you." }), true);
});

test("empty text is dropped whatever its duration claims", () => {
  assert.equal(saidAloud({ start: 0, end: 5, text: "" }), false);
  assert.equal(saidAloud({ start: 0, end: 5, text: "   " }), false);
});

test("a short real utterance is kept, not judged", () => {
  /* The first version of this used an 80ms floor and, checked against the
     database, had removed a real 60ms line. A rule about what counts as
     speech does not belong in a hallucination filter: any duration at all
     means something was said. */
  assert.equal(saidAloud({ start: 1.94, end: 2.0, text: "Thank you." }), true);
  assert.equal(saidAloud({ start: 0, end: 0.01, text: "a" }), true);
});

test("a backwards segment is not rescued by having text", () => {
  assert.equal(saidAloud({ start: 12, end: 11, text: "you" }), false);
});
