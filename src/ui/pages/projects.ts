/**
 * Projects — everything being made.
 *
 * "Everything you're building — a cut, a reaction, an essay. Clips and shorts
 * aren't projects; those are material, and they live in Footage."
 *
 * The surface is two lists, not one: the thing you were last touching gets a
 * wide card of its own, and the rest sit in a grid. That split is the whole
 * point — coming back and finding what you were doing should not require
 * reading a list.
 */

import { C, ACCENT, FONT, RADIUS, SIZE } from "../tokens.ts";
import { esc } from "../shell.ts";
import { itemMenu } from "../item-menu.ts";
import { selectBar, selectBox } from "../select-bar.ts";
import { hms } from "./footage.ts";

export interface ProjectRow {
  id: string;
  title: string;
  /** cut | reaction | essay | idea */
  kind: string;
  pct: number;
  runtime_s: number | null;
  next_action: string | null;
  poster_r2_key: string | null;
  updated_at: number;
  /** Beats still wanting the user, for the state pill and the act bar. */
  needs: number;
  beats: number;
}

/** The three states a project can be in, with the design's own wording. */
const STATE: Record<string, [string, string]> = {
  needsyou: ["needs you", ACCENT.gold],
  ready: ["ready to render", ACCENT.green],
  idle: ["not started", "rgba(236,236,241,0.4)"],
};

const KIND: Record<string, [string, string]> = {
  essay: ["rgba(217,179,106,0.12)", ACCENT.gold],
  cut: ["rgba(94,201,143,0.12)", ACCENT.green],
  reaction: ["rgba(224,108,96,0.12)", "#E06C60"],
  idea: ["rgba(217,179,106,0.12)", ACCENT.gold],
};

function stateOf(p: ProjectRow): "needsyou" | "ready" | "idle" {
  if (!p.beats) return "idle";
  return p.needs > 0 ? "needsyou" : "ready";
}

