import type { Env } from "../env";
import type { Word } from "./edl";

export interface TranscriptResult {
  mediaKey: string;
  text: string;
  words: Word[];
}

/**
 * Store the upload in R2 and transcribe with Whisper (word-level timestamps).
 *
 * NOTE: Whisper expects audio. For VIDEO uploads, audio must be extracted first
 * (ffmpeg in the export Container — see container/). v0 works directly with audio
 * files (m4a/mp3/wav); video transcription wiring is the next step. Exact Whisper
 * response shape (word vs segment timestamps) to confirm against the live model.
 */
export async function transcribeUpload(
  env: Env,
  bytes: ArrayBuffer,
  contentType: string,
): Promise<TranscriptResult> {
  const mediaKey = `uploads/${crypto.randomUUID()}`;
  await env.MEDIA.put(mediaKey, bytes, { httpMetadata: { contentType } });

  const res = (await env.AI.run("@cf/openai/whisper-large-v3-turbo", {
    audio: [...new Uint8Array(bytes)],
  })) as { text: string; words?: { word: string; start: number; end: number }[] };

  const words: Word[] = (res.words ?? []).map((w) => ({
    text: w.word,
    start: w.start,
    end: w.end,
    deleted: false,
  }));

  return { mediaKey, text: res.text, words };
}
