/**
 * GRAPHICS ARE CODE, NEVER PIXELS — invariant 8's last clause, built.
 *
 * Doc 08: "Charts, diagrams, type and annotations render as code from design
 * tokens — no diffusion model draws a word or a number (they can't)." So the
 * generated tier of the source order is not an image model at all. It is
 * this: a spec in, SVG out, every mark placed by arithmetic.
 *
 * WHICH MAKES "NEVER PHOTOREAL" STRUCTURAL RATHER THAN A POLICY. Decision 26
 * and doc 08 both forbid photoreal generation, and everywhere else in this
 * product that is a rule somebody could break. Here it cannot be broken by
 * accident: there is no pixel in the output, and `hasNoRaster` below proves
 * it on every render rather than trusting that nobody added an <image>.
 *
 * AND THE RECEIPT IS ON SCREEN. Doc 08 calls this the house move:
 * "provenance becomes a visible act and answers 'says who?' on screen". A
 * chart whose numbers came from a document says so IN the chart, not in a
 * document somebody can choose not to open. That is invariant 4 at 1080p.
 *
 * NOTHING HERE IS A MODEL CALL. `lintChart` decides whether a chart may
 * exist and this decides what it looks like; both are arithmetic over a
 * spec. A chart that fails a lint returns its reasons and NO picture —
 * doc 08's lints are hard fails, and a warning attached to a misleading
 * chart is a misleading chart with a note on it.
 */

import { ACCENT, C, FONT } from "./ui/tokens.ts";
import { KIND_LABEL, chartIsRenderable, lintChart, type ChartSpec, type Lint } from "./pictures.ts";

/** 1080p, which is what the render works in. */
export const W = 1920;
export const H = 1080;

/**
 * The longest line a quote card sets, in characters.
 *
 * Measured rather than judged: see `quoteCard`. A Worker has no font
 * metrics, so the wrap counts characters and the ceiling is chosen by
 * rasterising the result and looking at where the ink ends.
 */
export const WRAP_CHARS = 36;

/* Room for the receipt line and the label, which are not optional furniture. */
const PAD = { top: 150, right: 120, bottom: 230, left: 160 } as const;

/** The key's colours, in order. Each accent already means something. */
const SERIES = [ACCENT.cyan, ACCENT.gold, ACCENT.green, ACCENT.violet, ACCENT.red, C.ink70, C.ink45];

export interface Rendered {
  /** Null when it may not be drawn. A refusal, not a failure. */
  svg: string | null;
  /** Every lint that blocked it, in the words a person reads. */
  refused: Lint[];
}

const esc = (v: unknown): string =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * WHERE EVERY NUMBER CAME FROM, in one line.
 *
 * Deduplicated by document, with pages gathered, because "memo.pdf p2,
 * memo.pdf p2, memo.pdf p4" is a receipt nobody reads. Cells are named when
 * there is one — doc 08's datum is `{doc, page, bbox, verbatim cell}` and
 * the cell is the part that lets somebody check the number rather than the
 * page.
 */
export function receiptLine(spec: ChartSpec): string {
  const byDoc = new Map<string, Set<string>>();
  for (const d of spec.data) {
    const doc = d.provenance?.doc;
    if (!doc) continue;
    if (!byDoc.has(doc)) byDoc.set(doc, new Set());
    const where = [d.provenance?.page == null ? "" : `p${d.provenance.page}`, d.provenance?.cell ?? ""]
      .filter(Boolean)
      .join(" ");
    if (where) byDoc.get(doc)!.add(where);
  }
  if (!byDoc.size) return "";
  return [...byDoc.entries()]
    .map(([doc, where]) => (where.size ? `${doc} — ${[...where].join(", ")}` : doc))
    .join(" · ");
}

/** The nice round top of the axis, so the gridlines land on readable numbers. */
export function axisTop(values: number[]): number {
  const max = Math.max(0, ...values);
  if (max === 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 2.5, 5, 10]) {
    const top = step * pow;
    if (top >= max) return top;
  }
  return 10 * pow;
}

/**
 * A chart, drawn from a spec that has passed its lints.
 *
 * REFUSES FIRST. `chartIsRenderable` is the gate and the lints are hard
 * fails: a bar from a non-zero baseline, two value axes, an area over one
 * dimension, more than seven colours, numbers with no unit, or any datum
 * with no source. Each comes back as the sentence it already carries.
 */
