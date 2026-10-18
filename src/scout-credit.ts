/**
 * ATTRIBUTION: whose footage this is, said on screen and in the file.
 *
 * Spec 18 section 6: "For every external clip, written automatically at
 * verify time: a lower-third *Source: [channel] · [platform] · [date]* for
 * the clip's first 3–4 s; chains credit the original (*via* the
 * compilation); a timestamped source list in the description; OTIO clip
 * metadata (`metadata.aldershot`) so it survives export. Editable per clip;
 * **removal needs an explicit toggle**."
 *
 * AT VERIFY TIME, which is the part that makes it true rather than polite. A
 * credit written when the clip is placed is a credit somebody can forget to
 * write; a credit written when the quote is verified cannot be, because the
 * verification is what produced the row it hangs on. The moment and its
 * credit are the same record.
 *
 * THE CHAIN IS THE INTERESTING HALF. A moment found in a compilation and
 * traced back to the stream it came from has TWO people owed something: the
 * person who said it and the person who found it. "Source: DarksydePhil ·
 * YouTube · Jan 2024 · via The Khan Compilation" is both, in one line, and
 * getting it the wrong way round credits the clipper for the words.
 *
 * REMOVAL NEEDS AN EXPLICIT TOGGLE, and this file makes that structural: a
 * credit is never absent, only `removed`, with who removed it still readable
 * — invariant 6, and the reason it applies here is that "there was no credit"
 * and "somebody took the credit off" are different facts about a video and
 * only one of them is a defence.
 */

import type { Verdict } from "./scout-verify.ts";

export interface Source {
  id: string;
  /** The channel or show. The person owed the credit. */
  channel: string;
  /** YouTube, Twitch, Podcast RSS — where a viewer would go to check. */
  platform: string;
  /** When it was published. Month precision is what a credit line carries. */
  publishedAt?: number;
  url: string;
  kind?: string;
  /** For a copy: the source it was taken from, once traced. */
  originalOf?: string | null;
}

export interface Credit {
  ledgerId: string;
  /** The lower-third, as it reads on screen. */
  text: string;
  /** Where "find out for yourself" points. The original where there is one. */
  url: string;
  platform: string;
  /** The copy this came through, where it came through one. */
  via: string | null;
  /** Explicit, never absent. Invariant 6: nothing is deleted. */
  removed: boolean;
  /** Edited by the user. The automatic text is still recoverable from the rows. */
  edited: boolean;
}

/** How long the lower-third holds. The spec's 3–4 s. */
export const CREDIT_HOLD_S = 3.5;

/** "Jan 2024" — month precision, which is what a credit line carries. */
export function creditDate(ms: number | undefined): string {
  if (!ms || !Number.isFinite(ms)) return "";
  const d = new Date(ms);
  return `${d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })} ${d.getUTCFullYear()}`;
}

/**
 * The credit line for one external moment.
 *
 * THE ORDER IS THE ARGUMENT. The person who SAID it comes first, because the
 * words are theirs; the compilation that carried it is a *via*. Writing it
 * the other way round credits the clipper for somebody else's sentence, which
 * is both wrong and the mistake a naive implementation makes — the
 * compilation is the row Scout actually found, so it is the one nearest to
 * hand.
 *
 * NOTHING IS WRITTEN FOR AN UNVERIFIED ROW. A credit is a claim about where
 * words came from, and a quote nobody has checked against its source has no
 * such claim to make. The spec says "at verify time" and this is the
 * enforcement rather than the schedule.
 */
export function creditFor(
  row: { ledgerId: string; verify: Verdict },
  source: Source,
  original?: Source | null,
): Credit | null {
  if (row.verify !== "verified") return null;

  /* A copy credits the original, through itself. Where the original has not
     been traced yet there is no chain to write — and inventing one would
     credit a stream nobody has found. */
  const speaker = original ?? source;
  const via = original ? source.channel : null;

  const date = creditDate(speaker.publishedAt);
  const parts = [`Source: ${speaker.channel}`, speaker.platform, date].filter(Boolean);
  const text = via ? `${parts.join(" · ")} · via ${via}` : parts.join(" · ");

  return {
    ledgerId: row.ledgerId,
    text,
    /* The link goes to the ORIGINAL where one is known: "find out for
       yourself" should land on the thing that was said, not on the clip of
       it. */
    url: speaker.url,
    platform: speaker.platform,
    via,
    removed: false,
    edited: false,
  };
}

