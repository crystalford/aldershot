/**
 * RECEIPTS, FOR THE PERSON WATCHING.
 *
 * Doc 09 calls this "a promise to the audience, not just the maker", which
 * makes it the only thing this product puts on the public web. Half of these
 * are about what must NOT be on it, and about text written by other people
 * landing in HTML served from this origin.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { esc, isChecked, receiptsHtml, receiptsPage, safeUrl, verifiedSays } from "../src/receipts.ts";
import { disputeEntries, type DisputeClip } from "../src/dispute.ts";
import { cueSheet } from "../src/cuesheet.ts";

const clip = (over: Partial<DisputeClip> = {}): DisputeClip => ({
  ledgerId: "l1",
  channel: "Council Live",
  sourceTitle: "Full council meeting",
  platform: "youtube",
  url: "https://example.org/watch?v=abc",
  inS: 1200,
  outS: 1214,
  originalS: 4800,
  credit: "Source: Council Live",
  creditRemoved: false,
  verify: "verified",
  quote: "We moved the launch before the review came in.",
  ...over,
});

const page = (over: Partial<Parameters<typeof receiptsPage>[0]> = {}) =>
  receiptsPage({
    title: "Whether to leave",
    claim: null,
    external: disputeEntries([clip()]),
    pictures: [],
    ...over,
  });

test("the four verification states each read as a sentence", () => {
  /* Written for somebody who has never heard of Scout and is here because
     they doubt something. */
  assert.match(verifiedSays("verified"), /Checked word for word/);
  assert.match(verifiedSays("paraphrase"), /not word for word/);
  assert.match(verifiedSays("rejected"), /Could not be matched/);
  assert.match(verifiedSays(null), /Nobody checked this/);
  assert.equal(new Set(["verified", "paraphrase", "rejected", null].map(verifiedSays)).size, 4);
});

test("ACCEPTANCE: only a word-for-word match counts as checked", () => {
  /*
   * The page's one number is "N of M checked", and it is the thing a sceptical
   * viewer reads first. A paraphrase counted as checked would be this product
   * vouching for words nobody matched.
   */
  assert.equal(isChecked("verified"), true);
  for (const v of ["paraphrase", "rejected", null, undefined, ""]) {
    assert.equal(isChecked(v as string), false, `${v} counted as checked`);
  }
  const p = page({
    external: disputeEntries([clip(), clip({ ledgerId: "l2", verify: "paraphrase" })]),
  });
  assert.equal(p.checked, 1);
  assert.match(receiptsHtml(p), /1 of 2 has been checked word for word/);
});

test("ACCEPTANCE: every receipt carries the original, or says there is none", () => {
  const html = receiptsHtml(page());
  assert.match(html, /Go and watch it yourself/);
  assert.match(html, /https:\/\/example\.org\/watch\?v=abc/);

  const none = receiptsHtml(page({ external: disputeEntries([clip({ url: null })]) }));
  assert.match(none, /No link was recorded for this one/);
  assert.doesNotMatch(none, /Go and watch it yourself/);
});

test("a javascript: url never reaches an href", () => {
  /*
   * These urls come from rows Scout wrote about other people's websites and
   * they land in an href on a page served from THIS origin. The gap between
   * writing that and noticing it is measured in months.
   */
  for (const bad of ["javascript:alert(1)", "data:text/html,<script>", "vbscript:x", "  javascript:alert(1)"]) {
    assert.equal(safeUrl(bad), null, `${bad} survived`);
    const html = receiptsHtml(page({ external: disputeEntries([clip({ url: bad })]) }));
    assert.doesNotMatch(html, /javascript:|vbscript:|data:text/i);
    assert.match(html, /No link was recorded/);
  }
  assert.ok(safeUrl("https://example.org/a"));
  assert.ok(safeUrl("http://example.org/a"));
  assert.equal(safeUrl("not a url at all"), null);
});

test("somebody else's words cannot write HTML on this page", () => {
  /* A quote is text from another person's video, on a public page, on our
     origin. It is escaped everywhere it appears. */
  const nasty = `</blockquote><script>fetch('/api/projects')</script>`;
  const html = receiptsHtml(
    page({ external: disputeEntries([clip({ quote: nasty, channel: `<img src=x onerror=alert(1)>` })]) }),
  );
  assert.doesNotMatch(html, /<script>fetch/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;script&gt;/);
  assert.equal(esc(`<&">`), "&lt;&amp;&quot;&gt;");
});

test("ACCEPTANCE: the maker's own material is not on the page", () => {
  /*
   * This is the line that decides whether publishing it is safe. The
   * manifest has the rules, the left-out lines and every source; none of
   * that belongs in front of strangers. What is here is what was quoted
   * from other people.
   */
  const html = receiptsHtml(page());
  for (const leak of ["Start from everything you have", "struck", "leftOut", "rule 1", "Tuesday — the kitchen one"]) {
    assert.ok(!html.includes(leak), `the page leaked "${leak}"`);
  }
  /* And it says what it is not, so a viewer does not over-read it. */
  assert.match(html, /cannot tell you whether a quote is fair/);
  assert.match(html, /does not list the\s+maker's own footage/);
});

test("a cut with nothing quoted says so, rather than showing an empty page", () => {
  const html = receiptsHtml(page({ external: [] }));
  assert.match(html, /Every clip in this video is the maker's own footage/);
  assert.doesNotMatch(html, /Where each quote came from/);
});

test("the claim is shown where there is one", () => {
  const html = receiptsHtml(page({ claim: "Leaving is a trade, not an escape." }));
  assert.match(html, /Leaving is a trade, not an escape\./);
  assert.doesNotMatch(receiptsHtml(page()), /class="claim"/);
});

test("generated pictures are declared to the viewer too", () => {
  /* The on-screen label is for the person watching the video; this is for
     the person who came to check it afterwards. */
  const html = receiptsHtml(
    page({ pictures: cueSheet([{ id: "b", kind: "generated", text: "A map of the two streets" }]) }),
  );
  assert.match(html, /Pictures that are not footage/);
  assert.match(html, /Generated/);
  assert.match(html, /A map of the two streets/);
});

test("the page asks not to be indexed, and loads nothing from anywhere", () => {
  /*
   * A receipts page is for somebody who followed a link, not for a search
   * result about the person being quoted. And no script and no remote font:
   * it is read once, often on a phone, by somebody who may change their mind.
   */
  const html = receiptsHtml(page());
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /https?:\/\/fonts\./);
  assert.ok(!/src="https?:/.test(html), "it fetches something from another origin");
});

test("it reads in both light and dark, because a link opens anywhere", () => {
  const html = receiptsHtml(page());
  assert.match(html, /prefers-color-scheme: light/);
  assert.match(html, /color-scheme: dark light/);
});
