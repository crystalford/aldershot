/**
 * THE EDITING COPY STOPS BEING ATTEMPTED.
 *
 * `proxyFirst` jumps the video you just opened to the front of the proxy
 * queue, and its guard checked `queued` and `running` and not `failed`. So a
 * video whose copy could not be made got a NEW job on every single view of
 * its cut page, for the life of the account.
 *
 * That is not hypothetical and it is not small. The development database —
 * read for the first time while answering "what percentage are we at" —
 * holds 9,700 jobs, of which 9,695 are failed proxies against three videos,
 * and exactly one job of any kind has ever succeeded. In production each of
 * those is a container start, a usage_events row and a dead-letter
 * candidate, for a file that may never be copyable.
 *
 * The job ROW is what these tests count, deliberately: `createJob` runs
 * before `dispatch`, so a row per attempt is exactly the thing that
 * accumulated 9,695 times, whether or not the queue behind it was reachable.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { fakeD1, schema } from "./helpers/fake-d1.ts";
import { PROXY_ATTEMPTS, PROXY_RETRY_AFTER_MS, proxyFirst } from "../src/proxy.ts";
import type { Env } from "../src/env.ts";

const USER = "u1";
const SRC = { id: "s1", user_id: USER, r2_key: "u/u1/sources/s1/original.mp4", proxy_r2_key: null };

function bench() {
  const sqlite = new DatabaseSync(":memory:");
  schema(sqlite);
  const DB = fakeD1(sqlite);
  /*
   * No queue binding and no container. `dispatch` therefore does not
   * deliver, and proxyFirst swallows that exactly as it does in production
   * when the encoder is down — which is the right shape for this test: the
   * question is whether a job is CREATED, not whether it ran.
   */
  const env = { DB } as unknown as Env;
  const ctx = {
    waitUntil: (p: Promise<unknown>) => void Promise.resolve(p).catch(() => {}),
    passThroughOnException: () => {},
    props: {},
  } as unknown as ExecutionContext;

  const proxies = () =>
    (sqlite.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE type='proxy'`).get() as { n: number }).n;

  /** A finished proxy attempt, as the consumer would have left it. */
  const failedAt = (ms: number, i = 0) =>
    sqlite
      .prepare(
        `INSERT INTO jobs (id,user_id,type,ref_id,state,pct,stage_label,queued_overnight,error,started_at,finished_at,created_at)
         VALUES (?,?,'proxy','s1','failed',0,NULL,0,'Could not make an editing copy.',?,?,?)`,
      )
      .run(`j-fail-${i}-${ms}`, USER, ms, ms, ms);

  const open = () => proxyFirst(env, ctx, { ...SRC });

  return { sqlite, env, ctx, proxies, failedAt, open };
}

test("opening a video with no copy queues one attempt", async () => {
  const b = bench();
  await b.open();
  assert.equal(b.proxies(), 1);
});

test("a copy that already exists queues nothing, however many times you open it", async () => {
  const b = bench();
  for (let i = 0; i < 5; i += 1) {
    await proxyFirst(b.env, b.ctx, { ...SRC, proxy_r2_key: "u/u1/sources/s1/proxy.mp4" });
  }
  assert.equal(b.proxies(), 0);
});

test("a queued or running attempt is not duplicated", async () => {
  for (const state of ["queued", "running"]) {
    const b = bench();
    b.sqlite
      .prepare(
        `INSERT INTO jobs (id,user_id,type,ref_id,state,pct,stage_label,queued_overnight,error,started_at,finished_at,created_at)
         VALUES ('j1',?,'proxy','s1',?,0,NULL,0,NULL,NULL,NULL,?)`,
      )
      .run(USER, state, Date.now());
    await b.open();
    assert.equal(b.proxies(), 1, `${state} should not be joined by a second attempt`);
  }
});

test("A FAILED ATTEMPT IS NOT RETRIED ON THE NEXT PAGE VIEW", async () => {
  /* The defect itself. Ten views of a video that has just failed once used
     to make ten more jobs; it must now make none. */
  const b = bench();
  b.failedAt(Date.now());
  for (let i = 0; i < 10; i += 1) await b.open();
  assert.equal(b.proxies(), 1, "the storm is back");
});

test("but it is retried once the backoff has passed", async () => {
  const b = bench();
  b.failedAt(Date.now() - PROXY_RETRY_AFTER_MS - 1_000);
  await b.open();
  assert.equal(b.proxies(), 2);
});

test("and it stops for good at the ceiling, however long you wait", async () => {
  const b = bench();
  const old = Date.now() - PROXY_RETRY_AFTER_MS * 10;
  for (let i = 0; i < PROXY_ATTEMPTS; i += 1) b.failedAt(old + i, i);
  assert.equal(b.proxies(), PROXY_ATTEMPTS);

  /* A year of page views. Nothing more is attempted. */
  for (let i = 0; i < 20; i += 1) await b.open();
  assert.equal(b.proxies(), PROXY_ATTEMPTS, "the ceiling does not hold");
});

test("a stale attempt with no finish time does not reset the backoff", async () => {
  /*
   * reapStaleJobs can mark a job failed without ever setting finished_at.
   * Reading that as "no time at all" makes the backoff fire immediately,
   * which is the original bug wearing a different hat.
   */
  const b = bench();
  b.sqlite
    .prepare(
      `INSERT INTO jobs (id,user_id,type,ref_id,state,pct,stage_label,queued_overnight,error,started_at,finished_at,created_at)
       VALUES ('j-stale',?,'proxy','s1','failed',0,NULL,0,'reaped',NULL,NULL,?)`,
    )
    .run(USER, Date.now());
  for (let i = 0; i < 5; i += 1) await b.open();
  assert.equal(b.proxies(), 1);
});

test("an edit's own output is never given a copy of its own", async () => {
  const b = bench();
  await proxyFirst(b.env, b.ctx, { ...SRC, r2_key: "u/u1/renders/r1.edit.mp4" });
  assert.equal(b.proxies(), 0);
});

test("three attempts, an hour apart — the numbers are deliberate", () => {
  /* Pinned so a change to either is a change somebody made on purpose. */
  assert.equal(PROXY_ATTEMPTS, 3);
  assert.equal(PROXY_RETRY_AFTER_MS, 60 * 60 * 1000);
});
