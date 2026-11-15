/**
 * REDUCE: order what was verified, and refuse to let the model touch it.
 *
 * Spec 18 section 3.7. The last model call in a run, and the only one that
 * sees evidence. Input is the verified and paraphrase rows — a quote, twenty
 * seconds of context either side, the source, the date and the crowd count,
 * at most three hundred tokens each. Output is an order per beat, links
 * between rows that are the same incident, and one line of why each is here.
 *
 * "THE MODEL **MAY NOT** ADD ROWS, CHANGE QUOTES OR CHANGE TIMES." The spec
 * puts that in bold and this file is what makes it true rather than asked
 * for: the model is sent SHORT IDS and returns short ids, and the quotes and
 * times never leave our side of the call. There is no field it could put a
 * quote in and no field it could put a time in. A ranking is an opinion about
 * ordering, which is a thing a model is good at; an edit to a timestamp is
 * invariant 2 and is not on offer.
 *
 * SHORT IDS FOR ESSAY.TS'S REASON. Asked to copy a 26-character ULID, a model
 * describes the right row and mistypes the reference — it was measured in
 * this codebase, on this problem. r1, r2, r3 are copied correctly.
 *
 * AND A ROW THE MODEL FORGOT IS NOT A ROW THAT STOPPED EXISTING. Twelve
 * verified moments ranked as eight is a run that found twelve and reported
 * eight, which is the same silent partial failure invariant 7 calls a P1 —
 * only here it arrives as a shorter list rather than as an error. Anything
 * left out of the ranking goes on the end, in the order it was found.
 */

import type { Env } from "./env.ts";
import { assistantText, usageTokens } from "./grounding.ts";
import { resolveModel } from "./models.ts";
import type { Verdict } from "./scout-verify.ts";
import { runRead } from "./llm.ts";

/** A verified find, as this file needs it. The shape of a `scout_ledger` row. */
export interface LedgerRow {
  id: string;
  beatId: string;
  verify: Verdict;
  quoteExact: string;
  /** Seconds, derived from word ids. Sent for CONTEXT, never returned. */
  tStartS: number;
  tEndS: number;
  contextBefore?: string;
  contextAfter?: string;
  sourceId: string;
  sourceTitle?: string;
  sourceChannel?: string;
  sourceKind?: string;
  publishedAt?: number;
  crowdSignals?: number;
  /** Already known to come from this other row — a traced compilation. */
  originalOf?: string | null;
}

export interface Ranked {
  rowId: string;
  beatId: string;
  /** 1 is the strongest. The ORDER is the output; there is no score. */
  rank: number;
  /** One line, no quote and no timecode in it. */
  why: string | null;
  /** The row this one is a copy of, where that was worked out. */
  originalOf: string | null;
}

export interface Reduction {
  ranked: Ranked[];
  /** Ids the model returned that were never sent. Dropped, and reported. */
  invented: string[];
  /** Rows the model left out. Kept, appended, and reported. */
  forgotten: string[];
  tokensIn: number;
  tokensOut: number;
  model: string;
}

/* ── What the model is allowed to see ───────────────────────────────────── */

/** Spec 3.7's budget per row. */
export const ROW_TOKENS = 300;
/** Context either side, in the prompt. Less than the ninety seconds stored. */
export const PROMPT_CONTEXT_S = 20;
/** A rough character budget for one row, at the usual four characters a token. */
export const ROW_CHARS = ROW_TOKENS * 4;

const clip = (s: string, chars: number) =>
  s.length <= chars ? s : s.slice(0, Math.max(0, chars - 1)).trimEnd() + "…";

/**
 * One row as the model sees it: a short id, a quote, a little context, and
 * where it came from.
 *
 * THE TIMES ARE NOT IN HERE. Not because they would be unhelpful — a model
 * ranking two moments might reasonably want to know one is forty minutes in —
 * but because a model that has seen a timestamp can return one, and a
 * timestamp that came back from a model is a timestamp somebody will
 * eventually believe. Invariant 2 is cheaper to keep than to check.
 *
 * The context is trimmed to twenty seconds' worth rather than the ninety
 * stored, because three hundred tokens is the budget and the provocation is
 * the useful part of it.
 */
