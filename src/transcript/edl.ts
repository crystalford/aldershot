/**
 * Edit Decision List — the core of text-based editing.
 * Words carry timestamps; deleting words removes their time from the cut.
 * (The frontend mirrors this logic in public/app.js for instant preview.)
 */
export interface Word {
  text: string;
  start: number;
  end: number;
  deleted?: boolean;
  /** Client-only, purely organizational: start a new paragraph before this
   * word (Enter at the caret). Never affects timing, deletion, or export —
   * the server ignores it. */
  breakBefore?: boolean;
}

export interface Range {
  start: number;
  end: number;
}

/** A contiguous span of one video's timeline, in source seconds. The unit the
 *  arranged long-form and the shorts are both built from. */
export interface Segment {
  videoId: string;
  start: number;
  end: number;
  reason?: string; // why the AI chose it (arrange step); absent for manual segments
}

/** The arranged long-form cut: a cold open of hooks, then the body. */
export interface Timeline {
  coldOpen: Segment[];
  body: Segment[];
}

/** An Opus-Clip-style suggested short — a self-contained moment. */
export interface Short {
  title: string;
  videoId: string;
  start: number;
  end: number;
  hook: string;
  why?: string;
  score?: number; // 0–100 share-worthiness
}

/** An AI-found connection between two (or more) moments worth editing together —
 *  a callback, a contrast, or a shared theme spread across the transcript(s). */
export interface EditSuggestion {
  title: string;
  type: "callback" | "contrast" | "theme";
  why: string;
  segments: Segment[]; // play/cut in this order to realize the suggestion
}

/** Merge kept (non-deleted) words into contiguous time ranges. */
export function keptRanges(words: Word[], gapTolerance = 0.12): Range[] {
  const ranges: Range[] = [];
  for (const w of words) {
    if (w.deleted) continue;
    const last = ranges[ranges.length - 1];
    if (last && w.start - last.end <= gapTolerance) last.end = w.end;
    else ranges.push({ start: w.start, end: w.end });
  }
  return ranges;
}

export function totalSeconds(ranges: Range[]): number {
  return ranges.reduce((s, r) => s + (r.end - r.start), 0);
}

/** ffmpeg select/aselect filter that cuts + concats the kept ranges. */
export function ffmpegSelect(ranges: Range[]): string {
  const between = ranges.map((r) => `between(t,${r.start.toFixed(3)},${r.end.toFixed(3)})`).join("+");
  const v = `select='${between}',setpts=N/FRAME_RATE/TB`;
  const a = `aselect='${between}',asetpts=N/SR/TB`;
  return `-vf "${v}" -af "${a}"`;
}
