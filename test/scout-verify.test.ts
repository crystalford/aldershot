/**
 * THE VERIFIER. "Every quote he hands back is in the source, word for word,
 * at the time he says, and a model never typed that timestamp."
 *
 * That sentence is spec 18's statement of what Scout is judged on, and this
 * file is where it is either true or not. The failure it exists to stop is
 * not a crash: it is a quote that reads perfectly, sits on the board with a
 * timestamp, and is not in the video. Nothing downstream can catch that,
 * because everything downstream believes this.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { IndexedWord } from "../src/align.ts";
import {
  CONTEXT_MS,
  FUZZY_WINDOW_MS,
  PARAPHRASE_AT,
  VERIFIED_AT,
  contextAround,
  normTokens,
  rejectionRate,
  tokenRatio,
  verifyQuote,
} from "../src/scout-verify.ts";

/**
 * A transcript. Each word gets 400ms, starting at `fromMs`, which makes every
 * expected timestamp in this file arithmetic a reader can check.
 */
function transcript(text: string, fromMs = 0, stepMs = 400): IndexedWord[] {
  return text.split(/\s+/).filter(Boolean).map((w, i) => ({
    index: i,
    text: w,
    startMs: fromMs + i * stepMs,
    endMs: fromMs + i * stepMs + stepMs - 1,
  }));
}

/** Joins two stretches of transcript with a gap, for the window tests. */
function withGap(a: string, b: string, gapMs: number): IndexedWord[] {
  const first = transcript(a);
  const last = transcript(b, (first.at(-1)?.endMs ?? 0) + gapMs);
  return [...first, ...last.map((w, i) => ({ ...w, index: first.length + i }))];
}

const STREAM =
  "I am not going to read the chat tonight because every time I do " +
  "somebody in there decides to tell me how to run my own stream and " +
  "frankly I have had enough of it";

/* ── Exact ──────────────────────────────────────────────────────────────── */

test("a quote that is in the transcript is verified, and the time is the transcript's", () => {
  const words = transcript(STREAM);
  const v = verifyQuote("somebody in there decides to tell me how to run my own stream", words);

  assert.equal(v.verify, "verified");
  assert.equal(v.matchScore, 1);
  assert.equal(v.exact, true);
  /* Word 15 is "somebody" — count it in STREAM and the arithmetic holds. */
  assert.equal(words[v.span!.startWord].text, "somebody");
  assert.equal(words[v.span!.endWord].text, "stream");
  assert.equal(v.tStartS, words[v.span!.startWord].startMs / 1000);
  assert.equal(v.tEndS, words[v.span!.endWord].endMs / 1000);
});

test("ACCEPTANCE: a confidently wrong hint cannot move a verified timestamp", () => {
  /*
   * THE INVARIANT, AS A TEST. Invariant 2: the model never outputs a
   * timestamp. It returns a quote and a guess at where the quote starts, and
   * the guess here is off by the length of the clip. The exact pass does not
   * consult it at all, which is what makes the timestamp the transcript's.
   */
  const words = transcript(STREAM);
  const quote = "frankly I have had enough of it";

  const honest = verifyQuote(quote, words, 32);
  const lying = verifyQuote(quote, words, 0);
  const absent = verifyQuote(quote, words);

  for (const v of [honest, lying, absent]) {
    assert.equal(v.verify, "verified");
    assert.equal(v.tStartS, honest.tStartS);
    assert.equal(v.tEndS, honest.tEndS);
    assert.deepEqual(v.span, honest.span);
  }
  assert.equal(words[honest.span!.startWord].text, "frankly");

  /*
   * AND THE HINT CANNOT PUT THE QUOTE OUT OF REACH EITHER. The exact pass
   * searches the whole window rather than the hint's neighbourhood, so a
   * hint ten minutes out still finds the words. An earlier version of this
   * test used a thirty-word transcript, where a hint of 0 was inside the
   * fuzzy pass's own sixty-second window — so narrowing the exact pass to
   * the hint changed nothing, the fuzzy fallback quietly found the same
   * match at the same time, and the test passed with the guarantee gone.
   */
  const far = withGap("welcome back everybody to another one of these", STREAM, 10 * 60 * 1000);
  const hinted = verifyQuote(quote, far, 0);
  const unhinted = verifyQuote(quote, far);
  assert.equal(hinted.verify, "verified");
  assert.equal(hinted.exact, true);
  assert.deepEqual(hinted.span, unhinted.span);
  assert.equal(hinted.tStartS, unhinted.tStartS);
  assert.ok(hinted.tStartS! > 600, `a ten-minute gap, and the time is ${hinted.tStartS}s`);
});

