#!/usr/bin/env node
/**
 * DOES AN FCP7 XML READER ACCEPT IT, OR ONLY OUR OWN TESTS?
 *
 * test/xmeml.test.ts pins the frames, the tracks, the escaping and the
 * markers by reading the text. None of that notices a structure an importer
 * rejects. The acceptance for doc 22 row 2 is "it opens in Premiere and in
 * Resolve", and a machine with no editor gets closest with OpenTimelineIO's
 * FCP7 XML reader, which is what this runs: write a timeline with every
 * feature the writer can emit, read it back by the library's accessors, and
 * check that what comes out is what went in.
 *
 * NOT IN `npm run check`, for the reason check-otio.cjs gives: it needs
 * Python and two wheels.
 *
 *   python3 -m venv /tmp/otio-venv
 *   /tmp/otio-venv/bin/pip install opentimelineio otio-fcp-adapter
 *   OTIO_PYTHON=/tmp/otio-venv/bin/python node scripts/check-xmeml.cjs
 *
 * Exits non-zero on any finding.
 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PY = process.env.OTIO_PYTHON;
if (!PY || !fs.existsSync(PY)) {
  console.log("⚠ xmeml — SKIPPED: set OTIO_PYTHON. See the header of this file.");
  process.exit(0);
}

const fail = (msg) => {
  console.log(`✘ xmeml — ${msg}`);
  process.exitCode = 1;
};

const READER = `
import json, sys
import opentimelineio as otio
t = otio.adapters.read_from_file(sys.argv[1], adapter_name="fcp_xml")
tl = t if isinstance(t, otio.schema.Timeline) else list(t)[0]
v = tl.video_tracks()[0]
a = tl.audio_tracks()
clips = [c for c in v if isinstance(c, otio.schema.Clip)]
def frames(rt): return int(round(rt.value * 25 / rt.rate))
print(json.dumps({
  "name": tl.name,
  "duration": frames(tl.duration()),
  "videoStarts": [frames(v.range_of_child(c).start_time) for c in clips],
  "videoIns": [frames(c.source_range.start_time) for c in clips],
  "audioStarts": sorted(frames(tr.range_of_child(c).start_time) for tr in a for c in tr if isinstance(c, otio.schema.Clip)),
  "urls": [c.media_reference.target_url.split("/")[-1] for c in clips],
  "markers": [len(c.markers) for c in clips],
  "firstMarker": clips[0].markers[0].metadata.get("fcp_xml", {}).get("comment") if clips[0].markers else None,
}))
`;

async function main() {
  const { xmemlTimeline } = await import("../src/xmeml.ts");
  const src = (over) => ({ blockId: "s:0", sourceKey: "u1/a.mp4", previewKey: "u1/a.edit.mp4", start_ms: 0, end_ms: 1_000, text: "a line", ...over });
  /* A plain clip, one with a voiceover over it, one with sound and no picture, and text that is XML. */
  const cuts = [
    src({ blockId: "s:0", start_ms: 1_000, end_ms: 3_000, text: "the honest version is I don't like who I am here" }),
    src({ blockId: "s:1", start_ms: 10_000, end_ms: 12_500, text: "every plan I make is a plan to be somewhere else", voiceKey: "u1/v.webm" }),
    src({ blockId: "b:take-1", start_ms: 0, end_ms: 4_000, text: "narration over the house", audioOnly: true, voiceKey: "u1/v2.webm" }),
    src({ blockId: "s:2", start_ms: 20_000, end_ms: 21_000, text: 'R&D said "<never>"' }),
  ];
  const edl = { cuts, durationMs: cuts.reduce((n, c) => n + (c.end_ms - c.start_ms), 0) };
  const media = new Map([
    ["u1/a.mp4", { name: "tuesday.mp4", durationMs: 40_000 }],
    ["u1/v.webm", { name: "take-04.webm", durationMs: 9_000 }],
    ["u1/v2.webm", { name: "take-05.webm", durationMs: 9_000 }],
  ]);
  const file = path.join(os.tmpdir(), `xmeml-check-${process.pid}.xml`);
  fs.writeFileSync(file, xmemlTimeline(edl, { name: "Whether to leave", media, timing: "forced", fps: 25 }));

  const out = spawnSync(PY, ["-I", "-", file], { input: READER, encoding: "utf8" });
  fs.rmSync(file, { force: true });
  if (out.status !== 0) return fail(`OpenTimelineIO could not read it:\n${(out.stderr || out.stdout).trim().slice(-800)}`);
  let got;
  try { got = JSON.parse(out.stdout.trim().split("\n").pop()); } catch { return fail(`the reader said something that is not JSON:\n${out.stdout.slice(-400)}`); }

  const expected = {
    name: "Whether to leave",
    /* 2 + 2.5 + 4 + 1 seconds at 25. */
    duration: 238,
    /* The picture-less cut leaves V1 empty from 4.5 s to 8.5 s. */
    videoStarts: [0, 50, 213],
    videoIns: [25, 250, 500],
    audioStarts: [50, 113],
    urls: ["tuesday.mp4", "tuesday.mp4", "tuesday.mp4"],
    markers: [1, 1, 1],
  };
  let bad = 0;
  for (const k of Object.keys(expected)) {
    if (JSON.stringify(got[k]) !== JSON.stringify(expected[k])) {
      console.log(`  ✘ ${k} — read back ${JSON.stringify(got[k])}, wrote ${JSON.stringify(expected[k])}`);
      bad++;
    }
  }
  if (bad) return fail(`${bad} thing(s) did not survive the round trip`);
  console.log("✔ xmeml — OpenTimelineIO's FCP7 reader takes it: three pictures where they belong, two voice clips, a marker on every clip");
}

main().catch((e) => fail(e.stack || String(e)));
