/**
 * The app shell — the sticky nav bar and the page wrapper that enforces the
 * 960px width law.
 *
 * Markup here is a direct transcription of the shell in design/Aldershot.dc.html
 * (the `<div style="border-bottom:1px solid rgba(255,255,255,0.05);position:sticky…">`
 * block and its children). Every value is copied, not chosen.
 */

import { C, ACCENT, FONT, LAYOUT, MARK_LEAD, MARK_LEAD_DEFAULT, HOVER, RADIUS, SIZE, accentBg } from "./tokens.ts";
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
type NavItem = "home" | "editor" | "footage" | null;

export function navItemFor(view: View, shortsCtx: ShortsCtx = "nav"): NavItem {
  switch (view) {
    case "home":
      return "home";
    case "cut":
    case "essay":
    case "transcript":
      return "editor";
    case "shorts":
      return "editor";
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
/* ── The editor: a document, and an assistant ──────────────────────────────
   The page used to be a 300px rail of six unrelated controls beside whatever
   space the transcript had left. It is two things now, and each is one thing:
   the words on the left, and on the right the video, the conversation about
   it, and a box to type in.

   The assistant is a full-height column so the composer can sit at its foot
   the way every chat does — that shape is why nobody has to be told what it
   is, which was the whole problem with the search-looking field it replaces.
   Bounded by what is visible (the nav above, the export bar below) and the
   CONVERSATION is the part that scrolls, which is correct: a transcript of
   what you asked is supposed to grow. */
.editor-doc{flex:1 1 520px;min-width:min(320px,100%)}
.asst{flex:0 1 320px;min-width:min(280px,100%);max-width:min(340px,100%);
  /* Sized so the composer clears the export bar in BOTH scroll states. A
     sticky top only applies once the page has scrolled: before that the
     column starts below the page header, so a height measured from the nav
     alone runs the composer straight under the bar. This is measured from the
     header instead, and check-editor.cjs asserts the two never overlap. */
  position:sticky;top:88px;height:calc(100vh - 240px);min-height:360px;
  display:flex;flex-direction:column;overflow:hidden}
.asst-top{flex:none}
/* The newest turn sits nearest the box you typed it into, the way every
   conversation does — and it means one opening line does not float in the
   middle of a column of nothing. */
.asst-talk{justify-content:flex-end}
/* On a narrow screen the columns stack, and a column pinned to the viewport
   height in a stack is a scroll trap. It becomes an ordinary block. */
@media (max-width: 860px){
  .asst{position:static;max-width:100%;height:auto}
  .asst-talk{max-height:340px}
}
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
/* QUIET-UNTIL-HOVER IS A POINTER IDEA, so it is behind a pointer query.
   "Cut" stays quiet until you are on its row: 24 loud Cut buttons is a wall,
   and the gesture you reach for most should not be the loudest thing on the
   page. "Make a short" is secondary on a line you are reading, and one per
   row held about 110px of the text column open at all times, so it keeps its
   space and shows itself on the row you are actually on.

   Both were unconditional, and a touch screen has no hover at all — so on a
   phone or an iPad the two main verbs on every block were invisible and
   there was no gesture that could reveal them. On a product whose output is
   vertical shorts, that is not a detail. Where there is no hover to wait
   for, they are simply shown. */
@media (hover: hover) {
  .seg-pill[data-kept="1"]{background:transparent;color:${C.ink32}}
  .blk:hover .seg-pill[data-kept="1"]{background:${C.pill};color:${C.ink70}}
  .blk-short{opacity:0;transition:opacity .12s ease}
  .blk:hover .blk-short,.blk-short:focus-visible{opacity:1}
}
.seg-pill[data-kept="0"]{background:${accentBg(ACCENT.green)};color:${ACCENT.green};font-weight:600}
/* ── The hover layer ───────────────────────────────────────────────────────
   The prototype specifies 161 hover and focus states. The build had 14, and
   not by choice: this product is server-rendered INLINE styles, and inline
   styles cannot express :hover. So they had nowhere to live, and the whole
   thing sat inert under the cursor — most of why it read as less finished
   than the design it was built from.

   Selected on the inline value an element ALREADY HAS: background:#232329 is
   what C.pill renders to, so [style*=…] finds every pill in the product
   without a single markup change, and a control gets the prototype's
   hover for whatever surface it happens to be. !important because inline
   beats a stylesheet rule whatever its specificity — which is precisely the
   case the keyword exists for, and it is confined to :hover and :active here.

   Six rules, which is why the product feels like one thing. Every value is
   the prototype's own, counted from it: see HOVER in tokens.ts. */

/* A pill or chip lifts. The commonest rule in the design, 78 times. */
:is(button,a,label,[role=button])[style*="background:${C.pill}"]:hover:not(:disabled){background:${HOVER.pill}!important;color:${C.ink}!important}
/* The one primary button on a page, at its brightest. */
:is(button,a,[role=button])[style*="background:${C.ink}"]:hover:not(:disabled){background:${HOVER.primary}!important}
/* A card or row, barely — you should feel it more than see it. */
:is(a,button,[role=button])[style*="background:${C.surface}"]:hover:not(:disabled),
[data-item-row]:hover > :is(a,button)[style*="background:${C.surface}"]{background:${HOVER.surface}!important}
:is(a,button,[role=button])[style*="background:${C.raised}"]:hover:not(:disabled){background:${HOVER.surface}!important}
/* #141418 is the prototype's panel surface — twenty uses and never named,
   because it is a backdrop everywhere except the drop zone, which is a click
   target and was the one control on Clipping that stayed dead under the
   cursor. Left as a literal rather than promoted to a token nobody would
   use. */
:is(a,button,label,[role=button])[style*="background:#141418"]:hover:not(:disabled){background:${HOVER.surface}!important}

/* Dim text goes to full ink. 65 times in the prototype, and the reason a
   quiet link feels like a link at all. Matched on the alpha rather than on
   the three named steps: the pages also use 0.3, 0.4, 0.42 and 0.55 directly,
   and a back link that stays grey under the cursor is the one that reads as
   broken. */
:is(a,button)[style*="color:rgba(236,236,241,0."]:hover:not(:disabled){color:${C.ink}!important}

/* A control with no surface of its own — a player button, a block's arrows,
   the seam, the wordmark's neighbours in the nav. It has nothing to lift, so
   it grows one. */
:is(button,[role=button])[style*="background:transparent"]:hover:not(:disabled){background:${C.pill}!important}

/* A CARD. No background, no border — just a poster and a title, so there is
   nothing for the rules above to catch, and the largest click targets in the
   product were the deadest. The ring around the still brightens and the
   still itself leans in a little. */
[data-item-row]:hover img,[data-item-row]:hover canvas{transform:scale(1.025)}
[data-item-row] img,[data-item-row] canvas{transition:transform .22s ease}
[data-item-row]:hover [style*="inset 0 0 0 1px"]{box-shadow:inset 0 0 0 1px rgba(255,255,255,0.14)!important}
[data-item-row]{transition:opacity .13s ease}

/* Gold means your voice, progress, attention — brightened, never recoloured.
   Both ways round: gold text, and the one gold button in the product ("Record
   it"), which is the most important control on a block and was inert. */
:is(button,a)[style*="color:${ACCENT.gold}"]:hover:not(:disabled){color:${HOVER.gold}!important}
:is(button,a)[style*="background:${ACCENT.gold}"]:hover:not(:disabled){background:${HOVER.gold}!important}

/* The nav's quiet three — the key sheet, the bell, the avatar. Icons and a
   glyph with no surface, sitting next to four links that all light up. */
#navKeys:hover{color:${C.ink}!important}
/* The bell is an icon in a bare div — nothing to recolour but the stroke,
   and a target you have to hit exactly. It gets a surface to aim at. */
#navNotif{padding:4px;margin:-4px;border-radius:${RADIUS.button};transition:background-color .13s ease}
#navNotif:hover{background:${C.pill}}
#navNotif:hover svg{stroke:${C.ink}}
/* The wordmark already answers — [data-mark]:hover animates its three bars,
   further down. It reads as inert to a probe that watches background and
   colour, which is a limit of the probe and not of the design. */

/* A still with a play badge over it: the block rows in the editor, and the
   poster well on a card. The same lean as [data-item-row], because it is the
   same gesture. */
.blk-play canvas,.blk-play{transition:transform .22s ease,box-shadow .13s ease}
.blk-play:hover canvas{transform:scale(1.04)}
.blk-play:hover{box-shadow:inset 0 0 0 1px rgba(255,255,255,0.16)!important}
/* Delete, remove, sign out. The only place a hover changes the hue. */
:is(button,a)[data-danger]:hover{color:${HOVER.danger}!important;background:${accentBg(ACCENT.red)}!important}

/* Everything that reacts, reacts at the same speed. */
button,a,label,[role=button],.chip,.seg-pill{transition:background-color .13s ease,color .13s ease,opacity .13s ease,border-color .13s ease}
/* A press should be felt. Nothing sets transform inline, so no !important. */
:is(button,[role=button]):active:not(:disabled){transform:translateY(0.5px)}

/* Keyboard focus, which the build had nowhere at all. Not :focus — a mouse
   press must not leave a ring behind it. */
:is(button,a,input,textarea,select,label,[role=button],[tabindex]):focus-visible{
  outline:2px solid ${ACCENT.gold};outline-offset:2px;border-radius:${RADIUS.button}}
/* A disabled control should look unavailable, not broken. */
:is(button,[role=button]):disabled{cursor:default}

/* SELECTION, out of the way until you want it.
   A native checkbox sat on every poster at all times — the loudest thing on
   Footage, in front of the still it was covering, on a page whose subject is
   the stills. It follows the rule .blk-short already uses for the same
   problem: it keeps its space so nothing reflows under the cursor, and shows
   itself on the card you are actually on. Anything already ticked stays
   visible, or a selection you had made would vanish as you moved away. */
.sel-box{opacity:0;transition:opacity .13s ease}
[data-item-row]:hover .sel-box,.sel-box:focus-within,.sel-box:has(:checked){opacity:1}
/* While a selection is live, every box is out — you are picking now, and
   hunting for the next one card at a time is the wrong gesture. */
body:has(.sel-item:checked) .sel-box{opacity:1}

/* A heading should not leave one word alone on a second line. The pages set
   their own sizes and weights inline; this is the one thing about a headline
   that cannot be expressed there and is wrong everywhere without it. */
[data-screen-label] [style*="font-size:24px"],[data-screen-label] [style*="font-size:17px"]{text-wrap:balance}

/* A poster arriving should not snap into place. */
img{opacity:1;animation:imgIn .22s ease}
@keyframes imgIn{from{opacity:0}to{opacity:1}}

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
function overlays(editing: boolean): string {
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
        ${key("G then F", "Footage")}
        ${key("G then S", "Settings")}
        ${key("⌘Z", "Undo the last change")}
        ${key("?", "This list")}
        ${key("Esc", "Close")}
      </div>
      ${
        /*
         * The editor's keys, only where the editor is.
         *
         * Whether they work is decided by one thing in the client — whether
         * #cut-video is on the page — so that is what decides whether they
         * are listed, rather than a flag each new route has to remember to
         * set. A sheet promising keys you do not have is the same bug as a
         * button that does nothing.
         */
        editing
          ? `<div style="margin-top:16px;padding-top:14px;border-top:1px solid ${C.hairline}">
              <div data-content style="font-size:${SIZE.secondary};font-weight:600;color:${C.ink45}">In the editor</div>
              <div style="margin-top:6px">
                ${key("Space", "Play or pause")}
                ${key("← →", "Five seconds")}
                ${key("J K L", "Back, stop, faster")}
                ${key("⌫", "Cut what you've selected")}
                ${key("⌘F", "Find a word in this cut")}
              </div>
            </div>`
          : ""
      }
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
<link rel="icon" type="image/svg+xml" href="/favicon.svg"/>
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
${overlays(body.includes('id="cut-video"'))}
<script src="/app.js" type="module"></script>
</body>
</html>`;
}
