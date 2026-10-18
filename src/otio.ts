/**
 * THE ESCAPE HATCH: this cut, as a timeline somebody else's editor can open.
 *
 * Doc 09 calls OTIO "the escape hatch to Resolve or Premiere — lossy for
 * kinetic type and ducking curves, and that is fine", and Phase 1's
 * acceptance asks that it open in Resolve with the cuts intact. It is the
 * promise that this product is not a trap: the edit is data, and the data
 * leaves.
 *
 * PURE, like the rest of src/edl.ts. What goes in an export is decided here
 * and is therefore testable without a container, an encoder or a video file.
 *
 * WHAT THE TIMELINE CARRIES BESIDES THE CUTS. `metadata.aldershot` on every
 * clip: which source it came from, which words, and where those words' times
 * came from. That is invariant 4 at the edge of the product — a cut opened
 * in somebody else's editor and finished there still knows what it is made
 * of. An NLE ignores metadata it does not recognise, so it costs nothing.
 */

import type { Edl, EdlCut } from "./edl.ts";
import type { TimingSource } from "./align.ts";

/**
 * MILLISECONDS ARE THE TIME BASE, and that is a statement about what we know.
 *
 * OTIO counts in RationalTime(value, rate), so a timeline has to declare one.
 * This product has never measured a source's frame rate — there is no column
 * for it and nothing probes for it — so declaring 25 would be inventing a
 * number, which is the thing this codebase refuses to do everywhere else.
 *
 * A rate of 1000 says exactly what is true: every boundary is known to the
 * millisecond. An NLE conforms on import to whatever timeline rate it is set
 * to, rounding each edit to its nearest frame — a maximum error of 20 ms at
 * 25fps, which is the same 20 ms a forced timing is worth (src/align.ts).
 * Asserting the wrong rate would move every cut; this moves none and lets
 * the tool that knows the footage do the rounding.
 */
export const RATE = 1000;

const time = (ms: number) => ({ OTIO_SCHEMA: "RationalTime.1", rate: RATE, value: Math.round(ms) });

const range = (startMs: number, durationMs: number) => ({
  OTIO_SCHEMA: "TimeRange.1",
  start_time: time(startMs),
  duration: time(durationMs),
});

export interface MediaInfo {
  /** What the file is called, so an editor can relink it. */
  name: string;
  /** How long the whole source is, when it is known. */
  durationMs?: number | null;
}

export interface OtioOpts {
  /** The timeline's name, which is the project's. */
  name: string;
  /** Source key → what to call its file. Anything missing falls back to the key. */
  media: Map<string, MediaInfo>;
  /** Where this cut's word timings came from, for the receipt on every clip. */
  timing: TimingSource;
}

/*
 * A CLIP IS NAMED AFTER WHAT IS SAID IN IT.
 *
 * An NLE shows clip names in the timeline, and "u_7f3a/2024-03-tuesday.mp4"
 * in forty consecutive slots tells an editor nothing. The first few words do,
 * and they are the only thing on that strip of timeline a person could use to
 * find their place.
 */
export function clipName(text: string, max = 48): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (!one) return "clip";
  return one.length <= max ? one : one.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

function mediaReference(key: string, info: MediaInfo | undefined) {
  return {
    OTIO_SCHEMA: "ExternalReference.1",
    metadata: {},
    name: info?.name ?? key,
    /*
     * A RELATIVE NAME, not a URL into our storage.
     *
     * Every link this product could put here is presigned and expires, so an
     * .otio carrying one would open correctly today and relink to nothing
     * next week — which is worse than not opening, because the failure
     * arrives after the person has moved on. A bare filename is what an NLE
     * relinks against the folder it was pointed at, which is the workflow
     * somebody taking an edit elsewhere is already in.
     */
    target_url: info?.name ?? key,
    available_range: info?.durationMs ? range(0, info.durationMs) : null,
    available_image_bounds: null,
  };
}

/*
 * Clip.1, not Clip.2, and on purpose.
 *
 * Clip.2 replaced `media_reference` with `media_references` plus an active
 * key. OTIO upgrades a 1 to a 2 when it reads one, and cannot downgrade a 2
 * for an older reader — so writing 1 is understood by everything that
 * understands either, and writing 2 is understood by the half that is new.
 */
