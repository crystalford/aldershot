/**
 * THE WAYS A JUDGE SAYS "BACKS" WHEN IT SHOULD NOT.
 *
 * Phase 0 asks for ~200 claims over ~10 hours of somebody's own footage,
 * labelled twice. That set measures the real distribution — how a claim is
 * half-said across two sentences, how forty clips in a library all mention
 * rent — and nothing in this repo can invent it.
 *
 * This is the other half, and it is CONSTRUCTED on purpose. A near miss can
 * be written down: a clip using the claim's exact words to say the opposite,
 * a hypothetical read as an assertion, somebody else's words quoted. Those
 * are the cases that produce FALSE SUPPORT, which is the number invariant 4
 * rests on — a judge that says "this clip backs your claim" when it does not
 * makes every receipt in the product a lie, and makes "nothing backs this"
 * unreachable precisely when it is the true answer.
 *
 * WHAT THIS IS NOT. It is one author's labels, so it measures failure modes
 * and NOT inter-rater agreement; kappa over this set would be a number about
 * nobody. It is a worst case rather than a sample, so a rate here is not the
 * rate in the wild — it is the rate on material chosen to be hard. And a
 * model that scores well here has not been shown to retrieve well: recall
 * over a real messy library is the other set's job.
 *
 * It exists so that a model swap is a measurement. CLAUDE.md requires one
 * ("gated by the eval set before a model swap") and there has never been a
 * set to gate against, so every model in this product was chosen on price
 * and plausibility.
 */

import type { Verdict } from "./eval-set.ts";
import { falseSupportRate, type Prediction } from "./eval-metrics.ts";
import type { Effort } from "./models.ts";

/**
 * The named ways a near miss is near.
 *
 * Named because a rate is not actionable and a rate per category is: "it
 * fails on hypotheticals" tells somebody what to change about a prompt, and
 * "12% false support" tells them to worry.
 */
export const NEAR_MISSES = [
  "negated",
  "hypothetical",
  "reported",
  "wrong-subject",
  "wrong-time",
  "qualified-away",
  "half",
  "topical",
  "self-correction",
] as const;

export type NearMiss = (typeof NEAR_MISSES)[number];

/** A control: genuine support, so the set measures both directions. */
export const CONTROL = "backs" as const;

export type Category = NearMiss | typeof CONTROL;

export const CATEGORIES: Record<Category, string> = {
  negated: "The clip denies what the claim asserts, in the claim's own words.",
  hypothetical: "Stated as a condition or a counterfactual, never as a fact.",
  reported: "Somebody else's words, quoted or attributed, not the speaker's own claim.",
  "wrong-subject": "The right shape about a different person, place or thing.",
  "wrong-time": "True of a different period from the one the claim is about.",
  "qualified-away": "Asserted and then narrowed until nothing of the claim is left.",
  half: "Supports one clause of a two-clause claim and is silent on the other.",
  topical: "Heavy word overlap with the claim and no entailment at all.",
  "self-correction": "Said, then corrected to something else in the same breath.",
  backs: "Genuine support. Without these the set measures only one direction.",
};

/**
 * A set with no controls is a set that rewards a judge for saying no to
 * everything, which is a judge nobody can use.
 */
export const MIN_CONTROL_SHARE = 0.2;

export interface Coverage {
  byCategory: Record<Category, number>;
  /** Categories with nothing in them. A gap, named. */
  missing: Category[];
  controls: number;
  total: number;
  /** Whether there are enough controls for a pass to mean anything. */
  balanced: boolean;
}

export function coverage(items: Array<{ category: string }>): Coverage {
  const byCategory = Object.fromEntries(
    (Object.keys(CATEGORIES) as Category[]).map((c) => [c, 0]),
  ) as Record<Category, number>;
  for (const i of items) {
    if (i.category in byCategory) byCategory[i.category as Category] += 1;
  }
  const missing = (Object.keys(CATEGORIES) as Category[]).filter((c) => byCategory[c] === 0);
  const controls = byCategory[CONTROL];
  const total = items.length;
  return {
    byCategory,
    missing,
    controls,
    total,
    balanced: total > 0 && controls / total >= MIN_CONTROL_SHARE,
  };
}

export interface CategoryScore {
  category: Category;
  /** How many of this category the judge was asked about. */
  asked: number;
  /** How many it called `backs` that were not. */
  falseSupport: number;
  /** falseSupport / asked, or null where it was never asked. */
  rate: number | null;
}

/**
 * False support, broken down by how the miss was near.
 *
 * The overall rate is in src/eval-metrics.ts and is the number that decides
 * whether a judge is usable. This says WHERE it fails, which is the number
 * that says what to do about it.
 */
