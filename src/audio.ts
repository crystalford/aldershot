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
import { putFromResponse } from "./r2stream.ts";

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
  /*
   * WHERE TO READ THE VIDEO, when it is not in our bucket.
   *
   * Footage imported from a bucket somebody owns is never copied here — the
   * source row points at the object where it already lives. So the extractor
   * cannot be handed a presigned URL for OUR bucket; it needs one signed with
   * that connection's key, which only the caller holding the source row can
   * produce.
   *
   * Optional, and the default is unchanged: an uploaded video is still read
   * exactly as it was.
   */
  sourceUrl?: string | null,
): Promise<ExtractResult> {
  const key = audioKeyFor(sourceKey);

  const existing = await env.MEDIA.head(key);
  if (existing) return { key, bytes: existing.size };

  if (!env.RENDER) {
    throw new Error("the audio extractor isn't running");
  }

  const url =
    sourceUrl ??
    (await presignGet(env, sourceKey, 7200)) ??
    (env.MEDIA_PUBLIC_BASE ? `${env.MEDIA_PUBLIC_BASE}/media/${sourceKey}` : null);
  if (!url) throw new Error("couldn't give the extractor a way to read the file");

  onProgress?.("separating the audio");

  /*
   * The small machine when there is one, the big one when there is not.
   *
   * AUDIO is standard-2 — one whole vCPU, so this single-threaded extract runs
   * at exactly the same speed for half the memory (see AudioContainer in
   * src/render.ts). The fallback is not defensive padding: the binding is new,
   * and a Worker deployed before its container exists must still be able to
   * read a video rather than fail every upload.
   */
  const ns = env.AUDIO ?? env.RENDER;
  const container = ns.get(ns.idFromName(`audio-${sourceKey}`)) as unknown as {
    fetch(url: string, init?: RequestInit): Promise<Response>;
    sleepNow?(): Promise<void>;
  };

  /* Released on EVERY path, failures included — an instance we walk away from
     bills its whole allocated memory until the Durable Object is evicted. See
     AudioContainer.sleepNow in src/render.ts. */
  try {
    const res = await container.fetch("http://container/extract-full", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
      /*
       * THE ONE CONTAINER CALL WITH NO WAY OUT, ON THE PATH EVERY UPLOAD TAKES.
       *
       * Every other call into a container is bounded — the render start at 60s
       * (src/encode.ts), a status poll at 30s, collecting the file at 10
       * minutes, the proxy at 40. This one had nothing, and it is the only one
       * that runs on all of them.
       *
       * A hung request is not a slow request, it is a machine that never
       * sleeps. @cloudflare/containers refuses to sleep while any request is
       * outstanding, so a stalled extract renews sleepAfter for ever and the
       * instance bills its full allocated memory until the Durable Object is
       * evicted. Seven of those, awake around the clock, is a $20 day.
       *
       * It also defeats the release in the `finally` below: that runs when the
       * await returns, and the await never returns. A deadline is what turns a
       * hang into a failure, and only then does anything else get a chance to
       * tidy up.
       *
       * Thirty minutes is deliberately generous — this streams a multi-gigabyte
       * source out of R2 — and deliberately finite. The proxy does strictly
       * more work on the same file in forty.
       */
      signal: AbortSignal.timeout(30 * 60 * 1000),
    });
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      throw new Error(detail.slice(0, 200) || `the extractor failed (${res.status})`);
    }

    /* Streamed into R2, with a length R2 will accept — see src/r2stream.ts,
       which is where this rule was first worked out and now lives. */
    await putFromResponse(env.MEDIA, key, res, {
      contentType: "audio/mpeg",
      /* Six hours of speech is ~86MB, so the no-length fallback is bounded
         lower here than for video. */
      maxBufferBytes: 64 * 1024 * 1024,
    });

    const head = await env.MEDIA.head(key);
    if (!head?.size) throw new Error("the extractor produced no audio");
    return { key, bytes: head.size };
  } finally {
    await container.sleepNow?.().catch(() => {});
  }
}
