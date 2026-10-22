/**
 * THE BREAKER, and the failure a breaker is most likely to introduce.
 *
 * Phase 8 accepts on "kill a provider mid-job in staging and the job
 * completes on another pool with every item accounted for". The second half
 * already existed: a load-bearing capability routes to Claude with a key and
 * to Workers AI without one, so the fallback is the branch most of this
 * product runs on rather than a cold path written for an outage.
 *
 * The first half is this. And the thing worth testing hardest is not that it
 * trips — it is WHAT MUST NEVER TRIP IT: a 429 on one person's own key is
 * their account's limit, and shutting a shared pool on it would take the
 * platform down for everybody because somebody pasted a bad key.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fakeD1 } from "./helpers/fake-d1.ts";
import {
  COOLDOWN_MS,
  POOLS,
  TRIP_AFTER,
  WINDOW_MS,
  afterFailure,
  afterSuccess,
  allHealth,
  callRouted,
  decide,
  fresh,
  healthOf,
  otherPool,
  poolOf,
  poolsFault,
  writeHealth,
} from "../src/breaker.ts";
import { ModelCallFailed } from "../src/llm.ts";

const SCHEMA = readFileSync(join(import.meta.dirname, "../migrations/schema.sql"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

function db() {
  const d = new DatabaseSync(":memory:");
  const ddl = SCHEMA.split(";").find((s) => /create table if not exists pool_health\s*\(/i.test(s));
  assert.ok(ddl, "migrations/schema.sql has no pool_health — run `npm run schema`");
  d.exec(ddl + ";");
  return d;
}

const CLAUDE = { provider: "anthropic", id: "claude-opus-5-5", context: 200_000, jsonSchema: true, diarizes: false } as const;
const CALL = { system: "s", user: "u", maxTokens: 100 };

/** An env whose Workers AI answers and whose fetch is the caller's business. */
function env(d: DatabaseSync, over: Record<string, unknown> = {}) {
  const asked: string[] = [];
  return {
    asked,
    env: {
      DB: fakeD1(d),
      AI: {
        run: async (m: string) => {
          asked.push(m);
          return { response: "{}" };
        },
      },
      ...over,
    } as never,
  };
}

/* ── What may trip it ───────────────────────────────────────────────────── */

test("ACCEPTANCE: a limit on the user's own key never shuts a shared pool", () => {
  /*
   * THE FAILURE A BREAKER INTRODUCES. One person's 429 is their account's
   * window, and one person's 401 is their key being wrong. Either tripping
   * the platform pool would be an outage this product caused, affecting
   * everybody, because somebody pasted a bad key.
   */
  assert.equal(poolsFault("user_key_limit"), false);
  assert.equal(poolsFault("user_key_bad"), false);

  let s = fresh("anthropic/platform");
  for (let i = 0; i < TRIP_AFTER * 3; i += 1) {
    s = afterFailure(s, "user_key_limit", "Your key hit its limit.", 1000 + i);
  }
  assert.equal(s.failures, 0, "their limit was counted against our pool");
  assert.equal(decide(s, 9_999_999), "closed");
});

test("ACCEPTANCE: the provider saying no, and not answering, both count", () => {
  assert.equal(poolsFault("provider_busy"), true);
  assert.equal(poolsFault("ours"), true);
});

test(`${TRIP_AFTER} failures inside the window shut it; spread out they do not`, () => {
  let tight = fresh("anthropic/platform");
  for (let i = 0; i < TRIP_AFTER; i += 1) tight = afterFailure(tight, "provider_busy", "busy", 1000 + i * 10);
  assert.equal(decide(tight, 1000 + TRIP_AFTER * 10), "open");

  /* The same number of failures, one per window. A count that never reset
     would shut every pool eventually. */
  let spread = fresh("anthropic/platform");
  for (let i = 0; i < TRIP_AFTER * 4; i += 1) {
    spread = afterFailure(spread, "provider_busy", "busy", 1000 + i * (WINDOW_MS + 1));
  }
  assert.equal(spread.failures, 1, "the window never restarted");
  assert.equal(decide(spread, 9_999_999), "closed");
});

test("a shut pool is tried again once, after the cooldown", () => {
  /* Without half-open a pool that tripped once is never tried again, which
     is an outage this product caused rather than suffered. */
  let s = fresh("anthropic/platform");
  for (let i = 0; i < TRIP_AFTER; i += 1) s = afterFailure(s, "provider_busy", "busy", 1000 + i);
  const shutAt = s.openedAt!;
  assert.equal(decide(s, shutAt + COOLDOWN_MS - 1), "open");
  assert.equal(decide(s, shutAt + COOLDOWN_MS), "half-open");
});

