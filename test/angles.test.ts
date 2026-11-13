/**
 * A VIDEO THAT COULD BE MADE, and three of them side by side.
 *
 * The object PASS-4-BRIEF says does not exist: "There is no representation
 * of a video that could be made — and therefore no way to have several,
 * compare them, or rank them." These tests pin the two rules that make the
 * object honest rather than just present.
 *
 * The failures to guard are both quiet. An angle whose backing came from the
 * model would look identical to one that was measured, and would be the one
 * fact the person is choosing on — invented. And a band that crept from
 * "how much of this do you have" to "which of these is better" would be
 * invariant 3 broken at the most expensive moment there is: picking what to
 * spend a week on.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BAND_NAME,
  SLATE_SIZE,
  parseAngles,
  priceAngles,
  verdict,
  type Angle,
} from "../src/angles.ts";

const beat = (need: string, role = "subject") => ({ role, name: need.slice(0, 12), need });

const reply = (angles: unknown) => ({
  response: JSON.stringify({ angles }),
});

const angle = (claim: string, needs: string[]): Angle => ({
  claim,
  take: "because",
  beats: needs.map((n) => ({ role: "subject" as const, name: n.slice(0, 12), need: n })),
});

/* ── Reading the model's answer ───────────────────────────────────────── */

test("a slate comes back with its claims, takes and beats", () => {
  const out = parseAngles(
    reply([
      { claim: "NASA was authored before it was engineered", take: "takes McLuhan at his word", beats: [beat("the agency describing itself")] },
      { claim: "the fiction set the budget", take: "follows the money", beats: [beat("a hearing about cost")] },
    ]),
  );
  assert.equal(out.length, 2);
  assert.equal(out[0].claim, "NASA was authored before it was engineered");
  assert.equal(out[0].take, "takes McLuhan at his word");
  assert.equal(out[0].beats[0].need, "the agency describing itself");
});

test("an angle with no beats is dropped, because it is a sentence not a video", () => {
  /* A slate of sentences is exactly what this object replaces. */
  const out = parseAngles(
    reply([
      { claim: "a real one", take: "t", beats: [beat("something")] },
      { claim: "just a sentence", take: "t", beats: [] },
      { claim: "no beats key at all", take: "t" },
    ]),
  );
  assert.deepEqual(out.map((a) => a.claim), ["a real one"]);
});

test("a beat with no need is dropped; an unknown role becomes subject", () => {
  const out = parseAngles(
    reply([
      {
        claim: "c",
        take: "t",
        beats: [beat("a findable moment", "nonsense"), { role: "counter", name: "x" }],
      },
    ]),
  );
  assert.equal(out[0].beats.length, 1, "the beat with no need should not survive");
  assert.equal(out[0].beats[0].role, "subject");
});

test("an answer that is not JSON is an empty slate, not a crash", () => {
  assert.deepEqual(parseAngles({ response: "I think there are three ways..." }), []);
  assert.deepEqual(parseAngles({}), []);
});

test("a fenced answer is still read", () => {
  const out = parseAngles({
    response: '```json\n{"angles":[{"claim":"c","take":"t","beats":[{"role":"subject","name":"n","need":"a moment"}]}]}\n```',
  });
  assert.equal(out.length, 1);
});

/* ── What it would take, measured ─────────────────────────────────────── */

test("backing is counted from the archive, one lookup per beat", async () => {
  const asked: string[] = [];
  const has = async (need: string) => {
    asked.push(need);
    return need.includes("kitchen");
  };

  const [priced] = await priceAngles([angle("c", ["the kitchen at night", "a rocket launch"])], has);
  assert.deepEqual(asked, ["the kitchen at night", "a rocket launch"]);
  assert.equal(priced.backed, 1);
  assert.equal(priced.missing, 1);
});

