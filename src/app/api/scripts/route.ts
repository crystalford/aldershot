import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { tasks } from "@trigger.dev/sdk/v3";
import type { GenerateScriptInput } from "@/types/studio";

export async function POST(req: Request) {
  const body: GenerateScriptInput = await req.json();

  if (!body.project_id) {
    return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  }

  // Create a production job record
  const { data: job, error: jobError } = await supabase
    .from("production_jobs")
    .insert({
      project_id: body.project_id,
      type: "generate_script",
      status: "pending",
      input: body as Record<string, unknown>,
    })
    .select()
    .single();

  if (jobError) return NextResponse.json({ error: jobError.message }, { status: 500 });

  // Fire off the Trigger.dev task
  const handle = await tasks.trigger("generate-script", {
    job_id: job.id,
    input: body,
  });

  // Store the run ID
  await supabase
    .from("production_jobs")
    .update({ trigger_run_id: handle.id })
    .eq("id", job.id);

  return NextResponse.json({ job_id: job.id, run_id: handle.id }, { status: 202 });
}
