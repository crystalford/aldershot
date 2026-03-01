"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { Shot, Scene } from "@/types/studio";

type SceneWithShots = Scene & { shots: Shot[] };

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-zinc-800 text-zinc-400",
  generating: "bg-yellow-900 text-yellow-300",
  generated: "bg-blue-900 text-blue-300",
  approved: "bg-green-900 text-green-300",
  rejected: "bg-red-900 text-red-400",
};

export default function ShotsPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const sceneFilter = searchParams.get("scene");

  const [scenes, setScenes] = useState<SceneWithShots[]>([]);
  const [loading, setLoading] = useState(true);
  const [projectTitle, setProjectTitle] = useState("");

  useEffect(() => {
    fetch(`/api/projects/${id}`)
      .then((r) => r.json())
      .then((d) => {
        setProjectTitle(d.project?.title ?? "");
        setScenes(d.scenes ?? []);
        setLoading(false);
      });
  }, [id]);

  const visibleScenes = sceneFilter
    ? scenes.filter((s) => s.id === sceneFilter)
    : scenes;

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="text-zinc-500">Loading shots...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center gap-4">
        <Link href={`/studio/${id}`} className="text-zinc-500 hover:text-white text-sm">
          ← Project
        </Link>
        <span className="text-zinc-700">/</span>
        <span className="text-sm">{projectTitle}</span>
        <span className="text-zinc-700">/</span>
        <span className="text-sm">Shots</span>
        {sceneFilter && (
          <Link href={`/studio/${id}/shots`} className="ml-auto text-xs text-zinc-500 underline">
            Show all scenes
          </Link>
        )}
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10 space-y-10">
        <h1 className="text-3xl font-bold">Shot List</h1>

        {visibleScenes.map((scene) => (
          <section key={scene.id}>
            <div className="flex items-center gap-3 mb-4">
              <h2 className="text-lg font-semibold">
                Scene {scene.scene_number}: {scene.title}
              </h2>
              <span className="text-xs text-zinc-600">{scene.shots?.length ?? 0} shots</span>
            </div>

            {!scene.shots || scene.shots.length === 0 ? (
              <div className="border border-dashed border-zinc-800 rounded-xl p-6 text-center text-zinc-600 text-sm">
                No shots generated for this scene.
              </div>
            ) : (
              <div className="space-y-3">
                {scene.shots.map((shot) => (
                  <div
                    key={shot.id}
                    className="border border-zinc-800 rounded-xl px-5 py-4 grid grid-cols-[2rem_1fr_auto] gap-4 items-start"
                  >
                    <span className="text-zinc-500 text-sm font-mono pt-0.5">{shot.shot_number}</span>
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap gap-2 text-xs text-zinc-400">
                        {shot.shot_type && (
                          <span className="px-2 py-0.5 bg-zinc-900 rounded">{shot.shot_type}</span>
                        )}
                        {shot.camera_angle && (
                          <span className="px-2 py-0.5 bg-zinc-900 rounded">{shot.camera_angle}</span>
                        )}
                        {shot.camera_movement && (
                          <span className="px-2 py-0.5 bg-zinc-900 rounded">{shot.camera_movement}</span>
                        )}
                        {shot.duration_seconds && (
                          <span className="text-zinc-600">{shot.duration_seconds}s</span>
                        )}
                      </div>
                      {shot.description && (
                        <p className="text-sm text-zinc-300">{shot.description}</p>
                      )}
                      {shot.prompt && (
                        <p className="text-xs text-zinc-500 italic leading-relaxed border-l-2 border-zinc-700 pl-3">
                          {shot.prompt}
                        </p>
                      )}
                    </div>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLES[shot.status] ?? "bg-zinc-800 text-zinc-400"}`}
                    >
                      {shot.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}

        {visibleScenes.length === 0 && (
          <div className="text-center py-24 text-zinc-600">No scenes available.</div>
        )}
      </main>
    </div>
  );
}
