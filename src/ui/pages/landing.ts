/**
 * The signed-out site, transcribed from design/Landing.dc.html.
 *
 * `/` is this page when nobody is signed in and Home when they are
 * (10-ROUTES-AND-KEYS.md), so a shared link works for both.
 *
 * It renders as a full document rather than through the app shell: the shell's
 * nav assumes a signed-in user, and the landing site has its own — anchors
 * plus a sign-in form, not four surfaces.
 *
 * Every CTA in the prototype points at the app. Here they point at the sign-in
 * field instead, because reaching the app requires a link in your inbox.
 */

import { esc, noDevNotes } from "../shell.ts";
import { FONT_CSS } from "../fontfaces.ts";
import { iconSearch } from "../icons.ts";
import { PLANS } from "../../plans.ts";

const GOLD = "#D9B36A";
const GREEN = "#5EC98F";
const CYAN = "#5EB8C9";
const RED = "#E06A6A";
const VIOLET = "#B08CD4";
const MONO = "'IBM Plex Mono',monospace";

const PAD = "padding:0 clamp(24px,5vw,40px)";
const WRAP = "max-width:1080px;margin:0 auto";
const EYEBROW = `font-size:11px;font-weight:600;letter-spacing:.08em;font-family:${MONO}`;

interface Job {
  name: string;
  color: string;
  body: string;
  example: string;
}

/*
 * THE SIX THINGS, in the current design's words and colours.
 *
 * "Clips" WAS A MODE THAT DOES NOT EXIST. The room offers Cut, Shorts,
 * Essay and React, and Story and Supercut under "as your archive grows";
 * the landing offered Clips, Cuts, Reactions and Essays — so the public
 * page named something you cannot make, omitted the one the whole Shorts
 * workbench was built for, and omitted two the room puts on screen. Its
 * body also said moments come back "scored", which is invariant 3 said out
 * loud on the only page a stranger reads.
 */
const JOBS: Job[] = [
  {
    name: "Cuts",
    color: GREEN,
    body: "Three hours becomes four minutes, by rules you can read. It cuts first and says exactly what went; you fix anything by changing a rule or striking a line.",
    example: "tighten this down to the argument — lose the procedure",
  },
  {
    name: "Shorts",
    color: CYAN,
    body: "Moments that stand on their own, ranked with a reason — Strong, Worth a look, Long shot — never a score. Paste a client brief and it compiles into rules.",
    example: "six shorts, hooks in the first two seconds, nothing about money",
  },
  {
    name: "Reactions",
    color: RED,
    body: "It finds what's worth answering in someone else's video and leaves a slot for you after each one. Clip and reaction stay together.",
    example: "react to the big claims — leave me room after each",
  },
  {
    name: "Essays",
    color: VIOLET,
    body: "Built beat by beat from what you've kept: an outline, the moments that back each point, your voice between them, the sources on screen when you quote them.",
    example: "an essay on why every city ripped out its trams",
  },
  {
    name: "Stories",
    color: "#ECECF1",
    body: "What happened, in order. Organised by time instead of by claim — the stakes before the turn, the day on screen at each change. The more dated footage you keep, the more it can tell.",
    example: "the story of the move, as it happened",
  },
  {
    name: "Supercuts",
    color: "#ECECF1",
    body: "Every time he says it, strung together. Searched by what was said, not by what you named the file — the archive turned straight into a video, with a count on screen.",
    example: "every time he blames chat",
  },
];

/**
 * THE WORKED EXAMPLE: eight moments of a council meeting.
 *
 * `dur` is seconds, and it is what makes the cap rule mean anything: a cap
 * that drops moments has to drop the longest ones, so the lengths are the
 * only reason the demo can show arithmetic rather than assert it.
 */
interface DemoMoment {
  tc: string;
  dur: number;
  text: string;
  tag: string;
}

const DEMO: DemoMoment[] = [
  { tc: "0:00", dur: 140, text: "Good evening. Item one, apologies for absence. Item two, declarations of interest.", tag: "procedure" },
  { tc: "18:40", dur: 58, text: "Forty-two units, of which twelve would be affordable. That's 28 per cent against a policy requirement of 35.", tag: "claim" },
  { tc: "31:12", dur: 72, text: "The light study was done in June. Come and stand in my kitchen in December.", tag: "public" },
  { tc: "44:05", dur: 49, text: "At 35 per cent affordable the scheme does not come forward. That isn't a threat, it's arithmetic.", tag: "claim" },
  { tc: "1:04:10", dur: 64, text: "We've approved four schemes on the promise of affordable units that were renegotiated away within a year.", tag: "strong" },
  { tc: "1:40:00", dur: 600, text: "[recess — ten minutes, camera running]", tag: "procedure" },
  { tc: "2:11:30", dur: 55, text: "We're being asked to choose between twelve affordable homes and no homes. I don't accept those are the only options.", tag: "strong" },
  { tc: "2:38:15", dur: 90, text: "Those in favour. Six. Against. Five. The application is approved.", tag: "vote" },
];

/**
 * FOUR RULES, AND THE FOUR KINDS THE ENGINE HAS.
 *
 * `drop` takes a thread out, `keep` protects one from everything else,
 * `keepOne` fixes the last word, `cap` is a length the cut has to fit. The
 * order matters and is the resolver's, not the list's: dropping happens
 * first, the cap runs last and may not touch anything protected.
 */
interface DemoRule {
  n: string;
  text: string;
  kind: "drop" | "keep" | "keepOne" | "cap";
  tag?: string;
  secs?: number;
  /** What this rule is doing, given how many moments carry its thread. */
  effectOn: (n: number) => string;
}

const DEMO_RULES: DemoRule[] = [
  {
    n: "01",
    kind: "drop",
    tag: "procedure",
    text: "Take out the procedure — apologies, item numbers, the recess.",
    effectOn: (n) => "takes out " + n + " — including the ten-minute recess",
  },
  {
    n: "02",
    kind: "keep",
    tag: "claim",
    text: "Keep every claim about the numbers, and who made it.",
    effectOn: (n) => "protects " + n + " — a cap can't touch them",
  },
  {
    n: "03",
    kind: "keepOne",
    tag: "vote",
    text: "End on the vote.",
    effectOn: () => "the last word is 2:38:15",
  },
  {
    n: "04",
    kind: "cap",
    secs: 240,
    text: "Keep it under four minutes.",
    effectOn: () => "drops the longest unprotected moments until it fits",
  },
];

/** mm:ss, the way the room writes a runtime. */
function demoFmt(n: number): string {
  return Math.floor(n / 60) + ":" + String(Math.round(n) % 60).padStart(2, "0");
}

export interface DemoState {
  /** Why each moment is out, in DEMO order, or null if it is in the cut. */
  out: Array<string | null>;
  /** The runtime of what is left. */
  secs: number;
}

/**
 * THE CUT, DERIVED FROM THE RULES THAT ARE ON. This is invariant 1 in
 * fourteen lines, and it is the reason this section is not a screenshot.
 *
 * `off` is a bitmask over DEMO_RULES: bit i set means rule i is switched
 * off. Every one of the sixteen combinations is resolved on the server and
 * shipped with the page, so clicking a rule does not recompute anything in
 * the browser — it picks the cut the rules already produce. The logic exists
 * once, in TypeScript, and test/landing.test.ts holds it to the arithmetic.
 */
