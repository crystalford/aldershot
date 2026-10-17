/**
 * MAKE SOMETHING OUT OF EVERYTHING YOU HAVE SHOT.
 *
 * Every edit in this product has belonged to exactly one video. You could pull
 * a clip from another one into a cut — the seam has done that since it was
 * built — but you could never START from the library and say "three minutes on
 * this, from whatever I have".
 *
 * That turns out to be the one thing nothing else in this market does. Reduct
 * sells cross-video assembly and it is manual: search, then drag text into a
 * reel. Descript's assistant is conversational and scoped to the open project.
 * Frame.io indexes a whole account and cannot assemble. Nobody has joined the
 * halves.
 *
 * And it is cheap here, because the render was built for it without meaning to
 * be: a Block carries its own mediaKey, an EdlCut carries its own sourceKey,
 * runRender signs each cut's key separately and the container downloads one
 * file per distinct url. The single-source assumption lived in the guards, not
 * in the machinery.
 *
 * WHAT THIS DOES NOT DO. It does not read a transcript. A clip pulled from
 * another video does not carry that video's words (src/blocks.ts), so an
 * assembled cut can be reordered, struck whole, narrated over and exported —
 * but not cut inside by word. That needs Cut to gain a source discriminator
 * and is deliberately not smuggled in here.
 */

import type { Env } from "./env.ts";
import { listMoments, searchMeaning, type Moment } from "./library.ts";
import { applyRule, compute, describe, ruleKey, toFootageSet, type Rule } from "./rules.ts";
import { contentWords, momentTags, NOISE } from "./moment-tags.ts";
import { honestReply, parseRules } from "./rule-parse.ts";
import { saveRules } from "./rule-store.ts";
import { createProject, putBeats } from "./projects.ts";
import { recordPass } from "./passes.ts";
import { titleFromBrief } from "./projects.ts";
import { ulid } from "./id.ts";

/*
 * ASSEMBLE_MAX IS GONE, and the fidelity gate is what noticed.
 *
 * It was a count ceiling — take the first 24 and stop — then a guard against
 * an editor holding a hundred and forty blocks once the budget replaced it.
 * With the rule engine deciding, there is nothing left for it to guard: the
 * engine has no count step, the reference has none either, and adding one
 * would be a second departure from the specification to solve a problem that
 * is already solved.
 *
 * CANDIDATE_POOL is the real ceiling. The engine never sees more moments than
 * retrieval handed it, so sixty is the most blocks any assembly can produce,
 * and it is enforced at the only place that can enforce it honestly.
 */

/**
 * How much of the library to look at before choosing. Larger than the output,
 * because a budget that selects from exactly as many moments as it can fit is
 * not selecting.
 */
export const CANDIDATE_POOL = 60;

/**
 * What "say what you want" means when it does not say how long.
 *
 * Deliberately generous rather than tight, and this is the one place the
 * staged-reduction research changed a number. Professional practice reduces in
 * passes — a first assembly runs well over the final length and the editor
 * strikes down to it — so an assembly nobody gave a duration to should
 * over-deliver material and let the user cut, not guess short and silently
 * leave good moments in the library.
 *
 * A brief that names a duration overrides it; see targetFromBrief.
 */
export const DEFAULT_TARGET_MS = 12 * 60_000;

/**
 * RECIPROCAL RANK FUSION.
 *
 * Two retrievers, fused by where each put a thing rather than by what each
 * scored it. A cosine similarity and a count of matched words are numbers on
 * scales with no exchange rate between them, and any constant mixing the two
 * would be invented. Ranks are comparable by construction, which is the whole
 * reason this is the standard way to combine retrievers.
 *
 * score(d) = Σ 1 / (K + rank(d)) over the lists that returned it.
 *
 * K = 60 is the conventional value from the original TREC work. It flattens
 * the top of each list — the difference between first and second matters less
 * than the difference between returned and not returned — which is what makes
 * agreement between two retrievers beat a confident first place from one.
 */
