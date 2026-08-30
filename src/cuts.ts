/**
 * Transcript cuts — Script mode's edit.
 *
 * "Deleting words deletes video. Struck sentences render as strikethrough, not
 * gone, so the cut is legible" (01-PRODUCT.md §Editor).
 *
 * A cut is stored as a range, not as removed text: nothing is deleted, so a
 * struck line can always be shown struck-through and put back. That is the
 * same discipline as keep/drop in Pick, and it is why the render can always be
 * re-run — the edit is data (04-API-AND-JOBS.md §Principles).
 *
 * Ranges are held on the project rather than per beat, because Script edits the
 * whole source transcript rather than one block.
 */

export interface Cut {
  /** Segment index in the source transcript. */
  seg: number;
  /**
   * Word range within that segment, as [firstWord, lastWord] inclusive.
   * A null range means the whole line is cut — the common case, since
   * striking a sentence is the primary gesture.
   */
  words: [number, number] | null;
}

/** Parses the stored JSON, treating anything malformed as "no cuts". */
export function parseCuts(json: string | null): Cut[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter((c): c is Cut => typeof (c as Cut)?.seg === "number");
  } catch {
    return [];
  }
}

export function serialiseCuts(cuts: Cut[]): string {
  return JSON.stringify(cuts);
}

/** Is this whole segment cut? */
export function isSegmentCut(cuts: Cut[], seg: number): boolean {
  return cuts.some((c) => c.seg === seg && c.words === null);
}

/** Is this individual word cut, either on its own or by its line being cut? */
export function isWordCut(cuts: Cut[], seg: number, word: number): boolean {
  return cuts.some(
    (c) => c.seg === seg && (c.words === null || (word >= c.words[0] && word <= c.words[1])),
  );
}

/**
 * Toggles a whole line.
 *
 * Cutting a line clears any word-level cuts inside it — they are redundant
 * once the whole line is gone, and leaving them would make un-cutting the line
 * restore it with holes the user never asked for.
 */
export function toggleSegment(cuts: Cut[], seg: number): Cut[] {
  if (isSegmentCut(cuts, seg)) return cuts.filter((c) => c.seg !== seg);
  return [...cuts.filter((c) => c.seg !== seg), { seg, words: null }];
}

/** Toggles a single word. */
export function toggleWord(cuts: Cut[], seg: number, word: number): Cut[] {
  // A word inside a fully-cut line: drop the line cut and keep everything
  // except this word, so the gesture does what it looks like it does.
  if (isSegmentCut(cuts, seg)) {
    return [...cuts.filter((c) => c.seg !== seg), { seg, words: [word, word] }];
  }
  const existing = cuts.find((c) => c.seg === seg && c.words && word >= c.words[0] && word <= c.words[1]);
  if (!existing || !existing.words) {
    return [...cuts, { seg, words: [word, word] }];
  }
  // Un-cutting a word inside a range splits that range around it.
  const [from, to] = existing.words;
  const rest = cuts.filter((c) => c !== existing);
  const parts: Cut[] = [];
  if (word > from) parts.push({ seg, words: [from, word - 1] });
  if (word < to) parts.push({ seg, words: [word + 1, to] });
  return [...rest, ...parts];
}

export interface Segmentish {
  idx: number;
  start_ms: number;
  end_ms: number;
  words: string | null;
}

export interface StoredWord {
  w: string;
  s: number;
  e: number;
}

export function parseWords(json: string | null): StoredWord[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? (v as StoredWord[]) : [];
  } catch {
    return [];
  }
}

/**
 * What the cut actually plays, as ranges of the source in milliseconds.
 *
 * This is the bridge between text and video, and the reason striking a word
 * removes footage: the render is built from these ranges. Adjacent survivors
 * are merged so the render does not cut and rejoin at every word boundary.
 */
export function playableRanges(segments: Segmentish[], cuts: Cut[]): Array<{ start_ms: number; end_ms: number }> {
  const out: Array<{ start_ms: number; end_ms: number }> = [];

  for (const seg of segments) {
    if (isSegmentCut(cuts, seg.idx)) continue;

    const words = parseWords(seg.words);
    const wordCuts = cuts.filter((c) => c.seg === seg.idx && c.words);

    // No word-level cuts, or no word timings to act on: the line plays whole.
    if (!wordCuts.length || !words.length) {
      out.push({ start_ms: seg.start_ms, end_ms: seg.end_ms });
      continue;
    }

    let run: { start_ms: number; end_ms: number } | null = null;
    for (let i = 0; i < words.length; i++) {
      if (isWordCut(cuts, seg.idx, i)) {
        if (run) out.push(run);
        run = null;
        continue;
      }
      const start = Math.round(words[i].s * 1000);
      const end = Math.round(words[i].e * 1000);
      if (run) run.end_ms = end;
      else run = { start_ms: start, end_ms: end };
    }
    if (run) out.push(run);
  }

  // Merge ranges that touch, so the render does not stitch at every boundary.
  const merged: Array<{ start_ms: number; end_ms: number }> = [];
  for (const r of out.sort((a, b) => a.start_ms - b.start_ms)) {
    const last = merged[merged.length - 1];
    if (last && r.start_ms - last.end_ms <= 1) last.end_ms = Math.max(last.end_ms, r.end_ms);
    else merged.push({ ...r });
  }
  return merged;
}

/** Total runtime after cuts, in seconds. */
export function runtimeAfterCuts(segments: Segmentish[], cuts: Cut[]): number {
  return playableRanges(segments, cuts).reduce((n, r) => n + (r.end_ms - r.start_ms), 0) / 1000;
}

/** Words the design's clean-up chip removes. */
const FILLERS = /^(um|uh|erm|uhh|umm|ah|er)[,.]?$/i;

/** Every filler word in the transcript, as cuts. Real words, real timings. */
export function fillerCuts(segments: Segmentish[]): Cut[] {
  const cuts: Cut[] = [];
  for (const seg of segments) {
    parseWords(seg.words).forEach((w, i) => {
      if (FILLERS.test(w.w.trim())) cuts.push({ seg: seg.idx, words: [i, i] });
    });
  }
  return cuts;
}

/** Merges new cuts in without duplicating ones already there. */
export function addCuts(existing: Cut[], added: Cut[]): Cut[] {
  const key = (c: Cut) => `${c.seg}:${c.words ? c.words.join("-") : "*"}`;
  const seen = new Set(existing.map(key));
  return [...existing, ...added.filter((c) => !seen.has(key(c)))];
}
