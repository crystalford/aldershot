/**
 * Selecting several things at once.
 *
 * Clearing four accidental edits meant opening four menus. Every list in the
 * product could only ever act on one row, which is fine until the day the
 * product has made a mess and the person clearing it up has to click through
 * it one item at a time.
 *
 * The checkbox and the bar are separate: the box rides on each card, the bar
 * is one element per page that appears when anything is ticked. Both are
 * markup only — src/ui/client.ts owns the counting.
 */

import { C, FONT, RADIUS, SIZE } from "./tokens.ts";
import { esc } from "./shell.ts";

/** The box on one card. `kind` is the API segment: projects | sources. */
export function selectBox(kind: string, id: string): string {
  return `<label class="sel-box" style="position:absolute;left:6px;top:6px;z-index:6;display:grid;place-items:center;width:22px;height:22px;border-radius:6px;background:rgba(11,11,14,0.66);cursor:pointer">
    <input type="checkbox" class="sel-item" data-kind="${esc(kind)}" data-id="${esc(id)}" style="width:14px;height:14px;accent-color:${C.ink};cursor:pointer"/>
  </label>`;
}

/**
 * The bar. Hidden until something is selected.
 *
 * Deliberately fixed to the bottom rather than pushed into the layout: a bar
 * that appears in the flow shifts every card down the moment you tick one,
 * which moves the next thing you were about to click.
 */
export function selectBar(noun: string): string {
  return `<div id="sel-bar" data-noun="${esc(noun)}" hidden style="position:fixed;left:50%;transform:translateX(-50%);bottom:22px;z-index:55;display:flex;align-items:center;gap:14px;padding:11px 16px;border-radius:${RADIUS.card};background:#1A1A1F;box-shadow:0 0 0 1px rgba(255,255,255,0.07), 0 14px 44px rgba(0,0,0,0.45)">
    <span id="sel-count" data-content style="font-size:${SIZE.secondary};color:${C.ink};white-space:nowrap"></span>
    <button id="sel-clear" style="font-size:${SIZE.secondary};background:none;border:none;color:${C.ink45};cursor:pointer;font-family:${FONT.ui};white-space:nowrap">Cancel</button>
    <button id="sel-delete" style="font-size:${SIZE.secondary};font-weight:600;padding:7px 14px;border-radius:${RADIUS.button};background:${C.ink};color:#131316;border:none;cursor:pointer;font-family:${FONT.ui};white-space:nowrap">Delete</button>
  </div>`;
}
