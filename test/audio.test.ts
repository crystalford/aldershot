import { test } from "node:test";
import assert from "node:assert/strict";

import { audioKeyFor, extractAudio, isAudio } from "../src/audio.ts";
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

test("extracting the audio uses the small container, not the encoder", async () => {
  /*
   * A SILENT COST, WHICH IS WHY THIS IS A TEST AND NOT A COMMENT.
   *
   * `extract-full` is `-vn -ac 1 -ar 16000 -codec:a libmp3lame -b:a 32k`: the
   * video is discarded and libmp3lame is single-threaded, so it uses about one
   * core however many it is given. On the render container — standard-4, four
   * vCPU and twelve GiB — three of those cores and most of that memory were
   * bought and idled on every upload in the product.
   *
   * AUDIO is standard-2: one whole vCPU, so the same wall-clock speed for half
   * the memory. Route it back to RENDER and nothing breaks, no test fails and
   * no page changes — it simply costs what it used to. That is exactly the
   * failure a comment does not catch.
   */
  const used: string[] = [];
  const ns = (tag: string) => ({
    idFromName: (n: string) => ({ tag, n }) as never,
    get: (id: never) => {
      used.push(tag);
      return {
        fetch: async () =>
          new Response(new Blob(["x"]).stream(), { status: 200, headers: { "content-type": "audio/mpeg" } }),
      };
    },
  });

  const base = {
    MEDIA: {
      head: async () => null,
      put: async () => ({ size: 1 }),
    },
    MEDIA_PUBLIC_BASE: "https://example.test",
  };

  await extractAudio(
    { ...base, RENDER: ns("render"), AUDIO: ns("audio") } as never,
    "u/1/sources/a/original.mp4",
  ).catch(() => {});
  assert.deepEqual(used, ["audio"], "the extract must go to the small container");

  /*
   * And it still reads a video on a Worker deployed before that container
   * exists. The binding is new; failing every upload until the container is
   * created would be a worse bug than the cost it fixes.
   */
  used.length = 0;
  await extractAudio(
    { ...base, RENDER: ns("render") } as never,
    "u/1/sources/a/original.mp4",
  ).catch(() => {});
  assert.deepEqual(used, ["render"], "with no AUDIO binding it must fall back, not fail");
});

test("every call into a container can time out", async () => {
  /*
   * A HUNG REQUEST IS A MACHINE THAT NEVER SLEEPS.
   *
   * @cloudflare/containers will not sleep while any request is outstanding —
   * `isActivityExpired` renews the timeout instead — so a container call with
   * no deadline is an instance billing its full allocated memory until the
   * Durable Object is evicted. Seven of those, awake around the clock, is the
   * $20 day this test exists because of.
   *
   * `extract-full` was the only one without a signal, and it is the only one
   * that runs on EVERY upload. It also silently defeated the release in its
   * own `finally`: that runs when the await returns, and a hang never returns.
   *
   * Asserted by reading the source rather than by driving a container, because
   * what is being protected is that the deadline is WRITTEN — and asserted
   * over every call site at once, so the next one added inherits the rule
   * instead of repeating the bug.
   */
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const root = join(import.meta.dirname, "..", "src");

  const unbounded: string[] = [];
  let sites = 0;
  for (const file of ["audio.ts", "proxy.ts", "encode.ts"]) {
    const src = readFileSync(join(root, file), "utf8");
    const lines = src.split("\n");
    lines.forEach((line, i) => {
      if (!/fetch\(\s*[`"]?http:\/\/container/.test(line)) return;
      sites++;
      /* Walk to the line that closes the options object. Not a fixed window:
         a long comment inside the options is exactly what hid this the first
         time the check was written. */
      let body = "";
      for (let j = i; j < lines.length; j++) {
        body += lines[j] + "\n";
        if (/^\s*\}\);\s*$/.test(lines[j])) break;
      }
      if (!/signal:/.test(body)) unbounded.push(`${file}:${i + 1}`);
    });
  }

  /* The check that keeps the check honest: an empty list must mean "all
     bounded", never "found nothing to look at". */
  /* Six: render start, status poll, collect the file, proxy, extract-full, and
     collecting the poster the proxy pass leaves behind. The count is asserted
     so that a new call site has to be looked at rather than silently inheriting
     an empty result — which is how this check was caught passing vacuously the
     first time it was written. */
  assert.equal(sites, 6, "expected 6 container call sites; the matcher has drifted");

  assert.deepEqual(unbounded, [], "a container call with no deadline never lets its instance sleep");
});
