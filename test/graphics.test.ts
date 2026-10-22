/**
 * GRAPHICS ARE CODE, NEVER PIXELS — invariant 8's last clause.
 *
 * Doc 08: "no diffusion model draws a word or a number (they can't)". So the
 * generated tier is not an image model, it is arithmetic over a spec — which
 * makes two rules that are policy everywhere else STRUCTURAL here:
 *
 *   never photoreal        there is no pixel in the output, and hasNoRaster
 *                          proves it per render
 *   every number sourced   the receipt is drawn ON the picture, because doc
 *                          08's house move is "provenance becomes a visible
 *                          act and answers 'says who?' on screen"
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { axisTop, chartSvg, hasNoRaster, quoteCard, receiptLine, W, H } from "../src/graphics.ts";
import { MAX_CATEGORIES, type ChartSpec } from "../src/pictures.ts";

const sourced = (value: number, cell: string): ChartSpec["data"][number] => ({
  value,
  provenance: { doc: "memo.pdf", page: 2, cell },
});

const good: ChartSpec = {
  mark: "bar",
  baseline: 0,
  units: "£m",
  categories: ["2023", "2024"],
  data: [sourced(4, "B2"), sourced(7, "B3")],
};

test("ACCEPTANCE: a chart that fails a lint gets no picture, only reasons", () => {
  /*
   * Doc 08's lints are HARD fails. A warning attached to a misleading chart
   * is a misleading chart with a note on it, so there is no svg at all —
   * and the reasons are the sentences the lint already carries, not "invalid
   * spec".
   */
  const tilted = chartSvg({ ...good, baseline: 40 });
  assert.equal(tilted.svg, null);
  assert.deepEqual(tilted.refused.map((l) => l.kind), ["baseline"]);
  assert.match(tilted.refused[0].reason, /bars start at zero/);

  /* And every other hard fail, each with no picture. */
  assert.equal(chartSvg({ ...good, dualAxis: true }).svg, null);
  assert.equal(chartSvg({ ...good, units: null }).svg, null);
  assert.equal(chartSvg({ ...good, mark: "area", oneDimensional: true }).svg, null);
  assert.equal(
    chartSvg({ ...good, categories: Array.from({ length: MAX_CATEGORIES + 1 }, (_, i) => `c${i}`) }).svg,
    null,
  );
  /* Invariant 4 inside a chart: a number with no receipt. */
  assert.equal(chartSvg({ ...good, data: [{ value: 4, provenance: null }] }).svg, null);
});

test("ACCEPTANCE: a chart that passes carries its receipt on the picture", () => {
  const out = chartSvg(good, { title: "What the programme cost" });
  assert.ok(out.svg, `refused: ${JSON.stringify(out.refused)}`);
  assert.deepEqual(out.refused, []);
  /* The house move. Not in a document somebody can choose not to open. */
  assert.match(out.svg, /memo\.pdf/);
  assert.match(out.svg, /B2/);
  assert.match(out.svg, /B3/);
  assert.match(out.svg, /What the programme cost/);
  /* The unit, once — it is a property of the axis and four copies is noise. */
  assert.equal((out.svg.match(/£m/g) ?? []).length, 1);
});

test("ACCEPTANCE: no pixel can get into a generated picture", () => {
  /*
   * "Generated is never photoreal" is a rule somebody could break anywhere
   * else in this product. Here it cannot be broken by accident, and this is
   * the measurement rather than the comment.
   */
  const chart = chartSvg(good).svg!;
  const card = quoteCard({ quote: "We moved the launch before the review came in." }).svg!;
  for (const svg of [chart, card]) {
    assert.ok(hasNoRaster(svg), "a raster got into a vector layer");
    assert.ok(!/<image/i.test(svg));
  }

  /* And the check itself catches all three ways one could arrive, or it is
     decoration. */
  assert.equal(hasNoRaster('<svg><image href="x.png"/></svg>'), false);
  assert.equal(hasNoRaster('<svg><rect fill="url(data:image/png;base64,AAA)"/></svg>'), false);
  assert.equal(hasNoRaster('<svg><use xlink:href="photo.jpg"/></svg>'), false);
});

