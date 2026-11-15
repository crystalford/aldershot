/**
 * THE CUE SHEET, AND THE LABEL NOBODY HAS TO ASK FOR.
 *
 * `09-EXPORT-AND-INTEGRITY.md`: "every picture typed evidence / illustration /
 * synthetic; the type sets the label", and the cue sheet — what, how made,
 * when — is exported with the project. Phase 6 accepts on it bluntly: "an
 * export with a generated segment carries the label and the cue-sheet entry
 * WITHOUT USER ACTION".
 *
 * So there is no setting here and nothing to switch on. A beat's kind decides
 * its picture type, the type decides the label, and both fall out of inserting
 * the beat. The spec's own sentence for this is "the product never has to be
 * asked to label: the picture's type drives it".
 *
 * WHY NOT `Block.origin`. Blocks already distinguish footage, voice and
 * generated, and that is one value too few: `fromBeat` maps BOTH a generated
 * picture and a stock clip to "generated", and those are different claims to
 * a viewer and different duties in law. A synthetic picture needs the
 * AI-generated label; a stock clip needs a credit and is somebody else's work,
 * not a machine's. Widening BlockOrigin would have touched every reader of it
 * to serve one of them, so the label is carried beside origin instead, set at
 * the single place that still knows which kind of beat it came from.
 *
 * DATED, AND THAT MATTERS. EU AI Act Article 50 transparency duties apply from
 * 2 August 2026, and the Commission's code asks for the label to be
 * perceivable at first exposure, with metadata and watermark alongside it.
 * Only the label and this document are built here; a watermark is the
 * renderer's and is not pretended to exist.
 */

import { KIND_LABEL, type PictureKind } from "./pictures.ts";

/**
 * The two beat kinds that put a picture on screen that is not the user's own
 * footage, and the picture type each one is.
 *
 * `stock` is an illustration: somebody else made it, of the thing being
 * talked about. `generated` is synthetic: nobody made it, of nothing.
 * Neither can ever be `evidence` — that is invariant 8, enforced in
 * src/pictures.ts rather than restated here.
 */
export const PICTURE_KIND = {
  generated: "synthetic",
  stock: "illustration",
} as const satisfies Record<string, PictureKind>;

export type PictureBeatKind = keyof typeof PICTURE_KIND;

export const isPictureBeat = (kind: string): kind is PictureBeatKind =>
  Object.prototype.hasOwnProperty.call(PICTURE_KIND, kind);

/**
 * The on-screen label for a beat, or null when a beat needs none.
 *
 * Null for footage and voice, because a label on everything is a label on
 * nothing: the whole point is that it marks the exception. Derived, never
 * stored — a stored label would go stale the moment a beat's kind changed,
 * and there would then be two answers to what is on screen.
 */
export function labelFor(kind: string): string | null {
  return isPictureBeat(kind) ? KIND_LABEL[PICTURE_KIND[kind]] : null;
}

/** What the cue sheet needs to know about one beat. */
export interface CueBeat {
  id: string;
  kind: string;
  text?: string | null;
  /** The asset, when one exists. A generated beat is a card until it does. */
  media_r2_key?: string | null;
  /** When the asset was made. Null while there is nothing to date. */
  recorded_at?: number | null;
  /** Where a stock clip came from, where that is known. */
  source_title?: string | null;
  /** Struck whole: still on the page, not in the file. */
  struck?: boolean;
}

export interface CueEntry {
  beatId: string;
  /** The label that goes on screen over this beat. */
  label: string;
  /** What it shows, in the maker's own words where there are any. */
  what: string;
  /** How it was made. */
  how: string;
  /** When, as an ISO day. Null when nothing has been made yet. */
  when: string | null;
}

/** The one line that admits a generated beat has no picture behind it yet. */
const NOT_MADE = "Nothing generated for it yet — this beat is a card in the cut.";

/**
 * The cue sheet for a cut: one entry per picture that is not the user's own
 * footage, in cut order.
 *
 * Struck beats are not here. Nothing is deleted in this product (invariant 6)
 * and a struck beat is still on the page struck through — but it is not in the
 * file, and a cue sheet is a document about the file. Listing a picture the
 * viewer cannot see would be the mirror of the failure this exists to prevent.
 */
export function cueSheet(beats: CueBeat[]): CueEntry[] {
  const out: CueEntry[] = [];
  for (const b of beats) {
    const label = labelFor(b.kind);
    if (!label) continue;
    if (b.struck) continue;
    const kind = b.kind as PictureBeatKind;

    /*
     * Invariant 10: the user's own words win where they exist. The beat's
     * text is what they wrote the picture was for, and it is a better
     * description than anything this could compose.
     */
    const what = b.text?.trim() || "(no description)";

    let how: string;
    if (!b.media_r2_key) {
      how = NOT_MADE;
    } else if (kind === "generated") {
      /*
       * No model and version, because nothing writes one: the generated
       * picture supply does not exist yet (Phase 5 owes it). When it lands,
       * the tag belongs here — the convention is that every model call is
       * tagged with its version — and saying "generated by" and stopping is
       * the honest shape until then rather than a name invented here.
       */
      how = "Generated — not photoreal, and never over a claim or its proof.";
    } else {
      how = b.source_title?.trim()
        ? `Someone else's footage, from ${b.source_title.trim()}.`
        : "Someone else's footage.";
    }

    out.push({
      beatId: b.id,
      label,
      what,
      how,
      when: b.recorded_at ? new Date(b.recorded_at).toISOString().slice(0, 10) : null,
    });
  }
  return out;
}

/**
 * The cue sheet as the document that ships beside the file.
 *
 * Plain text rather than JSON, because a cue sheet is read by a person — a
 * platform's reviewer, a broadcaster, somebody answering a complaint — and
 * the audience for the machine-readable version is the provenance manifest.
 */
export function cueSheetText(entries: CueEntry[], title: string): string {
  const head = [`CUE SHEET — ${title}`, "", "Every picture in this cut that is not the maker's own footage."];
  if (!entries.length) {
    return [...head, "", "There are none: every frame of this cut is the maker's own footage."].join("\n");
  }
  const body = entries.map((e, i) => {
    const lines = [
      `${i + 1}. ${e.label}`,
      `   What: ${e.what}`,
      `   How:  ${e.how}`,
      `   When: ${e.when ?? "not made yet"}`,
    ];
    return lines.join("\n");
  });
  return [...head, "", ...body].join("\n");
}

/**
 * The cue sheet for a stored project, read in cut order.
 *
 * The source title comes through the beat's clip, which is how a stock beat
 * knows whose footage it is. A generated beat has no clip and needs none —
 * there is no "whose" about it, which is the whole reason it needs a label.
 */
export async function cueSheetFor(db: D1Database, projectId: string): Promise<CueEntry[]> {
  const { results } = await db
    .prepare(
      `SELECT b.id, b.kind, b.text, b.struck, b.media_r2_key, b.recorded_at, s.title AS source_title
         FROM beats b
         LEFT JOIN v2_clips c ON c.id = b.clip_id
         LEFT JOIN sources s ON s.id = c.source_id
        WHERE b.project_id=?
        ORDER BY b.idx`,
    )
    .bind(projectId)
    .all<{
      id: string;
      kind: string;
      text: string | null;
      struck: string | null;
      media_r2_key: string | null;
      recorded_at: number | null;
      source_title: string | null;
    }>();

  return cueSheet(
    (results ?? []).map((r) => ({
      ...r,
      /* The same reading of the column as blocks.ts and envelopeBreaks. */
      struck: Boolean(r.struck) && r.struck !== "0",
    })),
  );
}
