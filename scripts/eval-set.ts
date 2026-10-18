#!/usr/bin/env node
/**
 * PHASE 0'S RUNNER: the four numbers, over the set in the repo.
 *
 *   npm run eval:set                      eval/set.jsonl, offline
 *   npm run eval:set -- --file path.jsonl
 *   npm run eval:set -- --live            also re-runs retrieval for recall@5
 *                                         (needs `npx wrangler dev --port 8787`)
 *
 * The acceptance: "the set exists in the repo with a runner that reports
 * recall@5, judge precision/recall per label, false-support rate, and
 * labeller agreement." The arithmetic is in src/eval-metrics.ts, where each
 * figure is pinned to a worked example; this reads the file, runs what can
 * be run today, and says plainly what cannot.
 *
 * WHAT CANNOT, TODAY: the judge. The three-way judge is Phase 4 and does not
 * exist yet, so the two figures that measure IT are reported as waiting
 * rather than as zero. A runner that printed 0.00 for a judge that has never
 * been written would be a number somebody could quote.
 *
 * TypeScript and typechecked, like scripts/eval-retrieval.ts, and for the
 * reason that file gives: an evaluation harness that is not itself checked
 * is a thing that reports numbers nobody has any reason to believe.
 */

import { readFileSync, existsSync } from "node:fs";
import {
  agreement,
  backingOf as backingFrom,
  falseSupportRate,
  perLabel,
  recallAt,
  type Prediction,
  type RankedClaim,
} from "../src/eval-metrics.ts";

/** This claim's backing moments. See backingOf: only what everyone who
    looked called `backs`. */
const backingOf = (c: Claim) => backingFrom(c.judgements);

import { VERDICTS, labellersIn, setProgress, type Verdict } from "../src/eval-set.ts";

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};

const FILE = arg("file") ?? "eval/set.jsonl";
const LIVE = process.argv.includes("--live");
const BASE = process.env.BASE || "http://localhost:8787";
const K = Number(arg("k")) || 5;

interface Judgement {
  clipId: string;
  labeller: string;
  verdict: Verdict;
  quote?: string;
  span?: [number, number] | null;
}
interface Machine {
  clipId: string;
  verdict: Verdict;
  raw: Verdict;
  downgraded: boolean;
  version: string;
}
interface Claim {
  claimId: string;
  claim: string;
  judgements: Judgement[];
  /** What the judge said, when it has been asked. */
  machine?: Machine[];
}

function load(path: string): Claim[] {
  if (!existsSync(path)) {
    console.log(`⚠ eval-set — no set at ${path}.`);
    console.log("  Label in the app at /eval, then: curl -o eval/set.jsonl .../api/eval/export");
    process.exit(0);
  }
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l, i) => {
      try {
        return JSON.parse(l) as Claim;
      } catch {
        throw new Error(`${path} line ${i + 1} is not JSON`);
      }
    });
}

const pct = (n: number | null) => (n === null ? "  —  " : `${(n * 100).toFixed(1)}%`);

