// ─── Project ────────────────────────────────────────────────────────────────

export type ProjectType = "music_video" | "short_film" | "commercial" | "cinematic" | "video_essay";

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
  scene_id?: string;
  type: AssetType;
  url?: string;
  storage_path?: string;
  generator?: string;
  prompt?: string;
  metadata: Record<string, unknown>;
  status: AssetStatus;
  hero?: boolean; // marks this as the anchor/reference image for a scene
  approved?: boolean;
  created_at: string;
}

// ─── Production Job ───────────────────────────────────────────────────────────

export type JobType =
  | "generate_script"
  | "generate_storyboard"
  | "generate_shots"
  | "generate_shot_image"
  | "render_sequence"
  | "transcribe_audio"
  | "segment_transcript"
  | "generate_hero_images"
  | "generate_ai_fill"
  | "animate_hero_image"
  | "render_video_essay";

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

// ─── Transcript ───────────────────────────────────────────────────────────────

export interface TranscriptWord {
  word: string;
  punctuated_word: string;
  start: number; // seconds
  end: number;   // seconds
  confidence: number;
}

export interface Transcript {
  id: string;
  project_id: string;
  audio_url: string;
  duration_seconds: number;
  words: TranscriptWord[];
  full_text: string;
  created_at: string;
}

// ─── Resource Library ─────────────────────────────────────────────────────────

export type ResourceType = "image" | "video" | "audio";

export interface Resource {
  id: string;
  project_id: string;
  type: ResourceType;
  url?: string;
  storage_path: string;
  original_filename: string;
  file_size_bytes?: number;
  duration_seconds?: number;
  description?: string;
  tags: string[];
  mood?: string;
  subjects?: string[];
  created_at: string;
}

// ─── Visual Assignment ────────────────────────────────────────────────────────

export type VisualAssignmentType =
  | "hero_image"
  | "resource"
  | "text_card"
  | "ai_fill"
  | "animated_clip";

export interface VisualAssignment {
  id: string;
  scene_id: string;
  order_index: number;
  type: VisualAssignmentType;
  asset_id?: string;
  resource_id?: string;
  text_content?: string;
  start_word_index?: number;
  end_word_index?: number;
  start_seconds?: number;
  end_seconds?: number;
  created_at: string;
}

// ─── Video Essay ──────────────────────────────────────────────────────────────

export type EssayStyle =
  | "documentary"
  | "explainer"
  | "cinematic"
  | "illustrated"
  | "dark-academia"
  | "minimal";

export interface EssaySegment {
  scene_number: number;
  title: string;
  topic: string;
  visual_concept: string;
  visual_type: "generated_image" | "text_card" | "user_resource";
  mood: string;
  color_direction: string;
  start_word_index: number;
  end_word_index: number;
  order_index: number;
}

export interface CreateEssayInput {
  title: string;
  description?: string;
  style: EssayStyle;
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
  lyrics?: string;
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
