/**
 * EXTERNAL MOMENTS, AND THE GHOSTS THEY BECOME.
 *
 * Scout's verified rows are moments. Doc 18: "An external moment is
 * moment(provenance: external, acq: …), pointing at its ledger row. It uses
 * the same table and engine as the user's own moments." They are not in
 * `v2_clips` — nothing was downloaded, so there is no clip to make — so this
 * reads them out of the ledger in the shape the room's moment list already
 * takes, and the room shows one list with a filter rather than two lists.
 *
 * WHY A SEPARATE FILE. `scout-board-data.ts` reads the same rows for one
 * project's board; this reads them across the library for the room. Both are
 * thin queries over the same nine tables, and keeping them apart means the
 * room's shape is not hostage to the board's.
 *
 * INVARIANT 9 IS WHY THERE IS NO FRAME. A moment of your own has a frame
 * because the file is in R2. An external moment has none and must not: we
 * linked it. The card renders its empty box, which is the honest picture.
 */

import { deepLink } from "./scout-mission.ts";

export type Acq = "linked" | "mission" | "verified";

export interface ExternalMoment {
  /** The ledger id. It is the moment's id everywhere in the room. */
  id: string;
  quote: string;
  /** Always "" — see the note above. */
  frame_r2_key: string;
  source_title: string;
  /** The platform, which is the first thing the card's note says. */
  host: string | null;
  /** Seconds into the source, read off word ids by the verifier. */
  t_start_s: number;
  url: string;
  acq: Acq;
}

interface Row {
  id: string;
  quote_exact: string;
  t_start_s: number;
  title: string | null;
  adapter: string | null;
  url: string | null;
  mission_state: string | null;
}

/*
 * A MISSION IN HAND MEANS ACQUIRED.
 *
 * `matched` is match-back having found the scouted words inside a file the
 * person brought. Everything else with a mission row is a mission still
 * open — including `failed`, because a failed grab is a thing to do again,
 * not a thing that has been done. No mission row at all is `linked`: Scout
 * found it, nobody has asked for it.
 */
export function acqOf(missionState: string | null): Acq {
  if (missionState === "matched") return "verified";
  if (missionState === null || missionState === "dropped") return "linked";
  return "mission";
}

/*
 * SCOPED BY THE USER'S OWN PROJECTS.
 *
 * A ledger row belongs to a run, a run to a project, a project to a user.
 * There is no user_id on the ledger and there should not be one — it would
 * be a second place for the same fact. The join is the scope, and it is a
 * join rather than a filter for exactly the reason /api/begin checks source
 * ids: a library read that takes an id is a way to ask about somebody
 * else's.
 */
const SELECT_EXTERNAL = `
  SELECT l.id AS id,
         l.quote_exact AS quote_exact,
         l.t_start_s AS t_start_s,
         s.title AS title,
         s.adapter AS adapter,
         s.url AS url,
         (SELECT m.state FROM scout_missions m
           WHERE m.ledger_id = l.id AND m.state != 'dropped'
           ORDER BY m.created_at DESC LIMIT 1) AS mission_state
    FROM scout_ledger l
    JOIN scout_runs r ON r.id = l.run_id
    JOIN v2_projects p ON p.id = r.project_id
    LEFT JOIN scout_sources s ON s.id = l.source_id
   WHERE p.user_id = ? AND p.deleted_at IS NULL AND l.verify = 'verified'`;

/**
 * Every verified find across the library, newest first.
 *
 * Only `verified`. A paraphrase is not a quote and a rejection is not a
 * find; the board shows both as crowd rows, where a person can look. The
 * room's moment list is material you can cut, and material you can cut is
 * material whose words were checked.
 */
export async function externalMoments(
  db: D1Database,
  userId: string,
  limit = 60,
): Promise<ExternalMoment[]> {
  const { results } = await db
    .prepare(`${SELECT_EXTERNAL} ORDER BY l.created_at DESC LIMIT ?`)
    .bind(userId, limit)
    .all<Row>();

  return (results ?? []).map((r) => ({
    id: r.id,
    quote: r.quote_exact,
    frame_r2_key: "",
    source_title: r.title ?? "outside your footage",
    host: r.adapter,
    t_start_s: Number(r.t_start_s),
    url: r.url ?? "",
    acq: acqOf(r.mission_state),
  }));
}

