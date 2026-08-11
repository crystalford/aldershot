/**
 * Generative — turn a script line into cinematic b-roll: one consistent
 * scene (see reason.ts's draftSceneShots), 1-4 shots, each staged through
 * Generate image -> Animate to video -> Save. A saved shot becomes a real
 * Archive clip, exactly like one cut from real footage (see db.ts's
 * getOrCreateGenerativeProject — a generated clip still needs a real
 * `videos` row to hang a clip's segment off of).
 */
import type { Env } from "./env";
import { generateStill, animate } from "./pipeline/compiler";
import { draftSceneShots, type SceneDraft } from "./pipeline/reason";
import { addVideo, getOrCreateGenerativeProject } from "./db";
import { createClip, type ClipDetail } from "./clips";

export type ShotStatus = "idle" | "image_generating" | "image_ready" | "video_generating" | "video_ready" | "saved" | "failed";
export type Aspect = "16:9" | "9:16" | "1:1";
const ASPECTS: Aspect[] = ["16:9", "9:16", "1:1"];
export const isAspect = (a: unknown): a is Aspect => ASPECTS.includes(a as Aspect);

export interface Scene {
  id: string;
  line: string;
  location: string;
  light: string;
  palette: string;
  cutCount: number;
  aspect: Aspect;
  durationSeconds: number;
  createdAt: number;
}
export interface Shot {
  id: string;
  sceneId: string;
  ord: number;
  type: string;
  description: string;
  weight: string;
  motion: string;
  status: ShotStatus;
  imageR2Key: string | null;
  videoR2Key: string | null;
  clipId: string | null;
  error: string | null;
  createdAt: number;
}
export interface SceneDetail extends Scene {
  shots: Shot[];
}

