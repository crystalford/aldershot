// Browser-side rendering with ffmpeg.wasm. Produces real MP4s — single-clip
// shorts and the stitched long-form cut — entirely client-side, so no server
// container is needed to ship. ffmpeg core loads lazily from a pinned CDN the
// first time you render.
//
// Note: ffmpeg.wasm decodes in the browser, so very large/long sources are
// slow and memory-heavy. Great for shorts; fine for modest long-form. The
// server ffmpeg container is the scaling path for big renders.
window.Renderer = (() => {
  const FFMPEG_VER = "0.12.10";
  const UTIL_VER = "0.12.1";
  const CORE_VER = "0.12.6";
  let ff = null;
  let util = null;
  let fontLoaded = false;

  async function load() {
    if (ff) return ff;
    const { FFmpeg } = await import(`https://unpkg.com/@ffmpeg/ffmpeg@${FFMPEG_VER}/dist/esm/index.js`);
    util = await import(`https://unpkg.com/@ffmpeg/util@${UTIL_VER}/dist/esm/index.js`);
    const base = `https://unpkg.com/@ffmpeg/core@${CORE_VER}/dist/esm`;
    ff = new FFmpeg();
    await ff.load({
      coreURL: await util.toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await util.toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
    });
    return ff;
  }

  const mediaUrl = (key) => "/api/media/" + key.split("/").map(encodeURIComponent).join("/");

  // Trim [start,end] of one source into outName. normalize=true re-encodes to a
  // common format (720p/30fps/yuv420p/aac) so clips can be concat-copied together.
  async function trim(ff, r2_key, start, end, outName, normalize) {
    const inName = "in_" + Math.random().toString(36).slice(2) + ".mp4";
    await ff.writeFile(inName, await util.fetchFile(mediaUrl(r2_key)));
    const dur = Math.max(0.1, end - start);
    const args = ["-ss", String(start), "-i", inName, "-t", String(dur)];
    if (normalize) {
      args.push(
        "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1",
        "-r", "30", "-pix_fmt", "yuv420p",
        "-c:v", "libx264", "-preset", "veryfast",
        "-c:a", "aac", "-ar", "44100", "-ac", "2",
      );
    } else {
      args.push("-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", "-movflags", "+faststart");
    }
    args.push("-y", outName);
    await ff.exec(args);
    await ff.deleteFile(inName);
  }

  // ── Karaoke captions ────────────────────────────────────────────────
  // Builds a \k-timed ASS track from word-level transcript timestamps
  // (already the SOURCE video's absolute times — offset to clip-relative
  // here). Words group into on-screen phrases — capped at 5 words, or cut
  // short on sentence-ending punctuation or a >0.6s pause — so nothing
  // sits on screen too long or flickers word-by-word. Within a phrase,
  // each word flips from white to the app's accent color the instant its
  // own turn starts (confirmed empirically against libass — \k transitions
  // happen at the START of a word's span and persist, not a mid-word
  // sweep), giving a cumulative "read-along" highlight rather than a
  // single spotlight that reverts — simpler and more robust than
  // per-word-positioned overlay events, and still genuinely animated.
  const PHRASE_MAX_WORDS = 5;
  const PHRASE_PAUSE_BREAK = 0.6;

  function toAssTime(t) {
    const totalCs = Math.max(0, Math.round(t * 100));
    const cs = totalCs % 100;
    const totalSec = Math.floor(totalCs / 100);
    const s = totalSec % 60;
    const totalMin = Math.floor(totalSec / 60);
    const m = totalMin % 60;
    const h = Math.floor(totalMin / 60);
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
  }
  const escAssText = (t) => String(t).replace(/[{}]/g, "").replace(/\n/g, " ");

  function groupIntoPhrases(words) {
    const phrases = [];
    let cur = [];
    words.forEach((w, i) => {
      cur.push(w);
      const next = words[i + 1];
      const endsSentence = /[.!?]["')\]]?$/.test(w.text.trim());
      const longPause = next && next.start - w.end > PHRASE_PAUSE_BREAK;
      if (cur.length >= PHRASE_MAX_WORDS || endsSentence || longPause || !next) {
        phrases.push(cur);
        cur = [];
      }
    });
    return phrases;
  }

  function buildCaptionsAss(words, clipStart, clipEnd) {
    const clipWords = words
      .filter((w) => !w.deleted && w.start >= clipStart && w.end <= clipEnd && w.text.trim())
      .map((w) => ({ text: w.text, start: w.start - clipStart, end: w.end - clipStart }));
    if (!clipWords.length) return null;

    const events = groupIntoPhrases(clipWords).map((phrase) => {
      const start = phrase[0].start;
      const end = phrase[phrase.length - 1].end;
      const text = phrase.map((w, i) => {
        const nextStart = i < phrase.length - 1 ? phrase[i + 1].start : end;
        const cs = Math.max(1, Math.round((nextStart - w.start) * 100));
        return `{\\k${cs}}${escAssText(w.text)}`;
      }).join(" ");
      return `Dialogue: 0,${toAssTime(start)},${toAssTime(end)},Caption,,0,0,0,,${text}`;
    });

    // PlayResX/Y match the 1080x1920 output the vertical crop below scales
    // to. PrimaryColour (already-spoken, cumulative highlight) is the
    // app's own accent blue; SecondaryColour (not yet reached) is white.
    // ASS colors are &HAABBGGRR — 5b8cff (Aldershot's --accent) in BGR is FF8C5B.
    return `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Archivo Black,78,&H00FF8C5B,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,4,2,2,60,60,220,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join("\n")}
`;
  }

  // Vertical (9:16) crop centered on the source frame, scaled to 1080x1920,
  // with the karaoke captions (if any words were provided) burned in on
  // top. min(iw,ih*9/16) keeps this from erroring on a source that's
  // already narrower than 9:16 (crop would otherwise ask for more width
  // than the frame has). Center-cropped only, no subject tracking — a
  // deliberate v1 scope cut, not an oversight.
  async function renderShort(clip, onProgress) {
    onProgress?.("loading ffmpeg…");
    const f = await load();
    const inName = "in_" + Math.random().toString(36).slice(2) + ".mp4";
    await ff.writeFile(inName, await util.fetchFile(mediaUrl(clip.r2_key)));

    let assPath = null;
    if (clip.words?.length) {
      const ass = buildCaptionsAss(clip.words, clip.start, clip.end);
      if (ass) {
        if (!fontLoaded) {
          onProgress?.("loading caption font…");
          await ff.createDir("fonts").catch(() => {});
          await ff.writeFile("fonts/archivo-black.ttf", await util.fetchFile("/fonts/archivo-black.ttf"));
          fontLoaded = true;
        }
        assPath = "captions_" + Math.random().toString(36).slice(2) + ".ass";
        await ff.writeFile(assPath, ass);
      }
    }

    onProgress?.("reframing + captioning…");
    const dur = Math.max(0.1, clip.end - clip.start);
    const vf = [
      "crop=min(iw\\,ih*9/16):ih",
      "scale=1080:1920:flags=lanczos",
      ...(assPath ? [`subtitles=${assPath}:fontsdir=fonts`] : []),
    ].join(",");
    await ff.exec([
      "-ss", String(clip.start), "-i", inName, "-t", String(dur),
      "-vf", vf,
      "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-movflags", "+faststart",
      "-y", "out.mp4",
    ]);
    await ff.deleteFile(inName);
    if (assPath) await ff.deleteFile(assPath).catch(() => {});

    const data = await f.readFile("out.mp4");
    await f.deleteFile("out.mp4");
    return new Blob([data], { type: "video/mp4" });
  }

  async function renderLongform(clips, onProgress) {
    if (!clips.length) throw new Error("nothing to render");
    onProgress?.("loading ffmpeg…");
    const f = await load();
    const parts = [];
    for (let i = 0; i < clips.length; i++) {
      onProgress?.(`rendering clip ${i + 1} / ${clips.length}…`);
      const name = `p${i}.mp4`;
      await trim(f, clips[i].r2_key, clips[i].start, clips[i].end, name, true);
      parts.push(name);
    }
    onProgress?.("stitching…");
    await f.writeFile("list.txt", new TextEncoder().encode(parts.map((p) => `file ${p}`).join("\n")));
    await f.exec(["-f", "concat", "-safe", "0", "-i", "list.txt", "-c", "copy", "-movflags", "+faststart", "-y", "final.mp4"]);
    const data = await f.readFile("final.mp4");
    for (const p of parts) await f.deleteFile(p).catch(() => {});
    return new Blob([data], { type: "video/mp4" });
  }

  return { renderShort, renderLongform };
})();
