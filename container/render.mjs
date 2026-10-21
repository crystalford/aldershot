// ffmpeg helper, running inside the Cloudflare Container. Two jobs, both
// driven by the Worker:
//
//   POST /align          { url, windows } -> { results }  (forced alignment; see align.mjs)
//   POST /extract-full   { url }       -> audio/mpeg (the whole track, 32kbps mono 16kHz)
//   POST /proxy          { url }       -> video/mp4  (480p editing copy, + x-width/x-height)
//   POST /render         { plan }      -> { id }     (starts a cut, per the EDL)
//   GET  /render/status  ?id=          -> { stage, pct, done, total, error, ready }
//   GET  /render/result  ?id=          -> video/mp4
//
// A render answers immediately with an id and is polled, rather than holding
// one fetch open for the whole encode. That is what lets the export bar report
// parts actually finished — it used to sit on 30% from the first frame to the
// last, because 30% was the moment before this was called.
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
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { rm, stat, unlink } from "node:fs/promises";
import { alignHandler } from "./align.mjs";

/**
 * Captions, burned in.
 *
 * A short is watched on mute, so captions are not a nicety — they are the
 * whole reason it lands. They are burned into the pixels rather than shipped
 * as a track because no social platform reads a sidecar file.
 *
 * The cues arrive already in OUTPUT time (see buildSrt in src/edl.ts), so this
 * only has to draw them. Two styles, per the design: Bold and Clean.
 */
function writeAssFile(dir, cues, style, w, h) {
  const assTime = (ms) => {
    const t = Math.max(0, Math.round(ms));
    const h2 = Math.floor(t / 3600000);
    const m = Math.floor((t % 3600000) / 60000);
    const sec = Math.floor((t % 60000) / 1000);
    const cs = Math.floor((t % 1000) / 10);
    const p = (n, w2 = 2) => String(n).padStart(w2, "0");
    return `${h2}:${p(m)}:${p(sec)}.${p(cs)}`;
  };

  // Sized against the video height so captions look the same at 720 and 4K.
  const fontSize = Math.round(h * (style === "Bold" ? 0.055 : 0.042));
  const marginV = Math.round(h * 0.12);
  // Side margins scale with WIDTH, not height. A fixed 60px is fine at 1080
  // wide and far too tight once the font scales up — the first render
  // overflowed both edges of a 9:16 short.
  const marginH = Math.round(w * 0.08);
  const styleLine =
    style === "Bold"
      ? `Style: Cap,Instrument Sans,${fontSize},&H00FFFFFF,&H00FFFFFF,&H00101013,&H96000000,-1,0,0,0,100,100,0,0,3,${Math.round(fontSize * 0.14)},0,2,${marginH},${marginH},${marginV},1`
      : `Style: Cap,Instrument Sans,${fontSize},&H00FFFFFF,&H00FFFFFF,&H00101013,&H64000000,0,0,0,0,100,100,0,0,1,${Math.round(fontSize * 0.08)},0,2,${marginH},${marginH},${marginV},1`;

  const header = [
    "[Script Info]", "ScriptType: v4.00+", `PlayResX: ${w}`, `PlayResY: ${h}`,
    // 0 is smart wrapping. 2 means "never wrap, only break on \\N", which is
    // what made the first captioned render run straight off both edges.
    "WrapStyle: 0", "",
    "[V4+ Styles]",
    "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
    styleLine, "",
    "[Events]",
    "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
  ].join("\n");

  const events = cues
    .filter((c) => c.text && c.text.trim())
    .map((c) => {
      // Commas and newlines are field separators in ASS, so they are escaped
      // rather than left to corrupt the line.
      const text = String(c.text).replace(/\r?\n/g, " ").replace(/,/g, "\\,").trim();
      return `Dialogue: 0,${assTime(c.start_ms)},${assTime(c.end_ms)},Cap,,0,0,0,,${text}`;
    })
    .join("\n");

  const path = `${dir}/captions.ass`;
  writeFileSync(path, `${header}\n${events}\n`);
  return path;
}

/**
 * How many parts encode at once, and how many threads each gets.
 *
 * The container has four vCPUs (wrangler.jsonc pins instance_type to
 * standard-4). libx264 left alone counts the HOST's cores and spawns that
 * many threads, which inside a cgroup that does not have them is pure context
 * switching — so the thread count is stated rather than detected. Two parts
 * of two threads each fills the box and keeps one part's process teardown
 * from being dead time. Both are environment-tunable because the right
 * numbers follow the instance type, and that is config rather than code.
 */
const LANES = Math.max(1, Number(process.env.ENCODE_LANES) || 2);
const FF_THREADS = Math.max(1, Number(process.env.FF_THREADS) || 2);

