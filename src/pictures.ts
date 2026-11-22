/**
 * WHAT GOES ON SCREEN, AND WHY — the picture framework.
 *
 * Doc 08 opens on the problem: "Every script-to-video tool matches nouns:
 * 'the court ruled' gets a stock gavel. That is an integrity problem, not a
 * style one — a related but non-probative picture makes a claim more likely
 * to be judged true."
 *
 * So the picture answers "why am I seeing this", never "what noun did the
 * sentence contain". The line's MOVE decides the job, the source order and
 * what is forbidden; this file is that table and the refusals it implies.
 *
 * INVARIANT 8, which is the part with teeth: "own footage → user's documents
 * → open world → generated. Generated is never photoreal and never the
 * proof; over a claim only as a depiction a person chose, labelled so."
 * (Until 21 Nov it was never over a claim at all; see allowed().) Phase 5's acceptance asks for the refusal to be
 * TESTED, not merely intended, which is why every rule here is a function
 * returning a reason rather than a policy written in a comment.
 *
 * DETERMINISTIC. Choosing between candidates is arithmetic over their
 * provenance and what has already been shown; the only thing a model is
 * needed for is reading a line to say which move it is, and that sits
 * behind its own contract (`Classify`) rather than inside this.
 *
 * AND NO NUMBER REACHES A PERSON. The weights below order candidates and
 * never leave this file — invariant 3. What a person reads is the reason.
 */

/* ── The moves ──────────────────────────────────────────────────────────── */

export const MOVES = [
  "claim",
  "evidence",
  "turn",
  "context",
  "example",
  "abstraction",
  "joke",
  "transition",
  "conclusion",
] as const;
export type Move = (typeof MOVES)[number];

/*
 * A GUARD FOR A MOVE OFF A MODEL IS NOT HERE, and was.
 *
 * Nothing produces moves yet: classifying a line is the one part of this
 * framework that needs a model, and it will arrive behind its own
 * contract. A validator with no caller is the thing src/align.ts deleted
 * msForSpan for being — it goes in with the classifier, where the closed
 * schema it guards will also be.
 */

/** Where a picture came from, best first. Doc 08's source order. */
export const SOURCES = ["own", "documents", "world", "generated"] as const;
export type Source = (typeof SOURCES)[number];

/**
 * How much a source is worth, as an ORDER rather than a score.
 *
 * Doc 08's own numbers — own 1.0, documents 0.8, licensed open world 0.5,
 * generated 0.3 — kept as the gaps between them carry the intent: a
 * document is nearly as good as your own footage, and a generated picture
 * is a long way below both.
 *
 * INTERNAL. Invariant 3 is about what a person reads, and nothing here
 * reaches one: `place` returns a reason.
 */
export const SOURCE_WEIGHT: Record<Source, number> = {
  own: 1,
  documents: 0.8,
  world: 0.5,
  generated: 0.3,
};

/**
 * WHAT EACH MOVE WANTS, AND WHAT IT MAY NEVER HAVE.
 *
 * Straight out of doc 08's table. `wants` is the source order for that
 * move — a source not in the list is not merely worse, it is wrong for the
 * job — and `job` is the sentence a person reads when they ask why this
 * picture is here.
 */
export interface MoveRule {
  job: string;
  wants: readonly Source[];
  /** Said when a candidate is refused, in the move's own terms. */
  refuses: string;
}

