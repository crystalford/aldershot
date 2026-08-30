/**
 * Projects and beats.
 *
 * "Ordered blocks. THE EDIT IS THIS TABLE — there is no timeline object."
 * (03-DATA-MODEL.md). That is the whole architecture of the editor: the edit is
 * data, so a render is a pure function of it and can always be re-run, and
 * "no timeline" is true in the database as well as in the UI.
 */

import { ulid } from "./id.ts";
import type { ScoredClip } from "./grounding.ts";

export type ProjectKind = "cut" | "reaction" | "essay" | "idea";
export type BeatKind = "clip" | "vo" | "react" | "generated" | "stock";

export interface Project {
  id: string;
  user_id: string;
  title: string;
  kind: ProjectKind;
  source_id: string | null;
  brief: string | null;
  has_acts: number;
  runtime_s: number | null;
  pct: number;
  next_action: string | null;
  poster_r2_key: string | null;
  archived_at: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  /** Script mode's transcript cuts, as JSON. See src/cuts.ts. */
  cuts: string | null;
}

export interface Beat {
  id: string;
  project_id: string;
  idx: number;
  kind: BeatKind;
  act: string | null;
  clip_id: string | null;
  text: string | null;
  struck: string | null;
  dur_ms: number | null;
  media_r2_key: string | null;
  recorded_at: number | null;
}

export interface Clip {
  id: string;
  user_id: string;
  source_id: string;
  start_ms: number;
  end_ms: number;
  quote: string;
  why: string | null;
  score: number | null;
  heat: number | null;
  frame_r2_key: string;
  kept: number;
  origin: string;
  used_count: number;
  created_at: number;
  deleted_at: number | null;
}

/**
 * The project title. Uses the user's own sentence, because that is what they
 * will recognise it by — the prototype titles a project with the brief, not
 * with a generated name.
 */
export function titleFromBrief(brief: string, fallback: string): string {
  const t = brief.trim().replace(/\s+/g, " ");
  if (!t) return fallback;
  return t.length > 72 ? t.slice(0, 71).trimEnd() + "…" : t;
}

