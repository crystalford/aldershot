/**
 * WHAT YOUR LIBRARY CAN BACK, standing.
 *
 * `21-LIBRARIAN-BUILD-SPEC.md` §7. The Librarian's three questions are what
 * have I got, what is it about, and what can it back — and the third is the
 * only honest version of the thing this product promises. "It gets better the
 * more you put in it" is a claim about an accumulating pool, and a library
 * that cannot say what it can now argue cannot demonstrate it.
 *
 * STANDING, NOT PER-REQUEST. Scout runs when asked and reports once. This is a
 * property of the account that is true between sessions, which is what makes
 * it a reward rather than an answer: the row moves when you capture.
 *
 * NO MODEL CALL, AND NO RETRIEVAL. Every number here was already written down
 * by the one stop: `plan_beats.found` is the clip ids retrieval turned up and
 * `plan_beats.backed` is how many of them the judge said back it. Re-running
 * retrieval per beat on a page load would be an embedding call per beat to
 * produce a second opinion that disagreed with the plan page — two reporters
 * on one fact, which is the drift scripts/capabilities.cjs exists to prevent,
 * one layer up.
 *
 * WHAT IS GENUINELY RE-CHECKED is survival. A beat's `found` is a snapshot,
 * and the moments in it can be cut or deleted afterwards — so the ids are
 * resolved against live moments every time. A claim whose support has since
 * been deleted reads as a gap, which is true, and is the one way a stored
 * snapshot silently stops being an answer.
 *
 * "NOBODY CHECKED" IS NOT "NOTHING BACKS IT". src/plan.ts already keeps that
 * distinction — `backed === null` against `backed === 0` — and it is the same
 * rule the judge follows and `/api/ask` refuses to blur. A report that
 * collapsed them would tell somebody they have nothing when the truth is that
 * nobody has looked.
 */

import { THIN_BELOW } from "./plan.ts";

/** Gaps first, the way Scout's board orders itself. */
export const STANDINGS = ["nothing", "thin", "unchecked", "backed"] as const;
export type Standing = (typeof STANDINGS)[number];

/** The order rows come back in. Index into STANDINGS. */
const RANK: Record<Standing, number> = { nothing: 0, thin: 1, unchecked: 2, backed: 3 };

export interface StandingRow {
  planId: string;
  /** The claim the beat is part of arguing. Null on a plan with no claim yet. */
  claim: string | null;
  beatId: string;
  /** The beat, in a few words. */
  name: string;
  /** What it wants from the footage — and the query retrieval ran. */
  need: string;
  role: string;
  /** Whose sentence it is. A person's beat is a decision, not a suggestion. */
  byUser: boolean;
  standing: Standing;
  /**
   * The moments under it that still exist.
   *
   * Invariant 4, as this engine's deterministic check: no aggregate without
   * its members. Every band on the board expands to these, and a band that
   * cannot be expanded is not shippable.
   */
  moments: string[];
  /** How many of them back it, as the judge found. Null when nobody checked. */
  backed: number | null;
}

/**
 * Decides one beat's standing.
 *
 * Exported because it is the whole judgement and it should be testable
 * without a database.
 */
export function standingOf(opts: { backed: number | null; surviving: number }): Standing {
  /*
   * NOBODY LOOKED COMES FIRST, and getting this order wrong was the bug.
   *
   * The survival check was first, which is wrong for the commonest case in
   * the product: a plan before the one stop has no `found` and no `backed` at
   * all, so nothing survives because nothing was ever looked for. Every unit
   * test passed and the live fixture read "3 sections across your plans: 3 it
   * has nothing for" about a plan nobody had run a search on — which is the
   * exact distinction this file exists to keep, inverted, in the one state
   * every plan passes through.
   *
   * null means no search has run. It cannot mean "nothing backs it", because
   * nothing has been asked.
   */
  if (opts.backed === null) return "unchecked";
  /* Checked, and what it was checked about is gone — deleted or cut since.
     True whatever the judge said at the time. */
  if (opts.surviving === 0) return "nothing";
  if (opts.backed === 0) return "nothing";
  return opts.backed < THIN_BELOW ? "thin" : "backed";
}

