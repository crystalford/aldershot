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
import { wordEndMs, wordStartMs, type Cut } from "../../cuts.ts";

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
 * Three are here. SHORTS is not, and that is the honest answer rather than a
 * gap: its tab lists candidates graded Strong / Worth a look / Long shot with
 * a reason for each, and the three-way judge that produces those gradings is
 * Phase 4. A fourth tab holding a list the product cannot grade would be a
 * promise in a tab bar, which is the thing the conventions check exists to
 * stop. It goes in when the judge does.
 *
 * `script` keeps its name in the URL — /p/:id/script is an existing link —
 * and reads as WORDS in the bar, which is what the prototype calls it and
 * what it always meant.
 */
export type CutView = "footage" | "blocks" | "script";

export interface CutData {
  projectId: string;
  /** Which reading. Defaults to blocks everywhere it is not asked for. */
  view?: CutView;
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
  beats: Array<{ kind: string; media_r2_key: string | null; clip_id: string | null; struck?: unknown }>;
  cameFrom: [string, string];
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
  moments: Array<{ id: string; quote: string; source_title: string; in: boolean; note: string }>;
  /** Every instruction given to the model on this cut, and what came of it. */
  passes: Array<{ id: string; n: number; instruction: string; result: string; undoable: boolean; first_change: string | null }>;
  /**
   * The rules that produced this cut, when it was made from rules at all.
   *
   * Empty for every edit that began with a video, because those are still the
   * staged editor's and have no rule set. An assembled cut has one.
   */
  rules: Array<{ id: string; text: string; on: boolean; effect: string; hand: boolean }>;
}

/**
 * One block.
 *
 * The words are individually clickable, which is Descript's gesture and was
 * previously only available on a separate tab. Striking a word removes video —
 * the render is built from the surviving ranges — so it has to be here, on the
 * surface where you are reading, not one navigation away.
 */
