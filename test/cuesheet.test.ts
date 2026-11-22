/**
 * THE CUE SHEET, AND THE LABEL NOBODY ASKED FOR.
 *
 * Phase 6's acceptance: "an export with a generated segment carries the label
 * and the cue-sheet entry WITHOUT USER ACTION". So the test that matters is
 * the one at the bottom, which walks a generated beat all the way to a render
 * plan without passing anything anywhere that mentions a label.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cueSheet, cueSheetText, labelFor, isPictureBeat, type CueBeat } from "../src/cuesheet.ts";
import { buildBlocks, type BeatLike } from "../src/blocks.ts";
import { buildEdl, buildRenderPlan } from "../src/edl.ts";

const beat = (over: Partial<BeatLike> & { kind: string }): BeatLike => ({
  id: "b1",
  idx: 0,
  text: "The rent line on the chart",
  dur_ms: 4000,
  media_r2_key: null,
  clip_id: null,
  ...over,
});

const cue = (over: Partial<CueBeat> & { kind: string }): CueBeat => ({
  id: "b1",
  text: "The rent line on the chart",
  ...over,
});

test("the kind sets the label, and most kinds have none", () => {
  /* A label on everything is a label on nothing: it marks the exception. */
  assert.equal(labelFor("generated"), "Generated");
  assert.equal(labelFor("stock"), "Illustration");
  assert.equal(labelFor("clip"), null);
  assert.equal(labelFor("vo"), null);
  assert.equal(labelFor("react"), null);
  assert.equal(labelFor("nonsense"), null);
});

test("a generated picture and a stock clip are not the same claim", () => {
  /*
   * Block.origin maps both to "generated", which is one value too few: an AI
   * picture needs the label the law asks for and somebody else's footage
   * needs a credit. If these two ever come back equal, the distinction the
   * label exists to make has been lost upstream.
   */
  assert.ok(isPictureBeat("generated") && isPictureBeat("stock"));
  assert.notEqual(labelFor("generated"), labelFor("stock"));
});

test("a generated beat with nothing behind it says so", () => {
  /* The picture supply does not exist yet. A cue sheet that implied an asset
     had been generated would be the document lying in the direction that
     matters most. */
  const [e] = cueSheet([cue({ kind: "generated" })]);
  assert.equal(e.label, "Generated");
  assert.match(e.how, /Nothing generated for it yet/);
  assert.equal(e.when, null, "nothing made means nothing to date");
});

test("a generated picture with an asset records how and when", () => {
  const [e] = cueSheet([
    cue({ kind: "generated", media_r2_key: "u/1/b/gen.png", recorded_at: Date.UTC(2026, 9, 21) }),
  ]);
  assert.match(e.how, /not photoreal, and never the proof of anything/);
  assert.equal(e.when, "2026-10-21");
});

test("a stock clip names whose footage it is, where that is known", () => {
  const [named] = cueSheet([
    cue({ kind: "stock", media_r2_key: "k", source_title: "Council meeting, March" }),
  ]);
  assert.match(named.how, /Council meeting, March/);
  const [anon] = cueSheet([cue({ kind: "stock", media_r2_key: "k" })]);
  assert.match(anon.how, /Someone else's footage\.$/);
});

test("the maker's own words are what it says the picture is for", () => {
  /* Invariant 10. The beat's text beats anything composed here. */
  const [e] = cueSheet([cue({ kind: "generated", text: "  A map of the two streets  " })]);
  assert.equal(e.what, "A map of the two streets");
  const [blank] = cueSheet([cue({ kind: "generated", text: "   " })]);
  assert.equal(blank.what, "(no description)");
});

test("a struck picture is not in the cue sheet, because it is not in the file", () => {
  /*
   * Nothing is deleted (invariant 6) and a struck beat is still on the page
   * struck through. But a cue sheet is a document about the FILE, and listing
   * a picture the viewer cannot see is the mirror of the failure it exists to
   * prevent.
   */
  assert.deepEqual(cueSheet([cue({ kind: "generated", struck: true })]), []);
  assert.equal(cueSheet([cue({ kind: "generated", struck: false })]).length, 1);
});

test("only pictures reach the cue sheet, in cut order", () => {
  const entries = cueSheet([
    cue({ id: "a", kind: "vo" }),
    cue({ id: "b", kind: "generated" }),
    cue({ id: "c", kind: "clip" }),
    cue({ id: "d", kind: "stock", media_r2_key: "k" }),
  ]);
  assert.deepEqual(entries.map((e) => e.beatId), ["b", "d"]);
});

test("a cut with no pictures gets a document that says so", () => {
  /* Not a 404. "There are none" is an answer somebody may have to show. */
  const text = cueSheetText([], "Four weeks in");
  assert.match(text, /Four weeks in/);
  assert.match(text, /every frame of this cut is the maker's own footage/);
});

test("the document is readable, numbered, and carries no score", () => {
  const text = cueSheetText(cueSheet([
    cue({ id: "b", kind: "generated" }),
    cue({ id: "d", kind: "stock", media_r2_key: "k", source_title: "Open council video" }),
  ]), "Four weeks in");
  assert.match(text, /1\. Generated/);
  assert.match(text, /2\. Illustration/);
  assert.match(text, /What:/);
  assert.match(text, /How:/);
  assert.match(text, /When:/);
  /* Invariant 3. A cue sheet is read by a person who is deciding something. */
  assert.doesNotMatch(text, /\d+%|\bscore\b|\bconfidence\b/i);
});

test("an export with a generated segment carries the label and the entry, unasked", () => {
  /*
   * THE ACCEPTANCE TEST. One generated beat, walked from the beat table to
   * the render plan. Nothing below is passed a label, asked for a label, or
   * configured to want one: buildBlocks takes segments and beats, buildEdl
   * takes blocks, buildRenderPlan takes a format and an aspect. The label
   * arrives because the beat's kind implies it.
   */
  const b = beat({ kind: "generated", media_r2_key: "u/1/b/gen.png", text: "A map of the two streets" });

  const blocks = buildBlocks({ segments: [], beats: [b], cuts: [] });
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].label, "Generated", "the block came out of buildBlocks labelled");

  const edl = buildEdl("", blocks, []);
  assert.equal(edl.cuts.length, 1);
  assert.equal(edl.cuts[0].label, "Generated", "and the label reached the edit list");

  const plan = buildRenderPlan(edl, "mp4_1080", "16:9", "None", false);
  assert.equal(plan.cuts[0].label, "Generated", "and the render plan the container reads");

  /* And the document, from the same beat, with no second source of truth. */
  const [entry] = cueSheet([{ id: b.id, kind: b.kind, text: b.text, media_r2_key: b.media_r2_key }]);
  assert.equal(entry.label, plan.cuts[0].label, "the file and the cue sheet agree on the label");
  assert.equal(entry.what, "A map of the two streets");
});

test("the maker's own footage reaches the render plan with no label on it", () => {
  /* The other half of "it marks the exception": a voice beat is the maker's
     own and carries nothing. If this ever gains a label, the one on the
     generated segment stops meaning anything. */
  const blocks = buildBlocks({
    segments: [],
    beats: [beat({ id: "v", kind: "vo", media_r2_key: "u/1/b/take.webm" })],
    cuts: [],
  });
  assert.equal(blocks[0].label, null);
  const plan = buildRenderPlan(buildEdl("", blocks, []), "mp4_1080", "16:9", "None", false);
  assert.ok(!("label" in plan.cuts[0]), "the field is left off entirely, not set to null");
});
