/**
 * The editor with nothing open.
 *
 * This surface exists in the design — `docs/reference/06-editor-intake.png`,
 * and `editorEmpty` in the prototype — and I shipped a heading plus one line of
 * grey text instead, with a comment claiming the prototype had no such state.
 * It does. I never opened the capture.
 *
 * It matters because Editor is a nav destination: someone clicks it before
 * they have uploaded anything, and a blank screen tells them the product is
 * unfinished.
 *
 * It is now only reached when there is NOTHING to open — /editor redirects
 * into the edit you were last in — so it shows the two ways to start one:
 * a new video, or footage already here. "Pick up an edit" used to live here
 * too, which made this page Home with different words; Home answers that now.
 *
 * Every string is the prototype's own.
 */

import { C, FONT, RADIUS, SIZE } from "../tokens.ts";
import { esc } from "../shell.ts";
import { hms } from "./footage.ts";
import { itemMenu } from "../item-menu.ts";

export interface IntakeSource {
  id: string;
  title: string;
  duration_s: number | null;
  poster_r2_key: string | null;
  clip_count: number;
  transcript_state: string;
}

export interface EditorIntakeData {
  sources: IntakeSource[];
}

const SECTION = `font-size:${SIZE.body};font-weight:600;color:${C.ink45}`;

function poster(key: string | null): string {
  return `<div style="flex:none;width:64px;aspect-ratio:16/9;border-radius:${RADIUS.button};overflow:hidden;background:#0B0B0E">${
    key ? `<img loading="lazy" src="/media/${esc(key)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block"/>` : ""
  }</div>`;
}

function row(opts: { href?: string; posterKey: string | null; title: string; meta: string; action: string; sourceId?: string; menu?: string }): string {
  const inner = `${poster(opts.posterKey)}
    <div style="flex:1;min-width:0">
      <div data-content style="font-size:${SIZE.body};font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(opts.title)}</div>
      <div data-content style="font-size:${SIZE.secondary};color:rgba(236,236,241,0.4);margin-top:3px">${esc(opts.meta)}</div>
    </div>
    <span style="font-size:${SIZE.secondary};font-weight:500;padding:6px 13px;border-radius:${RADIUS.button};background:${C.raised};color:${C.ink};flex:none">${opts.action}</span>`;

  // `color` is explicit because a <button> does not inherit the page's text
  // colour the way an <a> does — without it the source rows rendered grey
  // beside identical-looking edit rows that did not.
  const style = `display:flex;align-items:center;gap:14px;padding:14px 16px;border-radius:${RADIUS.card};background:${C.surface};cursor:pointer;width:100%;text-align:left;border:none;color:${C.ink};font-family:${FONT.ui}`;

  /*
   * An edit already exists, so it is a plain link. Opening a SOURCE has to
   * create a project first, and /api/begin speaks JSON and answers with the
   * href to follow — so it is a scripted button, the same shape the Home
   * composer uses. It was briefly a form post, which would have failed twice:
   * body() parses JSON only, and the reply is JSON rather than a redirect, so
   * the user would have landed on a page of raw API output.
   */
  /* The menu is a sibling of the link, not a child: a button inside an anchor
     is invalid and swallows its own clicks. This list is exactly where the
     owner was looking at four accidental edits of one video with no way to
     remove any of them. */
  const menu = opts.menu ? `<div style="flex:none;margin-left:-6px">${opts.menu}</div>` : "";

  return `<div data-item-row style="display:flex;align-items:center;gap:2px">${
    opts.href
      ? `<a href="${esc(opts.href)}" style="flex:1;min-width:0;${style}">${inner}</a>`
      : `<button type="button" class="open-source" data-source="${esc(opts.sourceId ?? "")}" style="flex:1;min-width:0;${style}">${inner}</button>`
  }${menu}</div>`;
}

