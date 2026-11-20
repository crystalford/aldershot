/**
 * MOMENTS ON READ — the line that makes a library a library.
 *
 * A moment used to exist only where a brief had run a score pass: upload an
 * hour, say nothing about it, and you had a transcript and nothing to
 * retrieve. The accumulating-pool premise the whole product rests on was not
 * true of the implementation.
 *
 * Two claims are pinned here. The spans are the transcript's own and cost no
 * model call; and a score pass ANNOTATES them rather than being deduped into
 * nothing — which, if it were wrong, would make every pass produce an empty
 * cut, because begin.ts turns what saveClips returns into the cut.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { momentSpans, MIN_MS, MAX_MS } from "../src/moments.ts";
import type { Segment } from "../src/sources.ts";

let n = 0;
const seg = (start_ms: number, end_ms: number, text: string): Segment => ({
  id: "s" + ++n,
  source_id: "src1",
  idx: n,
  start_ms,
  end_ms,
  speaker: null,
  text,
  words: null,
});

/** Sentences of `each` ms, all ending in a full stop. */
const run = (count: number, each: number, word = "Something happened here.") =>
  Array.from({ length: count }, (_, i) => seg(i * each, (i + 1) * each, word));

test("a moment is not a line: nothing closes before the floor", () => {
  /* Six five-second sentences. A break at the first full stop would give six
     five-second moments, which is a transcript with extra steps. */
  const spans = momentSpans(run(6, 5_000));
  for (const s of spans) {
    assert.ok(
      s.end_ms - s.start_ms >= MIN_MS,
      `a ${(s.end_ms - s.start_ms) / 1000}s moment got through the floor`,
    );
  }
  assert.ok(spans.length >= 1);
});

test("and not two points: nothing runs past the ceiling", () => {
  /* Thirty seconds of unpunctuated speech per segment, so only the ceiling
     can break it. */
  const spans = momentSpans(run(10, 30_000, "and then and then and then"));
  assert.ok(spans.length > 1, "it never broke at all");
  for (const s of spans.slice(0, -1)) {
    assert.ok(
      s.end_ms - s.start_ms <= MAX_MS + 30_000,
      "a span ran away past the ceiling by more than one segment",
    );
  }
});

test("ACCEPTANCE: it breaks where the sentence ends, not where the clock says", () => {
  /*
   * Eight seconds a segment. Past the 20s floor the next full stop closes it,
   * so the boundary lands at 24s — the end of a sentence — and not at 20.
   */
  const spans = momentSpans(run(6, 8_000));
  assert.equal(spans[0].start_ms, 0);
  assert.equal(spans[0].end_ms, 24_000, "the break was not at a sentence end");
  assert.equal(spans[0].quote, "Something happened here. Something happened here. Something happened here.");
});

test("a clause that never finishes is still broken, at the ceiling", () => {
  const spans = momentSpans([seg(0, 15_000, "no stop here"), seg(15_000, 70_000, "nor here")]);
  assert.equal(spans.length, 1, "a 70s run of two segments is one span, closed at the ceiling");
  assert.equal(spans[0].end_ms, 70_000);
});

test("ACCEPTANCE: the tail joins the moment before it rather than becoming an orphan", () => {
  /*
   * A video ends where it ends, not where a sentence does, so the last run is
   * routinely a few seconds. A four-second moment in the library is something
   * to scroll past; the same words on the end of the thought before them are
   * the rest of the thought.
   */
  const spans = momentSpans([...run(3, 8_000), seg(24_000, 27_000, "Oh and one more thing.")]);
  assert.equal(spans.length, 1, "the three-second tail became its own moment");
  assert.equal(spans[0].end_ms, 27_000, "the tail's words are not in the span");
  assert.match(spans[0].quote, /one more thing/);
});

test("a short source is one moment, not none", () => {
  const spans = momentSpans(run(2, 4_000));
  assert.equal(spans.length, 1);
  assert.equal(spans[0].start_ms, 0);
  assert.equal(spans[0].end_ms, 8_000);
});

