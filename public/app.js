// Aldershot — project console. Multi-video projects: upload a batch, transcribe
// each, edit as text, AI-arrange a long-form cut, and mine for shorts.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
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
  pause: '<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><path d="M12 17v4M8 21h8"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="1"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  // rail icons — copied literally (viewBox/path/stroke-width) from the
  // prototype's own inline SVGs per the round-3 handoff's fidelity contract
  // ("you are not designing, you are transcribing").
  desk: '<path d="M3 9h18M3 9v10h18V9M3 9l2-4h14l2 4"/><path d="M9 13h6"/>',
  archive: '<circle cx="7" cy="7" r="3"/><circle cx="17" cy="7" r="3"/><circle cx="12" cy="17" r="3"/><line x1="9" y1="9" x2="10.5" y2="14.5"/><line x1="15" y1="9" x2="13.5" y2="14.5"/>',
  upload: '<rect x="3" y="4" width="8" height="6" rx="1"/><rect x="13" y="4" width="8" height="6" rx="1"/><rect x="3" y="14" width="8" height="6" rx="1"/><rect x="13" y="14" width="8" height="6" rx="1"/>',
  threads: '<circle cx="6" cy="6" r="2.2"/><circle cx="18" cy="6" r="2.2"/><circle cx="12" cy="18" r="2.2"/><path d="M8 7l3 9M16 7l-3 9"/>',
  globe: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/>',
  quill: '<rect x="3" y="5" width="7" height="6" rx="1"/><rect x="13" y="5" width="8" height="6" rx="1"/><rect x="3" y="14" width="8" height="6" rx="1"/><rect x="14" y="14" width="7" height="6" rx="1"/>',
  clapper: '<rect x="3" y="5" width="18" height="12" rx="1"/><path d="M8 21h8M12 17v4"/>',
  wand: '<path d="M12 3l1.8 5.6L19 10l-5.2 1.4L12 17l-1.8-5.6L5 10l5.2-1.4z"/><circle cx="19" cy="19" r="2"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.5 8l10 8M8.5 16l10-8"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.4M12 18.6V21M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M3 12h2.4M18.6 12H21M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/>',
  bell: '<path d="M6 8a6 6 0 0112 0c0 4 1.5 6 1.5 6H4.5S6 12 6 8z"/><path d="M9.5 18a2.5 2.5 0 005 0"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 114 2.5c-.6.6-1.5 1-1.5 2.2"/><circle cx="12" cy="17" r=".3" fill="currentColor"/>',
  back: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
};
const ic = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICON[n]}</svg>`;
const esc = UI.esc;
// Filenames aren't URI-encoded, but tolerate old records that were — never throw.
const filenameOf = (v) => { try { return decodeURIComponent(v || "video"); } catch { return v || "video"; } };

// A real frame instead of a text row — every project/clip card in the app
// renders one of these. Grabbed client-side via Thumb.grab (see thumb.js);
// caller must run Thumb.hydrate() on the container once the markup is in
// the DOM. No source video yet → a plain placeholder, same treatment as
// the video-list's own .vthumb.
function frameThumbHTML(r2Key, duration, atSeconds) {
  const durBadge = duration ? `<span class="frame-dur">${fmt(duration)}</span>` : "";
  if (!r2Key) return `<div class="frame-thumb">${ic("video")}</div>`;
  const t = atSeconds ?? Math.min(2, (duration || 4) / 4);
  return `<div class="frame-thumb">
    <img data-thumb-src="${esc(mediaUrl(r2Key))}" data-thumb-t="${t}" alt="" />
    <div class="frame-play">${ic("play")}</div>${durBadge}
  </div>`;
}

// A non-interactive ghost card — shows the shape of the grid a first-time
// visitor is about to fill, instead of a generic empty-state icon.
function skeletonCardHTML(cardClass, bodyClass) {
  return `<div class="${cardClass} skeleton" aria-hidden="true">
    <div class="frame-thumb skel-shimmer"></div>
    <div class="${bodyClass}"><div class="skel-line w60 skel-shimmer"></div><div class="skel-line w35 skel-shimmer"></div></div>
  </div>`;
}

// ── API ──────────────────────────────────────────────────────────────
const api = {
  listProjects: () => fetch("/api/projects").then((r) => r.json()),
  createProject: (name) =>
    fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) }).then((r) => r.json()),
  getProject: (id) => fetch(`/api/projects/${id}`).then((r) => r.json()),
  getClippingProject: () => fetch("/api/clipping/project").then((r) => r.json()),
  getStudioProject: () => fetch("/api/studio/project").then((r) => r.json()),
  async transcribe(vid, wav) {
    const res = await fetch(`/api/videos/${vid}/transcribe`, { method: "POST", headers: { "content-type": "audio/wav" }, body: wav });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  },
};

// ── State ────────────────────────────────────────────────────────────
const state = { project: null, videos: [], timeline: null, shorts: null, suggestions: null, bridges: null, selected: null, trimPausesAbove: null, showCuts: false, textOnly: false, libraryTag: null, studioMode: false };
// A stand-in for the real toolbar buttons autoArrange/findSuggestions/
// findShorts expect (they set .classList/.disabled on whatever's passed in)
// — Studio auto-triggers all three the moment a video's ready, with no
// button click to hand them a real element.
const NOOP_BTN = { classList: { add() {}, remove() {} }, disabled: false };

// A continuous run of KEPT words becomes one range from the first word's start
// to the last word's end — this preserves every natural pause inside it. A
// range only ends where a word was actually deleted (ripple-delete: cutting a
// word closes exactly the gap it occupied, nothing more). Previously this
// merged on a fixed 0.12s gap, which silently treated almost every pause
// between sentences as a cut even when nothing had been deleted.
// `trimPausesAbove` is an explicit opt-in (the "Trim long pauses" toolbar
// action) to additionally hard-cut internal pauses longer than N seconds.
function keptRanges(words, opts = {}) {
  const trimPausesAbove = opts.trimPausesAbove ?? Infinity;
  const out = [];
  let segStart = null, segEnd = null;
  for (const w of words || []) {
    if (w.deleted) {
      if (segStart != null) { out.push({ start: segStart, end: segEnd }); segStart = null; }
      continue;
    }
    if (segStart == null) { segStart = w.start; segEnd = w.end; continue; }
    if (w.start - segEnd > trimPausesAbove) { out.push({ start: segStart, end: segEnd }); segStart = w.start; }
    segEnd = w.end;
  }
  if (segStart != null) out.push({ start: segStart, end: segEnd });
  return out;
}

// Common filler words worth flagging for one-click cleanup (Descript-style).
const FILLER_WORDS = new Set(["um", "umm", "uh", "uhh", "uhm", "er", "erm", "hmm"]);
const isFillerWord = (text) => FILLER_WORDS.has(String(text).toLowerCase().replace(/[^a-z]/gi, ""));
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
// Header stats render as pill badges (per design spec) — split on the " · "
// separator each caller already uses, one pill per segment.
function setStats(t) {
  const el = $("#stats");
  if (!t) { el.innerHTML = ""; return; }
  el.innerHTML = t.split(" · ").map((s) => `<span class="pill-stat">${esc(s)}</span>`).join("");
}

// ── Projects view ────────────────────────────────────────────────────
const SOURCE_STATUS_LABEL = { ready: "Ready", transcribing: "Transcribing", queued: "Queued", failed: "Failed", empty: "Empty" };
const SOURCE_STATUS_COLOR = { ready: "#8fc98f", transcribing: "#e0c46a", queued: "#7fb8bd", failed: "#a85454", empty: "var(--faint)" };
async function showProjects() {
  location.hash = "#/sources"; setActiveRail("sources"); setCrumbs([]); setStats(""); $("#headerActions").innerHTML = ""; state.project = null;
  state.sourceStatusFilter = state.sourceStatusFilter || null;
  main.innerHTML = `<div class="loading"><span class="spinner"></span> Loading projects…</div>`;
  let projects = [];
  try { projects = (await api.listProjects()).projects || []; }
  catch { main.innerHTML = `<div class="pad"><p class="empty">Couldn't reach the server.</p></div>`; return; }
  const statsLine = projects.length ? `${projects.length} source${projects.length === 1 ? "" : "s"} — ${projects.reduce((s, p) => s + (p.clipCount || 0), 0)} clips extracted so far.` : "";
  main.innerHTML = `
    <section class="pad">
      <div class="row-between">
        <div><h1>Sources</h1><div class="sub">Raw uploads — each one holds the videos you cut together. ${statsLine ? `<span class="archive-stats">${esc(statsLine)}</span>` : ""}</div></div>
        <div style="display:flex;gap:8px;">
          <input id="quickAddUrl" class="import-input" placeholder="https://youtube.com/watch?v=…" style="width:240px;" autocomplete="off" />
          <button class="btn ghost" id="quickAdd">${ic("plus")} Add source</button>
          <button class="btn primary" id="new">${ic("plus")} New project</button>
        </div>
      </div>
      <div class="essay-link" id="toClippingLink">Want shorts cut from one of these? → Clipping</div>
      <div class="tag-rail" id="sourceStatusRail"></div>
      <div class="grid" id="grid"></div>
    </section>`;
  $("#new").onclick = newProject;
  $("#quickAdd").onclick = () => quickAddSourceUrl($("#quickAddUrl").value);
  $("#quickAddUrl").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); quickAddSourceUrl($("#quickAddUrl").value); } });
  $("#toClippingLink").onclick = () => showClippingView();
  renderSourceStatusRail(projects);
  renderSourceGrid(projects);
}

function renderSourceStatusRail(allProjects) {
  const el = $("#sourceStatusRail"); if (!el) return;
  const counts = {};
  allProjects.forEach((p) => { counts[p.status || "empty"] = (counts[p.status || "empty"] || 0) + 1; });
  const statuses = Object.keys(SOURCE_STATUS_LABEL).filter((s) => counts[s]);
  if (!statuses.length) { el.innerHTML = ""; return; }
  el.innerHTML = statuses.map((s) =>
    `<span class="tag-chip${state.sourceStatusFilter === s ? " on" : ""}" data-status="${s}" style="border-left:2px solid ${SOURCE_STATUS_COLOR[s]}">${SOURCE_STATUS_LABEL[s]} <span class="tag-count">${counts[s]}</span></span>`,
  ).join("");
  el.querySelectorAll(".tag-chip").forEach((chip) => {
    chip.onclick = () => {
      state.sourceStatusFilter = state.sourceStatusFilter === chip.dataset.status ? null : chip.dataset.status;
      renderSourceStatusRail(allProjects);
      renderSourceGrid(allProjects);
    };
  });
}

function renderSourceGrid(allProjects) {
  const grid = $("#grid"); if (!grid) return;
  const projects = state.sourceStatusFilter ? allProjects.filter((p) => (p.status || "empty") === state.sourceStatusFilter) : allProjects;
  grid.innerHTML = "";
  const add = document.createElement("button");
  add.className = "card card-new"; add.innerHTML = `${ic("plus")} New project`; add.onclick = newProject;
  if (!allProjects.length) {
    grid.innerHTML = `<div class="empty-note" style="grid-column:1/-1">No projects yet — create one and drop in your videos to get started.</div>
      ${skeletonCardHTML("card", "card-body")}${skeletonCardHTML("card", "card-body")}`;
  } else if (!projects.length) {
    grid.innerHTML = `<div class="empty-note" style="grid-column:1/-1">No sources match that status.</div>`;
  }
  projects.forEach((p) => {
    const card = document.createElement("div");
    card.className = "card";
    const status = p.status || "empty";
    card.innerHTML = `<button class="card-delete" title="Delete — goes to Trash">${ic("trash")}</button>
      ${status !== "empty" ? `<span class="source-status-pill" style="color:${SOURCE_STATUS_COLOR[status]};background:${SOURCE_STATUS_COLOR[status]}22;">${SOURCE_STATUS_LABEL[status]}</span>` : ""}
      ${frameThumbHTML(p.thumb_r2_key, p.thumb_duration)}
      <div class="card-body">
        <div class="card-title">${esc(p.name)}</div>
        <div class="card-sub">${new Date(p.created_at).toLocaleString()}${p.clipCount ? ` · ${p.clipCount} clip${p.clipCount === 1 ? "" : "s"}` : ""}</div>
      </div>`;
    card.onclick = () => openProject(p.id);
    card.querySelector(".card-delete").onclick = async (e) => {
      e.stopPropagation();
      if (!(await UI.confirm({ title: "Delete this source?", message: "It moves to Trash, where you can restore it later.", confirmText: "Delete", danger: true }))) return;
      await fetch(`/api/projects/${p.id}`, { method: "DELETE" });
      toast("Moved to Trash", { type: "success" });
      showProjects();
    };
    grid.appendChild(card);
  });
  grid.appendChild(add);
  Thumb.hydrate(grid);
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

// One-action quick add straight from the Sources grid — paste a URL, get a
// new project already importing, no "name it first" modal in between.
async function quickAddSourceUrl(url) {
  url = (url || "").trim();
  if (!url) { toast("Paste a video URL first."); return; }
  try {
    const p = await api.createProject("Untitled source");
    if (p.error) throw new Error(p.error);
    const res = await fetch(`/api/projects/${p.id}/import`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }),
    });
    const video = await res.json();
    if (!res.ok) throw new Error(video.error || res.statusText);
    toast("Importing…", { type: "success" });
    openProject(p.id);
  } catch (err) { toast(err.message || "Couldn't add that source", { type: "error" }); }
}

// ── The Desk — the new home surface: what changed since last time, and
// what's blocking each in-production essay. Stats/digest/suggestions come
// from GET /api/desk (real counts/rows off existing tables, no sample
// data); essay cards come from GET /api/essays, same data the Essays list
// itself uses, scored by the shared computeEssayBlocker().
function deskGo(target) {
  if (!target) return;
  if (target.type === "archive") return showLibrary();
  if (target.type === "sources") return showProjects();
  if (target.type === "threads") return showThreadsView();
  if (target.type === "discover") return showDiscoverView();
  if (target.type === "clipping") return showClippingView();
  if (target.type === "essays") return showEssaysList();
  if (target.type === "studio") return showStudioView();
  if (target.type === "project") return openProject(target.id);
}
async function showDeskView() {
  location.hash = "#/desk"; setActiveRail("desk");
  setCrumbs([]); setStats(""); $("#headerActions").innerHTML = ""; state.project = null;
  main.innerHTML = `<div class="loading"><span class="spinner"></span> Loading…</div>`;
  let desk, essays;
  try {
    [desk, essays] = await Promise.all([
      fetch("/api/desk").then((r) => r.json()),
      fetch("/api/essays").then((r) => r.json()).then((d) => d.essays || []),
    ]);
    if (desk.error) throw new Error(desk.error);
  } catch {
    main.innerHTML = `<div class="pad"><p class="empty">Couldn't reach the server.</p></div>`;
    return;
  }
  const deskEssays = essays.slice(0, 4).map((e) => ({ e, blocker: computeEssayBlocker(e) }));
  main.innerHTML = `<section class="pad">
    <div class="row-between" style="align-items:flex-end;">
      <div><h1>The Desk</h1><div class="sub">${esc(desk.date)} — what the archive did while you were away, and what's blocking each piece.</div></div>
      <div class="desk-stats">
        ${[
          ["clips in the archive", desk.stats.archiveClips, "archive"],
          ["sources processing", desk.stats.sourcesProcessing, "sources"],
          ["threads detected", desk.stats.threadsDetected, "threads"],
          ["highlights to review", desk.stats.highlightsToReview, "clipping"],
        ].map(([label, value, go]) => `<div class="desk-stat" data-go="${go}"><div class="desk-stat-value">${value}</div><div class="desk-stat-label">${esc(label)}</div></div>`).join("")}
      </div>
    </div>

    <div class="desk-section">
      <div class="tools-h">Since you were last here</div>
      ${desk.digest.length
        ? `<div class="desk-digest">${desk.digest.map((d, i) => `<div class="desk-digest-row" data-i="${i}"><span class="desk-digest-dot" style="background:${d.color}"></span><span>${esc(d.text)}</span></div>`).join("")}</div>`
        : `<div class="empty-note">Nothing new since last time.</div>`}
    </div>

    <div class="desk-section">
      <div class="tools-h">In production</div>
      ${deskEssays.length
        ? `<div class="grid" id="deskEssays"></div>`
        : `<div class="empty-note">No essays in progress yet.</div>`}
    </div>

    ${desk.suggestions.length ? `<div class="desk-section">
      <div class="tools-h">Worth your attention</div>
      <div class="desk-suggestions">
        ${desk.suggestions.map((s, i) => `<div class="desk-suggestion" style="border-left-color:${s.color}">
          <div class="pill" style="color:${s.color};background:${s.color}22;">${esc(s.kind)}</div>
          <div class="desk-suggestion-title">${esc(s.title)}</div>
          <div class="desk-suggestion-desc">${esc(s.desc)}</div>
          <button class="btn small ghost" data-i="${i}">${esc(s.cta)}</button>
        </div>`).join("")}
      </div>
    </div>` : ""}
  </section>`;

  $$(".desk-stat").forEach((el) => { el.onclick = () => deskGo({ type: el.dataset.go }); });
  $$(".desk-digest-row").forEach((el) => { el.onclick = () => deskGo(desk.digest[+el.dataset.i].go); });
  $$(".desk-suggestions .btn").forEach((btn) => { btn.onclick = () => deskGo(desk.suggestions[+btn.dataset.i].go); });

  if (deskEssays.length) {
    const grid = $("#deskEssays");
    deskEssays.forEach(({ e, blocker }) => {
      const segTotal = e.beats.length || 1;
      const counts = {};
      e.beats.forEach((b) => { const st = beatResolutionStatus(b); counts[st] = (counts[st] || 0) + 1; });
      const segs = Object.entries(counts).map(([st, n]) => `<div style="width:${(n / segTotal) * 100}%;background:${BEAT_STATUS_COLOR[st] || "var(--faint)"}"></div>`).join("");
      const card = document.createElement("div");
      card.className = "card desk-essay-card";
      card.innerHTML = `<div class="card-body">
        <div class="card-title">${esc(e.title)}</div>
        ${e.beats.length ? `<div class="desk-essay-bar">${segs}</div>` : ""}
        <div class="row-between" style="margin-top:10px;">
          <span class="essay-blocker" style="color:${blocker.color}">${esc(blocker.label)}</span>
          <button class="btn small ghost desk-essay-go">Go →</button>
        </div>
      </div>`;
      card.onclick = () => { location.hash = `#/essays/${e.id}`; };
      card.querySelector(".desk-essay-go").onclick = (ev) => { ev.stopPropagation(); openEssayAtMode(e.id, blocker.mode); };
      grid.appendChild(card);
    });
  }
}

// ── Project view ─────────────────────────────────────────────────────
async function openProject(id) {
  location.hash = `#/p/${id}`; setActiveRail("sources");
  main.innerHTML = `<div class="loading"><span class="spinner"></span> Loading project…</div>`;
  const data = await api.getProject(id);
  if (data.error) { main.innerHTML = `<div class="pad"><p class="empty">${esc(data.error)}</p></div>`; return; }
  state.project = data.project;
  state.videos = (data.videos || []).map((v) => ({ ...v }));
  state.timeline = data.timeline;
  state.shorts = data.shorts;
  state.suggestions = data.suggestions;
  state.bridges = null;
  state.selected = state.videos.find((v) => v.status === "ready")?.id || state.videos[0]?.id || null;
  setCrumbs([{ label: "Sources", go: showProjects }, { label: data.project.name }]);
  renderProject();
}

function renderProject() {
  main.innerHTML = `
    <div class="editor-shell">
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
            <button class="btn small accent" id="importBtn">Import</button>
          </div>
          <div class="side-h">Videos</div>
          <div class="vlist" id="vlist"></div>
        </aside>

        <section class="stage">
          <div class="video-wrap" id="videoWrap">
            <video id="sel-player" playsinline></video>
            <div class="video-playbtn" id="videoPlayBtn" aria-hidden="true">${ic("play")}</div>
          </div>
          <div class="ruler" id="ruler"></div>

          <h1 class="doc-title" id="docTitle">Transcript</h1>
          <div id="aiSummaryCallout"></div>

          <div class="sel-toolbar" id="selToolbar">
            <span id="selCount"></span>
            <span id="selThreadMatch" class="sel-thread-match"></span>
            <span class="sel-toolbar-div"></span>
            <button class="chip-btn" id="selAddCut" title="Add this selection to the Cut list, where you can drag it into any order">Add to Cut</button>
            <button class="chip-btn" id="selSaveClip" title="Save this selection to the cross-project Archive">Save to Archive</button>
            <button class="chip-btn" id="selReaction" title="Find a clip already in your library that would land as a reaction/cutaway right after this line">Reaction clip</button>
            <button class="chip-btn" id="selDelete">Delete</button>
            <button class="chip-btn" id="selClear">Clear</button>
          </div>

          <div class="toolbar toolbar-edit">
            <button class="btn small ghost" id="undoBtn" title="Undo">↶ Undo</button>
            <button class="btn small ghost" id="redoBtn" title="Redo">↷ Redo</button>
            <button class="btn small ghost" id="removeFillers">Remove fillers</button>
            <button class="btn small ghost" id="trimPauses">Trim long pauses</button>
            <button class="btn small ghost" id="showCuts" title="Show/hide cut words">Show cuts</button>
            <button class="btn small ghost" id="textOnly" title="Hide the video preview and focus on the text">Text only</button>
            <span class="spacer"></span>
            <div class="search-box">
              <input id="search" placeholder="Search transcript…" autocomplete="off" />
              <span class="search-count" id="searchCount"></span>
              <button class="search-nav" id="searchPrev" title="Previous match">‹</button>
              <button class="search-nav" id="searchNext" title="Next match">›</button>
            </div>
          </div>

          <p class="hint">Click to place your cursor, drag to select — <b>Backspace</b>/<b>Delete</b> cuts, <b>Enter</b> starts a new paragraph · select text and choose <b>Add to Cut</b> to reorder sentences (drag them in the Cut tab) · toggle <b>Show cuts</b> to see/restore deleted words · double-click to jump &amp; play · space to play/pause.</p>
          <div class="transcript" id="transcript"></div>
        </section>

        <aside class="tools" id="tools">
          <div class="tools-scroll">
            <div class="tools-actions">
              <button class="btn accent" id="playEdit">${ic("play")} Play edit</button>
              <button class="btn ghost" id="stopEdit">${ic("stop")} Stop</button>
              <button class="btn ghost" id="save">${ic("save")} Save</button>
            </div>

            ${state.studioMode ? `
            <div class="tools-h" style="color:#e0c46a">Suggested cuts</div>
            <div id="suggest" class="tool-panel"></div>
            <div class="tools-h" style="color:#7fb8bd">Clip candidates</div>
            <div id="shorts" class="tool-panel"></div>
            <div class="tools-h" style="color:#8a7bd4">Video ideas</div>
            <div id="timeline" class="tool-panel"></div>
            <div id="bridges" class="tool-panel"></div>
            <button class="btn ghost" id="startEssay" style="width:100%;margin-top:10px;">${ic("sparkle")} Start as essay →</button>
            ` : `
            <div class="tools-h">AI tools</div>
            <div class="tools-actions col">
              <button class="btn" id="arrange">${ic("sparkle")} Auto-arrange</button>
              <button class="btn" id="suggestEdits">${ic("sparkle")} Suggested edits</button>
              <button class="btn" id="findShorts">${ic("film")} Find shorts</button>
              <button class="btn" id="findBridges" title="Find gaps in the Cut that need spoken narration to connect, and write it">${ic("sparkle")} Find bridges</button>
            </div>
            <div class="direct-box-wrap">
              <div class="direct-label">${ic("sparkle")}<span>Direct the edit</span><small>— describe what you want, in your own words</small></div>
              <div class="direct-box col">
                <textarea id="directInput" rows="2" placeholder='e.g. "A video about how the host keeps interrupting the guest"'></textarea>
                <button class="btn primary" id="directBtn">${ic("sparkle")} Generate edit</button>
              </div>
            </div>

            <div class="tools-tabs" id="toolsTabs">
              <span class="tool-tab on" data-tab="cut">Cut</span>
              <span class="tool-tab" data-tab="suggest">Suggestions</span>
              <span class="tool-tab" data-tab="shorts">Shorts</span>
            </div>
            <div id="timeline" class="tool-panel" data-panel="cut"></div>
            <div id="bridges" class="tool-panel" data-panel="cut"></div>
            <div id="suggest" class="tool-panel" data-panel="suggest" hidden></div>
            <div id="shorts" class="tool-panel" data-panel="shorts" hidden></div>
            `}
          </div>
        </aside>
      </div>

      <footer class="editor-footer">
        <div class="transport">
          <span class="t-btn" id="tRewind" title="Back 5s">⏮</span>
          <span class="t-btn t-play" id="tPlay" title="Play/Pause (space)">▶</span>
          <span class="t-btn" id="tForward" title="Forward 5s">⏭</span>
          <span class="t-time mono" id="tTime">0:00 / 0:00</span>
          <span class="t-btn t-speed" id="tSpeed" title="Playback speed">1x</span>
          <span class="t-btn" id="tJump" title="Jump to what's playing in the transcript">Jump to text</span>
          <span class="spacer"></span>
        </div>
        <div class="filmstrip" id="filmstrip"></div>
        <div class="phrase-chips" id="phraseChips"></div>
      </footer>
    </div>`;
  $("#headerActions").innerHTML = `<button class="btn primary" id="export">${ic("download")} Export</button>`;
  wireDropzone();
  renderVideoList();
  renderTranscript();
  renderTimeline();
  renderBridges();
  renderShorts();
  renderSuggestions();
  renderRuler();
  updateStats();
  wireTransport();
  wireVideoOverlay();
  wireToolsTabs();
  selectVideo(state.selected);
  $("#playEdit").onclick = playEdit;
  $("#stopEdit").onclick = stopEdit;
  $("#arrange")?.addEventListener("click", (e) => autoArrange(e.currentTarget));
  $("#findShorts")?.addEventListener("click", (e) => findShorts(e.currentTarget));
  $("#findBridges")?.addEventListener("click", (e) => findBridges(e.currentTarget));
  $("#suggestEdits")?.addEventListener("click", (e) => findSuggestions(e.currentTarget));
  $("#directBtn")?.addEventListener("click", (e) => runDirectedEdit(e.currentTarget));
  $("#directInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); runDirectedEdit($("#directBtn")); }
  });
  // "Start as essay" is a plain escape hatch, not a Studio-specific flow —
  // reuse the same New Essay wizard the Essays list uses.
  $("#startEssay")?.addEventListener("click", startNewEssay);
  $("#export").onclick = (e) => exportCut(e.currentTarget);
  $("#save").onclick = (e) => saveEdit(e.currentTarget);
  $("#importBtn").onclick = importFromUrl;
  $("#url").addEventListener("keydown", (e) => { if (e.key === "Enter") importFromUrl(); });
  $("#undoBtn").onclick = undo;
  $("#redoBtn").onclick = redo;
  $("#selAddCut").onclick = addSelectionToCut;
  $("#selSaveClip").onclick = saveSelectionToLibrary;
  $("#selReaction").onclick = findReactionClipForSelection;
  $("#selDelete").onclick = deleteSelection;
  $("#selClear").onclick = clearSelection;
  $("#removeFillers").onclick = removeFillers;
  $("#trimPauses").onclick = toggleTrimPauses;
  $("#trimPauses").classList.toggle("accent", !!state.trimPausesAbove);
  $("#showCuts").onclick = toggleShowCuts;
  $("#showCuts").classList.toggle("accent", state.showCuts);
  $("#transcript").classList.toggle("show-cuts", state.showCuts);
  $("#textOnly").onclick = toggleTextOnly;
  $("#textOnly").classList.toggle("accent", state.textOnly);
  $(".editor-shell")?.classList.toggle("text-only", state.textOnly);
  $("#search").addEventListener("input", (e) => runSearch(e.target.value));
  $("#search").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); gotoMatch(searchIdx + (e.shiftKey ? -1 : 1)); }
  });
  $("#searchPrev").onclick = () => gotoMatch(searchIdx - 1);
  $("#searchNext").onclick = () => gotoMatch(searchIdx + 1);
  const player = $("#sel-player");
  player.addEventListener("pause", () => { if (edit.playing) stopEdit(); });
  player.addEventListener("timeupdate", onPlayerTimeUpdate);
}

// ── Tabbed results dock (Cut / Suggestions / Shorts) in the right rail ──
function wireToolsTabs() {
  $("#toolsTabs")?.querySelectorAll(".tool-tab").forEach((tab) => {
    tab.onclick = () => switchToolsTab(tab.dataset.tab);
  });
}
function switchToolsTab(name) {
  // Studio's sidebar has no tabs — its three sections (Suggested cuts / Clip
  // candidates / Video ideas) are always visible side by side, so there's
  // nothing to switch.
  if (state.studioMode) return;
  $("#toolsTabs")?.querySelectorAll(".tool-tab").forEach((t) => t.classList.toggle("on", t.dataset.tab === name));
  document.querySelectorAll(".tool-panel").forEach((p) => { p.hidden = p.dataset.panel !== name; });
}

// ── Video click-to-play/pause overlay — without native `controls`, the video
// had nothing clickable on it at all (only the footer transport, easy to
// miss). Standard YouTube-style pattern: a persistent play triangle while
// paused, click anywhere on the video to toggle. The indicator itself is a
// plain non-focusable <div> (not a <button>) with pointer-events disabled —
// a real button would steal focus on click, which the global spacebar
// play/pause handler doesn't account for and would double-fire.
function wireVideoOverlay() {
  const wrap = $("#videoWrap");
  const player = $("#sel-player");
  const btn = $("#videoPlayBtn");
  if (!wrap || !player || !btn) return;
  const sync = () => {
    wrap.classList.toggle("paused", player.paused);
    btn.innerHTML = player.paused ? ic("play") : ic("pause");
  };
  wrap.onclick = () => { if (!player.src) return; if (player.paused) player.play(); else player.pause(); };
  player.addEventListener("play", sync);
  player.addEventListener("pause", sync);
  sync();
}

