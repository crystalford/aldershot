/**
 * Just enough MP3 parsing to cut audio at exact, known times.
 *
 * Long sources have to be transcribed in chunks (~4 hours is the measured
 * ceiling for one call — docs/decisions/transcription.md). Cloudflare's own
 * guidance is to slice the bytes, which is wrong: an MP3 is a stream of frames,
 * and cutting at an arbitrary byte offset lands mid-frame. The decoder then
 * produces noise at the seam, and — worse — you have no idea what time the
 * chunk actually starts, so every timestamp after it is guesswork.
 *
 * Parsing frame headers costs a single linear scan and gives both: cuts that
 * land on frame boundaries, and a start time known to the millisecond.
 *
 * This handles MPEG 1/2/2.5 Layer III, which is what any encoder we control
 * will emit. Anything it cannot parse is reported honestly rather than
 * guessed at.
 */

const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000], // MPEG 1
  2: [22050, 24000, 16000], // MPEG 2
  0: [11025, 12000, 8000],  // MPEG 2.5
};

export interface Mp3Frame {
  /** Byte offset of the frame header. */
  offset: number;
  /** Total frame length in bytes, including the header. */
  length: number;
  /** How much audio this frame carries, in milliseconds. */
  durationMs: number;
}

/**
 * Walks the frames. Skips an ID3v2 tag if present, and resynchronises rather
 * than giving up when it meets something that is not a frame — a stray tag or
 * a byte of padding mid-file should not end the scan.
 */
export function parseFrames(bytes: Uint8Array): Mp3Frame[] {
  const frames: Mp3Frame[] = [];
  let i = skipId3(bytes);

  while (i + 4 <= bytes.length) {
    // Frame sync: eleven set bits.
    if (bytes[i] !== 0xff || (bytes[i + 1] & 0xe0) !== 0xe0) {
      i++;
      continue;
    }

    const versionBits = (bytes[i + 1] >> 3) & 0x03; // 3=MPEG1, 2=MPEG2, 0=MPEG2.5
    const layerBits = (bytes[i + 1] >> 1) & 0x03;   // 1 = Layer III
    const bitrateIdx = (bytes[i + 2] >> 4) & 0x0f;
    const rateIdx = (bytes[i + 2] >> 2) & 0x03;
    const padding = (bytes[i + 2] >> 1) & 0x01;

    const rates = SAMPLE_RATES[versionBits];
    if (layerBits !== 1 || !rates || rateIdx === 3 || bitrateIdx === 0 || bitrateIdx === 15) {
      i++;
      continue;
    }

    const sampleRate = rates[rateIdx];
    const kbps = (versionBits === 3 ? BITRATES_V1_L3 : BITRATES_V2_L3)[bitrateIdx];
    if (!sampleRate || !kbps) {
      i++;
      continue;
    }

    // MPEG1 Layer III carries 1152 samples per frame; MPEG2/2.5 carry 576.
    const samplesPerFrame = versionBits === 3 ? 1152 : 576;
    const length = Math.floor((samplesPerFrame / 8) * ((kbps * 1000) / sampleRate)) + padding;
    if (length < 4 || i + length > bytes.length) break;

    frames.push({ offset: i, length, durationMs: (samplesPerFrame / sampleRate) * 1000 });
    i += length;
  }

  return frames;
}

/** ID3v2 tags sit before the audio and are not frames. */
function skipId3(bytes: Uint8Array): number {
  if (bytes.length < 10) return 0;
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0; // "ID3"
  // A syncsafe 28-bit integer: seven bits per byte.
  const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
  return 10 + size;
}

export interface AudioChunk {
  bytes: Uint8Array;
  /** Where this chunk begins in the original, in milliseconds. Exact. */
  startMs: number;
  /** How long this chunk is, in milliseconds. */
  durationMs: number;
}

export interface SplitOpts {
  /** Target length of each chunk. */
  chunkMs: number;
  /**
   * How much of the previous chunk to repeat at the start of the next.
   *
   * A word straddling a cut would otherwise be lost or half-transcribed on
   * both sides. The overlap guarantees it is heard whole at least once; the
   * stitcher then drops the duplicate (see src/longaudio.ts).
   */
  overlapMs: number;
}

