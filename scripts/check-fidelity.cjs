/**
 * The three static fidelity checks from docs/archive/handoff-v2/PROMPTING-NOTES.md.
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
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
/*
 * Both prototypes. The app is Aldershot.dc.html; the signed-out marketing site
 * is Landing.dc.html, and it has its own palette (#0C0C0F section grounds) and
 * its own width (1080px, not the app's 960). Checking src/ui/pages/landing.ts
 * against the app prototype alone reported both of those as inventions.
 */
const APP_PROTO = fs.readFileSync(path.join(ROOT, 'design/Aldershot.dc.html'), 'utf8');
/*
 * THE NEW PROTOTYPE, AS A SECOND ACCEPTED SOURCE — which is how this check
 * gets repointed without red-lining the build.
 *
 * One Take is the design authority (see the README), but the shipped surfaces
 * are still the retired design's, so swapping this file for that one fails
 * almost every rendered string at once. Accepting EITHER is the migration:
 * a surface that has not moved keeps passing against the prototype it was
 * built from, anything written for One Take passes against One Take, and copy
 * that exists in neither still fails — which is the only thing this check is
 * actually for.
 *
 * It gets stricter as surfaces move, not looser: when a surface is rebuilt,
 * its strings stop matching the retired file and start matching this one.
 * Drop the retired file from PROTO once nothing needs it.
 */
const ONE_TAKE_PROTO = fs.readFileSync(path.join(ROOT, 'design/one-take/Aldershot One Take.dc.html'), 'utf8');
/*
 * TWO LANDINGS, FOR THE SAME REASON THERE ARE TWO APP PROTOTYPES.
 *
 * design/Landing.dc.html is 16 Oct, the retired batch. design/one-take/
 * Landing.dc.html is 17 Oct and is the current design — and until today
 * NOTHING in this repo had ever read it, so the only page a stranger sees
 * was being checked against a design that had been replaced.
 *
 * That was not a mis-pointed constant so much as an honest report of a
 * surface that never moved: of six strings sampled from the current design
 * the build rendered zero. What it cost is on the page — it named a mode
 * that does not exist (Clips), stated the pricing without the half that is
 * the point, and promised a camera the recorder does not have.
 *
 * Both are accepted while the landing moves across, exactly as APP_PROTO
 * and ONE_TAKE_PROTO are above: a section that has not been rebuilt keeps
 * passing against the file it was built from, anything written for One Take
 * passes against One Take, and copy that exists in neither still fails.
 * Drop the retired one when no section needs it.
 *
 * AS OF THE REBUILD, every section of the landing comes from the current
 * design. Whether the retired file is still load-bearing is a question only
 * `strings` can answer, and `strings` needs a running server — so it is
 * left in, and removing it is a one-line change for whoever next runs the
 * gate with a dev server up. Guessing green here would be the same mistake
 * as the four strings that were "left to CI" twice.
 */
const LANDING_PROTO = fs.readFileSync(path.join(ROOT, 'design/Landing.dc.html'), 'utf8');
const LANDING_NOW = fs.readFileSync(path.join(ROOT, 'design/one-take/Landing.dc.html'), 'utf8');
/*
 * SETTINGS HAS ITS OWN DESIGN AND NOTHING READ THAT EITHER. 30KB of it,
 * mentioned in two sign-off comments below and never once in the haystack.
 */
const SETTINGS_PROTO = fs.readFileSync(path.join(ROOT, 'design/one-take/Aldershot Settings.dc.html'), 'utf8');
const PROTO = [APP_PROTO, LANDING_PROTO, LANDING_NOW, SETTINGS_PROTO, ONE_TAKE_PROTO].join('\n');
const TOKENS = fs.readFileSync(path.join(ROOT, 'src/ui/tokens.ts'), 'utf8');

let findings = 0;
/** Rules that did not run, and why. Read by the exit code at the bottom. */
const SKIPPED = [];
function skipped(check, why) {
  SKIPPED.push(check);
  console.log(`\n⚠ ${check} — SKIPPED: ${why}.`);
}

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

/**
 * WIRED — a capability that nothing can reach is not a capability.
 *
 * Four things in one day turned out to be this: /enhance-audio, the
 * stream_uid columns, the /edl preview endpoint, and the container's
 * voice-over-footage branch. Every one was written, tested by hand, committed,
 * and then never connected to anything — and every one was found by accident,
 * by a different lens, because somebody happened to ask.
 *
 * The other checks compare what we RENDER against the design. `reachable`
 * covers API routes and tables. Neither can see an endpoint on the container
 * with no caller, or a function nobody imports, which is where all four hid.
 */
