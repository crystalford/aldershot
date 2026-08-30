import { test } from "node:test";
import assert from "node:assert/strict";

import { buildSummary } from "../src/ui/pages/build.ts";

const beat = (o: Partial<{ kind: string; media_r2_key: string | null; clip_id: string | null }> = {}) => ({
  kind: "clip",
  media_r2_key: null,
  clip_id: null,
  ...o,
});

test("an empty project has not been started, not finished", () => {
  assert.equal(buildSummary([]), "nothing laid down yet.");
});

test("a beat with everything on it counts as filled", () => {
  const beats = [beat({ clip_id: "c1" }), beat({ kind: "vo", media_r2_key: "r2/a.mp3" })];
  assert.equal(buildSummary(beats), "every beat is filled.");
});

test("what is missing is named in the prototype's own phrasing", () => {
  const beats = [beat({ kind: "vo" }), beat({ kind: "vo" }), beat()];
  assert.equal(buildSummary(beats), "2 voiceovers, 1 clip to go.");
});

test("a reaction project says reactions, not voiceovers", () => {
  assert.equal(buildSummary([beat({ kind: "react" })], "reaction"), "1 reaction to go.");
});

test("the singular is not pluralised", () => {
  assert.equal(buildSummary([beat({ kind: "vo" })]), "1 voiceover to go.");
});

/*
 * A clip beat is filled by having a CLIP, a voice beat by having a RECORDING.
 * Checking media_r2_key on a clip beat would report every matched clip as
 * still missing, since a clip beat never has its own media.
 */
test("a matched clip beat is filled even though it has no media of its own", () => {
  assert.equal(buildSummary([beat({ clip_id: "c1", media_r2_key: null })]), "every beat is filled.");
});

test("a generated visual is outstanding until it has been generated", () => {
  assert.equal(buildSummary([beat({ kind: "generated" })]), "1 visual to go.");
  assert.equal(buildSummary([beat({ kind: "generated", media_r2_key: "r2/v.mp4" })]), "every beat is filled.");
});

test("the three kinds are reported in the prototype's order", () => {
  const beats = [beat({ kind: "generated" }), beat(), beat({ kind: "vo" })];
  assert.equal(buildSummary(beats), "1 voiceover, 1 clip, 1 visual to go.");
});

/*
 * A hand-picked clip has no score, no heat and no reason — a person chose it,
 * a model did not. The type allowed none of those to be null until Script grew
 * a "Make a short" action, which is the first thing in the product that
 * creates a clip without a pass behind it.
 */
test("a hand-picked clip is allowed to have no score", () => {
  const clip: import("../src/grounding.ts").ScoredClip = {
    start_ms: 0,
    end_ms: 1000,
    quote: "a line someone chose",
    why: null,
    score: null,
    heat: null,
  };
  assert.equal(clip.score, null);
  assert.equal(clip.quote, "a line someone chose");
});
