/**
 * Home — the composer. The only entry point that matters (01-PRODUCT.md).
 *
 * THE DEMO CARD IS NOT RENDERED, and the note that used to be here warned
 * that it must not ship making a claim ("Twelve clips found") that is not
 * true of any account. It was taken out instead — see the reasoning beside
 * `answerPanel` below, which is where the decision is recorded.
 *
 * Markup transcribed from the `<sc-if value="{{ isHome }}">` block of
 * design/Aldershot.dc.html. Every string here is copied from the prototype and
 * cross-checked against docs/archive/handoff-v2/11-STRINGS.md — do not rewrite, shorten,
 * or "improve" any of them.
 *
 * Phase 0 renders the fresh (empty-account) state: composer + example chips +
 * the demo card + "How this goes". The populated state (working row, Since you
 * were away, in-motion projects) arrives with Phase 1, when there is real work
 * to show.
 */

import { C, ACCENT, FONT, RADIUS, SIZE } from "../tokens.ts";
import { iconPlus } from "../icons.ts";
import { esc } from "../shell.ts";
import { hms } from "./footage.ts";
import { ASK_MODES, DEFAULT_MODE, MODE_LABEL, modeHint, type AskMode } from "../../decide.ts";

/** The three example sentences shown in a fresh account. Copied verbatim. */
const TRY_CHIPS = [
  "Every weird clip in this interview",
  "Three shorts from the best arguments",
  "Tighten my recording",
];

