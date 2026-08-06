// ffmpeg helper (runs inside the Cloudflare Container). Two jobs, both driven by
// the Worker for long-video transcription:
//   POST /probe    { url }               -> { duration }         (source length in seconds)
//   POST /extract  { url, start, dur }   -> audio/mpeg           (mono 16kHz mp3 of that slice)
// The Worker feeds each slice to Workers AI Whisper and stitches the words.
import { spawn } from "node:child_process";
import { createServer } from "node:http";

function readJson(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch { resolve({}); } });
  });
}
function jsonError(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}

function probe(url, res) {
  const ff = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", url]);
  let out = "", err = "";
  ff.stdout.on("data", (d) => (out += d));
  ff.stderr.on("data", (d) => (err += d));
  ff.on("close", (code) => {
    const duration = parseFloat(String(out).trim());
    if (code === 0 && duration > 0) jsonError(res, 200, { duration });
    else jsonError(res, 500, { error: err.slice(-800) || "probe failed" });
  });
}

function extract(url, start, dur, res) {
  const args = [
    "-hide_banner", "-loglevel", "error",
    "-ss", String(start), "-i", url, "-t", String(dur),
    "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", "-f", "mp3", "pipe:1",
  ];
  const ff = spawn("ffmpeg", args);
  const chunks = [];
  let err = "";
  ff.stdout.on("data", (d) => chunks.push(d));
  ff.stderr.on("data", (d) => (err += d));
  ff.on("close", (code) => {
    if (code !== 0) return jsonError(res, 500, { error: err.slice(-1200) });
    const buf = Buffer.concat(chunks);
    res.writeHead(200, { "content-type": "audio/mpeg", "content-length": buf.length });
    res.end(buf);
  });
}

createServer(async (req, res) => {
  if (req.method !== "POST") { res.writeHead(405).end(); return; }
  const path = (req.url || "").split("?")[0];
  const body = await readJson(req);
  if (!body.url) return jsonError(res, 400, { error: "missing url" });
  if (path === "/probe") return probe(body.url, res);
  if (path === "/extract") return extract(body.url, body.start ?? 0, body.dur ?? 300, res);
  res.writeHead(404).end();
}).listen(8080);