test("a failed probe shuts it again, so it is probed once per cooldown", () => {
  /*
   * THIS TEST ASSERTED THE OPPOSITE AND WAS WRONG.
   *
   * It claimed `openedAt` should stay where it first shut, "so the cooldown
   * is not extended" — which sounds careful and is the bug: if openedAt
   * never moves, `decide` returns half-open for ever after the first
   * cooldown and EVERY call probes a dead provider. That is a delay, not a
   * breaker. The code was right; the comment in it was wrong, and this test
   * was written from the comment.
   */
  let s = fresh("anthropic/platform");
  for (let i = 0; i < TRIP_AFTER; i += 1) s = afterFailure(s, "provider_busy", "busy", 1000);
  const firstShut = s.openedAt!;

  const probeAt = firstShut + COOLDOWN_MS;
  assert.equal(decide(s, probeAt), "half-open", "it should be probed once the cooldown is up");

  s = afterFailure(s, "provider_busy", "still busy", probeAt);
  assert.equal(s.openedAt, probeAt, "the probe failed and the pool did not shut again");
  assert.equal(decide(s, probeAt + 1), "open", "every call after a failed probe would hit a dead provider");
  assert.equal(decide(s, probeAt + COOLDOWN_MS), "half-open", "and it is probed again a cooldown later");
});

test("one success closes it and clears the count", () => {
  let s = fresh("anthropic/platform");
  for (let i = 0; i < TRIP_AFTER; i += 1) s = afterFailure(s, "provider_busy", "busy", 1000);
  const open = afterSuccess(s);
  assert.deepEqual(
    [open.failures, open.openedAt, open.lastSays],
    [0, null, null],
    "a working pool kept its failure count",
  );
});

/* ── Where it goes instead ──────────────────────────────────────────────── */

test("ACCEPTANCE: the other pool is the free one, which is not a cold path", () => {
  /*
   * `resolveFor(cap, {})` is what every account with no Anthropic key uses
   * all day, so the degraded route is tested on every commit rather than
   * only during an outage.
   */
  const other = otherPool("judge", CLAUDE);
  assert.ok(other, "a load-bearing capability had nowhere to go");
  assert.equal(other.provider, "workers-ai");
});

test("and there is no third route to invent when the free pool is the one that is shut", () => {
  const free = otherPool("judge", { ...CLAUDE, provider: "workers-ai" });
  assert.equal(free, null, "a fallback that cannot work is worse than a refusal");
});

test("the pool is named by how the model is reached, not by what it is", () => {
  assert.equal(poolOf(CLAUDE, true), "anthropic/user");
  assert.equal(poolOf(CLAUDE, false), "anthropic/platform");
  assert.equal(poolOf({ ...CLAUDE, provider: "workers-ai" }, true), "workers-ai");
  for (const p of [poolOf(CLAUDE, true), poolOf(CLAUDE, false)]) {
    assert.ok((POOLS as readonly string[]).includes(p));
  }
});

/* ── The call ───────────────────────────────────────────────────────────── */

test("ACCEPTANCE: a job on a shut pool completes on the other one, tagged", async () => {
  const d = db();
  let s = fresh("anthropic/platform");
  for (let i = 0; i < TRIP_AFTER; i += 1) s = afterFailure(s, "provider_busy", "the provider is down", Date.now());
  await writeHealth(fakeD1(d) as never, s);

  const { env: e, asked } = env(d, { ANTHROPIC_API_KEY: "sk-platform-aaaa" });
  const out = await callRouted(e, "judge", CLAUDE, CALL);

  assert.equal(out.degraded, true);
  assert.equal(out.pool, "workers-ai");
  assert.equal(out.why, "the provider is down", "the reason that shut it was not carried");
  assert.equal(asked.length, 1, "the Workers AI model was not actually asked");
  /* And the answer is TAGGED with what served it, so a receipt made during
     an outage says so afterwards. */
  assert.equal(out.provider, "workers-ai");
});

test("a shut pool is not called at all — that is the point", async () => {
  /* The cost of an outage is otherwise one timeout per call per item, paid
     by every job running. */
  const d = db();
  let s = fresh("anthropic/platform");
  for (let i = 0; i < TRIP_AFTER; i += 1) s = afterFailure(s, "provider_busy", "down", Date.now());
  await writeHealth(fakeD1(d) as never, s);

  let reached = 0;
  const real = globalThis.fetch;
  globalThis.fetch = (async () => {
    reached += 1;
    return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
  }) as never;
  try {
    const { env: e } = env(d, { ANTHROPIC_API_KEY: "sk-platform-aaaa" });
    await callRouted(e, "judge", CLAUDE, CALL);
  } finally {
    globalThis.fetch = real;
  }
  assert.equal(reached, 0, "the shut pool was called anyway");
});

