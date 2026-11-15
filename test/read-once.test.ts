/**
 * FOOTAGE IS READ AND CHARGED ONCE (invariant 5).
 *
 * POST /api/sources/:id/retry was documented as "Re-read a source that failed"
 * and checked only that the source existed. So a video that had already been
 * read could be read again — and a read is the expensive operation in this
 * product, priced per source minute — while two presses ran two reads at once.
 *
 * It was safe only because src/ui/pages/source.ts renders the Retry form when
 * the state is "failed" and never otherwise. That is the UI being the guard,
 * which is the same mistake that put 9,695 proxy jobs in one database.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { reReadRefusedBecause } from "../src/jobs.ts";
import { fakeD1, schema } from "./helpers/fake-d1.ts";

const db = (jobs: Array<{ state: string; type?: string }> = []) => {
  const d = new DatabaseSync(":memory:");
  schema(d);
  jobs.forEach((j, i) =>
    d.exec(
      `INSERT INTO jobs (id, user_id, type, ref_id, state, created_at)
       VALUES ('j${i}', 'u1', '${j.type ?? "transcribe"}', 's1', '${j.state}', ${1000 + i})`,
    ),
  );
  return fakeD1(d) as never;
};

test("a failed read may be retried", async () => {
  assert.equal(await reReadRefusedBecause(db([{ state: "failed" }]), { id: "s1", transcript_state: "failed" }, "u1"), null);
});

test("a source already read is not read again", async () => {
  assert.equal(
    await reReadRefusedBecause(db(), { id: "s1", transcript_state: "ready" }, "u1"),
    "already read",
  );
});

test("a read already in flight is not started twice", async () => {
  for (const state of ["queued", "running"]) {
    assert.equal(
      await reReadRefusedBecause(db([{ state }]), { id: "s1", transcript_state: "failed" }, "u1"),
      "a read is already running",
      `a ${state} read did not stop a second one`,
    );
  }
});

/*
 * ANOTHER KIND OF JOB RUNNING IS NOT A READ RUNNING.
 *
 * Several kinds of work hang off one source id, and latestJobFor takes the
 * type list for exactly this reason. A proxy being made must not block a retry
 * of a read that failed, or a video whose editing copy is slow becomes a video
 * you cannot retry.
 */
test("a proxy in flight does not block a read", async () => {
  assert.equal(
    await reReadRefusedBecause(db([{ state: "running", type: "proxy" }]), { id: "s1", transcript_state: "failed" }, "u1"),
    null,
  );
});

test("a finished read does not block a retry of a later failure", async () => {
  /* done, then failed: the newest is what counts, and it failed. */
  assert.equal(
    await reReadRefusedBecause(
      db([{ state: "done" }, { state: "failed" }]),
      { id: "s1", transcript_state: "failed" },
      "u1",
    ),
    null,
  );
});

test("a source with no state yet is readable", async () => {
  assert.equal(await reReadRefusedBecause(db(), { id: "s1" }, "u1"), null);
});
