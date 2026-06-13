/**
 * Aldershot — Worker entry (v0).
 * Serves the console (static assets in public/) and the /api surface.
 * Heavy work is synchronous in v0; Workflows orchestration comes later.
 */
import { Hono } from "hono";
import { getContainer } from "@cloudflare/containers";
import type { Env } from "./env";
import { runShot, narrate, type ShotSpec } from "./pipeline/compiler";
import { transcribeUpload } from "./transcript/transcribe";
import { keptRanges, totalSeconds, ffmpegSelect, type Word } from "./transcript/edl";

export { RenderContainer } from "./render";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ app: "aldershot", status: "ok", phase: "v0" }));

// ── Transcript Editor ────────────────────────────────────────────────
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
