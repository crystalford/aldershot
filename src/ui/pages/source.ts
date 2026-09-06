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
  source: SourceRow;
  segments: SegmentRow[];
  /** Live job for this source, when it is still being read. */
  job: { state: string; pct: number; stage_label: string | null; error: string | null } | null;
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
          <button type="button" class="source-go" data-source="${esc(s.id)}" data-brief="" style="font-size:${SIZE.secondary};font-weight:600;padding:8px 16px;border-radius:${RADIUS.button};background:${C.ink};color:#131316;cursor:pointer;border:none;font-family:${FONT.ui}">Edit</button>
          <a href="/clipping?source=${esc(s.id)}" style="font-size:${SIZE.secondary};font-weight:500;padding:8px 14px;border-radius:${RADIUS.button};background:${C.pill};color:${C.ink70}">Clip it</a>
          <button type="button" class="source-go" data-source="${esc(s.id)}" data-brief="React to it" style="font-size:${SIZE.secondary};font-weight:500;padding:8px 14px;border-radius:${RADIUS.button};background:${C.pill};color:${C.ink70};cursor:pointer;border:none;font-family:${FONT.ui}">React to it</button>
        </div>`
      : "";

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
      <span style="flex:1;font-size:${SIZE.secondary};color:rgba(236,236,241,0.55)">${esc(stage)}</span>
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

  if (!segments.length) return head + emptyState("Nothing kept yet — add a clip back.");

  return `${head}
  <div style="margin-top:24px">${segments.map(line).join("")}</div>`;
}
