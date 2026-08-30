-- V2 core schema — transcribed from design/docs/03-DATA-MODEL.md.
--
-- This is a new product on the same infrastructure; the v1 tables (projects
-- with kind='generative', essays, essay_beats, clip_clusters, …) are left in
-- place untouched rather than dropped, so nothing is lost, but nothing in the
-- v2 app reads them.
--
-- Conventions from the doc: ids are ULIDs as TEXT, timestamps are INTEGER
-- epoch ms, and NOTHING is ever hard-deleted — `deleted_at` only.
--
-- Mirrored idempotently by ensureV2Schema() in src/schema.ts, matching this
-- project's existing lazy-create convention (there is no migration runner —
-- see .github/workflows/deploy.yml).

CREATE TABLE IF NOT EXISTS v2_users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT,
  plan TEXT NOT NULL DEFAULT 'free',       -- free | pro | studio
  is_owner INTEGER NOT NULL DEFAULT 0,     -- gates the cost panel
  created_at INTEGER NOT NULL
);

-- a long video the user did not necessarily record
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
  title TEXT NOT NULL, filename TEXT,
  origin TEXT NOT NULL,                    -- upload | url | library
  r2_key TEXT NOT NULL,                    -- original, kept forever
  stream_uid TEXT,                         -- Cloudflare Stream copy for preview
  duration_s INTEGER, width INTEGER, height INTEGER,
  transcript_state TEXT NOT NULL DEFAULT 'pending', -- pending|running|ready|failed
  poster_r2_key TEXT,
  created_at INTEGER NOT NULL, deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS sources_by_user ON sources(user_id, created_at);

-- word-level transcript, one row per segment
CREATE TABLE IF NOT EXISTS segments (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id),
  idx INTEGER NOT NULL, start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL,
  speaker TEXT, text TEXT NOT NULL,
  words TEXT,                              -- JSON [{w,s,e}] for word-level striking
  UNIQUE(source_id, idx)
);

-- a scored/kept piece of a source. "clip" and "moment" are the same thing.
CREATE TABLE IF NOT EXISTS v2_clips (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, source_id TEXT NOT NULL REFERENCES sources(id),
  start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL,
  quote TEXT NOT NULL,                     -- the transcript of the clip
  why TEXT,                                -- why it was kept/scored, shown in UI
  score INTEGER,                           -- 0-100, null when hand-picked
  heat INTEGER,                            -- 0-2, drives the density bar
  frame_r2_key TEXT NOT NULL,              -- REAL frame, required
  kept INTEGER NOT NULL DEFAULT 0,
  origin TEXT NOT NULL,                    -- editor | clipping | manual
  used_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS v2_clips_by_user ON v2_clips(user_id, created_at);
CREATE INDEX IF NOT EXISTS v2_clips_by_source ON v2_clips(source_id, start_ms);

-- topic container, auto-formed from clip embeddings
CREATE TABLE IF NOT EXISTS v2_threads (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
  name TEXT NOT NULL, summary TEXT,
  clip_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS v2_clip_threads (
  clip_id TEXT NOT NULL REFERENCES v2_clips(id), thread_id TEXT NOT NULL REFERENCES v2_threads(id),
  confidence REAL NOT NULL, PRIMARY KEY (clip_id, thread_id)
);

-- anything being made: a cut, a reaction, an essay, an idea
CREATE TABLE IF NOT EXISTS v2_projects (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,                      -- cut | reaction | essay | idea
  source_id TEXT REFERENCES sources(id),   -- null for essays built from library only
  brief TEXT,                              -- the sentence the user typed
  has_acts INTEGER NOT NULL DEFAULT 0,
  runtime_s INTEGER, pct INTEGER NOT NULL DEFAULT 0,
  next_action TEXT,                        -- "3 reactions to record", shown on Home
  poster_r2_key TEXT,
  archived_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS v2_projects_by_user ON v2_projects(user_id, updated_at);

-- ordered blocks. THE EDIT IS THIS TABLE — there is no timeline object.
CREATE TABLE IF NOT EXISTS beats (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES v2_projects(id),
  idx INTEGER NOT NULL,
  kind TEXT NOT NULL,                      -- clip | vo | react | generated | stock
  act TEXT,                                -- essay act label, null otherwise
  clip_id TEXT REFERENCES v2_clips(id),    -- for kind=clip
  text TEXT,                               -- vo/react script, or clip quote
  struck TEXT,                             -- JSON [[segIdx,wordStart,wordEnd]] words removed
  dur_ms INTEGER,
  media_r2_key TEXT,                       -- recorded vo/react take, or generated visual
  recorded_at INTEGER,
  UNIQUE(project_id, idx)
);

CREATE TABLE IF NOT EXISTS renders (
  id TEXT PRIMARY KEY, project_id TEXT REFERENCES v2_projects(id), user_id TEXT NOT NULL,
  kind TEXT NOT NULL,                      -- cut | short
  format TEXT NOT NULL,                    -- mp4_1080 | mp4_4k | prores
  aspect TEXT NOT NULL DEFAULT '16:9',
  caption_style TEXT, r2_key TEXT, stream_uid TEXT,
  duration_s INTEGER, bytes INTEGER,
  state TEXT NOT NULL DEFAULT 'queued',    -- queued|running|ready|failed
  error TEXT, created_at INTEGER NOT NULL
);

-- every LLM instruction the user gave, and what it did. Shown as the Passes log.
CREATE TABLE IF NOT EXISTS passes (
  id TEXT PRIMARY KEY, project_id TEXT REFERENCES v2_projects(id), source_id TEXT,
  n INTEGER NOT NULL, instruction TEXT NOT NULL,
  result TEXT NOT NULL,                    -- human sentence shown in UI
  model TEXT, tokens_in INTEGER, tokens_out INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
  type TEXT NOT NULL,                      -- transcribe|score|pass|render|shorts|tts|frames
  ref_id TEXT, state TEXT NOT NULL DEFAULT 'queued',
  pct INTEGER NOT NULL DEFAULT 0, stage_label TEXT,   -- "reading it for meaning"
  queued_overnight INTEGER NOT NULL DEFAULT 0,
  error TEXT, started_at INTEGER, finished_at INTEGER, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_by_user ON jobs(user_id, created_at);
CREATE INDEX IF NOT EXISTS jobs_by_ref ON jobs(ref_id);

-- one row per finished unit of work. This is the cost panel's only source.
-- A job that does not write one of these is a bug (04-API-AND-JOBS.md).
CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, job_id TEXT, job_type TEXT NOT NULL,
  source_minutes REAL DEFAULT 0,
  cpu_ms INTEGER DEFAULT 0, gpu_ms INTEGER DEFAULT 0,
  tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0,
  bytes_stored INTEGER DEFAULT 0, bytes_delivered INTEGER DEFAULT 0,
  stream_minutes_stored REAL DEFAULT 0, stream_minutes_delivered REAL DEFAULT 0,
  unit_prices TEXT NOT NULL,               -- JSON: prices AT THE TIME, so history stays true
  cost_usd REAL NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS usage_by_user_month ON usage_events(user_id, created_at);

CREATE TABLE IF NOT EXISTS trash (        -- the deleted pile in Settings
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT NOT NULL,
  label TEXT NOT NULL, payload TEXT NOT NULL, deleted_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS trash_by_user ON trash(user_id, deleted_at);
