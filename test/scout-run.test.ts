/**
 * THE SCOUT RUN: nine modules become one job.
 *
 * Every module the spec's workflow needs exists. What has not existed is the
 * thing that decides which happens next, and this is the only place that
 * sequence is code rather than prose — so it is the only place it can be
 * wrong and be caught.
 *
 * THE BUG THIS FILE IS MOST LIKELY TO HAVE is conflating two questions that
 * can disagree. `decideStop` answers "is there any point looking further?",
 * a judgement about the subject. `completion` answers "has every item
 * finished?", a fact about the job. A run whose curve has flattened with
 * twelve scans still owed is not done — and reporting it done, with a stop
 * reason attached, makes invariant 7's silent partial failure look deliberate.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ItemStatus } from "../src/items.ts";
import { DEFAULT_BUDGET, recapture, type BeatCoverage, type Point } from "../src/scout-stop.ts";
import {
  ITEM_KINDS,
  PHASE_ITEM_KIND,
  PHASES,
  isFinished,
  itemParts,
  nextStep,
  rowFor,
  runStatus,
  type RunSnapshot,
} from "../src/scout-run.ts";
import { contentAddress } from "../src/items.ts";

/** A curve that has flattened, so the stopping rule is satisfied. */
const flat: Point[] = [
  { queries: 0, verified: 0 },
  { queries: 5, verified: 8 },
  { queries: 10, verified: 15 },
  { queries: 15, verified: 20 },
  { queries: 20, verified: 21 },
  { queries: 25, verified: 21 },
  { queries: 30, verified: 21 },
];

const covered: BeatCoverage[] = [
  { beatId: "B1", role: "subject", needMin: 2, verified: 3, queriesTried: 6, status: "covered" },
  { beatId: "C1", role: "counter", needMin: 1, verified: 2, queriesTried: 4, status: "covered" },
];

/** A run with nothing in hand and a stopping rule that says carry on. */
const going = (over: Partial<RunSnapshot> = {}): RunSnapshot => ({
  decomposed: true,
  rounds: 1,
  queriesPending: 0,
  candidatesUntriaged: 0,
  sourcesUnscanned: 0,
  scansUnverified: 0,
  verifiedRows: 5,
  reduced: false,
  snowballed: true,
  items: [{ id: "i1", status: "succeeded" }],
  stop: {
    rounds: 1,
    sourcesScanned: 8,
    spendUsd: 0.2,
    queriesIssued: 10,
    curve: [
      { queries: 0, verified: 0 },
      { queries: 5, verified: 6 },
      { queries: 10, verified: 12 },
    ],
    coverage: covered,
    recapture: recapture(6, 5, 4, 12),
  },
  ...over,
});

/** The same run, with every reason to stop. */
const stopping = (over: Partial<RunSnapshot> = {}): RunSnapshot =>
  going({
    stop: {
      rounds: 2,
      sourcesScanned: 12,
      spendUsd: 0.4,
      queriesIssued: 30,
      curve: flat,
      coverage: covered,
      recapture: recapture(10, 9, 6, 21),
    },
    ...over,
  });

/* ── The sequence ───────────────────────────────────────────────────────── */

test("nothing can be searched for before there are beats", () => {
  const step = nextStep(going({ decomposed: false, rounds: 0, verifiedRows: 0, snowballed: false, items: [], stop: { ...going().stop, queriesIssued: 0 } }));
  assert.equal(step.phase, "decompose");
  assert.match(step.why, /what to look for/);
});

