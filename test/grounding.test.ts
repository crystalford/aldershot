/**
 * The grounding layer is what stops a hallucinated quote reaching the user, so
 * it gets real tests rather than a click-through.
 *
 * Run: npm test
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { groundClips, parseClips } from "../src/grounding.ts";

const SEGMENTS = [
  { id: "a", source_id: "s", idx: 0, start_ms: 0, end_ms: 5000, speaker: null, text: "First thing said.", words: null },
  { id: "b", source_id: "s", idx: 1, start_ms: 5000, end_ms: 10000, speaker: null, text: "Second thing said.", words: null },
  { id: "c", source_id: "s", idx: 2, start_ms: 10000, end_ms: 15000, speaker: null, text: "Third thing said.", words: null },
];

test("quote is rebuilt from the transcript, never taken from the model", () => {
  const [clip] = groundClips(
    [{ start_ms: 0, end_ms: 5000, quote: "A QUOTE THE MODEL MADE UP", why: "x", score: 90, heat: 1 }],
    SEGMENTS,
  );
  assert.equal(clip.quote, "First thing said.");
});

test("a range spanning segments joins their real text", () => {
  const [clip] = groundClips([{ start_ms: 0, end_ms: 10000, why: "x", score: 50 }], SEGMENTS);
  assert.equal(clip.quote, "First thing said. Second thing said.");
});

test("ranges outside the transcript are dropped, not clamped", () => {
  // A timecode the model invented is not evidence of anything. Clamping it
  // would silently turn a hallucination into a real-looking clip.
  assert.equal(groundClips([{ start_ms: 900000, end_ms: 999999, why: "x", score: 90 }], SEGMENTS).length, 0);
});

test("inverted and zero-length ranges are dropped", () => {
  assert.equal(groundClips([{ start_ms: 8000, end_ms: 2000, why: "x", score: 9 }], SEGMENTS).length, 0);
  assert.equal(groundClips([{ start_ms: 5000, end_ms: 5000, why: "x", score: 9 }], SEGMENTS).length, 0);
});

test("a range overhanging the end is trimmed to what exists", () => {
  const [clip] = groundClips([{ start_ms: 10000, end_ms: 60000, why: "x", score: 40 }], SEGMENTS);
  assert.equal(clip.end_ms, 15000);
});

test("clips come back in transcript order regardless of model order", () => {
  const clips = groundClips(
    [
      { start_ms: 10000, end_ms: 15000, why: "c", score: 10 },
      { start_ms: 0, end_ms: 5000, why: "a", score: 90 },
    ],
    SEGMENTS,
  );
  assert.deepEqual(clips.map((c) => c.why), ["a", "c"]);
});

test("score and heat are clamped; junk falls back rather than propagating", () => {
  const [clip] = groundClips(
    [{ start_ms: 0, end_ms: 5000, why: "x", score: 5000, heat: 99 }],
    SEGMENTS,
  );
  assert.equal(clip.score, 100);
  assert.equal(clip.heat, 2);

  const [b] = groundClips(
    [{ start_ms: 0, end_ms: 5000, why: "x", score: NaN as unknown as number }],
    SEGMENTS,
  );
  assert.equal(b.score, 0);
});

test("finding nothing is a valid answer", () => {
  assert.deepEqual(groundClips([], SEGMENTS), []);
});

test("parseClips reads the object form, a bare array, and a JSON string", () => {
  const one = [{ start_ms: 0, end_ms: 1 }];
  assert.deepEqual(parseClips({ clips: one }), one);
  assert.deepEqual(parseClips(one), one);
  assert.deepEqual(parseClips(JSON.stringify({ clips: one })), one);
});

test("parseClips survives a fenced code block", () => {
  // These models wrap JSON in ```json despite being told not to.
  assert.deepEqual(
    parseClips('```json\n{"clips":[{"start_ms":0,"end_ms":1}]}\n```'),
    [{ start_ms: 0, end_ms: 1 }],
  );
});

test("parseClips returns nothing rather than throwing on garbage", () => {
  assert.deepEqual(parseClips("not json at all"), []);
  assert.deepEqual(parseClips(null), []);
});

test("assistantText reads both Workers AI response shapes", async () => {
  const { assistantText } = await import("../src/grounding.ts");
  assert.equal(assistantText({ response: "hello" }), "hello");
  assert.equal(assistantText({ choices: [{ message: { content: "hello" } }] }), "hello");
  assert.equal(assistantText("hello"), "hello");
  assert.equal(assistantText({}), "");
});

test("a reasoning model's thinking is never mistaken for its answer", async () => {
  const { assistantText } = await import("../src/grounding.ts");
  // reasoning_content is the model thinking aloud. Parsing it would let
  // half-formed working reach the user as if it were the result.
  const res = {
    choices: [{ message: { content: '{"clips":[]}', reasoning_content: "Let me think... maybe 5 clips" } }],
  };
  assert.equal(assistantText(res), '{"clips":[]}');
});

test("parseClips unwraps the chat-completion shape end to end", () => {
  const res = { choices: [{ message: { content: '{"clips":[{"start_ms":0,"end_ms":5000}]}' } }] };
  assert.deepEqual(parseClips(res), [{ start_ms: 0, end_ms: 5000 }]);
});
