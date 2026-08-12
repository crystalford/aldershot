/**
 * D1 access for projects + videos — the first persistent state in Aldershot.
 * Transcripts, timelines, and shorts live as JSON in R2 (see src/keys.ts);
 * D1 holds the lightweight records that tie a project's videos together.
 */
import type { Env } from "./env";

export type ProjectKind = "source" | "generative" | "clipping" | "voiceover" | "studio";

export interface Project {
  id: string;
  name: string;
  kind: ProjectKind;
  created_at: number;
  deleted_at: number | null;
}

export interface ProjectWithThumb extends Project {
  thumb_r2_key: string | null;
  thumb_duration: number | null;
}

export type VideoStatus = "uploaded" | "transcribing" | "ready" | "failed";

export interface Video {
  id: string;
  project_id: string;
  filename: string;
  r2_key: string;
  duration: number | null;
  status: VideoStatus;
  ord: number;
  created_at: number;
}

/** Create tables if absent. Idempotent — safe to call on every request so the
 *  app works in local dev without a separate `d1 migrations apply` step. */
export async function ensureSchema(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS projects (
         id TEXT PRIMARY KEY,
         name TEXT NOT NULL,
         kind TEXT NOT NULL DEFAULT 'source',
         created_at INTEGER NOT NULL
       )`,
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS videos (
         id TEXT PRIMARY KEY,
         project_id TEXT NOT NULL,
         filename TEXT NOT NULL,
         r2_key TEXT NOT NULL,
         duration REAL,
         status TEXT NOT NULL DEFAULT 'uploaded',
         ord INTEGER NOT NULL DEFAULT 0,
         created_at INTEGER NOT NULL
       )`,
    ),
  ]);
  // `kind` is new — a table created before this column existed needs it added
  // on. SQLite has no `ADD COLUMN IF NOT EXISTS`, so check first.
  const cols = await db.prepare(`PRAGMA table_info(projects)`).all<{ name: string }>();
  const colNames = new Set((cols.results ?? []).map((c) => c.name));
  if (!colNames.has("kind")) {
    await db.prepare(`ALTER TABLE projects ADD COLUMN kind TEXT NOT NULL DEFAULT 'source'`).run();
  }
  // deleted_at backs Trash — see softDeleteProject/restoreProject below.
  if (!colNames.has("deleted_at")) {
    await db.prepare(`ALTER TABLE projects ADD COLUMN deleted_at INTEGER`).run();
  }
}

export async function createProject(db: D1Database, name: string, kind: ProjectKind = "source"): Promise<Project> {
  const project: Project = { id: crypto.randomUUID(), name, kind, created_at: Date.now(), deleted_at: null };
  await db
    .prepare(`INSERT INTO projects (id, name, kind, created_at) VALUES (?, ?, ?, ?)`)
    .bind(project.id, project.name, project.kind, project.created_at)
    .run();
  return project;
}

/** The single scratch project that owns every video registered by the
 *  Generative feature (a generated b-roll clip still needs a real `videos`
 *  row to become a real Archive clip — see src/generative.ts) — created
 *  lazily on first use, reused after that. Filtered out of the Sources grid
 *  (see listProjects) so it never shows up as a confusing empty "project"
 *  a user would try to open. */
export async function getOrCreateGenerativeProject(db: D1Database): Promise<Project> {
  const existing = await db.prepare(`SELECT id, name, kind, created_at, deleted_at FROM projects WHERE kind = 'generative' LIMIT 1`).first<Project>();
  if (existing) return existing;
  return createProject(db, "Generative", "generative");
}

/** The single scratch project that owns every video dropped into the
 *  focused Clipping page — same idea as getOrCreateGenerativeProject.
 *  Filtered out of the Sources grid (see listProjects) since it's reached
 *  through its own dedicated surface, not opened like a normal project. */
export async function getOrCreateClippingProject(db: D1Database): Promise<Project> {
  const existing = await db.prepare(`SELECT id, name, kind, created_at, deleted_at FROM projects WHERE kind = 'clipping' LIMIT 1`).first<Project>();
  if (existing) return existing;
  return createProject(db, "Clipping", "clipping");
}

/** The single scratch project that owns every recorded essay voiceover take
 *  — same idea as getOrCreateGenerativeProject/getOrCreateClippingProject.
 *  A vo beat's recording needs a real videos row (upload -> transcribe,
 *  same pipeline as any clip) to reuse, and Essays aren't scoped to any one
 *  project the way Sources are. Filtered out of the Sources grid (see
 *  listProjects) for the same reason the other scratch projects are. */
