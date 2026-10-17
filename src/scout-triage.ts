/**
 * TRIAGE: which of these thirty sources is worth reading?
 *
 * Spec 18 section 3.4. Reading a source costs money — a scan of an hour of
 * transcript is cents, and thirty sources is most of a run's budget — so the
 * order they are read in decides what the run finds within its budget.
 * Everything here happens BEFORE any transcript is touched, on metadata that
 * came back with the search for nothing.
 *
 * Six components, the spec's own weights, each a plain 0-to-1 number with a
 * reason attached. Deterministic: this is the step that decides where the
 * money goes, and a model deciding that would be a model with a budget.
 *
 * INVARIANT 3 APPLIES, AND IS EASY TO BREAK HERE. "Reasons, not scores. No
 * percentage reaches a user." This file produces a number because something
 * has to sort thirty rows, and that number is an internal ordering, not a
 * verdict about a video. What the board shows is the LINE — "four fans
 * timestamped this one", "the original, not a reupload" — which is why every
 * component returns its reason beside its value and why `triageLine` exists.
 * A triage score on screen would be a percentage about somebody's video, and
 * the one thing it is definitely not is a measurement of their conduct.
 *
 * A SOURCE WITH NO READABLE TRANSCRIPT IS STILL USEFUL and is not scored down
 * for it. The spec is explicit: its crowd signals become CROWD rows on the
 * board and its clips can become missions. Penalising it would hide the half
 * of YouTube we are not allowed to read, which is most of it.
 */

import type { SourceCandidate } from "./scout-adapters.ts";
import type { Term } from "./scout-expand.ts";
import { normTokens } from "./scout-verify.ts";

/* ── The weights ────────────────────────────────────────────────────────── */

/** The spec's own, and they add to one. */
export const WEIGHTS = {
  overlap: 0.3,
  durationFit: 0.2,
  views: 0.15,
  crowd: 0.15,
  originality: 0.1,
  recency: 0.1,
} as const;

export type Component = keyof typeof WEIGHTS;

/* ── Components ─────────────────────────────────────────────────────────── */

/**
 * How much of the beat's language, and the community's, is in the metadata.
 *
 * Measured against the BEAT'S OWN distinctive words plus the harvested terms,
 * rather than as a symmetric similarity: a long description that happens to
 * contain all of them is a good sign, and dividing by its length would
 * punish it for being a long description.
 */
export function overlap(c: SourceCandidate, beatBehaviour: string, vocabulary: Term[] = []): number {
  const text = new Set(
    normTokens([c.title, c.description, ...(c.chapters ?? [])].filter(Boolean).join(" ")),
  );
  if (!text.size) return 0;

  const wanted = new Set(normTokens(beatBehaviour));
  for (const t of vocabulary) for (const w of normTokens(t.term)) wanted.add(w);
  if (!wanted.size) return 0;

  let hit = 0;
  for (const w of wanted) if (text.has(w)) hit += 1;
  return hit / wanted.size;
}

/**
 * Is this the right SHAPE of source for this beat?
 *
 * The spec's note: "long VOD for behaviour beats, short interview for counter
 * beats". A behaviour happens in the middle of three hours of streaming and
 * the three hours is where it is; an explanation or an apology is given
 * deliberately, in something short, to camera.
 *
 * A clip is the exception in both directions. It is the moment with the
 * stream cut away, which is what a subject beat wants and what a counter beat
 * almost never is.
 */
export function durationFit(c: SourceCandidate, role: "subject" | "counter" | "outside"): number {
  const mins = (c.durationS ?? 0) / 60;
  const kind = c.kind ?? "vod";

  if (role === "counter") {
    /* Interviews, Q&As, apologies and chat-rule videos: deliberate and short. */
    if (kind === "interview" || kind === "podcast" || kind === "news") return 1;
    if (kind === "compilation" || kind === "reupload") return 0.3;
    if (!mins) return 0.5;
    /* Five to forty minutes is somebody explaining themselves. */
    if (mins >= 5 && mins <= 40) return 0.9;
    return mins < 5 ? 0.5 : 0.3;
  }

  /* A subject beat wants the stream it happened in, or the clip of it. */
  if (kind === "clip") return 1;
  if (kind === "vod") return mins >= 60 ? 1 : mins >= 20 ? 0.7 : 0.4;
  if (kind === "compilation") return 0.8;
  if (kind === "interview" || kind === "news") return 0.3;
  if (!mins) return 0.5;
  return mins >= 60 ? 0.8 : 0.5;
}

