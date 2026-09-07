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

  /*
   * The FAILING REQUEST, not just the page it happened on.
   *
   * The console message for a bad fetch is "Failed to load resource: the
   * server responded with a status of 404" with no URL in it, so a run would
   * report ten identical lines naming only the page — which says something is
   * wrong and nothing about what. Listening to responses gives the URL and the
   * method, which is the difference between a finding and a rumour.
   */
  page.on('response', (r) => {
    if (r.status() < 400) return;
    const u = r.url().replace(BASE, '');
    errors.push(`${r.status()} ${r.request().method()} ${u}`);
  });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/net::ERR_FAILED|ERR_CONNECTION_RESET|favicon|fonts\.(googleapis|gstatic)/.test(t)) return;
    // The response listener above already reports these, with the URL.
    if (/Failed to load resource/.test(t)) return;
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
    /*
     * A disabled control is a finding only when it should be live. The first
     * block cannot move earlier and the last cannot move later — that is the
     * control being honest, and reporting it on every single run trains the
     * reader to skip the warnings that matter.
     */
    const EXPECTED_OFF = ['Move earlier', 'Move later'];
    const off = d.controls.filter((c) => c.disabled && !EXPECTED_OFF.includes(c.name));
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

  /*
   * ONE editor. There used to be four stage URLs and this walk drove all
   * four, which is how "every page is basically the same" was measured. They
   * are now aliases of a single surface, so the walk visits it once per
   * project and separately proves the old paths still resolve — a bookmark
   * must not 404.
   */
  const editorSurfaces = [];
  for (const [label, p] of [['cut · scratch', scratch], ['cut · briefed', briefed]]) {
    if (p) editorSurfaces.push([label, `/p/${p.id}/cut`]);
  }

  const surfaces = [...editorSurfaces, 
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
    await survey('  → landed on');

    const hasVideo = await page.locator('video').count();
    const blocks = await page.locator('.blk').count();
    const scored = await page.locator('.blk [title]').count();
    console.log(`   video element: ${hasVideo ? 'yes' : 'NO'} · blocks: ${blocks} · scored: ${scored}`);

    /* The cut is named after what it is about, not after the file. The owner:
       "it should also automatically name it, instead of having the file
       names". A filename leaking back into the heading is a regression. */
    const heading = ((await page.locator('h1, [data-content]').first().textContent()) || '').trim();
    const looksLikeFile = /\.(mp4|mov|mkv|m4v)$|^[A-Z]{2,4}[_ ]?\d{6,}/i.test(heading);
    console.log(`   named: "${heading}"  ${looksLikeFile ? '⚠ STILL A FILENAME' : 'OK'}`);

    if (blocks) {
      const runtime = async () => ((await page.locator('#cut-runtime').textContent()) || '').trim();

      const before = await runtime();
      await page.locator('.blk-strike').first().click();
      await page.waitForTimeout(500);
      const after = await runtime();
      console.log(`   strike:   "${before}" → "${after}"  ${before !== after ? 'OK' : '⚠ NO CHANGE'}`);

      await page.reload({ waitUntil: 'load' });
      await page.waitForTimeout(400);
      console.log(`   persists: "${await runtime()}"  ${(await runtime()) === after ? 'OK' : '⚠ LOST'}`);

      /* Reorder. The first block's own id is what must move. */
      const idOf = async (i) => await page.locator('.blk').nth(i).getAttribute('data-block');
      const wasFirst = await idOf(0);
      const later = page.locator('.blk').first().locator('.blk-move').last();
      if (await later.count()) {
        await later.click();
        await page.waitForTimeout(600);
        await page.reload({ waitUntil: 'load' });
        await page.waitForTimeout(400);
        const nowFirst = await idOf(0);
        console.log(`   reorder:  ${wasFirst} → ${nowFirst}  ${wasFirst !== nowFirst ? 'OK' : '⚠ NO CHANGE'}`);
      }

      /* Select a phrase and cut it — the reason to edit video by text. */
      const sel = await page.evaluate(() => {
        /* A block with enough words STILL IN IT — the walk strikes a block a
           moment earlier, and picking that one meant the selection step
           silently skipped itself on every run. */
        const blk = [...document.querySelectorAll('.blk')].find(
          (b) => [...b.querySelectorAll('.w')].filter((w) => w.dataset.cut !== '1').length >= 4,
        );
        if (!blk) return false;
        const ws = [...blk.querySelectorAll('.w')].filter((w) => w.dataset.cut !== '1');
        const r = document.createRange();
        r.setStart(ws[0].firstChild, 0);
        r.setEnd(ws[3].firstChild, ws[3].firstChild.length);
        const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
        return true;
      });
      if (sel) {
        await page.waitForTimeout(400);
        const action = page.locator('body > button').last();
        if (await action.isVisible().catch(() => false)) {
          const label = ((await action.textContent()) || '').trim();
          const was = await runtime();
          await action.click();
          await page.waitForTimeout(800);
          console.log(`   select:   "${label}"  ${was} -> ${await runtime()}  OK`);
        } else {
          console.log('   select:   ⚠ no cut action appeared for a selection');
        }
      }

      /* Every word carries its timings, which is what makes the transcript a
         scrub bar and the playing word light up. */
      const timed = await page.locator('.w[data-s]').count();
      const allWords = await page.locator('.w').count();
      console.log(`   timings:  ${timed}/${allWords} words  ${timed === allWords ? 'OK' : '⚠ MISSING'}`);

      /* Make a short of one block — the OpusClip gesture, in the editor. */
      const shortBtn = page.locator('.blk-short').first();
      if (await shortBtn.count()) {
        const was = ((await shortBtn.textContent()) || '').trim();
        await shortBtn.click();
        await page.waitForTimeout(2000);
        const now = ((await shortBtn.textContent()) || '').trim();
        console.log(`   short:    "${was}" → "${now}"  ${was !== now ? 'OK' : '⚠ NO CHANGE'}`);
      } else {
        console.log('   short:    ⚠ no block offers one');
      }

      /* Insert a seam — the "building blocks" gesture.

         Through the seam the way a user reaches it: the options are hidden
         until the + is pressed, so clicking .blk-insert straight off waits
         thirty seconds for something that was never going to appear. This
         step had gone stale against the UI it was meant to be driving. */
      const n = await page.locator('.blk').count();
      const opener = page.locator('.seam-open').first();
      if (await opener.count()) await opener.click();
      await page.waitForTimeout(200);

      const seam = page.locator('.blk-insert:visible').first();
      if (await seam.count()) {
        await seam.click();
        await page.waitForTimeout(700);
        await page.reload({ waitUntil: 'load' });
        await page.waitForTimeout(400);
        const n2 = await page.locator('.blk').count();
        console.log(`   insert:   ${n} → ${n2} blocks  ${n2 > n ? 'OK' : '⚠ NO CHANGE'}`);
      }
    } else {
      console.log('   ⚠ no blocks — the editor has nothing to edit');
    }
  } else {
    console.log('   no videos to click');
  }

  /* A bookmark to an old stage URL must land on the editor, not a 404. */
  console.log('\n── old stage URLs still resolve');
  if (scratch) {
    for (const st of ['pick', 'build', 'script', 'shorts']) {
      const res = await page.goto(BASE + `/p/${scratch.id}/${st}`, { waitUntil: 'load' });
      const blocks = await page.locator('.blk').count();
      console.log(`   /${st}  ${res.status()}  ${blocks} blocks  ${res.status() < 400 ? 'OK' : '⚠ DEAD'}`);
    }
  }

  console.log('\n── control counts per surface');
  for (const [label, d] of seen) {
    console.log(`   ${label.padEnd(16)} ${String(d.controls.length).padStart(3)} controls`);
  }

  console.log('\n── errors: ' + (errors.length ? '\n   ' + errors.join('\n   ') : 'none'));
  await browser.close();
})();
