/**
 * THE SCOUT STORE: nine tables, written and read back.
 *
 * Every module of the run has been pure until now — decompose, expand,
 * triage, scan, verify, reduce, snowball, the planner. That was deliberate
 * and it is why they are testable. This is where they touch the database, and
 * it is the file that makes the rest of it a feature rather than a library.
 *
 * THE ONE QUERY THAT MATTERS IS `snapshot`. `scout-run.ts` is a planner over
 * rows rather than a loop, which means a run that dies halfway resumes by
 * asking the same question again — but only if the question can actually be
 * asked of the database. Every field of `RunSnapshot` is a count this file
 * can get, and a field that could not be would be a field that does not
 * survive a restart. That is the contract between the two files and it is
 * worth more than anything else in here.
 *
 * COUNTS, NOT ROWS. The snapshot asks "how many candidates are untriaged",
 * not "give me the candidates". A run on a thousand-clip library has
 * thousands of rows and the planner needs a number from each — loading them
 * to call `.length` is the kind of thing that works on the test fixture and
 * falls over on the first real subject.
 */

import { ulid } from "./id.ts";
import type { AdapterName, Family, SourceCandidate } from "./scout-adapters.ts";
import type { ScoutBeat } from "./scout-decompose.ts";
import type { Verdict } from "./scout-verify.ts";
import type { RunSnapshot } from "./scout-run.ts";
import type { StopReason } from "./scout-stop.ts";
import type { ItemStatus } from "./items.ts";

/* ── The run ────────────────────────────────────────────────────────────── */

export type RunTrigger = "plan" | "ask" | "react" | "standing";

export async function createRun(
  db: D1Database,
  of: { projectId: string; trigger: RunTrigger; brief?: string },
  now = Date.now(),
): Promise<string> {
  const id = ulid(now);
  await db
    .prepare(
      "INSERT INTO scout_runs (id, project_id, trigger, brief, status, created_at) VALUES (?, ?, ?, ?, 'queued', ?)",
    )
    .bind(id, of.projectId, of.trigger, of.brief ?? null, now)
    .run();
  return id;
}

/**
 * The run's row, from the planner's answer.
 *
 * `rowFor` in scout-run.ts decides; this writes what it decided. Two places
 * that both decide is how a run ends up saying `done` with a stop reason of
 * `budget_spend` and twelve scans owed, so this takes the decision rather
 * than making one.
 */
export async function writeRunRow(
  db: D1Database,
  runId: string,
  row: { status: string; stopReason: StopReason | null; rounds: number; spendUsd: number; finishedAt: number | null },
): Promise<void> {
  await db
    .prepare(
      "UPDATE scout_runs SET status = ?, stop_reason = ?, rounds = ?, spend_usd = ?, finished_at = ? WHERE id = ?",
    )
    .bind(row.status, row.stopReason, row.rounds, row.spendUsd, row.finishedAt, runId)
    .run();
}

/* ── Beats ──────────────────────────────────────────────────────────────── */

export async function writeBeats(
  db: D1Database,
  of: { runId: string; projectId: string; beats: ScoutBeat[] },
): Promise<void> {
  if (!of.beats.length) return;
  await db.batch(
    of.beats.map((b, idx) =>
      db
        .prepare(
          "INSERT INTO scout_beats (id, run_id, project_id, idx, role, name, behaviour, inverts, need_min, counter_gap) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          `${of.runId}:${b.id}`,
          of.runId,
          of.projectId,
          idx,
          b.role,
          b.name,
          b.behaviour,
          b.inverts ?? null,
          b.needMin,
          b.counterGap ? 1 : 0,
        ),
    ),
  );
}

export interface StoredBeat extends ScoutBeat {
  rowId: string;
  status: "covered" | "thin" | "gap";
  queriesTried: number;
}

export async function getBeats(db: D1Database, runId: string): Promise<StoredBeat[]> {
  const { results } = await db
    .prepare("SELECT * FROM scout_beats WHERE run_id = ? ORDER BY idx")
    .bind(runId)
    .all<Record<string, unknown>>();

  return (results ?? []).map((r) => ({
    rowId: String(r.id),
    /* The beat's own id, not the row's. Everything upstream — a counter
       beat's `inverts`, a search row, a ledger row — refers to B1, and
       handing back the composite would break every one of them. */
    id: String(r.id).slice(String(r.run_id).length + 1),
    role: r.role as ScoutBeat["role"],
    name: String(r.name),
    behaviour: String(r.behaviour),
    needMin: Number(r.need_min),
    ...(r.inverts ? { inverts: String(r.inverts) } : {}),
    ...(r.counter_gap ? { counterGap: true } : {}),
    status: (r.status as StoredBeat["status"]) ?? "gap",
    queriesTried: Number(r.queries_tried_json ? JSON.parse(String(r.queries_tried_json)).length : 0),
  }));
}

