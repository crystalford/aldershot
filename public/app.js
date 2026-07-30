// Aldershot — project console. Multi-video projects: upload a batch, transcribe
// each, edit as text. AI arrange + suggested shorts land in later slices.
const $ = (s, r = document) => r.querySelector(s);
const main = $("#main");

const fmt = (t) => {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

// ── API ──────────────────────────────────────────────────────────────
const api = {
  listProjects: () => fetch("/api/projects").then((r) => r.json()),
  createProject: (name) =>
    fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    }).then((r) => r.json()),
  getProject: (id) => fetch(`/api/projects/${id}`).then((r) => r.json()),
  uploadVideo: (pid, file, duration) =>
    fetch(`/api/projects/${pid}/videos`, {
      method: "POST",
      headers: {
        "content-type": file.type || "application/octet-stream",
        "x-filename": encodeURIComponent(file.name),
        "x-duration": String(duration || ""),
      },
      body: file,
    }).then((r) => r.json()),
  async transcribe(vid, wav) {
    const res = await fetch(`/api/videos/${vid}/transcribe`, {
      method: "POST",
      headers: { "content-type": "audio/wav" },
      body: wav,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  },
};

// ── State ────────────────────────────────────────────────────────────
const state = { project: null, videos: [], timeline: null, shorts: null, selected: null };

// ── EDL mirror (kept in sync with src/transcript/edl.ts) ─────────────
function keptRanges(words, gap = 0.12) {
  const r = [];
  for (const w of words || []) {
    if (w.deleted) continue;
    const last = r[r.length - 1];
    if (last && w.start - last.end <= gap) last.end = w.end;
    else r.push({ start: w.start, end: w.end });
  }
  return r;
}
const rangeSeconds = (r) => r.reduce((s, x) => s + (x.end - x.start), 0);

// ── Chrome ───────────────────────────────────────────────────────────
function setCrumbs(items) {
  const el = $("#crumbs");
  el.innerHTML = "";
  items.forEach((it, i) => {
    if (i) el.appendChild(Object.assign(document.createElement("span"), { className: "sep", textContent: "/" }));
    const a = document.createElement(it.go ? "a" : "span");
    a.textContent = it.label;
    if (it.go) { a.href = "#"; a.onclick = (e) => { e.preventDefault(); it.go(); }; }
    el.appendChild(a);
  });
}
const setStats = (t) => { $("#stats").textContent = t; };

// ── Projects view ────────────────────────────────────────────────────
async function showProjects() {
  location.hash = "#/";
  setCrumbs([]);
  setStats("");
  state.project = null;
  main.innerHTML = `<div class="loading">Loading projects…</div>`;
  const { projects } = await api.listProjects();
  main.innerHTML = `
    <section class="pad">
      <div class="row-between">
        <h1>Projects</h1>
        <button class="btn amber" id="new">+ New project</button>
      </div>
      <div class="grid" id="projgrid"></div>
    </section>`;
  $("#new").onclick = newProject;
  const grid = $("#projgrid");
  if (!projects.length) {
    grid.innerHTML = `<p class="empty">No projects yet. Create one and drop in your videos.</p>`;
    return;
  }
  projects.forEach((p) => {
    const card = document.createElement("button");
    card.className = "card";
    card.innerHTML = `<div class="card-title">${escapeHtml(p.name)}</div>
      <div class="card-sub">${new Date(p.created_at).toLocaleString()}</div>`;
    card.onclick = () => openProject(p.id);
    grid.appendChild(card);
  });
}

async function newProject() {
  const name = prompt("Project name", "Untitled project");
  if (name === null) return;
  const p = await api.createProject(name.trim() || "Untitled project");
  openProject(p.id);
}

// ── Project view ─────────────────────────────────────────────────────
async function openProject(id) {
  location.hash = `#/p/${id}`;
  main.innerHTML = `<div class="loading">Loading project…</div>`;
  const data = await api.getProject(id);
  if (data.error) { main.innerHTML = `<p class="empty">${data.error}</p>`; return; }
  state.project = data.project;
  state.videos = (data.videos || []).map((v) => ({ ...v }));
  state.timeline = data.timeline;
  state.shorts = data.shorts;
  state.selected = state.videos.find((v) => v.status === "ready")?.id || state.videos[0]?.id || null;
  setCrumbs([{ label: "Projects", go: showProjects }, { label: data.project.name }]);
  renderProject();
}

function renderProject() {
  main.innerHTML = `
    <div class="editor">
      <aside class="side">
        <div class="dropzone" id="drop">
          <strong>Drop videos here</strong>
          <span>or <label class="link">browse<input id="file" type="file" accept="video/*,audio/*" multiple hidden /></label></span>
          <small>Base video + commentary — add as many as you like.</small>
        </div>
        <div class="vlist" id="vlist"></div>
      </aside>
      <section class="stage">
        <div class="toolbar">
          <button class="btn amber" id="playEdit">▶ Play edit</button>
          <button class="btn" id="stopEdit">■ Stop</button>
          <button class="btn" id="arrange">✨ Auto-arrange</button>
          <span class="spacer"></span>
          <button class="btn" id="save">Save edit</button>
        </div>
        <video id="sel-player" controls playsinline></video>
        <div id="timeline"></div>
        <p class="hint">Click a word to cut it · shift-click for a range · double-click to jump the player there.</p>
        <div class="transcript" id="transcript"></div>
      </section>
    </div>`;

  wireDropzone();
  renderVideoList();
  renderTranscript();
  renderTimeline();
  updateStats();
  selectVideo(state.selected);
  $("#playEdit").onclick = playEdit;
  $("#stopEdit").onclick = stopEdit;
  $("#arrange").onclick = autoArrange;
  $("#save").onclick = saveEdit;
  $("#sel-player").addEventListener("pause", () => { if (edit.playing) stopEdit(); });
}

// ── AI arrange + timeline panel ──────────────────────────────────────
const hasTimeline = () => state.timeline && ((state.timeline.coldOpen || []).length || (state.timeline.body || []).length);

async function autoArrange() {
  const ready = state.videos.filter((v) => v.status === "ready" && v.words);
  if (!ready.length) { alert("Transcribe at least one video first."); return; }
  const btn = $("#arrange");
  const label = btn.textContent;
  btn.textContent = "Arranging…";
  btn.disabled = true;
  try {
    const res = await fetch(`/api/projects/${state.project.id}/arrange`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    state.timeline = data.timeline;
    renderTimeline();
    updateStats();
  } catch (err) {
    alert(`Auto-arrange failed: ${err.message}\n\n(The AI step needs the live Cloudflare account.)`);
  }
  btn.textContent = label;
  btn.disabled = false;
}

function renderTimeline() {
  const el = $("#timeline");
  if (!el) return;
  if (!hasTimeline()) { el.innerHTML = ""; return; }
  const t = state.timeline;
  const seg = (s, group, idx) => {
    const v = state.videos.find((x) => x.id === s.videoId);
    const name = v ? decodeURIComponent(v.filename || "video") : s.videoId;
    return `<div class="seg" data-g="${group}" data-i="${idx}">
      <span class="seg-time">${fmt(s.start)}–${fmt(s.end)}</span>
      <span class="seg-src">${escapeHtml(name)}</span>
      <span class="seg-reason">${escapeHtml(s.reason || "")}</span>
      <button class="seg-x" data-g="${group}" data-i="${idx}" title="Remove">×</button></div>`;
  };
  el.innerHTML = `
    <div class="tl">
      <div class="tl-head"><strong>Arranged cut</strong><button class="btn ghost small" id="clearTl">Clear</button></div>
      ${(t.coldOpen || []).length ? `<div class="tl-label">Cold open</div>${t.coldOpen.map((s, i) => seg(s, "coldOpen", i)).join("")}` : ""}
      ${(t.body || []).length ? `<div class="tl-label">Body</div>${t.body.map((s, i) => seg(s, "body", i)).join("")}` : ""}
    </div>`;
  el.querySelectorAll(".seg").forEach((row) => {
    row.querySelector(".seg-x").onclick = (e) => {
      e.stopPropagation();
      state.timeline[row.dataset.g].splice(+row.dataset.i, 1);
      saveTimeline();
      renderTimeline();
      updateStats();
    };
    row.onclick = () => {
      const s = state.timeline[row.dataset.g][+row.dataset.i];
      selectVideo(s.videoId);
      const p = $("#sel-player");
      p.currentTime = s.start;
      p.play();
    };
  });
  $("#clearTl").onclick = () => { state.timeline = null; saveTimeline(); renderTimeline(); updateStats(); };
}

function saveTimeline() {
  return fetch(`/api/projects/${state.project.id}/timeline`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(state.timeline || { coldOpen: [], body: [] }),
  });
}

function renderVideoList() {
  const list = $("#vlist");
  list.innerHTML = "";
  if (!state.videos.length) {
    list.innerHTML = `<p class="empty small">No videos yet.</p>`;
    return;
  }
  state.videos.forEach((v) => {
    const row = document.createElement("div");
    row.className = "vrow" + (v.id === state.selected ? " on" : "");
    const status =
      v.status === "ready" ? `${(v.words || []).length} words`
      : v.status === "failed" ? `<span class="bad">failed${v.progress ? ": " + escapeHtml(v.progress) : ""}</span>`
      : `<span class="work">${escapeHtml(v.progress || v.status)}</span>`;
    row.innerHTML = `<div class="vname">${escapeHtml(decodeURIComponent(v.filename || "video"))}</div>
      <div class="vmeta">${v.duration ? fmt(v.duration) + " · " : ""}${status}</div>`;
    if (v.id && v.status !== "uploading") row.onclick = () => selectVideo(v.id);
    list.appendChild(row);
  });
}

function selectVideo(id) {
  state.selected = id;
  const v = state.videos.find((x) => x.id === id);
  const player = $("#sel-player");
  if (player && v && v.r2_key) {
    const url = "/api/media/" + v.r2_key.split("/").map(encodeURIComponent).join("/");
    if (player.dataset.key !== v.r2_key) { player.src = url; player.dataset.key = v.r2_key; }
  }
  renderVideoList();
  highlightSelectedTranscript();
}

// ── Transcript + cutting ─────────────────────────────────────────────
function renderTranscript() {
  const t = $("#transcript");
  const ready = state.videos.filter((v) => v.status === "ready" && v.words);
  if (!ready.length) {
    t.innerHTML = `<p class="empty">Transcripts appear here once your videos finish transcribing.</p>`;
    return;
  }
  t.innerHTML = "";
  ready.forEach((v) => {
    const sec = document.createElement("div");
    sec.className = "tsec";
    sec.dataset.vid = v.id;
    const head = document.createElement("div");
    head.className = "tsec-head";
    head.textContent = decodeURIComponent(v.filename || "video");
    head.onclick = () => selectVideo(v.id);
    sec.appendChild(head);
    const body = document.createElement("div");
    body.className = "tsec-body";
    v.words.forEach((w, i) => {
      const span = document.createElement("span");
      span.className = "word" + (w.deleted ? " deleted" : "");
      span.textContent = w.text + " ";
      span.dataset.i = i;
      body.appendChild(span);
    });
    body.addEventListener("click", (e) => onWordClick(e, v));
    body.addEventListener("dblclick", (e) => onWordDbl(e, v));
    sec.appendChild(body);
    t.appendChild(sec);
  });
  highlightSelectedTranscript();
}

function onWordClick(e, v) {
  const el = e.target.closest(".word");
  if (!el) return;
  const i = +el.dataset.i;
  if (e.shiftKey && v._anchor != null) {
    const [a, b] = [Math.min(v._anchor, i), Math.max(v._anchor, i)];
    const anyKept = v.words.slice(a, b + 1).some((w) => !w.deleted);
    for (let k = a; k <= b; k++) v.words[k].deleted = anyKept;
  } else {
    v.words[i].deleted = !v.words[i].deleted;
    v._anchor = i;
  }
  renderTranscript();
  updateStats();
}

function onWordDbl(e, v) {
  const el = e.target.closest(".word");
  if (!el) return;
  selectVideo(v.id);
  const player = $("#sel-player");
  player.currentTime = v.words[+el.dataset.i].start;
  player.play();
}

function highlightSelectedTranscript() {
  document.querySelectorAll(".tsec").forEach((s) => s.classList.toggle("on", s.dataset.vid === state.selected));
}

function updateStats() {
  if (hasTimeline()) {
    const segs = [...(state.timeline.coldOpen || []), ...(state.timeline.body || [])];
    const dur = segs.reduce((s, x) => s + (x.end - x.start), 0);
    setStats(`arranged ${fmt(dur)} · ${segs.length} segment(s)`);
    return;
  }
  const ready = state.videos.filter((v) => v.status === "ready" && v.words);
  if (!ready.length) { setStats(state.videos.length ? "transcribing…" : ""); return; }
  let kept = 0, total = 0, kw = 0, tw = 0;
  ready.forEach((v) => {
    kept += rangeSeconds(keptRanges(v.words));
    total += v.words.length ? v.words[v.words.length - 1].end - v.words[0].start : 0;
    kw += v.words.filter((w) => !w.deleted).length;
    tw += v.words.length;
  });
  setStats(`${fmt(kept)} kept / ${fmt(total)} · ${kw}/${tw} words · ${ready.length} clip(s)`);
}

// ── Cross-video edit preview ─────────────────────────────────────────
const edit = { playing: false, clips: [], raf: 0, playingEl: null };

// The clips Play edit walks: the arranged Timeline when present, else the
// linear kept ranges across every ready video.
function buildClips() {
  if (hasTimeline()) {
    const segs = [...(state.timeline.coldOpen || []), ...(state.timeline.body || [])];
    return segs
      .map((s) => {
        const v = state.videos.find((x) => x.id === s.videoId);
        return v && v.r2_key ? { videoId: s.videoId, r2_key: v.r2_key, start: s.start, end: s.end } : null;
      })
      .filter(Boolean);
  }
  const clips = [];
  for (const v of state.videos) {
    if (v.status !== "ready" || !v.words) continue;
    for (const r of keptRanges(v.words)) clips.push({ videoId: v.id, r2_key: v.r2_key, start: r.start, end: r.end });
  }
  return clips;
}

const mediaUrl = (key) => "/api/media/" + key.split("/").map(encodeURIComponent).join("/");

function ensureSrc(player, clip) {
  return new Promise((resolve) => {
    if (player.dataset.key === clip.r2_key) return resolve();
    player.dataset.key = clip.r2_key;
    const onReady = () => { player.removeEventListener("canplay", onReady); resolve(); };
    player.addEventListener("canplay", onReady);
    player.src = mediaUrl(clip.r2_key);
    player.load();
  });
}

async function playEdit() {
  const clips = buildClips();
  if (!clips.length) return;
  stopEdit();
  edit.playing = true;
  edit.clips = clips;
  await playClip(0);
}

async function playClip(i) {
  if (!edit.playing) return;
  const clip = edit.clips[i];
  state.selected = clip.videoId;
  renderVideoList();
  highlightSelectedTranscript();
  const player = $("#sel-player");
  await ensureSrc(player, clip);
  if (!edit.playing) return;
  try { player.currentTime = clip.start; await player.play(); } catch { /* autoplay race */ }
  cancelAnimationFrame(edit.raf);
  const tick = () => {
    if (!edit.playing) return;
    highlightPlayhead(clip.videoId, player.currentTime);
    if (player.currentTime >= clip.end - 0.03) {
      if (i + 1 >= edit.clips.length) { stopEdit(); return; }
      playClip(i + 1);
      return;
    }
    edit.raf = requestAnimationFrame(tick);
  };
  edit.raf = requestAnimationFrame(tick);
}

function stopEdit() {
  edit.playing = false;
  cancelAnimationFrame(edit.raf);
  const player = $("#sel-player");
  if (player && !player.paused) player.pause();
  clearPlayhead();
}

function highlightPlayhead(videoId, t) {
  const v = state.videos.find((x) => x.id === videoId);
  if (!v || !v.words) return;
  let idx = -1;
  for (let i = 0; i < v.words.length; i++) {
    const w = v.words[i];
    if (!w.deleted && t >= w.start && t < w.end) { idx = i; break; }
  }
  const sec = document.querySelector(`.tsec[data-vid="${videoId}"] .tsec-body`);
  const next = idx >= 0 && sec ? sec.querySelector(`.word[data-i="${idx}"]`) : null;
  if (next === edit.playingEl) return;
  clearPlayhead();
  if (next) { next.classList.add("playing"); edit.playingEl = next; }
}

function clearPlayhead() {
  if (edit.playingEl) { edit.playingEl.classList.remove("playing"); edit.playingEl = null; }
}

async function saveEdit() {
  const ready = state.videos.filter((v) => v.status === "ready" && v.words);
  if (!ready.length) return;
  const btn = $("#save");
  const label = btn.textContent;
  btn.textContent = "Saving…";
  btn.disabled = true;
  try {
    await Promise.all(ready.map((v) =>
      fetch(`/api/videos/${v.id}/transcript`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(v.words),
      })));
    btn.textContent = "Saved ✓";
    setTimeout(() => { btn.textContent = label; btn.disabled = false; }, 1200);
  } catch {
    btn.textContent = "Save failed";
    btn.disabled = false;
  }
}

