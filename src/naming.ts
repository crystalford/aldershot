/**
 * Naming a cut.
 *
 * > "and sure a video has one cut. it should also automatically name it,
 * > instead of having the file names" — the owner
 *
 * The split this file exists to hold:
 *
 * - A **source** keeps its filename. It is a file you put here, and you find
 *   it again by what you called it on your own disk. `titleFromFilename` says
 *   "never invent a title from content" and that stays true.
 * - A **cut** is a thing you are making, so it is named after what it is
 *   about. `DJI_20260905043337_0026_D` tells you nothing about the piece.
 *
 * A brief still wins outright: if the user said what they wanted, that
 * sentence is the name, because it is what they will recognise. This only
 * fills the silence when nobody said anything.
 */

import type { Env } from "./env.ts";
import { assistantText, usageTokens } from "./grounding.ts";
import { resolveFor } from "./models.ts";
import { meter } from "./usage.ts";
import { runRead } from "./llm.ts";

/**
 * Openers that carry no information about the piece.
 *
 * Every one of these is something people say before they start saying
 * anything — the first six words of a video are almost never the subject of
 * it. Stripped from the front, repeatedly, so "so okay, um, today we're
 * looking at…" reduces to "we're looking at…".
 */
const OPENERS = [
  "so", "ok", "okay", "um", "uh", "erm", "ah", "er", "right", "alright",
  "well", "yeah", "yep", "now", "and", "but", "like", "hey", "hi", "hello",
  "guys", "everyone", "everybody", "folks", "look", "listen", "anyway",
  "basically", "essentially", "actually", "today", "welcome back", "welcome",
  "what's up", "whats up", "in this video", "in this one", "on this channel",
];

/** Words a title should not end on — a title cut mid-thought reads as broken. */
const DANGLING = new Set([
  "a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "at", "for",
  "with", "from", "by", "as", "is", "was", "are", "were", "be", "been", "that",
  "this", "it", "its", "my", "your", "our", "their", "his", "her", "we", "i",
]);

/** How long a title may be before it stops being a title. */
export const MAX_TITLE = 62;