// ── Custom transport (replaces native video controls, Descript-style) ──
function wireTransport() {
  const player = $("#sel-player");
  const playBtn = $("#tPlay");
  const speeds = [1, 1.5, 2, 0.5];
  let speedIdx = 0;
  $("#tRewind").onclick = () => { player.currentTime = Math.max(0, player.currentTime - 5); };
  $("#tForward").onclick = () => { player.currentTime = Math.min(player.duration || 1e9, player.currentTime + 5); };
  playBtn.onclick = () => { if (player.paused) player.play(); else player.pause(); };
  $("#tSpeed").onclick = (e) => {
    speedIdx = (speedIdx + 1) % speeds.length;
    player.playbackRate = speeds[speedIdx];
    e.currentTarget.textContent = `${speeds[speedIdx]}x`;
  };
  $("#tJump").onclick = () => { edit.playingEl?.scrollIntoView({ block: "center", behavior: "smooth" }); };
  player.addEventListener("play", () => { playBtn.textContent = "⏸"; });
  player.addEventListener("pause", () => { playBtn.textContent = "▶"; });
  updateTransportTime();
}
function updateTransportTime() {
  const player = $("#sel-player"); const el = $("#tTime");
  if (!player || !el) return;
  el.textContent = `${fmt(player.currentTime)} / ${fmt(player.duration || 0)}`;
}
function onPlayerTimeUpdate() {
  updateRulerPlayhead();
  updateFilmstripPlayhead();
  updateTransportTime();
  const v = state.videos.find((x) => x.id === state.selected);
  if (v) highlightPlayhead(v.id, $("#sel-player").currentTime);
  updatePhraseChipActive();
}

document.addEventListener("keydown", (e) => {
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea") return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
  } else if (e.key === "Backspace" || e.key === "Delete") {
    if (selectedEls.length) { e.preventDefault(); deleteSelection(); }
    else if (caretVideo && caretIndex >= 0) { e.preventDefault(); e.key === "Backspace" ? backspaceAtCaret() : deleteForwardAtCaret(); }
  } else if (e.key === "Enter") {
    if (caretVideo && caretIndex >= 0) { e.preventDefault(); insertBreakAtCaret(); }
  } else if (e.key === "Escape") {
    clearSelection();
    clearCaret();
  } else if (e.key === " " && $("#sel-player")) {
    e.preventDefault();
    const p = $("#sel-player");
    if (p.paused) p.play(); else p.pause();
  }
});

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
    else if (v.status === "transcribing" || v.status === "importing") {
      extra = `<div class="progress indeterminate"><i></i></div>`;
      // Always offer a restart, even mid-flight — nothing recovers a truly stuck job on its own.
      if (v.id && v.r2_key) extra += `<button class="btn small ghost retry-btn">Restart transcription</button>`;
    } else if (v.status === "failed") {
      extra = `<div class="vmeta"><span style="color:var(--bad)">${esc(v.error || "failed")}</span></div>`;
      // The upload itself already succeeded (v.id + r2_key exist) — retry without re-uploading.
      if (v.id && v.r2_key) extra += `<button class="btn small ghost retry-btn">Retry transcription</button>`;
    } else if (v.status === "ready") {
      const wc = (v.words || []).length;
      extra = `<div class="vmeta">${v.duration ? fmt(v.duration) + " · " : ""}${wc} words${wc === 0 ? ` <span style="color:var(--bad)">— empty, try again</span>` : ""}</div>`;
      if (v.id && v.r2_key) extra += `<button class="btn small ghost retry-btn">Re-transcribe</button>`;
      if (v.id && v.r2_key) extra += `<button class="btn small ghost enhance-btn" title="Denoise, level, and loudness-normalize this recording">Enhance audio</button>`;
    }

    const thumb = v.r2_key
      ? `<div class="vthumb"><img data-thumb-src="${esc(mediaUrl(v.r2_key))}" data-thumb-t="${Math.min(2, (v.duration || 4) / 4)}" alt="" /><span class="vthumb-play">${ic("play")}</span></div>`
      : `<div class="vthumb placeholder">${ic("video")}</div>`;

    row.innerHTML = `<div class="vrow-top">${thumb}<div class="vrow-info"><div class="vrow-line"><span class="vname">${esc(filenameOf(v.filename))}</span>${pill}</div>${extra}</div></div>`;
    if (v.id && v.status !== "uploading") row.onclick = () => selectVideo(v.id);
    const retryBtn = row.querySelector(".retry-btn");
    if (retryBtn) retryBtn.onclick = (e) => { e.stopPropagation(); retryVideo(v); };
    const enhanceBtn = row.querySelector(".enhance-btn");
    if (enhanceBtn) enhanceBtn.onclick = (e) => { e.stopPropagation(); enhanceAudioFlow(v); };
    list.appendChild(row);
  });
  Thumb.hydrate(list);
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
  renderRuler();
  renderFilmstrip();
  renderPhraseChips();
  const title = $("#docTitle");
  if (title) title.textContent = v ? filenameOf(v.filename).replace(/\.[a-z0-9]+$/i, "") : "Transcript";
  const summaryEl = $("#aiSummaryCallout");
  if (summaryEl) {
    summaryEl.innerHTML = state.project?.kind !== "source" ? "" : `<div class="ai-summary-callout">
      <div class="ai-summary-eyebrow">AI summary</div>
      <div>${v && v.status === "ready" ? esc(v.summary || "AI summary pending — this source hasn't finished analysis yet.") : "AI summary pending — this source hasn't finished analysis yet."}</div>
    </div>`;
  }
}

// ── Filmstrip — a row of real frame thumbnails across the selected video,
// with a playhead marker, so scrubbing a long video doesn't mean guessing
// blind at a bare seek bar (Descript/Premiere-style).
// Kept modest — each frame spins up its own hidden <video> to seek/decode a
// frame from the (often large, remotely-streamed) source; too many at once
// contends with the main preview player and was part of the reported jank.
const FILM_FRAMES = 10;
function renderFilmstrip() {
  const el = $("#filmstrip"); if (!el) return;
  // Skip in text-only mode — this is the single biggest resource hog on the
  // page (up to FILM_FRAMES concurrent hidden <video> elements each seeking
  // into the source to grab a frame), and it's hidden anyway.
  if (state.textOnly) { el.innerHTML = ""; return; }
  const v = state.videos.find((x) => x.id === state.selected);
  if (!v || !v.r2_key || !v.duration) { el.innerHTML = ""; return; }
  const url = mediaUrl(v.r2_key);
  const frames = Array.from({ length: FILM_FRAMES }, (_, i) => (v.duration * (i + 0.5)) / FILM_FRAMES);
  el.innerHTML = `<div class="film-track" id="filmTrack">
    ${frames.map((t) => `<img class="film-frame" data-thumb-src="${esc(url)}" data-thumb-t="${t.toFixed(1)}" alt="" />`).join("")}
    <div class="film-playhead" id="filmPlayhead"></div>
  </div>`;
  Thumb.hydrate(el);
  $("#filmTrack").onclick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    $("#sel-player").currentTime = pct * v.duration;
  };
}
function updateFilmstripPlayhead() {
  if (state.textOnly) return;
  const v = state.videos.find((x) => x.id === state.selected);
  const ph = $("#filmPlayhead");
  if (!v || !ph || !v.duration) return;
  const t = $("#sel-player").currentTime;
  ph.style.left = `${Math.min(100, Math.max(0, (t / v.duration) * 100))}%`;
}

// ── Phrase chips — quick-nav strip of each paragraph's opening words, so you
// can jump the player straight to a moment instead of hunting through text.
let phraseChipRanges = [];
let activePhraseChipIdx = -1;
function renderPhraseChips() {
  const el = $("#phraseChips"); if (!el) return;
  activePhraseChipIdx = -1;
  if (state.textOnly) { el.innerHTML = ""; phraseChipRanges = []; return; }
  const v = state.videos.find((x) => x.id === state.selected);
  if (!v || !v.words || !v.words.length) { el.innerHTML = ""; phraseChipRanges = []; return; }
  const paras = groupIntoParagraphs(v.words);
  phraseChipRanges = [];
  el.innerHTML = paras.map((idxs) => {
    const kept = idxs.map((i) => v.words[i]).filter((w) => !w.deleted);
    if (!kept.length) return "";
    const label = kept.slice(0, 4).map((w) => w.text).join(" ");
    const start = v.words[idxs[0]].start;
    const end = v.words[idxs[idxs.length - 1]].end;
    const n = phraseChipRanges.length;
    phraseChipRanges.push({ start, end });
    return `<span class="phrase-chip" data-n="${n}">"${esc(label)}"</span>`;
  }).join("");
  el.querySelectorAll(".phrase-chip").forEach((chip) => {
    chip.onclick = () => { $("#sel-player").currentTime = phraseChipRanges[+chip.dataset.n].start; };
  });
  updatePhraseChipActive();
}
function updatePhraseChipActive() {
  if (state.textOnly) return;
  const el = $("#phraseChips"); if (!el || !phraseChipRanges.length) return;
  const t = $("#sel-player").currentTime;
  // Binary search (ranges are chronological) instead of scanning every
  // paragraph on each tick, and only touch the DOM when the active chip
  // actually changes instead of re-toggling every chip every tick.
  let lo = 0, hi = phraseChipRanges.length - 1, idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (phraseChipRanges[mid].start <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (idx >= 0 && t >= phraseChipRanges[idx].end) idx = -1;
  if (idx === activePhraseChipIdx) return;
  if (activePhraseChipIdx >= 0) el.querySelector(`.phrase-chip[data-n="${activePhraseChipIdx}"]`)?.classList.remove("on");
  if (idx >= 0) el.querySelector(`.phrase-chip[data-n="${idx}"]`)?.classList.add("on");
  activePhraseChipIdx = idx;
}

// ── Transcript + cutting ─────────────────────────────────────────────
// Paragraphs are mounted progressively (not all up front) — a transcript in
// the thousands of words means a *lot* of live DOM elements, which is real,
// sustained weight regardless of what you're doing on the page. The first
// PARA_CHUNK paragraphs render synchronously so there's something to look at
// immediately; the rest mount automatically as a sentinel element near the
// bottom of what's loaded scrolls into view (the same "infinite scroll"
// pattern feeds use) via IntersectionObserver. Nothing ever un-mounts once
// built, so every other system that touches word elements (selection,
// caret, playhead, undo/redo) needs zero changes — they already tolerate a
// word not existing yet via optional chaining. Search is the one thing that
// genuinely needs to see the whole document regardless of scroll position,
// so it's data-driven (reads v.words directly) rather than DOM-driven —
// see runSearch()/gotoMatch() below.
const PARA_CHUNK = 60;
function buildParaEl(v, idxs) {
  const p = document.createElement("p");
  p.className = "para";
  let anyKept = false;
  idxs.forEach((i, k) => {
    const w = v.words[i];
    const span = document.createElement("span");
    let cls = "word";
    if (w.deleted) cls += " deleted";
    else { anyKept = true; if (isFillerWord(w.text)) cls += " filler"; }
    if (v._selStart != null && i >= v._selStart && i <= v._selEnd) cls += " selected";
    if (v._matchSet?.has(i)) cls += " match";
    span.className = cls;
    span.textContent = (k === 0 ? capitalizeFirst(w.text) : w.text) + " ";
    span.dataset.i = i;
    v._wordEls[i] = span;
    p.appendChild(span);
  });
  if (!anyKept) p.classList.add("all-cut");
  return p;
}
// Mounts the next PARA_CHUNK paragraphs for `v` into `body` (inserted before
// the sentinel, so the sentinel — and the observer watching it — always
// stays at the very end of what's currently mounted).
function mountNextChunk(v, body) {
  const start = v._mountedCount;
  const end = Math.min(start + PARA_CHUNK, v._paras.length);
  const frag = document.createDocumentFragment();
  for (let p = start; p < end; p++) frag.appendChild(buildParaEl(v, v._paras[p]));
  const sentinel = body.querySelector(".scroll-sentinel");
  if (sentinel) body.insertBefore(frag, sentinel); else body.appendChild(frag);
  v._mountedCount = end;
  if (v._mountedCount >= v._paras.length) {
    if (sentinel) { v._observer?.disconnect(); sentinel.remove(); }
    return;
  }
  if (!sentinel) {
    const s = document.createElement("div");
    s.className = "scroll-sentinel";
    body.appendChild(s);
    v._observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) mountNextChunk(v, body);
    }, { root: $(".stage"), rootMargin: "800px 0px" });
    v._observer.observe(s);
  }
}
// For search navigation (jumping to a specific match) and undo/redo's
// length-mismatch fallback — mounts chunks up through whichever paragraph
// contains word index `i`, if it isn't mounted already.
function ensureWordMounted(v, i) {
  if (v._wordEls?.[i]) return;
  const body = document.querySelector(`.tsec[data-vid="${v.id}"] .tsec-body`);
  if (!body || !v._paras) return;
  const pidx = v._paras.findIndex((idxs) => idxs.includes(i));
  if (pidx < 0) return;
  while (v._mountedCount <= pidx && v._mountedCount < v._paras.length) mountNextChunk(v, body);
}
function renderTranscript() {
  const t = $("#transcript");
  state.videos.forEach((v) => v._observer?.disconnect());
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
    head.className = "tsec-head"; head.textContent = filenameOf(v.filename);
    head.onclick = () => selectVideo(v.id);
    sec.appendChild(head);
    const body = document.createElement("div");
    body.className = "tsec-body";
    // Cache a direct index → element lookup (populated as paragraphs mount)
    // so the playhead highlighter never has to `querySelector` the DOM on
    // every timeupdate — that's an O(words) scan per tick, which is the
    // difference between smooth playback and visible stutter once a
    // transcript runs into the thousands of words.
    v._wordEls = new Array(v.words.length);
    v._paras = groupIntoParagraphs(v.words);
    v._mountedCount = 0;
    mountNextChunk(v, body);
    body.addEventListener("click", (e) => onWordClick(e, v));
    body.addEventListener("dblclick", (e) => onWordDbl(e, v));
    sec.appendChild(body);
    t.appendChild(sec);
  });
  highlightSelectedTranscript();
  runSearch($("#search")?.value || "");
}

// Toggling a single word's deleted state never changes which paragraph it
// belongs to (grouping is by raw timing gaps across ALL words, deleted or
// not) — so a cut/restore never needs to touch the DOM tree, just the
// classes on the one <span> that changed. Full renderTranscript() rebuilds
// every span for every video from scratch; on a several-thousand-word
// transcript that's the difference between an instant edit and a visible
// stutter on every keystroke. Reserve renderTranscript() for when the DOM
// actually needs new elements (a video's words rendering for the first time).
function syncWordClass(v, i) {
  const el = v._wordEls?.[i]; if (!el) return;
  const w = v.words[i];
  el.classList.toggle("deleted", !!w.deleted);
  el.classList.toggle("filler", !w.deleted && isFillerWord(w.text));
  const p = el.parentElement;
  if (p?.classList.contains("para")) {
    p.classList.toggle("all-cut", !Array.from(p.children).some((c) => !c.classList.contains("deleted")));
  }
}
function syncWordClasses(v) { v.words.forEach((_, i) => syncWordClass(v, i)); }
// Search results were previously refreshed as a side effect of the full
// renderTranscript() rebuild every edit used to trigger — now that edits sync
// classes in place instead, re-run search explicitly so matches/counts don't
// go stale after a delete/restore. No-op (cheap) when no query is active.
function refreshSearchIfActive() {
  const q = $("#search")?.value || "";
  if (q.trim().length >= 2) runSearch(q);
}

// Break a long transcript into paragraphs at natural pauses (>1s) so it reads
// like a document instead of one unbroken wall of lowercase text. Visual only
// — capitalization is display-only and never mutates the underlying words.
// `w.breakBefore` is a manual, purely-organizational paragraph split (Enter
// at the caret) — it never touches word content, timing, or the exported
// video, it's just where the text visually wraps to a new paragraph. Splits
// on it exactly like a natural pause, so a manual break composes fine with
// the automatic timing-gap grouping.
function groupIntoParagraphs(words, gapThreshold = 1.0) {
  const paras = [];
  let cur = [];
  let lastEnd = null;
  words.forEach((w, i) => {
    const gapBreak = lastEnd != null && w.start - lastEnd > gapThreshold;
    if ((gapBreak || w.breakBefore) && cur.length) { paras.push(cur); cur = []; }
    cur.push(i);
    lastEnd = w.end;
  });
  if (cur.length) paras.push(cur);
  return paras;
}
const capitalizeFirst = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// ── Search-in-transcript — reads word DATA (v.words), not the DOM, so
// results are correct across the whole transcript regardless of how much of
// it is currently mounted (see the progressive-mount comment above
// renderTranscript()). Only mounted matches get the `.match` highlight as
// you scroll past them; gotoMatch() mounts on demand when jumping to one
// that isn't loaded yet, so next/prev navigation always works everywhere.
let searchMatches = [], searchIdx = -1; // { v, i }[]
function runSearch(q) {
  document.querySelectorAll(".word.match").forEach((el) => el.classList.remove("match", "match-active"));
  searchMatches = []; searchIdx = -1;
  state.videos.forEach((v) => { v._matchSet = null; });
  const qq = q.trim().toLowerCase();
  if (qq.length >= 2) {
    state.videos.filter((v) => v.status === "ready" && v.words).forEach((v) => {
      const set = new Set();
      v.words.forEach((w, i) => {
        if (!state.showCuts && w.deleted) return;
        if (w.text.toLowerCase().includes(qq)) { searchMatches.push({ v, i }); set.add(i); }
      });
      v._matchSet = set;
    });
    searchMatches.forEach(({ v, i }) => v._wordEls?.[i]?.classList.add("match"));
  }
  updateSearchCount();
}
function gotoMatch(idx) {
  if (!searchMatches.length) return;
  if (searchIdx >= 0) { const prev = searchMatches[searchIdx]; prev.v._wordEls?.[prev.i]?.classList.remove("match-active"); }
  searchIdx = ((idx % searchMatches.length) + searchMatches.length) % searchMatches.length;
  const { v, i } = searchMatches[searchIdx];
  ensureWordMounted(v, i);
  const el = v._wordEls?.[i];
  if (el) {
    el.classList.add("match", "match-active");
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  updateSearchCount();
}
function updateSearchCount() {
  const el = $("#searchCount"); if (!el) return;
  const q = $("#search")?.value || "";
  el.textContent = searchMatches.length ? `${searchIdx + 1}/${searchMatches.length}` : q.trim().length >= 2 ? "0/0" : "";
}

// ── Cut ruler — a compact strip showing kept vs. cut across the selected
// video, so navigating a multi-hour transcript doesn't mean endless scrolling.
function renderRuler() {
  const el = $("#ruler"); if (!el) return;
  if (state.textOnly) { el.innerHTML = ""; return; }
  const v = state.videos.find((x) => x.id === state.selected);
  if (!v || v.status !== "ready" || !v.words || !v.words.length) { el.innerHTML = ""; return; }
  const t0 = v.words[0].start;
  const total = Math.max(0.001, v.words[v.words.length - 1].end - t0);
  const opts = { trimPausesAbove: state.trimPausesAbove ?? Infinity };
  const blocks = keptRanges(v.words, opts).map((r) => {
    const left = ((r.start - t0) / total) * 100;
    const width = Math.max(0.15, ((r.end - r.start) / total) * 100);
    return `<div class="ruler-kept" style="left:${left}%;width:${width}%"></div>`;
  }).join("");
  el.innerHTML = `<div class="ruler-track">${blocks}<div class="ruler-playhead" id="rulerPlayhead"></div></div>`;
  el.querySelector(".ruler-track").onclick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    $("#sel-player").currentTime = t0 + pct * total;
  };
}
function updateRulerPlayhead() {
  if (state.textOnly) return;
  const v = state.videos.find((x) => x.id === state.selected);
  const ph = $("#rulerPlayhead");
  if (!v || !ph || !v.words || !v.words.length) return;
  const t0 = v.words[0].start;
  const total = Math.max(0.001, v.words[v.words.length - 1].end - t0);
  const t = $("#sel-player").currentTime;
  ph.style.left = `${Math.min(100, Math.max(0, ((t - t0) / total) * 100))}%`;
}

// ── Undo / redo ──────────────────────────────────────────────────────
// Snapshot a video's words before any mutating action; Cmd/Ctrl+Z restores it.
const HISTORY_LIMIT = 60;
function snapshotHistory(v) {
  v._history = v._history || [];
  v._future = [];
  v._history.push(JSON.stringify(v.words));
  if (v._history.length > HISTORY_LIMIT) v._history.shift();
  state.lastEditedVideo = v;
}
// Undo/redo swap `v.words` wholesale from a JSON snapshot, so a lightweight
// class-sync (not a full rebuild) is enough as long as the word count still
// matches the cached `_wordEls` array — which it always will unless a
// re-transcribe happened in between (that replaces `v.words` with a
// different-length array; pollTranscription() resets history when that
// happens, but the length check is cheap insurance against any other future
// path that could do the same).
// A word-count change (re-transcribe) obviously needs a real rebuild, but so
// does a `breakBefore` change even at the same word count — a paragraph
// break isn't reflected in any span's classList, it's a DOM structural split
// (see groupIntoParagraphs), so undoing/redoing across an Enter-press or a
// break-merge has to rebuild the paragraphs, not just sync word classes.
function paragraphStructureChanged(a, b) {
  if (!a || !b || a.length !== b.length) return true;
  return a.some((w, i) => !!w.breakBefore !== !!b[i].breakBefore);
}
// After a renderTranscript() rebuild, only the first chunk of paragraphs is
// mounted — if the caret was sitting somewhere further down the document, it
// would otherwise just vanish (v._wordEls[caretIndex] is undefined until
// that paragraph loads). Mount up through it and re-plant the caret there.
function remountCaretIfNeeded(v) {
  if (caretVideo !== v || caretIndex < 0) return;
  ensureWordMounted(v, caretIndex);
  const el = v._wordEls?.[caretIndex];
  if (el) setCaret(el);
}
function undo() {
  const v = state.lastEditedVideo;
  if (!v || !v._history || !v._history.length) return;
  v._future = v._future || [];
  v._future.push(JSON.stringify(v.words));
  const prevWords = v.words;
  v.words = JSON.parse(v._history.pop());
  if (v.words.length !== v._wordEls?.length || paragraphStructureChanged(prevWords, v.words)) { renderTranscript(); remountCaretIfNeeded(v); }
  else syncWordClasses(v);
  updateStats(); renderRuler(); refreshSearchIfActive();
}
function redo() {
  const v = state.lastEditedVideo;
  if (!v || !v._future || !v._future.length) return;
  v._history.push(JSON.stringify(v.words));
  const prevWords = v.words;
  v.words = JSON.parse(v._future.pop());
  if (v.words.length !== v._wordEls?.length || paragraphStructureChanged(prevWords, v.words)) { renderTranscript(); remountCaretIfNeeded(v); }
  else syncWordClasses(v);
  updateStats(); renderRuler(); refreshSearchIfActive();
}

// ── Text selection & caret (real Descript-style: this is native browser text
// selection, not a custom drag simulation) ────────────────────────────────
// The transcript is plain selectable text — click-drag, shift-click, and
// double-click-selects-word all come from the browser for free. We mirror
// whatever the native Selection covers onto our own `.selected` word classes
// (and hide the native highlight — `.tsec-body ::selection` is transparent —
// so we fully control how it looks) so cutting still works at word
// granularity. A collapsed selection (a plain click, no drag) becomes a
// caret: a blinking bar rendered after that word, which is what Backspace/
// Delete act on when nothing is actively selected — exactly the "click
// somewhere, then Backspace to eat backward" feel of editing a real document.
let selectedEls = [];
let caretEl = null, caretVideo = null, caretIndex = -1;

function wordElFromNode(node) {
  if (!node) return null;
  const el = node.nodeType === 3 ? node.parentElement : node;
  return el ? el.closest(".word") : null;
}
function videoForWordEl(el) {
  const tsec = el?.closest(".tsec");
  return tsec ? state.videos.find((x) => x.id === tsec.dataset.vid) || null : null;
}

function setSelection(v, start, end) {
  clearCaret();
  selectedEls.forEach((el) => el.classList.remove("selected"));
  selectedEls = [];
  state.videos.forEach((o) => { if (o !== v) { o._selStart = null; o._selEnd = null; } });
  v._selStart = Math.min(start, end);
  v._selEnd = Math.max(start, end);
  for (let i = v._selStart; i <= v._selEnd; i++) {
    const el = v._wordEls?.[i];
    if (el) { el.classList.add("selected"); selectedEls.push(el); }
  }
  updateSelectionHint();
}
// Clears our visual selection state without touching the native browser
// selection — used while mirroring a native selectionchange, since fighting
// the selection that triggered us would just cause churn.
function clearSelectionVisual() {
  selectedEls.forEach((el) => el.classList.remove("selected"));
  selectedEls = [];
  state.videos.forEach((v) => { v._selStart = null; v._selEnd = null; });
  updateSelectionHint();
}
function clearSelection() {
  clearSelectionVisual();
  window.getSelection()?.removeAllRanges();
}
function updateSelectionHint() {
  const bar = $("#selToolbar"); if (!bar) return;
  const n = selectedEls.length;
  bar.classList.toggle("show", n > 0);
  const countEl = $("#selCount");
  if (countEl) countEl.textContent = n > 0 ? `${n} word${n === 1 ? "" : "s"} selected` : "";
  updateSelectionThreadMatch();
}
// Best-matching existing Archive thread for the current selection, so
// saving a custom clip carries the same "which thread does this belong to"
// context the prototype's contextualization panel shows before saving —
// computed client-side (bag-of-words against cached thread names/sample
// quotes) rather than a live AI call per keystroke of selection.
let sourceThreadsCache = null;
async function ensureSourceThreadsCache() {
  if (!sourceThreadsCache) sourceThreadsCache = await fetchThreads();
  return sourceThreadsCache;
}
async function updateSelectionThreadMatch() {
  const el = $("#selThreadMatch"); if (!el) return;
  const v = state.videos.find((x) => x._selStart != null);
  if (!v) { el.textContent = ""; return; }
  const kept = v.words.slice(v._selStart, v._selEnd + 1).filter((w) => !w.deleted);
  if (!kept.length) { el.textContent = ""; return; }
  const text = kept.map((w) => w.text).join(" ");
  const threads = await ensureSourceThreadsCache();
  if ($("#selThreadMatch") !== el || v !== state.videos.find((x) => x._selStart != null)) return; // selection moved on while awaiting
  const lineWords = significantWords(text);
  let best = null, bestScore = 0;
  for (const t of threads) {
    const threadWords = new Set(significantWords(`${t.name} ${(t.sampleQuotes || []).join(" ")}`));
    let score = 0;
    for (const w of lineWords) if (threadWords.has(w)) score++;
    if (score > bestScore) { bestScore = score; best = t; }
  }
  el.textContent = bestScore >= 2 ? `Best match: ${best.name}` : "No strong match";
}
function deleteSelection() {
  const v = state.videos.find((x) => x._selStart != null);
  if (!v) return;
  // Capture the range before clearSelection() wipes v._selStart/_selEnd.
  const start = v._selStart, end = v._selEnd;
  let prev = start - 1;
  while (prev >= 0 && v.words[prev].deleted) prev--; // skip an already-cut run
  snapshotHistory(v);
  for (let i = start; i <= end; i++) v.words[i].deleted = true;
  clearSelection();
  for (let i = start; i <= end; i++) syncWordClass(v, i);
  updateStats(); renderRuler(); refreshSearchIfActive();
  const el = prev >= 0 ? v._wordEls?.[prev] : null;
  if (el) setCaret(el); else clearCaret();
}

// Manually promote a selected range of transcript text into the "Cut" list
// — the same ordered segment list Auto-arrange/Direct-the-edit/Suggested
// edits already build — so it can be dragged into any order (see the drag
// handlers wired in renderTimeline()). This is the real mechanism behind
// "put a sentence before another": once anything is in the Cut list, either
// AI-arranged or added by hand, Play edit/Export follow that list's order
// instead of the video's original linear order.
function addSelectionToCut() {
  const v = state.videos.find((x) => x._selStart != null);
  if (!v) return;
  // With Show Cuts on, a selection could start/end on an already-cut word —
  // use only the kept words for the clip's time range so an already-deleted
  // stretch at either edge doesn't sneak into the exported clip.
  const kept = v.words.slice(v._selStart, v._selEnd + 1).filter((w) => !w.deleted);
  if (!kept.length) { toast("That selection is all cut words."); return; }
  if (!state.timeline) state.timeline = { coldOpen: [], body: [] };
  const start = kept[0].start;
  const end = kept[kept.length - 1].end;
  const text = kept.map((w) => w.text).join(" ");
  state.timeline.body.push({ videoId: v.id, start, end, reason: text.length > 60 ? text.slice(0, 57) + "…" : text });
  clearSelection();
  saveTimeline(); renderTimeline(); updateStats(); switchToolsTab("cut");
  toast("Added to the Cut tab — drag it to reorder", { type: "success" });
}

// Save a selected range of transcript text directly to the cross-project
// Clip Library — same kept-word range addSelectionToCut() computes, but
// persisted permanently (reusable from any project) instead of living only
// in this project's Cut list.
async function saveSelectionToLibrary() {
  const v = state.videos.find((x) => x._selStart != null);
  if (!v) return;
  const kept = v.words.slice(v._selStart, v._selEnd + 1).filter((w) => !w.deleted);
  if (!kept.length) { toast("That selection is all cut words."); return; }
  const start = kept[0].start;
  const end = kept[kept.length - 1].end;
  const text = kept.map((w) => w.text).join(" ");
  clearSelection();
  await saveClipToLibrary([{ videoId: v.id, start, end }], { title: text.length > 60 ? text.slice(0, 57) + "…" : text });
}

// ── Reaction / cutaway clips — "he says X, cut to some existing clip that
// echoes X." Scoped to the user's own saved Library only (the AI only ever
// cites a real clip id, same grounding discipline as everything else here —
// see suggestReactionClip() in src/pipeline/reason.ts). Reaching into a
// broader stock/meme corpus of clips the user doesn't own is a deliberately
// separate, deferred idea, not this feature's job.
async function findReactionClipForSelection() {
  const v = state.videos.find((x) => x._selStart != null);
  if (!v) return;
  const selStart = v._selStart, selEnd = v._selEnd;
  const kept = v.words.slice(selStart, selEnd + 1).filter((w) => !w.deleted);
  if (!kept.length) { toast("That selection is all cut words."); return; }
  const line = kept.map((w) => w.text).join(" ");
  clearSelection();
  let data;
  try {
    const res = await fetch(`/api/projects/${state.project.id}/reaction-clip`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ line }),
    });
    data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
  } catch (err) { toast(err.message || "Couldn't find a reaction clip", { type: "error" }); return; }
  if (!data.match) { toast("Nothing in your library fits that line yet.", { type: "info" }); return; }

  const { match } = data;
  const insert = await UI.modal({
    title: "Reaction clip found",
    bodyHTML: `<p class="modal-text"><b>${esc(match.title || "Untitled clip")}</b><br>${esc(match.reason || "")}</p>`,
    dismissValue: false,
    actions: [
      { label: "Skip", resolve: false },
      { label: "Preview", onClick: () => previewSegmentsInProject(match.segments) },
      { label: "Insert after this line", variant: "primary", resolve: true },
    ],
  });
  if (!insert) return;
  insertReactionClip(match, v, kept);
}

