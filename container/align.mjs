// Forced alignment inside the container: decode once, slice, and feed a
// Python process that holds the model.
//
//   POST /align  { url, windows: [{ startMs, endMs, words: [...] }] }
//              -> { results: [{ ok, timings?, error? }], decodeMs, alignMs }
//
// WHAT TO ALIGN IS DECIDED IN src/align.ts AND ARRIVES HERE AS DATA, which
// is the same split render.mjs makes with the EDL and for the same reason:
// the decisions are the part worth testing, and a decision taken inside a
// container is a decision no test in this repo can reach.
//
// The audio is decoded ONCE to 16 kHz mono 16-bit PCM — the rate the model
// wants — and every window is then a byte range of that file. Thirty-two
// thousand bytes a second, a fixed 44-byte header: a window's offset is
// arithmetic, not a second ffmpeg pass. Ten hours is 1.15 GB on a disk with
// twenty.
import { spawn } from "node:child_process";
import { existsSync, openSync, readSync, closeSync, writeFileSync, readdirSync } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";

const RATE = 16000;
const BYTES_PER_SAMPLE = 2;
const BYTES_PER_MS = (RATE * BYTES_PER_SAMPLE) / 1000;
const HEADER = 44;

/** The model, loaded once, for the life of the container. */
let py = null;
let pyQueue = [];
let pyBuf = "";

/*
 * ONE PROCESS, STARTED LAZILY.
 *
 * Loading 1.26 GB takes about ten seconds, and a container that paid it at
 * boot would pay it for every proxy and every render too — most of what this
 * container does has nothing to do with alignment. So it starts on the first
 * /align and stays for the life of the instance.
 */
function python() {
  if (py) return py;
  /* The image's venv, unless something is driving this file outside the
     image — scripts/check-align.cjs does, with a venv of its own, because
     there is no way to build a 3 GB container in a test. */
  const bin = process.env.ALIGN_PYTHON || "/opt/venv/bin/python";
  const script = process.env.ALIGN_SCRIPT || "/app/align.py";
  py = spawn(bin, [script], { stdio: ["pipe", "pipe", "inherit"] });
  py.stdout.setEncoding("utf8");
  py.stdout.on("data", (chunk) => {
    pyBuf += chunk;
    let nl;
    while ((nl = pyBuf.indexOf("\n")) >= 0) {
      const line = pyBuf.slice(0, nl);
      pyBuf = pyBuf.slice(nl + 1);
      const waiter = pyQueue.shift();
      if (!waiter) continue;
      try {
        waiter.resolve(JSON.parse(line));
      } catch {
        waiter.resolve({ ok: false, error: "the aligner said something that is not JSON" });
      }
    }
  });
  /*
   * A DEAD ALIGNER FAILS EVERY WAITER, LOUDLY.
   *
   * Killed for memory, or a model that will not load: without this, every
   * window in flight waits for a line that is never coming and the request
   * hangs until something upstream gives up — which is the silent partial
   * failure invariant 7 calls a P1.
   */
  const die = (why) => {
    const waiting = pyQueue;
    pyQueue = [];
    py = null;
    pyBuf = "";
    for (const w of waiting) w.resolve({ ok: false, error: `the aligner ${why}` });
  };
  py.on("exit", (code, signal) => die(`stopped (code ${code}, signal ${signal})`));
  py.on("error", (e) => die(`could not start: ${e.message}`));
  return py;
}

function alignOne(wav, words) {
  return new Promise((resolve) => {
    const p = python();
    pyQueue.push({ resolve });
    p.stdin.write(JSON.stringify({ wav, words }) + "\n");
  });
}

/** A WAV header for raw 16 kHz mono PCM, so the aligner can read a slice. */
function wavHeader(bytes) {
  const h = Buffer.alloc(HEADER);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + bytes, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * BYTES_PER_SAMPLE, 28);
  h.writeUInt16LE(BYTES_PER_SAMPLE, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(bytes, 40);
  return h;
}

function decode(url, out) {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-nostdin",
      "-i", url,
      "-vn", "-ac", "1", "-ar", String(RATE),
      "-c:a", "pcm_s16le", "-f", "wav",
      "-y", out,
    ]);
    let err = "";
    ff.stderr.on("data", (d) => { err += d; });
    ff.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-400) || `ffmpeg exited ${code}`))));
    ff.on("error", reject);
  });
}

/*
 * THE DECODED AUDIO IS KEPT BETWEEN CALLS, AND ONLY ONE IS.
 *
 * A ten-hour source is a few thousand windows and arrives in batches, so
 * that the Worker can report progress and so no one request runs for half an
 * hour. Decoding the whole file again for each batch would be most of the
 * work: ten hours of PCM is 1.15 GB and several minutes of ffmpeg.
 *
 * It is keyed by a hash of the URL rather than by the URL, because a
 * presigned URL carries a signature that changes while the file does not —
 * so the key is the path, with the query thrown away.
 *
 * And exactly one is kept. A container has 20 GB of disk and no idea when a
 * source is finished with, so the arrival of a new one is the only signal
 * there is that the last is done.
 */