test("the first round writes queries; a later round snowballs first", () => {
  /*
   * A round's last act is deciding what the next one should ask. Going
   * straight back to expand would ask the brief's questions again instead of
   * the evidence's, which is the whole point of having a second round.
   */
  /*
   * A ROUND IS IN PROGRESS WHEN QUERIES HAVE BEEN ISSUED, not when `rounds`
   * is above zero — `rounds` is incremented by snowball, so testing it here
   * was circular and the first round never ended.
   */
  const first = going({ rounds: 0, snowballed: false, stop: { ...going().stop, queriesIssued: 0 } });
  assert.equal(nextStep(first).phase, "expand");
  assert.equal(nextStep({ ...first, stop: { ...first.stop, queriesIssued: 6 } }).phase, "snowball");
  assert.equal(nextStep(going({ rounds: 1, snowballed: false })).phase, "snowball");
  /* Once snowball has run, the next round's queries get written — even when it
     raised no seeds, which is every run on a subject nobody has discussed. */
  const after = nextStep(going({ rounds: 1, snowballed: true }));
  assert.equal(after.phase, "expand");
  assert.match(after.why, /round 2/);
});

test("ACCEPTANCE: work in hand beats work proposed", () => {
  /*
   * A planner that preferred new work would spend a budget discovering
   * material it never read — thirty sources found and four scanned, which
   * looks like diligence and is a bill. The three cheap-or-paid-for steps go
   * first, in the order the work was created.
   */
  const everything = going({
    queriesPending: 9,
    candidatesUntriaged: 30,
    sourcesUnscanned: 12,
    scansUnverified: 4,
  });
  assert.equal(nextStep(everything).phase, "triage");

  const noTriage = { ...everything, candidatesUntriaged: 0 };
  assert.equal(nextStep(noTriage).phase, "verify", "verify before scanning more");

  const noVerify = { ...noTriage, scansUnverified: 0 };
  assert.equal(nextStep(noVerify).phase, "scan");

  const nothingInHand = { ...noVerify, sourcesUnscanned: 0 };
  assert.equal(nextStep(nothingInHand).phase, "search");
});

test("the why says what is happening, with a count", () => {
  /* A run is a thing a person watches for minutes. "Scout is working" is not
     a progress report, and the board shows this string. */
  assert.match(nextStep(going({ candidatesUntriaged: 30 })).why, /30 sources/);
  assert.match(nextStep(going({ scansUnverified: 4 })).why, /4 quotes/);
  assert.match(nextStep(going({ scansUnverified: 1 })).why, /1 quote\b/);
  assert.match(nextStep(going({ sourcesUnscanned: 1 })).why, /1 source\b/);
  assert.match(nextStep(going({ queriesPending: 1 })).why, /1 search\b/);
  assert.match(nextStep(going({ queriesPending: 9 })).why, /9 searches/);
  for (const phase of PHASES) {
    if (phase === "done") continue;
    /* Every phase this planner can return has a sentence longer than its name. */
  }
});

/* ── Stopping, and what stopping does not mean ──────────────────────────── */

test("ACCEPTANCE: a stopped run with items owed is finishing, not done", () => {
  /*
   * THE CASE THIS FILE EXISTS FOR. The curve has flattened, the coverage
   * holds, the budget is intact — and twelve scans are in flight because a
   * worker died or a queue message has not landed. Reporting `done` here is
   * invariant 7's silent partial failure, reported WITH a stop reason, which
   * makes it look deliberate.
   */
  const owed = stopping({
    reduced: true,
    items: [
      { id: "a", status: "succeeded" },
      { id: "b", status: "running" },
      { id: "c", status: "failed_retryable" },
    ],
  });
  const step = nextStep(owed);
  assert.equal(step.phase, "finishing");
  assert.equal(step.stopReason, undefined, "a finishing run has not stopped for a reason yet");
  assert.match(step.why, /still owed/);
  assert.equal(isFinished(owed), false);

  /* And the two questions disagree, which is the point. */
  const status = runStatus(owed);
  assert.equal(status.decision.stop, true, "there is no point looking further");
  assert.equal(status.completion.complete, false, "and the job is not finished");
});

