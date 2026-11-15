/**
 * The second verb.
 *
 * A pass could do exactly one thing: pick spans and either keep them or cut
 * them (src/score.ts). That is a good verb and it is only one, which is why
 * the assistant read as a search box however it was dressed — "it's like a
 * chatbot LLM powered video editing system that also is like blocks, blocking
 * instead of non-linear video editing" needs the chat to be able to do the
 * things the blocks can do.
 *
 * Blocks can be reordered — `block_order` on the project, `moveBlock` in
 * src/blocks.ts, and two arrows on every row — and nothing has ever exposed
 * that to a sentence. "Put the punchline first" is the most obvious thing to
 * say to a video editor and the product could not hear it.
 *
 * Nothing here renders, encodes or destroys. A reorder writes one column, the
 * same one the arrows write, so it is undone by the same snapshot every other
 * pass keeps.
 */

import type { Env } from "./env.ts";
import { resolveFor } from "./models.ts";
import { usageTokens } from "./grounding.ts";
import type { Block } from "./blocks.ts";
import { runRead } from "./llm.ts";

/**
 * Does this sentence mean "change the order"?
 *
 * Deterministic and testable, for the same reason `actionFor` is: JSON mode
 * here is not constrained decoding, and asking a model to classify the
 * instruction that decides which model call to make is a circle. The sentence
 * says.
 *
 * A selection or removal verb wins outright. "Cut the bit where I move house"
 * contains "move" and is not a reorder; "keep only the ones at the start" is
 * a selection. Getting this backwards would rearrange somebody's video when
 * they asked to trim it, which is the failure worth designing against.
 */
export function wantsArrange(instruction: string): boolean {
  const t = instruction.toLowerCase().trim();
  if (!t) return false;

  /* What the sentence OPENS with is what it is about. */
  if (/^(cut|remove|drop|delete|lose|get rid of|take out|strip|keep|find|only|just|show|give me)\b/.test(t)) {
    return false;
  }
  /* ...and an explicit removal phrase anywhere still wins. */
  if (/\b(also cut|and cut|cut out|cut all|cut every|remove all|remove every)\b/.test(t)) return false;

  return /\b(reorder|re-?order|rearrange|re-?arrange|resequence|sort|shuffle|swap|move|put|start with|open with|lead with|end with|close with|finish with|first|last|up front|to the top|to the end)\b/.test(
    t,
  );
}

/**
 * How many lines this will try to arrange.
 *
 * A reorder over four hundred blocks is not an edit anybody meant, and the
 * whole list has to go into one prompt for the model to have an opinion about
 * the order. So it works on what is KEPT — which after a cut pass is usually
 * a handful — and says plainly when there is too much rather than silently
 * arranging the first eighty.
 */
export const ARRANGE_MAX = 80;

const SCHEMA = {
  type: "object",
  properties: {
    order: { type: "array", items: { type: "integer" } },
  },
  required: ["order"],
} as const;

const SYSTEM = [
  "You put the lines of a video cut into a better order.",
  "",
  "You are given numbered lines, in their current order.",
  'Answer with {"order": [...]}, the SAME numbers, every one of them exactly',
  "once, in the order they should now play.",
  "",
  "Move as little as possible. If the instruction only concerns one line,",
  "move that line and leave everything else where it is.",
  "Never invent, drop or duplicate a number.",
].join("\n");

/**
 * The model's order, validated into a permutation.
 *
 * A model that drops a line would delete it from the cut, and one that
 * repeats a line would show it twice — so an answer is only used when it is
 * exactly the set it was given. Anything else is refused, and the caller says
 * the pass found nothing rather than half-applying it.
 */
export function permutationOf(raw: unknown, count: number): number[] | null {
  const list = Array.isArray(raw) ? raw : null;
  if (!list || list.length !== count) return null;

  const seen = new Set<number>();
  const out: number[] = [];
  for (const v of list) {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isInteger(n) || n < 0 || n >= count || seen.has(n)) return null;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/** Pulls `order` out of whatever shape the model answered in. */
export function parseOrderAnswer(res: unknown): unknown {
  const r = res as { response?: unknown; result?: { response?: unknown } } | null;
  const body = r?.response ?? r?.result?.response ?? res;
  if (body && typeof body === "object" && "order" in (body as Record<string, unknown>)) {
    return (body as { order: unknown }).order;
  }
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body) as { order?: unknown };
      return parsed?.order;
    } catch {
      /* A model that answered prose has not answered. */
      return null;
    }
  }
  return null;
}

export interface Arranged {
  /** The block ids in their new order, or null when nothing usable came back. */
  order: string[] | null;
  /** How many lines actually changed place, for the sentence in the log. */
  moved: number;
  tokensIn: number;
  tokensOut: number;
}

/**
 * Ask for a new order, and give back one that is safe to write.
 *
 * `blocks` is the cut as it currently reads — kept lines, in order. The ids
 * that come back are exactly those ids, rearranged, so the caller writes them
 * to `block_order` without any further thought.
 */
export async function runArrange(
  env: Env,
  instruction: string,
  blocks: Block[],
): Promise<Arranged> {
  const none: Arranged = { order: null, moved: 0, tokensIn: 0, tokensOut: 0 };
  if (blocks.length < 2 || blocks.length > ARRANGE_MAX) return none;

  const model = resolveFor("arrange", env);
  const run = (m: string, i: Record<string, unknown>) => runRead(env, "arrange", m, i);

  const lines = blocks
    .map((b, i) => `${i}. ${(b.text ?? b.words.map((w) => w.w).join(" ")).slice(0, 200)}`)
    .join("\n");

  let res: unknown;
  try {
    res = await run(model.id, {
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `What the user asked for: ${instruction}\n\nLines:\n${lines}` },
      ],
      response_format: { type: "json_schema", json_schema: SCHEMA },
      /*
       * 2000 is the number src/judge.ts was caught at, on the same model
       * family and for the same kind of work — read a numbered list, decide
       * an order, answer with indices. Ordering n blocks is more thinking
       * than judging one claim, not less, and a cut-off answer here does not
       * fail loudly: `permutationOf` repairs a short or broken order into a
       * valid one, so a truncated call arrives as a plausible arrangement
       * nobody chose. Raised on that argument; `runRead` is what will say
       * whether it is still too mean.
       */
      max_tokens: 8000,
    });
  } catch {
    return none;
  }

  const perm = permutationOf(parseOrderAnswer(res), blocks.length);
  const used = usageTokens(res);
  if (!perm) return { ...none, tokensIn: used.tokensIn, tokensOut: used.tokensOut };

  const moved = perm.reduce((n, from, to) => n + (from === to ? 0 : 1), 0);
  return {
    order: perm.map((i) => blocks[i].id),
    moved,
    tokensIn: used.tokensIn,
    tokensOut: used.tokensOut,
  };
}