/* ── Searches ───────────────────────────────────────────────────────────── */

export interface SearchRowIn {
  runId: string;
  beatId: string | null;
  family: Family;
  adapter: AdapterName;
  query: string;
  hyde?: string | null;
  resultsN: number;
  quotaUnits: number;
  costUsd?: number;
  outcome: string;
  failReason?: string | null;
}

/**
 * Every attempt, including the ones that did not happen.
 *
 * This table IS the diligence log. A search that was refused for quota is a
 * row with `outcome` set and `results_n` zero, and the difference between
 * that and "we looked and found nothing" is the difference between a board
 * telling the truth and one claiming diligence it did not do.
 */
export async function writeSearches(db: D1Database, rows: SearchRowIn[], now = Date.now()): Promise<void> {
  if (!rows.length) return;
  await db.batch(
    rows.map((r) =>
      db
        .prepare(
          "INSERT INTO scout_searches (id, run_id, beat_id, family, adapter, query, hyde, issued_at, results_n, quota_units, cost_usd, outcome, fail_reason) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          ulid(now),
          r.runId,
          r.beatId ? `${r.runId}:${r.beatId}` : null,
          r.family,
          r.adapter,
          r.query,
          r.hyde ?? null,
          now,
          r.resultsN,
          r.quotaUnits,
          r.costUsd ?? 0,
          r.outcome,
          r.failReason ?? null,
        ),
    ),
  );
}

/** Normalised queries already issued, so a round cannot buy the same page twice. */
export async function queriesTried(db: D1Database, runId: string): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT query FROM scout_searches WHERE run_id = ?")
    .bind(runId)
    .all<{ query: string }>();
  return (results ?? []).map((r) => r.query);
}

/* ── Sources ────────────────────────────────────────────────────────────── */

/**
 * Candidates, written once per run.
 *
 * `INSERT OR IGNORE` against the (run, adapter, external_id) key: the same
 * video found by the direct family and again by the crowd family is one
 * source, and writing it twice would make it two rows to triage, two to scan
 * and two to pay for.
 */
export async function writeSources(
  db: D1Database,
  runId: string,
  candidates: SourceCandidate[],
  now = Date.now(),
): Promise<void> {
  if (!candidates.length) return;
  await db.batch(
    candidates.map((c) =>
      db
        .prepare(
          "INSERT OR IGNORE INTO scout_sources (id, run_id, adapter, external_id, url, title, channel, published_at, duration_s, kind, transcript, transcript_url, licence, fetched_at, expires_at) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          ulid(now),
          runId,
          c.adapter,
          c.externalId,
          c.url,
          c.title,
          c.channel ?? null,
          c.publishedAt ?? null,
          c.durationS ?? null,
          c.kind ?? null,
          c.transcript ?? "none",
          c.transcriptUrl ?? null,
          c.licence ?? null,
          now,
          c.expiresAt ?? null,
        ),
    ),
  );
}

export async function setTriage(
  db: D1Database,
  rows: Array<{ sourceId: string; score: number }>,
): Promise<void> {
  if (!rows.length) return;
  await db.batch(
    rows.map((r) =>
      db.prepare("UPDATE scout_sources SET triage_score = ? WHERE id = ?").bind(r.score, r.sourceId),
    ),
  );
}

export interface Scannable {
  id: string;
  url: string;
  title: string | null;
  transcriptUrl: string;
  durationS: number | null;
}

/**
 * Sources with words in them that nobody has read yet.
 *
 * TRIAGE ORDER, highest first, because the budget may stop the run partway
 * and the sources most likely to carry the moment should be the ones that
 * got read. A source with no transcript_url is not here however promising:
 * the scan phase needs an address, and "we know it has a transcript" is not
 * one.
 */
