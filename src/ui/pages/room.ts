/**
 * THE ROOM. One surface, two states.
 *
 * Home and the Editor were two pages over the same object; One Take folds
 * them into one room with no project open and a project open
 * (`docs/handoff/02-SCREENS.md`). This is the no-project state — what used to
 * be Home, Footage and Projects, which were three pages describing one
 * library.
 *
 * THREE COLUMNS. Direction on the left at 360: what you can MAKE, and the
 * conversation under it. The thing itself in the centre: your footage, with
 * the archive summary, search across every transcript, and Videos ·
 * Highlights · Projects. The player on the right at 300 — only with a project
 * open, so it is not here yet.
 *
 * WHAT IS DELIBERATELY ABSENT. Scout, the podcast import and the storage
 * connections are drawn in the prototype and are not built, so they are not
 * rendered: the conventions check fails a permanently disabled control, and
 * it is right to. A verb that would open something real is here; one that
 * would apologise is not.
 */

import { ACCENT, C, FONT, RADIUS, SIZE, accentBg } from "../tokens.ts";
import { esc } from "../shell.ts";

export type RoomTab = "videos" | "highlights" | "projects";

export interface RoomData {
  tab: RoomTab;
  /** What was searched for. */
  q: string;
  /** True when meaning search was asked for and could not answer. */
  meaningUnavailable: boolean;
  /** Every video read, newest first. */
  sources: Array<{
    id: string;
    title: string;
    poster_r2_key: string | null;
    transcript_state: string;
    duration_s: number | null;
    clips: number;
  }>;
  moments: Array<{
    id: string;
    quote: string;
    frame_r2_key: string;
    source_title: string;
    thread_name: string | null;
  }>;
  projects: Array<{ id: string; title: string; kind: string; updated_at: number }>;
  /** Totals for the summary line, counted rather than estimated. */
  counts: { sources: number; moments: number; threads: number };
}

const VERBS: Array<{ tag: string; accent: keyof typeof ACCENT; name: string; what: string; href: string }> = [
  {
    tag: "CUT",
    accent: "green",
    name: "Cut — tighten a recording",
    what: "your footage · the rules do the cutting",
    href: "/?make=cut",
  },
  {
    tag: "SHORTS",
    accent: "cyan",
    name: "Shorts — clips that stand alone",
    what: "Strong · Worth a look · Long shot, with reasons",
    href: "/?make=shorts",
  },
  {
    tag: "ESSAY",
    accent: "violet",
    name: "Essay — a video that argues something",
    what: "a thesis, your footage, or both · the plan first",
    href: "/?make=essay",
  },
  {
    tag: "REACT",
    accent: "red",
    name: "React — answer someone else's video",
    what: "a link, a file, or Scout finds it",
    href: "/?make=react",
  },
];

const GROW: Array<{ tag: string; name: string; what: string; href: string }> = [
  {
    tag: "STORY",
    name: "Story — what happened, in order",
    what: "organised by time · the day on screen at each change",
    href: "/?make=story",
  },
  {
    tag: "SUPERCUT",
    name: "Supercut — every time",
    what: "a phrase · every moment that matches, nothing else",
    href: "/?make=supercut",
  },
];

const label = (text: string) =>
  `<div style="font-size:10.5px;font-weight:600;letter-spacing:.09em;color:${C.ink45}">${text}</div>`;

function verbCard(v: { tag: string; name: string; what: string; href: string }, accent?: keyof typeof ACCENT): string {
  const bg = accent ? accentBg(ACCENT[accent]) : "rgba(236,236,241,0.08)";
  const fg = accent ? ACCENT[accent] : "rgba(236,236,241,0.7)";
  /* A plain link, deliberately classless: it navigates, so there is nothing
     for the client to wire, and a class on it would claim otherwise — which
     is exactly what the wiring check caught. */
  return `<a href="${esc(v.href)}" style="display:flex;gap:10px;align-items:center;padding:9px 11px;border-radius:8px;background:${accent ? "#141418" : "#121216"};box-shadow:inset 0 0 0 1px rgba(255,255,255,0.05);text-decoration:none;color:inherit">
    <span style="flex:none;width:66px;font-size:10px;font-weight:600;letter-spacing:.06em;padding:2px 6px;border-radius:3px;background:${bg};color:${fg};text-align:center;white-space:nowrap">${esc(v.tag)}</span>
    <span style="flex:1;min-width:0">
      <span data-content style="display:block;font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(v.name)}</span>
      <span data-content style="display:block;margin-top:1px;font-size:11px;color:${C.ink45};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(v.what)}</span>
    </span>
  </a>`;
}