const HOW_THIS_GOES: Array<[string, string]> = [
  [
    "Add a video",
    "Drop a file or paste a link above. An hour of footage takes a few minutes to transcribe.",
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
/*
 * IT IS RENDERED WITH data-content, BECAUSE THE PERSON'S NAME IS IN IT.
 *
 * "Good morning." is the prototype's copy and is signed off as such.
 * "Good morning, Ci." is that copy with an account's name appended, and the
 * strings rule read the whole line as one invented sentence. It had only ever
 * seen the nameless form, on the machine this was written on; CI signs in as
 * ci@aldershot.invalid and derived "Ci" — so the first clean machine to run
 * the gate reported the greeting as a paraphrase.
 *
 * The sentence is written by the data, which is exactly what the attribute
 * means. A JS comment and not an HTML one: a comment inside a template
 * literal ships to the browser.
 */
function greeting(name: string | null, isFresh: boolean, landedOvernight: number): string {
  /*
   * No name means no name — not a stand-in. "Chris" was a placeholder from the
   * prototype's demo data and would have greeted every other account by the
   * owner's first name.
   */
  const hello = name ? `Good morning, ${name}.` : "Good morning.";
  if (isFresh) {
    return name
      ? `Welcome, ${name}. Nothing here yet — that's the right amount to start with.`
      : `Welcome. Nothing here yet — that's the right amount to start with.`;
  }

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
    return `${hello} ${n} landed overnight.`;
  }
  return hello;
}

/**
 * The ask box, exported because the room needs the same one.
 *
 * One Take's left column ends in the composer, so the room and Home both
 * carry it — and they carry the SAME one. A second copy would be a second
 * thing to keep in step with client.ts, which wires it by id: #composer,
 * #brief, #filePick, #dropHint, #attached, #clearFile and the chips. Two
 * renderings of those ids that drifted would leave one surface silently
 * unwired, which is exactly the kind of failure the wiring check exists for
 * and would not catch, because the ids would still all be present somewhere.
 */
/**
 * THE DIAL — how much it decides.
 *
 * One of the two controls the prototype's composer has and the build did
 * not. It cycles rather than opening a menu, like the Scout pill: three
 * states, and a menu for three things is a menu nobody opens. The caret is
 * the prototype's own — it reads as a thing with more inside it, which is
 * true, and pressing it is how you see the rest.
 *
 * src/decide.ts holds the words and the cycle, so the client never restates
 * them: the row carries all three and reads back the one the server names.
 */
export function dial(mode: AskMode): string {
  const states = ASK_MODES.map(
    (m) => `data-label-${m}="${esc(MODE_LABEL[m])}" data-hint-${m}="${esc(modeHint(m))}"`,
  ).join(" ");
  return `<button type="button" id="askMode" data-mode="${esc(mode)}" ${states} title="${esc(modeHint(mode))}"
    style="flex:none;display:flex;align-items:center;gap:6px;font-size:${SIZE.secondary};font-weight:600;padding:6px 10px;border-radius:${RADIUS.button};background:#141418;color:rgba(236,236,241,0.82);border:none;cursor:pointer;font-family:${FONT.ui};white-space:nowrap">
    <span id="askModeLabel">${esc(MODE_LABEL[mode])}</span><span style="font-size:8px;color:${C.ink45}">&#9662;</span>
  </button>`;
}

/**
 * THE MIC, in the room.
 *
 * The project assistant has had this since voice landed; the front door,
 * where the Manual says you "say what you want in a sentence", did not. Same
 * classes, so client.ts wires it with the same function and there is one
 * copy of the MediaRecorder dance rather than two — a second copy is a
 * second place for the audio stream not to be released.
 *
 * It fills the box and does not press Run it. Voice is good at issuing and
 * bad at reviewing, and review is where the time goes.
 */
function roomMic(): string {
  return `<button type="button" class="asst-mic"
    style="flex:none;display:flex;align-items:center;gap:5px;font-size:${SIZE.secondary};font-weight:500;padding:6px 10px;border-radius:${RADIUS.button};background:${C.pill};color:${C.ink70};border:none;cursor:pointer;font-family:${FONT.ui};white-space:nowrap"><span class="asst-mic-dot" hidden style="width:6px;height:6px;border-radius:50%;background:${ACCENT.red};animation:blip 1.1s ease-in-out infinite"></span><span class="asst-mic-label">Say it</span></button>`;
}

export function composer(
  attached: string[] = [],
  opts: { room?: boolean; ghosts?: string[]; mode?: AskMode } = {},
): string {
  const chips = TRY_CHIPS.map(
    (t) =>
      `<div tabindex="0" role="button" data-chip="${esc(t)}" style="font-size:${SIZE.secondary};padding:5px 10px;border-radius:${RADIUS.button};background:${C.raised};color:${C.ink};cursor:pointer;white-space:nowrap">${esc(t)}</div>`,
  ).join("");

  /*
   * ATTACHED FOOTAGE RIDES WITH THE SENTENCE.
   *
   * The room holds the selection in the URL so it survives a page load; the
   * composer carries it into the request as hidden fields, so "tighten this"
   * with two videos attached means those two and nothing else. Hidden rather
   * than client state for the same reason the URL holds it: one copy of the
   * truth, and the server reads exactly what the page showed.
   */
  const carry =
    attached.map((id) => `<input type="hidden" name="sourceIds" value="${esc(id)}"/>`).join("") +
    /*
     * AND THE GHOSTS, in their own field.
     *
     * An attached external moment is a ledger id, not a source id. Putting
     * it in `sourceIds` would have it silently dropped by the ownership
     * check in /api/begin — the person attaches a find, presses Run it, and
     * the cut comes back without it and without a word. `ledgerIds` is read
     * separately and becomes a mission per moment: the ghost the prototype
     * promises when it says they "ride into the cut as ghosts until you
     * grab them".
     */
    (opts.ghosts ?? [])
      .map((id) => `<input type="hidden" name="ledgerIds" value="${esc(id)}"/>`)
      .join("");

  return `<form id="composer" method="POST" action="/api/begin" style="position:relative;margin-top:24px;background:${C.raised};border-radius:${RADIUS.composer};padding:6px;box-shadow:0 0 0 1px rgba(255,255,255,0.06), 0 12px 40px rgba(0,0,0,0.3)">${carry}
    <div id="dropHint" hidden style="position:absolute;inset:0;border-radius:${RADIUS.composer};box-shadow:inset 0 0 0 2px ${ACCENT.gold};background:rgba(217,179,106,0.07);pointer-events:none;display:flex;align-items:center;justify-content:center;z-index:2">
      <span style="font-size:${SIZE.body};font-weight:600;color:${ACCENT.gold}">Drop it here</span>
    </div>
    <!--
      THE ROOM'S COMPOSER SAYS SOMETHING DIFFERENT, because in the room there
      is footage on the right to attach and here there was not. Rendering the
      prototype beside the build is what showed it: mine still read "Say what
      you want out of it — or drop a video in first" and ended in "Begin →",
      which is the retired design's wording for a page that no longer exists.
    -->
    <textarea name="brief" id="brief" rows="2" placeholder="${opts.room ? "Attach footage on the right, or say what you want" : "Say what you want out of it — or drop a video in first"}" style="width:100%;box-sizing:border-box;background:transparent;border:none;outline:none;color:${C.ink};font-size:${SIZE.wordmark};padding:14px 14px 10px;resize:none;line-height:1.5;font-family:${FONT.ui}"></textarea>
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
        <input type="file" accept="video/*" multiple id="filePick" style="display:none"/>
      </label>
      <!--
        No chips in the room. One Take's composer is the text, the dial and
        the mic — the chips belong to the project state, where they are
        "Lose the house thread" and "Keep it under three minutes" rather than
        generic openers. Kept on the retired Home, which still has them.
      -->
      ${opts.room ? dial(opts.mode ?? DEFAULT_MODE) + roomMic() : ""}
      <!--
        THE SPACER IS A SPACER IN THE ROOM, and a chip tray on the retired
        Home. A flex basis of 200px asks for width it does not need when
        there are no chips in it, which pushed Ask and Run it onto a second
        line — the
        prototype's composer row is one line with the dial at the left and
        Run it at the right, and that was the only reason it was not.
      -->
      <div style="display:flex;gap:5px;flex-wrap:wrap;${opts.room ? "flex:1 1 0" : "flex:1 1 200px"};min-width:0">${opts.room ? "" : chips}</div>
      <!--
        TWO THINGS YOU CAN DO WITH ONE SENTENCE.
        
        The Manual puts them in the same breath on the front door: "attach
        footage and say it in a sentence. Ask it anything about your footage
        and it answers with the lines, timed." So this is not a second box —
        a question and a brief are both a sentence about your footage, and
        which one it is depends on which button you press.
        
        Not in the prototype, whose composer is the text, the dial and the
        mic. New UI, so 15-DESIGN-LANGUAGE decides: the quiet treatment,
        because Run it is still the thing most people came to press.
      -->
      <!--
        THE ROOM'S BUTTONS ARE THE PROTOTYPE'S SIZE, which is smaller than
        the retired Home's. Run it there is 12.5px at 6px/14px; this was
        13.5px at 9px/22px, and with the dial and the mic beside it the row
        no longer fitted the 360px column — Run it wrapped onto a line of its
        own, below a half-empty one. Measured by rendering it, not guessed.
      -->
      <!--
        THE TWO BUTTONS TRAVEL TOGETHER.
        
        One Take's composer row is one line: the dial, the mic, then Run it
        at the right. The build's room has two controls the prototype does
        not — the file picker and Ask, both argued for above — and at 360px
        the six of them do not fit on one line however small the buttons
        are. Measured by rendering it: they overflow by about 40px.
        
        So the row wraps, and what wraps is the PAIR. Left to itself it put
        Ask at the end of a full line and Run it alone on the next, which
        reads as a layout that broke rather than one that folded.
      -->
      ${opts.room
        ? `<span style="flex:none;display:flex;gap:8px;margin-left:auto">
            <button type="button" id="askBtn" style="flex:none;font-size:${SIZE.secondary};font-weight:500;padding:6px 14px;border-radius:5px;background:${C.pill};color:${C.ink70};cursor:pointer;white-space:nowrap;border:none;font-family:${FONT.ui}">Ask</button>
            <button type="submit" style="flex:none;font-size:${SIZE.secondary};font-weight:500;padding:6px 14px;border-radius:5px;background:${C.ink};color:#131316;cursor:pointer;white-space:nowrap;border:none;font-family:${FONT.ui}">Run it</button>
          </span>`
        : `<button type="submit" style="flex:none;font-size:${SIZE.body};font-weight:600;padding:9px 22px;border-radius:${RADIUS.button};background:${C.ink};color:#131316;cursor:pointer;white-space:nowrap;border:none;font-family:${FONT.ui}">Begin →</button>`}
    </div>
  </form>
  ${opts.room ? answerPanel() : ""}`;
}

/**
 * Where the answer lands, empty until something is asked.
 *
 * Rendered hidden rather than created by the client, so the shape of an
 * answer lives in the same file as the shape of everything else on this page
 * and the gate's wiring check can see it. client.ts fills the two children.
 */
function answerPanel(): string {
  return `<div id="askPanel" hidden style="margin-top:14px;background:${C.surface};border-radius:${RADIUS.card};padding:14px 16px">
    <div id="askLead" style="font-size:${SIZE.secondary};color:${C.ink70};line-height:1.5"></div>
    <div id="askLines" style="margin-top:12px;display:flex;flex-direction:column;gap:8px"></div>
  </div>`;
}

/*
 * The demo card is not rendered.
 *
 * It read "Don't have a video handy? Try it on ours. A 48-minute podcast,
 * already read. Twelve clips found" — and clicking it did nothing, because
 * there is no shared demo library and no account has that podcast in it. The
 * most prominent card on the most important page was a promise of content
 * that does not exist, attached to a control with no handler.
 *
 * It comes back when there is a real demo source to open, seeded for every
 * account. Same rule as the clean-up chips and "Queue it": it appears when it
 * works. See docs/decisions/empty-states.md.
 */

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
  /** The job's type, which decides the verb. */
  type: string;
  stage: string;
  pct: number;
  /**
   * What the job's own ITEMS say, when it has any — "6 of 14 done".
   *
   * Preferred over pct where it exists, because pct is written by whatever
   * stage is running and a stage that died at ninety per cent leaves a job
   * claiming work that never happened. Null means this job is not
   * item-tracked, which is not the same as nothing having happened.
   */
  says?: string | null;
}

