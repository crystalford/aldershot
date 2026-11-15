/**
 * THE PROJECT SWITCHER — the caret beside the title.
 *
 * One Take's second row opens with the title and a small triangle; pressing
 * it drops the list of projects with the open one marked. The build rendered
 * the title as plain text, so moving between projects meant leaving the
 * editor, landing in the room, finding the Projects tab and picking one —
 * four moves for something the design does in two.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { edited, meta, switcher, type SwitchItem } from "../src/ui/switcher.ts";

const item = (over: Partial<SwitchItem> = {}): SwitchItem => ({
  id: "p1",
  title: "Whether to leave",
  runtime_s: 359,
  poster_r2_key: null,
  updated_at: Date.now(),
  ...over,
});

test("the open project is the one marked open", () => {
  const html = switcher("Whether to leave", [item(), item({ id: "p2", title: "Kino casino" })], "p1");
  const rows = html.split('class="switch-row"').slice(1);
  assert.equal(rows.length, 2);
  assert.match(rows[0], /^[^]*?>open</, "the one you are in says so");
  assert.ok(!/>open</.test(rows[1]), "and the one you are not in does not");
});

test("in the room, the room is the one marked open", () => {
  /* The same control in both states — that is the point of it. With no
     project open the mark belongs on the way back, not on a project. */
  const html = switcher("Your footage", [item()], null);
  assert.match(html, /class="switch-room"[^>]*>[^]*?>open</);
  const row = html.split('class="switch-row"')[1].split("</a>")[0];
  assert.ok(!/>open</.test(row), "no project is open");
});

test("every row is a link, so it works with the client switched off", () => {
  /* And a middle click opens a project in a new tab, which is what a person
     expects of a list of things to go to. */
  const html = switcher("Your footage", [item({ id: "abc" })], null);
  assert.match(html, /<a class="switch-row" href="\/p\/abc\/cut"/);
  assert.match(html, /<a class="switch-room" href="\/"/);
});

test("the panel starts closed", () => {
  /* It is rendered on every page. Rendered open it would cover the title of
     whatever you just opened. */
  assert.match(switcher("x", [item()], null), /id="switcherPanel" hidden/);
});

test("the meta line says only what is stored", () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  assert.equal(meta(item({ runtime_s: 359, updated_at: now }), now), "5:59 · edited just now");
  /* A cut that has never been assembled has no runtime, so the line does not
     claim one — the same rule the archive card and the clean-up chips
     follow. */
  assert.equal(meta(item({ runtime_s: null, updated_at: now }), now), "edited just now");
  assert.equal(meta(item({ runtime_s: 0, updated_at: now }), now), "edited just now");
});

test("edited just now is not edited 0m ago", () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  assert.equal(edited(now - 10_000, now), "edited just now");
  assert.equal(edited(now - 5 * 60_000, now), "edited 5m ago");
  assert.equal(edited(now - 3 * 3600_000, now), "edited 3h ago");
  assert.equal(edited(now - 50 * 3600_000, now), "edited 2d ago");
});

test("an account with no projects still offers the way back", () => {
  const html = switcher("Your footage", [], null);
  assert.ok(!html.includes('class="switch-row"'), "nothing to list");
  assert.match(html, /Nothing on the go/);
  assert.match(html, /class="switch-room"/, "and the room is still there");
});

test("one way back, not two", () => {
  /*
   * The prototype's panel ends with "+ New project" AND "Your footage — no
   * project open", because there the first also clears the attached footage
   * and the composer. Here the room holds its selection in the URL, so
   * going to / IS both — and two controls that do exactly the same thing is
   * the failure this codebase shipped once already, as six MAKE cards
   * linking to a query nobody read.
   */
  const html = switcher("Your footage", [item()], null);
  assert.equal((html.match(/href="\/"/g) ?? []).length, 1);
  assert.ok(!/New project/.test(html));
});

