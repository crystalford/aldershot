/**
 * WHICH JOB THIS LINE'S PICTURE HAS.
 *
 * Doc 08, step one, and the one part of the picture framework that needs a
 * model. Everything downstream of it is already built: the move sets the
 * source order and what is forbidden (src/pictures.ts), so getting a move
 * wrong in the permissive direction is how a generated picture ends up
 * over somebody's proof.
 *
 * Which is why the failure mode of this file is "it held on the speaker".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLASSIFY_VERSION,
  UNSURE,
  WHY_CHARS,
  knownMove,
  parseMoves,
  shortIds,
  usableWhy,
  userPrompt,
  type Line,
} from "../src/classify.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MOVE_RULES, allowed } from "../src/pictures.ts";

const lines: Line[] = [
  { id: "01HAAA1", text: "The rent halves if I go, and I lose everyone." },
  { id: "01HAAA2", text: "It says here: twelve hundred a month." },
];
const ids = shortIds(lines);
const answer = (rows: unknown) => parseMoves({ lines: rows }, lines, ids, "m/test");

/* ── The half that is not a model call ──────────────────────────────────── */

test("housekeeping is a transition, and nothing asks a model", () => {
  /*
   * The patterns have been in src/moment-tags.ts since the first scoring
   * pass and are trusted elsewhere. The house rule is that anything which
   * can be a measurement is not a model call.
   */
  const k = knownMove("Okay is this recording? Mic check.");
  assert.equal(k?.move, "transition");
  assert.match(k!.why, /housekeeping/);
  assert.equal(knownMove("   ")?.move, "transition");
});

test("a real line is not guessed at by a regex", () => {
  /*
   * A longer list of clever guesses here would be the gavel problem one
   * level up: a rule matching nouns, deciding what a picture may be.
   */
  assert.equal(knownMove("The rent halves if I go."), null);
  assert.equal(knownMove("It says here: twelve hundred a month."), null);
});

/* ── The default ────────────────────────────────────────────────────────── */

test("an unanswered line is the most restrictive move there is", () => {
  /*
   * THE WHOLE SAFETY ARGUMENT. A move decides what a picture may be, so an
   * unknown line must not land on one that allows a generated picture.
   */
  const got = answer([]);
  assert.equal(got.length, 2);
  assert.ok(got.every((g) => g.move === UNSURE));

  /* And that move must actually be the restrictive one — a rename or a
     reshuffle in pictures.ts could quietly make this permissive. */
  assert.deepEqual([...MOVE_RULES[UNSURE].wants], ["own"]);
  assert.ok(allowed(UNSURE, { id: "g", source: "generated", kind: "synthetic" }).reason);
});

test("a move nobody recognises falls back rather than being believed", () => {
  const [a] = answer([{ line: "l1", move: "vibes" }]);
  assert.equal(a.move, UNSURE);
});

/* ── The answer ─────────────────────────────────────────────────────────── */

test("a move and a reason come back against the right line", () => {
  const got = answer([
    { line: "l2", move: "evidence", why: "a figure read off a page" },
    { line: "l1", move: "claim", why: "asserts a trade" },
  ]);
  assert.deepEqual(got.map((g) => [g.id, g.move]), [
    ["01HAAA1", "claim"],
    ["01HAAA2", "evidence"],
  ]);
  assert.equal(got[1].why, "a figure read off a page");
  assert.equal(got[0].version, CLASSIFY_VERSION);
});

test("the prompt sends short ids, never the real ones", () => {
  /* Asked to copy a 26-character ULID, these models describe the right row
     and mistype the reference — measured in this codebase. */
  const p = userPrompt(lines, ids);
  assert.match(p, /l1: The rent halves/);
  assert.doesNotMatch(p, /01HAAA/);
});

test("an answer about a line we never sent is dropped", () => {
  const got = answer([{ line: "l9", move: "context", why: "about nowhere" }]);
  assert.ok(got.every((g) => g.move === UNSURE && g.why === null));
});

test("two answers about one line keep the first", () => {
  const got = answer([
    { line: "l1", move: "evidence" },
    { line: "l1", move: "joke" },
  ]);
  assert.equal(got[0].move, "evidence");
});

