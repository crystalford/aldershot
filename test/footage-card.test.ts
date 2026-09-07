/**
 * What a video's card says, and which tabs exist.
 *
 * Footage is the page whose whole subject is "everything you have", and a
 * card said its title and the date — less than Clipping's little picker
 * strip, which has always said "11 clips found". Neither the clips a video
 * yielded nor the edits being made from it appeared anywhere on the surface
 * built to show you your library.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderFootageFull, type SourceRow } from "../src/ui/pages/footage.ts";

const source = (over: Partial<SourceRow> = {}): SourceRow => ({
  id: "s1",
  title: "Kino Casino #372",
  filename: "kino.mp4",
  duration_s: 2880,
  transcript_state: "ready",
  poster_r2_key: "poster.jpg",
  created_at: Date.UTC(2026, 8, 6),
  clip_count: 11,
  edit_count: 2,
  ...over,
});

const videos = (over: Partial<SourceRow> = {}) =>
  renderFootageFull({
    tab: "sources",
    sources: [source(over)],
    moments: [],
    momentCount: 0,
    threads: [],
    mode: "exact",
    q: "",
    meaningUnavailable: false,
    canMean: false,
    thread: null,
    sort: "newest",
  });

test("a card says what has come out of the video and what is being made from it", () => {
  const html = videos();
  assert.match(html, /11 clips/);
  assert.match(html, /2 edits/);
});

test("one of each is not pluralised", () => {
  const html = videos({ clip_count: 1, edit_count: 1 });
  assert.match(html, /1 clip · 1 edit/);
});

test("a zero is not a verdict on the video", () => {
  /* "0 clips" on a video nobody has scanned reads as the model finding
     nothing in it, rather than as nobody having looked. */
  const html = videos({ clip_count: 0, edit_count: 0 });
  assert.doesNotMatch(html, /0 clip/);
  assert.doesNotMatch(html, /0 edit/);
  assert.match(html, /6 Sept/);
});

test("Videos and Clips are offered; Find is not, because it does nothing", () => {
  /* Its whole content is a disabled field and "isn't switched on yet" — the
     same rule this file already applies to Threads. */
  const html = videos();
  assert.match(html, /Videos/);
  assert.match(html, /Clips/);
  assert.doesNotMatch(html, /tab=find/);
});

test("Find is still reachable by URL, so it comes back by flipping one condition", () => {
  const html = renderFootageFull({
    tab: "find",
    sources: [source()],
    moments: [],
    momentCount: 0,
    threads: [],
    mode: "exact",
    q: "",
    meaningUnavailable: false,
    canMean: false,
    thread: null,
    sort: "newest",
  });
  assert.match(html, /tab=find/);
  assert.match(html, /Find a moment in a video you don't have yet/);
});

test("the video grid does not leave empty tracks beside a short library", () => {
  /* auto-fill puts two videos in a four-track grid with two blanks beside
     them, which is why this page read as half empty. */
  assert.doesNotMatch(videos(), /auto-fill/);
});
