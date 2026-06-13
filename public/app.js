// Aldershot — Transcript Editor (client). Text-based video editing:
// delete words -> their time is cut -> "Play edit" previews the result instantly.
const $ = (s) => document.querySelector(s);
const video = $("#video");

let words = [];        // {text, start, end, deleted}
let mediaKey = null;   // set after server-side transcribe
let anchor = null;     // for shift-click range select
let localFile = null;

// A short demo transcript so the editor is usable with no backend.
const SAMPLE = [
  ["The", 0.0, 0.18], ["mayor", 0.18, 0.55], ["was", 0.55, 0.72], ["the", 0.72, 0.86],
  ["monster", 0.86, 1.4], ["all", 1.5, 1.7], ["along.", 1.7, 2.2],
  ["Widow's", 2.5, 2.95], ["Bay", 2.95, 3.2], ["isn't", 3.2, 3.5], ["really", 3.5, 3.8],
  ["about", 3.8, 4.05], ["a", 4.05, 4.12], ["curse.", 4.12, 4.7],
  ["It's", 5.0, 5.2], ["about", 5.2, 5.5], ["what", 5.5, 5.7], ["we", 5.7, 5.85],
  ["destroy", 5.85, 6.4], ["when", 6.4, 6.6], ["we", 6.6, 6.75],
  ["turn", 6.75, 7.0], ["a", 7.0, 7.08], ["place", 7.08, 7.4], ["into", 7.4, 7.7],
  ["a", 7.7, 7.78], ["product.", 7.78, 8.5],
].map(([text, start, end]) => ({ text, start, end, deleted: false }));

const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

function keptRanges(ws, gap = 0.12) {
  const r = [];
  for (const w of ws) {
    if (w.deleted) continue;
    const last = r[r.length - 1];
    if (last && w.start - last.end <= gap) last.end = w.end;
    else r.push({ start: w.start, end: w.end });
  }
  return r;
}
const keptSeconds = (r) => r.reduce((s, x) => s + (x.end - x.start), 0);

function render() {
  const t = $("#transcript");
  t.innerHTML = "";
  words.forEach((w, i) => {
    const span = document.createElement("span");
    span.className = "word" + (w.deleted ? " deleted" : "");
    span.textContent = w.text + " ";
    span.dataset.i = i;
    t.appendChild(span);
  });
  updateStats();
}

function updateStats() {
  if (!words.length) { $("#stats").textContent = "no transcript"; return; }
  const ranges = keptRanges(words);
  const total = words[words.length - 1].end - words[0].start;
  const kept = words.filter((w) => !w.deleted).length;
  $("#stats").textContent = `${fmt(keptSeconds(ranges))} kept / ${fmt(total)} · ${kept}/${words.length} words`;
}

// Cut words: click toggles one, shift-click toggles a range.
$("#transcript").addEventListener("click", (e) => {
  const el = e.target.closest(".word");
  if (!el) return;
  const i = +el.dataset.i;
  if (e.shiftKey && anchor != null) {
    const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)];
    const anyKept = words.slice(a, b + 1).some((w) => !w.deleted);
    for (let k = a; k <= b; k++) words[k].deleted = anyKept;
  } else {
    words[i].deleted = !words[i].deleted;
    anchor = i;
  }
  render();
});

// Double-click: jump the video to that word.
$("#transcript").addEventListener("dblclick", (e) => {
  const el = e.target.closest(".word");
  if (!el) return;
  video.currentTime = words[+el.dataset.i].start;
  video.play();
});

// Highlight the word currently under the playhead (karaoke during preview).
let playingEl = null;
function highlightAt(t) {
  let found = -1;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!w.deleted && t >= w.start && t < w.end) { found = i; break; }
  }
  const next = found >= 0 ? $(`.word[data-i="${found}"]`) : null;
  if (next === playingEl) return;
  if (playingEl) playingEl.classList.remove("playing");
  if (next) next.classList.add("playing");
  playingEl = next;
}
function clearHighlight() {
  if (playingEl) { playingEl.classList.remove("playing"); playingEl = null; }
}

// Play edit: walk the kept ranges, skipping deleted gaps.
let editPlaying = false;
$("#playEdit").addEventListener("click", () => {
  if (!video.src) { setStatus("Load a video first to preview the cut."); return; }
  const ranges = keptRanges(words);
  if (!ranges.length) return;
  editPlaying = true;
  let idx = 0;
  video.currentTime = ranges[0].start;
  video.play();
  const tick = () => {
    if (!editPlaying) return;
    if (video.currentTime >= ranges[idx].end - 0.02) {
      idx++;
      if (idx >= ranges.length) { editPlaying = false; video.pause(); clearHighlight(); return; }
      video.currentTime = ranges[idx].start;
    }
    highlightAt(video.currentTime);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
video.addEventListener("pause", () => { editPlaying = false; clearHighlight(); });

// Load a local video/audio file.
$("#file").addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (!f) return;
  localFile = f;
  video.src = URL.createObjectURL(f);
  $("#filename").textContent = f.name;
});

// Transcribe via the Worker (Whisper). Needs the Cloudflare backend wired.
$("#transcribe").addEventListener("click", async () => {
  if (!localFile) { alert("Load a video or audio file first."); return; }
  setStatus("Transcribing…");
  try {
    const res = await fetch("/api/transcribe", {
      method: "POST",
      headers: { "content-type": localFile.type || "application/octet-stream" },
      body: localFile,
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    mediaKey = data.mediaKey;
    words = data.words.map((w) => ({ ...w, deleted: false }));
    render();
  } catch (err) {
    alert(`Transcribe failed: ${err.message}\n\nThe backend isn't wired yet — try “Demo transcript” to explore the editor.`);
  }
  setStatus("");
});

// Demo transcript: explore the editor with zero backend.
$("#demo").addEventListener("click", () => {
  words = SAMPLE.map((w) => ({ ...w }));
  mediaKey = null;
  render();
});

// Export: server render if transcribed, else download the edit list.
$("#export").addEventListener("click", async () => {
  if (!words.length) { alert("Nothing to export yet."); return; }
  const ranges = keptRanges(words);
  if (!mediaKey) {
    const blob = new Blob([JSON.stringify({ ranges }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "edit.json";
    a.click();
    return;
  }
  setStatus("Rendering cut…");
  try {
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mediaKey, words }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    // Load the rendered cut into the player and offer a download.
    const url = "/api/media/" + data.outputKey.split("/").map(encodeURIComponent).join("/");
    editPlaying = false;
    video.src = url;
    $("#filename").textContent = data.outputKey;
    $("#status").innerHTML =
      `cut: ${data.keptSeconds.toFixed(1)}s · ${data.ranges.length} segment(s) · ` +
      `<a href="${url}" download style="color:var(--amber)">download</a>`;
    return;
  } catch (err) {
    alert(`Export failed: ${err.message}`);
  }
  setStatus("");
});

const setStatus = (m) => { $("#status").textContent = m; };
render();
