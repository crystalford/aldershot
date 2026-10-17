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
import { composer, workingRow, type WorkingJob } from "./home.ts";

export type RoomTab = "videos" | "highlights" | "projects";

export interface RoomData {
  tab: RoomTab;
  /** The sources attached so far, by id. A cut started now is scoped to them. */
  attached: string[];
  /** What is being read or rendered right now. Empty when nothing is. */
  working: WorkingJob[];
  /** What was searched for. */
  q: string;
  /** True when meaning search was asked for and could not answer. */
  meaningUnavailable: boolean;
  /** Which retriever was asked for. Both run; this is what the person chose. */
  mode: "meaning" | "exact";
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
  /** What the threads are called, for the archive card. */
  threadNames: string[];
}

/**
 * WHAT PRESSING A CARD PUTS IN THE BOX.
 *
 * The cards shipped as links to /?make=cut, which the server does not read —
 * six controls that looked like they started something and reloaded the page
 * unchanged. The conventions check missed it because they were links rather
 * than controls, which is a hole in the check as much as a bug in the cards.
 *
 * Each one now writes the sentence a person would have typed and leaves the
 * cursor in it. That is honestly what they do: One Take's cards start a
 * project outright, and starting one still needs the footage or the link that
 * only the next sentence can name. Filling the box is the true half of that,
 * and it is one mechanism with no special cases rather than four flows where
 * two would have to apologise.
 */
const VERBS: Array<{ tag: string; accent: keyof typeof ACCENT; name: string; what: string; say: string }> = [
  {
    tag: "CUT",
    accent: "green",
    name: "Cut — tighten a recording",
    what: "your footage · the rules do the cutting",
    say: "tighten this",
  },
  {
    tag: "SHORTS",
    accent: "cyan",
    name: "Shorts — clips that stand alone",
    what: "Strong · Worth a look · Long shot, with reasons",
    say: "find the bits that stand alone",
  },
  {
    tag: "ESSAY",
    accent: "violet",
    name: "Essay — a video that argues something",
    what: "a thesis, your footage, or both · the plan first",
    say: "a video about ",
  },
  {
    tag: "REACT",
    accent: "red",
    name: "React — answer someone else's video",
    what: "a link, a file, or Scout finds it",
    say: "react to ",
  },
];

const GROW: Array<{ tag: string; name: string; what: string; say: string }> = [
  {
    tag: "STORY",
    name: "Story — what happened, in order",
    what: "organised by time · the day on screen at each change",
    say: "what happened, in order",
  },
  {
    tag: "SUPERCUT",
    name: "Supercut — every time",
    what: "a phrase · every moment that matches, nothing else",
    say: "every time I mention ",
  },
];

/**
 * THE TITLE ROW. It did not exist, and it carries the product's main nav.
 *
 * Rendering the prototype next to the build showed this first: "Your footage"
 * with the archive's counts beside it, and on the right + Add and the four
 * tabs — Footage · Blocks · Words · Shorts. I had put the counts loose in the
 * centre column and the tabs inside it, which made the centre do the job of
 * the chrome and left the product with no visible top-level navigation.
 *
 * BLOCKS, WORDS AND SHORTS ARE NOT CONTROLS HERE. They are what the centre
 * becomes once a project is open, and with none open there is nothing for
 * them to show. Rendered as dim text rather than as links, because a link
 * that goes nowhere is the failure this codebase keeps catching — and they
 * are not permanently disabled, they are simply a state away.
 */
function titleRow(d: RoomData): string {
  const tab = (name: string, on: boolean) =>
    `<span data-content style="font-size:${SIZE.secondary};font-weight:${on ? 600 : 500};padding:4px 11px;border-radius:${RADIUS.button};background:${on ? C.raised : "transparent"};color:${on ? C.ink : C.ink32}">${name}</span>`;

  return `<div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap">
    <span data-content style="flex:none;font-size:${SIZE.body};font-weight:600">Your footage</span>
    <span data-content style="flex:1 1 auto;min-width:0;font-size:${SIZE.meta};font-family:${FONT.mono};color:${C.ink45}">${esc(summaryLine(d.counts))}</span>
    <a href="/?tab=videos" style="flex:none;font-size:${SIZE.meta};padding:5px 11px;border-radius:${RADIUS.button};background:${C.pill};color:${C.ink70};text-decoration:none">+ Add</a>
    <span style="flex:none;display:flex;gap:2px;align-items:center">
      ${tab("Footage", true)}${tab("Blocks", false)}${tab("Words", false)}${tab("Shorts", false)}
    </span>
  </div>`;
}