/**
 * Splits MP3 audio into chunks that begin on frame boundaries at known times.
 *
 * Returns a single chunk when the audio is short enough, so the caller does not
 * need a separate path for the common case.
 */
export function splitMp3(bytes: Uint8Array, opts: SplitOpts): AudioChunk[] {
  const frames = parseFrames(bytes);
  if (!frames.length) {
    // Not parseable as MP3 frames — say so rather than returning byte slices
    // that would decode to noise.
    throw new Error("not-mp3");
  }

  const totalMs = frames.reduce((n, f) => n + f.durationMs, 0);
  if (totalMs <= opts.chunkMs) {
    return [{ bytes, startMs: 0, durationMs: totalMs }];
  }

  // Running start time of each frame, so a time maps to a frame index exactly.
  const startsMs: number[] = new Array(frames.length);
  let t = 0;
  for (let i = 0; i < frames.length; i++) {
    startsMs[i] = t;
    t += frames[i].durationMs;
  }

  const frameAt = (ms: number): number => {
    // First frame whose start is >= ms.
    let lo = 0;
    let hi = frames.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (startsMs[mid] < ms) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const chunks: AudioChunk[] = [];
  let cursorMs = 0;
  while (cursorMs < totalMs) {
    const fromMs = Math.max(0, cursorMs - (chunks.length ? opts.overlapMs : 0));
    const toMs = Math.min(totalMs, cursorMs + opts.chunkMs);

    const fromFrame = frameAt(fromMs);
    const toFrame = toMs >= totalMs ? frames.length : frameAt(toMs);

    const startByte = frames[fromFrame].offset;
    const endByte =
      toFrame >= frames.length
        ? frames[frames.length - 1].offset + frames[frames.length - 1].length
        : frames[toFrame].offset;

    chunks.push({
      bytes: bytes.subarray(startByte, endByte),
      startMs: startsMs[fromFrame],
      durationMs: (toFrame >= frames.length ? totalMs : startsMs[toFrame]) - startsMs[fromFrame],
    });

    cursorMs = toMs;
  }

  return chunks;
}

/** Total duration of MP3 audio, in milliseconds. */
export function durationMs(bytes: Uint8Array): number {
  return parseFrames(bytes).reduce((n, f) => n + f.durationMs, 0);
}


/* ── Streaming ───────────────────────────────────────────────────────────
 * A Worker cannot hold a long source in memory. Ten hours of 32 kbps audio is
 * 137 MB, and base64 adds a third on top — enough to exhaust the isolate
 * before a single call is made. Measured: loading the whole file and chunking
 * in memory fails, while the same audio chunked from R2 range reads succeeds.
 *
 * So the frame index is built by streaming the object once, keeping only a
 * small carry buffer, and each chunk is then fetched by byte range when it is
 * actually needed. Peak memory becomes one chunk instead of the whole file.
 */

export interface ChunkRange {
  /** Byte range in the original object, for an R2 range read. */
  startByte: number;
  endByte: number;
  /** Where this chunk begins in the audio, in milliseconds. Exact. */
  startMs: number;
  durationMs: number;
}

interface FrameHeader {
  length: number;
  durationMs: number;
}

/**
 * Reads a frame header at `i`, or null if there isn't one there.
 * Needs 4 bytes available.
 */
function readHeader(b: Uint8Array, i: number): FrameHeader | null {
  if (i + 4 > b.length) return null;
  if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null;

  const versionBits = (b[i + 1] >> 3) & 0x03;
  const layerBits = (b[i + 1] >> 1) & 0x03;
  const bitrateIdx = (b[i + 2] >> 4) & 0x0f;
  const rateIdx = (b[i + 2] >> 2) & 0x03;
  const padding = (b[i + 2] >> 1) & 0x01;

  const rates = SAMPLE_RATES[versionBits];
  if (layerBits !== 1 || !rates || rateIdx === 3 || bitrateIdx === 0 || bitrateIdx === 15) return null;

  const sampleRate = rates[rateIdx];
  const kbps = (versionBits === 3 ? BITRATES_V1_L3 : BITRATES_V2_L3)[bitrateIdx];
  if (!sampleRate || !kbps) return null;

  const samplesPerFrame = versionBits === 3 ? 1152 : 576;
  const length = Math.floor((samplesPerFrame / 8) * ((kbps * 1000) / sampleRate)) + padding;
  if (length < 4) return null;

  return { length, durationMs: (samplesPerFrame / sampleRate) * 1000 };
}

/**
 * Walks a stream of MP3 bytes and returns the chunk ranges to transcribe.
 *
 * Frames routinely straddle the reads coming off the stream, so a carry buffer
 * holds the tail of one read until the next arrives. Only chunk boundaries are
 * remembered — indexing every frame of a ten-hour file would defeat the point.
 */
export async function indexMp3Chunks(
  stream: ReadableStream<Uint8Array>,
  opts: SplitOpts,
): Promise<ChunkRange[]> {
  const reader = stream.getReader();

  let carry = new Uint8Array(0);
  let carryStart = 0;      // byte offset in the object of carry[0]
  let elapsedMs = 0;       // audio time at the current frame
  let started = false;     // have we cleared any ID3 header and found frame one

  /*
   * Markers every five seconds, not one per chunk.
   *
   * A chunk has to start `overlapMs` before its nominal boundary, and that
   * position must land on a real frame — so there has to be a recorded frame
   * offset near it. Marking only chunk boundaries leaves nothing to back up
   * to, and the overlap silently collapses to zero, which is how a sentence
   * crossing a seam gets lost.
   *
   * Ten hours at five-second markers is ~7,200 entries: irrelevant memory
   * next to the audio itself.
   */
  const MARKER_MS = 5_000;
  const markers: { byte: number; ms: number }[] = [];
  let nextMarkerMs = 0;
  let totalMs = 0;
  let lastByte = 0;

  const noteMarker = (byte: number, ms: number) => {
    if (ms + 1 >= nextMarkerMs) {
      markers.push({ byte, ms });
      nextMarkerMs = ms + MARKER_MS;
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    // Append the new read to whatever partial frame we were holding.
    const buf = new Uint8Array(carry.length + value.length);
    buf.set(carry, 0);
    buf.set(value, carry.length);

    let i = 0;
    if (!started) {
      i = skipId3(buf);
      if (i >= buf.length) {
        carryStart += buf.length;
        carry = new Uint8Array(0);
        continue;
      }
    }

    for (;;) {
      const header = readHeader(buf, i);
      if (!header) {
        // Either a partial frame at the end of the read, or a byte to skip.
        if (i + 4 > buf.length) break;
        i++;
        continue;
      }
      if (i + header.length > buf.length) break; // frame continues into the next read

      if (!started) started = true;
      noteMarker(carryStart + i, elapsedMs);

      elapsedMs += header.durationMs;
      i += header.length;
      lastByte = carryStart + i;
    }

    carry = buf.subarray(i);
    carryStart += i;
  }

  totalMs = elapsedMs;
  if (!markers.length) throw new Error("not-mp3");

  /** The last marker at or before `ms` — always a real frame offset. */
  const markerAt = (ms: number) => {
    let lo = 0;
    let hi = markers.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (markers[mid].ms <= ms) lo = mid;
      else hi = mid - 1;
    }
    return markers[lo];
  };

  // Walk the nominal chunk boundaries, backing each start up by the overlap.
  const ranges: ChunkRange[] = [];
  for (let cursorMs = 0; cursorMs < totalMs; cursorMs += opts.chunkMs) {
    const isFirst = cursorMs === 0;
    const start = isFirst ? markers[0] : markerAt(Math.max(0, cursorMs - opts.overlapMs));
    const endMs = Math.min(totalMs, cursorMs + opts.chunkMs);
    const atEnd = endMs >= totalMs;
    const endMarker = atEnd ? null : markerAt(endMs);

    ranges.push({
      startByte: start.byte,
      endByte: endMarker ? endMarker.byte : lastByte,
      startMs: start.ms,
      durationMs: (endMarker ? endMarker.ms : totalMs) - start.ms,
    });
    if (atEnd) break;
  }
  return ranges;
}
