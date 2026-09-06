/**
 * The app shell — the sticky nav bar and the page wrapper that enforces the
 * 960px width law.
 *
 * Markup here is a direct transcription of the shell in design/Aldershot.dc.html
 * (the `<div style="border-bottom:1px solid rgba(255,255,255,0.05);position:sticky…">`
 * block and its children). Every value is copied, not chosen.
 */

import { C, ACCENT, FONT, LAYOUT, MARK_LEAD, MARK_LEAD_DEFAULT, RADIUS, SIZE, accentBg } from "./tokens.ts";
import { iconBell, iconSearch } from "./icons.ts";

/** The prototype's `view` strings. Routing maps URLs onto these (10-ROUTES-AND-KEYS.md). */
export type View = "home" | "cut" | "essay" | "transcript" | "shorts" | "archive" | "projects" | "settings";

/**
 * Which nav item lights for a given view. Note `shorts` is context-dependent:
 * reached from the nav it lights Clipping, reached as an editor stage it keeps
 * Editor lit. That is `shortsCtx` in the prototype and it is why the editor
 * feels like one place — preserve it.
 */
export type ShortsCtx = "editor" | "nav";
type NavItem = "home" | "editor" | "clipping" | "footage" | null;

export function navItemFor(view: View, shortsCtx: ShortsCtx = "nav"): NavItem {
  switch (view) {
    case "home":
      return "home";
    case "cut":
    case "essay":
    case "transcript":
      return "editor";
    case "shorts":
      return shortsCtx === "editor" ? "editor" : "clipping";
    case "archive":
      return "footage";
    // Projects and Settings deliberately light nothing — the nav holds verbs,
    // and those two are state (01-PRODUCT.md "Nav").
    default:
      return null;
  }
}

export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Nav labels are `#ECECF1` when lit, `rgba(236,236,241,0.45)` otherwise. */
function navColor(active: boolean): string {
  return active ? C.ink : C.ink45;
}

function wordmark(markLead: string): string {
  const bar = (opacity: string) =>
    `<span style="width:5.5px;height:11px;background:${markLead};${opacity}border-radius:2px;transition:background-color .35s ease"></span>`;
  return `<a href="/" data-mark="true" style="display:flex;align-items:baseline;gap:4px;font-weight:600;font-size:${SIZE.wordmark};letter-spacing:-0.01em;cursor:pointer;color:${C.ink}">aldershot<span style="display:inline-flex;align-items:flex-end;gap:2.5px;transform:translateY(-1px)">${bar("")}${bar("opacity:.5;")}${bar("opacity:.22;")}</span></a>`;
}

function nav(view: View, shortsCtx: ShortsCtx): string {
  const lit = navItemFor(view, shortsCtx);
  const markLead = MARK_LEAD[view] || MARK_LEAD_DEFAULT;
  const link = (href: string, label: string, item: NavItem) =>
    `<a href="${href}" style="cursor:pointer;font-weight:500;color:${navColor(lit === item)}">${label}</a>`;

  return `<div style="border-bottom:1px solid rgba(255,255,255,0.05);position:sticky;top:0;background:rgba(16,16,19,0.86);backdrop-filter:blur(14px);z-index:5;padding:0 ${LAYOUT.gutter}"><div style="display:flex;align-items:center;justify-content:space-between;gap:10px 16px;flex-wrap:wrap;width:${LAYOUT.width};margin:0 auto;padding:12px 0">
    ${wordmark(markLead)}
    <div style="display:flex;align-items:center;gap:clamp(14px,2.4vw,26px);font-size:${SIZE.body};flex-wrap:wrap;justify-content:flex-end">
      ${link("/", "Home", "home")}
      ${link("/editor", "Editor", "editor")}
      ${link("/clipping", "Clipping", "clipping")}
      ${link("/footage", "Footage", "footage")}
      <span tabindex="0" role="button" id="navSearch" style="display:flex;align-items:center;gap:7px;cursor:pointer;padding:5px 8px;border-radius:6px;background:${C.surface}">
        ${iconSearch({ size: 14, stroke: "rgba(236,236,241,0.5)" })}
        <span style="font-size:${SIZE.meta};color:rgba(236,236,241,0.4)">Ask for anything</span>
      </span>
      <span tabindex="0" role="button" id="navKeys" style="font-size:11.5px;font-family:${FONT.mono};color:rgba(236,236,241,0.28);cursor:pointer">?</span>
      <div tabindex="0" role="button" id="navNotif" style="position:relative;cursor:pointer">
        ${iconBell({ size: 15, stroke: "rgba(236,236,241,0.5)" })}
        <span style="position:absolute;top:-2px;right:-3px;width:6px;height:6px;border-radius:50%;background:${ACCENT.gold}"></span>
      </div>
      <a href="/settings" style="width:28px;height:28px;border-radius:50%;background:${C.pill};display:flex;align-items:center;justify-content:center;font-size:${SIZE.secondary};color:${C.ink70};cursor:pointer">C</a>
    </div>
  </div>
  </div>`;
}

/**
 * Global CSS — transcribed from the prototype's `<helmet><style>` block.
 * Kept as a single constant so scripts/check-fidelity.sh can diff it.
 */
