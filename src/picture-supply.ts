/**
 * WHAT COULD GO ON THIS LINE — the picture supply.
 *
 * `src/pictures.ts` is doc 08's table: the move's visual job, invariant 8's
 * source order, and the refusals as tested functions. It has been complete
 * and unreachable. `allowed()` bites at the beat insert, so a person who
 * asks for a generated card over a claim is refused — and nothing in the
 * product ever OFFERED a picture, so `place()` and `reasonFor()` had no
 * candidates and were alive only in their tests.
 *
 * This is the other half: real rows turned into candidates, so the framework
 * chooses between things that exist.
 *
 * TWO OF THE FOUR SOURCES HAVE DATA TODAY, and the offer says which two
 * rather than quietly listing what it found. A person who wonders why no
 * document was suggested is owed "you have not added any documents", which
 * is the same discipline as invariant 4's reachable "nothing backs this": an
 * empty list and an absent source look identical and are not.
 *
 *   own        the library's moments, retrieved against the line
 *   world      Scout's verified finds — already word-for-word checked
 *   documents  nothing yet. Needs an upload path for a PDF or an image.
 *   generated  nothing yet. And when it arrives it is a CHART SPEC, not an
 *              image: "graphics are code, never pixels", so the thing that
 *              gates it is lintChart rather than a model.
 *
 * NO MODEL CALL IN HERE. The move comes from `Classify` behind its own
 * contract and is passed in; everything after that is arithmetic over
 * provenance. Doc 08's whole point is that the picture answers "why am I
 * seeing this", and an offer that cost a second model call per line would
 * be answered too late to matter.
 */

import type { Env } from "./env.ts";
import { findMaterial } from "./assemble.ts";
import { externalMoments } from "./scout-external.ts";
import { listDocuments, matchDocuments } from "./documents.ts";
import { place, type Candidate, type Move, type Placed, type Source } from "./pictures.ts";
import { clock } from "./assemble.ts";

/** How many of each source the offer considers. */
export const PER_SOURCE = 4;

export interface OfferedCandidate extends Candidate {
  /** What a person reads on the card: the words, or the title. */
  label: string;
  /** Where it is, from the moment's own span. Empty when it has no time. */
  at: string;
  /** Somewhere to look at it. Empty when there is nowhere to send them. */
  href: string;
}

export interface Offer {
  move: Move;
  /** The choice, the reason, and everything refused with its reason. */
  placed: Placed;
  /** Everything considered, in the order it was found. */
  considered: OfferedCandidate[];
  /**
   * Sources with nothing behind them, NAMED.
   *
   * Not an oversight and not an error: two of the four are unbuilt and one
   * may simply be empty for this account. Saying which is the difference
   * between "there is nothing to show" and "we did not look there".
   */
  empty: Source[];
}

/**
 * What could go on this line, and what wins.
 *
 * `seen` is the subjects already used in this cut, so a reprise costs
 * something — doc 08's novelty penalty, which `place()` applies and waives
 * on a TURN.
 */
