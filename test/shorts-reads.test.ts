/**
 * THE DIMENSIONS A SHORT IS JUDGED ON — and the one that is refused.
 *
 * One Take's shorts view puts four cards under the line: Hook, Flow, Value
 * and Trend, each a word and a sentence, under a line that states the rule
 * out loud — "Bands and reasons, not scores — a shortlist, not a
 * prediction."
 *
 * The build showed one band and one reason for the whole short, which is
 * the right vocabulary at the wrong grain: "it starts part-way through a
 * sentence" is a fact about the HOOK, and reading it as a verdict on the
 * whole clip throws away a clip whose only problem is its first second.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DIMENSION_NAME, reads } from "../src/shorts.ts";

const whole = "So I'm going. Not because it's better there. Because staying is the only decision I've never actually made.";

test("the design's own flagship short has a strong hook", () => {
  /*
   * "So I'm going. Not because it's better there." is the prototype's
   * example, and it rates the Hook strong. The build rated it a Long shot,
   * because "so" was in the list of words that continue a thought nobody
   * heard — alongside "and", "but" and "because".
   *
   * Sentence-initial "so" in speech opens a thought rather than continuing
   * one. Found by putting the two surfaces side by side; the list is one
   * word shorter now.
   */
  const out = reads({ text: whole, durationMs: 30_000 });
  assert.deepEqual(out.map((r) => r.dimension), ["hook", "flow"]);
  for (const r of out) assert.equal(r.band, "strong");
  assert.match(out[0].reason, /opens on its own words/);
  assert.match(out[1].reason, /lands the point on its own/);
});

test("a bad opening is the HOOK's fault, not the whole clip's", () => {
  /*
   * THE POINT OF SPLITTING THEM. One band for the whole short said "it
   * starts part-way through a sentence" and you had no way to see that the
   * END was fine — so a clip you could fix by moving its in-point by a
   * second read as a clip to throw away.
   */
  const out = reads({ text: "and that's when I knew. So I'm going.", durationMs: 30_000 });
  const hook = out.find((r) => r.dimension === "hook");
  const flow = out.find((r) => r.dimension === "flow");
  assert.ok(hook && flow);
  assert.notEqual(hook.band, "strong", "the opening is the problem");
  assert.equal(flow.band, "strong", "and the ending is not");
});

test("a clip that stops mid-sentence is the FLOW's fault", () => {
  const out = reads({ text: "So I'm going. Not because it's better there but", durationMs: 30_000 });
  const flow = out.find((r) => r.dimension === "flow");
  assert.ok(flow);
  assert.notEqual(flow.band, "strong");
  assert.match(flow.reason, /mid-sentence|stops/);
});

test("Value is the scorer's opinion, and absent when it never gave one", () => {
  /* A score of 0 is the absence of a verdict rather than a bad one —
     saveClips writes it for anything unrated — so there is no card. */
  assert.ok(!reads({ text: whole, durationMs: 30_000 }).some((r) => r.dimension === "value"));
  assert.ok(!reads({ text: whole, durationMs: 30_000 }, 0).some((r) => r.dimension === "value"));
  assert.ok(!reads({ text: whole, durationMs: 30_000 }, null).some((r) => r.dimension === "value"));

  const scored = reads({ text: whole, durationMs: 30_000 }, 92).find((r) => r.dimension === "value");
  assert.ok(scored);
  assert.equal(scored.band, "strong");
  assert.match(scored.reason, /sharpest lines in your footage/);
});

test("THERE IS NO TREND CARD, and that is deliberate", () => {
  /*
   * The prototype's fourth card reads "personal decisions travel well this
   * month" — a claim about the outside world. Nothing in this codebase
   * knows what travels this month, and a card that guessed would be the
   * product inventing a fact on the one surface whose whole argument is
   * that it does not. Invariant 4: every claim keeps its receipt.
   */
  assert.ok(!("trend" in DIMENSION_NAME));
  for (const score of [null, 0, 50, 92]) {
    assert.ok(!reads({ text: whole, durationMs: 30_000 }, score).some((r) => String(r.dimension) === "trend"));
  }
  const src = readFileSync(join(import.meta.dirname, "..", "src", "shorts.ts"), "utf8");
  assert.match(src, /TREND IS NOT HERE/, "and the reason is written down where it would go");
});

test("no number reaches the screen on this surface either", () => {
  /* Invariant 3 again, on the one surface where a product like this would
     normally print a percentage. Every band is a word. */
  for (const score of [92, 70, 30]) {
    for (const r of reads({ text: whole, durationMs: 30_000 }, score)) {
      assert.ok(!/\d/.test(r.band), `${r.band} is a number`);
      assert.ok(!new RegExp(String(score)).test(r.reason), "the reason must not quote the score");
    }
  }
});

test("the rule is said out loud where the judgements are", () => {
  const cut = readFileSync(join(import.meta.dirname, "..", "src", "ui", "pages", "cut.ts"), "utf8");
  assert.match(
    cut,
    /Bands and reasons, not scores — a shortlist, not a prediction\. The rules on the left apply here too\./,
  );
});