export async function sourcesToScan(db: D1Database, runId: string, limit = 5): Promise<Scannable[]> {
  const { results } = await db
    .prepare(
      `SELECT id, url, title, transcript_url, duration_s
         FROM scout_sources
        WHERE run_id = ? AND scanned = 0 AND transcript != 'none'
          AND transcript_url IS NOT NULL AND transcript_url != ''
        ORDER BY COALESCE(triage_score, 0) DESC, id
        LIMIT ?`,
    )
    .bind(runId, limit)
    .all<{ id: string; url: string; title: string | null; transcript_url: string; duration_s: number | null }>();
  return (results ?? []).map((r) => ({
    id: r.id,
    url: r.url,
    title: r.title,
    transcriptUrl: r.transcript_url,
    durationS: r.duration_s,
  }));
}

export async function markScanned(db: D1Database, sourceId: string, yieldN: number): Promise<void> {
  await db
    .prepare("UPDATE scout_sources SET scanned = 1, yield_n = ?, dead_end = ? WHERE id = ?")
    .bind(yieldN, yieldN ? 0 : 1, sourceId)
    .run();
}

/* ── The ledger ─────────────────────────────────────────────────────────── */

export interface LedgerIn {
  runId: string;
  beatId: string | null;
  role: string;
  sourceId: string;
  quoteExact: string;
  quoteNorm: string;
  wordSpan: { startWord: number; endWord: number };
  tStartS: number;
  tEndS: number;
  contextBefore?: string;
  contextAfter?: string;
  foundByFamily?: Family;
  verify: Verdict;
  matchScore: number;
  crowdSignals?: number;
  modelVersion?: string;
}

/**
 * One row per find, verified or not.
 *
 * A REJECTED ROW IS WRITTEN TOO, which looks like clutter and is the
 * measurement: spec 3.6 says to "log the rejection rate per model and prompt
 * version from day one — that rate is Scout's measured hallucination rate,
 * and it gates model swaps". A ledger holding only successes cannot produce
 * it.
 */
export async function writeLedger(db: D1Database, rows: LedgerIn[], now = Date.now()): Promise<string[]> {
  if (!rows.length) return [];
  const ids = rows.map(() => ulid(now));
  await db.batch(
    rows.map((r, i) =>
      db
        .prepare(
          "INSERT INTO scout_ledger (id, run_id, beat_id, role, source_id, quote_exact, quote_norm, word_span_json, t_start_s, t_end_s, context_before, context_after, found_by_family, verify, match_score, crowd_signals_n, model_version, created_at) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          ids[i],
          r.runId,
          r.beatId ? `${r.runId}:${r.beatId}` : null,
          r.role,
          r.sourceId,
          r.quoteExact,
          r.quoteNorm,
          JSON.stringify(r.wordSpan),
          r.tStartS,
          r.tEndS,
          r.contextBefore ?? null,
          r.contextAfter ?? null,
          r.foundByFamily ?? null,
          r.verify,
          r.matchScore,
          r.crowdSignals ?? 0,
          r.modelVersion ?? null,
          now,
        ),
    ),
  );
  return ids;
}

export interface Unverified {
  id: string;
  sourceId: string;
  quoteExact: string;
  /** The window the scan read, and the hint it is allowed to give. */
  hintWordIndex: number;
  transcriptUrl: string;
}

/**
 * Finds nobody has checked, with the address of the recording to check against.
 *
 * GROUPED BY SOURCE BY THE ORDER, not by the caller: rows from one source
 * share one transcript, and a fetch per row would pull the same megabyte of
 * VTT down once for every quote found in it. The verify phase relies on this
 * ordering to fetch once and reuse.
 *
 * A row whose source has lost its transcript url is left alone rather than
 * rejected. It cannot be checked, and "we could not look" is not the same
 * answer as "it is not there" — invariant 4's reachable "nothing backs this"
 * has to mean the second one.
 */
export async function rowsToVerify(db: D1Database, runId: string, limit = 50): Promise<Unverified[]> {
  const { results } = await db
    .prepare(
      `SELECT l.id, l.source_id, l.quote_exact, l.word_span_json, s.transcript_url
         FROM scout_ledger l
         JOIN scout_sources s ON s.id = l.source_id
        WHERE l.run_id = ? AND l.verified_at IS NULL
          AND s.transcript_url IS NOT NULL AND s.transcript_url != ''
        ORDER BY l.source_id, l.id
        LIMIT ?`,
    )
    .bind(runId, limit)
    .all<{
      id: string;
      source_id: string;
      quote_exact: string;
      word_span_json: string;
      transcript_url: string;
    }>();
  return (results ?? []).map((r) => {
    let hint = 0;
    try {
      hint = Number((JSON.parse(r.word_span_json) as { startWord?: unknown }).startWord) || 0;
    } catch {
      /* A span that will not parse is a hint we do not have, which costs the
         fuzzy pass its narrowing and costs the exact pass nothing. */
    }
    return {
      id: r.id,
      sourceId: r.source_id,
      quoteExact: r.quote_exact,
      hintWordIndex: hint,
      transcriptUrl: r.transcript_url,
    };
  });
}