/**
 * The verb this job contributes to Home's working line.
 *
 * NOT the job's stage_label. That is a standalone phrase for the source page —
 * "reading it" — and used here it produced "reading it a video", because this
 * line puts a filename straight after the verb. The prototype's line is
 * "reading jones_quartering_full (62%)", so the verb has to be a verb.
 */
const WORKING_VERB: Record<string, string> = {
  transcribe: "transcribing",
  score: "working through",
  pass: "working through",
  shorts: "burning captions on",
  render: "rendering",
  tts: "generating voice for",
};

function workingLine(jobs: WorkingJob[]): string {
  const things = jobs.length === 1 ? "1 thing" : `${jobs.length} things`;
  const byStage = new Map<string, WorkingJob[]>();
  for (const j of jobs) {
    const verb = WORKING_VERB[j.type] ?? "working on";
    if (!byStage.has(verb)) byStage.set(verb, []);
    byStage.get(verb)!.push(j);
  }
  const clauses = [...byStage.entries()].map(([verb, group]) => {
    const named = group.map((j) =>
      j.says ? `${j.label} (${j.says})` : j.pct > 0 ? `${j.label} (${j.pct}%)` : j.label,
    );
    const joined =
      named.length === 1 ? named[0] : `${named.slice(0, -1).join(", ")} and ${named.at(-1)}`;
    return `${verb} ${joined}`;
  });
  return `Working on ${things} — ${clauses.join(", ")}.`;
}

