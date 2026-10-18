/**
 * THE FOUR NUMBERS PHASE 0 ASKS FOR.
 *
 * "the set exists in the repo with a runner that reports recall@5, judge
 * precision/recall per label, false-support rate, and labeller agreement"
 * (11-BUILD-ORDER.md). This is the arithmetic; `scripts/eval-set.ts` is the
 * runner that feeds it.
 *
 * PURE, AND SEPARATE FROM THE RUNNER, for the reason the eval harness is
 * typechecked at all: a measurement nobody can check is a number nobody has
 * reason to believe. Every function here takes judgements and predictions
 * and returns a figure, so each one can be pinned against a worked example
 * rather than against whatever the pipeline happened to do today.
 *
 * NONE OF THESE REACH A USER. Invariant 3 is about what the product says to
 * the person using it; this is the bench, and a bench with no numbers on it
 * is a bench.
 */

import type { Verdict } from "./eval-set.ts";

/* ── Recall@k ───────────────────────────────────────────────────────────── */

export interface RankedClaim {
  claimId: string;
  /** What retrieval returned, best first. */
  ranked: string[];
  /** The clips a person said back this claim. Empty is a real answer. */
  backing: string[];
}

export interface RecallResult {
  /** Claims that had at least one backing clip — the only ones recall is of. */
  of: number;
  /** How many of those had one in the top k. */
  found: number;
  /** found / of, or null when no claim in the set has any backing at all. */
  recall: number | null;
  /** Claims with nothing to find, counted rather than hidden. */
  unbacked: number;
}

/**
 * Did retrieval put a backing moment in the top k?
 *
 * A CLAIM WITH NO BACKING IS NOT A MISS. "Nothing here backs this" is an
 * answer this product is built to give (invariant 4), and scoring those
 * claims as failures would push recall down for getting the right answer.
 * They are counted separately and they are the set's negatives — the
 * false-support rate below is what judges them.
 */
export function recallAt(claims: RankedClaim[], k = 5): RecallResult {
  let of = 0;
  let found = 0;
  let unbacked = 0;
  for (const c of claims) {
    if (!c.backing.length) {
      unbacked += 1;
      continue;
    }
    of += 1;
    const top = new Set(c.ranked.slice(0, k));
    if (c.backing.some((b) => top.has(b))) found += 1;
  }
  return { of, found, recall: of ? found / of : null, unbacked };
}

/* ── The judge, per label ───────────────────────────────────────────────── */

export interface Prediction {
  claimId: string;
  clipId: string;
  /** What the judge said. */
  said: Verdict;
  /** What the person said. */
  truth: Verdict;
}

export interface LabelScore {
  /** How many the person gave this label to. */
  support: number;
  /** How many the judge gave it to. */
  said: number;
  /** Both. */
  hit: number;
  precision: number | null;
  recall: number | null;
}

/**
 * PER LABEL, NOT OVERALL, and that is the whole point of three answers.
 *
 * A judge that never says "related, not enough" can still look excellent
 * overall — near-misses are a minority of any set — while being useless at
 * the one job the threshold exists for. Averaging hides it; a column per
 * label does not.
 *
 * Null rather than 0 where there is nothing to divide by: a label the judge
 * never used has no precision, which is a different fact from precision 0,
 * and the two must not be read as the same.
 */
export function perLabel(predictions: Prediction[], labels: readonly Verdict[]): Record<Verdict, LabelScore> {
  const out = {} as Record<Verdict, LabelScore>;
  for (const label of labels) {
    const support = predictions.filter((p) => p.truth === label).length;
    const said = predictions.filter((p) => p.said === label).length;
    const hit = predictions.filter((p) => p.said === label && p.truth === label).length;
    out[label] = {
      support,
      said,
      hit,
      precision: said ? hit / said : null,
      recall: support ? hit / support : null,
    };
  }
  return out;
}

