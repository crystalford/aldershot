/**
 * THE DISPUTE FILE.
 *
 * `09-EXPORT-AND-INTEGRITY.md`: "per video lists every external clip's source,
 * timestamp, fraction of the original used, commentary-to-clip ratio and the
 * attribution written — evidence of transformative use, ASSEMBLED AS THE VIDEO
 * IS MADE, NOT AFTER A CLAIM."
 *
 * That last clause is the whole design. Everything in here is already written
 * down by the time it is read: the ledger recorded where the words were, the
 * mission recorded what was taken, the attribution recorded what went on
 * screen. This file does no new work and asks nobody anything — it reads rows
 * and lays them out. A document assembled after a complaint is a document
 * assembled by somebody with a reason to shade it, and it arrives weeks late.
 *
 * ON INVARIANT 3. "No percentage reaches a user" forbids a SCORE — a number
 * standing in for a judgement about somebody's footage, which is what Strong /
 * Worth a look / Long shot replaced. A fraction of an original used is not
 * that. It is a measurement of two durations, the seconds are printed beside
 * it so anybody can check the division, and doc 09 names it as a required
 * field because it is the single most load-bearing fact in a fair-dealing
 * argument. A number that can be verified from the two numbers above it is
 * evidence; a number nobody can reconstruct is a score.
 *
 * NOT LEGAL ADVICE, and the document says so in its own words. Doc 09 is
 * explicit that a media lawyer reviews before commercial publication.
 */

/** One external clip, as the rows already hold it. */
export interface DisputeClip {
  ledgerId: string;
  /** The person owed the credit. */
  channel: string | null;
  sourceTitle: string | null;
  platform: string | null;
  url: string | null;
  /** The span of the ORIGINAL this cut uses. */
  inS: number;
  outS: number;
  /** How long the original runs. Null when nobody has told us. */
  originalS: number | null;
  /** The attribution as written. Null when none was ever written. */
  credit: string | null;
  /** Written and then taken off, which is not the same as never written. */
  creditRemoved: boolean;
  /**
   * Whether the quote was checked against its source, word for word.
   *
   * "verified" | "paraphrase" | "rejected" from src/scout-verify.ts, and null
   * where nothing looked. The receipts page shows this to a stranger, so it
   * is the difference between "we checked this" and "somebody typed this".
   */
  verify?: string | null;
  quote: string;
}

export interface DisputeEntry extends DisputeClip {
  usedS: number;
  /** usedS / originalS, or null when the original's length is unknown. */
  fraction: number | null;
  /** What happened about the credit, in a sentence. */
  attribution: string;
}