/**
 * How much of the container's disk a downloaded source may use.
 *
 * standard-4 has 20 GB. The parts and the finished file need room too, and
 * two renders can share an instance if their names collide, so this claims
 * a little over half of it. Anything larger falls back to reading over HTTP
 * per cut — slow, but it is the path that has always worked and it has no
 * disk floor.
 */
const DISK_BUDGET = Number(process.env.SOURCE_DISK_BUDGET) || 12 * 1024 * 1024 * 1024;

/**
 * Every render in flight, by id.
 *
 * The Worker used to hold ONE fetch open for the whole encode and had nothing
 * to show meanwhile: `runRender` advanced the job to 30%, called this, and
 * advanced to 80% when it answered. The owner's first export sat on 30% until
 * he gave up. So a render is a job here too — started, polled, collected —
 * and the percentage the user watches is parts actually finished.
 */
/*
 * The denoiser needs its model, which the Dockerfile downloads at build time.
 *
 * If that download ever fails the image still builds, and without this every
 * enhanced export would die on "Failed to open model file" — a whole feature
 * lost to one missing asset. Everything else in the chain is built into
 * ffmpeg, so dropping just the denoise leaves a pass that is still worth
 * having: de-click, presence, compression and broadcast loudness.
 */
const RNNOISE_MODEL = "/app/std.rnnn";
const HAS_RNNOISE = existsSync(RNNOISE_MODEL);
if (!HAS_RNNOISE) console.log("enhance: no " + RNNOISE_MODEL + " — denoise is off, the rest of the chain still runs");

const ENHANCE_FILTERS = [
  "highpass=f=80",
  "adeclick",
  "adeclip",
  HAS_RNNOISE ? "arnndn=m=" + RNNOISE_MODEL + ":mix=0.8" : "",
  "equalizer=f=3000:t=q:w=1:g=2",
  "acompressor=threshold=-18dB:ratio=3:attack=5:release=50",
  /*
   * -14 LUFS, which is what doc 09 asks for. It said -16 with no comment
   * saying why — two LU quieter than the handoff, and quiet enough that
   * every platform would turn it up on the way in.
   *
   * TP aims at -1.5 while the SPEC says peaks under -1, and that is not a
   * disagreement: the AAC encode runs after this filter and adds true peak
   * to a signal that measured compliant going in. Aiming at the ceiling
   * lands above it. src/loudness.ts holds both numbers and says so at
   * length; scripts/check-loudness.cjs measures the encoded file to prove
   * it, because measuring the wav would be measuring a file nobody gets.
   */
  "loudnorm=I=-14:TP=-1.5:LRA=11",
  "alimiter=limit=-1.5dB",
]
  .filter((f) => f)
  .join(",");

const RENDERS = new Map();

/* A finished render waits this long to be collected before its files go. The
   Worker collects within seconds; this is only so a crashed collector cannot
   fill the disk. */
const COLLECT_WINDOW_MS = 30 * 60 * 1000;

/**
 * Pulls a source to local disk, ONCE.
 *
 * This is the whole reason an export could take hours. Every cut ran its own
 * ffmpeg against the presigned R2 URL, and the comment above that loop claimed
 * `-ss` before `-i` "seeks fast, and works over http by range request".
 * Measured against a 418 MB file on a byte-counting server, a single 3.2
 * second cut pulled **627 MB** — ffmpeg reads the file through while probing
 * and then again from the seek point to the end, about 1.5x the whole thing,
 * every time. Twenty cuts moved 15.4 GB.
 *
 * An edit is one cut per transcript line, so a twenty-line cut of a 2 GB
 * drone video was asking for sixty gigabytes over the wire. Batching the cuts
 * into one ffmpeg invocation was measured too and changed nothing (25.7s
 * against 27.3s, identical bytes) because it still opens the URL per input.
 * The only fix is to stop re-reading the source, and a local file also makes
 * every seek free.
 *
 * Returns null when the file will not fit, and the caller keeps the URL.
 */
async function fetchOnce(url, dest, budget) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`couldn't read the source (${res.status})`);

  /*
   * The budget is what is LEFT, not what one file may be.
   *
   * This compared each file against the whole allowance on its own, which was
   * right while an edit came from one video: there was only ever one master.
   * A cut assembled from the library is ten different videos, and ten 2 GB
   * masters each passed a 12 GB test and together filled the disk. The caller
   * spends the allowance down as it goes; anything that no longer fits keeps
   * its URL and is read over the network instead, which is slower and always
   * works.
   */
  const declared = Number(res.headers.get("content-length")) || 0;
  if (declared > (typeof budget === "number" ? budget : DISK_BUDGET)) {
    await res.body.cancel().catch(() => {});
    return null;
  }

  const { Readable } = await import("node:stream");
  const { pipeline } = await import("node:stream/promises");
  const { createWriteStream } = await import("node:fs");
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  return dest;
}

