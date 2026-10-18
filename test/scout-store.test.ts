/**
 * THE SCOUT STORE: nine tables, written and read back.
 *
 * Every module of the run has been pure until now, which is why they are
 * testable. This is where they touch the database, and it is what makes the
 * rest of it a feature rather than a library.
 *
 * THE CONTRACT THAT MATTERS is between this file and `scout-run.ts`. The
 * planner is a function of a snapshot rather than a loop, so a run that dies
 * halfway resumes by asking the same question again — but only if the
 * question can actually be asked of the database. Every field of RunSnapshot
 * has to be a count this file can get, and one that could not be would be a
 * field that does not survive a restart.
 *
 * The DDL comes out of migrations/schema.sql, which the fidelity gate
 * guarantees matches the schema that runs, rather than being retyped here
 * where it could be retyped wrong in the same direction as the bug.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fakeD1 } from "./helpers/fake-d1.ts";
import { nextStep, type RunSnapshot } from "../src/scout-run.ts";
import { recapture } from "../src/scout-stop.ts";
import {
  createRun,
  diligence,
  getBeats,
  markScanned,
  queriesTried,
  setOriginalOf,
  setTriage,
  snapshot,
  writeBeats,
  writeLedger,
  writeRunRow,
  writeSearches,
  writeSources,
} from "../src/scout-store.ts";
import type { ScoutBeat } from "../src/scout-decompose.ts";
import type { SourceCandidate } from "../src/scout-adapters.ts";

const SCHEMA = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../migrations/schema.sql"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

/** The real DDL for the tables this file touches, plus what they reference. */
function db() {
  const d = new DatabaseSync(":memory:");
  /*
   * FOREIGN KEYS STAY ON. node:sqlite enforces them, and that is worth
   * keeping: a store writing a beat for a run that does not exist, or a
   * ledger row for a source that does not, is a bug this catches for free.
   * The price is that every table a listed one REFERENCES has to be here
   * too — `sources` is in this list only because v2_projects points at it.
   */
  const want = [
    "v2_users",
    "sources",
    "v2_projects",
    "jobs",
    "job_items",
    "scout_runs",
    "scout_beats",
    "scout_searches",
    "scout_sources",
    "scout_ledger",
    "plans",
    "plan_beats",
  ];
  for (const name of want) {
    const ddl = SCHEMA.split(";").find((s) =>
      new RegExp(`create table if not exists ${name}\\s*\\(`, "i").test(s),
    );
    assert.ok(ddl, `migrations/schema.sql has no ${name} — run \`npm run schema\``);
    d.exec(ddl + ";");
  }
  d.prepare("INSERT INTO v2_users (id, email, created_at) VALUES ('u1', 'a@b.c', 1)").run();
  d.prepare(
    "INSERT INTO v2_projects (id, user_id, title, kind, created_at, updated_at) VALUES ('p1','u1','P','cut',1,1)",
  ).run();
  return d;
}

const NOW = 1_700_000_000_000;

const beats: ScoutBeat[] = [
  { id: "B1", role: "subject", name: "The pattern", behaviour: "Berates live chat", needMin: 2 },
  { id: "C1", role: "counter", name: "His explanation", behaviour: "Reads out his chat rules", needMin: 1, inverts: "B1" },
];

const candidate = (over: Partial<SourceCandidate> = {}): SourceCandidate => ({
  adapter: "youtube",
  externalId: "v1",
  url: "https://www.youtube.com/watch?v=v1",
  title: "A stream",
  transcript: "none",
  ...over,
});

const stopState = (over: Partial<RunSnapshot["stop"]> = {}): RunSnapshot["stop"] => ({
  rounds: 0,
  sourcesScanned: 0,
  spendUsd: 0,
  queriesIssued: 0,
  curve: [{ queries: 0, verified: 0 }],
  coverage: [],
  recapture: recapture(0, 0, 0, 0),
  ...over,
});

/* ── Runs and beats ─────────────────────────────────────────────────────── */

