/**
 * THE STOPPING RULE'S INPUTS, WHICH WERE ZEROES.
 *
 * `runScoutPhase` built the state decideStop reads with three numbers written
 * in by hand:
 *
 *   rounds: 0, sourcesScanned: 0, spendUsd: 0
 *
 * and a curve of one point. decideStop compares those against
 * DEFAULT_BUDGET's 4 rounds / 40 sources / $1.50, and finds the knee on the
 * curve. So Spec 18's three budgets could not fire and the knee had no chord
 * to measure from: the only way a run could stop was coverage.
 *
 * Every number is a count over rows the run already writes. This drives the
 * readers that get them against real SQLite, and then drives decideStop with
 * the result, because a reader returning the right number is only half of it
 * — the other half is that the budget then fires.
 *
 * The DDL comes from migrations/schema.sql rather than being retyped here,
 * where it could be retyped wrong in the same direction as the bug.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fakeD1 } from "./helpers/fake-d1.ts";
import {
  closeRound,
  createRun,
  runCounters,
  searchCurve,
  seedsRaised,
  setVerification,
  verifiedRows,
  writeLedger,
  writeSearches,
  snapshot,
  writeBeats,
  writeSeeds,
  writeSources,
} from "../src/scout-store.ts";
import { getBeats } from "../src/scout-store.ts";
import { nextStep } from "../src/scout-run.ts";
import { runScoutPhase } from "../src/scout-job.ts";
import { DEFAULT_BUDGET, coverageOf, decideStop, recapture } from "../src/scout-stop.ts";
import { seedKey } from "../src/scout-snowball.ts";
import type { SourceCandidate } from "../src/scout-adapters.ts";

const SCHEMA = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../migrations/schema.sql"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

function db() {
  const d = new DatabaseSync(":memory:");
  const want = [
    "v2_users",
    "sources",
    "v2_projects",
    "scout_runs",
    "scout_beats",
    "scout_searches",
    "scout_sources",
    "scout_ledger",
    "scout_seeds",
    /* writeBeats also writes the plan's beats, so the tables it references
       have to be here — the fake enforces foreign keys, which is the point. */
    "plans",
    "plan_beats",
    /* snapshot() asks what work this run still owes, which is the completion
       invariant's own question. */
    "jobs",
    "job_items",
  ];
  for (const name of want) {
    const ddl = SCHEMA.split(";").find((s) =>
      new RegExp(`create table if not exists ${name}\\s*\\(`, "i").test(s),
    );
    assert.ok(ddl, `migrations/schema.sql has no ${name} — run \`npm run schema\``);
    d.exec(ddl + ";");
  }
  d.prepare("INSERT INTO v2_users (id, email, created_at) VALUES ('u1','a@b.c',1)").run();
  d.prepare(
    "INSERT INTO v2_projects (id, user_id, title, kind, created_at, updated_at) VALUES ('p1','u1','P','cut',1,1)",
  ).run();
  return d;
}

const NOW = 1_700_000_000_000;

const candidate = (n: number): SourceCandidate => ({
  adapter: "youtube",
  externalId: "v" + n,
  url: "https://example.test/v" + n,
  title: "Episode " + n,
  transcript: "native",
});

/* ── The three budgets ──────────────────────────────────────────────────── */

test("a closed round is counted, and the fourth one stops the run", async () => {
  const raw = db();
  const d1 = fakeD1(raw) as never;
  const runId = await createRun(d1, { projectId: "p1", trigger: "ask" }, NOW);

  assert.equal((await runCounters(d1, runId)).rounds, 0, "nothing has closed yet");

  for (let i = 1; i <= 4; i += 1) {
    assert.equal(await closeRound(d1, runId), i, "closeRound returns the new count");
  }
  assert.equal((await runCounters(d1, runId)).rounds, 4);

  /*
   * AND THE BUDGET FIRES ON IT. The reader could return 4 and the run still
   * not stop — that is what "wired" has to mean here, so the state goes
   * through decideStop rather than being asserted on its own.
   */
  const counters = await runCounters(d1, runId);
  const out = decideStop(
    {
      ...counters,
      queriesIssued: 10,
      curve: [{ queries: 0, verified: 0 }],
      coverage: coverageOf([{ id: "B1", role: "subject", needMin: 2 }], new Map(), new Map()),
      recapture: recapture(0, 0, 0, 0),
    },
    DEFAULT_BUDGET,
  );
  assert.equal(out.stop, true);
  assert.equal(out.reason, "budget_rounds");
  assert.match(out.why, /4 rounds/);
});

