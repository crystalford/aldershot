/**
 * The eval set: what actually backs what.
 *
 * Everything about retrieval is a guess until a person says, of a real claim
 * and a real moment, whether one backs the other. This is the machinery for
 * collecting that, and its failures are the kind that produce a number rather
 * than an error — a set that cannot teach a threshold to refuse a near miss,
 * or a precision figure presented as recall.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ENOUGH_LABELS,
  VERDICTS,
  VERDICT_NAME,
  isVerdict,
  labellerName,
  scoreClaim,
  setProgress,
} from "../src/eval-set.ts";
import { renderEval, type EvalData } from "../src/ui/pages/eval.ts";

const base: EvalData = {
  claim: null,
  candidates: [],
  claims: [],
  labels: 0,
  labeller: "ann",
  labellers: ["ann"],
  doubleJudged: 0,
  machine: null,
  foundNothing: false,
};

test("there are three answers, and the middle one is the point", () => {
  /*
   * Near-miss evidence — the same speaker, the same topic, a different point
   * — is the dominant false positive in every system of this shape. A yes/no
   * set teaches a judge that anything on-topic is support, which is exactly
   * the failure "nothing here backs this" has to survive.
   */
  assert.deepEqual([...VERDICTS], ["backs", "related", "unrelated"]);
  assert.equal(VERDICT_NAME.related, "Related, not enough");
  assert.ok(isVerdict("backs") && isVerdict("related") && isVerdict("unrelated"));
  assert.ok(!isVerdict("maybe") && !isVerdict("") && !isVerdict(1));
});

test("an unjudged claim has no precision, rather than a precision of nought", () => {
  /* "Nothing backs it" and "nobody has looked" are different facts and only
     one of them is a result. */
  assert.equal(scoreClaim([]).precision, null);
  assert.equal(scoreClaim([]).judged, 0);

  const s = scoreClaim([
    { clipId: "a", verdict: "backs" },
    { clipId: "b", verdict: "related" },
    { clipId: "c", verdict: "unrelated" },
    { clipId: "d", verdict: "backs" },
  ]);
  assert.deepEqual({ judged: s.judged, backs: s.backs, related: s.related, unrelated: s.unrelated }, {
    judged: 4, backs: 2, related: 1, unrelated: 1,
  });
  assert.equal(s.precision, 0.5);
});

test("a claim the footage does not back is still part of the set", () => {
  /*
   * THE ONES THAT TEACH IT TO REFUSE. A set made only of claims that found
   * something teaches a threshold that something is always there — and
   * "nothing here backs this" has to be a reachable answer.
   */
  const html = renderEval({ ...base, claim: { id: "c1", text: "sourdough hydration" }, foundNothing: true });
  assert.match(html, /a claim your footage does not back is worth as much/);
  assert.ok(!/class="eval-say"/.test(html), "nothing to judge, so nothing offered");

  /* And the route writes the claim down on sight rather than on first
     judgement, or a claim that found nothing would never be recorded. */
  const src = readFileSync(join(import.meta.dirname, "..", "src", "index.ts"), "utf8");
  assert.match(
    src,
    /LABELLING: what backs what[\s\S]{0,6000}?INSERT INTO eval_claims[\s\S]{0,400}?const found = await findMaterial/,
    "the claim is created before retrieval runs, not after it succeeds",
  );
});

test("every moment offers all three answers, on a target worth tapping", () => {
  /*
   * Two hundred judgements is an hour of somebody's evening on a phone. The
   * thing that makes that unbearable is a target you have to aim at.
   */
  const html = renderEval({
    ...base,
    claim: { id: "c1", text: "the house is the real reason" },
    candidates: [
      { id: "m1", quote: "the house has a room that gets sun until four", sourceTitle: "Thursday", verdict: null, alsoJudged: 0 },
      { id: "m2", quote: "rent halves and I lose everyone", sourceTitle: "Thursday", verdict: "related", alsoJudged: 0 },
    ],
  });
  assert.equal((html.match(/class="eval-say"/g) ?? []).length, 6, "three per moment");
  assert.match(html, /min-height:40px/);
  for (const v of VERDICTS) assert.match(html, new RegExp(`data-verdict="${v}"`));

  /* An answer already given is lit, so working down a list twice does not
     mean judging the same moment twice. */
  assert.match(html, /data-clip="m2" data-verdict="related"[^>]*\n?[^>]*data-on-bg/);
});

test("the page says how far along the work is, against the number that matters", () => {
  /* Two hundred judgements has an end. A counter with no target is a well. */
  assert.match(renderEval({ ...base, labels: 0 }), /0 of 200/);
  assert.match(renderEval({ ...base, labels: 87 }), /87 of 200/);
  assert.equal(ENOUGH_LABELS, 200, "06-FOOTAGE-SYSTEM.md's own figure");
});

