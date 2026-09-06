/**
 * Rendering a project.
 *
 * The Worker decides WHAT to render (src/edl.ts) and the container does the
 * encoding — a Worker cannot run ffmpeg, and a long source cannot be pulled
 * into one at all.
 *
 * Every render is a new row. Re-rendering after an edit produces a new version
 * without losing the old, which is the acceptance criterion in
 * 06-BUILD-PLAN.md §Phase 3 and follows from the same rule as everything else
 * here: nothing is destroyed.
 */

import type { Env } from "./env.ts";
import { buildEdl, buildRenderPlan, buildSrt } from "./edl.ts";
import { parseCuts } from "./cuts.ts";
import { presignGet } from "./r2sign.ts";
import { advance, failJob, finishJob, startJob } from "./jobs.ts";
import { getBeats, getProject, listClipsForSource, type Project } from "./projects.ts";
import { getSegments, getSource } from "./sources.ts";
import { meter } from "./usage.ts";
import { ulid } from "./id.ts";

export type Format = "mp4_720" | "mp4_1080" | "mp4_4k";
export type Aspect = "16:9" | "9:16" | "1:1" | "4:5";

export interface RenderRow {
  id: string;
  project_id: string | null;
  user_id: string;
  kind: string;
  format: string;
  aspect: string;
  caption_style: string | null;
  r2_key: string | null;
  stream_uid: string | null;
  duration_s: number | null;
  bytes: number | null;
  state: string;
  error: string | null;
  created_at: number;
}