test("scanned sources are counted, and the fortieth stops the run", async () => {
  const raw = db();
  const d1 = fakeD1(raw) as never;
  const runId = await createRun(d1, { projectId: "p1", trigger: "ask" }, NOW);

  await writeSources(
    d1,
    runId,
    Array.from({ length: 41 }, (_, i) => candidate(i)),
    NOW,
  );
  /* Only the ones actually read count. A triaged-and-not-yet-scanned source
     is work owed, not work done — which is the whole distinction the planner's
     `sourcesUnscanned` turns on. */
  raw.prepare("UPDATE scout_sources SET scanned = 1 WHERE external_id IN ('v0','v1','v2')").run();
  assert.equal((await runCounters(d1, runId)).sourcesScanned, 3);

  raw.prepare("UPDATE scout_sources SET scanned = 1").run();
  const counters = await runCounters(d1, runId);
  assert.equal(counters.sourcesScanned, 41);

  const out = decideStop(
    {
      ...counters,
      rounds: 0,
      queriesIssued: 10,
      curve: [{ queries: 0, verified: 0 }],
      coverage: coverageOf([{ id: "B1", role: "subject", needMin: 2 }], new Map(), new Map()),
      recapture: recapture(0, 0, 0, 0),
    },
    DEFAULT_BUDGET,
  );
  assert.equal(out.reason, "budget_sources");
});

test("search spend is summed, and the cap stops the run", async () => {
  const raw = db();
  const d1 = fakeD1(raw) as never;
  const runId = await createRun(d1, { projectId: "p1", trigger: "ask" }, NOW);

  const search = (query: string, costUsd: number) => ({
    runId,
    beatId: null,
    family: "direct" as const,
    adapter: "youtube" as const,
    query,
    hyde: null,
    resultsN: 1,
    quotaUnits: 100,
    costUsd,
    outcome: "ok" as const,
    failReason: null,
  });

  await writeSearches(d1, [search("a", 0.4), search("b", 0.4)], NOW);
  assert.equal(Number((await runCounters(d1, runId)).spendUsd.toFixed(2)), 0.8);

  await writeSearches(d1, [search("c", 0.8)], NOW + 1000);
  const counters = await runCounters(d1, runId);
  assert.equal(Number(counters.spendUsd.toFixed(2)), 1.6, "over the $1.50 cap");

  const out = decideStop(
    {
      ...counters,
      rounds: 0,
      queriesIssued: 3,
      curve: [{ queries: 0, verified: 0 }],
      coverage: coverageOf([{ id: "B1", role: "subject", needMin: 2 }], new Map(), new Map()),
      recapture: recapture(0, 0, 0, 0),
    },
    DEFAULT_BUDGET,
  );
  assert.equal(out.reason, "budget_spend");
});

/* ── The curve ──────────────────────────────────────────────────────────── */

test("the curve is one point per query, carrying the verified count at that moment", async () => {
  const raw = db();
  const d1 = fakeD1(raw) as never;
  const runId = await createRun(d1, { projectId: "p1", trigger: "ask" }, NOW);
  await writeSources(d1, runId, [candidate(1)], NOW);
  const sourceId = String(
    (raw.prepare("SELECT id FROM scout_sources LIMIT 1").get() as { id: string }).id,
  );

  const search = (query: string) => ({
    runId,
    beatId: null,
    family: "direct" as const,
    adapter: "youtube" as const,
    query,
    hyde: null,
    resultsN: 1,
    quotaUnits: 100,
    outcome: "ok" as const,
    failReason: null,
  });

  /* Two queries, then a find verified, then a third query. The curve must
     show the find against the THIRD query and not the first two, or the knee
     is measured on a shape the run never had. */
  await writeSearches(d1, [search("one"), search("two")], NOW);
  const [rowId] = await writeLedger(
    d1,
    [
      {
        runId,
        beatId: null,
        role: "subject",
        sourceId,
        quoteExact: "he said the thing",
        quoteNorm: "he said the thing",
        wordSpan: { startWord: 10, endWord: 14 },
        tStartS: 61,
        tEndS: 64,
        verify: "rejected",
        matchScore: 0,
      },
    ],
    NOW + 1000,
  );
  await setVerification(
    d1,
    rowId,
    { verify: "verified", matchScore: 1, span: { startWord: 10, endWord: 14 }, tStartS: 61, tEndS: 64 },
    NOW + 2000,
  );
  await writeSearches(d1, [search("three")], NOW + 3000);

  const curve = await searchCurve(d1, runId);
  assert.deepEqual(
    curve,
    [
      { queries: 0, verified: 0 },
      { queries: 1, verified: 0 },
      { queries: 2, verified: 0 },
      { queries: 3, verified: 1 },
    ],
    "the leading (0,0) is the chord's first end; the find lands on query three",
  );
});

