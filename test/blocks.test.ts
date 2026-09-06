/**
 * The block — one atom for what were three.
 *
 * segments, v2_clips and beats were three tables for the same idea, which is
 * why the editor grew four tabs that felt like one. These pin the sequence
 * rules, because the editor and the renderer both read them and a disagreement
 * between those two is a video that does not match what you edited.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBlocks, moveBlock, parseOrder, runtimeMs, wordStruck } from "../src/blocks.ts";
import { toggleSegment, toggleWord } from "../src/cuts.ts";

/* Word timings are stored in SECONDS while the segment's own start_ms/end_ms
   are milliseconds — see StoredWord in src/cuts.ts. Writing this fixture in
   milliseconds is what produced a 59-minute runtime for a 2-minute video the
   first time the editor ran, so it is spelled out here. */
const words = (...ws: string[]) =>
  JSON.stringify(ws.map((w, i) => ({ w, s: i, e: i + 1 })));

const SEGMENTS = [
  { idx: 0, start_ms: 0, end_ms: 3000, text: "one two three", words: words("one", "two", "three") },
  { idx: 1, start_ms: 3000, end_ms: 6000, text: "four five six", words: words("four", "five", "six") },
  { idx: 2, start_ms: 6000, end_ms: 9000, text: "seven eight nine", words: words("seven", "eight", "nine") },
];

test("a fresh cut is the transcript, in order, nothing struck", () => {
  const blocks = buildBlocks({ segments: SEGMENTS, cuts: [] });
  assert.deepEqual(blocks.map((b) => b.id), ["s:0", "s:1", "s:2"]);
  assert.ok(blocks.every((b) => b.origin === "footage" && !b.struck));
});

test("a struck line stays in the sequence, marked", () => {
  /* Nothing vanishes: the cut has to stay legible and putting it back has to
     be one click. That is why order and cuts are separate. */
  const cuts = toggleSegment([], 1);
  const blocks = buildBlocks({ segments: SEGMENTS, cuts });
  assert.equal(blocks.length, 3);
  assert.equal(blocks[1].struck, true);
});

test("a recording is a block of its own; a clip beat is not", () => {
  /* A clip beat points at footage the segments already cover, so treating it
     as a block would render the same range twice. */
  const beats = [
    { id: "V1", idx: 0, kind: "vo", text: "my bit", dur_ms: 4000, media_r2_key: "u/x/b/V1.webm", clip_id: null },
    { id: "C1", idx: 1, kind: "clip", text: null, dur_ms: 2000, media_r2_key: null, clip_id: "CLIP" },
  ];
  const blocks = buildBlocks({ segments: SEGMENTS, beats, cuts: [] });
  assert.ok(blocks.some((b) => b.id === "b:V1" && b.origin === "voice"));
  assert.ok(!blocks.some((b) => b.id === "b:C1"), "a clip beat is not its own block");
});

test("reordering moves one block and keeps every other", () => {
  const blocks = buildBlocks({ segments: SEGMENTS, cuts: [] });
  const order = moveBlock(blocks, "s:2", -1);
  assert.deepEqual(order, ["s:0", "s:2", "s:1"]);

  const rearranged = buildBlocks({ segments: SEGMENTS, cuts: [], order });
  assert.deepEqual(rearranged.map((b) => b.id), ["s:0", "s:2", "s:1"]);
});

test("moving past either end does nothing", () => {
  const blocks = buildBlocks({ segments: SEGMENTS, cuts: [] });
  assert.deepEqual(moveBlock(blocks, "s:0", -1), ["s:0", "s:1", "s:2"]);
  assert.deepEqual(moveBlock(blocks, "s:2", 1), ["s:0", "s:1", "s:2"]);
});

test("a new transcript line appears without losing the arrangement", () => {
  /* A re-read, or a longer source. An order that named only the old ids must
     not throw away the rearrangement, and must not hide the new line. */
  const order = ["s:2", "s:0", "s:1"];
  const longer = [...SEGMENTS, { idx: 3, start_ms: 9000, end_ms: 11000, text: "ten", words: words("ten") }];
  const blocks = buildBlocks({ segments: longer, cuts: [], order });
  assert.deepEqual(blocks.map((b) => b.id), ["s:2", "s:0", "s:1", "s:3"]);
});

test("an order naming something gone simply drops it", () => {
  const blocks = buildBlocks({ segments: SEGMENTS, cuts: [], order: ["s:9", "s:1", "s:0"] });
  assert.deepEqual(blocks.map((b) => b.id), ["s:1", "s:0", "s:2"]);
});

test("the model's opinion attaches to the line it is most about", () => {
  /* A scored moment spans several lines; the one most inside it owns it. */
  const scores = [{ start_ms: 3200, end_ms: 5800, score: 88, why: "the good bit" }];
  const blocks = buildBlocks({ segments: SEGMENTS, cuts: [], scores });
  assert.equal(blocks[1].score, 88);
  assert.equal(blocks[0].score, null, "unjudged is null, not zero");
});

test("word timings are read as seconds, not milliseconds", () => {
  /* The two units live in adjacent columns of the same row. Reading them as
     milliseconds reported 59 minutes for a 2-minute video. */
  const blocks = buildBlocks({ segments: SEGMENTS, cuts: [] });
  assert.equal(runtimeMs(blocks, []), 9000, "three lines of three one-second words");
});

test("runtime counts surviving words, not whole lines", () => {
  /* This is what makes striking a word remove video. A line-level sum would
     report a runtime the render does not produce. */
  const all = buildBlocks({ segments: SEGMENTS, cuts: [] });
  assert.equal(runtimeMs(all, []), 9000);

  const cuts = toggleWord([], 0, 1);
  const blocks = buildBlocks({ segments: SEGMENTS, cuts });
  assert.equal(runtimeMs(blocks, cuts), 8000, "one struck word is one second less");
  assert.equal(wordStruck(cuts, blocks[0], 1), true);
});

test("a struck line contributes nothing, however many words it has", () => {
  const cuts = toggleSegment([], 0);
  const blocks = buildBlocks({ segments: SEGMENTS, cuts });
  assert.equal(runtimeMs(blocks, cuts), 6000);
});

test("a malformed stored order is treated as no order", () => {
  for (const v of [null, "", "{}", "not json", '["a",2,"b"]']) {
    const parsed = parseOrder(v as never);
    assert.ok(Array.isArray(parsed));
    assert.ok(parsed.every((x) => typeof x === "string"));
  }
});
