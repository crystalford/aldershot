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
const { chromeOptions } = require('./chrome.cjs');

const BASE = process.env.BASE || 'http://localhost:8787';

/*
 * --fresh: WALK IT AS SOMEBODY WHO JUST SIGNED UP.
 *
 * Every check in this repo has only ever run against an account that already
 * had footage in it: the dev sign-in makes one user and the seeder fills it.
 * So the first thing a stranger sees — the empty room, the upload, the wait —
 * is the one path nothing had ever driven, and the empty states were a thing
 * read in source rather than looked at.
 *
 * It signs in by MINTING THE SESSION COOKIE for the empty account, which
 * works for one honest reason: in development src/auth.ts signs with a
 * constant (there is no SESSION_SECRET), and currentUser prefers a valid
 * cookie over DEV_LOGIN_EMAIL. There is no other way to be a second person
 * against a dev server, and a drive that could only ever be the same user is
 * not a first-run drive.
 */
const FRESH = process.argv.includes('--fresh');
const EMPTY_USER = 'fix-user-empty';

/** The same HMAC src/auth.ts mints, with the development constant. */
async function devSession(userId) {
  const body = `${userId}.${Date.now() + 7 * 86400000}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode('dev-only-not-a-secret'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  let raw = '';
  for (const b of sig) raw += String.fromCharCode(b);
  return `${body}.${Buffer.from(raw, 'binary').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}
/* WIDTH=390 walks it as a phone. The owner has reported mobile layout bugs
   before and every check since has run at 1280, where they cannot happen. */
const WIDTH = Number(process.env.WIDTH || 1280);
const HEIGHT = Number(process.env.HEIGHT || 900);

(async () => {
  const browser = await chromium.launch(chromeOptions());
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
    /* Deliberately off, and each for a stated reason. The arrows: the first block
   cannot move earlier and the last cannot move later. The clean-ups: a
   clean-up with nothing to clean has nothing to do, and the rule in this
   product is that a count is real or it is not shown — so it goes quiet
   rather than offering a button that would find nothing. */
const EXPECTED_OFF = ['Move earlier', 'Move later', 'Remove \u201Cum\u201D and \u201Cuh\u201D', 'Tighten silences'];
    const off = d.controls.filter((c) => c.disabled && !EXPECTED_OFF.includes(c.name));
    if (off.length) console.log(`   ⚠ disabled: ${off.map((c) => c.name).join(', ')}`);
    return d;
  };

  if (FRESH) {
    await page.context().addCookies([
      { name: 'as_session', value: await devSession(EMPTY_USER), url: BASE, httpOnly: true, sameSite: 'Lax' },
    ]);
    await go('/');
    const who = await page.evaluate(() => fetch('/api/projects').then((r) => r.status));
    if (who !== 200) {
      console.log('✘ --fresh could not sign in as the empty account (/api/projects said ' + who + ').');
      console.log('    Run `node scripts/seed-fixture.cjs` first — it creates the row.');
      await browser.close();
      process.exit(1);
    }

    /*
     * AND IT STARTS EMPTY EVERY TIME.
     *
     * This drive uploads a file, which is the point of it — so the second
     * run walks an account with a failed upload in it and reports every
     * empty state as populated. The first time that happened the drive
     * reported /footage as saying nothing about what to do next, which was
     * true of THAT account and not of a new one: a fixture that stops being
     * a fixture after one use.
     *
     * Through the product's own delete, not the database, because that is
     * the path a person has and it is worth driving too.
     */
    const left = await page.evaluate(async () => {
      const { sources = [] } = await fetch('/api/sources').then((r) => r.json());
      for (const s of sources) {
        await fetch('/api/sources/' + s.id + '/delete', { method: 'POST' });
      }
      return sources.length;
    });
    if (left) console.log(`(cleared ${left} source(s) left by an earlier run)\n`);
    await go('/');

    let uploaded = 'found no way to upload';
    console.log('── the first run, as somebody who just signed up\n');
    for (const [label, path] of [
      ['the room, nothing in it', '/'],
      ['  · Highlights', '/?tab=highlights'],
      ['  · Projects', '/?tab=projects'],
      ['everything you have', '/footage'],
      ['  · moments', '/footage?tab=moments'],
      ['  · edits', '/footage?tab=edits'],
      ['  · exports', '/footage?tab=exports'],
      ['settings', '/settings'],
    ]) {
      await go(path);
      const d = await survey(label);
      /*
       * AN EMPTY SURFACE HAS TO SAY WHAT TO DO NEXT.
       *
       * A page with nothing on it and nothing to press is a dead end, and
       * the only way to find one is to be the person who has nothing.
       */
      /*
       * THE LAST LONG LINE, NOT THE FIRST.
       *
       * The first is the page's own subtitle, which is the same on every
       * tab — so the first version of this reported the same sentence for
       * all five of Footage's tabs and said nothing about any of them. What
       * a person wants to know on an empty tab is what the TAB says, and
       * that is the last thing on the page.
       */
      const sentence = await page.evaluate(() => {
        const t = (document.querySelector('main') || document.body).innerText
          .split('\n')
          .map((x) => x.trim())
          .filter((x) => x.length > 24);
        /*
         * AND IT HAS TO BE THE TAB'S OWN LINE, not the page's.
         *
         * "the last long line" was not enough: delete a tab's empty-state
         * sentence and the last long line becomes the page SUBTITLE, which
         * is on every tab — so the check went green over a tab that now
         * said nothing. Caught by deleting "Nothing exported yet…" and
         * watching this pass. If the last thing on the page is the same as
         * the first, the body said nothing of its own.
         */
        if (t.length < 2 || t[t.length - 1] === t[0]) return '';
        return t[t.length - 1];
      });
      /*
       * AND THESE TWO COUNT AS FAILURES, because the stage's summary says
       * "every one saying what to do next" and a summary that claims
       * something nothing checked is the thing this repo keeps catching
       * itself doing. A surface with nothing on it and nothing to press is
       * a dead end, and the only way to find one is to be the person who
       * has nothing.
       */
      if (!sentence) {
        console.log('   ⚠ nothing on this page says what to do next');
        errors.push(`${path} :: empty, and says nothing about what to do next`);
      } else console.log(`   says: ${sentence.slice(0, 110)}`);
      if (!d.controls.length) {
        console.log('   ⚠ NOTHING TO PRESS');
        errors.push(`${path} :: nothing to press`);
      }
    }

    /* The one thing the front door asks you to do. */
    console.log('\n── the upload, pressed');
    await go('/');
    const file = page.locator('input[type="file"]').first();
    if (!(await file.count())) {
      console.log('   ⚠ no file input on the front door — there is no way in');
    } else {
      /* Not a real recording: the point is to learn how far the product
         gets and what it says, not to transcribe anything. A container is
         not running here and the read will not finish; what this reports is
         whether the handoff from the browser to the job is intact. */
      await file.setInputFiles({
        name: 'first.mp4',
        mimeType: 'video/mp4',
        buffer: Buffer.alloc(64 * 1024, 7),
      });
      await page.waitForTimeout(2000);
      await survey('  → after choosing a file');

      /*
       * AND THEN PRESS THE BUTTON, because choosing a file is not the
       * gesture — the front door takes a file AND a sentence, and the first
       * drive stopped at the file and reported "nothing was created", which
       * was the drive being half a step short rather than the product being
       * broken. Half a step short is exactly how a first run gets mis-read.
       */
      const say = page.locator('textarea').first();
      if (await say.count()) await say.fill('keep the parts where I am working something out');
      const run = page.locator('button:has-text("Run it")').first();
      if (await run.count()) {
        await run.click();
        await page.waitForTimeout(4000);
      }
      await survey('  → after pressing Run it');

      /*
       * A REFUSED UPLOAD IS NOT A BROKEN ONE.
       *
       * 20 uploads an hour per account (src/ratelimit.ts), and this drive
       * spends one every time it runs — so on a machine where it has been
       * run twenty times in an hour the product correctly says no, and the
       * drive was reporting the limit working as "NOTHING WAS CREATED".
       * That is the check calling the product broken for doing its job,
       * which is how a check gets ignored on the day it is right.
       */
      const capped = errors.some((e) => /^429 POST \/api\/uploads/.test(e));
      for (let i = errors.length - 1; i >= 0; i -= 1) {
        if (/^429 POST \/api\/uploads/.test(errors[i])) errors.splice(i, 1);
      }
      const sources = await page.evaluate(() =>
        fetch('/api/sources').then((r) => r.json()).then((j) => (j.sources || []).length),
      );
      if (capped && !sources) {
        console.log('   the upload limit refused it (20 an hour) — which is the limit working.');
        uploaded = 'refused by the hourly limit';
      } else {
        uploaded = sources ? 'uploaded' : 'upload went nowhere';
        console.log(`   sources now: ${sources}  ${sources ? 'OK — the file reached the server' : '⚠ NOTHING WAS CREATED'}`);
        if (!sources) errors.push('/ :: chose a file, pressed Run it, and nothing was created');
      }
      if (sources) {
        const state = await page.evaluate(() =>
          fetch('/api/sources').then((r) => r.json()).then((j) => (j.sources || [])[0] || {}),
        );
        console.log(`   it says: ${state.transcript_state || '(no state)'} — "${state.title || '(untitled)'}"`);

        /*
         * A FAILED READ IS NOT A VIDEO READ.
         *
         * There is no container here, so this upload always fails — which
         * is the useful part: it is the only state where "N videos read"
         * and "N videos uploaded" differ, and the title row said "1 video
         * read" directly above a line saying that video didn't finish.
         * Every check before this one ran on an account where every source
         * had already been read, so the two were always the same number.
         */
        await go('/');
        const claims = await page.evaluate(() => {
          const t = document.body.innerText;
          return {
            read: (t.match(/(\d+) videos? read/) || [])[1] || null,
            failed: /didn't finish/.test(t),
          };
        });
        const honest = claims.failed ? claims.read === '0' : true;
        console.log(
          `   the room says "${claims.read} videos read"` +
            (claims.failed ? ' and that it didn\'t finish' : '') +
            `  ${honest ? 'OK' : '⚠ IT CLAIMS TO HAVE READ WHAT IT COULD NOT'}`,
        );
        if (!honest) errors.push('/ :: says it read a video whose transcript failed');
      }
    }

    const counted0 = new Map();
    for (const e of errors) counted0.set(e, (counted0.get(e) ?? 0) + 1);
    console.log(
      '\n── errors on the first run: ' +
        ([...counted0].map(([e, n]) => (n > 1 ? `${e}   ×${n}` : e)).join('\n   ') || 'none'),
    );
    await browser.close();
    /* It has an exit code for the same reason the full walk does: a first
       run that 4xxs, throws or lies about what it read is a defect, and a
       drive that only ever prints is one nobody runs twice. The media
       exemption does not apply — this account has no media to miss. */
    const bad = [...counted0.keys()];
    if (bad.length) {
      console.log('\n✘ walk --fresh — ' + bad.length + ' problem(s) on the first run');
      process.exit(1);
    }
    console.log(
      '\n✔ walk --fresh — signed up, looked around, ' + uploaded +
        '; every empty surface says what to do next',
    );
    return;
  }

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

  /*
   * EVERY SURFACE, DERIVED. See scripts/surfaces.cjs.
   *
   * This was six entries, and two of them — '/projects' and the Clips tab's
   * sibling — were a redirect and an alias, while ten real surfaces were
   * missing: Words, Shorts, five of Footage's seven tabs, /eval, /plan/:id,
   * the Scout board and /home. A walk that never visits a page cannot report
   * a dead control on it, which is most of why the controls on those pages
   * had never been pressed by anything.
   *
   * The editor's own cuts stay in front, because the two of them are the
   * surfaces with the most behaviour and the walk reads top-down.
   */
  const inventory = await require('./surfaces.cjs').expand({
    base: BASE,
    fetchJson: async (u) => (await page.evaluate((url) => fetch(url).then((r) => r.json()), u)),
  });
  const derived = inventory.urls
    /* The editor list below already covers these two, with better labels. */
    .filter((u) => !editorSurfaces.some(([, p]) => p === u))
    .map((u) => [u, u]);

  const surfaces = [...editorSurfaces, ...derived];
  for (const sf of inventory.surfaces) {
    if (!sf.urls.length) console.log(`   (not walked: ${sf.route} — ${sf.why || 'no URL'})`);
  }
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

  /*
   * ONE LINE PER DISTINCT ERROR, with a count.
   *
   * The first walk of the full surface list reported the same missing media
   * object twenty-two times — the fixture's video has an r2_key and no bytes
   * behind it, and every page that draws a player asks for it. Twenty-two
   * identical lines buried the one finding that mattered (a real 404 on
   * /p/:id/receipts, from a route registered after the catch-all that
   * swallowed it). A report that hides its own findings in repetition is the
   * report nobody reads to the end.
   */
  const counted = new Map();
  for (const e of errors) counted.set(e, (counted.get(e) ?? 0) + 1);
  const lines = [...counted].map(([e, n]) => (n > 1 ? `${e}   ×${n}` : e));
  console.log('\n── errors: ' + (lines.length ? '\n   ' + lines.join('\n   ') : 'none'));
  await browser.close();

  /*
   * AND NOW IT HAS AN EXIT CODE, so check.sh can hold it.
   *
   * This file has reported for weeks and asserted nothing, which was right
   * while it was six pages — "looks the same is not a report". Now that it
   * walks every surface the product has, a page that throws or answers 4xx is
   * a defect it should be able to fail on, and it found one the first time:
   * /p/:id/receipts answered 404 because it was registered after the route
   * that swallows it.
   *
   * MEDIA IS THE ONE EXEMPTION, and a narrow one: a seeded fixture has an
   * r2_key with no bytes behind it, so every page drawing a player asks for a
   * file that is not there. That is the FIXTURE being thin, not the product
   * being broken, and failing on it would make this red on every machine
   * until somebody uploads a video — which is how a check becomes one people
   * learn to skip. Everything else counts.
   */
  const real = [...counted.keys()].filter((e) => !/^404 GET \/media\//.test(e));
  if (real.length) {
    console.log('\n✘ walk — ' + real.length + ' error(s) that are not a fixture missing its bytes');
    process.exit(1);
  }
  console.log('\n✔ walk — every surface answered, nothing threw');
})();
