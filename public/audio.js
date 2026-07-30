// Audio extraction for transcription — no ffmpeg needed.
// Decode the source (mp4/mov/m4a/webm/mp3/wav) with WebAudio, resample to the
// 16 kHz mono WAV Whisper likes, and hand back a small Blob to upload.
//
// Note: WebAudio decodes the whole file in memory, so very large/long sources
// can strain the browser. Good for typical talking-head footage; server-side
// extraction (the ffmpeg container) is the scaling path.
window.Audiox = (() => {
  async function extractWav(file, onProgress) {
    onProgress?.("decoding audio…");
    const raw = await file.arrayBuffer();
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    let decoded;
    try {
      decoded = await ctx.decodeAudioData(raw);
    } finally {
      ctx.close();
    }

    onProgress?.("resampling…");
    const rate = 16000;
    const length = Math.max(1, Math.ceil(decoded.duration * rate));
    const off = new OfflineAudioContext(1, length, rate);
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start();
    const rendered = await off.startRendering();
    return encodeWav(rendered.getChannelData(0), rate);
  }

  // Float32 PCM → 16-bit mono WAV Blob.
  function encodeWav(samples, rate) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const writeStr = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + samples.length * 2, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);      // PCM
    view.setUint16(22, 1, true);      // mono
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, samples.length * 2, true);
    let o = 44;
    for (let i = 0; i < samples.length; i++, o += 2) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Blob([buffer], { type: "audio/wav" });
  }

  return { extractWav };
})();
