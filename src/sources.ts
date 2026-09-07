/**
 * Sources — the long videos. "Assume the source is a 45–180 minute video they
 * did not record" (01-PRODUCT.md).
 *
 * Originals live in R2 and are kept forever. Nothing is ever auto-deleted:
 * permanence is a product promise, and the cost of it is accepted
 * (05-INFRA-AND-COSTS.md §Permanence). `deleted_at` only.
 */

import { ulid } from "./id.ts";
import type { WhisperSegment } from "./transcribe.ts";
import { reconcile } from "./transcribe.ts";

export type TranscriptState = "pending" | "running" | "ready" | "failed";

export interface Source {
  id: string;
  user_id: string;
  title: string;
  filename: string | null;
  origin: "upload" | "url" | "library";
  r2_key: string;
  stream_uid: string | null;
  duration_s: number | null;
  width: number | null;
  height: number | null;
  transcript_state: TranscriptState;
  poster_r2_key: string | null;
  /**
   * What the cut of this footage gets called — worked out from the transcript
   * when it was read, and null for anything read before that existed.
   * Deliberately not `title`: see src/naming.ts.
   */
  cut_title: string | null;
  /** What the user asked for when they added it. See src/schema.ts. */
  brief: string | null;
  created_at: number;
  deleted_at: number | null;
}

export interface Segment {
  id: string;
  source_id: string;
  idx: number;
  start_ms: number;
  end_ms: number;
  speaker: string | null;
  text: string;
  words: string | null;
}

/**
 * A source's title defaults to its filename with the extension and separators
 * cleaned up — "jones_quartering_full.mp4" reads better as a heading than as a
 * path, and the user can rename it. Never invent a title from content.
 */
export function titleFromFilename(filename: string): string {
  return filename.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim() || filename;
}

export function r2KeyFor(userId: string, sourceId: string, filename: string): string {
  const ext = (filename.match(/\.[a-z0-9]+$/i)?.[0] ?? ".mp4").toLowerCase();
  return `u/${userId}/sources/${sourceId}/original${ext}`;
}

export async function createSource(
  db: D1Database,
  opts: { user_id: string; filename: string; origin: Source["origin"]; title?: string; brief?: string },
): Promise<Source> {
  const id = ulid();
  const src: Source = {
    id,
    user_id: opts.user_id,
    title: opts.title || titleFromFilename(opts.filename),
    filename: opts.filename,
    origin: opts.origin,
    r2_key: r2KeyFor(opts.user_id, id, opts.filename),
    stream_uid: null,
    duration_s: null,
    width: null,
    height: null,
    transcript_state: "pending",
    poster_r2_key: null,
    cut_title: null,
    brief: opts.brief?.trim() || null,
    created_at: Date.now(),
    deleted_at: null,
  };
  await db
    .prepare(
      `INSERT INTO sources (id,user_id,title,filename,origin,r2_key,stream_uid,duration_s,width,height,transcript_state,poster_r2_key,brief,created_at,deleted_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      src.id, src.user_id, src.title, src.filename, src.origin, src.r2_key, src.stream_uid,
      src.duration_s, src.width, src.height, src.transcript_state, src.poster_r2_key,
      src.brief, src.created_at, src.deleted_at,
    )
    .run();
  return src;
}

export async function getSource(db: D1Database, id: string, userId: string): Promise<Source | null> {
  return await db
    .prepare(`SELECT * FROM sources WHERE id=? AND user_id=? AND deleted_at IS NULL`)
    .bind(id, userId)
    .first<Source>();
}

/**
 * Clears sources whose upload never finished.
 *
 * A source row is created when an upload STARTS, because the resume machinery
 * needs an id to hang parts off. The cost is that an upload which dies before
 * completing leaves a row behind that looks exactly like a real video in
 * Footage — the owner saw two of them and reasonably read them as duplicates.
 * They were ghosts: no object in R2, no read job, nothing to open.
 *
 * A ghost is a source that is still `pending`, has no job, has no upload in
 * flight, and is old enough that it is not simply mid-upload right now. An
 * hour is far longer than the gap between starting an upload and the first
 * part landing, and resumable uploads keep their `uploads` row, so this cannot
 * reap anything a user could still finish.
 */
const GHOST_AFTER_MS = 60 * 60 * 1000;

export async function reapGhostSources(db: D1Database, userId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE sources SET deleted_at=?
        WHERE user_id=? AND deleted_at IS NULL AND transcript_state='pending'
          AND created_at < ?
          AND id NOT IN (SELECT source_id FROM uploads)
          AND id NOT IN (SELECT ref_id FROM jobs WHERE ref_id IS NOT NULL)`,
    )
    .bind(Date.now(), userId, Date.now() - GHOST_AFTER_MS)
    .run();
}

