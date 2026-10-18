#!/usr/bin/env node
/**
 * IS IT REALLY OTIO, OR IS IT JSON THAT LOOKS LIKE IT?
 *
 * test/otio.test.ts pins the arithmetic and the shape — ordering, source
 * ranges, the gap a voiceover leaves in the picture, the receipt on each
 * clip. None of that notices a wrong schema name, a field OTIO renamed, or
 * a structure its reader rejects: the JSON would be exactly as described and
 * no editor would open it. Phase 1's acceptance is "the OTIO opens in
 * Resolve with the cuts intact", and the closest a machine with no NLE can
 * get to that is the library every NLE's importer is built on.
 *
 * So this writes a timeline with every feature the exporter can emit, reads
 * it back with OpenTimelineIO, and checks that what comes out is what went
 * in — by the library's own accessors, not by reading the JSON again.
 *
 * NOT IN `npm run check`, because it needs Python and a wheel, and a gate
 * that cannot run is a gate people learn to skip:
 *
 *   python3 -m venv /tmp/otio-venv
 *   /tmp/otio-venv/bin/pip install opentimelineio
 *   OTIO_PYTHON=/tmp/otio-venv/bin/python node scripts/check-otio.cjs
 *
 * Exits non-zero on any finding.
 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PY = process.env.OTIO_PYTHON;
if (!PY || !fs.existsSync(PY)) {
  console.log("⚠ otio — SKIPPED: set OTIO_PYTHON. See the header of this file.");
  process.exit(0);
}

async function main() {
  const { buildOtio, otioJson } = await import("../src/otio.ts");

  const src = (over) => ({
    sourceKey: "u1/a.mp4",
    previewKey: "u1/a.edit.mp4",
    start_ms: 0,
    end_ms: 1_000,
    text: "a line",
    ...over,
  });

  /*
   * EVERY FEATURE THE EXPORTER CAN EMIT, in one timeline: a plain clip, a
   * clip with a voiceover mixed over it, and a clip with sound and no
   * picture. A fixture of three ordinary clips would prove only that the
   * ordinary case parses.
   */
  const cuts = [
    src({ start_ms: 1_000, end_ms: 3_000, text: "the honest version is I don't like who I am here" }),
    src({ start_ms: 10_000, end_ms: 12_500, text: "every plan I make is a plan to be somewhere else", voiceKey: "u1/v.webm" }),
    src({ start_ms: 0, end_ms: 4_000, text: "narration over the house", audioOnly: true, voiceKey: "u1/v2.webm" }),
    src({ start_ms: 20_000, end_ms: 21_000, text: "and then I stopped talking" }),
  ];
  const edl = { cuts, durationMs: cuts.reduce((n, c) => n + (c.end_ms - c.start_ms), 0) };
  const media = new Map([
    ["u1/a.mp4", { name: "tuesday.mp4", durationMs: 40_000 }],
    ["u1/v.webm", { name: "take-04.webm", durationMs: 9_000 }],
    ["u1/v2.webm", { name: "take-05.webm", durationMs: 9_000 }],
  ]);

  const file = path.join(os.tmpdir(), `otio-check-${process.pid}.otio`);
  fs.writeFileSync(file, otioJson(edl, { name: "Whether to leave", media, timing: "forced" }));

  const expected = {
    name: "Whether to leave",
    duration: edl.durationMs,
    video: ["Clip", "Clip", "Gap", "Clip"],
    /* A gap holding the voice at 2s, the voice, a gap over the picture-less
       cut's own position, then that cut's recording. */
    audioKinds: ["Gap", "Clip", "Clip"],
    firstClip: { start: 1_000, duration: 2_000, url: "tuesday.mp4" },
    timing: "forced",
  };

  const out = spawnSync(PY, ["-I", "-", file], { input: READER, encoding: "utf8" });
  fs.rmSync(file, { force: true });
  if (out.status !== 0) {
    return fail(`OpenTimelineIO could not read it:\n${(out.stderr || out.stdout).trim().slice(-800)}`);
  }

  let got;
  try {
    got = JSON.parse(out.stdout.trim().split("\n").pop());
  } catch {
    return fail(`the reader said something that is not JSON:\n${out.stdout.slice(-400)}`);
  }

  let bad = 0;
  const same = (what, a, b) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      console.log(`  ✘ ${what} — read back ${JSON.stringify(a)}, wrote ${JSON.stringify(b)}`);
      bad += 1;
    }
  };
  same("the timeline name", got.name, expected.name);
  same("the total duration in ms", got.duration, expected.duration);
  same("what is on the picture track", got.video, expected.video);
  same("what is on the sound track", got.audioKinds, expected.audioKinds);
  same("the first clip's source range and media", got.firstClip, expected.firstClip);
  same("the receipt on the first clip", got.timing, expected.timing);

  if (bad) return fail(`${bad} thing(s) did not survive the round trip`);
  console.log("✔ otio — OpenTimelineIO reads it back: four cuts, the voice track, and the receipts intact");
}

/*
 * READ BY THE LIBRARY'S OWN ACCESSORS, not by parsing the JSON again.
 *
 * Reading the file back as JSON would prove only that JSON.stringify works.
 * trimmed_range(), track.kind and media_reference.target_url are what an
 * importer actually calls, and they are what has to be right.
 */
const READER = `
import json, sys
import opentimelineio as otio

tl = otio.adapters.read_from_file(sys.argv[1])
video, audio = None, None
for t in tl.tracks:
    if t.kind == otio.schema.TrackKind.Video: video = t
    if t.kind == otio.schema.TrackKind.Audio: audio = t

first = video[0]
r = first.trimmed_range()
print(json.dumps({
    "name": tl.name,
    "duration": int(tl.duration().value),
    "video": [type(i).__name__ for i in video],
    "audioKinds": [type(i).__name__ for i in (audio or [])],
    "firstClip": {
        "start": int(r.start_time.value),
        "duration": int(r.duration.value),
        "url": first.media_reference.target_url,
    },
    "timing": first.metadata["aldershot"]["timing"],
}))
`;

function fail(msg) {
  console.log(`✘ otio — ${msg}`);
  process.exitCode = 1;
}

main().then(() => process.exit(process.exitCode || 0));