export function chartSvg(
  spec: ChartSpec,
  opts: { title?: string; caption?: string } = {},
): Rendered {
  const refused = lintChart(spec);
  if (!chartIsRenderable(spec)) return { svg: null, refused };

  const values = spec.data.map((d) => d.value);
  const top = axisTop(values);
  const plot = {
    x: PAD.left,
    y: PAD.top,
    w: W - PAD.left - PAD.right,
    h: H - PAD.top - PAD.bottom,
  };
  /* Bars start at zero, which the lint already enforced — this is the same
     fact in geometry, and the reason the lint can be a hard fail at all. */
  const yOf = (v: number) => plot.y + plot.h - (v / top) * plot.h;

  const parts: string[] = [];

  /* Gridlines at quarters, labelled, with the unit on the top one only: the
     unit is a property of the axis and repeating it four times is noise. */
  for (let i = 0; i <= 4; i += 1) {
    const v = (top / 4) * i;
    const y = yOf(v);
    parts.push(
      `<line x1="${plot.x}" y1="${y.toFixed(1)}" x2="${plot.x + plot.w}" y2="${y.toFixed(1)}" stroke="${C.hairline}" stroke-width="2"/>`,
      `<text x="${plot.x - 24}" y="${(y + 12).toFixed(1)}" text-anchor="end" font-family="${FONT.mono}" font-size="28" fill="${C.ink45}">${esc(
        Number.isInteger(v) ? v : v.toFixed(1),
      )}${i === 4 && spec.units ? ` ${esc(spec.units)}` : ""}</text>`,
    );
  }

  const n = spec.data.length;
  const colour = (i: number) => SERIES[i % SERIES.length];

  if (spec.mark === "bar") {
    const slot = plot.w / Math.max(1, n);
    const bar = Math.min(slot * 0.62, 180);
    spec.data.forEach((d, i) => {
      const x = plot.x + slot * i + (slot - bar) / 2;
      const y = yOf(d.value);
      parts.push(
        /* Named, so the mark is identifiable in the output rather than
           being one anonymous rect among the frame's furniture. */
        `<rect class="bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bar.toFixed(1)}" height="${(plot.y + plot.h - y).toFixed(1)}" fill="${colour(i)}" rx="4"/>`,
      );
      const label = spec.categories?.[i];
      if (label) {
        parts.push(
          `<text x="${(x + bar / 2).toFixed(1)}" y="${plot.y + plot.h + 48}" text-anchor="middle" font-family="${FONT.ui}" font-size="30" fill="${C.ink70}">${esc(label)}</text>`,
        );
      }
    });
  } else {
    /* Line, point and area share their geometry; the mark decides whether
       the shape is stroked, dotted or filled under. */
    const step = n > 1 ? plot.w / (n - 1) : 0;
    const pts = spec.data.map((d, i) => `${(plot.x + step * i).toFixed(1)},${yOf(d.value).toFixed(1)}`);
    if (spec.mark === "area") {
      parts.push(
        `<path d="M ${plot.x},${plot.y + plot.h} L ${pts.join(" L ")} L ${(plot.x + step * (n - 1)).toFixed(1)},${plot.y + plot.h} Z" fill="${colour(0)}" fill-opacity="0.35"/>`,
      );
    }
    if (spec.mark !== "point") {
      parts.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="${colour(0)}" stroke-width="5" stroke-linejoin="round"/>`);
    }
    if (spec.mark === "point" || spec.mark === "line") {
      for (const p of pts) {
        const [px, py] = p.split(",");
        parts.push(`<circle cx="${px}" cy="${py}" r="9" fill="${colour(0)}"/>`);
      }
    }
  }

  /* The key, when there is more than one named thing and the marks are not
     already labelled under the axis. */
  if (spec.mark !== "bar" && (spec.categories?.length ?? 0) > 1) {
    spec.categories!.forEach((cat, i) => {
      const x = plot.x + i * 300;
      parts.push(
        `<rect x="${x}" y="${H - 150}" width="22" height="22" fill="${colour(i)}" rx="3"/>`,
        `<text x="${x + 34}" y="${H - 131}" font-family="${FONT.ui}" font-size="28" fill="${C.ink70}">${esc(cat)}</text>`,
      );
    });
  }

  const receipt = receiptLine(spec);

  return {
    svg: frame(
      [
        opts.title
          ? `<text x="${PAD.left}" y="88" font-family="${FONT.ui}" font-size="54" font-weight="600" fill="${C.ink}">${esc(opts.title)}</text>`
          : "",
        parts.join(""),
        opts.caption
          ? `<text x="${PAD.left}" y="${H - 96}" font-family="${FONT.ui}" font-size="30" fill="${C.ink45}">${esc(opts.caption)}</text>`
          : "",
        /* THE HOUSE MOVE: where the numbers came from, on screen. */
        receipt
          ? `<text x="${PAD.left}" y="${H - 48}" font-family="${FONT.mono}" font-size="26" fill="${C.ink45}">${esc(receipt)}</text>`
          : "",
      ].join(""),
    ),
    refused,
  };
}

/**
 * A QUOTE CARD — "a quote's words lift from the page into kinetic type".
 *
 * The other half of the code-first path, and the one that exists because a
 * diffusion model cannot draw a word. The words are set as type from our own
 * tokens, so what is on screen is exactly what was said: there is no step
 * here that could paraphrase it.
 */
export function quoteCard(q: { quote: string; said?: string | null; source?: string | null }): Rendered {
  const words = q.quote.trim();
  /* An empty card is a refusal rather than a blank frame in somebody's cut.
     Reported as a lint so the caller has one shape to handle. */
  if (!words) {
    return { svg: null, refused: [{ kind: "provenance", reason: "there is no quote to set" }] };
  }

  /*
   * WRAPPED BY CHARACTER COUNT, AND THE CEILING IS MEASURED.
   *
   * There is no font metric available here — this runs in a Worker — so the
   * wrap counts characters, and the only honest way to choose the number is
   * to rasterise and look. It was 42, chosen as "about right for a 44px
   * line", and measured in Chromium a 42-character line at 72px reached
   * 1739px in DejaVu Sans against a 1920 frame: inside it, and outside the
   * 160px right margin the rest of the picture keeps.
   *
   * THE FONT IS THE REASON THIS MATTERS. The two the design names are not in
   * the render container, so the text is laid out by whatever fontconfig
   * falls back to — and a quote whose last word runs off the frame is a
   * quote the picture did not carry, which is the one thing this picture
   * exists to do.
   *
   * 36 leaves room for a wider fallback than any measured here.
   * scripts/check-graphics.cjs rasterises across several and fails on any
   * overflow, so the number has a measurement behind it rather than an
   * adjective.
   */
  const lines: string[] = [];
  let line = "";
  for (const w of words.split(/\s+/)) {
    if (line && `${line} ${w}`.length > WRAP_CHARS) {
      lines.push(line);
      line = w;
    } else {
      line = line ? `${line} ${w}` : w;
    }
  }
  if (line) lines.push(line);

  const size = lines.length > 6 ? 54 : 72;
  const start = H / 2 - ((lines.length - 1) * size * 1.35) / 2 - 40;

  const body = lines
    .map(
      (l, i) =>
        `<text x="${PAD.left}" y="${(start + i * size * 1.35).toFixed(1)}" font-family="${FONT.ui}" font-size="${size}" font-weight="500" fill="${C.ink}">${esc(l)}</text>`,
    )
    .join("");

  const attribution = [q.said, q.source].filter(Boolean).join(" · ");

  return {
    svg: frame(
      `<rect x="${PAD.left - 44}" y="${(start - size).toFixed(1)}" width="8" height="${(lines.length * size * 1.35).toFixed(1)}" fill="${ACCENT.gold}" rx="4"/>` +
        body +
        (attribution
          ? `<text x="${PAD.left}" y="${H - 96}" font-family="${FONT.mono}" font-size="30" fill="${C.ink45}">${esc(attribution)}</text>`
          : ""),
    ),
    refused: [],
  };
}

/**
 * The frame every generated picture shares.
 *
 * AND THE LABEL IS PART OF IT, not something a caller may forget. Invariant
 * 8 says generated is "never photoreal and never over a claim or its proof",
 * and doc 09 adds that an export carries the label without user action. A
 * label drawn here cannot be left off by the one code path that builds these
 * pictures. Violet because that accent means exactly this — "generated /
 * made for you" — in 02-DESIGN-SYSTEM.md.
 */
function frame(inner: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
    `<rect width="${W}" height="${H}" fill="${C.canvas}"/>` +
    inner +
    /*
     * NAMED, like the bars, so a check can tell the picture's CONTENT from
     * its furniture. The badge sits in the corner on purpose and reaches
     * nearer the edge than any body text is allowed to — measured against a
     * body-text margin it failed ten rasterisations, all of them for the
     * same reason and none of them a bug.
     */
    `<rect class="label" x="${W - 260}" y="64" width="${196}" height="52" rx="26" fill="${ACCENT.violet}" fill-opacity="0.18"/>` +
    `<text class="label" x="${W - 162}" y="98" text-anchor="middle" font-family="${FONT.mono}" font-size="26" fill="${ACCENT.violet}">${esc(KIND_LABEL.synthetic)}</text>` +
    `</svg>`
  );
}

/**
 * NO PIXEL EVER GOT IN HERE, checked rather than assumed.
 *
 * "Generated is never photoreal" is a rule somebody could break everywhere
 * else in this product. In an SVG there are exactly three ways a photograph
 * could arrive — an `<image>`, a `data:` URI, or a filter fetching one — and
 * this says none of them did. Exported so the render path can assert it on
 * the way out, and so the claim is a measurement rather than a comment.
 */
export function hasNoRaster(svg: string): boolean {
  return !/<image\b/i.test(svg) && !/data:image\//i.test(svg) && !/xlink:href|href\s*=\s*"[^"]*\.(png|jpe?g|webp|gif)/i.test(svg);
}