export async function ensureGenerativeSchema(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS generative_scenes (
         id TEXT PRIMARY KEY,
         line TEXT NOT NULL,
         location TEXT NOT NULL,
         light TEXT NOT NULL,
         palette TEXT NOT NULL,
         cut_count INTEGER NOT NULL,
         aspect TEXT NOT NULL DEFAULT '16:9',
         duration_seconds INTEGER NOT NULL DEFAULT 5,
         created_at INTEGER NOT NULL
       )`,
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS generative_shots (
         id TEXT PRIMARY KEY,
         scene_id TEXT NOT NULL,
         ord INTEGER NOT NULL,
         type TEXT NOT NULL,
         description TEXT NOT NULL,
         weight TEXT NOT NULL,
         motion TEXT NOT NULL,
         status TEXT NOT NULL DEFAULT 'idle',
         image_r2_key TEXT,
         video_r2_key TEXT,
         clip_id TEXT,
         error TEXT,
         created_at INTEGER NOT NULL
       )`,
    ),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_generative_shots_scene ON generative_shots (scene_id, ord)`),
  ]);
}

interface SceneRow {
  id: string; line: string; location: string; light: string; palette: string;
  cut_count: number; aspect: string; duration_seconds: number; created_at: number;
}
interface ShotRow {
  id: string; scene_id: string; ord: number; type: string; description: string; weight: string; motion: string;
  status: string; image_r2_key: string | null; video_r2_key: string | null; clip_id: string | null; error: string | null; created_at: number;
}
const toScene = (r: SceneRow): Scene => ({
  id: r.id, line: r.line, location: r.location, light: r.light, palette: r.palette,
  cutCount: r.cut_count, aspect: r.aspect as Aspect, durationSeconds: r.duration_seconds, createdAt: r.created_at,
});
const toShot = (r: ShotRow): Shot => ({
  id: r.id, sceneId: r.scene_id, ord: r.ord, type: r.type, description: r.description, weight: r.weight, motion: r.motion,
  status: r.status as ShotStatus, imageR2Key: r.image_r2_key, videoR2Key: r.video_r2_key, clipId: r.clip_id, error: r.error, createdAt: r.created_at,
});

export async function createScene(
  env: Env,
  db: D1Database,
  input: { line: string; cutCount: number; aspect: Aspect; durationSeconds: number },
): Promise<SceneDetail> {
  const draft: SceneDraft = await draftSceneShots(env, input.line, input.cutCount);
  const scene: Scene = {
    id: crypto.randomUUID(), line: input.line, location: draft.world.location, light: draft.world.light,
    palette: draft.world.palette, cutCount: draft.shots.length, aspect: input.aspect,
    durationSeconds: input.durationSeconds, createdAt: Date.now(),
  };
  const shots: Shot[] = draft.shots.map((s) => ({
    id: crypto.randomUUID(), sceneId: scene.id, ord: s.index, type: s.type, description: s.description,
    weight: s.weight, motion: s.motion, status: "idle", imageR2Key: null, videoR2Key: null, clipId: null,
    error: null, createdAt: Date.now(),
  }));
  await db.batch([
    db
      .prepare(`INSERT INTO generative_scenes (id, line, location, light, palette, cut_count, aspect, duration_seconds, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(scene.id, scene.line, scene.location, scene.light, scene.palette, scene.cutCount, scene.aspect, scene.durationSeconds, scene.createdAt),
    ...shots.map((s) =>
      db
        .prepare(`INSERT INTO generative_shots (id, scene_id, ord, type, description, weight, motion, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(s.id, s.sceneId, s.ord, s.type, s.description, s.weight, s.motion, s.status, s.createdAt),
    ),
  ]);
  return { ...scene, shots };
}

export async function getScene(db: D1Database, id: string): Promise<SceneDetail | null> {
  const row = await db.prepare(`SELECT * FROM generative_scenes WHERE id = ?`).bind(id).first<SceneRow>();
  if (!row) return null;
  const { results } = await db.prepare(`SELECT * FROM generative_shots WHERE scene_id = ? ORDER BY ord ASC`).bind(id).all<ShotRow>();
  return { ...toScene(row), shots: (results ?? []).map(toShot) };
}

async function getShotAndScene(db: D1Database, sceneId: string, shotId: string): Promise<{ scene: Scene; shot: Shot } | null> {
  const sceneRow = await db.prepare(`SELECT * FROM generative_scenes WHERE id = ?`).bind(sceneId).first<SceneRow>();
  const shotRow = await db.prepare(`SELECT * FROM generative_shots WHERE id = ? AND scene_id = ?`).bind(shotId, sceneId).first<ShotRow>();
  if (!sceneRow || !shotRow) return null;
  return { scene: toScene(sceneRow), shot: toShot(shotRow) };
}

async function setShotStatus(db: D1Database, shotId: string, patch: Partial<Pick<Shot, "status" | "imageR2Key" | "videoR2Key" | "clipId" | "error">>): Promise<void> {
  const fields: string[] = [];
  const params: unknown[] = [];
  if (patch.status !== undefined) { fields.push("status = ?"); params.push(patch.status); }
  if (patch.imageR2Key !== undefined) { fields.push("image_r2_key = ?"); params.push(patch.imageR2Key); }
  if (patch.videoR2Key !== undefined) { fields.push("video_r2_key = ?"); params.push(patch.videoR2Key); }
  if (patch.clipId !== undefined) { fields.push("clip_id = ?"); params.push(patch.clipId); }
  if (patch.error !== undefined) { fields.push("error = ?"); params.push(patch.error); }
  if (!fields.length) return;
  await db.prepare(`UPDATE generative_shots SET ${fields.join(", ")} WHERE id = ?`).bind(...params, shotId).run();
}

function buildStillPrompt(scene: Scene, shot: Shot): string {
  return `${shot.description} — ${shot.weight} shot. Location: ${scene.location}. Lighting: ${scene.light}. Color palette: ${scene.palette}.`;
}

export async function generateShotImage(env: Env, db: D1Database, sceneId: string, shotId: string): Promise<Shot> {
  const found = await getShotAndScene(db, sceneId, shotId);
  if (!found) throw new Error("shot not found");
  const { scene, shot } = found;
  await setShotStatus(db, shotId, { status: "image_generating", error: null });
  try {
    // Reference the scene's earliest-generated stills (if any) so this shot
    // holds the same look — the actual mechanism behind "one scene, multiple
    // cuts," not a second verification pass.
    const { results } = await db
      .prepare(`SELECT image_r2_key FROM generative_shots WHERE scene_id = ? AND image_r2_key IS NOT NULL AND id != ? ORDER BY ord ASC LIMIT 3`)
      .bind(sceneId, shotId)
      .all<{ image_r2_key: string }>();
    const referenceKeys = (results ?? []).map((r) => r.image_r2_key);
    const imageR2Key = await generateStill(env, shotId, buildStillPrompt(scene, shot), referenceKeys);
    await setShotStatus(db, shotId, { status: "image_ready", imageR2Key });
    return { ...shot, status: "image_ready", imageR2Key };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await setShotStatus(db, shotId, { status: "failed", error: message });
    throw err;
  }
}

export async function generateShotVideo(env: Env, db: D1Database, sceneId: string, shotId: string): Promise<Shot> {
  const found = await getShotAndScene(db, sceneId, shotId);
  if (!found) throw new Error("shot not found");
  const { scene, shot } = found;
  if (!shot.imageR2Key) throw new Error("generate the image first");
  await setShotStatus(db, shotId, { status: "video_generating", error: null });
  try {
    const videoR2Key = await animate(env, shotId, shot.imageR2Key, shot.motion, scene.durationSeconds, scene.aspect);
    await setShotStatus(db, shotId, { status: "video_ready", videoR2Key });
    return { ...shot, status: "video_ready", videoR2Key };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await setShotStatus(db, shotId, { status: "failed", error: message });
    throw err;
  }
}

/** Saved cuts become real Archive clips — matched to whichever threads the
 *  caller picks, exactly like a clip extracted from real footage. */
export async function saveShotToArchive(db: D1Database, sceneId: string, shotId: string, tags: string[]): Promise<ClipDetail> {
  const found = await getShotAndScene(db, sceneId, shotId);
  if (!found) throw new Error("shot not found");
  const { scene, shot } = found;
  if (!shot.videoR2Key) throw new Error("animate this shot to video first");
  const project = await getOrCreateGenerativeProject(db);
  const video = await addVideo(db, {
    id: crypto.randomUUID(), project_id: project.id, filename: `${shot.type || "shot"}-${shot.id}.mp4`,
    r2_key: shot.videoR2Key, duration: scene.durationSeconds, status: "ready", ord: 0,
  });
  const clip = await createClip(db, {
    title: shot.description.length > 80 ? shot.description.slice(0, 77) + "…" : shot.description,
    description: `Generated b-roll — ${scene.location}, ${scene.light}`,
    kind: "ai-detected",
    segments: [{ videoId: video.id, projectId: project.id, start: 0, end: scene.durationSeconds }],
    tags,
  });
  await setShotStatus(db, shotId, { status: "saved", clipId: clip.id });
  return clip;
}
