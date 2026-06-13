// Render worker (runs inside the container). Applies an EDL to a source media
// file with ffmpeg and streams the cut MP4 back to the Worker.
//
// Request:  POST  body = raw source media bytes
//                 header  x-ranges: JSON [{start,end}, ...]
// Response: 200  body = rendered MP4 (video/mp4)   |   non-2xx = JSON error
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { writeFile, readFile, unlink } from "node:fs/promises";

const IN = "/tmp/in";
const OUT = "/tmp/out.mp4";

function ffmpegArgs(ranges) {
  const between = ranges.map((r) => `between(t,${r.start},${r.end})`).join("+");
  return [
    "-hide_banner", "-loglevel", "error",
    "-i", IN,
    "-vf", `select='${between}',setpts=N/FRAME_RATE/TB`,
    "-af", `aselect='${between}',asetpts=N/SR/TB`,
    "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac",
    "-movflags", "+faststart",
    "-y", OUT,
  ];
}

function fail(res, code, payload) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

createServer((req, res) => {
  if (req.method !== "POST") { res.writeHead(405).end(); return; }

  let ranges;
  try { ranges = JSON.parse(req.headers["x-ranges"] || "[]"); }
  catch { return fail(res, 400, { ok: false, error: "x-ranges is not valid JSON" }); }
  if (!Array.isArray(ranges) || ranges.length === 0) {
    return fail(res, 400, { ok: false, error: "x-ranges must be a non-empty array" });
  }

  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("error", (e) => fail(res, 400, { ok: false, error: String(e) }));
  req.on("end", async () => {
    try {
      await writeFile(IN, Buffer.concat(chunks));
    } catch (e) { return fail(res, 500, { ok: false, error: `write input: ${e}` }); }

    const ff = spawn("ffmpeg", ffmpegArgs(ranges));
    let log = "";
    ff.stderr.on("data", (d) => (log += d));
    ff.on("close", async (code) => {
      if (code !== 0) return fail(res, 500, { ok: false, log: log.slice(-2000) });
      try {
        const buf = await readFile(OUT);
        res.writeHead(200, { "content-type": "video/mp4", "content-length": buf.length });
        res.end(buf);
      } catch (e) {
        return fail(res, 500, { ok: false, error: `read output: ${e}` });
      } finally {
        unlink(IN).catch(() => {});
        unlink(OUT).catch(() => {});
      }
    });
  });
}).listen(8080);