/** How long a file runs, in seconds. 0 when it cannot be read. */
function probeDuration(url) {
  return new Promise((resolve) => {
    const pr = spawn("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", url,
    ]);
    let out = "";
    pr.stdout.on("data", (d) => { out += d; });
    pr.on("close", () => resolve(Number(out.trim()) || 0));
    pr.on("error", () => resolve(0));
  });
}

/**
 * The shape of a file's picture, for deciding whether to crop or letterbox.
 *
 * Null when it cannot be read — a voiceover take has no video stream, and an
 * unreadable source falls back to letterboxing, which is never wrong, only
 * ugly.
 */
function probeShape(url) {
  return new Promise((resolve) => {
    const pr = spawn("ffprobe", [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=width,height",
      "-of", "csv=p=0:s=x", url,
    ]);
    let out = "";
    pr.stdout.on("data", (d) => { out += d; });
    pr.on("close", () => {
      const m = /^(\d+)x(\d+)/.exec(out.trim());
      resolve(m && Number(m[2]) ? { w: Number(m[1]), h: Number(m[2]) } : null);
    });
    pr.on("error", () => resolve(null));
  });
}

/** Runs `work` over `items`, `lanes` at a time, calling `onDone` as each lands. */
async function pool(items, lanes, work, onDone) {
  let next = 0;
  const lane = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      await work(items[i], i);
      onDone?.();
    }
  };
  await Promise.all(Array.from({ length: Math.min(lanes, items.length) }, lane));
}

