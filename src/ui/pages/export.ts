/**
 * Export — the panel that starts a render, and the strip of what came back.
 *
 * This was the tail of a 644-line editor.ts that also held a four-stage editor
 * with a tab bar. That editor was replaced by src/ui/pages/cut.ts and became
 * unreachable, but stayed in the tree and stayed imported, so it still looked
 * live: its tab bar was still the only thing linking to /pick, /build,
 * /script and /shorts. Two bugs this session came from editing a dead copy of
 * a surface instead of the live one, so the dead half is gone rather than
 * left for the next reader to fall into.
 *
 * The options are rendered inline and hidden rather than built in JS, so they
 * come from the same FORMATS / RENDER_ASPECTS / CAPTION_STYLES the server
 * validates against and the two cannot drift apart.
 */

import { C, ACCENT, FONT, RADIUS, SIZE, accentBg } from "../tokens.ts";
import { FORMATS, RENDER_ASPECTS } from "../../render-job.ts";
import { CAPTION_STYLES } from "../../shorts.ts";
import { esc } from "../shell.ts";
import { hms } from "./footage.ts";

export function exportPanel(projectId: string, plan: string): string {
  const free = plan === "free";

  const chip = (name: string, id: string, label: string, note: string, on: boolean, locked: boolean) =>
    `<label class="exp-chip">
      <input type="radio" name="${name}" value="${esc(id)}" ${on ? "checked" : ""} ${locked ? "disabled" : ""} style="position:absolute;opacity:0;pointer-events:none"/>
      <span style="font-size:${SIZE.secondary};font-weight:500;color:${C.ink}">${esc(label)}</span>
      <span data-content style="font-size:${SIZE.meta};color:${C.ink45}">${esc(note)}</span>
    </label>`;

  return `<form id="export-panel" data-project="${esc(projectId)}" hidden style="margin-top:10px;padding:14px 16px;border-radius:${RADIUS.card};background:#141418;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.06)">
    <div style="font-size:${SIZE.secondary};color:${C.ink45}">Size</div>
    <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">${FORMATS.map((f) =>
      chip("format", f.id, f.label, f.pro && free ? "Studio" : f.note, f.id === "mp4_1080", Boolean(f.pro && free)),
    ).join("")}</div>
    <div style="font-size:${SIZE.secondary};color:${C.ink45};margin-top:14px">Shape</div>
    <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">${RENDER_ASPECTS.map((a) =>
      chip("aspect", a.id, a.label, a.note, a.id === "16:9", false),
    ).join("")}</div>
    <!-- Captions are OFF by default and a deliberate choice — the owner's
         instruction was that they belong on some videos, not all of them.
         Burned-in captions cannot be removed from a finished file, so the
         default has to be the reversible one. -->
    <div style="font-size:${SIZE.secondary};color:${C.ink45};margin-top:14px">Captions</div>
    <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">${CAPTION_STYLES.map((cs) =>
      chip("captionStyle", cs, cs === "None" ? "Off" : cs, cs === "None" ? "no captions" : "burned in", cs === "None", false),
    ).join("")}</div>
    <div style="margin-top:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <button type="submit" style="font-size:${SIZE.secondary};font-weight:600;padding:8px 18px;border-radius:${RADIUS.button};background:${C.ink};color:#131316;border:none;cursor:pointer;font-family:${FONT.ui}">Export</button>
      <span data-content style="font-size:${SIZE.meta};color:${C.ink32}">Nothing renders until you say so.</span>
    </div>
  </form>`;
}

export interface RenderRow {
  id: string;
  format: string;
  aspect: string;
  state: string;
  r2_key: string | null;
  bytes: number | null;
  duration_s: number | null;
  error: string | null;
  created_at: number;
}

/**
 * Your finished video.
 *
 * THE PRODUCT HAD NO END. You could upload, read, and cut — and then pressing
 * render toasted "it'll appear in Exports when it's done", and there was no
 * Exports. Not hidden, not broken: never built. The pipeline was complete all
 * the way to an mp4 in R2 with state='ready', and nothing in the interface
 * ever showed it to anyone. Every path through this product led to a hole.
 *
 * It lives on the edit rather than behind a fifth nav item, because that is
 * where you pressed the button. You export, and the file appears under the
 * thing you exported.
 */
