/**
 * The editor — one surface with a stage tab bar, not four screens
 * (01-PRODUCT.md §Editor).
 *
 * "Pick what stays" is the claim made concrete: the whole hour as keep/drop
 * blocks, each with its thumbnail, timecode, transcript and the reason it was
 * kept. No timeline, no scrub bar. Editing is reading.
 *
 * Copy is taken from the prototype's Cutting-room block; nothing here is
 * phrased by me.
 */

import { C, ACCENT, FONT, RADIUS, SIZE, accentBg } from "../tokens";
import { iconArrowDown, iconArrowUp, iconPlay, iconPlus } from "../icons";
import { esc } from "../shell";
import { hms } from "./footage";

export type Stage = "cut" | "essay" | "transcript" | "shorts";

export interface EditorClip {
  id: string;
  start_ms: number;
  end_ms: number;
  quote: string;
  why: string | null;
  score: number | null;
  kept: number;
  frame_r2_key: string;
}

export interface EditorData {
  projectId: string;
  title: string;
  brief: string | null;
  sourceTitle: string;
  sourceFilename: string | null;
  /** Null when the project has no source footage — hides Pick and Script. */
  hasSource: boolean;
  stage: Stage;
  clips: EditorClip[];
  /** Live scoring job, when the pass is still running. */
  job: { state: string; pct: number; stage_label: string | null; error: string | null } | null;
}

/**
 * Tabs are context-aware: a project with no source footage does not show
 * "Pick what stays" or "Script" (01-PRODUCT.md §Editor).
 */
