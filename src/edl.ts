/**
 * The edit decision list — what the render is actually made of.
 *
 * "The edit is data, never a file. Beats + struck words are the edit. Render is
 * a pure function of them, so it can always be re-run" (04-API-AND-JOBS.md).
 * This module IS that function's front half: it turns beats, clips and
 * transcript cuts into an ordered list of source ranges plus the captions that
 * go over them. ffmpeg does the rest.
 *
 * Everything here is pure, so the thing that decides what ends up in a user's
 * export is testable without a container, an encoder, or a video file.
 */

import { playableRanges, type Cut, type Segmentish } from "./cuts.ts";

export interface EdlCut {
  /** R2 key of the source to cut from. */
  sourceKey: string;
  start_ms: number;
  end_ms: number;
  /** What is said over this range, for captions and the SRT. */
  text: string;
  /**
   * This cut has SOUND BUT NO PICTURE — a voiceover the user recorded.
   *
   * It has to be flagged, because the renderer treats every cut as video: it
   * runs a scale filter and an h264 encode over it, and a .webm of somebody
   * talking has no video stream to filter. ffmpeg fails, and the whole export
   * fails with it — so an edit containing any recorded voiceover could not be
   * exported at all, which is the one thing Build exists to produce.
   */
  audioOnly?: boolean;
}

export interface Edl {
  cuts: EdlCut[];
  /** Total runtime of the finished piece, in milliseconds. */
  durationMs: number;
}

export interface BeatInput {
  kind: "clip" | "vo" | "react" | "generated" | "stock";
  /** For kind=clip: the range in the source. */
  start_ms?: number;
  end_ms?: number;
  text?: string | null;
  /** Recorded voice or generated visual, when the beat carries its own media. */
  media_r2_key?: string | null;
}

/**
 * Builds the EDL for a project.
 *
 * Two things combine, and the order matters: the beats decide WHICH stretches
 * are in and in what order, and the transcript cuts then remove struck words
 * from within them. A word struck in Script must not survive because Pick
 * happened to keep the block it was in.
 */
export function buildEdl(
  sourceKey: string,
  beats: BeatInput[],
  segments: Segmentish[],
  cuts: Cut[],
): Edl {
  // What survives the transcript cuts, as absolute source ranges.
  const surviving = playableRanges(segments, cuts);
  const out: EdlCut[] = [];

  for (const beat of beats) {
    if (beat.kind !== "clip") {
      // vo/react/generated/stock carry their own media rather than a range of
      // the source. They are passed through so the renderer can place them,
      // and are deliberately NOT affected by transcript cuts — striking a word
      // in the source transcript should not silently shorten a voiceover.
      if (beat.media_r2_key) {
        /* vo and react are recordings of a voice: audio, no picture.
           `generated` and `stock` are visuals and carry their own video. */
        const audioOnly = beat.kind === "vo" || beat.kind === "react";
        out.push({
          sourceKey: beat.media_r2_key,
          start_ms: 0,
          end_ms: beat.end_ms ?? 0,
          text: beat.text ?? "",
          ...(audioOnly ? { audioOnly: true } : {}),
        });
      }
      continue;
    }

    if (beat.start_ms == null || beat.end_ms == null) continue;

    // Intersect the beat's range with what survived the cuts.
    for (const range of surviving) {
      const start = Math.max(beat.start_ms, range.start_ms);
      const end = Math.min(beat.end_ms, range.end_ms);
      if (end <= start) continue;
      out.push({ sourceKey, start_ms: start, end_ms: end, text: textForRange(segments, start, end) });
    }
  }

  return { cuts: out, durationMs: out.reduce((n, c) => n + (c.end_ms - c.start_ms), 0) };
}

/** What is said across a range, rebuilt from the transcript we already have. */
function textForRange(segments: Segmentish[], startMs: number, endMs: number): string {
  return segments
    .filter((s) => s.end_ms > startMs && s.start_ms < endMs)
    .map((s) => (s as Segmentish & { text?: string }).text ?? "")
    .join(" ")
    .trim();
}

function srtTime(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const milli = total % 1000;
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(milli, 3)}`;
}

/**
 * Subtitles for the finished piece, written alongside the render (Phase 3).
 *
 * Timings are in OUTPUT time, not source time — the ranges have been
 * rearranged and shortened, so a caption at 22:48 in the original may land at
 * 0:14 in the cut. Getting this wrong produces subtitles that drift further
 * out of sync the longer the video runs.
 */
export function buildSrt(edl: Edl): string {
  const blocks: string[] = [];
  let outMs = 0;
  let n = 1;

  for (const cut of edl.cuts) {
    const dur = cut.end_ms - cut.start_ms;
    const text = cut.text.trim();
    if (text) {
      blocks.push(`${n}\n${srtTime(outMs)} --> ${srtTime(outMs + dur)}\n${text}\n`);
      n++;
    }
    outMs += dur;
  }

  return blocks.join("\n");
}

/**
 * The concat plan the container runs. Kept as plain data rather than an ffmpeg
 * command string so the Worker never builds a shell line — and so the plan can
 * be logged, diffed, and re-run.
 */
export interface RenderPlan {
  cuts: Array<{ key: string; start_s: number; end_s: number; audioOnly?: boolean }>;
  format: string;
  aspect: string;
  durationS: number;
}

export function buildRenderPlan(edl: Edl, format: string, aspect: string): RenderPlan {
  return {
    cuts: edl.cuts.map((c) => ({
      key: c.sourceKey,
      start_s: c.start_ms / 1000,
      end_s: c.end_ms / 1000,
      ...(c.audioOnly ? { audioOnly: true } : {}),
    })),
    format,
    aspect,
    durationS: edl.durationMs / 1000,
  };
}
