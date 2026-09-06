/**
 * Delete, restore, purge, close.
 *
 * Every path in this product that removes a row or an R2 object lives in
 * src/library-ops.ts, and none of it had a test. These run the real functions
 * against real SQLite (test/helpers/fake-d1.ts), because what matters here is
 * not one statement but the order of the writes, what each refuses, and what
 * a cascade takes with it.
 *
 * Two accounts exist in every fixture. The assertion that the OTHER one is
 * untouched is the point of most of these: a delete that reaches across
 * accounts is the worst bug this file could have.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { fakeD1, fakeR2, schema } from "./helpers/fake-d1.ts";
import { closeAccount, purge, rename, restore, softDelete } from "../src/library-ops.ts";

const ME = "USER_ME";
const THEM = "USER_THEM";

function world() {
  const sqlite = new DatabaseSync(":memory:");
  schema(sqlite);
  const db = fakeD1(sqlite);

  const R2 = fakeR2({
    "u/USER_ME/sources/S1/original.mp4": 5_000_000,
    "u/USER_ME/sources/S1/original.audio.mp3": 200_000,
    "u/USER_ME/sources/S1/poster.jpg": 40_000,
    "u/USER_ME/renders/R1.mp4": 1_000_000,
    "u/USER_THEM/sources/S9/original.mp4": 9_999,
  });

  sqlite.exec(`
    INSERT INTO v2_users (id,email,plan,is_owner,created_at) VALUES
      ('${ME}','me@example.com','free',0,1), ('${THEM}','them@example.com','free',0,1);
    INSERT INTO sources (id,user_id,title,r2_key,poster_r2_key,created_at) VALUES
      ('S1','${ME}','my video','u/USER_ME/sources/S1/original.mp4','u/USER_ME/sources/S1/poster.jpg',1),
      ('S9','${THEM}','their video','u/USER_THEM/sources/S9/original.mp4',NULL,1);
    INSERT INTO v2_projects (id,user_id,title,kind,source_id,created_at,updated_at) VALUES
      ('P1','${ME}','edit one','cut','S1',1,1),
      ('P2','${ME}','edit two','cut','S1',1,1),
      ('P9','${THEM}','their edit','cut','S9',1,1);
    INSERT INTO renders (id,project_id,user_id,kind,format,aspect,r2_key,state,created_at)
      VALUES ('R1','P1','${ME}','cut','mp4_1080','16:9','u/USER_ME/renders/R1.mp4','ready',1);
    INSERT INTO segments (id,source_id,idx,start_ms,end_ms,text) VALUES ('SEG1','S1',0,0,1000,'hi');
    INSERT INTO jobs (id,user_id,type,ref_id,state,pct,queued_overnight,created_at)
      VALUES ('J1','${ME}','transcribe','S1','ready',100,0,1);
  `);

  const count = (sql: string) => Number((sqlite.prepare(sql).get() as { n: number }).n);
  return { sqlite, db, R2, env: { DB: db, MEDIA: R2 }, count };
}

/* ── rename ─────────────────────────────────────────────────────────── */

test("rename only touches your own row", async () => {
  const w = world();
  assert.equal(await rename(w.db as never, "project", "P9", ME, "stolen"), false);
  assert.equal(
    (w.sqlite.prepare("SELECT title FROM v2_projects WHERE id='P9'").get() as { title: string }).title,
    "their edit",
  );
});

/* ── delete and restore ─────────────────────────────────────────────── */

test("deleting a video takes its edits and restore brings them back together", async () => {
  const w = world();

  const del = await softDelete(w.db as never, "source", "S1", ME);
  assert.equal(del.ok, true);
  assert.equal(del.label, "my video");
  assert.equal(w.count("SELECT COUNT(*) n FROM sources WHERE deleted_at IS NULL AND user_id='" + ME + "'"), 0);
  assert.equal(
    w.count("SELECT COUNT(*) n FROM v2_projects WHERE deleted_at IS NULL AND user_id='" + ME + "'"),
    0,
    "an edit whose footage is gone cannot be opened, so it goes too",
  );

  await restore(w.db as never, "source", "S1", ME);
  assert.equal(w.count("SELECT COUNT(*) n FROM sources WHERE deleted_at IS NULL AND user_id='" + ME + "'"), 1);
  assert.equal(
    w.count("SELECT COUNT(*) n FROM v2_projects WHERE deleted_at IS NULL AND user_id='" + ME + "'"),
    2,
    "both edits come back, not just the video",
  );
});

/*
 * The cascade runs ONE WAY, and this is the property that makes the product
 * safe to use: footage is material, an edit is a thing made from it.
 *
 * The owner's question, in their words: "so that if i start an edit it is
 * just using the footage not editing that and making the source footage then
 * inaccessible". If deleting an edit could take the video with it, one
 * tidy-up would destroy the only copy of the original.
 */
