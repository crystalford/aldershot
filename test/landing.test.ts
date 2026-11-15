/**
 * THE WORKED EXAMPLE ON THE PUBLIC PAGE, held to its own arithmetic.
 *
 * The landing page's rules section is not a screenshot: four rules over
 * eight moments, and the cut is derived from whichever rules are on. That
 * makes it the one place a stranger can watch invariant 1 happen before
 * signing up — and the one place where getting the numbers wrong is a lie
 * printed on the front door.
 *
 * resolveDemo is a small version of the real resolver, not a mock of it, so
 * these tests pin the behaviour the section claims in words: a drop rule
 * takes its thread out, a keep rule cannot be overruled by a cap, the cap
 * takes the longest unprotected moments first, and switching a rule off
 * puts its moments back.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderLanding, resolveDemo } from "../src/ui/pages/landing.ts";

/* The bit positions, named, so a test reads as the rule it is about. */
const DROP = 1 << 0;
const KEEP = 1 << 1;
const END_ON_VOTE = 1 << 2;
const CAP = 1 << 3;

/* The eight moments' lengths, in the order resolveDemo reports them. */
const DUR = [140, 58, 72, 49, 64, 600, 55, 90];
const kept = (off: number) =>
  resolveDemo(off)
    .out.map((o, i) => (o ? null : i))
    .filter((i): i is number => i !== null);

test("with no rules at all, the cut is the whole recording", () => {
  const all = resolveDemo(DROP | KEEP | END_ON_VOTE | CAP);
  assert.deepEqual(
    all.out,
    DUR.map(() => null),
  );
  assert.equal(all.secs, DUR.reduce((a, b) => a + b, 0));
});

test("the drop rule takes out its thread, and names itself as the reason", () => {
  const { out } = resolveDemo(KEEP | END_ON_VOTE | CAP);
  /* The two procedure moments: the opening formalities and the recess. */
  assert.equal(out[0], "rule 01");
  assert.equal(out[5], "rule 01");
  assert.equal(out[1], null);
});

test("switching the drop rule off puts the recess back in the cut", () => {
  /* A set bit means that rule is OFF, which is the direction a reader of
     this test gets wrong first — including the person who wrote it. */
  assert.ok(!kept(KEEP | END_ON_VOTE | CAP).includes(5), "drop rule on: the recess is out");
  assert.ok(kept(DROP | KEEP | END_ON_VOTE | CAP).includes(5), "drop rule off: it is back");
});

test("a cap cannot touch a moment a keep rule is holding", () => {
  /* Every rule on. The two claims about the numbers are moments 1 and 3. */
  const { out } = resolveDemo(0);
  assert.equal(out[1], null, "the 28-per-cent claim is protected");
  assert.equal(out[3], null, "the arithmetic claim is protected");
});

test("the cap takes the longest unprotected moment first", () => {
  const { out, secs } = resolveDemo(0);
  /* 72 before 64 before 55 — the three unprotected moments, longest down. */
  assert.equal(out[2], "over the cap");
  assert.equal(out[4], "over the cap");
  assert.equal(out[6], "over the cap");
  /* What is left is the two protected claims and the vote: 58 + 49 + 90. */
  assert.equal(secs, 197);
  assert.deepEqual(kept(0), [1, 3, 7]);
});

test("without the keep rule the cap eats a claim instead, and fits sooner", () => {
  const { out, secs } = resolveDemo(KEEP);
  /* Nothing is protected but the vote, so the longest three go: 72, 64, 55.
     That reaches 240 at 107 + 90, and the claims survive on length alone. */
  assert.ok(secs <= 240);
  assert.equal(out[7], null, "the vote is still the last word");
});

test("the vote survives every combination that keeps End on the vote", () => {
  for (let off = 0; off < 16; off += 1) {
    if (off & END_ON_VOTE) continue;
    assert.equal(resolveDemo(off).out[7], null, `vote dropped with off=${off}`);
  }
});

test("every one of the sixteen cuts is derivable, and none is empty", () => {
  for (let off = 0; off < 16; off += 1) {
    const { out, secs } = resolveDemo(off);
    assert.equal(out.length, 8);
    assert.ok(secs > 0, `off=${off} produced an empty cut`);
    /* The runtime is exactly the sum of what is in the cut — the one thing
       a viewer can check by eye against the moment list. */
    const sum = out.reduce((n, o, i) => (o ? n : n + DUR[i]), 0);
    assert.equal(secs, sum, `off=${off} reported a runtime it did not cut`);
  }
});

/* ── What reaches the browser ─────────────────────────────────────────── */

const page = () =>
  renderLanding({ google: false, error: null, sentTo: null, devLink: null });

test("the page ships all sixteen cuts, and renders the all-on one as HTML", () => {
  const html = page();
  const json = /<script type="application\/json" id="demo-data">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(json, "no demo data in the page");
  const data = JSON.parse(json[1].replace(/\\u003c/g, "<"));
  assert.equal(data.states.length, 16);
  /* The rows the server wrote are the all-on cut, so the section reads
     correctly with no JavaScript. */
  assert.ok(html.includes("out · over the cap"));
  assert.ok(html.includes("3:17 from 2:50:12"));
});

test("no development note reaches the public page", () => {
  /*
   * An HTML comment inside a template literal ships to anyone who views
   * source. This page used to carry seven, including one explaining that
   * the hero's button had been a div that did nothing when clicked.
   *
   * The comments stay in the source, where they are worth something.
   * src/ui/shell.ts's noDevNotes takes them out on the way to the browser
   * and the `notes` fidelity rule holds every document to going through it.
   */
  assert.ok(!page().includes("<!--"), "an HTML comment reached the rendered page");
  /* And the note itself is still in the source — the point is to keep it
     there, not to delete it. */
  const src = readFileSync("src/ui/pages/landing.ts", "utf8");
  assert.ok(src.includes("<!--"), "the notes were deleted rather than stripped");
});
