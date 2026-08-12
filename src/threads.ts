/**
 * Threads — the analytics/ranking surface: per-thread clip counts, growth
 * trend, color coding (see the design handoff's Threads view).
 *
 * Threads are derived by clustering each clip's embedding (see
 * src/embeddings.ts) — two clips about the same theme land in the same
 * thread even if they were never tagged with the same string. A cluster's
 * `id` is a stable, server-minted uuid (not a tag), kept stable across
 * recomputes by majority-voting against each cluster's previous membership
 * (see stabilizeClusterIds below) — so a rename/merge/color and any essay's
 * grounding-thread reference all survive a clip being added or re-tagged.
 *
 * A tag string remains a human-editable *hint*: clip_tags still exist (any
 * clip can carry one), and a cluster's auto-generated display name is
 * whichever tag is most common among its members — but tag equality no
 * longer defines thread membership.
 *
 * Falls back to the older exact-tag-equality grouping whenever VECTORIZE
 * isn't configured yet, or no clip has been embedded yet — see env.ts and
 * src/embeddings.ts for why that binding is optional. Per the design brief's
 * "auto-detected only, rename/merge only" rule: nothing here ever lets a
 * user manually create a thread.
 */
import type { Env } from "./env";

const PALETTE = [
  "#8fbf7f", "#d48a7b", "#7ba7d4", "#c9a86a", "#a889c9",
  "#6fb8a8", "#c97f9e", "#9fae6a", "#7f9bd4", "#d4a37b",
];
/** Deterministic so a thread's color never changes between requests, and so
 *  the client can compute the same color for a cluster id without a round
 *  trip (see public/app.js's identical colorForCluster). Works on any
 *  string, tag or cluster id alike — only the caller's semantics changed. */
function colorForString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

const titleCase = (t: string) => t.replace(/\b\w/g, (c) => c.toUpperCase());
const WEEK_MS = 7 * 24 * 3600 * 1000;
const WEEKS = 8;
/** Two clips are "the same theme" above this cosine-similarity score. Tuned
 *  loose-ish on purpose — a thread that's slightly too broad is a one-click
 *  rename/merge away from right; one that never forms because the bar was
 *  too strict just looks like the feature doesn't work. */
const SIMILARITY_THRESHOLD = 0.72;
const TOPK = 10;
/** A near-miss is a clip that scored in this band against a thread — close
 *  enough to be a real suggestion, not so close it should've just auto-joined
 *  (that's SIMILARITY_THRESHOLD's job). Surfaced as a "suggested addition"
 *  card the user accepts or dismisses, rather than silently auto-joining. */
const NEAR_MISS_FLOOR = 0.55;

export interface ThreadSummary {
  id: string;
  name: string;
  color: string;
  clipCount: number;
  /** Clips created per week, oldest (index 0) to most recent (last index). */
  weeklyGrowth: number[];
  sampleQuotes: string[];
}

