/**
 * Aldershot — Worker entry (v0).
 * Serves the console (static assets in public/) and the /api surface.
 * Heavy work is synchronous in v0; Workflows orchestration comes later.
 */
import { Hono } from "hono";
import { getContainer } from "@cloudflare/containers";
import type { Env } from "./env";
import { runShot, narrate, type ShotSpec } from "./pipeline/compiler";
import { transcribeUpload, transcribeAudio } from "./transcript/transcribe";
import { keptRanges, totalSeconds, ffmpegSelect, type Word, type Timeline } from "./transcript/edl";
import {
  ensureSchema,
  createProject,
  listProjects,
  getProject,
  addVideo,
  listVideos,
  getVideo,
  setVideoStatus,
} from "./db";
import { videoSourceKey, transcriptKey, timelineKey, shortsKey, pickExt } from "./keys";
import { arrangeTimeline, suggestShorts, type VideoTranscript } from "./pipeline/reason";

export { RenderContainer } from "./render";

async function readJson<T>(bucket: R2Bucket, key: string): Promise<T | null> {
  const obj = await bucket.get(key);
  return obj ? await obj.json<T>() : null;
}

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ app: "aldershot", status: "ok", phase: "v0" }));

// Stream a stored object (uploads + rendered cuts) back to the browser, with
// HTTP range support so <video> can seek/scrub the result.
app.get("/api/media/*", async (c) => {
  const key = decodeURIComponent(c.req.path.slice("/api/media/".length));
  if (!key) return c.json({ error: "missing media key" }, 400);

  const rangeHeader = c.req.header("range");
  let r2Range: R2Range | undefined;
  const m = rangeHeader ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim()) : null;
  if (m) {
    const start = m[1] ? parseInt(m[1], 10) : undefined;
    const end = m[2] ? parseInt(m[2], 10) : undefined;
    if (start !== undefined && end !== undefined) r2Range = { offset: start, length: end - start + 1 };
    else if (start !== undefined) r2Range = { offset: start };
    else if (end !== undefined) r2Range = { suffix: end };
  }

  const obj = await c.env.MEDIA.get(key, r2Range ? { range: r2Range } : undefined);
  if (!obj) return c.json({ error: `not found in R2: ${key}` }, 404);

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("accept-ranges", "bytes");
  if (!headers.has("content-type")) headers.set("content-type", "application/octet-stream");

  if (r2Range) {
    const start = "suffix" in r2Range ? obj.size - r2Range.suffix : r2Range.offset ?? 0;
    const end = "length" in r2Range && r2Range.length !== undefined ? start + r2Range.length - 1 : obj.size - 1;
    headers.set("content-range", `bytes ${start}-${end}/${obj.size}`);
    headers.set("content-length", String(end - start + 1));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set("content-length", String(obj.size));
  return new Response(obj.body, { status: 200, headers });
});

// ── Projects ─────────────────────────────────────────────────────────
// A project holds multiple videos that get transcribed, arranged into a
// long-form cut, and mined for shorts.
app.post("/api/projects", async (c) => {
  await ensureSchema(c.env.DB);
  const body = await c.req.json<{ name?: string }>().catch(() => ({}) as { name?: string });
  const project = await createProject(c.env.DB, body.name?.trim() || "Untitled project");
  return c.json(project, 201);
});

app.get("/api/projects", async (c) => {
  await ensureSchema(c.env.DB);
  return c.json({ projects: await listProjects(c.env.DB) });
});

app.get("/api/projects/:id", async (c) => {
  await ensureSchema(c.env.DB);
  const id = c.req.param("id");
  const project = await getProject(c.env.DB, id);
  if (!project) return c.json({ error: "project not found" }, 404);

  const videos = await listVideos(c.env.DB, id);
  const withWords = await Promise.all(
    videos.map(async (v) => ({
      ...v,
      words: v.status === "ready" ? await readJson(c.env.MEDIA, transcriptKey(id, v.id)) : null,
    })),
  );
  const timeline = await readJson<Timeline>(c.env.MEDIA, timelineKey(id));
  const shorts = await readJson(c.env.MEDIA, shortsKey(id));
  return c.json({ project, videos: withWords, timeline, shorts });
});

