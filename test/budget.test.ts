/**
 * Choosing an assembly to a RUNTIME.
 *
 * Until now the only constraint was "the first 24 by retrieval rank", so
 * nothing in this product knew how long an assembled cut was — twenty-four
 * moments at a minute each is a twenty-four minute video and it arrived with
 * no warning that it was one. Somebody asking for three minutes got whatever
 * fell out.
 *
 * Every test here is a behaviour the count cap could not have had, which is
 * why they are worth pinning: each one is a specific way the old selection was
 * wrong rather than merely unmeasured.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  targetFromBrief,
  selectForBudget,
  runtimeMs,
  clock,
  DEFAULT_TARGET_MS,
  findMaterial,
  fuseByRank,
  RRF_K,
} from "../src/assemble.ts";

const at = (start: number, seconds: number, quote: string, source = "s1") => ({
  quote,
  source_id: source,
  start_ms: start,
  end_ms: start + seconds * 1000,
});

test("the runtime comes out of the brief when the brief says one", () => {
  /* There is no duration control anywhere in the product, so the sentence
     somebody typed is the only honest place this can come from. */
  assert.deepEqual(targetFromBrief("three minutes on the gym stuff"), { ms: 180_000, said: true });
  assert.deepEqual(targetFromBrief("a 90 second cut about filters"), { ms: 90_000, said: true });
  assert.deepEqual(targetFromBrief("make it 2 mins"), { ms: 120_000, said: true });
  assert.deepEqual(targetFromBrief("15 minutes, whatever you have"), { ms: 900_000, said: true });
  /* "a minute and a half" is a thing people say, and 60_000 is the wrong
     answer to it. */
  assert.deepEqual(targetFromBrief("a minute and a half on the launch"), { ms: 90_000, said: true });
});

test("a number in the prose is not a runtime", () => {
  /*
   * A brief is prose and prose contains numbers. "Cut the 3 second gap" parses
   * perfectly and is not a request for a three-second film, so anything
   * outside what a cut can plausibly be is somebody talking about something
   * else. Getting this wrong makes the feature return one clip and look broken.
   */
  assert.equal(targetFromBrief("cut the 3 second gap at the start").said, false);
  assert.equal(targetFromBrief("the bits about food").said, false);
  assert.equal(targetFromBrief("everything I said about trams").said, false);
  assert.equal(targetFromBrief("").ms, DEFAULT_TARGET_MS);
  /* And "nobody said" is reported, not smuggled: going under a length they
     never asked for is not a shortfall. */
  assert.equal(targetFromBrief("the bits about food").ms, DEFAULT_TARGET_MS);
});

test("it never goes over the runtime it was given", () => {
  const pool = [
    at(0, 40, "the first four weeks are about showing up not strength"),
    at(60_000, 40, "nobody tells you the camera gear is the cheap part"),
    at(120_000, 40, "my dad drove four hours and never said he was proud"),
  ];
  const picked = selectForBudget(pool, "", 90_000);
  assert.ok(runtimeMs(picked) <= 90_000, `${runtimeMs(picked)}ms over budget`);
  assert.equal(picked.length, 2, "two fit, the third does not");
});

test("a tight telling beats a rambling one that covers the same ground", () => {
  /*
   * THE CENTRAL THING A COUNT CAP CANNOT DO.
   *
   * Both of these say the same thing in the same words. Ranked by relevance
   * they are equal and the first wins; priced per second, the twenty-five
   * second one wins and buys sixty-five seconds of other material with the
   * difference. That is the whole argument for a budget over a count.
   */
  const rambling = at(0, 80, "the first four weeks are about showing up and not about strength");
  const tight = at(200_000, 25, "the first four weeks are about showing up and not about strength");
  const picked = selectForBudget([rambling, tight], "", 100_000);
  assert.equal(picked.length, 1, "they say the same thing — one of them is enough");
  assert.equal(picked[0], tight);
});

test("it stops when it has nothing new to add rather than filling the time", () => {
  /*
   * Six moments all making the same point used to fill a cut, because all six
   * matched the brief. An assembly that has run out of material should end.
   */
  const same = "the first four weeks are about showing up not strength";
  const pool = [at(0, 20, same), at(60_000, 20, same), at(120_000, 20, same)];
  const picked = selectForBudget(pool, "", 10 * 60_000);
  assert.equal(picked.length, 1);
  assert.ok(runtimeMs(picked) < 10 * 60_000, "it did not pad to the budget");
});

test("the brief's own words are worth more than any others", () => {
  /* Coverage with nothing weighting it picks whatever has the most unusual
     vocabulary, which is not the same as answering the question. */
  const offTopic = at(0, 30, "turpentine varnish linseed gesso canvas stretcher bars easel");
  const onTopic = at(60_000, 30, "the filter cost forty pounds and the water tasted identical");
  const picked = selectForBudget([offTopic, onTopic], "the bit about the water filter", 30_000);
  assert.equal(picked.length, 1);
  assert.equal(picked[0], onTopic, "the one that answers the brief, despite fewer new words");
});

test("what comes back is in the order the library ranked, not the order it was picked", () => {
  /*
   * Greedy picks densest-first, which is a selection order and a terrible
   * watching order. Ordering an assembly properly is its own problem; until
   * that exists the honest starting order is retrieval's.
   */
  const pool = [
    /* Ranked first by the library, and the WORST value per second — so greedy
       reaches it last and the two orders genuinely disagree. */
    at(0, 60, "alpha beta"),
    at(60_000, 10, "gamma delta epsilon zeta eta theta"),
    at(120_000, 10, "iota kappa lambda sigma omega chi"),
  ];
  const picked = selectForBudget(pool, "", 90_000);
  assert.deepEqual(
    picked.map((m) => m.start_ms),
    [0, 60_000, 120_000],
    "ascending retrieval rank, though greedy visited them 1, 2, 0",
  );
});

