/**
 * The MP3 parser decides where audio gets cut. A wrong cut means noise at the
 * seam and, worse, a wrong start time — which silently shifts every timestamp
 * after it. So it is checked against real encoder output, not a fixture I made
 * up to match the code.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { durationMs, parseFrames, splitMp3 } from "../src/mp3.ts";

const FIXTURES = "/tmp/fixtures";
const has = (f: string) => existsSync(`${FIXTURES}/${f}`);
const load = (f: string) => new Uint8Array(readFileSync(`${FIXTURES}/${f}`));

test("measures a real file's duration accurately", { skip: !has("len-15.mp3") }, () => {
  const ms = durationMs(load("len-15.mp3"));
  const expected = 15 * 60 * 1000;
  // Encoders add priming and padding frames, so the frame content of a
  // "15 minute" file runs a few frames long — measured at +108ms here, which
  // is 0.012%. What matters is that the figure comes from the frames
  // themselves rather than from a bitrate guess, so it stays exact as chunks
  // are cut. Half a second of tolerance covers encoder padding without
  // tolerating an actual parsing error.
  assert.ok(Math.abs(ms - expected) < 500, `got ${ms}ms, expected about ${expected}ms`);
  assert.ok(ms >= expected, "frame content should not be shorter than the requested duration");
});

test("every frame is contiguous — no gaps, no overlaps", { skip: !has("len-1.mp3") }, () => {
  const frames = parseFrames(load("len-1.mp3"));
  assert.ok(frames.length > 100);
  for (let i = 1; i < frames.length; i++) {
    assert.equal(frames[i].offset, frames[i - 1].offset + frames[i - 1].length);
  }
});

test("short audio comes back as one chunk, not an empty split", { skip: !has("len-1.mp3") }, () => {
  const chunks = splitMp3(load("len-1.mp3"), { chunkMs: 2 * 3600_000, overlapMs: 5000 });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].startMs, 0);
});

test("chunks cover the whole file with the intended overlap", { skip: !has("len-15.mp3") }, () => {
  const bytes = load("len-15.mp3");
  const total = durationMs(bytes);
  const chunks = splitMp3(bytes, { chunkMs: 5 * 60_000, overlapMs: 5000 });

  assert.ok(chunks.length >= 3, `expected several chunks, got ${chunks.length}`);
  assert.equal(chunks[0].startMs, 0);

  // The last chunk must reach the end — losing the tail of a long stream is
  // exactly the kind of bug nobody notices until an export is short.
  const last = chunks[chunks.length - 1];
  assert.ok(last.startMs + last.durationMs >= total - 100, "chunks do not reach the end");

  // Each chunk after the first starts BEFORE the previous one ended.
  for (let i = 1; i < chunks.length; i++) {
    const prevEnd = chunks[i - 1].startMs + chunks[i - 1].durationMs;
    assert.ok(chunks[i].startMs < prevEnd, `chunk ${i} does not overlap its predecessor`);
    assert.ok(prevEnd - chunks[i].startMs <= 12_000, `overlap at ${i} is larger than asked for`);
  }
});

test("every chunk begins on a real frame boundary", { skip: !has("len-15.mp3") }, () => {
  const chunks = splitMp3(load("len-15.mp3"), { chunkMs: 5 * 60_000, overlapMs: 5000 });
  for (const [i, c] of chunks.entries()) {
    // A frame boundary starts with the eleven-bit sync word. Cutting anywhere
    // else is what produces noise at the seam.
    assert.equal(c.bytes[0], 0xff, `chunk ${i} does not start with a frame sync`);
    assert.equal(c.bytes[1] & 0xe0, 0xe0, `chunk ${i} does not start with a frame sync`);
    assert.ok(parseFrames(c.bytes).length > 0, `chunk ${i} has no parseable frames`);
  }
});

test("a chunk's own duration matches what its frames actually contain", { skip: !has("len-15.mp3") }, () => {
  const chunks = splitMp3(load("len-15.mp3"), { chunkMs: 5 * 60_000, overlapMs: 5000 });
  for (const [i, c] of chunks.entries()) {
    assert.ok(Math.abs(durationMs(c.bytes) - c.durationMs) < 100, `chunk ${i} duration disagrees with its frames`);
  }
});

test("non-MP3 input is refused, not sliced into noise", () => {
  assert.throws(() => splitMp3(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), { chunkMs: 1000, overlapMs: 0 }), /not-mp3/);
});

/*
 * The streamed indexer is what production uses, because a Worker cannot hold a
 * ten-hour file in memory. It snaps to five-second markers rather than exact
 * frames, so it will never match the in-memory splitter to the millisecond —
 * and it is deliberately allowed to err toward MORE overlap, never less.
 *
 * So these check the contract the stitcher actually depends on, not agreement
 * between two implementations.
 */
