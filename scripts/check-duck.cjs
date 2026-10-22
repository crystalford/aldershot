#!/usr/bin/env node
/*
 * THE DUCK, MEASURED RATHER THAN ASSERTED.
 *
 * Phase 5's sound rule is "duck by word timings", and the thing worth
 * proving is not that the expression contains −12 anywhere. It is that real
 * ffmpeg, given the expression src/ducking.ts builds, moves the bed to the
 * right level at the right instants — and above all that it does NOT move it
 * back up inside a short gap, because the pumping that causes is the whole
 * reason this is computed instead of compressed.
 *
 * WHY A SCRIPT AND NOT A UNIT TEST. The unit tests check the envelope and the
 * expression's shape, which is the half that can be wrong in TypeScript. This
 * is the other half: whether ffmpeg agrees. It did not, the first time — the
 * commas were escaped with `\,` inside a template literal, which JavaScript
 * reads as a plain comma, so every one of them would have ended the filter.
 * No unit test on a string catches that; a measurement does.
 *
 * Needs ffmpeg on PATH, so it is not part of `npm run check` — the same rule
 * as check-loudness.cjs, because a gate rule that silently passes when its
 * tool is missing is the thing this repo keeps catching.
 * Run: npm run check:duck
 */
const { spawnSync } = require('child_process');
const { mkdtempSync, rmSync, readFileSync } = require('fs');
const { join } = require('path');
const { tmpdir } = require('os');

const RED = '\x1b[31m', GREEN = '\x1b[32m', DIM = '\x1b[2m', BOLD = '\x1b[1m', OFF = '\x1b[0m';

/* One audio frame at 48k is 1024 samples. astats prints one row per frame,
   whatever `length` says — which is how the first measurement of this came
   out looking flat: the rows were mapped to the wrong times. */
const FRAME_S = 1024 / 48000;

function ffmpeg(args) {
  const r = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  if (r.error || r.status !== 0) {
    console.log(`${RED}ffmpeg failed${OFF}\n${r.stderr || r.error}`);
    process.exit(1);
  }
}

async function main() {
  if (spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status !== 0) {
    console.log(`${RED}No ffmpeg on PATH.${OFF} This check measures real audio; it cannot be faked.`);
    process.exit(1);
  }

  const { plan, DUCK_DB, GAP_S, LEAD_S, TAIL_S } = await import('../src/ducking.ts');

  /*
   * TWO WORDS 0.2s APART, THEN A REAL PAUSE, THEN ONE MORE.
   *
   * The 0.2s gap is the test: it is shorter than GAP_S, so the two words are
   * one run and the bed must stay DOWN across it. The 2.8s pause is longer,
   * so the bed must come back up. One fixture, both directions.
   */
  const words = [{ s: 2.0, e: 2.5 }, { s: 2.7, e: 3.2 }, { s: 6.0, e: 6.5 }];
  const p = plan(words, 9);
  if (!p.expr) {
    console.log(`${RED}no expression for a normal take${OFF}: ${p.why}`);
    process.exit(1);
  }
  if (p.runs.length !== 2) {
    console.log(`${RED}expected 2 runs, got ${p.runs.length}${OFF} — the anti-pump merge is wrong`);
    process.exit(1);
  }

  const dir = mkdtempSync(join(tmpdir(), 'duck-'));
  try {
    const log = join(dir, 'rms.txt');
    ffmpeg([
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=9:sample_rate=48000',
      '-af',
      `volume=volume='${p.expr}':eval=frame,astats=metadata=1:reset=1,` +
        `ametadata=print:key=lavfi.astats.Overall.RMS_level:file=${log}`,
      '-f', 'null', '-',
    ]);

    const rms = readFileSync(log, 'utf8')
      .split('\n')
      .filter((l) => l.includes('RMS_level'))
      .map((l) => Number(l.split('=')[1]));
    if (rms.length < 100) {
      console.log(`${RED}only ${rms.length} frames measured${OFF} — the filter did not run`);
      process.exit(1);
    }

    const at = (t) => rms[Math.round(t / FRAME_S)];
    const open = at(0.5);

    /*
     * Every claim as a measurement, with the tolerance named. ±1.5 dB,
     * because the RMS of a sine inside one 21ms frame wobbles by a few
     * tenths and a tighter bound would fail on arithmetic rather than on
     * anything about the duck.
     */
    const want = open + DUCK_DB;
    const checks = [
      ['full level before any word', at(1.5), open, 1.5],
      ['ducked under the first word', at(2.1), want, 1.5],
      [`STAYS ducked in the ${(2.7 - 2.5).toFixed(1)}s gap (the anti-pump rule)`, at(2.6), want, 1.5],
      ['ducked under the second half of the run', at(3.0), want, 1.5],
      ['back to full level after the tail', at(4.0), open, 1.5],
      ['full level through the long pause', at(5.0), open, 1.5],
      ['ducked under the last word', at(6.2), want, 1.5],
      ['back to full level at the end', at(8.5), open, 1.5],
    ];

    console.log(`${BOLD}duck by word timings${OFF} ${DIM}— ${p.why}${OFF}`);
    console.log(
      `${DIM}  words at 2.0-2.5, 2.7-3.2, 6.0-6.5 · gap rule ${GAP_S}s · lead ${LEAD_S}s · tail ${TAIL_S}s${OFF}`,
    );

    let bad = 0;
    for (const [what, got, expected, tol] of checks) {
      const ok = Number.isFinite(got) && Math.abs(got - expected) <= tol;
      if (!ok) bad += 1;
      console.log(
        `  ${ok ? `${GREEN}✔${OFF}` : `${RED}✘${OFF}`} ${what.padEnd(48)} ` +
          `${DIM}measured${OFF} ${String(got?.toFixed(2)).padStart(7)} dB ` +
          `${DIM}wanted${OFF} ${expected.toFixed(2)} ±${tol}`,
      );
    }

    /* And the ramps actually ramp, rather than stepping — a step at the edge
       of a word is audible as a click in the bed. */
    const rampIn = at(1.9);
    const rampedIn = rampIn < open - 1 && rampIn > want + 1;
    console.log(
      `  ${rampedIn ? `${GREEN}✔${OFF}` : `${RED}✘${OFF}`} ${'the lead-in ramps rather than steps'.padEnd(48)} ` +
        `${DIM}measured${OFF} ${rampIn.toFixed(2).padStart(7)} dB ${DIM}between${OFF} ${want.toFixed(1)} and ${open.toFixed(1)}`,
    );
    if (!rampedIn) bad += 1;

    if (bad) {
      console.log(`\n${RED}${bad} measurement(s) wrong.${OFF} The bed is not where the words say it should be.`);
      process.exit(1);
    }
    console.log(`\n${GREEN}The bed moves where the words are, and stays down across a short gap.${OFF}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main();
