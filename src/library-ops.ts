/**
 * Rename, delete, restore.
 *
 * The basic verbs every platform has, and this one had none of them. Projects
 * rendered "Branch a version" and "Archive" as <span> elements — not buttons,
 * not wired, decoration in the shape of controls — and there was no way at all
 * to rename an edit or to get rid of one. So four accidental edits of the same
 * video sat there permanently with nothing the owner could do about them.
 *
 * NOTHING IS DESTROYED. A delete sets deleted_at and writes a trash row
 * carrying enough to undo it, which is the same discipline the rest of this
 * codebase already follows — a dropped clip renders struck rather than
 * vanishing, a render is a new row rather than an overwrite. The R2 bytes are
 * deliberately left alone: deleting a video should be instant and reversible,
 * and freeing storage is a separate decision made from Settings.
 */

import { ulid } from "./id.ts";

export type Entity = "project" | "source";

export interface TrashRow {
  id: string;
  user_id: string;
  entity: Entity;
  entity_id: string;
  label: string;
  payload: string;
  deleted_at: number;
}

const TABLE: Record<Entity, string> = { project: "v2_projects", source: "sources" };

/** Trims and bounds a name. Empty is not a name, so it is refused upstream. */
export function cleanTitle(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, 120);
}

/**
 * Renames one thing the user owns.
 *
 * The user_id in the WHERE clause is the authorization: a project id belonging
 * to somebody else simply matches no row, so there is no separate check to
 * forget.
 */
export async function rename(
  db: D1Database,
  entity: Entity,
  id: string,
  userId: string,
  title: string,
): Promise<boolean> {
  const res = await db
    .prepare(`UPDATE ${TABLE[entity]} SET title=? WHERE id=? AND user_id=? AND deleted_at IS NULL`)
    .bind(title, id, userId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

/**
 * Soft-deletes, and records enough to put it back.
 *
 * Deleting a SOURCE also deletes the edits made from it — an edit whose
 * footage is gone is not something anyone can open, and leaving it would make
 * Footage look tidy while the Editor filled with edits that cannot load. Those
 * edits ride on the same trash row, so undoing the delete brings them back
 * together rather than restoring a video with its edits missing.
 */
export async function softDelete(
  db: D1Database,
  entity: Entity,
  id: string,
  userId: string,
): Promise<{ ok: boolean; label: string }> {
  const row = await db
    .prepare(`SELECT id, title FROM ${TABLE[entity]} WHERE id=? AND user_id=? AND deleted_at IS NULL`)
    .bind(id, userId)
    .first<{ id: string; title: string }>();
  if (!row) return { ok: false, label: "" };

  const now = Date.now();
  const statements = [
    db.prepare(`UPDATE ${TABLE[entity]} SET deleted_at=? WHERE id=? AND user_id=?`).bind(now, id, userId),
  ];

  let alsoProjects: string[] = [];
  if (entity === "source") {
    const { results } = await db
      .prepare(`SELECT id FROM v2_projects WHERE source_id=? AND user_id=? AND deleted_at IS NULL`)
      .bind(id, userId)
      .all<{ id: string }>();
    alsoProjects = (results ?? []).map((r) => r.id);
    for (const pid of alsoProjects) {
      statements.push(
        db.prepare(`UPDATE v2_projects SET deleted_at=? WHERE id=? AND user_id=?`).bind(now, pid, userId),
      );
    }
  }

  statements.push(
    db
      .prepare(
        `INSERT INTO trash (id,user_id,entity,entity_id,label,payload,deleted_at) VALUES (?,?,?,?,?,?,?)`,
      )
      .bind(ulid(), userId, entity, id, row.title, JSON.stringify({ projects: alsoProjects }), now),
  );

  await db.batch(statements);
  return { ok: true, label: row.title };
}

/**
 * Puts it back.
 *
 * Keyed on the entity rather than on a trash id, so "undo" from a toast needs
 * only what the toast already knows. Restoring something that was never
 * deleted is a no-op rather than an error — the gesture is idempotent, which
 * matters when the undo button is a click away from being pressed twice.
 */
export async function restore(
  db: D1Database,
  entity: Entity,
  id: string,
  userId: string,
): Promise<boolean> {
  const bin = await db
    .prepare(
      `SELECT * FROM trash WHERE user_id=? AND entity=? AND entity_id=? ORDER BY deleted_at DESC LIMIT 1`,
    )
    .bind(userId, entity, id)
    .first<TrashRow>();

  const statements = [
    db.prepare(`UPDATE ${TABLE[entity]} SET deleted_at=NULL WHERE id=? AND user_id=?`).bind(id, userId),
  ];

  if (bin) {
    let payload: { projects?: string[] } = {};
    try {
      payload = JSON.parse(bin.payload) as { projects?: string[] };
    } catch {
      /* A malformed payload must not block putting the main thing back. */
    }
    for (const pid of payload.projects ?? []) {
      statements.push(
        db.prepare(`UPDATE v2_projects SET deleted_at=NULL WHERE id=? AND user_id=?`).bind(pid, userId),
      );
    }
    statements.push(db.prepare(`DELETE FROM trash WHERE id=?`).bind(bin.id));
  }

  await db.batch(statements);
  return true;
}

/** What is in the bin, newest first. */
export async function listTrash(db: D1Database, userId: string, limit = 40): Promise<TrashRow[]> {
  const { results } = await db
    .prepare(`SELECT * FROM trash WHERE user_id=? ORDER BY deleted_at DESC LIMIT ?`)
    .bind(userId, limit)
    .all<TrashRow>();
  return results ?? [];
}
