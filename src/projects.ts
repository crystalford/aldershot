/**
 * Projects and beats.
 *
 * "Ordered blocks. THE EDIT IS THIS TABLE — there is no timeline object."
 * (03-DATA-MODEL.md). That is the whole architecture of the editor: the edit is
 * data, so a render is a pure function of it and can always be re-run, and
 * "no timeline" is true in the database as well as in the UI.
 */

import { ulid } from "./id.ts";
import { indexWords, spanFor } from "./align.ts";
import { buildBlocks, parseOrder, type Block, type PulledClip, type ScoreLike, type SegmentLike } from "./blocks.ts";
import { parseCuts, parseWords, wordsInRange, type Cut, type StoredWord } from "./cuts.ts";
import { getSegments } from "./sources.ts";
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
  /**
   * The sources this cut was attached to, as JSON ids — null for the whole
   * library. See the column's comment in src/schema.ts.
   */
  scope: string | null;
  /** Script mode's transcript cuts, as JSON. See src/cuts.ts. */
  cuts: string | null;
  /** The arrangement: block ids in sequence. Null means never rearranged. */
  block_order: string | null;
  /**
   * Narrowed to this one video, or null for every video it is made of.
   *
   * Separate from `scope` on purpose: see the column's comment in
   * src/schema.ts and scopeOf below. Clearing it restores the whole cut
   * without re-attaching anything.
   */
  only_source_id: string | null;
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
  /**
   * What the recorded take turned out to be, once it has been aligned.
   *
   * Null is "nobody has looked yet", which is a different fact from a take
   * that does not read its line — see src/take.ts. `SELECT *` carries them,
   * so there is nothing to add to the query; they are declared here so a
   * reader can see they exist.
   */
  take_verdict?: string | null;
  take_reason?: string | null;
  take_words?: string | null;
  /** A generated picture placed over a claim as a depiction; see src/schema.ts. */
  over_claim?: number | null;
}

