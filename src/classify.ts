/**
 * WHICH JOB THIS LINE'S PICTURE HAS — doc 08, step one.
 *
 * "Classify each line's move: CLAIM · EVIDENCE · TURN · CONTEXT · EXAMPLE ·
 * ABSTRACTION · JOKE · TRANSITION · CONCLUSION." Everything downstream of
 * this is already built and tested: the move sets the picture's job, its
 * source order and what it may never have (src/pictures.ts).
 *
 * THE ONE PART THAT NEEDS A MODEL, which is why it is its own file and its
 * own capability. What a line is DOING is not something a regex knows —
 * "the rent halves" is a claim, evidence or an example depending entirely
 * on what is around it.
 *
 * BUT NOT EVERY LINE. A line that is housekeeping is a transition, and that
 * IS a regex — src/moment-tags.ts has had the patterns since the first
 * scoring pass. The house rule is that anything which can be a measurement
 * is not a model call, so those never reach one.
 *
 * AND AN UNANSWERED LINE IS A CLAIM, deliberately. A move decides what a
 * picture may be, so getting it wrong in the permissive direction is how a
 * generated picture ends up over somebody's proof. `claim` wants the
 * speaker's own footage and nothing else, and doc 08 says the face is
 * usually the strongest picture for one anyway — so the failure mode of
 * this whole file is "it held on the speaker", which is a result rather
 * than a mistake.
 */

import type { Env } from "./env.ts";
import { assistantText, usageTokens } from "./grounding.ts";
import { resolveModel } from "./models.ts";
import { callReason } from "./llm.ts";
import { MOVES, type Move } from "./pictures.ts";
import { momentTags } from "./moment-tags.ts";

/** Tagged on every classification, so a model swap is visible in the rows. */
export const CLASSIFY_VERSION = "classify-1";

/**
 * WHAT AN UNANSWERED LINE IS.
 *
 * The most restrictive move, on purpose — see the file header. Changing
 * this to anything that allows a generated picture changes what this file
 * can do wrong from "held on the speaker" to "invented a picture over a
 * claim".
 */
export const UNSURE: Move = "claim";

export interface Line {
  id: string;
  text: string;
}

export interface Classified {
  id: string;
  move: Move;
  /** True when a person or a rule decided it, rather than the model. */
  certain: boolean;
  /** Why, in a few words. Null when nothing said. */
  why: string | null;
  model: string;
  version: string;
}

/* ── The half that is not a model call ──────────────────────────────────── */

/**
 * Lines whose move is readable without asking anybody.
 *
 * Only housekeeping, and only because the patterns already exist and are
 * already trusted elsewhere in this product. A longer list of clever
 * guesses here would be the gavel problem one level up: a rule matching
 * nouns, deciding what a picture may be.
 */
export function knownMove(text: string): { move: Move; why: string } | null {
  const t = text.trim();
  if (!t) return { move: "transition", why: "there are no words in it" };
  if (momentTags({ quote: t }).includes("housekeeping")) {
    return { move: "transition", why: "it is housekeeping, not part of the argument" };
  }
  return null;
}

/* ── The prompt ─────────────────────────────────────────────────────────── */

export function systemPrompt(): string {
  return [
    "You say what job each line of a video is doing, so the editor knows what",
    "kind of picture may go over it. One answer per line.",
    "",
    "  claim        — it asserts something. The speaker is the picture.",
    "  evidence     — it IS the proof: a document, a number read out, a quote.",
    "  turn         — it goes back on, or against, what was just said.",
    "  context      — where, when, who. Orientation.",
    "  example      — one specific instance of a general point.",
    "  abstraction  — a pattern, a comparison, numbers in relation.",
    "  joke         — it is there to land, not to argue.",
    "  transition   — getting from one thing to the next. Housekeeping.",
    "  conclusion   — where it lands.",
    "",
    "Rules:",
    "- Judge what the line DOES, not what it is about.",
    "- A line that merely mentions a document is a claim; evidence is the",
    "  document being read or shown.",
    "- When two fit, pick the one that would need the stronger picture.",
    "- Answer for every line you are given, once each.",
    "- Say why in four or five words, never by quoting the line back.",
  ].join("\n");
}

export function userPrompt(lines: Line[], ids: Map<string, string>): string {
  return ["LINES:", ...lines.map((l) => `${ids.get(l.id)}: ${l.text}`)].join("\n");
}

/** l1, l2, l3 — for the reason scout-reduce.ts measured on these models. */
export function shortIds(lines: Line[]): Map<string, string> {
  return new Map(lines.map((l, i) => [l.id, `l${i + 1}`]));
}

