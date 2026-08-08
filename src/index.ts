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
import type { Word, Timeline, Segment } from "./transcript/edl";

export { RenderContainer } from "./render";
import {
  ensureSchema,
  createProject,
  listProjects,
  getProject,
  addVideo,
  listVideos,
  listAllReadyVideos,
  getVideo,
  setVideoStatus,
} from "./db";
import {
  ensureClipSchema,
  createClip,
  listClips,
  getClip,
  updateClip,
  deleteClip,
  listAllTags,
  type ClipKind,
  type NewClipSegment,
} from "./clips";
import { videoSourceKey, transcriptKey, timelineKey, shortsKey, suggestionsKey, jobKey, pickExt } from "./keys";
import { arrangeTimeline, directedArrange, suggestShorts, suggestEdits, type VideoTranscript } from "./pipeline/reason";
import { resolveMedia } from "./import";
import { presignPut, presignGet } from "./r2sign";
import { wrapPcm, byteOffsetForSecond, durationFromWavSize } from "./wav";

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
  const suggestions = await readJson(c.env.MEDIA, suggestionsKey(id));
  return c.json({ project, videos: withWords, timeline, shorts, suggestions });
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

// ── Large-file engine ────────────────────────────────────────────────
// 1) presign a direct-to-R2 upload URL (browser uploads straight to storage).
app.post("/api/projects/:id/videos/presign", async (c) => {
  await ensureSchema(c.env.DB);
  const pid = c.req.param("id");
  if (!(await getProject(c.env.DB, pid))) return c.json({ error: "project not found" }, 404);
  const body = await c.req.json<{ filename?: string; contentType?: string }>().catch(() => ({}) as { filename?: string; contentType?: string });
  const vid = crypto.randomUUID();
  const key = videoSourceKey(pid, vid, pickExt(body.filename, body.contentType));
  const uploadUrl = await presignPut(c.env, key);
  if (!uploadUrl) return c.json({ error: "direct uploads aren't configured yet (missing R2 API keys)" }, 501);
  return c.json({ videoId: vid, key, uploadUrl });
});

// 2) confirm the upload finished → create the video record.
app.post("/api/projects/:id/videos/confirm", async (c) => {
  await ensureSchema(c.env.DB);
  const pid = c.req.param("id");
  if (!(await getProject(c.env.DB, pid))) return c.json({ error: "project not found" }, 404);
  const b = await c.req.json<{ videoId: string; key: string; filename?: string; duration?: number }>();
  if (!b.videoId || !b.key) return c.json({ error: "missing videoId/key" }, 400);
  const ord = (await listVideos(c.env.DB, pid)).length;
  const video = await addVideo(c.env.DB, {
    id: b.videoId, project_id: pid, filename: b.filename || "video", r2_key: b.key, duration: b.duration ?? null, ord,
  });
  return c.json(video, 201);
});

interface TranscribeJob {
  audioKey: string; // full-length mono 16kHz WAV, extracted once
  duration: number;
  segment: number;
  done: number;
  words: Word[];
}

// A URL the container can read the video from (presigned R2, else our range route).
async function sourceUrl(c: { env: Env; req: { url: string } }, key: string): Promise<string> {
  const signed = await presignGet(c.env, key, 21600);
  if (signed) return signed;
  const origin = new URL(c.req.url).origin;
  return `${origin}/api/media/${key.split("/").map(encodeURIComponent).join("/")}`;
}

const audioKeyFor = (pid: string, vid: string) => `projects/${pid}/videos/${vid}/audio.wav`;