export async function getOrCreateVoiceoverProject(db: D1Database): Promise<Project> {
  const existing = await db.prepare(`SELECT id, name, kind, created_at, deleted_at FROM projects WHERE kind = 'voiceover' LIMIT 1`).first<Project>();
  if (existing) return existing;
  return createProject(db, "Voiceover", "voiceover");
}

/** The single scratch project Studio's raw, not-yet-themed takes live in —
 *  same idea as the other getOrCreate*Project functions. Deliberately
 *  separate from Sources: a stray screen recording isn't part of a themed
 *  archive the way a podcast-episode upload is (see the design brief).
 *  Filtered out of the Sources grid for the same reason. */
export async function getOrCreateStudioProject(db: D1Database): Promise<Project> {
  const existing = await db.prepare(`SELECT id, name, kind, created_at, deleted_at FROM projects WHERE kind = 'studio' LIMIT 1`).first<Project>();
  if (existing) return existing;
  return createProject(db, "Studio", "studio");
}

/** Each project's card needs a real frame, not just a name — so this joins
 *  in the earliest-added video's r2_key/duration (whichever video would
 *  show first in that project's own list) for the client to grab a thumbnail
 *  from client-side (see public/thumb.js), same as every other thumbnail in
 *  the app. No video yet → both fields are null and the card shows a
 *  placeholder. */
export async function listProjects(db: D1Database): Promise<ProjectWithThumb[]> {
  const { results } = await db
    .prepare(
      `SELECT p.id, p.name, p.kind, p.created_at, p.deleted_at,
              v.r2_key AS thumb_r2_key, v.duration AS thumb_duration
       FROM projects p
       LEFT JOIN videos v ON v.id = (
         SELECT id FROM videos WHERE project_id = p.id ORDER BY ord ASC, created_at ASC LIMIT 1
       )
       WHERE p.kind = 'source' AND p.deleted_at IS NULL
       ORDER BY p.created_at DESC`,
    )
    .all<ProjectWithThumb>();
  return results ?? [];
}

/** Trash — soft-deleted source projects, newest-removed first. Scoped to
 *  kind='source' same as listProjects: the scratch projects (generative/
 *  clipping/voiceover/studio) are never user-deletable, so they never end
 *  up here. See softDeleteProject/restoreProject below. */
export async function listTrashedProjects(db: D1Database): Promise<ProjectWithThumb[]> {
  const { results } = await db
    .prepare(
      `SELECT p.id, p.name, p.kind, p.created_at, p.deleted_at,
              v.r2_key AS thumb_r2_key, v.duration AS thumb_duration
       FROM projects p
       LEFT JOIN videos v ON v.id = (
         SELECT id FROM videos WHERE project_id = p.id ORDER BY ord ASC, created_at ASC LIMIT 1
       )
       WHERE p.kind = 'source' AND p.deleted_at IS NOT NULL
       ORDER BY p.deleted_at DESC`,
    )
    .all<ProjectWithThumb>();
  return results ?? [];
}

export async function softDeleteProject(db: D1Database, id: string): Promise<void> {
  await db.prepare(`UPDATE projects SET deleted_at = ? WHERE id = ?`).bind(Date.now(), id).run();
}

export async function restoreProject(db: D1Database, id: string): Promise<void> {
  await db.prepare(`UPDATE projects SET deleted_at = NULL WHERE id = ?`).bind(id).run();
}

/** Irreversible — only ever called from Trash, never from the Sources grid's
 *  own delete action (that's softDeleteProject). Videos/timeline/shorts JSON
 *  in R2 are deliberately left behind, same "don't bother reclaiming" call
 *  version history and enhanced-audio remuxes already make elsewhere. */
export async function permanentlyDeleteProject(db: D1Database, id: string): Promise<void> {
  await db.batch([
    db.prepare(`DELETE FROM videos WHERE project_id = ?`).bind(id),
    db.prepare(`DELETE FROM projects WHERE id = ?`).bind(id),
  ]);
}

export async function getProject(db: D1Database, id: string): Promise<Project | null> {
  return db.prepare(`SELECT id, name, kind, created_at, deleted_at FROM projects WHERE id = ?`).bind(id).first<Project>();
}

export interface PickableVideo {
  id: string;
  filename: string;
  duration: number | null;
  project_name: string;
  project_kind: ProjectKind;
}

/** Every ready video that isn't already a Clipping-owned recording — feeds
 *  Clipping's "pick a video already in Aldershot" intake path (see
 *  POST /api/clipping/import-video), same "already transcribed, just point
 *  at it" idea as a Library clip referencing a foreign project's video. */
