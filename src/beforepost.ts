/**
 * BEFORE YOU POST.
 *
 * `09-EXPORT-AND-INTEGRITY.md` opens with it: "A checklist, each line a plain
 * sentence with one-press fixes, the recommended one first. IT IS WHERE THE
 * SYSTEM SAYS WHAT IT KNOWS AND WHAT IT CAN'T KNOW."
 *
 * That second sentence is the design. Seven lines are specified and this
 * product can honestly answer four of them. Music detection and face
 * detection do not exist here, and a checklist that showed a tick beside
 * "Faces" because nothing had looked would be worse than no checklist at all
 * — it would be the product telling somebody their video is clear when all it
 * means is that nobody checked.
 *
 * So there are three states and never two. `ok` is checked and clear.
 * `attention` is checked and there is something. `unchecked` is nobody looked,
 * and it reads as its own sentence rather than borrowing either of the others.
 * Invariant 4 says "nothing backs this" must be a reachable answer; this is
 * the same promise pointed at the product's own abilities.
 *
 * NOTHING HERE DECIDES ANYTHING. The checklist reports; the export happens
 * either way. The one thing that stops a render is the integrity envelope
 * (src/envelope.ts), because a split claim is a cut that says something the
 * footage does not. Everything else is somebody's judgement to make.
 */

import type { CueEntry } from "./cuesheet.ts";
import type { Commentary, DisputeEntry } from "./dispute.ts";
import type { Verdict as LoudnessVerdict } from "./loudness.ts";
import type { Cue } from "./captions.ts";

export type State = "ok" | "attention" | "unchecked";

export interface Line {
  key: string;
  /** Doc 09's own row name. */
  title: string;
  state: State;
  /** One plain sentence, in the voice of somebody saying it out loud. */
  says: string;
  /** The particulars, where there are any. */
  detail: string[];
}

export interface Checked {
  external: DisputeEntry[];
  commentary: Commentary;
  pictures: CueEntry[];
  loudness: LoudnessVerdict;
  /** Cues that read faster than the limit, from src/captions.ts. */
  tooFast: Cue[];
  /** Whether this export gets a subtitle file beside it. */
  sidecar: boolean;
  /** How many cues there are at all. Zero means no captions were built. */
  cueCount: number;
  /**
   * Whether this cut has ever been exported.
   *
   * Loudness is a property of a finished file, so before the first export
   * there is nothing to measure and "we could not measure it" would be
   * nagging about something that cannot be known yet. After one, the same
   * missing number is a real failure — same absence, different fact.
   */
  everRendered: boolean;
  /**
   * Whether this cut came from a plan, so a claim and its backing beats exist.
   *
   * Doc 09 asks the provenance record for "each claim the line in the footage
   * that backs it". A cut assembled by striking text makes no claim the
   * product knows about, so there is nothing of that shape to record — which
   * is different from having claims and no record of them.
   */
  hasClaim: boolean;
}

const NOT_BUILT = "Nothing in Aldershot checks this yet.";

/** Other people's footage, and the one thing this cannot tell you. */
function footageLine(c: Checked): Line {
  const detail: string[] = [];
  /*
   * THE LIMIT GOES IN EVERY TIME, not only when something is found.
   *
   * Doc 09 asks for a fingerprint match against sources marked as someone
   * else's. There is no fingerprinting here: what this knows about is clips
   * Scout found and linked, which it knows about because it put them there.
   * Footage somebody uploaded is taken at their word, and a person reading a
   * clear line has to be told that is what "clear" means.
   */
  detail.push("Footage you uploaded is taken at your word — nothing here fingerprints it.");
  detail.push("It cannot tell you what is fair use.");

  if (!c.external.length) {
    return {
      key: "footage",
      title: "Other people's footage",
      state: "ok",
      says: "Every clip in this cut is yours.",
      detail,
    };
  }

  const n = c.external.length;
  const says = `${n} clip${n === 1 ? "" : "s"} came from somebody else, and the dispute file lists ${n === 1 ? "it" : "them"}.`;
  if (c.commentary.thin) {
    detail.unshift(
      "More of this cut is theirs than yours. Commentary alongside a clip is what the leading reaction case called criticism and comment; a watch-along is not.",
    );
  }
  return {
    key: "footage",
    title: "Other people's footage",
    state: c.commentary.thin ? "attention" : "ok",
    says,
    detail,
  };
}