export function exportsStrip(d: { projectId: string; renders?: RenderRow[] }): string {
  const rows = d.renders ?? [];
  const working = rows.some((r) => r.state === "queued" || r.state === "running");

  const size = (n: number | null) =>
    n ? `${(n / 1e9 >= 1 ? (n / 1e9).toFixed(1) + " GB" : Math.round(n / 1e6) + " MB")}` : "";

  const row = (r: RenderRow) => {
    const label = `${r.format.startsWith("mp4") ? "MP4" : r.format.toUpperCase()} · ${r.aspect}`;
    const meta = [r.duration_s ? hms(r.duration_s) : null, size(r.bytes)].filter(Boolean).join(" · ");

    if (r.state === "ready" && r.r2_key) {
      return `<div style="display:flex;align-items:center;gap:12px;padding:11px 14px;border-radius:${RADIUS.card};background:${C.surface}">
        <span style="flex:none;width:6px;height:6px;border-radius:50%;background:${ACCENT.green}"></span>
        <span data-content style="flex:1;min-width:0;font-size:${SIZE.secondary};color:${C.ink}">${esc(label)}</span>
        <span data-content style="flex:none;font-size:${SIZE.meta};color:${C.ink45};font-family:${FONT.mono}">${esc(meta)}</span>
        <a href="/media/${esc(r.r2_key)}?download=1" style="flex:none;font-size:${SIZE.meta};font-weight:600;padding:6px 12px;border-radius:${RADIUS.button};background:${C.ink};color:#131316">Download</a>
      </div>`;
    }

    if (r.state === "failed") {
      return `<div style="display:flex;align-items:center;gap:12px;padding:11px 14px;border-radius:${RADIUS.card};background:${C.surface};box-shadow:inset 0 0 0 1px rgba(224,106,106,0.24)">
        <span style="flex:none;width:6px;height:6px;border-radius:50%;background:${ACCENT.red}"></span>
        <span data-content style="flex:1;min-width:0;font-size:${SIZE.secondary};color:${ACCENT.red}">${esc(r.error ?? "That render failed.")}</span>
      </div>`;
    }

    return `<div style="display:flex;align-items:center;gap:12px;padding:11px 14px;border-radius:${RADIUS.card};background:${C.surface}">
      <span style="flex:none;width:6px;height:6px;border-radius:50%;background:${ACCENT.gold};animation:blip 1.6s ease-in-out infinite"></span>
      <span data-content style="flex:1;min-width:0;font-size:${SIZE.secondary};color:${C.ink45}">${esc(label)} — putting it together</span>
    </div>`;
  };

  if (!rows.length) return "";

  /* data-working tells the client whether to poll. Nothing polls a finished
     list, which is the difference between a page that settles and one that
     talks to the server for ever. */
  return `<div id="exports" data-project="${esc(d.projectId)}" data-working="${working ? 1 : 0}" style="margin-top:22px">
    <div style="font-size:${SIZE.secondary};color:${C.ink45};margin-bottom:8px">Exports</div>
    <div style="display:flex;flex-direction:column;gap:6px">${rows.map(row).join("")}</div>
  </div>`;
}

/**
 * One transcript line, as a keep/drop block.
 *
 * The unassisted half of the editor: the same reading-and-deciding as a scored
 * cut, with nothing having decided for you. Dropping uses the same cut model
 * as Script, so the two stages edit one thing rather than two.
 *
 * Two things this deliberately does NOT do, both learned from looking at it
 * with a real 38-line transcript in it rather than a one-line test file:
 *
 *  - No thumbnail. A scored clip has its own frame, so a column of them tells
 *    you something. A transcript line does not, so every block was handed the
 *    SAME source poster — thirty-eight identical pictures down the page,
 *    eating 92px of every row to say nothing. The timecode is the useful part
 *    and it is now the thing you click to play.
 *
 *  - No green "Keeping" badge on every line. Everything starts kept, so that
 *    was thirty-eight green pills shouting the default state, while the thing
 *    you actually came to do — drop a line — was the quiet one. The states are
 *    inverted: keeping is silent, and the control offers the action.
 *
 * The whole line is the target. Clicking the text strikes it, which is the
 * gesture Script already uses on words.
 */
