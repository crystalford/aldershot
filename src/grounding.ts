/**
 * Grounding — the layer between what the model said and what the user sees.
 *
 * Deliberately dependency-free: no AI client, no env, no bindings. It takes
 * whatever the model returned and the transcript we already have, and produces
 * clips that are guaranteed to point at real footage. That independence is
 * what makes it directly testable (see test/score.test.ts), and this is the
 * code most worth testing in the product.
 *
 * The rule it enforces: the model supplies WHERE and WHY. The quote is rebuilt
 * from our own segments, so a line the model invented can never reach the UI.
 */

import type { Segment } from "./sources.ts";

export interface ScoredClip {
  start_ms: number;
  end_ms: number;
  quote: string;
  /*
   * Null when the clip was hand-picked. 03-DATA-MODEL.md says so of `score`
   * ("null when hand-picked"), and the same is true of the other three: a
   * model supplies a reason and a score, a person does not. Requiring them
   * would force a made-up score onto a clip a human chose, which is exactly
   * the kind of invented number the cost panel and the feed avoid elsewhere.
   */
  why: string | null;
  score: number | null;
  heat: number | null;
}

/**
 * Pulls the assistant's text out of a Workers AI response.
 *
 * The catalog is not consistent about this and the model is swappable, so both
 * shapes are handled:
 *  - `{ response: "..." }`      — the older text-generation models
 *  - `{ choices: [{ message: { content } }] }` — the OpenAI-compatible shape
 *    the newer models use (glm, deepseek, gemma…)
 *
 * Reasoning models also return `reasoning_content` alongside `content`. That is
 * the model thinking aloud, never the answer, and is deliberately ignored.
 */
export function assistantText(res: unknown): string {
  if (typeof res === "string") return res;
  if (!res || typeof res !== "object") return "";
  const r = res as {
    response?: unknown;
    choices?: { message?: { content?: unknown } }[];
  };
  if (typeof r.response === "string") return r.response;
  const content = r.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  // Some models return content as an array of parts.
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof p === "string" ? p : ((p as { text?: string })?.text ?? "")))
      .join("");
  }
  return "";
}

/**
 * Reads the token counts, whichever shape the response came in.
 */
export function usageTokens(res: unknown): { tokensIn: number; tokensOut: number } {
  /*
   * TWO PROVIDERS, TWO NAMES FOR THE SAME NUMBER.
   *
   * Workers AI reports prompt_tokens/completion_tokens; Anthropic reports
   * input_tokens/output_tokens. This read only the first pair, so an
   * Anthropic call metered zero tokens and therefore zero cost — not a
   * mispriced row, an absent one. Correct prices over absent data is still a
   * free call, and the spend cap counts what the ledger says.
   *
   * Both shapes, one function, because the alternative is every call site
   * knowing which provider answered it.
   */
  const u = (
    res as {
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        input_tokens?: number;
        output_tokens?: number;
      };
    }
  )?.usage;
  const n = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    tokensIn: n(u?.prompt_tokens ?? u?.input_tokens),
    tokensOut: n(u?.completion_tokens ?? u?.output_tokens),
  };
}

/**
 * Pulls the clip list out of whatever the model returned. Handles the object
 * form, a bare array, and a JSON string — all of which these models emit
 * depending on mood, since JSON mode is a request rather than a guarantee.
 */
export function parseClips(response: unknown): Partial<ScoredClip>[] {
  // Unwrap the transport shape first, then parse whatever text came back.
  let value: unknown =
    typeof response === "string" || Array.isArray(response) ? response : (assistantText(response) || response);
  if (typeof value === "string") {
    const text = value.trim();
    // Models sometimes wrap JSON in a ```json fence despite being asked not to.
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    try {
      value = JSON.parse(fenced ? fenced[1] : text);
    } catch {
      return [];
    }
  }
  if (Array.isArray(value)) return value as Partial<ScoredClip>[];
  if (value && typeof value === "object" && Array.isArray((value as { clips?: unknown }).clips)) {
    return (value as { clips: Partial<ScoredClip>[] }).clips;
  }
  return [];
}

/**
 * Forces every clip onto real ground.
 *
 * The model supplies WHERE and WHY; the quote is rebuilt from the segments we
 * already have, so a hallucinated line cannot reach the user. Ranges outside
 * the transcript are dropped rather than clamped — a timecode the model
 * invented is not evidence of anything.
 */
export function groundClips(raw: Partial<ScoredClip>[], segments: Segment[]): ScoredClip[] {
  if (!segments.length) return [];
  const firstMs = segments[0].start_ms;
  const lastMs = segments[segments.length - 1].end_ms;

  const out: ScoredClip[] = [];
  for (const c of raw) {
    const start = Number(c.start_ms);
    const end = Number(c.end_ms);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    if (end < firstMs || start > lastMs) continue;

    const covered = segments.filter((s) => s.end_ms > start && s.start_ms < end);
    if (!covered.length) continue;

    /*
     * SNAP TO THE TRANSCRIPT, do not trust the model's milliseconds.
     *
     * The range used to be whatever the model said, while the quote was built
     * from every segment that range touched. So the text read as whole
     * sentences and the cut began mid-word — a block would end "...so like I
     * have six" and the video would start halfway through a word. Taking the
     * covered segments' own edges makes the range and the words the same
     * thing, which is the entire premise of editing by reading.
     */
    out.push({
      start_ms: Math.max(firstMs, covered[0].start_ms),
      end_ms: Math.min(lastMs, covered[covered.length - 1].end_ms),
      quote: covered.map((s) => s.text).join(" ").trim(),
      why: String(c.why ?? "").trim(),
      score: clamp(Number(c.score), 0, 100, 0),
      heat: clamp(Number(c.heat), 0, 2, 0),
    });
  }

  return dedupeOverlaps(out.sort((a, b) => a.start_ms - b.start_ms), segments);
}

/**
 * Makes the kept blocks a sequence rather than a pile.
 *
 * The model returns ranges that overlap — one block ending at 3:33 and the
 * next starting at 3:18 — and nothing was resolving them, so the same dialogue
 * appeared in two consecutive blocks and would have played twice in the cut.
 * The owner spotted it immediately, which is the right reaction: a cut is an
 * ordered sequence, and the same words cannot be in it twice.
 *
 * A clip that starts before the previous one ends is trimmed forward to the
 * next segment boundary at or after that end. If trimming leaves nothing, the
 * clip was wholly contained in its predecessor and is dropped — its content is
 * already in the cut.
 */
function dedupeOverlaps(clips: ScoredClip[], segments: Segment[]): ScoredClip[] {
  const out: ScoredClip[] = [];
  let lastEnd = -1;

  for (const c of clips) {
    if (c.start_ms >= lastEnd) {
      out.push(c);
      lastEnd = c.end_ms;
      continue;
    }

    // First segment that begins at or after the previous block ended.
    const from = segments.find((s) => s.start_ms >= lastEnd && s.start_ms < c.end_ms);
    if (!from) continue;

    const kept = segments.filter((s) => s.start_ms >= from.start_ms && s.end_ms <= c.end_ms);
    if (!kept.length) continue;

    out.push({
      ...c,
      start_ms: kept[0].start_ms,
      end_ms: kept[kept.length - 1].end_ms,
      quote: kept.map((s) => s.text).join(" ").trim(),
    });
    lastEnd = kept[kept.length - 1].end_ms;
  }

  return out;
}

function clamp(n: number, lo: number, hi: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}
