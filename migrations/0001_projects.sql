-- Aldershot projects + videos. (Also created lazily by ensureSchema in src/db.ts,
-- so local dev works without applying migrations; run this against prod D1.)
CREATE TABLE IF NOT EXISTS projects (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS videos (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  filename   TEXT NOT NULL,
  r2_key     TEXT NOT NULL,
  duration   REAL,
  status     TEXT NOT NULL DEFAULT 'uploaded',
  ord        INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_videos_project ON videos (project_id, ord);
