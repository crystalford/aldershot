/**
 * TWO THINGS THE ENGINE KNEW AND THE SCREEN DID NOT SAY.
 *
 * `contest` has been written by src/rules.ts on every moment a keep rule and a
 * drop rule both matched since the engine was ported, and nothing in src/ui/
 * read it. A cut built from rules that contradict each other looked exactly
 * like one built from rules that agree — which is the single thing a pane of
 * visible rules exists to prevent.
 *
 * And the notes beside the cut's own numbers were not there at all: what is
 * still to record (counted since voice beats landed, shown only as a phrase at
 * the end of a line), what the sound pass did, and how many moments two rules
 * disagreed about.
 *
 * ABSENT RATHER THAN ZERO is half of what these pin. "0 judgement calls" sends
 * somebody looking for something that is not there.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderCut, type CutData } from "../src/ui/pages/cut.ts";
import { ACCENT } from "../src/ui/tokens.ts";
import type { Block } from "../src/blocks.ts";

const block = (id: string, over: Partial<Block> = {}): Block =>
  ({
    id,
    origin: "footage" as const,
    start_ms: 0,
    end_ms: 6_000,
    text: "a line of it",
    words: [],
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

const moment = (id: string, over: Partial<CutData["moments"][number]> = {}): CutData["moments"][number] => ({
  id,
  quote: "a line of it",
  source_title: "Tuesday",
  in: true,
  note: "in · rule 01",
  ...over,
});

const RULES: CutData["rules"] = [
  { id: "r1", text: "Keep the parts where you are working something out.", on: true, effect: "keeps 8 blocks", hand: false },
  { id: "r2", text: "Take out the hellos and the mic checks.", on: true, effect: "takes out 3 moments", hand: false },
];

const base: CutData = {
  projectId: "p1",
  title: "whether to leave",
  sourceId: "sA",
  sourceTitle: "Tuesday",
  sourceKey: null,
  posterKey: null,
  blocks: [block("b:1")],
  beats: [],
  cuts: [],
  view: "blocks",
  windowSize: 60,
  keptCount: 1,
  runtimeMs: 6_000,
  cleanups: { fillers: { found: 0, savedMs: 0 }, pauses: { found: 0, savedMs: 0 } },
  renders: [],
  job: null,
  passes: [],
  rules: RULES,
  moments: [moment("m1")],
  addable: [],
  blockRule: {},
  cutLine: "0:06 · 1 block · Tuesday",
  projects: [],
} as unknown as CutData;

const cut = (d: Partial<CutData> = {}) => renderCut({ ...base, ...d });

const contested = (n: number) =>
  Array.from({ length: n }, (_, i) => moment(`m${i}`, { in: false, contest: { k: "01", d: "02", kId: "r1" } }));

/* ── The disagreement ───────────────────────────────────────────────────── */

test("when two rules disagree, the pane says so and names both", () => {
  const html = cut({ moments: contested(3) });
  assert.match(html, /Rules 01 and 02 disagree on 3 moments\./);
  assert.match(
    html,
    /Rule 02 wins, because taking out beats keeping unless you say otherwise\. Those moments are out\./,
    "the default is stated, not assumed — a user who cannot see which way it went cannot tell a decision from a bug",
  );
  assert.match(html, /Let 01 win/);
  assert.match(html, /Show which moments/);
});

test("one moment is one moment, not 1 moments", () => {
  assert.match(cut({ moments: contested(1) }), /disagree on 1 moment\./);
});

test("rules that agree raise no panel at all, and no note either", () => {
  const html = cut();
  assert.doesNotMatch(html, /disagree on/, "absent, not a zero");
  assert.doesNotMatch(html, /Let 0. win/);
  /*
   * AND THE NOTE IS ABSENT TOO, which is the half the panel assertion above
   * does not cover. "0 judgement calls — marked in the blocks" is a sentence
   * that sends somebody looking through the cut for marks that are not
   * there. Caught by breaking the `if (contested)` guard to `if (true)` and
   * watching every test stay green.
   */
  assert.doesNotMatch(html, /judgement call/, "a note with nothing to say is not rendered");
});

test("one conflict is shown, not a list of them", () => {
  /*
   * The prototype slices to one — `Object.keys(pairs).slice(0, 1)` — and it
   * is right: a list of disagreements is a form to work through, one
   * disagreement is a decision to make. The others are still counted in the
   * note and still marked on their blocks.
   */
  const html = cut({
    moments: [
      moment("m1", { in: false, contest: { k: "01", d: "02", kId: "r1" } }),
      moment("m2", { in: false, contest: { k: "02", d: "01", kId: "r2" } }),
    ],
  });
  assert.equal((html.match(/disagree on/g) || []).length, 1);
});

test("a conflict naming a rule that is not in the pane is not shown", () => {
  /* Archived, or made by hand. A conflict nobody can act on is noise. */
  const html = cut({
    rules: [RULES[0]],
    moments: contested(2),
  });
  assert.doesNotMatch(html, /disagree on/);
});

/* ── The note, and the mark it promises ─────────────────────────────────── */