const label = (text: string) =>
  `<div style="font-size:10.5px;font-weight:600;letter-spacing:.09em;color:${C.ink45}">${text}</div>`;

function verbCard(v: { tag: string; name: string; what: string; say: string }, accent?: keyof typeof ACCENT): string {
  const bg = accent ? accentBg(ACCENT[accent]) : "rgba(236,236,241,0.08)";
  const fg = accent ? ACCENT[accent] : "rgba(236,236,241,0.7)";
  return `<button class="make-card" type="button" data-make="${esc(v.say)}" style="display:flex;gap:10px;align-items:center;padding:9px 11px;border-radius:8px;background:${accent ? "#141418" : "#121216"};box-shadow:inset 0 0 0 1px rgba(255,255,255,0.05);border:none;cursor:pointer;width:100%;text-align:left;font-family:inherit;color:inherit">
    <span style="flex:none;width:66px;font-size:10px;font-weight:600;letter-spacing:.06em;padding:2px 6px;border-radius:3px;background:${bg};color:${fg};text-align:center;white-space:nowrap">${esc(v.tag)}</span>
    <span style="flex:1;min-width:0">
      <span data-content style="display:block;font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(v.name)}</span>
      <span data-content style="display:block;margin-top:1px;font-size:11px;color:${C.ink45};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(v.what)}</span>
    </span>
  </button>`;
}

/**
 * The left column: what you can make, and the box you say it in.
 *
 * The composer is the bottom of this column in One Take, and it is the same
 * composer Home renders — imported rather than copied, because client.ts
 * wires it by id and two renderings that drifted would leave one surface
 * silently dead.
 *
 * It is here rather than above the columns because the verbs and the box are
 * one gesture: the cards say what can be made, the box is where you say it in
 * your own words, and splitting them put the menu and the way to order from
 * it on opposite halves of the screen.
 */
function direction(attached: string[]): string {
  return `<div style="flex:0 0 360px;max-width:100%;display:flex;flex-direction:column;gap:8px">
    <div data-content style="font-size:${SIZE.secondary};line-height:1.6;color:${C.ink70}">Pick what to make, or attach footage on the right and say it. Either way this becomes the project — its read, its rules, every change with Undo.</div>
    <div style="margin-top:6px">${label("MAKE")}</div>
    <div style="display:flex;flex-direction:column;gap:5px">${VERBS.map((v) => verbCard(v, v.accent)).join("")}</div>
    <div style="margin-top:8px">${label("AS YOUR ARCHIVE GROWS")}</div>
    <div style="display:flex;flex-direction:column;gap:5px">${GROW.map((v) => verbCard(v)).join("")}</div>
    ${composer(attached, { room: true })}
  </div>`;
}

/**
 * One paragraph on what is in the archive, counted rather than estimated.
 *
 * The prototype's line is "N videos read · M moments". A number that cannot
 * be computed honestly is not shown — the same rule the clean-up chips follow
 * — so a library with no threads yet simply does not mention threads.
 */
function summaryLine(c: RoomData["counts"]): string {
  const bits = [
    `${c.sources} video${c.sources === 1 ? "" : "s"} read`,
    `${c.moments} moment${c.moments === 1 ? "" : "s"}`,
  ];
  if (c.threads) bits.push(`${c.threads} thread${c.threads === 1 ? "" : "s"}`);
  return bits.join(" · ");
}

/**
 * WHAT'S IN YOUR ARCHIVE — a paragraph, not a count.
 *
 * The prototype writes it: "Three vlogs, one question — whether to leave the
 * city for the house. You circle it for two and a half hours across five
 * threads and answer it once, on Sunday at 44:02." That is a READING of the
 * library, and it is the first thing in the centre column.
 *
 * We cannot write that yet — it needs a pass over every transcript, and
 * inventing a sentence that sounds like one would be the product claiming to
 * have read something it has not. So the card says what IS true: what is in
 * there, counted, and the threads it found. The card exists at the right size
 * in the right place, and gets its paragraph when something can honestly
 * produce one.
 */
