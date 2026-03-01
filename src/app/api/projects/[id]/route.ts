import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [{ data: project, error: pErr }, { data: scripts }, { data: scenes }, { data: jobs }] =
    await Promise.all([
      supabase.from("projects").select("*").eq("id", id).single(),
      supabase.from("scripts").select("*").eq("project_id", id).order("version", { ascending: false }),
      supabase.from("scenes").select("*, shots(*)").eq("project_id", id).order("order_index"),
      supabase.from("production_jobs").select("*").eq("project_id", id).order("created_at", { ascending: false }),
    ]);

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 404 });

  return NextResponse.json({ project, scripts: scripts ?? [], scenes: scenes ?? [], jobs: jobs ?? [] });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  const { data, error } = await supabase
    .from("projects")
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
