/**
 * Rules, stored and read back.
 *
 * A cut is what a rule set produces (invariant 1), so the rule set is the
 * thing that has to persist. Beats are the outcome and are rewritten every
 * time the rules change; these are the input and are the record.
 *
 * WHY `on_` AND `ord`. `on` and `order` are both SQLite keywords, and a column
 * called `order` turns every query into a quoting puzzle that works until
 * somebody writes one without the quotes. The engine's field names stay
 * `on` and `order`; the translation happens here, once, in two functions
 * nobody has to think about again.
 */

import type { Rule, Order } from "./rules.ts";
import { ulid } from "./id.ts";

interface Row {
  key: string;
  kind: string;
  on_: number;
  text: string | null;
  tag: string | null;
  clip_ids: string | null;
  ord: string | null;
  secs: number | null;
  hand: number;
  wins: number;
}

const ORDERS: Order[] = ["time", "strand", "open"];

/**
 * Writes the rule set, replacing whatever was there.
 *
 * Replace rather than merge, for the same reason putBeats does: the rule set
 * IS the list, in order, and a merge would need a notion of identity across
 * two lists that the pane does not have. The caller holds the list.
 */
export async function saveRules(db: D1Database, projectId: string, rules: Rule[]): Promise<void> {
  await db.prepare(`DELETE FROM rules WHERE project_id=?`).bind(projectId).run();
  if (!rules.length) return;

  const now = Date.now();
  const stmt = db.prepare(
    `INSERT INTO rules (id,project_id,key,idx,kind,on_,text,tag,clip_ids,ord,secs,hand,wins,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  await db.batch(
    rules.map((r, i) =>
      stmt.bind(
        /* The ROW id, re-minted because saving replaces the list. The rule's
           own name is the next column and is what anything else holds. */
        ulid(),
        projectId,
        String(r.id),
        i,
        r.kind,
        r.on ? 1 : 0,
        r.text ?? null,
        r.tag ?? null,
        /* cid and cids are one column: a rule naming one moment and a rule
           naming six differ in length, not in kind. */
        r.cids?.length ? JSON.stringify(r.cids) : r.cid !== undefined ? JSON.stringify([r.cid]) : null,
        r.order ?? null,
        r.secs ?? null,
        r.hand ? 1 : 0,
        r.wins ? 1 : 0,
        now,
      ),
    ),
  );
}

/** Reads the rule set back, in the order it was written. */
export async function loadRules(db: D1Database, projectId: string): Promise<Rule[]> {
  const { results } = await db
    .prepare(
      `SELECT key, kind, on_, text, tag, clip_ids, ord, secs, hand, wins
         FROM rules WHERE project_id=? ORDER BY idx`,
    )
    .bind(projectId)
    .all<Row>();

  return (results ?? []).map((r) => {
    const ids = r.clip_ids ? (JSON.parse(r.clip_ids) as Array<string | number>) : null;
    const rule: Rule = {
      /* Its own name, not the row's — see the `key` column's comment. */
      id: r.key,
      kind: r.kind as Rule["kind"],
      on: !!r.on_,
    };
    if (r.text) rule.text = r.text;
    if (r.tag) rule.tag = r.tag;
    /* One id comes back as `cid`, several as `cids`, because that is what the
       engine's matcher reads and a one-element array would make every
       single-moment rule take the slower path for no reason. */
    if (ids?.length === 1) rule.cid = ids[0];
    else if (ids?.length) rule.cids = ids;
    /* A stored order that is not one of the three is dropped rather than
       passed through: compute() would fall back to chronological silently,
       and a cut built in an order nobody chose is worse than an error. */
    if (r.ord && ORDERS.includes(r.ord as Order)) rule.order = r.ord as Order;
    if (r.secs !== null) rule.secs = r.secs;
    if (r.hand) rule.hand = true;
    if (r.wins) rule.wins = true;
    return rule;
  });
}
