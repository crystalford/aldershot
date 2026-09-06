-- Aldershot visual tags — what's actually ON SCREEN at a moment in a video,
-- as a sibling to that video's spoken transcript rather than something owned
-- by any one clip. A clip that later references an overlapping time range
-- picks these up for free (see clips.ts's attachSegmentsAndTags). Populated
-- via Moondream 3.1 (Workers AI) against a handful of keyframes captured
-- client-side whenever a clip gets saved to the Library — not run blindly
-- over whole source videos in the background.
-- (Also created lazily by ensureVisualTagSchema in src/visualtags.ts, so
-- local dev works without applying migrations; run this against prod D1.)

CREATE TABLE IF NOT EXISTS visual_tags (
  id         TEXT PRIMARY KEY,
  video_id   TEXT NOT NULL,
  project_id TEXT NOT NULL,
  "time"     REAL NOT NULL,
  caption    TEXT,
  ocr_text   TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_visual_tags_video ON visual_tags (video_id, "time");
