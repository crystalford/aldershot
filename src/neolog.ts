/**
 * NEOLOG, AS A SOURCE OF FOOTAGE AND NOTHING ELSE.
 *
 * `17-STORAGE-AND-NEOLOG.md` maps the whole archive across, including its
 * `transcript_words` table — which is already a word table, so importing it
 * would be close to free and would skip transcription entirely.
 *
 * WE ARE DELIBERATELY NOT DOING THAT, and the reason is the owner's: the
 * transcripts there are not trusted. Neolog has a workflow whose job is
 * scanning for hallucinated transcript text, which is a good reason to doubt
 * them, and a cut built on a wrong word is wrong in a way the product cannot
 * see. Invariant 4 is that every claim keeps its receipt; a receipt pointing
 * at a word that was never said is worse than no receipt.
 *
 * So footage comes across and Aldershot reads it itself, exactly as if it had
 * been uploaded. The cost of that is real — the footage-hour meter applies —
 * which is why importing marks a source UNREAD rather than queueing a read.
 *
 * WHAT THIS TAKES, THEN, IS METADATA: how long each video is and when it was
 * shot. Both matter immediately rather than theoretically:
 *
 *  - Length is how you choose what to read, now that reading is a decision
 *    you make per video and pay for. A list of filenames is not a list you
 *    can choose from.
 *  - The date is what `time` ordering ("as it happened") and Story sort by,
 *    and it is the one field that cannot be recovered later: a re-encoded
 *    file has usually lost it, and nothing else knows.
 *
 * This file is the only Neolog-shaped thing in the codebase. Everything
 * around it is the generic bucket connector in src/bucket.ts, which works for
 * any S3-compatible store.
 */

/** One row of Neolog's `vlogs` table — only the columns we read. */
export interface VlogRow {
  id: string;
  r2_key: string | null;
  transcoded_r2_key: string | null;
  thumbnail_r2_key: string | null;
  duration_seconds: number | null;
  recorded_at: string | number | null;
  pipeline_status: string | null;
  is_podcast: number | null;
  deleted_at: string | number | null;
}

/**
 * THE COLUMNS THIS IS ALLOWED TO ASK FOR.
 *
 * Written out rather than `SELECT *` so that the absence of
 * `transcript_text` and `transcript_words` is a fact you can read here, and
 * so that adding either is a visible edit to this line rather than something
 * that arrives by itself when the other schema changes.
 */
export const VLOG_COLUMNS =
  "id, r2_key, transcoded_r2_key, thumbnail_r2_key, duration_seconds, recorded_at, pipeline_status, is_podcast, deleted_at";

export interface Importable {
  /** The object to read, in the connected bucket. */
  key: string;
  /** What it is called before anything has read it. */
  title: string;
  durationS: number | null;
  /** When it was SHOT, in epoch ms. Null when the archive does not know. */
  recordedAt: number | null;
  posterKey: string | null;
  /** Neolog's own id, so a second import recognises what it already has. */
  foreignId: string;
}

/**
 * A date, from whatever the column happens to hold.
 *
 * Neolog stores `recorded_at` alongside a `recorded_at_source`, which means
 * it has more than one provenance and therefore more than one likely format.
 * Epoch seconds, epoch milliseconds and an ISO string all appear in archives
 * of this shape, and guessing wrong by a factor of a thousand puts footage in
 * 1970 or in the year 56000 — both of which would order a Story silently
 * wrongly rather than visibly failing.
 *
 * So: a number small enough to be seconds is treated as seconds, anything
 * unparseable is null, and null is honest.
 */
export function recordedAtMs(raw: string | number | null): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw <= 0) return null;
    /* ~2001 in ms. Below it, the only sane reading is seconds. */
    return raw < 1_000_000_000_000 ? Math.round(raw * 1000) : Math.round(raw);
  }
  const asNumber = Number(raw);
  if (raw.trim() !== "" && Number.isFinite(asNumber)) return recordedAtMs(asNumber);
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Which rows are worth offering, and what each becomes.
 *
 * A deleted row is not footage you have. An incomplete one has no finished
 * object behind it. Neither is an error — they are simply not things to
 * import, so they are absent rather than listed as broken.
 *
 * `transcoded_r2_key` is preferred over `r2_key` when it exists, because it
 * is the smaller file and reading is all we do with it. The original stays
 * where it is and is what a render would reach for.
 */
export function importableFrom(rows: VlogRow[]): Importable[] {
  const out: Importable[] = [];
  for (const r of rows) {
    if (r.deleted_at) continue;
    if (r.pipeline_status && r.pipeline_status !== "complete") continue;
    const key = r.transcoded_r2_key || r.r2_key;
    if (!key) continue;
    out.push({
      key,
      /*
       * The filename, and only until it has been read.
       *
       * Neolog's rows carry no title, and the owner's own note on this
       * product is that a cut should be named for what it is about rather
       * than for the file. The read names it; this is the placeholder that
       * gets you to the read.
       */
      title: key.split("/").pop()?.replace(/\.[^.]+$/, "") || key,
      durationS:
        typeof r.duration_seconds === "number" && r.duration_seconds > 0
          ? Math.round(r.duration_seconds)
          : null,
      recordedAt: recordedAtMs(r.recorded_at),
      posterKey: r.thumbnail_r2_key || null,
      foreignId: String(r.id),
    });
  }
  return out;
}