function archiveCard(d: RoomData): string {
  if (!d.counts.sources) return "";
  const threads = d.threadNames.slice(0, 4);
  return `<div style="padding:13px 15px;border-radius:${RADIUS.card};background:${C.surface}">
    <div data-content style="font-size:10.5px;font-weight:600;letter-spacing:.09em;color:${C.ink45}">WHAT'S IN YOUR ARCHIVE</div>
    <div data-content style="margin-top:7px;font-size:${SIZE.secondary};line-height:1.6;color:${C.ink70}">${esc(
      summaryLine(d.counts) + (threads.length ? ` — ${threads.join(", ")}` : "")
    )}</div>
  </div>`;
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
function searchBar(q: string, unavailable: boolean, mode: "meaning" | "exact"): string {
  return `<form method="get" action="/" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
    <input type="hidden" name="tab" value="highlights"/>
    <!-- Classless for the same reason the verb cards are: it is a real form
         that submits itself, so there is nothing for the client to wire, and
         a class would claim otherwise. -->
    <input type="search" name="q" value="${esc(q)}" autocomplete="off"
      placeholder="Search every transcript by meaning — “money”, “Mum”, “where I decide”"
      style="flex:1 1 240px;min-width:min(200px,100%);padding:10px 12px;border-radius:${RADIUS.card};background:${C.surface};border:none;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.06);color:${C.ink};font-family:inherit;font-size:${SIZE.body}"/>
    <!--
      BY MEANING OR EXACT WORDS, which the prototype offers and I had left
      out — the whole point of the two retrievers is that a person can ask
      for either. The mode parameter is read by the server, so the gate's
      rule about linked queries covers it. NO BACKTICKS IN HERE: this is
      inside a template literal and quoting a name with them ends it.
    -->
    <span style="flex:none;display:flex;gap:2px;align-items:center">
      <button type="submit" name="mode" value="meaning" style="font-size:${SIZE.meta};font-weight:600;padding:7px 11px;border-radius:${RADIUS.button};border:none;cursor:pointer;font-family:inherit;background:${mode === "exact" ? "transparent" : C.raised};color:${mode === "exact" ? C.ink32 : C.ink}">By meaning</button>
      <button type="submit" name="mode" value="exact" style="font-size:${SIZE.meta};font-weight:600;padding:7px 11px;border-radius:${RADIUS.button};border:none;cursor:pointer;font-family:inherit;background:${mode === "exact" ? C.raised : "transparent"};color:${mode === "exact" ? C.ink : C.ink32}">Exact words</button>
    </span>
    ${
      unavailable
        ? `<div data-content style="flex:1 1 100%;padding:10px 12px;border-radius:${RADIUS.card};background:${C.surface};font-size:${SIZE.secondary};color:${C.ink45}">Searching the words that were said. Meaning search isn't switched on yet.</div>`
        : ""
    }
  </form>`;
}

const empty = (text: string) =>
  `<div data-content style="margin-top:20px;font-size:${SIZE.secondary};color:${C.ink45}">${esc(text)}</div>`;

/**
 * ATTACHING IS A LINK, not a checkbox.
 *
 * The room is server-rendered and the selection has to survive a page load,
 * so it lives in the URL: ?attach=a,b. No client state to lose, no second
 * copy of the truth, and the gate can see all of it — its new rule about
 * links already demands that `attach` be a query the server reads.
 *
 * Toggling, because attaching the same video twice is a thing people do and
 * the second press should take it off rather than add it again.
 */
function attachHref(tab: RoomTab, attached: string[], id: string): string {
  const next = attached.includes(id) ? attached.filter((x) => x !== id) : [...attached, id];
  return `/?tab=${tab}` + (next.length ? `&attach=${next.map(encodeURIComponent).join(",")}` : "");
}

function videoRow(s: RoomData["sources"][number], tab: RoomTab, attached: string[]): string {
  /* The four real states (src/sources.ts), not invented ones — an earlier
     version of this checked for "done" and "error", which the column never
     holds, so every video read as "reading" for ever. */
  const read =
    s.transcript_state === "ready" ? "read"
    : s.transcript_state === "failed" ? "couldn't read it"
    : s.transcript_state === "running" ? "reading"
    : "queued";
  /*
   * TWO GESTURES, TWO CONTROLS. The row opens the transcript; the button
   * attaches. One control doing both could only ever do the wrong one half
   * the time. A span wraps them, because a browser will not nest a link in a
   * link.
   *
   * This function also closed with </button> while opening with <a>, from the
   * commit that turned the verb cards into buttons — that edit replaced every
   * matching close tag in the file rather than its own. Browsers are lenient
   * enough that nothing looked wrong, which is exactly why it survived.
   */
  const on = attached.includes(s.id);
  /*
   * HOW DEEPLY IT WAS READ, which the prototype shows as READ · WORDS +
   * SCREEN. Ours is words only — there is no visual pass, no shot detection
   * and no OCR — so it says WORDS, because claiming SCREEN would be claiming
   * a reading that never happened. The badge gets its second half when the
   * visual tier exists.
   */
  const depth = s.transcript_state === "ready" ? "READ · WORDS" : "";
  const mins = s.duration_s ? `${Math.floor(s.duration_s / 60)}:${String(Math.round(s.duration_s % 60)).padStart(2, "0")}` : "";
  return `<span style="display:flex;gap:12px;align-items:center;padding:10px 12px;border-radius:${RADIUS.card};background:${C.surface}">
    <a href="/sources/${esc(s.id)}" style="display:flex;gap:12px;align-items:center;flex:1;min-width:0;text-decoration:none;color:inherit">
      <span style="flex:none;width:72px;aspect-ratio:16/9;border-radius:4px;overflow:hidden;background:${C.canvas};display:block">${
        s.poster_r2_key
          ? `<img loading="lazy" src="/media/${esc(s.poster_r2_key)}" alt="" style="width:100%;height:100%;object-fit:cover"/>`
          : ""
      }</span>
      <span style="flex:1;min-width:0">
        <span data-content style="display:block;font-size:${SIZE.body};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.title)}</span>
        <span data-content style="display:block;margin-top:2px;font-size:${SIZE.meta};color:${C.ink45};font-family:${FONT.mono}">${esc(
        [mins, read, s.clips ? `${s.clips} moment${s.clips === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · "),
      )}</span>
      </span>
    </a>
    ${
      depth
        ? `<span data-content style="flex:none;font-size:10px;font-weight:600;letter-spacing:.05em;padding:3px 7px;border-radius:3px;background:${accentBg(ACCENT.green)};color:${ACCENT.green};white-space:nowrap">${depth}</span>`
        : ""
    }
    <a href="${esc(attachHref(tab, attached, s.id))}" style="flex:none;font-size:${SIZE.meta};font-weight:600;padding:5px 10px;border-radius:${RADIUS.button};background:${on ? accentBg(ACCENT.gold) : C.pill};color:${on ? ACCENT.gold : C.ink70};text-decoration:none;white-space:nowrap">${on ? "Attached" : "Attach all"}</a>
  </span>`;
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
      ? `<div style="margin-top:14px;display:flex;flex-direction:column;gap:6px">${d.sources.map((v) => videoRow(v, d.tab, d.attached)).join("")}</div>`
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

  /*
   * THE ORDER IS THE PROTOTYPE'S, and it was wrong in three ways.
   *
   * Videos · Highlights · Projects sit at the TOP with the attach
   * instruction beside them and + Add footage on the right — they are how you
   * choose what to look at, so they come before the thing they choose. The
   * archive card is next, then search, then the list. I had the counts
   * floating, search above the tabs, and no card at all.
   */
  return `<div style="flex:1 1 420px;min-width:min(320px,100%);display:flex;flex-direction:column;gap:14px">
    <div style="display:flex;gap:12px;align-items:baseline;flex-wrap:wrap">
      ${tabs(d.tab, d.counts, d.projects.length)}
      <span data-content style="flex:1 1 200px;min-width:min(180px,100%);font-size:${SIZE.meta};color:${C.ink32}">Click a moment to attach it, then say what to make — or pick a type on the left.</span>
      <a href="/?tab=videos" style="flex:none;font-size:${SIZE.meta};font-weight:600;padding:6px 12px;border-radius:${RADIUS.button};background:${C.raised};color:${C.ink};text-decoration:none;white-space:nowrap">+ Add footage</a>
    </div>
    ${archiveCard(d)}
    ${searchBar(d.q, d.meaningUnavailable, d.mode)}
    ${body}
  </div>`;
}

export function renderRoom(d: RoomData): string {
  /*
   * WHAT IS HAPPENING RIGHT NOW, above everything.
   *
   * The same row Home renders, imported rather than copied: it polls, and two
   * renderings that drifted would leave one surface showing a progress line
   * that never moves. It is above the columns because it is about the whole
   * account rather than either half, and because an upload in progress is the
   * thing a person is most likely to have come back to check.
   */
  return `${titleRow(d)}
  ${d.working.length ? workingRow(d.working) : ""}
  <div style="display:flex;gap:28px;align-items:flex-start;flex-wrap:wrap;margin-top:20px">
    ${direction(d.attached)}
    ${footage(d)}
  </div>`;
}
