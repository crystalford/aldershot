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
