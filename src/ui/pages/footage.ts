/**
 * Footage — the library. Three tabs: Moments (clips), Threads (clips grouped
 * by meaning), Sources (the long videos, clickable straight into the editor).
 *
 * Phase 1 fills Sources, because that is what ingest produces. Moments and
 * Threads need the score pass (Phase 2) and embeddings (Phase 5); until then
 * they show their real empty states rather than a fabricated preview.
 */

import { C, ACCENT, FONT, RADIUS, SIZE } from "../tokens.ts";
import { esc } from "../shell.ts";
import { emptyState, pageHeading } from "./empty.ts";
import { iconSearch } from "../icons.ts";

export type FootTab = "moments" | "threads" | "sources";

export interface SourceRow {
  id: string;
  title: string;
  filename: string | null;
  duration_s: number | null;
  transcript_state: "pending" | "running" | "ready" | "failed";
  poster_r2_key: string | null;
  created_at: number;
}

/**
 * A POSITION in the source: zero-padded, "03:38" / "1:02:47".
 *
 * Distinct from hms() on purpose. The prototype pads positions but not
 * durations — "03:42 in the original" against "0:42" for how long a clip
 * runs — and mixing them makes columns of timecodes fail to line up.
 */
export function tc(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${String(m).padStart(2, "0")}:${sec}`;
}

/** A DURATION: m:ss, or h:mm:ss past an hour. Unpadded. */
export function hms(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

/**
 * The state a source is in, in the words the design uses, with the accent that
 * means that thing. Never a raw enum — "pending" is not a word the user said.
 */
function stateChip(state: SourceRow["transcript_state"]): string {
  const map: Record<SourceRow["transcript_state"], [string, string]> = {
    pending: ["Queued", C.ink45],
    running: ["Reading", ACCENT.gold],
    ready: ["Ready", ACCENT.green],
    failed: ["Couldn't read it", ACCENT.red],
  };
  const [label, color] = map[state];
  return `<span style="flex:none;font-size:${SIZE.pill};font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:${color}">${esc(label)}</span>`;
}

function tabs(active: FootTab): string {
  const items: Array<[FootTab, string]> = [
    ["moments", "Moments"],
    ["threads", "Threads"],
    ["sources", "Sources"],
  ];
  return `<div style="display:flex;gap:20px;margin-top:22px;border-bottom:1px solid ${C.hairline}">${items
    .map(
      ([id, label]) =>
        `<a href="/footage?tab=${id}" style="padding-bottom:10px;font-size:${SIZE.body};font-weight:500;color:${
          id === active ? C.ink : C.ink45
        };border-bottom:2px solid ${id === active ? C.ink : "transparent"};margin-bottom:-1px">${label}</a>`,
    )
    .join("")}</div>`;
}

function sourceRow(s: SourceRow): string {
  const meta = [
    s.duration_s ? hms(s.duration_s) : null,
    new Date(s.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
  ]
    .filter(Boolean)
    .join(" · ");

  return `<a href="/sources/${esc(s.id)}" style="display:flex;align-items:center;gap:14px;padding:14px 16px;border-radius:${RADIUS.card};background:${C.surface}">
    <div style="flex:none;width:76px;aspect-ratio:16/9;border-radius:${RADIUS.button};overflow:hidden;background:#0B0B0E;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.06)">${
      s.poster_r2_key
        ? `<img loading="lazy" src="/media/${esc(s.poster_r2_key)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block"/>`
        : ""
    }</div>
    <div style="flex:1;min-width:0">
      <div data-content style="font-size:${SIZE.body};font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.title)}</div>
      <div data-content style="font-size:${SIZE.meta};color:${C.ink45};margin-top:3px;font-family:${FONT.mono}">${esc(meta)}</div>
    </div>
    ${stateChip(s.transcript_state)}
  </a>`;
}

export interface MomentRow {
  id: string;
  start_ms: number;
  end_ms: number;
  quote: string;
  why: string | null;
  origin: string;
  used_count: number;
  frame_r2_key: string;
  source_title: string;
  thread_name: string | null;
}

export interface ThreadRow {
  id: string;
  name: string;
  summary: string | null;
  clip_count: number;
  sample: string | null;
}

export type SearchMode = "meaning" | "exact";

/**
 * Two ways to search the library (01-PRODUCT.md §Footage). They are genuinely
 * different questions, so they get different prompts: meaning describes the
 * kind of clip, exact searches the words that were said.
 */
function searchBox(tab: FootTab, mode: SearchMode, q: string): string {
  const placeholder =
    mode === "meaning"
      ? "Describe the kind of clip — “when he admits something he shouldn't”"
      : "Search the words that were said…";

  const toggle = (m: SearchMode, label: string) =>
    `<a href="/footage?tab=${tab}&mode=${m}${q ? `&q=${encodeURIComponent(q)}` : ""}" style="font-size:${SIZE.meta};padding:4px 9px;border-radius:${RADIUS.button};background:${
      m === mode ? C.active : "transparent"
    };color:${m === mode ? C.ink : C.ink45};white-space:nowrap">${label}</a>`;

  return `<form method="GET" action="/footage" style="margin-top:18px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
    <input type="hidden" name="tab" value="${tab}"/>
    <input type="hidden" name="mode" value="${mode}"/>
    <div style="flex:1 1 320px;min-width:min(280px,100%);display:flex;align-items:center;gap:9px;background:${C.surface};border-radius:${RADIUS.input};padding:8px 12px">
      ${iconSearch({ size: 14, stroke: "rgba(236,236,241,0.4)" })}
      <input name="q" value="${esc(q)}" placeholder="${esc(placeholder)}" style="flex:1;background:transparent;border:none;outline:none;color:${C.ink};font-size:13px;font-family:${FONT.ui}"/>
    </div>
    <div style="display:flex;gap:4px;flex:none">${toggle("meaning", "meaning")}${toggle("exact", "exact")}</div>
  </form>`;
}

