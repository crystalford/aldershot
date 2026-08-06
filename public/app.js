// Aldershot — project console. Multi-video projects: upload a batch, transcribe
// each, edit as text, AI-arrange a long-form cut, and mine for shorts.
const $ = (s, r = document) => r.querySelector(s);
const main = $("#main");
const toast = (m, o) => UI.toast(m, o);

const fmt = (t) => {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

// inline icons (stroke = currentColor)
const ICON = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  play: '<path d="M7 5l12 7-12 7z" fill="currentColor" stroke="none"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none"/>',
  sparkle: '<path d="M12 3l1.7 4.8L18.5 9.5l-4.8 1.7L12 16l-1.7-4.8L5.5 9.5l4.8-1.7z"/><path d="M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
  film: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9.5h18M8 5v14M16 5v14"/>',
  download: '<path d="M12 3v12M7.5 10.5 12 15l4.5-4.5M5 21h14"/>',
  save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v6h7"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10.5 21 8v8l-5-2.5z"/>',
};
const ic = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICON[n]}</svg>`;
const esc = UI.esc;

// ── API ──────────────────────────────────────────────────────────────
const api = {
  listProjects: () => fetch("/api/projects").then((r) => r.json()),
  createProject: (name) =>
    fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) }).then((r) => r.json()),
  getProject: (id) => fetch(`/api/projects/${id}`).then((r) => r.json()),
  async transcribe(vid, wav) {
    const res = await fetch(`/api/videos/${vid}/transcribe`, { method: "POST", headers: { "content-type": "audio/wav" }, body: wav });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  },
};

// upload with real progress (XHR — fetch can't report upload %)
function uploadVideo(pid, file, duration, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/projects/${pid}/videos`);
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.setRequestHeader("x-filename", encodeURIComponent(file.name));
    xhr.setRequestHeader("x-duration", String(duration || ""));
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      let d = {}; try { d = JSON.parse(xhr.responseText); } catch {}
      xhr.status >= 200 && xhr.status < 300 ? resolve(d) : reject(new Error(d.error || `upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("network error during upload"));
    xhr.send(file);
  });
}

// ── State ────────────────────────────────────────────────────────────
const state = { project: null, videos: [], timeline: null, shorts: null, selected: null };

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
const hasTimeline = () => state.timeline && ((state.timeline.coldOpen || []).length || (state.timeline.body || []).length);

// ── Chrome ───────────────────────────────────────────────────────────
function setCrumbs(items) {
  const el = $("#crumbs"); el.innerHTML = "";
  items.forEach((it, i) => {
    if (i) el.appendChild(Object.assign(document.createElement("span"), { className: "sep", textContent: "/" }));
    const node = document.createElement(it.go ? "a" : "span");
    node.textContent = it.label;
    if (it.go) { node.href = "#"; node.onclick = (e) => { e.preventDefault(); it.go(); }; } else node.className = "cur";
    el.appendChild(node);
  });
}
const setStats = (t) => { $("#stats").textContent = t; };

// ── Projects view ────────────────────────────────────────────────────
async function showProjects() {
  location.hash = "#/"; setCrumbs([]); setStats(""); state.project = null;
  main.innerHTML = `<div class="loading"><span class="spinner"></span> Loading projects…</div>`;
  let projects = [];
  try { projects = (await api.listProjects()).projects || []; }
  catch { main.innerHTML = `<div class="pad"><p class="empty">Couldn't reach the server.</p></div>`; return; }
  main.innerHTML = `
    <section class="pad">
      <div class="row-between">
        <div><h1>Projects</h1><div class="sub">Each project holds the videos you cut together.</div></div>
        <button class="btn primary" id="new">${ic("plus")} New project</button>
      </div>
      <div class="grid" id="grid"></div>
    </section>`;
  $("#new").onclick = newProject;
  const grid = $("#grid");
  const add = document.createElement("button");
  add.className = "card card-new"; add.innerHTML = `${ic("plus")} New project`; add.onclick = newProject;
  if (!projects.length) {
    grid.innerHTML = `<div class="empty big" style="grid-column:1/-1"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICON.folder}</svg>
      <div>No projects yet.<br><span class="empty small">Create one and drop in your videos to get started.</span></div></div>`;
  }
  projects.forEach((p) => {
    const card = document.createElement("button");
    card.className = "card";
    card.innerHTML = `<div class="card-title">${esc(p.name)}</div><div class="card-sub">${new Date(p.created_at).toLocaleString()}</div>`;
    card.onclick = () => openProject(p.id);
    grid.appendChild(card);
  });
  grid.appendChild(add);
}

async function newProject() {
  const name = await UI.prompt({ title: "New project", label: "Project name", value: "", placeholder: "e.g. Getting started in content creation", confirmText: "Create" });
  if (name === null) return;
  try {
    const p = await api.createProject(name.trim() || "Untitled project");
    if (p.error) throw new Error(p.error);
    toast("Project created", { type: "success" });
    openProject(p.id);
  } catch (err) { toast(err.message || "Couldn't create project", { type: "error" }); }
}

// ── Project view ─────────────────────────────────────────────────────
async function openProject(id) {
  location.hash = `#/p/${id}`;
  main.innerHTML = `<div class="loading"><span class="spinner"></span> Loading project…</div>`;
  const data = await api.getProject(id);
  if (data.error) { main.innerHTML = `<div class="pad"><p class="empty">${esc(data.error)}</p></div>`; return; }
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
          ${ic("plus")}
          <strong>Drop videos here</strong>
          <span>or <label class="link">browse<input id="file" type="file" accept="video/*,audio/*" multiple hidden /></label></span>
          <small>Base video + commentary — add as many as you like.</small>
        </div>
        <div class="import">
          <input id="url" class="import-input" placeholder="Paste a Rumble or direct video link…" autocomplete="off" />
          <button class="btn small amber" id="importBtn">Import</button>
        </div>
        <div class="side-h">Videos</div>
        <div class="vlist" id="vlist"></div>
      </aside>
      <section class="stage">
        <div class="toolbar">
          <button class="btn amber" id="playEdit">${ic("play")} Play edit</button>
          <button class="btn" id="stopEdit">${ic("stop")} Stop</button>
          <button class="btn" id="arrange">${ic("sparkle")} Auto-arrange</button>
          <button class="btn" id="findShorts">${ic("film")} Find shorts</button>
          <button class="btn primary" id="export">${ic("download")} Export cut</button>
          <span class="spacer"></span>
          <button class="btn ghost" id="save">${ic("save")} Save</button>
        </div>
        <video id="sel-player" controls playsinline></video>
        <div id="timeline"></div>
        <div id="shorts"></div>
        <p class="hint">Click a word to cut it · shift-click a range · double-click to jump the player there.</p>
        <div class="transcript" id="transcript"></div>
      </section>
    </div>`;
  wireDropzone();
  renderVideoList();
  renderTranscript();
  renderTimeline();
  renderShorts();
  updateStats();
  selectVideo(state.selected);
  $("#playEdit").onclick = playEdit;
  $("#stopEdit").onclick = stopEdit;
  $("#arrange").onclick = (e) => autoArrange(e.currentTarget);
  $("#findShorts").onclick = (e) => findShorts(e.currentTarget);
  $("#export").onclick = (e) => exportCut(e.currentTarget);
  $("#save").onclick = (e) => saveEdit(e.currentTarget);
  $("#importBtn").onclick = importFromUrl;
  $("#url").addEventListener("keydown", (e) => { if (e.key === "Enter") importFromUrl(); });
  $("#sel-player").addEventListener("pause", () => { if (edit.playing) stopEdit(); });
}

function renderVideoList() {
  const list = $("#vlist");
  list.innerHTML = "";
  if (!state.videos.length) { list.innerHTML = `<p class="empty small">No videos yet.</p>`; return; }
  state.videos.forEach((v) => {
    const row = document.createElement("div");
    row.className = "vrow" + (v.id === state.selected ? " on" : "");
    let pill = "", extra = "";
    if (v.status === "ready") pill = `<span class="pill ready">ready</span>`;
    else if (v.status === "failed") pill = `<span class="pill bad">failed</span>`;
    else pill = `<span class="pill work">${esc(v.stage || v.status)}</span>`;

    if (v.status === "uploading") extra = `<div class="progress"><i style="width:${Math.round((v.pct || 0) * 100)}%"></i></div>`;
    else if (v.status === "transcribing" || v.status === "importing") extra = `<div class="progress indeterminate"><i></i></div>`;
    else if (v.status === "failed" && v.error) extra = `<div class="vmeta"><span style="color:var(--bad)">${esc(v.error)}</span></div>`;
    else if (v.status === "ready") extra = `<div class="vmeta">${v.duration ? fmt(v.duration) + " · " : ""}${(v.words || []).length} words</div>`;

    row.innerHTML = `<div class="vrow-top"><span class="vname">${esc(decodeURIComponent(v.filename || "video"))}</span>${pill}</div>${extra}`;
    if (v.id && v.status !== "uploading") row.onclick = () => selectVideo(v.id);
    list.appendChild(row);
  });
}

function selectVideo(id) {
  state.selected = id;
  const v = state.videos.find((x) => x.id === id);
  const player = $("#sel-player");
  if (player && v && v.r2_key) {
    const url = mediaUrl(v.r2_key);
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
    t.innerHTML = `<div class="empty big"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICON.video}</svg>
      <div>Your transcript will appear here.<br><span class="empty small">Add a video — it transcribes automatically.</span></div></div>`;
    return;
  }
  t.innerHTML = "";
  ready.forEach((v) => {
    const sec = document.createElement("div");
    sec.className = "tsec"; sec.dataset.vid = v.id;
    const head = document.createElement("div");
    head.className = "tsec-head"; head.textContent = decodeURIComponent(v.filename || "video");
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
  const el = e.target.closest(".word"); if (!el) return;
  const i = +el.dataset.i;
  if (e.shiftKey && v._anchor != null) {
    const [a, b] = [Math.min(v._anchor, i), Math.max(v._anchor, i)];
    const anyKept = v.words.slice(a, b + 1).some((w) => !w.deleted);
    for (let k = a; k <= b; k++) v.words[k].deleted = anyKept;
  } else { v.words[i].deleted = !v.words[i].deleted; v._anchor = i; }
  renderTranscript(); updateStats();
}
function onWordDbl(e, v) {
  const el = e.target.closest(".word"); if (!el) return;
  selectVideo(v.id);
  const p = $("#sel-player"); p.currentTime = v.words[+el.dataset.i].start; p.play();
}
function highlightSelectedTranscript() {
  document.querySelectorAll(".tsec").forEach((s) => s.classList.toggle("on", s.dataset.vid === state.selected));
}

function updateStats() {
  if (hasTimeline()) {
    const segs = [...(state.timeline.coldOpen || []), ...(state.timeline.body || [])];
    setStats(`arranged ${fmt(segs.reduce((s, x) => s + (x.end - x.start), 0))} · ${segs.length} segment(s)`);
    return;
  }
  const ready = state.videos.filter((v) => v.status === "ready" && v.words);
  if (!ready.length) { setStats(state.videos.length ? "transcribing…" : ""); return; }
  let kept = 0, total = 0, kw = 0, tw = 0;
  ready.forEach((v) => {
    kept += rangeSeconds(keptRanges(v.words));
    total += v.words.length ? v.words[v.words.length - 1].end - v.words[0].start : 0;
    kw += v.words.filter((w) => !w.deleted).length; tw += v.words.length;
  });
  setStats(`${fmt(kept)} kept / ${fmt(total)} · ${kw}/${tw} words · ${ready.length} clip(s)`);
}

// ── Cross-video edit preview ─────────────────────────────────────────
const edit = { playing: false, clips: [], raf: 0, playingEl: null };
const mediaUrl = (key) => "/api/media/" + key.split("/").map(encodeURIComponent).join("/");

function buildClips() {
  if (hasTimeline()) {
    const segs = [...(state.timeline.coldOpen || []), ...(state.timeline.body || [])];
    return segs.map((s) => {
      const v = state.videos.find((x) => x.id === s.videoId);
      return v && v.r2_key ? { videoId: s.videoId, r2_key: v.r2_key, start: s.start, end: s.end } : null;
    }).filter(Boolean);
  }
  const clips = [];
  for (const v of state.videos) {
    if (v.status !== "ready" || !v.words) continue;
    for (const r of keptRanges(v.words)) clips.push({ videoId: v.id, r2_key: v.r2_key, start: r.start, end: r.end });
  }
  return clips;
}

function ensureSrc(player, clip) {
  return new Promise((resolve) => {
    if (player.dataset.key === clip.r2_key) return resolve();
    player.dataset.key = clip.r2_key;
    const onReady = () => { player.removeEventListener("canplay", onReady); resolve(); };
    player.addEventListener("canplay", onReady);
    player.src = mediaUrl(clip.r2_key); player.load();
  });
}

async function playEdit() {
  const clips = buildClips();
  if (!clips.length) { toast("Nothing to play — add a video or cut some words first."); return; }
  stopEdit(); edit.playing = true; edit.clips = clips;
  await playClip(0);
}
async function playClip(i) {
  if (!edit.playing) return;
  const clip = edit.clips[i];
  state.selected = clip.videoId; renderVideoList(); highlightSelectedTranscript();
  const player = $("#sel-player");
  await ensureSrc(player, clip);
  if (!edit.playing) return;
  try { player.currentTime = clip.start; await player.play(); } catch {}
  cancelAnimationFrame(edit.raf);
  const tick = () => {
    if (!edit.playing) return;
    highlightPlayhead(clip.videoId, player.currentTime);
    if (player.currentTime >= clip.end - 0.03) {
      if (i + 1 >= edit.clips.length) { stopEdit(); return; }
      playClip(i + 1); return;
    }
    edit.raf = requestAnimationFrame(tick);
  };
  edit.raf = requestAnimationFrame(tick);
}
function stopEdit() {
  edit.playing = false; cancelAnimationFrame(edit.raf);
  const p = $("#sel-player"); if (p && !p.paused) p.pause();
  clearPlayhead();
}
function highlightPlayhead(videoId, t) {
  const v = state.videos.find((x) => x.id === videoId); if (!v || !v.words) return;
  let idx = -1;
  for (let i = 0; i < v.words.length; i++) { const w = v.words[i]; if (!w.deleted && t >= w.start && t < w.end) { idx = i; break; } }
  const sec = document.querySelector(`.tsec[data-vid="${videoId}"] .tsec-body`);
  const next = idx >= 0 && sec ? sec.querySelector(`.word[data-i="${idx}"]`) : null;
  if (next === edit.playingEl) return;
  clearPlayhead();
  if (next) { next.classList.add("playing"); edit.playingEl = next; }
}
function clearPlayhead() { if (edit.playingEl) { edit.playingEl.classList.remove("playing"); edit.playingEl = null; } }

async function saveEdit(btn) {
  const ready = state.videos.filter((v) => v.status === "ready" && v.words);
  if (!ready.length) return;
  btn.classList.add("loading"); btn.disabled = true;
  try {
    await Promise.all(ready.map((v) =>
      fetch(`/api/videos/${v.id}/transcript`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(v.words) })));
    toast("Edit saved", { type: "success" });
  } catch { toast("Couldn't save edit", { type: "error" }); }
  btn.classList.remove("loading"); btn.disabled = false;
}

// ── AI arrange ───────────────────────────────────────────────────────
async function autoArrange(btn) {
  if (!state.videos.some((v) => v.status === "ready" && v.words)) { toast("Transcribe a video first."); return; }
  btn.classList.add("loading"); btn.disabled = true;
  try {
    const res = await fetch(`/api/projects/${state.project.id}/arrange`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    state.timeline = data.timeline;
    renderTimeline(); updateStats();
    toast("Arranged a cut — refine it below", { type: "success" });
  } catch (err) { toast(err.message || "Auto-arrange failed", { type: "error", title: "Auto-arrange" }); }
  btn.classList.remove("loading"); btn.disabled = false;
}

function renderTimeline() {
  const el = $("#timeline"); if (!el) return;
  if (!hasTimeline()) { el.innerHTML = ""; return; }
  const t = state.timeline;
  const seg = (s, group, idx) => {
    const v = state.videos.find((x) => x.id === s.videoId);
    const name = v ? decodeURIComponent(v.filename || "video") : s.videoId;
    return `<div class="seg" data-g="${group}" data-i="${idx}">
      <span class="seg-time">${fmt(s.start)}–${fmt(s.end)}</span>
      <span class="seg-src">${esc(name)}</span>
      <span class="seg-reason">${esc(s.reason || "")}</span>
      <button class="seg-x" title="Remove">✕</button></div>`;
  };
  el.innerHTML = `<div class="tl">
    <div class="tl-head"><h2>Arranged cut</h2><button class="btn ghost small" id="clearTl">Clear</button></div>
    ${(t.coldOpen || []).length ? `<div class="tl-label">Cold open</div>${t.coldOpen.map((s, i) => seg(s, "coldOpen", i)).join("")}` : ""}
    ${(t.body || []).length ? `<div class="tl-label">Body</div>${t.body.map((s, i) => seg(s, "body", i)).join("")}` : ""}
  </div>`;
  el.querySelectorAll(".seg").forEach((row) => {
    row.querySelector(".seg-x").onclick = (e) => {
      e.stopPropagation();
      state.timeline[row.dataset.g].splice(+row.dataset.i, 1);
      saveTimeline(); renderTimeline(); updateStats();
    };
    row.onclick = () => {
      const s = state.timeline[row.dataset.g][+row.dataset.i];
      selectVideo(s.videoId); const p = $("#sel-player"); p.currentTime = s.start; p.play();
    };
  });
  $("#clearTl").onclick = async () => {
    if (await UI.confirm({ title: "Clear arrangement?", message: "This removes the AI cut and returns to the linear edit.", confirmText: "Clear", danger: true })) {
      state.timeline = null; saveTimeline(); renderTimeline(); updateStats();
    }
  };
}
function saveTimeline() {
  return fetch(`/api/projects/${state.project.id}/timeline`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(state.timeline || { coldOpen: [], body: [] }) });
}

// ── Suggested shorts ─────────────────────────────────────────────────
async function findShorts(btn) {
  if (!state.videos.some((v) => v.status === "ready" && v.words)) { toast("Transcribe a video first."); return; }
  btn.classList.add("loading"); btn.disabled = true;
  try {
    const res = await fetch(`/api/projects/${state.project.id}/shorts`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    state.shorts = data.shorts;
    renderShorts();
    toast(`Found ${data.shorts.length} short${data.shorts.length === 1 ? "" : "s"}`, { type: "success" });
  } catch (err) { toast(err.message || "Find shorts failed", { type: "error", title: "Shorts" }); }
  btn.classList.remove("loading"); btn.disabled = false;
}
function renderShorts() {
  const el = $("#shorts"); if (!el) return;
  const shorts = state.shorts || [];
  if (!shorts.length) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="shorts">
    <div class="tl-head"><h2>Suggested shorts</h2><span class="empty small">${shorts.length}</span></div>
    <div class="short-grid">${shorts.map(shortCard).join("")}</div></div>`;
  shorts.forEach((s, i) => {
    const card = el.querySelector(`.short[data-i="${i}"]`);
    card.querySelector(".s-play").onclick = () => previewShort(s);
    card.querySelector(".s-prod").onclick = (e) => produceShort(s, e.currentTarget);
  });
}
function shortCard(s, i) {
  const v = state.videos.find((x) => x.id === s.videoId);
  const src = v ? decodeURIComponent(v.filename || "video") : s.videoId;
  const score = typeof s.score === "number" ? `<span class="s-score">${s.score}</span>` : "";
  return `<div class="short" data-i="${i}">
    <div class="s-top">${score}<div class="s-title">${esc(s.title)}</div></div>
    <div class="s-hook">${esc(s.hook || "")}</div>
    <div class="s-meta">${fmt(s.start)}–${fmt(s.end)} · ${Math.round(s.end - s.start)}s · ${esc(src)}</div>
    <div class="s-actions"><button class="btn small s-play">${ic("play")} Preview</button><button class="btn small amber s-prod">${ic("download")} Produce</button></div>
  </div>`;
}
async function previewShort(s) {
  stopEdit();
  const v = state.videos.find((x) => x.id === s.videoId); if (!v) return;
  state.selected = s.videoId; renderVideoList(); highlightSelectedTranscript();
  const p = $("#sel-player");
  await ensureSrc(p, { r2_key: v.r2_key });
  p.currentTime = s.start; p.play();
  const stop = () => { if (p.currentTime >= s.end) { p.pause(); p.removeEventListener("timeupdate", stop); } };
  p.addEventListener("timeupdate", stop);
}
async function produceShort(s, btn) {
  const v = state.videos.find((x) => x.id === s.videoId); if (!v) return;
  const prev = btn.innerHTML; btn.disabled = true;
  try {
    const blob = await Renderer.renderShort({ r2_key: v.r2_key, start: s.start, end: s.end }, (msg) => { btn.textContent = msg; });
    downloadBlob(blob, safeName(s.title) + ".mp4");
    toast("Short produced — downloading", { type: "success" });
  } catch (err) { toast(err.message || "Produce failed", { type: "error" }); }
  btn.disabled = false; btn.innerHTML = prev;
}

