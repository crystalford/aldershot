/**
 * THE ESCAPE HATCH, as a file.
 *
 * Phase 1's last acceptance item is "the OTIO opens in Resolve with the cuts
 * intact", and nothing in a sandbox can open Resolve. What CAN be pinned is
 * everything that would stop it opening: the schema names, the ordering, the
 * arithmetic, and the two things a timeline carries that a render does not —
 * a gap where a voiceover has no picture, and a receipt on every clip.
 *
 * scripts/check-otio.cjs reads the same file back with the real
 * OpenTimelineIO library, which is the closest a machine without an NLE can
 * get to the acceptance. This file is what runs every time.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { RATE, buildOtio, clipName, otioJson, type MediaInfo } from "../src/otio.ts";
import type { Edl, EdlCut } from "../src/edl.ts";

const cut = (over: Partial<EdlCut> = {}): EdlCut => ({
  sourceKey: "u1/a.mp4",
  previewKey: "u1/a.edit.mp4",
  start_ms: 1_000,
  end_ms: 3_000,
  text: "the honest version is I don't like who I am here",
  ...over,
});

const edl = (cuts: EdlCut[]): Edl => ({
  cuts,
  durationMs: cuts.reduce((n, c) => n + (c.end_ms - c.start_ms), 0),
});

const media = new Map<string, MediaInfo>([
  ["u1/a.mp4", { name: "tuesday.mp4", durationMs: 40_000 }],
]);

const opts = { name: "Whether to leave", media, timing: "forced" as const };

/* Narrow views into the JSON, so a test reads like the file does. */
const tracks = (o: unknown) => (o as { tracks: { children: Array<Record<string, unknown>> } }).tracks.children;
const items = (t: Record<string, unknown>) => t.children as Array<Record<string, unknown>>;
const span = (it: Record<string, unknown>) => {
  const r = it.source_range as { start_time: { value: number }; duration: { value: number } };
  return [r.start_time.value, r.duration.value];
};

test("a cut becomes a clip, in order, at the times it was cut at", () => {
  const o = buildOtio(edl([cut(), cut({ start_ms: 10_000, end_ms: 12_500 })]), opts);
  const v = items(tracks(o)[0]);
  assert.equal(v.length, 2);
  assert.deepEqual(span(v[0]), [1_000, 2_000]);
  assert.deepEqual(span(v[1]), [10_000, 2_500]);
  assert.equal(v[0].OTIO_SCHEMA, "Clip.1");
});

test("the time base is milliseconds, which is what this product knows", () => {
  /*
   * A rate of 25 would be inventing a number: nothing in this product has
   * ever measured a source's frame rate. 1000 says what is true, and the NLE
   * rounds to its own frame on import.
   */
  assert.equal(RATE, 1000);
  const o = buildOtio(edl([cut()]), opts);
  const r = items(tracks(o)[0])[0].source_range as { start_time: { rate: number } };
  assert.equal(r.start_time.rate, 1000);
});

test("every clip carries the receipt: its source, its words, and what the times are worth", () => {
  /*
   * Invariant 4 at the edge of the product. A cut opened in somebody else's
   * editor and finished there still knows what it is made of — and `timing`
   * is the honest half: a recogniser timing exported as if it were frame
   * accurate is the lie this metadata exists to prevent.
   */
  const o = buildOtio(edl([cut()]), opts);
  const meta = (items(tracks(o)[0])[0].metadata as { aldershot: Record<string, unknown> }).aldershot;
  assert.equal(meta.sourceKey, "u1/a.mp4");
  assert.equal(meta.timing, "forced");
  assert.match(String(meta.quote), /honest version/);

  const soft = buildOtio(edl([cut()]), { ...opts, timing: "recogniser" });
  const softMeta = (items(tracks(soft)[0])[0].metadata as { aldershot: Record<string, unknown> }).aldershot;
  assert.equal(softMeta.timing, "recogniser", "the file says what it is, not what we wish it were");
});

