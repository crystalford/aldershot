/**
 * WHEN TO STOP LOOKING.
 *
 * A research run has no natural end: there is always another query, and a
 * model asked whether to keep going always says yes. Left alone the run
 * spends the budget and stops because the money ran out — the one stop reason
 * that tells the user nothing about their subject.
 *
 * The failures this guards are both quiet and both expensive. Stopping too
 * early produces a video with one side of an argument in it and a board that
 * says "finished". Stopping too late produces the same board and a bill.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_BUDGET,
  MIN_QUERIES,
  RECAPTURE_MULTIPLE,
  SLOPE_RATIO,
  coverageHolds,
  coverageOf,
  decideStop,
  findKnee,
  recapture,
  type BeatCoverage,
  type Point,
  type RunState,
} from "../src/scout-stop.ts";

/** A curve that rises steeply and then flattens — a run that found its material. */
const flattening: Point[] = [
  { queries: 0, verified: 0 },
  { queries: 5, verified: 8 },
  { queries: 10, verified: 15 },
  { queries: 15, verified: 20 },
  { queries: 20, verified: 21 },
  { queries: 25, verified: 21 },
  { queries: 30, verified: 21 },
];

const covered = (role: "subject" | "counter", n: number): BeatCoverage => ({
  beatId: role === "subject" ? "B1" : "C1",
  role,
  needMin: role === "subject" ? 2 : 1,
  verified: n,
  queriesTried: 6,
  status: "covered",
});

const settled = (over: Partial<RunState> = {}): RunState => ({
  rounds: 2,
  sourcesScanned: 12,
  spendUsd: 0.4,
  queriesIssued: 30,
  curve: flattening,
  coverage: [covered("subject", 3), covered("counter", 2)],
  recapture: recapture(10, 9, 6, 18),
  ...over,
});

/* ── The knee ───────────────────────────────────────────────────────────── */

test("the knee is the point furthest from the line between the ends", () => {
  /*
   * The standard construction, and the one the spec names. No smoothing
   * parameter and no threshold, which matters: a parameter here would be a
   * number nobody could defend afterwards.
   */
  const knee = findKnee(flattening)!;
  assert.ok(knee);
  assert.equal(knee.at.queries, 15);
  assert.equal(knee.at.verified, 20);
  /* Over a moment a query before, one in fifteen after. */
  assert.ok(knee.slopeBefore > 1);
  assert.ok(knee.slopeAfter < 0.1);
  assert.equal(knee.flattened, true);
  assert.ok(knee.slopeAfter < knee.slopeBefore / SLOPE_RATIO);
});

test("a tie goes to the earlier point, which is the conservative end", () => {
  /*
   * TWO POINTS CAN SIT THE SAME DISTANCE FROM THE CHORD, and which one is
   * called the knee changes the verdict: the earlier point gives a steeper
   * slope-before and a longer, shallower tail, so Cormack–Grossman is harder
   * to satisfy and the run keeps going.
   *
   * That is the direction to err in. Stopping too late costs budget, and the
   * budget is already capped and already reported; stopping too early costs
   * the other side of an argument, and nothing downstream can tell that it
   * is missing. An earlier version of these fixtures had the tie, expected
   * the later point, and would have stopped a run that was still finding a
   * moment every four queries.
   */
  const tied: Point[] = [
    { queries: 0, verified: 0 },
    { queries: 5, verified: 7 },
    { queries: 10, verified: 13 },
    { queries: 15, verified: 16 },
    { queries: 20, verified: 17 },
    { queries: 25, verified: 17 },
    { queries: 30, verified: 18 },
  ];
  const knee = findKnee(tied)!;
  assert.equal(knee.at.queries, 10);
  assert.equal(knee.flattened, false, "and so the run carries on");
});

