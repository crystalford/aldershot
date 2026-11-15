/**
 * Connecting a bucket you own, and reading Neolog as footage.
 *
 * Two halves, deliberately apart: src/bucket.ts is generic and works against
 * any S3-compatible store, and src/neolog.ts is the one Neolog-shaped file in
 * the codebase. The test for the second one is mostly about what it REFUSES
 * to take.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isFootage, parseListing } from "../src/bucket.ts";
import { VLOG_COLUMNS, importableFrom, recordedAtMs, type VlogRow } from "../src/neolog.ts";

/* ── The listing ──────────────────────────────────────────────────────── */

const listing = (inner: string, truncated = false, token: string | null = null) =>
  `<?xml version="1.0" encoding="UTF-8"?>
   <ListBucketResult><Name>neolog-videos</Name>${inner}
   <IsTruncated>${truncated}</IsTruncated>
   ${token ? `<NextContinuationToken>${token}</NextContinuationToken>` : ""}
   </ListBucketResult>`;

const contents = (key: string, size = 1024, when = "2026-03-11T09:00:00.000Z") =>
  `<Contents><Key>${key}</Key><Size>${size}</Size><LastModified>${when}</LastModified></Contents>`;

test("objects come back with their key, size and upload time", () => {
  const { objects } = parseListing(listing(contents("vlogs/a.mp4", 42)));
  assert.equal(objects.length, 1);
  assert.equal(objects[0].key, "vlogs/a.mp4");
  assert.equal(objects[0].size, 42);
  assert.equal(objects[0].uploadedAt, Date.parse("2026-03-11T09:00:00.000Z"));
});

test("a key containing the word Contents does not swallow the next object", () => {
  /*
   * The whole reason the per-object match is non-greedy. A transcript file
   * called "Contents.json" sitting between two videos is entirely plausible,
   * and a greedy match would return one object spanning all three — so the
   * bucket would look almost empty and nothing would say why.
   */
  const xml = listing(
    contents("a/Contents</Contents>.mp4") + contents("b.mp4") + contents("c.mp4"),
  );
  assert.ok(parseListing(xml).objects.length >= 2, "more than one object survives");
});

test("the cursor is only followed when the listing says it is truncated", () => {
  /* A continuation token on a final page is a loop that re-reads the same
     objects until the page cap stops it. */
  assert.equal(parseListing(listing(contents("a.mp4"), false, "tok")).next, null);
  assert.equal(parseListing(listing(contents("a.mp4"), true, "tok")).next, "tok");
});

test("escaped characters in a key are decoded once, not twice", () => {
  /* `&amp;amp;` is a key with a literal "&amp;" in it. Decoding in the wrong
     order turns it into "&", and the presigned URL then points at an object
     that does not exist. */
  const { objects } = parseListing(listing(contents("a &amp;amp; b.mp4")));
  assert.equal(objects[0].key, "a &amp; b.mp4");
});

test("footage is footage; thumbnails and transcripts are not", () => {
  for (const k of ["a.mp4", "A.MOV", "deep/path/b.mkv", "pod.mp3", "x.wav"]) {
    assert.ok(isFootage(k), `${k} should import`);
  }
  for (const k of ["thumb.jpg", "a.mp4.json", "transcript.txt", "notes.md", "a/b/"]) {
    assert.ok(!isFootage(k), `${k} should not import`);
  }
});

/* ── Neolog, as footage only ──────────────────────────────────────────── */

const vlog = (over: Partial<VlogRow> = {}): VlogRow => ({
  id: "v1",
  r2_key: "originals/v1.mov",
  transcoded_r2_key: "proxies/v1.mp4",
  thumbnail_r2_key: "thumbs/v1.jpg",
  duration_seconds: 3600,
  recorded_at: "2026-03-11T09:00:00.000Z",
  pipeline_status: "complete",
  is_podcast: 0,
  deleted_at: null,
  ...over,
});

test("the import never asks for a transcript column", () => {
  /*
   * THE POINT OF THIS WHOLE FILE.
   *
   * Neolog's transcript_words is already a word table, so importing it would
   * skip transcription entirely — and the owner does not trust it, because
   * Neolog runs a workflow whose job is finding hallucinated transcript text.
   * A cut built on a word that was never said is wrong in a way this product
   * cannot see, and invariant 4 makes that worse than having no transcript:
   * the receipt would point at nothing.
   *
   * Pinned on the column list rather than on a comment, because a comment
   * does not fail.
   */
  assert.doesNotMatch(VLOG_COLUMNS, /transcript/i);
  const src = readFileSync(join(import.meta.dirname, "../src/neolog.ts"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(code, /transcript_text|transcript_words/, "no transcript column in the code");
});

test("a deleted or unfinished row is not offered", () => {
  assert.equal(importableFrom([vlog({ deleted_at: "2026-04-01" })]).length, 0);
  assert.equal(importableFrom([vlog({ pipeline_status: "processing" })]).length, 0);
  assert.equal(importableFrom([vlog({ r2_key: null, transcoded_r2_key: null })]).length, 0);
});

test("the proxy is preferred over the original, because reading is all we do", () => {
  assert.equal(importableFrom([vlog()])[0].key, "proxies/v1.mp4");
  assert.equal(importableFrom([vlog({ transcoded_r2_key: null })])[0].key, "originals/v1.mov");
});

test("length and date come across; the title is only a placeholder", () => {
  const [it] = importableFrom([vlog()]);
  assert.equal(it.durationS, 3600);
  assert.equal(it.recordedAt, Date.parse("2026-03-11T09:00:00.000Z"));
  assert.equal(it.posterKey, "thumbs/v1.jpg");
  assert.equal(it.foreignId, "v1");
  /* The read names it. A filename in the heading is the regression the
     owner called out by name. */
  assert.equal(it.title, "v1");
});

test("a date is read in whatever unit it was stored in, or not at all", () => {
  const ms = Date.parse("2026-03-11T09:00:00.000Z");
  assert.equal(recordedAtMs(ms), ms, "milliseconds stay milliseconds");
  assert.equal(recordedAtMs(Math.round(ms / 1000)), ms, "seconds become milliseconds");
  assert.equal(recordedAtMs("2026-03-11T09:00:00.000Z"), ms, "an ISO string parses");
  assert.equal(recordedAtMs(String(Math.round(ms / 1000))), ms, "seconds as a string too");

  /*
   * Guessing wrong by a factor of a thousand puts footage in 1970 or in the
   * year 56000, and a Story ordered by it would be silently wrong rather
   * than visibly broken. Null is the honest answer.
   */
  for (const bad of [null, "", "not a date", 0, -5, Number.NaN]) {
    assert.equal(recordedAtMs(bad as never), null, `${String(bad)} is not a date`);
  }
});

test("a row with no date imports anyway, dateless", () => {
  /* Missing is not broken. The footage is still yours and still cuttable;
     only time-ordering and Story are poorer for it. */
  const [it] = importableFrom([vlog({ recorded_at: null })]);
  assert.equal(it.recordedAt, null);
  assert.equal(it.key, "proxies/v1.mp4");
});