/** The left column: what you can make. */
function direction(): string {
  return `<div style="flex:0 0 360px;max-width:100%;display:flex;flex-direction:column;gap:8px">
    ${label("MAKE")}
    <div style="display:flex;flex-direction:column;gap:5px">${VERBS.map((v) => verbCard(v, v.accent)).join("")}</div>
    <div style="margin-top:8px">${label("AS YOUR ARCHIVE GROWS")}</div>
    <div style="display:flex;flex-direction:column;gap:5px">${GROW.map((v) => verbCard(v)).join("")}</div>
  </div>`;
}

/**
 * One paragraph on what is in the archive, counted rather than estimated.
 *
 * The prototype's line is "N videos read · M moments". A number that cannot
 * be computed honestly is not shown — the same rule the clean-up chips follow
 * — so a library with no threads yet simply does not mention threads.
 */
function summary(c: RoomData["counts"]): string {
  const bits = [
    `${c.sources} video${c.sources === 1 ? "" : "s"} read`,
    `${c.moments} moment${c.moments === 1 ? "" : "s"}`,
  ];
  if (c.threads) bits.push(`${c.threads} thread${c.threads === 1 ? "" : "s"}`);
  return `<div data-content style="font-size:${SIZE.secondary};color:${C.ink70};font-family:${FONT.mono}">${esc(bits.join(" · "))}</div>`;
}

const TABS: Array<[RoomTab, string]> = [
  ["videos", "Videos"],
  ["highlights", "Highlights"],
  ["projects", "Projects"],
];

function tabs(active: RoomTab, counts: RoomData["counts"], projects: number): string {
  const n = (t: RoomTab) => (t === "videos" ? counts.sources : t === "highlights" ? counts.moments : projects);
  return `<div style="display:flex;gap:16px;align-items:baseline;flex-wrap:wrap">${TABS.map(
    ([t, name]) =>
      `<a href="/?tab=${t}" style="font-size:${SIZE.body};text-decoration:none;color:${t === active ? C.ink : C.ink45};font-weight:${t === active ? 600 : 500}">${name}<span data-content style="margin-left:6px;font-size:${SIZE.meta};font-family:${FONT.mono};color:${C.ink32}">${n(t)}</span></a>`,
  ).join("")}</div>`;
}

/**
 * SEARCH ACROSS EVERY TRANSCRIPT, in one box.
 *
 * The thing the library exists for: "where do I talk about money" over
 * everything you have ever shot, rather than over one video at a time. It
 * runs the hybrid retrieval that now exists — meaning and exact words as
 * peers, fused by rank — so a proper name and a paraphrase both land.
 *
 * It says when it could not use the better half, in the same sentence the
 * Footage page uses, because it is the same fact and a second wording for it
 * would be a second thing to keep true.
 */