// Adds the selected line AND the matched reaction clip as two new segments
// at the end of the Cut list — simplest, safest option (no guessing at a
// precise splice point in an arrangement that may not exist yet), and the
// existing drag-to-reorder in the Cut tab already handles positioning them.
function insertReactionClip(match, v, keptWords) {
  if (!state.timeline) state.timeline = { coldOpen: [], body: [] };
  state.timeline.body = state.timeline.body || [];
  const lineText = keptWords.map((w) => w.text).join(" ");
  const lineSeg = {
    videoId: v.id,
    start: keptWords[0].start,
    end: keptWords[keptWords.length - 1].end,
    reason: lineText.length > 60 ? lineText.slice(0, 57) + "…" : lineText,
  };
  const reactionSegs = (match.segments || []).map((s) => ({
    videoId: s.videoId, start: s.start, end: s.end, reason: `Reaction: ${match.title || match.reason || "clip"}`,
  }));
  state.timeline.body.push(lineSeg, ...reactionSegs);
  saveTimeline(); renderTimeline(); updateStats(); switchToolsTab("cut");
  toast("Added the line and the reaction clip to your Cut — drag ⠿ to position them", { type: "success" });
}

// Preview for the project editor (NOT the Library view — #libPreviewPlayer
// doesn't exist here). Reuses the same cross-video edit.clips/playClip
// machinery Suggested Edits already previews with, generalized through
// resolveVideo() since a reaction clip's video may belong to a different
// project entirely.
async function previewSegmentsInProject(segments) {
  const resolved = [];
  for (const seg of segments || []) {
    const v = await resolveVideo(seg.videoId);
    if (v && v.r2_key) resolved.push({ videoId: seg.videoId, r2_key: v.r2_key, start: seg.start, end: seg.end });
  }
  if (!resolved.length) { toast("Couldn't load that clip's video."); return; }
  stopEdit(); edit.playing = true; edit.clips = resolved;
  await playClip(0);
}

// Place the caret "after" a word — Backspace deletes that word, Delete
// deletes the one ahead of it. Also anchors the native selection there (so a
// later shift-click/drag extends from the right spot) and scrubs the player
// to it, since the transcript doubles as a scrubber.
function setCaret(wordEl) {
  // Otherwise Backspace/Delete would still route to a lingering-focused
  // search box etc. instead of cutting the word — clicking into the
  // transcript should claim keyboard input the same way clicking into any
  // other document does.
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  if (caretEl) caretEl.classList.remove("caret-after");
  wordEl.classList.add("caret-after");
  caretEl = wordEl;
  const v = videoForWordEl(wordEl);
  caretVideo = v;
  caretIndex = +wordEl.dataset.i;
  if (v) {
    if (state.selected !== v.id) selectVideo(v.id);
    const p = $("#sel-player");
    if (p) p.currentTime = v.words[caretIndex].start;
  }
  try {
    const range = document.createRange();
    range.selectNodeContents(wordEl);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  } catch { /* selection API can throw on detached nodes mid-render — harmless */ }
}
function clearCaret() {
  if (caretEl) caretEl.classList.remove("caret-after");
  caretEl = null; caretVideo = null; caretIndex = -1;
}
function backspaceAtCaret() {
  const v = caretVideo; if (!v || caretIndex < 0) return;
  // If the word right after the caret starts a manual paragraph break, the
  // first Backspace removes the break (merges the two paragraphs back into
  // one) instead of deleting a word — same two-step behavior as backspacing
  // at the start of a line in any word processor. A second Backspace, with
  // the break already gone, falls through to the normal word-delete below.
  const next = v.words[caretIndex + 1];
  if (next && next.breakBefore) {
    snapshotHistory(v);
    next.breakBefore = false;
    renderTranscript(); // paragraph shape changed — needs the real rebuild
    remountCaretIfNeeded(v);
    updateStats(); renderRuler();
    return;
  }
  if (!v.words[caretIndex].deleted) {
    snapshotHistory(v);
    v.words[caretIndex].deleted = true;
    syncWordClass(v, caretIndex);
    updateStats(); renderRuler(); refreshSearchIfActive();
  }
  // Cut words are hidden by default — skip past any already-cut run so the
  // caret always lands on the next visible word, not an invisible one.
  let prev = caretIndex - 1;
  while (prev >= 0 && v.words[prev].deleted) prev--;
  const el = prev >= 0 ? v._wordEls?.[prev] : null;
  if (el) setCaret(el); else clearCaret();
}
function deleteForwardAtCaret() {
  const v = caretVideo; if (!v || caretIndex < 0) return;
  let next = caretIndex + 1;
  while (next < v.words.length && v.words[next].deleted) next++;
  if (next >= v.words.length) return;
  snapshotHistory(v);
  v.words[next].deleted = true;
  syncWordClass(v, next);
  updateStats(); renderRuler(); refreshSearchIfActive();
  // caret stays put — still "after" the same visible word
  const el = v._wordEls?.[caretIndex];
  if (el) setCaret(el);
}

// Enter at the caret — a purely organizational split: start a new paragraph
// right after the caret without touching, deleting, or reordering any word.
// This is "press Enter to make space" — the thing that was missing before,
// where the only editing action available was deleting.
function insertBreakAtCaret() {
  const v = caretVideo; if (!v || caretIndex < 0) return;
  const nextIdx = caretIndex + 1;
  if (nextIdx >= v.words.length || v.words[nextIdx].breakBefore) return; // nothing after, or already split here
  snapshotHistory(v);
  v.words[nextIdx].breakBefore = true;
  renderTranscript(); // paragraph shape changed — needs the real rebuild
  remountCaretIfNeeded(v);
  updateStats(); renderRuler();
}

// Mirrors the browser's own selection onto our word classes/caret. Runs on
// every selectionchange globally (search box, url input, etc. all fire it
// too) so the first thing it does is bail unless the change happened inside
// the transcript.
function handleSelectionChange() {
  const sel = window.getSelection();
  const container = $("#transcript");
  if (!sel || !container || sel.rangeCount === 0 || !container.contains(sel.anchorNode)) return;

  if (sel.isCollapsed) {
    const anchorWord = wordElFromNode(sel.anchorNode);
    if (anchorWord === caretEl) return; // feedback from setCaret's own range assignment
    clearSelectionVisual();
    if (anchorWord && !anchorWord.classList.contains("deleted")) setCaret(anchorWord);
    else clearCaret();
    return;
  }
  const anchorWord = wordElFromNode(sel.anchorNode);
  const focusWord = wordElFromNode(sel.focusNode);
  if (!anchorWord || !focusWord) return;
  const v = videoForWordEl(anchorWord);
  if (!v || videoForWordEl(focusWord) !== v) return; // only support single-video selections
  setSelection(v, +anchorWord.dataset.i, +focusWord.dataset.i);
}
document.addEventListener("selectionchange", handleSelectionChange);

// Deleted (struck-through) words aren't part of native selection handling —
// clicking one restores it immediately, a quick, obviously-reversible
// one-click undo gesture people expect to just work.
function onWordClick(e, v) {
  const el = e.target.closest(".word"); if (!el) return;
  const i = +el.dataset.i;
  if (v.words[i].deleted) {
    snapshotHistory(v);
    v.words[i].deleted = false;
    syncWordClass(v, i);
    updateStats(); renderRuler(); refreshSearchIfActive();
    const newEl = v._wordEls?.[i];
    if (newEl) setCaret(newEl);
  }
}

// Bulk-delete every filler word ("um", "uh", …) across all transcribed videos.
function removeFillers() {
  const ready = state.videos.filter((v) => v.status === "ready" && v.words);
  let count = 0;
  ready.forEach((v) => {
    const hasFiller = v.words.some((w) => !w.deleted && isFillerWord(w.text));
    if (!hasFiller) return;
    snapshotHistory(v);
    v.words.forEach((w, i) => {
      if (!w.deleted && isFillerWord(w.text)) { w.deleted = true; count++; syncWordClass(v, i); }
    });
  });
  if (!count) { toast("No filler words found."); return; }
  updateStats(); renderRuler(); refreshSearchIfActive();
  toast(`Removed ${count} filler word${count === 1 ? "" : "s"}`, { type: "success" });
}

// Toggle hard-cutting internal pauses longer than the threshold (natural
// pauses are preserved by default now — see keptRanges).
function toggleTrimPauses() {
  // Doesn't touch v.words at all (only affects export/ruler gap math), so no
  // need for a full renderProject() teardown — that was rebuilding the
  // entire editor (sidebar, transcript, right rail, footer, every listener)
  // just to flip a boolean.
  state.trimPausesAbove = state.trimPausesAbove ? null : 1.5;
  $("#trimPauses")?.classList.toggle("accent", !!state.trimPausesAbove);
  renderRuler(); updateStats();
  toast(state.trimPausesAbove ? "Trimming pauses longer than 1.5s" : "Pause trimming off");
}
// Deleted words are hidden by default so cutting text behaves like deleting
// in a real document (the gap closes immediately) rather than leaving
// struck-through clutter in view. This toggle reveals them again — struck
// through, click-to-restore — for reviewing or undoing a cut without Ctrl+Z.
function toggleShowCuts() {
  state.showCuts = !state.showCuts;
  $("#transcript")?.classList.toggle("show-cuts", state.showCuts);
  $("#showCuts")?.classList.toggle("accent", state.showCuts);
  refreshSearchIfActive();
}
// Hides the video preview, ruler, and footer (transport/filmstrip/phrase
// chips) — everything tied to seeing/scrubbing the video — leaving just the
// transcript and its editing toolbar. Also stops the filmstrip's frame
// grabs outright (not just visually hiding them), which is the heaviest
// thing on the page: up to 10 concurrent hidden <video> elements each
// seeking into the source. The player itself keeps its src — double-click
// and caret placement still seek/play audio, just without the visible frame.
function toggleTextOnly() {
  state.textOnly = !state.textOnly;
  $(".editor-shell")?.classList.toggle("text-only", state.textOnly);
  $("#textOnly")?.classList.toggle("accent", state.textOnly);
  renderRuler(); renderFilmstrip(); renderPhraseChips();
}
function onWordDbl(e, v) {
  const el = e.target.closest(".word"); if (!el) return;
  if (v.words[+el.dataset.i].deleted) return; // the click handler already restored it
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
  const opts = { trimPausesAbove: state.trimPausesAbove ?? Infinity };
  ready.forEach((v) => {
    kept += rangeSeconds(keptRanges(v.words, opts));
    total += v.words.length ? v.words[v.words.length - 1].end - v.words[0].start : 0;
    kw += v.words.filter((w) => !w.deleted).length; tw += v.words.length;
  });
  setStats(`${fmt(kept)} kept / ${fmt(total)} · ${kw}/${tw} words · ${ready.length} clip(s)`);
}

// ── Cross-video edit preview ─────────────────────────────────────────
const edit = { playing: false, clips: [], raf: 0, playingEl: null };
const mediaUrl = (key) => "/api/media/" + key.split("/").map(encodeURIComponent).join("/");

// A timeline segment can reference a video pulled in from a DIFFERENT
// project's Library clip, not just this project's own state.videos —
// resolveVideo() checks the local list first (fast path, no network) and
// falls back to a cached fetch for anything foreign.
async function buildClips() {
  if (hasTimeline()) {
    const segs = [...(state.timeline.coldOpen || []), ...(state.timeline.body || [])];
    const resolved = await Promise.all(segs.map(async (s) => {
      const v = await resolveVideo(s.videoId);
      return v && v.r2_key ? { videoId: s.videoId, r2_key: v.r2_key, start: s.start, end: s.end } : null;
    }));
    return resolved.filter(Boolean);
  }
  const clips = [];
  const opts = { trimPausesAbove: state.trimPausesAbove ?? Infinity };
  for (const v of state.videos) {
    if (v.status !== "ready" || !v.words) continue;
    for (const r of keptRanges(v.words, opts)) clips.push({ videoId: v.id, r2_key: v.r2_key, start: r.start, end: r.end });
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
  const clips = await buildClips();
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
// Binary search for the word at time t (words are chronological), then a
// small bounded scan for the nearest non-deleted one — O(log n) instead of
// walking the whole transcript on every timeupdate tick, which is what made
// playback stutter once a transcript reached a few thousand words.
function highlightPlayhead(videoId, t) {
  const v = state.videos.find((x) => x.id === videoId); if (!v || !v.words || !v.words.length) return;
  const words = v.words;
  let lo = 0, hi = words.length - 1, pos = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid].start <= t) { pos = mid; lo = mid + 1; } else hi = mid - 1;
  }
  let idx = -1;
  for (let k = pos; k < words.length && words[k].start <= t; k++) {
    if (!words[k].deleted && t < words[k].end) { idx = k; break; }
  }
  const next = idx >= 0 ? v._wordEls?.[idx] : null;
  if (next === edit.playingEl) return;
  clearPlayhead();
  if (next) { next.classList.add("playing"); edit.playingEl = next; }
}
function clearPlayhead() { if (edit.playingEl) { edit.playingEl.classList.remove("playing"); edit.playingEl = null; } }

// ── AI-suggestion ↔ transcript linkage ──────────────────────────────
// Every Cut/Suggestion/Short card can hover-highlight the exact words it's
// about, right in the transcript, instead of being a disconnected card in
// a sidebar tab. Same binary-search shape as highlightPlayhead above,
// generalized from "the one word at time t" to "every word in [start,end)".
function wordIndicesInRange(v, start, end) {
  if (!v.words || !v.words.length) return [];
  const words = v.words;
  let lo = 0, hi = words.length - 1, pos = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid].start <= start) { pos = mid; lo = mid + 1; } else hi = mid - 1;
  }
  const idxs = [];
  for (let k = pos; k < words.length && words[k].start < end; k++) {
    if (!words[k].deleted && words[k].end > start) idxs.push(k);
  }
  return idxs;
}
// Segments referencing a video from a DIFFERENT project (e.g. a Library
// clip pulled in via Compose) have no transcript mounted in this view at
// all — skipped rather than forced, same limitation resolveVideo() already
// has for showing their filename.
function highlightTranscriptSegments(segments) {
  for (const seg of segments) {
    const v = state.videos.find((x) => x.id === seg.videoId);
    if (!v || !v.words) continue;
    for (const i of wordIndicesInRange(v, seg.start, seg.end)) {
      ensureWordMounted(v, i);
      v._wordEls?.[i]?.classList.add("ai-highlight");
    }
  }
}
function clearTranscriptHighlight() {
  document.querySelectorAll(".word.ai-highlight").forEach((el) => el.classList.remove("ai-highlight"));
}
// Hover-only by design (no scroll-into-view) — a list of a dozen suggestion/
// short cards means the mouse crosses many of them just moving down the
// page, and yanking the transcript's scroll position on every pass would
// be worse than the disconnect it's meant to fix.
function wireCardHighlight(cardEl, segments) {
  if (!cardEl || !segments?.length) return;
  cardEl.addEventListener("mouseenter", () => highlightTranscriptSegments(segments));
  cardEl.addEventListener("mouseleave", clearTranscriptHighlight);
}
// Bridges fill a GAP between two existing Cut segments rather than
// referencing a transcript span of their own — so hovering one highlights
// the two Cut rows it sits between instead, same idea aimed at the Cut
// list rather than the transcript. Mirrors the flat-index→group math
// recordAndInsertBridge uses to insert at the right spot, read-only here.
function flatSegAt(flatIdx) {
  const t = state.timeline; if (!t) return null;
  const coldLen = (t.coldOpen || []).length;
  return flatIdx < coldLen ? { group: "coldOpen", idx: flatIdx } : { group: "body", idx: flatIdx - coldLen };
}
function highlightBridgeGap(afterIndex) {
  [flatSegAt(afterIndex), flatSegAt(afterIndex + 1)].forEach((loc) => {
    if (loc) $(`#timeline .seg[data-g="${loc.group}"][data-i="${loc.idx}"]`)?.classList.add("ai-highlight");
  });
}
function clearBridgeGapHighlight() {
  $("#timeline")?.querySelectorAll(".seg.ai-highlight").forEach((el) => el.classList.remove("ai-highlight"));
}

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
    renderTimeline(); updateStats(); switchToolsTab("cut");
    toast("Arranged a cut — refine it in the Cut tab", { type: "success" });
  } catch (err) { toast(err.message || "Auto-arrange failed", { type: "error", title: "Auto-arrange" }); }
  btn.classList.remove("loading"); btn.disabled = false;
}

// "Direct the edit" — the user describes what they want in their own words
// instead of picking a generic best-cut; finds and assembles the matching
// moments into the same Arranged cut panel Auto-arrange fills.
async function runDirectedEdit(btn) {
  const input = $("#directInput");
  const instruction = (input.value || "").trim();
  if (!instruction) { toast("Describe the edit you want first."); return; }
  if (!state.videos.some((v) => v.status === "ready" && v.words)) { toast("Transcribe a video first."); return; }
  btn.classList.add("loading"); btn.disabled = true;
  try {
    const res = await fetch(`/api/projects/${state.project.id}/direct`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ instruction }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    state.timeline = data.timeline;
    renderTimeline(); updateStats(); switchToolsTab("cut");
    const n = (data.timeline.coldOpen || []).length + (data.timeline.body || []).length;
    if (n) toast(`Built a cut from ${n} moment${n === 1 ? "" : "s"} — refine it in the Cut tab`, { type: "success" });
    else toast("Nothing in the transcript matched that — try rephrasing.", { type: "error" });
  } catch (err) { toast(err.message || "Directed edit failed", { type: "error", title: "Direct the edit" }); }
  btn.classList.remove("loading"); btn.disabled = false;
}

