#!/usr/bin/env node
/**
 * Does the exported video contain the cut you made?
 *
 * Every other check in this repo reasons about the edit. This one watches the
 * finished file. It builds a source where EVERY SECOND IS A DIFFERENT COLOUR,
 * makes known edits through the real API, renders, and reads the colours back
 * out — so "second 7 was struck" becomes "that colour is absent from the
 * file", with no OCR and no judgement call.
 *
 * It exists because the render was the one thing that could not be verified
 * here for most of this project's life, so every fix to it was reasoned about
 * rather than run. The moment it could run it found real bugs: an EDL built
 * from the old model, block_order never reaching the encoder, struck blocks
 * still rendering, and a duration that described the cut's intention rather
 * than the file.
 *
 * NEEDS, and says so plainly rather than failing obscurely:
 *   ffmpeg + ffprobe on PATH        (apt-get install ffmpeg)
 *   the encoder                     node container/render.mjs
 *   a dev server                    npx wrangler dev --local --port 8787 --enable-containers=false
 *   a static host for the fixture   node scripts/check-render.cjs --serve
 *   in .dev.vars:                   RENDER_URL=http://127.0.0.1:8080
 *                                   MEDIA_PUBLIC_BASE=http://127.0.0.1:8099
 *
 * Deliberately NOT part of `npm run check`, which has to stay runnable with
 * none of that.
 */

const { execFileSync, spawnSync } = require('node:child_process');
const { mkdirSync, writeFileSync, rmSync, copyFileSync, readFileSync, statSync, openSync, readSync, closeSync } = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');

const BASE = process.env.BASE || 'http://localhost:8787';
const ENCODER = process.env.RENDER_URL || 'http://127.0.0.1:8080';
const ROOT = process.env.FIXTURES || path.join(os.tmpdir(), 'aldershot-render-check');
const SECONDS = 24;

/* The edit this check makes, and therefore what the file must contain. */
const STRIKE_LINES = [3, 7];
const STRIKE_WORDS = [10, 11, 12];
const MOVE_FIRST_LATER = true;

const ff = (args) => execFileSync('ffmpeg', ['-nostdin', '-y', '-v', 'error', ...args], { maxBuffer: 1 << 28 });
const post = (url, body) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** Distinct, well-separated colours — one per second of the fixture. */
function palette() {
  const out = [];
  for (let i = 0; i < SECONDS; i++) {
    const h = (i / SECONDS) * 6;
    const f = (n) => {
      const k = (n + h) % 6;
      return Math.round(12 + 230 * Math.max(0, Math.min(1, Math.min(k, 4 - k, 1))));
    };
    out.push([f(5), f(3), f(1)]);
  }
  return out;
}

/* ── the static host, for --serve ────────────────────────────────────────
   ffmpeg seeks with -ss before -i, so every cut is a RANGE request and a
   nineteen-cut export makes them at once. Node's http handles both; python's
   http.server supports neither, which surfaced as "Stream ends prematurely".
   This stands in for presigned R2 URLs, which need real S3 credentials the
   local emulator does not have. */
if (process.argv.includes('--serve')) {
  /* A fixture host must not be able to die of one bad request — it is holding
     up a render that takes a minute to reach this point. */
  const guard = (fn) => (req, res) => {
    try { fn(req, res); } catch (e) {
      try { res.writeHead(500).end(String(e.message)); } catch { /* already sent */ }
    }
  };
  http
    .createServer(guard((req, res) => {
      const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
      if (!file.startsWith(ROOT)) return res.writeHead(403).end();
      let size;
      /* isFile(), not just "it exists": a directory has a size and passes
         statSync, then readSync throws EISDIR and takes the whole process
         with it. The readiness probe asks for "/" and killed this server. */
      try {
        const st = statSync(file);
        if (!st.isFile()) return res.writeHead(404).end();
        size = st.size;
      } catch {
        return res.writeHead(404).end();
      }

      const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
      const start = m && m[1] ? Number(m[1]) : 0;
      const end = m && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      const len = end - start + 1;

      const fd = openSync(file, 'r');
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, start);
      closeSync(fd);

      res.writeHead(m ? 206 : 200, {
        'content-type': 'video/mp4',
        'content-length': String(len),
        'accept-ranges': 'bytes',
        ...(m ? { 'content-range': `bytes ${start}-${end}/${size}` } : {}),
      });
      res.end(buf);
    }))
    .listen(8099, '127.0.0.1', () => console.log(`serving ${ROOT} on http://127.0.0.1:8099`));
  return;
}