function searchBar(q: string, unavailable: boolean): string {
  return `<form method="get" action="/room" style="margin-top:16px;display:flex;flex-direction:column;gap:8px">
    <input type="hidden" name="tab" value="highlights"/>
    <!-- Classless for the same reason the verb cards are: it is a real form
         that submits itself, so there is nothing for the client to wire, and
         a class would claim otherwise. -->
    <input type="search" name="q" value="${esc(q)}" autocomplete="off"
      placeholder="Search everything you have shot"
      style="width:100%;padding:10px 12px;border-radius:${RADIUS.card};background:${C.surface};border:none;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.06);color:${C.ink};font-family:inherit;font-size:${SIZE.body}"/>
    ${
      unavailable
        ? `<div data-content style="padding:10px 12px;border-radius:${RADIUS.card};background:${C.surface};font-size:${SIZE.secondary};color:${C.ink45}">Searching the words that were said. Meaning search isn't switched on yet.</div>`
        : ""
    }
  </form>`;
}

const empty = (text: string) =>
  `<div data-content style="margin-top:20px;font-size:${SIZE.secondary};color:${C.ink45}">${esc(text)}</div>`;

function videoRow(s: RoomData["sources"][number]): string {
  const read = s.transcript_state === "done" ? "read" : s.transcript_state === "error" ? "couldn't read it" : "reading";
  return `<a href="/sources/${esc(s.id)}" style="display:flex;gap:12px;align-items:center;padding:10px 12px;border-radius:${RADIUS.card};background:${C.surface};text-decoration:none;color:inherit">
    <span style="flex:none;width:72px;aspect-ratio:16/9;border-radius:4px;overflow:hidden;background:${C.canvas};display:block">${
      s.poster_r2_key
        ? `<img loading="lazy" src="/media/${esc(s.poster_r2_key)}" alt="" style="width:100%;height:100%;object-fit:cover"/>`
        : ""
    }</span>
    <span style="flex:1;min-width:0">
      <span data-content style="display:block;font-size:${SIZE.body};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.title)}</span>
      <span data-content style="display:block;margin-top:2px;font-size:${SIZE.meta};color:${C.ink45};font-family:${FONT.mono}">${esc(read)}${s.clips ? ` · ${s.clips} moment${s.clips === 1 ? "" : "s"}` : ""}</span>
    </span>
  </a>`;
}

function momentCard(m: RoomData["moments"][number]): string {
  return `<div data-moment="${esc(m.id)}" style="display:flex;flex-direction:column;border-radius:${RADIUS.card};background:${C.surface};overflow:hidden">
    <span style="aspect-ratio:16/9;background:${C.canvas};display:block">${
      m.frame_r2_key
        ? `<img loading="lazy" src="/media/${esc(m.frame_r2_key)}" alt="" style="width:100%;height:100%;object-fit:cover"/>`
        : ""
    }</span>
    <span style="padding:10px 11px;display:block">
      <span data-content style="display:block;font-size:${SIZE.secondary};line-height:1.5;color:${C.ink70}">${esc(m.quote.slice(0, 110))}</span>
      <span data-content style="display:block;margin-top:5px;font-size:${SIZE.meta};color:${C.ink32};font-family:${FONT.mono}">${esc(m.thread_name ?? m.source_title)}</span>
    </span>
  </div>`;
}

function projectRow(p: RoomData["projects"][number]): string {
  return `<a href="/p/${esc(p.id)}/cut" style="display:flex;gap:12px;align-items:baseline;padding:10px 12px;border-radius:${RADIUS.card};background:${C.surface};text-decoration:none;color:inherit">
    <span data-content style="flex:1;min-width:0;font-size:${SIZE.body};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.title)}</span>
    <span data-content style="flex:none;font-size:${SIZE.meta};color:${C.ink45};font-family:${FONT.mono}">${esc(p.kind)}</span>
  </a>`;
}

/** The centre column: your footage. */
function footage(d: RoomData): string {
  let body: string;
  if (d.tab === "videos") {
    body = d.sources.length
      ? `<div style="margin-top:14px;display:flex;flex-direction:column;gap:6px">${d.sources.map(videoRow).join("")}</div>`
      : empty("Nothing here yet — upload a video and it starts transcribing.");
  } else if (d.tab === "highlights") {
    body = d.moments.length
      ? `<div style="margin-top:14px;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(230px,100%),1fr));gap:14px">${d.moments.map(momentCard).join("")}</div>`
      : empty(d.q ? "No footage yet" : "Nothing kept yet — add a clip back.");
  } else {
    body = d.projects.length
      ? `<div style="margin-top:14px;display:flex;flex-direction:column;gap:6px">${d.projects.map(projectRow).join("")}</div>`
      : empty("Nothing made yet.");
  }

  return `<div style="flex:1 1 420px;min-width:min(320px,100%)">
    ${summary(d.counts)}
    ${searchBar(d.q, d.meaningUnavailable)}
    <div style="margin-top:18px">${tabs(d.tab, d.counts, d.projects.length)}</div>
    ${body}
  </div>`;
}

export function renderRoom(d: RoomData): string {
  return `<div style="display:flex;gap:28px;align-items:flex-start;flex-wrap:wrap">
    ${direction()}
    ${footage(d)}
  </div>`;
}