test("the client only opens and closes it", () => {
  const client = readFileSync(join(import.meta.dirname, "..", "src", "ui", "client.ts"), "utf8");
  const block = client.slice(client.indexOf('const switcherBtn = $("#switcher")'));
  /*
   * ON THE CLICK HANDLER ITSELF. The slice runs to the end of the file and
   * stopPropagation appears in it twice — the Scout pill has one — so a
   * bare search for it stayed green with this one deleted. Caught by
   * breaking it.
   */
  assert.match(
    block,
    /switcherBtn\.addEventListener\("click", \(e\) => \{\n\s*e\.stopPropagation\(\);/,
    "without it the document handler shuts the panel on the same click that opened it",
  );
  assert.match(block, /if \(e\.key === "Escape"\) shut\(\);/);
  assert.match(block, /if \(switcherPanel\.contains\(e\.target\)\) return;/, "clicking inside must not close it");
  /* No navigation in here. The rows are links. */
  const mine = block.slice(0, block.indexOf("\n}\n"));
  assert.ok(!/location\s*=|location\.href|location\.assign/.test(mine), "the client must not navigate");
  /*
   * AND IT SHUTS ON A ROW. Most rows navigate and take the panel with
   * them; the row for the project you are IN, and "Your footage" while you
   * are in the room, lead where you already are — the page does not move
   * and the panel sits open over the title it came out of.
   */
  assert.match(mine, /querySelectorAll\("\.switch-row, \.switch-room"\)/);
  assert.match(mine, /row\.addEventListener\("click", shut\);/);
});

/**
 * THE SOURCE CHIPS — a lettered square per video the cut is made of.
 *
 * One Take puts them in the title row. They are how a person follows "which
 * video is this line from" down a page of blocks without a filename on
 * every one.
 */
import { CHIP_COLOURS, chipTitle, letterFor, sourceChips } from "../src/ui/switcher.ts";

const src = (id: string, title: string, duration_s: number | null = 2466) => ({ id, title, duration_s });

test("the letters are positional, not initials", () => {
  /*
   * Two videos called "Tuesday" would both read T, and the letter exists to
   * tell them apart. A is the first video the cut uses.
   */
  const html = sourceChips([src("s1", "Tuesday · kitchen"), src("s2", "Tuesday · the drive")]);
  const letters = [...html.matchAll(/>([A-Z]+)<\/a>/g)].map((m) => m[1]);
  assert.deepEqual(letters, ["A", "B"]);
});

test("a chip names its video and how long it is", () => {
  assert.equal(chipTitle(src("s1", "Tuesday · kitchen", 2466)), "Tuesday · kitchen · 41:06");
  /* A video whose length is not known yet does not claim one. */
  assert.equal(chipTitle(src("s1", "Tuesday · kitchen", null)), "Tuesday · kitchen");
  assert.equal(chipTitle(src("s1", "Tuesday · kitchen", 0)), "Tuesday · kitchen");
});

test("each chip goes to its video", () => {
  const html = sourceChips([src("abc", "Tuesday")]);
  assert.match(html, /<a href="\/sources\/abc"/);
});

test("no videos, no chips — not an empty row", () => {
  assert.equal(sourceChips([]), "");
});

test("the colours are the design's, and they run out honestly", () => {
  /* Past five one-letter labels stop being distinguishable by colour, so it
     starts again rather than inventing a sixth accent — src/ui/icons.ts
     makes the same argument about shapes. */
  assert.equal(CHIP_COLOURS.length, 5);
  const html = sourceChips(Array.from({ length: 6 }, (_, i) => src(`s${i}`, `v${i}`)));
  const colours = [...html.matchAll(/;color:(#[0-9A-Fa-f]{6});/g)].map((m) => m[1]);
  assert.equal(colours.length, 6);
  assert.equal(colours[0], colours[5], "the sixth starts the palette again");
  assert.equal(new Set(colours.slice(0, 5)).size, 5, "the first five are all different");
});

test("the letters keep going past Z", () => {
  /* A cut of twenty-seven videos is not impossible, and "A" twice would be
     worse than "AA". */
  assert.equal(letterFor(0), "A");
  assert.equal(letterFor(25), "Z");
  assert.equal(letterFor(26), "AA");
  assert.equal(letterFor(27), "AB");
  const many = Array.from({ length: 30 }, (_, i) => letterFor(i));
  assert.equal(new Set(many).size, 30, "no two videos share a letter");
});

/**
 * THE STRIP UNDER THE PLAYER — the shape of the cut, in one line.
 *
 * It is the only place in the product where the SHAPE of a cut is visible:
 * that it opens with ninety seconds of one video and then alternates, or
 * that one block is twice as long as everything around it.
 */
import { blockStrip, keyHints, type StripBlock } from "../src/ui/switcher.ts";

const blk = (over: Partial<StripBlock> = {}): StripBlock => ({
  id: "b:1",
  ms: 10_000,
  sourceId: "s1",
  struck: false,
  label: "0:00 · a line",
  ...over,
});

test("a segment is as wide as its block is long", () => {
  const html = blockStrip(
    [blk({ id: "b:1", ms: 10_000 }), blk({ id: "b:2", ms: 30_000 })],
    [src("s1", "Tuesday")],
  );
  const flex = [...html.matchAll(/flex:(\d+)/g)].map((m) => Number(m[1]));
  assert.equal(flex.length, 2);
  assert.equal(flex[1] / flex[0], 3, "three times as long is three times as wide");
});

test("the strip and the chips agree about which video is which", () => {
  /*
   * THE WHOLE POINT OF IT. The third segment being green and the chip for
   * video B being green is how a person reads the strip without a legend.
   * Both index into the same ordered list of sources.
   */
  const sources = [src("s1", "Tuesday"), src("s2", "Thursday"), src("s3", "Sunday")];
  const strip = blockStrip(
    [blk({ id: "b:1", sourceId: "s2" }), blk({ id: "b:2", sourceId: "s1" })],
    sources,
  );
  const chips = sourceChips(sources);
  const chipColour = (letter: string) =>
    (chips.match(new RegExp(`;color:(#[0-9A-Fa-f]{6})[^<]*>${letter}</a>`)) ?? [])[1];
  const segColours = [...strip.matchAll(/background:(#[0-9A-Fa-f]{6})/g)].map((m) => m[1]);
  assert.equal(segColours[0], chipColour("B"), "a block from the second video is the second colour");
  assert.equal(segColours[1], chipColour("A"));
});

test("a voice beat is gold, because it is not footage yet", () => {
  /* It is a space you have left for yourself. Colouring it as a source
     would say it had been shot. */
  const html = blockStrip([blk({ sourceId: null }), blk({ id: "b:2" })], [src("s1", "T")]);
  assert.match(html, /background:#D9B36A/);
});

test("a struck block is still drawn, quietly", () => {
  /* Nothing vanishes — invariant 6 — but the shape you see has to be the
     shape that renders, so a struck block is faint rather than absent. */
  const html = blockStrip([blk({ struck: true }), blk({ id: "b:2" })], [src("s1", "T")]);
  const ops = [...html.matchAll(/opacity:([\d.]+)/g)].map((m) => Number(m[1]));
  assert.equal(ops.length, 2, "both are drawn");
  assert.ok(ops[0] < ops[1], "the struck one is fainter");
});

test("a zero-length block has no width to be", () => {
  const html = blockStrip([blk({ ms: 0 }), blk({ id: "b:2" }), blk({ id: "b:3" })], [src("s1", "T")]);
  assert.equal((html.match(/class="strip-seg"/g) ?? []).length, 2);
});

test("one block is not a shape", () => {
  /* A strip of one segment says nothing about the shape of anything — it is
     a full-width bar that looks like a progress meter and is not one. */
  assert.equal(blockStrip([blk()], [src("s1", "T")]), "");
  assert.equal(blockStrip([], [src("s1", "T")]), "");
});

test("the keys are said where the control is", () => {
  /* They are in the shortcut sheet too, which is a thing you have to know
     to open. */
  const html = keyHints();
  assert.match(html, /space play/);
  assert.match(html, /block/);
  assert.match(html, /undo/);
});
