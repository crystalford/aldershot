/**
 * AN ANTHROPIC CALL COSTS DOLLARS, NOT NEURONS.
 *
 * Every token this product metered was priced at Workers AI neuron rates,
 * whichever provider ran the call. That was harmless while nothing could
 * reach Anthropic; src/llm.ts is the first thing that can, and the moment it
 * does the ledger starts understating those calls by about an order of
 * magnitude. The spend cap reads that ledger.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PRICES, computeCost } from "../src/usage.ts";
import { usageTokens } from "../src/grounding.ts";

const base = { user_id: "u1", job_type: "judge" as const };

test("ACCEPTANCE: the same tokens cost far more on Anthropic than on Workers AI", () => {
  /*
   * The bug in one assertion. A million in and a million out, priced both
   * ways: if these ever come out close, the branch has stopped working and
   * the ledger is wrong again.
   */
  const tokens = { tokens_in: 1_000_000, tokens_out: 1_000_000 };
  const onCf = computeCost({ ...base, ...tokens }, PRICES);
  const onAnthropic = computeCost({ ...base, ...tokens, provider: "anthropic" }, PRICES);

  assert.equal(onAnthropic, 24, "$4 in + $20 out per million");
  assert.ok(onAnthropic > onCf * 10, `Anthropic ${onAnthropic} vs Workers AI ${onCf} — too close to be two providers`);
});

test("a row with no provider is a Workers AI row, as every old row is", () => {
  /*
   * Prices are snapshotted per row so historical rows recompute against what
   * they were written with. A new field that changed the meaning of old rows
   * would rewrite history.
   */
  const tokens = { tokens_in: 500_000, tokens_out: 100_000 };
  assert.equal(
    computeCost({ ...base, ...tokens }, PRICES),
    computeCost({ ...base, ...tokens, provider: "workers-ai" }, PRICES),
  );
});

test("ACCEPTANCE: a cache hit is a twentieth of a fresh read", () => {
  /*
   * The whole point of caching, and the number the spend cap needs. Pricing
   * a cache read at the input rate makes caching look like it saved nothing;
   * pricing it at zero makes a long cached conversation look free.
   */
  const fresh = computeCost({ ...base, provider: "anthropic", tokens_in: 1_000_000 }, PRICES);
  const cached = computeCost({ ...base, provider: "anthropic", cache_read_tokens: 1_000_000 }, PRICES);
  assert.equal(fresh, 4);
  assert.equal(cached, 0.2);
  assert.equal(fresh / cached, 20);
});

test("writing the cache costs more than not caching, which is why it has to pay off", () => {
  /* 1.25x the input rate. A breakpoint that never gets read is a 25% surcharge
     — see the test in llm.test.ts that pins where the breakpoint goes. */
  const write = computeCost({ ...base, provider: "anthropic", cache_write_tokens: 1_000_000 }, PRICES);
  assert.equal(write, 5);
  assert.ok(write > 4, "a cache write must cost more than a plain read, or the trade is free");
});

test("the three token figures add up rather than overlapping", () => {
  /*
   * The provider reports `input_tokens` as the tokens that were NOT cached.
   * Counting a cached token in both places would bill it twice.
   */
  const split = computeCost(
    { ...base, provider: "anthropic", tokens_in: 50, cache_read_tokens: 200_000, cache_write_tokens: 0, tokens_out: 1000 },
    PRICES,
  );
  const expected =
    (50 / 1e6) * PRICES.usd_per_m_anthropic_in +
    (200_000 / 1e6) * PRICES.usd_per_m_anthropic_cache_read +
    (1000 / 1e6) * PRICES.usd_per_m_anthropic_out;
  assert.equal(split, expected);
});

test("a call that did nothing costs nothing", () => {
  assert.equal(computeCost({ ...base, provider: "anthropic" }, PRICES), 0);
});

test("the prices are dated and told to be re-checked", () => {
  /*
   * doc 10's own instruction about its cost table — "confirm every price" —
   * applies to a table transcribed from a docs page on one afternoon.
   */
  const src = readFileSync(join(import.meta.dirname, "..", "src", "usage.ts"), "utf8");
  assert.match(src, /21 Oct 2026/);
  /* The phrase wraps across a comment line, and the comment's own asterisk
     sits between the two words — so the leading markers go before the
     whitespace collapses. Reflowing the sentence to suit a test would be the
     test deciding how the file is written. */
  const prose = src.replace(/^\s*\*/gm, " ").replace(/\s+/g, " ");
  assert.match(prose, /confirm every price/);
});

test("ACCEPTANCE: both providers' token counts are read, not just one", () => {
  /*
   * Workers AI says prompt_tokens/completion_tokens; Anthropic says
   * input_tokens/output_tokens. Reading only the first pair made an Anthropic
   * call meter ZERO tokens — not a mispriced row, an absent one. Correct
   * prices over absent data is still a free call.
   */
  assert.deepEqual(usageTokens({ usage: { prompt_tokens: 10, completion_tokens: 20 } }), {
    tokensIn: 10,
    tokensOut: 20,
  });
  assert.deepEqual(usageTokens({ usage: { input_tokens: 10, output_tokens: 20 } }), {
    tokensIn: 10,
    tokensOut: 20,
  });
});

test("and anything else is zero rather than NaN", () => {
  /* A NaN cost propagates into the ledger and makes every sum after it NaN,
     which the spend cap then compares against a number. */
  for (const res of [{}, { usage: {} }, null, undefined, { usage: { input_tokens: "lots" } }]) {
    const t = usageTokens(res);
    assert.ok(Number.isFinite(t.tokensIn) && Number.isFinite(t.tokensOut), `${JSON.stringify(res)} gave NaN`);
  }
});
