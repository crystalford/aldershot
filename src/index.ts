/**
 * Aldershot — Worker entry (v0).
 * Serves the console (static assets in public/) and the /api surface.
 * Heavy work is synchronous in v0; Workflows orchestration comes later.
 */
import { Hono } from "hono";
import type { Env } from "./env";
import { runShot, narrate, type ShotSpec } from "./pipeline/compiler";
import { transcribeUpload } from "./transcript/transcribe";
import { keptRanges, totalSeconds, ffmpegSelect, type Word } from "./transcript/edl";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ app: "aldershot", status: "ok", phase: "v0" }));

// ── Transcript Editor ────────────────────────────────────────────────
// Upload audio/video -> R2 + Whisper -> word-level transcript.
app.post("/api/transcribe", async (c) => {
  const contentType = c.req.header("content-type") ?? "application/octet-stream";
  const bytes = await c.req.arrayBuffer();
  return c.json(await transcribeUpload(c.env, bytes, contentType));
});

// Compute the cut from the edited words. (Render via ffmpeg Container = next step.)
app.post("/api/export", async (c) => {
  const { mediaKey, words } = await c.req.json<{ mediaKey: string; words: Word[] }>();
  const ranges = keptRanges(words);
  return c.json({
    mediaKey,
    ranges,
    keptSeconds: totalSeconds(ranges),
    ffmpeg: ffmpegSelect(ranges),
    status: "edl-ready", // TODO: hand ranges to container/ to render the MP4 into R2
  });
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
