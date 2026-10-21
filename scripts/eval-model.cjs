#!/usr/bin/env node
/*
 * SCORE A MODEL AGAINST THE ADVERSARIAL SET.
 *
 * CLAUDE.md: every model call is "gated by the eval set before a model swap".
 * There was never a set, so every model in this product was chosen on price
 * and plausibility. This is the thing that turns a candidate model into a
 * number.
 *
 *   npm run eval:model                                   the shipping judge
 *   npm run eval:model -- --model @cf/cloudflare/clairic  a candidate
 *   npm run eval:model -- --model X --against Y           two of them
 *
 * It runs the SHIPPING judge through /api/eval/score and overrides only which
 * model answers, because an eval against a reimplementation measures the
 * reimplementation.
 *
 * Needs a dev server and an owner login to name a model. Not part of
 * `npm run check`: it spends money on every run, and a gate rule that bills
 * somebody for pressing it is a gate rule nobody presses.
 */
const { readFileSync } = require('fs');
const { join } = require('path');

const RED = '\x1b[31m', GREEN = '\x1b[32m', DIM = '\x1b[2m', BOLD = '\x1b[1m', OFF = '\x1b[0m';
const ROOT = join(__dirname, '..');
const BASE = process.env.BASE || 'http://localhost:8787';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};

const FILE = arg('file') ?? 'eval/adversarial.jsonl';

function load() {
  return readFileSync(join(ROOT, FILE), 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

/* The labels are per clip and may repeat per labeller; the truth is what they
   agreed, and a disputed pair is excluded rather than scored against whichever
   answer the model happened to match. */
function truthOf(claim) {
  const byClip = new Map();
  for (const j of claim.judgements) {
    const seen = byClip.get(j.clipId);
    if (seen === undefined) byClip.set(j.clipId, j.verdict);
    else if (seen !== j.verdict) byClip.set(j.clipId, null);
  }
  return byClip;
}

async function score(model, claims, cookie) {
  const predictions = [];
  let asked = 0;
  /* How often one call did not cover the moments it was shown. A number
     worth watching per model: it is the shape of failure that reads as
     caution in every other line of this report. */
  let reasked = 0;
  for (const claim of claims) {
    const truth = truthOf(claim);
    const candidates = [...new Set(claim.judgements.map((j) => j.clipId))].map((id) => {
      const j = claim.judgements.find((x) => x.clipId === id);
      return { id, quote: j.quote, sourceTitle: j.sourceTitle };
    });

    const res = await fetch(`${BASE}/api/eval/score`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ claim: claim.claim, candidates, ...(model ? { model } : {}) }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`${res.status} on "${claim.claimId}": ${detail.slice(0, 160)}`);
    }
    const out = await res.json();
    asked += 1;
    if (out.reasked) reasked += 1;
    for (const j of out.judgements) {
      const t = truth.get(j.clipId);
      if (t === null || t === undefined) continue; /* disputed or unknown */
      predictions.push({
        claimId: claim.claimId,
        clipId: j.clipId,
        said: j.verdict,
        truth: t,
        category: claim.category,
        downgraded: j.downgraded,
        answered: j.answered !== false,
      });
    }
  }
  return { predictions, asked, reasked };
}

const pct = (n) => (n === null ? '  —  ' : `${(n * 100).toFixed(1)}%`);

