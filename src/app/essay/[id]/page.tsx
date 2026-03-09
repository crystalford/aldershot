"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { Project, Transcript, Scene, ProductionJob, Asset, EssayStyle } from "@/types/studio";

interface EssayDetail {
  project: Project;
  transcript: Transcript | null;
  scenes: Scene[];
  jobs: ProductionJob[];
  heroAssets: Asset[];
}

const JOB_STATUS_COLOR: Record<string, string> = {
  completed: "text-green-400",
  failed: "text-red-400",
  running: "text-yellow-400",
  pending: "text-zinc-500",
};

const ESSAY_STYLES: EssayStyle[] = [
  "documentary", "explainer", "cinematic", "illustrated", "dark-academia", "minimal",
];

export default function EssayWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<EssayDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [segmentStyle, setSegmentStyle] = useState<EssayStyle>("cinematic");
  const [numSegments, setNumSegments] = useState(8);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    fetch(`/api/essay/${id}`)
      .then((r) => r.json())
      .then((d: EssayDetail) => {
        setData(d);
        setLoading(false);
        if (d.project.style) setSegmentStyle(d.project.style as EssayStyle);
      });
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  function pollJob(jobId: string, onDone: () => void) {
    const interval = setInterval(async () => {
      const r = await fetch(`/api/jobs/${jobId}`);
      const job = await r.json();
      if (job.status === "completed" || job.status === "failed") {
        clearInterval(interval);
        onDone();
      }
    }, 2500);
  }

  async function handleTranscribe() {
    if (!audioUrl) return;
    setGenerating("transcribe");
    setError("");

    const res = await fetch("/api/essay/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: id, audio_url: audioUrl }),
    });

    if (!res.ok) {
      const d = await res.json();
      setError(d.error ?? "Transcription failed");
      setGenerating(null);
      return;
    }

    const { job_id } = await res.json();
    pollJob(job_id, () => { setGenerating(null); load(); });
  }

  async function handleSegment() {
    if (!data?.transcript) return;
    setGenerating("segment");
    setError("");

    const res = await fetch("/api/essay/segment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: id,
        transcript_id: data.transcript.id,
        style: segmentStyle,
        num_segments: numSegments,
      }),
    });

    if (!res.ok) {
      const d = await res.json();
      setError(d.error ?? "Segmentation failed");
      setGenerating(null);
      return;
    }

    const { job_id } = await res.json();
    pollJob(job_id, () => { setGenerating(null); load(); });
  }

  async function handleGenerateHeroImages() {
    if (!data?.scenes.length) return;
    setGenerating("hero-images");
    setError("");

    const aspect = (data.project.aspect_ratio ?? "16:9") as "16:9" | "9:16" | "1:1" | "4:3";

    const res = await fetch("/api/essay/hero-images", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: id,
        scene_ids: data.scenes.map((s) => s.id),
        aspect_ratio: aspect,
      }),
    });

    if (!res.ok) {
      const d = await res.json();
      setError(d.error ?? "Image generation failed");
      setGenerating(null);
      return;
    }

    const { job_id } = await res.json();
    pollJob(job_id, () => { setGenerating(null); load(); });
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="text-zinc-500">Loading essay workspace...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="text-zinc-500">Essay not found.</p>
      </div>
    );
  }

  const { project, transcript, scenes, jobs, heroAssets } = data;
  const activeJob = jobs.find((j) => j.status === "running" || j.status === "pending");
  const assetsByScene = Object.fromEntries(
    heroAssets.map((a) => [a.scene_id, a])
  );

  return (
    <div className="min-h-screen bg-black text-white">
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center gap-4">
        <Link href="/studio" className="text-zinc-500 hover:text-white text-sm transition-colors">
          ← Studio
        </Link>
        <span className="text-zinc-700">/</span>
        <span className="text-sm truncate">{project.title}</span>
        <span className="ml-auto text-xs text-zinc-500">video essay · {project.style}</span>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10 space-y-10">
        {/* Project title */}
        <div>
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

        {error && (
          <div className="border border-red-800 bg-red-950/30 rounded-xl px-5 py-4 text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* ── STEP 1: Transcription ── */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">1. Transcription</h2>
            {transcript && (
              <span className="text-xs text-green-400">
                {transcript.words.length} words · {Math.round(transcript.duration_seconds)}s
              </span>
            )}
          </div>

          {transcript ? (
            <div className="border border-zinc-800 rounded-xl p-5 space-y-3">
              <p className="text-sm text-zinc-300 leading-relaxed line-clamp-4">
                {transcript.full_text}
              </p>
              <p className="text-xs text-zinc-600">
                {transcript.words.length} words · {Math.round(transcript.duration_seconds)}s ·{" "}
                {transcript.audio_url}
              </p>
            </div>
          ) : (
            <div className="border border-zinc-800 rounded-xl p-5 space-y-3">
              <p className="text-sm text-zinc-500 mb-3">
                Paste the URL to your narration audio file (mp3, wav, m4a, flac).
              </p>
              <div className="flex gap-3">
                <input
                  type="url"
                  value={audioUrl}
                  onChange={(e) => setAudioUrl(e.target.value)}
                  placeholder="https://..."
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2.5 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                />
                <button
                  onClick={handleTranscribe}
                  disabled={!audioUrl || !!generating}
                  className="px-5 py-2.5 bg-white text-black text-sm font-semibold rounded-full hover:bg-zinc-100 disabled:opacity-50 transition-colors"
                >
                  {generating === "transcribe" ? "Transcribing..." : "Transcribe"}
                </button>
              </div>
            </div>
          )}
        </section>

        {/* ── STEP 2: Segmentation ── */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">2. Segment into Scenes</h2>
            {scenes.length > 0 && (
              <span className="text-xs text-green-400">{scenes.length} scenes</span>
            )}
          </div>

          {scenes.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {scenes.map((scene) => {
                const meta = (scene as Scene & { metadata?: Record<string, unknown> }).metadata ?? {};
                return (
                  <div key={scene.id} className="border border-zinc-800 rounded-xl p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-zinc-500">Scene {scene.scene_number}</span>
                      {!!meta.visual_type && (
                        <span className="text-xs text-zinc-600 bg-zinc-900 px-2 py-0.5 rounded-full">
                          {String(meta.visual_type).replace("_", " ")}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium">{scene.title}</p>
                    <p className="text-xs text-zinc-500 line-clamp-2">{scene.description}</p>
                    {!!meta.color_direction && (
                      <p className="text-xs text-zinc-600 italic">{String(meta.color_direction)}</p>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="border border-zinc-800 rounded-xl p-5 space-y-4">
              {!transcript ? (
                <p className="text-sm text-zinc-600">Transcribe audio first.</p>
              ) : (
                <>
                  <p className="text-sm text-zinc-400">
                    Claude will divide your transcript into {numSegments} visual scenes.
                  </p>
                  <div className="flex flex-wrap gap-4 items-end">
                    <div>
                      <label className="block text-xs text-zinc-500 mb-1">Style</label>
                      <select
                        value={segmentStyle}
                        onChange={(e) => setSegmentStyle(e.target.value as EssayStyle)}
                        className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
                      >
                        {ESSAY_STYLES.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-500 mb-1">Segments</label>
                      <input
                        type="number"
                        min={3}
                        max={24}
                        value={numSegments}
                        onChange={(e) => setNumSegments(Number(e.target.value))}
                        className="w-20 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
                      />
                    </div>
                    <button
                      onClick={handleSegment}
                      disabled={!!generating}
                      className="px-5 py-2 bg-white text-black text-sm font-semibold rounded-full hover:bg-zinc-100 disabled:opacity-50 transition-colors"
                    >
                      {generating === "segment" ? "Segmenting..." : "Generate Scenes"}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </section>

        {/* ── STEP 3: Hero Images ── */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">3. Generate Hero Images</h2>
            {heroAssets.length > 0 && (
              <span className="text-xs text-green-400">{heroAssets.length} generated</span>
            )}
          </div>

          {scenes.length === 0 ? (
            <div className="border border-dashed border-zinc-800 rounded-xl p-8 text-center text-zinc-600 text-sm">
              Segment your transcript into scenes first.
            </div>
          ) : heroAssets.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {scenes.map((scene) => {
                const asset = assetsByScene[scene.id];
                return (
                  <div key={scene.id} className="space-y-2">
                    <div className="aspect-video rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800">
                      {asset?.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={asset.url}
                          alt={scene.title ?? `Scene ${scene.scene_number}`}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-zinc-700 text-xs">
                          text card
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-zinc-400 truncate">
                      {scene.scene_number}. {scene.title}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="border border-zinc-800 rounded-xl p-5 flex items-center justify-between">
              <p className="text-sm text-zinc-400">
                Generate a FLUX hero image for each scene ({scenes.length} scenes).
              </p>
              <button
                onClick={handleGenerateHeroImages}
                disabled={!!generating}
                className="px-5 py-2.5 bg-white text-black text-sm font-semibold rounded-full hover:bg-zinc-100 disabled:opacity-50 transition-colors"
              >
                {generating === "hero-images" ? "Generating..." : "Generate Images"}
              </button>
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
                  <span className={`text-xs ${JOB_STATUS_COLOR[j.status] ?? "text-zinc-500"}`}>
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