/**
 * Views, on a log scale, normalised ACROSS THE CANDIDATE SET.
 *
 * Within the set rather than against an absolute ceiling, because a figure
 * that means "popular" differs by three orders of magnitude between a Twitch
 * clip and a YouTube VOD, and a fixed scale would rank every clip last.
 *
 * A SET WHERE EVERYTHING HAS THE SAME VIEWS CARRIES NO INFORMATION, and
 * returns 0.5 for all of them rather than 1. Returning 1 would let a single
 * candidate score full marks on popularity for having been found.
 */
export function viewsFit(c: SourceCandidate, all: SourceCandidate[]): number {
  const log = (n?: number) => Math.log10(Math.max(0, n ?? 0) + 1);
  const mine = log(c.views);
  let lo = Infinity;
  let hi = -Infinity;
  for (const other of all) {
    const v = log(other.views);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo) || hi - lo < 1e-9) return 0.5;
  return (mine - lo) / (hi - lo);
}

/** How many signals it takes before the crowd has fully spoken. */
export const CROWD_SATURATES_AT = 10;

export interface CrowdSignals {
  /** Timestamps in the comments. */
  commentTimestamps: number;
  /** Twitch clips cut out of this VOD. */
  clipsPointingIn: number;
  /** Reddit threads and wiki pages citing it. */
  citations: number;
}

/**
 * How much the crowd has already pointed at this one.
 *
 * Linear and saturating rather than a curve with a shape to argue about. Ten
 * signals is "the crowd has spoken"; the difference between ten and fifty is
 * not a difference in whether to read it.
 */
export function crowdFit(s: CrowdSignals): number {
  const n = Math.max(0, s.commentTimestamps) + Math.max(0, s.clipsPointingIn) + Math.max(0, s.citations);
  return Math.min(1, n / CROWD_SATURATES_AT);
}

/**
 * The original, or a copy of it.
 *
 * The spec's numbers: original channel 1.0, reupload 0.4, compilation 0.6
 * until traced. Traced, a compilation drops: we have the original it came
 * from, so reading the compilation is paying to read the same moment again
 * with somebody else's commentary over it.
 */
export function originality(c: SourceCandidate, traced = false): number {
  if (c.kind === "reupload") return 0.4;
  if (c.kind === "compilation") return traced ? 0.3 : 0.6;
  return 1;
}

/** How far out a date can be and still count as the day in question. */
export const DATE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
/** How old a source is before recency stops helping it. */
export const RECENCY_SPAN_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * The date, either way round.
 *
 * WHEN THE BEAT NAMES DATES, RECENCY IS IRRELEVANT and proximity is
 * everything: a beat about one afternoon in March wants that afternoon, and
 * the newest video on the channel is the worst candidate rather than the
 * best. The spec writes it as one component — `recency_or_date_match` — and
 * the "or" is doing the work.
 */
export function recencyFit(c: SourceCandidate, beatDates: number[] = [], now = Date.now()): number {
  const published = c.publishedAt;
  if (!published) return 0.5;

  if (beatDates.length) {
    const nearest = Math.min(...beatDates.map((d) => Math.abs(d - published)));
    if (nearest <= DATE_WINDOW_MS) return 1;
    /* Falls away over a month, then stops mattering. */
    const month = 30 * 24 * 60 * 60 * 1000;
    return Math.max(0, 1 - (nearest - DATE_WINDOW_MS) / month) * 0.8;
  }

  const age = Math.max(0, now - published);
  return Math.max(0, 1 - age / RECENCY_SPAN_MS);
}

/* ── The score, and the reason ──────────────────────────────────────────── */

