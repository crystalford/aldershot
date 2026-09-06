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
  /** The arrangement: block ids in sequence. Null means never rearranged. */
  block_order: string | null;
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
    block_order: null,
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

/**
 * The titles that mean "nobody named this".
 *
 * Three of them, because naming has had three eras and rows from all three are
 * in the database: the original placeholder, the footage's filename, and now
 * the name worked out from the transcript (src/naming.ts).
 *
 * This has to be ONE definition. When it was written inline, adding the
 * auto-name would have made `TOUCHED` read every auto-named cut as "the user
 * renamed it" — so every video you merely opened would reappear in Projects,
 * which is the exact complaint that made untouched edits stop listing.
 */
const UNNAMED = `(
  title = 'Untitled cut'
  OR title = (SELECT s.title FROM sources s WHERE s.id = v2_projects.source_id)
  OR title = (SELECT s.cut_title FROM sources s WHERE s.id = v2_projects.source_id)
)`;

/**
 * Collapses duplicate untouched edits of one video.
 *
 * The owner's Editor showed four rows reading "Untitled cut · DJI_2026….MP4"
 * because every press of Edit made another project. begin() stopped doing that,
 * but the rows it already made are still there and still indistinguishable, so
 * they have to be cleared rather than merely not repeated.
 *
 * The rule is deliberately timid: an edit is only collapsed when it is an
 * unbriefed cut of the same source as a newer one AND it holds no work of its
 * own — no cuts, no beats, no renders, no title anyone typed. Anything the
 * user has touched survives, even if it looks like a duplicate, because
 * "looks like a duplicate" is not a good enough reason to delete somebody's
 * edit. It is a soft delete, so nothing is actually gone.
 */
export async function reapDuplicateEdits(db: D1Database, userId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE v2_projects SET deleted_at=?
        WHERE user_id=? AND deleted_at IS NULL
          AND (brief IS NULL OR TRIM(brief)='')
          AND (cuts IS NULL OR cuts='' OR cuts='[]')
          AND ${UNNAMED}
          AND source_id IS NOT NULL
          AND id NOT IN (SELECT project_id FROM beats WHERE project_id IS NOT NULL)
          AND id NOT IN (SELECT project_id FROM renders WHERE project_id IS NOT NULL)
          AND EXISTS (
            SELECT 1 FROM v2_projects newer
             WHERE newer.user_id = v2_projects.user_id
               AND newer.source_id = v2_projects.source_id
               AND newer.deleted_at IS NULL
               AND newer.kind = v2_projects.kind
               AND (newer.brief IS NULL OR TRIM(newer.brief)='')
               AND (newer.updated_at > v2_projects.updated_at
                    OR (newer.updated_at = v2_projects.updated_at AND newer.id > v2_projects.id))
          )`,
    )
    .bind(Date.now(), userId)
    .run();
}

/**
 * Names the edits that were created before edits got named.
 *
 * begin() titles an unbriefed edit after its footage now, but the rows already
 * in the database kept the old placeholder — so an account that had been used
 * for a while showed a list of "Untitled cut" that no amount of new behaviour
 * would fix. Only rows still carrying the exact placeholder are touched, so a
 * title anybody typed is never overwritten.
 */
export async function nameUntitledEdits(db: D1Database, userId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE v2_projects SET title = COALESCE(
          (SELECT s.cut_title FROM sources s WHERE s.id = v2_projects.source_id),
          (SELECT s.title FROM sources s WHERE s.id = v2_projects.source_id),
          title)
        WHERE user_id=? AND deleted_at IS NULL AND title='Untitled cut' AND source_id IS NOT NULL`,
    )
    .bind(userId)
    .run();
}

/**
 * Has anything actually been DONE to this edit?
 *
 * Opening a video creates a project, because the editor edits a project and
 * something has to hold the cuts. That is an implementation detail, and it was
 * leaking: every video you so much as looked at appeared in "Pick up an edit"
 * and in Projects, so browsing your own library filled it with edits you never
 * made. The owner's words — "it still immediately makes an edit when I click
 * on one of the footages."
 *
 * The row still gets created. It just is not an EDIT until there is an edit in
 * it: a brief you asked for, a cut you made, a beat, a render, or a name you
 * typed. Renaming counts, which is why the title is compared against the
 * source's — an untouched one is named after its footage.
 *
 * A project with no source was made deliberately from the composer and is
 * always real.
 *
 * "A name you typed" is any title that is not one the product chose — see
 * UNNAMED. The auto-name is one the product chose.
 */