/** m:ss, or h:mm:ss once there is an hour in it. */
export function clock(s: number): string {
  const n = Math.max(0, Math.round(s));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const sec = n % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

/** How much of the original this cut uses, in seconds. Never negative. */
export function usedSeconds(c: Pick<DisputeClip, "inS" | "outS">): number {
  return Math.max(0, c.outS - c.inS);
}

/**
 * The fraction of the original used, or null when that cannot be known.
 *
 * NULL RATHER THAN A GUESS. Scout stores a source's duration where the
 * platform reported one and leaves it null where it did not, so "we used 12
 * seconds of it" is sometimes all there is. Printing 0% would understate the
 * take and 100% would overstate it, and both would be this document inventing
 * the one figure it exists to report. "Not known" is a true answer and a
 * lawyer can go and measure it.
 *
 * A clip longer than the original it came from is a data error, not a 300%
 * take, so it clamps at 1 — the number is wrong either way and an impossible
 * one invites somebody to dismiss the rest of the file.
 */
export function fractionUsed(usedS: number, originalS: number | null): number | null {
  if (originalS === null || !Number.isFinite(originalS) || originalS <= 0) return null;
  if (!Number.isFinite(usedS) || usedS < 0) return null;
  return Math.min(1, usedS / originalS);
}

/**
 * What happened about the credit.
 *
 * THREE STATES, AND ONLY ONE OF THEM IS A DEFENCE. src/scout-credit.ts says
 * it at editCredit: "'There was no credit' and 'somebody took the credit off'
 * are different facts about a video and only one of them is a defence", and
 * this is the place that was written for. The third is a row Scout never
 * verified, which gets no credit at all because a credit is a claim about
 * where words came from.
 */
export function attributionLine(c: Pick<DisputeClip, "credit" | "creditRemoved">): string {
  if (c.creditRemoved) {
    return c.credit
      ? `WRITTEN AND THEN REMOVED: "${c.credit}" — taken off the screen deliberately.`
      : "Removed. No text was kept, which should not happen.";
  }
  if (c.credit) return `On screen: "${c.credit}"`;
  return "None written. Nothing verified this clip's source, so no credit could be claimed.";
}

export function disputeEntries(clips: DisputeClip[]): DisputeEntry[] {
  return clips.map((c) => {
    const usedS = usedSeconds(c);
    return { ...c, usedS, fraction: fractionUsed(usedS, c.originalS), attribution: attributionLine(c) };
  });
}

export interface Commentary {
  /** Null when the cut's runtime could not be measured. */
  ownS: number | null;
  clipS: number;
  /** ownS / clipS. Null when there is no ratio to be had. */
  ratio: number | null;
  /** Below 1:1 — more of other people's footage than of your own. */
  thin: boolean;
}

/**
 * The maker's own time against other people's.
 *
 * Doc 09, from the leading reaction case: interspersed short source segments
 * with substantial commentary were "quintessential criticism and comment",
 * and a watch-along without commentary is a different thing. So the product
 * warns below 1:1 rather than refusing — it is a signal to the person making
 * the video, and the case turns on much more than a ratio.
 *
 * `thin` is false when there are no external clips at all: a video entirely
 * of your own footage has no ratio to be on the wrong side of, and warning
 * about one would be the document crying wolf on every ordinary cut.
 */
export function commentary(totalS: number | null, clipS: number): Commentary {
  const clip = Math.max(0, clipS);
  /* Same rule as fractionUsed: a figure nobody can stand behind is not
     reported. A cut whose runtime could not be measured would otherwise come
     out at nought to one, which reads as the worst possible answer and is
     really no answer at all. */
  if (totalS === null || !Number.isFinite(totalS)) {
    return { ownS: null, clipS: clip, ratio: null, thin: false };
  }
  const ownS = Math.max(0, totalS - clip);
  if (clip <= 0) return { ownS, clipS: 0, ratio: null, thin: false };
  const ratio = ownS / clip;
  return { ownS, clipS: clip, ratio, thin: ratio < 1 };
}

const pct = (f: number): string => `${(f * 100).toFixed(f < 0.01 ? 2 : 1)}%`;

/**
 * The document that ships beside the file.
 *
 * Written for a person deciding something — a platform reviewer, a lawyer, the
 * maker answering a claim — so every figure shows its working and the file
 * says plainly what it is not.
 */
export function disputeText(entries: DisputeEntry[], c: Commentary, title: string): string {
  const out: string[] = [
    `DISPUTE FILE — ${title}`,
    "",
    "Every clip in this cut that came from somebody else, with where it came",
    "from and how much of it was used. Assembled as the video was made.",
    "",
    "This is a record, not legal advice, and it cannot tell you what is fair",
    "use. Have a media lawyer read it before you publish commercially.",
    "",
  ];

  if (!entries.length) {
    out.push("There are none: every clip in this cut is the maker's own footage.");
    return out.join("\n");
  }

  out.push(
    "YOUR TIME AGAINST THEIRS",
    `  Your own footage: ${c.ownS === null ? "not measured" : clock(c.ownS)}`,
    `  Other people's:   ${clock(c.clipS)}`,
    c.ratio === null
      ? `  Ratio: ${c.ownS === null ? "the cut's runtime is not known, so there is no ratio to give." : "not applicable."}`
      : `  Ratio: ${c.ratio.toFixed(2)} to 1.${c.thin ? "  <- MORE OF THEIRS THAN YOURS." : ""}`,
  );
  if (c.thin) {
    out.push(
      "  Below one to one. Commentary alongside a clip is what the leading",
      "  reaction case called criticism and comment; a watch-along is not.",
    );
  }
  out.push("");

  entries.forEach((e, i) => {
    out.push(
      `${i + 1}. ${e.channel || e.sourceTitle || "Unknown source"}`,
      `   Where:  ${e.url || "no link recorded"}`,
      `   Platform: ${e.platform || "not recorded"}`,
      `   Taken from: ${clock(e.inS)}–${clock(e.outS)} of the original`,
      e.fraction === null
        ? `   How much: ${clock(e.usedS)} used. The original's length is not known, so the fraction cannot be given.`
        : `   How much: ${clock(e.usedS)} of ${clock(e.originalS as number)} — ${pct(e.fraction)} of the original.`,
      `   Credit: ${e.attribution}`,
      `   Words:  "${e.quote}"`,
      "",
    );
  });

  return out.join("\n").trimEnd();
}

interface Row {
  ledger_id: string;
  in_s: number;
  out_s: number;
  quote: string;
  channel: string | null;
  title: string | null;
  adapter: string | null;
  url: string | null;
  duration_s: number | null;
  credit_text: string | null;
  removed: number | null;
  verify: string | null;
}

/**
 * Every external clip in a cut, read in the order it was taken.
 *
 * A dropped mission is not here: the person decided against that clip and it
 * is not in the file. Every other state is, INCLUDING a mission still open —
 * a ghost holding a place is a clip this cut intends to use, and leaving it
 * out would make the document complete only by accident of timing.
 */
export async function disputeFor(db: D1Database, projectId: string): Promise<DisputeEntry[]> {
  const { results } = await db
    .prepare(
      `SELECT m.ledger_id, m.in_s, m.out_s, m.quote,
              s.channel, s.title, s.adapter, s.url, s.duration_s,
              a.credit_text, a.removed, l.verify
         FROM scout_missions m
         LEFT JOIN scout_ledger l ON l.id = m.ledger_id
         LEFT JOIN scout_sources s ON s.id = l.source_id
         LEFT JOIN scout_attributions a ON a.ledger_id = m.ledger_id
        WHERE m.project_id = ? AND m.state != 'dropped'
        ORDER BY m.created_at, m.ledger_id`,
    )
    .bind(projectId)
    .all<Row>();

  return disputeEntries(
    (results ?? []).map((r) => ({
      ledgerId: r.ledger_id,
      channel: r.channel,
      sourceTitle: r.title,
      platform: r.adapter,
      url: r.url,
      inS: Number(r.in_s),
      outS: Number(r.out_s),
      originalS: r.duration_s === null ? null : Number(r.duration_s),
      credit: r.credit_text,
      creditRemoved: Boolean(r.removed),
      verify: r.verify,
      quote: r.quote,
    })),
  );
}
