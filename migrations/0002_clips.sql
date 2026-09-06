-- Aldershot clip library — persistent, cross-project "Lego pieces" cut from any
-- video in any project. A clip is one-or-more ordered segments (a callback that
-- spans two far-apart moments is ONE clip with two segments, matching how
-- EditSuggestion.segments already works elsewhere in this codebase). Tags are a
-- join table (not a JSON column) for indexed exact-match filtering and a
-- trivial GROUP BY for the tag cloud. No FK constraints, consistent with
-- projects/videos above — deletes are explicit (see deleteClip in src/clips.ts).
-- (Also created lazily by ensureClipSchema in src/clips.ts, so local dev works
-- without applying migrations; run this against prod D1.)

CREATE TABLE IF NOT EXISTS clips (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT,
  kind        TEXT NOT NULL DEFAULT 'manual', -- 'manual' | 'ai-detected'
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS clip_segments (
  id         TEXT PRIMARY KEY,
  clip_id    TEXT NOT NULL,
  project_id TEXT NOT NULL,   -- resolved server-side from the video, never trusted client input
  video_id   TEXT NOT NULL,
  "start"    REAL NOT NULL,
  "end"      REAL NOT NULL,
  ord        INTEGER NOT NULL DEFAULT 0,
  reason     TEXT
);
CREATE INDEX IF NOT EXISTS idx_clip_segments_clip    ON clip_segments (clip_id, ord);
CREATE INDEX IF NOT EXISTS idx_clip_segments_video   ON clip_segments (video_id);
CREATE INDEX IF NOT EXISTS idx_clip_segments_project ON clip_segments (project_id);

CREATE TABLE IF NOT EXISTS clip_tags (
  clip_id TEXT NOT NULL,
  tag     TEXT NOT NULL,   -- normalized: trim + lowercase at write time
  PRIMARY KEY (clip_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_clip_tags_tag ON clip_tags (tag);
