/**
 * ATTRIBUTION: whose footage this is, said on screen and in the file.
 *
 * Spec 18 section 6. Written AT VERIFY TIME, which is the part that makes it
 * true rather than polite: a credit written when the clip is placed is a
 * credit somebody can forget to write; one written when the quote is verified
 * cannot be, because the verification is what produced the row it hangs on.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CREDIT_HOLD_S,
  clipMetadata,
  creditDate,
  creditFor,
  editCredit,
  renderSourceList,
  sourceList,
  unavailable,
  type Credit,
  type Source,
} from "../src/scout-credit.ts";

const JAN = Date.parse("2024-01-14T00:00:00Z");
const MAR = Date.parse("2024-03-02T00:00:00Z");

const stream: Source = {
  id: "s1",
  channel: "DarksydePhil",
  platform: "YouTube",
  publishedAt: JAN,
  url: "https://www.youtube.com/watch?v=abc12345678",
  kind: "vod",
};

const compilation: Source = {
  id: "s2",
  channel: "The Khan Compilation",
  platform: "YouTube",
  publishedAt: MAR,
  url: "https://www.youtube.com/watch?v=zzz99999999",
  kind: "compilation",
};

const verified = { ledgerId: "l1", verify: "verified" as const };

/* ── The credit line ────────────────────────────────────────────────────── */

test("the credit is channel, platform and date, in that order", () => {
  const c = creditFor(verified, stream)!;
  assert.equal(c.text, "Source: DarksydePhil · YouTube · Jan 2024");
  assert.equal(c.url, stream.url);
  assert.equal(c.via, null);
  assert.equal(c.removed, false);
  assert.equal(c.edited, false);
  /* The spec's 3–4 s hold. */
  assert.ok(CREDIT_HOLD_S >= 3 && CREDIT_HOLD_S <= 4);
});

test("ACCEPTANCE: the person who SAID it comes first; the compilation is a via", () => {
  /*
   * THE ORDER IS THE ARGUMENT. The words are the speaker's; the compilation
   * carried them. Writing it the other way round credits the clipper for
   * somebody else's sentence — and it is the mistake a naive implementation
   * makes, because the compilation is the row Scout actually found and so the
   * one nearest to hand.
   */
  const c = creditFor(verified, compilation, stream)!;
  assert.equal(c.text, "Source: DarksydePhil · YouTube · Jan 2024 · via The Khan Compilation");
  assert.equal(c.via, "The Khan Compilation");
  /* The date is the ORIGINAL's, not the compilation's: when it was said, not
     when somebody re-posted it. */
  assert.ok(!/Mar 2024/.test(c.text), c.text);
});

test("ACCEPTANCE: the link goes to the original, not the clip of it", () => {
  /* "Find out for yourself" should land on the thing that was said. */
  const c = creditFor(verified, compilation, stream)!;
  assert.equal(c.url, stream.url);
  assert.notEqual(c.url, compilation.url);
});

test("an untraced compilation credits itself, because there is nothing else to credit", () => {
  /*
   * Inventing a chain would credit a stream nobody has found. Until the trace
   * seed finds the original, the compilation is honestly what we have.
   */
  const c = creditFor(verified, compilation)!;
  assert.equal(c.text, "Source: The Khan Compilation · YouTube · Mar 2024");
  assert.equal(c.via, null);
  assert.equal(c.url, compilation.url);
});

test("ACCEPTANCE: nothing is written for an unverified row", () => {
  /*
   * A credit is a claim about where words came from, and a quote nobody has
   * checked against its source has no such claim to make. "At verify time" is
   * a rule about WHETHER, not only about when.
   */
  assert.equal(creditFor({ ledgerId: "l1", verify: "paraphrase" }, stream), null);
  assert.equal(creditFor({ ledgerId: "l1", verify: "rejected" }, stream), null);
  assert.ok(creditFor({ ledgerId: "l1", verify: "verified" }, stream));
});

test("a source with no date still gets a credit", () => {
  /* A feed that publishes no pubDate. The channel and the platform are the
     parts somebody is owed; the date is the part that is nice to have. */
  const c = creditFor(verified, { ...stream, publishedAt: undefined })!;
  assert.equal(c.text, "Source: DarksydePhil · YouTube");
  assert.ok(!/ · $/.test(c.text), "no trailing separator where the date would be");
});

test("the date is a month, which is what a credit line carries", () => {
  assert.equal(creditDate(JAN), "Jan 2024");
  assert.equal(creditDate(MAR), "Mar 2024");
  assert.equal(creditDate(undefined), "");
  assert.equal(creditDate(Number.NaN), "");
});

/* ── Editing and removal ────────────────────────────────────────────────── */

