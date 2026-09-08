/**
 * The block — one piece of the finished piece.
 *
 * See docs/decisions/blocks.md. The short version: `segments`, `v2_clips` and
 * `beats` are three tables for the same idea, which is why the editor had four
 * tabs that felt like one and why the reorder gesture ended up marooned behind
 * a stage that is empty until a scoring pass runs.
 *
 * A block is a range of your footage, or something you recorded, or something
 * generated. This module is the one place that says what the sequence IS, so
 * the editor and the renderer cannot disagree about it.
 *
 * Nothing here deletes. The order is a list of ids and the cuts are ranges, so
 * every arrangement is reversible and the render can always be re-run — the
 * same discipline src/cuts.ts already follows, which is what makes reordering
 * safe rather than destructive.
 */

import { PAUSE_BEAT_MS, PAUSE_OVER_MS, isSegmentCut, isTightened, isWordCut, parseWords, wordEndMs, wordStartMs, type Cut, type StoredWord } from "./cuts.ts";

export type BlockOrigin = "footage" | "voice" | "generated";

export interface Block {
  /** Stable within a project: "s:12" for a segment, "b:<beatId>" for a beat. */
  id: string;
  origin: BlockOrigin;
  /** Where in the source this came from. Zero-length for a recording. */
  start_ms: number;
  end_ms: number;
  text: string;
  /** Words with timings, for striking inside a line. Empty for a recording. */
  words: StoredWord[];
  /** Struck whole — still rendered, struck through, because nothing vanishes. */
  struck: boolean;
  /** The model's opinion, when it has one. Null is not zero; it means unjudged. */
  score: number | null;
  why: string | null;
  /**
   * WHAT THIS BLOCK RENDERS FROM. Read by buildEdl, and only by buildEdl.
   *
   * Null means "this project's own source". A recording carries its own file,
   * and so does a clip pulled in from another video.
   */
  mediaKey: string | null;
  /**
   * WHAT THIS BLOCK PLAYS FROM, which is not the same file.
   *
   * Since the editing copy exists (src/proxy.ts) the editor watches a 480p mp4
   * and the export is cut from the master. One field cannot answer both, and a
   * field that tried would either splice 480p footage into a 4K render or make
   * the editor scrub four gigabytes.
   *
   * Null means "this project's own source", exactly as for mediaKey — the page
   * already hands the player a preview key for that case.
   */
  previewKey: string | null;
  /*
   * Words to SHOW, for a block whose words are not its own.
   *
   * A clip pulled from another video has no word timings in `words`, on
   * purpose (see fromPulled) — but an assembled cut still has to be readable,
   * and the script view has nothing to flow without them. These are read by
   * the page and by nothing else: no cut is stored against them, no range is
   * built from them, and the render never sees them.
   */
  displayWords?: StoredWord[];
  /**
   * A recording that plays OVER this block's picture.
   *
   * B-roll with narration on it. The renderer has mixed voice over footage —
   * with the footage's own audio sidechain-ducked underneath — since the day
   * that branch was written, and nothing ever handed it one: a beat was either
   * a clip OR a recording, so a voiceover became a flat colour card and the
   * picture was thrown away.
   *
   * Null on almost everything. Only a clip beat that has been talked over has
   * both a picture and a voice.
   */
  voiceKey: string | null;
  posterKey: string | null;
}

export interface SegmentLike {
  idx: number;
  start_ms: number;
  end_ms: number;
  text: string;
  words: string | null;
}

export interface BeatLike {
  id: string;
  idx: number;
  kind: string;
  text: string | null;
  dur_ms: number | null;
  media_r2_key: string | null;
  clip_id: string | null;
  /** Set when this beat is a clip pulled from a DIFFERENT video. */
  pulled?: PulledClip;
  /**
   * Struck, as stored. Anything truthy counts — the column is TEXT and has
   * held 1, '1' and null over its life.
   *
   * This was not read at all: fromBeat hardcoded struck:false, so a block you
   * inserted could be cut on screen and was never cut in the render.
   */
  struck?: unknown;
}

/** A moment from another video, resolved for insertion into this cut. */
export interface PulledClip {
  /** The master, for the render. */
  sourceKey: string;
  /** The editing copy, for the editor. Falls back to the master. */
  previewKey?: string | null;
  sourceTitle: string;
  start_ms: number;
  end_ms: number;
  quote: string;
  frameKey: string | null;
  /*
   * The other video's words inside this clip's range, when they were loaded.
   *
   * For READING. See displayWords on Block for why they must not become
   * Block.words.
   */
  words?: StoredWord[];
}

export interface ScoreLike {
  start_ms: number;
  end_ms: number;
  score: number | null;
  why: string | null;
}

export const segmentId = (idx: number) => `s:${idx}`;
export const beatId = (id: string) => `b:${id}`;

/** The stored order, or nothing if it has never been rearranged. */
export function parseOrder(json: string | null): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export const serialiseOrder = (order: string[]): string => JSON.stringify(order);

