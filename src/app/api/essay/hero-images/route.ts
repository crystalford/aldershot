import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { tasks } from "@trigger.dev/sdk/v3";

export async function POST(req: Request) {
  const body: {
    project_id: string;
    scene_ids: string[];
    aspect_ratio?: "16:9" | "9:16" | "1:1" | "4:3" | "3:2";
  } = await req.json();

  if (!body.project_id || !body.scene_ids?.length) {
    return NextResponse.json(
      { error: "project_id and scene_ids are required" },
      { status: 400 }
    );
  }

  const { data: job, error: jobError } = await supabase
    .from("production_jobs")
    .insert({
      project_id: body.project_id,
      type: "generate_hero_images",
      status: "pending",
      input: body as Record<string, unknown>,
    })
    .select()
    .single();

  if (jobError) return NextResponse.json({ error: jobError.message }, { status: 500 });

  const handle = await tasks.trigger("generate-hero-images", {
    job_id: job.id,
    input: body,
  });

  await supabase
    .from("production_jobs")
    .update({ trigger_run_id: handle.id })
    .eq("id", job.id);

  return NextResponse.json({ job_id: job.id, run_id: handle.id }, { status: 202 });
}
