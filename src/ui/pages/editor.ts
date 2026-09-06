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
import { iconArrowDown, iconArrowUp, iconPlay, iconPlus } from "../icons.ts";
import { esc } from "../shell.ts";
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
  const kept = d.clips.filter((c) => c.kept).length;
  const runtimeMs = d.clips.filter((c) => c.kept).reduce((n, c) => n + (c.end_ms - c.start_ms), 0);

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

  const backAndPill = `<div style="display:flex;align-items:center;gap:10px">
    <a href="${backHref}" style="font-size:${SIZE.secondary};color:rgba(236,236,241,0.4);white-space:nowrap">← ${backLabel}</a>
    ${pill ? `<span data-content style="font-size:${SIZE.pill};font-weight:600;letter-spacing:.04em;padding:2px 7px;border-radius:4px;background:${accentBg(pill.accent)};color:${pill.accent};white-space:nowrap">${pill.text}</span>` : ""}
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
           ${titleIsHeading ? `<span style="margin-left:auto;font-size:${SIZE.body};font-weight:600;font-family:${FONT.mono};white-space:nowrap">${hms(runtimeMs / 1000)}</span>
           <span style="font-size:${SIZE.secondary};color:${C.ink45};font-family:${FONT.mono};white-space:nowrap">${kept} kept</span>` : ""}`
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

  // Blocks, with the footage that was passed over shown striped between them.
  const parts: string[] = [seam()];
  d.clips.forEach((c, i) => {
    const prev = d.clips[i - 1];
    if (prev && c.start_ms > prev.end_ms) parts.push(skippedStretch(prev.end_ms, c.start_ms));
    parts.push(block(c, i, d.clips.length));
    parts.push(seam());
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
    <div style="flex:1 1 340px;min-width:min(320px,100%);max-width:min(400px,100%);position:sticky;top:88px">
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
    <button class="render-cut" data-project="${esc(d.projectId)}" style="margin-left:auto;flex:none;font-size:${SIZE.secondary};font-weight:600;padding:8px 18px;border-radius:${RADIUS.button};background:${C.ink};color:#131316;border:none;cursor:pointer;font-family:${FONT.ui};white-space:nowrap">Export as</button>
  </div>`;
}
