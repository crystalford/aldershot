/**
 * The owner is metered and never blocked.
 *
 * upsertUser puts the owner on Studio with the comment "so caps never block
 * their own testing" — but Studio's cap is a number like any other, and a
 * 2,674-minute upload duly hit it: "you have 1187 minutes left this month on
 * Studio. Add minutes or upgrade to keep going." Being unable to use your own
 * product is not a plan tier.
 *
 * The other half matters just as much: usage is still counted. What the owner
 * actually consumes is the only real evidence of what a plan should cost.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { checkCap } from "../src/plans.ts";
import { checkStorage } from "../src/storage.ts";

function d1(db: DatabaseSync): never {
  return {
    prepare(sql: string) {
      const stmt = db.prepare(sql);
      let args: unknown[] = [];
      const api = {
        bind(...a: unknown[]) { args = a; return api; },
        async first<T>() { return (stmt.get(...(args as never[])) ?? null) as T | null; },
        async all<T>() { return { results: stmt.all(...(args as never[])) as T[] }; },
        async run() { stmt.run(...(args as never[])); return { success: true }; },
      };
      return api;
    },
  } as never;
}

function db(isOwner: number, usedMinutes: number) {
  const d = new DatabaseSync(":memory:");
  d.exec(`CREATE TABLE v2_users (id TEXT PRIMARY KEY, email TEXT, is_owner INTEGER, plan TEXT)`);
  d.exec(`CREATE TABLE usage_events (id TEXT PRIMARY KEY, user_id TEXT, job_type TEXT,
            source_minutes REAL, bytes INTEGER, created_at INTEGER)`);
  d.exec(`CREATE TABLE sources (id TEXT, user_id TEXT, bytes INTEGER, deleted_at INTEGER)`);
  d.exec(`CREATE TABLE renders (user_id TEXT, bytes INTEGER, state TEXT)`);
  d.exec(`CREATE TABLE uploads (user_id TEXT, source_id TEXT, total_bytes INTEGER, state TEXT)`);
  /* A fixture address, not the owner's own: this file is public now, and the
     row that matters here is is_owner, never which address set it. */
  d.prepare(`INSERT INTO v2_users VALUES ('u1','owner@example.com',?, 'studio')`).run(isOwner);
  d.prepare(`INSERT INTO usage_events VALUES ('e1','u1','transcribe',?,0,?)`).run(usedMinutes, Date.now());
  return d;
}

test("a 2,674-minute upload is refused on a normal Studio account", () => {
  /* The behaviour the owner actually saw. It is right for a customer. */
  return checkCap(d1(db(0, 1000)), "u1", "studio", 2674).then((r) => {
    assert.equal(r.ok, false);
    assert.match(r.message ?? "", /left this month on Studio/);
  });
});

test("the same upload goes through on the owner's account", () => {
  return checkCap(d1(db(1, 1000)), "u1", "studio", 2674).then((r) => {
    assert.equal(r.ok, true);
    assert.equal(r.unlimited, true);
  });
});

test("and it is still counted, which is the point", () => {
  /* Uncapped must not mean unmeasured: what the owner consumes is the
     evidence for what a plan should cost. */
  return checkCap(d1(db(1, 1187)), "u1", "studio", 2674).then((r) => {
    assert.equal(r.used, 1187, "the owner's usage stopped being reported");
    assert.ok(r.cap > 0, "the plan's cap is still known, just not enforced");
  });
});

test("storage does not block the owner either", async () => {
  const big = 500 * 1024 * 1024 * 1024;
  assert.equal((await checkStorage(d1(db(1, 0)), "u1", "free", big)).ok, true);
  assert.equal((await checkStorage(d1(db(0, 0)), "u1", "free", big)).ok, false);
});
