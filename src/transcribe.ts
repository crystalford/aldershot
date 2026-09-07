/**
 * Transcription — one Workers AI call per source, no chunking.
 *
 * That is measured, not assumed: 180 minutes of audio (43 MB) transcribes
 * completely in a single call with word-level timestamps correct to the final
 * second. Cloudflare's own tutorial says to chunk at ~1 MB; following it would
 * have meant 40+ calls and a pile of timestamp-offset arithmetic for no reason.
 * Full numbers in docs/decisions/transcription.md.
 *
 * Two things the published schema gets wrong, both confirmed at runtime:
 *  - `audio` must be a BASE64 STRING. Passing an array or a Uint8Array — both
 *    of which the schema advertises — is rejected.
 *  - The response carries `usage.neurons`, so metering records what was
 *    actually billed rather than an estimate.
 */

import type { Env } from "./env.ts";
import { TRANSCRIBE, TRANSCRIBE_DIARIZED } from "./models.ts";
import { CHUNK_MS, OVERLAP_MS, joinText, stitch, type ChunkTranscript } from "./longaudio.ts";
import { indexMp3Chunks } from "./mp3.ts";

/** A word and its timing, as Whisper returns it. */
export interface WhisperWord {
  word: string;
  start: number;
  end: number;
}

export interface WhisperSegment {
  start: number;
  end: number;
  text: string;
  words?: WhisperWord[];
  /** Only present on the diarized (Nova-3) path, and unverified — see models.ts. */
  speaker?: string | number;
}

export interface TranscriptResult {
  text: string;
  segments: WhisperSegment[];
  /** Real duration as the model measured it, in seconds. */
  duration: number;
  /** What this call actually cost, in neurons. Feeds usage_events directly. */
  neurons: number;
  diarized: boolean;
}

interface WhisperResponse {
  text?: string;
  segments?: WhisperSegment[];
  word_count?: number;
  transcription_info?: { duration?: number; language?: string };
  usage?: { neurons?: number };
}

/**
 * base64 for a large buffer. Chunked because spreading a 40 MB array into
 * `String.fromCharCode(...)` blows the argument limit — the naive one-liner
 * works in testing on small files and fails on exactly the long videos this
 * product is for.
 */
export function toBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Whisper's word tokens come back lowercased and stripped of punctuation —
 * fine for timing, useless for reading. The segment's own `text` has the real
 * casing and punctuation but no per-word timing. When both tokenise to the
 * same count (the common case) zip them so we get real text AND real timing.
 * When they don't line up, keep the raw tokens rather than guess an alignment
 * and silently corrupt the timings that Script mode depends on.
 */
export function reconcile(segment: WhisperSegment): WhisperWord[] {
  const words = segment.words ?? [];
  if (!words.length) return [];
  const tokens = segment.text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length !== words.length) return words;
  return words.map((w, i) => ({ word: tokens[i], start: w.start, end: w.end }));
}

export interface TranscribeOpts {
  /** Opt-in diarization upgrade (~10x cost). See docs/decisions/models.md. */
  diarize?: boolean;
  /**
   * Called after each chunk of a long source, so the job can report real
   * progress instead of sitting at one stage for half an hour.
   */
  onProgress?: (fraction: number, done: number, total: number) => void;
}

/** One call. Used directly for short audio, and per-chunk for long audio. */
async function transcribeOnce(
  env: Env,
  media: Uint8Array | ArrayBuffer,
  opts: TranscribeOpts,
): Promise<{ segments: WhisperSegment[]; text: string; duration: number; neurons: number }> {
  const model = opts.diarize ? TRANSCRIBE_DIARIZED : TRANSCRIBE;
  const run = env.AI.run.bind(env.AI) as (m: string, i: Record<string, unknown>) => Promise<WhisperResponse>;

  const buf = media instanceof Uint8Array ? media : new Uint8Array(media);
  const input: Record<string, unknown> = { audio: toBase64(buf) };
  if (opts.diarize) input.diarize = true;

  const res = await run(model.id, input);
  const segments = (res.segments ?? []).map((s) => ({ ...s, words: reconcile(s) }));
  return {
    segments,
    text: res.text ?? "",
    duration: res.transcription_info?.duration ?? (segments.at(-1)?.end ?? 0),
    neurons: res.usage?.neurons ?? 0,
  };
}

