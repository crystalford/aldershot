/**
 * Clipping — auto-shorts, no brief.
 *
 * "Point at a video (upload, paste a URL, or pick from Footage) → scored
 * vertical shorts with captions burned in" (01-PRODUCT.md §Clipping).
 *
 * Reached from the nav it is standalone; reached as an editor stage it keeps
 * the Editor nav lit and shows the four stage tabs — same engine, different
 * context. That is `shortsCtx`, and it is why the editor feels like one place.
 */

import { C, ACCENT, FONT, RADIUS, SIZE, accentBg } from "../tokens.ts";
import { iconPause, iconPlay, iconPlus, iconSearch } from "../icons.ts";
import { esc } from "../shell.ts";
import { hms } from "./footage.ts";
import { pageHeading } from "./empty.ts";
import { ASPECTS, CAPTION_STYLES, CLIP_COUNTS, CLIP_LENGTHS } from "../../shorts.ts";

export interface ShortRender {
  id: string;
  state: string;
  r2_key: string | null;
  error: string | null;
  /** How long the finished file actually is — see `stale` below. */
  duration_s: number | null;
}

export interface ShortRow {
  id: string;
  start_ms: number;
  end_ms: number;
  quote: string;
  why: string | null;
  score: number | null;
  kept: number;
  frame_r2_key: string;
  /** editor | clipping | manual. A manual clip was chosen by hand, not scored. */
  origin: string;
  /** The file this moment lives in, so the card can paint its own frame. */
  sourceKey: string | null;
  sourceTitle: string | null;
  /** The video of this moment, once one has been made. */
  render?: ShortRender | null;
}

export interface ClippingSource {
  id: string;
  title: string;
  duration_s: number | null;
  transcript_state: string;
  /** The real first frame. A row without one shows an empty well, never a fake. */
  poster_r2_key: string | null;
  /** How many clips this source has already yielded, for the meta line. */
  clip_count: number;
}

export interface ClippingData {
  /** The video being clipped, if one is chosen. */
  source: ClippingSource | null;
  /** Everything ready to clip, for the picker. */
  available: ClippingSource[];
  shorts: ShortRow[];
  job: { state: string; pct: number; stage_label: string | null; error: string | null } | null;
  /** Set when reached as an editor stage rather than from the nav. */
  fromEditor: boolean;
}

