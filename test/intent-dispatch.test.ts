/**
 * What the sentence actually starts.
 *
 * intentLabel tells the user, in the prototype's own words, "Reads as an
 * essay — five acts, built out of footage you've already kept" or "Reads as a
 * reaction — a project with room between the blocks for your voice". begin()
 * then created a `score` job for every intent, so the product announced what
 * it understood and ran a generic scoring pass regardless — while essay.ts,
 * reactions.ts, their queue handlers and their routes sat unreachable.
 *
 * These pin the mapping from the sentence to the work, because the failure
 * was silent: you got clips, which looks like an answer.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readIntent, intentLabel, INTENT_KIND } from "../src/intent.ts";

test("the sentence is read as the thing it names", () => {
  assert.equal(readIntent("react to the logical fallacies"), "react");
  assert.equal(readIntent("make a video essay about parasocial incentives"), "essay");
  assert.equal(readIntent("three shorts from the best arguments"), "shorts");
  assert.equal(readIntent("tighten my recording"), "tighten");
  assert.equal(readIntent("cut this down to ten minutes"), "compose");
  assert.equal(readIntent("get me every clip where he contradicts himself"), "extract");
});

test("a reaction beats an essay, because 'react to this essay' is a reaction", () => {
  assert.equal(readIntent("react to this video essay"), "react");
});

test("nothing recognisable is never guessed at", () => {
  assert.equal(readIntent("mmm"), "unclear");
  assert.equal(readIntent(""), "compose");
});

/*
 * The label and the work have to agree. This reads the shipped source rather
 * than re-describing it, so a future edit that goes back to always-score
 * fails here instead of shipping.
 */
function beginSource(): string {
  return readFileSync(join(import.meta.dirname, "..", "src", "begin.ts"), "utf8");
}

test("begin dispatches a reaction for a reaction, and an outline for an essay", () => {
  const src = beginSource();
  assert.match(src, /intent === "react"[\s\S]{0,200}type: "reactions"/, "a reaction must run runReactions");
  assert.match(src, /intent === "essay"[\s\S]{0,200}type: "outline"/, "an essay must run runOutline");
  assert.match(src, /intent === "shorts"[\s\S]{0,200}type: "shorts"/, "a shorts run must run runShorts");
});

test("begin dispatches its own work, so no caller can forget or override it", () => {
  const src = beginSource();
  assert.match(src, /await dispatch\(env, ctx,/, "begin owns the dispatch");
  const index = readFileSync(join(import.meta.dirname, "..", "src", "index.ts"), "utf8");
  const beginRoute = index.slice(index.indexOf('app.post("/api/begin"'));
  const body = beginRoute.slice(0, beginRoute.indexOf("\n});"));
  assert.ok(
    !/type: "score"/.test(body),
    "the route must not dispatch a score pass on top of whatever begin already started",
  );
});

test("every intent maps to a kind, or deliberately to none", () => {
  // extract and shorts produce no project: the clips land in Footage and there
  // is nothing to assemble. That is a decision, not a gap.
  assert.equal(INTENT_KIND.extract, null);
  assert.equal(INTENT_KIND.shorts, null);
  assert.equal(INTENT_KIND.react, "reaction");
  assert.equal(INTENT_KIND.essay, "essay");
  for (const k of Object.keys(INTENT_KIND)) {
    assert.ok(k in INTENT_KIND, `${k} needs a kind or an explicit null`);
  }
});

test("the label the user is shown names the same thing", () => {
  assert.match(intentLabel("react to the fallacies"), /reaction/i);
  assert.match(intentLabel("a video essay about this"), /essay/i);
});
