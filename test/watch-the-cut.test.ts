/**
 * Watching the cut.
 *
 * The editor has always played the ORIGINAL. Striking a line greys it out and
 * changes a number; whether the cut actually flows could only be found out by
 * exporting the file and watching it.
 *
 * The preview plays the ranges from `/api/projects/:id/edl` — the same builder
 * the export is cut from — so it cannot drift from the file. These pin the two
 * things that would break that: the EDL has to carry the key you WATCH as well
 * as the key you RENDER, and it must never confuse them.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBlocks } from "../src/blocks.ts";
import { buildEdl, buildRenderPlan } from "../src/edl.ts";

const SEGMENTS = [
  { idx: 0, start_ms: 0, end_ms: 4000, text: "one", words: null },
  { idx: 1, start_ms: 4000, end_ms: 8000, text: "two", words: null },
  { idx: 2, start_ms: 8000, end_ms: 12000, text: "three", words: null },
];

const MASTER = "u/u1/sources/s1/original.mp4";
const COPY = "u/u1/sources/s1/original.edit.mp4";

const edlFor = (cuts: never[] = [] as never) =>
  buildEdl(MASTER, buildBlocks({ segments: SEGMENTS, cuts }), cuts, COPY);

test("every range says which file to watch and which to render", () => {
  const edl = edlFor();
  assert.equal(edl.cuts.length, 3);
  for (const c of edl.cuts) {
    assert.equal(c.sourceKey, MASTER, "a render would come off the wrong file");
    assert.equal(c.previewKey, COPY, "the preview would scrub the master");
  }
});

test("a struck line is not in the cut, so the preview cannot play it", () => {
  /* The mechanic itself: the preview plays these ranges and nothing else. */
  const cuts = [{ seg: 1, words: null }] as never;
  const edl = edlFor(cuts);
  assert.deepEqual(
    edl.cuts.map((c) => [c.start_ms, c.end_ms]),
    [[0, 4000], [8000, 12000]],
    "the struck line survived into the ranges the preview would play",
  );
  assert.equal(edl.durationMs, 8000, "the clock would count the wrong length");
});

test("the render plan takes the master and never the copy", () => {
  /*
   * The line that must not move. Every surface plays the 480p copy now; a
   * render built from it would be an upscale nobody notices until they open
   * the file.
   */
  const plan = buildRenderPlan(edlFor(), "mp4_4k", "16:9");
  for (const c of plan.cuts) {
    assert.equal(c.key, MASTER);
    assert.doesNotMatch(c.key, /\.edit\.mp4$/);
  }
});

test("with no editing copy, the preview falls back to the master", () => {
  /* Footage read before the proxy existed. Slower, still correct — and it
     must not come back undefined, which would make the preview play /media/. */
  const edl = buildEdl(MASTER, buildBlocks({ segments: SEGMENTS, cuts: [] }), []);
  for (const c of edl.cuts) assert.equal(c.previewKey, MASTER);
});

test("cut time maps onto source time across the gap a strike leaves", () => {
  /*
   * What the client does with these. Range 0 is 0-4s of the source and 0-4s of
   * the cut; range 1 is 8-12s of the source and 4-8s of the cut. Six seconds
   * into the cut is ten seconds into the video, and if that mapping is wrong
   * the clock and the scrub bar lie about where you are.
   */
  const edl = edlFor([{ seg: 1, words: null }] as never);
  let at = 0;
  const ranges = edl.cuts.map((c) => {
    const r = { start: c.start_ms / 1000, end: c.end_ms / 1000, at };
    at += (c.end_ms - c.start_ms) / 1000;
    return r;
  });

  const sourceAt = (cutT: number) => {
    for (const r of ranges) if (cutT < r.at + (r.end - r.start)) return r.start + (cutT - r.at);
    return ranges[ranges.length - 1].end;
  };

  assert.equal(sourceAt(0), 0);
  assert.equal(sourceAt(2), 2, "still inside the first kept range");
  assert.equal(sourceAt(4), 8, "the strike is skipped, not played");
  assert.equal(sourceAt(6), 10);
  assert.equal(at, 8, "the cut's total length");
});

test("a reordered block plays in the order you arranged, not transcript order", () => {
  /*
   * Moving a block backwards means the preview seeks BACKWARDS mid-play. The
   * ranges are followed as a list rather than as a timeline, which is what
   * makes that work — and what would break if anything sorted them.
   */
  const order = ["s:2", "s:0", "s:1"];
  const edl = buildEdl(MASTER, buildBlocks({ segments: SEGMENTS, cuts: [], order }), [], COPY);
  assert.deepEqual(edl.cuts.map((c) => c.start_ms), [8000, 0, 4000]);
});