function checkWired() {
  const bad = [];
  const rel = (f) => path.relative(ROOT, f);
  /* Comments stripped, so a name surviving only in prose does not read as
     alive — several of these are discussed at length and called nowhere. */
  const decomment = (t) =>
    t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

  /* Every container endpoint must have a caller. This is the exact check that
     would have caught /enhance-audio on the day it was written. */
  const box = fs.readFileSync(path.join(ROOT, 'container/render.mjs'), 'utf8');
  const srcAll = walk(path.join(ROOT, 'src')).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  for (const m of box.matchAll(/path === '"'"'(\/[a-z/-]+)'"'"'/g)) {
    const route = m[1];
    if (!srcAll.includes('container' + route)) {
      bad.push(`container${route} — the container serves it and nothing in src/ calls it`);
    }
  }

  /* Every export must be named somewhere other than its own definition. Tests
     and scripts count as users: a helper only the tests exercise is alive. */
  const files = [];
  for (const root of ['src', 'test', 'scripts']) {
    const d = path.join(ROOT, root);
    if (fs.existsSync(d)) walkAny(d, files);
  }
  /* MODULE PATHS ARE NOT USES. `scout-decompose.ts` contains the word
     "decompose", so every file that imports anything out of it counted as a
     caller for `decompose()` — which was exported and called nowhere, and
     this check said it was wired. Any export whose name is a word in its own
     filename got the same free pass. */
  const nospec = (t) => t.replace(/(["'])[^"'\n]*\1/g, (m) => (/[./]/.test(m) ? ' ' : m));
  const text = Object.fromEntries(files.map((f) => [f, nospec(decomment(fs.readFileSync(f, 'utf8')))]));
  for (const f of files) {
    if (!f.includes(`${path.sep}src${path.sep}`)) continue;
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/^export (?:async )?(?:function|const) (\w+)/gm)) {
      const name = m[1];
      let uses = 0;
      for (const t of Object.values(text)) uses += (t.match(new RegExp('\\b' + name + '\\b', 'g')) || []).length;
      if (uses <= 1) bad.push(`${rel(f)}: ${name} — exported and referenced nowhere`);
    }
  }

  if (bad.length) {
    fail('wired', 'Built, and nothing can reach it.', bad.join('\n'));
  } else {
    pass('wired', 'every container endpoint has a caller; every export is referenced');
  }
}

/**
 * ROOM — every token budget is watched by something.
 *
 * THREE TIMES. A `max_tokens` sized for the ANSWER cuts a reasoning model
 * off mid-thought, `assistantText` drops the thinking, and what arrives is
 * an empty parse that every caller treats as "the model had nothing to say":
 *
 *   src/naming.ts     32 → every call returned exactly 32, found by hand
 *   src/judge.ts    2000 → two claims of nineteen lost, read as over-caution
 *   src/judge.ts    5300 → the hardest claim spends 4355, failed under load
 *
 * Not one announced itself, and each was found by a different accident. So
 * the rule is structural rather than a number: a file that sets a text
 * budget must route through something that reads the budget back out and
 * says when it was spent — `runRead` or `callReason`, both in src/llm.ts.
 *
 * NO FLOOR IS ASSERTED HERE. A minimum would be a threshold invented against
 * nothing, which is what this codebase refuses everywhere else; the runtime
 * warning is the measurement, and it only exists if the call is wired to it.
 *
 * Comments are stripped first, so the three numbers in the doc comment above
 * each budget do not read as budgets. Embedding, transcription and
 * text-to-speech calls set no `max_tokens` and are therefore not matched —
 * there is nothing to truncate.
 */
function checkRoom() {
  const bad = [];
  const rel = (f) => path.relative(ROOT, f);
  const decomment = (t) =>
    t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

  /*
   * COUNTED, BECAUSE THE FIRST VERSION PASSED WITH ITS MATCHER BROKEN.
   * Replacing the test below with `continue` — so the rule examined nothing
   * at all — printed the same green line as a clean run. That is the fault
   * that let `reachable`'s route check never fire once, arriving in a rule
   * written the day after it was fixed. A check that cannot tell "nothing is
   * wrong" from "I did not look" is decoration.
   */
  let seen = 0;
  for (const f of walk(path.join(ROOT, 'src'))) {
    const code = decomment(fs.readFileSync(f, 'utf8'));
    if (!/\bmax_?[Tt]okens\s*:/.test(code)) continue;
    seen += 1;
    /* llm.ts is where both of them live. */
    if (path.basename(f) === 'llm.ts') continue;
    /*
     * `callRouted` COUNTS, because it is callReason with the breaker around
     * it — src/breaker.ts calls through, so the budget is still read back
     * out and still reported. Added when the judge moved onto it and this
     * rule said the budget was unwatched; the rule was right to ask and
     * wrong about the name.
     */
    if (/\brunRead\s*\(/.test(code) || /\bcall(?:Reason|Routed)\s*\(/.test(code)) continue;
    bad.push(
      `${rel(f)} — sets a token budget and reaches none of runRead, callReason or callRouted, ` +
        `so a truncated answer there is indistinguishable from an empty one`,
    );
  }

  if (bad.length) {
    fail('room', 'A token budget nothing is watching.', bad.join('\n'));
  } else if (seen < 2) {
    fail(
      'room',
      'This rule found no token budgets, and src/ has a dozen.',
      `matched ${seen} file(s) — the matcher is broken, not the code`,
    );
  } else {
    pass('room', `${seen} token budgets in src/, all reporting when they are spent`);
  }
}

/**
 * FONTS — the container renders in the same faces the browser approved in.
 *
 * src/ui/fonts is the one source of truth and container/fonts is a copy,
 * because wrangler builds the image with the Dockerfile's own directory as
 * the build context and COPY cannot reach outside it. A symlink does not
 * help — Docker copies the link, not its target.
 *
 * So the copy can fall behind, and this is what stops it. Doc 08 calls the
 * generated still "the approval checkpoint": a picture approved in Instrument
 * Sans and rendered in whatever fontconfig falls back to is not the picture
 * that was approved, and nothing about that failure is visible until somebody
 * compares an export with its preview.
 *
 * Byte-for-byte, not by name: a face replaced upstream keeps its filename.
 */
function checkFonts() {
  const bad = [];
  const from = path.join(ROOT, 'src/ui/fonts');
  const to = path.join(ROOT, 'container/fonts');

  const woff2 = (dir) =>
    fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.woff2')).sort() : [];
  const want = woff2(from);
  const have = woff2(to);

  if (!want.length) {
    fail('fonts', 'src/ui/fonts has no faces in it, which cannot be right.', 'nothing to compare');
    return;
  }

  for (const f of want) {
    if (!have.includes(f)) {
      bad.push(`${f} — the app serves it and the container has never seen it`);
      continue;
    }
    if (!fs.readFileSync(path.join(from, f)).equals(fs.readFileSync(path.join(to, f)))) {
      bad.push(`${f} — the app's copy and the container's differ`);
    }
  }
  for (const f of have) {
    if (!want.includes(f)) bad.push(`${f} — in container/fonts and served by nothing`);
  }

  /* And the Dockerfile has to actually install them, or the copy is a
     directory nobody reads. */
  const docker = fs.readFileSync(path.join(ROOT, 'container/Dockerfile'), 'utf8');
  if (!/COPY\s+fonts\//.test(docker)) bad.push('container/Dockerfile never copies fonts/ in');
  if (!/fc-cache/.test(docker)) bad.push('container/Dockerfile never runs fc-cache, so fontconfig will not see them');
  if (!/librsvg2-bin/.test(docker)) bad.push('container/Dockerfile has no SVG rasteriser, so a generated picture cannot be drawn');

  if (bad.length) {
    fail('fonts', 'The render would set its type in a different face from the one approved. `npm run fonts`.', bad.join('\n'));
  } else {
    pass('fonts', `${want.length} faces shared with the container, byte for byte`);
  }
}

/** Every .ts/.cjs/.mjs under a directory. */
function walkAny(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkAny(p, out);
    else if (/\.(ts|cjs|mjs)$/.test(p)) out.push(p);
  }
  return out;
}

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
/**
 * A BACKTICK INSIDE A TEMPLATE LITERAL ENDS IT, and a comment in there is
 * not a comment.
 *
 * TWO CHECKS, because they catch different halves of the same mistake.
 *
 * THE PARSER, over every file in src/ui. Inside a template literal a
 * slash-star is text, and the parser does not know you meant to explain
 * something — one backtick in it ends the literal and what follows is read
 * as code. This landed in shell.ts (a note inside the stylesheet) and in
 * home.ts (an HTML comment inside the composer) within an hour of each
 * other; both took the whole page down, and neither file had anything
 * watching it, because the rule below only ever looked at client.ts.
 *
 * `npx tsc` does not catch it — the text after the stray backtick is often
 * still valid TypeScript, and client.ts is not typechecked at all. esbuild
 * does, which is why the check IS esbuild rather than a scanner that
 * approximates it: a hand-written lexer was tried first and reported four
 * false positives on JSDoc that was never inside a template, which is the
 * failure mode of every almost-right parser.
 *
 * THE LINE SCAN, for client.ts alone. The parser only objects when the
 * leftover text happens to be invalid; a backtick that truncates the client
 * and leaves something that still parses is silent, and the client is one
 * String.raw template where any backtick at all is wrong.
 */
function checkTemplateParses() {
  const files = walk(path.join(ROOT, 'src/ui'));
  if (files.length < 5) {
    fail('template', 'This rule found almost no files, and src/ui has a dozen.', 'read ' + files.length);
    return false;
  }
  const r = spawnSync(
    'npx',
    ['esbuild', '--loader:.ts=ts', '--outdir=' + path.join(os.tmpdir(), 'aldershot-parse'), '--log-level=warning', ...files],
    { cwd: ROOT, encoding: 'utf8' },
  );
  if (r.status === 0) return files.length;
  fail(
    'template',
    'A file in src/ui does not parse. A backtick inside a template literal is the usual reason — a comment in there is not a comment.',
    (r.stderr || r.stdout || '').trim().split('\n').slice(0, 12).join('\n'),
  );
  return false;
}

function checkTemplate() {
  const parsed = checkTemplateParses();
  if (parsed === false) return;

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
    pass('template', parsed + ' files in src/ui parse, and no backtick escapes the String.raw body of client.ts');
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

/*
 * THE COPY MACHINERY, AT MODULE SCOPE.
 *
 * All of this lived inside checkStrings, which needs a running server — so
 * the ability to ask "is this string in a design?" was only available on a
 * machine with one, and the landing page is a PURE FUNCTION that never
 * needed a server at all. Two red CI runs came of that: copy written here,
 * unverifiable here, pushed with "strings is left to CI".
 *
 * checkCopy below uses it without a browser. checkStrings still owns the
 * crawl, which really does need one.
 */
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
  /*
   * THE SIGN-IN PAGE, which is a page now rather than a jump.
   *
   * The header's "Sign in" used to scroll to the signup form, under a button
   * reading "Start free". The plumbing is the same either way — the emailed
   * link finds an account or makes one — which is why it was built as an
   * anchor; but somebody who already has an account and is shown "Start free"
   * has not been answered, and the owner said so after clicking it.
   *
   * No design draws any of this: the sign-off group below records that every
   * control in both landing designs opens the prototype app directly, with no
   * account and no inbox anywhere in them.
   *
   * The third string is NOT new. It has shipped since the magic-link flow was
   * built and no fixture had ever rendered an error state, so `copy` is seeing
   * it for the first time — the same shape as every other string in this file
   * that turned out to be unchecked rather than wrong.
   */
  ...[
    "We email you a link. There is no password to remember.",
    "No account yet? The same link makes one.",
    "Sign-in isn't switched on yet — email delivery isn't configured. Nothing was sent.",
  ].map((t) => [
    t,
    "The /signin page. Nothing in any design draws a sign-in surface at all. " +
      "The second line is the mirror of the landing's — whichever page you are " +
      "on, the box does both jobs, and the sentence names the one you did not " +
      "come for. The third is the refusal a person meets today, now said on the " +
      "page they asked from instead of on the marketing page they get bounced to.",
  ]),

  /*
   * A WAY BACK IN, which the signed-out page did not have.
   *
   * The header was the wordmark, three section anchors and "Start free";
   * every CTA on the page pointed at the same signup form; and because
   * GOOGLE_CLIENT_ID is unset in production the form's button reads "Start
   * free" rather than "Email me a link", with no "or use your email" line
   * either. The words "sign in" appeared nowhere on the rendered page except
   * inside an error banner after a failed attempt. Somebody who already had
   * an account had nothing to look for and no reason to think the signup
   * field was for them.
   *
   * Both of these are labelling rather than behaviour: the emailed link finds
   * an existing account or creates one, so there is no second route. They are
   * the same gap the group below records — "SIGNING IN HAS NO DESIGN" — named
   * again rather than smuggled in.
   *
   * "Sign in" is also here because `copy` cannot see it: scanCopy skips text
   * shorter than eight characters, so every label of seven or fewer is
   * invisible to that rule. Signed off by hand so the record is complete even
   * where the check cannot reach.
   */
  ...[
    "Sign in",
    "Already have an account? Same box — we email you a link.",
  ].map((t) => [
    t,
    "The returning-user path on the signed-out page. No design draws it: " +
      "every control in both landing designs opens the prototype app " +
      "directly, with no account and no inbox anywhere in them. The header " +
      "link deliberately does NOT carry class=\"nav-anchor\", which is " +
      "display:none under 640px — on a phone it would hide the one control a " +
      "returning visitor is looking for.",
  ]),

  /*
   * DECLARING A SECTION, which the plan flow could not take as an answer.
   *
   * The one stop asks whether a model's beats are right and the only replies
   * were yes and cut-one. What somebody with an argument actually says is
   * that the piece needs a section on something, and here is what the footage
   * has to show for it — invariant 10's "the user's own words win where they
   * exist" at the one point where their words are the whole contribution. No
   * prototype draws it: One Take's plan flow has no way to add a beat, and
   * the growth loop this serves did not exist when the design was drawn.
   */
  ...[
    "ADD A SECTION",
    "Go find this one",
  ].map((t) => [
    t,
    "The declared-section loop on the plan page. 'ADD A SECTION' heads the " +
      "two fields a beat is made of, the second of which IS the retrieval " +
      "query. 'Go find this one' fills one section without re-paying for the " +
      "rest, which is the difference between a plan somebody returns to and " +
      "one they run once. Neither is drawn anywhere: the prototype's plan " +
      "flow keeps or cuts the beats it was given and has no notion of adding.",
  ]),

  /*
   * WHAT THE ON-CAMERA STOPLIST MAKES OF SOMEBODY'S WORDING. Advice, not a
   * veto, and the distinction is the sentence.
   *
   * 18-SCOUT-BUILD-SPEC requires a behaviour to be something a viewer could
   * point to on camera, and src/scout-decompose.ts enforces it hard on a
   * MODEL's output: one regeneration, then the beat is dropped. A person's
   * sentence stands — invariant 10 — so this says what it will cost instead.
   * The phrase before it is theirs and is data-content; this half is ours.
   *
   * It was invisible to `copy` when written, because the rule only read text
   * that followed an OPENING tag and this follows a </span>. That hole is
   * fixed in scanCopy; this string is the one that found it.
   */
  [
    "says why, not what a camera saw — this may come back empty.",
    "The advice on a section the person wrote, when their wording names a " +
      "motive or a diagnosis rather than something a camera saw. Nothing in " +
      "any design, because nothing in any design lets somebody write a need.",
  ],

  /*
   * A PRE-EXISTING LANDING STRING, newly visible rather than newly written.
   *
   * It has been served since the magic-link flow was built and no check had
   * ever read it, for the reason above: it follows a </b>. Recorded here
   * rather than reworded — it is a limit stated BEFORE somebody goes looking
   * in their inbox, which is the right moment for it, and signing in has no
   * design at all to compare it with (see the group below on OAuth).
   */
  [
    "&mdash; the link works once and expires in 20 minutes.",
    "The sent-link confirmation on the signed-out page. Sign-in has no " +
      "design: every control in both landing designs opens the prototype app " +
      "directly, with no account, no inbox and no OAuth anywhere in them.",
  ],

  ...[
    "EVERY TAKE IS KEPT",
    "Use this one",
    "in the cut",
  ].map((t) => [
    t,
    "The take list, which the prototype has no UI for at all — its " +
      "recorder is a full-screen stage and the only place it says this is " +
      "a sentence: 'Your take — on camera or voice only. Every take is " +
      "kept.' The build kept that promise (invariant 6: a performance is " +
      "the one thing the engine cannot re-make) and had to invent the " +
      "surface that makes it worth anything — seeing the takes and " +
      "choosing one. New behaviour, flagged rather than paraphrased.",
  ]),
  [
    "Connecting brings the footage in without reading it &mdash; a video is read the first time you cut with it.",
    "The Settings design's own paragraph ends '...On the same Cloudflare " +
      "account it binds the bucket directly, no keys. From Neolog it " +
      "imports the transcripts already there — no transcribing twice.' " +
      "Neither half is true of this build and both would be promises it " +
      "does not keep: a binding is deploy-time configuration and works for " +
      "exactly one account, so every connection uses a read-only key; and " +
      "the owner does not trust Neolog's transcripts (it runs a workflow " +
      "to find hallucinated ones), so footage is read here and the word " +
      "table is deliberately not imported — see src/neolog.ts. This " +
      "sentence says what actually happens instead, including the part " +
      "that costs money.",
  ],
  [
    "Your take goes here — sound only, no camera yet",
    "Both landing designs say 'on camera or voice only'. The recorder asks " +
      "for getUserMedia({ audio: true }) and nothing else, and the beat " +
      "itself says so beside the Record control. A landing page that " +
      "promises a camera the product does not have is not a fidelity gap " +
      "— it is a lie, and a design does not get to overrule that. The " +
      "camera half is deferred with its reasons in " +
      "docs/handoff/12-DEFERRED.md.",
  ],
  [
    "Sound only &mdash; no camera yet",
    "The prototype's recorder is a full-screen stage with camera and mic " +
      "modes, layout options and a teleprompter. The build records audio " +
      "and nothing else — getUserMedia({ audio: true }) — and the camera " +
      "half is deferred with its reasons in 12-DEFERRED.md. A recorder " +
      "that does not say which it is, beside a control called 'Record " +
      "it', is one somebody points a camera at. beforepost.ts makes the " +
      "same move and for the same reason: naming what is not checked " +
      "beats a tick beside it.",
  ],
  [
    "Does nothing now — switch it off",
    "The prototype says 'Does nothing now — archive it' and archiving is " +
      "not something a rule can do here: invariant 6 is that nothing is " +
      "deleted and rules switch off, and there is no archived state on a " +
      "rule. A rule removed from the pane would be a cut with an " +
      "unexplained shape. So the sentence is the prototype's and the verb " +
      "is the one that describes the press. docs/handoff/12-DEFERRED.md.",
  ],
  /*
   * THE EMPTY STATES, which this check could not see until today.
   *
   * Both of these render only when the account has nothing in it, and there
   * was always something in it — so a gate that has passed for weeks had
   * never once reached either string. They surfaced the first time a local
   * database was emptied on purpose.
   *
   * Signed off rather than rewritten because the prototype has no empty
   * states at all: every frame of it shows a populated library, which is the
   * normal way a design is drawn and the reason this gap existed. The words
   * say the one thing a person needs at that moment — what to do next, and
   * roughly how long it takes — and neither invents a capability.
   */
  ...[
    "Drop a file or paste a link above. An hour of footage takes a few minutes to transcribe.",
    "Nothing here yet — upload a video and it starts transcribing.",
  ].map((t) => [
    t,
    "An empty state. The prototype draws every surface populated, so it has " +
      "no wording for a library with nothing in it, and these two were " +
      "unreachable by this check until a local database was emptied on " +
      "purpose. Kept as written: each says what to do next and how long it " +
      "takes, and claims nothing the product does not do.",
  ]),
  /*
   * TWO MORE OF THE SAME, and reached for the same reason: a fixture.
   *
   * scripts/seed-fixture.cjs seeds a transcribed source and a project cut
   * from it, and NOTHING ELSE — no scored clips, no passes. That is a state
   * every real account passes through in its first minute and that this
   * check had never crawled, because the crawl always landed on a project
   * somebody had already worked on.
   *
   * Both are empty states, so the reasoning above applies unchanged: the
   * prototype draws every frame populated and has no wording for either.
   */
  [
    "Press one, or say it in your own words.",
    "An empty state: the conversation before anything has been said to it. " +
      "The prototype only ever draws the assistant mid-conversation. The " +
      "verbs beneath it say what it can do better than a sentence would — " +
      "which is the mistake this line replaced — so it points at them and " +
      "promises nothing.",
  ],
  [
    "Nothing in your library yet.",
    "An empty state: a project's Footage tab before any moment has been " +
      "scored. Unreachable by this check until a seeded fixture gave it a " +
      "transcribed project with no clips, which is where every account " +
      "starts. Says what is absent and claims nothing.",
  ],
  ...[
    "NOT SHORTS",
    "Use it anyway",
  ].map((t) => [
    t,
    "The lines problems() measured out of the shortlist — too short, too " +
      "long — with the measurement that did it, and a press to force one " +
      "in. The prototype has the section; these two labels are the build's. " +
      "A measurement is a reason and not a veto: \"this is not a short and " +
      "here is why\" is a different sentence from \"this is a weak short\", " +
      "and the first one can be argued with.",
  ]),
  ...[
    "Back to the cut",
    "Take it away as text &nearr;",
  ].map((t) => [
    t,
    "The Before you post sheet, which the prototype draws as an OVERLAY " +
      "pressed open from Export and the build serves as a page — so it " +
      "needs a way back and the prototype does not. It answered only as a " +
      ".txt download until 28 Oct (content-disposition: attachment), which " +
      "made the most important safety surface in the product the one " +
      "surface with no surface: nobody about to post something opens a " +
      "text file first. The file is still there, because a checklist you " +
      "can hand to somebody else is worth having.",
  ]),
  /*
   * THE SCOUT BOARD'S OWN COPY, signed off 28 Oct 2026 — the first day
   * anything rendered this surface with rows in it.
   *
   * 510 lines that had never been drawn populated: it answered at an /api/
   * URL no crawl reached until this week, and a real run costs YouTube
   * quota and a string of model calls a fixture cannot spend. It is
   * specified by docs/handoff/18-SCOUT-BUILD-SPEC.md, which says what the
   * board must SHOW — gaps first, the balance meter, then the verified rows
   * — and not what it must say. design/one-take/Scout.dc.html does not draw
   * this screen.
   */
  ...[
    /* Entities, not curly quotes: SIGNED_OFF is matched on the RAW rendered
       text, which is what the page actually emits. */
    "what's missing comes first — it's the next thing to do. Each says what was tried, so you can tell &ldquo;doesn't exist&rdquo; from &ldquo;not found yet&rdquo;.",
    "Try an interview",
    "Bring the capture",
    "Make it a mission",
    "AUTO · open feed",
    "COUNTERPOINT",
    "sources &nearr; &nbsp; the ledger &nearr;",
  ].map((t) => [
    t,
    "The Scout board, specified in 18-SCOUT-BUILD-SPEC.md by what it must " +
      "show rather than by what it must say, and drawn by no prototype. " +
      "The three controls are the three things a person can do about a gap, " +
      "and the first sentence is the board's whole argument: what is " +
      "missing comes first, and each gap says what was tried so " +
      "\"doesn't exist\" can be told from \"not found yet\".",
  ]),
  [
    "NOT IN THE SOURCE",
    "The chip a rejected find wears. It used to draw as a CROWD row — the " +
      "words on screen with a timestamp, a credit line and a button " +
      "offering to go and capture a quote the verifier had already searched " +
      "for and failed to find. It is still SHOWN rather than filtered, " +
      "because invariant 4 says \"nothing backs this\" must be reachable and " +
      "because the rejection rate is the measured hallucination rate this " +
      "product gates model swaps on. It just says what it is.",
  ],
  /*
   * THE ORDER CHIPS, and these are the prototype's own words — they are
   * just never ALONE in its source.
   *
   * The prototype builds the three chips at runtime from the same
   * vocabulary the rule sentences use, so the file carries "Run it one
   * thread at a time." and "so it runs one thread at a time." and never the
   * bare label. The rendered prototype shows exactly these three chips; a
   * check that reads the file cannot see that, and the honest answer is to
   * say so here rather than to reword a label the design does have.
   *
   * "as it happened" needs no entry: it happens to appear standalone
   * elsewhere in the same file.
   */
  ...[
    "one thread at a time",
    "sharpest line first",
  ].map((t) => [
    t,
    "An order chip. The prototype RENDERS these three labels and its source " +
      "only ever contains them inside a sentence (\"Run it one thread at a " +
      "time.\"), because it builds the chips at runtime from the same " +
      "vocabulary — so a check that reads the file cannot match the bare " +
      "label. The words are the design's own; src/rules.ts ORDERS is a " +
      "verbatim port of them.",
  ]),
  [
    "Make the short",
    "The Shorts workbench's render control. The prototype's pair is " +
      "\"Skip it\" and \"Add it to the cut\", and the second does not apply " +
      "here: its shorts are pulled from the library, while this shortlist " +
      "IS the cut's own lines, so every one of them is already in it. " +
      "Adding would do nothing, which is the class of control this build " +
      "keeps removing. What there is to do is render it, at the shape and " +
      "with the captions chosen above — which is also what makes those " +
      "chips controls rather than decoration.",
  ],
  [
    "No hashtags: nothing here measures what people are searching for, and a tag is a guess at that.",
    "The same refusal src/shorts.ts makes about Trend, said where the post " +
      "copy is. The prototype shows \"#vlog #deciding #landing\"; a tag is a " +
      "claim about what people are looking for and nothing in this product " +
      "measures that. Worse than Trend, because a hashtag is pasted " +
      "straight into a post. The first draft did invent them, from " +
      "subjectWord — which exists to diagnose an opening, not to name a " +
      "subject — and it produced \"#so\".",
  ],
  [
    "Save the cap",
    "The control that raises the monthly spend cap. NEITHER PROTOTYPE HAS " +
      "ONE: Aldershot Settings.dc.html draws the cap as a read-only meter " +
      "reading \"Top-ups stop here until you raise it\" and offers no way to " +
      "raise it. src/spend.ts stops every job at that number with a sentence " +
      "that says \"until you raise it in Settings\", and `spend_cap_usd` was " +
      "read by capFor and written by nothing in the whole of src/ — so the " +
      "product told somebody to do a thing it could not do. New behaviour " +
      "rather than a paraphrase, and the smallest thing that makes the " +
      "existing refusal true.",
  ],
  /*
   * THE RECEIPTS ADMIN PAGE, crawlable from 28 Oct 2026 and not before.
   *
   * Two things had to be fixed to even see these four strings: the page
   * answered at /api/projects/:id/receipts, where no crawl goes, and when
   * it moved to /p/:id/receipts it was registered AFTER /p/:id/:stagePath,
   * which matched first and returned 404. So the surface that puts
   * something on the public web had never been read by anything.
   *
   * No prototype draws it. One Take's export panel has the LINK to it —
   * "Receipts for viewers ↗", which is signed off separately — and no
   * screen behind it. The words carry the one promise that matters on a
   * control like this: nothing is public until you press it.
   */
  ...[
    "Receipts for viewers",
    "Publish a page your viewers can read: every clip in this cut that came from somebody else, the words, the link to the original, and whether it was checked. It does not list your own footage, your rules or anything you cut.",
    "Publish it",
    "Nothing is public until you press this.",
  ].map((t) => [
    t,
    "The receipts admin page. It is the only control in this product that " +
      "puts something on the public web, and no prototype draws the screen " +
      "— One Take has the link to it and nothing behind it. The copy says " +
      "what the published page does and does not contain, and that nothing " +
      "is public until the press.",
  ]),
  /*
   * FIVE SURFACES NO PROTOTYPE DRAWS, signed off on 28 Oct 2026 — the first
   * day anything crawled them.
   *
   * scripts/surfaces.cjs replaced a nine-route literal with the routes
   * derived from src/index.ts, and these surfaced immediately: Documents,
   * Find, the Scout board, the brief compiler's control and the labelling
   * page had never been compared with anything. Each is checked against
   * `design/` and is genuinely absent from all of it, for a reason per
   * surface rather than one blanket excuse.
   *
   * DOCUMENTS and FIND are Footage tabs the One Take prototype does not
   * have: it draws Videos, Highlights and Projects. Both are specified in
   * the handoff instead (a document can stand as the proof on a line that
   * claims it), so there are no drawn words to copy and these are the first.
   * The Find tab's second string is a refusal — captions from a link are not
   * built — and an honest refusal is exactly what belongs there.
   */
  ...[
    "Add a document",
    "A PDF or a photograph — a contract, a letter, a screenshot of the thing itself. Say what it shows and it can carry the line that claims it. Without that it is still a picture, just not proof.",
    "Choose a file",
    "No documents yet — add one and it can stand as the proof on a line that claims it.",
    "Read the captions",
    "Reading captions from a link isn't switched on yet.",
  ].map((t) => [
    t,
    "A Footage tab the One Take prototype does not draw — it has Videos, " +
      "Highlights and Projects. Specified in the handoff rather than drawn, " +
      "so there are no prototype words to copy. Crawled for the first time " +
      "on 28 Oct 2026, when the surface list stopped being nine literals.",
  ]),
  /*
   * AN IMPORT NOBODY HAS READ, which no design draws because no design draws
   * importing. Connecting a bucket is specified in the handoff and in
   * docs/handoff/12-DEFERRED.md's direct-integrations list; the prototype's
   * Footage has Videos, Highlights and Projects and no notion of footage that
   * is in the library and unread.
   *
   * Signed off on 20 Nov 2026, when the state got a branch at all. Until then
   * an imported video rendered the editor's own empty state — "Nothing kept
   * yet — add a clip back" — which says it was read and nothing was worth
   * keeping, the opposite of the truth. These two strings say what is true
   * and offer the read, which /api/sources/:id/retry has always been able to
   * do and nothing had ever asked it for.
   */
  ...[
    "Nobody has read this one yet. Reading it writes down every word, finds the moments, and is charged once.",
    "Read it",
  ].map((t) => [
    t,
    "An imported source in the `unread` state. No design draws importing, " +
      "so there are no prototype words to copy. Signed off 20 Nov 2026 with " +
      "the branch that renders them.",
  ]),
  /*
   * THE SCOUT BOARD. There is a `design/one-take/Scout.dc.html`, and it does
   * not contain these strings: the board was built from
   * docs/handoff/18-SCOUT-BUILD-SPEC.md, which specifies what it must show
   * (gaps first, the balance meter, then the verified rows) and not what it
   * must say. It had never been rendered by any check before 28 Oct, because
   * it answered at /api/projects/:id/scout/board and every crawl skips /api/.
   */
  ...[
    "The Scout board",
    "no brief run yet",
    "Nothing yet. Scout turns the brief into things a viewer could point to on camera — never a diagnosis — then searches for each, and for its opposite.",
  ].map((t) => [
    t,
    "The Scout board, specified in 18-SCOUT-BUILD-SPEC.md by what it must " +
      "show rather than by what it must say. design/one-take/Scout.dc.html " +
      "does not draw this screen. The third string is the empty state and " +
      "carries the refusal the spec insists on: Scout looks for observable " +
      "behaviour, never a diagnosis.",
  ]),
  [
    "Make it rules",
    "The brief compiler's one control: paste a brief and it becomes rules " +
      "you can see and switch off. The prototype has no brief box at all — " +
      "its rules arrive from sentences in the conversation — so there is " +
      "nothing drawn to copy. The words say what pressing it does, which is " +
      "the whole promise of the feature: not 'apply', but that a brief " +
      "BECOMES rules.",
  ],
  /*
   * /eval, WHICH IS NOT IN ANY PROTOTYPE BY DESIGN.
   *
   * It is the labelling surface for Phase 0's set — two labellers answering
   * whether a moment backs a claim — and it is a tool for building the
   * evidence this product's retrieval is measured against, not part of the
   * product a user buys. No prototype draws it because no user sees it.
   * Signed off as a set rather than individually: the whole page is in this
   * category and splitting it would imply some of it was drawn.
   */
  ...[
    "What backs what",
    "Write a claim, then say whether each moment backs it. Nothing about how well search works means anything until this exists.",
    "Answering as",
    "Ask the judge",
    "Take the set away &nearr;",
    "· every answer so far, as the file the runner reads",
    "Find moments",
    "CLAIMS SO FAR",
  ].map((t) => [
    t,
    "The labelling surface at /eval. It builds the ~200-claim set that " +
      "Phase 0's acceptance measures retrieval against; it is a tool for " +
      "the people making the evidence, not part of the product a user buys, " +
      "and no prototype draws it because no user sees it.",
  ]),
  ...[
    "As recorded",
    "Clean it up",
  ].map((t) => [
    t,
    "The export panel's sound choice. The container has had a full denoise, " +
      "de-click, presence, compression and broadcast-loudness chain since it " +
      "was written and NOTHING EVER RAN IT — /enhance-audio had no caller in " +
      "src/ at all. Off by default, like captions and for the same reason: " +
      "it changes how somebody's voice sounds and a finished file cannot be " +
      "un-processed.",
  ]),
  [
    "Talk over it",
    "B-roll with narration. The renderer has mixed a recording over a clip " +
      "with the clip's own audio sidechain-ducked underneath since that " +
      "branch was written, and nothing had ever handed it one \u2014 a beat was " +
      "either a clip OR a recording, so a voiceover became a flat colour " +
      "card and the picture was thrown away. On a voiceover beat the button " +
      "still says \"Record it\"; this is the b-roll wording.",
  ],
  [
    "Watch the cut",
    "The editor has always played the ORIGINAL: striking a line greys it out " +
      "and changes a number, and that is the whole feedback. Whether the cut " +
      "actually flows could only be found out by exporting the file and " +
      "watching it, which is the missing half of editing by text. The " +
      "prototype has no such control because its demo cut is not playable. " +
      "The toggle reads \"Whole video\" while it is on.",
  ],
  [
    "Whole video",
    "The same toggle, pressed. Says what it will do rather than what it is " +
      "doing, like every other control in this product.",
  ],
  [
    "Tell me what to change and I'll go through the whole transcript. Try \u201Ccut the bits where I repeat myself\u201D, \u201Ckeep only the strongest points\u201D, or \u201Cput the punchline first\u201D.",
    "What the assistant says before you have said anything. It replaces " +
      "nine example chips that sat in a wall down a 300px column — nine of " +
      "anything is a list you skip rather than read — and it names the two " +
      "verbs a pass has: selecting (keep or cut) and, now, ordering. The " +
      "prototype has no such control, because its assistant is one input " +
      "with no conversation behind it.",
  ],
  [
    "It reads the whole transcript.",
    "Under the composer, because a pass is not a search: it costs minutes " +
      "and money and reads every window of the source, and the field it " +
      "sits under looks exactly like a box you might expect to filter " +
      "something. Saying what it does is cheaper than a surprised bill.",
  ],
  [
    "Undo this",
    "A pass rewrites the whole cut at once, and the only way back was a toast " +
      "that expired in six seconds or Cmd-Z — which the owner does not press, " +
      "so in practice the one action that changes everything was permanent " +
      "the moment you looked away. Each pass now keeps the cut as it stood " +
      "before it ran and the turn spends that snapshot once. The prototype " +
      "has no such control because its assistant is a single input with no " +
      "conversation behind it and nothing to take back.",
  ],
  ...[
    "Empty the bin",
    "Put it back",
    "Delete for good",
  ].map((t) => [
    t,
    "The deleted pile in Settings. Delete is a soft delete here — an edit or " +
      "a video goes to a bin you can take it back out of — and the " +
      "prototype has no bin at all, because nothing in it can be deleted. " +
      "These have been shipped for a long time and were never CHECKED: the " +
      "controls only render when the bin has something in it, and no check " +
      "had ever put anything there. The editor gate now makes a library edit " +
      "and deletes it again, which is what finally rendered them.",
  ]),
  [
    "THEY CALLED IT NON-LINEAR \u00B7 THEN GAVE YOU A LINE",
    "Replaces the prototype's 'NO TIMELINE \u00B7 NO SCRUBBING \u00B7 NO NLE', " +
      "which sat directly above the headline 'The timeline is gone. Good.' " +
      "and said the same thing twice \u2014 an eyebrow should earn the headline, " +
      "not restate it. The replacement is the owner's own observation: " +
      "'non-linear never made sense, now we make it make sense'. Non-linear " +
      "editing meant random access rather than cutting tape in sequence, and " +
      "the interface the industry shipped for it is a literal horizontal " +
      "line you drag along. Naming that is a sharper claim than listing what " +
      "we left out.",
  ],
  ...[
    "In this cut",
    "Ask the model",
    "More like these",
  ].map((t) => [
    t,
    "The command bar's three groups. The editor had TWO text boxes — 'Find " +
      "a word in this cut' and 'Ask for another pass' — plus nine example " +
      "chips and three counted clean-ups, all stacked down a 300px column " +
      "under a video taking 62vh of it, so the two most powerful things in " +
      "the product were below the fold behind a scrollbar at the narrowest " +
      "width on the page: 'scrollbars to see all the options and shit... " +
      "even without the scroll it wasn't the most elegant solution to begin " +
      "with'. Find and Ask are the same gesture at different precision — " +
      "'sponsor' means the twelve places it is said, 'cut the sponsor read' " +
      "means the model decides — so they are one field, and these name what " +
      "each answer is. The prototype has no such control because it has one " +
      "box and a wall of chips.",
  ]),
  ...[
    "Shorts",
    "Full videos",
  ].map((t) => [
    t,
    "Exports lists both kinds now, under two headings. Clipping was the " +
      "ONLY surface that listed a finished short, so scrapping it while " +
      "Exports asked for cuts alone would have left every short unreachable " +
      "and still paying for its storage. Two headings rather than two tabs, " +
      "because two tabs means two counts, and a count that disagrees with " +
      "its list is the bug this page has already had twice.",
  ]),
  [
    "Drop",
    "Keeping a clip, where the clips are. src/projects.ts has always said " +
      "kept 'means ONE thing: I want this moment. That is what Footage's " +
      "Clips tab shows' — and the only place you could say so was Clipping. " +
      "The handler and the route both outlived it with nothing rendering a " +
      "button. The list is filtered to kept clips, so this always drops and " +
      "undo puts it back.",
  ],
  [
    "Exports",
    "Footage's fourth tab. A finished cut lived only in the Exports strip " +
      "inside the one edit that made it, so finding last week's meant " +
      "remembering which edit that was — 'that should also be saved to a " +
      "place of finished or exported or whatever'. The word is the one the " +
      "export panel already uses.",
  ],
  [
    "Nothing exported yet \u2014 finish a cut and it lands here.",
    "The Exports tab's empty state. Says what fills it, rather than that it " +
      "is empty.",
  ],
  /*
   * THE LANDING PAGE.
   *
   * These are the first strings this check has ever seen from it. `/` is the
   * landing site when signed out and Home when signed in, and the dev server
   * has DEV_LOGIN_EMAIL set — so `/` was always Home and the whole marketing
   * page went unchecked. Adding /landing to ROUTES surfaced thirteen strings
   * at once: five new (the shorts section) and eight that had drifted from
   * design/Landing.dc.html at some point with nothing to notice.
   *
   * Signed off collectively rather than argued line by line: this is authored
   * marketing prose, which is a different thing from UI chrome, and the point
   * of listing it is that from now on changing it is visible.
   */
  ...[
    "VERTICAL, WITHOUT ASKING",
    "Any line in it becomes a vertical short.",
    "It reads the whole thing and scores what would stand alone. Press one and it cuts vertical with the captions burned in, ready to post. No brief, no timeline, no second tool \u2014 the same page you edit in.",
    "THAT'S THE WHOLE",
    "POINT THOUGH",
    "ISN'T IT",
  ].map((t) => [
    t,
    "The shorts half of the product, which this page did not mention at all: " +
      "it sold 'editing is reading now' and nothing else. The pitch is " +
      "Descript AND OpusClip and only one half was on the way in. The claim " +
      "was rewritten when Clipping was scrapped: it used to promise 'One " +
      "long video in. Eight shorts out.' and describe a batch that cut every " +
      "winner unasked. That batch is gone — shorts are made one at a time " +
      "off any line in the editor — and a landing page must not sell a " +
      "surface that no longer exists.",
  ]),
  /*
   * "READING" WAS TWO DIFFERENT THINGS AT ONCE.
   *
   * The prototype's pitch is "editing is reading now" and "EDIT BY READING",
   * and every session since has ALSO used "read" for what the machine does —
   * "reading it", "reading it for meaning", "it starts reading". Same verb,
   * two subjects: you read, and it reads. The owner: "this whole reading, I
   * remember I told the last one to change it — editing is reading now does
   * not make sense."
   *
   * He is right twice. Reading is passive and what you actually do is edit
   * text, and the machine's half of the word is not in the prototype at all
   * — earlier sessions invented it and it collided with the design's own.
   *
   * So the machine transcribes, and the pitch is his: "The timeline is gone.
   * Good." A deliberate departure from design/Landing.dc.html, made by the
   * person whose product it is.
   */
  ...[
    "The timeline is gone.",
    "Good.",
    "CUT BY DELETING WORDS",
    "Delete a sentence, and the shot goes with it.",
    "You edit the words instead.",
    "Go cut it into a video.",
    "It takes the sentence and works out the job.",
    "Drop an hour of video and say what you want out of it. Aldershot transcribes the whole thing and makes the first cut \u2014 you strike what's weak, keep what's good, and it's done.",
    "A file or a link, plus one sentence about what you want. It transcribes the whole thing \u2014 every word, timestamped.",
    "An hour becomes nine minutes. It cuts first; you fix anything by editing the text and striking lines.",
    "It shows you what it found and why. You keep, cut, and reorder in the transcript \u2014 Space plays, arrows step through.",
    "If you can edit a sentence, you can cut a video. The editor is the transcript \u2014 strike what you don't want, keep what you do. There's no timeline to learn, and the first pass is already done when you arrive.",
  ].map((t) => [
    t,
    "The reading pass. The machine transcribes; you edit. One verb each, so " +
      "the product stops using the same word for both, and the hero says " +
      "something rather than asking to be decoded.",
  ]),

  ...[
    "The whole video is text. Strike a line and it's out of the cut. Drag across a phrase and it goes with a count of exactly what you'll lose. Find a word and cut every place it was said \u2014 the sponsor read, the tangent, the tic \u2014 in one go. Nothing is deleted: everything is one undo away.",
    "Every moment you keep stays in one library \u2014 timestamped, playable, and searchable by the words that were said rather than what you named the file. Months later, pull a line from a video you shot in March straight into the cut you are making today. That is how a clip becomes a supercut, and a supercut becomes an essay.",
    /* Trimmed when the Adjust sheet went with Clipping. It used to promise
       "A short is never take-it-or-leave-it — move its in and out points by
       pointing at the words, and see the frame it opens on before you spend
       a render", which was Clipping's trim-by-word sheet and exists nowhere
       now. Shortening a short means striking words in the editor first. */
    "Every render lands ready to leave: download it, or cut a short straight off any line in it at whatever shape the platform wants, captions burned in. Nothing you upload ever expires, and the original is never touched: an edit is a set of decisions about a video, so you can make another one from the same footage tomorrow.",
    "\u201cFine \u2014 yes, we moved the launch before the review came in.\u201d",
    "\u201cThe roadmap slide was aspirational. Very aspirational.\u201d",
    "\u201cWe script the \u2018unscripted' Q&A. Everyone does.\u201d",
    "6 clips from 2 sources \u00b7 2 of your own \u00b7 1080p MP4 \u00b7 9:04",
  ].map((t) => [
    t,
    "Landing copy that already differed from design/Landing.dc.html before " +
      "this check could see the page. Recorded as it stands rather than " +
      "reverted \u2014 it reads better than the prototype's and is what the site " +
      "has been serving; the value of listing it is that the next change to " +
      "it is visible.",
  ]),
  ...[
    "A minute of footage we read. A one-hour video costs roughly its length, once \u2014 and after that, cutting it, re-cutting it and exporting it cost nothing at all.",
    "A processing minute is a minute of footage we read. Cutting, re-cutting and exporting are free, and storage is permanent on every plan.",
  ].map((t) => [
    t,
    "THE PRICING PAGE WAS DESCRIBING A METER THE CODE DOES NOT KEEP. Both " +
      "of these said a processing minute covered rendering cuts and burning " +
      "captions. checkCap (src/plans.ts) sums usage_events WHERE " +
      "job_type = 'transcribe' and nothing else, so a render has never once " +
      "moved that number \u2014 and this is the page a customer reads before " +
      "paying, which makes it the worst possible place to be wrong about " +
      "what they are buying. The copy changed rather than the charge: " +
      "whether a render SHOULD consume minutes is a pricing decision, and " +
      "not one to make by quietly starting to bill for it. Exports being " +
      "free is also the better thing to be true, so it is now said out loud " +
      "instead of being a discrepancy.",
  ]),

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
    "Keep only the good bits",
    "Was \"Find the strong bits\". Two things were wrong with that name and " +
      "the owner named both — \"the vocabulary and what it actually does\". " +
      "\"Find\" promises annotation and the control DELETES: the pass returns " +
      "action keep, and everything it did not pick is struck. A destructive " +
      "button whose name does not say what disappears is the thing people " +
      "are frightened of pressing, and this one is gold and sits alone. " +
      "\"Strong\" was worse than vague, it was circular — the instruction sent " +
      "the model the word \"strongest\" and asked it to score \"how strongly " +
      "it matches\", with nothing anywhere saying what a good moment is. Now " +
      "fixed in src/score.ts and held by test/strong.test.ts. The prototype " +
      "has no word for any of this because its scoring lived on a separate " +
      "surface — Clipping — rather than being something you ask for while " +
      "editing. Making it an assist INSIDE the editor is the point of " +
      "docs/decisions/blocks.md: the model marking what is strong is a " +
      "property of the blocks you are already reading, not a destination.",
  ],
  [
    "Shape it",
    "The second of two row headings over the verbs, and the two rows are two " +
      "different promises. Clean up is subtractive, counted and instant — " +
      "fillers and silences are found in the transcript by code, so the " +
      "button prints how many there are before you press it. Shape it asks " +
      "the model for a judgement: it costs a pass, it takes minutes, and it " +
      "can come back with nothing. Splitting them by THAT rather than by " +
      "topic is what stops the free ones and the expensive ones reading " +
      "alike. The prototype has no verb list at all — its assist is one field.",
  ],
  ...[
    ["Start where I start", "the mic check and the false start before the first real sentence"],
    ["Cut the tangents", "the bits that go nowhere"],
    ["Lead with the best line", "the one reorder instruction, which the arrange pass already takes"],
    ["Cut the hedges", "\"I think\", \"kind of\", \"if that makes sense\""],
    ["Cut the meta", "\"sorry about the audio\", \"as I said last time\""],
    ["Remove the sponsor read", "the ad read, which the scoring rules already refuse to keep"],
    ["Say it once", "the same point told three times, keeping the best telling"],
    ["Make it half as long", "a length, said as a length"],
    ["Cut where I asked", "\"can we cut that\", \"strike that\", said on camera"],
  ].map(([label, what]) => [
    label,
    "One of the verbs over the composer: " + what + ". THESE WERE REMOVED " +
      "AND THE REMOVAL WAS THE MISTAKE. Nine example prompts were replaced " +
      "with one sentence, on the argument that nine is \"a wall you skip " +
      "rather than read\" — tidiness bought at the cost of the one control " +
      "this product is about. The owner: \"if this is the result i don't " +
      "think you understood the significance i was placing on it\". A chat " +
      "with no suggested prompts is a discoverability failure: after two " +
      "years of Underlord there is still no community prompt library for " +
      "it, only the vendor's own copy, and even the chat-first product " +
      "sells itself with chips. Six are visible and six sit behind More, " +
      "because products converge on three to six in front and everything " +
      "else a layer down. The prototype has none of these words — it draws " +
      "a single field and no examples, which is the state this fixes. Every " +
      "label is an imperative verb plus a concrete noun in the words a " +
      "person would use, \"Cut the tangents\" over \"Edit for Clarity\"; and " +
      "every one carries the sentence it would type, so pressing a button " +
      "and typing it are the same act and no verb does anything the box " +
      "cannot.",
  ]),
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
  /*
   * SCOUT'S CARD IN THE EDITOR. Four strings the prototype has no words
   * for, because One Take draws Scout in the plan flow and not in the
   * project state — "Scout is how the video gets better than your footage
   * alone" is the Manual's line, and the Manual weights him more heavily
   * than the prototype does.
   *
   * They have rendered since Scout was wired and this check never saw
   * them: /editor shows the most recent project, and no project in the
   * account it runs against had a source until one was seeded. Signed
   * off rather than rewritten — the card says what Scout does in his own
   * terms, and there is nothing to match it against.
   */
  [
    "Look outside this project",
    "The Scout card's heading in the editor. Says where he looks, which is " +
      "the one thing that distinguishes him from the search box above.",
  ],
  [
    /* The entities, not the characters: this check reads the markup and
       does not decode one. Same trap as "Take it elsewhere &nearr;". */
    "Scout finds clips that aren&rsquo;t yours yet &mdash; links, never downloads. He turns the brief into things a viewer could point to on camera, and searches for each and for its opposite.",
    "What Scout is, in the two sentences that matter: invariant 9 (links, " +
      "never downloads) and the behaviour-first decomposition doc 18 asks " +
      "for. Both are promises a person can hold us to.",
  ],
  ["Send Scout", "The press. A verb and a name, like every other control here."],
  ["The board", "Where his findings are. The prototype's own word for it."],
  [
    "Take it elsewhere &nearr;",
    "The OTIO export, in the export panel. The prototype has no interchange " +
      "file at all — it is doc 09's escape hatch and Phase 1's last " +
      "acceptance item, so there was no wording to follow. Says what the " +
      "link does from the person's side rather than naming a format: " +
      "somebody who wants this wants to take the edit somewhere, and the " +
      "line beneath it says what they get. 'Export' was taken, by the " +
      "button six pixels above it that makes a video.\n\n" +
      "The entity rather than the character, because this check reads the " +
      "markup and does not decode one. Said here so the next person to " +
      "paste a signed-off string does not spend an evening on it.",
  ],
  [
    "The cue sheet &nearr;",
    "The cue sheet, in the export panel under the OTIO link. The prototype " +
      "has no Before you post step at all — doc 09 does, and this is the " +
      "first piece of it — so there was no wording to follow.\n\n" +
      "Named rather than described, because 'cue sheet' is what the " +
      "document is called by everyone who will ever ask for one: a " +
      "platform reviewer, a broadcaster, somebody answering a complaint. " +
      "Inventing a friendlier phrase would leave the person unable to say " +
      "what they have. The sentence beside it does the explaining.\n\n" +
      "The entity rather than the character, same trap as the line above.",
  ],
  [
    "The dispute file &nearr;",
    "The dispute file, under the cue sheet. Same reason as the line above: " +
      "the prototype has no Before you post step for it to belong to.\n\n" +
      "'Dispute file' is doc 09's own name for it and the name it would be " +
      "asked for by, so it is named rather than described — but the " +
      "sentence beside it leads on what the person gets, because most " +
      "people reading it have never had a dispute and should still open it.",
  ],
  [
    "Before you post &nearr;",
    "Doc 09's checklist, and the first of the three links because it is the " +
      "one read first. The prototype has no Before you post step at all, " +
      "which is why none of these three can be matched against it.\n\n" +
      "The phrase is doc 09's own heading and is what the step is called " +
      "everywhere else in the handoff, so renaming it here would leave the " +
      "product and its documentation using different words for the same " +
      "screen.",
  ],
  [
    "The whole record &nearr;",
    "The provenance manifest, last of the four export documents because it " +
      "is the only one written for a machine as much as for a person.\n\n" +
      "Not called 'the provenance manifest' on the link, because nobody " +
      "asks for one by that name until they already know what it is. It " +
      "says what you get — the whole record — and the sentence beside it " +
      "says what that means and what it leaves out.",
  ],
  [
    "Whether it is working",
    "Phase 8's SLO dashboard, on Settings and owner-only. Four readings, and the hard part is what is left out: a dashboard of everything measurable is one nobody reads, and the thing somebody needs at 2am is \"is it broken, and which part\" rather than a percentile.\n\nNamed as the question rather than as \"Status\" or \"Health\", because those are nouns a reader has to decode and this is the sentence they already have in their head. The prototype has no such panel and could not: it predates there being providers to watch.",
  ],
  [
    "The judge, checked",
    "The canary's reading. One synthetic claim goes through the REAL judge every sweep, with the right answer known in advance \u2014 so a provider that answers with nonsense fails it, which a liveness probe would not notice. Never checked shows a dash and asks for attention, because reporting the absence of a check as the success of one is the failure this panel exists to avoid.",
  ],
  [
    "Jobs finished",
    "Finished against died, over a day. One failed job is Tuesday \u2014 a user cancels, a provider blips \u2014 so this asks for attention only when failures are a real share of the day, unlike the row below it.",
  ],
  [
    "Pieces accounted for",
    "The reading with teeth: items that failed inside jobs which reported finishing. Invariant 7 \u2014 \"a job is complete only when every item is terminal and none failed silently. Silent partial failure is a P1.\" The completion invariant exists to make it impossible; this counts whether it is happening anyway, because a rule nobody measures is a rule that can stop applying without telling you.\n\nNo acceptable rate, so no share to clear: one piece in twenty asks for attention. \"Pieces\" rather than \"items\" because a person reading this did not write the item state machine.",
  ],
  [
    "Providers answering",
    "The breaker's state, summarised, with the shut pool named underneath. A shut pool does not stop a job \u2014 the capability falls to the model that runs without an external key \u2014 so the summary is a count and the rows beneath it carry the sentence that shut one.",
  ],
  [
    "Model providers",
    "The breaker's state, on Settings and owner-only. Phase 8 accepts on " +
      "\"kill a provider mid-job in staging and the job completes on another " +
      "pool\" \u2014 and a pool that is shut routes its capability to the model " +
      "that runs without an external key, which works and is not as good.\n\n" +
      "So the state has to be visible or the degradation is silent: a job " +
      "that quietly finished on the free model is a job whose receipts are " +
      "tagged with a different model, and the sentence that shut the better " +
      "pool is the only answer to why. Invariant 3 \u2014 the reason, not a " +
      "score. The prototype has no panel for this, and could not: it " +
      "predates there being more than one pool.",
  ],
  [
    "Answering normally.",
    "What a healthy pool says, and a sentence rather than a blank. An " +
      "empty line beside a pool name reads as missing information \u2014 the " +
      "same reason \"nothing backs this\" is a sentence and not an empty " +
      "list.",
  ],
  [
    "anthropic/user",
    "A pool is a way IN to a model, not a model: the same Claude is reached " +
      "through the user's own key or through ours, and those fail " +
      "separately. Named as the route rather than prettified, because the " +
      "person reading this panel is the owner deciding whether a provider " +
      "is down or a key is wrong, and \"Your Claude key\" would hide which " +
      "of the two shut.",
  ],
  [
    "anthropic/platform",
    "Our own Claude key, as a pool. See anthropic/user \u2014 the split is the " +
      "point: a 429 on somebody's own key is their account's limit and must " +
      "never shut this one.",
  ],
  [
    "workers-ai",
    "The pool that needs no external key, and the one a shut Anthropic pool " +
      "falls to. Listed beside the others because it can fail too, and " +
      "because its being healthy is what makes the fallback honest.",
  ],
  [
    "What goes here",
    "Invariant 8's other half, on every line of the cut that has words.\n\n" +
      "src/pictures.ts has been complete and half-reachable since Phase 5: " +
      "`allowed()` refuses a generated card over a claim at the beat " +
      "insert, so the refusal bites, and nothing in the product ever " +
      "OFFERED a picture — so `place()` and `reasonFor()` chose between " +
      "candidates only in their own tests. There was no surface to match " +
      "against, because the prototype's block row has no picture control " +
      "at all.\n\n" +
      "Three words rather than 'Suggest a picture', because the question " +
      "the panel answers is doc 08's: not 'what noun did the sentence " +
      "contain' but 'why am I seeing this'. The panel leads with what was " +
      "chosen and why, then what was refused and why, then the sources " +
      "that have nothing behind them yet — naming documents and generated " +
      "rather than omitting them, since an empty list and an unbuilt " +
      "source look identical and are not.",
  ],
  /*
   * ELEVEN STRINGS THAT WERE NEVER CHECKED, because they wore the mark
   * that means "the user's footage wrote this".
   *
   * data-content exempts an element from this rule, for a good reason: a
   * transcript line, a filename or a model's sentence cannot be in the
   * prototype and must not be flagged. It had spread by copy-paste onto 46
   * pieces of STATIC copy, so a whole row could be added to the front door
   * and paraphrased and this check stayed green — which is what happened
   * while the Scout row was being built. The mark is off all 46 now, 35 of
   * them turned out to be the prototype's own words, and these eleven are
   * the ones that genuinely are not. `content` (below) is the rule that
   * stops it spreading again.
   *
   * All eleven are on two surfaces the prototype does not draw at all: the
   * record panel after a render, and the two Settings panels about ending
   * things. Both exist because the product sells and must be leaveable.
   */
  [
    "In the editor",
    "The nav anchor back to an open project. The prototype has one room " +
      "and no second place to be, so it has no word for 'where you were' " +
      "— the build does, because the editor is a route you can navigate " +
      "away from and come back to.",
  ],
  [
    "Seven things worth knowing before this goes out, and a straight answer about the ones nothing here can check.",
    "The Before you post step, which the prototype has no equivalent of " +
      "(the same gap already signed off for \"Before you post &nearr;\").\n\n" +
      "The second clause is the load-bearing one and is deliberately not " +
      "softened: of the seven, some are measured and some cannot be, and a " +
      "pre-flight that implied it had checked all seven would be the one " +
      "kind of lie this product cannot tell.",
  ],
  [
    "The cuts as a timeline (.otio) for Resolve or Premiere, each clip named by what is said in it and carrying its quote, its source and where its timings came from. Captions, sound work and graphics are rendered rather than described, so those stay here.",
    "The OTIO escape hatch (doc 11, Phase 7). The prototype shows no " +
      "export panel at all.\n\n" +
      "The second sentence is a limit, said before the download rather " +
      "than discovered in Resolve: OTIO carries the cuts, and the caption " +
      "burn-in and the ducking are baked into the rendered file. Somebody " +
      "who opens the timeline expecting their captions would otherwise " +
      "find out by looking for them. It names graphics as well now, because " +
      "the file's own metadata note names them and two sentences about the " +
      "same file disagreeing is how somebody loses an afternoon.\n\n" +
      "THE FIRST SENTENCE SAYS WHAT ARRIVES, which it did not before, and " +
      "that half was the more useful one. src/otio.ts has written a receipt " +
      "into every clip since the day the export existed \\u2014 the quote it " +
      "contains, the source key it came from, and whether its word timings " +
      "are forced-aligned or the recogniser's own \\u2014 and nothing in the " +
      "product mentioned it at the moment somebody chose whether to use the " +
      "file. Three competitors assessed this autumn hand over a project " +
      "file (Pause makes it the entire product, at $15 to $200 a month) and " +
      "not one of them puts provenance in it. Describing it where the " +
      "decision is made costs a clause.",
  ],
  [
    "Every picture in here that isn't your own footage — what it shows, how it was made, when. It ships with the file already.",
    "Invariant 8's paper trail. The prototype's block row has no picture " +
      "control, so there was nothing to match.\n\n" +
      "\"already\" is the point: the manifest is written as the cut is " +
      "made, not generated when somebody asks, so there is no window in " +
      "which a picture is in the video and absent from the record.",
  ],
  [
    "Everything in here that came from somebody else — where from, how much of it, and what the credit said. Written as you cut, not when somebody asks.",
    "The cue sheet, for the same reason as the line above and with the " +
      "same clause doing the same work. \"how much of it\" rather than a " +
      "duration because the question a rights holder asks is proportion, " +
      "not seconds.",
  ],
  [
    "Every source, every rule, and what each rule left out — as a file another tool can read. It says what it doesn't cover, too.",
    "The dispute file (doc 09). Invariant 4 is that every claim keeps its " +
      "receipt and \"nothing backs this\" must be reachable — so the file " +
      "has to state its own gaps, and the sentence that says so is the " +
      "last one rather than a footnote.",
  ],
  [
    "A page your audience can read: what you quoted, where from, and whether it was checked. Nothing is public until you publish it.",
    "The public receipts page, already signed off as a link (\"Receipts " +
      "for viewers &nearr;\"); this is the sentence under it.\n\n" +
      "The second sentence is there because the other four links in the " +
      "panel give the reader a document and this one gives somebody else " +
      "a page. Nobody should be able to press it and wonder afterwards " +
      "whether it went out.",
  ],
  [
    "Close this account",
    "The prototype has no Settings surface and nothing that ends. The " +
      "right to erasure is not optional for anyone selling into the EU or " +
      "UK (docs/LAUNCH.md), so the product needs this and the design never " +
      "drew it.",
  ],
  [
    "Removes every video, edit and export, and the storage they hold. There is no bin behind this one.",
    "The one place invariant 6 does not hold, said in the plainest words " +
      "available. Everything else in the product switches off, waits 30 " +
      "days, or is one undo away; this does not, and the sentence has to " +
      "be the exception rather than sound like the rest of them.",
  ],
  [
    "Deleting is reversible until you delete for good — that removes the video and every render made from it, and gives the storage back.",
    "Invariant 6, stated where somebody acts on it. \"and every render " +
      "made from it\" is the clause that earns the sign-off: a person " +
      "purging a source to free space will not guess that the exports " +
      "they kept go with it, and finding out afterwards is unrecoverable.",
  ],
  [
    "The last day, from rows the product already writes. A dash means nothing happened, which is not the same as nothing going wrong.",
    "The owner-only spend panel. No prototype equivalent — the design has " +
      "no operator surface.\n\n" +
      "The second sentence exists because a dashboard of dashes reads as " +
      "healthy and is also what a stopped writer looks like. Saying which " +
      "it cannot tell you is the honest version, and it is the same rule " +
      "the SLO page follows.",
  ],
  ...[
    "Four rules, sixteen cuts. Every one of them is what these rules produce from these moments — the cut is never stored, it is worked out.",
  ].map((x) => [
    x,
    "THE DEMO IS LIVE AND THE DESIGN'S IS NOT, which is the whole reason this line exists." +
    "\n\n" +
    "The design's rules column has no caption under it. The build's resolves every combination of the four rules on the server and ships all sixteen, so clicking a rule picks a cut the rules produced rather than animating a mock-up. A stranger cannot tell those apart by looking, and the difference is invariant 1 — which is the one thing on this page neither competitor has."
  ]),
  ...[
    "ONE CONVERSATION · SIX THINGS OUT",
  ].map((x) => [
    x,
    "The design's eyebrow says FOUR THINGS OUT and its own card list, in the same file, has six: Cuts, Shorts, Reactions, Essays, Stories, Supercuts. The room offers all six. Rendering six cards under a label that says four would be reproducing a design bug on the only page a stranger reads, so the count follows the cards."
  ]),
  ...[
    "Rules, the archive, and search by what was said",
    "No, and it doesn't pretend to: you download the finished file, or export the edit to Resolve, Premiere or Final Cut and take it from there. Every export carries a provenance record, and a cut can have a public link that lists every source and every edit it used.",
  ].map((x) => [
    x,
    "THE DESIGN PROMISES SOMETHING THIS BUILD DOES NOT HAVE, and the pricing table and the FAQ are the two places where that costs money or trust." +
    "\n\n" +
    "The design's Free bullet is \"Rules, recipes, and the archive\" and its FAQ answer is \"set a webhook and every finished piece POSTs to it — Zapier, Make, n8n, or your own endpoint\". Recipes do not exist: rules are keyed by project and nothing carries a set anywhere. The only webhook in this codebase is Stripe's, inbound. Both replacements say what the product does instead, and both are in 12-DEFERRED.md with what it would take to build them."
  ]),
  ...[
    "Continue with Google",
    "or use your email",
    "Email me a link",
    "One more tap.",
    "Confirm it was you who asked for this link.",
    "If you didn't ask for this, close this page — nothing has happened yet.",
  ].map((x) => [
    x,
    "SIGNING IN HAS NO DESIGN. Every control in both landing designs opens the prototype app directly — there is no account, no link in an inbox and no OAuth anywhere in them, so there was nothing to match against." +
    "\n\n" +
    "These six strings had never been checked by anything either: the crawl's dev server is always signed in, so the sent-a-link branch never renders, and the confirmation page needs a one-time token that visiting it would spend. The copy rule reaches them because it renders the functions rather than fetching the routes." +
    "\n\n" +
    "The confirmation page is deliberately a form rather than an automatic sign-in: the token is spent by the POST, so a mail scanner that fetches the URL cannot burn it. That is what \"One more tap\" is apologising for."
  ]),
  ...[
    "Every clip in this video is the maker's own footage.",
    "This page lists what this video quoted and where from. It does not list the maker's own footage, and it cannot tell you whether a quote is fair — only whether the words are there, at that time, in that source.",
  ].map((x) => [
    x,
    "The public receipts page, which no prototype draws — the same gap already signed off below for the link that opens it. Doc 09: \"the edit you can interrogate is a promise to the audience, not just the maker\"." +
    "\n\n" +
    "The second sentence is the one that matters and it is a refusal: this page can say the words were said, at that time, in that source, and it cannot say the quote is fair. A receipts page that let a reader believe otherwise would be worse than none, which is invariant 4 read the strict way."
  ]),
  ...[
    "How much of each video the rules are using. Press Only this to cut from one of them alone.",
    "This cut is narrowed to one video. The others are still attached — press Only this ✓ again and they all come back.",
    "This cut has no videos attached yet.",
    "This is your only project so far.",
  ].map((x) => [
    x,
    "FOOTAGE'S VIDEOS TAB, INSIDE A PROJECT. The prototype has the tab and the \"Only this\" control on each video; it has no hint line above them and no empty states anywhere, because a prototype always has data." +
    "\n\n" +
    "The second sentence is the one that had to be written. The prototype's narrowing is page state and it never tells you it is reversible — and \"only\" is a word people have been burned by, so a control that looks like it might throw the rest of the cut away needs to say that it does not. It does not: the narrowing is its own column and the project's record of what it is made of never moves (invariant 6)." +
    "\n\n" +
    "The two empty states are the same gap one level down. A cut with nothing attached and an account with one project are both states the product reaches on its first day and no design draws."
  ]),
  ...[
    "of that bought nothing &mdash;",
    "that failed. Absorbed rather than charged on, which is what makes it worth watching.",
  ].map((x) => [
    x,
    "WHAT THE MONTH SPENT AND GOT NOTHING FOR \u2014 one line on the " +
      "owner-only cost panel, which no prototype draws because the design has " +
      "no operator surface. Same gap already signed off for the spend panel's " +
      "other copy below.\n\n" +
      "Decision 38 is \"charge for what drives cost; absorb the failed " +
      "attempts\". The business therefore eats every failure, and nothing " +
      "anywhere said how much: `usage_events.outcome` was written by five " +
      "call sites and read by none, and 9,702 of the 9,703 rows in the " +
      "development database have no outcome at all. The second sentence is " +
      "the one that earns its place \u2014 absorbing a cost is a choice, and a " +
      "choice nobody can see the price of is not being made on purpose.\n\n" +
      "The figures beside these words are `data-content`; the words are not, " +
      "which is why they are here. Marking the whole sentence would have " +
      "exempted the wording from every check in the gate, and splitting it " +
      "so the words follow a closing tag hides them just as well \u2014 the " +
      "extractor only reads text that follows an opening tag.",
  ]),
  [
    "Nothing cut from this yet. An edit never changes the footage \u2014 you can make as many as you like.",
    "A READ VIDEO WITH NOTHING MADE FROM IT \u2014 a state no design draws, " +
      "because a prototype's library always has work in it.\n\n" +
      "The sentence is invariant 5 said out loud on the page where somebody " +
      "would doubt it: footage is read once and charged once, and an edit is " +
      "a set of decisions ABOUT a video rather than a consumption of it. " +
      "This is the one page where a person can see a video they paid to read " +
      "and nothing yet to show for it, so it is where that has to be said.\n\n" +
      "Found by CI, by accident: the fixture grew a second video, the crawl " +
      "picked it, and this half of /sources/:id rendered for the first time " +
      "ever. The first source has had a project since the fixture existed, " +
      "so on every machine that has run the gate the empty branch was " +
      "unreachable. scripts/render-pages.mjs renders both now.",
  ],
  [
    "Does this change the claim?",
    "THE LOOP, which PASS-4-BRIEF says the architecture cannot run: " +
      "\"Scout fills a plan's gaps; it cannot change the plan's mind.\" The " +
      "board reports coverage against the beats a run was given, and this " +
      "is the one question it could never ask \u2014 whether what was found " +
      "argues for a different claim than the one the plan was written " +
      "with. No prototype draws it, because no prototype has the object.\n\n" +
      "A question rather than a verdict, and on demand, because the honest " +
      "answer is usually no and a control that only speaks when it " +
      "disagrees is one people learn to dread. It renders only where " +
      "something has been VERIFIED: a paraphrase may not have been said " +
      "and a rejection is a fabrication, and neither is a reason to change " +
      "what a video argues.",
  ],
  [
    "Other ways to build this",
    "THE THIRD ANSWER AT THE ONE STOP, which the prototype has no control " +
      "for because it has no object for one.\n\n" +
      "The plan flow stops to ask whether the beats are right, and the only " +
      "two answers it could take were yes and edit-the-beats. The third \u2014 " +
      "\"this is the wrong video, and here is a better one from the same " +
      "material\" \u2014 needs a representation of A VIDEO THAT COULD BE MADE, " +
      "and docs/research/PASS-4-BRIEF.md records that the product has none: " +
      "\"no way to have several, compare them, or rank them\". The word " +
      "survives in docs/design/ only, which is marked superseded, so angles " +
      "fell out of the product rather than being argued away.\n\n" +
      "src/angles.ts is the object. The control is deliberately quiet and " +
      "deliberately on demand \u2014 a slate costs three plans' worth of " +
      "direction plus retrieval per beat, and nobody should pay that for a " +
      "page they already agreed with.",
  ],
  [
    "Bring the footage in",
    "THE IMPORT CONTROL, which the Settings design has no equivalent for " +
      "because in the design there is nothing to press: it says a bucket on " +
      "the same Cloudflare account binds directly and that Neolog's " +
      "transcripts come across with it. Neither is true here (see the " +
      "sign-off for the paragraph above this one), so footage is listed " +
      "when you connect and READ when you ask \u2014 which needs a button, " +
      "and a button needs words.\n\n" +
      "It had never been checked by anything either. `strings` only renders " +
      "what an account HAS, and no account on any machine that runs the " +
      "gate has a connected bucket, so the whole connected state of this " +
      "page \u2014 the bucket row, its import date and this control \u2014 was " +
      "invisible to every check until `copy` rendered it from a fixture.",
  ],
  [
    "Receipts for viewers &nearr;",
    "Doc 09's receipts page: \"the edit you can interrogate is a promise to " +
      "the audience, not just the maker\". The prototype has no Before you " +
      "post step and no public surface at all, so there was nothing to " +
      "match.\n\n" +
      "\"for viewers\" is doing the work in that phrase. The other four " +
      "links in this panel give the reader a document; this one gives " +
      "somebody else a page, and that difference has to land before the " +
      "press, not after it.",
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

/**
 * EVERY PIECE OF UI COPY IN ONE DOCUMENT, CHECKED AGAINST THE DESIGNS.
 *
 * Lifted out of checkStrings so that a page which is a pure function can
 * be checked with no server: same extraction, same haystack, same
 * sign-off list. `label` is what a finding is reported against — a route
 * for the crawl, a function name for the offline pass.
 *
 * `seen` is shared across documents by the caller, so a string that
 * appears on six surfaces is reported once.
 */
function scanCopy(html, label, seen, suspect) {
  const body = html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<title>[\s\S]*?<\/title>/g, ' ');
/*
 * AFTER A CLOSING TAG TOO, and that was a hole.
 *
 * This matched text only where it followed an OPENING tag, so a sentence
 * after </em> or </span> was invisible to this rule anywhere in the product.
 * Eight strings were getting through when it was found — seven of them on the
 * signed-out page, which is the most-read surface there is, and all seven
 * sentence-halves after an emphasis tag.
 *
 * A closing tag has no attributes, so `data-content` cannot exempt text that
 * follows one — which is right: the data is INSIDE the marked element, and
 * what comes after it is copy somebody wrote.
 */
for (const m of body.matchAll(/<(?:([a-z]+)([^>]*)|\/[a-z]+)>([^<>]+)(?=<)/g)) {
  if (m[2] && /\bdata-content\b/.test(m[2])) continue;
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
    suspect.push(`${label}  "${text}"`);
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
  suspect.push(`${label}  "${text}"`);
  }
}

async function checkStrings() {
  const BASE = process.env.BASE || 'http://localhost:8787';
  /*
   * '/landing' as well as '/'.
   *
   * `/` is the landing site when signed out and Home when signed in — and the
   * dev server this check talks to has DEV_LOGIN_EMAIL set, so it is ALWAYS
   * signed in and `/` is always Home. The landing page has therefore never
   * once been string-checked, and a whole section could be added to it without
   * this noticing. It has its own prototype (design/Landing.dc.html) and the
   * check already reads it; only the route was missing.
   */
  /*
   * THE SURFACES, DERIVED. See scripts/surfaces.cjs.
   *
   * This was nine route literals — and '/projects' and '/clipping' among them,
   * both of which are redirects, so two of the nine checked the same page
   * twice under a URL nobody uses. Between that list and walk.cjs's six, TEN
   * surfaces had never been crawled by anything: Words, Shorts, five of
   * Footage's seven tabs, /eval, /plan/:id, /r/:token, the Scout board, /home
   * and /sources/:id. Every defect the prototype comparison found this month
   * was on a page one of those lists had simply never mentioned.
   *
   * A hand-kept list goes stale the first time somebody adds a route and does
   * not think of it, so the list is now read out of src/index.ts.
   */
  const SURFACES = require('./surfaces.cjs');

  let up = false;
  try {
    const r = await fetch(BASE + '/api/health');
    up = r.ok;
  } catch { up = false; }
  if (!up) {
    skipped('strings', `no dev server at ${BASE}. Run \`npx wrangler dev --local --port 8787 --enable-containers=false\` and re-run`);
    return;
  }

  /*
   * TEXT THAT PROMISES A CLICK MUST BE ON SOMETHING CLICKABLE.
   *
   * "out · rule 02 · click to keep" shipped on a plain div — a sentence on
   * screen telling somebody to do something that did nothing. The second of
   * these in two commits, after six MAKE cards linking to a query nobody
   * read, and neither was caught: the strings were the prototype's own, the
   * colours were tokens, and nothing anywhere asked whether a promise was
   * kept.
   *
   * Checked on the RENDERED page rather than in the source, which is the
   * mistake the first version of this rule made: it scanned src/ui and the
   * promise is assembled in index.ts, so it found nothing and passed the very
   * bug it was written for. What matters is what reaches the browser.
   *
   * A promise is kept when the text sits inside a button or a link. That is
   * deliberately narrow — those are the two things a person can press — and
   * it cannot be satisfied by rewording, because the words come from the
   * prototype and the strings check holds them there.
   */
  const promises = [];
  const scanPromises = async (list) => {
  for (const route of list) {
    let html = '';
    try {
      html = await (await fetch(BASE + route)).text();
    } catch {
      continue;
    }
    for (const m of html.matchAll(/click to \w+/g)) {
      const before = html.slice(0, m.index);
      const openBtn = Math.max(before.lastIndexOf('<button'), before.lastIndexOf('<a '));
      const closeBtn = Math.max(before.lastIndexOf('</button>'), before.lastIndexOf('</a>'));
      if (openBtn < 0 || closeBtn > openBtn) {
        promises.push(route + ': "' + m[0] + '" — promised on something nothing can press');
      }
    }
  }
  };


  const suspect = [];
  const seen = new Set();

  /*
   * The editor and a read source only exist once there is data, so their
   * routes are discovered rather than hardcoded. Leaving them out would put a
   * blind spot over the surfaces with the most copy on them.
   */
  const inventory = await SURFACES.expand({
    base: BASE,
    fetchJson: async (u) => (await fetch(u)).json(),
  });
  const routes = inventory.urls;

  /*
   * EVERY SURFACE REACHED, OR SAID TO BE OUT OF REACH AND WHY.
   *
   * The point of deriving the list is that a page cannot go missing from it
   * silently. So a declared surface with no URL to visit is a FINDING unless
   * surfaces.cjs says why — and the two that say why are both genuine:
   * /auth/callback needs a one-time token and visiting it spends somebody's
   * link, and /r/:token needs a published receipt token, which exists only
   * once a person has published one and is deliberately not listed anywhere.
   */
  const REACH_OK = new Set([
    'needs a one-time sign-in token, and visiting it spends one',
    'a receipt page needs a published token; pass receiptToken to include it',
  ]);
  for (const sf of inventory.surfaces) {
    if (sf.urls.length) continue;
    if (sf.why && REACH_OK.has(sf.why)) continue;
    suspect.push(
      'coverage: ' + sf.route + ' renders a page and the crawl could not reach it' +
        (sf.why ? ' — ' + sf.why : ''),
    );
  }

  /*
   * AND NO PAGE AT A MACHINE URL. This is where the Scout board (510 lines,
   * never once rendered by a check) and the receipts admin page both hid: the
   * crawl skips /api/ because everything else under it answers with JSON, so a
   * page there has no checks on it at all. Both moved to /p/:id/... on 28 Oct;
   * this is what stops the next one.
   */
  for (const route of inventory.htmlUnderApi) {
    suspect.push('page-url: ' + route + ' returns a document from an /api/ path, where no crawl reaches it');
  }

  /*
   * AND NO ROUTE A CATCH-ALL HAS ALREADY SWALLOWED.
   *
   * Hono matches in registration order. `/p/:id/:stagePath` matches
   * `/p/<id>/receipts` too and answers notFound for anything not in
   * EDITOR_PATHS, so a literal sibling registered after it 404s on every
   * request — and the route looks completely correct where it is written.
   *
   * Twice in one week: the receipts admin page and the Before you post sheet.
   * /p/:id/scout escaped only by being declared further up the file, which is
   * not a thing to rely on.
   */
  for (const sh of inventory.shadowed) {
    suspect.push(`shadowed: ${sh.route} is registered after ${sh.by}, which already matches it — it will 404`);
  }

  /*
   * READING THE USER BEFORE THE TABLES EXIST.
   *
   * On a database with no schema, every page in the product answered 200 and
   * `/` answered 500 — the front door, and the first URL anybody visits,
   * including on a fresh deployment. It was the one route that had to read
   * the database to decide WHICH handler to call, so it queried before
   * anything had run ensureV2Schema.
   *
   * It cannot be found on a machine that has ever run the app once, which is
   * every machine this was written on. CI found it on a clean runner, at the
   * cost of a whole red run, and a convention that every caller remembers is
   * what let it happen. So it is a rule now.
   *
   * ensureV2Schema is memoised, so the fix is free everywhere it is applied.
   */
  const idx = fs.readFileSync(path.join(ROOT, 'src/index.ts'), 'utf8').split('\n');
  const OPENS = /^(app\.(?:get|post|put|patch|delete|all|on|use)\(|const \w+\s*=\s*async|async function |function )/;
  idx.forEach((line, i) => {
    if (!/\bcurrentUser\(/.test(line)) return;
    let open = i;
    while (open > 0 && !OPENS.test(idx[open])) open -= 1;
    const before = idx.slice(open, i).join('\n');
    if (/ensureV2Schema\(/.test(before)) return;
    suspect.push(
      `cold start: src/index.ts:${i + 1} reads currentUser before ensureV2Schema — ` +
        `on a database with no tables this 500s instead of answering`,
    );
  });

  /*
   * NO SIGNED-OUT PASS, AND IT WOULD PROVE NOTHING HERE.
   *
   * The dev server needs DEV_LOGIN_EMAIL or every page is a 302, and
   * currentUser returns that user whatever cookie it is sent — so clearing
   * the cookie locally does not produce a signed-out visitor, it produces the
   * same signed-in one. What a stranger actually sees is `/landing`, which is
   * the branch homeHandler takes when there is no visitor, and that is in the
   * list above and checked like everything else.
   */

  await scanPromises(routes);

  for (const route of routes) {
    const html = await (await fetch(BASE + route)).text();
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
    scanCopy(html, route, seen, suspect);
  }

  if (suspect.length) {
    fail('strings', 'Rendered text not found in the prototype. Either a paraphrase (fix it) or new behaviour (flag it and get sign-off).', suspect.concat(promises).join('\n'));
  } else if (promises.length) {
    fail('strings', 'A promise on screen that nothing can keep. Make it pressable or stop saying it.', promises.join('\n'));
  } else {
    const used = [...SIGNED_OFF.keys()].filter((k) => seen.has(k));
    pass(
      'strings',
      `${seen.size} rendered strings across ${routes.length} surfaces, all verbatim from the prototype, every promised click pressable` +
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

    /*
     * A SCORE ON SCREEN. Invariant 3.
     *
     *   "Reasons, not scores. No percentage reaches a user. Strong / Worth
     *    a look / Long shot, with the line that caused it."
     *
     * The editor rendered a bare 70 in a green badge on every judged block
     * for as long as blocks have had scores, with an invariant forbidding
     * it in CLAUDE.md the whole time. Prose does not stop the next one.
     *
     * Interpolating a score into markup is the mechanical shape of it:
     * `${b.score}` inside a template. Reading one to DECIDE something —
     * gradeForScore, a sort, a filter — is not, which is why this looks for
     * the interpolation and not the word.
     */
    /*
     * THE EXPRESSION ITSELF MUST BE THE SCORE, not merely contain one.
     *
     * The first version matched any interpolation with "score" in it and
     * flagged `${b.score != null ? ... : "none"}` — a score deciding a
     * border, which is reading it rather than printing it. gradeForScore
     * and a sort would have gone the same way. So this is a bare member
     * expression: `${b.score}`, `${s?.score}`, `${m.score ?? 0}`. Anything
     * with a call, a comparison or a ternary in it is a decision.
     */
    for (const m of src.matchAll(/\$\{\s*[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*\.score\s*(?:\?\?\s*\d+\s*)?\}/g)) {
      bad.push(
        rel(file) + ': ' + m[0] + ' puts a score on screen — invariant 3 wants Strong / Worth a look / Long shot',
      );
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
  else pass('conventions', 'no native players, empty grid tracks, scores on screen or permanently disabled controls');
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

  /*
   * 1. AN API ROUTE NOTHING CAN REACH.
   *
   * THE HAYSTACK DOES NOT INCLUDE src/index.ts, which is where the routes are
   * DECLARED. `server` is everything under src/ outside ui/, index.ts among
   * it, so until this line every route matched its own `app.get("…")` and the
   * rule had never once fired. The MAKE cards it is credited with catching
   * were caught by the query-parameter rule below, which is a different
   * check. Three Scout routes were added with nothing calling any of them and
   * it passed.
   *
   * WHAT THIS RULE CANNOT SEE. The haystack is file TEXT, so a path literal
   * sitting in a function nobody calls satisfies it — delete a button's call
   * site but leave the function that renders it, and the route still reads as
   * reachable. That is the `wired` rule's shape of problem, and `wired` only
   * sees exports. Said out loud rather than implied away, because a check
   * that is believed to guarantee more than it does is how this one went a
   * year without firing.
   *
   * MATCHED ON THE LAST LITERAL SEGMENT, not the whole path, because the
   * client builds these by concatenation — `"/api/" + kind + "/" + id +
   * "/restore"` — so no pattern over the whole route can match a real call.
   * The tail is weak on its own and strong enough once the declarations are
   * out of the haystack, which is what this rule was always supposed to be.
   */
  const ROUTE = /app\.(?:get|post|put|delete)\("(\/api\/[^"]+)"/g;
  /*
   * Called by something that is not this codebase: an uptime check, a
   * platform probe, a browser's own <img src>. Each is listed rather than
   * pattern-matched, because an exemption that can be earned by accident is
   * the hole this rule just spent a week having.
   */
  const CALLED_FROM_OUTSIDE = new Set([
    '/api/health',
    '/api/sources/:id/poster',
  ]);
  /*
   * Reached by a caller that builds the LAST segment, so the tail never
   * appears as a literal: `fetch("/api/billing/" + mode)`. Each carries the
   * literal that must be present, so the exemption still checks something —
   * delete the caller and `/api/billing/` goes with it and the rule fires.
   */
  const BUILT_BY_CONCATENATION = {
    '/api/billing/portal': '/api/billing/',
    '/api/billing/checkout': '/api/billing/',
  };
  /*
   * ROUTES THAT SHIPPED WITH NO CALLER, found on 18 Oct 2026 the moment this
   * rule was fixed and could fire for the first time. Both are from flows the
   * plan flow replaced. They are listed rather than silently exempted so they
   * stay visible on every run, and the rule still fails for anything NEW —
   * which is the whole point of writing them down instead of widening the
   * check. Wire them or take them out; a list like this earns its keep only
   * by getting shorter.
   */
  /*
   * EMPTY, AND IT IS MEANT TO STAY THAT WAY.
   *
   * It held /api/projects/:id/outline and /api/projects/:id/reactions, both
   * surfaced on 21 Oct 2026 when this rule stopped accepting a comment as a
   * caller. Neither was ever reachable, and both were deleted on 28 Oct: they
   * were second doors to work `begin()` already dispatches from the composer,
   * so the capabilities stayed and the routes went.
   *
   * A list like this earns its keep only by getting shorter. Adding to it is
   * how a route nothing asks for becomes permanent furniture, so an entry
   * needs a reason written beside it saying what will make it reachable.
   */
  const KNOWN_DEAD = [];
  const callers = server
    .split('\n')
    .filter((line) => !/app\.(?:get|post|put|delete)\("\/api\//.test(line))
    .join('\n');
  /*
   * AN IMPORT PATH IS NOT A CALLER.
   *
   * The tail test below asks whether '/<last segment>' appears anywhere, and a
   * relative module specifier contains exactly that: `/api/projects/:id/cuesheet`
   * was satisfied by `from "./cuesheet.ts"` in the same file that declared the
   * route. So a route implemented in a module named after it reached this check
   * already reachable, and the one thing it had to notice — a route nothing
   * asks for — it could not notice at all. The sibling bug in this same rule
   * (a haystack that included the file being checked) is in CLAUDE.md under
   * "Things that bite"; this is the same mistake one layer down.
   *
   * Module paths are stripped rather than the whole import line, so an import
   * that happens to sit beside a real fetch is not thrown away with it.
   */
  const MODULE_PATH = /\bfrom\s+["'][.~/]|^\s*import\s+["'][.~/]/;
  /*
   * NOR IS A COMMENT A CALLER, and this is the half that had real teeth.
   *
   * `server` is every file under src/, so the haystack contained the prose of
   * the whole codebase. Any comment mentioning a path — "see src/cuesheet.ts",
   * "src/reactions.ts does this" — contains '/<tail>' and marked that route
   * reachable. A route was therefore reachable if anyone had ever written its
   * module name down, which is nearly the opposite of what this rule claims.
   *
   * Line comments are only stripped where '//' does not follow a colon, quote
   * or backslash, so a URL in a real fetch survives.
   */
  const stripComments = (src) =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .split('\n')
      .map((line) => line.replace(/(^|[^:"'`\\])\/\/.*$/, '$1'))
      .join('\n');
  const asksForThings = (src) =>
    stripComments(src)
      .split('\n')
      .filter((line) => !MODULE_PATH.test(line))
      .join('\n');
  /*
   * A SCRIPT IN THIS REPO IS A CALLER.
   *
   * The rule asks whether anything can reach a route. scripts/ is how the
   * owner reaches several — the eval runner scores models through
   * /api/eval/score, and there is no screen for that and should not be. A
   * route called only by a script is reachable by the person who runs it,
   * which is the question being asked; counting it as dead would push
   * somebody to build a page nobody wants so a check goes green.
   *
   * It does not weaken the rule for the routes it was written for: a UI
   * route still needs a caller, and if the only caller is a script then a
   * script is genuinely what reaches it.
   */
  const runners = walkAny(path.join(ROOT, 'scripts'), [])
    .filter((f) => /\.(c?js|ts)$/.test(f))
    /*
     * NOT THIS FILE. It holds KNOWN_DEAD, which is a list of route literals —
     * so including it made the gate's own record of dead routes mark them
     * alive, and the "still unreachable and known" line vanished on the first
     * run. CLAUDE.md has the general form under "Things that bite": a
     * fidelity rule whose haystack includes the file it is checking is a rule
     * that matches its own declarations. Third time this session.
     */
    .filter((f) => !f.endsWith('check-fidelity.cjs'))
    .map((f) => fs.readFileSync(f, 'utf8'))
    .join('\n');

  const haystack =
    asksForThings(client) + '\n' + asksForThings(pages) + '\n' + asksForThings(callers) + '\n' + asksForThings(runners);

  const deadStill = [];
  for (const m of index.matchAll(ROUTE)) {
    const route = m[1];
    if (CALLED_FROM_OUTSIDE.has(route)) continue;

    const literal = BUILT_BY_CONCATENATION[route];
    if (literal) {
      if (!haystack.includes(literal)) {
        problems.push('route ' + route + ' — its caller built "' + literal + '" and that is gone now');
      }
      continue;
    }

    const parts = route.split('/').filter((seg) => seg && !seg.startsWith(':') && seg !== '*' && seg !== 'api');
    if (!parts.length) continue;
    const tail = parts[parts.length - 1];
    if (haystack.includes('/' + tail)) continue;

    if (KNOWN_DEAD.includes(route)) {
      deadStill.push(route);
      continue;
    }
    problems.push('route ' + route + ' — nothing anywhere asks for it');
  }
  /* Named on every run, so the list cannot quietly become furniture. */
  if (deadStill.length) {
    console.log('  … ' + deadStill.length + ' route(s) still unreachable and known: ' + deadStill.join(', '));
  }

  /* 2. A table written and never read. This is the passes log exactly: every
        pass has written a row since the feature shipped, its own comment says
        "shown as the Passes log", and the only other statement about it in
        the codebase was a DELETE. */
  /* READ WHAT ACTUALLY RUNS. This read migrations/0006_v2_core.sql, which
     src/schema.ts's own header calls "a checked-in mirror ... kept for
     readability; THESE are what actually run". Nine Scout tables added to
     schema.ts were therefore invisible to this rule, and so would any table
     added the way every table in this repo is added. */
  const schema = walk(path.join(ROOT, 'src')).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const all = fs.readFileSync(path.join(ROOT, 'src/index.ts'), 'utf8') + '\n' + server + '\n' + pages;
  for (const m of schema.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)) {
    const table = m[1];
    const written = new RegExp('(INSERT INTO|UPDATE)\\s+' + table + '\\b', 'i').test(all);
    const read = new RegExp('FROM\\s+' + table + '\\b', 'i').test(all.replace(new RegExp('DELETE FROM\\s+' + table + '\\b', 'gi'), ''));
    if (written && !read) problems.push('table ' + table + ' — written, and nothing ever reads it back');
  }

  /*
   * A LINK TO A QUERY NOBODY READS IS A DEAD CONTROL.
   *
   * Six MAKE cards shipped as <a href="/?make=cut">. The server never reads
   * `make`, so pressing one reloaded the page unchanged — and every other
   * check passed it: the strings were real, the colours were tokens, and
   * `wiring` only looks at classes the client binds, which a plain link has
   * no business having. A control that looks like it does something and does
   * nothing is the exact failure this file exists for, and it walked straight
   * through.
   *
   * So: every query parameter a page LINKS to must be one the server asks
   * for. Cheap, total, and it cannot be satisfied by anything but wiring the
   * parameter up or taking the link out.
   */
  const asked = new Set([...all.matchAll(/\.query\(\s*["'`](\w+)["'`]/g)].map((m) => m[1]));
  const linked = new Map();
  for (const m of pages.matchAll(/href="[^"]*\?([^"]+)"/g)) {
    for (const pair of m[1].split('&')) {
      const key = pair.split('=')[0].replace(/^\$\{[^}]*\}/, '').trim();
      /* Skip an interpolated key — it is computed and cannot be read here. */
      if (/^\w+$/.test(key) && !asked.has(key)) linked.set(key, m[0].slice(0, 60));
    }
  }
  for (const [key, where] of linked) {
    problems.push('link ?' + key + '= — nothing on the server reads it (' + where + '…)');
  }

  /*
   * NOTHING FETCHES VIDEO FROM A PLATFORM THAT FORBIDS IT.
   *
   * Invariant 9, and Scout v0's first acceptance test: "No code path fetches
   * audiovisual content from YouTube or Twitch (a test greps for media-fetch
   * calls on those adapters)."
   *
   * WRITTEN BEFORE THE ADAPTERS, which is the whole point. The rule is easy
   * to hold while nobody has tried, and the moment somebody is three hours
   * into a YouTube adapter and wants one video file for one test, it is a
   * judgement call made alone at the wrong time. A check that already exists
   * is not a judgement call. It also outlives whoever writes the adapter,
   * which a comment does not.
   *
   * It looks for a FETCH whose URL names one of those hosts' media. Searching
   * for the host alone would fire on every honest thing Scout does — storing
   * an id, writing a watch link, reading an RSS feed — and a check that fires
   * on correct code gets switched off.
   */
  const MEDIA_HOSTS = [
    'googlevideo\\.com',
    'ytimg\\.com/vi/[^"\']*\\.mp4',
    'youtube\\.com/get_video',
    'youtube\\.com/watch\\?[^"\']*&?format=',
    'ttvnw\\.net',
    'twitch\\.tv/[^"\']*\\.m3u8',
    'cloudfront\\.net/[^"\']*twitch',
    'yt-dlp',
    'youtube-dl',
    'ytdl',
  ];
  const MEDIA = new RegExp('(' + MEDIA_HOSTS.join('|') + ')', 'i');
  for (const f of walk(path.join(ROOT, 'src'))) {
    const src = fs.readFileSync(f, 'utf8');
    /* Comments are where the rule gets EXPLAINED, so they are stripped — a
       paragraph naming yt-dlp to say we do not use it must not trip it. The
       line is blanked rather than removed so the number still points at the
       right line of the real file. */
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/^(\s*)\/\/.*$/gm, '$1');
    code.split('\n').forEach((line, i) => {
      if (MEDIA.test(line) && /fetch\(|axios|request\(|exec|spawn/.test(line)) {
        problems.push(
          path.relative(ROOT, f) + ':' + (i + 1) +
            ' — fetches audiovisual content from a platform that forbids it (invariant 9): ' +
            line.trim().slice(0, 70),
        );
      }
    });
  }

  if (problems.length) {
    fail(
      'reachable',
      'Something on the server has no way to reach a person, or reaches somewhere it may not. Wire it up, take it out, or stop fetching it.',
      problems.join('\n'),
    );
  } else {
    pass('reachable', 'every API route is asked for, every table written is read back, every linked query is read, nothing downloads footage it may not');
  }
}

/* ── 10. Schema document ───────────────────────────────────────────────────
 *
 * THE SCHEMA DOCUMENT HAD NOT BEEN TRUE FOR A LONG TIME.
 *
 * src/schema.ts's header calls migrations/ "a checked-in mirror of the
 * statements below, kept for readability; THESE are what actually run". When
 * this check was written the mirror disagreed with the running schema about
 * twelve tables and had never heard of thirteen more — and the table rule in
 * checkReachable was reading it, so it had been reporting on a schema that
 * stopped existing some time in the summer.
 *
 * A wrong schema document is worse than no schema document: it is the thing
 * somebody reads to find out what a column means, at exactly the moment they
 * have decided not to read the code.
 *
 * So migrations/schema.sql is GENERATED — `npm run schema` — and this check
 * fails if it has fallen behind. The numbered files beside it stay as
 * history; nothing here is deleted, and nothing reads them.
 *
 * Compared on whitespace-flattened statement text, so indentation and line
 * breaks are free and a renamed column is not.
 */
function checkSchema() {
  /* Block comments are stripped before anything else: they are not schema,
     and one of them contains a semicolon ("presigned URLs; \"worker\" = …"),
     which split that table in half when the document was read statement by
     statement and reported it as drift. */
  const nocomment = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const flat = (t) =>
    nocomment(t).replace(/\s+/g, ' ').replace(/\s*([(),])\s*/g, '$1').trim().toLowerCase();
  /* `(?:UNIQUE )?` on both sides, because without it a unique index is
     invisible to this check AND to scripts/schema-doc.cjs — blind in the
     same place on both sides, so the two agreed about a statement neither
     had seen. The first one in src/ is scout_missions_one_per_cut; it was
     written, generated nothing, and the gate stayed green. */
  const name = (t) => (t.match(/create (?:table|(?:unique )?index) if not exists (\w+)/i) || [])[1];

  const live = new Map();
  for (const f of walk(path.join(ROOT, 'src'))) {
    /*
     * EITHER QUOTE STYLE. The DDL in STATEMENTS is in backticks and the
     * entries in ADDED_INDEXES are in double quotes, because they are a
     * plain string array rather than a template — and this regex matched
     * only backticks, so the one index created after the ALTERs read as
     * "in the schema document and created by nothing". The check was right
     * to complain; it just could not see the creation.
     */
    const text = fs.readFileSync(f, 'utf8');
    /*
     * MATCHING DELIMITERS, via the backreference. Written first as
     * `[`"]...[`"]`, which let a statement open on a backtick and close on
     * the first double quote INSIDE it — so every multi-line DDL containing
     * a quoted default came back truncated and v2_users and rules read as
     * "the code and the document disagree about its shape". A widened
     * matcher that silently shortens what it matches is worse than the
     * narrow one it replaced.
     */
    const ddl = /([`"])(CREATE (?:TABLE|(?:UNIQUE )?INDEX) IF NOT EXISTS [\s\S]*?)\1/g;
    for (const m of text.matchAll(ddl)) {
      const n = name(m[2]);
      if (n) live.set(n, flat(m[2]));
    }
  }

  const doc = path.join(ROOT, 'migrations/schema.sql');
  const bad = [];
  if (!fs.existsSync(doc)) {
    bad.push('migrations/schema.sql is missing — run `npm run schema`');
  } else {
    const written = new Map();
    const sql = nocomment(fs.readFileSync(doc, 'utf8')).replace(/^\s*--.*$/gm, '');
    for (const stmt of sql.split(';')) {
      const n = name(stmt);
      if (n && !written.has(n)) written.set(n, flat(stmt));
    }
    for (const [n, stmt] of live) {
      if (!written.has(n)) bad.push(n + ' — runs, and the schema document has never heard of it');
      else if (written.get(n) !== stmt) bad.push(n + ' — the code and the schema document disagree about its shape');
    }
    /* And the other way: a table in the document that nothing creates is a
       table a reader will look for and not find. */
    for (const n of written.keys()) {
      if (!live.has(n)) bad.push(n + ' — in the schema document and created by nothing');
    }
  }

  /*
   * EVERY QUEUE CONSUMER HAS A DEAD-LETTER QUEUE.
   *
   * labs/OPERATIONS.md: "Queues delete on retry exhaustion unless a
   * dead-letter queue exists — that is exactly how '300 processed, 200
   * didn't' happens. Every consumer gets a DLQ." A consumer declared without
   * one throws away whatever it cannot process, and the job row goes on
   * saying "running" — invariant 7's silent partial failure, arriving through
   * a config file nobody thinks of as code.
   *
   * Read by regex rather than by parsing, for the reason
   * test/queue-retries.test.ts gives at length: this file contains a comment
   * opener inside a string ("globs": ["**\/*.woff2"]), so a comment stripper
   * swallows the rest of the file and a parser that handles it correctly is a
   * parser with its own bugs, in a check.
   *
   * A dead-letter queue is itself exempt, because a DLQ with a DLQ is turtles.
   * The rule is that the chain terminates, not that it never does.
   */
  const wranglerRaw = fs.readFileSync(path.join(ROOT, 'wrangler.jsonc'), 'utf8');
  const consumersBlock = wranglerRaw.match(/"consumers"\s*:\s*\[([\s\S]*?)\n\s*\]/);
  if (!consumersBlock) {
    bad.push('wrangler.jsonc declares no queue consumers — no job runs on the queue at all');
  } else {
    for (const m of consumersBlock[1].matchAll(/\{[^{}]*\}/g)) {
      const entry = m[0];
      const name = (entry.match(/"queue"\s*:\s*"([^"]+)"/) || [])[1];
      if (!name) {
        bad.push('a queue consumer in wrangler.jsonc names no queue');
        continue;
      }
      if (/-dlq$/.test(name)) continue;
      if (!/"dead_letter_queue"\s*:\s*"[^"]+"/.test(entry)) {
        bad.push(
          name + ' — a consumer with no dead_letter_queue: whatever it cannot process is deleted ' +
            'and the job row goes on saying "running"',
        );
      }
    }
  }

  /*
   * EVERY QUEUE NAMED IN wrangler.jsonc IS PROVISIONED BY THE DEPLOY.
   *
   * `wrangler deploy` fails outright on a queue that does not exist —
   * "Queue \"aldershot-jobs-dlq\" does not exist" — so adding a consumer to
   * that file is a deploy-breaking change unless the workflow creates it
   * first. That is exactly what happened the day the dead-letter queue
   * landed: the gate was green, the tests passed, and the next deploy died.
   *
   * D1 was already created-if-missing in deploy.yml and queues were not, so
   * nothing connected the two files. This is the connection.
   */
  /* COMMENTS STRIPPED FIRST. The comment explaining this rule names the
     dead-letter queue, so the rule was satisfied by its own explanation — a
     break that removed the queue from the provisioning list went uncaught. */
  const deploy = fs
    .readFileSync(path.join(ROOT, '.github/workflows/deploy.yml'), 'utf8')
    .replace(/^\s*#.*$/gm, '');
  const named = new Set();
  const wrangler = fs.readFileSync(path.join(ROOT, 'wrangler.jsonc'), 'utf8');
  for (const m of wrangler.matchAll(/"(?:queue|dead_letter_queue)"\s*:\s*"([^"]+)"/g)) named.add(m[1]);
  for (const q of named) {
    if (!deploy.includes(q)) {
      bad.push(
        q + ' — named in wrangler.jsonc and never created by .github/workflows/deploy.yml, ' +
          'so the next deploy fails on it',
      );
    }
  }

  if (bad.length) {
    fail('schema', 'The schema that runs and the schema a person reads have come apart. `npm run schema`.', bad.join('\n'));
  } else {
    pass('schema', live.size + ' tables and indexes mirrored in migrations/schema.sql; every queue has a dead-letter queue and a deploy that creates it');
  }
}

/**
 * CONTENT — the exemption from `strings` may only cover text the data wrote.
 *
 * `data-content` tells checkStrings to skip an element, because a transcript
 * line, a filename, a duration or a model's sentence cannot be in the
 * prototype and flagging it would make the rule unusable. It is an opt-out
 * from the strictest check in this file, and it spreads the way opt-outs do:
 * by being on the card somebody copies.
 *
 * MEASURED, NOT FEARED. It had reached 46 pieces of static copy — a quarter
 * of every marked element in src/ui. The Scout row was added to the front
 * door carrying it, and paraphrasing the row's heading to "Scout improves
 * your video" passed the gate green, which is the exact failure the strings
 * rule was written to make impossible. With the mark removed, 35 of the 46
 * were the prototype's own words all along and 11 needed sign-off.
 *
 * So: the mark is for INTERPOLATED text. An element whose text is a literal
 * is chrome, and chrome gets checked.
 */
/* The terminating `<` is a LOOKAHEAD for the same reason checkStrings makes
   it one: consuming it eats the next element's bracket, so the scan sees only
   every other element. */
const MARKED = /<([a-z]+)([^>]*\bdata-content\b[^>]*)>([^<>]*)(?=<)/g;

/**
 * Does this marked element's own text come from the source, rather than data?
 *
 * A wrapper whose children carry the text is fine — its own text node is
 * empty, and each child is checked on its own terms.
 */
const marksStatic = (text) =>
  text.trim().length >= 8 && !text.includes('${') && !text.includes('`');

function checkContent() {
  const rel = (f) => path.relative(ROOT, f);

  /*
   * ONE SCAN, used on the real files and on a fixture.
   *
   * The first version had a predicate with its own positive control beside a
   * loop that called it, and replacing the call with `continue` — so the rule
   * looked at 149 elements and decided nothing about any of them — left the
   * control green and the tally green and the gate passing. A control that
   * does not go through the same code as the real run proves nothing about
   * the real run.
   */
  const scan = (src, label) => {
    const out = [];
    let n = 0;
    for (const m of src.matchAll(MARKED)) {
      n += 1;
      if (!marksStatic(m[3])) continue;
      out.push(
        /* m.index, not m.start() — which is not a function, and which meant
           the first version of this rule crashed the gate the moment it
           found anything. It was written, run green, and only breaking it on
           purpose made it find something to report. */
        `${label}:${src.slice(0, m.index).split('\n').length} — data-content on static copy: ` +
          `"${m[3].trim().slice(0, 60)}"`,
      );
    }
    return { out, n };
  };

  /*
   * THE CONTROL: three marked elements whose verdicts are known. Static copy
   * is a finding; interpolated text is not; an empty wrapper is not.
   */
  const FIXTURE = '<div data-content style="x">A line of static copy here</div>' +
    '<span data-content>${esc(m.quote)}</span><span data-content></span>';
  const control = scan(FIXTURE, 'fixture');
  if (control.n !== 3 || control.out.length !== 1 || !control.out[0].includes('static copy here')) {
    fail(
      'content',
      'This rule cannot tell marked copy from marked data any more, so it is not checking anything.',
      `its own fixture gave ${control.n} element(s) and ${control.out.length} finding(s) — expected 3 and 1`,
    );
    return;
  }

  const bad = [];
  let seen = 0;
  for (const f of walk(path.join(ROOT, 'src/ui')).filter((x) => !x.endsWith('client.ts'))) {
    const { out, n } = scan(fs.readFileSync(f, 'utf8'), rel(f));
    bad.push(...out);
    seen += n;
  }

  if (bad.length) {
    fail(
      'content',
      'data-content exempts text from the strings rule. It is for text the data wrote; this is copy, and copy gets checked.',
      bad.join('\n'),
    );
  } else if (seen < 100) {
    /* src/ui carries about 150 of these. A matcher that found a handful
       found nothing, and would print the same green line as a clean run —
       which is how `reachable`'s route check never fired once. */
    fail('content', 'This rule found almost no marked elements, and src/ui has hundreds.', `matched ${seen} — the matcher is broken, not the code`);
  } else {
    pass('content', `${seen} data-content elements in src/ui, every one of them text the data wrote`);
  }
}

/**
 * A CAPABILITY THE PUBLIC PAGE SELLS MUST EXIST SOMEWHERE ELSE IN src/.
 *
 * `strings` compares the landing page against the DESIGN, so a feature the
 * design promises and the code has never had passes it twice over: the words
 * match, and nothing anywhere asks whether they are true. Two were shipping
 * when this rule was written, both in the pricing table and the FAQ —
 * "Review links and webhook handoff", and an answer explaining that every
 * finished piece POSTs to a webhook you set. The only webhook in the
 * codebase is Stripe's, inbound. "Recipes" — a saved rule set that starts
 * next week's video — is promised three times by the current design and
 * rules are project-scoped with no way to carry them anywhere.
 *
 * The test is deliberately crude, because a precise one is not possible: for
 * each noun below, if the landing page says it, something in src/ that is
 * NOT a signed-out page has to say it too. That catches a bullet point with
 * no implementation, which is the whole failure, and it says nothing about
 * whether the implementation is any good.
 *
 * The haystack excludes the pages being checked. A rule that reads the file
 * it is checking matches its own declarations — `reachable` did exactly that
 * and never fired once.
 */
function checkClaims() {
  /*
   * Capability nouns, not adjectives. Each one names a thing a stranger
   * would expect to be able to use after reading it, and each one is a word
   * the implementation would have to use somewhere if it existed.
   */
  const NOUNS = [
    /*
     * The noun as the page says it, and what counts as evidence it exists.
     *
     * The evidence defaults to the noun. It is spelled out where the word
     * alone is ambiguous: "webhook" passed this rule on its first run
     * because Stripe's INBOUND webhook uses it, while the thing being sold
     * is an outbound POST per finished piece, which would need somewhere to
     * keep the endpoint. A rule that green-lights a promise on an unrelated
     * use of the same word is the kind of check this repo keeps catching.
     */
    ['webhook', /webhook_url|webhook_endpoint|deliverWebhook/i],
    ['recipe'],
    ['review link'],
    /* The flag exists; nothing ever sets it. Evidence is a caller. */
    ['overnight queue', /overnight:\s*true/],
    ['storage add-on'],
    ['teleprompter'],
    /* 4K is genuinely plan-gated, which is what makes it a Studio line
       rather than a feature everybody already has. A bucket is not gated at
       all — it is implemented for every plan, so this rule passes it and the
       pricing table stops calling it a Studio feature. */
    ['4K render', /mp4_4k/],
    ['bucket you own', /presignFromBucket|importFromBucket/],
  ];

  /*
   * The signed-out page, and Settings — the other surface that tells
   * somebody what their money buys. Adding Settings here found the overnight
   * queue being sold to accounts that had already paid for it.
   */
  const PAGES = ['src/ui/pages/landing.ts', 'src/ui/pages/settings.ts'];
  /*
   * THE COPY, NOT THE COMMENTS.
   *
   * Explaining in a comment why a promise was REMOVED must not count as
   * making it: the first run of this rule reported webhooks, recipes and
   * storage add-ons against a page whose only remaining mention of all
   * three was the note saying they had been cut and why. Block comments,
   * HTML comments and //-lines go; a line with a URL in it stays, which is
   * why this does not just cut everything after a double slash.
   */
  const page = PAGES.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8'))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');

  /*
   * Everything in src/ EXCEPT the pages above, which is where an
   * implementation would have to live — and with the comments stripped,
   * because a note is not an implementation.
   *
   * "Overnight queue — it works while you sleep" passed this rule on its
   * first run, vouched for by src/ui/pages/editor-intake.ts explaining that
   * the overnight queue is NOT provisioned and that a button which looks
   * like it queues and does not is worse than no button. A comment saying a
   * thing does not exist is the worst possible evidence that it does.
   */
  const impl = walk(path.join(ROOT, 'src'))
    .filter((f) => !PAGES.some((p) => f.endsWith(p.replace('src/', ''))))
    .map((f) => fs.readFileSync(f, 'utf8'))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');

  const bad = [];
  let claimed = 0;
  for (const [noun, evidence] of NOUNS) {
    const re = new RegExp(noun.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i');
    if (!re.test(page)) continue;
    claimed += 1;
    if (!(evidence || re).test(impl)) {
      bad.push(
        `"${noun}" is sold on the signed-out page and nothing else in src/ mentions it — ` +
          'either build it or stop promising it',
      );
    }
  }

  if (bad.length) {
    fail(
      'claims',
      'The public page sells something the product does not have. The design saying it too is not a defence.',
      bad.join('\n'),
    );
  } else {
    pass('claims', `${claimed} of ${NOUNS.length} capability nouns claimed publicly, every one of them implemented`);
  }
}

/**
 * NO DEVELOPMENT NOTE REACHES A BROWSER.
 *
 * src/ui keeps 66 HTML comments inside its template literals and they are
 * worth keeping: each one sits beside the markup it explains. They are also
 * shipped, and anyone can press view-source. The signed-out page carried
 * one saying its most prominent button used to be a div that did nothing
 * when clicked.
 *
 * src/ui/shell.ts exports noDevNotes for exactly this, and the only way it
 * can be relied on is if every document goes through it. So: every template
 * literal in src/ that opens a document has to be the argument to a
 * noDevNotes call. Five of them do; a sixth written next week would not,
 * and this is what says so.
 *
 * It checks the call rather than the output because the output needs a
 * running server, and this has to hold on a machine with none.
 */
function checkNotes() {
  const bad = [];
  let seen = 0;

  for (const f of walkAny(path.join(ROOT, 'src'), [])) {
    if (!f.endsWith('.ts')) continue;
    const src = fs.readFileSync(f, 'utf8');
    /* The backtick plus doctype is what opens a document, however the
       statement around it is written — a return, a const, an argument. */
    for (const m of src.matchAll(/`<!doctype html>/gi)) {
      seen += 1;
      const before = src.slice(Math.max(0, m.index - 40), m.index);
      if (!/noDevNotes\(\s*$/.test(before)) {
        bad.push(
          `${path.relative(ROOT, f)}:${src.slice(0, m.index).split('\n').length} — ` +
            'a document that does not go through noDevNotes, so its HTML comments ship',
        );
      }
    }
  }

  if (!seen) {
    fail('notes', 'This rule found no documents at all, and src/ renders five.', 'the matcher is broken, not the code');
    return;
  }
  if (bad.length) {
    fail('notes', 'An HTML comment in a template literal is a note to the next reader of the code, not to the public.', bad.join('\n'));
  } else {
    pass('notes', `${seen} documents rendered, every one of them stripped of development notes`);
  }
}

/**
 * THE COPY ON EVERY PAGE THAT NEEDS NO SERVER.
 *
 * `strings` crawls a running app, so it skips — correctly — on a machine
 * without one, and on that machine nothing checked copy at all. The landing
 * site is a pure function of four fields. It could always have been checked
 * here, and twice it was not: copy was written, pushed with "strings is left
 * to CI", and CI found four strings that a single local run would have.
 *
 * Same extraction, same haystack, same sign-off list as the crawl — they
 * share scanCopy. This rule covers four documents; `strings` still covers
 * the thirty-odd that need data behind them.
 */
function checkCopy() {
  const r = spawnSync('node', ['--experimental-strip-types', 'scripts/render-pages.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (r.status !== 0) {
    fail('copy', 'The pages that need no server could not be rendered at all.', (r.stderr || '').trim().split('\n').slice(0, 10).join('\n'));
    return;
  }

  let pages;
  try {
    pages = JSON.parse(r.stdout);
  } catch {
    fail('copy', 'scripts/render-pages.mjs printed something that is not the page list.', r.stdout.slice(0, 300));
    return;
  }
  if (!Array.isArray(pages) || pages.length < 3) {
    fail('copy', 'This rule found almost no pages, and four are serverless.', `read ${Array.isArray(pages) ? pages.length : 0}`);
    return;
  }

  /*
   * The renderer counts its own pages.
   *
   * This rule used to count `label:` in render-pages.mjs and compare — which
   * was wrong twice, because the fixtures in that file carry labels of their
   * own. scripts/render-pages.mjs declares an EXPECTED count and exits
   * non-zero when it does not match, so a page that was never added or one
   * that threw is a failure above, with its own message, rather than a
   * quietly shorter list here.
   */

  const seen = new Set();
  const suspect = [];
  for (const p of pages) scanCopy(p.html, p.label, seen, suspect);

  if (!seen.size) {
    fail('copy', 'No copy was extracted from any page, so this rule decided nothing.', 'the matcher is broken, not the pages');
    return;
  }
  if (suspect.length) {
    fail(
      'copy',
      'Copy on a signed-out page that is in none of the designs. Either a paraphrase (fix it) or new behaviour (flag it in SIGNED_OFF with the reason).',
      suspect.join('\n'),
    );
  } else {
    pass('copy', `${seen.size} strings across ${pages.length} serverless pages, every one of them a design's own`);
  }
}

/**
 * ONE CONSTRUCTION OF WHAT A RECEIPT CONTAINS.
 *
 * A published receipt has two readers — the page a stranger reads and the JSON
 * a machine reads — and the only reason the second one is safe is that it is
 * the SAME OBJECT as the first. `receiptsPage` decides what a receipt contains;
 * `publishedReceipt` is the only thing that calls it; both routes render what
 * that returns.
 *
 * The way this breaks is not somebody printing a score on a public page. It is
 * somebody adding a second builder for the machine reader — a slightly wider
 * SELECT, "since a machine can handle the raw rows" — and the two drifting
 * until the data says more than the page. That has a name in this repo: the
 * cut that is stored as an outcome instead of re-produced. Same mistake,
 * different table.
 *
 * So the rule is structural and blunt: exactly one call site, and both routes
 * hand the builder's own value out without reshaping it.
 */
function checkReceiptJson() {
  const src = walk(path.join(ROOT, 'src'))
    .map((f) => [f, fs.readFileSync(f, 'utf8')])
    /* Comments stripped, for the reason `claims` learned the hard way: a note
       describing a construction is not a construction. */
    .map(([f, t]) => [
      f,
      t
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .split('\n')
        .filter((l) => !/^\s*\/\//.test(l))
        .join('\n'),
    ]);

  const bad = [];

  const builders = src.filter(([, t]) => /\breceiptsPage\s*\(/.test(t)).map(([f]) => path.relative(ROOT, f));
  if (builders.length !== 1 || !builders[0].endsWith('receipts.ts')) {
    bad.push(
      `receiptsPage() is called in ${builders.length} file(s) (${builders.join(', ') || 'none'}) — ` +
        'it must be called in src/receipts.ts and nowhere else, or two readers can be served ' +
        'two different ideas of what a receipt contains',
    );
  }

  const index = (src.find(([f]) => f.endsWith(path.join('src', 'index.ts'))) || [, ''])[1];

  /* Both routes, and both reading the one builder. */
  const json = index.match(/app\.get\("\/r\/:file\{[^"]*\}",[\s\S]*?\n\}\);/);
  const html = index.match(/app\.get\("\/r\/:token",[\s\S]*?\n\}\);/);
  if (!json) bad.push('no .json receipts route in src/index.ts — the machine-readable receipt is gone');
  if (!html) bad.push('no /r/:token receipts page route in src/index.ts');

  for (const [name, body] of [
    ['the .json route', json && json[0]],
    ['the page route', html && html[0]],
  ]) {
    if (!body) continue;
    if (!/\bpublishedReceipt\s*\(/.test(body)) {
      bad.push(`${name} does not call publishedReceipt — it is building a receipt of its own`);
    }
    /* It must hand that value out whole. A key from the receipt's own shape
       appearing inside the handler means it was taken apart and reassembled. */
    const reshaped = /\b(receipts|pictures|checked)\s*:/.exec(body);
    if (reshaped) {
      bad.push(
        `${name} mentions "${reshaped[1]}:" — it is reshaping the receipt instead of serving it, ` +
          'which is how the page and the data start to disagree',
      );
    }
  }

  if (bad.length) {
    fail(
      'receipt-json',
      'The receipt a machine reads and the receipt a person reads must be the same object.',
      bad.join('\n'),
    );
  } else {
    pass('receipt-json', 'one receipt builder, two renderings of it, neither reshaping the other');
  }
}

/**
 * EVERY PUBLISHED REFUSAL IS ENFORCED BY SOMETHING THAT RUNS.
 *
 * /.well-known/aldershot.json says what this product will not do. A list of
 * refusals nobody checks is marketing, and marketing in a document called
 * "refuses" is worse than silence: it claims a spine the product does not
 * have, to a reader who has no way to tell.
 *
 * So each refusal in src/refusals.ts names an anchor — a file and a string
 * that must appear in it — and that string has to be a FAILURE MESSAGE or a
 * TEST NAME. Both of those are code that runs. The haystack has its comments
 * stripped, because `claims` passed on its first run vouched for by a comment
 * explaining that the feature did not exist, and this rule would fail exactly
 * the same way: every invariant in this repository is described in prose
 * somewhere, so a rule that accepted prose would accept all ten and check none.
 *
 * It also refuses to be satisfied by src/refusals.ts itself. A rule whose
 * haystack includes the file it is checking matches its own declarations —
 * `reachable`'s route check did precisely that and never fired once.
 */
function checkRefusals() {
  const r = spawnSync('node', ['--experimental-strip-types', 'scripts/refusals.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    return fail('refusals', 'The refusals could not be read at all.', (r.stderr || '').trim().split('\n').slice(0, 8).join('\n'));
  }

  let data;
  try {
    data = JSON.parse(r.stdout);
  } catch {
    return fail('refusals', 'scripts/refusals.mjs said something that is not JSON.', r.stdout.slice(-300));
  }

  const bad = [];
  const { refusals, document: doc } = data;

  if (!refusals.length) bad.push('there are no refusals at all — the document would be an empty boast');

  /* Comments out, and the declaring file out, for the two reasons above. */
  const strip = (t) =>
    t
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|#)/.test(l))
      .join('\n');

  const seen = new Set();
  for (const ref of refusals) {
    if (seen.has(ref.id)) bad.push(`two refusals share the id "${ref.id}"`);
    seen.add(ref.id);

    const { file, find } = ref.anchor || {};
    if (!file || !find) {
      bad.push(`"${ref.id}" names nothing that enforces it`);
      continue;
    }
    if (/^src[\\/]refusals\.ts$/.test(file)) {
      bad.push(`"${ref.id}" is vouched for by the file that declares it, which proves nothing`);
      continue;
    }

    const full = path.join(ROOT, file);
    if (!fs.existsSync(full)) {
      bad.push(`"${ref.id}" points at ${file}, which does not exist`);
      continue;
    }
    if (!strip(fs.readFileSync(full, 'utf8')).includes(find)) {
      bad.push(
        `"${ref.id}" claims ${file} enforces it, and that file has no such code — ` +
          `looked for ${JSON.stringify(find.slice(0, 60))}. A comment describing the rule does not count.`,
      );
    }

    /* The published line must actually be about the refusal: a sentence that
       says what the product DOES is a feature, not a refusal. */
    if (!/\bnever\b|\bno\b|\bnot\b|\bnothing\b|\brefus/i.test(ref.says)) {
      bad.push(`"${ref.id}" does not read as a refusal: ${JSON.stringify(ref.says.slice(0, 60))}`);
    }
  }

  /* And the anchors must not reach the reader. They are paths inside a
     private repository: no use to anyone outside, and structure given away
     for nothing. */
  if (JSON.stringify(doc).includes('anchor')) {
    bad.push('the published document carries the internal anchors — those are not for readers');
  }

  if (bad.length) {
    fail('refusals', 'The product publishes a refusal that nothing enforces.', bad.join('\n'));
  } else {
    pass(
      'refusals',
      `${refusals.length} published refusals, every one of them enforced by a check or a test that runs`,
    );
  }
}

/**
 * NO WRITER IS HANDED A COSTUME.
 *
 * Invariant 10: "the genre word never reaches the writer; the user's own words
 * win where they exist." Decision 15 gives the reason in six words — "a genre
 * word is a costume; the model performs it" — and labs/FORMATS.md specifies
 * the enforcement as "a deterministic lint, not a model".
 *
 * It was enforced by nothing, and broken by us rather than by any user:
 * src/plan.ts opened with "You are planning a video essay" and src/essay.ts
 * with "You are outlining a video essay", so the first sentence the writer
 * read was the costume. A user's topic went in verbatim underneath it.
 *
 * This reads the body of every `systemPrompt` in src/ and fails on a costume
 * in any of them. src/intent.ts is exempt and that exemption is doc 05's, not
 * mine: "an intent parse decides the flow; it is the only place a genre word
 * is read." src/register.ts is exempt because it declares the list — a rule
 * whose haystack includes its own declarations is the mistake `reachable`
 * made and never fired once.
 */
function checkRegister() {
  const r = spawnSync('node', ['--experimental-strip-types', '-e',
    'import("./src/register.ts").then(m => console.log(JSON.stringify(m.COSTUMES)))'],
    { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) {
    return fail('register', 'The costume list could not be read.', (r.stderr || '').trim().split('\n').slice(0, 6).join('\n'));
  }
  const costumes = JSON.parse(r.stdout.trim().split('\n').pop());

  /* Longest first, so "video essay" is reported rather than "essay". */
  const ordered = [...costumes].sort((a, b) => b.length - a.length);
  const EXEMPT = ['src/intent.ts', 'src/register.ts'];

  const bad = [];
  let checked = 0;
  for (const file of walk(path.join(ROOT, 'src'))) {
    const rel = path.relative(ROOT, file);
    if (EXEMPT.includes(rel)) continue;

    const text = fs.readFileSync(file, 'utf8');
    /*
     * THE WRITER IS THE `direct` CAPABILITY, and this product already says so.
     *
     * Checking every systemPrompt was too wide: Scout's expand and reduce say
     * "compilation" because `scout_ledger.is_compilation_only` is a fact about
     * somebody else's video, not a costume for a writer, and the judge and the
     * classifier are not writing anything either. Invariant 10 names the
     * writer, and resolveFor("direct") is who that is — angles, essay, plan,
     * reactions, revise.
     */
    if (!/resolveFor\(\s*["']direct["']/.test(text)) continue;

    /* Comments stripped: a comment explaining that a genre word must not
       appear here is not a genre word appearing here, and the comments added
       alongside this rule say exactly that. */
    const clean = (t) =>
      t
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .split('\n')
        .filter((l) => !/^\s*\/\//.test(l))
        .join('\n');

    /*
     * BOTH TURNS, not just the system prompt.
     *
     * src/essay.ts said "Outline the essay: ${topic}" in the USER message
     * while its system prompt was clean, so a rule reading only systemPrompt
     * would have passed it. The costume does not care which role wears it.
     */
    const parts = [];
    const from = text.indexOf('function systemPrompt');
    if (from >= 0) parts.push(text.slice(from, text.indexOf('\n}\n', from) + 1));
    for (const m of text.matchAll(/content:\s*(`[^`]*`|"[^"]*")/g)) parts.push(m[1]);
    if (!parts.length) continue;

    const body = clean(parts.join('\n'));
    checked += 1;

    for (const costume of ordered) {
      /* Word boundaries, so "docuseries" is not found inside another word and
         "commentary" in "commentaries" still is. */
      const re = new RegExp(`\\b${costume.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`, 'i');
      const hit = re.exec(body);
      if (hit) {
        bad.push(
          `${rel}: a writing prompt says "${hit[0]}" — invariant 10, and decision 15: ` +
            'a genre word is a costume and the model performs it. Say what the video has to DO.',
        );
        break;
      }
    }
  }

  if (!checked) {
    bad.push('nothing in src/ resolves the direct capability, so this rule checked no writer at all');
  }

  if (bad.length) fail('register', 'A writing prompt names a genre.', bad.join('\n'));
  else pass('register', `${checked} writing prompts, none of them naming a genre`);
}

/*
 * ── Invariant 2, read off the schemas ──────────────────────────────────────
 *
 * "The model never outputs a timestamp. It directs; a deterministic solver
 * places." Everything else in this product leans on it: a cut is re-derived
 * from rules and moments, timestamps derive from word ids, and an export can
 * carry a receipt — all of which assume the model never got to place
 * anything.
 *
 * It was enforced by prose. Two schemas declare a time field —
 * src/score.ts and src/reactions.ts, both `start_ms`/`end_ms` — and what
 * actually holds them is `groundClips`, which drops a range the transcript
 * does not contain and snaps the rest to segment edges. reactions.ts says so
 * only in its PROMPT: "start_ms and end_ms MUST come from the ranges shown.
 * Never invent a timecode." A prompt is a request. Delete the groundClips
 * call and every test in the repo still passed.
 *
 * So the rule is the pair, not the field: a model schema may declare a
 * time-shaped property only in a file that grounds what comes back. The
 * field is where the model answers; grounding is where the answer stops
 * being believed.
 *
 * WHY A WORD ID IS NOT A TIME, and passes. scout-scan's `first_word_id` is
 * positional and deliberate — "it decides WHICH, never WHEN"
 * (src/scout-verify.ts) — and the number is thrown away outright if it falls
 * outside the window we sent. Word ids are the sanctioned currency of
 * invariant 2 rather than a hole in it, so this names them and counts them
 * instead of failing them: a positional field nobody has noticed is the
 * thing to avoid, not a positional field with a reason.
 */
const TIME_WORDS = new Set([
  'ms', 's', 'sec', 'secs', 'second', 'seconds',
  'time', 'times', 'timestamp', 'timestamps', 'timecode', 'timecodes', 'tc',
  'start', 'end', 'begin', 'at', 'dur', 'duration',
  'offset', 'span', 'position', 'clock', 'when', 'cue',
]);
/** Positional but not temporal — reported, never failed. See above. */
const PLACE_WORDS = new Set(['word', 'words']);
/** The deterministic solver. A schema with a time field needs one of these. */
const GROUNDS = /\bground(?:Clips|Traced)\s*\(/;
/* JSON Schema's own keywords, which are not property names. */
const JSON_SCHEMA_KEYS = new Set([
  'type', 'properties', 'items', 'required', 'enum', 'description', 'format',
  'additionalProperties', 'minimum', 'maximum', 'minItems', 'maxItems',
  'anyOf', 'oneOf', 'allOf', 'const', 'default', 'nullable', 'pattern',
  'json_schema', 'schema', 'name', 'strict',
]);

/** foo_barBaz → ['foo', 'bar', 'baz'] */
function wordsOf(key) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function checkTimes() {
  const bad = [];
  const place = [];
  let schemas = 0;
  let grounded = 0;

  for (const file of walk(path.join(ROOT, 'src'))) {
    const rel = path.relative(ROOT, file);
    const text = fs.readFileSync(file, 'utf8');

    /*
     * THE SCHEMA REGION, not the file.
     *
     * Reading the whole file would flag `clip.start_ms` on the grounded
     * object, which is our own number and the correct thing to use. The
     * claim is about what the MODEL may answer with, so the haystack is the
     * declaration it answers into.
     *
     * Any const whose name ends in SCHEMA, to the `} as const;` that closes
     * it. All thirteen are plain `const SCHEMA`, and a second one in the
     * same file, or one called ANGLE_SCHEMA, is read the same way — a rule
     * that reads only the name in use today passes the next file silently.
     * The count is checked against the call sites regardless.
     */
    const regions = [];
    for (const m of text.matchAll(/const ([A-Za-z_$][\w$]*)\s*=\s*\{/g)) {
      if (!/schema$/i.test(m[1])) continue;
      const to = text.indexOf('} as const;', m.index);
      if (to < 0) {
        bad.push(rel + ': ' + m[1] + ' has no `} as const;` — this rule could not read it, so it checked nothing');
        continue;
      }
      regions.push(text.slice(m.index, to));
    }
    if (!regions.length) continue;
    schemas += regions.length;
    const grounds = GROUNDS.test(text);
    if (grounds) grounded += 1;

    for (const region of regions) {
      /*
       * BOTH WAYS A PROPERTY IS NAMED. `start_ms: { type: "number" }` is the
       * declaration; `required: ["start_ms", "end_ms"]` names the same
       * property as a string, and a schema written on one line has only the
       * first. Neither anchor to the start of a line, because a one-line
       * schema was the first thing this rule was broken with and it passed.
       */
      const keys = [...region.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*\{/g)].map((m) => m[1]);
      for (const req of region.matchAll(/required:\s*\[([^\]]*)\]/g)) {
        for (const q of req[1].matchAll(/["']([^"']+)["']/g)) keys.push(q[1]);
      }

      for (const key of keys) {
        if (JSON_SCHEMA_KEYS.has(key)) continue;
        const words = wordsOf(key);
        if (words.some((w) => TIME_WORDS.has(w))) {
          if (!grounds) {
            bad.push(
              rel + ': the model may answer with `' + key + '` and nothing here grounds it — invariant 2, ' +
                'and a prompt asking it not to invent a timecode is a request. ' +
                'Either take the field out of the schema (see src/scout-reduce.ts: short ids out, short ids back) ' +
                'or pass what comes back through groundClips.',
            );
          }
          continue;
        }
        if (words.some((w) => PLACE_WORDS.has(w)) && !place.includes(rel + ': ' + key)) {
          place.push(rel + ': ' + key);
        }
      }
    }
  }

  /*
   * THE COUNT IS PART OF THE CLAIM. A rule that silently reads nine of
   * fourteen schemas reports green about the five it never opened, which is
   * the `reachable` mistake in a different coat. Every response_format call
   * site in src/ has to be a schema this rule read.
   */
  const sites = [];
  for (const file of walk(path.join(ROOT, 'src'))) {
    /* Comments stripped: src/models.ts documents the capability in prose
       ("Supports `response_format: { type: \"json_schema\" }`") and declares
       no schema, and a rule that reads prose as a call site is the `reachable`
       mistake again. */
    const text = fs
      .readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .split('\n')
      .filter((l) => !/^\s*\/\//.test(l))
      .join('\n');
    /*
     * A CALL SITE IS NOT ONLY A `response_format`. src/judge.ts and
     * src/classify.ts hand their schema to callReason/callRouted, which
     * writes the response_format one layer down — so renaming judge.ts's
     * const made the rule read twelve schemas instead of thirteen and print
     * a green tick about it. That is the `reachable` failure exactly, and
     * this is the line that stops it.
     */
    const asks =
      /response_format:\s*\{\s*type:\s*["']json_schema["']/.test(text) ||
      /\bcall(?:Reason|Routed)\s*\(/.test(text) ||
      /\bcall\.schema\b/.test(text);
    const declares = [...text.matchAll(/const ([A-Za-z_$][\w$]*)\s*=\s*\{/g)].some((m) => /schema$/i.test(m[1]));
    if (asks && !declares) {
      sites.push(path.relative(ROOT, file));
    }
  }
  /* src/llm.ts and src/breaker.ts pass a caller's schema through and declare
     none of their own; they are the transport, not a schema. */
  const TRANSPORT = ['src/llm.ts', 'src/breaker.ts'];
  for (const s of sites) {
    if (!TRANSPORT.includes(s)) {
      bad.push(s + ': asks a model for structured output and declares no `const SCHEMA` this rule can read');
    }
  }

  if (!schemas) {
    bad.push('no model schema was found in src/ at all, so this rule checked nothing');
  }

  if (bad.length) fail('times', 'A model can answer with a time.', bad.join('\n'));
  else {
    pass(
      'times',
      schemas + ' model schemas, ' + grounded + ' of them grounded' +
        (place.length ? ' — positional, by word id and bounded: ' + place.join(', ') : ''),
    );
  }
}

/*
 * ── A personal address in a public repository ──────────────────────────────
 *
 * This repository went public on 15 Nov 2026 to get out of an Actions minutes
 * limit, which is a sound trade and changes what a committed string costs.
 * The owner's own address was a literal in src/user.ts, in eight test
 * fixtures and in two documents — harmless while only collaborators could
 * read it, and a personal address published in plain text at the top of a
 * file afterwards. Plain text at HEAD is exactly what an address harvester
 * reads; it does not brute-force anything.
 *
 * Removing it from HEAD does NOT un-publish it — it is in the commit history
 * for good, and anyone who has cloned has it. What this stops is the next
 * one, which is the only part still available to us.
 *
 * THE RULE IS NARROW ON PURPOSE. Not "no email addresses": this repo is full
 * of them and should be. `someone@example.com` is a fixture, `me@x.com` is
 * shorthand in a test, `podcast@darknetdiaries.com` and `help@prx.org` are
 * contact addresses those organisations publish themselves and are Scout
 * research material. What none of them is, is somebody's personal mailbox at
 * a consumer mail provider — and that is the whole list below. A rule wide
 * enough to catch every address would have been switched off within a week.
 */
const CONSUMER_MAIL = [
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'hotmail.co.uk',
  'live.com', 'msn.com', 'yahoo.com', 'yahoo.co.uk', 'ymail.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com',
  'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.de', 'yandex.ru',
  'zoho.com', 'fastmail.com', 'mail.com', 'inbox.com', 'hey.com',
];

function checkAddresses() {
  const bad = [];
  let scanned = 0;

  /*
   * EVERY TRACKED TEXT FILE, not only src/. The address was in two documents
   * and six test fixtures as well, and a rule that reads one directory would
   * have reported green about the other nine occurrences.
   *
   * This file declares the provider list, so it excludes itself — a rule
   * whose haystack includes its own declarations is the mistake `reachable`
   * made and never once fired.
   */
  const dirs = ['src', 'test', 'docs', 'scripts', 'container', 'migrations', '.github'];
  const SELF = path.relative(ROOT, __filename);

  for (const dir of dirs) {
    const full = path.join(ROOT, dir);
    if (!fs.existsSync(full)) continue;
    for (const file of walkText(full)) {
      const rel = path.relative(ROOT, file);
      if (rel === SELF) continue;
      scanned += 1;
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g)) {
        const domain = m[1].toLowerCase();
        if (!CONSUMER_MAIL.includes(domain)) continue;
        const line = text.slice(0, m.index).split('\n').length;
        bad.push(
          `${rel}:${line}: ${m[0]} — a personal mailbox, committed to a public repository. ` +
            'Addresses that identify a person belong in a secret (see OWNER_EMAIL in src/env.ts) ' +
            'or in a fixture at example.com.',
        );
      }
    }
  }

  /* Also the two root documents a stranger reads first. */
  for (const name of ['README.md', 'CLAUDE.md', 'wrangler.jsonc', 'package.json']) {
    const full = path.join(ROOT, name);
    if (!fs.existsSync(full)) continue;
    scanned += 1;
    const text = fs.readFileSync(full, 'utf8');
    for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g)) {
      if (!CONSUMER_MAIL.includes(m[1].toLowerCase())) continue;
      bad.push(`${name}: ${m[0]} — a personal mailbox, committed to a public repository.`);
    }
  }

  if (!scanned) bad.push('no files were scanned at all, so this rule checked nothing');

  if (bad.length) fail('addresses', "Somebody's personal address is in the repository.", bad.join('\n'));
  else pass('addresses', `${scanned} files, no personal mailbox at any of ${CONSUMER_MAIL.length} consumer providers`);
}

/** Text files worth reading for an address. Skips binaries and lock files. */
function walkText(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkText(p, out);
    else if (/\.(ts|tsx|js|cjs|mjs|json|jsonc|md|sql|yml|yaml|sh|py|html|css|txt)$/.test(e.name)) out.push(p);
  }
  return out;
}

checkTemplate();
checkContent();
checkWired();
checkRoom();
checkFonts();
checkConventions();
checkReachable();
checkSchema();
checkWiring();
checkClaims();
checkNotes();
checkCopy();
checkReceiptJson();
checkRefusals();
checkRegister();
checkTimes();
checkAddresses();

checkStrings().then(() => {
  /* "All checks passed" having skipped one is the same lie as check.sh's
   * used to be, one level down. Name the skips here too, so the line is true
   * whichever output a person happens to be reading. */
  console.log(
    findings
      ? `\n${findings} finding(s)`
      : SKIPPED.length
        ? `\nAll checks passed except ${SKIPPED.join(', ')} — SKIPPED, not run`
        : '\nAll checks passed',
  );
  /*
   * 78 MEANS "PASSED, BUT SOMETHING WENT UNCHECKED".
   *
   * `strings` returns early with no dev server — correctly, because a check
   * that goes red for an absent dependency teaches people to ignore red.
   * But it returned 0, so `scripts/check.sh` could print ALL CHECKS PASSED
   * having checked no rendered HTML at all: the one rule that reads the
   * running product was the one rule that could quietly not run.
   *
   * A finding still beats a skip — a wrong answer is worse news than no
   * answer, so 1 wins over 78. check.sh names every skip in its summary and
   * fails on one under --strict, which is what CI runs.
   */
  process.exit(findings ? 1 : SKIPPED.length ? 78 : 0);
});
