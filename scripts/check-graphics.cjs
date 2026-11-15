#!/usr/bin/env node
/*
 * THE GENERATED PICTURES, RASTERISED AND LOOKED AT.
 *
 * src/graphics.ts builds SVG, and test/graphics.test.ts checks the string:
 * the lints refuse, the receipt is in there, the label is in there, no
 * <image> ever is. None of that is the question this answers, which is
 * whether the picture a renderer produces actually CARRIES THE WORDS.
 *
 * THE FONT IS WHY. The design names 'Instrument Sans' and 'IBM Plex Mono',
 * and neither is in the render container — so the text is laid out by
 * whatever fontconfig falls back to, and a quote whose last word runs off
 * the frame is a quote the picture did not carry. That is the one thing
 * these pictures exist to do, so it is measured across several fallbacks
 * rather than assumed from one.
 *
 * It also measures that there is ink at all. An SVG that references a font
 * nobody has, or whose marks landed outside the viewBox, rasterises to a
 * clean empty frame and every string assertion still passes.
 *
 * Needs the Chromium Playwright has, so it is not part of `npm run check` —
 * the same rule as check:loudness and check:duck, because a gate that
 * silently passes when its tool is missing is the thing this repo keeps
 * catching. Run: npm run check:graphics
 */
const { chromium } = require('playwright');
const { writeFileSync, mkdtempSync, rmSync } = require('fs');
const { join } = require('path');
const { tmpdir } = require('os');

const RED = '\x1b[31m', GREEN = '\x1b[32m', DIM = '\x1b[2m', BOLD = '\x1b[1m', OFF = '\x1b[0m';

/*
 * The fallbacks a bare container is likely to land on, plus the two the
 * design asks for. One font proves one font; the picture has to survive
 * whichever one is actually installed where it renders.
 */
const FONTS = [null, 'DejaVu Sans', 'FreeSerif', 'Carlito', 'FreeSans'];

/* The frame, and the margin the rest of the picture keeps. */
const W = 1920;
const MARGIN = 120;

/**
 * Playwright's own browser may not match what is installed here.
 *
 * The environment pins one build and the package expects another, so the
 * preinstalled binary is used when the bundled one is missing rather than
 * downloading 150MB to draw a rectangle.
 */
function launchOptions() {
  const { existsSync, readdirSync } = require('fs');
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!existsSync(root)) return {};
  const dir = readdirSync(root).find((d) => /^chromium-\d+$/.test(d));
  if (!dir) return {};
  const exe = join(root, dir, 'chrome-linux', 'chrome');
  return existsSync(exe) ? { executablePath: exe } : {};
}

async function main() {
  const { chartSvg, quoteCard, WRAP_CHARS, hasNoRaster } = await import('../src/graphics.ts');

  const sourced = (value, cell) => ({ value, provenance: { doc: 'programme-accounts.pdf', page: 11, cell } });
  const chart = chartSvg(
    {
      mark: 'bar',
      baseline: 0,
      units: '£m',
      categories: ['2022', '2023', '2024'],
      data: [sourced(4.2, 'D14'), sourced(6.8, 'D15'), sourced(9.1, 'D16')],
    },
    { title: 'What the programme cost', caption: 'Capital spend, three years' },
  );

  /* A long quote with wide glyphs and an em dash — what a maker writes, not
     a convenient fixture. */
  const card = quoteCard({
    quote:
      'Fine — yes, we absolutely moved the whole launch forward before the ' +
      'review committee came in, and nobody wrote any of it down.',
    said: 'Tuesday night',
    source: '1:05',
  });

  for (const [name, r] of [['chart', chart], ['card', card]]) {
    if (!r.svg) {
      console.log(`${RED}the ${name} refused to draw${OFF}: ${JSON.stringify(r.refused)}`);
      process.exit(1);
    }
    if (!hasNoRaster(r.svg)) {
      console.log(`${RED}a raster got into the ${name}${OFF}`);
      process.exit(1);
    }
  }

  const dir = mkdtempSync(join(tmpdir(), 'gfx-'));
  const browser = await chromium.launch(launchOptions());
  let bad = 0;
  try {
    const page = await browser.newPage({ viewport: { width: W, height: 1080 } });

    console.log(`${BOLD}generated pictures, rasterised${OFF} ${DIM}— wrap ceiling ${WRAP_CHARS} chars, frame ${W}px, margin ${MARGIN}px${OFF}`);

    for (const font of FONTS) {
      for (const [name, r] of [['chart', chart], ['card', card]]) {
        const svg = font ? r.svg.replace(/'Instrument Sans',sans-serif|'IBM Plex Mono',monospace/g, font) : r.svg;
        const file = join(dir, `${name}.svg`);
        writeFileSync(file, svg);
        await page.setContent(`<!doctype html><html><body style="margin:0">${svg}</body></html>`, {
          waitUntil: 'load',
        });

        /*
         * CONTENT, NOT FURNITURE. `text.label` is the Generated badge, which
         * sits in the corner on purpose and reaches nearer the edge than any
         * body text may. Measured together they failed ten rasterisations
         * for one reason, none of them a bug — which is a check reporting its
         * own fixture rather than the code.
         */
        const seen = await page.evaluate(() =>
          [...document.querySelectorAll('text:not(.label)')].map((t) => {
            const b = t.getBBox();
            return { text: t.textContent, right: b.x + b.width, w: b.width };
          }),
        );
        /* And the badge, held to the frame rather than to the margin. */
        const badge = await page.evaluate(() => {
          const t = document.querySelector('text.label');
          if (!t) return null;
          const b = t.getBBox();
          return b.x + b.width;
        });
        const widest = Math.max(0, ...seen.map((s) => s.right));
        const inked = seen.filter((s) => s.w > 0).length;

        /* INK, because a font nobody has rasterises to an empty frame and
           every string assertion still passes. */
        const hasInk = inked >= (name === 'chart' ? 8 : 3);
        /* The badge is required, and required to be inside the frame — it is
           the on-screen label invariant 8 and doc 09 both ask for. */
        const badged = badge !== null && badge <= W;
        /* AND NOTHING PAST THE MARGIN, because a word off the frame is a
           word the picture did not carry. */
        const fits = widest <= W - MARGIN;

        const label = `${name} in ${font ?? 'the named fonts'}`;
        const ok = hasInk && fits && badged;
        if (!ok) bad += 1;
        console.log(
          `  ${ok ? `${GREEN}✔${OFF}` : `${RED}✘${OFF}`} ${label.padEnd(30)} ` +
            `${DIM}text runs${OFF} ${String(inked).padStart(2)} ` +
            `${DIM}widest${OFF} ${String(Math.round(widest)).padStart(4)}px` +
            `${fits ? '' : ` ${RED}past ${W - MARGIN}${OFF}`}${hasInk ? '' : ` ${RED}no ink${OFF}`}` +
            `${badged ? '' : ` ${RED}no label${OFF}`}`,
        );
      }
    }
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }

  if (bad) {
    console.log(`\n${RED}${bad} picture(s) wrong.${OFF} A generated picture has to carry its words whatever font it lands in.`);
    process.exit(1);
  }
  console.log(`\n${GREEN}Every picture carries its words, in every font tried.${OFF}`);
}

main();
