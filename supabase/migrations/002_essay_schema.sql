-- Phase 1: Video Essay Engine schema additions

-- Extend projects.type to include video_essay
-- (Supabase CHECK constraints need recreating; drop + re-add the column constraint via a new check)
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_type_check;
ALTER TABLE projects ADD CONSTRAINT projects_type_check
  CHECK (type IN ('music_video', 'short_film', 'commercial', 'cinematic', 'video_essay'));

-- Transcripts (word-level timestamps from Deepgram)
CREATE TABLE IF NOT EXISTS transcripts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  audio_url TEXT NOT NULL,
  duration_seconds NUMERIC(10, 2),
  words JSONB NOT NULL DEFAULT '[]',  -- [{word, start, end, confidence, punctuated_word}]
  full_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transcripts_project ON transcripts (project_id);

-- Resource Library (user-uploaded assets: images, clips, screenshots, memes)
CREATE TABLE IF NOT EXISTS resources (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('image', 'video', 'audio')),
  url TEXT,
  storage_path TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  file_size_bytes INTEGER,
  duration_seconds NUMERIC(10, 2),  -- for video/audio
  description TEXT,                  -- Claude Vision description
  tags JSONB NOT NULL DEFAULT '[]',  -- semantic tags array
  mood TEXT,
  subjects TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_resources_project ON resources (project_id);
CREATE INDEX IF NOT EXISTS idx_resources_type ON resources (project_id, type);

-- Visual Assignments (maps visuals to transcript word ranges per scene)
CREATE TABLE IF NOT EXISTS visual_assignments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  scene_id UUID NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('hero_image', 'resource', 'text_card', 'ai_fill', 'animated_clip')),
  asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
  resource_id UUID REFERENCES resources(id) ON DELETE SET NULL,
  text_content TEXT,               -- for text_card type
  start_word_index INTEGER,        -- maps to transcript.words array index
  end_word_index INTEGER,
  start_seconds NUMERIC(10, 3),    -- derived from word timestamps
  end_seconds NUMERIC(10, 3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_visual_assignments_scene ON visual_assignments (scene_id, order_index);
