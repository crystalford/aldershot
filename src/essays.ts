/**
 * Essays — the video-essay authoring surface described in the Claude Design
 * handoff: a premise, drafted act-by-act (Hook → Setup → Development → Turn
 * → Resolution) into a script of beats, then assembled and exported. Kept as
 * its own file/tables, same split-by-entity convention as clips.ts/visualtags.ts.
 *
 * A beat is one of three kinds:
 *   - "clip": grounded to a real, already-saved Archive clip (clip_id) —
 *     never an invented one, same discipline as composeFromClips/reason.ts.
 *   - "vo": a proposed narration line with no source footage yet. This is
 *     GENERATIVE text (like generateBridges' narration), not a factual claim,
 *     so it's fine for the model to draft it — the user reviews/edits it.
 *   - "research": grounded to a real DiscoverResult (discover_result_id) —
 *     same non-invented discipline as "clip", see src/discover.ts.
 * Recording real voiceover audio for "vo" beats is deferred (mic-capture-
 * for-VO is a fast-follow); "research" beats are wired now that Discover
 * (src/discover.ts) exists to ground them against.
 *
 * One flat `ord` per essay does double duty: Script mode groups beats by
 * `act` and sorts by `ord` within that group; Assemble mode ignores the
 * grouping and sorts ALL beats by `ord` — one canonical order, not two.
 */

export type BeatAct = "hook" | "setup" | "development" | "turn" | "resolution";
export type BeatKind = "clip" | "vo" | "research";
export const ACTS: BeatAct[] = ["hook", "setup", "development", "turn", "resolution"];

export interface Essay {
  id: string;
  title: string;
  premise: string;
  audience: string | null;
  target_length: string | null;
  tone: string | null;
  builder_mode: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface EssayBeat {
  id: string;
  essayId: string;
  act: BeatAct;
  ord: number;
  kind: BeatKind;
  clipId: string | null;
  discoverResultId: string | null;
  /** The recorded take backing a "vo" beat — a real videos.id, transcribed
   *  through the same pipeline as any upload (see recordAndAttachVoiceover
   *  in app.js). Null until recorded; Assemble/Export only include a vo
   *  beat once this is set. */
  voVideoId: string | null;
  text: string;
  citations: string[];
  createdAt: number;
}

export interface EssayDetail extends Essay {
  threads: string[];
  beats: EssayBeat[];
}

const normalizeTag = (t: string) => t.trim().toLowerCase();

export async function ensureEssaySchema(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS essays (
         id TEXT PRIMARY KEY,
         title TEXT NOT NULL,
         premise TEXT NOT NULL DEFAULT '',
         audience TEXT,
         target_length TEXT,
         tone TEXT,
         builder_mode TEXT NOT NULL DEFAULT 'premise',
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL
       )`,
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS essay_threads (
         essay_id TEXT NOT NULL,
         tag TEXT NOT NULL,
         PRIMARY KEY (essay_id, tag)
       )`,
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS essay_beats (
         id TEXT PRIMARY KEY,
         essay_id TEXT NOT NULL,
         act TEXT NOT NULL,
         ord INTEGER NOT NULL,
         kind TEXT NOT NULL,
         clip_id TEXT,
         text TEXT NOT NULL DEFAULT '',
         citations TEXT NOT NULL DEFAULT '[]',
         created_at INTEGER NOT NULL
       )`,
    ),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_essay_beats_essay ON essay_beats (essay_id, ord)`),
  ]);
  // discover_result_id / vo_video_id are new — a table created before
  // "research" beats or voiceover recording existed needs them added on,
  // same ALTER-if-absent pattern as db.ts's `kind`.
  const cols = await db.prepare(`PRAGMA table_info(essay_beats)`).all<{ name: string }>();
  const colNames = new Set((cols.results ?? []).map((c) => c.name));
  if (!colNames.has("discover_result_id")) {
    await db.prepare(`ALTER TABLE essay_beats ADD COLUMN discover_result_id TEXT`).run();
  }
  if (!colNames.has("vo_video_id")) {
    await db.prepare(`ALTER TABLE essay_beats ADD COLUMN vo_video_id TEXT`).run();
  }
  // deleted_at backs Trash — "Delete" soft-deletes (see softDeleteEssay
  // below) so it can be undone, same idea as db.ts's projects.deleted_at.
  const essayCols = await db.prepare(`PRAGMA table_info(essays)`).all<{ name: string }>();
  if (!(essayCols.results ?? []).some((c) => c.name === "deleted_at")) {
    await db.prepare(`ALTER TABLE essays ADD COLUMN deleted_at INTEGER`).run();
  }
}

