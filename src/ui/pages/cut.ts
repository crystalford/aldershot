/**
 * The editor. One surface.
 *
 * There were four — Pick what stays, Build, Script, Shorts from this — and the
 * owner's verdict was that they felt like the same thing badly divided:
 *
 *   "What happened to the building blocks thing that i could add stuff in
 *    between or shift things around .. like then i click build and theres
 *    nothing there.. and then cut is just basically the same thing"
 *
 * They were the same thing. Pick and Script both strike the same cuts, one by
 * line and one by word. Build held the reorder and insert gestures but only
 * ever showed anything once a scoring pass had made beats, so the "building
 * blocks" were real and unreachable. See docs/decisions/blocks.md.
 *
 * This renders the sequence from src/blocks.ts and offers all five verbs in
 * one place: strike a line, strike a word inside it, move a block, insert one,
 * and export. The video sits beside it and any block plays itself.
 */

import { C, ACCENT, FONT, RADIUS, SIZE, accentBg } from "../tokens.ts";
import { esc } from "../shell.ts";
import { iconArrowDown, iconArrowUp, iconPause, iconPlay, iconPlus, iconSearch } from "../icons.ts";
import { hms, tc } from "./footage.ts";
import { itemMenu } from "../item-menu.ts";
import { wordStruck, type Block } from "../../blocks.ts";
import { ORDERS, type Order } from "../../rules.ts";
import { wordEndMs, wordStartMs, type Cut } from "../../cuts.ts";
import {
  DIMENSION_NAME,
  GRADE_NAME,
  grade,
  gradeForScore,
  opening,
  reads,
  type Grade,
  type Graded,
} from "../../shorts.ts";
import { ASPECTS, CAPTION_STYLES } from "../../render-job.ts";
import { dial } from "./home.ts";
import { DEFAULT_MODE, type AskMode } from "../../decide.ts";
import { blockStrip, CHIP_COLOURS, keyHints, letterFor, sourceChips, switcher, type ChipSource, type SwitchItem } from "../switcher.ts";

/**
 * TWO WAYS TO READ THE SAME EDIT.
 *
 * "blocks" is the card list — a thing per line, with its frame, its verbs and
 * a + between each. "script" is the same edit as something you read: the words
 * flowing, everything else out of the way until you are on a line.
 *
 * They render the SAME dom — the same .blk wrappers, the same .w spans, the
 * same data attributes, the same seams. Only styling and the thumbnail differ.
 * That is not tidiness: paintBlock, here(), retotal and every strike, move and
 * short branch in the client key off .blk, so a view that dropped it would
 * silently lose half the editor. One contract, two readings, nothing in
 * src/ui/client.ts changed at all.
 */
/*
 * THE CENTRE'S TABS. One Take names four — Footage · Blocks · Words · Shorts.
 *
 * All four now. Shorts waited because its tab lists candidates graded
 * Strong / Worth a look / Long shot with a reason for each, and a tab
 * holding a list the product could not grade would be a promise in a tab
 * bar — the thing the conventions check exists to stop.
 *
 * WHAT GRADES THEM IS NOT A MODEL. The grading turned out to be the
 * self-sufficiency test itself (src/shorts.ts): a line that stops
 * mid-sentence or opens on a word pointing off-screen is a Long shot, and
 * the reason is the fact rather than an opinion about it. Deterministic,
 * which is the house rule, and it makes the reason exact.
 *
 * `script` keeps its name in the URL — /p/:id/script is an existing link —
 * and reads as WORDS in the bar, which is what the prototype calls it and
 * what it always meant.
 */
export type CutView = "footage" | "blocks" | "script" | "shorts";

/**
 * Footage's three tabs inside a project.
 *
 * A declared union because scripts/surfaces.cjs reads it: the crawl visits
 * `/p/:id/footage?tab=<each>` derived from this line. A hand-kept list over
 * there goes stale the first time a tab is added, and a tab no crawl visits
 * is a tab no check has ever read a word of — which is how ten surfaces in
 * this product went unexamined for a month.
 */
export type ProjFootTab = "videos" | "moments" | "made";

export interface CutData {
  projectId: string;
  /** Which reading. Defaults to blocks everywhere it is not asked for. */
  view?: CutView;
  /**
   * Every project, for the switcher beside the title. Optional so a caller
   * that predates it renders the title with an empty list rather than
   * failing to compile — the panel then offers only the way back to the
   * room, which is still true.
   */
  projects?: SwitchItem[];
  /**
   * The videos this cut draws on, in the order it first uses them — the
   * lettered chips in the title row. Optional for the same reason
   * `projects` is: a caller that predates it renders no chips, which is
   * true of a cut nothing has been assembled into.
   */
  sources?: ChipSource[];
  /**
   * Which video each block came from, keyed by block id — for the strip
   * under the player, which colours by source. A block with no entry is
   * this project's own source, the same rule mediaKey follows.
   */
  blockSource?: Record<string, string>;
  /**
   * How much the assistant decides — the composer's dial (src/decide.ts).
   *
   * The same stored preference the room's composer sets, because the
   * prototype has ONE composer and one dial; the build has two composers,
   * and two dials disagreeing about the same setting would be worse than
   * none. Optional so every caller that predates it keeps the behaviour it
   * had, which is Recommend.
   */
  askMode?: AskMode;
  title: string;
  sourceId: string | null;
  /** What the footage is called, for the line that links back to it. */
  sourceTitle: string | null;
  sourceKey: string | null;
  /** The video's own shape, so a vertical source is not drawn as 16:9. */
  aspect?: string;
  posterKey: string | null;
  blocks: Block[];
  cuts: Cut[];
  runtimeMs: number;
  keptCount: number;
  plan: string;
  /**
   * What each clean-up would do to THIS cut, counted for real.
   *
   * The design's rule: "47 found · −0:04", not "several". A chip that cannot
   * count honestly shows its plain label and is disabled — none of these need
   * to, because fillerCuts and pauseCuts find real words and real gaps and
   * timeSaved measures them through the same ranges the render uses.
   */
  /**
   * How many blocks to render up front. The rest come in on scroll.
   *
   * Enough to fill a tall screen and scroll a little before the next slice is
   * asked for, small enough that an hour-long source is a normal page.
   */
  windowSize: number;
  cleanups: {
    fillers: { found: number; savedMs: number };
    pauses: { found: number; savedMs: number };
  };
  /** The inserted blocks, for the "what still needs you" line in the footer. */
  /*
   * `text` is here so the recording note can say WHICH beat is next. "2 of 4
   * recorded" without it is a number nobody can act on, and the prototype's
   * line names the line you still owe.
   */
  beats: Array<{ kind: string; media_r2_key: string | null; clip_id: string | null; struck?: unknown; text?: string | null }>;
  /**
   * EVERY TAKE ON A BEAT, newest first, keyed by beat id.
   *
   * Recording again used to overwrite the one before it. It does not now
   * (invariant 6, and a performance is the one thing the engine cannot
   * re-make) — so the beat has a history, and the only way that is worth
   * anything is if you can see it and pick one.
   *
   * Absent on a beat with one take: a list of one is a list of nothing, and
   * every other surface in this product goes absent rather than showing a
   * count of one.
   */
  takes?: Record<string, Array<{ id: string; dur_ms: number | null; verdict: string | null; chosen: boolean }>>;
  /** Live pass, when the model is still reading. */
  job: { state: string; pct: number; stage_label: string | null; error: string | null } | null;
  /**
   * Every moment in the library, seen THROUGH THE RULES.
   *
   * The Footage tab inside a project is not the library — it is the library
   * with the cut's verdict on each moment: in and which rule put it there, or
   * out and which rule took it, and that one is clickable because disagreeing
   * with a rule is the point.
   */
  moments: Array<{
    id: string;
    quote: string;
    source_title: string;
    in: boolean;
    note: string;
    /**
     * The two rules that disagreed about this moment, by their numbers.
     *
     * src/rules.ts has recorded this since the engine was ported and nothing
     * in src/ui/ read it, so a cut where two of your own rules contradict each
     * other looked exactly like one where they agree. Null on almost every
     * moment, which is why it has to be shown LOUDLY when it is not.
     */
    contest?: { k: string; d: string; kId: string } | null;
    /**
     * WHICH RULE, BY ID, put this moment in or took it out.
     *
     * `note` says it in words — "out · rule 02 · click to keep" — and words
     * are what a person reads, not what a count can be made from. The pane
     * needs to know that rule 02 took out four moments, and that rule 03 took
     * out none and kept none and is therefore doing nothing at all. Parsing
     * the sentence back into a number to find that out would make the two
     * disagree the first time the sentence changed.
     *
     * Null when a hand decision did it, because a hand decision is not a rule
     * and neither offer applies to one.
     */
    byRule?: string | null;
    dropRule?: string | null;
    /**
     * WHICH RECORDING, WHERE IN IT, AND HOW LONG — the row's identity.
     *
     * The tab was a list of sentences with a verdict beside each. The
     * prototype's row is a moment: the source's letter in the source's own
     * colour, the position in that recording, the duration. Without them two
     * similar lines from two videos are indistinguishable, and there is no
     * way to tell a four-second aside from a forty-second argument.
     *
     * `sourceId` rather than a letter, because the letter comes from the
     * project's ordered source list — the same `letterFor` the chips beside
     * the title and the Words gutter use. Three places saying B about one
     * recording is the point.
     */
    sourceId?: string | null;
    startMs?: number;
    durMs?: number;
    /** The thread it was filed under, for the chips above the list. */
    thread?: string | null;
  }>;
  /**
   * Videos this cut is NOT drawing on, and could.
   *
   * Empty when the cut has no scope — it already draws on everything, so
   * there is nothing to add and offering to would be a control that cannot
   * do anything.
   */
  addable: Array<{ id: string; title: string }>;
  /**
   * WHICH OF FOOTAGE'S THREE TABS IS OPEN.
   *
   * The prototype's Footage surface keeps its tabs inside a project, and the
   * build had only the middle one — so the per-video view, where "Only this"
   * lives, had nowhere to be. In the URL rather than the page, because the
   * three tabs are three different readings of the cut and a link to one of
   * them should arrive at it.
   */
  footageTab?: ProjFootTab;
  /**
   * EVERY VIDEO THIS CUT IS MADE OF, whether or not it is using any of them.
   *
   * Not `sources`, which is the videos the cut DRAWS ON, in the order it
   * first uses them — the lettered chips. A video attached and contributing
   * nothing is absent from that list and is the most useful row this tab
   * has: "0 of 5 moments in this cut" is the answer somebody opened Videos
   * to get, and a list built from what the cut uses can never say it.
   */
  cutSources?: ChipSource[];
  /**
   * Narrowed to this one video, or null for all of them.
   *
   * Read, not computed: `scopeOf` already narrows what the engine cuts from,
   * so the only thing the page needs is which video the control is currently
   * saying "Only this ✓" about.
   */
  onlySourceId?: string | null;
  /**
   * WHICH RULE PUT EACH BLOCK HERE, keyed by block id.
   *
   * The product's whole claim is that you can see why a moment is in the cut.
   * The rules pane said it at the top of the column and every block below it
   * stayed silent, so the answer was available and never attached to the
   * thing it was about. The prototype puts "rule 01" on the block.
   */
  blockRule: Record<string, string>;
  /**
   * The blocks two rules disagreed about, so the gold mark can go on them.
   *
   * The note beside the cut's numbers says "marked in the blocks" — a promise
   * this is what keeps.
   */
  blockContested?: Record<string, true>;
  /**
   * WHICH TWO RULES DISAGREED ABOUT THIS BLOCK, and which way it went.
   *
   * The gold edge says a judgement call was made here and names nothing.
   * The conflicts panel in the rules pane settles the two rules IN GENERAL
   * — "whenever these two disagree, this one is right" — and this is the
   * other half: one moment, in front of you, both rules named, and both
   * answers a press away. They are different decisions and the product
   * needs both; collapsing them would make a standing rule out of one
   * line's worth of doubt.
   *
   * `momentId` because the answer is a HAND decision on the moment, which
   * overrides every rule above it (step 6 of the engine) and is what makes
   * a second control possible at all.
   */
  blockJudgement?: Record<
    string,
    { k: string; d: string; kept: boolean; byHand: boolean; momentId: string }
  >;
  /**
   * Which short is in front of you, from ?short=.
   *
   * A URL rather than client state so the back button works, a link to one
   * short is a link to one short, and a crawl can reach the workbench at all.
   */
  shortId?: string | null;
  /** The length band and the count, from ?len= and ?count=. */
  shortLen?: string | null;
  shortCount?: number | null;
  /** "2:04 · 3 blocks · from 2 videos · one thread at a time". */
  cutLine: string;
  /** Every instruction given to the model on this cut, and what came of it. */
  passes: Array<{ id: string; n: number; instruction: string; result: string; undoable: boolean; first_change: string | null }>;
  /**
   * The rules that produced this cut, when it was made from rules at all.
   *
   * Empty for every edit that began with a video, because those are still the
   * staged editor's and have no rule set. An assembled cut has one.
   */
  /**
   * The rules, as the pane shows them.
   *
   * `kind` and `order` are here for the one rule that has alternatives: an
   * order rule offers the other two orders, which is a choice you make by
   * pressing rather than by typing a sentence that parses to the same
   * thing. Optional, because every other kind has neither.
   */
  rules: Array<{
    id: string;
    text: string;
    on: boolean;
    effect: string;
    hand: boolean;
    kind?: string;
    order?: Order;
    /**
     * The moment a hand fix is about, so undoing it has something to post to.
     *
     * A hand fix IS a rule — that is how the engine makes "keep this one
     * whatever the rules say" survive a recompute — but it is undone through
     * the moment it names, because pressing the same decision again takes the
     * hand back (see POST /api/projects/:id/moments/:momentId). Only hand
     * rules have one.
     */
    cid?: string | null;
  }>;
}

/**
 * THE LINES THAT ARE ONLY THERE WHEN THEY ARE TRUE.
 *
 * Beside the cut's own numbers the prototype puts up to three short notes with
 * a coloured dot each — what is still to record, what the sound pass did, and
 * how many moments two rules disagreed about. The build had none of them,
 * while computing two.
 *
 * ABSENT RATHER THAN ZERO. "0 judgement calls" is a sentence that makes a
 * person look for something that is not there, so a note with nothing to say
 * is not rendered at all. That is the prototype's own rule — every push is
 * inside an `if`.
 */
function cutNotes(d: CutData): string {
  const note = (text: string, color: string, dot: string) =>
    `<span title="${esc(text)}" style="flex:none;display:inline-flex;align-items:center;gap:5px;font-size:10.5px;color:${color};white-space:nowrap"><span style="width:5px;height:5px;border-radius:50%;background:${dot}"></span><span data-content>${esc(text)}</span></span>`;

  const out: string[] = [];

  /*
   * WHAT IS LEFT TO RECORD. The beats are already counted — buildSummary has
   * done it since voice beats landed — and the count reached the screen only
   * as a single gold phrase at the end of a line. The prototype says which
   * beat is next, because "2 of 4 recorded" without it is a number you cannot
   * act on.
   */
  const voice = d.beats.filter((b) => (b.kind === "vo" || b.kind === "react") && !(Boolean(b.struck) && b.struck !== "0"));
  if (voice.length) {
    const done = voice.filter((b) => b.media_r2_key).length;
    if (done >= voice.length) {
      out.push(note(`All ${voice.length} recorded — ready to render`, ACCENT.green, ACCENT.green));
    } else {
      const next = voice.find((b) => !b.media_r2_key);
      const line = (next?.text ?? "").slice(0, 38);
      out.push(note(`${done} of ${voice.length} recorded — next: ${line}…`, ACCENT.gold, ACCENT.gold));
    }
  }

  /*
   * THE SOUND NOTE, AND IT DOES NOT SAY WHAT THE PROTOTYPE SAYS.
   *
   * The prototype's line is "Levels matched across 3 sources", and this
   * product cannot honestly claim it. src/loudness.ts normalises the
   * PROGRAMME once, applied to the finished mix in container/render.mjs,
   * whose own comment explains why normalising each part separately is the
   * wrong thing to do. "Matched across 3 sources" asserts a per-source pass
   * that does not exist.
   *
   * So the line says what the pipeline actually does. Changing a sentence
   * costs a line; building per-source gain staging costs a render-pipeline
   * change and a new measurement, right before a container that has never
   * been built once. The divergence is written down in 12-DEFERRED.md.
   */
  const videos = new Set(
    d.blocks.filter((b) => !b.struck && b.origin === "footage").map((b) => b.mediaKey ?? d.sourceId ?? "own"),
  ).size;
  if (videos > 1) out.push(note("Loudness set for the platform", C.ink70, ACCENT.cyan));

  /* The disagreements, counted. */
  const contested = d.moments.filter((m) => m.contest).length;
  if (contested) {
    out.push(
      note(
        `${contested} judgement call${contested === 1 ? "" : "s"} — marked in the blocks`,
        "rgba(217,179,106,0.9)",
        "rgba(217,179,106,0.6)",
      ),
    );
  }

  return out.join("");
}

/**
 * WHAT THE THREE GESTURES DO, under the script.
 *
 * Verbatim from the prototype, and all three are promises this page has to
 * keep: a word strikes and stays readable (it does — struck words are drawn
 * through, not removed, because nothing is deleted), a paragraph seeks the
 * player, and gold is a line you say to camera. The strings check holds the
 * words and the `strings` promise rule holds the first one to something
 * pressable.
 */
function wordsLegend(): string {
  const quiet = "rgba(236,236,241,0.3)";
  const lit = "rgba(236,236,241,0.5)";
  return `<div style="margin-top:9px;display:flex;gap:14px;flex-wrap:wrap;font-size:11.5px;color:${quiet}">
    <span><span style="color:${lit}">click a word</span> — the video skips it, the word stays readable</span>
    <span><span style="color:${lit}">click a paragraph</span> — the player jumps to it</span>
    <span><span style="color:${ACCENT.gold}">gold</span> is you, to camera</span>
  </div>`;
}

/**
 * One block.
 *
 * The words are individually clickable, which is Descript's gesture and was
 * previously only available on a separate tab. Striking a word removes video —
 * the render is built from the surviving ranges — so it has to be here, on the
 * surface where you are reading, not one navigation away.
 */
/**
 * WHICH VIDEO A BLOCK CAME FROM, as a letter, a colour and a time.
 *
 * Shared by the Words gutter and the Shorts credit line, because both say the
 * same fact and a page where one says B and the other says C about the same
 * recording is worse than one that says neither. Same ordered list, same
 * letterFor, same CHIP_COLOURS as the chips beside the title.
 */