export const MOVE_RULES: Record<Move, MoveRule> = {
  evidence: {
    job: "the proof itself — the document with its line marked",
    wants: ["own", "documents"],
    refuses: "proof cannot be illustrated; it has to be the thing itself",
  },
  claim: {
    job: "attribution — the speaker, a name super, the claim as type",
    wants: ["own"],
    refuses: "a claim is shown by who made it, not by a picture of the subject",
  },
  turn: {
    job: "contrast — cut back, or reprise with new meaning",
    wants: ["own"],
    refuses: "a turn is two things of yours against each other",
  },
  context: {
    job: "orientation — the place, the timeline",
    wants: ["own", "world", "generated"],
    refuses: "nothing here orients anybody",
  },
  example: {
    job: "one specific instance",
    wants: ["own", "documents", "generated"],
    refuses: "an example has to be a real one",
  },
  abstraction: {
    job: "a diagram or chart, from real numbers",
    wants: ["documents", "generated"],
    refuses: "a diagram is drawn from numbers, never found",
  },
  joke: {
    job: "timing — a hold, a reaction, or nothing",
    wants: ["own"],
    refuses: "a joke lands on a face or on nothing",
  },
  transition: {
    job: "a breath between two things",
    wants: ["own"],
    refuses: "a transition is yours or it is nothing",
  },
  conclusion: {
    job: "where it lands — the speaker, usually",
    wants: ["own"],
    refuses: "the landing is said by whoever is saying it",
  },
};

/* ── A candidate ────────────────────────────────────────────────────────── */

/** What a picture IS, which sets its on-screen label and its cue-sheet row. */
export type PictureKind = "evidence" | "illustration" | "synthetic";

export const KIND_LABEL: Record<PictureKind, string> = {
  evidence: "Evidence",
  illustration: "Illustration",
  synthetic: "Generated",
};

/**
 * The label on a generated picture a person put over a claim, in the
 * canvas's own words (design/canvas, the shot panel and the export's cue
 * sheet). Says both things a viewer needs: that it shows what is being said
 * rather than proving it, and that it was made. Decision 26 as of 21 Nov;
 * see allowed(). The canvas labels a plain generated picture "Made with AI"
 * where KIND_LABEL says "Generated"; that one is older and signed off, and
 * changing it is its own PR (doc 22, row 3's note).
 */
export const DEPICTION_LABEL = "Depiction · made with AI";

export interface Candidate {
  id: string;
  source: Source;
  /** What it is, which the label and the cue sheet both read. */
  kind: PictureKind;
  /**
   * A generated picture that looks like a photograph. Always refused —
   * decision 26, and doc 08: "AI imagery lowers trust even when labelled."
   */
  photoreal?: boolean;
  /** Whether the thing it shows is the thing being claimed, not merely near it. */
  probative?: boolean;
  /** What it is of, for the novelty penalty and for the reason line. */
  subject?: string;
}

export interface Refusal {
  /** Null when it is allowed. */
  reason: string | null;
  /**
   * Allowed as a DEPICTION: a generated picture over a claim, which goes on
   * screen labelled DEPICTION_LABEL with the claim's receipt unchanged.
   */
  depicts?: boolean;
}

export interface AllowOpts {
  /**
   * A PERSON CHOSE THIS PICTURE FOR A LINE KNOWN TO BE A CLAIM.
   *
   * Only then may a generated picture depict a claim. Two halves, both
   * needed. Chosen: the automatic offer (place) never passes this, so the
   * product never reaches for a generated picture over a claim on its own —
   * doc 08's order still decides what is offered. Known: an unanswered line
   * is `claim` (UNSURE, src/classify.ts) precisely so that a failure
   * refuses, and a depiction granted on a guess would turn that around and
   * let a misread piece of proof through. The caller says the line was
   * classified; nothing here can tell.
   */
  depict?: boolean;
}

/**
 * MAY THIS PICTURE GO ON THIS LINE?
 *
 * The refusal Phase 5 asks to be tested, and three more beside it. Each is
 * stated separately so the reason a person reads is the reason that
 * actually applied, rather than one sentence covering four cases.
 */