// 3) start transcription: extract the FULL audio track ONCE (small — tens of MB
// even for a multi-hour video) rather than re-seeking into the huge source
// video per chunk, which was destabilizing the container.
//
// This runs SYNCHRONOUSLY — the client's fetch() waits on it directly. An
// earlier version tried to background this via c.executionCtx.waitUntil() to
// return instantly, but confirmed via a live tail: Cloudflare kills waitUntil
// tasks almost immediately after the response is sent ("waitUntil() tasks did
// not complete within the allowed time... and have been cancelled") — nowhere
// near enough for a multi-minute extraction, and there's no way to catch that
// external kill, so the job just froze forever with no error. A single directly-
// awaited request has no such limit (Workers allow long wall-clock time for
// I/O-bound waits); the client shows a persistent "extracting…" message for
// the duration of this one call instead of polling a background job.
app.post("/api/videos/:id/transcribe-remote", async (c) => {
  await ensureSchema(c.env.DB);
  const vid = c.req.param("id");
  const video = await getVideo(c.env.DB, vid);
  if (!video) return c.json({ error: "video not found" }, 404);
  if (!c.env.RENDER) return c.json({ error: "the transcription engine isn't enabled yet (Containers not configured)" }, 501);

  const log = (...args: unknown[]) => console.log(`[extract ${vid}]`, ...args);
  const mediaUrl = await sourceUrl(c, video.r2_key);
  const audioKey = audioKeyFor(video.project_id, vid);
  await setVideoStatus(c.env.DB, vid, "transcribing");

  try {
    log("calling container /extract-full");
    const t0 = Date.now();
    const extract = await getContainer(c.env.RENDER, vid).fetch("http://ffmpeg/extract-full", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: mediaUrl }),
    });
    log(`container responded after ${Date.now() - t0}ms, status=${extract.status}, content-length=${extract.headers.get("content-length")}`);
    if (!extract.ok || !extract.body) {
      const detail = await extract.text().catch(() => "");
      throw new Error(`audio extraction failed: ${detail.slice(0, 300) || extract.status}`);
    }
    // R2 needs a stream's exact byte length up front; the container reports it
    // via content-length, but that doesn't always survive the container proxy
    // as a stream property, so re-declare it explicitly with FixedLengthStream
    // rather than buffering the whole file (can be ~200MB for a long video).
    const declaredLength = Number(extract.headers.get("content-length") || 0);
    const t1 = Date.now();
    if (declaredLength > 0) {
      log(`streaming ${declaredLength} bytes into R2 via FixedLengthStream`);
      const { readable, writable } = new FixedLengthStream(declaredLength);
      const pump = extract.body.pipeTo(writable);
      await c.env.MEDIA.put(audioKey, readable, { httpMetadata: { contentType: "audio/wav" } });
      await pump;
    } else {
      log("no content-length from container — falling back to full buffering");
      const buf = await extract.arrayBuffer();
      log(`buffered ${buf.byteLength} bytes, putting to R2`);
      await c.env.MEDIA.put(audioKey, buf, { httpMetadata: { contentType: "audio/wav" } });
    }
    log(`R2 put done after ${Date.now() - t1}ms`);

    const head = await c.env.MEDIA.head(audioKey);
    const duration = head ? durationFromWavSize(head.size) : 0;
    log(`audio object size=${head?.size}, computed duration=${duration}s`);
    if (!duration) throw new Error("extracted audio was empty");

    const job: TranscribeJob = { audioKey, duration, segment: 30, done: 0, words: [] };
    await c.env.MEDIA.put(jobKey(video.project_id, vid), JSON.stringify(job), { httpMetadata: { contentType: "application/json" } });
    return c.json({ ok: true, chunks: Math.ceil(duration / job.segment) });
  } catch (err) {
    log("FAILED:", err instanceof Error ? err.stack || err.message : err);
    await setVideoStatus(c.env.DB, vid, "failed");
    return c.json({ error: `${err instanceof Error ? err.message : err}` }, 502);
  }
});

