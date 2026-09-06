/**
 * The EDL decides what ends up in a user's export. If it is wrong, the video
 * they download is not the video they edited — and they will only find out
 * after watching it. Hence tests, without needing an encoder.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildEdl, buildRenderPlan, buildSrt } from "../src/edl.ts";
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

const clip = (start: number, end: number) => ({ kind: "clip" as const, start_ms: start * 1000, end_ms: end * 1000 });

test("a beat with no cuts renders its whole range", () => {
  const edl = buildEdl(KEY, [clip(0, 3)], SEGMENTS, []);
  assert.deepEqual(edl.cuts.map((c) => [c.start_ms, c.end_ms]), [[0, 3000]]);
  assert.equal(edl.durationMs, 3000);
});

test("beats render in the order given, not in source order", () => {
  // Reordering blocks is the whole point of Build; the EDL must respect it.
  const edl = buildEdl(KEY, [clip(6, 9), clip(0, 3)], SEGMENTS, []);
  assert.deepEqual(edl.cuts.map((c) => c.start_ms), [6000, 0]);
});

test("a word struck in Script does not survive a block kept in Pick", () => {
  // The two stages compose. Keeping the block must not resurrect a struck word.
  const cuts = toggleWord([], 0, 1); // strike "two", 1-2s
  const edl = buildEdl(KEY, [clip(0, 3)], SEGMENTS, cuts);
  assert.deepEqual(edl.cuts.map((c) => [c.start_ms, c.end_ms]), [[0, 1000], [2000, 3000]]);
  assert.equal(edl.durationMs, 2000);
});

test("a line struck in Script is absent from the render", () => {
  const cuts = toggleSegment([], 1);
  const edl = buildEdl(KEY, [clip(0, 9)], SEGMENTS, cuts);
  const covered = edl.cuts.map((c) => [c.start_ms, c.end_ms]);
  assert.deepEqual(covered, [[0, 3000], [6000, 9000]]);
});

test("a beat entirely inside struck text renders nothing at all", () => {
  const cuts = toggleSegment([], 1);
  const edl = buildEdl(KEY, [clip(3, 6)], SEGMENTS, cuts);
  assert.deepEqual(edl.cuts, []);
  assert.equal(edl.durationMs, 0);
});

test("recorded voice is passed through and NOT trimmed by transcript cuts", () => {
  // Striking a word in the source must not silently shorten a voiceover the
  // user recorded — they are different media.
  const cuts = toggleSegment([], 0);
  const edl = buildEdl(KEY, [
    { kind: "vo", media_r2_key: "u/1/beats/vo.webm", end_ms: 4000, text: "my line" },
    clip(0, 3),
  ], SEGMENTS, cuts);
  assert.equal(edl.cuts.length, 1);
  assert.equal(edl.cuts[0].sourceKey, "u/1/beats/vo.webm");
  assert.equal(edl.cuts[0].end_ms, 4000);
});

test("a beat with no recorded media yet is skipped, not rendered as silence", () => {
  const edl = buildEdl(KEY, [{ kind: "vo", end_ms: 4000, text: "not recorded yet" }], SEGMENTS, []);
  assert.deepEqual(edl.cuts, []);
});

test("captions are rebuilt from the transcript, never from the model", () => {
  const edl = buildEdl(KEY, [clip(0, 3)], SEGMENTS, []);
  assert.equal(edl.cuts[0].text, "one two three");
});

test("SRT timings are in OUTPUT time, not source time", () => {
  // The ranges have been rearranged, so a caption at 6s in the source lands at
  // 0s in the cut. Using source time makes subtitles drift ever further out.
  const edl = buildEdl(KEY, [clip(6, 9), clip(0, 3)], SEGMENTS, []);
  const srt = buildSrt(edl);
  assert.match(srt, /1\n00:00:00,000 --> 00:00:03,000\nseven eight nine/);
  assert.match(srt, /2\n00:00:03,000 --> 00:00:06,000\none two three/);
});

test("SRT skips silent ranges but still advances the clock", () => {
  const edl = {
    cuts: [
      { sourceKey: KEY, start_ms: 0, end_ms: 2000, text: "" },
      { sourceKey: KEY, start_ms: 0, end_ms: 2000, text: "spoken" },
    ],
    durationMs: 4000,
  };
  const srt = buildSrt(edl);
  // The spoken block must start at 2s, not 0s.
  assert.match(srt, /1\n00:00:02,000 --> 00:00:04,000\nspoken/);
});

test("the render plan carries seconds and a real duration", () => {
  const edl = buildEdl(KEY, [clip(0, 3)], SEGMENTS, []);
  const plan = buildRenderPlan(edl, "mp4_1080", "16:9");
  assert.deepEqual(plan.cuts, [{ key: KEY, start_s: 0, end_s: 3 }]);
  assert.equal(plan.durationS, 3);
  assert.equal(plan.format, "mp4_1080");
});

test("an empty edit produces an empty plan rather than a broken render", () => {
  const edl = buildEdl(KEY, [], SEGMENTS, []);
  assert.equal(edl.durationMs, 0);
  assert.equal(buildSrt(edl), "");
  assert.deepEqual(buildRenderPlan(edl, "mp4_1080", "16:9").cuts, []);
});

test("overlap is judged against the SMALLER range", async () => {
  const { overlapFraction } = await import("../src/projects.ts");
  // A short clip fully inside a longer one is a duplicate — that is the case
  // that matters when a second pass re-finds the same moment with slightly
  // different boundaries.
  assert.equal(overlapFraction({ start_ms: 0, end_ms: 10000 }, { start_ms: 2000, end_ms: 4000 }), 1);
  assert.equal(overlapFraction({ start_ms: 0, end_ms: 1000 }, { start_ms: 5000, end_ms: 6000 }), 0);
  assert.ok(overlapFraction({ start_ms: 0, end_ms: 10000 }, { start_ms: 9000, end_ms: 19000 }) < 0.2);
});

/**
 * A voiceover has sound and no picture.
 *
 * The renderer runs a scale filter and an h264 encode over every cut, which
 * needs a video stream to work on. A recorded voiceover is an audio-only
 * .webm, so it has none — ffmpeg failed and took the whole export with it,
 * meaning an edit containing any voiceover could not be exported at all.
 *
 * The flag is what tells the renderer to give that cut a picture. These tests
 * pin it, because the container half cannot be run here and a silent
 * regression would look exactly like this bug did: fine until you record.
 */
