/**
 * Footage — the library. Three tabs: Moments (clips), Threads (clips grouped
 * by meaning), Sources (the long videos, clickable straight into the editor).
 *
 * Phase 1 fills Sources, because that is what ingest produces. Moments and
 * Threads need the score pass (Phase 2) and embeddings (Phase 5); until then
 * they show their real empty states rather than a fabricated preview.
 */

import { C, ACCENT, FONT, RADIUS, SIZE } from "../tokens";
import { esc } from "../shell";
import { emptyState, pageHeading } from "./empty";

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

/** m:ss, or h:mm:ss past an hour. Mono, like every other number in the design. */
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
      <div style="font-size:${SIZE.body};font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.title)}</div>
      <div style="font-size:${SIZE.meta};color:${C.ink45};margin-top:3px;font-family:${FONT.mono}">${esc(meta)}</div>
    </div>
    ${stateChip(s.transcript_state)}
  </a>`;
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