// ── Long-form export ─────────────────────────────────────────────────
async function exportCut(btn) {
  const clips = buildClips();
  if (!clips.length) { toast("Nothing to export — cut some words or auto-arrange first."); return; }
  const secs = clips.reduce((a, c) => a + (c.end - c.start), 0);
  if (secs > 600 && !(await UI.confirm({ title: "Long render", message: `This cut is ${fmt(secs)}. Rendering in the browser may take a while and use a lot of memory. Continue?`, confirmText: "Render" }))) return;
  const prev = btn.innerHTML; btn.disabled = true;
  try {
    const blob = await Renderer.renderLongform(clips, (msg) => { btn.textContent = msg; });
    downloadBlob(blob, safeName(state.project.name) + "-cut.mp4");
    toast("Cut exported — downloading", { type: "success" });
  } catch (err) { toast(err.message || "Export failed", { type: "error", title: "Export" }); }
  btn.disabled = false; btn.innerHTML = prev;
}
function downloadBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const safeName = (t) => (t || "aldershot").replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "aldershot";

// ── Upload + transcribe ──────────────────────────────────────────────
function wireDropzone() {
  const drop = $("#drop");
  $("#file").addEventListener("change", (e) => handleFiles([...e.target.files]));
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => handleFiles([...e.dataTransfer.files]));
}

