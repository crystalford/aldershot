import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-black text-white flex flex-col">
      {/* Hero */}
      <div className="flex flex-col items-center justify-center flex-1 px-6 py-24 text-center">
        <div className="mb-4 text-xs uppercase tracking-[0.3em] text-zinc-500">
          AI-Powered Production
        </div>
        <h1 className="text-6xl font-bold tracking-tight mb-4 bg-gradient-to-b from-white to-zinc-400 bg-clip-text text-transparent">
          Aldershot
        </h1>
        <p className="text-xl text-zinc-400 max-w-xl mb-10">
          Generate scripts, storyboards, and shot lists for music videos and
          cinematic films — powered by Claude AI.
        </p>
        <Link
          href="/studio"
          className="px-8 py-3 bg-white text-black font-semibold rounded-full hover:bg-zinc-100 transition-colors"
        >
          Open Studio
        </Link>
      </div>

      {/* Feature strip */}
      <div className="border-t border-zinc-800 grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-zinc-800">
        {[
          {
            icon: "✦",
            title: "Script Generation",
            body: "Describe your vision and Claude writes the screenplay or music video treatment.",
          },
          {
            icon: "◈",
            title: "Storyboard AI",
            body: "Break any script into cinematic scenes with mood, palette, and locations.",
          },
          {
            icon: "◉",
            title: "Shot Planning",
            body: "Auto-generate shot lists with camera type, angle, movement, and AI prompts.",
          },
        ].map(({ icon, title, body }) => (
          <div key={title} className="px-8 py-10">
            <div className="text-2xl mb-3 text-zinc-300">{icon}</div>
            <h3 className="text-white font-semibold mb-1">{title}</h3>
            <p className="text-zinc-500 text-sm leading-relaxed">{body}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
