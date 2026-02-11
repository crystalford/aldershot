import { createClient } from "@supabase/supabase-js";

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
}

// Server-side client with service role (for pipeline operations)
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Update job status in the database
export async function updateJobStatus(
  jobId: string,
  status: string,
  data?: Record<string, unknown>
) {
  const { error } = await supabase
    .from("video_jobs")
    .update({ status, ...data, updated_at: new Date().toISOString() })
    .eq("id", jobId);

  if (error) throw new Error(`Failed to update job ${jobId}: ${error.message}`);
}