const GLOBAL_CSS = `
/* Border-box everywhere.
   The prototype never needed this because it sizes with flex rather than
   percentages, but the app does use width:100% on padded rows — and under the
   default content-box that adds the padding ON TOP of the 100%, pushing the
   row past its parent. That is what made the editor scroll sideways on a
   phone: a 361px column holding a 393px row. The landing page always had this
   rule in its own <style>; the app shell did not, which is exactly the kind of
   difference that only shows up on a narrow screen. */
*,*::before,*::after{box-sizing:border-box}
body{margin:0;background:${C.canvas}}
/* Nothing may push the page sideways. A horizontal scrollbar on a phone is
   never intentional here, and it hides content off the left edge rather than
   merely looking untidy.
   Both values on purpose: "hidden" still creates a scroll container, which
   iOS Safari will sometimes let you drag even with nothing overflowing.
   "clip" is not scrollable at all, and browsers that do not know it ignore the
   second declaration and keep the first.
   (No backticks in this constant -- it is inside a template literal.) */
html,body{overflow-x:hidden;overflow-x:clip}
a{color:${C.ink};text-decoration:none}
a:hover{color:#fff}
::placeholder{color:${C.ink32}}
input,textarea,select{font-family:${FONT.ui}}
*:focus-visible{outline:2px solid ${ACCENT.cyan};outline-offset:2px;border-radius:5px}
[role="button"]{-webkit-tap-highlight-color:transparent;transition:background-color .12s ease, color .12s ease, transform .1s ease, box-shadow .15s ease}
[role="button"]:active{transform:scale(.985)}
a{transition:color .12s ease}
p,div{text-wrap:pretty}
/* The hidden attribute must beat the inline display values this design uses
   throughout, or every toggled element renders on first paint. */
[hidden]{display:none!important}
[data-screen-label]{animation:viewIn .26s cubic-bezier(.2,.7,.3,1) both}
@media (max-width: 720px){ [data-screen-label]{padding-left:16px!important;padding-right:16px!important} }
/* The nav on a phone.
   Wordmark, four surfaces, a search field, a "?" and two icons will not sit on
   one 393px row, so it wrapped into three stacked lines and ate a third of the
   screen before any content. The two that go are the two a phone does not
   want: the search field opens a palette driven by a keyboard shortcut, and
   "?" opens the shortcut list itself. Everything you navigate with stays. */
@media (max-width: 640px){
  #navSearch,#navKeys{display:none!important}
}
/* The keep/drop pill on an unassisted cut.
   It lives here rather than inline because the client toggles it, and the
   client is a String.raw template with no access to the tokens — so JS setting
   colours meant hardcoded hexes, which check-fidelity rightly rejected. JS
   flips one attribute; the colours stay tokens. */
.seg-pill{display:inline-block;font-size:${SIZE.secondary};padding:5px 11px;border-radius:${RADIUS.button};white-space:nowrap}
.seg-pill[data-kept="1"]{background:${accentBg(ACCENT.green)};color:${ACCENT.green};font-weight:600}
.seg-pill[data-kept="0"]{background:${C.pill};color:${C.ink70};font-weight:500}
@keyframes blip{0%,100%{opacity:.35}50%{opacity:1}}
@keyframes viewIn{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:none}}
@keyframes popIn{from{opacity:0;transform:translateX(-50%) scale(.98)}to{opacity:1;transform:translateX(-50%) scale(1)}}
@keyframes panelIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
[data-mark]:hover span span{animation:markRead .9s ease infinite}
[data-mark]:hover span span:nth-child(2){animation-delay:.12s}
[data-mark]:hover span span:nth-child(3){animation-delay:.24s}
@keyframes markRead{0%,100%{filter:brightness(1)}45%{filter:brightness(1.9)}}
@media (prefers-reduced-motion: reduce){*{animation-duration:.01ms!important;transition-duration:.01ms!important}}
::selection{background:rgba(217,179,106,0.3)}
html{scrollbar-gutter:stable}
*{scrollbar-width:thin;scrollbar-color:#2A2A31 transparent}
::-webkit-scrollbar{width:9px;height:9px}
::-webkit-scrollbar-thumb{background:#2A2A31;border-radius:99px;border:2px solid ${C.canvas}}
::-webkit-scrollbar-track{background:transparent}
`.trim();

export interface PageOpts {
  title: string;
  view: View;
  shortsCtx?: ShortsCtx;
  /** Screen label, used by the reference screenshots and the fidelity diff. */
  screenLabel: string;
}

/**
 * Wraps a surface's body in the shell. `body` is placed inside the 960px
 * column — a page must never set its own width (LAYOUT law, 02-DESIGN-SYSTEM).
 */
export function page(opts: PageOpts, body: string): string {
  const { title, view, shortsCtx = "nav", screenLabel } = opts;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>${GLOBAL_CSS}</style>
</head>
<body>
<div style="min-height:100vh;background:${C.canvas};color:${C.ink};font-family:${FONT.ui}">
${nav(view, shortsCtx)}
<div data-screen-label="${esc(screenLabel)}" style="display:flex;justify-content:center;padding:0 ${LAYOUT.gutter}">
  <div style="width:${LAYOUT.width};padding:${LAYOUT.pagePad}">
${body}
  </div>
</div>
</div>
<div id="toasts" style="position:fixed;left:50%;transform:translateX(-50%);bottom:22px;z-index:60;display:flex;flex-direction:column;gap:8px;align-items:center"></div>
<script src="/app.js" type="module"></script>
</body>
</html>`;
}
