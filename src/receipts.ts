/**
 * RECEIPTS, FOR THE PERSON WATCHING.
 *
 * `09-EXPORT-AND-INTEGRITY.md`: "The evidence ledger is also a receipts page
 * published with the video: moment, quote, original link, verification state.
 * 'The edit you can interrogate' is a promise to the AUDIENCE, not just the
 * maker."
 *
 * Everything else this product exports is read by the person who made the
 * cut. This one is read by strangers, from a link in a video description, and
 * that changes three things.
 *
 * IT IS PUBLIC, so it is the only thing here that has to be an explicit act.
 * A page nobody asked to publish would put somebody's footage in front of the
 * world because they pressed Export. Publishing is a press, and taking it
 * down is another.
 *
 * IT IS WRITTEN FOR SOMEBODY WHO DOES NOT TRUST IT. A viewer arriving here
 * has usually arrived because they doubt something, so every row carries the
 * link to the original and says plainly whether the quote was checked. A row
 * that reads "nobody checked this" is the page doing its job, not a defect in
 * it — invariant 4 again: "nothing backs this" has to be a reachable answer,
 * and the audience is who it has to be reachable BY.
 *
 * IT CARRIES NOTHING IT WAS NOT ASKED TO. The maker's own transcript, their
 * rules, their left-out lines and their unused footage are all in the
 * manifest, and none of it belongs on a public page. What is here is what was
 * quoted from other people, and the pictures that are not photographs of
 * anything.
 */

import type { CueEntry } from "./cuesheet.ts";
import type { DisputeEntry } from "./dispute.ts";

/** How a verification state reads to somebody who has never heard of Scout. */
export function verifiedSays(verify: string | null | undefined): string {
  if (verify === "verified") return "Checked word for word against the source.";
  if (verify === "paraphrase") return "Close to the source, but not word for word.";
  if (verify === "rejected") return "Could not be matched to the source.";
  return "Nobody checked this against the source.";
}

/** True only for the one state that is a clean match. */
export const isChecked = (verify: string | null | undefined): boolean => verify === "verified";

export interface Receipt {
  /** Who said it. */
  who: string;
  /** What they said, word for word where that was checked. */
  quote: string;
  /** Where in the original, as a clock. */
  at: string;
  /** The original, so a viewer can go and look. */
  url: string | null;
  verify: string | null;
  says: string;
}

export interface ReceiptsPage {
  title: string;
  claim: string | null;
  receipts: Receipt[];
  pictures: Array<{ label: string; what: string; how: string }>;
  /** How many of the receipts were checked word for word. */
  checked: number;
}