/** The section heading, with its count sitting right. */
function sectionHead(title: string, count: string): string {
  return `<div style="margin-top:48px;display:flex;align-items:baseline;justify-content:space-between;padding-left:4px">
    <div style="font-size:${SIZE.body};font-weight:600;color:${C.ink45};white-space:nowrap;flex:none">${title}</div>
    <span data-content style="font-size:${SIZE.secondary};color:rgba(236,236,241,0.3);white-space:nowrap;flex:none">${esc(count)}</span>
  </div>`;
}

/**
 * Exported for the room, for the same reason the composer is.
 *
 * It is wired by #workingRow and #workingLine and it POLLS — a second copy
 * that drifted would leave one surface showing a progress line that never
 * moves, which is worse than showing none at all, and no check catches it
 * because both ids would still exist somewhere.
 */
/** A job that has stopped, for the line under the running one. */
export interface FinishedJob {
  label: string;
  failed: boolean;
}

/**
 * WHAT FINISHED WHILE YOU WERE AWAY.
 *
 * The bell in the nav bar was the only place this was ever shown, and One
 * Take's bar has no bell — so it is here, beside what is still going, which
 * is where somebody looks to find out what the product is doing.
 *
 * A failure is named rather than counted. "2 finished" over a failed read is
 * the product being cheerful about bad news, and coming back to a silent gap
 * is worse than coming back to something that went wrong.
 */