test("a run is created queued, and the planner's row is what gets written", async () => {
  /*
   * `rowFor` in scout-run.ts decides the status; this writes what it decided.
   * Two places that both decide is how a run ends up saying `done` with a
   * stop reason and twelve scans owed.
   */
  const d = db();
  const D = fakeD1(d) as never;
  const runId = await createRun(D, { projectId: "p1", trigger: "plan", brief: "about his chat" }, NOW);

  const created = d.prepare("SELECT * FROM scout_runs WHERE id = ?").get(runId) as Record<string, unknown>;
  assert.equal(created.status, "queued");
  assert.equal(created.project_id, "p1");
  assert.equal(created.brief, "about his chat");
  assert.equal(created.stop_reason, null);

  await writeRunRow(D, runId, {
    status: "done",
    stopReason: "knee_and_coverage",
    rounds: 3,
    spendUsd: 0.42,
    finishedAt: NOW + 1000,
  });
  const done = d.prepare("SELECT * FROM scout_runs WHERE id = ?").get(runId) as Record<string, unknown>;
  assert.equal(done.status, "done");

  /*
   * AND A STATUS THAT IS NOT `done` SURVIVES TOO. An earlier version of this
   * test only ever wrote `done`, so hardcoding the status here passed — and a
   * run waiting on twelve scans would have been recorded as finished.
   */
  await writeRunRow(D, runId, { status: "running", stopReason: null, rounds: 1, spendUsd: 0.1, finishedAt: null });
  const running = d.prepare("SELECT * FROM scout_runs WHERE id = ?").get(runId) as Record<string, unknown>;
  assert.equal(running.status, "running");
  assert.equal(running.finished_at, null);

  await writeRunRow(D, runId, { status: "stopped", stopReason: "user", rounds: 1, spendUsd: 0.1, finishedAt: NOW });
  assert.equal(
    (d.prepare("SELECT status FROM scout_runs WHERE id = ?").get(runId) as { status: string }).status,
    "stopped",
  );
  assert.equal(done.stop_reason, "knee_and_coverage");
  assert.equal(done.rounds, 3);
  assert.equal(done.spend_usd, 0.42);
  assert.equal(done.finished_at, NOW + 1000);
});

test("ACCEPTANCE: a beat reads back under the id everything else refers to", () => {
  /*
   * Rows are keyed `<run>:<beat>` so two runs on one project can both have a
   * B1. But a counter beat's `inverts`, a search row and a ledger row all say
   * "B1" — handing back the composite would break every one of them, and it
   * would break quietly, as a counter beat that inverts nothing.
   */
  const d = db();
  const D = fakeD1(d) as never;
  return (async () => {
    const runId = await createRun(D, { projectId: "p1", trigger: "plan" }, NOW);
    await writeBeats(D, { runId, projectId: "p1", beats });

    const back = await getBeats(D, runId);
    assert.deepEqual(back.map((b) => b.id), ["B1", "C1"]);
    /*
     * IN THE ORDER THEY WERE WRITTEN, which is the order the model put them in
     * and the order the board shows.
     *
     * THREE BEATS, NAMED SO THAT NEITHER DIRECTION COINCIDES. Two names sort
     * one way or the other and an ORDER BY in the lucky direction passes —
     * which an earlier version of this did. With B, A, C written in that
     * order, ascending gives A B C and descending gives C B A, and only `idx`
     * gives back what was written.
     */
    const ordered = await createRun(D, { projectId: "p1", trigger: "ask" }, NOW + 5);
    await writeBeats(D, {
      runId: ordered,
      projectId: "p1",
      beats: [
        { id: "B1", role: "subject", name: "B", behaviour: "x", needMin: 1 },
        { id: "B2", role: "subject", name: "A", behaviour: "y", needMin: 1 },
        { id: "B3", role: "subject", name: "C", behaviour: "z", needMin: 1 },
      ],
    });
    assert.deepEqual((await getBeats(D, ordered)).map((b) => b.name), ["B", "A", "C"]);
    assert.equal(back[1].inverts, "B1", "and the chain still points at something");
    assert.equal(back[0].name, "The pattern");
    assert.equal(back[0].needMin, 2);
    assert.equal(back[1].role, "counter");

    /* The row id is the composite, so two runs can coexist. */
    assert.equal(back[0].rowId, `${runId}:B1`);
  })();
});