test("case, punctuation and curly apostrophes are not differences", () => {
  /*
   * A recogniser writes "dont", a model writes "don't", a person pastes
   * "don’t" out of a document. Three spellings of one word said once.
   */
  const words = transcript("I do not read the chat any more");
  for (const q of [
    "I DO NOT READ THE CHAT ANY MORE",
    "  I don't read the chat any more.  ",
    "“I don’t read the chat any more”",
  ]) {
    const v = verifyQuote(q, words);
    assert.equal(v.verify, "verified", q);
    assert.equal(v.exact, true, q);
  }
});

test("contractions expand on both sides, so the token count still lines up", () => {
  /* "don't" is one transcript word and two tokens. If the map from tokens
     back to words did not allow that, every contracted quote would point at
     the wrong word. */
  const words = transcript("he said he won't be reading chat");
  const v = verifyQuote("he will not be reading chat", words);
  assert.equal(v.verify, "verified");
  assert.equal(v.exact, true);
  assert.equal(words[v.span!.startWord].text, "he");
  assert.equal(words[v.span!.endWord].text, "chat");
  /* The span starts at the SECOND "he" — the one before "won't". */
  assert.equal(v.span!.startWord, 2);
});

test("a hyphenated number word becomes digits; two words do not", () => {
  /*
   * Joining "twenty" and "five" into "25" across two tokens would change the
   * token count on one side only, and the word-id map would stop lining up
   * with the transcript. That is a correctness problem bought for a cosmetic
   * match, so the two-word case is left to the fuzzy pass, honestly, as a
   * paraphrase.
   */
  assert.deepEqual(normTokens("twenty-five bans"), ["25", "bans"]);
  assert.deepEqual(normTokens("twenty five bans"), ["20", "5", "bans"]);

  /*
   * AND THE CONSEQUENCE, TESTED RATHER THAN HOPED. On a six-word quote,
   * "25" where the speaker said "twenty five" is two tokens out of seven and
   * scores 0.71 — rejected. That is the right arithmetic (a six-word quote
   * with a different number in it is not that quote) and it is also a thing
   * the scan prompt has to prevent by asking for the words as spoken, or a
   * careful model's rejection rate reads as a hallucination rate.
   */
  const words = transcript("that is twenty five bans this month");
  const v = verifyQuote("that is 25 bans this month", words);
  assert.equal(v.exact, false);
  assert.equal(v.verify, "rejected");
  assert.equal(v.matchScore, 0.7143);

  /* The same substitution inside a longer quote is a paraphrase, because
     proportionally it is one. */
  const longer = transcript("I have handed out twenty five bans this month and I am not sorry about any of them");
  const l = verifyQuote("I have handed out 25 bans this month and I am not sorry about any of them", longer);
  assert.equal(l.verify, "paraphrase");
  assert.ok(l.matchScore >= PARAPHRASE_AT && l.matchScore < VERIFIED_AT, `scored ${l.matchScore}`);
});

/* ── Fuzzy ──────────────────────────────────────────────────────────────── */

test("a near-miss is a paraphrase, not a quote and not a nothing", () => {
  /*
   * The middle band is the whole reason this is three-valued. A paraphrase
   * passed as a quote is a fabricated quotation; a paraphrase thrown away is
   * a real moment lost. Labelled, it is a human's decision.
   */
  const words = transcript(STREAM);

  /* One word dropped out of thirteen is 0.92, and the spec's threshold calls
     that verified — a transcript that wrote "my own stream" where the speaker
     ran the words together is the recogniser's error, not the model's. */
  const close = verifyQuote("somebody in there decides to tell me how to run my stream", words, 15);
  assert.equal(close.verify, "verified");
  assert.ok(close.matchScore >= VERIFIED_AT, `scored ${close.matchScore}`);

  /* Two differences in thirteen is 0.85, and that is the middle band. */
  const v = verifyQuote("someone in there decided to tell me how to run my own stream", words, 15);
  assert.equal(v.verify, "paraphrase");
  assert.ok(v.matchScore >= PARAPHRASE_AT && v.matchScore < VERIFIED_AT, `scored ${v.matchScore}`);
  /* And it says what was actually said, which is the thing a person checks. */
  assert.match(v.foundText!, /somebody in there decides/);
});