/**
 * POST /render — starts one, and answers with its id.
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

  /*
   * Size and shape are independent, and were not.
   *
   * Every non-landscape aspect hardcoded 1080 on its long edge, so "4K +
   * vertical" rendered at 1080 wide — while the Worker charged the Studio plan
   * for a 4K the user never received. The export panel presents Size and Shape
   * as two separate choices, so they have to be two separate choices.
   *
   * The long edge comes from the format; the short edge from the aspect. Both
   * are forced even, because h264 will not encode an odd dimension.
   */
  const LONG = { mp4_720: 1280, mp4_1080: 1920, mp4_4k: 3840 };
  const RATIO = { "9:16": 9 / 16, "1:1": 1, "4:5": 4 / 5, "16:9": 16 / 9 };
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);

  const long = LONG[plan.format] || LONG.mp4_1080;
  const ratio = RATIO[plan.aspect] ?? RATIO["16:9"];
  /* Landscape keeps the long edge horizontal; anything taller than it is wide
     puts the format's long edge on the HEIGHT, so 4K vertical is 2160x3840
     rather than a 1080 letterbox of it. */
  const [w, h] = ratio >= 1
    ? [even(long), even(long / ratio)]
    : [even(long * ratio), even(long)];

  mkdirSync(dir, { recursive: true });

  const job = {
    stage: "fetching your footage",
    done: 0,
    total: cuts.length,
    pct: 0,
    error: null,
    outPath: null,
    durationS: 0,
    bytes: 0,
    dir,
    at: Date.now(),
    stopped: false,
    running: new Set(),
  };
  RENDERS.set(id, job);

  /* Held so a stop can kill them. A part that is already encoding would
     otherwise run to completion after the user gave up on it. */
  const runFfmpeg = (args) =>
    new Promise((resolve, reject) => {
      const ff = spawn("ffmpeg", args);
      job.running.add(ff);
      let err = "";
      ff.stderr.on("data", (d) => (err += d));
      ff.on("error", (e) => { job.running.delete(ff); reject(e); });
      ff.on("close", (code, signal) => {
        job.running.delete(ff);
        if (job.stopped) return reject(new Error("stopped"));
        if (code === 0) return resolve();
        /*
         * ALWAYS SAY SOMETHING.
         *
         * This rejected with new Error(err.slice(-800)), and ffmpeg killed by
         * a signal writes nothing to stderr — so the message was the empty
         * string, String(e.message || e) collapsed to "Error", and the export
         * panel showed the user {"error":"Error"}. An error that names neither
         * the cause nor the step is worse than no error, because there is
         * nothing to act on and nothing to report.
         */
        const why = err.trim().slice(-800)
          || (signal ? "ffmpeg was killed (" + signal + ") — most likely out of memory" : "ffmpeg exited " + code + " with no output");
        reject(new Error(why));
      });
    });

  (async () => {
    const t0 = Date.now();
    try {
      /*
       * ONE download per distinct source, before any cutting.
       *
       * Voiceover takes are counted too: they are small, and a take reused
       * across several beats would otherwise be pulled once per beat.
       */
      const wanted = [...new Set(cuts.flatMap((c) => [c.url, c.voiceUrl]).filter(Boolean))];
      const local = new Map();
      let fetched = 0;
      /* Spent down as each source lands, so ten videos share one disk rather
         than each being measured against the whole of it. */
      let left = DISK_BUDGET;
      for (const url of wanted) {
        const ext = (String(url).split("?")[0].match(/\.[a-z0-9]{2,4}$/i) || [".mp4"])[0];
        const dest = `${dir}/source-${local.size}${ext}`;
        const got = await fetchOnce(url, dest, left).catch(() => null);
        if (got) {
          local.set(url, got);
          try { left -= statSync(got).size; } catch { /* unreadable size: assume it took its share */ }
        }
        fetched++;
        job.pct = Math.round((fetched / wanted.length) * 15);
      }
      /* Anything too big for the disk keeps its URL and takes the old path. */
      const at = (url) => (url ? local.get(url) || url : url);

      /*
       * WHAT SHAPE EACH SOURCE IS, so a cut can be filled rather than boxed.
       *
       * One ffprobe per distinct video, not per cut — a forty-cut edit from
       * one video asks once. Voice takes are skipped: they have no picture.
       */
      const shapes = new Map();
      for (const url of new Set(cuts.map((c) => c.url).filter(Boolean))) {
        shapes.set(url, await probeShape(at(url)));
      }

      job.stage = "cutting";
      const parts = new Array(cuts.length);

      /*
       * FILL THE FRAME, OR BOX IT — and which one depends on the source.
       *
       * Every cut used to be scaled down until it fit inside the frame and the
       * remainder filled with black. For the thing this product exists to make
       * that is close to a bug: a 16:9 source in a 9:16 short came out 1080x608
       * in a 1080x1920 box, so the picture was about a THIRD of the frame and
       * the rest was bars. OpusClip's whole visual signature is that it fills.
       *
       * CROP when the source is WIDER than the frame: the sides go and the
       * middle stays, and the middle is where a person talking to a camera is.
       *
       * PAD when the source is TALLER: cropping a vertical source into a
       * landscape frame takes a band across the middle and removes the
       * speaker's head. Pillarboxing looks boxed; that one looks broken.
       *
       * Either way the output is exactly w x h, which everything downstream
       * depends on — the concat below is a stream copy and will not join parts
       * that differ, the voice branch appends tpad to this same string, and the
       * caption geometry is measured off w and h.
       */
      const CROP = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1`;
      const PAD = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
      const fillFor = (url) => {
        const shape = shapes.get(url);
        if (!shape) return PAD;
        /* Equal shapes make both a no-op; the tolerance keeps a 1919x1080
           master from being treated as taller than 16:9 and boxed. */
        return shape.w / shape.h >= w / h - 0.005 ? CROP : PAD;
      };

      const encode = async (cut, i) => {
        const out = `${dir}/part-${String(i).padStart(4, "0")}.mp4`;
        const vf = fillFor(cut.url);

        if (cut.voiceUrl) {
          // The user talking over the clip. Their voice is the point, so the
          // clip's own audio ducks under it rather than competing — sidechain
          // compression, keyed off the voice, which is how this is done for
          // real rather than just lowering a fader.
          //
          // THE VOICE DECIDES THE LENGTH.
          //
          // This mixed with duration=first, so the CLIP decided and a take
          // that ran a second longer than the b-roll was cut off mid-word.
          // That is the wrong way round: chopping what somebody said is worse
          // than holding a frame. tpad clones the last frame for as long as
          // the voice keeps going, and duration=longest lets it.
          /*
           * How much longer the take runs than the shot, measured rather than
           * guessed. -shortest does NOT reliably clamp a filtergraph — tried,
           * and every output came back the length of the tpad window — so the
           * pad is computed exactly and the video ends where it should.
           */
          const clipLen = Math.max(0, cut.end_s - cut.start_s);
          const voiceLen = await probeDuration(at(cut.voiceUrl));
          const pad = Math.max(0, voiceLen - clipLen);
          const held = pad > 0.05 ? vf + ",tpad=stop_mode=clone:stop_duration=" + pad.toFixed(3) : vf;

          await runFfmpeg([
            "-hide_banner", "-loglevel", "error", "-threads", String(FF_THREADS),
            "-ss", String(cut.start_s), "-to", String(cut.end_s), "-i", at(cut.url),
            "-i", at(cut.voiceUrl),
            "-filter_complex",
            "[0:v]" + held + "[v];" +
              "[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[base];" +
              "[1:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,asplit=2[voice][key];" +
              // threshold/ratio chosen so speech pulls the bed well down but
              // does not gate it out entirely — the clip should still be
              // audible underneath, just clearly behind.
              "[base][key]sidechaincompress=threshold=0.03:ratio=12:attack=15:release=350[ducked];" +
              "[ducked][voice]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[a]",
            "-map", "[v]", "-map", "[a]",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
            "-avoid_negative_ts", "make_zero", "-y", out,
          ]);
        } else if (cut.audioOnly) {
          // A VOICEOVER: sound, no picture.
          //
          // Every other branch runs a scale filter and an h264 encode, which
          // needs a video stream to work on — a .webm of somebody talking has
          // none, so ffmpeg failed and took the whole export down with it. An
          // edit containing any recorded voiceover simply could not be
          // exported, which is the one thing Build exists to produce.
          //
          // It gets a picture: a flat card in the app's own canvas colour,
          // encoded to match every other part — same size, same codec, same
          // audio format — because the concat below is a stream copy and will
          // not join parts that differ.
          //
          // The RECORDING decides the length, not the metadata.
          //
          // dur_ms is whatever the browser reported when the take was saved,
          // and a cut built from it would be wrong the moment that number is
          // missing or stale — with -shortest, a zero would truncate a real
          // take to nothing. So the background is an endless colour source and
          // -shortest ends the part when the audio ends. The number in the
          // database is then only ever an estimate for the interface, and can
          // never damage the video.
          await runFfmpeg([
            "-hide_banner", "-loglevel", "error", "-threads", String(FF_THREADS),
            "-f", "lavfi", "-i", `color=c=0x0B0B0E:s=${w}x${h}:r=30`,
            "-i", at(cut.url),
            "-map", "0:v", "-map", "1:a",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
            "-shortest", "-avoid_negative_ts", "make_zero", "-y", out,
          ]);
        } else {
          await runFfmpeg([
            "-hide_banner", "-loglevel", "error", "-threads", String(FF_THREADS),
            // -ss before -i seeks rather than decoding up to the mark. On the
            // local copy above that is a file offset; over http it is not, and
            // that is what fetchOnce exists to avoid.
            "-ss", String(cut.start_s), "-to", String(cut.end_s), "-i", at(cut.url),
            "-vf", vf,
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
            "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
            "-avoid_negative_ts", "make_zero", "-y", out,
          ]);
        }
        parts[i] = out;
      };

      /* Parts land out of order and are placed by index, so the concat list
         below is still exactly the order the EDL asked for. */
      await pool(cuts, LANES, encode, () => {
        job.done++;
        job.pct = 15 + Math.round((job.done / cuts.length) * 70);
      });

      job.stage = "joining it up";
      job.pct = 88;

      // The concat demuxer takes a file list; quotes are escaped because a
      // path is data, not shell.
      const listPath = `${dir}/list.txt`;
      writeFileSync(listPath, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));

      const outPath = `${dir}/out.mp4`;
      const cues = Array.isArray(plan.captions) ? plan.captions : [];
      const wantCaptions = cues.length > 0 && plan.captionStyle && plan.captionStyle !== "None";

      if (wantCaptions) {
        // Burning captions means re-encoding video, so the copy shortcut is
        // not available here — the pixels themselves change.
        job.stage = "burning captions";
        const assPath = writeAssFile(dir, cues, plan.captionStyle, Number(w), Number(h));
        await runFfmpeg([
          "-hide_banner", "-loglevel", "error", "-threads", String(FF_THREADS * LANES),
          "-f", "concat", "-safe", "0", "-i", listPath,
          "-vf", `subtitles=${assPath.replace(/'/g, "")}`,
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
          "-c:a", "copy", "-movflags", "+faststart", "-y", outPath,
        ]);
      } else if (plan.enhance) {
        /*
         * ENHANCE THE AUDIO, once, over the finished timeline.
         *
         * The chain below has been in this file since it was written and
         * nothing ever ran it: /enhance-audio took a whole file and no Worker
         * code ever called it. Applied HERE it costs almost nothing — the
         * video is still a stream copy, only the audio is re-encoded — and it
         * is the only place loudnorm can do its job, because normalising each
         * part separately makes the whole thing pump between shots.
         */
        job.stage = "cleaning up the sound";
        await runFfmpeg([
          "-hide_banner", "-loglevel", "error", "-threads", String(FF_THREADS * LANES),
          "-f", "concat", "-safe", "0", "-i", listPath,
          "-af", ENHANCE_FILTERS,
          "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
          "-movflags", "+faststart", "-y", outPath,
        ]);
      } else {
        await runFfmpeg([
          "-hide_banner", "-loglevel", "error",
          "-f", "concat", "-safe", "0", "-i", listPath,
          // Every part was encoded identically above, so a stream copy here is
          // exact and costs nothing.
          "-c", "copy", "-movflags", "+faststart", "-y", outPath,
        ]);
      }

      /* The source copies and the parts are dead weight now, and the disk is
         shared with whatever else this instance is asked to do. */
      await Promise.all(
        [...local.values(), ...parts].map((p) => unlink(p).catch(() => {})),
      );

      const st = await stat(outPath);

      /*
       * How long the file ACTUALLY is, measured from the file.
       *
       * The Worker was recording the EDL's intended duration, which is what
       * the cut adds up to — not what came out. They differ whenever a source
       * is shorter than its transcript claims (a truncated upload, a file that
       * failed to finish copying), and the row would then advertise a runtime
       * the video does not have. ffprobe already knows; nobody was asking it.
       */
      const measured = await new Promise((resolve) => {
        const pr = spawn("ffprobe", [
          "-v", "error", "-show_entries", "format=duration",
          "-of", "default=noprint_wrappers=1:nokey=1", outPath,
        ]);
        let out = "";
        pr.stdout.on("data", (d) => { out += d; });
        pr.on("close", () => resolve(Number(out.trim()) || 0));
        pr.on("error", () => resolve(0));
      });

      /*
       * HOW LOUD IT CAME OUT, measured on every export.
       *
       * Doc 09's Sound and captions row is "checked on every export, not
       * offered as a fix" — so this runs whether or not the export asked to
       * be cleaned up. An export that was not enhanced is not normalised and
       * will usually be off target; the point is that it SAYS so rather than
       * the product being silent about the one thing every platform will
       * change on upload.
       *
       * On the finished mp4, after the encode, because true peak moves there.
       * A measurement that fails leaves nulls and the Worker reports "not
       * measured", which is not the same as "fine" — see loudnessVerdict.
       */
      const loudness = await new Promise((resolve) => {
        const ff = spawn("ffmpeg", [
          "-hide_banner", "-nostdin", "-i", outPath,
          "-af", "loudnorm=print_format=json", "-f", "null", "-",
        ]);
        let err = "";
        /* The JSON goes to stderr, with everything else ffmpeg says. */
        ff.stderr.on("data", (d) => { err += d; });
        ff.on("close", () => {
          /*
           * FOUND AND FORWARDED, NOT PARSED.
           *
           * The Worker reads this with parseLoudnorm in src/loudness.ts,
           * which has tests. Nothing in this file does, because nothing in
           * this file can be run without a docker daemon — so the less of
           * the thinking that happens here the better. All this does is
           * locate ffmpeg's block and flatten it onto one line, because a
           * header cannot contain a newline.
           */
          const block = err.match(/\{[^{}]*"input_i"[\s\S]*?\}/);
          resolve(block ? block[0].replace(/\s+/g, " ") : null);
        });
        ff.on("error", () => resolve(null));
      });

      console.log(
        `render ${id}: ${cuts.length} cuts, ${st.size} bytes, ${measured}s, ` +
          `${loudness ?? "loudness not measured"}, ${Date.now() - t0}ms`,
      );
      job.outPath = outPath;
      job.bytes = st.size;
      job.durationS = measured;
      job.loudness = loudness;
      job.stage = "ready";
      job.pct = 100;
      job.at = Date.now();
    } catch (e) {
      console.error("render failed:", e);
      job.error = String(e?.message || e) || "the encoder failed without saying why";
      job.stage = "failed";
      job.at = Date.now();
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  })();

  res.writeHead(202, { "content-type": "application/json" });
  res.end(JSON.stringify({ id }));
}

