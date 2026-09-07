/**
 * The two clean-up chips, which were greyed out on a video full of the things
 * they remove.
 *
 * "why are ums uhs and tighten silences greyed out" — and the video had both.
 * The chips are disabled when their count is zero, which is the right rule;
 * the counts were wrong.
 *
 * FILLERS: the rule allowed the word plus at most one comma or full stop.
 * Whisper writes "Um..." and "Uh..." far more often than "um", and those did
 * not match.
 *
 * PAUSES: worse than a miscount. A silence has no word index of its own, so
 * the first version struck the word BEFORE it — ask to tighten a pause, lose
 * a word somebody said.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PAUSE_BEAT_MS, addCuts, fillerCuts, isSegmentCut, isWordCut, pauseCuts, playableRanges } from "../src/cuts.ts";
import { blockRanges } from "../src/blocks.ts";
import { buildEdl } from "../src/edl.ts";

/** A line whose words are half a second each, with an optional gap before one. */
const line = (idx: number, base: number, words: string[], gapBefore = -1, gapS = 3) => {
  let t = base;
  const ws = words.map((w, i) => {
    if (i === gapBefore) t += gapS;
    const s = t;
    t += 0.5;
    return { w, s, e: t };
  });
  return { idx, start_ms: base * 1000, end_ms: Math.round(t * 1000), words: JSON.stringify(ws) };
};

/* ── Fillers ─────────────────────────────────────────────────────────── */

test("the hesitations Whisper actually writes are found", () => {
  const words = ["Um...", "so", "uh,", "I", "um", "think", "Uh...", "hmm"];
  const found = fillerCuts([line(0, 0, words)]).map((c) => words[c.words![0]]);
  assert.deepEqual(found, ["Um...", "uh,", "um", "Uh...", "hmm"]);
});

test("a real word that merely starts with one is left alone", () => {
  /* The whole risk of loosening the rule: cutting "umbrella" out of a
     sentence because it begins with "um". */
  const words = ["umbrella", "ahead", "another", "erstwhile", "ermine", "mmm-hmm"];
  assert.deepEqual(fillerCuts([line(0, 0, words)]), []);
});

test("\"like\" and \"you\" are not filler, whatever a style guide says", () => {
  assert.deepEqual(fillerCuts([line(0, 0, ["like", "you", "know"])]), []);
});

/* ── Pauses ──────────────────────────────────────────────────────────── */

test("tightening a silence keeps every word that was said", () => {
  /* The bug: it struck the word before the gap. "one" must survive. */
  const seg = [line(0, 0, ["word", "one", "two", "three"], 2)];
  const cuts = pauseCuts(seg);
  const ranges = playableRanges(seg, addCuts([], cuts));

  const kept = ranges.reduce((n, r) => n + (r.end_ms - r.start_ms), 0);
  /* Four words at 500ms each, plus the beat left behind. */
  assert.equal(kept, 2000 + PAUSE_BEAT_MS);
  assert.equal(ranges[0].start_ms, 0);
  assert.equal(ranges[0].end_ms, 1000 + PAUSE_BEAT_MS, '"one" was cut out with the silence');
});

test("a beat of the silence is left, because cutting it to nothing sounds spliced", () => {
  const seg = [line(0, 0, ["a", "b", "c"], 1, 5)];
  const [first] = playableRanges(seg, addCuts([], pauseCuts(seg)));
  assert.equal(first.end_ms - first.start_ms, 500 + PAUSE_BEAT_MS);
});

test("a line with no long silence is not marked at all", () => {
  assert.deepEqual(pauseCuts([line(0, 0, ["a", "b", "c"])]), []);
});

test("one marker per line, not one per gap", () => {
  const seg = [line(0, 0, ["a", "b", "c", "d", "e"], 2)];
  assert.equal(pauseCuts(seg).length, 1);
});

test("a tightened line is not a struck line", () => {
  /* It carries words:null, which is how a struck line is stored. Everything
     that asks "is this cut?" has to tell them apart, or tightening a pause
     would strike the whole sentence. */
  const cuts = pauseCuts([line(0, 0, ["a", "b", "c"], 1)]);
  assert.equal(cuts.length, 1);
  assert.equal(isSegmentCut(cuts, 0), false, "the line reads as struck");
  assert.equal(isWordCut(cuts, 0, 0), false, "a word in it reads as cut");
  assert.equal(isWordCut(cuts, 0, 2), false);
});

test("the editor's runtime agrees with what the render will build", () => {
  /* blockRanges feeds the footer; playableRanges feeds the file. Two walks,
     and the whole product's claim is that they cannot disagree. */
  const seg = line(0, 0, ["word", "one", "two", "three"], 2);
  const cuts = pauseCuts([seg]);
  const fromFile = playableRanges([seg], cuts).reduce((n, r) => n + (r.end_ms - r.start_ms), 0);

  const block = {
    id: "s:0", origin: "footage" as const, start_ms: seg.start_ms, end_ms: seg.end_ms,
    text: "", words: JSON.parse(seg.words), struck: false, score: null, why: null,
    mediaKey: null, previewKey: null, voiceKey: null, posterKey: null,
  };
  const fromEditor = blockRanges(block, cuts).reduce((n, r) => n + (r.end_ms - r.start_ms), 0);
  assert.equal(fromEditor, fromFile);
});

test("silence BETWEEN lines never needed a chip — it is already gone", () => {
  /* Ranges are per line and are only merged when they touch, so the gap
     between two lines never reaches the render. This is why the chip finds so
     little: Whisper breaks a segment at a pause, so the silence is nearly
     always between lines rather than inside one. */
  const segs = [line(0, 0, ["a", "b"]), line(1, 10, ["c", "d"])];
  assert.deepEqual(pauseCuts(segs), []);
  assert.deepEqual(playableRanges(segs, []), [
    { start_ms: 0, end_ms: 1000 },
    { start_ms: 10000, end_ms: 11000 },
  ]);
});

test("and what reaches ffmpeg is the tightened line, in two pieces", () => {
  /* blockRanges feeds buildEdl, which is the plan the encoder is handed. If
     the silence survived this far it would be in the finished video. */
  const seg = line(0, 0, ["word", "one", "two", "three"], 2);
  const cuts = pauseCuts([seg]);
  const block = {
    id: "s:0", origin: "footage" as const, start_ms: seg.start_ms, end_ms: seg.end_ms,
    text: "word one two three", words: JSON.parse(seg.words), struck: false,
    score: null, why: null, mediaKey: null, previewKey: null, voiceKey: null, posterKey: null,
  };

  const plain = buildEdl("src.mp4", [block], []);
  assert.equal(plain.cuts.length, 1, "an untouched line is one piece");
  assert.equal(plain.cuts[0].end_ms - plain.cuts[0].start_ms, 5000);

  const tight = buildEdl("src.mp4", [block], cuts);
  assert.equal(tight.cuts.length, 2, "the silence was not taken out of the plan");
  const total = tight.cuts.reduce((n, c) => n + (c.end_ms - c.start_ms), 0);
  assert.equal(total, 2000 + PAUSE_BEAT_MS);
  /* Every word still there: the first piece runs past "one", not up to it. */
  assert.equal(tight.cuts[0].end_ms, 1000 + PAUSE_BEAT_MS);
  assert.equal(tight.cuts[1].start_ms, 4000);
});