test("ACCEPTANCE: removal is a toggle, never a delete", () => {
  /*
   * Invariant 6, and the reason it bites here: "there was no credit" and
   * "somebody took the credit off" are different facts about a video, and
   * only one of them is a defence. The row stays so the dispute file can say
   * which happened.
   */
  const c = creditFor(verified, stream)!;
  const off = editCredit(c, { removed: true });
  assert.equal(off.removed, true);
  assert.equal(off.text, c.text, "the text survives being taken off screen");
  assert.equal(off.ledgerId, c.ledgerId);

  const back = editCredit(off, { removed: false });
  assert.equal(back.removed, false);
});

test("an edited credit says it was edited; an unchanged one does not", () => {
  /* The automatic text is still recoverable from the rows, so the flag is
     what says a human has been here. */
  const c = creditFor(verified, stream)!;
  assert.equal(editCredit(c, { text: "Source: Phil, 2024" }).edited, true);
  assert.equal(editCredit(c, { text: c.text }).edited, false, "setting it to what it was is not an edit");
  assert.equal(editCredit(c, { removed: true }).edited, false, "taking it off is not editing it");
});

/* ── The description list ───────────────────────────────────────────────── */

const at = (c: Credit, atMs: number) => ({ ...c, atMs });

test("the source list is in timeline order, with a timestamp to skip to", () => {
  const a = at(creditFor(verified, stream)!, 84_000);
  const b = at(creditFor({ ledgerId: "l2", verify: "verified" }, compilation)!, 12_000);
  const list = sourceList([a, b]);

  assert.deepEqual(list.map((e) => e.atMs), [12_000, 84_000]);
  assert.match(renderSourceList(list), /^Sources\n0:12 — Source: The Khan Compilation/);
  assert.match(renderSourceList(list), /\n1:24 — Source: DarksydePhil · YouTube · Jan 2024 — https:/);
});

test("ACCEPTANCE: a removed credit is left out of the list, and its row survives", () => {
  /*
   * It was taken off on purpose, so it does not go in the description. The
   * row is still there — this is a view, not a delete.
   */
  const a = at(creditFor(verified, stream)!, 1000);
  const off = at(editCredit(creditFor({ ledgerId: "l2", verify: "verified" }, compilation)!, { removed: true }), 2000);

  const list = sourceList([a, off]);
  assert.equal(list.length, 1);
  assert.equal(list[0].text, a.text);
  /* And the removed one is still a row with its text intact. */
  assert.equal(off.removed, true);
  assert.ok(off.text.length > 10);
});

test("an hour-long video stamps its sources with hours", () => {
  const long = at(creditFor(verified, stream)!, 5_070_000);
  assert.match(renderSourceList(sourceList([long])), /1:24:30 — /);
});

test("no credits is no list, not an empty heading", () => {
  assert.equal(renderSourceList([]), "");
  assert.deepEqual(sourceList([]), []);
});

/* ── Surviving the export ───────────────────────────────────────────────── */

test("ACCEPTANCE: the credit rides along in the clip's metadata", () => {
  /*
   * "so it survives export" is a specific fear: a cut opened in somebody
   * else's editor, finished there, and published with the credits lost in the
   * handover. The timeline carries them, so a clip can be moved and still say
   * whose it is.
   */
  const c = creditFor(verified, compilation, stream)!;
  const meta = clipMetadata(c, { quote: "get out of my chat", sourceInS: 5070, verifiedAt: 1_700_000_000_000 })!;

  assert.equal(meta.aldershot.credit, "Source: DarksydePhil · YouTube · Jan 2024 · via The Khan Compilation");
  assert.equal(meta.aldershot.url, stream.url);
  assert.equal(meta.aldershot.via, "The Khan Compilation");
  assert.equal(meta.aldershot.quote, "get out of my chat");
  /* Seconds into the SOURCE, not the timeline — the number that lets anybody
     go and check. */
  assert.equal(meta.aldershot.sourceInS, 5070);
  assert.equal(meta.aldershot.ledgerId, "l1");
});

test("ACCEPTANCE: a removed credit is not exported back onto the timeline", () => {
  /*
   * A person took it off deliberately. Exporting it anyway puts back on the
   * timeline what they removed from the screen, and the next editor sees it.
   */
  const off = editCredit(creditFor(verified, stream)!, { removed: true });
  assert.equal(clipMetadata(off, { quote: "q", sourceInS: 1, verifiedAt: 1 }), null);
});

/* ── When a source goes away ────────────────────────────────────────────── */

test("ACCEPTANCE: a credit whose source was taken down stays, and says so", () => {
  /*
   * The words were still said, and the receipt is still a receipt — a
   * transcript, a time, a date. Dropping the credit would quietly turn a
   * cited clip into an uncited one at the moment somebody most wants to
   * check it.
   */
  const gone = unavailable(creditFor(verified, stream)!);
  assert.match(gone.text, /^Source: DarksydePhil · YouTube · Jan 2024/);
  assert.match(gone.text, /no longer available at the source/);
  assert.equal(gone.removed, false, "a source going away is not a removal");
  assert.equal(gone.url, stream.url, "and the link stays, so the takedown is checkable too");
});