/** How many there are, for the chip, without loading them. */
export async function countExternal(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM scout_ledger l
         JOIN scout_runs r ON r.id = l.run_id
         JOIN v2_projects p ON p.id = r.project_id
        WHERE p.user_id = ? AND p.deleted_at IS NULL AND l.verify = 'verified'`,
    )
    .bind(userId)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

/**
 * Which of these ledger ids are this user's to attach.
 *
 * The same check /api/begin runs on source ids, for the same reason. An
 * attach list comes off a URL or a form, so every id in it is a claim until
 * it has been joined back to the user's own projects.
 */
export async function minesOwn(db: D1Database, userId: string, ids: string[]): Promise<Set<string>> {
  const want = ids.filter(Boolean).slice(0, 200);
  if (!want.length) return new Set();
  const marks = want.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      `SELECT l.id AS id FROM scout_ledger l
         JOIN scout_runs r ON r.id = l.run_id
         JOIN v2_projects p ON p.id = r.project_id
        WHERE p.user_id = ? AND p.deleted_at IS NULL AND l.verify = 'verified'
          AND l.id IN (${marks})`,
    )
    .bind(userId, ...want)
    .all<{ id: string }>();
  return new Set((results ?? []).map((r) => r.id));
}

/* ── Attaching one: the ghost ───────────────────────────────────────────── */

/**
 * A GHOST IS A MISSION ROW, FROM THE MOMENT IT IS ATTACHED.
 *
 * The prototype's sentence, which is also the contract: "They attach like
 * anything else and ride into the cut as ghosts until you grab them." A
 * ghost is a moment the cut uses that is not footage yet, and the only
 * durable record of one is a row in `scout_missions` — project, ledger row,
 * in and out, and the deep link a person opens.
 *
 * NOTHING IS WRITTEN UNTIL THERE IS A PROJECT. In the room, attaching is a
 * query parameter: no project exists to own the mission, and writing one
 * against a project that may never be made would leave a mission for a cut
 * that does not exist. /api/begin makes the project and then calls this,
 * once, with what was attached.
 *
 * IDEMPOTENT, because /api/begin can be pressed twice and a cut does not
 * have two missions for one moment. The pair (project, ledger) is the
 * address; a second call on the same pair re-opens a dropped one rather
 * than adding a row, so nothing is deleted and the count stays right.
 */
export async function openMissions(
  db: D1Database,
  projectId: string,
  ledgerIds: string[],
  now = Date.now(),
): Promise<number> {
  const want = [...new Set(ledgerIds.filter(Boolean))];
  if (!want.length) return 0;

  const marks = want.map(() => "?").join(",");
  const { results: rows } = await db
    .prepare(
      `SELECT l.id AS id, l.quote_exact AS quote_exact, l.t_start_s AS t_start_s,
              l.t_end_s AS t_end_s, s.url AS url, s.expires_at AS expires_at
         FROM scout_ledger l
         LEFT JOIN scout_sources s ON s.id = l.source_id
        WHERE l.verify = 'verified' AND l.id IN (${marks})`,
    )
    .bind(...want)
    .all<{
      id: string;
      quote_exact: string;
      t_start_s: number;
      t_end_s: number;
      url: string | null;
      expires_at: number | null;
    }>();

  const stmts = (rows ?? []).map((r) =>
    db
      .prepare(
        `INSERT INTO scout_missions
           (id, project_id, ledger_id, in_s, out_s, quote, url_at_in, state, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'scouted', ?, ?)
         ON CONFLICT(project_id, ledger_id) DO UPDATE SET
           state = CASE WHEN scout_missions.state = 'dropped' THEN 'scouted' ELSE scout_missions.state END`,
      )
      .bind(
        `msn_${projectId}_${r.id}`.slice(0, 120),
        projectId,
        r.id,
        Number(r.t_start_s),
        Number(r.t_end_s),
        r.quote_exact,
        r.url ? deepLink(r.url, Number(r.t_start_s)) : null,
        now,
        r.expires_at,
      ),
  );
  if (!stmts.length) return 0;
  await db.batch(stmts);
  return stmts.length;
}

/** The ghosts this cut is carrying, in the order they were attached. */
export async function ghostsFor(
  db: D1Database,
  projectId: string,
): Promise<Array<{ ledgerId: string; quote: string; inS: number; outS: number; url: string | null; state: string }>> {
  const { results } = await db
    .prepare(
      `SELECT ledger_id, quote, in_s, out_s, url_at_in, state FROM scout_missions
        WHERE project_id = ? AND state != 'dropped' ORDER BY created_at, ledger_id`,
    )
    .bind(projectId)
    .all<{
      ledger_id: string;
      quote: string;
      in_s: number;
      out_s: number;
      url_at_in: string | null;
      state: string;
    }>();
  return (results ?? []).map((r) => ({
    ledgerId: r.ledger_id,
    quote: r.quote,
    inS: Number(r.in_s),
    outS: Number(r.out_s),
    url: r.url_at_in,
    state: r.state,
  }));
}
