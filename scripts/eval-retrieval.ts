#!/usr/bin/env node
/**
 * HOW GOOD IS MEANING SEARCH, ON YOUR OWN LIBRARY?
 *
 *   npm run eval                 needs `npx wrangler dev --port 8787` running
 *   npm run eval -- --limit 50
 *   npm run eval -- --exact      the keyword baseline meaning search must beat
 *
 * TypeScript, and typechecked, because test/eval-retrieval.test.ts imports the
 * scoring out of it. An evaluation harness that is not itself checked is a
 * thing that reports numbers nobody has any reason to believe.
 *
 * Every retrieval decision after this one — window size, embedding model,
 * context prefixes, a reranker, raw transcript versus clips — is a guess until
 * something measures it. This is that something, and it uses labels the
 * product already has rather than any we would have to invent.
 *
 * THE LABELS. A kept clip is a moment a person chose out of a whole video.
 * That is a relevance judgement, made by the only judge who counts, and there
 * are already thousands of them. The research pass suggested generating a
 * query for each kept clip with an LLM; we do not need to, because `why` is
 * already a short natural-language description of the moment, written at
 * scoring time by a different call with a different purpose.
 *
 * SO THE MEASUREMENT IS: query with `why`, and see whether the clip whose
 * `why` it is comes back.
 *
 * That is only honest because `why` is deliberately NOT part of what gets
 * embedded — see clipText in src/embeddings.ts and the test that pins it. If
 * somebody ever adds it to the vector, this script will report superb numbers
 * that mean nothing, which is why the pinning test exists.
 *
 * WHAT IT DOES NOT MEASURE. Whether `why` resembles what a person would
 * actually type. It is a model's phrasing of a moment, so these numbers are
 * an upper bound on real-world recall, not a prediction of it. Treat them as
 * a way to COMPARE pipeline variants, which is what they are good for, and
 * not as a claim about how well search works for a human.
 *
 * WHY --exact EXISTS. A recall figure with nothing beside it cannot justify
 * anything: 60% might be excellent or might be worse than the keyword search
 * the product already had. --exact runs the identical labels through the
 * existing word search, which is the thing meaning search has to beat to be
 * worth its cost. Expect it to be close to nothing, because a `why` is a
 * description and word search can only find words that were actually said —
 * but measure it rather than assuming it.
 */

const BASE = process.env.BASE || "http://localhost:8787";
const LIMIT = Number(process.argv[process.argv.indexOf("--limit") + 1]) || 100;
const MODE = process.argv.includes("--exact") ? "exact" : "meaning";

/*
 * @60 is not an arbitrary big number: searchMeaning asks Vectorize for topK 60
 * and the page renders what it gets, so 60 IS the whole result set. recall@60
 * is therefore "did the clip come back at all", and the gap between @10 and
 * @60 is how much a reranker could still win.
 */
const AT = [1, 5, 10, 25, 60];

const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1).padStart(5) : "  n/a") + "%";

/* Each moment card carries data-moment="<clip id>"; src/ui/pages/footage.ts. */
export const idsIn = (html: string): string[] =>
  [...html.matchAll(/data-moment="([^"]+)"/g)].map((m) => m[1]);
const NO_INDEX = /Meaning search isn't switched on yet/;

/**
 * recall@k and MRR from a list of ranks, where null is "never came back".
 *
 * Six lines of arithmetic, pulled out and exported because every one of them
 * has a classic off-by-one in it — @k is rank < k and not rank <= k, and the
 * MRR denominator is every query asked and not only the ones that found
 * something. Both mistakes make the numbers look better and neither one looks
 * like a bug. test/eval-retrieval.test.ts pins them.
 */
export interface Tally {
  n: number;
  hits: Record<number, number>;
  missing: number;
  mrr: number;
}

export function tally(ranks: Array<number | null>, at: number[] = AT): Tally {
  const n = ranks.length;
  const hits: Record<number, number> = Object.fromEntries(at.map((k) => [k, 0]));
  let reciprocal = 0;
  for (const rank of ranks) {
    if (rank === null) continue;
    reciprocal += 1 / (rank + 1);
    for (const k of at) if (rank < k) hits[k]++;
  }
  return {
    n,
    hits,
    missing: ranks.filter((r) => r === null).length,
    /* Over n, not over the ones that hit: a run that finds one clip at rank 1
       and loses the other ninety-nine has an MRR of 0.01, not 1.0. */
    mrr: n ? reciprocal / n : 0,
  };
}

