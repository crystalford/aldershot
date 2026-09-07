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
import { advance, failJob, finishJob, secondsPerOutputSecond, startJob } from "./jobs.ts";
import { blocksForProject, getProject, type Project } from "./projects.ts";
import { getSegments, getSource } from "./sources.ts";
import { meter } from "./usage.ts";
import { ulid } from "./id.ts";

export type Format = "mp4_720" | "mp4_1080" | "mp4_4k";
export type Aspect = "16:9" | "9:16" | "1:1" | "4:5";

/**
 * What you can actually export as, and what each one is for.
 *
 * These existed only as a type. "Export as" hardcoded mp4_1080 and 16:9 —
 * a button whose label promises a choice and then asks nothing — so vertical
 * was impossible to produce and 4K, which Settings SELLS as a Studio feature,
 * could not be selected by anyone at all.
 *
 * `pro` marks what the paid plan is for. The gate is enforced server-side as
 * well as shown here, because the API took whatever it was handed: a free
 * account could have posted mp4_4k directly and been rendered it.
 */
export const FORMATS: Array<{ id: Format; label: string; note: string; pro?: boolean }> = [
  { id: "mp4_720", label: "720p", note: "small file" },
  { id: "mp4_1080", label: "1080p", note: "the usual" },
  { id: "mp4_4k", label: "4K", note: "Studio", pro: true },
];

export const RENDER_ASPECTS: Array<{ id: Aspect; label: string; note: string }> = [
  { id: "16:9", label: "16:9", note: "landscape" },
  { id: "9:16", label: "9:16", note: "vertical" },
  { id: "1:1", label: "1:1", note: "square" },
  { id: "4:5", label: "4:5", note: "portrait" },
];

export function isFormat(v: unknown): v is Format {
  return FORMATS.some((f) => f.id === v);
}