function db() {
  const dir = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
  const files = require('node:fs').readdirSync(dir).filter((f) => f.endsWith('.sqlite'));
  return new DatabaseSync(path.join(dir, files[0]));
}

async function main() {
  for (const bin of ['ffmpeg', 'ffprobe']) {
    if (spawnSync(bin, ['-version']).status !== 0) {
      console.log(`\n⚠ SKIPPED — ${bin} is not on PATH. See the header of this file.`);
      return;
    }
  }
  for (const [what, url] of [
    ['dev server', `${BASE}/api/health`],
    ['encoder', `${ENCODER}/render`],
    /* A path that is deliberately absent: 404 proves it is listening and
       answering, without asking it to read anything. */
    ['fixture host', 'http://127.0.0.1:8099/__alive'],
  ]) {
    const ok = await fetch(url).then((r) => r.status < 500).catch(() => false);
    if (!ok) {
      console.log(`\n⚠ SKIPPED — no ${what} at ${url}. See the header of this file.`);
      return;
    }
  }

  const d = db();
  const user = d.prepare('SELECT id FROM v2_users LIMIT 1').get();
  if (!user) return console.log('\n⚠ SKIPPED — no account in the local database.');
  const cols = palette();

  /* 1. A source whose every second is a different colour. */
  const mediaDir = path.join(ROOT, 'media', 'u', user.id, 'sources', 'COLOURS');
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(path.join(ROOT, 'bars'), { recursive: true });
  mkdirSync(mediaDir, { recursive: true });

  process.stdout.write(`building ${SECONDS} one-second colours… `);
  const list = [];
  for (let i = 0; i < SECONDS; i++) {
    const hex = '0x' + cols[i].map((n) => n.toString(16).padStart(2, '0')).join('');
    const out = path.join(ROOT, 'bars', `${String(i).padStart(2, '0')}.mp4`);
    ff(['-f', 'lavfi', '-i', `color=c=${hex}:s=640x360:d=1:r=25`,
        '-f', 'lavfi', '-t', '1', '-i', `sine=frequency=${200 + i * 40}`,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-shortest', out]);
    list.push(`file '${out}'`);
  }
  const listFile = path.join(ROOT, 'list.txt');
  writeFileSync(listFile, list.join('\n'));
  const src = path.join(ROOT, 'colours.mp4');
  ff(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', src]);
  copyFileSync(src, path.join(mediaDir, 'original.mp4'));
  console.log('done');

  /* 2. A transcript: one line a second, four words each. */
  const key = `u/${user.id}/sources/COLOURS/original.mp4`;
  /* Dependents first: renders and beats hang off the project, clips off the
     source, and a re-run trips a foreign key otherwise. */
  for (const sql of [
    "DELETE FROM renders WHERE project_id IN (SELECT id FROM v2_projects WHERE source_id='COLOURS')",
    "DELETE FROM beats WHERE project_id IN (SELECT id FROM v2_projects WHERE source_id='COLOURS')",
    "DELETE FROM v2_clip_threads WHERE clip_id IN (SELECT id FROM v2_clips WHERE source_id='COLOURS')",
    "DELETE FROM renders WHERE clip_id IN (SELECT id FROM v2_clips WHERE source_id='COLOURS')",
    "DELETE FROM v2_clips WHERE source_id='COLOURS'",
    "DELETE FROM v2_projects WHERE source_id='COLOURS'",
    "DELETE FROM segments WHERE source_id='COLOURS'",
    "DELETE FROM uploads WHERE source_id='COLOURS'",
    "DELETE FROM sources WHERE id='COLOURS'",
  ]) d.prepare(sql).run();
  d.prepare(
    `INSERT INTO sources (id,user_id,title,filename,origin,r2_key,stream_uid,duration_s,width,height,
      transcript_state,poster_r2_key,brief,created_at,deleted_at,cut_title)
     VALUES ('COLOURS',?,'Colour bars','colours.mp4','upload',?,NULL,?,NULL,NULL,'ready',NULL,NULL,1,NULL,'Colour bars')`,
  ).run(user.id, key, SECONDS);
  const ins = d.prepare('INSERT INTO segments (id,source_id,idx,start_ms,end_ms,speaker,text,words) VALUES (?,?,?,?,?,?,?,?)');
  for (let i = 0; i < SECONDS; i++) {
    const words = [0, 1, 2, 3].map((j) => ({ w: `w${i}${j}`, s: i + j * 0.25, e: i + j * 0.25 + 0.24 }));
    ins.run(`cs${i}`, 'COLOURS', i, i * 1000, (i + 1) * 1000, null, words.map((w) => w.w).join(' '), JSON.stringify(words));
  }

  /* 3. Open it, which is what creates the cut. */
  await fetch(`${BASE}/sources/COLOURS/edit`);
  const project = d.prepare("SELECT id FROM v2_projects WHERE source_id='COLOURS' ORDER BY created_at DESC LIMIT 1").get();

  /* 4. The edits, through the same routes the editor uses. */
  for (const seg of STRIKE_LINES) {
    await post(`${BASE}/api/projects/${project.id}/cuts`, { kind: 'segment', block: `s:${seg}`, seg });
  }
  await post(`${BASE}/api/projects/${project.id}/cuts`, {
    kind: 'range',
    ranges: STRIKE_WORDS.map((seg) => ({ seg, from: 0, to: 3 })),
  });
  if (MOVE_FIRST_LATER) await post(`${BASE}/api/projects/${project.id}/blocks/move`, { block: 's:0', dir: 1 });

  /* 5. Export. */
  process.stdout.write('rendering… ');
  await post(`${BASE}/api/renders`, { projectId: project.id, format: 'mp4_720', aspect: '16:9' });
  let row;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    row = d.prepare("SELECT state,r2_key,duration_s,error FROM renders WHERE project_id=? ORDER BY created_at DESC LIMIT 1").get(project.id);
    if (row && row.state !== 'queued' && row.state !== 'running') break;
  }
  if (!row || row.state !== 'ready') {
    console.log('\n\n✘ render — ' + ((row && row.error) || 'never finished'));
    process.exitCode = 1;
    return;
  }
  console.log(`${row.duration_s}s`);

  /* 6. Read the colours back out of the file. */
  const out = path.join(ROOT, 'export.mp4');
  const res = await fetch(`${BASE}/media/${row.r2_key}`);
  writeFileSync(out, Buffer.from(await res.arrayBuffer()));

  /* Every frame at 10fps as a single pixel, so the sequence is measured from
     the file rather than sampled on a grid — cuts come back ~1.05s after
     re-encoding, and a fixed one-second grid double-counts one of them. */
  const raw = execFileSync('ffmpeg',
    ['-nostdin', '-v', 'error', '-i', out, '-vf', 'scale=1:1,fps=10', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { maxBuffer: 1 << 28 });
  const nearest = (r, g, b) =>
    cols.reduce((best, c, i) => {
      const dist = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2;
      return dist < best.d ? { i, d: dist } : best;
    }, { i: -1, d: Infinity }).i;

  const runs = [];
  for (let p = 0; p + 2 < raw.length; p += 3) {
    const c = nearest(raw[p], raw[p + 1], raw[p + 2]);
    if (runs.length && runs[runs.length - 1][0] === c) runs[runs.length - 1][1]++;
    else runs.push([c, 1]);
  }
  /* Three frames minimum: a single blended frame at a cut boundary is not a
     second of footage. */
  const seq = runs.filter(([, n]) => n >= 3).map(([c]) => c);

  const gone = new Set([...STRIKE_LINES, ...STRIKE_WORDS]);
  let want = [];
  for (let i = 0; i < SECONDS; i++) if (!gone.has(i)) want.push(i);
  if (MOVE_FIRST_LATER) want = [want[1], want[0], ...want.slice(2)];

  console.log(`\n  expected  ${want.join(' ')}`);
  console.log(`  in file   ${seq.join(' ')}`);
  if (seq.join() === want.join()) {
    console.log('\n✔ render — the exported video is the cut the editor showed');
  } else {
    console.log('\n✘ render — the file does not match the edit');
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
