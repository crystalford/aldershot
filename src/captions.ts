/**
 * CAPTIONS THAT CAN BE READ.
 *
 * `09-EXPORT-AND-INTEGRITY.md`, in the Sound and captions row: "captions ≤17
 * characters a second; a subtitle file alongside; no stacking on burned-in
 * subtitles", and then the sentence that decides the whole shape of this file:
 * "CHECKED ON EVERY EXPORT, NOT OFFERED AS A FIX".
 *
 * So nothing here rewrites anybody's words. 17 characters a second is a
 * reading rate, and when somebody genuinely speaks faster than that the only
 * ways to meet it are to cut their words down or to leave the caption up
 * longer. The first is paraphrasing a person — invariant 10 says the user's
 * own words win where they exist, and these are the user's own words by
 * definition. So this does the second, as far as the gaps allow, and REPORTS
 * what is still too fast rather than fixing it quietly.
 *
 * NO INVENTED CLOCK. Cues are split on real word timings and nowhere else.
 * The obvious alternative — apportion a block's duration by each word's share
 * of the characters — is the exact mistake src/rules.ts carries a note about
 * at hooksFast, where an estimated clock failed a one-sentence moment for a
 * hook it had actually landed. A block with no word timings is not split at
 * all; it stays one cue and is reported if it reads too fast.
 */

/** The reading rate doc 09 names. Characters, including spaces, per second. */
export const MAX_CPS = 17;

/**
 * Two lines of 42, which is the broadcast norm and what every player expects.
 *
 * Not in doc 09, and needed to make its number reachable: 17 cps is a rate,
 * and a cue holding a whole paragraph fails it no matter how long it is left
 * up. The limit is what turns one block into several readable cues.
 */
export const MAX_LINE_CHARS = 42;
export const MAX_LINES = 2;
export const MAX_CUE_CHARS = MAX_LINE_CHARS * MAX_LINES;

/** A cue that flashes is unreadable at any rate. */
export const MIN_CUE_MS = 1000;
/** And one that outstays its welcome reads as a stuck player. */
export const MAX_CUE_MS = 7000;
/** So two cues never butt into each other and look like one. */
export const CUE_GAP_MS = 80;

export interface TimedWord {
  w: string;
  /** On the OUTPUT timeline, not the source's. */
  startMs: number;
  endMs: number;
}

export interface Cue {
  start_ms: number;
  end_ms: number;
  text: string;
}

/** Characters a second, or null when there is no time to divide by. */
export function cps(text: string, ms: number): number | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return (text.length * 1000) / ms;
}

/** How long this text needs on screen to read at the limit. */
export const msToRead = (text: string): number => Math.ceil((text.length * 1000) / MAX_CPS);

/**
 * A run of words broken into readable chunks, at word boundaries only.
 *
 * Greedy rather than balanced. A balanced split reads marginally better and
 * needs to know every chunk before placing the first, which means a cue's
 * timing would depend on words that come after it — and the one thing these
 * have to be is a function of the timings they were built from.
 */
export function chunk(words: TimedWord[]): TimedWord[][] {
  const out: TimedWord[][] = [];
  let run: TimedWord[] = [];
  let chars = 0;
  for (const word of words) {
    const add = word.w.length + (run.length ? 1 : 0);
    if (run.length && chars + add > MAX_CUE_CHARS) {
      out.push(run);
      run = [];
      chars = 0;
    }
    run.push(word);
    chars += run.length === 1 ? word.w.length : add;
  }
  if (run.length) out.push(run);
  return out;
}

/** The words of one chunk, as they will read. */
export const textOf = (run: TimedWord[]): string => run.map((w) => w.w).join(" ").trim();

/**
 * Wraps a cue onto at most two lines, breaking at a space.
 *
 * Longer than two lines is left alone rather than truncated: losing a word is
 * worse than a third line, and chunk() keeps it from happening anyway.
 */
export function wrap(text: string): string {
  if (text.length <= MAX_LINE_CHARS) return text;
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (line && next.length > MAX_LINE_CHARS) {
      lines.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

/** Cues straight off the word timings, before anything is stretched. */
export function cuesFromWords(words: TimedWord[]): Cue[] {
  return chunk(words)
    .map((run) => ({
      start_ms: run[0].startMs,
      end_ms: run[run.length - 1].endMs,
      text: wrap(textOf(run)),
    }))
    .filter((c) => c.text.length > 0);
}

/**
 * Leaves each cue up as long as the gap after it allows.
 *
 * THE ONLY LEVER THERE IS. The words start when they start, so the only way
 * to slow a caption down without touching it is to hold it into the silence
 * that follows. A cue takes what it needs to reach the limit and no more,
 * stops short of the next cue, and never runs past the end of the film.
 *
 * `endMs` is the finished runtime. Without it the last cue would have nothing
 * to be bounded by and could be left hanging past the final frame, which some
 * players show over black and others drop entirely.
 */
export function stretch(cues: Cue[], endMs: number): Cue[] {
  return cues.map((c, i) => {
    const nextStart = i + 1 < cues.length ? cues[i + 1].start_ms : endMs;
    /* The wrap's newline is a line break, not a character anybody reads. */
    const plain = c.text.replace(/\n/g, " ");
    const want = Math.max(msToRead(plain), MIN_CUE_MS);
    const ceiling = Math.min(
      c.start_ms + MAX_CUE_MS,
      Math.max(c.end_ms, nextStart - CUE_GAP_MS),
    );
    return { ...c, end_ms: Math.max(c.end_ms, Math.min(c.start_ms + want, ceiling)) };
  });
}

/**
 * The cues that still read too fast, which is the check doc 09 asks for.
 *
 * Returned rather than fixed. Somebody talking at 25 characters a second with
 * no pause after it cannot be captioned at 17 without cutting their words
 * down, and this product does not do that to a person's own speech.
 */
export function overTheLimit(cues: Cue[]): Cue[] {
  return cues.filter((c) => {
    const rate = cps(c.text.replace(/\n/g, " "), c.end_ms - c.start_ms);
    return rate !== null && rate > MAX_CPS;
  });
}

/**
 * Whether an export gets a subtitle file beside it.
 *
 * Doc 09: "a subtitle file alongside; no stacking on burned-in subtitles",
 * and "Shorts' burned-in captions are exempt from the sidecar rule — muted
 * viewing is a different medium". Burned-in captions are already on the
 * picture, so a sidecar would have the player draw a second copy over the
 * first on anybody who leaves subtitles on by default. "None" is a real
 * choice in the picker, not a missing value, and it is the case that wants
 * the sidecar most.
 */
export function sidecarWanted(captionStyle?: string | null): boolean {
  return !captionStyle || captionStyle === "None";
}
