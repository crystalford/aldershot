/**
 * Aldershot — Worker entry (v0).
 * Serves the console (static assets in public/) and the /api surface.
 * Heavy work is synchronous in v0; Workflows orchestration comes later.
 */
import { Hono } from "hono";
import { getContainer } from "@cloudflare/containers";
import type { Env } from "./env";
import { MODELS } from "./models";
import { narrate } from "./pipeline/compiler";
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
  setVideoR2Key,
  getOrCreateGenerativeProject,
  getOrCreateClippingProject,
} from "./db";
import {
  ensureClipSchema,
  createClip,
  listClips,
  getClip,
  updateClip,
  deleteClip,
  listAllTags,
  visualSummaryOf,
  type ClipKind,
  type NewClipSegment,
} from "./clips";
import { ensureVisualTagSchema, createVisualTag } from "./visualtags";
import {
  ensureEssaySchema,
  createEssay,
  listEssays,
  getEssay,
  updateEssayMeta,
  deleteEssay,
  addBeat,
  updateBeat,
  deleteBeat,
  reorderBeats,
  ACTS,
  type BeatAct,
  type BeatKind,
} from "./essays";
import { ensureThreadSchema, listThreads, renameThread, mergeThreads } from "./threads";
import {
  ensureGenerativeSchema,
  createScene,
  getScene,
  generateShotImage,
  generateShotVideo,
  saveShotToArchive,
  isAspect,
} from "./generative";
import { videoSourceKey, transcriptKey, timelineKey, shortsKey, suggestionsKey, jobKey, pickExt, enhancedAudioKey, timelineHistoryPrefix, timelineHistoryKey } from "./keys";
import {
  arrangeTimeline,
  directedArrange,
  suggestShorts,
  suggestEdits,
  composeFromClips,
  generateBridges,
  suggestReactionClip,
  draftEssayActBeat,
  type VideoTranscript,
  type SegmentWithText,
} from "./pipeline/reason";
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

const TIMELINE_HISTORY_LIMIT = 20;

// Archives whatever's currently at timelineKey(pid) (if anything) before
// it's about to be overwritten, then prunes to the newest
// TIMELINE_HISTORY_LIMIT snapshots. Called from every path that replaces
// the live timeline — manual saves, auto-arrange, direct edit, restoring a
// past version — so "can I get back to what I had before this AI run
// rewrote everything" always has an answer without any route needing to
// remember to opt in.
async function archiveTimeline(bucket: R2Bucket, pid: string): Promise<void> {
  const current = await bucket.get(timelineKey(pid));
  if (!current) return;
  const body = await current.text();
  // An explicit empty {coldOpen:[],body:[]} (or a project that's never had
  // a timeline written) isn't a version worth keeping.
  try {
    const parsed = JSON.parse(body) as Timeline;
    if (!(parsed.coldOpen?.length || parsed.body?.length)) return;
  } catch { return; }
  await bucket.put(timelineHistoryKey(pid, Date.now()), body, { httpMetadata: { contentType: "application/json" } });

  const listed = await bucket.list({ prefix: timelineHistoryPrefix(pid) });
  const sorted = listed.objects.map((o) => o.key).sort().reverse(); // newest (largest timestamp) first
  const stale = sorted.slice(TIMELINE_HISTORY_LIMIT);
  if (stale.length) await bucket.delete(stale);
}

// Persist the manually-edited / arranged long-form timeline.
app.put("/api/projects/:id/timeline", async (c) => {
  await ensureSchema(c.env.DB);
  const id = c.req.param("id");
  if (!(await getProject(c.env.DB, id))) return c.json({ error: "project not found" }, 404);
  const timeline = await c.req.json<Timeline>();
  await archiveTimeline(c.env.MEDIA, id);
  await c.env.MEDIA.put(timelineKey(id), JSON.stringify(timeline), {
    httpMetadata: { contentType: "application/json" },
  });
  return c.json({ ok: true });
});