test("the judgement calls are counted beside the cut, and marked on the blocks", () => {
  const html = cut({
    moments: contested(2),
    blocks: [block("b:1"), block("b:2")],
    blockContested: { "b:2": true },
  } as Partial<CutData>);
  assert.match(html, /2 judgement calls — marked in the blocks/);

  /* And the promise is kept: the block it names carries the gold edge. */
  const row = html.slice(html.indexOf('data-block="b:2"'));
  assert.match(row.slice(0, row.indexOf(">")), new RegExp(`inset 2px 0 0 0 ${ACCENT.gold}`));

  /* The one nobody disagreed about does not. */
  const plain = html.slice(html.indexOf('data-block="b:1"'));
  assert.doesNotMatch(plain.slice(0, plain.indexOf(">")), new RegExp(`inset 2px 0 0 0 ${ACCENT.gold}`));
});

test("one call reads singular", () => {
  assert.match(cut({ moments: contested(1) }), /1 judgement call — marked/);
});

/* ── What is still to record ────────────────────────────────────────────── */

const voiceBeat = (over: Record<string, unknown> = {}) => ({
  kind: "vo",
  media_r2_key: null,
  clip_id: null,
  text: "What why-leave adds up to — twelve seconds, you, to camera",
  ...over,
});

test("the recording note says how many are left AND which one is next", () => {
  /*
   * "2 of 4 recorded" on its own is a number nobody can act on. The
   * prototype names the line you still owe.
   */
  const html = cut({ beats: [voiceBeat({ media_r2_key: "r2/a.webm" }), voiceBeat()] } as Partial<CutData>);
  assert.match(html, /1 of 2 recorded — next: What why-leave adds up to/);
});

test("all recorded says so instead, in green", () => {
  const html = cut({ beats: [voiceBeat({ media_r2_key: "r2/a.webm" })] } as Partial<CutData>);
  assert.match(html, /All 1 recorded — ready to render/);
  assert.doesNotMatch(html, /recorded — next/);
});

test("a struck voice beat is not work you still owe", () => {
  /* You decided against it. Counting it said "3 voiceovers to go" about a
     cut where one of the three had already been cut. */
  const html = cut({ beats: [voiceBeat({ struck: 1 })] } as Partial<CutData>);
  assert.doesNotMatch(html, /recorded/);
});

test("a cut with no voice beats says nothing about recording", () => {
  assert.doesNotMatch(cut(), /recorded/);
});

/* ── The sound line, which does not say what the prototype says ─────────── */

test("a multi-source cut does not claim levels were matched per source", () => {
  /*
   * THE DIVERGENCE, PINNED. The prototype's line is "Levels matched across 3
   * sources" and this product cannot honestly claim it: src/loudness.ts
   * normalises the PROGRAMME once, applied to the finished mix, and
   * container/render.mjs explains why normalising each part separately is
   * wrong. The line says what the pipeline does instead, and 12-DEFERRED.md
   * records what would have to be true to restore the stronger claim.
   */
  const html = cut({
    blocks: [block("b:1", { mediaKey: "a.mp4" }), block("b:2", { mediaKey: "b.mp4" })],
  });
  assert.match(html, /Loudness set for the platform/);
  assert.doesNotMatch(html, /Levels matched across/, "a claim the render cannot keep");
});

test("a single-source cut says nothing about sound at all", () => {
  assert.doesNotMatch(cut(), /Loudness set/);
});

/* ── The join that only worked for assembled cuts ───────────────────────── */

/**
 * THE MARK HAS TO LAND ON A CUT OF ONE VIDEO, which is most of them.
 *
 * `blockContested` and `blockRule` were both built by walking BEATS, because
 * a beat carries the moment's id in `clip_id`. A cut with a source of its own
 * has no beats at all — its blocks come straight from the transcript's
 * segments and are identified `s:<idx>`. So on the commonest shape of cut in
 * the product, neither the rule chip nor the gold judgement mark could ever
 * appear, while the cut's own note went on promising "marked in the blocks".
 *
 * Found the first time a fixture had rules that disagreed AND a single
 * source: the note rendered and the mark did not.
 *
 * Pinned here on the RENDERER's contract — given a contested block id, the
 * mark is drawn — and the route's half is pinned by scripts/seed-fixture.cjs,
 * which fails if the page does not carry `data-contested` after seeding two
 * rules that argue.
 */
test("a segment block can carry the mark, not only a beat block", () => {
  const html = cut({
    moments: contested(2),
    /* `s:` — a segment of this project's own source, the shape a cut of one
       video is made of. The beat shape is `b:<id>`. */
    blocks: [block("s:0"), block("s:1")],
    blockContested: { "s:1": true },
  } as Partial<CutData>);

  const marked = html.slice(html.indexOf('data-block="s:1"'));
  assert.match(marked.slice(0, marked.indexOf(">")), new RegExp(`inset 2px 0 0 0 ${ACCENT.gold}`));

  const plain = html.slice(html.indexOf('data-block="s:0"'));
  assert.doesNotMatch(plain.slice(0, plain.indexOf(">")), new RegExp(`inset 2px 0 0 0 ${ACCENT.gold}`));
});