export async function ensureThreadSchema(db: D1Database): Promise<void> {
  await db.batch([
    // Legacy, tag-identity thread naming — kept only so a rename made before
    // the clustering switch can be migrated forward (see migrateLegacyTags).
    db.prepare(
      `CREATE TABLE IF NOT EXISTS thread_meta (
         tag TEXT PRIMARY KEY,
         display_name TEXT,
         created_at INTEGER NOT NULL
       )`,
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS thread_clusters (
         id TEXT PRIMARY KEY,
         display_name TEXT,
         created_at INTEGER NOT NULL
       )`,
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS clip_clusters (
         clip_id TEXT PRIMARY KEY,
         cluster_id TEXT NOT NULL
       )`,
    ),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_clip_clusters_cluster ON clip_clusters (cluster_id)`),
    // A human "Add to thread" verdict on a near-miss suggestion — recomputeClusters
    // applies these after the natural union-find pass, so accepting one survives
    // the next recompute instead of being silently reassigned back.
    db.prepare(
      `CREATE TABLE IF NOT EXISTS clip_cluster_overrides (
         clip_id TEXT PRIMARY KEY,
         cluster_id TEXT NOT NULL
       )`,
    ),
    // A "Not related" verdict — the near-miss feedback signal. Scoped to the
    // pair, not the clip generally: dismissing a clip's near-miss suggestion
    // for thread A says nothing about whether it's a near-miss for thread B.
    db.prepare(
      `CREATE TABLE IF NOT EXISTS thread_nearmiss_dismissed (
         thread_id TEXT NOT NULL,
         clip_id TEXT NOT NULL,
         dismissed_at INTEGER NOT NULL,
         PRIMARY KEY (thread_id, clip_id)
       )`,
    ),
  ]);
}

async function tagsForClips(db: D1Database, clipIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (!clipIds.length) return map;
  const ids = [...new Set(clipIds)];
  const placeholders = ids.map(() => "?").join(",");
  const { results } = await db
    .prepare(`SELECT clip_id, tag FROM clip_tags WHERE clip_id IN (${placeholders})`)
    .bind(...ids)
    .all<{ clip_id: string; tag: string }>();
  for (const r of results ?? []) map.set(r.clip_id, [...(map.get(r.clip_id) ?? []), r.tag]);
  return map;
}

// ── union-find, plain and small — this runs over a personal clip library
// (dozens to low hundreds of clips), not a web-scale corpus, so an O(n) pass
// of Vectorize queries with no batching is the right amount of engineering. ──
function makeUnionFind(ids: string[]) {
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (x: string): string => {
    while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x)!)!); x = parent.get(x)!; }
    return x;
  };
  const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  return { find, union };
}

/** Re-derive cluster membership from Vectorize similarity and persist it.
 *  Returns false (do nothing further — caller falls back to tag-equality)
 *  when VECTORIZE isn't configured or no clip has an embedding yet. */
async function recomputeClusters(env: Env, db: D1Database): Promise<boolean> {
  if (!env.VECTORIZE) return false;
  const { results: clipRows } = await db.prepare(`SELECT id FROM clips`).all<{ id: string }>();
  const clipIds = (clipRows ?? []).map((r) => r.id);
  if (!clipIds.length) return false;

  const { find, union } = makeUnionFind(clipIds);
  let anyEmbedded = false;
  for (const id of clipIds) {
    let vectors;
    try {
      vectors = await env.VECTORIZE.getByIds([id]);
    } catch (err) {
      console.error("[threads] Vectorize getByIds failed:", err);
      continue;
    }
    const vector = vectors[0];
    if (!vector) continue; // not embedded yet (e.g. saved before Vectorize was configured)
    anyEmbedded = true;
    const { matches } = await env.VECTORIZE.query(vector.values, { topK: TOPK });
    for (const m of matches) if (m.id !== id && m.score >= SIMILARITY_THRESHOLD) union(id, m.id);
  }
  if (!anyEmbedded) return false;

  const groups = new Map<string, string[]>();
  for (const id of clipIds) {
    const root = find(id);
    groups.set(root, [...(groups.get(root) ?? []), id]);
  }

  // Stabilize: reuse whichever existing cluster id already covers the most
  // members of each newly-computed group, so a cluster's identity (and thus
  // its color/rename/essay references) survives a new clip joining it.
  const { results: existingRows } = await db.prepare(`SELECT clip_id, cluster_id FROM clip_clusters`).all<{ clip_id: string; cluster_id: string }>();
  const existingByClip = new Map((existingRows ?? []).map((r) => [r.clip_id, r.cluster_id]));

  const clusterOf = new Map<string, string>();
  const newClusterIds = new Set<string>();
  const statements: D1PreparedStatement[] = [db.prepare(`DELETE FROM clip_clusters`)];
  for (const members of groups.values()) {
    const votes = new Map<string, number>();
    for (const m of members) {
      const old = existingByClip.get(m);
      if (old) votes.set(old, (votes.get(old) ?? 0) + 1);
    }
    let clusterId = "", best = 0;
    for (const [id, count] of votes) if (count > best) { best = count; clusterId = id; }
    if (!clusterId) clusterId = crypto.randomUUID();
    newClusterIds.add(clusterId);
    statements.push(db.prepare(`INSERT OR IGNORE INTO thread_clusters (id, display_name, created_at) VALUES (?, NULL, ?)`).bind(clusterId, Date.now()));
    for (const m of members) clusterOf.set(m, clusterId);
  }

  // A "Add to thread" verdict on a near-miss suggestion overrides the
  // natural embedding-distance result for that one clip, every recompute —
  // otherwise the very next pass would just put it right back where it was.
  const { results: overrideRows } = await db.prepare(`SELECT clip_id, cluster_id FROM clip_cluster_overrides`).all<{ clip_id: string; cluster_id: string }>();
  for (const o of overrideRows ?? []) {
    if (clusterOf.has(o.clip_id) && newClusterIds.has(o.cluster_id)) clusterOf.set(o.clip_id, o.cluster_id);
  }

  for (const [clipId, clusterId] of clusterOf) {
    statements.push(db.prepare(`INSERT INTO clip_clusters (clip_id, cluster_id) VALUES (?, ?)`).bind(clipId, clusterId));
  }
  await db.batch(statements);
  await migrateLegacyTags(db, clusterOf);
  return true;
}

/** One-time-per-tag forward migration: before clustering existed, a thread's
 *  stable id WAS its normalized tag string, and essay_threads/thread_meta
 *  reference that string directly. Once a tag's clips have real cluster
 *  membership, remap any essay_threads row (and any custom rename) still
 *  pointing at the raw tag onto whichever cluster actually absorbed those
 *  clips — otherwise a pre-existing essay's grounding-thread reference, or a
 *  rename made before this switch, would silently orphan. Idempotent: a tag
 *  with nothing left referencing it is a no-op every subsequent call. */
async function migrateLegacyTags(db: D1Database, clusterOf: Map<string, string>): Promise<void> {
  const { results: essayThreadRows } = await db.prepare(`SELECT DISTINCT tag FROM essay_threads`).all<{ tag: string }>();
  const { results: clusterIdRows } = await db.prepare(`SELECT id FROM thread_clusters`).all<{ id: string }>();
  const knownClusterIds = new Set((clusterIdRows ?? []).map((r) => r.id));
  const legacyTags = (essayThreadRows ?? []).map((r) => r.tag).filter((t) => !knownClusterIds.has(t));
  if (!legacyTags.length) return;

  for (const legacyTag of legacyTags) {
    const { results: taggedClips } = await db.prepare(`SELECT clip_id FROM clip_tags WHERE tag = ?`).bind(legacyTag).all<{ clip_id: string }>();
    const votes = new Map<string, number>();
    for (const r of taggedClips ?? []) {
      const cid = clusterOf.get(r.clip_id);
      if (cid) votes.set(cid, (votes.get(cid) ?? 0) + 1);
    }
    let target = "", best = 0;
    for (const [cid, count] of votes) if (count > best) { best = count; target = cid; }
    if (!target) continue; // this tag's clips aren't embedded/clustered yet — try again next call

    const { results: essayRows } = await db.prepare(`SELECT essay_id FROM essay_threads WHERE tag = ?`).bind(legacyTag).all<{ essay_id: string }>();
    const oldMeta = await db.prepare(`SELECT display_name FROM thread_meta WHERE tag = ?`).bind(legacyTag).first<{ display_name: string | null }>();
    const statements = [
      ...(essayRows ?? []).map((r) => db.prepare(`INSERT OR IGNORE INTO essay_threads (essay_id, tag) VALUES (?, ?)`).bind(r.essay_id, target)),
      db.prepare(`DELETE FROM essay_threads WHERE tag = ?`).bind(legacyTag),
    ];
    if (oldMeta?.display_name) {
      statements.push(
        db.prepare(
          `INSERT INTO thread_clusters (id, display_name, created_at) VALUES (?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET display_name = COALESCE(thread_clusters.display_name, excluded.display_name)`,
        ).bind(target, oldMeta.display_name, Date.now()),
      );
    }
    await db.batch(statements);
  }
}

async function listThreadsByCluster(db: D1Database): Promise<ThreadSummary[]> {
  const { results: memberRows } = await db
    .prepare(
      `SELECT cc.cluster_id, cc.clip_id, c.title, c.created_at
       FROM clip_clusters cc JOIN clips c ON c.id = cc.clip_id
       ORDER BY cc.cluster_id, c.created_at DESC`,
    )
    .all<{ cluster_id: string; clip_id: string; title: string; created_at: number }>();
  const { results: clusterMeta } = await db.prepare(`SELECT id, display_name FROM thread_clusters`).all<{ id: string; display_name: string | null }>();
  const displayNames = new Map((clusterMeta ?? []).map((r) => [r.id, r.display_name]));

  const byCluster = new Map<string, { clip_id: string; title: string; created_at: number }[]>();
  for (const r of memberRows ?? []) byCluster.set(r.cluster_id, [...(byCluster.get(r.cluster_id) ?? []), r]);
  const tagsByClip = await tagsForClips(db, (memberRows ?? []).map((r) => r.clip_id));

  const now = Date.now();
  const threads: ThreadSummary[] = [];
  for (const [clusterId, rows] of byCluster) {
    const weeklyGrowth = new Array(WEEKS).fill(0);
    for (const r of rows) {
      const weeksAgo = Math.floor((now - r.created_at) / WEEK_MS);
      if (weeksAgo >= 0 && weeksAgo < WEEKS) weeklyGrowth[WEEKS - 1 - weeksAgo]++;
    }
    // Auto-generated name: whichever tag is most common among this cluster's
    // clips (tags remain the human-editable seed label per the design brief),
    // falling back to the newest clip's own title if nothing's tagged.
    const tagCounts = new Map<string, number>();
    for (const r of rows) for (const t of tagsByClip.get(r.clip_id) ?? []) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    let seedTag = "", seedCount = 0;
    for (const [t, count] of tagCounts) if (count > seedCount) { seedCount = count; seedTag = t; }
    threads.push({
      id: clusterId,
      name: displayNames.get(clusterId) || (seedTag ? titleCase(seedTag) : titleCase(rows[0].title)),
      color: colorForString(clusterId),
      clipCount: rows.length,
      weeklyGrowth,
      sampleQuotes: rows.slice(0, 3).map((r) => r.title),
    });
  }
  return threads.sort((a, b) => b.clipCount - a.clipCount);
}

/** Original v1 behavior — an exact-tag-string IS the thread. Used as a
 *  fallback until Vectorize is configured and at least one clip is
 *  embedded (see recomputeClusters). */
async function listThreadsByTag(db: D1Database): Promise<ThreadSummary[]> {
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
      id: tag, name: displayNames.get(tag) || titleCase(tag), color: colorForString(tag),
      clipCount: rows.length, weeklyGrowth, sampleQuotes: rows.slice(0, 3).map((r) => r.title),
    });
  }
  return threads.sort((a, b) => b.clipCount - a.clipCount);
}

export async function listThreads(env: Env, db: D1Database): Promise<ThreadSummary[]> {
  const clustered = await recomputeClusters(env, db);
  return clustered ? listThreadsByCluster(db) : listThreadsByTag(db);
}

/** Per-clip thread membership — clusters when Vectorize clustering is live,
 *  falling back to each clip's first tag (matching listThreadsByTag's own
 *  grouping key) otherwise. Used to group the Archive by thread without
 *  re-deriving membership logic client-side. */
export async function clipThreadMap(env: Env, db: D1Database): Promise<Map<string, { id: string; name: string; color: string }>> {
  const threads = await listThreads(env, db);
  const byId = new Map(threads.map((t) => [t.id, t]));
  const map = new Map<string, { id: string; name: string; color: string }>();

  const { results: clusterRows } = await db.prepare(`SELECT clip_id, cluster_id FROM clip_clusters`).all<{ clip_id: string; cluster_id: string }>();
  if (clusterRows?.length) {
    for (const r of clusterRows) {
      const t = byId.get(r.cluster_id);
      if (t) map.set(r.clip_id, { id: t.id, name: t.name, color: t.color });
    }
    return map;
  }

  const { results: tagRows } = await db.prepare(`SELECT clip_id, tag FROM clip_tags ORDER BY clip_id, tag ASC`).all<{ clip_id: string; tag: string }>();
  const firstTagByClip = new Map<string, string>();
  for (const r of tagRows ?? []) if (!firstTagByClip.has(r.clip_id)) firstTagByClip.set(r.clip_id, r.tag);
  for (const [clipId, tag] of firstTagByClip) {
    const t = byId.get(tag);
    if (t) map.set(clipId, { id: t.id, name: t.name, color: t.color });
  }
  return map;
}

export interface NearMiss {
  clipId: string;
  quote: string;
  score: number; // 0-100, a % match label
}

/** The single best "almost joined this thread" suggestion, if any — a real
 *  clip scoring just under the auto-join threshold against a representative
 *  member's embedding. Not auto-added: surfaced as a suggestion the user
 *  accepts (see acceptNearMiss) or dismisses (see dismissNearMiss), same
 *  "auto-detected only, human verdict required" discipline as the rest of
 *  Threads. Returns null with no Vectorize configured, same graceful
 *  degrade as recomputeClusters. */
export async function getNearMissForThread(env: Env, db: D1Database, threadId: string): Promise<NearMiss | null> {
  if (!env.VECTORIZE) return null;
  const rep = await db
    .prepare(`SELECT cc.clip_id FROM clip_clusters cc JOIN clips c ON c.id = cc.clip_id WHERE cc.cluster_id = ? ORDER BY c.created_at DESC LIMIT 1`)
    .bind(threadId)
    .first<{ clip_id: string }>();
  if (!rep) return null;

  let vectors;
  try {
    vectors = await env.VECTORIZE.getByIds([rep.clip_id]);
  } catch (err) {
    console.error("[threads] near-miss getByIds failed:", err);
    return null;
  }
  const vector = vectors[0];
  if (!vector) return null;

  const [{ matches }, memberRows, dismissedRows] = await Promise.all([
    env.VECTORIZE.query(vector.values, { topK: TOPK + 5 }),
    db.prepare(`SELECT clip_id FROM clip_clusters WHERE cluster_id = ?`).bind(threadId).all<{ clip_id: string }>(),
    db.prepare(`SELECT clip_id FROM thread_nearmiss_dismissed WHERE thread_id = ?`).bind(threadId).all<{ clip_id: string }>(),
  ]);
  const memberIds = new Set((memberRows.results ?? []).map((r) => r.clip_id));
  const dismissed = new Set((dismissedRows.results ?? []).map((r) => r.clip_id));
  const candidate = matches
    .sort((a, b) => b.score - a.score)
    .find((m) => m.score >= NEAR_MISS_FLOOR && m.score < SIMILARITY_THRESHOLD && !memberIds.has(m.id) && !dismissed.has(m.id));
  if (!candidate) return null;

  const clip = await db.prepare(`SELECT title FROM clips WHERE id = ?`).bind(candidate.id).first<{ title: string }>();
  if (!clip) return null;
  return { clipId: candidate.id, quote: clip.title, score: Math.round(candidate.score * 100) };
}

/** "Add to thread" — forces this one clip into this thread from now on,
 *  surviving the next recompute (see recomputeClusters' override pass). */
export async function acceptNearMiss(db: D1Database, threadId: string, clipId: string): Promise<void> {
  await db
    .prepare(`INSERT INTO clip_cluster_overrides (clip_id, cluster_id) VALUES (?, ?) ON CONFLICT(clip_id) DO UPDATE SET cluster_id = excluded.cluster_id`)
    .bind(clipId, threadId)
    .run();
  await db.prepare(`DELETE FROM thread_nearmiss_dismissed WHERE thread_id = ? AND clip_id = ?`).bind(threadId, clipId).run();
}

/** "Not related" — the near-miss feedback signal: this specific pairing
 *  won't be suggested again. */
export async function dismissNearMiss(db: D1Database, threadId: string, clipId: string): Promise<void> {
  await db
    .prepare(`INSERT OR IGNORE INTO thread_nearmiss_dismissed (thread_id, clip_id, dismissed_at) VALUES (?, ?, ?)`)
    .bind(threadId, clipId, Date.now())
    .run();
}

export async function renameThread(db: D1Database, id: string, name: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO thread_clusters (id, display_name, created_at) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name`,
    )
    .bind(id, name, Date.now())
    .run();
  // Also write the legacy table — a rename issued while still on the
  // tag-equality fallback (no clip embedded yet) needs to land there instead,
  // and migrateLegacyTags() picks it up once clustering does kick in.
  await db
    .prepare(
      `INSERT INTO thread_meta (tag, display_name, created_at) VALUES (?, ?, ?)
       ON CONFLICT(tag) DO UPDATE SET display_name = excluded.display_name`,
    )
    .bind(id, name, Date.now())
    .run();
}

/** Reassigns every clip_tags/clip_clusters/essay_threads row from `fromId`
 *  to `intoId`. Both essay_threads and clip_tags key on (owner, tag/id) — a
 *  clip/essay already carrying BOTH ids would collide on a plain UPDATE, so
 *  this inserts-or-ignores the new id first, then drops every row still on
 *  the old one. */
export async function mergeThreads(db: D1Database, fromId: string, intoId: string): Promise<void> {
  if (fromId === intoId) return;
  const [{ results: clipRows }, { results: clusterRows }, { results: essayRows }] = await Promise.all([
    db.prepare(`SELECT clip_id FROM clip_tags WHERE tag = ?`).bind(fromId).all<{ clip_id: string }>(),
    db.prepare(`SELECT clip_id FROM clip_clusters WHERE cluster_id = ?`).bind(fromId).all<{ clip_id: string }>(),
    db.prepare(`SELECT essay_id FROM essay_threads WHERE tag = ?`).bind(fromId).all<{ essay_id: string }>(),
  ]);
  const statements = [
    ...(clipRows ?? []).map((r) => db.prepare(`INSERT OR IGNORE INTO clip_tags (clip_id, tag) VALUES (?, ?)`).bind(r.clip_id, intoId)),
    ...(essayRows ?? []).map((r) => db.prepare(`INSERT OR IGNORE INTO essay_threads (essay_id, tag) VALUES (?, ?)`).bind(r.essay_id, intoId)),
    ...(clusterRows ?? []).map((r) => db.prepare(`UPDATE clip_clusters SET cluster_id = ? WHERE clip_id = ?`).bind(intoId, r.clip_id)),
    db.prepare(`DELETE FROM clip_tags WHERE tag = ?`).bind(fromId),
    db.prepare(`DELETE FROM essay_threads WHERE tag = ?`).bind(fromId),
    db.prepare(`DELETE FROM thread_meta WHERE tag = ?`).bind(fromId),
    db.prepare(`DELETE FROM thread_clusters WHERE id = ?`).bind(fromId),
  ];
  await db.batch(statements);
}