// ── Upload + transcribe ──────────────────────────────────────────────
function wireDropzone() {
  const drop = $("#drop");
  $("#file").addEventListener("change", (e) => handleFiles([...e.target.files]));
  ["dragenter", "dragover"].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => handleFiles([...e.dataTransfer.files]));
}

async function handleFiles(files) {
  const media = files.filter((f) => f.type.startsWith("video/") || f.type.startsWith("audio/"));
  for (const file of media) {
    const item = { id: null, filename: encodeURIComponent(file.name), status: "uploading", duration: null, words: null, progress: "uploading…" };
    state.videos.push(item);
    renderVideoList();
    try {
      item.duration = await readDuration(file).catch(() => null);
      const video = await api.uploadVideo(state.project.id, file, item.duration);
      if (video.error) throw new Error(video.error);
      Object.assign(item, video);
      item.status = "transcribing";
      item.progress = "extracting audio…";
      renderVideoList();
      const wav = await Audiox.extractWav(file, (msg) => { item.progress = msg; renderVideoList(); });
      item.progress = "transcribing…";
      renderVideoList();
      const { words } = await api.transcribe(item.id, wav);
      item.words = words;
      item.status = "ready";
      item.progress = "";
      if (!state.selected) state.selected = item.id;
      renderProject();
    } catch (err) {
      item.status = "failed";
      item.progress = err.message || String(err);
      renderVideoList();
    }
  }
}

function readDuration(file) {
  return new Promise((resolve, reject) => {
    const el = document.createElement("video");
    el.preload = "metadata";
    el.onloadedmetadata = () => { URL.revokeObjectURL(el.src); resolve(el.duration); };
    el.onerror = () => { URL.revokeObjectURL(el.src); reject(new Error("no metadata")); };
    el.src = URL.createObjectURL(file);
  });
}

// ── utils ────────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ── boot ─────────────────────────────────────────────────────────────
$("#home").onclick = showProjects;
$("#home").onkeydown = (e) => { if (e.key === "Enter") showProjects(); };

function route() {
  const m = location.hash.match(/^#\/p\/([\w-]+)/);
  if (m) openProject(m[1]);
  else showProjects();
}
window.addEventListener("hashchange", route);
route();
