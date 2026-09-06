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

import { C, ACCENT, FONT, RADIUS, SIZE, accentBg } from "../tokens.ts";
import { FORMATS, RENDER_ASPECTS } from "../../render-job.ts";
import { iconArrowDown, iconArrowUp, iconPlay } from "../icons.ts";
import { esc } from "../shell.ts";
import { itemMenu } from "../item-menu.ts";
import { hms, tc } from "./footage.ts";

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
  cleanUps?: CleanUp[];
  projectId: string;
  title: string;
  brief: string | null;
  sourceTitle: string;
  sourceFilename: string | null;
  /** Null when the project has no source footage — hides Pick and Script. */
  hasSource: boolean;
  stage: Stage;
  clips: EditorClip[];
  /*
   * A cut made without asking for anything gets no scoring pass, so it has no
   * clips — its blocks are the transcript itself. Uploading a video and
   * pressing Edit should let you edit it, not hand it to a model that decides
   * what matters before you have seen it.
   */
  segments?: { idx: number; start_ms: number; end_ms: number; text: string }[];
  cuts?: { seg: number; words: [number, number] | null }[];
  sourcePoster?: string | null;
  /** The video itself, so the workspace has the footage in it and not just words. */
  sourceKey?: string | null;
  sourceId?: string | null;
  /** Which plan the account is on — 4K is Studio-only. */
  plan?: string;
  /** What the cut actually plays, word-level trims included. */
  runtimeAfterCutsMs?: number;
  /** Finished (and in-flight) exports of THIS edit. */
  renders?: RenderRow[];
  /** Live scoring job, when the pass is still running. */
  job: { state: string; pct: number; stage_label: string | null; error: string | null } | null;
  /** cut | reaction | essay | idea. Drives Build's kind chip and lede. */
  kind: string;
  /** Build only: what the runtime label and lede report. */
  beatCount?: number;
  beatRuntimeMs?: number;
  /** The tail of Build's lede — "3 voiceovers to go." or "every beat is filled." */
  summary?: string;
  /*
   * Where the user came in from, as [label, href]. The prototype builds this
   * back link as "← " + originOf(), so it says Footage when you arrived from
   * Footage and Clipping when you arrived from Clipping. Hardcoding Footage
   * sent people somewhere they had never been.
   */
  cameFrom?: [string, string];
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

/*
 * The stage pill, and its colour. Shorts has NO pill in the prototype — it
 * leads with a 24px heading instead — so it is absent here rather than given
 * an invented one. The colour is per-stage and was hardcoded cyan until this
 * was checked against the prototype: only "PICKING WHAT STAYS" is cyan.
 */
const STAGE_PILL: Record<Stage, { text: string; accent: string } | null> = {
  cut: { text: "PICKING WHAT STAYS", accent: ACCENT.cyan },
  essay: { text: "BUILDING IT UP", accent: ACCENT.gold },
  transcript: { text: "EDITING THE WORDS", accent: ACCENT.gold },
  shorts: null,
};

/**
 * The kind chip beside the title on Build. Green for a cut, red for a
 * reaction, gold for an essay — the same three the prototype uses.
 */
const KIND_ACCENT: Record<string, string> = {
  cut: ACCENT.green,
  reaction: ACCENT.red,
  essay: ACCENT.gold,
  idea: ACCENT.gold,
};

/** The line under Build's title, which varies by what is being made. */
function ledeFor(kind: string): string {
  if (kind === "reaction") {
    return "Laid out from your brief — the clips it flagged, with your reaction slots placed between them.";
  }
  if (kind === "cut") {
    return "Block by block — clips from your footage, your voice bridging between them —";
  }
  return "Built act by act. Every beat is a clip from your footage, your own voice, or a visual it makes —";
}

/**
 * The header every stage shares: back link, stage pill, tab bar, title and
 * runtime. Exported so each stage renders the same one rather than a
 * near-copy — the tab bar drifting between stages is exactly how an editor
 * stops feeling like one place.
 */
