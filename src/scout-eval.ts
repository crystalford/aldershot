/**
 * THE SCOUT EVAL: how good is a run, measured rather than asserted.
 *
 * `labs/SCOUT.md`, as doc 18 quotes it: "10–20 creators with fan-curated
 * timestamp lists (Reddit and wiki incident lists, compilation chapters) as
 * recall ground truth within ±30 s. Measure precision, verification pass
 * rate, counterpoint coverage, time to first good clip, cost per accepted
 * moment, and saturation. About 20 briefs shows large effects."
 *
 * It is also the only one of v0's five acceptance criteria with nothing
 * behind it. The other four are enforced in code and tested; this one — "
 * `search.list` spend stays under the daily cap on the 20-brief eval" — names
 * an eval that does not exist, so the criterion cannot pass or fail.
 *
 * WHAT IS HERE AND WHAT IS NOT. The metrics are here, and they are the part
 * that has to be right: a harness that measures the wrong thing is worse than
 * none, because it produces numbers people then believe. The GROUND TRUTH is
 * not here and cannot be — fan-curated incident lists are real people's work
 * about real subjects, and inventing a set would be inventing the answer.
 * `docs/handoff/19-SCOUT-EVAL.md` says what to gather and in what shape.
 *
 * THE RECALL WINDOW IS WHY THIS IS NOT A SET INTERSECTION. A fan writes
 * "14:32" having noticed the thing a few seconds after it started, and Scout
 * reports the word id the quote actually begins at. Those are the same moment
 * and different numbers, so recall matches within ±30 s — and each ground
 * truth matches at most once, or one find sitting between two timestamps
 * would score as two.
 */

/* ── Ground truth ───────────────────────────────────────────────────────── */

export interface GroundTruth {
  /** The subject, e.g. a creator. One brief may cover several sources. */
  briefId: string;
  sourceId: string;
  /** Seconds into the source, as a human wrote it down. */
  tS: number;
  /** Where the list came from. The eval is only as good as its provenance. */
  provenance: string;
  /** What the list says happens here, for reading a failure afterwards. */
  note?: string;
}

export interface Found {
  briefId: string;
  sourceId: string;
  tS: number;
  /** Only verified finds count towards recall; a ghost is not a find yet. */
  verify: "verified" | "paraphrase" | "rejected";
  /** Which beat it answered, for counterpoint coverage. */
  beatRole?: "subject" | "counter" | "outside";
  /** Milliseconds from the run starting. For time-to-first-good-clip. */
  foundAtMs?: number;
}

/** The spec's window: a fan's timestamp and a word id are the same moment. */
export const RECALL_WINDOW_S = 30;

/* ── Recall ─────────────────────────────────────────────────────────────── */

export interface RecallResult {
  /** Ground truths a verified find landed within the window of. */
  hit: number;
  /** Ground truths nothing found. The interesting half. */
  missed: GroundTruth[];
  total: number;
  /** hit / total. Internal: this is an eval, not a surface. */
  recall: number;
}

/**
 * How much of what the crowd already indexed did the run find?
 *
 * EACH GROUND TRUTH MATCHES AT MOST ONCE, and so does each find. A run that
 * reported one moment sitting between two fan timestamps would otherwise
 * score two hits from one find — which is the shape of mistake that makes an
 * eval say a system improved when it got noisier.
 *
 * Matched nearest-first rather than greedily in order: given two finds and
 * two truths, pairing the closest first is the assignment a person would make
 * and the only one that does not depend on the order rows came out of the
 * database.
 */
export function recall(truth: GroundTruth[], found: Found[], windowS = RECALL_WINDOW_S): RecallResult {
  const verified = found.filter((f) => f.verify === "verified");

  /* Every pairing inside the window, nearest first. */
  const pairs: Array<{ t: number; f: number; d: number }> = [];
  truth.forEach((g, ti) => {
    verified.forEach((f, fi) => {
      if (f.briefId !== g.briefId || f.sourceId !== g.sourceId) return;
      const d = Math.abs(f.tS - g.tS);
      if (d <= windowS) pairs.push({ t: ti, f: fi, d });
    });
  });
  pairs.sort((a, b) => a.d - b.d || a.t - b.t || a.f - b.f);

  const usedTruth = new Set<number>();
  const usedFound = new Set<number>();
  for (const p of pairs) {
    /* ONE FIND, ONE TRUTH. Only `usedFound` is tested: a second pairing of an
       already-matched truth cannot change `usedTruth.size`, so a
       `usedTruth.has(p.t)` test here read as a guarantee and could not fire.
       What it would have changed is which FIND is spent on it, and nothing
       reads that. */
    if (usedFound.has(p.f)) continue;
    usedTruth.add(p.t);
    usedFound.add(p.f);
  }

  return {
    hit: usedTruth.size,
    missed: truth.filter((_, i) => !usedTruth.has(i)),
    total: truth.length,
    recall: truth.length ? Number((usedTruth.size / truth.length).toFixed(4)) : 0,
  };
}