function sourceIndex(d: CutData): Map<string, number> {
  return new Map((d.sources ?? []).map((sc, i) => [sc.id, i]));
}

function markOf(d: CutData, order: Map<string, number>, b: Block): { letter: string; colour: string; idx: number | undefined } {
  const sid = (d.blockSource ?? {})[b.id] ?? d.sourceId ?? "";
  const idx = order.get(sid);
  return {
    letter: idx === undefined || (d.sources ?? []).length < 2 ? "" : letterFor(idx),
    colour: idx === undefined ? C.ink45 : CHIP_COLOURS[idx % CHIP_COLOURS.length],
    idx,
  };
}

/**
 * WHAT THE GUTTER SAYS, in Words.
 *
 * The prototype puts a 56px mono column to the left of every line carrying the
 * source's LETTER and the timestamp — "A 6:40" — in that source's own colour,
 * or the word `you` in gold for a line you record to camera. It is the only
 * thing on the page that says which video you are reading, and the build had
 * nothing: it put a grey duration UNDER each line instead, which answers a
 * question nobody asked and leaves the one that matters unanswered.
 */
export interface Gutter {
  text: string;
  color: string;
}

/**
 * WHERE A BEAT SITS, which the recorder never said.
 *
 * Reading a line to camera is the one thing in this product you cannot undo
 * by pressing something — you have to say it again — and the editor asked for
 * it with the line and nothing else. The prototype puts the context on the
 * beat: which one of how many, what it comes after, and what it runs into.
 *
 * Every field is already in `renderCut`: a beat's neighbours are the blocks
 * either side of it in the list it is being drawn from.
 */
export interface BeatContext {
  /** This beat's number among the beats, and how many there are. */
  n: number;
  of: number;
  /** The line before it, and where to watch that line from. */
  afterText: string;
  afterAt: string;
  afterStart: number;
  afterMedia: string;
  /** The line after it, and where it is. Empty when this beat ends the cut. */
  thenText: string;
  thenAt: string;
}

function blockRow(
  b: Block,
  cuts: Cut[],
  i: number,
  total: number,
  view: CutView = "blocks",
  rule = "",
  mark: Gutter | null = null,
  contested = false,
  beat: BeatContext | null = null,
  judgement: { k: string; d: string; kept: boolean; byHand: boolean; momentId: string } | null = null,
  takes: Array<{ id: string; dur_ms: number | null; verdict: string | null; chosen: boolean }> = [],
): string {
  const script = view === "script";
  const struck = b.struck;

  /* A footage block shows its words so each can be struck. A recording has no
     transcript of its own, so it shows what it is instead. */
  /*
   * A PULLED CLIP'S WORDS ARE ITS OWN VIDEO'S.
   *
   * They live in displayWords rather than words, because a cut can never be
   * stored against them (see fromPulled), so they are shown and clickable but
   * not strikeable — the block strikes whole, which is what its Cut button has
   * always done. data-cut is never set on them for the same reason.
   */
  const shown = b.words.length ? b.words : (b.displayWords ?? []);
  const readOnly = !b.words.length && shown.length > 0;

  const body =
    b.origin === "footage" && shown.length
      ? shown
          .map((w, wi) => {
            const gone = struck || (!readOnly && wordStruck(cuts, b, wi));
            /* The word's own timings, in milliseconds, on the word.
               This is what makes the transcript a scrub bar: clicking a word
               seeks to it, and the word being spoken lights up as it plays.
               Both need to know where a word IS, and the DOM is the only place
               the client can ask. */
            /* data-cut is the client's own record of a struck word, and it
               has to be right on FIRST paint: the selection counter excludes
               already-struck words, and without this it would count them again
               and quote a saving the video cannot give. */
            return `<span class="w" data-content data-block="${esc(b.id)}" data-word="${wi}"${gone ? ' data-cut="1"' : ""} data-s="${wordStartMs(w)}" data-e="${wordEndMs(w)}" style="cursor:pointer;${
              gone ? "color:rgba(236,236,241,0.28);text-decoration:line-through;" : ""
            }">${esc(w.w)}</span>`;
          })
          .join(" ")
      : /*
         * An inserted block, and the reason this is a form rather than a label.
         *
         * It used to render the words "Your voice" next to a pill that also
         * said "Your voice", and that was the whole block: you could add one
         * and then do nothing with it. The building blocks were back and still
         * inert.
         *
         * Writing the line comes first because both ways of filling it need
         * it — recording reads it back to you, and TTS refuses without it.
         */
        `<textarea class="blk-text" data-content data-beat="${esc(b.id.slice(2))}" rows="2" placeholder="What you want to say here…"
          style="width:100%;box-sizing:border-box;background:transparent;border:none;outline:none;resize:none;padding:0;color:rgba(236,236,241,0.9);font-family:${FONT.ui};font-size:${SIZE.quote};line-height:1.5;${
            struck ? "text-decoration:line-through;" : ""
          }">${esc(b.text ?? "")}</textarea>`;

  /*
   * THE MODEL'S OPINION, AS A WORD. Invariant 3: "Reasons, not scores. No
   * percentage reaches a user. Strong / Worth a look / Long shot, with the
   * line that caused it."
   *
   * This was `${b.score}` — a bare 70 in a green badge, on every judged
   * block, for as long as blocks have had scores. A number is exactly what
   * the invariant forbids: it reads as precision the scorer does not have,
   * and it gives a person nothing to disagree with. The word is the same
   * one the shorts list uses, so there is one vocabulary; the line that
   * caused it is already here, in the rule chip and the reason under the
   * text.
   *
   * Absent is still absent. A score of 0 is the absence of a verdict rather
   * than a bad one — saveClips writes it for anything unrated — so an
   * unjudged block shows no word, which is what gradeForScore returns null
   * for.
   */
  const verdict = gradeForScore(b.score);
  const GRADE_INK: Record<string, string> = {
    strong: ACCENT.green,
    worth: C.ink70,
    long: C.ink45,
  };
  const judged = verdict
    ? `<span data-content style="flex:none;font-size:${SIZE.pill};font-weight:600;padding:2px 6px;border-radius:4px;background:${
        verdict === "strong" ? accentBg(ACCENT.green) : C.pill
      };color:${GRADE_INK[verdict]};white-space:nowrap">${GRADE_NAME[verdict]}</span>`
    : "";

  const originTag =
    b.origin === "footage"
      ? ""
      : `<span data-content style="display:inline-block;font-size:${SIZE.pill};padding:2px 6px;border-radius:4px;margin-right:7px;vertical-align:middle;background:${accentBg(ACCENT.gold)};color:${ACCENT.gold}">${b.origin === "voice" ? "Your voice" : "Visual"}</span>`;

  const arrow = (dir: -1 | 1, disabled: boolean) =>
    `<button class="blk-move" data-block="${esc(b.id)}" data-dir="${dir}" ${disabled ? "disabled" : ""}
      aria-label="${dir === -1 ? "Move earlier" : "Move later"}"
      style="width:24px;height:24px;display:grid;place-items:center;border-radius:${RADIUS.button};background:transparent;border:none;color:${C.ink45};cursor:pointer;${disabled ? "opacity:.25;cursor:default;" : ""}">${
        dir === -1 ? iconArrowUp({ size: 11 }) : iconArrowDown({ size: 11 })
      }</button>`;

  /*
   * The OpusClip gesture, on any block you like.
   *
   * "A 9:16 export of one strong block IS an OpusClip short. It should not
   * need a separate place, a separate table, or a separate word."
   * (docs/decisions/blocks.md). So it is a control on the block, not a
   * surface — and it is on EVERY block, not only the ones the model scored,
   * because being able to disagree with the model is the point.
   *
   * A recording has no range in the source to make vertical, so it does not
   * get the control rather than getting one that fails.
   */
  const short =
    b.origin === "footage" && b.end_ms > b.start_ms
      ? `<button class="blk-short" data-block="${esc(b.id)}"
        style="background:none;border:none;padding:0 2px;cursor:pointer;font-family:${FONT.ui}"><span class="seg-pill">Make a short</span></button>`
      : "";

  /*
   * WHAT COULD GO ON THIS LINE.
   *
   * Invariant 8's other half. `allowed()` has refused a generated card over
   * a claim since it was written; nothing ever OFFERED one, so doc 08's
   * table chose between candidates only in its tests.
   *
   * On a line with words and not on a recording, which has no line to be
   * about. The answer opens under the block — see the handler in
   * src/ui/client.ts — and leads with what it refused and why, because doc
   * 08's premise is that the picture answers "why am I seeing this" and the
   * alternatives are half of that answer.
   */
  const picture = b.text.trim()
    ? `<button class="blk-picture" data-block="${esc(b.id)}"
        style="background:none;border:none;padding:0 2px;cursor:pointer;font-family:${FONT.ui}"><span class="seg-pill">What goes here</span></button>`
    : "";

  /*
   * The thumbnail.
   *
   * The prototype gives every block a 78px frame with a play badge and its
   * timecode on it, and clicking it jumps the preview. I shipped a bare
   * monospace timecode instead and the surface read as a list of paragraphs
   * — the owner's words: "the text is not even proper.. we had a better
   * design before".
   *
   * The frame is painted client-side by seeking the source video and drawing
   * to this canvas (src/ui/client.ts), because per-block frames are not
   * extracted anywhere yet and showing the SAME source poster on all 24 rows
   * would be worse than showing none. The badge and timecode are server-
   * rendered, so the control is complete and legible before any of that runs
   * and stays so if it never does.
   */
  /*
   * data-media is the PREVIEW key, not the render key.
   *
   * A block pulled in from another video is a different file, and both the
   * frame and the play button have to know that. The canvas did not carry it
   * at all, so paintMoments fell through to the main player's src and drew a
   * frame of THIS project's video at the other video's timecode; the button
   * carried it and the handler ignored it, so pressing play seeked the main
   * player. Same bug twice, in opposite directions.
   */
  const thumb = `<button class="blk-play" data-start="${b.start_ms}" data-media="${esc(b.previewKey ?? "")}"
      aria-label="Play from ${tc(b.start_ms / 1000)}"
      style="flex:none;width:78px;aspect-ratio:16/9;border-radius:5px;position:relative;overflow:hidden;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.06);background:#0B0B0E;cursor:pointer;padding:0;border:none">
    ${
      b.origin === "footage"
        ? `<canvas class="blk-frame" data-at="${b.start_ms}" data-media="${esc(b.previewKey ?? "")}" width="156" height="88" style="position:absolute;inset:0;width:100%;height:100%;display:block"></canvas>`
        : ""
    }
    <span style="position:absolute;left:4px;top:4px;width:18px;height:18px;border-radius:50%;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center">${iconPlay(8)}</span>
    <span data-content style="position:absolute;right:3px;bottom:3px;font-size:${SIZE.meta};font-family:${FONT.mono};color:rgba(255,255,255,0.8);background:rgba(0,0,0,0.55);padding:1px 5px;border-radius:3px">${
      b.origin === "footage" ? tc(b.start_ms / 1000) : hms((b.end_ms - b.start_ms) / 1000)
    }</span>
  </button>`;

  /* What this block is, under its words: how long it runs, and why the model
     liked it when it had an opinion. */
  /*
   * The recorder.
   *
   * This was a button that said "Record it" and nothing else — no waveform,
   * no elapsed time, no way to stop except pressing the same button again, no
   * way to cancel, and no way to hear or remove a take. The owner:
   *
   *   "it seems like the way you work is like, you just 'get it done' ... it's
   *    just like a blank sorta 'get it done' approach"
   *
   * Fair, and worse than it looks: the design was already in the prototype I
   * had open — a blinking dot, 24 live bars, Stop & keep, Cancel, a take
   * duration in green mono. Every value below is copied from it.
   *
   * All three states are rendered and toggled with `hidden`, rather than
   * built in JS, so the markup is one thing to read and the client only
   * decides which is showing.
   */
  const beatId = esc(b.id.slice(2));
  const took = b.end_ms > b.start_ms ? hms((b.end_ms - b.start_ms) / 1000) : "";

  /*
   * THE CONTEXT, ABOVE THE LINE AND THE RECORDER.
   *
   * "Beat 1 of 4" is the count the cut's own note promises ("0 of 4
   * recorded"); what the beat comes after is the thing you have to pitch
   * against, with a control to hear it; and what it runs into, or the fact
   * that nothing does. A person reading to camera needs all three and the
   * editor gave none of them.
   *
   * Quoted and clipped, because this is orientation and not the transcript —
   * the lines themselves are two rows away in either direction.
   */
  const clip = (t: string, n = 64) => (t.length > n ? t.slice(0, n).trimEnd() + "…" : t);
  const context =
    beat && !script
      ? `<div style="display:flex;flex-direction:column;gap:7px;margin-bottom:11px">
          ${
            beat.afterText
              ? `<div>
                  <div style="font-size:${SIZE.pill};font-weight:600;letter-spacing:.09em;color:${C.ink45}">YOU'RE ANSWERING</div>
                  <div style="margin-top:5px;display:flex;gap:9px;align-items:baseline;flex-wrap:wrap">
                    <span data-content style="flex:1 1 180px;min-width:0;font-size:${SIZE.meta};line-height:1.5;color:${C.ink70};text-wrap:pretty">&ldquo;${esc(
                      clip(beat.afterText),
                    )}&rdquo;</span>
                    ${
                      beat.afterAt
                        ? `<span data-content style="flex:none;font-size:${SIZE.pill};font-family:${FONT.mono};color:${C.ink45}">${esc(beat.afterAt)}</span>`
                        : ""
                    }
                    <button class="blk-play" data-start="${beat.afterStart}" data-media="${esc(beat.afterMedia)}"
                      style="flex:none;font-size:${SIZE.meta};font-weight:500;color:${C.ink70};background:${C.pill};border:none;border-radius:4px;padding:3px 9px;cursor:pointer;font-family:${FONT.ui};white-space:nowrap">Watch the moment</button>
                  </div>
                </div>`
              : ""
          }
          ${
            beat.thenText
              ? `<div data-content style="font-size:${SIZE.meta};line-height:1.5;color:${C.ink45};text-wrap:pretty">Then it cuts to ${esc(
                  beat.thenAt,
                )} &mdash; &ldquo;${esc(clip(beat.thenText))}&rdquo;</div>`
              : `<div style="font-size:${SIZE.meta};line-height:1.5;color:${C.ink45}">This is the last beat of the cut.</div>`
          }
        </div>`
      : "";

  /*
   * TWO KINDS OF BLOCK CAN CARRY A RECORDING.
   *
   * A voiceover beat IS the recording — its mediaKey is the take. A clip
   * pulled in as b-roll has a picture of its own and the take goes OVER it,
   * which is voiceKey. Same recorder either way; only which field holds the
   * audio differs.
   */
  const overBRoll = b.origin === "footage" && b.id.startsWith("b:");
  const voice = b.origin === "voice" ? b.mediaKey : b.voiceKey;

  const bar = (h: number) =>
    `<div class="rec-bar" style="width:3px;height:${h}px;border-radius:99px;background:rgba(236,236,241,0.5);flex:none"></div>`;

  const recorder = `<div class="blk-rec" data-beat="${beatId}" style="margin-top:12px">

    <!-- Idle. Recording is the real answer, so it is the gold one. -->
    <div class="rec-idle" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
      <button class="blk-record" style="font-size:${SIZE.meta};font-weight:600;padding:5px 12px;border-radius:${RADIUS.button};background:${ACCENT.gold};color:#131316;border:none;cursor:pointer;font-family:${FONT.ui};white-space:nowrap">${voice ? "Another take" : overBRoll ? "Talk over it" : "Record it"}</button>
      <button class="blk-tts" style="font-size:${SIZE.meta};font-weight:500;padding:5px 12px;border-radius:${RADIUS.button};background:${C.pill};color:${C.ink70};border:none;cursor:pointer;font-family:${FONT.ui};white-space:nowrap">Generate it</button>
      <span style="flex:none;font-size:${SIZE.meta};color:${C.ink32};white-space:nowrap">Sound only &mdash; no camera yet</span>
      ${
        voice
          ? `<button class="blk-unrecord" style="margin-left:auto;font-size:${SIZE.meta};color:${C.ink32};background:none;border:none;padding:0 4px;cursor:pointer;font-family:${FONT.ui};white-space:nowrap">Remove</button>`
          : ""
      }
    </div>

    <!-- Recording. The bars are driven from the microphone itself. -->
    <div class="rec-live" hidden style="padding:11px 13px;border-radius:8px;background:#0E0E11;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <span style="width:8px;height:8px;border-radius:50%;background:${ACCENT.red};animation:blip 1.1s ease-in-out infinite;flex:none"></span>
      <div class="rec-wave" style="flex:1 1 120px;min-width:min(110px,100%);display:flex;gap:3px;align-items:center;height:18px;overflow:hidden">${Array.from({ length: 24 }, () => bar(3)).join("")}</div>
      <span class="rec-clock" data-content style="flex:none;font-size:${SIZE.meta};font-family:${FONT.mono};color:${C.ink70};font-variant-numeric:tabular-nums">0:00</span>
      <button class="rec-stop" style="flex:none;font-size:${SIZE.secondary};font-weight:600;padding:6px 14px;border-radius:${RADIUS.button};background:${C.ink};color:#131316;border:none;cursor:pointer;font-family:${FONT.ui};white-space:nowrap">Stop &amp; keep</button>
      <button class="rec-cancel" style="flex:none;font-size:${SIZE.secondary};color:${C.ink45};background:none;border:none;cursor:pointer;font-family:${FONT.ui};white-space:nowrap">Cancel</button>
    </div>
  </div>`;

  /*
   * THE TAKES YOU HAVE MADE, and which one the cut is using.
   *
   * Recording again used to overwrite the one before it, so there was never
   * more than one and nothing to show. There is now — invariant 6, and a
   * performance is the one thing this product cannot re-make for you.
   *
   * Only when there are two or more: a list of one is a list of nothing.
   * Newest first, because the one you just made is the one you are deciding
   * about. NOT THE LINE'S VERDICT REPEATED — "NOT THE LINE" beside a take
   * you are choosing between is the fact that decides it, where under the
   * block it was a warning about the chosen one.
   */
  const takeList =
    takes.length > 1 && !script
      ? `<div style="margin-top:10px;display:flex;flex-direction:column;gap:3px">
          <span style="font-size:${SIZE.pill};font-weight:600;letter-spacing:.09em;color:${C.ink45}">EVERY TAKE IS KEPT</span>
          ${takes
            .map(
              (t, i) => `<div style="display:flex;gap:9px;align-items:baseline;padding:6px 9px;border-radius:6px;background:${
                t.chosen ? "#1A1A20" : "transparent"
              }">
              <span data-content style="flex:none;width:52px;font-size:${SIZE.pill};font-family:${FONT.mono};color:${
                t.chosen ? ACCENT.green : C.ink32
              }">take ${takes.length - i}</span>
              <span data-content style="flex:1;min-width:0;font-size:${SIZE.meta};color:${C.ink70}">${
                t.dur_ms ? esc(hms(t.dur_ms / 1000)) : "length unknown"
              }${t.verdict && t.verdict !== "matches" ? " &middot; not the line that was written" : ""}</span>
              ${
                t.chosen
                  ? `<span style="flex:none;font-size:${SIZE.meta};color:${ACCENT.green};white-space:nowrap">in the cut</span>`
                  : `<button class="take-pick" type="button" data-beat="${beatId}" data-take="${esc(t.id)}"
                      style="flex:none;font-size:${SIZE.meta};font-weight:500;padding:3px 9px;border-radius:4px;background:${C.pill};color:${C.ink};border:none;cursor:pointer;font-family:${FONT.ui};white-space:nowrap">Use this one</button>`
              }
            </div>`,
            )
            .join("")}
        </div>`
      : "";

  /* The take you already have, playable. A recording you cannot hear back is
     one you have to re-record to check. */
  const take = voice
    ? `<div style="display:flex;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap">
        <audio controls preload="none" src="/media/${esc(voice)}" style="flex:1 1 220px;min-width:min(200px,100%);height:32px"></audio>
        ${took ? `<span data-content style="flex:none;font-size:${SIZE.meta};font-family:${FONT.mono};color:${ACCENT.green};white-space:nowrap">${took}</span>` : ""}
      </div>`
    : "";

  /* B-roll gets the recorder too — that is the whole point: a shot, and you
     saying what it means over it. "Generate it" is left to voiceover beats,
     where a synthetic line stands on its own. */
  const fill = !struck && (b.origin === "voice" || overBRoll) ? take + recorder + takeList : "";

  /*
   * THE MODEL'S REASON, CLAMPED.
   *
   * `why` has no length cap anywhere, and it rendered in full under every
   * scored block — routinely longer than the line it was explaining. A
   * three-line quote carrying a four-line justification means the explanation
   * outweighs the words you are trying to read, on the surface whose whole
   * job is reading them.
   *
   * One line, and the rest on press. -webkit-line-clamp rather than a server
   * truncation because the full text has to still be there to expand to, and
   * because where it runs out depends on the column width.
   */
  const dur = b.end_ms > b.start_ms ? hms((b.end_ms - b.start_ms) / 1000) : "";
  const why = (b.why ?? "").trim();
  /* The rule, on the block. Quiet — it is a label, not a control — and only
     in Blocks, because the script view is a page of prose. */
  const ruleChip =
    rule && !script
      ? `<span data-content style="flex:none;font-size:${SIZE.meta};font-family:${FONT.mono};color:${C.ink32}">${esc(rule)}</span>`
      : "";
  /*
   * A WARNING IS NOT A COMPLIMENT, AND WAS DRAWN AS ONE.
   *
   * `why` carries two completely different sentences. Under a footage block
   * it is the scorer saying what it liked. Under a recording it is
   * src/take.ts saying the audio is not the line that was written — the only
   * signal anybody gets that a forced aligner put a script over the wrong
   * take — and it arrived in the same field, in the same grey, clamped to
   * one line like a note.
   *
   * So a beat with a verdict says so in gold, which is this product's colour
   * for the system speaking, and names the state before the sentence.
   * `drifted` means it read something else; `unclear` means the aligner
   * could not tell, which is a different thing and says so.
   */
  const takeNote =
    b.takeVerdict && why
      ? `<div style="display:flex;gap:8px;align-items:baseline;margin-top:4px">
          <span data-content style="flex:none;font-size:${SIZE.pill};font-weight:600;padding:2px 6px;border-radius:4px;background:${accentBg(
            ACCENT.gold,
          )};color:${ACCENT.gold};white-space:nowrap">${b.takeVerdict === "drifted" ? "NOT THE LINE" : "COULDN'T TELL"}</span>
          <span data-content style="flex:1;min-width:0;font-size:${SIZE.secondary};color:${C.ink70};line-height:1.5;text-wrap:pretty">${esc(why)}</span>
        </div>`
      : "";

  /*
   * THE JUDGEMENT CALL, ON THE LINE IT IS ABOUT.
   *
   * The prototype puts it here: a gold sentence under the words and two
   * presses beside it. Its own version is produced by a demo heuristic
   * (`r.id % 3 === 1`) and says "kept because it carries 'X'" — a reason
   * nothing in this build computes. What this build knows is better and
   * exact: WHICH TWO RULES disagreed, and which of them got its way.
   *
   * Not in the script view. Words is a page of prose and a pair of buttons
   * mid-paragraph is the thing that view exists to get rid of.
   *
   * Both answers are hand decisions on the moment, and the one that matches
   * where the moment already is takes the hand BACK rather than pinning it
   * — the route does that, and it is why pressing the other and then this
   * one restores exactly what the rules say.
   *
   * IT SAYS WHICH RULE IS WINNING, NOT WHETHER THE LINE IS IN. Those are
   * the same fact on an assembled cut, where a block IS a moment, and they
   * are not on a cut of one video: there the blocks are the transcript's
   * segments and the rule engine's verdict governs the library, so a moment
   * the rules took out still has its segment on screen, unstruck. The first
   * version of this said "It is out." under a line that was visibly in the
   * cut. Naming the winning rule is true of both shapes.
   */
  const judgeBtn = (keep: 0 | 1, label: string, lead: boolean) =>
    `<button class="judge-hand" type="button" data-moment="${esc(judgement!.momentId)}" data-keep="${keep}"
      style="flex:none;font-size:${SIZE.meta};font-weight:500;padding:4px 10px;border-radius:4px;background:${
        lead ? C.pill : "transparent"
      };color:${lead ? C.ink : "rgba(236,236,241,0.55)"};border:none;cursor:pointer;font-family:${
        FONT.ui
      };white-space:nowrap">${label}</button>`;

  const judge =
    judgement && !script
      ? `<div style="margin-top:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span data-content style="flex:1 1 200px;min-width:min(200px,100%);font-size:${SIZE.meta};line-height:1.5;color:rgba(217,179,106,0.9)">Judgement call &mdash; rule ${esc(
            judgement.k,
          )} keeps it, rule ${esc(judgement.d)} takes it out. ${
            judgement.byHand
              ? `You ${judgement.kept ? "kept" : "cut"} it by hand.`
              : `Rule ${esc(judgement.kept ? judgement.k : judgement.d)} is winning.`
          }</span>
          ${
            /*
             * ONCE YOU HAVE ANSWERED IT, THE ONLY MOVE LEFT IS TAKING IT
             * BACK. Offering "Keep it" on a moment you have already kept is
             * a control that un-keeps — the route takes the hand back when
             * the direction matches — and a button whose label is the
             * opposite of what it does is worse than no button.
             */
            judgement.byHand
              ? judgeBtn(judgement.kept ? 1 : 0, "Let the rules decide", true)
              : judgeBtn(1, "Keep it", true) + judgeBtn(0, "Cut it", false)
          }
        </div>`
      : "";

  const meta = takeNote
    ? takeNote
    : why
    ? `<div style="display:flex;gap:8px;align-items:baseline;margin-top:4px">${ruleChip}<span class="blk-why" data-content style="flex:1;min-width:0;font-size:${SIZE.secondary};color:${C.ink45};line-height:1.5;cursor:pointer;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden" title="Show the whole reason">${dur ? `${esc(dur)} · ` : ""}${esc(why)}</span></div>`
    : dur || ruleChip
      ? `<div style="display:flex;gap:8px;align-items:baseline;margin-top:4px">${ruleChip}<span data-content style="font-size:${SIZE.secondary};color:${C.ink45};line-height:1.5">${esc(dur)}</span></div>`
      : "";

  /* Reading, not managing: no card, no frame, no rule between lines. The
     score's green ring goes too — it is a property of the line you are
     reading, and a page of ringed paragraphs is a form again. */
  /* The prototype's own row: 16px between the gutter and the words, 4px of
     padding bled 8px into the panel's own, and a rounded tint on the line you
     are on. */
  const shell = script
    ? `position:relative;display:flex;gap:16px;align-items:flex-start;padding:4px 8px;margin:0 -8px;border-radius:6px;background:none;box-shadow:none;${struck ? "opacity:.5;" : ""}`
    : `display:flex;gap:14px;align-items:flex-start;padding:16px 18px;border-radius:9px;background:${C.surface};box-shadow:${
        b.score != null ? `inset 0 0 0 1px ${accentBg(ACCENT.green)}` : "none"
      };${struck ? "opacity:.5;" : ""}`;

  /*
   * THE GUTTER REPLACES THE THUMBNAIL, rather than the thumbnail merely going.
   *
   * Words dropped the frame and put nothing in its place, so every line began
   * at the same left edge and the page could not say which of three videos it
   * was reading. 56px, mono, 10.5px over a 1.4 line-height, coloured by the
   * source — the same letter and the same colour as the chips beside the
   * title and the strip under the player, because all three come from
   * letterFor and CHIP_COLOURS and disagreeing about which video is B would
   * be worse than having no letter at all.
   */
  const gutter =
    script && mark
      ? `<span data-content style="flex:none;width:56px;padding-top:9px;font-size:10.5px;line-height:1.4;font-family:${FONT.mono};color:${mark.color};white-space:nowrap">${esc(mark.text)}</span>`
      : "";

  /* Gold body text for a line you say to camera, which is what the legend
     strip under the panel promises: "gold is you, to camera". */
  const toCamera = script && b.origin === "voice";

  return `<div class="blk" data-block="${esc(b.id)}" data-struck="${struck ? 1 : 0}" data-ms="${b.end_ms - b.start_ms}"
      style="${shell}${
        /*
         * THE GOLD MARK THE NOTE PROMISES.
         *
         * "2 judgement calls — marked in the blocks" is a sentence that sends
         * somebody looking, so the blocks it names carry a gold edge. A
         * judgement call is a moment two of your own rules disagreed about —
         * one wanted it in, one wanted it out — and the pane says which won.
         *
         * It REPLACES the score ring on a block that has one, because a later
         * box-shadow wins and two edges on one row is noise. That is the
         * right way round: a disagreement between your own rules is a thing
         * to look at, and a model's opinion of a line is not.
         */
        contested ? `box-shadow:inset 2px 0 0 0 ${ACCENT.gold};` : ""
      }"${contested ? ' data-contested="1"' : ""}>
    ${script ? gutter : thumb}
    <div style="flex:1;min-width:0">
      ${context}
      <div style="font-size:${script ? "15px" : SIZE.quote};line-height:${script ? "2" : "1.5"};color:${
        toCamera ? ACCENT.gold : script ? "rgba(236,236,241,0.85)" : "rgba(236,236,241,0.92)"
      }">${originTag}${body}</div>
      ${script ? "" : meta}
      ${judge}
      ${fill}
    </div>
    <!--
      OUT OF FLOW IN WORDS, and this was costing the page most of its measure.
      Measured on the rendered build at 1440: a 574px row gave the gutter 56,
      THE ACTIONS 332, and the words 138. They are invisible until you hover a
      line, and they were taking more than half the column the whole time — so
      a view whose entire job is reading ran at a quarter of its width and
      every sentence broke after five words. Nothing could have caught that
      except looking at it.

      Positioned rather than removed. The prototype's Words row carries no
      controls at all, and dropping them would lose the one gesture a person
      reading actually wants (cut this line) — so they sit at the right edge,
      over the end of the line, and appear on hover exactly as before.
    -->
    <div class="blk-actions" style="${
      script
        ? "position:absolute;right:0;top:2px;display:flex;align-items:center;gap:4px"
        : "flex:none;display:flex;align-items:center;gap:4px"
    }">
      ${script ? "" : judged}
      ${script ? "" : arrow(-1, i === 0) + arrow(1, i === total - 1)}
      ${script ? "" : short}
      ${script ? "" : picture}
      <button class="blk-strike" data-block="${esc(b.id)}"
        style="background:none;border:none;padding:0;cursor:pointer;font-family:${FONT.ui}"><span class="seg-pill" data-kept="${struck ? 0 : 1}">${struck ? "Add back" : "Cut"}</span></button>
    </div>
  </div>`;
}