export interface Clip {
  id: string;
  user_id: string;
  source_id: string;
  start_ms: number;
  end_ms: number;
  /** The moment's address in words, which survives re-alignment. Null when
      the source has no word timings. See src/align.ts. */
  start_word: number | null;
  end_word: number | null;
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

/**
 * THE VIDEOS A CUT IS MADE OF, or null for the whole library.
 *
 * Parsed rather than trusted: this is a TEXT column and a malformed value
 * would otherwise throw on whichever page read it next. A scope that cannot
 * be read is the same as no scope, which is the behaviour every project made
 * before the column existed already has.
 *
 * This is the ATTACHED set and it only grows. `scopeOf` is what the engine
 * reads, and that narrows this by `only_source_id` when one is set.
 */
export function attachedScope(project: { scope?: string | null }): string[] | null {
  if (!project.scope) return null;
  try {
    const ids = JSON.parse(project.scope) as unknown;
    if (!Array.isArray(ids)) return null;
    const clean = ids.filter((x): x is string => typeof x === "string" && x.length > 0);
    return clean.length ? clean : null;
  } catch {
    return null;
  }
}

/**
 * The sources the engine should cut from, which is what every caller wants.
 *
 * `only_source_id` narrows it to one video. That is a REVERSIBLE view of the
 * project, not a change to what it is made of: attachedScope still lists
 * every video attached, so clearing the narrowing brings the rest of the cut
 * back rather than needing it re-attached (invariant 6).
 *
 * A narrowing to a video that is not attached is ignored. It cannot happen
 * through the route, which checks, but a stale row after a detach would
 * otherwise produce a cut from nothing and look like an engine fault.
 */
export function scopeOf(project: {
  scope?: string | null;
  only_source_id?: string | null;
}): string[] | null {
  const attached = attachedScope(project);
  const only = project.only_source_id;
  if (!only) return attached;
  if (attached && !attached.includes(only)) return attached;
  return [only];
}

export async function createProject(
  db: D1Database,
  opts: {
    user_id: string;
    title: string;
    kind: ProjectKind;
    source_id?: string | null;
    brief?: string | null;
    /** The sources it was attached to. Omitted means the whole library. */
    scope?: string[] | null;
  },
): Promise<Project> {
  const now = Date.now();
  const p: Project = {
    id: ulid(),
    user_id: opts.user_id,
    title: opts.title,
    kind: opts.kind,
    source_id: opts.source_id ?? null,
    brief: opts.brief ?? null,
    scope: opts.scope?.length ? JSON.stringify(opts.scope) : null,
    /* A new cut is never narrowed: it is made of everything it was given. */
    only_source_id: null,
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
      `INSERT INTO v2_projects (id,user_id,title,kind,source_id,scope,brief,has_acts,runtime_s,pct,next_action,poster_r2_key,archived_at,created_at,updated_at,deleted_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      p.id, p.user_id, p.title, p.kind, p.source_id, p.scope, p.brief, p.has_acts, p.runtime_s,
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
/*
 * `IS`, NOT `=`, AND THAT IS THE WHOLE POINT.
 *
 * `cut_title` is null on any source whose auto-naming failed — src/naming.ts
 * says so in as many words: "a source that could not be named keeps a null
 * cut_title". With `=`, comparing a real title against that null is NULL, not
 * false, so the whole OR chain came out NULL whenever both other branches were
 * false. `NOT NULL` is NULL too, so TOUCHED went NULL and the row failed its
 * own WHERE clause: **a cut you had named yourself did not appear in Projects
 * at all**, as long as its source had never been given a cut_title and the
 * edit had no brief, cuts, beats or renders to short-circuit the OR.
 *
 * It hid for as long as it did because almost every real project has one of
 * those four, and because only ONE of the two uses can see it: the reap
 * (`AND ${UNNAMED}`) is unaffected, since every row it means to collapse makes
 * an earlier branch of the OR true and SQL short-circuits there. It takes the
 * `NOT` in TOUCHED to turn an unknown into a dropped row.
 *
 * Found by scripts/seed-fixture.cjs checking its own work through the product
 * instead of reading back its INSERTs: the cut page rendered all 163 words and
 * /api/projects did not list the project.
 *
 * SQLite's `IS` is null-safe equality, so every branch is now true or false
 * and never NULL.
 */
const UNNAMED = `(
  title = 'Untitled cut'
  OR title IS (SELECT s.title FROM sources s WHERE s.id = v2_projects.source_id)
  OR title IS (SELECT s.cut_title FROM sources s WHERE s.id = v2_projects.source_id)
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
 * EXPORTED, because begin() needs the same answer. It had its own, different
 * rule for whether an edit could be reused — "has no brief" — which is a much
 * weaker test: an edit you had spent an hour cutting has no brief either, so
 * clicking your own footage handed it back to you and there was no way to
 * start a fresh cut of a video you had already edited. Two definitions of "is
 * this edit yours yet" in one product is the conflict the owner has been
 * reporting since the beginning.
 *
 * "A name you typed" is any title that is not one the product chose — see
 * UNNAMED. The auto-name is one the product chose.
 */
export const TOUCHED = `(
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

  /*
   * THE WORD SPAN, WORKED OUT AT THE ONE MOMENT IT IS CHEAP.
   *
   * The transcript is already being read here, so numbering its words costs
   * one more pass over rows that are in hand. Doing it later would mean
   * re-reading every segment of every source to address moments that were
   * saved without one.
   *
   * Null when the source has no word timings — a failed transcript, or one
   * stored before they were kept. The milliseconds stay what they have always
   * been, so nothing regresses; a moment simply has no address yet.
   */
  const { results: segs } = await db
    .prepare(`SELECT idx, words FROM segments WHERE source_id=? ORDER BY idx`)
    .bind(opts.source_id)
    .all<{ idx: number; words: string | null }>();
  const words = indexWords(segs ?? [], parseWords);

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
    start_word: spanFor(words, c.start_ms, c.end_ms)?.startWord ?? null,
    end_word: spanFor(words, c.start_ms, c.end_ms)?.endWord ?? null,
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
    `INSERT INTO v2_clips (id,user_id,source_id,start_ms,end_ms,start_word,end_word,quote,why,score,heat,frame_r2_key,kept,origin,used_count,created_at,deleted_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  await db.batch(
    rows.map((r) =>
      stmt.bind(
        r.id, r.user_id, r.source_id, r.start_ms, r.end_ms, r.start_word, r.end_word,
        r.quote, r.why, r.score, r.heat,
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

export async function putBeats(
  db: D1Database,
  projectId: string,
  beats: Array<Partial<Pick<Beat, "id">> & Omit<Beat, "id" | "project_id" | "idx">>,
): Promise<void> {
  await db.prepare(`DELETE FROM beats WHERE project_id=?`).bind(projectId).run();
  if (!beats.length) return;
  const stmt = db.prepare(
    `INSERT INTO beats (id,project_id,idx,kind,act,clip_id,text,struck,dur_ms,media_r2_key,recorded_at,over_claim)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  await db.batch(
    beats.map((b, i) =>
      stmt.bind(
        // Keep the id when the caller has one. Reordering must not mint new
        // ids: a recorded take is attached to a beat BY id, so re-keying on
        // every move would orphan the audio the user just recorded.
        b.id || ulid(), projectId, i, b.kind, b.act ?? null, b.clip_id ?? null, b.text ?? null,
        b.struck ?? null, b.dur_ms ?? null, b.media_r2_key ?? null, b.recorded_at ?? null,
        /* Carried through every rewrite, or moving a beat would strip the
           depiction label off a picture still sitting over a claim. */
        b.over_claim ? 1 : null,
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
  beat: { kind: BeatKind; act?: string | null; text?: string | null; clip_id?: string | null; dur_ms?: number | null; over_claim?: boolean },
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
    over_claim: beat.over_claim ? 1 : null,
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
/**
 * Attach media to a beat — a recording, or a spoken line.
 *
 * TAKES A USER, and joins through the project to check it.
 *
 * This was `WHERE id=?` with no owner check at all, and the recording route
 * called it with a beat id straight out of the URL. Any signed-in account
 * could point ANY beat at an object under its own prefix, and the victim's
 * next export would presign it server-side and mux a stranger's audio into
 * their video.
 *
 * The check lives here rather than in the route because there are two callers
 * and the next one will not remember. Returns false when the beat is not
 * yours, so callers can answer honestly instead of reporting success.
 */
export async function setBeatMedia(
  db: D1Database,
  beatId: string,
  userId: string,
  key: string,
  durMs: number,
): Promise<boolean> {
  const { meta } = await db
    .prepare(
      `UPDATE beats SET media_r2_key=?, recorded_at=?, dur_ms=COALESCE(?, dur_ms)
        WHERE id=? AND project_id IN (
          SELECT id FROM v2_projects WHERE user_id=? AND deleted_at IS NULL
        )`,
    )
    .bind(key, Date.now(), durMs || null, beatId, userId)
    .run();
  if ((meta?.changes ?? 0) === 0) return false;

  /*
   * AND THE TAKE IS KEPT.
   *
   * The UPDATE above is the whole of what this used to do, which meant a
   * second recording overwrote the first and the first was gone. Invariant
   * 6 — and a performance is the one thing the engine cannot re-make.
   *
   * After the ownership check, not before: a row written for a beat that
   * turned out not to be yours would be a stranger's recording filed under
   * your account, which is the bug the check above exists for.
   */
  await db
    .prepare(
      `INSERT INTO takes (id, beat_id, r2_key, dur_ms, created_at)
       VALUES (?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET r2_key=excluded.r2_key, dur_ms=excluded.dur_ms`,
    )
    .bind(takeId(beatId, key), beatId, key, durMs || null, Date.now())
    .run();
  return true;
}

/*
 * A TAKE'S ID IS ITS BEAT AND ITS KEY.
 *
 * Derived rather than random so that saving the same recording twice — a
 * retried upload, a double-fired handler — is one take and not two. The
 * same reasoning as every other `INSERT OR REPLACE` in this codebase: the
 * write has to be safe to repeat.
 */
export const takeId = (beatId: string, key: string) => `t:${beatId}:${key}`;

export interface Take {
  id: string;
  r2_key: string;
  dur_ms: number | null;
  verdict: string | null;
  reason: string | null;
  created_at: number;
  /** The one the beat points at — see the takes table's own comment. */
  chosen: boolean;
}

/** Every take on a beat, newest first, and which one the cut is using. */
export async function listTakes(
  db: D1Database,
  beatId: string,
  userId: string,
): Promise<Take[]> {
  const { results } = await db
    .prepare(
      `SELECT t.id, t.r2_key, t.dur_ms, t.verdict, t.reason, t.created_at,
              CASE WHEN t.r2_key = b.media_r2_key THEN 1 ELSE 0 END AS chosen
         FROM takes t
         JOIN beats b ON b.id = t.beat_id
         JOIN v2_projects p ON p.id = b.project_id
        WHERE t.beat_id = ? AND p.user_id = ? AND p.deleted_at IS NULL
        ORDER BY t.created_at DESC`,
    )
    .bind(beatId, userId)
    .all<Omit<Take, "chosen"> & { chosen: number }>();
  return (results ?? []).map((r) => ({ ...r, chosen: Boolean(r.chosen) }));
}

/**
 * Use this take instead.
 *
 * Points the beat at it and mirrors its length and verdict, because the
 * editor and the renderer read those from the beat. Nothing is thrown away:
 * the take you were using is still a row, still in R2, and one press from
 * being chosen again.
 */
export async function chooseTake(
  db: D1Database,
  beatId: string,
  takeRowId: string,
  userId: string,
): Promise<boolean> {
  const take = await db
    .prepare(
      `SELECT t.r2_key, t.dur_ms, t.verdict, t.reason
         FROM takes t
         JOIN beats b ON b.id = t.beat_id
         JOIN v2_projects p ON p.id = b.project_id
        WHERE t.id = ? AND t.beat_id = ? AND p.user_id = ? AND p.deleted_at IS NULL`,
    )
    .bind(takeRowId, beatId, userId)
    .first<{ r2_key: string; dur_ms: number | null; verdict: string | null; reason: string | null }>();
  if (!take) return false;

  const { meta } = await db
    .prepare(
      `UPDATE beats SET media_r2_key=?, dur_ms=COALESCE(?, dur_ms),
              take_verdict=?, take_reason=? WHERE id=?`,
    )
    .bind(take.r2_key, take.dur_ms, take.verdict, take.reason, beatId)
    .run();
  return (meta?.changes ?? 0) > 0;
}

/**
 * Strike an inserted block, or put it back.
 *
 * A beat carries its own struck flag rather than living in `cuts`, because
 * `cuts` are ranges of the SOURCE transcript and a recording has no range in
 * it. Same discipline either way: nothing is deleted, so it renders struck
 * through and can be restored.
 */
/**
 * Strike an inserted block, or put it back.
 *
 * Returns null when there is no such beat, and otherwise the state it is NOW
 * in. Those are two different questions and this used to answer them with the
 * same boolean: it returned "is it struck now", and the route read that as
 * "did the row exist" —
 *
 *     const found = await toggleBeatStruck(...);
 *     if (!found) return c.json({ error: "that block is gone" }, 404);
 *
 * so PUTTING A BLOCK BACK always looked like a failure. The database was
 * updated, the route 404'd, and the editor repainted the row as struck again.
 * Pressing "Add back" appeared to do nothing, and pressing it twice left the
 * row and the server saying opposite things.
 */
export async function toggleBeatStruck(
  db: D1Database,
  projectId: string,
  beatId: string,
): Promise<boolean | null> {
  const row = await db
    .prepare(`SELECT struck FROM beats WHERE id=? AND project_id=?`)
    .bind(beatId, projectId)
    .first<{ struck: string | null }>();
  if (!row) return null;
  const next = Boolean(row.struck) && row.struck !== "0" ? null : "1";
  await db
    .prepare(`UPDATE beats SET struck=? WHERE id=? AND project_id=?`)
    .bind(next, beatId, projectId)
    .run();
  return next !== null;
}

/**
 * The block sequence for a project — the one way to ask.
 *
 * There were eight separate buildBlocks calls, each assembling the same four
 * ingredients by hand, and every new ingredient had to be remembered in all of
 * them. Pulled clips are the third such ingredient after cuts and order; the
 * one that forgets is the one that renders something the editor never showed.
 */
export async function blocksForProject(
  db: D1Database,
  project: { id: string; source_id: string | null; cuts: string | null; block_order?: string | null },
  userId: string,
  opts: { segments?: SegmentLike[]; posterKey?: string | null; scores?: ScoreLike[] } = {},
): Promise<{ blocks: Block[]; cuts: Cut[]; beats: Beat[] }> {
  const cuts = parseCuts(project.cuts);
  const [segments, beats] = await Promise.all([
    opts.segments ?? (project.source_id ? getSegments(db, project.source_id) : Promise.resolve([])),
    getBeats(db, project.id),
  ]);

  const pulled = await pulledClips(
    db,
    userId,
    project.source_id,
    beats.filter((b) => b.kind === "clip" && b.clip_id).map((b) => b.clip_id as string),
  );

  const blocks = buildBlocks({
    segments,
    beats: beats.map((b) => ({ ...b, pulled: b.clip_id ? pulled.get(b.clip_id) : undefined })),
    cuts,
    order: parseOrder(project.block_order ?? null),
    posterKey: opts.posterKey ?? null,
    scores: opts.scores,
  });
  return { blocks, cuts, beats };
}

/**
 * Resolve the clip beats that point at ANOTHER video.
 *
 * The seam's "A clip" pulls a moment out of your library and drops it into
 * this cut. That moment lives in a different file, so the block has to carry
 * its own key and range — buildBlocks would otherwise drop it as a
 * same-source pointer and the thing you inserted would appear nowhere.
 *
 * Only clips from a DIFFERENT source come back: one from this video is
 * already a block, and pulling it in would render the same range twice.
 */
export async function pulledClips(
  db: D1Database,
  userId: string,
  ownSourceId: string | null,
  clipIds: string[],
): Promise<Map<string, PulledClip>> {
  const ids = clipIds.filter(Boolean);
  if (!ids.length) return new Map();
  const marks = ids.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      /* BOTH keys. r2_key is the master the export is cut from; the editing
         copy is what the editor plays. They are different files and a block
         that pulls in another video needs to know both — see Block.previewKey
         in src/blocks.ts. */
      `SELECT c.id, c.source_id, c.start_ms, c.end_ms, c.quote, c.frame_r2_key, s.r2_key,
              COALESCE(s.proxy_r2_key, s.r2_key) AS preview_key, s.title
         FROM v2_clips c JOIN sources s ON s.id = c.source_id
        WHERE c.id IN (${marks}) AND c.user_id=? AND c.deleted_at IS NULL AND s.deleted_at IS NULL`,
    )
    .bind(...ids, userId)
    .all<{
      id: string; source_id: string; start_ms: number; end_ms: number; quote: string;
      frame_r2_key: string | null; r2_key: string; preview_key: string; title: string;
    }>();

  const out = new Map<string, PulledClip>();
  for (const r of results ?? []) {
    out.set(r.id, {
      sourceKey: r.r2_key,
      previewKey: r.preview_key,
      sourceTitle: r.title,
      start_ms: r.start_ms,
      end_ms: r.end_ms,
      quote: r.quote,
      frameKey: r.frame_r2_key,
    });
  }
  /*
   * THE OTHER VIDEO'S WORDS, so an assembled cut can be READ.
   *
   * A pulled clip carried its quote and nothing finer, so a cut made from the
   * library had no words to highlight, to click, or for the script view to
   * flow. They come from the other source's own transcript, sliced to the
   * clip's range.
   *
   * Bounded by range, not by source: getSegments reads a whole video, and a
   * three-hour podcast is the 13MB problem the editor's windowing exists to
   * avoid. Only the segments that overlap a clip are asked for.
   *
   * Failure here is silent and harmless — the block falls back to its stored
   * quote, which is what it always had.
   */
  const rows = results ?? [];
  if (rows.length) {
    try {
      const spans = rows.map((r) => `(source_id=? AND end_ms>? AND start_ms<?)`).join(" OR ");
      const binds = rows.flatMap((r) => [r.source_id, r.start_ms, r.end_ms]);
      const { results: segs } = await db
        .prepare(`SELECT source_id, start_ms, end_ms, words FROM segments WHERE ${spans}`)
        .bind(...binds)
        .all<{ source_id: string; start_ms: number; end_ms: number; words: string | null }>();

      const bySource = new Map<string, Array<{ start_ms: number; words: StoredWord[] }>>();
      for (const sg of segs ?? []) {
        const list = bySource.get(sg.source_id) ?? [];
        list.push({ start_ms: sg.start_ms, words: parseWords(sg.words) });
        bySource.set(sg.source_id, list);
      }
      for (const [, list] of bySource) list.sort((a, b) => a.start_ms - b.start_ms);

      for (const r of rows) {
        const clip = out.get(r.id);
        if (!clip) continue;
        const all = (bySource.get(r.source_id) ?? []).flatMap((sg) => sg.words);
        clip.words = wordsInRange(all, r.start_ms, r.end_ms);
      }
    } catch {
      /* No words is the state this has always been in. */
    }
  }

  /* A clip from this same video is already on screen as segments. */
  if (ownSourceId) {
    const { results: own } = await db
      .prepare(`SELECT id FROM v2_clips WHERE id IN (${marks}) AND source_id=?`)
      .bind(...ids, ownSourceId)
      .all<{ id: string }>();
    for (const r of own ?? []) out.delete(r.id);
  }
  return out;
}

export async function getBeats(db: D1Database, projectId: string): Promise<Beat[]> {
  const { results } = await db
    .prepare(`SELECT * FROM beats WHERE project_id=? ORDER BY idx`)
    .bind(projectId)
    .all<Beat>();
  return results ?? [];
}

/**
 * THE VIDEOS THIS CUT IS MADE OF, in the order it first uses them.
 *
 * One Take's title row carries a small lettered square per video — A, B, C
 * — coloured, with the video's name and length in its title. They are
 * positional labels, not initials: A is the first video you hear.
 *
 * FIRST USE, which is why it is MIN(idx) rather than a name or a date. Two
 * videos called "Tuesday" would be indistinguishable by title, and the
 * letter has to mean something a person can follow down the page.
 *
 * A cut of one recording has no clip beats at all — it is segments of its
 * own source — so the caller passes that source id and gets the one chip.
 */
export interface CutSource {
  id: string;
  title: string;
  duration_s: number | null;
}

export async function sourcesInCut(
  db: D1Database,
  projectId: string,
  ownSourceId: string | null,
): Promise<CutSource[]> {
  if (ownSourceId) {
    const own = await db
      .prepare(`SELECT id, title, duration_s FROM sources WHERE id = ?`)
      .bind(ownSourceId)
      .first<CutSource>();
    return own ? [own] : [];
  }
  const { results } = await db
    .prepare(
      `SELECT s.id AS id, s.title AS title, s.duration_s AS duration_s
         FROM beats b
         JOIN v2_clips c ON c.id = b.clip_id
         JOIN sources s ON s.id = c.source_id
        WHERE b.project_id = ?
        GROUP BY s.id
        ORDER BY MIN(b.idx)`,
    )
    .bind(projectId)
    .all<CutSource>();
  return results ?? [];
}


/**
 * WHICH VIDEO EACH BLOCK COMES FROM, keyed by block id.
 *
 * The strip under the player draws one segment per block, coloured by its
 * source, and the lettered chips beside the title use the same colours in
 * the same order — so a person can see that the third segment is from video
 * B without reading anything. That only works if both read the same list.
 *
 * Beats only. A cut of one recording is segments of its own source and has
 * no beats at all; the caller handles that case with the project's own
 * source id, exactly as `sourcesInCut` does.
 */
export async function blockSources(db: D1Database, projectId: string): Promise<Record<string, string>> {
  const { results } = await db
    .prepare(
      `SELECT b.id AS beat_id, c.source_id AS source_id
         FROM beats b JOIN v2_clips c ON c.id = b.clip_id
        WHERE b.project_id = ?`,
    )
    .bind(projectId)
    .all<{ beat_id: string; source_id: string }>();
  const out: Record<string, string> = {};
  for (const r of results ?? []) out[`b:${r.beat_id}`] = r.source_id;
  return out;
}