/** Music under a stretch. Nothing detects it. */
const musicLine = (): Line => ({
  key: "music",
  title: "Music",
  state: "unchecked",
  says: `${NOT_BUILT} If there is music under your words, nobody has ducked it.`,
  detail: ["Ducking by word timings is specified and not built."],
});

/** Someone else in shot. Nothing detects it. */
const facesLine = (): Line => ({
  key: "faces",
  title: "Faces",
  state: "unchecked",
  says: `${NOT_BUILT} If somebody else appears in this, you are the one who knows.`,
  detail: [],
});

/** Generated and stock pictures, and the labels they carry. */
function picturesLine(c: Checked): Line {
  if (!c.pictures.length) {
    return {
      key: "pictures",
      title: "Generated segments",
      state: "ok",
      says: "There are no generated or stock pictures in this cut.",
      detail: [],
    };
  }
  const unlabelled = c.pictures.filter((p) => !p.label);
  if (unlabelled.length) {
    /* Not reachable through the product — the label comes off the beat's kind
       — so if it ever happens something upstream is broken and saying "fine"
       would hide it. */
    return {
      key: "pictures",
      title: "Generated segments",
      state: "attention",
      says: `${unlabelled.length} picture${unlabelled.length === 1 ? " has" : "s have"} no label, which should not be possible.`,
      detail: unlabelled.map((p) => p.what),
    };
  }
  const n = c.pictures.length;
  return {
    key: "pictures",
    title: "Generated segments",
    state: "ok",
    says: `${n} picture${n === 1 ? "" : "s"} ${n === 1 ? "is" : "are"} labelled on screen, and the cue sheet says how ${n === 1 ? "it was" : "they were"} made.`,
    detail: c.pictures.map((p) => `${p.label}: ${p.what}`),
  };
}

/** A credit at first use, for every external clip. */
function creditsLine(c: Checked): Line {
  if (!c.external.length) {
    return {
      key: "credits",
      title: "Attributions",
      state: "ok",
      says: "Nothing in this cut needs a credit.",
      detail: [],
    };
  }
  const removed = c.external.filter((e) => e.creditRemoved);
  const missing = c.external.filter((e) => !e.creditRemoved && !e.credit);
  if (!removed.length && !missing.length) {
    return {
      key: "credits",
      title: "Attributions",
      state: "ok",
      says: `Every clip that came from somebody else has a credit.`,
      detail: c.external.map((e) => e.credit as string),
    };
  }
  const detail: string[] = [];
  /* Two different facts, and only one of them is a defence — see the dispute
     file and src/scout-credit.ts at editCredit. */
  for (const e of removed) {
    detail.push(`Credit taken off: ${e.channel ?? e.sourceTitle ?? "an external clip"}.`);
  }
  for (const e of missing) {
    detail.push(`No credit written: ${e.channel ?? e.sourceTitle ?? "an external clip"} — nothing verified where it came from.`);
  }
  const parts: string[] = [];
  if (removed.length) parts.push(`${removed.length} ${removed.length === 1 ? "credit was" : "credits were"} taken off`);
  if (missing.length) parts.push(`${missing.length} ${missing.length === 1 ? "has" : "have"} none written`);
  return {
    key: "credits",
    title: "Attributions",
    state: "attention",
    says: `${parts.join(", and ")}.`,
    detail,
  };
}

/** Loudness, peaks and captions — the row doc 09 says is checked, not fixed. */
function soundLine(c: Checked): Line {
  if (!c.everRendered) {
    const detail = ["Export it once and the loudness is measured on the file itself."];
    if (c.cueCount === 0) detail.push("There are no captions, because nothing in this cut has words.");
    else if (c.tooFast.length) {
      detail.push(
        `${c.tooFast.length} caption${c.tooFast.length === 1 ? " reads" : "s read"} faster than 17 characters a second. Nothing is rewritten to fix that — they are your words.`,
      );
    }
    return {
      key: "sound",
      title: "Sound and captions",
      state: "unchecked",
      says: "Nothing has been exported yet, so there is no sound to measure.",
      detail,
    };
  }

  const detail: string[] = [...c.loudness.problems];

  if (c.cueCount === 0) {
    detail.push("There are no captions, because nothing in this cut has words.");
  } else if (c.tooFast.length) {
    detail.push(
      `${c.tooFast.length} caption${c.tooFast.length === 1 ? " reads" : "s read"} faster than 17 characters a second. Nothing is rewritten to fix that — they are your words.`,
    );
  }
  detail.push(
    c.sidecar
      ? "A subtitle file goes out beside the video."
      : "Captions are burned into the picture, so there is no subtitle file — two copies would draw over each other.",
  );

  const wrong = !c.loudness.ok || c.tooFast.length > 0;
  return {
    key: "sound",
    title: "Sound and captions",
    state: wrong ? "attention" : "ok",
    says: wrong ? `Sound: ${c.loudness.summary}` : `Sound: ${c.loudness.summary} Captions read at a readable rate.`,
    detail,
  };
}

