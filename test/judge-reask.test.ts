/**
 * THE RE-ASK: a moment the judge said nothing about is not a verdict.
 *
 * `parseJudgements` scores an unanswered moment `unrelated`, because
 * something has to be scored and `unrelated` is the one answer nobody
 * asserted. That is the right default and an invisible one — and the first
 * run of eval/adversarial.jsonl lost two whole claims to it before anything
 * here existed. The judge said "unrelated" for four moments it had never
 * looked at, and the report called it caution.
 *
 * So: ask again, naming the gap; keep the first answer where there is one;
 * and if the second call is no better, SAY the result is short rather than
 * return a list that reads complete.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { budgetFor, judge } from "../src/judge.ts";

const CANDIDATES = [
  { id: "c1", quote: "The launch went out and the review landed a week after it." },
  { id: "c2", quote: "No, the review came first. We would never ship ahead of one." },
];

/** A model that answers with the Nth scripted reply, and records the asks. */
function stub(replies: unknown[]) {
  const asks: string[] = [];
  const env = {
    AI: {
      run: async (_m: string, input: Record<string, unknown>) => {
        const msgs = input.messages as Array<{ content: string }>;
        asks.push(msgs[msgs.length - 1].content);
        return replies[Math.min(asks.length - 1, replies.length - 1)];
      },
    },
  } as never;
  return { env, asks };
}

/* The shape Workers AI returns for a json_schema call: the object itself,
   not a string to parse. The truncation case below is the other shape. */
const answer = (rows: unknown[]) => ({ judgements: rows });

test("a moment the first answer skipped is asked about again, by name", async () => {
  const { env, asks } = stub([
    answer([{ moment: "m1", verdict: "backs", sentence: 1, why: "It dates the two." }]),
    answer([
      { moment: "m1", verdict: "backs", sentence: 1, why: "It dates the two." },
      { moment: "m2", verdict: "related", why: "A denial, not support." },
    ]),
  ]);

  const out = await judge(env, "the launch was moved before the review came in", CANDIDATES);

  assert.equal(asks.length, 2, "one call covered one of two moments; the gap needs a second");
  assert.doesNotMatch(asks[0], /did not answer/, "nothing is owed on the first ask");
  assert.match(asks[1], /You did not answer for m2\./);
  /* The whole list goes again. A re-ask narrowed to the gap would ask the
     hardest question with the context that makes it answerable removed. */
  assert.match(asks[1], /week after it/);
  assert.match(asks[1], /never ship ahead/);

  assert.equal(out.reasked, true);
  assert.equal(out.unanswered, 0);
  assert.deepEqual(out.judgements.map((j) => j.said), ["backs", "related"]);
  assert.deepEqual(out.judgements.map((j) => j.answered), [true, true]);
});

test("a covered answer costs one call, and the tail never appears", async () => {
  const { env, asks } = stub([
    answer([
      { moment: "m1", verdict: "backs", sentence: 1, why: "It dates the two." },
      { moment: "m2", verdict: "unrelated", why: "Different evening." },
    ]),
  ]);

  const out = await judge(env, "the launch was moved before the review came in", CANDIDATES);

  assert.equal(asks.length, 1, "every moment was answered; a second call is a bill for nothing");
  assert.equal(out.reasked, false);
  assert.equal(out.unanswered, 0);
});

test("the first answer wins where it exists", async () => {
  /*
   * A model asked again about a moment it already judged may answer
   * differently, and the verdict reached with nothing owed is the better of
   * the two. The second reply here changes m1 to `unrelated` and must not
   * be allowed to.
   */
  const { env } = stub([
    answer([{ moment: "m1", verdict: "backs", sentence: 1, why: "It dates the two." }]),
    answer([
      { moment: "m1", verdict: "unrelated", why: "Changed my mind." },
      { moment: "m2", verdict: "related", why: "A denial." },
    ]),
  ]);

  const out = await judge(env, "the launch was moved before the review came in", CANDIDATES);
  assert.equal(out.judgements[0].said, "backs");
  assert.equal(out.judgements[1].said, "related");
});

test("a second answer that is no better leaves the result short, and says so", async () => {
  /* The truncation that started this returns nothing parseable at all. */
  const { env, asks } = stub([{ response: "{\"judgements\": [{\"moment\": \"m1\", \"verdi" }]);

  const out = await judge(env, "the launch was moved before the review came in", CANDIDATES);
  assert.equal(asks.length, 2, "one re-ask, not a loop that turns a broken model into a bill");
  assert.equal(out.reasked, true);
  assert.equal(out.unanswered, 2, "both moments are unanswered and the result has to say which");
  /* And the list still reads `unrelated`, which is why the count exists. */
  assert.deepEqual(out.judgements.map((j) => j.said), ["unrelated", "unrelated"]);
});

test("the budget grows with the moments, because the reasoning does", async () => {
  /*
   * It was a flat 2000. GLM-5.3 spent 1519 output tokens on a two-moment
   * claim, so eight moments had no chance and the answer was cut off
   * mid-array.
   */
  assert.ok(budgetFor(2) > 1519 * 2, "two moments must not be able to spend the budget twice over");
  assert.ok(budgetFor(8) > budgetFor(2), "more moments, more room");
  assert.equal(budgetFor(0), budgetFor(1), "there is no call with no moments; the floor is one");
  assert.ok(budgetFor(100) <= 16000, "and it is capped, or a long list is a runaway");
});

test("the budget reaches the call", async () => {
  let sent = 0;
  const env = {
    AI: {
      run: async (_m: string, input: Record<string, unknown>) => {
        sent = Number(input.max_tokens);
        return answer([
          { moment: "m1", verdict: "related" },
          { moment: "m2", verdict: "related" },
        ]);
      },
    },
  } as never;
  await judge(env, "the launch was moved before the review came in", CANDIDATES);
  assert.equal(sent, budgetFor(2));
});
