/**
 * WHETHER SCOUT MAY GO OUTSIDE — the front door's own question.
 *
 * The prototype puts a Scout row in the MAKE column with a pill reading On,
 * Per project or Off, and a line that changes with it. The build had Scout
 * only inside a project, which meant the one place the preference could be
 * set was a place you reached by having already decided — and the Manual
 * puts him in the second paragraph of what the product is: "Scout is how the
 * video gets better than your footage alone."
 *
 * THE DEFAULT IS THE CAUTIOUS ONE. `ask` — per project — because going
 * outside somebody's own footage is a thing they opt into each time rather
 * than a setting they later discover has been on. Invariant 9 is the hard
 * limit (Scout links, never downloads); this is the softer one, which is
 * whether he looks at all.
 */

export const OUTSIDE_PREFS = ["always", "ask", "never"] as const;
export type OutsidePref = (typeof OUTSIDE_PREFS)[number];

export const DEFAULT_PREF: OutsidePref = "ask";

export const isOutsidePref = (v: unknown): v is OutsidePref =>
  typeof v === "string" && (OUTSIDE_PREFS as readonly string[]).includes(v);

/** Null, or anything unrecognised, is the cautious default rather than a throw. */
export const prefOf = (stored: string | null | undefined): OutsidePref =>
  isOutsidePref(stored) ? stored : DEFAULT_PREF;

/** The pill, in the prototype's own words. */
export const PILL: Record<OutsidePref, string> = {
  always: "On",
  ask: "Per project",
  never: "Off",
};

/**
 * The line under "Scout makes it better", which is the prototype's verbatim.
 *
 * It changes with the preference because the row has to say what is actually
 * true right now — a line reading "bring him into a project" under a pill
 * reading Off would be the interface disagreeing with itself.
 */
export const LINE: Record<OutsidePref, string> = {
  always: "on for every project — he researches the whole video with you",
  ask: "bring him into a project to research the whole video with you",
  never: "off — your footage only",
};

/**
 * What pressing the pill does: On → Per project → Off → On.
 *
 * A cycle rather than a menu, because there are three states and a menu for
 * three things is a menu nobody opens. The order runs from most to least,
 * so a person turning it down presses once and sees it go down.
 */
export const nextPref = (p: OutsidePref): OutsidePref =>
  p === "always" ? "ask" : p === "ask" ? "never" : "always";

export async function readPref(db: D1Database, userId: string): Promise<OutsidePref> {
  try {
    const r = await db
      .prepare("SELECT outside_pref FROM v2_users WHERE id = ?")
      .bind(userId)
      .first<{ outside_pref: string | null }>();
    return prefOf(r?.outside_pref);
  } catch {
    /* A read failure is the default, not a refusal — the same rule as the
       spend cap and the breaker. */
    return DEFAULT_PREF;
  }
}

export async function writePref(db: D1Database, userId: string, pref: OutsidePref): Promise<void> {
  await db.prepare("UPDATE v2_users SET outside_pref = ? WHERE id = ?").bind(pref, userId).run();
}

/**
 * WHAT A PRESS OF THE PILL MEANS — the whole decision, out of the route.
 *
 * `sent` is the state the pill was SHOWING, never the state it wants. A body
 * that named its own destination would let a client switch Scout on by
 * asking, and this is the one control whose "on" should only ever be
 * reachable by a person pressing it. So the next state is computed here from
 * what is stored, and `sent` is a guard: if the two disagree, something else
 * already moved it (a second tab, the other half of a double press), and the
 * answer is the stored value rather than a second step on top of a step the
 * presser never saw.
 */
export function resolvePress(
  stored: OutsidePref,
  sent: string | undefined,
): { pref: OutsidePref; stale: boolean } {
  if (sent !== undefined && sent !== stored) return { pref: stored, stale: true };
  return { pref: nextPref(stored), stale: false };
}