/** Where anything gets inserted. The gesture that was stranded inside Build. */
/**
 * The seam, and what it will put there.
 *
 * The `+` inserted a voice block, silently, with no choice at all — while the
 * prototype's seam offers six things (A reaction · Your voice · A clip ·
 * B-roll · A title · Music). This is the gesture the owner keeps asking about
 * by name, so it has to ask rather than assume.
 *
 * Only what is really built is offered. B-roll, titles and music are not, and
 * a chip that pretends otherwise is the failure this whole session has been
 * about — they are absent rather than dead.
 */
/**
 * SHORTS: which lines would stand on their own, and why not.
 *
 * Phase 5's acceptance is "no short ends mid-sentence or carries an
 * unresolved referent", and that is this list: every line in the cut,
 * graded by src/shorts.ts, with the fact that caused the grade beside it.
 *
 * NOTHING IS WITHHELD. A Long shot is listed and pressable — the grade says
 * what to expect and the reason says why, and a person who disagrees
 * presses it anyway. Filtering would quietly lose a line somebody wanted,
 * and the conventions check exists because a control that cannot be pressed
 * is worse than one that warns.
 *
 * STRONG FIRST, then the order they are said in. Two Strong lines are not
 * ranked against each other: nothing here can tell which of two
 * self-sufficient sentences makes the better short, and a number pretending
 * otherwise is what invariant 3 forbids.
 */
const GRADE_ACCENT: Record<Grade, keyof typeof ACCENT> = {
  strong: "green",
  worth: "gold",
  long: "red",
};

