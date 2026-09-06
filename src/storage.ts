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
  const row = await db
    .prepare(`SELECT COALESCE(SUM(bytes_stored),0) AS b FROM usage_events WHERE user_id=?`)
    .bind(userId)
    .first<{ b: number | null }>();

  /* Uploads that have not been read yet are metered by ingest, not by the
     upload — so an in-flight or unread video would be invisible to the cap and
     you could sit under it forever by never letting anything be transcribed. */
  const pending = await db
    .prepare(
      `SELECT COALESCE(SUM(u.total_bytes),0) AS b FROM uploads u
        JOIN sources s ON s.id = u.source_id
       WHERE u.user_id=? AND s.deleted_at IS NULL`,
    )
    .bind(userId)
    .first<{ b: number | null }>();

  return (row?.b ?? 0) + (pending?.b ?? 0);
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