/**
 * THE ONE THAT MATTERS MOST: how often it calls something support that is not.
 *
 * Doc 13's decision 21 — "'Nothing backs this' is engineered. Three-way
 * label, our threshold, near-miss negatives" — is here as a number. A system
 * that says a moment backs a claim when a person said it does not is making
 * the exact mistake the receipts exist to prevent, and it is worse than
 * missing the evidence entirely: a miss is visible, a false support is not.
 *
 * Measured over everything the judge called `backs`, because that is the set
 * of claims the product would actually have put on screen with a receipt
 * under them.
 */
export function falseSupportRate(predictions: Prediction[]): { said: number; wrong: number; rate: number | null } {
  const said = predictions.filter((p) => p.said === "backs");
  /* `related` counts as wrong here, and that is deliberate: near-miss
     evidence presented as support is the failure mode this whole set exists
     to catch, not a near-enough answer. */
  const wrong = said.filter((p) => p.truth !== "backs").length;
  return { said: said.length, wrong, rate: said.length ? wrong / said.length : null };
}

/* ── What the set says is true ──────────────────────────────────────────── */

/**
 * WHICH MOMENTS BACK A CLAIM, when two people disagree about one.
 *
 * Only what every labeller who looked called `backs`. A moment one person
 * called support and the other called a near-miss is exactly the case this
 * set exists to be careful about, and counting it as truth would score
 * retrieval as correct for finding something the labellers themselves could
 * not agree on — which would quietly reward the pipeline for the same
 * mistake the three-way label was introduced to catch.
 *
 * Where only one person judged a moment, their answer stands: there is
 * nothing to disagree with, and throwing away single-judged moments would
 * discard most of any real set.
 *
 * A claim with nothing left is a claim nothing backs, which is a RESULT —
 * "nothing here backs this" has to be a reachable answer (invariant 4) and
 * the set needs claims that teach it.
 */
export function backingOf(judgements: Array<{ clipId: string; verdict: Verdict }>): string[] {
  const byClip = new Map<string, Verdict[]>();
  for (const j of judgements) byClip.set(j.clipId, [...(byClip.get(j.clipId) ?? []), j.verdict]);
  return [...byClip.entries()]
    .filter(([, vs]) => vs.every((v) => v === "backs"))
    .map(([clipId]) => clipId);
}

/* ── Labeller agreement ─────────────────────────────────────────────────── */

export interface Agreement {
  /** Items both labelled. Agreement is only ever of these. */
  both: number;
  /** How many they answered the same way. */
  same: number;
  /** same / both. */
  raw: number | null;
  /**
   * Cohen's kappa: agreement above what two people guessing this often
   * would reach by chance.
   *
   * Raw agreement alone flatters a skewed set — if 90% of everything is
   * `unrelated`, two labellers who always say `unrelated` agree 90% of the
   * time and have told you nothing. Kappa is near 0 for exactly that.
   */
  kappa: number | null;
}

/**
 * How much two labellers agreed, on the items they both judged.
 *
 * "two labellers, agreement recorded" is in Phase 0's own description, and
 * the reason is that the set is the ruler: a set two people cannot agree on
 * is measuring the labellers rather than the system. A kappa below about 0.6
 * means the labelling guidance needs work before any number taken against
 * this set means anything.
 */
export function agreement(
  a: Map<string, Verdict>,
  b: Map<string, Verdict>,
  labels: readonly Verdict[],
): Agreement {
  const keys = [...a.keys()].filter((k) => b.has(k));
  const both = keys.length;
  if (!both) return { both: 0, same: 0, raw: null, kappa: null };

  let same = 0;
  for (const k of keys) if (a.get(k) === b.get(k)) same += 1;
  const raw = same / both;

  /* Chance agreement: how often they would coincide if each kept their own
     habits and answered independently. */
  let chance = 0;
  for (const label of labels) {
    const pa = keys.filter((k) => a.get(k) === label).length / both;
    const pb = keys.filter((k) => b.get(k) === label).length / both;
    chance += pa * pb;
  }

  return {
    both,
    same,
    raw,
    /* Perfect agreement on a set where chance is also perfect — every item
       the same label — is not measurable, and 1 would be a claim. */
    kappa: chance >= 1 ? null : (raw - chance) / (1 - chance),
  };
}
