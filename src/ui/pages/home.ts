/**
 * Home — the composer. The only entry point that matters (01-PRODUCT.md).
 *
 * TODO(phase-1): the demo card is designed and rendered, but "Open the demo"
 * has nothing to open until a real 48-minute demo source is seeded and read.
 * Its copy makes a specific factual claim ("Twelve clips found") that must be
 * true of the actual seeded source before this ships to anyone.
 *
 * Markup transcribed from the `<sc-if value="{{ isHome }}">` block of
 * design/Aldershot.dc.html. Every string here is copied from the prototype and
 * cross-checked against design/docs/11-STRINGS.md — do not rewrite, shorten,
 * or "improve" any of them.
 *
 * Phase 0 renders the fresh (empty-account) state: composer + example chips +
 * the demo card + "How this goes". The populated state (working row, Since you
 * were away, in-motion projects) arrives with Phase 1, when there is real work
 * to show.
 */

import { C, ACCENT, FONT, RADIUS, SIZE } from "../tokens";
import { iconPlus } from "../icons";
import { esc } from "../shell";

/** The three example sentences shown in a fresh account. Copied verbatim. */
const TRY_CHIPS = [
  "Every weird clip in this interview",
  "Three shorts from the best arguments",
  "Tighten my recording",
];

const HOW_THIS_GOES: Array<[string, string]> = [
  [
    "Add a video",
    "Drop a file or paste a link above. An hour of footage takes a few minutes to read.",
  ],
  [
    "Say what you want out of it",
    "A supercut, a few shorts, a tidier version of your own recording — plain words are enough.",
  ],
  [
    "Keep what's good",
    "Every clip you keep lands in Footage. That's what the essay side eventually builds from.",
  ],
];

/**
 * The greeting under the page title, copied from the prototype's own
 * `fresh ? … : …` expression. The populated half names a real overnight count
 * and so cannot be rendered until Phase 1 has jobs to count — until then only
 * the fresh half is ever true.
 */
function greeting(name: string | null, isFresh: boolean, landedOvernight: number): string {
  const who = name || "Chris";
  if (isFresh) return `Welcome, ${who}. Nothing here yet — that's the right amount to start with.`;

  // The prototype's line is "Good morning, {who}. Four videos landed
  // overnight." — and "morning" is what it says, at every hour.
  //
  // Varying it by time of day was tempting and is exactly the kind of
  // well-meant substitution PROMPTING-NOTES.md warns about, so it is NOT done
  // here; the question is logged in docs/decisions/open-questions.md for the
  // owner to rule on rather than decided alone.
  //
  // The count IS real, so the second sentence only appears when something
  // actually landed. Saying it when nothing did would be a small lie of
  // exactly the kind this product exists to avoid.
  if (landedOvernight > 0) {
    const n = landedOvernight === 1 ? "One video" : `${landedOvernight} videos`;
    return `Good morning, ${who}. ${n} landed overnight.`;
  }
  return `Good morning, ${who}.`;
}