/* ── Precision ──────────────────────────────────────────────────────────── */

export type Rating = "on_beat" | "off_beat" | "misattributed";

export interface PrecisionResult {
  onBeat: number;
  offBeat: number;
  misattributed: number;
  rated: number;
  precision: number;
}

/**
 * "On-beat and correctly attributed", human-rated.
 *
 * HUMAN-RATED IS NOT A LIMITATION TO ENGINEER AWAY. Whether a find is on the
 * beat is the judgement the whole product exists to support, and a model
 * rating its own output would measure agreement rather than accuracy. The
 * spec says human-rated and this function takes ratings rather than producing
 * them.
 *
 * MISATTRIBUTION IS COUNTED SEPARATELY from off-beat, because they fail
 * differently: an off-beat find wastes a slot, and a misattributed one puts
 * somebody's name on somebody else's words. The second is the one that ends
 * up in a letter from a solicitor, and an eval that averaged them would hide
 * it rising while precision held.
 */
export function precision(ratings: Rating[]): PrecisionResult {
  const onBeat = ratings.filter((r) => r === "on_beat").length;
  const offBeat = ratings.filter((r) => r === "off_beat").length;
  const misattributed = ratings.filter((r) => r === "misattributed").length;
  const rated = ratings.length;
  return {
    onBeat,
    offBeat,
    misattributed,
    rated,
    precision: rated ? Number((onBeat / rated).toFixed(4)) : 0,
  };
}

/* ── The run's own numbers ──────────────────────────────────────────────── */

export interface RunMetrics {
  /** Of everything scanned and judged, how much survived the verifier. */
  verificationPassRate: number;
  /** Counter beats with at least one verified find, over all counter beats. */
  counterpointCoverage: number;
  /** Milliseconds to the first verified, on-beat find. Null if there was none. */
  timeToFirstGoodClipMs: number | null;
  /** Dollars per verified find. The number the business runs on. */
  costPerAcceptedMoment: number | null;
  /** search.list calls, against the daily cap. The v0 acceptance criterion. */
  searchListCalls: number;
}

export interface RunInput {
  found: Found[];
  /** Every scan answer that reached the verifier, verified or not. */
  judged: number;
  /** Counter beats in the plan, and how many got a verified find. */
  counterBeats: number;
  counterBeatsCovered: number;
  spendUsd: number;
  searchListCalls: number;
  /** Human ratings, aligned with `found` by index where present. */
  ratings?: Rating[];
}

export function runMetrics(run: RunInput): RunMetrics {
  const verified = run.found.filter((f) => f.verify === "verified");

  /*
   * TIME TO FIRST GOOD CLIP IS TO THE FIRST VERIFIED AND ON-BEAT ONE, not the
   * first verified one. A run that produces a correct quote about the wrong
   * thing in four seconds has not given the user anything, and measuring to
   * it would reward exactly the behaviour the beat validator exists to
   * prevent. Where nobody has rated yet, verified is the best available
   * answer and the field says so by being present at all.
   */
  const good = verified.filter((f, i) => {
    if (!run.ratings) return true;
    const at = run.found.indexOf(f);
    return run.ratings[at] === "on_beat" || run.ratings[at] === undefined;
  });
  const times = good.map((f) => f.foundAtMs).filter((t): t is number => typeof t === "number");

  return {
    verificationPassRate: run.judged ? Number((verified.length / run.judged).toFixed(4)) : 0,
    counterpointCoverage: run.counterBeats
      ? Number((run.counterBeatsCovered / run.counterBeats).toFixed(4))
      : /* No counter beats at all is not full coverage. It is a plan that
           never asked for the other side, which is the thing the decompose
           validator refuses and the eval has to be able to see. */
        0,
    timeToFirstGoodClipMs: times.length ? Math.min(...times) : null,
    costPerAcceptedMoment: verified.length ? Number((run.spendUsd / verified.length).toFixed(4)) : null,
    searchListCalls: run.searchListCalls,
  };
}

/* ── Saturation ─────────────────────────────────────────────────────────── */

export interface Saturation {
  /** Finds the held-out budget turned up after the run said it was done. */
  newFinds: number;
  /** What the run had when it stopped. */
  atStop: number;
  /** New over what it had. High means the stopping rule stopped too early. */
  ratio: number;
  verdict: "stopped_well" | "stopped_early";
}

/** Above this, the run left material on the table and the knee rule is wrong. */
export const SATURATION_LIMIT = 0.15;

/**
 * Did the run stop too early?
 *
 * "Spend held-out extra budget after stopping, count new finds." The only
 * honest test of a stopping rule, because the rule's own numbers cannot
 * falsify it: a knee that fires early produces a curve that looks flat, and
 * coverage that holds because the beats were thin to begin with.
 *
 * A HIGH RATIO IS A FAILURE OF THE STOPPING RULE, NOT OF THE RUN. The run did
 * what it was told. That is worth saying because the fix is a parameter —
 * SLOPE_RATIO, MIN_QUERIES, the recapture multiple — and a reader who
 * concluded "retrieval is bad" would go and change the wrong thing.
 */