/*
 * A note on how this reaches the browser, since the page cannot say it.
 *
 * The sixteen cuts are serialised into a JSON script tag at the bottom of
 * the page and a short script swaps between them on a click. It is not a
 * rule engine in the browser: every cut was resolved here. Without the
 * script the section still renders the all-on cut and reads correctly,
 * which is why the initial state is written into the HTML rather than
 * painted on load.
 *
 * That script carries no backticks, and neither does any comment near it.
 * The page is one template literal; a backtick ends it and an HTML comment
 * inside it ships to the browser. Both have happened here — including
 * twice while writing this very section, in comments warning about it.
 */
export function resolveDemo(off: number): DemoState {
  const on = DEMO_RULES.filter((_, i) => !(off & (1 << i)));
  const drop = on.find((r) => r.kind === "drop");
  const keep = on.find((r) => r.kind === "keep");
  const vote = on.find((r) => r.kind === "keepOne");
  const cap = on.find((r) => r.kind === "cap");

  const out: Array<string | null> = DEMO.map((m) =>
    drop && m.tag === drop.tag ? "rule " + drop.n : null,
  );
  let secs = DEMO.reduce((n, m, i) => (out[i] ? n : n + m.dur), 0);

  if (cap && cap.secs !== undefined && secs > cap.secs) {
    /* The longest first, and never anything a keep rule is holding. A cap
       that could overrule a keep rule would make "protects 2 — a cap can't
       touch them" false, which is the one sentence this demo exists to
       show. */
    const victims = DEMO.map((m, i) => ({ m, i }))
      .filter(
        ({ m, i }) =>
          !out[i] && !(keep && m.tag === keep.tag) && !(vote && m.tag === vote.tag),
      )
      .sort((a, b) => b.m.dur - a.m.dur);
    for (const v of victims) {
      if (secs <= cap.secs) break;
      out[v.i] = "over the cap";
      secs -= v.m.dur;
    }
  }

  return { out, secs };
}

const HITS = [
  { src: "K", bg: "rgba(94,201,143,0.2)", color: GREEN, text: "“Fine — yes, we moved the launch before the review came in.”", why: "Keynote · 31:40 · an admission, said plainly" },
  { src: "P", bg: "rgba(94,184,201,0.2)", color: CYAN, text: "“The roadmap slide was aspirational. Very aspirational.”", why: "Podcast 141 · 18:12 · the plan, walked back" },
  { src: "Q", bg: "rgba(176,140,212,0.2)", color: VIOLET, text: "“We script the ‘unscripted’ Q&A. Everyone does.”", why: "Q&A stream · 1:02:30 · the same move, confessed" },
];

const CHECKS = [
  { dot: GOLD, text: "Two clips are someone else's footage — 48s and 55s, with their original audio.", fix: "Attribute at first use (Recommended)", fixBg: "rgba(236,236,241,0.14)", fixColor: "#ECECF1" },
  { dot: GOLD, text: "Music under 11:48–19:30 — the car radio. Platforms tend to claim it.", fix: "Duck it (Recommended)", fixBg: "rgba(236,236,241,0.14)", fixColor: "#ECECF1" },
  { dot: GREEN, text: "Nothing generated. Every frame is footage someone shot.", fix: "Nothing to do", fixBg: "#1F1F26", fixColor: "rgba(236,236,241,0.55)" },
  { dot: GREEN, text: "A provenance record goes on the export — every source, every edit.", fix: "Always on", fixBg: "#1F1F26", fixColor: "rgba(236,236,241,0.55)" },
];

/*
 * THE NUMBERS COME FROM PLANS, which is also what checkCap refuses on.
 *
 * The design's Studio bullet says "7 footage-hours a month" and the code
 * grants 1,200 source minutes, which is twenty. A pricing table that
 * disagrees with the meter is the one divergence on this page that costs
 * somebody money, so the code wins and the design's phrasing is kept.
 */
const FREE_FEATS = [
  PLANS.free.sourceMinutes + " processing minutes a month",
  PLANS.free.storageGb + " GB of permanent storage",
  "Cuts, shorts, reactions, essays — all of it",
  "Rules, the archive, and search by what was said",
];

/*
 * THREE BULLETS, BECAUSE THREE IS WHAT STUDIO ACTUALLY BUYS YOU.
 *
 * The design lists five and the build listed five, and two of them were not
 * true. "Overnight queue — it works while you sleep": nothing in the
 * codebase ever sets a job's overnight flag, the column has never held a 1,
 * and editor-intake.ts deliberately omits the button for exactly that
 * reason — so it was a paid-plan differentiator for a feature that does not
 * exist. "Bring your own storage bucket": built last week, and not gated by
 * plan at all, so listing it here told free accounts they could not do
 * something they can.
 *
 * The honest list is short, and a short true list is the point: the whole
 * pitch above is that you pay for the minutes it reads. Inventing
 * differentiators to fill the column out is how a pricing table becomes a
 * lie, and the `claims` fidelity rule now fails on both of these.
 */
const PRO_FEATS = [
  Math.round(PLANS.pro.sourceMinutes / 60) + " footage-hours a month — read once, edit free",
  PLANS.pro.storageGb + " GB of permanent storage",
  "4K renders",
];

/*
 * THE DESIGN'S SIX QUESTIONS, minus the promises this build does not keep.
 *
 * Two answers were cut to what is true. "Save a set as a recipe and the
 * next video starts from it" — rules are project-scoped and nothing carries
 * them anywhere; the design promises recipes three times and no code has
 * ever had them. "Set a webhook and every finished piece POSTs to it" — the
 * only webhook in this codebase is Stripe's, inbound. The `claims` fidelity
 * rule now fails on either of them, which is how they were found: `strings`
 * compares this page to the design, and the design says both.
 */
const FAQ = [
  {
    q: "Do I need to know how to edit?",
    a: "If you can say what you want, you can cut. There's no timeline to learn: one room shows the rules on the left, the cut they produce in the middle, and the player on the right. The first pass is already done when you arrive; you change a rule, strike a line, or record a take.",
  },
  {
    q: "What's a rule, exactly?",
    a: "A plain sentence the system turns into an instruction it can show you the effect of — “take out the hellos”, “keep every definition in full”, “under four minutes”. Switch one off and the cut updates and tells you what that rule was doing.",
  },
  {
    q: "Whose footage can I use?",
    a: "Yours, and anything you have the right to work with — your recordings, streams, podcasts, or material you're commenting on within fair use. Before you post, it flags third-party clips, music and faces, each with a fix. What you upload is yours; we never train on it.",
  },
  {
    q: "What's a processing minute?",
    a: "A minute spent reading footage into moments, or rendering a finished piece. A one-hour video costs roughly its length to read, once. After that, cutting, re-cutting, shorts and search from it are free.",
  },
  {
    q: "What happens to my footage?",
    a: "Nothing expires, ever. Every moment it reads stays in your archive, searchable by what was said. Left-out moments are kept with the rule that removed them. Deleted items wait thirty days. You can also point sources at a bucket you own.",
  },
  {
    q: "Can it post for me?",
    a: "No, and it doesn't pretend to: you download the finished file, or export the edit to Resolve, Premiere or Final Cut and take it from there. Every export carries a provenance record, and a cut can have a public link that lists every source and every edit it used.",
  },
];

