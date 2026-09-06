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
      for (const stage of ['pick', 'build', 'script', 'shorts']) {
        routes.push('/p/' + projects[0].id + '/' + stage);
      }
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

checkStrings().then(() => {
  console.log(findings ? `\n${findings} finding(s)` : '\nAll checks passed');
  process.exit(findings ? 1 : 0);
});
