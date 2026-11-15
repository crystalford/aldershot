/**
 * WORDS: a script with a gutter, not Blocks with the furniture taken off.
 *
 * The build reached `view === "script"` and dropped the thumbnail and the rule
 * chip. Everything else stayed: the same page background, the same gaps, the
 * same stack of rows, a grey duration UNDER each line, and the per-line action
 * buttons still in the flow.
 *
 * The prototype draws one #141418 panel, 15px over a line-height of 2, and a
 * 56px mono gutter beside every line carrying the source's LETTER and the
 * timestamp in that source's own colour — "A 6:40" — or the word `you` in gold
 * for a line you say to camera. Under it, three sentences saying what the
 * gestures do.
 *
 * THE DEFECT NO ASSERTION WOULD HAVE FOUND is in here too, and it is the
 * reason the last of these tests exists: measured on the rendered build at
 * 1440px, a 574px row gave the gutter 56, the invisible action buttons 332 and
 * the words 138. A view whose whole job is reading ran at a quarter of its
 * width. It took a screenshot.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderCut, type CutData } from "../src/ui/pages/cut.ts";
import { CHIP_COLOURS } from "../src/ui/switcher.ts";
import { ACCENT } from "../src/ui/tokens.ts";
import type { Block } from "../src/blocks.ts";

const line = (id: string, start: number, text: string): Block =>
  ({
    id,
    origin: "footage" as const,
    start_ms: start,
    end_ms: start + 6_000,
    text,
    words: [
      { w: text.split(" ")[0], s: start / 1000, e: start / 1000 + 0.4 },
      { w: text.split(" ")[1] ?? "x", s: start / 1000 + 0.5, e: start / 1000 + 0.9 },
    ],
    struck: false,
    score: null,
    why: null,
    label: null,
    mediaKey: null,
    previewKey: null,
    voiceKey: null,
    posterKey: null,
  }) satisfies Block;

/** A line you record. No source, no timecode — it is you, now. */
const voiceLine: Block = {
  ...line("b:v1", 0, "what leaving adds up to"),
  origin: "voice" as const,
  words: [],
} satisfies Block;

const SOURCES = [
  { id: "sA", title: "Tuesday · kitchen", duration_s: 2466 },
  { id: "sB", title: "Thursday · the drive", duration_s: 3150 },
];

const base: CutData = {
  projectId: "p1",
  title: "whether to leave",
  sourceId: null,
  sourceTitle: null,
  sourceKey: null,
  posterKey: null,
  blocks: [line("s:0", 400_000, "I think the honest version is this"), line("s:1", 708_000, "every plan I make")],
  beats: [],
  cuts: [],
  view: "script",
  windowSize: 60,
  keptCount: 2,
  runtimeMs: 12_000,
  cleanups: { fillers: { found: 0, savedMs: 0 }, pauses: { found: 0, savedMs: 0 } },
  renders: [],
  job: null,
  passes: [],
  rules: [],
  moments: [],
  addable: [],
  blockRule: {},
  cutLine: "5:59 · 12 blocks · 3 of 3 vlogs",
  sources: SOURCES,
  blockSource: { "s:0": "sA", "s:1": "sB" },
  projects: [],
} as unknown as CutData;

const words = (d: Partial<CutData> = {}) => renderCut({ ...base, ...d });

/* ── The gutter ─────────────────────────────────────────────────────────── */

test("every line carries its source letter and time, in that source's colour", () => {
  const html = words();
  /*
   * THE LETTERS AND COLOURS MUST AGREE WITH THE CHIPS, which is the whole
   * reason both come from letterFor and CHIP_COLOURS rather than from a list
   * this page keeps. A page where the chip says B and the gutter says C about
   * the same recording is worse than one with no letter at all.
   */
  assert.match(html, new RegExp(`color:${CHIP_COLOURS[0]}[^"]*">A 6:40`), "the first source is A, in its own colour");
  assert.match(html, new RegExp(`color:${CHIP_COLOURS[1]}[^"]*">B 11:48`), "the second is B, in its own colour");
});

test("the time is unpadded, the way the prototype writes it", () => {
  /*
   * `tc` pads a position — "06:40" — and its comment is right that the
   * prototype pads positions elsewhere. Not here: footage.js carries every
   * moment's time as "0:00", "1:12", "6:40". Padded, a cut that never
   * reaches ten minutes draws a column of "00:" down its left edge.
   */
  const html = words({ blocks: [line("s:0", 72_000, "a minute and twelve seconds in")] });
  /* The letter is there too — this cut draws on two videos — so the assertion
     is about the TIME's shape, not about the whole gutter. */
  assert.match(html, />A 1:12</, "1:12, not 01:12");
  assert.doesNotMatch(html, />A 01:12</);
});

test("one video needs no letter, because a column of A says nothing", () => {
  const html = words({
    sources: [SOURCES[0]],
    blockSource: { "s:0": "sA" },
    blocks: [line("s:0", 400_000, "I think the honest version is this")],
  });
  assert.match(html, />6:40</, "the time is still there");
  assert.doesNotMatch(html, />A 6:40</, "and the letter is not");
});