test("a judgement replaces that labeller's last one, and nobody else's", () => {
  /*
   * THE KEY IS THREE COLUMNS NOW. One person changing their mind is a
   * correction and replaces their row; a second person answering the same
   * moment is a second opinion and must not touch the first, or the
   * agreement figure Phase 0 asks for is computed over a set with every
   * disagreement already overwritten.
   *
   * And a judgement row carries no user of its own, so ownership is still
   * checked on the claim — otherwise anybody could label anybody's library.
   */
  const src = readFileSync(join(import.meta.dirname, "..", "src", "index.ts"), "utf8");
  const route = src.slice(src.indexOf("One judgement. Replaces any earlier answer"));
  const upto = route.slice(0, route.indexOf("return c.json({ ok: true })"));
  assert.match(upto, /ON CONFLICT\(claim_id,clip_id,labeller\)/);
  assert.match(upto, /DO UPDATE SET verdict=excluded\.verdict/);
  assert.match(upto, /FROM eval_claims WHERE id=\? AND user_id=\?/);
  assert.match(upto, /labellerName\(b\.by/, "and the name is cleaned before it becomes half a primary key");
  assert.match(upto, /if \(!isVerdict\(b\.verdict\)\)/, "and an answer that is not one of the three is refused");
});

/* ── Two labellers ──────────────────────────────────────────────────────── */

test("a name is cleaned before it becomes half a primary key", () => {
  /*
   * It arrives off a query parameter and ends up in the key of
   * eval_judgements. "ann" and "ann " would be two labellers who agree with
   * each other perfectly and are one person — a kappa of 1 reported from a
   * set nobody checked twice.
   */
  assert.equal(labellerName("  ann  ", "me"), "ann");
  assert.equal(labellerName("ann   marie", "me"), "ann marie");
  assert.equal(labellerName("", "me"), "me", "empty is the fallback, never an empty key");
  assert.equal(labellerName(null, "me"), "me");
  assert.equal(labellerName("   ", "me"), "me");
  assert.equal(labellerName("x".repeat(200), "me").length, 40, "and bounded");
});

test("the set knows how many moments have a second opinion, not just a total", () => {
  /*
   * The binding number for Phase 0's "two labellers, agreement recorded".
   * Four hundred judgements from one person still cannot answer whether two
   * people agree, so it is counted separately rather than folded into the
   * total.
   */
  const p = setProgress([
    { claimId: "c1", clipId: "m1", labeller: "ann" },
    { claimId: "c1", clipId: "m1", labeller: "ben" },
    { claimId: "c1", clipId: "m2", labeller: "ann" },
    { claimId: "c2", clipId: "m1", labeller: "ann" },
  ]);
  assert.equal(p.judgements, 4);
  assert.deepEqual(p.labellers, ["ann", "ben"]);
  assert.equal(p.doubleJudged, 1, "only c1/m1 was answered twice");
});

test("the same moment under two claims is two different judgements", () => {
  /* The key is the pair, not the clip: a moment can back one claim and be
     unrelated to another, and that is not a second opinion about anything. */
  const p = setProgress([
    { claimId: "c1", clipId: "m1", labeller: "ann" },
    { claimId: "c2", clipId: "m1", labeller: "ben" },
  ]);
  assert.equal(p.doubleJudged, 0);
});

test("the page shows who is answering and how far off a second opinion is", () => {
  const html = renderEval({ ...base, labeller: "ann", labellers: ["ann", "ben"], doubleJudged: 7 });
  assert.match(html, /Answering as/);
  assert.match(html, /name="by" value="ann"/);
  assert.match(html, /7 of 40 judged twice/);
  assert.match(html, /also ben/, "and who else has been through it");
});

test("the page never shows what the other labeller said", () => {
  /*
   * The one thing that would make the agreement figure meaningless, because
   * nobody can unsee it. The COUNT is useful — it is how you find the
   * moments still needing a second opinion — and the answer is not.
   */
  const html = renderEval({
    ...base,
    claim: { id: "c1", text: "a claim" },
    labeller: "ann",
    labellers: ["ann", "ben"],
    candidates: [
      { id: "m1", quote: "a moment", sourceTitle: "Tuesday", verdict: null, alsoJudged: 1 },
    ],
  });
  assert.match(html, /1 other answer/);
  assert.doesNotMatch(html, /ben (said|says)/);
  /* Ann's own row is unanswered, so no verdict is lit on it. */
  const lit = html.match(/data-clip="m1"[^>]*background:rgba\(\d+, ?\d+, ?\d+, ?0\.14\)/g);
  assert.equal(lit, null, "nothing is lit for a moment this labeller has not judged");
});

test("one labeller is 'nobody else yet' rather than a blank", () => {
  const html = renderEval({ ...base, labeller: "ann", labellers: ["ann"], doubleJudged: 0 });
  assert.match(html, /nobody else yet/);
});
