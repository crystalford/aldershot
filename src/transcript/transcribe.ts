import type { Env } from "../env";
import type { Word } from "./edl";
import { durationFromWavSize } from "../wav";
import { MODELS } from "../models";

export interface TranscriptResult {
  mediaKey: string;
  text: string;
  words: Word[];
}

type WhisperResult = { text?: string; words?: { word: string; start: number; end: number }[]; [k: string]: unknown };

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000; // chunk to stay well under call-arg limits on large audio
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function runWhisper(env: Env, audio: unknown): Promise<WhisperResult> {
  const run = env.AI.run.bind(env.AI) as (model: string, inputs: Record<string, unknown>) => Promise<Record<string, unknown>>;
  return (await run(MODELS.transcribe, { audio })) as WhisperResult;
}

// Whisper's word-level timestamps (`res.words[].word`) commonly come back as
// bare lowercase tokens with punctuation stripped — useful for timing, useless
// for reading as a document. The aggregate `res.text` field carries the real
// casing and punctuation but no per-word timing. When both tokenize to the
// same word count (the common case — same transcript, same whitespace split),
// zip them: real text, real timestamps. If they don't line up (rare — a
// contraction split differently, etc.) fall back to the raw per-word tokens
// rather than guess at an alignment.
function reconcileWords(words: { word: string; start: number; end: number }[], fullText: string): Word[] {
  const textTokens = fullText.trim().split(/\s+/).filter(Boolean);
  if (textTokens.length === words.length) {
    return words.map((w, i) => ({ text: textTokens[i], start: w.start, end: w.end, deleted: false }));
  }
  return words.map((w) => ({ text: w.word, start: w.start, end: w.end, deleted: false }));
}

/**
 * Transcribe AUDIO bytes with Whisper → word-level timestamps.
 *
 * Whisper expects audio, not a video container; callers hand this a small
 * extracted audio slice. The live model's accepted input shape for 'audio'
 * isn't fully pinned down (docs/examples disagree — some show a plain byte
 * array, a real working caller uses base64), so we try base64 first and fall
 * back to the byte-array form on failure rather than guess wrong and fail.
 */
export async function transcribeAudio(env: Env, audio: ArrayBuffer): Promise<Word[]> {
  let res: WhisperResult;
  try {
    res = await runWhisper(env, toBase64(audio));
  } catch (base64Err) {
    try {
      res = await runWhisper(env, [...new Uint8Array(audio)]);
    } catch (arrayErr) {
      throw new Error(
        `Whisper rejected both audio encodings — base64: ${base64Err instanceof Error ? base64Err.message : base64Err}; array: ${arrayErr instanceof Error ? arrayErr.message : arrayErr}`,
      );
    }
  }

  console.log(
    "[whisper] response keys:", Object.keys(res),
    "textLen:", res.text?.length ?? 0,
    "wordsLen:", res.words?.length ?? 0,
    "sample:", JSON.stringify(res).slice(0, 400),
  );

  if (res.words && res.words.length) {
    return reconcileWords(res.words, res.text ?? "");
  }

  // No word-level timestamps came back on this call — rather than silently
  // return an empty transcript, spread the plain text evenly across the
  // chunk's known duration so there's still something to see/edit. (Logged
  // above so the real shape can be confirmed and word timing fixed for real.)
  const text = (res.text ?? "").trim();
  if (!text) return [];
  const tokens = text.split(/\s+/).filter(Boolean);
  const dur = durationFromWavSize(audio.byteLength);
  const per = tokens.length ? dur / tokens.length : 0;
  return tokens.map((t, i) => ({ text: t, start: i * per, end: (i + 1) * per, deleted: false }));
}

/**
 * Legacy single-file path: store the upload in R2 and transcribe. Kept for the
 * standalone editor; the project flow uses transcribeAudio + R2 persistence.
 */
export async function transcribeUpload(
  env: Env,
  bytes: ArrayBuffer,
  contentType: string,
): Promise<TranscriptResult> {
  const mediaKey = `uploads/${crypto.randomUUID()}`;
  await env.MEDIA.put(mediaKey, bytes, { httpMetadata: { contentType } });
  const words = await transcribeAudio(env, bytes);
  const text = words.map((w) => w.text).join(" ");
  return { mediaKey, text, words };
}