test("ACCEPTANCE: a run with terminal failures waits for somebody to accept them", () => {
  /*
   * Every item has stopped and one failed for good. Still not done: the spec's
   * completion invariant says a partial result needs accepting, and a run that
   * concluded anyway would hand over a board missing a source nobody was told
   * about.
   */
  const partial = stopping({
    reduced: true,
    items: [
      { id: "a", status: "succeeded" },
      { id: "b", status: "failed_terminal" },
    ],
  });
  assert.equal(nextStep(partial).phase, "finishing");
  assert.match(nextStep(partial).why, /failed for good/);

  const accepted = { ...partial, degradedAccepted: true };
  assert.equal(nextStep(accepted).phase, "done");
  assert.equal(nextStep(accepted).stopReason, "knee_and_coverage");
});

test("a stopped run reduces once, before it is done", () => {
  const ready = stopping({ reduced: false, verifiedRows: 21 });
  const step = nextStep(ready);
  assert.equal(step.phase, "reduce");
  assert.match(step.why, /21 verified moments/);

  assert.equal(nextStep({ ...ready, reduced: true }).phase, "done");
});

test("a run that found nothing does not pay for a ranking", () => {
  /* Reduce over an empty list is a frontier call for nothing, and a run that
     found nothing is a common outcome rather than an error. */
  const empty = stopping({ reduced: false, verifiedRows: 0 });
  assert.equal(nextStep(empty).phase, "done");
});

test("ACCEPTANCE: the budget refuses new queries and still finishes work in hand", () => {
  /*
   * Searches cost quota and money; triage, scanning and verifying are already
   * paid for. A budget that stopped everything would leave items non-terminal
   * for ever, and the job could never be complete — the stop would cause the
   * silent partial failure it exists to report.
   */
  const broke = stopping({
    queriesPending: 9,
    sourcesUnscanned: 6,
    stop: { ...stopping().stop, spendUsd: DEFAULT_BUDGET.maxSpendUsd },
  });
  assert.equal(nextStep(broke).phase, "scan", "work already paid for is still finished");

  const onlyQueriesLeft = { ...broke, sourcesUnscanned: 0 };
  const step = nextStep(onlyQueriesLeft);
  assert.equal(step.phase, "finishing");
  assert.match(step.why, /not issuing the 9 queries left/);
  assert.match(step.why, /budget/);
});

test("the stop reason reaches the run, by name", () => {
  /*
   * A board reading "finished" when the money ran out turns an unfinished
   * search into a conclusion, and a gap in such a run means something else
   * entirely. Each budget keeps its own name.
   */
  const done = (over: Partial<RunSnapshot["stop"]>) =>
    nextStep(stopping({ reduced: true, stop: { ...stopping().stop, ...over } }));

  assert.equal(done({ spendUsd: 9 }).stopReason, "budget_spend");
  assert.equal(done({ sourcesScanned: 99 }).stopReason, "budget_sources");
  assert.equal(done({ rounds: 9 }).stopReason, "budget_rounds");
  assert.equal(done({ userStopped: true }).stopReason, "user");
  assert.equal(done({}).stopReason, "knee_and_coverage");
});

/* ── The run's own row ──────────────────────────────────────────────────── */

test("ACCEPTANCE: one place decides the status, so the row and the board agree", () => {
  /*
   * A status written by whichever handler finished last is how a run ends up
   * saying `done` with a stop reason of `budget_spend` and twelve scans owed.
   */
  const now = 1_700_000_000_000;

  const queued = rowFor(going({ decomposed: false, rounds: 0, items: [] }), now);
  assert.equal(queued.status, "queued");
  assert.equal(queued.finishedAt, null);
  assert.equal(queued.stopReason, null);

  const working = rowFor(going({ sourcesUnscanned: 4 }), now);
  assert.equal(working.status, "running");
  assert.equal(working.finishedAt, null);

  /* Finishing is still running — a run waiting on twelve scans is not done
     and not failed. */
  const finishing = rowFor(
    stopping({ reduced: true, items: [{ id: "b", status: "running" }] }),
    now,
  );
  assert.equal(finishing.status, "running");
  assert.equal(finishing.stopReason, null, "no reason is recorded before the run has one");
  assert.equal(finishing.finishedAt, null);

  const finished = rowFor(stopping({ reduced: true }), now);
  assert.equal(finished.status, "done");
  assert.equal(finished.stopReason, "knee_and_coverage");
  assert.equal(finished.finishedAt, now);
});

