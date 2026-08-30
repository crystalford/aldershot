// ffmpeg helper, running inside the Cloudflare Container. Two jobs, both
// driven by the Worker:
//
//   POST /extract-full  { url }        -> audio/mpeg (the whole track, 32kbps mono 16kHz)
//   POST /render        { plan }       -> video/mp4  (the cut, per the EDL)
//
// The Worker cannot run ffmpeg, and a long source cannot be pulled into a
// Worker at all — a ten-hour video is tens of gigabytes. So the container does
// the two things that need a real filesystem and a real encoder, and nothing
// else. Everything about WHAT to cut is decided in src/edl.ts and arrives here
// as data.
//
// Why MP3 rather than WAV for the audio: the Worker chunks long audio by
// parsing MP3 frame headers (src/mp3.ts), which gives exact cut points and
// exact start times. It also keeps ten hours at ~137MB instead of ~1.2GB of
// WAV. Measured against the real Whisper endpoint — see
// docs/decisions/transcription.md.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createReadStream, mkdirSync, writeFileSync } from "node:fs";
import { rm, stat, unlink } from "node:fs/promises";


/**
 * POST /render
 *
 * Body: { cuts: [{ url, start_s, end_s }], format, aspect }
 *
 * Cuts each range to its own file and concatenates them. The obvious
 * alternative — one giant filter_complex with trim/concat — is faster on
 * paper but fails opaquely on long inputs and is far harder to reason about
 * when a single range is wrong. This way each range is an independent step:
 * one bad range fails visibly instead of corrupting the whole output.
 *
 * The ranges are re-encoded (not stream-copied) because a copy can only cut on
 * keyframes, which would shift every cut point by up to several seconds — the
 * user struck a word, so the cut has to land on that word.
 */
