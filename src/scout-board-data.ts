/**
 * THE BOARD'S DATA, from the rows.
 *
 * `src/ui/pages/board.ts` renders; this is what it renders. Split because
 * the renderer was built against the prototype and tested with fixtures, and
 * a renderer that also queried would have had to be tested with a database —
 * which is how a surface ends up only being checkable one way.
 *
 * EVERY ROW IS A LEDGER ROW OR A CROWD ROW, and the board's distinction
 * between them is not about quality. A verified row is a quote checked
 * against its source; a crowd row is a place fans point at that Scout could
 * not read. The second is not worse evidence — it is not evidence yet, and
 * the board says so with a different chip and a different button.
 */

import type { BoardBeat, BoardData, BoardRow, AcqState, Route } from "./ui/pages/board.ts";

interface LedgerJoin {
  id: string;
  beat_id: string | null;
  quote_exact: string;
  t_start_s: number;
  context_before: string | null;
  context_after: string | null;
  verify: string;
  crowd_signals_n: number;
  title: string | null;
  channel: string | null;
  host: string | null;
  transcript: string | null;
  published_at: number | null;
}

/** Month precision, which is what a credit line carries. */
const when = (ms: number | null): string => {
  if (!ms) return "";
  const d = new Date(ms);
  return `${d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })} ${d.getUTCFullYear()}`;
};

/**
 * How this footage would arrive, from whether its transcript was readable.
 *
 * The board's route chip, derived rather than stored: `yours` is the user's
 * own capture, `feed` is a source that publishes its file, and everything
 * else is a mission. A column would be a second place for this to be wrong.
 */
function routeOf(transcript: string | null): Route {
  if (transcript === "yours") return "yours";
  if (transcript === "native" || transcript === "transcribed") return "feed";
  return "mission";
}

/** Where the footage is now, as against how it would arrive. */
function acqOf(transcript: string | null): AcqState {
  if (transcript === "yours") return "owned";
  return "scouted";
}

export async function boardFor(db: D1Database, projectId: string): Promise<BoardData> {
  /* The latest run for this project. A board showing several runs at once
     would mix two diligence records into one claim. */
  const run = await db
    .prepare("SELECT * FROM scout_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1")
    .bind(projectId)
    .first<Record<string, unknown>>();

  const empty: BoardData = {
    verifiedMoments: 0,
    crowdRows: 0,
    beats: [],
    stopped: false,
    sourcesRead: 0,
    sourcesLinkOnly: 0,
    candidatesScanned: 0,
  };
  if (!run) return empty;

  const runId = String(run.id);
  const [{ results: beats }, { results: rows }, { results: tried }, { results: sources }] = await Promise.all([
    db
      .prepare("SELECT * FROM scout_beats WHERE run_id = ? ORDER BY idx")
      .bind(runId)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        "SELECT l.*, s.title AS title, s.channel AS channel, s.adapter AS host, s.transcript AS transcript, " +
          "s.published_at AS published_at FROM scout_ledger l " +
          "LEFT JOIN scout_sources s ON s.id = l.source_id WHERE l.run_id = ? ORDER BY l.created_at",
      )
      .bind(runId)
      .all<LedgerJoin>(),
    db
      .prepare("SELECT beat_id, COUNT(*) AS n FROM scout_searches WHERE run_id = ? GROUP BY beat_id")
      .bind(runId)
      .all<{ beat_id: string | null; n: number }>(),
    db
      .prepare("SELECT transcript, scanned, COUNT(*) AS n FROM scout_sources WHERE run_id = ? GROUP BY transcript, scanned")
      .bind(runId)
      .all<{ transcript: string; scanned: number; n: number }>(),
  ]);

  const triedBy = new Map((tried ?? []).map((t) => [String(t.beat_id ?? ""), Number(t.n)]));

  const byBeat = new Map<string, BoardRow[]>();
  let verifiedMoments = 0;
  let crowdRows = 0;

  for (const r of rows ?? []) {
    const verified = r.verify === "verified";
    if (verified) verifiedMoments += 1;
    else crowdRows += 1;

    const row: BoardRow = {
      /* A paraphrase and a rejection are NOT verified rows, and the board has
         no chip that says "nearly". They show as crowd rows — a place
         somebody should look — which is what they are until a person has
         decided otherwise. */
      kind: verified ? "verified" : "crowd",
      acq: acqOf(r.transcript),
      route: routeOf(r.transcript),
      text: r.quote_exact,
      tS: Number(r.t_start_s),
      sourceName: r.title ?? r.channel ?? "unknown source",
      host: r.host ?? "",
      ...(r.context_before ? { before: r.context_before } : {}),
      ...(r.context_after ? { after: r.context_after } : {}),
      credit:
        r.transcript === "yours"
          ? "no credit needed — your own capture"
          : [`Source: ${r.channel ?? "unknown"}`, r.host ?? "", when(r.published_at)].filter(Boolean).join(" · "),
      ...(r.crowd_signals_n ? { crowdSignals: Number(r.crowd_signals_n) } : {}),
    };
    const key = String(r.beat_id ?? "");
    byBeat.set(key, [...(byBeat.get(key) ?? []), row]);
  }

  let sourcesRead = 0;
  let sourcesLinkOnly = 0;
  let candidatesScanned = 0;
  for (const s of sources ?? []) {
    const n = Number(s.n);
    if (s.transcript === "none") sourcesLinkOnly += n;
    else sourcesRead += n;
    if (s.scanned) candidatesScanned += n;
  }

  const boardBeats: BoardBeat[] = (beats ?? []).map((b) => ({
    /* The beat's own id, as the board shows it — B1, not `<run>:B1`. */
    id: String(b.id).slice(runId.length + 1),
    name: String(b.name),
    role: (b.role === "counter" ? "counter" : b.role === "outside" ? "context" : "subject") as BoardBeat["role"],
    behaviour: String(b.behaviour),
    needMin: Number(b.need_min),
    rows: byBeat.get(String(b.id)) ?? [],
    queriesTried: triedBy.get(String(b.id)) ?? 0,
  }));

  return {
    verifiedMoments,
    crowdRows,
    beats: boardBeats,
    /*
     * STOPPED IS READ OFF THE RUN, not inferred from the rows. A gap is only
     * a gap once the looking has finished, and a board that decided for
     * itself would call a beat short mid-run — which is the distinction
     * scout-run.ts exists to keep.
     */
    stopped: run.status === "done" || run.status === "stopped",
    sourcesRead,
    sourcesLinkOnly,
    candidatesScanned,
  };
}
