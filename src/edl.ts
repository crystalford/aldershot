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

import { type Cut, type StoredWord, wordStartMs, wordEndMs } from "./cuts.ts";
import { cuesFromWords, stretch, wrap } from "./captions.ts";
import { blockRanges, type Block } from "./blocks.ts";
import type { Timing } from "./align.ts";

export interface EdlCut {
  /** R2 key of the source to cut from. The MASTER — a render reads this. */
  sourceKey: string;
  /**
   * The same range, in the file you WATCH.
   *
   * The editor plays the 480p editing copy and the export is cut from the
   * master, so the preview needs its own key. Carried here rather than looked
   * up client-side because the preview's whole claim is that it plays the
   * ranges the export is built from — one list, two keys, no second source of
   * truth. buildRenderPlan never reads this, and test/proxy.test.ts fails if
   * an .edit.mp4 ever reaches a render plan.
   */
  previewKey: string;
  /**
   * A recording mixed OVER this range, with this range's own audio ducked
   * underneath it. B-roll with narration.
   *
   * The renderer has been able to do this since the branch was written and
   * had never been handed one — see container/render.mjs. Absent on almost
   * every cut.
   */
  voiceKey?: string;
  /** Where the words are in that take, for the ducking envelope. */
  voiceWords?: Array<{ s: number; e: number }>;
  /**
   * The words to SET AS TYPE, for a generated picture that has no file.
   *
   * The container draws this one — src/graphics.ts builds the SVG and
   * rsvg-convert rasterises it — so there is no key to presign and nothing
   * to fetch.
   */
  card?: string;
  start_ms: number;
  end_ms: number;
  /** What is said over this range, for captions and the SRT. */
  text: string;
  /**
   * The words of this range, with their SOURCE timings.
   *
   * Carried so captions can be split on real timings rather than on an
   * estimate — see the header of src/captions.ts for why an estimated clock
   * is not acceptable here. Absent on a block with no word timings, such as
   * a recording, and a cut with no words is simply never split.
   */
  words?: StoredWord[];
  /**
   * The label the renderer draws over this range, and null for almost all of
   * them. Carried from the block so the file and the cue sheet cannot
   * disagree about which pictures were labelled.
   */
  label?: string | null;
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
/** Words a reader gets through in a second, at the size a card sets them. */
export const CARD_WORDS_PER_S = 2.8;

/** The least time a card holds, however short it is. */
export const CARD_MIN_MS = 2200;

/**
 * HOW LONG A CARD HOLDS, when nothing has said.
 *
 * A generated beat has no recording, so `dur_ms` is whatever the editor
 * happened to store — usually nothing. A card is read rather than watched,
 * so the length is a reading time: the words at a reading speed, floored so
 * a three-word card is still legible rather than a flash.
 *
 * The maker's own duration wins where it exists. This is the fallback, not
 * an override — invariant 10's shape, in a number.
 */
export function cardMs(block: { text?: string | null; start_ms: number; end_ms: number }): number {
  const own = Math.max(0, block.end_ms - block.start_ms);
  if (own > 0) return own;
  const words = (block.text ?? "").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(CARD_MIN_MS, Math.round((words / CARD_WORDS_PER_S) * 1000));
}

export function buildEdl(
  /*
   * The project's OWN video, when it has one. Only ever a fallback — a block
   * that carries its own mediaKey never reads it (see below) — and empty on a
   * project assembled from the library, where every block is a clip from
   * somewhere else and there is no "own" video at all.
   */
  sourceKey: string,
  blocks: Block[],
  cuts: Cut[],
  /* The project's own editing copy, for blocks that do not carry their own.
     Optional so every existing caller keeps working; without it the preview
     plays the master, which is correct and merely slower. */
  previewKey?: string,
  /*
   * WHAT THE WORD TIMINGS ARE WORTH, which decides where a cut lands.
   *
   * With forced timings a cut moves into the silence beside the words rather
   * than sitting on the last phoneme — Phase 1's "on the pause, not the
   * phoneme". With recogniser timings it does not, because the gap they
   * report is fuzzier than the room it would make. Optional, and recogniser
   * by default, so a caller with no opinion gets what it always got.
   */
  timing?: Timing,
): Edl {
  const out: EdlCut[] = [];

  for (const block of blocks) {
    if (block.struck) continue;

    if (block.origin !== "footage") {
      /*
       * A recording or a generated visual carries its own media rather than a
       * range of the source, and is deliberately NOT affected by transcript
       * cuts — striking a word in the source should not shorten a voiceover.
       */
      /*
       * A GENERATED PICTURE HAS NO MEDIA AND IS NOT NOTHING.
       *
       * `if (!block.mediaKey) continue` dropped it, silently — so a card
       * somebody inserted appeared in the editor, held its place in the
       * runtime, and was simply absent from the export, with nothing said.
       * That is invariant 7's shape of failure in the one place a person
       * cannot check it until the file comes back.
       *
       * It carries its WORDS instead of a file. src/graphics.ts draws them
       * as type — "graphics are code, never pixels", and a diffusion model
       * cannot draw a word — and the container rasterises that. A generated
       * block with no words is still dropped, because there is nothing to
       * set and a blank frame in somebody's cut is worse than a beat that
       * never made it.
       */
      if (!block.mediaKey) {
        if (block.origin !== "generated" || !block.text?.trim()) continue;
        out.push({
          /* No file. The container draws this one. */
          sourceKey: "",
          previewKey: "",
          start_ms: 0,
          end_ms: cardMs(block),
          text: block.text,
          card: block.text.trim(),
          ...(block.label ? { label: block.label } : {}),
        });
        continue;
      }
      const audioOnly = block.origin === "voice";
      out.push({
        sourceKey: block.mediaKey,
        previewKey: block.previewKey || block.mediaKey,
        start_ms: 0,
        end_ms: Math.max(0, block.end_ms - block.start_ms),
        text: block.text ?? "",
        /* A generated picture or a stock clip arrives labelled; footage and
           voice carry null and the field is left off. */
        ...(block.label ? { label: block.label } : {}),
        ...(audioOnly ? { audioOnly: true } : {}),
      });
      continue;
    }

    /* blockRanges is the one definition of what a block plays — the same one
       the runtime under the editor is summed from, so the number you were
       shown is the length of the file you get. */
    /* No key from the block and none from the project means there is no file
       to cut. It cannot happen on a project with a source, and on a library
       edit it would mean a clip whose video has gone — skipped rather than
       emitted as a range of nothing, which the encoder would try to fetch. */
    const key = block.mediaKey || sourceKey;
    if (!key) continue;

    for (const range of blockRanges(block, cuts, timing)) {
      if (range.end_ms <= range.start_ms) continue;
      out.push({
        /*
         * A footage block usually plays from THIS project's video — but a clip
         * pulled from another one carries its own key, and cutting its
         * timecodes out of this file would splice a stranger's range from your
         * own footage.
         */
        sourceKey: block.mediaKey || sourceKey,
        previewKey: block.previewKey || previewKey || block.mediaKey || sourceKey,
        ...(block.voiceKey ? { voiceKey: block.voiceKey } : {}),
        ...(block.voiceWords?.length ? { voiceWords: block.voiceWords } : {}),
        start_ms: range.start_ms,
        end_ms: range.end_ms,
        text: textForRange(block, range.start_ms, range.end_ms),
        ...(block.words.length ? { words: wordsForRange(block, range.start_ms, range.end_ms) } : {}),
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
/**
 * The words of one range, by the same filter textForRange reads them with.
 *
 * Two filters would drift the first time either moved, and the drift would be
 * a caption whose text and whose timings disagreed about which words are in
 * it — which is the one failure a product built on receipts cannot have.
 */
function wordsForRange(block: Block, startMs: number, endMs: number): StoredWord[] {
  return block.words.filter((w) => wordEndMs(w) > startMs && wordStartMs(w) < endMs);
}

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
    if (cut.words?.length) {
      /*
       * Word timings are the SOURCE's; the cue needs the finished timeline's.
       * One subtraction and one addition, exact, no estimate anywhere — the
       * offset is the same for every word in the range because a range is
       * contiguous by construction (a struck word splits a block into two
       * ranges rather than leaving a hole in one).
       */
      const shift = outMs - cut.start_ms;
      cues.push(
        ...cuesFromWords(
          cut.words.map((w) => ({
            w: w.w,
            startMs: wordStartMs(w) + shift,
            endMs: wordEndMs(w) + shift,
          })),
        ),
      );
    } else if (text) {
      /* No word timings — a recording, or footage that never went through
         alignment. One cue for the whole cut, never split, and reported by
         overTheLimit if it reads too fast. */
      cues.push({ start_ms: outMs, end_ms: outMs + dur, text: wrap(text) });
    }
    outMs += dur;
  }

  /* Each cue takes what it needs from the gap after it, bounded by the next
     cue and by the end of the film. */
  return stretch(cues, outMs);
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
  cuts: Array<{
    key: string;
    start_s: number;
    end_s: number;
    voiceKey?: string;
  /** Where the words are in that take, for the ducking envelope. */
  voiceWords?: Array<{ s: number; e: number }>;
  /**
   * The words to SET AS TYPE, for a generated picture that has no file.
   *
   * The container draws this one — src/graphics.ts builds the SVG and
   * rsvg-convert rasterises it — so there is no key to presign and nothing
   * to fetch.
   */
  card?: string;
    /** Drawn over the picture, perceivable at first exposure. See src/cuesheet.ts. */
    label?: string;
    audioOnly?: boolean;
  }>;
  format: string;
  aspect: string;
  durationS: number;
  /**
   * Clean up the sound: denoise, de-click, a presence lift, compression and
   * broadcast loudness, applied once over the finished timeline.
   *
   * Opt-in and absent by default. Changing how somebody's voice sounds
   * without being asked is worse than making them ask.
   */
  enhance?: boolean;
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
  enhance?: boolean,
): RenderPlan {
  /* "None" is a real choice the picker offers, not a missing value. */
  const wantsCaptions = Boolean(captionStyle && captionStyle !== "None");

  return {
    ...(enhance ? { enhance: true } : {}),
    ...(wantsCaptions ? { captions: captionCues(edl), captionStyle: captionStyle as string } : {}),
    cuts: edl.cuts.map((c) => ({
      key: c.sourceKey,
      start_s: c.start_ms / 1000,
      end_s: c.end_ms / 1000,
      /* The KEY, not a url — runRender presigns it, exactly as it does the
         footage. Nothing here ever holds a credential. */
      ...(c.voiceKey ? { voiceKey: c.voiceKey } : {}),
      /* Spans, not a key: nothing to presign, and the container needs them
         to build the volume expression rather than to fetch anything. */
      ...(c.voiceWords?.length ? { voiceWords: c.voiceWords } : {}),
      /* The words, not a key — the container draws this one. */
      ...(c.card ? { card: c.card } : {}),
      ...(c.label ? { label: c.label } : {}),
      ...(c.audioOnly ? { audioOnly: true } : {}),
    })),
    format,
    aspect,
    durationS: edl.durationMs / 1000,
  };
}
