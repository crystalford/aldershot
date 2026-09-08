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
    exports: [],
    exportCount: 0,
    edits: [],
    editsCount: 0,
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
    exports: [],
    exportCount: 0,
    edits: [],
    editsCount: 0,
  });
  assert.match(html, /tab=find/);
  assert.match(html, /Find a moment in a video you don't have yet/);
});

test("the video grid fills the row rather than stranding the leftover", () => {
  /* The first version of this banned auto-fill and aimed at the wrong half.
     The problem is a PIXEL max: capped at 240px, a 960px column fits three
     cards and leaves 208px dead on every row — "it looks weird having only 3
     and then blank space". 1fr shares the row out; auto-fill keeps the track
     count steady so two videos do not balloon to half the page each. */
  const html = videos();
  assert.match(html, /repeat\(auto-fill,minmax\(min\(210px,100%\),1fr\)\)/);
  assert.doesNotMatch(html, /minmax\([^)]*,\s*\d+px\)/, "a px cap is back");
});
