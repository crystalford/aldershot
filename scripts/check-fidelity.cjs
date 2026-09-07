/**
 * The three static fidelity checks from design/docs/PROMPTING-NOTES.md.
 * (Check #1, the screenshot diff, is scripts/shoot.cjs — it needs eyes.)
 *
 *   2. Every icon, with its source. If the answer is a library name, it's wrong.
 *   3. Hardcoded hex codes, diffed against the token list.
 *   4. Every user-facing string, diffed against the prototype.
 *
 * These exist because the previous build of this product passed every
 * feature test and still shipped a different-feeling product. Substitution is
 * the failure mode, not omission: a missing feature is obvious in review, a
 * swapped icon set or a rounded font size is invisible.
 *
 *   node scripts/check-fidelity.cjs
 *
 * Exits non-zero on any finding.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
/*
 * Both prototypes. The app is Aldershot.dc.html; the signed-out marketing site
 * is Landing.dc.html, and it has its own palette (#0C0C0F section grounds) and
 * its own width (1080px, not the app's 960). Checking src/ui/pages/landing.ts
 * against the app prototype alone reported both of those as inventions.
 */
const APP_PROTO = fs.readFileSync(path.join(ROOT, 'design/Aldershot.dc.html'), 'utf8');
const LANDING_PROTO = fs.readFileSync(path.join(ROOT, 'design/Landing.dc.html'), 'utf8');
const PROTO = APP_PROTO + '\n' + LANDING_PROTO;
const TOKENS = fs.readFileSync(path.join(ROOT, 'src/ui/tokens.ts'), 'utf8');

let findings = 0;
function fail(check, msg, detail) {
  findings++;
  console.log(`\n✘ ${check}\n  ${msg}`);
  if (detail) console.log(detail.split('\n').map((l) => '    ' + l).join('\n'));
}
function pass(check, msg) {
  console.log(`✔ ${check} — ${msg}`);
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}
const UI_FILES = walk(path.join(ROOT, 'src/ui'));

/* ── 2. Icons ──────────────────────────────────────────────────────────── */
{
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const LIBS = /icon|lucide|feather|heroicon|phosphor|remix|tabler|font-?awesome|material-symbols/i;
  const offenders = Object.keys(deps).filter((d) => LIBS.test(d));
  if (offenders.length) {
    fail('icons', 'An icon library is installed. The design has eight hand-written SVGs and no library.', offenders.join('\n'));
  }

  // Every <svg> in the UI must originate in icons.ts — nowhere else.
  const strays = [];
  for (const f of UI_FILES) {
    if (f.endsWith('icons.ts')) continue;
    const src = fs.readFileSync(f, 'utf8');
    if (/<svg/.test(src)) strays.push(path.relative(ROOT, f));
  }
  if (strays.length) {
    fail('icons', 'Inline <svg> found outside src/ui/icons.ts. Every icon must come from there.', strays.join('\n'));
  }

  // Each icon's geometry must appear verbatim in the prototype.
  const icons = fs.readFileSync(path.join(ROOT, 'src/ui/icons.ts'), 'utf8');
  const paths = [...icons.matchAll(/<(?:path|circle|rect|line)\b[^>]*\/?>/g)].map((m) => m[0]);
  const missing = paths.filter((p) => {
    const d = p.match(/\sd="([^"]+)"/);
    if (d) return !PROTO.includes(d[1]);
    const cx = p.match(/cx="([^"]+)"[^>]*cy="([^"]+)"[^>]*r="([^"]+)"/);
    if (cx) return !PROTO.includes(`cx="${cx[1]}" cy="${cx[2]}" r="${cx[3]}"`);
    return false;
  });
  if (missing.length) {
    fail('icons', 'Icon geometry not found in the prototype — it was redrawn, not copied.', missing.join('\n'));
  }
  if (!offenders.length && !strays.length && !missing.length) {
    pass('icons', `${paths.length} shapes, all from src/ui/icons.ts, all matching the prototype`);
  }
}

