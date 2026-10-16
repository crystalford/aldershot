/**
 * The self-containment ruler.
 *
 * This exists to measure whether src/score.ts obeys its own prompt, so its
 * failure mode is not "crashes" — it is "reports a number that is mostly its
 * own false positives". A check that flags every clip says nothing about the
 * scorer and would send us rewriting a prompt that was fine.
 *
 * So roughly half of these tests are openings that must NOT be flagged.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { portabilityFlags, hardFlags, type Flag } from "../src/portability.ts";

const kinds = (q: string) => portabilityFlags(q).map((f: Flag) => f.kind).sort();

test("a clipped sentence is caught at both ends, and only where the transcript is punctuated", () => {
  /* The prompt calls this "the single most common thing people throw these
     away for", and it is the one defect visible without understanding a word. */
  assert.deepEqual(kinds("and the first four weeks are not about strength. Nobody tells you."), [
    "opens-mid-sentence",
    "opens-on-dangling-reference",
  ]);
  assert.deepEqual(kinds("The first four weeks are not about strength. Nobody tells you"), [
    "ends-mid-sentence",
  ]);

  /*
   * THE ONE THAT MAKES THIS USABLE.
   *
   * Against an unpunctuated transcript a sentence-boundary check flags every
   * single clip, reports a 100% defect rate and means nothing. Each check
   * first asks whether the text carries the signal at all.
   */
  assert.deepEqual(kinds("the first four weeks are not about strength at all"), []);
});

test("an opening that points outside the span is caught", () => {
  for (const q of [
    "That's why I stopped buying the expensive filter.",
    "Which is why we shipped it on a Friday.",
    "Like I said, the camera gear is the cheap part.",
    "That one was the hardest to finish.",
    "This was the part nobody warned me about.",
    "And then he drove four hours to watch.",
    "He never said he was proud of me.",
    "She asked what the hardest part was and I said deciding to start.",
    "That's the whole point of doing it this way.",
  ]) {
    assert.ok(
      hardFlags(q).some((f) => f.kind === "opens-on-dangling-reference"),
      `should flag: ${q}`,
    );
  }
});

test("openings that are fine are left alone", () => {
  /*
   * HALF THE VALUE OF THIS FILE.
   *
   * Every one of these tripped an earlier version. "My dad never said he was
   * proud" has its antecedent in lower case; "It's the first time" is an
   * expletive subject, not a reference; a pronoun deep inside a span is
   * almost always resolved by the span itself.
   */
  for (const q of [
    "My dad never said he was proud, he just drove four hours to watch.",
    "I stopped buying the expensive filter and the water tasted the same.",
    "Nobody tells you the camera gear is the cheap part of making a film.",
    "We shipped it on a Friday, which is how you know we had no adults around.",
    "Marcus told me he was leaving before anyone else knew.",
    "The whole studio smelled of turpentine and nobody opened a window.",
  ]) {
    assert.deepEqual(hardFlags(q), [], `should not flag: ${q}`);
  }
});

test("one defect produces one flag, not three", () => {
  /*
   * "And then he said" trips the phrase list, the pronoun rule and the
   * connective list. Counted three times it would treble its weight in every
   * rate this feeds, and the readout would report a defect rate above 100%.
   */
  const flags = portabilityFlags("And then he said it was already too late.");
  const dangling = flags.filter((f) => f.kind === "opens-on-dangling-reference");
  assert.equal(dangling.length, 1);
  assert.equal(dangling[0].detail, "and then", "the most specific explanation wins");
});

test("soft flags are kept apart from hard ones", () => {
  /*
   * A bare "So" does open a thought in real speech, and an expletive "it's"
   * is sound. Counting these as defects would make the measurement pessimistic
   * in exactly the direction that would have us rewrite a working prompt.
   */
  const so = portabilityFlags("So the first four weeks are not about strength.");
  assert.equal(so.length, 1);
  assert.equal(so[0].severity, "soft");
  assert.deepEqual(hardFlags("So the first four weeks are not about strength."), []);

  const it = portabilityFlags("It's the first time anyone asked me that.");
  assert.equal(it[0].severity, "soft");
});

test("every flag carries the text that triggered it", () => {
  /* A rate nobody can audit is a rate nobody should act on: the detail is
     what lets a disagreement be settled by reading the clip. */
  for (const f of portabilityFlags("and then that's the thing nobody tells you")) {
    assert.ok(f.detail.length > 0, `${f.kind} had no detail`);
  }
  assert.deepEqual(portabilityFlags(""), [], "an empty quote is not a defect");
  assert.deepEqual(portabilityFlags("   "), []);
});