test("a beat marked counter_gap reads back marked", async () => {
  /* The board shows that nothing was sought against it. A flag that did not
     survive the round trip would quietly re-balance the argument. */
  const d = db();
  const D = fakeD1(d) as never;
  const runId = await createRun(D, { projectId: "p1", trigger: "plan" }, NOW);
  await writeBeats(D, {
    runId,
    projectId: "p1",
    beats: [{ ...beats[0], counterGap: true }],
  });
  assert.equal((await getBeats(D, runId))[0].counterGap, true);
});

test("two runs on one project each keep their own B1", async () => {
  const d = db();
  const D = fakeD1(d) as never;
  const a = await createRun(D, { projectId: "p1", trigger: "plan" }, NOW);
  const b = await createRun(D, { projectId: "p1", trigger: "ask" }, NOW + 1);
  await writeBeats(D, { runId: a, projectId: "p1", beats });
  await writeBeats(D, { runId: b, projectId: "p1", beats });

  assert.equal((await getBeats(D, a)).length, 2);
  assert.equal((await getBeats(D, b)).length, 2);
});

/* ── Searches ───────────────────────────────────────────────────────────── */

test("ACCEPTANCE: a search that did not happen is a row too", async () => {
  /*
   * This table IS the diligence log. A refusal written as nothing is the
   * silent partial failure the quota rows exist to prevent — "sought 6
   * searches, found 2" with four of the six never having left the building.
   */
  const d = db();
  const D = fakeD1(d) as never;
  const runId = await createRun(D, { projectId: "p1", trigger: "plan" }, NOW);
  await writeBeats(D, { runId, projectId: "p1", beats });

  await writeSearches(
    D,
    [
      { runId, beatId: "B1", family: "direct", adapter: "youtube", query: "a", resultsN: 3, quotaUnits: 1, outcome: "ok" },
      {
        runId,
        beatId: "B1",
        family: "direct",
        adapter: "youtube",
        query: "b",
        resultsN: 0,
        quotaUnits: 0,
        outcome: "quota_exhausted",
        failReason: "the daily search.list budget is spent",
      },
    ],
    NOW,
  );

  const rows = d.prepare("SELECT * FROM scout_searches WHERE run_id = ? ORDER BY query").all(runId) as Array<
    Record<string, unknown>
  >;
  assert.equal(rows.length, 2);
  assert.equal(rows[1].outcome, "quota_exhausted");
  assert.equal(rows[1].results_n, 0);
  assert.match(String(rows[1].fail_reason), /search\.list/);
  /* And it is attached to the beat it was for, or the log cannot say which
     beat was looked for and which was not. */
  assert.equal(rows[1].beat_id, `${runId}:B1`);
});

test("the queries already tried come back, so a round cannot buy the same page twice", async () => {
  const d = db();
  const D = fakeD1(d) as never;
  const runId = await createRun(D, { projectId: "p1", trigger: "plan" }, NOW);
  await writeSearches(
    D,
    [
      { runId, beatId: null, family: "direct", adapter: "youtube", query: "he bans a viewer", resultsN: 1, quotaUnits: 1, outcome: "ok" },
      { runId, beatId: null, family: "crowd", adapter: "websearch", query: "reddit thread", resultsN: 2, quotaUnits: 0, outcome: "ok" },
    ],
    NOW,
  );
  assert.deepEqual((await queriesTried(D, runId)).sort(), ["he bans a viewer", "reddit thread"]);
});

/* ── Sources ────────────────────────────────────────────────────────────── */

test("ACCEPTANCE: one video found twice is one source", async () => {
  /*
   * The same video found by the direct family and again by the crowd family.
   * Written twice it is two rows to triage, two to scan and two to pay for —
   * and the board shows the same clip under one beat as two finds.
   */
  const d = db();
  const D = fakeD1(d) as never;
  const runId = await createRun(D, { projectId: "p1", trigger: "plan" }, NOW);

  await writeSources(D, runId, [candidate()], NOW);
  await writeSources(D, runId, [candidate({ title: "Found again by another family" })], NOW + 1);

  const rows = d.prepare("SELECT * FROM scout_sources WHERE run_id = ?").all(runId) as Array<Record<string, unknown>>;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "A stream", "the first write wins rather than the row being replaced");

  /* But the same id on a DIFFERENT run is a different row: a run is its own
     diligence record. */
  const other = await createRun(D, { projectId: "p1", trigger: "ask" }, NOW + 2);
  await writeSources(D, other, [candidate()], NOW + 2);
  assert.equal((d.prepare("SELECT COUNT(*) AS n FROM scout_sources").get() as { n: number }).n, 2);
});

