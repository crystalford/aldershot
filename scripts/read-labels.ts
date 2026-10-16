#!/usr/bin/env node
/**
 * WHAT DOES THE SCORER ACTUALLY KNOW, AND WHAT CAN WE CHECK IT AGAINST?
 *
 *   npm run labels                 reads the LOCAL dev database
 *   npm run labels -- --remote     reads production, read-only, prints the SQL first
 *
 * The research pass asked for this first and for the right reason: everything
 * downstream of src/score.ts is bounded by it, and nothing in this codebase has
 * ever checked whether its 0-100 `score` tracks anything a person did. It
 * suggested joining `score` against `kept` and `used_count`.
 *
 * BOTH OF THOSE ARE TRAPS, which is the first thing this script exists to say.
 *
 * `kept` is written as 1 by saveClips for every clip the scorer emits, and only
 * setKept — one toggle in Footage — ever moves it. So `kept = 1` means "nobody
 * has removed this", which is the default state of everything. Correlating a
 * score against it measures almost nothing, and would come back looking fine.
 *
 * `used_count` is worse: it is written as 0 at insert and NOTHING increments
 * it, anywhere. The footage card that reads "used in 2 essays" cannot ever
 * render. Correlating against it is correlating against a constant.
 *
 * WHAT WE HAVE INSTEAD, and it is better than either. `beats.clip_id` records
 * every clip ever pulled into an edit, and `beats.struck` records whether it
 * survived there. A clip struck inside an edit is the best negative label in
 * the database, because that decision was made with the clip in context, next
 * to its alternatives — which is exactly the judgement the scorer is trying to
 * predict. A clip in an unstruck beat of a project that reached a render has
 * shipped, and that is the best positive.
 *
 * AND ONE MEASUREMENT THAT NEEDS NO LABELS AT ALL. The scoring prompt says a
 * moment that starts mid-sentence or needs context "is not a good moment
 * however interesting it sounds", and scores it low. src/portability.ts checks
 * that mechanically. So the flag rate inside the top score band is a direct
 * test of whether the model obeys its own first two rules — available today,
 * on every clip already in the library, with nobody having to decide anything.
 */

import { execSync } from "node:child_process";
import { hardFlags } from "../src/portability.ts";

const REMOTE = process.argv.includes("--remote");
const CAP = Number(process.argv[process.argv.indexOf("--limit") + 1]) || 5000;

/** Mirrors blocks.ts: struck is truthy AND not the string "0". */
const NOT_STRUCK = `(b.struck IS NULL OR b.struck = '' OR b.struck = '0')`;

const CENSUS = `
  SELECT c.id, c.score, c.heat, c.quote, c.kept, c.used_count,
         (c.deleted_at IS NOT NULL) AS binned,
         (SELECT COUNT(*) FROM beats b WHERE b.clip_id = c.id) AS pulled,
         (SELECT COUNT(*) FROM beats b WHERE b.clip_id = c.id AND ${NOT_STRUCK}) AS live,
         (SELECT COUNT(*) FROM beats b
            JOIN renders r ON r.project_id = b.project_id
           WHERE b.clip_id = c.id AND ${NOT_STRUCK} AND r.r2_key IS NOT NULL) AS shipped
    FROM v2_clips c
   ORDER BY c.created_at DESC LIMIT ${CAP}`;

interface Row {
  id: string;
  score: number | null;
  heat: number | null;
  quote: string;
  kept: number;
  used_count: number;
  binned: number;
  pulled: number;
  live: number;
  shipped: number;
}

/**
 * Area under the ROC curve, by ranks, with ties averaged.
 *
 * Exported and tested because it is six lines of arithmetic whose wrong
 * versions all return plausible numbers near 0.5 — and a wrong 0.58 here would
 * be read as "the scorer is weak but working" when it might mean nothing at
 * all. Ties matter: `score` is a 0-100 integer a model picks round numbers
 * from, so dozens of clips share a value, and a tie-blind implementation turns
 * their arbitrary row order into signal.
 */
