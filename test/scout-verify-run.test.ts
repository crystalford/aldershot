/**
 * THE VERIFY PHASE, which had never run either — and this one was worse.
 *
 * The scan writes every find with `verify: 'rejected'`, because nothing has
 * checked it and `rejected` is the one verdict nobody asserted. Without this
 * phase that was permanent: every quote Scout found was stored as a
 * rejection and nothing could ever reach the board.
 *
 * And the planner WAS asking for it. `snapshot`'s `scansUnverified` counted
 * sources with no ledger row, on the assumption that the verifier writes the
 * row; the scan writes it, so the count was always zero and the phase was
 * never requested once.
 *
 * Against the real DDL, because the claims here are SQL — `verified_at IS
 * NULL`, and the ordering the one-fetch-per-source grouping depends on — and
 * a schema retyped into a test can be retyped wrong in the same direction as
 * the bug.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fakeD1 } from "./helpers/fake-d1.ts";
import { verifyRun } from "../src/scout-verify-run.ts";
import { rowsToVerify, snapshot } from "../src/scout-store.ts";
import { nextStep } from "../src/scout-run.ts";
import { PARAPHRASE_AT } from "../src/scout-verify.ts";

const SCHEMA = readFileSync(join(import.meta.dirname, "../migrations/schema.sql"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

/* `sources` is here because v2_projects references it and node:sqlite
   enforces foreign keys — an insert into a table whose referenced table is
   missing fails with "no such table", not a constraint error. */
const TABLES = [
  "v2_users",
  "jobs",
  "job_items",
  "sources",
  "v2_projects",
  "plan_beats",
  "scout_runs",
  "scout_beats",
  "scout_sources",
  "scout_ledger",
];

const VTT = `WEBVTT

00:00:10.000 --> 00:00:14.000
We moved the launch before the review came in.

00:00:14.000 --> 00:00:18.000
Nobody wanted to be the one to say it out loud.
`;

function db() {
  const d = new DatabaseSync(":memory:");
  for (const name of TABLES) {
    const ddl = SCHEMA.split(";").find((s) =>
      new RegExp(`create table if not exists ${name}\\s*\\(`, "i").test(s),
    );
    assert.ok(ddl, `migrations/schema.sql has no ${name} — run \`npm run schema\``);
    d.exec(ddl + ";");
  }
  d.prepare("INSERT INTO v2_users (id,email,created_at) VALUES ('u1','a@b.c',1)").run();
  d.prepare(
    "INSERT INTO v2_projects (id,user_id,title,kind,created_at,updated_at) VALUES ('p1','u1','A cut','cut',1,1)",
  ).run();
  d.prepare(
    "INSERT INTO scout_runs (id,project_id,trigger,created_at) VALUES ('r1','p1','plan',1)",
  ).run();
  return d;
}

function source(d: DatabaseSync, id: string, transcriptUrl: string | null) {
  d.prepare(
    /* Triaged and scanned, which is the only state a source with ledger rows
       can really be in — and the planner puts triage ahead of verify, so an
       untriaged source sends it somewhere else entirely. */
    "INSERT INTO scout_sources (id,run_id,adapter,external_id,url,transcript,transcript_url,triage_score,scanned,yield_n,fetched_at) " +
      "VALUES (?,'r1','podcast',?,?,'native',?,0.5,1,1,1)",
  ).run(id, id, `https://example.org/${id}`, transcriptUrl);
}

let nextId = 0;
function find(d: DatabaseSync, sourceId: string, quote: string, startWord = 0) {
  const id = `l${(nextId += 1)}`;
  d.prepare(
    "INSERT INTO scout_ledger (id,run_id,beat_id,role,source_id,quote_exact,quote_norm,word_span_json," +
      "t_start_s,t_end_s,verify,match_score,crowd_signals_n,model_version,created_at) " +
      "VALUES (?,'r1',NULL,'subject',?,?,?,?,0,0,'rejected',0,0,'m/v1',1)",
  ).run(id, sourceId, quote, quote.toLowerCase(), JSON.stringify({ startWord, endWord: startWord + 5 }));
  return id;
}

const row = (d: DatabaseSync, id: string) =>
  d
    .prepare(
      "SELECT verify, match_score, t_start_s, t_end_s, word_span_json, context_before, verified_at " +
        "FROM scout_ledger WHERE id = ?",
    )
    .get(id) as Record<string, unknown>;

