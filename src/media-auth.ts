/**
 * Who may read a media object.
 *
 * /media/* served ANY object to ANYONE. No session, no ownership check,
 * `cache-control: immutable`, no expiry — a customer's unreleased footage
 * protected by nothing but an unguessable path, permanently, to whoever ends
 * up holding the URL. That is a privacy failure rather than a cost one, and it
 * is not a thing a paid product can ship with.
 *
 * Every key this app writes is `u/<userId>/…`, so a key carries its own owner
 * and the common case needs no database at all. The database is consulted only
 * when the prefix does not match, which covers keys written before a user row
 * was ever recreated — checked against production, where they do all match, but
 * "these two always agree" is exactly the assumption that quietly stops being
 * true later.
 *
 * Not signed URLs. Those would mean signing every <img> and <video> src at
 * render time across a dozen call sites, and getting one wrong fails open. A
 * cookie the browser already sends on same-origin requests fails closed.
 */

/** The owner encoded in a key, or null if it is not the shape we write. */
export function ownerOf(key: string): string | null {
  /*
   * Traversal first. R2 keys are literal strings and it does not resolve "..",
   * so this cannot escape a prefix today — but the check costs nothing and the
   * day someone puts a filesystem or a normalising proxy behind this, it is
   * the difference between a bug and a breach.
   */
  if (!key || key.includes("..") || key.includes("\\") || key.startsWith("/")) return null;

  const parts = key.split("/");
  if (parts.length < 3 || parts[0] !== "u" || !parts[1]) return null;
  return parts[1];
}

/**
 * The cheap half: does this key belong to this user by its own prefix?
 *
 * Pure, so the prefix logic — which is where confusion bugs live — is tested
 * directly rather than through a database.
 */
export function ownsByPrefix(userId: string, key: string): boolean {
  const owner = ownerOf(key);
  return owner !== null && owner === userId;
}

/**
 * The full check. Prefix first, database only if that fails.
 *
 * A key that belongs to nobody we can find is refused. Default-deny is the
 * only safe default here: the failure mode of guessing wrong in the other
 * direction is serving someone else's video.
 */
export async function mayReadMedia(db: D1Database, userId: string, key: string): Promise<boolean> {
  if (ownerOf(key) === null) return false;
  if (ownsByPrefix(userId, key)) return true;

  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM sources
        WHERE user_id=?1 AND (r2_key=?2 OR poster_r2_key=?2)
       UNION ALL
       SELECT 1 FROM v2_clips WHERE user_id=?1 AND frame_r2_key=?2
       UNION ALL
       SELECT 1 FROM renders WHERE user_id=?1 AND r2_key=?2
       UNION ALL
       SELECT 1 FROM beats b JOIN v2_projects p ON p.id=b.project_id
        WHERE p.user_id=?1 AND b.media_r2_key=?2
       LIMIT 1`,
    )
    .bind(userId, key)
    .first<{ ok: number }>();

  return Boolean(row);
}
