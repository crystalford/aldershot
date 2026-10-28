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

import { C, FONT, RADIUS, SIZE, ACCENT, accentBg } from "./tokens.ts";
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

/**
 * THE SOURCE CHIPS — a lettered square per video the cut is made of.
 *
 * One Take puts them in the title row, right of the name: A, B, C, each
 * coloured, each carrying the video's name and length in its title. They
 * are how a person follows "which video is this line from" down a page of
 * blocks without reading a filename on every one.
 *
 * POSITIONAL, NOT INITIALS. The prototype's keys are A/B/C in the order the
 * cut uses them, and that is better than a first letter: two videos called
 * "Tuesday" would both read T, and the letter is meant to tell them apart.
 *
 * The colours are the accents in the prototype's own order for A, B and C —
 * cyan, green, violet — then the two it does not get to. Past five it
 * starts again, which is the honest limit of a one-letter label.
 */
export const CHIP_COLOURS = [ACCENT.cyan, ACCENT.green, ACCENT.violet, ACCENT.gold, ACCENT.red] as const;

/** A, B, C … and AA after Z, because a cut of 27 videos is not impossible. */
export function letterFor(i: number): string {
  let n = i;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

export interface ChipSource {
  id: string;
  title: string;
  duration_s: number | null;
}

/** "Tuesday · kitchen · 41:06", or just the name when the length is unknown. */
export function chipTitle(s: ChipSource): string {
  return s.duration_s ? `${s.title} · ${clock(s.duration_s)}` : s.title;
}

export function sourceChips(sources: ChipSource[]): string {
  if (!sources.length) return "";
  return `<span style="flex:none;display:flex;align-items:center;gap:5px">${sources
    .map((s, i) => {
      const colour = CHIP_COLOURS[i % CHIP_COLOURS.length];
      return `<a href="/sources/${esc(s.id)}" title="${esc(chipTitle(s))}" style="flex:none;width:20px;height:20px;border-radius:5px;background:${accentBg(colour)};color:${colour};font-size:${SIZE.pill};font-weight:600;font-family:${FONT.mono};display:flex;align-items:center;justify-content:center;text-decoration:none">${letterFor(i)}</a>`;
    })
    .join("")}</span>`;
}


/**
 * THE STRIP UNDER THE PLAYER — the shape of the cut, in one line.
 *
 * One Take draws a segment per block, its width the block's duration and
 * its colour the video it came from, and pressing one goes there. It is the
 * only place in the product where you can see the SHAPE of a cut — that it
 * opens with ninety seconds of one video and then alternates, or that one
 * block is twice as long as everything around it.
 *
 * THE SAME COLOURS AS THE CHIPS, in the same order, which is the whole
 * point of it: the third segment being green and the chip for video B being
 * green is how you read it without a legend. Both index into the same
 * ordered list of sources.
 *
 * A voice beat is gold and has no source, because it is not footage yet —
 * it is a space you have left for yourself.
 */
export interface StripBlock {
  id: string;
  /** Milliseconds. A zero-length block is not drawn: it has no width to be. */
  ms: number;
  /** The source it came from, or null for a recording or a gap. */
  sourceId: string | null;
  struck: boolean;
  label: string;
}

export function blockStrip(blocks: StripBlock[], sources: ChipSource[]): string {
  const live = blocks.filter((b) => b.ms > 0);
  if (live.length < 2) return "";
  const order = new Map(sources.map((s, i) => [s.id, i]));
  const segs = live
    .map((b) => {
      const i = b.sourceId === null ? -1 : order.get(b.sourceId) ?? -1;
      const colour = i < 0 ? ACCENT.gold : CHIP_COLOURS[i % CHIP_COLOURS.length];
      /* A struck block is still drawn — nothing vanishes — but quietly, so
         the shape you see is the shape that renders. */
      return `<button class="strip-seg" data-block="${esc(b.id)}" title="${esc(b.label)}"
        style="flex:${Math.max(1, Math.round(b.ms / 100))};height:100%;border:none;padding:0;border-radius:99px;cursor:pointer;background:${colour};opacity:${
          b.struck ? "0.18" : "0.62"
        }"></button>`;
    })
    .join("");
  return `<div class="strip" style="margin-top:8px;display:flex;gap:2px;height:5px">${segs}</div>`;
}

/**
 * The keys, where the prototype puts them: under the player, quiet, in mono.
 *
 * They are in the shortcut sheet too, which is a thing you have to know to
 * open. One line under the control they belong to is how somebody finds out
 * the arrows move a block without going looking.
 */
export function keyHints(): string {
  /* THE PROTOTYPE'S OWN CHARACTERS, not their entities. It read "space play
     &middot; &larr;..." and the strings check flagged it, correctly: the
     prototype has the literal glyphs, so the entity version is a different
     string that happens to render the same. Verbatim means verbatim. */
  return `<div style="margin-top:14px;font-size:${SIZE.pill};line-height:1.7;font-family:${FONT.mono};color:${C.ink32}">space play · ← → block · x cut · ⌘z undo</div>`;
}