test("ACCEPTANCE: nothing here has an opinion — no score, no heat, no reason", () => {
  /*
   * Invariant 3. A made-up score is the invented number the whole product
   * keeps away from people, and a span the transcript drew has no view about
   * whether the material is any good. ScoredClip already documents null as
   * the hand-picked case.
   */
  for (const s of momentSpans(run(6, 8_000))) {
    assert.equal(s.score, null, "a score was invented");
    assert.equal(s.heat, null, "a heat was invented");
    assert.equal(s.why, null, "a reason was invented");
  }
});

test("the quote is the transcript's words, joined, and nothing else", () => {
  const spans = momentSpans([
    seg(0, 11_000, "  First thing said.  "),
    seg(11_000, 22_000, "Second thing said."),
  ]);
  assert.equal(spans[0].quote, "First thing said. Second thing said.");
});

test("an empty transcript is no moments rather than a throw", () => {
  assert.deepEqual(momentSpans([]), []);
  assert.deepEqual(momentSpans([seg(0, 5_000, "   ")]), []);
});

test("ACCEPTANCE: a moment never ends in silence", () => {
  /*
   * THE FIRST VERSION OF THIS TEST PINNED NOTHING.
   *
   * It fed an empty segment between two spoken ones and asserted the quote
   * read correctly — which `close` guarantees on its own, because it filters
   * empty text before joining. Deleting the loop's skip entirely changed
   * nothing, so the test passed about code that was no longer there.
   *
   * What the skip actually prevents is a span whose END comes from silence.
   * An empty segment still carries a start and an end, so a run closed just
   * after one takes its end_ms from the silence: here, thirty-five seconds of
   * nothing on the back of a thirty-second moment. The quote would have read
   * perfectly and the moment would have been more than half dead air.
   */
  const spans = momentSpans([
    seg(0, 30_000, "a long stretch with no full stop in it"),
    seg(30_000, 65_000, ""),
  ]);
  assert.equal(spans.length, 1);
  assert.equal(spans[0].end_ms, 30_000, "the moment ran on into the silence after it");
  assert.equal(spans[0].quote, "a long stretch with no full stop in it");
});

test("a silent segment between two spoken ones is not in the quote", () => {
  const spans = momentSpans([
    seg(0, 11_000, "First thing said."),
    seg(11_000, 12_000, ""),
    seg(12_000, 23_000, "Second thing said."),
  ]);
  assert.equal(spans.length, 1);
  assert.equal(spans[0].quote, "First thing said. Second thing said.");
});

test("the two numbers come from the reference engine, not from taste", () => {
  /*
   * design/one-take/footage.js is the behavioural spec and its fourteen
   * moments run 29–47s. The floor and ceiling have to contain that range or
   * they are not describing the same object.
   */
  assert.ok(MIN_MS <= 29_000, "the floor excludes the reference engine's shortest moment");
  assert.ok(MAX_MS >= 47_000, "the ceiling excludes the reference engine's longest moment");
});

test("ACCEPTANCE: a zero-length segment with words in it is not a moment", () => {
  /*
   * THE SECOND GUARD, pinned where it lives.
   *
   * Whisper's classic hallucination over a closing shot is "Thank you for
   * watching" with start === end. In the read pipeline saveSegments drops it
   * first (saidAloud), so test/fill-library.test.ts cannot see this guard at
   * all — deleting it failed nothing there. Both guards exist; each needs
   * pinning by the test that can actually reach it.
   */
  const spans = momentSpans([
    seg(0, 11_000, "A real sentence."),
    seg(11_000, 22_000, "Another real sentence."),
    seg(22_000, 22_000, "Thank you for watching."),
  ]);
  assert.equal(spans.length, 1);
  assert.ok(!spans[0].quote.includes("Thank you for watching"), "a zero-length segment reached a moment");
  assert.equal(spans[0].end_ms, 22_000);
});
