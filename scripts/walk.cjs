/**
 * Walks the app the way a person does, and reports what it finds.
 *
 * Written because the owner asked for exactly this — "can you actually like
 * click through the site" — after a run of fixes that each verified only the
 * thing they changed. A page can pass every unit test and still be a dead end
 * when you click it, and that is the failure mode this catches.
 *
 * It reports rather than asserts. "Looks the same" is not a report; a list of
 * what each surface shows, which controls do nothing, and every console error
 * along the way, is.
 *
 *   node scripts/walk.cjs            → walks localhost:8787
 *   BASE=https://... node scripts/walk.cjs
 */
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8787';
/* WIDTH=390 walks it as a phone. The owner has reported mobile layout bugs
   before and every check since has run at 1280, where they cannot happen. */
const WIDTH = Number(process.env.WIDTH || 1280);
const HEIGHT = Number(process.env.HEIGHT || 900);

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });

  /* The sandbox cannot reach Google Fonts, and each attempt costs ~20s of
     tunnel timeout — enough to make the whole walk look hung. Nothing here
     judges type, so block every external host outright. */
  await page.route('**', (route) => {
    const u = route.request().url();
    if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
    return route.abort();
  });

  const errors = [];
  page.on('pageerror', (e) => errors.push(`${page.url()} :: PAGEERROR ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/net::ERR_FAILED|ERR_CONNECTION_RESET|favicon|fonts\.(googleapis|gstatic)/.test(t)) return;
    errors.push(`${page.url()} :: CONSOLE ${t}`);
  });

  const go = async (path) => {
    await page.goto(BASE + path, { waitUntil: 'load', timeout: 25000 });
    await page.waitForTimeout(350);
  };

  /** What a surface actually offers: its heading, and every control on it. */
  const survey = async (label) => {
    const d = await page.evaluate(() => {
      const txt = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const heading = txt(document.querySelector('[data-screen-label] div') || document.body).slice(0, 70);
      const controls = [];
      document.querySelectorAll('button, a[href], [role="button"], input, textarea, video').forEach((el) => {
        if (!vis(el)) return;
        const tag = el.tagName.toLowerCase();
        const name = txt(el).slice(0, 40) || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.id || tag;
        controls.push({
          tag,
          name,
          href: el.getAttribute('href') || null,
          disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
        });
      });
      /* WHICH element overflows, not merely that something does. The guard
         html{overflow-x:clip} hides the symptom, so measure against the
         viewport width directly. */
      const vw = document.documentElement.clientWidth;
      const spills = [];
      /* Ignore anything inside a container that is MEANT to scroll sideways —
         the stage tab strip, a wide table. Flagging those means every run
         reports a problem that is not one, and a check that cries wolf gets
         ignored exactly when it is right. */
      const inScroller = (el) => {
        for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
          const ov = getComputedStyle(n).overflowX;
          if (ov === 'auto' || ov === 'scroll') return true;
        }
        return false;
      };
      document.querySelectorAll('body *').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        if (inScroller(el)) return;
        if (r.right > vw + 1 || r.left < -1) {
          const t = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 34);
          spills.push(el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
            ' [' + Math.round(r.left) + '..' + Math.round(r.right) + '] ' + t);
        }
      });
      /* Only the outermost offender of each nest is interesting. */
      const trimmed = spills.filter((s, i) => !spills.some((o, j) => j < i && s.startsWith(o.split(' [')[0])));

      return {
        heading,
        url: location.pathname + location.search,
        controls,
        wide: document.documentElement.scrollWidth > vw,
        spills: trimmed.slice(0, 5),
      };
    });

    const dead = d.controls.filter(
      (c) => c.tag === 'a' && (c.href === '#' || c.href === '' || c.href === null),
    );
    console.log(`\n── ${label}  ${d.url}`);
    console.log(`   heading: ${d.heading}`);
    console.log(`   controls: ${d.controls.length}` + (d.wide ? '   ⚠ SCROLLS SIDEWAYS' : ''));
    console.log(`   ${d.controls.map((c) => c.name + (c.disabled ? ' [disabled]' : '')).join(' · ')}`);
    if (dead.length) console.log(`   ⚠ links with no destination: ${dead.map((c) => c.name).join(', ')}`);
    if (d.spills.length) console.log('   ⚠ spills past the viewport:\n     ' + d.spills.join('\n     '));
    const off = d.controls.filter((c) => c.disabled);
    if (off.length) console.log(`   ⚠ disabled: ${off.map((c) => c.name).join(', ')}`);
    return d;
  };

  /* Every editor stage of a real project, not just the one you land on. The
     stages are where the actual work happens and they were never walked. */
  const projects = await (async () => {
    await go('/api/projects');
    try { return JSON.parse(await page.locator('body').innerText()).projects || []; } catch (e) { return []; }
  })();
  const scratch = projects.find((p) => !(p.brief || '').trim());
  const briefed = projects.find((p) => (p.brief || '').trim());

  const stageSurfaces = [];
  for (const [label, p] of [['scratch', scratch], ['briefed', briefed]]) {
    if (!p) continue;
    for (const st of ['pick', 'build', 'script', 'shorts']) {
      stageSurfaces.push([`${label}/${st}`, `/p/${p.id}/${st}`]);
    }
  }

  const surfaces = [...stageSurfaces, 
    ['Home', '/'],
    ['Editor', '/editor'],
    ['Clipping', '/clipping'],
    ['Footage', '/footage'],
    ['Footage · Clips', '/footage?tab=moments'],
    ['Projects', '/projects'],
    ['Settings', '/settings'],
  ];
  const seen = [];
  for (const [label, path] of surfaces) {
    await go(path);
    seen.push([label, await survey(label)]);
  }

  /* The journey that matters: click a video and see where you land. */
  console.log('\n── clicking the first video in Footage');
  await go('/footage?tab=sources');
  const firstVideo = page.locator('a[href^="/sources/"]').first();
  if (await firstVideo.count()) {
    await firstVideo.click();
    await page.waitForLoadState('load');
    await page.waitForTimeout(400);
    const d = await survey('  → landed on');
    const hasVideo = await page.locator('video').count();
    const lines = await page.locator('[data-seg-block]').count();
    const scored = await page.locator('[data-clip]').count();
    console.log(`   video element: ${hasVideo ? 'yes' : 'NO'} · transcript blocks: ${lines} · scored blocks: ${scored}`);

    if (lines) {
      const before = (await page.locator('#scratch-runtime').textContent()) || '';
      await page.locator('.seg-keep').first().click();
      await page.waitForTimeout(500);
      const after = (await page.locator('#scratch-runtime').textContent()) || '';
      console.log(`   keep/drop: "${before.trim()}" → "${after.trim()}"  ${before !== after ? 'OK' : '⚠ NO CHANGE'}`);
      await page.reload({ waitUntil: 'load' });
      await page.waitForTimeout(300);
      const persisted = (await page.locator('#scratch-runtime').textContent()) || '';
      console.log(`   after reload: "${persisted.trim()}"  ${persisted.trim() === after.trim() ? 'PERSISTED' : '⚠ LOST'}`);
      await page.locator('.seg-keep').first().click();
      await page.waitForTimeout(400);
    }
  } else {
    console.log('   no videos to click');
  }

  console.log('\n── how alike are the surfaces?');
  for (const [label, d] of seen) {
    console.log(`   ${label.padEnd(16)} ${String(d.controls.length).padStart(3)} controls`);
  }

  console.log('\n── errors: ' + (errors.length ? '\n   ' + errors.join('\n   ') : 'none'));
  await browser.close();
})();
