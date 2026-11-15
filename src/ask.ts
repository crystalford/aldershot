/**
 * ASK IT ANYTHING ABOUT YOUR FOOTAGE, AND IT ANSWERS WITH THE LINES, TIMED.
 *
 * That sentence is the Manual's, from the front door, and CLAUDE.md names it
 * as one of two things the Manual weights and the handoff does not — "in the
 * second paragraph of what the product is", and not built. The handoff calls
 * the same thing "search in the conversation" and leaves it as Phase 4's one
 * remaining item.
 *
 * THE ANSWER IS THE LINES. No model writes a paragraph here. That is not a
 * simplification, it is the product: a question about your own footage has an
 * answer only if somebody said it, and the honest form of that answer is the
 * sentences they said with the times they said them. A prose summary would be
 * the one thing invariant 2 and src/grounding.ts both forbid — the model
 * supplying WHERE and WHY while the words stay ours.
 *
 * SO THERE IS NO SUMMARISING CALL, and the cost of the whole feature is one
 * retrieval and one judge. The judge already answers exactly the question an
 * ask needs — does this moment back this claim, and which sentence does it —
 * so the pipeline is the one `src/beat-find.ts` already runs for a beat. The
 * difference is only in what is kept: a beat needs coverage and throws the
 * line away, and here the line IS the deliverable.
 *
 * "NOTHING IN YOUR FOOTAGE SAYS THAT" IS AN ANSWER. Invariant 4 requires it
 * to be reachable, and an ask is where a person meets it most often: most
 * questions about an hour of talking have no answer in the hour. An empty
 * `lines` with something in `nearby` is the common case and it is not a
 * failure — it is the difference between a library and a search engine that
 * always returns ten things.
 */

import type { Env } from "./env.ts";
import { clock, findMaterial } from "./assemble.ts";
import { judge, type Judgement } from "./judge.ts";
import { rerank } from "./judge.ts";
import type { Moment } from "./library.ts";

/**
 * How many moments the judge reads for one question.
 *
 * The same six `beat-find.ts` uses, and for the same reason: the comparison
 * is the work, and a judge shown six at once can see which one actually says
 * it. More would be a longer prompt for a question whose answer is usually
 * one line or none.
 */
export const PER_ASK = 6;

export interface AnswerLine {
  momentId: string;
  sourceId: string;
  sourceTitle: string;
  /**
   * The sentence that does the backing, REBUILT FROM OUR OWN TEXT.
   *
   * Null when the judge pointed at nothing, which for a `backs` verdict
   * cannot happen — `parseJudgements` downgrades that to `related` — so a
   * null here belongs to a `nearby` line and means "the whole moment is the
   * answer to what it is near".
   */
  line: string | null;
  /** The whole moment, because a line out of context can mislead. */
  quote: string;
  /**
   * WHERE IT IS, from the moment's own span and never from the model.
   *
   * Invariant 2. `start_ms` was derived from word ids when the moment was
   * made; the judge is not asked for a time and has nowhere to put one.
   */
  atMs: number;
  atLabel: string;
  /** The judge's own line on what the sentence establishes. Never a quote. */
  why: string | null;
}

export interface Answer {
  question: string;
  /** The lines that back it, best first. Empty is a real answer. */
  lines: AnswerLine[];
  /**
   * On the subject and not the answer, kept separate and labelled.
   *
   * Shown because a person who asked a question that has no answer still
   * wants to know their footage was read — but never mixed in with `lines`,
   * because a near miss presented as an answer is the false support the
   * whole judge exists to stop.
   */
  nearby: AnswerLine[];
  /** How retrieval found them, or that it found nothing at all. */
  how: "meaning" | "words" | "none";
  /**
   * True when the judge could not be reached.
   *
   * `lines` is then empty and that is NOT "nothing backs this" — it is "we
   * did not check", which is a different sentence for the UI to say. Reading
   * one as the other is how a person gets told their footage lacks something
   * it contains.
   */
  unchecked: boolean;
}

const lineFor = (m: Moment, j: Judgement | undefined): AnswerLine => ({
  momentId: m.id,
  sourceId: m.source_id,
  sourceTitle: m.source_title,
  line: j?.line ?? null,
  quote: m.quote,
  atMs: m.start_ms,
  atLabel: clock(m.start_ms),
  why: j?.why ?? null,
});

/**
 * Answer a question out of one person's own library.
 *
 * Retrieval is `findMaterial`, which is hybrid and reaches everything —
 * and its `recent` fallback is refused here for the same reason
 * `beat-find.ts` refuses it: "your most recent moments" is what that
 * function returns when a query matched nothing, and handing those back as
 * the answer to a question is the lie this feature is most able to tell.
 */
export async function ask(env: Env, userId: string, question: string): Promise<Answer> {
  const q = question.trim();
  const empty: Answer = { question: q, lines: [], nearby: [], how: "none", unchecked: false };
  if (!q) return empty;

  const found = await findMaterial(env, userId, q, PER_ASK);
  if (found.how === "recent" || !found.moments.length) return empty;

  let verdicts: Judgement[] = [];
  let unchecked = false;
  try {
    const asked = await judge(env, q, found.moments.map((m) => ({ id: m.id, quote: m.quote })));
    verdicts = asked.judgements;
  } catch {
    /*
     * Belt and braces: the `!answered.length` guard below catches a thrown
     * call too, because a throw leaves `verdicts` empty. Breaking this line
     * on purpose fails no test for exactly that reason, which is recorded
     * here rather than left as a test that could not be written — the same
     * note src/judge.ts leaves on its own range checks. It stays because it
     * says what is being handled, and because the two would stop being
     * redundant the moment a partial answer could survive an error.
     */
    unchecked = true;
  }

  /*
   * `answered`, not "is there a row". parseJudgements fills every gap with
   * `unrelated` so a short answer cannot shrink the set, which means a call
   * that said nothing arrives as a full list of confident `unrelated`s.
   * Reading those as verdicts would tell somebody their footage does not
   * contain a thing nobody looked for. The same trap beat-find.ts documents.
   */
  const answered = verdicts.filter((v) => v.answered);
  if (!unchecked && !answered.length) unchecked = true;

  const by = new Map(answered.map((v) => [v.id, v]));
  const ordered = rerank(found.moments, verdicts);
  const lines: AnswerLine[] = [];
  const nearby: AnswerLine[] = [];

  for (const m of ordered) {
    const j = by.get(m.id);
    /* An unchecked run puts everything in `nearby`: it was retrieved, which
       is true, and nothing says it answers the question, which is also
       true. */
    if (!unchecked && j?.said === "backs") lines.push(lineFor(m, j));
    else if (unchecked || j?.said === "related") nearby.push(lineFor(m, j));
  }

  return { question: q, lines, nearby, how: found.how, unchecked };
}

/**
 * The sentence the room says above the lines.
 *
 * Here rather than in the page because it is the one piece of this feature
 * that could become a lie: four states that read almost the same and mean
 * different things, and a UI that collapsed any two of them would be the
 * failure invariant 4 is about. No percentage, no score — invariant 3.
 */
export function answerLead(a: Answer): string {
  if (a.unchecked) {
    return a.nearby.length
      ? "Found these in your footage, but could not check them against the question."
      : "Could not check your footage just now.";
  }
  if (a.lines.length) {
    const n = a.lines.length;
    return n === 1 ? "One line in your footage says it." : `${n} lines in your footage say it.`;
  }
  if (a.nearby.length) {
    return "Nothing in your footage says that. These are the nearest things to it.";
  }
  return "Nothing in your footage is about that.";
}