test("deleting an edit never touches the footage or the other edits", async () => {
  const w = world();

  const del = await softDelete(w.db as never, "project", "P1", ME);
  assert.equal(del.ok, true);

  assert.equal(
    w.count("SELECT COUNT(*) n FROM sources WHERE deleted_at IS NULL AND user_id='" + ME + "'"),
    1,
    "the footage an edit was made from survives the edit",
  );
  assert.equal(
    w.count("SELECT COUNT(*) n FROM v2_projects WHERE deleted_at IS NULL AND user_id='" + ME + "'"),
    1,
    "the other edit of the same footage is untouched",
  );
});

test("a delete never reaches another account", async () => {
  const w = world();
  const del = await softDelete(w.db as never, "source", "S9", ME);
  assert.equal(del.ok, false);
  assert.equal(w.count("SELECT COUNT(*) n FROM sources WHERE id='S9' AND deleted_at IS NULL"), 1);
});

test("restoring twice is harmless", async () => {
  /* The undo button is one click from being pressed again. */
  const w = world();
  await softDelete(w.db as never, "project", "P1", ME);
  await restore(w.db as never, "project", "P1", ME);
  await restore(w.db as never, "project", "P1", ME);
  assert.equal(w.count("SELECT COUNT(*) n FROM v2_projects WHERE id='P1' AND deleted_at IS NULL"), 1);
});

/* ── purge ──────────────────────────────────────────────────────────── */

test("purge refuses anything not already in the bin", async () => {
  /* Two decisions, not one: purging a live row would turn a stray request into
     data loss with no undo behind it. */
  const w = world();
  const out = await purge(w.env as never, "source", "S1", ME);
  assert.equal(out.ok, false);
  assert.equal(w.count("SELECT COUNT(*) n FROM sources WHERE id='S1'"), 1);
  assert.ok(w.R2.objects.has("u/USER_ME/sources/S1/original.mp4"), "the bytes stay");
});

test("purge frees the video, its audio, its poster and its renders", async () => {
  const w = world();
  await softDelete(w.env.DB as never, "source", "S1", ME);

  const out = await purge(w.env as never, "source", "S1", ME);
  assert.equal(out.ok, true);
  assert.equal(out.freedBytes, 5_000_000 + 200_000 + 40_000 + 1_000_000);

  for (const key of [
    "u/USER_ME/sources/S1/original.mp4",
    "u/USER_ME/sources/S1/original.audio.mp3",
    "u/USER_ME/sources/S1/poster.jpg",
    "u/USER_ME/renders/R1.mp4",
  ]) {
    assert.equal(w.R2.objects.has(key), false, `${key} should be gone`);
  }
  assert.equal(w.count("SELECT COUNT(*) n FROM sources WHERE id='S1'"), 0);
  assert.equal(w.count("SELECT COUNT(*) n FROM trash WHERE entity_id='S1'"), 0);

  assert.ok(w.R2.objects.has("u/USER_THEM/sources/S9/original.mp4"), "the other account keeps its bytes");
});

test("purge cannot be aimed at another account", async () => {
  const w = world();
  await softDelete(w.db as never, "source", "S9", THEM);
  const out = await purge(w.env as never, "source", "S9", ME);
  assert.equal(out.ok, false);
  assert.ok(w.R2.objects.has("u/USER_THEM/sources/S9/original.mp4"));
});

/* ── closing an account ─────────────────────────────────────────────── */

test("closing refuses a mismatched address and changes nothing", async () => {
  const w = world();
  const out = await closeAccount(w.env as never, ME, "someone.else@example.com");
  assert.equal(out.ok, false);
  assert.match(out.error ?? "", /not the address/i);
  assert.equal(w.count("SELECT COUNT(*) n FROM v2_users WHERE id='" + ME + "'"), 1);
  assert.equal(w.count("SELECT COUNT(*) n FROM sources WHERE user_id='" + ME + "'"), 1);
});

test("the address check ignores case and surrounding space", async () => {
  const w = world();
  const out = await closeAccount(w.env as never, ME, "  ME@Example.com ");
  assert.equal(out.ok, true, "a real person typing their own address should not be refused on case");
});

test("closing takes everything, and only this account's", async () => {
  const w = world();
  const out = await closeAccount(w.env as never, ME, "me@example.com");
  assert.equal(out.ok, true);

  for (const table of ["v2_users", "sources", "v2_projects", "jobs"]) {
    const col = table === "v2_users" ? "id" : "user_id";
    assert.equal(w.count(`SELECT COUNT(*) n FROM ${table} WHERE ${col}='${ME}'`), 0, `${table} should be empty`);
  }
  assert.equal(w.count("SELECT COUNT(*) n FROM segments WHERE source_id='S1'"), 0);
  assert.equal(w.count("SELECT COUNT(*) n FROM renders WHERE user_id='" + ME + "'"), 0);

  assert.equal(w.R2.objects.has("u/USER_ME/sources/S1/original.mp4"), false);
  assert.equal(w.R2.objects.has("u/USER_ME/renders/R1.mp4"), false);

  assert.equal(w.count("SELECT COUNT(*) n FROM v2_users WHERE id='" + THEM + "'"), 1, "the other account survives");
  assert.equal(w.count("SELECT COUNT(*) n FROM sources WHERE user_id='" + THEM + "'"), 1);
  assert.ok(w.R2.objects.has("u/USER_THEM/sources/S9/original.mp4"));
});
