/**
 * MISSIONS AND MATCH-BACK: a ghost becomes footage you can cut.
 *
 * Spec 18 section 5. Invariant 9 says Scout finds and links, so for every
 * platform that forbids a server fetching its media there is exactly one way
 * the footage arrives: the user goes and gets it. A mission is that ask, made
 * as small and as answerable as it can be — a deep link at the in-point, the
 * in and out, the quote, and why it matters.
 *
 * THE MISSION IS NOT THE POINT. The match-back is. Anyone can ask a user to
 * go and download something; the thing that makes it worth doing is that when
 * the file comes back, the product finds the scouted words INSIDE it and says
 * what it found — not "thanks, attached", but "the words match at 12:34, 96%
 * coverage, 0.4 s offset". Without that the user has moved a file and
 * re-acquired nothing: the moment is still unverified, it just looks verified
 * because there is now a video sitting next to it.
 *
 * "NEVER SILENTLY ACCEPT A NEAR-MISS" is the spec's own sentence, in bold,
 * and it is the only hard rule in this file. A 60% match is not a match. A
 * file that is the right stream and the wrong minute is not the moment. Both
 * are easy to accept — the user has just spent twenty minutes and the kind
 * thing is to say yes — and both put a quote on screen that is not in the
 * footage underneath it.
 *
 * MISSIONS COME FROM THE CUT, NOT FROM THE BOARD. The spec is explicit:
 * "generated from the cut: only external moments the cut uses, in timeline
 * order, expiring sources first. Cutting a block deletes its mission." A
 * board of forty finds would otherwise become forty errands, most of them for
 * moments the user is never going to use.
 */

import { normTokens, tokenRatio } from "./scout-verify.ts";
import type { IndexedWord } from "./align.ts";

/* ── Which finds become missions ────────────────────────────────────────── */

/** A moment the cut uses that is not yet footage. */
export interface Ghost {
  ledgerId: string;
  /** Where it sits in the cut. Missions are handed over in timeline order. */
  timelineMs: number;
  quote: string;
  sourceUrl: string;
  /** Seconds into the source. Derived from word ids; nothing typed them. */
  inS: number;
  outS: number;
  /** Why this moment is in the cut at all, in a line. */
  why: string;
  /** When the platform's own copy goes away — a Twitch VOD at 7, 14 or 60 days. */
  expiresAt?: number;
  /** The route: a mission is only for what we may not fetch ourselves. */
  route: "mission" | "feed" | "yours";
}

export interface Mission {
  ledgerId: string;
  /** The deep link, at the in-point. Opening it is the whole first step. */
  url: string;
  inS: number;
  outS: number;
  /** How long the grab is, which is what the user is actually agreeing to. */
  lengthS: number;
  quote: string;
  why: string;
  expiresAt: number | null;
  /** "7 days left" / "expires tomorrow" / null. */
  expiry: string | null;
}

/** Below this, a reminder that a source is going away is noise. */
export const EXPIRY_WARN_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * A deep link at the in-point, for the platforms that have one.
 *
 * Pure URL construction over an id the product already holds. Nothing is
 * fetched and nothing audiovisual is addressed — this is the link a person
 * clicks, which is the one thing invariant 9 positively requires Scout to
 * produce.
 */
export function deepLink(url: string, inS: number): string {
  const at = Math.max(0, Math.floor(inS));
  try {
    const u = new URL(url);
    if (/(^|\.)youtube\.com$/.test(u.hostname) || u.hostname === "youtu.be") {
      u.searchParams.set("t", `${at}s`);
      return u.toString();
    }
    if (/(^|\.)twitch\.tv$/.test(u.hostname)) {
      const h = Math.floor(at / 3600);
      const m = Math.floor((at % 3600) / 60);
      u.searchParams.set("t", `${h}h${m}m${at % 60}s`);
      return u.toString();
    }
    /* Everything else gets the media fragment, which browsers and most
       players honour and which costs nothing when they do not. */
    u.hash = `t=${at}`;
    return u.toString();
  } catch {
    /* A URL we cannot parse is still a URL a person can open. Returning it
       unchanged is better than returning nothing. */
    return url;
  }
}

/** "7 days left", or nothing when the source is not going anywhere soon. */
export function expiryLine(expiresAt: number | undefined, now = Date.now()): string | null {
  if (!expiresAt) return null;
  const left = expiresAt - now;
  if (left <= 0) return "gone — the source has expired";
  if (left > EXPIRY_WARN_MS) return null;
  const days = Math.floor(left / (24 * 60 * 60 * 1000));
  if (days <= 0) return "expires today";
  if (days === 1) return "expires tomorrow";
  return `${days} days left`;
}