test("a failure on the wire is counted, and the row says why", async () => {
  const d = db();
  const { env: e } = env(d, { ANTHROPIC_API_KEY: "sk-platform-aaaa" });
  const real = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: false,
    status: 429,
    json: async () => ({}),
    text: async () => "slow down",
  })) as never;
  try {
    await assert.rejects(() => callRouted(e, "judge", CLAUDE, CALL), ModelCallFailed);
  } finally {
    globalThis.fetch = real;
  }

  const after = await healthOf(fakeD1(d) as never, "anthropic/platform");
  assert.equal(after.failures, 1);
  assert.match(after.lastSays ?? "", /rate-limiting/);
});

test("a read failure never shuts a pool", async () => {
  /* The same rule as the spend cap: if the bookkeeping is unreachable, the
     honest answer is to try the call, not to refuse work. */
  const broken = { prepare: () => { throw new Error("no database"); } } as never;
  const s = await healthOf(broken, "anthropic/platform");
  assert.deepEqual(s, fresh("anthropic/platform"));
  assert.equal(decide(s, Date.now()), "closed");
});

test("every pool is reported, including the ones nothing has written", async () => {
  /* The operator view: a pool with no row is healthy, not missing. */
  const rows = await allHealth(fakeD1(db()) as never);
  assert.deepEqual(rows.map((r) => r.pool), [...POOLS]);
  for (const r of rows) assert.equal(r.verdict, "closed");
});

/* ── The cache, where it meets the breaker ──────────────────────────────── */

test("ACCEPTANCE: an answer we already have asks nobody, and is not charged", async () => {
  /*
   * Invariant 5: "footage is read and charged once; editing is free". The
   * cache comes before the breaker on purpose — an answer we already have
   * does not care whether the provider is up.
   */
  const d = db();
  const cacheDdl = SCHEMA.split(";").find((s) => /create table if not exists call_cache\s*\(/i.test(s));
  assert.ok(cacheDdl, "migrations/schema.sql has no call_cache — run `npm run schema`");
  d.exec(cacheDdl + ";");

  const CF = { ...CLAUDE, provider: "workers-ai" as const, id: "@cf/zai-org/glm-5.3", temperature: 0 };
  const { env: e, asked } = env(d);

  const first = await callRouted(e, "judge", CF, CALL, { promptVersion: "judge-1" });
  assert.equal(first.cached, false);
  assert.equal(asked.length, 1);

  const second = await callRouted(e, "judge", CF, CALL, { promptVersion: "judge-1" });
  assert.equal(second.cached, true, "the identical call was paid for twice");
  assert.equal(asked.length, 1, "the model was asked again for an answer we had");
  assert.deepEqual(second.raw, first.raw);
});

test("a call that names no prompt version is never cached", async () => {
  /* Required there, optional here: a caller that cannot say when its prompt
     changed must not have its answers reused for a month. */
  const d = db();
  const cacheDdl = SCHEMA.split(";").find((s) => /create table if not exists call_cache\s*\(/i.test(s));
  d.exec(cacheDdl + ";");
  const CF = { ...CLAUDE, provider: "workers-ai" as const, id: "@cf/zai-org/glm-5.3", temperature: 0 };
  const { env: e, asked } = env(d);

  await callRouted(e, "judge", CF, CALL);
  await callRouted(e, "judge", CF, CALL);
  assert.equal(asked.length, 2, "an unversioned call was cached");
});

test("ACCEPTANCE: a degraded answer is never served as the better pool's", async () => {
  /*
   * THE SUBTLE ONE. When the Anthropic pool is shut the answer comes from
   * the free model, and it is cached — under ITS OWN address, because the
   * model is part of the key. Cached under the preferred model's key it
   * would be handed back later, after the outage, as though Claude had said
   * it: a receipt tagged with a model that never saw the question.
   */
  const d = db();
  const cacheDdl = SCHEMA.split(";").find((s) => /create table if not exists call_cache\s*\(/i.test(s));
  d.exec(cacheDdl + ";");

  let s = fresh("anthropic/platform");
  for (let i = 0; i < TRIP_AFTER; i += 1) s = afterFailure(s, "provider_busy", "down", Date.now());
  await writeHealth(fakeD1(d) as never, s);

  const { env: e } = env(d, { ANTHROPIC_API_KEY: "sk-platform-aaaa" });
  const out = await callRouted(e, "judge", CLAUDE, CALL, { promptVersion: "judge-1" });
  assert.equal(out.degraded, true);

  /* Nothing is stored under the model that was asked for and did not answer. */
  const rows = d.prepare("SELECT model FROM call_cache").all() as Array<{ model: string }>;
  assert.ok(rows.length, "the fallback's answer was not cached at all");
  for (const r of rows) {
    assert.notEqual(r.model, CLAUDE.id, "a free-model answer is addressed as though Claude gave it");
  }
});
