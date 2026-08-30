/**
 * Seam bugs are the failure mode here: a timestamp that is subtly wrong hours
 * into a transcript, or a duplicated sentence at a chunk boundary. Neither is
 * visible until someone exports a cut and it is wrong, so both are tested.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { joinText, offsetSegments, stitch } from "../src/longaudio.ts";

const seg = (start: number, end: number, text: string) => ({
  start,
  end,
  text,
  words: text.split(" ").map((w, i, a) => ({
    word: w,
    start: start + (i / a.length) * (end - start),
    end: start + ((i + 1) / a.length) * (end - start),
  })),
});

test("a chunk's timestamps are shifted into the original's timeline", () => {
  const [s] = offsetSegments([seg(0, 10, "hello there")], 7_200_000);
  assert.equal(s.start, 7200);
  assert.equal(s.end, 7210);
  // Word timings must move too, or Script mode deletes the wrong video.
  assert.equal(s.words![0].start, 7200);
});

test("chunks join in order with the offsets applied", () => {
  const out = stitch([
    { startMs: 0, segments: [seg(0, 10, "first")] },
    { startMs: 7_200_000, segments: [seg(0, 10, "second")] },
  ]);
  assert.deepEqual(out.map((s) => s.text), ["first", "second"]);
  assert.equal(out[1].start, 7200);
});

/*
 * The real geometry: chunk 1 covers 0-100s, chunk 2 starts 45s before chunk 1
 * ends (at 55s) and runs on. The cutover is therefore 55s — chunk 1 keeps what
 * finishes before that, chunk 2 supplies everything after.
 */
const CHUNK2_START = 55_000;

test("the overlap is deduped — a repeated stretch appears once", () => {
  const out = stitch([
    { startMs: 0, segments: [seg(0, 50, "early"), seg(50, 80, "in the overlap")] },
    { startMs: CHUNK2_START, segments: [seg(-5, 25, "in the overlap"), seg(25, 45, "later")] },
  ]);
  assert.deepEqual(out.map((s) => s.text), ["early", "in the overlap", "later"]);
});

test("a sentence crossing the seam comes from the chunk that heard it whole", () => {
  // Chunk 1 ran out of audio mid-sentence at its own end (100s). Chunk 2
  // started at 55s, so it heard the whole thing. Preferring the earlier
  // version would clip a sentence at every seam.
  const out = stitch([
    { startMs: 0, segments: [seg(90, 100, "the sentence is cut off ha—")] },
    { startMs: CHUNK2_START, segments: [seg(35, 50, "the sentence is cut off halfway through")] },
  ]);
  assert.deepEqual(out.map((s) => s.text), ["the sentence is cut off halfway through"]);
});

test("no moment in time is claimed by two chunks", () => {
  // Duplication is structurally impossible rather than caught by a tolerance:
  // each chunk yields only what finishes before the next one takes over.
  const out = stitch([
    { startMs: 0, segments: [seg(50, 70.05, "spans the cutover")] },
    { startMs: CHUNK2_START, segments: [seg(-5, 15.05, "spans the cutover")] },
  ]);
  assert.equal(out.length, 1);
});

test("chunks arriving out of order still stitch correctly", () => {
  // Chunks may be transcribed in parallel and finish in any order.
  const out = stitch([
    { startMs: 7_200_000, segments: [seg(0, 10, "second")] },
    { startMs: 0, segments: [seg(0, 10, "first")] },
  ]);
  assert.deepEqual(out.map((s) => s.text), ["first", "second"]);
});

test("nothing is lost across many chunks", () => {
  // Ten hours in five two-hour chunks, which is the real shape of the problem.
  // Five two-hour chunks, each starting 45s before the previous one ended.
  const chunks = Array.from({ length: 5 }, (_, i) => ({
    startMs: i * (7_200_000 - 45_000),
    segments: [seg(60, 120, `chunk ${i} opening`), seg(6000, 6060, `chunk ${i} closing`)],
  }));
  const out = stitch(chunks);
  assert.equal(out.length, 10);
  // Strictly increasing: any regression means an offset was applied wrongly.
  for (let i = 1; i < out.length; i++) {
    assert.ok(out[i].start >= out[i - 1].start, `segment ${i} goes backwards`);
  }
  assert.ok(out[out.length - 1].start > 7 * 3600, "the last chunk did not land hours in");
  // And every one survived: nothing was dropped at a seam.
  assert.deepEqual(
    out.map((s) => s.text),
    chunks.flatMap((_, i) => [`chunk ${i} opening`, `chunk ${i} closing`]),
  );
});

test("an empty chunk does not break the join", () => {
  const out = stitch([
    { startMs: 0, segments: [seg(0, 10, "first")] },
    { startMs: 7_200_000, segments: [] },
    { startMs: 14_400_000, segments: [seg(0, 10, "third")] },
  ]);
  assert.deepEqual(out.map((s) => s.text), ["first", "third"]);
});

test("joinText rebuilds readable text", () => {
  assert.equal(joinText([seg(0, 1, "one two"), seg(1, 2, "three")]), "one two three");
});