export function renderEditorIntake(d: EditorIntakeData): string {
  const ready = d.sources.filter((s) => s.transcript_state === "ready");

  const sourceMeta = (s: IntakeSource) => {
    const parts: string[] = [];
    if (s.duration_s) parts.push(hms(s.duration_s));
    if (s.clip_count) parts.push(`${s.clip_count} clip${s.clip_count === 1 ? "" : "s"} found`);
    return parts.join(" · ");
  };

  /*
   * The composer carries the ids the client already binds for upload and
   * "Begin" (#composer, #brief, #filePick, #attached…), so a video dropped
   * here goes through exactly the same resumable upload and real-frame poster
   * grab as one dropped on Home. Two intake points, one code path.
   *
   * "Queue it — it works while you're gone" is deliberately absent: the
   * overnight queue is the Queues feature, which is not provisioned yet, and a
   * button that looks like it queues and does not is worse than no button. It
   * arrives when the queue does.
   */
  const composer = `<form id="composer" method="POST" action="/api/begin" style="margin-top:18px;background:${C.raised};border-radius:${RADIUS.composer};padding:6px;box-shadow:0 0 0 1px rgba(255,255,255,0.06)">
    <div id="attached" hidden style="display:flex;align-items:center;gap:10px;margin:0 8px 4px 14px;padding:7px 9px;border-radius:${RADIUS.input};background:#111114">
      <div style="flex:none;width:46px;aspect-ratio:16/9;border-radius:4px;overflow:hidden;background:#07070a;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.06)"></div>
      <span id="attachedName" style="flex:1;min-width:0;font-size:${SIZE.secondary};color:rgba(236,236,241,0.8);font-family:${FONT.mono};overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
      <span id="attachedMeta" style="flex:none;font-size:${SIZE.meta};color:rgba(236,236,241,0.35);font-family:${FONT.mono}"></span>
      <div tabindex="0" role="button" id="clearFile" style="flex:none;cursor:pointer;color:rgba(236,236,241,0.4);font-size:15px;line-height:1;padding:2px 5px">×</div>
    </div>
    <label style="display:block;padding:13px 14px 6px;cursor:pointer;font-size:${SIZE.body};color:${C.ink45}">Drop a video file or paste a link…
      <input type="file" accept="video/*" multiple id="filePick" style="display:none"/>
    </label>
    <textarea name="brief" id="brief" rows="2" placeholder="What do you want from it? — “a supercut of every weird awkward moment”" style="width:100%;box-sizing:border-box;background:transparent;border:none;outline:none;color:${C.ink};font-size:${SIZE.body};padding:8px 14px;resize:none;line-height:1.5;font-family:${FONT.ui}"></textarea>
    <div style="display:flex;justify-content:flex-end;gap:8px;align-items:center;padding:0 8px 8px;flex-wrap:wrap">
      <button type="button" class="intake-chip" data-brief="React to it" style="font-size:${SIZE.secondary};font-weight:500;padding:8px 14px;border-radius:${RADIUS.button};background:${C.raised};color:${C.ink};cursor:pointer;white-space:nowrap;border:none;font-family:${FONT.ui}">React to it</button>
      <button type="button" class="intake-chip" data-brief="" style="font-size:${SIZE.secondary};font-weight:500;padding:8px 14px;border-radius:${RADIUS.button};background:${C.raised};color:${C.ink};cursor:pointer;white-space:nowrap;border:none;font-family:${FONT.ui}">Skip the brief — edit it yourself</button>
      <button type="submit" style="font-size:${SIZE.body};font-weight:600;padding:9px 22px;border-radius:${RADIUS.button};background:${C.ink};color:#131316;cursor:pointer;white-space:nowrap;border:none;font-family:${FONT.ui}">Start cutting →</button>
    </div>
  </form>`;

  const left = `<div>
    <div style="${SECTION}">Or open something already here</div>
    <div style="margin-top:16px;display:flex;flex-direction:column;gap:6px">${
      ready.length
        ? ready
            .slice(0, 6)
            .map((s) =>
              row({ posterKey: s.poster_r2_key, title: s.title, meta: sourceMeta(s), action: "Open", sourceId: s.id, menu: itemMenu("sources", s.id, s.title, "video") }),
            )
            .join("")
        : `<div data-content style="padding:14px 16px;border-radius:${RADIUS.card};background:${C.surface};font-size:${SIZE.secondary};color:${C.ink45}">Nothing kept yet — add a clip back.</div>`
    }</div>
  </div>`;

  return `<div>
    <div style="font-size:${SIZE.pageTitle};font-weight:600;letter-spacing:-0.02em">Editor</div>
    <div data-content style="font-size:${SIZE.body};color:rgba(236,236,241,0.42);margin-top:5px;max-width:520px">Give it a video and say what you want out of it — it cuts, you adjust, nothing renders until you say so.</div>
    ${composer}
    <div style="margin-top:32px">${left}</div>
  </div>`;
}