/* ── 3. Hex codes ──────────────────────────────────────────────────────── */
{
  const declared = new Set([...TOKENS.matchAll(/#[0-9A-Fa-f]{6}\b/g)].map((m) => m[0].toUpperCase()));
  const bad = [];
  for (const f of UI_FILES) {
    if (f.endsWith('tokens.ts')) continue;
    const src = fs.readFileSync(f, 'utf8');
    src.split('\n').forEach((line, i) => {
      if (/^\s*\*/.test(line) || /^\s*\/\//.test(line)) return; // comments
      for (const m of line.matchAll(/#[0-9A-Fa-f]{6}\b/g)) {
        const hex = m[0].toUpperCase();
        if (declared.has(hex)) continue;
        // A raw hex is only acceptable if the prototype itself uses it here.
        if (!PROTO.toUpperCase().includes(hex)) {
          bad.push(`${path.relative(ROOT, f)}:${i + 1}  ${m[0]}  (not a token, not in the prototype)`);
        }
      }
    });
  }
  if (bad.length) fail('hex', 'Hardcoded colours that are neither tokens nor in the prototype.', bad.join('\n'));
  else pass('hex', `${declared.size} tokens declared; no invented colours in src/ui`);
}

/* ── 4. Strings ────────────────────────────────────────────────────────── */
/*
 * Checked against RENDERED output, not source. An earlier version of this
 * check scanned double-quoted string literals and missed every paraphrase,
 * because almost all prose in this codebase lives inside template literals.
 * Rendering the real pages and reading their text nodes catches prose no
 * matter how it is written.
 *
 * Needs the dev server. Without it this check is SKIPPED and says so — a
 * silent skip would be worse than no check at all.
 */
/**
 * WIRING — every control reaches code, and every handler reaches a control.
 *
 * The other four checks compare what we render against the design. None of
 * them can see a button that renders perfectly and does nothing, which is the
 * failure that has actually bitten, repeatedly:
 *
 *   - the recorder bound to #build, a surface deleted with the old editor —
 *     twice, so recording a voiceover was impossible for two rebuilds;
 *   - renderEditor, build.ts and script.ts imported and never called, while
 *     the walk drove their selectors and reported "0 blocks" on pages with 24;
 *   - renderFootage, a dead near-copy edited twice instead of the live one.
 *
 * Each was invisible to typecheck, tests and every fidelity check. Both halves
 * below are cheap and would have caught all of them:
 *
 *   ids   — the client looks for an element no page renders  (a dead handler)
 *   classes — a page renders a control the client never reads (a dead button)
 *
 * Presentational classes are exempt by allowlist, because a styling hook is
 * not a control and there is no way to tell from the markup alone.
 */
/*
 * A backtick inside client.ts.
 *
 * The file is one String.raw template, so a backtick anywhere in it — in a
 * string, in a comment, quoting a line of code in prose — closes the template
 * early and the build fails with an error pointing at whatever follows. It
 * happened four times in one session, twice in comments, and each time cost a
 * dead dev server and a confusing esbuild message before the cause was
 * obvious. It is one line to check and it can never happen again.
 */
function checkTemplate() {
  const file = path.join(ROOT, 'src/ui/client.ts');
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const open = lines.findIndex((l) => l.includes('String.raw`'));
  if (open < 0) {
    fail('template', 'src/ui/client.ts no longer opens with String.raw` — this check is out of date.');
    return;
  }
  const strays = [];
  for (let i = open + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '`;') break;
    if (line.includes('`')) strays.push((i + 1) + ': ' + line.trim().slice(0, 90));
  }
  if (strays.length) {
    fail(
      'template',
      'A backtick inside client.ts closes its String.raw template early. Comments count.',
      strays.join('\n'),
    );
  } else {
    pass('template', 'no backtick escapes the String.raw body of client.ts');
  }
}

function checkWiring() {
  const client = fs.readFileSync(path.join(ROOT, 'src/ui/client.ts'), 'utf8');
  const pageFiles = walk(path.join(ROOT, 'src/ui')).filter((f) => !f.endsWith('client.ts'));
  const pages = pageFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');

  /* Ids the client hunts for, against ids anything renders. */
  const wanted = [...new Set([...client.matchAll(/(?:\$|document\.querySelector)\("#([A-Za-z0-9_-]+)"\)/g)].map((m) => m[1]))];
  /* Some elements the client builds itself — the upload chip is created on
     first use and appended to the body, so no page renders it and it is not
     orphaned. Anything client.ts assigns an id to counts as rendered. */
  const madeInJs = new Set([...client.matchAll(/\.id\s*=\s*"([A-Za-z0-9_-]+)"/g)].map((m) => m[1]));
  const orphanIds = wanted.filter((id) => !madeInJs.has(id) && !new RegExp(`id="${id}"`).test(pages));

  /* Classes rendered on something interactive, against classes the client
     references. A class on a plain div is styling; a class on a button, a
     form, or something with a role is a control that has to be reachable. */
  const INTERACTIVE = /<(?:button|form|input|textarea|select|a|audio|video)\b[^>]*class="([a-z][a-z0-9 -]*)"|class="([a-z][a-z0-9 -]*)"[^>]*role="button"/g;
  const rendered = new Set();
  for (const m of pages.matchAll(INTERACTIVE)) {
    for (const cls of (m[1] || m[2]).split(/\s+/)) if (cls) rendered.add(cls);
  }
  /* Hooks that exist for CSS or layout only. Each one is a deliberate
     exemption, not a way to quiet the check. */
  const PRESENTATIONAL = new Set(['chip', 'editor-aside', 'nav-anchor', 'sel-box', 'seg-pill', 'rec-bar', 'blk-frame']);
  const orphanClasses = [...rendered]
    .filter((c) => !PRESENTATIONAL.has(c))
    .filter((c) => !new RegExp(`["'.]${c.replace(/[-]/g, '\\-')}\\b`).test(client));

  /*
   * And the direction that actually caused the worst of these: a class the
   * CLIENT binds that no page renders. The recorder was bound to .record for
   * a whole rebuild while Build rendered .beat-action — the handler and the
   * route both existed and recording a voiceover was impossible.
   */
  const bound = [...new Set([
    ...[...client.matchAll(/querySelectorAll?\("\.([a-z][a-z0-9-]*)"/g)].map((m) => m[1]),
    ...[...client.matchAll(/\.closest\("\.([a-z][a-z0-9-]*)"/g)].map((m) => m[1]),
  ])];
  /* The same exemption the ids get, one line above: some markup the client
     builds itself — a search result, a floating action — so no page renders
     it and it is not orphaned. Anything client.ts puts a class on counts as
     rendered, exactly as anything it puts an id on does. */
  const classedInJs = new Set();
  for (const m of client.matchAll(/class=\\?["']([a-z][a-z0-9 -]*)\\?["']/g)) {
    for (const cls of m[1].split(/\s+/)) if (cls) classedInJs.add(cls);
  }
  const orphanHandlers = bound.filter(
    (c) => !classedInJs.has(c) && !new RegExp(`class="[^"]*\\b${c}\\b`).test(pages),
  );

  if (orphanIds.length || orphanClasses.length || orphanHandlers.length) {
    fail(
      'wiring',
      'A control and its code are not connected. Either it is dead and should go, or it was never wired.',
      [
        ...orphanIds.map((id) => `client.ts looks for #${id} — no page renders it`),
        ...orphanClasses.map((c) => `.${c} is rendered on a control — client.ts never reads it`),
        ...orphanHandlers.map((c) => `client.ts binds .${c} — no page renders it`),
      ].join('\n'),
    );
  } else {
    pass('wiring', `${wanted.length} ids and ${bound.length} classes bound, ${rendered.size} controls rendered — all connected`);
  }
}

async function checkStrings() {
  const BASE = process.env.BASE || 'http://localhost:8787';
  const ROUTES = ['/', '/projects', '/footage', '/footage?tab=sources', '/clipping', '/editor', '/settings'];

  let up = false;
  try {
    const r = await fetch(BASE + '/api/health');
    up = r.ok;
  } catch { up = false; }
  if (!up) {
    console.log(`\n⚠ strings — SKIPPED: no dev server at ${BASE}. Run \`npx wrangler dev --port 8787 --enable-containers=false\` and re-run.`);
    return;
  }

  const normalise = (s) => s.replace(/\s+/g, ' ').replace(/[\u2019']/g, "'").trim();
  const proto = normalise(PROTO.replace(/<[^>]+>/g, ' '));
  const protoRaw = normalise(PROTO);

  /*
   * Exact text nodes from the prototype, so a SHORT string has to match a
   * whole label rather than merely appear somewhere.
   *
   * This exists because "THE WORDS" passed while the prototype says "EDITING
   * THE WORDS" — a substring match, and a real defect that shipped. Long prose
   * still matches by substring, since it is often assembled from fragments,
   * but a short label now has to be a label that exists.
   */
  /*
   * A SHORT string has to sit on a real boundary in the prototype — wrapped in
   * quotes, or alone between two tags. Merely appearing somewhere is not
   * enough: "THE WORDS" passed that way while the prototype says "EDITING THE
   * WORDS", and the wrong pill shipped.
   *
   * Boundary matching rather than parsing, because scanning 4,000 lines for
   * quote PAIRS misaligns after any odd quote and silently loses real strings —
   * it dropped every stage-tab label when tried.
   */
  /*
   * Deliberate additions, each with the reason it exists.
   *
   * This list is the ONLY sanctioned way to add copy the prototype does not
   * contain, and it is kept tiny on purpose: the whole value of this check is
   * that it fails loudly on invented wording. Loosening the matcher instead
   * would have hidden the next paraphrase along with this one.
   */
  const SIGNED_OFF = new Map([
    [
      "\u2190 All videos",
      "Clipping opens a video rather than listing videos, the way the Editor " +
        "opens an edit. The prototype's Clipping never named the video it was " +
        "working on because its demo only ever has one; a real account has " +
        "nineteen, and arriving on a page headed 'Find clips in this' with no " +
        "'this' anywhere is the thing the owner reported.",
    ],
    ...[
      "Keep only the strongest points",
      "Where I actually make the point",
      "The funniest moments",
      "Cut the bits where I repeat myself",
      "Cut the false starts",
      "Cut anything I said better later",
      "Just the story, none of the setup",
      "Every question I ask",
    ].map((eg) => [
      eg,
      "An example instruction for the pass field. The prototype's three are " +
        "about its own demo — a podcast with a sponsor read and a guest " +
        "committing logical fallacies — so on a person talking to a camera " +
        "they are instructions about things that are not there, and an " +
        "example you cannot use teaches nothing about what the field takes. " +
        "These are the same gesture against any video, and they show the " +
        "range: selecting, tightening, and shaping by length or structure.",
    ]),
    [
      "Good morning.",
      "The prototype greets 'Good morning, Chris.' because its demo account " +
        "always has a name. A real account may not — an email address with no " +
        "separator yields no usable first name — and greeting someone by a " +
        "mangled surname-mashup, or by the owner's name, is worse than " +
        "dropping the vocative.",
    ],
    [
      "Good morning. One video landed overnight.",
      "The prototype's line is 'Good morning, {who}. Four videos landed " +
        "overnight.' Both halves are interpolated: the name (see above) and " +
        "the count, which is real data and is whatever actually landed. It " +
        "can never match a fixed string, and rounding a real count to the " +
        "prototype's 'four' would be a lie about the user's own library.",
    ],
    [
      "Nothing here yet — upload a video and it starts reading.",
      "The Videos tab is a deliberate departure from the prototype, which " +
        "opens Footage on Clips; the owner's actual use is 'find the video I " +
        "uploaded'. So the prototype has no empty state for a video library, " +
        "and the one being used was its CLIPS line — 'Nothing kept yet, add a " +
        "clip back' — which tells someone with no videos at all to restore a " +
        "clip they never had. Phrased in the prototype's own voice: 'Nothing " +
        "here yet' is its wording on Home.",
    ],
    [
      "New edit",
      "The prototype has no source page at all — clicking footage in it goes " +
        "straight to a scored editor — so it has no word for starting a " +
        "SECOND cut of one video. Its nearest phrasings are a heading (\"Want " +
        "anything else from this footage?\", used verbatim above this button) " +
        "and \"Skip the brief — edit it yourself\", which describes the first " +
        "edit rather than another one. Two words, its own vocabulary.",
    ],
    [
      "Make a short",
      "The prototype puts shorts on a surface of their own and its verb is " +
        "'Cut shorts from it' — a batch, on a whole video. The control this " +
        "labels is one block, in the editor: a 9:16 export of the piece you " +
        "are looking at. Its own word for the result is 'short', and the " +
        "plural batch phrasing is wrong for a single block, so the noun is " +
        "the prototype's and only the number changed. See " +
        "docs/decisions/blocks.md — shorts are an export, not a surface.",
    ],
    [
      "Close account",
      "The prototype is a permanently-signed-in demo with no account lifecycle " +
        "at all, so it has no string for this. It cannot be skipped: you " +
        "cannot sell a subscription to an account nobody can close, and the " +
        "right to erasure is not optional for anyone selling into the EU or UK.",
    ],
    [
      "Find the strong bits",
      "The prototype has no word for this because its scoring lived on a " +
        "separate surface — Clipping — rather than being something you ask for " +
        "while editing. Making it an assist INSIDE the editor is the point of " +
        "docs/decisions/blocks.md: the model marking what is strong is a " +
        "property of the blocks you are already reading, not a destination.",
    ],
    [
      "Make the video",
      "Clipping's lede promises 'scored vertical shorts, captions burned in' " +
        "and the prototype shows them as if they already exist — it never had " +
        "to name the act of producing one, because its data was fixtures. The " +
        "real product cannot render eight videos nobody asked for, so making " +
        "one is a deliberate action and needs a label the prototype has none of.",
    ],
    [
      "Duplicate",
      "The prototype offers 'Branch a version', which it renders as an inert " +
        "span — the feature was drawn and never built, and 'branching' is not " +
        "what anyone calls this outside version control. The need is real: an " +
        "edit is its cuts and beats, and there was no way to try a shorter or " +
        "vertical one without destroying the cut you liked. Named the word " +
        "every other editing tool uses for it.",
    ],
    [
      "Sign out",
      "The prototype is a demo that is always signed in, so it has no sign-out " +
        "anywhere and no string for one. Real accounts need to be able to leave; " +
        "'Sign out' is the plainest words for it and matches the voice of the " +
        "controls beside it.",
    ],
    [
      "drafting the acts",
      "A job stage label. The prototype names a few stages ('reading it for " +
        "meaning', 'picking out the moments') but never enumerates them, and " +
        "essay outlining is a stage it does not cover. Written in the same " +
        "voice as the ones it does.",
    ],
  ]);

  const SHORT = 24;
  const escapeRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const onBoundary = (t) => {
    const re = new RegExp(`(?:"|'|>)\\s*${escapeRe(t)}\\s*(?:"|'|<)`);
    return re.test(PROTO);
  };

  /* The arrow is a glyph; the prototype assembles these as "← " + surface name. */
  const strip = (t) => t.replace(/^[\u2190]\s*/, "");
  const known = (t) => {
    if (SIGNED_OFF.has(t.trim())) return true;
    const v = strip(t);
    return v.length <= SHORT ? onBoundary(v) : proto.includes(v) || protoRaw.includes(v);
  };

  const suspect = [];
  const seen = new Set();

  /*
   * The editor and a read source only exist once there is data, so their
   * routes are discovered rather than hardcoded. Leaving them out would put a
   * blind spot over the surfaces with the most copy on them.
   */
  const routes = [...ROUTES];
  try {
    const { sources } = await (await fetch(BASE + '/api/sources')).json();
    if (sources?.[0]) routes.push('/sources/' + sources[0].id);
  } catch {}
  try {
    const { projects } = await (await fetch(BASE + '/api/projects')).json();
    if (projects?.[0]) {
      // One editor, one URL. The four stage paths are aliases of it, so
      // crawling all four checked the same HTML four times.
      routes.push('/p/' + projects[0].id + '/cut');
    }
  } catch {}

  for (const route of routes) {
    const html = await (await fetch(BASE + route)).text();
    const body = html
      .replace(/<script[\s\S]*?<\/script>/g, ' ')
      .replace(/<style[\s\S]*?<\/style>/g, ' ')
      .replace(/<title>[\s\S]*?<\/title>/g, ' ');
    /*
     * Only UI COPY is checked. Text the user's own footage produced — a
     * transcript line, a filename, a duration, or a reason the model wrote —
     * cannot be in the prototype and must not be flagged.
     *
     * The render marks those with data-content. Marking is required rather
     * than inferred, so the failure mode is safe: forget to mark a piece of
     * chrome and it still gets checked, which is the direction that catches
     * paraphrases.
     */
    // The terminating `<` is a LOOKAHEAD, not consumed. Matching it directly
    // eats the next element's opening bracket, so the scan silently sees only
    // every other element — which is how "Ask for another pass" slipped past a
    // check that reported all-clear.
    for (const m of body.matchAll(/<([a-z]+)([^>]*)>([^<>]+)(?=<)/g)) {
      if (/\bdata-content\b/.test(m[2])) continue;
      const text = normalise(m[3]);
      if (text.length < 8) continue;
      // Three LETTERS, either case. This was /[a-z]{3}/, which skipped every
      // all-caps label in the product — so the stage pills were never checked
      // and an invented "SHORTS FROM THIS" pill shipped on a surface where the
      // prototype has no pill at all. Timecodes and counts are still skipped,
      // which is all the filter was ever for.
      if (!/[A-Za-z]{3}/.test(text)) continue;
      if (seen.has(text)) continue;
      seen.add(text);
      if (known(text)) continue;
      // Strings that interpolate a value ("Welcome, Chris. …") can never match
      // whole, because the prototype holds them as templates. Fall back to
      // sentence fragments: every fragment long enough to carry real wording
      // must still be found verbatim. Short fragments (a name, a count, a
      // greeting stub) are allowed through — they are the interpolated part.
      const fragments = text.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
      /*
       * Fragments of an interpolated string are deliberately partial, so they
       * match by substring. The fallback below is gated so this looseness
       * cannot also excuse a short wrong label.
       */
      const has = (fr) => proto.includes(fr) || protoRaw.includes(fr);

      /*
       * Only strings that plausibly interpolate get the fallback: more than
       * one sentence, or a digit somewhere. Without this gate, a single short
       * label like "THE WORDS" slips through by being under the fragment
       * length threshold — which is exactly how it shipped once already.
       */
      const looksInterpolated = /\d/.test(text) || text.split(/(?<=[.!?])\s+/).filter(Boolean).length > 1;
      if (!looksInterpolated) {
        suspect.push(`${route}  "${text}"`);
        continue;
      }

      /*
       * Two acceptable reasons a fragment won't match whole, both distinct
       * from paraphrasing — which is what this check exists to catch:
       *
       *  - INTERPOLATION. "Welcome, Chris." can never match, because the
       *    prototype holds it as a template. Short fragments are allowed
       *    through on the assumption that they are the interpolated part.
       *  - TRUNCATION. The prototype's greeting is "Good morning, {who}. Four
       *    videos landed overnight." When nothing landed overnight, rendering
       *    only the first sentence is honest; rendering the second would be a
       *    lie. Dropping a clause that isn't true is not rewording, so a
       *    fragment whose stem (up to its interpolated value) appears in the
       *    prototype is accepted.
       */
      /*
       * The invariant core: strip the interpolated value from either end. A
       * count or a name can sit at the front ("5 videos landed overnight",
       * against the prototype's "Four videos landed overnight") or the back
       * ("Good evening, Chris."). What must survive verbatim is the wording in
       * between — that is the part a paraphrase would change.
       */
      const LEAD = /^[A-Z0-9][\w'\u2019-]*[,]?\s+/;   // "5 ", "Good "
      const TAIL = /\s+[A-Z0-9][\w'\u2019-]*[.!?]?$/;   // " Chris."
      const trimPunct = (x) => x.replace(/[.!?]+$/, "").trim();

      /*
       * Try dropping the interpolated value from the front, the back, or both,
       * and require what remains to appear in the prototype verbatim. Whichever
       * end the value sits at, the WORDING between is what a paraphrase would
       * change, so that is what must survive. 8 characters is enough to be a
       * real phrase and not a coincidence.
       */
      const cores = (fr) =>
        [fr.replace(LEAD, ""), fr.replace(TAIL, ""), fr.replace(LEAD, "").replace(TAIL, "")]
          .map(trimPunct)
          .filter((x) => x.length >= 8);

      const unmatched = fragments.filter(
        (fr) => fr.length >= 18 && !has(fr) && !cores(fr).some(has),
      );
      if (unmatched.length === 0) continue;
      suspect.push(`${route}  "${text}"`);
    }
  }

  if (suspect.length) {
    fail('strings', 'Rendered text not found in the prototype. Either a paraphrase (fix it) or new behaviour (flag it and get sign-off).', suspect.join('\n'));
  } else {
    const used = [...SIGNED_OFF.keys()].filter((k) => seen.has(k));
    pass(
      'strings',
      `${seen.size} rendered strings across ${routes.length} surfaces, all verbatim from the prototype` +
        (used.length ? ` (+${used.length} signed off: ${used.map((u) => JSON.stringify(u)).join(', ')})` : ''),
    );
  }
}

/* ── Layout law ────────────────────────────────────────────────────────── */
{
  const shell = fs.readFileSync(path.join(ROOT, 'src/ui/shell.ts'), 'utf8');
  const ok = shell.includes('LAYOUT.width') && TOKENS.includes('min(960px,100%)');
  if (!ok) fail('layout', 'The 960px width law is not enforced in the shell.');
  else {
    // No page module may set its own PAGE width. `min-width:min(200px,100%)`
    // on a flex child is fine and appears throughout the prototype — what is
    // banned is a surface declaring its own column or a wide max-width.
    // landing.ts is the signed-out marketing site, not an app surface. It is a
    // full standalone document with its own 1080px column, straight out of
    // Landing.dc.html — the 960 law governs the app shell.
    const rogue = UI_FILES.filter((f) => !f.endsWith('shell.ts') && !f.endsWith('tokens.ts') && !f.endsWith('landing.ts'))
      .filter((f) => {
        const src = fs.readFileSync(f, 'utf8');
        if (/(?<!min-)width:\s*min\(9\d\dpx/.test(src)) return true;
        // A wide max-width is a page column UNLESS the prototype uses that
        // exact measure itself — it sets prose measures (max-width:640px on a
        // paragraph, 600px on the empty-state card) that are not columns. Same
        // rule the hex check uses: the prototype is the authority, not a
        // number chosen here.
        const wide = [...src.matchAll(/max-width:\s*(\d+)px/g)].some(
          (m) => Number(m[1]) >= 600 && !PROTO.includes(`max-width:${m[1]}px`),
        );
        return wide;
      });
    if (rogue.length) fail('layout', 'A page sets its own width. Every surface uses the shell column.', rogue.map((f) => path.relative(ROOT, f)).join('\n'));
    else pass('layout', '960px law enforced in the shell; no page overrides it');
  }
}

/*
 * The rules this codebase already states, enforced instead of described.
 *
 * Every bug fixed in the sweep had its own correct rule written in a comment
 * two functions above it. "A tab you can never fill is a lie" was stated in
 * the function that renders the tabs, applied to Threads, and not applied to
 * Find in the same expression. A score of 0 was fixed in the editor with a
 * paragraph explaining why, and left wrong in Clipping. Prose does not stop
 * the sixth instance; a grep does.
 *
 * Only rules that are genuinely mechanical live here. Anything needing
 * judgement belongs in review, not in a regex that will one day be wrong.
 */
function checkConventions() {
  const pages = walk(path.join(ROOT, 'src/ui')).filter((f) => !f.endsWith('client.ts'));
  const client = fs.readFileSync(path.join(ROOT, 'src/ui/client.ts'), 'utf8');
  const bad = [];
  const rel = (f) => path.relative(ROOT, f);

  /* Comments are stripped first. Every fix in this codebase explains itself by
     quoting the code it replaced — "this was ${s.score ?? 0} in green" — and a
     check that flags the explanation punishes the documentation. */
  const decomment = (t) =>
    t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '');

  for (const file of pages) {
    const src = decomment(fs.readFileSync(file, 'utf8'));

    /* Chrome's own player in a designed dark page — replaced three times
       before the last instance went. wirePlayer is the one player. */
    for (const m of src.matchAll(/<video\b[^>]*\bcontrols\b/g)) {
      bad.push(rel(file) + ': a <video> with native controls — use the player in client.ts');
    }

    /*
     * A PIXEL MAX in a card grid strands the leftover.
     *
     * This rule used to ban auto-fill and it was aimed at the wrong half. The
     * problem is the max: repeat(auto-fit, minmax(200px, 240px)) across a
     * 960px column fits three cards and leaves 208px dead on every row, which
     * is what "it looks weird having only 3 and then blank space" was. 1fr
     * shares the row out instead, and auto-fill keeps the track count stable
     * so two items do not balloon to half the page each.
     */
    for (const m of src.matchAll(/repeat\(\s*auto-(?:fit|fill)\s*,\s*minmax\([^)]*?,\s*\d+px\s*\)/g)) {
      bad.push(rel(file) + ': a grid capped in px leaves dead space at the end of every row — use 1fr');
    }

    /* "A zero is not a verdict, it is the absence of one." saveClips writes
       score 0 for anything unrated, and rendering it says the model looked
       and found nothing. */
    for (const m of src.matchAll(/score\s*\?\?\s*0/g)) {
      bad.push(rel(file) + ': score ?? 0 renders an unscored item as a verdict of zero');
    }

    /* A control that is disabled in the markup itself can never become
       enabled — it is a promise the product cannot keep. Disabled by a
       condition is fine; that is a control with a reason. */
    for (const m of src.matchAll(/<(?:button|input|select|textarea)\b[^>]*?\sdisabled(?=[\s>])/g)) {
      const before = src.slice(Math.max(0, m.index - 200), m.index + m[0].length);
      if (!/\$\{|\?/.test(before.slice(-120))) {
        bad.push(rel(file) + ': a control hardcoded disabled — make it conditional or leave it out');
      }
    }
  }

  if (bad.length) fail('conventions', 'A rule this codebase already states, broken again.', [...new Set(bad)].join('\n'));
  else pass('conventions', 'no native players, empty grid tracks, zero-scores or permanently disabled controls');
}

/*
 * THE RECURRING BUG, as a check.
 *
 * Not a broken feature — a feature that exists on the server, had a UI built
 * for it once, and is no longer connected to it. Ten of them this session:
 * the recorder twice, renderFootage, the AI controls, the clip picker,
 * buildSummary, the passes log, /api/begin with an existing source.
 *
 * Two directions, because the failure has two shapes.
 */
function checkReachable() {
  const index = fs.readFileSync(path.join(ROOT, 'src/index.ts'), 'utf8');
  const client = fs.readFileSync(path.join(ROOT, 'src/ui/client.ts'), 'utf8');
  const pages = walk(path.join(ROOT, 'src/ui'))
    .map((f) => fs.readFileSync(f, 'utf8'))
    .join('\n');
  const server = walk(path.join(ROOT, 'src'))
    .filter((f) => !f.includes('/ui/'))
    .map((f) => fs.readFileSync(f, 'utf8'))
    .join('\n');
  const problems = [];

  /* 1. An API route nothing can reach. The client builds most paths by
        concatenation, so a route is matched on its distinctive literal
        segments rather than on the whole pattern. */
  const ROUTE = /app\.(?:get|post|put|delete)\("(\/api\/[^"]+)"/g;
  for (const m of index.matchAll(ROUTE)) {
    const route = m[1];
    /* The pieces between parameters — "/api/projects", "/blocks", "/short". */
    const parts = route.split('/').filter((seg) => seg && !seg.startsWith(':') && seg !== '*' && seg !== 'api');
    if (!parts.length) continue;
    const tail = parts[parts.length - 1];
    const seen = client.includes('/' + tail) || pages.includes('/' + tail) || server.includes('/' + tail);
    if (!seen) problems.push('route ' + route + ' — nothing anywhere asks for it');
  }

  /* 2. A table written and never read. This is the passes log exactly: every
        pass has written a row since the feature shipped, its own comment says
        "shown as the Passes log", and the only other statement about it in
        the codebase was a DELETE. */
  const schema = fs.readFileSync(path.join(ROOT, 'migrations/0006_v2_core.sql'), 'utf8');
  const all = fs.readFileSync(path.join(ROOT, 'src/index.ts'), 'utf8') + '\n' + server + '\n' + pages;
  for (const m of schema.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)) {
    const table = m[1];
    const written = new RegExp('(INSERT INTO|UPDATE)\\s+' + table + '\\b', 'i').test(all);
    const read = new RegExp('FROM\\s+' + table + '\\b', 'i').test(all.replace(new RegExp('DELETE FROM\\s+' + table + '\\b', 'gi'), ''));
    if (written && !read) problems.push('table ' + table + ' — written, and nothing ever reads it back');
  }

  if (problems.length) {
    fail(
      'reachable',
      'Something on the server has no way to reach a person. Either wire it up or take it out.',
      problems.join('\n'),
    );
  } else {
    pass('reachable', 'every API route is asked for, and every table written is read back');
  }
}

checkTemplate();
checkConventions();
checkReachable();
checkWiring();

checkStrings().then(() => {
  console.log(findings ? `\n${findings} finding(s)` : '\nAll checks passed');
  process.exit(findings ? 1 : 0);
});
