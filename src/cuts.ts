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
  /**
   * Take the long silences OUT of this line, keeping every word.
   *
   * A pause has no word index to strike, and the first version struck the word
   * before it — so asking to tighten a silence deleted a word somebody said.
   * This marks the LINE instead: the ranges are then built word by word, which
   * naturally leaves out the gaps between them.
   *
   * It rides on words:null so nothing has to migrate, and everything that asks
   * "is this line struck?" checks for its absence.
   */
  tighten?: true;
}

/** A silence longer than this is worth taking out. */
export const PAUSE_OVER_MS = 2000;
/** And this much of it is left behind. Cutting a pause to nothing sounds spliced. */
export const PAUSE_BEAT_MS = 260;

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

/** Is this whole segment cut? A tighten marker also carries words:null and is
    the opposite of a cut line — it keeps every word in it. */
export function isSegmentCut(cuts: Cut[], seg: number): boolean {
  return cuts.some((c) => c.seg === seg && c.words === null && !c.tighten);
}

/** Is this line having its silences taken out? */
export function isTightened(cuts: Cut[], seg: number): boolean {
  return cuts.some((c) => c.seg === seg && c.tighten === true);
}

/** Is this individual word cut, either on its own or by its line being cut? */
export function isWordCut(cuts: Cut[], seg: number, word: number): boolean {
  return cuts.some(
    (c) =>
      c.seg === seg &&
      !c.tighten &&
      (c.words === null || (word >= c.words[0] && word <= c.words[1])),
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

/**
 * One word, as stored.
 *
 * `s` and `e` ARE IN SECONDS, not milliseconds — they are Whisper's own
 * numbers, written through unchanged (src/sources.ts), while the segment's
 * own start_ms and end_ms in the very same row are milliseconds. Two units,
 * adjacent columns.
 *
 * That is a landmine and it has already gone off once: a runtime built from
 * these as if they were milliseconds reported 59 minutes for a 2-minute video.
 * Use wordStartMs / wordEndMs rather than touching the fields.
 *
 * Not migrated, deliberately — playableRanges has always converted correctly,
 * so every stored transcript is consistent with the code that renders it. A
 * migration would put every existing source at risk to tidy a naming problem
 * that two helpers solve.
 */
export interface StoredWord {
  w: string;
  /** SECONDS. See above. */
  s: number;
  /** SECONDS. See above. */
  e: number;
}

/** A word's start, in the milliseconds everything else in this codebase uses. */
export const wordStartMs = (w: StoredWord): number => Math.round(w.s * 1000);

/** A word's end, in milliseconds. */
export const wordEndMs = (w: StoredWord): number => Math.round(w.e * 1000);

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

    const tightening = isTightened(cuts, seg.idx);

    // Nothing to act on, and no silence to take out: the line plays whole.
    if ((!wordCuts.length && !tightening) || !words.length) {
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
      const start = wordStartMs(words[i]);
      const end = wordEndMs(words[i]);

      /*
       * A long silence ends the run, and a beat of it is kept.
       *
       * This is what "tighten" has to mean: the words either side both stay,
       * and only the gap between them goes. Striking the preceding word — the
       * first attempt — removed something that was said.
       */
      if (run && tightening && start - run.end_ms > PAUSE_OVER_MS) {
        out.push({ start_ms: run.start_ms, end_ms: run.end_ms + PAUSE_BEAT_MS });
        run = { start_ms: start, end_ms: end };
        continue;
      }

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

/**
 * Words the design's clean-up chip removes.
 *
 * The rule was /^(um|uh|…)[,.]?$/ — the word, with at most one comma or full
 * stop after it. Whisper does not write hesitations that way. It writes
 * "Um..." and "Uh..." far more often than "um", and also "um?", "uh!" and
 * quoted forms, none of which matched. The chip greyed itself out on
 * transcripts full of them and said, correctly by its own count, that there
 * was nothing to remove.
 *
 * The punctuation is stripped from both ends before the word is compared, so
 * the list is a list of WORDS and any punctuation around them is somebody
 * else's problem. "uhm" and "hmm" are here too, which the original missed.
 */
const FILLERS = /^(um|uhm|umm|uh|uhh|erm|er|ah|hm|hmm|mm|mhm)$/i;

/** A spoken word, without whatever the transcriber put around it. */
const bareWord = (w: string) => w.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

/** Every filler word in the transcript, as cuts. Real words, real timings. */
export function fillerCuts(segments: Segmentish[]): Cut[] {
  const cuts: Cut[] = [];
  for (const seg of segments) {
    parseWords(seg.words).forEach((w, i) => {
      if (FILLERS.test(bareWord(w.w))) cuts.push({ seg: seg.idx, words: [i, i] });
    });
  }
  return cuts;
}

/**
 * Every place a phrase is said, with enough around it to recognise.
 *
 * The clean-up chips prove the mechanism and hardcode it to two words: walk
 * the segments, match words, emit ranges. The gesture that actually makes an
 * hour of footage tractable is the same walk with the words you typed — find
 * "the sponsor read", see all fourteen, cut them in one go.
 *
 * A term matches a word it is CONTAINED in, so the list narrows as you type
 * and "sponsor" still finds "sponsor," with its comma. Two characters is the
 * floor: one letter matches most of the English language, and offering to cut
 * all of it is not a feature.
 */
export interface PhraseMatch {
  seg: number;
  /** Word indices, inclusive — the same shape a Cut carries. */
  from: number;
  to: number;
  start_ms: number;
  end_ms: number;
  /** The line either side of the hit, so a result reads like something said. */
  before: string;
  hit: string;
  after: string;
}

/** Lowercase, and without the punctuation stuck to a spoken word. */
const bare = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, "");

const CONTEXT = 6;

export function findPhrase(segments: Segmentish[], phrase: string, limit = 300): PhraseMatch[] {
  const terms = phrase.split(/\s+/).map(bare).filter(Boolean);
  if (!terms.length || phrase.trim().length < 2) return [];

  const out: PhraseMatch[] = [];
  for (const seg of segments) {
    const words = parseWords(seg.words);
    if (!words.length) continue;
    const flat = words.map((w) => bare(w.w));

    for (let i = 0; i + terms.length <= flat.length; i++) {
      let hit = true;
      for (let t = 0; t < terms.length; t++) {
        if (!flat[i + t].includes(terms[t])) { hit = false; break; }
      }
      if (!hit) continue;

      const to = i + terms.length - 1;
      const say = (from: number, until: number) =>
        words.slice(from, until).map((w) => w.w.trim()).join(" ");

      out.push({
        seg: seg.idx,
        from: i,
        to,
        start_ms: wordStartMs(words[i]),
        end_ms: wordEndMs(words[to]),
        before: say(Math.max(0, i - CONTEXT), i),
        hit: say(i, to + 1),
        after: say(to + 1, to + 1 + CONTEXT),
      });
      if (out.length >= limit) return out;

      /* Past the match, not into it — "na na" in "na na na" is one hit and
         then the next, never the same words counted twice. */
      i = to;
    }
  }
  return out;
}

/** Those matches as cuts, so finding and cutting share one definition. */
export function phraseCuts(matches: PhraseMatch[]): Cut[] {
  return matches.map((m) => ({ seg: m.seg, words: [m.from, m.to] as [number, number] }));
}

/**
 * Long pauses, as cuts.
 *
 * A gap between two words inside a line, longer than `overMs`. Only the excess
 * is removed — tightening a pause to nothing makes speech sound spliced, so a
 * beat is left behind.
 */
export function pauseCuts(segments: Segmentish[], overMs = PAUSE_OVER_MS): Cut[] {
  const cuts: Cut[] = [];
  for (const seg of segments) {
    const words = parseWords(seg.words);
    for (let i = 1; i < words.length; i++) {
      if ((words[i].s - words[i - 1].e) * 1000 > overMs) {
        /*
         * One marker for the LINE, not one per gap.
         *
         * This used to push {words: [i-1, i-1]} — striking the word before the
         * silence, because a gap has no word index of its own. That deleted
         * something the person said: ask to tighten a pause, lose a word. The
         * marker leaves every word in place and playableRanges drops the gaps.
         */
        cuts.push({ seg: seg.idx, words: null, tighten: true });
        break;
      }
    }
  }
  return cuts;
}

/** What a set of cuts would remove, in milliseconds. */
export function timeSaved(segments: Segmentish[], existing: Cut[], added: Cut[]): number {
  const before = playableRanges(segments, existing).reduce((n, r) => n + (r.end_ms - r.start_ms), 0);
  const after = playableRanges(segments, addCuts(existing, added)).reduce((n, r) => n + (r.end_ms - r.start_ms), 0);
  return Math.max(0, before - after);
}

/** Merges new cuts in without duplicating ones already there. */
export function addCuts(existing: Cut[], added: Cut[]): Cut[] {
  const key = (c: Cut) => `${c.seg}:${c.words ? c.words.join("-") : "*"}`;
  const seen = new Set(existing.map(key));
  return [...existing, ...added.filter((c) => !seen.has(key(c)))];
}
