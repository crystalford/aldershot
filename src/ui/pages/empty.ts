/**
 * Empty states for the surfaces that Phase 0 routes but does not yet fill.
 *
 * Every string here is copied from design/Aldershot.dc.html's own empty
 * states — these are real designed states, not placeholders, and they must
 * survive into the finished product unchanged. A surface with no data still
 * has to look finished (01-PRODUCT.md "States that must exist in the build").
 */

import { C, RADIUS, SIZE } from "../tokens.ts";
import { esc } from "../shell.ts";

/**
 * The standard empty block: one plain-spoken line saying what will fill it.
 * No illustrations, no icons — this design draws with type.
 *
 * Deliberately takes a SINGLE string. An earlier version took a title and a
 * body, which invited writing a second line that the prototype does not have;
 * the fidelity check caught five invented strings that way.
 */
export function emptyState(line: string): string {
  return `<div style="margin-top:24px;padding:20px 18px;border-radius:${RADIUS.card};background:${C.surface}">
    <div style="font-size:${SIZE.body};color:${C.ink45};line-height:1.55">${esc(line)}</div>
  </div>`;
}

export function pageHeading(title: string, sub?: string): string {
  return `<div style="font-size:${SIZE.pageTitle};font-weight:600;letter-spacing:-0.022em;line-height:1.2">${esc(title)}</div>${
    sub ? `<div style="font-size:${SIZE.body};color:rgba(236,236,241,0.42);margin-top:8px">${esc(sub)}</div>` : ""
  }`;
}