export const RRF_K = 60;

export function fuseByRank<T>(lists: T[][], key: (item: T) => string): T[] {
  const score = new Map<string, number>();
  const first = new Map<string, T>();

  for (const list of lists) {
    list.forEach((item, i) => {
      const k = key(item);
      score.set(k, (score.get(k) ?? 0) + 1 / (RRF_K + i + 1));
      if (!first.has(k)) first.set(k, item);
    });
  }

  return [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => first.get(k))
    .filter((x): x is T => x !== undefined);
}

/**
 * The moments a brief asks for, best first.
 *
 * Meaning search when the index exists, exact words when it does not — the
 * fallback the library already makes everywhere else, so an account without a
 * Vectorize index gets a worse answer rather than an error.
 *
 * Deliberately NOT a model call. The model's job is deciding what to do with
 * material; finding the material is retrieval, and retrieval over our own
 * clips is exact — every one of these is a real range of a real file with a
 * real quote, so nothing here can invent a moment that was never said.
 */
export async function findMaterial(
  env: Env,
  userId: string,
  brief: string,
  limit = CANDIDATE_POOL,
): Promise<{ moments: Moment[]; how: "meaning" | "words" | "recent" }> {
  const q = brief.trim();
  if (!q) return { moments: await listMoments(env.DB, userId, limit), how: "recent" };

  /*
   * A BRIEF IS NOT A SEARCH BOX QUERY.
   *
   * searchExact joins its terms with AND — right for "find every place I said
   * sponsor", wrong for a sentence. Asked for "the bits about food" against a
   * library holding exactly that, it returned nothing, because no single
   * moment contains all four words including "the" and "about".
   *
   * So the words retriever ranks instead of filtering: how many of the brief's
   * content words a moment actually says. Deterministic, over our own
   * transcripts.
   */
  /* Genuinely in parallel: the embedding call and the row read are the two
     waits, and neither needs the other's answer. */
  const [meant, recent] = await Promise.all([
    searchMeaning(env, userId, q, limit),
    listMoments(env.DB, userId, 200),
  ]);
  const ranked = rankByWords(recent, q);

  /*
   * TWO PEER RETRIEVERS, FUSED BY RANK — not one with the other as a fallback.
   *
   * This used to return the meaning results whenever there were any, and only
   * fall back to words when the index gave nothing. That is not hybrid
   * retrieval, and the failure is specific rather than theoretical: words can
   * only ever surface what the vector missed if words are allowed to run when
   * the vector succeeded. A proper name, a number, a piece of jargon — the
   * things an embedding is worst at and an exact match is best at — were
   * unreachable on any account where the index existed.
   *
   * 06-FOOTAGE-SYSTEM.md: "Never re-score vector results with BM25 — then
   * keywords can't surface what the vector missed. On transcripts, keyword
   * search is a peer retriever." Both run, both rank, ranks fuse.
   *
   * `how` says whether the INDEX took part, which is the only thing it was
   * ever for: it exists to warn somebody that they are looking at the weaker
   * answer. So "meaning" means the index contributed something, not that words
   * contributed nothing — usually both did, and that is the point.
   */
  if (meant?.length || ranked.length) {
    const fused = fuseByRank(
      [meant ?? [], ranked].filter((l) => l.length),
      (m) => m.id,
    );
    return {
      moments: dedupe(fused).slice(0, limit),
      how: meant?.length ? "meaning" : "words",
    };
  }

  /*
   * AND WHEN NO WORD MATCHES, THE MOST RECENT — which is what the paragraph
   * above has always claimed and what this function did not do.
   *
   * It returned an empty list, so every brief whose words appear nowhere in
   * the library was refused with "nothing matches that yet". "Eight minutes on
   * whatever you have" is an explicit request for ANYTHING and got turned
   * away; so did any brief phrased around what to make rather than what it is
   * about. Found by driving the real route rather than by reading this.
   *
   * The pass line says "your most recent" when this happens, so a person can
   * see the search missed and that they are looking at a starting point rather
   * than an answer.
   */
  if (recent.length) return { moments: dedupe(recent).slice(0, limit), how: "recent" };

  return { moments: [], how: "words" };
}