function renderTimeline() {
  const el = $("#timeline"); if (!el) return;
  if (!hasTimeline()) {
    el.innerHTML = state.studioMode
      ? `<p class="empty small">Add a video and it's transcribed and arranged automatically — or select text in the transcript and choose <b>Add to Cut</b> to build one by hand.</p>`
      : `<p class="empty small">No arranged cut yet. Use Auto-arrange/Direct the edit above, or select text in the transcript and choose <b>Add to Cut</b> — segments land here and you can drag ⠿ to reorder them.</p>`;
    return;
  }
  const t = state.timeline;
  // A segment's video might not be in state.videos at all — it could be a
  // clip pulled in from a different project's Library entry. Show the local
  // filename immediately when we have it (no flicker for the common case);
  // resolveVideo() below corrects foreign ones once resolved.
  const seg = (s, group, idx) => {
    const v = state.videos.find((x) => x.id === s.videoId);
    const name = v ? filenameOf(v.filename) : s.videoId;
    return `<div class="seg" draggable="true" data-g="${group}" data-i="${idx}">
      <span class="seg-drag" title="Drag to reorder">⠿</span>
      <span class="seg-time">${fmt(s.start)}–${fmt(s.end)}</span>
      <span class="seg-src">${esc(name)}</span>
      <span class="seg-reason">${esc(s.reason || "")}</span>
      <button class="seg-save" title="Save to the cross-project Archive">${ic("save")}</button>
      <button class="seg-x" title="Remove">✕</button></div>`;
  };
  el.innerHTML = `<div class="tl">
    <div class="tl-head"><h2>Arranged cut</h2><button class="btn ghost small" id="clearTl">Clear</button></div>
    <p class="tl-hint">Drag ⠿ to reorder — playback and export follow this order.</p>
    ${(t.coldOpen || []).length ? `<div class="tl-label">Cold open</div>${t.coldOpen.map((s, i) => seg(s, "coldOpen", i)).join("")}` : ""}
    ${(t.body || []).length ? `<div class="tl-label">Body</div>${t.body.map((s, i) => seg(s, "body", i)).join("")}` : ""}
  </div>`;
  ["coldOpen", "body"].forEach((group) => {
    (t[group] || []).forEach((s, i) => {
      if (state.videos.some((x) => x.id === s.videoId)) return; // already showed the real name above
      resolveVideo(s.videoId).then((v) => {
        const span = el.querySelector(`.seg[data-g="${group}"][data-i="${i}"] .seg-src`);
        if (span && v) span.textContent = filenameOf(v.filename);
      });
    });
  });
  // Drag-to-reorder within a group (coldOpen/body kept separate — moving a
  // segment between the two changes what it *means*, not just where it
  // sits, so that's left to the existing manual add/remove flow instead).
  let dragSeg = null;
  el.querySelectorAll(".seg").forEach((row) => {
    row.querySelector(".seg-x").onclick = (e) => {
      e.stopPropagation();
      state.timeline[row.dataset.g].splice(+row.dataset.i, 1);
      saveTimeline(); renderTimeline(); updateStats();
    };
    row.querySelector(".seg-save").onclick = (e) => {
      e.stopPropagation();
      const s = state.timeline[row.dataset.g][+row.dataset.i];
      saveClipToLibrary([s], { title: s.reason || `${fmt(s.start)}–${fmt(s.end)}` });
    };
    row.onclick = (e) => {
      if (e.target.closest(".seg-drag") || e.target.closest(".seg-save")) return;
      const s = state.timeline[row.dataset.g][+row.dataset.i];
      playSegmentInMainPlayer(s);
    };
    wireCardHighlight(row, [state.timeline[row.dataset.g][+row.dataset.i]]);
    row.addEventListener("dragstart", (e) => {
      dragSeg = { g: row.dataset.g, i: +row.dataset.i };
      e.dataTransfer.effectAllowed = "move";
      row.classList.add("dragging");
    });
    row.addEventListener("dragend", () => { row.classList.remove("dragging"); dragSeg = null; });
    row.addEventListener("dragover", (e) => {
      if (!dragSeg || dragSeg.g !== row.dataset.g) return;
      e.preventDefault();
      row.classList.add("drag-over");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      row.classList.remove("drag-over");
      if (!dragSeg || dragSeg.g !== row.dataset.g) return;
      const to = +row.dataset.i;
      if (to === dragSeg.i) return;
      const arr = state.timeline[dragSeg.g];
      const [moved] = arr.splice(dragSeg.i, 1);
      arr.splice(to, 0, moved);
      saveTimeline(); renderTimeline(); updateStats();
    });
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

// Version history for the Cut — every save already archives whatever it
// replaces server-side (see archiveTimeline in src/index.ts), so this is
// just a browsing/restore surface. Lives in the command palette rather
// than another sidebar button — the sidebar's already tight on room.
const relativeTime = (ts) => {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
};
async function viewHistory() {
  if (!state.project) return;
  let versions = [];
  try {
    versions = (await fetch(`/api/projects/${state.project.id}/history`).then((r) => r.json())).versions || [];
  } catch { toast("Couldn't load version history", { type: "error" }); return; }

  await UI.modal({
    title: "Version history",
    bodyHTML: !versions.length
      ? `<p class="modal-text">No earlier versions yet — one gets saved automatically every time the Cut changes.</p>`
      : `<div class="history-list">${versions.map((v) => `
          <div class="history-row">
            <span>${esc(relativeTime(v.timestamp))}</span>
            <button class="btn small ghost history-restore" data-ts="${v.timestamp}">Restore</button>
          </div>`).join("")}</div>`,
    dismissValue: null,
    actions: [{ label: "Close", resolve: null }],
    onOpen: (card, done) => {
      card.querySelectorAll(".history-restore").forEach((btn) => {
        btn.onclick = async () => {
          if (!(await UI.confirm({
            title: "Restore this version?",
            message: "Your current Cut is saved to history too when you do this, so it isn't a one-way trip.",
            confirmText: "Restore",
          }))) return;
          try {
            const res = await fetch(`/api/projects/${state.project.id}/history/${btn.dataset.ts}/restore`, { method: "POST" });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || res.statusText);
            state.timeline = data.timeline;
            renderTimeline(); updateStats();
            toast("Version restored", { type: "success" });
            done(null);
          } catch (err) { toast(err.message || "Restore failed", { type: "error" }); }
        };
      });
    },
  });
}

// ── Bridges — AI-written narration for gaps in the assembled cut, recorded
// straight into the timeline. The last piece of the video-essay workflow:
// Compose/Auto-arrange/manual editing gets you the clips in order, this
// finds and fills what's missing between them.
async function findBridges(btn) {
  if (!hasTimeline() || [...(state.timeline.coldOpen || []), ...(state.timeline.body || [])].length < 2) {
    toast("Build a Cut with at least two segments first — Auto-arrange, Direct the edit, or Add to Cut.");
    return;
  }
  btn.classList.add("loading"); btn.disabled = true;
  try {
    const res = await fetch(`/api/projects/${state.project.id}/bridges`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    state.bridges = data.bridges || [];
    renderBridges();
    if (!state.bridges.length) toast("No gaps needed a bridge — your cut already flows.", { type: "success" });
    else toast(`Found ${state.bridges.length} gap${state.bridges.length === 1 ? "" : "s"} to fill`, { type: "success" });
  } catch (err) { toast(err.message || "Finding bridges failed", { type: "error", title: "Bridges" }); }
  btn.classList.remove("loading"); btn.disabled = false;
}
function renderBridges() {
  const el = $("#bridges"); if (!el) return;
  const bridges = state.bridges || [];
  if (!bridges.length) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="tl">
    <div class="tl-head"><h2>Suggested bridges</h2><span class="empty small">${bridges.length}</span></div>
    <p class="tl-hint">Narration the AI thinks would connect these clips — record straight into the gap.</p>
    ${bridges.map((b, i) => `<div class="suggestion" data-i="${i}">
      <div class="sg-top"><span class="sg-type theme">Bridge</span><span class="sg-title">Clip ${b.afterIndex + 1} → ${b.afterIndex + 2}</span></div>
      <div class="sg-why">${esc(b.script)}</div>
      <div class="s-actions"><button class="btn small primary bridge-record">${ic("video")} Record this bridge</button><button class="btn small ghost icon-only bridge-dismiss" title="Dismiss">✕</button></div>
    </div>`).join("")}
  </div>`;
  bridges.forEach((b, i) => {
    const card = el.querySelector(`.suggestion[data-i="${i}"]`);
    card.querySelector(".bridge-record").onclick = (e) => recordAndInsertBridge(b, e.currentTarget);
    card.querySelector(".bridge-dismiss").onclick = () => {
      state.bridges.splice(state.bridges.indexOf(b), 1);
      renderBridges();
    };
    card.addEventListener("mouseenter", () => highlightBridgeGap(b.afterIndex));
    card.addEventListener("mouseleave", clearBridgeGapHighlight);
  });
}

// Records a take for one bridge's script, uploads+transcribes it through the
// SAME pipeline any dropped-in video goes through (presign → confirm →
// transcribe-remote), then inserts its full kept range as a new Cut segment
// right at the gap it was written for.
async function recordAndInsertBridge(bridge, btn) {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    toast("Recording isn't supported in this browser.", { type: "error" });
    return;
  }
  const blob = await recordBridge(bridge);
  if (!blob) return; // cancelled
  const prevText = btn.textContent;
  btn.disabled = true; btn.textContent = "Uploading…";
  try {
    const item = await uploadAndTranscribeTake(blob, state.project.id, (msg) => { btn.textContent = msg; });
    if (!item.words || !item.words.length) throw new Error("That recording came back empty — try again.");
    if (!state.timeline) state.timeline = { coldOpen: [], body: [] };
    state.timeline.coldOpen = state.timeline.coldOpen || [];
    state.timeline.body = state.timeline.body || [];
    const seg = {
      videoId: item.id,
      start: item.words[0].start,
      end: item.words[item.words.length - 1].end,
      reason: "Recorded bridge",
    };
    const coldLen = state.timeline.coldOpen.length;
    if (bridge.afterIndex + 1 <= coldLen) state.timeline.coldOpen.splice(bridge.afterIndex + 1, 0, seg);
    else state.timeline.body.splice(bridge.afterIndex + 1 - coldLen, 0, seg);
    state.bridges = (state.bridges || []).filter((b) => b !== bridge);
    saveTimeline(); renderTimeline(); renderBridges(); updateStats();
    toast("Bridge recorded and inserted into the Cut", { type: "success" });
  } catch (err) {
    toast(err.message || "Couldn't record that bridge", { type: "error" });
    btn.disabled = false; btn.textContent = prevText;
  }
}

// Records a take for one essay "vo" beat's script line and attaches it —
// same record/upload/transcribe path as recordAndInsertBridge, just landing
// on essay_beats.vo_video_id instead of a project timeline segment, since a
// vo beat has no timeline of its own until Assemble.
async function recordAndAttachVoiceover(beat, btn) {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    toast("Recording isn't supported in this browser.", { type: "error" });
    return;
  }
  const blob = await recordVoiceover(beat);
  if (!blob) return; // cancelled
  const prevText = btn.textContent;
  btn.disabled = true; btn.textContent = "Uploading…";
  try {
    const proj = await fetch("/api/essays/voiceover-project").then((r) => r.json());
    if (proj.error) throw new Error(proj.error);
    const item = await uploadAndTranscribeTake(blob, proj.id, (msg) => { btn.textContent = msg; });
    if (!item.words || !item.words.length) throw new Error("That recording came back empty — try again.");
    const res = await fetch(`/api/essays/${essayState.essay.id}/beats/${beat.id}`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ voVideoId: item.id }),
    });
    const updated = await res.json();
    if (!res.ok) throw new Error(updated.error || res.statusText);
    await reloadEssay(); renderEssayShell();
    toast("Voiceover recorded", { type: "success" });
  } catch (err) {
    toast(err.message || "Couldn't record that voiceover", { type: "error" });
    btn.disabled = false; btn.textContent = prevText;
  }
}
function recordVoiceover(beat) {
  return UI.modal({
    title: "Record your voiceover",
    bodyHTML: `
      <p class="modal-text" style="font-size:15px;line-height:1.6;">${esc(beat.text)}</p>
      <video id="__recPreview" autoplay muted playsinline style="width:100%;max-height:220px;background:#000;border-radius:9px;margin:10px 0;object-fit:cover;"></video>
      <div class="rec-wave" id="__recWave" hidden></div>
      <div id="__recStatus" style="color:var(--dim);font-size:12.5px;">Choose camera + mic or voice only, then record.</div>
      <div class="rec-footnote" id="__recFootnote" hidden>Built-in Microphone · saved takes go through the same transcribe pipeline as any clip</div>
    `,
    dismissValue: null,
    onOpen: (card, done) => wireRecorder(card, done),
  });
}

// Picks a MediaRecorder mimeType the browser actually supports, falling back
// to the browser's own default (undefined) rather than guessing wrong and
// throwing on `new MediaRecorder(...)`.
function pickMimeType(withCamera) {
  const candidates = withCamera
    ? ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"]
    : ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const t of candidates) { if (window.MediaRecorder?.isTypeSupported?.(t)) return t; }
  return undefined;
}

// A record-review modal: pick camera+mic or voice-only, record, review the
// take, Retake or use it. Resolves the recorded Blob, or null if cancelled.
// Built on UI.modal's generic shell but drives its own footer buttons
// (Start → Stop → Retake/Use) since that state machine doesn't fit modal's
// static actions list.
function recordBridge(bridge) {
  return UI.modal({
    title: "Record your bridge",
    bodyHTML: `
      <p class="modal-text" style="font-size:15px;line-height:1.6;">${esc(bridge.script)}</p>
      <video id="__recPreview" autoplay muted playsinline style="width:100%;max-height:220px;background:#000;border-radius:9px;margin:10px 0;object-fit:cover;"></video>
      <div class="rec-wave" id="__recWave" hidden></div>
      <div id="__recStatus" style="color:var(--dim);font-size:12.5px;">Choose camera + mic or voice only, then record.</div>
      <div class="rec-footnote" id="__recFootnote" hidden>Built-in Microphone · saved takes go through the same transcribe pipeline as any clip</div>
    `,
    dismissValue: null,
    onOpen: (card, done) => wireRecorder(card, done),
  });
}
const REC_WAVE_BARS = 24;
function wireRecorder(card, done) {
  const video = card.querySelector("#__recPreview");
  const status = card.querySelector("#__recStatus");
  const wave = card.querySelector("#__recWave");
  const footnote = card.querySelector("#__recFootnote");
  const foot = card.querySelector(".modal-foot");
  let stream = null, recorder = null, chunks = [], blob = null, timerInt = null, seconds = 0;
  let audioCtx = null, analyser = null, waveBars = null, waveRaf = null;

  if (wave && !wave.childElementCount) {
    wave.innerHTML = Array.from({ length: REC_WAVE_BARS }, () => `<div class="rec-wave-bar"></div>`).join("");
  }
  const setButtons = (buttons) => {
    foot.innerHTML = "";
    buttons.forEach((b) => {
      const el = document.createElement("button");
      el.className = `btn ${b.variant || ""}`.trim();
      el.textContent = b.label;
      el.onclick = b.onClick;
      foot.appendChild(el);
    });
  };
  const stopWave = () => {
    if (waveRaf) cancelAnimationFrame(waveRaf);
    waveRaf = null;
    if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }
    analyser = null;
  };
  const cleanup = () => { clearInterval(timerInt); stopWave(); if (stream) stream.getTracks().forEach((t) => t.stop()); };
  const showReady = () => {
    status.innerHTML = "Choose camera + mic or voice only, then record.";
    if (wave) wave.hidden = true;
    if (footnote) footnote.hidden = true;
    setButtons([
      { label: "Cancel", onClick: () => { cleanup(); done(null); } },
      { label: "Camera + mic", onClick: () => startRecording(true) },
      { label: "Voice only", variant: "primary", onClick: () => startRecording(false) },
    ]);
  };
  function startWave() {
    if (!wave || !waveBars) return;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      audioCtx.createMediaStreamSource(stream).connect(analyser);
    } catch { return; }
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(data);
      const step = Math.floor(data.length / waveBars.length) || 1;
      waveBars.forEach((bar, i) => {
        const v = data[i * step] || 0;
        bar.style.height = `${Math.max(3, (v / 255) * 100)}%`;
      });
      waveRaf = requestAnimationFrame(tick);
    };
    tick();
  }
  async function startRecording(withCamera) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: withCamera ? { width: 640, height: 360 } : false });
    } catch {
      status.textContent = "Couldn't access camera/mic — check your browser permissions.";
      return;
    }
    video.srcObject = stream; video.muted = true;
    chunks = [];
    const mimeType = pickMimeType(withCamera);
    try { recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined); }
    catch { status.textContent = "Recording isn't supported in this browser."; stream.getTracks().forEach((t) => t.stop()); return; }
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      blob = new Blob(chunks, { type: recorder.mimeType || (withCamera ? "video/webm" : "audio/webm") });
      video.srcObject = null; video.muted = false; video.controls = true; video.src = URL.createObjectURL(blob);
      clearInterval(timerInt); stopWave();
      if (wave) wave.hidden = true;
      if (footnote) footnote.hidden = true;
      status.textContent = "Review your take.";
      setButtons([
        { label: "Retake", onClick: () => { video.controls = false; video.removeAttribute("src"); showReady(); } },
        { label: "Use this take", variant: "primary", onClick: () => done(blob) },
      ]);
    };
    recorder.start();
    seconds = 0;
    if (wave) { wave.hidden = false; waveBars = [...wave.querySelectorAll(".rec-wave-bar")]; startWave(); }
    if (footnote) footnote.hidden = false;
    status.innerHTML = `<span class="rec-dot"></span> Recording… <span class="rec-time mono">0:00</span>`;
    const timeEl = () => status.querySelector(".rec-time");
    timerInt = setInterval(() => { seconds++; const t = timeEl(); if (t) t.textContent = fmt(seconds); }, 1000);
    setButtons([{ label: "Stop & save", variant: "danger", onClick: () => recorder.stop() }]);
  }
  showReady();
}

// "Enhance audio" — one-click denoise/EQ/level/loudness-normalize, run
// server-side in the ffmpeg container (see container/render.mjs). Non-
// destructive: the result previews against the original and nothing about
// the video changes until "Use enhanced audio" is chosen. Same dynamic-
// footer-buttons pattern as recordBridge/wireRecorder above.
function enhanceAudioFlow(v) {
  return UI.modal({
    title: "Enhance audio",
    bodyHTML: `<div id="__enhBody">
      <p class="modal-text">Removing noise, leveling, and normalizing loudness — this can take a minute or two for longer recordings.</p>
      <div class="spinner" style="margin:20px auto;display:block;width:22px;height:22px;"></div>
    </div>`,
    dismissValue: null,
    onOpen: (card, done) => wireEnhance(card, done, v),
  });
}
function wireEnhance(card, done, v) {
  const body = card.querySelector("#__enhBody");
  const foot = card.querySelector(".modal-foot");
  const setButtons = (buttons) => {
    foot.innerHTML = "";
    buttons.forEach((b) => {
      const el = document.createElement("button");
      el.className = `btn ${b.variant || ""}`.trim();
      el.textContent = b.label;
      el.disabled = !!b.disabled;
      el.onclick = b.onClick;
      foot.appendChild(el);
    });
  };
  setButtons([{ label: "Cancel", onClick: () => done(null) }]);

  (async () => {
    let data;
    try {
      const res = await fetch(`/api/videos/${v.id}/enhance-audio`, { method: "POST" });
      data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
    } catch (err) {
      body.innerHTML = `<p class="modal-text" style="color:var(--bad)">${esc(err.message || "Enhance failed")}</p>`;
      setButtons([{ label: "Close", onClick: () => done(null) }]);
      return;
    }
    body.innerHTML = `
      <p class="modal-text">Compare, then decide — nothing changes until you apply it.</p>
      <div class="enhance-compare">
        <div class="enhance-col"><div class="modal-label">Original</div><audio controls src="${esc(mediaUrl(v.r2_key))}"></audio></div>
        <div class="enhance-col"><div class="modal-label">Enhanced</div><audio controls src="${esc(data.mediaPath)}"></audio></div>
      </div>`;
    setButtons([
      { label: "Discard", onClick: () => done(null) },
      { label: "Use enhanced audio", variant: "primary", onClick: async () => {
        setButtons([{ label: "Applying…", disabled: true, onClick: () => {} }]);
        try {
          const applyRes = await fetch(`/api/videos/${v.id}/apply-enhanced-audio`, { method: "POST" });
          const applyData = await applyRes.json();
          if (!applyRes.ok) throw new Error(applyData.error || applyRes.statusText);
          v.r2_key = applyData.r2_key;
          renderVideoList();
          if (state.selected === v.id) selectVideo(v.id);
          toast("Enhanced audio applied", { type: "success" });
          done("applied");
        } catch (err) {
          toast(err.message || "Couldn't apply enhanced audio", { type: "error" });
          done(null);
        }
      } },
    ]);
  })();
}

// Uploads a recorded Blob through the exact same pipeline any dropped-in
// video file uses (presign → direct-to-R2 PUT → confirm → server-side
// transcribe), so a recorded take becomes a completely normal video —
// visible in the sidebar, editable like anything else. Takes a projectId
// explicitly (not state.project.id) so a VO beat's recording, which has no
// open project at all, can reuse this exact path — see
// recordAndAttachVoiceover, which uploads into the Voiceover scratch
// project the same way Bridges uploads into whichever project is open.
async function uploadAndTranscribeTake(blob, projectId, onProgress) {
  const file = new File([blob], `take-${Date.now()}.webm`, { type: blob.type || "video/webm" });
  onProgress?.("Reading…");
  const duration = await readDuration(file);
  onProgress?.("Uploading…");
  const pres = await fetch(`/api/projects/${projectId}/videos/presign`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ filename: file.name, contentType: file.type || "video/webm" }),
  }).then((r) => r.json());
  if (pres.error) throw new Error(pres.error);
  await putToR2(pres.uploadUrl, file, () => {});
  const video = await fetch(`/api/projects/${projectId}/videos/confirm`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ videoId: pres.videoId, key: pres.key, filename: file.name, duration }),
  }).then((r) => r.json());
  if (video.error) throw new Error(video.error);
  const item = { ...video, filename: file.name, status: "transcribing", words: null };
  state.videos.push(item); renderVideoList();
  onProgress?.("Transcribing…");
  await pollTranscription(item); // sets item.words/status and re-renders the project on success
  return item;
}

// ── Suggested edits (callbacks / contrasts / themes across the whole transcript) ──
async function findSuggestions(btn) {
  if (!state.videos.some((v) => v.status === "ready" && v.words)) { toast("Transcribe a video first."); return; }
  btn.classList.add("loading"); btn.disabled = true;
  try {
    const res = await fetch(`/api/projects/${state.project.id}/suggest-edits`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    state.suggestions = data.suggestions;
    renderSuggestions(); switchToolsTab("suggest");
    toast(`Found ${data.suggestions.length} connection${data.suggestions.length === 1 ? "" : "s"}`, { type: "success" });
  } catch (err) { toast(err.message || "Suggested edits failed", { type: "error", title: "Suggested edits" }); }
  btn.classList.remove("loading"); btn.disabled = false;
}
const SUGGEST_TYPE_LABEL = { callback: "Callback", contrast: "Contrast", theme: "Theme" };
function renderSuggestions() {
  const el = $("#suggest"); if (!el) return;
  const suggestions = state.suggestions || [];
  if (!suggestions.length) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="suggestions">
    <div class="tl-head"><h2>Suggested edits</h2><span class="empty small">${suggestions.length}</span></div>
    ${suggestions.map((s, i) => suggestionCard(s, i)).join("")}
  </div>`;
  suggestions.forEach((s, i) => {
    const card = el.querySelector(`.suggestion[data-i="${i}"]`);
    card.querySelector(".sg-preview").onclick = () => previewSuggestion(s);
    card.querySelector(".sg-apply").onclick = (e) => applySuggestion(s, e.currentTarget);
    card.querySelector(".sg-save").onclick = () => saveClipToLibrary(s.segments, { title: s.title, description: s.why, kind: "ai-detected" });
    card.querySelector(".sg-dismiss").onclick = () => {
      state.suggestions.splice(state.suggestions.indexOf(s), 1);
      renderSuggestions();
    };
    wireCardHighlight(card, s.segments);
  });
}
function suggestionCard(s, i) {
  const parts = s.segments.map((seg) => {
    const v = state.videos.find((x) => x.id === seg.videoId);
    return `<span class="sg-seg">${fmt(seg.start)} · ${esc(v ? filenameOf(v.filename) : seg.videoId)}</span>`;
  }).join(`<span class="sg-arrow">→</span>`);
  return `<div class="suggestion" data-i="${i}">
    <div class="sg-top"><span class="sg-type ${s.type}">${SUGGEST_TYPE_LABEL[s.type] || s.type}</span><span class="sg-title">${esc(s.title)}</span></div>
    <div class="sg-why">${esc(s.why)}</div>
    <div class="sg-segs">${parts}</div>
    <div class="s-actions"><button class="btn small ghost sg-preview">${ic("play")} Preview</button><button class="btn small ghost sg-save" title="Save to the cross-project Archive">Save</button><button class="btn small accent sg-apply">Add to Cut</button><button class="btn small ghost icon-only sg-dismiss" title="Dismiss">✕</button></div>
  </div>`;
}
async function previewSuggestion(s) {
  const clips = s.segments
    .map((seg) => {
      const v = state.videos.find((x) => x.id === seg.videoId);
      return v && v.r2_key ? { videoId: seg.videoId, r2_key: v.r2_key, start: seg.start, end: seg.end } : null;
    })
    .filter(Boolean);
  if (!clips.length) return;
  stopEdit(); edit.playing = true; edit.clips = clips;
  await playClip(0);
}
function applySuggestion(s, btn) {
  if (!state.timeline) state.timeline = { coldOpen: [], body: [] };
  s.segments.forEach((seg) => state.timeline.body.push({ ...seg, reason: s.title }));
  saveTimeline(); renderTimeline(); updateStats();
  btn.textContent = "Added ✓";
  setTimeout(() => { btn.textContent = "Add to Cut"; }, 1200);
  toast("Added to the Cut tab", { type: "success" });
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
    renderShorts(); switchToolsTab("shorts");
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
    card.querySelector(".short-cover").onclick = () => previewShort(s);
    card.querySelector(".s-play").onclick = () => previewShort(s);
    card.querySelector(".s-prod").onclick = (e) => produceShort(s, e.currentTarget);
    card.querySelector(".short-dismiss").onclick = (e) => {
      e.stopPropagation();
      state.shorts.splice(state.shorts.indexOf(s), 1);
      renderShorts();
    };
    wireCardHighlight(card, [{ videoId: s.videoId, start: s.start, end: s.end }]);
  });
  Thumb.hydrate(el);
}
function shortCard(s, i) {
  const v = state.videos.find((x) => x.id === s.videoId);
  const src = v ? filenameOf(v.filename) : s.videoId;
  const score = typeof s.score === "number" ? s.score : null;
  const tier = score == null ? "" : score >= 80 ? "hot" : score >= 55 ? "warm" : "cool";
  const thumbUrl = v && v.r2_key ? mediaUrl(v.r2_key) : "";
  return `<div class="short" data-i="${i}">
    <div class="short-cover">
      ${thumbUrl ? `<img class="thumb-img" data-thumb-src="${esc(thumbUrl)}" data-thumb-t="${Math.max(0.1, s.start).toFixed(1)}" alt="" />` : ""}
      <div class="short-cover-scrim"></div>
      <div class="short-cover-play">${ic("play")}</div>
      ${score != null ? `<span class="short-score ${tier}">${score}</span>` : ""}
      <span class="short-dur">${Math.round(s.end - s.start)}s</span>
      <button class="short-dismiss" title="Dismiss">✕</button>
    </div>
    <div class="short-body">
      <div class="s-title">${esc(s.title)}</div>
      <div class="s-hook">${esc(s.hook || "")}</div>
      <div class="s-meta">${fmt(s.start)}–${fmt(s.end)} · ${esc(src)}</div>
      <div class="s-actions"><button class="btn small ghost s-play">${ic("play")} Preview</button><button class="btn small accent s-prod">${ic("download")} Produce</button></div>
    </div>
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
// Produces a publish-ready short: vertical (9:16) reframe + burned-in
// karaoke captions from the source video's own transcript, not just a raw
// trim — see render.js's renderShort for the actual ffmpeg work.
async function produceShort(s, btn) {
  const v = state.videos.find((x) => x.id === s.videoId); if (!v) return;
  const prev = btn.innerHTML; btn.disabled = true;
  try {
    const blob = await Renderer.renderShort(
      { r2_key: v.r2_key, start: s.start, end: s.end, words: v.words || [] },
      (msg) => { btn.textContent = msg; },
    );
    downloadBlob(blob, safeName(s.title) + ".mp4");
    toast("Short produced — downloading", { type: "success" });
  } catch (err) { toast(err.message || "Produce failed", { type: "error" }); }
  btn.disabled = false; btn.innerHTML = prev;
}

// ── Long-form export ─────────────────────────────────────────────────
async function exportCut(btn) {
  const clips = await buildClips();
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
    const item = { id: null, filename: file.name, status: "uploading", pct: 0, duration: null, words: null };
    state.videos.push(item); renderVideoList();
    try {
      item.duration = await readDuration(file);
      // 1) get a signed direct-to-storage URL
      const pres = await fetch(`/api/projects/${state.project.id}/videos/presign`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type || "video/mp4" }),
      }).then((r) => r.json());
      if (pres.error) throw new Error(pres.error);
      item.id = pres.videoId;
      // 2) upload straight to storage (no size cap), with progress
      item.stage = "uploading…"; renderVideoList();
      await putToR2(pres.uploadUrl, file, (p) => { item.pct = p; renderVideoList(); });
      // 3) register the video
      const video = await fetch(`/api/projects/${state.project.id}/videos/confirm`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoId: pres.videoId, key: pres.key, filename: file.name, duration: item.duration }),
      }).then((r) => r.json());
      if (video.error) throw new Error(video.error);
      Object.assign(item, video);
      // 4) transcribe (server-side, any length)
      await pollTranscription(item);
    } catch (err) {
      item.status = "failed"; item.error = err.message || String(err); renderVideoList();
      toast(item.error, { type: "error", title: "Upload failed" });
    }
  }
}

// Direct PUT to storage with progress.
function putToR2(uploadUrl, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`storage upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("network error during upload"));
    xhr.send(file);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Start remote transcription and poll until ready (handles long videos).
// Step 1 (extraction) is a single directly-awaited request — the server does
// it synchronously, so this tab must stay open while it runs. (An earlier
// version tried to background this and return instantly, but Cloudflare kills
// waitUntil() background tasks almost immediately — confirmed via live log
// tailing — which just left the job frozen forever with no error surfaced.)
// Step 2 (chunk transcription) is real polling once extraction is done.
async function pollTranscription(item) {
  item.status = "transcribing";
  item.stage = "extracting audio — can take several minutes for long videos, keep this tab open…";
  renderVideoList();
  const start = await fetch(`/api/videos/${item.id}/transcribe-remote`, { method: "POST" });
  if (!start.ok) { const d = await start.json().catch(() => ({})); throw new Error(d.error || "couldn't start transcription"); }
  item.stage = "transcribing…"; renderVideoList();
  for (let i = 0; i < 2000; i++) {
    await sleep(1500);
    const res = await fetch(`/api/videos/${item.id}/transcribe-status`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "status check failed");
    if (typeof data.progress === "number") {
      item.stage = `transcribing ${data.progress}%…`;
      renderVideoList();
    }
    if (data.status === "ready") {
      // A (re-)transcribe replaces the whole words array — old undo/redo
      // history from before it (Retry/Re-transcribe can run on a video that
      // already had edits) would reference a different-length array and no
      // longer make sense to restore.
      item.words = data.words; item.status = "ready"; item.stage = "";
      item._history = []; item._future = [];
      if (!state.selected) state.selected = item.id;
      renderProject();
      toast(`“${item.filename}” transcribed`, { type: "success" });
      // Studio is the "lighter" framing — no manual button-clicking to
      // populate its three sidebar sections, they fill in on their own.
      if (state.studioMode) {
        autoArrange(NOOP_BTN).catch(() => {});
        findSuggestions(NOOP_BTN).catch(() => {});
        findShorts(NOOP_BTN).catch(() => {});
      }
      return;
    }
    if (data.status === "failed") throw new Error(data.error || "transcription failed");
  }
  throw new Error("transcription timed out");
}

// Retry transcription for a video whose upload already succeeded — no re-upload.
async function retryVideo(v) {
  v.error = null;
  try {
    await pollTranscription(v);
  } catch (err) {
    v.status = "failed"; v.error = err.message || String(err); renderVideoList();
    toast(v.error, { type: "error", title: "Transcription failed" });
  }
}

// Import a video from a URL (Rumble / direct link) → R2 → transcribe.
async function importFromUrl() {
  const input = $("#url");
  const url = (input.value || "").trim();
  if (!url) return;
  const btn = $("#importBtn");
  btn.classList.add("loading"); btn.disabled = true;
  const item = { id: null, filename: "Importing…", status: "importing", stage: "fetching video…", words: null };
  state.videos.push(item); renderVideoList();
  try {
    const res = await fetch(`/api/projects/${state.project.id}/import`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }),
    });
    const video = await res.json();
    if (!res.ok) throw new Error(video.error || res.statusText);
    Object.assign(item, video);
    input.value = "";
    await pollTranscription(item);
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

// ── Clip Library (cross-project) ──────────────────────────────────────
// The reusable-clip bin: every clip saved from any project (manually, or
// kept from an AI suggestion) lives here permanently, browsable by tag
// across the whole account — not scoped to one project's lifecycle like
// the Cut tab. See migrations/0002_clips.sql / src/clips.ts for the schema.

// A clip's segment can reference a video that isn't part of the CURRENTLY
// open project (if any) — checks state.videos first (the fast, common
// in-project path), falls back to a cached network fetch for anything
// "foreign." One cache entry per videoId, shared across the whole session.
const videoMetaCache = new Map(); // videoId -> Video|null|Promise
async function resolveVideo(videoId) {
  const local = state.videos?.find((v) => v.id === videoId);
  if (local) return local;
  if (!videoMetaCache.has(videoId)) {
    videoMetaCache.set(videoId, fetch(`/api/videos/${videoId}`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  }
  const v = await videoMetaCache.get(videoId);
  videoMetaCache.set(videoId, v);
  return v;
}

// Seek/play a single Timeline segment in the project editor's shared player.
// selectVideo() only knows how to point the player at a video that's part of
// THIS project's own sidebar list — a segment pulled in from a Library clip
// in another project needs the player src set directly instead.
async function playSegmentInMainPlayer(s) {
  const player = $("#sel-player"); if (!player) return;
  if (state.videos.some((x) => x.id === s.videoId)) {
    selectVideo(s.videoId);
  } else {
    const v = await resolveVideo(s.videoId);
    if (!v || !v.r2_key) { toast("Couldn't load that clip's video."); return; }
    if (player.dataset.key !== v.r2_key) { player.src = mediaUrl(v.r2_key); player.dataset.key = v.r2_key; }
  }
  player.currentTime = s.start;
  player.play();
}

// Fills in "0:12 · filename" labels on already-rendered segment spans once
// each video is resolved (may be an async network fetch for foreign clips),
// instead of blocking the whole card render on it.
function hydrateSegLabels(root, segments) {
  segments.forEach((seg, si) => {
    const span = root.querySelector(`[data-seg="${si}"]`);
    if (!span) return;
    resolveVideo(seg.videoId).then((v) => {
      span.textContent = `${fmt(seg.start)} · ${v ? filenameOf(v.filename) : seg.videoId}`;
    });
  });
}

// Save-to-Library modal — title/description/tags, reusing UI.modal's generic
// bodyHTML+actions (no new modal component needed).
async function promptClipDetails(defaults = {}) {
  return UI.modal({
    title: "Save to Archive",
    bodyHTML: `
      <label class="modal-label">Title</label>
      <input class="modal-input" id="__clipTitle" value="${esc(defaults.title || "")}" placeholder="e.g. Darkside Phil raging at chat" autocomplete="off" />
      <label class="modal-label" style="margin-top:12px;">Description</label>
      <input class="modal-input" id="__clipDesc" value="${esc(defaults.description || "")}" placeholder="Optional note" autocomplete="off" />
      <label class="modal-label" style="margin-top:12px;">Tags</label>
      <input class="modal-input" id="__clipTags" placeholder="comma, separated, tags" autocomplete="off" />
    `,
    dismissValue: null,
    onOpen: (card) => { const t = card.querySelector("#__clipTitle"); t.focus(); t.select(); },
    actions: [
      { label: "Cancel", resolve: null },
      { label: "Save", variant: "primary", onClick: (done, card) => done({
        title: card.querySelector("#__clipTitle").value.trim(),
        description: card.querySelector("#__clipDesc").value.trim(),
        tags: card.querySelector("#__clipTags").value.split(",").map((t) => t.trim()).filter(Boolean),
      }) },
    ],
  });
}
// Shared save action wired from three places that already have a Segment[]
// on hand: the transcript selection toolbar, a Suggested Edits card, and a
// Cut/Timeline row. `defaults.kind` marks AI-detected saves distinctly from
// manual ones (shown in the Library grid).
async function saveClipToLibrary(segments, defaults = {}) {
  const result = await promptClipDetails(defaults);
  if (!result) return;
  if (!result.title) { toast("A title is required."); return; }
  try {
    const res = await fetch("/api/clips", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: result.title, description: result.description, tags: result.tags, kind: defaults.kind || "manual", segments }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    toast("Saved to Archive", { type: "success" });
    captureVisualTags(data.id, segments); // enrichment, not awaited — a saved clip doesn't wait on it
  } catch (err) { toast(err.message || "Couldn't save clip", { type: "error" }); }
}

// Captures a few keyframes per segment — reusing the exact same client-side
// frame grab every thumbnail in the app already uses (Thumb.grab), so no
// server/ffmpeg work is needed — and sends them off to be captioned/OCR'd
// (Moondream 3.1, via POST /api/clips/:id/visual-tags). Fire-and-forget:
// visual tagging enriches a clip that already exists, it's never a
// precondition for saving one, so a failure here stays silent.
const VISUAL_KEYFRAMES_PER_SEGMENT = 3;
async function captureVisualTags(clipId, segments) {
  const frames = [];
  for (const seg of segments) {
    const v = await resolveVideo(seg.videoId);
    if (!v || !v.r2_key) continue;
    const url = mediaUrl(v.r2_key);
    const span = Math.max(seg.end - seg.start, 0.1);
    for (let i = 0; i < VISUAL_KEYFRAMES_PER_SEGMENT; i++) {
      const t = seg.start + (span * (i + 0.5)) / VISUAL_KEYFRAMES_PER_SEGMENT;
      const image = await Thumb.grab(url, t);
      if (image) frames.push({ videoId: seg.videoId, time: t, image });
    }
  }
  if (!frames.length) return;
  try {
    await fetch(`/api/clips/${clipId}/visual-tags`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ frames }),
    });
  } catch { /* silent — enrichment only */ }
}

// Minimal sequential player scoped to the Library view's own <video> element
// — deliberately NOT reusing the project editor's edit.clips/playClip (those
// are tightly coupled to the project view's DOM: video list, transcript
// playhead highlighting, etc., none of which exist here).
const libPlayback = { playing: false, clips: [], raf: 0 };
async function previewClipSegments(segments) {
  const resolved = [];
  for (const seg of segments) {
    const v = await resolveVideo(seg.videoId);
    if (v && v.r2_key) resolved.push({ r2_key: v.r2_key, start: seg.start, end: seg.end });
  }
  if (!resolved.length) { toast("Couldn't load that clip's video."); return; }
  stopLibraryPlayback();
  libPlayback.playing = true; libPlayback.clips = resolved;
  await playLibraryClip(0);
}
async function playLibraryClip(i) {
  if (!libPlayback.playing) return;
  const clip = libPlayback.clips[i];
  const player = $("#libPreviewPlayer");
  if (!player) return;
  await ensureSrc(player, clip);
  if (!libPlayback.playing) return;
  try { player.currentTime = clip.start; await player.play(); } catch {}
  cancelAnimationFrame(libPlayback.raf);
  const tick = () => {
    if (!libPlayback.playing) return;
    if (player.currentTime >= clip.end - 0.03) {
      if (i + 1 >= libPlayback.clips.length) { stopLibraryPlayback(); return; }
      playLibraryClip(i + 1); return;
    }
    libPlayback.raf = requestAnimationFrame(tick);
  };
  libPlayback.raf = requestAnimationFrame(tick);
}
function stopLibraryPlayback() {
  libPlayback.playing = false; cancelAnimationFrame(libPlayback.raf);
  const p = $("#libPreviewPlayer"); if (p && !p.paused) p.pause();
}

async function showLibrary() {
  location.hash = "#/archive"; setActiveRail("archive");
  setCrumbs([]); setStats(""); $("#headerActions").innerHTML = ""; state.project = null;
  stopLibraryPlayback();
  state.libraryThread = state.libraryThread || null;
  state.libraryType = state.libraryType || null;
  main.innerHTML = `<div class="loading"><span class="spinner"></span> Loading library…</div>`;
  let tags = [], clips = [], essays = [];
  try {
    const [tagData, clipData, essayData] = await Promise.all([
      fetch("/api/clips/tags").then((r) => r.json()),
      fetch("/api/clips?withThreads=1&limit=500").then((r) => r.json()),
      fetch("/api/essays").then((r) => r.json()).then((d) => d.essays || []).catch(() => []),
    ]);
    tags = tagData.tags || []; clips = clipData.clips || []; essays = essayData || [];
  } catch { main.innerHTML = `<div class="pad"><p class="empty">Couldn't reach the server.</p></div>`; return; }
  state.libraryEssays = essays;

  const threadIds = new Set(clips.map((c) => c.thread?.id).filter(Boolean));
  const statsLine = clips.length
    ? `${clips.length} clip${clips.length === 1 ? "" : "s"} saved${threadIds.size ? `, clustered into ${threadIds.size} thread${threadIds.size === 1 ? "" : "s"}` : ""} so far.`
    : "";

  main.innerHTML = `
    <section class="pad">
      <div class="row-between">
        <div><h1>Archive</h1><div class="sub">Every clip you've saved, across every project — the reusable building blocks for a video essay. ${statsLine ? `<span class="archive-stats">${esc(statsLine)}</span>` : ""}</div></div>
        <button class="btn primary" id="discoverBtn">${ic("sparkle")} Find related clips across my archive</button>
      </div>
      <div class="essay-link" id="toThreadsLink">See thread breakdown and growth trends in Threads →</div>

      <div class="direct-box-wrap archive-ask-wrap" style="margin-top:14px;">
        <div class="direct-label">${ic("sparkle")}<span>Ask the archive</span><small>— e.g. "what does Phil say about burnout?"</small></div>
        <div class="direct-box">
          <input id="askInput" class="modal-input" placeholder="Ask the archive something…" autocomplete="off" />
          <button class="btn primary" id="askBtn">Ask</button>
        </div>
        <div id="askResult"></div>
      </div>

      <div class="direct-box-wrap" style="margin-top:16px;">
        <div class="direct-label">${ic("sparkle")}<span>Compose a video essay</span><small>— describe what you want; the AI drafts a sequence from your saved clips (not raw transcripts)</small></div>
        <div class="direct-box">
          <textarea id="composeInput" rows="2" placeholder='e.g. "A video essay about Darkside Phil raging at his audience"'></textarea>
          <button class="btn primary" id="composeBtn">${ic("sparkle")} Compose draft</button>
        </div>
      </div>
      <div id="composeResult"></div>

      <video id="libPreviewPlayer" playsinline style="width:100%;max-height:32vh;background:#000;border-radius:9px;margin:14px 0;display:none;"></video>
      <div class="tag-rail" id="threadFilterRail"></div>
      <div class="tag-rail" id="typeFilterRail"></div>
      <div class="tag-rail" id="tagRail"></div>
      <input id="librarySearch" class="import-input" placeholder="Search clips by title or description…" style="max-width:340px;margin:14px 0;" autocomplete="off" />
      <div id="libraryClusters"></div>
      <div id="discoverResults"></div>
    </section>`;
  $("#toThreadsLink").onclick = () => showThreadsView();
  renderTagRail(tags);
  renderThreadFilterRail(clips);
  renderTypeFilterRail();
  renderLibraryClusters(clips);
  $("#discoverBtn").onclick = (e) => runDiscover(e.currentTarget);
  $("#composeBtn").onclick = (e) => runCompose(e.currentTarget);
  $("#composeInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); runCompose($("#composeBtn")); }
  });
  $("#askBtn").onclick = (e) => runAskArchive(e.currentTarget);
  $("#askInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); runAskArchive($("#askBtn")); }
  });
  let searchDebounce = null;
  $("#librarySearch").addEventListener("input", () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(reloadLibraryGrid, 300);
  });
  const player = $("#libPreviewPlayer");
  player.addEventListener("play", () => { player.style.display = "block"; });
}

