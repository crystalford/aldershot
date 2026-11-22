/**
 * THE CUT AS FINAL CUT 7 XML, AND RESOLVE'S MARKERS — doc 22, row 2.
 *
 * Nothing here can open Premiere or Resolve. What can be pinned is everything
 * that would stop them opening the file or put a cut in the wrong place: the
 * arithmetic of frames, the two tracks, escaping, and the marker on every
 * clip. scripts/check-xmeml.cjs reads the same file back with OpenTimelineIO's
 * FCP7 reader, the nearest thing to an importer a machine without an editor has.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { asRate, place, resolveMarkers, timecode, toAscii, xmemlTimeline, type XmemlOpts } from "../src/xmeml.ts";
import type { Edl, EdlCut } from "../src/edl.ts";
import type { MediaInfo } from "../src/otio.ts";
import { exportPanel } from "../src/ui/pages/export.ts";

const cut = (over: Partial<EdlCut> = {}): EdlCut => ({
  blockId: "s:1",
  sourceKey: "u1/a.mp4",
  previewKey: "u1/a.edit.mp4",
  start_ms: 1_000,
  end_ms: 3_000,
  text: "the honest version is I don't like who I am here",
  ...over,
});
const edl = (cuts: EdlCut[]): Edl => ({ cuts, durationMs: cuts.reduce((n, c) => n + (c.end_ms - c.start_ms), 0) });
const media = new Map<string, MediaInfo>([
  ["u1/a.mp4", { name: "tuesday.mp4", durationMs: 40_000 }],
  ["u1/vo.webm", { name: "take-3.webm", durationMs: 9_000 }],
]);
const opts = (over: Partial<XmemlOpts> = {}): XmemlOpts => ({ name: "Whether to leave", media, timing: "forced", fps: 25, ...over });

/* The clipitems on one track, read back by position rather than by trusting the writer. */
const track = (xml: string, kind: "video" | "audio") => {
  /* V1 is the first <track>, A1 the second; tracks don't nest, and a file's
     own <media><video> does, so the track is the thing to cut on. */
  const body = [...xml.matchAll(/<track>([\s\S]*?)<\/track>/g)][kind === "video" ? 0 : 1][1];
  return [...body.matchAll(/<clipitem id="[^"]+">([\s\S]*?)<\/clipitem>/g)].map((m) => {
    const n = (t: string) => Number(new RegExp(`<${t}>(-?\\d+)</${t}>`).exec(m[1])![1]);
    return { start: n("start"), end: n("end"), in: n("in"), out: n("out"), body: m[1] };
  });
};

test("every cut with a picture is a clip on V1, end to end with nothing between", () => {
  const e = edl([cut(), cut({ blockId: "s:2", start_ms: 10_000, end_ms: 14_000 }), cut({ blockId: "s:3", start_ms: 20_000, end_ms: 21_000 })]);
  const v = track(xmemlTimeline(e, opts()), "video");
  assert.equal(v.length, 3);
  assert.deepEqual(v.map((c) => [c.start, c.end]), [[0, 50], [50, 150], [150, 175]]);
  assert.deepEqual(v.map((c) => [c.in, c.out]), [[25, 75], [250, 350], [500, 525]]);
});

test("positions come from the running total, so many short clips don't drift", () => {
  /* Forty clips of 1.013 s at 30 fps. Adding rounded lengths puts the last
     one 0.39 frames × 40 ≈ 16 frames late; the running total keeps it exact. */
  const cuts = Array.from({ length: 40 }, (_, i) => cut({ blockId: `s:${i}`, start_ms: i * 2000, end_ms: i * 2000 + 1013 }));
  const p = place(edl(cuts), 30);
  assert.equal(p[39].end, Math.round((40 * 1013 * 30) / 1000));
  for (let i = 1; i < p.length; i++) assert.equal(p[i].start, p[i - 1].end);
});

test("the sequence is as long as the cut, and starts at 01:00:00:00", () => {
  const xml = xmemlTimeline(edl([cut(), cut({ start_ms: 5_000, end_ms: 9_000 })]), opts());
  assert.match(xml, /<sequence id="sequence-1"><name>Whether to leave<\/name><duration>150<\/duration>/);
  assert.match(xml, /<string>01:00:00:00<\/string><frame>90000<\/frame>/);
});

test("the rate is the one asked for, and anything else is the default", () => {
  const v = track(xmemlTimeline(edl([cut()]), opts({ fps: 30 })), "video");
  assert.deepEqual([v[0].start, v[0].end, v[0].in, v[0].out], [0, 60, 30, 90]);
  assert.equal(asRate("30"), 30);
  assert.equal(asRate("29.97"), 25);
  assert.equal(asRate(undefined), 25);
});

test("a voiceover over a range rides on A1 beside its picture; a recording with no picture is only on A1", () => {
  const e = edl([
    cut(),
    cut({ blockId: "b:vo", voiceKey: "u1/vo.webm", start_ms: 4_000, end_ms: 6_000 }),
    cut({ blockId: "b:solo", sourceKey: "u1/vo.webm", audioOnly: true, start_ms: 0, end_ms: 3_000 }),
  ]);
  const xml = xmemlTimeline(e, opts());
  const v = track(xml, "video"), a = track(xml, "audio");
  assert.deepEqual(v.map((c) => [c.start, c.end]), [[0, 50], [50, 100]]);
  assert.deepEqual(a.map((c) => [c.start, c.end]), [[50, 100], [100, 175]]);
  assert.match(a[0].body, /<name>take-3\.webm<\/name>/);
  /* The picture-less recording leaves V1 empty there rather than holding a frame. */
  assert.ok(!v.some((c) => c.start >= 100));
});