test("a clip points at a filename, never at our storage", () => {
  /*
   * Every link this product could write is presigned and expires, so an
   * .otio carrying one opens today and relinks to nothing next week — a
   * failure that arrives after the person has moved on.
   */
  const o = buildOtio(edl([cut()]), opts);
  const ref = items(tracks(o)[0])[0].media_reference as Record<string, unknown>;
  assert.equal(ref.target_url, "tuesday.mp4");
  assert.doesNotMatch(String(ref.target_url), /http|\?|X-Amz|Signature/i);
  const avail = ref.available_range as { duration: { value: number } };
  assert.equal(avail.duration.value, 40_000, "how long the whole source is, so a trim can be undone");
});

test("a source we have no name for falls back to its key rather than to nothing", () => {
  const o = buildOtio(edl([cut({ sourceKey: "u1/unknown.mp4" })]), opts);
  const ref = items(tracks(o)[0])[0].media_reference as Record<string, unknown>;
  assert.equal(ref.target_url, "u1/unknown.mp4");
  assert.equal(ref.available_range, null, "and claims no duration it does not know");
});

/* ── Sound ──────────────────────────────────────────────────────────────── */

test("a cut with no picture is a gap on the picture track", () => {
  /*
   * The renderer already treats this as a special case — a .webm of somebody
   * talking has no video stream to filter. A timeline has a place for it: a
   * hole in the picture and the recording underneath, which is what it is.
   */
  const o = buildOtio(edl([cut({ audioOnly: true, voiceKey: "u1/v.webm" })]), opts);
  const [v, a] = tracks(o);
  assert.equal(items(v)[0].OTIO_SCHEMA, "Gap.1");
  assert.equal(items(a)[0].OTIO_SCHEMA, "Clip.1");
  assert.equal(a.kind, "Audio");
});

test("a voiceover is held at its moment by the gap in front of it", () => {
  /*
   * THE GAPS ARE LOAD-BEARING. A track that simply listed the voice clips
   * would stack them at the head of the timeline — the failure that looks
   * fine until you press play.
   */
  const o = buildOtio(
    edl([
      cut({ start_ms: 0, end_ms: 4_000 }),
      cut({ start_ms: 0, end_ms: 2_000, voiceKey: "u1/v.webm" }),
    ]),
    opts,
  );
  const a = items(tracks(o)[1]);
  assert.equal(a.length, 2);
  assert.equal(a[0].OTIO_SCHEMA, "Gap.1");
  assert.deepEqual(span(a[0]), [0, 4_000], "four seconds of picture before the voice starts");
  assert.equal(a[1].OTIO_SCHEMA, "Clip.1");
});

test("a cut with no voice anywhere gets no audio track to delete", () => {
  const o = buildOtio(edl([cut(), cut()]), opts);
  assert.equal(tracks(o).length, 1);
});

/* ── The shape of the file ──────────────────────────────────────────────── */

test("the timeline is named after the project and says what it leaves out", () => {
  const o = buildOtio(edl([cut()]), opts) as Record<string, unknown>;
  assert.equal(o.name, "Whether to leave");
  assert.equal(o.OTIO_SCHEMA, "Timeline.1");
  const meta = (o.metadata as { aldershot: Record<string, unknown> }).aldershot;
  /* Doc 09: lossy for kinetic type and ducking curves. Somebody who opens
     this and wonders where the captions went should find the answer here. */
  assert.match(String(meta.note), /Captions, sound processing and graphics/);
  assert.equal(meta.durationMs, 2_000);
});

test("a clip is named after what is said in it", () => {
  /* Forty consecutive slots reading "u1/a.mp4" tell an editor nothing. */
  assert.equal(clipName("short line"), "short line");
  assert.equal(clipName("one two three four", 9), "one two…");
  assert.equal(clipName("   spaced   out  "), "spaced out");
  assert.equal(clipName(""), "clip", "a clip with no words still needs a name");
});

test("the file is JSON, and ends in a newline like a file should", () => {
  const text = otioJson(edl([cut()]), opts);
  assert.ok(text.endsWith("\n"));
  assert.deepEqual(JSON.parse(text), buildOtio(edl([cut()]), opts));
});

test("an empty cut makes an empty timeline rather than throwing", () => {
  /* The route refuses this case before it gets here — but a builder that
     threw would turn a 422 into a 500 the day something else called it. */
  const o = buildOtio(edl([]), opts);
  assert.equal(items(tracks(o)[0]).length, 0);
});