export function allowed(move: Move, c: Candidate, opts: AllowOpts = {}): Refusal {
  /*
   * INVARIANT 8, THE HARD HALF: generated is never the proof, and never over
   * a claim unless a person put it there as a depiction. Checked before the
   * move's own source list, because the list is a preference and this is a
   * prohibition — and because a reader looking for this rule should find it
   * first.
   *
   * WHY A DEPICTION IS ALLOWED NOW (decision 26, 21 Nov). The owner, making
   * an essay: "I should be able to use generative to simulate something, or
   * build a scene that depicts what is being discussed." A depiction over a
   * claim does not stand in for the claim's backing — the receipt is the
   * same receipt — and it is labelled as what it is, on screen and in the
   * cue sheet. What stays forbidden is the gavel problem's real harm: a
   * picture passed off as the proof. So `evidence` refuses whatever anyone
   * asks, and photoreal refuses below, on every move.
   */
  if (c.source === "generated" && move === "claim" && opts.depict && !c.photoreal) {
    return { reason: null, depicts: true };
  }
  if (c.source === "generated" && (move === "evidence" || move === "claim")) {
    return {
      reason: `a generated picture cannot carry ${move === "evidence" ? "evidence" : "a claim"} — ${MOVE_RULES[move].refuses}`,
    };
  }

  /* And never photoreal, on any move. Decision 26. */
  if (c.source === "generated" && c.photoreal) {
    return { reason: "generated pictures are never photoreal here" };
  }

  /*
   * EVIDENCE HAS TO BE PROBATIVE. The gavel problem in one line: a picture
   * that is merely about the same subject makes a claim more likely to be
   * believed without being any reason to believe it.
   */
  if (move === "evidence" && c.probative === false) {
    return { reason: "it is about the subject rather than evidence of it" };
  }

  /*
   * A VERIFIED SCOUT FIND IS THE THING ITSELF, and doc 08 could not say so.
   *
   * Its table gives EVIDENCE "own footage → user's documents" and forbids
   * "generated anything · stock · I2V". It forbids STOCK. It does not
   * mention a verified recording of somebody saying the thing, because
   * Scout is doc 18 and did not exist when that table was written — and
   * this codebase maps both onto one source, `world`, so the beat insert's
   * `kind: "stock"` and a checked Scout quote arrive here indistinguishable.
   *
   * The Manual settles it, and CLAUDE.md says the Manual is the later word
   * on what the product IS: Scout "finds what it's missing — THE PROOF, the
   * other side, the original a clip came from". A find whose quote the
   * deterministic verifier matched word for word against the recording,
   * with the time read off word ids, is not an illustration of the proof.
   * It is the proof. The move's own refusal sentence is the argument —
   * "proof cannot be illustrated; it has to be the thing itself" — and a
   * verified recording is the thing itself.
   *
   * SO THE TEST IS WHAT IT IS, NOT WHERE IT CAME FROM. `kind: "evidence"`
   * AND probative, which stock can never be: the beat insert builds a stock
   * candidate as `kind: "illustration"` with no probative flag, and the
   * probative check above has already refused anything explicitly marked
   * false. Generated is refused before any of this and stays refused —
   * Phase 5's acceptance ("a generated image can never be placed on an
   * EVIDENCE or CLAIM block") is untouched, and tested.
   *
   * docs/handoff/08-PICTURES-AND-VOICE.md carries this change in its table,
   * per the repo rule: when a decision looks wrong, argue it and move the
   * doc in the same breath rather than routing around it.
   */
  const provenVerified = move === "evidence" && c.source === "world" && c.kind === "evidence" && c.probative === true;

  if (!provenVerified && !MOVE_RULES[move].wants.includes(c.source)) {
    return { reason: `${MOVE_RULES[move].refuses} — this is from ${c.source}` };
  }

  return { reason: null };
}

/* ── Choosing ───────────────────────────────────────────────────────────── */

export interface Placed {
  /** Null is a RESULT: hold on the speaker, or a plain card. */
  picture: Candidate | null;
  /** Why this one, or why nothing. The line a person reads. */
  reason: string;
  /** Everything refused, with the reason each was. For the receipt. */
  refused: Array<{ id: string; reason: string }>;
}

/**
 * HOW MUCH A REPRISE COSTS.
 *
 * Doc 08 asks for "a novelty penalty against what's already been shown
 * (deliberate reprise allowed on a TURN)". Enough to lose to any unshown
 * candidate of the same source, not enough to lose to one a whole tier
 * below: showing the same document twice beats inventing a picture.
 */
