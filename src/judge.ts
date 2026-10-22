/**
 * THE JUDGE: does this moment back this claim, or does it only sound like it?
 *
 * Phase 4, and decision 21: "'Nothing backs this' is engineered. Three-way
 * label, our threshold, near-miss negatives. *Models alone never abstain or
 * always do.*" The three answers are the eval set's own — `backs`,
 * `related`, `unrelated` — on purpose, so a judgement and a person's
 * judgement of the same pair are directly comparable and the numbers in
 * src/eval-metrics.ts mean what they say.
 *
 * WHY THREE AND NOT TWO. Near-miss evidence — the same speaker, the same
 * topic, a different point — is the dominant false positive in every system
 * of this shape. A yes/no judge learns that anything on topic is support,
 * which is exactly the failure a receipt has to survive.
 *
 * THE MODEL CANNOT WRITE THE RECEIPT. It is sent numbered sentences and
 * returns a NUMBER; the line is rebuilt from our own text on this side of
 * the call. That is src/grounding.ts's rule — "the model supplies WHERE and
 * WHY, the quote is rebuilt from our own segments" — and the reason it
 * applies doubly here: a receipt the model composed would be a quote nobody
 * said, under a claim, presented as proof.
 *
 * AND THE ABSTENTION IS STRUCTURAL, not a number we hope is calibrated. A
 * verdict of `backs` that cannot point at a sentence is downgraded to
 * `related` — the model asserted support and could not show it, which is
 * the definition of the near-miss it was asked to separate. No threshold is
 * guessed at here: a numeric one belongs with the eval set that could
 * calibrate it, and inventing one against nothing is the thing this
 * codebase refuses to do everywhere else.
 */

import type { Env } from "./env.ts";
import { assistantText, usageTokens } from "./grounding.ts";
import { resolveFor, type Resolved } from "./models.ts";
import { reportRoom } from "./llm.ts";
import { callRouted } from "./breaker.ts";
import { VERDICTS, isVerdict, type Verdict } from "./eval-set.ts";

/**
 * Tagged on every judgement, so a model swap is visible in the rows rather
 * than only in the deploy that caused it. The convention: "every model call
 * sits behind a typed capability contract, is tagged with its model version,
 * and is gated by the eval set before a model swap."
 */
export const JUDGE_VERSION = "judge-1";

/** The most sentences one moment is cut into. A moment is a sentence or
    three; past this the numbering is noise and the prompt is long. */
export const MAX_SENTENCES = 8;

/** How long the judge's own line may be. A sentence, not a paragraph. */
export const LINE_CHARS = 160;

export interface Candidate {
  /** The moment's id. Never sent to the model; short ids are. */
  id: string;
  quote: string;
}

export interface Judgement {
  id: string;
  said: Verdict;
  /**
   * The sentence that does the backing, REBUILT FROM OUR OWN TEXT. Null for
   * anything but `backs`, and null for a `backs` that could not point.
   */
  line: string | null;
  /** One line on what that sentence establishes. Never a quote. */
  why: string | null;
  /** What the model said before the structural rule was applied. */
  raw: Verdict;
  /** True when `backs` was downgraded for pointing at nothing. */
  downgraded: boolean;
  /**
   * Whether the model said anything about this moment at all.
   *
   * An unanswered moment is recorded as `unrelated` — a short answer must
   * not silently shrink the set — but that is an INFERENCE, not a verdict,
   * and a run where it is true of everything is a call that failed rather
   * than a judge with no opinions. Kept so the two can be told apart.
   */
  answered: boolean;
  model: string;
  version: string;
}

/**
 * A moment, as numbered sentences.
 *
 * Split on sentence enders followed by a space and a capital — and NOT
 * after a title or an initial. "Mr. Telford" and "2.5 hours" are not two
 * sentences, and a split that got those wrong would renumber the moment and
 * point the receipt at the wrong half of it.
 *
 * The decimal case falls out of requiring a capital after the space. The
 * title case does not: "Telford" is as capitalised as any sentence start,
 * so the word BEFORE the stop has to be looked at. A short list and the
 * single-letter rule cover what speech actually contains; this is a
 * transcript, where "Mr" and "Dr" are common and "ibid." is not.
 */
