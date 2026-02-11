import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-6">
        <h1 className="text-4xl font-bold tracking-tight">Aldershot</h1>
        <p className="text-gray-400 text-lg max-w-md">
          Automated video pipeline. Monitor YouTube channels, extract clips,
          generate articles, and publish to X.
        </p>
        <Link
          href="/dashboard"
          className="inline-block px-6 py-3 bg-white text-gray-950 font-semibold rounded-lg hover:bg-gray-200 transition-colors"
        >
          Open Dashboard
        </Link>
      </div>
    </div>
  );
}
