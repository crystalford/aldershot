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

  /*
   * THE RULES THAT MADE THE CUT, which is the only thing a cut actually is.
   *
   * Invariant 1: "Rules are the source of truth; a cut is re-produced from
   * rules + moments, never stored as an outcome." The beats table stores the
   * outcome, and until this existed that was ALL there was — so an assembled
   * cut arrived with no account of why those moments and not others, and
   * nothing could be switched off because nothing had been written down.
   *
   * `on` rather than a delete, because nothing in this product is deleted:
   * a rule you disagree with switches off and the cut re-produces without it.
   *
   * Nullable everywhere below `kind` on purpose — a keep rule has a tag and
   * no seconds, a cap has seconds and no tag, an order has neither. One table
   * because they are one list in one pane, in one order, and splitting them
   * by shape would make reading that list a union of five queries.
   */
  `CREATE TABLE IF NOT EXISTS rules (
     id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES v2_projects(id),
     /*
      * THE RULE'S OWN NAME, stable across saves, scoped to the project.
      *
      * The id column is the ROW and is re-minted on every save, because saving replaces
      * the list. So anything outside this table that refers to a rule — the
      * toggle in the pane, a future reorder, an undo — has to hold this
      * instead, or it is holding an id that stopped existing the moment
      * anything else about the cut changed. Measured: toggling one rule off
      * changed all four rules' row ids, and only a full page reload hid it.
      *
      * Project-scoped rather than global because the names are human: every
      * project has an "r-core", and a global unique on them would make the
      * second project that wanted one fail to save.
      */
     key TEXT NOT NULL,
     idx INTEGER NOT NULL,
     kind TEXT NOT NULL,
     on_ INTEGER NOT NULL DEFAULT 1,
     text TEXT,
     tag TEXT,
     clip_ids TEXT,
     ord TEXT,
     secs INTEGER,
     hand INTEGER NOT NULL DEFAULT 0,
     wins INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL,
     UNIQUE(project_id, idx),
     UNIQUE(project_id, key)
   )`,
  `CREATE INDEX IF NOT EXISTS rules_by_project ON rules(project_id, idx)`,

  /*
   * A PLAN, BEFORE THERE IS A PROJECT.
   *
   * "Cut it turns the plan into the project" — so the plan has to exist
   * first, and survive the one stop where the user answers which beats to
   * keep. A project at that point would be a project with no cut in it.
   *
   * `state` is where the flow got to, because the stop is the whole design:
   * the pipeline runs sized → claim → beats, STOPS, then found → plan → cut.
   * Storing the step means a reload during the stop comes back to the stop
   * rather than starting again or silently carrying on.
   */
  `CREATE TABLE IF NOT EXISTS plans (
     id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
     topic TEXT NOT NULL,
     claim TEXT,
     state TEXT NOT NULL DEFAULT 'beats',
     project_id TEXT REFERENCES v2_projects(id),
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS plans_by_user ON plans(user_id, created_at)`,

  /*
   * One beat of a plan.
   *
   * `need` is what the beat wants in the user's terms — "the trade priced in
   * rent, then the admission that the price is embarrassing" — and it is a
   * RETRIEVAL QUERY, not prose for a person. That is the whole shape of this
   * pipeline: the model says what each beat needs, and search decides which
   * footage meets it. The model never names a clip, so it cannot name one
   * that does not exist.
   *
   * `found` is the clip ids retrieval returned, as JSON. Written after the
   * stop, empty before it.
   */
  `CREATE TABLE IF NOT EXISTS plan_beats (
     id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES plans(id),
     idx INTEGER NOT NULL,
     role TEXT NOT NULL,
     name TEXT NOT NULL,
     need TEXT NOT NULL,
     kept INTEGER NOT NULL DEFAULT 1,
     found TEXT,
     UNIQUE(plan_id, idx)
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
  /*
   * When this clip was written into the meaning index, or null if it never
   * was. A backfill reads this to know what is left to do, so the work is
   * resumable and a library of thousands does not restart from the top every
   * run. See src/embeddings.ts.
   */
  { table: "v2_clips", column: "embedded_at", ddl: "ALTER TABLE v2_clips ADD COLUMN embedded_at INTEGER" },

  /*
   * WHAT THIS PROJECT WAS ATTACHED TO, as a JSON array of source ids.
   *
   * A cut assembled from the library drew on ALL of it, which is right for
   * "three minutes on whatever I have" and wrong for "tighten this" — the
   * moment somebody points at two videos, the rules have to apply to those
   * two and nothing else, or the cut quietly fills up with footage they did
   * not choose.
   *
   * On the project rather than a join table because it is one short list that
   * is always read whole, written once at assembly, and meaningless without
   * the project. source_id stays what it is — a cut that belongs to ONE video
   * — and this is the many-video answer beside it. Null means the whole
   * library, which is what every project made before this column existed did.
   */
  { table: "v2_projects", column: "scope", ddl: "ALTER TABLE v2_projects ADD COLUMN scope TEXT" },

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

  /*
   * Where this video's EDITING COPY lives — a 480p mp4 in R2 that the editor
   * plays instead of the original.
   *
   * The original is routinely gigabytes and the editor scrubs it, twice over
   * (the player and the thumbnail decoder). The copy is about a tenth the size
   * with a keyframe every two seconds, which is what makes clicking a
   * transcript line land immediately rather than after a decode.
   *
   * Null until the copy exists, and null is a working state: every surface
   * falls back to the original, so old footage and a failed proxy both keep
   * playing. Nothing about the EXPORT reads this — a render is built from the
   * master.
   */
  { table: "sources", column: "proxy_r2_key", ddl: "ALTER TABLE sources ADD COLUMN proxy_r2_key TEXT" },

  /*
   * Whether this export asked for its sound cleaned up — denoise, de-click, a
   * presence lift, compression and broadcast loudness, applied once over the
   * finished timeline.
   *
   * On the RENDER rather than the project, because it is a choice about one
   * export: the same cut can be rendered clean for YouTube and raw for an
   * archive, and a render is already the row that remembers format, aspect
   * and caption style for exactly that reason.
   */
  { table: "renders", column: "enhance", ddl: "ALTER TABLE renders ADD COLUMN enhance INTEGER DEFAULT 0" },

  /*
   * WHAT THE CUT LOOKED LIKE BEFORE THIS PASS RAN.
   *
   * A pass rewrites the whole cut, and the only way back was a toast that
   * expired after six seconds or a keyboard shortcut. The owner does not use
   * keyboard shortcuts, so in practice a pass was irreversible the moment you
   * looked away — on the one action in the product that changes everything at
   * once.
   *
   * Held as the same {cuts, order} shape POST /restore already takes, so the
   * conversation's Undo and the toast's Undo end in the same call. Null on
   * every pass recorded before this existed; those turns simply do not offer
   * one, which is honest.
   */
  { table: "passes", column: "undo", ddl: "ALTER TABLE passes ADD COLUMN undo TEXT" },

  /* Set when that snapshot has been spent, so a turn offers Undo once. Going
     back twice would restore a state from before an edit you made in between
     and silently throw it away. */
  { table: "passes", column: "undone_at", ddl: "ALTER TABLE passes ADD COLUMN undone_at INTEGER" },

  /*
   * WHETHER THE WORK THIS ROW PAID FOR PRODUCED ANYTHING.
   *
   * usage_events records what was spent and has never recorded what came of
   * it, so the cost panel could not tell a pass that found eight moments from
   * one that found none — and the neurons cost the same either way. Three
   * answers: "found", "empty", "failed".
   *
   * Deliberately NOT a way to charge less. The tokens really were bought, and
   * zeroing the row would make the ledger understate real spend — a lie in the
   * other direction. This says what the money bought.
   */
  { table: "usage_events", column: "outcome", ddl: "ALTER TABLE usage_events ADD COLUMN outcome TEXT" },

  /*
   * WHERE TO LOOK, after a pass has rewritten the cut.
   *
   * A pass says what it did — "8 lines cut · −1:24" — and could not show you
   * where, so checking its work meant scrolling a transcript hunting for
   * things that had changed colour. The research on this whole category lands
   * on the same point: the problem is not whether the model can do more, it is
   * whether a person can check what it chose faster than doing it by hand.
   *
   * The block id of the first moment the pass was about. Not the first cut it
   * applied — on a "keep" pass that is line 0 every time, which is true and
   * useless.
   */
  { table: "passes", column: "first_change", ddl: "ALTER TABLE passes ADD COLUMN first_change TEXT" },
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