export const SEEN_PENALTY = 0.15;

/**
 * WHAT BEING THE PROOF IS WORTH, on the one move that is defined by it.
 *
 * Enough to clear the whole gap between `own` and `world` (0.5), so a
 * verified recording or a marked document outranks an unmarked clip of the
 * maker's own on an EVIDENCE line — and no more, so two probative
 * candidates still fall back to invariant 8's order.
 */
export const PROOF_ON_EVIDENCE = 0.6;

/**
 * WHAT GOES ON THIS LINE.
 *
 * Probative first, then the move's own source order, then novelty — doc
 * 08's scoring, in that order, with the refusals applied before any of it
 * so a forbidden candidate can never win on being interesting.
 *
 * "NOTHING TO SHOW" IS A RESULT, not a failure: for a claim or a joke the
 * face is usually the strongest picture, and a product that always found
 * something would be the stock-gavel problem with extra steps.
 */
export function place(
  move: Move,
  candidates: Candidate[],
  seen: ReadonlySet<string> = new Set(),
): Placed {
  const refused: Array<{ id: string; reason: string }> = [];
  const ok: Candidate[] = [];
  for (const c of candidates) {
    const r = allowed(move, c);
    if (r.reason) refused.push({ id: c.id, reason: r.reason });
    else ok.push(c);
  }

  if (!ok.length) {
    return {
      picture: null,
      reason: candidates.length
        ? "nothing here can carry this line — holding on the speaker"
        : "nothing to show — holding on the speaker",
      refused,
    };
  }

  const score = (c: Candidate) => {
    /* A reprise is deliberate on a TURN, which is the one move that means
       "this, again, differently". */
    const old = c.subject && seen.has(c.subject) && move !== "turn" ? SEEN_PENALTY : 0;
    /*
     * ON AN EVIDENCE LINE, BEING THE PROOF BEATS BEING YOURS.
     *
     * The bonus was a flat 0.1, which could never close the 0.2 between own
     * and documents — so a marked document that IS the proof always lost to
     * any clip retrieval happened to return from the maker's own library.
     * Found by driving it: an evidence line about a dated memo was given a
     * clip saying "I don't like who I am here", with the document sitting
     * underneath it marked and ignored.
     *
     * Doc 08's own column for this move is "probative — the proof itself",
     * so this is reading its definition rather than overriding its order.
     * The order still holds everywhere it is a preference; on the one move
     * whose whole job is proof, the thing that is proof wins.
     *
     * Only on EVIDENCE, and only over a candidate that is not probative:
     * two probative candidates fall back to the source order, which is
     * where "own footage → documents" belongs.
     */
    const proof = c.probative ? (move === "evidence" ? PROOF_ON_EVIDENCE : 0.1) : 0;
    return SOURCE_WEIGHT[c.source] + proof - old;
  };

  /* Ties keep the caller's order, which is the order they were found in. */
  const best = ok
    .map((c, i) => ({ c, i, s: score(c) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)[0].c;

  return { picture: best, reason: reasonFor(move, best, seen), refused };
}

/**
 * WHY THIS PICTURE IS HERE, in a sentence.
 *
 * Doc 08's whole premise is that the picture answers that question, so the
 * answer is produced beside the choice rather than reconstructed later by
 * something that no longer knows what the alternatives were.
 */
export function reasonFor(move: Move, c: Candidate, seen: ReadonlySet<string> = new Set()): string {
  const where =
    c.source === "own"
      ? "your own footage"
      : c.source === "documents"
        ? "your documents"
        : c.source === "world"
          ? "the open world"
          : "generated, and labelled";
  const again = c.subject && seen.has(c.subject) ? (move === "turn" ? ", again, against itself" : ", again") : "";
  return `${MOVE_RULES[move].job} — from ${where}${again}`;
}

/* ── Graphics are code, never pixels ────────────────────────────────────── */

/**
 * THE CHART LINTS, as hard fails.
 *
 * Doc 08 lists them: "non-zero bar baseline, dual axes, area encodings of
 * 1-D data, >7 colour categories, unlabelled units, any datum without
 * provenance." Decision 27 is the same rule from the other end — "bars
 * start at zero; truncated axes mislead even when explained".
 *
 * HARD, NOT ADVISORY. A warning on a chart that misleads is a chart that
 * misleads with a note attached; every one of these blocks the render. The
 * product's claim is that a picture answers "why am I seeing this", and a
 * bar chart starting at 40 answers it wrongly before anybody reads a label.
 *
 * AND PROVENANCE IS ONE OF THEM. Doc 08's evidence-bound chart compiler
 * blocks on "any datum without provenance", which is invariant 4 inside a
 * chart: a number on screen with no receipt is exactly the claim the
 * receipts exist to make impossible.
 */
export type ChartMark = "bar" | "line" | "point" | "area";

export interface Datum {
  value: number;
  /** Where this number came from. Doc, page, cell — or nothing, which fails. */
  provenance?: { doc: string; page?: number; cell?: string } | null;
}

export interface ChartSpec {
  mark: ChartMark;
  /** Where the value axis starts. */
  baseline: number;
  /** True when a second value axis is drawn. */
  dualAxis?: boolean;
  /** What the numbers are, in words. "£", "people", "%". */
  units?: string | null;
  /** One per colour in the key. */
  categories?: string[];
  data: Datum[];
  /** True when the data has one dimension — a count per category. */
  oneDimensional?: boolean;
}

/** How many colours a reader can hold at once. Doc 08's number. */
export const MAX_CATEGORIES = 7;

export interface Lint {
  kind: "baseline" | "dual-axis" | "area-1d" | "colours" | "units" | "provenance";
  /** What a person reads. Never "invalid spec". */
  reason: string;
}

export function lintChart(spec: ChartSpec): Lint[] {
  const out: Lint[] = [];

  /*
   * A BAR IS A LENGTH, and a length from a non-zero baseline is a lie
   * about a ratio. Lines and points encode position rather than magnitude,
   * so they may start anywhere — the lint is about the mark, not about
   * axes in general.
   */
  if (spec.mark === "bar" && spec.baseline !== 0) {
    out.push({
      kind: "baseline",
      reason: `bars start at zero — this one starts at ${spec.baseline}, which makes the differences look bigger than they are`,
    });
  }

  if (spec.dualAxis) {
    out.push({
      kind: "dual-axis",
      reason: "two value axes let any two lines be made to cross wherever you like",
    });
  }

  /* Area encodes two dimensions. Using it for one squares the difference
     a reader sees. */
  if (spec.mark === "area" && spec.oneDimensional) {
    out.push({
      kind: "area-1d",
      reason: "an area encodes two dimensions, so one number drawn as one looks squared",
    });
  }

  if ((spec.categories?.length ?? 0) > MAX_CATEGORIES) {
    out.push({
      kind: "colours",
      reason: `${spec.categories!.length} colours is more than anybody can hold — ${MAX_CATEGORIES} is the ceiling`,
    });
  }

  if (!spec.units?.trim()) {
    out.push({ kind: "units", reason: "the numbers have no unit, so they measure nothing" });
  }

  /*
   * INVARIANT 4 INSIDE A CHART. A number on screen with no receipt is the
   * claim the receipts exist to make impossible — and a chart is the
   * easiest place in a video to put one.
   */
  const unsourced = spec.data.filter((d) => !d.provenance?.doc);
  if (unsourced.length) {
    out.push({
      kind: "provenance",
      reason: `${unsourced.length} of ${spec.data.length} numbers have no source — every one has to say where it came from`,
    });
  }

  return out;
}

/** A chart renders only when nothing failed. */
export const chartIsRenderable = (spec: ChartSpec): boolean => lintChart(spec).length === 0;
