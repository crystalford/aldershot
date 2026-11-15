/**
 * THE CANARY AND THE DASHBOARD — Phase 8's last two.
 *
 * What is worth testing is not that the numbers add up. It is that the
 * dashboard never reports the ABSENCE of a check as the success of one, and
 * that the canary cannot pass while the thing it watches is broken.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fakeD1 } from "./helpers/fake-d1.ts";
import { BACKS, CLAIM, NEAR, canaryHealth, recordCanary, runCanary } from "../src/canary.ts";
import { canaryReading, itemReading, jobReading, poolReading, slo } from "../src/slo.ts";
import { TRIP_AFTER, afterFailure, fresh, writeHealth } from "../src/breaker.ts";

const SCHEMA = readFileSync(join(import.meta.dirname, "../migrations/schema.sql"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

const TABLES = ["canary_runs", "pool_health", "jobs", "job_items", "v2_users"];

function db() {
  const d = new DatabaseSync(":memory:");
  for (const name of TABLES) {
    const ddl = SCHEMA.split(";").find((s) =>
      new RegExp(`create table if not exists ${name}\\s*\\(`, "i").test(s),
    );
    assert.ok(ddl, `migrations/schema.sql has no ${name} — run \`npm run schema\``);
    d.exec(ddl + ";");
  }
  return d;
}

/** A judge whose answers the test chooses. */
const env = (d: DatabaseSync, reply: unknown) =>
  ({ DB: fakeD1(d), AI: { run: async () => reply } }) as never;

const answers = (rows: unknown[]) => ({ judgements: rows });

/* ── The canary ─────────────────────────────────────────────────────────── */

test("ACCEPTANCE: the canary knows the right answer, so a 200 of nonsense fails", async () => {
  /*
   * The failure a liveness probe misses. A provider that answers, with the
   * wrong answer, is worse than one that is down: nothing else in the
   * product would notice, and invariant 4 is what breaks.
   */
  const d = db();
  const wrong = await runCanary(
    env(d, answers([
      { moment: "m1", verdict: "related" },
      /* Calling the denial support is the one that matters most. */
      { moment: "m2", verdict: "backs", sentence: 1 },
    ])),
  );
  assert.equal(wrong.verdict, "wrong");
  assert.match(wrong.says, /denial/);
});

test("ACCEPTANCE: it passes only when support is found AND the near miss refused", async () => {
  const d = db();
  const ok = await runCanary(
    env(d, answers([
      { moment: "m1", verdict: "backs", sentence: 1, why: "It dates the two." },
      { moment: "m2", verdict: "related", why: "A denial." },
    ])),
  );
  assert.equal(ok.verdict, "ok", ok.says);
  assert.match(ok.says, /support found/);
});

test("a judge that refuses plain support is wrong, not down", async () => {
  const d = db();
  const r = await runCanary(env(d, answers([{ moment: "m2", verdict: "related" }])));
  assert.equal(r.verdict, "wrong");
  assert.match(r.says, /plain support/);
});

test("a call that answered nothing is down, not unanimous", async () => {
  /* parseJudgements fills gaps with `unrelated`, so a silent call arrives as
     a full list of confident noes — the trap src/judge.ts documents, and here
     it would report a broken provider as a working one with opinions. */
  const d = db();
  const r = await runCanary(env(d, answers([])));
  assert.equal(r.verdict, "down");
  assert.match(r.says, /nothing at all/);
});

test("a throw is down, carrying the reason", async () => {
  const d = db();
  const r = await runCanary({ DB: fakeD1(d), AI: { run: async () => { throw new Error("provider gone"); } } } as never);
  assert.equal(r.verdict, "down");
  assert.match(r.says, /provider gone|could not be reached/);
});

