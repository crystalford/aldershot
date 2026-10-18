/**
 * THE EVAL SET: what actually backs what, judged by a person.
 *
 * Everything about retrieval after this is a guess until something measures
 * it, and the only thing that can measure it is somebody saying, of a real
 * claim and a real moment, whether one backs the other.
 *
 * THREE ANSWERS, NOT TWO. "Related but not enough" is the whole reason this
 * is worth building. Near-miss evidence — the same speaker, the same topic, a
 * different point — is the dominant false positive in every system of this
 * shape, and a yes/no set cannot teach a threshold to refuse it. A judge
 * trained or tuned on two answers learns that anything on-topic is support,
 * which is exactly the failure "nothing here backs this" has to survive.
 */

export const VERDICTS = ["backs", "related", "unrelated"] as const;
export type Verdict = (typeof VERDICTS)[number];

/** What each answer reads as. The judge's own three-way label. */
export const VERDICT_NAME: Record<Verdict, string> = {
  backs: "Backs it",
  related: "Related, not enough",
  unrelated: "Unrelated",
};

export const isVerdict = (v: unknown): v is Verdict =>
  typeof v === "string" && (VERDICTS as readonly string[]).includes(v);

export interface Judgement {
  clipId: string;
  verdict: Verdict;
}

/**
 * What a claim's labels say about the retrieval that produced them.
 *
 * Precision at the top of the list, which is what a person actually
 * experiences: of the moments it put in front of you, how many backed the
 * claim. Recall needs a set where every backing moment has been found, and
 * labelling the candidates retrieval returned cannot establish that — the
 * moments it never surfaced were never judged.
 *
 * Stated rather than quietly computed, because a precision figure presented
 * as recall is the kind of wrong that survives for months.
 */
export function scoreClaim(judgements: Judgement[]): {
  judged: number;
  backs: number;
  related: number;
  unrelated: number;
  precision: number | null;
} {
  const n = (v: Verdict) => judgements.filter((j) => j.verdict === v).length;
  const backs = n("backs");
  const related = n("related");
  const unrelated = n("unrelated");
  const judged = judgements.length;
  return {
    judged,
    backs,
    related,
    unrelated,
    /* Null rather than 0 for an unjudged claim: "nothing backs it" and
       "nobody has looked" are different facts and only one is a result. */
    precision: judged ? backs / judged : null,
  };
}

/**
 * How many judgements make a set worth tuning a threshold against.
 *
 * 06-FOOTAGE-SYSTEM.md asks for about 200. Stated so the page can show how
 * far along somebody is, rather than implying a finished set at label three.
 *
 * A matching claim count is NOT here: it was, at twenty, and nothing used it.
 * Two numbers to be "far enough along" against is one more than the work
 * needs, and the labels are the binding one — twenty claims with two
 * judgements each is not a set, and five claims with forty each is.
 */
export const ENOUGH_LABELS = 200;

/* ── Who made the judgement ─────────────────────────────────────────────── */

/**
 * The name on rows written before labellers existed.
 *
 * Shown rather than hidden, and never attributed to whoever is labelling
 * now: an agreement figure computed between a person and their own earlier
 * unnamed answers would be an agreement with themselves, reported as
 * agreement between two people.
 */
export const LEGACY_LABELLER = "(unnamed)";

/** As many labellers as the set has, in the order they first appear. */
export function labellersIn(rows: Array<{ labeller: string }>): string[] {
  const seen: string[] = [];
  for (const r of rows) if (!seen.includes(r.labeller)) seen.push(r.labeller);
  return seen;
}

/**
 * A labeller's name, cleaned up.
 *
 * It arrives off a query parameter and ends up as a primary key, so it is
 * trimmed, bounded and never empty — two rows for "ann" and "ann " would be
 * two labellers who agree with each other perfectly and are one person.
 */
export function labellerName(raw: string | null | undefined, fallback: string): string {
  const clean = (raw ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
  return clean || fallback;
}

/**
 * How far along the set is against what Phase 0 asks for.
 *
 * Two numbers, because the acceptance names two different things: enough
 * judgements to tune a threshold against, and enough of them judged TWICE
 * for an agreement figure to mean anything. A set of four hundred labels
 * from one person still cannot answer "do two people agree".
 */
export const ENOUGH_DOUBLE_JUDGED = 40;

export function setProgress(rows: Array<{ claimId: string; clipId: string; labeller: string }>): {
  judgements: number;
  labellers: string[];
  doubleJudged: number;
} {
  const by = new Map<string, Set<string>>();
  for (const r of rows) {
    const key = `${r.claimId}\u0000${r.clipId}`;
    const set = by.get(key) ?? new Set<string>();
    set.add(r.labeller);
    by.set(key, set);
  }
  return {
    judgements: rows.length,
    labellers: labellersIn(rows),
    doubleJudged: [...by.values()].filter((s) => s.size > 1).length,
  };
}
