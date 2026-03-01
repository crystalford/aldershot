"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import type { Project, Script, Scene, ProductionJob } from "@/types/studio";

interface ProjectDetail {
  project: Project;
  scripts: Script[];
  scenes: (Scene & { shots: unknown[] })[];
  jobs: ProductionJob[];
}

const STATUS_COLORS: Record<string, string> = {
  concept: "text-zinc-400",
  pre_production: "text-blue-400",
  production: "text-yellow-400",
  post_production: "text-purple-400",
  completed: "text-green-400",
};

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<string | null>(null);
  const [lyrics, setLyrics] = useState("");
  const [showLyrics, setShowLyrics] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/projects/${id}`)
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      });
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function generateScript() {
    if (!data) return;
    setGenerating("script");

    const res = await fetch("/api/scripts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: id,
        title: data.project.title,
        type: data.project.type,
        description: data.project.description,
        genre: data.project.genre,
        style: data.project.style,
        duration_seconds: data.project.duration_seconds,
        ...(data.project.type === "music_video" && lyrics ? { lyrics } : {}),
      }),
    });

    if (res.ok) {
      const { job_id } = await res.json();
      pollJob(job_id, () => {
        setGenerating(null);
        load();
      });
    } else {
      setGenerating(null);
    }
  }

  async function generateStoryboard(scriptId: string) {
    if (!data) return;
    setGenerating("storyboard");

    const res = await fetch("/api/storyboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: id,
        script_id: scriptId,
        project_type: data.project.type,
        project_style: data.project.style,
        num_scenes: 6,
      }),
    });

    if (res.ok) {
      const { job_id } = await res.json();
      pollJob(job_id, () => {
        setGenerating(null);
        load();
      });
    } else {
      setGenerating(null);
    }
  }

  async function generateShots(sceneId: string) {
    setGenerating(`shots-${sceneId}`);

    const res = await fetch("/api/shots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: id, scene_id: sceneId, num_shots: 5 }),
    });

    if (res.ok) {
      const { job_id } = await res.json();
      pollJob(job_id, () => {
        setGenerating(null);
        load();
      });
    } else {
      setGenerating(null);
    }
  }

  function pollJob(jobId: string, onDone: () => void) {
    const interval = setInterval(async () => {
      const r = await fetch(`/api/jobs/${jobId}`);
      const job = await r.json();
      if (job.status === "completed" || job.status === "failed") {
        clearInterval(interval);
        onDone();
      }
    }, 2000);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="text-zinc-500">Loading project...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="text-zinc-500">Project not found.</p>
      </div>
    );
  }

  const { project, scripts, scenes, jobs } = data;
  const latestScript = scripts[0];
  const activeJob = jobs.find((j) => j.status === "running" || j.status === "pending");

  return (
    <div className="min-h-screen bg-black text-white">
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center gap-4">
        <Link href="/studio" className="text-zinc-500 hover:text-white text-sm transition-colors">
          ← Studio
        </Link>
        <span className="text-zinc-700">/</span>
        <span className="text-sm truncate">{project.title}</span>
        <span className={`ml-auto text-xs ${STATUS_COLORS[project.status] ?? "text-zinc-400"}`}>
          {project.status.replace("_", " ")}
        </span>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10 space-y-10">
        {/* Project header */}
        <div>
          <div className="text-xs text-zinc-500 mb-1 uppercase tracking-widest">
            {project.type.replace("_", " ")}
            {project.genre ? ` · ${project.genre}` : ""}
            {project.style ? ` · ${project.style}` : ""}
            {project.aspect_ratio ? ` · ${project.aspect_ratio}` : ""}
          </div>
          <h1 className="text-4xl font-bold">{project.title}</h1>
          {project.description && (
            <p className="mt-2 text-zinc-400 max-w-xl">{project.description}</p>
          )}
        </div>

        {/* Active job notice */}
        {activeJob && (
          <div className="border border-yellow-800 bg-yellow-950/30 rounded-xl px-5 py-4 text-yellow-300 text-sm">
            Processing: <strong>{activeJob.type.replace(/_/g, " ")}</strong>...
          </div>
        )}

        {/* ── STEP 1: Script ── */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">1. Script</h2>
            {!latestScript && (
              <div className="flex items-center gap-3">
                {project.type === "music_video" && (
                  <button
                    onClick={() => setShowLyrics((v) => !v)}
                    className="text-xs text-zinc-400 underline"
                  >
                    {showLyrics ? "Hide lyrics" : "+ Add lyrics"}
                  </button>
                )}
                <button
                  onClick={generateScript}
                  disabled={!!generating}
                  className="px-4 py-2 bg-white text-black text-sm font-semibold rounded-full hover:bg-zinc-100 disabled:opacity-50 transition-colors"
                >
                  {generating === "script" ? "Generating..." : "Generate Script"}
                </button>
              </div>
            )}
          </div>

          {showLyrics && (
            <textarea
              rows={5}
              value={lyrics}
              onChange={(e) => setLyrics(e.target.value)}
              placeholder="Paste your song lyrics here..."
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-none"
            />
          )}

          {latestScript ? (
            <div className="border border-zinc-800 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-zinc-500">Version {latestScript.version}</span>
                <Link
                  href={`/studio/${id}/script`}
                  className="text-xs text-zinc-400 underline hover:text-white"
                >
                  View full script
                </Link>
              </div>
              <pre className="text-sm text-zinc-300 whitespace-pre-wrap font-mono leading-relaxed line-clamp-10">
                {latestScript.content}
              </pre>
            </div>
          ) : (
            <div className="border border-dashed border-zinc-800 rounded-xl p-8 text-center text-zinc-600 text-sm">
              No script yet. Generate one above.
            </div>
          )}
        </section>

        {/* ── STEP 2: Storyboard ── */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">2. Storyboard</h2>
            {latestScript && scenes.length === 0 && (
              <button
                onClick={() => generateStoryboard(latestScript.id)}
                disabled={!!generating}
                className="px-4 py-2 bg-white text-black text-sm font-semibold rounded-full hover:bg-zinc-100 disabled:opacity-50 transition-colors"
              >
                {generating === "storyboard" ? "Generating..." : "Generate Storyboard"}
              </button>
            )}
            {scenes.length > 0 && (
              <Link
                href={`/studio/${id}/storyboard`}
                className="text-xs text-zinc-400 underline hover:text-white"
              >
                Full storyboard
              </Link>
            )}
          </div>

          {scenes.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {scenes.map((scene) => (
                <div
                  key={scene.id}
                  className="border border-zinc-800 rounded-xl p-4 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-500">Scene {scene.scene_number}</span>
                    {scene.color_palette && scene.color_palette.length > 0 && (
                      <div className="flex gap-1">
                        {scene.color_palette.slice(0, 3).map((c) => (
                          <div
                            key={c}
                            className="w-4 h-4 rounded-full border border-zinc-700"
                            style={{ backgroundColor: c }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                  <p className="text-sm font-medium">{scene.title}</p>
                  <p className="text-xs text-zinc-500 line-clamp-2">{scene.description}</p>
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-xs text-zinc-600">
                      {scene.shots?.length ?? 0} shots
                    </span>
                    {(!scene.shots || scene.shots.length === 0) && (
                      <button
                        onClick={() => generateShots(scene.id)}
                        disabled={!!generating}
                        className="text-xs text-zinc-400 underline hover:text-white disabled:opacity-50"
                      >
                        {generating === `shots-${scene.id}` ? "..." : "Gen shots"}
                      </button>
                    )}
                    {scene.shots && scene.shots.length > 0 && (
                      <Link
                        href={`/studio/${id}/shots?scene=${scene.id}`}
                        className="text-xs text-zinc-400 underline hover:text-white"
                      >
                        View shots
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="border border-dashed border-zinc-800 rounded-xl p-8 text-center text-zinc-600 text-sm">
              {latestScript
                ? "Script ready. Generate the storyboard above."
                : "Generate a script first."}
            </div>
          )}
        </section>

        {/* ── Job History ── */}
        {jobs.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold mb-4">Job History</h2>
            <div className="space-y-2">
              {jobs.map((j) => (
                <div
                  key={j.id}
                  className="flex items-center justify-between border border-zinc-800 rounded-lg px-4 py-3 text-sm"
                >
                  <span className="text-zinc-300">{j.type.replace(/_/g, " ")}</span>
                  <span
                    className={`text-xs ${
                      j.status === "completed"
                        ? "text-green-400"
                        : j.status === "failed"
                          ? "text-red-400"
                          : j.status === "running"
                            ? "text-yellow-400"
                            : "text-zinc-500"
                    }`}
                  >
                    {j.status}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