/** Where a render has got to. The percentage is parts finished, not a timer. */
function renderStatus(id, res) {
  const job = RENDERS.get(id);
  if (!job) return jsonError(res, 404, { error: "no such render" });
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({
    stage: job.stage,
    pct: job.pct,
    done: job.done,
    total: job.total,
    error: job.error,
    ready: Boolean(job.outPath),
  }));
}

/**
 * Drops a render nobody wants any more.
 *
 * A container grinding on an export the user stopped is the expensive half of
 * a stopped export — the rows say failed instantly, but four vCPUs would keep
 * encoding until they were done. ffmpeg is killed, the files go, and the poll
 * that would have collected the result gets a 404 it already knows how to
 * read as "this one is gone".
 */
function renderStop(id, res) {
  /*
   * With no id, everything here.
   *
   * The Worker does not know the id this container gave the render — that
   * lives in the queue consumer that started it, which is exactly the thing
   * that may be wedged. It does know the instance: a container is addressed
   * as render-<renderId>, one per render, so stopping the lot of them stops
   * that render and nothing else.
   */
  const targets = id ? [id].filter((k) => RENDERS.has(k)) : [...RENDERS.keys()];
  for (const key of targets) {
    const job = RENDERS.get(key);
    job.stopped = true;
    for (const ff of job.running) { try { ff.kill("SIGKILL"); } catch { /* already gone */ } }
    RENDERS.delete(key);
    rm(job.dir, { recursive: true, force: true }).catch(() => {});
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true, stopped: targets.length }));
}