export function auc(positives: number[], negatives: number[]): number | null {
  if (!positives.length || !negatives.length) return null;
  const all = [...positives.map((v) => ({ v, pos: true })), ...negatives.map((v) => ({ v, pos: false }))];
  all.sort((a, b) => a.v - b.v);

  /* Average rank within each run of equal values, so a tie contributes 0.5. */
  const ranks = new Array<number>(all.length);
  for (let i = 0; i < all.length; ) {
    let j = i;
    while (j < all.length && all[j].v === all[i].v) j++;
    const shared = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) ranks[k] = shared;
    i = j;
  }

  let sum = 0;
  for (let i = 0; i < all.length; i++) if (all[i].pos) sum += ranks[i];
  const n = positives.length;
  return (sum - (n * (n + 1)) / 2) / (n * negatives.length);
}

/** Enough of both classes for a number to mean anything. Judgement, stated. */
const ENOUGH = 12;

const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(0).padStart(3) : "  -") + "%";
const pad = (s: string | number, n: number) => String(s).padStart(n);

function d1(sql: string): Row[] {
  const flat = sql.replace(/\s+/g, " ").trim();
  const where = REMOTE ? "--remote" : "--local";
  try {
    const raw = execSync(
      `npx wrangler d1 execute aldershot ${where} --json --command ${JSON.stringify(flat)}`,
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 },
    );
    return (JSON.parse(raw) as Array<{ results?: Row[] }>)[0]?.results ?? [];
  } catch (err) {
    const e = err as { stdout?: string; message?: string };
    throw new Error(`D1 query failed\n  ${(e.stdout ?? "").trim() || e.message}`);
  }
}

