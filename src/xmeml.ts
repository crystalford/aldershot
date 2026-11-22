/**
 * THE SAME CUT, IN THE FORMAT BOTH EDITORS IMPORT — Final Cut Pro 7 XML.
 *
 * `src/otio.ts` is the escape hatch Resolve reads. Premiere's OTIO import is
 * still a beta that has to be switched on, so for the person most likely to
 * take a rough cut and finish it by hand, the .otio is a file their editor
 * doesn't open. FCP7 XML ("xmeml") is old, and it is the one timeline format
 * Premiere and Resolve both import without asking anything of the person.
 * Doc 22, row 2; the canvas's Export package carries it as edit.xml.
 *
 * PURE, like otio.ts: what goes in the file is decided here, from the same
 * `Edl` the render and the .otio are built from, so the three cannot disagree
 * about what is in the cut.
 *
 * WHAT IT CARRIES BESIDES THE CUTS: a marker on every clip saying what is said
 * in it, which file it is from and where, what its timings are worth, and —
 * for a picture that isn't the person's own — the label and how it was made.
 * Invariant 4 at the edge of the product, in the one place an editor shows
 * text to the person editing: an .otio's metadata is invisible in Resolve's
 * timeline, and a marker is not.
 */

import type { Edl, EdlCut } from "./edl.ts";
import type { TimingSource } from "./align.ts";
import { TOLERANCE_MS } from "./align.ts";
import { clipName, type MediaInfo } from "./otio.ts";

/*
 * A FRAME RATE HAS TO BE DECLARED, and here it is a choice, not a fact.
 *
 * otio.ts counts in milliseconds because this product has never measured a
 * source's frame rate, and inventing one would move every cut. XML has no
 * such escape: every time in it is an integer count of frames at one
 * timebase. So the rate is the TIMELINE's, chosen by the person exporting
 * (the route takes ?fps=), and the editor conforms the footage to it on
 * import exactly as it would for any clip dropped on a timeline of that rate.
 * Each boundary rounds to its nearest frame: at most half a frame, 20 ms at
 * 25 — the same order as a forced timing is worth.
 */
export const TIMELINE_RATES = [24, 25, 30] as const;
export type TimelineRate = (typeof TIMELINE_RATES)[number];
export const DEFAULT_RATE: TimelineRate = 25;

export const asRate = (v: unknown): TimelineRate => {
  const n = Number(v);
  return (TIMELINE_RATES as readonly number[]).includes(n) ? (n as TimelineRate) : DEFAULT_RATE;
};

export interface XmemlOpts {
  /** The sequence's name, which is the project's. */
  name: string;
  /** Source key → what to call its file, so an editor can relink it. */
  media: Map<string, MediaInfo>;
  /** Where this cut's timings came from, for clips that carry none. */
  timing: TimingSource;
  fps: TimelineRate;
  /**
   * Block id → lines about it that the cut itself doesn't know: the cue
   * sheet's label and how a picture was made ("b:<beatId>" keys).
   */
  notes?: Map<string, string[]>;
}

export const xmlEsc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const frames = (ms: number, fps: number) => Math.round((ms * fps) / 1000);

/** One clip's place on the timeline, in frames, and in its source. */
export interface Placed {
  cut: EdlCut;
  /** Timeline frames. */
  start: number;
  end: number;
  /** Source frames. */
  in: number;
  out: number;
}

/*
 * POSITIONS FROM THE RUNNING TOTAL IN MILLISECONDS, NOT BY ADDING FRAMES.
 *
 * Rounding each clip's length to frames and adding them up drifts: forty
 * clips each a third of a frame long round the same way and the last one
 * lands more than a dozen frames late, out of sync with the captions built
 * from the same EDL. Rounding the running total instead keeps every boundary
 * within half a frame of where the EDL puts it, and the source range takes
 * its length from the timeline so a clip never asks for more than it shows.
 */
export function place(edl: Edl, fps: number): Placed[] {
  let atMs = 0;
  return edl.cuts.map((cut) => {
    const dur = Math.max(0, cut.end_ms - cut.start_ms);
    const start = frames(atMs, fps);
    atMs += dur;
    const end = frames(atMs, fps);
    const inF = frames(cut.start_ms, fps);
    return { cut, start, end, in: inF, out: inF + (end - start) };
  });
}