/**
 * The verifier's answer, written where the scan's guess was.
 *
 * THE SPAN AND THE TIMES ARE REPLACED, which is invariant 2 landing in a
 * column. The scan recorded the window it read and the model's hint; what
 * goes in here is the span that actually matched and the times read off
 * those words. A rejected row keeps the scan's window, because there is no
 * matched span to replace it with and blanking it would lose what was read.
 *
 * `verified_at` is set on every outcome including rejection. That is what
 * stops the phase re-reading the same hallucination every round, and it is
 * the timestamp the rejection rate is measured at.
 */
export async function setVerification(
  db: D1Database,
  id: string,
  v: {
    verify: Verdict;
    matchScore: number;
    span: { startWord: number; endWord: number } | null;
    tStartS: number | null;
    tEndS: number | null;
    contextBefore?: string | null;
    contextAfter?: string | null;
  },
  now = Date.now(),
): Promise<void> {
  await db
    .prepare(
      `UPDATE scout_ledger
          SET verify = ?,
              match_score = ?,
              word_span_json = COALESCE(?, word_span_json),
              t_start_s = COALESCE(?, t_start_s),
              t_end_s = COALESCE(?, t_end_s),
              context_before = COALESCE(?, context_before),
              context_after = COALESCE(?, context_after),
              verified_at = ?
        WHERE id = ?`,
    )
    .bind(
      v.verify,
      v.matchScore,
      v.span ? JSON.stringify(v.span) : null,
      v.tStartS,
      v.tEndS,
      v.contextBefore ?? null,
      v.contextAfter ?? null,
      now,
      id,
    )
    .run();
}

/** Links a copy to the original it came from, once a trace seed finds it. */
export async function setOriginalOf(db: D1Database, ledgerId: string, originalId: string): Promise<void> {
  await db.prepare("UPDATE scout_ledger SET original_of = ? WHERE id = ?").bind(originalId, ledgerId).run();
}

/* ── The snapshot ───────────────────────────────────────────────────────── */

/**
 * COUNTS, NOT ROWS, in as few queries as the shape allows.
 *
 * This is the question `scout-run.ts` asks to decide what happens next, and
 * the reason a dead run is resumable: nothing it needs lives in memory. Every
 * field is a count the database can produce.
 *
 * `queriesPending`, `candidatesUntriaged`, `sourcesUnscanned` and
 * `scansUnverified` are all "work created and not yet consumed", which in a
 * relational store is a null column rather than a queue. That is why they are
 * cheap, and why a worker dying between writing a source and triaging it
 * costs nothing — the next planner call sees the same null.
 */