test("ACCEPTANCE: every generated picture is labelled, by the only path that makes one", () => {
  /*
   * Invariant 8 and doc 09: an export carries the label without user action.
   * Drawn in the shared frame rather than by the caller, so the one code
   * path that produces these pictures cannot leave it off.
   */
  for (const svg of [chartSvg(good).svg!, quoteCard({ quote: "Said out loud." }).svg!]) {
    assert.match(svg, /Generated/);
  }
});

test("bars are drawn from zero, which is the lint in geometry", () => {
  /*
   * The lint says a bar chart must declare baseline 0; this says the drawing
   * agrees with it. A lint that passed while the renderer started the bars
   * somewhere else would be a lint about nothing.
   */
  const svg = chartSvg({ ...good, data: [sourced(5, "B2"), sourced(10, "B3")] }).svg!;
  /* `class="bar"`, not any rect: the frame's own furniture includes the
     label pill, and matching that counted three bars where there are two. */
  const rects = [...svg.matchAll(/<rect class="bar" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)];
  assert.equal(rects.length, 2, "two bars");
  const [a, b] = rects.map((m) => ({ y: Number(m[2]), h: Number(m[4]) }));
  /* Both bottoms land on the same baseline, and twice the value is twice the
     bar — which is the only thing a length can honestly encode. */
  assert.equal(Math.round(a.y + a.h), Math.round(b.y + b.h));
  assert.ok(Math.abs(b.h / a.h - 2) < 0.01, `ratio was ${b.h / a.h}, so the lengths lie about the numbers`);
});

test("the axis top is a round number at or above the largest value", () => {
  assert.equal(axisTop([4, 7]), 10);
  assert.equal(axisTop([120, 180]), 200);
  assert.equal(axisTop([0.3, 0.9]), 1);
  /* Never below the data, or a bar would run off the top of the frame. */
  for (const vs of [[1], [11], [99], [101], [2.5], [7.5]]) {
    assert.ok(axisTop(vs) >= Math.max(...vs), `${axisTop(vs)} < ${Math.max(...vs)}`);
  }
  /* All zeroes still gives a drawable axis rather than dividing by it. */
  assert.equal(axisTop([0, 0]), 1);
});

test("the receipt names each document once, with its cells gathered", () => {
  /* "memo.pdf p2, memo.pdf p2, memo.pdf p4" is a receipt nobody reads. */
  const line = receiptLine({
    ...good,
    data: [
      sourced(1, "B2"),
      sourced(2, "B2"),
      { value: 3, provenance: { doc: "letter.pdf" } },
    ],
  });
  assert.equal((line.match(/memo\.pdf/g) ?? []).length, 1);
  assert.match(line, /letter\.pdf/);
  assert.equal((line.match(/B2/g) ?? []).length, 1);
});

test("a quote card sets the words as type, unchanged", () => {
  /*
   * The reason this path exists: a diffusion model cannot draw a word. What
   * is on screen is exactly what was said, because there is no step between
   * the quote and the type that could reword it.
   */
  const words = "Fine — yes, we moved the launch before the review came in.";
  const out = quoteCard({ quote: words, said: "Tuesday night", source: "0:65" });
  assert.ok(out.svg);
  /* Wrapped across lines, so the text is in pieces — every word survives. */
  for (const w of ["Fine", "moved", "launch", "review", "came"]) {
    assert.match(out.svg, new RegExp(w));
  }
  assert.match(out.svg, /Tuesday night/);
});

test("an empty quote is refused rather than drawn as a blank frame", () => {
  const out = quoteCard({ quote: "   " });
  assert.equal(out.svg, null);
  assert.ok(out.refused.length);
});

test("the frame is the size the render works in", () => {
  assert.deepEqual([W, H], [1920, 1080]);
  assert.match(chartSvg(good).svg!, /viewBox="0 0 1920 1080"/);
});
