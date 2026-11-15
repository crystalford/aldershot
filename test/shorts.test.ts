/**
 * WOULD THIS LINE STAND ALONE?
 *
 * Phase 5's acceptance: "no short ends mid-sentence or carries an unresolved
 * referent". Both are the same failure from two ends — a clip that needs the
 * video around it is an excerpt, and an excerpt posted on its own is a clip
 * about nothing.
 *
 * Every case here is a sentence somebody could say, because the test is
 * about speech rather than about grammar.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GRADE_NAME,
  TOO_LONG_MS,
  TOO_SHORT_MS,
  grade,
  opening,
  subjectWord,
  problems,
} from "../src/shorts.ts";

const c = (text: string, durationMs = 20_000) => ({ text, durationMs });
const kinds = (text: string, ms?: number) => problems(c(text, ms)).map((p) => p.kind);

/* ── Ends mid-sentence ──────────────────────────────────────────────────── */

test("a line that stops mid-sentence is a long shot", () => {
  /* Reads as a mistake, every time, to everybody. */
  const g = grade(c("I keep pricing it in money because the other price is"));
  assert.equal(g.grade, "long");
  assert.match(g.reason, /stops mid-sentence/);
});

test("a finished sentence ends where it should, however it is punctuated", () => {
  for (const text of [
    "The house has a room that gets sun until four.",
    "Do I actually want this?",
    "I said no!",
    "And then I just… stopped…",
    'He said "it halves the rent."',
  ]) {
    assert.ok(!kinds(text).includes("ends-mid-sentence"), text);
  }
});

test("an empty line is not a short at all", () => {
  assert.deepEqual(kinds("   "), ["ends-mid-sentence"]);
  assert.match(problems(c("  "))[0].reason, /no words/);
});

/* ── The unresolved referent ────────────────────────────────────────────── */

test("a line opening on a pronoun with nothing to point at is a long shot", () => {
  /*
   * THE CLIP'S SUBJECT IS IN THE PART NOBODY IS WATCHING. "He said no" is a
   * clip about a man the viewer has never seen.
   */
  const g = grade(c("He said no, and that was the end of it."));
  assert.equal(g.grade, "long");
  assert.match(g.reason, /opens on “he”/);
});

test("the speaker is on screen, so a self-reference resolves itself", () => {
  /* "I" and "we" are never dangling: the person saying them is the picture. */
  for (const text of [
    "I decided to leave on a Tuesday.",
    "We never talked about it again.",
    "I told him it halves the rent.",
  ]) {
    assert.ok(!kinds(text).includes("dangling-referent"), text);
  }
});

test("a pronoun that is not the first thing said is somebody else's problem", () => {
  /*
   * ONLY THE FIRST WORD IS ASKED ABOUT. A rule that looked at every word of
   * the opening sentence graded "The house has a room THAT gets sun until
   * four" a long shot over a relative pronoun — a sentence that stands on
   * its own perfectly, failed by a rule reaching for grammar it cannot
   * read. What a viewer hears is the first second.
   */
  assert.ok(!kinds("Mum keeps sending photos, and she thinks it is settled.").includes("dangling-referent"));
  assert.ok(!kinds("The house has a room that gets sun until four.").includes("dangling-referent"));
  /* And the other way round: the pronoun first is a clip that opens on a
     mystery, whatever comes after it. */
  assert.ok(kinds("She keeps sending photos. Mum has decided.").includes("dangling-referent"));
});

test("a demonstrative opening is the same problem", () => {
  assert.match(grade(c("That is the whole point of it.")).reason, /opens on “that”/);
  assert.match(grade(c("Those are the ones I would cut.")).reason, /opens on “those”/);
});

test("only the OPENING sentence is asked about", () => {
  /*
   * A pronoun later in a clip points at something the viewer has just
   * heard. Flagging those would flag almost every sentence anybody says.
   */
  assert.ok(!kinds("The house has a room that gets sun. I have thought about it.").includes("dangling-referent"));
});

/* ── Starting part-way through ──────────────────────────────────────────── */

test("opening on a conjunction is survivable, and said", () => {
  /* A viewer joins a thought in progress all the time — it is weaker, not
     broken, so it is Worth a look rather than a Long shot. */
  const g = grade(c("And then the rent halves, apparently."));
  assert.equal(g.grade, "worth");
  assert.match(g.reason, /opens on “and”/);
});