function composer(): string {
  const chips = TRY_CHIPS.map(
    (t) =>
      `<div tabindex="0" role="button" data-chip="${esc(t)}" style="font-size:${SIZE.secondary};padding:5px 10px;border-radius:${RADIUS.button};background:${C.raised};color:${C.ink};cursor:pointer;white-space:nowrap">${esc(t)}</div>`,
  ).join("");

  return `<form id="composer" method="POST" action="/api/begin" style="position:relative;margin-top:24px;background:${C.raised};border-radius:${RADIUS.composer};padding:6px;box-shadow:0 0 0 1px rgba(255,255,255,0.06), 0 12px 40px rgba(0,0,0,0.3)">
    <div id="dropHint" hidden style="position:absolute;inset:0;border-radius:${RADIUS.composer};box-shadow:inset 0 0 0 2px ${ACCENT.gold};background:rgba(217,179,106,0.07);pointer-events:none;display:flex;align-items:center;justify-content:center;z-index:2">
      <span style="font-size:${SIZE.body};font-weight:600;color:${ACCENT.gold}">Drop it here</span>
    </div>
    <textarea name="brief" id="brief" rows="2" placeholder="Say what you want out of it — or drop a video in first" style="width:100%;box-sizing:border-box;background:transparent;border:none;outline:none;color:${C.ink};font-size:${SIZE.wordmark};padding:14px 14px 10px;resize:none;line-height:1.5;font-family:${FONT.ui}"></textarea>
    <div id="attached" hidden style="display:flex;align-items:center;gap:10px;margin:0 8px 4px 14px;padding:7px 9px;border-radius:${RADIUS.input};background:#111114">
      <div style="flex:none;width:46px;aspect-ratio:16/9;border-radius:4px;overflow:hidden;background:#07070a;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.06)"></div>
      <span id="attachedName" style="flex:1;min-width:0;font-size:${SIZE.secondary};color:rgba(236,236,241,0.8);font-family:${FONT.mono};overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
      <span id="attachedMeta" style="flex:none;font-size:${SIZE.meta};color:rgba(236,236,241,0.35);font-family:${FONT.mono}"></span>
      <div tabindex="0" role="button" id="clearFile" style="flex:none;cursor:pointer;color:rgba(236,236,241,0.4);font-size:15px;line-height:1;padding:2px 5px">×</div>
    </div>
    <div style="display:flex;gap:8px;align-items:center;padding:10px 8px 6px 14px;border-top:1px solid rgba(255,255,255,0.05);margin-top:2px;flex-wrap:wrap">
      <label style="flex:none;display:flex;align-items:center;gap:6px;font-size:${SIZE.secondary};padding:5px 11px;border-radius:${RADIUS.button};background:${C.pill};color:${C.ink70};cursor:pointer">
        ${iconPlus({ size: 13 })}
        <span>Video</span>
        <input type="file" accept="video/*" id="filePick" style="display:none"/>
      </label>
      <div style="display:flex;gap:5px;flex-wrap:wrap;flex:1 1 200px;min-width:0">${chips}</div>
      <button type="submit" style="flex:none;font-size:${SIZE.body};font-weight:600;padding:9px 22px;border-radius:${RADIUS.button};background:${C.ink};color:#131316;cursor:pointer;white-space:nowrap;border:none;font-family:${FONT.ui}">Begin →</button>
    </div>
  </form>`;
}

function demoCard(): string {
  return `<div tabindex="0" role="button" id="tryDemo" style="margin-top:24px;display:flex;align-items:center;gap:16px;padding:16px 18px;border-radius:${RADIUS.card};background:#141418;box-shadow:inset 0 0 0 1px rgba(217,179,106,0.24);cursor:pointer;flex-wrap:wrap">
    <div style="flex:none;width:76px;aspect-ratio:16/9;border-radius:${RADIUS.button};overflow:hidden;background:#0B0B0E;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.06)"><img loading="lazy" src="/assets/frame-3.png" alt="" style="width:100%;height:100%;object-fit:cover;display:block"/></div>
    <div style="flex:1 1 220px;min-width:min(200px,100%)">
      <div style="font-size:${SIZE.wordmark};font-weight:600">Don't have a video handy? Try it on ours.</div>
      <div style="font-size:${SIZE.secondary};color:${C.ink45};margin-top:4px;line-height:1.55">A 48-minute podcast, already read. Twelve clips found, nothing kept yet — see the whole thing work before you upload anything.</div>
    </div>
    <div style="flex:none;font-size:${SIZE.secondary};font-weight:600;padding:8px 16px;border-radius:${RADIUS.button};background:${ACCENT.gold};color:#131316;white-space:nowrap">Open the demo</div>
  </div>`;
}

