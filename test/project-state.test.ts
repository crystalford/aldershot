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
import { renderCut, type CutData, type CutView } from "../src/ui/pages/cut.ts";
import { GRADE_NAME, gradeForScore } from "../src/shorts.ts";
import type { Block } from "../src/blocks.ts";
import { isOrder, orderText } from "../src/rules.ts";
import { parseRules } from "../src/rule-parse.ts";

/* A cut with nothing in it returns an empty state and no columns — correct,
   and the reason the first version of these tests saw none. */
/*
 * `origin: "segment"` IS NOT A BlockOrigin, and the cast was hiding it.
 *
 * The three are footage, voice and generated. This fixture said "segment"
 * — a word from the block ID scheme, not the origin one — and `as never`
 * meant nothing checked. blockRow branches on `origin === "footage"` for
 * the frame, the short control and the origin tag, so every assertion in
 * this file has been exercising the NOT-footage path while describing a
 * cut of somebody's own video.
 */
const BLOCK = {
  id: "s:0",
  origin: "footage" as const,
  start_ms: 0,
  end_ms: 20_000,
  text: "the first four weeks are about showing up",
  words: [],
  struck: false,
  score: null,
  why: null,
  label: null,
  mediaKey: null,
  previewKey: null,
  voiceKey: null,
  posterKey: null,
  /*
   * TYPED, NOT `as never`. It was cast away, which meant `{...BLOCK, score}`
   * would not compile — the spread of a `never` is not an object — and the
   * tests that vary one field had nothing to vary. Typing it is also what
   * makes a field renamed in Block break these rather than silently stop
   * being set.
   */
} satisfies Block;

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

  /*
   * PER CARD, not within N characters of each other.
   *
   * These were proximity assertions — the number within 160 characters of
   * its text — which is a proxy for "they belong to the same rule" that
   * breaks the moment the markup between them grows. It did: a rule became
   * a card with a switch in it. Splitting on the card is the claim itself,
   * and it cannot be broken by styling.
   */
  const cards = pane.split('class="rule-card"').slice(1);
  const numbered = (n: string, text: string) =>
    cards.some((c) => new RegExp(`>${n}</span>`).test(c) && c.includes(text));
  assert.ok(numbered("01", "Keep the parts where"), "rule 01 is the first rule");
  assert.ok(numbered("02", "Take out the hellos"));
  assert.ok(numbered("03", "Keep it under 2 minutes"));
  assert.ok(!/>04</.test(pane), "the hand rule must not be numbered 04");

  /*
   * THIS USED TO ASSERT A "by hand" SECTION OF FULL RULE CARDS, and the
   * counter-argument is the reason it does not any more.
   *
   * A hand decision IS a rule in the engine — that is how "keep this one
   * whatever the rules say" survives a recompute — and the pane was showing
   * it as one: a card, a switch, the same weight as a standing instruction
   * about the whole cut. The prototype collapses them to one line with a
   * caret ("and 3 fixes by hand") and a minus or plus per fix, because ten
   * disagreements about ten moments should not push the direction off the
   * screen. The old assertion was pinning the build's shape, not the
   * product's.
   *
   * What it still pins is the claim that mattered: a hand decision is
   * listed apart from the rules and takes no number.
   */
  assert.match(pane, /and 1 fix by hand/, "collapsed, and counted");
  assert.match(pane, /fixes-list[\s\S]{0,900}Keep this one whatever/, "and the fix is in it");
  assert.doesNotMatch(
    pane.slice(pane.indexOf("fix by hand")),
    /class="rule-card"/,
    "a fix is not a rule card",
  );
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
  const cards2 = pane.split('class="rule-card"').slice(1);
  const at = (n: string, text: string) =>
    cards2.some((c) => new RegExp(`>${n}</span>`).test(c) && c.includes(text));
  assert.ok(at("01", "Keep the parts where"), "the note says rule 01, and 01 is that rule");
  assert.ok(at("02", "Take out the hellos"), "and the note that says 02 points at that one");
});

test("the centre has the four tabs One Take names", () => {
  /*
   * Shorts was deliberately absent while the product could not grade its
   * list — "a tab holding a list the product cannot grade is a promise in a
   * tab bar". It can now, and the thing that grades it is not a model: the
   * self-sufficiency test in src/shorts.ts is the grade and the reason.
   */
  const html = renderCut({ ...base, rules: RULES });
  const bar = html.slice(html.indexOf('class="view-swap"'), html.indexOf('class="view-swap"') + 560);
  assert.match(bar, />Footage</);
  assert.match(bar, />Blocks</);
  assert.match(bar, />Words</, "the prototype's name for the script view");
  assert.match(bar, />Shorts</);
  assert.ok(!/>Script</.test(bar), "renamed, because Words is what it always meant");
});

