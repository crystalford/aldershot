/**
 * THE SCOUT BOARD — built against the rendered prototype, not a description.
 *
 * `docs/labs/Scout.dc.html`, driven to its populated state and looked at.
 * CLAUDE.md's precedence order puts the rendered prototype above the handoff
 * and the reason is on display here: the handoff says the board has
 * "VERIFIED / CROWD / TRACE rows", and the rendered board has six row chips,
 * two meters and a gap block the handoff does not mention the shape of.
 *
 * WHAT THE HANDOFF GETS WRONG, SPECIFICALLY. "VERIFIED" is not a chip. A
 * verified row's chip is its ACQUISITION STATE — whether the footage is
 * already yours, scouted but not fetched, out on a mission, being fetched,
 * being matched, or acquired and verified. That is the difference between a
 * row you can cut today and a row that needs twenty minutes of your time,
 * and putting one word on all six would hide the only thing a person is
 * deciding between.
 *
 * TWO METERS, NOT ONE. The handoff names "the balance meter". The board has
 * SOURCED (how much of what was found can actually be read) beside BALANCE
 * (subject against counter). They answer different questions and a board with
 * one of them answers half.
 *
 * GAPS COME FIRST, with the prototype's own line above them: "what's missing
 * comes first — it's the next thing to do. Each says what was tried, so you
 * can tell 'doesn't exist' from 'not found yet'." That sentence is the whole
 * design of this surface and it is why a gap carries its query count.
 *
 * AND A GAP IS ONLY A GAP ONCE THE RUN HAS STOPPED. The prototype gates it on
 * the run reaching its last step; a beat that is short mid-run is still being
 * worked. Calling it a gap early tells the user something is missing when
 * nobody has finished looking — which is the same confusion between the
 * stopping rule and the completion invariant that `scout-run.ts` exists to
 * keep apart.
 */

import { C, ACCENT, FONT, RADIUS, SIZE, accentBg } from "../tokens.ts";
import { esc } from "../shell.ts";

/* ── What the board is made of ──────────────────────────────────────────── */

/** How a find was got, or could be. The prototype's six, in order of progress. */
export const ACQ_STATES = ["owned", "scouted", "mission", "fetching", "matching", "verified"] as const;
export type AcqState = (typeof ACQ_STATES)[number];

/** The chip a verified row wears: its acquisition state, never the word "verified". */
export interface Chip {
  label: string;
  color: string;
  bg: string;
}

/* `accentBg` takes a hex, and `scouted` is ink at low alpha rather than an
   accent — it is the state that means nothing has happened yet, and giving it
   a colour would say something had. */
const INK_CHIP = "rgba(236,236,241,0.08)";

export const ACQ_CHIP: Record<AcqState, Chip> = {
  owned: { label: "YOURS", color: ACCENT.green, bg: accentBg(ACCENT.green) },
  scouted: { label: "SCOUTED", color: C.ink45, bg: INK_CHIP },
  mission: { label: "MISSION", color: ACCENT.gold, bg: accentBg(ACCENT.gold) },
  fetching: { label: "FETCHING", color: ACCENT.cyan, bg: accentBg(ACCENT.cyan) },
  matching: { label: "MATCHING", color: ACCENT.cyan, bg: accentBg(ACCENT.cyan) },
  verified: { label: "ACQUIRED · VERIFIED", color: ACCENT.green, bg: accentBg(ACCENT.green) },
};

/**
 * A row the crowd points at that Scout could not read — and one that was
 * checked and is NOT THERE.
 *
 * `unbacked` exists because the board used to draw a rejection as a CROWD
 * row: the verifier had looked for the quote in the source, failed to find
 * it, and the board showed the words anyway with a timestamp, a credit line
 * and a "Make it a mission" button. A fabricated quote offered as something
 * to go and capture.
 *
 * Found the first time a fixture carried all three verdicts — which was also
 * the first time this board had ever been rendered with any rows in it at
 * all.
 *
 * It is SHOWN rather than filtered out, because invariant 4 says "nothing
 * backs this" has to be a reachable answer: a rejection quietly dropped is a
 * model's miss that nobody can audit, and the rejection rate is the measured
 * hallucination rate this product gates model swaps on. So it stays, and it
 * says what it is.
 */
