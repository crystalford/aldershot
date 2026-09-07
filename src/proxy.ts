/**
 * The editing copy.
 *
 * The editor plays and scrubs the ORIGINAL. "Assume the source is a 45–180
 * minute video they did not record" (01-PRODUCT.md), which in practice is a
 * multi-gigabyte file — and clicking a transcript line is supposed to play
 * that line immediately. The editor opens the original twice, once for the
 * visible player and once for the thumbnail decoder, and every seek is a range
 * request into it.
 *
 * The design routes preview playback through Cloudflare Stream. Stream bills
 * per minute stored REGARDLESS OF FILE SIZE, so a small copy costs exactly
 * what the master costs — and nothing here is ever deleted, so it is rent for
 * ever on every minute anyone uploads. 05-INFRA-AND-COSTS.md: "the single
 * easiest way to make this product unprofitable." The note in index.ts beside
 * /media said the same thing and chose R2. It was right.
 *
 * So the copy lives in R2 like everything else. Measured on a ten-minute
 * source: 418 MB in, 34.6 MB out — about 3.5 MB a minute, which is under a
 * tenth of R2's price for the same minute in Stream, with no egress at all.
 *
 * WHAT THIS DOES NOT TOUCH: the export. edlForProject reads source.r2_key, so
 * a 4K render still comes off the master. The proxy is for looking at.
 */

import type { Env } from "./env.ts";
import { encoderFor } from "./encode.ts";
import { presignGet } from "./r2sign.ts";
import { putFromResponse } from "./r2stream.ts";

/**
 * Derived from the source key rather than stored, so it is idempotent: a retry
 * writes the same object and a half-finished one is simply overwritten. Same
 * reasoning as audioKeyFor in src/audio.ts.
 */
export function proxyKeyFor(sourceKey: string): string {
  /* IDEMPOTENT. Handed its own output it returns it unchanged, so a key that
     finds its way back round — a bad join, a backfill reading the wrong
     column — produces the same object rather than a copy of a copy. */
  if (/\.edit\.mp4$/i.test(sourceKey)) return sourceKey;
  return sourceKey.replace(/\.[a-z0-9]+$/i, "") + ".edit.mp4";
}

export interface ProxyResult {
  key: string;
  bytes: number;
  /** The SOURCE's shape, not the copy's — see makeProxy. */
  width: number;
  height: number;
}

/**
 * Makes the editing copy, and finds out what shape the video is.
 *
 * The dimensions matter on their own. `sources.width` and `sources.height`
 * have been declared since the first schema, written as null by createSource,
 * and updated by nothing anywhere in the repo — the server has never once
 * known whether a video was landscape or vertical. That is why vertical
 * footage is drawn into a landscape box.
 *
 * They are probed from the SOURCE and travel back in headers, because the
 * proxy is scaled and would only report the copy's shape.
 */
export async function makeProxy(
  env: Env,
  sourceKey: string,
  onProgress?: (label: string) => void,
): Promise<ProxyResult> {
  const key = proxyKeyFor(sourceKey);

  /* Already made. A backfill sweep runs over old footage, so this is the
     common case rather than the exception. */
  const existing = await env.MEDIA.head(key);
  if (existing) {
    return { key, bytes: existing.size, width: 0, height: 0 };
  }

  /* encoderFor rather than env.RENDER directly, so RENDER_URL works — src/
     audio.ts reaches for the binding and therefore cannot be exercised in
     development at all. */
  const container = encoderFor(env, `proxy-${sourceKey}`);
  if (!container) throw new Error("the encoder isn't running");

  const url =
    (await presignGet(env, sourceKey, 7200)) ??
    (env.MEDIA_PUBLIC_BASE ? `${env.MEDIA_PUBLIC_BASE}/media/${sourceKey}` : null);
  if (!url) throw new Error("couldn't give the encoder a way to read the file");

  onProgress?.("making an editing copy");

  const res = await container.fetch("http://container/proxy", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
    /* A three-hour 4K source is a real decode. Generous, and finite — an
       encoder that never answers must not hold a queue invocation for ever. */
    signal: AbortSignal.timeout(40 * 60 * 1000),
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(detail.slice(0, 200) || `the encoder failed (${res.status})`);
  }

  const width = Number(res.headers.get("x-width")) || 0;
  const height = Number(res.headers.get("x-height")) || 0;

  /* Streamed into R2, with a length R2 will accept — see src/r2stream.ts. */
  await putFromResponse(env.MEDIA, key, res, { contentType: "video/mp4" });

  const head = await env.MEDIA.head(key);
  if (!head?.size) throw new Error("the encoder produced no editing copy");
  return { key, bytes: head.size, width, height };
}

/**
 * Makes the copy and writes down where it is.
 *
 * Failure is DELIBERATELY not fatal to anything. A video with no editing copy
 * is still a video you can cut — every surface falls back to the original —
 * so a proxy that could not be made must never turn a readable video into a
 * failed one. It is logged and the sweep will try again.
 */
export async function attachProxy(
  env: Env,
  source: { id: string; r2_key: string },
  onProgress?: (label: string) => void,
): Promise<boolean> {
  try {
    const made = await makeProxy(env, source.r2_key, onProgress);
    await env.DB
      .prepare(
        `UPDATE sources SET proxy_r2_key=?,
                width=COALESCE(NULLIF(?,0), width),
                height=COALESCE(NULLIF(?,0), height)
          WHERE id=?`,
      )
      .bind(made.key, made.width, made.height, source.id)
      .run();
    return true;
  } catch (err) {
    console.log(`[proxy] ${source.id}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}


/**
 * Footage that predates the editing copy.
 *
 * Every source read before this existed has `proxy_r2_key` null and plays the
 * original, which works and is slow. Bounded per sweep and idempotent, in the
 * same shape as reapUsedAudio: it works through the backlog an hour at a time
 * and costs nothing once there is none left.
 *
 * TWO at a time, not the whole backlog. A proxy is a full decode of the video,
 * so a user with forty unprocessed sources would otherwise fill the container
 * ceiling for everyone the moment the cron fired.
 *
 * Only sources that have been READ. A source still transcribing has an
 * extraction in flight against the same file, and a source that failed to
 * transcribe is very likely one ffmpeg cannot open at all.
 */
export async function backfillProxies(env: Env, limit = 2): Promise<number> {
  const { results } = await env.DB
    .prepare(
      `SELECT id, r2_key FROM sources
        WHERE proxy_r2_key IS NULL AND deleted_at IS NULL AND transcript_state='ready'
        ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(limit)
    .all<{ id: string; r2_key: string }>();

  let made = 0;
  for (const src of results ?? []) {
    if (await attachProxy(env, src)) made++;
  }
  return made;
}
