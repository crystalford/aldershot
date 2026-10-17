/**
 * WHEN TO STOP LOOKING.
 *
 * Spec 18 section 3.8. A research run has no natural end: there is always
 * another query, and a model asked "should I keep going?" always says yes.
 * Left to itself the run spends the budget and then stops because the money
 * ran out, which is the one stop reason that tells the user nothing about
 * their subject.
 *
 * So stopping is a measurement, and it takes TWO things agreeing:
 *
 * - THE KNEE. Plot distinct verified moments against queries issued. Early
 *   queries each bring something; late ones bring the same moments again.
 *   The knee is where that changes, and Cormack and Grossman's rule is that
 *   the run is done when the slope after it falls below a sixth of the slope
 *   before. Never before twenty queries, because four lucky queries make a
 *   convincing-looking plateau and a run that stopped at four has not looked.
 *
 * - COVERAGE. Every subject beat with two verified moments and every counter
 *   beat with one — or the beat marked `gap`, with what was tried. A gap is a
 *   result. "We looked for the other side in six places and found nothing" is
 *   a finding a person can act on; stopping silently with an empty counter
 *   beat is a video with one side of an argument in it.
 *
 * AND A CROSS-CHECK THAT CAN OVERRULE BOTH. Capture–recapture: the direct
 * family found n1 moments, the crowd family found n2, m of them were found by
 * both. If the two families overlap heavily, they are seeing most of what is
 * there; if they barely overlap, there is a lot neither has reached. N̂ =
 * n1·n2/m. An estimate half again larger than what we have means keep going.
 *
 * THE BUDGET OVERRIDES ALL OF IT, and says so. A run that ends because the
 * money ran out must not be presented as a run that finished — the board
 * reads differently, and so does a gap.
 */

/* ── The curve ──────────────────────────────────────────────────────────── */

/** One point: after this many queries, this many DISTINCT verified moments. */
export interface Point {
  queries: number;
  verified: number;
}

export interface Knee {
  /** The point of maximum distance from the chord between first and last. */
  at: Point;
  index: number;
  /** New moments per query before the knee, and after it. */
  slopeBefore: number;
  slopeAfter: number;
  /** Cormack–Grossman: the run has flattened. */
  flattened: boolean;
}

/** The spec's ratio, and the floor under it. */
export const SLOPE_RATIO = 6;
export const MIN_QUERIES = 20;

/**
 * Where the curve bends.
 *
 * Maximum distance from the straight line between the first and last points —
 * the standard construction, and the one the spec names. It needs no
 * smoothing parameter and no threshold, which matters because a parameter
 * here would be a number nobody could defend.
 *
 * Null with fewer than three points: two points are a line and a line has no
 * knee. Null also when the curve is flat or straight, where every point sits
 * on the chord and picking one would be picking rounding error — which falls
 * out of the search rather than needing its own guard, because a point is
 * only taken when it is strictly further from the chord than nothing.
 */
export function findKnee(curve: Point[]): Knee | null {
  const pts = [...curve].sort((a, b) => a.queries - b.queries);
  /* Three by intent — one and two points cannot bend. One is also the point
     below which `pts[0]` does not exist. */
  if (pts.length < 3) return null;

  const first = pts[0];
  const last = pts[pts.length - 1];
  const dx = last.queries - first.queries;
  const dy = last.verified - first.verified;
  const chord = Math.hypot(dx, dy);
  if (chord === 0) return null;

  let bestIndex = -1;
  let bestDistance = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    /* Perpendicular distance from the chord. */
    const d = Math.abs(dy * (p.queries - first.queries) - dx * (p.verified - first.verified)) / chord;
    /* STRICTLY GREATER, so a tie goes to the EARLIER point. Which one is
       called the knee changes the verdict: the earlier point gives a steeper
       slope-before and a longer, shallower tail, so the flattening test is
       harder to satisfy and the run keeps going. That is the direction to err
       in — stopping too late costs budget, which is capped and reported,
       while stopping too early costs the other side of an argument, and
       nothing downstream can tell that it is missing. */
    if (d > bestDistance) {
      bestDistance = d;
      bestIndex = i;
    }
  }
  /* A perfectly straight line, and a flat one, put every point on the chord,
     so nothing was ever strictly further from it than zero and no index was
     taken. There is no bend to find, and naming one would be naming rounding
     error. (A separate `bestDistance === 0` test used to sit here; it could
     not fire, because bestIndex is only set when the distance beats zero.) */
  if (bestIndex < 0) return null;

  const at = pts[bestIndex];
  const slope = (a: Point, b: Point) => {
    const run = b.queries - a.queries;
    return run > 0 ? (b.verified - a.verified) / run : 0;
  };
  const slopeBefore = slope(first, at);
  const slopeAfter = slope(at, last);

  return {
    at,
    index: bestIndex,
    slopeBefore,
    slopeAfter,
    /*
     * Cormack and Grossman: the run is done when the slope after the knee is
     * under a sixth of the slope before it.
     *
     * A `slopeBefore > 0` test used to guard this, against "a run that found
     * nothing counts as flattened". It could not fire: the curve is
     * CUMULATIVE distinct moments, so it never falls, and a slopeBefore of
     * zero needs a negative slopeAfter to pass. A curve flat at zero never
     * reaches here anyway — every point sits on its own chord and there is no
     * knee. Written down rather than kept, because a guard that cannot fire
     * reads as a guarantee and is not one.
     */
    flattened: slopeAfter < slopeBefore / SLOPE_RATIO,
  };
}

