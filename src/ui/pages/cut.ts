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

export interface CutData {
  projectId: string;
  title: string;
  sourceId: string | null;
  /** What the footage is called, for the line that links back to it. */
  sourceTitle: string | null;
  sourceKey: string | null;
  posterKey: string | null;
  /** The video's own shape, so the player is not a hardcoded 16/9 box. */
  aspect?: string;
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
  /** Every instruction given to the model on this cut, and what came of it. */
  passes: Array<{ id: string; n: number; instruction: string; result: string }>;
}

/**
 * One block.
 *
 * The words are individually clickable, which is Descript's gesture and was
 * previously only available on a separate tab. Striking a word removes video —
 * the render is built from the surviving ranges — so it has to be here, on the
 * surface where you are reading, not one navigation away.
 */
function blockRow(b: Block, cuts: Cut[], i: number, total: number): string {
  const struck = b.struck;

  /* A footage block shows its words so each can be struck. A recording has no
     transcript of its own, so it shows what it is instead. */
  const body =
    b.origin === "footage" && b.words.length
      ? b.words
          .map((w, wi) => {
            const gone = struck || wordStruck(cuts, b, wi);
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

  const meta = [
    b.end_ms > b.start_ms ? hms((b.end_ms - b.start_ms) / 1000) : "",
    b.why ?? "",
  ]
    .filter(Boolean)
    .join(" · ");

  return `<div class="blk" data-block="${esc(b.id)}" data-struck="${struck ? 1 : 0}" data-ms="${b.end_ms - b.start_ms}"
      style="display:flex;gap:14px;align-items:flex-start;padding:16px 18px;border-radius:9px;background:${C.surface};box-shadow:${
        b.score != null ? `inset 0 0 0 1px ${accentBg(ACCENT.green)}` : "none"
      };${struck ? "opacity:.5;" : ""}">
    ${thumb}
    <div style="flex:1;min-width:0">
      <div style="font-size:${SIZE.quote};line-height:1.5;color:rgba(236,236,241,0.92)">${originTag}${body}</div>
      ${
        meta
          ? `<div data-content style="font-size:${SIZE.secondary};color:${C.ink45};margin-top:4px;line-height:1.5">${esc(meta)}</div>`
          : ""
      }
      ${fill}
    </div>
    <div style="flex:none;display:flex;align-items:center;gap:4px">
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
function seam(projectId: string, at: number): string {
  const opt = (kind: string, label: string) =>
    `<button class="blk-insert" data-project="${esc(projectId)}" data-at="${at}" data-kind="${kind}"
      style="font-size:${SIZE.meta};font-weight:500;padding:5px 12px;border-radius:${RADIUS.button};background:${C.pill};color:${C.ink70};border:none;cursor:pointer;font-family:${FONT.ui};white-space:nowrap">${label}</button>`;

  return `<div class="seam" style="display:flex;justify-content:center;padding:1px 0">
    <button class="seam-open" aria-label="Add something here"
      style="width:22px;height:22px;border-radius:50%;background:transparent;border:none;color:${C.ink32};cursor:pointer;display:grid;place-items:center">${iconPlus({ size: 12 })}</button>
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
 * ONE PLACE TO SAY WHAT YOU WANT.
 *
 * There were two text boxes and twelve buttons, stacked down a 300px column
 * under a video that took two thirds of its height — so the two most powerful
 * things in the product were below the fold, behind a scrollbar, at the
 * narrowest width on the page. The owner: "scrollbars to see all the options
 * and shit... even without the scroll it wasn't the most elegant solution to
 * begin with".
 *
 * The insight that collapses it: FIND AND ASK ARE THE SAME GESTURE AT
 * DIFFERENT PRECISION. Type "sponsor" and you mean the twelve places it is
 * said; type "cut the sponsor read" and you mean the model should decide.
 * Both are you telling the editor what to act on, so both belong in one box —
 * and for a product whose whole claim is that editing is text, the primary
 * control being a single text field is the argument, not a convenience.
 *
 * What you type decides what is offered. Matches are literal and free and
 * appear as you type; the model is one row below them; the clean-ups are
 * pre-written instructions that carry a real count. The pass log lands inside
 * the thing that produced it rather than at the bottom of a scroll.
 *
 * Every class name here is the one the old panels used, deliberately: the
 * handlers, their POST shapes and their counting were all correct and none of
 * them are rewritten. This is where the controls live, not what they do.
 */
function commandBar(d: CutData): string {
  const label = (t: string) =>
    `<div style="font-size:${SIZE.meta};font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:${C.ink32};margin-bottom:8px">${t}</div>`;

  const row = (cls: string, text: string, note: string, opts: { gold?: boolean; live?: boolean } = {}) => {
    const live = opts.live !== false;
    return `<button class="${cls}"${live ? "" : " disabled"} style="display:flex;width:100%;align-items:baseline;gap:10px;text-align:left;font-size:${SIZE.secondary};font-weight:500;padding:8px 10px;border-radius:${RADIUS.button};background:transparent;color:${
      opts.gold ? ACCENT.gold : "rgba(236,236,241,0.8)"
    };border:none;cursor:${live ? "pointer" : "default"};font-family:${FONT.ui};${live ? "" : "opacity:.4;"}">
      <span style="flex:1;min-width:0">${text}</span>
      ${note ? `<span data-content style="flex:none;font-size:${SIZE.meta};font-family:${FONT.mono};color:${C.ink32};font-variant-numeric:tabular-nums">${esc(note)}</span>` : ""}
    </button>`;
  };

  /* "47 · −0:31". Nothing here is shown unless it was counted — the same rule
     the chips followed, kept verbatim. A clean-up with nothing to clean has
     nothing to do, so it is quiet rather than lying about a number. */
  const note = (n: { found: number; savedMs: number }) =>
    n.found ? `${n.found} · −${hms(n.savedMs / 1000)}` : "";

  const group = (name: string, body: string, hidden = false) =>
    `<div class="cmd-group" data-group="${name}"${hidden ? " hidden" : ""} style="padding:12px 8px;border-top:1px solid rgba(255,255,255,0.05)">${body}</div>`;

  /*
   * Instructions that mean something on ANY video.
   *
   * These were the prototype's, and the prototype's demo is a podcast with a
   * sponsor read in it. On a person talking to a camera — which is what this
   * account actually holds — those are instructions about things that are not
   * there. Each of these is real against a real transcript, and they FILL the
   * field rather than firing, so one can be edited into what you meant.
   *
   * Three at a time now instead of nine at once: as a flat wall of chips they
   * read as equals to the clean-ups, which act and carry counts, and nine of
   * anything is a list you skip rather than read.
   */
  const egs = [
    "Keep only the strongest points",
    "Where I actually make the point",
    "The funniest moments",
    "Cut the bits where I repeat myself",
    "Cut the false starts",
    "Cut anything I said better later",
    "Keep only the ones under 20 seconds",
    "Just the story, none of the setup",
    "Every question I ask",
  ];
  const eg = (t: string, i: number) =>
    `<button class="pass-eg"${i > 2 ? " data-more=\"1\" hidden" : ""} style="display:block;width:100%;text-align:left;font-size:${SIZE.secondary};padding:7px 10px;border-radius:${RADIUS.button};background:transparent;color:rgba(236,236,241,0.55);border:none;cursor:pointer;font-family:${FONT.ui}">${t}</button>`;

  const passes = d.passes.length
    ? group(
        "log",
        label("You've asked") +
          d.passes
            .map((p) => {
              /* The result sentence says which it was. Nothing here re-judges
                 a pass; it colours what the job already recorded. */
              const empty = /^no matches/.test(p.result);
              return `<div style="display:flex;gap:10px;align-items:baseline;padding:5px 10px">
                <span data-content style="flex:none;width:14px;font-size:${SIZE.meta};font-family:${FONT.mono};color:${C.ink32}">${p.n}</span>
                <span data-content style="flex:1;min-width:0;font-size:${SIZE.secondary};color:rgba(236,236,241,0.7)">${esc(p.instruction)}</span>
                <span data-content style="flex:none;font-size:${SIZE.meta};color:${empty ? ACCENT.gold : ACCENT.green}">${esc(p.result)}</span>
              </div>`;
            })
            .join(""),
      )
    : "";

  return `<div class="cmd" data-project="${esc(d.projectId)}" style="margin-top:18px;position:relative">
    <form class="pass-form" style="display:flex;gap:10px;align-items:center;background:${C.surface};border-radius:9px;padding:4px 10px 4px 13px">
      <span style="flex:none;display:grid;place-items:center;color:${C.ink32}">${iconSearch({ size: 14 })}</span>
      <input class="find-q" name="instruction" autocomplete="off" placeholder="Tell it what to cut, or find a word"
        style="flex:1;min-width:0;background:transparent;border:none;outline:none;color:${C.ink};font-size:${SIZE.body};padding:10px 0;font-family:${FONT.ui}"/>
      <span class="find-count" data-content style="flex:none;font-size:${SIZE.meta};font-family:${FONT.mono};color:${C.ink32};font-variant-numeric:tabular-nums"></span>
      <span data-content style="flex:none;font-size:${SIZE.meta};font-family:${FONT.mono};color:${C.ink32};padding:3px 6px;border-radius:4px;background:${C.pill}">⌘K</span>
    </form>

    <div class="cmd-panel" hidden style="position:absolute;left:0;right:0;top:calc(100% + 6px);z-index:40;border-radius:9px;background:#141418;box-shadow:0 18px 40px rgba(0,0,0,0.5),inset 0 0 0 1px rgba(255,255,255,0.07);max-height:min(60vh,520px);overflow-y:auto;overscroll-behavior:contain">

      ${group(
        "matches",
        label("In this cut") +
          `<button class="find-cut" hidden style="display:flex;width:100%;align-items:baseline;gap:10px;text-align:left;font-size:${SIZE.secondary};font-weight:600;padding:8px 10px;border-radius:${RADIUS.button};background:${C.pill};color:rgba(236,236,241,0.85);border:none;cursor:pointer;font-family:${FONT.ui}"></button>
           <div class="find-hits" style="margin-top:6px;display:flex;flex-direction:column;gap:1px"></div>`,
        true,
      )}

      ${group(
        "ask",
        label("Ask the model") +
          `<button class="cmd-ask" hidden style="display:flex;width:100%;align-items:baseline;gap:10px;text-align:left;font-size:${SIZE.secondary};font-weight:600;padding:8px 10px;border-radius:${RADIUS.button};background:${C.pill};color:rgba(236,236,241,0.85);border:none;cursor:pointer;font-family:${FONT.ui}"></button>
           <div class="cmd-egs" style="margin-top:2px">${egs.map(eg).join("")}
             <button class="cmd-more" style="display:block;font-size:${SIZE.meta};padding:6px 10px;background:none;border:none;color:${C.ink32};cursor:pointer;font-family:${FONT.ui}">More like these</button>
           </div>`,
      )}

      ${group(
        "clean",
        label("Clean up") +
          row("find-good", "Find the strong bits", "", { gold: true }) +
          row("clean-fillers", "Remove “um” and “uh”", note(d.cleanups.fillers), { live: d.cleanups.fillers.found > 0 }) +
          row("clean-pauses", "Tighten silences", note(d.cleanups.pauses), { live: d.cleanups.pauses.found > 0 }),
      )}

      ${passes}
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
): string {
  const out: string[] = [];
  for (let i = from; i < Math.min(to, blocks.length); i++) {
    out.push(blockRow(blocks[i], cuts, i, blocks.length));
    out.push(seam(projectId, i + 1));
  }
  return out.join("");
}

export function renderCut(d: CutData): string {
  const [backLabel, backHref] = d.cameFrom;

  const head = `<div style="display:flex;align-items:center;gap:10px">
    <a href="${esc(backHref)}" style="font-size:${SIZE.secondary};color:rgba(236,236,241,0.4);white-space:nowrap">← ${esc(backLabel)}</a>
    <span style="margin-left:auto">${itemMenu("projects", d.projectId, d.title, "cut")}</span>
  </div>
  <div style="margin-top:14px;display:flex;align-items:baseline;gap:12px;flex-wrap:wrap">
    <div data-content style="font-size:${SIZE.pageTitle};font-weight:600;letter-spacing:-0.022em">${esc(d.title)}</div>
    <span id="head-runtime" style="margin-left:auto;font-size:${SIZE.body};font-weight:600;font-family:${FONT.mono};white-space:nowrap">${hms(d.runtimeMs / 1000)}</span>
    <span id="head-kept" style="font-size:${SIZE.secondary};color:${C.ink45};font-family:${FONT.mono};white-space:nowrap">${d.keptCount} kept</span>
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

  const player = d.sourceKey
    ? `<video id="cut-video" playsinline preload="metadata"${d.posterKey ? ` poster="/media/${esc(d.posterKey)}"` : ""} src="/media/${esc(d.sourceKey)}" style="width:100%;aspect-ratio:${d.aspect ?? "16/9"};max-height:62vh;object-fit:contain;background:#000;border-radius:${RADIUS.card};display:block"></video>
      <div class="player" style="margin-top:8px;display:flex;align-items:center;gap:9px;padding:6px 8px;border-radius:${RADIUS.card};background:${C.surface}">
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
      </div>`
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
  const shown = d.blocks.slice(0, d.windowSize);
  const list: string[] = [seam(d.projectId, 0)];
  shown.forEach((b, i) => {
    list.push(blockRow(b, d.cuts, i, d.blocks.length));
    list.push(seam(d.projectId, i + 1));
  });
  if (d.blocks.length > shown.length) {
    /* The sentinel says how much is left, so a long transcript admits its
       length instead of just ending. */
    list.push(`<div id="more-blocks" data-from="${shown.length}" data-total="${d.blocks.length}"
      style="padding:14px 0;text-align:center;font-size:${SIZE.meta};color:${C.ink32}"><span data-content>${d.blocks.length - shown.length} more lines</span></div>`);
  }

  return `${head}${strip}${failed}
  ${commandBar(d)}
  <div style="margin-top:16px;display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap">
    <div class="editor-aside">
      ${player}
      ${
        /*
         * WHICH FOOTAGE this cut is made from, and a way back to it.
         *
         * An edit never changes its footage — cuts live on the project and a
         * render writes a new file — but the editor gave no sign of that, and
         * /sources/:id used to redirect straight back here, so the footage was
         * genuinely unreachable. Naming it and linking to it is the difference
         * between "this edit consumed my video" and "this edit is one of
         * several I can make from it".
         */
        d.sourceId
          ? `<a href="/sources/${esc(d.sourceId)}" style="display:block;margin-top:8px;font-size:${SIZE.meta};color:${C.ink45}">From <span data-content>${esc(d.sourceTitle ?? "your footage")}</span> →</a>`
          : ""
      }
      ${
        /*
         * ONBOARDING, NOT FURNITURE.
         *
         * Three lines of instructions sat in the narrowest column of the page
         * for ever, long after anybody knew what a strike does. It is worth
         * saying once — so it is here until the first cut on this project,
         * and gone after that.
         */
        d.cuts.length === 0
          ? `<div data-content style="font-size:${SIZE.meta};color:rgba(236,236,241,0.3);margin-top:8px;line-height:1.55">Strike a line or a word to cut it. Move a block to change the order. The + adds your voice between them.</div>`
          : ""
      }
    </div>
    <div id="blocks" data-project="${esc(d.projectId)}" data-source="${esc(d.sourceId ?? "")}" style="flex:1 1 420px;min-width:min(320px,100%);display:flex;flex-direction:column;gap:1px">
      ${list.join("")}
    </div>
  </div>
  <div style="position:sticky;bottom:0;margin-top:18px;display:flex;align-items:center;gap:14px;padding:12px 16px;border-radius:${RADIUS.card};background:rgba(16,16,19,0.92);backdrop-filter:blur(14px);box-shadow:inset 0 0 0 1px rgba(255,255,255,0.06);flex-wrap:wrap">
    <span id="cut-runtime" data-content style="font-size:${SIZE.secondary};color:${C.ink70};font-family:${FONT.mono}">${d.keptCount} kept · ${hms(d.runtimeMs / 1000)}</span>
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