export async function snapshot(
  db: D1Database,
  runId: string,
  extra: Pick<RunSnapshot, "queriesPending" | "snowballed" | "stop"> & { degradedAccepted?: boolean },
): Promise<RunSnapshot> {
  const one = async (sql: string): Promise<number> => {
    const row = await db.prepare(sql).bind(runId).first<{ n: number }>();
    return Number(row?.n ?? 0);
  };

  const [beats, untriaged, unscanned, verifiedRows, reduced] = await Promise.all([
    one("SELECT COUNT(*) AS n FROM scout_beats WHERE run_id = ?"),
    one("SELECT COUNT(*) AS n FROM scout_sources WHERE run_id = ? AND triage_score IS NULL"),
    one(
      "SELECT COUNT(*) AS n FROM scout_sources WHERE run_id = ? AND triage_score IS NOT NULL AND scanned = 0 " +
        "AND transcript != 'none'",
    ),
    one("SELECT COUNT(*) AS n FROM scout_ledger WHERE run_id = ? AND verify = 'verified'"),
    one("SELECT COUNT(*) AS n FROM scout_ledger WHERE run_id = ? AND match_score IS NOT NULL AND verify = 'verified'"),
  ]);

  const { results: items } = await db
    .prepare(
      "SELECT i.id AS id, i.status AS status FROM job_items i " +
        "JOIN jobs j ON j.id = i.job_id WHERE j.ref_id = ?",
    )
    .bind(runId)
    .all<{ id: string; status: ItemStatus }>();

  return {
    decomposed: beats > 0,
    rounds: extra.stop.rounds,
    queriesPending: extra.queriesPending,
    candidatesUntriaged: untriaged,
    sourcesUnscanned: unscanned,
    /*
     * A FIND NOBODY HAS CHECKED. This counted something else and was
     * therefore always zero, so the planner never once asked for verify.
     *
     * It read: a source scanned with a yield that has NO ledger row — which
     * assumed the VERIFIER writes the row. The scan writes it, unverified,
     * and it is right to: a find that existed only after verification would
     * be lost entirely by a worker that died between the two, and invariant
     * 7 is the rule that a half-finished job must not look finished. So the
     * row appears the moment it is found, saying nothing has checked it.
     *
     * Which makes the gap between scanning and checking a property of the
     * ROW, not of the source, and `verified_at IS NULL` is where it lives.
     */
    scansUnverified: await one(
      "SELECT COUNT(*) AS n FROM scout_ledger WHERE run_id = ? AND verified_at IS NULL",
    ),
    verifiedRows,
    reduced: reduced > 0 && (await one("SELECT COUNT(*) AS n FROM scout_runs WHERE id = ? AND status IN ('done','stopped')")) > 0,
    snowballed: extra.snowballed,
    items: (items ?? []).map((i) => ({ id: i.id, status: i.status })),
    ...(extra.degradedAccepted === undefined ? {} : { degradedAccepted: extra.degradedAccepted }),
    stop: extra.stop,
  };
}

/* ── The diligence log ──────────────────────────────────────────────────── */

export interface Diligence {
  queriesRun: number;
  queriesRefused: number;
  sourcesExamined: number;
  sourcesRead: number;
  sourcesLinkOnly: number;
  candidatesScanned: number;
  verified: number;
  paraphrase: number;
  rejected: number;
  /** The measurement that gates a model swap. */
  rejectionRate: number;
}

/**
 * What was tried, for the dispute file.
 *
 * Spec section 4: "A diligence log export: queries run, sources examined,
 * counterpoints sought, rejections." This is the counting half; the rows are
 * already there, and the point of the export is that they always were.
 *
 * `queriesRefused` is separated on purpose. A run that issued thirty queries
 * and a run that issued six and was refused twenty-four look identical in a
 * single total, and only one of them has done the work.
 */
export async function diligence(db: D1Database, runId: string): Promise<Diligence> {
  const { results: searches } = await db
    .prepare("SELECT outcome, COUNT(*) AS n FROM scout_searches WHERE run_id = ? GROUP BY outcome")
    .bind(runId)
    .all<{ outcome: string; n: number }>();
  const { results: sources } = await db
    .prepare("SELECT transcript, scanned, COUNT(*) AS n FROM scout_sources WHERE run_id = ? GROUP BY transcript, scanned")
    .bind(runId)
    .all<{ transcript: string; scanned: number; n: number }>();
  const { results: ledger } = await db
    .prepare("SELECT verify, COUNT(*) AS n FROM scout_ledger WHERE run_id = ? GROUP BY verify")
    .bind(runId)
    .all<{ verify: Verdict; n: number }>();

  const q = Object.fromEntries((searches ?? []).map((r) => [r.outcome, Number(r.n)]));
  const v = Object.fromEntries((ledger ?? []).map((r) => [r.verify, Number(r.n)]));

  let examined = 0;
  let read = 0;
  let linkOnly = 0;
  let scanned = 0;
  for (const r of sources ?? []) {
    const n = Number(r.n);
    examined += n;
    if (r.transcript === "none") linkOnly += n;
    else read += n;
    if (r.scanned) scanned += n;
  }

  const verified = v.verified ?? 0;
  const rejected = v.rejected ?? 0;
  const decided = verified + rejected;

  return {
    queriesRun: q.ok ?? 0,
    queriesRefused: (q.quota_exhausted ?? 0) + (q.failed ?? 0) + (q.skipped_duplicate ?? 0),
    sourcesExamined: examined,
    sourcesRead: read,
    sourcesLinkOnly: linkOnly,
    candidatesScanned: scanned,
    verified,
    paraphrase: v.paraphrase ?? 0,
    rejected,
    /* A paraphrase is a human's decision, not a failure, so it is counted and
       kept out of the ratio — otherwise a careful prompt scores worse than an
       inventive one. */
    rejectionRate: decided ? Number((rejected / decided).toFixed(4)) : 0,
  };
}
