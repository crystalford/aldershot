/**
 * V2 schema, lazy-created.
 *
 * This project has no migration runner — deploy explicitly skips one and every
 * table is created on first request (see .github/workflows/deploy.yml and the
 * existing ensure*Schema functions). THESE statements are what actually run.
 *
 * migrations/schema.sql is the readable copy, GENERATED from these by
 * scripts/schema-doc.cjs and checked by the fidelity gate. It used to be
 * migrations/0006_v2_core.sql, hand-written, and by the time anyone compared
 * them it disagreed about twelve tables and had never heard of thirteen more
 * — while the gate's "table written and never read" rule was reading it. The
 * numbered files are history now; nothing reads them.
 *
 * Every statement is `IF NOT EXISTS` and therefore safe to run on every
 * request. The v1 tables are left untouched — nothing is dropped, nothing is
 * migrated. The v2 app simply does not read them.
 */

const STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS v2_users (
     id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT,
     plan TEXT NOT NULL DEFAULT 'free',
     /*
      * The monthly spend cap, in dollars. NULL is "never set", which is not
      * the same as no cap: src/spend.ts reads it as DEFAULT_CAP_USD, because
      * a cap that only protects the people who went looking for it protects
      * nobody.
      */
     spend_cap_usd REAL,
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
     /*
      * THE KIND-SPECIFIC REST, AS JSON.
      *
      * The data model (doc 03) writes a rule as kind + params, and for a while
      * this table had no params at all: tag, clip_ids, ord and secs were every
      * field any kind could carry. The kinds added since carry more — len a
      * window, count a number, a subject rule the words it matches — and all
      * three were written nowhere and came back undefined, which compute()
      * reads as "no window", "no limit" and "no words": a rule that still reads
      * correctly in the pane and has no effect on the cut. Invariant 1 says the
      * rules ARE the cut, so a rule that does not survive a reload is not a
      * rule, and this one failed silently in both directions.
      *
      * The four columns above stay columns because they are the fields shared
      * across kinds. This one is the per-kind remainder, and avoid (topic, re)
      * and fx (fx, scope) land here when they are built.
      */
     params TEXT,
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

  /*
   * THE EVAL SET. Human judgements about what backs what.
   *
   * 06-FOOTAGE-SYSTEM.md: "~200 claims over ~10 hours across three kinds of
   * footage, each labelled with the backing utterance or 'none', plus
   * near-miss negatives written on purpose." Every retrieval and threshold
   * choice is tuned against it, every model swap is gated by it, and no
   * vendor number is trusted until it has run on it.
   *
   * It lives in the product's own database rather than a file in the repo
   * because the footage does: a claim is only labellable against the library
   * it was written for, and a labelled set that does not travel with the
   * footage is a set about footage nobody has.
   */
  `CREATE TABLE IF NOT EXISTS eval_claims (
     id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
     text TEXT NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS eval_claims_by_user ON eval_claims(user_id, created_at)`,

  /*
   * One judgement: this moment, against this claim.
   *
   * THREE-WAY, not two. "Related but not enough" is the whole reason the set
   * is worth building — near-miss evidence, the same speaker on the same
   * topic making a different point, is the dominant false positive, and a
   * yes/no set cannot teach a threshold to refuse it.
   *
   * One row per claim and clip, replaced on a second answer: somebody
   * changing their mind is a correction, not a second opinion.
   */
  `CREATE TABLE IF NOT EXISTS eval_labels (
     claim_id TEXT NOT NULL REFERENCES eval_claims(id),
     clip_id TEXT NOT NULL REFERENCES v2_clips(id),
     verdict TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     PRIMARY KEY (claim_id, clip_id)
   )`,

  /*
   * THE SAME JUDGEMENT, BUT WITH WHO MADE IT — and that is a new table
   * rather than a column, because of the line above it.
   *
   * `PRIMARY KEY (claim_id, clip_id)` means one verdict per moment per
   * claim, replaced on a second answer. That was right when a second answer
   * could only be the same person changing their mind, and it is exactly
   * wrong for Phase 0, which asks for "two labellers, agreement recorded":
   * the second labeller silently overwrote the first, and the agreement
   * figure could never be computed because the disagreements were gone.
   *
   * A primary key cannot be altered, and `CREATE TABLE IF NOT EXISTS` over
   * an existing table does nothing at all — so the fix is a table whose key
   * includes the labeller. The old one stays where it is: nothing in this
   * product is deleted, and the eval page reads both, naming the rows that
   * predate labellers rather than pretending they belong to somebody.
   *
   * THE LABELLER IS A NAME, NOT AN ACCOUNT. A claim belongs to the user who
   * wrote it and only they can reach it, so two labellers means two people
   * at one keyboard taking turns — or the same person twice, blind, weeks
   * apart, which measures the same thing and is just as useful.
   */
  `CREATE TABLE IF NOT EXISTS eval_judgements (
     claim_id TEXT NOT NULL REFERENCES eval_claims(id),
     clip_id TEXT NOT NULL REFERENCES v2_clips(id),
     labeller TEXT NOT NULL,
     verdict TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     PRIMARY KEY (claim_id, clip_id, labeller)
   )`,
  `CREATE INDEX IF NOT EXISTS eval_judgements_by_claim ON eval_judgements(claim_id, labeller)`,

  /*
   * WHAT THE JUDGE SAID, beside what the people said.
   *
   * Its own table rather than another labeller in eval_judgements, and the
   * reason is the agreement figure: a machine listed among the labellers
   * would be averaged into "do two people agree about this set", which is a
   * question about the set and not about the model. They are different
   * questions and they must not share a column.
   *
   * KEYED BY VERSION TOO, so a model swap is a new row rather than an
   * overwrite. The convention is that every model call is "gated by the
   * eval set before a model swap" — which cannot be done if the old
   * answers are gone the moment the new model runs.
   */
  `CREATE TABLE IF NOT EXISTS eval_machine (
     claim_id TEXT NOT NULL REFERENCES eval_claims(id),
     clip_id TEXT NOT NULL REFERENCES v2_clips(id),
     version TEXT NOT NULL,
     model TEXT NOT NULL,
     verdict TEXT NOT NULL,
     /* What it said before the structural rule downgraded it, and whether
        that happened — the two together are how you see a judge that
        asserts support it cannot point at. */
     raw TEXT NOT NULL,
     downgraded INTEGER NOT NULL DEFAULT 0,
     /* Whether the model said anything about this moment at all. An
        unanswered one is recorded as unrelated so a short answer cannot
        shrink the set, and that is an inference rather than a verdict.
        NO BACKTICKS IN HERE: these statements are template literals, and
        one around a word ends the string and takes the table with it. */
     answered INTEGER NOT NULL DEFAULT 1,
     /* Rebuilt from our own text on our side of the call, never written by
        the model. See src/judge.ts. */
     line TEXT,
     why TEXT,
     created_at INTEGER NOT NULL,
     PRIMARY KEY (claim_id, clip_id, version)
   )`,
  `CREATE INDEX IF NOT EXISTS eval_machine_by_claim ON eval_machine(claim_id, version)`,

  `CREATE TABLE IF NOT EXISTS renders (
     id TEXT PRIMARY KEY, project_id TEXT REFERENCES v2_projects(id), user_id TEXT NOT NULL,
     kind TEXT NOT NULL,
     format TEXT NOT NULL,
     aspect TEXT NOT NULL DEFAULT '16:9',
     caption_style TEXT, r2_key TEXT, stream_uid TEXT,
     duration_s INTEGER, bytes INTEGER,
     /*
      * HOW LOUD IT CAME OUT, measured on the finished file by the container.
      *
      * Doc 09 asks for this to be checked on every export rather than offered
      * as a fix, so it is measured whether or not the export was enhanced and
      * NULL means "not measured", which loudnessVerdict reports as its own
      * answer rather than as a pass.
      */
     lufs REAL, true_peak REAL,
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

  /*
   * ONE ROW PER ITEM OF WORK, which this product did not have.
   *
   * labs/OPERATIONS.md's build order puts this first: "One state row per item
   * — footage file, segment, generated shot, render chunk — with status,
   * attempt, last_error_class, provider, cost_usd, idempotency_key,
   * deadline_at ... A job is complete only when every item is terminal and
   * failed_terminal is zero. Nothing can disappear."
   *
   * A job here has always been ONE row with a percentage on it, so "300
   * processed, 200 didn't" had nowhere to be recorded: the job said 60%, then
   * said ready, and the two hundred were gone. That is invariant 7's silent
   * partial failure, and it is the most expensive kind of bug this product
   * can have because the output looks finished.
   *
   * `idempotency_key` is a CONTENT ADDRESS, not an id — hash(inputs +
   * directive + model + params), the same hash that keys the render cache, so
   * a replay or a duplicate delivery collapses into one stored result. It is
   * UNIQUE for that reason: two rows with one key is the cache miss that
   * costs twice, and a key that collides across different work is the cache
   * hit that answers wrongly.
   *
   * `cost_usd` accumulates across attempts, because per-job cost is the most
   * important number in the business and a retry that cost money and then
   * succeeded cost both.
   */
  `CREATE TABLE IF NOT EXISTS job_items (
     id TEXT PRIMARY KEY,
     job_id TEXT NOT NULL REFERENCES jobs(id),
     kind TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'pending',
     attempt INTEGER NOT NULL DEFAULT 0,
     last_error_class TEXT,
     provider TEXT,
     cost_usd REAL NOT NULL DEFAULT 0,
     idempotency_key TEXT NOT NULL UNIQUE,
     deadline_at INTEGER,
     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS job_items_by_job ON job_items(job_id, status)`,
  /* The reconciler's own query: everything owed, oldest deadline first. A scan
     of every item ever written would get slower every day the product runs. */
  `CREATE INDEX IF NOT EXISTS job_items_owed ON job_items(status, deadline_at)`,

  /*
   * SCOUT: a per-project research run, and what it found.
   *
   * Spec 18 section 2. One thing in it is deliberately NOT as written:
   * Scout's beats are "scout_beats" here, not "beats".
   *
   * WHY. This repo already has two beat tables and they mean different
   * things. "beats" is a cut's blocks — the outcome of applying rules, which
   * invariant 1 says is never the source of truth. "plan_beats" is a plan's
   * beats, keyed to a plan, each carrying a "need" that is a retrieval query
   * against the user's OWN library. Scout's beats are neither: they are
   * keyed to a run on a PROJECT, which may have no plan at all (a project
   * made by attaching footage has none), and each carries a "behaviour" —
   * what a viewer would see in SOMEBODY ELSE'S footage. Writing a behaviour
   * into a column called "need" and a project-scoped row into a
   * plan-scoped table is how the first two beat tables got confused with
   * each other, and that confusion cost a day.
   *
   * The spec's "shared with the plan" promise is kept by plan_beat_id: where
   * a Scout beat came from a plan beat, it says so, and coverage written here
   * can be read back through the link. What it does not do is let a run
   * rewrite a beat the person decided on — invariant 1's spirit, applied to
   * the plan.
   */
  `CREATE TABLE IF NOT EXISTS scout_runs (
     id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES v2_projects(id),
     trigger TEXT NOT NULL,
     brief TEXT,
     status TEXT NOT NULL DEFAULT 'queued',
     stop_reason TEXT,
     rounds INTEGER NOT NULL DEFAULT 0,
     spend_usd REAL NOT NULL DEFAULT 0,
     model_versions_json TEXT,
     created_at INTEGER NOT NULL, finished_at INTEGER
   )`,
  `CREATE INDEX IF NOT EXISTS scout_runs_by_project ON scout_runs(project_id, created_at)`,

  /*
   * "narrow" and "rejected_json" are the decompose step's own honesty, kept
   * on the run rather than thrown away: a brief whose diagnosis was dropped
   * has to be able to say so on the board, or the user is told six searches
   * were run and never told their sentence was not one of them.
   *
   * "counter_gap" is a subject beat with nothing sought against it. It is a
   * marked beat, not a missing one — see src/scout-decompose.ts.
   */
  `CREATE TABLE IF NOT EXISTS scout_beats (
     id TEXT PRIMARY KEY,
     run_id TEXT NOT NULL REFERENCES scout_runs(id),
     project_id TEXT NOT NULL REFERENCES v2_projects(id),
     plan_beat_id TEXT REFERENCES plan_beats(id),
     idx INTEGER NOT NULL,
     role TEXT NOT NULL,
     name TEXT NOT NULL,
     behaviour TEXT NOT NULL,
     inverts TEXT,
     need_min INTEGER NOT NULL DEFAULT 2,
     counter_gap INTEGER NOT NULL DEFAULT 0,
     status TEXT NOT NULL DEFAULT 'gap',
     queries_tried_json TEXT,
     UNIQUE(run_id, idx)
   )`,
  `CREATE INDEX IF NOT EXISTS scout_beats_by_run ON scout_beats(run_id, idx)`,

  /*
   * WHAT WAS TRIED, whether or not it found anything. This table is the
   * diligence log the dispute file exports, and the reason a gap is a result:
   * "sought 6 searches, found 2" is only sayable if the six were written down
   * at the time. A search row with results_n 0 is the point, not a failure.
   *
   * quota_units is what the call cost against the adapter's daily cap — 100
   * search.list calls a day per YouTube project, and a run that quietly spent
   * them is a run that breaks the next twenty.
   */
  `CREATE TABLE IF NOT EXISTS scout_searches (
     id TEXT PRIMARY KEY,
     run_id TEXT NOT NULL REFERENCES scout_runs(id),
     beat_id TEXT REFERENCES scout_beats(id),
     family TEXT NOT NULL,
     adapter TEXT NOT NULL,
     query TEXT NOT NULL,
     hyde TEXT,
     issued_at INTEGER NOT NULL,
     results_n INTEGER NOT NULL DEFAULT 0,
     new_verified_n INTEGER NOT NULL DEFAULT 0,
     quota_units INTEGER NOT NULL DEFAULT 0,
     cost_usd REAL NOT NULL DEFAULT 0,
     outcome TEXT NOT NULL DEFAULT 'ok',
     fail_reason TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS scout_searches_by_run ON scout_searches(run_id, issued_at)`,

  /*
   * A source EXAMINED, not a source owned. Nothing audiovisual is stored
   * here: an id, a URL, metadata, and whether a transcript was readable.
   * Invariant 9.
   *
   * expires_at is the 30-day metadata refresh. YouTube's terms require it and
   * a row older than that is a claim about a video that may no longer exist.
   */
  `CREATE TABLE IF NOT EXISTS scout_sources (
     id TEXT PRIMARY KEY,
     run_id TEXT NOT NULL REFERENCES scout_runs(id),
     adapter TEXT NOT NULL,
     external_id TEXT NOT NULL,
     url TEXT NOT NULL,
     title TEXT,
     channel TEXT,
     published_at INTEGER,
     duration_s INTEGER,
     kind TEXT,
     transcript TEXT NOT NULL DEFAULT 'none',
     /*
      * WHERE THE WORDS ARE, for a source that published some.
      *
      * The transcript column above is a STATE — native, transcribed, none —
      * and the scan phase needs an address, not a state. Without it the run
      * knew a podcast episode had a readable transcript and had no way to
      * reach it, which is most of why the scan phase has never run. Null for
      * every adapter that publishes none, which is all of them but one.
      */
     transcript_url TEXT,
     licence TEXT,
     triage_score REAL,
     scanned INTEGER NOT NULL DEFAULT 0,
     yield_n INTEGER NOT NULL DEFAULT 0,
     dead_end INTEGER NOT NULL DEFAULT 0,
     fetched_at INTEGER NOT NULL, expires_at INTEGER,
     UNIQUE(run_id, adapter, external_id)
   )`,
  `CREATE INDEX IF NOT EXISTS scout_sources_by_run ON scout_sources(run_id, triage_score)`,

  /*
   * THE LEDGER: one row per find, and the receipt for it.
   *
   * t_start_s and t_end_s DERIVE FROM word_span_json — invariant 2 and the
   * timing contract in src/align.ts. A model never typed either of them. A
   * row whose verify is not "verified" is a ghost: shown, marked, and never
   * usable as proof.
   *
   * context_before and context_after are plus or minus ninety seconds either
   * side, stored at find time. A quote that is accurate and unfair is still
   * unfair, and the only moment the surrounding words are cheap to keep is
   * the moment the window was already open.
   */
  /*
   * DOCUMENTS — invariant 8's second tier, which had no supply.
   *
   * "own footage → user's documents → open world → generated", and nothing
   * in the product took a PDF or a photograph, so `documents` was a source
   * the framework ranked and nobody could fill.
   *
   * SMALL FILES, STRAIGHT THROUGH. The video path is multipart because a
   * video is gigabytes; a scan of a letter is kilobytes and a second route
   * sized for it is simpler than making it pretend to be a video.
   *
   * `note` IS WHAT MAKES IT PROOF. Doc 08 wants "the proof itself — the
   * document with its line marked", and nothing here can read a PDF to find
   * the line. The maker marks it: they say what the document shows, in their
   * own words, and that sentence is what a line is matched against and what
   * the receipt records them having asserted. Invariant 10 — the user's own
   * words win where they exist. A document with no note is still a document
   * and is NOT probative, so it cannot carry an EVIDENCE line: "with its
   * line marked" is the half that would be missing.
   *
   * Nothing is deleted (invariant 6): `removed_at` hides one from the offer
   * and the file and the row stay.
   */
  `CREATE TABLE IF NOT EXISTS documents (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES v2_users(id),
     title TEXT NOT NULL,
     /* What it shows, in the maker's words. Null until they say. */
     note TEXT,
     filename TEXT,
     media_type TEXT NOT NULL,
     r2_key TEXT NOT NULL,
     bytes INTEGER NOT NULL,
     removed_at INTEGER,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS documents_by_user ON documents(user_id, removed_at, created_at)`,

  /*
   * POOL HEALTH — the breaker's state, as a row rather than a counter.
   *
   * A Worker is stateless per request and there is no isolate to hold a
   * count in; a module-level variable would count one isolate's failures and
   * route the whole account on them.
   *
   * `last_says` is here because invariant 3 asks for the reason rather than
   * the score: a person shown that a pool is shut is owed the sentence that
   * shut it, not a number. One row per pool, for ever — there are three.
   */
  /*
   * CONTENT-ADDRESSED CALL CACHE — invariant 5, where it still leaked.
   *
   * "Footage is read and charged once; editing is free." Transcription obeyed
   * that and model calls did not: re-run a pass over the same transcript with
   * the same brief and the same model and the whole thing was paid for again.
   *
   * The key is a hash of everything that decides the answer — model, effort,
   * temperature, prompt version, system, user, schema — so a changed prompt
   * evicts itself rather than serving answers to the old question.
   *
   * ONLY DETERMINISTIC CALLS LAND HERE. A capability left sampled (`direct`,
   * `name`) writes prose, and a cache over it would freeze the first draft
   * and make "try again" a lie. See src/call-cache.ts' `cacheable`, which
   * reads that off the temperature rather than taking anyone's word.
   *
   * `hits` is kept because what caching saved is a number the owner's cost
   * view should be able to show, not a belief.
   */
  `CREATE TABLE IF NOT EXISTS call_cache (
     key TEXT PRIMARY KEY,
     capability TEXT NOT NULL,
     model TEXT NOT NULL,
     prompt_version TEXT NOT NULL,
     body TEXT NOT NULL,
     hits INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL
   )`,
  /* The sweep's lookup: oldest first, so a month of rows goes in age order. */
  `CREATE INDEX IF NOT EXISTS call_cache_by_age ON call_cache(created_at)`,

  /*
   * CANARY RUNS — one synthetic judgement a sweep, with the right answer
   * known in advance.
   *
   * Phase 8's canaries. A load-bearing capability can break in ways nothing
   * else notices, and the first person to find out should not be somebody
   * making a receipt.
   *
   * `verdict` has three values and they mean different things: `down` is the
   * call not coming back, `wrong` is it coming back with the wrong answer.
   * The second is worse and quieter, which is why this is not a liveness
   * probe. An append-only log, because what matters is the shape over a day
   * rather than the latest row.
   */
  `CREATE TABLE IF NOT EXISTS canary_runs (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     at INTEGER NOT NULL,
     verdict TEXT NOT NULL,
     says TEXT NOT NULL,
     model TEXT,
     ms INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS canary_runs_by_time ON canary_runs(at)`,

  `CREATE TABLE IF NOT EXISTS pool_health (
     pool TEXT PRIMARY KEY,
     failures INTEGER NOT NULL DEFAULT 0,
     window_started_at INTEGER NOT NULL DEFAULT 0,
     /* Null means the pool is open for business. */
     opened_at INTEGER,
     last_says TEXT,
     last_at INTEGER NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS scout_ledger (
     id TEXT PRIMARY KEY,
     run_id TEXT NOT NULL REFERENCES scout_runs(id),
     beat_id TEXT REFERENCES scout_beats(id),
     role TEXT NOT NULL,
     source_id TEXT NOT NULL REFERENCES scout_sources(id),
     quote_exact TEXT NOT NULL,
     quote_norm TEXT NOT NULL,
     word_span_json TEXT NOT NULL,
     t_start_s REAL NOT NULL, t_end_s REAL NOT NULL,
     context_before TEXT, context_after TEXT,
     found_by_family TEXT,
     verify TEXT NOT NULL DEFAULT 'rejected',
     match_score REAL,
     crowd_signals_n INTEGER NOT NULL DEFAULT 0,
     original_of TEXT REFERENCES scout_ledger(id),
     is_compilation_only INTEGER NOT NULL DEFAULT 0,
     model_version TEXT,
     /*
      * WHEN THE VERIFIER LOOKED, and null when it has not.
      *
      * Every row is written by the scan with verify 'rejected', because
      * nothing has checked it and 'rejected' is the only verdict nobody has
      * asserted. That made a checked-and-genuinely-rejected row
      * indistinguishable from an unchecked one, so the verify phase would
      * have re-read the same hallucination every round for ever.
      *
      * A timestamp rather than a boolean: the rejection rate is per model
      * and prompt version and WHEN it was measured is half of what makes
      * two rates comparable.
      */
     verified_at INTEGER,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS scout_ledger_by_beat ON scout_ledger(beat_id, verify)`,
  /* The verify phase's own lookup lives in ADDED_INDEXES, not here: this
     batch runs before the ALTERs, so an index over `verified_at` would be
     asked for before the column exists on any database that already has
     the table. */

  /*
   * WHAT A ROUND'S FINDS POINTED AT, and the record that stops a run going in
   * a circle.
   *
   * src/scout-snowball.ts derives a round's next questions from what was
   * verified, and takes `alreadySeeded` for a stated reason: "without this a
   * run derives the same phrase every round, searches it, finds the rows it
   * came from, and spends the budget going in a circle." That set has to
   * survive the message that carried the round — a redelivery would otherwise
   * re-raise every seed and pay for every query a second time.
   *
   * It is also the only record of WHY a round asked what it asked. The
   * diligence log lists the queries; this says what each one was chasing.
   *
   * UNIQUE on (run_id, kind, value) with INSERT OR IGNORE: raising the same
   * seed twice is the condition this table exists to prevent, so the database
   * refuses it rather than trusting the caller to check first.
   */
  `CREATE TABLE IF NOT EXISTS scout_seeds (
     id TEXT PRIMARY KEY,
     run_id TEXT NOT NULL REFERENCES scout_runs(id),
     round INTEGER NOT NULL,
     kind TEXT NOT NULL,
     value TEXT NOT NULL,
     support INTEGER NOT NULL,
     why TEXT NOT NULL,
     queries_n INTEGER NOT NULL,
     created_at INTEGER NOT NULL,
     UNIQUE(run_id, kind, value)
   )`,
  `CREATE INDEX IF NOT EXISTS scout_seeds_by_run ON scout_seeds(run_id, round)`,

  /*
   * Where fans already indexed the moment. lag_corrected_t_s is the comment
   * timestamp moved to where the thing actually is: a viewer types the time
   * they noticed, which is after it happened.
   */
  `CREATE TABLE IF NOT EXISTS scout_crowd (
     id TEXT PRIMARY KEY,
     source_id TEXT NOT NULL REFERENCES scout_sources(id),
     kind TEXT NOT NULL,
     t_s REAL,
     lag_corrected_t_s REAL,
     weight REAL NOT NULL DEFAULT 1,
     text TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS scout_crowd_by_source ON scout_crowd(source_id, lag_corrected_t_s)`,

  /*
   * A MISSION is the only way platform media enters: the user fetches it
   * themselves, and the product matches what came back to the quote it was
   * supposed to be. "how" says which — auto for an open licence, capture or
   * upload for the user's own hands.
   */
  `CREATE TABLE IF NOT EXISTS scout_missions (
     id TEXT PRIMARY KEY,
     project_id TEXT NOT NULL REFERENCES v2_projects(id),
     ledger_id TEXT NOT NULL REFERENCES scout_ledger(id),
     in_s REAL NOT NULL, out_s REAL NOT NULL,
     quote TEXT NOT NULL,
     url_at_in TEXT,
     state TEXT NOT NULL DEFAULT 'scouted',
     how TEXT,
     verdict TEXT,
     coverage REAL,
     offset_s REAL,
     fail_reason TEXT,
     created_at INTEGER NOT NULL, expires_at INTEGER
   )`,
  `CREATE INDEX IF NOT EXISTS scout_missions_by_project ON scout_missions(project_id, state)`,
  /*
   * ONE MISSION PER MOMENT PER CUT.
   *
   * A unique INDEX rather than a UNIQUE on the table, because the table may
   * already exist where this runs and a constraint added to a CREATE TABLE
   * IF NOT EXISTS silently does not arrive. The index is also what the
   * upsert in scout-external.ts conflicts on: attaching the same external
   * moment twice re-opens the mission rather than making a second one, which
   * is what keeps the ghost count honest when /api/begin is pressed twice.
   */
  `CREATE UNIQUE INDEX IF NOT EXISTS scout_missions_one_per_cut ON scout_missions(project_id, ledger_id)`,

  /*
   * The credit line, and the chain back through a reupload to the original.
   * "removed" rather than a delete, because nothing here is deleted: a
   * source that vanished keeps its row and says it vanished.
   */
  /*
   * A RECEIPTS PAGE, PUBLISHED FOR THE AUDIENCE.
   *
   * Doc 09: "The evidence ledger is also a receipts page published with the
   * video... 'The edit you can interrogate' is a promise to the audience, not
   * just the maker." Everything else this product exports is read by the
   * person who made the cut; this one is read by strangers, from a link in a
   * video description.
   *
   * So it is the only thing here that is PUBLIC, and therefore the only thing
   * that must be an explicit act. A page nobody asked to publish would put
   * somebody's footage in front of the world because they pressed Export.
   *
   * `revoked_at` rather than a delete, because invariant 6 holds here too and
   * because the two facts differ: a page that was never published and a page
   * somebody took down are different, and only the second needs the link to
   * stop working while the record of it having existed stays.
   */
  `CREATE TABLE IF NOT EXISTS receipt_pages (
     project_id TEXT PRIMARY KEY REFERENCES v2_projects(id),
     user_id TEXT NOT NULL,
     token TEXT NOT NULL,
     published_at INTEGER NOT NULL,
     revoked_at INTEGER
   )`,
  /* The token is how a stranger finds the page, so it is the lookup and it
     has to be unique across every project. */
  `CREATE UNIQUE INDEX IF NOT EXISTS receipt_pages_by_token ON receipt_pages(token)`,

  `CREATE TABLE IF NOT EXISTS scout_attributions (
     id TEXT PRIMARY KEY,
     ledger_id TEXT NOT NULL REFERENCES scout_ledger(id),
     credit_text TEXT NOT NULL,
     url TEXT,
     platform TEXT,
     date INTEGER,
     chain_parent TEXT REFERENCES scout_attributions(id),
     removed INTEGER NOT NULL DEFAULT 0
   )`,

  /*
   * THE LEXICON PERSISTS ACROSS PROJECTS, which is the one piece of Scout
   * that gets better the more he is used. The community's own words for a
   * thing — a nickname, a catchphrase, the name of a compilation — are what
   * the "vocab" query family is made of, and they are not guessable. Learning
   * them once and keeping them is why the second run on a subject costs less
   * and finds more.
   *
   * Scoped to a user, not to a run or a project. first_seen is kept so a term
   * that stopped being used can be aged out rather than searched forever.
   */
  `CREATE TABLE IF NOT EXISTS scout_lexicon (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES v2_users(id),
     entity TEXT NOT NULL,
     term TEXT NOT NULL,
     kind TEXT NOT NULL,
     source_count INTEGER NOT NULL DEFAULT 1,
     first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
     UNIQUE(user_id, entity, term)
   )`,
  `CREATE INDEX IF NOT EXISTS scout_lexicon_by_entity ON scout_lexicon(user_id, entity, source_count)`,

];

/**
 * Columns added after the fact. SQLite has no `ADD COLUMN IF NOT EXISTS`, so
 * each one checks PRAGMA table_info first — the same pattern the rest of this
 * project uses for lazy migrations.
 */
const ADDED_COLUMNS: Array<{ table: string; column: string; ddl: string }> = [
  /*
   * THE MOMENT'S ADDRESS, independent of its timing.
   *
   * start_ms and end_ms are where the moment is according to a RECOGNISER,
   * accurate to about a tenth of a second (src/align.ts). Forced alignment
   * will move those numbers — that is what it is for — and a moment pinned to
   * them would move with them, or worse, stay still while the audio did not.
   *
   * A word span survives it, because re-aligning changes WHEN a word is and
   * never WHICH word it is. Null for a moment whose source has no word
   * timings: a transcript that failed, or one stored before they were kept.
   * The milliseconds remain the fallback and remain correct.
   */
  { table: "v2_clips", column: "start_word", ddl: "ALTER TABLE v2_clips ADD COLUMN start_word INTEGER" },
  { table: "v2_clips", column: "end_word", ddl: "ALTER TABLE v2_clips ADD COLUMN end_word INTEGER" },

  /*
   * WHERE THIS SOURCE'S WORD TIMINGS CAME FROM.
   *
   * src/align.ts said, for several commits, that "everything is `recogniser`
   * until forced alignment exists — there is no column for it yet and
   * inventing one that is always the same value would be a schema change
   * that records nothing". Forced alignment exists now, so the column does.
   *
   * Null reads as `recogniser`, which is what every row written before this
   * actually is. It is not backfilled: a value written by a migration would
   * be a claim that the alignment ran, and it did not.
   */
  /*
   * HOW MANY OF A BEAT'S MOMENTS BACK IT, which is what thin means now.
   *
   * Null when nobody checked — the judge was not run, or its call failed —
   * and then the count of results is all there is to go on. A zero written
   * there would mark a beat as a hole because a model call did not answer,
   * and send somebody to reshoot footage they already have.
   *
   * An added column rather than part of the CREATE, like every other
   * column added after the fact: CREATE TABLE IF NOT EXISTS over an
   * existing table does nothing at all, so a column written there reaches
   * new databases only.
   */
  { table: "plan_beats", column: "backed", ddl: "ALTER TABLE plan_beats ADD COLUMN backed INTEGER" },

  /*
   * WHAT A RECORDED TAKE TURNED OUT TO BE.
   *
   * `dur_ms` came from an x-duration-ms header — a number the BROWSER sent
   * about a file the server had not looked at — and a cut built on it is a
   * cut whose length is whatever the client said. These are measured from
   * the take's own word timings instead.
   *
   * `take_verdict` is whether it reads the line that was written. A forced
   * aligner cannot refuse, so it will place a script over a recording of
   * something else entirely; the score is the only honest signal that
   * happened, and this is the verdict it produced. Null until a take has
   * been aligned, which is not the same as a take that failed.
   */
  { table: "beats", column: "take_verdict", ddl: "ALTER TABLE beats ADD COLUMN take_verdict TEXT" },
  { table: "beats", column: "take_reason", ddl: "ALTER TABLE beats ADD COLUMN take_reason TEXT" },
  /* Word timings for the take, same shape as a segment's: seconds, because
     that is what every other stored word list in this product uses. */
  { table: "beats", column: "take_words", ddl: "ALTER TABLE beats ADD COLUMN take_words TEXT" },

  { table: "sources", column: "timing_source", ddl: "ALTER TABLE sources ADD COLUMN timing_source TEXT" },
  /* When it ran. Null while it has never been tried; a source whose
     alignment failed keeps a null here and a recogniser timing, which is the
     state the retry looks for. */
  { table: "sources", column: "aligned_at", ddl: "ALTER TABLE sources ADD COLUMN aligned_at INTEGER" },

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

  /*
   * THE KIND-SPECIFIC REST OF A RULE.
   *
   * See the params column in the rules table above for what it holds and why
   * it had to exist. It is listed here as well because there is no migration
   * runner: the CREATE above is IF NOT EXISTS, so every database that already
   * had a rules table would have kept the old thirteen columns and every save
   * would have failed on "table rules has no column named params" — a cut that
   * cannot be saved at all, which is louder than the bug being fixed but no
   * better. A column added to a table that already exists belongs in both
   * places, always.
   */
  { table: "rules", column: "params", ddl: "ALTER TABLE rules ADD COLUMN params TEXT" },

  /*
   * The loudness of a finished export. See the renders table above. Here as
   * well because there is no migration runner and the CREATE is IF NOT
   * EXISTS, so a database that already has a renders table would never gain
   * the columns and every finished render would fail on the UPDATE.
   */
  { table: "renders", column: "lufs", ddl: "ALTER TABLE renders ADD COLUMN lufs REAL" },
  { table: "renders", column: "true_peak", ddl: "ALTER TABLE renders ADD COLUMN true_peak REAL" },

  /* The spend cap. See the v2_users table above; here as well because there
     is no migration runner and every existing account already has a row. */
  { table: "v2_users", column: "spend_cap_usd", ddl: "ALTER TABLE v2_users ADD COLUMN spend_cap_usd REAL" },
  /*
   * WHEN THE LAST BILLING EVENT WE ACTED ON WAS MADE.
   *
   * Stripe does not guarantee delivery order and says so. The sequence that
   * costs money is: a subscription is cancelled, Stripe sends `updated`
   * (active) and then `deleted`, and the two arrive the other way round —
   * leaving the account on the paid plan for ever, paying nothing.
   *
   * `created` on the event is the ordering Stripe DOES give, so this holds
   * the last one applied and anything older is ignored. Null until the first
   * event, and an event carrying no timestamp is still applied: ordering is a
   * refinement and not a gate, and the alternative is a paid account that
   * never gets its plan because a field was missing.
   */
  { table: "v2_users", column: "billing_event_at", ddl: "ALTER TABLE v2_users ADD COLUMN billing_event_at INTEGER" },

  /*
   * WHETHER SCOUT MAY GO OUTSIDE, which the front door asks and nothing
   * stored.
   *
   * The prototype puts a Scout row in the MAKE column with a pill reading On,
   * Per project or Off, and the build had Scout only inside a project — so
   * the one place the preference is set was a place you could only reach by
   * already having decided. Three values: `always`, `ask`, `never`.
   *
   * Null means `ask`, which is the prototype's default and the cautious one:
   * going outside is a thing somebody opts into per project rather than a
   * setting they discover has been on.
   */
  { table: "v2_users", column: "outside_pref", ddl: "ALTER TABLE v2_users ADD COLUMN outside_pref TEXT" },

  /*
   * HOW MUCH THE ASSISTANT DECIDES — the composer's dial, which the
   * prototype has and the build did not.
   *
   * Three values: `ask` proposes and waits, `rec` applies and says so with
   * Undo, `auto` applies and records it. Null means `rec`, which is the
   * prototype's default and is what this product already did before the dial
   * existed — so every account that predates this column keeps the behaviour
   * it has had all along.
   */
  { table: "v2_users", column: "ask_mode", ddl: "ALTER TABLE v2_users ADD COLUMN ask_mode TEXT" },

  /* Where a source's published transcript lives. See scout_sources above. */
  { table: "scout_sources", column: "transcript_url", ddl: "ALTER TABLE scout_sources ADD COLUMN transcript_url TEXT" },

  /*
   * WHEN THE VERIFIER LOOKED. See scout_ledger above for what it is for.
   *
   * Here as well because `CREATE TABLE IF NOT EXISTS` adds nothing to a table
   * that already exists, which is the whole reason this list is here — and it
   * is worth saying that adding the column to the CREATE alone was enough to
   *500 every page on a database that had the table. Not a subtle failure, but
   * only because the index below referenced it; a plain column would have
   * been missing silently until the first query that wanted it.
   */
  { table: "scout_ledger", column: "verified_at", ddl: "ALTER TABLE scout_ledger ADD COLUMN verified_at INTEGER" },
];

/**
 * Indexes over columns that arrived after their table did.
 *
 * THESE CANNOT GO IN `STATEMENTS`, which is the ordering bug that cost an
 * afternoon: that batch runs BEFORE the ALTERs, so an index naming a
 * newly-added column is asked for while the column does not exist yet. On a
 * fresh database it works, on every existing one it throws, and the failure
 * arrives as a 500 on every route because `ensureV2Schema` runs in the
 * request path.
 */
const ADDED_INDEXES: string[] = [
  "CREATE INDEX IF NOT EXISTS scout_ledger_unverified ON scout_ledger(run_id, verified_at)",
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

  /* AFTER the columns exist, and not before. See ADDED_INDEXES. */
  await db.batch(ADDED_INDEXES.map((s) => db.prepare(s)));

  ensured = true;
}