/** Serves the VTT, counting how many times each url was asked for. */
function withVtt<T>(fn: (hits: string[]) => Promise<T>, body: string | null = VTT): Promise<T> {
  const hits: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    hits.push(String(url));
    if (body === null) return { ok: false, status: 404, text: async () => "" };
    return { ok: true, status: 200, text: async () => body };
  }) as never;
  return fn(hits).finally(() => {
    globalThis.fetch = real;
  });
}

test("ACCEPTANCE: a real quote is verified, and its time comes off the words", async () => {
  const d = db();
  source(d, "s1", "https://example.org/s1.vtt");
  const id = find(d, "s1", "We moved the launch before the review came in.");

  const out = await withVtt(() => verifyRun({ DB: fakeD1(d) } as never, { runId: "r1" }));

  assert.deepEqual(
    { checked: out.checked, verified: out.verified, rejected: out.rejected },
    { checked: 1, verified: 1, rejected: 0 },
  );
  const r = row(d, id);
  assert.equal(r.verify, "verified");
  /* The cue starts at ten seconds. The scan wrote 0 for both times; these
     are read off the matched words, which is invariant 2 in a column. */
  assert.equal(r.t_start_s, 10);
  assert.equal(r.t_end_s, 14);
  assert.ok(r.verified_at, "an unstamped row is checked again every round");
});

test("ACCEPTANCE: a deliberately hallucinated row is rejected and gets no timestamp", async () => {
  /*
   * Phase 7's acceptance names this test. A model that invents a quote must
   * not get a timestamp out of this, and must not be re-read for ever
   * either — so the row is stamped as checked while staying rejected.
   */
  const d = db();
  source(d, "s1", "https://example.org/s1.vtt");
  /* A NONZERO HINT, deliberately. With the hint at 0 this test passed even
     when the model's hint was allowed to become the timestamp, because the
     hint and the correct answer were the same number — measured by breaking
     it. 7 is inside the transcript and is not 0. */
  const id = find(d, "s1", "I personally signed off on burying the report.", 7);

  const out = await withVtt(() => verifyRun({ DB: fakeD1(d) } as never, { runId: "r1" }));

  assert.equal(out.rejected, 1);
  const r = row(d, id);
  assert.equal(r.verify, "rejected");

  /*
   * THE SCORE SURVIVES THE REJECTION, and that is deliberate rather than
   * sloppy: "rejected at 0.79" and "rejected at 0.02" are different facts
   * about a model, and the rejection rate is what gates a model swap. So
   * the claim is not that the score is zero — it is that the nearest thing
   * in the transcript was found, measured, and found wanting.
   */
  const score = Number(r.match_score);
  assert.ok(score > 0, "the fuzzy pass found nothing to measure against");
  assert.ok(score < PARAPHRASE_AT, `scored ${score}, at or above the paraphrase threshold`);

  /* AND NO TIMESTAMP. There is no matched span, so the scan's own window and
     zeroed times are left exactly as they were — a rejected row must not
     acquire a time it could be displayed at. */
  assert.equal(r.t_start_s, 0);
  assert.equal(r.t_end_s, 0);
  assert.deepEqual(JSON.parse(String(r.word_span_json)), { startWord: 7, endWord: 12 });
  assert.equal(r.context_before, null, "a rejection has no surrounding words to keep");
  assert.ok(r.verified_at, "a rejection is a decision; re-reading it every round is a bill");
});

test("ACCEPTANCE: one transcript fetch per source, however many quotes came out of it", async () => {
  /*
   * The whole reason rowsToVerify orders by source. Three finds in one
   * episode is one megabyte of VTT, not three.
   */
  const d = db();
  source(d, "s1", "https://example.org/s1.vtt");
  find(d, "s1", "We moved the launch before the review came in.");
  find(d, "s1", "Nobody wanted to be the one to say it out loud.");
  find(d, "s1", "Something nobody said at all.");

  const hits = await withVtt(async (h) => {
    await verifyRun({ DB: fakeD1(d) } as never, { runId: "r1" });
    return h;
  });
  assert.equal(hits.length, 1, `fetched ${hits.length} times for one source`);
});

