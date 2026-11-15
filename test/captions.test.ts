/**
 * CAPTIONS THAT CAN BE READ.
 *
 * Doc 09 asks for ≤17 characters a second, a subtitle file alongside, and no
 * stacking on burned-in subtitles — and says the row is "checked on every
 * export, not offered as a fix". So the tests come in two halves: the cues a
 * cut produces actually read at the limit, and where they cannot, the thing
 * that is wrong is REPORTED rather than quietly rewritten.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CUE_GAP_MS,
  MAX_CPS,
  MAX_CUE_CHARS,
  MAX_CUE_MS,
  MAX_LINE_CHARS,
  MIN_CUE_MS,
  chunk,
  cps,
  cuesFromWords,
  overTheLimit,
  sidecarWanted,
  stretch,
  wrap,
  type TimedWord,
} from "../src/captions.ts";
import { buildEdl, captionCues, buildSrt } from "../src/edl.ts";
import type { Block } from "../src/blocks.ts";

/** Words laid end to end at a given rate, starting at `from`. */
function say(text: string, msPerWord: number, from = 0): TimedWord[] {
  return text.split(" ").map((w, i) => ({
    w,
    startMs: from + i * msPerWord,
    endMs: from + (i + 1) * msPerWord - 10,
  }));
}

const rate = (c: { text: string; start_ms: number; end_ms: number }) =>
  cps(c.text.replace(/\n/g, " "), c.end_ms - c.start_ms) ?? 0;

test("characters a second, and no answer where there is no time", () => {
  assert.equal(cps("abcdefghij", 1000), 10);
  assert.equal(cps("abcdefghij", 500), 20);
  assert.equal(cps("abc", 0), null, "a zero-length cue has no rate, it has a bug");
  assert.equal(cps("abc", -5), null);
});

test("a long line becomes several cues, broken only between words", () => {
  const words = say(
    "The first four weeks are about showing up and nothing else and nobody tells you that the second month is the one that actually hurts",
    260,
  );
  const runs = chunk(words);
  assert.ok(runs.length > 1, "it did not split at all");
  for (const run of runs) {
    const text = run.map((w) => w.w).join(" ");
    assert.ok(text.length <= MAX_CUE_CHARS, `"${text}" is ${text.length} characters`);
  }
  /* Every word survives, in order: a caption that drops a word is worse than
     one that reads fast. */
  assert.deepEqual(runs.flat().map((w) => w.w), words.map((w) => w.w));
});

test("a single word longer than a cue is kept whole", () => {
  /* Truncating is never right. One over-long cue is a legible failure; half a
     word is not. */
  const long = "a".repeat(MAX_CUE_CHARS + 20);
  const runs = chunk([{ w: long, startMs: 0, endMs: 1000 }]);
  assert.equal(runs.length, 1);
  assert.equal(runs[0][0].w, long);
});

test("two lines of 42, wrapped at a space", () => {
  const text = "The house has a room that gets sun until four and I have thought about it";
  const wrapped = wrap(text);
  const lines = wrapped.split("\n");
  assert.ok(lines.length >= 2);
  for (const l of lines) assert.ok(l.length <= MAX_LINE_CHARS, `"${l}" is ${l.length}`);
  assert.equal(wrapped.replace(/\n/g, " "), text, "wrapping changes no words");
});

test("ACCEPTANCE: cues read at seventeen characters a second or under", () => {
  /*
   * Ordinary speech, around 150 words a minute. Every cue has to be inside
   * the limit — checked on every cue rather than on an average, because an
   * average hides the one line nobody could read.
   *
   * WHY THE RATE OF THE FIXTURE MATTERS. 17 cps is a READING rate, and
   * chunking cannot change a speaking rate: halve a cue's characters and you
   * halve its seconds with them, so the quotient is the same. Somebody
   * talking at 20 cps produces 20 cps cues however they are cut, and the only
   * levers are the pause after a line and cutting the words down — which this
   * product will not do to a person's own speech. So this fixture speaks at a
   * rate a person can be captioned at, and the test two below it covers the
   * one who does not.
   */
  const words = say(
    "The first four weeks are about showing up and nothing else and nobody tells you that the second month is the one that actually hurts",
    400,
  );
  const cues = stretch(cuesFromWords(words), 40_000);
  assert.ok(cues.length > 1);
  for (const c of cues) {
    assert.ok(rate(c) <= MAX_CPS, `"${c.text}" reads at ${rate(c).toFixed(1)} cps`);
  }
  assert.deepEqual(overTheLimit(cues), [], "and the check agrees");
});

test("stretching into a pause is what brings a dense line under the limit", () => {
  /*
   * The acceptance above would pass against a stretch() that did nothing, as
   * long as the fixture spoke slowly enough. This is the case that needs it:
   * a quick dense line with a long pause after it, which is over the limit as
   * spoken and inside it once the caption is held into the silence.
   */
  const words = say("absolutely everybody understood immediately what happened", 170);
  const raw = cuesFromWords(words);
  assert.ok(overTheLimit(raw).length > 0, "the fixture is not dense enough to need stretching");

  const held = stretch(raw, 30_000);
  assert.deepEqual(overTheLimit(held), [], "the pause after it was not used");
  assert.ok(held[0].end_ms > raw[0].end_ms, "the cue was not held any longer at all");
});