/*
 * "no" IS NOT ON THIS LIST, and was for one commit. It is "number" about
 * once a year and the end of a sentence constantly — "I said no. Then he
 * left." — so including it joined two real sentences into one and moved
 * every number after it. A list of abbreviations has to be judged by what
 * SPEECH contains, not by what a style guide does.
 */
const TITLES = new Set(["mr", "mrs", "ms", "dr", "st", "prof", "sr", "jr", "vs", "approx", "etc"]);

export function sentences(quote: string): string[] {
  const flat = quote.replace(/\s+/g, " ").trim();
  const parts: string[] = [];
  let at = 0;
  for (const m of flat.matchAll(/([.!?])\s+(?=[A-Z"'“‘])/g)) {
    const end = m.index + 1;
    const before = flat.slice(at, m.index);
    const last = (before.match(/(\S+)$/)?.[1] ?? "").toLowerCase().replace(/[^a-z]/g, "");
    /* A title, or an initial — "J. R. Telford" is one name, not three
       sentences. */
    if (TITLES.has(last) || last.length === 1) continue;
    parts.push(flat.slice(at, end).trim());
    at = m.index + m[0].length;
  }
  if (flat.slice(at).trim()) parts.push(flat.slice(at).trim());
  if (!parts.length) return [];
  /* Past the ceiling the tail is joined rather than dropped: a moment is
     never truncated, because the sentence that backs the claim could be the
     last one. */
  if (parts.length <= MAX_SENTENCES) return parts;
  return [...parts.slice(0, MAX_SENTENCES - 1), parts.slice(MAX_SENTENCES - 1).join(" ")];
}

/* ── The prompt ─────────────────────────────────────────────────────────── */

export function systemPrompt(): string {
  return [
    "You decide whether a piece of recorded speech BACKS a claim.",
    "",
    "Three answers, and the middle one matters most:",
    '  backs      — someone says the thing the claim asserts, or states a fact that establishes it.',
    '  related    — the same subject, the same speaker, a nearby point. Not the claim.',
    '  unrelated  — a different subject.',
    "",
    "Rules:",
    "- If you answer backs, name the ONE sentence that does it, by its number.",
    "  If you cannot name one, the answer is related, not backs.",
    "- Being on the same topic is not backing. Most near-misses are related.",
    "- Different words are fine. A sentence that establishes the claim in its",
    "  own words backs it; backing is not restatement, and a claim whose",
    "  support has to be read rather than matched is still backed.",
    "- But never supply what was not said. A plan, a denial, somebody else's",
    "  claim, a different person, a different place, a different time, or a",
    "  thing said and then taken back is not the claim, however close the",
    "  words are.",
    "- Never quote the speech back. Say what the sentence establishes, in a line.",
    "- Answer for every moment you are given, once each.",
  ].join("\n");
}

export function userPrompt(
  claim: string,
  candidates: Candidate[],
  ids: Map<string, string>,
  /**
   * Short ids the first answer did not cover, on a re-ask.
   *
   * EVERY MOMENT IS SENT AGAIN, not just these. The comparison is the work —
   * see `judge` below — and a re-ask narrowed to the gap would ask the
   * hardest question with the context that makes it answerable removed. The
   * tail names what is still owed; the list stays whole.
   */
  missing: string[] = [],
): string {
  const lines = [`CLAIM: ${claim}`, "", "MOMENTS:"];
  for (const c of candidates) {
    lines.push(`${ids.get(c.id)}:`);
    sentences(c.quote).forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
  }
  if (missing.length) {
    lines.push("", `You did not answer for ${missing.join(", ")}. Answer for those as well.`);
  }
  return lines.join("\n");
}

/**
 * m1, m2, m3 — not the real ids.
 *
 * scout-reduce.ts measured this on the same models in this codebase: asked
 * to copy a 26-character ULID, a model describes the right row and mistypes
 * the reference. Short ids are copied correctly, and a short id the model
 * invented is one we can detect rather than one that silently addresses a
 * row we do not have.
 */
export function shortIds(candidates: Candidate[]): Map<string, string> {
  return new Map(candidates.map((c, i) => [c.id, `m${i + 1}`]));
}

const SCHEMA = {
  type: "object",
  properties: {
    judgements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          moment: { type: "string" },
          verdict: { type: "string", enum: [...VERDICTS] },
          /* A SENTENCE NUMBER, not a quote. There is no field here a quote
             could go in, which is what makes the receipt un-inventable. */
          sentence: { type: "integer" },
          why: { type: "string" },
        },
        required: ["moment", "verdict"],
      },
    },
  },
  required: ["judgements"],
} as const;

