/**
 * The clip library — persistent, cross-project "Lego pieces" cut from any
 * video in any project (see migrations/0002_clips.sql). Kept separate from
 * src/db.ts, which is scoped to projects+videos; this owns three new tables
 * and their multi-statement writes.
 *
 * A clip is one-or-more ordered segments: a callback/contrast spanning two
 * far-apart moments is ONE clip with two segments, exactly mirroring how
 * EditSuggestion.segments already works elsewhere in this codebase — so an
 * existing suggestion can be saved to the library with no reshaping.
 */
import type { Segment } from "./transcript/edl";
import { visualTagsByVideo, type VisualTag } from "./visualtags";

export type ClipKind = "manual" | "ai-detected";

export interface Clip {
  id: string;
  title: string;
  description: string | null;
  kind: ClipKind;
  created_at: number;
}

/** A segment as returned to the client — Segment plus the provenance the
 *  library needs to know if a segment is "foreign" to the current project,
 *  plus whatever's visually tagged within its time range (see visualtags.ts —
 *  tags live on the video's own timeline, a segment just picks up whichever
 *  ones its [start,end] overlaps). */
export interface ClipSegmentOut extends Segment {
  projectId: string;
  visualTags: { time: number; caption: string | null; ocrText: string | null }[];
}

export interface ClipDetail extends Clip {
  segments: ClipSegmentOut[];
  tags: string[];
}

export interface NewClipSegment {
  videoId: string;
  projectId: string; // resolved by the route handler via getVideo(), not client input
  start: number;
  end: number;
  reason?: string;
}

export interface ClipFilter {
  tag?: string;
  projectId?: string;
  videoId?: string;
  kind?: ClipKind;
  q?: string;
  limit?: number;
  offset?: number;
}

const normalizeTag = (t: string) => t.trim().toLowerCase();

/** Create tables if absent. Idempotent, same pattern as db.ts's ensureSchema —
 *  safe to call on every clip route so local dev works without a separate
 *  `d1 migrations apply` step. */
