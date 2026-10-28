/**
 * THE SHORTS WORKBENCH: one short, and everything you decide about it.
 *
 * The build had the shortlist — lines graded with bands and reasons and a
 * "Keep it" each — which is half of it. A list says what stands on its own
 * and gives you nowhere to work. The prototype puts ONE short at the top with
 * its picture, its reasons, its words and the decisions, and the list
 * underneath is how you move between them.
 *
 * MOST OF WHAT THESE PIN IS WHAT IS REFUSED. Two of the prototype's controls
 * cannot be honoured by this renderer, and a control that offers a capability
 * nothing has is worse than no control:
 *
 *   REFRAME — "Follow the speaker" and "Split screen" need subject tracking
 *   and a two-up composite, and neither exists in src/ or container/.
 *
 *   CAPTION NAMES — the prototype's are "Word by word" and "Two lines".
 *   container/render.mjs draws both styles from the SAME cues (cuesFromWords
 *   chunks words into wrapped phrases) and differs only in font size, weight
 *   and outline. Nothing is word-by-word. So the names stay Bold and Clean,
 *   which describe what actually differs.
 *
 *   HASHTAGS — a tag is a claim about what people are searching for, and
 *   src/shorts.ts already refuses to grade Trend for exactly that reason.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderCut, type CutData } from "../src/ui/pages/cut.ts";
import { ASPECTS, CAPTION_STYLES } from "../src/render-job.ts";
import type { Block } from "../src/blocks.ts";

const line = (id: string, text: string, over: Partial<Block> = {}): Block =>
  ({
    id,
    origin: "footage" as const,
    start_ms: 400_000,
    end_ms: 446_000,
    text,
    words: text.split(" ").map((w, i) => ({ w, s: 400 + i * 0.4, e: 400 + i * 0.4 + 0.35 })),
    struck: false,
    score: null,
    why: null,
    label: null,
    mediaKey: null,
    previewKey: null,
    voiceKey: null,
    posterKey: null,
    ...over,
  }) satisfies Block;

const base: CutData = {
  projectId: "p1",
  title: "whether to leave",
  sourceId: "sA",
  sourceTitle: "Sunday · the house",
  sourceKey: null,
  posterKey: null,
  blocks: [
    line("s:0", "So I'm going. Not because it's better there. Because staying is the only decision I've never actually made."),
    line("s:1", "and the other thing nobody says"),
  ],
  beats: [],
  cuts: [],
  view: "shorts",
  windowSize: 60,
  keptCount: 2,
  runtimeMs: 92_000,
  cleanups: { fillers: { found: 0, savedMs: 0 }, pauses: { found: 0, savedMs: 0 } },
  renders: [],
  job: null,
  passes: [],
  rules: [],
  moments: [],
  addable: [],
  blockRule: {},
  cutLine: "1:32 · 2 blocks",
  projects: [],
} as unknown as CutData;

const shorts = (d: Partial<CutData> = {}) => renderCut({ ...base, ...d });

/* ── The short in front of you ──────────────────────────────────────────── */

test("one short is focused, with its grade, its length and where it came from", () => {
  const html = shorts();
  const panel = html.slice(html.indexOf('class="short-focus"'));
  assert.ok(panel.length, "there is a focused short at all");
  assert.match(panel.slice(0, 2500), /KEEPING/);
  assert.match(panel.slice(0, 2500), /1 of 2 shortlisted/);
  assert.match(panel.slice(0, 2500), /Sunday · the house/, "the credit says which video");
  assert.match(panel.slice(0, 2500), /6:40/, "and where in it");
});

test("?short= picks it, so a link to one short is a link to one short", () => {
  const html = shorts({ shortId: "s:1" } as Partial<CutData>);
  const panel = html.slice(html.indexOf('class="short-focus"'));
  assert.match(panel.slice(0, 200), /data-short="s:1"/);
});