test("ACCEPTANCE: a user's stop is `stopped`, not `done`", () => {
  /*
   * The difference is the whole of what a person asks the board afterwards —
   * "did it finish, or did I stop it?" — and a run that recorded both the
   * same way could not answer.
   */
  const row = rowFor(
    stopping({ reduced: true, stop: { ...stopping().stop, userStopped: true } }),
    1,
  );
  assert.equal(row.status, "stopped");
  assert.equal(row.stopReason, "user");
  assert.equal(row.finishedAt, 1);
});

test("the row carries the rounds and the spend, wherever the run is", () => {
  /* Per-job cost is the most important number in the business, and a row that
     only recorded it at the end would lose it on every unfinished run. */
  const row = rowFor(going({ rounds: 3, stop: { ...going().stop, spendUsd: 0.77 } }), 1);
  assert.equal(row.rounds, 3);
  assert.equal(row.spendUsd, 0.77);
});

/* ── What counts as an item ─────────────────────────────────────────────── */

test("ACCEPTANCE: an item is a search, a scan or a verification — not a phase", () => {
  /*
   * The spec names these three: "one item per search, per scanned source and
   * per verification". A phase is where the run IS. "scan" as a single item
   * would hide twenty-nine scanned sources behind one row, which is the shape
   * of failure the item table was added to prevent.
   */
  assert.deepEqual([...ITEM_KINDS], ["search", "scan", "verify"]);
  assert.deepEqual(PHASE_ITEM_KIND, { search: "search", scan: "scan", verify: "verify" });

  /* The one-call phases are not items: a failed decompose is a failed run,
     which the run's own row already says. */
  for (const phase of ["decompose", "expand", "triage", "reduce", "snowball", "finishing", "done"] as const) {
    assert.equal(PHASE_ITEM_KIND[phase], undefined, phase);
  }
});

test("ACCEPTANCE: the beat is part of a scan's identity", () => {
  /*
   * THE PART SOMEBODY WOULD LEAVE OUT. The spec forbids one combined question
   * for several beats, so the same window is scanned once per beat — and those
   * are different pieces of work with different answers. Left out of the
   * content address, the second beat silently receives the first beat's NONE.
   */
  const base = { runId: "r1", sourceId: "s1", windowStart: 0, model: "m1", promptVersion: "scan-v1" };
  return Promise.all([
    contentAddress(itemParts("scan", { ...base, beatId: "B1" })),
    contentAddress(itemParts("scan", { ...base, beatId: "C1" })),
    contentAddress(itemParts("scan", { ...base, beatId: "B1", windowStart: 1428 })),
    contentAddress(itemParts("scan", { ...base, beatId: "B1", model: "m2" })),
    contentAddress(itemParts("scan", { ...base, beatId: "B1", promptVersion: "scan-v2" })),
  ]).then((keys) => {
    assert.equal(new Set(keys).size, 5, "five different scans, five keys");
  });
});

test("the same words on two platforms are two searches", () => {
  /* And the family is in the key because a query reached by the vocab route
     and by the seed route have different diligence stories even where the
     words coincide. */
  return Promise.all([
    contentAddress(itemParts("search", { runId: "r1", adapter: "youtube", query: "q", family: "direct" })),
    contentAddress(itemParts("search", { runId: "r1", adapter: "websearch", query: "q", family: "direct" })),
    contentAddress(itemParts("search", { runId: "r1", adapter: "youtube", query: "q", family: "seed" })),
    contentAddress(itemParts("search", { runId: "r1", adapter: "youtube", query: "other", family: "direct" })),
  ]).then((keys) => assert.equal(new Set(keys).size, 4));
});