/* ── Coverage ───────────────────────────────────────────────────────────── */

export interface BeatCoverage {
  beatId: string;
  role: "subject" | "counter" | "outside";
  needMin: number;
  verified: number;
  queriesTried: number;
  status: "covered" | "thin" | "gap";
}

/**
 * Where each beat stands, and what the three words mean.
 *
 * `covered` — it has what it needed.
 * `thin`    — it has something, and less than it needed. Still worth looking.
 * `gap`     — it has nothing, and we tried. A RESULT, not a failure: the
 *             board shows gaps first and says what was tried, because
 *             "we looked in six places and found nothing" is a finding and an
 *             empty row is an accident.
 *
 * A beat with nothing and NOTHING TRIED is `thin`, not a gap. Calling it a
 * gap would let a run that never issued a query report diligence it did not
 * do, which is the same lie the quota rows exist to prevent.
 */
export function coverageOf(
  beats: Array<{ id: string; role: "subject" | "counter" | "outside"; needMin: number }>,
  verifiedByBeat: Map<string, number>,
  triedByBeat: Map<string, number>,
): BeatCoverage[] {
  return beats.map((b) => {
    const verified = verifiedByBeat.get(b.id) ?? 0;
    const queriesTried = triedByBeat.get(b.id) ?? 0;
    const status: BeatCoverage["status"] =
      verified >= b.needMin ? "covered" : verified === 0 && queriesTried > 0 ? "gap" : "thin";
    return { beatId: b.id, role: b.role, needMin: b.needMin, verified, queriesTried, status };
  });
}

/**
 * Coverage holds when every beat is either covered or an honest gap.
 *
 * A `thin` beat is the one state that keeps the run going: it has found
 * something, so there is probably more, and it has not yet been looked for
 * hard enough to call the absence a finding.
 */
export const coverageHolds = (cov: BeatCoverage[]): boolean =>
  cov.every((c) => c.status === "covered" || c.status === "gap");

/* ── Capture–recapture ─────────────────────────────────────────────────── */

export interface Recapture {
  n1: number;
  n2: number;
  m: number;
  /** N̂ = n1·n2/m. Null when it cannot be computed. */
  estimate: number | null;
  /** The estimate says there is half again as much out there. */
  moreOutThere: boolean;
  why: string;
}

/** The spec's threshold: an estimate this much bigger than the haul means keep going. */
export const RECAPTURE_MULTIPLE = 1.5;

/**
 * How much is probably still out there, from how much two families agree.
 *
 * Two independent searches of the same pond: if they keep landing the same
 * fish, there are few fish; if they never do, there are many. Direct queries
 * and crowd queries are the two families because they are the two that look
 * in genuinely different places — one asks the platform, the other asks the
 * people who already indexed it.
 *
 * NO OVERLAP IS NOT AN ESTIMATE OF ZERO. With m = 0 the formula divides by
 * nothing, and the honest reading is the opposite of a small pond: two
 * searches that found entirely different things have almost certainly not
 * found everything. So it reports no estimate and says keep going — bounded
 * by the budget, which is what the budget is for.
 */
export function recapture(n1: number, n2: number, m: number, found: number): Recapture {
  if (n1 <= 0 || n2 <= 0) {
    return {
      n1,
      n2,
      m,
      estimate: null,
      moreOutThere: false,
      why: "one of the two families found nothing, so there is nothing to compare",
    };
  }
  if (m <= 0) {
    return {
      n1,
      n2,
      m,
      estimate: null,
      moreOutThere: true,
      why: "the two families found entirely different moments, which is a sign there is more neither has reached",
    };
  }
  const estimate = (n1 * n2) / m;
  const moreOutThere = estimate > RECAPTURE_MULTIPLE * found;
  return {
    n1,
    n2,
    m,
    estimate: Number(estimate.toFixed(2)),
    moreOutThere,
    why: moreOutThere
      ? `the overlap suggests about ${Math.round(estimate)} moments exist and ${found} have been found`
      : `the overlap suggests about ${Math.round(estimate)} moments exist, which ${found} found is close to`,
  };
}

