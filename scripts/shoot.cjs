/**
 * Renders the built app AND the design prototype at the same width, so they can
 * be compared side by side. This is check #1 of the four in
 * docs/archive/handoff-v2/PROMPTING-NOTES.md, and it is the check that matters most: the
 * previous build passed every string/feature test and still shipped a
 * different-feeling product, because nobody ever put the two next to each other.
 *
 *   node scripts/shoot.js app  /  /projects        → /tmp/shot-app-*.png
 *   node scripts/shoot.js proto Home Footage       → /tmp/shot-proto-*.png
 *
 * `proto` shoots design/one-take/ — the current design. Set ALDERSHOT_PROTO to
 * shoot a different one.
 *
 * Two sandbox workarounds, both needed for the comparison to be honest:
 *  - The prototype loads React/ReactDOM/Babel from unpkg at runtime; we serve
 *    them from a local cache instead so it boots without network.
 *  - Google Fonts is unreachable here. Without the cache below, BOTH sides
 *    render in a fallback face and every type judgement is worthless.
 *
 * Run scripts/fetch-fixtures.sh once to populate both caches.
 */
const { chromium } = require('playwright');
const { chromeOptions } = require('./chrome.cjs');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CACHE = process.env.FIXTURE_DIR
  || '/tmp/claude-0/-home-user-aldershot/0bebe197-45d2-5def-a9b7-d7e7d2e7e6b2/scratchpad';
const FONTS = path.join(CACHE, 'fonts');
const CDN = path.join(CACHE, 'cdn-cache');
/*
 * ONE TAKE, NOT THE RETIRED MONOLITH.
 *
 * This pointed at design/Aldershot.dc.html — the design One Take replaced —
 * which means that for as long as One Take has been the authority, the one
 * check this file calls "the check that matters most" has been comparing the
 * build against the wrong product. I then spent a night building the room
 * from the handoff documents and never ran it, which is the failure its own
 * header describes, repeated with the tool sitting right here.
 *
 * ALDERSHOT_PROTO overrides it, so the retired one is still shootable for
 * any surface that has not moved yet.
 */
const PROTO = process.env.ALDERSHOT_PROTO
  || path.resolve(__dirname, '../design/one-take/Aldershot One Take.dc.html');
const WIDTH = Number(process.env.WIDTH || 1280);
const HEIGHT = Number(process.env.HEIGHT || 900);

function fontMap() {
  const map = new Map();
  const f = path.join(FONTS, 'map.txt');
  if (!fs.existsSync(f)) return map;
  for (const line of fs.readFileSync(f, 'utf8').trim().split('\n')) {
    const [url, file] = line.split(' ');
    map.set(url, path.join(FONTS, file));
  }
  return map;
}

async function withRoutes(page) {
  const fonts = fontMap();
  const cssPath = path.join(FONTS, 'fonts.css');

  await page.route('https://fonts.googleapis.com/**', async (route) => {
    if (fs.existsSync(cssPath)) {
      await route.fulfill({ status: 200, contentType: 'text/css', body: fs.readFileSync(cssPath) });
    } else await route.abort();
  });
  await page.route('https://fonts.gstatic.com/**', async (route) => {
    const local = fonts.get(route.request().url());
    if (local && fs.existsSync(local)) {
      await route.fulfill({ status: 200, contentType: 'font/woff2', body: fs.readFileSync(local) });
    } else await route.abort();
  });
  const cdn = {
    'https://unpkg.com/react@18.3.1/umd/react.production.min.js': path.join(CDN, 'react.js'),
    'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js': path.join(CDN, 'react-dom.js'),
    'https://unpkg.com/@babel/standalone@7.29.0/babel.min.js': path.join(CDN, 'babel.js'),
  };
  await page.route('https://unpkg.com/**', async (route) => {
    const local = cdn[route.request().url()];
    if (local && fs.existsSync(local)) {
      await route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(local) });
    } else await route.continue();
  });
}

(async () => {
  const [mode, ...targets] = process.argv.slice(2);
  if (!mode || !targets.length) {
    console.error('usage: node scripts/shoot.js app|proto <targets...>');
    process.exit(2);
  }
  const browser = await chromium.launch(chromeOptions());
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  await withRoutes(page);

  const errors = [];
  const servers = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // Font/CDN aborts are the sandbox, not the app. Everything else counts.
    if (/net::ERR_FAILED|ERR_CONNECTION_RESET|favicon/.test(t)) return;
    errors.push('CONSOLE: ' + t);
  });

  if (mode === 'app') {
    const base = process.env.BASE || 'http://localhost:8787';
    for (const r of targets) {
      await page.goto(base + r, { waitUntil: 'load', timeout: 25000 });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(400);
      const name = r === '/' ? 'home' : r.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
      await page.screenshot({ path: `/tmp/shot-app-${name}.png` });
      console.log('app', r);
    }
  } else {
    /*
     * SERVED OVER HTTP, NOT file://.
     *
     * One Take imports footage.js as an ES module, and a module import from
     * a file:// page is a cross-origin request that Chromium refuses. The
     * symptom is not an error — the shell renders and the content never
     * arrives, so the screenshot is a believable empty room. The retired
     * prototype had no module imports and worked from file://, which is why
     * this only broke when the pointer moved.
     */
    const dir = path.dirname(PROTO);
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '');
      const file = path.join(dir, rel || path.basename(PROTO));
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
      const type = file.endsWith('.js') ? 'application/javascript'
        : file.endsWith('.png') ? 'image/png'
        : file.endsWith('.html') ? 'text/html' : 'application/octet-stream';
      res.writeHead(200, { 'content-type': type });
      fs.createReadStream(file).pipe(res);
    });
    servers.push(srv);
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${srv.address().port}/`;

    await page.goto(base + encodeURIComponent(path.basename(PROTO)), { waitUntil: 'load', timeout: 30000 });
    /* It fetches and renders after load; 2.5s was enough for the retired
       prototype and is not for this one. */
    await page.waitForTimeout(6000);
    for (const label of targets) {
      // Surfaces are reached by clicking their nav item, exactly as a user would.
      if (label !== 'Home') {
        await page.locator(`text="${label}"`).first().click().catch(() => {});
        await page.waitForTimeout(900);
      }
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `/tmp/shot-proto-${label.toLowerCase()}.png` });
      console.log('proto', label);
    }
  }

  console.log('ERRORS:', errors.length ? JSON.stringify(errors) : 'none');
  await browser.close();
  for (const s of servers) s.close();
  process.exit(errors.length ? 1 : 0);
})();
