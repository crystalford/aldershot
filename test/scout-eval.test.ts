/**
 * THE SCOUT EVAL: how good is a run, measured rather than asserted.
 *
 * This is the only one of v0's five acceptance criteria that had nothing
 * behind it — "search.list spend stays under the daily cap on the 20-brief
 * eval" names an eval that did not exist, so the criterion could not pass or
 * fail.
 *
 * A HARNESS THAT MEASURES THE WRONG THING IS WORSE THAN NONE, because it
 * produces numbers people then believe and tune against. Every test here is
 * about a way of counting that looks right and flatters.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ABLATIONS,
  DAILY_SEARCH_CAP,
  MEANINGFUL_DELTA,
  RECALL_WINDOW_S,
  SATURATION_LIMIT,
  ablation,
  precision,
  recall,
  runMetrics,
  saturation,
  setReport,
  type BriefResult,
  type Found,
  type GroundTruth,
} from "../src/scout-eval.ts";

const truth = (tS: number, over: Partial<GroundTruth> = {}): GroundTruth => ({
  briefId: "dsp",
  sourceId: "s1",
  tS,
  provenance: "reddit incident thread",
  ...over,
});

const found = (tS: number, over: Partial<Found> = {}): Found => ({
  briefId: "dsp",
  sourceId: "s1",
  tS,
  verify: "verified",
  ...over,
});

/* ── Recall ─────────────────────────────────────────────────────────────── */

test("ACCEPTANCE: a fan's timestamp and a word id are the same moment", () => {
  /*
   * A fan writes "14:32" having noticed the thing a few seconds after it
   * started; Scout reports the word id the quote actually begins at. A set
   * intersection would score every one of those a miss and the eval would
   * report near-zero recall on a system that found everything.
   */
  const r = recall([truth(872)], [found(860)]);
  assert.equal(r.hit, 1);
  assert.equal(r.recall, 1);
  assert.equal(RECALL_WINDOW_S, 30);

  /* And outside the window it is a miss, which is the half that makes the
     window mean anything. */
  assert.equal(recall([truth(872)], [found(800)]).hit, 0);
});

test("ACCEPTANCE: one find between two timestamps is one hit, not two", () => {
  /*
   * THE SHAPE OF MISTAKE THAT MAKES AN EVAL SAY A SYSTEM IMPROVED WHEN IT GOT
   * NOISIER. Each ground truth matches at most once and so does each find.
   */
  const r = recall([truth(100), truth(120)], [found(110)]);
  assert.equal(r.hit, 1);
  assert.equal(r.missed.length, 1);

  /* And two finds on one timestamp is still one hit. */
  assert.equal(recall([truth(100)], [found(98), found(102)]).hit, 1);
});

test("ACCEPTANCE: a find is attributed to the nearest truth, so the right one is missed", () => {
  /*
   * ONE FIND, TWO TRUTHS, BOTH INSIDE THE WINDOW. The hit COUNT is one either
   * way, which is why an earlier version of this test — two truths and two
   * finds, asserting `hit === 2` — passed with the distance sort deleted. The
   * difference is WHICH truth goes in `missed`, and `missed` is the half that
   * gets read: it carries the note and the provenance a person uses to decide
   * whether the system failed or the list was wrong.
   *
   * A find at 129 belongs to the truth at 128, not to the one at 100.
   */
  const t = [truth(100, { note: "the early one" }), truth(128, { note: "the late one" })];
  const r = recall(t, [found(129)]);
  assert.equal(r.hit, 1);
  assert.deepEqual(r.missed.map((m) => m.note), ["the early one"]);

  /* And it does not depend on the order rows came out of the database. */
  assert.deepEqual(recall([...t].reverse(), [found(129)]).missed.map((m) => m.note), ["the early one"]);

  /* Two truths and two finds, every pairing in window: both are matched. */
  const both = recall([truth(100), truth(125)], [found(124), found(101)]);
  assert.equal(both.hit, 2);
});

test("ACCEPTANCE: only a verified find counts towards recall", () => {
  /*
   * A paraphrase is a near-miss nobody has confirmed and a rejection is a
   * quote that is not in the source. Counting either would let a run score
   * recall for material it has not got.
   */
  const r = recall([truth(100), truth(200)], [found(100, { verify: "paraphrase" }), found(200, { verify: "rejected" })]);
  assert.equal(r.hit, 0);
  assert.equal(r.missed.length, 2);
});

test("a find in a different source does not match", () => {
  /* The same minute of a different stream is a different moment, and the
     window would otherwise match them constantly. */
  assert.equal(recall([truth(100)], [found(100, { sourceId: "s2" })]).hit, 0);
  assert.equal(recall([truth(100)], [found(100, { briefId: "someone-else" })]).hit, 0);
});

test("the misses come back, because they are the interesting half", () => {
  /* A number says how well it did. The misses say what to do about it. */
  const r = recall([truth(100, { note: "the ban" }), truth(500, { note: "the apology" })], [found(102)]);
  assert.equal(r.missed.length, 1);
  assert.equal(r.missed[0].note, "the apology");
  assert.equal(r.missed[0].provenance, "reddit incident thread");
});