// 4) poll: each call transcribes the next audio chunk (a plain R2 range read —
// no container involved), finalizing when done.
app.get("/api/videos/:id/transcribe-status", async (c) => {
  const vid = c.req.param("id");
  const video = await getVideo(c.env.DB, vid);
  if (!video) return c.json({ error: "video not found" }, 404);
  const job = await readJson<TranscribeJob>(c.env.MEDIA, jobKey(video.project_id, vid));
  const log = (...args: unknown[]) => console.log(`[chunk ${vid}]`, ...args);
  if (!job) return c.json({ error: "no transcription job for this video" }, 404);

  const duration = job.duration;
  const audioKey = job.audioKey;
  const total = Math.max(1, Math.ceil(duration / job.segment));
  log(`phase=chunking done=${job.done}/${total} duration=${duration}s segment=${job.segment}s audioKey=${audioKey}`);
  const finalize = async () => {
    log("finalizing — all chunks done");
    await c.env.MEDIA.put(transcriptKey(video.project_id, vid), JSON.stringify(job.words), { httpMetadata: { contentType: "application/json" } });
    await setVideoStatus(c.env.DB, vid, "ready");
    await c.env.MEDIA.delete(audioKey).catch(() => {});
    return c.json({ status: "ready", words: job.words });
  };
  if (job.done >= total) return finalize();

  try {
    const start = job.done * job.segment;
    const dur = Math.min(job.segment, duration - start);
    const offset = byteOffsetForSecond(start);
    const length = byteOffsetForSecond(start + dur) - offset;
    log(`chunk ${job.done}: reading R2 range offset=${offset} length=${length}`);
    const obj = await c.env.MEDIA.get(audioKey, { range: { offset, length } });
    if (!obj) throw new Error("extracted audio went missing mid-transcription");
    const pcm = await obj.arrayBuffer();
    log(`chunk ${job.done}: got ${pcm.byteLength} bytes PCM, calling Whisper`);
    const t0 = Date.now();
    const chunkWords = await transcribeAudio(c.env, wrapPcm(pcm));
    log(`chunk ${job.done}: Whisper returned ${chunkWords.length} words in ${Date.now() - t0}ms`);
    for (const w of chunkWords) { w.start += start; w.end += start; }
    job.words.push(...chunkWords);
    job.done += 1;
    await c.env.MEDIA.put(jobKey(video.project_id, vid), JSON.stringify(job), { httpMetadata: { contentType: "application/json" } });
    if (job.done >= total) return finalize();
    return c.json({ status: "processing", progress: Math.round((job.done / total) * 100) });
  } catch (err) {
    log("FAILED:", err instanceof Error ? err.stack || err.message : err);
    await setVideoStatus(c.env.DB, vid, "failed");
    return c.json({ status: "failed", error: `${err instanceof Error ? err.message : err}` });
  }
});

// Import a video from a URL (Rumble / direct link) straight into R2.
app.post("/api/projects/:id/import", async (c) => {
  await ensureSchema(c.env.DB);
  const pid = c.req.param("id");
  if (!(await getProject(c.env.DB, pid))) return c.json({ error: "project not found" }, 404);

  const { url } = await c.req.json<{ url?: string }>().catch(() => ({}) as { url?: string });
  if (!url) return c.json({ error: "no url provided" }, 400);

  try {
    const resolved = await resolveMedia(url);
    const upstream = await fetch(resolved.mediaUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      },
    });
    if (!upstream.ok || !upstream.body) {
      return c.json({ error: `couldn't fetch the media (HTTP ${upstream.status})` }, 502);
    }
    const contentType = resolved.contentType || upstream.headers.get("content-type") || "video/mp4";
    const vid = crypto.randomUUID();
    const key = videoSourceKey(pid, vid, pickExt(resolved.filename, contentType));
    await c.env.MEDIA.put(key, upstream.body, { httpMetadata: { contentType } });

    const ord = (await listVideos(c.env.DB, pid)).length;
    const video = await addVideo(c.env.DB, { id: vid, project_id: pid, filename: resolved.filename, r2_key: key, ord });
    return c.json(video, 201);
  } catch (err) {
    return c.json({ error: `${err instanceof Error ? err.message : err}` }, 502);
  }
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