export function renderRow(row: LedgerRow, shortId: string): string {
  const where = [row.sourceChannel, row.sourceTitle].filter(Boolean).join(" — ");
  const when = row.publishedAt ? new Date(row.publishedAt).toISOString().slice(0, 10) : "date unknown";
  const crowd = row.crowdSignals ? `, ${row.crowdSignals} people pointed at it` : "";
  const kind = row.sourceKind ? `${row.sourceKind}` : "source";

  /* Roughly four characters a token; the quote keeps its full length and the
     context is what gives way, because the quote is the evidence. */
  const quote = clip(row.quoteExact, Math.floor(ROW_CHARS * 0.5));
  const side = Math.floor((ROW_CHARS - quote.length - where.length - 80) / 2);
  const before = clip(row.contextBefore ?? "", Math.max(0, side));
  const after = clip(row.contextAfter ?? "", Math.max(0, side));

  return [
    `[${shortId}] ${kind}: ${where || "unknown source"} (${when}${crowd})`,
    row.verify === "paraphrase" ? "  NOT WORD FOR WORD — close, and a person has to check it" : "",
    `  quote: "${quote}"`,
    before ? `  before: …${before}` : "",
    after ? `  after: ${after}…` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/* ── The call ───────────────────────────────────────────────────────────── */

const SCHEMA = {
  type: "object",
  properties: {
    beats: {
      type: "array",
      items: {
        type: "object",
        properties: {
          beat_id: { type: "string" },
          /* An ORDER, not scores. Invariant 3 at the schema level: there is
             nowhere to put a number about somebody's conduct. */
          order: { type: "array", items: { type: "string" } },
        },
        required: ["beat_id", "order"],
      },
    },
    why: {
      type: "array",
      items: {
        type: "object",
        properties: { row: { type: "string" }, line: { type: "string" } },
        required: ["row", "line"],
      },
    },
    duplicates: {
      type: "array",
      items: {
        type: "object",
        properties: { copy: { type: "string" }, original: { type: "string" } },
        required: ["copy", "original"],
      },
    },
  },
  required: ["beats", "why", "duplicates"],
} as const;

function systemPrompt(): string {
  return [
    "You are putting verified evidence in order for an editor.",
    "",
    "Each row is a quote somebody actually said, already checked against the",
    "recording word for word. You are deciding WHICH ARE STRONGEST and WHICH",
    "ARE THE SAME INCIDENT. You are not deciding whether they are real.",
    "",
    "Return, for each beat, the row ids in order, strongest first. Strongest",
    "means: the behaviour is plainest in it, it needs least explaining, and",
    "the context around it does not undercut it. A row where the words are",
    "damning and the fifteen seconds before them explain why is NOT a strong",
    "row.",
    "",
    "EVERY ROW YOU WERE GIVEN GOES IN AN ORDER. If you have nothing to say",
    "about one, put it last. Do not leave it out and do not invent an id.",
    "",
    "`duplicates`: where two rows are the SAME MOMENT — a compilation and the",
    "stream it was cut from, a reupload and the original — say which is the",
    "copy and which is the original.",
    "",
    "`why`: one short line per row saying why an editor would look at it.",
    "DO NOT QUOTE THE ROW BACK and do not write a timecode. The quote and the",
    "time are already on the row and they are not yours to restate: say what",
    "it is FOR. “The clearest instance, and nobody is provoking him” is a",
    "line. “At 1:24:30 he says 'get out of my chat'” is not.",
    "",
    "A row marked NOT WORD FOR WORD is close but not exact. Rank it below an",
    "exact one that shows the same thing.",
  ].join("\n");
}

function userPrompt(rows: LedgerRow[], ids: Map<string, string>): string {
  const byBeat = new Map<string, LedgerRow[]>();
  for (const r of rows) {
    const list = byBeat.get(r.beatId) ?? [];
    list.push(r);
    byBeat.set(r.beatId, list);
  }

  const out: string[] = [];
  for (const [beatId, list] of byBeat) {
    out.push(`Beat ${beatId}:`);
    for (const r of list) out.push(renderRow(r, ids.get(r.id)!));
    out.push("");
  }
  return out.join("\n");
}

/* ── Reading the answer, and refusing most of it ────────────────────────── */

/** A timecode in a line the model wrote: "1:24", "01:24:30", "at 84s". */
const TIMECODE = /\b\d{1,3}:\d{2}(?::\d{2})?\b|\b\d+\s?(?:s|sec|secs|seconds|m|min|mins|minutes)\b/i;
/** How long a why-line may be before it is a paragraph. */
export const WHY_CHARS = 160;

/**
 * Is this line something a model may say about a row?
 *
 * It may not quote the row and it may not write a time. Both are the model
 * restating evidence it was shown, and a restated quote is a quote that no
 * longer came from the verifier — the one place in this pipeline where a
 * quote is allowed to come from.
 */
export function usableWhy(line: string, row: LedgerRow): boolean {
  const l = line.trim();
  if (!l || l.length > WHY_CHARS) return false;
  if (TIMECODE.test(l)) return false;
  /* A long run of the quote copied back. Five words is a phrase; a model
     referring to "the chat rules" is fine and quoting a sentence is not. */
  const quoteWords = row.quoteExact.toLowerCase().split(/\s+/).filter(Boolean);
  const lineLower = l.toLowerCase();
  for (let i = 0; i + 5 <= quoteWords.length; i++) {
    if (lineLower.includes(quoteWords.slice(i, i + 5).join(" "))) return false;
  }
  return true;
}

export interface Parsed {
  ranked: Ranked[];
  invented: string[];
  forgotten: string[];
}

/**
 * Reads the answer into an order. Pure and exported: every way this fails is
 * quiet, and three of the ways are the model quietly editing the evidence.
 */
export function parseReduction(response: unknown, rows: LedgerRow[], ids: Map<string, string>): Parsed {
  const text = assistantText(response) || (typeof response === "string" ? response : "");
  let parsed: unknown = response;
  if (text) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    try {
      parsed = JSON.parse(fenced ? fenced[1] : text);
    } catch {
      /* No ranking is not no evidence. Everything was verified before this
         call; what is lost is an opinion about the order. */
      return { ranked: fallbackOrder(rows), invented: [], forgotten: [] };
    }
  }

  const byShort = new Map<string, LedgerRow>();
  for (const r of rows) byShort.set(ids.get(r.id)!, r);

  const obj = (parsed ?? {}) as Record<string, unknown>;
  const invented = new Set<string>();
  const placed = new Set<string>();
  const ranked: Ranked[] = [];

  const whyFor = new Map<string, string>();
  for (const w of Array.isArray(obj.why) ? (obj.why as Array<Record<string, unknown>>) : []) {
    const short = String(w.row ?? "").trim();
    const line = String(w.line ?? "").trim();
    const row = byShort.get(short);
    if (!row) {
      if (short) invented.add(short);
      continue;
    }
    if (usableWhy(line, row)) whyFor.set(short, line);
  }

  /* Duplicates, with the direction decided HERE where it can be. */
  const copyOf = new Map<string, string>();
  for (const d of Array.isArray(obj.duplicates) ? (obj.duplicates as Array<Record<string, unknown>>) : []) {
    const a = String(d.copy ?? "").trim();
    const b = String(d.original ?? "").trim();
    const rowA = byShort.get(a);
    const rowB = byShort.get(b);
    if (!rowA || !rowB) {
      for (const s of [a, b]) if (s && !byShort.has(s)) invented.add(s);
      continue;
    }
    /* A row cannot be a copy of itself, and two rows cannot each be the
       copy — either is a cycle, and a cycle in `original_of` is a board that
       cannot render. */
    if (a === b || copyOf.get(b) === a) continue;
    const [copy, original] = orientDuplicate(rowA, rowB);
    copyOf.set(ids.get(copy.id)!, ids.get(original.id)!);
  }

  for (const b of Array.isArray(obj.beats) ? (obj.beats as Array<Record<string, unknown>>) : []) {
    const order = Array.isArray(b.order) ? (b.order as unknown[]).map((x) => String(x ?? "").trim()) : [];
    for (const short of order) {
      const row = byShort.get(short);
      if (!row) {
        if (short) invented.add(short);
        continue;
      }
      /* The same row listed under two beats is listed once, where it was
         first put — a row belongs to the beat it was found for. */
      if (placed.has(short)) continue;
      placed.add(short);
      ranked.push({
        rowId: row.id,
        beatId: row.beatId,
        rank: 0,
        why: whyFor.get(short) ?? null,
        originalOf: copyOf.has(short) ? (byShort.get(copyOf.get(short)!)?.id ?? null) : (row.originalOf ?? null),
      });
    }
  }

  /* ANYTHING LEFT OUT GOES ON THE END. Twelve verified moments ranked as
     eight is a run that found twelve and reported eight. */
  const forgotten: string[] = [];
  for (const r of rows) {
    const short = ids.get(r.id)!;
    if (placed.has(short)) continue;
    forgotten.push(r.id);
    ranked.push({
      rowId: r.id,
      beatId: r.beatId,
      rank: 0,
      why: whyFor.get(short) ?? null,
      originalOf: copyOf.has(short) ? (byShort.get(copyOf.get(short)!)?.id ?? null) : (r.originalOf ?? null),
    });
  }

  return { ranked: numberWithinBeats(ranked), invented: [...invented], forgotten };
}

/**
 * Which of two rows is the copy.
 *
 * DECIDED HERE, NOT BY THE MODEL, wherever it can be. A compilation is a copy
 * of a stream; a reupload is a copy of anything that is not one. Where the
 * kinds do not settle it, the earlier publication date is the original,
 * because a copy cannot predate the thing it copies. Only when neither
 * applies is the model's own direction used — and by then it is a guess
 * either way.
 */
export function orientDuplicate(a: LedgerRow, b: LedgerRow): [copy: LedgerRow, original: LedgerRow] {
  const rank = (r: LedgerRow) =>
    r.sourceKind === "reupload" ? 2 : r.sourceKind === "compilation" ? 1 : 0;
  if (rank(a) !== rank(b)) return rank(a) > rank(b) ? [a, b] : [b, a];
  if (a.publishedAt && b.publishedAt && a.publishedAt !== b.publishedAt) {
    return a.publishedAt > b.publishedAt ? [a, b] : [b, a];
  }
  return [a, b];
}

/** Ranks run from 1 within each beat, so "strongest" means something per beat. */
function numberWithinBeats(ranked: Ranked[]): Ranked[] {
  const n = new Map<string, number>();
  return ranked.map((r) => {
    const next = (n.get(r.beatId) ?? 0) + 1;
    n.set(r.beatId, next);
    return { ...r, rank: next };
  });
}

/** The order rows were found in, when there is no opinion to apply. */
export function fallbackOrder(rows: LedgerRow[]): Ranked[] {
  return numberWithinBeats(
    rows.map((r) => ({
      rowId: r.id,
      beatId: r.beatId,
      rank: 0,
      why: null,
      originalOf: r.originalOf ?? null,
    })),
  );
}

/** Short ids, assigned in the order rows are sent. r1, r2, r3 — copyable. */
export function shortIds(rows: LedgerRow[]): Map<string, string> {
  return new Map(rows.map((r, i) => [r.id, "r" + (i + 1)]));
}

/**
 * Orders the verified rows.
 *
 * REJECTED ROWS NEVER REACH THE MODEL. Spec 3.7's input is "verified and
 * paraphrase rows". A rejected row is a quote that is not in the source, and
 * putting it in front of a frontier model asking which is strongest is asking
 * it to rank a fabrication — which it will do, convincingly.
 */
export async function reduce(env: Env, rows: LedgerRow[]): Promise<Reduction> {
  const usable = rows.filter((r) => r.verify === "verified" || r.verify === "paraphrase");
  const model = resolveModel("reason", env, "upgrade");

  if (!usable.length) {
    return { ranked: [], invented: [], forgotten: [], tokensIn: 0, tokensOut: 0, model: model.id };
  }

  const ids = shortIds(usable);
  const run = (m: string, i: Record<string, unknown>) => runRead(env, "reduce", m, i);

  const res = await run(model.id, {
    messages: [
      { role: "system", content: systemPrompt() },
      { role: "user", content: userPrompt(usable, ids) },
    ],
    response_format: { type: "json_schema", json_schema: SCHEMA },
    max_tokens: 4000,
  });

  const { tokensIn, tokensOut } = usageTokens(res);
  const { ranked, invented, forgotten } = parseReduction(res, usable, ids);
  return { ranked, invented, forgotten, tokensIn, tokensOut, model: model.id };
}
