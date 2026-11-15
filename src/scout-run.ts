/**
 * THE SCOUT RUN: nine modules become one job.
 *
 * Spec 18 section 1 draws it as a workflow — decompose, then rounds of
 * expand · search · triage · scan · verify, then reduce, with snowball
 * sending each round back to expand until stop() fires. Every module for that
 * exists. What has not existed is the thing that decides which happens next,
 * and that is the whole of this file.
 *
 * WRITTEN AS A PLANNER, NOT A LOOP. `nextStep` is a pure function of a
 * snapshot: given where the run is, it says which phase comes next and why.
 * The driver does the work and writes the rows. Three reasons, and the third
 * is the real one:
 *
 *   - A loop cannot be tested without the infrastructure it loops over. This
 *     can be driven through forty states in a millisecond.
 *   - A run that dies halfway resumes by asking the same question again,
 *     because the answer depends on the rows rather than on a call stack.
 *   - A loop hides its own order. The spec's sequence is a paragraph of prose
 *     and this is the only place it becomes a thing that can be wrong.
 *
 * THE STOP RULE AND THE COMPLETION INVARIANT ARE DIFFERENT QUESTIONS, and
 * conflating them is the bug this file is most likely to have. `decideStop`
 * answers "is there any point looking further?" — a judgement about the
 * subject. `completion` answers "has every item of work finished?" — a fact
 * about the job. A run whose curve has flattened while twelve scans are still
 * owed is NOT done; it is a run that has stopped looking for new material and
 * is still reading what it found. Reporting it done is invariant 7's silent
 * partial failure wearing the stopping rule's coat.
 */

import {
  completion,
  type Completion,
  type Item,
} from "./items.ts";
import {
  DEFAULT_BUDGET,
  decideStop,
  type Budget,
  type Decision,
  type RunState as StopState,
  type StopReason,
} from "./scout-stop.ts";

/** The spec's eight steps, plus the two states a run can be in around them. */
export const PHASES = [
  "decompose",
  "expand",
  "search",
  "triage",
  "scan",
  "verify",
  "reduce",
  "snowball",
  "finishing",
  "done",
] as const;
export type Phase = (typeof PHASES)[number];

/**
 * What the driver is told to do next.
 *
 * `why` is not decoration. A run is a thing a person watches for minutes, and
 * "Scout is working" is not a progress report — the board shows this.
 */
export interface Step {
  phase: Phase;
  why: string;
  /** Set only on `done`: which of the spec's five reasons ended the run. */
  stopReason?: StopReason;
}

/**
 * Everything `nextStep` is allowed to look at.
 *
 * A SNAPSHOT OF ROWS, not a bag of flags. Each field is a count the driver
 * can get with one SQL query, so resuming a dead run is a read rather than a
 * reconstruction — and a field that cannot be derived from the database is a
 * field that does not survive a restart.
 */
export interface RunSnapshot {
  /** Step 1 has produced beats. Until then there is nothing to search for. */
  decomposed: boolean;
  /** Rounds of expand → … → snowball completed so far. */
  rounds: number;
  /** Queries written by expand or snowball and not yet issued. */
  queriesPending: number;
  /** Candidates found and not yet triaged. */
  candidatesUntriaged: number;
  /** Sources triage kept, with a readable transcript, not yet scanned. */
  sourcesUnscanned: number;
  /** Scan answers of QUOTE not yet put through the verifier. */
  scansUnverified: number;
  /** Verified rows, which is what reduce ranks and snowball seeds from. */
  verifiedRows: number;
  /** Step 7 has run. It runs once, at the end — see `nextStep`. */
  reduced: boolean;
  /**
   * Snowball has run for the round in progress.
   *
   * A BOOLEAN, NOT A SEED COUNT. The first version of this was
   * `seedsRaised: number`, and a run whose finds raised no seeds — which is
   * every run on a subject nobody has discussed — snowballed for ever,
   * because "no seeds yet" and "nothing to seed" are the same number.
   */
  snowballed: boolean;
  /** Every item of work this run has created. The completion invariant reads these. */
  items: Array<Pick<Item, "id" | "status">>;
  /** The user has explicitly accepted a partial result. */
  degradedAccepted?: boolean;
  /** What `decideStop` needs: the curve, the coverage, the budget spend. */
  stop: StopState;
}

export interface RunStatus {
  step: Step;
  /** The stopping judgement, whatever phase the run is in. */
  decision: Decision;
  /** The completion fact, whatever the stopping judgement says. */
  completion: Completion;
}

