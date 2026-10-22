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