test("a curve still climbing has a knee and has not flattened", () => {
  /*
   * There is always a point furthest from the chord, so finding a knee is not
   * the same as the run being done. Conflating the two would stop every run
   * at its third round.
   */
  const climbing: Point[] = [
    { queries: 0, verified: 0 },
    { queries: 10, verified: 8 },
    { queries: 20, verified: 19 },
    { queries: 30, verified: 26 },
  ];
  const knee = findKnee(climbing)!;
  assert.ok(knee);
  assert.equal(knee.flattened, false);
});

test("two points are a line, and a line has no knee", () => {
  assert.equal(findKnee([{ queries: 0, verified: 0 }, { queries: 10, verified: 5 }]), null);
  assert.equal(findKnee([]), null);
  assert.equal(findKnee([{ queries: 5, verified: 2 }]), null);
});

test("a straight line and a flat line have no knee either", () => {
  /*
   * Every point sits on the chord, so the maximum distance is zero and
   * picking a point would be picking rounding error. A flat line at zero is
   * the shape of a run that has found nothing at all, which is not a
   * flattened curve — it is a run that has not started.
   */
  const straight: Point[] = [0, 1, 2, 3, 4].map((i) => ({ queries: i * 10, verified: i * 5 }));
  assert.equal(findKnee(straight), null);

  const nothing: Point[] = [0, 1, 2, 3].map((i) => ({ queries: i * 10, verified: 0 }));
  assert.equal(findKnee(nothing), null);
});

test("the curve is read in query order, however it arrives", () => {
  /*
   * Rounds finish out of order under a workflow, and a curve assembled from
   * them must not depend on which item wrote its row first.
   *
   * NOT A REVERSAL. An earlier version of this test reversed the array, which
   * pins nothing: the perpendicular distance is symmetric, and this curve's
   * knee sits at index 3 of seven, so reversing it leaves the knee at index 3
   * and the test passed with the sort deleted. These rotations move it.
   */
  const expected = findKnee(flattening)!.at;
  const rotations = [
    [...flattening.slice(4), ...flattening.slice(0, 4)],
    [...flattening.slice(1), flattening[0]],
    [flattening[6], flattening[2], flattening[0], flattening[5], flattening[3], flattening[1], flattening[4]],
  ];
  for (const r of rotations) assert.deepEqual(findKnee(r)!.at, expected, JSON.stringify(r.map((p) => p.queries)));
});

/* ── Coverage ───────────────────────────────────────────────────────────── */

test("covered, thin, and an honest gap", () => {
  const cov = coverageOf(
    [
      { id: "B1", role: "subject", needMin: 2 },
      { id: "B2", role: "subject", needMin: 2 },
      { id: "C1", role: "counter", needMin: 1 },
      { id: "C2", role: "counter", needMin: 1 },
    ],
    new Map([["B1", 3], ["B2", 1], ["C1", 1]]),
    new Map([["B1", 6], ["B2", 4], ["C1", 2], ["C2", 9]]),
  );
  assert.deepEqual(
    cov.map((c) => [c.beatId, c.status]),
    [["B1", "covered"], ["B2", "thin"], ["C1", "covered"], ["C2", "gap"]],
  );
});

test("nothing found and nothing tried is thin, not a gap", () => {
  /*
   * A gap is a claim about diligence: "we looked in nine places and found
   * nothing" is a finding a person can act on. Calling an untried beat a gap
   * would let a run report looking it never did — the same lie the quota rows
   * exist to prevent.
   */
  const cov = coverageOf([{ id: "B9", role: "subject", needMin: 2 }], new Map(), new Map());
  assert.equal(cov[0].status, "thin");
  assert.equal(cov[0].queriesTried, 0);

  const tried = coverageOf([{ id: "B9", role: "subject", needMin: 2 }], new Map(), new Map([["B9", 5]]));
  assert.equal(tried[0].status, "gap");
});

