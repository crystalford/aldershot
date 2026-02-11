import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/**
 * Get pipeline job status.
 * GET /api/pipeline/status?id=JOB_ID - single job
 * GET /api/pipeline/status - all recent jobs
 */
export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("id");

  if (jobId) {
    const { data, error } = await supabase
      .from("video_jobs")
      .select("*")
      .eq("id", jobId)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    return NextResponse.json(data);
  }

  // Return recent jobs
  const { data, error } = await supabase
    .from("video_jobs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json(
      { error: "Failed to fetch jobs" },
      { status: 500 }
    );
  }

  return NextResponse.json(data);
}