test("triage and the scan mark a source, and an empty scan is a dead end", async () => {
  const d = db();
  const D = fakeD1(d) as never;
  const runId = await createRun(D, { projectId: "p1", trigger: "plan" }, NOW);
  await writeSources(D, runId, [candidate({ externalId: "a" }), candidate({ externalId: "b" })], NOW);

  const ids = (d.prepare("SELECT id FROM scout_sources WHERE run_id = ? ORDER BY external_id").all(runId) as Array<{
    id: string;
  }>).map((r) => r.id);

  await setTriage(D, [{ sourceId: ids[0], score: 0.72 }]);
  await markScanned(D, ids[0], 2);
  await markScanned(D, ids[1], 0);

  const rows = d.prepare("SELECT * FROM scout_sources WHERE run_id = ? ORDER BY external_id").all(runId) as Array<
    Record<string, unknown>
  >;
  assert.equal(rows[0].triage_score, 0.72);
  assert.equal(rows[0].scanned, 1);
  assert.equal(rows[0].yield_n, 2);
  assert.equal(rows[0].dead_end, 0);
  /* A source read and holding nothing is a dead end, which is what stops the
     next round going back to it. */
  assert.equal(rows[1].dead_end, 1);
  assert.equal(rows[1].triage_score, null, "and one nobody triaged still says so");
});

/* ── The ledger ─────────────────────────────────────────────────────────── */

const ledgerRow = (runId: string, sourceId: string, over: Record<string, unknown> = {}) => ({
  runId,
  beatId: "B1",
  role: "subject",
  sourceId,
  quoteExact: "get out of my chat",
  quoteNorm: "get out of my chat",
  wordSpan: { startWord: 10, endWord: 14 },
  tStartS: 5070.4,
  tEndS: 5074.9,
  verify: "verified" as const,
  matchScore: 1,
  ...over,
});

test("ACCEPTANCE: a rejected row is written too, because it is the measurement", async () => {
  /*
   * Spec 3.6: "log the rejection rate per model and prompt version from day
   * one — that rate is Scout's measured hallucination rate, and it gates
   * model swaps." A ledger holding only successes cannot produce it.
   */
  const d = db();
  const D = fakeD1(d) as never;
  const runId = await createRun(D, { projectId: "p1", trigger: "plan" }, NOW);
  await writeBeats(D, { runId, projectId: "p1", beats });
  await writeSources(D, runId, [candidate()], NOW);
  const src = (d.prepare("SELECT id FROM scout_sources").get() as { id: string }).id;

  await writeLedger(
    D,
    [
      ledgerRow(runId, src),
      ledgerRow(runId, src, { verify: "paraphrase", matchScore: 0.84 }),
      ledgerRow(runId, src, { verify: "rejected", matchScore: 0.22 }),
    ],
    NOW,
  );

  const rows = d.prepare("SELECT verify, match_score FROM scout_ledger ORDER BY match_score DESC").all() as Array<{
    verify: string;
    match_score: number;
  }>;
  assert.deepEqual(rows.map((r) => r.verify), ["verified", "paraphrase", "rejected"]);
  assert.equal(rows[2].match_score, 0.22, "and a rejection keeps its score");
});

test("the word span and the times are stored together, and the span is the address", () => {
  /* Invariant 2 and the timing contract: the times derive from the span, so a
     row that lost the span could never be re-timed by a better aligner. */
  const d = db();
  const D = fakeD1(d) as never;
  return (async () => {
    const runId = await createRun(D, { projectId: "p1", trigger: "plan" }, NOW);
    await writeBeats(D, { runId, projectId: "p1", beats });
    await writeSources(D, runId, [candidate()], NOW);
    const src = (d.prepare("SELECT id FROM scout_sources").get() as { id: string }).id;
    await writeLedger(D, [ledgerRow(runId, src, { contextBefore: "before", contextAfter: "after" })], NOW);

    const row = d.prepare("SELECT * FROM scout_ledger").get() as Record<string, unknown>;
    assert.deepEqual(JSON.parse(String(row.word_span_json)), { startWord: 10, endWord: 14 });
    assert.equal(row.t_start_s, 5070.4);
    assert.equal(row.context_before, "before");
    assert.equal(row.context_after, "after");
    assert.equal(row.beat_id, `${runId}:B1`);
  })();
});

