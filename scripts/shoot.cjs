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
 * Two sandbox workarounds, both needed for the comparison to be honest:
 *  - The prototype loads React/ReactDOM/Babel from unpkg at runtime; we serve
 *    them from a local cache instead so it boots without network.
 *  - Google Fonts is unreachable here. Without the cache below, BOTH sides
 *    render in a fallback face and every type judgement is worthless.
 *
 * Run scripts/fetch-fixtures.sh once to populate both caches.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CACHE = process.env.FIXTURE_DIR
  || '/tmp/claude-0/-home-user-aldershot/0bebe197-45d2-5def-a9b7-d7e7d2e7e6b2/scratchpad';
const FONTS = path.join(CACHE, 'fonts');
const CDN = path.join(CACHE, 'cdn-cache');
const PROTO = path.resolve(__dirname, '../design/Aldershot.dc.html');
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
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  await withRoutes(page);

  const errors = [];
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
    await page.goto('file://' + PROTO, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(2500);
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
  process.exit(errors.length ? 1 : 0);
})();