/**
 * The sequence, as blocks.
 *
 * A stored order is authoritative for the ids it names; anything it does not
 * name is appended in its natural position. That means a transcript can gain
 * lines — a re-read, a longer source — without the arrangement being thrown
 * away, and a stale id for something since deleted simply falls out.
 */
export function buildBlocks(opts: {
  segments: SegmentLike[];
  beats?: BeatLike[];
  cuts: Cut[];
  order?: string[];
  scores?: ScoreLike[];
  posterKey?: string | null;
}): Block[] {
  const { segments, beats = [], cuts, order = [], scores = [], posterKey = null } = opts;

  /*
   * ONE VERDICT PER MOMENT, not per line it happens to touch.
   *
   * judge() answered per segment with no knowledge of the others, so a moment
   * spanning three lines painted 93 on all three with the same sentence under
   * each — "three different lines all scored 93 for the same reason", which
   * reads as broken because it is not what the model said. It rated one
   * moment, once.
   *
   * The line the moment sits in MOST is the one it is about, decided here
   * across the whole transcript so it can only be true of one.
   */
  const verdicts = assignScores(segments, scores);

  const fromSegment = (s: SegmentLike): Block => ({
    id: segmentId(s.idx),
    origin: "footage",
    start_ms: s.start_ms,
    end_ms: s.end_ms,
    text: s.text,
    words: parseWords(s.words),
    struck: isSegmentCut(cuts, s.idx),
    score: verdicts.get(s.idx)?.score ?? null,
    why: verdicts.get(s.idx)?.why ?? null,
    mediaKey: null,
    previewKey: null,
    voiceKey: null,
    posterKey,
  });

  /*
   * A clip pulled from another video: real footage with its own words, which
   * happens to live in a different file. A footage block in every way except
   * which file it plays from — exactly what mediaKey is for, and what the EDL
   * already reads for inserted blocks.
   */
  const fromPulled = (b: BeatLike, p: PulledClip): Block => ({
    id: beatId(b.id),
    origin: "footage",
    start_ms: p.start_ms,
    end_ms: p.end_ms,
    text: p.quote,
    /*
     * STILL EMPTY, AND DELIBERATELY.
     *
     * blockRanges takes a whole-block fast path when a block has no words, and
     * builds ranges from word timings when it has them. A pulled block's word
     * cuts can never be addressed — wordStruck does Number(id.slice(2)) and a
     * beat id is a ulid, so that is NaN and no word here can ever be marked —
     * so giving this real words would change what the RENDER produces while
     * leaving no way to affect it. The words go in displayWords instead, where
     * only the page reads them.
     */
    words: [],
    displayWords: p.words ?? [],
    struck: Boolean(b.struck) && b.struck !== "0",
    score: null,
    why: p.sourceTitle,
    /* The two differ HERE and essentially nowhere else, which is the whole
       reason previewKey exists: this block belongs to another video, so it
       renders from that video's master and plays that video's copy. */
    mediaKey: p.sourceKey,
    previewKey: p.previewKey || p.sourceKey,
    /* The clip's picture, your voice over it. */
    voiceKey: b.media_r2_key ?? null,
    posterKey: p.frameKey || posterKey,
  });

  const fromBeat = (b: BeatLike): Block => ({
    id: beatId(b.id),
    origin: b.kind === "generated" || b.kind === "stock" ? "generated" : "voice",
    start_ms: 0,
    end_ms: b.dur_ms ?? 0,
    text: b.text ?? "",
    words: [],
    struck: Boolean(b.struck) && b.struck !== "0",
    score: null,
    why: null,
    /* A recording is small and has no separate copy — it is its own preview. */
    mediaKey: b.media_r2_key,
    previewKey: b.media_r2_key,
    /* A voiceover with no clip behind it IS its own media, not a voice over
       something else — it renders as the colour card, which is correct when
       there is no picture to put it on. */
    voiceKey: null,
    posterKey,
  });

  const byId = new Map<string, Block>();
  for (const s of segments) byId.set(segmentId(s.idx), fromSegment(s));
  /*
   * A clip beat is usually a pointer at footage the segments already cover, so
   * it would render the same range twice. The exception is a clip PULLED from
   * another video — that material is in no segment here, so dropping it would
   * mean the seam's "A clip" inserted something the editor never showed and
   * the render never included.
   */
  for (const b of beats) {
    if (b.kind !== "clip") byId.set(beatId(b.id), fromBeat(b));
    else if (b.pulled) byId.set(beatId(b.id), fromPulled(b, b.pulled));
  }

  const out: Block[] = [];
  const placed = new Set<string>();
  for (const id of order) {
    const block = byId.get(id);
    if (block && !placed.has(id)) {
      out.push(block);
      placed.add(id);
    }
  }
  for (const [id, block] of byId) if (!placed.has(id)) out.push(block);

  return out;
}