test("an answer that is not JSON loses the opinion, not the lines", () => {
  const got = parseMoves("I cannot help with that", lines, ids, "m/test");
  assert.equal(got.length, 2);
  assert.ok(got.every((g) => g.move === UNSURE));
});

/* ── The reason ─────────────────────────────────────────────────────────── */

test("a reason that quotes the line back is not a reason", () => {
  assert.equal(usableWhy("the rent halves if I", lines[0].text), false);
  assert.equal(usableWhy("asserts a trade", lines[0].text), true);
  assert.equal(usableWhy("x".repeat(WHY_CHARS + 1), lines[0].text), false);
  assert.equal(usableWhy("", lines[0].text), false);
});

test("an unusable reason is dropped and the move survives it", () => {
  const [a] = answer([{ line: "l1", move: "joke", why: "the rent halves if I" }]);
  assert.equal(a.move, "joke", "the move is the answer; the reason is the explanation");
  assert.equal(a.why, null);
});

/* ── What a person decided ──────────────────────────────────────────────── */

test("a line a rule answered is marked certain, and a model's is not", () => {
  /*
   * The distinction matters downstream: a move a regex knows is a fact
   * about the words, and one a model offered is an opinion about them.
   */
  const [a] = answer([{ line: "l1", move: "claim" }]);
  assert.equal(a.certain, false);
  assert.equal(knownMove("Mic check, is this recording?")?.move, "transition");
});

/* ── Where the refusal actually bites ───────────────────────────────────── */

test("the insert route is where a picture that is not yours enters a cut", () => {
  /*
   * `generated` and `stock` are two of the five kinds the beat insert
   * accepts, so this is the one place invariant 8 can bite today — and the
   * line it lands against decides whether it may.
   *
   * Read off the source: the route needs a project and a model to drive,
   * and what is being pinned is that the check is THERE and refuses in the
   * right direction. The arithmetic it calls is tested above and in
   * test/pictures.test.ts.
   */
  const src = readFileSync(join(import.meta.dirname, "..", "src", "index.ts"), "utf8");
  const route = src.slice(src.indexOf('app.post("/api/projects/:id/beats"'));
  const upto = route.slice(0, route.indexOf("return c.json({ beats })"));

  assert.match(upto, /kind === "generated" \|\| kind === "stock"/, "the two kinds that are not your footage");
  assert.match(upto, /allowed\(move, \{/, "and the refusal is the one in pictures.ts");
  assert.match(upto, /return c\.json\(\{ error: r\.reason \}, 422\)/, "refused with the reason, not a code");
  /* A depiction needs an ANSWER: the permission comes from `answered`,
     never from having a move, because UNSURE is a move too. */
  assert.match(upto, /known = found\.answered;/);
  assert.match(upto, /\{ depict: known \}/);
  assert.match(upto, /over_claim: overClaim/, "and what it decided is stored with the beat, for the label");
  /* The catch leaves `move` at UNSURE rather than letting it through. */
  assert.match(upto, /let move: Move = UNSURE;/);
  assert.doesNotMatch(upto, /catch[\s\S]{0,80}move = /, "a failed classification must not become a permission");
});

test("a skipped line, or a move that doesn't exist, comes back UNSURE and NOT answered", () => {
  /* So it can never grant a depiction: UNSURE is `claim`, and a claim the
     model never said is a claim nobody knows about. */
  const [said, nonsense] = answer([{ line: "l1", move: "claim" }, { line: "l2", move: "verdict" }]);
  assert.deepEqual([said.move, said.answered], ["claim", true]);
  assert.deepEqual([nonsense.move, nonsense.answered], [UNSURE, false]);
  const [, skipped] = answer([{ line: "l1", move: "claim" }]);
  assert.deepEqual([skipped.move, skipped.answered], [UNSURE, false]);
});

test("the default refuses both kinds the route can insert", () => {
  /* With nothing classified every line is UNSURE, and both a generated
     card and a stock clip are refused against it. The refusal gets LESS
     restrictive as classification runs, which is the right direction. */
  for (const source of ["generated", "world"] as const) {
    const no = allowed(UNSURE, { id: "x", source, kind: source === "generated" ? "synthetic" : "illustration" });
    assert.ok(no.reason, source);
  }
});