test("the hook is the opening, clamped so it cannot run out of the frame", () => {
  const html = shorts();
  assert.match(html, /So I'm going\./, "the opening sentence is burned in");
  /* It is drawn where the burned-in text goes, and a long one has to stop
     rather than running past the bottom of a 9:16 box. */
  assert.match(html, /-webkit-line-clamp:4/);
});

/* ── What it refuses ────────────────────────────────────────────────────── */

test("there is no Reframe control, because two of its three options are lies", () => {
  const html = shorts();
  for (const lie of ["Follow the speaker", "Split screen", "Reframe"]) {
    assert.ok(!html.includes(lie), `${lie} needs a capability nothing in this codebase has`);
  }
});

test("Shape offers what ASPECTS validates, and nothing else", () => {
  const html = shorts();
  for (const a of ASPECTS) assert.ok(html.includes(`data-value="${a}"`), `${a} is offered`);
  assert.match(html, /aria-pressed="true"[^>]*>?[\s\S]{0,80}9:16|data-value="9:16"[^>]*aria-pressed="true"/);
});

test("Captions keep the renderer's own names, not the prototype's", () => {
  /*
   * container/render.mjs draws Bold and Clean from the same cues and differs
   * only in size, weight and outline. Renaming them "Word by word" and "Two
   * lines" would name a behaviour that does not exist — the exact defect
   * every other refusal here is about.
   */
  const html = shorts();
  for (const c of CAPTION_STYLES) assert.ok(html.includes(`data-value="${c}"`), `${c} is offered`);
  assert.ok(!html.includes("Word by word"), "a karaoke caption nothing renders");
});

test("the post copy has no hashtags, and says why", () => {
  const html = shorts();
  /*
   * Scoped to the post copy, and case-SENSITIVE. The first version was
   * /#[a-z]{2,}/i over the whole page, which matches every hex colour in it
   * — #ECECF1 is "#" followed by letters as far as a case-insensitive class
   * is concerned. It went red against markup that had no tags in it.
   */
  const copy = html.slice(html.indexOf("POST COPY"));
  assert.doesNotMatch(copy.slice(0, 900), /#[a-z]{2,}/, "no invented tags");
  assert.match(html, /nothing here measures what people are searching for/);
});

/* ── The controls are real ──────────────────────────────────────────────── */

test("making the short is a control, and the chips are what it sends", () => {
  const html = shorts();
  assert.match(html, /class="short-make"[^>]*data-block="s:0"/);
  /* The aspect and caption chips carry their values on the element, so the
     request reads what is on screen rather than a second copy of it. */
  assert.match(html, /class="short-aspect"[^>]*data-value=/);
  assert.match(html, /class="short-caption"[^>]*data-value=/);
});

test("there is no Add it to the cut, because every line here is already in it", () => {
  /*
   * The prototype's shorts are pulled from the library, so adding one is a
   * real action there. This shortlist IS the cut's own lines.
   */
  /* Including in a comment: an HTML comment inside the template SHIPS, and
     the first draft put the phrase on every page this way. */
  assert.ok(!shorts().includes("Add it to the cut"));
});

test("trimming a short is its own set of words, not the cut's", () => {
  const html = shorts();
  /* .sw carries the SHORT's id; the cut's own strikes are .w and carry a
     block and a word. Two gestures on the same words, two records. */
  assert.match(html, /class="sw"[^>]*data-short="s:0"[^>]*data-word="0"/);
  /* On the SPAN, not merely present: client.ts queries [data-short-dur] and
     is inlined into the page, so the bare attribute name is in the output
     whether or not anything renders it. Third time this trap in this file. */
  assert.match(html, /<span data-short-dur/, "and the stated length follows the words");
});

test("a cut with no line to cut from says so instead of drawing an empty workbench", () => {
  /*
   * Blocks that EXIST but none eligible — a cut of nothing but recordings.
   * `blocks: []` takes a different path through the page entirely, so it
   * tested the wrong absence.
   */
  const html = shorts({
    blocks: [{ ...line("b:v", "what leaving adds up to"), origin: "voice" as const, words: [] }],
  });
  assert.match(html, /Nothing to cut a short from yet/);
  /* The PANEL, not the string: client.ts binds `.short-focus` and is inlined
     into every page, so the bare name is there whatever is rendered. */
  assert.ok(!html.includes('class="short-focus"'));
});

/* ── The list, filtered ─────────────────────────────────────────────────── */

const long = (id: string, text: string, ms: number) =>
  line(id, text, { start_ms: 0, end_ms: ms });

test("what is not a short is separated, with the measurement that says so", () => {
  /*
   * problems() has produced this fact since shorts landed and nothing showed
   * it: a line too short or too long sat low in the list with a band. "This
   * is not a short and here is why" is a different sentence from "this is a
   * weak short", and only the first one can be argued with.
   */
  const html = shorts({
    blocks: [
      long("s:0", "A line that is a perfectly good length for a short to be.", 30_000),
      long("s:1", "Too quick.", 2_000),
      long("s:2", "Far too long to be a short by any measure at all.", 120_000),
    ],
  });
  assert.match(html, /NOT SHORTS/);
  assert.match(html, /it is over before a viewer has arrived/);
  assert.match(html, /it is longer than a short/);
  assert.match(html, /Use it anyway/, "a measurement is a reason, not a veto");
});

test("the length bands filter what is shown and do not re-grade anything", () => {
  const blocks = [
    long("s:0", "A line of about twenty-five seconds, which is squarely a short.", 25_000),
    long("s:1", "A line of about seventy seconds, which is a longer one.", 70_000),
  ];
  const narrow = shorts({ blocks, shortLen: "15–35s" } as Partial<CutData>);
  assert.match(narrow, /about twenty-five seconds/);
  assert.doesNotMatch(narrow.slice(narrow.indexOf("NOT SHORTS") >= 0 ? 0 : 0, narrow.length), /seventy seconds[\s\S]*seventy seconds/);

  const wide = shorts({ blocks, shortLen: "40–90s" } as Partial<CutData>);
  assert.match(wide, /about seventy seconds/);

  /* The bands are a view. A line's grade is what it is whichever band is on,
     because how long something is and whether it stands on its own are two
     questions. */
  for (const html of [narrow, wide]) assert.match(html, /Bands and reasons, not scores/);
});

test("best N takes the top N, in the order the engine put them", () => {
  /*
   * COUNTED, not sampled. The first version asserted that each list contained
   * something, which was true whether or not the count did anything at all —
   * removing the slice failed nothing. The claim is "N rows", so it counts
   * rows.
   */
  const blocks = Array.from({ length: 6 }, (_, i) =>
    long(`s:${i}`, `A line number ${i} that stands on its own perfectly well.`, 25_000),
  );
  const rows = (html: string) => (html.match(/class="short-line"/g) || []).length;

  assert.equal(rows(shorts({ blocks })), 6, "all of them with no count set");
  assert.equal(rows(shorts({ blocks, shortCount: 4 } as Partial<CutData>)), 4, "best 4 is four");

  /* And it is the TOP four — the engine's order, strongest first. */
  const four = shorts({ blocks, shortCount: 4 } as Partial<CutData>);
  assert.ok(four.includes("A line number 0"), "the first the engine ranked is in");
});

test("the stats line sums what is on screen, and names what was set aside", () => {
  const html = shorts({
    blocks: [long("s:0", "A perfectly good length for a short.", 30_000), long("s:1", "Too quick.", 2_000)],
  });
  assert.match(html, /1 short · 0:30 to post · 1 not shorts/);
});