/* ── Reading the answer ─────────────────────────────────────────────────── */

/** A line that is the judge's own words, rather than the speech copied back. */
export function usableWhy(line: string, quote: string): boolean {
  const l = line.trim();
  if (!l || l.length > LINE_CHARS) return false;
  /* Five words of the quote in a row is a copy; referring to "the donation
     goal" is not. The same rule and the same reason as scout-reduce.ts. */
  const words = quote.toLowerCase().split(/\s+/).filter(Boolean);
  const lower = l.toLowerCase();
  for (let i = 0; i + 5 <= words.length; i += 1) {
    if (lower.includes(words.slice(i, i + 5).join(" "))) return false;
  }
  return true;
}

/**
 * The answer, read into judgements — pure, and exported, because every way
 * this fails is quiet.
 *
 * A CANDIDATE THE MODEL DID NOT ANSWER FOR IS `unrelated`, NOT MISSING.
 * Eight moments judged as six is a judge that looked at eight and reported
 * six, which is the silent partial failure invariant 7 calls a P1 — and
 * here it would arrive as a shorter list rather than as an error. The
 * unanswered ones are the ones it had nothing to say about, which is what
 * `unrelated` means.
 */
export function parseJudgements(
  response: unknown,
  candidates: Candidate[],
  ids: Map<string, string>,
  model: string,
): Judgement[] {
  const text = assistantText(response) || (typeof response === "string" ? response : "");
  let parsed: unknown = response;
  if (text) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    try {
      parsed = JSON.parse(fenced ? fenced[1] : text);
    } catch {
      parsed = {};
    }
  }

  const byShort = new Map<string, Candidate>();
  for (const c of candidates) byShort.set(ids.get(c.id)!, c);

  const said = new Map<string, Judgement>();
  const rows = (parsed as { judgements?: unknown })?.judgements;
  for (const r of Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : []) {
    const c = byShort.get(String(r.moment ?? "").trim());
    /* A short id for a moment we did not send. Dropped: it is an answer
       about nothing, and attaching it to anything would be inventing the
       question as well as the answer. */
    if (!c || said.has(c.id)) continue;

    const raw = isVerdict(r.verdict) ? r.verdict : "unrelated";
    const parts = sentences(c.quote);
    const n = Number(r.sentence);
    /* The integer and range checks are belt and braces — out-of-range
       indexing already gives undefined — and they stay because they say
       what is being asked. Breaking either on purpose changes nothing,
       which is recorded here rather than left as a test that could not be
       written. */
    const line = Number.isInteger(n) && n >= 1 && n <= parts.length ? parts[n - 1] : null;

    /*
     * THE STRUCTURAL ABSTENTION. `backs` with nothing to point at is
     * `related`: the model asserted support and could not show it, which is
     * precisely the near-miss it was asked to separate. No number is
     * guessed at, and nothing about this depends on the model being
     * calibrated — which, per decision 21, it is not.
     */
    const downgraded = raw === "backs" && !line;
    const verdict: Verdict = downgraded ? "related" : raw;

    const whyLine = String(r.why ?? "").trim();
    said.set(c.id, {
      id: c.id,
      said: verdict,
      line: verdict === "backs" ? line : null,
      why: usableWhy(whyLine, c.quote) ? whyLine : null,
      raw,
      downgraded,
      answered: true,
      model,
      version: JUDGE_VERSION,
    });
  }

  return candidates.map(
    (c) =>
      said.get(c.id) ?? {
        id: c.id,
        said: "unrelated" as Verdict,
        line: null,
        why: null,
        raw: "unrelated" as Verdict,
        downgraded: false,
        answered: false,
        model,
        version: JUDGE_VERSION,
      },
  );
}

