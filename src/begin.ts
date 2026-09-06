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
import { dispatch, type JobMessage } from "./queue.ts";
import { advance, createJob, failJob, finishJob, startJob } from "./jobs.ts";
import { createProject, putBeats, saveClips, titleFromBrief } from "./projects.ts";
import { scorePass } from "./score.ts";
import { getSegments, getSource } from "./sources.ts";
import { meter } from "./usage.ts";
import { ulid } from "./id.ts";

export interface BeginResult {
  intent: Intent;
  projectId: string | null;
  /** Null when the edit already exists and needs no fresh pass. */
  jobId: string | null;
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
  opts: {
    userId: string;
    sourceId: string;
    brief: string;
    upgrade?: boolean;
    sourceTitle?: string | null;
    /** The name worked out from the transcript. See src/naming.ts. */
    cutTitle?: string | null;
    /** Force a new edit rather than reopening the existing unbriefed one. */
    fresh?: boolean;
  },
  ctx: { waitUntil(p: Promise<unknown>): void },
): Promise<BeginResult> {
  const read = readIntent(opts.brief);
  // "unclear" is only ever a UI state — by the time we are here the user has
  // answered the follow-up, so treat anything still unclear as a cut.
  const intent: Intent = read === "unclear" ? "compose" : read;
  const kind = INTENT_KIND[intent];

  /*
   * Reopen rather than duplicate.
   *
   * This always created a new project, so every press of Edit on a source made
   * another "Untitled cut" and started another scoring pass over the same
   * video — four clicks, four identical edits, four passes paid for. That is
   * not what "open this video" means.
   *
   * An empty brief IS "open this video": reuse the existing edit of the same
   * kind if there is one. A brief that says something is a new request and
   * gets its own project, because the user is asking for a different thing
   * from the same footage.
   */
  /* `fresh` is the "New edit" button on a source: a second unassisted cut of
     the same footage, deliberately asked for. Without it there is no way to
     have two, because an unbriefed open always returns the existing one. */
  const wantsSomethingNew = opts.brief.trim().length > 0 || opts.fresh === true;

  let project = null;
  let reused = false;
  if (kind && !wantsSomethingNew) {
    /*
     * Reuse only an edit that was ALSO opened without a brief.
     *
     * Matching on kind alone handed "open this video" back whichever cut
     * happened to be newest — including one made from a brief, so opening
     * your own footage dropped you into a scored edit somebody had asked
     * for earlier, complete with a model's opinion of what mattered. An
     * unassisted open and a briefed request are different pieces of work
     * and must not collapse into each other.
     */
    const existing = await env.DB
      .prepare(
        `SELECT * FROM v2_projects
          WHERE user_id=? AND source_id=? AND kind=?
            AND (brief IS NULL OR TRIM(brief)='')
            AND deleted_at IS NULL AND archived_at IS NULL
          ORDER BY updated_at DESC LIMIT 1`,
      )
      .bind(opts.userId, opts.sourceId, kind)
      .first<{ id: string }>();
    if (existing) {
      project = existing as never;
      reused = true;
    }
  }

  if (kind && !project) {
    project = await createProject(env.DB, {
      user_id: opts.userId,
      /*
       * Three names, in order of how much they actually tell you.
       *
       * A brief wins: if the user said what they wanted, that sentence is what
       * they will recognise the piece by. Otherwise the name worked out from
       * the transcript when the footage was read (src/naming.ts) — what the
       * piece is ABOUT. The filename is last, and only because a source read
       * before this existed has no stored name yet.
       *
       * The filename used to be second, which is what put
       * "DJI_20260905043337_0026_D" at the top of the editor.
       */
      title: titleFromBrief(
        opts.brief,
        opts.cutTitle?.trim() || opts.sourceTitle?.trim() || "Untitled cut",
      ),
      kind,
      source_id: opts.sourceId,
      brief: opts.brief,
    });
  }

  /*
   * NO BRIEF MEANS NO MODEL.
   *
   * "I uploaded a video, I should be able to edit it" — pressing Edit used to
   * run a scoring pass that decided what mattered before the owner had seen
   * their own footage, which is not editing, it is being handed someone else's
   * opinion. The design already draws this line: "Skip the brief — edit it
   * yourself" beside "Start cutting →".
   *
   * So an empty brief opens the transcript with everything kept and you cut it
   * down by reading. A brief is what asks for help, and only then does a pass
   * run. It is also the difference between an edit that costs nothing and one
   * that costs minutes and money.
   */
  const already = reused
    ? await env.DB
        .prepare(`SELECT COUNT(*) n FROM v2_clips WHERE source_id=? AND deleted_at IS NULL`)
        .bind(opts.sourceId)
        .first<{ n: number }>()
    : null;
  const skipScore = !wantsSomethingNew || (already?.n ?? 0) > 0;

  /*
   * DO WHAT THE SENTENCE SAID.
   *
   * intentLabel tells the user, in the prototype's own words, "Reads as an
   * essay — five acts, built out of footage you've already kept" or "Reads as
   * a reaction — a project with room between the blocks for your voice". This
   * function then created a `score` job and nothing else, for every intent —
   * so the product announced what it understood and then ran a generic
   * scoring pass regardless. essay.ts, reactions.ts, their queue handlers and
   * their routes were all written and unreachable.
   *
   * The dispatch lives here rather than in the route because there were two
   * callers, only one dispatched anything, and the one that did hardcoded
   * "score" — so /sources/:id/edit could create a job that nothing ever ran.
   * One place decides the intent, the job type and the message together.
   */
  const work: JobMessage | null =
    skipScore || !project
      ? intent === "shorts" && !skipScore
        ? { type: "shorts", jobId: "", userId: opts.userId, sourceId: opts.sourceId, length: "30-60", count: 8, query: "" }
        : null
      : intent === "react"
        ? { type: "reactions", jobId: "", userId: opts.userId, projectId: project.id, about: opts.brief }
        : intent === "essay"
          ? { type: "outline", jobId: "", userId: opts.userId, projectId: project.id, topic: opts.brief }
          : {
              type: "score",
              jobId: "",
              userId: opts.userId,
              sourceId: opts.sourceId,
              projectId: project.id,
              brief: opts.brief,
              upgrade: opts.upgrade,
            };

  const job = work
    ? await createJob(env.DB, {
        user_id: opts.userId,
        /* A reaction and an outline are both "a pass over the transcript" to
           the metering and the job list; only a shorts run is its own type. */
        type: work.type === "shorts" ? "shorts" : work.type === "score" ? "score" : "pass",
        ref_id: project?.id ?? opts.sourceId,
      })
    : null;

  if (job && work) await dispatch(env, ctx, { ...work, jobId: job.id } as JobMessage);

  return {
    intent,
    projectId: project?.id ?? null,
    jobId: job?.id ?? null,
    // extract and shorts produce no project: the clips land in Footage, and
    // there is nothing to assemble.
    href: project ? `/p/${project.id}/cut` : intent === "shorts" ? "/clipping" : "/footage?tab=moments",
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

    /*
     * Real progress, from real work.
     *
     * The pass used to be one opaque call: the job sat at 0% for its whole
     * life and the editor showed a label that never changed. scorePass reads
     * the transcript in windows now, so this fraction is windows finished —
     * measured, never a timer. 85% is where the model's part ends; what
     * follows is saving, which is fast and has its own steps.
     */
    const result = await scorePass(env, segments, opts.brief, {
      upgrade: opts.upgrade,
      onProgress: (fraction, done, total) => {
        void advance(
          env.DB,
          jobId,
          Math.round(fraction * 85),
          total > 1 ? `reading it for meaning — part ${done} of ${total}` : "reading it for meaning",
        );
      },
    });

    await advance(env.DB, jobId, 90, "picking out the moments");
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