function chipRow(name: string, label: string, options: readonly string[], selected: string): string {
  return `<div>
    <div style="font-size:${SIZE.meta};color:${C.ink45};margin-bottom:6px">${esc(label)}</div>
    <div style="display:flex;gap:5px;flex-wrap:wrap">${options
      .map(
        (o) =>
          `<label style="cursor:pointer"><input type="radio" name="${name}" value="${esc(o)}" ${
            o === selected ? "checked" : ""
          } style="position:absolute;opacity:0;pointer-events:none"/><span class="chip" style="display:inline-block;font-size:${SIZE.secondary};padding:5px 11px;border-radius:${RADIUS.button};background:${
            o === selected ? C.active : C.surface
          };color:${o === selected ? C.ink : "rgba(236,236,241,0.55)"};white-space:nowrap">${esc(o)}</span></label>`,
      )
      .join("")}</div>
  </div>`;
}

/** Choosing what to clip, when nothing is chosen yet. */
function picker(d: ClippingData): string {
  const ready = d.available.filter((s) => s.transcript_state === "ready");
  /*
   * A STRIP, not a list.
   *
   * These were full-width rows — poster, title, meta, a button — which made
   * Clipping the third page in a row showing the same stack of videos, after
   * Footage and the Editor's intake. Picking which video to clip is a small
   * act, and it should not be the largest thing on a page whose subject is
   * the shorts themselves.
   *
   * It scrolls sideways on purpose: a library of any size stays one row, and
   * the shorts below it stay where the eye lands first.
   */
  const rows = ready
    .map(
      (s) => `<a href="/clipping?source=${esc(s.id)}" style="flex:none;width:132px;display:flex;flex-direction:column;gap:6px">
      <div style="width:100%;aspect-ratio:16/9;border-radius:${RADIUS.button};overflow:hidden;background:#0B0B0E;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.06);position:relative">${
        s.poster_r2_key
          ? `<img loading="lazy" src="/media/${esc(s.poster_r2_key)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block"/>`
          : ""
      }${
        s.duration_s
          ? `<span style="position:absolute;right:4px;bottom:4px;font-size:${SIZE.pill};font-family:${FONT.mono};background:rgba(0,0,0,.66);border-radius:3px;padding:1px 4px;color:${C.ink}">${hms(s.duration_s)}</span>`
          : ""
      }</div>
      <div data-content style="font-size:${SIZE.meta};color:${C.ink70};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.title)}</div>
      ${s.clip_count ? `<div data-content style="font-size:${SIZE.pill};color:${C.ink32}">${s.clip_count} clip${s.clip_count === 1 ? "" : "s"} found</div>` : ""}
    </a>`,
    )
    .join("");

  /*
   * The drop zone was missing entirely. It matters more than it looks: it is
   * the only place on this surface that says where a dropped video goes, and
   * without it Clipping reads as though it can only work on what is already
   * there.
   */
  const drop = `<label id="clipDrop" style="display:flex;align-items:center;justify-content:center;gap:10px;padding:22px 16px;border-radius:${RADIUS.card};background:#141418;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.05);font-size:13px;color:rgba(236,236,241,0.55);cursor:pointer">
    ${iconPlus({ size: 15 })}
    <span>Drop a new video here or <span style="color:${C.ink};text-decoration:underline;text-decoration-color:rgba(236,236,241,0.25)">browse</span> — it lands in Footage, then gets clipped</span>
    <input type="file" accept="video/*" id="clipFilePick" style="display:none"/>
  </label>`;

  return `<div style="margin-top:24px">
    <div style="font-size:${SIZE.body};font-weight:600;color:${C.ink45}">Drop a video, or clip one you already have</div>
    <div style="margin-top:14px;display:flex;gap:12px;overflow-x:auto;padding-bottom:4px">${rows}</div>
    <div style="margin-top:12px">${drop}</div>
  </div>`;
}

/**
 * How a short comes out — shape and captions.
 *
 * These lived inside the scan form, which only exists once you have picked a
 * video to scan. So on the page you actually land on there was no .clip-form,
 * and "Make the video" fell back to `captionStyle: "None"` — the client said
 * so out loud — while the page's own lede promised "captions burned in". The
 * renderer has always done real captions from the transcript; nothing was
 * missing but the choice reaching it.
 *
 * They belong to the page, so they are on it either way.
 */
function output(): string {
  return `<form class="clip-form" style="margin-top:18px;padding:14px 16px;border-radius:${RADIUS.card};background:${C.surface};display:flex;gap:26px;flex-wrap:wrap">
    ${chipRow("aspect", "Shape", ASPECTS, "9:16")}
    ${chipRow("captionStyle", "Captions", CAPTION_STYLES, "Bold")}
  </form>`;
}

/** What to look for, and the button that starts the run. */
function controls(d: ClippingData): string {
  if (!d.source) return "";
  return `<form class="clip-scan" data-source="${esc(d.source.id)}" style="margin-top:20px;padding:16px 18px;border-radius:${RADIUS.card};background:${C.surface}">
    <div style="font-size:${SIZE.body};font-weight:600">Find clips in this</div>
    <div style="display:flex;gap:26px;margin-top:14px;flex-wrap:wrap">
      ${chipRow("length", "How long", CLIP_LENGTHS.map((l) => l.name), "30–60s")}
      ${chipRow("count", "How many", CLIP_COUNTS.map(String), "8")}
    </div>
    <button type="submit" style="margin-top:16px;font-size:${SIZE.secondary};font-weight:600;padding:8px 16px;border-radius:${RADIUS.button};background:${C.ink};color:#131316;border:none;cursor:pointer;font-family:${FONT.ui}">Find clips</button>
  </form>`;
}

/** "Want one it missed?" — transcript search, not another scoring run. */
function askBox(d: ClippingData): string {
  if (!d.source) return "";
  return `<form class="clip-ask" data-source="${esc(d.source.id)}" style="margin-top:14px;padding:14px 16px;border-radius:${RADIUS.card};background:${C.surface}">
    <div style="font-size:${SIZE.secondary};color:${C.ink45};margin-bottom:8px">Want one it missed?</div>
    <div style="display:flex;gap:8px;align-items:center;background:#131316;border-radius:${RADIUS.input};padding:4px 4px 4px 12px;flex-wrap:wrap">
      ${iconSearch({ size: 14, stroke: "rgba(236,236,241,0.4)" })}
      <input name="q" placeholder="the bit where he talks about cheeseburgers…" style="flex:1 1 200px;min-width:min(180px,100%);background:transparent;border:none;outline:none;color:${C.ink};font-size:13px;padding:7px 0;font-family:${FONT.ui}"/>
      <button type="submit" style="flex:none;font-size:${SIZE.secondary};font-weight:600;padding:7px 15px;border-radius:${RADIUS.button};background:${C.pill};color:${C.ink};cursor:pointer;white-space:nowrap;border:none;font-family:${FONT.ui}">Find it</button>
    </div>
  </form>`;
}

/**
 * As much of a failure as fits on a card.
 *
 * ffmpeg and the container runtime hand back paragraphs — one of them is four
 * lines ending in a documentation URL — and a card is 220px wide. The first
 * sentence is the part worth reading; the whole of it is on the title
 * attribute for anyone who wants it.
 */
function short_reason(error: string | null): string {
  const text = (error ?? "").trim() || "That didn't render";
  const first = text.split(/(?<=[.!?])\s/)[0];
  return first.length > 96 ? first.slice(0, 95).trimEnd() + "…" : first;
}

/**
 * One result. Score, why it scored, where it was found, and Keep or Drop —
 * every one of those is required by the acceptance criteria, and every one is
 * real rather than decorative.
 */
function shortCard(s: ShortRow): string {
  const kept = Boolean(s.kept);
  const lengthMs = Math.max(0, s.end_ms - s.start_ms);

  /*
   * IS THE FILE STILL A FILE OF THIS CLIP?
   *
   * Trimming moves the boundaries and leaves a finished video of the old ones
   * behind, and a card offering Download for that is offering the wrong
   * video. The render records how long it actually is, so the two can simply
   * be compared — no schema, and nothing has to be deleted or marked, which
   * matters because storage counts the bytes of ready renders and the file is
   * still in R2.
   *
   * A second of slack: an encoder lands on whole frames, not on the exact
   * millisecond it was asked for.
   */
  const r = s.render;
  const stale = Boolean(
    r && r.state === "ready" && r.duration_s != null && Math.abs(r.duration_s * 1000 - lengthMs) > 1000,
  );
  const playable = Boolean(r && r.state === "ready" && r.r2_key && !stale);

  /*
   * ITS OWN MOMENT, not the video's first frame.
   *
   * frame_r2_key is the SOURCE's poster — so all eleven clips from one video
   * wore the same image, and when that video opens on black (both of the
   * owner's do) every card was a black rectangle. The canvas is painted by
   * seeking a hidden video to this clip's own time, which is exactly what the
   * editor does for block rows; one implementation, called from both.
   */
  const frame = s.sourceKey
    ? `<canvas class="short-frame" data-media="${esc(s.sourceKey)}" data-at="${s.start_ms}" width="270" height="480"
        style="position:absolute;inset:0;width:100%;height:100%;display:block;object-fit:cover"></canvas>`
    : s.frame_r2_key
      ? `<img loading="lazy" src="/media/${esc(s.frame_r2_key)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block"/>`
      : "";

  /*
   * THE VIDEO, once one exists.
   *
   * This card used to stretch a 16:9 still into a 9:16 box behind a play
   * button that was a <span> — decoration in the shape of a player, on a
   * surface whose own lede promises "scored vertical shorts". Nothing here
   * ever rendered anything.
   *
   * A short that has been made plays in place and can be downloaded. One that
   * has not shows the frame and offers to make it, because rendering costs
   * money and this product does not spend it unasked.
   *
   * The player is ours, not the browser's: on a card this size Chrome's own
   * control bar takes a quarter of the frame.
   */
  const media = playable
    ? `<video class="short-video" preload="metadata" playsinline src="/media/${esc(r!.r2_key!)}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#000"></video>
       <div class="player" data-compact="1" style="position:absolute;left:0;right:0;bottom:0;display:flex;align-items:center;gap:7px;padding:6px 8px;background:linear-gradient(to top,rgba(8,8,10,.86),rgba(8,8,10,0))">
         <button class="pl-play" aria-label="Play" style="flex:none;display:grid;place-items:center;width:22px;height:22px;border-radius:${RADIUS.button};background:transparent;border:none;cursor:pointer">
           <span class="pl-i-play" style="display:grid">${iconPlay(11, C.ink)}</span>
           <span class="pl-i-pause" hidden>${iconPause(11, C.ink)}</span>
         </button>
         <div class="pl-track" role="slider" tabindex="0" aria-label="Position" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"
           style="position:relative;flex:1;height:14px;cursor:pointer;touch-action:none">
           <div style="position:absolute;left:0;right:0;top:6px;height:2px;background:rgba(255,255,255,0.22)"></div>
           <div class="pl-played" style="position:absolute;left:0;top:6px;width:0;height:2px;background:${C.ink}"></div>
         </div>
         <span class="pl-now" data-content style="flex:none;font-size:${SIZE.pill};font-family:${FONT.mono};color:${C.ink};font-variant-numeric:tabular-nums">0:00</span>
         <button class="pl-full" aria-label="Fullscreen" style="flex:none;font-size:${SIZE.pill};font-weight:600;padding:0 4px;background:transparent;border:none;color:${C.ink};cursor:pointer;font-family:${FONT.ui}">Full</button>
       </div>`
    : frame;

  const overlay = playable
    ? ""
    : r && (r.state === "queued" || r.state === "running")
      ? `<span data-content style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:${SIZE.meta};color:${C.ink70};background:rgba(10,10,11,.7);padding:5px 10px;border-radius:${RADIUS.button}">making it…</span>`
      : `<div style="position:absolute;left:8px;right:8px;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;align-items:center;gap:8px">
          ${
            /* A failure says why AND offers the button again. Showing only the
               reason leaves a card that can never be anything else, which is
               how a recoverable problem starts looking permanent. */
            r && r.state === "failed"
              ? /* Bounded. An encoder can hand back a paragraph with a URL in it,
                   and on a 220px card an unbroken link laid itself across the
                   two cards either side — the reason a failure is worth
                   reading is the first sentence of it. */
                `<span data-content title="${esc(r.error ?? "")}" style="max-width:100%;box-sizing:border-box;font-size:${SIZE.meta};color:${ACCENT.red};background:rgba(10,10,11,.85);padding:6px 8px;border-radius:${RADIUS.button};text-align:center;line-height:1.4;overflow-wrap:anywhere">${esc(short_reason(r.error))}</span>`
              : ""
          }
          ${
            /* A video of boundaries that no longer exist. Say so, rather than
               silently offering to make it again as though nothing had. */
            stale
              ? `<span data-content style="max-width:100%;box-sizing:border-box;font-size:${SIZE.meta};color:${ACCENT.gold};background:rgba(10,10,11,.85);padding:6px 8px;border-radius:${RADIUS.button};text-align:center;line-height:1.4;overflow-wrap:anywhere">You trimmed this — make it again</span>`
              : ""
          }
          <button class="make-short" data-clip="${esc(s.id)}" style="font-size:${SIZE.meta};font-weight:600;padding:7px 13px;border-radius:${RADIUS.button};background:${C.ink};color:#131316;border:none;cursor:pointer;font-family:${FONT.ui}">${r && r.state === "failed" ? "Retry" : "Make the video"}</button>
        </div>`;

  /*
   * THE BADGE, and the one thing it must never say.
   *
   * This was `${s.score ?? 0}` in green — so a clip you picked yourself, which
   * saveClips writes with score 0, wore a green nought as though a model had
   * judged it and found nothing. The editor already fixed exactly this ("a
   * zero is not a verdict, it is the absence of one"), and the route that
   * makes these says the same: a manual clip "has no score… without pretending
   * a model picked it". The prototype has the state it should be in.
   */
  const badge =
    s.score != null && s.score > 0
      ? `<span data-content style="position:absolute;top:8px;left:8px;font-size:${SIZE.pill};font-weight:600;padding:3px 8px;border-radius:4px;background:${accentBg(ACCENT.green)};color:${ACCENT.green};font-family:${FONT.mono};pointer-events:none">${s.score}</span>`
      : s.origin === "manual"
        ? `<span data-content style="position:absolute;top:8px;left:8px;font-size:${SIZE.pill};font-weight:600;padding:3px 8px;border-radius:4px;background:rgba(10,10,11,.7);color:${C.ink70};pointer-events:none">Yours</span>`
        : "";

  /* Where it sits in the source, said as a position rather than left as a
     bare number under a card about a short — "2:07" read as a length. */
  const meta = [
    `${hms(s.start_ms / 1000)} in`,
    s.sourceTitle && !s.why ? s.sourceTitle : "",
    s.score == null || s.score === 0 ? (s.origin === "manual" ? "Not scored" : "") : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return `<div data-short="${esc(s.id)}" data-state="${esc(r?.state ?? "none")}" style="border-radius:${RADIUS.card};background:${C.surface};overflow:hidden;display:flex;flex-direction:column">
    <div style="position:relative;aspect-ratio:9/16;background:#0B0B0E">
      ${media}
      ${badge}
      ${
        /* How long the short IS. A made one was the only card that never said,
           because the badge was hidden the moment it became playable. */
        `<span data-content style="position:absolute;bottom:${playable ? "34px" : "8px"};right:8px;font-size:${SIZE.pill};font-family:${FONT.mono};background:rgba(0,0,0,.6);padding:2px 6px;border-radius:3px;pointer-events:none">${hms(lengthMs / 1000)}</span>`
      }
      ${overlay}
    </div>
    <div style="padding:12px;display:flex;flex-direction:column;gap:6px;flex:1">
      <div data-content style="font-size:${SIZE.secondary};line-height:1.45;color:${C.ink}">${esc(s.quote.slice(0, 110))}</div>
      ${s.why ? `<div data-content style="font-size:${SIZE.meta};color:${C.ink45}">${esc(s.why)}</div>` : ""}
      <div data-content style="font-size:${SIZE.meta};color:rgba(236,236,241,0.3);font-family:${FONT.mono}">${esc(meta)}</div>
      <div style="display:flex;gap:6px;margin-top:auto;padding-top:6px;align-items:center;flex-wrap:wrap">
        ${playable ? `<a href="/media/${esc(r!.r2_key!)}?download=1" style="flex:none;font-size:${SIZE.meta};font-weight:600;padding:6px 11px;border-radius:${RADIUS.button};background:${C.pill};color:${C.ink}">Download</a>` : ""}
        ${
          /* The verb the clipper never had. Everything about this short can be
             changed before a render is spent on it. */
          s.sourceKey
            ? `<button class="short-edit" data-clip="${esc(s.id)}" style="flex:none;font-size:${SIZE.meta};font-weight:600;padding:6px 11px;border-radius:${RADIUS.button};background:${C.pill};color:${C.ink};border:none;cursor:pointer;font-family:${FONT.ui}">Adjust</button>`
            : ""
        }
        <button class="keep-toggle" data-clip="${esc(s.id)}" data-kept="${kept ? 1 : 0}" style="flex:1 1 70px;background:none;border:none;padding:0;cursor:pointer;font-family:${FONT.ui}">
          <span style="display:block;text-align:center;font-size:${SIZE.secondary};font-weight:${kept ? 600 : 500};padding:6px 0;border-radius:${RADIUS.button};background:${kept ? accentBg(ACCENT.green) : C.pill};color:${kept ? ACCENT.green : C.ink70};white-space:nowrap">${kept ? "Keeping" : "Keep it"}</span>
        </button>
      </div>
    </div>
  </div>`;
}