/* ── The budget ─────────────────────────────────────────────────────────── */

export interface Budget {
  maxRounds: number;
  maxSources: number;
  maxSpendUsd: number;
}

/** Spec 1: "max rounds (default 4), max sources scanned (default 40), max spend (default $1.50)". */
export const DEFAULT_BUDGET: Budget = { maxRounds: 4, maxSources: 40, maxSpendUsd: 1.5 };

export interface RunState {
  rounds: number;
  sourcesScanned: number;
  spendUsd: number;
  queriesIssued: number;
  curve: Point[];
  coverage: BeatCoverage[];
  recapture: Recapture;
  /** The user pressed stop. */
  userStopped?: boolean;
}

export const STOP_REASONS = [
  "knee_and_coverage",
  "budget_rounds",
  "budget_sources",
  "budget_spend",
  "user",
] as const;
export type StopReason = (typeof STOP_REASONS)[number];

export interface Decision {
  stop: boolean;
  reason: StopReason | null;
  /** A sentence a person reads. Every stop has one; there is no silent stop. */
  why: string;
  knee: Knee | null;
}

/**
 * Stop, or keep going, and why.
 *
 * THE ORDER IS THE POLICY. A user's stop beats everything, because they asked.
 * Then the budget, because a run that has spent the money cannot do anything
 * else whatever the curve says — and it must be REPORTED as a budget stop,
 * since a board that reads "finished" when the money ran out turns an
 * unfinished search into a conclusion.
 *
 * Spend is checked before sources and sources before rounds: the user was
 * shown the money before pressing Run, so the money is the limit they will
 * recognise in the answer.
 *
 * Only then the measurement, and only when every part of it agrees: twenty
 * queries at least, the curve flattened, every beat covered or an honest gap,
 * and the capture–recapture cross-check not pointing at a pond we have barely
 * fished.
 */
export function decideStop(state: RunState, budget: Budget = DEFAULT_BUDGET): Decision {
  const knee = findKnee(state.curve);

  if (state.userStopped) {
    return { stop: true, reason: "user", why: "you stopped the run", knee };
  }

  if (state.spendUsd >= budget.maxSpendUsd) {
    return {
      stop: true,
      reason: "budget_spend",
      why: `the run reached its $${budget.maxSpendUsd.toFixed(2)} budget. What it found is below; what it had not got to yet is marked.`,
      knee,
    };
  }
  if (state.sourcesScanned >= budget.maxSources) {
    return {
      stop: true,
      reason: "budget_sources",
      why: `${budget.maxSources} sources were read, which is this run's limit. Anything still unread is marked.`,
      knee,
    };
  }
  if (state.rounds >= budget.maxRounds) {
    return {
      stop: true,
      reason: "budget_rounds",
      why: `${budget.maxRounds} rounds of searching, which is this run's limit. Anything still thin is marked.`,
      knee,
    };
  }

  if (state.queriesIssued < MIN_QUERIES) {
    return {
      stop: false,
      reason: null,
      why: `${state.queriesIssued} queries so far; nothing stops before ${MIN_QUERIES}, because four lucky ones look like a plateau`,
      knee,
    };
  }

  if (!knee || !knee.flattened) {
    return {
      stop: false,
      reason: null,
      why: knee
        ? `each new query is still finding things (${knee.slopeAfter.toFixed(3)} a query against ${knee.slopeBefore.toFixed(3)} earlier)`
        : "not enough of a curve yet to say whether it has flattened",
      knee,
    };
  }

  const thin = state.coverage.filter((c) => c.status === "thin");
  if (thin.length) {
    return {
      stop: false,
      reason: null,
      why: `${thin.length} beat${thin.length === 1 ? "" : "s"} still thin: ${thin.map((c) => c.beatId).join(", ")}`,
      knee,
    };
  }

  if (state.recapture.moreOutThere) {
    return { stop: false, reason: null, why: state.recapture.why, knee };
  }

  const gaps = state.coverage.filter((c) => c.status === "gap");
  return {
    stop: true,
    reason: "knee_and_coverage",
    why: gaps.length
      ? `new queries stopped finding new moments, and every beat is covered or an honest gap (${gaps.length} gap${gaps.length === 1 ? "" : "s"})`
      : "new queries stopped finding new moments, and every beat is covered",
    knee,
  };
}