export async function createProject(
  db: D1Database,
  opts: { user_id: string; title: string; kind: ProjectKind; source_id?: string | null; brief?: string | null },
): Promise<Project> {
  const now = Date.now();
  const p: Project = {
    id: ulid(),
    user_id: opts.user_id,
    title: opts.title,
    kind: opts.kind,
    source_id: opts.source_id ?? null,
    brief: opts.brief ?? null,
    has_acts: opts.kind === "essay" ? 1 : 0,
    runtime_s: null,
    pct: 0,
    next_action: null,
    poster_r2_key: null,
    archived_at: null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    cuts: null,
  };
  await db
    .prepare(
      `INSERT INTO v2_projects (id,user_id,title,kind,source_id,brief,has_acts,runtime_s,pct,next_action,poster_r2_key,archived_at,created_at,updated_at,deleted_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      p.id, p.user_id, p.title, p.kind, p.source_id, p.brief, p.has_acts, p.runtime_s,
      p.pct, p.next_action, p.poster_r2_key, p.archived_at, p.created_at, p.updated_at, p.deleted_at,
    )
    .run();
  return p;
}

export async function getProject(db: D1Database, id: string, userId: string): Promise<Project | null> {
  return await db
    .prepare(`SELECT * FROM v2_projects WHERE id=? AND user_id=? AND deleted_at IS NULL`)
    .bind(id, userId)
    .first<Project>();
}

export async function listProjects(db: D1Database, userId: string): Promise<Project[]> {
  const { results } = await db
    .prepare(`SELECT * FROM v2_projects WHERE user_id=? AND deleted_at IS NULL ORDER BY updated_at DESC`)
    .bind(userId)
    .all<Project>();
  return results ?? [];
}

/**
 * Saves scored clips.
 *
 * They start KEPT. The prototype's own rule is `cutOn[i] !== false` — a block
 * is in the cut unless the user has said otherwise. That is the whole claim:
 * the pass produces a watchable cut and the user adjusts it. Starting
 * everything dropped would mean clicking every block in an hour of footage
 * before seeing anything, which is the opposite of the product.
 *
 * Every clip also carries the frame that proves it is real — the design allows
 * no thumbnail that is not an actual frame.
 */
export async function saveClips(
  db: D1Database,
  opts: { user_id: string; source_id: string; origin: "editor" | "clipping" | "manual"; posterKey: string | null },
  clips: ScoredClip[],
): Promise<Clip[]> {
  if (!clips.length) return [];

  // Don't re-save a moment we already have.
  //
  // Running a second pass over the same source finds much of the same
  // material, and appending blindly fills the library with near-identical
  // duplicates — which is what happened during testing. Overlap is judged by
  // range rather than by text, because the model rarely returns byte-identical
  // boundaries twice.
  const existing = await listClipsForSource(db, opts.source_id, opts.user_id);
  const fresh = clips.filter((c) => !existing.some((e) => overlapFraction(c, e) > 0.8));
  if (!fresh.length) return [];

  const now = Date.now();
  const rows: Clip[] = fresh.map((c) => ({
    id: ulid(),
    user_id: opts.user_id,
    source_id: opts.source_id,
    start_ms: c.start_ms,
    end_ms: c.end_ms,
    quote: c.quote,
    why: c.why || null,
    score: c.score,
    heat: c.heat,
    // Until per-clip frames are extracted (one every 5s, in the container),
    // a clip points at the source's own poster. A real frame of the real
    // video — just not yet the frame at this exact moment.
    frame_r2_key: opts.posterKey ?? "",
    kept: 1,
    origin: opts.origin,
    used_count: 0,
    created_at: now,
    deleted_at: null,
  }));

  const stmt = db.prepare(
    `INSERT INTO v2_clips (id,user_id,source_id,start_ms,end_ms,quote,why,score,heat,frame_r2_key,kept,origin,used_count,created_at,deleted_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  await db.batch(
    rows.map((r) =>
      stmt.bind(
        r.id, r.user_id, r.source_id, r.start_ms, r.end_ms, r.quote, r.why, r.score, r.heat,
        r.frame_r2_key, r.kept, r.origin, r.used_count, r.created_at, r.deleted_at,
      ),
    ),
  );
  return rows;
}

/**
 * How much two ranges cover the same footage, 0-1, relative to the smaller of
 * the two. Using the smaller means a short clip fully inside a longer one
 * counts as a duplicate, which is the case that matters.
 */
export function overlapFraction(
  a: { start_ms: number; end_ms: number },
  b: { start_ms: number; end_ms: number },
): number {
  const overlap = Math.min(a.end_ms, b.end_ms) - Math.max(a.start_ms, b.start_ms);
  if (overlap <= 0) return 0;
  const smaller = Math.min(a.end_ms - a.start_ms, b.end_ms - b.start_ms);
  return smaller > 0 ? overlap / smaller : 0;
}

export async function listClipsForSource(db: D1Database, sourceId: string, userId: string): Promise<Clip[]> {
  const { results } = await db
    .prepare(`SELECT * FROM v2_clips WHERE source_id=? AND user_id=? AND deleted_at IS NULL ORDER BY start_ms`)
    .bind(sourceId, userId)
    .all<Clip>();
  return results ?? [];
}

/** Keep or drop a clip. Undoable — nothing here is destructive. */
export async function setKept(db: D1Database, clipId: string, userId: string, kept: boolean): Promise<void> {
  await db
    .prepare(`UPDATE v2_clips SET kept=? WHERE id=? AND user_id=?`)
    .bind(kept ? 1 : 0, clipId, userId)
    .run();
}

/**
 * Replaces a project's beats wholesale. Idempotent by design
 * (04-API-AND-JOBS.md: "whole-array write") — the client owns the order and
 * sends the whole list, so a dropped request cannot leave a half-reordered
 * edit behind.
 */
export async function putBeats(db: D1Database, projectId: string, beats: Omit<Beat, "id" | "project_id">[]): Promise<void> {
  await db.prepare(`DELETE FROM beats WHERE project_id=?`).bind(projectId).run();
  if (!beats.length) return;
  const stmt = db.prepare(
    `INSERT INTO beats (id,project_id,idx,kind,act,clip_id,text,struck,dur_ms,media_r2_key,recorded_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  );
  await db.batch(
    beats.map((b, i) =>
      stmt.bind(
        ulid(), projectId, i, b.kind, b.act ?? null, b.clip_id ?? null, b.text ?? null,
        b.struck ?? null, b.dur_ms ?? null, b.media_r2_key ?? null, b.recorded_at ?? null,
      ),
    ),
  );
  await db.prepare(`UPDATE v2_projects SET updated_at=? WHERE id=?`).bind(Date.now(), projectId).run();
}

/** Saves Script mode's cuts. Autosaved on every edit — there is no Save button. */
export async function saveCuts(db: D1Database, projectId: string, userId: string, cutsJson: string): Promise<void> {
  await db
    .prepare(`UPDATE v2_projects SET cuts=?, updated_at=? WHERE id=? AND user_id=?`)
    .bind(cutsJson, Date.now(), projectId, userId)
    .run();
}

export async function getBeats(db: D1Database, projectId: string): Promise<Beat[]> {
  const { results } = await db
    .prepare(`SELECT * FROM beats WHERE project_id=? ORDER BY idx`)
    .bind(projectId)
    .all<Beat>();
  return results ?? [];
}
