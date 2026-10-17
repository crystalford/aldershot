/**
 * The room with a project open.
 *
 * Three columns — direction, the thing itself, the player — and the one
 * invariant that holds them together: a moment says "in · rule 01" and the
 * pane's first rule must BE rule 01. Those two numbers are produced in
 * different places from the same list, and if they ever disagree the
 * explanation layer points at the wrong line while looking perfectly healthy.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderCut, type CutData } from "../src/ui/pages/cut.ts";

/* A cut with nothing in it returns an empty state and no columns — correct,
   and the reason the first version of these tests saw none. */
const BLOCK = {
  id: "s:0",
  origin: "segment",
  start_ms: 0,
  end_ms: 20_000,
  text: "the first four weeks are about showing up",
  words: [],
  struck: false,
  score: null,
  why: null,
  mediaKey: null,
} as never;

const base: CutData = {
  projectId: "p1",
  title: "two minutes on leaving",
  sourceId: null,
  sourceTitle: null,
  sourceKey: null,
  posterKey: null,
  blocks: [BLOCK],
  beats: [],
  cuts: [],
  view: "blocks",
  windowSize: 60,
  keptCount: 0,
  runtimeMs: 0,
  cleanups: { fillers: { found: 0, savedMs: 0 }, pauses: { found: 0, savedMs: 0 } },
  renders: [],
  cameFrom: ["Your footage", "/"],
  job: null,
  passes: [],
  rules: [],
  moments: [],
  addable: [],
  blockRule: {},
  cutLine: "2:04 · 3 blocks · from 2 videos",
  /*
   * The cast is why `addable` going missing was a runtime crash rather than a
   * typecheck failure: `as unknown as CutData` turns off the one thing that
   * would have caught it. It is here because CutData carries a dozen fields
   * this file does not exercise, and the alternative is a fixture that has to
   * grow with every field the editor gains — but it means a new REQUIRED
   * field lands as three broken tests instead of a red squiggle.
   *
   * It has now cost that twice: `addable`, then `blockRule` and `cutLine`.
   * Both times the failure was a runtime crash in an unrelated-looking test
   * rather than the compiler pointing at this line. Still the right trade for
   * a type with two dozen fields this file does not exercise — but the cost
   * is real and is written down rather than rediscovered a third time.
   */
} as unknown as CutData;

const RULES = [
  { id: "r-keep-core", text: "Keep the parts where you're working something out.", on: true, hand: false, effect: "brings in 3" },
  { id: "r-drop-housekeeping", text: "Take out the hellos.", on: true, hand: false, effect: "nothing here touches it — it watches for it" },
  { id: "r-cap", text: "Keep it under 2 minutes.", on: true, hand: false, effect: "takes 3 off the cut" },
  { id: "r-keep-hand-c9", text: "Keep this one whatever the rules say.", on: true, hand: true, effect: "brings in 1" },
];