async function handleFiles(files) {
  const media = files.filter((f) => f.type.startsWith("video/") || f.type.startsWith("audio/"));
  if (files.length && !media.length) toast("Those files aren't video or audio.", { type: "error" });
  for (const file of media) {
    const item = { id: null, filename: encodeURIComponent(file.name), status: "uploading", pct: 0, duration: null, words: null };
    state.videos.push(item); renderVideoList();
    try {
      item.duration = await readDuration(file);
      item.stage = "uploading…"; renderVideoList();
      const video = await uploadVideo(state.project.id, file, item.duration, (p) => { item.pct = p; renderVideoList(); });
      if (video.error) throw new Error(video.error);
      Object.assign(item, video);
      await transcribeItem(item, file);
    } catch (err) {
      item.status = "failed"; item.error = err.message || String(err); renderVideoList();
      toast(item.error, { type: "error", title: "Upload failed" });
    }
  }
}

// Shared tail: extract audio locally, transcribe, mark ready.
async function transcribeItem(item, file) {
  item.status = "transcribing"; item.stage = "extracting audio…"; renderVideoList();
  const wav = await Audiox.extractWav(file, (msg) => { item.stage = msg; renderVideoList(); });
  item.stage = "transcribing…"; renderVideoList();
  const { words } = await api.transcribe(item.id, wav);
  item.words = words; item.status = "ready"; item.stage = "";
  if (!state.selected) state.selected = item.id;
  renderProject();
  toast(`“${decodeURIComponent(item.filename)}” transcribed`, { type: "success" });
}