test("a source whose transcript will not load leaves its rows for a retry", async () => {
  /*
   * "We could not look" is not "it is not there". Invariant 4's reachable
   * "nothing backs this" has to mean the second one, so a VOD that 404s
   * today must not be recorded as Scout catching the model inventing.
   */
  const d = db();
  source(d, "s1", "https://example.org/gone.vtt");
  const id = find(d, "s1", "We moved the launch before the review came in.");

  const out = await withVtt(() => verifyRun({ DB: fakeD1(d) } as never, { runId: "r1" }), null);

  assert.deepEqual(out.unreadable, ["s1"]);
  assert.equal(out.checked, 0);
  const r = row(d, id);
  assert.equal(r.verified_at, null, "stamping it would record a fetch failure as a rejection");
});

test("a checked row is never offered again", async () => {
  /* The bug this column exists for: every row is written `rejected`, so a
     genuine rejection and an unchecked find looked identical and the phase
     would re-read the same hallucination for ever. */
  const d = db();
  source(d, "s1", "https://example.org/s1.vtt");
  find(d, "s1", "Something nobody said at all.");

  assert.equal((await rowsToVerify(fakeD1(d) as never, "r1")).length, 1);
  await withVtt(() => verifyRun({ DB: fakeD1(d) } as never, { runId: "r1" }));
  assert.equal((await rowsToVerify(fakeD1(d) as never, "r1")).length, 0);
});

test("a row whose source has no transcript address is not offered at all", async () => {
  const d = db();
  source(d, "s1", null);
  find(d, "s1", "We moved the launch before the review came in.");
  assert.equal((await rowsToVerify(fakeD1(d) as never, "r1")).length, 0);
});

test("the model's hint cannot move a timestamp", async () => {
  /*
   * Invariant 2, at the one place it could be broken quietly. The hint here
   * points past the end of the transcript; the exact pass does not look at
   * it, so the time is still the transcript's.
   */
  const d = db();
  source(d, "s1", "https://example.org/s1.vtt");
  const id = find(d, "s1", "We moved the launch before the review came in.", 9999);

  await withVtt(() => verifyRun({ DB: fakeD1(d) } as never, { runId: "r1" }));

  const r = row(d, id);
  assert.equal(r.verify, "verified");
  assert.equal(r.t_start_s, 10);
  assert.deepEqual(JSON.parse(String(r.word_span_json)), { startWord: 0, endWord: 8 });
});

test("ACCEPTANCE: the planner can see unchecked finds at all", () => {
  /*
   * THE HALF OF THIS BUG THAT WAS SILENT, and nothing here pinned it until
   * breaking it changed no test.
   *
   * `scansUnverified` counted sources that had been scanned and had NO
   * ledger row — written on the assumption that the VERIFIER creates the
   * row. The scan creates it, unverified, so the count was always zero, the
   * planner never once returned the verify phase, and the arm could have
   * been correct for months without running.
   *
   * A phase nothing asks for is a phase that does not exist, so this is an
   * acceptance test and not a unit one.
   */
  const d = db();
  /* A beat, or the planner short-circuits to `decompose` and never reaches
     the question this test is asking. */
  d.prepare(
    "INSERT INTO scout_beats (id,run_id,project_id,idx,role,name,behaviour) " +
      "VALUES ('r1:b1','r1','p1',0,'subject','The admission','Does anyone admit it?')",
  ).run();
  source(d, "s1", "https://example.org/s1.vtt");
  find(d, "s1", "We moved the launch before the review came in.");
  find(d, "s1", "Something nobody said at all.");

  const snap = () =>
    snapshot(fakeD1(d) as never, "r1", {
      queriesPending: 0,
      snowballed: false,
      stop: {
        rounds: 0,
        sourcesScanned: 0,
        spendUsd: 0,
        queriesIssued: 0,
        curve: [],
        coverage: { covered: 0, needed: 0, gaps: [] },
        recapture: { rate: 0, enough: false },
      } as never,
    });

  return snap().then(async (before) => {
    assert.equal(before.scansUnverified, 2, "two finds nobody has checked");
    assert.equal(nextStep(before).phase, "verify", "the planner must ask for the phase");

    await withVtt(() => verifyRun({ DB: fakeD1(d) } as never, { runId: "r1" }));

    const after = await snap();
    assert.equal(after.scansUnverified, 0, "both were checked, including the rejection");
    assert.notEqual(nextStep(after).phase, "verify", "nothing left to check and it still asks");
  });
});
