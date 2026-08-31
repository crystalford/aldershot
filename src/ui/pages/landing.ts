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

import { esc } from "../shell.ts";

const GOLD = "#D9B36A";
const GREEN = "#5EC98F";
const CYAN = "#5EB8C9";
const RED = "#E06A6A";
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

const JOBS: Job[] = [
  {
    name: "Clips",
    color: GREEN,
    body: "Point it at a video, get the moments back — scored, tagged, saved. No timeline, nothing to manage.",
    example: "get the clip where she nails the one-line answer",
  },
  {
    name: "Cuts",
    color: GOLD,
    body: "An hour becomes nine minutes. It cuts first; you fix anything by reading the text and striking lines.",
    example: "tighten this webinar down to the actual demo",
  },
  {
    name: "Reactions",
    color: RED,
    body: "It finds what's worth responding to and leaves a recording slot after each moment. Your commentary, without OBS.",
    example: "react to every big claim in this keynote",
  },
  {
    name: "Essays",
    color: CYAN,
    body: "Long pieces built beat by beat — clips you've kept, your narration, one through-line across many sources.",
    example: "an essay on why every city ripped out its trams",
  },
];

const STEPS = [
  {
    n: "01",
    name: "Drop it",
    body: "A file or a link, plus one sentence about what you want. It reads the whole thing — every word, timestamped.",
  },
  {
    n: "02",
    name: "Decide",
    body: "It shows you what it found and why. You keep, cut, and reorder by reading — Space plays, arrows step through.",
  },
  {
    n: "03",
    name: "It's done",
    body: "Rendered with captions burned in. Download it, share a review link, cut shorts off it — and everything you kept stays for next time.",
  },
];

/* Two lines kept, two struck — the claim of the product, shown rather than said. */
const TRANSCRIPT = [
  { ts: "41:20", text: "Nobody plans to run a marathon. You plan to run a mile.", cut: false },
  { ts: "41:26", text: "And, um, I mean — sorry, you know what I'm trying to say—", cut: true },
  { ts: "41:31", text: "Then the mile becomes the habit.", cut: false },
  { ts: "41:33", text: "Anyway. Where was I. Someone in the chat asked—", cut: true },
  { ts: "41:39", text: "That's the whole trick. Start smaller than feels serious.", cut: false },
];

const HITS = [
  { text: "“Fine — yes, we moved the launch before the review came in.”", match: "94%", color: GREEN },
  { text: "“The roadmap slide was aspirational. Very aspirational.”", match: "91%", color: GREEN },
  { text: "“We script the ‘unscripted’ Q&A. Everyone does.”", match: "86%", color: GOLD },
];

const FREE_FEATS = [
  "300 processing minutes a month",
  "25 GB of permanent storage",
  "Clips, cuts, reactions, essays — all of it",
  "Review links and webhook handoff",
];

const PRO_FEATS = [
  "1,200 processing minutes a month",
  "100 GB of permanent storage, add-ons beyond",
  "Overnight queue — it works while you sleep",
  "4K renders",
  "Bring your own storage bucket",
];

const FAQ = [
  {
    q: "Do I need to know how to edit?",
    a: "If you can read, you can cut. The editor is the transcript — strike what you don't want, keep what you do. There's no timeline to learn, and the first pass is already done when you arrive.",
  },
  {
    q: "What happens to my footage?",
    a: "Nothing expires, ever. Sources count against your storage; everything cut from them — clips, transcripts, finished pieces — is a fraction of the size and stays regardless. You can also point sources at a bucket you own.",
  },
  {
    q: "Can it post to YouTube and TikTok for me?",
    a: "It hands off instead of posting: download the file, or set a webhook and every finished piece POSTs to it — Zapier, Make, n8n, or your own endpoint takes it from there. We'd rather do handoff honestly than fake a publish button.",
  },
  {
    q: "What's a processing minute?",
    a: "A minute of work: reading footage, rendering a cut, burning captions. A one-hour video costs roughly its length to read once — after that, cutting and re-cutting from it is nearly free.",
  },
  {
    q: "Whose videos can I use?",
    a: "Yours, and anything you have the right to work with — your recordings, streams, podcasts, or material you're commenting on within fair use. What you upload is yours; we never train on it or share it.",
  },
];