interface BeatRow {
  plan_id: string;
  claim: string | null;
  id: string;
  name: string;
  need: string;
  role: string;
  kept: number;
  found: string | null;
  backed: number | null;
  by_user: number | null;
}

/**
 * Every claim this account has made, and whether its footage backs it.
 *
 * Cut beats are left out: the person said no to them, and a worklist that
 * keeps offering what you already declined is a worklist you stop reading.
 */
export async function standingFor(db: D1Database, userId: string): Promise<StandingRow[]> {
  const { results } = await db
    .prepare(
      `SELECT p.id AS plan_id, p.claim AS claim,
              b.id, b.name, b.need, b.role, b.kept, b.found, b.backed, b.by_user
         FROM plan_beats b
         JOIN plans p ON p.id = b.plan_id
        WHERE p.user_id = ? AND b.kept = 1
        ORDER BY p.created_at DESC, b.idx`,
    )
    .bind(userId)
    .all<BeatRow>();

  const rows = results ?? [];
  if (!rows.length) return [];

  /*
   * Which of the found moments are still there, in one query rather than one
   * per beat. A library of twenty plans is sixty beats, and sixty round trips
   * to answer a page load is the kind of thing that only shows up in
   * production.
   */
  const wanted = new Set<string>();
  const foundPer = new Map<string, string[]>();
  for (const b of rows) {
    let ids: string[] = [];
    try {
      const parsed = JSON.parse(b.found ?? "[]");
      if (Array.isArray(parsed)) ids = parsed.map(String);
    } catch {
      /* A malformed column is no moments rather than a thrown page. The same
         rule src/blocks.ts follows for a stored order it cannot read. */
    }
    foundPer.set(b.id, ids);
    for (const id of ids) wanted.add(id);
  }

  const live = new Set<string>();
  if (wanted.size) {
    const ids = [...wanted];
    const holes = ids.map(() => "?").join(",");
    const { results: alive } = await db
      .prepare(
        `SELECT id FROM v2_clips
          WHERE user_id = ? AND deleted_at IS NULL AND kept = 1 AND id IN (${holes})`,
      )
      .bind(userId, ...ids)
      .all<{ id: string }>();
    for (const r of alive ?? []) live.add(r.id);
  }

  const out: StandingRow[] = rows.map((b) => {
    const moments = (foundPer.get(b.id) ?? []).filter((id) => live.has(id));
    return {
      planId: b.plan_id,
      claim: b.claim,
      beatId: b.id,
      name: b.name,
      need: b.need,
      role: b.role,
      byUser: Boolean(b.by_user),
      standing: standingOf({ backed: b.backed, surviving: moments.length }),
      moments,
      backed: b.backed,
    };
  });

  /* Gaps first, then the order the plans put them in — which is the argument,
     so within a standing it is the order worth keeping. */
  return out.sort((a, b) => RANK[a.standing] - RANK[b.standing]);
}

/**
 * The sentence above the library.
 *
 * Counts of things, never a score and never a percentage (invariant 3). The
 * product already says "N clips · N edits"; what it has never said is which
 * of your arguments your footage can carry.
 *
 * Written as the thing to do next rather than as a report card: a claim with
 * nothing behind it is the next thing to film, and that is the whole point of
 * showing it.
 */
export function standingLine(rows: StandingRow[]): string {
  if (!rows.length) return "Nothing claimed yet — a plan is where a claim comes from.";

  const n = (s: Standing) => rows.filter((r) => r.standing === s).length;
  const nothing = n("nothing");
  const thin = n("thin");
  const unchecked = n("unchecked");
  const backed = n("backed");

  const parts: string[] = [];
  if (backed) parts.push(`${backed} your footage backs`);
  if (thin) parts.push(`${thin} it barely backs`);
  if (nothing) parts.push(`${nothing} it has nothing for`);
  if (unchecked) parts.push(`${unchecked} nobody has checked`);

  const list =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `${rows.length} ${rows.length === 1 ? "section" : "sections"} across your plans: ${list}.`;
}
