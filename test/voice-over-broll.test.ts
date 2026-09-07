/**
 * B-roll with your voice over it.
 *
 * "what if i wanted a b-roll clip and voiceover over it? does the system
 * support it?" It did not — and the interesting part is that the hard half
 * was already written. container/render.mjs mixes a recording over a clip with
 * the clip's own audio sidechain-ducked underneath, and it fires on a cut
 * carrying `voiceUrl`. Nothing in src/ had ever sent one.
 *
 * A beat could always hold BOTH a clip_id and a media_r2_key; buildBlocks just
 * never read the clip when there was a recording, so the picture was thrown
 * away and the render drew a flat colour card instead.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBlocks } from "../src/blocks.ts";
import { buildEdl, buildRenderPlan } from "../src/edl.ts";

const SEGMENTS = [{ idx: 0, start_ms: 0, end_ms: 4000, text: "our own line", words: null }];
const MASTER = "u/u1/sources/MINE/original.mp4";
const COPY = "u/u1/sources/MINE/original.edit.mp4";

const beat = (over: Record<string, unknown>) => ({
  id: "b1", idx: 0, kind: "clip", text: null, dur_ms: null,
  media_r2_key: null, clip_id: null, struck: 0, ...over,
});

const pulled = {
  sourceKey: "u/u1/sources/OTHER/original.mp4",
  previewKey: "u/u1/sources/OTHER/original.edit.mp4",
  sourceTitle: "Some b-roll", start_ms: 10_000, end_ms: 14_000,
  quote: "elsewhere", frameKey: null,
};

const blocksWith = (b: unknown) =>
  buildBlocks({ segments: SEGMENTS, cuts: [], beats: [b] } as never);

test("a clip you talked over is ONE block with a picture and a voice", () => {
  /* Not two blocks, and not a colour card: the shot is still the shot. */
  const blocks = blocksWith(beat({ clip_id: "c9", media_r2_key: "u/u1/beats/b1.webm", pulled }));
  const block = blocks.find((x) => x.id === "b:b1");
  assert.ok(block, "the beat did not become a block");
  assert.equal(block.origin, "footage", "it became a voiceover and lost the picture");
  assert.equal(block.mediaKey, "u/u1/sources/OTHER/original.mp4", "the picture is the clip's");
  assert.equal(block.voiceKey, "u/u1/beats/b1.webm", "the voice was dropped");
});

test("a voiceover with no clip behind it is unchanged", () => {
  /* It IS its own media, and renders as the colour card — correct, because
     there is no picture to put it on. */
  const blocks = blocksWith(beat({ kind: "vo", media_r2_key: "u/u1/beats/b1.webm", dur_ms: 3000 }));
  const block = blocks.find((x) => x.id === "b:b1");
  assert.ok(block);
  assert.equal(block.origin, "voice");
  assert.equal(block.mediaKey, "u/u1/beats/b1.webm");
  assert.equal(block.voiceKey, null, "a voiceover is not a voice over something else");
});

test("a clip with no recording on it is unchanged", () => {
  const blocks = blocksWith(beat({ clip_id: "c9", pulled }));
  const block = blocks.find((x) => x.id === "b:b1");
  assert.ok(block);
  assert.equal(block.origin, "footage");
  assert.equal(block.voiceKey, null);
});

test("the voice reaches the render plan, as a KEY and never a url", () => {
  /*
   * runRender presigns it. A plan built here must never carry a credential —
   * plans are logged, and a presigned url is a bearer token for the file.
   */
  const blocks = blocksWith(beat({ clip_id: "c9", media_r2_key: "u/u1/beats/b1.webm", pulled }));
  const plan = buildRenderPlan(buildEdl(MASTER, blocks, [], COPY), "mp4_1080", "16:9");
  const voiced = plan.cuts.filter((c) => c.voiceKey);
  assert.equal(voiced.length, 1, "the container would never see the recording");
  assert.equal(voiced[0].voiceKey, "u/u1/beats/b1.webm");
  assert.doesNotMatch(JSON.stringify(plan), /X-Amz|Signature|http/, "a plan carried a signed url");
});

test("and it still renders from the master, not the editing copy", () => {
  const blocks = blocksWith(beat({ clip_id: "c9", media_r2_key: "u/u1/beats/b1.webm", pulled }));
  const plan = buildRenderPlan(buildEdl(MASTER, blocks, [], COPY), "mp4_4k", "16:9");
  for (const c of plan.cuts) assert.doesNotMatch(c.key, /\.edit\.mp4$/);
});

test("cleaning up the sound is opt-in and absent otherwise", () => {
  /* It changes how somebody's voice sounds and cannot be undone in a finished
     file, so the default has to be the reversible one. */
  const edl = buildEdl(MASTER, blocksWith(beat({ clip_id: "c9", pulled })), [], COPY);
  assert.equal(buildRenderPlan(edl, "mp4_1080", "16:9").enhance, undefined);
  assert.equal(buildRenderPlan(edl, "mp4_1080", "16:9", "None", true).enhance, true);
});
