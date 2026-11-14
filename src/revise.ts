/**
 * WHEN THE EVIDENCE DISAGREES WITH THE CLAIM.
 *
 * The other half of the angle object. `src/angles.ts` lets a person choose
 * between videos before anything is found; this lets what Scout actually
 * FOUND argue for a different one afterwards.
 *
 * PASS-4-BRIEF calls the gap precisely: "Scout fills a plan's gaps; it
 * cannot change the plan's mind." A verified find can make a better claim
 * visible than any that existed when the plan was written, and until now
 * there was nowhere for that to go — the run reported coverage against the
 * beats it was given and stopped.
 *
 * ── The expensive question, answered locally ─────────────────────────────
 *
 * The brief: "when the thesis changes, what happens to the work already
 * done? ... This is the sharpest unanswered question in the whole brief."
 * And its own corollary: write last, always, so "the loop runs on beats and
 * evidence only, and the script is a terminal step that is never revised,
 * only regenerated. That is a cheap answer if it holds."
 *
 * IT HOLDS HERE, EXCEPT FOR ONE THING. A cut re-produces from rules and
 * moments (invariant 1). Beats re-produce from a claim. Narration is
 * written last over secured pictures, so it regenerates. What does NOT
 * regenerate is a RECORDED TAKE: invariant 6 calls a performance "the one
 * thing in this product you cannot re-make by pressing something".
 *
 * So the whole cost of changing your mind, in this codebase, is the takes
 * hanging off beats the new claim does not want. That is a number we can
 * count, and `priceRevision` counts it. A revision that would orphan three
 * recorded takes has to say so before anyone presses anything — and it
 * still does not delete them, because nothing here deletes.
 *
 * ── What the model is allowed to do ──────────────────────────────────────
 *
 * The same rule src/scout-reduce.ts enforces, for the same reason: "THE
 * MODEL MAY NOT ADD ROWS, CHANGE QUOTES OR CHANGE TIMES." It is sent SHORT
 * IDS and returns short ids. It proposes a claim — prose, which is its job
 * — and points at the evidence that drove it; the quotes and the times
 * never come back from the call, so there is no field it could put a
 * fabricated quote in. A revision citing a quote nobody said would be
 * invariant 4 broken at the exact moment somebody is deciding whether to
 * believe their own video.
 */

import type { Env } from "./env.ts";
import { assistantText, usageTokens } from "./grounding.ts";
import { resolveFor } from "./models.ts";
import { runRead } from "./llm.ts";

/** One of the plan's beats, as the model is allowed to see it. */
export interface Beat {
  /** The short id — b1, b2 — for the reason essay.ts measured: asked to
      copy a 26-character ULID, a model describes the right row and mistypes
      the reference. */
  ref: string;
  name: string;
  need: string;
}

/** One verified find, as the model is allowed to see it. */
export interface Evidence {
  /** The short id — r1, r2 — and the only handle the model is given. */
  ref: string;
  /** The verified quote. Goes out; never comes back. */
  quote: string;
  /** Where it came from, for the model's sense of who is speaking. */
  source?: string | null;
}

export interface Revision {
  /** The claim this evidence argues for instead. */
  claim: string;
  /** One sentence on what changed and why. Shown beside the claim. */
  why: string;
  /**
   * Which of the plan's existing beats the new claim still wants, by short
   * id — b1, b2.
   *
   * The model names them and we count them, which is the same division of
   * labour as the evidence refs: naming is an opinion about a claim, and a
   * model is good at that; the COST of dropping one is a number of recorded
   * takes, and that is ours to count. A beat it does not name is dropped,
   * so forgetting one is expensive in the safe direction — it over-reports
   * the cost rather than hiding it.
   */
  keeps: string[];
  /**
   * Which finds drove it, by short id.
   *
   * Resolved against the rows WE sent, our side of the call. A ref the
   * model invented resolves to nothing and is dropped — see parseRevision.
   */
  drivenBy: string[];
}

/**
 * What accepting it would cost, measured rather than asked.
 *
 * `orphanedTakes` is the only number here that cannot be undone by pressing
 * something, which is why it is the one the UI has to lead with.
 */
