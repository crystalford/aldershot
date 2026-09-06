/**
 * The storage cap.
 *
 * It existed only as a number on a meter. Nothing enforced it: the product's
 * one refusal, checkCap, counts processing MINUTES and runs at transcribe
 * time — after the upload has landed — so it refused the cheap thing (about
 * $0.19/month of AI at the free cap) and permitted the expensive one. A
 * refused upload was still billed storage forever.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { fakeD1, schema } from "./helpers/fake-d1.ts";
import { checkStorage, storedBytes } from "../src/storage.ts";
import { PLANS } from "../src/plans.ts";

const GB = 1e9;
const ME = "USER_ME";

function world() {
  const sqlite = new DatabaseSync(":memory:");
  schema(sqlite);
  sqlite.exec(`INSERT INTO v2_users (id,email,plan,is_owner,created_at) VALUES ('${ME}','me@x.com','free',0,1)`);
  return { sqlite, db: fakeD1(sqlite) };
}

/** A stored video of a given size. This is what storage now counts. */
const video = (sqlite: DatabaseSync, id: string, user: string, bytes: number, deletedAt: number | null = null) =>
  sqlite.exec(
    `INSERT INTO sources (id,user_id,title,r2_key,bytes,created_at,deleted_at)
     VALUES ('${id}','${user}','v','k/${id}',${bytes},1,${deletedAt ?? "NULL"})`,
  );

test("an empty account may upload", async () => {
  const w = world();
  const out = await checkStorage(w.db as never, ME, "free", 2 * GB);
  assert.equal(out.ok, true);
});

test("storage counts the videos that exist, whenever they arrived", async () => {
  /* This summed usage_events for the current month, which is right for
     processing minutes and wrong for bytes: a video uploaded in March still
     occupies a disk in April. */
  const w = world();
  video(w.sqlite, "OLD", ME, 20 * GB);
  video(w.sqlite, "NEW", ME, 1 * GB);

  assert.equal(await storedBytes(w.db as never, ME), 21 * GB);
});

test("a video that was never read still counts", async () => {
  /* The old measure came from ingest, which runs AFTER a read. So an upload
     that finished but had not been read counted as nothing — and one whose
     read failed counted as nothing for ever, while its bytes sat in R2. */
  const w = world();
  w.sqlite.exec(
    `INSERT INTO sources (id,user_id,title,r2_key,bytes,transcript_state,created_at)
     VALUES ('S1','${ME}','unread','k',${9 * GB},'failed',1)`,
  );
  assert.equal(await storedBytes(w.db as never, ME), 9 * GB);
});

test("a soft-deleted video still counts, a purged one does not", async () => {
  /* Deleting is reversible and leaves the object in R2, so it is still taking
     up room. Only purging removes the row and the bytes together — which is
     what makes "Delete for good" the button that moves this number. */
  const w = world();
  video(w.sqlite, "SOFT", ME, 4 * GB, 99);
  assert.equal(await storedBytes(w.db as never, ME), 4 * GB);

  w.sqlite.exec("DELETE FROM sources WHERE id='SOFT'");
  assert.equal(await storedBytes(w.db as never, ME), 0);
});

test("a finished render counts too", async () => {
  const w = world();
  w.sqlite.exec(
    `INSERT INTO renders (id,user_id,kind,format,aspect,bytes,state,created_at)
     VALUES ('R1','${ME}','cut','mp4_1080','16:9',${2 * GB},'ready',1),
            ('R2','${ME}','cut','mp4_1080','16:9',${5 * GB},'failed',1)`,
  );
  assert.equal(await storedBytes(w.db as never, ME), 2 * GB, "a failed render produced no file");
});

test("an upload that would cross the cap is refused, and says the number", async () => {
  const w = world();
  video(w.sqlite, "A", ME, 24 * GB);

  const out = await checkStorage(w.db as never, ME, "free", 5 * GB);
  assert.equal(out.ok, false);
  assert.match(out.message ?? "", new RegExp(String(PLANS.free.label)));
  assert.match(out.message ?? "", /GB/);
});

test("an upload that exactly fits is allowed", async () => {
  const w = world();
  video(w.sqlite, "A", ME, 20 * GB);
  const out = await checkStorage(w.db as never, ME, "free", 5 * GB);
  assert.equal(out.ok, true, "25GB into a 25GB cap is inside it, not over");
});

test("an in-flight upload counts before it has been read", async () => {
  /* Only ingest meters bytes_stored, and it runs after transcription. Without
     counting pending uploads you could stay under the cap forever simply by
     never letting anything be read. */
  const w = world();
  w.sqlite.exec(`
    INSERT INTO sources (id,user_id,title,r2_key,created_at) VALUES ('S1','${ME}','big','k',1);
    INSERT INTO uploads (source_id,user_id,upload_id,part_size,total_bytes,filename,mode,created_at)
      VALUES ('S1','${ME}','u1',8388608,${24 * GB},'big.mp4','direct',1);
  `);

  assert.equal(await storedBytes(w.db as never, ME), 24 * GB);
  assert.equal((await checkStorage(w.db as never, ME, "free", 5 * GB)).ok, false);
});

test("a deleted source's in-flight bytes stop counting", async () => {
  const w = world();
  w.sqlite.exec(`
    INSERT INTO sources (id,user_id,title,r2_key,created_at,deleted_at) VALUES ('S1','${ME}','gone','k',1,99);
    INSERT INTO uploads (source_id,user_id,upload_id,part_size,total_bytes,filename,mode,created_at)
      VALUES ('S1','${ME}','u1',8388608,${24 * GB},'gone.mp4','direct',1);
  `);
  assert.equal(await storedBytes(w.db as never, ME), 0);
});

test("Studio has more room than Free, from PLANS rather than a number here", async () => {
  const w = world();
  video(w.sqlite, "A", ME, 30 * GB);

  assert.equal((await checkStorage(w.db as never, ME, "free", 1 * GB)).ok, false);
  assert.equal((await checkStorage(w.db as never, ME, "studio", 1 * GB)).ok, true);
  assert.ok(PLANS.studio.storageGb > PLANS.free.storageGb);
});

test("another account's storage is not counted against yours", async () => {
  const w = world();
  video(w.sqlite, "THEIRS", "USER_THEM", 100 * GB);
  assert.equal(await storedBytes(w.db as never, ME), 0);
});
