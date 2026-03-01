import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import type { CreateProjectInput } from "@/types/studio";

export async function GET() {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  const body: CreateProjectInput = await req.json();

  if (!body.title || !body.type) {
    return NextResponse.json({ error: "title and type are required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("projects")
    .insert({
      title: body.title,
      type: body.type,
      description: body.description,
      genre: body.genre,
      style: body.style,
      aspect_ratio: body.aspect_ratio ?? "16:9",
      duration_seconds: body.duration_seconds,
      status: "concept",
      metadata: {},
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