export async function listPickableVideos(db: D1Database): Promise<PickableVideo[]> {
  const { results } = await db
    .prepare(
      `SELECT v.id, v.filename, v.duration, p.name AS project_name, p.kind AS project_kind
       FROM videos v
       JOIN projects p ON p.id = v.project_id
       WHERE v.status = 'ready' AND p.deleted_at IS NULL AND p.kind IN ('source', 'studio')
       ORDER BY v.created_at DESC`,
    )
    .all<PickableVideo>();
  return results ?? [];
}

export async function addVideo(
  db: D1Database,
  v: Omit<Video, "created_at" | "duration" | "status"> & { duration?: number | null; status?: VideoStatus },
): Promise<Video> {
  const video: Video = {
    duration: null,
    status: "uploaded",
    ...v,
    created_at: Date.now(),
  };
  await db
    .prepare(
      `INSERT INTO videos (id, project_id, filename, r2_key, duration, status, ord, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      video.id,
      video.project_id,
      video.filename,
      video.r2_key,
      video.duration,
      video.status,
      video.ord,
      video.created_at,
    )
    .run();
  return video;
}

export async function listVideos(db: D1Database, projectId: string): Promise<Video[]> {
  const { results } = await db
    .prepare(
      `SELECT id, project_id, filename, r2_key, duration, status, ord, created_at
       FROM videos WHERE project_id = ? ORDER BY ord ASC, created_at ASC`,
    )
    .bind(projectId)
    .all<Video>();
  return results ?? [];
}

/** Every ready video across every project — feeds the account-wide clip
 *  discovery pass (unlike listVideos, not scoped to a single project_id).
 *  Excludes videos whose project is in Trash — deleting a source is
 *  supposed to actually pull it out of active discovery, not just hide its
 *  card, even though the row itself sticks around for restore. */
export async function listAllReadyVideos(db: D1Database): Promise<Video[]> {
  const { results } = await db
    .prepare(
      `SELECT v.id, v.project_id, v.filename, v.r2_key, v.duration, v.status, v.ord, v.created_at
       FROM videos v
       JOIN projects p ON p.id = v.project_id
       WHERE v.status = 'ready' AND p.deleted_at IS NULL
       ORDER BY v.created_at ASC`,
    )
    .all<Video>();
  return results ?? [];
}

/** How many Source videos are still uploading/transcribing right now —
 *  feeds the Desk's "sources processing" stat. */
export async function countProcessingSourceVideos(db: D1Database): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM videos v JOIN projects p ON p.id = v.project_id
       WHERE p.kind = 'source' AND p.deleted_at IS NULL AND v.status IN ('uploading', 'transcribing')`,
    )
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** The most recently finished Source video — there's no separate
 *  "completed_at" column, so created_at is the closest honest proxy (this
 *  app's upload→transcribe pipeline runs promptly, not queued for days).
 *  Feeds the Desk's "since you were last here" digest. */
export async function getMostRecentReadySourceVideo(db: D1Database): Promise<(Video & { project_id: string }) | null> {
  return db
    .prepare(
      `SELECT v.id, v.project_id, v.filename, v.r2_key, v.duration, v.status, v.ord, v.created_at
       FROM videos v JOIN projects p ON p.id = v.project_id
       WHERE p.kind = 'source' AND p.deleted_at IS NULL AND v.status = 'ready'
       ORDER BY v.created_at DESC LIMIT 1`,
    )
    .first();
}

export async function getVideo(db: D1Database, id: string): Promise<Video | null> {
  return db
    .prepare(
      `SELECT id, project_id, filename, r2_key, duration, status, ord, created_at FROM videos WHERE id = ?`,
    )
    .bind(id)
    .first<Video>();
}

export async function setVideoStatus(db: D1Database, id: string, status: VideoStatus): Promise<void> {
  await db.prepare(`UPDATE videos SET status = ? WHERE id = ?`).bind(status, id).run();
}

/** Repoints a video at a different R2 object — used by "Apply enhanced
 *  audio" to make the enhanced remux the video's active source. The
 *  previous object is deliberately left in R2 (not deleted): duration/
 *  transcript timestamps stay valid (the enhance pass preserves length to
 *  the millisecond), so nothing else about the video record needs to change. */
export async function setVideoR2Key(db: D1Database, id: string, r2Key: string): Promise<void> {
  await db.prepare(`UPDATE videos SET r2_key = ? WHERE id = ?`).bind(r2Key, id).run();
}