/** The wordmark: three bars at falling opacity, the same mark the app uses. */
function mark(size: number, gold = GOLD): string {
  const bar = (o: number) =>
    `<span style="width:${size === 15.5 ? 5.5 : 4.5}px;height:${size === 15.5 ? 11 : 10}px;background:${gold};opacity:${o};border-radius:2px"></span>`;
  return `<span style="display:inline-flex;align-items:flex-end;gap:${size === 15.5 ? 2.5 : 2}px;transform:translateY(-1px)">${bar(1)}${bar(0.5)}${bar(0.22)}</span>`;
}

/**
 * THE LINE UNDER THE BOX, in its two forms.
 *
 * Named here rather than written inline twice, because they are a pair and the
 * whole point is that they are opposites: whichever page you are on, the box
 * does both jobs, and the sentence tells you about the job you did not come
 * for.
 */
const BOTH_WAYS = "Already have an account? Same box — we email you a link.";
const EITHER_WAY = "No account yet? The same link makes one.";

/**
 * The sign-in form. Every CTA on the page targets it.
 *
 * It posts rather than opening the app, because there is no app to open until
 * a link has been followed — a "Start free" button that 302s to a login page
 * would be the same click with an extra step.
 */
function signInForm(
  id: string,
  buttonLabel: string,
  primary: boolean,
  google: boolean,
  /*
   * THE LINE UNDER THE BOX, which is not the same sentence everywhere.
   *
   * On the landing page the button says "Start free" and the box is also the
   * only way back, so it has to say so. On /signin that sentence answers a
   * question nobody asked — they are already on the page about coming back —
   * and the useful line is the opposite one.
   */
  aside: string,
  /*
   * WHICH OF OUR TWO PAGES THIS FORM IS ON.
   *
   * /auth/start sends every outcome back to it, so a failure is explained
   * where it happened rather than on the marketing page. Unrecognised values
   * fall back to "/" server-side, so this cannot redirect anyone off-site.
   */
  from = "",
): string {
  /*
   * Google leads. Most people editing footage for YouTube already have the
   * account, it needs no mail provider, and it cannot be lost to a spam
   * folder. The email link sits under it for anyone who would rather not.
   */
  const googleButton = google
    /*
     * Text only, no mark. A four-colour circle standing in for Google's logo
     * is an approximation of somebody else's trademark — the same class of
     * substitution this codebase refuses everywhere else, and the fidelity
     * check flagged its invented hexes immediately. Google's own guidelines
     * require their real asset or nothing; nothing is the honest option.
     */
    ? `<a href="/auth/google" style="display:inline-flex;align-items:center;justify-content:center;font-size:14.5px;font-weight:600;padding:12px 26px;border-radius:5px;background:#ECECF1;color:#131316;white-space:nowrap">Continue with Google</a>
      <div style="font-size:12px;color:rgba(236,236,241,0.3);margin:14px 0 10px">or use your email</div>`
    : "";

  return `<div style="display:flex;flex-direction:column;align-items:center">
    ${googleButton}
    <form method="post" action="/auth/start" id="${id}" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center">
      ${from ? `<input type="hidden" name="from" value="${esc(from)}"/>` : ""}
      <input name="email" type="email" required placeholder="you@example.com" aria-label="Your email" style="flex:0 1 260px;min-width:min(220px,100%);background:#1A1A1F;border:none;outline:none;color:#ECECF1;font-size:14px;padding:12px 14px;border-radius:5px;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.08);font-family:inherit"/>
      <button type="submit" style="flex:none;font-size:14.5px;font-weight:600;padding:12px 26px;border-radius:5px;background:${primary && !google ? "#ECECF1" : "#232329"};color:${primary && !google ? "#131316" : "#ECECF1"};white-space:nowrap;border:none;cursor:pointer;font-family:inherit">${google ? "Email me a link" : buttonLabel}</button>
    </form>
    <!--
      AND THE SAME BOX IS HOW YOU COME BACK.
      The button says "Start free", which is true for a new account and
      actively misleading for an old one — there is no other way in, and
      somebody who has used this before would reasonably assume the signup
      field is not for them. One line, where the decision is made.
    -->
    <div style="font-size:12px;color:rgba(236,236,241,0.32);margin-top:10px">${esc(aside)}</div>
  </div>`;
}

/**
 * THE SIGN-IN PAGE, for somebody who already has an account.
 *
 * The header's "Sign in" used to jump to #start — the signup form, under a
 * button reading "Start free". The reasoning at the time was that the plumbing
 * is identical: the emailed link finds an existing account or creates one, so
 * there is no second route to build. That is true about the plumbing and wrong
 * about the person. Somebody who has used this before, told "Start free",
 * has not been answered; the owner clicked it and said so.
 *
 * Built like renderConfirm below rather than through the app shell: there is no
 * session yet, so there is no room to put a page in. Same three pieces
 * (noDevNotes, FONT_CSS, the wordmark), same flex-centred column, same palette.
 *
 * IT CARRIES THE NOTICES ITSELF. Every outcome of /auth/start used to redirect
 * to "/", so a failure on this page would have been explained on the marketing
 * page instead — including the one that matters most right now, that email
 * delivery is not configured. The form posts `from=signin` and the route sends
 * it back here.
 */
export function renderSignIn(d: LandingData): string {
  return noDevNotes(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Sign in to Aldershot</title>
<meta name="robots" content="noindex"/>
<style>${FONT_CSS}</style>
<!-- a{text-decoration:none} is in renderLanding's block and not in
     renderConfirm's, so it is stated here rather than assumed. -->
<style>*{box-sizing:border-box}body{margin:0}a{text-decoration:none}</style>
</head>
<body>
<div style="min-height:100vh;background:#101013;color:#ECECF1;font-family:'Instrument Sans',sans-serif;display:flex;align-items:center;justify-content:center;padding:24px">
  <div style="max-width:420px;width:100%;text-align:center">
    <a href="/" style="display:inline-flex;align-items:baseline;gap:4px;font-weight:600;font-size:15.5px;letter-spacing:-0.01em;color:#ECECF1">aldershot${mark(15.5)}</a>
    <h1 style="margin:26px 0 0;font-size:26px;font-weight:700;letter-spacing:-0.03em">Sign in</h1>
    <p style="margin:12px 0 0;font-size:14px;color:rgba(236,236,241,0.5);line-height:1.6">We email you a link. There is no password to remember.</p>
    <div style="margin-top:24px">${signInForm("signin-form", "Email me a link", true, d.google, EITHER_WAY, "signin")}</div>
    ${notice(d)}
  </div>
</div>
</body></html>`);
}

/**
 * The page a login link lands on.
 *
 * Deliberately a form, not an automatic sign-in: the token is spent by the
 * POST, so a mail scanner that fetches the URL cannot burn it. Nothing
 * automated submits a form.
 */
export function renderConfirm(token: string): string {
  return noDevNotes(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Sign in to Aldershot</title>
<meta name="robots" content="noindex"/>
<style>${FONT_CSS}</style>
<style>*{box-sizing:border-box}body{margin:0}</style>
</head>
<body>
<div style="min-height:100vh;background:#101013;color:#ECECF1;font-family:'Instrument Sans',sans-serif;display:flex;align-items:center;justify-content:center;padding:24px">
  <div style="max-width:420px;width:100%;text-align:center">
    <div style="display:inline-flex;align-items:baseline;gap:4px;font-weight:600;font-size:15.5px;letter-spacing:-0.01em">aldershot${mark(15.5)}</div>
    <h1 style="margin:26px 0 0;font-size:26px;font-weight:700;letter-spacing:-0.03em">One more tap.</h1>
    <p style="margin:12px 0 0;font-size:14px;color:rgba(236,236,241,0.5);line-height:1.6">Confirm it was you who asked for this link.</p>
    <form method="post" action="/auth/callback" style="margin-top:24px">
      <input type="hidden" name="token" value="${esc(token)}"/>
      <button type="submit" style="width:100%;font-size:14.5px;font-weight:600;padding:13px;border-radius:5px;background:#ECECF1;color:#131316;border:none;cursor:pointer;font-family:inherit">Sign in</button>
    </form>
    <p style="margin:18px 0 0;font-size:12px;color:rgba(236,236,241,0.3);line-height:1.6">If you didn't ask for this, close this page — nothing has happened yet.</p>
  </div>
</div>
</body></html>`);
}

