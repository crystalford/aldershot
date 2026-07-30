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
        <video id="sel-player" controls playsinline></video>
        <p class="hint">Click a word to cut it · shift-click for a range · double-click to jump the player there.</p>
        <div class="transcript" id="transcript"></div>
      </section>
    </div>`;

  wireDropzone();
  renderVideoList();
  renderTranscript();
  updateStats();
  selectVideo(state.selected);
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