function report(label, predictions, reasked = 0) {
  const said = predictions.filter((p) => p.said === 'backs');
  const wrong = said.filter((p) => p.truth !== 'backs');
  const rate = said.length ? wrong.length / said.length : null;

  /* The other direction: real support it refused. A model with no false
     support and no true support is a model that says no to everything. */
  const real = predictions.filter((p) => p.truth === 'backs');
  const missed = real.filter((p) => p.said !== 'backs');

  console.log(`\n${BOLD}${label}${OFF}`);
  console.log(`  said "backs" ${said.length} time(s); ${wrong.length} of those were not support`);
  console.log(`  false support: ${rate !== null && rate > 0 ? RED : GREEN}${pct(rate)}${OFF}`);
  console.log(
    `  real support refused: ${missed.length} of ${real.length}` +
      `${missed.length === real.length && real.length > 0 ? `  ${RED}← it refuses everything${OFF}` : ''}`,
  );

  const cats = [...new Set(predictions.map((p) => p.category))].sort();
  console.log(`${DIM}  by how the miss was near:${OFF}`);
  for (const cat of cats) {
    const mine = predictions.filter((p) => p.category === cat);
    const s = mine.filter((p) => p.said === 'backs');
    const w = s.filter((p) => p.truth !== 'backs').length;
    const r = mine.length ? w / mine.length : null;
    const mark = w > 0 ? `${RED}✘${OFF}` : `${GREEN}✔${OFF}`;
    console.log(`    ${mark} ${cat.padEnd(16)} ${w}/${mine.length} wrong`);
  }
  /*
   * WHAT IT REFUSED, NAMED. The rate says a model is over-cautious; this says
   * on what, which is the difference between knowing there is a problem and
   * being able to do something about it. Printed for real support only —
   * false support is already listed above and a dump of everything is a
   * report nobody reads twice.
   */
  if (missed.length) {
    console.log(`${DIM}  real support it would not call support:${OFF}`);
    for (const m of missed) {
      /* NOT ANSWERED AT ALL is a different fault from answered wrongly, and
         the scored verdict is the same word for both. Saying which one it
         was is the difference between a prompt that needs loosening and a
         call that silently returned a shorter list. */
      const how = m.answered ? `it said "${m.said}"` : `it never answered — scored "${m.said}"`;
      console.log(`    ${RED}✘${OFF} ${m.claimId}/${m.clipId} ${DIM}— ${how}${OFF}`);
    }
  }

  const silent = predictions.filter((p) => !p.answered).length;
  if (silent || reasked) {
    console.log(
      `${DIM}  (${reasked} claim(s) needed a second ask; ${silent} clip(s) still unanswered after it)${OFF}`,
    );
  }

  /*
   * A PERFECT SCORE IS A WARNING. The set exists to say which of two models
   * is wrong less often, and one that nothing gets wrong cannot. Printing
   * that in green would be the report congratulating its own author — which
   * is what the first green run nearly was, three bugs deep.
   */
  if (!wrong.length && !missed.length && predictions.length) {
    console.log(
      `  ${RED}the set is saturated${OFF} — ${predictions.length}/${predictions.length} right, so it ` +
        `cannot rank\n  two models. It needs harder cases before a green run licenses anything.`,
    );
  }

  const downgraded = predictions.filter((p) => p.downgraded).length;
  if (downgraded) {
    console.log(`${DIM}  (the structural rule downgraded ${downgraded} "backs" that pointed at nothing)${OFF}`);
  }
  return rate;
}

async function main() {
  const claims = load();
  const model = arg('model');
  const against = arg('against');

  /* The dev login is a cookie, and the owner check on the route is what makes
     naming a model privileged. Fetched once so one failure explains itself. */
  const home = await fetch(`${BASE}/`, { redirect: 'manual' }).catch(() => null);
  if (!home) {
    console.log(`${RED}No dev server at ${BASE}.${OFF} Run: npx wrangler dev --port 8787 --enable-containers=false`);
    process.exit(1);
  }
  const cookie = (home.headers.get('set-cookie') ?? '').split(';')[0] || '';

  console.log(`${FILE}: ${claims.length} claims`);
  const a = await score(model, claims, cookie);
  const rateA = report(model ?? 'the shipping judge', a.predictions, a.reasked);

  if (against) {
    const b = await score(against, claims, cookie);
    const rateB = report(against, b.predictions, b.reasked);
    const { compare } = await import('../src/eval-adversarial.ts');
    console.log(`\n${compare({ model: model ?? 'the shipping judge', rate: rateA }, { model: against, rate: rateB })}`);
  } else {
    console.log(
      `\n${DIM}A worst case on one author's labels. It can say which of two models is wrong\n` +
        `less often; it cannot say a model is good enough. See eval/README.md.${OFF}`,
    );
  }
}

main().catch((err) => {
  console.error(`${RED}${err.message}${OFF}`);
  process.exit(1);
});
