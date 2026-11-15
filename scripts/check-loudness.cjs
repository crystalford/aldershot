#!/usr/bin/env node
/*
 * LOUDNESS, MEASURED RATHER THAN ASSERTED.
 *
 * Phase 6 accepts on "loudness measures within ±1 LU of target on three test
 * mixes". Not "the filter string contains -14" — measured, on real audio, by
 * the same ffmpeg the container runs. So this builds three mixes that are
 * wrong in three different directions, normalises each with the one filter
 * string src/loudness.ts exports, and measures what came out.
 *
 * THE THREE ARE CHOSEN TO FAIL DIFFERENTLY. A quiet one that has to be lifted,
 * a hot one that has to be pulled down and held under the ceiling, and a wide
 * one whose loud passage would drag the average up if the measurement were
 * peak-based rather than integrated. Three copies of the same signal would
 * pass three times and prove once.
 *
 * It needs ffmpeg on PATH and is not part of `npm run check` for that reason —
 * check.sh already skips the editor and strings rules when their dependency is
 * missing, and a gate rule that silently passes when its tool is absent is the
 * thing this repo keeps catching. Run: npm run check:loudness
 */
const { execFileSync, spawnSync } = require('child_process');
const { mkdtempSync, rmSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');

const RED = '\x1b[31m', GREEN = '\x1b[32m', DIM = '\x1b[2m', OFF = '\x1b[0m';

/*
 * BOTH STREAMS, ALWAYS.
 *
 * ffmpeg writes everything worth reading to stderr — including the loudnorm
 * JSON this whole check turns on — and execFileSync returns only stdout on
 * success. The first version of this used it and reported "could not measure
 * the output at all" for three mixes that had measured perfectly well: the
 * numbers were there, in the stream nobody was reading.
 */
function ffmpegRun(args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
}

try {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
} catch {
  console.log(`⚠ loudness — SKIPPED: no ffmpeg on PATH.`);
  process.exit(0);
}

/* The targets come from the module the container imports, never retyped. */
const src = require('fs').readFileSync(join(__dirname, '..', 'src', 'loudness.ts'), 'utf8');
const pick = (name) => {
  const m = src.match(new RegExp(`export const ${name} = (-?[\\d.]+)`));
  if (!m) throw new Error(`src/loudness.ts no longer exports ${name}`);
  return Number(m[1]);
};
/*
 * DOC 09'S OWN NUMBERS, WRITTEN HERE AND NOWHERE ELSE.
 *
 * Without these the check reads its target from the module and then measures
 * against the same target, so it proves only that loudnorm hits whatever
 * number it is asked for — which it does, every time. Set TARGET_LUFS to -20
 * and three mixes land at -20 and the check prints three green ticks.
 * Measured on purpose: that is exactly what it did before this block existed.
 *
 * So the handoff's numbers are transcribed here as an independent copy, and
 * the module is checked against THEM before anything is encoded. Two copies
 * of a number is normally a smell; a check that shares its expected value
 * with the thing it checks is not a check at all.
 */
const DOC_09 = { lufs: -14, ceilingDbtp: -1, toleranceLu: 1 };

const TARGET_LUFS = pick('TARGET_LUFS');
const TOLERANCE_LU = pick('TOLERANCE_LU');
const CEILING_DBTP = pick('CEILING_DBTP');
const NORMALISE_TO_DBTP = pick('NORMALISE_TO_DBTP');
const TARGET_LRA = pick('TARGET_LRA');
const LOUDNORM = `loudnorm=I=${TARGET_LUFS}:TP=${NORMALISE_TO_DBTP}:LRA=${TARGET_LRA}`;

const DUR = 20;
const MIXES = [
  {
    name: 'quiet room',
    why: 'speech recorded low — has to be lifted about 20 LU',
    /* Noise shaped to speech-ish band, well below target. */
    gen: ['-f', 'lavfi', '-i',
      `anoisesrc=d=${DUR}:c=pink:a=0.03,highpass=f=120,lowpass=f=4000,volume=-18dB`],
  },
  {
    name: 'hot master',
    why: 'already slammed — has to come down and stay under the ceiling',
    gen: ['-f', 'lavfi', '-i',
      `anoisesrc=d=${DUR}:c=pink:a=0.9,highpass=f=80,acompressor=threshold=-12dB:ratio=8,volume=3dB`],
  },
  {
    name: 'wide dynamics',
    why: 'quiet passage then a loud one — integrated, not peak',
    gen: ['-f', 'lavfi', '-i',
      `anoisesrc=d=${DUR}:c=pink:a=0.5,highpass=f=100,volume='if(lt(t,10),0.05,1.0)':eval=frame`],
  },
];

const drift = [];
if (TARGET_LUFS !== DOC_09.lufs) drift.push(`target is ${TARGET_LUFS} LUFS, doc 09 asks for ${DOC_09.lufs}`);
if (CEILING_DBTP !== DOC_09.ceilingDbtp) drift.push(`ceiling is ${CEILING_DBTP} dBTP, doc 09 asks for ${DOC_09.ceilingDbtp}`);
if (TOLERANCE_LU !== DOC_09.toleranceLu) drift.push(`tolerance is ${TOLERANCE_LU} LU, Phase 6 accepts at ±${DOC_09.toleranceLu}`);
if (NORMALISE_TO_DBTP >= CEILING_DBTP) {
  drift.push(`the filter aims at ${NORMALISE_TO_DBTP} dBTP, which is not below the ${CEILING_DBTP} dBTP ceiling it has to land under after encoding`);
}
if (drift.length) {
  console.log(`${RED}✘ loudness — src/loudness.ts has drifted from the handoff${OFF}`);
  for (const d of drift) console.log(`    ${d}`);
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), 'aldershot-loud-'));
let bad = 0;

