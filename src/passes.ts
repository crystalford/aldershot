/**
 * The passes log — every instruction the user gave the model, and what it did.
 *
 * The table has always been there, and its own comment says what it is for:
 * "every LLM instruction the user gave, and what it did. Shown as the Passes
 * log." runScore has always written a row, including the honest failure ("no
 * matches — try different words"). Nothing ever read it.
 *
 * So you typed "also cut the sponsor read", the page reloaded, a bar filled,
 * and then nothing — a pass that matched nothing looked exactly like one that
 * worked. That is the whole reason this file exists.
 */
import type { D1Database } from "@cloudflare/workers-types";
import { ulid } from "./id.ts";

export interface PassRow {
  id: string;
  n: number;
  instruction: string;
  result: string;
  created_at: number;
  /** Whether this turn can still be taken back — see the `undo` column. */
  undoable: boolean;
}

/**
 * The number this pass gets.
 *
 * runScore hardcoded 1, so an edit you had asked four things of showed four
 * rows all called 1. Counted from what is already logged, per project — and
 * per source for a clips-only pass, which creates no project to belong to.
 */
export async function nextPassNumber(
  db: D1Database,
  projectId: string | null,
  sourceId: string | null,
): Promise<number> {
  const row = projectId
    ? await db.prepare(`SELECT MAX(n) AS n FROM passes WHERE project_id=?`).bind(projectId).first<{ n: number | null }>()
    : await db
        .prepare(`SELECT MAX(n) AS n FROM passes WHERE project_id IS NULL AND source_id=?`)
        .bind(sourceId)
        .first<{ n: number | null }>();
  return (row?.n ?? 0) + 1;
}

/** One instruction and its outcome, recorded. */
export async function recordPass(
  db: D1Database,
  p: {
    projectId: string | null;
    sourceId: string | null;
    instruction: string;
    result: string;
    /*
     * The cut as it stood BEFORE this pass, so the turn can offer a way back.
     * Same {cuts, order} shape POST /restore takes. Optional: a clips-only
     * pass changes no cut and has nothing to undo.
     */
    undo?: { cuts: string | null; order: string | null } | null;
    model?: string;
    tokensIn?: number;
    tokensOut?: number;
  },
): Promise<number> {
  const n = await nextPassNumber(db, p.projectId, p.sourceId);
  await db
    .prepare(
      `INSERT INTO passes (id,project_id,source_id,n,instruction,result,undo,model,tokens_in,tokens_out,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      ulid(),
      p.projectId,
      p.sourceId,
      n,
      p.instruction,
      p.result,
      p.undo ? JSON.stringify(p.undo) : null,
      p.model ?? null,
      p.tokensIn ?? 0,
      p.tokensOut ?? 0,
      Date.now(),
    )
    .run();
  return n;
}

/**
 * What has been asked of this cut, oldest first.
 *
 * Oldest first because it reads as a history — pass 1 is the brief the edit
 * was made from, and everything after is what you have asked since.
 */
export async function passLog(db: D1Database, projectId: string, limit = 12): Promise<PassRow[]> {
  const res = await db
    /* A turn offers Undo when it kept a snapshot AND has not spent it. Going
       back twice would restore a state from before an edit made in between and
       throw that away without saying so.
       The comment sits ABOVE the prepare call, not inside it, and names no
       code: test/passes.test.ts lifts this SQL out of the file by scanning for
       a prepare call followed immediately by a template string, so anything
       between the two — or any stray template quote in a comment — hands the
       test somebody else's query. */
    .prepare(
      `SELECT id, n, instruction, result, created_at,
              (undo IS NOT NULL AND undone_at IS NULL) AS undoable
         FROM passes
        WHERE project_id=? ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(projectId, limit)
    .all<Omit<PassRow, "undoable"> & { undoable: number }>();
  return (res.results ?? []).reverse().map((r) => ({ ...r, undoable: Boolean(r.undoable) }));
}

/**
 * The snapshot a turn goes back to, claimed so it can only be spent once.
 *
 * Returns null when the pass is not this user's, kept no snapshot, or has
 * already been undone — the caller cannot tell those apart and does not need
 * to: in all three cases there is nothing to restore.
 */
export async function claimPassUndo(
  db: D1Database,
  passId: string,
  projectId: string,
): Promise<{ cuts: string | null; order: string | null } | null> {
  const row = await db
    .prepare(`SELECT undo FROM passes WHERE id=? AND project_id=? AND undone_at IS NULL`)
    .bind(passId, projectId)
    .first<{ undo: string | null }>();
  if (!row?.undo) return null;

  const claimed = await db
    .prepare(`UPDATE passes SET undone_at=? WHERE id=? AND project_id=? AND undone_at IS NULL`)
    .bind(Date.now(), passId, projectId)
    .run();
  /* Lost the race with another tab: it already restored this one. */
  if (!claimed.meta.changes) return null;

  try {
    return JSON.parse(row.undo);
  } catch {
    return null;
  }
}
