// ─── Project ────────────────────────────────────────────────────────────────

export type ProjectType = "music_video" | "short_film" | "commercial" | "cinematic";

export type ProjectStatus =
  | "concept"
  | "pre_production"
  | "production"
  | "post_production"
  | "completed";

export interface Project {
  id: string;
  title: string;
  type: ProjectType;
  description?: string;
  status: ProjectStatus;
  genre?: string;
  style?: string;
  aspect_ratio: string;
  duration_seconds?: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CreateProjectInput {
  title: string;
  type: ProjectType;
  description?: string;
  genre?: string;
  style?: string;
  aspect_ratio?: string;
  duration_seconds?: number;
}

// ─── Script ─────────────────────────────────────────────────────────────────

export interface Script {
  id: string;
  project_id: string;
  version: number;
  content: string;
  format: "fountain" | "plain";
  ai_generated: boolean;
  created_at: string;
}

// ─── Scene ───────────────────────────────────────────────────────────────────

export type TimeOfDay = "day" | "night" | "dusk" | "dawn" | "interior";

export interface Scene {
  id: string;
  project_id: string;
  script_id?: string;
  scene_number: number;
  title?: string;
  description?: string;
  location?: string;
  time_of_day?: TimeOfDay;
  mood?: string;
  color_palette?: string[];
  duration_seconds?: number;
  order_index: number;
  created_at: string;
}

// ─── Shot ────────────────────────────────────────────────────────────────────

export type ShotType =
  | "extreme-wide"
  | "wide"
  | "medium-wide"
  | "medium"
  | "medium-close"
  | "close-up"
  | "extreme-close-up"
  | "insert"
  | "aerial"
  | "pov";

export type CameraAngle =
  | "eye-level"
  | "low-angle"
  | "high-angle"
  | "dutch"
  | "birds-eye"
  | "worms-eye";

export type CameraMovement =
  | "static"
  | "pan"
  | "tilt"
  | "dolly-in"
  | "dolly-out"
  | "tracking"
  | "crane"
  | "handheld"
  | "steadicam";

export type ShotStatus = "draft" | "generating" | "generated" | "approved" | "rejected";

export interface Shot {
  id: string;
  scene_id: string;
  shot_number: number;
  shot_type?: ShotType;
  camera_angle?: CameraAngle;
  camera_movement?: CameraMovement;
  description?: string;
  prompt?: string;
  duration_seconds?: number;
  status: ShotStatus;
  order_index: number;
  created_at: string;
}

// ─── Asset ───────────────────────────────────────────────────────────────────

export type AssetType = "image" | "video" | "audio" | "storyboard_frame";
export type AssetStatus = "pending" | "generating" | "ready" | "failed";

export interface Asset {
  id: string;
  project_id: string;
  shot_id?: string;
  type: AssetType;
  url?: string;
  storage_path?: string;
  generator?: string;
  prompt?: string;
  metadata: Record<string, unknown>;
  status: AssetStatus;
  created_at: string;
}

// ─── Production Job ───────────────────────────────────────────────────────────

export type JobType =
  | "generate_script"
  | "generate_storyboard"
  | "generate_shots"
  | "generate_shot_image"
  | "render_sequence";

export type JobStatus = "pending" | "running" | "completed" | "failed";

export interface ProductionJob {
  id: string;
  project_id: string;
  type: JobType;
  status: JobStatus;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  trigger_run_id?: string;
  created_at: string;
  updated_at: string;
}

// ─── AI generation payloads ───────────────────────────────────────────────────

export interface GenerateScriptInput {
  project_id: string;
  title: string;
  type: ProjectType;
  description?: string;
  genre?: string;
  style?: string;
  duration_seconds?: number;
  lyrics?: string; // for music videos
}

export interface GenerateStoryboardInput {
  project_id: string;
  script_id: string;
  num_scenes?: number;
}

export interface GenerateShotsInput {
  project_id: string;
  scene_id: string;
  num_shots?: number;
}

export interface GeneratedScript {
  content: string;
  format: "fountain" | "plain";
  scene_count: number;
  summary: string;
}

export interface GeneratedScene {
  scene_number: number;
  title: string;
  description: string;
  location: string;
  time_of_day: TimeOfDay;
  mood: string;
  color_palette: string[];
  duration_seconds: number;
  order_index: number;
}

export interface GeneratedShot {
  shot_number: number;
  shot_type: ShotType;
  camera_angle: CameraAngle;
  camera_movement: CameraMovement;
  description: string;
  prompt: string;
  duration_seconds: number;
  order_index: number;
}