function shortsList(d: CutData): string {
  const lines = d.blocks.filter((b) => b.origin === "footage" && !b.struck && b.text.trim());
  if (!lines.length) {
    return `<div style="font-size:${SIZE.secondary};color:${C.ink45};line-height:1.6">Nothing to cut a short from yet — this cut has no lines in it.</div>`;
  }

  const ORDER: Record<Grade, number> = { strong: 0, worth: 1, long: 2 };

  /*
   * THE THREE LENGTHS A PLATFORM ACTUALLY WANTS, and a count.
   *
   * These are the prototype's own bands. They filter what is shown; they do
   * not re-grade anything, because how long a line is and whether it stands
   * on its own are different questions and a filter that quietly changed the
   * second would make the bands mean something else per view.
   */
  const LENGTHS: Array<[string, number, number]> = [
    ["15–35s", 15_000, 35_000],
    ["20–60s", 20_000, 60_000],
    ["40–90s", 40_000, 90_000],
  ];
  const COUNTS = [4, 6, 10];
  /*
   * THE RULE, SAID OUT LOUD, where the judgements are.
   *
   * One Take prints it under the cards: "Bands and reasons, not scores — a
   * shortlist, not a prediction. The rules on the left apply here too."
   * That is invariant 3 addressed to the person reading, on the one surface
   * where a product like this would normally show a percentage, and it is
   * also the honest limit of a shortlist: it says what stands on its own,
   * not what will do well.
   */
  const said = `<div style="margin-top:4px;margin-bottom:10px;font-size:${SIZE.meta};line-height:1.5;color:${C.ink32};text-wrap:pretty">Bands and reasons, not scores — a shortlist, not a prediction. The rules on the left apply here too.</div>`;
  const graded = lines
    .map((b, i) => ({ b, i, g: grade({ text: b.text, durationMs: b.end_ms - b.start_ms }) }))
    .sort((x, y) => ORDER[x.g.grade] - ORDER[y.g.grade] || x.i - y.i);

  /*
   * WHAT IS NOT A SHORT, AND THE MEASUREMENT THAT SAYS SO.
   *
   * problems() has produced the fact since shorts landed and nothing showed
   * it: a line too short, too long, or opening on a word nobody heard simply
   * sat low in the list with a band. The prototype separates them, because
   * "this is not a short and here is why" is a different sentence from "this
   * is a weak short" — and the first one can be argued with. Every one can
   * still be forced in: the measurement is a reason, not a veto.
   */
  const notShorts = graded.filter((x) =>
    x.g.problems.some((pr) => pr.kind === "too-short" || pr.kind === "too-long"),
  );
  const eligible = graded.filter((x) => !notShorts.includes(x));

  const chosenLen = LENGTHS.find(([name]) => name === d.shortLen);
  const chosenCount = COUNTS.includes(Number(d.shortCount)) ? Number(d.shortCount) : null;
  const shown = (() => {
    let out = eligible;
    if (chosenLen) out = out.filter((x) => {
      const ms = x.b.end_ms - x.b.start_ms;
      return ms >= chosenLen[1] && ms <= chosenLen[2];
    });
    return chosenCount ? out.slice(0, chosenCount) : out;
  })();

  const here = (over: Record<string, string>) => {
    const q = new URLSearchParams();
    if (d.shortLen && over.len === undefined) q.set("len", d.shortLen);
    if (d.shortCount && over.count === undefined) q.set("count", String(d.shortCount));
    for (const [k, v] of Object.entries(over)) if (v) q.set(k, v);
    const qs = q.toString();
    return `/p/${esc(d.projectId)}/shorts${qs ? "?" + qs : ""}`;
  };

  const filterChip = (label: string, on: boolean, href: string) =>
    `<a href="${href}" style="font-size:${SIZE.meta};font-weight:500;padding:5px 11px;border-radius:5px;text-decoration:none;background:${
      on ? C.active : "transparent"
    };color:${on ? C.ink : C.ink45}"><span data-content>${esc(label)}</span></a>`;

  const filters = `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
    ${LENGTHS.map(([name]) => filterChip(name, d.shortLen === name, here({ len: d.shortLen === name ? "" : name }))).join("")}
    <span style="flex:none;width:10px"></span>
    ${COUNTS.map((n) =>
      filterChip(`best ${n}`, chosenCount === n, here({ count: chosenCount === n ? "" : String(n) })),
    ).join("")}
  </div>`;

  /* What it adds up to. Minutes to post is the one number a person planning a
     week actually wants, and it is a sum of what is on screen. */
  const totalMs = shown.reduce((n, x) => n + (x.b.end_ms - x.b.start_ms), 0);
  const stats = `<div data-content style="margin-bottom:10px;font-size:${SIZE.meta};font-family:${FONT.mono};color:${C.ink45}">${
    shown.length
  } short${shown.length === 1 ? "" : "s"} · ${hms(totalMs / 1000)} to post${
    notShorts.length ? ` · ${notShorts.length} not shorts` : ""
  }</div>`;

  const notShortRows = notShorts.length
    ? `<div style="margin-top:16px">
        <div style="font-size:10px;font-weight:600;letter-spacing:.06em;color:${C.ink32}">NOT SHORTS</div>
        <div style="margin-top:8px;display:flex;flex-direction:column;gap:6px">${notShorts
          .map(({ b, g }) => {
            const why = g.problems.find((pr) => pr.kind === "too-short" || pr.kind === "too-long");
            const letter = markOf(d, sourceIndex(d), b).letter;
            const where = [letter ? `${letter} ${hms(b.start_ms / 1000)}` : hms(b.start_ms / 1000), hms((b.end_ms - b.start_ms) / 1000)]
              .filter(Boolean)
              .join(" · ");
            return `<div style="display:flex;gap:12px;align-items:baseline;padding:9px 12px;border-radius:${RADIUS.card};background:${C.surface}">
              <span data-content style="flex:none;font-size:${SIZE.meta};font-family:${FONT.mono};color:${C.ink32};white-space:nowrap">${esc(where)}</span>
              <span style="flex:1 1 200px;min-width:min(200px,100%)">
                <span data-content style="display:block;font-size:${SIZE.secondary};line-height:1.5;color:${C.ink70}">${esc(b.text)}</span>
                <span data-content style="display:block;margin-top:3px;font-size:${SIZE.meta};font-family:${FONT.mono};color:${C.ink45}">${esc(
                  why?.reason ?? "",
                )}</span>
              </span>
              <a href="${here({ short: b.id })}" style="flex:none;font-size:${SIZE.meta};font-weight:600;padding:5px 10px;border-radius:${RADIUS.button};background:${C.pill};color:${C.ink70};text-decoration:none">Use it anyway</a>
            </div>`;
          })
          .join("")}</div>
      </div>`
    : "";

  const rows = shown
    .map(({ b, g }) => {
      const accent = ACCENT[GRADE_ACCENT[g.grade]];
      /* The segment index is in the block id — "s:12" — and it is what
         /shorts-from-line takes. A block that is not a segment cannot
         become a short from a line, so it carries no index and no button. */
      const seg = b.id.startsWith("s:") ? b.id.slice(2) : "";
      return `<div style="display:flex;gap:12px;align-items:baseline;padding:11px 13px;border-radius:${RADIUS.card};background:${C.surface}">
        <span data-content style="flex:none;font-size:10px;font-weight:600;letter-spacing:.06em;padding:2px 6px;border-radius:3px;background:${accentBg(accent)};color:${accent};white-space:nowrap">${esc(GRADE_NAME[g.grade].toUpperCase())}</span>
        <span style="flex:1 1 220px;min-width:min(200px,100%)">
          <span data-content style="display:block;font-size:${SIZE.body};line-height:1.5">${esc(b.text)}</span>
          <span style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">${reads(
            { text: b.text, durationMs: b.end_ms - b.start_ms },
            b.score,
          )
            .map((rd) => {
              const ink = ACCENT[GRADE_ACCENT[rd.band]];
              return `<span title="${esc(rd.reason)}" style="display:inline-flex;align-items:baseline;gap:5px;font-size:${SIZE.meta};padding:3px 7px;border-radius:4px;background:${C.pill}">
                <span data-content style="color:${C.ink45}">${esc(DIMENSION_NAME[rd.dimension])}</span>
                <span data-content style="font-weight:600;color:${ink}">${esc(GRADE_NAME[rd.band].toLowerCase())}</span>
              </span>`;
            })
            .join("")}</span>
          <span data-content style="display:block;margin-top:5px;font-size:${SIZE.meta};font-family:${FONT.mono};color:${C.ink45}">${esc(g.reason)}</span>
        </span>
        ${
          seg
            ? `<button class="short-line" type="button" data-project="${esc(d.projectId)}" data-seg="${esc(seg)}"
                style="flex:none;font-size:${SIZE.meta};font-weight:600;padding:5px 10px;border-radius:${RADIUS.button};background:${C.pill};color:${C.ink70};border:none;cursor:pointer;font-family:inherit">Keep it</button>`
            : ""
        }
      </div>`;
    })
    .join("");

  const strong = graded.filter((x) => x.g.grade === "strong").length;

  /*
   * THE ONE IN FRONT OF YOU.
   *
   * Everything above is the shortlist, which the build has had and which is
   * only half of it: a list tells you what stands on its own and gives you
   * nowhere to work. The prototype puts ONE short at the top with its picture,
   * its reasons, its words and the four decisions you make about it, and the
   * list underneath is how you move between them.
   *
   * Chosen by ?short=, so it is a URL — which means a crawl can reach it, the
   * back button works, and a link to one short is a link to one short. The
   * default is the first the engine rates strongest, because that is the one
   * worth looking at first.
   */
  const focused = graded.find((x) => x.b.id === d.shortId) ?? shown[0] ?? eligible[0];
  const order = sourceIndex(d);

  return `<div>
    <div style="display:flex;gap:9px;align-items:baseline;flex-wrap:wrap;margin-bottom:12px">
      <span data-content style="flex:none;font-size:${SIZE.body};font-weight:600">Shorts</span>
      <span data-content style="flex:1 1 auto;min-width:0;font-size:${SIZE.meta};font-family:${FONT.mono};color:${C.ink45}">${strong} of ${graded.length} lines stand on their own</span>
    </div>
    ${said}
    ${briefBox(d.projectId)}
    ${focused ? focusedShort(d, focused, eligible.length, eligible.indexOf(focused) + 1, order) : ""}
    ${filters}
    ${stats}
    <div style="display:flex;flex-direction:column;gap:6px">${rows}</div>
    ${notShortRows}
  </div>`;
}

/**
 * ONE SHORT, AND EVERYTHING YOU DECIDE ABOUT IT.
 *
 * The workbench half. Its shape is the prototype's: the vertical preview with
 * the hook burned in on the left, the reasons and the words on the right, the
 * controls under them, and the post copy last.
 *
 * WHAT IS DELIBERATELY NOT HERE:
 *
 * REFRAME. The prototype offers "Follow the speaker" / "Centered" / "Split
 * screen". Subject tracking does not exist anywhere in src/ or container/,
 * and neither does a two-up composite — so two of the three are promises
 * nothing can keep, and a control where one option works is worse than no
 * control. Shape (9:16, 1:1, 4:5) is real and offered instead; it is the one
 * ASPECTS already validates.
 *
 * TREND. src/shorts.ts refuses it in as many words, and it is right: nothing
 * in this product measures what travels. Hook, Flow and Value are measured.
 */
function focusedShort(
  d: CutData,
  item: { b: Block; g: Graded },
  total: number,
  position: number,
  order: Map<string, number>,
): string {
  const b = item.b;
  const ms = b.end_ms - b.start_ms;
  const accent = ACCENT[GRADE_ACCENT[item.g.grade]];
  const hook = opening(b.text);
  const { letter, colour } = markOf(d, order, b);

  /* "C 44:02 · Sunday" — where this came from, in the words the chips and
     the Words gutter use. */
  const credit = [letter ? `${letter} ${hms(b.start_ms / 1000)}` : hms(b.start_ms / 1000), d.sourceTitle ?? ""]
    .filter(Boolean)
    .join(" · ");

  const preview = `<div style="position:relative;flex:none;width:148px;aspect-ratio:9/16;border-radius:${RADIUS.card};overflow:hidden;background:${C.canvas}">
    ${
      b.posterKey
        ? `<img loading="lazy" src="/media/${esc(b.posterKey)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.55"/>`
        : ""
    }
    <span data-content style="position:absolute;top:8px;left:8px;font-size:10px;font-weight:600;padding:2px 6px;border-radius:3px;background:${accentBg(
      accent,
    )};color:${accent}">${esc(GRADE_NAME[item.g.grade])}</span>
    <!-- data-short-dur: the client retotals this as words are struck, because
         a short whose stated length does not move when you cut two seconds
         out of it is lying about what it will post as. -->
    <span data-short-dur data-content style="position:absolute;top:8px;right:8px;font-size:${SIZE.meta};font-family:${FONT.mono};color:${C.ink70}">${esc(
      hms(ms / 1000),
    )}</span>
    <!-- The hook, drawn as it would be burned in. Not a caption preview: it
         is the first thing a viewer sees and the reason the short works. -->
    <span data-content style="position:absolute;left:12px;right:12px;bottom:34px;font-size:17px;font-weight:600;line-height:1.25;text-wrap:pretty;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden">${esc(
      hook,
    )}</span>
    <span data-content style="position:absolute;left:12px;right:12px;bottom:10px;font-size:10px;font-family:${FONT.mono};color:${
      colour
    };white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(credit)}</span>
  </div>`;

  /* The reasons, as cards rather than chips: each one is a sentence and a
     chip crops it to a word. */
  const cards = reads({ text: b.text, durationMs: ms }, b.score)
    .map((rd) => {
      const ink = ACCENT[GRADE_ACCENT[rd.band]];
      return `<div style="flex:1 1 180px;min-width:min(180px,100%);padding:10px 12px;border-radius:${RADIUS.card};background:${C.surface}">
        <div style="display:flex;align-items:baseline;gap:8px">
          <span data-content style="flex:1;font-size:${SIZE.secondary};color:${C.ink70}">${esc(DIMENSION_NAME[rd.dimension])}</span>
          <span data-content style="flex:none;font-size:${SIZE.meta};font-weight:600;color:${ink}">${esc(GRADE_NAME[rd.band].toLowerCase())}</span>
        </div>
        <div data-content style="margin-top:4px;font-size:${SIZE.meta};line-height:1.5;color:${C.ink45};text-wrap:pretty">${esc(rd.reason)}</div>
      </div>`;
    })
    .join("");

  /*
   * TRIM BY WORDS, in the short's OWN strike set.
   *
   * data-short carries the block id and the client keeps the struck words
   * under it, separate from the cut's. Trimming a short must not edit the
   * cut: they are two different pieces of work on the same words, and a
   * person tidying a short for TikTok is not asking to change the video it
   * came from.
   */
  const words = (b.words.length ? b.words : (b.displayWords ?? []))
    .map(
      (w, i) =>
        `<span class="sw" data-short="${esc(b.id)}" data-word="${i}" style="cursor:pointer;border-radius:2px">${esc(w.w)}</span>`,
    )
    .join(" ");

  const chips = (name: string, cls: string, values: readonly string[], chosen: string) =>
    `<div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap">
      <span data-content style="flex:none;width:68px;font-size:${SIZE.meta};color:${C.ink45}">${esc(name)}</span>
      ${values
        .map(
          (v) =>
            `<button type="button" class="${cls}" data-value="${esc(v)}" aria-pressed="${v === chosen ? "true" : "false"}"
              style="font-size:${SIZE.meta};font-weight:500;padding:5px 11px;border-radius:5px;border:none;cursor:pointer;font-family:inherit;background:${
                v === chosen ? C.active : "transparent"
              };color:${v === chosen ? C.ink : C.ink45}"><span data-content>${esc(v)}</span></button>`,
        )
        .join("")}
    </div>`;

  /*
   * POST COPY, written from the short and from nothing else.
   *
   * No model call: the title is the hook, the body is what was said plus
   * where it came from, and the tags are the subject word. A model asked to
   * write post copy produces copy about the subject in general, which is how
   * a caption ends up claiming something the clip does not show.
   */
  /*
   * NO HASHTAGS, and that is the same refusal Trend is.
   *
   * The prototype shows "#vlog #deciding #landing" — plausible tags, and
   * exactly the kind of thing a model invents. A tag is a claim about what
   * people are looking for, and nothing in this product measures that;
   * src/shorts.ts refuses to grade Trend for precisely this reason and
   * putting the same guess back under another name would be worse, because
   * a hashtag is pasted straight into a post.
   *
   * The first draft of this file did invent them, from subjectWord — which
   * exists to diagnose an opening problem, not to describe a subject. It
   * produced "#so".
   */

  /*
   * MAKE IT, rather than the prototype's "Add it to the cut".
   *
   * Its shorts are pulled from the library, so adding one is a real action
   * there. Here the shortlist IS the cut's own lines — every one is already
   * in it — so that button would do nothing, which is the class of control
   * this build keeps taking out. What there is to do is RENDER it, at the
   * shape and with the captions chosen above, which is also what makes those
   * chips controls rather than decoration.
   *
   * A JS comment and not an HTML one: an HTML comment inside this template
   * SHIPS. The first version of this explanation went over the wire on every
   * request, and put the words "Add it to the cut" into a page that
   * deliberately has no such control.
   */
  return `<div class="short-focus" data-short="${esc(b.id)}" data-ms="${ms}" style="margin-bottom:16px;padding:14px;border-radius:${RADIUS.card};background:${C.raised}">
    <div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">
      ${preview}
      <div style="flex:1 1 320px;min-width:min(320px,100%)">
        <div style="display:flex;gap:9px;align-items:baseline;flex-wrap:wrap">
          <span data-short-state data-content style="flex:none;font-size:10px;font-weight:600;letter-spacing:.06em;padding:2px 6px;border-radius:3px;background:${accentBg(
            ACCENT.green,
          )};color:${ACCENT.green}">KEEPING</span>
          <span data-content style="font-size:${SIZE.meta};font-family:${FONT.mono};color:${C.ink45}">${position} of ${total} shortlisted</span>
        </div>
        <div data-content style="margin-top:8px;font-size:${SIZE.quote};font-weight:600;line-height:1.35;text-wrap:pretty">${esc(b.text)}</div>
        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">${cards}</div>

        <div style="margin-top:14px;font-size:10px;font-weight:600;letter-spacing:.06em;color:${C.ink32}">TRIM BY WORDS · click a word to cut it</div>
        <div class="short-words" style="margin-top:6px;font-size:${SIZE.body};line-height:1.7;color:${C.ink70};text-wrap:pretty">${words}</div>

        <div style="margin-top:14px;display:flex;flex-direction:column;gap:8px">
          ${chips("Shape", "short-aspect", ASPECTS, "9:16")}
          ${chips("Captions", "short-caption", CAPTION_STYLES, "Bold")}
        </div>

        <div style="margin-top:14px;padding:12px 13px;border-radius:${RADIUS.card};background:${C.surface}">
          <div style="font-size:10px;font-weight:600;letter-spacing:.06em;color:${C.ink32}">POST COPY · written from the short</div>
          <div data-content style="margin-top:6px;font-size:${SIZE.secondary};font-weight:600;line-height:1.4">${esc(hook)}</div>
          <div data-content style="margin-top:5px;font-size:${SIZE.meta};line-height:1.55;color:${C.ink45};text-wrap:pretty">${esc(
            b.text,
          )}${d.sourceTitle ? ` — from ${esc(d.sourceTitle)}.` : ""}</div>
          <div style="margin-top:7px;font-size:${SIZE.meta};line-height:1.5;color:${C.ink32}">No hashtags: nothing here measures what people are searching for, and a tag is a guess at that.</div>
        </div>

        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="short-skip" data-short="${esc(b.id)}"
            style="font-size:${SIZE.meta};font-weight:600;padding:6px 13px;border-radius:${RADIUS.button};background:${C.pill};color:${C.ink70};border:none;cursor:pointer;font-family:inherit">Skip it</button>
          <button type="button" class="short-make" data-project="${esc(d.projectId)}" data-block="${esc(b.id)}"
            style="font-size:${SIZE.meta};font-weight:600;padding:6px 13px;border-radius:${RADIUS.button};background:${C.active};color:${C.ink};border:none;cursor:pointer;font-family:inherit">Make the short</button>
        </div>
      </div>
    </div>
  </div>`;
}

/**
 * PASTE THE BRIEF SOMEBODY SENT YOU.
 *
 * "hooks in 2s, 20–40s, no politics, we need 8" is a real message a real
 * person receives, and the thing to do with it is paste it rather than
 * translate it into four controls by hand.
 *
 * IT COMPILES TO RULES, and the rules land in the pane on the left where
 * every other rule lives — each with the line saying what it is doing right
 * now. That is the shortlist diff, and it is the pane's existing mechanism
 * rather than a second view built for this one gesture.
 */
function briefBox(projectId: string): string {
  return `<form id="brief-box" data-project="${esc(projectId)}" style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap">
    <input type="text" name="brief" autocomplete="off"
      placeholder="Paste a brief — “hooks in 2s, 20–40s, no politics, we need 8”"
      style="flex:1 1 260px;min-width:min(220px,100%);padding:10px 12px;border-radius:${RADIUS.card};background:${C.surface};border:none;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.06);color:${C.ink};font-family:inherit;font-size:${SIZE.secondary}"/>
    <button type="submit" style="flex:none;font-size:${SIZE.secondary};font-weight:600;padding:9px 16px;border-radius:${RADIUS.button};background:${C.ink};color:#131316;border:none;cursor:pointer;font-family:inherit">Make it rules</button>
  </form>`;
}

function seam(projectId: string, at: number, view: CutView = "blocks"): string {
  const opt = (kind: string, label: string) =>
    `<button class="blk-insert" data-project="${esc(projectId)}" data-at="${at}" data-kind="${kind}"
      style="font-size:${SIZE.meta};font-weight:500;padding:5px 12px;border-radius:${RADIUS.button};background:${C.pill};color:${C.ink70};border:none;cursor:pointer;font-family:${FONT.ui};white-space:nowrap">${label}</button>`;

  /*
   * ONE SEAM AT A TIME.
   *
   * There was a + between every block — up to 120 identical circles down the
   * page, each for a gesture used a handful of times in an edit. The row of
   * them read as decoration and made the transcript look like a form.
   *
   * The opener is invisible until its block is the current one, and the block
   * you clicked, played or struck IS the current one — which also gives the
   * editor a notion of "where I am" that it has never had. Not hover: hover
   * does not exist on a touch screen, and this product was invisible there
   * once already.
   */
  /* Kept in the dom in BOTH views even when it draws nothing: here() finds the
     seams either side of the current block by element sibling, so removing
     them would take the + away everywhere and not just here. */
  return `<div class="seam" style="display:flex;justify-content:center;padding:${view === "script" ? "0" : "1px 0"}">
    <!-- Size lives in CSS, not here: the script view collapses this to nothing
         between lines and restores it on the line you are on, and an inline
         height would beat any rule that tried. -->
    <button class="seam-open" aria-label="Add something here"
      style="border-radius:50%;background:transparent;border:none;color:${C.ink32};cursor:pointer;display:grid;place-items:center">${iconPlus({ size: 12 })}</button>
    <div class="seam-opts" hidden style="display:flex;gap:5px;align-items:center;flex-wrap:wrap;padding:4px 0">
      ${opt("vo", "Your voice")}${opt("react", "A reaction")}${opt("clip", "A clip")}
      <button class="seam-close" style="font-size:${SIZE.meta};color:${C.ink32};background:none;border:none;cursor:pointer;font-family:${FONT.ui};padding:0 4px;white-space:nowrap">never mind</button>
    </div>
  </div>`;
}

/**
 * What this cut still needs, in the prototype's own phrasing — "2 voiceovers,
 * 1 clip to go." or "every beat is filled."
 *
 * This was the tail of Build's lede. Build is gone, and for a while this
 * function survived it with nothing but its own test calling it — real,
 * tested, unreachable. It matters more now than it did there: a block you
 * inserted and never recorded into is invisible work-in-progress, and the
 * editor is the only place you would find out.
 *
 * Counted from the beats themselves rather than stored, so it cannot drift out
 * of step with the blocks above it.
 */
export function buildSummary(
  all: Array<{ kind: string; media_r2_key: string | null; clip_id: string | null; struck?: unknown }>,
  kind = "essay",
): string {
  /* A block you struck is one you decided against; it is not outstanding
     work. Counting it said "3 voiceovers to go" about a cut where one of the
     three had already been cut. */
  const beats = all.filter((b) => !(Boolean(b.struck) && b.struck !== "0"));
  if (!beats.length) return "nothing laid down yet.";

  const voLeft = beats.filter((b) => (b.kind === "vo" || b.kind === "react") && !b.media_r2_key).length;
  const srcLeft = beats.filter((b) => (b.kind === "clip" || b.kind === "stock") && !b.clip_id).length;
  const genLeft = beats.filter((b) => b.kind === "generated" && !b.media_r2_key).length;

  const parts: string[] = [];
  if (voLeft) parts.push(`${voLeft} ${kind === "reaction" ? "reaction" : "voiceover"}${voLeft > 1 ? "s" : ""}`);
  if (srcLeft) parts.push(`${srcLeft} clip${srcLeft > 1 ? "s" : ""}`);
  if (genLeft) parts.push(`${genLeft} visual${genLeft > 1 ? "s" : ""}`);

  return parts.length ? `${parts.join(", ")} to go.` : "every beat is filled.";
}

/**
 * Telling it what you want.
 *
 * This is the part the owner called the sleeper — "if i can mostly control it
 * just with things like that, either quick buttons or a chat interface that i
 * can just tell it what i want, that is pretty good and simple and effective."
 *
 * It existed. "Ask for another pass" and the clean-up chips were on the old
 * editor, and when four surfaces became one I carried the gestures across and
 * left the power behind: POST /passes, fillerCuts and pauseCuts have all been
 * sitting here with nothing calling them.
 *
 * Every number is real. The chips say what they would find in THIS transcript
 * and what the video would actually lose, because a count you cannot trust is
 * worse than no count.
 */
/*
 * passLogPanel IS GONE. It rendered the passes table as a panel, and `turn`
 * below does the same job better in the conversation column — what you
 * asked, what it said back, and the way to undo it — so the panel had been
 * sitting here uncalled since the four surfaces became one room. Two
 * renderers of one table is two answers to "what have I asked for".
 */

/**
 * THE RULES THAT MADE THIS CUT, and what each one is doing right now.
 *
 * "Every rule shows what it does right now … This is the explanation layer;
 * without it the product is a black box with toggles" — 04-RULE-ENGINE.md.
 * Until this existed an assembled cut arrived as a list of moments from
 * several videos with no account of why those and not others, which is the
 * exact review gap this product is meant to be better at than everyone else.
 *
 * Each row is a real switch now. Invariant 6: nothing is deleted, rules
 * switch off — so the control is a toggle rather than a remove, and a rule
 * that is off stays in the list saying "off — footage as shot" rather than
 * vanishing and leaving the cut unexplained.
 */
/**
 * BRING SCOUT IN.
 *
 * The one control that turns a project into a run, and a plain form rather
 * than anything in client.ts — a POST that redirects is the whole
 * interaction, and the client is one String.raw template where a stray
 * backtick breaks the product.
 *
 * THE COPY IS THE PROMISE AND THE LIMIT IN ONE SENTENCE. "Finds clips that
 * aren't yours yet — links, never downloads" is invariant 9 said to a person,
 * and it belongs on the button rather than in a help page: this is the moment
 * somebody decides whether to let the product go outside.
 */
/**
 * SCOUT, IN ONE ROW.
 *
 * It was a card: a heading, a two-line paragraph about what Scout does, and
 * two buttons under them — 132px of a column that has 598. Measured while
 * chasing a composer that had ended up under the export bar, the arithmetic
 * came out as: the player and rules take 93, this took 132, the composer
 * takes 249, and the conversation got the 125px left over. The check calls
 * 125px "not even one exchange", and it is right.
 *
 * So it says the same thing in the shape the front door says it: one line,
 * the explanation in the title where a person can get at it, and the
 * controls on the same row. The paragraph was the duplicate — the room's
 * Scout row already carries that argument on the surface you meet Scout on.
 *
 * The two controls are unchanged, because they are the point of it.
 */
function scoutPanel(projectId: string): string {
  const why =
    "Scout finds clips that aren't yours yet — links, never downloads. " +
    "He turns the brief into things a viewer could point to on camera, " +
    "and searches for each and for its opposite.";
  return (
    `<section title="${esc(why)}" style="margin-top:12px;padding:8px 11px;border-radius:${RADIUS.card};background:${C.surface};display:flex;align-items:center;gap:9px;flex-wrap:wrap">` +
    `<div style="flex:1 1 120px;min-width:0;font:600 ${SIZE.secondary} ${FONT.ui};color:${C.ink};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Look outside this project</div>` +
    `<form method="post" action="/api/projects/${esc(projectId)}/scout/runs" style="margin:0;flex:none">` +
    `<button type="submit" style="padding:5px 11px;border:0;border-radius:${RADIUS.button};background:${C.ink};` +
    `color:${C.canvas};font:600 ${SIZE.meta} ${FONT.ui};cursor:pointer">Send Scout</button></form>` +
    `<a href="/p/${esc(projectId)}/scout" style="flex:none;padding:5px 11px;border-radius:${RADIUS.button};` +
    `background:${C.pill};color:${C.ink70};font:600 ${SIZE.meta} ${FONT.ui};text-decoration:none">The board</a>` +
    `</section>`
  );
}

