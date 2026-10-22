/**
 * CONTENT-ADDRESSED CACHING — invariant 5, where it still leaked.
 *
 * "Footage is read and charged once; editing is free." Transcription obeyed
 * that; model calls did not. Re-run a pass over the same transcript with the
 * same brief and the same model and the whole thing was paid for again.
 *
 * Two things are worth testing hardest, and neither is "does it return the
 * row". A CACHE THAT ANSWERS A DIFFERENT QUESTION is worse than no cache, so
 * the key has to move when anything that decides the answer moves. And a
 * SAMPLED capability must never be cached, or the first draft is frozen for
 * ever and "try again" is a lie.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fakeD1 } from "./helpers/fake-d1.ts";
import {
  MAX_BODY,
  TTL_MS,
  cacheable,
  countHit,
  keyFor,
  lookup,
  saved,
  store,
  type Addressable,
} from "../src/call-cache.ts";
import { CAPABILITIES, resolveFor } from "../src/models.ts";
import type { Capability, Resolved } from "../src/models.ts";

const SCHEMA = readFileSync(join(import.meta.dirname, "../migrations/schema.sql"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

function db() {
  const d = new DatabaseSync(":memory:");
  const ddl = SCHEMA.split(";").find((s) => /create table if not exists call_cache\s*\(/i.test(s));
  assert.ok(ddl, "migrations/schema.sql has no call_cache — run `npm run schema`");
  d.exec(ddl + ";");
  return d;
}

const CF: Resolved = {
  provider: "workers-ai",
  id: "@cf/zai-org/glm-5.3",
  context: 1_048_576,
  jsonSchema: true,
  diarizes: false,
  temperature: 0,
};
const CLAUDE: Resolved = {
  provider: "anthropic",
  id: "claude-opus-5-5",
  context: 200_000,
  jsonSchema: true,
  diarizes: false,
  effort: "xhigh",
};

const base: Addressable = {
  capability: "judge",
  model: CF,
  promptVersion: "judge-1",
  system: "You decide whether speech backs a claim.",
  user: "CLAIM: the launch moved",
  schema: { type: "object" },
};

/* ── What may be cached ─────────────────────────────────────────────────── */

test("ACCEPTANCE: only a capability with one right answer is cacheable", () => {
  /*
   * Read off the temperature rather than declared, so the two cannot
   * disagree. src/models.ts pins judge, classify and arrange to 0 because
   * their answer is a decision; `direct` and `name` write prose and stay
   * sampled, and a cache over those would freeze the first draft.
   */
  assert.equal(cacheable(CF), true);
  assert.equal(cacheable({ ...CF, temperature: undefined }), false, "a sampled call was cacheable");

  /* And the real table agrees with the real resolver. */
  const caps = Object.keys(CAPABILITIES) as Capability[];
  for (const cap of caps) {
    const pinned = CAPABILITIES[cap].temperature === 0;
    const resolved = resolveFor(cap, {});
    assert.equal(
      cacheable(resolved),
      pinned,
      `${cap} is ${pinned ? "pinned" : "sampled"} and ${cacheable(resolved) ? "is" : "is not"} cacheable`,
    );
  }
  /* Something must be in each bucket, or this test asserts nothing. */
  assert.ok(caps.some((c) => cacheable(resolveFor(c, {}))));
  assert.ok(caps.some((c) => !cacheable(resolveFor(c, {}))));
});

test("ACCEPTANCE: an Anthropic call is never cached, because it cannot be pinned", () => {
  /*
   * The sampling parameters are removed on the current Claude models, so the
   * better model is the one whose answers cannot be reused. A real limit,
   * and stated rather than worked around.
   */
  assert.equal(cacheable(CLAUDE), false);
  assert.equal(cacheable({ ...CLAUDE, temperature: 0 }), false, "a temperature on Claude is a 400, not a licence");
});

/* ── The key ────────────────────────────────────────────────────────────── */