export type CrowdKind = "crowd" | "trace" | "unbacked";
export const CROWD_CHIP: Record<CrowdKind, Chip> = {
  crowd: { label: "CROWD", color: ACCENT.cyan, bg: accentBg(ACCENT.cyan) },
  trace: { label: "TRACE", color: ACCENT.gold, bg: accentBg(ACCENT.gold) },
  unbacked: { label: "NOT IN THE SOURCE", color: ACCENT.red, bg: accentBg(ACCENT.red) },
};

/** How the footage would arrive, which is a different question from where it is now. */
export type Route = "yours" | "feed" | "mission";
export const ROUTE_CHIP: Record<Route, Chip> = {
  yours: { label: "ALREADY YOURS", color: ACCENT.green, bg: accentBg(ACCENT.green) },
  feed: { label: "AUTO · open feed", color: ACCENT.green, bg: accentBg(ACCENT.green) },
  mission: { label: "MISSION · you grab it", color: ACCENT.gold, bg: accentBg(ACCENT.gold) },
};

export type BeatRole = "subject" | "counter" | "context";
export const ROLE_CHIP: Record<BeatRole, Chip> = {
  subject: { label: "SUBJECT", color: C.ink, bg: "rgba(236,236,241,0.1)" },
  context: { label: "CONTEXT", color: ACCENT.gold, bg: accentBg(ACCENT.gold) },
  counter: { label: "COUNTERPOINT", color: ACCENT.green, bg: accentBg(ACCENT.green) },
};

export interface BoardRow {
  /** A verified find, or a place the crowd points to that nobody could read. */
  kind: "verified" | CrowdKind;
  acq: AcqState;
  route: Route;
  /** The words. Quoted for a verified row; a description, italic, for a crowd row. */
  text: string;
  /** Seconds into the source, derived from word ids. Shown as a deep link. */
  tS: number;
  sourceName: string;
  host: string;
  /** ±30 s either side, which is what makes a quote checkable for fairness. */
  before?: string;
  after?: string;
  /** "Source: … · YouTube · Jan 2024", or that no credit is needed. */
  credit: string;
  /** How many crowd timestamps point at this source. */
  crowdSignals?: number;
  attached?: boolean;
}

export interface BoardBeat {
  id: string;
  name: string;
  role: BeatRole;
  behaviour: string;
  needMin: number;
  rows: BoardRow[];
  /** What was tried, so a gap can say "not found yet" rather than "doesn't exist". */
  queriesTried: number;
  /** How many of the five query families were used. Absent when unknown. */
  familiesTried?: number;
}

export interface BoardData {
  verifiedMoments: number;
  crowdRows: number;
  beats: BoardBeat[];
  /** The run has stopped. Until it has, a short beat is being worked, not a gap. */
  stopped: boolean;
  /** For the footer's diligence line. */
  sourcesRead: number;
  sourcesLinkOnly: number;
  candidatesScanned: number;
  /**
   * THE GHOSTS THIS CUT IS CARRYING.
   *
   * An external moment attached in the room becomes a mission the moment the
   * project exists, and until somebody grabs it the cut is built over a
   * moment that is not footage. The board is where that is said, because the
   * board is already the page about what is outside your footage.
   *
   * Empty for a cut with no ghosts, which is most of them.
   */
  ghosts?: Array<{ ledgerId: string; quote: string; inS: number; url: string | null; state: string }>;
}

/* ── The two meters ─────────────────────────────────────────────────────── */

export interface Meter {
  label: string;
  /** 0 to 100. Internal: invariant 3 forbids a percentage reaching a person. */
  pct: number;
  /**
   * A second, dimmer segment for work in flight.
   *
   * SOURCED has two bars in the prototype and the reason is the whole
   * question it answers: a row out on a mission is neither in hand nor a
   * dead end, and a single bar would have to call it one or the other.
   */
  pending?: number;
  /** What the person actually reads. Counts of things, never a percentage. */
  text: string;
  color: string;
}