function rulesPanel(rules: CutData["rules"], moments: CutData["moments"] = []): string {
  if (!rules.length) return "";

  /*
   * NUMBERED, AND THE NUMBERS COME FROM THE RULES PROPER.
   *
   * A moment says "in · rule 01" and the pane has to agree with it, so the
   * numbering counts only the rules that are rules — a hand decision is the
   * escape hatch FROM them and is listed apart, exactly as the reference does
   * it (main = rules.filter(r => !r.hand)). Number the whole list and every
   * reference from a moment points one line too far down.
   */
  const main = rules.filter((r) => !r.hand);
  const byHand = rules.filter((r) => r.hand);
  const number = (r: CutData["rules"][number]) => {
    const i = main.indexOf(r);
    return i < 0 ? "" : String(i + 1).padStart(2, "0");
  };

  /*
   * A RULE IS A CARD WITH A SWITCH, which is what One Take has and what the
   * build did not.
   *
   * It was a flat row that was itself a button: number, text, effect. You
   * could press it and the text would strike through, and that strike was
   * the only thing on screen saying what state it was in. Invariant 1 is
   * that the rules ARE the cut — "a cut is re-produced from rules, never
   * stored as an outcome" — so switching one off is the central gesture of
   * the product, and it was a control you could not see the state of
   * without reading.
   *
   * The card, the ring, the switch and its knob are the prototype's own
   * values. The toggle is the button; the card is not, because a card you
   * cannot click anywhere on is a card whose hit area matches its meaning.
   */
  /*
   * THE ONE RULE WITH ALTERNATIVES.
   *
   * An order rule is not a yes/no — it is a choice of three, and the other
   * two are a press away. The prototype shows them as chips under the rule
   * with the chosen one lit, and a line underneath saying why you would
   * want the one you are on.
   *
   * Only when the rule is ON. Offering to re-order a cut by a rule that is
   * switched off is a control that would have to switch it back on to mean
   * anything, which is two decisions behind one press.
   *
   * The names and the whys are ported from design/one-take/footage.js (see
   * ORDERS in src/rules.ts), not written here.
   */
  const alternatives = (r: CutData["rules"][number]): string => {
    if (r.kind !== "order" || !r.on) return "";
    const chosen = r.order ?? "strand";
    const chips = (Object.keys(ORDERS) as Order[])
      .map((o) => {
        const here = o === chosen;
        return `<button class="rule-order" data-rule="${esc(r.id)}" data-order="${esc(o)}"${here ? " data-current" : ""} title="${esc(ORDERS[o].why)}"
          style="font-size:${SIZE.meta};padding:4px 9px;border-radius:4px;border:none;cursor:pointer;font-family:${FONT.ui};white-space:nowrap;background:${
            here ? "rgba(236,236,241,0.16)" : "rgba(236,236,241,0.06)"
          };color:${here ? C.ink : "rgba(236,236,241,0.55)"}">${esc(ORDERS[o].name)}</button>`;
      })
      .join("");
    return `<span style="display:block;margin-top:9px;display:flex;gap:5px;flex-wrap:wrap">${chips}</span>
      <span data-content style="display:block;margin-top:7px;font-size:${SIZE.meta};line-height:1.5;color:${C.ink45};text-wrap:pretty">${esc(ORDERS[chosen].why)}</span>`;
  };

  /*
   * A RULE THAT IS ON AND DOING NOTHING.
   *
   * Switched on, matching no moment either way, and named by no
   * disagreement. The pane renders it identically to a rule that is holding
   * the cut together, so a sentence that no longer describes any of your
   * footage — the subject was cut, the words were never said — sits there
   * looking like direction. The prototype offers to retire it.
   *
   * Only keep and drop rules. An order rule with nothing to reorder, a
   * length cap nothing exceeds and a gap rule on a cut with no gaps are all
   * "doing nothing" in exactly the sense that means they are working.
   */
  const touched = new Set<string>();
  for (const m of moments) {
    if (m.byRule) touched.add(m.byRule);
    if (m.dropRule) touched.add(m.dropRule);
    if (m.contest?.k) touched.add(`#${m.contest.k}`);
    if (m.contest?.d) touched.add(`#${m.contest.d}`);
  }
  const isDead = (r: CutData["rules"][number]) =>
    r.on &&
    (r.kind === "keep" || r.kind === "drop") &&
    !touched.has(String(r.id)) &&
    !touched.has(`#${number(r)}`);

  const rows = (list: CutData["rules"]) => list
    .map(
      (r) => `<div class="rule-card" style="display:flex;gap:12px;align-items:flex-start;padding:12px 13px;border-radius:9px;background:#15151A;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.05);transition:background .14s,box-shadow .14s">
        <span data-content style="flex:none;width:16px;padding-top:2px;font-size:${SIZE.pill};font-family:${FONT.mono};color:${C.ink32};white-space:nowrap">${number(r)}</span>
        <span style="flex:1;min-width:0">
          <span data-content style="display:block;font-size:${SIZE.body};line-height:1.55;color:${
            r.on ? C.ink : C.ink45
          };${r.on ? "" : "text-decoration:line-through;"}text-wrap:pretty">${esc(r.text)}</span>
          <span style="display:flex;margin-top:4px;align-items:baseline;gap:8px;flex-wrap:wrap">
            <span data-content style="flex:1 1 auto;min-width:0;font-size:${SIZE.meta};line-height:1.5;color:${
              r.on ? "rgba(236,236,241,0.5)" : C.ink32
            }">${esc(r.effect)}</span>
            ${
              isDead(r)
                ? /*
                   * THE PROTOTYPE SAYS "archive it" AND THIS SAYS "switch it
                   * off", because that is what the press does.
                   *
                   * Invariant 6: nothing is deleted, rules switch off. There
                   * is no archived state on a rule in this build and there
                   * should not be one — a rule removed from the pane is a cut
                   * with an unexplained shape. So the offer keeps the
                   * prototype's sentence and its own verb tells the truth
                   * about where the rule goes. Recorded in 12-DEFERRED.md.
                   */
                  `<button class="rule-off" type="button" data-rule="${esc(r.id)}"
                    style="flex:none;font-size:${SIZE.meta};font-weight:500;color:${ACCENT.gold};background:none;border:none;padding:0;cursor:pointer;font-family:${FONT.ui};white-space:nowrap">Does nothing now — switch it off</button>`
                : ""
            }
          </span>
          ${alternatives(r)}
        </span>
        <button class="rule-toggle" data-rule="${esc(r.id)}" data-on="${r.on ? 1 : 0}"
          title="${r.on ? "Turn this rule off" : "Turn it back on"}"
          aria-pressed="${r.on ? "true" : "false"}"
          style="flex:none;position:relative;width:27px;height:15px;margin-top:2px;border-radius:99px;border:none;padding:0;background:${
            r.on ? ACCENT.green : "#2E2E36"
          };cursor:pointer;transition:background .14s">
          <span style="position:absolute;top:2.5px;left:${r.on ? "14px" : "2.5px"};width:10px;height:10px;border-radius:99px;background:${
            r.on ? C.canvas : C.ink45
          };transition:left .14s"></span>
        </button>
      </div>`,
    )
    .join("");

  /*
   * BRING BACK ALL FOUR OF THEM, as one press.
   *
   * A rule that took out two or more moments is a rule worth disagreeing
   * with wholesale, and the alternative the pane offered was to go to the
   * Footage tab and press "click to keep" four times — four decisions to
   * undo one. The prototype offers it per rule, up to three of them, and
   * the action is the rule's own switch: turning it off is what brings its
   * moments back, and it stays in the list saying so.
   */
  const dropped = new Map<string, number>();
  for (const m of moments) {
    if (m.in || !m.dropRule) continue;
    dropped.set(m.dropRule, (dropped.get(m.dropRule) ?? 0) + 1);
  }
  const bulk = main
    .filter((r) => r.on && (dropped.get(String(r.id)) ?? 0) >= 2)
    .slice(0, 3)
    .map((r) => {
      const n = dropped.get(String(r.id)) ?? 0;
      return `<button class="rule-off" type="button" data-rule="${esc(r.id)}"
        style="text-align:left;font-size:${SIZE.meta};font-weight:500;padding:6px 13px;border-radius:7px;background:transparent;color:${C.ink70};border:none;cursor:pointer;font-family:${FONT.ui}"><span data-content>Bring back all ${n} rule ${number(
          r,
        )} took out</span></button>`;
    })
    .join("");

  /*
   * THE DISAGREEMENT COMES FIRST.
   *
   * Which is where the prototype puts it — conflicts at line 303, the rules
   * at 313 — and where the build did not. The pane is capped at half the
   * column and scrolls, so a panel under four rule cards is a panel nobody
   * arriving at the page sees, and it is the one thing here that is a
   * decision rather than a list. Found by rendering it: the note beside the
   * cut said "2 judgement calls", the blocks carried the gold mark, and the
   * panel that acts on both was off the bottom of a scrolling box.
   *
   * A JS comment, not an HTML one. A comment inside a template literal is
   * shipped to the browser, which is how a sentence about a control that
   * does not exist once ended up on a page.
   */
  return `<div style="padding-bottom:13px;border-bottom:1px solid rgba(255,255,255,0.05)">
    <div style="font-size:${SIZE.secondary};font-weight:600;color:${C.ink45}">THE RULES</div>
    ${conflictPanel(moments, main, number)}
    <div style="margin-top:9px;display:flex;flex-direction:column;gap:6px">${rows(main)}</div>
    ${bulk ? `<div style="margin-top:8px;display:flex;flex-direction:column;gap:1px">${bulk}</div>` : ""}
    ${fixesPanel(byHand)}
  </div>`;
}

/**
 * THE FIXES YOU MADE BY HAND, COLLAPSED.
 *
 * A hand decision is a rule in the engine — that is how "keep this one
 * whatever the rules say" survives a recompute — and the pane was showing it
 * as one: a numbered card with a switch, the same weight as "Keep the parts
 * where you are working something out". It is not the same weight. A rule is
 * a standing instruction about the whole cut; a fix is one moment you
 * disagreed about, and ten of them should not push the rules off the screen.
 *
 * So: one line that says how many, a caret, and the fixes under it when you
 * want them — a minus in red for a cut, a plus in green for a keep, and an
 * undo on each. The prototype's shape exactly.
 *
 * UNDO POSTS TO THE MOMENT, not to the rule. Pressing the same decision
 * again takes the hand back and returns the moment to whatever the rules
 * say, which is the only direction that is reversible — see the header of
 * POST /api/projects/:id/moments/:momentId.
 */
function fixesPanel(byHand: CutData["rules"]): string {
  if (!byHand.length) return "";
  const count = byHand.length === 1 ? "1 fix by hand" : `${byHand.length} fixes by hand`;
  const rows = byHand
    .map((f) => {
      const drop = f.kind === "drop";
      return `<div style="display:flex;gap:11px;align-items:baseline;padding:8px 13px;border-radius:7px">
        <span style="flex:none;width:16px;font-size:${SIZE.pill};font-family:${FONT.mono};color:${
          drop ? ACCENT.red : ACCENT.green
        };white-space:nowrap">${drop ? "&minus;" : "+"}</span>
        <span data-content style="flex:1;min-width:0;font-size:${SIZE.secondary};line-height:1.5;color:${C.ink70};text-wrap:pretty">${esc(
          f.text,
        )}</span>
        ${
          f.cid
            ? `<button class="fix-undo" type="button" data-moment="${esc(f.cid)}" data-keep="${drop ? 0 : 1}"
                title="Undo this fix" style="flex:none;font-size:${SIZE.meta};color:${C.ink45};background:none;border:none;padding:0;cursor:pointer;font-family:${FONT.ui};white-space:nowrap">undo</button>`
            : ""
        }
      </div>`;
    })
    .join("");

  return `<div style="margin-top:10px">
    <button class="fixes-toggle" type="button" aria-expanded="false"
      style="width:100%;text-align:left;display:flex;align-items:center;gap:8px;padding:9px 13px;border-radius:8px;background:none;border:none;cursor:pointer;font-family:${FONT.ui}">
      <span data-content style="flex:none;font-size:${SIZE.secondary};color:${C.ink70};white-space:nowrap">and ${count}</span>
      <span class="fixes-caret" style="flex:none;font-size:10px;color:${C.ink45};white-space:nowrap">&#9662;</span>
      <span style="flex:1;height:1px;background:rgba(255,255,255,0.05)"></span>
    </button>
    <div class="fixes-list" hidden style="display:flex;flex-direction:column;gap:1px">${rows}</div>
  </div>`;
}