export function saturation(atStop: number, newFinds: number): Saturation {
  const ratio = atStop ? Number((newFinds / atStop).toFixed(4)) : newFinds ? 1 : 0;
  return {
    newFinds,
    atStop,
    ratio,
    verdict: ratio > SATURATION_LIMIT ? "stopped_early" : "stopped_well",
  };
}

/* ── The whole set ──────────────────────────────────────────────────────── */

export interface BriefResult extends RunMetrics {
  briefId: string;
  recall: RecallResult;
  precision: PrecisionResult;
  saturation?: Saturation;
}

export interface SetReport {
  briefs: number;
  /** Macro-averaged: every brief counts once, however much it found. */
  recall: number;
  precision: number;
  verificationPassRate: number;
  counterpointCoverage: number;
  /** Across the whole set, against the daily cap. The acceptance criterion. */
  searchListCalls: number;
  withinDailyCap: boolean;
  medianTimeToFirstGoodClipMs: number | null;
  costPerAcceptedMoment: number | null;
  /** Briefs whose stopping rule left material behind. */
  stoppedEarly: string[];
  /** The sentence the acceptance criterion is read off. */
  why: string;
}

/** YouTube's cap, as src/scout-youtube.ts declares it. */
export const DAILY_SEARCH_CAP = 100;

/**
 * The set, averaged the way the acceptance criterion reads it.
 *
 * MACRO-AVERAGED, which is a choice and the right one here. Pooling every
 * find across twenty briefs lets one well-documented subject with ninety
 * timestamps decide the number, and the thing being measured is whether the
 * system works on a BRIEF — not whether it works on the easiest brief hard
 * enough to carry the rest.
 *
 * `searchListCalls` is summed rather than averaged, because the cap is a
 * daily total across the project and that is exactly how it is spent.
 */
export function setReport(results: BriefResult[], cap = DAILY_SEARCH_CAP): SetReport {
  if (!results.length) {
    return {
      briefs: 0,
      recall: 0,
      precision: 0,
      verificationPassRate: 0,
      counterpointCoverage: 0,
      searchListCalls: 0,
      withinDailyCap: true,
      medianTimeToFirstGoodClipMs: null,
      costPerAcceptedMoment: null,
      stoppedEarly: [],
      why: "no briefs were run, so nothing has been measured",
    };
  }

  const mean = (xs: number[]) => Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(4));
  const calls = results.reduce((n, r) => n + r.searchListCalls, 0);

  const times = results
    .map((r) => r.timeToFirstGoodClipMs)
    .filter((t): t is number => typeof t === "number")
    .sort((a, b) => a - b);
  const median = times.length ? times[Math.floor(times.length / 2)] : null;

  const costs = results.map((r) => r.costPerAcceptedMoment).filter((c): c is number => typeof c === "number");
  const stoppedEarly = results.filter((r) => r.saturation?.verdict === "stopped_early").map((r) => r.briefId);
  const withinDailyCap = calls <= cap;

  return {
    briefs: results.length,
    recall: mean(results.map((r) => r.recall.recall)),
    precision: mean(results.map((r) => r.precision.precision)),
    verificationPassRate: mean(results.map((r) => r.verificationPassRate)),
    counterpointCoverage: mean(results.map((r) => r.counterpointCoverage)),
    searchListCalls: calls,
    withinDailyCap,
    medianTimeToFirstGoodClipMs: median,
    costPerAcceptedMoment: costs.length ? mean(costs) : null,
    stoppedEarly,
    why: withinDailyCap
      ? `${calls} search.list calls across ${results.length} brief${results.length === 1 ? "" : "s"}, under the daily cap of ${cap}`
      : `${calls} search.list calls across ${results.length} briefs — OVER the daily cap of ${cap}, so this run broke tomorrow's`,
  };
}

/* ── Ablations ──────────────────────────────────────────────────────────── */

export const ABLATIONS = ["counter_branch", "vocabulary", "window_size", "questions_per_window"] as const;
export type Ablation = (typeof ABLATIONS)[number];

export interface AblationResult {
  ablation: Ablation;
  baseline: number;
  without: number;
  /** What turning it off costs. Negative means it was making things worse. */
  delta: number;
  /** Whether twenty briefs can see it. See `MEANINGFUL_DELTA`. */
  meaningful: boolean;
}

/**
 * How big a difference twenty briefs can actually see.
 *
 * `labs/SCOUT.md` says "about 20 briefs shows large effects", which is a
 * statement about POWER and is usually read as a promise about precision. At
 * that n a two-point difference is noise, and reporting it as a result is how
 * a parameter gets tuned to the eval set.
 */
export const MEANINGFUL_DELTA = 0.05;

export function ablation(name: Ablation, baseline: number, without: number): AblationResult {
  const delta = Number((baseline - without).toFixed(4));
  return {
    ablation: name,
    baseline,
    without,
    delta,
    meaningful: Math.abs(delta) >= MEANINGFUL_DELTA,
  };
}