export function editorHeader(d: EditorData): string {
  /*
   * An unassisted cut has no clips, so counting clips reported "0:00 · 0 kept"
   * at the top of a page whose own footer said "38 kept · 5:17". Two counters
   * on one screen disagreeing about the same edit. The count follows whatever
   * the edit is actually made of.
   */
  const scratch = !d.clips.length && Boolean(d.segments?.length);
  const dropped = new Set((d.cuts ?? []).filter((x) => x.words === null).map((x) => x.seg));
  const keptSegs = scratch ? (d.segments ?? []).filter((sg) => !dropped.has(sg.idx)) : [];

  const kept = scratch ? keptSegs.length : d.clips.filter((c) => c.kept).length;
  const runtimeMs = scratch
    ? keptSegs.reduce((n, sg) => n + (sg.end_ms - sg.start_ms), 0)
    : d.clips.filter((c) => c.kept).reduce((n, c) => n + (c.end_ms - c.start_ms), 0);

  /*
   * Script demotes the project title to 13.5px, because "Trim it by text" is
   * that page's heading. Pick keeps it at 24px, where it IS the heading.
   * Same header component, different emphasis — matching the prototype rather
   * than rendering one size everywhere.
   */
  const titleIsHeading = d.stage !== "transcript";
  const pill = STAGE_PILL[d.stage];

  /*
   * Build carries its own meta: a kind chip beside the title, "1:47 · 5 beats"
   * on the right, and a lede underneath. Pick shows the source filename and a
   * kept count instead. Same header, different right-hand side.
   */
  const isBuild = d.stage === "essay";
  const beatCount = d.beatCount ?? 0;
  const runtimeLabel = isBuild
    ? `${hms(d.beatRuntimeMs != null ? d.beatRuntimeMs / 1000 : 0)} · ${beatCount} beat${beatCount === 1 ? "" : "s"}`
    : "";

  const [backLabel, backHref] = d.cameFrom ?? ["Home", "/"];

  /* Rename and delete the edit you are IN, not only from a list of them. */
  const backAndPill = `<div style="display:flex;align-items:center;gap:10px">
    <a href="${backHref}" style="font-size:${SIZE.secondary};color:rgba(236,236,241,0.4);white-space:nowrap">← ${backLabel}</a>
    ${pill ? `<span data-content style="font-size:${SIZE.pill};font-weight:600;letter-spacing:.04em;padding:2px 7px;border-radius:4px;background:${accentBg(pill.accent)};color:${pill.accent};white-space:nowrap">${pill.text}</span>` : ""}
    <span style="margin-left:auto">${itemMenu("projects", d.projectId, d.title, "edit")}</span>
  </div>`;

  /*
   * Shorts is its own surface reached as a stage, so it leads with its own
   * heading rather than the project's title — "Shorts from this footage", the
   * same 24px heading Clipping uses standalone. Showing the project title here
   * made it look like a fourth view of the cut instead of a different job.
   */
  if (d.stage === "shorts") {
    return `${backAndPill}
    ${stageTabs(d)}
    <div style="margin-top:16px">
      <div data-content style="font-size:${SIZE.pageTitle};font-weight:600;letter-spacing:-0.02em">Shorts from this footage</div>
      <div data-content style="font-size:${SIZE.body};color:rgba(236,236,241,0.42);margin-top:5px">The clips you kept, cut vertical with captions. Keep the ones that land.</div>
    </div>`;
  }

  return `${backAndPill}
  ${stageTabs(d)}
  <div style="margin-top:16px;display:flex;align-items:${isBuild ? "center" : "baseline"};gap:10px;flex-wrap:wrap">
    <div data-content style="font-size:${titleIsHeading ? SIZE.pageTitle : SIZE.body};font-weight:600;letter-spacing:${titleIsHeading ? "-0.022em" : "0"}">${esc(d.title)}</div>
    ${
      isBuild
        ? `<span data-content style="font-size:${SIZE.meta};padding:2px 7px;border-radius:4px;background:${accentBg(KIND_ACCENT[d.kind] ?? ACCENT.gold)};color:${KIND_ACCENT[d.kind] ?? ACCENT.gold}">${esc(d.kind.charAt(0).toUpperCase() + d.kind.slice(1))}</span>
           <span data-content style="margin-left:auto;font-size:${SIZE.secondary};color:rgba(236,236,241,0.35);font-family:${FONT.mono};white-space:nowrap;flex:none">${runtimeLabel}</span>`
        : `<span data-content style="font-size:${SIZE.secondary};color:rgba(236,236,241,0.35);font-family:${FONT.mono}">${esc(d.sourceFilename ?? d.sourceTitle)}</span>
           ${titleIsHeading ? `<span id="head-runtime" style="margin-left:auto;font-size:${SIZE.body};font-weight:600;font-family:${FONT.mono};white-space:nowrap">${hms(runtimeMs / 1000)}</span>
           <span id="head-kept" style="font-size:${SIZE.secondary};color:${C.ink45};font-family:${FONT.mono};white-space:nowrap">${kept} kept</span>` : ""}`
    }
  </div>
  ${isBuild ? `<div data-content style="font-size:${SIZE.body};color:rgba(236,236,241,0.42);margin-top:5px">${ledeFor(d.kind)} ${esc(d.summary ?? "every beat is filled.")}</div>` : ""}`;
}