function render(plan, res) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const dir = `/tmp/render-${id}`;
  const cuts = Array.isArray(plan?.cuts) ? plan.cuts : [];
  if (!cuts.length) return jsonError(res, 400, { error: "nothing to render" });

  const SIZE = { mp4_1080: "1920:1080", mp4_720: "1280:720", mp4_4k: "3840:2160" };
  const scale = SIZE[plan.format] || SIZE.mp4_1080;
  const [w, h] = plan.aspect === "9:16" ? ["1080", "1920"]
    : plan.aspect === "1:1" ? ["1080", "1080"]
    : plan.aspect === "4:5" ? ["1080", "1350"]
    : scale.split(":");

  mkdirSync(dir, { recursive: true });

  const runFfmpeg = (args) =>
    new Promise((resolve, reject) => {
      const ff = spawn("ffmpeg", args);
      let err = "";
      ff.stderr.on("data", (d) => (err += d));
      ff.on("error", reject);
      ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-800)))));
    });

  (async () => {
    const t0 = Date.now();
    const parts = [];
    try {
      for (const [i, cut] of cuts.entries()) {
        const out = `${dir}/part-${String(i).padStart(4, "0")}.mp4`;
        await runFfmpeg([
          "-hide_banner", "-loglevel", "error",
          // -ss before -i seeks fast, and works over http by range request —
          // which is what makes cutting from a multi-GB remote source viable.
          "-ss", String(cut.start_s), "-to", String(cut.end_s), "-i", cut.url,
          "-vf", `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1`,
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
          "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
          "-avoid_negative_ts", "make_zero", "-y", out,
        ]);
        parts.push(out);
      }

      // The concat demuxer takes a file list; quotes are escaped because a
      // path is data, not shell.
      const listPath = `${dir}/list.txt`;
      writeFileSync(listPath, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));

      const outPath = `${dir}/out.mp4`;
      await runFfmpeg([
        "-hide_banner", "-loglevel", "error",
        "-f", "concat", "-safe", "0", "-i", listPath,
        // Every part was encoded identically above, so a stream copy here is
        // exact and costs nothing.
        "-c", "copy", "-movflags", "+faststart", "-y", outPath,
      ]);

      const st = await stat(outPath);
      console.log(`render: ${cuts.length} cuts, ${st.size} bytes, ${Date.now() - t0}ms`);
      res.writeHead(200, { "content-type": "video/mp4", "content-length": String(st.size) });
      createReadStream(outPath).pipe(res).on("close", () => rm(dir, { recursive: true, force: true }));
    } catch (e) {
      console.error("render failed:", e);
      await rm(dir, { recursive: true, force: true }).catch(() => {});
      jsonError(res, 500, { error: String(e?.message || e) });
    }
  })();
}

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
  const outPath = `/tmp/full-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`;
  const args = [
    "-hide_banner", "-loglevel", "error",
    "-i", url, "-vn", "-ac", "1", "-ar", "16000",
    // 32kbps mono is plenty for speech recognition and keeps the file small
    // enough that the Worker can chunk it by byte range. CBR so that frame
    // headers stay uniform and the frame index stays cheap to build.
    "-codec:a", "libmp3lame", "-b:a", "32k", "-write_xing", "0",
    "-f", "mp3", "-y", outPath,
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
      res.writeHead(200, { "content-type": "audio/mpeg", "content-length": String(st.size) });
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

// "Enhance audio" — a Studio-Sound-style one-click cleanup pass: rumble/click
// removal, RNNoise denoise, a touch of presence EQ, leveling, then two-pass-
// equivalent loudness normalization to a podcast target (-16 LUFS / -1.5dBTP)
// and a safety limiter. Order matters — denoise before EQ (boosting frequencies
// before cleanup just makes the noise there louder and harder to remove) and
// loudness normalization last (it should measure/level the already-cleaned
// signal, not fight the raw one). Video stream (if any) is copied untouched;
// -shortest trims the ~5-10ms of trailing padding audio filters add so audio
// doesn't run long against the copied video track.
const ENHANCE_FILTERS = [
  "highpass=f=80",
  "adeclick",
  "adeclip",
  "arnndn=m=/app/std.rnnn:mix=0.8",
  "equalizer=f=3000:t=q:w=1:g=2",
  "acompressor=threshold=-18dB:ratio=3:attack=5:release=50",
  "loudnorm=I=-16:TP=-1.5:LRA=11",
  "alimiter=limit=-1.5dB",
].join(",");

function enhanceAudio(url, res) {
  const outPath = `/tmp/enh-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`;
  const args = [
    "-hide_banner", "-loglevel", "error",
    "-i", url,
    "-map", "0:v?", "-c:v", "copy",
    "-map", "0:a", "-af", ENHANCE_FILTERS, "-c:a", "aac", "-b:a", "192k",
    "-shortest", "-f", "mp4", "-y", outPath,
  ];
  console.log("enhance-audio: starting ffmpeg for", url.slice(0, 120));
  const t0 = Date.now();
  const ff = spawn("ffmpeg", args);
  let err = "";
  ff.stderr.on("data", (d) => (err += d));
  ff.on("error", (e) => { console.error("enhance-audio: spawn error", e); jsonError(res, 500, { error: String(e) }); });
  ff.on("close", async (code) => {
    console.log(`enhance-audio: ffmpeg exited code=${code} after ${Date.now() - t0}ms`);
    if (code !== 0) return jsonError(res, 500, { error: err.slice(-1500) || "ffmpeg failed" });
    try {
      const st = await stat(outPath);
      console.log(`enhance-audio: wrote ${st.size} bytes, streaming response`);
      res.writeHead(200, { "content-type": "video/mp4", "content-length": String(st.size) });
      const rs = createReadStream(outPath);
      rs.pipe(res);
      rs.on("close", () => { unlink(outPath).catch(() => {}); });
      rs.on("error", (e) => { console.error("enhance-audio: read stream error", e); unlink(outPath).catch(() => {}); });
    } catch (e) {
      console.error("enhance-audio: post-ffmpeg error", e);
      jsonError(res, 500, { error: String(e) });
    }
  });
}

createServer(async (req, res) => {
  if (req.method !== "POST") { res.writeHead(405).end(); return; }
  const path = (req.url || "").split("?")[0];
  const body = await readJson(req);
  console.log(`container: ${req.method} ${path}`, body.url ? `url=${String(body.url).slice(0, 100)}` : `cuts=${body.cuts?.length ?? 0}`);

  // /render takes a plan rather than a single url, so the url check only
  // applies to the endpoints that do take one.
  if (path === "/render") return render(body, res);

  if (!body.url) return jsonError(res, 400, { error: "missing url" });
  if (path === "/extract-full") return extractFull(body.url, res);
  if (path === "/enhance-audio") return enhanceAudio(body.url, res);
  res.writeHead(404).end();
}).listen(8080);
