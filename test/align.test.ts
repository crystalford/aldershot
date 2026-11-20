/**
 * Word addressing, and what a timestamp is worth.
 *
 * Every word in this product carries a start and an end, and nothing recorded
 * where those numbers came from. They come from a recogniser, accurate to
 * about a tenth of a second — roughly three frames at 25fps — which is fine
 * for finding a moment and wrong for cutting on one.
 *
 * The failure this guards is the quietest in the codebase: forced alignment
 * MOVES those numbers, so a moment pinned to milliseconds is pinned to
 * something that is going to change under it. A word span survives, because
 * re-aligning changes when a word is and never which word it is.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FRAME_MS, TOLERANCE_MS, frameAccurate, indexWords, spanFor, timingFor, timingOf } from "../src/align.ts";

/** Seconds in storage, milliseconds everywhere else — src/cuts.ts's landmine. */
const parse = (json: string | null) => (json ? (JSON.parse(json) as Array<{ w: string; s: number; e: number }>) : []);

const SEGS = [
  { idx: 0, words: JSON.stringify([{ w: "the", s: 0, e: 0.3 }, { w: "first", s: 0.3, e: 0.7 }]) },
  { idx: 1, words: JSON.stringify([{ w: "four", s: 1.0, e: 1.4 }, { w: "weeks", s: 1.4, e: 2.0 }]) },
];

test("a recogniser timing is not frame accurate, and says so", () => {
  /*
   * TODAY EVERY SOURCE FAILS THIS, which is a true statement about the
   * product rather than a bug in the function. The point of writing it down
   * is that anything promising frame accuracy can refuse, instead of quietly
   * doing the wrong thing with numbers that were never that precise.
   */
  assert.equal(frameAccurate(timingOf("recogniser")), false);
  assert.equal(frameAccurate(timingOf("forced")), true);
  assert.ok(TOLERANCE_MS.recogniser > FRAME_MS * 2, "a recogniser timing spans more than two frames");
  assert.ok(TOLERANCE_MS.forced <= FRAME_MS);
  /*
   * THE COLUMN IS READ NOW, and null still means recogniser: every row
   * written before the column existed really does carry recogniser timings,
   * and nothing backfilled them.
   */
  assert.equal(timingFor({ timing_source: null }).source, "recogniser");
  assert.equal(timingFor({}).source, "recogniser", "a row read without the column is not a promise");
  assert.equal(timingFor({ timing_source: "forced" }).source, "forced");
  assert.equal(timingFor({ timing_source: "caption" }).source, "caption");
  /* A value nobody recognises is recogniser, which is the cautious
     direction: read as `forced` it would let a cut land on a frame using
     timings nothing has checked. */
  assert.equal(timingFor({ timing_source: "aligned-ish" }).source, "recogniser");
  assert.equal(frameAccurate(timingFor({ timing_source: "forced" })), true);
  assert.equal(frameAccurate(timingFor({ timing_source: "nonsense" })), false);
});

test("words are numbered across segments, in segment order", () => {
  /*
   * The numbering IS the address, so it has to be derived the same way every
   * time. Anything that changes the order renumbers the source and
   * invalidates every span pointing into it — silently, because the spans
   * stay valid-looking integers.
   */
  const words = indexWords(SEGS, parse);
  assert.deepEqual(words.map((w) => w.text), ["the", "first", "four", "weeks"]);
  assert.deepEqual(words.map((w) => w.index), [0, 1, 2, 3]);

  /* Out-of-order rows must not renumber it. */
  const shuffled = indexWords([SEGS[1], SEGS[0]], parse);
  assert.deepEqual(shuffled.map((w) => w.text), ["the", "first", "four", "weeks"]);
});

test("seconds become milliseconds here, once", () => {
  /* The landmine: `s` and `e` are SECONDS while the segment's own start_ms in
     the same row is milliseconds. A runtime built from these as if they were
     milliseconds once reported 59 minutes for a 2-minute video. */
  const words = indexWords(SEGS, parse);
  assert.equal(words[0].startMs, 0);
  assert.equal(words[0].endMs, 300);
  assert.equal(words[3].endMs, 2000);
});

test("a span covers every word the range touches, not only whole ones", () => {
  /*
   * A range whose edge lands mid-word was always going to PLAY that word, so
   * a span that excluded it would describe a different moment from the one
   * the user watched — and the two would drift apart the first time anything
   * read the span instead of the milliseconds.
   */
  const words = indexWords(SEGS, parse);
  assert.deepEqual(spanFor(words, 0, 2000), { startWord: 0, endWord: 3 });
  assert.deepEqual(spanFor(words, 1000, 2000), { startWord: 2, endWord: 3 });
  /* 500ms is inside "first" (300–700) only — a partial overlap counts. */
  assert.deepEqual(spanFor(words, 500, 900), { startWord: 1, endWord: 1 });
  /* 2.0s–3.0s is past the last word's end, so it touches nothing. */
  assert.equal(spanFor(words, 2000, 3000), null);
});

test("a source with no words has no address, and that is not an error", () => {
  /*
   * A failed transcript, or one stored before word timings were kept. The
   * milliseconds stay what they have always been — the moment simply has no
   * address yet, and null is how a row says so.
   */
  assert.equal(spanFor([], 0, 1000), null);
  assert.equal(spanFor(indexWords([{ idx: 0, words: null }], parse), 0, 1000), null);
  assert.equal(spanFor(indexWords(SEGS, parse), 1000, 1000), null, "an empty range addresses nothing");
});

test("moments are saved with their span, at the one moment it is cheap", () => {
  /*
   * At scoring time the transcript is already in hand. Working the span out
   * later would mean re-reading every segment of every source to address
   * moments that were saved without one — and the address has to exist
   * BEFORE the timings move, or every moment saved today is unanchorable
   * tomorrow.
   */
  const src = readFileSync(join(import.meta.dirname, "..", "src", "projects.ts"), "utf8");
  const save = src.slice(src.indexOf("export async function saveClips"));
  /*
   * Up to the INSERT, which is the statement this claim is about.
   *
   * This read to the first `await db.batch`, and saveClips grew an earlier
   * batch — the UPDATE that annotates a moment the read already laid down —
   * so the window closed before the lines below and the test failed about
   * code that had not changed. The row construction is what has to carry the
   * span; the INSERT is where that ends, whatever else runs first.
   */
  const upto = save.slice(0, save.indexOf("INSERT INTO v2_clips"));
  assert.match(upto, /indexWords\(segs \?\? \[\], parseWords\)/, "numbered from this source's own segments");
  assert.match(upto, /start_word: spanFor\(/);
  assert.match(upto, /end_word: spanFor\(/);
});