async function runAskArchive(btn) {
  const input = $("#askInput");
  const question = input?.value.trim();
  if (!question) return;
  const resultEl = $("#askResult");
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = "Asking…";
  resultEl.innerHTML = "";
  try {
    const data = await fetch("/api/archive/ask", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question }),
    }).then((r) => r.json());
    if (data.error) throw new Error(data.error);
    if (!data.result) {
      resultEl.innerHTML = `<div class="ask-answer empty small">Nothing in the archive answers that yet — try a broader question.</div>`;
    } else {
      resultEl.innerHTML = `<div class="ask-answer">
        <div class="ask-answer-summary">${esc(data.result.summary)}</div>
        ${data.result.citations.length ? `<div class="ask-answer-cites">${data.result.citations.map((c) => `— "${esc(c.quote)}"`).join("<br>")}</div>` : ""}
      </div>`;
    }
  } catch (err) {
    resultEl.innerHTML = `<div class="empty small">Couldn't ask the archive: ${esc(err.message || "unknown error")}</div>`;
  }
  btn.disabled = false; btn.textContent = orig;
}

function renderTagRail(tags) {
  const el = $("#tagRail"); if (!el) return;
  if (!tags.length) { el.innerHTML = ""; return; }
  el.innerHTML = tags.map((t) =>
    `<span class="tag-chip${state.libraryTag === t.tag ? " on" : ""}" data-tag="${esc(t.tag)}" style="border-left:2px solid ${colorForTag(t.tag)}">${esc(t.tag)} <span class="tag-count">${t.count}</span></span>`,
  ).join("");
  el.querySelectorAll(".tag-chip").forEach((chip) => {
    chip.onclick = () => {
      state.libraryTag = state.libraryTag === chip.dataset.tag ? null : chip.dataset.tag;
      renderTagRail(tags);
      reloadLibraryGrid();
    };
  });
}

// Thread filter chips built from whichever threads actually appear among
// saved clips (no separate /api/threads round trip needed — the withThreads
// join on GET /api/clips already resolved each clip's thread).
function renderThreadFilterRail(clips) {
  const el = $("#threadFilterRail"); if (!el) return;
  const byId = new Map();
  clips.forEach((c) => { if (c.thread && !byId.has(c.thread.id)) byId.set(c.thread.id, { ...c.thread, count: 0 }); if (c.thread) byId.get(c.thread.id).count++; });
  const threads = [...byId.values()].sort((a, b) => b.count - a.count);
  if (!threads.length) { el.innerHTML = ""; return; }
  el.innerHTML = threads.map((t) =>
    `<span class="tag-chip${state.libraryThread === t.id ? " on" : ""}" data-thread="${esc(t.id)}" style="border-left:2px solid ${t.color}">${esc(t.name)} <span class="tag-count">${t.count}</span></span>`,
  ).join("");
  el.querySelectorAll(".tag-chip").forEach((chip) => {
    chip.onclick = () => {
      state.libraryThread = state.libraryThread === chip.dataset.thread ? null : chip.dataset.thread;
      renderThreadFilterRail(clips);
      reloadLibraryGrid();
    };
  });
}
// The archive's underlying taxonomy is manual-vs-AI-detected, not the
// prototype's literal Dialogue/B-roll/Analysis categories (no such field
// exists on a clip) — filtering by kind is the closest real equivalent.
function renderTypeFilterRail() {
  const el = $("#typeFilterRail"); if (!el) return;
  const types = [{ id: "manual", label: "Manual" }, { id: "ai-detected", label: "AI-detected" }];
  el.innerHTML = types.map((t) =>
    `<span class="tag-chip${state.libraryType === t.id ? " on" : ""}" data-type="${t.id}">${t.label}</span>`,
  ).join("");
  el.querySelectorAll(".tag-chip").forEach((chip) => {
    chip.onclick = () => {
      state.libraryType = state.libraryType === chip.dataset.type ? null : chip.dataset.type;
      renderTypeFilterRail();
      reloadLibraryGrid();
    };
  });
}

async function reloadLibraryGrid() {
  const params = new URLSearchParams({ withThreads: "1" });
  if (state.libraryTag) params.set("tag", state.libraryTag);
  if (state.libraryType) params.set("kind", state.libraryType);
  const q = $("#librarySearch")?.value.trim();
  if (q) params.set("q", q);
  let clips = [];
  try { clips = (await fetch(`/api/clips?${params}`).then((r) => r.json())).clips || []; } catch { /* leave grid as-is */ }
  renderThreadFilterRail(clips);
  if (state.libraryThread) clips = clips.filter((c) => c.thread?.id === state.libraryThread);
  renderLibraryClusters(clips);
}

// Groups clips by thread — the Archive's centerpiece is "browse by what it's
// about," not a flat tag-filtered list. Clips with no resolved thread yet
// (nothing embedded/tagged) land in a trailing "Uncategorized" bucket.
function renderLibraryClusters(clips) {
  const el = $("#libraryClusters"); if (!el) return;
  if (!clips.length) {
    el.innerHTML = `<div class="empty-note">No clips saved yet — select text in a project's transcript and choose <b>Save to Archive</b>, save a Suggested Edit, or run Discover above.</div>
      ${skeletonCardHTML("clip-card", "clip-body")}${skeletonCardHTML("clip-card", "clip-body")}${skeletonCardHTML("clip-card", "clip-body")}`;
    return;
  }
  const groups = new Map();
  for (const c of clips) {
    const key = c.thread?.id || "__uncategorized";
    if (!groups.has(key)) groups.set(key, { thread: c.thread || null, clips: [] });
    groups.get(key).clips.push(c);
  }
  const ordered = [...groups.values()].sort((a, b) => b.clips.length - a.clips.length);
  // "Uncategorized" always last, whatever its size.
  ordered.sort((a, b) => (a.thread ? 0 : 1) - (b.thread ? 0 : 1));

  el.innerHTML = ordered.map((g, gi) => {
    const t = g.thread;
    const idx = String(gi + 1).padStart(2, "0");
    const title = t ? esc(t.name) : "Uncategorized";
    const desc = t
      ? `${g.clips.length} clip${g.clips.length === 1 ? "" : "s"} — including "${esc(g.clips[0].title)}"`
      : "Not yet clustered into a thread — needs a tag or more clips nearby in meaning.";
    return `<div class="archive-cluster">
      <div class="archive-cluster-head" ${t ? `style="border-left:2px solid ${t.color}"` : ""}>
        <span class="archive-cluster-index">${idx}</span>
        <div>
          <div class="archive-cluster-title" ${t ? `style="color:${t.color}"` : ""}>${title}</div>
          <div class="archive-cluster-desc">${desc}</div>
        </div>
        <span class="archive-cluster-count">${g.clips.length}</span>
      </div>
      <div class="library-grid archive-cluster-grid" id="libCluster${gi}"></div>
    </div>`;
  }).join("");

  ordered.forEach((g, gi) => {
    const gridEl = $(`#libCluster${gi}`);
    gridEl.innerHTML = g.clips.map((c, i) => clipCard(c, i)).join("");
    g.clips.forEach((c, i) => {
      const card = gridEl.querySelector(`.clip-card[data-i="${i}"]`);
      card.querySelector(".clip-preview").onclick = () => previewClipSegments(c.segments);
      card.querySelector(".clip-add-project").onclick = () => addClipToProject(c);
      card.querySelector(".clip-delete").onclick = () => deleteLibraryClip(c.id);
      const essaySelect = card.querySelector(".clip-add-essay");
      if (essaySelect) essaySelect.onchange = () => { if (essaySelect.value) addClipToEssayQuick(c, essaySelect.value, essaySelect); };
      hydrateSegLabels(card, c.segments);
    });
  });
  Thumb.hydrate(el);
}
async function addClipToEssayQuick(clip, essayId, selectEl) {
  try {
    const res = await fetch(`/api/essays/${essayId}/beats`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ act: "development", kind: "clip", clipId: clip.id, text: clip.title }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    const essay = (state.libraryEssays || []).find((e) => e.id === essayId);
    toast(`Added to ${essay?.title || "essay"}`, { type: "success" });
  } catch (err) { toast(err.message || "Couldn't add to essay", { type: "error" }); }
  if (selectEl) selectEl.value = "";
}
function clipCard(c, i) {
  const segParts = c.segments.map((s, si) => `<span class="sg-seg" data-seg="${si}">${fmt(s.start)}</span>`).join(`<span class="sg-arrow">→</span>`);
  // What's actually on screen, not just what's said/tagged — surfaced so
  // visual tagging is visibly useful, not silently indexed.
  const visualCaptions = [...new Set(c.segments.flatMap((s) => (s.visualTags || []).map((t) => t.caption).filter(Boolean)))].slice(0, 2);
  const first = c.segments[0];
  const thumb = first
    ? frameThumbHTML(first.r2Key, first.end - first.start, (first.start + first.end) / 2)
    : frameThumbHTML(null);
  const essayOptions = (state.libraryEssays || []).map((e) => `<option value="${esc(e.id)}">${esc(e.title)}</option>`).join("");
  return `<div class="clip-card" data-i="${i}">
    ${thumb}
    <div class="clip-body">
    <div class="sg-top"><span class="sg-type ${c.kind === "ai-detected" ? "theme" : "callback"}">${c.kind === "ai-detected" ? "AI-detected" : "Manual"}</span><span class="sg-title">${esc(c.title)}</span></div>
    ${c.thread ? `<span class="clip-thread-badge" style="color:${c.thread.color};background:${c.thread.color}22;">${esc(c.thread.name)}</span>` : ""}
    ${c.description ? `<div class="sg-why">${esc(c.description)}</div>` : ""}
    ${visualCaptions.length ? `<div class="sg-visual">${visualCaptions.map((cap) => `👁 ${esc(cap)}`).join(" · ")}</div>` : ""}
    <div class="sg-segs">${segParts}</div>
    ${c.tags.length ? `<div class="tag-rail small">${c.tags.map((t) => `<span class="tag-chip" style="border-left:2px solid ${colorForTag(t)}">${esc(t)}</span>`).join("")}</div>` : ""}
    ${c.usedInEssays ? `<div class="clip-used-in">Used in ${c.usedInEssays} essay${c.usedInEssays === 1 ? "" : "s"}</div>` : ""}
    <div class="s-actions">
      <button class="btn small ghost clip-preview">${ic("play")} Preview</button>
      <button class="btn small accent clip-add-project">${ic("plus")} Add to project</button>
      <button class="btn small danger clip-delete">Delete</button>
    </div>
    ${essayOptions ? `<select class="modal-input clip-add-essay" style="margin-top:6px;"><option value="">Add to essay…</option>${essayOptions}</select>` : ""}
    </div>
  </div>`;
}
async function deleteLibraryClip(id) {
  if (!(await UI.confirm({ title: "Delete this clip?", message: "This removes it from the Archive permanently — it doesn't affect the source video.", confirmText: "Delete", danger: true }))) return;
  try {
    const res = await fetch(`/api/clips/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    toast("Clip deleted", { type: "success" });
    reloadLibraryGrid();
  } catch (err) { toast(err.message || "Couldn't delete clip", { type: "error" }); }
}

// Account-wide AI detection — same engine as a project's Suggested Edits,
// pointed at every transcribed video across every project instead of one.
async function runDiscover(btn) {
  btn.classList.add("loading"); btn.disabled = true;
  try {
    const res = await fetch("/api/clips/discover", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    renderDiscoverResults(data.candidates || []);
    toast(`Found ${data.candidates.length} candidate${data.candidates.length === 1 ? "" : "s"}`, { type: "success" });
  } catch (err) { toast(err.message || "Discover failed", { type: "error", title: "Discover" }); }
  btn.classList.remove("loading"); btn.disabled = false;
}

// ── Compose — draft a video essay directly from the clip library ───────
// Grounded against SAVED clips (their title/description/tags), not raw
// transcript sentences — the model only ever picks and orders clip ids;
// the server maps each one back to that clip's own stored segments. The
// result is a draft Timeline the user can preview, then either save as a
// brand-new project or add into an existing one.
async function runCompose(btn) {
  const instruction = ($("#composeInput")?.value || "").trim();
  if (!instruction) { toast("Describe the video essay you want first."); return; }
  btn.classList.add("loading"); btn.disabled = true;
  try {
    const res = await fetch("/api/clips/compose", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ instruction }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    renderComposeResult(data.timeline);
    const n = (data.timeline.coldOpen || []).length + (data.timeline.body || []).length;
    if (n) toast(`Drafted a sequence from ${n} clip segment(s)`, { type: "success" });
    else toast("Nothing in your library matched that — try rephrasing or save more clips.", { type: "error" });
  } catch (err) { toast(err.message || "Compose failed", { type: "error", title: "Compose" }); }
  btn.classList.remove("loading"); btn.disabled = false;
}
function renderComposeResult(timeline) {
  const el = $("#composeResult"); if (!el) return;
  const groups = [["coldOpen", timeline.coldOpen || []], ["body", timeline.body || []]];
  const n = groups.reduce((s, [, segs]) => s + segs.length, 0);
  if (!n) { el.innerHTML = ""; return; }
  const row = (s, group, i) => `<div class="seg" data-g="${group}" data-i="${i}">
    <span class="seg-time">${fmt(s.start)}–${fmt(s.end)}</span>
    <span class="seg-src" data-seg="${group}-${i}">${esc(s.videoId)}</span>
    <span class="seg-reason">${esc(s.reason || "")}</span></div>`;
  el.innerHTML = `<div class="tl">
    <div class="tl-head"><h2>Draft video essay</h2><span class="empty small">${n} segment(s)</span></div>
    ${(timeline.coldOpen || []).length ? `<div class="tl-label">Cold open</div>${timeline.coldOpen.map((s, i) => row(s, "coldOpen", i)).join("")}` : ""}
    ${(timeline.body || []).length ? `<div class="tl-label">Body</div>${timeline.body.map((s, i) => row(s, "body", i)).join("")}` : ""}
    <div class="s-actions" style="margin-top:10px;">
      <button class="btn small ghost" id="composePreview">${ic("play")} Preview</button>
      <button class="btn small accent" id="composeNewProject">${ic("plus")} Save as new project</button>
    </div>
  </div>`;
  groups.forEach(([group, segs]) => segs.forEach((s, i) => {
    resolveVideo(s.videoId).then((v) => {
      const span = el.querySelector(`[data-seg="${group}-${i}"]`);
      if (span && v) span.textContent = filenameOf(v.filename);
    });
  }));
  $("#composePreview").onclick = () => previewClipSegments([...(timeline.coldOpen || []), ...(timeline.body || [])]);
  $("#composeNewProject").onclick = () => saveComposeAsProject(timeline);
}
async function saveComposeAsProject(timeline) {
  const name = await UI.prompt({ title: "New project", label: "Project name", placeholder: "e.g. Darkside Phil — a study in rage", confirmText: "Create" });
  if (name === null) return;
  try {
    const p = await api.createProject(name.trim() || "Untitled project");
    if (p.error) throw new Error(p.error);
    const res = await fetch(`/api/projects/${p.id}/timeline`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(timeline),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    toast("Project created from your draft", { type: "success" });
    openProject(p.id);
  } catch (err) { toast(err.message || "Couldn't create project", { type: "error" }); }
}

// Manually add one saved clip's segments into an existing project's Cut —
// the curatorial counterpart to Compose's AI-drafted sequence ("a lot of it
// will have to be me getting clips," picking one at a time by hand).
async function addClipToProject(clip) {
  let projects = [];
  try { projects = (await fetch("/api/projects").then((r) => r.json())).projects || []; } catch { /* handled below */ }
  if (!projects.length) { toast("Create a project first."); return; }
  const options = projects.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");
  const projectId = await UI.modal({
    title: "Add to project",
    bodyHTML: `<label class="modal-label">Which project?</label><select class="modal-input" id="__projPick">${options}</select>`,
    dismissValue: null,
    actions: [
      { label: "Cancel", resolve: null },
      { label: "Add", variant: "primary", onClick: (done, card) => done(card.querySelector("#__projPick").value) },
    ],
  });
  if (!projectId) return;
  try {
    const data = await fetch(`/api/projects/${projectId}`).then((r) => r.json());
    if (data.error) throw new Error(data.error);
    const timeline = data.timeline || { coldOpen: [], body: [] };
    timeline.body = timeline.body || [];
    clip.segments.forEach((s) => timeline.body.push({ videoId: s.videoId, start: s.start, end: s.end, reason: s.reason || clip.title }));
    const res = await fetch(`/api/projects/${projectId}/timeline`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(timeline),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    const name = projects.find((p) => p.id === projectId)?.name || "project";
    toast(`Added to ${name}`, { type: "success" });
  } catch (err) { toast(err.message || "Couldn't add to project", { type: "error" }); }
}
function renderDiscoverResults(candidates) {
  const el = $("#discoverResults"); if (!el) return;
  if (!candidates.length) { el.innerHTML = `<p class="empty small">No candidates found.</p>`; return; }
  el.innerHTML = `<div class="suggestions">
    <div class="tl-head"><h2>Discovered candidates</h2><span class="empty small">${candidates.length}</span></div>
    ${candidates.map((s, i) => discoverCard(s, i)).join("")}
  </div>`;
  candidates.forEach((s, i) => {
    const card = el.querySelector(`.suggestion[data-i="${i}"]`);
    card.querySelector(".sg-preview").onclick = () => previewClipSegments(s.segments);
    card.querySelector(".sg-save").onclick = () => saveClipToLibrary(s.segments, { title: s.title, description: s.why, kind: "ai-detected" });
    hydrateSegLabels(card, s.segments);
  });
}
function discoverCard(s, i) {
  const segParts = s.segments.map((seg, si) => `<span class="sg-seg" data-seg="${si}">${fmt(seg.start)}</span>`).join(`<span class="sg-arrow">→</span>`);
  return `<div class="suggestion" data-i="${i}">
    <div class="sg-top"><span class="sg-type ${s.type}">${SUGGEST_TYPE_LABEL[s.type] || s.type}</span><span class="sg-title">${esc(s.title)}</span></div>
    <div class="sg-why">${esc(s.why)}</div>
    <div class="sg-segs">${segParts}</div>
    <div class="s-actions"><button class="btn small ghost sg-preview">${ic("play")} Preview</button><button class="btn small accent sg-save">Save to Archive</button></div>
  </div>`;
}

// ── Threads — the analytics/ranking surface ─────────────────────────────
// v1 is derived from clip tags (see src/threads.ts for why: real semantic
// clustering needs a vector index, a later phase, not something to fake
// here) — auto-detected only, never user-created; rename/merge are the only
// mutations. colorForTag mirrors the server's hash+palette exactly so a
// tag's color matches everywhere it's shown (this rail view, Archive's tag
// chips, essay thread tags) without an extra round trip.
const THREAD_PALETTE = ["#8fbf7f", "#d48a7b", "#7ba7d4", "#c9a86a", "#a889c9", "#6fb8a8", "#c97f9e", "#9fae6a", "#7f9bd4", "#d4a37b"];
function colorForTag(tag) {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (Math.imul(h, 31) + tag.charCodeAt(i)) >>> 0;
  return THREAD_PALETTE[h % THREAD_PALETTE.length];
}
async function fetchThreads() {
  try { return (await fetch("/api/threads").then((r) => r.json())).threads || []; }
  catch { return []; }
}
const THREAD_KIND_GROUPS = [["person", "People"], ["show", "Shows"], ["topic", "Topics"]];
async function showThreadsView() {
  location.hash = "#/threads"; setActiveRail("threads");
  setCrumbs([]); setStats(""); $("#headerActions").innerHTML = ""; state.project = null;
  main.innerHTML = `<div class="loading"><span class="spinner"></span> Loading threads…</div>`;
  const threads = await fetchThreads();
  main.innerHTML = `<section class="pad">
    <div class="row-between">
      <div><h1>Threads</h1><div class="sub">Per-thread clip counts, growth, and color — auto-detected by theme across the Archive (what a clip's about, not just what it's tagged). Rename or merge, but a new one only appears once clips actually cluster that way.</div>
      <div class="threads-subtitle">Clustered by meaning — what's said plus what's on screen — not by matching tags. Two clips never tagged alike can still join the same thread.</div></div>
    </div>
    <div id="threadSections"></div>
  </section>`;
  const container = $("#threadSections");
  if (!threads.length) {
    container.innerHTML = `<div class="empty-note">No threads yet — save a couple of clips to the Archive and related ones will cluster here automatically.</div>`;
    return;
  }
  const groups = THREAD_KIND_GROUPS.map(([kind, label]) => ({ label, threads: threads.filter((t) => t.kind === kind) })).filter((g) => g.threads.length);
  container.innerHTML = groups.map((g) => `
    <div class="thread-kind-section">
      <div class="tools-h">${esc(g.label)}</div>
      <div class="grid">${g.threads.map(threadCardHTML).join("")}</div>
    </div>`).join("");
  wireThreadGrid(threads);
  threads.forEach((t) => loadNearMissForThread(t));
}
// Fetched lazily per card, after the grid itself renders, so a slow
// Vectorize near-neighbor lookup never blocks the list — see
// GET /api/threads/:id/near-miss.
async function loadNearMissForThread(t) {
  let nearMiss;
  try { ({ nearMiss } = await fetch(`/api/threads/${encodeURIComponent(t.id)}/near-miss`).then((r) => r.json())); }
  catch { return; }
  if (!nearMiss) return;
  const slot = document.querySelector(`.thread-card[data-id="${CSS.escape(t.id)}"] .thread-nearmiss-slot`);
  if (!slot) return;
  slot.innerHTML = `<div class="thread-nearmiss" style="border-color:${t.color}55">
    <div class="thread-nearmiss-label" style="color:${t.color}">Suggested addition · ${nearMiss.score}% semantic match</div>
    <div class="thread-nearmiss-quote">"${esc(nearMiss.quote)}"</div>
    <div class="thread-nearmiss-actions">
      <button class="btn small primary thread-nearmiss-add">Add to thread</button>
      <button class="btn small ghost thread-nearmiss-dismiss">Not related</button>
    </div>
  </div>`;
  slot.querySelector(".thread-nearmiss-add").onclick = async (e) => {
    e.currentTarget.disabled = true;
    await fetch(`/api/threads/${encodeURIComponent(t.id)}/near-miss/${encodeURIComponent(nearMiss.clipId)}/accept`, { method: "POST" });
    slot.innerHTML = `<div class="thread-nearmiss-accepted">✓ Added — the thread's embedding recentres on the next pass.</div>`;
  };
  slot.querySelector(".thread-nearmiss-dismiss").onclick = async (e) => {
    e.currentTarget.disabled = true;
    await fetch(`/api/threads/${encodeURIComponent(t.id)}/near-miss/${encodeURIComponent(nearMiss.clipId)}/dismiss`, { method: "POST" });
    slot.innerHTML = "";
  };
}
function threadInitials(name) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";
}
function threadCardHTML(t) {
  const maxWeek = Math.max(1, ...t.weeklyGrowth);
  const bars = t.weeklyGrowth.map((n) => `<div class="growth-bar" style="height:${Math.max(3, (n / maxWeek) * 100)}%;background:${t.color}"></div>`).join("");
  const thisWeek = t.weeklyGrowth[t.weeklyGrowth.length - 1] || 0;
  return `<div class="card thread-card" data-id="${esc(t.id)}" style="border-top:2px solid ${t.color}">
    <div class="card-body">
      <div class="row-between" style="margin-bottom:0;align-items:flex-start;">
        <div style="display:flex;gap:9px;align-items:flex-start;">
          <span class="thread-avatar" style="background:${t.color}22;color:${t.color}">${esc(threadInitials(t.name))}</span>
          <div class="card-title thread-name" title="Click to rename">${esc(t.name)}</div>
        </div>
        <span class="essay-meta">${t.clipCount} clip${t.clipCount === 1 ? "" : "s"}</span>
      </div>
      ${t.synopsis ? `<div class="thread-synopsis">${esc(t.synopsis)}</div>` : ""}
      <div class="thread-stats">
        <span>${t.sourceCount} src</span><span>${t.clipCount} clips</span><span>${t.themeCount} theme${t.themeCount === 1 ? "" : "s"}</span>
      </div>
      <div class="row-between" style="margin:2px 0 0;">
        <div class="growth-chart">${bars}</div>
        ${thisWeek ? `<span class="thread-growth-label" style="color:${t.color}">+${thisWeek} this week</span>` : ""}
      </div>
      ${t.sampleQuotes.length ? `<div class="thread-quotes">${t.sampleQuotes.map((q) => `<div class="finder-quote">"${esc(q)}"</div>`).join("")}</div>` : ""}
      <div class="s-actions">
        <button class="btn small ghost thread-rename">Rename</button>
        <button class="btn small ghost thread-merge">Merge into…</button>
      </div>
      <div class="thread-nearmiss-slot"></div>
    </div>
  </div>`;
}
function wireThreadGrid(threads) {
  $$(".thread-card").forEach((card) => {
    const t = threads.find((x) => x.id === card.dataset.id);
    const rename = async () => {
      const name = await UI.prompt({ title: "Rename thread", label: "Display name", value: t.name, confirmText: "Rename" });
      if (name === null || !name.trim()) return;
      await fetch(`/api/threads/${encodeURIComponent(t.id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: name.trim() }) });
      toast("Thread renamed", { type: "success" });
      showThreadsView();
    };
    card.querySelector(".thread-name").onclick = rename;
    card.querySelector(".thread-rename").onclick = rename;
    card.querySelector(".thread-merge").onclick = async () => {
      const others = threads.filter((x) => x.id !== t.id);
      if (!others.length) { toast("There's only one thread — nothing to merge into."); return; }
      const options = others.map((o) => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join("");
      const intoId = await UI.modal({
        title: `Merge "${t.name}" into…`,
        bodyHTML: `<label class="modal-label">Every clip in "${esc(t.name)}" will join the thread you pick — this can't be undone.</label><select class="modal-input" id="__mergePick" style="margin-top:10px;">${options}</select>`,
        dismissValue: null,
        actions: [{ label: "Cancel", resolve: null }, { label: "Merge", variant: "danger", onClick: (done, card2) => done(card2.querySelector("#__mergePick").value) }],
      });
      if (!intoId) return;
      await fetch(`/api/threads/${encodeURIComponent(t.id)}/merge`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intoId }) });
      toast("Threads merged", { type: "success" });
      showThreadsView();
    };
  });
}

