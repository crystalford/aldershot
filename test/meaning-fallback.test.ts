/**
 * An index that is declared but does not answer.
 *
 * searchMeaning guarded on `if (!env.VECTORIZE)` — whether the BINDING is
 * declared — for as long as there was no index, so the guard and the question
 * "does meaning search work here" happened to agree. The hour the index was
 * created they stopped agreeing, and the first request after switching the
 * binding on was a 500 on the Footage page and a 500 on the whole assembly
 * path, because Vectorize has no local implementation and throws.
 *
 * The same hole is a production outage waiting for a bad minute: Vectorize
 * briefly unreachable should cost the better half of search, not the page.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { searchMeaning } from "../src/library.ts";

const DB = {
  prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }) }) }),
} as never;

test("an index that throws is the same answer as no index at all", async () => {
  const env = {
    DB,
    AI: { run: async () => ({ data: [Array(1024).fill(0.1)] }) },
    VECTORIZE: {
      query: async () => {
        throw new Error("Binding VECTORIZE needs to be run remotely");
      },
    },
  } as never;

  /*
   * NULL, not []. The caller tells them apart: null means "the index did not
   * answer, fall back and say so", and [] means "your library has nothing
   * like that", which would be a lie here and the more misleading of the two.
   */
  assert.equal(await searchMeaning(env, "u1", "leaving"), null);
});

test("an embedder that throws is also null, not a crash", async () => {
  /* Two halves, two ways to fail. The model call is the one that costs money
     and is therefore the one that gets rate-limited. */
  const env = {
    DB,
    AI: { run: async () => { throw new Error("rate limited"); } },
    VECTORIZE: { query: async () => ({ matches: [] }) },
  } as never;
  assert.equal(await searchMeaning(env, "u1", "leaving"), null);
});

test("no binding at all is still null", async () => {
  /* The original case, which must keep working — an account that has never
     had an index is the normal state, not an error. */
  assert.equal(await searchMeaning({ DB } as never, "u1", "leaving"), null);
});

test("an index that answers with nothing is [], and that is a different fact", async () => {
  /*
   * The distinction the whole null/[] split exists for. An index that works
   * and matched nothing means the library really has nothing like that, and
   * the page must NOT then claim meaning search is switched off.
   */
  const env = {
    DB,
    AI: { run: async () => ({ data: [Array(1024).fill(0.1)] }) },
    VECTORIZE: { query: async () => ({ matches: [] }) },
  } as never;
  assert.deepEqual(await searchMeaning(env, "u1", "leaving"), []);
});
