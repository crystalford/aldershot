#!/usr/bin/env node
/**
 * How long does an export actually take, and how much does it move?
 *
 * This exists because I told the owner his export was probably stuck on an old
 * deploy. It was not. Measured here, the render container was pulling the
 * ENTIRE source file — about 1.5x of it — for every single cut, because
 * `-ss` before `-i` does not range-seek an mp4 over http the way the comment
 * in render.mjs claimed. A twenty-cut export of a 418MB file moved 15.4GB.
 *
 * So the claim is measured from now on rather than reasoned about. This serves
 * a generated source over a range-capable server that counts the bytes it
 * actually writes to the socket, drives the real container code, and reports
 * seconds, opens and bytes.
 *
 *   node scripts/bench-render.cjs [cuts]
 *
 * Needs ffmpeg on PATH. Generates its source once and caches it.
 */

const { spawn, spawnSync } = require("node:child_process");
const { createServer } = require("node:http");
const { createReadStream, existsSync, statSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");

const CUTS = Number(process.argv[2] || 20);
const DIR = join(__dirname, "..", ".bench");
const SRC = join(DIR, "source.mp4");
const SOURCE_PORT = 8099;
const CONTAINER_PORT = 8098;

/* Ten minutes of noisy video, which is a realistic bitrate — a flat colour
   would compress to nothing and hide the transfer this is measuring. */
function makeSource() {
  if (existsSync(SRC)) return;
  mkdirSync(DIR, { recursive: true });
  console.log("generating a 10-minute source (once)…");
  const r = spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=600",
    "-f", "lavfi", "-i", "sine=frequency=300:duration=600",
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", "-y", SRC,
  ], { stdio: "inherit" });
  if (r.status !== 0) { console.error("ffmpeg could not generate the source"); process.exit(1); }
}

/* Bytes are counted as they are WRITTEN, not as they are promised: ffmpeg asks
   for an open-ended range and then hangs up early, so counting content-length
   overstates it by several times. */
function serveSource() {
  const st = statSync(SRC);
  let opens = 0, bytes = 0;
  const server = createServer((req, res) => {
    if (req.url === "/stats") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ opens, bytes }));
    }
    opens++;
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || "");
    const start = m ? Number(m[1]) : 0;
    const end = m && m[2] ? Number(m[2]) : st.size - 1;
    const head = { "accept-ranges": "bytes", "content-length": end - start + 1, "content-type": "video/mp4" };
    if (m) head["content-range"] = `bytes ${start}-${end}/${st.size}`;
    res.writeHead(m ? 206 : 200, head);
    const s = createReadStream(SRC, { start, end });
    s.on("data", (c) => { bytes += c.length; });
    s.pipe(res);
    res.on("close", () => s.destroy());
  });
  return new Promise((r) => server.listen(SOURCE_PORT, () => r({ server, size: st.size })));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  makeSource();
  const { server, size } = await serveSource();

  const container = spawn("node", [join(__dirname, "..", "container", "render.mjs")], {
    env: { ...process.env, PORT: String(CONTAINER_PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  container.stdout.on("data", (d) => process.env.BENCH_VERBOSE && process.stdout.write(`  [container] ${d}`));
  container.stderr.on("data", (d) => process.stderr.write(`  [container] ${d}`));
  await sleep(1200);

  const url = `http://127.0.0.1:${SOURCE_PORT}/source.mp4`;
  const cuts = [];
  /* One cut per transcript line with a beat of silence between, which is the
     shape buildEdl actually emits. */
  let t = 5;
  for (let i = 0; i < CUTS; i++) {
    cuts.push({ key: "k", url, start_s: +t.toFixed(2), end_s: +(t + 3.2).toFixed(2) });
    t += 3.6;
  }
  const plan = { cuts, format: "mp4_1080", aspect: "16:9", durationS: CUTS * 3.2 };

  const stats = async () => (await fetch(`http://127.0.0.1:${SOURCE_PORT}/stats`)).json();
  const before = await stats();
  const t0 = Date.now();

  const started = await fetch(`http://127.0.0.1:${CONTAINER_PORT}/render`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(plan),
  });
  if (!started.ok) { console.error("start failed", started.status, await started.text()); process.exit(1); }
  const { id } = await started.json();

  let last = "";
  for (;;) {
    const s = await (await fetch(`http://127.0.0.1:${CONTAINER_PORT}/render/status?id=${id}`)).json();
    const line = `${s.stage} ${s.pct}% (${s.done}/${s.total})`;
    if (line !== last) { console.log(`  ${line}`); last = line; }
    if (s.error) { console.error("render failed:", s.error); process.exit(1); }
    if (s.ready) break;
    await sleep(250);
  }

  const result = await fetch(`http://127.0.0.1:${CONTAINER_PORT}/render/result?id=${id}`);
  const out = new Uint8Array(await result.arrayBuffer());
  const ms = Date.now() - t0;
  const after = await stats();

  const moved = (after.bytes - before.bytes) / 1e6;
  console.log("");
  console.log(`source        ${(size / 1e6).toFixed(0)} MB`);
  console.log(`cuts          ${CUTS}  (${(CUTS * 3.2).toFixed(0)}s of output)`);
  console.log(`time          ${(ms / 1000).toFixed(1)}s  (${(ms / CUTS).toFixed(0)}ms per cut)`);
  console.log(`transferred   ${moved.toFixed(0)} MB  over ${after.opens - before.opens} opens  (${(moved / (size / 1e6)).toFixed(2)}x the source)`);
  console.log(`output        ${(out.length / 1e6).toFixed(1)} MB, ${result.headers.get("x-duration-s")}s`);

  container.kill();
  server.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
