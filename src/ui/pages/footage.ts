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

export type FootTab = "moments" | "threads" | "sources" | "find";

export interface SourceRow {
  id: string;
  title: string;
  filename: string | null;
  duration_s: number | null;
  transcript_state: "pending" | "running" | "ready" | "failed";
  poster_r2_key: string | null;
  created_at: number;
  /** Live read progress, so the row shows a bar rather than a bare label. */
  pct?: number;
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
    // The prototype's own word for this state, and its own red.
    failed: ["Failed", ACCENT.red],
  };
  const [label, color] = map[state];
  return `<span style="flex:none;font-size:${SIZE.pill};font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:${color}">${esc(label)}</span>`;
}

/*
 * The tabs are named for what is behind them, and carry their counts:
 * "Clips · 23". They were "Moments / Threads / Sources", which is the
 * vocabulary of the data model rather than the product's — and the Find tab
 * was missing altogether. A count of null renders bare, which is why Find has
 * no number.
 */
function tabs(active: FootTab, counts: Partial<Record<FootTab, number>>): string {
  const items: Array<[FootTab, string]> = [
    ["moments", "Clips"],
    ["threads", "Threads"],
    ["sources", "Videos"],
    ["find", "Find"],
  ];
  return `<div style="margin-top:18px;display:flex;gap:4px;border-bottom:1px solid ${C.hairline}">${items
    .map(([id, label]) => {
      const n = counts[id];
      return `<a href="/footage?tab=${id}" style="font-size:${SIZE.body};font-weight:500;padding:9px 14px;color:${
        id === active ? C.ink : C.ink45
      };border-bottom:2px solid ${id === active ? C.ink : "transparent"};margin-bottom:-1px;white-space:nowrap">${label}${n == null ? "" : ` · ${n}`}</a>`;
    })
    .join("")}</div>`;
}

/**
 * The thread filter chips above the clip grid — a coloured dot, the thread's
 * name, and its count in mono. "Everything" leads and is selected by default.
 * The dot colour comes from the thread's position, so a thread keeps the same
 * colour everywhere it appears.
 */
const THREAD_DOTS = [ACCENT.gold, ACCENT.violet, ACCENT.green, ACCENT.cyan, ACCENT.red];

function threadChips(threads: ThreadRow[], total: number, active: string | null): string {
  const chip = (name: string, count: number, dot: string, href: string, on: boolean) =>
    `<a href="${href}" style="display:flex;align-items:center;gap:7px;font-size:${SIZE.secondary};padding:7px 13px;border-radius:${RADIUS.button};background:${on ? C.active : C.pill};color:${on ? C.ink : C.ink70};font-weight:500;white-space:nowrap">
      <span style="width:6px;height:6px;border-radius:50%;background:${dot}"></span>${esc(name)} <span data-content style="color:${C.ink32};font-family:${FONT.mono};font-size:${SIZE.meta}">${count}</span>
    </a>`;

  return `<div style="margin-top:24px;display:flex;gap:6px;flex-wrap:wrap">
    ${chip("Everything", total, C.ink45, "/footage?tab=moments", !active)}
    ${threads
      .map((t, i) =>
        chip(t.name, t.clip_count, THREAD_DOTS[i % THREAD_DOTS.length], `/footage?tab=moments&thread=${encodeURIComponent(t.id)}`, active === t.id),
      )
      .join("")}
  </div>`;
}

/**
 * One video in Footage.
 *
 * A CARD, not a row.
 *
 * Footage is a library of videos, and it was rendering as a list of text rows
 * with three buttons on the end of each — 76px of poster and everything else
 * words. Seven videos meant twenty-eight click targets, which is what the
 * owner meant by "it's a nightmare to use". It also made Footage look exactly
 * like Home, Editor and Clipping, which are also a title over a stack of rows:
 * four surfaces that hold four different things and looked like one thing.
 *
 * A library of video looks like video. The poster is the card, the title sits
 * under it, and the whole card opens the editor — so the primary action needs
 * no button at all. "Edit" was dropped for exactly that reason: it duplicated
 * clicking the card. The two that remain are different jobs, not the same one
 * again, and they sit quietly beneath.
 *
 * While it is still being read the card shows real progress instead, since
 * none of those actions can work yet.
 */
function sourceCard(s: SourceRow): string {
  /* The duration is stamped on the poster, so repeating it here printed
     "0:20 · test · 0:20 · 30 Aug" across every card. */
  const meta = new Date(s.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  const ready = s.transcript_state === "ready";
  const working = s.transcript_state === "running" || s.transcript_state === "pending";

  const poster = s.poster_r2_key
    ? `<img loading="lazy" src="/media/${esc(s.poster_r2_key)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block"/>`
    : "";

  /* The duration rides on the poster the way it does on every video service,
     which is one fewer line of text under the card and reads faster. */
  const stamp = s.duration_s
    ? `<span style="position:absolute;right:6px;bottom:6px;font-size:${SIZE.meta};font-family:${FONT.mono};background:rgba(0,0,0,.66);color:${C.ink};border-radius:3px;padding:1px 5px">${hms(s.duration_s)}</span>`
    : "";

  /* Not ready: the card says so over its own poster rather than beside it, so
     an unusable card reads as unusable at a glance. */
  const veil = ready
    ? ""
    : `<div style="position:absolute;inset:0;background:rgba(11,11,14,0.72);display:flex;flex-direction:column;justify-content:flex-end;gap:8px;padding:10px">
        ${
          working && s.pct
            ? `<div style="height:3px;border-radius:99px;background:#26262C;overflow:hidden"><div style="width:${Math.max(2, s.pct)}%;height:100%;background:${ACCENT.green};border-radius:99px"></div></div>`
            : `<div style="align-self:flex-start">${stateChip(s.transcript_state)}</div>`
        }
      </div>`;

  const cardStyle = `display:block;position:relative;width:100%;aspect-ratio:16/9;border-radius:${RADIUS.card};overflow:hidden;background:#0B0B0E;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.06)`;

  const art = `<div style="${cardStyle}">${poster}${ready ? stamp : ""}${veil}</div>`;

  /* Poster AND title in one link. They were separate, so the title — which is
     what people actually aim at — was not clickable. */
  const label = `<div style="min-width:0;margin-top:9px">
      <div data-content style="font-size:${SIZE.secondary};font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.title)}</div>
      <div data-content style="font-size:${SIZE.meta};color:${C.ink45};margin-top:2px;font-family:${FONT.mono}">${esc(meta)}</div>
    </div>`;

  return `<div style="display:flex;flex-direction:column;gap:9px">
    ${
      ready
        ? `<a href="/sources/${esc(s.id)}" style="display:block;color:${C.ink}"><div style="${cardStyle}">${poster}${stamp}</div>${label}</a>`
        : art + label
    }
    ${
      ready
        ? `<div style="display:flex;gap:6px;flex-wrap:wrap">
            <a href="/clipping?source=${esc(s.id)}" style="font-size:${SIZE.meta};font-weight:500;padding:5px 10px;border-radius:${RADIUS.button};background:${C.pill};color:${C.ink70};white-space:nowrap">Clip it</a>
            <button type="button" class="source-go" data-source="${esc(s.id)}" data-brief="React to it" style="font-size:${SIZE.meta};font-weight:500;padding:5px 10px;border-radius:${RADIUS.button};background:${C.pill};color:${C.ink70};cursor:pointer;white-space:nowrap;border:none;font-family:${FONT.ui}">React to it</button>
          </div>`
        : ""
    }
  </div>`;
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
  /*
   * One placeholder, not two. The prototype asks the same question either way
   * — the mode chips below say how it will be answered — and swapping the
   * prompt on mode change made the field feel like two different controls.
   */
  const placeholder = "Search clips or ask — “every contradiction” · “studio visuals”";

  /* Chips, below the field: "By meaning" / "Exact words". */
  const chip = (m: SearchMode, label: string) =>
    `<a href="/footage?tab=${tab}&mode=${m}${q ? `&q=${encodeURIComponent(q)}` : ""}" style="font-size:${SIZE.secondary};font-weight:500;padding:5px 11px;border-radius:${RADIUS.button};background:${
      m === mode ? C.active : C.pill
    };color:${m === mode ? C.ink : "rgba(236,236,241,0.5)"};white-space:nowrap">${label}</a>`;

  return `<form method="GET" action="/footage">
    <input type="hidden" name="tab" value="${tab}"/>
    <input type="hidden" name="mode" value="${mode}"/>
    <div style="margin-top:18px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">
      <div style="flex:1 1 280px;min-width:min(260px,100%)">
        <div style="display:flex;align-items:center;gap:8px;background:${C.raised};border-radius:${RADIUS.card};padding:9px 13px;box-shadow:0 0 0 1px ${C.hairline}">
          ${iconSearch({ size: 14, stroke: "rgba(236,236,241,0.4)" })}
          <input name="q" value="${esc(q)}" placeholder="${esc(placeholder)}" style="flex:1;min-width:0;background:transparent;border:none;outline:none;color:${C.ink};font-size:${SIZE.body};font-family:${FONT.ui}"/>
        </div>
      </div>
      <label style="flex:none;font-size:13px;font-weight:600;padding:9px 16px;border-radius:${RADIUS.button};background:${C.ink};color:#131316;cursor:pointer;white-space:nowrap">Upload<input type="file" accept="video/*" multiple id="footageUpload" style="display:none"/></label>
    </div>
    <div style="display:flex;gap:5px;margin-top:8px;flex-wrap:wrap">${chip("meaning", "By meaning")}${chip("exact", "Exact words")}</div>
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
  /** The thread being filtered to, or null for "Everything". */
  thread: string | null;
}

export function renderFootage(tab: FootTab, sources: SourceRow[]): string {
  const head =
    pageHeading("Footage", "Every video you've added. Search by topic, upload new ones, or ask what's in there.") +
    searchBox(tab, "meaning", "") +
    tabs(tab, { sources: sources.length });

  if (tab === "sources") {
    /* "Nothing kept yet — add a clip back" is the prototype's line for an
       empty CLIPS list, and it was being shown on the Videos tab — telling
       someone with no videos at all to add back a clip they never had. The
       Videos tab is a departure from the prototype (which opens on Clips), so
       its empty state is a string the prototype does not have. Signed off in
       scripts/check-fidelity.cjs. */
    if (!sources.length) return head + emptyState("Nothing here yet — upload a video and it starts reading.");
    return (
      head +
      `<div id="footage-grid" style="margin-top:20px;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(200px,100%),1fr));gap:22px 16px">${sources.map(sourceCard).join("")}</div>`
    );
  }

  // Moments and Threads are Phase 2/5. Their real empty state is the honest
  // thing to show — not a preview of data that does not exist.
  return head + emptyState("Nothing kept yet — add a clip back.");
}

/** The full surface, with Moments and Threads filled from the library. */
/**
 * Find — a moment in a video you don't have yet. Reads a URL's public
 * captions, text only, and hands back timestamps you can grab yourself.
 *
 * The panel is built to the design; the caption reader behind it is not wired
 * up yet, so the button says so rather than failing silently. Same honesty as
 * the meaning-search notice.
 */
function findPanel(): string {
  return `<div style="margin-top:24px;padding:20px;border-radius:11px;background:#141418;box-shadow:inset 0 0 0 1px rgba(94,184,201,0.18)">
    <div data-content style="font-size:${SIZE.body};font-weight:600">Find a moment in a video you don't have yet</div>
    <div data-content style="font-size:${SIZE.secondary};color:${C.ink45};margin-top:5px;line-height:1.55;max-width:640px">Paste a link and we read its public captions — text only, nothing downloaded. Search it in plain language and you get exact timestamps back. Grab those segments yourself, drop them in Footage, and they behave like everything else here.</div>
    <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
      <input placeholder="https://www.youtube.com/watch?v=…" disabled style="flex:1 1 260px;min-width:min(240px,100%);background:#101014;border:none;outline:none;color:${C.ink};font-size:${SIZE.secondary};font-family:${FONT.mono};padding:10px 12px;border-radius:6px"/>
      <button type="button" disabled style="font-size:${SIZE.secondary};font-weight:600;padding:9px 16px;border-radius:${RADIUS.button};background:${C.pill};color:${C.ink45};flex:none;white-space:nowrap;border:none;font-family:${FONT.ui}">Read the captions</button>
    </div>
    <div style="margin-top:12px;font-size:${SIZE.secondary};color:${C.ink45}">Reading captions from a link isn't switched on yet.</div>
  </div>`;
}

export function renderFootageFull(d: FootageData): string {
  /*
   * Order matters and was wrong: the search field and Upload sit directly
   * under the subtitle, ABOVE the tabs, because they act on the whole library
   * rather than on the tab you happen to be looking at. Built below the tabs,
   * search read as a filter for one list.
   */
  const head =
    pageHeading("Footage", "Every video you've added. Search by topic, upload new ones, or ask what's in there.") +
    searchBox(d.tab, d.mode, d.q) +
    tabs(d.tab, { moments: d.moments.length, threads: d.threads.length, sources: d.sources.length });

  if (d.tab === "find") return head + findPanel();

  if (d.tab === "sources") {
    if (!d.sources.length) return head + emptyState("Nothing kept yet — add a clip back.");
    return head + `<div id="footage-grid" style="margin-top:20px;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(200px,100%),1fr));gap:22px 16px">${d.sources.map(sourceCard).join("")}</div>`;
  }

  if (d.tab === "threads") {
    if (!d.threads.length) return head + emptyState("No footage yet");
    return (
      head +
      `<div style="margin-top:20px;font-size:${SIZE.secondary};color:${C.ink45}">Threads — it sorts, you don't</div>
       <div style="margin-top:12px;display:flex;flex-direction:column;gap:8px">${d.threads.map(threadCard).join("")}</div>`
    );
  }

  // Meaning search needs the embeddings index. When it is unavailable, say so
  // and fall back to exact rather than silently returning worse results and
  // letting the user think the library is empty.
  const notice = d.meaningUnavailable
    ? `<div style="margin-top:12px;padding:12px 14px;border-radius:${RADIUS.card};background:${C.surface};font-size:${SIZE.secondary};color:${C.ink45}">Searching the words that were said. Meaning search isn't switched on yet.</div>`
    : "";

  const chips = d.threads.length ? threadChips(d.threads, d.moments.length, d.thread) : "";

  if (!d.moments.length) {
    return head + chips + notice + emptyState(d.q ? "No footage yet" : "Nothing kept yet — add a clip back.");
  }

  /* The grid's heading names the filter: the thread's name, or "All clips". */
  const heading = d.thread ? (d.threads.find((t) => t.id === d.thread)?.name ?? "All clips") : "All clips";

  return (
    head +
    chips +
    notice +
    `<div data-content style="margin-top:26px;font-size:${SIZE.body};font-weight:600;color:${C.ink45}">${esc(heading)}</div>
     <div style="margin-top:14px;display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px">${d.moments.map(momentCard).join("")}</div>`
  );
}