/**
 * What happened to the last sign-in attempt.
 *
 * The devLink branch shows the link on screen, and the route only ever sets it
 * on a development machine. It shipped ungated for a few minutes and that was
 * an authentication bypass: type any address, get that account's link, become
 * them. In production a missing mail provider now says so instead — still not
 * claiming an email was sent, which is the point that mattered.
 */
function notice(d: LandingData): string {
  if (d.sentTo) {
    return `<div style="margin:20px auto 0;max-width:520px;padding:14px 16px;border-radius:9px;background:#141418;box-shadow:inset 0 0 0 1px rgba(94,201,143,0.28);font-size:13.5px;color:rgba(236,236,241,0.75);line-height:1.6">
      Check <strong data-content style="color:#ECECF1">${esc(d.sentTo)}</strong> &mdash; the link works once and expires in 20 minutes.
    </div>`;
  }
  if (d.devLink) {
    return `<div style="margin:20px auto 0;max-width:640px;padding:14px 16px;border-radius:9px;background:#141418;box-shadow:inset 0 0 0 1px rgba(217,179,106,0.3);font-size:13px;color:rgba(236,236,241,0.75);line-height:1.6">
      Development only — no mail provider is configured, so nothing was sent. Your link:
      <a href="${esc(d.devLink)}" style="display:block;margin-top:8px;color:${GOLD};font-family:${MONO};font-size:12px;word-break:break-all">${esc(d.devLink)}</a>
    </div>`;
  }
  if (d.error) {
    const message =
      d.error === "link"
        ? "That link has expired or has already been used. Ask for a new one."
        : d.error === "google"
          ? "That didn't complete. Try again, or use your email instead."
          : d.error === "nogoogle"
            ? "Google sign-in isn't configured yet. Use your email instead."
            : d.error === "nomail"
          ? "Sign-in isn't switched on yet — email delivery isn't configured. Nothing was sent."
          /* Without its own line this fell through to "that doesn't look like
             an email address", which is a lie about a perfectly good one. */
          : d.error === "toomany"
            ? "That's a few links already — check your inbox, or try again in a few minutes."
          : "That doesn't look like an email address.";
    return `<div style="margin:20px auto 0;max-width:520px;padding:14px 16px;border-radius:9px;background:#141418;box-shadow:inset 0 0 0 1px rgba(224,106,106,0.3);font-size:13.5px;color:rgba(236,236,241,0.75)">${message}</div>`;
  }
  return "";
}

export interface LandingData {
  /** The address a link was just sent to. */
  sentTo: string | null;
  /** The link itself, when no mail provider is configured. */
  devLink: string | null;
  error: string | null;
  /** Whether Google sign-in is configured. Absent, the email link stands alone. */
  google: boolean;
}

/*
 * THE NAV NAMES THE PRODUCT'S OWN IDEAS: The rules, The archive, Pricing.
 *
 * The design has a fourth link to the Manual. No route serves one and there
 * is no manual in the product, so it would be the dead control the
 * `promise` rule exists to catch; 12-DEFERRED.md carries it.
 *
 * The explanation lives here rather than beside the markup because the
 * markup is inside a template literal. An HTML comment in there ships to
 * the browser, and a backtick in there ends the literal — both have
 * happened in this repo, the second one badly enough to earn its own
 * fidelity check.
 */
