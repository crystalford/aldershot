"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { EssayStyle } from "@/types/studio";

const STYLES: { value: EssayStyle; label: string; desc: string }[] = [
  { value: "documentary", label: "Documentary", desc: "Observational, archival feel" },
  { value: "explainer", label: "Explainer", desc: "Clean, educational visuals" },
  { value: "cinematic", label: "Cinematic", desc: "Film-quality, moody imagery" },
  { value: "illustrated", label: "Illustrated", desc: "Graphic, illustrated aesthetic" },
  { value: "dark-academia", label: "Dark Academia", desc: "Scholarly, gothic atmosphere" },
  { value: "minimal", label: "Minimal", desc: "Stark, typographic focus" },
];

export default function NewEssayPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    title: "",
    description: "",
    style: "cinematic" as EssayStyle,
    audio_url: "",
    aspect_ratio: "16:9",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title || !form.audio_url) return;
    setLoading(true);
    setError("");

    // 1. Create project
    const projRes = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: form.title,
        description: form.description,
        type: "video_essay",
        style: form.style,
        aspect_ratio: form.aspect_ratio,
      }),
    });

    if (!projRes.ok) {
      const d = await projRes.json();
      setError(d.error ?? "Failed to create project");
      setLoading(false);
      return;
    }

    const project = await projRes.json();

    // 2. Kick off transcription immediately
    const txRes = await fetch("/api/essay/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: project.id, audio_url: form.audio_url }),
    });

    if (!txRes.ok) {
      // Still navigate — user can retry transcription from workspace
      router.push(`/essay/${project.id}`);
      return;
    }

    router.push(`/essay/${project.id}`);
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center gap-4">
        <Link href="/studio" className="text-zinc-500 hover:text-white text-sm transition-colors">
          ← Studio
        </Link>
        <span className="text-zinc-700">/</span>
        <span className="text-sm">New Video Essay</span>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold mb-2">New Video Essay</h1>
        <p className="text-zinc-500 text-sm mb-8">
          Upload or link your narration audio. Aldershot will transcribe it, segment it into
          visual scenes, and generate hero images.
        </p>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Title */}
          <div>
            <label className="block text-sm text-zinc-400 mb-2">Essay Title *</label>
            <input
              required
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. The Death of Expertise"
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
            />
          </div>

          {/* Audio URL */}
          <div>
            <label className="block text-sm text-zinc-400 mb-2">Audio URL *</label>
            <input
              required
              type="url"
              value={form.audio_url}
              onChange={(e) => setForm((f) => ({ ...f, audio_url: e.target.value }))}
              placeholder="https://... (mp3, wav, m4a, flac)"
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
            />
            <p className="text-xs text-zinc-600 mt-1">
              Publicly accessible URL to your narration file. Deepgram supports mp3, wav, m4a, flac.
            </p>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm text-zinc-400 mb-2">Description</label>
            <textarea
              rows={2}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="What is this essay about?"
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-none"
            />
          </div>

          {/* Style */}
          <div>
            <label className="block text-sm text-zinc-400 mb-3">Visual Style</label>
            <div className="grid grid-cols-2 gap-3">
              {STYLES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, style: s.value }))}
                  className={`text-left p-4 rounded-xl border transition-colors ${
                    form.style === s.value
                      ? "border-white bg-zinc-900"
                      : "border-zinc-800 hover:border-zinc-600"
                  }`}
                >
                  <div className="font-medium text-sm mb-0.5">{s.label}</div>
                  <div className="text-xs text-zinc-500">{s.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Aspect Ratio */}
          <div>
            <label className="block text-sm text-zinc-400 mb-2">Aspect Ratio</label>
            <select
              value={form.aspect_ratio}
              onChange={(e) => setForm((f) => ({ ...f, aspect_ratio: e.target.value }))}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-zinc-500"
            >
              <option value="16:9">16:9 — Widescreen</option>
              <option value="9:16">9:16 — Vertical / Shorts</option>
              <option value="1:1">1:1 — Square</option>
              <option value="4:3">4:3 — Classic</option>
            </select>
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading || !form.title || !form.audio_url}
            className="w-full py-3 bg-white text-black font-semibold rounded-full hover:bg-zinc-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Creating & Transcribing..." : "Create Essay"}
          </button>
        </form>
      </main>
    </div>
  );
}
