/**
 * WHAT THIS PRODUCT REFUSES TO DO, AND WHAT STOPS IT.
 *
 * Every editor can list what it does. The list is the same list, and it is
 * getting shorter as a model with ffmpeg does more of it for nothing. What
 * nobody publishes is the other half: the things a tool will not do however
 * nicely it is asked, and the specific machinery that makes that true rather
 * than aspirational.
 *
 * So this is a public document, read by machines, saying what Aldershot
 * refuses and naming the invariant behind each refusal.
 *
 * THE DANGER IS OBVIOUS and it is the reason for the `anchor` field. A list of
 * refusals nobody checks is marketing, and marketing in a file called
 * "refusals" is worse than silence — it is the product claiming a spine it
 * does not have. So each one names a place in this repository where the
 * refusal is ENFORCED: a check that fails the build, or a test that fails the
 * suite. scripts/check-fidelity.cjs's `refusals` rule reads every anchor and
 * goes red if one is missing, with comments stripped from the haystack,
 * because a note describing a rule is not the rule. That is not a theoretical
 * precaution: the `claims` rule passed on its first run because a comment
 * explaining that a feature did NOT exist vouched for its existence.
 *
 * WHAT IS NOT HERE IS DELIBERATE, and the method for deciding has been wrong
 * once already.
 *
 * A refusal earns a line only once something enforces it. The first version of
 * this file worked that out by searching the code for the INVARIANT NUMBER,
 * which finds what names an invariant rather than what enforces one — so it
 * reported invariants 4, 5 and 8 as unenforced when in fact:
 *
 *   4  src/ask.ts refuses to present unbacked material as an answer, with two
 *      acceptance tests on it.
 *   8  hasNoRaster is asserted on the live render path, in the gate, and in
 *      tests with negative cases. Three enforcements, naming the invariant in
 *      none of them.
 *   5  genuinely was not enforced, and the search for it found a hole rather
 *      than a gap in the paperwork: the retry route could re-read and re-charge
 *      a video that had already been read. That is now src/jobs.ts's
 *      reReadRefusedBecause.
 *
 * Invariant 10 was correctly reported, which is the only reason the method
 * survived long enough to be wrong about three. Judge by enforcement, never by
 * citation.
 */

export interface Refusal {
  /** Stable, so a reader can refer to one. */
  id: string;
  /** What is refused, in a sentence somebody would say. */
  says: string;
  /** Which of the ten invariants in CLAUDE.md this is. */
  invariant: number;
  /** How it is stopped, without naming a path — the paths are internal. */
  enforced: string;
  /**
   * Where it is stopped, which is internal and never published.
   *
   * `find` must appear in `file` with comments stripped: an enforcement's own
   * failure message, or the name of a test. Both of those are code that runs.
   * A comment saying the rule exists is exactly what this must not accept.
   */
  anchor: { file: string; find: string };
}