// ── Discover — external, internet-sourced grounding for an essay's claims,
// beyond the user's own Archive footage. v1 source is Wikipedia's search API
// (see src/discover.ts) — real, dereferenceable results only, never an
// invented source. Each result carries an inline "Add to essay" select. ────
// Set when the user clicks "Find a source in Discover" on an ungrounded
// research beat — carries Discover to that beat's context (banner, a
// pre-filled/auto-run query, and swaps every result's action to "Ground
// this beat →" instead of the generic essay-picker). Cleared on navigating
// back to the essay or picking a source.
let discoverPendingResearch = null;
function findSourceForBeat(beat) {
  discoverPendingResearch = { essayId: essayState.essay.id, essayTitle: essayState.essay.title, beatId: beat.id, beatText: beat.text };
  location.hash = "#/discover";
}
async function showDiscoverView() {
  location.hash = "#/discover"; setActiveRail("discover");
  setCrumbs([]); setStats(""); $("#headerActions").innerHTML = ""; state.project = null;
  // Consumed once per visit — a later plain nav-click to Discover (hash
  // already "#/discover", so no new showDiscoverView() call happens until
  // the user actually leaves and comes back) shouldn't keep re-showing a
  // stale beat-grounding banner.
  const pending = discoverPendingResearch;
  discoverPendingResearch = null;
  main.innerHTML = `<section class="pad">
    <div><h1>Discover</h1><div class="sub">Search the open web for real sources to ground an essay's claims — every result is a real page, not a guess.</div></div>
    <div class="import" style="max-width:520px;flex-direction:row;gap:8px;margin-top:16px;">
      <input class="import-input" id="discoverQuery" placeholder="e.g. the psychology of parasocial relationships" autocomplete="off" />
      <button class="btn accent" id="discoverGo">${ic("globe")} Search</button>
    </div>
    ${pending ? `<div class="discover-pending-banner">
      <div>Grounding a beat in <b>${esc(pending.essayTitle)}</b> — pick the source below that supports: "${esc(pending.beatText)}"</div>
      <span class="essay-link" id="discoverBackToEssay">← Back to essay</span>
    </div>` : ""}
    <div id="discoverResults" style="margin-top:20px;"></div>
  </section>`;
  const run = () => runDiscoverSearch($("#discoverQuery").value);
  $("#discoverGo").onclick = run;
  $("#discoverQuery").addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
  if (pending) {
    $("#discoverQuery").value = pending.beatText;
    $("#discoverBackToEssay").onclick = () => { discoverPendingResearch = null; openEssayAtMode(pending.essayId, "script"); };
    run();
  } else {
    $("#discoverQuery").focus();
  }
}
async function runDiscoverSearch(query) {
  query = (query || "").trim();
  if (!query) return;
  const pending = discoverPendingResearch;
  const el = $("#discoverResults");
  el.innerHTML = `<div class="loading"><span class="spinner"></span> Searching…</div>`;
  let results = [];
  try {
    const res = await fetch("/api/discover/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    results = data.results || [];
  } catch (err) {
    el.innerHTML = `<p class="empty">${esc(err.message || "Search failed")}</p>`;
    return;
  }
  if (!results.length) { el.innerHTML = `<p class="empty">No real sources turned up for that — try rephrasing.</p>`; return; }

  let essays = [];
  if (!pending) { try { essays = (await fetch("/api/essays").then((r) => r.json())).essays || []; } catch { essays = []; } }

  const essayOptions = essays.map((e) => `<option value="${esc(e.id)}">${esc(e.title)}</option>`).join("");
  el.innerHTML = `<div class="discover-grid">${results.map((r, i) => `
    <div class="card discover-card" data-i="${i}">
      <div class="card-body">
        <div class="row-between" style="align-items:flex-start;">
          <div class="card-title">${esc(r.title)}</div>
          ${r.threadName ? `<span class="discover-thread-tag" style="color:${r.threadColor};background:${r.threadColor}22;">${esc(r.threadName)}</span>` : ""}
        </div>
        <a class="discover-url" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url)}</a>
        ${r.why ? `<div class="discover-why">${esc(r.why)}${typeof r.confidence === "number" ? ` <span class="discover-confidence">${r.confidence}% match</span>` : ""}</div>` : ""}
        <div class="discover-extract">${esc(r.extract)}</div>
        <div class="discover-action" data-i="${i}">
          ${pending
            ? `<button class="btn small accent discover-ground" data-i="${i}">Ground this beat →</button>`
            : essays.length
              ? `<select class="modal-input discover-add" data-i="${i}"><option value="">Add to essay…</option>${essayOptions}</select>`
              : `<div class="reel-hint">Create an essay first to add sources to it.</div>`}
        </div>
      </div>
    </div>`).join("")}</div>`;

  if (pending) {
    el.querySelectorAll(".discover-ground").forEach((btn) => {
      btn.onclick = () => groundBeatWithResult(pending, results[+btn.dataset.i], query, btn);
    });
    return;
  }

  el.querySelectorAll(".discover-add").forEach((sel) => {
    sel.onchange = async () => {
      const essayId = sel.value;
      if (!essayId) return;
      const r = results[+sel.dataset.i];
      sel.disabled = true;
      try {
        const res = await fetch("/api/discover/add-to-essay", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ essayId, query, candidate: r }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.statusText);
        const essayTitle = essays.find((e) => e.id === essayId)?.title || "essay";
        toast(`Added to "${essayTitle}"`, { type: "success" });
        const action = el.querySelector(`.discover-action[data-i="${sel.dataset.i}"]`);
        if (action) action.innerHTML = `<div class="discover-added">Added ✓ — ${esc(essayTitle)}</div>`;
        return;
      } catch (err) {
        toast(err.message || "Couldn't add to essay", { type: "error" });
      }
      sel.disabled = false; sel.value = "";
    };
  });
}
async function groundBeatWithResult(pending, candidate, query, btn) {
  btn.disabled = true; btn.textContent = "Grounding…";
  try {
    const res = await fetch(`/api/essays/${pending.essayId}/beats/${pending.beatId}/ground`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, candidate }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    toast("Beat grounded to source", { type: "success" });
    discoverPendingResearch = null;
    await openEssayAtMode(pending.essayId, "script");
  } catch (err) {
    toast(err.message || "Couldn't ground that beat", { type: "error" });
    btn.disabled = false; btn.textContent = "Ground this beat →";
  }
}

// ── Essays — the video-essay authoring surface ──────────────────────────
// A separate top-level view from Sources/Archive: an essay draws clips from
// the WHOLE archive (not one project), drafted act by act rather than
// edited as a flat timeline. See src/essays.ts for the data model.
const ACT_DEFS = [
  { act: "hook", label: "Hook" },
  { act: "setup", label: "Setup" },
  { act: "development", label: "Development" },
  { act: "turn", label: "Turn" },
  { act: "resolution", label: "Resolution" },
];
const ACT_LABEL = Object.fromEntries(ACT_DEFS.map((a) => [a.act, a.label]));
let essayState = null;

// Single source of truth for "what's the one thing blocking this essay" —
// shared verbatim by the Essays list card and the Desk's "In production"
// card, same priority order: no script → ungrounded research → unrecorded
// VO → empty timeline → ready. (Round-3's own priority chain also has a
// "generate N visuals" tier between VO and timeline — skipped here because
// this app has no beat kind yet for an AI-generated-visual beat distinct
// from clip/vo/research; noted as a known gap, not silently dropped.)
// A beat's *resolution* state (matched/needs a source or voiceover), not
// its kind — a clip beat is always "matched", but a research or vo beat can
// be resolved or still-blocking. Mirrors the prototype's BEAT_STATUS. Shared
// by the Desk's per-essay progress bar and the Essays list card.
const BEAT_STATUS_COLOR = { matched: "#8fc98f", needs_vo: "#e0c46a", search_web: "#7fb8bd", generate: "#b08cd4" };
function beatResolutionStatus(b) {
  if (b.kind === "clip") return "matched";
  if (b.kind === "vo") return b.voVideoId ? "matched" : "needs_vo";
  if (b.kind === "research") return b.discoverResultId ? "matched" : "search_web";
  return "matched";
}
function computeEssayBlocker(e) {
  const beats = e.beats || [];
  if (!beats.length) return { label: "Draft the script — act by act", color: "#8a7bd4", mode: "premise" };
  const ungroundedResearch = beats.filter((b) => b.kind === "research" && !b.discoverResultId).length;
  if (ungroundedResearch) {
    return { label: `Ground ${ungroundedResearch} research beat${ungroundedResearch > 1 ? "s" : ""} in a real source`, color: "#7fb8bd", mode: "script" };
  }
  const unrecordedVo = beats.filter((b) => b.kind === "vo" && !b.voVideoId).length;
  if (unrecordedVo) {
    return { label: `Record ${unrecordedVo} voiceover beat${unrecordedVo > 1 ? "s" : ""}`, color: "#e0c46a", mode: "script" };
  }
  if (!beats.filter(isRenderable).length) return { label: "Assemble the cut", color: "#f3ede4", mode: "assemble" };
  return { label: "Ready to review & export", color: "#8fc98f", mode: "export" };
}
// Which of the 3 Essays-list stage groups this essay belongs to, reusing
// computeEssayBlocker's own priority chain rather than re-deriving it.
function computeEssayStage(e) {
  const blocker = computeEssayBlocker(e);
  if (blocker.mode === "premise") return { key: "drafting", label: "Premise only", color: "var(--faint)" };
  if (blocker.mode === "export") return { key: "ready", label: "Ready to export", color: "#8fc98f" };
  const total = e.beats.length || 1;
  const matched = e.beats.filter((b) => beatResolutionStatus(b) === "matched").length;
  return { key: "progress", label: `${Math.round((matched / total) * 100)}% resolved`, color: "#e0c46a" };
}
async function openEssayAtMode(id, mode) {
  await openEssay(id);
  setEssayMode(mode);
}

const ESSAY_STAGE_GROUPS = [["ready", "Ready to export"], ["progress", "In progress"], ["drafting", "Drafting"]];
async function showEssaysList() {
  location.hash = "#/essays"; setActiveRail("essays");
  setCrumbs([]); setStats(""); $("#headerActions").innerHTML = ""; state.project = null;
  main.innerHTML = `<div class="loading"><span class="spinner"></span> Loading essays…</div>`;
  let essays = [];
  try { essays = (await fetch("/api/essays").then((r) => r.json())).essays || []; }
  catch { main.innerHTML = `<div class="pad"><p class="empty">Couldn't reach the server.</p></div>`; return; }
  main.innerHTML = `<section class="pad">
    <div class="row-between">
      <div><h1>Essays</h1><div class="sub">The pieces you're actually directing — each one draws from the whole archive, not one thread.</div></div>
      <button class="btn primary" id="newEssay">${ic("plus")} New essay</button>
    </div>
    <div id="essaySections"></div>
  </section>`;
  $("#newEssay").onclick = startNewEssay;
  const container = $("#essaySections");
  if (!essays.length) {
    container.innerHTML = `<div class="empty-note">No essays yet — describe an idea and the archive gets searched for what already supports it.</div>`;
    return;
  }
  const groups = ESSAY_STAGE_GROUPS.map(([key, label]) => ({ label, essays: essays.filter((e) => computeEssayStage(e).key === key) })).filter((g) => g.essays.length);
  container.innerHTML = groups.map((g) => `
    <div class="essay-stage-section">
      <div class="tools-h">${esc(g.label)}</div>
      <div class="grid">${g.essays.map(essayCardHTML).join("")}</div>
    </div>`).join("");
  wireEssayGrid(essays);
}
function essayCardHTML(e) {
  const matched = e.beats.filter((b) => b.kind === "clip").length;
  const blocker = computeEssayBlocker(e);
  const stage = computeEssayStage(e);
  const segTotal = e.beats.length || 1;
  const counts = {};
  e.beats.forEach((b) => { const st = beatResolutionStatus(b); counts[st] = (counts[st] || 0) + 1; });
  const segs = Object.entries(counts).map(([st, n]) => `<div style="width:${(n / segTotal) * 100}%;background:${BEAT_STATUS_COLOR[st] || "var(--faint)"}"></div>`).join("");
  return `<div class="card essay-card" data-id="${e.id}" style="cursor:pointer;">
    <div class="card-body">
      <div class="row-between" style="align-items:flex-start;">
        <div class="card-title">${esc(e.title)}</div>
        <span class="pill" style="color:${stage.color};background:${stage.color}22;flex:none;">${esc(stage.label)}</span>
      </div>
      <div class="card-sub" style="margin:6px 0 10px;">${esc(e.premise)}</div>
      ${e.threads.length ? `<div class="tag-rail small">${e.threads.map((t) => `<span class="tag-chip" style="border-left:2px solid ${colorForTag(t)}">${esc(t)}</span>`).join("")}</div>` : ""}
      ${e.beats.length ? `<div class="desk-essay-bar" style="margin:8px 0;">${segs}</div>` : ""}
      <div class="essay-meta">${e.beats.length} beat${e.beats.length === 1 ? "" : "s"} · ${matched} matched to clips${e.estDurationSec ? ` · est. ${fmt(e.estDurationSec)}` : ""}</div>
      <div class="essay-blocker" style="color:${blocker.color}">Next: ${esc(blocker.label)}</div>
      <div class="s-actions">
        <button class="btn small accent essay-open">Open →</button>
        <button class="btn small danger essay-delete">Delete</button>
      </div>
    </div>
  </div>`;
}
function wireEssayGrid(essays) {
  $$(".essay-card").forEach((card) => {
    const e = essays.find((x) => x.id === card.dataset.id);
    card.onclick = () => { location.hash = `#/essays/${e.id}`; };
    card.querySelector(".essay-open").onclick = (ev) => { ev.stopPropagation(); location.hash = `#/essays/${e.id}`; };
    card.querySelector(".essay-blocker").onclick = (ev) => { ev.stopPropagation(); openEssayAtMode(e.id, computeEssayBlocker(e).mode); };
    card.querySelector(".essay-delete").onclick = async (ev) => {
      ev.stopPropagation();
      if (!(await UI.confirm({ title: "Delete this essay?", message: "It moves to Trash, where you can restore it later.", confirmText: "Delete", danger: true }))) return;
      await fetch(`/api/essays/${e.id}`, { method: "DELETE" });
      toast("Moved to Trash", { type: "success" });
      showEssaysList();
    };
  });
}

// 3-step wizard (Idea -> Clarify -> Research preview), matching the
// prototype's structure -- three sequential modals rather than one flat
// form, so the wizard has real step numbering and a "what's already here"
// look before creating. Angle prefixes the premise text the way the
// prototype's does; Audience is kept alongside it (a real column this app
// already stores/surfaces in Premise mode, not in the prototype's own
// wizard, but genuinely useful and not worth deleting).
const ESSAY_ANGLE_CHOICES = ["Psychological / behavioral", "Systems / incentives", "Chronological / timeline"];
const ESSAY_AUDIENCE_CHOICES = ["General audience", "Fans of the channel", "Skeptics / critics", "Newcomers"];
const ESSAY_LENGTH_CHOICES = ["Short (3-5 min)", "Standard (8-10 min)", "Long (15+ min)"];
const ESSAY_TONE_CHOICES = ["Sardonic", "Earnest", "Analytical", "Playful"];
async function startNewEssay() {
  const existingThreads = await fetchThreads();
  const wiz = { idea: "", angle: null, audience: null, length: null, tone: null, threadIds: new Set(), custom: [] };
  let step = 1;
  while (step > 0 && step <= 3) {
    if (step === 1) step = (await essayWizardIdeaStep(wiz)) ? 2 : 0;
    else if (step === 2) step = await essayWizardClarifyStep(wiz, existingThreads);
    else step = await essayWizardResearchStep(wiz, existingThreads);
  }
  if (step !== -1) return; // 0 = cancelled anywhere along the way
  const angleLabel = wiz.angle ? ESSAY_ANGLE_CHOICES.find((a) => a === wiz.angle) : null;
  const premise = angleLabel ? `${angleLabel} on: ${wiz.idea}` : wiz.idea;
  try {
    const essay = await fetch("/api/essays", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: wiz.idea.length > 60 ? wiz.idea.slice(0, 57) + "…" : wiz.idea,
        premise, audience: wiz.audience, targetLength: wiz.length, tone: wiz.tone, threads: [...wiz.threadIds, ...wiz.custom],
      }),
    }).then((r) => r.json());
    if (essay.error) throw new Error(essay.error);
    toast("Essay created", { type: "success" });
    location.hash = `#/essays/${essay.id}`;
  } catch (err) { toast(err.message || "Couldn't create essay", { type: "error" }); }
}
async function essayWizardIdeaStep(wiz) {
  const result = await UI.modal({
    title: "New essay",
    bodyHTML: `
      <div class="essay-eyebrow">Step 1 of 3 — Idea</div>
      <label class="modal-label">What's the idea?</label>
      <textarea class="modal-input" id="__ideaText" rows="3" style="width:100%;resize:vertical;" placeholder="e.g. The psychology of Dark Syde Phil, or how tariffs actually hit consumers…">${esc(wiz.idea)}</textarea>
    `,
    dismissValue: null,
    onOpen: (card) => card.querySelector("#__ideaText").focus(),
    actions: [
      { label: "Cancel", resolve: null },
      { label: "Next →", variant: "primary", onClick: (done, card) => {
        const idea = card.querySelector("#__ideaText").value.trim();
        if (!idea) { toast("Describe the idea first."); return; }
        wiz.idea = idea; done(true);
      } },
    ],
  });
  return !!result;
}
async function essayWizardClarifyStep(wiz, existingThreads) {
  const chipsHTML = (list, key, current) => list.map((c) => `<span class="chip-pick${current === c ? " on" : ""}" data-key="${key}" data-val="${esc(c)}">${esc(c)}</span>`).join("");
  const threadChipsHTML = existingThreads
    .map((t) => `<span class="chip-pick${wiz.threadIds.has(t.id) ? " on" : ""}" data-thread="${esc(t.id)}" style="border-left:2px solid ${t.color}">${esc(t.name)}</span>`)
    .join("");
  const picked = { angle: wiz.angle, audience: wiz.audience, length: wiz.length, tone: wiz.tone };
  const pickedThreads = new Set(wiz.threadIds);
  const result = await UI.modal({
    title: "New essay",
    bodyHTML: `
      <div class="essay-eyebrow">Step 2 of 3 — Clarify</div>
      <label class="modal-label">Angle</label>
      <div class="chip-row" id="__angleRow">${chipsHTML(ESSAY_ANGLE_CHOICES, "angle", picked.angle)}</div>
      <label class="modal-label" style="margin-top:14px;">Audience</label>
      <div class="chip-row" id="__audienceRow">${chipsHTML(ESSAY_AUDIENCE_CHOICES, "audience", picked.audience)}</div>
      <label class="modal-label" style="margin-top:14px;">Target length</label>
      <div class="chip-row" id="__lengthRow">${chipsHTML(ESSAY_LENGTH_CHOICES, "length", picked.length)}</div>
      <label class="modal-label" style="margin-top:14px;">Tone</label>
      <div class="chip-row" id="__toneRow">${chipsHTML(ESSAY_TONE_CHOICES, "tone", picked.tone)}</div>
      <label class="modal-label" style="margin-top:14px;">Grounding threads (optional)</label>
      ${existingThreads.length ? `<div class="chip-row" id="__threadsRow">${threadChipsHTML}</div>` : ""}
      <input class="modal-input" id="__threadsInput" style="margin-top:8px;" placeholder="${existingThreads.length ? "Not listed above? Add one, comma-separated…" : "e.g. gaming rage, parasocial relationships"}" autocomplete="off" value="${esc(wiz.custom.join(", "))}" />
    `,
    dismissValue: null,
    onOpen: (card) => {
      card.querySelectorAll(".chip-pick[data-key]").forEach((chip) => {
        chip.onclick = () => {
          const key = chip.dataset.key;
          picked[key] = picked[key] === chip.dataset.val ? null : chip.dataset.val;
          card.querySelectorAll(`.chip-pick[data-key="${key}"]`).forEach((c) => c.classList.toggle("on", c.dataset.val === picked[key]));
        };
      });
      card.querySelectorAll(".chip-pick[data-thread]").forEach((chip) => {
        chip.onclick = () => {
          const tag = chip.dataset.thread;
          if (pickedThreads.has(tag)) pickedThreads.delete(tag); else pickedThreads.add(tag);
          chip.classList.toggle("on", pickedThreads.has(tag));
        };
      });
    },
    actions: [
      { label: "← Back", onClick: (done) => done("back") },
      { label: "Next →", variant: "primary", onClick: (done, card) => {
        wiz.angle = picked.angle; wiz.audience = picked.audience; wiz.length = picked.length; wiz.tone = picked.tone;
        wiz.threadIds = pickedThreads;
        wiz.custom = card.querySelector("#__threadsInput").value.split(",").map((s) => s.trim()).filter(Boolean);
        done("next");
      } },
    ],
  });
  if (result === "back") return 1;
  if (result === "next") return 3;
  return 0;
}
async function essayWizardResearchStep(wiz, existingThreads) {
  const pickedIds = new Set([...wiz.threadIds]);
  const picked = existingThreads.filter((t) => pickedIds.has(t.id));
  const rows = picked.length
    ? picked.map((t) => `<div class="research-preview-row"><span style="color:${t.color}">${esc(t.name)}</span><span>${t.clipCount} clip${t.clipCount === 1 ? "" : "s"} · ${t.sourceCount} source${t.sourceCount === 1 ? "" : "s"}</span></div>`).join("")
    : `<div class="empty small">No grounding threads picked — this essay will draw from the whole archive once you start drafting.</div>`;
  const result = await UI.modal({
    title: "New essay",
    bodyHTML: `
      <div class="essay-eyebrow">Step 3 of 3 — Research</div>
      <label class="modal-label">What's already here</label>
      <div class="research-preview">${rows}</div>
    `,
    dismissValue: null,
    actions: [
      { label: "← Back", onClick: (done) => done("back") },
      { label: "Create essay →", variant: "primary", onClick: (done) => done("create") },
    ],
  });
  if (result === "back") return 2;
  if (result === "create") return -1;
  return 0;
}

async function openEssay(id) {
  location.hash = `#/essays/${id}`; setActiveRail("essays");
  main.innerHTML = `<div class="loading"><span class="spinner"></span> Loading essay…</div>`;
  let essay;
  try {
    essay = await fetch(`/api/essays/${id}`).then((r) => r.json());
    if (essay.error) throw new Error(essay.error);
  } catch (err) {
    main.innerHTML = `<div class="pad"><p class="empty">${esc(err.message || "Essay not found")}</p></div>`;
    return;
  }
  const validModes = ["premise", "script", "assemble", "export"];
  essayState = {
    essay, mode: validModes.includes(essay.builder_mode) ? essay.builder_mode : "premise",
    drafting: false, draftAct: null, draftLoading: false, draftCandidate: null,
    showCoherence: false, finderQuery: "", finderClips: [], voVideoInfo: {},
  };
  setCrumbs([{ label: "Essays", go: showEssaysList }, { label: essay.title }]);
  setStats(""); $("#headerActions").innerHTML = ""; state.project = null;
  await loadVoVideoInfo();
  renderEssayShell();
  loadFinderClips();
}
async function reloadEssay() {
  essayState.essay = await fetch(`/api/essays/${essayState.essay.id}`).then((r) => r.json());
  await loadVoVideoInfo();
}
// Beats only store a voVideoId — duration/r2_key (for the "take saved ·
// 0:NN" chip and its ▸ Play button) live on the video row itself. Fetched
// once per essay load/reload, cached by id so re-renders don't re-fetch.
async function loadVoVideoInfo() {
  const ids = [...new Set(essayState.essay.beats.filter((b) => b.kind === "vo" && b.voVideoId).map((b) => b.voVideoId))];
  const missing = ids.filter((id) => !essayState.voVideoInfo[id]);
  if (!missing.length) return;
  const results = await Promise.all(missing.map((id) => fetch(`/api/videos/${id}`).then((r) => r.json()).catch(() => null)));
  results.forEach((v, i) => { if (v && !v.error) essayState.voVideoInfo[missing[i]] = v; });
}
function setEssayMode(mode) {
  essayState.mode = mode; essayState.showCoherence = false;
  fetch(`/api/essays/${essayState.essay.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ builderMode: mode }) }).catch(() => {});
  renderEssayShell();
}

function renderEssayShell() {
  const e = essayState.essay;
  const modes = [["premise", "1. Premise"], ["script", "2. Script"], ["assemble", "3. Assemble"], ["export", "4. Export"]];
  const matched = e.beats.filter((b) => b.kind === "clip").length;
  main.innerHTML = `<div class="essay-shell">
    <div class="essay-finder">
      <div class="side-h" style="margin-top:0;">Find clips</div>
      <div class="empty small">Search the whole archive, then add a clip to whichever act you're building.</div>
      <input id="finderQuery" class="import-input" style="width:100%;margin:10px 0 8px;" placeholder="Search quotes, episodes…" autocomplete="off" />
      <select id="finderActPick" class="modal-input" style="width:100%;margin-bottom:10px;">
        ${ACT_DEFS.map((a) => `<option value="${a.act}">Add to: ${a.label}</option>`).join("")}
      </select>
      <div id="finderList" class="essay-finder-list"></div>
    </div>
    <div class="essay-main">
      <div class="essay-main-head">
        <div class="doc-title" style="margin:0 0 2px;">${esc(e.title)}</div>
        <div class="empty small">${e.beats.length} beat${e.beats.length === 1 ? "" : "s"} · ${matched} matched to clips${e.estDurationSec ? ` · est. ${fmt(e.estDurationSec)}` : ""}</div>
        <div class="essay-tabs">${modes.map(([m, l]) => `<div class="essay-tab${essayState.mode === m ? " on" : ""}" data-mode="${m}">${l}</div>`).join("")}</div>
      </div>
      <div class="essay-body" id="essayBody"></div>
    </div>
  </div>`;
  $$(".essay-tab").forEach((t) => { t.onclick = () => setEssayMode(t.dataset.mode); });
  const q = $("#finderQuery");
  q.value = essayState.finderQuery;
  let deb = null;
  q.addEventListener("input", () => { essayState.finderQuery = q.value; clearTimeout(deb); deb = setTimeout(loadFinderClips, 300); });
  renderFinderList();
  renderEssayBody();
}
function renderEssayBody() {
  const body = $("#essayBody"); if (!body) return;
  if (essayState.mode === "premise") return renderPremiseMode(body);
  if (essayState.mode === "script") return renderScriptMode(body);
  if (essayState.mode === "assemble") return renderAssembleMode(body);
  if (essayState.mode === "export") return renderExportMode(body);
}

// ── Find-clips sidebar — reuses GET /api/clips's existing q filter ──────
async function loadFinderClips() {
  const list = $("#finderList"); if (!list) return;
  list.innerHTML = `<div class="empty small">Searching…</div>`;
  try {
    const params = new URLSearchParams({ limit: "40" });
    if (essayState.finderQuery.trim()) params.set("q", essayState.finderQuery.trim());
    essayState.finderClips = (await fetch(`/api/clips?${params}`).then((r) => r.json())).clips || [];
  } catch { essayState.finderClips = null; }
  renderFinderList();
}
function renderFinderList() {
  const list = $("#finderList"); if (!list) return;
  const clips = essayState.finderClips;
  if (clips === null) { list.innerHTML = `<div class="empty small">Couldn't load clips.</div>`; return; }
  if (!clips.length) { list.innerHTML = `<div class="empty small">No clips match yet.</div>`; return; }
  list.innerHTML = clips.map((c, i) => {
    const dur = c.segments.reduce((s, x) => s + (x.end - x.start), 0);
    return `<div class="finder-item" data-i="${i}">
      <div class="finder-item-main">
        <div class="finder-quote">"${esc(c.title)}"</div>
        <div class="finder-meta">${c.segments.length} seg · ${fmt(dur)}</div>
      </div>
      <button class="finder-add" title="Add to the selected act">+</button>
    </div>`;
  }).join("");
  $$(".finder-item", list).forEach((row) => {
    const clip = clips[+row.dataset.i];
    row.querySelector(".finder-item-main").onclick = () => previewClipSegments(clip.segments);
    row.querySelector(".finder-add").onclick = () => addClipBeat(clip);
  });
}
async function addClipBeat(clip) {
  const act = $("#finderActPick")?.value || "development";
  try {
    const res = await fetch(`/api/essays/${essayState.essay.id}/beats`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ act, kind: "clip", clipId: clip.id, text: clip.title }),
    }).then((r) => r.json());
    if (res.error) throw new Error(res.error);
    await reloadEssay();
    renderEssayShell();
    toast(`Added to ${ACT_LABEL[act]}`, { type: "success" });
  } catch (err) { toast(err.message || "Couldn't add that clip", { type: "error" }); }
}

// ── Coherence check — rule-based, instant, no AI call needed. Advisory
// only — nothing here blocks drafting, importing, or exporting. `kind:
// "empty"` issues are skipped when surfaced inline in Script mode's act
// sections (renderActSection already shows an empty act plainly via its
// own "No beats yet" hint; repeating it as a warning would be redundant),
// but still show up in Premise mode's aggregate check, which has no such
// per-act empty state of its own.
function checkEssayCoherence(e) {
  const issues = [];
  const byAct = Object.fromEntries(ACT_DEFS.map((a) => [a.act, e.beats.filter((b) => b.act === a.act)]));
  for (const { act, label } of ACT_DEFS) {
    if (!byAct[act].length) issues.push({ act, kind: "empty", color: "var(--warn)", text: `${label} has no beats yet.` });
  }
  if (byAct.turn.length && !byAct.turn.some((b) => b.kind === "clip" || (b.kind === "research" && b.discoverResultId))) {
    issues.push({ act: "turn", kind: "turn-grounding", color: "var(--warn)", text: "Turn has no grounding clip or source for its complication — it's narration only so far." });
  }
  return issues;
}

// ── Premise mode + act-by-act drafting ───────────────────────────────────
function renderPremiseMode(body) {
  const e = essayState.essay, s = essayState;
  if (s.drafting) {
    const idx = ACT_DEFS.findIndex((a) => a.act === s.draftAct) + 1;
    const c = s.draftCandidate;
    body.innerHTML = `<div class="pad" style="max-width:640px;">
      <div class="draft-candidate">
        <div class="row-between" style="margin-bottom:8px;">
          <span class="essay-eyebrow">Act ${idx} of ${ACT_DEFS.length} · ${esc(ACT_LABEL[s.draftAct])}</span>
          <span class="essay-link" id="stopDraft">Stop here</span>
        </div>
        ${s.draftLoading
          ? `<div class="empty small">Thinking…</div>`
          : c
            ? `<span class="pill ${c.kind === "clip" ? "matched" : c.kind === "research" ? "info" : "vo"}">${c.kind === "clip" ? "Matched clip" : c.kind === "research" ? "Needs a source" : "Needs voiceover"}</span>
               <div class="draft-text">${esc(c.text)}</div>
               ${c.reason ? `<div class="empty small" style="margin-top:6px;">${esc(c.reason)}</div>` : ""}
               <div class="s-actions" style="margin-top:12px;">
                 <button class="btn primary small" id="acceptDraft">Accept, next act →</button>
                 <button class="btn ghost small" id="regenDraft">Try another</button>
                 <button class="btn ghost small" id="skipDraft">Skip act</button>
               </div>`
            : `<div class="empty small">Couldn't draft anything for this act.</div>
               <div class="s-actions" style="margin-top:12px;"><button class="btn ghost small" id="skipDraft">Skip act</button></div>`}
      </div>
    </div>`;
    $("#stopDraft").onclick = () => { s.drafting = false; renderEssayBody(); };
    if (!s.draftLoading) {
      $("#acceptDraft")?.addEventListener("click", acceptDraft);
      $("#regenDraft")?.addEventListener("click", () => runActDraft(s.draftAct));
      $("#skipDraft")?.addEventListener("click", advanceDraft);
    }
    return;
  }
  const issues = s.showCoherence ? checkEssayCoherence(e) : null;
  body.innerHTML = `<div class="pad" style="max-width:640px;">
    <div class="essay-eyebrow">Premise</div>
    <div class="essay-premise-text">${esc(e.premise)}</div>
    <div class="essay-meta-row">
      <div><div class="essay-meta-label">Audience</div><div>${esc(e.audience || "—")}</div></div>
      <div><div class="essay-meta-label">Target length</div><div>${esc(e.target_length || "—")}</div></div>
      <div><div class="essay-meta-label">Tone</div><div>${esc(e.tone || "—")}</div></div>
    </div>
    ${e.threads.length ? `<div class="tag-rail">${e.threads.map((t) => `<span class="tag-chip" style="border-left:2px solid ${colorForTag(t)}">${esc(t)}</span>`).join("")}</div>` : ""}
    <div class="s-actions" style="margin-top:22px;">
      <button class="btn primary" id="startActDraft">Build it act by act →</button>
      <button class="btn ghost" id="runCoherence">Run coherence check</button>
    </div>
    ${issues ? (issues.length
      ? `<div class="coherence-issues">${issues.map((i) => `<div class="coherence-issue" style="border-left-color:${i.color}">${esc(i.text)}</div>`).join("")}</div>`
      : `<div class="empty small" style="margin-top:10px;">No issues found — looking solid.</div>`) : ""}
    <div class="empty small" style="margin-top:14px;max-width:520px;">No script needed to start — you'll go act by act, reacting to one suggestion at a time. Already have a script written? Use Import script in Script mode instead.</div>
  </div>`;
  $("#startActDraft").onclick = () => {
    // Resume where the user left off — restarting at "hook" unconditionally
    // used to re-walk acts that already had accepted (and persisted) beats,
    // producing real duplicate beats on every re-entry.
    const nextAct = ACT_DEFS.find((a) => !e.beats.some((b) => b.act === a.act));
    if (!nextAct) { toast("Every act already has beats — see them in Script mode.", { type: "info" }); setEssayMode("script"); return; }
    s.drafting = true; s.draftAct = nextAct.act; renderEssayBody(); runActDraft(nextAct.act);
  };
  $("#runCoherence").onclick = () => { s.showCoherence = true; renderEssayBody(); };
}
async function runActDraft(act) {
  const s = essayState;
  s.draftAct = act; s.draftLoading = true; s.draftCandidate = null;
  renderEssayBody();
  try {
    const res = await fetch(`/api/essays/${s.essay.id}/draft-act`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ act }),
    }).then((r) => r.json());
    if (res.error) throw new Error(res.error);
    s.draftCandidate = res.candidate;
  } catch (err) {
    toast(err.message || "Couldn't draft that act", { type: "error" });
    s.draftCandidate = null;
  }
  s.draftLoading = false;
  renderEssayBody();
}
async function acceptDraft() {
  const s = essayState, c = s.draftCandidate;
  if (!c) return advanceDraft();
  try {
    const res = await fetch(`/api/essays/${s.essay.id}/beats`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ act: s.draftAct, kind: c.kind, clipId: c.clipId, text: c.text }),
    }).then((r) => r.json());
    if (res.error) throw new Error(res.error);
    await reloadEssay();
  } catch (err) { toast(err.message || "Couldn't save that beat", { type: "error" }); return; }
  advanceDraft();
}
function advanceDraft() {
  const s = essayState, e = s.essay;
  let idx = ACT_DEFS.findIndex((a) => a.act === s.draftAct) + 1;
  // Skip any act that already has beats (e.g. accepted earlier, or added via
  // Import script while paused) so resuming a stopped draft never re-proposes
  // a duplicate for an act that's already covered.
  while (idx < ACT_DEFS.length && e.beats.some((b) => b.act === ACT_DEFS[idx].act)) idx++;
  if (idx >= ACT_DEFS.length) {
    s.drafting = false;
    setEssayMode("script");
    toast("Draft complete — review it in Script mode", { type: "success" });
    return;
  }
  runActDraft(ACT_DEFS[idx].act);
}