test("ACCEPTANCE: every field that changes the answer changes the key", async () => {
  /*
   * A cache that answers a different question with a straight face is worse
   * than no cache. Each field in turn, because leaving one out of the hash
   * is the one bug here that produces confident wrong answers.
   */
  const key = await keyFor(base);
  const moved: Array<[string, Addressable]> = [
    ["capability", { ...base, capability: "classify" }],
    ["model id", { ...base, model: { ...CF, id: "@cf/other/model" } }],
    ["effort", { ...base, model: { ...CF, effort: "low" } }],
    ["temperature", { ...base, model: { ...CF, temperature: 0.7 } }],
    ["prompt version", { ...base, promptVersion: "judge-2" }],
    ["system", { ...base, system: `${base.system} And be brief.` }],
    ["user", { ...base, user: "CLAIM: something else" }],
    ["schema", { ...base, schema: { type: "array" } }],
  ];
  for (const [what, a] of moved) {
    assert.notEqual(await keyFor(a), key, `${what} changed and the key did not`);
  }
  /* And the same call twice is the same key, or nothing ever hits. */
  assert.equal(await keyFor({ ...base }), key);
});

test("two calls cannot collide by one field ending where the next begins", async () => {
  /* "ab" + "c" and "a" + "bc" are the same string joined naively, and would
     be the same key — a different question with the same address. */
  const a = await keyFor({ ...base, system: "ab", user: "c" });
  const b = await keyFor({ ...base, system: "a", user: "bc" });
  assert.notEqual(a, b);
});

/* ── The row ────────────────────────────────────────────────────────────── */

test("a stored answer comes back, and a hit is counted", async () => {
  const d = db();
  const D = fakeD1(d) as never;
  const key = await keyFor(base);
  await store(D, key, base, { judgements: [{ moment: "m1", verdict: "backs" }] });

  const hit = await lookup(D, key);
  assert.ok(hit, "nothing came back");
  assert.deepEqual(hit.raw, { judgements: [{ moment: "m1", verdict: "backs" }] });

  await countHit(D, key);
  await countHit(D, key);
  /* What caching saved is a number, not a belief. */
  assert.deepEqual(await saved(D), { rows: 1, hits: 2 });
});

test("ACCEPTANCE: an answer past its shelf life is a miss", async () => {
  const d = db();
  const D = fakeD1(d) as never;
  const key = await keyFor(base);
  const long = Date.now() - TTL_MS - 1;
  await store(D, key, base, { old: true }, long);

  assert.equal(await lookup(D, key), null, "a month-old answer was served");
  /* And it is left for the sweep rather than deleted on read — a read that
     writes is a read that can fail on a replica. */
  assert.equal((d.prepare("SELECT COUNT(*) AS n FROM call_cache").get() as { n: number }).n, 1);
});

test("a read failure is a miss, never an error", async () => {
  /* The same rule as the spend cap and the breaker: if the bookkeeping
     cannot be reached, do the work rather than refuse it. */
  const broken = { prepare: () => { throw new Error("no database"); } } as never;
  assert.equal(await lookup(broken, "whatever"), null);
  await store(broken, "k", base, { a: 1 });
  await countHit(broken, "k");
  assert.deepEqual(await saved(broken), { rows: 0, hits: 0 });
});

test("an answer too big to be worth keeping is not kept", async () => {
  const d = db();
  const D = fakeD1(d) as never;
  const key = await keyFor(base);
  await store(D, key, base, { blob: "x".repeat(MAX_BODY + 1) });
  assert.equal(await lookup(D, key), null);
  assert.deepEqual(await saved(D), { rows: 0, hits: 0 });
});

test("the first answer wins — a second store does not overwrite it", async () => {
  /* ON CONFLICT DO NOTHING. Two workers racing the same call should agree
     about what the answer was, and the one that got there first is as good
     an arbiter as any. */
  const d = db();
  const D = fakeD1(d) as never;
  const key = await keyFor(base);
  await store(D, key, base, { first: true });
  await store(D, key, base, { second: true });
  assert.deepEqual((await lookup(D, key))?.raw, { first: true });
});
