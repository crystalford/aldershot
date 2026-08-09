/**
 * Visual tags — what's on screen at a moment in a video (a caption plus any
 * on-screen text), computed via Moondream 3.1 against keyframes and stored
 * as siblings to that video's spoken transcript rather than owned by any one
 * clip. See migrations/0003_visual_tags.sql.
 */

export interface VisualTag {
  id: string;
  videoId: string;
  projectId: string;
  time: number;
  caption: string | null;
  ocrText: string | null;
  createdAt: number;
}

/** Create the table if absent. Idempotent, same pattern as db.ts/clips.ts. */
export async function ensureVisualTagSchema(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS visual_tags (
         id TEXT PRIMARY KEY,
         video_id TEXT NOT NULL,
         project_id TEXT NOT NULL,
         "time" REAL NOT NULL,
         caption TEXT,
         ocr_text TEXT,
         created_at INTEGER NOT NULL
       )`,
    ),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_visual_tags_video ON visual_tags (video_id, "time")`),
  ]);
}

export async function createVisualTag(
  db: D1Database,
  userId: string,
  input: { videoId: string; projectId: string; time: number; caption?: string | null; ocrText?: string | null },
): Promise<VisualTag> {
  const tag: VisualTag = {
    id: crypto.randomUUID(),
    videoId: input.videoId,
    projectId: input.projectId,
    time: input.time,
    caption: input.caption?.trim() || null,
    ocrText: input.ocrText?.trim() || null,
    createdAt: Date.now(),
  };
  await db
    .prepare(
      `INSERT INTO visual_tags (id, video_id, project_id, "time", caption, ocr_text, created_at, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(tag.id, tag.videoId, tag.projectId, tag.time, tag.caption, tag.ocrText, tag.createdAt, userId)
    .run();
  return tag;
}

/** Every visual tag for a set of videos, grouped by video id — one query
 *  regardless of how many videos/segments the caller needs to resolve, so
 *  listClips()/getClip() don't N+1 per segment. Scoped to the caller's own
 *  account even though every videoId passed in already belongs to clips the
 *  caller owns — defense in depth against a future caller forgetting that. */
export async function visualTagsByVideo(
  db: D1Database,
  userId: string,
  videoIds: string[],
): Promise<Map<string, VisualTag[]>> {
  const map = new Map<string, VisualTag[]>();
  if (!videoIds.length) return map;
  const ids = [...new Set(videoIds)];
  const placeholders = ids.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      `SELECT id, video_id, project_id, "time", caption, ocr_text, created_at
       FROM visual_tags WHERE video_id IN (${placeholders}) AND user_id = ? ORDER BY video_id, "time" ASC`,
    )
    .bind(...ids, userId)
    .all<{ id: string; video_id: string; project_id: string; time: number; caption: string | null; ocr_text: string | null; created_at: number }>();
  for (const r of results ?? []) {
    const tag: VisualTag = { id: r.id, videoId: r.video_id, projectId: r.project_id, time: r.time, caption: r.caption, ocrText: r.ocr_text, createdAt: r.created_at };
    const list = map.get(r.video_id) ?? [];
    list.push(tag);
    map.set(r.video_id, list);
  }
  return map;
}