/**
 * THE SAME THING, OVER AND OVER, IS ONE THING.
 *
 * The same rule `collapse` applies to the feed, and the first version of
 * this line did not: six failed reads of one video rendered as "Tuesday —
 * the kitchen one, Tuesday — the kitchen one, Tuesday — the kitchen one,
 * Tuesday — the kitchen one, Tuesday — the kitchen one and Tuesday — the
 * kitchen one didn't finish." Seen by rendering it. A repeated failure is
 * one problem you have hit repeatedly, and reading it six times does not
 * help you fix it.
 */
function names(jobs: FinishedJob[]): string[] {
  const seen = new Map<string, number>();
  for (const j of jobs) seen.set(j.label, (seen.get(j.label) ?? 0) + 1);
  return [...seen.entries()].map(([label, n]) => (n > 1 ? `${label} (${n} times)` : label));
}

const listed = (xs: string[]): string =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;

export function finishedLine(done: FinishedJob[]): string {
  const failed = done.filter((d) => d.failed);
  if (failed.length) {
    const rest = done.length - failed.length;
    return `${listed(names(failed))} didn't finish${rest ? ` — ${rest} other${rest === 1 ? "" : "s"} did` : ""}.`;
  }
  return `${listed(names(done))} finished.`;
}

export function workingRow(jobs: WorkingJob[], done: FinishedJob[] = []): string {
  const running = jobs.length > 0;
  /* Green and blinking while something is going; amber and still when the
     last thing to happen was a failure; otherwise the quiet dot of a thing
     that has stopped. The dot is the first thing read and must not claim
     work that is not happening. */
  const dot = running
    ? `background:${ACCENT.green};animation:blip 1.6s ease-in-out infinite`
    : done.some((d) => d.failed)
      ? `background:${ACCENT.red}`
      : `background:${C.ink32}`;
  const line = running ? workingLine(jobs) : finishedLine(done);
  return `<div id="workingRow" style="margin-top:16px;display:flex;align-items:center;gap:12px;padding:12px 16px;border-radius:${RADIUS.card};background:#141418;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.04)">
    <span style="width:6px;height:6px;border-radius:50%;${dot};flex:none"></span>
    <!-- data-content: this sentence is assembled around the user's own video
         titles, so it can never match the prototype's fixed wording. It was
         only passing the check while every title happened to be a filename
         the crawler skipped; auto-naming put real words in it. -->
    <span id="workingLine" data-content style="flex:1 1 240px;min-width:min(220px,100%);font-size:${SIZE.secondary};color:rgba(236,236,241,0.55)">${esc(line)}</span>
    <!-- Into the room's own Videos tab, not the retired Footage page it used
         to point at. Watching something read is a thing you do in the room. -->
    <a href="/?tab=videos" style="flex:none;font-size:${SIZE.secondary};font-weight:500;padding:6px 13px;border-radius:${RADIUS.button};background:${C.raised};color:${C.ink};cursor:pointer">Watch</a>
  </div>`;
}

