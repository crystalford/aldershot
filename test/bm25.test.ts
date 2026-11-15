/**
 * THE WORDS RETRIEVER, ranking properly.
 *
 * Phase 4's "BM25 ∥ dense → RRF". The ∥ was already right — both retrievers
 * run and their ranks fuse — and what sat behind the words half counted how
 * many of the brief's distinct terms appeared somewhere in a moment. These
 * pin the three things that got wrong, each against an example small enough
 * to check by hand.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { B, K1, bm25, tokens } from "../src/bm25.ts";

const doc = (id: string, text: string) => ({ id, text });
const rank = (docs: Array<{ id: string; text: string }>, q: string) =>
  bm25(docs, q, (d) => d.text).map((r) => r.item.id);

/* ── Tokens ─────────────────────────────────────────────────────────────── */

test("a word is a word, not a substring of one", () => {
  /*
   * THE ONE THAT IS WRONG RESULTS RATHER THAN WRONG ORDER.
   * `quote.includes("rent")` is true of "different", "parent" and
   * "current". src/scout-expand.ts already carried a comment about the same
   * trap — "rage must not be matched by outrageous" — because it was found
   * there first.
   */
  assert.deepEqual(rank([doc("a", "a different parent"), doc("b", "the rent is due")], "rent"), ["b"]);
  assert.deepEqual(rank([doc("a", "outrageous behaviour")], "rage"), []);
});

test("an apostrophe stays inside a word", () => {
  /* Splitting on it makes "t", which is then dropped for being short — so
     "don't" would contribute nothing at all. */
  assert.deepEqual(tokens("don't"), ["don't"]);
  assert.deepEqual(rank([doc("a", "I don't know")], "don't"), ["a"]);
});

test("the stoplist and short words go, as they always did", () => {
  assert.deepEqual(tokens("the bits about food"), ["food"]);
  assert.deepEqual(tokens("of in at"), []);
});

test("a query of nothing but noise ranks nothing, rather than everything", () => {
  assert.deepEqual(rank([doc("a", "anything at all")], "the and of"), []);
});

/* ── IDF ────────────────────────────────────────────────────────────────── */

test("a rare word is worth more than a common one", () => {
  /*
   * The first thing counting hits got wrong. On a library about houses,
   * "house" is in everything and says nothing; "turpentine" is in one
   * moment and is almost certainly the one asked for. Counting distinct
   * terms scored them the same.
   */
  const docs = [
    doc("common", "the house again"),
    doc("rare", "turpentine and a rag"),
    doc("c", "a house"),
    doc("d", "another house"),
    doc("e", "house house house"),
  ];
  assert.deepEqual(rank(docs, "house turpentine")[0], "rare");
});

test("how rare a word is counts the documents, not the substrings", () => {
  /*
   * Document frequency with `includes` on the joined text would count
   * "different" and "parent" as documents containing "rent" — three
   * instead of one — and a term the corpus barely uses would be scored as
   * one it uses constantly. The order flips, which is the only way to see
   * it: "rent" is rare and must beat a word that really is everywhere.
   */
  const docs = [
    doc("a", "a different thing"),
    doc("b", "a parent again"),
    doc("c", "the current plan"),
    doc("d", "the rent is due"),
    doc("e", "house again"),
    doc("f", "house"),
    doc("g", "house"),
  ];
  assert.equal(rank(docs, "rent house")[0], "d");
});

test("a term in more than half the corpus still scores above nothing", () => {
  /*
   * Unsmoothed IDF goes NEGATIVE past half the corpus, so a moment saying a
   * common word would rank below one saying nothing at all — and on a
   * library about one subject that is most of the useful words.
   */
  const docs = [doc("a", "house"), doc("b", "house"), doc("c", "house"), doc("d", "nothing here")];
  const scored = bm25(docs, "house", (d) => d.text);
  assert.equal(scored.length, 3, "the one that says nothing is simply not retrieved");
  for (const s of scored) assert.ok(s.score > 0, `a common word must still score above zero: ${s.score}`);
});

/* ── Saturation and length ──────────────────────────────────────────────── */

test("the fifth mention of a word is worth less than the first", () => {
  const once = bm25([doc("a", "house"), doc("b", "shed")], "house", (d) => d.text)[0].score;
  const five = bm25([doc("a", "house house house house house"), doc("b", "shed")], "house", (d) => d.text)[0]
    .score;
  assert.ok(five > once, "more is still more");
  assert.ok(five < once * 5, "but not five times more — a moment is not five times about houses");
});

test("a long moment does not win for being long", () => {
  /*
   * The second thing counting hits got wrong: a long quote has more chance
   * of containing any given term, so long moments ranked first for no
   * reason connected to what was asked.
   */
  const padding = "walked slowly toward another entirely unrelated destination yesterday morning ";
  /* The long one FIRST, so only length normalisation can put the short one
     ahead of it — ties fall back to input order, and the first version of
     this listed them short-first and passed with normalisation switched
     off entirely. */
  const docs = [doc("long", `the house ${padding.repeat(6)}`), doc("short", "the house")];
  assert.deepEqual(rank(docs, "house"), ["short", "long"]);
});

test("the two knobs are the standard ones, and are named", () => {
  /* A magic 1.2 and 0.75 buried in an expression is a thing nobody can
     tune, because nobody can find it. */
  assert.equal(K1, 1.2);
  assert.equal(B, 0.75);
});

/* ── The shape of the answer ────────────────────────────────────────────── */

test("a document that matches nothing is not retrieved", () => {
  /* A retriever that returns the whole library in an arbitrary order has
     not retrieved anything. */
  assert.deepEqual(rank([doc("a", "houses"), doc("b", "boats")], "boat"), []);
  assert.deepEqual(rank([doc("a", "houses"), doc("b", "boats")], "boats"), ["b"]);
});

test("it says which words it matched, for the line that explains itself", () => {
  const [top] = bm25([doc("a", "the kitchen and the garden")], "kitchen garden shed", (d) => d.text);
  assert.deepEqual(top.matched.sort(), ["garden", "kitchen"]);
});

test("ties keep the order they arrived in", () => {
  /*
   * Which is the caller's order — newest first, out of the database. A sort
   * that reordered ties would answer the same query differently on two runs
   * over the same rows, and nothing downstream would ever explain why.
   */
  const docs = [doc("first", "house"), doc("second", "house"), doc("third", "house")];
  assert.deepEqual(rank(docs, "house"), ["first", "second", "third"]);
});

test("an empty corpus and an empty query are both nothing, not a crash", () => {
  assert.deepEqual(rank([], "house"), []);
  assert.deepEqual(rank([doc("a", "house")], ""), []);
  assert.deepEqual(rank([doc("a", "")], "house"), []);
});