/**
 * WHEN TWO OF YOUR OWN RULES DISAGREE.
 *
 * src/rules.ts has recorded `contest` on every moment a keep rule and a drop
 * rule both matched since the engine was ported, and NOTHING in src/ui/ read
 * it. So a cut built from rules that contradict each other looked exactly
 * like one built from rules that agree — which is the one thing a pane of
 * visible rules exists to prevent.
 *
 * ONE CONFLICT, NOT A LIST, and the prototype is deliberate about this:
 * `Object.keys(pairs).slice(0, 1)`. A list of disagreements is a form to work
 * through; one disagreement is a decision to make. The rest are still counted
 * in the note beside the cut's own numbers and still marked on their blocks.
 *
 * The default is stated rather than assumed — taking out beats keeping unless
 * you say otherwise — because a user who cannot see which way it went cannot
 * tell a decision from a bug.
 */
function conflictPanel(
  moments: CutData["moments"],
  main: CutData["rules"],
  number: (r: CutData["rules"][number]) => string,
): string {
  const pairs = new Map<string, { k: string; d: string; kId: string; n: number }>();
  for (const m of moments) {
    if (!m.contest) continue;
    const key = `${m.contest.k}-${m.contest.d}`;
    const row = pairs.get(key) ?? { k: m.contest.k, d: m.contest.d, kId: m.contest.kId, n: 0 };
    row.n += 1;
    pairs.set(key, row);
  }
  const first = [...pairs.values()][0];
  if (!first) return "";

  /* A conflict naming a rule that is no longer in the pane — archived, or by
     hand — is a conflict nobody can act on, so it is not shown. */
  const nums = new Set(main.map((r) => number(r)));
  if (!nums.has(first.k) || !nums.has(first.d)) return "";

  const red = ACCENT.red;
  return `<div style="margin-top:10px;padding:12px 13px;border-radius:9px;background:rgba(224,106,106,0.07);box-shadow:inset 0 0 0 1px rgba(224,106,106,0.25)">
    <div data-content style="font-size:12.5px;font-weight:600;color:${red};line-height:1.5">Rules ${esc(first.k)} and ${esc(
      first.d,
    )} disagree on ${first.n} moment${first.n === 1 ? "" : "s"}.</div>
    <div data-content style="margin-top:4px;font-size:12px;line-height:1.55;color:${C.ink70};text-wrap:pretty">Rule ${esc(
      first.d,
    )} wins, because taking out beats keeping unless you say otherwise. Those moments are out.</div>
    <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
      <button class="rule-wins" type="button" data-rule="${esc(first.kId)}" style="font-size:11.5px;font-weight:500;padding:5px 12px;border-radius:5px;background:${
        C.active
      };color:${C.ink};border:none;cursor:pointer;font-family:inherit;white-space:nowrap"><span data-content>Let ${esc(
        first.k,
      )} win</span></button>
      <button class="show-contested" type="button" style="font-size:11.5px;font-weight:500;padding:5px 12px;border-radius:5px;background:transparent;color:rgba(236,236,241,0.5);border:none;cursor:pointer;font-family:inherit;white-space:nowrap">Show which moments</button>
    </div>
  </div>`;
}

/**
 * FIND, ON THE DOCUMENT WHERE IT BELONGS.
 *
 * This was merged into the assistant yesterday, on the argument that find and
 * ask are the same gesture at different precision. That is true and it was
 * still wrong: it made the one control the product is about look like a
 * search box, and the owner said so — "the chat, it's not very pronounced...
 * I don't think people would actually even understand what that was".
 *
 * So find comes back to the transcript. It is a document tool: it searches
 * the words in front of you, it costs nothing, and it belongs at the top of
 * the thing it searches. Asking costs minutes and money and belongs in the
 * conversation.
 */
function findBar(projectId: string): string {
  /* The hits list is INSIDE .find. The client looks its parts up from that
     one element, so a sibling is a null it will happily crash on. */
  return `<div class="find" data-project="${esc(projectId)}" style="margin-bottom:10px">
    <div style="display:flex;gap:8px;align-items:center;background:${C.surface};border-radius:7px;padding:3px 4px 3px 12px">
      <span style="flex:none;display:grid;place-items:center;color:${C.ink32}">${iconSearch({ size: 13 })}</span>
      <input class="find-q" autocomplete="off" placeholder="Find a word in this cut"
        style="flex:1;min-width:0;background:transparent;border:none;outline:none;color:${C.ink};font-size:${SIZE.secondary};padding:8px 0;font-family:${FONT.ui}"/>
      <span class="find-count" data-content style="flex:none;font-size:${SIZE.meta};font-family:${FONT.mono};color:${C.ink32};font-variant-numeric:tabular-nums"></span>
      <button class="find-cut" hidden style="flex:none;font-size:${SIZE.meta};font-weight:600;padding:6px 11px;border-radius:${RADIUS.button};background:${C.pill};color:rgba(236,236,241,0.85);border:none;cursor:pointer;font-family:${FONT.ui};white-space:nowrap"></button>
    </div>
    <div class="find-hits" style="margin-top:8px;display:flex;flex-direction:column;gap:1px;max-height:230px;overflow-y:auto"></div>
  </div>`;
}

/**
 * THE ASSISTANT.
 *
 * "It's like a chatbot LLM powered video editing system that also is like
 * blocks — blocking instead of non-linear video editing."
 *
 * That is the product, and until now it looked like a footnote: a grey field
 * with a magnifier in it, a dropdown you had to open, and a pass that ran by
 * reloading the page and never saying what it had done.
 *
 * This is a column that reads as what it is — the video you are both looking
 * at, the conversation about it, and a box to type in at the bottom. That
 * shape needs no explaining to anybody who has used software in the last
 * three years, which was the entire problem.
 *
 * The composer is Home's composer (src/ui/pages/home.ts) — the same raised
 * box, the same RADIUS.composer that exists in the tokens for nothing else.
 * One object for telling Aldershot what you want, on the way in and while you
 * work, rather than a designed box on the marketing page and a search field
 * where the work happens.
 */
function assistant(d: CutData, player: string): string {
  /* "47 · −0:31". Nothing is shown unless it was counted — the rule the chips
     have always followed. A clean-up with nothing to clean has nothing to do,
     so it is quiet rather than lying about a number. */
  const note = (n: { found: number; savedMs: number }) =>
    n.found ? `${n.found} · −${hms(n.savedMs / 1000)}` : "";

  /*
   * A verb that is only a sentence.
   *
   * It carries the instruction it would type, so pressing it and typing it
   * are the same act and the button teaches the box. Nothing here is a
   * special path through the code: every one of these ends up in the same
   * pass the composer sends.
   */
  const ask = (label: string, instruction: string) =>
    `<button type="button" class="verb-ask" data-ask="${esc(instruction)}" style="display:flex;align-items:baseline;font-size:${SIZE.meta};font-weight:500;padding:6px 10px;border-radius:${RADIUS.button};background:${C.pill};color:rgba(236,236,241,0.7);border:none;cursor:pointer;font-family:${FONT.ui};white-space:nowrap">${label}</button>`;

  const quick = (cls: string, label: string, n: string, live: boolean, gold = false) =>
    `<button type="button" class="${cls}"${live ? "" : " disabled"} style="display:flex;align-items:baseline;gap:6px;font-size:${SIZE.meta};font-weight:500;padding:6px 10px;border-radius:${RADIUS.button};background:${C.pill};color:${
      gold ? ACCENT.gold : "rgba(236,236,241,0.7)"
    };border:none;cursor:${live ? "pointer" : "default"};font-family:${FONT.ui};white-space:nowrap;${live ? "" : "opacity:.4;"}">
      <span>${label}</span>${n ? `<span data-content style="font-family:${FONT.mono};color:${C.ink32}">${esc(n)}</span>` : ""}
    </button>`;

  /*
   * A TURN, and what it actually did.
   *
   * A pass used to reload the page and leave you to notice that some blocks
   * had changed colour. It says what it did now, and offers the way back for
   * as long as the turn is on screen — the old undo was a toast that expired
   * in six seconds or a keyboard shortcut the owner does not use, which made
   * the one action that rewrites the whole cut effectively permanent.
   */
  const turn = (p: CutData["passes"][number]) => {
    const empty = /^no matches/.test(p.result);
    return `<div class="turn" data-pass="${esc(p.id)}" style="display:flex;flex-direction:column;gap:6px">
      <div data-content style="align-self:flex-end;max-width:92%;font-size:${SIZE.secondary};line-height:1.5;padding:8px 11px;border-radius:9px;background:${C.pill};color:rgba(236,236,241,0.9)">${esc(p.instruction)}</div>
      <div style="max-width:92%;display:flex;flex-direction:column;gap:6px">
        <div data-content style="font-size:${SIZE.secondary};line-height:1.5;color:${empty ? ACCENT.gold : ACCENT.green}">${esc(p.result)}</div>
        ${
          p.undoable || p.first_change
            ? `<div style="display:flex;gap:6px;flex-wrap:wrap">
                ${
                  /* Where to look. The research on this whole category lands on
                     one point: the question is not whether the model can do
                     more, it is whether a person can check what it chose faster
                     than doing it themselves. */
                  p.first_change
                    ? `<button class="turn-show" data-block="${esc(p.first_change)}" style="font-size:${SIZE.meta};font-weight:600;padding:5px 10px;border-radius:${RADIUS.button};background:${C.pill};color:${C.ink70};border:none;cursor:pointer;font-family:${FONT.ui}">Show me</button>`
                    : ""
                }
                ${
                  p.undoable
                    ? `<button class="turn-undo" data-pass="${esc(p.id)}" data-project="${esc(d.projectId)}" style="font-size:${SIZE.meta};font-weight:600;padding:5px 10px;border-radius:${RADIUS.button};background:${C.pill};color:${C.ink70};border:none;cursor:pointer;font-family:${FONT.ui}">Undo this</button>`
                    : ""
                }
              </div>`
            : ""
        }
      </div>
    </div>`;
  };

  /* Nothing said yet. The verbs below say what this can do far better than a
     sentence could — that was the mistake this replaces. */
  const talk = d.passes.length
    ? d.passes.map(turn).join("")
    : `<div style="font-size:${SIZE.secondary};line-height:1.6;color:${C.ink45}">Press one, or say it in your own words.</div>`;

  /*
   * THE RULES, at the top of direction. They are the standing answer to
   * "why these moments"; the conversation below is the history of asking,
   * and the composer under that is where the next one goes. The player used
   * to sit here and is now its own column.
   *
   * ONE SCROLLER, THE COMPOSER OUTSIDE IT — the prototype's shape. The
   * three boxes that were here each had their own constraint and the rules
   * lost: see .asst-scroll in src/ui/shell.ts for the measurement that
   * settled it. A JS comment, because an HTML one ships to the browser.
   */
  return `<div class="asst" data-project="${esc(d.projectId)}">
    <div class="asst-scroll">
      <div class="asst-top">${player}${rulesPanel(d.rules, d.moments)}</div>
      <div class="asst-scout">${scoutPanel(d.projectId)}</div>
      <div class="asst-talk" style="display:flex;flex-direction:column;gap:16px;padding:14px 2px">
        ${talk}
      </div>
    </div>

    <div class="asst-foot" style="flex:none;padding-top:10px">
      <!--
        THE VERBS, VISIBLE.

        These were nine chips. I replaced them with one sentence and called
        nine "a wall you skip rather than read", which was optimising for
        tidiness on the control this product is supposed to be about. They are
        back, chosen from what the category actually ships and what it does
        not.

        SIX VISIBLE, the rest one press away. Products converge on three to
        six in front and everything else a layer down — Descript removed its
        always-visible action bar once it had fifteen; Vidocu keeps eleven
        categories behind three presets; Submagic collapsed to one. And a chat
        with no suggested prompts is a discoverability failure: after two years
        of Underlord there is no community prompt library for it, only the
        vendor's own copy. Even the chat-first product sells itself with chips.

        TWO ROWS, because they are two different promises. Clean up is
        subtractive and reversible and mostly counted — press it and you know
        what happens. Shape asks the model to make a judgement, costs a pass,
        and might come back with nothing.

        Labels are imperative verb plus concrete noun, in the words a person
        would use. "Cut the tangents" over "Edit for Clarity"; "Start where I
        start" over "Auto Trim Intro". A destructive button whose name does
        not say what disappears is the thing people are frightened of.
      -->
      <div style="font-size:${SIZE.meta};font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:${C.ink32};margin-bottom:6px">Clean up</div>
      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:10px">
        ${quick("clean-fillers", "Remove “um” and “uh”", note(d.cleanups.fillers), d.cleanups.fillers.found > 0)}
        ${quick("clean-pauses", "Tighten silences", note(d.cleanups.pauses), d.cleanups.pauses.found > 0)}
        ${ask("Start where I start", "cut everything before the first real sentence — the mic check, the throat clearing, the false start")}
      </div>

      <div style="font-size:${SIZE.meta};font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:${C.ink32};margin-bottom:6px">Shape it</div>
      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:10px">
        ${quick("find-good", "Keep only the good bits", "", true, true)}
        ${ask("Cut the tangents", "cut the tangents and the bits that go nowhere")}
        ${ask("Lead with the best line", "put the strongest line first")}
        <button type="button" class="verb-more" style="display:flex;align-items:baseline;font-size:${SIZE.meta};font-weight:500;padding:6px 10px;border-radius:${RADIUS.button};background:transparent;color:${C.ink32};border:none;cursor:pointer;font-family:${FONT.ui};white-space:nowrap">More</button>
      </div>

      <!--
        The long tail. Every one is a sentence you could have typed, which is
        the rule: no button does anything the box cannot, so learning the
        buttons teaches you the box.
      -->
      <div class="verb-rest" hidden style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:10px">
        ${ask("Cut the hedges", "cut the hedging — “I think”, “kind of”, “sort of”, “if that makes sense”")}
        ${ask("Cut the meta", "cut the bits about the video itself — “sorry about the audio”, “like and subscribe”, “as I said last time”")}
        ${ask("Remove the sponsor read", "cut the sponsor read")}
        ${ask("Say it once", "I say the same thing more than once — keep the best telling and cut the rest")}
        ${ask("Make it half as long", "cut this down to about half as long, keeping what matters")}
        ${ask("Cut where I asked", "cut the bits where I said to cut it — “can we cut that”, “strike that”, “let’s do that again”")}
      </div>
      <!--
        WHAT IT WOULD DO, WAITING TO BE AGREED TO.
        
        Only ever filled on Ask. Rendered hidden rather than built by the
        client, for the reason the answer panel gives: the shape of a
        proposal belongs in the same file as the shape of everything else on
        this page, and the gate's wiring check can only see what a page
        renders.
      -->
      <div id="proposal" hidden style="margin-bottom:10px;padding:11px 13px;border-radius:${RADIUS.card};background:${C.surface};box-shadow:inset 0 0 0 1px rgba(255,255,255,0.07)">
        <div id="proposalRule" style="font-size:${SIZE.secondary};line-height:1.5;color:${C.ink}"></div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:9px">
          <button type="button" id="proposalAdd" style="flex:none;font-size:${SIZE.meta};font-weight:500;padding:6px 14px;border-radius:5px;background:${C.ink};color:#131316;border:none;cursor:pointer;font-family:${FONT.ui}">Add it</button>
          <button type="button" id="proposalBin" style="flex:none;font-size:${SIZE.meta};font-weight:500;padding:6px 14px;border-radius:5px;background:transparent;color:${C.ink45};border:none;cursor:pointer;font-family:${FONT.ui}">Leave it</button>
          <span style="flex:1"></span>
          <span id="proposalDiff" data-content style="flex:none;font-size:${SIZE.meta};font-family:${FONT.mono};color:${C.ink45};white-space:nowrap"></span>
        </div>
      </div>
      <form class="pass-form" style="position:relative;background:${C.raised};border-radius:${RADIUS.composer};padding:6px;box-shadow:0 0 0 1px rgba(255,255,255,0.06), 0 12px 40px rgba(0,0,0,0.3)">
        <textarea name="instruction" rows="2" placeholder="Ask for a change…"
          style="display:block;width:100%;box-sizing:border-box;background:transparent;border:none;outline:none;resize:none;padding:9px 10px 4px;color:${C.ink};font-size:${SIZE.body};line-height:1.5;font-family:${FONT.ui}"></textarea>
        <div style="display:flex;align-items:center;gap:8px;padding:0 4px 2px">
          <!--
            SAY IT INSTEAD OF TYPING IT. The words land in the box above for
            you to read and fix before anything runs — voice is the fast way
            in, not a way to spend a pass on a sentence nobody checked.

            Type and a coloured dot, not a ninth icon: src/ui/icons.ts says
            outright that if a feature seems to need one, it does not. The
            blinking red dot is the recorder's, because it means the same
            thing in both places.
          -->
          <button type="button" class="asst-mic"
            style="flex:none;display:flex;align-items:center;gap:5px;font-size:${SIZE.meta};font-weight:500;padding:6px 10px;border-radius:${RADIUS.button};background:${C.pill};color:${C.ink70};border:none;cursor:pointer;font-family:${FONT.ui};white-space:nowrap"><span class="asst-mic-dot" hidden style="width:6px;height:6px;border-radius:50%;background:${ACCENT.red};animation:blip 1.1s ease-in-out infinite"></span><span class="asst-mic-label">Say it</span></button>
          ${dial(d.askMode ?? DEFAULT_MODE)}
          <!--
            ONE LINE, ELLIPSIZED. The dial went in beside the mic and this
            hint wrapped, which grew the footer by a row and pushed the
            composer under the export bar — caught by check-editor.cjs, which
            exists for exactly that overlap and has caught it before.
            
            Truncating this is the right thing to lose: the blinking red dot
            and the button's own label already carry the recorder's state, as
            the note above says, so the sentence is the third copy of it.
          -->
          <span class="asst-hint" style="flex:1 1 40px;min-width:0;font-size:${SIZE.meta};color:${C.ink32};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">It reads the whole transcript.</span>
          <button type="submit" style="flex:none;font-size:${SIZE.meta};font-weight:600;padding:7px 14px;border-radius:${RADIUS.button};background:${C.ink};color:#131316;border:none;cursor:pointer;font-family:${FONT.ui}">Run it</button>
        </div>
      </form>
    </div>
  </div>`;
}

