/**
 * REACTION PLACEMENT, WHICH HAD NO TESTS AND A TIME FIELD IN ITS SCHEMA.
 *
 * Two schemas in this codebase let a model answer with a millisecond —
 * src/score.ts and this one — and of the two only this one had nothing
 * testing it at all. What held invariant 2 here was a line in the PROMPT:
 * "start_ms and end_ms MUST come from the ranges shown. Never invent a
 * timecode." The grounding call underneath it could have been deleted and
 * every test in the repo would still have passed.
 *
 * So these tests drive placeReactions with a model that does the opposite of
 * what it was asked, and assert on what comes out the far side. The `times`
 * rule in the gate pins the other half: a schema with a time field in a file
 * that does not ground it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { placeReactions } from "../src/reactions.ts";
import type { Segment } from "../src/sources.ts";

const seg = (idx: number, start_ms: number, end_ms: number, text: string): Segment => ({
  id: "s" + idx,
  source_id: "src1",
  idx,
  start_ms,
  end_ms,
  speaker: null,
  text,
  words: null,
});

/* Five seconds each, so a model's tight range inside one of them has a long
   way to travel when it is snapped to the segment's own edges. */
const SEGMENTS = [
  seg(0, 0, 5000, "He says the quiet part first."),
  seg(1, 5000, 10000, "Then he says it again, louder."),
  seg(2, 10000, 15000, "And then he denies having said it."),
];

/** A model that returns exactly this, whatever it was asked. */
const env = (clips: unknown[]) =>
  ({
    AI: { run: async () => ({ response: JSON.stringify({ clips }) }) },
  }) as never;

test("ACCEPTANCE: an invented timecode produces no beat at all", async () => {
  /*
   * The whole point. A range the transcript does not contain is dropped
   * rather than clamped — clamping would turn a hallucination into a clip
   * that looks exactly like a real one, and a creator would read a drafted
   * line about footage that does not exist.
   */
  const { beats } = await placeReactions(
    env([{ start_ms: 900_000, end_ms: 999_999, why: "x", score: 90, say: "LINE ABOUT NOTHING" }]),
    SEGMENTS,
    "this clip",
  );
  assert.deepEqual(beats, []);
});

test("ACCEPTANCE: the range on the beat is the transcript's, never the model's", async () => {
  const { beats } = await placeReactions(
    env([{ start_ms: 1234, end_ms: 7777, why: "x", score: 90, say: "something" }]),
    SEGMENTS,
    "this clip",
  );
  const clip = beats.find((b) => b.kind === "clip")!;
  /* 1234–7777 touches the first two segments, so the beat is 0–10000: the
     edges of the words themselves. Neither number the model typed survives. */
  assert.equal(clip.start_ms, 0);
  assert.equal(clip.end_ms, 10_000);
});

test("the quote is the transcript's text, not the model's", async () => {
  const { beats } = await placeReactions(
    env([{ start_ms: 100, end_ms: 4000, quote: "A SENTENCE HE NEVER SAID", why: "x", score: 1, say: "ok" }]),
    SEGMENTS,
    "this clip",
  );
  assert.equal(beats[0].quote, "He says the quiet part first.");
});

test("ACCEPTANCE: a drafted line stays with the clip it was written for", async () => {
  /*
   * THE DEFECT THIS TEST WAS WRITTEN FOR, and it is not the timestamp.
   *
   * The drafted lines used to be matched back to clips by the model's OWN
   * start_ms, with a two-second fallback to the nearest draft. Both of these
   * ranges are tight and sit near the end of their segment, so grounding
   * moves each start by about five seconds — further than the fallback would
   * reach. The old pairing therefore threw the first line away and handed
   * the second clip the FIRST clip's line: a confident sentence about the
   * wrong footage, which reads exactly like a sentence about the right
   * footage.
   *
   * Nothing about the timestamps was wrong in that bug. That is why it
   * survived: invariant 2 was holding, and the words were not.
   */
  const { beats } = await placeReactions(
    env([
      { start_ms: 4800, end_ms: 4900, why: "x", score: 90, say: "FIRST LINE" },
      { start_ms: 5100, end_ms: 5200, why: "x", score: 90, say: "SECOND LINE" },
    ]),
    SEGMENTS,
    "this clip",
  );

  assert.deepEqual(
    beats.map((b) => (b.kind === "clip" ? `clip ${b.start_ms}-${b.end_ms}` : `say ${b.say}`)),
    ["clip 0-5000", "say FIRST LINE", "clip 5000-10000", "say SECOND LINE"],
  );
});

test("a clip the model drafted no line for gets an empty one, not another clip's", async () => {
  const { beats } = await placeReactions(
    env([
      { start_ms: 100, end_ms: 200, why: "x", score: 90 },
      { start_ms: 10_100, end_ms: 10_200, why: "x", score: 90, say: "THE SECOND ONE" },
    ]),
    SEGMENTS,
    "this clip",
  );
  assert.deepEqual(
    beats.map((b) => (b.kind === "clip" ? `clip ${b.start_ms}` : `say ${JSON.stringify(b.say)}`)),
    ['clip 0', 'say ""', "clip 10000", 'say "THE SECOND ONE"'],
  );
});

test("prose instead of JSON lays out nothing rather than throwing", async () => {
  const { beats, model } = await placeReactions(
    ({ AI: { run: async () => ({ response: "I'd stop it around the one minute mark." }) } }) as never,
    SEGMENTS,
    "this clip",
  );
  assert.deepEqual(beats, []);
  /* The call happened and is still charged for; the model is named so the
     cost line can say what it was spent on. */
  assert.ok(model.length > 0);
});

test("nothing to react to is answered without a model call", async () => {
  let called = false;
  const { beats, model } = await placeReactions(
    ({ AI: { run: async () => ((called = true), { response: "{}" }) } }) as never,
    [],
    "this clip",
  );
  assert.deepEqual(beats, []);
  assert.equal(model, "");
  assert.equal(called, false);
});

test("invariant 10: the genre word in the brief never reaches the writer", async () => {
  let sent = "";
  await placeReactions(
    ({
      AI: {
        run: async (_m: string, input: { messages: { role: string; content: string }[] }) => {
          sent = input.messages.map((m) => m.content).join("\n");
          return { response: '{"clips":[]}' };
        },
      },
    }) as never,
    SEGMENTS,
    "make a reaction video about the press conference",
  );
  assert.ok(sent.includes("the press conference"), "the user's own words survive");
  assert.ok(!/reaction video/i.test(sent), "the costume does not");
});