async function main() {
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE)) {
    console.log(`\n✘ refusing to run against ${BASE} — this reads a real library. Localhost only.`);
    process.exit(1);
  }
  try {
    await fetch(`${BASE}/api/health`);
  } catch {
    console.log("⚠ no dev server at " + BASE);
    console.log("  Run `npx wrangler dev --port 8787 --enable-containers=false` and re-run.\n");
    return;
  }

  /*
   * DRIVEN THROUGH THE REAL PAGE, not a JSON endpoint, because there isn't
   * one: meaning search lives inside the /footage handler and renders HTML.
   *
   * That turns out to be the better measurement anyway. This exercises the
   * exact path a person takes — embed the query, hit Vectorize, map ids back
   * to rows, preserve Vectorize's order, render — rather than an idealised
   * version that shares none of its bugs.
   *
   * redirect: "manual" because /footage sends a signed-out visitor to `/`,
   * and a 302 followed silently looks exactly like an empty library.
   */
  const page = async (params: string) => {
    const res = await fetch(`${BASE}/footage?tab=moments&${params}`, { redirect: "manual" });
    return { status: res.status, html: res.status < 300 ? await res.text() : "" };
  };

  /*
   * The labels come from the database, because the reason text is not in the
   * page markup. Read-only, local only, and the one place this script touches
   * D1 directly.
   */
  const { execSync } = await import("node:child_process");
  const d1 = <T,>(sql: string): T[] => {
    /*
     * Flattened to one line first. A readable multi-line query goes through
     * JSON.stringify as a literal \n, which the shell hands to SQLite as a
     * backslash and an n — "unrecognized token". The first version of this
     * script did exactly that and died on its second query.
     */
    const flat = sql.replace(/\s+/g, " ").trim();
    let raw;
    try {
      raw = execSync(
        `npx wrangler d1 execute aldershot --local --json --command ${JSON.stringify(flat)}`,
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      );
    } catch (err) {
      /* wrangler puts the SQLite error on stdout and exits non-zero, so the
         useful half is in the exception rather than the stack trace. */
      const e = err as { stdout?: string; message?: string };
      const said = String(e.stdout ?? "").trim();
      throw new Error(`local D1 query failed\n  ${flat}\n  ${said || e.message}`);
    }
    return (JSON.parse(raw) as Array<{ results?: T[] }>)[0]?.results ?? [];
  };

  const [{ n: total = 0 } = {}] = d1<{ n: number }>(
    "SELECT COUNT(*) AS n FROM v2_clips WHERE deleted_at IS NULL",
  );
  if (!total) {
    console.log("⚠ no clips in this library — score a video first.\n");
    return;
  }

  const clips = d1<{ id: string; why: string }>(
    `SELECT id, why FROM v2_clips WHERE deleted_at IS NULL AND why IS NOT NULL
        AND length(why) > 12 ORDER BY created_at DESC LIMIT ${LIMIT}`,
  );
  if (!clips.length) {
    console.log(`⚠ ${total} clips, none carrying a reason — those come from a scoring pass.\n`);
    return;
  }

  /*
   * A SANITY CHECK BEFORE ANY NUMBERS, because the two ways this harness can
   * lie both look like a bad pipeline.
   *
   * Signed out, every page is a 302 and every query parses zero ids: 0%
   * recall, reported confidently. Renamed the data-moment attribute, same
   * thing. So prove the plain listing parses SOMETHING first — the library is
   * known non-empty by now, so zero here is a harness fault, not a result.
   */
  const listing = await page("");
  if (listing.status >= 300) {
    console.log(`\n✘ /footage returned ${listing.status} — signed out, so every query would read as empty.`);
    console.log("  Put DEV_LOGIN_EMAIL=you@example.com in .dev.vars and restart wrangler dev.\n");
    return;
  }
  if (!idsIn(listing.html).length) {
    console.log(`\n✘ ${total} clips in D1, none parsed from the page.`);
    console.log("  The data-moment attribute this harness reads has moved; see momentCard in");
    console.log("  src/ui/pages/footage.ts. Numbers from here would all be zero and all be wrong.\n");
    return;
  }

  const arm = MODE === "exact" ? "the words that were said" : "meaning";
  console.log(`\n  ${clips.length} of ${total} kept clips as labels, searching by ${arm}\n`);

  const ranks: Array<number | null> = [];
  let unavailable = 0;

  for (const clip of clips) {
    const { html } = await page(`mode=${MODE}&q=${encodeURIComponent(clip.why)}`);
    if (NO_INDEX.test(html)) { unavailable++; continue; }

    const rank = idsIn(html).indexOf(clip.id);
    ranks.push(rank < 0 ? null : rank);
  }

  if (unavailable) {
    console.log(`  ✘ the meaning index is not configured (${unavailable} queries had nowhere to go).`);
    console.log("    Create it, let the hourly sweep fill it, then run this again:");
    console.log("    wrangler vectorize create aldershot-clips --dimensions=1024 --metric=cosine");
    console.log("    See docs/SETUP.md — the metadata index must exist BEFORE any vector is written.\n");
    return;
  }

  const { n, hits, missing, mrr } = tally(ranks);
  console.log("  recall@k — does a clip come back when you describe it?\n");
  for (const k of AT) console.log(`    @${String(k).padEnd(3)} ${pct(hits[k], n)}   (${hits[k]}/${n})`);
  console.log(`\n    MRR  ${mrr.toFixed(3)}        never found: ${missing}`);

  /*
   * A number with nothing to compare it to is a number nobody can act on, so
   * say what it means. These thresholds are judgement, not measurement: the
   * research found no published baseline for retrieval over a personal
   * spoken-media library, which is precisely why this script exists.
   */
  if (MODE === "exact") {
    console.log(
      "\n  That is the baseline, not a result. Run without --exact and the difference\n" +
        "  between the two @10 figures is what meaning search is actually buying.\n",
    );
    return;
  }

  const r10 = (100 * hits[10]) / n;
  console.log(
    "\n  " +
      (r10 >= 80
        ? "Strong. Clips are the right retrieval unit; windowing raw transcript is the next step."
        : r10 >= 50
          ? "Workable, not good. Try the context prefix and a reranker before indexing 3,000 hours."
          : "Weak. Something is wrong with the pipeline, not the corpus — check what clipText embeds\n  and that the user_id metadata index existed before the first vector was written.") +
      "\n",
  );
}

/* Importable, so test/eval-retrieval.test.ts can get at tally() without this
   trying to reach a dev server. */
if (process.argv[1] && import.meta.filename === process.argv[1]) await main();