/** Timecode at the timeline's rate, from frames. Non-drop: every rate here is a whole number. */
export function timecode(f: number, fps: number): string {
  const p = (n: number) => String(Math.floor(n)).padStart(2, "0");
  const s = Math.floor(f / fps);
  return `${p(s / 3600)}:${p((s % 3600) / 60)}:${p(s % 60)}:${p(f % fps)}`;
}

/*
 * The timeline starts at 01:00:00:00, which is where Resolve and Premiere
 * both start a new one. The marker file below counts from the same hour, so
 * the two line up without anybody setting a start time.
 */
const HOUR = 3600;

/** What a clip's marker says, a line at a time. */
export function markerLines(p: Placed, opts: XmemlOpts): string[] {
  const c = p.cut;
  const file = opts.media.get(c.sourceKey)?.name ?? c.sourceKey;
  const timing = c.timing ?? opts.timing;
  return [
    c.text.trim() ? `“${c.text.replace(/\s+/g, " ").trim()}”` : null,
    `From ${file} at ${timecode(p.in, opts.fps)}.`,
    `Timings are ${timing === "forced" ? "aligned to the sound" : timing === "recogniser" ? "the recogniser's" : "from published captions"}, good to about ${TOLERANCE_MS[timing]} ms.`,
    ...(c.voiceKey ? [`Your voice over it, from ${opts.media.get(c.voiceKey)?.name ?? c.voiceKey}.`] : []),
    ...(opts.notes?.get(c.blockId) ?? []),
    `Block ${c.blockId} in Aldershot.`,
  ].filter((x): x is string => !!x);
}

function rate(fps: number): string {
  return `<rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>`;
}

/**
 * The file.
 *
 * Shape: one sequence; V1 holds every cut with a picture, A1 holds the two
 * kinds of sound otio.ts separates — a voiceover mixed over a range, and a
 * recording with no picture at all. Unlike OTIO's tracks, XML places every
 * clip by its own start and end, so there are no gaps to write; an empty
 * stretch of V1 is simply a stretch with no clip in it.
 *
 * FILES BY NAME, NEVER BY OUR URL, for the reason otio.ts gives: every link
 * this product could write is presigned and expires. The pathurl is the bare
 * filename, and an editor asks to be pointed at the folder.
 */
