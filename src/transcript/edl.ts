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
}

export interface Range {
  start: number;
  end: number;
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
