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

import { isSegmentCut, isWordCut, parseWords, wordEndMs, wordStartMs, type Cut, type StoredWord } from "./cuts.ts";

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
  /** A recording's own media, and the frame to show for it. */
  mediaKey: string | null;
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
  /**
   * Struck, as stored. Anything truthy counts — the column is TEXT and has
   * held 1, '1' and null over its life.
   *
   * This was not read at all: fromBeat hardcoded struck:false, so a block you
   * inserted could be cut on screen and was never cut in the render.
   */
  struck?: unknown;
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

  const fromSegment = (s: SegmentLike): Block => ({
    id: segmentId(s.idx),
    origin: "footage",
    start_ms: s.start_ms,
    end_ms: s.end_ms,
    text: s.text,
    words: parseWords(s.words),
    struck: isSegmentCut(cuts, s.idx),
    ...judge(scores, s.start_ms, s.end_ms),
    mediaKey: null,
    posterKey,
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
    mediaKey: b.media_r2_key,
    posterKey,
  });

  const byId = new Map<string, Block>();
  for (const s of segments) byId.set(segmentId(s.idx), fromSegment(s));
  /* A clip beat is a pointer at footage the segments already cover, so it would
     render the same range twice. Only beats carrying their OWN material are
     blocks in their own right. */
  for (const b of beats) if (b.kind !== "clip") byId.set(beatId(b.id), fromBeat(b));

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

/** The model's opinion of the range this block covers, if it has one. */
function judge(scores: ScoreLike[], startMs: number, endMs: number): { score: number | null; why: string | null } {
  /* The best-overlapping judgement rather than the first: a scored moment can
     span several lines, and the line most inside it is the one it is about. */
  let best: ScoreLike | null = null;
  let bestOverlap = 0;
  for (const s of scores) {
    const overlap = Math.min(endMs, s.end_ms) - Math.max(startMs, s.start_ms);
    if (overlap > bestOverlap) {
      best = s;
      bestOverlap = overlap;
    }
  }
  return { score: best?.score ?? null, why: best?.why ?? null };
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