/**
 * Transcribes a source that lives in R2, chunking only when it has to.
 *
 * Takes a bucket and key rather than bytes on purpose. Ten hours of audio is
 * 137 MB, and base64 adds a third on top — enough to exhaust a Worker before a
 * single call is made. Measured: loading the whole file and chunking in memory
 * fails outright, while the same audio chunked from range reads succeeds.
 *
 * So the object is streamed once to index its frames, then each chunk is
 * fetched by byte range only when it is about to be sent. Peak memory is one
 * chunk, not the whole file.
 *
 * Chunks run SEQUENTIALLY. Whisper is rate-limited per account, and five slow
 * calls that all succeed beat five fast ones where the fourth is throttled and
 * the whole transcript has to be redone.
 */
export async function transcribeObject(
  env: Env,
  bucket: R2Bucket,
  key: string,
  opts: TranscribeOpts = {},
): Promise<TranscriptResult> {
  const head = await bucket.head(key);
  if (!head) throw new Error("That upload isn't there any more.");

  // Small enough for one call — the overwhelmingly common case.
  if (head.size <= SINGLE_CALL_MAX_BYTES) {
    const object = await bucket.get(key);
    if (!object) throw new Error("That upload isn't there any more.");
    const one = await transcribeOnce(env, await object.arrayBuffer(), opts);
    return { ...one, diarized: Boolean(opts.diarize) };
  }

  const indexSource = await bucket.get(key);
  if (!indexSource?.body) throw new Error("That upload isn't there any more.");

  let ranges;
  try {
    ranges = await indexMp3Chunks(indexSource.body, { chunkMs: CHUNK_MS, overlapMs: OVERLAP_MS });
  } catch {
    // Not MP3, so it cannot be cut safely. Say so plainly rather than sending a
    // too-large request that fails only after burning several minutes.
    throw new Error("That audio is too long to read in one go, and isn't in a format this can split yet.");
  }

  const done: ChunkTranscript[] = [];
  let neurons = 0;
  let totalMs = 0;

  for (const range of ranges) {
    const part = await bucket.get(key, {
      range: { offset: range.startByte, length: range.endByte - range.startByte },
    });
    if (!part) throw new Error("That upload isn't there any more.");

    const result = await transcribeOnce(env, await part.arrayBuffer(), opts);
    neurons += result.neurons;
    done.push({ startMs: range.startMs, segments: result.segments });
    totalMs = Math.max(totalMs, range.startMs + range.durationMs);
    opts.onProgress?.(done.length / ranges.length, done.length, ranges.length);
  }

  const segments = stitch(done);
  return {
    segments,
    text: joinText(segments),
    duration: totalMs / 1000,
    neurons,
    diarized: Boolean(opts.diarize),
  };
}

/**
 * The largest audio that goes to Whisper in a single call.
 *
 * Measured against the API: 55 MB (4 hours) succeeds; 69 MB fails after four
 * minutes; 82 MB is rejected outright. But the API's ceiling was never the
 * binding one — the WORKER's memory is, and that was missed.
 *
 * Whisper takes base64, so a call costs roughly:
 *
 *     the buffer (N)  +  the base64 string (1.33N chars)
 *
 * and a JS string is UTF-16, so those chars can cost two bytes each — about
 * 3.7N all in. At the old 50 MB that is ~180 MB against a 128 MB limit, which
 * is exactly the "Memory limit would be exceeded before EOF" a drone clip hit.
 *
 * 20 MB costs ~74 MB and leaves real headroom. It is not a small limit in
 * practice: we now transcribe extracted 32kbps mono audio, so 20 MB is about
 * 83 minutes of speech in a single call, and anything longer is chunked.
 */
export const SINGLE_CALL_MAX_BYTES = 20 * 1024 * 1024;

