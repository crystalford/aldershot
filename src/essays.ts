/**
 * Essays — the video-essay authoring surface described in the Claude Design
 * handoff: a premise, drafted act-by-act (Hook → Setup → Development → Turn
 * → Resolution) into a script of beats, then assembled and exported. Kept as
 * its own file/tables, same split-by-entity convention as clips.ts/visualtags.ts.
 *
 * A beat is either:
 *   - kind "clip": grounded to a real, already-saved Archive clip (clip_id) —
 *     never an invented one, same discipline as composeFromClips/reason.ts.
 *   - kind "vo": a proposed narration line with no source footage yet. This is
 *     GENERATIVE text (like generateBridges' narration), not a factual claim,
 *     so it's fine for the model to draft it — the user reviews/edits it.
 * Recording real voiceover audio for "vo" beats, and a third "research" kind
 * grounded in Discover, are both deferred — Discover/Clipping/Generative are
 * still stubs (see public/app.js RAIL_ITEMS), so there's nothing to ground a
 * "research" beat against yet, and mic-capture-for-VO is a fast-follow.
 *
 * One flat `ord` per essay does double duty: Script mode groups beats by
 * `act` and sorts by `ord` within that group; Assemble mode ignores the
 * grouping and sorts ALL beats by `ord` — one canonical order, not two.
 */

export type BeatAct = "hook" | "setup" | "development" | "turn" | "resolution";
export type BeatKind = "clip" | "vo";
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
}

export interface EssayBeat {
  id: string;
  essayId: string;
  act: BeatAct;
  ord: number;
  kind: BeatKind;
  clipId: string | null;
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
  created_at: number; updated_at: number;
}
interface BeatRow {
  id: string; essay_id: string; act: string; ord: number; kind: string;
  clip_id: string | null; text: string; citations: string; created_at: number;
}
const toBeat = (r: BeatRow): EssayBeat => ({
  id: r.id, essayId: r.essay_id, act: r.act as BeatAct, ord: r.ord, kind: r.kind as BeatKind,
  clipId: r.clip_id, text: r.text, citations: JSON.parse(r.citations || "[]"), createdAt: r.created_at,
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
    tone: e.tone, builder_mode: e.builder_mode, created_at: e.created_at, updated_at: e.updated_at,
    threads: threadsByEssay.get(e.id) ?? [], beats: beatsByEssay.get(e.id) ?? [],
  }));
}

export async function listEssays(db: D1Database): Promise<EssayDetail[]> {
  const { results } = await db.prepare(`SELECT * FROM essays ORDER BY updated_at DESC`).all<EssayRow>();
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

export async function deleteEssay(db: D1Database, id: string): Promise<void> {
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
  input: { act: BeatAct; kind: BeatKind; clipId?: string | null; text: string; citations?: string[] },
): Promise<EssayBeat> {
  const { results } = await db.prepare(`SELECT COALESCE(MAX(ord), -1) as maxOrd FROM essay_beats WHERE essay_id = ?`).bind(essayId).all<{ maxOrd: number }>();
  const ord = (results?.[0]?.maxOrd ?? -1) + 1;
  const beat: EssayBeat = {
    id: crypto.randomUUID(), essayId, act: input.act, ord, kind: input.kind,
    clipId: input.clipId ?? null, text: input.text, citations: input.citations ?? [], createdAt: Date.now(),
  };
  await db
    .prepare(`INSERT INTO essay_beats (id, essay_id, act, ord, kind, clip_id, text, citations, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(beat.id, beat.essayId, beat.act, beat.ord, beat.kind, beat.clipId, beat.text, JSON.stringify(beat.citations), beat.createdAt)
    .run();
  await db.prepare(`UPDATE essays SET updated_at = ? WHERE id = ?`).bind(Date.now(), essayId).run();
  return beat;
}

export async function updateBeat(
  db: D1Database,
  essayId: string,
  beatId: string,
  patch: { text?: string; citations?: string[] },
): Promise<EssayBeat | null> {
  const existing = await db.prepare(`SELECT id FROM essay_beats WHERE id = ? AND essay_id = ?`).bind(beatId, essayId).first<{ id: string }>();
  if (!existing) return null;
  const fields: string[] = [];
  const params: unknown[] = [];
  if (patch.text !== undefined) { fields.push("text = ?"); params.push(patch.text); }
  if (patch.citations !== undefined) { fields.push("citations = ?"); params.push(JSON.stringify(patch.citations)); }
  if (fields.length) await db.prepare(`UPDATE essay_beats SET ${fields.join(", ")} WHERE id = ?`).bind(...params, beatId).run();
  const row = await db.prepare(`SELECT * FROM essay_beats WHERE id = ?`).bind(beatId).first<BeatRow>();
  return row ? toBeat(row) : null;
}

export async function deleteBeat(db: D1Database, essayId: string, beatId: string): Promise<void> {
  await db.prepare(`DELETE FROM essay_beats WHERE id = ? AND essay_id = ?`).bind(beatId, essayId).run();
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
