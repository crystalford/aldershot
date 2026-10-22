/**
 * DOCUMENTS: the marking, and matching a line by measurement.
 *
 * Invariant 8's second tier had no supply — nothing in the product took a
 * PDF or a photograph, so `documents` was a source the framework ranked
 * above the open world and nobody could fill.
 *
 * The pure half is here. What makes a document PROOF is the maker's sentence
 * about what it shows (doc 08's "with its line marked", and nothing in this
 * codebase reads a PDF to find the line), and which documents are worth
 * offering for a line is word overlap — a measurement, because a library is
 * tens of items and the alternative is a model call per line to answer what
 * a set intersection answers.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MATCH_AT, contentWords, isDocumentType, matchDocuments, overlap } from "../src/documents.ts";

const d = (title: string, note: string | null, id = "d1") => ({
  id,
  title,
  note,
  filename: null,
  mediaType: "application/pdf",
  r2Key: `u/u1/documents/${id}`,
  bytes: 1024,
  createdAt: 1,
});

test("ACCEPTANCE: overlap is keyed on the LINE, so a long note cannot win by covering everything", () => {
  /*
   * THE BREAK THAT FAILED NOTHING. Scoring the share of the DOCUMENT's words
   * that appear in the line passed every test, because no fixture could tell
   * the two directions apart. This one can: a note that says a great deal,
   * including the line, scores 1 the right way round and almost nothing the
   * wrong way.
   *
   * The question is whether this document is about what the line says — not
   * whether the line happens to be a subset of a long note. A document whose
   * note is a page of context is still the right document.
   */
  const line = "the launch moved before the review";
  const wordy = d(
    "Programme file",
    "Minutes, correspondence and annexes covering procurement, staffing, " +
      "headcount, the quarterly budget, supplier contracts, warehouse leases, " +
      "the launch, the review, and the decision that moved the launch before " +
      "the review, plus appendices on tooling, travel, insurance, training " +
      "records and the disposal schedule.",
  );
  assert.equal(overlap(line, wordy), 1, "every content word of the line is in the note");

  /* And the reverse direction would reject it, which is what makes this a
     test of the keying rather than of the words. */
  const lineWords = new Set(contentWords(line));
  const docWords = contentWords(`${wordy.title} ${wordy.note}`);
  const reverse = docWords.filter((w) => lineWords.has(w)).length / docWords.length;
  assert.ok(reverse < MATCH_AT, `keyed the other way it scores ${reverse}, which would be offered anyway`);
});

test("a document about something else scores nothing", () => {
  assert.equal(overlap("the launch moved before the review", d("Parking permit", "The permit for the yard.")), 0);
});

test("the maker's note counts as much as the title", () => {
  /* The title is usually a filename. The note is where the meaning is, so a
     match on it alone has to be enough. */
  const onlyNote = d("scan_0041", "The review was dated after the launch went out.");
  assert.ok(overlap("the review came after the launch", onlyNote) >= MATCH_AT);
});

test("a line with no content words matches nothing, rather than everything", () => {
  /* An empty intersection over an empty set is 0/0. Returning 1 would offer
     every document in the library for a line that says "and then it was". */
  assert.equal(overlap("and then it was", d("Anything", "Anything at all")), 0);
});

test("content words keep the short ones that matter", () => {
  /*
   * The same lesson the adversarial eval set learned: a filter that drops
   * words under four letters throws away "cut", "won", "owed" and keeps
   * "about". A stopword list, not a length rule.
   */
  const words = contentWords("we cut the line and they owed us");
  assert.ok(words.includes("cut"));
  assert.ok(words.includes("owed"));
  assert.ok(!words.includes("the"));
  assert.ok(!words.includes("and"));
  assert.ok(!contentWords("what it was about").includes("about"));
});

test("matchDocuments ranks the better match first and drops the rest", () => {
  const line = "the launch moved before the review";
  const got = matchDocuments(line, [
    d("Parking permit", "The permit for the yard.", "far"),
    d("Launch note", "The launch moved before the review came in.", "near"),
  ]);
  assert.deepEqual(got.map((x) => x.id), ["near"]);
});

test("only a PDF or an image may be added", () => {
  for (const ok of ["application/pdf", "image/png", "image/jpeg", "image/webp"]) {
    assert.equal(isDocumentType(ok), true, ok);
  }
  /* A video is not a document. It has its own path, which transcribes it. */
  for (const no of ["video/mp4", "text/html", "application/zip", "", "image/svg+xml"]) {
    assert.equal(isDocumentType(no), false, no);
  }
});
