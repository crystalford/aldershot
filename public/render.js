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

  async function renderShort(clip, onProgress) {
    onProgress?.("loading ffmpeg…");
    const f = await load();
    onProgress?.("trimming…");
    await trim(f, clip.r2_key, clip.start, clip.end, "out.mp4", false);
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
