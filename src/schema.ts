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

  /*
   * Rate-limit counters. Fixed windows, one row per key per window.
   *
   * On D1 rather than the rate-limiting binding because a binding is per-colo,
   * and "how many login emails has this address been sent" has to hold across
   * all of them.
   */
  `CREATE TABLE IF NOT EXISTS rate_limits (
     k TEXT NOT NULL,
     window_start INTEGER NOT NULL,
     hits INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (k, window_start)
   )`,

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

  /*
   * Which parts of an in-flight upload have actually landed.
   *
   * This is what makes an upload resumable across sessions rather than only
   * within one: a browser that reloads, crashes, or comes back tomorrow can
   * ask what the server already holds and send only the rest — the same shape
   * as YouTube's resumable protocol, where the client queries the offset
   * instead of remembering it.
   *
   * It also means `complete` reads the part list from here rather than
   * trusting whatever the client happens to have in memory, which is the
   * difference between a resumed upload finishing correctly and finishing
   * short.
   *
   * (source_id, part_number) is the key so concurrent parts cannot race, and
   * re-sending a part simply replaces it.
   */
  `CREATE TABLE IF NOT EXISTS upload_parts (
     source_id TEXT NOT NULL,
     part_number INTEGER NOT NULL,
     etag TEXT NOT NULL,
     bytes INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL,
     PRIMARY KEY (source_id, part_number)
   )`,

  /* The upload's own parameters, so a fresh session can resume without being
     told them again. Cleared when the upload completes or is abandoned. */
  `CREATE TABLE IF NOT EXISTS uploads (
     source_id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     upload_id TEXT NOT NULL,
     part_size INTEGER NOT NULL,
     total_bytes INTEGER,
     filename TEXT,
     /* "direct" = the browser PUTs to R2 with presigned URLs; "worker" = bytes
        stream through us. Recorded because completion differs: a direct
        upload must be completed over the S3 API with the same uploadId that
        issued the part URLs. */
     mode TEXT NOT NULL DEFAULT 'worker',
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS uploads_by_user ON uploads(user_id, created_at)`,
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

  /*
   * Which transport an upload is using. Listed here as well as in the CREATE
   * above because CREATE TABLE IF NOT EXISTS does nothing to a table that
   * already exists — any deployment that saw the first version of `uploads`
   * would otherwise fail every upload with "no column named mode".
   */
  {
    table: "uploads",
    column: "mode",
    ddl: "ALTER TABLE uploads ADD COLUMN mode TEXT NOT NULL DEFAULT 'worker'",
  },

  /*
   * The Stripe customer behind an account, so a webhook can find the user it
   * is about and a returning subscriber is not charged as a stranger.
   * Nullable: most accounts never reach checkout.
   */
  {
    table: "v2_users",
    column: "stripe_customer_id",
    ddl: "ALTER TABLE v2_users ADD COLUMN stripe_customer_id TEXT",
  },

  /*
   * Which clip a render is OF, for shorts.
   *
   * A cut render belongs to a project and gets its ranges from that project's
   * beats. A short is one moment from the library and has no project at all —
   * Clipping deliberately produces material rather than edits. Without this
   * there was nowhere to hang a rendered short, which is part of why Clipping
   * has never rendered anything.
   */
  { table: "renders", column: "clip_id", ddl: "ALTER TABLE renders ADD COLUMN clip_id TEXT" },

  /*
   * How big a source's file is.
   *
   * Storage was counted from usage_events, which ingest writes AFTER reading a
   * video. So an upload that finished but had not been read yet counted as
   * nothing — and one whose read FAILED counted as nothing for ever, while its
   * bytes sat in R2 being billed. Recorded at upload completion, where the size
   * is known and final.
   */
  { table: "sources", column: "bytes", ddl: "ALTER TABLE sources ADD COLUMN bytes INTEGER" },

  /*
   * The arrangement: block ids in sequence.
   *
   * Separate from `cuts` on purpose. Cuts say what is struck, order says where
   * things are — so rearranging never deletes and striking never reorders, and
   * either can be undone without touching the other. Null means "never
   * rearranged", which is the transcript in its own order.
   */
  { table: "v2_projects", column: "block_order", ddl: "ALTER TABLE v2_projects ADD COLUMN block_order TEXT" },

  /*
   * What the footage is ABOUT, in a few words, written once when it is read.
   *
   * Deliberately NOT `sources.title`: a source keeps its filename, because you
   * find a file again by what you called it. This is the name its CUT takes,
   * so "DJI_20260905043337_0026_D" stops being what the piece is called.
   *
   * Stored rather than generated on demand because the cut is created lazily,
   * on the first open — asking a model then would put a model call inside a
   * page load, and would risk two opens producing two different names.
   */
  { table: "sources", column: "cut_title", ddl: "ALTER TABLE sources ADD COLUMN cut_title TEXT" },

  /*
   * What the user asked for when they added this footage.
   *
   * Home is one text field and a file. The sentence has to outlive the upload
   * — which can take forty minutes, survive a navigation, and finish on a
   * different page or after this one is gone — and it cannot be acted on
   * until the transcript exists. A column on the source is the only place
   * that is true of; the composer used to just clear the field and drop it.
   *
   * Cleared once it has been acted on, so re-opening the footage later does
   * not silently re-run a request from last week.
   */
  { table: "sources", column: "brief", ddl: "ALTER TABLE sources ADD COLUMN brief TEXT" },
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