test("files are named, not linked: the pathurl is the bare filename, and each file is declared once", () => {
  const xml = xmemlTimeline(edl([cut(), cut({ start_ms: 8_000, end_ms: 9_000 })]), opts());
  assert.equal((xml.match(/<file id="file-1">/g) ?? []).length, 1);
  assert.equal((xml.match(/<file id="file-1"\/>/g) ?? []).length, 1);
  assert.match(xml, /<pathurl>tuesday\.mp4<\/pathurl>/);
  assert.doesNotMatch(xml, /u1\//);
});

test("every clip carries a marker saying what is said, where from, and what its timing is worth", () => {
  const notes = new Map([["b:7", ["Generated — not photoreal.", "Label on screen: Made with AI"]]]);
  const xml = xmemlTimeline(edl([cut({ blockId: "b:7" })]), opts({ notes }));
  const v = track(xml, "video")[0].body;
  const comment = /<marker><name>[^<]*<\/name><comment>([\s\S]*?)<\/comment><in>(\d+)<\/in>/.exec(v)!;
  assert.equal(comment[2], "25", "a clip marker is in source frames, at the clip's first frame");
  assert.match(comment[1], /“the honest version is I don't like who I am here”/);
  assert.match(comment[1], /From tuesday\.mp4 at 00:00:01:00\./);
  assert.match(comment[1], /aligned to the sound, good to about \d+ ms/);
  assert.match(comment[1], /Label on screen: Made with AI/);
  assert.match(comment[1], /Block b:7 in Aldershot\./);
});

test("text that is XML is escaped, so a quote can't break the file", () => {
  const xml = xmemlTimeline(edl([cut({ text: 'R&D said "<never>"' })]), opts({ name: "A & B" }));
  assert.match(xml, /<name>A &amp; B<\/name>/);
  assert.match(xml, /R&amp;D said &quot;&lt;never&gt;&quot;/);
  assert.doesNotMatch(xml, /<never>/);
});

test("Resolve's markers: one per clip at its first frame, from 01:00:00:00, in its own shape, ASCII only", () => {
  const e = edl([cut(), cut({ blockId: "b:7", start_ms: 0, end_ms: 1_000 }), cut({ blockId: "s:3", start_ms: 0, end_ms: 1_000 })]);
  const notes = new Map([["b:7", ["Depiction · made with AI"]]]);
  const m = resolveMarkers(e, opts({ notes }));
  assert.match(m, /^TITLE: Whether to leave\nFCM: NON-DROP FRAME\n\n/);
  const events = [...m.matchAll(/^(\d{3}) {2}001 {6}V {5}C {8}(\S+) (\S+) (\S+) (\S+) {2}\n \|C:(\w+) \|M:([^\n]*) \|D:1$/gm)];
  assert.equal(events.length, 3);
  assert.deepEqual(events.map((x) => x[2]), ["01:00:00:00", "01:00:02:00", "01:00:03:00"]);
  assert.deepEqual(events.map((x) => x[6]), ["ResolveColorBlue", "ResolveColorPurple", "ResolveColorBlue"]);
  assert.match(events[1][7], /Depiction - made with AI/);
  assert.doesNotMatch(m, /[^\x00-\x7E]/);
});

test("a clip with no frames is in neither file, so no two markers can share a frame", () => {
  /* 15 ms at 25 fps rounds to nothing. Kept, it would be a zero-length clip
     and a second marker on the next clip's frame, which Resolve drops. */
  const e = edl([cut(), cut({ blockId: "s:tiny", start_ms: 0, end_ms: 15 }), cut({ blockId: "s:3", start_ms: 0, end_ms: 1_000 })]);
  const xml = xmemlTimeline(e, opts());
  assert.equal(track(xml, "video").length, 2);
  assert.doesNotMatch(xml, /Block s:tiny/);
  const starts = [...resolveMarkers(e, opts()).matchAll(/C {8}(\S+) /g)].map((x) => x[1]);
  assert.equal(new Set(starts).size, starts.length);
  assert.equal(starts.length, 2);
});

test("timecode and ASCII folding", () => {
  assert.equal(timecode(90_000 + 49, 25), "01:00:01:24");
  assert.equal(toAscii("“Kept” — it’s… a line|break\nhere"), "\"Kept\" - it's... a line break here");
});

test("the export page offers both files, and what it says about them is true of the file", () => {
  /* Pinned from both ends, like the .otio's line: the claim is read out of
     the page and checked against what the writer puts on a clip. */
  const panel = exportPanel("p1", "free");
  assert.match(panel, /href="\/api\/projects\/p1\/timeline\.xml"/);
  assert.match(panel, /href="\/api\/projects\/p1\/markers\.edl"/);
  assert.match(panel, /a marker on every clip saying what is said in it, where it came from and what its timings are worth/);
  const v = track(xmemlTimeline(edl([cut(), cut({ start_ms: 9_000, end_ms: 10_000 })]), opts()), "video");
  for (const c of v) {
    assert.match(c.body, /<marker>.*“[^”]+”/s, "what is said in it");
    assert.match(c.body, /From tuesday\.mp4 at /, "where it came from");
    assert.match(c.body, /good to about \d+ ms/, "what its timings are worth");
  }
});
