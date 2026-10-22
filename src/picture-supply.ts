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
     Invariant 8's second tier and there is no supply: nothing in the product
     takes a PDF or a photograph yet. Named rather than skipped. */
  empty.push("documents");

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
     Last tier, and unbuilt. When it lands it is a chart or a card drawn in
     code — never an image model, never photoreal — so `lintChart` is what
     will gate it and `allowed()` already refuses it over a claim or a
     proof whatever it looks like. */
  empty.push("generated");

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
  if (empty.includes("documents")) said.push("no documents added yet");
  if (empty.includes("world")) said.push("Scout has not verified anything outside your footage");
  if (empty.includes("generated")) said.push("graphics are not built yet");
  if (!said.length) return "";
  return `${said[0][0].toUpperCase()}${said[0].slice(1)}${said.length > 1 ? `; ${said.slice(1).join("; ")}` : ""}.`;
}