export async function ensureClipSchema(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS clips (
         id TEXT PRIMARY KEY,
         title TEXT NOT NULL,
         description TEXT,
         kind TEXT NOT NULL DEFAULT 'manual',
         created_at INTEGER NOT NULL
       )`,
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS clip_segments (
         id TEXT PRIMARY KEY,
         clip_id TEXT NOT NULL,
         project_id TEXT NOT NULL,
         video_id TEXT NOT NULL,
         "start" REAL NOT NULL,
         "end" REAL NOT NULL,
         ord INTEGER NOT NULL DEFAULT 0,
         reason TEXT
       )`,
    ),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_clip_segments_clip ON clip_segments (clip_id, ord)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_clip_segments_video ON clip_segments (video_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_clip_segments_project ON clip_segments (project_id)`),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS clip_tags (
         clip_id TEXT NOT NULL,
         tag TEXT NOT NULL,
         PRIMARY KEY (clip_id, tag)
       )`,
    ),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_clip_tags_tag ON clip_tags (tag)`),
  ]);
}

export async function createClip(
  db: D1Database,
  input: { title: string; description?: string | null; kind: ClipKind; segments: NewClipSegment[]; tags?: string[] },
): Promise<ClipDetail> {
  const clip: Clip = {
    id: crypto.randomUUID(),
    title: input.title,
    description: input.description ?? null,
    kind: input.kind,
    created_at: Date.now(),
  };
  const tags = [...new Set((input.tags ?? []).map(normalizeTag).filter(Boolean))];
  const segments = input.segments.map((s) => ({ id: crypto.randomUUID(), ...s }));

  await db.batch([
    db
      .prepare(`INSERT INTO clips (id, title, description, kind, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(clip.id, clip.title, clip.description, clip.kind, clip.created_at),
    ...segments.map((s, ord) =>
      db
        .prepare(
          `INSERT INTO clip_segments (id, clip_id, project_id, video_id, "start", "end", ord, reason)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(s.id, clip.id, s.projectId, s.videoId, s.start, s.end, ord, s.reason ?? null),
    ),
    ...tags.map((tag) => db.prepare(`INSERT INTO clip_tags (clip_id, tag) VALUES (?, ?)`).bind(clip.id, tag)),
  ]);

  return {
    ...clip,
    tags,
    segments: segments.map((s) => ({ videoId: s.videoId, projectId: s.projectId, start: s.start, end: s.end, reason: s.reason, visualTags: [] })),
  };
}

async function attachSegmentsAndTags(db: D1Database, clips: Clip[]): Promise<ClipDetail[]> {
  if (!clips.length) return [];
  const ids = clips.map((c) => c.id);
  const placeholders = ids.map(() => "?").join(",");
  const [{ results: segRows }, { results: tagRows }] = await Promise.all([
    db
      .prepare(
        `SELECT clip_id, project_id, video_id, "start", "end", reason
         FROM clip_segments WHERE clip_id IN (${placeholders}) ORDER BY clip_id, ord ASC`,
      )
      .bind(...ids)
      .all<{ clip_id: string; project_id: string; video_id: string; start: number; end: number; reason: string | null }>(),
    db
      .prepare(`SELECT clip_id, tag FROM clip_tags WHERE clip_id IN (${placeholders}) ORDER BY tag ASC`)
      .bind(...ids)
      .all<{ clip_id: string; tag: string }>(),
  ]);

  const videoIds = [...new Set((segRows ?? []).map((r) => r.video_id))];
  const visualByVideo = await visualTagsByVideo(db, videoIds);
  const tagsForRange = (videoId: string, start: number, end: number): VisualTag[] =>
    (visualByVideo.get(videoId) ?? []).filter((t) => t.time >= start && t.time <= end);

  const segsByClip = new Map<string, ClipSegmentOut[]>();
  for (const r of segRows ?? []) {
    const list = segsByClip.get(r.clip_id) ?? [];
    const visualTags = tagsForRange(r.video_id, r.start, r.end).map((t) => ({ time: t.time, caption: t.caption, ocrText: t.ocrText }));
    list.push({ videoId: r.video_id, projectId: r.project_id, start: r.start, end: r.end, reason: r.reason ?? undefined, visualTags });
    segsByClip.set(r.clip_id, list);
  }
  const tagsByClip = new Map<string, string[]>();
  for (const r of tagRows ?? []) {
    const list = tagsByClip.get(r.clip_id) ?? [];
    list.push(r.tag);
    tagsByClip.set(r.clip_id, list);
  }

  return clips.map((c) => ({ ...c, segments: segsByClip.get(c.id) ?? [], tags: tagsByClip.get(c.id) ?? [] }));
}

export async function listClips(db: D1Database, filter: ClipFilter = {}): Promise<ClipDetail[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.kind) { where.push("c.kind = ?"); params.push(filter.kind); }
  if (filter.q) {
    // Matches what's SAID (title/description) or what's SHOWN (visual tags on
    // any segment's time range) — the whole point of tagging what's on screen
    // is that it's findable the same way as everything else.
    where.push(
      `(c.title LIKE ? OR c.description LIKE ? OR EXISTS (
         SELECT 1 FROM clip_segments s JOIN visual_tags v
           ON v.video_id = s.video_id AND v."time" >= s."start" AND v."time" <= s."end"
         WHERE s.clip_id = c.id AND (v.caption LIKE ? OR v.ocr_text LIKE ?)
       ))`,
    );
    params.push(`%${filter.q}%`, `%${filter.q}%`, `%${filter.q}%`, `%${filter.q}%`);
  }
  if (filter.tag) {
    where.push("EXISTS (SELECT 1 FROM clip_tags t WHERE t.clip_id = c.id AND t.tag = ?)");
    params.push(normalizeTag(filter.tag));
  }
  if (filter.projectId) {
    where.push("EXISTS (SELECT 1 FROM clip_segments s WHERE s.clip_id = c.id AND s.project_id = ?)");
    params.push(filter.projectId);
  }
  if (filter.videoId) {
    where.push("EXISTS (SELECT 1 FROM clip_segments s WHERE s.clip_id = c.id AND s.video_id = ?)");
    params.push(filter.videoId);
  }
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  const offset = Math.max(filter.offset ?? 0, 0);

  const sql = `SELECT id, title, description, kind, created_at FROM clips c
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  const { results } = await db.prepare(sql).bind(...params, limit, offset).all<Clip>();
  return attachSegmentsAndTags(db, results ?? []);
}

export async function getClip(db: D1Database, id: string): Promise<ClipDetail | null> {
  const clip = await db
    .prepare(`SELECT id, title, description, kind, created_at FROM clips WHERE id = ?`)
    .bind(id)
    .first<Clip>();
  if (!clip) return null;
  const [detail] = await attachSegmentsAndTags(db, [clip]);
  return detail;
}

export async function updateClip(
  db: D1Database,
  id: string,
  patch: { title?: string; description?: string | null; tags?: string[] },
): Promise<ClipDetail | null> {
  const existing = await db.prepare(`SELECT id FROM clips WHERE id = ?`).bind(id).first<{ id: string }>();
  if (!existing) return null;

  const statements = [];
  if (patch.title !== undefined || patch.description !== undefined) {
    const fields: string[] = [];
    const params: unknown[] = [];
    if (patch.title !== undefined) { fields.push("title = ?"); params.push(patch.title); }
    if (patch.description !== undefined) { fields.push("description = ?"); params.push(patch.description); }
    statements.push(db.prepare(`UPDATE clips SET ${fields.join(", ")} WHERE id = ?`).bind(...params, id));
  }
  if (patch.tags !== undefined) {
    const tags = [...new Set(patch.tags.map(normalizeTag).filter(Boolean))];
    statements.push(db.prepare(`DELETE FROM clip_tags WHERE clip_id = ?`).bind(id));
    for (const tag of tags) statements.push(db.prepare(`INSERT INTO clip_tags (clip_id, tag) VALUES (?, ?)`).bind(id, tag));
  }
  if (statements.length) await db.batch(statements);
  return getClip(db, id);
}

export async function deleteClip(db: D1Database, id: string): Promise<void> {
  await db.batch([
    db.prepare(`DELETE FROM clip_tags WHERE clip_id = ?`).bind(id),
    db.prepare(`DELETE FROM clip_segments WHERE clip_id = ?`).bind(id),
    db.prepare(`DELETE FROM clips WHERE id = ?`).bind(id),
  ]);
}

/** A short "what's on screen" summary for a clip, built from its segments'
 *  visual tags — for folding into an AI prompt's clip menu (composeFromClips,
 *  suggestReactionClip). undefined when nothing's been visually tagged yet. */
export function visualSummaryOf(clip: ClipDetail): string | undefined {
  const captions = [...new Set(clip.segments.flatMap((s) => s.visualTags.map((t) => t.caption).filter((x): x is string => !!x)))];
  return captions.length ? captions.slice(0, 2).join("; ") : undefined;
}

export async function listAllTags(db: D1Database): Promise<{ tag: string; count: number }[]> {
  const { results } = await db
    .prepare(`SELECT tag, COUNT(*) as count FROM clip_tags GROUP BY tag ORDER BY count DESC, tag ASC`)
    .all<{ tag: string; count: number }>();
  return results ?? [];
}
