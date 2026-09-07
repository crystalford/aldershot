/**
 * How much a user is storing, and whether they may store more.
 *
 * The cap existed only as a NUMBER: Settings drew a storage meter against
 * PLANS[plan].storageGb and nothing anywhere enforced it. checkCap — the one
 * thing that refuses work — is denominated in processing MINUTES, and it runs
 * at transcribe time, after the upload has already landed. So the product
 * refused the cheap thing (a maxed free account costs about $0.19/month in
 * AI) and permitted the expensive one: bytes, uncapped, and until recently
 * never freed. Upload 500GB, be refused transcription, and the 500GB is still
 * billed.
 *
 * It is checked at /api/uploads instead, where the size is known and not one
 * byte has been written yet.
 */

import { PLANS, type Plan } from "./plans.ts";

export interface StorageCheck {
  ok: boolean;
  usedBytes: number;
  capBytes: number;
  /** Plain-language refusal, stating the cap — the shape checkCap uses. */
  message?: string;
}

const GB = 1e9;

/**
 * Bytes currently held for this user.
 *
 * All time, deliberately. Settings summed this month's usage_events, which is
 * right for processing minutes and wrong for storage: a video uploaded in
 * March is still occupying a disk in April. That meter reported an account
 * near its limit as nearly empty every 1st of the month.
 */
export async function storedBytes(db: D1Database, userId: string): Promise<number> {
  /*
   * Measured from the things that EXIST, not from an event log.
   *
   * This summed usage_events.bytes_stored, which ingest writes after reading a
   * video. Three holes: an upload that finished but had not been read counted
   * as nothing; one whose read FAILED counted as nothing for ever while its
   * bytes sat in R2 being billed; and nothing ever came off the total, so
   * deleting for good — the only thing that frees bytes — did not move the
   * meter it was supposed to.
   *
   * Soft-deleted sources are DELIBERATELY still counted. A delete is
   * reversible and leaves the object in R2, so it is still occupying storage;
   * only purging removes the row and the bytes together. That also makes the
   * "Delete for good" button mean something — it is the one that moves this
   * number.
   */
  const sources = await db
    .prepare(`SELECT COALESCE(SUM(bytes),0) AS b FROM sources WHERE user_id=?`)
    .bind(userId)
    .first<{ b: number | null }>();

  const renders = await db
    .prepare(`SELECT COALESCE(SUM(bytes),0) AS b FROM renders WHERE user_id=? AND state='ready'`)
    .bind(userId)
    .first<{ b: number | null }>();

  /* An upload still in flight has no size on its source yet, and reserving it
     is the point of checking before the bytes land. */
  const pending = await db
    .prepare(
      `SELECT COALESCE(SUM(u.total_bytes),0) AS b FROM uploads u
        JOIN sources s ON s.id = u.source_id
       WHERE u.user_id=? AND s.deleted_at IS NULL`,
    )
    .bind(userId)
    .first<{ b: number | null }>();

  return (sources?.b ?? 0) + (renders?.b ?? 0) + (pending?.b ?? 0);
}

const gb = (bytes: number) => Math.round((bytes / GB) * 10) / 10;

/** Would storing `incomingBytes` more take this account over its cap? */
export async function checkStorage(
  db: D1Database,
  userId: string,
  plan: Plan,
  incomingBytes: number,
): Promise<StorageCheck> {
  const capBytes = (PLANS[plan]?.storageGb ?? PLANS.free.storageGb) * GB;

  /* The owner is metered and never blocked, the same rule checkCap follows —
     a 4 GB upload must not be refused on the account the product is built on.
     Checked before the tally rather than after: there is nothing to weigh
     against, so the three queries behind storedBytes are wasted work. What is
     stored is still counted everywhere it is reported. */
  const owner = await db
    .prepare(`SELECT is_owner FROM v2_users WHERE id=?`)
    .bind(userId)
    .first<{ is_owner: number }>();
  if (owner?.is_owner) return { ok: true, usedBytes: 0, capBytes };

  const usedBytes = await storedBytes(db, userId);
  if (usedBytes + incomingBytes <= capBytes) return { ok: true, usedBytes, capBytes };

  const free = Math.max(0, capBytes - usedBytes);
  return {
    ok: false,
    usedBytes,
    capBytes,
    message:
      free > 0.1 * GB
        ? `That video is ${gb(incomingBytes)} GB and you have ${gb(free)} GB left on ${PLANS[plan].label}. Delete something for good, or upgrade.`
        : `You have used all ${gb(capBytes)} GB on ${PLANS[plan].label}. Delete something for good, or upgrade.`,
  };
}
