/**
 * The complete icon set — eight icons, copied verbatim from
 * docs/archive/handoff-v2/09-ICONS.md, which in turn transcribes the inline SVGs in
 * design/Aldershot.dc.html.
 *
 * THERE IS NO ICON LIBRARY AND THERE MUST NOT BE ONE. The previous build
 * substituted a library's lookalikes and the whole product read differently
 * (see docs/archive/handoff-v2/PROMPTING-NOTES.md). Geometry never varies; only width,
 * height, stroke, and fill do.
 *
 * If a feature seems to need a ninth icon, it doesn't — this design draws with
 * type or a coloured dot instead. Check the prototype before inventing one.
 */

const VB = 'viewBox="0 0 24 24"';

/**
 * Stroke width does NOT scale proportionally: thinner renderings get a heavier
 * stroke so optical weight stays constant (09-ICONS.md "Rules").
 *
 * These are the prototype's measured values, not a curve fitted to them. An
 * earlier version returned a single 2.3 for everything at or below 11px, which
 * is inside the doc's stated 2.2-2.4 band and still wrong in both directions:
 * every 10px icon rendered too light and every 11px icon too heavy. The
 * geometry check never caught it because it only compares path data.
 */
function strokeWidthFor(px: number): string {
  if (px <= 10) return "2.4";
  if (px === 11) return "2.2";
  return "2";
}

interface StrokeOpts {
  size?: number;
  stroke?: string;
}

function stroke(body: string, { size = 14, stroke: color = "currentColor" }: StrokeOpts = {}): string {
  return `<svg width="${size}" height="${size}" ${VB} fill="none" stroke="${color}" stroke-width="${strokeWidthFor(size)}">${body}</svg>`;
}

function filled(body: string, size: number, fill: string): string {
  return `<svg width="${size}" height="${size}" ${VB} fill="${fill}">${body}</svg>`;
}

/** Nav search field, Footage search, Clipping ask. Rendered at 14, 15px. */
export const iconSearch = (o?: StrokeOpts) =>
  stroke('<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/>', o);

/*
 * iconBell was here, and is gone with the bar it lived in.
 *
 * "Nav only" was the whole of its comment and the whole of its use. One
 * Take's bar is the wordmark and the avatar — no bell, no search chip, no
 * question mark — so the shape had nowhere left to be drawn. The gate found
 * it: an export nothing references.
 */

/** Seam inserts between beats, "add" buttons. Rendered at 13, 15px. */
export const iconPlus = (o?: StrokeOpts) => stroke('<path d="M12 5v14M5 12h14"/>', o);

/** Move a block earlier. Rendered at 10, 11px. */
export const iconArrowUp = (o?: StrokeOpts) => stroke('<path d="M12 19V5M5 12l7-7 7 7"/>', o);

/** Move a block later. Rendered at 10, 11px. */
export const iconArrowDown = (o?: StrokeOpts) => stroke('<path d="M12 5v14M5 12l7 7 7-7"/>', o);

/**
 * Play/pause are FILL icons, not stroke: `#131316` on light buttons, `#fff` on
 * dark overlays. No stroke (09-ICONS.md "Rules").
 */
export const iconPlay = (size = 14, fill = "#fff") => filled('<path d="M8 5l11 7-11 7z"/>', size, fill);
export const iconPause = (size = 14, fill = "#fff") =>
  filled('<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>', size, fill);

