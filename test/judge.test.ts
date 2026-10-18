/**
 * THE JUDGE: does this moment back this claim, or does it only sound like it?
 *
 * Decision 21: "'Nothing backs this' is engineered. Three-way label, our
 * threshold, near-miss negatives. Models alone never abstain or always do."
 * Everything here is the ENGINEERED half — the part that holds whatever the
 * model said to a shape a receipt can survive.
 *
 * The call itself is not tested; the parse is, because every way this fails
 * is quiet and two of the ways put a quote nobody said under a claim.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  JUDGE_VERSION,
  LINE_CHARS,
  MAX_SENTENCES,
  parseJudgements,
  sentences,
  shortIds,
  usableWhy,
  userPrompt,
  type Candidate,
} from "../src/judge.ts";

const QUOTE = "I keep pricing it in money. The other price is embarrassing to say out loud. So I say rent.";
const cands: Candidate[] = [
  { id: "01HZZZ1", quote: QUOTE },
  { id: "01HZZZ2", quote: "Okay is this recording. Hi." },
];
const ids = shortIds(cands);
const answer = (rows: unknown) => parseJudgements({ judgements: rows }, cands, ids, "m/test");

/* ── Sentences ──────────────────────────────────────────────────────────── */

test("a moment is split at sentence ends, not at every full stop", () => {
  /* "Mr. Telford" and "2.5 hours" are not two sentences, and a split that
     got those wrong would renumber the moment and point the receipt at the
     wrong half of it. */
  assert.deepEqual(sentences("Mr. Telford said no. Then he left."), ["Mr. Telford said no.", "Then he left."]);
  assert.deepEqual(sentences("It took 2.5 hours."), ["It took 2.5 hours."]);
  /* Initials are a name, not three sentences. */
  assert.deepEqual(sentences("J. R. Telford left. He came back."), ["J. R. Telford left.", "He came back."]);
  /* And "no." is the end of a sentence far more often than it is "number" —
     putting it on the abbreviation list joined two real sentences and moved
     every number after it. */
  assert.equal(sentences("I said no. Then he left.").length, 2);
  assert.equal(sentences(QUOTE).length, 3);
});

test("a stop that is not followed by a capital is not the end of a sentence", () => {
  /*
   * The conservative direction, on purpose. Under-splitting means the
   * receipt quotes a little more than it needed; over-splitting means it
   * quotes half a sentence and presents it as the whole claim.
   *
   * This is a rule rather than a scenario: the abbreviation list covers the
   * realistic cases on its own, so without this assertion nothing pins the
   * lookahead and it could be deleted with every test still green.
   */
  assert.deepEqual(sentences("he said it. and then he left"), ["he said it. and then he left"]);
  assert.deepEqual(sentences("it was 2019. 2020 was worse"), ["it was 2019. 2020 was worse"]);
  assert.deepEqual(sentences("He said it. And then he left."), ["He said it.", "And then he left."]);
});

test("a long moment is joined at the tail rather than truncated", () => {
  /*
   * The sentence that backs the claim could be the last one. Dropping it
   * would make the moment unbackable for a reason nobody could see.
   */
  const many = Array.from({ length: 20 }, (_, i) => `Sentence number ${i}.`).join(" ");
  const parts = sentences(many);
  assert.equal(parts.length, MAX_SENTENCES);
  assert.match(parts[parts.length - 1], /Sentence number 19\./, "the last one is still in there");
});

test("an empty moment has no sentences rather than one empty one", () => {
  assert.deepEqual(sentences("   "), []);
});

/* ── The receipt cannot be written by the model ─────────────────────────── */

test("the line is rebuilt from our own text, from a number the model gave", () => {
  /*
   * src/grounding.ts's rule, and the reason it applies doubly here: a
   * receipt the model composed would be a quote nobody said, under a claim,
   * presented as proof. The schema has nowhere to put one.
   */
  const [a] = answer([{ moment: "m1", verdict: "backs", sentence: 2, why: "States the substitution." }]);
  assert.equal(a.said, "backs");
  assert.equal(a.line, "The other price is embarrassing to say out loud.");
  assert.equal(a.why, "States the substitution.");
});

test("the prompt sends numbered sentences and never the real ids", () => {
  const p = userPrompt("a claim", cands, ids);
  assert.match(p, /m1:/);
  assert.match(p, /1\. I keep pricing it in money\./);
  assert.doesNotMatch(p, /01HZZZ/, "a 26-character id is a thing models mistype");
});

/* ── The engineered abstention ──────────────────────────────────────────── */

test("backs with nothing to point at is related, not backs", () => {
  /*
   * THE THRESHOLD, AND IT IS STRUCTURAL. The model asserted support and
   * could not show it, which is the definition of the near-miss it was
   * asked to separate. No number is guessed at, because there is no set yet
   * to calibrate one against.
   */
  const [a] = answer([{ moment: "m1", verdict: "backs", why: "It does, somehow." }]);
  assert.equal(a.raw, "backs");
  assert.equal(a.said, "related");
  assert.equal(a.downgraded, true);
  assert.equal(a.line, null);
});

