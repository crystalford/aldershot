/**
 * HOW MUCH IT DECIDES — the composer's dial.
 *
 * The prototype's composer is three things: the text, the dial and the mic.
 * The build had the text. src/ui/pages/home.ts has said so in a comment since
 * the room was built — "Not in the prototype, whose composer is the text, the
 * dial and the mic" — which is a note about a missing control sitting next to
 * the control that replaced it.
 *
 * ── The three, in the prototype's own words ───────────────────────────────
 *   Ask       — it proposes each rule and waits for Add
 *   Recommend — it adds the rule and tells you, with Undo
 *   Auto      — it adds the rule and reports
 *
 * RECOMMEND IS WHAT THE BUILD ALREADY DOES. A sentence on an assembled cut
 * becomes a rule, the cut is recomputed, and the turn carries Undo. So the
 * dial is not three new behaviours; it is one new behaviour (Ask) either
 * side of the one that exists, and a stored preference saying which.
 *
 * ── Why Ask is the interesting one ────────────────────────────────────────
 * Invariant 1: a cut is re-produced from rules, never stored as an outcome.
 * That makes a proposal cheap and honest — "what would this rule do" is the
 * same arithmetic as "do it", run against a rule set that is not saved. The
 * proposal can therefore show the real consequence rather than a description
 * of one, which is the difference between asking and warning.
 */

export const ASK_MODES = ["ask", "rec", "auto"] as const;
export type AskMode = (typeof ASK_MODES)[number];

/**
 * Recommend, as in the prototype (`askMode: "rec"`).
 *
 * The middle setting is the default for the reason it is the middle one: it
 * acts, which is what somebody who typed a sentence wanted, and it says what
 * it did with a way back, which is what somebody who typed the wrong one
 * needs. Ask is for an edit you are nervous about; Auto is for one you are
 * not watching.
 */
export const DEFAULT_MODE: AskMode = "rec";

export const isAskMode = (v: unknown): v is AskMode =>
  typeof v === "string" && (ASK_MODES as readonly string[]).includes(v);

/** Anything unrecognised, or nothing stored, is the default rather than a throw. */
export const modeOf = (stored: string | null | undefined): AskMode =>
  isAskMode(stored) ? stored : DEFAULT_MODE;

/** The word on the dial. */
export const MODE_LABEL: Record<AskMode, string> = {
  ask: "Ask",
  rec: "Recommend",
  auto: "Auto",
};

/** What each one does, verbatim from the prototype's own title attribute. */
export const MODE_DOES: Record<AskMode, string> = {
  ask: "Ask: it proposes each rule and waits for Add",
  rec: "Recommend: it adds the rule and tells you, with Undo",
  auto: "Auto: it adds the rule and reports",
};

/** The whole hover line, assembled as the prototype assembles it. */
export const modeHint = (m: AskMode): string =>
  `How much it decides — ${MODE_DOES[m]} · click to change`;

/**
 * Ask → Recommend → Auto → Ask.
 *
 * Least to most, so pressing it repeatedly hands over more each time and
 * then starts again — the same shape as the Scout pill, and the opposite
 * direction, because that one is giving something up and this one is
 * handing something over.
 */
export const nextMode = (m: AskMode): AskMode =>
  m === "ask" ? "rec" : m === "rec" ? "auto" : "ask";

/** Whether this mode applies the rule itself. Only Ask does not. */
export const applies = (m: AskMode): boolean => m !== "ask";

/**
 * Whether it draws attention to what it did.
 *
 * The one difference between Recommend and Auto. Both apply; Recommend says
 * so with the way back attached, Auto writes it into the record and leaves
 * you alone. Undo exists either way — every pass is recorded and reversible,
 * and a mode that could turn that off would be a mode that breaks invariant
 * 1 rather than a preference.
 */
export const announces = (m: AskMode): boolean => m === "rec";

export async function readMode(db: D1Database, userId: string): Promise<AskMode> {
  try {
    const r = await db
      .prepare("SELECT ask_mode FROM v2_users WHERE id = ?")
      .bind(userId)
      .first<{ ask_mode: string | null }>();
    return modeOf(r?.ask_mode);
  } catch {
    /* A read failure is the default, not a refusal — the same rule the spend
       cap, the breaker and the Scout pill follow. */
    return DEFAULT_MODE;
  }
}

export async function writeMode(db: D1Database, userId: string, mode: AskMode): Promise<void> {
  await db.prepare("UPDATE v2_users SET ask_mode = ? WHERE id = ?").bind(mode, userId).run();
}

/**
 * The same guard the Scout pill uses, and for the same reason.
 *
 * `sent` is the mode the dial was SHOWING. The next one is computed from
 * what is stored, so a client cannot name its own destination; and if the
 * two disagree, something else moved it and the answer is the truth rather
 * than a second step on top of one the presser never saw.
 */
export function resolvePress(
  stored: AskMode,
  sent: string | undefined,
): { mode: AskMode; stale: boolean } {
  if (sent !== undefined && sent !== stored) return { mode: stored, stale: true };
  return { mode: nextMode(stored), stale: false };
}