test("a cue takes the gap after it, and stops short of the next one", () => {
  const cues = stretch(
    [
      { start_ms: 0, end_ms: 400, text: "A dense little line that needs longer." },
      { start_ms: 6000, end_ms: 6400, text: "And another." },
    ],
    20_000,
  );
  assert.ok(cues[0].end_ms > 400, "it did not stretch at all");
  assert.ok(cues[0].end_ms <= 6000 - CUE_GAP_MS, "it ran into the next cue");
  assert.ok(cues[0].end_ms - cues[0].start_ms <= MAX_CUE_MS, "it outstayed the maximum");
  assert.ok(cues[1].end_ms <= 20_000, "the last cue ran past the end of the film");
});

test("a cue is never left shorter than a flash, where there is room", () => {
  const [c] = stretch([{ start_ms: 0, end_ms: 120, text: "Yes." }], 20_000);
  assert.ok(c.end_ms - c.start_ms >= MIN_CUE_MS);
});

test("with no room, stretching does not steal from the next cue", () => {
  /* Back-to-back speech. The honest outcome is a cue that is still too fast,
     reported, not one that overlaps its neighbour. */
  const cues = stretch(
    [
      { start_ms: 0, end_ms: 500, text: "A very dense line indeed, far too many characters." },
      { start_ms: 520, end_ms: 1200, text: "Straight into the next one." },
    ],
    5000,
  );
  assert.ok(cues[0].end_ms <= cues[1].start_ms, "cues overlap");
  assert.ok(overTheLimit(cues).length > 0, "and the one that cannot be fixed is reported");
});

test("speech faster than the limit is reported, never rewritten", () => {
  /*
   * THE RULE THE WHOLE FILE IS SHAPED BY. Doc 09 says this row is checked and
   * not fixed, and invariant 10 says the user's own words win. A caption that
   * paraphrases somebody to hit a reading rate is this product putting words
   * in their mouth.
   */
  const fast = say("absolutely everybody understood immediately what happened afterwards", 120);
  const cues = stretch(cuesFromWords(fast), 1200);
  const over = overTheLimit(cues);
  assert.ok(over.length > 0, "25 cps with no pause after it is not reportable");
  const said = cues.map((c) => c.text.replace(/\n/g, " ")).join(" ");
  for (const w of fast) assert.match(said, new RegExp(w.w), `"${w.w}" was dropped`);
});

test("a sidecar unless the captions are already in the picture", () => {
  /* No stacking: a viewer with subtitles on by default would get the player's
     copy drawn over the burned-in one. */
  assert.equal(sidecarWanted("None"), true);
  assert.equal(sidecarWanted(null), true);
  assert.equal(sidecarWanted(undefined), true);
  assert.equal(sidecarWanted("Bold"), false);
  assert.equal(sidecarWanted("Clean"), false);
});

/* ── Through the real EDL ────────────────────────────────────────────────── */

const block = (over: Partial<Block> = {}): Block => ({
  id: "s:0",
  origin: "footage",
  start_ms: 0,
  end_ms: 30_000,
  text: "",
  words: [],
  struck: false,
  score: null,
  why: null,
  label: null,
  mediaKey: null,
  previewKey: null,
  voiceKey: null,
  posterKey: null,
  ...over,
});

test("ACCEPTANCE: a real cut's subtitle file reads at the limit throughout", () => {
  /*
   * From blocks to the .srt, the path an export actually takes. The block is
   * one long unbroken line — the shape that produced a single unreadable cue
   * before this existed.
   */
  const spoken = "The first four weeks are about showing up and nothing else and nobody tells you that the second month is the one that actually hurts";
  const words = spoken.split(" ").map((w, i) => ({ w, s: i * 0.4, e: (i + 1) * 0.4 - 0.01 }));
  const b = block({ text: spoken, words, end_ms: Math.round(words.length * 400) });

  const edl = buildEdl("master.mp4", [b], []);
  const cues = captionCues(edl);
  assert.ok(cues.length > 1, "the whole line came out as one cue");
  for (const c of cues) {
    assert.ok(rate(c) <= MAX_CPS, `"${c.text}" reads at ${rate(c).toFixed(1)} cps`);
  }

  const srt = buildSrt(edl);
  assert.match(srt, /^1\n00:00:00,000 --> /, "numbered from one, in output time");
  assert.equal((srt.match(/-->/g) ?? []).length, cues.length);
});

test("cues are on the output clock, not the source's", () => {
  /* The second cut starts where the first ended on the TIMELINE, not where it
     sat in the source file. Getting this wrong puts every caption after the
     first cut in the wrong place. */
  const words = (from: number) =>
    ["one", "two", "three", "four"].map((w, i) => ({ w, s: from + i * 0.3, e: from + (i + 1) * 0.3 - 0.01 }));
  const edl = buildEdl(
    "m.mp4",
    [
      block({ id: "s:0", start_ms: 0, end_ms: 1200, text: "one two three four", words: words(0) }),
      block({ id: "s:1", start_ms: 60_000, end_ms: 61_200, text: "one two three four", words: words(60) }),
    ],
    [],
  );
  const cues = captionCues(edl);
  assert.equal(cues[0].start_ms, 0);
  assert.ok(cues[1].start_ms < 3000, `second cue landed at ${cues[1].start_ms}ms — source time leaked in`);
});

test("a block with no word timings is one cue, never split on a guess", () => {
  /*
   * A recording has no alignment. Splitting it would mean apportioning its
   * duration by each word's share of the characters, which is the invented
   * clock src/rules.ts already rejected once at hooksFast.
   */
  const edl = buildEdl("m.mp4", [block({ origin: "voice", mediaKey: "take.webm", text: "A line with no timings behind it at all", end_ms: 4000 })], []);
  const cues = captionCues(edl);
  assert.equal(cues.length, 1);
  assert.equal(cues[0].text.replace(/\n/g, " "), "A line with no timings behind it at all");
});