/** Hands the finished file over, then forgets it. */
function renderResult(id, res) {
  const job = RENDERS.get(id);
  if (!job) return jsonError(res, 404, { error: "no such render" });
  if (job.error) return jsonError(res, 500, { error: job.error });
  if (!job.outPath) return jsonError(res, 409, { error: "not finished" });

  res.writeHead(200, {
    "content-type": "video/mp4",
    "content-length": String(job.bytes),
    "x-duration-s": String(job.durationS),
    /* Absent rather than empty when it could not be measured: the Worker
       reads a missing header as "not measured", which is its own answer and
       not a pass. */
    ...(job.loudness ? { "x-loudness": job.loudness } : {}),
  });
  createReadStream(job.outPath).pipe(res).on("close", () => {
    RENDERS.delete(id);
    rm(job.dir, { recursive: true, force: true }).catch(() => {});
  });
}

/*
 * Nothing here outlives its usefulness.
 *
 * A collector that crashes between "ready" and fetching the file would
 * otherwise leave a finished export on the disk for as long as the instance
 * lives, and the instance is shared.
 */
setInterval(() => {
  const cutoff = Date.now() - COLLECT_WINDOW_MS;
  for (const [id, job] of RENDERS) {
    if ((job.outPath || job.error) && job.at < cutoff) {
      RENDERS.delete(id);
      rm(job.dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}, 60_000).unref?.();
/**
 * The EDITING COPY.
 *
 * The editor plays and scrubs the ORIGINAL — a 45-to-180-minute file that is
 * routinely gigabytes. Every seek is a range request into it, the editor opens
 * it twice (the visible player and the thumbnail decoder), and clicking a
 * transcript line to hear it is meant to be instant. It is the heaviest thing
 * in the product and the one the design never accounted for.
 *
 * The design's answer was Cloudflare Stream. Stream bills per minute stored
 * REGARDLESS OF FILE SIZE, so a small copy costs exactly what the 4K master
 * costs, and this product promises permanence — that is rent, for ever, on
 * every minute anybody ever uploads. 05-INFRA-AND-COSTS.md calls it "the
 * single easiest way to make this product unprofitable" and it is right.
 *
 * The same copy as an mp4 in R2 is about 4.5 MB a minute and has no egress
 * charge at all — roughly seventy times cheaper for the same job.
 *
 * `-g 48` is the point of the whole thing. A keyframe every two seconds is
 * what makes scrubbing land immediately; a camera's own keyframe interval is
 * whatever it felt like, often ten seconds or more, and every seek in between
 * decodes forward from the last one.
 *
 * The dimensions come back in the headers because NOTHING IN THIS PRODUCT HAS
 * EVER KNOWN THEM. sources.width and sources.height are declared, written as
 * null, and never updated anywhere — which is why vertical footage is drawn
 * into a landscape box and stretched.
 */
function proxy(url, res) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const outPath = `/tmp/proxy-${id}.mp4`;
  const posterPath = `/tmp/poster-${id}.jpg`;

  const probe = () =>
    new Promise((resolve) => {
      const pr = spawn("ffprobe", [
        "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height:format=duration",
        "-of", "default=noprint_wrappers=1", url,
      ]);
      let out = "";
      pr.stdout.on("data", (d) => { out += d; });
      pr.on("close", () => {
        const read = (k) => Number((new RegExp(k + "=([0-9.]+)").exec(out) || [])[1]) || 0;
        resolve({ width: read("width"), height: read("height"), duration: read("duration") });
      });
      pr.on("error", () => resolve({ width: 0, height: 0, duration: 0 }));
    });

  (async () => {
    const t0 = Date.now();
    /*
     * Probed BEFORE the encode, from the source, because the proxy is scaled
     * and would report the copy's shape rather than the video's. -2 keeps the
     * aspect ratio, so a vertical source comes out vertical.
     */
    const shape = await probe();

    const args = [
      "-hide_banner", "-loglevel", "error", "-threads", String(FF_THREADS * LANES),
      "-i", url,
      "-vf", "scale=-2:480",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-g", "48",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "96k", "-ac", "2",
      "-movflags", "+faststart", "-y", outPath,
      /*
       * A POSTER, OUT OF THE DECODE WE ARE ALREADY PAYING FOR.
       *
       * Six of nine videos had none, because the only thing that ever made one
       * was the browser at upload time — miss that path once and the video is
       * a black rectangle on Home and in Footage for ever, with no way back.
       *
       * A second output on the same invocation: one decode, two encodes. The
       * container is already open, the frames are already going past, and
       * writing one of them out costs a JPEG.
       *
       * `thumbnail` rather than the first frame, because videos routinely open
       * on black, a fade or a slate — it scores 300 frames and picks the most
       * representative one, which is the difference between a poster and a
       * black rectangle with extra steps.
       */
      "-vf", "thumbnail=300,scale=-2:480", "-frames:v", "1", "-q:v", "4", "-y", posterPath,
    ];
    const ff = spawn("ffmpeg", args);
    let err = "";
    ff.stderr.on("data", (d) => (err += d));
    ff.on("error", (e) => jsonError(res, 500, { error: String(e) }));
    ff.on("close", async (code) => {
      if (code !== 0) {
        await unlink(outPath).catch(() => {});
        return jsonError(res, 500, { error: err.slice(-1500) || "ffmpeg failed" });
      }
      try {
        const st = await stat(outPath);
        console.log(`proxy: ${st.size} bytes, ${shape.width}x${shape.height}, ${Date.now() - t0}ms`);
        res.writeHead(200, {
          "content-type": "video/mp4",
          "content-length": String(st.size),
          "x-width": String(shape.width),
          "x-height": String(shape.height),
          "x-duration-s": String(Math.round(shape.duration)),
          /* Collected separately: this response is already the mp4, and a
             JPEG will not fit in a header. The caller fetches /poster on THIS
             instance, which is still awake, so it costs no new container. */
          ...(await stat(posterPath).then(() => ({ "x-poster": id })).catch(() => ({}))),
        });
        const rs = createReadStream(outPath);
        rs.pipe(res);
        rs.on("close", () => { unlink(outPath).catch(() => {}); });
        rs.on("error", () => { unlink(outPath).catch(() => {}); });
      } catch (e) {
        jsonError(res, 500, { error: String(e) });
      }
    });
  })();
}

function readJson(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch { resolve({}); } });
  });
}