test("a traced copy is linked to its original", async () => {
  const d = db();
  const D = fakeD1(d) as never;
  const runId = await createRun(D, { projectId: "p1", trigger: "plan" }, NOW);
  await writeBeats(D, { runId, projectId: "p1", beats });
  await writeSources(D, runId, [candidate()], NOW);
  const src = (d.prepare("SELECT id FROM scout_sources").get() as { id: string }).id;

  const [originalId, copyId] = await writeLedger(D, [ledgerRow(runId, src), ledgerRow(runId, src)], NOW);
  await setOriginalOf(D, copyId, originalId);

  const row = d.prepare("SELECT original_of FROM scout_ledger WHERE id = ?").get(copyId) as { original_of: string };
  assert.equal(row.original_of, originalId);
});

/* ── The snapshot ───────────────────────────────────────────────────────── */

test("ACCEPTANCE: the planner's whole question can be asked of the database", async () => {
  /*
   * THE CONTRACT. scout-run.ts resumes a dead run by asking the same question
   * again, which only works if every field of its snapshot is a count this
   * file can get. A field that could not be is a field that does not survive
   * a restart — and the failure would be a run that forgets what it was doing
   * and does it again, at whatever that costs.
   */
  const d = db();
  const D = fakeD1(d) as never;
  const runId = await createRun(D, { projectId: "p1", trigger: "plan" }, NOW);

  /* Nothing yet: the planner should want to decompose. */
  const empty = await snapshot(D, runId, { queriesPending: 0, snowballed: false, stop: stopState() });
  assert.equal(empty.decomposed, false);
  assert.equal(nextStep(empty).phase, "decompose");

  await writeBeats(D, { runId, projectId: "p1", beats });
  const decomposed = await snapshot(D, runId, { queriesPending: 0, snowballed: false, stop: stopState() });
  assert.equal(decomposed.decomposed, true);
  assert.equal(nextStep(decomposed).phase, "expand");

  /* Candidates in, none triaged. */
  await writeSources(D, runId, [candidate({ externalId: "a" }), candidate({ externalId: "b" })], NOW);
  const found = await snapshot(D, runId, { queriesPending: 4, snowballed: false, stop: stopState({ queriesIssued: 6 }) });
  assert.equal(found.candidatesUntriaged, 2);
  assert.equal(nextStep(found).phase, "triage", "work in hand beats work proposed");

  /* Triaged; one has a transcript to read. */
  const ids = (d.prepare("SELECT id FROM scout_sources ORDER BY external_id").all() as Array<{ id: string }>).map(
    (r) => r.id,
  );
  await setTriage(D, ids.map((id) => ({ sourceId: id, score: 0.5 })));
  d.prepare("UPDATE scout_sources SET transcript = 'native' WHERE id = ?").run(ids[0]);

  const triaged = await snapshot(D, runId, { queriesPending: 4, snowballed: false, stop: stopState({ queriesIssued: 6 }) });
  assert.equal(triaged.candidatesUntriaged, 0);
  assert.equal(triaged.sourcesUnscanned, 1, "only the one that can be read");
  assert.equal(nextStep(triaged).phase, "scan");

  /*
   * AND NOTHING IS SCANNED BEFORE IT IS TRIAGED. Triage is what decides
   * whether a source is worth reading at all; a snapshot that offered
   * untriaged sources to the scanner would read everything found, which is
   * the budget gone on the thirty candidates triage exists to cut to eight.
   */
  await writeSources(D, runId, [candidate({ externalId: "fresh", transcript: "native" })], NOW);
  const withFresh = await snapshot(D, runId, { queriesPending: 4, snowballed: false, stop: stopState({ queriesIssued: 6 }) });
  assert.equal(withFresh.candidatesUntriaged, 1);
  assert.equal(withFresh.sourcesUnscanned, 1, "the untriaged one is not offered to the scanner");
});