/**
 * The missions, from the cut.
 *
 * ORDER: expiring sources first, then the timeline. The spec's own, and the
 * reason is that a Twitch VOD with four days left is the only mission on the
 * list that can stop being possible — everything else is still there next
 * week. Timeline order within that, because a person doing several in a row
 * is working through their own video.
 *
 * ONLY `route: "mission"`. A podcast enclosure is fetched by the product and
 * the user's own footage is already here; asking for either would be asking
 * somebody to do work the machine has already done.
 */
export function missionsFromCut(ghosts: Ghost[], now = Date.now()): Mission[] {
  return ghosts
    .filter((g) => g.route === "mission")
    .slice()
    .sort((a, b) => {
      const ea = a.expiresAt ?? Infinity;
      const eb = b.expiresAt ?? Infinity;
      /* Only an expiry inside the warning window jumps the queue. A source
         with a year left is not urgent, and sorting by a far-off date would
         reorder the whole list for nothing. */
      const urgentA = ea - now <= EXPIRY_WARN_MS ? ea : Infinity;
      const urgentB = eb - now <= EXPIRY_WARN_MS ? eb : Infinity;
      if (urgentA !== urgentB) return urgentA - urgentB;
      return a.timelineMs - b.timelineMs;
    })
    .map((g) => ({
      ledgerId: g.ledgerId,
      url: deepLink(g.sourceUrl, g.inS),
      inS: g.inS,
      outS: g.outS,
      lengthS: Math.max(0, Math.round(g.outS - g.inS)),
      quote: g.quote,
      why: g.why,
      expiresAt: g.expiresAt ?? null,
      expiry: expiryLine(g.expiresAt, now),
    }));
}

/* ── Match-back ─────────────────────────────────────────────────────────── */

export const MATCH_METHODS = ["mission_id", "transcript", "fingerprint", "frame_hash"] as const;
export type MatchMethod = (typeof MATCH_METHODS)[number];

export type Verdict = "verified" | "partial" | "mismatch";

/** The spec's thresholds: "≥ 90% word coverage, ±1 s offset". */
export const COVERAGE_VERIFIED = 0.9;
export const OFFSET_TOLERANCE_S = 1;
/** Below this there is no argument that the right moment is in the file. */
export const COVERAGE_MISMATCH = 0.5;

export interface MatchResult {
  verdict: Verdict;
  method: MatchMethod;
  /** How much of the scouted quote is in the upload. */
  coverage: number;
  /** Where the quote starts in the upload, in seconds. Null on a mismatch. */
  atS: number | null;
  /** How far the upload sits from the in-point it was supposed to start at. */
  offsetS: number | null;
  /** The words that are NOT in the upload. Shown on a partial, never hidden. */
  missing: string[];
  /** A sentence. There is no silent accept and no silent refusal. */
  why: string;
}

const MISMATCH = (method: MatchMethod, why: string): MatchResult => ({
  verdict: "mismatch",
  method,
  coverage: 0,
  atS: null,
  offsetS: null,
  missing: [],
  why,
});

/**
 * Does this upload contain the words the mission was for?
 *
 * TRANSCRIPT ALIGNMENT, which is step 2 of the spec's four and the only one
 * buildable without a fingerprinting library. Step 1 — "the attached mission
 * id (verify, don't search)" — is the parenthesis that matters and is what
 * this function IS: the mission says which quote to look for, so this checks
 * rather than searches.
 *
 * COVERAGE IS OVER THE SCOUTED QUOTE, not over the upload. A user who grabs
 * twenty minutes around the moment has given us more than we asked for, and
 * scoring that down would refuse a correct file for being generous. What
 * matters is whether every word we are going to put on screen is in there.
 */
