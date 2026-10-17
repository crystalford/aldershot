/**
 * THE XML READER, and the four things that break a naive one.
 *
 * There is no DOMParser in Workers and Scout's two keyless adapters both
 * speak RSS, so the choice was a dependency or forty lines. Regex on XML is a
 * known trap, and this is not a general parser — it reads a known shape. What
 * it has to get right is the list below, every item of which is in a real
 * feed on the wire today.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { attr, decodeEntities, tags, text, unwrap } from "../src/xml.ts";

/* ── Entities ───────────────────────────────────────────────────────────── */

test("ACCEPTANCE: the ampersand decodes last, or a double-escape decodes twice", () => {
  /*
   * "&amp;lt;" is the correct way to write the literal text "&lt;". Decoding
   * "&amp;" first turns it into "&lt;", and the next pass turns THAT into
   * "<" — so a description quoting XML comes out as broken markup.
   */
  assert.equal(decodeEntities("&amp;lt;"), "&lt;");
  assert.equal(decodeEntities("&lt;b&gt;bold&lt;/b&gt;"), "<b>bold</b>");
  assert.equal(decodeEntities("a &amp; b"), "a & b");
  assert.equal(decodeEntities("&quot;quoted&quot; and &apos;single&apos;"), "\"quoted\" and 'single'");
});

test("numeric entities decode, decimal and hex", () => {
  /* Feeds use these for apostrophes constantly, and a title with a literal
     "&#39;" in it does not match a quote the model copied. */
  assert.equal(decodeEntities("don&#39;t"), "don't");
  assert.equal(decodeEntities("don&#x27;t"), "don't");
  assert.equal(decodeEntities("&#8217;"), "’");
  assert.equal(decodeEntities("caf&#xe9;"), "café");
});

test("text with no entities in it comes back untouched", () => {
  assert.equal(decodeEntities("plain words"), "plain words");
  assert.equal(decodeEntities(""), "");
});

/* ── CDATA ──────────────────────────────────────────────────────────────── */

test("ACCEPTANCE: CDATA may contain the closing tag, which is why it exists", () => {
  /*
   * A podcast description is wrapped in CDATA precisely so it can contain
   * "</description>". A reader that matched the first closing tag would
   * truncate there — and the truncation point is inside the text, so the
   * result looks like a short description rather than like an error.
   */
  const xml = "<description><![CDATA[Read more at </description> no really]]></description>";
  assert.equal(text(xml, "description"), "Read more at </description> no really");
});

test("CDATA content is not entity-decoded, because that is what CDATA means", () => {
  const xml = "<title><![CDATA[a &amp; b]]></title>";
  assert.equal(text(xml, "title"), "a &amp; b");
  /* Outside it, the same characters do decode. */
  assert.equal(text("<title>a &amp; b</title>", "title"), "a & b");
});

test("text either side of a CDATA section is kept and decoded", () => {
  assert.equal(unwrap("before &amp; <![CDATA[middle]]> after &amp;"), "before & middle after &");
});

test("an unterminated CDATA section does not swallow the document", () => {
  /* A truncated download. The text after it is taken literally rather than
     the whole rest of the feed being lost. */
  assert.equal(unwrap("<![CDATA[the rest of it"), "the rest of it");
});

/* ── Tags and attributes ────────────────────────────────────────────────── */

test("ACCEPTANCE: a closing angle bracket inside an attribute is not the end of the tag", () => {
  /*
   * A tag matcher that stops at the first ">" cuts the tag in half and the
   * attribute after the bracket disappears — so a link comes back without its
   * URL and the candidate has nowhere to point.
   */
  const xml = `<link rel="alternate" title="a > b" href="https://example.test/x"/>`;
  const [t] = tags(xml, "link");
  assert.equal(attr(t.raw, "href"), "https://example.test/x");
  assert.equal(attr(t.raw, "title"), "a > b");
});

