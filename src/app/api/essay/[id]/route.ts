import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [
    { data: project, error: pErr },
    { data: transcripts },
    { data: scenes },
    { data: jobs },
    { data: assets },
  ] = await Promise.all([
    supabase.from("projects").select("*").eq("id", id).single(),
    supabase.from("transcripts").select("*").eq("project_id", id).order("created_at", { ascending: false }).limit(1),
    supabase.from("scenes").select("*").eq("project_id", id).order("order_index"),
    supabase.from("production_jobs").select("*").eq("project_id", id).order("created_at", { ascending: false }),
    supabase.from("assets").select("*").eq("project_id", id).eq("hero", true).order("created_at"),
  ]);

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 404 });

  return NextResponse.json({
    project,
    transcript: transcripts?.[0] ?? null,
    scenes: scenes ?? [],
    jobs: jobs ?? [],
    heroAssets: assets ?? [],
  });
}
