/**
 * The EDL decides what ends up in a user's export. If it is wrong, the video
 * they download is not the video they edited — and they will only find out
 * after watching it. Hence tests, without needing an encoder.
 *
 * It is built from the BLOCK SEQUENCE. It used to be built from clip beats,
 * which only exist after a scoring pass, so a cut made by striking text could
 * not be exported at all — the case at the top of this file.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildEdl, buildRenderPlan, buildSrt, captionCues } from "../src/edl.ts";
import { buildBlocks, type Block } from "../src/blocks.ts";
import { toggleSegment, toggleWord } from "../src/cuts.ts";

/** Three lines, a word a second: "one two three" / "four five six" / "seven eight nine". */
const seg = (idx: number, base: number, text: string) => ({
  idx,
  start_ms: base * 1000,
  end_ms: (base + text.split(" ").length) * 1000,
  text,
  words: JSON.stringify(text.split(" ").map((w, i) => ({ w, s: base + i, e: base + i + 1 }))),
});
const SEGMENTS = [seg(0, 0, "one two three"), seg(1, 3, "four five six"), seg(2, 6, "seven eight nine")];
const KEY = "u/1/sources/a/original.mp4";

/** The sequence the editor would show, for these segments and these cuts. */
const blocksFor = (cuts: Parameters<typeof buildEdl>[2], order?: string[]) =>
  buildBlocks({ segments: SEGMENTS, cuts, order });