/**
 * A slice of the block list, for scrolling into a long transcript.
 *
 * Deliberately the same blockRow the first page uses: the client appends this
 * HTML verbatim and never constructs a block itself, so there is exactly one
 * definition of what a block looks like.
 */
export function renderBlockSlice(
  projectId: string,
  blocks: Block[],
  cuts: Cut[],
  from: number,
  to: number,
  view: CutView = "blocks",
): string {
  const out: string[] = [];
  for (let i = from; i < Math.min(to, blocks.length); i++) {
    out.push(blockRow(blocks[i], cuts, i, blocks.length, view));
    out.push(seam(projectId, i + 1, view));
  }
  return out.join("");
}

/**
 * The library with the cut's verdict on each moment.
 *
 * "in · rule 01" or "out · rule 02 · click to keep" — the reference's own
 * wording, and the numbering has to match the pane exactly or a moment points
 * at the wrong line. Green for in, because the colour carries the verdict for
 * anyone scanning rather than reading.
 */
/**
 * ADD A VIDEO TO THIS CUT.
 *
 * The label is the prototype's own — "Add footage", the heading on its attach
 * panel. It read "not in this cut" until the gate was run against a database
 * that had drifted: three videos unattached to the open project, which is the
 * only state this label renders in, and neither CI's fresh fixture nor
 * render-pages.mjs had ever produced it. So the words were in the product and
 * had been read by no check on any machine. There is a fixture for it now.
 *
 * The same gesture as attaching before a project exists, after it does. Its
 * moments are judged by the rules already on the board the moment it lands —
 * which is what "they join left out until a rule or your hand keeps them"
 * means once there are rules to do the keeping.
 */
function addToCut(d: CutData): string {
  if (!d.addable.length) return "";
  return `<div style="margin-top:14px;display:flex;gap:8px;align-items:baseline;flex-wrap:wrap">
    <span style="flex:none;font-size:${SIZE.meta};color:${C.ink45};font-family:${FONT.mono}">Add footage</span>
    ${d.addable
      .map(
        (s) => `<button class="add-source" type="button" data-source="${esc(s.id)}"
          style="font-size:${SIZE.meta};padding:5px 10px;border-radius:${RADIUS.button};background:${C.pill};color:${C.ink70};border:none;cursor:pointer;font-family:inherit;max-width:min(220px,100%);overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><span data-content>${esc(s.title)}</span></button>`,
      )
      .join("")}
  </div>`;
}

/**
 * FOOTAGE'S THREE TABS, INSIDE A PROJECT.
 *
 * Videos, Highlights, Projects — the prototype keeps all three whether or
 * not a project is open, and the build had rendered only Highlights. The
 * cost of that was not cosmetic: "Only this" is a per-video control, so the
 * engine's per-source scoping had no surface anywhere in the product.
 *
 * Links, not buttons, because each tab is a URL you can arrive at.
 */
function footageTabs(d: CutData, tab: ProjFootTab): string {
  const tabs: Array<[ProjFootTab, string]> = [
    ["videos", "Videos"],
    ["moments", "Highlights"],
    ["made", "Projects"],
  ];
  return `<div class="footage-tabs" style="margin-top:4px;display:flex;gap:4px">${tabs
    .map(
      ([k, name]) =>
        `<a href="/p/${esc(d.projectId)}/footage?tab=${k}"${tab === k ? ' aria-current="page"' : ""}
          style="font-size:${SIZE.secondary};padding:5px 11px;border-radius:${RADIUS.button};text-decoration:none;background:${
            tab === k ? "#2E2E36" : "transparent"
          };color:${tab === k ? C.ink : C.ink45}">${name}</a>`,
    )
    .join("")}</div>`;
}

/**
 * THE VIDEOS THIS CUT IS MADE OF, and how much of each one it uses.
 *
 * "41:06 · 3 of 5 moments in this cut" — the count is through the rules, so
 * a video contributing nothing says so, which is the question this tab
 * exists to answer. Nothing else in the product can tell you that: the
 * lettered chips say which videos, and Highlights says which moments, and
 * neither says which video is carrying the cut.
 *
 * ONLY THIS is the control, and pressing it is reversible by pressing it
 * again — the narrowing is its own column and the project's record of what
 * it is made of does not move. The row says so rather than making anyone
 * guess, because "only" is a word people have been burned by.
 */
function videosInCut(d: CutData): string {
  const sources = d.cutSources ?? d.sources ?? [];
  if (!sources.length) {
    return `<div style="margin-top:20px;font-size:${SIZE.secondary};color:${C.ink45}">This cut has no videos attached yet.</div>`;
  }

  const total = new Map<string, number>();
  const kept = new Map<string, number>();
  for (const m of d.moments) {
    if (!m.sourceId) continue;
    total.set(m.sourceId, (total.get(m.sourceId) ?? 0) + 1);
    if (m.in) kept.set(m.sourceId, (kept.get(m.sourceId) ?? 0) + 1);
  }

  const only = d.onlySourceId ?? null;
  const rows = sources
    .map((src, i) => {
      const n = total.get(src.id) ?? 0;
      const nIn = kept.get(src.id) ?? 0;
      const isOnly = only === src.id;
      const meta = `${src.duration_s ? hms(src.duration_s) + " · " : ""}${nIn} of ${n} moment${
        n === 1 ? "" : "s"
      } in this cut`;
      return `<div style="display:flex;gap:11px;align-items:center;padding:11px 13px;border-radius:${RADIUS.input};background:${C.surface};box-shadow:inset 0 0 0 1px ${
        isOnly ? "rgba(94,201,143,0.4)" : "rgba(255,255,255,0.05)"
      }">
        <span style="flex:none;width:20px;height:20px;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:${SIZE.meta};font-weight:600;font-family:${FONT.mono};background:${
          CHIP_COLOURS[i % CHIP_COLOURS.length]
        }33;color:${CHIP_COLOURS[i % CHIP_COLOURS.length]}">${letterFor(i)}</span>
        <div style="flex:1;min-width:0">
          <div data-content style="font-size:${SIZE.secondary};color:${C.ink};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(src.title)}</div>
          <div data-content style="margin-top:2px;font-size:${SIZE.meta};color:${C.ink45};font-family:${FONT.mono}">${esc(meta)}</div>
        </div>
        <button class="only-source" type="button" data-source="${esc(src.id)}"${
          isOnly ? " data-only" : ""
        } style="flex:none;font-size:${SIZE.meta};padding:5px 11px;border-radius:${RADIUS.button};border:none;cursor:pointer;font-family:${FONT.ui};white-space:nowrap;background:${C.pill};color:${
          isOnly ? ACCENT.green : C.ink45
        }">${isOnly ? "Only this \u2713" : "Only this"}</button>
      </div>`;
    })
    .join("");

  /* One text node each, deliberately: an <em> in the middle of a sentence
     splits it into fragments, and the copy check reads text nodes. */
  const note = only
    ? "This cut is narrowed to one video. The others are still attached \u2014 press Only this \u2713 again and they all come back."
    : "How much of each video the rules are using. Press Only this to cut from one of them alone.";

  return `<div style="margin-top:14px;font-size:${SIZE.secondary};line-height:1.55;color:${C.ink45};max-width:620px">${note}</div>
    <div class="video-list" style="margin-top:14px;display:flex;flex-direction:column;gap:6px">${rows}</div>`;
}

/**
 * THE OTHER CUTS, from inside this one.
 *
 * The prototype's third tab. Deliberately thin: the title row's switcher is
 * how you MOVE between projects, and this is the tab the prototype puts
 * them on, so it lists them and links to them rather than inventing a
 * second way to open one.
 */
function projectsBeside(d: CutData): string {
  const others = (d.projects ?? []).filter((p) => p.id !== d.projectId);
  if (!others.length) {
    return `<div style="margin-top:20px;font-size:${SIZE.secondary};color:${C.ink45}">This is your only project so far.</div>`;
  }
  return `<div class="other-projects" style="margin-top:14px;display:flex;flex-direction:column;gap:6px">${others
    .map(
      (p) => `<a href="/p/${esc(p.id)}/cut" style="display:flex;gap:11px;align-items:center;padding:11px 13px;border-radius:${RADIUS.input};background:${C.surface};text-decoration:none;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.05)">
        <div style="flex:1;min-width:0">
          <div data-content style="font-size:${SIZE.secondary};color:${C.ink};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.title)}</div>
          <div data-content style="margin-top:2px;font-size:${SIZE.meta};color:${C.ink45};font-family:${FONT.mono}">${
            p.runtime_s ? hms(p.runtime_s) : "nothing cut yet"
          }</div>
        </div>
        <span style="flex:none;font-size:${SIZE.meta};color:${C.ink45}">Open</span>
      </a>`,
    )
    .join("")}</div>`;
}

/** Footage inside a project: the tabs, then whichever one is open. */
function footageSurface(d: CutData): string {
  const tab = d.footageTab ?? "moments";
  return (
    footageTabs(d, tab) +
    (tab === "videos"
      ? videosInCut(d)
      : tab === "made"
      ? projectsBeside(d)
      : addToCut(d) + momentsThroughRules(d))
  );
}

function momentsThroughRules(d: CutData): string {
  if (!d.moments.length) {
    return `<div style="margin-top:20px;font-size:${SIZE.secondary};color:${C.ink45}">Nothing in your library yet.</div>`;
  }

  /*
   * EVERY ROW IS A BUTTON, because every row's note promises a click.
   *
   * "out · rule 02 · click to keep" shipped on a div with no handler — a
   * sentence on screen telling somebody to do something that does nothing.
   * The same failure as the MAKE cards one commit earlier, and the gate did
   * not catch this one either, so it grew a rule about promised clicks too.
   *
   * Disagreeing with a rule is the point of this tab: a hand decision
   * overrides every rule above it (step 6 of the engine), so keeping a moment
   * the cap dropped is one press, and the cut is re-produced around it.
   */
  const order = sourceIndex(d);
  const many = (d.sources ?? []).length > 1;

  /*
   * THE THREADS, WITH THEIR COUNTS.
   *
   * The prototype puts "Everything · 14" and one chip per thread above the
   * grid, and pressing one narrows it. A library of a hundred moments with
   * no way to say "just the money ones" is a scroll, not a tab.
   *
   * Only when there is more than one thread to choose between: a single
   * chip beside Everything is a control whose two states show the same
   * list.
   */
  const threads = new Map<string, number>();
  for (const m of d.moments) if (m.thread) threads.set(m.thread, (threads.get(m.thread) ?? 0) + 1);
  const chip = (key: string, name: string, n: number, on: boolean) =>
    `<button class="thread-chip" type="button" data-thread="${esc(key)}"${on ? " data-current" : ""}
      style="font-size:${SIZE.meta};padding:4px 10px;border-radius:4px;border:none;cursor:pointer;font-family:${FONT.ui};white-space:nowrap;background:${
        on ? "#2E2E36" : C.surface
      };color:${on ? C.ink : C.ink70}"><span data-content>${esc(name)} ${n}</span></button>`;
  const chips =
    threads.size > 1
      ? `<div style="margin-top:12px;display:flex;gap:5px;flex-wrap:wrap">${
          chip("", "Everything", d.moments.length, true) +
          [...threads].map(([name, n]) => chip(name, name, n, false)).join("")
        }</div>`
      : "";

  const rows = d.moments
    .map((m) => {
      const idx = m.sourceId === undefined || m.sourceId === null ? undefined : order.get(m.sourceId);
      /* One video needs no letter: "A" down a single-source list is a column
         of the same character. Same rule as the Words gutter. */
      const letter = idx === undefined || !many ? "" : letterFor(idx) + " ";
      const colour = idx === undefined ? C.ink45 : CHIP_COLOURS[idx % CHIP_COLOURS.length];
      const at = m.startMs === undefined ? "" : `${letter}${hms(m.startMs / 1000)}`;
      const dur = m.durMs === undefined ? "" : hms(m.durMs / 1000);
      return `<button class="moment-hand" type="button" data-moment="${esc(m.id)}" data-in="${m.in ? 1 : 0}"
        data-thread="${esc(m.thread ?? "")}"
        style="display:flex;gap:12px;align-items:baseline;padding:10px 12px;border-radius:${RADIUS.card};background:${C.surface};opacity:${m.in ? "1" : ".62"};width:100%;text-align:left;border:none;cursor:pointer;font-family:inherit">
        ${
          at
            ? `<span data-content style="flex:none;min-width:52px;font-size:${SIZE.meta};font-family:${FONT.mono};color:${colour}">${esc(at)}</span>`
            : ""
        }
        <span data-content style="flex:1 1 200px;min-width:min(180px,100%);font-size:${SIZE.secondary};line-height:1.5;color:${C.ink70}">${esc(m.quote.slice(0, 120))}</span>
        ${
          dur
            ? `<span data-content style="flex:none;font-size:${SIZE.meta};font-family:${FONT.mono};color:${C.ink32}">${esc(dur)}</span>`
            : ""
        }
        <span data-content style="flex:none;font-size:${SIZE.meta};font-family:${FONT.mono};color:${m.in ? ACCENT.green : C.ink45}">${esc(m.note)}</span>
      </button>`;
    })
    .join("");

  /* What the tab is for, said once at the top — the prototype's own
     sentence. Two different gestures live on these rows and neither is
     guessable from a row that looks like every other row. */
  return `<div style="margin-top:14px;font-size:${SIZE.secondary};line-height:1.55;color:${C.ink45};max-width:620px;text-wrap:pretty">Every moment, through this project's rules. Click one that's out to keep it by hand; click one that's in to go to it.</div>
    ${chips}
    <div class="moment-list" style="margin-top:14px;display:flex;flex-direction:column;gap:6px">${rows}</div>`;
}

