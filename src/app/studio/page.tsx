"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Project } from "@/types/studio";

const TYPE_LABELS: Record<string, string> = {
  music_video: "Music Video",
  short_film: "Short Film",
  commercial: "Commercial",
  cinematic: "Cinematic",
};

const STATUS_COLORS: Record<string, string> = {
  concept: "bg-zinc-700 text-zinc-300",
  pre_production: "bg-blue-900 text-blue-300",
  production: "bg-yellow-900 text-yellow-300",
  post_production: "bg-purple-900 text-purple-300",
  completed: "bg-green-900 text-green-300",
};

export default function StudioPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data) => {
        setProjects(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Nav */}
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <Link href="/" className="text-lg font-bold tracking-tight">
          Aldershot
        </Link>
        <Link
          href="/studio/new"
          className="px-4 py-2 bg-white text-black text-sm font-semibold rounded-full hover:bg-zinc-100 transition-colors"
        >
          + New Project
        </Link>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold mb-8">Projects</h1>

        {loading && (
          <div className="text-zinc-500 text-sm">Loading projects...</div>
        )}

        {!loading && projects.length === 0 && (
          <div className="text-center py-24 text-zinc-600">
            <p className="text-lg mb-4">No projects yet.</p>
            <Link
              href="/studio/new"
              className="text-white underline underline-offset-4"
            >
              Create your first project
            </Link>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <Link
              key={p.id}
              href={`/studio/${p.id}`}
              className="block border border-zinc-800 rounded-xl p-5 hover:border-zinc-600 transition-colors group"
            >
              <div className="flex items-start justify-between mb-3">
                <span className="text-xs text-zinc-500">{TYPE_LABELS[p.type] ?? p.type}</span>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[p.status] ?? "bg-zinc-700 text-zinc-300"}`}
                >
                  {p.status.replace("_", " ")}
                </span>
              </div>
              <h2 className="font-semibold text-white group-hover:text-zinc-200 mb-1 truncate">
                {p.title}
              </h2>
              {p.description && (
                <p className="text-zinc-500 text-sm line-clamp-2">{p.description}</p>
              )}
              <div className="mt-3 text-xs text-zinc-600">
                {new Date(p.created_at).toLocaleDateString()}
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