async function main() {
  const claims = load(FILE);
  const flat = claims.flatMap((c) =>
    c.judgements.map((j) => ({ claimId: c.claimId, clipId: j.clipId, labeller: j.labeller })),
  );
  const progress = setProgress(flat);

  console.log(`\nTHE SET — ${FILE}`);
  console.log(`  ${claims.length} claims · ${progress.judgements} judgements · ${progress.labellers.length} labeller(s): ${progress.labellers.join(", ") || "none"}`);
  /*
   * THE NEGATIVES, COUNTED SEPARATELY. A set made only of claims that found
   * something teaches a threshold that something is always there, and
   * "nothing here backs this" has to be a reachable answer (invariant 4).
   */
  const unbacked = claims.filter((c) => backingOf(c).length === 0).length;
  console.log(`  ${unbacked} claim(s) nothing backs — the set's negatives`);
  console.log(`  ${progress.doubleJudged} moment(s) judged by more than one person`);

  /* ── Labeller agreement ─────────────────────────────────────────────── */

  console.log(`\nAGREEMENT`);
  const people = labellersIn(flat);
  if (people.length < 2) {
    console.log("  —  one labeller, so there is nobody to agree with.");
  } else {
    for (let i = 0; i < people.length; i += 1) {
      for (let j = i + 1; j < people.length; j += 1) {
        const pick = (who: string) =>
          new Map(
            claims.flatMap((c) =>
              c.judgements
                .filter((x) => x.labeller === who)
                .map((x) => [`${c.claimId}\u0000${x.clipId}`, x.verdict] as [string, Verdict]),
            ),
          );
        const a = agreement(pick(people[i]), pick(people[j]), VERDICTS);
        const kappa = a.kappa === null ? "  —  " : a.kappa.toFixed(2);
        /* Below about 0.6 the set is measuring the labellers rather than
           the system, and no number taken against it means anything yet. */
        const verdict = a.kappa === null ? "" : a.kappa >= 0.6 ? "  (sound)" : "  (the guidance needs work)";
        console.log(`  ${people[i]} vs ${people[j]}: ${a.same}/${a.both} the same · kappa ${kappa}${verdict}`);
      }
    }
  }

  /* ── Recall@k ───────────────────────────────────────────────────────── */

  console.log(`\nRECALL@${K}`);
  if (!LIVE) {
    console.log("  —  needs retrieval. Re-run with --live and a dev server.");
  } else {
    /*
     * THROUGH THE LABELLING PAGE, which is the same retrieval the set was
     * built from.
     *
     * /api/search is the nav's quick lookup and is not what produced these
     * candidates; /eval runs findMaterial, which is what the room and the
     * cut use. Measuring a different retriever from the one the labels
     * describe would produce a recall figure about nothing.
     *
     * Scraped rather than fetched as JSON, the same way
     * scripts/eval-retrieval.ts does it and for the same reason: the page
     * renders what a person actually saw, in the order they saw it, and a
     * second endpoint built to be measured is a second thing to keep true.
     */
    /* A SIDE EFFECT WORTH KNOWING ABOUT: /eval writes a claim down the
       first time it sees one, so running this against a set from another
       account adds its claims to the one you are signed in as. Said rather
       than hidden; it is also what makes the page usable from a phone. */
    console.log(`  (asking ${BASE} — claims it has not seen will be written down there)`);
    const ranked: RankedClaim[] = [];
    for (const c of claims) {
      const res = await fetch(`${BASE}/eval?claim=${encodeURIComponent(c.claim)}`, {
        redirect: "manual",
      }).catch(() => null);
      if (!res?.ok) {
        console.log(`  ✘ ${BASE} did not answer, or redirected to sign in.`);
        console.log("     Run `npx wrangler dev --port 8787` with DEV_LOGIN_EMAIL set in .dev.vars.");
        return;
      }
      const html = await res.text();
      /* In document order, which is rank order, and de-duplicated because
         three buttons carry the same clip id. */
      const seen: string[] = [];
      for (const m of html.matchAll(/data-clip="([^"]+)"/g)) {
        if (!seen.includes(m[1])) seen.push(m[1]);
      }
      ranked.push({ claimId: c.claimId, ranked: seen, backing: backingOf(c) });
    }
    const r = recallAt(ranked, K);
    console.log(`  ${r.found} of ${r.of} claims had a backing moment in the top ${K} — ${pct(r.recall)}`);
    console.log(`  (${r.unbacked} claim(s) had nothing to find, and are not counted as misses)`);
    /* The page asks findMaterial for eight, so a k above that measures the
       page's limit rather than the retriever's. Said rather than silently
       capped. */
    if (K > 8) console.log(`  ! k=${K} is above the eight moments the page asks for — the figure is capped by that, not by retrieval.`);
  }

  /* ── The judge ──────────────────────────────────────────────────────── */

  console.log(`\nTHE JUDGE`);
  const predictions: Prediction[] = [];
  let downgraded = 0;
  let disputed = 0;
  /* Machine answers SEEN, as against scored. The two differ and the
     difference is the whole of the message below. */
  let asked = 0;
  let versions = new Set<string>();
  for (const c of claims) {
    const human = new Map<string, Verdict[]>();
    for (const j of c.judgements) human.set(j.clipId, [...(human.get(j.clipId) ?? []), j.verdict]);

    for (const m of c.machine ?? []) {
      const said = human.get(m.clipId);
      if (!said?.length) continue;
      asked += 1;
      if (m.version) versions.add(m.version);
      /*
       * A PAIR THE PEOPLE DISAGREED ABOUT IS NOT SCORED EITHER WAY.
       *
       * The first version held the judge to whichever answer it happened to
       * match, which sounds generous and is the opposite: a near-miss that
       * one labeller called support is PRECISELY the dangerous case, and a
       * rule that lets the judge off exactly there blinds the false-support
       * rate to the cases it exists for. Counted and reported, the same way
       * `backingOf` refuses to call a disputed moment truth.
       */
      /* Counted before the dispute check: a downgrade is a fact about the
         judge, not about whether this pair could be scored. */
      if (m.downgraded) downgraded += 1;
      if (new Set(said).size > 1) {
        disputed += 1;
        continue;
      }
      predictions.push({ claimId: c.claimId, clipId: m.clipId, said: m.verdict, truth: said[0] });
    }
  }

  if (!predictions.length && !asked) {
    console.log("  —  not asked yet. Label at /eval, then press Ask the judge.");
  } else if (!predictions.length) {
    /*
     * ASKED, AND NOTHING COULD BE SCORED — which is a different fact from
     * not having been asked, and the first version of this said the wrong
     * one. Found by running it over a live export whose single judged pair
     * was disputed: the judge had answered and the report said it had not.
     */
    console.log(`  ${asked} answered, and none could be scored.`);
    if (disputed) console.log(`  ${disputed} pair(s) left out — the labellers disagreed, so there is no answer to score against`);
  } else {
    console.log(`  ${predictions.length} judged, version ${[...versions].join(", ") || "unknown"}`);
    const per = perLabel(predictions, VERDICTS);
    for (const label of VERDICTS) {
      const s = per[label];
      console.log(
        `  ${label.padEnd(10)} precision ${pct(s.precision)}  recall ${pct(s.recall)}` +
          `  (said ${s.said}, people said ${s.support})`,
      );
    }
    const fs = falseSupportRate(predictions);
    console.log(`  false support: ${fs.wrong} of ${fs.said} it called backs — ${pct(fs.rate)}`);
    /* Not an error rate: it is the structural abstention in src/judge.ts
       doing its job. A judge that needs it constantly is one to replace. */
    console.log(`  ${downgraded} time(s) it claimed support and could not point at a sentence`);
    if (disputed) {
      console.log(`  ${disputed} pair(s) left out — the labellers disagreed, so there is no answer to score against`);
    }
  }
  console.log();
}

main().catch((e) => {
  console.error(`eval-set: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
