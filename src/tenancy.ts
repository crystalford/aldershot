/**
 * Retrofits per-account ownership onto tables that predate auth. Lives apart
 * from db.ts/clips.ts/visualtags.ts because it spans tables owned by all
 * three rather than belonging to any one of them.
 */
const TENANCY_TABLES = ["projects", "videos", "clips", "visual_tags"] as const;

async function columnExists(db: D1Database, table: string, column: string): Promise<boolean> {
  const { results } = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  return (results ?? []).some((r) => r.name === column);
}

/** SQLite has no `ADD COLUMN IF NOT EXISTS` — check first, matching the
 *  "safe to call on every request" convention every other ensure*Schema
 *  function here already follows. */
export async function ensureTenancySchema(db: D1Database): Promise<void> {
  for (const table of TENANCY_TABLES) {
    if (!(await columnExists(db, table, "user_id"))) {
      await db.prepare(`ALTER TABLE ${table} ADD COLUMN user_id TEXT`).run();
    }
  }
}

/** One-time claim: whoever signs up first inherits every pre-existing
 *  unowned row (this app's own test data, created before accounts existed).
 *  Naturally a no-op after that first claim, since no row is ever left with
 *  a NULL user_id afterward. Invoked from a Better Auth `databaseHooks
 *  .user.create.after` hook — see auth.ts. */
export async function claimUnownedRows(db: D1Database, userId: string): Promise<void> {
  await db.batch(
    TENANCY_TABLES.map((table) =>
      db.prepare(`UPDATE ${table} SET user_id = ? WHERE user_id IS NULL`).bind(userId),
    ),
  );
}
