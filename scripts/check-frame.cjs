#!/usr/bin/env node
/**
 * DOES THE PICTURE FILL THE FRAME?
 *
 * Every cut used to be scaled down until it fit inside the output and the
 * remainder filled with black. For a product whose output is vertical shorts
 * that is close to a bug: a 16:9 source in a 9:16 frame came out 1080x608
 * inside 1080x1920, so the picture was about a third of the frame and the rest
 * was bars. Nothing caught it, because every automated check in this repo
 * reasons about the EDL, the plan or the DOM — and none of them had ever
 * looked at a pixel.
 *
 * This looks at pixels. It builds two fixtures whose colours make the answer
 * unambiguous, renders each through the real encoder, and reads the frame back:
 *
 *   wide → tall   a red frame with a green band across its middle. Cropped, the
 *                 top and bottom of the output are RED. Letterboxed, they are
 *                 BLACK. There is no third possibility.
 *
 *   tall → wide   solid blue. Pillarboxed, the far left and right are BLACK and
 *                 the middle is blue. If this one ever crops, a talking head
 *                 loses its head — which is why the crop is gated on the
 *                 source's real shape rather than applied to everything.
 *
 *   node scripts/check-frame.cjs
 *
 * Needs ffmpeg on PATH and boots its own encoder on a private port. Skips
 * cleanly without ffmpeg, the same rule the fidelity string check follows: a
 * check that goes red for an absent dependency teaches people to ignore red.
 */
const { spawn, spawnSync, execFileSync } = require("node:child_process");
const { mkdirSync, rmSync, readFileSync, createReadStream, statSync } = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const os = require("node:os");

const PORT = Number(process.env.FRAME_CHECK_PORT || 8078);
const HOST_PORT = Number(process.env.FRAME_FIXTURE_PORT || 8100);
const BASE = `http://127.0.0.1:${PORT}`;
const DIR = path.join(os.tmpdir(), "aldershot-frame-check");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const bad = [];
const say = (ok, name, detail) => {
  if (ok) return console.log("    ✓ " + name);
  bad.push(detail ? `${name} — ${detail}` : name);
  console.log("    ✗ " + name + (detail ? ` — ${detail}` : ""));
};

const ff = (args) => execFileSync("ffmpeg", ["-nostdin", "-y", "-v", "error", ...args], { maxBuffer: 1 << 28 });

/** The pixels of one frame, as raw RGB. */
function frameOf(file, w, h) {
  const raw = path.join(DIR, "frame.raw");
  ff(["-i", file, "-vf", "select=eq(n\\,15)", "-vframes", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", raw]);
  const d = readFileSync(raw);
  return (x, y) => {
    const i = (y * w + x) * 3;
    return [d[i], d[i + 1], d[i + 2]];
  };
}

/* Encoded colour is never exactly the colour that went in — h264 in yuv420p
   moves it a few points. These ask which corner of the cube it landed in. */
const isBlack = ([r, g, b]) => r < 24 && g < 24 && b < 24;
const isRed = ([r, g, b]) => r > 140 && g < 90 && b < 90;
const isGreen = ([r, g, b]) => g > 90 && r < 90 && b < 90;
const isBlue = ([r, g, b]) => b > 140 && r < 90 && g < 90;

async function render(encoder, url, aspect) {
  const started = await fetch(`${BASE}/render`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ format: "mp4_1080", aspect, cuts: [{ url, start_s: 0.2, end_s: 2.0 }] }),
  }).then((r) => r.json());
  if (!started.id) throw new Error("the encoder refused the plan: " + JSON.stringify(started));

  /*
   * POLLED ON A FIELD THE ENCODER DOES NOT HAVE, for as long as this file has
   * existed.
   *
   * /render/status answers { stage, pct, done, total, error, ready } — see
   * container/render.mjs:746 and the header at line 8. There is no `state`.
   * So `s.state === "done"` was never true, `s.state === "failed"` was never
   * true, and this loop ran all ninety iterations every single time before
   * falling through to fetch a file that had been ready since about the
   * second second. Two renders, ninety seconds each: the check took 3m02s to
   * do five seconds of work, and passed, so nothing ever said so.
   *
   * `done` would have been no better — in this API it is a COUNT of finished
   * parts, so it is truthy for a render still in progress.
   *
   * AND A FAILURE WAS INVISIBLE. s.error is the encoder saying what went
   * wrong; nothing read it, so a failed render waited the full ninety seconds
   * and then reported "no file came back" — the symptom, two minutes after
   * the cause was available in plain words.
   *
   * Exhausting the loop is now an error rather than a shrug. If this ever
   * stops matching the encoder again, it says so in a second instead of
   * costing three minutes and saying nothing.
   */
  let ready = false;
  for (let i = 0; i < 90; i++) {
    const s = await fetch(`${BASE}/render/status?id=${started.id}`).then((r) => r.json());
    if (s.error) throw new Error("the render failed: " + s.error);
    if (s.ready) { ready = true; break; }
    await sleep(1000);
  }
  if (!ready) throw new Error("the encoder never reported ready — 90s of polling and no file");

  const out = path.join(DIR, `out-${aspect.replace(":", "x")}.mp4`);
  const res = await fetch(`${BASE}/render/result?id=${started.id}`);
  if (!res.ok) throw new Error("no file came back");
  require("node:fs").writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  return out;
}