/**
 * SOURCED: of every row on the board, how many are actually in hand.
 *
 * READ OFF THE PROTOTYPE'S SOURCE, not its screenshot. The first version of
 * this compared verified MOMENTS against sources FOUND — two different units,
 * which can exceed one another and mean nothing when divided. What the board
 * computes is over all rows, verified and crowd alike: how many are already
 * yours, or acquired and verified.
 *
 * That is the number deciding whether a run produced evidence or a reading
 * list, and it is why crowd rows are in the denominator. A board counting
 * only what it could read would score full marks having read one thing and
 * linked forty.
 *
 * Shown as "5 of 12 verified" — counts, not a share, because invariant 3 is
 * about what reaches a person and "42%" about somebody's footage is exactly
 * the kind of number it forbids.
 */
export function sourcedMeter(beats: BoardBeat[]): Meter {
  const rows = beats.flatMap((b) => b.rows);
  const inHand = rows.filter((r) => r.acq === "owned" || r.acq === "verified").length;
  const inFlight = rows.filter((r) => r.acq === "mission" || r.acq === "fetching" || r.acq === "matching").length;
  const total = rows.length;
  return {
    label: "SOURCED",
    pct: total ? Math.round((inHand / total) * 100) : 0,
    pending: total ? Math.round((inFlight / total) * 100) : 0,
    /*
     * "IN HAND", NOT "VERIFIED".
     *
     * This meter counts rows whose ACQUISITION state is owned or matched —
     * whether you have the footage. The subhead beside it counts rows whose
     * VERDICT is verified — whether the quote is real. Both said "verified",
     * so the board rendered "0 of 3 verified" directly beside "1 verified
     * moment" and no reader could reconcile them. ACQ_CHIP already takes
     * care over this: its own label is "ACQUIRED · VERIFIED".
     */
    text: total ? `${inHand} of ${total} in hand` : "—",
    color: ACCENT.green,
  };
}

/**
 * BALANCE: the subject's side against the other one.
 *
 * "Sought 6 searches, found 2" is the spec's phrasing and the shape matters:
 * a balance meter showing only results makes a run that looked hard and found
 * nothing indistinguishable from one that never looked. The text is two
 * counts — subject · counter — and the bar is the split.
 */
export function balanceMeter(beats: BoardBeat[]): Meter {
  const verified = (b: BoardBeat) => b.rows.filter((r) => r.kind === "verified").length;
  const subject = beats.filter((b) => b.role === "subject").reduce((n, b) => n + verified(b), 0);
  const counter = beats.filter((b) => b.role === "counter").reduce((n, b) => n + verified(b), 0);
  const total = subject + counter;
  return {
    label: "BALANCE",
    pct: total ? Math.round((subject / total) * 100) : 0,
    text: total ? `${subject} · ${counter}` : "—",
    /* Gold when there is no other side at all: it is the thing to fix, and a
       bar in the success colour would say the opposite. */
    color: counter === 0 && subject > 0 ? ACCENT.gold : ACCENT.green,
  };
}

/* ── Gaps ───────────────────────────────────────────────────────────────── */

export interface Gap {
  beatId: string;
  name: string;
  /** The sentence under the beat: what is short, and what was tried. */
  why: string;
}

/**
 * What is missing, in the words the prototype uses.
 *
 * TWO DIFFERENT SENTENCES, and the difference is the point. A beat with
 * SOMETHING is short: "only 1 verified; wanted 2". A beat with NOTHING had
 * the crowd pointing somewhere unreadable, or nothing at all — and those read
 * differently because what the user does next differs: bring the capture, or
 * try an interview.
 *
 * ONLY ONCE THE RUN HAS STOPPED. A short beat mid-run is being worked.
 */
/** "1 query tried", "6 queries tried across 3 families". */
function tried(b: BoardBeat): string {
  const n = b.queriesTried;
  const head = `${n} quer${n === 1 ? "y" : "ies"} tried`;
  return b.familiesTried && b.familiesTried > 1 ? `${head} across ${b.familiesTried} families` : head;
}

