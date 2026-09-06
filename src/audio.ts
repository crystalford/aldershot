/**
 * Pull the audio track out of a video before reading it.
 *
 * THIS STEP WAS MISSING, and it is why a drone clip failed with "Memory limit
 * would be exceeded before EOF". The transcriber was being pointed at the
 * uploaded file itself — a 4K video — so the Worker was asked to hold a video
 * in memory and hand it to a speech model. Two separate problems in one:
 *
 *  1. Size. Transcription needs the words, and the words are a rounding error
 *     next to the pixels. An hour of 4K drone footage is gigabytes; the same
 *     hour as 32kbps mono audio is about 14MB. Everything downstream — the
 *     memory limit, the request size, the cost — was fighting a number that
 *     never needed to be that large.
 *
 *  2. Format. src/mp3.ts splits long audio by parsing MP3 frame headers so a
 *     chunk boundary lands exactly on a frame. An MP4 has no MP3 frames, so
 *     that indexer could never work on what it was being given.
 *
 * The container endpoint that does this (`/extract-full`, 32kbps mono 16kHz)
 * was written and tested long ago and simply never called from anywhere. This
 * is the wiring.
 */

import type { Env } from "./env.ts";
import { presignGet } from "./r2sign.ts";

/** Where a source's extracted audio lives. Derived, so it is idempotent. */
export function audioKeyFor(sourceKey: string): string {
  return `${sourceKey.replace(/\.[a-z0-9]+$/i, "")}.audio.mp3`;
}

/** Already audio? Then there is nothing to extract. */
export function isAudio(filename: string | null, contentType?: string | null): boolean {
  if (contentType?.startsWith("audio/")) return true;
  return /\.(mp3|m4a|aac|wav|flac|ogg|opus)$/i.test(filename ?? "");
}

export interface ExtractResult {
  key: string;
  bytes: number;
}

/**
 * Extracts the audio track to R2 and returns its key.
 *
 * Idempotent: a retry after a failed read reuses the audio rather than paying
 * for the extraction twice. The container fetches the source over HTTP because
 * it is a separate process with no R2 binding — a presigned URL is used rather
 * than a public one so a private bucket still works.
 */
export async function extractAudio(
  env: Env,
  sourceKey: string,
  onProgress?: (label: string) => void,
): Promise<ExtractResult> {
  const key = audioKeyFor(sourceKey);

  const existing = await env.MEDIA.head(key);
  if (existing) return { key, bytes: existing.size };

  if (!env.RENDER) {
    throw new Error("the audio extractor isn't running");
  }

  const url =
    (await presignGet(env, sourceKey, 7200)) ??
    (env.MEDIA_PUBLIC_BASE ? `${env.MEDIA_PUBLIC_BASE}/media/${sourceKey}` : null);
  if (!url) throw new Error("couldn't give the extractor a way to read the file");

  onProgress?.("separating the audio");

  const container = env.RENDER.get(env.RENDER.idFromName(`audio-${sourceKey}`));
  const res = await container.fetch("http://container/extract-full", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(detail.slice(0, 200) || `the extractor failed (${res.status})`);
  }

  /*
   * Streamed into R2 rather than buffered. The audio is small, but "small"
   * is exactly the assumption that produced the bug this fixes, and a stream
   * costs nothing here.
   */
  await env.MEDIA.put(key, res.body, { httpMetadata: { contentType: "audio/mpeg" } });

  const head = await env.MEDIA.head(key);
  if (!head?.size) throw new Error("the extractor produced no audio");
  return { key, bytes: head.size };
}