export function falseSupportByCategory(
  predictions: Array<Prediction & { category: Category }>,
): CategoryScore[] {
  const out: CategoryScore[] = [];
  for (const category of Object.keys(CATEGORIES) as Category[]) {
    const mine = predictions.filter((p) => p.category === category);
    if (!mine.length) {
      out.push({ category, asked: 0, falseSupport: 0, rate: null });
      continue;
    }
    const { wrong } = falseSupportRate(mine);
    out.push({ category, asked: mine.length, falseSupport: wrong, rate: wrong / mine.length });
  }
  return out;
}

/**
 * The one sentence a model swap turns on.
 *
 * Deliberately not a verdict. This set is a worst case and one author's
 * labels; it can say a model is worse than another on constructed near
 * misses, and it cannot say a model is good enough to ship. Anything
 * stronger would be the eval claiming the authority the real set has.
 */
export function compare(a: { model: string; rate: number | null }, b: { model: string; rate: number | null }): string {
  const ra = a.rate;
  const rb = b.rate;
  if (ra === null || rb === null) return "One of them was never asked, so there is nothing to compare.";
  const pc = (n: number) => `${(n * 100).toFixed(1)}%`;
  if (ra === rb) return `${a.model} and ${b.model} both say "backs" wrongly ${pc(ra)} of the time here.`;
  const [better, worse] = ra < rb ? [{ ...a, rate: ra }, { ...b, rate: rb }] : [{ ...b, rate: rb }, { ...a, rate: ra }];
  return (
    `${better.model} is wrong less often on constructed near misses: ` +
    `${pc(better.rate)} against ${pc(worse.rate)}. That is a worst case on one author's labels, ` +
    `not a reason to believe either is good enough.`
  );
}

/** What a judgement in the adversarial file looks like. */
export interface AdversarialClaim {
  claimId: string;
  claim: string;
  category: Category;
  /** What the category is testing, in the author's words. */
  note: string;
  judgements: Array<{ clipId: string; labeller: string; verdict: Verdict; quote: string; sourceTitle: string }>;
}

/* ── Naming a model to try ───────────────────────────────────────────────── */

/**
 * Whether a string is a model id this product will hand to a provider.
 *
 * THE POINT OF THE EVAL IS MODELS NOT YET IN models.ts, so an allowlist of
 * known ids would refuse exactly the thing being measured. What is refused is
 * anything that is not shaped like a model id at all: the value reaches an
 * inference binding, and "whatever the caller sent" is not an input this
 * codebase passes to anything.
 *
 * Workers AI ids are `@cf/vendor/model`; Anthropic's are `claude-...`. Both
 * are matched by shape and bounded in length, which is enough to keep a
 * request body from becoming a URL, a path or an injection.
 */
export const MODEL_ID = /^(@cf\/[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|claude-[a-z0-9.-]+)$/i;

export const isModelId = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 120 && MODEL_ID.test(v);

/**
 * What a candidate model is, given its id.
 *
 * Shape only: a window and whether it does structured output cannot be known
 * for a model nobody has run, and guessing would put a number in the manifest
 * that nothing measured. The window here is what the EVAL needs — a claim and
 * a handful of quotes — not a claim about the model.
 */
export function asCandidateModel(id: string, effort?: Effort): {
  provider: "workers-ai" | "anthropic";
  id: string;
  context: number;
  jsonSchema: boolean;
  diarizes: boolean;
  effort?: Effort;
} {
  const provider = id.startsWith("@cf/") ? "workers-ai" : "anthropic";
  return {
    provider,
    id,
    context: 32_000,
    jsonSchema: true,
    diarizes: false,
    /*
     * EFFORT IS A CANDIDATE TOO. "Which model" is one axis and "how hard it
     * thinks" is another, and the second one is the cheaper to route on: a
     * second model means a second prompt cache, while a second effort on the
     * same model shares the one it already has. Anthropic's own guidance is
     * to measure the best model at lower effort BEFORE reaching for a
     * cascade, and a sweep is how that gets measured rather than argued.
     *
     * Dropped for Workers AI, which has no such setting — naming an effort
     * for a model that cannot read it would produce two scored runs that
     * were the same run.
     */
    ...(provider === "anthropic" && effort ? { effort } : {}),
  };
}

/** The five published levels, lowest first. Anything else is not a level. */
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export const isEffort = (v: unknown): v is Effort =>
  typeof v === "string" && (EFFORTS as readonly string[]).includes(v);
