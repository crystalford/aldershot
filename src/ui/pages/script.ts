/**
 * Script — the transcript as editable text. Descript-style.
 *
 * "Strike out words and the video loses them. Nothing here is permanent until
 * you render." Struck text renders struck through rather than disappearing, so
 * the cut stays legible and putting something back is one click
 * (01-PRODUCT.md §Editor).
 *
 * Clicking a word strikes that word; clicking the timecode strikes the whole
 * line. Both go through the same undo-wrapped handler as everything else.
 */

import { C, ACCENT, FONT, RADIUS, SIZE } from "../tokens.ts";
import { esc } from "../shell.ts";
import { hms, tc } from "./footage.ts";
import { isSegmentCut, isWordCut, parseWords, type Cut } from "../../cuts.ts";

export interface ScriptSegment {
  idx: number;
  start_ms: number;
  end_ms: number;
  speaker: string | null;
  text: string;
  words: string | null;
}

export interface ScriptData {
  projectId: string;
  segments: ScriptSegment[];
  cuts: Cut[];
  /** Runtime of the original and of what survives, in seconds. */
  originalS: number;
  afterS: number;
  fillersRemoved: boolean;
  pausesTightened: boolean;
  /** Real frame to show in the sticky player beside the words. */
  posterKey: string | null;
}

/**
 * One line. The whole line is clickable via its timecode; individual words are
 * clickable on their own. Word indices ride on the markup so the client does
 * not have to re-tokenise and risk disagreeing with the server about which
 * word is which — that disagreement would cut the wrong video.
 */
function line(s: ScriptSegment, cuts: Cut[]): string {
  const lineCut = isSegmentCut(cuts, s.idx);
  const words = parseWords(s.words);

  // No word timings: the line is still strikeable as a whole, just not by word.
  const body = words.length
    ? words
        .map((w, i) => {
          const cut = lineCut || isWordCut(cuts, s.idx, i);
          return `<span class="w" data-content data-seg="${s.idx}" data-word="${i}" style="cursor:pointer;${
            cut ? `color:rgba(236,236,241,0.3);text-decoration:line-through;` : ""
          }">${esc(w.w)}</span>`;
        })
        .join(" ")
    : `<span style="${lineCut ? "color:rgba(236,236,241,0.3);text-decoration:line-through;" : ""}">${esc(s.text)}</span>`;

  return `<div class="seg-row" data-seg="${s.idx}" style="display:flex;gap:14px;padding:11px 14px;border-radius:8px;background:${
    lineCut ? "transparent" : C.surface
  };margin-bottom:3px">
    <button class="seg-cut" data-seg="${s.idx}" title="Cut this line" style="flex:none;width:44px;padding-top:3px;background:none;border:none;text-align:left;cursor:pointer;font-size:${SIZE.meta};font-family:${FONT.mono};color:rgba(236,236,241,0.3)">${tc(s.start_ms / 1000)}</button>
    <div style="flex:1;min-width:0">
      ${s.speaker ? `<div data-content style="font-size:${SIZE.meta};color:${C.ink45};margin-bottom:3px">${esc(s.speaker)}</div>` : ""}
      <div data-content style="line-height:1.6;font-size:${SIZE.body};color:${C.ink}">${body}</div>
    </div>
  </div>`;
}

function stat(label: string, value: string, opts: { accent?: boolean; id?: string } = {}): string {
  return `<div>
    <div style="font-size:${SIZE.meta};color:${C.ink45}">${esc(label)}</div>
    <div data-content ${opts.id ? `data-${opts.id}` : ""} style="font-size:${SIZE.body};font-weight:600;font-family:${FONT.mono};margin-top:2px;${opts.accent ? `color:${ACCENT.gold};` : ""}">${esc(value)}</div>
  </div>`;
}

/**
 * Script's own clean-up chips. Note the labels are SHORTER than Pick's for the
 * same operations — "Remove “um” and “uh”" here against "Remove the ums and
 * uhs" there. Both are the prototype's; they are not interchangeable.
 */
function chip(kind: string, label: string, done: boolean): string {
  return `<button class="cleanup" data-kind="${esc(kind)}" ${done ? "disabled" : ""} style="font-size:${SIZE.secondary};font-weight:500;padding:6px 13px;border-radius:${RADIUS.button};background:${done ? "transparent" : C.pill};color:${done ? ACCENT.gold : C.ink70};border:none;cursor:${done ? "default" : "pointer"};white-space:nowrap;font-family:${FONT.ui}">${esc(label)}</button>`;
}

export function renderScript(d: ScriptData): string {
  const removed = d.cuts.length;

  const player = `<div style="border-radius:${RADIUS.card};overflow:hidden;background:#0B0B0E;position:relative;aspect-ratio:16/9">
    ${d.posterKey ? `<img src="/media/${esc(d.posterKey)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block"/>` : ""}
  </div>
  <div style="display:flex;gap:26px;margin-top:14px;flex-wrap:wrap">
    ${stat("Original", hms(d.originalS))}
    ${stat("After your cuts", hms(d.afterS), { accent: true, id: "after" })}
    ${stat("Lines removed", String(removed))}
  </div>`;

  return `<div style="margin-top:18px">
    <div style="font-size:24px;font-weight:600;letter-spacing:-0.02em">Trim it by text</div>
    <div style="font-size:${SIZE.secondary};color:${C.ink45};margin-top:4px;max-width:52ch">Strike out words and the video loses them. Nothing here is permanent until you render.</div>
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
      ${chip("fillers", d.fillersRemoved ? "Fillers removed ✓" : "Remove “um” and “uh”", d.fillersRemoved)}
      ${chip("pauses", d.pausesTightened ? "Gaps tightened ✓" : "Tighten silences", d.pausesTightened)}
    </div>
  </div>
  <div style="margin-top:24px;display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap">
    <div style="flex:1 1 320px;min-width:min(320px,100%);max-width:min(400px,100%);position:sticky;top:88px">${player}</div>
    <div id="script" data-project="${esc(d.projectId)}" style="flex:1 1 420px;min-width:min(320px,100%)">
      ${d.segments.map((s) => line(s, d.cuts)).join("")}
    </div>
  </div>`;
}