const SCHEMA = {
  type: "object",
  properties: {
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          line: { type: "string" },
          move: { type: "string", enum: [...MOVES] },
          why: { type: "string" },
        },
        required: ["line", "move"],
      },
    },
  },
  required: ["lines"],
} as const;

/* ── Reading the answer ─────────────────────────────────────────────────── */

/** A few words, and not the line copied back. */
export const WHY_CHARS = 60;

export function usableWhy(why: string, text: string): boolean {
  const w = why.trim();
  if (!w || w.length > WHY_CHARS) return false;
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const lower = w.toLowerCase();
  for (let i = 0; i + 4 <= words.length; i += 1) {
    if (lower.includes(words.slice(i, i + 4).join(" "))) return false;
  }
  return true;
}

/**
 * The answer, as one move per line — pure, and exported, because every way
 * this fails is quiet.
 *
 * A LINE THE MODEL SKIPPED IS NOT A LINE WITHOUT A PICTURE. It gets UNSURE,
 * which is the most restrictive move, so a short answer costs a picture
 * rather than letting one through unchecked.
 */
export function parseMoves(response: unknown, lines: Line[], ids: Map<string, string>, model: string): Classified[] {
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

  const byShort = new Map<string, Line>();
  for (const l of lines) byShort.set(ids.get(l.id)!, l);

  const said = new Map<string, Classified>();
  const rows = (parsed as { lines?: unknown })?.lines;
  for (const r of Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : []) {
    const line = byShort.get(String(r.line ?? "").trim());
    /* A short id for a line we did not send: an answer about nothing. */
    if (!line || said.has(line.id)) continue;

    const raw = String(r.move ?? "");
    const move = (MOVES as readonly string[]).includes(raw) ? (raw as Move) : UNSURE;
    const why = String(r.why ?? "").trim();
    said.set(line.id, {
      id: line.id,
      move,
      certain: false,
      why: usableWhy(why, line.text) ? why : null,
      model,
      version: CLASSIFY_VERSION,
    });
  }

  return lines.map(
    (l) =>
      said.get(l.id) ?? {
        id: l.id,
        move: UNSURE,
        certain: false,
        why: null,
        model,
        version: CLASSIFY_VERSION,
      },
  );
}

/* ── The capability ─────────────────────────────────────────────────────── */

export interface ClassifyResult {
  lines: Classified[];
  tokensIn: number;
  tokensOut: number;
  model: string;
}

/**
 * Classify every line of a cut.
 *
 * In ONE call, because a move is a statement about a line IN CONTEXT — a
 * turn is only a turn against what came before it, and a conclusion is only
 * one at the end. Asked line by line, every one of them is a claim.
 *
 * The lines a regex already knows never reach the model, and come back
 * marked `certain`.
 */
export async function classify(env: Env, lines: Line[]): Promise<ClassifyResult> {
  const model = resolveModel("reason", env, "upgrade");
  if (!lines.length) return { lines: [], tokensIn: 0, tokensOut: 0, model: model.id };

  const known = new Map<string, Classified>();
  const ask: Line[] = [];
  for (const l of lines) {
    const k = knownMove(l.text);
    if (k) {
      known.set(l.id, {
        id: l.id,
        move: k.move,
        certain: true,
        why: k.why,
        model: "",
        version: CLASSIFY_VERSION,
      });
    } else ask.push(l);
  }

  if (!ask.length) {
    return { lines: lines.map((l) => known.get(l.id)!), tokensIn: 0, tokensOut: 0, model: model.id };
  }

  /*
   * THE WHOLE CUT GOES IN THE PROMPT, including the lines a regex already
   * answered. A turn is only a turn against what came before it, and
   * leaving housekeeping out of the list would hide the thing the next
   * line turns away from — the context is the point of asking in one call.
   *
   * The regex's answers still win on the way out: they are facts about the
   * words, and the model is being asked for the ones that are not.
   */
  const ids = shortIds(lines);
  /* Through callReason: the resolved provider decides who is spoken to, and
     this used to hand an Anthropic model id to Workers AI. */
  const { raw: res } = await callReason(env, model, {
    system: systemPrompt(),
    user: userPrompt(lines, ids),
    maxTokens: 3000,
    schema: SCHEMA,
  });

  const { tokensIn, tokensOut } = usageTokens(res);
  const answered = new Map(parseMoves(res, lines, ids, model.id).map((c) => [c.id, c]));
  return {
    lines: lines.map((l) => known.get(l.id) ?? answered.get(l.id)!),
    tokensIn,
    tokensOut,
    model: model.id,
  };
}
