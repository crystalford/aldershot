#!/usr/bin/env node
/**
 * DOES FORCED ALIGNMENT ACTUALLY ALIGN ANYTHING?
 *
 * Everything else about alignment is tested without touching a model: the
 * windows, the stitch, the repair, the write-back. That is right — they are
 * the decisions — and it leaves the one question nobody else asks. The
 * container could decode the wrong bytes, slice at the wrong offset, or
 * return a window's seconds as a window's milliseconds, and every test in
 * this repo would still pass.
 *
 * So this drives the real thing: container/align.mjs over container/align.py
 * over a real model and a real file with a known transcript, and checks the
 * times against a reading taken by hand.
 *
 * IT IS NOT IN `npm run check`, because it needs a 1.26 GB model and a torch
 * install, and a gate that cannot run is a gate people learn to skip. It is
 * in the build order's acceptance instead, and this is how it is run:
 *
 *   python3 -m venv /tmp/align-venv
 *   /tmp/align-venv/bin/pip install --index-url https://download.pytorch.org/whl/cpu \
 *       torch torchaudio && /tmp/align-venv/bin/pip install numpy soundfile
 *   curl -fsSLO https://download.pytorch.org/torchaudio/tutorial-assets/\
 *       Lab41-SRI-VOiCES-src-sp0307-ch127535-sg0042.wav
 *   ALIGN_PYTHON=/tmp/align-venv/bin/python ALIGN_WAV=./Lab41-....wav \
 *       node scripts/check-align.cjs
 *
 * Exits non-zero on any finding.
 *
 * WHAT IT DELIBERATELY DOES NOT CATCH. Omitting the 44-byte WAV header from
 * the slice offset shifts every word 1.4 ms early, and this passes — because
 * 1.4 ms is inside the 20 ms a forced timing is worth (src/align.ts) and far
 * inside the 40 ms frame this check exists to defend. Widening the bands
 * until it fired would make every real failure invisible. It is recorded
 * here so the next person to break it on purpose knows the silence is a
 * decision rather than a hole.
 */
const path = require("path");
const fs = require("fs");

const WAV = process.env.ALIGN_WAV;
const PY = process.env.ALIGN_PYTHON;
if (!WAV || !fs.existsSync(WAV) || !PY || !fs.existsSync(PY)) {
  console.log("⚠ align — SKIPPED: set ALIGN_PYTHON and ALIGN_WAV. See the header of this file.");
  process.exit(0);
}
process.env.ALIGN_SCRIPT = process.env.ALIGN_SCRIPT || path.join(__dirname, "..", "container", "align.py");

/*
 * THE READING, AND ONE FRAME EITHER SIDE OF IT.
 *
 * "I had that curiosity beside me at this moment", from the VOiCES corpus
 * clip torchaudio ships with its alignment tutorial. The numbers are what
 * this aligner returns over the whole clip in one window, read off once; the
 * tolerance is FRAME_MS, which is Phase 1's acceptance written as a number:
 * "word timings within one frame".
 *
 * A WIDER BAND WOULD PROVE NOTHING. The first version allowed ±100 ms, and
 * decoding the audio at 8 kHz instead of 16 passed it — the model is robust
 * enough to absorb that, and a check that absorbs it with the model is a
 * check that only notices a catastrophe. One frame is the promise, so one
 * frame is the band, and a model or bundle that moves a word further than
 * that SHOULD fail this: that is the gate a model swap has to pass.
 */
const FRAME_MS = 40;
const TRUTH = [
  ["i", 0.644, 0.664],
  ["had", 0.704, 0.845],
  ["that", 0.885, 1.026],
  ["curiosity", 1.086, 1.791],
  ["beside", 1.871, 2.314],
  ["me", 2.334, 2.414],
  ["at", 2.495, 2.575],
  ["this", 2.595, 2.756],
  ["moment", 2.837, 3.138],
];