const TOUCHED = `(
  v2_projects.source_id IS NULL
  OR (brief IS NOT NULL AND TRIM(brief) <> '')
  OR (cuts IS NOT NULL AND cuts <> '' AND cuts <> '[]')
  OR NOT ${UNNAMED}
  OR EXISTS (SELECT 1 FROM beats b WHERE b.project_id = v2_projects.id)
  OR EXISTS (SELECT 1 FROM renders r WHERE r.project_id = v2_projects.id)
)`;

/**
 * The edits worth listing.
 *
 * Deliberately NOT how a single project is loaded — getProject has no such
 * filter, so an untouched edit still opens perfectly from its own URL. It is
 * only absent from lists, which is the difference between "not made yet" and
 * "does not exist".
 */
export async function listProjects(db: D1Database, userId: string): Promise<Project[]> {
  await reapDuplicateEdits(db, userId);
  await nameUntitledEdits(db, userId);
  const { results } = await db
    .prepare(
      `SELECT * FROM v2_projects
        WHERE user_id=? AND deleted_at IS NULL AND ${TOUCHED}
        ORDER BY updated_at DESC`,
    )
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

/**
 * The shorts — moments that have been made into a vertical video, or asked to
 * be.
 *
 * Defined by what has HAPPENED to a moment, not by which surface created it.
 * It used to be `origin='clipping'`, which meant Footage counted thirteen
 * moments while Clipping counted two, and the two numbers had no relationship
 * a person could see. The owner: "when i click on clips shows 16 clips / then
 * i go to clipping shows 2 clips".
 *
 * Now Clipping is a subset of the library rather than a rival to it: every
 * moment lives in Footage, and the ones you have turned into shorts also show
 * up here. A moment clipped from the editor and one found by a batch are the
 * same thing and finally look it.
 */
export async function listShorts(db: D1Database, userId: string, limit = 60): Promise<Clip[]> {
  const { results } = await db
    .prepare(
      `SELECT c.* FROM v2_clips c
        WHERE c.user_id=? AND c.deleted_at IS NULL
          AND (c.origin='clipping'
               OR EXISTS (SELECT 1 FROM renders r WHERE r.clip_id = c.id AND r.kind='short'))
        ORDER BY c.created_at DESC LIMIT ?`,
    )
    .bind(userId, limit)
    .all<Clip>();
  return results ?? [];
}

export async function listClipsForSource(db: D1Database, sourceId: string, userId: string): Promise<Clip[]> {
  const { results } = await db
    .prepare(`SELECT * FROM v2_clips WHERE source_id=? AND user_id=? AND deleted_at IS NULL ORDER BY start_ms`)
    .bind(sourceId, userId)
    .all<Clip>();
  return results ?? [];
}

/**
 * Material you can build with — everything except finished shorts.
 *
 * A short is an OUTPUT: a 9:16 export of one block, made from the cut. Offering
 * it back as something to put INTO a cut is circular, and it is how Clipping's
 * rows ended up mixed into the editor's clip picker.
 *
 * The filter lives here rather than at each call site because the call sites
 * kept forgetting it.
 */
export async function cutClips(db: D1Database, sourceId: string, userId: string): Promise<Clip[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM v2_clips
        WHERE source_id=? AND user_id=? AND deleted_at IS NULL AND origin <> 'clipping'
        ORDER BY start_ms`,
    )
    .bind(sourceId, userId)
    .all<Clip>();
  return results ?? [];
}

/**
 * Keep or drop a clip. Undoable — nothing here is destructive.
 *
 * `kept` means ONE thing: I want this moment. That is what Footage's Clips
 * shelf lists and what Clipping's toggle sets.
 *
 * It used to also decide an edit's runtime and its "N clips kept" line, so
 * keeping a Clipping short silently edited your cut. It does not any more: a
 * cut is its blocks — ranges and order, see src/blocks.ts — and every surface
 * that reports on one now asks blocks rather than clips.
 */
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
export async function putBeats(
  db: D1Database,
  projectId: string,
  beats: Array<Partial<Pick<Beat, "id">> & Omit<Beat, "id" | "project_id" | "idx">>,
): Promise<void> {
  await db.prepare(`DELETE FROM beats WHERE project_id=?`).bind(projectId).run();
  if (!beats.length) return;
  const stmt = db.prepare(
    `INSERT INTO beats (id,project_id,idx,kind,act,clip_id,text,struck,dur_ms,media_r2_key,recorded_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  );
  await db.batch(
    beats.map((b, i) =>
      stmt.bind(
        // Keep the id when the caller has one. Reordering must not mint new
        // ids: a recorded take is attached to a beat BY id, so re-keying on
        // every move would orphan the audio the user just recorded.
        b.id || ulid(), projectId, i, b.kind, b.act ?? null, b.clip_id ?? null, b.text ?? null,
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

/** Inserts one beat at a position, pushing everything after it along. */
export async function insertBeat(
  db: D1Database,
  projectId: string,
  atIdx: number,
  beat: { kind: BeatKind; act?: string | null; text?: string | null; clip_id?: string | null; dur_ms?: number | null },
): Promise<Beat[]> {
  const beats = await getBeats(db, projectId);
  const next = [...beats];
  next.splice(Math.max(0, Math.min(atIdx, next.length)), 0, {
    id: "",
    project_id: projectId,
    idx: 0,
    kind: beat.kind,
    act: beat.act ?? null,
    clip_id: beat.clip_id ?? null,
    text: beat.text ?? null,
    struck: null,
    dur_ms: beat.dur_ms ?? null,
    media_r2_key: null,
    recorded_at: null,
  });
  await putBeats(db, projectId, next);
  return getBeats(db, projectId);
}

/** Moves a beat one place. Returns the new order. */
export async function moveBeat(db: D1Database, projectId: string, beatId: string, dir: -1 | 1): Promise<Beat[]> {
  const beats = await getBeats(db, projectId);
  const from = beats.findIndex((b) => b.id === beatId);
  const to = from + dir;
  if (from < 0 || to < 0 || to >= beats.length) return beats;
  const next = [...beats];
  [next[from], next[to]] = [next[to], next[from]];
  await putBeats(db, projectId, next);
  return getBeats(db, projectId);
}

export async function deleteBeat(db: D1Database, projectId: string, beatId: string): Promise<Beat[]> {
  const beats = await getBeats(db, projectId);
  await putBeats(db, projectId, beats.filter((b) => b.id !== beatId));
  return getBeats(db, projectId);
}

/** Attaches a recorded take to a beat. */
export async function setBeatMedia(db: D1Database, beatId: string, key: string, durMs: number): Promise<void> {
  await db
    .prepare(`UPDATE beats SET media_r2_key=?, recorded_at=?, dur_ms=COALESCE(?, dur_ms) WHERE id=?`)
    .bind(key, Date.now(), durMs || null, beatId)
    .run();
}

/**
 * Strike an inserted block, or put it back.
 *
 * A beat carries its own struck flag rather than living in `cuts`, because
 * `cuts` are ranges of the SOURCE transcript and a recording has no range in
 * it. Same discipline either way: nothing is deleted, so it renders struck
 * through and can be restored.
 */
export async function toggleBeatStruck(
  db: D1Database,
  projectId: string,
  beatId: string,
): Promise<boolean> {
  const row = await db
    .prepare(`SELECT struck FROM beats WHERE id=? AND project_id=?`)
    .bind(beatId, projectId)
    .first<{ struck: string | null }>();
  if (!row) return false;
  const next = Boolean(row.struck) && row.struck !== "0" ? null : "1";
  await db
    .prepare(`UPDATE beats SET struck=? WHERE id=? AND project_id=?`)
    .bind(next, beatId, projectId)
    .run();
  return next !== null;
}

export async function getBeats(db: D1Database, projectId: string): Promise<Beat[]> {
  const { results } = await db
    .prepare(`SELECT * FROM beats WHERE project_id=? ORDER BY idx`)
    .bind(projectId)
    .all<Beat>();
  return results ?? [];
}