test("no ground truth is no recall, not perfect recall", () => {
  /* A brief nobody has labelled has not been measured, and 100% would read as
     a pass. */
  assert.equal(recall([], [found(100)]).recall, 0);
  assert.equal(recall([], []).total, 0);
});

/* ── Precision ──────────────────────────────────────────────────────────── */

test("ACCEPTANCE: misattribution is counted apart from off-beat", () => {
  /*
   * They fail differently. An off-beat find wastes a slot; a misattributed
   * one puts somebody's name on somebody else's words, and that is the one
   * that ends up in a letter from a solicitor. An eval averaging them would
   * hide it rising while precision held.
   */
  const p = precision(["on_beat", "on_beat", "off_beat", "misattributed"]);
  assert.equal(p.onBeat, 2);
  assert.equal(p.offBeat, 1);
  assert.equal(p.misattributed, 1);
  assert.equal(p.precision, 0.5);

  /* Same precision, different disaster. */
  const worse = precision(["on_beat", "on_beat", "misattributed", "misattributed"]);
  assert.equal(worse.precision, 0.5);
  assert.equal(worse.misattributed, 2);
});

test("nothing rated is no precision", () => {
  assert.equal(precision([]).precision, 0);
  assert.equal(precision([]).rated, 0);
});

/* ── The run's own numbers ──────────────────────────────────────────────── */

const run = (over: Partial<Parameters<typeof runMetrics>[0]> = {}) =>
  runMetrics({
    found: [found(100, { foundAtMs: 40_000 }), found(200, { foundAtMs: 90_000 })],
    judged: 10,
    counterBeats: 2,
    counterBeatsCovered: 2,
    spendUsd: 0.4,
    searchListCalls: 6,
    ...over,
  });

test("the verification pass rate is over everything judged, not everything found", () => {
  /* Rejections are the denominator. A rate over the survivors is always 1,
     which is the number a broken harness reports. */
  const m = run({ judged: 10 });
  assert.equal(m.verificationPassRate, 0.2);
});

test("ACCEPTANCE: no counter beats at all is zero coverage, not full", () => {
  /*
   * A plan that never asked for the other side has not covered it. Dividing
   * zero by zero into 1 would make the one failure the decompose validator
   * exists to prevent read as a perfect score.
   */
  assert.equal(run({ counterBeats: 0, counterBeatsCovered: 0 }).counterpointCoverage, 0);
  assert.equal(run({ counterBeats: 2, counterBeatsCovered: 1 }).counterpointCoverage, 0.5);
  assert.equal(run({ counterBeats: 2, counterBeatsCovered: 2 }).counterpointCoverage, 1);
});

test("ACCEPTANCE: time to first good clip is to the first ON-BEAT one", () => {
  /*
   * A run that produces a correct quote about the wrong thing in four seconds
   * has given the user nothing, and measuring to it would reward exactly the
   * behaviour the beat validator exists to prevent.
   */
  const fast = run({
    found: [found(100, { foundAtMs: 4_000 }), found(200, { foundAtMs: 90_000 })],
    ratings: ["off_beat", "on_beat"],
  });
  assert.equal(fast.timeToFirstGoodClipMs, 90_000);

  /* Unrated, verified is the best available answer. */
  assert.equal(run().timeToFirstGoodClipMs, 40_000);
});

test("a run that found nothing has no cost per moment and no first clip", () => {
  /* Zero would read as free and instant. */
  const empty = run({ found: [], judged: 4 });
  assert.equal(empty.costPerAcceptedMoment, null);
  assert.equal(empty.timeToFirstGoodClipMs, null);
  assert.equal(empty.verificationPassRate, 0);
});

test("cost per accepted moment is over the verified ones", () => {
  const m = run({ spendUsd: 1, found: [found(1), found(2), found(3), found(4, { verify: "rejected" })] });
  assert.equal(m.costPerAcceptedMoment, 0.3333);
});

/* ── Saturation ─────────────────────────────────────────────────────────── */

test("ACCEPTANCE: held-out budget is the only honest test of the stopping rule", () => {
  /*
   * The rule's own numbers cannot falsify it: a knee that fires early
   * produces a curve that looks flat, and coverage that holds because the
   * beats were thin to begin with. Spending more after it says stop is the
   * only way to find out.
   */
  const well = saturation(20, 1);
  assert.equal(well.ratio, 0.05);
  assert.equal(well.verdict, "stopped_well");

  const early = saturation(20, 6);
  assert.equal(early.ratio, 0.3);
  assert.equal(early.verdict, "stopped_early");
  assert.ok(SATURATION_LIMIT > 0 && SATURATION_LIMIT < 0.5);
});

test("a run that found nothing and then found something stopped early", () => {
  /* Zero at stop is the worst case for a stopping rule, not an undefined one. */
  assert.equal(saturation(0, 3).verdict, "stopped_early");
  assert.equal(saturation(0, 0).verdict, "stopped_well");
});

