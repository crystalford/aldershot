/**
 * Build — the arranged piece as blocks.
 *
 * "Clips, your voice, reactions, generated visuals. `+` seams between blocks
 * insert a reaction, a voice line, or a clip from another video. Beats needing
 * your voice show Record and Generate it" (01-PRODUCT.md §Editor).
 *
 * Still no timeline: a beat is a block with text on it, and reordering is
 * moving a block. The seam is how anything gets in between.
 */

import { C, ACCENT, FONT, RADIUS, SIZE, accentBg } from "../tokens.ts";
import { iconArrowDown, iconArrowUp, iconPlus } from "../icons.ts";
import { esc } from "../shell.ts";
import { hms } from "./footage.ts";

export type BeatKind = "clip" | "vo" | "react" | "generated" | "stock";

export interface BuildBeat {
  id: string;
  idx: number;
  kind: BeatKind;
  text: string | null;
  dur_ms: number | null;
  media_r2_key: string | null;
  /** From the beat's clip, when it has one. */
  start_ms: number | null;
  frame_r2_key: string | null;
}

export interface BuildData {
  projectId: string;
  beats: BuildBeat[];
  runtimeS: number;
}

/**
 * Each beat kind means one thing, and the accent says which — gold for your
 * voice, green for clips, violet for generated, cyan for another source
 * (02-DESIGN-SYSTEM.md §Colour). Never decorative.
 */
const KIND: Record<BeatKind, { label: string; accent: string }> = {
  clip: { label: "Clip", accent: ACCENT.green },
  vo: { label: "Your voice", accent: ACCENT.gold },
  react: { label: "Reaction", accent: ACCENT.gold },
  generated: { label: "Generated", accent: ACCENT.violet },
  stock: { label: "Stock", accent: ACCENT.cyan },
};

function seam(projectId: string, atIdx: number): string {
  return `<div style="display:flex;justify-content:center;padding:2px 0">
    <button class="seam" data-project="${esc(projectId)}" data-at="${atIdx}" title="Insert here" style="width:22px;height:22px;border-radius:50%;background:${C.surface};display:flex;align-items:center;justify-content:center;color:${C.ink45};cursor:pointer;border:none;padding:0">${iconPlus({ size: 13 })}</button>
  </div>`;
}

function beatBlock(b: BuildBeat, i: number, total: number): string {
  const kind = KIND[b.kind];
  const needsVoice = (b.kind === "vo" || b.kind === "react") && !b.media_r2_key;
  const recorded = (b.kind === "vo" || b.kind === "react") && b.media_r2_key;

  const frame = b.frame_r2_key
    ? `<img loading="lazy" src="/media/${esc(b.frame_r2_key)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block"/>`
    : "";

  const thumb =
    b.kind === "clip"
      ? `<div style="flex:none;width:92px;aspect-ratio:16/9;border-radius:${RADIUS.button};overflow:hidden;background:#0B0B0E;position:relative;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.06)">
          ${frame}
          ${b.start_ms != null ? `<span data-content style="position:absolute;left:4px;bottom:3px;font-size:9.5px;font-family:${FONT.mono};background:rgba(0,0,0,.6);border-radius:2px;padding:1px 4px">${hms(b.start_ms / 1000)}</span>` : ""}
        </div>`
      : `<div style="flex:none;width:92px;aspect-ratio:16/9;border-radius:${RADIUS.button};background:${accentBg(kind.accent)};display:grid;place-items:center;font-size:${SIZE.pill};font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:${kind.accent}">${esc(kind.label)}</div>`;

  return `<div class="beat" data-beat="${esc(b.id)}" style="display:flex;gap:14px;padding:16px;border-radius:${RADIUS.card};background:${C.surface}">
    ${thumb}
    <div style="flex:1;min-width:0">
      <div style="font-size:${SIZE.pill};font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:${kind.accent}">${esc(kind.label)}</div>
      <div data-content style="font-size:${SIZE.body};line-height:1.5;margin-top:5px;color:${b.text ? C.ink : C.ink45}">${esc(b.text || "nothing laid down yet.")}</div>
      ${b.dur_ms ? `<div data-content style="font-size:${SIZE.meta};color:${C.ink45};margin-top:5px;font-family:${FONT.mono}">${hms(b.dur_ms / 1000)}</div>` : ""}
      ${recorded ? `<div style="font-size:${SIZE.meta};color:${ACCENT.green};margin-top:5px">Recorded</div>` : ""}
    </div>
    <div style="flex:none;display:flex;flex-direction:column;gap:6px;align-items:flex-end">
      ${
        needsVoice
          ? `<button class="record" data-beat="${esc(b.id)}" style="font-size:${SIZE.secondary};font-weight:600;padding:6px 13px;border-radius:${RADIUS.button};background:${accentBg(ACCENT.red)};color:${ACCENT.red};border:none;cursor:pointer;white-space:nowrap;font-family:${FONT.ui}">Record</button>`
          : recorded
            ? `<button class="record" data-beat="${esc(b.id)}" style="font-size:${SIZE.secondary};font-weight:500;padding:6px 13px;border-radius:${RADIUS.button};background:${C.pill};color:${C.ink70};border:none;cursor:pointer;white-space:nowrap;font-family:${FONT.ui}">Another take</button>`
            : ""
      }
      <div style="display:flex;gap:4px">
        <button class="move-beat" data-beat="${esc(b.id)}" data-dir="-1" ${i === 0 ? "disabled" : ""} aria-label="Move earlier" style="width:26px;height:26px;display:grid;place-items:center;border-radius:${RADIUS.button};background:${C.pill};border:none;color:${C.ink70};cursor:pointer;${i === 0 ? "opacity:.35;cursor:default;" : ""}">${iconArrowUp({ size: 11 })}</button>
        <button class="move-beat" data-beat="${esc(b.id)}" data-dir="1" ${i === total - 1 ? "disabled" : ""} aria-label="Move later" style="width:26px;height:26px;display:grid;place-items:center;border-radius:${RADIUS.button};background:${C.pill};border:none;color:${C.ink70};cursor:pointer;${i === total - 1 ? "opacity:.35;cursor:default;" : ""}">${iconArrowDown({ size: 11 })}</button>
      </div>
    </div>
  </div>`;
}

export function renderBuild(d: BuildData): string {
  if (!d.beats.length) {
    return `<div style="margin-top:24px;padding:20px 18px;border-radius:${RADIUS.card};background:${C.surface}">
      <div style="font-size:${SIZE.body};color:${C.ink45}">No beats laid down yet</div>
    </div>`;
  }

  const blocks = d.beats
    .map((b, i) => seam(d.projectId, i) + beatBlock(b, i, d.beats.length))
    .join("");

  return `<div id="build" data-project="${esc(d.projectId)}" style="margin-top:18px;display:flex;flex-direction:column;gap:2px">
    ${blocks}${seam(d.projectId, d.beats.length)}
  </div>`;
}