test("coverage holds when every beat is covered or an honest gap", () => {
  const cov = coverageOf(
    [
      { id: "B1", role: "subject", needMin: 2 },
      { id: "C1", role: "counter", needMin: 1 },
    ],
    new Map([["B1", 2]]),
    new Map([["B1", 3], ["C1", 7]]),
  );
  assert.equal(coverageHolds(cov), true);

  /* One thin beat is the one state that keeps a run going: it found
     something, so there is probably more, and the absence is not yet a
     finding. */
  const thin = coverageOf(
    [{ id: "B1", role: "subject", needMin: 2 }],
    new Map([["B1", 1]]),
    new Map([["B1", 3]]),
  );
  assert.equal(coverageHolds(thin), false);
});

/* ── Capture–recapture ─────────────────────────────────────────────────── */

test("heavy overlap means the pond is nearly fished", () => {
  /* Two independent searches landing the same moments: there are few left. */
  const r = recapture(10, 9, 8, 11);
  assert.equal(r.estimate, 11.25);
  assert.equal(r.moreOutThere, false);
  assert.match(r.why, /close to/);
});

test("barely any overlap means keep going", () => {
  const r = recapture(10, 9, 1, 18);
  assert.equal(r.estimate, 90);
  assert.ok(r.estimate! > RECAPTURE_MULTIPLE * 18);
  assert.equal(r.moreOutThere, true);
});

test("ACCEPTANCE: no overlap at all is not an estimate of zero", () => {
  /*
   * With m = 0 the formula divides by nothing. The temptation is to treat
   * that as "no evidence, carry on as before"; the honest reading is the
   * opposite of a small pond — two searches that found entirely different
   * things have almost certainly not found everything.
   */
  const r = recapture(7, 6, 0, 13);
  assert.equal(r.estimate, null);
  assert.equal(r.moreOutThere, true);
  assert.match(r.why, /entirely different/);
});

test("one empty family is no comparison, not a verdict", () => {
  /* The crowd family finds nothing on an obscure subject. That says nothing
     about how much is out there, so it must not force a stop OR a continue. */
  for (const r of [recapture(0, 9, 0, 9), recapture(10, 0, 0, 10), recapture(0, 0, 0, 0)]) {
    assert.equal(r.estimate, null);
    assert.equal(r.moreOutThere, false);
    assert.match(r.why, /nothing to compare/);
  }
});

/* ── The decision ───────────────────────────────────────────────────────── */

test("the knee and coverage together stop the run, and say so", () => {
  const d = decideStop(settled());
  assert.equal(d.stop, true);
  assert.equal(d.reason, "knee_and_coverage");
  assert.match(d.why, /stopped finding new moments/);
  assert.equal(d.knee!.flattened, true);
});

test("nothing stops before twenty queries, however flat the curve looks", () => {
  /*
   * Four lucky queries make a convincing plateau. A run that stopped at four
   * has not looked, and the board would say it had.
   */
  const d = decideStop(
    settled({
      queriesIssued: 8,
      curve: [
        { queries: 0, verified: 0 },
        { queries: 4, verified: 5 },
        { queries: 6, verified: 5 },
        { queries: 8, verified: 5 },
      ],
    }),
  );
  assert.equal(d.stop, false);
  assert.match(d.why, /nothing stops before 20/);
  assert.equal(MIN_QUERIES, 20);
});

test("a thin beat keeps the run going even with a flat curve", () => {
  /* The two conditions are an AND. A flattened curve with an empty counter
     beat is a video with one side of an argument in it. */
  const d = decideStop(
    settled({
      coverage: [covered("subject", 3), { ...covered("counter", 0), verified: 0, status: "thin" }],
    }),
  );
  assert.equal(d.stop, false);
  assert.match(d.why, /still thin: C1/);
});

test("a gap does not keep the run going — it is a result", () => {
  /* "We looked in nine places and found nothing" is a finding, and the board
     shows gaps first. Treating a gap as unfinished business would make every
     run with an un-findable counter beat run to the end of its budget. */
  const d = decideStop(
    settled({
      coverage: [covered("subject", 3), { ...covered("counter", 0), verified: 0, queriesTried: 9, status: "gap" }],
    }),
  );
  assert.equal(d.stop, true);
  assert.equal(d.reason, "knee_and_coverage");
  assert.match(d.why, /1 gap/);
});

