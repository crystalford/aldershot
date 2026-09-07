/**
 * The six videos that were already broken when the fix landed.
 *
 * A bulk upload of twenty failed six on the container ceiling, each left
 * permanently failed behind a Retry button. Rethrowing so the queue retries
 * helps the NEXT upload and does nothing for those six — a rule is only worth
 * having if it also reaches the rows written before it.
 *
 * The dangerous mistakes here are all in one direction: putting work back
 * that should stay dead. A video whose file is gone, a video that failed for
 * a real reason, or a video going round for ever hiding a genuine problem
 * behind a spinner.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { requeueTransientReads } from "../src/ingest.ts";

const BUSY =
  "Couldn't read that video: Failed to start container: Maximum number of running container instances exceeded. Try again later.";

function world(rows: Array<{ id: string; state: string; reason: string | null; fails: number; file?: boolean }>) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE sources (id TEXT PRIMARY KEY, user_id TEXT, r2_key TEXT, brief TEXT,
             duration_s INTEGER, transcript_state TEXT, deleted_at INTEGER, created_at INTEGER)`);
  db.exec(`CREATE TABLE v2_users (id TEXT PRIMARY KEY, plan TEXT)`);
  db.exec(`CREATE TABLE jobs (id TEXT PRIMARY KEY, user_id TEXT, type TEXT, ref_id TEXT,
             state TEXT, pct INTEGER, stage_label TEXT, queued_overnight INTEGER,
             error TEXT, started_at INTEGER, finished_at INTEGER, created_at INTEGER)`);
  db.prepare(`INSERT INTO v2_users VALUES ('u1','studio')`).run();

  const held = new Set<string>();
  rows.forEach((r, i) => {
    db.prepare(`INSERT INTO sources VALUES (?,?,?,?,?,?,NULL,?)`)
      .run(r.id, "u1", "k/" + r.id + ".mp4", null, 120, r.state, i);
    if (r.file !== false) held.add("k/" + r.id + ".mp4");
    for (let n = 0; n < r.fails; n++) {
      db.prepare(`INSERT INTO jobs VALUES (?,?,?,?,?,0,NULL,0,?,NULL,NULL,?)`)
        .run(r.id + "-j" + n, "u1", "transcribe", r.id, "failed", r.reason, n);
    }
  });

  const sent: unknown[] = [];
  const env = {
    DB: {
      prepare(sql: string) {
        const stmt = db.prepare(sql);
        let args: unknown[] = [];
        const api = {
          bind(...a: unknown[]) { args = a; return api; },
          async all<T>() { return { results: stmt.all(...(args as never[])) as T[] }; },
          async first<T>() { return (stmt.get(...(args as never[])) ?? null) as T | null; },
          async run() { stmt.run(...(args as never[])); return { success: true }; },
        };
        return api;
      },
    },
    MEDIA: { async head(k: string) { return held.has(k) ? { size: 1 } : null; } },
    JOBS: { async send(m: unknown) { sent.push(m); } },
  };
  return { db, env: env as never, sent, state: (id: string) =>
    (db.prepare(`SELECT transcript_state FROM sources WHERE id=?`).get(id) as { transcript_state: string }).transcript_state };
}

const ctx = { waitUntil() {} };

test("a video that failed because the machine was busy goes back in", async () => {
  const w = world([{ id: "s1", state: "failed", reason: BUSY, fails: 1 }]);
  assert.equal(await requeueTransientReads(w.env, ctx), 1);
  assert.equal(w.state("s1"), "pending", "it was not put back to pending");
  assert.equal(w.sent.length, 1);
  assert.equal((w.sent[0] as { type: string }).type, "transcribe");
});

test("the message carries the plan, because the cap is checked when it runs", async () => {
  const w = world([{ id: "s1", state: "failed", reason: BUSY, fails: 1 }]);
  await requeueTransientReads(w.env, ctx);
  const msg = w.sent[0] as { userId: string; plan: string; knownDurationS?: number };
  assert.equal(msg.userId, "u1");
  assert.equal(msg.plan, "studio");
  assert.equal(msg.knownDurationS, 120, "it would estimate the length from file size again");
});

test("a video that failed for a real reason stays failed", async () => {
  const w = world([{ id: "s1", state: "failed", reason: "the extractor produced no audio", fails: 1 }]);
  assert.equal(await requeueTransientReads(w.env, ctx), 0);
  assert.equal(w.state("s1"), "failed");
  assert.deepEqual(w.sent, []);
});

test("a video whose file is gone is not queued to read nothing", async () => {
  const w = world([{ id: "s1", state: "failed", reason: BUSY, fails: 1, file: false }]);
  assert.equal(await requeueTransientReads(w.env, ctx), 0);
  assert.equal(w.state("s1"), "failed");
});

test("four goes is not bad luck any more", async () => {
  /* Going round for ever would hide a real problem behind a spinner. */
  const w = world([{ id: "s1", state: "failed", reason: BUSY, fails: 4 }]);
  assert.equal(await requeueTransientReads(w.env, ctx), 0);
  assert.equal(w.state("s1"), "failed");
});

test("a video that is fine is left completely alone", async () => {
  const w = world([{ id: "s1", state: "ready", reason: null, fails: 0 }]);
  assert.equal(await requeueTransientReads(w.env, ctx), 0);
  assert.equal(w.state("s1"), "ready");
});

test("six at once, which is what actually happened", async () => {
  const rows = Array.from({ length: 6 }, (_, i) => ({ id: "s" + i, state: "failed", reason: BUSY, fails: 1 }));
  const w = world(rows);
  assert.equal(await requeueTransientReads(w.env, ctx), 6);
  assert.equal(w.sent.length, 6);
});

test("it is bounded, so a big backlog is worked through rather than dumped", async () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ id: "s" + i, state: "failed", reason: BUSY, fails: 1 }));
  const w = world(rows);
  assert.equal(await requeueTransientReads(w.env, ctx, 10), 10);
});