test("overlapping moments do not both get in, and the count guard still holds", () => {
  /* Two clips covering the same forty seconds of the same video are both real
     rows, and an assembly containing both says the same thing twice. */
  const overlapping = [
    at(0, 40, "the first four weeks are about showing up"),
    at(20_000, 40, "weeks are about showing up not strength really"),
  ];
  assert.equal(selectForBudget(overlapping, "", 10 * 60_000).length, 1);

  /* A generous budget full of five-second moments is a hundred and forty
     blocks, and an editor with a hundred and forty blocks is unusable. */
  const many = Array.from({ length: 50 }, (_, i) => at(i * 10_000, 5, `word${i} thing${i} other${i}`));
  assert.equal(selectForBudget(many, "", 10 * 60_000, 6).length, 6);
});

test("a brief whose words appear nowhere still gets material", async () => {
  /*
   * findMaterial's own comment has always said the words fallback "degrades to
   * 'the most recent' rather than to nothing". It did not: it returned an
   * empty list, so "eight minutes on whatever you have" — an explicit request
   * for ANYTHING — was refused with "nothing in your library matches that
   * yet", as was any brief phrased around what to make rather than what it is
   * about. Found by driving the real route, not by reading the code.
   */
  const rows = [
    { id: "c1", quote: "the first four weeks are about showing up", source_id: "s1", start_ms: 0, end_ms: 20_000 },
    { id: "c2", quote: "nobody tells you the camera gear is cheap", source_id: "s1", start_ms: 60_000, end_ms: 80_000 },
  ];
  const env = {
    DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: rows }) }) }) },
  } as never;

  const out = await findMaterial(env, "u1", "eight minutes on whatever you have");
  assert.equal(out.how, "recent", "and it SAYS it fell back, so nobody reads it as an answer");
  assert.equal(out.moments.length, 2);
});

test("the clock reads as a time somebody can check against", () => {
  assert.equal(clock(0), "0:00");
  assert.equal(clock(9_000), "0:09");
  assert.equal(clock(185_000), "3:05");
  assert.equal(runtimeMs([at(0, 30, "x"), at(60_000, 45, "y")]), 75_000);
});

test("words and meaning are peers, so words can surface what the vector missed", async () => {
  /*
   * THE FAILURE THIS FIXES, which is specific rather than theoretical.
   *
   * findMaterial used to return the meaning results whenever there were any
   * and only consult words when the index gave nothing. So on any account
   * where the index existed, an exact match the embedding ranked badly — a
   * proper name, a number, a piece of jargon, which is precisely what
   * embeddings are worst at — was unreachable. 06-FOOTAGE-SYSTEM.md: "On
   * transcripts, keyword search is a peer retriever."
   */
  const rows = [
    { id: "vague", quote: "the whole launch thing was a bit of a mess honestly", source_id: "s1", start_ms: 0, end_ms: 20_000 },
    { id: "exact", quote: "the Hesketh contract was signed on the fourteenth", source_id: "s1", start_ms: 60_000, end_ms: 80_000 },
  ];
  const env = {
    DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: rows }) }) }) },
    /* An index that exists and ranks the wrong one first — the normal case,
       not a broken one. */
    VECTORIZE: {
      query: async () => ({ matches: [{ id: "vague" }] }),
    },
    AI: { run: async () => ({ data: [Array(1024).fill(0.1)] }) },
  } as never;

  const out = await findMaterial(env, "u1", "the Hesketh contract");
  assert.equal(out.how, "meaning", "the index took part, which is all `how` claims");
  assert.deepEqual(
    out.moments.map((m) => m.id).sort(),
    ["exact", "vague"],
    "both retrievers' results are present — the old code returned only the vector's",
  );
  /*
   * They TIE, and that is correct rather than a shortfall: each is first in
   * one list and absent from the other, so 1/(60+1) each. Preferring one would
   * mean deciding that an exact match on a proper noun beats a vector hit, and
   * there is no evidence for that — it is a threshold to tune against the eval
   * set, not a constant to invent here.
   */
  assert.equal(out.moments.length, 2);
});

test("rank fusion scores by position, not by incomparable similarity numbers", () => {
  /*
   * A cosine similarity and a count of matched words have no exchange rate, so
   * any constant mixing them would be invented. Ranks are comparable by
   * construction.
   *
   * Hand-computed from 1/(60 + rank), and note what the FIRST version of this
   * test got wrong: it used two lists that were each other's reverse, which
   *   under RRF tie exactly — every symmetric swap does — so it could not have
   *   distinguished a working fusion from a broken one.
   *
   *   x: 1/61 + 1/61 = 0.03279   first in both lists
   *   y: 1/62        = 0.01613   second in one list
   *   z: 1/62        = 0.01613   second in the other
   *
   * So agreement between two retrievers beats a confident first place in one,
   * which is the property the whole method exists for.
   */
  const A = [{ id: "x" }, { id: "y" }];
  const B = [{ id: "x" }, { id: "z" }];
  assert.deepEqual(fuseByRank([A, B], (x) => x.id).map((x) => x.id), ["x", "y", "z"]);

  const only = [{ id: "x" }];
  const agreed = [{ id: "y" }, { id: "x" }];
  assert.deepEqual(
    fuseByRank([only, agreed], (x) => x.id).map((x) => x.id),
    ["x", "y"],
    "x: 1/61 + 1/62 beats y: 1/61 alone",
  );

  assert.deepEqual(fuseByRank([[], []], (x: { id: string }) => x.id), []);
  assert.equal(RRF_K, 60, "the conventional constant; changing it reweights every fusion");
});