/**
 * How a library may be ordered.
 *
 * There was no sort control anywhere in the product — every list was newest
 * first and that was that. The clauses are a fixed map rather than anything
 * built from the request, because the sort arrives as a query parameter and a
 * parameter that reaches an ORDER BY is an injection waiting to happen.
 */
export const SOURCE_SORTS = {
  newest: "created_at DESC",
  oldest: "created_at ASC",
  longest: "duration_s DESC NULLS LAST, created_at DESC",
  name: "LOWER(title) ASC",
} as const;

export type SourceSort = keyof typeof SOURCE_SORTS;

export function isSourceSort(v: unknown): v is SourceSort {
  return typeof v === "string" && v in SOURCE_SORTS;
}

export async function listSources(
  db: D1Database,
  userId: string,
  sort: SourceSort = "newest",
): Promise<Source[]> {
  await reapGhostSources(db, userId);
  const { results } = await db
    .prepare(`SELECT * FROM sources WHERE user_id=? AND deleted_at IS NULL ORDER BY ${SOURCE_SORTS[sort]}`)
    .bind(userId)
    .all<Source>();
  return results ?? [];
}

/**
 * How many clips each source has yielded, keyed by source id.
 *
 * Clipping's rows read "1:22:04 · 6 clips found", so the count has to come
 * back with the list. One grouped query rather than one per row.
 */
export async function clipCountsBySource(
  db: D1Database,
  userId: string,
): Promise<Map<string, number>> {
  const { results } = await db
    .prepare(
      `SELECT source_id, COUNT(*) AS n FROM v2_clips
        WHERE user_id=? AND deleted_at IS NULL GROUP BY source_id`,
    )
    .bind(userId)
    .all<{ source_id: string; n: number }>();
  return new Map((results ?? []).map((r) => [r.source_id, r.n]));
}

/**
 * How many edits are being made from each source, keyed by source id.
 *
 * Footage's whole subject is "everything you have", and a video's card said
 * its title and the date — not how many clips came out of it and not whether
 * anything was being made from it. The footage/edit relationship is the thing
 * this product is built around; the library page was the one place that never
 * mentioned it.
 *
 * Same shape and same cost as clipCountsBySource: one grouped query, not one
 * per row. TOUCHED is not applied — an edit you opened and have not cut yet is
 * still an edit made from this video, and the point of the number is to say
 * where your work is.
 */
export async function editCountsBySource(
  db: D1Database,
  userId: string,
): Promise<Map<string, number>> {
  const { results } = await db
    .prepare(
      `SELECT source_id, COUNT(*) AS n FROM v2_projects
        WHERE user_id=? AND deleted_at IS NULL AND archived_at IS NULL AND source_id IS NOT NULL
        GROUP BY source_id`,
    )
    .bind(userId)
    .all<{ source_id: string; n: number }>();
  return new Map((results ?? []).map((r) => [r.source_id, r.n]));
}

export async function setTranscriptState(db: D1Database, id: string, state: TranscriptState): Promise<void> {
  await db.prepare(`UPDATE sources SET transcript_state=? WHERE id=?`).bind(state, id).run();
}

/**
 * Writes the transcript. Replaces any previous one for this source so a retry
 * is idempotent — a failed transcribe that half-wrote its segments must not
 * leave duplicates behind when the user hits Retry.
 */
export async function saveSegments(db: D1Database, sourceId: string, segments: WhisperSegment[]): Promise<number> {
  await db.prepare(`DELETE FROM segments WHERE source_id=?`).bind(sourceId).run();
  if (!segments.length) return 0;

  const stmt = db.prepare(
    `INSERT INTO segments (id,source_id,idx,start_ms,end_ms,speaker,text,words) VALUES (?,?,?,?,?,?,?,?)`,
  );
  // D1 batches are capped, so write in slices rather than one giant batch —
  // a 180-minute source is ~400 segments today but could be far more.
  const BATCH = 100;
  for (let i = 0; i < segments.length; i += BATCH) {
    const slice = segments.slice(i, i + BATCH);
    await db.batch(
      slice.map((s, j) =>
        stmt.bind(
          ulid(),
          sourceId,
          i + j,
          Math.round(s.start * 1000),
          Math.round(s.end * 1000),
          s.speaker != null ? String(s.speaker) : null,
          s.text.trim(),
          JSON.stringify(reconcile(s).map((w) => ({ w: w.word, s: w.start, e: w.end }))),
        ),
      ),
    );
  }
  return segments.length;
}

export async function getSegments(db: D1Database, sourceId: string): Promise<Segment[]> {
  const { results } = await db
    .prepare(`SELECT * FROM segments WHERE source_id=? ORDER BY idx`)
    .bind(sourceId)
    .all<Segment>();
  return results ?? [];
}
