import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { tasks } from "@trigger.dev/sdk/v3";
import type { GenerateStoryboardInput } from "@/types/studio";

export async function POST(req: Request) {
  const body: GenerateStoryboardInput & { project_type: string; project_style?: string } =
    await req.json();

  if (!body.project_id || !body.script_id) {
    return NextResponse.json({ error: "project_id and script_id are required" }, { status: 400 });
  }

  const { data: job, error: jobError } = await supabase
    .from("production_jobs")
    .insert({
      project_id: body.project_id,
      type: "generate_storyboard",
      status: "pending",
      input: body as Record<string, unknown>,
    })
    .select()
    .single();

  if (jobError) return NextResponse.json({ error: jobError.message }, { status: 500 });

  const handle = await tasks.trigger("generate-storyboard", {
    job_id: job.id,
    input: body,
  });

  await supabase
    .from("production_jobs")
    .update({ trigger_run_id: handle.id })
    .eq("id", job.id);

  return NextResponse.json({ job_id: job.id, run_id: handle.id }, { status: 202 });
}
