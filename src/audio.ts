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

import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import type { Env } from "./env.ts";
import { presignGet } from "./r2sign.ts";

/** Where a source's extracted audio lives. Derived, so it is idempotent. */
export function audioKeyFor(sourceKey: string): string {
  return `${sourceKey.replace(/\.[a-z0-9]+$/i, "")}.audio.mp3`;
}

/**
 * Deletes extracted audio that has already done its job.
 *
 * The MP3 exists to hand the speech model 14MB instead of a multi-gigabyte 4K
 * file, and once a transcript is written it has no further use. Nothing ever
 * deleted it, so every video read before this leaves one in R2 for the life of
 * the source — roughly 14MB per hour of footage — and storedBytes does not
 * count it, so the storage figure the product reports has been short by
 * exactly that on every account.
 *
 * A source whose transcript is READY is one whose audio is finished with. A
 * delete of a key that is not there is a no-op, so this is safe to run over
 * and over, and it needs no record of which ones it has already done.
 *
 * Bounded per sweep: this walks R2, and an account with a thousand videos
 * should not turn the hourly cron into a thousand round trips.
 */
export async function reapUsedAudio(
  db: D1Database,
  media: R2Bucket,
  limit = 50,
): Promise<number> {
  const { results } = await db
    .prepare(
      `SELECT r2_key FROM sources
        WHERE transcript_state='ready' AND deleted_at IS NULL AND r2_key IS NOT NULL
        ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(limit)
    .all<{ r2_key: string }>();

  let freed = 0;
  for (const row of results ?? []) {
    const key = audioKeyFor(row.r2_key);
    try {
      const head = await media.head(key);
      if (!head) continue;
      await media.delete(key);
      freed += head.size;
    } catch {
      /* Already gone, or never landed. Neither stops the next one. */
    }
  }
  return freed;
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
   * Streamed into R2 rather than buffered. The audio is small for a short
   * clip, but "small" is exactly the assumption that produced the bug this
   * fixes: six hours of speech is ~86MB, which is not something to hold.
   *
   * R2 will not accept a stream of unknown length — "Provided readable stream
   * must have a known length" — and although the container sets Content-Length,
   * it does not survive as a known-length body through the container proxy.
   * FixedLengthStream is the way to hand R2 a length it will accept, and
   * pipeTo runs alongside the put rather than before it, or the two deadlock
   * waiting on each other.
   */
  const declared = Number(res.headers.get("content-length") || 0);

  if (declared > 0) {
    const fixed = new FixedLengthStream(declared);
    void res.body.pipeTo(fixed.writable);
    await env.MEDIA.put(key, fixed.readable, { httpMetadata: { contentType: "audio/mpeg" } });
  } else {
    /* No length declared. Buffering is the only option left, so it is bounded
       — better a clear refusal than an out-of-memory crash, which is the whole
       class of failure this file exists to end. */
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 64 * 1024 * 1024) {
      throw new Error("the extracted audio was too large to handle in one piece");
    }
    await env.MEDIA.put(key, buf, { httpMetadata: { contentType: "audio/mpeg" } });
  }

  const head = await env.MEDIA.head(key);
  if (!head?.size) throw new Error("the extractor produced no audio");
  return { key, bytes: head.size };
}
