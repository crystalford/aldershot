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
import { createProject, getProject, putBeats, saveClips, saveCuts, titleFromBrief, TOUCHED } from "./projects.ts";
import { asked, scorePass } from "./score.ts";
import { applyMoments, parseCuts, serialiseCuts } from "./cuts.ts";
import { getSegments, getSource } from "./sources.ts";
import { meter } from "./usage.ts";
import { recordPass } from "./passes.ts";

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
    /*
     * UNTOUCHED ONLY.
     *
     * This reused any edit without a brief, which sounds like "one you have
     * not asked anything of" and is not: an edit you spent an hour cutting by
     * hand has no brief either. So opening your own footage handed back the
     * cut you made last time, and starting a fresh one from that video meant
     * undoing your own work first. "if i wanted to start a new edit with the
     * footage i'd have to essentially undo what i did before."
     *
     * TOUCHED is the product's existing answer to "is this edit yours yet" —
     * a brief, a cut, a beat, a render, or a name you typed — and Projects has
     * used it all along to decide what to list. Reuse now asks the same
     * question, so an untouched row is still picked up (no pile-up of empty
     * edits from clicking around) and a real one never is.
     */
    const existing = await env.DB
      .prepare(
        `SELECT * FROM v2_projects
          WHERE user_id=? AND source_id=? AND kind=?
            AND (brief IS NULL OR TRIM(brief)='')
            AND NOT ${TOUCHED}
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
      return void (await failJob(env.DB, jobId, "That video hasn't been transcribed yet — give it a minute and try again."));
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

    /*
     * NOW DO IT.
     *
     * A pass used to score some moments, draw badges on them, and leave the
     * cut exactly as long as it was — press "Find the strong bits" and the
     * 2:50 edit is still 2:50. "that's the whole point is like one click sort
     * of does it right .. otherwise i have no idea what the fuck it is doing."
     *
     * So the moments become the cut. The model says which way round the
     * instruction meant it: keep these and lose the rest, or cut these and
     * keep the rest.
     *
     * Nothing is destroyed. These are line cuts on the project, the same ones
     * striking a line by hand writes, and the previous state is handed back to
     * the editor so one ⌘Z puts the whole pass back.
     */
    let struck = 0;
    if (opts.projectId && result.clips.length) {
      const project = await getProject(env.DB, opts.projectId, opts.userId);
      if (project) {
        const existing = parseCuts(project.cuts);
        /* Word-level work elsewhere in the transcript is somebody's deliberate
           edit and is not touched — only whole lines are decided here. */
        const kept = existing.filter((c) => c.words !== null || c.tighten);
        const fresh = applyMoments(segments, result.clips, result.action);
        struck = fresh.length;
        await saveCuts(env.DB, project.id, opts.userId, serialiseCuts([...kept, ...fresh]));
      }
    }

    // The pass log records what was asked and what came back, in a sentence a
    // person can read. A pass that found nothing says so — it never silently
    // succeeds (04-API-AND-JOBS.md §3). The number was hardcoded to 1, so an
    // edit you had asked four things of showed four rows all called 1.
    await recordPass(env.DB, {
      projectId: opts.projectId,
      sourceId: opts.sourceId,
      /* What was really asked. An edit begun with "Skip the brief" sends the
         model a fallback, and the log has to say that rather than blank. */
      instruction: asked(opts.brief),
      /*
       * WHAT THE MODEL FOUND, not what the library kept.
       *
       * saveClips drops a moment that overlaps one already held, so running a
       * pass twice over the same video returned an empty list and this said
       * "no matches — try different words" about moments it had just found and
       * already had. Deduplication is about the clip LIBRARY; it has no
       * business deciding what a pass reports, or what it does to the cut.
       */
      result: result.clips.length
        ? `${result.clips.length} moment${result.clips.length === 1 ? "" : "s"} found` +
          (struck ? ` · ${struck} line${struck === 1 ? "" : "s"} cut` : "")
        : "no matches — try different words",
      model: result.model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
    });

    // A cut starts as the clips it found, in transcript order, all present so
    // the user can see the whole hour and take things out. Nothing is dropped
    // on their behalf.
    if (opts.projectId && clips.length) {
      /* Beats are seeded from the clips actually SAVED, because a beat points
         at a clip row by id — a moment already in the library is already a
         block in the transcript and does not need a second one. */
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
