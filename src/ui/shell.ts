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
import { FONT_CSS } from "./fontfaces.ts";

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

/**
 * The signed-in initial.
 *
 * From the address, because that is the only name this product actually has —
 * it never asks for one. An address with no letter at all falls back to the
 * bullet rather than to somebody else's initial.
 */
function initialFor(email: string | null | undefined): string {
  const c = String(email || "").trim().replace(/[^a-z]/gi, "").charAt(0);
  return c ? c.toUpperCase() : "\u2022";
}

function nav(view: View, shortsCtx: ShortsCtx, email?: string | null): string {
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
        <!-- Hidden until the client finds something unread. It rendered lit
             unconditionally, so every page flashed an alert badge on load —
             including a brand-new account with nothing running. -->
        <span id="navNotifDot" hidden style="position:absolute;top:-2px;right:-3px;width:6px;height:6px;border-radius:50%;background:${ACCENT.gold}"></span>
      </div>
      <a href="/settings" title="${esc(email ?? "")}" style="width:28px;height:28px;border-radius:50%;background:${C.pill};display:flex;align-items:center;justify-content:center;font-size:${SIZE.secondary};color:${C.ink70};cursor:pointer">${initialFor(email)}</a>
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
/* The font belongs on BODY, not on the page wrapper.
   It was on the wrapper div, and everything positioned outside that div —
   the toast host, the palette, the shortcut sheet, the notification panel,
   the clip picker — fell back to the browser's default serif. The owner
   spotted it on a delete toast: "DJI ... deleted / Undo" in Times, under a
   page set entirely in Instrument Sans. */
body{margin:0;background:${C.canvas};font-family:${FONT.ui};color:${C.ink}}
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
/* Palette and notification rows. Same reason as .seg-pill: the client is a
   String.raw template with no access to the tokens, so anything it colours has
   to be a class here or it becomes an invented hex. */
.pal-row{display:flex;align-items:baseline;gap:10px;padding:10px 18px;cursor:pointer;text-decoration:none}
.pal-row[data-active="1"]{background:${C.pill}}
.pal-title{flex:1;min-width:0;font-size:${SIZE.secondary};color:${C.ink};overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pal-sub{flex:none;font-size:${SIZE.meta};font-family:${FONT.mono};color:${C.ink45}}
.pal-note{padding:14px 18px;font-size:${SIZE.meta};color:${C.ink32}}
.pal-note a{color:${ACCENT.cyan}}
.notif-row{display:flex;align-items:center;gap:9px;padding:9px 11px;border-radius:7px;text-decoration:none}
.notif-dot{flex:none;width:6px;height:6px;border-radius:50%}
.notif-dot[data-tone="run"]{background:${ACCENT.gold}}
.notif-dot[data-tone="done"]{background:${ACCENT.green}}
.notif-dot[data-tone="fail"]{background:${ACCENT.red}}
/* The editor's left column.
   Sticky is right on a desktop, where the player sits BESIDE the blocks and
   should stay with whatever you are reading. On a phone the columns stack, so
   sticky pins a full-width video across the top of the screen and leaves a
   sliver of transcript scrolling underneath — the same full-screen editor
   problem, arrived at from a different direction. It scrolls away on narrow
   screens. */
/* The transcript is the point, so it gets the room.
   The aside was up to 400px of a 960px column, and with a thumbnail and an
   always-visible action cluster on every row the words themselves were left
   about 180px — wrapping every three or four words in a product whose whole
   claim is editing by text. */
.editor-aside{flex:0 1 300px;min-width:min(280px,100%);max-width:min(320px,100%);position:sticky;top:88px}
@media (max-width: 760px){ .editor-aside{position:static;max-width:100%} }
/* Export chips. Radio labels, so the selected one is styled by :has() rather
   than by the client setting colours it would have to hardcode. */
.exp-chip{display:flex;flex-direction:column;gap:1px;padding:7px 11px;border-radius:${RADIUS.button};background:${C.pill};cursor:pointer;white-space:nowrap}
.exp-chip:has(input:checked){background:${C.active}}
.exp-chip:has(input:disabled){opacity:.45;cursor:default}
/* Keeping is the default and stays silent; the control offers the action.
   Green-badging all 38 lines shouted the state nobody needed told. */
/* The row's actions.
   The base rule had no background at all, so a pill with no data-kept — which
   is what "Make a short" is — rendered as bare grey text sitting in a row of
   bare grey text. It is the prototype's own action chip: a filled pill that
   lifts on hover. */
.seg-pill{display:inline-block;font-size:${SIZE.secondary};font-weight:500;padding:5px 12px;border-radius:${RADIUS.button};white-space:nowrap;background:${C.pill};color:${C.ink70};transition:background-color .12s ease,color .12s ease}
.seg-pill:hover{background:${C.active};color:${C.ink}}
/* "Cut" stays quiet until you are on its row: 24 loud Cut buttons is a wall,
   and the gesture you reach for most should not be the loudest thing on the
   page. It still reads as a control, which is what was actually wrong. */
.seg-pill[data-kept="1"]{background:transparent;color:${C.ink32}}
.blk:hover .seg-pill[data-kept="1"]{background:${C.pill};color:${C.ink70}}
/* "Make a short" is a secondary gesture on a line you are reading, and one
   per row held about 110px of the text column open at all times. It keeps its
   space so nothing reflows under the cursor, and shows itself on the row you
   are actually on. */
.blk-short{opacity:0;transition:opacity .12s ease}
.blk:hover .blk-short,.blk-short:focus-visible{opacity:1}
.seg-pill[data-kept="0"]{background:${accentBg(ACCENT.green)};color:${ACCENT.green};font-weight:600}
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


/**
 * The three things the nav bar promised and did not do.
 *
 * "Ask for anything", the "?" and the bell were rendered on every page and
 * bound to nothing — and worse, the keyboard handler already caught Cmd-K and
 * "?" and threw them away, so the app had shortcuts and hid them behind a
 * button that did nothing. Four working links and three ornaments is most of
 * why this felt like "a nightmare to use".
 *
 * They live in the shell rather than on a page because their triggers do: the
 * nav is on every surface, so these have to be too.
 *
 * Markup only. The client wires them, and everything starts hidden.
 */
function overlays(): string {
  const scrim = `position:fixed;inset:0;z-index:70;background:rgba(6,6,8,0.62);backdrop-filter:blur(3px)`;
  const panel = `background:#141418;border-radius:${RADIUS.card};box-shadow:0 24px 60px rgba(0,0,0,.5), inset 0 0 0 1px rgba(255,255,255,0.07)`;

  /* The palette. Results are rendered by the client; this is the frame. */
  const palette = `<div id="palette" hidden style="${scrim};display:flex;align-items:flex-start;justify-content:center;padding:12vh 16px 16px">
    <div style="${panel};width:min(560px,100%);overflow:hidden">
      <input id="paletteInput" placeholder="Ask for anything" autocomplete="off" spellcheck="false"
        style="width:100%;box-sizing:border-box;background:transparent;border:none;outline:none;color:${C.ink};font-size:${SIZE.body};padding:16px 18px;font-family:${FONT.ui}"/>
      <div id="paletteResults" style="max-height:min(52vh,420px);overflow-y:auto;border-top:1px solid ${C.hairline}"></div>
    </div>
  </div>`;

  /* The shortcut sheet. These keys ALREADY WORK — G-then-letter and Cmd-Z are
     bound in the client — so this documents behaviour rather than promising
     it. That is the only reason it is allowed to exist. */
  const key = (k: string, what: string) =>
    `<div style="display:flex;align-items:baseline;gap:12px;padding:7px 0">
      <span style="flex:none;min-width:64px;font-family:${FONT.mono};font-size:${SIZE.meta};color:${C.ink}">${k}</span>
      <span data-content style="flex:1;font-size:${SIZE.secondary};color:${C.ink70}">${what}</span>
    </div>`;

  const keys = `<div id="keysheet" hidden style="${scrim};display:flex;align-items:center;justify-content:center;padding:16px">
    <div style="${panel};width:min(420px,100%);padding:20px 22px">
      <div style="font-size:${SIZE.body};font-weight:600">Keyboard</div>
      <div style="margin-top:12px">
        ${key("⌘K", "Ask for anything")}
        ${key("G then H", "Home")}
        ${key("G then P", "Projects")}
        ${key("G then C", "Clipping")}
        ${key("G then F", "Footage")}
        ${key("G then S", "Settings")}
        ${key("⌘Z", "Undo the last change")}
        ${key("?", "This list")}
        ${key("Esc", "Close")}
      </div>
    </div>
  </div>`;

  /* The bell. Its gold dot claimed unread news for months with nothing behind
     it; the client now hides the dot when there is nothing to report. */
  const notif = `<div id="notifpanel" hidden style="position:fixed;inset:0;z-index:70">
    <div data-close style="position:absolute;inset:0"></div>
    <div style="${panel};position:absolute;top:52px;right:max(16px,calc((100vw - ${LAYOUT.width}) / 2));width:min(340px,calc(100vw - 32px));max-height:60vh;overflow-y:auto;padding:6px">
      <div id="notifBody"></div>
    </div>
  </div>`;

  return palette + keys + notif;
}

export interface PageOpts {
  title: string;
  view: View;
  shortsCtx?: ShortsCtx;
  /** Screen label, used by the reference screenshots and the fidelity diff. */
  screenLabel: string;
  /**
   * Who is signed in. The avatar was a hardcoded "C" — the owner's initial, on
   * every account, from the first second of the first page.
   */
  email?: string | null;
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
<style>${FONT_CSS}
${GLOBAL_CSS}</style>
</head>
<body>
<div style="min-height:100vh;background:${C.canvas};color:${C.ink};font-family:${FONT.ui}">
${nav(view, shortsCtx, opts.email)}
<div data-screen-label="${esc(screenLabel)}" style="display:flex;justify-content:center;padding:0 ${LAYOUT.gutter}">
  <div style="width:${LAYOUT.width};padding:${LAYOUT.pagePad}">
${body}
  </div>
</div>
</div>
<div id="toasts" style="position:fixed;left:50%;transform:translateX(-50%);bottom:22px;z-index:60;display:flex;flex-direction:column;gap:8px;align-items:center"></div>
${overlays()}
<script src="/app.js" type="module"></script>
</body>
</html>`;
}