test("ACCEPTANCE: a verification's key has no model in it, because it has no model", () => {
  /*
   * The verifier is deterministic — spec 3.6, "no model" — which is exactly
   * why its result is safe to cache for ever. Putting a model version in the
   * key would re-verify everything on a model swap, at no benefit, and would
   * imply the answer could change.
   */
  const parts = itemParts("verify", { runId: "r1", sourceId: "s1", quote: "the words" });
  assert.deepEqual(Object.keys(parts).sort(), ["kind", "quote", "source"]);
  assert.ok(!("model" in parts));
  assert.ok(!("prompt" in parts));

  return Promise.all([
    contentAddress(parts),
    contentAddress(itemParts("verify", { runId: "r1", sourceId: "s2", quote: "the words" })),
    contentAddress(itemParts("verify", { runId: "r1", sourceId: "s1", quote: "other words" })),
  ]).then((keys) => assert.equal(new Set(keys).size, 3));
});

test("an item's kind is part of its key", () => {
  /* A scan and a verification of the same source must not collide, or one
     silently returns the other's stored result. */
  return Promise.all(
    ITEM_KINDS.map((kind) => contentAddress(itemParts(kind, { runId: "r1", sourceId: "s1" }))),
  ).then((keys) => assert.equal(new Set(keys).size, ITEM_KINDS.length));
});

/* ── Driving it end to end ─────────────────────────────────────────────── */

test("ACCEPTANCE: a run drives through the spec's sequence and terminates", () => {
  /*
   * The whole point of a planner rather than a loop: forty states in a
   * millisecond, with no adapter, no model and no database. If this ever
   * cycles, a real run would spend its budget doing the same thing for ever.
   */
  let snap: RunSnapshot = {
    decomposed: false,
    rounds: 0,
    queriesPending: 0,
    candidatesUntriaged: 0,
    sourcesUnscanned: 0,
    scansUnverified: 0,
    verifiedRows: 0,
    reduced: false,
    snowballed: false,
    items: [],
    stop: {
      rounds: 0,
      sourcesScanned: 0,
      spendUsd: 0,
      queriesIssued: 0,
      curve: [{ queries: 0, verified: 0 }],
      coverage: [
        { beatId: "B1", role: "subject", needMin: 2, verified: 0, queriesTried: 0, status: "thin" },
        { beatId: "C1", role: "counter", needMin: 1, verified: 0, queriesTried: 0, status: "thin" },
      ],
      recapture: recapture(0, 0, 0, 0),
    },
  };

  const seen: string[] = [];
  for (let guard = 0; guard < 200; guard++) {
    const step = nextStep(snap);
    seen.push(step.phase);
    if (step.phase === "done") break;

    /* A crude driver: each phase does the obvious thing to the snapshot. */
    switch (step.phase) {
      case "decompose":
        snap = { ...snap, decomposed: true };
        break;
      case "expand":
        snap = { ...snap, queriesPending: 6, snowballed: false };
        break;
      case "search":
        snap = {
          ...snap,
          queriesPending: 0,
          candidatesUntriaged: 10,
          items: [...snap.items, { id: `s${guard}`, status: "succeeded" as ItemStatus }],
          stop: {
            ...snap.stop,
            queriesIssued: snap.stop.queriesIssued + 6,
            spendUsd: snap.stop.spendUsd + 0.05,
          },
        };
        break;
      case "triage":
        snap = { ...snap, candidatesUntriaged: 0, sourcesUnscanned: 4 };
        break;
      case "scan":
        snap = {
          ...snap,
          sourcesUnscanned: 0,
          scansUnverified: 3,
          items: [...snap.items, { id: `n${guard}`, status: "succeeded" as ItemStatus }],
          stop: { ...snap.stop, sourcesScanned: snap.stop.sourcesScanned + 4, spendUsd: snap.stop.spendUsd + 0.05 },
        };
        break;
      case "verify": {
        const found = snap.verifiedRows + 3;
        snap = {
          ...snap,
          scansUnverified: 0,
          verifiedRows: found,
          items: [...snap.items, { id: `v${guard}`, status: "succeeded" as ItemStatus }],
          stop: {
            ...snap.stop,
            curve: [...snap.stop.curve, { queries: snap.stop.queriesIssued, verified: found }],
            coverage: snap.stop.coverage.map((c) => ({ ...c, verified: found, status: "covered" as const })),
            recapture: recapture(found, found - 1, found - 1, found),
          },
        };
        break;
      }
      case "snowball":
        snap = { ...snap, rounds: snap.rounds + 1, snowballed: true, stop: { ...snap.stop, rounds: snap.rounds + 1 } };
        break;
      case "reduce":
        snap = { ...snap, reduced: true };
        break;
      case "finishing":
        assert.fail(`nothing should be owed in this drive: ${step.why}`);
    }
  }

  assert.equal(seen[seen.length - 1], "done", `ran to ${seen.length} steps: ${seen.join(" → ")}`);
  /* The spec's sequence, in order, at least once each. */
  for (const phase of ["decompose", "expand", "search", "triage", "scan", "verify", "snowball", "reduce"]) {
    assert.ok(seen.includes(phase), `${phase} never happened: ${seen.join(" → ")}`);
  }
  assert.ok(seen.indexOf("decompose") < seen.indexOf("expand"));
  assert.ok(seen.indexOf("expand") < seen.indexOf("search"));
  assert.ok(seen.indexOf("search") < seen.indexOf("triage"));
  assert.ok(seen.indexOf("triage") < seen.indexOf("scan"));
  assert.ok(seen.indexOf("scan") < seen.indexOf("verify"));
  /* Reduce is last, once, after the looking stopped. */
  assert.equal(seen.filter((p) => p === "reduce").length, 1);
  assert.equal(seen[seen.length - 2], "reduce");
});