test("a recorded voiceover is flagged as having no picture", () => {
  const edl = buildEdl(
    "u/x/sources/s/original.mp4",
    [{ kind: "vo", end_ms: 4000, media_r2_key: "u/x/beats/b1.webm", text: "my bit" }],
    [],
    [],
  );
  assert.equal(edl.cuts.length, 1);
  assert.equal(edl.cuts[0].audioOnly, true);
  assert.equal(edl.cuts[0].sourceKey, "u/x/beats/b1.webm");
});

test("a reaction is a recording too", () => {
  const edl = buildEdl("src.mp4", [{ kind: "react", end_ms: 2000, media_r2_key: "r.webm" }], [], []);
  assert.equal(edl.cuts[0].audioOnly, true);
});

test("a visual carries its own video and is NOT flagged", () => {
  /* generated and stock are pictures, not recordings — flagging them would
     replace a real visual with a blank card. */
  for (const kind of ["generated", "stock"] as const) {
    const edl = buildEdl("src.mp4", [{ kind, end_ms: 2000, media_r2_key: "v.mp4" }], [], []);
    assert.equal(edl.cuts[0].audioOnly, undefined, `${kind} must not be treated as audio-only`);
  }
});

test("footage cuts are never flagged", () => {
  const segments = [{ idx: 0, start_ms: 0, end_ms: 5000, words: null }];
  const edl = buildEdl("src.mp4", [{ kind: "clip", start_ms: 0, end_ms: 5000 }], segments, []);
  assert.ok(edl.cuts.length > 0);
  for (const c of edl.cuts) assert.equal(c.audioOnly, undefined);
});

test("the flag survives into the plan the container runs", () => {
  const edl = buildEdl("src.mp4", [
    { kind: "clip", start_ms: 0, end_ms: 3000 },
    { kind: "vo", end_ms: 2000, media_r2_key: "v.webm" },
  ], [{ idx: 0, start_ms: 0, end_ms: 3000, words: null }], []);

  const plan = buildRenderPlan(edl, "mp4_1080", "16:9");
  const flags = plan.cuts.map((c) => Boolean(c.audioOnly));
  assert.deepEqual(flags, [false, true], "only the voiceover is audio-only");
});