/** The other half of jsonError: a body that is not an error. */
function json(res, code, obj) {
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}

function jsonError(res, code, obj) {
  if (obj && !String(obj.error || "").trim()) obj = { ...obj, error: "the encoder failed without saying why" };
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

createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://container");
  const path = url.pathname;

  /*
   * A render is polled now, so this is no longer a POST-only server.
   *
   * The Worker starts one, asks where it has got to, and collects the file —
   * three calls rather than one held-open fetch, which is what lets the
   * export bar show real parts instead of sitting on 30%.
   */
  if (req.method === "GET") {
    const id = url.searchParams.get("id") || "";
    if (path === "/render/status") return renderStatus(id, res);
    if (path === "/render/result") return renderResult(id, res);
    /*
     * The poster the proxy pass just made, collected on the same instance.
     *
     * A GET, so it belongs HERE — it was written into the POST section first,
     * where a GET can never reach it, and the gate did not notice because it
     * asserted a 404 and got one from the catch-all below. The error body is
     * what makes the two distinguishable now.
     *
     * Deleted on the way out whether or not the read succeeds: a container is
     * ephemeral, but this runs once per upload and a temp file nobody collects
     * is still a temp file nobody collects.
     */
    if (path === "/poster") {
      const posterPath = `/tmp/poster-${id.replace(/[^a-z0-9.-]/gi, "")}.jpg`;
      try {
        const st = await stat(posterPath);
        res.writeHead(200, { "content-type": "image/jpeg", "content-length": String(st.size) });
        const rs = createReadStream(posterPath);
        rs.pipe(res);
        rs.on("close", () => { unlink(posterPath).catch(() => {}); });
        rs.on("error", () => { unlink(posterPath).catch(() => {}); });
      } catch {
        jsonError(res, 404, { error: "no poster for that id" });
      }
      return;
    }
    res.writeHead(404).end();
    return;
  }

  if (req.method === "DELETE") {
    return renderStop(url.searchParams.get("id") || "", res);
  }

  if (req.method !== "POST") { res.writeHead(405).end(); return; }
  const body = await readJson(req);
  console.log(`container: ${req.method} ${path}`, body.url ? `url=${String(body.url).slice(0, 100)}` : `cuts=${body.cuts?.length ?? 0}`);

  // /render takes a plan rather than a single url, so the url check only
  // applies to the endpoints that do take one.
  if (path === "/render") return render(body, res);

  /*
   * /align takes a url AND windows, so it sits above the url-only check for
   * the same reason /render does: it answers "no windows to align" itself,
   * which is a more useful 400 than "missing url".
   */
  if (path === "/align") return alignHandler(body, res, json, jsonError);

  if (!body.url) return jsonError(res, 400, { error: "missing url" });
  if (path === "/extract-full") return extractFull(body.url, res);
  if (path === "/proxy") return proxy(body.url, res);

  res.writeHead(404).end();
/* 8080 is what the Container binding expects (defaultPort in src/render.ts).
   PORT is only for scripts/bench-render.cjs, which runs this file directly. */
}).listen(Number(process.env.PORT) || 8080);
