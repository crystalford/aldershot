/**
 * HOW LOUD THE FINISHED THING IS.
 *
 * Phase 6's acceptance — "loudness measures within ±1 LU of target on three
 * test mixes" — is not met in here. It cannot be: it is a claim about audio,
 * and scripts/check-loudness.cjs meets it by building three mixes, normalising
 * them with this file's filter string and measuring what came out.
 *
 * These are about everything around that measurement: reading it, and saying
 * what it means without ever letting "we could not measure it" become "fine".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CEILING_DBTP,
  LOUDNORM,
  NORMALISE_TO_DBTP,
  TARGET_LUFS,
  TOLERANCE_LU,
  loudnessVerdict,
  parseLoudnorm,
} from "../src/loudness.ts";

const json = (over: Record<string, string> = {}) =>
  `some ffmpeg noise\n[Parsed_loudnorm_0 @ 0x1]\n${JSON.stringify({
    input_i: "-14.11",
    input_tp: "-4.87",
    input_lra: "3.20",
    input_thresh: "-24.11",
    output_i: "-23.98",
    output_tp: "-14.74",
    ...over,
  })}\ntrailing noise\n`;

test("the numbers come off the input fields, not the output ones", () => {
  /*
   * Run over a FINISHED file, the input IS the finished file. output_i is
   * what a second normalisation pass would produce — a number about a file
   * that does not exist, and the quietest possible way to be wrong about
   * loudness. The fixture's two sets differ by ten LU so a mix-up cannot pass.
   */
  const m = parseLoudnorm(json());
  assert.equal(m.lufs, -14.11);
  assert.equal(m.truePeak, -4.87);
  assert.equal(m.lra, 3.2);
});

test("silence is not a loudness", () => {
  /* ffmpeg prints "-inf" for a silent file. -Infinity propagating into a
     comparison reports a silent export as merely quiet, when a silent export
     is a failure. */
  const m = parseLoudnorm(json({ input_i: "-inf", input_tp: "-inf" }));
  assert.equal(m.lufs, null);
  assert.equal(m.truePeak, null);
});

test("no block, or a broken one, measures nothing", () => {
  assert.deepEqual(parseLoudnorm("ffmpeg said nothing useful"), { lufs: null, truePeak: null, lra: null });
  assert.deepEqual(
    parseLoudnorm('[Parsed_loudnorm_0 @ 0x1]\n{ "input_i" : "-14.1", oh dear }'),
    { lufs: null, truePeak: null, lra: null },
  );
});

test("on target passes, and says what it measured", () => {
  const v = loudnessVerdict({ lufs: -14.1, truePeak: -4.9, lra: 3.2 });
  assert.equal(v.ok, true);
  assert.deepEqual(v.problems, []);
  assert.match(v.summary, /-14\.1 LUFS/);
  assert.match(v.summary, /-4\.9 dBTP/);
});

test("the tolerance is exactly one LU, and the edge is inside it", () => {
  assert.equal(loudnessVerdict({ lufs: TARGET_LUFS - TOLERANCE_LU, truePeak: -5, lra: 3 }).ok, true);
  assert.equal(loudnessVerdict({ lufs: TARGET_LUFS + TOLERANCE_LU, truePeak: -5, lra: 3 }).ok, true);
  assert.equal(loudnessVerdict({ lufs: TARGET_LUFS - TOLERANCE_LU - 0.1, truePeak: -5, lra: 3 }).ok, false);
  assert.equal(loudnessVerdict({ lufs: TARGET_LUFS + TOLERANCE_LU + 0.1, truePeak: -5, lra: 3 }).ok, false);
});

test("too quiet and too loud are different sentences", () => {
  const quiet = loudnessVerdict({ lufs: -24, truePeak: -8, lra: 3 });
  const loud = loudnessVerdict({ lufs: -8, truePeak: -2, lra: 3 });
  assert.match(quiet.problems[0], /quieter/);
  assert.match(quiet.problems[0], /10\.0 LU/);
  assert.match(loud.problems[0], /louder/);
  assert.match(loud.problems[0], /6\.0 LU/);
  assert.notEqual(quiet.problems[0], loud.problems[0]);
});

test("a peak over the ceiling is its own problem", () => {
  /* On target and still clipping is a real combination, and reporting only
     the loudness would send somebody looking in the wrong place. */
  const v = loudnessVerdict({ lufs: -14, truePeak: -0.3, lra: 3 });
  assert.equal(v.ok, false);
  assert.equal(v.problems.length, 1);
  assert.match(v.problems[0], /-0\.3 dBTP/);
  assert.match(v.problems[0], new RegExp(`${CEILING_DBTP} dBTP`));
});

test("not measured is not a pass", () => {
  /*
   * Invariant 7's whole subject. "We could not measure it" and "it is fine"
   * are different answers and only one of them is true.
   */
  const v = loudnessVerdict({ lufs: null, truePeak: null, lra: null });
  assert.equal(v.ok, false);
  assert.equal(v.problems.length, 2, "both measurements are missing, and both are said");
  assert.match(v.problems[0], /could not be measured/);
  assert.equal(v.summary, "Not measured.");
});

test("the filter aims lower than the ceiling it has to meet", () => {
  /*
   * THE TWO NUMBERS ARE NOT THE SAME KIND OF NUMBER. -1 dBTP is a ceiling on
   * the DELIVERED file and the AAC encode adds true peak after this filter
   * has run, so aiming at the ceiling lands above it. If these two are ever
   * made equal "to match the spec", exports start measuring -0.6 dBTP while
   * the product calls them compliant.
   */
  assert.ok(NORMALISE_TO_DBTP < CEILING_DBTP, "the filter must aim below the ceiling");
  assert.equal(LOUDNORM, `loudnorm=I=${TARGET_LUFS}:TP=${NORMALISE_TO_DBTP}:LRA=11`);
  assert.equal(TARGET_LUFS, -14, "doc 09 asks for about -14 LUFS");
});

test("the block survives being flattened onto a header line", () => {
  /*
   * The container forwards ffmpeg's block with its whitespace collapsed,
   * because an HTTP header cannot contain a newline. If the parser could not
   * read the flattened form, every export would arrive unmeasured and say so
   * honestly, which is the quietest possible way for this to be broken.
   */
  const block = json();
  const flat = (block.match(/\{[^{}]*"input_i"[\s\S]*?\}/) as RegExpMatchArray)[0].replace(/\s+/g, " ");
  assert.ok(!flat.includes("\n"), "the fixture is not actually flattened");
  assert.deepEqual(parseLoudnorm(flat), parseLoudnorm(block));
  assert.equal(parseLoudnorm(flat).lufs, -14.11);
});

test("a missing header is not measured, and not a pass", () => {
  /* What runRender hands the parser when the container could not measure. */
  const v = loudnessVerdict(parseLoudnorm(""));
  assert.equal(v.ok, false);
  assert.equal(v.summary, "Not measured.");
});
