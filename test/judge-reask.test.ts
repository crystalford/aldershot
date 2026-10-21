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
import { budgetFor, judge, wasTruncated } from "../src/judge.ts";

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

test("the budget clears the hardest claim measured, with room to spare", async () => {
  /*
   * It was a flat 2000, then 2500 + 1400/moment. The hardest two-moment
   * claim in eval/adversarial.jsonl spends 4355 output tokens — so the
   * second sizing gave it 5300 and it failed twice under load. A budget a
   * known case comes within 18% of is a ceiling.
   */
  assert.ok(budgetFor(2) > 4355 * 1.5, "the worst case measured needs real headroom, not 18%");
  assert.ok(budgetFor(8) > budgetFor(2), "more moments, more room");
  assert.equal(budgetFor(0), budgetFor(1), "there is no call with no moments; the floor is one");
  assert.ok(budgetFor(100) <= 24000, "and it is capped, or a long list is a runaway");
});

test("truncation is measured, not asked about", async () => {
  /* Spending every token offered is what being cut off looks like from
     outside. Neither provider reports a stop reason, and the model's own
     account of whether it finished is the thing that did not finish. */
  assert.equal(wasTruncated(5300, 5300), true);
  assert.equal(wasTruncated(5301, 5300), true, ">= not ===, or an off-by-one never fires");
  assert.equal(wasTruncated(4355, 5300), false);
  assert.equal(wasTruncated(0, 0), false, "no budget is not a truncation");
});

test("a truncated first answer is re-asked with more room, not the same room", async () => {
  /*
   * A re-ask at the budget just exhausted is the same call again, and a
   * model that thought past its ceiling once will do it twice. This is the
   * failure that survived a re-ask on the real set.
   */
  const rooms: number[] = [];
  const env = {
    AI: {
      run: async (_m: string, input: Record<string, unknown>) => {
        const room = Number(input.max_tokens);
        rooms.push(room);
        /* Spends every token it is given, and so answers nothing. */
        if (rooms.length === 1) return { response: "{\"judgements\": [{\"mom", usage: { completion_tokens: room } };
        return {
          judgements: [
            { moment: "m1", verdict: "backs", sentence: 1 },
            { moment: "m2", verdict: "related" },
          ],
        };
      },
    },
  } as never;

  const out = await judge(env, "the launch was moved before the review came in", CANDIDATES);
  assert.equal(rooms.length, 2);
  assert.ok(rooms[1] > rooms[0], `the second ask got ${rooms[1]}, no more than the budget that failed`);
  assert.equal(out.unanswered, 0);
});

test("an untruncated skip is re-asked at the same budget", async () => {
  /* Room was not the problem — it answered inside its budget and left a
     moment out — so doubling would buy nothing and cost latency. */
  const rooms: number[] = [];
  const env = {
    AI: {
      run: async (_m: string, input: Record<string, unknown>) => {
        rooms.push(Number(input.max_tokens));
        if (rooms.length === 1) {
          return { judgements: [{ moment: "m1", verdict: "backs", sentence: 1 }], usage: { completion_tokens: 40 } };
        }
        return {
          judgements: [
            { moment: "m1", verdict: "backs", sentence: 1 },
            { moment: "m2", verdict: "related" },
          ],
        };
      },
    },
  } as never;

  await judge(env, "the launch was moved before the review came in", CANDIDATES);
  assert.equal(rooms.length, 2);
  assert.equal(rooms[1], rooms[0]);
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
