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
import { iconPlus, iconSearch } from "../icons.ts";
import { esc } from "../shell.ts";
import { hms } from "./footage.ts";
import { pageHeading } from "./empty.ts";
import { ASPECTS, CAPTION_STYLES, CLIP_COUNTS, CLIP_LENGTHS } from "../../shorts.ts";

export interface ShortRender {
  id: string;
  state: string;
  r2_key: string | null;
  error: string | null;
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
   * "1:22:04 · 6 clips found" — the runtime and what the source has already
   * given you, in the UI face. Not mono: the prototype reserves the mono face
   * for timecodes you read against the footage, and this is a sentence.
   */
  const meta = (s: ClippingSource) => {
    const parts: string[] = [];
    if (s.duration_s) parts.push(hms(s.duration_s));
    if (s.clip_count) parts.push(`${s.clip_count} clip${s.clip_count === 1 ? "" : "s"} found`);
    return parts.join(" · ");
  };

  const rows = ready
    .map(
      (s) => `<a href="/clipping?source=${esc(s.id)}" style="display:flex;align-items:center;gap:14px;padding:14px 16px;border-radius:${RADIUS.card};background:${C.surface};cursor:pointer">
      <div style="flex:none;width:64px;aspect-ratio:16/9;border-radius:${RADIUS.button};overflow:hidden;background:#0B0B0E">${
        s.poster_r2_key
          ? `<img loading="lazy" src="/media/${esc(s.poster_r2_key)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block"/>`
          : ""
      }</div>
      <div style="flex:1;min-width:0">
        <div data-content style="font-size:${SIZE.body};font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.title)}</div>
        <div data-content style="font-size:${SIZE.secondary};color:rgba(236,236,241,0.4);margin-top:3px">${meta(s)}</div>
      </div>
      <span style="font-size:${SIZE.secondary};font-weight:500;padding:6px 13px;border-radius:${RADIUS.button};background:${C.raised};color:${C.ink};flex:none">Clip it</span>
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
    <div style="margin-top:16px;display:flex;flex-direction:column;gap:6px">${rows}${drop}</div>
  </div>`;
}

/** The batch controls, then the button that starts the run. */
function controls(d: ClippingData): string {
  if (!d.source) return "";
  return `<form class="clip-form" data-source="${esc(d.source.id)}" style="margin-top:20px;padding:16px 18px;border-radius:${RADIUS.card};background:${C.surface}">
    <div style="font-size:${SIZE.body};font-weight:600">Find clips in this</div>
    <div style="display:flex;gap:26px;margin-top:14px;flex-wrap:wrap">
      ${chipRow("aspect", "Shape", ASPECTS, "9:16")}
      ${chipRow("captionStyle", "Captions", CAPTION_STYLES, "Bold")}
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
 * One result. Score, why it scored, where it was found, and Keep or Drop —
 * every one of those is required by the acceptance criteria, and every one is
 * real rather than decorative.
 */
function shortCard(s: ShortRow): string {
  const kept = Boolean(s.kept);
  const frame = s.frame_r2_key
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
   */
  const r = s.render;
  const media = r && r.state === "ready" && r.r2_key
    ? `<video preload="metadata" playsinline controls${s.frame_r2_key ? ` poster="/media/${esc(s.frame_r2_key)}"` : ""} src="/media/${esc(r.r2_key)}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#000"></video>`
    : frame;

  const overlay = r && r.state === "ready"
    ? ""
    : r && (r.state === "queued" || r.state === "running")
      ? `<span data-content style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:${SIZE.meta};color:${C.ink70};background:rgba(10,10,11,.7);padding:5px 10px;border-radius:${RADIUS.button}">making it…</span>`
      : `<div style="position:absolute;left:8px;right:8px;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;align-items:center;gap:8px">
          ${
            /* A failure says why AND offers the button again. Showing only the
               reason leaves a card that can never be anything else, which is
               how a recoverable problem starts looking permanent. */
            r && r.state === "failed"
              ? `<span data-content style="font-size:${SIZE.meta};color:${ACCENT.red};background:rgba(10,10,11,.85);padding:6px 8px;border-radius:${RADIUS.button};text-align:center;line-height:1.4">${esc(r.error ?? "That didn't render")}</span>`
              : ""
          }
          <button class="make-short" data-clip="${esc(s.id)}" style="font-size:${SIZE.meta};font-weight:600;padding:7px 13px;border-radius:${RADIUS.button};background:${C.ink};color:#131316;border:none;cursor:pointer;font-family:${FONT.ui}">${r && r.state === "failed" ? "Retry" : "Make the video"}</button>
        </div>`;

  return `<div data-short="${esc(s.id)}" data-state="${esc(r?.state ?? "none")}" style="border-radius:${RADIUS.card};background:${C.surface};overflow:hidden;display:flex;flex-direction:column">
    <div style="position:relative;aspect-ratio:9/16;background:#0B0B0E">
      ${media}
      <span style="position:absolute;top:8px;left:8px;font-size:${SIZE.pill};font-weight:600;padding:3px 8px;border-radius:4px;background:${accentBg(ACCENT.green)};color:${ACCENT.green};font-family:${FONT.mono};pointer-events:none">${s.score ?? 0}</span>
      ${r && r.state === "ready" ? "" : `<span data-content style="position:absolute;bottom:8px;right:8px;font-size:${SIZE.pill};font-family:${FONT.mono};background:rgba(0,0,0,.6);padding:2px 6px;border-radius:3px">${hms((s.end_ms - s.start_ms) / 1000)}</span>`}
      ${overlay}
    </div>
    <div style="padding:12px;display:flex;flex-direction:column;gap:6px;flex:1">
      <div data-content style="font-size:${SIZE.secondary};line-height:1.45;color:${C.ink}">${esc(s.quote.slice(0, 110))}</div>
      ${s.why ? `<div data-content style="font-size:${SIZE.meta};color:${C.ink45}">${esc(s.why)}</div>` : ""}
      <div data-content style="font-size:${SIZE.meta};color:rgba(236,236,241,0.3);font-family:${FONT.mono}">${hms(s.start_ms / 1000)}</div>
      <div style="display:flex;gap:6px;margin-top:auto;padding-top:6px;align-items:center">
      ${r && r.state === "ready" && r.r2_key ? `<a href="/media/${esc(r.r2_key)}?download=1" style="flex:none;font-size:${SIZE.meta};font-weight:600;padding:6px 11px;border-radius:${RADIUS.button};background:${C.pill};color:${C.ink}">Download</a>` : ""}
      
        <button class="keep-toggle" data-clip="${esc(s.id)}" data-kept="${kept ? 1 : 0}" style="flex:1;background:none;border:none;padding:0;cursor:pointer;font-family:${FONT.ui}">
          <span style="display:block;text-align:center;font-size:${SIZE.secondary};font-weight:${kept ? 600 : 500};padding:6px 0;border-radius:${RADIUS.button};background:${kept ? accentBg(ACCENT.green) : C.pill};color:${kept ? ACCENT.green : C.ink70};white-space:nowrap">${kept ? "Keeping" : "Keep it"}</span>
        </button>
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
      ? `<div style="margin-top:22px;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(210px,100%),1fr));gap:14px">${d.shorts.map(shortCard).join("")}</div>`
      : "";
    /* Shorts first: what you have made is the point of the surface, and the
       picker is how you make another. Leading with the picker made Clipping a
       third copy of the video list. */
    return heading + made + picker(d);
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
        ? `<div style="margin-top:20px;display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:14px">${d.shorts.map(shortCard).join("")}</div>`
        : "";

  return `${heading}${controls(d)}${askBox(d)}${body}`;
}
