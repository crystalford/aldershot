import { test } from "node:test";
import assert from "node:assert/strict";

import { buildSummary } from "../src/ui/pages/build.ts";

const beat = (o: Partial<{ kind: string; media_r2_key: string | null; clip_id: string | null }> = {}) => ({
  kind: "clip",
  media_r2_key: null,
  clip_id: null,
  ...o,
});

test("an empty project has not been started, not finished", () => {
  assert.equal(buildSummary([]), "nothing laid down yet.");
});

test("a beat with everything on it counts as filled", () => {
  const beats = [beat({ clip_id: "c1" }), beat({ kind: "vo", media_r2_key: "r2/a.mp3" })];
  assert.equal(buildSummary(beats), "every beat is filled.");
});

test("what is missing is named in the prototype's own phrasing", () => {
  const beats = [beat({ kind: "vo" }), beat({ kind: "vo" }), beat()];
  assert.equal(buildSummary(beats), "2 voiceovers, 1 clip to go.");
});

test("a reaction project says reactions, not voiceovers", () => {
  assert.equal(buildSummary([beat({ kind: "react" })], "reaction"), "1 reaction to go.");
});

test("the singular is not pluralised", () => {
  assert.equal(buildSummary([beat({ kind: "vo" })]), "1 voiceover to go.");
});

/*
 * A clip beat is filled by having a CLIP, a voice beat by having a RECORDING.
 * Checking media_r2_key on a clip beat would report every matched clip as
 * still missing, since a clip beat never has its own media.
 */
test("a matched clip beat is filled even though it has no media of its own", () => {
  assert.equal(buildSummary([beat({ clip_id: "c1", media_r2_key: null })]), "every beat is filled.");
});

test("a generated visual is outstanding until it has been generated", () => {
  assert.equal(buildSummary([beat({ kind: "generated" })]), "1 visual to go.");
  assert.equal(buildSummary([beat({ kind: "generated", media_r2_key: "r2/v.mp4" })]), "every beat is filled.");
});

test("the three kinds are reported in the prototype's order", () => {
  const beats = [beat({ kind: "generated" }), beat(), beat({ kind: "vo" })];
  assert.equal(buildSummary(beats), "1 voiceover, 1 clip, 1 visual to go.");
});

/*
 * A hand-picked clip has no score, no heat and no reason — a person chose it,
 * a model did not. The type allowed none of those to be null until Script grew
 * a "Make a short" action, which is the first thing in the product that
 * creates a clip without a pass behind it.
 */
test("a hand-picked clip is allowed to have no score", () => {
  const clip: import("../src/grounding.ts").ScoredClip = {
    start_ms: 0,
    end_ms: 1000,
    quote: "a line someone chose",
    why: null,
    score: null,
    heat: null,
  };
  assert.equal(clip.score, null);
  assert.equal(clip.quote, "a line someone chose");
});

/* ── Generated voice ──────────────────────────────────────────────────── */

import { wavDurationMs } from "../src/mp3.ts";

/** Builds a WAV whose header says exactly what we expect to read back. */
function wav({ seconds, rate = 44100, channels = 1, bits = 16, extraChunk = false }: {
  seconds: number; rate?: number; channels?: number; bits?: number; extraChunk?: boolean;
}): Uint8Array {
  const byteRate = (rate * channels * bits) / 8;
  const dataBytes = Math.round(byteRate * seconds);
  const extra = extraChunk ? 8 + 10 : 0;
  const buf = new Uint8Array(12 + 24 + extra + 8 + dataBytes);
  const view = new DataView(buf.buffer);
  const put = (o: number, s: string) => { for (let i = 0; i < s.length; i++) buf[o + i] = s.charCodeAt(i); };

  put(0, "RIFF"); view.setUint32(4, buf.length - 8, true); put(8, "WAVE");
  let o = 12;
  put(o, "fmt "); view.setUint32(o + 4, 16, true);
  view.setUint16(o + 8, 1, true); view.setUint16(o + 10, channels, true);
  view.setUint32(o + 12, rate, true); view.setUint32(o + 16, byteRate, true);
  view.setUint16(o + 20, (channels * bits) / 8, true); view.setUint16(o + 22, bits, true);
  o += 24;
  if (extraChunk) { put(o, "LIST"); view.setUint32(o + 4, 10, true); o += 18; }
  put(o, "data"); view.setUint32(o + 4, dataBytes, true);
  return buf;
}

test("a generated take reports its real length", () => {
  assert.equal(wavDurationMs(wav({ seconds: 7 })), 7000);
  assert.equal(wavDurationMs(wav({ seconds: 0.5 })), 500);
});

/*
 * Encoders insert LIST/fact chunks before the data. Assuming the canonical
 * 44-byte header reads the wrong numbers when they do, and a wrong dur_ms
 * misplaces every beat after it.
 */
test("a WAV with an extra chunk before the data is still measured correctly", () => {
  assert.equal(wavDurationMs(wav({ seconds: 3, extraChunk: true })), 3000);
});

test("rate and channel count are read, not assumed", () => {
  assert.equal(wavDurationMs(wav({ seconds: 2, rate: 22050, channels: 2 })), 2000);
});

/* Not-WAV returns 0 so the caller records "unknown" rather than a fiction. */
test("a buffer that isn't WAV measures as unknown, not as zero-length audio", () => {
  assert.equal(wavDurationMs(new Uint8Array(100)), 0);
  assert.equal(wavDurationMs(new Uint8Array([0xff, 0xfb, 0x90, 0x00])), 0);
});