// Persist the manually-edited / arranged long-form timeline.
app.put("/api/projects/:id/timeline", async (c) => {
  await ensureSchema(c.env.DB);
  const id = c.req.param("id");
  if (!(await getProject(c.env.DB, id))) return c.json({ error: "project not found" }, 404);
  const timeline = await c.req.json<Timeline>();
  await c.env.MEDIA.put(timelineKey(id), JSON.stringify(timeline), {
    httpMetadata: { contentType: "application/json" },
  });
  return c.json({ ok: true });
});

// Upload one video into a project. Body = raw bytes; x-filename / x-duration headers.
app.post("/api/projects/:id/videos", async (c) => {
  await ensureSchema(c.env.DB);
  const pid = c.req.param("id");
  if (!(await getProject(c.env.DB, pid))) return c.json({ error: "project not found" }, 404);

  const filename = c.req.header("x-filename") || "video";
  const contentType = c.req.header("content-type") || "application/octet-stream";
  const duration = Number(c.req.header("x-duration")) || null;
  const vid = crypto.randomUUID();
  const key = videoSourceKey(pid, vid, pickExt(filename, contentType));

  const body = c.req.raw.body;
  if (!body) return c.json({ error: "empty upload" }, 400);
  await c.env.MEDIA.put(key, body, { httpMetadata: { contentType } });
  const ord = (await listVideos(c.env.DB, pid)).length;
  const video = await addVideo(c.env.DB, {
    id: vid,
    project_id: pid,
    filename,
    r2_key: key,
    duration,
    ord,
  });
  return c.json(video, 201);
});

// Transcribe a video. Body = client-extracted audio bytes (mono 16kHz).
app.post("/api/videos/:id/transcribe", async (c) => {
  await ensureSchema(c.env.DB);
  const vid = c.req.param("id");
  const video = await getVideo(c.env.DB, vid);
  if (!video) return c.json({ error: "video not found" }, 404);

  await setVideoStatus(c.env.DB, vid, "transcribing");
  try {
    const words = await transcribeAudio(c.env, await c.req.arrayBuffer());
    await c.env.MEDIA.put(transcriptKey(video.project_id, vid), JSON.stringify(words), {
      httpMetadata: { contentType: "application/json" },
    });
    await setVideoStatus(c.env.DB, vid, "ready");
    return c.json({ videoId: vid, words });
  } catch (err) {
    await setVideoStatus(c.env.DB, vid, "failed");
    return c.json({ error: `transcribe failed: ${err}` }, 500);
  }
});

// Gather a project's transcribed videos (id + words) for the reasoning steps.
async function readyTranscripts(c: { env: Env }, pid: string): Promise<VideoTranscript[]> {
  const videos = await listVideos(c.env.DB, pid);
  const out: VideoTranscript[] = [];
  for (const v of videos) {
    if (v.status !== "ready") continue;
    const words = await readJson<Word[]>(c.env.MEDIA, transcriptKey(pid, v.id));
    if (words?.length) out.push({ id: v.id, filename: v.filename, words });
  }
  return out;
}

// AI narrative arrange: analyse transcripts → ordered long-form Timeline.
app.post("/api/projects/:id/arrange", async (c) => {
  await ensureSchema(c.env.DB);
  const id = c.req.param("id");
  if (!(await getProject(c.env.DB, id))) return c.json({ error: "project not found" }, 404);
  const ready = await readyTranscripts(c, id);
  if (!ready.length) return c.json({ error: "no transcribed videos to arrange yet" }, 400);
  try {
    const timeline = await arrangeTimeline(c.env, ready);
    await c.env.MEDIA.put(timelineKey(id), JSON.stringify(timeline), {
      httpMetadata: { contentType: "application/json" },
    });
    return c.json({ timeline });
  } catch (err) {
    return c.json({ error: `arrange failed: ${err}` }, 502);
  }
});

