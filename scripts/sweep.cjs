/**
 * Drives every control on every surface and reports the ones that do nothing.
 *
 * The recurring bug in this codebase is not a broken feature — it is a feature
 * that exists on the server, had a UI built for it once, and is no longer
 * connected to it. The recorder was found dead twice; so were renderFootage,
 * the AI controls, the clip picker and the passes log. Reading cannot find
 * these. Pressing them can.
 *
 * A control "does something" if pressing it navigates, fires a request,
 * changes the DOM, opens an overlay or raises a toast. If none of those
 * happen, it is dead and this says so.
 *
 * Destructive controls are named and skipped rather than pressed — the point
 * is to find dead buttons, not to empty the account.
 *
 * KNOWN LIMIT. Tags are written onto the document, so a press that rebuilds it
 * strands every control after it and they are reported "unreachable —
 * unknown". That is the harness, not the page: check by hand before believing
 * one. DEAD, dead link, overflow and error are the findings to trust, and they
 * are the ones worth having — the recurring bug here is a control wired to
 * nothing, and reading cannot find those.
 */
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8787';
const WIDTH = Number(process.env.WIDTH || 1360);

/* Pressed on a real account, these do real damage or leave the surface. */
const DONT_PRESS = /^(delete|remove|close account|sign out|discard|empty|trash|upgrade|manage billing|subscribe|cancel plan)/i;
/* These leave the page on purpose; following them is the link check's job. */
const NAVIGATES = /^(open|continue|download|all \d|watch|review the cut|start cutting|retry|make the video|make a short|clip it|react to it|find clips|find it|run it|begin|export|adjust|record it|generate it|in clipping)/i;

