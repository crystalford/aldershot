/**
 * WHAT'S IN YOUR ARCHIVE — the paragraph that was a count.
 *
 * CLAUDE.md names this one by name: "the archive summary was a count where a
 * paragraph goes". The risk in fixing it is the opposite mistake — a card
 * that opens the product with a confident sentence about somebody's own work
 * that is not true. So most of what is pinned here is what it REFUSES to
 * say.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { NAME_AT_MOST, archiveSentence, countLine, joinWords, realThreads } from "../src/archive.ts";

const T = (name: string, moments: number) => ({ name, moments });

test("an empty archive says nothing at all", () => {
  /* The card does not render. "0 videos read" is a sentence nobody needs on
     a page whose whole job is to get the first video in. */
  assert.equal(archiveSentence({ sources: 0, moments: 0, threads: [] }), "");
});

test("footage with no threads yet is still the count", () => {
  /*
   * An archive can genuinely be about nothing in particular, and one the
   * sweep has not reached yet looks exactly the same. Both get the count —
   * which is what the card said before there was anything else, and is true.
   */
  assert.equal(
    archiveSentence({ sources: 2, moments: 9, threads: [] }),
    "2 videos read · 9 moments",
  );
  assert.equal(archiveSentence({ sources: 1, moments: 1, threads: [] }), "1 video read · 1 moment");
});

test("threads are named in the person's own words, biggest first", () => {
  const line = archiveSentence({
    sources: 3,
    moments: 14,
    threads: [T("why leave", 5), T("what it costs", 4), T("the house", 3), T("landing it", 2)],
  });
  assert.equal(
    line,
    "4 threads run through 3 videos — why leave, what it costs, the house and landing it. " +
      "The one you come back to most is why leave, in 5 moments.",
  );
});

test("nobody comes back most to a thread that is tied for first", () => {
  /*
   * THE REFUSAL THAT MATTERS. Two threads with four moments each and the
   * sentence would pick whichever sorted first and call it the one you come
   * back to — a guess, in the product's opening sentence, about the thing
   * the person knows best.
   */
  const tied = archiveSentence({
    sources: 2,
    moments: 8,
    threads: [T("the house", 4), T("what it costs", 4)],
  });
  assert.match(tied, /^2 threads run through 2 videos — the house and what it costs\.$/);
  assert.ok(!/come back/.test(tied), "a tie is not somebody coming back to one of them");

  const clear = archiveSentence({
    sources: 2,
    moments: 8,
    threads: [T("the house", 5), T("what it costs", 4)],
  });
  assert.match(clear, /The one you come back to most is the house, in 5 moments\./);
});

test("one thread is one thread, not '1 threads run'", () => {
  assert.equal(
    archiveSentence({ sources: 1, moments: 6, threads: [T("the house", 6)] }),
    "One thread runs through 1 video: the house. The one you come back to most is the house, in 6 moments.",
  );
});

test("a long list stops being a list and says how many more", () => {
  const many = Array.from({ length: 9 }, (_, i) => T(`thread ${9 - i}`, 9 - i));
  const line = archiveSentence({ sources: 4, moments: 40, threads: many });
  assert.match(line, /^9 threads run through 4 videos — /);
  assert.match(line, /and 4 more\./, "the other four are counted, not listed");
  /* Counted on the LIST clause alone — the closing sentence names the top
     thread again, and counting the whole line would have made this assert
     six and pass whatever the cap was. */
  const list = line.slice(line.indexOf("— ") + 2, line.indexOf("."));
  assert.equal((list.match(/thread \d/g) ?? []).length, NAME_AT_MOST);
  assert.ok(list.endsWith("and 4 more"), list);
});

test("a thread with no moments or no name is not a thread", () => {
  /*
   * clip_count comes off a stored column, and a row whose moments were all
   * deleted keeps its count until the sweep reruns. Naming it would put a
   * thread on the front door that has nothing behind it.
   */
  const line = archiveSentence({
    sources: 2,
    moments: 4,
    threads: [T("the house", 3), T("", 2), T("gone", 0)],
  });
  assert.equal(line, "One thread runs through 2 videos: the house. The one you come back to most is the house, in 3 moments.");
});

test("every thread being empty falls back to the count, not to half a sentence", () => {
  assert.equal(
    archiveSentence({ sources: 2, moments: 4, threads: [T("", 0), T("gone", 0)] }),
    "2 videos read · 4 moments",
  );
});

test("the list reads as English", () => {
  assert.equal(joinWords([]), "");
  assert.equal(joinWords(["a"]), "a");
  assert.equal(joinWords(["a", "b"]), "a and b");
  assert.equal(joinWords(["a", "b", "c"]), "a, b and c");
  /* No Oxford comma: the copy is British and 15-DESIGN-LANGUAGE.md says
     "sentences someone would say". */
  assert.ok(!joinWords(["a", "b", "c"]).includes(", and"));
});

test("the title row's count is the list the paragraph names", () => {
  /*
   * Found by this test failing: the sentence dropped nameless and emptied
   * threads and the count did not, so an archive whose only thread had been
   * deleted read "2 videos read · 2 threads" over a paragraph with no
   * threads in it. Both go through the same filter now.
   */
  const f = { sources: 2, moments: 4, threads: [T("the house", 3), T("", 2), T("gone", 0)] };
  assert.equal(realThreads(f).length, 1);
  assert.match(countLine(f), /· 1 thread$/);
  assert.match(archiveSentence(f), /One thread runs through/);
});

test("the count line mentions threads only when there are some", () => {
  /* The same rule the clean-up chips follow: a number that cannot be
     computed honestly is not shown, and nought threads is not news. */
  assert.equal(countLine({ sources: 2, moments: 9, threads: [] }), "2 videos read · 9 moments");
  assert.equal(
    countLine({ sources: 2, moments: 9, threads: [T("a", 2)] }),
    "2 videos read · 9 moments · 1 thread",
  );
});