// Opus-Clip-style: suggest self-contained shorts across the project's videos.
app.post("/api/projects/:id/shorts", async (c) => {
  await ensureSchema(c.env.DB);
  const id = c.req.param("id");
  if (!(await getProject(c.env.DB, id))) return c.json({ error: "project not found" }, 404);
  const ready = await readyTranscripts(c, id);
  if (!ready.length) return c.json({ error: "no transcribed videos to mine yet" }, 400);
  try {
    const shorts = await suggestShorts(c.env, ready);
    await c.env.MEDIA.put(shortsKey(id), JSON.stringify(shorts), {
      httpMetadata: { contentType: "application/json" },
    });
    return c.json({ shorts });
  } catch (err) {
    return c.json({ error: `shorts failed: ${err}` }, 502);
  }
});

// Persist edited words (deleted flags) for a video — the manual cut state.
app.put("/api/videos/:id/transcript", async (c) => {
  await ensureSchema(c.env.DB);
  const vid = c.req.param("id");
  const video = await getVideo(c.env.DB, vid);
  if (!video) return c.json({ error: "video not found" }, 404);
  const words = await c.req.json<Word[]>();
  await c.env.MEDIA.put(transcriptKey(video.project_id, vid), JSON.stringify(words), {
    httpMetadata: { contentType: "application/json" },
  });
  return c.json({ ok: true, count: words.length });
});

// ── Transcript Editor (legacy single-file) ───────────────────────────
// Upload audio/video -> R2 + Whisper -> word-level transcript.
app.post("/api/transcribe", async (c) => {
  const contentType = c.req.header("content-type") ?? "application/octet-stream";
  const bytes = await c.req.arrayBuffer();
  return c.json(await transcribeUpload(c.env, bytes, contentType));
});

// Render the cut: pull the source from R2, hand bytes + EDL to the ffmpeg
// container, stream the resulting MP4 back into R2.
app.post("/api/export", async (c) => {
  const { mediaKey, words } = await c.req.json<{ mediaKey: string; words: Word[] }>();
  const ranges = keptRanges(words);
  const keptSeconds = totalSeconds(ranges);
  if (!ranges.length) return c.json({ error: "nothing kept to render" }, 400);

  const src = await c.env.MEDIA.get(mediaKey);
  if (!src) return c.json({ error: `media not found in R2: ${mediaKey}` }, 404);

  // One container instance per source — reused across re-exports of the same media.
  const render = getContainer(c.env.RENDER, mediaKey);
  const cut = await render.fetch("https://render/cut", {
    method: "POST",
    headers: { "content-type": "application/octet-stream", "x-ranges": JSON.stringify(ranges) },
    body: src.body,
  });
  if (!cut.ok) {
    return c.json({ error: "render failed", detail: await cut.text(), ffmpeg: ffmpegSelect(ranges) }, 502);
  }

  const stem = mediaKey.split("/").pop()!.replace(/\.[^.]+$/, "");
  const outputKey = `cuts/${stem}-${Date.now()}.mp4`;
  await c.env.MEDIA.put(outputKey, cut.body, { httpMetadata: { contentType: "video/mp4" } });

  return c.json({ mediaKey, outputKey, ranges, keptSeconds, status: "rendered" });
});

// ── Studio (v0 spine) ────────────────────────────────────────────────
app.post("/api/shot", async (c) => {
  const spec = await c.req.json<ShotSpec>();
  const shotId = crypto.randomUUID();
  return c.json({ shotId, ...(await runShot(c.env, shotId, spec)) });
});

app.post("/api/narrate", async (c) => {
  const { text } = await c.req.json<{ text: string }>();
  const beatId = crypto.randomUUID();
  return c.json({ beatId, key: await narrate(c.env, beatId, text) });
});

export default app;
