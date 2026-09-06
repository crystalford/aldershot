import { test } from "node:test";
import assert from "node:assert/strict";

import { audioKeyFor, isAudio } from "../src/audio.ts";
import { SINGLE_CALL_MAX_BYTES } from "../src/transcribe.ts";
import { CHUNK_MS } from "../src/longaudio.ts";

test("the audio key is derived from the source key, so extraction is idempotent", () => {
  assert.equal(
    audioKeyFor("u/abc/sources/xyz/original.mp4"),
    "u/abc/sources/xyz/original.audio.mp3",
  );
  // Twice over the same key must land in the same place, or a retry pays for
  // the extraction again and orphans the first one.
  const once = audioKeyFor("u/a/s/b/original.MOV");
  assert.equal(audioKeyFor("u/a/s/b/original.MOV"), once);
});

test("a file that is already audio is not sent through the extractor", () => {
  for (const f of ["talk.mp3", "voice.m4a", "take.WAV", "podcast.flac", "note.opus"]) {
    assert.equal(isAudio(f), true, f);
  }
  for (const f of ["DJI_20260905043337_0026_D.MP4", "clip.mov", "stream.mkv", "b.webm"]) {
    assert.equal(isAudio(f), false, f);
  }
  assert.equal(isAudio(null, "audio/mpeg"), true);
  assert.equal(isAudio("x.mp4", "video/mp4"), false);
});

/*
 * The limit that actually matters is the Worker's memory, not the API's.
 * Whisper takes base64, so a call costs the buffer plus a UTF-16 string of
 * 1.33x its length — about 3.7x all in. The old 50MB implied ~180MB against a
 * 128MB ceiling, which is the failure a drone clip hit.
 */
const WORKER_MEMORY_BYTES = 128 * 1024 * 1024;
const costOf = (bytes: number) => bytes + bytes * 1.34 * 2;

test("a single-call transcription fits in a Worker with headroom", () => {
  const cost = costOf(SINGLE_CALL_MAX_BYTES);
  assert.ok(
    cost < WORKER_MEMORY_BYTES * 0.7,
    `a full single call costs ~${Math.round(cost / 1e6)}MB, too close to the 128MB limit`,
  );
});

test("one chunk of extracted audio fits too", () => {
  // 32kbps mono, which is what the container writes.
  const bytesPerMs = 32000 / 8 / 1000;
  const cost = costOf(CHUNK_MS * bytesPerMs);
  assert.ok(
    cost < WORKER_MEMORY_BYTES * 0.7,
    `a chunk costs ~${Math.round(cost / 1e6)}MB, too close to the 128MB limit`,
  );
});

test("extracted audio keeps long sources within one chunk each", () => {
  const bytesPerMs = 32000 / 8 / 1000;
  const hours = (CHUNK_MS * bytesPerMs) / (1024 * 1024);
  assert.ok(hours < 20, "a chunk should be tens of MB, not hundreds");
});