test("capture–recapture can overrule a flat curve and full coverage", () => {
  /* The curve and the coverage both look done, and the two families barely
     overlap — which means both of them are looking in the same small corner. */
  const d = decideStop(settled({ recapture: recapture(10, 9, 1, 18) }));
  assert.equal(d.stop, false);
  assert.match(d.why, /about 90 moments exist/);
});

test("a climbing curve says what it is still finding", () => {
  const d = decideStop(
    settled({
      curve: [
        { queries: 0, verified: 0 },
        { queries: 10, verified: 8 },
        { queries: 20, verified: 19 },
        { queries: 30, verified: 26 },
      ],
    }),
  );
  assert.equal(d.stop, false);
  assert.match(d.why, /still finding things/);
});

/* ── The budget overrides everything ────────────────────────────────────── */

test("ACCEPTANCE: a run that ran out of money says so, not that it finished", () => {
  /*
   * The whole reason the stop reason is a column. A board reading "finished"
   * when the money ran out turns an unfinished search into a conclusion, and
   * a gap in that run means something completely different — we did not get
   * there, rather than we looked and it is not there.
   */
  const d = decideStop(settled({ spendUsd: 1.5, curve: [{ queries: 0, verified: 0 }] }));
  assert.equal(d.stop, true);
  assert.equal(d.reason, "budget_spend");
  assert.match(d.why, /\$1\.50 budget/);
  assert.match(d.why, /what it had not got to yet is marked/);
});

test("each budget has its own reason, and money is reported first", () => {
  /* The user was shown the money before pressing Run, so the money is the
     limit they will recognise in the answer. */
  assert.equal(decideStop(settled({ rounds: 4 })).reason, "budget_rounds");
  assert.equal(decideStop(settled({ sourcesScanned: 40 })).reason, "budget_sources");
  assert.equal(decideStop(settled({ spendUsd: 2 })).reason, "budget_spend");
  assert.equal(decideStop(settled({ rounds: 9, sourcesScanned: 99, spendUsd: 9 })).reason, "budget_spend");
  assert.equal(decideStop(settled({ rounds: 9, sourcesScanned: 99 })).reason, "budget_sources");
});

test("the budget beats a run that had not finished looking", () => {
  /* A thin beat does not buy more budget. */
  const d = decideStop(
    settled({
      rounds: 4,
      coverage: [{ ...covered("subject", 0), verified: 0, status: "thin" }],
    }),
  );
  assert.equal(d.stop, true);
  assert.equal(d.reason, "budget_rounds");
});

test("the user beats the budget and the measurement both", () => {
  const d = decideStop(settled({ userStopped: true, spendUsd: 9, rounds: 9 }));
  assert.equal(d.stop, true);
  assert.equal(d.reason, "user");
  assert.equal(d.why, "you stopped the run");
});

test("every decision carries a sentence — there is no silent stop", () => {
  /*
   * Invariant 7: silent partial failure is a P1. A stop with no reason on it
   * is the same thing one level up, and the states below are every branch
   * this function has.
   */
  const states: RunState[] = [
    settled(),
    settled({ userStopped: true }),
    settled({ spendUsd: 2 }),
    settled({ sourcesScanned: 99 }),
    settled({ rounds: 9 }),
    settled({ queriesIssued: 3 }),
    settled({ curve: [{ queries: 0, verified: 0 }, { queries: 1, verified: 1 }] }),
    settled({ coverage: [{ ...covered("subject", 1), verified: 1, status: "thin" }] }),
    settled({ recapture: recapture(10, 9, 1, 18) }),
  ];
  for (const s of states) {
    const d = decideStop(s);
    assert.ok(d.why.length > 10, JSON.stringify(d));
    if (d.stop) assert.ok(d.reason, "a stop with no reason");
    else assert.equal(d.reason, null);
  }
  assert.deepEqual(DEFAULT_BUDGET, { maxRounds: 4, maxSources: 40, maxSpendUsd: 1.5 });
});