test("ACCEPTANCE: the canary cannot be served from the cache", async () => {
  /*
   * THE SUBTLE ONE. The call cache keys on the prompt version, and a canary
   * that hit it would come back green while the provider was down — testing
   * our own table instead of the thing it watches. `promptVersion` is what
   * makes a call cacheable, so the canary passes none.
   */
  /* COMMENTS STRIPPED, because this file explains at length why it passes
     no prompt version and the first version of this check found the word in
     its own prose. A check that matches its own documentation is not a
     check. */
  const src = readFileSync(join(import.meta.dirname, "../src/canary.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
  assert.doesNotMatch(src, /promptVersion/, "the canary names a prompt version, so it can be cached");
  /* And the claim and clips are the real ones, not a mock of them. */
  assert.ok(CLAIM.length > 10);
  assert.notEqual(BACKS.quote, NEAR.quote);
});

/* ── The dashboard ──────────────────────────────────────────────────────── */

test("ACCEPTANCE: never checked is not the same as checked and fine", () => {
  /*
   * A dashboard showing green here would report the absence of a check as
   * the success of one. It asks for attention instead.
   */
  const none = canaryReading({ last: null, ok: 0, of: 0 });
  assert.equal(none.value, null, "a dash, not a zero");
  assert.equal(none.attention, true);
  assert.match(none.says, /nothing has checked it yet/);

  const good = canaryReading({ last: { at: 1, verdict: "ok", says: "fine", model: "m", ms: 40 }, ok: 6, of: 6 });
  assert.equal(good.attention, false);
  assert.equal(good.value, 6);
});

test("ACCEPTANCE: one piece failing inside a finished job asks for attention", async () => {
  /*
   * THE NUMBER WITH TEETH. Invariant 7: "silent partial failure is a P1."
   * The completion invariant exists to make it impossible; this counts
   * whether it is happening anyway, because a rule nobody measures is a rule
   * that can stop applying without telling anybody. No acceptable rate, so
   * no share to clear.
   */
  const d = db();
  const now = Date.now();
  d.prepare("INSERT INTO jobs (id,user_id,type,state,pct,queued_overnight,created_at) VALUES ('j1','u','scout','ready',99,0,?)").run(now);
  for (const [id, status] of [["a", "succeeded"], ["b", "succeeded"], ["c", "failed_terminal"]]) {
    d.prepare(
      "INSERT INTO job_items (id,job_id,kind,status,attempt,idempotency_key,created_at,updated_at) VALUES (?,'j1','scan',?,1,?,?,?)",
    ).run(id, status, `k-${id}`, now, now);
  }

  const r = await itemReading(fakeD1(d) as never, now);
  assert.equal(r.attention, true, "a piece failed inside a job that said it was ready");
  assert.equal(r.value, 2);
  assert.equal(r.of, 3);
  assert.match(r.says, /P1/);
});

test("ONE piece in twenty is still a P1 — there is no acceptable rate", async () => {
  /*
   * THE BREAK THAT FAILED NOTHING. Giving this reading a 10% tolerance
   * passed every test, because the fixture above is one failure in three and
   * clears any threshold. Unlike the job reading — where one failure in a
   * day is Tuesday — silent partial failure has no share to clear, so the
   * fixture has to be one a tolerance would forgive.
   */
  const d = db();
  const now = Date.now();
  d.prepare("INSERT INTO jobs (id,user_id,type,state,pct,queued_overnight,created_at) VALUES ('j2','u','scout','ready',99,0,?)").run(now);
  for (let i = 0; i < 20; i += 1) {
    d.prepare(
      "INSERT INTO job_items (id,job_id,kind,status,attempt,idempotency_key,created_at,updated_at) VALUES (?,'j2','scan',?,1,?,?,?)",
    ).run(`x${i}`, i === 0 ? "failed_terminal" : "succeeded", `kx-${i}`, now, now);
  }

  const r = await itemReading(fakeD1(d) as never, now);
  assert.equal(r.of, 20);
  assert.equal(r.value, 19);
  assert.equal(r.attention, true, "one piece in twenty was forgiven");
});

test("a day with no jobs reports a dash, and does not ask for attention", async () => {
  /* Nothing ran. That is not a problem, and it is not a perfect record
     either — the sentence says which. */
  const r = await jobReading(fakeD1(db()) as never);
  assert.equal(r.value, null);
  assert.equal(r.attention, false);
  assert.match(r.says, /nothing has run today/);
});

test("the sentence says which number is the total", async () => {
  /*
   * Driven against a dev database full of failed local runs, the line read
   * "1476 jobs of 1478 failed" — which parses as though 1476 were the
   * total. A reading nobody can parse at a glance is a reading nobody
   * reads, and this panel exists to be read at 2am.
   */
  const d = db();
  const now = Date.now();
  for (let i = 0; i < 3; i += 1) {
    d.prepare("INSERT INTO jobs (id,user_id,type,state,pct,queued_overnight,created_at) VALUES (?,'u','pass',?,99,0,?)").run(
      `t${i}`,
      i === 0 ? "failed" : "ready",
      now,
    );
  }
  const r = await jobReading(fakeD1(d) as never, now);
  assert.match(r.says, /^1 of 3 jobs failed$/);
});

test("one failed job in a day is Tuesday; a third of them is not", async () => {
  const now = Date.now();
  const make = (d: DatabaseSync, n: number, state: string, from: number) => {
    for (let i = 0; i < n; i += 1) {
      d.prepare("INSERT INTO jobs (id,user_id,type,state,pct,queued_overnight,created_at) VALUES (?,'u','pass',?,99,0,?)").run(
        `j${from + i}`,
        state,
        now,
      );
    }
  };
  const quiet = db();
  make(quiet, 19, "ready", 0);
  make(quiet, 1, "failed", 100);
  assert.equal((await jobReading(fakeD1(quiet) as never, now)).attention, false);

  const loud = db();
  make(loud, 6, "ready", 0);
  make(loud, 3, "failed", 100);
  assert.equal((await jobReading(fakeD1(loud) as never, now)).attention, true);
});

test("a shut pool is named in the reading, with the reason", () => {
  let s = fresh("anthropic/platform");
  for (let i = 0; i < TRIP_AFTER; i += 1) s = afterFailure(s, "provider_busy", "the provider is down", 1000);
  const r = poolReading([
    { ...fresh("anthropic/user"), verdict: "closed" },
    { ...s, verdict: "open" },
    { ...fresh("workers-ai"), verdict: "closed" },
  ]);
  assert.equal(r.attention, true);
  assert.match(r.says, /anthropic\/platform/);
  assert.match(r.says, /the provider is down/);
});

test("the four read together, from rows the product already writes", async () => {
  const d = db();
  const now = Date.now();
  await recordCanary(fakeD1(d) as never, { verdict: "ok", says: "fine", model: "m", ms: 30 }, now);
  let s = fresh("anthropic/platform");
  for (let i = 0; i < TRIP_AFTER; i += 1) s = afterFailure(s, "provider_busy", "down", now);
  await writeHealth(fakeD1(d) as never, s, now);

  const out = await slo(fakeD1(d) as never, now);
  assert.equal(out.canary.attention, false, "a good canary asked for attention");
  assert.equal(out.pools.attention, true, "a shut pool did not");
  assert.equal(out.poolRows.length, 3, "every pool is listed, including the ones nothing wrote");
  /* And the canary row round-trips, so the dashboard reads what the sweep
     actually wrote rather than a shape the test invented. */
  const h = await canaryHealth(fakeD1(d) as never, 24 * 3600 * 1000, now);
  assert.equal(h.of, 1);
  assert.equal(h.last?.says, "fine");
});
