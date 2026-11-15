/**
 * BEFORE YOU POST, as a page somebody actually reads.
 *
 * `src/beforepost.ts` has produced these lines since it was written, and the
 * only way to see them was to DOWNLOAD A TEXT FILE: the route answered with
 * `content-disposition: attachment` and a .txt. Nobody about to post
 * something opens a text file first. The most important safety surface in the
 * product was the one surface with no surface.
 *
 * The lines, the states and the sentences all come from beforepost.ts
 * unchanged. This only draws them — and the one thing it must not do is make
 * an `unchecked` line look like a pass.
 *
 * THREE STATES, THREE COLOURS, AND GREY IS NOT GREEN. beforepost.ts's own
 * header says why: a tick beside "Faces" because nothing looked is worse than
 * no checklist at all. An unchecked line gets a grey dot and says plainly
 * that nothing in Aldershot checks it yet.
 */
import { ACCENT, C, FONT, RADIUS, SIZE } from "../tokens.ts";
import type { Line } from "../../beforepost.ts";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Green for a pass, gold for something to look at, grey for nothing looked.
 *
 * Deliberately NOT red: nothing on this page is an error, and a red row reads
 * as "you have broken something" when the sentence is "this is worth knowing
 * before it goes out". Gold is the colour this product uses for the system
 * saying something.
 */
const DOT: Record<Line["state"], string> = {
  ok: ACCENT.green,
  attention: ACCENT.gold,
  unchecked: "rgba(236,236,241,0.3)",
};

export interface BeforePostData {
  projectId: string;
  title: string;
  lines: Line[];
}

export function renderBeforePost(d: BeforePostData): string {
  const counts = {
    attention: d.lines.filter((l) => l.state === "attention").length,
    unchecked: d.lines.filter((l) => l.state === "unchecked").length,
  };

  /*
   * THE SUMMARY SAYS BOTH NUMBERS, and keeps them apart.
   *
   * "2 worth a look" and "2 nobody checked" are different sentences and
   * collapsing them into one count is how a checklist starts implying it
   * covered everything. Either can be zero and then it is simply absent.
   */
  const summary = [
    counts.attention ? `${counts.attention} worth a look` : "",
    counts.unchecked ? `${counts.unchecked} nothing checked` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const rows = d.lines
    .map(
      (l) => `<div style="display:flex;gap:12px;align-items:flex-start;padding:13px 15px;border-radius:${RADIUS.card};background:${C.surface}">
      <span style="flex:none;width:7px;height:7px;margin-top:7px;border-radius:50%;background:${DOT[l.state]}"></span>
      <div style="flex:1;min-width:0">
        <div data-content style="font-size:${SIZE.body};font-weight:600">${esc(l.title)}</div>
        <div data-content style="margin-top:4px;font-size:${SIZE.secondary};line-height:1.55;color:${C.ink70};text-wrap:pretty">${esc(l.says)}</div>
        ${
          l.detail.length
            ? `<ul style="margin:7px 0 0;padding-left:16px;font-size:${SIZE.meta};line-height:1.6;color:${C.ink45}">${l.detail
                .map((x) => `<li data-content>${esc(x)}</li>`)
                .join("")}</ul>`
            : ""
        }
      </div>
    </div>`,
    )
    .join("");

  return `<div style="max-width:min(720px,100%)">
    <div style="font-size:${SIZE.pageTitle};font-weight:600;letter-spacing:-0.022em">Before you post</div>
    <div style="margin-top:6px;font-size:${SIZE.body};color:${C.ink45};line-height:1.6;max-width:600px">Seven things worth knowing before this goes out, and a straight answer about the ones nothing here can check.</div>
    ${
      summary
        ? `<div data-content style="margin-top:8px;font-size:${SIZE.meta};font-family:${FONT.mono};color:${C.ink45}">${esc(summary)}</div>`
        : ""
    }

    <div style="margin-top:18px;display:flex;flex-direction:column;gap:6px">${rows}</div>

    <div style="margin-top:18px;display:flex;gap:14px;align-items:center;flex-wrap:wrap">
      <a href="/p/${esc(d.projectId)}/cut" style="font-size:${SIZE.secondary};font-weight:600;padding:9px 18px;border-radius:${RADIUS.button};background:${C.ink};color:#131316;text-decoration:none">Back to the cut</a>
      <!-- The text file is still here, because a checklist you can hand to
           somebody else is worth having. It is no longer the ONLY way to
           read it. -->
      <a href="/api/projects/${esc(d.projectId)}/before-post" style="font-size:${SIZE.meta};color:${C.ink45};text-decoration:none">Take it away as text &nearr;</a>
    </div>
  </div>`;
}