test("ACCEPTANCE: a scan with a yield and no ledger row is a verification owed", () => {
  /*
   * The scan writes its answer and the verifier writes the row, so the gap
   * between them IS the count. A snapshot that could not see it would send
   * the run on to the next thing with work half done, and the completion
   * invariant would never notice.
   */
  const d = db();
  const D = fakeD1(d) as never;
  return (async () => {
    const runId = await createRun(D, { projectId: "p1", trigger: "plan" }, NOW);
    await writeBeats(D, { runId, projectId: "p1", beats });
    await writeSources(D, runId, [candidate()], NOW);
    const src = (d.prepare("SELECT id FROM scout_sources").get() as { id: string }).id;
    await setTriage(D, [{ sourceId: src, score: 0.5 }]);
    await markScanned(D, src, 2);

    const owed = await snapshot(D, runId, { queriesPending: 0, snowballed: true, stop: stopState({ queriesIssued: 6 }) });
    assert.equal(owed.scansUnverified, 1);
    assert.equal(nextStep(owed).phase, "verify");

    /*
     * A SCAN THAT FOUND NOTHING IS NOT A VERIFICATION OWED. It is a dead end,
     * and counting it would hold the run in `verify` for ever waiting for a
     * ledger row nobody is going to write.
     */
    await writeSources(D, runId, [candidate({ externalId: "empty", transcript: "native" })], NOW);
    const emptyId = (d.prepare("SELECT id FROM scout_sources WHERE external_id = 'empty'").get() as { id: string }).id;
    await setTriage(D, [{ sourceId: emptyId, score: 0.4 }]);
    await markScanned(D, emptyId, 0);
    const stillOne = await snapshot(D, runId, { queriesPending: 0, snowballed: true, stop: stopState({ queriesIssued: 6 }) });
    assert.equal(stillOne.scansUnverified, 1, "the empty scan is a dead end, not work owed");

    /*
     * AND verifiedRows COUNTS ONLY WHAT WAS VERIFIED. A paraphrase is a
     * near-miss nobody has confirmed and a rejection is a quote that is not
     * in the source; counting either would let the stopping rule believe the
     * run had found evidence it has not.
     */
    await writeLedger(
      D,
      [
        ledgerRow(runId, src),
        ledgerRow(runId, src, { verify: "paraphrase", matchScore: 0.85 }),
        ledgerRow(runId, src, { verify: "rejected", matchScore: 0.1 }),
      ],
      NOW,
    );
    const settled = await snapshot(D, runId, { queriesPending: 0, snowballed: true, stop: stopState({ queriesIssued: 6 }) });
    assert.equal(settled.scansUnverified, 0);
    assert.equal(settled.verifiedRows, 1, "one of three, not three");
  })();
});

test("the snapshot counts items through the job that owns the run", async () => {
  /*
   * The completion invariant reads these, and they live on `job_items` rather
   * than on anything of Scout's — because the spec's items are "footage file,
   * segment, generated shot, render chunk" and a run's searches are one more
   * kind of the same thing.
   */
  const d = db();
  const D = fakeD1(d) as never;
  const runId = await createRun(D, { projectId: "p1", trigger: "plan" }, NOW);
  d.prepare(
    "INSERT INTO jobs (id, user_id, type, ref_id, state, pct, created_at) VALUES ('j1','u1','scout',?,'running',10,?)",
  ).run(runId, NOW);
  d.prepare(
    "INSERT INTO job_items (id, job_id, kind, status, idempotency_key, created_at, updated_at) VALUES ('i1','j1','search','succeeded','k1',?,?)",
  ).run(NOW, NOW);
  d.prepare(
    "INSERT INTO job_items (id, job_id, kind, status, idempotency_key, created_at, updated_at) VALUES ('i2','j1','scan','running','k2',?,?)",
  ).run(NOW, NOW);

  const snap = await snapshot(D, runId, { queriesPending: 0, snowballed: true, stop: stopState() });
  assert.deepEqual(
    snap.items.map((i) => [i.id, i.status]).sort(),
    [["i1", "succeeded"], ["i2", "running"]],
  );
});

/* ── The diligence log ──────────────────────────────────────────────────── */