/* ── Reranking ──────────────────────────────────────────────────────────── */

/** Best first. The order a reranker exists to produce. */
const RANK: Record<Verdict, number> = { backs: 0, related: 1, unrelated: 2 };

/**
 * THE JUDGE IS THE RERANKER.
 *
 * Phase 4 asks for "BM25 ∥ dense → RRF → rerank", and the obvious reading is
 * a third model call with its own prompt and its own scores. It would be
 * the same call as this one: read these candidates against this query and
 * say which are about it. Two calls doing one job, and only one of them
 * measurable — a reranker's scores have no ground truth, while a verdict
 * has two hundred of somebody's own judgements to be checked against.
 *
 * So the rerank is the verdict, and the fused rank breaks the ties. A sort
 * that reordered equal verdicts would throw away everything BM25 and the
 * index worked out, which is most of what is known about a candidate the
 * judge called `related`.
 *
 * A candidate nobody judged keeps its place among the `related` ones:
 * unjudged is not unrelated, and demoting it would punish a moment for a
 * call that did not happen.
 */
export function rerank<T extends { id: string }>(items: T[], judgements: Judgement[]): T[] {
  const by = new Map(judgements.map((j) => [j.id, j.said]));
  return items
    .map((item, i) => ({ item, i, rank: RANK[by.get(item.id) ?? "related"] }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((x) => x.item);
}

/* ── The capability ─────────────────────────────────────────────────────── */

export interface JudgeResult {
  judgements: Judgement[];
  tokensIn: number;
  tokensOut: number;
  model: string;
  /**
   * Moments the judge was shown and never answered for, AFTER the re-ask.
   *
   * Nonzero means this result is degraded: those moments are scored
   * `unrelated` because something has to be, and `unrelated` is the one
   * verdict nobody asserted. A caller that cares about invariant 7 reads
   * this rather than the list, where the loss is invisible.
   */
  unanswered: number;
  /** Whether a second call was needed to cover the moments. */
  reasked: boolean;
}

/**
 * How much room the answer gets.
 *
 * MEASURED TWICE, AND THE FIRST MEASUREMENT WAS TOO MEAN. It was a flat
 * 2000, and the first run of the adversarial set lost two whole claims to
 * it: GLM-5.3 reasons before it answers, and on the ones it found hard the
 * JSON was cut off mid-array. A truncated answer does not arrive as an
 * error — `JSON.parse` fails, the object is empty, and every moment comes
 * back `unrelated`, which reads as a judge with no opinions instead of as a
 * call that failed.
 *
 * src/naming.ts found this exact bug first — "every call came back with
 * completion_tokens exactly 32, i.e. truncated" — and the lesson did not
 * travel. It is written here as a number instead of a comment this time.
 *
 * THE FLOOR IS LARGE BECAUSE THE THINKING IS PER CLAIM, NOT PER MOMENT.
 * Sized at 2500 + 1400/moment the hardest two-moment claim in the
 * adversarial set spent 4355 of its 5300 and failed twice under load, which
 * is a ceiling dressed as a budget. The difficulty is mostly in the claim;
 * only the answer array scales with the count.
 *
 * AND A HIGH CAP IS NOT A SPEND. Only generated tokens are billed, so the
 * room costs nothing on the calls that do not use it. What a high cap
 * actually risks is latency on a model that will not stop, and the single
 * re-ask is what bounds that.
 */
export function budgetFor(moments: number): number {
  return Math.min(24000, 6000 + 1500 * Math.max(1, moments));
}



/**
 * Judge every candidate against one claim, in one call.
 *
 * One call rather than one per moment, because the comparison is the work:
 * a judge shown eight moments at once can see that the third is the one
 * that actually says it and the other seven are about the same evening.
 * Shown them one at a time it has nothing to be near-miss RELATIVE TO.
 */
export async function judge(
  env: Env,
  claim: string,
  candidates: Candidate[],
  /**
   * A model to use instead of the capability's own.
   *
   * FOR THE EVAL AND NOTHING ELSE. Scoring a candidate model has to run the
   * SHIPPING judge — same prompts, same schema, same structural downgrade —
   * or it measures a reimplementation and tells you nothing about what would
   * happen if you swapped. An override here is the smallest way to do that;
   * a second judge written for the eval is the largest way to be wrong.
   */
  opts: { model?: Resolved } = {},
): Promise<JudgeResult> {
  /* Load-bearing: this answer IS invariant 4. See CAPABILITIES. */
  const model = opts.model ?? resolveFor("judge", env);
  if (!claim.trim() || !candidates.length) {
    return { judgements: [], tokensIn: 0, tokensOut: 0, model: model.id, unanswered: 0, reasked: false };
  }

  const ids = shortIds(candidates);
  const maxTokens = budgetFor(candidates.length);
  /*
   * Through callReason, which is the only thing that knows how to speak to
   * either provider. This used to call env.AI.run with model.id whatever the
   * resolved provider said — so the day somebody set ANTHROPIC_API_KEY, the
   * judge would have asked Workers AI for "claude-sonnet-5".
   */
  /*
   * THROUGH THE BREAKER, because this is the capability a provider outage
   * hurts most: invariant 4 lives here, and a judge that cannot be reached
   * is a receipt that cannot be made.
   *
   * `callRouted` falls to the Workers AI model when the Anthropic pool is
   * shut, and every judgement already records the model that made it — so a
   * receipt produced during an outage says so afterwards rather than looking
   * like any other.
   */
  const ask = (missing: string[], room: number) =>
    callRouted(env, "judge", model, {
      system: systemPrompt(),
      user: userPrompt(claim, candidates, ids, missing),
      maxTokens: room,
      schema: SCHEMA,
    });

  const { raw: res } = await ask([], maxTokens);
  let judgements = parseJudgements(res, candidates, ids, model.id);
  let { tokensIn, tokensOut } = usageTokens(res);

  /*
   * THE RE-ASK, which exists because a moment nobody answered for is scored
   * `unrelated` and that is indistinguishable from a verdict.
   *
   * The prompt already says "answer for every moment you are given". It is
   * not obeyed: the first run of the adversarial set lost both of its
   * two-moment near-miss claims this way, and asked one at a time the same
   * model got both right. Begging harder is not a fix — a second call that
   * names the gap is, and it costs nothing on the calls that do not need it.
   *
   * ONCE. A loop here would turn a model that cannot answer into a bill,
   * and the honest end state is a result that says what it is missing.
   */
  const missing = judgements.filter((j) => !j.answered).map((j) => ids.get(j.id)!);
  const reasked = missing.length > 0;
  if (reasked) {
    /* MORE ROOM WHEN ROOM WAS THE PROBLEM. A re-ask at the budget that was
       just exhausted is the same call again, and a model that thought past
       its ceiling once will do it twice. Where the first answer stopped
       short of the ceiling the cause was not space — it skipped a moment —
       and the same budget is the right one. */
    const room = reportRoom("judge", tokensOut, maxTokens) ? Math.min(24000, maxTokens * 2) : maxTokens;
    const { raw: again } = await ask(missing, room);
    const second = parseJudgements(again, candidates, ids, model.id);
    const t2 = usageTokens(again);
    tokensIn += t2.tokensIn;
    tokensOut += t2.tokensOut;
    /* The first answer wins where it exists. A model asked again about a
       moment it already judged may answer differently, and the verdict that
       was reached with nothing owed is the better of the two. */
    judgements = judgements.map((j, i) => (j.answered ? j : second[i]));
  }

  const unanswered = judgements.filter((j) => !j.answered).length;
  if (unanswered) {
    console.warn(
      `[judge] ${unanswered} of ${candidates.length} moment(s) unanswered after a re-ask ` +
        `(${model.id}) — scored "unrelated", which nobody asserted`,
    );
  }

  return { judgements, tokensIn, tokensOut, model: model.id, unanswered, reasked };
}
