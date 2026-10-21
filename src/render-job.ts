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
import { FRAME_MS, frameAccurate } from "./align.ts";
import { timingForProject } from "./align-source.ts";
import { sidecarWanted } from "./captions.ts";
import { buildEdl, buildRenderPlan, buildSrt } from "./edl.ts";
import { bindings, splitBindings, splitLine, type Binding } from "./envelope.ts";
import { loadRules } from "./rule-store.ts";
import { presignGet } from "./r2sign.ts";
import { advance, failJob, finishJob, secondsPerOutputSecond, startJob } from "./jobs.ts";
import { Cancelled, encode, EncodeError, encoderFor } from "./encode.ts";
import { putFromResponse } from "./r2stream.ts";
import { blocksForProject, getProject, type Project } from "./projects.ts";
import { getSegments, getSource, playableKey } from "./sources.ts";
import { meter } from "./usage.ts";
import { ulid } from "./id.ts";

export type Format = "mp4_720" | "mp4_1080" | "mp4_4k";
export type Aspect = "16:9" | "9:16" | "1:1" | "4:5";

/*
 * The shapes and caption styles a SHORT can take.
 *
 * These lived in shorts.ts beside Clipping's scoring pass. That page is gone
 * and its pass with it, but these two are render vocabulary and always were —
 * the editor's export panel reads CAPTION_STYLES, and the per-block "Make a
 * short" reads ASPECTS. They belong next to FORMATS and RENDER_ASPECTS rather
 * than in a module named after a deleted surface.
 */