test("a self-closing tag carries its attributes and no text", () => {
  /* "<podcast:transcript url='…'/>" is the whole element. */
  const xml = `<podcast:transcript type="text/vtt" url="https://example.test/t.vtt"/>`;
  const [t] = tags(xml, "podcast:transcript");
  assert.equal(t.inner, "");
  assert.equal(attr(t.raw, "url"), "https://example.test/t.vtt");
  assert.equal(attr(t.raw, "type"), "text/vtt");
});

test("ACCEPTANCE: a self-closing tag does not borrow the next element's text", () => {
  /*
   * THIS IS WHAT THE SELF-CLOSING BRANCH IS FOR, and it is not obvious. An
   * empty "<title/>" has no closing tag, so a reader that always hunted for
   * one would find the NEXT "</title>" and hand the empty element the real
   * element's text — and then skip past it, so the real title is lost twice
   * over: wrong value, and the right one never returned.
   *
   * An earlier version of this test only checked that a self-closing tag's
   * attributes could be read, which works either way: without the branch the
   * hunt simply fails and the element comes back empty, which is the same
   * answer by luck.
   */
  const xml = "<feed><title/><entry><title>the real one</title></entry></feed>";
  assert.deepEqual(tags(xml, "title").map((t) => t.inner), ["", "the real one"]);

  /* And the mixed case, which is how a truncated feed arrives. */
  const mixed = `<e><link href="a"/></e><e><link>b</link></e>`;
  const got = tags(mixed, "link");
  assert.deepEqual(got.map((t) => t.inner), ["", "b"]);
  assert.equal(attr(got[0].raw, "href"), "a");
});

test("an attribute's entities decode, or the link 404s", () => {
  /* "&amp;" in a URL is the normal way to write "&" in XML. */
  const xml = `<link href="https://example.test/w?v=1&amp;t=30s"/>`;
  assert.equal(attr(tags(xml, "link")[0].raw, "href"), "https://example.test/w?v=1&t=30s");
});

test("single-quoted attributes work, and a missing one is null", () => {
  const xml = `<media:statistics views='1712866'/>`;
  assert.equal(attr(tags(xml, "media:statistics")[0].raw, "views"), "1712866");
  assert.equal(attr(tags(xml, "media:statistics")[0].raw, "likes"), null);
});

test("a tag name is matched whole, not as a prefix", () => {
  /*
   * "<title>" must not be found by looking for "<titl", and "<media:title>"
   * must not be returned when asked for "<title>" — the feed has both and
   * they are different strings.
   */
  const xml = "<title>the entry</title><media:title>the media one</media:title><titles>no</titles>";
  assert.deepEqual(tags(xml, "title").map((t) => t.inner), ["the entry"]);
  assert.deepEqual(tags(xml, "media:title").map((t) => t.inner), ["the media one"]);
});

test("every element of a name comes back, in document order", () => {
  const xml = "<e><id>1</id></e><e><id>2</id></e><e><id>3</id></e>";
  assert.deepEqual(tags(xml, "e").map((t) => text(t.inner, "id")), ["1", "2", "3"]);
});

test("an unclosed tag is an empty element, not a lost document", () => {
  /* A truncated feed. The entries before the break are still real. */
  const xml = "<e><id>1</id></e><e><id>2";
  const got = tags(xml, "e");
  assert.equal(got.length, 2);
  assert.equal(text(got[0].inner, "id"), "1");
  assert.equal(got[1].inner, "");
});

test("a tag that is not there is no tags and empty text", () => {
  assert.deepEqual(tags("<a>x</a>", "b"), []);
  assert.equal(text("<a>x</a>", "b"), "");
});

test("whitespace around text is trimmed, inside it is not", () => {
  /* A quote the verifier compares has its own spacing; a feed's indentation
     does not belong to it. */
  assert.equal(text("<t>\n   two  words \n </t>", "t"), "two  words");
});