test("the three columns are in the order One Take draws them", () => {
  /* Direction, then the thing itself, then the player. The player used to sit
     at the top of the direction column, which made one column do two
     unrelated jobs and left the document whatever width was left over. */
  const html = renderCut({ ...base, rules: RULES });
  const order = [...html.matchAll(/class="(asst|editor-doc|editor-player)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ["asst", "editor-doc", "editor-player"]);
});

test("rules are numbered, and a hand decision does not take a number", () => {
  /*
   * THE ONE THAT KEEPS THE EXPLANATION HONEST.
   *
   * A moment says "in · rule 01" and the pane has to agree. The numbering
   * counts only the rules that are rules — a hand decision is the escape
   * hatch FROM them — so numbering the whole list would make every reference
   * from a moment point one line too far down, silently.
   */
  const html = renderCut({ ...base, rules: RULES });
  /* The HEADING, not the comment above it that happens to say the same
     words — which is what the first version of this sliced from. */
  const pane = html.slice(html.indexOf(">THE RULES<"), html.indexOf("asst-talk"));

  assert.match(pane, /01[\s\S]{0,160}Keep the parts where/);
  assert.match(pane, /02[\s\S]{0,160}Take out the hellos/);
  assert.match(pane, /03[\s\S]{0,160}Keep it under 2 minutes/);
  assert.ok(!/04/.test(pane), "the hand rule must not be numbered 04");
  /* The gap is the whole button's markup — a style block alone is 300
     characters — so the window has to allow for it. */
  assert.match(pane, /&gt;by hand|>by hand</, "a section of its own");
  assert.match(pane, /by hand[\s\S]{0,900}Keep this one whatever/, "and the hand rule is in it");
});

test("a moment's rule number is the pane's rule number", () => {
  /*
   * Produced in two places from one list, so this is the only thing stopping
   * them drifting. The route computes both from the same compute() call for
   * exactly this reason; the test holds the contract that lets it.
   */
  const html = renderCut({
    ...base,
    view: "footage",
    rules: RULES,
    moments: [
      { id: "m1", quote: "the first four weeks", source_title: "T", in: true, note: "in · rule 01" },
      { id: "m2", quote: "can you hear me", source_title: "T", in: false, note: "out · rule 02 · click to keep" },
      { id: "m3", quote: "I don't know, maybe", source_title: "T", in: false, note: "out · no rule keeps it" },
      { id: "m4", quote: "the honest version", source_title: "T", in: true, note: "in · kept by hand" },
    ],
  });

  for (const note of ["in · rule 01", "out · rule 02 · click to keep", "out · no rule keeps it", "in · kept by hand"]) {
    assert.ok(html.includes(note), `missing: ${note}`);
  }
  /* The rule each note names must exist in the pane at that number. */
  const pane = html.slice(html.indexOf(">THE RULES<"), html.indexOf("asst-talk"));
  assert.match(pane, /01[\s\S]{0,160}Keep the parts where/);
  assert.match(pane, /02[\s\S]{0,160}Take out the hellos/);
});

test("the centre has three tabs, and Shorts is deliberately not one", () => {
  /*
   * One Take names four. The fourth lists candidates graded Strong / Worth a
   * look / Long shot with a reason, and the three-way judge that produces
   * those gradings is Phase 4. A tab holding a list the product cannot grade
   * is a promise in a tab bar.
   */
  const html = renderCut({ ...base, rules: RULES });
  const bar = html.slice(html.indexOf('class="view-swap"'), html.indexOf('class="view-swap"') + 420);
  assert.match(bar, />Footage</);
  assert.match(bar, />Blocks</);
  assert.match(bar, />Words</, "the prototype's name for the script view");
  assert.ok(!/>Shorts</.test(bar));
  assert.ok(!/>Script</.test(bar), "renamed, because Words is what it always meant");
});

test("the footage tab replaces the document rather than sitting beside it", () => {
  /* Two readings of the cut on screen at once is the bug the view swap
     exists to avoid — they would disagree the moment either changed. */
  const asFootage = renderCut({ ...base, view: "footage", rules: RULES, moments: [] });
  assert.ok(!/id="blocks"/.test(asFootage), "the blocks list is not rendered under it");
  assert.match(asFootage, /Nothing in your library yet/);

  const asBlocks = renderCut({ ...base, view: "blocks", rules: RULES });
  assert.match(asBlocks, /id="blocks"/);
});

test("the route computes the pane and the tab from one call", () => {
  /*
   * Read from the source, because it is a property of HOW they are produced
   * rather than of what comes out. Two compute() calls would let the pane and
   * the moments disagree on a library that changed between them, and nothing
   * on screen would look wrong.
   */
  const src = readFileSync(join(import.meta.dirname, "..", "src", "index.ts"), "utf8");
  const block = src.slice(src.indexOf("THE RULES AND THE MOMENTS THEY JUDGED"));
  /* Comments stripped before counting: a paragraph explaining that there is
     ONE such call contains the word itself, and counting raw text made this
     fail on code that was correct. */
  const upto = block.slice(0, block.indexOf("})()),")).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal((upto.match(/compute\(/g) ?? []).length, 1, "one compute, feeding both");
  assert.match(upto, /stored\.filter\(\(r\) => !r\.hand\)/, "and the same hand split the pane uses");
});

test("every moment row is pressable, because every row's note promises it", () => {
  /*
   * "out · rule 02 · click to keep" shipped on a plain div with no handler —
   * a sentence on screen telling somebody to do something that did nothing,
   * and the second of those in two commits. Disagreeing with a rule is the
   * POINT of naming the rule, so the row is the control.
   *
   * The gate now checks this on the rendered page too; this holds the shape
   * here, where a failure names the function rather than a URL.
   */
  const html = renderCut({
    ...base,
    view: "footage",
    rules: RULES,
    moments: [
      { id: "m1", quote: "kept", source_title: "T", in: true, note: "in · rule 01" },
      { id: "m2", quote: "dropped", source_title: "T", in: false, note: "out · rule 02 · click to keep" },
    ],
  });
  const rows = [...html.matchAll(/<(\w+)[^>]*class="moment-hand"/g)].map((m) => m[1]);
  assert.deepEqual(rows, ["button", "button"], "both rows, both pressable");
  assert.match(html, /data-moment="m2" data-in="0"/, "and each carries which way it would go");
  assert.match(html, /data-moment="m1" data-in="1"/);
});