test("a fabrication is rejected, and the score comes back anyway", () => {
  /*
   * "Rejected at 0.79" and "rejected at 0.02" are different facts about a
   * model, and the rejection rate is what gates a model swap. A verdict with
   * no number under it cannot be argued with.
   */
  const words = transcript(STREAM);
  const v = verifyQuote("I hate every single one of my viewers and I always have", words, 10);
  assert.equal(v.verify, "rejected");
  assert.equal(v.span, null);
  assert.equal(v.tStartS, null);
  assert.ok(v.matchScore < PARAPHRASE_AT);
  assert.ok(v.matchScore > 0, "a score of exactly zero hides how close it was");
});

test("the fuzzy pass looks sixty seconds either side of the hint and no further", () => {
  /*
   * Spec 3.6: fuzzy matching is "within ±60 s of first_word_id". Without the
   * bound, a long VOD will always contain SOMETHING 0.85 similar to any
   * sentence about chat, and the verifier would confidently place a quote two
   * hours from where it was said.
   */
  const words = withGap(
    "welcome back everybody to another one of these",
    "somebody in there decides to tell me how to run my stream",
    5 * 60 * 1000,
  );
  const quote = "somebody in there decides to tell me how to run my own stream";

  /*
   * Hinted at the paraphrase, it is found. Word 8 is the first word of the
   * second stretch — an earlier version of this test hinted at word 7, which
   * is the LAST word of the first stretch and five minutes away, so the
   * "near" case was quietly testing the far one and the test proved nothing
   * either way.
   */
  const near = verifyQuote(quote, words, 8);
  assert.equal(near.verify, "verified");
  assert.equal(words[8].text, "somebody");

  /* Hinted five minutes away, it is not — the match is outside the window. */
  const far = verifyQuote(quote, words, 0);
  assert.equal(far.verify, "rejected");
  assert.equal(far.span, null);

  /* With no hint there is nowhere to centre, so the whole window is searched:
     strictly more generous, never less. */
  const blind = verifyQuote(quote, words);
  assert.equal(blind.verify, "verified");
  assert.ok(FUZZY_WINDOW_MS === 60_000);
});

/* ── Two of the same thing ──────────────────────────────────────────────── */

test("a phrase said twice: the hint chooses which, never when", () => {
  /*
   * The only thing the model's hint decides. Both occurrences are word for
   * word, so the verdict is the same either way; the hint picks the one it
   * meant, and the timestamp still comes off the transcript.
   */
  const words = withGap("I am not reading the chat", "I am not reading the chat", 30_000);
  const quote = "I am not reading the chat";

  const first = verifyQuote(quote, words, 1);
  const second = verifyQuote(quote, words, 7);
  const neither = verifyQuote(quote, words);

  assert.equal(first.span!.startWord, 0);
  assert.equal(second.span!.startWord, 6);
  /* With no hint, the first occurrence — a stable answer rather than a lucky one. */
  assert.deepEqual(neither.span, first.span);

  assert.equal(first.tStartS, words[0].startMs / 1000);
  assert.equal(second.tStartS, words[6].startMs / 1000);
  assert.notEqual(first.tStartS, second.tStartS);
});

/* ── Nothing to work with ───────────────────────────────────────────────── */

test("an empty quote, an empty transcript and an over-long quote are rejected, not thrown", () => {
  /*
   * A scan can come back with an empty quote beside answer:"QUOTE", and a
   * source can have a transcript row with no words in it. Both arrive inside
   * a workflow item, and an exception there is a run that stops rather than a
   * row that says no.
   */
  const words = transcript(STREAM);
  assert.equal(verifyQuote("", words).verify, "rejected");
  assert.equal(verifyQuote("   ", words).verify, "rejected");
  assert.equal(verifyQuote("anything at all", []).verify, "rejected");
  assert.equal(verifyQuote(STREAM + " and more besides", transcript("three words only")).verify, "rejected");
});

/* ── Context ────────────────────────────────────────────────────────────── */

