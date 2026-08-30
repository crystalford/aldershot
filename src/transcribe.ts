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

import type { Env } from "./env";
import { TRANSCRIBE, TRANSCRIBE_DIARIZED } from "./models";

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
export function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
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
}

export async function transcribe(env: Env, media: ArrayBuffer, opts: TranscribeOpts = {}): Promise<TranscriptResult> {
  const model = opts.diarize ? TRANSCRIBE_DIARIZED : TRANSCRIBE;
  const run = env.AI.run.bind(env.AI) as (m: string, i: Record<string, unknown>) => Promise<WhisperResponse>;

  const input: Record<string, unknown> = { audio: toBase64(media) };
  if (opts.diarize) input.diarize = true;

  const res = await run(model.id, input);

  const segments = (res.segments ?? []).map((s) => ({ ...s, words: reconcile(s) }));
  return {
    text: res.text ?? "",
    segments,
    duration: res.transcription_info?.duration ?? (segments.at(-1)?.end ?? 0),
    neurons: res.usage?.neurons ?? 0,
    diarized: Boolean(opts.diarize),
  };
}

/**
 * Rough guide to whether a file can go straight to Whisper without extracting
 * audio first. Base64 inflates by 4/3, and 43 MB of audio (180 min at 32 kbps
 * mono) has been verified to work — so the ceiling is generous, but a raw
 * video is far larger than its audio and should still be extracted.
 */
export const DIRECT_TRANSCRIBE_MAX_BYTES = 45 * 1024 * 1024;
