/**
 * THE PROVENANCE MANIFEST.
 *
 * `09-EXPORT-AND-INTEGRITY.md`, the Provenance record row: "every source,
 * every edit, and for each claim the line in the footage that backs it;
 * existing records kept, not stripped" — and the Fixes column says "always
 * on".
 *
 * EVERY EDIT IS THE RULE SET, and that is not a shortcut. Invariant 1: "a cut
 * is re-produced from rules + moments, never stored as an outcome". So the
 * honest record of what was done to this footage is the rules that did it,
 * plus what each rule left out — not a log of clicks, which would describe a
 * session rather than a film. Switched-off rules are in here too: "there was
 * never such a rule" and "somebody turned that rule off" are different facts,
 * the same distinction the dispute file draws about credits.
 *
 * TWO THINGS DOC 09 ASKS FOR THAT THIS CANNOT DO, said in the file itself
 * rather than left as a gap somebody discovers:
 *
 *   A per-claim evidence ledger. `03-DATA-MODEL.md` specifies an `evidence`
 *   table — claim, moment, quote, judge label, verification — and it does not
 *   exist. What exists is a plan's claim and the moments found for each of
 *   its beats, which is the same shape one level coarser, and it is only
 *   there for a cut that came from a plan.
 *
 *   "Existing records kept, not stripped." A camera or another editor may
 *   have written C2PA provenance into a source file. Nothing here reads it,
 *   so nothing here can promise to carry it through — and a manifest that
 *   quietly said nothing about that would be claiming the one property its
 *   own sentence names.
 *
 * JSON, not prose, because this one is for a machine as much as a person: a
 * platform ingesting it, a later version of this product reading it back, a
 * lawyer's tooling diffing two cuts. The cue sheet and the dispute file are
 * the ones written to be read.
 */

import type { CueEntry } from "./cuesheet.ts";
import type { DisputeEntry } from "./dispute.ts";
import type { Rule } from "./rules.ts";

/**
 * Bumped when the SHAPE changes, so a reader knows what it is holding.
 *
 * A manifest with no version is a manifest that can never be changed without
 * breaking whatever read the last one.
 */
export const MANIFEST_VERSION = 1;

export interface ManifestSource {
  id: string;
  title: string;
  /** "yours" or the platform an external clip came from. */
  from: string;
  url?: string;
}

export interface LeftOut {
  momentId: string;
  text: string;
  /** The rule that took it out, as the person's own sentence where there is one. */
  rule: string;
}

export interface ManifestInput {
  projectId: string;
  title: string;
  runtimeS: number | null;
  sources: ManifestSource[];
  rules: Rule[];
  leftOut: LeftOut[];
  /**
   * Lines struck out by hand, which for most cuts IS the editing.
   *
   * The first version recorded only `leftOut` — moments a rule removed — and
   * on the main way this product is used it came back empty. "The editor is
   * the transcript: strike what you don't want"; a record of every edit that
   * omits striking is a record of the rules, which is not the same claim.
   */
  struckOut: Array<{ blockId: string; text: string }>;
  pictures: CueEntry[];
  external: DisputeEntry[];
  /** From the plan a cut was built from, where there was one. */
  claim?: { text: string; beats: Array<{ name: string; need: string; found: string[] }> } | null;
  madeAt: number;
}

export interface Manifest {
  manifest: number;
  cut: { id: string; title: string; runtimeS: number | null; madeAt: string };
  sources: ManifestSource[];
  /** Every rule, on and off, in the order the pane shows them. */
  rules: Array<{ n: number; kind: string; on: boolean; says: string | null }>;
  leftOut: LeftOut[];
  struckOut: ManifestInput["struckOut"];
  claim: ManifestInput["claim"];
  pictures: Array<{ label: string; what: string; how: string; when: string | null }>;
  external: Array<{
    source: string | null;
    url: string | null;
    usedS: number;
    ofS: number | null;
    fractionOfOriginal: number | null;
    credit: string | null;
    creditRemoved: boolean;
  }>;
  /** What this record does NOT cover. Part of the record. */
  notCovered: string[];
}

/** The gaps, written into the document rather than left for somebody to find. */
export const NOT_COVERED = [
  "No per-claim evidence ledger: the evidence table in doc 03 is not built. Where this cut came from a plan, the claim and the moments found for each beat are below.",
  "Provenance written into the source files by a camera or another editor (C2PA and the like) is not read, so it is neither carried through nor reported here.",
  "Nothing fingerprints uploaded footage. A source listed as yours is listed as yours because that is how it arrived.",
];

/**
 * The manifest.
 *
 * Pure, and every field comes from something already written down. A record
 * assembled by going and looking at the video now would be a record of this
 * moment rather than of how the cut was made.
 */
export function buildManifest(i: ManifestInput): Manifest {
  return {
    manifest: MANIFEST_VERSION,
    cut: {
      id: i.projectId,
      title: i.title,
      runtimeS: i.runtimeS,
      madeAt: new Date(i.madeAt).toISOString(),
    },
    sources: i.sources,
    /* Numbered as the rules pane numbers them, because that is how a person
       refers to one: "rule 3 took that out". */
    rules: i.rules.map((r, n) => ({
      n: n + 1,
      kind: r.kind,
      on: r.on,
      says: r.text ?? null,
    })),
    leftOut: i.leftOut,
    struckOut: i.struckOut,
    claim: i.claim ?? null,
    pictures: i.pictures.map((p) => ({ label: p.label, what: p.what, how: p.how, when: p.when })),
    external: i.external.map((e) => ({
      source: e.channel ?? e.sourceTitle,
      url: e.url,
      usedS: e.usedS,
      ofS: e.originalS,
      fractionOfOriginal: e.fraction,
      credit: e.credit,
      creditRemoved: e.creditRemoved,
    })),
    notCovered: NOT_COVERED,
  };
}

/** Indented, because a person opens this too when something has gone wrong. */
export const manifestJson = (m: Manifest): string => JSON.stringify(m, null, 2);