export const ASPECTS = ["9:16", "1:1", "4:5"] as const;
export const CAPTION_STYLES = ["Bold", "Clean", "None"] as const;

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
  /** 1 when this export asked for its sound cleaned up. */
  enhance?: number | null;
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
  opts: { user_id: string; project_id: string; format: Format; aspect: Aspect; captionStyle?: string | null; kind?: string; enhance?: boolean },
): Promise<RenderRow> {
  const row: RenderRow = {
    id: ulid(),
    project_id: opts.project_id,
    user_id: opts.user_id,
    kind: opts.kind ?? "cut",
    format: opts.format,
    aspect: opts.aspect,
    caption_style: opts.captionStyle ?? null,
    enhance: opts.enhance ? 1 : 0,
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
      `INSERT INTO renders (id,project_id,user_id,kind,format,aspect,caption_style,enhance,r2_key,stream_uid,duration_s,bytes,state,error,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      row.id, row.project_id, row.user_id, row.kind, row.format, row.aspect, row.caption_style,
      row.enhance ?? 0, row.r2_key, row.stream_uid, row.duration_s, row.bytes, row.state, row.error, row.created_at,
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
 * WHAT YOU HAVE FINISHED, across the whole library.
 *
 * `listRenders` above is per-project, which is the only view this product has
 * ever had of its own output: an mp4 lived in the Exports strip inside the one
 * edit that made it, and finding last week's meant remembering which edit that
 * was. The owner said it the moment his first export worked — "that should
 * also be saved to a place of finished or exported or whatever".
 *
 * ONE list, both kinds. This took a `kind` and served two surfaces — 'cut' for
 * Footage's Exports tab and 'short' for Clipping — and when Clipping was
 * scrapped that made every finished short unreachable: its files stayed in R2,
 * kept counting against storage, and had no page that listed them. So it now
 * takes one kind or several, and Exports asks for both.
 *
 * Finished only. A render that failed is not something you have, and one still
 * running belongs on the surface that started it, where there is a Stop.
 */
export interface FinishedRender extends RenderRow {
  /** What it was made from, so a row can name itself without a second query. */
  title: string | null;
  /** Where to go back to — the edit, or the video a short was cut from. */
  href: string | null;
}

export type FinishedKind = "cut" | "short";

export async function listFinished(
  db: D1Database,
  userId: string,
  kind: FinishedKind | FinishedKind[],
  limit = 60,
): Promise<FinishedRender[]> {
  const kinds = Array.isArray(kind) ? kind : [kind];
  if (!kinds.length) return [];
  const slots = kinds.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      /* A cut is named by its edit; a short by the video its clip came from,
         because a short has no project. LEFT JOINs so a render whose edit has
         since been deleted still lists rather than vanishing — the file is
         still yours. */
      `SELECT r.*,
              COALESCE(p.title, s.title) AS title,
              p.id AS project_id_for_link,
              s.id AS source_id_for_link
         FROM renders r
         LEFT JOIN v2_projects p ON p.id = r.project_id AND p.deleted_at IS NULL
         LEFT JOIN v2_clips cl ON cl.id = r.clip_id
         LEFT JOIN sources s ON s.id = cl.source_id AND s.deleted_at IS NULL
        WHERE r.user_id=? AND r.kind IN (${slots}) AND r.state='ready' AND r.r2_key IS NOT NULL
        ORDER BY r.created_at DESC LIMIT ?`,
    )
    .bind(userId, ...kinds, limit)
    .all<RenderRow & { title: string | null; project_id_for_link: string | null; source_id_for_link: string | null }>();

  return (results ?? []).map((r) => ({
    ...r,
    title: r.title,
    href: r.project_id_for_link
      ? `/p/${r.project_id_for_link}/cut`
      : r.source_id_for_link
        ? `/sources/${r.source_id_for_link}`
        : null,
  }));
}

/**
 * Builds the EDL for a project as it stands right now.
 *
 * Exported because it is also what the preview and the runtime figures should
 * read from — the number the user sees and the video they get must come from
 * the same place.
 */
/**
 * THE ENVELOPE, CHECKED AT THE DOOR.
 *
 * compute()'s four reducers cannot split a must-keep group any more — each of
 * them drops whole groups (see src/envelope.ts). This is the assertion that
 * makes that a guarantee rather than four careful functions: invariant 2 says
 * validate and measure every edit before showing it, and never trust a claim
 * of success. A render is the last point where that is still cheap.
 *
 * It is deliberately ignorant of HOW a group got split. A hand cut can do it
 * and a person is entitled to — step 6 of the engine overrides everything
 * above it — but then they are told, here, rather than publishing a claim
 * whose qualifier they struck three edits ago and forgot. A fifth reducer
 * added by someone who has not read envelope.ts lands here too.
 *
 * KEPT means "has a beat that is not struck whole". A moment with no beat at
 * all is not in the render, which is the same thing to a viewer, so the two
 * cases are not distinguished. A group with nothing kept is not a break: the
 * whole proposition is simply not in this cut.
 */
export async function envelopeBreaks(
  env: Env,
  projectId: string,
): Promise<Array<{ ids: Array<string | number>; line: string }>> {
  const bs = bindings(await loadRules(env.DB, projectId));
  if (!bs.length) return [];

  const { results } = await env.DB.prepare(
    `SELECT clip_id, struck, text FROM beats WHERE project_id=? AND clip_id IS NOT NULL`,
  )
    .bind(projectId)
    .all<{ clip_id: string; struck: string | null; text: string | null }>();

  const kept = new Set<string>();
  const textOf = new Map<string, string>();
  for (const row of results ?? []) {
    if (row.text) textOf.set(row.clip_id, row.text);
    /* The same reading of the column as blocks.ts line 239, which is the one
       place that says what a cut is. Two readings of "struck" would disagree
       the first time either was touched. */
    const struckWhole = Boolean(row.struck) && row.struck !== "0";
    if (!struckWhole) kept.add(row.clip_id);
  }

  const isKept = (id: string | number) => kept.has(String(id));
  return splitBindings(bs, () => true, isKept).map((b: Binding) => ({
    ids: b.ids,
    line: splitLine(b, (id: string | number) => textOf.get(String(id)), isKept),
  }));
}

export async function edlForProject(env: Env, project: Project, userId: string) {
  /*
   * A PROJECT NEED NOT HAVE A VIDEO.
   *
   * This refused any project without one, which made "an edit assembled from
   * the library" unrenderable — and everything below it was already ready for
   * that: a block carries its own mediaKey, an EdlCut carries its own
   * sourceKey, runRender signs each cut's key separately, and the container
   * downloads one file per distinct url. The single-source assumption lived
   * here, at the top, and nowhere underneath.
   *
   * A source_id that no longer RESOLVES is different and still refused: that
   * is a deleted video, not a library edit, and quietly rendering whatever
   * clips survived would hand back a different film from the one asked for.
   */
  const source = project.source_id ? await getSource(env.DB, project.source_id, userId) : null;
  if (project.source_id && !source) return null;

  const segments = source ? await getSegments(env.DB, source.id) : [];

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

  /* Two keys: the master for the render, the editing copy for the preview.
     playableKey is the one definition of which file you watch. */
  /*
   * THE CUT LANDS WHERE THE TIMINGS ALLOW.
   *
   * A source that has been through forced alignment knows where the silence
   * between two words is, so the join goes there instead of on the last
   * phoneme. One that has not keeps the cut it always had. This is the only
   * place the two paths differ, and it is why the whole timing contract
   * exists rather than a boolean somewhere.
   */
  const timing = await timingForProject(env, project.id);
  const edl = buildEdl(source?.r2_key ?? "", blocks, cuts, source ? playableKey(source) : undefined, timing);
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
  /*
   * WHAT THE CUTS ARE WORTH, said once per render.
   *
   * Every cut in this product is placed on a word boundary, and those
   * boundaries are only as good as the timings behind them, and a cut draws
   * on every source in its scope — so this is the WORST of them, because one
   * unaligned video makes the whole export soft.
   *
   * It said `timingFor({ id: opts.projectId })` until the day the column
   * landed: a project id handed to a function that takes a source, which
   * type-checked only for as long as that function ignored its argument. It
   * logged a sentence about this cut that was true of no source in it.
   *
   * Logged rather than refused, because a cut that is three frames out is
   * still the cut somebody asked for; the refusal belongs where frame
   * accuracy is promised, and nothing promises it yet.
   */
  {
    const t = await timingForProject(env, opts.projectId);
    if (!frameAccurate(t)) {
      console.log(`[render] cuts placed on ${t.source} timings — ±${t.toleranceMs}ms, about ${Math.round(t.toleranceMs / FRAME_MS)} frames`);
    }
  }

  const { jobId, renderId } = opts;
  const t0 = Date.now();

  const fail = async (message: string) => {
    await failJob(env.DB, jobId, message);
    await env.DB.prepare(`UPDATE renders SET state='failed', error=? WHERE id=?`).bind(message, renderId).run();
    /*
     * A failed export still burned the container time it burned.
     *
     * Only the success path metered, so an encode that died at 90% — after
     * twenty minutes on four vCPUs — cost nothing in the ledger and real money
     * on the invoice. The expensive failures were the invisible ones, which is
     * the wrong way round. The proxy job already meters its failures and says
     * why (src/queue.ts); this is the same rule.
     */
    await meter(env.DB, {
      user_id: opts.userId,
      job_id: jobId,
      job_type: "render",
      cpu_ms: Date.now() - t0,
      outcome: "failed",
    }).catch(() => {
      /* Bookkeeping must never stop the failure being reported. */
    });
  };

  try {
    const project = await getProject(env.DB, opts.projectId, opts.userId);
    if (!project) return void (await fail("That project isn't there any more."));

    const render = await env.DB.prepare(`SELECT * FROM renders WHERE id=?`).bind(renderId).first<RenderRow>();
    if (!render) return void (await fail("That render isn't there any more."));

    /*
     * Before anything is built, because this is a refusal rather than a
     * failure: nothing has been spent yet and the fix is one press in the
     * editor. doc 09: "a variant that would split them does not render".
     */
    const broken = await envelopeBreaks(env, opts.projectId);
    if (broken.length) return void (await fail(broken[0].line));

    await startJob(env.DB, jobId, "putting it together");
    await env.DB.prepare(`UPDATE renders SET state='running' WHERE id=?`).bind(renderId).run();

    const built = await edlForProject(env, project, opts.userId);
    if (!built || !built.edl.cuts.length) {
      return void (await fail("There's nothing kept to render yet."));
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
    const plan = buildRenderPlan(built.edl, render.format, render.aspect, render.caption_style, Boolean(render.enhance));
    const sign = async (key: string) =>
      (await presignGet(env, key, 7200)) ??
      (env.MEDIA_PUBLIC_BASE ? `${env.MEDIA_PUBLIC_BASE}/media/${key}` : null);

    const urls = await Promise.all(plan.cuts.map((c) => sign(c.key)));
    /* And the voice over it, where there is one. B-roll with narration: the
       container mixes it over the picture with the picture's own audio ducked
       underneath, which it has been able to do since that branch was written
       and had never been given one to do it with. */
    const voiceUrls = await Promise.all(plan.cuts.map((c) => (c.voiceKey ? sign(c.voiceKey) : null)));

    if (urls.some((u) => !u)) {
      return void (await fail("Couldn't give the encoder a way to read your footage."));
    }
    if (plan.cuts.some((c, i) => c.voiceKey && !voiceUrls[i])) {
      return void (await fail("Couldn't give the encoder a way to read your recording."));
    }
    const withUrls = {
      ...plan,
      cuts: plan.cuts.map((c, i) => ({
        ...c,
        url: urls[i] as string,
        ...(voiceUrls[i] ? { voiceUrl: voiceUrls[i] as string } : {}),
      })),
    };

    /* The output length is known from the plan, so it is recorded before the
       encode rather than after — that is what turns a measured rate into an
       estimate for THIS render while it is still running. */
    await env.DB
      .prepare(`UPDATE renders SET duration_s=? WHERE id=?`)
      .bind(Math.max(1, Math.round(plan.durationS)), opts.renderId)
      .run();

    /* One conversation with the encoder, for both kinds of render — see
       src/encode.ts. Keyed by the RENDER id rather than the project: two
       exports of one edit used to share an instance, and the second sat
       behind the first. "one at 30% the others just i guess queued". */
    const encoder = encoderFor(env, `render-${renderId}`);
    if (!encoder) {
      // Honest rather than cryptic: the encoder genuinely is not available.
      return void (await fail("Rendering isn't available yet — the encoder isn't running."));
    }

    await advance(env.DB, jobId, 30, "putting it together");

    /*
     * REAL PROGRESS, from the encoder's own count of finished parts.
     *
     * 30 to 78 is the encode, 80 onwards is saving it. What the user watches
     * between those two numbers is measured work now, rather than a bar that
     * stopped moving because there was nothing behind it.
     */
    const res = await encode(encoder, withUrls, {
      deadlineMs: 25 * 60 * 1000,
      /* Stop writes 'failed' onto the job from another request; this is where
         a render in flight finds out. */
      cancelled: async () => {
        const row = await env.DB.prepare(`SELECT state FROM jobs WHERE id=?`).bind(jobId).first<{ state: string }>();
        return !row || row.state === "failed";
      },
      onProgress: (st) =>
        advance(
          env.DB,
          jobId,
          30 + Math.round((st.pct / 100) * 48),
          st.total > 1 && st.done > 0 ? `${st.stage} — ${st.done} of ${st.total}` : st.stage,
        ),
    });

    await advance(env.DB, jobId, 80, "saving it");

    /*
     * Into R2, streamed and with a length R2 will accept.
     *
     * This handed `res.body` straight to put, and R2 refuses a stream of
     * unknown length. The encode had already SUCCEEDED — fifty-four seconds
     * of work, the file made — and the export reported "Couldn't put it
     * together" at the last line. src/r2stream.ts is now the one place that
     * knows how to do this.
     */
    const key = `u/${opts.userId}/renders/${renderId}.mp4`;
    const size = await putFromResponse(env.MEDIA, key, res, { contentType: "video/mp4" });
    const measuredS = Math.round(Number(res.headers.get("x-duration-s")) || 0);

    /*
     * SUBTITLES ALONGSIDE THE RENDER, in output time (Phase 3) — unless the
     * captions are already burned into the picture.
     *
     * Doc 09: "a subtitle file alongside; no stacking on burned-in
     * subtitles". A viewer who leaves subtitles on by default gets the
     * player's copy drawn over the one in the frame, and the overlap is
     * unreadable in a way neither alone would be. The burned-in case is also
     * the one doc 09 exempts for shorts, "because muted viewing is a
     * different medium".
     */
    const srt = sidecarWanted(render.caption_style) ? buildSrt(built.edl) : "";
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
    /* EncodeError already reads as a sentence a person can act on — encode.ts
       writes them that way — so it is not wrapped in another one. */
    /* Stopped is not broken: the rows already say "You stopped this." and
       overwriting that with an encoder error would lose the true reason. */
    if (err instanceof Cancelled) return;
    if (err instanceof EncodeError) return void (await fail(err.message));
    const timedOut = err instanceof Error && /timeout|abort/i.test(err.name + err.message);
    await fail(
      timedOut
        ? "The encoder didn't finish in time. It may be busy — try the export again."
        : `Couldn't put it together: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
