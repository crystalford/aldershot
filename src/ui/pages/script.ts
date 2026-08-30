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

import { C, ACCENT, FONT, RADIUS, SIZE } from "../tokens";
import { esc } from "../shell";
import { hms } from "./footage";
import { isSegmentCut, isWordCut, parseWords, type Cut } from "../../cuts";

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
          return `<span class="w" data-seg="${s.idx}" data-word="${i}" style="cursor:pointer;${
            cut ? `color:rgba(236,236,241,0.3);text-decoration:line-through;` : ""
          }">${esc(w.w)}</span>`;
        })
        .join(" ")
    : `<span style="${lineCut ? "color:rgba(236,236,241,0.3);text-decoration:line-through;" : ""}">${esc(s.text)}</span>`;

  return `<div class="seg-row" data-seg="${s.idx}" style="display:flex;gap:14px;padding:11px 14px;border-radius:8px;background:${
    lineCut ? "transparent" : C.surface
  };margin-bottom:3px">
    <button class="seg-cut" data-seg="${s.idx}" title="Cut this line" style="flex:none;width:44px;padding-top:3px;background:none;border:none;text-align:left;cursor:pointer;font-size:${SIZE.meta};font-family:${FONT.mono};color:rgba(236,236,241,0.3)">${hms(s.start_ms / 1000)}</button>
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

export function renderScript(d: ScriptData): string {
  const removed = d.cuts.length;

  return `<div style="margin-top:18px;padding:14px 16px;border-radius:${RADIUS.card};background:${C.surface}">
    <div style="font-size:${SIZE.body};font-weight:600">Trim it by text</div>
    <div style="font-size:${SIZE.secondary};color:${C.ink45};margin-top:4px">Strike out words and the video loses them. Nothing here is permanent until you render.</div>
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
      <button class="cleanup" data-kind="fillers" ${d.fillersRemoved ? "disabled" : ""} style="font-size:${SIZE.secondary};font-weight:500;padding:6px 13px;border-radius:${RADIUS.button};background:${d.fillersRemoved ? "transparent" : C.pill};color:${d.fillersRemoved ? ACCENT.green : C.ink70};border:none;cursor:${d.fillersRemoved ? "default" : "pointer"};white-space:nowrap;font-family:${FONT.ui}">${d.fillersRemoved ? "Fillers removed ✓" : "Remove “um” and “uh”"}</button>
    </div>
    <div style="display:flex;gap:26px;margin-top:14px;flex-wrap:wrap">
      ${stat("Original", hms(d.originalS))}
      ${stat("After your cuts", hms(d.afterS), { accent: true, id: "after" })}
      ${stat("Lines removed", String(removed))}
    </div>
  </div>
  <div id="script" data-project="${esc(d.projectId)}" style="margin-top:16px">
    ${d.segments.map((s) => line(s, d.cuts)).join("")}
  </div>`;
}