export function matchByTranscript(
  quote: string,
  upload: IndexedWord[],
  expectedInS: number | null = null,
): MatchResult {
  const needle = normTokens(quote);
  if (!needle.length) return MISMATCH("transcript", "the mission has no quote to look for");
  if (!upload.length) return MISMATCH("transcript", "the upload has no words in it — is it silent, or did the transcript fail?");

  const hay = upload.map((w) => normTokens(w.text)[0] ?? "").map((t) => t);
  /* One transcript word can normalise to nothing (a stray "—"), and a hole in
     the haystack would shift every index after it. Kept as an empty string so
     the position still lines up with the word it came from. */

  let bestScore = 0;
  let bestAt = -1;
  const lengths = new Set<number>();
  for (const f of [1, 0.9, 1.1, 0.8, 1.2]) lengths.add(Math.max(1, Math.round(needle.length * f)));

  for (const len of lengths) {
    for (let i = 0; i + len <= hay.length; i++) {
      const score = tokenRatio(needle, hay.slice(i, i + len).filter(Boolean));
      if (score > bestScore) {
        bestScore = score;
        bestAt = i;
      }
    }
  }

  if (bestAt < 0 || bestScore < COVERAGE_MISMATCH) {
    return {
      ...MISMATCH("transcript", "those words are not in this file — is it the right source?"),
      coverage: Number(bestScore.toFixed(4)),
    };
  }

  const atS = upload[bestAt].startMs / 1000;
  const offsetS = expectedInS === null ? null : Number((atS - expectedInS).toFixed(2));

  /* The words we would put on screen and cannot find. Reported on a partial
     rather than summarised, because "92% coverage" does not tell a person
     whether the missing 8% is "um" or the name of the person being accused. */
  const found = new Set(hay.slice(bestAt, bestAt + Math.round(needle.length * 1.2)));
  const missing = needle.filter((w) => !found.has(w));

  if (bestScore >= COVERAGE_VERIFIED) {
    const offsetOk = offsetS === null || Math.abs(offsetS) <= OFFSET_TOLERANCE_S;
    if (offsetOk) {
      return {
        verdict: "verified",
        method: "transcript",
        coverage: Number(bestScore.toFixed(4)),
        atS,
        offsetS,
        missing,
        why: `the words match${offsetS === null ? "" : offsetS === 0 ? ", exactly where the mission said" : `, ${Math.abs(offsetS)} s from where the mission said`}`,
      };
    }
    /*
     * THE RIGHT WORDS IN THE WRONG PLACE. A stream re-uploaded with a
     * different start, or a grab from the wrong day of a show that says the
     * same thing every week. The words are there, so it is not a mismatch;
     * the time is not, so the in and out points we are about to cut on are
     * wrong, and accepting it silently puts the wrong seconds on screen.
     */
    return {
      verdict: "partial",
      method: "transcript",
      coverage: Number(bestScore.toFixed(4)),
      atS,
      offsetS,
      missing,
      why: `the words are here but ${Math.abs(offsetS as number)} s from where the mission said — check it is the same recording before cutting`,
    };
  }

  return {
    verdict: "partial",
    method: "transcript",
    coverage: Number(bestScore.toFixed(4)),
    atS,
    offsetS,
    missing,
    why: missing.length
      ? `most of it is here, and ${missing.length} word${missing.length === 1 ? "" : "s"} are not: ${missing.slice(0, 6).join(", ")}`
      : "most of it is here, and not all of it",
  };
}

/**
 * What a verdict allows.
 *
 * "NEVER SILENTLY ACCEPT A NEAR-MISS", the spec's one bold rule in this
 * section. Only `verified` makes a ghost into footage. A `partial` is shown
 * to the person with the missing words beside it, and stays a ghost until
 * they say otherwise — their decision, taken with the evidence in front of
 * them, rather than ours taken on their behalf because they have just spent
 * twenty minutes and it would be kind to say yes.
 */
export const acceptable = (m: MatchResult): boolean => m.verdict === "verified";

/* ── The last ghost ─────────────────────────────────────────────────────── */

export const GHOST_CHOICES = ["hold", "drop", "quote_card"] as const;
export type GhostChoice = (typeof GHOST_CHOICES)[number];

export interface GhostAtRender {
  ledgerId: string;
  quote: string;
  why: string;
  /** What choosing each would do, in the words a person reads. */
  choices: Array<{ choice: GhostChoice; label: string; what: string }>;
}

/**
 * "The video never ships with a silent hole."
 *
 * At the final render every remaining ghost asks, and the three answers are
 * the spec's: hold for the grab, drop the beat and let the solver re-cut, or
 * use a quote card with the attributed words.
 *
 * THERE IS NO FOURTH OPTION AND NO DEFAULT. A render that quietly dropped
 * unacquired moments would produce a video missing an argument nobody was
 * told about; one that quietly held would produce a video that never renders.
 * The third choice exists so that "I could not get the footage" does not have
 * to mean "I lose the point" — the words are attributable even when the
 * picture is not available.
 */
export function ghostsAtRender(ghosts: Array<Pick<Ghost, "ledgerId" | "quote" | "why">>): GhostAtRender[] {
  return ghosts.map((g) => ({
    ledgerId: g.ledgerId,
    quote: g.quote,
    why: g.why,
    choices: [
      { choice: "hold", label: "Hold for the grab", what: "the render waits until you bring this one back" },
      { choice: "drop", label: "Drop the beat", what: "the cut is re-produced without it, and the rules say why" },
      {
        choice: "quote_card",
        label: "Use a quote card",
        what: "the words on screen, attributed, with no footage claimed",
      },
    ],
  }));
}
