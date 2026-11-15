/**
 * INVARIANT 2'S SECOND SENTENCE: "validate and measure every edit before
 * showing it; never trust the model's claim of success."
 *
 * The encoder is not a model, and the rule is the same one: an export is a
 * claim about a video and the only thing that settles it is the finished
 * file. src/render-job.ts held both numbers in the same scope — what the
 * container measured and what the EDL promised — and wrote one of them
 * without ever subtracting. src/short-render.ts did not even measure: it
 * wrote the length the short was requested to be.
 *
 * Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lengthVerdict, TOLERANCE_S } from "../src/length.ts";

test("a file that is the length the cut promised is the length the cut promised", () => {
  const v = lengthVerdict({ promisedMs: 359_000, measuredS: 359 });
  assert.equal(v.ok, true);
  assert.equal(v.measured, true);
  assert.equal(v.offS, 0);
  assert.match(v.says, /359s/);
});

test("ACCEPTANCE: a file that came out short says so, and says by how much", () => {
  /*
   * The case named in the code: a source that ends before its transcript
   * claims. The cut was approved at 5:59 and the file is 5:19, and before
   * this the row simply said 319 and nothing said anything.
   */
  const v = lengthVerdict({ promisedMs: 359_000, measuredS: 319 });
  assert.equal(v.ok, false);
  assert.equal(v.measured, true);
  assert.equal(v.offS, -40);
  assert.match(v.says, /40s shorter/);
  assert.match(v.says, /319s against 359s/);
});

test("a file that came out long says that too", () => {
  const v = lengthVerdict({ promisedMs: 100_000, measuredS: 130 });
  assert.equal(v.ok, false);
  assert.equal(v.offS, 30);
  assert.match(v.says, /30s longer/);
});

test("ACCEPTANCE: not measured is not a pass", () => {
  /*
   * The same stance as loudnessVerdict, for the same reason: "we could not
   * measure it" and "it is fine" are different answers and only one of them
   * is true. A missing header used to fall back to the EDL's own figure,
   * which made an unmeasured export and a correct one the same row.
   */
  for (const measuredS of [null, 0, NaN]) {
    const v = lengthVerdict({ promisedMs: 359_000, measuredS });
    assert.equal(v.ok, false, `${measuredS} must not pass`);
    assert.equal(v.measured, false);
    assert.equal(v.offS, null);
    assert.match(v.says, /was not measured/);
  }
});

test("the tolerance covers the two roundings and nothing else", () => {
  /* Whole seconds out of the container, and a frame boundary at the end. */
  assert.equal(lengthVerdict({ promisedMs: 60_000, measuredS: 60 + TOLERANCE_S }).ok, true);
  assert.equal(lengthVerdict({ promisedMs: 60_000, measuredS: 60 + TOLERANCE_S + 1 }).ok, false);
  assert.equal(lengthVerdict({ promisedMs: 60_000, measuredS: 60 - TOLERANCE_S }).ok, true);
  assert.equal(lengthVerdict({ promisedMs: 60_000, measuredS: 60 - TOLERANCE_S - 1 }).ok, false);
});

/*
 * COMMENTS STRIPPED, and this test was broken once before it was trusted
 * because they were not.
 *
 * Replacing the header read with a constant left the words "x-duration-s"
 * in the comment ABOVE it explaining that the header is read — so the
 * assertion passed about a file that had stopped measuring. It is the same
 * mistake as a fidelity rule whose haystack includes its own declarations,
 * one file down.
 */
const src = (f: string) =>
  readFileSync(join(import.meta.dirname, "..", "src", f), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");

test("ACCEPTANCE: both render paths measure the file and keep the promise beside it", () => {
  /*
   * The unit above is worthless if nothing calls it, which is exactly how
   * this gap existed: loudnessVerdict was called and lengthVerdict did not
   * exist, so one of the two measurements the container takes was checked
   * and the other was not.
   */
  for (const file of ["render-job.ts", "short-render.ts"]) {
    const text = src(file);
    assert.match(text, /lengthVerdict\(/, `${file} must measure the finished file against the cut`);
    assert.match(text, /x-duration-s/, `${file} must read the measurement the container forwards`);
    assert.match(text, /promised_s=\?/, `${file} must keep the promise beside the measurement`);
  }
});

test("neither path lets the promise stand in for the measurement unrecorded", () => {
  /*
   * The exact line this work removed. `measuredS || promisedS` is still the
   * value in duration_s, because the row should describe a video somebody
   * can play — but it is no longer the ONLY number stored, so a fallback is
   * visible instead of being indistinguishable from a measurement.
   */
  assert.ok(
    !/duration_s=\?`\)\s*\n\s*\.bind\(key, size, Math\.round\(plan\.durationS\)/.test(src("short-render.ts")),
    "short-render must not write the requested duration as the file's length",
  );
});