// Version history for the Cut/Timeline — every save archives whatever it's
// about to overwrite first (see archiveTimeline below), so nothing here
// needs a separate "checkpoint" trigger the client has to remember to call.
app.get("/api/projects/:id/history", async (c) => {
  await ensureSchema(c.env.DB);
  const id = c.req.param("id");
  if (!(await getProject(c.env.DB, id))) return c.json({ error: "project not found" }, 404);
  const listed = await c.env.MEDIA.list({ prefix: timelineHistoryPrefix(id) });
  const versions = listed.objects
    .map((o) => ({ timestamp: Number(o.key.slice(timelineHistoryPrefix(id).length, -".json".length)), size: o.size }))
    .filter((v) => Number.isFinite(v.timestamp))
    .sort((a, b) => b.timestamp - a.timestamp);
  return c.json({ versions });
});

app.post("/api/projects/:id/history/:timestamp/restore", async (c) => {
  await ensureSchema(c.env.DB);
  const id = c.req.param("id");
  if (!(await getProject(c.env.DB, id))) return c.json({ error: "project not found" }, 404);
  const ts = Number(c.req.param("timestamp"));
  if (!Number.isFinite(ts)) return c.json({ error: "invalid version" }, 400);
  const snapshot = await readJson<Timeline>(c.env.MEDIA, timelineHistoryKey(id, ts));
  if (!snapshot) return c.json({ error: "that version is gone" }, 404);
  // Restoring is itself just another overwrite — archive the current state
  // first so restoring is never a one-way trip either.
  await archiveTimeline(c.env.MEDIA, id);
  await c.env.MEDIA.put(timelineKey(id), JSON.stringify(snapshot), {
    httpMetadata: { contentType: "application/json" },
  });
  return c.json({ ok: true, timeline: snapshot });
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
    await archiveTimeline(c.env.MEDIA, id);
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
    await archiveTimeline(c.env.MEDIA, id);
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

// Given the project's current assembled cut, resolve each segment's actual
// spoken text (a segment may reference a video from a different project —
// getVideo() is global) and ask the model to write bridging narration for
// any transition that needs one — the connective-tissue step of the video
// essay workflow, after Compose/Auto-arrange/manual Cut-building.
app.post("/api/projects/:id/bridges", async (c) => {
  await ensureSchema(c.env.DB);
  const id = c.req.param("id");
  const project = await getProject(c.env.DB, id);
  if (!project) return c.json({ error: "project not found" }, 404);
  const timeline = await readJson<Timeline>(c.env.MEDIA, timelineKey(id));
  const flat = [...(timeline?.coldOpen ?? []), ...(timeline?.body ?? [])];
  if (flat.length < 2) return c.json({ error: "build a cut with at least two segments first" }, 400);

  const transcriptCache = new Map<string, Word[] | null>();
  const segments: SegmentWithText[] = [];
  for (const s of flat) {
    const video = await getVideo(c.env.DB, s.videoId);
    if (!video) { segments.push({ videoId: s.videoId, start: s.start, end: s.end, text: "" }); continue; }
    const key = transcriptKey(video.project_id, s.videoId);
    if (!transcriptCache.has(key)) transcriptCache.set(key, await readJson<Word[]>(c.env.MEDIA, key));
    const words = transcriptCache.get(key);
    const text = (words ?? [])
      .filter((w) => !w.deleted && w.start >= s.start && w.end <= s.end)
      .map((w) => w.text)
      .join(" ");
    segments.push({ videoId: s.videoId, start: s.start, end: s.end, text });
  }

  try {
    const bridges = await generateBridges(c.env, segments, project.name);
    return c.json({ bridges });
  } catch (err) {
    return c.json({ error: `bridges failed: ${err}` }, 502);
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

// "Enhance audio" — one-click cleanup (denoise, EQ, level, loudness-normalize)
// run in the same ffmpeg container as extraction/rendering. Non-destructive:
// writes to a separate R2 object and leaves the video's own r2_key alone —
// the client previews original vs. enhanced and calls apply-enhanced-audio
// (below) to actually switch over. Same synchronous-call shape as
// transcribe-remote, for the same reason (waitUntil doesn't survive long
// enough for container work).
app.post("/api/videos/:id/enhance-audio", async (c) => {
  await ensureSchema(c.env.DB);
  const vid = c.req.param("id");
  const video = await getVideo(c.env.DB, vid);
  if (!video) return c.json({ error: "video not found" }, 404);
  if (!c.env.RENDER) return c.json({ error: "the render engine isn't enabled yet (Containers not configured)" }, 501);

  const log = (...args: unknown[]) => console.log(`[enhance ${vid}]`, ...args);
  const mediaUrl = await sourceUrl(c, video.r2_key);
  const outKey = enhancedAudioKey(video.project_id, vid);
  try {
    log("calling container /enhance-audio");
    const t0 = Date.now();
    const enhanced = await getContainer(c.env.RENDER, vid).fetch("http://ffmpeg/enhance-audio", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: mediaUrl }),
    });
    log(`container responded after ${Date.now() - t0}ms, status=${enhanced.status}`);
    if (!enhanced.ok || !enhanced.body) {
      const detail = await enhanced.text().catch(() => "");
      throw new Error(`enhance failed: ${detail.slice(0, 300) || enhanced.status}`);
    }
    const declaredLength = Number(enhanced.headers.get("content-length") || 0);
    if (declaredLength > 0) {
      const { readable, writable } = new FixedLengthStream(declaredLength);
      const pump = enhanced.body.pipeTo(writable);
      await c.env.MEDIA.put(outKey, readable, { httpMetadata: { contentType: "video/mp4" } });
      await pump;
    } else {
      const buf = await enhanced.arrayBuffer();
      await c.env.MEDIA.put(outKey, buf, { httpMetadata: { contentType: "video/mp4" } });
    }
    const mediaPath = `/api/media/${outKey.split("/").map(encodeURIComponent).join("/")}`;
    return c.json({ ok: true, key: outKey, mediaPath });
  } catch (err) {
    log("FAILED:", err instanceof Error ? err.stack || err.message : err);
    return c.json({ error: `${err instanceof Error ? err.message : err}` }, 502);
  }
});

// Switches the video over to the enhanced remux produced above. Duration is
// preserved to the millisecond by the enhance pass, so existing transcript
// word timestamps stay valid — no re-transcription needed. The prior R2
// object is intentionally left in place (not deleted), recoverable even
// without an undo UI yet.
app.post("/api/videos/:id/apply-enhanced-audio", async (c) => {
  await ensureSchema(c.env.DB);
  const vid = c.req.param("id");
  const video = await getVideo(c.env.DB, vid);
  if (!video) return c.json({ error: "video not found" }, 404);
  const key = enhancedAudioKey(video.project_id, vid);
  const head = await c.env.MEDIA.head(key);
  if (!head) return c.json({ error: "no enhanced audio to apply — run Enhance audio first" }, 400);
  await setVideoR2Key(c.env.DB, vid, key);
  return c.json({ ok: true, r2_key: key });
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

// Compose a draft video essay directly from the clip library — grounded
// against already-saved, already-titled clips (not raw transcript
// sentences), so the model only ever picks and orders clip ids. Each cited
// clip's own stored segments get concatenated in the order chosen — no
// LLM-invented timestamps, same grounding principle as every other
// reasoning endpoint. Not auto-saved to a project; the client offers
// "save as a new project" or "add to an existing one" on the result.
app.post("/api/clips/compose", async (c) => {
  await ensureSchema(c.env.DB);
  await ensureClipSchema(c.env.DB);
  await ensureVisualTagSchema(c.env.DB); // listClips() joins visual_tags into each segment
  const { instruction } = await c.req.json<{ instruction?: string }>().catch(() => ({}) as { instruction?: string });
  if (!instruction?.trim()) return c.json({ error: "describe what you want the video essay to be about" }, 400);
  const clips = await listClips(c.env.DB, { limit: 500 });
  if (!clips.length) return c.json({ error: "no clips saved yet — save some to your library first" }, 400);
  try {
    const plan = await composeFromClips(
      c.env,
      clips.map((cl) => ({ id: cl.id, title: cl.title, description: cl.description, tags: cl.tags, visualSummary: visualSummaryOf(cl) })),
      instruction,
    );
    const byId = new Map(clips.map((cl) => [cl.id, cl]));
    const toSegments = (refs: { clipId: string; reason?: string }[]): Segment[] =>
      refs.flatMap((r) => {
        const clip = byId.get(r.clipId);
        if (!clip) return [];
        return clip.segments.map((s) => ({ videoId: s.videoId, start: s.start, end: s.end, reason: r.reason || clip.title }));
      });
    const timeline: Timeline = { coldOpen: toSegments(plan.coldOpen), body: toSegments(plan.body) };
    return c.json({ timeline });
  } catch (err) {
    return c.json({ error: `compose failed: ${err}` }, 502);
  }
});

// Reaction/cutaway clips: "he says X, cut to some existing clip that echoes
// X." Scoped to the user's own saved library only (same grounded discipline
// as Compose — cite a real clip id or return nothing, never invent one).
// Reaching into a broader stock/meme corpus of clips the user doesn't own is
// a deliberately separate, deferred idea — not what this route does.
app.post("/api/projects/:id/reaction-clip", async (c) => {
  await ensureSchema(c.env.DB);
  const id = c.req.param("id");
  if (!(await getProject(c.env.DB, id))) return c.json({ error: "project not found" }, 404);
  const { line } = await c.req.json<{ line?: string }>().catch(() => ({}) as { line?: string });
  if (!line?.trim()) return c.json({ error: "select a line to react to" }, 400);

  await ensureClipSchema(c.env.DB);
  await ensureVisualTagSchema(c.env.DB);
  const clips = await listClips(c.env.DB, { limit: 500 });
  if (!clips.length) return c.json({ match: null });
  try {
    const match = await suggestReactionClip(
      c.env,
      clips.map((cl) => ({ id: cl.id, title: cl.title, description: cl.description, tags: cl.tags, visualSummary: visualSummaryOf(cl) })),
      line,
    );
    if (!match) return c.json({ match: null });
    const clip = clips.find((cl) => cl.id === match.clipId);
    return c.json({ match: { clipId: match.clipId, reason: match.reason, title: clip?.title, segments: clip?.segments ?? [] } });
  } catch (err) {
    return c.json({ error: `reaction-clip failed: ${err}` }, 502);
  }
});

app.get("/api/clips", async (c) => {
  await ensureSchema(c.env.DB);
  await ensureClipSchema(c.env.DB);
  await ensureVisualTagSchema(c.env.DB); // listClips() joins visual_tags into each segment
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
  await ensureVisualTagSchema(c.env.DB);
  const clip = await getClip(c.env.DB, c.req.param("id"));
  if (!clip) return c.json({ error: "clip not found" }, 404);
  return c.json(clip);
});

app.patch("/api/clips/:id", async (c) => {
  await ensureSchema(c.env.DB);
  await ensureClipSchema(c.env.DB);
  await ensureVisualTagSchema(c.env.DB); // updateClip() re-reads via getClip()
  const body = await c.req
    .json<{ title?: string; description?: string; tags?: string[] }>()
    .catch(() => ({}) as { title?: string; description?: string; tags?: string[] });
  const clip = await updateClip(c.env.DB, c.req.param("id"), body);
  if (!clip) return c.json({ error: "clip not found" }, 404);
  return c.json(clip);
});

// Visual tags for a clip's own segments — a handful of client-captured
// keyframes (data URIs, from Thumb.grab()) get captioned and OCR'd via
// Moondream 3.1 right after the clip is saved. Fire-and-forget from the
// client's point of view: tags are an enrichment, not required for the clip
// to exist. Tags are stored on the VIDEO's timeline (see visualtags.ts), not
// owned by this clip, so they're picked up by any future clip that overlaps
// the same time range too.
app.post("/api/clips/:id/visual-tags", async (c) => {
  await ensureSchema(c.env.DB);
  await ensureClipSchema(c.env.DB);
  await ensureVisualTagSchema(c.env.DB);
  const clipId = c.req.param("id");
  const clip = await getClip(c.env.DB, clipId);
  if (!clip) return c.json({ error: "clip not found" }, 404);

  const body = await c.req
    .json<{ frames?: { videoId: string; time: number; image: string }[] }>()
    .catch(() => ({}) as { frames?: { videoId: string; time: number; image: string }[] });
  const frames = body.frames ?? [];
  if (!frames.length) return c.json({ error: "no frames provided" }, 400);

  // Resolve each frame's owning project once (segments can span videos from
  // different projects), tolerating a bad/foreign video id per-frame rather
  // than failing the whole batch.
  const projectIdCache = new Map<string, string | null>();
  const created = [];
  for (const f of frames) {
    if (!f.videoId || typeof f.time !== "number" || !f.image) continue;
    if (!projectIdCache.has(f.videoId)) {
      const v = await getVideo(c.env.DB, f.videoId);
      projectIdCache.set(f.videoId, v?.project_id ?? null);
    }
    const projectId = projectIdCache.get(f.videoId);
    if (!projectId) continue;
    try {
      const [captionRes, ocrRes] = await Promise.all([
        c.env.AI.run(MODELS.vision, { task: "caption", image: f.image, caption_length: "normal", stream: false }) as Promise<{ caption?: string }>,
        c.env.AI.run(MODELS.vision, {
          task: "query",
          image: f.image,
          question: "Transcribe any text visible in this image. Respond with an empty string if there is none.",
          reasoning: false,
          stream: false,
        }) as Promise<{ answer?: string }>,
      ]);
      const tag = await createVisualTag(c.env.DB, {
        videoId: f.videoId,
        projectId,
        time: f.time,
        caption: captionRes.caption,
        ocrText: ocrRes.answer,
      });
      created.push(tag);
    } catch (err) {
      console.error("[visual-tags] frame failed:", err);
    }
  }
  return c.json({ tags: created });
});

app.delete("/api/clips/:id", async (c) => {
  await ensureSchema(c.env.DB);
  await ensureClipSchema(c.env.DB);
  await deleteClip(c.env.DB, c.req.param("id"));
  return c.json({ ok: true });
});

// ── Essays — the video-essay authoring surface (see src/essays.ts) ────
app.post("/api/essays", async (c) => {
  await ensureEssaySchema(c.env.DB);
  const body = await c.req
    .json<{ title?: string; premise?: string; audience?: string; targetLength?: string; tone?: string; threads?: string[] }>()
    .catch(() => ({}) as { title?: string; premise?: string; audience?: string; targetLength?: string; tone?: string; threads?: string[] });
  const title = body.title?.trim();
  const premise = body.premise?.trim();
  if (!title) return c.json({ error: "give the essay a title" }, 400);
  if (!premise) return c.json({ error: "describe the idea first" }, 400);
  const essay = await createEssay(c.env.DB, {
    title, premise, audience: body.audience?.trim() || null,
    targetLength: body.targetLength?.trim() || null, tone: body.tone?.trim() || null, threads: body.threads,
  });
  return c.json(essay, 201);
});

app.get("/api/essays", async (c) => {
  await ensureEssaySchema(c.env.DB);
  return c.json({ essays: await listEssays(c.env.DB) });
});

app.get("/api/essays/:id", async (c) => {
  await ensureEssaySchema(c.env.DB);
  const essay = await getEssay(c.env.DB, c.req.param("id"));
  if (!essay) return c.json({ error: "essay not found" }, 404);
  return c.json(essay);
});

app.patch("/api/essays/:id", async (c) => {
  await ensureEssaySchema(c.env.DB);
  const id = c.req.param("id");
  const body = await c.req
    .json<{ title?: string; premise?: string; audience?: string | null; targetLength?: string | null; tone?: string | null; builderMode?: string; threads?: string[] }>()
    .catch(() => ({}) as Record<string, never>);
  const essay = await updateEssayMeta(c.env.DB, id, body);
  if (!essay) return c.json({ error: "essay not found" }, 404);
  return c.json(essay);
});

app.delete("/api/essays/:id", async (c) => {
  await ensureEssaySchema(c.env.DB);
  await deleteEssay(c.env.DB, c.req.param("id"));
  return c.json({ ok: true });
});

// Act-by-act drafting: proposes ONE candidate beat for ONE named act, grounded
// against the Archive the same way Compose is. Not saved — the client shows
// Accept & next / Try another / Skip act, and only POSTs /beats on accept.
app.post("/api/essays/:id/draft-act", async (c) => {
  await ensureEssaySchema(c.env.DB);
  await ensureClipSchema(c.env.DB);
  await ensureVisualTagSchema(c.env.DB);
  const essay = await getEssay(c.env.DB, c.req.param("id"));
  if (!essay) return c.json({ error: "essay not found" }, 404);
  const { act } = await c.req.json<{ act?: string }>().catch(() => ({}) as { act?: string });
  if (!act || !ACTS.includes(act as BeatAct)) return c.json({ error: `act must be one of: ${ACTS.join(", ")}` }, 400);

  const clips = await listClips(c.env.DB, { limit: 500 });
  try {
    const candidate = await draftEssayActBeat(
      c.env,
      essay.premise,
      act,
      essay.beats.map((b) => b.text).filter(Boolean),
      clips.map((cl) => ({ id: cl.id, title: cl.title, description: cl.description, tags: cl.tags, visualSummary: visualSummaryOf(cl) })),
    );
    if (!candidate) return c.json({ candidate: null });
    const clip = candidate.kind === "clip" ? clips.find((cl) => cl.id === candidate.clipId) : null;
    return c.json({
      candidate: {
        kind: candidate.kind, text: candidate.kind === "clip" ? clip?.title ?? candidate.text : candidate.text,
        reason: candidate.reason, clipId: candidate.clipId,
        clip: clip ? { title: clip.title, tags: clip.tags, segments: clip.segments } : null,
      },
    });
  } catch (err) {
    return c.json({ error: `draft-act failed: ${err}` }, 502);
  }
});

app.post("/api/essays/:id/beats", async (c) => {
  await ensureEssaySchema(c.env.DB);
  const essayId = c.req.param("id");
  if (!(await getEssay(c.env.DB, essayId))) return c.json({ error: "essay not found" }, 404);
  const body = await c.req
    .json<{ act?: string; kind?: string; clipId?: string; text?: string; citations?: string[] }>()
    .catch(() => ({}) as Record<string, never>);
  if (!body.act || !ACTS.includes(body.act as BeatAct)) return c.json({ error: `act must be one of: ${ACTS.join(", ")}` }, 400);
  const kind: BeatKind = body.kind === "clip" ? "clip" : "vo";
  if (kind === "clip") {
    await ensureClipSchema(c.env.DB);
    if (!body.clipId || !(await getClip(c.env.DB, body.clipId))) return c.json({ error: "clip not found" }, 400);
  }
  const text = body.text?.trim() ?? "";
  if (kind === "vo" && !text) return c.json({ error: "a voiceover beat needs script text" }, 400);
  const beat = await addBeat(c.env.DB, essayId, { act: body.act as BeatAct, kind, clipId: kind === "clip" ? body.clipId : null, text, citations: body.citations });
  return c.json(beat, 201);
});

app.put("/api/essays/:id/beats/reorder", async (c) => {
  await ensureEssaySchema(c.env.DB);
  const essayId = c.req.param("id");
  const { order } = await c.req.json<{ order?: string[] }>().catch(() => ({}) as { order?: string[] });
  if (!Array.isArray(order)) return c.json({ error: "order must be an array of beat ids" }, 400);
  await reorderBeats(c.env.DB, essayId, order);
  const essay = await getEssay(c.env.DB, essayId);
  return c.json(essay ?? { error: "essay not found" }, essay ? 200 : 404);
});

app.put("/api/essays/:id/beats/:beatId", async (c) => {
  await ensureEssaySchema(c.env.DB);
  const { text, citations } = await c.req.json<{ text?: string; citations?: string[] }>().catch(() => ({}) as { text?: string; citations?: string[] });
  const beat = await updateBeat(c.env.DB, c.req.param("id"), c.req.param("beatId"), { text, citations });
  if (!beat) return c.json({ error: "beat not found" }, 404);
  return c.json(beat);
});

app.delete("/api/essays/:id/beats/:beatId", async (c) => {
  await ensureEssaySchema(c.env.DB);
  await deleteBeat(c.env.DB, c.req.param("id"), c.req.param("beatId"));
  return c.json({ ok: true });
});

// ── Threads — auto-derived from clip tags, not user-created (see src/threads.ts) ──
app.get("/api/threads", async (c) => {
  await ensureClipSchema(c.env.DB);
  await ensureThreadSchema(c.env.DB);
  return c.json({ threads: await listThreads(c.env.DB) });
});

app.patch("/api/threads/:tag", async (c) => {
  await ensureThreadSchema(c.env.DB);
  const { name } = await c.req.json<{ name?: string }>().catch(() => ({}) as { name?: string });
  if (!name?.trim()) return c.json({ error: "give the thread a name" }, 400);
  await renameThread(c.env.DB, c.req.param("tag").trim().toLowerCase(), name.trim());
  return c.json({ ok: true });
});

app.post("/api/threads/:tag/merge", async (c) => {
  await ensureClipSchema(c.env.DB);
  await ensureEssaySchema(c.env.DB);
  await ensureThreadSchema(c.env.DB);
  const { intoTag } = await c.req.json<{ intoTag?: string }>().catch(() => ({}) as { intoTag?: string });
  if (!intoTag?.trim()) return c.json({ error: "pick a thread to merge into" }, 400);
  await mergeThreads(c.env.DB, c.req.param("tag").trim().toLowerCase(), intoTag.trim().toLowerCase());
  return c.json({ ok: true });
});

// ── Generative — script line -> one consistent scene -> b-roll (see src/generative.ts) ──
// Lets the client scope its "Saved to the Archive" feed to Generative's own
// clips via ?projectId=, without conflating them with unrelated AI-detected
// clips saved elsewhere (Suggested Edits also uses kind="ai-detected").
app.get("/api/generative/project", async (c) => {
  await ensureSchema(c.env.DB);
  return c.json(await getOrCreateGenerativeProject(c.env.DB));
});

// ── Clipping — the focused upload-in/mine-for-shorts page (public/app.js
// showClippingView). One scratch project per account, same idea as Generative's. ──
app.get("/api/clipping/project", async (c) => {
  await ensureSchema(c.env.DB);
  return c.json(await getOrCreateClippingProject(c.env.DB));
});

app.post("/api/generative/scenes", async (c) => {
  await ensureGenerativeSchema(c.env.DB);
  const body = await c.req
    .json<{ line?: string; cutCount?: number; aspect?: string; durationSeconds?: number }>()
    .catch(() => ({}) as { line?: string; cutCount?: number; aspect?: string; durationSeconds?: number });
  if (!body.line?.trim()) return c.json({ error: "give the scene a script line to build from" }, 400);
  const aspect = isAspect(body.aspect) ? body.aspect : "16:9";
  const durationSeconds = Math.min(10, Math.max(2, Math.round(body.durationSeconds ?? 5)));
  const cutCount = Math.min(4, Math.max(1, Math.round(body.cutCount ?? 1)));
  try {
    const scene = await createScene(c.env, c.env.DB, { line: body.line, cutCount, aspect, durationSeconds });
    return c.json(scene, 201);
  } catch (err) {
    return c.json({ error: `couldn't build the scene: ${err}` }, 502);
  }
});

app.get("/api/generative/scenes/:id", async (c) => {
  await ensureGenerativeSchema(c.env.DB);
  const scene = await getScene(c.env.DB, c.req.param("id"));
  if (!scene) return c.json({ error: "scene not found" }, 404);
  return c.json(scene);
});

app.post("/api/generative/scenes/:id/shots/:shotId/generate-image", async (c) => {
  await ensureGenerativeSchema(c.env.DB);
  try {
    const shot = await generateShotImage(c.env, c.env.DB, c.req.param("id"), c.req.param("shotId"));
    return c.json(shot);
  } catch (err) {
    return c.json({ error: `image generation failed: ${err}` }, 502);
  }
});

app.post("/api/generative/scenes/:id/shots/:shotId/generate-video", async (c) => {
  await ensureGenerativeSchema(c.env.DB);
  try {
    const shot = await generateShotVideo(c.env, c.env.DB, c.req.param("id"), c.req.param("shotId"));
    return c.json(shot);
  } catch (err) {
    return c.json({ error: `video generation failed: ${err}` }, 502);
  }
});

app.post("/api/generative/scenes/:id/shots/:shotId/save", async (c) => {
  await ensureSchema(c.env.DB); // projects.kind — getOrCreateGenerativeProject needs it
  await ensureGenerativeSchema(c.env.DB);
  await ensureClipSchema(c.env.DB);
  const { tags } = await c.req.json<{ tags?: string[] }>().catch(() => ({}) as { tags?: string[] });
  try {
    const clip = await saveShotToArchive(c.env.DB, c.req.param("id"), c.req.param("shotId"), tags ?? []);
    return c.json(clip, 201);
  } catch (err) {
    return c.json({ error: `save failed: ${err}` }, 502);
  }
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

app.post("/api/narrate", async (c) => {
  const { text } = await c.req.json<{ text: string }>();
  const beatId = crypto.randomUUID();
  return c.json({ beatId, key: await narrate(c.env, beatId, text) });
});

export default app;