export interface Cost {
  /** Beats whose need the new claim still wants. */
  kept: number;
  /** Beats it does not. Nothing is deleted; they stop being asked for. */
  dropped: number;
  /** Recorded takes hanging off those dropped beats. Irreplaceable. */
  orphanedTakes: number;
  /** The sentence a person reads. Never a bare count. */
  says: string;
}

const SCHEMA = {
  type: "object",
  properties: {
    changes: { type: "boolean" },
    claim: { type: "string" },
    why: { type: "string" },
    keeps: { type: "array", items: { type: "string" } },
    drivenBy: { type: "array", items: { type: "string" } },
  },
  required: ["changes", "claim", "why", "keeps", "drivenBy"],
} as const;

function systemPrompt(claim: string, evidence: Evidence[], beats: Beat[]): string {
  return [
    "A video is being made. This is the claim it currently argues:",
    "",
    claim,
    "",
    "Since that claim was written, these moments were found and VERIFIED —",
    "each one is a real thing somebody really said, checked word for word",
    "against the source:",
    "",
    ...evidence.map((e) => `${e.ref}. ${e.source ? `[${e.source}] ` : ""}${e.quote}`),
    "",
    "These are the beats the video currently has:",
    "",
    ...beats.map((b) => `${b.ref}. ${b.name} — ${b.need}`),
    "",
    "Question: does this evidence argue for a DIFFERENT claim?",
    "",
    "Most of the time the answer is no. Evidence that supports the claim,",
    "or that is merely interesting, is not a reason to change it — say so",
    "and stop. Only answer yes when the evidence points somewhere the",
    "current claim cannot go.",
    "",
    "Return:",
    "- changes: true only if the claim should change.",
    "- claim: the claim it should argue instead. When changes is false,",
    "  repeat the current claim unchanged.",
    "- why: one sentence on what the evidence shows that the current claim",
    "  misses. When changes is false, one sentence on why it still holds.",
    "- keeps: the ids of the beats the new claim still wants — b1, b2. A",
    "  beat you leave out is one the video would stop asking for, so leave",
    "  out only what the new claim genuinely does not need.",
    "- drivenBy: the ids of the moments that made the difference — r1, r2.",
    "  Ids only. Do not quote them back, do not give times, and do not",
    "  mention any moment that is not in the list above.",
  ].join("\n");
}

/**
 * Asks whether the evidence argues for a different claim.
 *
 * Returns null when it does not, which is the common and correct answer:
 * a loop that proposes a new thesis every time it is run is noise, and the
 * person would learn to ignore it within a day.
 */
export async function proposeRevision(
  env: Env,
  input: { claim: string; evidence: Evidence[]; beats: Beat[] },
): Promise<{ revision: Revision | null; tokensIn: number; tokensOut: number; model: string }> {
  const model = resolveFor("direct", env);

  /* Nothing verified is nothing to argue from. Not an error — a run that
     found nothing is a run that found nothing, and it must not spend a
     model call to be told so. */
  if (!input.evidence.length) {
    return { revision: null, tokensIn: 0, tokensOut: 0, model: model.id };
  }

  const res = await runRead(env, "revise", model.id, {
    messages: [
      { role: "system", content: systemPrompt(input.claim, input.evidence, input.beats) },
      { role: "user", content: "Does the claim still hold?" },
    ],
    response_format: { type: "json_schema", json_schema: SCHEMA },
    max_tokens: 4000,
  });

  const { tokensIn, tokensOut } = usageTokens(res);
  return {
    revision: parseRevision(res, input.evidence, input.claim, input.beats),
    tokensIn,
    tokensOut,
    model: model.id,
  };
}

/**
 * Reads the answer, and refuses the three ways it can lie.
 *
 * A ref we did not send is dropped — the model cannot cite evidence that
 * does not exist. A claim identical to the one it was given is not a
 * revision however `changes` was set, because a proposal to change nothing
 * shown as a change is a prompt to press a button for no reason. And
 * `changes: false` means no, whatever else came back.
 */