export interface TriageInput {
  candidate: SourceCandidate;
  /** Every candidate in this round, for the within-set normalisation. */
  all: SourceCandidate[];
  beat: { id: string; role: "subject" | "counter" | "outside"; behaviour: string; dates?: number[] };
  vocabulary?: Term[];
  crowd?: CrowdSignals;
  traced?: boolean;
  now?: number;
}

export interface Triaged {
  beatId: string;
  candidate: SourceCandidate;
  /** Internal ordering only. Invariant 3: this never reaches a person. */
  score: number;
  parts: Record<Component, number>;
  /** What a person is shown instead of the number. */
  line: string;
}

const NO_CROWD: CrowdSignals = { commentTimestamps: 0, clipsPointingIn: 0, citations: 0 };

export function triage(input: TriageInput): Triaged {
  const { candidate: c, all, beat } = input;
  const crowd = input.crowd ?? NO_CROWD;

  const parts: Record<Component, number> = {
    overlap: overlap(c, beat.behaviour, input.vocabulary ?? []),
    durationFit: durationFit(c, beat.role),
    views: viewsFit(c, all),
    crowd: crowdFit(crowd),
    originality: originality(c, input.traced),
    recency: recencyFit(c, beat.dates ?? [], input.now),
  };

  let score = 0;
  for (const k of Object.keys(WEIGHTS) as Component[]) score += WEIGHTS[k] * parts[k];

  return {
    beatId: beat.id,
    candidate: c,
    score: Number(score.toFixed(4)),
    parts,
    line: triageLine(c, parts, crowd),
  };
}

/**
 * WHY THIS ONE IS NEAR THE TOP, in a sentence, with no number in it.
 *
 * Invariant 3: "Reasons, not scores ... with the line that caused it." The
 * strongest component gets to speak, because a list of six half-reasons is
 * not a reason. Counts of PEOPLE are allowed — "four fans timestamped this"
 * is a fact about the world, not a score about a person.
 */
export function triageLine(
  c: SourceCandidate,
  parts: Record<Component, number>,
  crowd: CrowdSignals = NO_CROWD,
): string {
  const ranked = (Object.keys(parts) as Component[]).sort(
    (a, b) => WEIGHTS[b] * parts[b] - WEIGHTS[a] * parts[a],
  );

  for (const top of ranked) {
    if (parts[top] <= 0) break;
    switch (top) {
      case "crowd": {
        const n = crowd.commentTimestamps + crowd.clipsPointingIn + crowd.citations;
        if (!n) break;
        if (crowd.clipsPointingIn && !crowd.commentTimestamps) {
          return `${crowd.clipsPointingIn} clip${crowd.clipsPointingIn === 1 ? "" : "s"} cut out of this one`;
        }
        return `${n} place${n === 1 ? "" : "s"} where somebody already pointed at this`;
      }
      case "overlap":
        return "the title and description use the words this beat is about";
      case "durationFit":
        return c.kind === "clip"
          ? "a clip — the moment with the stream cut away"
          : c.kind === "interview" || c.kind === "podcast"
            ? "somebody explaining themselves at length"
            : "the right kind of source for this beat";
      case "views":
        return "far more watched than the rest of what came back";
      case "originality":
        if (c.kind === "compilation") return "a compilation — the original has not been found yet";
        if (c.kind === "reupload") return "a reupload; the original is somewhere else";
        return "the original, not a reupload";
      case "recency":
        return "close to the date this beat is about";
    }
  }
  /* Everything at zero is itself the reason, and an honest one. */
  return "nothing in the metadata points either way — it came back on the search and that is all";
}

/* ── Keeping the top few ────────────────────────────────────────────────── */

export const KEEP_PER_BEAT = 8;

/**
 * The top few per beat, and never the same source twice for one beat.
 *
 * Per BEAT and not overall: a run with one popular beat would otherwise spend
 * its whole reading budget there and report the other five as gaps, having
 * never read anything for them. The spec's 5-to-10 is a per-beat number for
 * that reason.
 *
 * Ties break on the candidate's own id rather than on arrival order, so a
 * round is reproducible when two platforms answer in a different sequence.
 */