/**
 * The Clean up row — one tap each, applied to the whole cut.
 *
 * Names AND sublabels are the prototype's own, and the sublabels carry live
 * numbers: "47 found · −0:04", not "several". That is a stated rule
 * (02-DESIGN-SYSTEM.md §Copy voice) and it is why the counts here are computed
 * from the real transcript rather than written into the label.
 *
 * A chip whose number cannot be computed honestly yet shows its descriptive
 * text and is disabled, rather than displaying a plausible fabricated count.
 */
export interface CleanUp {
  id: string;
  name: string;
  sub: string;
  ready: boolean;
  done: boolean;
}

function cleanUpRow(projectId: string, chips: CleanUp[]): string {
  const html = chips.map(
    (a) => `<button class="cleanup" data-kind="${esc(a.id)}" data-project="${esc(projectId)}" ${a.ready && !a.done ? "" : "disabled"}
      style="text-align:left;padding:8px 12px;border-radius:${RADIUS.button};background:${C.pill};border:none;cursor:${a.ready ? "pointer" : "default"};font-family:${FONT.ui};${a.ready ? "" : "opacity:.4;"}">
      <span style="display:block;font-size:${SIZE.secondary};font-weight:500;color:${a.done ? ACCENT.green : C.ink};white-space:nowrap">${esc(a.name)}</span>
      <span data-content style="display:block;font-size:${SIZE.meta};color:${C.ink45};white-space:nowrap">${esc(a.sub)}</span>
    </button>`,
  ).join("");

  return `<div style="margin-top:16px">
    <div style="font-size:${SIZE.secondary};color:${C.ink45};margin-bottom:8px">Clean up</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">${html}</div>
  </div>`;
}

/**
 * A skipped stretch: the footage between two kept blocks.
 *
 * Striped rather than hidden, because the hour is still there — the user can
 * see how much was passed over and open it to pull something back. Hiding it
 * would make the cut look like the whole video.
 */
function skippedStretch(fromMs: number, toMs: number): string {
  const secs = Math.round((toMs - fromMs) / 1000);
  if (secs < 1) return "";
  return `<div style="display:flex;align-items:center;gap:10px;padding:9px 14px;border-radius:${RADIUS.button};background:repeating-linear-gradient(-45deg,#101014 0 7px,#131317 7px 14px);box-shadow:inset 0 0 0 1px rgba(255,255,255,0.04)">
    <span data-content style="font-size:${SIZE.meta};font-family:${FONT.mono};color:rgba(236,236,241,0.3)">${tc(fromMs / 1000)} – ${tc(toMs / 1000)}</span>
    <span style="font-size:${SIZE.meta};color:rgba(236,236,241,0.3)">skipped</span>
  </div>`;
}

