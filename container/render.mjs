// ffmpeg helper (runs inside the Cloudflare Container). One job, driven by the
// Worker for long-video transcription:
//   POST /extract-full  { url }  -> audio/wav (the ENTIRE audio track, mono 16kHz)
// The Worker stores this once (it's small — a couple hours of speech is only
// tens of MB) and then slices 30s chunks out of it directly via R2 range reads,
// feeding each to Workers AI Whisper. No more per-chunk container calls, which
// is what was destabilizing the container: repeatedly re-seeking into a
// multi-GB remote source for every 30s chunk.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat, unlink } from "node:fs/promises";

function readJson(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch { resolve({}); } });
  });
}
function jsonError(res, code, obj) {
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}

function extractFull(url, res) {
  const outPath = `/tmp/full-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`;
  const args = [
    "-hide_banner", "-loglevel", "error",
    "-i", url, "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", "-y", outPath,
  ];
  console.log("extract-full: starting ffmpeg for", url.slice(0, 120));
  const t0 = Date.now();
  const ff = spawn("ffmpeg", args);
  let err = "";
  ff.stderr.on("data", (d) => (err += d));
  ff.on("error", (e) => { console.error("extract-full: spawn error", e); jsonError(res, 500, { error: String(e) }); });
  ff.on("close", async (code) => {
    console.log(`extract-full: ffmpeg exited code=${code} after ${Date.now() - t0}ms`);
    if (code !== 0) return jsonError(res, 500, { error: err.slice(-1500) || "ffmpeg failed" });
    try {
      const st = await stat(outPath);
      console.log(`extract-full: wrote ${st.size} bytes, streaming response`);
      res.writeHead(200, { "content-type": "audio/wav", "content-length": String(st.size) });
      const rs = createReadStream(outPath);
      rs.pipe(res);
      rs.on("close", () => { unlink(outPath).catch(() => {}); });
      rs.on("error", (e) => { console.error("extract-full: read stream error", e); unlink(outPath).catch(() => {}); });
    } catch (e) {
      console.error("extract-full: post-ffmpeg error", e);
      jsonError(res, 500, { error: String(e) });
    }
  });
}

createServer(async (req, res) => {
  if (req.method !== "POST") { res.writeHead(405).end(); return; }
  const path = (req.url || "").split("?")[0];
  const body = await readJson(req);
  console.log(`container: ${req.method} ${path}`, body.url ? `url=${String(body.url).slice(0, 100)}` : "");
  if (!body.url) return jsonError(res, 400, { error: "missing url" });
  if (path === "/extract-full") return extractFull(body.url, res);
  res.writeHead(404).end();
}).listen(8080);
