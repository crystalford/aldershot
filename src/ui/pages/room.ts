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
import { LINE, OUTSIDE_PREFS, PILL, type OutsidePref } from "../../outside.ts";
import { archiveSentence, countLine } from "../../archive.ts";

export type RoomTab = "videos" | "highlights" | "projects";

/** Whose footage the Highlights list is showing. The prototype's three. */
export const WHO = ["mine", "external", "all"] as const;
export type Who = (typeof WHO)[number];

export type Provenance = "mine" | "external";
/** Where an external moment is, which decides its badge and its colour. */
export type Acq = "linked" | "mission" | "verified";

export interface RoomData {
  /**
   * Whether Scout may go outside, for the row at the foot of MAKE.
   *
   * Read rather than defaulted in the page, because the row's line and its
   * pill both change with it and a page that guessed would show one state
   * while the database held another.
   */
  outsidePref: OutsidePref;
  tab: RoomTab;
  /** The sources attached so far, by id. A cut started now is scoped to them. */
  attached: string[];
  /**
   * The EXTERNAL moments attached so far, by ledger id.
   *
   * A separate list because a ghost is not a source. `attached` becomes
   * `sourceIds` on the composer and is checked against the user's own
   * sources; a ledger id in that list would be dropped by the check, and if
   * it were not it would scope a cut to a video that is not here. These ride
   * as `ledgerIds` instead, and /api/begin turns them into missions.
   */
  ext: string[];
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
  /**
   * WHOSE FOOTAGE IS SHOWN. Mine · External · All, from the prototype.
   *
   * It sits on Highlights alone, with the external count on its own chip,
   * because that is where the prototype puts it: a moment found outside your
   * footage is a MOMENT, in the same list as yours, and the filter is how you
   * stop it being lost among six hundred of your own.
   */
  who: Who;
  moments: Array<{
    id: string;
    quote: string;
    frame_r2_key: string;
    source_title: string;
    thread_name: string | null;
    /**
     * Yours, or found outside it.
     *
     * The prototype's own field, and doc 18's: "An external moment is
     * moment(provenance: external, acq: …), pointing at its ledger row. It
     * uses the same table and engine as the user's own moments."
     */
    provenance?: Provenance;
    /** Where it is: linked, out on a mission, or in hand. */
    acq?: Acq;
    /** Seconds into its source, for the timecode. Derived from word ids. */
    at_s?: number;
    /** How long it runs, for the chip in the corner of the frame. */
    dur_s?: number;
    /** The platform it was found on, which is the first thing the note says. */
    host?: string | null;
    attached?: boolean;
  }>;
  projects: Array<{ id: string; title: string; kind: string; updated_at: number }>;
  /** Totals for the summary line, counted rather than estimated. */
  /*
   * ONE PLACE A THREAD COUNT COMES FROM, which is `threads` below.
   *
   * It used to be here as well, and "a count that disagrees with its list is
   * a bug this product has already had twice" — three times, by the time the
   * Highlights tab was fixed. The number in the title row is now the length
   * of the list the paragraph names, so the two cannot come apart.
   */
  counts: { sources: number; moments: number; external: number };
  /**
   * The threads, biggest first, for the archive paragraph.
   *
   * Names AND counts: the paragraph says which one is returned to most, and
   * a list of names alone could not have told it.
   */
  threads: Array<{ name: string; moments: number }>;
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
    <span style="flex:none;font-size:${SIZE.body};font-weight:600">Your footage</span>
    <span data-content style="flex:1 1 auto;min-width:0;font-size:${SIZE.meta};font-family:${FONT.mono};color:${C.ink45}">${esc(countLine({ sources: d.counts.sources, moments: d.counts.moments, threads: d.threads }))}</span>
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
/**
 * THE SCOUT ROW — the front door's own question about going outside.
 *
 * The prototype puts this at the foot of the MAKE column, and the build had
 * Scout only inside a project: the one place the preference could be set was
 * a place you reached by having already decided. The Manual puts him in the
 * second paragraph of what the product is — "Scout is how the video gets
 * better than your footage alone" — and a front door that never mentions him
 * is a product that is quieter about its second half than it means to be.
 *
 * THE LINE CHANGES WITH THE PILL, which is the prototype's behaviour and the
 * reason it matters: a line reading "bring him into a project" under a pill
 * reading Off is the interface disagreeing with itself.
 *
 * NO data-content ON EITHER LINE, and that is the point of the attribute.
 * It marks text the user's own footage produced — a transcript line, a
 * filename, a reason a model wrote — which cannot be in the prototype and
 * must not be flagged. Both of these are chrome, and the first version
 * carried the mark by copying the card above it: the strings rule skipped
 * the whole row, and paraphrasing the heading to "Scout improves your
 * video" passed the gate green. Every word here is in the prototype, so
 * every word here is checked.
 *
 * THE THREE STATES TRAVEL WITH THE ROW. src/ui/client.ts is one String.raw
 * template with no interpolation in it, so a client that changed the pill
 * would have to restate "On" and "Per project" and all three lines in a
 * second place — and the day one of them is reworded, the two disagree
 * depending on whether you pressed anything. The row carries every state as
 * a data attribute and the client reads the one the server named; outside.ts
 * stays the only file the words live in.
 *
 * NO GLYPH, AND THAT IS DELIBERATE. The prototype draws a Scout character
 * here through its own component, and src/ui/icons.ts holds ten shapes that
 * all match the design. Inventing an eleventh — a binocular, a magnifier —
 * is exactly the defensible substitution the fidelity checks exist to catch:
 * "a missing feature is obvious in review; a swapped icon set is invisible."
 * The row works without it and the art is a thing to ask the designer for.
 */
function scoutRow(pref: OutsidePref): string {
  const states = OUTSIDE_PREFS.map(
    (p) => `data-pill-${p}="${esc(PILL[p])}" data-line-${p}="${esc(LINE[p])}"`,
  ).join(" ");
  return `<div id="scoutRow" tabindex="0" role="button" ${states} title="Scout is how a video gets better than your footage alone: he reads the cut, sees what it&rsquo;s missing, and goes looking &mdash; links, never downloads."
    style="margin-top:16px;display:flex;align-items:center;gap:11px;padding:9px 11px;border-radius:8px;background:#121216;box-shadow:inset 0 0 0 1px rgba(94,184,201,0.22);cursor:pointer">
    <div style="flex:1;min-width:0">
      <div style="font-size:${SIZE.secondary};font-weight:600">Scout makes it better</div>
      <div id="scoutRowLine" style="margin-top:1px;font-size:${SIZE.meta};color:${C.ink45};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(LINE[pref])}</div>
    </div>
    <span id="scoutPref" role="button" tabindex="0" data-pref="${esc(pref)}" style="flex:none;font-size:${SIZE.pill};font-weight:600;padding:3px 8px;border-radius:4px;background:rgba(94,184,201,0.14);color:${ACCENT.cyan};white-space:nowrap;cursor:pointer">${esc(PILL[pref])}</span>
  </div>`;
}

function direction(attached: string[], ghosts: string[], pref: OutsidePref): string {
  return `<div style="flex:0 0 360px;max-width:100%;display:flex;flex-direction:column;gap:8px">
    <div style="font-size:${SIZE.secondary};line-height:1.6;color:${C.ink70}">Pick what to make, or attach footage on the right and say it. Either way this becomes the project — its read, its rules, every change with Undo.</div>
    <div style="margin-top:6px">${label("MAKE")}</div>
    <div style="display:flex;flex-direction:column;gap:5px">${VERBS.map((v) => verbCard(v, v.accent)).join("")}</div>
    <div style="margin-top:8px">${label("AS YOUR ARCHIVE GROWS")}</div>
    <div style="display:flex;flex-direction:column;gap:5px">${GROW.map((v) => verbCard(v)).join("")}</div>
    ${scoutRow(pref)}
    ${composer(attached, { room: true, ghosts })}
  </div>`;
}

/**
 * WHAT'S IN YOUR ARCHIVE — a paragraph, as the prototype has it.
 *
 * It showed a count for as long as the room has existed, which CLAUDE.md
 * names as one of the three things a night of building from documents and
 * grepped strings got wrong: "the archive summary was a count where a
 * paragraph goes."
 *
 * The sentence itself is in src/archive.ts, with the argument for why it is
 * not the prototype's exact words and why it is not a model call. The short
 * version: it says the part that is counted, and the count is still what
 * comes back for an archive with no topic running through it yet.
 *
 * data-content, AND WHO CHECKS THE WORDS INSTEAD. The line is assembled from
 * the person's own thread names and their counts, so it is text the data
 * wrote and the strings rule cannot match it against a prototype that holds
 * a different library. That leaves the scaffolding — "threads run through",
 * "The one you come back to most is" — unchecked by the gate, so it is
 * pinned by exact string in test/archive.test.ts, which asserts the whole
 * sentence rather than a fragment of it for exactly this reason.
 */
function archiveCard(d: RoomData): string {
  const line = archiveSentence({
    sources: d.counts.sources,
    moments: d.counts.moments,
    threads: d.threads,
  });
  if (!line) return "";
  return `<div style="padding:13px 15px;border-radius:${RADIUS.card};background:${C.surface}">
    <div style="font-size:10.5px;font-weight:600;letter-spacing:.09em;color:${C.ink45}">WHAT'S IN YOUR ARCHIVE</div>
    <div data-content style="margin-top:7px;font-size:${SIZE.secondary};line-height:1.6;color:${C.ink70}">${esc(line)}</div>
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
        ? `<div style="flex:1 1 100%;padding:10px 12px;border-radius:${RADIUS.card};background:${C.surface};font-size:${SIZE.secondary};color:${C.ink45}">Searching the words that were said. Meaning search isn't switched on yet.</div>`
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
interface RoomState {
  tab: RoomTab;
  attached: string[];
  ext: string[];
  who: Who;
  q: string;
  mode: "meaning" | "exact";
}

/*
 * EVERY LINK IN THE ROOM CARRIES THE WHOLE ROOM.
 *
 * `/?tab=highlights` alone drops the attach list, which is how attaching two
 * videos and then switching to Mine threw the selection away. The state is
 * small and it is all in the URL, so one builder writes every link and
 * nothing can forget a field: a patch says what changed and the rest comes
 * along. Defaults are left off so the plain `/` stays plain.
 */
function roomHref(st: RoomState, patch: Partial<RoomState> = {}): string {
  const n = { ...st, ...patch };
  const p: string[] = [`tab=${n.tab}`];
  if (n.attached.length) p.push(`attach=${n.attached.map(encodeURIComponent).join(",")}`);
  if (n.ext.length) p.push(`ext=${n.ext.map(encodeURIComponent).join(",")}`);
  if (n.who !== "all") p.push(`who=${n.who}`);
  if (n.q) p.push(`q=${encodeURIComponent(n.q)}`);
  if (n.mode === "exact") p.push("mode=exact");
  return `/?${p.join("&")}`;
}

/** On, off. Attaching the same thing twice should take it off again. */
const toggle = (list: string[], id: string): string[] =>
  list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

function attachHref(st: RoomState, id: string): string {
  return roomHref(st, { attached: toggle(st.attached, id) });
}

/** The same toggle for a ghost, into the other list. */
function extHref(st: RoomState, id: string): string {
  return roomHref(st, { ext: toggle(st.ext, id) });
}

function videoRow(s: RoomData["sources"][number], st: RoomState): string {
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
  const on = st.attached.includes(s.id);
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
    <a href="${esc(attachHref(st, s.id))}" style="flex:none;font-size:${SIZE.meta};font-weight:600;padding:5px 10px;border-radius:${RADIUS.button};background:${on ? accentBg(ACCENT.gold) : C.pill};color:${on ? ACCENT.gold : C.ink70};text-decoration:none;white-space:nowrap">${on ? "Attached" : "Attach all"}</a>
  </span>`;
}

/**
 * MINE · EXTERNAL · ALL, on Highlights only.
 *
 * The external chip carries its own count, which is the prototype's and is
 * the point of the control: the question a person has is "did Scout find
 * anything", and a filter that made them click to find out would answer it
 * one click too late.
 *
 * The title is the prototype's sentence, word for word. It is the only place
 * invariant 9 is explained to a person at the moment it matters — "linked,
 * never downloaded" beside the things that were linked.
 */
function whoFilter(st: RoomState, external: number): string {
  const label = (w: Who) => (w === "mine" ? "Mine" : w === "external" ? `External · ${external}` : "All");
  return (
    `<div title="External: found outside your footage or added (a podcast) — linked, never downloaded. ` +
    `They attach like anything else and ride into the cut as ghosts until you grab them." ` +
    `style="flex:none;display:flex;gap:2px;padding:2px;border-radius:${RADIUS.button};background:${C.surface}">` +
    WHO.map(
      (w) =>
        `<a href="${esc(roomHref(st, { tab: "highlights", who: w }))}" style="font-size:${SIZE.meta};` +
        `font-weight:600;padding:4px 9px;border-radius:3px;` +
        `background:${w === st.who ? C.active : "transparent"};` +
        `color:${w === st.who ? C.ink : C.ink45};text-decoration:none;white-space:nowrap">${esc(label(w))}</a>`,
    ).join("") +
    `</div>`
  );
}

/**
 * The badge an external moment wears, which is where it is rather than what
 * it is worth.
 *
 * `linked` and `mission` are both gold because both are something for the
 * user to do; `verified` and `Attached` are green because both are in hand.
 * The prototype's colours, and they carry the same meaning as the board's.
 */
function momentBadge(m: RoomData["moments"][number]): { text: string; bg: string } | null {
  if (m.attached) return { text: "Attached", bg: ACCENT.green };
  if (m.provenance !== "external") return null;
  if (m.acq === "verified") return { text: "External · acquired", bg: ACCENT.green };
  if (m.acq === "mission") return { text: "External · mission open", bg: ACCENT.gold };
  return { text: "External · linked", bg: ACCENT.gold };
}

/*
 * THE NOTE UNDER THE QUOTE, which is the prototype's line exactly:
 *
 *   note: (isExt ? (S.host || "outside") + " · " : "") + (m.strand || …)
 *
 * The platform comes FIRST for an external moment, before the thread, because
 * the first thing a person needs to know about a moment that is not theirs is
 * whose it is. "outside" when the host is not known, which is still true.
 */
function momentNote(m: RoomData["moments"][number]): string {
  const strand = m.thread_name ?? m.source_title;
  return m.provenance === "external" ? `${m.host || "outside"} · ${strand}` : strand;
}

/**
 * A MOMENT CARD IS A LINK NOW.
 *
 * "Click a moment to attach it" has been on this page since the room was
 * built, over a div that did nothing. An external moment toggles into `ext`
 * and a moment of your own into `attach`, so one card does both and the only
 * difference is which list it lands in.
 */
/**
 * WHAT THE HIGHLIGHTS TAB COUNTS.
 *
 * This file says twice that a count which disagrees with its list is a bug
 * this product has already had — and it had it a third time, because the tab
 * read the user's own moments while the list showed three of Scout's finds
 * beside them. A library with nothing of its own said 0 over three cards.
 *
 * It lives here rather than in the route because the rule belongs with the
 * list it describes, and because a rule in a route handler is a rule nothing
 * can test: removing it left every test in this repo green.
 */
export function momentsShown(who: Who, own: number, external: number): number {
  if (who === "mine") return own;
  if (who === "external") return external;
  return own + external;
}

/** m:ss, or h:mm:ss past the hour — a Twitch VOD is hours long. */
export function clock(s: number | undefined): string {
  if (s === undefined || !Number.isFinite(s)) return "";
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

function momentCard(m: RoomData["moments"][number], st: RoomState): string {
  const isExt = m.provenance === "external";
  const badge = momentBadge(m);
  const ring = m.attached
    ? `box-shadow:inset 0 0 0 1.5px ${ACCENT.green};`
    : "box-shadow:inset 0 0 0 1px rgba(255,255,255,0.05);";
  /*
   * A FRAMELESS CARD SAYS WHERE THE MOMENT IS INSTEAD.
   *
   * An external moment has no frame and must not: a still would be a thing
   * fetched and stored, which is the line invariant 9 draws. Rendering the
   * empty box was honest and looked broken — three black rectangles down a
   * grid of your own footage. The host and the timecode go in its place,
   * which is the one picture of an external moment we are entitled to.
   */
  const picture = m.frame_r2_key
    ? `<img loading="lazy" src="/media/${esc(m.frame_r2_key)}" alt="" style="width:100%;height:100%;object-fit:cover"/>`
    : `<span data-content style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;font-family:${FONT.mono};color:${C.ink32}">` +
      `<span style="font-size:${SIZE.secondary}">${esc(m.host || (isExt ? "outside" : m.source_title))}</span>` +
      (m.at_s === undefined ? "" : `<span style="font-size:${SIZE.meta}">at ${esc(clock(m.at_s))}</span>`) +
      `</span>`;
  return `<a data-moment="${esc(m.id)}" href="${esc(isExt ? extHref(st, m.id) : attachHref(st, m.id))}" title="${m.attached ? "Detach" : "Attach"}" style="display:flex;flex-direction:column;border-radius:${RADIUS.card};background:${C.surface};overflow:hidden;${ring}text-decoration:none;color:inherit">
    <span style="position:relative;aspect-ratio:16/9;background:${C.canvas};display:block">${picture}${
      /* Top right, 10px, as the prototype has it. It was top LEFT in the
         first version, where the prototype puts the source letter. */
      badge
        ? `<span data-content style="position:absolute;right:6px;top:6px;font-size:${SIZE.meta};font-weight:600;padding:2px 6px;border-radius:3px;background:${badge.bg};color:#101013">${esc(badge.text)}</span>`
        : ""
    }${
      m.dur_s === undefined
        ? ""
        : `<span data-content style="position:absolute;right:6px;bottom:6px;font-size:${SIZE.meta};font-family:${FONT.mono};padding:2px 5px;border-radius:3px;background:rgba(11,11,13,0.8);color:${C.ink70}">${esc(clock(m.dur_s))}</span>`
    }</span>
    <span style="padding:10px 11px;display:block">
      <span data-content style="display:block;font-size:${SIZE.secondary};line-height:1.5;color:${C.ink70}">${esc(m.quote.slice(0, 110))}</span>
      <span style="margin-top:5px;display:flex;align-items:center;gap:6px">
        <span data-content style="flex:1;min-width:0;font-size:${SIZE.meta};color:${C.ink32};font-family:${FONT.mono};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(momentNote(m))}</span>
        <span data-content style="flex:none;font-size:${SIZE.meta};color:${C.ink32};font-family:${FONT.mono}">${esc(clock(m.at_s))}</span>
      </span>
    </span>
  </a>`;
}

function projectRow(p: RoomData["projects"][number]): string {
  return `<a href="/p/${esc(p.id)}/cut" style="display:flex;gap:12px;align-items:baseline;padding:10px 12px;border-radius:${RADIUS.card};background:${C.surface};text-decoration:none;color:inherit">
    <span data-content style="flex:1;min-width:0;font-size:${SIZE.body};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.title)}</span>
    <span data-content style="flex:none;font-size:${SIZE.meta};color:${C.ink45};font-family:${FONT.mono}">${esc(p.kind)}</span>
  </a>`;
}

/** The centre column: your footage. */
function footage(d: RoomData): string {
  const st: RoomState = { tab: d.tab, attached: d.attached, ext: d.ext, who: d.who, q: d.q, mode: d.mode };
  let body: string;
  if (d.tab === "videos") {
    body = d.sources.length
      ? `<div style="margin-top:14px;display:flex;flex-direction:column;gap:6px">${d.sources.map((v) => videoRow(v, st)).join("")}</div>`
      : empty("Nothing here yet — upload a video and it starts transcribing.");
  } else if (d.tab === "highlights") {
    body = d.moments.length
      ? `<div style="margin-top:14px;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(230px,100%),1fr));gap:14px">${d.moments.map((m) => momentCard(m, st)).join("")}</div>`
      /*
       * THE EMPTY LINE DEPENDS ON WHO IS BEING ASKED ABOUT.
       *
       * "Nothing kept yet — add a clip back" is about your own footage and is
       * nonsense under External, where there is nothing to add back: Scout
       * has either not run or found nothing. Saying the wrong one is how a
       * person concludes a feature is broken.
       */
      : empty(
          d.q
            ? "No footage yet"
            : d.who === "external"
              ? "Nothing from outside yet — Scout finds and links; it never downloads."
              : "Nothing kept yet — add a clip back.",
        );
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
      ${d.tab === "highlights" ? whoFilter(st, d.counts.external) : ""}
      <span style="flex:1 1 200px;min-width:min(180px,100%);font-size:${SIZE.meta};color:${C.ink32}">Click a moment to attach it, then say what to make — or pick a type on the left.</span>
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
    ${direction(d.attached, d.ext, d.outsidePref)}
    ${footage(d)}
  </div>`;
}
