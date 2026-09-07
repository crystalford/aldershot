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

import { playableRanges, type Cut, type Segmentish, wordStartMs, wordEndMs } from "./cuts.ts";
import { blockRanges, type Block } from "./blocks.ts";

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

/**
 * Builds the EDL from the BLOCK SEQUENCE.
 *
 * This used to walk `beats`, and emit nothing when there were none. Clip beats
 * only exist after a scoring pass, so a cut made by striking text — the main
 * way this product is used — produced an empty EDL and failed with "There's
 * nothing kept to render yet", while the editor showed a full runtime and an
 * enabled Export button. It also never read `block_order`, so rearranging
 * blocks could not affect the file, and it had no notion of a struck beat, so
 * a voiceover you cut was still in your export.
 *
 * Blocks fix all of that at once, because a block sequence already IS the
 * finished piece: `buildBlocks` excludes clip beats on the grounds that "a
 * clip beat is a pointer at footage the segments already cover", so what is
 * left is every footage segment with its cuts applied plus every inserted beat
 * carrying its own media, in the order the user arranged. A scored cut and an
 * unassisted one now render through one path.
 *
 * One cut per block, not per merged range across the whole transcript, which
 * also fixes captions: `captionCues` gets one cue per line instead of one cue
 * holding minutes of joined text.
 */
export function buildEdl(sourceKey: string, blocks: Block[], cuts: Cut[]): Edl {
  const out: EdlCut[] = [];

  for (const block of blocks) {
    if (block.struck) continue;

    if (block.origin !== "footage") {
      /*
       * A recording or a generated visual carries its own media rather than a
       * range of the source, and is deliberately NOT affected by transcript
       * cuts — striking a word in the source should not shorten a voiceover.
       */
      if (!block.mediaKey) continue;
      const audioOnly = block.origin === "voice";
      out.push({
        sourceKey: block.mediaKey,
        start_ms: 0,
        end_ms: Math.max(0, block.end_ms - block.start_ms),
        text: block.text ?? "",
        ...(audioOnly ? { audioOnly: true } : {}),
      });
      continue;
    }

    /* blockRanges is the one definition of what a block plays — the same one
       the runtime under the editor is summed from, so the number you were
       shown is the length of the file you get. */
    for (const range of blockRanges(block, cuts)) {
      if (range.end_ms <= range.start_ms) continue;
      out.push({
        /*
         * A footage block usually plays from THIS project's video — but a clip
         * pulled from another one carries its own key, and cutting its
         * timecodes out of this file would splice a stranger's range from your
         * own footage.
         */
        sourceKey: block.mediaKey || sourceKey,
        start_ms: range.start_ms,
        end_ms: range.end_ms,
        text: textForRange(block, range.start_ms, range.end_ms),
      });
    }
  }

  return { cuts: out, durationMs: out.reduce((n, c) => n + (c.end_ms - c.start_ms), 0) };
}

/**
 * What is said across one range of one block.
 *
 * From the block's OWN words, not by re-scanning every segment: a line with a
 * word struck out of the middle plays as two ranges, and scanning segments
 * would give both of them the whole line's text — so a caption would show
 * words the video no longer contains. Falls back to the line when there are no
 * word timings to go on.
 */
function textForRange(block: Block, startMs: number, endMs: number): string {
  if (!block.words.length) return (block.text ?? "").trim();
  return block.words
    .filter((w) => wordEndMs(w) > startMs && wordStartMs(w) < endMs)
    .map((w) => w.w)
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
export interface CaptionCue {
  start_ms: number;
  end_ms: number;
  text: string;
}

/**
 * What is said, on the FINISHED timeline rather than the source's.
 *
 * Both the sidecar .srt and the burned-in captions need exactly this, and the
 * timing is the fiddly part — every cut shifts everything after it, so the
 * output clock has to be accumulated rather than read off the source. It was
 * computed inside buildSrt and nowhere else, which is half of why burned-in
 * captions were never wired: the numbers existed but only in a form that could
 * be written to a file.
 */
export function captionCues(edl: Edl): CaptionCue[] {
  const cues: CaptionCue[] = [];
  let outMs = 0;

  for (const cut of edl.cuts) {
    const dur = cut.end_ms - cut.start_ms;
    const text = cut.text.trim();
    if (text) cues.push({ start_ms: outMs, end_ms: outMs + dur, text });
    outMs += dur;
  }

  return cues;
}

export function buildSrt(edl: Edl): string {
  return captionCues(edl)
    .map((c, i) => `${i + 1}\n${srtTime(c.start_ms)} --> ${srtTime(c.end_ms)}\n${c.text}\n`)
    .join("\n");
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
  /*
   * Burned-in captions. The container has had a complete ASS writer with two
   * styles since it was written, and NOTHING EVER SET THESE — so `cues` was
   * always empty, the caption branch never ran, and no render has ever had a
   * word burned into it. Clipping's whole promise is "captions burned in".
   *
   * Opt-in, and absent by default: captions belong on a short, not on every
   * export, and the owner's instruction was explicit that they are a choice
   * rather than something applied to everything.
   */
  captions?: CaptionCue[];
  captionStyle?: string;
}

export function buildRenderPlan(
  edl: Edl,
  format: string,
  aspect: string,
  captionStyle?: string | null,
): RenderPlan {
  /* "None" is a real choice the picker offers, not a missing value. */
  const wantsCaptions = Boolean(captionStyle && captionStyle !== "None");

  return {
    ...(wantsCaptions ? { captions: captionCues(edl), captionStyle: captionStyle as string } : {}),
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