export const REFUSALS: Refusal[] = [
  {
    id: "no-stored-cut",
    says:
      "A cut is never stored as a finished thing. It is worked out again from the rules and the " +
      "moments every time it is asked for, so switching a rule off can never leave a leftover behind.",
    invariant: 1,
    enforced: "a test that asks for a cut back from its rules alone and fails if anything is missing",
    anchor: { file: "test/scout-mission.test.ts", find: "invariant 1: a cut comes back from its rules" },
  },
  {
    id: "no-model-timecode",
    says:
      "A model never decides where a cut lands. It says what the video should do; a deterministic " +
      "solver works out the times, and nothing a model returns can move one.",
    invariant: 2,
    enforced: "an acceptance test that feeds model output through the product and checks no timestamp moved",
    anchor: { file: "test/ask.test.ts", find: "ACCEPTANCE: nothing the model returns can move a timestamp" },
  },
  {
    id: "no-scores",
    says:
      "No score or percentage is ever shown to a person. Strong, Worth a look or Long shot, each with " +
      "the line that caused it — a number invites an argument with the number instead of with the reason.",
    invariant: 3,
    enforced: "a build check that fails on a score interpolated into any markup in this product",
    anchor: {
      file: "scripts/check-fidelity.cjs",
      find: "puts a score on screen — invariant 3 wants Strong / Worth a look / Long shot",
    },
  },
  {
    id: "nothing-deleted",
    /* "Deleting is reversible" was the first wording, and the gate rejected
       it: that is a feature, said from the product's side. The refusal is
       that nothing goes without being asked twice. */
    says:
      "Nothing is destroyed because you pressed delete. A video and the edits made from it go to the " +
      "bin together and come back together, and nothing leaves for good without a second, explicit act.",
    invariant: 6,
    enforced: "a test that deletes a video, restores it, and fails unless its edits came back with it",
    anchor: {
      file: "test/library-ops.test.ts",
      find: "deleting a video takes its edits and restore brings them back together",
    },
  },
  {
    id: "unbacked-is-an-answer",
    says:
      "A question with nothing behind it is answered with nothing, not with the nearest thing to " +
      "hand. \"Nothing backs this\" is a result this product can reach and will say.",
    invariant: 4,
    enforced: "an acceptance test that a near miss is never returned as an answer",
    anchor: { file: "test/ask.test.ts", find: "ACCEPTANCE: a near miss is never an answer" },
  },
  {
    id: "read-once",
    says:
      "Your footage is read once and charged once. Editing it afterwards costs nothing, and nothing " +
      "re-reads a video you have already paid to have read.",
    invariant: 5,
    enforced: "a guard on the only route that can start a second read, with a test for each way of asking twice",
    anchor: { file: "src/jobs.ts", find: "a read is already running" },
  },
  {
    id: "no-photoreal",
    says:
      "A generated picture is never a photograph of anything. Graphics here are drawn as code and " +
      "carry a label saying so, and a raster cannot reach one — the export checks on the way out.",
    invariant: 8,
    enforced: "an assertion on the live path that no raster, data URI or linked image is inside a generated picture",
    /*
     * THE CALL, NOT THE DEFINITION.
     *
     * This first pointed at `export function hasNoRaster` in src/graphics.ts,
     * which proves the check was WRITTEN, not that anything runs it — and that
     * function's own comment says "exported so the render path CAN assert it".
     * An anchor on a definition is the same weak evidence as an anchor on a
     * comment. This is the message the live route logs when it refuses.
     */
    anchor: { file: "src/index.ts", find: "[graphic] a raster reached a generated picture" },
  },
  {
    id: "no-silent-failure",
    says:
      "A job that finished with a piece of it broken is reported as broken, not as finished. Partial " +
      "failure that says nothing is treated here as the most serious kind of fault.",
    invariant: 7,
    enforced: "a reading on this product's own dashboard counting items that failed inside jobs which reported success",
    anchor: { file: "src/slo.ts", find: "failed inside a job that reported finishing — invariant 7 says" },
  },
  {
    id: "no-genre-word",
    says:
      "No writer here is told what genre to write. Ask for a documentary and you get a video about " +
      "your subject: the word is kept as a format setting and never reaches the model that drafts, " +
      "because a genre word is a costume and a model handed one performs it instead of thinking.",
    invariant: 10,
    enforced: "a build check that fails on a genre name in any prompt sent to the drafting model",
    anchor: { file: "scripts/check-fidelity.cjs", find: "invariant 10, and decision 15:" },
  },
  {
    id: "no-downloading",
    says:
      "Nothing here downloads audiovisual content from a platform whose terms forbid it. Clips found " +
      "elsewhere are linked and quoted, never fetched and never stored.",
    invariant: 9,
    enforced: "a build check that fails on any fetch of platform media anywhere in the source",
    anchor: {
      file: "scripts/check-fidelity.cjs",
      find: "fetches audiovisual content from a platform that forbids it (invariant 9)",
    },
  },
];

/**
 * The document itself.
 *
 * `anchor` is left out on purpose: it names files inside a private repository,
 * which tells a reader nothing and discloses structure for no gain. What is
 * published is the refusal and the SHAPE of what enforces it, which is the
 * part a reader can weigh.
 */
export function refusalsDocument(origin: string): unknown {
  return {
    product: "Aldershot",
    what:
      "A video editor that builds a cut from rules you can see and switch off, and keeps a receipt " +
      "for every claim the cut makes.",
    refuses: REFUSALS.map((r) => ({
      id: r.id,
      says: r.says,
      invariant: r.invariant,
      enforced: r.enforced,
    })),
    /*
     * The one thing a machine can actually go and read. Everything else here
     * is a statement about behaviour; this is a format it can fetch.
     */
    receipts: {
      what:
        "A cut whose maker has published it has a receipts page listing every clip in it that came " +
        "from somebody else: the words, the link to the original, and whether the quote was checked " +
        "against it. The same receipt is served as data at the same address with .json on the end. " +
        "The maker can revoke it, after which both are gone.",
      page: `${origin}/r/<token>`,
      data: `${origin}/r/<token>.json`,
    },
  };
}
