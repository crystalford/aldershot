/**
 * THE WRITER FIREWALL.
 *
 * labs/FORMATS.md specified "a deterministic lint, not a model: a maintained
 * stoplist of genre markers" and nothing built it, so invariant 10 — "the
 * genre word never reaches the writer" — was enforced by nobody for the whole
 * life of this repository. It was also broken BY us: src/plan.ts opened its
 * system prompt with "You are planning a video essay".
 *
 * Half of these tests are about the invariant's second half, which is the one
 * a stoplist is most likely to break: "the user's own words win where they
 * exist". A rule that strips a genre word wherever it appears hands the writer
 * a sentence its author did not write.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { plainRegister, teaserMarkers } from "../src/register.ts";

test("the costume comes off the front of the ask, and is kept", () => {
  for (const [typed, said, genre] of [
    ["make me a video essay about NASA", "NASA", "video essay"],
    ["Make a documentary about the river", "the river", "documentary"],
    ["can you cut a supercut of every time he says it", "every time he says it", "supercut"],
    ["a reaction to the council meeting", "a reaction to the council meeting", null],
    ["explainer: how orbits actually work", "how orbits actually work", "explainer"],
    ["the documentary on what happened at the plant", "what happened at the plant", "documentary"],
  ] as Array<[string, string, string | null]>) {
    const got = plainRegister(typed);
    assert.equal(got.said, said, `said, for ${JSON.stringify(typed)}`);
    assert.equal(got.genre, genre, `genre, for ${JSON.stringify(typed)}`);
  }
});

/*
 * THE ONE THAT MATTERS.
 *
 * Every one of these NAMES a genre and is not asking for one. Stripping here
 * would mangle somebody's subject in the name of protecting the writer from
 * it — invariant 10's first half eating its second.
 */
test("a genre word that is the subject survives untouched", () => {
  for (const typed of [
    "why every explainer sounds the same",
    "make a case that the reaction economy is over",
    "the montage is the most dishonest edit there is",
    "what a vlog does to the person making it",
  ]) {
    const got = plainRegister(typed);
    assert.equal(got.said, typed, `${JSON.stringify(typed)} was altered`);
    assert.equal(got.genre, null, `${JSON.stringify(typed)} was read as a genre request`);
  }
});

test("the longest label wins, so 'video essay' is not read as 'video'", () => {
  const got = plainRegister("make a video essay about the launch");
  assert.equal(got.genre, "video essay");
  assert.equal(got.said, "the launch");
});

/*
 * A SUBJECT THAT IS ITSELF A GENRE WORD STILL SURVIVES.
 *
 * "a video about how documentaries lie" IS "a video about <subject>" — the
 * framing is real and comes off, and the point is that the genre word in the
 * SUBJECT is untouched. The first version of this test demanded the whole
 * string be left alone, which would have meant never stripping the commonest
 * framing there is.
 */
test("stripping the frame does not take a genre word out of the subject", () => {
  const got = plainRegister("a video about how documentaries lie");
  assert.equal(got.said, "how documentaries lie");
  assert.equal(got.genre, "video");
});

test("with no subject, nothing is stripped and nothing is claimed", () => {
  /* Every frame ends in \s+, so it cannot match without something after it.
     With no subject there is no way to tell the framing from the thing. */
  const got = plainRegister("make a documentary about");
  assert.equal(got.said, "make a documentary about");
  assert.equal(got.genre, null);
});

/* ---- the output half ---- */

test("every teaser on the list is found, with the sentence to regenerate", () => {
  const draft =
    "In a world where nobody checks. The council moved the date. " +
    "But what happened next is the part that matters. Buckle up.";
  const found = teaserMarkers(draft);
  const hits = found.map((m) => m.found.toLowerCase());
  assert.ok(hits.includes("in a world"), `missed "in a world": ${JSON.stringify(hits)}`);
  assert.ok(hits.includes("but what happened next"));
  assert.ok(hits.includes("buckle up"));
  /* FORMATS says "regenerate that sentence only", so each hit carries one. */
  for (const m of found) {
    assert.ok(m.sentence.length, "a marker with no sentence cannot be regenerated");
    assert.ok(m.why.length, "a lint that only says no gets switched off");
  }
  /* And the honest sentence in the middle is not among them. */
  assert.ok(!found.some((m) => m.sentence.includes("The council moved the date")));
});

test("only the sign-off question is a tic, not a question mid-argument", () => {
  const mid = "So who moved it? The clerk did, on the Tuesday.";
  assert.deepEqual(teaserMarkers(mid), [], `flagged a rhetorical move: ${JSON.stringify(teaserMarkers(mid))}`);

  const end = "The clerk moved it on the Tuesday. So what does that tell us?";
  const found = teaserMarkers(end);
  assert.equal(found.length, 1);
  assert.equal(found[0].found, "?");
});

test("plain prose trips nothing", () => {
  const honest =
    "The council moved the date before the review came in. The clerk's own email says so. " +
    "Nobody has explained why.";
  assert.deepEqual(teaserMarkers(honest), []);
});