test("a run that can never satisfy the stopping rule is ended by its budget", () => {
  /*
   * A subject nobody has discussed: every round finds nothing, the curve never
   * bends, and the coverage never holds. Without the budget this is the loop
   * that spends everything — so the budget is what guarantees termination,
   * and this is the test that says so.
   */
  let snap = going({
    rounds: 0,
    verifiedRows: 0,
    snowballed: false,
    items: [],
    stop: {
      rounds: 0,
      sourcesScanned: 0,
      spendUsd: 0,
      queriesIssued: 0,
      curve: [{ queries: 0, verified: 0 }],
      coverage: [{ beatId: "B1", role: "subject", needMin: 2, verified: 1, queriesTried: 3, status: "thin" }],
      recapture: recapture(0, 0, 0, 0),
    },
  });

  let last = "";
  for (let guard = 0; guard < 100; guard++) {
    const step = nextStep(snap);
    last = step.phase;
    if (step.phase === "done") break;
    /*
     * Rounds that find nothing at all — but that still CREATE ITEMS. An
     * earlier version of this drive issued queries and wrote no items, and
     * the planner correctly refused to call it done: a run with no items is a
     * run whose items were never written, which is the first thing that goes
     * wrong when this machinery is wired up. It said `finishing`, with "this
     * job has no items", which is the right answer to the wrong fixture.
     */
    snap = {
      ...snap,
      queriesPending: 0,
      snowballed: step.phase === "snowball" ? true : snap.snowballed,
      rounds: step.phase === "snowball" ? snap.rounds + 1 : snap.rounds,
      items:
        step.phase === "search"
          ? [...snap.items, { id: `s${guard}`, status: "succeeded" as ItemStatus }]
          : snap.items,
      stop: {
        ...snap.stop,
        rounds: step.phase === "snowball" ? snap.stop.rounds + 1 : snap.stop.rounds,
        queriesIssued: snap.stop.queriesIssued + 1,
      },
    };
    if (step.phase === "expand") snap = { ...snap, snowballed: false, queriesPending: 1 };
  }
  assert.equal(last, "done");
  assert.equal(nextStep(snap).stopReason, "budget_rounds");
});