function stageTabs(d: EditorData): string {
  const all: Array<[string, Stage]> = [
    ["Pick what stays", "cut"],
    ["Build", "essay"],
    ["Script", "transcript"],
    ["Shorts from this", "shorts"],
  ];
  const shown = all.filter(([, v]) => (v === "cut" || v === "transcript" ? d.hasSource : true));
  const path: Record<Stage, string> = { cut: "pick", essay: "build", transcript: "script", shorts: "shorts" };

  return `<div style="margin-top:14px;display:flex;gap:4px;border-bottom:1px solid ${C.hairline};overflow-x:auto">${shown
    .map(
      ([name, v]) =>
        `<a href="/p/${esc(d.projectId)}/${path[v]}" style="font-size:${SIZE.body};font-weight:500;padding:9px 14px;cursor:pointer;color:${
          v === d.stage ? C.ink : C.ink45
        };border-bottom:2px solid ${v === d.stage ? C.ink : "transparent"};margin-bottom:-1px;white-space:nowrap">${esc(name)}</a>`,
    )
    .join("")}</div>`;
}

const STAGE_PILL: Record<Stage, string> = {
  cut: "PICKING WHAT STAYS",
  essay: "BUILDING IT UP",
  transcript: "THE WORDS",
  shorts: "SHORTS FROM THIS",
};

/**
 * The header every stage shares: back link, stage pill, tab bar, title and
 * runtime. Exported so each stage renders the same one rather than a
 * near-copy — the tab bar drifting between stages is exactly how an editor
 * stops feeling like one place.
 */
export function editorHeader(d: EditorData): string {
  const kept = d.clips.filter((c) => c.kept).length;
  const runtimeMs = d.clips.filter((c) => c.kept).reduce((n, c) => n + (c.end_ms - c.start_ms), 0);

  return `<div style="display:flex;align-items:center;gap:10px">
    <a href="/footage?tab=sources" style="font-size:${SIZE.secondary};color:rgba(236,236,241,0.4);white-space:nowrap">← Footage</a>
    <span style="font-size:${SIZE.pill};font-weight:600;letter-spacing:.04em;padding:2px 7px;border-radius:4px;background:${accentBg(ACCENT.cyan)};color:${ACCENT.cyan};white-space:nowrap">${STAGE_PILL[d.stage]}</span>
  </div>
  ${stageTabs(d)}
  <div style="margin-top:16px;display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
    <div data-content style="font-size:${SIZE.pageTitle};font-weight:600;letter-spacing:-0.022em">${esc(d.title)}</div>
    <span data-content style="font-size:${SIZE.secondary};color:rgba(236,236,241,0.35);font-family:${FONT.mono}">${esc(d.sourceFilename ?? d.sourceTitle)}</span>
    <span style="margin-left:auto;font-size:${SIZE.body};font-weight:600;font-family:${FONT.mono};white-space:nowrap">${hms(runtimeMs / 1000)}</span>
    <span style="font-size:${SIZE.secondary};color:${C.ink45};font-family:${FONT.mono};white-space:nowrap">${kept} kept</span>
  </div>`;
}

/** The seam between blocks — how anything gets inserted mid-piece. */
function seam(): string {
  return `<div style="display:flex;justify-content:center;padding:2px 0">
    <span role="button" tabindex="0" style="width:22px;height:22px;border-radius:50%;background:${C.surface};display:flex;align-items:center;justify-content:center;color:${C.ink45};cursor:pointer">${iconPlus({ size: 13 })}</span>
  </div>`;
}

/**
 * One block. The kept/dropped state is the edit — a dropped block stays
 * visible and struck rather than disappearing, so the cut stays legible and
 * putting it back is one click. Nothing here hard-deletes.
 */
function block(c: EditorClip, i: number, total: number): string {
  const kept = Boolean(c.kept);
  const dur = (c.end_ms - c.start_ms) / 1000;

  const toggle = kept
    ? `<span style="flex:none;font-size:${SIZE.secondary};font-weight:600;padding:5px 11px;border-radius:${RADIUS.button};background:${accentBg(ACCENT.green)};color:${ACCENT.green};white-space:nowrap">Keeping</span>`
    : `<span style="flex:none;font-size:${SIZE.secondary};font-weight:500;padding:5px 11px;border-radius:${RADIUS.button};background:${C.pill};color:${C.ink70};white-space:nowrap">Add back</span>`;

  const frame = c.frame_r2_key
    ? `<img loading="lazy" src="/media/${esc(c.frame_r2_key)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block"/>`
    : "";

  return `<div data-clip="${esc(c.id)}" data-kept="${kept ? 1 : 0}" style="display:flex;gap:14px;padding:16px;border-radius:${RADIUS.card};background:${C.surface};${kept ? "" : "opacity:.55;"}">
    <div style="flex:none;width:92px;aspect-ratio:16/9;border-radius:${RADIUS.button};overflow:hidden;background:#0B0B0E;position:relative;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.06)">
      ${frame}
      <span style="position:absolute;left:4px;bottom:3px;font-size:9.5px;font-family:${FONT.mono};background:rgba(0,0,0,.6);border-radius:2px;padding:1px 4px">${hms(c.start_ms / 1000)}</span>
    </div>
    <div style="flex:1;min-width:0">
      <div data-content style="font-size:${SIZE.body};line-height:1.5;color:${C.ink};${kept ? "" : "text-decoration:line-through;text-decoration-color:rgba(236,236,241,0.35);"}">${esc(c.quote)}</div>
      ${c.why ? `<div data-content style="font-size:${SIZE.meta};color:${C.ink45};margin-top:6px">${esc(c.why)} · ${hms(dur)}</div>` : `<div data-content style="font-size:${SIZE.meta};color:${C.ink45};margin-top:6px">${hms(dur)}</div>`}
      <div style="font-size:${SIZE.meta};color:${ACCENT.green};margin-top:4px">Saved to Footage →</div>
    </div>
    <div style="flex:none;display:flex;flex-direction:column;gap:6px;align-items:flex-end">
      <button class="keep-toggle" data-clip="${esc(c.id)}" data-kept="${kept ? 1 : 0}" style="background:none;border:none;padding:0;cursor:pointer;font-family:${FONT.ui}">${toggle}</button>
      <div style="display:flex;gap:4px">
        <button class="move" data-clip="${esc(c.id)}" data-dir="-1" ${i === 0 ? "disabled" : ""} aria-label="Move earlier" style="width:26px;height:26px;display:grid;place-items:center;border-radius:${RADIUS.button};background:${C.pill};border:none;color:${C.ink70};cursor:pointer;${i === 0 ? "opacity:.35;cursor:default;" : ""}">${iconArrowUp({ size: 11 })}</button>
        <button class="move" data-clip="${esc(c.id)}" data-dir="1" ${i === total - 1 ? "disabled" : ""} aria-label="Move later" style="width:26px;height:26px;display:grid;place-items:center;border-radius:${RADIUS.button};background:${C.pill};border:none;color:${C.ink70};cursor:pointer;${i === total - 1 ? "opacity:.35;cursor:default;" : ""}">${iconArrowDown({ size: 11 })}</button>
      </div>
    </div>
  </div>`;
}

/**
 * The preview. Cloudflare Stream is not wired yet, so this shows the real
 * frame and the real quote rather than a fake player — an inert scrub bar
 * would be a worse lie than an honest still.
 */
function preview(d: EditorData): string {
  const first = d.clips.find((c) => c.kept) ?? d.clips[0];
  if (!first) return "";
  const frame = first.frame_r2_key
    ? `<img src="/media/${esc(first.frame_r2_key)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block"/>`
    : "";
  return `<div style="margin-top:18px;border-radius:${RADIUS.card};overflow:hidden;background:#0B0B0E;position:relative;aspect-ratio:16/9;max-height:320px">
    ${frame}
    <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.45) 0%,rgba(0,0,0,0) 35%,rgba(0,0,0,.65) 100%)"></div>
    <div style="position:absolute;top:10px;left:12px;font-size:${SIZE.meta};font-weight:600;background:rgba(0,0,0,.45);padding:3px 8px;border-radius:4px">Preview the cut</div>
    <div data-content style="position:absolute;top:10px;right:12px;font-size:${SIZE.meta};font-family:${FONT.mono};background:rgba(0,0,0,.45);padding:3px 8px;border-radius:4px">${hms(first.start_ms / 1000)} in the original</div>
    <div data-content style="position:absolute;left:14px;right:14px;bottom:14px;font-size:${SIZE.body};line-height:1.45">${esc(first.quote.slice(0, 140))}</div>
    <span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);width:38px;height:38px;border-radius:50%;background:rgba(10,10,11,.55);display:grid;place-items:center">${iconPlay(15)}</span>
  </div>`;
}

function askAnotherPass(d: EditorData): string {
  return `<form class="pass-form" data-project="${esc(d.projectId)}" style="margin-top:18px;padding:12px 14px;border-radius:${RADIUS.card};background:${C.surface}">
    <div style="font-size:${SIZE.secondary};color:${C.ink45};margin-bottom:8px">Ask for another pass</div>
    <div style="display:flex;gap:8px;align-items:center;background:#131316;border-radius:${RADIUS.input};padding:4px 4px 4px 12px;flex-wrap:wrap">
      <input name="instruction" placeholder="“also cut the sponsor read”" style="flex:1 1 200px;min-width:min(180px,100%);background:transparent;border:none;outline:none;color:${C.ink};font-size:13px;padding:7px 0;font-family:${FONT.ui}"/>
      <button type="submit" style="flex:none;font-size:${SIZE.secondary};font-weight:600;padding:7px 15px;border-radius:${RADIUS.button};background:${C.ink};color:#131316;cursor:pointer;white-space:nowrap;border:none;font-family:${FONT.ui}">Run it</button>
    </div>
  </form>`;
}

export function renderEditor(d: EditorData): string {
  const head = editorHeader(d);

  // Still scoring: name the stage, no fake percentage.
  if (d.job && (d.job.state === "queued" || d.job.state === "running") && !d.clips.length) {
    return `${head}
    <div id="scoring" data-project="${esc(d.projectId)}" style="margin-top:24px;display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:${RADIUS.card};background:#141418;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.04)">
      <span style="width:6px;height:6px;border-radius:50%;background:${ACCENT.gold};animation:blip 1.6s ease-in-out infinite;flex:none"></span>
      <span style="flex:1;font-size:${SIZE.secondary};color:rgba(236,236,241,0.55)">${esc(d.job.stage_label ?? "reading it for meaning")}</span>
    </div>`;
  }

  if (d.job?.state === "failed") {
    return `${head}
    <div style="margin-top:24px;padding:16px 18px;border-radius:${RADIUS.card};background:${C.surface};box-shadow:inset 0 0 0 1px rgba(224,106,106,0.24)">
      <div style="font-size:${SIZE.body};color:${ACCENT.red}">${esc(d.job.error ?? "Couldn't work out what to keep.")}</div>
    </div>
    ${askAnotherPass(d)}`;
  }

  if (!d.clips.length) {
    return `${head}
    <div style="margin-top:24px;padding:20px 18px;border-radius:${RADIUS.card};background:${C.surface}">
      <div style="font-size:${SIZE.body};color:${C.ink45}">no matches — try different words</div>
    </div>
    ${askAnotherPass(d)}`;
  }

  const blocks = d.clips.map((c, i) => block(c, i, d.clips.length)).join(seam());

  return `${head}
  ${preview(d)}
  <div style="margin-top:18px;display:flex;flex-direction:column;gap:2px">${seam()}${blocks}${seam()}</div>
  <div style="font-size:${SIZE.meta};color:rgba(236,236,241,0.3);margin-top:10px;padding-left:4px">the words — strike a sentence to cut just that</div>
  ${askAnotherPass(d)}`;
}