/** Relative time, the way the feed's right-hand column reads it. */
function ago(ms: number): string {
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs}h` : `${Math.round(hrs / 24)}d`;
}

/**
 * The feed: what finished while you were away.
 *
 * Built from job rows, so it can only report work that actually ran. A failed
 * job is red and says what went wrong, because coming back to a silent gap is
 * worse than coming back to bad news.
 */
/**
 * The same thing, over and over, is one thing.
 *
 * Pressing Export on a source the encoder cannot read produces one job per
 * press, and the feed listed every one — six rows of "Couldn't give the
 * encoder a way to read your footage." A repeated failure is a single problem
 * you have hit repeatedly, and reading it six times does not help you fix it.
 */
function collapse(feed: FeedItem[]): Array<FeedItem & { times?: number }> {
  const out: Array<FeedItem & { times?: number }> = [];
  for (const f of feed) {
    const last = out[out.length - 1];
    if (last && last.text === f.text && last.state === f.state) {
      last.times = (last.times ?? 1) + 1;
      continue;
    }
    out.push({ ...f });
  }
  return out;
}

/**
 * What the heading counts.
 *
 * It said "6 finished" over six failures. Finishing and failing are different
 * news, and the number beside a section heading is the one thing people read
 * before deciding whether to look at all.
 */
function awayCount(feed: FeedItem[]): string {
  const bad = feed.filter((f) => f.state === "failed").length;
  const ok = feed.length - bad;
  return [ok ? `${ok} finished` : "", bad ? `${bad} failed` : ""].filter(Boolean).join(" · ");
}

function feedRow(f: FeedItem & { times?: number }): string {
  const failed = f.state === "failed";
  return `<div style="display:flex;align-items:center;gap:14px;padding:14px 16px;border-radius:${RADIUS.card};background:${C.surface}">
    <span style="width:6px;height:6px;border-radius:50%;background:${failed ? ACCENT.red : ACCENT.green};flex:none"></span>
    <span data-content style="flex:1;font-size:${SIZE.body};color:rgba(236,236,241,0.85);min-width:0">${esc(f.text)}${
      /* How many times, when it happened more than once. The count is the
         useful part: one failure is a mishap, six is a thing that will keep
         happening until you change something. */
      f.times && f.times > 1
        ? ` <span style="color:rgba(236,236,241,0.35);font-family:${FONT.mono};font-size:${SIZE.meta}">×${f.times}</span>`
        : ""
    }</span>
    <span data-content style="font-size:${SIZE.secondary};color:rgba(236,236,241,0.28);font-family:${FONT.mono};flex:none">${ago(f.at)}</span>
    ${f.href ? `<a href="${esc(f.href)}" style="font-size:${SIZE.secondary};font-weight:500;padding:6px 14px;border-radius:${RADIUS.button};background:${C.raised};color:${C.ink};flex:none;white-space:nowrap">${esc(f.link ?? "Open")}</a>` : ""}
  </div>`;
}

/** In motion — what is part-made, with how far along it is. */
/** The prototype's three states, with its own words and its own colours. */
const MOTION_STATE: Record<MotionItem["state"], [string, string]> = {
  needsyou: ["needs you", ACCENT.gold],
  ready: ["ready to render", ACCENT.green],
  idle: ["not started", "rgba(236,236,241,0.4)"],
};

function motionRow(p: MotionItem): string {
  const [label, colour] = MOTION_STATE[p.state];
  return `<a href="/p/${esc(p.id)}/cut" style="display:flex;align-items:center;gap:14px;padding:14px 16px;border-radius:${RADIUS.card};background:${C.surface}">
    <div style="flex:none;width:64px;aspect-ratio:16/9;border-radius:${RADIUS.button};overflow:hidden;background:#0B0B0E">${
      p.poster_r2_key
        ? `<img loading="lazy" src="/media/${esc(p.poster_r2_key)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block"/>`
        : ""
    }</div>
    <div style="flex:1;min-width:0">
      <div data-content style="font-size:${SIZE.body};font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.title)}</div>
      <div data-content style="font-size:${SIZE.secondary};color:rgba(236,236,241,0.4);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.needs)}</div>
    </div>
    <span data-content style="flex:none;font-size:${SIZE.secondary};color:${colour};white-space:nowrap">${label}</span>
  </a>`;
}

/**
 * A video, on Home.
 *
 * Goes to the VERB url, the same one Footage's own cards use, so clicking one
 * lands you in the editor rather than on a page about the file.
 */
function footageCard(f: FootageItem): string {
  return `<a href="/sources/${esc(f.id)}/edit" style="flex:none;width:150px;border-radius:${RADIUS.card};background:${C.surface};overflow:hidden;display:block">
    <div style="width:100%;aspect-ratio:16/9;background:#0B0B0E;position:relative">
      ${
        f.poster_r2_key
          ? `<img loading="lazy" src="/media/${esc(f.poster_r2_key)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block"/>`
          : ""
      }
      ${
        f.duration_s
          ? `<span data-content style="position:absolute;right:4px;bottom:4px;font-size:${SIZE.pill};font-family:${FONT.mono};background:rgba(0,0,0,.6);border-radius:3px;padding:1px 5px;color:${C.ink}">${hms(f.duration_s)}</span>`
          : ""
      }
    </div>
    <div data-content style="padding:9px 10px;font-size:${SIZE.meta};color:${C.ink70};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.title)}</div>
  </a>`;
}

export interface FeedItem {
  text: string;
  at: number;
  state: string;
  href?: string;
  link?: string;
}

/**
 * One edit you have on the go.
 *
 * `pct` and `next_action` used to drive this and NOTHING EVER WROTE EITHER —
 * every project sits at pct 0 with a null next_action, so the filter
 * `pct > 0 && pct < 100` was always empty and this section has never once
 * appeared. It is computed from the blocks now, which is where the truth was
 * all along: the editor has been showing exactly these numbers.
 */
export interface MotionItem {
  id: string;
  title: string;
  poster_r2_key: string | null;
  /** "2 voiceovers to go." / "every beat is filled." — buildSummary's line. */
  needs: string;
  /** The prototype's own three: needs you / ready to render / not started. */
  state: "needsyou" | "ready" | "idle";
}

/** One video, for the strip that lets Home start a cut without a detour. */
export interface FootageItem {
  id: string;
  title: string;
  poster_r2_key: string | null;
  duration_s: number | null;
}

export interface HomeData {
  name: string | null;
  isFresh: boolean;
  working: WorkingJob[];
  /** Sources that arrived since the user was last here. Real count, or zero. */
  landedOvernight: number;
  /** What finished while they were away. */
  feed: FeedItem[];
  /** What is part-made. */
  motion: MotionItem[];
  /** Recent videos, so a cut can be started from here. */
  footage: FootageItem[];
}

export function renderHome(d: HomeData): string {
  return `<div style="font-size:clamp(24px,6vw,32px);font-weight:600;letter-spacing:-0.025em;line-height:1.2">What are we making today?</div>
