// Render worker (runs inside the container). Applies an EDL to a source media
// file with ffmpeg and writes the cut. Invoked by the Worker over HTTP.
//
// Body: { inputUrl, ranges:[{start,end}], outputPath }
// The Worker provides a presigned R2 URL for input and collects the output.
import { spawn } from "node:child_process";
import { createServer } from "node:http";

function ffmpegArgs(input, ranges, output) {
  const between = ranges.map((r) => `between(t,${r.start},${r.end})`).join("+");
  return [
    "-i", input,
    "-vf", `select='${between}',setpts=N/FRAME_RATE/TB`,
    "-af", `aselect='${between}',asetpts=N/SR/TB`,
    "-y", output,
  ];
}

createServer((req, res) => {
  if (req.method !== "POST") { res.writeHead(405).end(); return; }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const { inputUrl, ranges, outputPath = "/tmp/out.mp4" } = JSON.parse(body);
    const ff = spawn("ffmpeg", ffmpegArgs(inputUrl, ranges, outputPath));
    let err = "";
    ff.stderr.on("data", (d) => (err += d));
    ff.on("close", (code) => {
      res.writeHead(code === 0 ? 200 : 500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: code === 0, outputPath, log: err.slice(-2000) }));
    });
  });
}).listen(8080);