test("a line you record reads `you`, in gold", () => {
  const html = words({ blocks: [voiceLine], blockSource: {} });
  assert.match(html, new RegExp(`color:${ACCENT.gold}[^"]*">you<`), "the gutter says you, in gold");
  /*
   * And the line itself is gold, which is what the legend strip promises.
   *
   * SCOPED TO THE BLOCK, and that is the whole assertion. Two earlier
   * versions were wrong in opposite directions: `color:#D9B36A[^"]*>` could
   * never match, because the character after the colour IS the quote; and
   * plain `color:#D9B36A"` matched the LEGEND's own gold swatch — the
   * `<span style="color:#D9B36A">gold</span>` that is on the page whatever
   * the lines look like — so removing the gold from every line left it
   * green. Found by doing it: the break has to fail the test or the test was
   * not pinning its claim.
   */
  /*
   * THE BODY DIV'S OWN STYLE, named exactly. Three wrong versions before
   * this one, and each passed over a break that should have failed it:
   *
   *   color:#D9B36A[^"]*>   — cannot match at all; the character after the
   *                            colour IS the quote.
   *   color:#D9B36A"        — matched the LEGEND's gold swatch, which is on
   *                            the page whatever the lines look like.
   *   the same, scoped to the block — matched the "Your voice" origin tag
   *                            INSIDE the block, which is gold either way.
   *
   * The line-height is what makes it the body: only the script's text block
   * sets 2.
   */
  assert.match(html, new RegExp(`line-height:2;color:${ACCENT.gold}"`), "the words are gold too");

  /* And a line of footage is not, or "gold is you" means nothing. */
  assert.match(words(), /line-height:2;color:rgba\(236,236,241,0\.85\)"/);
});

/* ── The page it sits on ────────────────────────────────────────────────── */

test("the lines sit in one panel, not on the page", () => {
  const html = words();
  const container = html.slice(html.indexOf('id="blocks"'), html.indexOf('id="blocks"') + 400);
  assert.match(container, /background:#141418/, "the prototype's own panel");
  assert.match(container, /line-height|text-wrap:pretty/, "and it sets type rather than stacking rows");
  assert.match(container, /gap:0/, "lines run together");

  /* Blocks is NOT a panel — it is a stack of cards, and conflating the two
     is how Words became Blocks with the furniture removed. */
  const blocks = renderCut({ ...base, view: "blocks" });
  const stack = blocks.slice(blocks.indexOf('id="blocks"'), blocks.indexOf('id="blocks"') + 400);
  assert.doesNotMatch(stack, /background:#141418/);
});

test("the reading is named, and the three gestures are spelled out under it", () => {
  const html = words();
  assert.match(html, />The cut, as words</, "the heading says which reading this is");
  for (const promise of [
    "click a word</span> — the video skips it, the word stays readable",
    "click a paragraph</span> — the player jumps to it",
    "is you, to camera",
  ]) {
    assert.ok(html.includes(promise), `the legend says: ${promise}`);
  }
  /* Blocks has no legend: the gestures it describes are not its gestures. */
  assert.doesNotMatch(renderCut({ ...base, view: "blocks" }), /the word stays readable/);
});

/* ── The one a screenshot found ─────────────────────────────────────────── */

test("the action buttons are out of the flow, so the words get the column", () => {
  /*
   * MEASURED, NOT GUESSED. At 1440px the row was 574px: gutter 56, actions
   * 332, words 138. The buttons are invisible until you hover a line and
   * they were taking more than half the measure the whole time, so every
   * sentence broke after five words. No assertion in this repo could see it;
   * `node scripts/shoot.cjs app /p/<id>/script` could.
   *
   * Positioned rather than deleted — the prototype's Words row has no
   * controls at all, and removing them would lose the one gesture somebody
   * reading actually wants.
   */
  const html = words();
  const actions = html.slice(html.indexOf('class="blk-actions"'));
  const style = actions.slice(0, actions.indexOf(">"));
  assert.match(style, /position:absolute/, "out of flow in Words");
  assert.doesNotMatch(style, /flex:none/, "not a flex child taking its own width");

  /* In Blocks they are a flex child, which is correct there: the row is a
     card with room for them. */
  const bl = renderCut({ ...base, view: "blocks" });
  const blActions = bl.slice(bl.indexOf('class="blk-actions"'));
  assert.match(blActions.slice(0, blActions.indexOf(">")), /flex:none/);
});

test("Words carries the cut control and nothing else from the Blocks row", () => {
  const html = words();
  assert.match(html, /class="blk-strike"/, "a line can still be cut while you read");
  /* The arrows reorder and the thumbnail manages — both are Blocks' job, and
     a page of prose with a frame on every line is a form again. */
  assert.doesNotMatch(html, /class="blk-move"/, "no reorder arrows in a script");
});