/**
 * Which phase comes next, and why.
 *
 * THE ORDER OF THESE CHECKS IS THE SPEC'S SEQUENCE, and it is the only place
 * that sequence is written as code rather than as prose. Read top to bottom:
 *
 *   Nothing can be searched for before there are beats.
 *   Work already started is finished before more is started.
 *   A round ends with snowball, which decides whether there is a next one.
 *   Reduce runs once, after the looking stops.
 *   Done means the looking stopped AND every item is terminal.
 *
 * WORK IN HAND BEATS WORK PROPOSED. Candidates are triaged before new queries
 * are issued, scans are verified before new sources are scanned. A planner
 * that preferred the new would spend a budget discovering material it never
 * read — thirty sources found and four scanned, which looks like diligence
 * and is a bill.
 *
 * ONE DEPARTURE FROM THE SPEC'S DIAGRAM. It draws reduce as step 7 inside the
 * loop, with snowball at 8 sending the round back to 2. Here reduce runs ONCE,
 * after stopping. A ranking of a partial haul is thrown away by the next
 * round, so four rounds would buy three discarded rankings at a frontier call
 * each — and the spec's own cost model prices "decompose and expand ≈
 * $0.05–0.15 per round" and does not price reduce per round. Nothing needs it
 * earlier either: the stopping rule reads the curve, the coverage and the
 * recapture, none of which is a ranking, and snowball's trace seeds read
 * `sourceKind` and `originalOf` rather than an order.
 */
export function nextStep(snap: RunSnapshot, budget: Budget = DEFAULT_BUDGET): Step {
  /* The user's stop and the budget come first, before any judgement about the
     subject — and before any new work is started. Work already in hand is
     still finished, because an item left non-terminal is a job that can never
     be complete. */
  const decision = decideStop(snap.stop, budget);

  if (!snap.decomposed) {
    return { phase: "decompose", why: "working out what to look for" };
  }

  /* WORK IN HAND, in the order it was created. */
  if (snap.candidatesUntriaged > 0) {
    return {
      phase: "triage",
      why: `deciding which of ${snap.candidatesUntriaged} sources are worth reading`,
    };
  }
  if (snap.scansUnverified > 0) {
    return {
      phase: "verify",
      why: `checking ${snap.scansUnverified} quote${snap.scansUnverified === 1 ? "" : "s"} against the recording`,
    };
  }
  if (snap.sourcesUnscanned > 0) {
    return {
      phase: "scan",
      why: `reading ${snap.sourcesUnscanned} source${snap.sourcesUnscanned === 1 ? "" : "s"}`,
    };
  }
  if (snap.queriesPending > 0) {
    /* Queries are the one kind of work the budget may refuse mid-round: every
       one costs quota and money, and the three above are already paid for. */
    if (decision.stop) {
      return { phase: "finishing", why: `${decision.why} — not issuing the ${snap.queriesPending} queries left` };
    }
    return {
      phase: "search",
      why: `${snap.queriesPending} search${snap.queriesPending === 1 ? "" : "es"} to run`,
    };
  }

  /* NOTHING IN HAND. Either look further or stop. */
  if (decision.stop) {
    if (!snap.reduced && snap.verifiedRows > 0) {
      return { phase: "reduce", why: `putting ${snap.verifiedRows} verified moments in order` };
    }
    /*
     * THE CASE THIS FILE EXISTS FOR, and it covers two situations that
     * `completion` already tells apart in its own sentence.
     *
     * Items still owed: a worker died, a queue message is in flight, a
     * reconciler has not fired. The looking has stopped and the reading has
     * not. Reporting `done` here is invariant 7's silent partial failure, and
     * it would arrive WITH a stop reason attached, which makes it look
     * deliberate.
     *
     * Items all stopped, some failed for good: a partial result nobody has
     * accepted. Still not done, because the spec's completion invariant says
     * somebody has to accept it, and a run that concluded anyway hands over a
     * board missing a source nobody was told about.
     *
     * These were two guards until each was broken in turn and the second
     * caught both — `complete` is false in either case and the `why` comes
     * from `completion` either way, so the first could not fire. One guard,
     * with both reasons written down.
     */
    const done = completion(snap.items, { degradedAccepted: snap.degradedAccepted });
    if (!done.complete) return { phase: "finishing", why: done.why };
    return { phase: "done", why: decision.why, stopReason: decision.reason ?? "knee_and_coverage" };
  }

  /*
   * KEEP GOING, AND A ROUND ENDS WITH SNOWBALL. Its last act is deciding what
   * the next round should ask; a round that went straight back to expand would
   * ask the brief's questions again instead of the evidence's.
   *
   * THE TEST FOR "A ROUND IS IN PROGRESS" IS QUERIES ISSUED, not `rounds`.
   * `rounds` is incremented BY snowball, so using it here was circular: the
   * first round never ended, snowball never ran, `rounds` stayed at zero, and
   * the run cycled expand → search → triage → scan → verify until a budget
   * that counts something else happened to stop it. The end-to-end drive
   * caught that, which is what it is for.
   */
  if (!snap.snowballed && snap.stop.queriesIssued > 0) {
    return { phase: "snowball", why: "working out what this round's finds point at" };
  }
  return {
    phase: "expand",
    why: snap.rounds === 0 ? "writing the first round of queries" : `writing round ${snap.rounds + 1}'s queries`,
  };
}

