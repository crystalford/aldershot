/**
 * An edit made from the whole library.
 *
 * Every edit in this product belonged to one video, and the assumption lived
 * in the guards rather than in the machinery: a Block already carried its own
 * mediaKey, an EdlCut its own sourceKey, and the container already downloaded
 * one file per distinct url. These check the two things that had to become
 * true above that layer — that an EDL can be built with no project source at
 * all, and that it renders each block from the video it actually came from.
 *
 * The failure this guards against is specific and silent: a cut whose blocks
 * come from three videos rendering three ranges out of ONE of them, which
 * produces a perfectly valid file of the wrong footage.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEdl } from "../src/edl.ts";
import { dedupe } from "../src/assemble.ts";
import type { Block } from "../src/blocks.ts";

/** A clip pulled in from another video: its own file, its own range. */
const pulled = (id: string, key: string, start: number, end: number): Block => ({
  id: `b:${id}`,
  origin: "footage",
  start_ms: start,
  end_ms: end,
  text: "a line from " + key,
  words: [],
  struck: false,
  score: null,
  why: null,
  label: null,
  mediaKey: key,
  previewKey: key,
  voiceKey: null,
  posterKey: null,
});

test("an edit with no video of its own still builds an EDL", () => {
  /* edlForProject refused any project without a source_id, which is what made
     "assembled from the library" unrenderable. buildEdl's sourceKey was only
     ever a fallback. */
  const edl = buildEdl(
    "",
    [pulled("a", "u/u1/sources/A/original.mp4", 1000, 4000)],
    [],
  );
  assert.equal(edl.cuts.length, 1);
  assert.equal(edl.cuts[0].sourceKey, "u/u1/sources/A/original.mp4");
  assert.equal(edl.durationMs, 3000);
});

test("every block renders from the video it came from", () => {
  /* The silent failure worth designing against: three videos' worth of blocks
     rendering three ranges out of one file. Valid output, wrong footage. */
  const edl = buildEdl("", [
    pulled("a", "u/u1/sources/A/original.mp4", 0, 2000),
    pulled("b", "u/u1/sources/B/original.mp4", 5000, 6500),
    pulled("c", "u/u1/sources/C/original.mp4", 100, 900),
  ], []);

  assert.deepEqual(
    edl.cuts.map((c) => c.sourceKey),
    [
      "u/u1/sources/A/original.mp4",
      "u/u1/sources/B/original.mp4",
      "u/u1/sources/C/original.mp4",
    ],
  );
  /* Three distinct files: the container downloads one per distinct url. */
  assert.equal(new Set(edl.cuts.map((c) => c.sourceKey)).size, 3);
});

test("a block with no file anywhere is skipped, not rendered as nothing", () => {
  /* On a project WITH a source this cannot happen — the project's key is the
     fallback. On a library edit it means a clip whose video has gone, and an
     empty key would be handed to the encoder to fetch. */
  const orphan = { ...pulled("x", "", 0, 1000), mediaKey: null, previewKey: null };
  const edl = buildEdl("", [orphan, pulled("a", "u/u1/sources/A/original.mp4", 0, 500)], []);
  assert.equal(edl.cuts.length, 1);
  assert.equal(edl.cuts[0].sourceKey, "u/u1/sources/A/original.mp4");
  assert.ok(edl.cuts.every((c) => c.sourceKey), "no cut may carry an empty key");
});

test("the project's own video is still the fallback when there is one", () => {
  /* The single-source path must not regress: a block with no mediaKey of its
     own is a line of THIS project's video and renders from it. */
  const own: Block = {
    ...pulled("s", "", 0, 0),
    id: "s:3",
    mediaKey: null,
    previewKey: null,
    start_ms: 2000,
    end_ms: 5000,
    words: [],
  };
  const edl = buildEdl("u/u1/sources/OWN/original.mp4", [own], []);
  assert.equal(edl.cuts.length, 1);
  assert.equal(edl.cuts[0].sourceKey, "u/u1/sources/OWN/original.mp4");
});

test("showing a pulled clip's words does not change what gets rendered", () => {
  /*
   * THE INVARIANT THIS WHOLE SPLIT EXISTS FOR.
   *
   * blockRanges takes a whole-block fast path when a block has no words, and
   * builds ranges out of word timings when it has them. A pulled clip's word
   * cuts can never be addressed — wordStruck does Number(id.slice(2)) and a
   * beat id is a ulid, so that is NaN — so putting real words on `words` would
   * change what the render produces while leaving no way to affect it.
   *
   * The words go on displayWords, which only the page reads. If someone ever
   * moves them onto `words` to make striking work, this fails and says why.
   */
  const words = [
    { w: "one", s: 1.0, e: 1.4 },
    { w: "two", s: 1.4, e: 1.9 },
    { w: "three", s: 1.9, e: 2.6 },
  ];
  const bare = pulled("a", "u/u1/sources/A/original.mp4", 1000, 4000);
  const readable = { ...bare, displayWords: words };

  const before = buildEdl("", [bare], []);
  const after = buildEdl("", [readable], []);

  assert.deepEqual(
    after.cuts.map((c) => [c.start_ms, c.end_ms, c.sourceKey]),
    before.cuts.map((c) => [c.start_ms, c.end_ms, c.sourceKey]),
    "the words are for reading; the render must not notice them",
  );
  assert.equal(after.durationMs, before.durationMs);
  assert.equal(readable.words.length, 0, "displayWords must never be promoted to words");
});

test("an assembly does not say the same thing twice in a row", () => {
  /*
   * The clip library holds moments found by different passes over the same
   * video and they overlap freely — two rows covering the same forty seconds
   * are both honest. Put both in a sequence and the cut repeats itself, which
   * reads as a bug however true each row is.
   *
   * Overlap is fine in a list you are browsing and wrong in one you are about
   * to watch, so this is done at assembly rather than in the library.
   */
  const m = (id: string, src: string, a: number, b: number) => ({ id, source_id: src, start_ms: a, end_ms: b });

  assert.deepEqual(
    dedupe([m("1", "A", 0, 5000), m("2", "A", 3000, 8000), m("3", "A", 9000, 12000)]).map((x) => x.id),
    ["1", "3"],
    "the overlapping one goes; the best-ranked keeps the ground it covers",
  );

  /* Same timecodes in DIFFERENT videos are different footage. */
  assert.deepEqual(
    dedupe([m("1", "A", 0, 5000), m("2", "B", 0, 5000)]).map((x) => x.id),
    ["1", "2"],
  );

  /* Touching is not overlapping: one ends exactly where the next begins. */
  assert.deepEqual(
    dedupe([m("1", "A", 0, 5000), m("2", "A", 5000, 9000)]).map((x) => x.id),
    ["1", "2"],
  );
});