console.log(`loudness — target ${TARGET_LUFS} LUFS ±${TOLERANCE_LU} LU, peaks under ${CEILING_DBTP} dBTP`);
console.log(`${DIM}  filter: ${LOUDNORM}${OFF}`);

for (const mix of MIXES) {
  const raw = join(dir, `${mix.name.replace(/\W/g, '-')}.wav`);
  const out = join(dir, `${mix.name.replace(/\W/g, '-')}.m4a`);

  ffmpegRun(['-y', ...mix.gen, '-ar', '48000', '-ac', '2', raw]);

  /*
   * Normalise, then ENCODE TO AAC, because that is what an export is. The
   * encoder is where true peak moves, and measuring the wav would be
   * measuring a file nobody receives.
   */
  ffmpegRun(['-y', '-i', raw, '-af', LOUDNORM, '-c:a', 'aac', '-b:a', '192k', out]);

  const measured = ffmpegRun(['-i', out, '-af', 'loudnorm=print_format=json', '-f', 'null', '-']);
  const block = measured.match(/\{[^{}]*"input_i"[\s\S]*?\}/);
  if (!block) {
    console.log(`  ${RED}✘${OFF} ${mix.name} — could not measure the output at all`);
    bad += 1;
    continue;
  }
  const j = JSON.parse(block[0]);
  const lufs = Number(j.input_i);
  const tp = Number(j.input_tp);

  const off = lufs - TARGET_LUFS;
  const loudOk = Number.isFinite(lufs) && Math.abs(off) <= TOLERANCE_LU;
  const peakOk = Number.isFinite(tp) && tp <= CEILING_DBTP;
  const ok = loudOk && peakOk;
  if (!ok) bad += 1;

  console.log(
    `  ${ok ? GREEN + '✔' : RED + '✘'}${OFF} ${mix.name.padEnd(15)} ` +
      `${lufs.toFixed(1)} LUFS (${off >= 0 ? '+' : ''}${off.toFixed(1)} LU)  ` +
      `peak ${tp.toFixed(1)} dBTP  ${DIM}${mix.why}${OFF}`,
  );
  if (!loudOk) console.log(`      ${RED}off target by more than ${TOLERANCE_LU} LU${OFF}`);
  if (!peakOk) console.log(`      ${RED}peak above the ${CEILING_DBTP} dBTP ceiling${OFF}`);
}

rmSync(dir, { recursive: true, force: true });

if (bad) {
  console.log(`\n${RED}✘ loudness — ${bad} of ${MIXES.length} mixes outside the numbers doc 09 names${OFF}`);
  process.exit(1);
}
console.log(`\n${GREEN}✔ loudness — ${MIXES.length} mixes, all within ±${TOLERANCE_LU} LU and under the ceiling${OFF}`);
