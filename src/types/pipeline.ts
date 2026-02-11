export interface VideoJob {
  id: string;
  youtube_video_id: string;
  youtube_channel_id: string;
  channel_name: string;
  video_title: string;
  video_url: string;
  status: JobStatus;
  transcript?: string;
  analysis?: ClipAnalysis;
  clip_url?: string;
  article?: GeneratedArticle;
  x_post?: GeneratedXPost;
  error?: string;
  created_at: string;
  updated_at: string;
}

export type JobStatus =
  | "pending"
  | "fetching_transcript"
  | "analyzing"
  | "extracting_clip"
  | "rendering"
  | "publishing"
  | "completed"
  | "failed";

export interface ClipAnalysis {
  best_moment: {
    start_seconds: number;
    end_seconds: number;
    duration_seconds: number;
    summary: string;
    why_viral: string;
  };
  article_headline: string;
  article_body: string;
  x_post_text: string;
  hashtags: string[];
}

export interface GeneratedArticle {
  headline: string;
  body: string;
  clip_embed_url?: string;
  published_url?: string;
}

export interface GeneratedXPost {
  text: string;
  video_media_id?: string;
  posted_url?: string;
}

export interface MonitoredChannel {
  id: string;
  youtube_channel_id: string;
  channel_name: string;
  webhook_active: boolean;
  last_video_at?: string;
  created_at: string;
}

export interface TranscriptSegment {
  text: string;
  start: number;
  duration: number;
}

export interface ApifyClipResult {
  clip_url: string;
  resolution: string;
  duration_seconds: number;
  file_size_bytes?: number;
}
