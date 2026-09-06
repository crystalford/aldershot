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

const meter = (sqlite: DatabaseSync, id: string, user: string, bytes: number, createdAt: number) =>
  sqlite.exec(
    `INSERT INTO usage_events (id,user_id,job_type,bytes_stored,unit_prices,cost_usd,created_at)
     VALUES ('${id}','${user}','transcribe',${bytes},'{}',0,${createdAt})`,
  );

test("an empty account may upload", async () => {
  const w = world();
  const out = await checkStorage(w.db as never, ME, "free", 2 * GB);
  assert.equal(out.ok, true);
});

test("storage is counted for all time, not this month", async () => {
  /* Settings summed the current month, which is right for processing minutes
     and wrong for bytes: a video uploaded in March still occupies a disk in
     April. That meter reset an account near its limit to nearly empty every
     1st, and a cap built on it would have done the same. */
  const w = world();
  meter(w.sqlite, "OLD", ME, 20 * GB, 1);
  meter(w.sqlite, "NEW", ME, 1 * GB, Date.now());

  assert.equal(await storedBytes(w.db as never, ME), 21 * GB);
});

test("an upload that would cross the cap is refused, and says the number", async () => {
  const w = world();
  meter(w.sqlite, "A", ME, 24 * GB, 1);

  const out = await checkStorage(w.db as never, ME, "free", 5 * GB);
  assert.equal(out.ok, false);
  assert.match(out.message ?? "", new RegExp(String(PLANS.free.label)));
  assert.match(out.message ?? "", /GB/);
});

test("an upload that exactly fits is allowed", async () => {
  const w = world();
  meter(w.sqlite, "A", ME, 20 * GB, 1);
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
  meter(w.sqlite, "A", ME, 30 * GB, 1);

  assert.equal((await checkStorage(w.db as never, ME, "free", 1 * GB)).ok, false);
  assert.equal((await checkStorage(w.db as never, ME, "studio", 1 * GB)).ok, true);
  assert.ok(PLANS.studio.storageGb > PLANS.free.storageGb);
});

test("another account's storage is not counted against yours", async () => {
  const w = world();
  meter(w.sqlite, "THEIRS", "USER_THEM", 100 * GB, 1);
  assert.equal(await storedBytes(w.db as never, ME), 0);
});
