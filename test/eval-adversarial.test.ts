/**
 * THE WAYS A JUDGE SAYS "BACKS" WHEN IT SHOULD NOT.
 *
 * False support is the number invariant 4 rests on: a judge that says "this
 * clip backs your claim" when it does not makes every receipt in the product
 * a lie, and makes "nothing backs this" unreachable precisely when it is the
 * true answer.
 *
 * CLAUDE.md requires a model swap to be gated by an eval set and there has
 * never been one, so every model in this product was chosen on price and
 * plausibility. This set does not replace the real one — it is constructed,
 * one author, a worst case — and it does let a swap be a measurement.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CATEGORIES,
  CONTROL,
  MIN_CONTROL_SHARE,
  NEAR_MISSES,
  compare,
  coverage,
  falseSupportByCategory,
  type AdversarialClaim,
  asCandidateModel,
  isModelId,
  type Category,
} from "../src/eval-adversarial.ts";

const SET: AdversarialClaim[] = readFileSync(
  join(import.meta.dirname, "..", "eval", "adversarial.jsonl"),
  "utf8",
)
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l) as AdversarialClaim);

test("ACCEPTANCE: every named near miss is actually in the set", () => {
  /* A taxonomy with empty categories is a list of things somebody meant to
     write down. coverage() names the gaps so they cannot stay quiet. */
  const cov = coverage(SET);
  assert.deepEqual(cov.missing, [], `nothing written for: ${cov.missing.join(", ")}`);
  for (const miss of NEAR_MISSES) {
    assert.ok(cov.byCategory[miss] > 0, `${miss} has no example`);
  }
});

test("ACCEPTANCE: there are enough controls for a pass to mean anything", () => {
  /*
   * A set of nothing but near misses rewards a judge for saying no to
   * everything, and a judge that says no to everything has a false-support
   * rate of zero and is useless. Measured on the first draft: three controls
   * in seventeen claims, below the threshold, and the validator caught its
   * own author.
   */
  const cov = coverage(SET);
  assert.ok(cov.balanced, `${cov.controls} of ${cov.total} are controls, under ${MIN_CONTROL_SHARE}`);
  assert.ok(cov.controls >= 4);

  /*
   * AND THE RULE, NOT JUST THIS SET'S STATE. Asserting only that today's set
   * is balanced passes just as well against a threshold of zero — measured:
   * setting MIN_CONTROL_SHARE to 0 and hardcoding balanced:true both failed
   * nothing. The next set is the one this protects.
   */
  const noControls = coverage([{ category: "negated" }, { category: "negated" }, { category: "topical" }]);
  assert.equal(noControls.balanced, false, "a set with no controls reported itself balanced");
  assert.equal(noControls.controls, 0);
  assert.ok(noControls.missing.includes("backs"), "the missing controls were not named");

  const thin = coverage([
    ...Array.from({ length: 9 }, () => ({ category: "negated" })),
    { category: "backs" },
  ]);
  assert.equal(thin.balanced, false, `one control in ten passed a ${MIN_CONTROL_SHARE} threshold`);
  assert.ok(MIN_CONTROL_SHARE > 0, "the threshold is off, so nothing is required");
});

test("every claim says which miss it is and why", () => {
  /* A rate is not actionable; a rate per category is. "It fails on
     hypotheticals" tells somebody what to change. */
  for (const c of SET) {
    assert.ok(c.category in CATEGORIES, `${c.claimId} has no category`);
    assert.ok(c.note.length > 30, `${c.claimId} does not say what it is testing`);
    assert.ok(c.judgements.length > 0, `${c.claimId} has nothing to judge`);
    assert.match(c.claim, /\S/);
  }
});

test("the near misses really are near: they share the claim's words", () => {
  /*
   * THE POINT OF THE SET. A clip that shares no vocabulary with the claim is
   * rejected by anything, including BM25 on its own, and measures nothing.
   * These have to be the ones that LOOK like support.
   */
  /*
   * A STOPWORD LIST RATHER THAN A LENGTH. The first version kept words
   * longer than three letters, which threw away "cut" — so "the budget was
   * cut" against "the budget was cut, well, the draft was" scored as ONE
   * shared word and the test called a near-total overlap "not a near miss".
   * Short claims are exactly the ones where every word carries weight.
   */
  const STOP = new Set([
    "the", "a", "an", "and", "or", "but", "is", "was", "were", "be", "been", "it", "that",
    "this", "to", "of", "in", "on", "for", "at", "by", "with", "as", "he", "she", "they",
    "them", "his", "her", "their", "not", "no", "did", "do", "does", "had", "has", "have",
  ]);
  const words = (s: string) =>
    new Set(
      s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w)),
    );
  for (const c of SET) {
    if (c.category === CONTROL) continue;
    const claimWords = words(c.claim);
    const wrong = c.judgements.filter((j) => j.verdict !== "backs");
    for (const j of wrong) {
      const shared = [...words(j.quote)].filter((w) => claimWords.has(w));
      /* Two, or all of them where the claim has fewer than two to share. */
      const want = Math.min(2, claimWords.size);
      assert.ok(
        shared.length >= want,
        `${c.claimId}/${j.clipId} shares ${shared.length} of ${claimWords.size} content words — it is not a near miss`,
      );
    }
  }
});

