/**
 * Clipping's two ways of finding a moment: scoring (the model decides) and
 * search (the user already knows). The search path and the length filter are
 * pure, so they are tested directly.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { enforceLength, searchTranscript, CLIP_LENGTHS } from "../src/shorts.ts";

const seg = (idx: number, start: number, end: number, text: string) => ({
  id: String(idx), source_id: "s", idx, start_ms: start, end_ms: end,
  speaker: null, text, words: null,
});

const SEGMENTS = [
  seg(0, 0, 8000, "So I said I'd never take money from them."),
  seg(1, 8000, 16000, "The algorithm knows me better than my wife does."),
  seg(2, 16000, 24000, "Let me read a superchat, appreciate that."),
];

const clip = (startS: number, endS: number) => ({
  start_ms: startS * 1000, end_ms: endS * 1000, quote: "", why: "", score: 50, heat: 0,
});

test("search finds the line containing the words asked for", () => {
  const hits = searchTranscript(SEGMENTS, "algorithm");
  assert.equal(hits.length, 1);
  assert.match(hits[0].quote, /algorithm knows me/);
});

test("search pads either side so a clip does not start mid-sentence", () => {
  const [hit] = searchTranscript(SEGMENTS, "algorithm", 2000);
  assert.equal(hit.start_ms, 6000);
  assert.equal(hit.end_ms, 18000);
});

test("padding never runs before the start of the video", () => {
  const [hit] = searchTranscript(SEGMENTS, "money", 5000);
  assert.equal(hit.start_ms, 0);
});

test("more of the query matched scores higher, and sorts first", () => {
  const hits = searchTranscript(SEGMENTS, "algorithm superchat");
  assert.equal(hits.length, 2);
  assert.ok(hits[0].score === hits[1].score, "one term each here");
  const better = searchTranscript(SEGMENTS, "algorithm knows wife");
  assert.equal(better[0].score, 100);
});

test("search says nothing rather than guessing when there is no match", () => {
  assert.deepEqual(searchTranscript(SEGMENTS, "cheeseburgers"), []);
  assert.deepEqual(searchTranscript(SEGMENTS, ""), []);
});

test("very short words are ignored so 'the' does not match everything", () => {
  assert.deepEqual(searchTranscript(SEGMENTS, "a of to"), []);
});

test("clips outside the requested length are dropped, not trimmed to fit", () => {
  // Trimming would clip the punchline — the model chose those boundaries
  // because that is where the thought ends.
  const kept = enforceLength([clip(0, 20), clip(0, 300)], 15, 30);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].end_ms, 20000);
});

test("a little slack either side, so good material is not lost on a technicality", () => {
  const kept = enforceLength([clip(0, 31), clip(0, 13)], 15, 30);
  assert.equal(kept.length, 2, "31s and 13s both belong in a 15-30 batch");
});

test("the batch length options are the design's own", () => {
  assert.deepEqual(CLIP_LENGTHS.map((l) => l.name), ["15–30s", "30–60s", "60–90s"]);
});