test("a sentence number outside the moment is pointing at nothing", () => {
  for (const sentence of [0, 4, -1, 99, 1.5]) {
    const [a] = answer([{ moment: "m1", verdict: "backs", sentence }]);
    assert.equal(a.said, "related", `sentence ${sentence} is not in a three-sentence moment`);
  }
});

test("only backs carries a line", () => {
  /* A `related` with a quote under it reads as a receipt for something
     nobody claimed. */
  const [a] = answer([{ moment: "m1", verdict: "related", sentence: 1 }]);
  assert.equal(a.line, null);
});

/* ── The judge's own words ──────────────────────────────────────────────── */

test("a line that copies the speech back is not the judge's own words", () => {
  assert.equal(usableWhy("The other price is embarrassing to say out", QUOTE), false);
  assert.equal(usableWhy("Says the money is a stand-in for something else.", QUOTE), true);
  /* Referring to a phrase is fine; five words in a row is a copy. */
  assert.equal(usableWhy("It is about the other price.", QUOTE), true);
});

test("a line longer than a sentence is not a line", () => {
  assert.equal(usableWhy("x".repeat(LINE_CHARS + 1), QUOTE), false);
  assert.equal(usableWhy("", QUOTE), false);
});

test("an unusable line is dropped, and the verdict survives it", () => {
  const [a] = answer([
    { moment: "m1", verdict: "backs", sentence: 1, why: "The other price is embarrassing to say out" },
  ]);
  assert.equal(a.said, "backs", "the verdict is the answer; the line is the explanation");
  assert.equal(a.why, null);
});

/* ── Nothing goes missing ───────────────────────────────────────────────── */

test("an inferred unrelated is marked as inferred", () => {
  /*
   * A moment nobody answered for is recorded as `unrelated` so a short
   * answer cannot shrink the set — but that is an INFERENCE, and a run
   * where it is true of everything is a failed call rather than a judge
   * with no opinions. src/judge-run.ts uses this to tell them apart; it
   * used to guess from the token count, which is zero on any provider that
   * does not report usage.
   */
  const got = answer([{ moment: "m1", verdict: "backs", sentence: 1 }]);
  assert.equal(got[0].answered, true);
  assert.equal(got[1].answered, false);
  assert.ok(
    parseJudgements({}, cands, ids, "m/test").every((g) => !g.answered),
    "a call that said nothing answered nothing",
  );
});

test("a moment the model never answered for is unrelated, not absent", () => {
  /*
   * Eight moments judged as six is a judge that looked at eight and
   * reported six — the silent partial failure invariant 7 calls a P1,
   * arriving as a shorter list rather than as an error.
   */
  const got = answer([{ moment: "m1", verdict: "backs", sentence: 1 }]);
  assert.equal(got.length, 2);
  assert.equal(got[1].id, "01HZZZ2");
  assert.equal(got[1].said, "unrelated");
});

test("an answer about a moment we never sent is dropped, not reassigned", () => {
  /*
   * Attaching it to something would be inventing the question as well as
   * the answer — a verdict about a moment nobody asked about, filed under
   * one somebody did.
   */
  const got = answer([
    { moment: "m9", verdict: "backs", sentence: 1, why: "A reason about nothing." },
  ]);
  assert.equal(got.length, 2);
  assert.ok(got.every((g) => g.said === "unrelated"));
  assert.ok(got.every((g) => g.why === null), "and its reason goes with it");
});

test("two answers about one moment keep the first", () => {
  const got = answer([
    { moment: "m1", verdict: "backs", sentence: 1 },
    { moment: "m1", verdict: "unrelated" },
  ]);
  assert.equal(got[0].said, "backs");
});

test("a verdict that is not one of the three is unrelated", () => {
  const [a] = answer([{ moment: "m1", verdict: "probably", sentence: 1 }]);
  assert.equal(a.said, "unrelated");
});

test("an answer that is not JSON at all loses the opinion, not the moments", () => {
  const got = parseJudgements("sorry, I cannot help with that", cands, ids, "m/test");
  assert.equal(got.length, 2);
  assert.ok(got.every((g) => g.said === "unrelated" && g.line === null));
});

test("every judgement is tagged with the version that made it", () => {
  /* "gated by the eval set before a model swap" cannot be done if a row
     does not say which judge wrote it. */
  const [a] = answer([{ moment: "m1", verdict: "backs", sentence: 1 }]);
  assert.equal(a.version, JUDGE_VERSION);
  assert.equal(a.model, "m/test");
});

test("the answer comes back in the order the moments were sent", () => {
  const got = answer([
    { moment: "m2", verdict: "unrelated" },
    { moment: "m1", verdict: "backs", sentence: 1 },
  ]);
  assert.deepEqual(got.map((g) => g.id), ["01HZZZ1", "01HZZZ2"]);
});
