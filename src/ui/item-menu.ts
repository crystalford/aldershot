/**
 * The "…" on an item: Rename, Delete.
 *
 * One component rather than three near-copies, because a user who learns the
 * gesture on Projects should find the same gesture on Footage and in the
 * editor. It renders markup only; src/ui/client.ts binds it once for every
 * instance on the page.
 *
 * Deliberately not a confirm dialog. A delete here is reversible and says so —
 * the toast that follows carries Undo — and a modal asking "are you sure"
 * about something that is trivially undoable trains people to click through
 * modals without reading them.
 */

import { C, FONT, RADIUS, SIZE } from "./tokens.ts";
import { esc } from "./shell.ts";

export type ItemKind = "projects" | "sources";

/**
 * `title` is what the rename box starts with, and `noun` is what the delete
 * toast calls the thing — "edit" or "video" — so the message reads like a
 * sentence rather than naming a table.
 */
export function itemMenu(kind: ItemKind, id: string, title: string, noun: string): string {
  return `<div class="item-menu" data-kind="${esc(kind)}" data-id="${esc(id)}" data-title="${esc(title)}" data-noun="${esc(noun)}" style="position:relative;flex:none">
    <button class="item-menu-open" aria-label="More" style="width:26px;height:26px;display:grid;place-items:center;border-radius:${RADIUS.button};background:transparent;border:none;color:${C.ink45};cursor:pointer;font-size:15px;line-height:1;font-family:${FONT.ui}">…</button>
    <div class="item-menu-pop" hidden style="position:absolute;right:0;top:30px;z-index:20;min-width:132px;padding:4px;border-radius:${RADIUS.card};background:#141418;box-shadow:0 14px 34px rgba(0,0,0,.5), inset 0 0 0 1px rgba(255,255,255,0.08)">
      <button class="item-rename" style="display:block;width:100%;text-align:left;padding:7px 10px;border-radius:6px;background:none;border:none;color:${C.ink};font-size:${SIZE.secondary};cursor:pointer;font-family:${FONT.ui}">Rename</button>
      ${
        /* Only an edit can be copied. A video has nothing to branch — the
           thing you vary is the cut, not the footage. */
        kind === "projects"
          ? `<button class="item-duplicate" style="display:block;width:100%;text-align:left;padding:7px 10px;border-radius:6px;background:none;border:none;color:${C.ink};font-size:${SIZE.secondary};cursor:pointer;font-family:${FONT.ui}">Duplicate</button>`
          : ""
      }
      <button class="item-delete" style="display:block;width:100%;text-align:left;padding:7px 10px;border-radius:6px;background:none;border:none;color:${C.ink};font-size:${SIZE.secondary};cursor:pointer;font-family:${FONT.ui}">Delete</button>
    </div>
  </div>`;
}
