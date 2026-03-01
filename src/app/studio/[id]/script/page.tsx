"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { Script } from "@/types/studio";

export default function ScriptPage() {
  const { id } = useParams<{ id: string }>();
  const [scripts, setScripts] = useState<Script[]>([]);
  const [active, setActive] = useState<Script | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/projects/${id}`)
      .then((r) => r.json())
      .then((d) => {
        const s: Script[] = d.scripts ?? [];
        setScripts(s);
        setActive(s[0] ?? null);
        setLoading(false);
      });
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="text-zinc-500">Loading script...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center gap-4">
        <Link href={`/studio/${id}`} className="text-zinc-500 hover:text-white text-sm">
          ← Project
        </Link>
        <span className="text-zinc-700">/</span>
        <span className="text-sm">Script</span>
        {scripts.length > 1 && (
          <div className="ml-auto flex gap-2">
            {scripts.map((s) => (
              <button
                key={s.id}
                onClick={() => setActive(s)}
                className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                  active?.id === s.id
                    ? "border-white text-white"
                    : "border-zinc-700 text-zinc-500 hover:border-zinc-500"
                }`}
              >
                v{s.version}
              </button>
            ))}
          </div>
        )}
      </header>

      <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-10">
        {active ? (
          <>
            <div className="flex items-center justify-between mb-6">
              <div className="text-xs text-zinc-500 uppercase tracking-widest">
                {active.format} · Version {active.version}
                {active.ai_generated ? " · AI Generated" : ""}
              </div>
            </div>
            <pre className="font-mono text-sm text-zinc-200 whitespace-pre-wrap leading-7">
              {active.content}
            </pre>
          </>
        ) : (
          <div className="text-center py-24 text-zinc-600">No script available.</div>
        )}
      </main>
    </div>
  );
}