test("streamed ranges begin on real frames and report their true duration", { skip: !has("len-15.mp3") }, async () => {
  const { indexMp3Chunks } = await import("../src/mp3.ts");
  const bytes = load("len-15.mp3");

  // Awkward 64KB reads, so frames straddle them — which is what happens coming
  // off R2, and is where a carry-buffer bug would hide.
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 65536) controller.enqueue(bytes.subarray(i, i + 65536));
      controller.close();
    },
  });

  const ranges = await indexMp3Chunks(stream, { chunkMs: 5 * 60_000, overlapMs: 45_000 });
  assert.ok(ranges.length >= 3);

  for (const [i, r] of ranges.entries()) {
    const slice = bytes.subarray(r.startByte, r.endByte);
    assert.equal(slice[0], 0xff, `chunk ${i} does not begin on a frame`);
    assert.equal(slice[1] & 0xe0, 0xe0, `chunk ${i} does not begin on a frame`);
    assert.ok(Math.abs(durationMs(slice) - r.durationMs) < 200, `chunk ${i} duration disagrees with its bytes`);
  }
});

test("every seam has at least the overlap the stitcher relies on", { skip: !has("len-15.mp3") }, async () => {
  const { indexMp3Chunks } = await import("../src/mp3.ts");
  const bytes = load("len-15.mp3");
  const overlapMs = 45_000;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < bytes.length; i += 65536) c.enqueue(bytes.subarray(i, i + 65536));
      c.close();
    },
  });
  const ranges = await indexMp3Chunks(stream, { chunkMs: 5 * 60_000, overlapMs });

  for (let i = 1; i < ranges.length; i++) {
    const prevEnd = ranges[i - 1].startMs + ranges[i - 1].durationMs;
    const overlap = prevEnd - ranges[i].startMs;
    // Too little and a sentence crossing the seam is lost; the stitcher hands
    // the seam to the later chunk and needs it to have heard the whole thing.
    assert.ok(overlap >= overlapMs, `seam ${i} overlaps by only ${Math.round(overlap)}ms`);
  }
});

test("the streamed ranges cover the file with no gaps", { skip: !has("len-15.mp3") }, async () => {
  const { indexMp3Chunks } = await import("../src/mp3.ts");
  const bytes = load("len-15.mp3");
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < bytes.length; i += 65536) c.enqueue(bytes.subarray(i, i + 65536));
      c.close();
    },
  });
  const ranges = await indexMp3Chunks(stream, { chunkMs: 5 * 60_000, overlapMs: 45_000 });

  // Consecutive ranges must overlap, never leave a hole — a hole is lost audio.
  for (let i = 1; i < ranges.length; i++) {
    assert.ok(ranges[i].startByte < ranges[i - 1].endByte, `gap before chunk ${i}`);
  }
  const total = durationMs(bytes);
  const last = ranges[ranges.length - 1];
  assert.ok(last.startMs + last.durationMs >= total - 100, "ranges do not reach the end");
});
