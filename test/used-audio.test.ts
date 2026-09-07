/**
 * Extracted audio is rubbish once the transcript is written.
 *
 * It exists for one reason — handing the speech model 14MB instead of a
 * multi-gigabyte 4K file — and nothing ever deleted it. Every video read left
 * an MP3 in R2 for the life of the source, roughly 14MB per hour of footage,
 * and storedBytes counts sources, renders and pending uploads but not this,
 * so the storage the product reports has been short by exactly that amount on
 * every account since the day it shipped.
 *
 * What must not happen: reaping the audio of a video still being read, which
 * would pull the file out from under the transcriber mid-job.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { audioKeyFor, reapUsedAudio } from "../src/audio.ts";

function d1(db: DatabaseSync): never {
  return {
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
  } as never;
}

/** An R2 stand-in that records what was asked for and what was removed. */
function bucket(present: string[]) {
  const held = new Set(present);
  const deleted: string[] = [];
  return {
    deleted,
    held,
    api: {
      async head(k: string) { return held.has(k) ? { size: 14_000_000 } : null; },
      async delete(k: string) { held.delete(k); deleted.push(k); },
    } as never,
  };
}

function world(rows: Array<{ id: string; key: string; state: string; deleted?: number }>) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE sources (id TEXT PRIMARY KEY, r2_key TEXT, transcript_state TEXT,
             deleted_at INTEGER, created_at INTEGER)`);
  const ins = db.prepare(`INSERT INTO sources VALUES (?,?,?,?,?)`);
  rows.forEach((r, i) => ins.run(r.id, r.key, r.state, r.deleted ?? null, i));
  return db;
}

test("audio belonging to a finished transcript is freed", async () => {
  const db = world([{ id: "s1", key: "u/1/sources/s1/original.mp4", state: "ready" }]);
  const b = bucket([audioKeyFor("u/1/sources/s1/original.mp4")]);
  const freed = await reapUsedAudio(d1(db), b.api, 50);
  assert.equal(b.deleted.length, 1);
  assert.equal(freed, 14_000_000);
});

test("the original is never touched — only the derived audio", async () => {
  const key = "u/1/sources/s1/original.mp4";
  const db = world([{ id: "s1", key, state: "ready" }]);
  const b = bucket([key, audioKeyFor(key)]);
  await reapUsedAudio(d1(db), b.api, 50);
  assert.deepEqual(b.deleted, [audioKeyFor(key)]);
  assert.ok(b.held.has(key), "it deleted the footage itself");
});

test("a video still being read keeps its audio", async () => {
  /* Pulling the file out from under a running transcribe is the one way this
     could do damage. */
  const db = world([
    { id: "s1", key: "u/1/a.mp4", state: "running" },
    { id: "s2", key: "u/1/b.mp4", state: "pending" },
    { id: "s3", key: "u/1/c.mp4", state: "failed" },
  ]);
  const b = bucket(["u/1/a.audio.mp3", "u/1/b.audio.mp3", "u/1/c.audio.mp3"]);
  assert.equal(await reapUsedAudio(d1(db), b.api, 50), 0);
  assert.deepEqual(b.deleted, []);
});

test("a deleted source is left to the purge, not half-handled here", async () => {
  const db = world([{ id: "s1", key: "u/1/a.mp4", state: "ready", deleted: 123 }]);
  const b = bucket(["u/1/a.audio.mp3"]);
  await reapUsedAudio(d1(db), b.api, 50);
  assert.deepEqual(b.deleted, []);
});

test("running it again costs nothing and breaks nothing", async () => {
  /* It keeps no record of what it has done, so it has to be safe repeated. */
  const db = world([{ id: "s1", key: "u/1/a.mp4", state: "ready" }]);
  const b = bucket(["u/1/a.audio.mp3"]);
  await reapUsedAudio(d1(db), b.api, 50);
  const again = await reapUsedAudio(d1(db), b.api, 50);
  assert.equal(again, 0);
  assert.equal(b.deleted.length, 1);
});

test("it is bounded, so one sweep cannot become a thousand round trips", async () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({ id: "s" + i, key: "u/1/v" + i + ".mp4", state: "ready" }));
  const db = world(rows);
  const b = bucket(rows.map((r) => audioKeyFor(r.key)));
  await reapUsedAudio(d1(db), b.api, 10);
  assert.equal(b.deleted.length, 10);
});