function howThisGoes(): string {
  const rows = HOW_THIS_GOES.map(
    ([title, body], i) =>
      `<div style="display:flex;gap:14px;align-items:baseline;padding:14px 16px;border-radius:${RADIUS.card};background:${C.surface}">
        <span style="flex:none;width:16px;font-size:${SIZE.secondary};font-family:${FONT.mono};color:rgba(236,236,241,0.3)">${i + 1}</span>
        <div style="flex:1"><div style="font-size:${SIZE.body};font-weight:500">${esc(title)}</div><div style="font-size:${SIZE.secondary};color:${C.ink45};margin-top:3px">${esc(body)}</div></div>
      </div>`,
  ).join("");

  return `<div style="margin-top:48px;font-size:${SIZE.body};font-weight:600;color:${C.ink45};padding-left:4px">How this goes</div>
  <div style="margin-top:16px;display:flex;flex-direction:column;gap:6px">${rows}</div>`;
}

/**
 * The working row — what is processing right now, with real percentages.
 *
 * The sentence is assembled from live job rows, in the prototype's own shape:
 * "Working on 3 things — reading jones_quartering_full (62%) and moose_ep121
 * (24%), burning captions on 3 shorts (81%)."
 *
 * Percentages come from measured work. During transcription — a single atomic
 * call — there is no sub-progress to report, so the stage is named WITHOUT a
 * percentage rather than showing a number that isn't moving. A bar animating
 * on a timer would be worse than none: it teaches the user the bar is fiction.
 */
export interface WorkingJob {
  label: string;
  stage: string;
  pct: number;
}

function workingLine(jobs: WorkingJob[]): string {
  const things = jobs.length === 1 ? "1 thing" : `${jobs.length} things`;
  const byStage = new Map<string, WorkingJob[]>();
  for (const j of jobs) {
    if (!byStage.has(j.stage)) byStage.set(j.stage, []);
    byStage.get(j.stage)!.push(j);
  }
  const clauses = [...byStage.entries()].map(([stage, group]) => {
    const named = group.map((j) => (j.pct > 0 ? `${j.label} (${j.pct}%)` : j.label));
    const joined =
      named.length === 1 ? named[0] : `${named.slice(0, -1).join(", ")} and ${named.at(-1)}`;
    return `${stage} ${joined}`;
  });
  return `Working on ${things} — ${clauses.join(", ")}.`;
}

function workingRow(jobs: WorkingJob[]): string {
  return `<div style="margin-top:48px;display:flex;align-items:baseline;justify-content:space-between;padding-left:4px">
    <div style="font-size:${SIZE.body};font-weight:600;color:${C.ink45};white-space:nowrap;flex:none">Since you were away</div>
  </div>
  <div id="workingRow" style="margin-top:16px;display:flex;align-items:center;gap:12px;padding:12px 16px;border-radius:${RADIUS.card};background:#141418;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.04)">
    <span style="width:6px;height:6px;border-radius:50%;background:${ACCENT.green};animation:blip 1.6s ease-in-out infinite;flex:none"></span>
    <span id="workingLine" style="flex:1 1 240px;min-width:min(220px,100%);font-size:${SIZE.secondary};color:rgba(236,236,241,0.55)">${esc(workingLine(jobs))}</span>
    <a href="/footage?tab=sources" style="flex:none;font-size:${SIZE.secondary};font-weight:500;padding:6px 13px;border-radius:${RADIUS.button};background:${C.raised};color:${C.ink};cursor:pointer">Watch</a>
  </div>`;
}

export interface HomeData {
  name: string | null;
  isFresh: boolean;
  working: WorkingJob[];
  /** Sources that arrived since the user was last here. Real count, or zero. */
  landedOvernight: number;
}

export function renderHome(d: HomeData): string {
  return `<div style="font-size:clamp(24px,6vw,32px);font-weight:600;letter-spacing:-0.025em;line-height:1.2">What are we making today?</div>
<div style="font-size:${SIZE.body};color:rgba(236,236,241,0.42);margin-top:8px">${esc(greeting(d.name, d.isFresh, d.landedOvernight))}</div>
${composer()}
<div style="margin-top:16px;font-size:${SIZE.secondary};color:rgba(236,236,241,0.3);padding-left:4px">A full cut, a few shorts, a cleanup — it works out the job and checks with you first.</div>
${d.working.length ? workingRow(d.working) : ""}
${d.isFresh ? demoCard() + howThisGoes() : ""}`;
}
