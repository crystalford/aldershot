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
import type { Env } from "./env.ts";

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


/**
 * Copies an edit so a different idea can be tried without losing this one.
 *
 * Projects rendered "Branch a version" as a <span> that did nothing, and the
 * need behind it is real: an edit IS the cuts and the beats, and there was no
 * way to try a shorter version, or a vertical one, without destroying the cut
 * you already liked. Every other editing tool has this and calling it
 * "branching" was the only invented part.
 *
 * The COPY carries the cuts and the beats. It does not carry the renders —
 * those belong to the export that produced them, and a copy has produced
 * nothing yet. Clips are not copied either because they hang off the source
 * rather than the project (docs/decisions/clip-ownership.md); both edits read
 * the same library, which is the existing behaviour and not made worse here.
 */
export async function duplicateProject(
  db: D1Database,
  id: string,
  userId: string,
): Promise<{ id: string; title: string } | null> {
  const src = await db
    .prepare(`SELECT * FROM v2_projects WHERE id=? AND user_id=? AND deleted_at IS NULL`)
    .bind(id, userId)
    .first<Record<string, unknown>>();
  if (!src) return null;

  const newId = ulid();
  const now = Date.now();
  /* "a supercut" becomes "a supercut (copy)", and a copy of a copy does not
     become "(copy) (copy)" — it counts, which is what people expect. */
  const base = String(src.title ?? "Untitled");
  const m = /^(.*?) \(copy(?: (\d+))?\)$/.exec(base);
  const title = m ? `${m[1]} (copy ${m[2] ? Number(m[2]) + 1 : 2})` : `${base} (copy)`;

  await db
    .prepare(
      `INSERT INTO v2_projects
         (id,user_id,title,kind,source_id,brief,has_acts,runtime_s,pct,next_action,poster_r2_key,cuts,archived_at,created_at,updated_at,deleted_at)
       SELECT ?,user_id,?,kind,source_id,brief,has_acts,runtime_s,pct,next_action,poster_r2_key,cuts,NULL,?,?,NULL
         FROM v2_projects WHERE id=? AND user_id=?`,
    )
    .bind(newId, title, now, now, id, userId)
    .run();

  /* Beats too, or a copy of an assembled piece arrives empty. New ids, same
     order and content. */
  const { results } = await db
    .prepare(`SELECT * FROM beats WHERE project_id=? ORDER BY idx`)
    .bind(id)
    .all<Record<string, unknown>>();

  const beats = results ?? [];
  if (beats.length) {
    await db.batch(
      beats.map((b) =>
        db
          .prepare(
            `INSERT INTO beats (id,project_id,idx,kind,act,clip_id,text,struck,dur_ms,media_r2_key,recorded_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            ulid(), newId, b.idx, b.kind, b.act, b.clip_id, b.text, b.struck,
            b.dur_ms, b.media_r2_key, b.recorded_at,
          ),
      ),
    );
  }

  return { id: newId, title };
}

/**
 * Empties one thing out of the bin for good, and frees what it was holding.
 *
 * A soft delete deliberately leaves the R2 bytes alone so undo is instant.
 * That is right for a delete and wrong forever: nothing in this product has
 * ever removed a byte from R2, so storage only ever grew, which is the
 * biggest open cost hole (docs/decisions/cost-and-scale.md). This is where
 * that gets closed — from the deleted pile, on purpose, by someone who has
 * already deleted the thing once.
 *
 * The R2 deletes come FIRST and their failures are swallowed. A missing
 * object must not block emptying the bin, or a half-uploaded source becomes
 * permanently unremovable — and the row is the thing that makes it visible.
 */
export async function purge(
  env: Env,
  entity: Entity,
  id: string,
  userId: string,
): Promise<{ ok: boolean; freedBytes: number }> {
  const db = env.DB;

  const row = await db
    .prepare(`SELECT id FROM ${TABLE[entity]} WHERE id=? AND user_id=? AND deleted_at IS NOT NULL`)
    .bind(id, userId)
    .first<{ id: string }>();
  /* Only something already in the bin can be purged. Purging a live row would
     turn a stray request into data loss with no undo behind it. */
  if (!row) return { ok: false, freedBytes: 0 };

  const keys: string[] = [];
  if (entity === "source") {
    const src = await db
      .prepare(`SELECT r2_key, poster_r2_key FROM sources WHERE id=?`)
      .bind(id)
      .first<{ r2_key: string | null; poster_r2_key: string | null }>();
    if (src?.r2_key) keys.push(src.r2_key, `${src.r2_key.replace(/\.[a-z0-9]+$/i, "")}.audio.mp3`);
    if (src?.poster_r2_key) keys.push(src.poster_r2_key);
  }

  const { results: renders } = await db
    .prepare(
      entity === "source"
        ? `SELECT r.r2_key FROM renders r JOIN v2_projects p ON p.id=r.project_id
            WHERE p.source_id=? AND r.r2_key IS NOT NULL`
        : `SELECT r2_key FROM renders WHERE project_id=? AND r2_key IS NOT NULL`,
    )
    .bind(id)
    .all<{ r2_key: string }>();
  for (const r of renders ?? []) keys.push(r.r2_key);

  let freedBytes = 0;
  for (const key of keys) {
    try {
      const head = await env.MEDIA.head(key);
      if (head) freedBytes += head.size;
      await env.MEDIA.delete(key);
    } catch {
      /* Already gone, or never landed. Either way it is not holding storage
         and it must not stop the row being removed. */
    }
  }

  await db.batch([
    db.prepare(`DELETE FROM ${TABLE[entity]} WHERE id=? AND user_id=?`).bind(id, userId),
    db.prepare(`DELETE FROM trash WHERE user_id=? AND entity=? AND entity_id=?`).bind(userId, entity, id),
  ]);

  return { ok: true, freedBytes };
}


/**
 * Closes an account and takes everything with it.
 *
 * The most destructive thing in this codebase, and it has to exist: you
 * cannot sell a subscription to an account nobody can close, and for anyone
 * selling into the EU or UK the right to erasure is not optional.
 *
 * Everything means everything — the videos, their audio and posters, every
 * render, the transcripts, the clips, the jobs, the usage history, and the
 * user row. R2 first, so a database that survives a partial failure still
 * points at what is left rather than at objects that are already gone.
 *
 * The caller must have proved intent by typing the account's own email
 * address; this re-checks it rather than trusting that the interface did,
 * because "the UI asked" is not a safeguard an API can rely on.
 */
export async function closeAccount(
  env: Env,
  userId: string,
  typedEmail: string,
): Promise<{ ok: boolean; error?: string }> {
  const db = env.DB;

  const user = await db
    .prepare(`SELECT id, email FROM v2_users WHERE id=?`)
    .bind(userId)
    .first<{ id: string; email: string }>();
  if (!user) return { ok: false, error: "not found" };

  if (typedEmail.trim().toLowerCase() !== user.email.toLowerCase()) {
    return { ok: false, error: "That is not the address on this account." };
  }

  /* Every R2 key this account owns, from the tables that hold them. */
  const keys = new Set<string>();
  const { results: sources } = await db
    .prepare(`SELECT r2_key, poster_r2_key FROM sources WHERE user_id=?`)
    .bind(userId)
    .all<{ r2_key: string | null; poster_r2_key: string | null }>();
  for (const s of sources ?? []) {
    if (s.r2_key) {
      keys.add(s.r2_key);
      keys.add(`${s.r2_key.replace(/\.[a-z0-9]+$/i, "")}.audio.mp3`);
    }
    if (s.poster_r2_key) keys.add(s.poster_r2_key);
  }
  const { results: renders } = await db
    .prepare(`SELECT r2_key FROM renders WHERE user_id=? AND r2_key IS NOT NULL`)
    .bind(userId)
    .all<{ r2_key: string }>();
  for (const r of renders ?? []) keys.add(r.r2_key);

  const { results: clips } = await db
    .prepare(`SELECT frame_r2_key FROM v2_clips WHERE user_id=? AND frame_r2_key IS NOT NULL AND frame_r2_key <> ''`)
    .bind(userId)
    .all<{ frame_r2_key: string }>();
  for (const cl of clips ?? []) keys.add(cl.frame_r2_key);

  for (const key of keys) {
    /* A key that is already gone is not a reason to leave the account open. */
    await env.MEDIA.delete(key).catch(() => {});
  }

  await db.batch([
    db.prepare(`DELETE FROM beats WHERE project_id IN (SELECT id FROM v2_projects WHERE user_id=?)`).bind(userId),
    db.prepare(`DELETE FROM segments WHERE source_id IN (SELECT id FROM sources WHERE user_id=?)`).bind(userId),
    db.prepare(`DELETE FROM v2_clip_threads WHERE clip_id IN (SELECT id FROM v2_clips WHERE user_id=?)`).bind(userId),
    db.prepare(`DELETE FROM upload_parts WHERE source_id IN (SELECT id FROM sources WHERE user_id=?)`).bind(userId),
    db.prepare(`DELETE FROM uploads WHERE user_id=?`).bind(userId),
    db.prepare(`DELETE FROM renders WHERE user_id=?`).bind(userId),
    db.prepare(`DELETE FROM passes WHERE project_id IN (SELECT id FROM v2_projects WHERE user_id=?)`).bind(userId),
    db.prepare(`DELETE FROM v2_projects WHERE user_id=?`).bind(userId),
    db.prepare(`DELETE FROM v2_clips WHERE user_id=?`).bind(userId),
    db.prepare(`DELETE FROM v2_threads WHERE user_id=?`).bind(userId),
    db.prepare(`DELETE FROM sources WHERE user_id=?`).bind(userId),
    db.prepare(`DELETE FROM jobs WHERE user_id=?`).bind(userId),
    db.prepare(`DELETE FROM usage_events WHERE user_id=?`).bind(userId),
    db.prepare(`DELETE FROM trash WHERE user_id=?`).bind(userId),
    db.prepare(`DELETE FROM auth_tokens WHERE email=?`).bind(user.email),
    db.prepare(`DELETE FROM v2_users WHERE id=?`).bind(userId),
  ]);

  return { ok: true };
}