// ── Script mode ──────────────────────────────────────────────────────────
function renderScriptMode(body) {
  const e = essayState.essay;
  // Advisory, always-on — cheap and rule-based (see checkEssayCoherence), so
  // there's no need to gate it behind a button the way Premise mode does.
  const issuesByAct = {};
  checkEssayCoherence(e).forEach((i) => { (issuesByAct[i.act] ||= []).push(i); });
  body.innerHTML = `<div class="pad" style="max-width:760px;">
    <div class="row-between">
      <div class="empty small" style="max-width:460px;">Structured as five acts — import a script, or add clips/voiceover from the sidebar.</div>
      <button class="btn ghost small" id="toggleImport">Import script</button>
    </div>
    <div id="importBox" style="display:none;margin:14px 0;">
      <textarea class="modal-input" id="importText" rows="6" style="width:100%;resize:vertical;" placeholder="Paste your script, one beat per line…"></textarea>
      <div class="s-actions" style="margin-top:8px;"><button class="btn primary small" id="matchScript">Match to archive</button></div>
    </div>
    ${ACT_DEFS.map((a) => renderActSection(a, e.beats.filter((b) => b.act === a.act), issuesByAct[a.act])).join("")}
  </div>`;
  $("#toggleImport").onclick = () => { const box = $("#importBox"); box.style.display = box.style.display === "none" ? "block" : "none"; };
  $("#matchScript").onclick = () => importScript($("#importText").value);
  wireActSections();
}
function renderActSection(a, beats, issues) {
  // "empty" issues are redundant here — an empty act already says so via
  // its own hint below — so only the more specific ones (e.g. Turn missing
  // its grounding clip) surface inline. Advisory only, never a gate.
  const inline = (issues || []).filter((i) => i.kind !== "empty");
  return `<div class="act-section">
    <div class="act-head"><span class="essay-eyebrow">${a.label}</span><span class="empty small">${beats.length} beat${beats.length === 1 ? "" : "s"}</span></div>
    ${inline.length ? `<div class="coherence-issues" style="margin:0 0 10px;">${inline.map((i) => `<div class="coherence-issue" style="border-left-color:${i.color}">${esc(i.text)}</div>`).join("")}</div>` : ""}
    ${beats.length ? beats.map(renderBeatRow).join("") : `<div class="empty small" style="padding:10px 0;">No beats yet — pick "${a.label}" in the sidebar and add a clip, or paste a script above.</div>`}
  </div>`;
}
function renderBeatRow(b) {
  const recorded = b.kind === "vo" && b.voVideoId;
  const grounded = b.kind === "research" && b.discoverResultId;
  const borderColor = b.kind === "clip" ? "var(--good)"
    : b.kind === "research" ? (grounded ? "var(--good)" : "var(--info-teal)")
    : recorded ? "var(--good)" : "var(--warn)";
  const pill = b.kind === "clip" ? `<span class="pill matched">Matched</span>`
    : b.kind === "research" ? (grounded ? `<span class="pill matched">Grounded to source</span>` : `<span class="pill info">Search web</span>`)
    : recorded ? "" // the recorded chip below replaces the bare pill entirely
    : `<span class="pill vo">Needs voiceover</span>`;
  const voInfo = recorded ? essayState?.voVideoInfo?.[b.voVideoId] : null;
  const extra = b.kind === "vo"
    ? (recorded
        ? `<div class="vo-recorded-chip">
             ${ic("mic")}
             <span>Voiceover take saved${voInfo?.duration ? ` · ${fmt(voInfo.duration)}` : ""}</span>
             <button class="btn small ghost vo-play" data-video-id="${esc(b.voVideoId)}" ${voInfo?.r2_key ? "" : "disabled"}>▸ Play</button>
             <button class="btn small ghost beat-record" data-id="${b.id}">Re-record</button>
           </div>`
        : `<div class="s-actions" style="margin-top:8px;"><button class="btn small ghost beat-record" data-id="${b.id}">${ic("video")} Record</button></div>`)
    : b.kind === "research"
      ? `${grounded ? `<a class="discover-url" href="${esc(b.citations?.[0] || "")}" target="_blank" rel="noopener" style="display:block;margin-top:6px;">${esc(b.citations?.[0] || "")}</a>` : ""}
         <div class="s-actions" style="margin-top:8px;"><button class="btn small ghost beat-ground" data-id="${b.id}">${ic("globe")} ${grounded ? "Change source" : "Find a source in Discover"}</button></div>`
      : "";
  return `<div class="beat" data-id="${b.id}" style="border-left-color:${borderColor}">
    <div class="beat-top">
      ${pill}
      <button class="beat-remove" title="Remove">✕</button>
    </div>
    <div class="beat-text">${esc(b.text)}</div>
    ${extra}
  </div>`;
}
function wireActSections() {
  $$(".beat").forEach((row) => {
    row.querySelector(".beat-remove").onclick = async () => {
      await fetch(`/api/essays/${essayState.essay.id}/beats/${row.dataset.id}`, { method: "DELETE" });
      await reloadEssay(); renderEssayShell();
    };
    row.querySelector(".beat-record")?.addEventListener("click", (e) => {
      const beat = essayState.essay.beats.find((b) => b.id === row.dataset.id);
      if (beat) recordAndAttachVoiceover(beat, e.currentTarget);
    });
    row.querySelector(".beat-ground")?.addEventListener("click", () => {
      const beat = essayState.essay.beats.find((b) => b.id === row.dataset.id);
      if (beat) findSourceForBeat(beat);
    });
    row.querySelector(".vo-play")?.addEventListener("click", (e) => playVoTake(e.currentTarget));
  });
}
// One shared <audio> element, toggled per click — playing a different take
// while one's already going just switches to it, same as any single-player
// UI. Button label flips ▸ Play / ⏸ Pause to reflect state.
let voPlayer = null, voPlayerBtn = null;
function playVoTake(btn) {
  const info = essayState.voVideoInfo[btn.dataset.videoId];
  if (!info?.r2_key) return;
  if (voPlayer && voPlayerBtn === btn && !voPlayer.paused) { voPlayer.pause(); return; }
  if (!voPlayer) {
    voPlayer = new Audio();
    voPlayer.addEventListener("ended", () => { if (voPlayerBtn) voPlayerBtn.textContent = "▸ Play"; });
    voPlayer.addEventListener("pause", () => { if (voPlayerBtn) voPlayerBtn.textContent = "▸ Play"; });
  }
  if (voPlayerBtn && voPlayerBtn !== btn) voPlayerBtn.textContent = "▸ Play";
  voPlayer.src = mediaUrl(info.r2_key);
  voPlayer.play();
  voPlayerBtn = btn;
  btn.textContent = "⏸ Pause";
}
const IMPORT_STOPWORDS = new Set(["the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "is", "it", "that", "this", "with", "as", "at", "by", "be", "was", "were", "are", "so", "not", "you", "your", "i", "we", "he", "she", "they"]);
function significantWords(s) {
  return (String(s || "").toLowerCase().match(/[a-z0-9']+/g) || []).filter((w) => w.length > 2 && !IMPORT_STOPWORDS.has(w));
}
/** Bag-of-words match against the archive, mirroring the prototype's
 * matchScript(): lines that share ≥2 significant words with a clip's
 * title/description/tags become "matched" (kind:"clip"); everything else
 * becomes a needs_vo beat. Acts are still auto-bucketed by line position. */
function bestClipMatch(line, clips) {
  const lineWords = significantWords(line);
  if (!lineWords.length) return null;
  let best = null, bestScore = 0;
  for (const c of clips) {
    const clipWords = new Set(significantWords(`${c.title} ${c.description || ""} ${(c.tags || []).join(" ")}`));
    let score = 0;
    for (const w of lineWords) if (clipWords.has(w)) score++;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return bestScore >= 2 ? best : null;
}
async function importScript(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) { toast("Paste some script text first."); return; }
  const perAct = Math.ceil(lines.length / ACT_DEFS.length);
  let clips = [];
  try { clips = (await fetch("/api/clips?limit=500").then((r) => r.json())).clips || []; } catch { /* fall back to all-vo */ }
  let matched = 0;
  try {
    for (let i = 0; i < lines.length; i++) {
      const act = ACT_DEFS[Math.min(ACT_DEFS.length - 1, Math.floor(i / perAct))].act;
      const clip = bestClipMatch(lines[i], clips);
      const body = clip
        ? { act, kind: "clip", clipId: clip.id, text: lines[i] }
        : { act, kind: "vo", text: lines[i] };
      if (clip) matched++;
      await fetch(`/api/essays/${essayState.essay.id}/beats`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    }
    await reloadEssay();
    toast(`Imported ${lines.length} line(s) — ${matched} matched to archive, ${lines.length - matched} need voiceover`, { type: "success" });
    renderEssayShell();
  } catch { toast("Import failed partway through", { type: "error" }); }
}

// ── Assemble mode — flat drag-reorder of every beat with real media: clip
// beats (always) and vo beats once recorded (see recordAndAttachVoiceover).
// research beats ground a claim in the script, not a moment in the cut, so
// they never join the render timeline. ─────────────────────────────────
const isRenderable = (b) => b.kind === "clip" || (b.kind === "vo" && b.voVideoId);
function renderAssembleMode(body) {
  const e = essayState.essay;
  const renderable = e.beats.filter(isRenderable);
  const unrecordedVo = e.beats.filter((b) => b.kind === "vo" && !b.voVideoId).length;
  body.innerHTML = `<div class="pad" style="max-width:760px;">
    <div class="row-between">
      <div class="empty small" style="max-width:480px;">Drag ⠿ to reorder — preview and export follow this order.${unrecordedVo ? ` ${unrecordedVo} voiceover beat(s) still need recording — record them in Script first.` : ""}</div>
      <button class="btn ghost small" id="assemblePreview" ${renderable.length ? "" : "disabled"}>${ic("play")} Preview</button>
    </div>
    <video id="libPreviewPlayer" playsinline style="width:100%;max-height:32vh;background:#000;border-radius:9px;margin:14px 0;display:none;"></video>
    ${renderable.length ? `<div class="assemble-legend">
      <span><span class="assemble-swatch" style="background:var(--good)"></span>A-roll (matched clips)</span>
      <span><span class="assemble-swatch" style="background:var(--warn)"></span>Voiceover (recorded takes)</span>
    </div>` : ""}
    <div class="tl" id="assembleList">
      ${renderable.length
        ? renderable.map((b, i) => `<div class="seg" draggable="true" data-i="${i}" data-id="${b.id}" style="border-left:3px solid ${b.kind === "vo" ? "var(--warn)" : "var(--good)"}">
            <span class="seg-drag" title="Drag to reorder">⠿</span>
            <span class="seg-time">${ACT_LABEL[b.act]}${b.kind === "vo" ? " · VO" : ""}</span>
            <span class="seg-reason">${esc(b.text)}</span>
            <button class="seg-x" title="Remove">✕</button>
          </div>`).join("")
        : `<p class="empty small">Add clips from the sidebar, or record a voiceover in Script, first.</p>`}
    </div>
  </div>`;
  $("#libPreviewPlayer").addEventListener("play", function onPlay() { this.style.display = "block"; });
  $("#assemblePreview")?.addEventListener("click", async () => {
    const segs = await resolveBeatsToSegments(renderable);
    if (!segs.length) { toast("Nothing to preview yet."); return; }
    previewClipSegments(segs);
  });
  wireAssembleDrag(renderable);
}
async function resolveBeatsToSegments(beats) {
  const lists = await Promise.all(beats.map(async (b) => {
    if (b.kind === "clip") {
      const c = await fetch(`/api/clips/${b.clipId}`).then((r) => r.json());
      return (c.segments || []).map((s) => ({ videoId: s.videoId, start: s.start, end: s.end }));
    }
    if (b.kind === "vo" && b.voVideoId) {
      const v = await resolveVideo(b.voVideoId);
      // Kept range only (first-to-last word), same convention as a recorded
      // bridge — trims whatever silence Whisper didn't hear as speech off
      // either end, rather than the whole raw take.
      if (v?.words?.length) return [{ videoId: b.voVideoId, start: v.words[0].start, end: v.words[v.words.length - 1].end }];
    }
    return [];
  }));
  return lists.flat();
}
function wireAssembleDrag(renderable) {
  let dragI = null;
  const list = $("#assembleList");
  list.querySelectorAll(".seg").forEach((row) => {
    row.querySelector(".seg-x").onclick = async () => {
      await fetch(`/api/essays/${essayState.essay.id}/beats/${row.dataset.id}`, { method: "DELETE" });
      await reloadEssay(); renderEssayShell();
    };
    row.addEventListener("dragstart", (e) => { dragI = +row.dataset.i; row.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; });
    row.addEventListener("dragend", () => row.classList.remove("dragging"));
    row.addEventListener("dragover", (e) => { e.preventDefault(); row.classList.add("drag-over"); });
    row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
    row.addEventListener("drop", async (e) => {
      e.preventDefault(); row.classList.remove("drag-over");
      const to = +row.dataset.i;
      if (dragI === null || to === dragI) return;
      // Include every beat (not just renderable ones) so ord stays one
      // consistent sequence — reorderBeats only touches ids present in
      // `order`, and leaving other beats out would strand them with stale
      // ord values.
      const ids = renderable.map((b) => b.id);
      const [moved] = ids.splice(dragI, 1);
      ids.splice(to, 0, moved);
      const rest = essayState.essay.beats.filter((b) => !isRenderable(b)).map((b) => b.id);
      await fetch(`/api/essays/${essayState.essay.id}/beats/reorder`, {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ order: [...ids, ...rest] }),
      });
      await reloadEssay(); renderEssayShell();
    });
  });
}

// ── Export mode ──────────────────────────────────────────────────────────
// Preflight is advisory only — every line below can read "!" and the
// Render/Export buttons stay fully enabled regardless. It exists to tell
// you what's still rough, not to gate you from shipping anyway.
function renderExportPreflight(e) {
  const groundedResearch = e.beats.filter((b) => b.kind === "research" && b.discoverResultId);
  const ungroundedResearch = e.beats.filter((b) => b.kind === "research" && !b.discoverResultId).length;
  const unrecordedVo = e.beats.filter((b) => b.kind === "vo" && !b.voVideoId).length;
  const lines = [
    { ok: ungroundedResearch === 0, label: ungroundedResearch === 0 ? "Research beats grounded" : `${ungroundedResearch} research beat${ungroundedResearch > 1 ? "s" : ""} still need${ungroundedResearch === 1 ? "s" : ""} a source` },
    { ok: unrecordedVo === 0, label: unrecordedVo === 0 ? "Voiceover recorded for every narration beat" : `${unrecordedVo} voiceover beat${unrecordedVo > 1 ? "s" : ""} still need${unrecordedVo === 1 ? "s" : ""} recording` },
  ];
  return `<div class="export-preflight">
    <div class="export-preflight-h">Preflight — advisory, never a gate</div>
    ${lines.map((l) => `<div class="export-preflight-line ${l.ok ? "ok" : "warn"}">${l.ok ? "✓" : "!"} ${esc(l.label)}</div>`).join("")}
    ${groundedResearch.length ? `<div class="export-attribution">
      <div class="export-attribution-h">Attribution required — add these to the description:</div>
      ${groundedResearch.map((b) => `<div class="export-attribution-line">${esc(b.text)} — <a href="${esc(b.citations?.[0] || "")}" target="_blank" rel="noopener">${esc(b.citations?.[0] || "")}</a></div>`).join("")}
    </div>` : ""}
  </div>`;
}
function renderExportMode(body) {
  const e = essayState.essay;
  const renderable = e.beats.filter(isRenderable);
  const unrecordedVo = e.beats.filter((b) => b.kind === "vo" && !b.voVideoId).length;
  body.innerHTML = `<div class="pad" style="max-width:640px;">
    <div class="empty small">${renderable.length} beat(s) assembled${unrecordedVo ? ` · ${unrecordedVo} voiceover beat(s) still need recording` : ""}.</div>
    ${renderExportPreflight(e)}
    <div class="s-actions" style="margin-top:14px;">
      <button class="btn primary" id="renderExport" ${renderable.length ? "" : "disabled"}>${ic("download")} Render 1080p MP4</button>
      <button class="btn ghost" id="exportScript">Export script (.txt)</button>
    </div>
  </div>`;
  $("#renderExport").onclick = (ev) => exportEssayCut(renderable, ev.currentTarget);
  $("#exportScript").onclick = () => exportEssayScript(e);
}
async function exportEssayCut(renderable, btn) {
  const prev = btn.innerHTML; btn.disabled = true;
  try {
    const segs = await resolveBeatsToSegments(renderable);
    const resolved = await Promise.all(segs.map(async (s) => {
      const v = await resolveVideo(s.videoId);
      return v && v.r2_key ? { videoId: s.videoId, r2_key: v.r2_key, start: s.start, end: s.end } : null;
    }));
    const clips = resolved.filter(Boolean);
    if (!clips.length) throw new Error("Nothing renderable yet.");
    const blob = await Renderer.renderLongform(clips, (msg) => { btn.textContent = msg; });
    downloadBlob(blob, safeName(essayState.essay.title) + ".mp4");
    toast("Essay exported — downloading", { type: "success" });
  } catch (err) { toast(err.message || "Export failed", { type: "error" }); }
  btn.disabled = false; btn.innerHTML = prev;
}
function exportEssayScript(e) {
  const lines = ACT_DEFS.flatMap((a) => {
    const beats = e.beats.filter((b) => b.act === a.act);
    return beats.length ? [a.label.toUpperCase(), ...beats.map((b) => `  ${b.text}`), ""] : [];
  });
  downloadBlob(new Blob([lines.join("\n")], { type: "text/plain" }), safeName(e.title) + "-script.txt");
}

// ── Generative — script line -> one consistent scene -> b-roll ─────────
// "Context first, then image, then video" per the design brief — the model
// derives whatever emotional/thematic register a line needs internally;
// none of that shows up as a labeled field here, only in the prose it
// writes (see reason.ts's draftSceneShots). A saved cut becomes a real
// Archive clip via the scratch "Generative" project (src/db.ts).
let genState = null;
let genProjectId = null;

async function showGenerativeView() {
  location.hash = "#/generative"; setActiveRail("generative");
  setCrumbs([]); setStats(""); $("#headerActions").innerHTML = ""; state.project = null;
  genState = { scene: null, cutCount: 2, aspect: "16:9", duration: 5, line: "", building: false, beatChips: [] };
  main.innerHTML = `<div class="gen-shell">
    <div class="gen-main" id="genMain"></div>
    <div class="gen-sidebar" id="genSidebar"></div>
  </div>`;
  renderGenerativeMain();
  renderGenerativeSidebar();
  loadEssayBeatChips();
  loadGenerativeRecent();
}

async function loadEssayBeatChips() {
  try {
    const essays = (await fetch("/api/essays").then((r) => r.json())).essays || [];
    genState.beatChips = essays.flatMap((e) => e.beats.filter((b) => b.kind === "vo").map((b) => ({ text: b.text, essay: e.title })));
  } catch { genState.beatChips = []; }
  renderGenerativeMain();
}

function renderGenerativeMain() {
  const el = $("#genMain"); if (!el) return;
  const s = genState;
  el.innerHTML = `<div class="pad" style="max-width:760px;">
    <h1>Generative</h1>
    <div class="sub">Turns a script line into cinema, not stock footage. Context comes first, then image, then video — each cut saved back into the Archive as a real, thread-matched clip.</div>
    <div class="gen-linebox">
      <div class="essay-eyebrow" style="margin-bottom:8px;">Script line</div>
      <textarea class="modal-input" id="genLine" rows="3" style="width:100%;font-family:var(--font-serif);font-style:italic;resize:vertical;" ${s.scene ? "disabled" : ""} placeholder="Paste a line from an essay's script, or write one — e.g. &quot;He drove home from the factory in the dark.&quot;">${esc(s.line)}</textarea>
      ${s.beatChips.length && !s.scene ? `<div class="chip-row" style="margin-top:10px;">${s.beatChips.slice(0, 6).map((b, i) => `<span class="chip-pick" data-beat="${i}" title="${esc(b.essay)}">${esc(b.text.length > 44 ? b.text.slice(0, 41) + "…" : b.text)}</span>`).join("")}</div>` : ""}
      <div style="margin-top:14px;">
        ${s.scene
          ? `<button class="btn ghost small" id="newScene">← Start a new scene</button>`
          : `<button class="btn primary" id="buildScene" ${s.building ? "disabled" : ""}>${s.building ? "Building…" : "Build the scene →"}</button>`}
      </div>
    </div>
    <div id="genSceneArea"></div>
  </div>`;
  if (!s.scene) {
    $("#genLine").addEventListener("input", (e) => { s.line = e.target.value; });
    $$(".chip-pick[data-beat]", el).forEach((chip) => {
      chip.onclick = () => { s.line = s.beatChips[+chip.dataset.beat].text; renderGenerativeMain(); };
    });
    $("#buildScene").onclick = buildScene;
  } else {
    $("#newScene").onclick = () => { genState.scene = null; genState.line = ""; renderGenerativeMain(); renderGenerativeSidebar(); };
  }
  renderSceneArea();
}

async function buildScene() {
  const s = genState;
  if (!s.line.trim()) { toast("Paste or write a script line first."); return; }
  s.building = true; renderGenerativeMain();
  try {
    const scene = await fetch("/api/generative/scenes", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ line: s.line, cutCount: s.cutCount, aspect: s.aspect, durationSeconds: s.duration }),
    }).then((r) => r.json());
    if (scene.error) throw new Error(scene.error);
    s.scene = scene;
    toast(`Scene built — ${scene.shots.length} cut(s)`, { type: "success" });
  } catch (err) { toast(err.message || "Couldn't build the scene", { type: "error" }); }
  s.building = false;
  renderGenerativeMain();
  renderGenerativeSidebar();
}

function renderSceneArea() {
  const el = $("#genSceneArea"); if (!el) return;
  const scene = genState.scene;
  if (!scene) { el.innerHTML = ""; return; }
  const refLocked = scene.shots.some((s) => s.imageR2Key);
  el.innerHTML = `<div style="margin-top:24px;">
    <div class="essay-eyebrow" style="color:var(--accent);">One scene, ${scene.shots.length} cut(s) — nothing below is generated yet</div>
    <div class="gen-world">
      <span><span class="gen-world-label">Where:</span> ${esc(scene.location)}</span>
      <span><span class="gen-world-label">Light:</span> ${esc(scene.light)}</span>
      <span><span class="gen-world-label">Palette:</span> ${esc(scene.palette)}</span>
    </div>
    ${refLocked ? `<div class="gen-ref-locked">${ic("lock")} Reference still locked — every later cut reuses this look, so the scene holds together.</div>` : ""}
    <div class="gen-shots" id="genShots">${scene.shots.map(shotRowHTML).join("")}</div>
  </div>`;
  wireShotRows();
}
function shotStatusIcon(shot) {
  if (shot.status === "saved") return `<span style="color:var(--good);font-size:9px;">saved ✓</span>`;
  if (shot.status === "image_generating") return `<span class="empty small">image…</span>`;
  if (shot.status === "video_generating") return `<span class="empty small">video…</span>`;
  if (shot.status === "failed") return `<span style="color:var(--bad);font-size:9px;">failed</span>`;
  if (shot.videoR2Key) return ic("play");
  return ic("video");
}
function shotRowHTML(shot) {
  let action = "";
  if (shot.status === "idle" || (shot.status === "failed" && !shot.imageR2Key)) {
    action = `<button class="btn small ghost shot-action" data-action="image">Generate image</button>`;
  } else if (shot.status === "image_ready" || (shot.status === "failed" && shot.imageR2Key && !shot.videoR2Key)) {
    action = `<button class="btn small ghost shot-action" data-action="video">Animate to video</button>`;
  } else if (shot.status === "video_ready") {
    action = `<button class="btn small primary shot-action" data-action="save">Save</button>`;
  } else if (shot.status === "saved") {
    action = `<button class="btn small ghost shot-action" data-action="archive">View in Archive →</button>`;
  }
  return `<div class="gen-shot" data-id="${shot.id}">
    <div class="gen-shot-thumb">${shotStatusIcon(shot)}</div>
    <div class="gen-shot-body">
      <div class="gen-shot-type">${esc(shot.type)} · Cut ${shot.ord + 1}</div>
      <div class="gen-shot-desc">${esc(shot.description)}</div>
      <div class="gen-shot-meta">${esc(shot.weight)} · ${esc(shot.motion)}${shot.error ? ` · <span style="color:var(--bad)">${esc(shot.error)}</span>` : ""}</div>
    </div>
    <div class="gen-shot-actions">${action}</div>
  </div>`;
}
function wireShotRows() {
  $$(".gen-shot").forEach((row) => {
    const btn = row.querySelector(".shot-action");
    if (!btn) return;
    btn.onclick = () => handleShotAction(row.dataset.id, btn.dataset.action);
  });
}
async function handleShotAction(shotId, action) {
  if (action === "save") return saveShotFlow(shotId);
  if (action === "archive") return showLibrary();
  const endpoint = action === "image" ? "generate-image" : "generate-video";
  try {
    const shot = await fetch(`/api/generative/scenes/${genState.scene.id}/shots/${shotId}/${endpoint}`, { method: "POST" }).then((r) => r.json());
    if (shot.error) throw new Error(shot.error);
  } catch (err) { toast(err.message || "That step failed", { type: "error" }); }
  await reloadScene();
}
async function reloadScene() {
  const scene = await fetch(`/api/generative/scenes/${genState.scene.id}`).then((r) => r.json());
  if (!scene.error) genState.scene = scene;
  renderSceneArea();
}
async function saveShotFlow(shotId) {
  const threads = await fetchThreads();
  const picked = new Set();
  const result = await UI.modal({
    title: "Save to the Archive",
    bodyHTML: `
      <label class="modal-label">Which threads does this belong to? (optional)</label>
      ${threads.length ? `<div class="chip-row" id="__saveThreadsRow">${threads.map((t) => `<span class="chip-pick" data-thread="${esc(t.name)}" style="border-left:2px solid ${t.color}">${esc(t.name)}</span>`).join("")}</div>` : ""}
      <input class="modal-input" id="__saveThreadsInput" style="margin-top:8px;" placeholder="Add one, comma-separated…" autocomplete="off" />
    `,
    dismissValue: null,
    onOpen: (card) => {
      card.querySelectorAll(".chip-pick[data-thread]").forEach((chip) => {
        chip.onclick = () => {
          const tag = chip.dataset.thread;
          if (picked.has(tag)) picked.delete(tag); else picked.add(tag);
          chip.classList.toggle("on", picked.has(tag));
        };
      });
    },
    actions: [
      { label: "Cancel", resolve: null },
      { label: "Save", variant: "primary", onClick: (done, card) => {
        const custom = card.querySelector("#__saveThreadsInput").value.split(",").map((s) => s.trim()).filter(Boolean);
        done([...picked, ...custom]);
      } },
    ],
  });
  if (result === null) return;
  try {
    const clip = await fetch(`/api/generative/scenes/${genState.scene.id}/shots/${shotId}/save`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tags: result }),
    }).then((r) => r.json());
    if (clip.error) throw new Error(clip.error);
    toast("Saved to the Archive", { type: "success" });
    await reloadScene();
    loadGenerativeRecent();
  } catch (err) { toast(err.message || "Save failed", { type: "error" }); }
}