/** Trims trailing dangling words, so a title never ends on "the" or "of". */
function trimDangling(words: string[]): string[] {
  const out = [...words];
  while (out.length > 2 && DANGLING.has(out[out.length - 1].toLowerCase().replace(/[^a-z']/g, ""))) {
    out.pop();
  }
  return out;
}

/**
 * A title from the transcript, with no model involved.
 *
 * This is not a fallback in the apologetic sense — it is what runs when the
 * model is unavailable, when the account is offline, and in every test, so it
 * has to produce something a person would accept. It takes the first thing
 * actually said, minus the throat-clearing.
 */
export function titleFromTranscript(text: string): string {
  let t = text.replace(/\s+/g, " ").trim();
  if (!t) return "";

  // Strip openers from the front until none match. Case-insensitive, and the
  // trailing comma or filler punctuation goes with them.
  for (let changed = true; changed; ) {
    changed = false;
    for (const o of OPENERS) {
      const re = new RegExp(`^${o}\\b[\\s,.!?—-]*`, "i");
      if (re.test(t)) {
        t = t.replace(re, "");
        changed = true;
      }
    }
  }

  /*
   * The first sentence or clause — a title is one idea, not a paragraph.
   *
   * If no boundary is found within the cap, this is not a clause, it is the
   * first eight words of running speech. Naming a video "It confirmed so went
   * to gym finally i'm" is worse than leaving the filename alone, so nothing
   * is returned and the caller keeps what it had. Un-punctuated transcripts
   * are common — this is the normal path, not an edge case.
   */
  const clause = t.split(/(?<=[.!?])\s|,\s|\s—\s|;\s/)[0] ?? t;
  const all = clause.split(" ").filter(Boolean);
  if (all.length > 8) return "";
  let words = trimDangling(all);
  if (words.length < 3) return "";

  let out = words.join(" ").replace(/[.,;:!?—-]+$/, "").trim();
  if (out.length > MAX_TITLE) out = out.slice(0, MAX_TITLE - 1).replace(/\s+\S*$/, "") + "…";
  // Sentence case: lift the first letter, leave the rest as spoken so proper
  // nouns and acronyms survive.
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/**
 * Cleans whatever the model returned into something that can be a title.
 *
 * Small models wrap titles in quotes, prefix them with "Title:", and end them
 * with a full stop. Returns "" for anything that survives none of that, so the
 * caller falls back rather than showing the user a stray fragment.
 */
export function cleanModelTitle(raw: string): string {
  let t = (raw ?? "").replace(/\s+/g, " ").trim();
  t = t.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();
  t = t.replace(/^(title|name)\s*[:—-]\s*/i, "").trim();
  t = t.replace(/[.]+$/, "").trim();
  if (t.length < 3) return "";
  // A paragraph is not a title. Refusals and explanations arrive this way.
  if (t.split(" ").length > 12) return "";
  if (t.length > MAX_TITLE) t = t.slice(0, MAX_TITLE - 1).replace(/\s+\S*$/, "") + "…";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const SYSTEM = `You name video edits. Given a transcript, reply with a short title for the finished piece: two to six words, no quotes, no ending full stop, no "Video about". Name what it is ABOUT, in the speaker's own vocabulary. Reply with the title only.`;

/** How much transcript the model sees. The subject is established early. */
const PROMPT_CHARS = 2400;

/**
 * The least a transcript can say and still be namable.
 *
 * Whisper hallucinates on silence, and its favourite hallucination is
 * "Thank you." — so four silent test clips came back named "Thank you", which
 * a model will faithfully turn into a title because it is the only thing in
 * the transcript. There is nothing to name here, and saying so by leaving the
 * filename is the honest answer.
 */
const MIN_WORDS = 12;

/**
 * The name for a cut, asked of the model, falling back to the transcript.
 *
 * Never throws: a naming failure must not fail the read that produced the
 * transcript. The worst case is the deterministic title, and the worst case
 * after that is "" — which the caller reads as "leave the name alone".
 */
export async function nameCut(env: Env, text: string): Promise<{ title: string; tokensIn: number; tokensOut: number }> {
  const local = titleFromTranscript(text);
  if (text.trim().split(/\s+/).filter(Boolean).length < MIN_WORDS) {
    return { title: "", tokensIn: 0, tokensOut: 0 };
  }

  try {
    const model = resolveFor("name", env);
    const run = (m: string, i: Record<string, unknown>) => runRead(env, "name", m, i);
    const res = await run(model.id, {
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: text.slice(0, PROMPT_CHARS) },
      ],
      /*
       * Room to think, not room to ramble.
       *
       * This was 32 — "a title is short" — and every call came back with
       * completion_tokens exactly 32, i.e. truncated. The reasoning tier
       * spends tokens thinking before it answers, so a budget sized for the
       * ANSWER cuts the model off mid-thought and the answer never arrives.
       * assistantText drops the thinking; the budget has to allow for it.
       *
       * 512 WAS THE SAME GUESS, SIXTEEN TIMES LARGER. It was never checked:
       * the fix was "bigger than 32", and whether a title took 500 tokens
       * of thought or 3000 was nobody's measurement. src/judge.ts has since
       * been caught at 2000 and again at 5300 on this model family. A title
       * is the cheapest call in the product and it falls back to the
       * filename when it fails, so the cost of generosity here is nothing
       * and the cost of meanness is every cut being called untitled.mp4.
       */
      max_tokens: 4000,
    });
    const { tokensIn, tokensOut } = usageTokens(res);
    return { title: cleanModelTitle(assistantText(res)) || local, tokensIn, tokensOut };
  } catch {
    return { title: local, tokensIn: 0, tokensOut: 0 };
  }
}

/**
 * Works out what a source's cut should be called, and remembers it.
 *
 * Runs inside the read, where the transcript is already in memory and where a
 * second of model latency costs nobody anything. The name lands on the SOURCE
 * (`cut_title`), not on a project, because the project does not exist yet: a
 * cut is created lazily on first open, so naming at that moment would put a
 * model call inside a redirect.
 *
 * Never throws. A source that could not be named keeps a null `cut_title` and
 * falls back to its filename, which is exactly today's behaviour.
 */
export async function nameSourceCut(
  env: Env,
  src: { id: string; user_id: string },
  transcript: string,
  jobId?: string,
): Promise<string | null> {
  /* Read the previous name before overwriting it: a cut still carrying it is
     one the product named, not one the user did, so a re-read may replace it.
     Without this a name written once can never be corrected. */
  const before = await env.DB
    .prepare(`SELECT cut_title FROM sources WHERE id=? AND user_id=?`)
    .bind(src.id, src.user_id)
    .first<{ cut_title: string | null }>();

  const { title, tokensIn, tokensOut } = await nameCut(env, transcript);
  if (!title) return null;

  await env.DB.prepare(`UPDATE sources SET cut_title=? WHERE id=? AND user_id=?`)
    .bind(title, src.id, src.user_id)
    .run();

  if (tokensIn || tokensOut) {
    await meter(env.DB, {
      user_id: src.user_id,
      job_id: jobId ?? null,
      job_type: "pass",
      tokens_in: tokensIn,
      tokens_out: tokensOut,
    });
  }

  /*
   * A cut may already exist — the source was re-read, or the user opened it
   * before this finished. Rename only the ones still carrying a placeholder,
   * never one the user typed and never one taken from a brief.
   */
  await env.DB
    .prepare(
      `UPDATE v2_projects SET title=?, updated_at=?
        WHERE source_id=? AND user_id=? AND deleted_at IS NULL
          AND (title='Untitled cut'
               OR title=(SELECT s.title FROM sources s WHERE s.id=v2_projects.source_id)
               /* The name a previous read wrote. NULL here matches nothing,
                  which is the right answer for a source named for the first
                  time — SQL never reports title = NULL as true. */
               OR title=?)`,
    )
    .bind(title, Date.now(), src.id, src.user_id, before?.cut_title ?? null)
    .run();

  return title;
}

/**
 * Names footage that was read before naming existed.
 *
 * A cut_title is written during the read, so everything transcribed from now
 * on arrives named. Nothing already in the library does, and there is no
 * moment in the request path to fix that cheaply: the cut is created inside a
 * redirect, and a model call there would stall a page load.
 *
 * So it happens on the sweep. Bounded per run because this spends money on the
 * model — a library of a thousand unread sources should cost a thousand small
 * calls spread over hours, not one enormous bill at 3am.
 */
export async function nameUnnamedSources(env: Env, limit = 20): Promise<number> {
  const { results } = await env.DB
    .prepare(
      `SELECT id, user_id FROM sources
        WHERE cut_title IS NULL AND transcript_state='ready' AND deleted_at IS NULL
        ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(limit)
    .all<{ id: string; user_id: string }>();

  let named = 0;
  for (const src of results ?? []) {
    try {
      /* The opening is enough to name a piece, and it keeps the read cheap:
         the subject of a video is established in its first minute. */
      const { results: segs } = await env.DB
        .prepare(`SELECT text FROM segments WHERE source_id=? ORDER BY idx LIMIT 40`)
        .bind(src.id)
        .all<{ text: string }>();
      const text = (segs ?? []).map((r) => r.text).join(" ");
      if (!text.trim()) continue;
      if (await nameSourceCut(env, src, text)) named++;
    } catch {
      /* One unreadable source must not stop the sweep. */
    }
  }
  return named;
}