/**
 * A credit a person edited, or took off.
 *
 * REMOVAL IS A TOGGLE AND NEVER A DELETE. "There was no credit" and "somebody
 * took the credit off" are different facts about a video and only one of them
 * is a defence. The row stays, with `removed` set, so the dispute file can
 * say which happened.
 */
export function editCredit(credit: Credit, change: { text?: string; removed?: boolean }): Credit {
  return {
    ...credit,
    text: change.text ?? credit.text,
    removed: change.removed ?? credit.removed,
    edited: change.text !== undefined && change.text !== credit.text ? true : credit.edited,
  };
}

/* ── The description list ───────────────────────────────────────────────── */

export interface SourceListEntry {
  /** Where in the finished video, so a reader can skip to it. */
  atMs: number;
  text: string;
  url: string;
}

/** "1:24 — Source: … — https://…", which is what a description holds. */
export function sourceList(
  credits: Array<Credit & { atMs: number }>,
): SourceListEntry[] {
  return credits
    /* A removed credit is left out of the published list — it was taken off
       on purpose — but the row survives, so this is a view and not a delete. */
    .filter((c) => !c.removed)
    .slice()
    .sort((a, b) => a.atMs - b.atMs)
    .map((c) => ({ atMs: c.atMs, text: c.text, url: c.url }));
}

/** The description block, in the shape a video platform accepts. */
export function renderSourceList(entries: SourceListEntry[]): string {
  if (!entries.length) return "";
  const stamp = (ms: number) => {
    const s = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h
      ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
      : `${m}:${String(sec).padStart(2, "0")}`;
  };
  return ["Sources", ...entries.map((e) => `${stamp(e.atMs)} — ${e.text} — ${e.url}`)].join("\n");
}

/* ── Surviving the export ───────────────────────────────────────────────── */

export interface ClipMetadata {
  aldershot: {
    ledgerId: string;
    credit: string;
    url: string;
    platform: string;
    via: string | null;
    quote: string;
    /** Seconds into the SOURCE, not the timeline. Derived from word ids. */
    sourceInS: number;
    verifiedAt: number;
  };
}

/**
 * What rides along in an OTIO export.
 *
 * "so it survives export" is the spec's reason and it is a specific fear: a
 * cut opened in somebody else's editor, finished there, and published with
 * the credits lost somewhere in the handover. The timeline carries them, so
 * the clip can be moved and still say whose it is.
 *
 * NO CREDIT IS WRITTEN FOR A REMOVED ONE. A person took it off deliberately,
 * and exporting it anyway would put back on the timeline what they removed
 * from the screen.
 */
export function clipMetadata(
  credit: Credit,
  of: { quote: string; sourceInS: number; verifiedAt: number },
): ClipMetadata | null {
  if (credit.removed) return null;
  return {
    aldershot: {
      ledgerId: credit.ledgerId,
      credit: credit.text,
      url: credit.url,
      platform: credit.platform,
      via: credit.via,
      quote: of.quote,
      sourceInS: of.sourceInS,
      verifiedAt: of.verifiedAt,
    },
  };
}

/* ── When a source goes away ────────────────────────────────────────────── */

/**
 * A credit whose source has been taken down.
 *
 * The words were still said, and the receipt is still a receipt — a
 * transcript, a time and a date — so the credit stays and says what happened.
 * Dropping it would quietly turn a cited clip into an uncited one at the
 * moment somebody most wants to check it.
 */
export function unavailable(credit: Credit): Credit {
  return {
    ...credit,
    text: `${credit.text} · no longer available at the source`,
    edited: credit.edited,
  };
}
