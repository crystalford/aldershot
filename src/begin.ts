/**
 * Begin — what happens when the user types a sentence and presses the button.
 *
 * Home's whole job is to turn one sentence into the right kind of work
 * (01-PRODUCT.md §Home). The sentence is read for intent, a project is created
 * if that intent produces one, and the score pass runs against the source's
 * transcript using the sentence as the brief.
 */

import type { Env } from "./env.ts";
import { INTENT_KIND, readIntent, type Intent } from "./intent.ts";
import { advance, createJob, failJob, finishJob, startJob } from "./jobs.ts";
import { createProject, putBeats, saveClips, titleFromBrief } from "./projects.ts";
import { scorePass } from "./score.ts";
import { getSegments, getSource } from "./sources.ts";
import { meter } from "./usage.ts";
import { ulid } from "./id.ts";

export interface BeginResult {
  intent: Intent;
  projectId: string | null;
  jobId: string;
  /** Where the user should land, per 01-PRODUCT.md's intent table. */
  href: string;
}

/**
 * Kicks off the work. Returns as soon as there is something to navigate to;
 * the pass itself runs after the response so the user watches real progress
 * rather than a held-open request.
 */
export async function begin(
  env: Env,
  opts: { userId: string; sourceId: string; brief: string; upgrade?: boolean },
): Promise<BeginResult> {
  const read = readIntent(opts.brief);
  // "unclear" is only ever a UI state — by the time we are here the user has
  // answered the follow-up, so treat anything still unclear as a cut.
  const intent: Intent = read === "unclear" ? "compose" : read;
  const kind = INTENT_KIND[intent];

  const project = kind
    ? await createProject(env.DB, {
        user_id: opts.userId,
        title: titleFromBrief(opts.brief, "Untitled cut"),
        kind,
        source_id: opts.sourceId,
        brief: opts.brief,
      })
    : null;

  const job = await createJob(env.DB, {
    user_id: opts.userId,
    type: "score",
    ref_id: project?.id ?? opts.sourceId,
  });

  return {
    intent,
    projectId: project?.id ?? null,
    jobId: job.id,
    // extract and shorts produce no project: the clips land in Footage, and
    // there is nothing to assemble.
    href: project ? `/p/${project.id}/pick` : intent === "shorts" ? "/clipping" : "/footage?tab=moments",
  };
}

/** The score pass itself. Runs after the response; reports real progress. */
export async function runScore(
  env: Env,
  opts: { userId: string; sourceId: string; projectId: string | null; brief: string; jobId: string; upgrade?: boolean },
): Promise<void> {
  const { jobId } = opts;
  try {
    const src = await getSource(env.DB, opts.sourceId, opts.userId);
    if (!src) return void (await failJob(env.DB, jobId, "That video isn't there any more."));

    const segments = await getSegments(env.DB, opts.sourceId);
    if (!segments.length) {
      return void (await failJob(env.DB, jobId, "That video hasn't been read yet — give it a minute and try again."));
    }

    await startJob(env.DB, jobId, "reading it for meaning");

    const result = await scorePass(env, segments, opts.brief, { upgrade: opts.upgrade });

    await advance(env.DB, jobId, 70, "picking out the moments");
    const clips = await saveClips(
      env.DB,
      { user_id: opts.userId, source_id: opts.sourceId, origin: "editor", posterKey: src.poster_r2_key },
      result.clips,
    );

    // The pass log records what was asked and what came back, in a sentence a
    // person can read. A pass that found nothing says so — it never silently
    // succeeds (04-API-AND-JOBS.md §3).
    await env.DB
      .prepare(
        `INSERT INTO passes (id,project_id,source_id,n,instruction,result,model,tokens_in,tokens_out,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        ulid(),
        opts.projectId,
        opts.sourceId,
        1,
        opts.brief,
        clips.length
          ? `${clips.length} moment${clips.length === 1 ? "" : "s"} found`
          : "no matches — try different words",
        result.model,
        result.tokensIn,
        result.tokensOut,
        Date.now(),
      )
      .run();

    // A cut starts as the clips it found, in transcript order, all present so
    // the user can see the whole hour and take things out. Nothing is dropped
    // on their behalf.
    if (opts.projectId && clips.length) {
      await putBeats(
        env.DB,
        opts.projectId,
        clips.map((c) => ({
          idx: 0,
          kind: "clip" as const,
          act: null,
          clip_id: c.id,
          text: c.quote,
          struck: null,
          dur_ms: c.end_ms - c.start_ms,
          media_r2_key: null,
          recorded_at: null,
        })),
      );
    }

    await meter(env.DB, {
      user_id: opts.userId,
      job_id: jobId,
      job_type: "score",
      tokens_in: result.tokensIn,
      tokens_out: result.tokensOut,
    });

    await finishJob(env.DB, jobId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failJob(env.DB, jobId, `Couldn't work out what to keep: ${message}`);
  }
}