/** The wordmark: three bars at falling opacity, the same mark the app uses. */
function mark(size: number, gold = GOLD): string {
  const bar = (o: number) =>
    `<span style="width:${size === 15.5 ? 5.5 : 4.5}px;height:${size === 15.5 ? 11 : 10}px;background:${gold};opacity:${o};border-radius:2px"></span>`;
  return `<span style="display:inline-flex;align-items:flex-end;gap:${size === 15.5 ? 2.5 : 2}px;transform:translateY(-1px)">${bar(1)}${bar(0.5)}${bar(0.22)}</span>`;
}

/**
 * The sign-in form. Every CTA on the page targets it.
 *
 * It posts rather than opening the app, because there is no app to open until
 * a link has been followed — a "Start free" button that 302s to a login page
 * would be the same click with an extra step.
 */
function signInForm(id: string, buttonLabel: string, primary: boolean, google: boolean): string {
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
      <input name="email" type="email" required placeholder="you@example.com" aria-label="Your email" style="flex:0 1 260px;min-width:min(220px,100%);background:#1A1A1F;border:none;outline:none;color:#ECECF1;font-size:14px;padding:12px 14px;border-radius:5px;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.08);font-family:inherit"/>
      <button type="submit" style="flex:none;font-size:14.5px;font-weight:600;padding:12px 26px;border-radius:5px;background:${primary && !google ? "#ECECF1" : "#232329"};color:${primary && !google ? "#131316" : "#ECECF1"};white-space:nowrap;border:none;cursor:pointer;font-family:inherit">${google ? "Email me a link" : buttonLabel}</button>
    </form>
  </div>`;
}

/**
 * The page a login link lands on.
 *
 * Deliberately a form, not an automatic sign-in: the token is spent by the
 * POST, so a mail scanner that fetches the URL cannot burn it. Nothing
 * automated submits a form.
 */
export function renderConfirm(token: string): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Sign in to Aldershot</title>
<meta name="robots" content="noindex"/>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&display=swap" rel="stylesheet"/>
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
</body></html>`;
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
      Check <strong style="color:#ECECF1">${esc(d.sentTo)}</strong> — the link works once and expires in 20 minutes.
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

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Aldershot — editing is reading now.</title>
<meta name="description" content="Drop an hour of video and say what you want out of it. Aldershot reads the whole thing and makes the first cut."/>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet"/>
<style>
  *{box-sizing:border-box}
  body{margin:0}
  a{text-decoration:none}
  html{scroll-behavior:smooth}
  ::-webkit-scrollbar{width:10px;height:10px}
  ::-webkit-scrollbar-track{background:#101013}
  ::-webkit-scrollbar-thumb{background:#2A2A31;border-radius:99px;border:2px solid #101013}
  @keyframes blip{0%,100%{opacity:1}50%{opacity:.25}}
</style>
</head>
<body>
<div style="min-height:100vh;background:#101013;color:#ECECF1;font-family:'Instrument Sans',sans-serif">

  <div style="border-bottom:1px solid rgba(255,255,255,0.05);position:sticky;top:0;background:rgba(16,16,19,0.86);backdrop-filter:blur(14px);z-index:5;${PAD}">
    <div style="${WRAP};display:flex;align-items:center;justify-content:space-between;gap:18px;height:58px">
      <div style="display:flex;align-items:baseline;gap:4px;font-weight:600;font-size:15.5px;letter-spacing:-0.01em">aldershot${mark(15.5)}</div>
      <div style="display:flex;align-items:center;gap:clamp(14px,2.4vw,26px);font-size:13.5px">
        <a href="#what" style="color:rgba(236,236,241,0.55);font-weight:500;white-space:nowrap">What it does</a>
        <a href="#how" style="color:rgba(236,236,241,0.55);font-weight:500;white-space:nowrap">How it works</a>
        <a href="#pricing" style="color:rgba(236,236,241,0.55);font-weight:500;white-space:nowrap">Pricing</a>
        <a href="#start" style="font-size:13px;font-weight:600;padding:8px 16px;border-radius:5px;background:#ECECF1;color:#131316;white-space:nowrap">Start free</a>
      </div>
    </div>
  </div>

  <div style="${PAD}">
    <div style="${WRAP};padding:clamp(64px,10vw,110px) 0 clamp(48px,7vw,72px);text-align:center">
      <div style="${EYEBROW};color:${GOLD}">NO TIMELINE · NO SCRUBBING · NO NLE</div>
      <h1 style="margin:18px auto 0;max-width:820px;font-size:clamp(34px,6vw,62px);font-weight:700;letter-spacing:-0.035em;line-height:1.05">Editing is<br>reading now.</h1>
      <p style="margin:20px auto 0;max-width:560px;font-size:clamp(15px,2vw,17.5px);color:rgba(236,236,241,0.55);line-height:1.6">Drop an hour of video and say what you want out of it. Aldershot reads the whole thing and makes the first cut — you strike what's weak, keep what's good, and it's done.</p>
      <div id="start" style="margin-top:28px">${signInForm("hero-form", "Start cutting — free", true, d.google)}</div>
      <div style="margin-top:10px;font-size:12px;color:rgba(236,236,241,0.3)">No card. 300 processing minutes a month on the house.</div>
      ${notice(d)}

      <div style="margin:clamp(40px,6vw,64px) auto 0;max-width:760px;text-align:left;background:#1A1A1F;border-radius:12px;padding:6px;box-shadow:0 0 0 1px rgba(255,255,255,0.06), 0 24px 80px rgba(0,0,0,0.5)">
        <div style="padding:16px 16px 12px;font-size:16.5px;line-height:1.5;color:#ECECF1;min-height:52px">Every time the guest actually answers the question — one tight supercut.</div>
        <div style="display:flex;gap:10px;align-items:center;padding:10px 8px 6px 16px;border-top:1px solid rgba(255,255,255,0.05);flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:10px;flex:1 1 220px;min-width:0">
            <div style="flex:none;width:46px;aspect-ratio:16/9;border-radius:4px;overflow:hidden;background:#07070a;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.08)"><img src="/assets/frame-2.png" alt="" style="width:100%;height:100%;object-fit:cover;display:block"/></div>
            <span style="font-size:12px;color:rgba(236,236,241,0.6);font-family:${MONO};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">podcast_ep_141_full.mp4 · 1.2 GB</span>
          </div>
          <div style="flex:none;font-size:13.5px;font-weight:600;padding:9px 22px;border-radius:5px;background:#ECECF1;color:#131316;white-space:nowrap">Begin →</div>
        </div>
      </div>
      <div style="margin-top:14px;display:flex;gap:8px;justify-content:center;align-items:center;font-size:12px;color:rgba(236,236,241,0.35)">
        <span style="width:6px;height:6px;border-radius:50%;background:${GREEN};animation:blip 1.6s ease-in-out infinite;flex:none"></span>
        <span>Reads as a cut — this becomes a project you can come back to.</span>
      </div>
    </div>
  </div>

  <div id="what" style="${PAD}">
    <div style="${WRAP};padding:clamp(40px,6vw,64px) 0">
      <div style="${EYEBROW};color:rgba(236,236,241,0.35)">ONE INTAKE · FOUR THINGS OUT</div>
      <h2 style="margin:14px 0 0;font-size:clamp(24px,3.4vw,34px);font-weight:600;letter-spacing:-0.025em;max-width:640px;line-height:1.15">It reads the sentence and works out the job.</h2>
      <div style="margin-top:32px;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:8px">${JOBS.map(jobCard).join("")}</div>
      <div style="margin-top:20px;padding:16px 18px;border-radius:9px;background:#141418;box-shadow:inset 0 0 0 1px rgba(217,179,106,0.18);font-size:13.5px;color:rgba(236,236,241,0.6);line-height:1.6">Ask for clips and there's nothing to manage — they land in your footage, tagged. Ask for a cut, a reaction, or an essay and it becomes a project you can put down and pick back up.</div>
    </div>
  </div>

  <div id="how" style="${PAD};background:#0C0C0F">
    <div style="${WRAP};padding:clamp(48px,7vw,80px) 0">
      <div style="${EYEBROW};color:rgba(236,236,241,0.35)">HOW IT WORKS</div>
      <h2 style="margin:14px 0 0;font-size:clamp(24px,3.4vw,34px);font-weight:600;letter-spacing:-0.025em;line-height:1.15">You never scrub a timeline.<br>You read, and you decide.</h2>
      <div style="margin-top:36px;display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:8px">
        ${STEPS.map(
          (s) => `<div style="padding:22px 20px;border-radius:11px;background:#131317">
            <span style="font-size:12px;font-family:${MONO};color:rgba(236,236,241,0.3)">${s.n}</span>
            <div style="font-size:15.5px;font-weight:600;margin-top:10px">${s.name}</div>
            <div style="font-size:13px;color:rgba(236,236,241,0.5);line-height:1.6;margin-top:7px">${s.body}</div>
          </div>`,
        ).join("")}
      </div>

      <div style="margin-top:44px;display:flex;gap:clamp(20px,4vw,44px);align-items:center;flex-wrap:wrap">
        <div style="flex:1 1 320px;min-width:min(300px,100%)">
          <div style="${EYEBROW};color:${GREEN}">EDIT BY READING</div>
          <h3 style="margin:12px 0 0;font-size:clamp(20px,2.6vw,26px);font-weight:600;letter-spacing:-0.02em;line-height:1.2">Cut a sentence like you'd delete a sentence.</h3>
          <p style="margin:12px 0 0;font-size:14px;color:rgba(236,236,241,0.5);line-height:1.65">The whole video is text. Strike a line and it's out of the cut. Keep a moment and it's saved forever — timestamped, tagged, and searchable by what was said, not what you named the file.</p>
        </div>
        <div style="flex:1 1 340px;min-width:min(320px,100%);background:#17171B;border-radius:11px;padding:20px;font-size:13.5px;line-height:2">
          ${TRANSCRIPT.map(
            (t) => `<div style="display:flex;gap:12px;align-items:baseline">
              <span style="flex:none;font-size:10.5px;font-family:${MONO};color:rgba(236,236,241,0.25)">${t.ts}</span>
              <span style="color:rgba(236,236,241,${t.cut ? "0.28" : "0.9"});text-decoration:${t.cut ? "line-through" : "none"}">${t.text}</span>
            </div>`,
          ).join("")}
          <div style="margin-top:10px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.06);display:flex;justify-content:space-between;font-size:11.5px;font-family:${MONO};color:rgba(236,236,241,0.35)">
            <span>41:20 → 9:04</span><span style="color:${GREEN}">3 kept · 2 cut</span>
          </div>
        </div>
      </div>

      <div style="margin-top:44px;display:flex;gap:clamp(20px,4vw,44px);align-items:center;flex-wrap:wrap-reverse">
        <div style="flex:1 1 340px;min-width:min(320px,100%);background:#17171B;border-radius:11px;padding:20px;display:flex;flex-direction:column;gap:6px">
          <div style="display:flex;align-items:center;gap:10px;padding:11px 13px;border-radius:8px;background:#101014">
            <img src="/assets/frame-1.png" alt="" style="width:52px;aspect-ratio:16/9;border-radius:4px;object-fit:cover;flex:none"/>
            <span style="font-size:12.5px;color:rgba(236,236,241,0.75);flex:1;min-width:0">"By 2030 nobody will own a car in this city."</span>
            <span style="flex:none;font-size:10.5px;font-family:${MONO};color:rgba(236,236,241,0.3)">0:18</span>
          </div>
          <div style="display:flex;align-items:center;gap:10px;padding:11px 13px;border-radius:8px;background:#141418;box-shadow:inset 0 0 0 1px rgba(224,106,106,0.3)">
            <span style="flex:none;width:8px;height:8px;border-radius:50%;background:${RED};animation:blip 1.2s ease-in-out infinite"></span>
            <span style="font-size:12.5px;color:rgba(236,236,241,0.75);flex:1">Your take goes here — on camera or voice only</span>
            <span style="flex:none;font-size:10.5px;font-weight:600;color:${RED};font-family:${MONO}">REC</span>
          </div>
          <div style="display:flex;align-items:center;gap:10px;padding:11px 13px;border-radius:8px;background:#101014">
            <img src="/assets/frame-4.png" alt="" style="width:52px;aspect-ratio:16/9;border-radius:4px;object-fit:cover;flex:none"/>
            <span style="font-size:12.5px;color:rgba(236,236,241,0.75);flex:1;min-width:0">"The data says the opposite of what he just said."</span>
            <span style="flex:none;font-size:10.5px;font-family:${MONO};color:rgba(236,236,241,0.3)">0:41</span>
          </div>
        </div>
        <div style="flex:1 1 320px;min-width:min(300px,100%)">
          <div style="${EYEBROW};color:${RED}">REACT WITHOUT OBS</div>
          <h3 style="margin:12px 0 0;font-size:clamp(20px,2.6vw,26px);font-weight:600;letter-spacing:-0.02em;line-height:1.2">It makes the room for your reaction.</h3>
          <p style="margin:12px 0 0;font-size:14px;color:rgba(236,236,241,0.5);line-height:1.65">Tell it what you're reacting to and it breaks the video into the moments that deserve a response — with a recording slot between each one. No screen capture, no pausing in real time, no sync. Read your take, or go off script.</p>
        </div>
      </div>

      <div style="margin-top:44px;display:flex;gap:clamp(20px,4vw,44px);align-items:center;flex-wrap:wrap">
        <div style="flex:1 1 320px;min-width:min(300px,100%)">
          <div style="${EYEBROW};color:${CYAN}">FOOTAGE THAT REMEMBERS</div>
          <h3 style="margin:12px 0 0;font-size:clamp(20px,2.6vw,26px);font-weight:600;letter-spacing:-0.02em;line-height:1.2">Every clip you keep makes the next thing faster.</h3>
          <p style="margin:12px 0 0;font-size:14px;color:rgba(236,236,241,0.5);line-height:1.65">Kept clips sort themselves into threads by what's being said. Months later, ask "every time he contradicts himself" and it hands you the receipts — across every video you've ever fed it. That's how a clip becomes a supercut, and a supercut becomes an essay.</p>
        </div>
        <div style="flex:1 1 340px;min-width:min(320px,100%);background:#17171B;border-radius:11px;padding:20px">
          <div style="font-size:12.5px;color:rgba(236,236,241,0.4);font-family:${MONO}">"when someone admits the plan changed"</div>
          <div style="margin-top:14px;display:flex;flex-direction:column;gap:6px">
            ${HITS.map(
              (h) => `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;background:#101014">
                <span style="flex:none;width:6px;height:6px;border-radius:50%;background:${h.color}"></span>
                <span style="font-size:12.5px;color:rgba(236,236,241,0.8);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h.text}</span>
                <span style="flex:none;font-size:10.5px;font-family:${MONO};color:${h.color}">${h.match}</span>
              </div>`,
            ).join("")}
          </div>
        </div>
      </div>
    </div>
  </div>

  <div style="${PAD}">
    <div style="${WRAP};padding:clamp(48px,7vw,80px) 0;text-align:center">
      <div style="${EYEBROW};color:${GREEN}">THE FINISH LINE</div>
      <h2 style="margin:14px auto 0;font-size:clamp(24px,3.4vw,34px);font-weight:600;letter-spacing:-0.025em;max-width:560px;line-height:1.15">Done means done.</h2>
      <p style="margin:14px auto 0;max-width:520px;font-size:14px;color:rgba(236,236,241,0.5);line-height:1.65">Every render lands with everything it needs to leave: download it, cut shorts off it, send it to your own webhook, or hand a review link to anyone — they watch and drop timestamped notes, no account needed. Nothing you upload ever expires.</p>
      <div style="margin:32px auto 0;max-width:640px;text-align:left;border-radius:11px;overflow:hidden;background:#141418;box-shadow:inset 0 0 0 1px rgba(94,201,143,0.24)">
        <div style="display:flex;gap:18px;padding:18px;flex-wrap:wrap;align-items:center">
          <div style="flex:none;width:min(200px,100%);aspect-ratio:16/9;border-radius:7px;overflow:hidden;background:#07070a;position:relative">
            <img src="/assets/frame-1.png" alt="" style="width:100%;height:100%;object-fit:cover;display:block"/>
            <div style="position:absolute;left:8px;bottom:8px;font-size:10.5px;font-family:${MONO};color:rgba(255,255,255,0.85);background:rgba(0,0,0,0.55);padding:2px 6px;border-radius:4px">9:04</div>
          </div>
          <div style="flex:1 1 220px;min-width:min(200px,100%)">
            <div style="font-size:10.5px;font-weight:600;letter-spacing:.04em;color:${GREEN};font-family:${MONO}">IT'S DONE</div>
            <div style="font-size:17px;font-weight:600;margin-top:5px">The Long Way Round</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px">
              <span style="font-size:12px;font-weight:600;padding:7px 14px;border-radius:5px;background:#ECECF1;color:#131316">Download it</span>
              <span style="font-size:12px;font-weight:500;padding:7px 12px;border-radius:5px;background:#232329;color:#ECECF1">Share for review</span>
              <span style="font-size:12px;font-weight:500;padding:7px 12px;border-radius:5px;background:#232329;color:rgba(236,236,241,0.7)">Cut shorts from it</span>
            </div>
          </div>
        </div>
        <div style="padding:11px 18px;background:#111114;font-size:11.5px;color:rgba(236,236,241,0.35)">6 clips from 2 sources · 2 of your own · aldershot.to/r/the-long-way-round-9c2b</div>
      </div>
    </div>
  </div>

  <div id="pricing" style="${PAD};background:#0C0C0F">
    <div style="${WRAP};padding:clamp(48px,7vw,80px) 0">
      <div style="text-align:center">
        <div style="${EYEBROW};color:rgba(236,236,241,0.35)">PRICING</div>
        <h2 style="margin:14px 0 0;font-size:clamp(24px,3.4vw,34px);font-weight:600;letter-spacing:-0.025em">Pay for the minutes it works.</h2>
        <p style="margin:12px auto 0;max-width:460px;font-size:14px;color:rgba(236,236,241,0.5);line-height:1.6">A processing minute is a minute spent reading footage, rendering cuts, or burning captions. Storage is permanent on every plan.</p>
      </div>
      <div style="margin:36px auto 0;display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px;max-width:720px">
        <div style="padding:26px 24px;border-radius:12px;background:#131317">
          <div style="font-size:15.5px;font-weight:600">Free</div>
          <div style="margin-top:10px;font-size:32px;font-weight:700;letter-spacing:-0.03em">$0</div>
          <div style="font-size:12.5px;color:rgba(236,236,241,0.4);margin-top:3px">forever</div>
          <div style="margin-top:18px;display:flex;flex-direction:column;gap:9px">${FREE_FEATS.map((t) => feat(t, GREEN)).join("")}</div>
          <a href="#start" style="display:block;text-align:center;margin-top:22px;font-size:13.5px;font-weight:600;padding:11px;border-radius:5px;background:#232329;color:#ECECF1;white-space:nowrap">Start free</a>
        </div>
        <div style="padding:26px 24px;border-radius:12px;background:#17171B;box-shadow:inset 0 0 0 1px rgba(217,179,106,0.3)">
          <div style="display:flex;align-items:center;gap:8px"><span style="font-size:15.5px;font-weight:600">Studio</span><span style="font-size:10.5px;font-weight:600;padding:2px 7px;border-radius:4px;background:rgba(217,179,106,0.16);color:${GOLD};white-space:nowrap">MOST GET THIS</span></div>
          <div style="margin-top:10px;font-size:32px;font-weight:700;letter-spacing:-0.03em">$29</div>
          <div style="font-size:12.5px;color:rgba(236,236,241,0.4);margin-top:3px">a month</div>
          <div style="margin-top:18px;display:flex;flex-direction:column;gap:9px">${PRO_FEATS.map((t) => feat(t, GOLD)).join("")}</div>
          <a href="#start" style="display:block;text-align:center;margin-top:22px;font-size:13.5px;font-weight:600;padding:11px;border-radius:5px;background:#ECECF1;color:#131316;white-space:nowrap">Start with Studio</a>
        </div>
      </div>
      <div style="margin-top:16px;text-align:center;font-size:12px;color:rgba(236,236,241,0.3)">Need more room? Storage add-ons, or point sources at a bucket you own.</div>
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
            <div style="padding:0 18px 16px;font-size:13.5px;color:rgba(236,236,241,0.55);line-height:1.65">${f.a}</div>
          </details>`,
        ).join("")}
      </div>
    </div>
  </div>

  <div style="${PAD};background:#0C0C0F">
    <div style="${WRAP};padding:clamp(56px,8vw,90px) 0;text-align:center">
      <h2 style="margin:0 auto;font-size:clamp(26px,4vw,40px);font-weight:700;letter-spacing:-0.03em;max-width:600px;line-height:1.1">The footage is sitting there.<br>Go read it into a video.</h2>
      <div style="margin-top:26px">${signInForm("footer-form", "Start cutting — free", true, d.google)}</div>
      <div style="margin-top:52px;padding-top:22px;border-top:1px solid rgba(255,255,255,0.05);display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;font-size:12.5px;color:rgba(236,236,241,0.3)">
        <span style="display:flex;align-items:baseline;gap:4px;font-weight:600;color:rgba(236,236,241,0.5)">aldershot${mark(12.5, "rgba(217,179,106,0.85)")}</span>
        <span>Clips · Cuts · Reactions · Essays</span>
      </div>
    </div>
  </div>
</div>
</body></html>`;
}
