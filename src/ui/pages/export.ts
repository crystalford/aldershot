/**
 * Export — the panel that starts a render, and the strip of what came back.
 *
 * This was the tail of a 644-line editor.ts that also held a four-stage editor
 * with a tab bar. That editor was replaced by src/ui/pages/cut.ts and became
 * unreachable, but stayed in the tree and stayed imported, so it still looked
 * live: its tab bar was still the only thing linking to /pick, /build,
 * /script and /shorts. Two bugs this session came from editing a dead copy of
 * a surface instead of the live one, so the dead half is gone rather than
 * left for the next reader to fall into.
 *
 * The options are rendered inline and hidden rather than built in JS, so they
 * come from the same FORMATS / RENDER_ASPECTS / CAPTION_STYLES the server
 * validates against and the two cannot drift apart.
 */

import { C, ACCENT, FONT, RADIUS, SIZE } from "../tokens.ts";
import { CAPTION_STYLES, FORMATS, RENDER_ASPECTS } from "../../render-job.ts";
import { esc } from "../shell.ts";
import { hms } from "./footage.ts";

export function exportPanel(projectId: string, plan: string): string {
  const free = plan === "free";

  const chip = (name: string, id: string, label: string, note: string, on: boolean, locked: boolean) =>
    `<label class="exp-chip">
      <input type="radio" name="${name}" value="${esc(id)}" ${on ? "checked" : ""} ${locked ? "disabled" : ""} style="position:absolute;opacity:0;pointer-events:none"/>
      <span style="font-size:${SIZE.secondary};font-weight:500;color:${C.ink}">${esc(label)}</span>
      <span data-content style="font-size:${SIZE.meta};color:${C.ink45}">${esc(note)}</span>
    </label>`;

  return `<form id="export-panel" data-project="${esc(projectId)}" hidden style="margin-top:10px;padding:14px 16px;border-radius:${RADIUS.card};background:#141418;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.06)">
    <div style="font-size:${SIZE.secondary};color:${C.ink45}">Size</div>
    <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">${FORMATS.map((f) =>
      chip("format", f.id, f.label, f.pro && free ? "Studio" : f.note, f.id === "mp4_1080", Boolean(f.pro && free)),
    ).join("")}</div>
    <div style="font-size:${SIZE.secondary};color:${C.ink45};margin-top:14px">Shape</div>
    <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">${RENDER_ASPECTS.map((a) =>
      chip("aspect", a.id, a.label, a.note, a.id === "16:9", false),
    ).join("")}</div>
    <!-- Captions are OFF by default and a deliberate choice — the owner's
         instruction was that they belong on some videos, not all of them.
         Burned-in captions cannot be removed from a finished file, so the
         default has to be the reversible one. -->
    <div style="font-size:${SIZE.secondary};color:${C.ink45};margin-top:14px">Captions</div>
    <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">${CAPTION_STYLES.map((cs) =>
      chip("captionStyle", cs, cs === "None" ? "Off" : cs, cs === "None" ? "no captions" : "burned in", cs === "None", false),
    ).join("")}</div>
    <!-- Off by default, for the same reason captions are: it changes how the
         person's voice sounds and a finished file cannot be un-processed. The
         chain behind it — denoise, de-click, a presence lift, compression and
         broadcast loudness — has been in the container since it was written
         and nothing ever ran it. -->
    <div style="font-size:${SIZE.secondary};color:${C.ink45};margin-top:14px">Sound</div>
    <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
      ${chip("enhance", "0", "As recorded", "no processing", true, false)}
      ${chip("enhance", "1", "Clean it up", "denoise and level", false, false)}
    </div>
    <div style="margin-top:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <button type="submit" style="font-size:${SIZE.secondary};font-weight:600;padding:8px 18px;border-radius:${RADIUS.button};background:${C.ink};color:#131316;border:none;cursor:pointer;font-family:${FONT.ui}">Export</button>
      <span style="font-size:${SIZE.meta};color:${C.ink32}">Nothing renders until you say so.</span>
    </div>
    <!--
      THE CHECKLIST, first of the three because it is the one read first.
      It says what Aldershot checked and what it cannot check at all — three
      of doc 09's seven lines have nothing behind them in this product, and
      a tick beside them would be worse than no checklist.
    -->
    <div style="margin-top:14px;padding-top:14px;border-top:1px solid rgba(255,255,255,0.05);display:flex;gap:10px;align-items:baseline;flex-wrap:wrap">
      <a href="/p/${esc(projectId)}/before-post" style="flex:none;font-size:${SIZE.meta};font-weight:600;color:${ACCENT.gold};text-decoration:none">Before you post &nearr;</a>
      <span style="flex:1 1 200px;min-width:0;font-size:${SIZE.meta};color:${C.ink32}">Seven things worth knowing before this goes out, and a straight answer about the ones nothing here can check.</span>
    </div>
    <!--
      THE WAY OUT, beside the way to a finished file.
      A timeline is not a render: it needs no job and no waiting, because the
      edit already is data. It sits here rather than behind its own control
      because this is the panel a person opens when they are thinking about
      where this video goes next.

      AND IT SAYS WHAT ARRIVES, not only what does not.
      This line was a disclaimer: captions and sound work stay here. True, and
      it left out the whole reason to take this file anywhere, which is that
      every clip in it carries the quote it contains, which source it came
      from, and whether its word timings are forced-aligned or the
      recogniser's own. Competitors sell a project file as the product and
      none of them puts provenance in one; ours has had it since the day the
      export existed and the moment somebody chose to use it said nothing
      about it.
      "Graphics" is named too, because the file's own metadata note names it
      and these two sentences disagreeing is how somebody loses an afternoon.
    -->
    <div style="margin-top:10px;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap">
      <a href="/api/projects/${esc(projectId)}/timeline.otio" style="flex:none;font-size:${SIZE.meta};font-weight:600;color:${ACCENT.gold};text-decoration:none">Take it elsewhere &nearr;</a>
      <span style="flex:1 1 200px;min-width:0;font-size:${SIZE.meta};color:${C.ink32}">The cuts as a timeline (.otio) for Resolve or Premiere, each clip named by what is said in it and carrying its quote, its source and where its timings came from. Captions, sound work and graphics are rendered rather than described, so those stay here.</span>
    </div>
    <!--
      THE CUE SHEET, which goes out whether anybody opens it or not.
      It is here to be read, not to be switched on: the label on a generated
      picture and this document both come from the beat's kind, so there is
      nothing to tick and nothing that can be forgotten. A cut with no
      generated or stock pictures gets a cue sheet saying exactly that,
      because "there are none" is an answer somebody may have to show.
    -->
    <div style="margin-top:10px;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap">
      <a href="/api/projects/${esc(projectId)}/cuesheet" style="flex:none;font-size:${SIZE.meta};font-weight:600;color:${ACCENT.gold};text-decoration:none">The cue sheet &nearr;</a>
      <span style="flex:1 1 200px;min-width:0;font-size:${SIZE.meta};color:${C.ink32}">Every picture in here that isn't your own footage — what it shows, how it was made, when. It ships with the file already.</span>
    </div>
    <!--
      THE DISPUTE FILE. Same shape, different question: the cue sheet is about
      pictures nobody filmed, this is about footage somebody else did. It is
      written as the cut is made rather than when a claim arrives, which is
      doc 09's whole point about it, so the link is here from the first
      external clip onwards and not behind a "prepare" step.
    -->
    <div style="margin-top:10px;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap">
      <a href="/api/projects/${esc(projectId)}/dispute" style="flex:none;font-size:${SIZE.meta};font-weight:600;color:${ACCENT.gold};text-decoration:none">The dispute file &nearr;</a>
      <span style="flex:1 1 200px;min-width:0;font-size:${SIZE.meta};color:${C.ink32}">Everything in here that came from somebody else — where from, how much of it, and what the credit said. Written as you cut, not when somebody asks.</span>
    </div>
    <!--
      THE MANIFEST. The only one of the four written for a machine as much as
      a person, which is why it is last: a platform ingesting it, a lawyer's
      tooling diffing two cuts, a later version of this reading it back. It
      carries what it cannot cover in the file itself.
    -->
    <div style="margin-top:10px;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap">
      <a href="/api/projects/${esc(projectId)}/manifest" style="flex:none;font-size:${SIZE.meta};font-weight:600;color:${ACCENT.gold};text-decoration:none">The whole record &nearr;</a>
      <span style="flex:1 1 200px;min-width:0;font-size:${SIZE.meta};color:${C.ink32}">Every source, every rule, and what each rule left out — as a file another tool can read. It says what it doesn't cover, too.</span>
    </div>
    <!--
      THE ONE THAT FACES OUTWARD, and the only control in this product that
      puts anything on the public web. It goes last and leads with "for
      viewers", because the other four are for the person reading this and
      this one is not. Nothing is published by pressing Export: the link goes
      to a page with a button on it.
    -->
    <div style="margin-top:10px;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap">
      <a href="/p/${esc(projectId)}/receipts" style="flex:none;font-size:${SIZE.meta};font-weight:600;color:${ACCENT.gold};text-decoration:none">Receipts for viewers &nearr;</a>
      <span style="flex:1 1 200px;min-width:0;font-size:${SIZE.meta};color:${C.ink32}">A page your audience can read: what you quoted, where from, and whether it was checked. Nothing is public until you publish it.</span>
    </div>
  </form>`;
}

