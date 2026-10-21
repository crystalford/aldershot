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
const LANDING_PROTO = fs.readFileSync(path.join(ROOT, 'design/Landing.dc.html'), 'utf8');
const PROTO = APP_PROTO + '\n' + LANDING_PROTO + '\n' + ONE_TAKE_PROTO;
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
  const ROUTES = ['/', '/landing', '/projects', '/footage', '/footage?tab=sources', '/footage?tab=exports', '/clipping', '/editor', '/settings'];

  let up = false;
  try {
    const r = await fetch(BASE + '/api/health');
    up = r.ok;
  } catch { up = false; }
  if (!up) {
    console.log(`\n⚠ strings — SKIPPED: no dev server at ${BASE}. Run \`npx wrangler dev --port 8787 --enable-containers=false\` and re-run.`);
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
      /*
       * And the Footage tab, which is NOT an alias — it renders a different
       * centre column, with the most consequential copy in the editor on it:
       * every moment's verdict and the rule that reached it. It was outside
       * the crawl entirely, which is how "click to keep" shipped on a plain
       * div and no check saw the promise at all.
       */
      routes.push('/p/' + projects[0].id + '/footage');
    }
  } catch {}

  await scanPromises(routes);

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
  const KNOWN_DEAD = [
    '/api/projects/:id/outline',
    /*
     * React mode's planner, written ahead of its phase.
     *
     * It lays out clips interleaved with lines to say after them, which is
     * doc 09's React mode, and React mode has no UI yet. It surfaced on
     * 21 Oct 2026 when this rule stopped accepting a comment as a caller —
     * it had never been reachable, and the rule had never been able to say
     * so. Listed rather than exempted so it stays visible every run.
     */
    '/api/projects/:id/reactions',
  ];
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
  const haystack = asksForThings(client) + '\n' + asksForThings(pages) + '\n' + asksForThings(callers);

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
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/`(CREATE (?:TABLE|(?:UNIQUE )?INDEX) IF NOT EXISTS [\s\S]*?)`/g)) {
      const n = name(m[1]);
      if (n) live.set(n, flat(m[1]));
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

checkTemplate();
checkWired();
checkConventions();
checkReachable();
checkSchema();
checkWiring();

checkStrings().then(() => {
  console.log(findings ? `\n${findings} finding(s)` : '\nAll checks passed');
  process.exit(findings ? 1 : 0);
});