test("a refused query is not on the curve, because nothing was looked at", async () => {
  const raw = db();
  const d1 = fakeD1(raw) as never;
  const runId = await createRun(d1, { projectId: "p1", trigger: "ask" }, NOW);
  await writeSearches(
    d1,
    [
      {
        runId,
        beatId: null,
        family: "direct",
        adapter: "youtube",
        query: "never ran",
        hyde: null,
        resultsN: 0,
        quotaUnits: 0,
        outcome: "quota_exhausted",
        failReason: "out of units",
      },
    ],
    NOW,
  );
  assert.deepEqual(await searchCurve(d1, runId), [{ queries: 0, verified: 0 }]);
});

/* ── Seeds, remembered across rounds ────────────────────────────────────── */

test("a seed raised once is remembered, so the next round cannot raise it again", async () => {
  const raw = db();
  const d1 = fakeD1(raw) as never;
  const runId = await createRun(d1, { projectId: "p1", trigger: "ask" }, NOW);

  await writeSeeds(
    d1,
    runId,
    1,
    [
      { kind: "phrase", value: "Read The Rules", support: 3, why: "in three verified quotes", queriesN: 2 },
      { kind: "critic", value: "SomeChannel", support: 2, why: "on two sources", queriesN: 1 },
    ],
    NOW,
  );

  const raised = await seedsRaised(d1, runId);
  assert.deepEqual(raised.sort(), [seedKey("critic", "SomeChannel"), seedKey("phrase", "Read The Rules")].sort());

  /* Case and surrounding space must not make a new seed of an old one: the
     key snowball() compares against is lowercased and trimmed, so the reader
     has to produce the same key or the memory silently misses. */
  assert.ok(raised.includes(seedKey("phrase", "  read the rules  ")));

  /* And a second round raising the same one writes nothing new — the UNIQUE
     constraint refuses it rather than trusting the caller to have checked. */
  await writeSeeds(d1, runId, 2, [{ kind: "phrase", value: "Read The Rules", support: 4, why: "again", queriesN: 2 }], NOW + 1);
  assert.equal((await seedsRaised(d1, runId)).length, 2, "still two seeds, not three");
});

/* ── What snowball seeds from ───────────────────────────────────────────── */

test("only verified rows are handed to snowball", async () => {
  const raw = db();
  const d1 = fakeD1(raw) as never;
  const runId = await createRun(d1, { projectId: "p1", trigger: "ask" }, NOW);
  await writeSources(d1, runId, [candidate(1)], NOW);
  const sourceId = String(
    (raw.prepare("SELECT id FROM scout_sources LIMIT 1").get() as { id: string }).id,
  );

  const row = (quote: string) => ({
    runId,
    beatId: null,
    role: "subject",
    sourceId,
    quoteExact: quote,
    quoteNorm: quote,
    wordSpan: { startWord: 1, endWord: 4 },
    tStartS: 1,
    tEndS: 4,
    verify: "rejected" as const,
    matchScore: 0,
  });

  const ids = await writeLedger(d1, [row("the verified one"), row("the paraphrase"), row("the fabrication")], NOW);
  await setVerification(d1, ids[0], { verify: "verified", matchScore: 1, span: null, tStartS: null, tEndS: null }, NOW + 1);
  await setVerification(d1, ids[1], { verify: "paraphrase", matchScore: 0.7, span: null, tStartS: null, tEndS: null }, NOW + 1);
  await setVerification(d1, ids[2], { verify: "rejected", matchScore: 0, span: null, tStartS: null, tEndS: null }, NOW + 1);

  const rows = await verifiedRows(d1, runId);
  assert.deepEqual(
    rows.map((r) => r.quoteExact),
    ["the verified one"],
    "a paraphrase is somebody's near-miss and a rejection is not in the source at all",
  );
  assert.equal(rows[0].sourceTitle, "Episode 1", "the source's own title comes with it");
});

/* ── The phase that did not exist ───────────────────────────────────────── */