export function renderCut(d: CutData): string {

  /*
   * ONE ROW, which is what the prototype has.
   *
   * It was two: a back link on its own line, then a 24px page title beside
   * the view tabs. One Take's second row is a single 8px-padded line
   * carrying the title at 13.5px, the tabs and the rest — and the back link
   * is not in it at all, because the WORDMARK is the way out of a project
   * and now says so ("Close the project — back to your footage"). Two
   * controls for one destination is the same thing the nav bar was doing
   * with Home.
   *
   * It is also 50px of a column that did not have 25 to spare: the editor's
   * conversation pane was being crushed to 125px — "not even one exchange",
   * in check-editor.cjs's words — by a header taller than the design's.
   */
  const head = `<!-- The runtime and the kept count were here AND in the bottom bar: the
       same two numbers twice on one screen. The bar is the one that stays
       with you as you scroll, so it is the one that keeps them. The ids
       remain because the client retotals by id and a second display that
       could disagree is worse than none. -->
  <!--
    STICKY UNDER THE NAV, which is what makes moving Export here safe.
    
    One Take is a 100vh shell whose second row never scrolls away; the
    build's page scrolls the document, so a title row that scrolled would
    take Export with it and leave the control further out of reach than the
    bottom bar it replaced. 52px is the nav's height — the row sits
    directly under it.
  -->
  <div style="position:sticky;top:52px;z-index:4;margin:0 -4px;padding:10px 4px;background:rgba(16,16,19,0.92);backdrop-filter:blur(14px);display:flex;align-items:center;gap:12px;flex-wrap:wrap">
    ${switcher(d.title, d.projects ?? [], d.projectId)}
    <!-- The videos this cut is made of, lettered in the order it uses them.
         One Take puts them here, beside the name. -->
    ${sourceChips(d.sources ?? [])}
    <!--
      TWO READINGS OF THE SAME EDIT.

      Blocks is a thing per line, with its frame and its verbs. Script is the
      words, flowing, with everything else quiet until you are on a line. Same
      dom, same handlers, same cuts — only the styling differs, so neither can
      drift from the other.

      Two urls rather than a toggle in the page, because /p/:id/script already
      existed as a legacy alias and this is what it always should have meant.
    -->
    <div class="view-swap" style="margin-left:auto">
      <a href="/p/${esc(d.projectId)}/footage"${d.view === "footage" ? ' aria-current="page"' : ""}>Footage</a>
      <a href="/p/${esc(d.projectId)}/cut"${(d.view ?? "blocks") === "blocks" ? ' aria-current="page"' : ""}>Blocks</a>
      <a href="/p/${esc(d.projectId)}/script"${d.view === "script" ? ' aria-current="page"' : ""}>Words</a>
      <a href="/p/${esc(d.projectId)}/shorts"${d.view === "shorts" ? ' aria-current="page"' : ""}>Shorts</a>
    </div>
    <!-- Rename, duplicate, delete. It was on the back-link row that this
         replaced; it is a control and had to come with it. -->
    <span style="flex:none">${itemMenu("projects", d.projectId, d.title, "cut")}</span>
    <!--
      EXPORT IS HERE, which is where One Take has it: top right of the title
      row, labelled with what you would get. The build had a sticky bar
      glued to the bottom of the page carrying it, and the prototype has no
      bottom bar at all — it is a 100vh shell whose second row never scrolls
      away, so the control is always to hand without a bar to hold it.

      The label is the prototype's shape, "Export 5:59", rather than "Export
      as": the runtime is the thing you are about to commit to and it was
      previously two inches away in a different bar.
    -->
    <button class="export-open" data-project="${esc(d.projectId)}" style="flex:none;font-size:${SIZE.secondary};font-weight:600;padding:7px 15px;border-radius:5px;background:${C.ink};color:#131316;border:none;cursor:pointer;font-family:${FONT.ui};white-space:nowrap">Export <span id="cut-runtime" data-content>${hms(d.runtimeMs / 1000)}</span></button>
  </div>
  <!--
    WHAT THE CUT IS AND WHETHER IT SAVED, in the prototype's own slots.
    
    One Take's title row carries two quiet mono notes after the name, and
    this is what the build has to put in them: how much is kept, whether
    the last gesture landed, and what is still outstanding. They were in
    the bottom bar with Export; the bar is gone and they are not.

    (No backticks in here. This is an HTML comment inside a template
    literal, so it is text to the parser, and one backtick ends the
    literal — which is what the template rule in check-fidelity.cjs was
    written for, and what just happened writing this very comment.)
  -->
  <div style="margin-top:6px;display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;font-family:${FONT.mono};font-size:${SIZE.meta}">
    <span id="cut-kept" data-content style="flex:none;color:${C.ink45}">${d.keptCount} kept</span>
    <span id="saved-state" data-content hidden style="flex:none;color:${C.ink32};white-space:nowrap"></span>
    ${
      /* Only when something IS outstanding. "every beat is filled." on a cut
         with nothing in it is noise, and on a finished one it is a pat on the
         back nobody asked for. */
      d.beats.length && buildSummary(d.beats) !== "every beat is filled."
        ? `<span data-content style="flex:none;color:${ACCENT.gold};white-space:nowrap">${esc(buildSummary(d.beats))}</span>`
        : ""
    }
  </div>`;

  /*
   * A pass running is a STRIP, not a screen.
   *
   * This used to return early: press "Find the strong bits" and the whole
   * editor was replaced by one line with a blinking dot, so your blocks
   * vanished and there was nothing to do but wait. Nothing about the pass
   * stops you cutting in the meantime, and the answer arrives as scores on
   * blocks that are already there.
   *
   * The bar is real. scorePass reads the transcript in windows and reports
   * windows finished, so the width below is measured work — never elapsed
   * time, which is the one thing this codebase will not put in a progress bar.
   */
  const running = d.job && (d.job.state === "queued" || d.job.state === "running");
  /*
   * ZERO IS NOT A MEASUREMENT.
   *
   * A pass over a short transcript is a single window, so there is no fraction
   * to report until the whole thing is done — and this dutifully printed "0%"
   * beside a clock ticking past four minutes, which reads as a stalled product
   * rather than an unmeasurable one. The stage and the clock are both true;
   * the number was not, so it is simply absent until there is one.
   */
  const shownPct = (p: number) => (p > 0 ? `${p}%` : "");
  const strip = running
    ? `<div id="scoring" data-project="${esc(d.projectId)}" style="margin-top:18px;padding:12px 16px;border-radius:${RADIUS.card};background:#141418;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.04)">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <span style="width:6px;height:6px;border-radius:50%;background:${ACCENT.gold};animation:blip 1.6s ease-in-out infinite;flex:none"></span>
          <span id="scoring-label" data-content style="flex:1 1 200px;font-size:${SIZE.secondary};color:rgba(236,236,241,0.55)">${esc(d.job!.stage_label ?? "reading it for meaning")}</span>
          <span id="scoring-pct" data-content style="flex:none;font-size:${SIZE.meta};font-family:${FONT.mono};color:${C.ink45};font-variant-numeric:tabular-nums">${shownPct(d.job!.pct)}</span>
          <span id="scoring-clock" data-content style="flex:none;font-size:${SIZE.meta};font-family:${FONT.mono};color:${C.ink32};font-variant-numeric:tabular-nums">0:00</span>
          <button class="pass-stop" data-project="${esc(d.projectId)}" style="flex:none;font-size:${SIZE.meta};color:${C.ink45};background:none;border:0;padding:4px 8px;border-radius:${RADIUS.button};cursor:pointer">Stop</button>
        </div>
        <div style="margin-top:10px;height:3px;border-radius:99px;background:rgba(255,255,255,0.06);overflow:hidden">
          <div id="scoring-bar" style="height:100%;width:${d.job!.pct}%;background:${ACCENT.gold};border-radius:99px;transition:width .4s ease"></div>
        </div>
      </div>`
    : "";

  const failed = d.job?.state === "failed"
    ? `<div style="margin-top:18px;padding:14px 16px;border-radius:${RADIUS.card};background:${C.surface};box-shadow:inset 0 0 0 1px rgba(224,106,106,0.24);display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span data-content style="flex:1 1 220px;font-size:${SIZE.body};color:${ACCENT.red}">${esc(d.job!.error ?? "That didn't finish.")}</span>
      </div>`
    : "";

  if (!d.blocks.length) {
    return `${head}${strip}${failed}
    <div style="margin-top:18px;padding:20px 18px;border-radius:${RADIUS.card};background:${C.surface};font-size:${SIZE.body};color:${C.ink45}">This hasn't been transcribed yet — give it a minute.</div>`;
  }

  /*
   * The player, ours rather than the browser's.
   *
   * `controls` put Chrome's grey scrubber, its own timecode in its own font
   * and its ⋮ menu in the middle of a designed dark page — the most visually
   * wrong thing on the screen. It also could not do the one thing an editor
   * needs of a player: change speed, which is how anybody gets through an
   * hour of footage.
   *
   * Both icon states are rendered and toggled with `hidden`, the same way the
   * recorder does it, so the markup is one thing to read and the client only
   * decides which is showing. `video.currentTime` stays the single source of
   * position, so the follow-along highlight and every block's play button go
   * on working untouched.
   */
  const ctl = `flex:none;display:grid;place-items:center;width:26px;height:26px;border-radius:${RADIUS.button};background:transparent;border:none;color:${C.ink70};cursor:pointer;font-family:${FONT.ui};font-size:${SIZE.meta};font-weight:600`;
  const clockStyle = `flex:none;font-size:${SIZE.meta};font-family:${FONT.mono};color:${C.ink45};font-variant-numeric:tabular-nums`;

  /*
   * THE PLAYER EXISTS EVEN WHEN THE EDIT HAS NO VIDEO OF ITS OWN.
   *
   * A cut assembled from the library has no project source, and this used to
   * render nothing at all in that case — so #cut-video did not exist, and
   * every block's play button, "Watch the cut" and the follow-along highlight
   * had nothing to play into. Each block carries its own file and playFrom
   * swaps the element's src to it, so the element is what has to be there; the
   * src is not.
   *
   * It starts empty and fills the moment you press a block, which is the only
   * honest first frame for a cut with no single video behind it.
   */
  const player = `<video id="cut-video" playsinline preload="metadata"${d.posterKey ? ` poster="/media/${esc(d.posterKey)}"` : ""}${d.sourceKey ? ` src="/media/${esc(d.sourceKey)}"` : ""} style="--cut-aspect:${d.aspect ?? "16/9"};background:#000;border-radius:${RADIUS.card};display:block"></video>
      <!-- Wraps. Seven controls ran "Full" off the edge of the column, so the
           bar takes a second line rather than losing its last button. -->
      <div class="player" style="margin-top:8px;display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:6px 8px;border-radius:${RADIUS.card};background:${C.surface}">
        <button class="pl-play" aria-label="Play" style="${ctl}">
          <span class="pl-i-play" style="display:grid">${iconPlay(12, C.ink)}</span>
          <span class="pl-i-pause" hidden>${iconPause(12, C.ink)}</span>
        </button>
        <button class="pl-cut" data-project="${esc(d.projectId)}" aria-pressed="false" title="Play only what you kept" style="flex:none;font-size:${SIZE.meta};font-weight:600;padding:4px 9px;border-radius:${RADIUS.button};background:${C.pill};color:${C.ink70};border:none;cursor:pointer;font-family:${FONT.ui};white-space:nowrap">Watch the cut</button>
        <span class="pl-now" data-content style="${clockStyle}">0:00</span>
        <div class="pl-track" role="slider" tabindex="0" aria-label="Position" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"
          style="position:relative;flex:1 1 60px;min-width:min(50px,100%);height:16px;cursor:pointer;touch-action:none">
          <div style="position:absolute;left:0;right:0;top:7px;height:2px;background:rgba(255,255,255,0.10)"></div>
          <div class="pl-buffer" style="position:absolute;left:0;top:7px;width:0;height:2px;background:rgba(255,255,255,0.18)"></div>
          <div class="pl-played" style="position:absolute;left:0;top:7px;width:0;height:2px;background:${C.ink}"></div>
          <div class="pl-knob" style="position:absolute;left:0;top:4px;width:8px;height:8px;margin-left:-4px;border-radius:50%;background:${C.ink}"></div>
        </div>
        <span class="pl-dur" data-content style="${clockStyle}">${hms(0)}</span>
        <button class="pl-rate" aria-label="Speed" style="${ctl};width:auto;padding:0 6px"><span data-content>1×</span></button>
        <button class="pl-full" aria-label="Fullscreen" style="${ctl};width:auto;padding:0 6px">Full</button>
      </div>`;

  /*
   * WHICH FOOTAGE this cut is made from, and a way back to it.
   *
   * An edit never changes its footage — cuts live on the project and a render
   * writes a new file — but the editor gave no sign of that, so the footage
   * was effectively consumed by the first edit made from it.
   */
  /*
   * WHERE THIS IS MADE OF.
   *
   * One video gets its name and a way back to it. A cut assembled from the
   * library has no single video and used to say nothing at all — six lines
   * from six places with no account of where they came from, which is the
   * review gap this product is supposed to be better at than anyone else's.
   * It says how many videos, and points at the library.
   */
  const fromCount = new Set(
    d.blocks.filter((b) => b.origin === "footage" && b.previewKey).map((b) => b.previewKey),
  ).size;
  const sourceLine = d.sourceId
    ? `<a href="/sources/${esc(d.sourceId)}" style="display:block;margin-top:8px;font-size:${SIZE.meta};color:${C.ink45}">From <span data-content>${esc(d.sourceTitle ?? "your footage")}</span> →</a>`
    : fromCount
      ? `<a href="/footage?tab=moments" style="display:block;margin-top:8px;font-size:${SIZE.meta};color:${C.ink45}">From <span data-content>${fromCount} video${fromCount === 1 ? "" : "s"}</span> in your library →</a>`
      : "";

  /*
   * A WINDOW of blocks, not all of them.
   *
   * Measured on a real three-hour podcast: 2,700 blocks and 35,100 word spans
   * came to 13.2 MB of HTML in one response, plus a canvas per block each
   * queued for a video seek. The design's own demo is a 48-minute podcast, so
   * this is the normal case rather than an extreme one.
   *
   * The rest arrive from /api/projects/:id/blocks as you scroll, rendered by
   * this same function on the server — the client never builds a block, so
   * there is no second copy of this markup to drift.
   */
  const view: CutView = d.view ?? "blocks";

  /*
   * THE LETTER AND COLOUR PER LINE — the THIRD use of this mapping.
   *
   * The chips beside the title, the strip under the player and now the Words
   * gutter all say which video a thing came from, and all three have to agree:
   * a page where the chip says B and the gutter says C about the same
   * recording is worse than one that says neither. So all three take the
   * letter from letterFor(index into d.sources) and the colour from
   * CHIP_COLOURS at the same index, and none of them keeps a list of its own.
   *
   * The timestamp is the block's start, which comes from word ids like every
   * other time in this product.
   */
  const order = sourceIndex(d);
  const gutterFor = (b: Block): Gutter | null => {
    if (view !== "script") return null;
    /* A line you record has no source and no timecode — it is you, now. */
    if (b.origin !== "footage") return { text: "you", color: ACCENT.gold };
    /* One video needs no letter: "A" on every line of a single-source cut is
       a column of the same character. The prototype shows the letter because
       its cut draws on three. */
    const { letter: lt, colour } = markOf(d, order, b);
    const letter = lt ? lt + " " : "";
    /*
     * hms, NOT tc, and the difference is visible in a column.
     *
     * tc pads a position — "03:38" — and its comment is right that the
     * prototype pads positions elsewhere. The gutter is not one of those
     * places: design/one-take/footage.js carries every moment's time as
     * "0:00", "1:12", "3:40", "6:40", unpadded, and that is what the Words
     * column shows. Padded, a cut that never reaches ten minutes renders a
     * column of "00:" down the left-hand side.
     */
    return { text: `${letter}${hms(b.start_ms / 1000)}`, color: colour };
  };

  /*
   * WHERE EACH BEAT SITS IN THE CUT.
   *
   * Computed over the WHOLE list, not the window on screen: "beat 2 of 4" is
   * a fact about the cut, and counting only what has been scrolled to would
   * make it change as you scroll. The neighbours are the nearest blocks
   * either side, skipping struck ones — a line you have cut is not what this
   * beat comes after.
   */
  const beatsAll = d.blocks.filter((x) => x.origin === "voice" && !x.struck);
  const beatOf = new Map<string, BeatContext>();
  beatsAll.forEach((b, n) => {
    const at = d.blocks.indexOf(b);
    const near = (step: -1 | 1): Block | null => {
      for (let j = at + step; j >= 0 && j < d.blocks.length; j += step) {
        if (!d.blocks[j].struck) return d.blocks[j];
      }
      return null;
    };
    const before = near(-1);
    const after = near(1);
    const mk = before && before.origin === "footage" ? markOf(d, order, before) : null;
    beatOf.set(b.id, {
      n: n + 1,
      of: beatsAll.length,
      afterText: before?.text ?? "",
      afterAt: before && before.origin === "footage" ? `${mk?.letter ? mk.letter + " " : ""}${hms(before.start_ms / 1000)}` : "",
      afterStart: before?.start_ms ?? 0,
      afterMedia: before?.previewKey ?? "",
      thenText: after?.text ?? "",
      thenAt: (() => {
        if (!after || after.origin !== "footage") return "";
        const m2 = markOf(d, order, after);
        return `${m2.letter ? m2.letter + " " : ""}${hms(after.start_ms / 1000)}`;
      })(),
    });
  });

  const shown = d.blocks.slice(0, d.windowSize);
  const list: string[] = [seam(d.projectId, 0, view)];
  shown.forEach((b, i) => {
    list.push(
      blockRow(
        b,
        d.cuts,
        i,
        d.blocks.length,
        view,
        d.blockRule[b.id] ?? "",
        gutterFor(b),
        Boolean((d.blockContested ?? {})[b.id]),
        beatOf.get(b.id) ?? null,
        (d.blockJudgement ?? {})[b.id] ?? null,
        (d.takes ?? {})[b.id.slice(2)] ?? [],
      ),
    );
    list.push(seam(d.projectId, i + 1, view));
  });
  if (d.blocks.length > shown.length) {
    /* The sentinel says how much is left, so a long transcript admits its
       length instead of just ending. */
    list.push(`<div id="more-blocks" data-from="${shown.length}" data-total="${d.blocks.length}"
      style="padding:14px 0;text-align:center;font-size:${SIZE.meta};color:${C.ink32}"><span data-content>${d.blocks.length - shown.length} more lines</span></div>`);
  }

  return `${head}${strip}${failed}
  <div style="margin-top:16px;display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap">

    <!--
      DIRECTION, on the left: the rules that made this cut, the conversation
      about it, and the box you say the next thing in. First in the markup
      because it is first on the screen and because it is the thing the
      product is about — the document is the result, this is the control.
    -->
    ${assistant(d, "")}

    <!--
      THE THING ITSELF, in the centre. The transcript is the work.
    -->
    <div class="editor-doc">
      ${
        d.view === "shorts"
          ? shortsList(d)
          : d.view === "footage"
          ? footageSurface(d)
          : `${
              /*
               * WHAT THE CUT IS, in one line, before the blocks.
               *
               * "5:59 · 12 blocks · 3 of 3 vlogs · one thread at a time" —
               * the prototype opens the centre column with it and I had a
               * search bar there and nothing else. The numbers are the same
               * ones the bottom bar carries; this says them where you are
               * reading rather than where you scroll to.
               */
              `<div style="display:flex;gap:9px;align-items:baseline;flex-wrap:wrap;margin-bottom:12px">
                <span data-content style="flex:none;font-size:${SIZE.body};font-weight:600">${
                  /* The prototype names the reading, not just the thing: it is
                     "The cut" in Blocks and "The cut, as words" in Words, which
                     is the sentence that tells you what you are looking at. */
                  view === "script" ? "The cut, as words" : "The cut"
                }</span>
                <span data-content style="flex:1 1 auto;min-width:0;font-size:${SIZE.meta};font-family:${FONT.mono};color:${C.ink45}">${esc(d.cutLine)}</span>${cutNotes(d)}
              </div>`
            }${findBar(d.projectId)}
      <div id="blocks" data-project="${esc(d.projectId)}" data-source="${esc(d.sourceId ?? "")}" data-view="${view}" style="${
        view === "script"
          ? /*
             * ONE PANEL, which is what makes it read as a script rather than
             * as a list with the furniture taken off.
             *
             * Words used to be the Blocks rows with the thumbnail and the rule
             * chip removed — same page background, same gaps, same stack. The
             * prototype draws a single #141418 card with a hairline, 24/28 of
             * padding, 15px over a line-height of 2 and text-wrap:pretty, and
             * the lines run together inside it. Taking furniture away is not
             * the same as setting type.
             */
            `display:flex;flex-direction:column;gap:0;padding:24px 28px;border-radius:10px;background:#141418;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.05);text-wrap:pretty`
          : `display:flex;flex-direction:column;gap:1px`
      }">
        ${list.join("")}
      </div>${view === "script" ? wordsLegend() : ""}`
      }
    </div>

    <!--
      THE PLAYER, in its own column on the right. One Take is three columns
      and this is the third; it used to sit at the top of the assistant, which
      made one column do two jobs and left the document what was left over.
    -->
    <!-- The player, the shape of the cut under it, and the keys. One Take
         puts all three here; the build had the player and the line back to
         the footage. -->
    <div class="editor-player">${player}${blockStrip(
      d.blocks.map((b) => ({
        id: b.id,
        ms: Math.max(0, b.end_ms - b.start_ms),
        /* A block with no entry is this project's own source, which is the
           same rule mediaKey and previewKey follow. */
        sourceId: (d.blockSource ?? {})[b.id] ?? d.sourceId,
        struck: b.struck,
        label: `${tc(b.start_ms / 1000)} · ${b.text.slice(0, 60)}`,
      })),
      d.sources ?? [],
    )}${keyHints()}${sourceLine}</div>
  </div>
  <!--
    THE EXPORT BAR WAS HERE, and One Take has no such thing.
    
    It was a sticky strip across the bottom holding the kept count, the
    saved note, what was outstanding and Export. Every one of those is in
    the title row now, where the prototype puts them — and the row is
    sticky, so they are to hand at any scroll position without a second bar
    competing with the composer for the bottom of the screen.
    
    It was also 55px that the editor's left column did not have: the
    conversation pane was being crushed to 125px, which check-editor.cjs
    calls not even one exchange, and the composer had ended up underneath
    this very bar.
  -->`;
}