export interface RenderRow {
  id: string;
  format: string;
  aspect: string;
  state: string;
  r2_key: string | null;
  bytes: number | null;
  duration_s: number | null;
  error: string | null;
  created_at: number;
  /** While it runs: the stage, when it began, and how long it should take. */
  stage_label?: string | null;
  started_at?: number | null;
  /** Null until this account has three finished renders to learn a rate from. */
  eta_ms?: number | null;
}

/**
 * Your finished video.
 *
 * THE PRODUCT HAD NO END. You could upload, read, and cut — and then pressing
 * render toasted "it'll appear in Exports when it's done", and there was no
 * Exports. Not hidden, not broken: never built. The pipeline was complete all
 * the way to an mp4 in R2 with state='ready', and nothing in the interface
 * ever showed it to anyone. Every path through this product led to a hole.
 *
 * It lives on the edit rather than behind a fifth nav item, because that is
 * where you pressed the button. You export, and the file appears under the
 * thing you exported.
 */
export function exportsStrip(d: { projectId: string; renders?: RenderRow[] }): string {
  const rows = d.renders ?? [];
  const working = rows.some((r) => r.state === "queued" || r.state === "running");

  const size = (n: number | null) =>
    n ? `${(n / 1e9 >= 1 ? (n / 1e9).toFixed(1) + " GB" : Math.round(n / 1e6) + " MB")}` : "";

  const row = (r: RenderRow) => {
    const label = `${r.format.startsWith("mp4") ? "MP4" : r.format.toUpperCase()} · ${r.aspect}`;
    const meta = [r.duration_s ? hms(r.duration_s) : null, size(r.bytes)].filter(Boolean).join(" · ");

    if (r.state === "ready" && r.r2_key) {
      return `<div style="display:flex;align-items:center;gap:12px;padding:11px 14px;border-radius:${RADIUS.card};background:${C.surface}">
        <span style="flex:none;width:6px;height:6px;border-radius:50%;background:${ACCENT.green}"></span>
        <span data-content style="flex:1;min-width:0;font-size:${SIZE.secondary};color:${C.ink}">${esc(label)}</span>
        <span data-content style="flex:none;font-size:${SIZE.meta};color:${C.ink45};font-family:${FONT.mono}">${esc(meta)}</span>
        <a href="/media/${esc(r.r2_key)}?download=1" style="flex:none;font-size:${SIZE.meta};font-weight:600;padding:6px 12px;border-radius:${RADIUS.button};background:${C.ink};color:#131316">Download</a>
      </div>`;
    }

    if (r.state === "failed") {
      return `<div style="display:flex;align-items:center;gap:12px;padding:11px 14px;border-radius:${RADIUS.card};background:${C.surface};box-shadow:inset 0 0 0 1px rgba(224,106,106,0.24)">
        <span style="flex:none;width:6px;height:6px;border-radius:50%;background:${ACCENT.red}"></span>
        <span data-content style="flex:1;min-width:0;font-size:${SIZE.secondary};color:${ACCENT.red}">${esc(r.error ?? "That render failed.")}</span>
      </div>`;
    }

    /*
     * WHAT IS KNOWN, and nothing that is not.
     *
     * This was a blinking dot and the words "putting it together", with no
     * sense of how far in or how long left — "no % or anything". A render is
     * one call into the encoder and nothing reports from inside it, so there
     * is no percentage, and a bar filling on a timer would be a lie dressed
     * as measurement.
     *
     * Three things are true and all three are shown: the stage it is at, how
     * long it has been going, and — once this account has finished three
     * renders to learn from — roughly how long is left, from the rate its own
     * renders actually ran at. The stripe says "working" without claiming a
     * fraction.
     *
     * AND A WAY OUT. There was none, anywhere in this product, for any kind
     * of work. When an export wedged the owner could watch it or ask someone
     * to edit the database, and he had to do both. A row that can only be
     * waited on is a row that can trap you.
     */
    const started = r.started_at ?? r.created_at;
    return `<div class="job-row" data-render="${esc(r.id)}" data-started="${started}"${r.eta_ms ? ` data-eta="${r.eta_ms}"` : ""}
      style="padding:11px 14px;border-radius:${RADIUS.card};background:${C.surface}">
      <div style="display:flex;align-items:center;gap:12px">
        <span style="flex:none;width:6px;height:6px;border-radius:50%;background:${ACCENT.gold};animation:blip 1.6s ease-in-out infinite"></span>
        <span style="flex:1;min-width:0;font-size:${SIZE.secondary};color:${C.ink45}">${esc(label)} — <span data-stage data-content>${esc(r.stage_label ?? "putting it together")}</span></span>
        <span class="job-left" data-content style="flex:none;font-size:${SIZE.meta};color:${C.ink45};font-family:${FONT.mono};font-variant-numeric:tabular-nums"></span>
        <span class="job-clock" data-content style="flex:none;font-size:${SIZE.meta};color:${C.ink32};font-family:${FONT.mono};font-variant-numeric:tabular-nums">0:00</span>
        <button class="job-stop" data-render="${esc(r.id)}" style="flex:none;font-size:${SIZE.meta};color:${C.ink45};background:none;border:0;padding:4px 8px;border-radius:${RADIUS.button};cursor:pointer">Stop</button>
      </div>
      <div style="margin-top:9px;height:3px;border-radius:99px;background:rgba(255,255,255,0.06);overflow:hidden">
        <div class="job-stripe" style="height:100%;width:34%;background:${ACCENT.gold};border-radius:99px"></div>
      </div>
    </div>`;
  };

  if (!rows.length) return "";

  /* data-working tells the client whether to poll. Nothing polls a finished
     list, which is the difference between a page that settles and one that
     talks to the server for ever. */
  return `<div id="exports" data-project="${esc(d.projectId)}" data-working="${working ? 1 : 0}" style="margin-top:22px">
    <div style="font-size:${SIZE.secondary};color:${C.ink45};margin-bottom:8px">Exports</div>
    <div style="display:flex;flex-direction:column;gap:6px">${rows.map(row).join("")}</div>
  </div>`;
}

/**
 * One transcript line, as a keep/drop block.
 *
 * The unassisted half of the editor: the same reading-and-deciding as a scored
 * cut, with nothing having decided for you. Dropping uses the same cut model
 * as Script, so the two stages edit one thing rather than two.
 *
 * Two things this deliberately does NOT do, both learned from looking at it
 * with a real 38-line transcript in it rather than a one-line test file:
 *
 *  - No thumbnail. A scored clip has its own frame, so a column of them tells
 *    you something. A transcript line does not, so every block was handed the
 *    SAME source poster — thirty-eight identical pictures down the page,
 *    eating 92px of every row to say nothing. The timecode is the useful part
 *    and it is now the thing you click to play.
 *
 *  - No green "Keeping" badge on every line. Everything starts kept, so that
 *    was thirty-eight green pills shouting the default state, while the thing
 *    you actually came to do — drop a line — was the quiet one. The states are
 *    inverted: keeping is silent, and the control offers the action.
 *
 * The whole line is the target. Clicking the text strikes it, which is the
 * gesture Script already uses on words.
 */
