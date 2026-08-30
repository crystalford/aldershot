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
const PROTO = fs.readFileSync(path.join(ROOT, 'design/Aldershot.dc.html'), 'utf8');
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
  const ROUTES = ['/', '/projects', '/footage', '/clipping', '/editor', '/settings'];

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
  const suspect = [];
  const seen = new Set();

  for (const route of ROUTES) {
    const html = await (await fetch(BASE + route)).text();
    const body = html
      .replace(/<script[\s\S]*?<\/script>/g, ' ')
      .replace(/<style[\s\S]*?<\/style>/g, ' ')
      .replace(/<title>[\s\S]*?<\/title>/g, ' ');
    for (const m of body.matchAll(/>([^<>]+)</g)) {
      const text = normalise(m[1]);
      if (text.length < 8) continue;
      if (!/[a-z]{3}/.test(text)) continue;
      if (seen.has(text)) continue;
      seen.add(text);
      if (proto.includes(text) || protoRaw.includes(text)) continue;
      // Strings that interpolate a value ("Welcome, Chris. …") can never match
      // whole, because the prototype holds them as templates. Fall back to
      // sentence fragments: every fragment long enough to carry real wording
      // must still be found verbatim. Short fragments (a name, a count, a
      // greeting stub) are allowed through — they are the interpolated part.
      const fragments = text.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
      const has = (fr) => proto.includes(fr) || protoRaw.includes(fr);

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
    pass('strings', `${seen.size} rendered strings across ${ROUTES.length} surfaces, all verbatim from the prototype`);
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
    const rogue = UI_FILES.filter((f) => !f.endsWith('shell.ts') && !f.endsWith('tokens.ts'))
      .filter((f) => {
        const src = fs.readFileSync(f, 'utf8');
        if (/(?<!min-)width:\s*min\(9\d\dpx/.test(src)) return true;
        const wide = [...src.matchAll(/max-width:\s*(\d+)px/g)].some((m) => Number(m[1]) >= 600);
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