const clock = (s: number): string => {
  const n = Math.max(0, Math.round(s));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(n % 60).padStart(2, "0")}`;
};

export function receiptsPage(opts: {
  title: string;
  claim: string | null;
  external: DisputeEntry[];
  pictures: CueEntry[];
}): ReceiptsPage {
  const receipts = opts.external.map((e) => ({
    who: e.channel ?? e.sourceTitle ?? "An unnamed source",
    quote: e.quote,
    at: clock(e.inS),
    url: e.url,
    verify: e.verify ?? null,
    says: verifiedSays(e.verify),
  }));
  return {
    title: opts.title,
    claim: opts.claim,
    receipts,
    pictures: opts.pictures.map((p) => ({ label: p.label, what: p.what, how: p.how })),
    checked: receipts.filter((r) => isChecked(r.verify)).length,
  };
}

/** Escapes for HTML. A quote is somebody else's text and goes on a public page. */
export const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * ONLY http(s), and never javascript: or data:.
 *
 * These urls come from rows Scout wrote about other people's websites, and
 * they land in an href on a page served from this product's own origin. A
 * `javascript:` url there is a cross-site scripting hole with a long gap
 * between writing it and noticing.
 */
export function safeUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * The page itself.
 *
 * Plain, self-contained HTML with no scripts and no fonts to fetch: it is
 * read once by somebody who followed a link to check one thing, often on a
 * phone, and it should open before they change their mind.
 */
export function receiptsHtml(p: ReceiptsPage): string {
  const rows = p.receipts
    .map((r) => {
      const href = safeUrl(r.url);
      const link = href
        ? `<a href="${esc(href)}" rel="nofollow noopener ugc">Go and watch it yourself &nearr;</a>`
        : `<span class="no">No link was recorded for this one.</span>`;
      return `<li>
      <p class="who">${esc(r.who)} <span class="at">at ${esc(r.at)}</span></p>
      <blockquote>${esc(r.quote)}</blockquote>
      <p class="state ${isChecked(r.verify) ? "yes" : "no"}">${esc(r.says)}</p>
      <p class="link">${link}</p>
    </li>`;
    })
    .join("\n");

  const pictures = p.pictures.length
    ? `<h2>Pictures that are not footage</h2>
    <ul class="pics">${p.pictures
      .map((x) => `<li><strong>${esc(x.label)}</strong> ${esc(x.what)} <span class="how">${esc(x.how)}</span></li>`)
      .join("")}</ul>`
    : "";

  const summary = p.receipts.length
    ? `${p.receipts.length} clip${p.receipts.length === 1 ? "" : "s"} in this video came from somebody else. ${p.checked} of ${p.receipts.length} ${p.checked === 1 ? "has" : "have"} been checked word for word against the original.`
    : "Every clip in this video is the maker's own footage.";

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Receipts — ${esc(p.title)}</title>
<meta name="robots" content="noindex">
<style>
  :root { color-scheme: dark light; }
  body { margin:0; padding:28px 20px 64px; background:#131316; color:#ececf1;
         font:16px/1.65 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif; }
  main { max-width: 680px; margin: 0 auto; }
  h1 { font-size:22px; letter-spacing:-0.02em; margin:0 0 4px; }
  h2 { font-size:14px; text-transform:uppercase; letter-spacing:0.08em;
       color:rgba(236,236,241,0.45); margin:36px 0 10px; font-weight:600; }
  .lede { color:rgba(236,236,241,0.6); margin:0 0 28px; }
  .claim { border-left:2px solid #d8b96a; padding-left:14px; margin:0 0 28px;
           color:rgba(236,236,241,0.85); }
  ul { list-style:none; margin:0; padding:0; }
  li { padding:18px 0; border-top:1px solid rgba(255,255,255,0.08); }
  .who { margin:0 0 8px; font-weight:600; }
  .at { font-weight:400; color:rgba(236,236,241,0.45); }
  blockquote { margin:0 0 8px; padding:0; color:#ececf1; }
  blockquote::before { content:"\\201C"; } blockquote::after { content:"\\201D"; }
  .state { margin:0 0 6px; font-size:14px; }
  .state.yes { color:#7fb98a; } .state.no { color:rgba(236,236,241,0.5); }
  .link, .how { font-size:14px; margin:0; }
  a { color:#d8b96a; }
  .pics li { border:0; padding:6px 0; }
  footer { margin-top:44px; padding-top:18px; border-top:1px solid rgba(255,255,255,0.08);
           color:rgba(236,236,241,0.4); font-size:13px; }
  @media (prefers-color-scheme: light) {
    body { background:#faf9f7; color:#1b1b1f; }
    .lede,.at,.state.no,footer { color:rgba(27,27,31,0.55); }
    blockquote,.claim { color:#1b1b1f; }
    li { border-color:rgba(0,0,0,0.1); }
  }
</style>
</head><body><main>
  <h1>Receipts — ${esc(p.title)}</h1>
  <p class="lede">${esc(summary)}</p>
  ${p.claim ? `<p class="claim">${esc(p.claim)}</p>` : ""}
  ${p.receipts.length ? `<h2>Where each quote came from</h2><ul>${rows}</ul>` : ""}
  ${pictures}
  <footer>
    This page lists what this video quoted and where from. It does not list the
    maker's own footage, and it cannot tell you whether a quote is fair — only
    whether the words are there, at that time, in that source.
  </footer>
</main></body></html>`;
}
