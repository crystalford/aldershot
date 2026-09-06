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
import { iconArrowDown, iconArrowUp, iconPlay, iconPlus } from "../icons.ts";
import { hms, tc } from "./footage.ts";
import { itemMenu } from "../item-menu.ts";
import { wordStruck, type Block } from "../../blocks.ts";
import type { Cut } from "../../cuts.ts";

export interface CutData {
  projectId: string;
  title: string;
  sourceId: string | null;
  sourceKey: string | null;
  posterKey: string | null;
  blocks: Block[];
  cuts: Cut[];
  runtimeMs: number;
  keptCount: number;
  plan: string;
  /** The inserted blocks, for the "what still needs you" line in the footer. */
  beats: Array<{ kind: string; media_r2_key: string | null; clip_id: string | null; struck?: unknown }>;
  cameFrom: [string, string];
  /** Live pass, when the model is still reading. */
  job: { state: string; pct: number; stage_label: string | null; error: string | null } | null;
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
            return `<span class="w" data-content data-block="${esc(b.id)}" data-word="${wi}" style="cursor:pointer;${
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
  const judged =
    b.score != null
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
  const thumb = `<button class="blk-play" data-start="${b.start_ms}" data-media="${esc(b.mediaKey ?? "")}"
      aria-label="Play from ${tc(b.start_ms / 1000)}"
      style="flex:none;width:78px;aspect-ratio:16/9;border-radius:5px;position:relative;overflow:hidden;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.06);background:#0B0B0E;cursor:pointer;padding:0;border:none">
    ${
      b.origin === "footage"
        ? `<canvas class="blk-frame" width="156" height="88" style="position:absolute;inset:0;width:100%;height:100%;display:block"></canvas>`
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
   * Record it, or have it spoken.
   *
   * Both existed already and neither could be reached: the recorder was bound
   * to #build, a surface that no longer exists, so recording a voiceover has
   * been impossible since the editor was rebuilt. A block that says it wants
   * your voice has to offer a way to give it.
   */
  const fill =
    b.origin === "voice" && !struck
      ? `<div style="display:flex;gap:6px;align-items:center;margin-top:10px;flex-wrap:wrap">
          <button class="blk-record" data-beat="${esc(b.id.slice(2))}"
            style="font-size:${SIZE.meta};font-weight:600;padding:5px 12px;border-radius:${RADIUS.button};background:${
              b.mediaKey ? C.pill : ACCENT.gold
            };color:${b.mediaKey ? C.ink70 : "#131316"};border:none;cursor:pointer;font-family:${FONT.ui};white-space:nowrap">${
              b.mediaKey ? "Another take" : "Record it"
            }</button>
          <button class="blk-tts" data-beat="${esc(b.id.slice(2))}"
            style="font-size:${SIZE.meta};font-weight:500;padding:5px 12px;border-radius:${RADIUS.button};background:${C.pill};color:${C.ink70};border:none;cursor:pointer;font-family:${FONT.ui};white-space:nowrap">Generate it</button>
        </div>`
      : "";

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
function seam(projectId: string, at: number): string {
  return `<div style="display:flex;justify-content:center;padding:1px 0">
    <button class="blk-insert" data-project="${esc(projectId)}" data-at="${at}" aria-label="Add something here"
      style="width:22px;height:22px;border-radius:50%;background:transparent;border:none;color:${C.ink32};cursor:pointer;display:grid;place-items:center">${iconPlus({ size: 12 })}</button>
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

  if (d.job && (d.job.state === "queued" || d.job.state === "running")) {
    return `${head}
    <div id="scoring" data-project="${esc(d.projectId)}" style="margin-top:24px;display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:${RADIUS.card};background:#141418;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.04)">
      <span style="width:6px;height:6px;border-radius:50%;background:${ACCENT.gold};animation:blip 1.6s ease-in-out infinite;flex:none"></span>
      <span data-content style="flex:1;font-size:${SIZE.secondary};color:rgba(236,236,241,0.55)">${esc(d.job.stage_label ?? "reading it for meaning")}</span>
    </div>`;
  }

  if (d.job?.state === "failed") {
    return `${head}
    <div style="margin-top:24px;padding:16px 18px;border-radius:${RADIUS.card};background:${C.surface};box-shadow:inset 0 0 0 1px rgba(224,106,106,0.24)">
      <div data-content style="font-size:${SIZE.body};color:${ACCENT.red}">${esc(d.job.error ?? "That didn't finish.")}</div>
    </div>`;
  }

  if (!d.blocks.length) {
    return `${head}
    <div data-content style="margin-top:24px;padding:20px 18px;border-radius:${RADIUS.card};background:${C.surface};font-size:${SIZE.body};color:${C.ink45}">This hasn't been read yet — give it a minute.</div>`;
  }

  const player = d.sourceKey
    ? `<video id="cut-video" playsinline preload="metadata"${d.posterKey ? ` poster="/media/${esc(d.posterKey)}"` : ""} src="/media/${esc(d.sourceKey)}" controls style="width:100%;aspect-ratio:16/9;background:#000;border-radius:${RADIUS.card};display:block"></video>`
    : "";

  const list: string[] = [seam(d.projectId, 0)];
  d.blocks.forEach((b, i) => {
    list.push(blockRow(b, d.cuts, i, d.blocks.length));
    list.push(seam(d.projectId, i + 1));
  });

  return `${head}
  <div style="margin-top:20px;display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap">
    <div class="editor-aside">
      ${player}
      <div data-content style="font-size:${SIZE.meta};color:rgba(236,236,241,0.3);margin-top:8px;line-height:1.55">Strike a line or a word to cut it. Move a block to change the order. The + adds your voice between them.</div>
      <button class="find-good" data-project="${esc(d.projectId)}" style="margin-top:12px;width:100%;font-size:${SIZE.secondary};font-weight:500;padding:8px 14px;border-radius:${RADIUS.button};background:${C.pill};color:${C.ink};border:none;cursor:pointer;font-family:${FONT.ui}">Find the strong bits</button>
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