function main() {
  if (REMOTE) {
    /*
     * Said out loud before it runs. The owner ruled out remote D1 access when
     * he briefed the audit, so a script that can reach production says exactly
     * what it will send and that it only reads.
     */
    console.log("\n  Reading PRODUCTION, read-only. One SELECT, no writes:\n");
    console.log("  " + CENSUS.replace(/\s+/g, " ").trim().slice(0, 300) + " …\n");
  }

  const rows = d1(CENSUS);
  if (!rows.length) {
    console.log("\n⚠ no clips. Score a video, or run without --remote against a seeded local DB.\n");
    return;
  }

  /* ------------------------------------------------------------------ census */
  const shipped = rows.filter((r) => r.shipped > 0);
  const struckInEdit = rows.filter((r) => r.pulled > 0 && r.live === 0);
  const pulled = rows.filter((r) => r.pulled > 0);
  const removed = rows.filter((r) => !r.kept || r.binned);
  const untouched = rows.filter((r) => r.kept && !r.binned && r.pulled === 0);

  console.log(`\n  ${rows.length} clips read${rows.length === CAP ? ` (capped at ${CAP})` : ""}\n`);
  console.log("  WHAT DECISIONS EXIST\n");
  console.log(`    shipped in a render      ${pad(shipped.length, 6)}   strongest positive`);
  console.log(`    pulled into an edit      ${pad(pulled.length, 6)}`);
  console.log(`    struck inside an edit    ${pad(struckInEdit.length, 6)}   strongest negative`);
  console.log(`    removed from the library ${pad(removed.length, 6)}`);
  console.log(`    never touched            ${pad(untouched.length, 6)}   ${pct(untouched.length, rows.length)} — NO signal`);

  const usedCountWrong = rows.every((r) => r.used_count === 0);
  if (usedCountWrong) {
    console.log("\n    ! used_count is 0 on every row. Nothing in src/ increments it, so the");
    console.log("      'used in N essays' line in Footage can never render, and the research");
    console.log("      pass's suggestion to correlate against it has nothing to correlate.");
  }

  /* --------------------------------------------- the measurement with no labels */
  const withScore = rows.filter((r) => typeof r.score === "number");
  console.log("\n  DOES THE SCORER OBEY ITS OWN FIRST TWO RULES?\n");
  console.log("    score.ts: a moment that starts mid-sentence or needs context it has not");
  console.log("    shown 'is not a good moment however interesting it sounds'.\n");
  console.log("    band      n    mid-sent   dangling   either     e.g.");

  const bands: Array<[string, (s: number) => boolean]> = [
    ["90-100", (s) => s >= 90],
    ["80-89 ", (s) => s >= 80 && s < 90],
    ["60-79 ", (s) => s >= 60 && s < 80],
    ["  < 60", (s) => s < 60],
  ];
  for (const [label, inBand] of bands) {
    const band = withScore.filter((r) => inBand(r.score as number));
    if (!band.length) {
      console.log(`    ${label} ${pad(0, 5)}          —          —        —`);
      continue;
    }
    const hard = band.map((r) => ({ r, f: hardFlags(r.quote) }));
    const mid = hard.filter((h) => h.f.some((f) => f.kind !== "opens-on-dangling-reference"));
    const dang = hard.filter((h) => h.f.some((f) => f.kind === "opens-on-dangling-reference"));
    const any = hard.filter((h) => h.f.length);
    const worst = any[0];
    console.log(
      `    ${label} ${pad(band.length, 5)}      ${pct(mid.length, band.length)}       ${pct(dang.length, band.length)}     ${pct(any.length, band.length)}` +
        (worst ? `     "${worst.r.quote.slice(0, 38).replace(/\s+/g, " ")}…"` : ""),
    );
  }
  console.log("\n    A rate that does not fall as the band rises means the score is not");
  console.log("    pricing rules 1 and 2 at all, whatever else it is measuring.");

  /* ------------------------------------------------------------------- the AUCs */
  console.log("\n  DOES THE SCORE PREDICT WHAT YOU ACTUALLY DID?\n");
  const pairs: Array<[string, Row[], Row[]]> = [
    ["shipped vs struck-in-edit", shipped, struckInEdit],
    ["pulled vs removed", pulled, removed],
    ["pulled vs never touched", pulled, untouched],
  ];
  for (const [name, pos, neg] of pairs) {
    const of = (rs: Row[], k: "score" | "heat") =>
      rs.map((r) => r[k]).filter((v): v is number => typeof v === "number");
    if (pos.length < ENOUGH || neg.length < ENOUGH) {
      console.log(
        `    ${name.padEnd(26)} — not enough decisions yet (${pos.length} vs ${neg.length}; ` +
          `needs ${ENOUGH} of each).`,
      );
      continue;
    }
    const s = auc(of(pos, "score"), of(neg, "score"));
    const h = auc(of(pos, "heat"), of(neg, "heat"));
    console.log(
      `    ${name.padEnd(26)} score AUC ${s?.toFixed(3) ?? "  n/a"}   heat AUC ${h?.toFixed(3) ?? "  n/a"}   (${pos.length} vs ${neg.length})`,
    );
  }

  /*
   * REFUSING TO PRINT A NUMBER IS THE POINT, not a shortfall.
   *
   * An AUC over four decisions is noise that looks like evidence, and this is
   * the one place in the pipeline where a spurious 0.52 would get read as "the
   * scorer is broken" and send somebody rewriting a prompt that was fine.
   */
  console.log("\n  WHAT THIS CAN AND CANNOT TELL YOU\n");
  console.log("    Every clip here is one the scorer already ACCEPTED, so these numbers can");
  console.log("    only judge how it ranks within what it let through. They can convict the");
  console.log("    scorer and they can never acquit it: if it is throwing the good material");
  console.log("    away before anything reaches this table, all of the above looks healthy.");
  console.log("    Answering that needs an exploration slice — unscored spans mixed in");
  console.log("    unmarked — which is the next build, not this one.\n");
}

if (process.argv[1] && import.meta.filename === process.argv[1]) main();
