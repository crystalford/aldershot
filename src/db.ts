/**
 * D1 access for projects + videos — the first persistent state in Aldershot.
 * Transcripts, timelines, and shorts live as JSON in R2 (see src/keys.ts);
 * D1 holds the lightweight records that tie a project's videos together.
 */
import type { Env } from "./env";

export interface Project {
  id: string;
  name: string;
  created_at: number;
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
}

export async function createProject(db: D1Database, name: string): Promise<Project> {
  const project: Project = { id: crypto.randomUUID(), name, created_at: Date.now() };
  await db
    .prepare(`INSERT INTO projects (id, name, created_at) VALUES (?, ?, ?)`)
    .bind(project.id, project.name, project.created_at)
    .run();
  return project;
}

export async function listProjects(db: D1Database): Promise<Project[]> {
  const { results } = await db
    .prepare(`SELECT id, name, created_at FROM projects ORDER BY created_at DESC`)
    .all<Project>();
  return results ?? [];
}

export async function getProject(db: D1Database, id: string): Promise<Project | null> {
  return db.prepare(`SELECT id, name, created_at FROM projects WHERE id = ?`).bind(id).first<Project>();
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
 *  discovery pass (unlike listVideos, not scoped to a single project_id). */
export async function listAllReadyVideos(db: D1Database): Promise<Video[]> {
  const { results } = await db
    .prepare(
      `SELECT id, project_id, filename, r2_key, duration, status, ord, created_at
       FROM videos WHERE status = 'ready' ORDER BY created_at ASC`,
    )
    .all<Video>();
  return results ?? [];
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