export function parseRevision(
  response: unknown,
  evidence: Evidence[],
  current: string,
  beats: Beat[] = [],
): Revision | null {
  const text = assistantText(response) || (typeof response === "string" ? response : "");
  let parsed: unknown = response;
  if (text) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    try {
      parsed = JSON.parse(fenced ? fenced[1] : text);
    } catch {
      return null;
    }
  }

  const obj = (parsed ?? {}) as {
    changes?: unknown;
    claim?: unknown;
    why?: unknown;
    keeps?: unknown;
    drivenBy?: unknown;
  };
  if (obj.changes !== true) return null;

  const claim = typeof obj.claim === "string" ? obj.claim.trim() : "";
  const why = typeof obj.why === "string" ? obj.why.trim() : "";
  if (!claim || !why) return null;

  /* The same sentence back is not a new thesis. Compared loosely, because
     a model that re-types a claim and changes a comma has not changed its
     mind either. */
  if (same(claim, current)) return null;

  const known = new Set(evidence.map((e) => e.ref));
  const drivenBy = (Array.isArray(obj.drivenBy) ? obj.drivenBy : [])
    .filter((r): r is string => typeof r === "string")
    .map((r) => r.trim())
    .filter((r) => known.has(r));

  /* Beats it named that do not exist are dropped the same way refs are:
     the model works in short ids and cannot invent one that resolves. */
  const realBeats = new Set(beats.map((b) => b.ref));
  const keeps = (Array.isArray(obj.keeps) ? obj.keeps : [])
    .filter((r): r is string => typeof r === "string")
    .map((r) => r.trim())
    .filter((r) => realBeats.has(r));

  /* A revision driven by nothing is an opinion. The whole point is that
     EVIDENCE changed the claim, so a proposal that cannot name which
     evidence is not the thing this module exists to produce. */
  if (!drivenBy.length) return null;

  return { claim, why, keeps, drivenBy };
}

/** Loose sameness: case, spacing and trailing punctuation do not count. */
function same(a: string, b: string): boolean {
  const n = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/[.!?;:,]+$/, "").trim();
  return n(a) === n(b);
}

/**
 * WHAT ACCEPTING IT WOULD COST, counted from the real plan.
 *
 * `wants` is injected for the reason priceAngles injects its lookup: this
 * stays a pure function of its inputs, the caller passes whatever it uses
 * to decide a beat survives, and nothing here can reach for a model to
 * decide what a change costs.
 *
 * The sentence leads with the takes when there are any. A beat is cheap —
 * it re-produces from the claim. A performance is not, and burying that
 * under a beat count would be the one dishonest way to present this.
 */
export function priceRevision(
  beats: Array<{ id: string; need: string }>,
  wants: (need: string) => boolean,
  takesFor: (beatId: string) => number,
): Cost {
  let kept = 0;
  let dropped = 0;
  let orphanedTakes = 0;

  for (const beat of beats) {
    if (wants(beat.need)) {
      kept += 1;
      continue;
    }
    dropped += 1;
    orphanedTakes += takesFor(beat.id);
  }

  return { kept, dropped, orphanedTakes, says: costLine(kept, dropped, orphanedTakes) };
}

/** The cost as a person reads it. Takes first, because takes are the cost. */
export function costLine(kept: number, dropped: number, orphanedTakes: number): string {
  if (!dropped) return "Every beat you have survives this — nothing you have recorded is affected.";

  const beats = `${dropped} beat${dropped === 1 ? "" : "s"} would stop being asked for`;
  const rest = `, and ${kept} would carry over`;

  if (!orphanedTakes) return `${beats}${rest}. Nothing you have recorded is affected.`;

  /*
   * The takes go first and the sentence says KEPT rather than lost, because
   * they are kept: invariant 6 means nothing is deleted, and a take whose
   * beat is gone is still a take you can hear. What it stops being is part
   * of this video — which is the true and smaller claim.
   */
  return (
    `${orphanedTakes} take${orphanedTakes === 1 ? "" : "s"} you recorded ` +
    `${orphanedTakes === 1 ? "is" : "are"} for ${beats.replace(" would stop being asked for", " this drops")}. ` +
    `${orphanedTakes === 1 ? "It is" : "They are"} kept and still playable; ` +
    `${orphanedTakes === 1 ? "it" : "they"} would just not be in this video. ` +
    `${kept} beat${kept === 1 ? "" : "s"} carry over.`
  );
}
