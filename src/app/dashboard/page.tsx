"use client";

import { useState, useEffect, useCallback } from "react";

interface VideoJob {
  id: string;
  youtube_video_id: string;
  channel_name: string;
  video_title: string;
  video_url: string;
  status: string;
  clip_url?: string;
  analysis?: string;
  error?: string;
  created_at: string;
}

interface MonitoredChannel {
  id: string;
  youtube_channel_id: string;
  channel_name: string;
  webhook_active: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-400",
  fetching_transcript: "bg-blue-500/20 text-blue-400",
  analyzing: "bg-purple-500/20 text-purple-400",
  extracting_clip: "bg-cyan-500/20 text-cyan-400",
  rendering: "bg-indigo-500/20 text-indigo-400",
  publishing: "bg-green-500/20 text-green-400",
  completed: "bg-green-500/20 text-green-300",
  failed: "bg-red-500/20 text-red-400",
};

export default function Dashboard() {
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [channels, setChannels] = useState<MonitoredChannel[]>([]);
  const [manualUrl, setManualUrl] = useState("");
  const [newChannelId, setNewChannelId] = useState("");
  const [newChannelName, setNewChannelName] = useState("");
  const [loading, setLoading] = useState(false);

  const fetchJobs = useCallback(async () => {
    const res = await fetch("/api/pipeline/status");
    if (res.ok) setJobs(await res.json());
  }, []);

  const fetchChannels = useCallback(async () => {
    const res = await fetch("/api/channels");
    if (res.ok) setChannels(await res.json());
  }, []);

  useEffect(() => {
    fetchJobs();
    fetchChannels();
    // Poll for updates every 10 seconds
    const interval = setInterval(fetchJobs, 10_000);
    return () => clearInterval(interval);
  }, [fetchJobs, fetchChannels]);

  async function triggerManual() {
    if (!manualUrl.trim()) return;
    setLoading(true);
    const res = await fetch("/api/pipeline/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: manualUrl }),
    });
    const data = await res.json();
    if (res.ok) {
      setManualUrl("");
      fetchJobs();
    } else {
      alert(data.error || "Failed to trigger pipeline");
    }
    setLoading(false);
  }

  async function addChannel() {
    if (!newChannelId.trim() || !newChannelName.trim()) return;
    setLoading(true);
    const res = await fetch("/api/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channelId: newChannelId,
        channelName: newChannelName,
      }),
    });
    if (res.ok) {
      setNewChannelId("");
      setNewChannelName("");
      fetchChannels();
    } else {
      const data = await res.json();
      alert(data.error || "Failed to add channel");
    }
    setLoading(false);
  }

  async function removeChannel(channelId: string) {
    await fetch("/api/channels", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelId }),
    });
    fetchChannels();
  }

  return (
    <div className="min-h-screen p-8 max-w-6xl mx-auto space-y-8">
      <h1 className="text-3xl font-bold">Aldershot Pipeline</h1>

      {/* Manual Trigger */}
      <section className="bg-gray-900 rounded-xl p-6 space-y-4">
        <h2 className="text-xl font-semibold">Manual Trigger</h2>
        <p className="text-gray-400 text-sm">
          Paste a YouTube URL to process it immediately.
        </p>
        <div className="flex gap-3">
          <input
            type="text"
            value={manualUrl}
            onChange={(e) => setManualUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
            className="flex-1 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-gray-500"
            onKeyDown={(e) => e.key === "Enter" && triggerManual()}
          />
          <button
            onClick={triggerManual}
            disabled={loading || !manualUrl.trim()}
            className="px-6 py-2 bg-white text-gray-950 font-semibold rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors"
          >
            Process
          </button>
        </div>
      </section>

      {/* Monitored Channels */}
      <section className="bg-gray-900 rounded-xl p-6 space-y-4">
        <h2 className="text-xl font-semibold">Monitored Channels</h2>
        <p className="text-gray-400 text-sm">
          Channels being watched for new uploads via YouTube WebSub.
        </p>

        {channels.length > 0 && (
          <div className="space-y-2">
            {channels.map((ch) => (
              <div
                key={ch.id}
                className="flex items-center justify-between bg-gray-800 rounded-lg px-4 py-3"
              >
                <div>
                  <span className="font-medium">{ch.channel_name}</span>
                  <span className="text-gray-500 text-sm ml-3">
                    {ch.youtube_channel_id}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`text-xs px-2 py-1 rounded ${
                      ch.webhook_active
                        ? "bg-green-500/20 text-green-400"
                        : "bg-red-500/20 text-red-400"
                    }`}
                  >
                    {ch.webhook_active ? "Active" : "Inactive"}
                  </span>
                  <button
                    onClick={() => removeChannel(ch.youtube_channel_id)}
                    className="text-red-400 hover:text-red-300 text-sm"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-3">
          <input
            type="text"
            value={newChannelId}
            onChange={(e) => setNewChannelId(e.target.value)}
            placeholder="Channel ID (e.g. UCGy_UxBz..."
            className="flex-1 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-gray-500"
          />
          <input
            type="text"
            value={newChannelName}
            onChange={(e) => setNewChannelName(e.target.value)}
            placeholder="Channel name"
            className="w-48 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-gray-500"
          />
          <button
            onClick={addChannel}
            disabled={loading || !newChannelId.trim() || !newChannelName.trim()}
            className="px-6 py-2 bg-gray-700 text-white font-semibold rounded-lg hover:bg-gray-600 disabled:opacity-50 transition-colors"
          >
            Add Channel
          </button>
        </div>
      </section>

      {/* Pipeline Jobs */}
      <section className="bg-gray-900 rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Pipeline Jobs</h2>
          <button
            onClick={fetchJobs}
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            Refresh
          </button>
        </div>

        {jobs.length === 0 ? (
          <p className="text-gray-500">
            No jobs yet. Add a channel or trigger manually.
          </p>
        ) : (
          <div className="space-y-3">
            {jobs.map((job) => (
              <div
                key={job.id}
                className="bg-gray-800 rounded-lg p-4 space-y-2"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-medium">{job.video_title}</h3>
                    <p className="text-gray-500 text-sm">
                      {job.channel_name} &middot;{" "}
                      {new Date(job.created_at).toLocaleString()}
                    </p>
                  </div>
                  <span
                    className={`text-xs px-3 py-1 rounded-full font-medium ${
                      STATUS_COLORS[job.status] || "bg-gray-700 text-gray-300"
                    }`}
                  >
                    {job.status.replace(/_/g, " ")}
                  </span>
                </div>

                {job.error && (
                  <p className="text-red-400 text-sm bg-red-500/10 rounded p-2">
                    {job.error}
                  </p>
                )}

                {job.clip_url && (
                  <div className="flex gap-3 pt-1">
                    <a
                      href={job.clip_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-400 hover:text-blue-300"
                    >
                      View Clip
                    </a>
                    <a
                      href={job.video_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-gray-400 hover:text-gray-300"
                    >
                      Original Video
                    </a>
                  </div>
                )}

                {job.analysis && job.status === "completed" && (
                  <details className="pt-1">
                    <summary className="text-sm text-gray-400 cursor-pointer hover:text-gray-300">
                      View analysis
                    </summary>
                    <pre className="text-xs text-gray-500 mt-2 bg-gray-900 rounded p-3 overflow-x-auto">
                      {JSON.stringify(JSON.parse(job.analysis), null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