export async function createRender(
  db: D1Database,
  opts: { user_id: string; project_id: string; format: Format; aspect: Aspect },
): Promise<RenderRow> {
  const row: RenderRow = {
    id: ulid(),
    project_id: opts.project_id,
    user_id: opts.user_id,
    kind: "cut",
    format: opts.format,
    aspect: opts.aspect,
    caption_style: null,
    r2_key: null,
    stream_uid: null,
    duration_s: null,
    bytes: null,
    state: "queued",
    error: null,
    created_at: Date.now(),
  };
  await db
    .prepare(
      `INSERT INTO renders (id,project_id,user_id,kind,format,aspect,caption_style,r2_key,stream_uid,duration_s,bytes,state,error,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      row.id, row.project_id, row.user_id, row.kind, row.format, row.aspect, row.caption_style,
      row.r2_key, row.stream_uid, row.duration_s, row.bytes, row.state, row.error, row.created_at,
    )
    .run();
  return row;
}

export async function listRenders(db: D1Database, projectId: string): Promise<RenderRow[]> {
  const { results } = await db
    .prepare(`SELECT * FROM renders WHERE project_id=? ORDER BY created_at DESC`)
    .bind(projectId)
    .all<RenderRow>();
  return results ?? [];
}

/**
 * Builds the EDL for a project as it stands right now.
 *
 * Exported because it is also what the preview and the runtime figures should
 * read from — the number the user sees and the video they get must come from
 * the same place.
 */
export async function edlForProject(env: Env, project: Project, userId: string) {
  if (!project.source_id) return null;
  const source = await getSource(env.DB, project.source_id, userId);
  if (!source) return null;

  const [segments, beats, clips] = await Promise.all([
    getSegments(env.DB, source.id),
    getBeats(env.DB, project.id),
    listClipsForSource(env.DB, source.id, userId),
  ]);

  // A clip beat's range lives on the CLIP, not the beat — `dur_ms` says how
  // long it is but not where it starts, and rendering from a duration alone
  // would silently cut from the top of the source every time.
  const byId = new Map(clips.map((c) => [c.id, c]));

  const edl = buildEdl(
    source.r2_key,
    beats.map((b) => {
      const clip = b.clip_id ? byId.get(b.clip_id) : undefined;
      return {
        kind: b.kind as "clip" | "vo" | "react" | "generated" | "stock",
        start_ms: clip?.start_ms,
        end_ms: clip ? clip.end_ms : (b.dur_ms ?? undefined),
        text: b.text,
        media_r2_key: b.media_r2_key,
      };
    }),
    segments,
    parseCuts(project.cuts),
  );
  return { edl, source, segments };
}

/**
 * Runs the render. Reports real stages, meters what it burned, and on failure
 * keeps the project's beats untouched so Retry costs nothing but time
 * (04-API-AND-JOBS.md §Failure rules).
 */
export async function runRender(
  env: Env,
  opts: { userId: string; projectId: string; renderId: string; jobId: string },
): Promise<void> {
  const { jobId, renderId } = opts;
  const t0 = Date.now();

  const fail = async (message: string) => {
    await failJob(env.DB, jobId, message);
    await env.DB.prepare(`UPDATE renders SET state='failed', error=? WHERE id=?`).bind(message, renderId).run();
  };

  try {
    const project = await getProject(env.DB, opts.projectId, opts.userId);
    if (!project) return void (await fail("That project isn't there any more."));

    const render = await env.DB.prepare(`SELECT * FROM renders WHERE id=?`).bind(renderId).first<RenderRow>();
    if (!render) return void (await fail("That render isn't there any more."));

    await startJob(env.DB, jobId, "putting it together");
    await env.DB.prepare(`UPDATE renders SET state='running' WHERE id=?`).bind(renderId).run();

    const built = await edlForProject(env, project, opts.userId);
    if (!built || !built.edl.cuts.length) {
      return void (await fail("There's nothing kept to render yet."));
    }

    if (!env.RENDER) {
      // Honest rather than cryptic: the encoder genuinely is not available.
      return void (await fail("Rendering isn't available yet — the encoder isn't running."));
    }

    /*
     * The container reads the source over HTTP, so it needs URLs rather than
     * R2 keys. `-ss` before `-i` seeks by range request, which is what makes
     * cutting from a multi-gigabyte source viable without downloading it.
     *
     * PRESIGNED, not /media. This pointed at /media, which was unauthenticated
     * and therefore worked — and which is precisely why it had to stop being
     * unauthenticated. src/audio.ts already presigned for this exact reason
     * ("a presigned URL is used rather than a public one so a private bucket
     * still works"); the render path was simply never brought in line, and the
     * inconsistency was invisible while the door was open.
     *
     * Two hours is comfortably longer than any render and shorter than a URL
     * being worth stealing.
     */
    const plan = buildRenderPlan(built.edl, render.format, render.aspect);
    const urls = await Promise.all(
      plan.cuts.map(async (c) => {
        const signed =
          (await presignGet(env, c.key, 7200)) ??
          (env.MEDIA_PUBLIC_BASE ? `${env.MEDIA_PUBLIC_BASE}/media/${c.key}` : null);
        return signed;
      }),
    );
    if (urls.some((u) => !u)) {
      return void (await fail("Couldn't give the encoder a way to read your footage."));
    }
    const withUrls = {
      ...plan,
      cuts: plan.cuts.map((c, i) => ({ ...c, url: urls[i] as string })),
    };

    await advance(env.DB, jobId, 30, "putting it together");

    const container = env.RENDER.get(env.RENDER.idFromName(`render-${opts.projectId}`));
    const res = await container.fetch("http://container/render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(withUrls),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return void (await fail(`Couldn't put it together: ${detail.slice(0, 200) || res.statusText}`));
    }

    await advance(env.DB, jobId, 80, "saving it");

    const bytes = await res.arrayBuffer();
    const key = `u/${opts.userId}/renders/${renderId}.mp4`;
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: "video/mp4" } });

    // Subtitles alongside the render, in output time (Phase 3).
    const srt = buildSrt(built.edl);
    if (srt) {
      await env.MEDIA.put(`u/${opts.userId}/renders/${renderId}.srt`, srt, {
        httpMetadata: { contentType: "application/x-subrip" },
      });
    }

    await env.DB
      .prepare(`UPDATE renders SET state='ready', r2_key=?, bytes=?, duration_s=? WHERE id=?`)
      .bind(key, bytes.byteLength, Math.round(built.edl.durationMs / 1000), renderId)
      .run();

    await meter(env.DB, {
      user_id: opts.userId,
      job_id: jobId,
      job_type: "render",
      cpu_ms: Date.now() - t0,
      bytes_stored: bytes.byteLength,
    });

    await finishJob(env.DB, jobId);
  } catch (err) {
    await fail(`Couldn't put it together: ${err instanceof Error ? err.message : String(err)}`);
  }
}