test("a lowercase start is starting part-way through", () => {
  const g = grade(c("halves the rent, which is the part nobody says."));
  assert.equal(g.grade, "worth");
  assert.match(g.reason, /part-way through/);
});

/* ── Length ─────────────────────────────────────────────────────────────── */

test("too short to land, and too long to be a short", () => {
  assert.deepEqual(kinds("It is fine.", TOO_SHORT_MS - 1).filter((k) => k === "too-short"), ["too-short"]);
  assert.deepEqual(kinds("It is fine.", TOO_LONG_MS + 1).filter((k) => k === "too-long"), ["too-long"]);
  /* Never both, and neither in between. */
  assert.deepEqual(kinds("It is fine.", 20_000).filter((k) => k.startsWith("too-")), []);
});

test("length is a format question, not a sense one", () => {
  /* So it downgrades to Worth a look rather than to a Long shot: a
     self-sufficient sentence that runs two minutes is still the sentence. */
  assert.equal(grade(c("The house has a room that gets sun until four.", TOO_LONG_MS + 1)).grade, "worth");
});

/* ── The grade ──────────────────────────────────────────────────────────── */

test("a line with nothing wrong with it is Strong, and says so plainly", () => {
  const g = grade(c("The house has a room that gets sun until four."));
  assert.equal(g.grade, "strong");
  assert.equal(g.reason, "it stands on its own");
  assert.deepEqual(g.problems, []);
});

test("the hard problem wins, and is the reason shown", () => {
  /* Opens on a conjunction AND stops mid-sentence: the second is the one
     that makes it unpostable, so it is the one a person is told. */
  const g = grade(c("and then the rent halves and I lose everyone I would"));
  assert.equal(g.grade, "long");
  assert.match(g.reason, /stops mid-sentence/);
  assert.ok(g.problems.length > 1, "and the rest are still there to read");
});

test("no number reaches any of this", () => {
  /*
   * Invariant 3. The grade is a statement about the problems, not a
   * ranking: nothing here can tell which of two self-sufficient sentences
   * is the better short, and a number pretending otherwise is the thing
   * the invariant forbids.
   */
  const g = grade(c("The house has a room that gets sun until four."));
  assert.deepEqual(Object.keys(g).sort(), ["grade", "problems", "reason"]);
  assert.doesNotMatch(JSON.stringify(g), /\d/);
  assert.deepEqual(Object.values(GRADE_NAME), ["Strong", "Worth a look", "Long shot"]);
});

/* ── The pieces ─────────────────────────────────────────────────────────── */

test("the opening is the first sentence, or everything when there is one", () => {
  assert.equal(opening("One. Two. Three."), "One.");
  assert.equal(opening("No full stop here"), "No full stop here");
  assert.equal(opening("  Spaced out?  Then more."), "Spaced out?");
});

test("the subject is the first word, past a conjunction if there is one", () => {
  assert.equal(subjectWord("He said no."), "he");
  /* "And he said no" opens on "and" and is ABOUT "he". Both are problems
     and the second is the one that makes it unwatchable, so the
     conjunction is stepped over rather than hiding what is behind it. */
  assert.equal(subjectWord("And he said no."), "he");
  assert.equal(subjectWord("The house has a room."), "the");
  assert.equal(subjectWord(""), "");
  assert.equal(subjectWord("And"), "and", "a conjunction alone is all there is");
});

test("a clip opening on a conjunction AND a pronoun is told about both", () => {
  const g = grade(c("And he said no, which was that."));
  assert.equal(g.grade, "long", "the pronoun is the hard one");
  assert.deepEqual(
    g.problems.map((p) => p.kind).sort(),
    ["dangling-referent", "starts-mid-sentence"],
  );
  /*
   * AND THE HARD ONE IS WHAT A PERSON IS TOLD, even though the soft one
   * was found first. Reporting problems[0] passed every other test in this
   * file, because everywhere else the hard problem happened to come first
   * in the list.
   */
  assert.match(g.reason, /opens on “he”/);
  assert.doesNotMatch(g.reason, /opens on “and”/);
});
