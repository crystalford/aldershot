/**
 * THE DISPUTE FILE.
 *
 * Phase 6 accepts on one sentence: "the dispute file lists every external clip
 * with fraction used". Doc 09 asks for more than that — source, timestamp,
 * fraction, commentary-to-clip ratio, the attribution written — and says the
 * whole thing is assembled as the video is made rather than after a claim.
 *
 * The figures are the point. Every one of them is either measured from two
 * numbers printed beside it, or reported as not known. There is no third
 * option in here, because the one thing a document like this cannot do is
 * carry a number somebody cannot check.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attributionLine,
  clock,
  commentary,
  disputeEntries,
  disputeText,
  fractionUsed,
  usedSeconds,
  type DisputeClip,
} from "../src/dispute.ts";

const clip = (over: Partial<DisputeClip> = {}): DisputeClip => ({
  ledgerId: "l1",
  channel: "Council Live",
  sourceTitle: "Full council meeting, 12 March",
  platform: "youtube",
  url: "https://example.org/watch?v=abc",
  inS: 1200,
  outS: 1214,
  originalS: 4800,
  credit: "Source: Council Live · youtube · Mar 2026",
  creditRemoved: false,
  quote: "We moved the launch before the review came in.",
  ...over,
});

test("m:ss, and h:mm:ss once there is an hour in it", () => {
  assert.equal(clock(0), "0:00");
  assert.equal(clock(14), "0:14");
  assert.equal(clock(95), "1:35");
  assert.equal(clock(3600), "1:00:00");
  assert.equal(clock(4814), "1:20:14");
  assert.equal(clock(-5), "0:00", "a negative duration is not a negative clock");
});

test("ACCEPTANCE: every external clip is listed, with the fraction used", () => {
  const entries = disputeEntries([
    clip(),
    clip({ ledgerId: "l2", channel: "Other Channel", inS: 60, outS: 90, originalS: 600 }),
  ]);
  assert.equal(entries.length, 2, "every clip");
  assert.equal(entries[0].usedS, 14);
  assert.equal(entries[0].fraction, 14 / 4800);
  assert.equal(entries[1].fraction, 30 / 600);

  const text = disputeText(entries, commentary(600, 44), "Whether to leave");
  assert.match(text, /Council Live/);
  assert.match(text, /Other Channel/);
  /* The fraction, and the two numbers it was divided from, so it can be
     checked rather than believed. */
  assert.match(text, /0:14 of 1:20:00 — 0\.29% of the original/);
  assert.match(text, /0:30 of 10:00 — 5\.0% of the original/);
});

test("an unknown original length is said, never guessed", () => {
  /*
   * Scout stores a duration where the platform reported one. Printing 0%
   * would understate the take and 100% would overstate it, and both would be
   * this document inventing the one figure it exists to report.
   */
  assert.equal(fractionUsed(14, null), null);
  assert.equal(fractionUsed(14, 0), null);
  const text = disputeText(disputeEntries([clip({ originalS: null })]), commentary(600, 14), "x");
  assert.match(text, /0:14 used\. The original's length is not known/);
  assert.doesNotMatch(text, /% of the original/, "no fraction is printed at all");
});

test("a clip longer than its original clamps rather than reading 300%", () => {
  /* A data error either way, and an impossible figure invites somebody to
     dismiss the rest of the file. */
  assert.equal(fractionUsed(900, 300), 1);
  assert.equal(usedSeconds({ inS: 90, outS: 60 }), 0, "and a backwards span is zero, not negative");
});

test("written, removed, and never written are three different facts", () => {
  /*
   * src/scout-credit.ts says it at editCredit: "'There was no credit' and
   * 'somebody took the credit off' are different facts about a video and only
   * one of them is a defence". This is the place that was written for.
   */
  const written = attributionLine({ credit: "Source: Council Live", creditRemoved: false });
  const removed = attributionLine({ credit: "Source: Council Live", creditRemoved: true });
  const never = attributionLine({ credit: null, creditRemoved: false });

  assert.match(written, /On screen/);
  assert.match(removed, /WRITTEN AND THEN REMOVED/);
  assert.match(removed, /deliberately/);
  assert.match(never, /None written/);
  assert.equal(new Set([written, removed, never]).size, 3, "three states, three sentences");
});

test("the ratio warns below one to one, and only when there is other footage", () => {
  const plenty = commentary(600, 100);
  assert.equal(plenty.ownS, 500);
  assert.equal(plenty.ratio, 5);
  assert.equal(plenty.thin, false);

  const thin = commentary(100, 60);
  assert.equal(thin.ratio, 40 / 60);
  assert.equal(thin.thin, true);

  /* A cut entirely of your own footage has no ratio to be on the wrong side
     of, and warning about one would be the document crying wolf. */
  const mine = commentary(600, 0);
  assert.equal(mine.ratio, null);
  assert.equal(mine.thin, false);
});

test("an unmeasurable runtime says so rather than reading nought to one", () => {
  /* Same rule as the fraction: the worst possible answer and no answer at all
     must not look identical. */
  const c = commentary(null, 60);
  assert.equal(c.ownS, null);
  assert.equal(c.ratio, null);
  assert.equal(c.thin, false, "an unknown runtime is not evidence of a thin cut");
  const text = disputeText(disputeEntries([clip()]), c, "x");
  assert.match(text, /Your own footage: not measured/);
  assert.match(text, /runtime is not known, so there is no ratio/);
  assert.doesNotMatch(text, /MORE OF THEIRS THAN YOURS/);
});

test("the warning appears, in the maker's interest, when the cut is thin", () => {
  const text = disputeText(disputeEntries([clip()]), commentary(100, 60), "x");
  assert.match(text, /MORE OF THEIRS THAN YOURS/);
  assert.match(text, /criticism and comment/, "and says why it matters");
});

test("a cut with nothing of anyone else's gets a file that says so", () => {
  const text = disputeText([], commentary(600, 0), "Four weeks in");
  assert.match(text, /Four weeks in/);
  assert.match(text, /every clip in this cut is the maker's own footage/);
});

test("the file says what it is not", () => {
  /* Doc 09: have a media lawyer review before commercial publication. A
     document that reads as a ruling is worse than no document. */
  const text = disputeText(disputeEntries([clip()]), commentary(600, 14), "x");
  assert.match(text, /not legal advice/i);
  assert.match(text, /cannot tell you what is fair/i);
  assert.match(text, /media lawyer/i);
});

test("every clip carries where it came from and where in it", () => {
  const text = disputeText(disputeEntries([clip()]), commentary(600, 14), "x");
  assert.match(text, /https:\/\/example\.org\/watch\?v=abc/, "the link a viewer would check");
  assert.match(text, /20:00–20:14 of the original/, "and the timestamp inside it");
  assert.match(text, /We moved the launch before the review came in/, "and the words");
});

test("a missing link or platform is named as missing, not left blank", () => {
  /* A blank line in a document like this reads as an oversight. Saying "no
     link recorded" says the row is complete and the fact is absent. */
  const text = disputeText(
    disputeEntries([clip({ url: null, platform: null, channel: null, sourceTitle: null })]),
    commentary(600, 14),
    "x",
  );
  assert.match(text, /no link recorded/);
  assert.match(text, /Platform: not recorded/);
  assert.match(text, /Unknown source/);
});
