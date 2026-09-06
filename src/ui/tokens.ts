/**
 * Design tokens — lifted verbatim from design/Aldershot.dc.html and cross-checked
 * against design/docs/02-DESIGN-SYSTEM.md.
 *
 * These are COPIED VALUES, not a derived palette. The previous build of this
 * product failed review because dozens of small substitutions (a rounded font
 * size, a near-miss grey, a library's icon set) accumulated into a different
 * product. See design/docs/PROMPTING-NOTES.md.
 *
 * Rule: if a hex code or px value appears in the built app, it must be
 * greppable back to the prototype. scripts/check-tokens.sh enforces that no
 * raw hex escapes into a page module without coming through here.
 */

/** Surface colours. */
export const C = {
  canvas: "#101013",
  surface: "#17171B",
  raised: "#1A1A1F",
  pill: "#232329",
  active: "#2E2E36",
  ink: "#ECECF1",
  /** Ink at reduced alpha. The prototype uses these exact three steps. */
  ink70: "rgba(236,236,241,0.7)",
  ink45: "rgba(236,236,241,0.45)",
  ink32: "rgba(236,236,241,0.32)",
  hairline: "rgba(255,255,255,0.06)",
} as const;

/**
 * Accents. Each means exactly one thing and is never decorative
 * (02-DESIGN-SYSTEM.md). Used for the composition bar, stage pills, and the
 * wordmark's lead bar.
 */
export const ACCENT = {
  /** your voice, progress, attention */
  gold: "#D9B36A",
  /** clips, kept, success */
  green: "#5EC98F",
  /** another source, info */
  cyan: "#5EB8C9",
  /** generated / made for you */
  violet: "#B08CD4",
  /** record, error, destructive */
  red: "#E06A6A",
} as const;

export type AccentName = keyof typeof ACCENT;

/** Accent backgrounds are always the accent at 0.14 alpha with the accent as text. */
export function accentBg(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},0.14)`;
}

/**
 * The wordmark's lead-bar colour per surface, and therefore the only
 * per-surface theming in the product. Copied from the prototype's `markLead`
 * map (Aldershot.dc.html) — note `cut` and `projects` share green, `home` and
 * `essay` share gold.
 */
export const MARK_LEAD: Record<string, string> = {
  home: ACCENT.gold,
  projects: ACCENT.green,
  cut: ACCENT.green,
  essay: ACCENT.gold,
  shorts: ACCENT.red,
  archive: ACCENT.cyan,
  settings: C.ink,
};
export const MARK_LEAD_DEFAULT = ACCENT.gold;

/** Radii. Tight — fully round pill buttons were explicitly rejected. */
export const RADIUS = {
  pill: "5px",
  button: "5px",
  input: "7px",
  card: "9px",
  composer: "12px",
} as const;

/** Type. No italics, no serif, anywhere. */
export const FONT = {
  ui: "'Instrument Sans',sans-serif",
  mono: "'IBM Plex Mono',monospace",
} as const;

/** The sizes actually used in the design. Do not round these. */
export const SIZE = {
  pageTitle: "24px",
  wordmark: "15.5px",
  body: "13.5px",
  secondary: "12.5px",
  meta: "11px",
  pill: "10.5px",
} as const;

/**
 * The 960px width law. Every surface, no exceptions — this was fixed after
 * pages drifted to different widths in the previous build.
 */
export const LAYOUT = {
  width: "min(960px,100%)",
  gutter: "clamp(24px,5vw,40px)",
  pagePad: "40px 0 96px",
} as const;
