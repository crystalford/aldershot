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
    model?: string;
    tokensIn?: number;
    tokensOut?: number;
  },
): Promise<number> {
  const n = await nextPassNumber(db, p.projectId, p.sourceId);
  await db
    .prepare(
      `INSERT INTO passes (id,project_id,source_id,n,instruction,result,model,tokens_in,tokens_out,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      ulid(),
      p.projectId,
      p.sourceId,
      n,
      p.instruction,
      p.result,
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
    .prepare(
      `SELECT id, n, instruction, result, created_at FROM passes
        WHERE project_id=? ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(projectId, limit)
    .all<PassRow>();
  return (res.results ?? []).reverse();
}
