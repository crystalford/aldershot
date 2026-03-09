import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import type { Resource } from "@/types/studio";

// GET /api/resources?project_id=xxx&type=image
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const project_id = searchParams.get("project_id");
  const type = searchParams.get("type");

  if (!project_id) {
    return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  }

  let query = supabase
    .from("resources")
    .select("*")
    .eq("project_id", project_id)
    .order("created_at", { ascending: false });

  if (type) {
    query = query.eq("type", type);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data as Resource[]);
}

// POST /api/resources — register a resource (after client-side upload to Supabase Storage)
export async function POST(req: Request) {
  const body: {
    project_id: string;
    type: "image" | "video" | "audio";
    storage_path: string;
    url?: string;
    original_filename: string;
    file_size_bytes?: number;
    duration_seconds?: number;
    description?: string;
    tags?: string[];
    mood?: string;
    subjects?: string[];
  } = await req.json();

  if (!body.project_id || !body.type || !body.storage_path || !body.original_filename) {
    return NextResponse.json(
      { error: "project_id, type, storage_path, and original_filename are required" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("resources")
    .insert({
      project_id: body.project_id,
      type: body.type,
      storage_path: body.storage_path,
      url: body.url,
      original_filename: body.original_filename,
      file_size_bytes: body.file_size_bytes,
      duration_seconds: body.duration_seconds,
      description: body.description,
      tags: body.tags ?? [],
      mood: body.mood,
      subjects: body.subjects,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data as Resource, { status: 201 });
}

// DELETE /api/resources?id=xxx
export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const { error } = await supabase.from("resources").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return new NextResponse(null, { status: 204 });
}
