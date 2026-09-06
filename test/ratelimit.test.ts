/**
 * Rate limiting.
 *
 * There was none anywhere. The sharpest edge is /auth/start: it takes an
 * address, writes a token and sends an email, and nothing stopped anyone
 * calling it in a loop — someone else's inbox full of our links, our Resend
 * bill spent on it, and our sending reputation with it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { fakeD1, schema } from "./helpers/fake-d1.ts";
import { LIMITS, rateLimit, reapRateLimits } from "../src/ratelimit.ts";

function world() {
  const sqlite = new DatabaseSync(":memory:");
  schema(sqlite);
  sqlite.exec(`CREATE TABLE rate_limits (k TEXT NOT NULL, window_start INTEGER NOT NULL,
    hits INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (k, window_start))`);
  return { sqlite, db: fakeD1(sqlite) };
}

const NOW = 1_800_000_000_000;

test("lets a real person through and stops a loop", async () => {
  const w = world();
  const limit = { max: 3, windowS: 300 };

  for (let i = 1; i <= 3; i++) {
    const r = await rateLimit(w.db as never, "auth:me@x.com", limit, NOW);
    assert.equal(r.ok, true, `attempt ${i} should be allowed`);
  }
  const over = await rateLimit(w.db as never, "auth:me@x.com", limit, NOW);
  assert.equal(over.ok, false);
  assert.ok(over.retryAfterS > 0, "a refusal has to say when to come back");
});

test("one address being limited does not limit another", async () => {
  /* The counter is keyed on who is being targeted. Getting this wrong would
     mean one attacker locking every other user out of signing in. */
  const w = world();
  const limit = { max: 1, windowS: 300 };
  await rateLimit(w.db as never, "auth:a@x.com", limit, NOW);
  await rateLimit(w.db as never, "auth:a@x.com", limit, NOW);

  const other = await rateLimit(w.db as never, "auth:b@x.com", limit, NOW);
  assert.equal(other.ok, true);
});

test("the window resets", async () => {
  const w = world();
  const limit = { max: 2, windowS: 60 };
  await rateLimit(w.db as never, "k", limit, NOW);
  await rateLimit(w.db as never, "k", limit, NOW);
  assert.equal((await rateLimit(w.db as never, "k", limit, NOW)).ok, false);

  const later = NOW + 61_000;
  assert.equal((await rateLimit(w.db as never, "k", limit, later)).ok, true, "a new window is a clean slate");
});

test("retryAfter counts down within the window", async () => {
  const w = world();
  const limit = { max: 1, windowS: 100 };
  await rateLimit(w.db as never, "k", limit, NOW);

  const early = await rateLimit(w.db as never, "k", limit, NOW);
  const late = await rateLimit(w.db as never, "k", limit, NOW + 90_000);
  assert.ok(late.retryAfterS <= early.retryAfterS, "the wait shrinks as the window runs out");
});

test("old windows are dropped, current ones kept", async () => {
  const w = world();
  const limit = { max: 5, windowS: 60 };
  await rateLimit(w.db as never, "old", limit, NOW - 48 * 3600 * 1000);
  await rateLimit(w.db as never, "now", limit, NOW);

  await reapRateLimits(w.db as never, NOW);
  const rows = w.sqlite.prepare("SELECT k FROM rate_limits").all() as Array<{ k: string }>;
  assert.deepEqual(rows.map((r) => r.k), ["now"]);
});

test("the shipped limits are generous for a person and useless for a loop", () => {
  /* If these ever get tightened to the point of being hostile, this is where
     it should be argued about rather than discovered by a user. */
  assert.ok(LIMITS.authStart.max >= 3, "asking for a couple of links is normal");
  assert.ok(LIMITS.authStart.windowS <= 600, "and the wait should be minutes, not hours");
  assert.ok(LIMITS.upload.max >= 10, "a real editing session uploads several videos");
});