export async function offerFor(
  env: Env,
  userId: string,
  opts: { line: string; move: Move; seen?: ReadonlySet<string> },
): Promise<Offer> {
  const line = opts.line.trim();
  const considered: OfferedCandidate[] = [];
  const empty: Source[] = [];

  /* ── own ───────────────────────────────────────────────────────────────
   *
   * NOT MARKED PROBATIVE, and that is deliberate. `probative` means the
   * thing it shows IS the thing being claimed rather than near it, and
   * nothing stored about a moment says that — retrieval returning it for
   * this line says only that the words are close. Asserting it would be
   * exactly the stock-gavel failure doc 08 opens on, in our own footage.
   *
   * It costs nothing to leave off: own is the top tier of invariant 8's
   * order, so the probative bonus would only ever reorder own against own.
   * Whether a moment really backs a claim is what the judge answers, on the
   * ask and plan paths, where a person is waiting for that question.
   */
  if (line) {
    const found = await findMaterial(env, userId, line, PER_SOURCE);
    /* `recent` is findMaterial answering a query that matched nothing. Those
       are not candidates for this line, they are the last things filmed. */
    const mine = found.how === "recent" ? [] : found.moments;
    for (const m of mine) {
      considered.push({
        id: m.id,
        source: "own",
        kind: "illustration",
        /*
         * THE SUBJECT IS THE FILE, not the title.
         *
         * It is only ever a set-membership key — `reasonFor` checks
         * `seen.has(subject)` and never prints it — and the novelty penalty
         * is about having shown this footage already, which is a fact about
         * the file. A title would make two uploads of the same recording
         * look like two subjects, and the cut's own side of the comparison
         * (a block's `mediaKey`) is a file too. Both sides have to key on
         * the same thing or `seen` matches nothing and the penalty is
         * decoration.
         */
        subject: m.source_key || m.source_id,
        label: m.quote,
        at: clock(m.start_ms),
        href: `/source/${encodeURIComponent(m.source_id)}?t=${Math.floor(m.start_ms / 1000)}`,
      });
    }
    if (!mine.length) empty.push("own");
  } else {
    empty.push("own");
  }

  /* ── documents ─────────────────────────────────────────────────────────
   *
   * Invariant 8's second tier, matched by measurement rather than a model:
   * word overlap between the line and the document's own words. A document
   * library is tens of items and hand-made, so there is nothing here that
   * needs an index.
   *
   * PROBATIVE ONLY WHEN THE MAKER MARKED IT. Doc 08 wants "the proof itself
   * — the document with its line marked", and nothing in this codebase reads
   * a PDF to find the line. The marking is the note: what this document
   * shows, in their words. Without one it is still a document and still
   * outranks the open world, and it cannot carry an EVIDENCE line, because
   * "with its line marked" is the half that is missing. Invariant 10 — the
   * user's own words win where they exist, and where they do not exist we do
   * not invent them.
   */
  const docs = line ? matchDocuments(line, await listDocuments(env.DB, userId)) : [];
  for (const d of docs) {
    considered.push({
      id: d.id,
      source: "documents",
      kind: "evidence",
      /*
       * THREE STATES, AND THIS ONE IS NOT "UNKNOWN".
       *
       * `probative` is true / false / absent, and `allowed()` refuses a
       * candidate on an EVIDENCE line only when it is explicitly FALSE —
       * absent means nobody checked. For a document we know: without the
       * maker's marking it is not the proof, because "the document with its
       * line marked" is exactly the half missing. So this says false rather
       * than saying nothing, and the refusal actually fires.
       *
       * Own footage above is absent for the opposite reason: there we
       * genuinely do not know, and claiming false would block the maker's
       * own footage from evidence lines, which doc 08's source order puts
       * first.
       */
      probative: d.note ? true : false,
      /* The file, like every other subject here: the novelty penalty is
         about having shown this thing already. */
      subject: d.r2Key,
      label: d.note ? `${d.title} — ${d.note}` : d.title,
      at: "",
      href: `/api/documents/${encodeURIComponent(d.id)}/file`,
    });
  }
  if (!docs.length) empty.push("documents");

  /* ── world ─────────────────────────────────────────────────────────────
   *
   * PROBATIVE, AND THAT ONE IS A FACT. `externalMoments` selects on
   * `l.verify = 'verified'`, which is the deterministic verifier having
   * matched the quote against the recording word for word and read the time
   * off word ids. A recording of somebody saying the thing IS the thing,
   * which is what `kind: "evidence"` means here.
   */
  const outside = await externalMoments(env.DB, userId, PER_SOURCE);
  for (const x of outside) {
    considered.push({
      id: x.id,
      source: "world",
      kind: "evidence",
      probative: true,
      /* The link, for the same reason: it is this find's file. */
      subject: x.url || x.id,
      label: x.quote,
      at: clock(x.t_start_s * 1000),
      /* Scout links and never downloads — invariant 9 — so this goes to the
         platform at the timestamp rather than to anything of ours. */
      href: x.url,
    });
  }
  if (!outside.length) empty.push("world");

  /* ── generated ─────────────────────────────────────────────────────────
   *
   * A CARD OF THE LINE ITSELF, set as type. Doc 08: "a quote's words lift
   * from the page into kinetic type", and the reason this tier is not an
   * image model is in the same paragraph — "no diffusion model draws a word
   * or a number (they can't)".
   *
   * So it is always available and costs nothing: there is no retrieval and
   * no call, just the words the line already has, drawn by src/graphics.ts
   * from our own tokens. Never photoreal by construction rather than by
   * policy, and `allowed()` refuses it over a claim or its proof whatever
   * it looks like — which is most of the moves, and the refusal says so.
   *
   * NOT PROBATIVE, obviously: setting a sentence in type is not evidence
   * that the sentence is true. Saying false rather than nothing, because
   * here we know.
   */
  if (line) {
    considered.push({
      id: "card",
      source: "generated",
      kind: "synthetic",
      probative: false,
      /* One card per line, so showing the same line twice is a reprise. */
      subject: `card:${line.slice(0, 80)}`,
      label: `The line, set as type: “${line}”`,
      at: "",
      /* Filled by the caller, which is the only thing that knows the
         project and the block. Empty here rather than a guessed path. */
      href: "",
    });
  } else {
    empty.push("generated");
  }

  return {
    move: opts.move,
    placed: place(opts.move, considered, opts.seen ?? new Set()),
    considered,
    empty,
  };
}

/**
 * The sentence under the offer, when a source had nothing in it.
 *
 * One line, naming what is missing and why — because "no documents offered"
 * reads as a judgement about this line and is actually a fact about the
 * account.
 */
export function emptyNote(empty: readonly Source[]): string {
  const said: string[] = [];
  if (empty.includes("own")) said.push("nothing in your own footage matches this line");
  if (empty.includes("documents")) said.push("no document you have added is about this line");
  if (empty.includes("world")) said.push("Scout has not verified anything outside your footage");
  if (empty.includes("generated")) said.push("there are no words on this line to set");
  if (!said.length) return "";
  return `${said[0][0].toUpperCase()}${said[0].slice(1)}${said.length > 1 ? `; ${said.slice(1).join("; ")}` : ""}.`;
}
