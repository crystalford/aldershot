/**
 * Rendering one short.
 *
 * Clipping's lede is "Scored vertical shorts, captions burned in" and it has
 * never rendered anything: `runShorts` finds moments and writes clip rows, the
 * card stretched a 16:9 still into a 9:16 box, and its play button was a
 * `<span>`. A quarter of the nav produced database rows and called them shorts.
 *
 * This is deliberately NOT the cut renderer. A cut render belongs to a project
 * and takes its ranges from that project's beats; a short is one moment from
 * the library with no project behind it, because Clipping produces material
 * rather than edits. Same container, same plan shape, same R2 destination —
 * a different way of arriving at the one cut it contains.
 *
 * On demand, never automatic. Rendering eight shorts because a scoring pass
 * found eight would spend real money on videos nobody asked for, and this
 * product's stated rule is that nothing renders until you say so.
 */

import type { Env } from "./env.ts";
import { advance, failJob, finishJob, startJob } from "./jobs.ts";
import { captionCues, type RenderPlan } from "./edl.ts";
import { presignGet } from "./r2sign.ts";
import { getSegments } from "./sources.ts";
import { ulid } from "./id.ts";
import { meter } from "./usage.ts";

export interface ShortRenderOpts {
  userId: string;
  clipId: string;
  renderId: string;
  jobId: string;
}

