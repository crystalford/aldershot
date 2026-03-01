-- Aldershot AI Film Studio Schema

-- Projects
CREATE TABLE IF NOT EXISTS projects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('music_video', 'short_film', 'commercial', 'cinematic')),
  description TEXT,
  status TEXT NOT NULL DEFAULT 'concept'
    CHECK (status IN ('concept', 'pre_production', 'production', 'post_production', 'completed')),
  genre TEXT,
  style TEXT,
  aspect_ratio TEXT NOT NULL DEFAULT '16:9',
  duration_seconds INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Scripts / Screenplays
CREATE TABLE IF NOT EXISTS scripts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  content TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'plain' CHECK (format IN ('fountain', 'plain')),
  ai_generated BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Scenes
CREATE TABLE IF NOT EXISTS scenes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  script_id UUID REFERENCES scripts(id) ON DELETE SET NULL,
  scene_number INTEGER NOT NULL,
  title TEXT,
  description TEXT,
  location TEXT,
  time_of_day TEXT CHECK (time_of_day IN ('day', 'night', 'dusk', 'dawn', 'interior')),
  mood TEXT,
  color_palette TEXT[],
  duration_seconds INTEGER,
  order_index INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Shots (within scenes)
CREATE TABLE IF NOT EXISTS shots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  scene_id UUID NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  shot_number INTEGER NOT NULL,
  shot_type TEXT,
  camera_angle TEXT,
  camera_movement TEXT,
  description TEXT,
  prompt TEXT,
  duration_seconds NUMERIC(6, 2),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'generating', 'generated', 'approved', 'rejected')),
  order_index INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Assets (generated images, video clips, audio)
CREATE TABLE IF NOT EXISTS assets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  shot_id UUID REFERENCES shots(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('image', 'video', 'audio', 'storyboard_frame')),
  url TEXT,
  storage_path TEXT,
  generator TEXT,
  prompt TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'generating', 'ready', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Production Jobs (background Trigger.dev tasks)
CREATE TABLE IF NOT EXISTS production_jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN (
    'generate_script', 'generate_storyboard', 'generate_shots',
    'generate_shot_image', 'render_sequence'
  )),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  input JSONB NOT NULL DEFAULT '{}',
  output JSONB,
  error TEXT,
  trigger_run_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_scripts_project ON scripts (project_id);
CREATE INDEX IF NOT EXISTS idx_scenes_project ON scenes (project_id);
CREATE INDEX IF NOT EXISTS idx_scenes_order ON scenes (project_id, order_index);
CREATE INDEX IF NOT EXISTS idx_shots_scene ON shots (scene_id, order_index);
CREATE INDEX IF NOT EXISTS idx_assets_project ON assets (project_id);
CREATE INDEX IF NOT EXISTS idx_assets_shot ON assets (shot_id);
CREATE INDEX IF NOT EXISTS idx_jobs_project ON production_jobs (project_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON production_jobs (status);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER production_jobs_updated_at
  BEFORE UPDATE ON production_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