/** Relative time, as the cards read it. */
export function touched(ms: number): string {
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

const kindLabel = (k: string) => k.charAt(0).toUpperCase() + k.slice(1);

function poster(key: string | null): string {
  return key
    ? `<img loading="lazy" src="/media/${esc(key)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block"/>`
    : "";
}

function runtimeBadge(p: ProjectRow): string {
  if (!p.runtime_s) return "";
  return `<span data-content style="position:absolute;right:8px;bottom:8px;font-size:${SIZE.pill};font-family:${FONT.mono};color:rgba(255,255,255,0.85);background:rgba(0,0,0,0.55);padding:2px 6px;border-radius:4px">${hms(p.runtime_s)}</span>`;
}

/** The wide card: what you were last in the middle of. */
function hero(p: ProjectRow): string {
  const [kindBg, kindColor] = KIND[p.kind] ?? KIND.cut;
  const cta = p.needs > 0 ? "Record" : "Render";

  return `<div style="margin-top:32px">
    <div style="font-size:${SIZE.body};font-weight:600;color:rgba(236,236,241,0.5);padding-left:2px">Pick up where you left off</div>
    <div data-item-row style="position:relative">
    <div style="position:absolute;right:10px;top:22px;z-index:5">${itemMenu("projects", p.id, p.title, "edit")}</div>
    <a href="/p/${esc(p.id)}/cut" style="margin-top:16px;display:flex;gap:18px;padding:16px;border-radius:11px;background:${C.surface};box-shadow:inset 0 0 0 1px rgba(217,179,106,0.22);flex-wrap:wrap;align-items:center">
      <div style="flex:none;width:min(220px,100%);aspect-ratio:16/9;border-radius:7px;overflow:hidden;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.06);background:#0B0B0E;position:relative">
        ${poster(p.poster_r2_key)}${runtimeBadge(p)}
      </div>
      <div style="flex:1 1 280px;min-width:min(260px,100%)">
        <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">
          <span data-content style="font-size:16.5px;font-weight:600;min-width:0;flex:0 1 auto">${esc(p.title)}</span>
          <span data-content style="font-size:${SIZE.meta};padding:2px 7px;border-radius:4px;background:${kindBg};color:${kindColor};flex:none;white-space:nowrap">${kindLabel(p.kind)}</span>
          <span data-content style="font-size:11.5px;color:${C.ink32};flex:none">${touched(p.updated_at)}</span>
        </div>
        <div data-content style="font-size:14px;font-weight:500;color:${C.ink};margin-top:8px">${esc(p.next_action ?? "")}</div>
        <div style="display:flex;gap:12px;align-items:center;margin-top:14px;flex-wrap:wrap">
          <span style="font-size:${SIZE.secondary};font-weight:600;padding:8px 18px;border-radius:${RADIUS.button};background:${C.ink};color:#131316;white-space:nowrap">${cta}</span>
          <!-- "Branch a version" and "Archive" were <span> elements here:
               not buttons, not wired, decoration in the shape of controls.
               Branching is not built, so it is gone rather than faked; the
               two verbs that ARE built live in the menu on the row. -->
        </div>
      </div>
    </a>
    </div>
  </div>`;
}

function card(p: ProjectRow): string {
  const [kindBg, kindColor] = KIND[p.kind] ?? KIND.cut;
  const [stateLabel, stateColor] = STATE[stateOf(p)];

  /* The menu sits OUTSIDE the anchor, floated over the poster. Nesting a
     button inside a link is invalid and makes the whole card behave oddly on
     a click. data-item-row lets the client take this card off the page when
     it is deleted, rather than reloading and throwing away the Undo. */
  return `<div data-item-row style="position:relative;display:flex">
  ${selectBox("projects", p.id)}
  <div style="position:absolute;right:6px;top:6px;z-index:5;background:rgba(11,11,14,0.66);border-radius:${RADIUS.button}">${itemMenu("projects", p.id, p.title, "edit")}</div>
  <a href="/p/${esc(p.id)}/cut" style="flex:1;min-width:0;border-radius:11px;background:${C.surface};overflow:hidden;display:flex;flex-direction:column">
    <div style="width:100%;aspect-ratio:16/9;background:#0B0B0E;position:relative">
      ${poster(p.poster_r2_key)}
      <span data-content style="position:absolute;left:8px;top:8px;display:flex;align-items:center;gap:5px;font-size:${SIZE.pill};font-weight:600;color:${stateColor};background:rgba(0,0,0,0.6);padding:3px 8px;border-radius:4px;white-space:nowrap"><span style="width:5px;height:5px;border-radius:50%;background:${stateColor}"></span>${stateLabel}</span>
      ${runtimeBadge(p)}
    </div>
    <div style="padding:13px 14px 14px;flex:1;display:flex;flex-direction:column;gap:6px">
      <div style="display:flex;align-items:center;gap:8px">
        <span data-content style="font-size:14px;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${esc(p.title)}</span>
        <span data-content style="font-size:${SIZE.pill};padding:2px 6px;border-radius:4px;background:${kindBg};color:${kindColor};flex:none;white-space:nowrap">${kindLabel(p.kind)}</span>
      </div>
      <div data-content style="font-size:${SIZE.secondary};color:rgba(236,236,241,0.55);line-height:1.5">${esc(p.next_action ?? "")}</div>
      <div data-content style="font-size:${SIZE.meta};color:rgba(236,236,241,0.28);margin-top:auto">${touched(p.updated_at)}</div>
    </div>
  </a>
  </div>`;
}

export function renderProjects(projects: ProjectRow[]): string {
  const head = `<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:20px;flex-wrap:wrap">
    <div>
      <span style="font-size:${SIZE.pageTitle};font-weight:600;letter-spacing:-0.02em">Projects</span>
      <div data-content style="font-size:${SIZE.body};color:rgba(236,236,241,0.42);margin-top:6px;max-width:600px">Everything you're building — a cut, a reaction, an essay. Clips and shorts aren't projects; those are material, and they live in Footage.</div>
    </div>
    <div style="flex:none;display:flex;align-items:center;gap:14px">
      <a href="/" style="font-size:${SIZE.body};font-weight:600;padding:9px 20px;border-radius:${RADIUS.button};background:${C.ink};color:#131316;white-space:nowrap">Start something</a>
    </div>
  </div>`;

  if (!projects.length) {
    return `${head}
    <div style="margin-top:24px;padding:24px;border-radius:${RADIUS.card};background:${C.surface};max-width:620px">
      <div data-content style="font-size:15.5px;font-weight:600">Nothing on the go</div>
      <div data-content style="font-size:${SIZE.body};color:${C.ink45};margin-top:6px;line-height:1.6">A project shows up here the moment you ask for a cut, a reaction, or an essay. Ask for clips instead and they'll go straight to Footage without one.</div>
      <div style="margin-top:16px;display:flex;gap:14px;align-items:center;flex-wrap:wrap">
        <a href="/" style="font-size:${SIZE.secondary};font-weight:600;padding:8px 16px;border-radius:${RADIUS.button};background:${C.ink};color:#131316">Start something</a>
        <a href="/editor" style="font-size:${SIZE.secondary};color:rgba(236,236,241,0.4)">or open a blank editor →</a>
      </div>
    </div>`;
  }

  return head + editList(projects);
}

/**
 * The edits themselves, with no page heading of their own.
 *
 * Split out because Footage carries this as a tab now. The nav is Home,
 * Editor, Footage — "all footage, clips, shorts, edits, videos, exports
 * whatever can be found on footage page" — and /projects was a fourth surface
 * you could only reach by knowing it was there. Footage is already
 * "everything you have"; an edit is something you have.
 */
export function editList(projects: ProjectRow[]): string {
  if (!projects.length) return "";
  /*
   * Most recently touched leads. The rest keep that order too — a project's
   * position should mean "when did I last work on this", not a rank the
   * product invented.
   */
  const [first, ...rest] = [...projects].sort((a, b) => b.updated_at - a.updated_at);

  return `${hero(first)}
  ${
    rest.length
      ? `<div style="margin-top:32px">
          <div style="font-size:${SIZE.body};font-weight:600;color:rgba(236,236,241,0.5);padding-left:2px">Everything else</div>
          <div style="margin-top:16px;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr));gap:8px">${rest.map(card).join("")}</div>
          ${selectBar("edit")}
        </div>`
      : ""
  }`;
}
