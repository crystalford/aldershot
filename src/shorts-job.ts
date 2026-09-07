/**
 * Running a Clipping batch.
 *
 * Same shape as the score pass: the model finds moments, the quotes are
 * rebuilt from our transcript, the clips land in the library, and the job
 * reports real stages. What differs is that Clipping is "built for reposting,
 * not for the Archive" — these are shorts, so they carry origin='clipping'
 * and stay separate from what the editor kept.
 */

import type { Env } from "./env.ts";
import { advance, failJob, finishJob, startJob } from "./jobs.ts";
import { saveClips } from "./projects.ts";
import { findShorts, searchTranscript, type ClipLength } from "./shorts.ts";
import { getSegments, getSource } from "./sources.ts";
import { meter } from "./usage.ts";

export interface ShortsOpts {
  userId: string;
  sourceId: string;
  jobId: string;
  length?: ClipLength;
  count?: number;
  /** When set, this is a search for a specific moment rather than a scoring run. */
  query?: string;
}

export async function runShorts(env: Env, opts: ShortsOpts): Promise<void> {
  const { jobId } = opts;
  try {
    const src = await getSource(env.DB, opts.sourceId, opts.userId);
    if (!src) return void (await failJob(env.DB, jobId, "That video isn't there any more."));

    const segments = await getSegments(env.DB, opts.sourceId);
    if (!segments.length) {
      return void (await failJob(env.DB, jobId, "That video hasn't been read yet — give it a minute and try again."));
    }

    await startJob(env.DB, jobId, opts.query ? "looking for it" : "finding clips");

    // A search is not a scoring run: the user already knows what they want, so
    // matching the transcript is faster, free, and cannot invent a moment.
    const found = opts.query
      ? { clips: searchTranscript(segments, opts.query), tokensIn: 0, tokensOut: 0, model: "" }
      : await findShorts(env, segments, {
          length: opts.length,
          count: opts.count,
          /* Windows finished — measured work, never a timer. Clipping's bar
             sat at zero for the whole slow part until this. */
          onProgress: (fraction, done, total) => {
            void advance(
              env.DB,
              jobId,
              Math.round(fraction * 85),
              total > 1 ? `finding clips — part ${done} of ${total}` : "finding clips",
            );
          },
        });

    await advance(env.DB, jobId, 90, "picking out the moments");

    await saveClips(
      env.DB,
      { user_id: opts.userId, source_id: opts.sourceId, origin: "clipping", posterKey: src.poster_r2_key },
      found.clips,
    );

    if (found.tokensIn) {
      await meter(env.DB, {
        user_id: opts.userId,
        job_id: jobId,
        job_type: "shorts",
        tokens_in: found.tokensIn,
        tokens_out: found.tokensOut,
      });
    }

    await finishJob(env.DB, jobId);
  } catch (err) {
    await failJob(env.DB, jobId, `Couldn't find clips: ${err instanceof Error ? err.message : String(err)}`);
  }
}