/**
 * THE SNOWBALL ARM, DRIVEN.
 *
 * `runScoutPhase`'s switch had no `case "snowball"`, so the phase nextStep
 * emits to END a round fell through to `default: return null` — which does not
 * loop, it ends the chain. Every run stopped at its first round boundary and
 * src/scout-snowball.ts, 447 lines and fully tested, was imported by nothing.
 *
 * No model is called on this path, which is why it can be driven here against
 * nothing but a database: every seed is a count over rows already held.
 */
test("the snowball phase closes the round and hands back queries to run", async () => {
  const raw = db();
  const d1 = fakeD1(raw) as never;
  const runId = await createRun(d1, { projectId: "p1", trigger: "ask" }, NOW);

  /* One beat that wants two and has one, so coverage does not hold and the
     run is still looking — otherwise decideStop stops it and the planner
     never asks for snowball at all. */
  await writeBeats(d1, {
    runId,
    projectId: "p1",
    beats: [{ id: "B1", role: "subject", name: "The pattern", behaviour: "Berates live chat", needMin: 2 }],
  });

  await writeSources(d1, runId, [candidate(1), candidate(2)], NOW);
  /* Triaged and read, so there is nothing else owed and the round is over. */
  raw.prepare("UPDATE scout_sources SET triage_score = 0.9, scanned = 1").run();
  const sources = raw.prepare("SELECT id FROM scout_sources ORDER BY external_id").all() as Array<{ id: string }>;

  /* Two verified quotes sharing a phrase, which is what MIN_SUPPORT asks for:
     a phrase in one quote is a sentence somebody said. */
  const quote = (sourceId: string, text: string) => ({
    runId,
    beatId: "B1",
    role: "subject",
    sourceId,
    quoteExact: text,
    quoteNorm: text,
    wordSpan: { startWord: 1, endWord: 6 },
    tStartS: 10,
    tEndS: 16,
    verify: "rejected" as const,
    matchScore: 0,
  });
  const ids = await writeLedger(
    d1,
    [
      quote(sources[0].id, "you people never read the rules"),
      quote(sources[1].id, "again nobody here will read the rules"),
    ],
    NOW + 10,
  );
  for (const id of ids) {
    await setVerification(d1, id, { verify: "verified", matchScore: 1, span: null, tStartS: null, tEndS: null }, NOW + 20);
  }

  /* A query issued, because "a round is in progress" is tested by queries
     issued rather than by the round counter — see nextStep. */
  await writeSearches(
    d1,
    [
      {
        runId,
        beatId: "B1",
        family: "direct",
        adapter: "youtube",
        query: "berates live chat",
        hyde: null,
        resultsN: 2,
        quotaUnits: 100,
        outcome: "ok",
        failReason: null,
      },
    ],
    NOW + 30,
  );

  const job = {
    runId,
    projectId: "p1",
    userId: "u1",
    subject: "the streamer",
    brief: "berates his live chat",
    snowballed: false,
  };

  /* The planner has to be asking for snowball, or this test would pass while
     testing the wrong arm. */
  const beats = await getBeats(d1, runId);
  const snap = await snapshot(d1, runId, {
    queriesPending: 0,
    snowballed: false,
    stop: {
      ...(await runCounters(d1, runId)),
      queriesIssued: 1,
      curve: await searchCurve(d1, runId),
      coverage: coverageOf(
        beats.map((b) => ({ id: b.id, role: b.role, needMin: b.needMin })),
        new Map([[beats[0].id, 1]]),
        new Map([[beats[0].id, 1]]),
      ),
      recapture: recapture(0, 0, 0, 0),
    },
  });
  assert.equal(nextStep(snap).phase, "snowball", "the planner is asking for the arm under test");

  const out = await runScoutPhase({ DB: d1 } as never, job as never);

  assert.ok(out, "the chain continues — before this arm existed it returned null and the run ended");
  assert.equal(out?.snowballed, true, "the round has closed");
  assert.equal((await runCounters(d1, runId)).rounds, 1, "and it is counted, so the round budget can see it");

  const pending = out?.queriesPending ?? [];
  assert.ok(pending.length > 0, "a round's finds produced the next round's questions");
  assert.ok(
    pending.every((q) => q.family === "seed"),
    "every one is tagged seed, so the diligence log says why it was asked",
  );
  assert.ok(
    pending.every((q) => q.beatId === null),
    "a seed is derived across beats, so it claims none of them",
  );
  assert.ok(
    pending.some((q) => /read the rules/i.test(q.query)),
    "the phrase both verified quotes shared is what it went after",
  );

  /* And the seed is remembered, which is what stops the next round deriving
     the same phrase, searching it, and finding the rows it came from. */
  assert.ok((await seedsRaised(d1, runId)).length > 0);
});
