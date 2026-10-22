/**
 * THE PROJECT SWITCHER — the caret beside the title.
 *
 * One Take's second row opens with the title and a small triangle, and
 * pressing it drops a list of projects with the open one marked. The build
 * rendered the title as plain text, so the only way between projects was to
 * leave the editor, land in the room, open the Projects tab and pick one —
 * four moves for the thing the design does in two.
 *
 * It is the same control in both states, which is the point of it: in the
 * room it reads "Your footage", in a project it reads the project's name,
 * and the list is the same list either way.
 *
 * ROWS ARE LINKS. Navigation that works without JavaScript, and a middle
 * click opens a project in a new tab the way a person expects. The client
 * only opens and closes the panel.
 */

import { C, FONT, RADIUS, SIZE, ACCENT } from "./tokens.ts";
import { esc } from "./shell.ts";

export interface SwitchItem {
  id: string;
  title: string;
  /** Null until a cut has been assembled; the meta line then omits it. */
  runtime_s: number | null;
  poster_r2_key: string | null;
  updated_at: number;
}

/** m:ss, the one format this product shows a runtime in. */
const clock = (secs: number): string =>
  `${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, "0")}`;

/**
 * When it was last touched, in the feed's own words.
 *
 * "just now" rather than "0m", because a person who edited something ten
 * seconds ago does not think of it as having an age.
 */
export function edited(at: number, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - at) / 60000));
  if (mins < 1) return "edited just now";
  if (mins < 60) return `edited ${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `edited ${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `edited ${days}d ago`;
}

/**
 * The line under a project's name.
 *
 * Only what is stored: how long the cut runs, and when it was last touched.
 * The prototype's reads "5:59 · 4 rules · edited just now" and the rule
 * count is deliberately not here — it is one query per project on a list
 * rendered on every page, and a number that costs that much to be exact
 * about is better left out than estimated.
 */
export function meta(item: SwitchItem, now = Date.now()): string {
  const bits: string[] = [];
  if (item.runtime_s) bits.push(clock(item.runtime_s));
  bits.push(edited(item.updated_at, now));
  return bits.join(" · ");
}

const FRAME = (key: string | null): string =>
  key
    ? `background-image:url(/media/${esc(key)});background-size:cover;background-position:center`
    : `background:#07070a;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.06)`;

/**
 * @param label  What the trigger says — a project's name, or "Your footage".
 * @param items  Every project, newest first.
 * @param openId The project being edited, or null in the room.
 */
export function switcher(label: string, items: SwitchItem[], openId: string | null): string {
  const rows = items
    .map((it) => {
      const here = it.id === openId;
      return `<a class="switch-row" href="/p/${esc(it.id)}/cut" style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:7px;background:${here ? C.raised : "transparent"};text-decoration:none;color:inherit">
      <span style="flex:none;width:44px;aspect-ratio:16/9;border-radius:3px;${FRAME(it.poster_r2_key)}"></span>
      <span style="flex:1;min-width:0">
        <span data-content style="display:block;font-size:${SIZE.secondary};font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(it.title)}</span>
        <span data-content style="display:block;margin-top:1px;font-size:${SIZE.pill};font-family:${FONT.mono};color:${C.ink45};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(meta(it))}</span>
      </span>
      <span style="flex:none;font-size:${SIZE.meta};color:${ACCENT.green}">${here ? "open" : ""}</span>
    </a>`;
    })
    .join("");

  /*
   * ONE WAY BACK, NOT TWO.
   *
   * The prototype's panel ends with "+ New project" AND "Your footage — no
   * project open", because in it they do different things: the first also
   * clears the attached footage and the composer. Here the room holds its
   * selection in the URL, so going to / IS both of them — and two controls
   * that do exactly the same thing is the failure this codebase has already
   * shipped once, as six MAKE cards linking to a query nobody read.
   */
  return `<span style="position:relative;display:inline-flex;align-items:baseline;gap:6px;min-width:0">
    <span id="switcher" role="button" tabindex="0" title="Switch project" style="display:inline-flex;align-items:baseline;gap:6px;min-width:0;cursor:pointer;padding:3px 7px;margin:-3px -7px;border-radius:${RADIUS.button}">
      <span data-content style="min-width:0;overflow:hidden;text-overflow:ellipsis;font-size:${SIZE.body};font-weight:600;white-space:nowrap">${esc(label)}</span>
      <span style="flex:none;font-size:9px;color:rgba(236,236,241,0.5);transform:translateY(-1px)">&#9662;</span>
    </span>
    <div id="switcherPanel" hidden style="position:absolute;top:28px;left:-7px;z-index:41;width:min(340px,calc(100vw - 36px));padding:6px;border-radius:${RADIUS.composer};background:#16161B;box-shadow:0 18px 50px rgba(0,0,0,0.6),inset 0 0 0 1px rgba(255,255,255,0.09)">
      <div style="padding:8px 10px 6px;font-size:${SIZE.pill};font-weight:600;letter-spacing:.09em;color:${C.ink45}">PROJECTS</div>
      ${rows || `<div style="padding:4px 10px 8px;font-size:${SIZE.secondary};color:${C.ink45}">Nothing on the go</div>`}
      <div style="height:1px;margin:6px 4px;background:rgba(255,255,255,0.07)"></div>
      <a class="switch-room" href="/" style="display:flex;justify-content:space-between;gap:10px;padding:8px 10px;border-radius:7px;font-size:${SIZE.secondary};color:${C.ink70};text-decoration:none">
        <span>Your footage — no project open</span>
        <span style="color:${ACCENT.green}">${openId ? "" : "open"}</span>
      </a>
    </div>
  </span>`;
}