export function renderLanding(d: LandingData): string {
  const jobCard = (j: Job) => `<div style="padding:22px 20px;border-radius:11px;background:#17171B;display:flex;flex-direction:column;gap:10px">
    <div style="display:flex;align-items:center;gap:9px">
      <span style="width:7px;height:7px;border-radius:2px;background:${j.color};flex:none"></span>
      <span style="font-size:15.5px;font-weight:600">${j.name}</span>
    </div>
    <div style="font-size:13px;color:rgba(236,236,241,0.5);line-height:1.6;flex:1">${j.body}</div>
    <div style="font-size:12px;color:${j.color};font-family:${MONO}">"${j.example}"</div>
  </div>`;

  const feat = (t: string, color: string) =>
    `<div style="display:flex;gap:9px;align-items:baseline"><span style="color:${color};font-size:12px;flex:none">✓</span><span style="font-size:13px;color:rgba(236,236,241,0.65);line-height:1.5">${t}</span></div>`;

  return noDevNotes(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Aldershot — say what the video should be.</title>
<meta name="description" content="Drop in footage. Each answer becomes a plain-English rule you can see, switch off, or change. The cut follows the rules."/>
<style>${FONT_CSS}</style>
<style>
  *,*::before,*::after{box-sizing:border-box}
  /* The background belongs on body, not only on the page wrapper. Without it
     any horizontal overflow reveals the browser's white default beyond the
     wrapper's edge — which is exactly what the phone screenshot showed: a
     white gutter down the right-hand side of a dark site. */
  html,body{margin:0;background:#101013;overflow-x:hidden;overflow-x:clip}
  a{text-decoration:none}
  html{scroll-behavior:smooth}
  ::-webkit-scrollbar{width:10px;height:10px}
  ::-webkit-scrollbar-track{background:#101013}
  ::-webkit-scrollbar-thumb{background:#2A2A31;border-radius:99px;border:2px solid #101013}
  @keyframes blip{0%,100%{opacity:1}50%{opacity:.25}}
  /* On a phone the wordmark plus four no-wrap links ran 78px past the screen,
     which scrolled the whole site sideways and cut "aldershot" down to
     "ershot". The section anchors are what does not fit and what a phone needs
     least: the page is a single scroll, and "Start free" is the only thing
     anyone taps up here. */
  @media (max-width:640px){ .nav-anchor{display:none} }
</style>
</head>
<body>
<div style="min-height:100vh;background:#101013;color:#ECECF1;font-family:'Instrument Sans',sans-serif">

  <div style="border-bottom:1px solid rgba(255,255,255,0.05);position:sticky;top:0;background:rgba(16,16,19,0.86);backdrop-filter:blur(14px);z-index:5;${PAD}">
    <div style="${WRAP};display:flex;align-items:center;justify-content:space-between;gap:18px;height:58px">
      <div style="display:flex;align-items:baseline;gap:4px;font-weight:600;font-size:15.5px;letter-spacing:-0.01em">aldershot${mark(15.5)}</div>
      <div style="display:flex;align-items:center;gap:clamp(14px,2.4vw,26px);font-size:13.5px">
        <a class="nav-anchor" href="#rules" style="color:rgba(236,236,241,0.55);font-weight:500;white-space:nowrap">The rules</a>
        <a class="nav-anchor" href="#archive" style="color:rgba(236,236,241,0.55);font-weight:500;white-space:nowrap">The archive</a>
        <a class="nav-anchor" href="#pricing" style="color:rgba(236,236,241,0.55);font-weight:500;white-space:nowrap">Pricing</a>
        <!--
          SIGN IN, for somebody who already has an account.
          There was nothing. The header was the wordmark, three section
          anchors and "Start free", every CTA on the page pointed at the same
          signup form, and the words "sign in" appeared nowhere on the
          rendered page except inside an error banner after a failed attempt.
          A returning visitor had nothing to look for.

          It said #start, and the reasoning was that the plumbing is the same
          either way: the emailed link finds an existing account or creates one
          (src/user.ts), so there is no second route to build. That was true
          about the plumbing and wrong about the person. Clicking "Sign in" and
          arriving at a box labelled "Start free" is not an answer, and the
          owner said so after trying it. /signin is a page about coming back,
          and it carries the notices itself so a failure is explained there.

          NOT class="nav-anchor". That class is display:none under 640px —
          the comment above the media query says the anchors are "what a phone
          needs least" — and this is the one control a returning visitor needs
          most. On a phone the header is now the wordmark, Sign in, Start free.
        -->
        <a href="/signin" style="color:rgba(236,236,241,0.55);font-weight:500;white-space:nowrap">Sign in</a>
        <a href="#start" style="font-size:13px;font-weight:600;padding:8px 16px;border-radius:5px;background:#ECECF1;color:#131316;white-space:nowrap">Start free</a>
      </div>
    </div>
  </div>

  <div style="${PAD}">
    <div style="${WRAP};padding:clamp(64px,10vw,110px) 0 clamp(48px,7vw,72px);text-align:center">
      <!--
        THE HERO SELLS THE RULES NOW, because that is what was built.
        See the block comment above renderLanding.
      -->
      <div style="${EYEBROW}">A VIDEO EDITOR WITH NO TIMELINE</div>
      <h1 style="margin:18px auto 0;max-width:820px;font-size:clamp(34px,6vw,62px);font-weight:700;letter-spacing:-0.035em;line-height:1.05">Say what the video should be.<br>The rules do the cutting.</h1>
      <p style="margin:20px auto 0;max-width:600px;font-size:clamp(15px,2vw,17.5px);color:rgba(236,236,241,0.55);line-height:1.6">Drop in footage — yours or anyone's. Aldershot reads it and asks what you want. Each answer becomes a plain-English rule you can see, switch off, or change. The cut follows the rules. Nothing is ever deleted.</p>
      <div id="start" style="margin-top:28px">${signInForm("hero-form", "Start free", true, d.google, BOTH_WAYS)}</div>
      <div style="margin-top:10px;font-size:12px;color:rgba(236,236,241,0.3)">No card. 300 processing minutes a month on the house.</div>
      ${notice(d)}

      <!--
        THE BRIEF AND THE RULES IT WROTE, side by side.

        The old hero was the brief card alone, with a green-dotted line under
        it saying the result "becomes a project you can come back to". True,
        and the wrong thing to lead with: it describes the filing, not the
        product. The design puts the RULES beside the brief, because a brief
        turning into two numbered rules with switches IS the product, and a
        picture of it says more than the sentence did.

        Static, deliberately. These two rules are what the sentence beside
        them compiles to; nothing here is read from a database, and a landing
        page that implies a live account it does not have is the demo-card
        problem that CLAUDE.md already records once.
      -->
      <div style="margin:clamp(40px,6vw,64px) auto 0;max-width:860px;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr));gap:12px;text-align:left">
        <div style="background:#1A1A1F;border-radius:12px;padding:6px;box-shadow:0 0 0 1px rgba(255,255,255,0.06), 0 24px 80px rgba(0,0,0,0.5)">
          <div style="padding:16px 16px 12px;font-size:16.5px;line-height:1.5;color:#ECECF1;min-height:52px">Six shorts from the strongest moments. Hooks in the first two seconds.</div>
          <div style="display:flex;gap:10px;align-items:center;padding:10px 8px 6px 16px;border-top:1px solid rgba(255,255,255,0.05);flex-wrap:wrap">
            <div style="display:flex;align-items:center;gap:10px;flex:1 1 180px;min-width:0">
              <div style="flex:none;width:46px;aspect-ratio:16/9;border-radius:4px;overflow:hidden;background:#07070a;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.08)"><img src="/assets/frame-2.png" alt="" style="width:100%;height:100%;object-fit:cover;display:block"/></div>
              <span style="font-size:12px;color:rgba(236,236,241,0.6);font-family:${MONO};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">kino_casino_372.mp4 · 3:04:00</span>
            </div>
            <!-- A real link. This was a <div> styled to look exactly like the
                 button below it, so the most prominent thing in the hero did
                 nothing at all when clicked. -->
            <a href="#start" style="flex:none;font-size:13.5px;font-weight:600;padding:9px 22px;border-radius:5px;background:#ECECF1;color:#131316;white-space:nowrap">Begin →</a>
          </div>
        </div>

        <div style="background:#141418;border-radius:12px;padding:14px 16px 16px;box-shadow:0 0 0 1px rgba(255,255,255,0.06)">
          <div style="display:flex;gap:8px;align-items:center">
            <span style="width:6px;height:6px;border-radius:50%;background:${GREEN};flex:none"></span>
            <span style="${EYEBROW}">THE RULES IT WROTE</span>
          </div>
          <div style="margin-top:12px;display:flex;flex-direction:column;gap:6px">
            ${[
              { n: "01", text: "Hook in the first 2 seconds.", on: true },
              { n: "02", text: "Nothing about money.", on: false },
            ]
              .map(
                (r) => `<div style="display:flex;gap:11px;align-items:center;padding:9px 11px;border-radius:7px;background:${
                  r.on ? "#1A1A20" : "transparent"
                }">
                  <span style="flex:none;width:16px;font-size:10.5px;font-family:${MONO};color:${
                    r.on ? GOLD : "rgba(236,236,241,0.28)"
                  }">${r.n}</span>
                  <span style="flex:1;min-width:0;font-size:13px;line-height:1.5;color:${
                    r.on ? "#ECECF1" : "rgba(236,236,241,0.35)"
                  }">${r.text}</span>
                  <span style="flex:none;position:relative;width:27px;height:15px;border-radius:99px;background:${
                    r.on ? GREEN : "#2E2E36"
                  }">
                    <span style="position:absolute;top:2.5px;left:${
                      r.on ? "14px" : "2.5px"
                    };width:10px;height:10px;border-radius:99px;background:${
                      r.on ? "#101013" : "rgba(236,236,241,0.5)"
                    }"></span>
                  </span>
                </div>`,
              )
              .join("")}
          </div>
        </div>
      </div>
    </div>
  </div>

  <!--
    THE RULES ARE THE FILE.

    The section the retired design had no equivalent for, and the one thing
    on this page neither competitor has. It is a worked example rather than
    a claim: four rules, eight moments of a council meeting, and every
    moment labelled with what happened to it. Click a rule off and the cut
    follows — which is invariants 1 and 6 demonstrated instead of asserted.

    THE SIXTEEN CUTS ARE RESOLVED ON THE SERVER. resolveDemo() runs for
    every combination of the four rules and the results ship with the page,
    so the browser picks a cut the rules already produced rather than
    recomputing one. The logic exists once, in TypeScript, where it is
    typechecked and pinned by test/landing.test.ts. A second copy in a
    script tag would be a second source of truth for the one thing this
    section is about.

    It renders the all-on cut as HTML first, so the section says what it
    means with no JavaScript at all; the script only swaps text that is
    already there.
  -->
  <div id="rules" style="${PAD};background:#0C0C0F">
    <div style="${WRAP};padding:clamp(48px,7vw,80px) 0">
      <div style="${EYEBROW};color:rgba(236,236,241,0.4)">THE RULES ARE THE FILE</div>
      <h2 style="margin:14px 0 0;font-size:clamp(24px,3.4vw,36px);font-weight:600;letter-spacing:-0.025em;line-height:1.15;max-width:700px">A timeline remembers where you dragged things. Rules remember why.</h2>
      <p style="margin:14px 0 0;max-width:620px;font-size:14.5px;color:rgba(236,236,241,0.55);line-height:1.65">Every edit is a sentence: <em style="font-style:normal;color:#ECECF1">take out the hellos</em>, <em style="font-style:normal;color:#ECECF1">keep every claim about the numbers</em>, <em style="font-style:normal;color:#ECECF1">under three minutes</em>. The cut is what the rules produce. Change a rule and the whole cut follows; switch one off and see exactly what it was doing.</p>

      <div style="margin-top:36px;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr));gap:8px;align-items:stretch">
        <div style="background:#131317;border-radius:12px;padding:18px 18px 16px;display:flex;flex-direction:column;gap:6px">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
            <span style="font-size:10.5px;font-weight:600;letter-spacing:.09em;color:rgba(236,236,241,0.45)">THE RULES · click one</span>
            <span id="demo-meta" data-content style="font-size:11px;font-family:${MONO};color:rgba(236,236,241,0.45)">${DEMO_RULES.length} of ${DEMO_RULES.length} on</span>
          </div>
          ${DEMO_RULES.map(
            (r, i) => `<button type="button" data-rule="${i}" style="appearance:none;border:0;text-align:left;font:inherit;color:inherit;display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:8px;background:#17171B;cursor:pointer;transition:background .12s,opacity .12s">
              <span style="flex:none;font-size:11px;font-family:${MONO};color:${GOLD};padding-top:2px">${r.n}</span>
              <span style="flex:1;min-width:0">
                <span data-rule-text style="display:block;font-size:13.5px;line-height:1.45">${r.text}</span>
                <span data-rule-effect data-content style="display:block;margin-top:2px;font-size:11.5px;color:rgba(236,236,241,0.45);line-height:1.4">${r.effectOn(
                  DEMO.filter((m) => m.tag === r.tag).length,
                )}</span>
              </span>
              <span data-rule-toggle style="flex:none;margin-top:3px;width:26px;height:14px;border-radius:99px;background:${GREEN};position:relative;transition:background .12s"><span data-rule-knob style="position:absolute;top:2px;left:14px;width:10px;height:10px;border-radius:50%;background:#101013;transition:left .12s"></span></span>
            </button>`,
          ).join("")}
          <div style="margin-top:auto;padding-top:10px;font-size:11px;color:rgba(236,236,241,0.35);line-height:1.5">Four rules, sixteen cuts. Every one of them is what these rules produce from these moments — the cut is never stored, it is worked out.</div>
        </div>

        <div style="background:#131317;border-radius:12px;padding:18px 18px 16px;display:flex;flex-direction:column">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
            <span style="font-size:10.5px;font-weight:600;letter-spacing:.09em;color:rgba(236,236,241,0.45)">THE CUT · follows the rules</span>
            <span id="demo-runtime" data-content style="font-size:11px;font-family:${MONO};color:${GREEN}">${demoFmt(
              resolveDemo(0).secs,
            )} from 2:50:12</span>
          </div>
          <div style="margin-top:10px;height:6px;border-radius:3px;background:#1C1C22;overflow:hidden;display:flex;gap:1px">
            ${DEMO.map(
              (m, i) => `<span data-bar="${i}" style="height:100%;flex:${Math.max(
                1,
                Math.round(m.dur / 20),
              )};background:${
                resolveDemo(0).out[i] ? "#232329" : m.tag === "vote" ? GOLD : GREEN
              };transition:background .2s"></span>`,
            ).join("")}
          </div>
          <div style="margin-top:12px;display:flex;flex-direction:column;gap:4px">
            ${DEMO.map((m, i) => {
              const out = resolveDemo(0).out[i];
              return `<div data-row="${i}" style="display:flex;gap:10px;align-items:baseline;padding:8px 10px;border-radius:7px;background:${
                out ? "transparent" : "#17171B"
              };opacity:${out ? "0.5" : "1"};transition:opacity .2s,background .2s">
                <span data-row-tc style="flex:none;width:40px;font-size:10.5px;font-family:${MONO};color:${
                  out ? "rgba(236,236,241,0.3)" : GOLD
                }">${m.tc}</span>
                <span data-row-text style="flex:1;min-width:0;font-size:12.5px;line-height:1.45;color:${
                  out ? "rgba(236,236,241,0.5)" : "rgba(236,236,241,0.88)"
                };text-decoration:${out ? "line-through" : "none"}">${m.text}</span>
                <span data-row-why data-content style="flex:none;font-size:10.5px;color:rgba(236,236,241,0.4);white-space:nowrap">${
                  out ? "out · " + out : ""
                }</span>
              </div>`;
            }).join("")}
          </div>
          <div style="margin-top:auto;padding-top:12px;font-size:11.5px;color:rgba(236,236,241,0.45);line-height:1.5">Left-out moments are kept, with the rule that removed them as the reason. Nothing is deleted.</div>
        </div>
      </div>
    </div>
  </div>

  <div style="${PAD}">
    <div style="${WRAP};padding:clamp(48px,7vw,80px) 0">
      <div style="${EYEBROW};color:rgba(236,236,241,0.35)">ONE CONVERSATION · SIX THINGS OUT</div>
      <h2 style="margin:14px 0 0;font-size:clamp(24px,3.4vw,36px);font-weight:600;letter-spacing:-0.025em;max-width:640px;line-height:1.15">It asks one question, recommends an answer, and gets on with it.</h2>
      <div style="margin-top:32px;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(230px,100%),1fr));gap:8px">${JOBS.map(jobCard).join("")}</div>
      <div style="margin-top:20px;padding:16px 18px;border-radius:9px;background:#141418;box-shadow:inset 0 0 0 1px rgba(217,179,106,0.18);font-size:13.5px;color:rgba(236,236,241,0.65);line-height:1.6">Every decision it makes is one line in the conversation, with Undo. Set it to <span style="color:#ECECF1">Ask</span> and it checks before anything consequential; <span style="color:#ECECF1">Recommend</span> and it asks at most once; <span style="color:#ECECF1">Auto</span> and it decides, then tells you what it decided.</div>
    </div>
  </div>

  <div id="archive" style="${PAD};background:#0C0C0F">
    <div style="${WRAP};padding:clamp(48px,7vw,80px) 0">
      <div style="display:flex;gap:clamp(20px,4vw,44px);align-items:center;flex-wrap:wrap">
        <div style="flex:1 1 320px;min-width:min(300px,100%)">
          <div style="${EYEBROW};color:${CYAN}">THE ARCHIVE DIRECTS THE NEXT ONE</div>
          <h2 style="margin:12px 0 0;font-size:clamp(22px,3vw,32px);font-weight:600;letter-spacing:-0.025em;line-height:1.15">Everything it reads, it keeps — as moments, sorted by what was said.</h2>
          <p style="margin:14px 0 0;font-size:14.5px;color:rgba(236,236,241,0.55);line-height:1.65">Footage is read once and broken into moments, each tagged by thread. Months later, ask for <em style="font-style:normal;color:#ECECF1">every time he contradicts himself</em> and it hands back the moments across every video you've fed it — the reason each one matched, never a score. That's how a clip becomes a supercut, and a supercut becomes an essay. And it's why a sentence like <em style="font-style:normal;color:#ECECF1">keep every claim about the numbers</em> can be a rule at all.</p>
        </div>
        <div style="flex:1 1 340px;min-width:min(320px,100%);background:#17171B;border-radius:11px;padding:18px">
          <div style="display:flex;align-items:center;gap:8px;background:#101014;border-radius:7px;padding:9px 12px">${iconSearch({ size: 13, stroke: "rgba(236,236,241,0.4)" })}<span style="font-size:12.5px;color:rgba(236,236,241,0.8)">when someone admits the plan changed</span></div>
          <div style="margin-top:10px;display:flex;flex-direction:column;gap:5px">
            ${HITS.map(
              (h) => `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;background:#101014">
                <span style="flex:none;width:16px;height:16px;border-radius:4px;background:${h.bg};color:${h.color};font-size:9.5px;font-weight:600;font-family:${MONO};display:flex;align-items:center;justify-content:center">${h.src}</span>
                <div style="flex:1;min-width:0">
                  <div style="font-size:12.5px;color:rgba(236,236,241,0.85);line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h.text}</div>
                  <div style="margin-top:2px;font-size:11px;color:rgba(236,236,241,0.45);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${h.why}</div>
                </div>
              </div>`,
            ).join("")}
          </div>
          <div style="margin-top:10px;font-size:11px;color:rgba(236,236,241,0.4);font-family:${MONO}">3 moments · 3 videos · by meaning</div>
        </div>
      </div>

      <div style="margin-top:clamp(40px,6vw,64px);display:flex;gap:clamp(20px,4vw,44px);align-items:center;flex-wrap:wrap-reverse">
        <div style="flex:1 1 340px;min-width:min(320px,100%);background:#17171B;border-radius:11px;padding:18px;display:flex;flex-direction:column;gap:6px">
          <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;background:#101014">
            <img src="/assets/frame-1.png" alt="" style="width:52px;aspect-ratio:16/9;border-radius:4px;object-fit:cover;flex:none"/>
            <span style="font-size:12.5px;color:rgba(236,236,241,0.8);flex:1;min-width:0;line-height:1.4">“By 2030 nobody will own a car in this city.”</span>
            <span style="flex:none;font-size:10.5px;font-family:${MONO};color:rgba(236,236,241,0.4)">0:18</span>
          </div>
          <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;background:#141418;box-shadow:inset 0 0 0 1px rgba(224,106,106,0.3)">
            <span style="flex:none;width:8px;height:8px;border-radius:50%;background:${RED};animation:blip 1.2s ease-in-out infinite"></span>
            <!--
              SOUND ONLY, and the design says otherwise.

              Both landing designs say "on camera or voice only";
              getUserMedia({ audio: true }) is what the recorder actually
              asks for, and the beat itself says so beside the Record
              control. A landing page that promises a camera the product
              does not have is the one kind of divergence that is not a
              fidelity gap — it is a lie, and a design does not get to
              overrule that. 12-DEFERRED.md carries the camera half.
            -->
            <span style="font-size:12.5px;color:rgba(236,236,241,0.8);flex:1;line-height:1.4">Your take goes here — sound only, no camera yet</span>
            <span style="flex:none;font-size:10.5px;font-weight:600;color:${RED};font-family:${MONO}">REC</span>
          </div>
          <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;background:#101014">
            <img src="/assets/frame-4.png" alt="" style="width:52px;aspect-ratio:16/9;border-radius:4px;object-fit:cover;flex:none"/>
            <span style="font-size:12.5px;color:rgba(236,236,241,0.8);flex:1;min-width:0;line-height:1.4">“The data says the opposite of what he just said.”</span>
            <span style="flex:none;font-size:10.5px;font-family:${MONO};color:rgba(236,236,241,0.4)">0:41</span>
          </div>
        </div>
        <div style="flex:1 1 320px;min-width:min(300px,100%)">
          <div style="${EYEBROW};color:${RED}">YOUR VOICE, WHERE IT'S NEEDED</div>
          <h2 style="margin:12px 0 0;font-size:clamp(22px,3vw,32px);font-weight:600;letter-spacing:-0.025em;line-height:1.15">It leaves the room for you to talk.</h2>
          <p style="margin:14px 0 0;font-size:14.5px;color:rgba(236,236,241,0.55);line-height:1.65">Reacting, narrating, bridging two moments — the cut shows where your voice goes and what's on either side of it. Record one line at a time with a three-second count-in; every take is kept, so you can change your mind later. No screen capture, no syncing, no OBS.</p>
        </div>
      </div>
    </div>
  </div>

  <div style="${PAD}">
    <div style="${WRAP};padding:clamp(48px,7vw,80px) 0;text-align:center">
      <div style="${EYEBROW};color:${GREEN}">BEFORE YOU POST</div>
      <h2 style="margin:14px auto 0;font-size:clamp(24px,3.4vw,36px);font-weight:600;letter-spacing:-0.025em;max-width:600px;line-height:1.15">It checks the things that get videos taken down.</h2>
      <p style="margin:14px auto 0;max-width:560px;font-size:14.5px;color:rgba(236,236,241,0.55);line-height:1.65">Third-party clips, music underneath, faces, anything generated, missing attributions — each one named, each with a one-press fix and a recommendation. A provenance record goes on every export, listing every source and every edit.</p>
      <div style="margin:32px auto 0;max-width:640px;text-align:left;display:flex;flex-direction:column;gap:5px">
        ${CHECKS.map(
          (c) => `<div style="display:flex;gap:12px;align-items:baseline;flex-wrap:wrap;padding:12px 14px;border-radius:9px;background:#141418;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.05)">
            <span style="flex:none;width:7px;height:7px;border-radius:50%;background:${c.dot};transform:translateY(-1px)"></span>
            <span style="flex:1 1 220px;min-width:0;font-size:13px;line-height:1.5;color:rgba(236,236,241,0.85)">${c.text}</span>
            <span style="flex:none;font-size:11.5px;font-weight:500;padding:4px 10px;border-radius:4px;background:${c.fixBg};color:${c.fixColor};white-space:nowrap">${c.fix}</span>
          </div>`,
        ).join("")}
      </div>
    </div>
  </div>

  <div id="pricing" style="${PAD};background:#0C0C0F">
    <div style="${WRAP};padding:clamp(48px,7vw,80px) 0">
      <div style="text-align:center">
        <div style="${EYEBROW};color:rgba(236,236,241,0.35)">PRICING</div>
        <h2 style="margin:14px 0 0;font-size:clamp(24px,3.4vw,36px);font-weight:600;letter-spacing:-0.025em">Pay for the minutes it reads. Editing is free.</h2>
        <p style="margin:12px auto 0;max-width:480px;font-size:14.5px;color:rgba(236,236,241,0.55);line-height:1.6">Footage costs its length to read, once. After that, every cut, re-cut, short and search from it costs nothing. Storage is permanent on every plan.</p>
      </div>
      <div style="margin:36px auto 0;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr));gap:10px;max-width:720px">
        <div style="padding:26px 24px;border-radius:12px;background:#131317">
          <div style="font-size:15.5px;font-weight:600">Free</div>
          <div style="margin-top:10px;font-size:32px;font-weight:700;letter-spacing:-0.03em">$${PLANS.free.price}</div>
          <div style="font-size:12.5px;color:rgba(236,236,241,0.45);margin-top:3px">forever</div>
          <div style="margin-top:18px;display:flex;flex-direction:column;gap:9px">${FREE_FEATS.map((t) => feat(t, GREEN)).join("")}</div>
          <a href="#start" style="display:block;text-align:center;margin-top:22px;font-size:13.5px;font-weight:600;padding:11px;border-radius:5px;background:#232329;color:#ECECF1;white-space:nowrap">Start free</a>
        </div>
        <div style="padding:26px 24px;border-radius:12px;background:#17171B;box-shadow:inset 0 0 0 1px rgba(236,236,241,0.22)">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span style="font-size:15.5px;font-weight:600">Studio</span><span style="font-size:10.5px;font-weight:600;padding:2px 7px;border-radius:4px;background:rgba(217,179,106,0.16);color:${GOLD};white-space:nowrap">MOST GET THIS</span></div>
          <div style="margin-top:10px;font-size:32px;font-weight:700;letter-spacing:-0.03em">$${PLANS.pro.price}</div>
          <div style="font-size:12.5px;color:rgba(236,236,241,0.45);margin-top:3px">a month</div>
          <div style="margin-top:18px;display:flex;flex-direction:column;gap:9px">${PRO_FEATS.map((t) => feat(t, GREEN)).join("")}</div>
          <!-- Signing in first is the honest order: checkout needs an account
               to attach the subscription to. This pointed at the same free
               form as the Free tier's button, so the paid plan could not be
               bought from the page selling it. The plan is carried as a query
               param so the new account lands on checkout, not on Home. -->
          <a href="/?plan=studio#start" style="display:block;text-align:center;margin-top:22px;font-size:13.5px;font-weight:600;padding:11px;border-radius:5px;background:#ECECF1;color:#131316;white-space:nowrap">Start with Studio</a>
        </div>
      </div>
      <!-- The design's line here is "Storage add-ons, or point sources at a
           bucket you own." There is no add-on to buy: no price, no Stripe
           product, nothing that grants more room. The bucket half shipped
           last week and is the whole of what is true. -->
      <div style="margin-top:16px;text-align:center;font-size:12px;color:rgba(236,236,241,0.4)">Need more room? Point sources at a bucket you own.</div>
    </div>
  </div>

  <div style="${PAD}">
    <div style="max-width:680px;margin:0 auto;padding:clamp(48px,7vw,72px) 0">
      <h2 style="font-size:clamp(20px,2.6vw,26px);font-weight:600;letter-spacing:-0.02em;text-align:center">Fair questions.</h2>
      <div style="margin-top:26px;display:flex;flex-direction:column;gap:6px">
        ${FAQ.map(
          (f, i) => `<details${i === 0 ? " open" : ""} style="border-radius:10px;background:#17171B;overflow:hidden">
            <summary style="display:flex;align-items:center;gap:12px;padding:16px 18px;cursor:pointer;list-style:none">
              <span style="flex:1;font-size:14px;font-weight:500">${f.q}</span>
            </summary>
            <div style="padding:0 18px 16px;font-size:13.5px;color:rgba(236,236,241,0.6);line-height:1.65">${f.a}</div>
          </details>`,
        ).join("")}
      </div>
    </div>
  </div>

  <div style="${PAD};background:#0C0C0F">
    <div style="${WRAP};padding:clamp(56px,8vw,90px) 0;text-align:center">
      <h2 style="margin:0 auto;font-size:clamp(26px,4vw,40px);font-weight:700;letter-spacing:-0.03em;max-width:640px;line-height:1.1">The footage is sitting there. Say what it should be.</h2>
      <div style="margin-top:26px">${signInForm("footer-form", "Start free", true, d.google, BOTH_WAYS)}</div>
      <div style="margin-top:52px;padding-top:22px;border-top:1px solid rgba(255,255,255,0.05);display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;font-size:12.5px;color:rgba(236,236,241,0.4)">
        <span style="display:flex;align-items:baseline;gap:4px;font-weight:600;color:rgba(236,236,241,0.55)">aldershot${mark(12.5, "rgba(217,179,106,0.85)")}</span>
        <span>Cuts · Shorts · Reactions · Essays</span>
      </div>
    </div>
  </div>
</div>
<script type="application/json" id="demo-data">${JSON.stringify({
    gold: GOLD,
    green: GREEN,
    offLine: "off — switch it back on to see what it was doing",
    tags: DEMO.map((m) => m.tag),
    effects: DEMO_RULES.map((r) => r.effectOn(DEMO.filter((m) => m.tag === r.tag).length)),
    states: Array.from({ length: 1 << DEMO_RULES.length }, (_, mask) => {
      const { out, secs } = resolveDemo(mask);
      return {
        out,
        rt: demoFmt(secs) + " from 2:50:12",
        meta:
          DEMO_RULES.filter((_, i) => !(mask & (1 << i))).length + " of " + DEMO_RULES.length + " on",
      };
    }),
  }).replace(/</g, "\\u003c")}</script>
<script>
(function () {
  var holder = document.getElementById('demo-data');
  if (!holder) return;
  var D = JSON.parse(holder.textContent);
  var rules = [].slice.call(document.querySelectorAll('[data-rule]'));
  var meta = document.getElementById('demo-meta');
  var runtime = document.getElementById('demo-runtime');
  if (!rules.length || !meta || !runtime) return;
  var off = 0;

  function paint() {
    var s = D.states[off];
    meta.textContent = s.meta;
    runtime.textContent = s.rt;
    for (var i = 0; i < s.out.length; i++) {
      var row = document.querySelector('[data-row="' + i + '"]');
      var bar = document.querySelector('[data-bar="' + i + '"]');
      if (!row || !bar) continue;
      var out = s.out[i];
      row.style.background = out ? 'transparent' : '#17171B';
      row.style.opacity = out ? '0.5' : '1';
      row.querySelector('[data-row-tc]').style.color = out ? 'rgba(236,236,241,0.3)' : D.gold;
      var text = row.querySelector('[data-row-text]');
      text.style.color = out ? 'rgba(236,236,241,0.5)' : 'rgba(236,236,241,0.88)';
      text.style.textDecoration = out ? 'line-through' : 'none';
      row.querySelector('[data-row-why]').textContent = out ? 'out \u00b7 ' + out : '';
      bar.style.background = out ? '#232329' : D.tags[i] === 'vote' ? D.gold : D.green;
    }
    rules.forEach(function (b, i) {
      var isOff = !!(off & (1 << i));
      b.style.background = isOff ? '#101014' : '#17171B';
      b.style.opacity = isOff ? '0.6' : '1';
      b.setAttribute('aria-pressed', isOff ? 'false' : 'true');
      b.querySelector('[data-rule-text]').style.textDecoration = isOff ? 'line-through' : 'none';
      b.querySelector('[data-rule-effect]').textContent = isOff ? D.offLine : D.effects[i];
      b.querySelector('[data-rule-toggle]').style.background = isOff ? '#2A2A31' : D.green;
      b.querySelector('[data-rule-knob]').style.left = isOff ? '2px' : '14px';
    });
  }

  rules.forEach(function (b, i) {
    b.addEventListener('click', function () {
      off ^= 1 << i;
      paint();
    });
  });
  paint();
})();
</script>
</body></html>`);
}
