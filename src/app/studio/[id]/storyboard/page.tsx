"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { Scene } from "@/types/studio";

type SceneWithShots = Scene & { shots: { id: string; shot_number: number; shot_type?: string; description?: string; camera_angle?: string; camera_movement?: string }[] };

const TIME_ICONS: Record<string, string> = {
  day: "☀",
  night: "☽",
  dusk: "◐",
  dawn: "◑",
  interior: "◻",
};

export default function StoryboardPage() {
  const { id } = useParams<{ id: string }>();
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

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="text-zinc-500">Loading storyboard...</p>
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
        <span className="text-sm">Storyboard</span>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10">
        <h1 className="text-3xl font-bold mb-8">Storyboard</h1>

        {scenes.length === 0 && (
          <div className="text-center py-24 text-zinc-600">No scenes yet.</div>
        )}

        <div className="space-y-8">
          {scenes.map((scene) => (
            <div key={scene.id} className="border border-zinc-800 rounded-2xl overflow-hidden">
              {/* Scene header */}
              <div className="px-6 py-4 border-b border-zinc-800 flex items-start gap-4">
                {/* Color palette */}
                {scene.color_palette && scene.color_palette.length > 0 && (
                  <div className="flex gap-1 pt-1 shrink-0">
                    {scene.color_palette.map((c) => (
                      <div
                        key={c}
                        className="w-5 h-10 rounded"
                        style={{ backgroundColor: c }}
                        title={c}
                      />
                    ))}
                  </div>
                )}
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs text-zinc-500">Scene {scene.scene_number}</span>
                    {scene.time_of_day && (
                      <span className="text-xs text-zinc-500">
                        {TIME_ICONS[scene.time_of_day]} {scene.time_of_day}
                      </span>
                    )}
                    {scene.duration_seconds && (
                      <span className="text-xs text-zinc-600">
                        {scene.duration_seconds}s
                      </span>
                    )}
                    <Link
                      href={`/studio/${id}/shots?scene=${scene.id}`}
                      className="ml-auto text-xs text-zinc-400 underline hover:text-white"
                    >
                      {scene.shots?.length ?? 0} shots →
                    </Link>
                  </div>
                  <h3 className="font-semibold text-lg">{scene.title}</h3>
                  {scene.location && (
                    <div className="text-xs text-zinc-500 mt-0.5">{scene.location}</div>
                  )}
                  {scene.description && (
                    <p className="text-sm text-zinc-400 mt-2 leading-relaxed">
                      {scene.description}
                    </p>
                  )}
                  {scene.mood && (
                    <div className="mt-2 inline-block text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400">
                      {scene.mood}
                    </div>
                  )}
                </div>
              </div>

              {/* Shot list preview */}
              {scene.shots && scene.shots.length > 0 && (
                <div className="divide-y divide-zinc-900">
                  {scene.shots.map((shot) => (
                    <div key={shot.id} className="px-6 py-3 flex items-start gap-4 text-sm">
                      <span className="text-zinc-600 w-6 shrink-0">{shot.shot_number}</span>
                      <div className="flex gap-2 text-xs text-zinc-500 w-48 shrink-0 flex-wrap">
                        {shot.shot_type && <span>{shot.shot_type}</span>}
                        {shot.camera_angle && <span>{shot.camera_angle}</span>}
                        {shot.camera_movement && <span>{shot.camera_movement}</span>}
                      </div>
                      <p className="text-zinc-300 text-xs leading-relaxed">{shot.description}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