/**
 * Where the run is, what it thinks about the subject, and what is still owed.
 *
 * Three answers rather than one, because they can disagree and the
 * disagreement is the interesting state. A board that showed only the phase
 * would say "finishing" for an hour with nothing explaining why.
 */
export function runStatus(snap: RunSnapshot, budget: Budget = DEFAULT_BUDGET): RunStatus {
  return {
    step: nextStep(snap, budget),
    decision: decideStop(snap.stop, budget),
    completion: completion(snap.items, { degradedAccepted: snap.degradedAccepted }),
  };
}

/** A run is only finished when the planner says `done`. Nothing else may decide. */
export const isFinished = (snap: RunSnapshot, budget: Budget = DEFAULT_BUDGET): boolean =>
  nextStep(snap, budget).phase === "done";

/* ── The items a phase creates ──────────────────────────────────────────── */

/**
 * WHAT COUNTS AS AN ITEM, which the spec names: "one item per search, per
 * scanned source and per verification".
 *
 * The three expensive, repeatable, failable units. Deliberately NOT one per
 * phase: a phase is where the run is, and "scan" as a single item would hide
 * twenty-nine scanned sources behind one row — which is the shape of failure
 * the item table was added to prevent.
 *
 * Decompose, expand, triage, reduce and snowball are one call each and are
 * not items. A failed decompose is a failed run, which the run's own row
 * already says.
 */
export const ITEM_KINDS = ["search", "scan", "verify"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const PHASE_ITEM_KIND: Partial<Record<Phase, ItemKind>> = {
  search: "search",
  scan: "scan",
  verify: "verify",
};

/**
 * The parts of a content address for each kind of item.
 *
 * `contentAddress` hashes whatever it is given, and what it is given is the
 * decision that matters: anything left out means two different pieces of work
 * share a key and the second silently gets the first's result.
 *
 * A SEARCH is the adapter, the query and the family — the same words on two
 * platforms are two searches, and the family is in because a query reached by
 * the vocab route and by the seed route have different diligence stories even
 * where the words coincide.
 *
 * A SCAN is the source, the window and the BEAT, plus the model and the prompt
 * version. The beat is the part somebody would leave out: the spec forbids one
 * combined question, so the same window is scanned once per beat and those are
 * different pieces of work with different answers.
 *
 * A VERIFICATION is the quote and the source. No model and no prompt version,
 * because the verifier is deterministic — which is exactly why its results are
 * safe to cache for ever.
 */
export function itemParts(
  kind: ItemKind,
  of: {
    runId: string;
    adapter?: string;
    query?: string;
    family?: string;
    sourceId?: string;
    beatId?: string;
    windowStart?: number;
    quote?: string;
    model?: string;
    promptVersion?: string;
  },
): Record<string, string | number | undefined> {
  switch (kind) {
    case "search":
      return { kind, adapter: of.adapter, query: of.query, family: of.family };
    case "scan":
      return {
        kind,
        source: of.sourceId,
        beat: of.beatId,
        window: of.windowStart,
        model: of.model,
        prompt: of.promptVersion,
      };
    case "verify":
      return { kind, source: of.sourceId, quote: of.quote };
  }
}

/* ── Writing the run down ───────────────────────────────────────────────── */

export interface RunRow {
  status: "queued" | "running" | "done" | "stopped" | "failed";
  stopReason: StopReason | null;
  rounds: number;
  spendUsd: number;
  finishedAt: number | null;
}

/**
 * The run's own row, from the planner's answer.
 *
 * ONE PLACE DECIDES, so the row and the board cannot disagree. A status
 * written by whichever handler happened to finish last is how a run ends up
 * saying `done` with a stop reason of `budget_spend` and twelve scans owed.
 *
 * `stopped` rather than `done` when the user pressed stop: the difference is
 * the whole of what a person asks the board afterwards, and a run that
 * recorded both the same way could not answer it.
 */
export function rowFor(snap: RunSnapshot, now: number, budget: Budget = DEFAULT_BUDGET): RunRow {
  const step = nextStep(snap, budget);
  const base = { rounds: snap.rounds, spendUsd: snap.stop.spendUsd };

  if (step.phase === "done") {
    return {
      ...base,
      status: step.stopReason === "user" ? "stopped" : "done",
      stopReason: step.stopReason ?? null,
      finishedAt: now,
    };
  }

  return {
    ...base,
    /* `running` while there is anything left to do, including `finishing`. A
       run waiting on twelve scans is running, not done and not failed, and
       the board's own words for that state are what `why` carries. */
    status: snap.decomposed || snap.rounds > 0 ? "running" : "queued",
    stopReason: null,
    finishedAt: null,
  };
}