async function main() {
  if (spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).error) {
    console.log("⚠ frame — SKIPPED: ffmpeg is not on PATH.");
    return;
  }

  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });

  /* Wide: red, with a green band across the middle third. */
  const wide = path.join(DIR, "wide.mp4");
  ff(["-f", "lavfi", "-i", "color=c=red:s=1280x720:d=3:r=30",
      "-f", "lavfi", "-i", "color=c=green:s=1280x200:d=3:r=30",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
      "-filter_complex", "[0:v][1:v]overlay=0:260[v]", "-map", "[v]", "-map", "2:a",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", wide]);

  /* Tall: solid blue. */
  const tall = path.join(DIR, "tall.mp4");
  ff(["-f", "lavfi", "-i", "color=c=blue:s=720x1280:d=3:r=30",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", tall]);

  /* A host for them, because the encoder takes urls. */
  const host = http.createServer((req, res) => {
    const f = path.join(DIR, path.basename(req.url.split("?")[0]));
    try {
      res.writeHead(200, { "content-type": "video/mp4", "content-length": statSync(f).size });
      createReadStream(f).pipe(res);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => host.listen(HOST_PORT, "127.0.0.1", r));

  const encoder = spawn("node", [path.join(__dirname, "..", "container", "render.mjs")], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let err = "";
  encoder.stderr.on("data", (d) => (err += d));
  let dead = false;
  encoder.on("exit", () => (dead = true));

  let up = false;
  for (let i = 0; i < 60 && !dead; i++) {
    try { await fetch(`${BASE}/render/status?id=boot`); up = true; break; } catch { await sleep(150); }
  }
  if (!up) {
    console.log("\n✘ frame — the encoder does not start.");
    console.log((err || "(no output)").split("\n").map((l) => "    " + l).join("\n"));
    encoder.kill(); host.close();
    process.exit(1);
  }

  const src = `http://127.0.0.1:${HOST_PORT}`;

  try {
    console.log("  a 16:9 source in a 9:16 frame");
    const out = await render(encoder, `${src}/wide.mp4`, "9:16");
    const at = frameOf(out, 1080, 1920);
    say(!isBlack(at(540, 10)) && !isBlack(at(540, 1910)),
      "the picture reaches the top and bottom edges",
      `got ${at(540, 10)} and ${at(540, 1910)} — black means it is letterboxed`);
    say(isRed(at(540, 10)) && isRed(at(540, 1910)), "and it is the source's own picture there");
    say(isGreen(at(540, 960)), "with the middle of the source still in the middle");
  } catch (e) {
    say(false, "a 16:9 source renders as 9:16", e.message);
  }

  try {
    console.log("  a 9:16 source in a 16:9 frame");
    const out = await render(encoder, `${src}/tall.mp4`, "16:9");
    const at = frameOf(out, 1920, 1080);
    /* The one that must NOT crop. Cropping here takes a band across the middle
       of a vertical shot, which on real footage removes the speaker's head. */
    say(isBlack(at(10, 540)) && isBlack(at(1910, 540)),
      "a taller-than-wide source is boxed at the sides, not cropped",
      `got ${at(10, 540)} and ${at(1910, 540)} — the sides should be black`);
    say(isBlue(at(960, 540)), "and the whole of it survives in the middle");
  } catch (e) {
    say(false, "a 9:16 source renders as 16:9", e.message);
  }

  if (dead) bad.push("the encoder exited while rendering");
  encoder.kill();
  host.close();

  if (bad.length) {
    console.log("\n✘ frame — the output does not look like it should.");
    console.log(bad.map((b) => "    " + b).join("\n"));
    if (err.trim()) console.log("\n    stderr:\n" + err.split("\n").map((l) => "      " + l).join("\n"));
    process.exit(1);
  }
  console.log("✔ frame — the picture fills the frame, and only where filling is right");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
