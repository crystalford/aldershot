/**
 * Ingest — upload → read. The whole of Phase 1's claim.
 *
 * Sequenced per 04-API-AND-JOBS.md: nothing blocks on the LLM, every long step
 * is a job with real staged progress, and every consumer meters what it burned.
 *
 * The cap is checked BEFORE any work starts. Refusing after spending the money
 * is worse than not having a cap.
 */

import type { Env } from "./env";
import { advance, createJob, failJob, finishJob, startJob } from "./jobs";
import { meter } from "./usage";
import { checkCap, type Plan } from "./plans";
import { DIRECT_TRANSCRIBE_MAX_BYTES, transcribe } from "./transcribe";
import { saveSegments, setTranscriptState, type Source } from "./sources";

export interface IngestOpts {
  plan: Plan;
  /** Opt-in diarization upgrade. */
  diarize?: boolean;
  /** Duration in seconds if already known (from the client's probe). */
  knownDurationS?: number;
  /**
   * An already-created job to report against. The route creates it up front so
   * it can return the id immediately and let the client start polling; without
   * this the job would not exist until the work was already underway.
   */
  jobId?: string;
}

/**
 * Reads a source: transcribe, persist segments, meter.
 *
 * Deliberately NOT doing probe/frames here — those need ffmpeg in a container
 * and are sequenced separately, so that a source becomes READABLE (the thing
 * the product is about) without waiting on thumbnails.
 */
export async function readSource(env: Env, src: Source, opts: IngestOpts): Promise<{ jobId: string }> {
  const job = opts.jobId
    ? { id: opts.jobId }
    : await createJob(env.DB, { user_id: src.user_id, type: "transcribe", ref_id: src.id });

  const object = await env.MEDIA.get(src.r2_key);
  if (!object) {
    await failJob(env.DB, job.id, "The upload didn't finish. Try adding the video again.");
    await setTranscriptState(env.DB, src.id, "failed");
    return { jobId: job.id };
  }

  const bytes = await object.arrayBuffer();

  // The cap is in source minutes, so we need a duration before spending. If
  // the client measured one, trust it; otherwise estimate from bitrate, and
  // reconcile against the real duration the transcript reports afterwards.
  const estimatedMinutes = opts.knownDurationS
    ? opts.knownDurationS / 60
    : estimateMinutesFromBytes(bytes.byteLength);

  const cap = await checkCap(env.DB, src.user_id, opts.plan, estimatedMinutes);
  if (!cap.ok) {
    await failJob(env.DB, job.id, cap.message!);
    await setTranscriptState(env.DB, src.id, "failed");
    return { jobId: job.id };
  }

  if (bytes.byteLength > DIRECT_TRANSCRIBE_MAX_BYTES) {
    // Audio extraction lives in the ffmpeg container. Until that path is
    // wired (it cannot be exercised without a container runtime), say so
    // plainly rather than failing with something cryptic.
    await failJob(
      env.DB,
      job.id,
      "That file is too large to read yet — audio extraction isn't wired up. Try a shorter video for now.",
    );
    await setTranscriptState(env.DB, src.id, "failed");
    return { jobId: job.id };
  }

  await startJob(env.DB, job.id, "reading it");
  await setTranscriptState(env.DB, src.id, "running");

  try {
    // One call, no chunking — see docs/decisions/transcription.md.
    const result = await transcribe(env, bytes, { diarize: opts.diarize });

    await advance(env.DB, job.id, 80, "writing down what it heard");
    const count = await saveSegments(env.DB, src.id, result.segments);

    await env.DB
      .prepare(`UPDATE sources SET duration_s=?, transcript_state='ready' WHERE id=?`)
      .bind(Math.round(result.duration), src.id)
      .run();

    // Meter with what was ACTUALLY billed — the response reports its own
    // neuron count, so this is not an estimate.
    await meter(env.DB, {
      user_id: src.user_id,
      job_id: job.id,
      job_type: "transcribe",
      source_minutes: result.duration / 60,
      bytes_stored: bytes.byteLength,
      diarized: result.diarized,
    });

    await finishJob(env.DB, job.id);
    return { jobId: job.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // The retry must keep the user's brief — never make them retype
    // (04-API-AND-JOBS.md §Failure rules).
    await failJob(env.DB, job.id, `Couldn't read that video: ${message}`);
    await setTranscriptState(env.DB, src.id, "failed");
    return { jobId: job.id };
  }
}

/**
 * A duration estimate from file size, used only to check the cap before we
 * know the real length. Deliberately CONSERVATIVE (assumes a low bitrate, so
 * it over-estimates minutes) — erring toward refusing a borderline job is
 * better than erring toward spending money we then can't bill for.
 */
export function estimateMinutesFromBytes(bytes: number): number {
  const ASSUMED_BYTES_PER_MINUTE = 1.5 * 1024 * 1024;
  return bytes / ASSUMED_BYTES_PER_MINUTE;
}