export function gapsOf(d: BoardData): Gap[] {
  if (!d.stopped) return [];
  const out: Gap[] = [];
  for (const b of d.beats) {
    const verified = b.rows.filter((r) => r.kind === "verified").length;
    if (verified >= b.needMin) continue;
    const crowd = b.rows.filter((r) => r.kind !== "verified").length;
    out.push({
      beatId: b.id,
      name: b.name,
      /*
       * COUNTED, NOT ASSERTED, and both halves of that were wrong here.
       *
       * "1 queries tried" — there was no singular, and a gap sentence is
       * exactly where somebody is reading carefully.
       *
       * "across three families" was a hardcoded number beside a computed one.
       * FAMILIES in src/scout-adapters.ts has FIVE — direct, vocab, crowd,
       * counter, seed — so the sentence told a person a fact about their own
       * run that was not true of it. It says how many were actually tried
       * now, and says nothing when the count is unknown.
       *
       * Both found the first time this board was rendered with rows in it.
       */
      why: verified
        ? `Only ${verified} verified; wanted ${b.needMin}. ${tried(b)}.`
        : crowd
          ? `Nothing verified — the crowd points at ${crowd} stretch${crowd === 1 ? "" : "es"} on sources Scout can't read. Bring the capture and it'll verify them.`
          : `${tried(b)}, nothing verified. Either it doesn't exist or it isn't where these families look — try an interview, or ask a long-time viewer.`,
    });
  }
  return out;
}

/** What a beat's count says, and in what colour. Red is short; green is done. */
export function beatStatus(b: BoardBeat, stopped: boolean): { text: string; color: string } {
  const verified = b.rows.filter((r) => r.kind === "verified").length;
  if (!stopped) {
    const crowd = b.rows.filter((r) => r.kind !== "verified").length;
    return { text: crowd ? `${crowd} crowd` : "searching", color: C.ink45 };
  }
  return verified >= b.needMin
    ? { text: `${verified} verified`, color: ACCENT.green }
    : { text: `${verified} of ${b.needMin}`, color: ACCENT.red };
}

/* ── Rendering ──────────────────────────────────────────────────────────── */

const chip = (c: Chip) =>
  `<span style="display:inline-block;padding:2px 7px;border-radius:${RADIUS.pill};background:${c.bg};` +
  `color:${c.color};font:500 ${SIZE.meta} ${FONT.mono};letter-spacing:.04em;white-space:nowrap">${esc(c.label)}</span>`;