test("ninety seconds either side, and not the quote itself", () => {
  /*
   * Spec 3.6 step 4, whose parenthesis says why: "the provocation before the
   * outburst". A quote can be accurate and unfair, and the only moment the
   * surrounding words are cheap is the moment the transcript is already open.
   */
  const words = transcript(STREAM);
  const v = verifyQuote("frankly I have had enough of it", words);
  const ctx = contextAround(words, v.span!);

  assert.match(ctx.before, /^I am not going to read the chat/);
  assert.ok(!ctx.before.includes("frankly"), "the quote is not its own context");
  assert.equal(ctx.after, "");
  assert.equal(CONTEXT_MS, 90_000);
});

test("context stops at ninety seconds, however long the source is", () => {
  /* Keeping the whole VOD either side would store the VOD, which is both the
     wrong amount of data and the wrong side of invariant 9. */
  const long = transcript(Array.from({ length: 2000 }, (_, i) => "w" + i).join(" "));
  const span = { startWord: 1000, endWord: 1002 };
  const ctx = contextAround(long, span);

  /* 400ms a word, so ninety seconds is 225 words either side. */
  const before = ctx.before.split(" ");
  const after = ctx.after.split(" ");
  assert.ok(before.length <= 226 && before.length >= 224, `got ${before.length}`);
  assert.ok(after.length <= 226 && after.length >= 224, `got ${after.length}`);
  assert.equal(before.at(-1), "w999");
  assert.equal(after[0], "w1003");
});

/* ── The measurement ────────────────────────────────────────────────────── */

test("the rejection rate is per model and prompt version, and a paraphrase is neither", () => {
  /*
   * Spec 3.6: "log the rejection rate per model and prompt version from day
   * one. That rate is Scout's measured hallucination rate, and it gates model
   * swaps." A paraphrase is a human's decision rather than a failure, so it
   * is counted and kept out of the ratio — otherwise a prompt that produces
   * careful near-quotes scores worse than one that invents.
   */
  const rates = rejectionRate([
    { verify: "verified", model: "small-a", promptVersion: "v1" },
    { verify: "verified", model: "small-a", promptVersion: "v1" },
    { verify: "rejected", model: "small-a", promptVersion: "v1" },
    { verify: "paraphrase", model: "small-a", promptVersion: "v1" },
    { verify: "rejected", model: "small-a", promptVersion: "v2" },
    { verify: "verified", model: "small-b", promptVersion: "v1" },
  ]);

  const v1 = rates.find((r) => r.model === "small-a" && r.promptVersion === "v1")!;
  assert.equal(v1.verified, 2);
  assert.equal(v1.rejected, 1);
  assert.equal(v1.paraphrase, 1);
  /* One rejection in three decided, not one in four. */
  assert.equal(v1.rate, 0.3333);

  assert.equal(rates.find((r) => r.promptVersion === "v2")!.rate, 1);
  assert.equal(rates.find((r) => r.model === "small-b")!.rate, 0);

  /* A prompt version is part of the key, or a prompt change hides inside the
     model's old number. */
  assert.equal(rates.length, 3);
});

test("a run of nothing but paraphrases reports no rate, not a perfect one", () => {
  const [only] = rejectionRate([
    { verify: "paraphrase", model: "small-a", promptVersion: "v1" },
    { verify: "paraphrase", model: "small-a", promptVersion: "v1" },
  ]);
  assert.equal(only.paraphrase, 2);
  assert.equal(only.rate, 0);
  assert.equal(only.verified + only.rejected, 0, "nothing was decided, so the rate means nothing");
});

/* ── The ratio ──────────────────────────────────────────────────────────── */

test("the ratio is over tokens, not characters", () => {
  /*
   * Character distance punishes long words and rewards short ones: "stream"
   * against "streams" is one character and a whole word. One substituted word
   * in ten is 0.9 whatever the words were, which is what the thresholds were
   * chosen against.
   */
  assert.equal(tokenRatio(["a", "b", "c"], ["a", "b", "c"]), 1);
  assert.equal(tokenRatio([], []), 1);
  assert.equal(tokenRatio(["a", "b", "c", "d"], ["a", "b", "c"]), 0.75);
  assert.equal(tokenRatio(["a", "b", "c", "d"], ["a", "x", "c", "d"]), 0.75);
  assert.equal(tokenRatio(["a"], ["z"]), 0);

  const ten = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  const swapped = [...ten];
  swapped[4] = "FIVE-ISH";
  assert.equal(tokenRatio(ten, swapped), 0.9);
});