/* ── The set ────────────────────────────────────────────────────────────── */

const brief = (briefId: string, over: Partial<BriefResult> = {}): BriefResult => ({
  briefId,
  recall: { hit: 8, missed: [], total: 10, recall: 0.8 },
  precision: { onBeat: 8, offBeat: 2, misattributed: 0, rated: 10, precision: 0.8 },
  verificationPassRate: 0.5,
  counterpointCoverage: 1,
  timeToFirstGoodClipMs: 60_000,
  costPerAcceptedMoment: 0.05,
  searchListCalls: 5,
  ...over,
});

test("ACCEPTANCE: the set is macro-averaged, so one easy brief cannot carry it", () => {
  /*
   * Pooling every find across twenty briefs lets one well-documented subject
   * with ninety timestamps decide the number. What is being measured is
   * whether the system works on A BRIEF, not whether it works on the easiest
   * one hard enough to carry the rest.
   */
  const big = brief("well-documented", { recall: { hit: 90, missed: [], total: 100, recall: 0.9 } });
  const small = brief("obscure", { recall: { hit: 0, missed: [truth(1)], total: 1, recall: 0 } });

  const report = setReport([big, small]);
  assert.equal(report.recall, 0.45, "the mean of 0.9 and 0, not 90 of 101");
  assert.equal(report.briefs, 2);
});

test("ACCEPTANCE: the search.list cap is summed across the set, and reported either way", () => {
  /*
   * THE V0 ACCEPTANCE CRITERION. The cap is a daily total across the API
   * project and that is exactly how it is spent, so it is summed rather than
   * averaged — averaging would say twenty briefs at ten calls each were
   * within a hundred.
   */
  const under = setReport(Array.from({ length: 20 }, (_, i) => brief("b" + i, { searchListCalls: 4 })));
  assert.equal(under.searchListCalls, 80);
  assert.equal(under.withinDailyCap, true);
  assert.match(under.why, /80 search\.list calls across 20 briefs, under the daily cap of 100/);

  const over = setReport(Array.from({ length: 20 }, (_, i) => brief("b" + i, { searchListCalls: 10 })));
  assert.equal(over.searchListCalls, 200);
  assert.equal(over.withinDailyCap, false);
  assert.match(over.why, /OVER the daily cap/);
  assert.match(over.why, /broke tomorrow's/);
  assert.equal(DAILY_SEARCH_CAP, 100);
});

test("briefs whose stopping rule left material behind are named", () => {
  /* A set average would bury one brief that stopped at a third of what was
     there, and that brief is the bug report. */
  const report = setReport([
    brief("fine", { saturation: saturation(20, 1) }),
    brief("too-soon", { saturation: saturation(20, 9) }),
  ]);
  assert.deepEqual(report.stoppedEarly, ["too-soon"]);
});

test("the median time to first clip ignores briefs that never got one", () => {
  /* A brief that found nothing has no time, and treating it as zero or as
     infinity both lie. */
  const report = setReport([
    brief("a", { timeToFirstGoodClipMs: 10_000 }),
    brief("b", { timeToFirstGoodClipMs: null }),
    brief("c", { timeToFirstGoodClipMs: 30_000 }),
  ]);
  assert.equal(report.medianTimeToFirstGoodClipMs, 30_000);
});

test("an empty set says it measured nothing, rather than passing", () => {
  /*
   * The acceptance criterion reads `withinDailyCap`, and an unrun eval is
   * trivially within it. The sentence is what stops that being read as a
   * pass.
   */
  const report = setReport([]);
  assert.equal(report.briefs, 0);
  assert.equal(report.withinDailyCap, true);
  assert.match(report.why, /no briefs were run, so nothing has been measured/);
});

/* ── Ablations ──────────────────────────────────────────────────────────── */

test("ACCEPTANCE: a difference twenty briefs cannot see is not a result", () => {
  /*
   * labs/SCOUT.md says "about 20 briefs shows large effects", which is a
   * statement about POWER and is usually read as a promise about precision.
   * At that n a two-point difference is noise, and reporting it as a result
   * is how a parameter gets tuned to the eval set.
   */
  const big = ablation("counter_branch", 0.8, 0.6);
  assert.equal(big.delta, 0.2);
  assert.equal(big.meaningful, true);

  const noise = ablation("window_size", 0.8, 0.78);
  assert.equal(noise.delta, 0.02);
  assert.equal(noise.meaningful, false);
  assert.equal(MEANINGFUL_DELTA, 0.05);
});

test("an ablation that improves things is reported, not hidden", () => {
  /* A negative delta means the branch was making things worse, which is the
     most useful thing an ablation can find and the easiest to drop by taking
     an absolute value for the comparison and then reporting it. */
  const worse = ablation("vocabulary", 0.6, 0.75);
  assert.equal(worse.delta, -0.15);
  assert.equal(worse.meaningful, true);
});

test("the four ablations are the ones the research names", () => {
  assert.deepEqual([...ABLATIONS], ["counter_branch", "vocabulary", "window_size", "questions_per_window"]);
});
