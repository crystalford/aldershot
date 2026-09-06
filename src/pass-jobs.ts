/**
 * The two passes that had no home: placing reactions, and drafting an essay's
 * acts.
 *
 * Both lived as inline closures inside their routes. That was fine while
 * everything ran in `waitUntil`, and impossible once work had to survive as a
 * queue message — a closure cannot be serialised. Extracting them also means
 * they are now the same shape as runScore, runShorts and runRender, which is
 * what lets src/queue.ts treat every job type identically.
 *
 * Each takes ids and re-reads its own rows, so a message that waited in the
 * queue acts on the project as it is now, not as it was when the button was
 * pressed.
 */

import type { Env } from "./env.ts";
import { ulid } from "./id.ts";
import { failJob, finishJob, startJob } from "./jobs.ts";
import { getProject, listClipsForSource, putBeats, saveClips } from "./projects.ts";
import { getSegments, getSource } from "./sources.ts";
import { listMoments } from "./library.ts";
import { placeReactions } from "./reactions.ts";
import { draftOutline, type EssayBeat } from "./essay.ts";
import { meter } from "./usage.ts";

export interface ReactionsJob {
  jobId: string;
  userId: string;
  projectId: string;
  about: string;
}

/**
 * Breaks the source into the moments worth responding to and leaves a
 * recording slot after each one — clip, react, clip, react.
 */
export async function runReactions(env: Env, msg: ReactionsJob): Promise<void> {
  try {
    await startJob(env.DB, msg.jobId, "placing the reactions");

    const project = await getProject(env.DB, msg.projectId, msg.userId);
    if (!project?.source_id) {
      return void (await failJob(env.DB, msg.jobId, "That project is no longer here."));
    }

    const segments = await getSegments(env.DB, project.source_id);
    const result = await placeReactions(env, segments, msg.about);

    const src = await getSource(env.DB, project.source_id, msg.userId);
    const clipBeats = result.beats.filter((x) => x.kind === "clip");
    const saved = await saveClips(
      env.DB,
      { user_id: msg.userId, source_id: project.source_id, origin: "editor", posterKey: src?.poster_r2_key ?? null },
      clipBeats.map((x) => ({
        start_ms: x.start_ms!,
        end_ms: x.end_ms!,
        quote: x.quote ?? "",
        why: x.why ?? "",
        score: 0,
        heat: 0,
      })),
    );

    // Interleave: each clip, then the line drafted to say after it.
    const existing = await listClipsForSource(env.DB, project.source_id, msg.userId);
    const beats: Parameters<typeof putBeats>[2] = [];
    for (const rb of result.beats) {
      if (rb.kind === "clip") {
        const match =
          saved.find((cl) => cl.start_ms === rb.start_ms) ??
          existing.find((cl) => cl.start_ms === rb.start_ms);
        beats.push({
          kind: "clip",
          act: null,
          clip_id: match?.id ?? null,
          text: rb.quote ?? null,
          struck: null,
          dur_ms: (rb.end_ms ?? 0) - (rb.start_ms ?? 0),
          media_r2_key: null,
          recorded_at: null,
        });
      } else {
        beats.push({
          kind: "react",
          act: null,
          clip_id: null,
          text: rb.say ?? null,
          struck: null,
          dur_ms: null,
          media_r2_key: null,
          recorded_at: null,
        });
      }
    }

    await putBeats(env.DB, project.id, beats);
    await meter(env.DB, {
      user_id: msg.userId,
      job_id: msg.jobId,
      job_type: "pass",
      tokens_in: result.tokensIn,
      tokens_out: result.tokensOut,
    });
    await finishJob(env.DB, msg.jobId);
  } catch (err) {
    await failJob(
      env.DB,
      msg.jobId,
      `Couldn't place the reactions: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export interface OutlineJob {
  jobId: string;
  userId: string;
  projectId: string;
  topic: string;
}

/**
 * Drafts an essay's acts from the library.
 *
 * Unlike every other pass this one has no source video — it builds from what
 * the user has already kept, and a beat the model could not back with a real
 * clip is reported rather than quietly dropped.
 */
export async function runOutline(env: Env, msg: OutlineJob): Promise<void> {
  try {
    await startJob(env.DB, msg.jobId, "drafting the acts");

    const project = await getProject(env.DB, msg.projectId, msg.userId);
    if (!project) return void (await failJob(env.DB, msg.jobId, "That project is no longer here."));

    const moments = await listMoments(env.DB, msg.userId, 120);
    if (!moments.length) {
      return void (await failJob(
        env.DB,
        msg.jobId,
        "Nothing kept yet — an essay is built from clips you've saved.",
      ));
    }

    const outline = await draftOutline(
      env,
      msg.topic,
      moments.map((m) => ({ id: m.id, quote: m.quote, source_title: m.source_title })),
    );

    /*
     * A clip beat's length is the clip's length — it is known here and must be
     * written, because Build's timecodes, its runtime label and the width of
     * every segment in the preview scrubber all read from dur_ms. Left null,
     * the whole surface renders "0:00" and the scrubber shows equal-width
     * blocks that mean nothing.
     */
    const byId = new Map(moments.map((m) => [m.id, m]));
    await putBeats(
      env.DB,
      project.id,
      outline.beats.map((be: EssayBeat) => {
        const clip = be.clip_id ? byId.get(be.clip_id) : undefined;
        return {
          kind: be.kind,
          act: be.act,
          clip_id: be.clip_id ?? null,
          text: be.text,
          struck: null,
          dur_ms: clip ? clip.end_ms - clip.start_ms : null,
          media_r2_key: null,
          recorded_at: null,
        };
      }),
    );
    await env.DB.prepare(`UPDATE v2_projects SET has_acts=1, updated_at=? WHERE id=?`)
      .bind(Date.now(), project.id)
      .run();

    // The pass log says honestly how much of the argument is actually backed —
    // including the beats the model wanted to cite and could not.
    const backed = outline.beats.filter((be) => be.kind === "clip").length;
    await env.DB
      .prepare(
        `INSERT INTO passes (id,project_id,source_id,n,instruction,result,model,tokens_in,tokens_out,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        ulid(),
        project.id,
        null,
        1,
        msg.topic,
        `${outline.beats.length} beats — ${backed} backed by a clip` +
          (outline.rejected ? `, ${outline.rejected} needing footage it doesn't have` : ""),
        outline.model,
        outline.tokensIn,
        outline.tokensOut,
        Date.now(),
      )
      .run();

    await meter(env.DB, {
      user_id: msg.userId,
      job_id: msg.jobId,
      job_type: "pass",
      tokens_in: outline.tokensIn,
      tokens_out: outline.tokensOut,
    });
    await finishJob(env.DB, msg.jobId);
  } catch (err) {
    await failJob(
      env.DB,
      msg.jobId,
      `Couldn't draft the acts: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
