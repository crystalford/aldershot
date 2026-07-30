import type { Env } from "../env";
import type { Word } from "./edl";

export interface TranscriptResult {
  mediaKey: string;
  text: string;
  words: Word[];
}

/**
 * Transcribe AUDIO bytes with Whisper → word-level timestamps.
 *
 * Whisper expects audio, not a video container. The client extracts a small
 * mono 16kHz track from the source (ffmpeg.wasm, see public/render.js) and
 * posts THAT here, so this function stays a pure audio→words call.
 */
export async function transcribeAudio(env: Env, audio: ArrayBuffer): Promise<Word[]> {
  // Whisper turbo's generated input type lags the live model (word-level
  // timestamps + exact audio encoding); call through a loosened signature.
  const run = env.AI.run.bind(env.AI) as (model: string, inputs: Record<string, unknown>) => Promise<Record<string, unknown>>;
  const res = (await run("@cf/openai/whisper-large-v3-turbo", {
    audio: [...new Uint8Array(audio)],
  })) as { text?: string; words?: { word: string; start: number; end: number }[] };

  return (res.words ?? []).map((w) => ({
    text: w.word,
    start: w.start,
    end: w.end,
    deleted: false,
  }));
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