test("a judge that calls every near miss support scores terribly, by category", () => {
  const predictions = SET.flatMap((c) =>
    c.judgements.map((j) => ({
      claimId: c.claimId,
      clipId: j.clipId,
      said: "backs" as const,
      truth: j.verdict,
      category: c.category,
    })),
  );
  const scores = falseSupportByCategory(predictions);
  for (const s of scores) {
    if (s.category === CONTROL || s.asked === 0) continue;
    assert.ok((s.rate ?? 0) > 0, `${s.category} did not register a single false support`);
  }
  /* And the controls are not counted against it: calling genuine support
     "backs" is the right answer. */
  assert.equal(scores.find((s) => s.category === CONTROL)?.falseSupport, 0);
});

test("a judge that refuses everything has no false support and is still useless", () => {
  /*
   * Why the controls exist. This is the degenerate model the rate alone
   * cannot see, and it is the one somebody reaches for after a bad report.
   */
  const predictions = SET.flatMap((c) =>
    c.judgements.map((j) => ({
      claimId: c.claimId,
      clipId: j.clipId,
      said: "unrelated" as const,
      truth: j.verdict,
      category: c.category,
    })),
  );
  const scores = falseSupportByCategory(predictions);
  assert.equal(
    scores.reduce((n, s) => n + s.falseSupport, 0),
    0,
    "refusing everything produced false support",
  );
  /* The set still holds it to account, because the controls are real
     support it just rejected. */
  const controls = SET.filter((c) => c.category === CONTROL).flatMap((c) => c.judgements);
  assert.ok(controls.length >= 4, "there is nothing here to catch a judge that refuses everything");
});

test("comparing two models refuses to call either one good enough", () => {
  /*
   * A worst case on one author's labels can say which of two is wrong less
   * often. It cannot say a model is ready, and a sentence that implied it
   * would be this set claiming the authority the real one has.
   */
  const said = compare({ model: "a", rate: 0.1 }, { model: "b", rate: 0.3 });
  assert.match(said, /a is wrong less often/);
  assert.match(said, /not a reason to believe either is good enough/);
  assert.match(compare({ model: "a", rate: null }, { model: "b", rate: 0.3 }), /nothing to compare/);
  assert.match(compare({ model: "a", rate: 0.2 }, { model: "b", rate: 0.2 }), /both/);
});

test("a category nobody asked about reports null, not zero", () => {
  /* Zero false support reads as a pass. "Never asked" is a different fact
     and the one that matters when a run was cut short. */
  const scores = falseSupportByCategory([]);
  for (const s of scores) {
    assert.equal(s.rate, null, `${s.category} reported a rate without being asked`);
    assert.equal(s.asked, 0);
  }
});

test("the set says out loud what it is not", () => {
  /*
   * One author, so no inter-rater agreement; constructed, so not a sample of
   * the wild; near misses, so silent about retrieval. Somebody will quote a
   * number off this set in a meeting one day.
   */
  const src = readFileSync(join(import.meta.dirname, "..", "src", "eval-adversarial.ts"), "utf8");
  const prose = src.replace(/^\s*\*/gm, " ").replace(/\s+/g, " ");
  assert.match(prose, /WHAT THIS IS NOT/);
  assert.match(prose, /not inter-rater agreement/i);
  assert.match(prose, /recall over a real messy library is the other set's job/i);
});

test("every category in the taxonomy is described, not just named", () => {
  for (const cat of Object.keys(CATEGORIES) as Category[]) {
    assert.ok(CATEGORIES[cat].length > 30, `${cat} has no description`);
    assert.match(CATEGORIES[cat], /[.!]$/);
  }
});

/* ── Naming a model to try ───────────────────────────────────────────────── */

test("ACCEPTANCE: a model id is checked by shape, not against a list", () => {
  /*
   * THE POINT OF THE EVAL IS MODELS NOT YET IN models.ts, so an allowlist
   * would refuse exactly the thing being measured. What is refused is
   * anything not shaped like a model id: the value reaches an inference
   * binding, and "whatever the caller sent" is not an input this codebase
   * hands to anything.
   */
  for (const good of [
    "@cf/cloudflare/clairic",
    "@cf/cloudflare/clef-flash",
    "@cf/deepseek-ai/deepseek-v4.1-flash-1017",
    "@cf/zai-org/glm-5.3-flash",
    "claude-opus-5-5",
  ]) {
    assert.ok(isModelId(good), `${good} was refused and it is a model id`);
  }
  for (const bad of [
    "",
    "   ",
    "../../etc/passwd",
    "https://evil.example/model",
    "@cf/only-one-part",
    "cf/missing-at/sign",
    "claude opus",
    "@cf/a/b; DROP TABLE",
    "@cf/a/b\nX-Injected: 1",
    "a".repeat(200),
  ]) {
    assert.equal(isModelId(bad), false, `"${bad.slice(0, 30)}" was accepted as a model id`);
  }
});

test("the provider is read off the id, and nothing else is guessed", () => {
  /*
   * A window and whether a model does structured output cannot be known for
   * a model nobody has run. Guessing would put a number in the manifest that
   * nothing measured.
   */
  assert.equal(asCandidateModel("@cf/cloudflare/clairic").provider, "workers-ai");
  assert.equal(asCandidateModel("claude-opus-5-5").provider, "anthropic");
  assert.equal(asCandidateModel("@cf/cloudflare/clairic").id, "@cf/cloudflare/clairic");
});
