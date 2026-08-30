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
  why: string;
  score: number;
  heat: number;
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
  const u = (res as { usage?: { prompt_tokens?: number; completion_tokens?: number } })?.usage;
  return { tokensIn: u?.prompt_tokens ?? 0, tokensOut: u?.completion_tokens ?? 0 };
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

    out.push({
      start_ms: Math.max(firstMs, Math.round(start)),
      end_ms: Math.min(lastMs, Math.round(end)),
      quote: covered.map((s) => s.text).join(" ").trim(),
      why: String(c.why ?? "").trim(),
      score: clamp(Number(c.score), 0, 100, 0),
      heat: clamp(Number(c.heat), 0, 2, 0),
    });
  }
  return out.sort((a, b) => a.start_ms - b.start_ms);
}

function clamp(n: number, lo: number, hi: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}