/**
 * One moment per piece of footage, not three overlapping ones.
 *
 * The clip library holds moments found by different passes over the same
 * video, and they overlap freely — two clips covering the same forty seconds
 * are both real rows. Assembling them produced a cut that said the same thing
 * twice in a row, which reads as a bug even though every row is honest.
 *
 * Best-ranked wins the ground it covers. Kept here rather than in the library:
 * overlap is fine in a list you are BROWSING and wrong in a sequence you are
 * about to watch.
 */
export function dedupe<T extends { source_id: string; start_ms: number; end_ms: number }>(
  moments: T[],
): T[] {
  const taken: T[] = [];
  for (const m of moments) {
    const clash = taken.some(
      (t) => t.source_id === m.source_id && m.start_ms < t.end_ms && m.end_ms > t.start_ms,
    );
    if (!clash) taken.push(m);
  }
  return taken;
}

/**
 * The moments that actually say what the brief is about, best first.
 *
 * Exported because the ranking is the whole retrieval story when there is no
 * meaning index, and a rule this load-bearing should be testable on its own.
 */
export function rankByWords<T extends { quote: string; source_title?: string }>(
  moments: T[],
  brief: string,
): T[] {
  const terms = [
    ...new Set(
      brief
        .toLowerCase()
        .split(/[^a-z0-9']+/)
        .filter((t) => t.length > 2 && !NOISE.has(t)),
    ),
  ];
  if (!terms.length) return [];

  return moments
    .map((m) => {
      const hay = (m.quote + " " + (m.source_title ?? "")).toLowerCase();
      return { m, hits: terms.filter((t) => hay.includes(t)).length };
    })
    .filter((r) => r.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .map((r) => r.m);
}

/* Written-out numbers people actually say to a video editor. */
const SPOKEN: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, ninety: 90,
};

/**
 * HOW LONG THEY ASKED FOR, when they said.
 *
 * "three minutes on the gym stuff", "a 90 second cut about filters", "make it
 * 2 mins". The brief is the only place this can come from: there is no
 * duration control anywhere in the product, and inventing one would be a
 * worse answer than reading the sentence somebody already typed.
 *
 * Returns `said: false` when it found nothing, so the caller can tell the
 * difference between "they asked for twelve minutes" and "nobody said" — those
 * mean different things about whether going under budget is a problem.
 */
export function targetFromBrief(brief: string): { ms: number; said: boolean } {
  const q = " " + brief.toLowerCase().replace(/[,]/g, " ") + " ";

  /*
   * Minutes before seconds, and "and a half" folded in, because "a minute and
   * a half" is a thing people say and 60_000 would be the wrong answer to it.
   */
  const unit = /(\d+(?:\.\d+)?|[a-z]+)\s*(?:-|\s)?\s*(minutes?|mins?|m|seconds?|secs?|s)\b/g;
  for (const m of q.matchAll(unit)) {
    const raw = m[1];
    const n = /^\d/.test(raw) ? Number(raw) : (SPOKEN[raw] ?? (raw === "a" || raw === "an" ? 1 : NaN));
    if (!Number.isFinite(n) || n <= 0) continue;

    const minutes = m[2].startsWith("m");
    /* "and a half" only ever follows the number it halves. */
    const half = q.slice((m.index ?? 0) + m[0].length).startsWith(" and a half") ? 0.5 : 0;
    const ms = Math.round((n + half) * (minutes ? 60_000 : 1_000));

    /*
     * A SANITY WINDOW, because a brief is prose and prose contains numbers.
     * "cut the 3 second gap" and "the 2 minute mark" both parse, and neither
     * is a runtime. Ten seconds to two hours is the range a cut can be; a
     * number outside it is somebody talking about something else.
     */
    if (ms >= 10_000 && ms <= 2 * 3_600_000) return { ms, said: true };
  }
  return { ms: DEFAULT_TARGET_MS, said: false };
}


/*
 * WHAT USED TO BE HERE.
 *
 * selectForBudget: greedy budgeted-submodular selection, coverage over content
 * words, cost-scaled by duration. It worked and it was measured, and it is
 * gone, because the rule engine landed and a cut is what the RULES produce
 * (invariant 1). A selector here would have been a second answer to the same
 * question, drifting from the first the moment either was tuned.
 *
 * The logic is not lost: it is capDropOrder in src/rules.ts, deciding which
 * moments the cap rule drops first. That is a better home for it than this
 * was — attributable to a rule the user can see and switch off, rather than an
 * optimisation happening somewhere they cannot reach.
 */

/** The runtime of a set of moments, which is what a person asked about. */
export function runtimeMs(moments: Array<{ start_ms: number; end_ms: number }>): number {
  return moments.reduce((n, m) => n + Math.max(0, m.end_ms - m.start_ms), 0);
}

/** m:ss, for a line somebody reads rather than parses. */
export function clock(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * RE-PRODUCE THE CUT FROM THE RULES AS THEY STAND.
 *
 * This is invariant 1 made operable rather than merely stated. Until it
 * existed the rules were a record of how a cut had been made once; now they
 * are the thing the cut is made FROM, every time, and switching one off is a
 * real edit rather than a note in a table.
 *
 * Shared with the assembly path on purpose. Two functions turning a rule set
 * into beats would drift the first time either was touched, and the drift
 * would show up as a cut that changes when you toggle a rule off and on —
 * which is precisely the behaviour Phase 2 accepts on.
 *
 * The POOL is re-read rather than remembered. A moment binned since the cut
 * was made must not come back, and a moment scored since should be available
 * to a rule that asks for it: the rules are the record, the library is the
 * material, and neither is a snapshot of the other.
 */
export async function recomputeFromRules(
  env: Env,
  opts: { userId: string; projectId: string; rules: Rule[] },
): Promise<{ kept: number; secs: number; moments: Moment[] } | null> {
  const pool = await listMoments(env.DB, opts.userId, CANDIDATE_POOL);
  if (!pool.length) return null;

  const set = toFootageSet(pool, momentTags);
  const cut = compute(opts.rules, { set });
  const byId = new Map(pool.map((m) => [m.id, m]));
  const moments = cut.rows
    .filter((r) => r.kind === "clip" && r.moment)
    .map((r) => byId.get(String(r.moment!.id)))
    .filter((m): m is Moment => !!m);

  await putBeats(env.DB, opts.projectId, beatsFor(moments));
  return { kept: moments.length, secs: cut.secs, moments };
}

/** The clip beats for a set of moments, in the order given. */
function beatsFor(moments: Moment[]) {
  return moments.map((m) => ({
    id: ulid(),
    kind: "clip" as const,
    act: null,
    struck: "0",
    text: m.quote,
    clip_id: m.id,
    dur_ms: Math.max(0, m.end_ms - m.start_ms),
    media_r2_key: null,
    recorded_at: null,
  }));
}

/**
 * One edit, made of clips from wherever they came from.
 *
 * The project gets NO source_id — that is the whole point, and everything
 * downstream now copes: blocksForProject asks for no segments, buildEdl reads
 * each block's own key, and the editor renders a cut with no player of its own
 * because each block plays its own file.
 *
 * The moments become clip beats in transcript order of nothing in particular —
 * the order they were found in, which for a meaning search is best-first. That
 * is a starting order, and reordering is the one instruction an assembled cut
 * can already take.
 */
export async function assembleFromLibrary(
  env: Env,
  opts: { userId: string; brief: string },
): Promise<
  { projectId: string; used: number; how: string; runtimeMs: number; targetMs: number } | { error: string }
> {
  const { moments: pool, how } = await findMaterial(env, opts.userId, opts.brief);
  if (!pool.length) {
    return {
      error: "Nothing in your library matches that yet — read a few more videos in, or say it differently.",
    };
  }

  /*
   * THE RULES DECIDE, NOT THIS FUNCTION.
   *
   * Selection used to be greedy coverage-per-second here. That logic is not
   * gone — it is the cap rule's drop order now (src/rules.ts) — but the thing
   * that chooses is the engine, because invariant 1 says a cut is what a rule
   * set produces and is never stored as an outcome. A selector living in the
   * assembly path is a second answer to the same question, and the two would
   * drift the first time either was tuned.
   *
   * Three rules to start, from the reference's own seed set: keep what the
   * person is working out, lose the hellos and mic checks, run it one thread
   * at a time. Then whatever the brief itself asked for on top — a length, an
   * order, something to lose. They are rules, so every one of them is visible
   * and switch-off-able the moment the pane exists to show them.
   */
  const set = toFootageSet(pool, momentTags);
  const asked = parseRules(opts.brief);

  /*
   * FOLDED IN WITH applyRule, NOT APPENDED — and the difference is a bug I
   * shipped for one commit by concatenating instead.
   *
   * compute() takes the FIRST order rule it finds. Append the user's and the
   * seed's "one thread at a time" still wins, so "the start drags" parsed
   * correctly, produced the right rule, and changed nothing — the worst
   * possible outcome for a product whose promise is that you can see what the
   * rules did. applyRule is what the editor uses and it exists precisely
   * because orders and caps are single-valued: a second one REPLACES.
   */
  const seed: Array<Omit<Rule, "id">> = [
    { kind: "keep", tag: "core", on: true, text: "Keep the parts where you're working something out." },
    { kind: "drop", tag: "housekeeping", on: true, text: "Take out the hellos and the mic checks." },
    { kind: "order", order: "strand", on: true, text: "Run it one thread at a time." },
  ];
  /* Named by what they are, never by position — see ruleKey. */
  let rules: Rule[] = seed.map((r) => ({ ...r, id: ruleKey(r) }));
  asked.rules.forEach((r) => {
    /*
     * SAYING WHAT THE DEFAULT ALREADY DOES ADDS NOTHING.
     *
     * "Take out the hellos" parses to a drop on `housekeeping`, and the seed
     * set already has one — so folding it in blind put the same rule in the
     * pane twice, in the user's words and ours, both reporting the same
     * effect. applyRule is right not to dedupe (a second KEEP on a different
     * tag is a real second rule), so the check belongs here: same kind, same
     * tag, already on, nothing to add.
     */
    const same = rules.some((x) => x.on && x.kind === r.kind && x.tag && x.tag === r.tag);
    if (!same) rules = applyRule(rules, { ...r, id: ruleKey(r) });
  });

  /*
   * A LENGTH NOBODY ASKED FOR IS STILL A CEILING, not a target.
   *
   * The generous default stays — an assembly nobody gave a length to should
   * over-deliver material and let the user cut, which is what the staged
   * reduction research argues — but it arrives as a cap RULE rather than as a
   * number buried in a selector, so it shows up in the pane with everything
   * else and can be switched off like everything else.
   */
  const target = targetFromBrief(opts.brief);
  if (!rules.some((r) => r.kind === "cap")) {
    rules = applyRule(rules, {
      id: ruleKey({ kind: "cap", on: true }),
      kind: "cap",
      secs: Math.round(target.ms / 1000),
      on: true,
      text: `Keep it under ${Math.round(target.ms / 60_000)} minutes.`,
    });
  }

  const cut = compute(rules, { set });
  const chosen = cut.rows.filter((r) => r.kind === "clip" && r.moment).map((r) => r.moment!);
  if (!chosen.length) {
    return {
      error: "Nothing in there survived the rules — it may all be hellos and hedging. Try saying it differently.",
    };
  }

  /* Back to the library rows, in the order the engine put them. */
  const byId = new Map(pool.map((m) => [m.id, m]));
  const moments = chosen.map((c) => byId.get(String(c.id))).filter((m): m is Moment => !!m);

  const project = await createProject(env.DB, {
    user_id: opts.userId,
    title: titleFromBrief(opts.brief, "From your library"),
    kind: "cut",
    /* No video of its own. The one thing that makes this different. */
    source_id: null,
    brief: opts.brief,
  });

  /* The engine's own total, not the clips' — it includes the to-camera gaps
     the gap rule put in, which are real seconds of the finished cut. */
  const runtime = cut.secs * 1000;
  const beats = beatsFor(moments);

  await putBeats(env.DB, project.id, beats);

  /*
   * AND THE RULES, which are the actual record.
   *
   * Beats are the outcome; this is the input that produced them. Without it an
   * assembled cut arrived with no account of why those moments and not others,
   * and nothing could be switched off because nothing had been written down —
   * invariant 1 says a cut is re-produced from rules, and until this line it
   * could not be re-produced at all.
   */
  await saveRules(env.DB, project.id, rules);

  /*
   * IT SAYS WHAT IT DID.
   *
   * Six blocks appearing from six places with no explanation is the exact
   * review gap this product is supposed to be better at than everyone else:
   * the question is not whether the model can do more, it is whether a person
   * can check what it chose faster than doing it by hand.
   *
   * So the assembly writes itself into the conversation as the first turn, the
   * same shape a pass does — what you asked, what it found, and a Show me that
   * jumps to the first thing it pulled. No undo snapshot: there is no earlier
   * state of this edit to go back to, and a button that offered one would lie.
   */
  const from = new Set(moments.map((m) => m.source_id)).size;

  /*
   * IT SAYS HOW LONG IT IS, AND WHY IT IS NOT LONGER.
   *
   * This line used to read "6 moments from 2 videos" and leave out the only
   * number somebody asking for three minutes wanted.
   *
   * The two reasons it can come up short are NOT the same fact and a single
   * sentence covering both would be a lie about one of them. Either the
   * library had more that matched and none of it was short enough to fit —
   * which is what trimming inside a pulled clip would fix, and nothing else
   * will — or that is simply everything that matched, and no amount of
   * cleverness here will find more. Caught driving the real route: a
   * two-minute ask returned 34 seconds and the first version of this said
   * "nothing shorter left that fits" when the truth was "that is all there is".
   */
  const gap = target.said && target.ms - runtime > 15_000;
  const exhausted = moments.length >= pool.length;
  const why = !gap
    ? ""
    : exhausted
      ? ` of ${clock(target.ms)} — that is everything ${how === "recent" ? "you have" : "that matched"}`
      : ` of ${clock(target.ms)} — nothing shorter left that fits`;
  await recordPass(env.DB, {
    projectId: project.id,
    sourceId: null,
    instruction: opts.brief,
    result:
      describe(cut, rules, why) +
      ` · from ${from} video${from === 1 ? "" : "s"}` +
      (how === "meaning" ? "" : how === "words" ? " · matched on words" : " · your most recent") +
      /* A sentence that carried no rule says so, rather than appearing to
         have been understood. 04-RULE-ENGINE.md: never a silent no-op. */
      (honestReply(asked.unparsed) ? ` — ${honestReply(asked.unparsed)}` : ""),
    firstChange: `b:${beats[0].id}`,
  }).catch(() => {
    /* The edit exists and is usable; a missing opening line is not worth
       failing the whole assembly for. */
  });

  return {
    projectId: project.id,
    used: moments.length,
    how,
    runtimeMs: runtime,
    targetMs: target.ms,
  };
}