export function topPerBeat(rows: Triaged[], keep = KEEP_PER_BEAT): Triaged[] {
  const byBeat = new Map<string, Triaged[]>();
  const seen = new Set<string>();
  for (const r of rows) {
    const key = r.beatId + "\u0000" + r.candidate.adapter + "\u0000" + r.candidate.externalId;
    if (seen.has(key)) continue;
    seen.add(key);
    const list = byBeat.get(r.beatId) ?? [];
    list.push(r);
    byBeat.set(r.beatId, list);
  }
  const out: Triaged[] = [];
  for (const list of byBeat.values()) {
    list.sort((a, b) => b.score - a.score || a.candidate.externalId.localeCompare(b.candidate.externalId));
    out.push(...list.slice(0, keep));
  }
  return out;
}

/* ── Crowd timestamps ───────────────────────────────────────────────────── */

/** Chat lags the moment. Spec 3.4: about twenty seconds. */
export const CHAT_LAG_S = 20;
/** Timestamps closer together than this are one moment. */
export const CLUSTER_S = 20;
/** How far before the corrected time a scan window opens. */
export const WINDOW_LEAD_S = 45;

export interface CrowdTimestamp {
  /** As typed. */
  tS: number;
  /** Where the thing actually is: twenty seconds before somebody noticed. */
  lagCorrectedTS: number;
  /** How many comments landed in this cluster. */
  weight: number;
  /** The comment text, for the board. */
  text: string;
}

/* Spec 3.4's own expression. Hours optional; minutes and seconds are not. */
const TS = /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})/g;

/**
 * The timestamps fans put in the comments, corrected and clustered.
 *
 * THREE THINGS GO WRONG HERE AND ALL OF THEM QUIETLY.
 *
 * A timestamp past the end of the video is not a timestamp: "2:30:00" under a
 * forty-minute upload is a reference to a different video, a reply to another
 * comment, or a score line. Kept, it sends a scan window past the end of the
 * transcript and the beat comes back empty.
 *
 * Forty people timestamping one outburst is one moment, not forty. Uncluster
 * ed, the crowd component saturates on a single incident and the board shows
 * forty rows pointing at the same second.
 *
 * And CHAT LAGS. A viewer types the time they noticed, which is after it
 * happened — about twenty seconds after. A scan window opened at the typed
 * time starts after the thing it is looking for, so the window opens
 * forty-five seconds before the corrected time, inside the spec's 30-to-60.
 */
export function parseCrowdTimestamps(
  comments: Array<{ text: string }>,
  durationS?: number,
): CrowdTimestamp[] {
  const hits: Array<{ tS: number; text: string }> = [];

  for (const { text } of comments) {
    const body = String(text ?? "");
    TS.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TS.exec(body))) {
      const h = m[1] ? Number(m[1]) : 0;
      const min = Number(m[2]);
      const sec = Number(m[3]);
      /* Sixty-one seconds is not a time. A match like "1:75" is a score. */
      if (sec > 59 || (m[1] && min > 59)) continue;
      const tS = h * 3600 + min * 60 + sec;
      if (durationS !== undefined && (tS > durationS || tS < 0)) continue;
      hits.push({ tS, text: body.trim() });
    }
  }

  hits.sort((a, b) => a.tS - b.tS);

  const clusters: CrowdTimestamp[] = [];
  for (const h of hits) {
    const last = clusters[clusters.length - 1];
    if (last && h.tS - last.tS <= CLUSTER_S) {
      last.weight += 1;
      continue;
    }
    clusters.push({
      tS: h.tS,
      lagCorrectedTS: Math.max(0, h.tS - CHAT_LAG_S),
      weight: 1,
      text: h.text,
    });
  }
  return clusters;
}

/**
 * Where a scan window opens for a crowd timestamp.
 *
 * Before the corrected time, not at it: the provocation is what makes the
 * moment legible, and a window that opens on the outburst gets the outburst
 * with nothing in front of it.
 */
export const scanWindowStart = (t: CrowdTimestamp): number => Math.max(0, t.lagCorrectedTS - WINDOW_LEAD_S);
