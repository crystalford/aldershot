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
import { DEFAULT_PREF, nextPref, prefOf } from "../src/outside.ts";

const base: RoomData = {
  tab: "videos",
  outsidePref: "ask",
  attached: [],
  threads: [],
  mode: "meaning" as const,
  who: "all" as const,
  ext: [],
  q: "",
  meaningUnavailable: false,
  working: [],
  sources: [],
  moments: [],
  projects: [],
  counts: { sources: 0, moments: 0, external: 0 },
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
    counts: { sources: 1, moments: 0, external: 0 },
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
      counts: { sources: 1, moments: 0, external: 0 },
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
  const none = renderRoom({ ...base, counts: { sources: 2, moments: 9, external: 0 } });
  assert.match(none, /2 videos read · 9 moments/);
  assert.ok(!/thread/.test(none.slice(none.indexOf("2 videos read"), none.indexOf("2 videos read") + 80)));

  const some = renderRoom({
    ...base,
    counts: { sources: 1, moments: 1, external: 0 },
    threads: [
      { name: "the house", moments: 4 },
      { name: "what it costs", moments: 3 },
      { name: "landing it", moments: 2 },
    ],
  });
  assert.match(some, /1 video read · 1 moment · 3 threads/, "and it counts singulars properly");
  /* The count in the title row is the LENGTH OF THE LIST the paragraph
     names. It used to be a separate number carried beside it, which is the
     shape of the bug this file has had three times. */
  assert.match(some, /3 threads run through 1 video/);
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

/**
 * THE SCOUT ROW, AND WHY ITS WORDS ARE NOT IN THE CLIENT.
 *
 * The prototype's MAKE column ends with it; the build's did not, which meant
 * the preference for whether Scout may go outside your own footage could only
 * be set inside a project — a place you reach by having already decided.
 */
test("the Scout row says what is true right now, in all three states", () => {
  for (const [pref, pill, line] of [
    ["always", "On", "on for every project"],
    ["ask", "Per project", "bring him into a project"],
    ["never", "Off", "your footage only"],
  ] as const) {
    const html = renderRoom({ ...base, outsidePref: pref });
    assert.match(html, new RegExp(`id="scoutPref"[^>]*data-pref="${pref}"`));
    assert.match(html, new RegExp(`id="scoutPref"[^>]*>${pill}</span>`));
    assert.match(html, new RegExp(`id="scoutRowLine"[^>]*>[^<]*${line}`));
  }
});

test("the row carries every state, so the client never restates the copy", () => {
  /*
   * src/ui/client.ts is one String.raw template with NO interpolation in it,
   * so a client that repainted the pill would have to hold "On" and "Per
   * project" and all three lines in a second place — and the day one is
   * reworded the two disagree, but only after you press something. Every
   * state rides along on the row; the client reads the one the server names.
   */
  const html = renderRoom(base);
  for (const p of ["always", "ask", "never"] as const) {
    assert.match(html, new RegExp(`data-pill-${p}="[^"]+"`), `the row must carry ${p}'s pill`);
    assert.match(html, new RegExp(`data-line-${p}="[^"]+"`), `the row must carry ${p}'s line`);
  }
  const client = readFileSync(join(import.meta.dirname, "..", "src", "ui", "client.ts"), "utf8");
  for (const word of ["Per project", "your footage only", "on for every project"]) {
    assert.ok(
      !client.includes(word),
      `client.ts must not restate ${JSON.stringify(word)} — read it off the row`,
    );
  }
  assert.match(client, /getAttribute\("data-pill-" \+ pref\)/);
});

test("both halves of the Scout row are bound, and the pill is the inner one", () => {
  /*
   * TWO CONTROLS IN ONE ROW. The row seeds the composer; the pill cycles the
   * preference. The gate cannot see this: `wiring` checks that an id the
   * client looks up is rendered by a page, which is true of a control with
   * no listener at all — and "six controls that looked like they started
   * something and reloaded the page unchanged" is a thing that already
   * shipped here once.
   *
   * stopPropagation is load-bearing, not tidiness: without it, pressing the
   * pill also fires the row, so turning Scout off would retype the composer
   * on the way past.
   */
  const client = readFileSync(join(import.meta.dirname, "..", "src", "ui", "client.ts"), "utf8");
  const block = client.slice(client.indexOf('const scoutRow = $("#scoutRow")'));
  assert.ok(block, "the client must look the row up");
  /*
   * ON THE SAME LINE as the registration, not merely somewhere after it. The
   * first version of this sliced from the click handler to the seed function
   * and looked for stopPropagation anywhere inside — and the KEYDOWN handler
   * sits in that window, so deleting it from the click handler left the
   * assertion green. Caught by breaking it.
   */
  assert.match(
    block,
    /pill\.addEventListener\("click",[^\n]*stopPropagation/,
    "the pill must cycle on click, without also firing the row",
  );
  assert.match(block, /pill\.addEventListener\("keydown"/, "and on a key, since it carries role=button");
  assert.match(block, /scoutRow\.addEventListener\("click"/, "the row must seed the composer");
  /* And the same on the key, for the same reason. */
  assert.match(block, /e\.stopPropagation\(\);\n\s*cycle\(\);/);
});

test("the cycle runs down, and comes back round", () => {
  /* On → Per project → Off → On. Down first, because a person turning Scout
     off should press once and see it go down, not up. */
  assert.equal(nextPref("always"), "ask");
  assert.equal(nextPref("ask"), "never");
  assert.equal(nextPref("never"), "always");
  /* Three presses is where you started, which is what makes it a cycle and
     not a dead end at Off. */
  assert.equal(nextPref(nextPref(nextPref("always"))), "always");
});

test("an unreadable preference is the cautious one, not a throw", () => {
  /*
   * Going outside somebody's own footage is opt-in per project, so a null
   * column — every account that existed before this shipped — must read as
   * "ask" rather than "always". A migration that defaulted the other way
   * would switch Scout on for everyone who had never been asked.
   */
  assert.equal(prefOf(null), "ask");
  assert.equal(prefOf(undefined), "ask");
  assert.equal(prefOf("yes please"), "ask");
  assert.equal(DEFAULT_PREF, "ask");
  assert.notEqual(DEFAULT_PREF, "always");
});