async function main() {
  /*
   * THE DECODE THE LAST RUN LEFT BEHIND IS NOT THIS RUN'S.
   *
   * align.mjs keeps the decoded PCM between calls, keyed by the url, so a
   * ten-hour source is not decoded again for every batch of windows. In a
   * container that is right and the instance is thrown away afterwards; here
   * the file outlives the code, and this check spent three runs passing a
   * deliberately broken decode because it was reading the previous one's.
   */
  for (const f of fs.readdirSync("/tmp")) {
    if (f.startsWith("align-") && f.endsWith(".wav")) fs.rmSync(`/tmp/${f}`, { force: true });
  }

  /*
   * ONE WINDOW OVER THE WHOLE CLIP, and a second over its tail, because the
   * offset arithmetic is the part a single window cannot test: a window
   * starting at zero returns the right answer whether or not its start is
   * added back.
   */
  /*
   * A NUMBER IN THE MIDDLE OF THE WORDS.
   *
   * The model has no letters for "42", so it cannot be placed — and the
   * thing that must not happen is for it to quietly take the span of the
   * word beside it. Without this the whole list would shift by one from
   * here on and every remaining word would fail, which is how a silent
   * version of this bug announces itself. It is in the middle rather than
   * at the end because at the end nothing comes after it to shift.
   */
  const spoken = TRUTH.map((t) => t[0]);
  const withGap = [...spoken.slice(0, 4), "42", ...spoken.slice(4)];

  /*
   * ONE WINDOW OVER THE WHOLE CLIP, and a second over its tail, because the
   * offset arithmetic is the part a single window cannot test: a window
   * starting at zero returns the right answer whether or not its start is
   * added back.
   */
  const windows = [
    { startMs: 0, endMs: 3400, words: withGap },
    { startMs: 2000, endMs: 3400, words: ["at", "this", "moment"] },
  ];

  const res = await post({ url: path.resolve(WAV), windows });
  if (res.status !== 200) {
    fail(`/align answered ${res.status}: ${JSON.stringify(res.body).slice(0, 300)}`);
    return;
  }

  const [whole, tail] = res.body.results;
  if (!whole?.ok) return fail(`the whole-clip window failed: ${whole?.error}`);
  if (!tail?.ok) return fail(`the tail window failed: ${tail?.error}`);

  let bad = 0;
  if (whole.timings.length !== withGap.length) {
    console.log(`  ✘ ${withGap.length} words in, ${whole.timings.length} timings out — everything after the gap is shifted`);
    bad += 1;
  }
  if (whole.timings[4] !== null) {
    console.log("  ✘ \"42\" was placed somewhere, and it has no letters to place");
    bad += 1;
  }

  /* The spoken words, with the unalignable one taken back out. */
  const spokenTimings = whole.timings.filter((_, i) => i !== 4);
  spokenTimings.forEach((t, i) => {
    const [word, lo, hi] = TRUTH[i];
    if (!t) { console.log(`  ✘ ${word} — not placed at all`); bad += 1; return; }
    const [s, e] = t;
    const off = Math.max(Math.abs(s - lo), Math.abs(e - hi)) * 1000;
    if (off > FRAME_MS) {
      console.log(`  ✘ ${word} — ${s.toFixed(3)}–${e.toFixed(3)}, ${off.toFixed(0)}ms from ${lo}–${hi} (one frame is ${FRAME_MS}ms)`);
      bad += 1;
    } else if (e < s) {
      console.log(`  ✘ ${word} — ends before it starts`);
      bad += 1;
    }
  });

  /*
   * AND THE SAME WORDS, FROM A WINDOW THAT STARTS TWO SECONDS IN.
   *
   * These come back as seconds inside THAT window, so "at" should read about
   * 0.5 rather than about 2.5. A container that returned source time would
   * be adding the offset twice once src/align.ts stitched it.
   */
  const at = tail.timings[0];
  if (!at) { console.log("  ✘ the tail window placed nothing"); bad += 1; }
  else if (at[0] > 1.5) {
    console.log(`  ✘ the tail window returned ${at[0].toFixed(3)}s — that is source time, not window time`);
    bad += 1;
  }

  /*
   * AND THE SAME CLIP IN STEREO, because the fixture is mono and a mono
   * fixture cannot tell you whether anything asked for mono.
   *
   * Dropping `-ac 1` from the decode passed everything above: ffmpeg gives
   * back the channels it was given, so a mono source hid the missing
   * argument completely. A stereo source does not, and the format read-back
   * in align.mjs is what turns it into an answer instead of audio that the
   * aligner reads at half speed.
   */
  /* NOT named align-*.wav: dropOtherDecodes in align.mjs deletes every one of
     those when it decodes a new source, and the first version of this had it
     delete the stereo file it was about to be pointed at. */
  const stereo = `/tmp/stereo-check-${process.pid}.wav`;
  await new Promise((resolve) => {
    require("node:child_process")
      .spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", path.resolve(WAV), "-ac", "2", "-y", stereo])
      .on("exit", resolve);
  });
  if (fs.existsSync(stereo)) {
    const s2 = await post({ url: stereo, windows: [windows[0]] });
    fs.rmSync(stereo, { force: true });
    if (s2.status !== 200) {
      console.log(`  ✘ a stereo source was refused: ${JSON.stringify(s2.body).slice(0, 200)}`);
      bad += 1;
    } else {
      const w2 = s2.body.results[0];
      const first = w2?.ok && w2.timings[0];
      if (!first || Math.abs(first[0] - TRUTH[0][1]) * 1000 > FRAME_MS) {
        console.log(`  ✘ a stereo source aligned differently — the decode is not being mixed to mono`);
        bad += 1;
      }
    }
  }

  if (bad) return fail(`${bad} word(s) outside the hand reading`);
  console.log(`✔ align — ${TRUTH.length} words placed inside the hand reading, window offsets honoured, stereo mixed down`);
}

function post(body) {
  return new Promise((resolve) => {
    const res = {
      headersSent: false,
      writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true; return this; },
      end(text) { resolve({ status: this.status, body: JSON.parse(text) }); },
      destroy() { resolve({ status: 0, body: {} }); },
    };
    const json = (r, code, obj) => { r.writeHead(code, {}); r.end(JSON.stringify(obj)); };
    import("../container/align.mjs").then(({ alignHandler }) => alignHandler(body, res, json, json));
  });
}

function fail(msg) {
  console.log(`✘ align — ${msg}`);
  process.exitCode = 1;
}

main().then(() => process.exit(process.exitCode || 0));
