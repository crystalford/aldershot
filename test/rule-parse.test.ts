/**
 * A sentence into rules.
 *
 * `04-RULE-ENGINE.md` lists the patterns and one requirement that matters more
 * than any of them: "A sentence that doesn't parse gets an honest reply listing
 * what does parse — never a silent no-op." A rule that quietly fails to exist
 * is worse than a refusal, because the user watches the cut not change and
 * concludes the product does not work.
 *
 * And the pair that would invert a cut: "keep the hedging" and "lose the
 * hedging" name the same tag and mean opposite things.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRules, honestReply, capText, WHAT_PARSES } from "../src/rule-parse.ts";

const kinds = (s: string) => parseRules(s).rules.map((r) => r.kind).sort();
const first = (s: string, kind: string) => parseRules(s).rules.find((r) => r.kind === kind);

test("a length becomes a cap", () => {
  assert.equal(first("keep it under three minutes", "cap")?.secs, 180);
  assert.equal(first("two minutes on the gym stuff", "cap")?.secs, 120);
  assert.equal(first("a 90 second cut", "cap")?.secs, 90);
  /* And a number that is not a runtime is not one here either — the same
     sanity window targetFromBrief applies, because they share it. */
  assert.ok(!first("cut the 3 second gap at the start", "cap"));
});

test("the verb decides keep or lose, not the noun", () => {
  /*
   * THE ONE THAT WOULD INVERT A CUT.
   *
   * Both of these name `hedge`. Reading the tag and ignoring the verb gives
   * you a cut made of exactly what the user asked to remove, and every moment
   * still has a rule next to it saying it was deliberate.
   */
  assert.equal(first("lose the hedging", "drop")?.tag, "hedge");
  assert.equal(first("keep the hedging", "keep")?.tag, "hedge");
  assert.ok(!first("lose the hedging", "keep"));
  assert.ok(!first("keep the hedging", "drop"));
});

test("one sentence can carry both, read clause by clause", () => {
  /* "Keep the hard lines but take out the hellos" is how people actually
     talk, and reading it whole gets one of the two backwards. */
  const out = parseRules("keep the hard lines but take out the hellos");
  assert.equal(out.rules.find((r) => r.kind === "keep")?.tag, "strong");
  assert.equal(out.rules.find((r) => r.kind === "drop")?.tag, "housekeeping");
});

test("orders parse, and only one of them wins", () => {
  assert.equal(first("as it happened", "order")?.order, "time");
  assert.equal(first("run it one thread at a time", "order")?.order, "strand");
  assert.equal(first("start on the sharpest line", "order")?.order, "open");
  assert.equal(
    parseRules("as it happened, one thread at a time").rules.filter((r) => r.kind === "order").length,
    1,
    "two orders in one sentence is one rule, or the engine gets an arbitrary winner",
  );
});

test("feelings are rules", () => {
  /*
   * This is the part that makes the conversation an editing interface rather
   * than a chat window. "The start drags" is not a complaint to interpret —
   * it is an order rule. The MAPPING is a judgement, which is exactly why it
   * is written down here rather than left inside a prompt.
   */
  assert.equal(first("the start drags", "order")?.order, "open");
  assert.equal(first("it's hard to follow", "order")?.order, "strand");
  assert.equal(first("make it tighter", "cap")?.secs, 180);
  assert.equal(first("this is too long", "cap")?.secs, 180);
});

test("an explicit length beats the feeling that implies one", () => {
  /* "Too long, keep it under 90 seconds" must not produce two caps, and the
     one it produces must be the one they actually said. */
  const out = parseRules("this is too long, keep it under 90 seconds");
  const caps = out.rules.filter((r) => r.kind === "cap");
  assert.equal(caps.length, 1);
  assert.equal(caps[0].secs, 90);
});

test("a sentence that carries no rule says so", () => {
  /*
   * NEVER A SILENT NO-OP. A brief is mostly subject matter — "the bits about
   * the gym" is a perfectly good brief and contains no rule — so the reply
   * has to distinguish "nothing to change" from "I did not understand", and
   * then say what WOULD work.
   */
  const out = parseRules("the bits about the gym");
  assert.equal(out.rules.length, 0);
  assert.deepEqual(out.unparsed, ["the bits about the gym"]);

  const reply = honestReply(out.unparsed);
  assert.ok(reply && reply.length > 20);
  assert.match(reply, /under three minutes/, "it names a real example, not a category");
  assert.equal(honestReply([]), null, "and says nothing when something did parse");
  assert.ok(WHAT_PARSES.length >= 4);
});

test("a sentence that parses reports nothing unparsed", () => {
  /* Listing every clause that was not a rule would be noise on a sentence
     that worked — "two minutes on the gym" is a length AND a subject. */
  const out = parseRules("two minutes on the gym stuff, one thread at a time");
  assert.deepEqual(out.unparsed, []);
  assert.deepEqual(kinds("two minutes on the gym stuff, one thread at a time"), ["cap", "order"]);
});

/**
 * A RULE HAS TO SAY WHAT IT DOES.
 *
 * "keep it under 30 seconds" made a cap of 30 seconds and called itself
 * "Keep it under 1 minute." — the text rounded to whole minutes and `|| 1`
 * floored every sub-minute cap at one. The rule was right and its own name
 * was wrong, which is the worst way round: invariant 1 makes the rules the
 * source of truth, and the person deciding whether to switch one off reads
 * the words, not the seconds.
 *
 * Found by putting the rule in front of somebody to agree to — the
 * composer's Ask mode shows a rule's own text in its proposal.
 */
test("a length rule is named in the unit it was asked for", () => {
  const capOf = (sentence: string) => {
    const r = parseRules(sentence).rules.find((x) => x.kind === "cap");
    assert.ok(r, `"${sentence}" should make a cap`);
    return r;
  };

  const half = capOf("keep it under 30 seconds");
  assert.equal(half.kind === "cap" ? half.secs : 0, 30);
  assert.equal(half.text, "Keep it under 30 seconds.");
  assert.ok(!/minute/.test(half.text ?? ""), "30 seconds is not a minute");

  const one = capOf("keep it under a minute");
  assert.equal(one.text, "Keep it under 1 minute.");

  const three = capOf("make it under three minutes");
  assert.equal(three.text, "Keep it under 3 minutes.");
});

test("a length that is not whole minutes stays in seconds", () => {
  /* 90 seconds is "a minute and a half" to a person and "1 minute" to a
     rounder. Rather than lie by a third, it says 90 seconds. */
  assert.equal(capText(90_000), "Keep it under 90 seconds.");
  assert.equal(capText(59_000), "Keep it under 59 seconds.");
  assert.equal(capText(60_000), "Keep it under 1 minute.");
  assert.equal(capText(120_000), "Keep it under 2 minutes.");
  /* And nothing ever reads "under 0 seconds", which is not a rule. */
  assert.equal(capText(0), "Keep it under 1 second.");
});