/** What is kept about where everything came from. */
const provenanceLine = (c: Checked): Line => ({
  key: "provenance",
  title: "Provenance record",
  state: "ok",
  says: c.hasClaim
    ? "Every source, every rule, what each rule left out, and the claim with what was found for each beat."
    : "Every source, every rule, and what each rule left out.",
  detail: [
    "Download it as the provenance manifest.",
    /*
     * THE LIMITS GO IN EVERY TIME. This line is `ok` because the record now
     * exists and downloads — but two of doc 09's words for it are still not
     * true, and a person who reads "ok" and nothing else would believe both.
     */
    c.hasClaim
      ? "There is no per-claim evidence ledger: the claim is recorded at the beat level, not utterance by utterance."
      : "This cut makes no claim the product knows about, so there is nothing of that shape to record.",
    "Provenance written into your source files by a camera or another editor is not read, so it is not carried through.",
  ],
});

/**
 * The checklist, in doc 09's own order.
 *
 * The order is not arbitrary and is not sorted by severity: it runs from
 * other people's work to your own record-keeping, which is the order somebody
 * worries about them in. Sorting by state would move the line nobody checked
 * to the bottom on a clean cut, which is exactly where it should not be.
 */
export function beforePost(c: Checked): Line[] {
  return [
    footageLine(c),
    musicLine(),
    facesLine(),
    picturesLine(c),
    creditsLine(c),
    soundLine(c),
    provenanceLine(c),
  ];
}

/** How many lines want looking at, and how many nobody has looked at. */
export function tally(lines: Line[]): { attention: number; unchecked: number } {
  return {
    attention: lines.filter((l) => l.state === "attention").length,
    unchecked: lines.filter((l) => l.state === "unchecked").length,
  };
}

/**
 * The one sentence at the top.
 *
 * It never says "ready to post", because this cannot know that: three of the
 * seven lines are things no software here has looked at, and a cheerful
 * summary over them would be the product claiming an all-clear it has no
 * basis for. It says what it found and what it did not look at, and the
 * person decides.
 */
export function summarise(lines: Line[]): string {
  const { attention, unchecked } = tally(lines);
  const bits: string[] = [];
  bits.push(
    attention === 0
      ? "Nothing to flag in what Aldershot can check."
      : `${attention} thing${attention === 1 ? "" : "s"} to look at.`,
  );
  if (unchecked) {
    bits.push(`${unchecked} line${unchecked === 1 ? "" : "s"} nothing here has checked at all.`);
  }
  return bits.join(" ");
}

/** How a line's state reads at the start of its row. */
const MARK: Record<State, string> = {
  ok: "[ ok ]",
  attention: "[ look ]",
  unchecked: "[  ?  ]",
};

/**
 * The checklist as the document a person reads before posting.
 *
 * Doc 09 describes one-press fixes beside each line, and most of them are
 * fixes for things this product cannot yet find: there is no music detection
 * to duck and no face detection to blur. A read-only checklist is what is
 * honestly available, and it is a document rather than a screen for the same
 * reason the cue sheet and the dispute file are — it is read once, before
 * something irreversible, and it should be as easy to keep as to open.
 *
 * The three marks are words rather than colours. A tick and a cross put
 * "nobody looked" and "nothing is wrong" in the same visual family, and the
 * whole point of the third state is that it is not either of them.
 */
export function checklistText(lines: Line[], title: string): string {
  const out: string[] = [`BEFORE YOU POST — ${title}`, "", summarise(lines), ""];
  for (const l of lines) {
    out.push(`${MARK[l.state]}  ${l.title}`);
    out.push(`         ${l.says}`);
    for (const d of l.detail) out.push(`         · ${d}`);
    out.push("");
  }
  out.push("[ ok ] checked and clear · [ look ] checked, and there is something");
  out.push("[  ?  ] nothing in Aldershot has looked at this at all");
  return out.join("\n");
}