test("THE MODEL CANNOT DECLARE ITS OWN ANGLE WELL SUPPORTED", async () => {
  /*
   * The rule this module exists for. If the model's own words could set the
   * backing, the one fact the person is choosing on would be invented — and
   * it would look exactly like a measured one.
   *
   * So a reply that claims to be fully backed, against an archive holding
   * nothing, must come out as holding nothing.
   */
  const boastful = parseAngles(
    reply([
      {
        claim: "c",
        take: "t",
        backed: 8,
        missing: 0,
        band: "strong",
        why: "every beat is covered by your footage",
        beats: [beat("a moment nobody has")],
      },
    ]),
  );
  assert.equal((boastful[0] as unknown as Record<string, unknown>).backed, undefined,
    "the parser must not carry a backing the model wrote");

  const [priced] = await priceAngles(boastful, async () => false);
  assert.equal(priced.backed, 0);
  assert.equal(priced.band, "long");
  assert.match(priced.why, /every one would have to be found/);
});

test("pricing makes no model call at all", () => {
  /*
   * Read from the source, because this is a property of the module rather
   * than of one run: `has` is injected, and the file must not reach for a
   * model to answer "what would this take".
   */
  const src = readFileSync("src/angles.ts", "utf8");
  const after = src.slice(src.indexOf("export async function priceAngles"));
  const body = after.slice(0, after.indexOf("\n}\n"));
  for (const forbidden of ["runRead", "resolveFor", "env.AI"]) {
    assert.ok(!body.includes(forbidden), `priceAngles reached for ${forbidden}`);
  }
});

/* ── The band, and what it is allowed to mean ─────────────────────────── */

test("the band answers how much you have, across the range", () => {
  assert.equal(verdict(6, 6).band, "strong");
  assert.match(verdict(6, 6).why, /all of it/);

  assert.equal(verdict(3, 6).band, "strong", "half is still mostly buildable");
  assert.match(verdict(3, 6).why, /3 of 6 beats/);

  assert.equal(verdict(1, 6).band, "worth");
  assert.match(verdict(1, 6).why, /Scout's work or a camera's/);

  assert.equal(verdict(0, 6).band, "long");
});

test("no beats is a long shot rather than a division by zero", () => {
  const v = verdict(0, 0);
  assert.equal(v.band, "long");
  assert.ok(!v.why.includes("NaN"));
});

test("NO NUMBER REACHES THE USER AS A VERDICT (invariant 3)", () => {
  /*
   * The bands are words, and the sentence beside them is a count of real
   * footage — "3 of 6 beats" is a measurement, which is allowed and is the
   * point. What must never appear is a score, a percentage or a rating:
   * those claim to rank the videos rather than describe what you have.
   */
  for (const [backed, total] of [[6, 6], [3, 6], [1, 6], [0, 6], [0, 0]]) {
    const { band, why } = verdict(backed, total);
    assert.ok(["strong", "worth", "long"].includes(band));
    assert.ok(!/%|\bscore\b|\brating\b|\bconfiden/i.test(why), `a score leaked: ${why}`);
    assert.ok(why.length > 10, "a band with no reason is a score with a word on it");
  }
});

test("the band vocabulary is Shorts', not a second one", () => {
  assert.equal(BAND_NAME.strong, "Strong");
  assert.equal(BAND_NAME.worth, "Worth a look");
  assert.equal(BAND_NAME.long, "Long shot");
});

test("the slate is three, and the prompt asks for what it returns", () => {
  assert.equal(SLATE_SIZE, 3);
  /* A prompt that asked for five while the UI showed three would be two
     numbers disagreeing about the same thing. */
  const src = readFileSync("src/angles.ts", "utf8");
  assert.match(src, /\$\{SLATE_SIZE\} ANGLES/);
});

test("the seed is linked, never fetched (invariant 9)", () => {
  /*
   * A seed can carry a URL. Nothing in this module may go and get it: Scout
   * finds and links, and the one thing this codebase does not do is
   * download what a platform forbids.
   */
  const src = readFileSync("src/angles.ts", "utf8");
  for (const forbidden of ["fetch(", "ytdl", "youtube-dl", "download("]) {
    assert.ok(!src.includes(forbidden), `angles.ts reached for ${forbidden}`);
  }
});