function renderGenerativeSidebar() {
  const el = $("#genSidebar"); if (!el) return;
  const s = genState;
  const locked = !!s.scene;
  el.innerHTML = `
    <div class="side-h" style="margin-top:0;">Generation settings</div>
    <div style="margin-bottom:18px;${locked ? "opacity:.45;" : ""}">
      <div class="row-between" style="margin-bottom:6px;"><span style="font-size:11.5px;">Number of cuts</span><span class="empty small">${s.cutCount}</span></div>
      <input type="range" min="1" max="4" step="1" id="genCutCount" value="${s.cutCount}" style="width:100%;" ${locked ? "disabled" : ""}/>
      <div class="empty small" style="margin-top:4px;">1 = a single generated shot. Up to 4 = one scene played across multiple cuts.</div>
    </div>
    <div style="margin-bottom:18px;${locked ? "opacity:.45;pointer-events:none;" : ""}">
      <div style="font-size:11.5px;margin-bottom:6px;">Aspect ratio</div>
      <div class="chip-row" id="genAspectRow">${["16:9", "9:16", "1:1"].map((a) => `<span class="chip-pick${s.aspect === a ? " on" : ""}" data-aspect="${a}">${a}</span>`).join("")}</div>
    </div>
    <div style="margin-bottom:22px;${locked ? "opacity:.45;pointer-events:none;" : ""}">
      <div style="font-size:11.5px;margin-bottom:6px;">Duration per cut</div>
      <div class="chip-row" id="genDurationRow">${[3, 5, 8].map((d) => `<span class="chip-pick${s.duration === d ? " on" : ""}" data-duration="${d}">${d}s</span>`).join("")}</div>
    </div>
    <div style="border-top:1px solid var(--line);padding-top:16px;">
      <div class="side-h" style="margin-top:0;">Saved to the Archive</div>
      <div id="genSavedCount" class="gen-saved-count">–</div>
      <div id="genRecentList" style="display:flex;flex-direction:column;gap:8px;"></div>
    </div>
  `;
  $$(".chip-pick[data-aspect]", el).forEach((chip) => { chip.onclick = () => { s.aspect = chip.dataset.aspect; renderGenerativeSidebar(); }; });
  $$(".chip-pick[data-duration]", el).forEach((chip) => { chip.onclick = () => { s.duration = +chip.dataset.duration; renderGenerativeSidebar(); }; });
  const cutSlider = $("#genCutCount");
  if (cutSlider) cutSlider.addEventListener("input", () => { s.cutCount = +cutSlider.value; renderGenerativeSidebar(); });
  renderGenerativeRecentInto();
}
let genRecentCache = null;
async function loadGenerativeRecent() {
  try {
    if (!genProjectId) genProjectId = (await fetch("/api/generative/project").then((r) => r.json())).id;
    genRecentCache = (await fetch(`/api/clips?projectId=${genProjectId}&limit=500`).then((r) => r.json())).clips || [];
  } catch { genRecentCache = null; }
  renderGenerativeRecentInto();
}
function renderGenerativeRecentInto() {
  const countEl = $("#genSavedCount"); const listEl = $("#genRecentList");
  if (!countEl || !listEl) return;
  if (genRecentCache === null) { countEl.textContent = "–"; listEl.innerHTML = ""; return; }
  countEl.textContent = String(genRecentCache.length);
  listEl.innerHTML = genRecentCache.length
    ? genRecentCache.slice(0, 5).map((c) => `<div class="gen-recent-item" style="border-left:2px solid ${c.tags[0] ? colorForTag(c.tags[0]) : "var(--faint)"}">
        <div class="gen-recent-thread">${c.tags[0] ? esc(c.tags[0]) : "untagged"}</div>
        <div class="gen-recent-desc">${esc(c.description || c.title)}</div>
      </div>`).join("")
    : `<div class="empty small">Nothing generated yet.</div>`;
}

// ── Command palette ──────────────────────────────────────────────────
// Reuses whatever the current view already wired up rather than
// duplicating any handler: an in-editor command is just "click the real
// toolbar button", so it shows the same loading state a click would and
// can never drift out of sync with what that button actually does.
async function buildCommands() {
  const cmds = [
    { label: "Go to Desk", group: "Navigate", action: showDeskView },
    { label: "Go to Archive", group: "Navigate", action: showLibrary },
    { label: "Go to Sources", group: "Navigate", action: showProjects },
    { label: "New project", group: "Navigate", action: newProject },
  ];
  for (const item of [...RAIL_ITEMS, ...RAIL_BOTTOM]) {
    if (item.view !== "desk" && item.view !== "archive" && item.view !== "sources") {
      cmds.push({ label: `Go to ${item.label}`, group: "Navigate", action: () => go(item.view) });
    }
  }
  if (state.project) {
    cmds.push(
      { label: "Save", group: "Edit", action: () => $("#save")?.click() },
      { label: "Play edit", group: "Edit", action: () => $("#playEdit")?.click() },
      { label: "Stop", group: "Edit", action: () => $("#stopEdit")?.click() },
      { label: "Undo", group: "Edit", action: () => $("#undoBtn")?.click() },
      { label: "Redo", group: "Edit", action: () => $("#redoBtn")?.click() },
      { label: "Remove fillers", group: "Edit", action: () => $("#removeFillers")?.click() },
      { label: "Trim long pauses", group: "Edit", action: () => $("#trimPauses")?.click() },
      { label: "Show cuts", group: "Edit", action: () => $("#showCuts")?.click() },
      { label: "Text only", group: "Edit", action: () => $("#textOnly")?.click() },
      { label: "Version history", group: "Edit", action: viewHistory },
      { label: "Export", group: "Edit", action: () => $("#export")?.click() },
      { label: "Auto-arrange", group: "AI", action: () => $("#arrange")?.click() },
      { label: "Suggested edits", group: "AI", action: () => $("#suggestEdits")?.click() },
      { label: "Find shorts", group: "AI", action: () => $("#findShorts")?.click() },
      { label: "Find bridges", group: "AI", action: () => $("#findBridges")?.click() },
    );
  }
  if (location.hash === "#/archive" || location.hash === "#/library") {
    cmds.push({ label: "Find related clips across my archive", group: "AI", action: () => $("#discoverBtn")?.click() });
  }
  try {
    const { projects } = await api.listProjects();
    for (const p of projects || []) {
      if (p.id !== state.project?.id) cmds.push({ label: p.name, hint: "Project", group: "Projects", action: () => openProject(p.id) });
    }
  } catch { /* palette still works without the project list */ }
  return cmds;
}
async function openCommandPalette() {
  if ($(".palette-overlay")) return; // already open
  const chosen = await UI.palette(await buildCommands());
  chosen?.action?.();
}

// ── left rail — persistent nav across every top-level surface. Per the
// design brief only Archive/Sources are wired to real views; the rest are
// destinations that exist so the whole shape of the product is visible and
// navigable, not four separate builds bolted onto the old header. No
// keyboard shortcuts anywhere (including the palette) — reachable only by
// clicking the rail/search icon, per explicit design direction. ──────────
const RAIL_ITEMS = [
  { view: "desk", label: "Desk", icon: "desk" },
  { view: "archive", label: "Archive", icon: "archive" },
  { view: "sources", label: "Sources", icon: "upload" },
  { view: "threads", label: "Threads", icon: "threads" },
  { view: "discover", label: "Discover", icon: "globe" },
  { view: "essays", label: "Essays", icon: "quill" },
  { view: "studio", label: "Studio", icon: "clapper" },
  { view: "generative", label: "Generative", icon: "wand" },
  { view: "clipping", label: "Clipping", icon: "scissors" },
];
const RAIL_BOTTOM = [
  { view: "settings", label: "Settings", icon: "gear", desc: "Profile, team, billing, and integrations." },
  { view: "trash", label: "Trash", icon: "trash" },
];
function buildRail() {
  const render = (items, el) => {
    el.innerHTML = "";
    for (const item of items) {
      const btn = document.createElement("button");
      btn.className = "rail-btn"; btn.dataset.view = item.view; btn.title = item.label;
      btn.innerHTML = ic(item.icon);
      btn.onclick = () => go(item.view);
      el.appendChild(btn);
    }
  };
  render(RAIL_ITEMS, $("#railTop"));
  render(RAIL_BOTTOM, $("#railBottom"));
}
function setActiveRail(view) {
  $$(".rail-btn").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
}
function renderStub(item) {
  setActiveRail(item.view);
  setCrumbs([]); setStats(""); $("#headerActions").innerHTML = ""; state.project = null;
  main.innerHTML = `<div class="stub-view"><div class="stub-card">
    ${ic(item.icon)}
    <div class="stub-title">${esc(item.label)}</div>
    <div class="stub-desc">${esc(item.desc)}</div>
    <div class="stub-tag">Coming in a later phase</div>
  </div></div>`;
}

// ── Clipping — a focused, chrome-free page for one job: drop in footage,
// get ranked, publish-ready shorts back. Everything runs through the same
// project/video/shorts machinery as Sources (see getOrCreateClippingProject
// in src/db.ts) — this is a dedicated frontend surface over it, not a
// separate pipeline. Its own lean upload/list/shorts functions below (not
// handleFiles/pollTranscription/renderShorts) because those are wired to
// the full editor — pollTranscription in particular calls renderProject()
// on success, which would blow away this page's DOM.
// The reel: which short is "on" in the big player, and which video is loaded
// there when nothing's been found yet (raw-footage-only mode). Module-level
// because it's UI focus state, not data — reset fresh on every page visit.
let clipActiveShortIndex = 0;
let clipReelVideoId = null;
// Videos currently being imported from an existing Source/Studio recording
// and mined for shorts — a separate "Analyzing for highlights…" queue,
// distinct from clipList's upload-in-progress rows below.
let clipAnalyzingQueue = [];
let clipPickableVideos = [];
async function showClippingView() {
  location.hash = "#/clipping"; setFocused(true);
  main.innerHTML = `<div class="loading"><span class="spinner"></span> Loading…</div>`;
  let project;
  try {
    project = await api.getClippingProject();
    if (project.error) throw new Error(project.error);
  } catch {
    main.innerHTML = `<div class="pad"><p class="empty">Couldn't reach the server.</p></div>`;
    return;
  }
  const data = await api.getProject(project.id);
  if (data.error) { main.innerHTML = `<div class="pad"><p class="empty">${esc(data.error)}</p></div>`; return; }
  state.project = data.project;
  state.videos = (data.videos || []).map((v) => ({ ...v }));
  state.shorts = data.shorts;
  state.selected = null;
  clipActiveShortIndex = 0; clipReelVideoId = null; clipAnalyzingQueue = [];
  clipPickableVideos = await fetch("/api/clipping/pickable-videos").then((r) => r.json()).then((d) => d.videos || []).catch(() => []);
  renderClippingView();
}
function renderClippingView() {
  main.innerHTML = `<div class="clip-view">
    <div class="clip-head">
      <button class="clip-back" id="clipBack" title="Back to Aldershot">${ic("back")}</button>
      <div><div class="clip-title">Clipping</div><div class="clip-sub">Feed it a video — an upload, or anything already in Aldershot — and it generates short, captioned highlights ranked by how likely they are to land. Built for reposting, not for the Archive; send anything worth keeping there by hand.</div></div>
    </div>
    <div class="clip-body">
      <div class="dropzone" id="clipDrop">
        ${ic("plus")}
        <strong>Drop a video here</strong>
        <span>or <label class="link">browse<input id="clipFile" type="file" accept="video/*,audio/*" multiple hidden /></label></span>
        <small>Each one is transcribed and mined for shorts automatically.</small>
      </div>
      <div class="clip-pick-row">
        <span class="clip-pick-or">or</span>
        <select id="clipPickSource" class="clip-pick-select">
          <option value="">Clip a video already in Aldershot…</option>
          ${clipPickableVideos.map((v) => `<option value="${esc(v.id)}">${esc(v.project_kind === "studio" ? `Studio — ${v.filename}` : v.filename)}</option>`).join("")}
        </select>
      </div>
      <div class="clip-queue" id="clipQueue"></div>
      <div class="clip-list" id="clipList"></div>
      <div class="clip-reel" id="clipReel" hidden>
        <video id="clipPlayer" class="clip-player" controls playsinline></video>
        <div class="reel-info" id="clipReelInfo"></div>
        <div class="reel-strip" id="clipReelStrip"></div>
      </div>
    </div>
  </div>`;
  $("#clipBack").onclick = showProjects;
  wireClipDropzone();
  $("#clipPickSource").onchange = (e) => {
    const id = e.target.value; if (!id) return;
    const v = clipPickableVideos.find((x) => x.id === id);
    e.target.value = "";
    if (v) pickExistingClipSource(v);
  };
  clipRenderList();
  clipRenderQueue();
  clipRenderShorts();
}
function clipRenderQueue() {
  const el = $("#clipQueue"); if (!el) return;
  if (!clipAnalyzingQueue.length) { el.innerHTML = ""; return; }
  el.innerHTML = clipAnalyzingQueue.map((q) => `
    <div class="clip-queue-chip"><span class="clip-queue-dot"></span><span class="clip-queue-title">${esc(q.title)}</span><span class="clip-queue-label">Analyzing for highlights…</span></div>
  `).join("");
}
// Second of Clipping's two intake paths — reference an already-transcribed
// video (a Source or a Studio recording) instead of re-uploading it. See
// POST /api/clipping/import-video: it clones the D1 row + R2 transcript
// blob, pointing at the SAME source video file, no re-transcription needed.
async function pickExistingClipSource(v) {
  if (state.videos.some((x) => x.filename === v.filename && x.duration === v.duration)) {
    toast("Already in Clipping.");
    return;
  }
  clipAnalyzingQueue.push({ id: v.id, title: v.filename });
  clipRenderQueue();
  try {
    const res = await fetch("/api/clipping/import-video", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ videoId: v.id }),
    });
    const clone = await res.json();
    if (!res.ok) throw new Error(clone.error || "Couldn't import that video");
    state.videos.push(clone);
    clipReelVideoId = clone.id;
    clipRenderShorts();
    await clipFindShorts();
  } catch (err) {
    toast(err.message || "Couldn't analyze that video", { type: "error" });
  } finally {
    clipAnalyzingQueue = clipAnalyzingQueue.filter((q) => q.id !== v.id);
    clipRenderQueue();
    clipRenderShorts();
  }
}
function wireClipDropzone() {
  const drop = $("#clipDrop");
  $("#clipFile").addEventListener("change", (e) => clipHandleFiles([...e.target.files]));
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => clipHandleFiles([...e.dataTransfer.files]));
}
// Only videos still in flight (uploading/transcribing/failed) get a row here —
// the moment one's ready it graduates into the reel below instead of sitting
// as a name-and-pill row next to its own playable footage. See Reel 00/02 of
// the design brief: a list row is "the system" (renders the database); the
// reel is "the app" (renders the content).
function clipRenderList() {
  $("#clipDrop")?.classList.toggle("compact", state.videos.length > 0);
  const list = $("#clipList"); if (!list) return;
  const inFlight = state.videos.filter((v) => v.status !== "ready");
  if (!inFlight.length) { list.innerHTML = ""; return; }
  list.innerHTML = inFlight.map((v) => {
    const i = state.videos.indexOf(v);
    let pill = "", extra = "";
    if (v.status === "failed") pill = `<span class="pill bad">failed</span>`;
    else pill = `<span class="pill work">${esc(v.stage || v.status)}</span>`;
    if (v.status === "uploading") extra = `<div class="progress"><i style="width:${Math.round((v.pct || 0) * 100)}%"></i></div>`;
    else if (v.status === "transcribing") extra = `<div class="progress indeterminate"><i></i></div>`;
    else if (v.status === "failed") extra = `<div class="vmeta"><span style="color:var(--bad)">${esc(v.error || "failed")}</span></div><button class="btn small ghost clip-retry" data-i="${i}">Retry</button>`;
    const thumb = v.r2_key
      ? `<div class="vthumb"><img data-thumb-src="${esc(mediaUrl(v.r2_key))}" data-thumb-t="${Math.min(2, (v.duration || 4) / 4)}" alt="" /></div>`
      : `<div class="vthumb placeholder">${ic("video")}</div>`;
    return `<div class="clip-row"><div class="vrow-top">${thumb}<div class="vrow-info"><div class="vrow-line"><span class="vname">${esc(filenameOf(v.filename))}</span>${pill}</div>${extra}</div></div></div>`;
  }).join("");
  list.querySelectorAll(".clip-retry").forEach((btn) => {
    btn.onclick = () => { const v = state.videos[+btn.dataset.i]; v.error = null; clipPollTranscription(v).catch(() => {}); };
  });
  Thumb.hydrate(list);
}
async function clipHandleFiles(files) {
  const media = files.filter((f) => f.type.startsWith("video/") || f.type.startsWith("audio/"));
  if (files.length && !media.length) toast("Those files aren't video or audio.", { type: "error" });
  for (const file of media) {
    const item = { id: null, filename: file.name, status: "uploading", pct: 0, duration: null, words: null };
    state.videos.push(item); clipRenderList();
    try {
      item.duration = await readDuration(file);
      const pres = await fetch(`/api/projects/${state.project.id}/videos/presign`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type || "video/mp4" }),
      }).then((r) => r.json());
      if (pres.error) throw new Error(pres.error);
      item.id = pres.videoId;
      item.stage = "uploading…"; clipRenderList();
      await putToR2(pres.uploadUrl, file, (p) => { item.pct = p; clipRenderList(); });
      const video = await fetch(`/api/projects/${state.project.id}/videos/confirm`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoId: pres.videoId, key: pres.key, filename: file.name, duration: item.duration }),
      }).then((r) => r.json());
      if (video.error) throw new Error(video.error);
      Object.assign(item, video);
      await clipPollTranscription(item);
    } catch (err) {
      item.status = "failed"; item.error = err.message || String(err); clipRenderList();
      toast(item.error, { type: "error", title: "Upload failed" });
    }
  }
}
async function clipPollTranscription(item) {
  item.status = "transcribing";
  item.stage = "extracting audio — can take several minutes for long videos, keep this tab open…";
  clipRenderList();
  const start = await fetch(`/api/videos/${item.id}/transcribe-remote`, { method: "POST" });
  if (!start.ok) { const d = await start.json().catch(() => ({})); throw new Error(d.error || "couldn't start transcription"); }
  item.stage = "transcribing…"; clipRenderList();
  for (let i = 0; i < 2000; i++) {
    await sleep(1500);
    const res = await fetch(`/api/videos/${item.id}/transcribe-status`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "status check failed");
    if (typeof data.progress === "number") { item.stage = `transcribing ${data.progress}%…`; clipRenderList(); }
    if (data.status === "ready") {
      item.words = data.words; item.status = "ready"; item.stage = "";
      clipRenderList();
      clipReelVideoId = item.id; clipRenderShorts(); // show the raw footage immediately, before AI runs
      toast(`"${item.filename}" transcribed`, { type: "success" });
      await clipFindShorts();
      return;
    }
    if (data.status === "failed") throw new Error(data.error || "transcription failed");
  }
  throw new Error("transcription timed out");
}
async function clipFindShorts() {
  if (!state.videos.some((v) => v.status === "ready" && v.words)) return;
  try {
    const res = await fetch(`/api/projects/${state.project.id}/shorts`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    state.shorts = data.shorts;
    clipActiveShortIndex = 0;
    clipRenderShorts();
  } catch (err) { toast(err.message || "Find shorts failed", { type: "error", title: "Shorts" }); }
}
// The reel: your footage IS the interface, not a report about it. Before any
// short is found, the player just holds whatever you most recently finished
// transcribing, playable and scrubbable — proof you're looking at real
// content, not a status row. Once shorts exist, they're marks you step
// through one at a time (each one loads + plays its own moment directly in
// the same big player), never a grid of cards you scan and hover-preview.
function clipRenderShorts() {
  const reel = $("#clipReel"); if (!reel) return;
  const shorts = state.shorts || [];
  const ready = state.videos.filter((v) => v.status === "ready" && v.r2_key);
  if (!shorts.length && !ready.length) { reel.hidden = true; return; }
  reel.hidden = false;
  const info = $("#clipReelInfo"), strip = $("#clipReelStrip");

  if (!shorts.length) {
    const v = ready.find((x) => x.id === clipReelVideoId) || ready[ready.length - 1];
    clipLoadReelVideo(v, null);
    info.innerHTML = `<div class="reel-hint">Mining "${esc(filenameOf(v.filename))}" for shorts…</div>`;
    strip.innerHTML = "";
    return;
  }

  if (clipActiveShortIndex >= shorts.length) clipActiveShortIndex = 0;
  const active = shorts[clipActiveShortIndex];
  const v = state.videos.find((x) => x.id === active.videoId);
  clipLoadReelVideo(v, active);
  info.innerHTML = `
    <div class="reel-title">${esc(active.title)}</div>
    <div class="reel-hook">${esc(active.hook || "")}</div>
    <div class="reel-actions">
      <button class="btn small accent" id="reelProduce">${ic("download")} Produce</button>
      <button class="btn small ghost" id="reelSend">${active.sentToArchive ? "In Archive ✓" : "Send to Archive"}</button>
      <button class="btn small ghost" id="reelDismiss">Not this one</button>
    </div>`;
  $("#reelProduce").onclick = (e) => produceShort(active, e.currentTarget);
  $("#reelSend").onclick = () => sendHighlightToArchive(active);
  $("#reelDismiss").onclick = () => {
    state.shorts.splice(clipActiveShortIndex, 1);
    if (clipActiveShortIndex >= state.shorts.length) clipActiveShortIndex = Math.max(0, state.shorts.length - 1);
    clipRenderShorts();
  };

  strip.innerHTML = shorts.map((s, i) => {
    const sv = state.videos.find((x) => x.id === s.videoId);
    const thumbUrl = sv && sv.r2_key ? mediaUrl(sv.r2_key) : "";
    return `<button class="reel-mark${i === clipActiveShortIndex ? " on" : ""}" data-i="${i}" title="${esc(s.title)}">
      ${thumbUrl ? `<img data-thumb-src="${esc(thumbUrl)}" data-thumb-t="${Math.max(0.1, s.start).toFixed(1)}" alt="" />` : ""}
      <span class="reel-mark-dur">${Math.round(s.end - s.start)}s</span>
    </button>`;
  }).join("");
  strip.querySelectorAll(".reel-mark").forEach((btn) => {
    btn.onclick = () => { clipActiveShortIndex = +btn.dataset.i; clipRenderShorts(); };
  });
  Thumb.hydrate(strip);
}
async function clipLoadReelVideo(v, short) {
  if (!v) return;
  clipReelVideoId = v.id;
  const p = $("#clipPlayer"); if (!p) return;
  await ensureSrc(p, { r2_key: v.r2_key });
  if (short) {
    p.currentTime = short.start; p.play();
    const stop = () => { if (p.currentTime >= short.end) { p.pause(); p.removeEventListener("timeupdate", stop); } };
    p.addEventListener("timeupdate", stop);
  }
}
// Clipping is "built for reposting, not for the Archive" — a found
// highlight only becomes a real, reusable Archive clip if you explicitly
// send it there, same as Studio's identical "Send to Archive" pattern.
async function sendHighlightToArchive(short) {
  if (short.sentToArchive) return;
  await saveClipToLibrary([{ videoId: short.videoId, start: short.start, end: short.end }], { title: short.title, description: short.hook, kind: "clipping-highlight" });
  short.sentToArchive = true;
  clipRenderShorts();
}
// ── Studio — the lighter single-video editor for a raw take that isn't part
// of a themed archive yet. Reuses the same project shell as a Sources
// project almost entirely (renderProject(), same upload/transcribe pipeline,
// same transcript editor) — see state.studioMode, which only swaps the
// tools-aside markup and disables tab-switching so its three sections
// (Suggested cuts / Clip candidates / Video ideas) sit side by side. Backed
// by its own scratch project (kind='studio'), same pattern as Clipping's.
async function showStudioView() {
  location.hash = "#/studio";
  main.innerHTML = `<div class="loading"><span class="spinner"></span> Loading…</div>`;
  let project;
  try {
    project = await api.getStudioProject();
    if (project.error) throw new Error(project.error);
  } catch {
    main.innerHTML = `<div class="pad"><p class="empty">Couldn't reach the server.</p></div>`;
    return;
  }
  const data = await api.getProject(project.id);
  if (data.error) { main.innerHTML = `<div class="pad"><p class="empty">${esc(data.error)}</p></div>`; return; }
  state.project = data.project;
  state.videos = (data.videos || []).map((v) => ({ ...v }));
  state.timeline = data.timeline;
  state.shorts = data.shorts;
  state.suggestions = data.suggestions;
  state.bridges = null;
  state.studioMode = true;
  state.selected = state.videos.find((v) => v.status === "ready")?.id || state.videos[0]?.id || null;
  setCrumbs([{ label: "Aldershot", go: showProjects }, { label: "Studio" }]);
  setStats("A lighter editor for one raw take — kept separate from the Archive");
  renderProject();
}

// ── Trash — restore-anything-you-didn't-mean-to-remove for essays and
// Sources projects, the two things Delete elsewhere can otherwise lose for
// good (version history already covers overwrites, but not a deletion).
async function showTrashView() {
  location.hash = "#/trash"; setActiveRail("trash");
  setCrumbs([]); setStats(""); $("#headerActions").innerHTML = ""; state.project = null;
  main.innerHTML = `<div class="loading"><span class="spinner"></span> Loading trash…</div>`;
  let data;
  try { data = await fetch("/api/trash").then((r) => r.json()); }
  catch { main.innerHTML = `<div class="pad"><p class="empty">Couldn't reach the server.</p></div>`; return; }
  const projects = data.projects || [], essays = data.essays || [];
  main.innerHTML = `<section class="pad">
    <div><h1>Trash</h1><div class="sub">Restore anything you didn't mean to remove.</div></div>
    <div class="tools-h" style="margin-top:22px;">Sources</div>
    ${projects.length ? `<div class="grid" id="trashProjects"></div>` : `<div class="empty-note">Nothing here.</div>`}
    <div class="tools-h" style="margin-top:26px;">Essays</div>
    ${essays.length ? `<div class="grid" id="trashEssays"></div>` : `<div class="empty-note">Nothing here.</div>`}
  </section>`;
  const trashCard = (title, sub, kind, id, thumbHTML) => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `${thumbHTML || ""}
      <div class="card-body">
        <div class="card-title">${esc(title)}</div>
        <div class="card-sub">${esc(sub)}</div>
        <div class="s-actions" style="margin-top:10px;">
          <button class="btn small accent trash-restore">Restore</button>
          <button class="btn small danger trash-forever">Delete forever</button>
        </div>
      </div>`;
    card.querySelector(".trash-restore").onclick = async () => {
      await fetch(`/api/${kind}/${id}/restore`, { method: "POST" });
      toast("Restored", { type: "success" });
      showTrashView();
    };
    card.querySelector(".trash-forever").onclick = async () => {
      if (!(await UI.confirm({ title: "Delete forever?", message: "This can't be undone.", confirmText: "Delete forever", danger: true }))) return;
      await fetch(`/api/${kind}/${id}/forever`, { method: "DELETE" });
      toast("Deleted forever", { type: "success" });
      showTrashView();
    };
    return card;
  };
  if (projects.length) {
    const grid = $("#trashProjects");
    projects.forEach((p) => {
      grid.appendChild(trashCard(p.name, `Deleted ${new Date(p.deleted_at).toLocaleString()}`, "projects", p.id, frameThumbHTML(p.thumb_r2_key, p.thumb_duration)));
    });
    Thumb.hydrate(grid);
  }
  if (essays.length) {
    const grid = $("#trashEssays");
    essays.forEach((e) => {
      grid.appendChild(trashCard(e.title, `Deleted ${new Date(e.deleted_at).toLocaleString()}`, "essays", e.id));
    });
  }
}

function go(view) {
  location.hash = `#/${view}`;
}

// ── boot ─────────────────────────────────────────────────────────────
buildRail();
$("#railHome").onclick = showDeskView;
$("#railHome").onkeydown = (e) => { if (e.key === "Enter") showDeskView(); };
$("#paletteTrigger").onclick = openCommandPalette;
$("#railNotif").innerHTML = ic("bell");
$("#railNotif").onclick = toggleNotifPanel;

// Reuses the Desk's own "since you were last here" digest (GET /api/desk)
// as the notification feed — same real events, same deep links, just
// reachable from anywhere instead of only the home view.
async function toggleNotifPanel() {
  const panel = $("#notifPanel");
  if (!panel.hidden) { panel.hidden = true; return; }
  panel.hidden = false;
  panel.innerHTML = `<div class="notif-head">Notifications</div><div class="notif-list" id="notifList"><div class="loading"><span class="spinner"></span></div></div>`;
  let digest = [];
  try { ({ digest } = await fetch("/api/desk").then((r) => r.json())); } catch { digest = []; }
  const list = $("#notifList");
  if (!digest.length) { list.innerHTML = `<div class="notif-empty">Nothing new since last time.</div>`; return; }
  list.innerHTML = digest.map((d, i) => `<div class="notif-row" data-i="${i}"><span class="notif-dot" style="background:${d.color}"></span><span>${esc(d.text)}</span></div>`).join("");
  list.querySelectorAll(".notif-row").forEach((row) => {
    row.onclick = () => { panel.hidden = true; deskGo(digest[+row.dataset.i].go); };
  });
}
document.addEventListener("click", (e) => {
  const panel = $("#notifPanel");
  if (!panel || panel.hidden) return;
  if (!panel.contains(e.target) && e.target.id !== "railNotif" && !e.target.closest?.("#railNotif")) panel.hidden = true;
});
// Focused mode strips the rail + top bar for a single-purpose page that
// isn't part of the dashboard shell (Clipping today). Toggled from route()
// so every other destination reliably restores the normal chrome.
function setFocused(on) {
  $(".shell")?.classList.toggle("focused", !!on);
}
// Studio's lighter framing: rail out of the way, top bar (and its crumbs,
// the way back) kept — distinct from Clipping's fully chrome-free mode.
function setRailHidden(on) {
  $(".shell")?.classList.toggle("rail-hidden", !!on);
}
function route() {
  const view = (location.hash.match(/^#\/(\w+)/) || [])[1] || "desk";
  setFocused(view === "clipping");
  setRailHidden(view === "studio");
  if (view !== "studio") state.studioMode = false;
  if (view === "desk") return showDeskView();
  if (view === "archive" || view === "library") return showLibrary();
  const p = location.hash.match(/^#\/p\/([\w-]+)/);
  if (p) return openProject(p[1]);
  if (view === "essays") {
    const e = location.hash.match(/^#\/essays\/([\w-]+)/);
    return e ? openEssay(e[1]) : showEssaysList();
  }
  if (view === "threads") return showThreadsView();
  if (view === "discover") return showDiscoverView();
  if (view === "generative") return showGenerativeView();
  if (view === "clipping") return showClippingView();
  if (view === "studio") return showStudioView();
  if (view === "trash") return showTrashView();
  const stub = RAIL_ITEMS.find((i) => i.view === view) || RAIL_BOTTOM.find((i) => i.view === view);
  if (stub && stub.desc) return renderStub(stub);
  showProjects();
}
window.addEventListener("hashchange", route);
route();