export function isAspect(v: unknown): v is Aspect {
  return RENDER_ASPECTS.some((a) => a.id === v);
}

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
  opts: { user_id: string; project_id: string; format: Format; aspect: Aspect; captionStyle?: string | null; kind?: string },
): Promise<RenderRow> {
  const row: RenderRow = {
    id: ulid(),
    project_id: opts.project_id,
    user_id: opts.user_id,
    kind: opts.kind ?? "cut",
    format: opts.format,
    aspect: opts.aspect,
    caption_style: opts.captionStyle ?? null,
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

/**
 * A project's exports, and for one still running, what it is doing.
 *
 * The row alone could only say "putting it together" for the whole encode.
 * The job behind it knows the stage and when it started, and the account's
 * own finished renders know the rate — so a waiting row can say how long it
 * has been and roughly how long is left, both from measurement.
 */
export async function listRenders(
  db: D1Database,
  projectId: string,
  userId?: string,
): Promise<RenderRow[]> {
  const { results } = await db
    .prepare(`SELECT * FROM renders WHERE project_id=? ORDER BY created_at DESC`)
    .bind(projectId)
    .all<RenderRow>();
  const rows = results ?? [];

  const live = rows.filter((r) => r.state === "queued" || r.state === "running");
  if (!live.length || !userId) return rows;

  const { results: jobs } = await db
    .prepare(
      `SELECT ref_id, stage_label, started_at FROM jobs
        WHERE type='render' AND ref_id IN (${live.map(() => "?").join(",")})
        ORDER BY created_at DESC`,
    )
    .bind(...live.map((r) => r.id))
    .all<{ ref_id: string; stage_label: string | null; started_at: number | null }>();

  const byRender = new Map<string, { stage_label: string | null; started_at: number | null }>();
  for (const j of jobs ?? []) if (!byRender.has(j.ref_id)) byRender.set(j.ref_id, j);

  /* Seconds of encoding per second of output, from this account's own
     history. Null until there are three finished renders to learn from. */
  const rate = await secondsPerOutputSecond(db, userId, "render");

  return rows.map((r) => {
    const j = byRender.get(r.id);
    if (!j) return r;
    return {
      ...r,
      stage_label: j.stage_label,
      started_at: j.started_at,
      eta_ms: rate && r.duration_s ? Math.round(rate * r.duration_s * 1000) : null,
    };
  });
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

  const segments = await getSegments(env.DB, source.id);

  /*
   * The render is built from the SAME blocks the editor shows.
   *
   * It used to build from clip beats, which only exist after a scoring pass —
   * so a cut made by striking text produced an empty EDL and failed with
   * "There's nothing kept to render yet". It also never read `block_order`, so
   * rearranging blocks could not change the file, and it had no notion of a
   * struck beat, so a voiceover you cut was exported anyway.
   *
   * buildBlocks is the one place that says what a cut IS. Reading it here is
   * what makes the editor's runtime and the exported file the same thing.
   */
  const { blocks, cuts } = await blocksForProject(env.DB, project, userId, { segments });

  const edl = buildEdl(source.r2_key, blocks, cuts);
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

    /*
     * The encoder, or a local one.
     *
     * RENDER_URL exists so the render can be exercised in development, where
     * Cloudflare Containers need a Docker daemon that a sandbox usually does
     * not have. `node container/render.mjs` is a plain HTTP server — point
     * this at it and the whole path runs for real, which is how the concat,
     * the burned-in captions, the aspect sizing and the voiceover card were
     * finally verified instead of reasoned about.
     *
     * RENDER_URL WINS when it is set, because the binding can exist and still
     * not work — wrangler dev declares it whether or not containers are
     * enabled, and calling it then fails with "Containers have not been
     * enabled for this Durable Object class". Setting the variable is a
     * deliberate act; production never does, so the binding is used there.
     */
    if (!env.RENDER && !env.RENDER_URL) {
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
    const plan = buildRenderPlan(built.edl, render.format, render.aspect, render.caption_style);
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

    /* The output length is known from the plan, so it is recorded before the
       encode rather than after — that is what turns a measured rate into an
       estimate for THIS render while it is still running. */
    await env.DB
      .prepare(`UPDATE renders SET duration_s=? WHERE id=?`)
      .bind(Math.max(1, Math.round(plan.durationS)), opts.renderId)
      .run();

    await advance(env.DB, jobId, 30, "putting it together");

    const encoder = env.RENDER_URL
      ? { fetch: (_u: string, init: RequestInit) => fetch(`${env.RENDER_URL}/render`, init) }
      : env.RENDER!.get(env.RENDER!.idFromName(`render-${opts.projectId}`));
    /*
     * A DEADLINE on the encoder.
     *
     * There was none. The container either answers or it does not, and when
     * it does not — no free instance, a wedged process — this waited, the job
     * stayed at 30%, and nothing noticed for three hours. The owner's first
     * export sat there.
     *
     * Generous enough for a long 4K export and finite, which is the point: a
     * timeout is a failure with a reason attached, and a reason can be
     * retried.
     */
    const res = await encoder.fetch("http://container/render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(withUrls),
      signal: AbortSignal.timeout(25 * 60 * 1000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return void (await fail(`Couldn't put it together: ${detail.slice(0, 200) || res.statusText}`));
    }

    await advance(env.DB, jobId, 80, "saving it");

    /*
     * STREAM it into R2 rather than holding it.
     *
     * This was `await res.arrayBuffer()` — the entire finished mp4 in Worker
     * memory before a byte reached storage. A short cut is fine; a long 4K
     * export is hundreds of megabytes and would hit the memory ceiling and
     * report "Couldn't put it together", which reads like an encoder fault
     * rather than the Worker running out of room. The panel offers 4K with no
     * length cap, so the ceiling is reachable from the UI.
     *
     * R2 reports the size it actually stored, so nothing has to be counted on
     * the way past.
     */
    const key = `u/${opts.userId}/renders/${renderId}.mp4`;
    const stored = await env.MEDIA.put(key, res.body, {
      httpMetadata: { contentType: "video/mp4" },
    });
    const size = stored?.size ?? Number(res.headers.get("content-length")) ?? 0;
    const measuredS = Math.round(Number(res.headers.get("x-duration-s")) || 0);

    // Subtitles alongside the render, in output time (Phase 3).
    const srt = buildSrt(built.edl);
    if (srt) {
      await env.MEDIA.put(`u/${opts.userId}/renders/${renderId}.srt`, srt, {
        httpMetadata: { contentType: "application/x-subrip" },
      });
    }

    await env.DB
      .prepare(`UPDATE renders SET state='ready', r2_key=?, bytes=?, duration_s=? WHERE id=?`)
      /* The encoder measures the finished file; the EDL only says what the cut
         was meant to add up to. They differ when a source is shorter than its
         transcript claims, and the row should describe the video that exists. */
      .bind(key, size, measuredS || Math.round(built.edl.durationMs / 1000), renderId)
      .run();

    await meter(env.DB, {
      user_id: opts.userId,
      job_id: jobId,
      job_type: "render",
      cpu_ms: Date.now() - t0,
      bytes_stored: size,
    });

    await finishJob(env.DB, jobId);
  } catch (err) {
    /* A deadline reached is a TimeoutError, and "Couldn't put it together:
       signal timed out" tells a person nothing they can act on. */
    const timedOut = err instanceof Error && /timeout|abort/i.test(err.name + err.message);
    await fail(
      timedOut
        ? "The encoder didn't finish in time. It may be busy — try the export again."
        : `Couldn't put it together: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