test("the route answers the Shorts tab with the Shorts view", () => {
  /*
   * `shorts` was already in EDITOR_PATHS and rendered the BLOCKS view — a
   * tab the product answered and did not have. Read off the source rather
   * than driven, which proves the mapping exists and not that it renders;
   * the renderer is the test below, and the two together are the link.
   */
  const src = readFileSync(join(import.meta.dirname, "..", "src", "index.ts"), "utf8");
  assert.match(
    src,
    /stage === "shorts" \|\| c\.req\.query\("view"\) === "shorts" \? "shorts"/,
    "/p/:id/shorts has to reach the Shorts view",
  );
  assert.match(src, /EDITOR_PATHS = new Set\(\[[^\]]*"shorts"/);
});

test("the Shorts tab grades every line and withholds none", () => {
  /*
   * A Long shot is listed and pressable: the grade says what to expect and
   * the reason says why, and a person who disagrees presses it anyway.
   * Filtering would quietly lose a line somebody wanted.
   */
  const block = (id: string, text: string, ms: number) => ({
    id,
    origin: "footage" as const,
    start_ms: 0,
    end_ms: ms,
    text,
    words: [],
    struck: false,
    score: null,
    why: null,
    label: null,
    mediaKey: null,
    previewKey: null,
    voiceKey: null,
    posterKey: null,
  });
  const html = renderCut({
    ...base,
    view: "shorts" as const,
    blocks: [
      block("s:0", "The house has a room that gets sun until four.", 20_000),
      block("s:1", "and then the rent halves and I lose everyone I would", 20_000),
    ],
  });

  assert.match(html, /STRONG/);
  assert.match(html, /LONG SHOT/);
  assert.match(html, /it stands on its own/);
  assert.match(html, /stops mid-sentence/, "the reason is the fact, not an opinion about it");
  /* Both pressable, and both carrying the segment index /shorts-from-line
     takes. */
  assert.match(html, /class="short-line"[^>]*data-seg="0"/);
  assert.match(html, /class="short-line"[^>]*data-seg="1"/);
  /* Strong first, and no number anywhere near a line. */
  assert.ok(html.indexOf("STRONG") < html.indexOf("LONG SHOT"));
  assert.equal(html.match(/1 of 2 lines stand on their own/)?.length, 1);
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

/**
 * THE TITLE ROW CARRIES EXPORT, AND THERE IS NO BOTTOM BAR.
 *
 * One Take is a 100vh shell whose second row never scrolls away, with
 * Export at its right end labelled with what you would get. The build had a
 * sticky strip across the bottom of the page holding Export, the kept
 * count, the saved note and what was outstanding — a bar the design does
 * not have, competing with the composer for the bottom of the screen.
 */
test("Export is in the title row, labelled with the runtime", () => {
  const html = renderCut({ ...base, runtimeMs: 359_000 });
  const head = html.slice(0, html.indexOf("THE RULES"));
  assert.match(head, /class="export-open"/, "Export is above the fold, not below it");
  assert.match(head, /Export <span id="cut-runtime" data-content>5:59<\/span>/);
  /* "Export as" was the old label. The runtime is the thing you are about
     to commit to, and it used to be two inches away in another bar. */
  assert.ok(!/Export as/.test(html));
});

test("there is no bar across the bottom", () => {
  /*
   * The thing it held is all in the title row now. A second sticky strip at
   * the foot of the page was also 55px the editor's left column did not
   * have — the conversation was being crushed to 125px and the composer had
   * ended up underneath this very bar.
   */
  const html = renderCut(base);
  assert.ok(!/position:sticky;bottom:0/.test(html), "nothing is pinned to the bottom");
});

test("the title row does not scroll away", () => {
  /*
   * Which is what makes moving Export there safe. The prototype's row is in
   * a fixed-height shell and never moves; the build's page scrolls the
   * document, so a row that scrolled would put Export further out of reach
   * than the bar it replaced. 52px is the nav's own height.
   */
  const html = renderCut(base);
  assert.match(html, /position:sticky;top:52px/);
});

test("the two numbers are two elements, and both are named", () => {
  /*
   * They were one string — "5 kept · 0:20" — in one span, and the client
   * split it apart with a regex to retotal after a strike. The kept count
   * is a mono note in the title row and the runtime is inside the Export
   * button's label, so there is nothing to parse.
   */
  const html = renderCut({ ...base, keptCount: 7, runtimeMs: 125_000 });
  assert.match(html, /id="cut-kept"[^>]*>7 kept</);
  assert.match(html, /id="cut-runtime"[^>]*>2:05</);

  const client = readFileSync(join(import.meta.dirname, "..", "src", "ui", "client.ts"), "utf8");
  assert.match(client, /if \(footKept\) footKept\.textContent = keptTotal \+ " kept";/);
  assert.match(client, /if \(footRuntime\) footRuntime\.textContent = clock\(ms\);/);
  assert.ok(
    !/footRuntime\?\.textContent \|\| ""\)\.split\("kept"\)/.test(client),
    "nothing parses the two numbers back out of one string",
  );
});

/**
 * INVARIANT 3, ON THE BLOCK.
 *
 *   "Reasons, not scores. No percentage reaches a user. Strong / Worth a
 *    look / Long shot, with the line that caused it."
 *
 * The editor rendered `b.score` — a bare 70 in a green badge — on every
 * judged block, for as long as blocks have had scores, with that invariant
 * written down the whole time. Found by putting the prototype's project
 * state beside the build's: the prototype's block carries "rule 01" and no
 * number at all.
 */
test("a block says a word, never a number", () => {
  const scored = (score: number | null) =>
    renderCut({ ...base, blocks: [{ ...BLOCK, score }] });

  assert.match(scored(92), />Strong</);
  assert.match(scored(70), />Worth a look</);
  assert.match(scored(30), />Long shot</);
  for (const n of [92, 70, 30]) {
    assert.ok(!new RegExp(`>${n}<`).test(scored(n)), `${n} must not reach the screen`);
  }
});

test("absent is absent, and zero is absent too", () => {
  /* saveClips writes score 0 for anything the model did not rate, so a zero
     is the absence of a verdict rather than a bad one. A block with no word
     is a block nobody judged. */
  for (const none of [null, 0]) {
    const html = renderCut({ ...base, blocks: [{ ...BLOCK, score: none }] });
    for (const word of ["Strong", "Worth a look", "Long shot"]) {
      assert.ok(!html.includes(`>${word}<`), `${none} must not read as ${word}`);
    }
  }
});

test("the bands are the ones already being read", () => {
  /*
   * scripts/read-labels.ts prints the scorer's own behaviour in 90-100,
   * 80-89, 60-79 and below, and treats 80 and up as the top band. Strong is
   * that band; Worth a look is 60-79. They are not tuned, and that script
   * is how they get tuned — a flag rate that does not fall as the band
   * rises means the score is not measuring what it says.
   */
  assert.equal(gradeForScore(80), "strong");
  assert.equal(gradeForScore(79), "worth");
  assert.equal(gradeForScore(60), "worth");
  assert.equal(gradeForScore(59), "long");
  assert.equal(gradeForScore(1), "long");
  assert.equal(gradeForScore(0), null);
  assert.equal(gradeForScore(null), null);
  assert.equal(gradeForScore(undefined), null);
  assert.equal(gradeForScore(Number.NaN), null);
  /* One vocabulary, not two: the words are the shorts list's own. */
  assert.equal(GRADE_NAME.strong, "Strong");
  assert.equal(GRADE_NAME.worth, "Worth a look");
  assert.equal(GRADE_NAME.long, "Long shot");
});

test("the line that caused it is on the block beside the word", () => {
  /* The invariant is not "say a word instead" — it is "reasons, with the
     line that caused it". The rule chip is that line. */
  const html = renderCut({
    ...base,
    blocks: [{ ...BLOCK, score: 92 }],
    blockRule: { [BLOCK.id]: "rule 01" },
  });
  assert.match(html, />Strong</);
  assert.match(html, />rule 01</);
});

/**
 * A RULE IS A CARD WITH A SWITCH.
 *
 * Invariant 1: "Rules are the source of truth; a cut is re-produced from
 * rules + moments, never stored as an outcome." Switching one off is the
 * central gesture of the product — and it was a flat row that was itself a
 * button, whose only indication of state was whether the text was struck
 * through. One Take gives each rule a card and a real switch.
 */
/*
 * AN OFF RULE, which the shared fixture does not have.
 *
 * Every rule in RULES is on, so until this existed the off path — the
 * strike-through, the grey text, the knob on the left — was never rendered
 * by any test in this file. The assertion that said so is the one that
 * found it.
 */
const RULES_WITH_OFF = [...RULES.slice(0, 3), { ...RULES[1], id: "r-off", on: false }];

test("every rule has a switch that shows its state", () => {
  const html = renderCut({ ...base, rules: RULES_WITH_OFF });
  const cards = html.split('class="rule-card"').slice(1);
  assert.equal(cards.length, RULES_WITH_OFF.length, "one card per rule");

  for (const c of cards) {
    assert.match(c, /class="rule-toggle"[^>]*aria-pressed="(true|false)"/, "the switch says its state");
  }
  const on = cards.find((c) => /data-on="1"/.test(c));
  const off = cards.find((c) => /data-on="0"/.test(c));
  assert.ok(on && off, "the fixture needs one of each for this to measure anything");

  /* The knob moves and the track changes colour — the two things that make a
     switch readable without reading. */
  assert.match(on, /left:14px/);
  assert.match(off, /left:2\.5px/);
  assert.match(on, /background:#5EC98F/, "on is the design's green");
  assert.match(off, /background:#2E2E36/);
  /* And it says what pressing it would do. */
  assert.match(on, /title="Turn this rule off"/);
  assert.match(off, /title="Turn it back on"/);
});

test("a rule that is off reads as off in the text too", () => {
  /* The strike-through was the ONLY signal before the switch existed. It is
     still right — a rule you have turned off is one you decided against —
     but it is no longer carrying the whole state on its own. */
  const html = renderCut({ ...base, rules: RULES_WITH_OFF });
  const off = html.split('class="rule-card"').slice(1).find((c) => /data-on="0"/.test(c));
  assert.ok(off);
  assert.match(off, /text-decoration:line-through/);
});

test("the card is not the button", () => {
  /*
   * The whole row used to be the control, so a click anywhere on a rule —
   * reading its effect line, selecting its text — toggled it. The hit area
   * is the switch now, which is the only part that means "change this".
   */
  const html = renderCut({ ...base, rules: RULES });
  const card = html.split('class="rule-card"')[1];
  assert.ok(!/^[^<]*<button/.test(card), "the card does not open with a button");
  /* Cut at the switch's own <button, not at its class attribute — slicing
     to the class leaves the "<button " that opens it inside the window, and
     the assertion failed on the thing it was looking for. */
  const beforeToggle = card.slice(0, card.indexOf('<button class="rule-toggle"'));
  assert.ok(!/<button/.test(beforeToggle), "nothing before the switch is a button");
});

/**
 * THE ONE RULE WITH ALTERNATIVES.
 *
 * An order rule is not a yes/no — it is a choice of three, and the other
 * two are a press away. The prototype shows them as chips under the rule
 * with the chosen one lit and a line underneath saying why you would want
 * the one you are on. The build had the toggle and nothing else, so
 * changing the order meant typing a sentence that happened to parse.
 */
const ORDER_RULE = {
  id: "r-order",
  text: "Run it one thread at a time.",
  on: true,
  hand: false,
  effect: "the cut runs one thread at a time",
  kind: "order",
  order: "strand" as const,
};

test("an order rule offers the other two orders", () => {
  const html = renderCut({ ...base, rules: [ORDER_RULE] });
  const chips = [...html.matchAll(/class="rule-order"[^>]*data-order="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(chips.sort(), ["open", "strand", "time"]);
  /* The one you are on is marked, and it is the one the rule names. */
  assert.match(html, /data-order="strand" data-current/);
  assert.equal((html.match(/data-current/g) ?? []).length, 1, "exactly one is current");
});

test("each order says why you would want it", () => {
  /*
   * The names were already in the build, inline in orderName. The whys were
   * not, and they are the half that makes three chips a choice rather than
   * three words. Ported from footage.js, which CLAUDE.md says to port.
   */
  const html = renderCut({ ...base, rules: [ORDER_RULE] });
  assert.match(html, /title="Each question gets asked and answered before the next one starts\."/);
  assert.match(html, /title="Tuesday, Thursday, Sunday — you watch the decision arrive\."/);
  assert.match(html, /title="Start on the line that hurts, then earn it\."/);
  /* And the one you are on has its why in the open, under the chips. */
  assert.match(html, />Each question gets asked and answered before the next one starts\.</);
});

test("a rule that is off offers nothing to re-order", () => {
  /* Offering to re-order a cut by a rule that is switched off is a control
     that would have to switch it back on to mean anything — two decisions
     behind one press. */
  const html = renderCut({ ...base, rules: [{ ...ORDER_RULE, on: false }] });
  assert.ok(!/class="rule-order"/.test(html));
});

test("only an order rule has alternatives", () => {
  const html = renderCut({ ...base, rules: RULES });
  assert.ok(!/class="rule-order"/.test(html), "a keep, a drop and a cap have no second option");
});

test("the sentence and the order are produced from one place", () => {
  /*
   * The rule IS the sentence, so changing the order has to change the text.
   * Those three strings were written out in rule-parse.ts AND produced by
   * orderName in rules.ts — two copies, about to become three when the pane
   * started offering them. A rule made by pressing a chip and one made by
   * typing "run it as it happened" are the same rule now.
   */
  assert.equal(orderText("time"), "Run it as it happened.");
  assert.equal(orderText("strand"), "Run it one thread at a time.");
  assert.equal(orderText("open"), "Start on the sharpest line.");
  for (const o of ["time", "strand", "open"] as const) {
    assert.equal(parseRules(orderText(o)).rules.find((r) => r.kind === "order")?.order, o,
      `${orderText(o)} must parse back to ${o}`);
  }
  const parser = readFileSync(join(import.meta.dirname, "..", "src", "rule-parse.ts"), "utf8");
  assert.ok(!/"Run it as it happened\."/.test(parser), "the parser must not carry its own copy");
});

test("an order the engine does not know is refused, not defaulted", () => {
  /*
   * The route takes an order from a client. A rule carrying a word compute()
   * does not know would fall through to the default silently — a cut in an
   * order nobody chose, with the pane saying otherwise.
   */
  assert.equal(isOrder("strand"), true);
  assert.equal(isOrder("time"), true);
  assert.equal(isOrder("open"), true);
  for (const junk of ["", "STRAND", "chronological", "toString", null, 7]) {
    assert.equal(isOrder(junk), false, `${JSON.stringify(junk)} is not an order`);
  }
  const index = readFileSync(join(import.meta.dirname, "..", "src", "index.ts"), "utf8");
  assert.match(index, /if \(!isOrder\(b\.order\)\) return c\.json\(\{ error: "no such order" \}, 422\);/);
  assert.match(index, /if \(rule\.kind !== "order"\) return c\.json\(\{ error: "that rule has no order" \}, 422\);/);
});

/* ── The rules pane, rendered rather than reasoned about ────────────────── */

/**
 * WHAT A POPULATED RULES PANE TURNED OUT TO BE MISSING.
 *
 * The pane had been built from unit tests alone. The first time a fixture put
 * four rules, a real disagreement and a hand fix into it and the page was
 * screenshotted, four things were wrong at once — and three of them were
 * behaviours in the prototype that nothing here had ever asked for.
 */

/** A moment as the route hands one over. */
const mom = (o: Partial<CutData["moments"][number]>) => ({
  id: "m1",
  quote: "the kettle",
  source_title: "the kitchen",
  in: false,
  note: "out · rule 02 · click to keep",
  ...o,
});

const pane = (d: Partial<CutData>) => {
  const html = renderCut({ ...base, ...d } as CutData);
  return html.slice(html.indexOf(">THE RULES<"), html.indexOf("asst-talk"));
};

test("the disagreement is above the rules, not under them", () => {
  /*
   * THE DEFECT A SCREENSHOT FOUND AND NO ASSERTION COULD.
   *
   * .asst-top is capped at half the column and scrolls. The panel was
   * rendered after every rule card, so on a cut with four rules it was off
   * the bottom of a scrolling box on arrival — while the note beside the cut
   * said "2 judgement calls" and the blocks carried the gold mark. The one
   * decision in the pane was the one thing you could not see.
   *
   * The prototype has conflicts at line 303 and the rules at 313. Ordering,
   * not presence, is the claim — presence is pinned by cut-notes.
   */
  const p = pane({
    rules: RULES,
    moments: [
      mom({ id: "m1", contest: { k: "01", d: "02", kId: "r-keep-core" } }),
      mom({ id: "m2", contest: { k: "01", d: "02", kId: "r-keep-core" } }),
    ],
  });
  assert.ok(p.indexOf("disagree on 2 moments") < p.indexOf("rule-card"), "the panel comes first");
});

test("a rule that is on and matching nothing offers to go off", () => {
  /*
   * Switched on, no moment in by it, no moment out by it, named by no
   * disagreement — and rendered identically to a rule holding the cut
   * together. A sentence that no longer describes any of your footage looked
   * like direction.
   *
   * It says "switch it off" where the prototype says "archive it", because
   * invariant 6 is that nothing is deleted. 12-DEFERRED.md records that.
   */
  const p = pane({
    rules: [
      { id: "r-live", text: "Keep the working out.", on: true, hand: false, effect: "brings in 1", kind: "keep" },
      { id: "r-dead", text: "Take out the sponsor read.", on: true, hand: false, effect: "nothing here touches it", kind: "drop" },
    ],
    moments: [mom({ id: "m1", in: true, byRule: "r-live", note: "in · rule 01" })],
  });
  const cards = p.split('class="rule-card"').slice(1);
  assert.ok(!/rule-off/.test(cards[0]), "the rule that is working is not offered");
  assert.match(cards[1], /class="rule-off"[^>]*data-rule="r-dead"/, "the dead one is");
  assert.match(cards[1], /Does nothing now — switch it off/);
});

test("an order rule matching nothing is not called dead", () => {
  /*
   * "Doing nothing" is not a defect for every kind of rule. An order rule
   * with one block to order, a cap nothing exceeds and a gap rule on a cut
   * with no gaps are all working exactly as asked. Only keep and drop can be
   * dead, which is the prototype's own condition.
   */
  const p = pane({
    rules: [{ id: "r-ord", text: "Run it as it happened.", on: true, hand: false, effect: "in order", kind: "order", order: "time" }],
    moments: [],
  });
  assert.doesNotMatch(p, /rule-off/);
});

test("a rule that took out two or more offers to bring them all back", () => {
  /*
   * The alternative the pane offered was the Footage tab and four presses of
   * "click to keep" — four decisions to undo one. Turning the rule off IS
   * what brings its moments back, so the offer posts the rule's own switch.
   */
  const p = pane({
    rules: RULES,
    moments: [
      mom({ id: "m1", dropRule: "r-drop-housekeeping" }),
      mom({ id: "m2", dropRule: "r-drop-housekeeping" }),
      mom({ id: "m3", dropRule: "r-cap" }),
    ],
  });
  assert.match(p, /Bring back all 2 rule 02 took out/);
  assert.doesNotMatch(p, /rule 03 took out/, "one moment is not a wholesale disagreement");
});

test("hand fixes collapse to one line, folded away, each with an undo", () => {
  const p = pane({
    rules: [
      RULES[0],
      { id: "r-h1", text: "Keep this one whatever the rules say.", on: true, hand: true, effect: "brings in 1", kind: "keep", cid: "c9" },
      { id: "r-h2", text: "Take this one out whatever the rules say.", on: true, hand: true, effect: "takes out 1", kind: "drop", cid: "c4" },
    ],
    moments: [],
  });
  assert.match(p, /and 2 fixes by hand/);
  assert.match(p, /class="fixes-list" hidden/, "folded until asked for");
  /* The direction matters: undoing a hand DROP posts keep:false, because
     making the same decision again is what takes the hand back. Posting the
     opposite would pin the moment by hand the other way with no road back. */
  assert.match(p, /class="fix-undo"[^>]*data-moment="c9"[^>]*data-keep="1"/);
  assert.match(p, /class="fix-undo"[^>]*data-moment="c4"[^>]*data-keep="0"/);
});

test("one fix is one fix", () => {
  const p = pane({
    rules: [{ id: "r-h1", text: "Keep this one.", on: true, hand: true, effect: "brings in 1", kind: "keep", cid: "c9" }],
    moments: [],
  });
  assert.match(p, /and 1 fix by hand/);
});

/* ── The project's Footage tab, rendered ────────────────────────────────── */

/**
 * A LIST OF SENTENCES IS NOT A LIST OF MOMENTS.
 *
 * The tab rendered each moment as its text and a verdict. The prototype's row
 * is the moment itself: where in which recording, how long, and then the
 * verdict. Without those, two similar lines from two videos are the same row,
 * and a four-second aside looks like a forty-second argument.
 */
const foot = (d: Partial<CutData>) =>
  renderCut({ ...base, view: "footage", rules: RULES, ...d } as CutData);

test("a moment says where in which recording, and how long", () => {
  const html = foot({
    sources: [
      { id: "s-a", title: "Tuesday", duration_s: 600 },
      { id: "s-b", title: "Thursday", duration_s: 600 },
    ],
    moments: [
      {
        id: "m1",
        quote: "the kettle",
        source_title: "Thursday",
        in: true,
        note: "in · rule 01",
        sourceId: "s-b",
        startMs: 400_000,
        durMs: 44_000,
      },
    ],
  });
  /* "B 6:40" — the letter from the project's ordered sources, the same
     letterFor the chips beside the title and the Words gutter use, and the
     time unpadded the way footage.js writes every moment's time. */
  assert.match(html, />B 6:40</);
  assert.match(html, />0:44</, "and how long it runs");
});

test("one video needs no letter", () => {
  /* "A" down every row of a single-source list is a column of the same
     character. Same rule the Words gutter follows. */
  const html = foot({
    sources: [{ id: "s-a", title: "Tuesday", duration_s: 600 }],
    moments: [
      { id: "m1", quote: "x", source_title: "Tuesday", in: true, note: "in · rule 01", sourceId: "s-a", startMs: 61_000, durMs: 4000 },
    ],
  });
  assert.match(html, />1:01</);
  assert.doesNotMatch(html, />A 1:01</);
});

test("the threads are chips with counts, and only when there is a choice", () => {
  const two = foot({
    moments: [
      { id: "m1", quote: "a", source_title: "T", in: true, note: "in · rule 01", thread: "money" },
      { id: "m2", quote: "b", source_title: "T", in: true, note: "in · rule 01", thread: "money" },
      { id: "m3", quote: "c", source_title: "T", in: false, note: "out · rule 02 · click to keep", thread: "the house" },
    ],
  });
  assert.match(two, /class="thread-chip"[^>]*data-thread=""[^>]*data-current/, "Everything is where you start");
  assert.match(two, />Everything 3</);
  assert.match(two, />money 2</);
  assert.match(two, />the house 1</);

  /* One thread beside Everything is a control whose two states show the
     same list. */
  const one = foot({
    moments: [{ id: "m1", quote: "a", source_title: "T", in: true, note: "in · rule 01", thread: "money" }],
  });
  assert.doesNotMatch(one, /thread-chip/);
});

/* ── The recorder's context ─────────────────────────────────────────────── */

/**
 * READING A LINE TO CAMERA IS THE ONE THING YOU CANNOT UNDO BY PRESSING.
 *
 * You have to say it again. The editor asked for it with the line and
 * nothing else: no sense of what the beat comes after, no way to hear that,
 * and no idea what it runs into. All of it was already in `renderCut` — a
 * beat's neighbours are the blocks either side of it.
 */
const VOICE = {
  ...BLOCK,
  id: "b:vo1",
  origin: "voice" as const,
  text: "What the eleven days actually cost.",
  words: [],
  start_ms: 0,
  end_ms: 12_000,
} satisfies Block;

const seg = (i: number, text: string, at: number) => ({
  ...BLOCK,
  id: `s:${i}`,
  start_ms: at,
  end_ms: at + 4000,
  text,
});

test("a beat says what it answers, with a way to watch it", () => {
  const html = renderCut({
    ...base,
    blocks: [seg(0, "The kettle was in a box marked books", 57_510), VOICE, seg(1, "Label the boxes by room", 62_000)],
    windowSize: 60,
  } as Partial<CutData> as CutData);
  assert.match(html, /YOU'RE ANSWERING/);
  assert.match(html, /&ldquo;The kettle was in a box marked books&rdquo;/);
  /* Unpadded, the way footage.js writes every moment's time — and ROUNDED,
     which is why this says 0:58 for a block starting at 57510ms. The first
     version of this asserted 0:57 from the milliseconds and was simply
     wrong about what hms does. */
  assert.match(html, />0:58</);
  /* And the control seeks to it — the same blk-play the thumbnails use, so
     there is one play path rather than two that drift. */
  assert.match(html, /class="blk-play" data-start="57510"[\s\S]{0,300}Watch the moment/);
});

test("and what it runs into, or that nothing does", () => {
  const middle = renderCut({
    ...base,
    blocks: [seg(0, "before", 1000), VOICE, seg(1, "Label the boxes by room", 62_000)],
  } as Partial<CutData> as CutData);
  assert.match(middle, /Then it cuts to 1:02 &mdash; &ldquo;Label the boxes by room&rdquo;/);
  assert.doesNotMatch(middle, /last beat of the cut/);

  const last = renderCut({
    ...base,
    blocks: [seg(0, "before", 1000), VOICE],
  } as Partial<CutData> as CutData);
  assert.match(last, /This is the last beat of the cut\./);
});

test("a struck line is not what the beat comes after", () => {
  /* You cut it. Offering it as the thing to pitch against would be the
     editor describing a cut that no longer exists. */
  const html = renderCut({
    ...base,
    blocks: [seg(0, "kept line", 1000), { ...seg(1, "struck line", 40_000), struck: true }, VOICE],
  } as Partial<CutData> as CutData);
  assert.match(html, /&ldquo;kept line&rdquo;/);
  assert.doesNotMatch(html, /&ldquo;struck line&rdquo;/);
});

test("the recorder says it is sound only", () => {
  /*
   * getUserMedia({ audio: true }) and nothing else. A recorder that does not
   * say which it is, beside a control called "Record it", is one somebody
   * points a camera at. The prototype's recorder has camera modes; this does
   * not, and 12-DEFERRED.md says so.
   */
  const html = renderCut({ ...base, blocks: [VOICE] } as Partial<CutData> as CutData);
  assert.match(html, /Sound only &mdash; no camera yet/);
});

test("a take that is not the line that was written does not read like praise", () => {
  /*
   * `why` carries two different sentences. Under a footage block it is the
   * scorer saying what it liked; under a recording it is src/take.ts saying
   * the audio is not the script — the only signal anybody gets that a forced
   * aligner put a script over the wrong take. Both arrived in the same
   * field, in the same grey, clamped to one line like a note.
   */
  const drifted = renderCut({
    ...base,
    blocks: [{ ...VOICE, why: "It reads about half of what you wrote.", takeVerdict: "drifted" as const }],
  } as Partial<CutData> as CutData);
  assert.match(drifted, />NOT THE LINE</);
  assert.doesNotMatch(drifted, /class="blk-why"/, "not the scorer's quiet grey");

  const unclear = renderCut({
    ...base,
    blocks: [{ ...VOICE, why: "The aligner placed almost nothing.", takeVerdict: "unclear" as const }],
  } as Partial<CutData> as CutData);
  assert.match(unclear, />COULDN'T TELL</, "which is a different answer from a wrong one");

  /* A take that reads the line says nothing at all: a row of reassurance
     under every good one is what made the bad one invisible. */
  const fine = renderCut({ ...base, blocks: [VOICE] } as Partial<CutData> as CutData);
  assert.doesNotMatch(fine, /NOT THE LINE|COULDN'T TELL/);
});

/* ── The judgement call, on the line it is about ────────────────────────── */

/**
 * THE GOLD EDGE SAID A CALL WAS MADE AND NAMED NOTHING.
 *
 * The conflicts panel in the rules pane settles the two rules IN GENERAL —
 * "whenever these two disagree, this one is right". This is the other half:
 * one moment in front of you, both rules named, both answers a press away.
 * They are different decisions and the product needs both; collapsing them
 * would make a standing rule out of one line's worth of doubt.
 */
const JUDGED = {
  ...BLOCK,
  id: "s:1",
  text: "I had four mugs and no kettle for the first three days",
};

type Judgement = { k: string; d: string; kept: boolean; byHand: boolean; momentId: string };

const withJudge = (j: Partial<Judgement>) =>
  renderCut({
    ...base,
    blocks: [BLOCK, JUDGED],
    blockContested: { "s:1": true },
    blockJudgement: { "s:1": { k: "01", d: "02", kept: false, byHand: false, momentId: "c9", ...j } },
  } as Partial<CutData> as CutData);

test("a judgement call names both rules and which is winning", () => {
  const html = withJudge({});
  assert.match(
    html,
    /Judgement call &mdash; rule 01 keeps it, rule 02 takes it out\. Rule 02 is winning\./,
  );
  /* And only on the block it is about. */
  const plain = html.slice(html.indexOf('data-block="s:0"'), html.indexOf('data-block="s:1"'));
  assert.doesNotMatch(plain, /Judgement call/);
});

test("the winning rule is the one that got its way, not always the drop", () => {
  assert.match(withJudge({ kept: true }), /Rule 01 is winning\./);
});

test("it says which rule is winning, never whether the line is in the cut", () => {
  /*
   * Those are the same fact on an assembled cut, where a block IS a moment,
   * and they are not on a cut of one video: there the blocks are the
   * transcript's segments and the rule engine's verdict governs the library,
   * so a moment the rules took out still has its segment on screen,
   * unstruck. The first version said "It is out." under a line that was
   * visibly in the cut.
   */
  const html = withJudge({});
  assert.doesNotMatch(html, /It is (in|out)\./);
});

test("both answers are offered, and they post opposite directions", () => {
  const html = withJudge({});
  assert.match(html, /class="judge-hand"[^>]*data-moment="c9"[^>]*data-keep="1"[^>]*>Keep it</);
  assert.match(html, /class="judge-hand"[^>]*data-moment="c9"[^>]*data-keep="0"[^>]*>Cut it</);
});

test("once you have answered it, the only move left is taking it back", () => {
  /*
   * A hand decision overrides every rule above it, so the rules are no
   * longer deciding and the panel must not name one of them as the winner.
   * Found by driving it: pressing Keep it moved the moment to "in · kept by
   * hand" and the panel went on saying rule 01 was winning.
   *
   * And the control that remains posts the SAME direction, because that is
   * what takes the hand back. "Keep it" on a moment you have already kept
   * would un-keep it — a button whose label is the opposite of what it does.
   */
  const kept = withJudge({ kept: true, byHand: true });
  assert.match(kept, /You kept it by hand\./);
  assert.doesNotMatch(kept, /is winning/);
  assert.match(kept, /class="judge-hand"[^>]*data-keep="1"[^>]*>Let the rules decide</);
  assert.doesNotMatch(kept, />Keep it</);
  assert.doesNotMatch(kept, />Cut it</);

  const cut = withJudge({ kept: false, byHand: true });
  assert.match(cut, /You cut it by hand\./);
  assert.match(cut, /class="judge-hand"[^>]*data-keep="0"[^>]*>Let the rules decide</);
});

test("Words shows no judgement call", () => {
  /* A page of prose with a pair of buttons mid-paragraph is the thing that
     view exists to get rid of. */
  const html = renderCut({
    ...base,
    view: "script",
    blocks: [JUDGED],
    blockJudgement: { "s:1": { k: "01", d: "02", kept: false, byHand: false, momentId: "c9" } },
  } as Partial<CutData> as CutData);
  assert.doesNotMatch(html, /Judgement call/);
});

/* ── Every take is kept ─────────────────────────────────────────────────── */

/**
 * INVARIANT 6, ON THE ONE THING THE ENGINE CANNOT RE-MAKE.
 *
 * A beat had one `media_r2_key`, so recording again overwrote the take
 * before it and "Redo" deleted the object from R2 outright. Rules switch
 * back on, struck words come back, cut moments wait thirty days — and a
 * performance was the single thing destroyed on the spot, when it is the
 * only one you cannot get back by pressing something.
 */
const take = (n: number, chosen: boolean, verdict: string | null = null) => ({
  id: `t:b:vo:${n}`,
  dur_ms: 9000 + n,
  verdict,
  chosen,
});

const withTakes = (list: ReturnType<typeof take>[], view: CutView = "blocks") =>
  renderCut({
    ...base,
    view,
    blocks: [{ ...VOICE, id: "b:vo", mediaKey: "u/x/takes/vo/2.wav" }],
    takes: { vo: list },
  } as Partial<CutData> as CutData);

test("a beat with one take shows no list", () => {
  /* A list of one is a list of nothing, and every other surface here goes
     absent rather than printing a count of one. */
  assert.doesNotMatch(withTakes([take(1, true)]), /EVERY TAKE IS KEPT/);
});

test("two or more takes are listed, newest first and numbered", () => {
  const html = withTakes([take(3, false), take(2, true), take(1, false)]);
  assert.match(html, /EVERY TAKE IS KEPT/);
  const nums = [...html.matchAll(/>take (\d)</g)].map((m) => m[1]);
  assert.deepEqual(nums, ["3", "2", "1"], "newest first, highest number first");
});

test("the one in the cut says so, and the others offer to replace it", () => {
  const html = withTakes([take(3, false), take(2, true), take(1, false)]);
  assert.match(html, /in the cut/);
  /* Exactly the two that are not chosen — a control beside the one already
     in use would do nothing. */
  assert.equal([...html.matchAll(/class="take-pick"/g)].length, 2);
  assert.doesNotMatch(html, /class="take-pick"[^>]*data-take="t:b:vo:2"/);
});

test("a take that is not the line that was written says so on its own row", () => {
  /*
   * The banner under the block is about the CHOSEN take. Here the fact is
   * what decides which one you pick, so it belongs on each row.
   */
  const html = withTakes([take(2, true), take(1, false, "drifted")]);
  assert.match(html, /not the line that was written/);
  /* And a take with no verdict says nothing — silence is the good case. */
  assert.doesNotMatch(withTakes([take(2, true), take(1, false)]), /not the line that was written/);
});

test("Words shows no take list", () => {
  assert.doesNotMatch(withTakes([take(2, true), take(1, false)], "script"), /EVERY TAKE IS KEPT/);
});