export async function runShortRender(env: Env, opts: ShortRenderOpts): Promise<void> {
  const { jobId, renderId } = opts;

  const fail = async (message: string) => {
    await env.DB.prepare(`UPDATE renders SET state='failed', error=? WHERE id=?`).bind(message, renderId).run();
    await failJob(env.DB, jobId, message);
  };

  try {
    await startJob(env.DB, jobId, "putting it together");

    const render = await env.DB
      .prepare(`SELECT * FROM renders WHERE id=? AND user_id=?`)
      .bind(renderId, opts.userId)
      .first<{ format: string; aspect: string; caption_style: string | null }>();
    if (!render) return void (await fail("That export isn't there any more."));

    const clip = await env.DB
      .prepare(
        `SELECT c.id, c.start_ms, c.end_ms, c.quote, s.r2_key AS source_key, s.id AS source_id
           FROM v2_clips c JOIN sources s ON s.id = c.source_id
          WHERE c.id=? AND c.user_id=? AND c.deleted_at IS NULL`,
      )
      .bind(opts.clipId, opts.userId)
      .first<{ start_ms: number; end_ms: number; quote: string; source_key: string; source_id: string }>();
    if (!clip) return void (await fail("That clip isn't there any more."));

    if (!env.RENDER) return void (await fail("Rendering isn't available yet — the encoder isn't running."));

    /* Presigned, like every other container read. /media requires a session
       and the container has none. */
    const url =
      (await presignGet(env, clip.source_key, 7200)) ??
      (env.MEDIA_PUBLIC_BASE ? `${env.MEDIA_PUBLIC_BASE}/media/${clip.source_key}` : null);
    if (!url) return void (await fail("Couldn't give the encoder a way to read your footage."));

    /*
     * Captions come from the transcript lines this clip actually covers, timed
     * against the SHORT's clock rather than the source's — the cue for a line
     * 22 minutes into a video has to start at 0 in a 30-second short.
     * captionCues does exactly that reduction, which is why it was worth
     * lifting out of buildSrt rather than reimplementing here.
     */
    const wantsCaptions = Boolean(render.caption_style && render.caption_style !== "None");
    let captions: ReturnType<typeof captionCues> = [];

    if (wantsCaptions) {
      const segments = await getSegments(env.DB, clip.source_id);
      const covered = segments.filter((sg) => sg.end_ms > clip.start_ms && sg.start_ms < clip.end_ms);
      captions = captionCues({
        cuts: covered.map((sg) => ({
          sourceKey: clip.source_key,
          start_ms: Math.max(sg.start_ms, clip.start_ms),
          end_ms: Math.min(sg.end_ms, clip.end_ms),
          text: sg.text,
        })),
        durationMs: clip.end_ms - clip.start_ms,
      });
    }

    await advance(env.DB, jobId, 40, "putting it together");

    const plan: RenderPlan & { cuts: Array<{ key: string; start_s: number; end_s: number; url: string }> } = {
      cuts: [{ key: clip.source_key, start_s: clip.start_ms / 1000, end_s: clip.end_ms / 1000, url }],
      format: render.format,
      aspect: render.aspect,
      durationS: (clip.end_ms - clip.start_ms) / 1000,
      ...(wantsCaptions ? { captions, captionStyle: render.caption_style as string } : {}),
    };

    const container = env.RENDER.get(env.RENDER.idFromName(`short-${opts.clipId}`));
    const res = await container.fetch("http://container/render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(plan),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return void (await fail(detail.slice(0, 200) || `The encoder failed (${res.status})`));
    }

    await advance(env.DB, jobId, 80, "saving it");

    /* Streamed rather than buffered, for the same reason as the full render:
       holding a finished mp4 in Worker memory to hand it to R2 is a ceiling
       reachable from the export panel. See src/render-job.ts. */
    const key = `u/${opts.userId}/shorts/${renderId}.mp4`;
    const stored = await env.MEDIA.put(key, res.body, {
      httpMetadata: { contentType: "video/mp4" },
    });
    const size = stored?.size ?? Number(res.headers.get("content-length")) ?? 0;

    await env.DB
      .prepare(`UPDATE renders SET state='ready', r2_key=?, bytes=?, duration_s=? WHERE id=?`)
      .bind(key, size, Math.round(plan.durationS), renderId)
      .run();

    await meter(env.DB, {
      user_id: opts.userId,
      job_id: jobId,
      job_type: "shorts",
      bytes_stored: size,
    });

    await finishJob(env.DB, jobId);
  } catch (err) {
    await fail(`Couldn't make that short: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** The render row a short's job writes into. */
export async function createShortRender(
  db: D1Database,
  opts: { userId: string; clipId: string; aspect: string; captionStyle: string; format?: string },
): Promise<string> {
  const id = ulid();
  await db
    .prepare(
      `INSERT INTO renders (id,project_id,user_id,kind,format,aspect,caption_style,clip_id,r2_key,stream_uid,duration_s,bytes,state,error,created_at)
       VALUES (?,NULL,?,'short',?,?,?,?,NULL,NULL,NULL,NULL,'queued',NULL,?)`,
    )
    .bind(id, opts.userId, opts.format ?? "mp4_1080", opts.aspect, opts.captionStyle, opts.clipId, Date.now())
    .run();
  return id;
}

/**
 * The newest render of each of these clips, for the cards to show state.
 *
 * duration_s comes back too, because a card has to know whether the file it
 * has is still a file of THIS clip: trimming moves the boundaries and leaves a
 * finished video of the old ones behind.
 */
export async function shortRendersFor(
  db: D1Database,
  userId: string,
  clipIds: string[],
): Promise<Map<string, { id: string; state: string; r2_key: string | null; error: string | null; duration_s: number | null }>> {
  if (!clipIds.length) return new Map();
  const marks = clipIds.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      `SELECT clip_id, id, state, r2_key, error, duration_s FROM renders
        WHERE user_id=? AND kind='short' AND clip_id IN (${marks})
        ORDER BY created_at DESC`,
    )
    .bind(userId, ...clipIds)
    .all<{ clip_id: string; id: string; state: string; r2_key: string | null; error: string | null; duration_s: number | null }>();

  const out = new Map<string, { id: string; state: string; r2_key: string | null; error: string | null; duration_s: number | null }>();
  /* Newest first, so the first one seen for a clip is the one that counts. */
  for (const r of results ?? []) if (!out.has(r.clip_id)) out.set(r.clip_id, r);
  return out;
}
