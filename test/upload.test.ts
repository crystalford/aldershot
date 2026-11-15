/**
 * THE FIRST THING ANYBODY DOES, and it had no test.
 *
 * src/upload.ts is the path every account takes before anything else can
 * happen: a multipart upload to R2, in parts, resumable. Two things in it are
 * worth pinning and neither was.
 *
 * The part size, because getting it wrong is how the owner's own 2.14GB
 * upload stalled — a fixed 8MB made it 268 round trips nose to tail, and
 * every round trip is a chance to fail. The worked examples in the function's
 * own comment are the specification, so they are the test.
 *
 * And the ORDER of the parts, because R2 assembles them in the order it is
 * handed and parts do not arrive in order — a browser uploading six at a time
 * finishes them as the network allows. Hand them over unsorted and the file
 * is complete, the request succeeds, and the video is corrupt in the middle.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PART_SIZE, completeUpload, partSizeFor } from "../src/upload.ts";

const MB = 1024 * 1024;

test("the part size follows the table in its own comment", () => {
  /* 120MB → 8MB (15 parts) · 1GB → 16MB (64) · 2.1GB → 32MB (67) ·
     10GB → 64MB (157). Roughly a hundred parts, which is the point. */
  assert.equal(partSizeFor(120 * MB), 8 * MB);
  assert.equal(partSizeFor(1024 * MB), 16 * MB);
  assert.equal(partSizeFor(2.1 * 1024 * MB), 32 * MB);
  assert.equal(partSizeFor(10 * 1024 * MB), 64 * MB);
});

test("it never goes under R2's floor or over its ceiling", () => {
  /*
   * R2 requires every part but the last to be at least 5MB, and allows
   * 10,000 of them. 8MB is the floor here and 64MB the cap — which still
   * supports a 640GB source, so the cap costs nothing real and bounds how
   * much a failed part has to re-send.
   */
  assert.equal(partSizeFor(1), 8 * MB, "a tiny file still uses the floor");
  assert.equal(partSizeFor(1000 * 1024 * MB), 64 * MB, "a terabyte is still capped");
  for (const bytes of [1, 5 * MB, 100 * MB, 50 * 1024 * MB]) {
    const size = partSizeFor(bytes);
    assert.ok(size >= 8 * MB && size <= 64 * MB, `${bytes} → ${size}`);
  }
});

test("a size it cannot believe falls back rather than producing nonsense", () => {
  /* undefined is the honest case — the browser did not say. The rest are
     what arrives when something upstream went wrong, and a part size of 0 or
     NaN would be an upload that never completes. */
  for (const bad of [undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(partSizeFor(bad as number), PART_SIZE, `${String(bad)} falls back`);
  }
});

test("parts are assembled in order, however they arrived", async () => {
  /*
   * THE ONE THAT CORRUPTS A FILE SILENTLY.
   *
   * A browser uploads several parts at once and they finish as the network
   * allows, so the list reaching this is in completion order. R2 assembles
   * what it is handed, in the order it is handed: unsorted, the request
   * succeeds, the object exists, and the video is scrambled in the middle.
   */
  let seen: number[] = [];
  const bucket = {
    resumeMultipartUpload: () => ({
      complete: async (parts: Array<{ partNumber: number }>) => {
        seen = parts.map((p) => p.partNumber);
        return {} as never;
      },
    }),
  } as never;

  await completeUpload(bucket, "k", "u", [
    { partNumber: 3, etag: "c" },
    { partNumber: 1, etag: "a" },
    { partNumber: 4, etag: "d" },
    { partNumber: 2, etag: "b" },
  ]);
  assert.deepEqual(seen, [1, 2, 3, 4]);
});

test("sorting does not mutate the caller's list", () => {
  /* The caller's array is the record of what was uploaded; reordering it
     underneath them is the kind of thing that only shows up on a retry. */
  const parts = [
    { partNumber: 2, etag: "b" },
    { partNumber: 1, etag: "a" },
  ];
  const bucket = {
    resumeMultipartUpload: () => ({ complete: async () => ({}) as never }),
  } as never;
  void completeUpload(bucket, "k", "u", parts);
  assert.deepEqual(
    parts.map((p) => p.partNumber),
    [2, 1],
  );
});
