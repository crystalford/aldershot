/**
 * "A job that does not meter is a bug" — src/usage.ts, quoting
 * 04-API-AND-JOBS.md. It is a rule the codebase states and nothing enforced,
 * and it was broken within hours of being quoted: arrangePass was written,
 * spent real tokens, and metered nothing at all.
 *
 * These read the source rather than run it, the same way
 * test/intent-dispatch.test.ts does — runScore needs env.AI, a queue and a
 * database, and the property worth protecting is structural: every path that
 * buys neurons writes a row saying so.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const begin = () => readFileSync(join(import.meta.dirname, "..", "src", "begin.ts"), "utf8");

/** The body of one function, from its signature to the next top-level one. */
function body(src: string, signature: string): string {
  const i = src.indexOf(signature);
  assert.ok(i >= 0, `couldn't find ${signature}`);
  const rest = src.slice(i + signature.length);
  const end = rest.search(/\n(export )?(async )?function /);
  return end === -1 ? rest : rest.slice(0, end);
}

test("a reorder pass meters what it spent", () => {
  /* It did not. It called the model, recorded the pass and finished the job
     without writing a usage row, so a whole class of instruction was free on
     the cost panel and invisible in the ledger. */
  const arrange = body(begin(), "async function arrangePass(");
  assert.match(arrange, /await meter\(/, "arrangePass buys tokens and must record them");
  assert.match(arrange, /job_type: "pass"/, "a reorder is a pass, like every other instruction");
  assert.match(arrange, /tokens_in: out\.tokensIn/, "it must meter what it actually spent");
});

test("a pass that dies after the model answered still records the spend", () => {
  /* meter() sat on the happy path and failJob touches only the jobs row, so
     tokens already bought vanished from the ledger whenever anything after the
     model call threw. The cost panel understated every failure. */
  const score = body(begin(), "export async function runScore(");
  const failure = score.slice(score.indexOf("} catch (err)"));
  assert.match(failure, /await meter\(/, "the catch must record what was already bought");
  assert.match(failure, /outcome: "failed"/, "and say that is what it was");
  assert.match(
    score,
    /const spent = \{ tokensIn: 0, tokensOut: 0 \}/,
    "the token count has to live outside the try or the catch cannot see it",
  );
});

test("the ledger says whether the money bought anything", () => {
  /* Deliberately not a discount. The neurons cost the same whether a pass
     found eight moments or none; zeroing the row would make the ledger
     understate real spend, which is a lie in the other direction. */
  const score = body(begin(), "export async function runScore(");
  assert.match(
    score,
    /outcome: result\.clips\.length \? "found" : "empty"/,
    "a scoring pass must say whether it found anything",
  );
});

test("nothing zeroes the tokens to avoid a charge", () => {
  const src = begin();
  assert.ok(
    !/tokens_in: 0,\s*tokens_out: 0/.test(src),
    "spend is recorded honestly; an outcome of 'empty' is how a fruitless pass is marked",
  );
});