/*
 * The seam between blocks USED TO BE HERE, and it did nothing.
 *
 * It rendered a round "+" with role="button" and a pointer cursor between
 * every pair of blocks, and carried no class — so the only handler that looks
 * for a seam (Build's, which inserts a beat) never matched a single one of
 * them. On a 38-line transcript that is 39 controls that look clickable and
 * are not.
 *
 * Build's seams are real and stay. Here there is nothing to insert: Pick is
 * about what of your footage stays, not about adding to it. Same rule the
 * clean-up chips and "Queue it" already follow — a control appears when it
 * works.
 */

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
      <span style="position:absolute;left:4px;bottom:3px;font-size:9.5px;font-family:${FONT.mono};background:rgba(0,0,0,.6);border-radius:2px;padding:1px 4px">${tc(c.start_ms / 1000)}</span>
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
 * The choice "Export as" always implied and never offered.
 *
 * It rendered a button that posted mp4_1080 and 16:9, hardcoded — so a
 * vertical cut was impossible to produce from the editor, and 4K, which
 * Settings sells as the reason to pay, could not be chosen by anybody.
 *
 * Rendered inline and hidden rather than built in JS, so the options come from
 * the same FORMATS/RENDER_ASPECTS the server validates against and the two
 * cannot drift apart.
 */
