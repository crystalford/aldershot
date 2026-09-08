/**
 * The library — everything kept, and the two ways of searching it.
 *
 * "Search runs in two modes: meaning (embeddings) and exact (transcript text)"
 * (01-PRODUCT.md §Footage). They answer genuinely different questions, so both
 * exist rather than one pretending to be both.
 *
 * Meaning search needs Vectorize. When that index is not available the code
 * says so and falls back to exact — it never quietly returns worse results and
 * lets the user conclude their library is empty.
 */

import type { Env } from "./env.ts";

export interface Moment {
  id: string;
  start_ms: number;
  end_ms: number;
  quote: string;
  why: string | null;
  origin: string;
  used_count: number;
  frame_r2_key: string;
  source_title: string;
  source_id: string;
  source_key: string;
  short_key: string | null;
  thread_name: string | null;
  /* Always 1 in this list — the query filters on it — but carried so the card
     can render its own state and put it back after an undo. */
  kept: number;
}

const SELECT_MOMENTS = `
  SELECT c.id, c.start_ms, c.end_ms, c.quote, c.why, c.origin, c.used_count, c.frame_r2_key,
         c.source_id, c.kept,
         s.title AS source_title,
         /* The footage this came from, so a clip can PLAY. A moment is a range
            of a video, and a video element given #t=start,end plays exactly
            that range — no render, no second file. Without this the cards were
            stills you could not click.
            The EDITING COPY when there is one: a grid of these is a range
            request per card into the original, which is the worst version of
            the problem src/proxy.ts exists to solve. A short is still RENDERED
            from the master — see short-render.ts, which reads r2_key. */
         COALESCE(s.proxy_r2_key, s.r2_key) AS source_key,
         /* Whether it has already been made into a short, so the card can show
            the finished thing rather than offering to make it twice. */
         (SELECT r.r2_key FROM renders r
           WHERE r.clip_id = c.id AND r.state = 'ready' AND r.r2_key IS NOT NULL
           ORDER BY r.created_at DESC LIMIT 1) AS short_key,
         (SELECT t.name FROM v2_clip_threads ct JOIN v2_threads t ON t.id = ct.thread_id
           WHERE ct.clip_id = c.id ORDER BY ct.confidence DESC LIMIT 1) AS thread_name
    FROM v2_clips c
    JOIN sources s ON s.id = c.source_id
   WHERE c.user_id = ? AND c.deleted_at IS NULL AND c.kept = 1
     /* AND its video is still here. Deleting footage soft-deletes the source
        but leaves its clips, so the Clips tab kept offering moments whose
        video was in the bin — they played nothing, and the seam's clip picker
        offered them as material that could never be pulled in. */
     AND s.deleted_at IS NULL`;

/**
 * How many moments there are, without loading them.
 *
 * The Footage tab bar shows this on every tab; loading the rows themselves
 * just to count them would fetch sixteen quotes and frames to render one
 * number.
 */
export async function countMoments(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM v2_clips c
         JOIN sources s ON s.id = c.source_id
        WHERE c.user_id=? AND c.deleted_at IS NULL AND c.kept=1 AND s.deleted_at IS NULL`,
    )
    .bind(userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Everything kept, newest first. */
export async function listMoments(db: D1Database, userId: string, limit = 60): Promise<Moment[]> {
  const { results } = await db
    .prepare(`${SELECT_MOMENTS} ORDER BY c.created_at DESC LIMIT ?`)
    .bind(userId, limit)
    .all<Moment>();
  return results ?? [];
}

/**
 * Which clips are in which thread. Footage's thread chips filter the grid, and
 * a clip can sit in more than one thread, so this is a set per clip rather
 * than a column on the clip.
 */
export async function threadIdsByClip(db: D1Database, userId: string): Promise<Map<string, string[]>> {
  const { results } = await db
    .prepare(
      `SELECT ct.clip_id, ct.thread_id FROM v2_clip_threads ct
        JOIN v2_clips c ON c.id = ct.clip_id
       WHERE c.user_id = ? AND c.deleted_at IS NULL`,
    )
    .bind(userId)
    .all<{ clip_id: string; thread_id: string }>();

  const out = new Map<string, string[]>();
  for (const r of results ?? []) {
    const list = out.get(r.clip_id);
    if (list) list.push(r.thread_id);
    else out.set(r.clip_id, [r.thread_id]);
  }
  return out;
}

/**
 * Exact search — the words that were said.
 *
 * Matches the clip's quote and the source's title. Terms are AND-ed, so adding
 * a word narrows rather than widens, which is what people expect from a search
 * box even though it is the opposite of how relevance ranking usually works.
 */
export async function searchExact(db: D1Database, userId: string, query: string, limit = 60): Promise<Moment[]> {
  const terms = query.trim().toLowerCase().split(/\s+/).filter((t) => t.length > 1).slice(0, 6);
  if (!terms.length) return listMoments(db, userId, limit);

  const where = terms.map(() => `(LOWER(c.quote) LIKE ? OR LOWER(s.title) LIKE ?)`).join(" AND ");
  const binds: unknown[] = [userId];
  for (const t of terms) binds.push(`%${t}%`, `%${t}%`);
  binds.push(limit);

  const { results } = await db
    .prepare(`${SELECT_MOMENTS} AND ${where} ORDER BY c.created_at DESC LIMIT ?`)
    .bind(...binds)
    .all<Moment>();
  return results ?? [];
}

/**
 * Meaning search — embeddings, via Vectorize.
 *
 * Returns null when the index is not configured, so the caller can say so
 * plainly. Returning [] instead would be indistinguishable from "your library
 * has nothing like that in it", which is a different and much more misleading
 * statement.
 */
export async function searchMeaning(
  env: Env,
  userId: string,
  query: string,
  limit = 60,
): Promise<Moment[] | null> {
  if (!env.VECTORIZE) return null;

  const { EMBED } = await import("./models.ts");
  const run = env.AI.run.bind(env.AI) as (m: string, i: Record<string, unknown>) => Promise<{ data?: number[][] }>;
  const embedded = await run(EMBED.id, { text: [query] });
  const vector = embedded.data?.[0];
  if (!vector) return null;

  const matches = await env.VECTORIZE.query(vector, { topK: limit, filter: { user_id: userId } });
  const ids = (matches.matches ?? []).map((m) => m.id);
  if (!ids.length) return [];

  const marks = ids.map(() => "?").join(",");
  const { results } = await env.DB
    .prepare(`${SELECT_MOMENTS} AND c.id IN (${marks})`)
    .bind(userId, ...ids)
    .all<Moment>();

  // Preserve the order Vectorize returned — that IS the relevance ranking, and
  // re-sorting by date would throw away the whole point of the query.
  const byId = new Map((results ?? []).map((m) => [m.id, m]));
  return ids.map((id) => byId.get(id)).filter((m): m is Moment => Boolean(m));
}

export interface Thread {
  id: string;
  name: string;
  summary: string | null;
  clip_count: number;
  sample: string | null;
}

export async function listThreads(db: D1Database, userId: string): Promise<Thread[]> {
  const { results } = await db
    .prepare(
      `SELECT t.id, t.name, t.summary, t.clip_count,
              (SELECT c.quote FROM v2_clip_threads ct JOIN v2_clips c ON c.id = ct.clip_id
                WHERE ct.thread_id = t.id AND c.deleted_at IS NULL
                ORDER BY ct.confidence DESC LIMIT 1) AS sample
         FROM v2_threads t
        WHERE t.user_id = ?
        ORDER BY t.clip_count DESC`,
    )
    .bind(userId)
    .all<Thread>();
  return results ?? [];
}
