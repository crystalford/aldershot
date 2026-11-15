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
import { countJobsFor, createJob, latestJobFor } from "./jobs.ts";
import { dispatch } from "./queue.ts";
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
  /** Where the poster landed, when this pass made one. */
  posterKey?: string;
}

/** Where a source's poster lives. Derived, so a retry overwrites rather than
    orphaning — the same rule as audioKeyFor and proxyKeyFor. */
export function posterKeyFor(sourceKey: string): string {
  return sourceKey.replace(/\/[^/]*$/, "") + "/poster.jpg";
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

  /* Released on EVERY path, including the failures. An instance we walk away
     from bills its whole allocated memory until the Durable Object is evicted
     — see RenderContainer.sleepNow. */
  try {
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

    /*
     * AND THE POSTER, FROM THE SAME DECODE.
     *
     * The only thing that ever made one was the browser at upload time. Miss
     * that path once — an API upload, a tab closed early, an extraction that
     * failed — and the video is a black rectangle on Home and in Footage for
     * ever, with nothing to fix it. Six of nine had none.
     *
     * Collected from the SAME container instance, which is still awake: no new
     * machine, no new wake, and the frame was already going past. A failure
     * here is not a failure of the editing copy, which is the thing the caller
     * actually asked for, so it is swallowed rather than thrown.
     */
    const posterId = res.headers.get("x-poster");
    let posterKey: string | undefined;
    /* Only when there is a gap to fill. The derived key is the SAME one the
       browser writes to, so fetching unconditionally would overwrite a frame
       the user actually watched being chosen with a heuristic guess. */
    const already = posterId ? await env.MEDIA.head(posterKeyFor(sourceKey)).catch(() => null) : null;
    if (posterId && !already) {
      try {
        const shot = await container.fetch(`http://container/poster?id=${encodeURIComponent(posterId)}`, {
          signal: AbortSignal.timeout(60_000),
        });
        if (shot.ok && shot.body) {
          const pk = posterKeyFor(sourceKey);
          await putFromResponse(env.MEDIA, pk, shot, { contentType: "image/jpeg", maxBufferBytes: 8 * 1024 * 1024 });
          posterKey = pk;
        } else {
          await shot.body?.cancel().catch(() => {});
        }
      } catch (err) {
        console.log(`[proxy] poster ${sourceKey}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { key, bytes: head.size, width, height, ...(posterKey ? { posterKey } : {}) };
  } finally {
    await container.release?.();
  }
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
): Promise<{ ok: boolean; cpuMs: number; bytes: number }> {
  const t0 = Date.now();
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
    /* COALESCE, not assignment: the browser's poster is the one the user
       watched being made and is usually a better frame than a heuristic. This
       fills the gap; it does not overrule. */
    if (made.posterKey) {
      await env.DB
        .prepare(`UPDATE sources SET poster_r2_key=COALESCE(poster_r2_key, ?) WHERE id=?`)
        .bind(made.posterKey, source.id)
        .run();
    }
    /* What it cost, so the caller can meter it. A 480p transcode of the whole
       video on four vCPUs is the newest recurring cost in this product and it
       was the only job not writing a usage row. */
    return { ok: true, cpuMs: Date.now() - t0, bytes: made.bytes };
  } catch (err) {
    console.log(`[proxy] ${source.id}: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, cpuMs: Date.now() - t0, bytes: 0 };
  }
}


/**
 * Footage that predates the editing copy.
 *
 * Every source read before this existed has `proxy_r2_key` null and plays the
 * original, which works and is slow.
 *
 * OFF BY DEFAULT, AND THAT IS THE POINT.
 *
 * This ran four full 480p transcodes an hour, from the cron, forever — on a
 * standard-4, whether or not anybody opened the app. A standard-4 costs
 * roughly $0.40 an hour awake, so four jobs an hour of a couple of minutes
 * each is on the order of $40 a month of STANDING cost, incurred by an empty
 * account with a backlog. It stops only when the backlog clears, and it never
 * clears for footage nobody returns to.
 *
 * It was never load-bearing. proxyFirst (below) gives the video you actually
 * open its editing copy on demand and jumps it to the front, which is the only
 * moment the copy matters. This was a nicety that quietly billed by the hour.
 *
 * The parameter stays, so turning it back on is one number in the sweep and
 * not a code change — pass 2 or 4 to work a backlog off deliberately, watch
 * the Containers line, and set it back.
 *
 * Only sources that have been READ. A source still transcribing has an
 * extraction in flight against the same file, and a source that failed to
 * transcribe is very likely one ffmpeg cannot open at all.
 */
export async function backfillProxies(env: Env, limit = 0): Promise<number> {
  /* Not "LIMIT 0", which is a query that returns nothing and still costs a
     round trip on every sweep for the rest of the product's life. */
  if (limit <= 0) return 0;
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
    if ((await attachProxy(env, src)).ok) made++;
  }
  return made;
}


/**
 * How many times an editing copy is attempted before the product stops, and
 * how long it waits between tries.
 *
 * Exported so test/proxy-retry.test.ts drives the real numbers rather than
 * its own, and so the ceiling is a value somebody can find rather than a
 * literal buried in a guard.
 */
export const PROXY_ATTEMPTS = 3;
export const PROXY_RETRY_AFTER_MS = 60 * 60 * 1000;

/**
 * THE VIDEO YOU JUST OPENED GOES FIRST.
 *
 * backfillProxies works a backlog off two an hour, deliberately, so a large
 * library does not claim every container at once. But that is a queue with no
 * sense of what you are looking at: with a dozen videos read before the
 * editing copy existed, the one you opened could sit ten hours behind videos
 * you had no intention of touching, and you would be editing against the
 * 4K master the whole time.
 *
 * So opening a video jumps it. Called from the editor and from the source
 * page — the two places you can be looking at footage.
 *
 * Cheap and idempotent: it returns immediately if the copy exists, and it
 * checks for a proxy job already queued or running before making a second
 * one. Every failure is swallowed, because not getting a faster copy is a
 * slower edit and never a broken page.
 *
 * AND IT GIVES UP. The guard above tested `queued` and `running` and not
 * `failed`, so a video whose copy could not be made got a NEW job on every
 * single view of its cut page, for the life of the account. The development
 * database holds 9,695 of them against three videos — one per page view —
 * and in production each one is a container start, a usage row and a
 * dead-letter candidate, for a file that may never be copyable: a corrupt
 * upload, a codec ffmpeg will not open, a bucket whose read access was
 * revoked.
 *
 * So: three attempts, an hour apart, then it stops. The numbers are below
 * with the reasoning. The count comes out of the jobs table, which already
 * holds one row per try, and it is only asked for on the path where the last
 * attempt failed — a healthy source gets its copy first time and pays one
 * query, exactly as before.
 */
export async function proxyFirst(
  env: Env,
  ctx: ExecutionContext | undefined,
  src: { id: string; user_id: string; r2_key: string | null; proxy_r2_key?: string | null; transcript_state?: string | null },
): Promise<void> {
  if (!ctx || !src.r2_key || src.proxy_r2_key) return;
  /* An edit's own output is already small; making a proxy of one is work for
     nothing. Same test ingest uses. */
  if (src.r2_key.endsWith(".edit.mp4")) return;

  try {
    const last = await latestJobFor(env.DB, src.id, src.user_id, ["proxy"]);
    if (last && (last.state === "queued" || last.state === "running")) return;

    if (last?.state === "failed") {
      /*
       * BACK OFF, THEN GIVE UP.
       *
       * An hour, because the failures worth retrying are the transient ones
       * — a cold container, an R2 blip, a timeout under load — and those
       * clear in minutes, not days. Anything still failing an hour later is
       * very likely the file.
       *
       * Three, because the first retry catches almost all of the transient
       * cases and the second catches the unlucky ones; a fourth has never
       * been the difference between a copy and no copy, and the whole point
       * is a ceiling that exists.
       *
       * `finished_at ?? created_at`: a job reaped as stale may never have
       * been given a finish time, and treating that as "no time at all"
       * would make the backoff fire immediately — which is the bug again.
       */
      const since = Date.now() - (last.finished_at ?? last.created_at);
      if (since < PROXY_RETRY_AFTER_MS) return;

      const failures = await countJobsFor(env.DB, src.id, src.user_id, "proxy", "failed");
      if (failures >= PROXY_ATTEMPTS) return;
    }

    const job = await createJob(env.DB, { user_id: src.user_id, type: "proxy", ref_id: src.id });
    await dispatch(env, ctx, { type: "proxy", jobId: job.id, userId: src.user_id, sourceId: src.id });
  } catch (err) {
    console.log(`[proxy] couldn't jump the queue for ${src.id}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
