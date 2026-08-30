/**
 * V2 schema, lazy-created.
 *
 * This project has no migration runner — deploy explicitly skips one and every
 * table is created on first request (see .github/workflows/deploy.yml and the
 * existing ensure*Schema functions). `migrations/0006_v2_core.sql` is a
 * checked-in mirror of the statements below, kept for readability; THESE are
 * what actually run.
 *
 * Every statement is `IF NOT EXISTS` and therefore safe to run on every
 * request. The v1 tables are left untouched — nothing is dropped, nothing is
 * migrated. The v2 app simply does not read them.
 */

const STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS v2_users (
     id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT,
     plan TEXT NOT NULL DEFAULT 'free',
     is_owner INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS sources (
     id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
     title TEXT NOT NULL, filename TEXT,
     origin TEXT NOT NULL,
     r2_key TEXT NOT NULL,
     stream_uid TEXT,
     duration_s INTEGER, width INTEGER, height INTEGER,
     transcript_state TEXT NOT NULL DEFAULT 'pending',
     poster_r2_key TEXT,
     created_at INTEGER NOT NULL, deleted_at INTEGER
   )`,
  `CREATE INDEX IF NOT EXISTS sources_by_user ON sources(user_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS segments (
     id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id),
     idx INTEGER NOT NULL, start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL,
     speaker TEXT, text TEXT NOT NULL,
     words TEXT,
     UNIQUE(source_id, idx)
   )`,

  `CREATE TABLE IF NOT EXISTS v2_clips (
     id TEXT PRIMARY KEY, user_id TEXT NOT NULL, source_id TEXT NOT NULL REFERENCES sources(id),
     start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL,
     quote TEXT NOT NULL,
     why TEXT,
     score INTEGER,
     heat INTEGER,
     frame_r2_key TEXT NOT NULL,
     kept INTEGER NOT NULL DEFAULT 0,
     origin TEXT NOT NULL,
     used_count INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL, deleted_at INTEGER
   )`,
  `CREATE INDEX IF NOT EXISTS v2_clips_by_user ON v2_clips(user_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS v2_clips_by_source ON v2_clips(source_id, start_ms)`,

  `CREATE TABLE IF NOT EXISTS v2_threads (
     id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
     name TEXT NOT NULL, summary TEXT,
     clip_count INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS v2_clip_threads (
     clip_id TEXT NOT NULL REFERENCES v2_clips(id), thread_id TEXT NOT NULL REFERENCES v2_threads(id),
     confidence REAL NOT NULL, PRIMARY KEY (clip_id, thread_id)
   )`,

  `CREATE TABLE IF NOT EXISTS v2_projects (
     id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
     title TEXT NOT NULL,
     kind TEXT NOT NULL,
     source_id TEXT REFERENCES sources(id),
     brief TEXT,
     has_acts INTEGER NOT NULL DEFAULT 0,
     runtime_s INTEGER, pct INTEGER NOT NULL DEFAULT 0,
     next_action TEXT,
     poster_r2_key TEXT,
     archived_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
   )`,
  `CREATE INDEX IF NOT EXISTS v2_projects_by_user ON v2_projects(user_id, updated_at)`,

  `CREATE TABLE IF NOT EXISTS beats (
     id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES v2_projects(id),
     idx INTEGER NOT NULL,
     kind TEXT NOT NULL,
     act TEXT,
     clip_id TEXT REFERENCES v2_clips(id),
     text TEXT,
     struck TEXT,
     dur_ms INTEGER,
     media_r2_key TEXT,
     recorded_at INTEGER,
     UNIQUE(project_id, idx)
   )`,

  `CREATE TABLE IF NOT EXISTS renders (
     id TEXT PRIMARY KEY, project_id TEXT REFERENCES v2_projects(id), user_id TEXT NOT NULL,
     kind TEXT NOT NULL,
     format TEXT NOT NULL,
     aspect TEXT NOT NULL DEFAULT '16:9',
     caption_style TEXT, r2_key TEXT, stream_uid TEXT,
     duration_s INTEGER, bytes INTEGER,
     state TEXT NOT NULL DEFAULT 'queued',
     error TEXT, created_at INTEGER NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS passes (
     id TEXT PRIMARY KEY, project_id TEXT REFERENCES v2_projects(id), source_id TEXT,
     n INTEGER NOT NULL, instruction TEXT NOT NULL,
     result TEXT NOT NULL,
     model TEXT, tokens_in INTEGER, tokens_out INTEGER,
     created_at INTEGER NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS jobs (
     id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
     type TEXT NOT NULL,
     ref_id TEXT, state TEXT NOT NULL DEFAULT 'queued',
     pct INTEGER NOT NULL DEFAULT 0, stage_label TEXT,
     queued_overnight INTEGER NOT NULL DEFAULT 0,
     error TEXT, started_at INTEGER, finished_at INTEGER, created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS jobs_by_user ON jobs(user_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS jobs_by_ref ON jobs(ref_id)`,

  `CREATE TABLE IF NOT EXISTS usage_events (
     id TEXT PRIMARY KEY, user_id TEXT NOT NULL, job_id TEXT, job_type TEXT NOT NULL,
     source_minutes REAL DEFAULT 0,
     cpu_ms INTEGER DEFAULT 0, gpu_ms INTEGER DEFAULT 0,
     tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0,
     bytes_stored INTEGER DEFAULT 0, bytes_delivered INTEGER DEFAULT 0,
     stream_minutes_stored REAL DEFAULT 0, stream_minutes_delivered REAL DEFAULT 0,
     unit_prices TEXT NOT NULL,
     cost_usd REAL NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS usage_by_user_month ON usage_events(user_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS trash (
     id TEXT PRIMARY KEY, user_id TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT NOT NULL,
     label TEXT NOT NULL, payload TEXT NOT NULL, deleted_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS trash_by_user ON trash(user_id, deleted_at)`,

  /*
   * One-time login links. Only the SHA-256 of the token is stored — the token
   * itself exists solely in the email — so a dump of this table cannot be
   * replayed into anyone's account.
   */
  `CREATE TABLE IF NOT EXISTS auth_tokens (
     token_hash TEXT PRIMARY KEY,
     email TEXT NOT NULL,
     expires_at INTEGER NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS auth_tokens_expiry ON auth_tokens(expires_at)`,
];

/**
 * Columns added after the fact. SQLite has no `ADD COLUMN IF NOT EXISTS`, so
 * each one checks PRAGMA table_info first — the same pattern the rest of this
 * project uses for lazy migrations.
 */
const ADDED_COLUMNS: Array<{ table: string; column: string; ddl: string }> = [
  // Script mode's transcript cuts, as JSON ranges. On the project because
  // Script edits the whole source transcript, not one block.
  { table: "v2_projects", column: "cuts", ddl: "ALTER TABLE v2_projects ADD COLUMN cuts TEXT" },
];

let ensured = false;

/**
 * Creates the v2 tables if they are missing. Cheap to call on every request:
 * after the first success within an isolate it is a no-op, and the statements
 * are idempotent anyway across isolates.
 */
export async function ensureV2Schema(db: D1Database): Promise<void> {
  if (ensured) return;
  await db.batch(STATEMENTS.map((s) => db.prepare(s)));

  for (const { table, column, ddl } of ADDED_COLUMNS) {
    const { results } = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
    if (!(results ?? []).some((c) => c.name === column)) {
      await db.prepare(ddl).run();
    }
  }

  ensured = true;
}