function exportPanel(projectId: string, plan: string): string {
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
function exportsStrip(d: EditorData): string {
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
function segmentBlock(
  seg: { idx: number; start_ms: number; end_ms: number; text: string },
  kept: boolean,
): string {
  const action = kept
    ? `<span class="seg-pill" data-kept="1">Cut</span>`
    : `<span class="seg-pill" data-kept="0">Add back</span>`;

  return `<div data-seg-block="${seg.idx}" data-kept="${kept ? 1 : 0}" data-ms="${seg.end_ms - seg.start_ms}" style="display:flex;gap:12px;align-items:baseline;padding:11px 14px;border-radius:${RADIUS.card};background:${C.surface};${kept ? "" : "opacity:.5;"}">
    <button class="seg-play" data-start="${seg.start_ms}" aria-label="Play from ${tc(seg.start_ms / 1000)}" style="flex:none;font-size:${SIZE.meta};font-family:${FONT.mono};color:${C.ink45};background:none;border:none;padding:0;cursor:pointer;font-variant-numeric:tabular-nums">${tc(seg.start_ms / 1000)}</button>
    <button class="seg-keep" data-seg="${seg.idx}" style="flex:1;min-width:0;text-align:left;background:none;border:none;padding:0;cursor:pointer;font-family:${FONT.ui}">
      <span data-seg-text data-content style="font-size:${SIZE.body};line-height:1.55;color:${C.ink};${kept ? "" : "text-decoration:line-through;"};text-decoration-color:rgba(236,236,241,0.4)">${esc(seg.text)}</span>
    </button>
    <button class="seg-keep" data-seg="${seg.idx}" style="flex:none;background:none;border:none;padding:0;cursor:pointer;font-family:${FONT.ui}">${action}</button>
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
  return `<div style="border-radius:${RADIUS.card};overflow:hidden;background:#0B0B0E;position:relative;aspect-ratio:16/9">
    ${frame}
    <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.45) 0%,rgba(0,0,0,0) 35%,rgba(0,0,0,.65) 100%)"></div>
    <div style="position:absolute;top:10px;left:12px;font-size:${SIZE.meta};font-weight:600;background:rgba(0,0,0,.45);padding:3px 8px;border-radius:4px">Preview the cut</div>
    <div data-content style="position:absolute;top:10px;right:12px;font-size:${SIZE.meta};font-family:${FONT.mono};background:rgba(0,0,0,.45);padding:3px 8px;border-radius:4px">${tc(first.start_ms / 1000)} in the original</div>
    <div data-content style="position:absolute;left:14px;right:14px;bottom:14px;font-size:${SIZE.body};line-height:1.45">${esc(first.quote.slice(0, 140))}</div>
    <span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);width:38px;height:38px;border-radius:50%;background:rgba(10,10,11,.55);display:grid;place-items:center">${iconPlay(15)}</span>
  </div>`;
}

function askAnotherPass(d: EditorData): string {
  return `<form class="pass-form" data-project="${esc(d.projectId)}" style="margin-top:14px;padding:12px 14px;border-radius:${RADIUS.card};background:${C.surface}">
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
      ${
        d.job.pct > 0
          ? `<span data-content style="flex:none;font-size:${SIZE.meta};color:${C.ink45};font-family:${FONT.mono}">${d.job.pct}%</span>`
          : ""
      }
    </div>
    ${
      d.job.pct > 0
        ? `<div style="margin-top:8px;height:3px;border-radius:99px;background:#26262C;overflow:hidden">
            <div style="width:${Math.max(2, d.job.pct)}%;height:100%;background:${ACCENT.gold};border-radius:99px"></div>
          </div>`
        : ""
    }`;
  }

  if (d.job?.state === "failed") {
    return `${head}
    <div style="margin-top:24px;padding:16px 18px;border-radius:${RADIUS.card};background:${C.surface};box-shadow:inset 0 0 0 1px rgba(224,106,106,0.24)">
      <!-- data-content: a job's recorded reason is the user's data, not this
           product's copy, and it can never appear in the prototype. The source
           page already marked its version; this one did not, which only became
           visible once failures started rendering their reason at all. -->
      <div data-content style="font-size:${SIZE.body};color:${ACCENT.red}">${esc(d.job.error ?? "Couldn't work out what to keep.")}</div>
    </div>
    ${askAnotherPass(d)}`;
  }

  /*
   * An unassisted cut: no scoring pass ran, so the blocks are the transcript
   * and everything starts kept. You cut it down by reading, which is the
   * product's claim minus the model having gone first.
   *
   * THE SAME LAYOUT AS THE SCORED CUT. There is one editor, not two. This
   * shipped as a full-width banner player pinned to the top of the page, so
   * opening a video filled the screen with a 540px-tall video and pushed every
   * block you were meant to be reading below the fold — the exact full-screen
   * editor the owner had already asked to be removed once. Same two columns as
   * below: the player small and sticky on the left, the blocks on the right,
   * matching docs/reference/07-editor-pick-what-stays.png.
   */
  if (!d.clips.length && d.segments?.length) {
    /* words:null is a whole line struck — the gesture that drops a block.
       A word-range cut trims within a line and leaves the block in. */
    const cutSet = new Set((d.cuts ?? []).filter((x) => x.words === null).map((x) => x.seg));
    const keptSegs = d.segments.filter((sg) => !cutSet.has(sg.idx));
    /* Not a sum of whole kept segments: Script can trim WORDS out of a line
       that Pick still counts as kept, and summing segments ignored those — so
       Pick read "0:02" for a cut Script called 1.66s. One edit, one runtime,
       computed by the same function the render uses. */
    const runtime = d.runtimeAfterCutsMs ?? keptSegs.reduce((n, sg) => n + (sg.end_ms - sg.start_ms), 0);

    /* A real player rather than the scored surface's still frame, because
       there is no scored clip to show a frame OF — but the same size and the
       same place, so the two stages are one room. */
    const player = d.sourceKey
      ? `<div style="border-radius:${RADIUS.card};overflow:hidden;background:#0B0B0E;position:relative">
          <video id="scratch-video" playsinline preload="metadata" data-source="${esc(d.sourceId ?? "")}" data-needs-poster="${d.sourcePoster ? 0 : 1}"${d.sourcePoster ? ` poster="/media/${esc(d.sourcePoster)}"` : ""} src="/media/${esc(d.sourceKey)}" controls style="width:100%;aspect-ratio:16/9;background:#000;display:block"></video>
        </div>
        <div data-content style="font-size:${SIZE.meta};color:rgba(236,236,241,0.3);margin-top:8px;line-height:1.5">Click any line to play it. Strike what goes — nothing was decided for you.</div>`
      : "";

    const blocks = d.segments.map((sg) => segmentBlock(sg, !cutSet.has(sg.idx)));

    return `${head}
    ${d.cleanUps?.length ? cleanUpRow(d.projectId, d.cleanUps) : ""}
    <div style="margin-top:24px;display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap">
      <div class="editor-aside">
        ${player}
      </div>
      <div id="pick-scratch" data-project="${esc(d.projectId)}" style="flex:1 1 420px;min-width:min(320px,100%);display:flex;flex-direction:column;gap:2px">
        ${blocks.join("")}
      </div>
    </div>
    <div style="position:sticky;bottom:0;margin-top:20px;display:flex;align-items:center;gap:14px;padding:12px 16px;border-radius:${RADIUS.card};background:rgba(16,16,19,0.92);backdrop-filter:blur(14px);box-shadow:inset 0 0 0 1px rgba(255,255,255,0.06);flex-wrap:wrap">
      <span id="scratch-runtime" data-content style="font-size:${SIZE.secondary};color:${C.ink70};font-family:${FONT.mono}">${keptSegs.length} kept · ${hms(runtime / 1000)}</span>
      <button class="export-open" data-project="${esc(d.projectId)}" style="margin-left:auto;flex:none;font-size:${SIZE.secondary};font-weight:600;padding:8px 18px;border-radius:${RADIUS.button};background:${C.ink};color:#131316;border:none;cursor:pointer;font-family:${FONT.ui};white-space:nowrap">Export as</button>
    </div>
    ${exportPanel(d.projectId, d.plan ?? "free")}
    ${exportsStrip(d)}`;
  }

  if (!d.clips.length) {
    return `${head}
    <div style="margin-top:24px;padding:20px 18px;border-radius:${RADIUS.card};background:${C.surface}">
      <div style="font-size:${SIZE.body};color:${C.ink45}">no matches — try different words</div>
    </div>
    ${askAnotherPass(d)}`;
  }


  // Blocks, with the footage that was passed over shown striped between them.
  const parts: string[] = [];
  d.clips.forEach((c, i) => {
    const prev = d.clips[i - 1];
    if (prev && c.start_ms > prev.end_ms) parts.push(skippedStretch(prev.end_ms, c.start_ms));
    parts.push(block(c, i, d.clips.length));
  });

  const kept = d.clips.filter((c) => c.kept);
  const runtimeMs = kept.reduce((n, c) => n + (c.end_ms - c.start_ms), 0);

  /*
   * Two columns, not a stacked page: the block list on the left and the player
   * STICKY beside it, so it stays with whatever block is being read. Built as
   * a full-width banner first, which is the layout the owner had already
   * rejected — the giveaway was the empty right-hand third of the screen.
   */
  return `${head}
  ${d.cleanUps?.length ? cleanUpRow(d.projectId, d.cleanUps) : ""}
  <div style="margin-top:24px;display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap">
    <div class="editor-aside">
      ${preview(d)}
      ${askAnotherPass(d)}
    </div>
    <div style="flex:1 1 420px;min-width:min(320px,100%);display:flex;flex-direction:column;gap:2px">
      ${parts.join("")}
      <div style="font-size:${SIZE.meta};color:rgba(236,236,241,0.3);margin-top:6px;padding-left:4px">the words — strike a sentence to cut just that</div>
    </div>
  </div>
  <div style="position:sticky;bottom:0;margin-top:20px;display:flex;align-items:center;gap:14px;padding:12px 16px;border-radius:${RADIUS.card};background:rgba(16,16,19,0.92);backdrop-filter:blur(14px);box-shadow:inset 0 0 0 1px rgba(255,255,255,0.06);flex-wrap:wrap">
    <span data-content style="font-size:${SIZE.secondary};color:${C.ink70};font-family:${FONT.mono}">${kept.length} kept · ${hms(runtimeMs / 1000)}</span>
    <button class="export-open" data-project="${esc(d.projectId)}" style="margin-left:auto;flex:none;font-size:${SIZE.secondary};font-weight:600;padding:8px 18px;border-radius:${RADIUS.button};background:${C.ink};color:#131316;border:none;cursor:pointer;font-family:${FONT.ui};white-space:nowrap">Export as</button>
  </div>
  ${exportPanel(d.projectId, d.plan ?? "free")}
  ${exportsStrip(d)}`;
}