async function surfaces(page) {
  const out = [];
  const j = async (p) => (await (await page.request.get(BASE + p)).json());
  const sources = (await j('/api/sources')).sources || [];
  const projects = (await j('/api/projects')).projects || [];
  const ready = sources.find((s) => s.transcript_state === 'ready') || sources[0];
  const project = projects[0];

  out.push(['Home', '/']);
  out.push(['Footage · Videos', '/footage?tab=sources']);
  out.push(['Footage · Clips', '/footage?tab=moments']);
  out.push(['Footage · Find', '/footage?tab=find']);
  out.push(['Clipping', '/clipping']);
  if (ready) out.push(['Clipping · one video', '/clipping?source=' + ready.id]);
  out.push(['Projects', '/projects']);
  out.push(['Settings', '/settings']);
  if (ready) out.push(['Video', '/sources/' + ready.id]);
  if (project) out.push(['Editor', '/p/' + project.id + '/cut']);
  return out;
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: WIDTH, height: 1000 } });

  const problems = [];
  const note = (surface, kind, detail) => problems.push({ surface, kind, detail });

  let requests = 0;
  let consoleErrors = [];
  page.on('request', () => requests++);
  page.on('pageerror', (e) => consoleErrors.push('page error: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('console: ' + m.text().slice(0, 140)); });

  const list = await surfaces(page);

  for (const [name, path] of list) {
    consoleErrors = [];
    await page.goto(BASE + path, { waitUntil: 'load' });
    await page.waitForTimeout(1200);

    /* Every link that points somewhere in the app, checked for a real page. */
    const hrefs = await page.evaluate(() =>
      [...document.querySelectorAll('a[href]')]
        .map((a) => a.getAttribute('href'))
        .filter((h) => h && h.startsWith('/') && !h.startsWith('/media/') && !h.startsWith('/api/')));
    for (const href of [...new Set(hrefs)]) {
      const res = await page.request.get(BASE + href, { maxRedirects: 5 });
      if (res.status() >= 400) note(name, 'dead link', href + ' → ' + res.status());
    }

    /* Horizontal overflow: the page body must never scroll sideways. */
    if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) {
      note(name, 'overflow', 'the page scrolls sideways at ' + WIDTH + 'px');
    }

    /*
     * Now press things — ONE of each kind.
     *
     * A transcript has twenty-four Cut buttons and pressing all of them says
     * nothing the first one did not, while mutating the edit twenty-four
     * times and taking minutes. Controls are grouped by what they are (their
     * class, or their label when they have no class) and one of each group is
     * pressed.
     */
    /* Tagging has to be redone after every navigation: the attributes are set
       on the document, and going back to the surface builds a new one. The
       first pass tagged once, so every control after the first navigating
       click resolved to nothing and was reported unreachable. */
    const tag = () => page.evaluate(() => {
      const seen = new Map();
      for (const el of document.querySelectorAll('button, [role=button]')) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const label = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim();
        /* A timecode or a count makes every instance look different; the class
           is what actually says which control this is. */
        const key = (el.className || '').trim() || 'label:' + label;
        if (seen.has(key)) { seen.get(key).n++; continue; }
        el.setAttribute('data-sweep', String(seen.size));
        seen.set(key, { key, label: label || '(unlabelled)', id: seen.size, n: 1 });
      }
      return [...seen.values()];
    });

    const groups = await tag();

    for (const g of groups) {
      const btn = page.locator('[data-sweep="' + g.id + '"]');
      const label = g.label + (g.n > 1 ? '  (\u00d7' + g.n + ')' : '');
      if (DONT_PRESS.test(g.label)) continue;

      if (await btn.isDisabled().catch(() => false)) {
        note(name, 'disabled', label);
        continue;
      }

      /*
       * What counts as "something happened".
       *
       * The first pass compared innerHTML, the URL, overlays, toasts and
       * requests, and called four live controls dead: the composer's chips
       * fill a TEXTAREA (a value, which is not in innerHTML) and the player's
       * Full button enters fullscreen (which changes none of the five). A tool
       * that cries wolf gets ignored, so it reads field values, the fullscreen
       * element and the scroll position too.
       */
      const snap = () =>
        page.evaluate(() => ({
          url: location.href,
          html: document.body.innerHTML.length,
          overlays: [...document.querySelectorAll('#palette, #keysheet, #notifpanel, #adjust, #pick-source, #pick-moment, [id$=Panel]')].filter((e) => !e.hidden).length,
          toasts: (document.querySelector('#toasts') || {}).childElementCount || 0,
          fields: [...document.querySelectorAll('input, textarea, select')].map((f) => f.value + ':' + (f.checked ? 1 : 0)).join('|'),
          fullscreen: !!document.fullscreenElement,
          scroll: Math.round(window.scrollY),
          focus: (document.activeElement && document.activeElement.className) || '',
        }));

      const before = { ...(await snap()), reqs: requests };

      try {
        /* Scrolling it in is the harness's job. The first pass reported
           twelve live editor controls as unreachable because it gave up on
           its own scroll and blamed the page. */
        await btn.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(80);
        await btn.click({ timeout: 4000, noWaitAfter: true });
      } catch {
        /* Something is on top of it. WHAT is the useful half of the finding:
           a control a sticky footer covers is unreachable for a user too. */
        const over = await btn.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          if (!hit || el.contains(hit) || hit.contains(el)) return 'off screen';
          const w = hit.closest('[id]');
          return (w && w.id ? '#' + w.id : hit.tagName.toLowerCase()) + ' covers it';
        }).catch(() => 'unknown');
        note(name, 'unreachable', label + ' — ' + over);
        continue;
      }
      await page.waitForTimeout(NAVIGATES.test(label) ? 900 : 450);

      const after = { ...(await snap().catch(() => before)), reqs: requests };

      const moved = after.url !== before.url;
      const did = moved
        || after.html !== before.html
        || after.overlays !== before.overlays
        || after.toasts !== before.toasts
        || after.fields !== before.fields
        || after.fullscreen !== before.fullscreen
        || after.focus !== before.focus
        || after.scroll !== before.scroll
        || after.reqs > before.reqs;

      if (!did) note(name, 'DEAD', label);

      if (moved) {
        await page.goto(BASE + path, { waitUntil: 'load' });
        await page.waitForTimeout(900);
        await tag();
      } else {
        /* Close anything that opened, so the next press starts clean. */
        await page.evaluate(() => { if (document.fullscreenElement) return document.exitFullscreen(); }).catch(() => {});
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(140);
      }
    }

    for (const e of [...new Set(consoleErrors)]) note(name, 'error', e);
    console.log('\u2500\u2500 ' + name + '  ' + path + '   (' + groups.length + ' kinds of control)');
  }

  console.log('\n' + '='.repeat(64));
  if (!problems.length) {
    console.log('Nothing dead, nothing broken, nothing overflowing.');
  } else {
    const by = {};
    for (const p of problems) (by[p.surface] ||= []).push(p);
    for (const [surface, items] of Object.entries(by)) {
      console.log('\n' + surface);
      for (const it of items) console.log('   ' + it.kind.padEnd(12) + it.detail);
    }
    console.log('\n' + problems.length + ' finding(s) at ' + WIDTH + 'px');
  }
  await browser.close();
})();
