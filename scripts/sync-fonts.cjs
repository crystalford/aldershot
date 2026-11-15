#!/usr/bin/env node
/*
 * THE FONTS, WHERE THE CONTAINER BUILD CAN SEE THEM.
 *
 * src/ui/fonts holds the woff2 the app serves, and the render container needs
 * the same faces or its generated pictures are set in whatever fontconfig
 * falls back to — doc 08 calls the generated still "the approval checkpoint",
 * and a picture approved in Instrument Sans and rendered in DejaVu Sans is
 * not the picture that was approved.
 *
 * WHY A COPY AND NOT A REFERENCE. wrangler builds the image with the
 * Dockerfile's own directory as the build context, and COPY cannot reach
 * outside it. A symlink does not help: Docker copies the link, not its
 * target. So the files are copied in, and the `fonts` rule in
 * check-fidelity.cjs fails when the copy has fallen behind — the same
 * arrangement as `npm run schema` and its gate rule, for the same reason.
 *
 * src/ui/fonts stays the one source of truth. Run: npm run fonts
 */
const { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } = require('fs');
const { join } = require('path');

const ROOT = join(__dirname, '..');
const FROM = join(ROOT, 'src', 'ui', 'fonts');
const TO = join(ROOT, 'container', 'fonts');

const woff2 = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.woff2')).sort() : []);

const want = woff2(FROM);
if (!want.length) {
  console.error('src/ui/fonts has no woff2 — nothing to sync, which cannot be right');
  process.exit(1);
}

mkdirSync(TO, { recursive: true });
/* Anything here that is not there any more goes, or a face deleted upstream
   would keep rendering in the container for ever. */
for (const f of woff2(TO)) if (!want.includes(f)) rmSync(join(TO, f));
for (const f of want) writeFileSync(join(TO, f), readFileSync(join(FROM, f)));

console.log(`container/fonts — ${want.length} face(s) from src/ui/fonts`);
