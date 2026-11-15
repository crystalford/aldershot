/**
 * THE EXPORTED CUT, TRACEABLE.
 *
 * The EDL is the artifact this product hands out — over /api/projects/:id/edl
 * and as an OTIO timeline anybody can open in Resolve. It went out for months
 * carrying two R2 keys, a quote and a time range: everything about WHAT was
 * cut and nothing about WHY. The quote was rebuilt from the block's own words,
 * so even the text could not be matched back to a row.
 *
 * That matters more now than it did. If the assembly is a commodity and the
 * decision record is not, an artifact that cannot name its decisions is the
 * commodity half.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildEdl } from "../src/edl.ts";
import { buildBlocks, type Block } from "../src/blocks.ts";
import { toggleWord } from "../src/cuts.ts";
import { timingOf } from "../src/align.ts";
import { buildOtio, type MediaInfo } from "../src/otio.ts";
import type { TimingSource } from "../src/align.ts";

const seg = (idx: number, base: number, text: string) => ({
  idx,
  start_ms: base * 1000,
  end_ms: (base + text.split(" ").length) * 1000,
  text,
  words: JSON.stringify(text.split(" ").map((w, i) => ({ w, s: base + i, e: base + i + 1 }))),
});
const SEGMENTS = [seg(0, 0, "one two three"), seg(1, 3, "four five six")];
const KEY = "u/1/sources/a/original.mp4";

/* The real opts shape. Written out rather than cast, because the first version
   of this test passed `{ title, timing } as never` and buildOtio threw on the
   absent media map from inside the assertion — an error that reads like the
   thing under test is broken. */
const otioOf = (edl: Parameters<typeof buildOtio>[0], timing: TimingSource) =>
  buildOtio(edl, { name: "a cut", media: new Map<string, MediaInfo>(), timing });

/** Every Clip.1's aldershot metadata, in order. */
const marks = (o: unknown): Array<{ blockId: string; timing: string }> =>
  (o as { tracks: { children: Array<{ children: unknown[] }> } }).tracks.children
    .flatMap((t) => t.children)
    .filter((c) => (c as { OTIO_SCHEMA?: string }).OTIO_SCHEMA === "Clip.1")
    .map((c) => (c as { metadata: { aldershot: { blockId: string; timing: string } } }).metadata.aldershot);

const carried = (origin: Block["origin"], durMs: number, mediaKey: string | null, text = ""): Block => ({
  id: "b:inserted",
  origin,
  start_ms: 0,
  end_ms: durMs,
  text,
  words: [],
  struck: false,
  score: null,
  why: null,
  label: null,
  mediaKey,
  previewKey: mediaKey,
  voiceKey: null,
  posterKey: null,
});

test("every cut names a block that is actually in the sequence", () => {
  const blocks = buildBlocks({ segments: SEGMENTS, cuts: [] });
  const edl = buildEdl(KEY, blocks, []);
  const ids = new Set(blocks.map((b) => b.id));

  assert.ok(edl.cuts.length > 0, "no cuts to check");
  for (const c of edl.cuts) {
    assert.ok(c.blockId, `a cut has no blockId: ${JSON.stringify(c)}`);
    assert.ok(ids.has(c.blockId), `a cut names block ${c.blockId}, which is not in the sequence`);
  }
});

/*
 * ONE BLOCK, SEVERAL CUTS, THE SAME ID.
 *
 * Striking a word out of the middle of a line splits it into two ranges. Both
 * came from one decision, so both name it: blockId identifies the decision,
 * not the range, and a test that demanded uniqueness would be demanding the
 * wrong thing.
 */
test("a line with a word struck out of its middle yields two cuts with one blockId", () => {
  const cuts = toggleWord([], 0, 1);
  const blocks = buildBlocks({ segments: SEGMENTS, cuts });
  const edl = buildEdl(KEY, blocks, cuts);

  const first = edl.cuts.filter((c) => c.blockId === blocks[0].id);
  assert.equal(first.length, 2, `expected the split line to be two cuts, got ${first.length}`);
  assert.notEqual(first[0].start_ms, first[1].start_ms);
});

test("a card and a recording name their block too", () => {
  const card = carried("generated", 0, null, "THE CLAIM, SET AS TYPE");
  const voice = { ...carried("voice", 4000, "u/1/takes/t1.webm"), id: "b:take" };

  const fromCard = buildEdl(KEY, [card], []);
  assert.equal(fromCard.cuts.length, 1);
  assert.equal(fromCard.cuts[0].blockId, "b:inserted");

  const fromVoice = buildEdl(KEY, [voice], []);
  assert.equal(fromVoice.cuts.length, 1);
  assert.equal(fromVoice.cuts[0].blockId, "b:take");
});

/*
 * TIMING IS CARRIED ONLY WHERE IT DECIDED SOMETHING.
 *
 * A footage cut's edges were placed by blockRanges, which consults the timing.
 * A card has no words from a source and a recording plays its own full length,
 * so neither carries one — and when the CALLER passed no timing, nothing is
 * written, because blockRanges' internal default is not an opinion the caller
 * held.
 */
test("timing rides on footage cuts, and only when a caller said one", () => {
  const blocks = buildBlocks({ segments: SEGMENTS, cuts: [] });

  const silent = buildEdl(KEY, blocks, []);
  for (const c of silent.cuts) {
    assert.equal(c.timing, undefined, "a timing was invented for a caller who passed none");
  }

  const forced = buildEdl(KEY, blocks, [], undefined, timingOf("forced"));
  assert.ok(forced.cuts.length > 0);
  for (const c of forced.cuts) assert.equal(c.timing, "forced");

  /* And not on a card, even when one was passed. */
  const withCard = buildEdl(KEY, [carried("generated", 0, null, "A LINE")], [], undefined, timingOf("forced"));
  assert.equal(withCard.cuts[0].timing, undefined, "a card claimed a word timing");
});

/*
 * AND IT REACHES THE FILE SOMEBODY OPENS.
 *
 * Carrying the field and dropping it at the boundary would be the same as not
 * having it, which is what the OTIO writer did with timing: every clip got the
 * project-level value, so an edit mixing a forced-aligned source with a
 * caption-timed one overstated the worse and understated the better.
 */
test("the OTIO clip carries the block and the cut's own timing", () => {
  const blocks = buildBlocks({ segments: SEGMENTS, cuts: [] });
  const edl = buildEdl(KEY, blocks, [], undefined, timingOf("forced"));

  const clips = marks(otioOf(edl, "recogniser"));
  assert.ok(clips.length > 0, "the OTIO had no clips");
  for (const a of clips) {
    assert.ok(blocks.some((b) => b.id === a.blockId), `clip names block ${a.blockId}, not in the sequence`);
    /* The CUT's timing, not the project's — the project said recogniser. */
    assert.equal(a.timing, "forced");
  }
});

test("a clip with no timing of its own falls back to the project's", () => {
  const edl = buildEdl(KEY, [carried("generated", 0, null, "A LINE")], []);
  const a = marks(otioOf(edl, "caption"))[0];
  assert.equal(a.timing, "caption");
  assert.equal(a.blockId, "b:inserted");
});
