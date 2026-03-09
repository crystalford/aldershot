import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { tasks } from "@trigger.dev/sdk/v3";

export async function POST(req: Request) {
  const body: { project_id: string; audio_url: string } = await req.json();

  if (!body.project_id || !body.audio_url) {
    return NextResponse.json({ error: "project_id and audio_url are required" }, { status: 400 });
  }

  const { data: job, error: jobError } = await supabase
    .from("production_jobs")
    .insert({
      project_id: body.project_id,
      type: "transcribe_audio",
      status: "pending",
      input: body as Record<string, unknown>,
    })
    .select()
    .single();

  if (jobError) return NextResponse.json({ error: jobError.message }, { status: 500 });

  const handle = await tasks.trigger("transcribe-audio", {
    job_id: job.id,
    input: body,
  });

  await supabase
    .from("production_jobs")
    .update({ trigger_run_id: handle.id })
    .eq("id", job.id);

  return NextResponse.json({ job_id: job.id, run_id: handle.id }, { status: 202 });
}
