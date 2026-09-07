/**
 * A source, read.
 *
 * Phase 1's whole claim is that an hour of someone else's footage becomes
 * readable. This is where that is true: the full transcript, with word-level
 * timing behind every word, and honest state while it is still being read.
 *
 * The editor stages (Pick what stays, Script) are Phase 2 and land on
 * /p/:id/*. This view is the reading surface underneath them.
 */

import { C, ACCENT, FONT, RADIUS, SIZE } from "../tokens.ts";
import { esc } from "../shell.ts";
import { hms, type SourceRow } from "./footage.ts";
import { emptyState } from "./empty.ts";
import { iconPause, iconPlay } from "../icons.ts";
import { aspectOf } from "../../sources.ts";

export interface SegmentRow {
  idx: number;
  start_ms: number;
  end_ms: number;
  speaker: string | null;
  text: string;
  words: string | null;
}

/**
 * One transcript line: a mono timecode gutter and the text.
 *
 * Word timings ride along in `data-words` rather than wrapping every word in a
 * span. At 400 segments and thousands of words, a span each is a lot of DOM
 * for something nothing reads yet — Phase 2's Script mode, which needs
 * per-word hit targets, can expand a line lazily when it is actually edited.
 */
function line(s: SegmentRow): string {
  return `<div class="seg" data-idx="${s.idx}" data-start="${s.start_ms}" data-end="${s.end_ms}" data-words="${esc(s.words ?? "[]")}" style="display:flex;gap:14px;align-items:baseline;padding:7px 0">
    <span style="flex:none;width:52px;font-size:${SIZE.meta};font-family:${FONT.mono};color:rgba(236,236,241,0.3);font-variant-numeric:tabular-nums">${hms(s.start_ms / 1000)}</span>
    ${s.speaker ? `<span style="flex:none;font-size:${SIZE.meta};color:${ACCENT.cyan}">${esc(s.speaker)}</span>` : ""}
    <span data-content style="flex:1;font-size:${SIZE.body};line-height:1.7;color:rgba(236,236,241,0.85)">${esc(s.text)}</span>
  </div>`;
}

export interface SourceViewData {
  /*
   * More than a Footage card needs: this page PLAYS the footage, so it needs
   * the object key. Widened here rather than pushing r2_key onto SourceRow,
   * which every card in a grid would then have to carry.
   */
  source: SourceRow & { r2_key: string; proxy_r2_key?: string | null; width?: number | null; height?: number | null };
  segments: SegmentRow[];
  /** Live job for this source, when it is still being read. */
  job: { state: string; pct: number; stage_label: string | null; error: string | null } | null;
  /**
   * The edits made from this footage.
   *
   * The whole reason this page exists as a destination again. One source can
   * carry as many cuts as you like and none of them consume it — but that is
   * only believable if you can see them listed against it.
   */
  edits: Array<{ id: string; title: string; brief: string | null; cuts: string | null; updated_at: number }>;
}

/** Edits made from this footage, and the way to start another. */
function editsFrom(d: SourceViewData): string {
  if (d.source.transcript_state !== "ready") return "";

  const row = (e: SourceViewData["edits"][number]) => {
    /* How much has actually been done to it — the same question the intake
       asks, answered from the cut itself rather than a stored counter. */
    let struck = 0;
    try {
      struck = (JSON.parse(e.cuts ?? "[]") as unknown[]).length;
    } catch {
      struck = 0;
    }
    const meta = [e.brief?.trim() ? "asked for" : "unassisted", struck ? `${struck} cut${struck === 1 ? "" : "s"}` : "nothing cut yet"].join(" · ");
    return `<a href="/p/${esc(e.id)}/cut" style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:${RADIUS.card};background:${C.surface};flex-wrap:wrap">
      <span data-content style="flex:1 1 200px;min-width:0;font-size:${SIZE.body};font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(e.title)}</span>
      <span data-content style="flex:none;font-size:${SIZE.meta};color:${C.ink32};font-family:${FONT.mono}">${esc(meta)}</span>
    </a>`;
  };

  return `<div style="margin-top:28px">
    <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap">
      <span style="font-size:${SIZE.body};font-weight:600;color:${C.ink45}">Want anything else from this footage?</span>
      <a href="/sources/${esc(d.source.id)}/edit?fresh=1" style="margin-left:auto;font-size:${SIZE.secondary};font-weight:600;padding:7px 14px;border-radius:${RADIUS.button};background:${C.pill};color:${C.ink70};white-space:nowrap">New edit</a>
    </div>
    ${
      d.edits.length
        ? `<div style="margin-top:12px;display:flex;flex-direction:column;gap:6px">${d.edits.map(row).join("")}</div>`
        : `<div data-content style="margin-top:12px;padding:14px 16px;border-radius:${RADIUS.card};background:${C.surface};font-size:${SIZE.secondary};color:${C.ink45};line-height:1.6">Nothing cut from this yet. An edit never changes the footage — you can make as many as you like.</div>`
    }
  </div>`;
}

