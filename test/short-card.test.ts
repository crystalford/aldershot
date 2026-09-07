/**
 * What a short's card is allowed to say.
 *
 * Two of these are bugs the surface actually shipped with. The green **0** on
 * a clip you chose yourself is the one the editor already fixed once ("a zero
 * is not a verdict, it is the absence of one") and Clipping kept — and the
 * route that creates those clips says the same in its own comment: a manual
 * clip "has no score… without pretending a model picked it."
 *
 * The other is what trimming leaves behind: a finished video of boundaries
 * that no longer exist, under a card still offering Download.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderClipping, type ShortRow } from "../src/ui/pages/clipping.ts";

const short = (over: Partial<ShortRow> = {}): ShortRow => ({
  id: "c1",
  start_ms: 127_000,
  end_ms: 157_000,
  quote: "But the fear. But the fear.",
  why: null,
  score: 74,
  kept: 0,
  frame_r2_key: "",
  origin: "clipping",
  sourceKey: "u/1/sources/1/original.mp4",
  sourceTitle: "Kino Casino #372",
  render: null,
  ...over,
});

const SOURCE = {
  id: "s1",
  title: "Kino Casino #372",
  duration_s: 2880,
  transcript_state: "ready",
  poster_r2_key: "poster.jpg",
  clip_count: 11,
};

/* With a video picked. Clipping is a verb: /clipping on its own is the picker,
   and cards only exist once you have pointed it at something. */
const page = (over: Partial<ShortRow> = {}) =>
  renderClipping({ source: SOURCE, available: [SOURCE], shorts: [short(over)], job: null, fromEditor: false });

const ready = (over: Partial<NonNullable<ShortRow["render"]>> = {}) => ({
  id: "r1",
  state: "ready",
  r2_key: "u/1/renders/r1.mp4",
  error: null,
  duration_s: 30,
  ...over,
});

test("a scored short wears its score", () => {
  assert.match(page({ score: 74 }), />74</);
});

test("a clip you picked yourself never wears a green nought", () => {
  const html = page({ score: 0, origin: "manual", why: "You picked this one." });
  assert.doesNotMatch(html, />0</, "it rendered a score of 0");
  assert.match(html, /Yours/);
  assert.match(html, /Not scored/);
});

test("an unscored clip that is not yours says nothing rather than zero", () => {
  const html = page({ score: null, origin: "clipping" });
  assert.doesNotMatch(html, />0</);
  assert.doesNotMatch(html, /Yours/);
});

test("every card paints its own moment, not the video's first frame", () => {
  /* frame_r2_key is the SOURCE's poster, so all of one video's clips wore the
     same image — black, on both of the owner's files. */
  const html = page({ start_ms: 127_000 });
  assert.match(html, /class="short-frame"[^>]*data-at="127000"/);
});

test("a made short plays, and can be downloaded", () => {
  const html = page({ render: ready() });
  /* The video and a bar to drive it. The bar finds its video by being next to
     it, so there is no marker class to assert on any more — which is the
     point: a fifth surface works without a fifth special case. */
  assert.match(html, /<video[^>]+\/media\/u\/1\/renders\/r1\.mp4/);
  assert.match(html, /class="player"/);
  assert.match(html, /Download/);
  /* Scoped to the card's own button: the sheet carries a "Make the video" of
     its own, which is a different control on a different surface. */
  assert.doesNotMatch(html, /class="make-short"/);
});

test("it does not hand the browser's own controls to a 9:16 card", () => {
  assert.doesNotMatch(page({ render: ready() }), /<video[^>]*\scontrols/);
});

test("a short you trimmed since rendering does not offer the old video", () => {
  /* 30s of file under a clip that now claims 12s is a video of boundaries
     that no longer exist. */
  const html = page({ start_ms: 0, end_ms: 12_000, render: ready({ duration_s: 30 }) });
  assert.doesNotMatch(html, /Download/);
  assert.match(html, /You trimmed this/);
  assert.match(html, /class="make-short"/);
});

test("an encoder landing a frame either side is not a trim", () => {
  const html = page({ start_ms: 0, end_ms: 30_400, render: ready({ duration_s: 30 }) });
  assert.match(html, /Download/);
  assert.doesNotMatch(html, /You trimmed this/);
});

test("a card says how long the short is, made or not", () => {
  assert.match(page({ start_ms: 0, end_ms: 30_000 }), />0:30</);
  assert.match(page({ start_ms: 0, end_ms: 30_000, render: ready() }), />0:30</);
});

test("the position in the source is said to be one", () => {
  assert.match(page({ start_ms: 127_000 }), /2:07 in/);
});

test("every short offers the verb the clipper never had", () => {
  assert.match(page(), /class="short-edit"/);
  assert.match(page(), /Edit this short/);
});

test("shape and captions are on the page, so the lede is not a lie", () => {
  /* With no .clip-form present the render request fell back to captionStyle
     "None", under a heading promising "captions burned in". */
  const html = page();
  assert.match(html, /class="clip-form"/);
  assert.match(html, /name="captionStyle"/);
  assert.match(html, /name="aspect"/);
});

test("an empty Clipping offers no sheet and no settings to nothing", () => {
  const html = renderClipping({ source: SOURCE, available: [SOURCE], shorts: [], job: null, fromEditor: false });
  assert.doesNotMatch(html, /id="adjust"/);
  assert.doesNotMatch(html, /class="clip-form"/);
});

test("with no video picked it is the picker, not a library", () => {
  /* The third list of clips in the product, after Footage's. Each nav item
     means one thing: this one is how you turn a video into shorts. */
  const html = renderClipping({ source: null, available: [SOURCE], shorts: [], job: null, fromEditor: false });
  assert.match(html, /Pick a video and it does the rest/);
  assert.match(html, /Drop a video, or clip one you already have/);
  assert.doesNotMatch(html, /data-short=/);
  assert.doesNotMatch(html, /id="adjust"/);
});
