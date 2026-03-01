"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ProjectType } from "@/types/studio";

const PROJECT_TYPES: { value: ProjectType; label: string; desc: string }[] = [
  { value: "music_video", label: "Music Video", desc: "Sync visuals to a track" },
  { value: "short_film", label: "Short Film", desc: "Narrative under 40 minutes" },
  { value: "cinematic", label: "Cinematic", desc: "Feature or episodic content" },
  { value: "commercial", label: "Commercial", desc: "Brand or product film" },
];

const ASPECT_RATIOS = ["16:9", "9:16", "4:3", "2.35:1", "1:1"];

export default function NewProjectPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    title: "",
    type: "music_video" as ProjectType,
    description: "",
    genre: "",
    style: "",
    aspect_ratio: "16:9",
    duration_seconds: "" as string | number,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title) return;
    setLoading(true);
    setError("");

    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        duration_seconds: form.duration_seconds ? Number(form.duration_seconds) : undefined,
      }),
    });

    if (!res.ok) {
      const d = await res.json();
      setError(d.error ?? "Failed to create project");
      setLoading(false);
      return;
    }

    const project = await res.json();
    router.push(`/studio/${project.id}`);
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center gap-4">
        <Link href="/studio" className="text-zinc-500 hover:text-white text-sm transition-colors">
          ← Studio
        </Link>
        <span className="text-zinc-700">/</span>
        <span className="text-sm">New Project</span>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold mb-8">New Project</h1>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Project Type */}
          <div>
            <label className="block text-sm text-zinc-400 mb-3">Project Type</label>
            <div className="grid grid-cols-2 gap-3">
              {PROJECT_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, type: t.value }))}
                  className={`text-left p-4 rounded-xl border transition-colors ${
                    form.type === t.value
                      ? "border-white bg-zinc-900"
                      : "border-zinc-800 hover:border-zinc-600"
                  }`}
                >
                  <div className="font-medium text-sm mb-0.5">{t.label}</div>
                  <div className="text-xs text-zinc-500">{t.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="block text-sm text-zinc-400 mb-2">Title *</label>
            <input
              required
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Neon Rainfall"
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm text-zinc-400 mb-2">
              Concept / Description
            </label>
            <textarea
              rows={3}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Describe the story, mood, or concept..."
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-none"
            />
          </div>

          {/* Genre + Style */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-zinc-400 mb-2">Genre</label>
              <input
                value={form.genre}
                onChange={(e) => setForm((f) => ({ ...f, genre: e.target.value }))}
                placeholder="e.g. sci-fi, noir, romance"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-2">Visual Style</label>
              <input
                value={form.style}
                onChange={(e) => setForm((f) => ({ ...f, style: e.target.value }))}
                placeholder="e.g. vibrant, moody, minimalist"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
              />
            </div>
          </div>

          {/* Aspect Ratio + Duration */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-zinc-400 mb-2">Aspect Ratio</label>
              <select
                value={form.aspect_ratio}
                onChange={(e) => setForm((f) => ({ ...f, aspect_ratio: e.target.value }))}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-zinc-500"
              >
                {ASPECT_RATIOS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-2">
                Duration (seconds)
              </label>
              <input
                type="number"
                min="1"
                value={form.duration_seconds}
                onChange={(e) => setForm((f) => ({ ...f, duration_seconds: e.target.value }))}
                placeholder="e.g. 210"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
              />
            </div>
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading || !form.title}
            className="w-full py-3 bg-white text-black font-semibold rounded-full hover:bg-zinc-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Creating..." : "Create Project"}
          </button>
        </form>
      </main>
    </div>
  );
}