function momentCard(m: MomentRow): string {
  const frame = m.frame_r2_key
    ? `<img loading="lazy" src="/media/${esc(m.frame_r2_key)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block"/>`
    : "";
  const used = m.used_count > 0 ? `used in ${m.used_count} ${m.used_count === 1 ? "essay" : "essays"}` : null;

  return `<div style="display:flex;flex-direction:column;border-radius:${RADIUS.card};background:${C.surface};overflow:hidden">
    <div style="position:relative;aspect-ratio:16/9;background:#0B0B0E">
      ${frame}
      <span data-content style="position:absolute;right:3px;bottom:3px;font-size:${SIZE.meta};font-family:${FONT.mono};color:rgba(255,255,255,0.8);background:rgba(0,0,0,0.55);padding:1px 5px;border-radius:3px">${hms((m.end_ms - m.start_ms) / 1000)}</span>
    </div>
    <div style="padding:12px 14px;display:flex;flex-direction:column;gap:5px;flex:1">
      ${m.thread_name ? `<div data-content style="font-size:${SIZE.pill};font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:${ACCENT.cyan}">${esc(m.thread_name)}</div>` : ""}
      <div data-content style="font-size:${SIZE.secondary};line-height:1.5;color:${C.ink}">${esc(m.quote.slice(0, 120))}</div>
      <div data-content style="font-size:${SIZE.meta};color:${C.ink45};margin-top:auto;padding-top:4px">${esc(m.source_title)} · ${hms(m.start_ms / 1000)}${used ? ` · ${used}` : ""}</div>
    </div>
  </div>`;
}

function threadCard(t: ThreadRow): string {
  return `<div style="padding:16px 18px;border-radius:${RADIUS.card};background:${C.surface}">
    <div style="display:flex;align-items:baseline;gap:10px">
      <div data-content style="font-size:${SIZE.body};font-weight:600">${esc(t.name)}</div>
      <span data-content style="font-size:${SIZE.meta};color:${C.ink45};font-family:${FONT.mono}">${t.clip_count}</span>
    </div>
    ${t.summary ? `<div data-content style="font-size:${SIZE.secondary};color:${C.ink45};margin-top:5px;line-height:1.5">${esc(t.summary)}</div>` : ""}
    ${t.sample ? `<div data-content style="font-size:${SIZE.secondary};color:${C.ink70};margin-top:8px">“${esc(t.sample.slice(0, 100))}”</div>` : ""}
  </div>`;
}

export interface FootageData {
  tab: FootTab;
  sources: SourceRow[];
  moments: MomentRow[];
  threads: ThreadRow[];
  mode: SearchMode;
  q: string;
  /** True when meaning search is asked for but the index is not available. */
  meaningUnavailable: boolean;
}

export function renderFootage(tab: FootTab, sources: SourceRow[]): string {
  const head =
    pageHeading("Footage", "Every video you've added. Search by topic, upload new ones, or ask what's in there.") +
    tabs(tab);

  if (tab === "sources") {
    if (!sources.length) return head + emptyState("Nothing kept yet — add a clip back.");
    return (
      head +
      `<div style="margin-top:20px;display:flex;flex-direction:column;gap:6px">${sources.map(sourceRow).join("")}</div>`
    );
  }

  // Moments and Threads are Phase 2/5. Their real empty state is the honest
  // thing to show — not a preview of data that does not exist.
  return head + emptyState("Nothing kept yet — add a clip back.");
}

/** The full surface, with Moments and Threads filled from the library. */
export function renderFootageFull(d: FootageData): string {
  const head =
    pageHeading("Footage", "Every video you've added. Search by topic, upload new ones, or ask what's in there.") +
    tabs(d.tab);

  if (d.tab === "sources") {
    if (!d.sources.length) return head + emptyState("Nothing kept yet — add a clip back.");
    return head + `<div style="margin-top:20px;display:flex;flex-direction:column;gap:6px">${d.sources.map(sourceRow).join("")}</div>`;
  }

  if (d.tab === "threads") {
    if (!d.threads.length) return head + emptyState("No footage yet");
    return (
      head +
      `<div style="margin-top:20px;font-size:${SIZE.secondary};color:${C.ink45}">Threads — it sorts, you don't</div>
       <div style="margin-top:12px;display:flex;flex-direction:column;gap:8px">${d.threads.map(threadCard).join("")}</div>`
    );
  }

  // Moments.
  const search = searchBox(d.tab, d.mode, d.q);

  // Meaning search needs the embeddings index. When it is unavailable, say so
  // and fall back to exact rather than silently returning worse results and
  // letting the user think the library is empty.
  const notice = d.meaningUnavailable
    ? `<div style="margin-top:12px;padding:12px 14px;border-radius:${RADIUS.card};background:${C.surface};font-size:${SIZE.secondary};color:${C.ink45}">Searching the words that were said. Meaning search isn't switched on yet.</div>`
    : "";

  if (!d.moments.length) {
    return head + search + notice + emptyState(d.q ? "No footage yet" : "Nothing kept yet — add a clip back.");
  }

  return (
    head +
    search +
    notice +
    `<div style="margin-top:18px;display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px">${d.moments.map(momentCard).join("")}</div>`
  );
}