export function renderSource(d: SourceViewData): string {
  const { source: s, segments, job } = d;

  const words = segments.reduce((n, seg) => {
    try {
      return n + (JSON.parse(seg.words ?? "[]") as unknown[]).length;
    } catch {
      return n;
    }
  }, 0);

  const meta = [
    s.duration_s ? hms(s.duration_s) : null,
    segments.length ? `${segments.length} lines` : null,
    words ? `${words.toLocaleString()} words` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  /*
   * The actions belong up here, not nowhere.
   *
   * This page was a dead end: you clicked a video in Footage, read its
   * transcript, and had no way to do anything with it. Getting to the editor
   * meant knowing to go somewhere else entirely. Same three the design puts on
   * every source — Edit, Clip it, React to it.
   */
  const actions =
    s.transcript_state === "ready"
      ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:14px">
          <a href="/sources/${esc(s.id)}/edit" style="font-size:${SIZE.secondary};font-weight:600;padding:8px 16px;border-radius:${RADIUS.button};background:${C.ink};color:#131316">Edit</a>
          <a href="/clipping?source=${esc(s.id)}" style="font-size:${SIZE.secondary};font-weight:500;padding:8px 14px;border-radius:${RADIUS.button};background:${C.pill};color:${C.ink70}">Clip it</a>
          <button type="button" class="source-go" data-source="${esc(s.id)}" data-brief="React to it" style="font-size:${SIZE.secondary};font-weight:500;padding:8px 14px;border-radius:${RADIUS.button};background:${C.pill};color:${C.ink70};cursor:pointer;border:none;font-family:${FONT.ui}">React to it</button>
        </div>`
      : "";

  /* The footage, playable. This page is the source; not showing it was the
     clearest sign that it had stopped being a real destination.

     Our player, not Chrome's — the fourth and last instance, and the one
     nobody had opened. The check that found it exists because this kept
     happening. */
  const player = `<div style="max-width:520px;margin-top:18px">
    <video id="src-video" playsinline preload="metadata"${
      s.poster_r2_key ? ` poster="/media/${esc(s.poster_r2_key)}"` : ""
    } src="/media/${esc(s.proxy_r2_key || s.r2_key)}" style="width:100%;aspect-ratio:${aspectOf(s)};max-height:62vh;object-fit:contain;background:#000;border-radius:${RADIUS.card};display:block"></video>
    <div class="player" style="margin-top:8px;display:flex;align-items:center;gap:9px;padding:6px 8px;border-radius:${RADIUS.card};background:${C.surface}">
      <button class="pl-play" aria-label="Play" style="flex:none;display:grid;place-items:center;width:26px;height:26px;border-radius:${RADIUS.button};background:transparent;border:none;cursor:pointer">
        <span class="pl-i-play" style="display:grid">${iconPlay(12, C.ink)}</span>
        <span class="pl-i-pause" hidden>${iconPause(12, C.ink)}</span>
      </button>
      <span class="pl-now" data-content style="flex:none;font-size:${SIZE.meta};font-family:${FONT.mono};color:${C.ink45};font-variant-numeric:tabular-nums">0:00</span>
      <div class="pl-track" role="slider" tabindex="0" aria-label="Position" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"
        style="position:relative;flex:1 1 60px;min-width:min(50px,100%);height:16px;cursor:pointer;touch-action:none">
        <div style="position:absolute;left:0;right:0;top:7px;height:2px;background:rgba(255,255,255,0.10)"></div>
        <div class="pl-buffer" style="position:absolute;left:0;top:7px;width:0;height:2px;background:rgba(255,255,255,0.18)"></div>
        <div class="pl-played" style="position:absolute;left:0;top:7px;width:0;height:2px;background:${C.ink}"></div>
        <div class="pl-knob" style="position:absolute;left:0;top:4px;width:8px;height:8px;margin-left:-4px;border-radius:50%;background:${C.ink}"></div>
      </div>
      <span class="pl-dur" data-content style="flex:none;font-size:${SIZE.meta};font-family:${FONT.mono};color:${C.ink45};font-variant-numeric:tabular-nums">${hms(0)}</span>
      <button class="pl-rate" aria-label="Speed" style="flex:none;padding:0 6px;background:transparent;border:none;color:${C.ink70};cursor:pointer;font-family:${FONT.ui};font-size:${SIZE.meta};font-weight:600"><span data-content>1×</span></button>
      <button class="pl-full" aria-label="Fullscreen" style="flex:none;padding:0 6px;background:transparent;border:none;color:${C.ink70};cursor:pointer;font-family:${FONT.ui};font-size:${SIZE.meta};font-weight:600">Full</button>
    </div>
  </div>`;

  const head = `<a href="/footage?tab=sources" style="font-size:${SIZE.secondary};color:${C.ink45}">← Footage</a>
  <div style="font-size:${SIZE.pageTitle};font-weight:600;letter-spacing:-0.022em;line-height:1.2;margin-top:14px" data-content>${esc(s.title)}</div>
  <div style="font-size:${SIZE.meta};color:${C.ink45};margin-top:6px;font-family:${FONT.mono}" data-content>${esc(meta || s.filename || "")}</div>
  ${actions}`;

  // Still reading: name the stage. No percentage during transcription — it is
  // a single atomic call, and a bar moving on a timer would be a lie.
  if (s.transcript_state === "running" || s.transcript_state === "pending") {
    const stage = job?.stage_label ?? "reading it";
    return `${head}
    <div id="reading" data-source="${esc(s.id)}" style="margin-top:24px;display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:${RADIUS.card};background:#141418;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.04)">
      <span style="width:6px;height:6px;border-radius:50%;background:${ACCENT.gold};animation:blip 1.6s ease-in-out infinite;flex:none"></span>
      <!-- The live stage from the job row — "reading it", "reading it — part 3
           of 7", "writing down what it heard". Data, not fixed chrome, and the
           editor's own progress strip already marks its copy of this. -->
      <span data-content style="flex:1;font-size:${SIZE.secondary};color:rgba(236,236,241,0.55)">${esc(stage)}</span>
    </div>`;
  }

  if (s.transcript_state === "failed") {
    return `${head}
    <div style="margin-top:24px;padding:16px 18px;border-radius:${RADIUS.card};background:${C.surface};box-shadow:inset 0 0 0 1px rgba(224,106,106,0.24)">
      <!-- The job's own recorded reason, which is more use than a generic
           line and is data rather than chrome. "Failed" is the prototype's
           word for the state; the sentence under it is what actually went
           wrong. -->
      <div data-content style="font-size:${SIZE.body};color:${ACCENT.red}">${esc(job?.error ?? "Failed")}</div>
      <form method="POST" action="/api/sources/${esc(s.id)}/retry" style="margin-top:12px">
        <button type="submit" style="font-size:${SIZE.secondary};font-weight:600;padding:7px 14px;border-radius:${RADIUS.button};background:${C.ink};color:#131316;border:none;cursor:pointer;font-family:${FONT.ui}">Retry</button>
      </form>
    </div>`;
  }

  if (!segments.length) return head + player + emptyState("Nothing kept yet — add a clip back.");

  return `${head}
  ${player}
  ${editsFrom(d)}
  <!-- The transcript needs no heading: it is the obvious remaining thing on a
       page about one video, and the section above it is already labelled. -->
  <div style="margin-top:28px">${segments.map(line).join("")}</div>`;
}