// Directed edit: the user types their own goal ("a video about how the host
// keeps interrupting the guest") instead of picking a generic best-cut.
app.post("/api/projects/:id/direct", async (c) => {
  await ensureSchema(c.env.DB);
  const id = c.req.param("id");
  if (!(await getProject(c.env.DB, id))) return c.json({ error: "project not found" }, 404);
  const { instruction } = await c.req.json<{ instruction?: string }>().catch(() => ({}) as { instruction?: string });
  if (!instruction?.trim()) return c.json({ error: "describe what you want the edit to be" }, 400);
  const ready = await readyTranscripts(c, id);
  if (!ready.length) return c.json({ error: "no transcribed videos to work from yet" }, 400);
  try {
    const timeline = await directedArrange(c.env, ready, instruction);
    await c.env.MEDIA.put(timelineKey(id), JSON.stringify(timeline), {
      httpMetadata: { contentType: "application/json" },
    });
    return c.json({ timeline });
  } catch (err) {
    return c.json({ error: `directed edit failed: ${err}` }, 502);
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

// AI-found connections worth cutting together on purpose — callbacks,
// contrasts, recurring themes spread across the whole transcript ("thematic
// string-out"), not just adjacent-sentence coherence like /arrange.
app.post("/api/projects/:id/suggest-edits", async (c) => {
  await ensureSchema(c.env.DB);
  const id = c.req.param("id");
  if (!(await getProject(c.env.DB, id))) return c.json({ error: "project not found" }, 404);
  const ready = await readyTranscripts(c, id);
  if (!ready.length) return c.json({ error: "no transcribed videos to analyze yet" }, 400);
  try {
    const suggestions = await suggestEdits(c.env, ready);
    await c.env.MEDIA.put(suggestionsKey(id), JSON.stringify(suggestions), {
      httpMetadata: { contentType: "application/json" },
    });
    return c.json({ suggestions });
  } catch (err) {
    return c.json({ error: `suggest-edits failed: ${err}` }, 502);
  }
});

// A video's metadata by id alone, unscoped to any project — lets the client
// resolve a "foreign" library clip's video (filename/r2_key/duration) without
// loading that whole other project. getVideo() is already global.
app.get("/api/videos/:id", async (c) => {
  await ensureSchema(c.env.DB);
  const video = await getVideo(c.env.DB, c.req.param("id"));
  if (!video) return c.json({ error: "video not found" }, 404);
  const project = await getProject(c.env.DB, video.project_id);
  return c.json({ ...video, project: project ? { id: project.id, name: project.name } : null });
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

// Cross-project analog of readyTranscripts() — every ready video, everywhere,
// feeding the account-wide clip discovery pass below.
async function allReadyTranscripts(c: { env: Env }): Promise<VideoTranscript[]> {
  const videos = await listAllReadyVideos(c.env.DB);
  const out: VideoTranscript[] = [];
  for (const v of videos) {
    const words = await readJson<Word[]>(c.env.MEDIA, transcriptKey(v.project_id, v.id));
    if (words?.length) out.push({ id: v.id, filename: v.filename, words });
  }
  return out;
}

// ── Clip Library (cross-project) ──────────────────────────────────────
// A clip is a persistent, tagged, one-or-more-segment reference into any
// project's video(s) — the reusable unit the Library view browses/searches
// and future projects assemble from. Playback needs no new machinery: each
// segment carries a videoId, and GET /api/media/* + GET /api/videos/:id
// (above) resolve it regardless of which project it lives in.
app.post("/api/clips", async (c) => {
  await ensureSchema(c.env.DB);
  await ensureClipSchema(c.env.DB);
  const body = await c.req
    .json<{ title?: string; description?: string; kind?: ClipKind; tags?: string[]; segments?: Segment[] }>()
    .catch(() => ({}) as { title?: string; description?: string; kind?: ClipKind; tags?: string[]; segments?: Segment[] });
  const title = body.title?.trim();
  if (!title) return c.json({ error: "a title is required" }, 400);
  if (!body.segments?.length) return c.json({ error: "a clip needs at least one segment" }, 400);

  const segments: NewClipSegment[] = [];
  for (const s of body.segments) {
    const video = await getVideo(c.env.DB, s.videoId);
    if (!video) return c.json({ error: `video not found for segment: ${s.videoId}` }, 400);
    if (typeof s.start !== "number" || typeof s.end !== "number" || s.end <= s.start) {
      return c.json({ error: "each segment needs a valid start < end" }, 400);
    }
    segments.push({ videoId: s.videoId, projectId: video.project_id, start: s.start, end: s.end, reason: s.reason });
  }
  const clip = await createClip(c.env.DB, {
    title,
    description: body.description?.trim() || null,
    kind: body.kind === "ai-detected" ? "ai-detected" : "manual",
    segments,
    tags: body.tags,
  });
  return c.json(clip, 201);
});

app.get("/api/clips/tags", async (c) => {
  await ensureSchema(c.env.DB);
  await ensureClipSchema(c.env.DB);
  return c.json({ tags: await listAllTags(c.env.DB) });
});

// Account-wide analog of /api/projects/:id/suggest-edits: gathers every ready
// video's transcript across every project and reuses suggestEdits()
// unchanged. Results are NOT auto-saved — same review-then-commit UX as the
// existing per-project Suggested Edits — the client shows candidates and
// calls POST /api/clips per one the user keeps.
app.post("/api/clips/discover", async (c) => {
  await ensureSchema(c.env.DB);
  const ready = await allReadyTranscripts(c);
  if (!ready.length) return c.json({ error: "no transcribed videos anywhere yet" }, 400);
  try {
    const candidates = await suggestEdits(c.env, ready);
    return c.json({ candidates });
  } catch (err) {
    return c.json({ error: `discover failed: ${err}` }, 502);
  }
});

app.get("/api/clips", async (c) => {
  await ensureSchema(c.env.DB);
  await ensureClipSchema(c.env.DB);
  const { tag, projectId, videoId, kind, q, limit, offset } = c.req.query();
  const clips = await listClips(c.env.DB, {
    tag,
    projectId,
    videoId,
    kind: kind === "ai-detected" ? "ai-detected" : kind === "manual" ? "manual" : undefined,
    q,
    limit: limit ? Number(limit) : undefined,
    offset: offset ? Number(offset) : undefined,
  });
  return c.json({ clips });
});

app.get("/api/clips/:id", async (c) => {
  await ensureSchema(c.env.DB);
  await ensureClipSchema(c.env.DB);
  const clip = await getClip(c.env.DB, c.req.param("id"));
  if (!clip) return c.json({ error: "clip not found" }, 404);
  return c.json(clip);
});

app.patch("/api/clips/:id", async (c) => {
  await ensureSchema(c.env.DB);
  await ensureClipSchema(c.env.DB);
  const body = await c.req
    .json<{ title?: string; description?: string; tags?: string[] }>()
    .catch(() => ({}) as { title?: string; description?: string; tags?: string[] });
  const clip = await updateClip(c.env.DB, c.req.param("id"), body);
  if (!clip) return c.json({ error: "clip not found" }, 404);
  return c.json(clip);
});

app.delete("/api/clips/:id", async (c) => {
  await ensureSchema(c.env.DB);
  await ensureClipSchema(c.env.DB);
  await deleteClip(c.env.DB, c.req.param("id"));
  return c.json({ ok: true });
});

// ── Transcript Editor (legacy single-file) ───────────────────────────
// Upload audio/video -> R2 + Whisper -> word-level transcript.
app.post("/api/transcribe", async (c) => {
  const contentType = c.req.header("content-type") ?? "application/octet-stream";
  const bytes = await c.req.arrayBuffer();
  return c.json(await transcribeUpload(c.env, bytes, contentType));
});

// Rendering now happens in the browser (public/render.js, ffmpeg.wasm). The
// server-side container render is parked; re-enable src/render.ts + the wrangler
// containers block to bring it back for large files.
app.post("/api/export", (c) =>
  c.json({ error: "export renders in the browser now — use the console's Export / Produce" }, 501),
);

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