export function xmemlTimeline(edl: Edl, opts: XmemlOpts): string {
  const fps = opts.fps;
  const placed = place(edl, fps);
  const total = frames(placed.reduce((n, p) => n + Math.max(0, p.cut.end_ms - p.cut.start_ms), 0), fps);
  const fileIds = new Map<string, string>();
  let n = 0;

  const file = (key: string, kind: "video" | "audio"): string => {
    const known = fileIds.get(key);
    if (known) return `<file id="${known}"/>`;
    const id = `file-${fileIds.size + 1}`;
    fileIds.set(key, id);
    const info = opts.media.get(key);
    const name = info?.name ?? key.split("/").pop() ?? key;
    const dur = info?.durationMs ? `<duration>${frames(info.durationMs, fps)}</duration>` : "";
    const media =
      kind === "video"
        ? `<media><video><samplecharacteristics>${rate(fps)}</samplecharacteristics></video><audio><channelcount>2</channelcount></audio></media>`
        : `<media><audio><channelcount>1</channelcount></audio></media>`;
    return `<file id="${id}"><name>${xmlEsc(name)}</name><pathurl>${xmlEsc(encodeURI(name))}</pathurl>${rate(fps)}${dur}${media}</file>`;
  };

  const marker = (name: string, lines: string[], at: number) =>
    `<marker><name>${xmlEsc(name)}</name><comment>${xmlEsc(lines.join("\n"))}</comment><in>${at}</in><out>-1</out></marker>`;

  const clipitem = (p: Placed, key: string, kind: "video" | "audio") => {
    n++;
    const info = opts.media.get(key);
    const srcDur = info?.durationMs ? frames(info.durationMs, fps) : p.out;
    return (
      `<clipitem id="clipitem-${n}"><name>${xmlEsc(clipName(p.cut.text))}</name><enabled>TRUE</enabled>` +
      `<duration>${Math.max(srcDur, p.out)}</duration>${rate(fps)}` +
      `<start>${p.start}</start><end>${p.end}</end><in>${p.in}</in><out>${p.out}</out>` +
      file(key, kind) +
      (kind === "audio" ? `<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>` : "") +
      /* A clip marker is in SOURCE frames: it sits at the clip's first frame. */
      marker(clipName(p.cut.text), markerLines(p, opts), p.in) +
      `</clipitem>`
    );
  };

  const video: string[] = [];
  const audio: string[] = [];
  for (const p of placed) {
    if (p.end <= p.start) continue;
    if (p.cut.audioOnly) audio.push(clipitem(p, p.cut.voiceKey ?? p.cut.sourceKey, "audio"));
    else {
      video.push(clipitem(p, p.cut.sourceKey, "video"));
      if (p.cut.voiceKey) audio.push(clipitem(p, p.cut.voiceKey, "audio"));
    }
  }

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="4">\n` +
    `<sequence id="sequence-1"><name>${xmlEsc(opts.name)}</name><duration>${total}</duration>${rate(fps)}` +
    `<timecode>${rate(fps)}<string>${timecode(HOUR * fps, fps)}</string><frame>${HOUR * fps}</frame><displayformat>NDF</displayformat></timecode>` +
    `<media><video><format><samplecharacteristics>${rate(fps)}<width>1920</width><height>1080</height><pixelaspectratio>square</pixelaspectratio></samplecharacteristics></format>` +
    `<track>\n${video.join("\n")}\n</track></video>` +
    `<audio><track>\n${audio.join("\n")}\n</track></audio></media>\n` +
    /* What this file is not, where somebody looking for the captions will look. Doc 09. */
    marker("From Aldershot", ["The cuts, in order. Captions, sound processing and graphics are rendered rather than described, so they are not in this file."], 0) +
    `\n</sequence>\n</xmeml>\n`
  );
}

/*
 * RESOLVE TAKES ITS MARKERS SEPARATELY.
 *
 * Resolve imports an XML's cuts and leaves its markers behind; the way in is
 * Timeline › Import › Timeline Markers from EDL, reading an edit list of its
 * own shape — an event line, then " |C:<colour> |M:<name> |D:<frames>". Two
 * things that shape does not forgive: two markers at one frame (Resolve keeps
 * one), and characters outside plain ASCII in the name.
 *
 * The first can't happen here, and why is worth saying: each marker sits at
 * its clip's first frame, `place` rounds the running total so starts only
 * ever move forward, and a clip shorter than its rounding — no frames at all
 * — is left out of both files, because no editor can hold it. The second is
 * handled by folding the name to ASCII, mapping the punctuation this product
 * actually writes rather than dropping it.
 */
const ASCII: Record<string, string> = { "“": '"', "”": '"', "‘": "'", "’": "'", "—": "-", "–": "-", "…": "...", "·": "-" };
export const toAscii = (s: string): string =>
  s.replace(/[\r\n|]+/g, " ").replace(/[^\x20-\x7E]/g, (ch) => ASCII[ch] ?? "").replace(/\s+/g, " ").trim();

export function resolveMarkers(edl: Edl, opts: XmemlOpts): string {
  const fps = opts.fps;
  let out = `TITLE: ${toAscii(opts.name).slice(0, 60)}\nFCM: NON-DROP FRAME\n\n`;
  let i = 0;
  for (const p of place(edl, fps)) {
    if (p.end <= p.start) continue;
    const at = HOUR * fps + p.start;
    const tc = timecode(at, fps), tc1 = timecode(at + 1, fps);
    const lines = markerLines(p, opts);
    const name = toAscii(lines.join(" - ")).slice(0, 200);
    /* Blue for the person's own footage, purple for anything labelled. */
    const colour = opts.notes?.has(p.cut.blockId) ? "ResolveColorPurple" : "ResolveColorBlue";
    out += `${String(++i).padStart(3, "0")}  001      V     C        ${tc} ${tc1} ${tc} ${tc1}  \n |C:${colour} |M:${name} |D:1\n\n`;
  }
  return out;
}
