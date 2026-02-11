-- Aldershot Video Pipeline Schema

-- Monitored YouTube channels
CREATE TABLE IF NOT EXISTS monitored_channels (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  youtube_channel_id TEXT UNIQUE NOT NULL,
  channel_name TEXT NOT NULL,
  webhook_active BOOLEAN DEFAULT true,
  last_video_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Video processing jobs
CREATE TABLE IF NOT EXISTS video_jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  youtube_video_id TEXT NOT NULL,
  youtube_channel_id TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  video_title TEXT NOT NULL,
  video_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  transcript TEXT,
  analysis JSONB,
  clip_url TEXT,
  article JSONB,
  x_post JSONB,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for dedup checks
CREATE UNIQUE INDEX IF NOT EXISTS idx_video_jobs_video_id ON video_jobs (youtube_video_id);

-- Index for status queries
CREATE INDEX IF NOT EXISTS idx_video_jobs_status ON video_jobs (status);

-- Index for channel lookups
CREATE INDEX IF NOT EXISTS idx_video_jobs_channel ON video_jobs (youtube_channel_id);

-- RLS policies (enable if needed)
-- ALTER TABLE monitored_channels ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE video_jobs ENABLE ROW LEVEL SECURITY;