test("ACCEPTANCE: queries run and queries refused are counted apart", async () => {
  /*
   * A run that issued thirty queries and a run that issued six and was
   * refused twenty-four look identical in a single total, and only one of
   * them has done the work. This is the dispute file's number.
   */
  const d = db();
  const D = fakeD1(d) as never;
  const runId = await createRun(D, { projectId: "p1", trigger: "plan" }, NOW);
  await writeSearches(
    D,
    [
      { runId, beatId: null, family: "direct", adapter: "youtube", query: "a", resultsN: 2, quotaUnits: 1, outcome: "ok" },
      { runId, beatId: null, family: "direct", adapter: "youtube", query: "b", resultsN: 1, quotaUnits: 1, outcome: "ok" },
      { runId, beatId: null, family: "direct", adapter: "youtube", query: "c", resultsN: 0, quotaUnits: 0, outcome: "quota_exhausted" },
      { runId, beatId: null, family: "crowd", adapter: "twitch", query: "d", resultsN: 0, quotaUnits: 0, outcome: "failed" },
      { runId, beatId: null, family: "seed", adapter: "youtube", query: "a", resultsN: 0, quotaUnits: 0, outcome: "skipped_duplicate" },
    ],
    NOW,
  );

  const log = await diligence(D, runId);
  assert.equal(log.queriesRun, 2);
  assert.equal(log.queriesRefused, 3);
});

test("the log separates what was read from what was only linked", async () => {
  /* "2 sources read, 4 link only" is the sentence on the board's footer, and
     the difference between evidence and a reading list. */
  const d = db();
  const D = fakeD1(d) as never;
  const runId = await createRun(D, { projectId: "p1", trigger: "plan" }, NOW);
  await writeSources(
    D,
    runId,
    [
      candidate({ externalId: "a", transcript: "native" }),
      candidate({ externalId: "b", transcript: "transcribed" }),
      candidate({ externalId: "c", transcript: "none" }),
      candidate({ externalId: "d", transcript: "none" }),
    ],
    NOW,
  );
  const ids = (d.prepare("SELECT id FROM scout_sources ORDER BY external_id").all() as Array<{ id: string }>).map(
    (r) => r.id,
  );
  await markScanned(D, ids[0], 3);

  const log = await diligence(D, runId);
  assert.equal(log.sourcesExamined, 4);
  assert.equal(log.sourcesRead, 2);
  assert.equal(log.sourcesLinkOnly, 2);
  assert.equal(log.candidatesScanned, 1);
});

test("ACCEPTANCE: the rejection rate keeps paraphrases out of its ratio", async () => {
  /*
   * A paraphrase is a human's decision, not a failure. Counting it would
   * score a prompt that produces careful near-quotes worse than one that
   * invents — and this number gates model swaps.
   */
  const d = db();
  const D = fakeD1(d) as never;
  const runId = await createRun(D, { projectId: "p1", trigger: "plan" }, NOW);
  await writeBeats(D, { runId, projectId: "p1", beats });
  await writeSources(D, runId, [candidate()], NOW);
  const src = (d.prepare("SELECT id FROM scout_sources").get() as { id: string }).id;

  await writeLedger(
    D,
    [
      ledgerRow(runId, src),
      ledgerRow(runId, src),
      ledgerRow(runId, src, { verify: "rejected", matchScore: 0.1 }),
      ledgerRow(runId, src, { verify: "paraphrase", matchScore: 0.85 }),
      ledgerRow(runId, src, { verify: "paraphrase", matchScore: 0.83 }),
    ],
    NOW,
  );

  const log = await diligence(D, runId);
  assert.equal(log.verified, 2);
  assert.equal(log.rejected, 1);
  assert.equal(log.paraphrase, 2);
  /* One in three decided, not one in five. */
  assert.equal(log.rejectionRate, 0.3333);
});

test("a run that did nothing reports zeroes rather than failing", async () => {
  const d = db();
  const D = fakeD1(d) as never;
  const runId = await createRun(D, { projectId: "p1", trigger: "plan" }, NOW);
  const log = await diligence(D, runId);
  assert.equal(log.queriesRun, 0);
  assert.equal(log.sourcesExamined, 0);
  assert.equal(log.rejectionRate, 0, "no decisions is not a perfect score");
});
