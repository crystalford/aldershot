/**
 * The room, and the two crashes found by opening it.
 *
 * It is the front door now, so the things it reads have to survive data that
 * is not quite what the code expected — a column written by an older build, a
 * state renamed, a row seeded by hand. The failure mode on this surface is
 * not a wrong number, it is a 500 on the page everything else starts from.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderRoom, type RoomData } from "../src/ui/pages/room.ts";

const base: RoomData = {
  tab: "videos",
  q: "",
  meaningUnavailable: false,
  working: [],
  sources: [],
  moments: [],
  projects: [],
  counts: { sources: 0, moments: 0, threads: 0 },
};

test("an unknown transcript state renders rather than crashing the page", () => {
  /*
   * stateChip in footage.ts destructured map[state] directly, so a value
   * outside the four threw on undefined and took the WHOLE page down — one
   * unexpected string in one column and the library is unreachable. Found by
   * seeding a row with 'done'. The room reads the same column, so it is
   * pinned on both sides.
   */
  const src = readFileSync(join(import.meta.dirname, "..", "src", "ui", "pages", "footage.ts"), "utf8");
  assert.match(src, /map\[state\]\s*\?\?/, "footage.ts must fall back, not destructure undefined");

  const html = renderRoom({
    ...base,
    sources: [{ id: "s1", title: "Tuesday", poster_r2_key: null, transcript_state: "something-new", duration_s: null, clips: 0 }],
    counts: { sources: 1, moments: 0, threads: 0 },
  });
  assert.match(html, /Tuesday/);
});

test("the room names the four real transcript states", () => {
  /*
   * The first version checked for "done" and "error", which the column never
   * holds (src/sources.ts: pending · running · ready · failed), so every
   * video would have read "reading" for ever — a wrong label that nothing
   * would ever have reported, because it never crashes.
   */
  const say = (state: string) =>
    renderRoom({
      ...base,
      sources: [{ id: "s1", title: "T", poster_r2_key: null, transcript_state: state, duration_s: null, clips: 0 }],
      counts: { sources: 1, moments: 0, threads: 0 },
    });
  assert.match(say("ready"), />read</);
  assert.match(say("running"), />reading</);
  assert.match(say("failed"), /couldn&#39;t read it|couldn't read it/);
  assert.match(say("pending"), />queued</);
});

test("counts are what was counted, and a zero is not mentioned", () => {
  /* A number that cannot be computed honestly is not shown — the same rule
     the clean-up chips follow. A library with no threads says nothing about
     threads rather than claiming nought. */
  const none = renderRoom({ ...base, counts: { sources: 2, moments: 9, threads: 0 } });
  assert.match(none, /2 videos read · 9 moments/);
  assert.ok(!/thread/.test(none.slice(none.indexOf("2 videos read"), none.indexOf("2 videos read") + 80)));

  const some = renderRoom({ ...base, counts: { sources: 1, moments: 1, threads: 3 } });
  assert.match(some, /1 video read · 1 moment · 3 threads/, "and it counts singulars properly");
});

test("a search that matched nothing is not an empty library", () => {
  /*
   * Two different facts with two different answers. Telling somebody with
   * four hundred moments to "add a clip back" because their search missed is
   * the kind of wrong that reads as broken.
   */
  const searched = renderRoom({ ...base, tab: "highlights", q: "turpentine" });
  assert.match(searched, /No footage yet/);
  assert.ok(!/add a clip back/.test(searched));

  const untouched = renderRoom({ ...base, tab: "highlights" });
  assert.match(untouched, /Nothing kept yet — add a clip back/);
});

test("the working row appears only when something is working", () => {
  /* It polls, so rendering it with nothing in it would leave a progress line
     that never moves — worse than showing none. */
  assert.ok(!/id="workingRow"/.test(renderRoom(base)));
  const busy = renderRoom({
    ...base,
    working: [{ label: "Tuesday · kitchen", type: "transcribe", stage: "reading it", pct: 42 }],
  });
  assert.match(busy, /id="workingRow"/);
  assert.match(busy, /transcribing Tuesday · kitchen \(42%\)/);
});

test("the composer is the room's, not a copy of it", () => {
  /*
   * client.ts wires the ask box by id. Two renderings of those ids that
   * drifted would leave one surface silently dead, and no check would catch
   * it because every id would still exist somewhere. So the room imports
   * Home's composer, and this is what says so.
   */
  const html = renderRoom(base);
  for (const id of ["composer", "brief", "filePick", "dropHint", "attached", "clearFile"]) {
    assert.match(html, new RegExp(`id="${id}"`), `the room must render #${id}`);
  }
  const room = readFileSync(join(import.meta.dirname, "..", "src", "ui", "pages", "room.ts"), "utf8");
  assert.match(room, /import \{[^}]*composer[^}]*\} from "\.\/home\.ts"/, "imported, not reimplemented");
});