/** An inserted block carrying its own media. */
const carried = (origin: Block["origin"], durMs: number, mediaKey: string | null, text = ""): Block => ({
  id: "b:x",
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

/*
 * THE ONE THAT WAS BROKEN.
 *
 * A cut you made by striking text has no beats at all. The EDL was built by
 * walking beats, so it came back empty and the render failed with "There's
 * nothing kept to render yet" — while the editor showed a full runtime and an
 * enabled Export button.
 */
test("a cut with no scoring pass still renders — the whole transcript", () => {
  const edl = buildEdl(KEY, blocksFor([]), []);
  assert.ok(edl.cuts.length > 0, "an unassisted cut must produce a renderable EDL");
  assert.equal(edl.durationMs, 9000);
});

test("striking a line removes it from the export", () => {
  const cuts = toggleSegment([], 1);
  const edl = buildEdl(KEY, blocksFor(cuts), cuts);
  assert.deepEqual(edl.cuts.map((c) => [c.start_ms, c.end_ms]), [[0, 3000], [6000, 9000]]);
  assert.equal(edl.durationMs, 6000);
});

test("striking a word removes it from the export", () => {
  const cuts = toggleWord([], 0, 1); // "two", 1-2s
  const edl = buildEdl(KEY, blocksFor(cuts), cuts);
  assert.deepEqual(
    edl.cuts.filter((c) => c.start_ms < 3000).map((c) => [c.start_ms, c.end_ms]),
    [[0, 1000], [2000, 3000]],
  );
});

test("striking every word of a line leaves nothing of it", () => {
  let cuts: ReturnType<typeof toggleWord> = [];
  for (let i = 0; i < 3; i++) cuts = toggleWord(cuts, 1, i);
  const edl = buildEdl(KEY, blocksFor(cuts), cuts);
  assert.equal(edl.cuts.some((c) => c.start_ms >= 3000 && c.end_ms <= 6000), false);
});

/*
 * REORDERING. /blocks/move writes block_order and used to return ok:true while
 * the export came out in source order regardless — the render never read it.
 */
test("the export follows the order the blocks were arranged in", () => {
  const edl = buildEdl(KEY, blocksFor([], ["s:2", "s:0", "s:1"]), []);
  assert.deepEqual(edl.cuts.map((c) => c.start_ms), [6000, 0, 3000]);
});

test("an order naming only some blocks leaves the rest where they were", () => {
  const edl = buildEdl(KEY, blocksFor([], ["s:2"]), []);
  assert.equal(edl.cuts[0].start_ms, 6000);
  assert.equal(edl.cuts.length, 3, "nothing is dropped by a partial order");
});

/*
 * A STRUCK INSERTED BLOCK. beats.struck was written and read by the editor,
 * but the EDL had no notion of it — a voiceover you cut was in your export.
 */
test("a struck block contributes nothing to the export", () => {
  const gone = { ...carried("voice", 4000, "u/x/beats/b1.webm"), struck: true };
  const edl = buildEdl(KEY, [gone], []);
  assert.deepEqual(edl.cuts, []);
});

test("a recording is passed through and NOT trimmed by transcript cuts", () => {
  // Striking a word in the source must not shorten a voiceover.
  const cuts = toggleSegment([], 0);
  const edl = buildEdl(KEY, [carried("voice", 4000, "u/x/beats/b1.webm", "my bit")], cuts);
  assert.equal(edl.cuts.length, 1);
  assert.equal(edl.cuts[0].end_ms, 4000);
});

test("a block with no recording yet is skipped, not rendered as silence", () => {
  assert.deepEqual(buildEdl(KEY, [carried("voice", 4000, null)], []).cuts, []);
});

/*
 * A voiceover has sound and no picture. The renderer scales and h264-encodes
 * every cut, which needs a video stream; an audio-only .webm has none, so
 * ffmpeg failed and took the whole export with it. The container half cannot
 * run here, and a regression would look exactly like that bug did: fine until
 * you record.
 */
test("a recording is flagged as having no picture", () => {
  const edl = buildEdl(KEY, [carried("voice", 4000, "u/x/beats/b1.webm")], []);
  assert.equal(edl.cuts[0].audioOnly, true);
  assert.equal(edl.cuts[0].sourceKey, "u/x/beats/b1.webm");
});

test("a generated visual carries its own video and is NOT flagged", () => {
  // Flagging it would replace a real picture with a blank card.
  const edl = buildEdl(KEY, [carried("generated", 2000, "v.mp4")], []);
  assert.equal(edl.cuts[0].audioOnly, undefined);
});

test("footage cuts are never flagged", () => {
  for (const c of buildEdl(KEY, blocksFor([]), []).cuts) assert.equal(c.audioOnly, undefined);
});

test("the flag survives into the plan the container runs", () => {
  const edl = buildEdl(KEY, [...blocksFor([]).slice(0, 1), carried("voice", 2000, "v.webm")], []);
  const flags = buildRenderPlan(edl, "mp4_1080", "16:9").cuts.map((c) => Boolean(c.audioOnly));
  assert.deepEqual(flags, [false, true], "only the recording is audio-only");
});

/*
 * CAPTIONS. One cue per block, not one per merged range across the whole
 * transcript — that produced a single line holding minutes of joined text,
 * on screen for the whole span.
 */
test("captions are one cue per line, not one for the whole cut", () => {
  const cues = captionCues(buildEdl(KEY, blocksFor([]), []));
  assert.equal(cues.length, 3);
  assert.deepEqual(cues.map((c) => c.text), ["one two three", "four five six", "seven eight nine"]);
});

test("a caption says only the words that survived", () => {
  const cuts = toggleWord([], 0, 1); // "two"
  const cues = captionCues(buildEdl(KEY, blocksFor(cuts), cuts));
  assert.equal(cues[0].text, "one", "the range that plays 'one' must not claim the whole line");
  assert.ok(!cues.some((c) => c.text.includes("two")), "a struck word is in no caption");
});

test("caption timings are in OUTPUT time, not source time", () => {
  const cuts = toggleSegment([], 0); // drop the first three seconds
  const cues = captionCues(buildEdl(KEY, blocksFor(cuts), cuts));
  assert.equal(cues[0].start_ms, 0, "the first surviving line starts the finished piece");
  assert.equal(cues[0].text, "four five six");
});

test("SRT is written from those same cues", () => {
  const srt = buildSrt(buildEdl(KEY, blocksFor([]), []));
  assert.match(srt, /^1\n00:00:00,000 --> 00:00:03,000\none two three/);
});

test("the render plan carries seconds and a real duration", () => {
  const cuts = toggleSegment(toggleSegment([], 1), 2);
  const plan = buildRenderPlan(buildEdl(KEY, blocksFor(cuts), cuts), "mp4_1080", "16:9");
  assert.deepEqual(plan.cuts, [{ key: KEY, start_s: 0, end_s: 3 }]);
  assert.equal(plan.durationS, 3);
  assert.equal(plan.format, "mp4_1080");
});

test("an empty edit produces an empty plan rather than a broken render", () => {
  const edl = buildEdl(KEY, [], []);
  assert.equal(edl.durationMs, 0);
  assert.equal(buildSrt(edl), "");
  assert.deepEqual(buildRenderPlan(edl, "mp4_1080", "16:9").cuts, []);
});

/*
 * Captions stay OPT-IN: burned-in text cannot be taken back out of a finished
 * file, so the default has to be the reversible one.
 */
test("captions are absent unless a style is asked for", () => {
  const edl = buildEdl(KEY, blocksFor([]), []);
  for (const style of [undefined, null, "None"]) {
    const plan = buildRenderPlan(edl, "mp4_1080", "16:9", style as never);
    assert.equal(plan.captions, undefined, `style ${String(style)} must not burn captions`);
    assert.equal(plan.captionStyle, undefined);
  }
});

test("asking for a style puts real cues in the plan", () => {
  const plan = buildRenderPlan(buildEdl(KEY, blocksFor([]), []), "mp4_1080", "9:16", "Bold");
  assert.equal(plan.captionStyle, "Bold");
  assert.ok(plan.captions && plan.captions.length > 0, "a captioned plan needs cues");
});

test("overlap is judged against the SMALLER range", async () => {
  const { overlapFraction } = await import("../src/projects.ts");
  assert.equal(overlapFraction({ start_ms: 0, end_ms: 10000 }, { start_ms: 2000, end_ms: 4000 }), 1);
  assert.equal(overlapFraction({ start_ms: 0, end_ms: 1000 }, { start_ms: 5000, end_ms: 6000 }), 0);
  assert.ok(overlapFraction({ start_ms: 0, end_ms: 10000 }, { start_ms: 9000, end_ms: 19000 }) < 0.2);
});

/*
 * A CLIP PULLED FROM ANOTHER VIDEO.
 *
 * The seam's "A clip" drops a moment from your library into this cut. That
 * material is in no segment here, so the block carries the other video's key
 * and range — and the EDL has to cut from THAT file, not from the one this
 * project is made of. Getting it wrong would splice a stranger's timecode out
 * of your own footage.
 */
test("a pulled clip renders from its own video, at its own range", () => {
  const pulled = {
    ...carried("footage", 0, null),
    start_ms: 4000,
    end_ms: 9000,
    mediaKey: "u/1/sources/other/original.mp4",
    text: "the bit from the other interview",
  };
  const edl = buildEdl(KEY, [pulled], []);
  assert.equal(edl.cuts.length, 1);
  assert.equal(edl.cuts[0].sourceKey, "u/1/sources/other/original.mp4", "not this project's file");
  assert.deepEqual([edl.cuts[0].start_ms, edl.cuts[0].end_ms], [4000, 9000]);
  assert.equal(edl.cuts[0].audioOnly, undefined, "it is footage, and has a picture");
});

test("a pulled clip is not trimmed by this transcript's cuts", () => {
  // The cuts belong to this video's words; the pulled clip's words are in
  // another transcript entirely and striking here must not shorten it.
  const cuts = toggleSegment([], 0);
  const pulled = { ...carried("footage", 0, null), start_ms: 0, end_ms: 5000, mediaKey: "other.mp4" };
  const edl = buildEdl(KEY, [pulled], cuts);
  assert.equal(edl.cuts[0].end_ms, 5000);
});