<div data-content style="font-size:${SIZE.body};color:rgba(236,236,241,0.42);margin-top:8px">${esc(greeting(d.name, d.isFresh, d.landedOvernight))}</div>
${composer()}
<div style="margin-top:16px;font-size:${SIZE.secondary};color:rgba(236,236,241,0.3);padding-left:4px">A full cut, a few shorts, a cleanup — it works out the job and checks with you first.</div>
${
  /*
   * YOUR WORK LEADS.
   *
   * The prototype ends the page with this and opens with the feed — but its
   * feed is three hardcoded demo notifications, laid out against a demo
   * account. On a real one the log is long and inert, and the edits are what
   * you came back for. "Pick up where you left off" is the prototype's own
   * phrase, borrowed from Projects.
   */
  d.motion.length
    ? sectionHead("Pick up where you left off", `${d.motion.length}`) +
      `<div style="margin-top:16px;display:flex;flex-direction:column;gap:6px">${d.motion.map(motionRow).join("")}</div>`
    : ""
}
${
  d.isFresh
    ? ""
    : sectionHead("Since you were away", awayCount(d.feed)) +
      (d.working.length ? workingRow(d.working) : "") +
      `<div style="margin-top:16px;display:flex;flex-direction:column;gap:6px">${
        d.feed.length
          ? collapse(d.feed).map(feedRow).join("")
          : `<div style="padding:16px 18px;border-radius:${RADIUS.card};background:${C.surface};font-size:${SIZE.body};color:${ACCENT.green}">All caught up — nothing waiting on you.</div>`
      }</div>`
}
${
  /* And the footage, so a cut can start here rather than after a detour. */
  d.footage.length
    ? sectionHead("Footage", `${d.footage.length}`) +
      `<div style="margin-top:16px;display:flex;gap:8px;overflow-x:auto;padding-bottom:4px">${d.footage.map(footageCard).join("")}</div>`
    : ""
}
${d.isFresh ? howThisGoes() : ""}`;
}