export async function createEssay(
  db: D1Database,
  input: { title: string; premise: string; audience?: string | null; targetLength?: string | null; tone?: string | null; threads?: string[] },
): Promise<EssayDetail> {
  const now = Date.now();
  const essay: Essay = {
    id: crypto.randomUUID(),
    title: input.title,
    premise: input.premise,
    audience: input.audience ?? null,
    target_length: input.targetLength ?? null,
    tone: input.tone ?? null,
    builder_mode: "premise",
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
  const threads = [...new Set((input.threads ?? []).map(normalizeTag).filter(Boolean))];
  await db.batch([
    db
      .prepare(
        `INSERT INTO essays (id, title, premise, audience, target_length, tone, builder_mode, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(essay.id, essay.title, essay.premise, essay.audience, essay.target_length, essay.tone, essay.builder_mode, essay.created_at, essay.updated_at),
    ...threads.map((tag) => db.prepare(`INSERT INTO essay_threads (essay_id, tag) VALUES (?, ?)`).bind(essay.id, tag)),
  ]);
  return { ...essay, threads, beats: [] };
}

interface EssayRow {
  id: string; title: string; premise: string; audience: string | null;
  target_length: string | null; tone: string | null; builder_mode: string;
  created_at: number; updated_at: number; deleted_at: number | null;
}
interface BeatRow {
  id: string; essay_id: string; act: string; ord: number; kind: string;
  clip_id: string | null; discover_result_id: string | null; vo_video_id: string | null;
  text: string; citations: string; created_at: number;
}
const toBeat = (r: BeatRow): EssayBeat => ({
  id: r.id, essayId: r.essay_id, act: r.act as BeatAct, ord: r.ord, kind: r.kind as BeatKind,
  clipId: r.clip_id, discoverResultId: r.discover_result_id, voVideoId: r.vo_video_id,
  text: r.text, citations: JSON.parse(r.citations || "[]"), createdAt: r.created_at,
});

async function attachThreadsAndBeats(db: D1Database, essays: EssayRow[]): Promise<EssayDetail[]> {
  if (!essays.length) return [];
  const ids = essays.map((e) => e.id);
  const placeholders = ids.map(() => "?").join(",");
  const [{ results: threadRows }, { results: beatRows }] = await Promise.all([
    db.prepare(`SELECT essay_id, tag FROM essay_threads WHERE essay_id IN (${placeholders}) ORDER BY tag ASC`).bind(...ids).all<{ essay_id: string; tag: string }>(),
    db.prepare(`SELECT * FROM essay_beats WHERE essay_id IN (${placeholders}) ORDER BY ord ASC`).bind(...ids).all<BeatRow>(),
  ]);
  const threadsByEssay = new Map<string, string[]>();
  for (const r of threadRows ?? []) threadsByEssay.set(r.essay_id, [...(threadsByEssay.get(r.essay_id) ?? []), r.tag]);
  const beatsByEssay = new Map<string, EssayBeat[]>();
  for (const r of beatRows ?? []) beatsByEssay.set(r.essay_id, [...(beatsByEssay.get(r.essay_id) ?? []), toBeat(r)]);
  return essays.map((e) => ({
    id: e.id, title: e.title, premise: e.premise, audience: e.audience, target_length: e.target_length,
    tone: e.tone, builder_mode: e.builder_mode, created_at: e.created_at, updated_at: e.updated_at, deleted_at: e.deleted_at,
    threads: threadsByEssay.get(e.id) ?? [], beats: beatsByEssay.get(e.id) ?? [],
  }));
}

export async function listEssays(db: D1Database): Promise<EssayDetail[]> {
  const { results } = await db.prepare(`SELECT * FROM essays WHERE deleted_at IS NULL ORDER BY updated_at DESC`).all<EssayRow>();
  return attachThreadsAndBeats(db, results ?? []);
}

/** Trash — essays whose deleted_at is set, newest-removed first. See
 *  softDeleteEssay/restoreEssay below; nothing here is a hard delete. */
export async function listTrashedEssays(db: D1Database): Promise<EssayDetail[]> {
  const { results } = await db.prepare(`SELECT * FROM essays WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`).all<EssayRow>();
  return attachThreadsAndBeats(db, results ?? []);
}

export async function getEssay(db: D1Database, id: string): Promise<EssayDetail | null> {
  const row = await db.prepare(`SELECT * FROM essays WHERE id = ?`).bind(id).first<EssayRow>();
  if (!row) return null;
  const [detail] = await attachThreadsAndBeats(db, [row]);
  return detail;
}

export async function updateEssayMeta(
  db: D1Database,
  id: string,
  patch: { title?: string; premise?: string; audience?: string | null; targetLength?: string | null; tone?: string | null; builderMode?: string; threads?: string[] },
): Promise<EssayDetail | null> {
  const existing = await db.prepare(`SELECT id FROM essays WHERE id = ?`).bind(id).first<{ id: string }>();
  if (!existing) return null;
  const fields: string[] = ["updated_at = ?"];
  const params: unknown[] = [Date.now()];
  if (patch.title !== undefined) { fields.push("title = ?"); params.push(patch.title); }
  if (patch.premise !== undefined) { fields.push("premise = ?"); params.push(patch.premise); }
  if (patch.audience !== undefined) { fields.push("audience = ?"); params.push(patch.audience); }
  if (patch.targetLength !== undefined) { fields.push("target_length = ?"); params.push(patch.targetLength); }
  if (patch.tone !== undefined) { fields.push("tone = ?"); params.push(patch.tone); }
  if (patch.builderMode !== undefined) { fields.push("builder_mode = ?"); params.push(patch.builderMode); }
  const statements = [db.prepare(`UPDATE essays SET ${fields.join(", ")} WHERE id = ?`).bind(...params, id)];
  if (patch.threads !== undefined) {
    const threads = [...new Set(patch.threads.map(normalizeTag).filter(Boolean))];
    statements.push(db.prepare(`DELETE FROM essay_threads WHERE essay_id = ?`).bind(id));
    for (const tag of threads) statements.push(db.prepare(`INSERT INTO essay_threads (essay_id, tag) VALUES (?, ?)`).bind(id, tag));
  }
  await db.batch(statements);
  return getEssay(db, id);
}

/** "Delete" from the Essays list is a soft delete — it drops out of
 *  listEssays but stays fully intact (script, beats, threads) so Trash can
 *  restore it exactly as it was. See permanentlyDeleteEssay for the actual
 *  irreversible removal, only ever called from Trash. */
export async function softDeleteEssay(db: D1Database, id: string): Promise<void> {
  await db.prepare(`UPDATE essays SET deleted_at = ? WHERE id = ?`).bind(Date.now(), id).run();
}

export async function restoreEssay(db: D1Database, id: string): Promise<void> {
  await db.prepare(`UPDATE essays SET deleted_at = NULL WHERE id = ?`).bind(id).run();
}

export async function permanentlyDeleteEssay(db: D1Database, id: string): Promise<void> {
  await db.batch([
    db.prepare(`DELETE FROM essay_threads WHERE essay_id = ?`).bind(id),
    db.prepare(`DELETE FROM essay_beats WHERE essay_id = ?`).bind(id),
    db.prepare(`DELETE FROM essays WHERE id = ?`).bind(id),
  ]);
}

/** Appends one beat at the end of the essay's single canonical order. */
export async function addBeat(
  db: D1Database,
  essayId: string,
  input: { act: BeatAct; kind: BeatKind; clipId?: string | null; discoverResultId?: string | null; voVideoId?: string | null; text: string; citations?: string[] },
): Promise<EssayBeat> {
  const { results } = await db.prepare(`SELECT COALESCE(MAX(ord), -1) as maxOrd FROM essay_beats WHERE essay_id = ?`).bind(essayId).all<{ maxOrd: number }>();
  const ord = (results?.[0]?.maxOrd ?? -1) + 1;
  const beat: EssayBeat = {
    id: crypto.randomUUID(), essayId, act: input.act, ord, kind: input.kind,
    clipId: input.clipId ?? null, discoverResultId: input.discoverResultId ?? null, voVideoId: input.voVideoId ?? null,
    text: input.text, citations: input.citations ?? [], createdAt: Date.now(),
  };
  await db
    .prepare(`INSERT INTO essay_beats (id, essay_id, act, ord, kind, clip_id, discover_result_id, vo_video_id, text, citations, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(beat.id, beat.essayId, beat.act, beat.ord, beat.kind, beat.clipId, beat.discoverResultId, beat.voVideoId, beat.text, JSON.stringify(beat.citations), beat.createdAt)
    .run();
  await db.prepare(`UPDATE essays SET updated_at = ? WHERE id = ?`).bind(Date.now(), essayId).run();
  return beat;
}

export async function updateBeat(
  db: D1Database,
  essayId: string,
  beatId: string,
  patch: { text?: string; citations?: string[]; voVideoId?: string | null; discoverResultId?: string | null },
): Promise<EssayBeat | null> {
  const existing = await db.prepare(`SELECT id FROM essay_beats WHERE id = ? AND essay_id = ?`).bind(beatId, essayId).first<{ id: string }>();
  if (!existing) return null;
  const fields: string[] = [];
  const params: unknown[] = [];
  if (patch.text !== undefined) { fields.push("text = ?"); params.push(patch.text); }
  if (patch.citations !== undefined) { fields.push("citations = ?"); params.push(JSON.stringify(patch.citations)); }
  if (patch.voVideoId !== undefined) { fields.push("vo_video_id = ?"); params.push(patch.voVideoId); }
  if (patch.discoverResultId !== undefined) { fields.push("discover_result_id = ?"); params.push(patch.discoverResultId); }
  if (fields.length) await db.prepare(`UPDATE essay_beats SET ${fields.join(", ")} WHERE id = ?`).bind(...params, beatId).run();
  const row = await db.prepare(`SELECT * FROM essay_beats WHERE id = ?`).bind(beatId).first<BeatRow>();
  return row ? toBeat(row) : null;
}

export async function deleteBeat(db: D1Database, essayId: string, beatId: string): Promise<void> {
  await db.prepare(`DELETE FROM essay_beats WHERE id = ? AND essay_id = ?`).bind(beatId, essayId).run();
}

/** How many distinct essays reference each clip via a "clip"-kind beat —
 *  feeds the Archive's "Used in N essays" badge. Returns an empty map for
 *  an empty input rather than issuing a pointless query. */
export async function countClipUsage(db: D1Database, clipIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const ids = [...new Set(clipIds)];
  if (!ids.length) return map;
  const placeholders = ids.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      `SELECT clip_id, COUNT(DISTINCT essay_id) as n FROM essay_beats
       WHERE kind = 'clip' AND clip_id IN (${placeholders}) GROUP BY clip_id`,
    )
    .bind(...ids)
    .all<{ clip_id: string; n: number }>();
  for (const r of results ?? []) map.set(r.clip_id, r.n);
  return map;
}

/** Assigns sequential ord 0..n-1 to a full reordered list of this essay's beat ids. */
export async function reorderBeats(db: D1Database, essayId: string, order: string[]): Promise<void> {
  const { results } = await db.prepare(`SELECT id FROM essay_beats WHERE essay_id = ?`).bind(essayId).all<{ id: string }>();
  const valid = new Set((results ?? []).map((r) => r.id));
  const statements = order
    .filter((id) => valid.has(id))
    .map((id, i) => db.prepare(`UPDATE essay_beats SET ord = ? WHERE id = ?`).bind(i, id));
  if (statements.length) await db.batch(statements);
}
