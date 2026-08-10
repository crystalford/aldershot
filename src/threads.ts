/**
 * Threads — the analytics/ranking surface: per-thread clip counts, growth
 * trend, color coding (see the design handoff's Threads view).
 *
 * v1 is derived entirely from the clip_tags an existing clip already carries
 * (manual tags, and whatever a suggested-edit/AI-detected clip was tagged
 * with) — not a semantic embedding/clustering pipeline. Real thematic
 * clustering needs a vector index (Vectorize, listed as a later phase in
 * wrangler.jsonc) to group clips that share a theme without sharing an exact
 * tag string; that's a real, separate infrastructure project, not something
 * to fake here. Tags already function as an auto-derived categorization
 * (nothing manually creates a "thread" object), so per the design brief's
 * "auto-detected only, rename/merge only" rule, a tag IS a thread — its
 * normalized text is the stable id, `rename` only changes the display name,
 * and `merge` reassigns every clip (and essay grounding reference) from one
 * tag to another.
 */

const PALETTE = [
  "#8fbf7f", "#d48a7b", "#7ba7d4", "#c9a86a", "#a889c9",
  "#6fb8a8", "#c97f9e", "#9fae6a", "#7f9bd4", "#d4a37b",
];
/** Deterministic so a thread's color never changes between requests, and so
 *  the client can compute the same color for a tag without a round trip
 *  (see public/app.js's identical colorForTag). */
export function colorForTag(tag: string): string {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (Math.imul(h, 31) + tag.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

const titleCase = (t: string) => t.replace(/\b\w/g, (c) => c.toUpperCase());
const WEEK_MS = 7 * 24 * 3600 * 1000;
const WEEKS = 8;

export interface ThreadSummary {
  tag: string;
  name: string;
  color: string;
  clipCount: number;
  /** Clips created per week, oldest (index 0) to most recent (last index). */
  weeklyGrowth: number[];
  sampleQuotes: string[];
}

export async function ensureThreadSchema(db: D1Database): Promise<void> {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS thread_meta (
       tag TEXT PRIMARY KEY,
       display_name TEXT,
       created_at INTEGER NOT NULL
     )`,
  ).run();
}

export async function listThreads(db: D1Database): Promise<ThreadSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT t.tag as tag, c.title as title, c.created_at as created_at
       FROM clip_tags t JOIN clips c ON c.id = t.clip_id
       ORDER BY t.tag ASC, c.created_at DESC`,
    )
    .all<{ tag: string; title: string; created_at: number }>();
  const { results: metaRows } = await db.prepare(`SELECT tag, display_name FROM thread_meta`).all<{ tag: string; display_name: string | null }>();
  const displayNames = new Map((metaRows ?? []).map((r) => [r.tag, r.display_name]));

  const byTag = new Map<string, { title: string; created_at: number }[]>();
  for (const r of results ?? []) byTag.set(r.tag, [...(byTag.get(r.tag) ?? []), { title: r.title, created_at: r.created_at }]);

  const now = Date.now();
  const threads: ThreadSummary[] = [];
  for (const [tag, rows] of byTag) {
    const weeklyGrowth = new Array(WEEKS).fill(0);
    for (const r of rows) {
      const weeksAgo = Math.floor((now - r.created_at) / WEEK_MS);
      if (weeksAgo >= 0 && weeksAgo < WEEKS) weeklyGrowth[WEEKS - 1 - weeksAgo]++;
    }
    threads.push({
      tag, name: displayNames.get(tag) || titleCase(tag), color: colorForTag(tag),
      clipCount: rows.length, weeklyGrowth, sampleQuotes: rows.slice(0, 3).map((r) => r.title),
    });
  }
  return threads.sort((a, b) => b.clipCount - a.clipCount);
}

export async function renameThread(db: D1Database, tag: string, name: string): Promise<void> {
  await db
    .prepare(`INSERT INTO thread_meta (tag, display_name, created_at) VALUES (?, ?, ?)
              ON CONFLICT(tag) DO UPDATE SET display_name = excluded.display_name`)
    .bind(tag, name, Date.now())
    .run();
}

/** Reassigns every clip_tags/essay_threads row from `fromTag` to `intoTag`.
 *  Both tables key on (owner_id, tag) — a clip/essay already carrying BOTH
 *  tags would collide on a plain UPDATE, so this inserts-or-ignores the new
 *  tag first, then drops every row still on the old one. */
export async function mergeThreads(db: D1Database, fromTag: string, intoTag: string): Promise<void> {
  if (fromTag === intoTag) return;
  const [{ results: clipRows }, { results: essayRows }] = await Promise.all([
    db.prepare(`SELECT clip_id FROM clip_tags WHERE tag = ?`).bind(fromTag).all<{ clip_id: string }>(),
    db.prepare(`SELECT essay_id FROM essay_threads WHERE tag = ?`).bind(fromTag).all<{ essay_id: string }>(),
  ]);
  const statements = [
    ...(clipRows ?? []).map((r) => db.prepare(`INSERT OR IGNORE INTO clip_tags (clip_id, tag) VALUES (?, ?)`).bind(r.clip_id, intoTag)),
    ...(essayRows ?? []).map((r) => db.prepare(`INSERT OR IGNORE INTO essay_threads (essay_id, tag) VALUES (?, ?)`).bind(r.essay_id, intoTag)),
    db.prepare(`DELETE FROM clip_tags WHERE tag = ?`).bind(fromTag),
    db.prepare(`DELETE FROM essay_threads WHERE tag = ?`).bind(fromTag),
    db.prepare(`DELETE FROM thread_meta WHERE tag = ?`).bind(fromTag),
  ];
  await db.batch(statements);
}