function blockRow(b: Block, cuts: Cut[], i: number, total: number, view: CutView = "blocks"): string {
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

  /* The model's opinion, when it has one. Absent is absent — an unjudged block
     shows nothing rather than a zero, which would read as "bad". */
  /* A zero is not a verdict, it is the absence of one. saveClips writes
     score: 0 for anything the model did not rate, and rendering that as a
     green badge told the user their line scored nothing — the comment below
     has always said absent should look absent, and 0 slipped through it. */
  const judged =
    b.score != null && b.score > 0
      ? `<span data-content style="flex:none;font-size:${SIZE.pill};font-weight:600;font-family:${FONT.mono};padding:2px 6px;border-radius:4px;background:${accentBg(ACCENT.green)};color:${ACCENT.green}">${b.score}</span>`
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
  const fill = !struck && (b.origin === "voice" || overBRoll) ? take + recorder : "";

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
  const meta = why
    ? `<div class="blk-why" data-content style="font-size:${SIZE.secondary};color:${C.ink45};margin-top:4px;line-height:1.5;cursor:pointer;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden" title="Show the whole reason">${dur ? `${esc(dur)} · ` : ""}${esc(why)}</div>`
    : dur
      ? `<div data-content style="font-size:${SIZE.secondary};color:${C.ink45};margin-top:4px;line-height:1.5">${esc(dur)}</div>`
      : "";

  /* Reading, not managing: no card, no frame, no rule between lines. The
     score's green ring goes too — it is a property of the line you are
     reading, and a page of ringed paragraphs is a form again. */
  const shell = script
    ? `display:flex;gap:10px;align-items:flex-start;padding:3px 0;background:none;box-shadow:none;${struck ? "opacity:.5;" : ""}`
    : `display:flex;gap:14px;align-items:flex-start;padding:16px 18px;border-radius:9px;background:${C.surface};box-shadow:${
        b.score != null ? `inset 0 0 0 1px ${accentBg(ACCENT.green)}` : "none"
      };${struck ? "opacity:.5;" : ""}`;

  return `<div class="blk" data-block="${esc(b.id)}" data-struck="${struck ? 1 : 0}" data-ms="${b.end_ms - b.start_ms}"
      style="${shell}">
    ${script ? "" : thumb}
    <div style="flex:1;min-width:0">
      <div style="font-size:${SIZE.quote};line-height:1.5;color:rgba(236,236,241,0.92)">${originTag}${body}</div>
      ${meta}
      ${fill}
    </div>
    <div class="blk-actions" style="flex:none;display:flex;align-items:center;gap:4px">
      ${judged}
      ${arrow(-1, i === 0)}${arrow(1, i === total - 1)}
      ${short}
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
/**
 * What you have asked the model, and what it said back.
 *
 * The `passes` table has carried this since the first pass ever ran — its own
 * comment reads "every LLM instruction the user gave, and what it did. Shown
 * as the Passes log" — and nothing in the codebase read it. So an instruction
 * that matched nothing was indistinguishable from one that worked: the page
 * reloaded, a bar filled, it finished, and that was all you ever learned.
 *
 * runScore already writes the honest sentence, "no matches — try different
 * words", so the only thing this had to do was show it. Green when the pass
 * found something, gold when it did not — the same two colours the rest of
 * the editor uses for "done" and "still wants you".
 */
function passLogPanel(passes: CutData["passes"]): string {
  if (!passes.length) return "";

  const rows = passes
    .map((p) => {
      /* The result sentence says which it was. Nothing here re-judges the
         pass; it colours what the job already recorded. */
      const empty = /^no matches/.test(p.result);
      return `<div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap">
        <span data-content style="flex:none;width:14px;font-size:${SIZE.meta};font-family:${FONT.mono};color:${C.ink32}">${p.n}</span>
        <span data-content style="flex:1 1 160px;min-width:min(150px,100%);font-size:${SIZE.secondary};color:rgba(236,236,241,0.8);line-height:1.5">${esc(p.instruction)}</span>
        <span data-content style="flex:none;font-size:${SIZE.meta};color:${empty ? ACCENT.gold : ACCENT.green}">${esc(p.result)}</span>
      </div>`;
    })
    .join("");

  return `<div style="margin-top:14px;padding-top:13px;border-top:1px solid rgba(255,255,255,0.05)">
    <div style="font-size:${SIZE.secondary};font-weight:600;color:${C.ink45}">What you've asked for so far</div>
    <div style="margin-top:9px;display:flex;flex-direction:column;gap:6px">${rows}</div>
  </div>`;
}

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
function rulesPanel(rules: CutData["rules"]): string {
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

  const rows = (list: CutData["rules"]) => list
    .map(
      (r) => `<button class="rule-toggle" data-rule="${esc(r.id)}" data-on="${r.on ? 1 : 0}"
        style="display:flex;gap:9px;align-items:baseline;flex-wrap:wrap;width:100%;text-align:left;
        background:none;border:none;padding:3px 0;cursor:pointer;font-family:inherit;color:inherit">
        <span data-content style="flex:none;font-size:${SIZE.meta};font-family:${FONT.mono};color:${C.ink32}">${number(r)}</span>
        <span data-content style="flex:1 1 150px;min-width:min(140px,100%);font-size:${SIZE.secondary};color:rgba(236,236,241,${r.on ? "0.8" : "0.38"});line-height:1.5;${r.on ? "" : "text-decoration:line-through;text-decoration-color:rgba(236,236,241,0.3)"}">${esc(r.text)}</span>
        <span data-content style="flex:none;font-size:${SIZE.meta};color:${r.on ? ACCENT.gold : C.ink32}">${esc(r.effect)}</span>
      </button>`,
    )
    .join("");

  return `<div style="padding-bottom:13px;border-bottom:1px solid rgba(255,255,255,0.05)">
    <div style="font-size:${SIZE.secondary};font-weight:600;color:${C.ink45}">THE RULES</div>
    <div style="margin-top:9px;display:flex;flex-direction:column;gap:6px">${rows(main)}</div>
    ${
      byHand.length
        ? `<div style="margin-top:12px;font-size:${SIZE.secondary};font-weight:600;color:${C.ink45}">by hand</div>
           <div style="margin-top:9px;display:flex;flex-direction:column;gap:6px">${rows(byHand)}</div>`
        : ""
    }
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

  return `<div class="asst" data-project="${esc(d.projectId)}">
    <!-- THE RULES, at the top of direction. They are the standing answer to
         "why these moments"; the conversation below is the history of asking,
         and the composer under that is where the next one goes. The player
         used to sit here and is now its own column. -->
    <div class="asst-top">${player}${rulesPanel(d.rules)}</div>

    <div class="asst-talk" style="flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:16px;padding:14px 2px">
      ${talk}
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
          <span class="asst-hint" style="flex:1;min-width:0;font-size:${SIZE.meta};color:${C.ink32}">It reads the whole transcript.</span>
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
function momentsThroughRules(d: CutData): string {
  if (!d.moments.length) {
    return `<div data-content style="margin-top:20px;font-size:${SIZE.secondary};color:${C.ink45}">Nothing in your library yet.</div>`;
  }
  return `<div style="margin-top:14px;display:flex;flex-direction:column;gap:6px">${d.moments
    .map(
      (m) => `<div data-moment="${esc(m.id)}" style="display:flex;gap:12px;align-items:baseline;padding:10px 12px;border-radius:${RADIUS.card};background:${C.surface};opacity:${m.in ? "1" : ".62"}">
        <span data-content style="flex:1 1 200px;min-width:min(180px,100%);font-size:${SIZE.secondary};line-height:1.5;color:${C.ink70}">${esc(m.quote.slice(0, 120))}</span>
        <span data-content style="flex:none;font-size:${SIZE.meta};font-family:${FONT.mono};color:${m.in ? ACCENT.green : C.ink45}">${esc(m.note)}</span>
      </div>`,
    )
    .join("")}</div>`;
}

export function renderCut(d: CutData): string {
  const [backLabel, backHref] = d.cameFrom;

  const head = `<div style="display:flex;align-items:center;gap:10px">
    <a href="${esc(backHref)}" style="font-size:${SIZE.secondary};color:rgba(236,236,241,0.4);white-space:nowrap">← ${esc(backLabel)}</a>
    <span style="margin-left:auto">${itemMenu("projects", d.projectId, d.title, "cut")}</span>
  </div>
  <!-- The runtime and the kept count were here AND in the bottom bar: the
       same two numbers twice on one screen. The bar is the one that stays
       with you as you scroll, so it is the one that keeps them. The ids
       remain because the client retotals by id and a second display that
       could disagree is worse than none. -->
  <div style="margin-top:14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
    <div data-content style="font-size:${SIZE.pageTitle};font-weight:600;letter-spacing:-0.022em">${esc(d.title)}</div>
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
    </div>
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
    <div data-content style="margin-top:18px;padding:20px 18px;border-radius:${RADIUS.card};background:${C.surface};font-size:${SIZE.body};color:${C.ink45}">This hasn't been transcribed yet — give it a minute.</div>`;
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
  const shown = d.blocks.slice(0, d.windowSize);
  const list: string[] = [seam(d.projectId, 0, view)];
  shown.forEach((b, i) => {
    list.push(blockRow(b, d.cuts, i, d.blocks.length, view));
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
        d.view === "footage"
          ? momentsThroughRules(d)
          : `${findBar(d.projectId)}
      <div id="blocks" data-project="${esc(d.projectId)}" data-source="${esc(d.sourceId ?? "")}" data-view="${view}" style="display:flex;flex-direction:column;gap:${view === "script" ? "0" : "1px"}">
        ${list.join("")}
      </div>`
      }
    </div>

    <!--
      THE PLAYER, in its own column on the right. One Take is three columns
      and this is the third; it used to sit at the top of the assistant, which
      made one column do two jobs and left the document what was left over.
    -->
    <div class="editor-player">${player}${sourceLine}</div>
  </div>
  <div style="position:sticky;bottom:0;margin-top:18px;display:flex;align-items:center;gap:14px;padding:12px 16px;border-radius:${RADIUS.card};background:rgba(16,16,19,0.92);backdrop-filter:blur(14px);box-shadow:inset 0 0 0 1px rgba(255,255,255,0.06);flex-wrap:wrap">
    <span id="cut-runtime" data-content style="font-size:${SIZE.secondary};color:${C.ink70};font-family:${FONT.mono}">${d.keptCount} kept · ${hms(d.runtimeMs / 1000)}</span>
    <!-- Every gesture writes immediately and the page never said so, on a
         product where each click alters a video. Quiet until there is
         something true to report. -->
    <span id="saved-state" data-content hidden style="font-size:${SIZE.meta};color:${C.ink32};white-space:nowrap"></span>
    ${
      /* Only when something IS outstanding. "every beat is filled." on a cut
         with nothing in it is noise, and on a finished one it is a pat on the
         back nobody asked for. */
      d.beats.length && buildSummary(d.beats) !== "every beat is filled."
        ? `<span data-content style="font-size:${SIZE.secondary};color:${ACCENT.gold};white-space:nowrap">${esc(buildSummary(d.beats))}</span>`
        : ""
    }
    <button class="export-open" data-project="${esc(d.projectId)}" style="margin-left:auto;flex:none;font-size:${SIZE.secondary};font-weight:600;padding:8px 18px;border-radius:${RADIUS.button};background:${C.ink};color:#131316;border:none;cursor:pointer;font-family:${FONT.ui};white-space:nowrap">Export as</button>
  </div>`;
}