function audioKey(url) {
  let path = url;
  try {
    const u = new URL(url);
    path = u.origin + u.pathname;
  } catch {
    /* Not a URL we can parse is still a string we can hash. */
  }
  return createHash("sha256").update(path).digest("hex").slice(0, 32);
}

function dropOtherDecodes(keep) {
  for (const f of readdirSync("/tmp")) {
    if (f.startsWith("align-") && f.endsWith(".wav") && f !== keep) {
      rm(`/tmp/${f}`, { force: true }).catch(() => {});
    }
  }
}

/*
 * THE DECODE REALLY IS WHAT THE MODEL WANTS.
 *
 * ffmpeg was told 16 kHz mono 16-bit, and nothing checked that it obliged —
 * so a drifted argument, a container built from an older file, a filter that
 * changed the rate, all produced audio the aligner then read at the wrong
 * speed. The symptom is subtle enough to be the worst kind: at 8 kHz the
 * model still places every word, just slightly wrong, and
 * scripts/check-align.cjs passed it because a slight error is inside the one
 * frame this product promises.
 *
 * So it is read back. Sixteen bytes of header, compared against the three
 * numbers the slicing arithmetic below depends on.
 */
function checkFormat(file) {
  const fd = openSync(file, "r");
  try {
    const h = Buffer.alloc(HEADER);
    readSync(fd, h, 0, HEADER, 0);
    if (h.toString("ascii", 0, 4) !== "RIFF" || h.toString("ascii", 8, 12) !== "WAVE") {
      return "the decoder did not produce a WAV";
    }
    const channels = h.readUInt16LE(22);
    const rate = h.readUInt32LE(24);
    const bits = h.readUInt16LE(34);
    if (rate !== RATE) return `the decode came back at ${rate} Hz, not ${RATE}`;
    if (channels !== 1) return `the decode came back with ${channels} channels, not 1`;
    if (bits !== 16) return `the decode came back at ${bits} bits, not 16`;
    return null;
  } finally {
    closeSync(fd);
  }
}

export async function alignHandler(body, res, json, jsonError) {
  const windows = Array.isArray(body.windows) ? body.windows : [];
  if (!body.url) return jsonError(res, 400, { error: "missing url" });
  if (!windows.length) return jsonError(res, 400, { error: "no windows to align" });

  const name = `align-${audioKey(body.url)}.wav`;
  const full = `/tmp/${name}`;
  const slice = `/tmp/align-slice-${randomUUID()}.wav`;
  const t0 = Date.now();
  const cached = existsSync(full);
  if (!cached) {
    dropOtherDecodes(name);
    try {
      await decode(body.url, full);
    } catch (e) {
      await rm(full, { force: true });
      return jsonError(res, 422, { error: `could not decode the audio: ${e.message}` });
    }
  }
  const decodeMs = Date.now() - t0;
  const wrong = checkFormat(full);
  if (wrong) {
    await rm(full, { force: true });
    return jsonError(res, 500, { error: wrong });
  }
  const size = (await stat(full)).size;

  const t1 = Date.now();
  const results = [];
  const fd = openSync(full, "r");
  try {
    for (const w of windows) {
      const from = HEADER + Math.max(0, Math.floor(w.startMs * BYTES_PER_MS)) * 1;
      const to = Math.min(size, HEADER + Math.ceil(w.endMs * BYTES_PER_MS));
      const bytes = Math.max(0, to - from);
      /*
       * A WINDOW PAST THE END OF THE AUDIO IS NOT AN ERROR TO THROW ON.
       *
       * The last window's pad runs past the file, and a recogniser that
       * over-reported a duration puts a whole window there. It is reported,
       * and those words keep the timing they had — which is what the stitch
       * in src/align.ts already does with a window that did not answer.
       */
      if (bytes < BYTES_PER_MS * 20) {
        results.push({ ok: false, error: "no audio in that window" });
        continue;
      }
      const pcm = Buffer.alloc(bytes);
      readSync(fd, pcm, 0, bytes, from);
      writeFileSync(slice, Buffer.concat([wavHeader(bytes), pcm]));
      results.push(await alignOne(slice, w.words || []));
    }
  } finally {
    closeSync(fd);
    /* The slice is per-request and goes; the decode stays for the next
       batch of the same source. */
    await rm(slice, { force: true });
  }

  json(res, 200, { results, decodeMs, cached, alignMs: Date.now() - t1 });
}