/**
 * Which line each scored moment belongs to.
 *
 * A moment is a RANGE and a line is a range, and a moment usually covers
 * several. The old rule asked each line "which moment do you overlap most?",
 * which every line inside one answered the same way — so the same score and
 * the same sentence appeared under each of them, as if the model had rated
 * every line identically.
 *
 * Asked the other way round it can only be true once: each moment picks the
 * line it sits in most. A line already spoken for is not taken again, so two
 * moments in one long line still get a line each rather than fighting over it.
 */
function assignScores(
  segments: SegmentLike[],
  scores: ScoreLike[],
): Map<number, ScoreLike> {
  const out = new Map<number, ScoreLike>();
  /* Strongest first, so when two moments want the same line the better one
     gets it and the other falls to its next-best. */
  const ranked = [...scores].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  for (const moment of ranked) {
    let bestIdx: number | null = null;
    let bestOverlap = 0;
    for (const seg of segments) {
      if (out.has(seg.idx)) continue;
      const overlap = Math.min(seg.end_ms, moment.end_ms) - Math.max(seg.start_ms, moment.start_ms);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestIdx = seg.idx;
      }
    }
    if (bestIdx !== null) out.set(bestIdx, moment);
  }
  return out;
}

/** Whether one word of a footage block survives. */
export const wordStruck = (cuts: Cut[], block: Block, wordIdx: number): boolean =>
  block.origin === "footage" && isWordCut(cuts, Number(block.id.slice(2)), wordIdx);

/**
 * Moves a block, returning the new order.
 *
 * Takes the CURRENT sequence rather than the stored order, because the stored
 * one may be empty (never rearranged) or partial. Returning a complete order
 * means the arrangement is explicit from the first move onward.
 */
export function moveBlock(blocks: Block[], id: string, dir: -1 | 1): string[] {
  const ids = blocks.map((b) => b.id);
  const at = ids.indexOf(id);
  if (at < 0) return ids;
  const to = at + dir;
  if (to < 0 || to >= ids.length) return ids;
  [ids[at], ids[to]] = [ids[to], ids[at]];
  return ids;
}

/**
 * What ONE block actually plays, as ranges of the source in milliseconds.
 *
 * The single definition of that question, because there were two and they
 * disagreed: the editor's footer summed surviving words while the renderer
 * built from clip beats, so the number under your cut was not the length of
 * the file you got. Both go through here now.
 *
 * A struck block plays nothing. A block with no word timings plays whole —
 * there is nothing finer to go on. Otherwise the surviving words are merged
 * into runs, so the render does not cut and rejoin at every word boundary and
 * the kept speech keeps its natural gaps.
 *
 * A recording has no range in the source at all; it carries its own media, so
 * it is not answerable here. Callers handle it by origin.
 */
export function blockRanges(block: Block, cuts: Cut[]): Array<{ start_ms: number; end_ms: number }> {
  if (block.struck) return [];
  if (block.origin !== "footage") return [];
  if (!block.words.length) return [{ start_ms: block.start_ms, end_ms: block.end_ms }];

  /* Word timings are SECONDS while the segment's are milliseconds — see
     StoredWord. Subtracting the raw fields reported 59 minutes for a
     two-minute video the first time this ran. */
  /* Whether this line is having its silences taken out. The same rule
     playableRanges follows, because the footer's runtime and the rendered file
     are built from these two functions and must not disagree. */
  const tightening = block.origin === "footage" && isTightened(cuts, Number(block.id.slice(2)));

  const out: Array<{ start_ms: number; end_ms: number }> = [];
  let run: { start_ms: number; end_ms: number } | null = null;
  for (let i = 0; i < block.words.length; i++) {
    if (wordStruck(cuts, block, i)) {
      if (run) out.push(run);
      run = null;
      continue;
    }
    const start = wordStartMs(block.words[i]);
    const end = wordEndMs(block.words[i]);

    /* A long silence ends the run and a beat of it is kept — every word on
       both sides stays. */
    if (run && tightening && start - run.end_ms > PAUSE_OVER_MS) {
      out.push({ start_ms: run.start_ms, end_ms: run.end_ms + PAUSE_BEAT_MS });
      run = { start_ms: start, end_ms: end };
      continue;
    }

    if (run) run.end_ms = Math.max(run.end_ms, end);
    else run = { start_ms: start, end_ms: end };
  }
  if (run) out.push(run);
  return out;
}

/** What the cut actually runs to, with struck lines and words removed. */
export function runtimeMs(blocks: Block[], cuts: Cut[]): number {
  let total = 0;
  for (const block of blocks) {
    if (block.struck) continue;
    if (block.origin !== "footage") {
      total += Math.max(0, block.end_ms - block.start_ms);
      continue;
    }
    for (const r of blockRanges(block, cuts)) total += Math.max(0, r.end_ms - r.start_ms);
  }
  return total;
}
