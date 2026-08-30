/**
 * Transcribing audio too long for one call.
 *
 * Up to about four hours a source goes to Whisper whole (measured — see
 * docs/decisions/transcription.md). Beyond that it is cut into chunks, and
 * this is where the pieces are put back together.
 *
 * The stitching is the part worth being careful about. Each chunk's words come
 * back starting at zero, so every one has to be shifted by the chunk's real
 * start time; and because chunks overlap on purpose — so a word straddling a
 * cut is heard whole at least once — the duplicate has to be dropped. Get
 * either wrong and the damage is a timestamp that is subtly off hours into a
 * transcript, which nobody notices until an export is wrong.
 */

import type { WhisperSegment, WhisperWord } from "./transcribe";

/**
 * Two hours. The measured ceiling for a single call is around four
 * (~80 MB of base64), and 5 hours failed only AFTER burning four minutes — so
 * the margin here is deliberate. A 10-hour stream becomes five calls.
 */
export const CHUNK_MS = 2 * 60 * 60 * 1000;

/**
 * Forty-five seconds of overlap between chunks.
 *
 * It has to comfortably exceed one Whisper segment (typically ~30s), not just
 * one word. The stitch hands the seam to the LATER chunk, and that only works
 * if the later chunk has heard the whole of anything crossing the boundary.
 * Duplicated audio is cheap — at 46 neurons a minute, 45s costs about $0.0004.
 */
export const OVERLAP_MS = 45_000;

export interface ChunkTranscript {
  /** Where this chunk started in the original, in milliseconds. */
  startMs: number;
  segments: WhisperSegment[];
}

/** Shifts a chunk's segments into the original's timeline. */
export function offsetSegments(segments: WhisperSegment[], startMs: number): WhisperSegment[] {
  const offsetS = startMs / 1000;
  return segments.map((s) => ({
    ...s,
    start: s.start + offsetS,
    end: s.end + offsetS,
    words: (s.words ?? []).map((w: WhisperWord) => ({ ...w, start: w.start + offsetS, end: w.end + offsetS })),
  }));
}

/**
 * Joins chunk transcripts into one.
 *
 * The seam is handed to the LATER chunk, at a cutover placed where the later
 * chunk begins. Each chunk contributes only the segments that finish before
 * the next chunk starts; everything from there comes from the next chunk.
 *
 * That direction matters. A sentence crossing a boundary is TRUNCATED in the
 * earlier chunk — Whisper simply ran out of audio — and heard whole by the
 * later one, which starts far enough back to have the beginning of it. Keeping
 * the earlier version would silently clip a sentence at every seam. It also
 * makes duplication structurally impossible rather than something a tolerance
 * has to catch: each moment in time is claimed by exactly one chunk.
 *
 * This relies on OVERLAP_MS exceeding one segment, so the later chunk really
 * does cover everything the earlier one gave up.
 */
export function stitch(chunks: ChunkTranscript[]): WhisperSegment[] {
  const ordered = [...chunks].sort((a, b) => a.startMs - b.startMs);
  const out: WhisperSegment[] = [];

  for (let i = 0; i < ordered.length; i++) {
    const shifted = offsetSegments(ordered[i].segments, ordered[i].startMs);
    const next = ordered[i + 1];
    if (!next) {
      out.push(...shifted);
      continue;
    }
    // Where the next chunk takes over, in seconds.
    const cutoverS = next.startMs / 1000;
    for (const seg of shifted) {
      // A hair of slack so a segment ending exactly on the cutover is not
      // dropped by floating-point noise.
      if (seg.end <= cutoverS + 0.001) out.push(seg);
    }
  }

  return out.sort((a, b) => a.start - b.start);
}

/** Rebuilds the full text from stitched segments, spaced but not re-punctuated. */
export function joinText(segments: WhisperSegment[]): string {
  return segments
    .map((s) => s.text.trim())
    .filter(Boolean)
    .join(" ");
}