/** mm:ss or h:mm:ss, which is what a deep link into a source reads as. */
export function atTime(tS: number): string {
  const s = Math.max(0, Math.round(tS));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

function renderMeter(m: Meter): string {
  return (
    `<div style="display:flex;align-items:center;gap:8px">` +
    `<span style="font:500 ${SIZE.meta} ${FONT.mono};letter-spacing:.08em;color:${C.ink45}">${esc(m.label)}</span>` +
    `<div style="width:120px;height:4px;border-radius:2px;background:${C.pill};overflow:hidden;display:flex">` +
    `<div style="height:100%;width:${m.pct}%;background:${m.color}"></div>` +
    /* In flight, dimmer: neither in hand nor a dead end. */
    (m.pending ? `<div style="height:100%;width:${m.pending}%;background:${accentBg(m.color)}"></div>` : "") +
    `</div>` +
    `<span data-content style="font:400 ${SIZE.meta} ${FONT.mono};color:${C.ink70}">${esc(m.text)}</span></div>`
  );
}

/**
 * The gap block, first on the board.
 *
 * Three actions per gap, which are the three things a person can actually do
 * about a hole: find somebody who said it on the record, go and get the
 * footage the crowd pointed at, or say it themselves. A gap with no action is
 * a complaint.
 */
function renderGaps(gaps: Gap[]): string {
  if (!gaps.length) return "";
  const rows = gaps
    .map(
      (g) =>
        `<div style="display:flex;align-items:flex-start;gap:10px;padding:7px 0">` +
        `<span data-content style="font:500 ${SIZE.meta} ${FONT.mono};color:${C.ink45};flex:none;width:22px">${esc(g.beatId)}</span>` +
        `<div style="flex:1;min-width:0">` +
        `<div data-content style="font:600 ${SIZE.body} ${FONT.ui};color:${C.ink}">${esc(g.name)}</div>` +
        `<div data-content style="font:400 ${SIZE.secondary} ${FONT.ui};color:${C.ink70};margin-top:2px">${esc(g.why)}</div></div>` +
        `<div style="display:flex;gap:6px;flex:none">` +
        ["Try an interview", "Bring the capture", "Your voice"]
          .map(
            (label) =>
              `<button type="button" style="padding:4px 9px;border:0;border-radius:${RADIUS.pill};background:${C.pill};` +
              `color:${C.ink70};font:500 ${SIZE.meta} ${FONT.ui};cursor:pointer">${esc(label)}</button>`,
          )
          .join("") +
        `</div></div>`,
    )
    .join("");

  return (
    `<section style="border:1px solid ${accentBg(ACCENT.gold)};border-radius:${RADIUS.card};` +
    `background:${accentBg(ACCENT.gold)};padding:12px 14px;margin-bottom:14px">` +
    `<div style="display:flex;align-items:baseline;gap:10px;margin-bottom:4px">` +
    chip({ label: `GAPS · ${gaps.length}`, color: ACCENT.gold, bg: accentBg(ACCENT.gold) }) +
    `<span style="font:400 ${SIZE.secondary} ${FONT.ui};color:${C.ink70}">` +
    `what's missing comes first — it's the next thing to do. Each says what was tried, so you can tell ` +
    `&ldquo;doesn't exist&rdquo; from &ldquo;not found yet&rdquo;.</span></div>` +
    rows +
    `</section>`
  );
}

function renderRow(r: BoardRow): string {
  const isVerified = r.kind === "verified";
  const kindChip = r.kind === "verified" ? ACQ_CHIP[r.acq] : CROWD_CHIP[r.kind];
  const route = ROUTE_CHIP[r.route];
  const quote = isVerified ? `&ldquo;${esc(r.text)}&rdquo;` : esc(r.text);

  const context =
    r.before || r.after
      ? `<div style="font:400 ${SIZE.meta} ${FONT.mono};color:${C.ink32};margin-top:4px">` +
        (r.before ? `<div>−30 s &nbsp;[${esc(r.before)}]</div>` : "") +
        (r.after ? `<div>+30 s &nbsp;[${esc(r.after)}]</div>` : "") +
        `</div>`
      : "";

  return (
    `<div style="display:flex;gap:10px;padding:10px 12px;border-radius:${RADIUS.card};` +
    `background:${isVerified ? C.raised : C.surface};margin-bottom:6px">` +
    `<span style="flex:none">${chip(kindChip)}</span>` +
    `<div style="flex:1;min-width:0">` +
    `<div data-content style="font:400 ${SIZE.body} ${FONT.ui};color:${isVerified ? C.ink : C.ink70};` +
    `${isVerified ? "" : "font-style:italic"}">${quote}</div>` +
    context +
    `<div data-content style="font:400 ${SIZE.meta} ${FONT.mono};color:${C.ink45};margin-top:5px">` +
    `${esc(r.sourceName)} · ${atTime(r.tS)}${r.host ? ` &nbsp;${esc(r.host)}` : ""}` +
    `${r.crowdSignals ? ` · ${r.crowdSignals} crowd timestamps` : ""}</div>` +
    `<div style="margin-top:5px">${chip(route)}</div>` +
    `<div data-content style="font:400 ${SIZE.meta} ${FONT.mono};color:${C.ink32};margin-top:4px">${esc(r.credit)}</div>` +
    `</div>` +
    `<div style="display:flex;gap:6px;flex:none;align-items:flex-start">` +
    `<button type="button" style="padding:4px 9px;border:0;border-radius:${RADIUS.pill};background:${C.pill};` +
    `color:${C.ink70};font:500 ${SIZE.meta} ${FONT.ui};cursor:pointer">Open at ${atTime(r.tS)}</button>` +
    (isVerified
      ? `<button type="button" style="padding:4px 9px;border:0;border-radius:${RADIUS.pill};` +
        `background:${r.attached ? "transparent" : C.ink};color:${r.attached ? ACCENT.green : C.canvas};` +
        `font:500 ${SIZE.meta} ${FONT.ui};cursor:pointer">${r.attached ? "Attached ✓" : "Attach"}</button>`
      : `<button type="button" style="padding:4px 9px;border:0;border-radius:${RADIUS.pill};background:${C.pill};` +
        `color:${C.ink70};font:500 ${SIZE.meta} ${FONT.ui};cursor:pointer">Make it a mission</button>`) +
    `</div></div>`
  );
}

function renderBeat(b: BoardBeat, d: BoardData, gap: Gap | undefined): string {
  const role = ROLE_CHIP[b.role];
  const status = beatStatus(b, d.stopped);

  return (
    `<section style="margin-bottom:16px">` +
    `<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:7px">` +
    `<span data-content style="font:500 ${SIZE.meta} ${FONT.mono};color:${C.ink45}">${esc(b.id)}</span>` +
    `<span data-content style="font:600 ${SIZE.body} ${FONT.ui};color:${C.ink}">${esc(b.name)}</span>` +
    chip(role) +
    `<span style="font:400 ${SIZE.secondary} ${FONT.ui};color:${C.ink45};flex:1;min-width:0;` +
    `overflow:hidden;text-overflow:ellipsis;white-space:nowrap" data-content>${esc(b.behaviour)}</span>` +
    `<span data-content style="font:500 ${SIZE.meta} ${FONT.mono};color:${status.color};flex:none">${esc(status.text)}</span>` +
    `</div>` +
    b.rows.map(renderRow).join("") +
    /* The gap again, under its own beat. The block at the top is the list of
       what to do next; this is the explanation where the evidence is thin, and
       a reader scrolling the beats should not have to go back up for it. */
    (gap
      ? `<div style="display:flex;gap:8px;align-items:baseline;padding:8px 12px;border-radius:${RADIUS.card};` +
        `background:${accentBg(ACCENT.red)}">${chip({ label: "GAP", color: ACCENT.red, bg: accentBg(ACCENT.red) })}` +
        `<span data-content style="font:400 ${SIZE.secondary} ${FONT.ui};color:${C.ink70}">${esc(gap.why)}</span></div>`
      : "") +
    `</section>`
  );
}

/**
 * The whole board.
 *
 * ORDER: the meters, then the gaps, then the beats. The prototype's own, and
 * the reason is the gap block's line — what is missing is the next thing to
 * do, so it goes where a person looks first rather than after forty rows of
 * what was found.
 */
/** mm:ss, because a deep link is only useful if you can see where it goes. */
const atClock = (s: number): string => {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
};

/*
 * WHAT IS IN THE CUT THAT IS NOT FOOTAGE.
 *
 * Above the beats, because it is the only part of this page that is about a
 * cut that already exists rather than about the search — and because a
 * person who has attached a find and run it wants to know what they now owe.
 *
 * Every row is a link to the source at the in-point and nothing else. That
 * link IS the product here: invariant 9 means we do not fetch it, so the
 * only move available is to hand a person the place and the time.
 */
function renderGhosts(d: BoardData): string {
  const open = (d.ghosts ?? []).filter((g) => g.state !== "matched");
  if (!open.length) return "";
  const rows = open
    .map(
      (g) =>
        `<div style="display:flex;gap:10px;align-items:baseline;padding:7px 0;border-top:1px solid ${C.hairline}">` +
        `<span data-content style="flex:1;min-width:0;font:400 ${SIZE.secondary} ${FONT.ui};color:${C.ink70}">${esc(g.quote.slice(0, 120))}</span>` +
        (g.url
          ? `<a href="${esc(g.url)}" target="_blank" rel="noopener noreferrer" style="flex:none;font:600 ${SIZE.meta} ${FONT.mono};color:${ACCENT.gold};text-decoration:none">open at ${esc(atClock(g.inS))} &nearr;</a>`
          : `<span style="flex:none;font:400 ${SIZE.meta} ${FONT.mono};color:${C.ink32}">no link</span>`) +
        `</div>`,
    )
    .join("");
  return (
    `<div style="border:1px solid ${C.hairline};border-radius:${RADIUS.card};background:${C.surface};padding:14px;margin-bottom:14px">` +
    `<div style="font:600 ${SIZE.body} ${FONT.ui};color:${C.ink}">${open.length} ghost${open.length === 1 ? "" : "s"} in this cut</div>` +
    `<div style="font:400 ${SIZE.meta} ${FONT.mono};color:${C.ink45};margin-top:2px">` +
    `In the cut, not in your footage. Open one, record or grab it, and bring the file back — ` +
    `it finds the scouted words inside what you bring and lines them up.</div>` +
    rows +
    `</div>`
  );
}

export function renderBoard(d: BoardData): string {
  const gaps = gapsOf(d);
  const byBeat = new Map(gaps.map((g) => [g.beatId, g]));

  const meta = d.beats.length
    ? `${d.verifiedMoments} verified moment${d.verifiedMoments === 1 ? "" : "s"} · ` +
      `${d.crowdRows} crowd-indexed, link only · ${d.beats.length} beat${d.beats.length === 1 ? "" : "s"} · ` +
      (d.stopped ? "stopped at saturation" : "working")
    : "no brief run yet";

  const header =
    `<div style="display:flex;align-items:flex-start;gap:16px;margin-bottom:14px">` +
    `<div style="flex:1;min-width:0">` +
    `<div style="font:600 ${SIZE.pageTitle} ${FONT.ui};color:${C.ink}">The Scout board</div>` +
    `<div data-content style="font:400 ${SIZE.meta} ${FONT.mono};color:${C.ink45};margin-top:2px">${esc(meta)}</div></div>` +
    `<div style="display:flex;gap:18px;flex:none;padding-top:4px">` +
    renderMeter(sourcedMeter(d.beats)) +
    renderMeter(balanceMeter(d.beats)) +
    `</div></div>`;

  if (!d.beats.length) {
    return (
      header +
      `<div style="border:1px solid ${C.hairline};border-radius:${RADIUS.card};background:${C.surface};padding:16px">` +
      `<div style="font:400 ${SIZE.body} ${FONT.ui};color:${C.ink70}">Nothing yet. Scout turns the brief into ` +
      `things a viewer could point to on camera — never a diagnosis — then searches for each, and for its opposite.</div></div>`
    );
  }

  /*
   * BEATS WITH A GAP COME FIRST, and this is the prototype's order rather
   * than a choice: a board that listed beats in their own order would open on
   * whatever the first beat happened to be, and the thing a person has to act
   * on would be forty rows down.
   */
  const ordered = [...d.beats].sort((a, b) => Number(byBeat.has(b.id)) - Number(byBeat.has(a.id)));

  const footer =
    `<div style="display:flex;gap:10px;justify-content:space-between;padding-top:10px;` +
    `border-top:1px solid ${C.hairline};font:400 ${SIZE.meta} ${FONT.mono};color:${C.ink32}">` +
    /* Every count here plurals. `sourcesRead` already did and the other two
       did not, which is the kind of inconsistency that only shows when a run
       is small — and a run with one of something is the one a person reads
       most carefully. */
    `<span data-content>Searched: ${d.sourcesRead} source${d.sourcesRead === 1 ? "" : "s"} read · ` +
    `${d.sourcesLinkOnly} link only · ${d.candidatesScanned} candidate${d.candidatesScanned === 1 ? "" : "s"} scanned, ` +
    `${d.verifiedMoments} verified</span>` +
    `<span>sources &nearr; &nbsp; the ledger &nearr;</span></div>`;

  return (
    header + renderGaps(gaps) + renderGhosts(d) + ordered.map((b) => renderBeat(b, d, byBeat.get(b.id))).join("") + footer
  );
}