// Import a video from a URL (Rumble / direct link) → R2 → transcribe.
async function importFromUrl() {
  const input = $("#url");
  const url = (input.value || "").trim();
  if (!url) return;
  const btn = $("#importBtn");
  btn.classList.add("loading"); btn.disabled = true;
  const item = { id: null, filename: encodeURIComponent("Importing…"), status: "importing", stage: "fetching video…", words: null };
  state.videos.push(item); renderVideoList();
  try {
    const res = await fetch(`/api/projects/${state.project.id}/import`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }),
    });
    const video = await res.json();
    if (!res.ok) throw new Error(video.error || res.statusText);
    Object.assign(item, video);
    input.value = "";
    item.status = "importing"; item.stage = "downloading…"; renderVideoList();
    const blob = await fetch(mediaUrl(video.r2_key)).then((r) => r.blob());
    const file = new File([blob], decodeURIComponent(video.filename || "video.mp4"), { type: blob.type || "video/mp4" });
    await transcribeItem(item, file);
  } catch (err) {
    item.status = "failed"; item.error = err.message || String(err); renderVideoList();
    toast(item.error, { type: "error", title: "Import failed" });
  }
  btn.classList.remove("loading"); btn.disabled = false;
}

// Read duration, but NEVER block the upload: resolve null after a short cap if
// the browser can't produce metadata (this was the "stuck at uploading" hang).
function readDuration(file) {
  return new Promise((resolve) => {
    const el = document.createElement("video"); el.preload = "metadata";
    const done = (val) => { clearTimeout(t); try { URL.revokeObjectURL(el.src); } catch {} resolve(val); };
    const t = setTimeout(() => done(null), 6000);
    el.onloadedmetadata = () => done(isFinite(el.duration) ? el.duration : null);
    el.onerror = () => done(null);
    el.src = URL.createObjectURL(file);
  });
}

// ── boot ─────────────────────────────────────────────────────────────
$("#home").onclick = showProjects;
$("#home").onkeydown = (e) => { if (e.key === "Enter") showProjects(); };
function route() {
  const m = location.hash.match(/^#\/p\/([\w-]+)/);
  if (m) openProject(m[1]); else showProjects();
}
window.addEventListener("hashchange", route);
route();