function clip(c: EdlCut, opts: OtioOpts, info: MediaInfo | undefined) {
  return {
    OTIO_SCHEMA: "Clip.1",
    metadata: {
      aldershot: {
        sourceKey: c.sourceKey,
        /* Which words, and what the times behind them are worth. A receipt
           that travels with the clip. */
        quote: c.text,
        timing: opts.timing,
        ...(c.voiceKey ? { voiceOver: c.voiceKey } : {}),
      },
    },
    name: clipName(c.text),
    source_range: range(c.start_ms, c.end_ms - c.start_ms),
    effects: [],
    markers: [],
    enabled: true,
    media_reference: mediaReference(c.sourceKey, info),
  };
}

function gap(durationMs: number, name: string) {
  return {
    OTIO_SCHEMA: "Gap.1",
    metadata: {},
    name,
    source_range: range(0, durationMs),
    effects: [],
    markers: [],
    enabled: true,
  };
}

function track(name: string, kind: "Video" | "Audio", children: unknown[]) {
  return {
    OTIO_SCHEMA: "Track.1",
    metadata: {},
    name,
    source_range: null,
    effects: [],
    markers: [],
    enabled: true,
    kind,
    children,
  };
}

/**
 * The timeline.
 *
 * TWO TRACKS, because this product has two kinds of sound that are not the
 * same thing. V1 is the picture, in order, one clip per EDL cut. A1 carries
 * only what is NOT a clip's own audio: a recorded voiceover mixed over a
 * range, and a voiceover that has no picture at all.
 *
 * A1 is therefore mostly gaps, and the gaps are load-bearing: they are what
 * holds each voice clip at the right moment. A track that simply listed the
 * voice clips would stack them at the head of the timeline, which is the
 * failure that looks fine until you press play.
 */
export function buildOtio(edl: Edl, opts: OtioOpts): unknown {
  const video: unknown[] = [];
  const audio: unknown[] = [];
  /* How much A1 is already filled, so a gap can be sized rather than guessed. */
  let audioAt = 0;
  let at = 0;

  for (const c of edl.cuts) {
    const dur = Math.max(0, c.end_ms - c.start_ms);
    const info = opts.media.get(c.sourceKey);

    /*
     * A CUT WITH SOUND BUT NO PICTURE IS A HOLE IN THE PICTURE.
     *
     * The renderer treats it as a special case (src/edl.ts: a .webm of
     * somebody talking has no video stream). A timeline has a place for it
     * already: a gap on V1 and the recording on A1, which is what it is.
     */
    if (c.audioOnly) {
      video.push(gap(dur, clipName(c.text)));
      if (audioAt < at) audio.push(gap(at - audioAt, "—"));
      audio.push(clip(c, opts, opts.media.get(c.voiceKey ?? c.sourceKey)));
      audioAt = at + dur;
    } else {
      video.push(clip(c, opts, info));
      /* A voiceover mixed OVER this range rides on A1 beside the picture. */
      if (c.voiceKey) {
        if (audioAt < at) audio.push(gap(at - audioAt, "—"));
        audio.push(clip(c, opts, opts.media.get(c.voiceKey)));
        audioAt = at + dur;
      }
    }
    at += dur;
  }

  const tracks = [track("V1", "Video", video)];
  /* No voice anywhere means no audio track, rather than an empty one: an
     empty track is a thing an editor has to notice and delete. */
  if (audio.length) tracks.push(track("A1", "Audio", audio));

  return {
    OTIO_SCHEMA: "Timeline.1",
    metadata: {
      aldershot: {
        /*
         * WHAT THIS FILE IS NOT.
         *
         * Doc 09: lossy for kinetic type and ducking curves. Captions, the
         * sound chain and burned-in graphics are rendered, not described, so
         * they are not here — and a person who opens this in Resolve and
         * wonders where the captions went should find the answer in the file
         * rather than in a support thread.
         */
        note:
          "The cuts, in order, from Aldershot. Captions, sound processing and " +
          "graphics are rendered rather than described and are not in this file.",
        timing: opts.timing,
        durationMs: edl.durationMs,
      },
    },
    name: opts.name,
    global_start_time: null,
    tracks: {
      OTIO_SCHEMA: "Stack.1",
      metadata: {},
      name: "tracks",
      source_range: null,
      effects: [],
      markers: [],
      enabled: true,
      children: tracks,
    },
  };
}

/** The file itself. Two-space JSON, which is what otiotool writes. */
export function otioJson(edl: Edl, opts: OtioOpts): string {
  return JSON.stringify(buildOtio(edl, opts), null, 2) + "\n";
}