/**
 * Adjust a short before you spend a render on it.
 *
 * The clipper had exactly one verb. Every card offered "Make the video" and
 * nothing else, so disagreeing with where the model put a boundary meant
 * paying for a render and looking at what came out. Adjusting the clip is most
 * of what a tool like this is for, and the prototype draws two surfaces for it
 * ("Edit this short" and "Trim by word") — neither was ever built.
 *
 * What is here is what is real. The preview is the clip's own frame at the
 * shape you chose; the trim writes start_ms and end_ms, which is exactly what
 * renderShort builds its plan from.
 *
 * Deliberately absent: Reframe, which needs subject detection and a crop
 * offset carried into ffmpeg, and the caption textarea, which is a title card
 * rather than the spoken captions the renderer burns in. A chip for either
 * would be a control that does nothing.
 */
function adjustSheet(): string {
  const step = (cls: string, label: string) =>
    `<button class="${cls}" style="width:26px;height:26px;display:grid;place-items:center;border-radius:${RADIUS.button};background:${C.pill};color:${C.ink};border:none;cursor:pointer;font-family:${FONT.ui};font-size:${SIZE.body};line-height:1">${label}</button>`;

  const edge = (name: string, minus: string, out: string, plus: string) =>
    `<div style="display:flex;align-items:center;gap:8px">
      <span style="flex:none;width:34px;font-size:${SIZE.meta};color:${C.ink45}">${name}</span>
      ${step(minus, "−")}
      <span class="${out}" data-content style="flex:none;min-width:52px;text-align:center;font-size:${SIZE.meta};font-family:${FONT.mono};color:${C.ink70};font-variant-numeric:tabular-nums">0:00</span>
      ${step(plus, "+")}
    </div>`;

  return `<div id="adjust" hidden style="position:fixed;inset:0;z-index:70;background:rgba(6,6,8,0.62);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:16px">
    <div data-close style="position:absolute;inset:0"></div>
    <div style="position:relative;width:min(720px,100%);max-height:88vh;overflow-y:auto;background:#141418;border-radius:${RADIUS.card};box-shadow:0 24px 60px rgba(0,0,0,.5), inset 0 0 0 1px rgba(255,255,255,0.07)">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:15px 18px;border-bottom:1px solid ${C.hairline}">
        <div style="font-size:${SIZE.body};font-weight:600">Edit this short</div>
        <button data-close style="font-size:${SIZE.secondary};font-weight:500;padding:6px 13px;border-radius:${RADIUS.button};background:${C.raised};color:${C.ink};border:none;cursor:pointer;font-family:${FONT.ui}">Done</button>
      </div>
      <div style="display:flex;gap:20px;padding:18px;flex-wrap:wrap">
        <div style="flex:0 1 190px;min-width:min(160px,100%)">
          <div class="adj-well" style="width:100%;aspect-ratio:9/16;border-radius:${RADIUS.card};overflow:hidden;background:#07070a;position:relative">
            <canvas class="adj-frame" width="270" height="480" style="position:absolute;inset:0;width:100%;height:100%;display:block"></canvas>
            <div class="adj-cap" hidden style="position:absolute;inset:0;pointer-events:none;display:flex;align-items:flex-end;justify-content:center;padding:12px">
              <span data-content style="font-size:11px;font-weight:700;line-height:1.3;color:#131316;background:${C.ink};padding:3px 6px;border-radius:4px;text-align:center"></span>
            </div>
          </div>
          <div style="margin-top:8px;display:flex;justify-content:space-between;gap:8px">
            <span class="adj-from" data-content style="font-size:${SIZE.meta};color:${C.ink45};font-family:${FONT.mono}"></span>
            <span class="adj-dur" data-content style="font-size:${SIZE.meta};color:${C.ink};font-family:${FONT.mono}"></span>
          </div>
        </div>

        <div style="flex:1 1 260px;min-width:min(240px,100%);display:flex;flex-direction:column;gap:18px">
          <div class="adj-why" hidden>
            <div class="adj-why-head" data-content style="font-size:${SIZE.secondary};font-weight:600;color:${C.ink45}"></div>
            <div class="adj-why-text" data-content style="margin-top:6px;font-size:${SIZE.secondary};color:${C.ink70};line-height:1.5"></div>
          </div>

          <div>
            <div style="font-size:${SIZE.secondary};font-weight:600;color:${C.ink45}">Trim</div>
            <div style="margin-top:9px;display:flex;gap:18px;flex-wrap:wrap">
              ${edge("Head", "adj-head-minus", "adj-head", "adj-head-plus")}
              ${edge("Tail", "adj-tail-minus", "adj-tail", "adj-tail-plus")}
            </div>
          </div>

          <div>
            <div style="font-size:${SIZE.secondary};font-weight:600;color:${C.ink45}">Trim by word</div>
            <div data-content style="font-size:${SIZE.meta};color:${C.ink32};margin-top:3px">Click a word to start there. Click a second word to end there.</div>
            <div class="adj-words" style="margin-top:10px;display:flex;flex-wrap:wrap;gap:2px;font-size:15px;line-height:1.7;max-height:190px;overflow-y:auto"></div>
          </div>

          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <button class="adj-make" style="flex:1 1 auto;font-size:${SIZE.secondary};font-weight:600;padding:8px 16px;border-radius:${RADIUS.button};background:${C.ink};color:#131316;border:none;cursor:pointer;font-family:${FONT.ui}">Make the video</button>
            <button class="adj-reset" style="flex:none;font-size:${SIZE.meta};color:${C.ink45};background:none;border:none;cursor:pointer;font-family:${FONT.ui}">Use the whole clip</button>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

export function renderClipping(d: ClippingData): string {
  /* The lede follows what is on the page, not which URL you arrived by. With
     shorts on screen, "Pick a video and it does the rest" describes something
     that has already happened. */
  const heading = d.fromEditor
    ? ""
    : pageHeading(
        "Clipping",
        d.source || d.shorts.length
          ? "Scored vertical shorts, captions burned in — no brief needed. Watch them, keep the ones that land."
          : "Scored vertical shorts, captions burned in — no brief needed. Pick a video and it does the rest.",
      );

  /*
   * Clipping with no video chosen showed the video list and nothing else — so
   * the nav item promising "shorts" delivered a third copy of Footage, and the
   * shorts you had actually made were invisible unless you remembered which
   * video they came from. Lead with the work; the picker follows it.
   */
  if (!d.source) {
    /* No section label: these are every short in the library, so "Shorts from
       this footage" — the prototype's phrase for one video's shorts — would be
       a lie here, and the page's own lede already says what they are. */
    const made = d.shorts.length
      ? `<div style="margin-top:22px;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),220px));gap:14px">${d.shorts.map(shortCard).join("")}</div>`
      : "";
    /* Shorts first: what you have made is the point of the surface, and the
       picker is how you make another. Leading with the picker made Clipping a
       third copy of the video list. */
    return heading + (d.shorts.length ? output() : "") + made + picker(d) + (d.shorts.length ? adjustSheet() : "");
  }

  const running = d.job && (d.job.state === "queued" || d.job.state === "running");
  const body = running
    ? `<div id="clipping-job" data-source="${esc(d.source.id)}" style="margin-top:20px;display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:${RADIUS.card};background:#141418;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.04)">
        <span style="width:6px;height:6px;border-radius:50%;background:${ACCENT.gold};animation:blip 1.6s ease-in-out infinite;flex:none"></span>
        <span style="flex:1;font-size:${SIZE.secondary};color:rgba(236,236,241,0.55)">${esc(d.job?.stage_label ?? "finding clips")}</span>
      </div>`
    : d.job?.state === "failed"
      ? `<div style="margin-top:20px;padding:16px 18px;border-radius:${RADIUS.card};background:${C.surface};box-shadow:inset 0 0 0 1px rgba(224,106,106,0.24)">
          <div data-content style="font-size:${SIZE.body};color:${ACCENT.red}">${esc(d.job.error ?? "Couldn't find clips in that.")}</div>
        </div>`
      : d.shorts.length
        ? `<div style="margin-top:20px;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),220px));gap:14px">${d.shorts.map(shortCard).join("")}</div>`
        : "";

  return `${heading}${controls(d)}${askBox(d)}${d.shorts.length ? output() : ""}${body}${d.shorts.length ? adjustSheet() : ""}`;
}
