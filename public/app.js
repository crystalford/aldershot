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
// Filenames aren't URI-encoded, but tolerate old records that were — never throw.
const filenameOf = (v) => { try { return decodeURIComponent(v || "video"); } catch { return v || "video"; } };

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

// ── State ────────────────────────────────────────────────────────────
const state = { project: null, videos: [], timeline: null, shorts: null, suggestions: null, selected: null, trimPausesAbove: null };

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
async function showProjects() {
  location.hash = "#/"; setCrumbs([]); setStats(""); $("#headerActions").innerHTML = ""; state.project = null;
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
  state.suggestions = data.suggestions;
  state.selected = state.videos.find((v) => v.status === "ready")?.id || state.videos[0]?.id || null;
  setCrumbs([{ label: "Projects", go: showProjects }, { label: data.project.name }]);
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
          <video id="sel-player" playsinline></video>
          <div class="ruler" id="ruler"></div>

          <h1 class="doc-title" id="docTitle">Transcript</h1>

          <div class="sel-toolbar" id="selToolbar">
            <span id="selCount"></span>
            <span class="sel-toolbar-div"></span>
            <button class="chip-btn" id="selDelete">Delete</button>
            <button class="chip-btn" id="selClear">Clear</button>
          </div>

          <div class="toolbar toolbar-edit">
            <button class="btn small ghost" id="undoBtn" title="Undo (Ctrl/Cmd+Z)">↶ Undo</button>
            <button class="btn small ghost" id="redoBtn" title="Redo (Ctrl/Cmd+Shift+Z)">↷ Redo</button>
            <button class="btn small ghost" id="removeFillers">Remove fillers</button>
            <button class="btn small ghost" id="trimPauses">Trim long pauses</button>
            <span class="spacer"></span>
            <div class="search-box">
              <input id="search" placeholder="Search transcript…" autocomplete="off" />
              <span class="search-count" id="searchCount"></span>
              <button class="search-nav" id="searchPrev" title="Previous match">‹</button>
              <button class="search-nav" id="searchNext" title="Next match">›</button>
            </div>
          </div>

          <p class="hint">Click or drag across words to select them, then press <b>Delete</b> to cut · click a cut (struck-through) word to restore it · double-click to jump the player there · space to play/pause.</p>
          <div class="transcript" id="transcript"></div>
        </section>

        <aside class="tools" id="tools">
          <div class="tools-scroll">
            <div class="tools-actions">
              <button class="btn accent" id="playEdit">${ic("play")} Play edit</button>
              <button class="btn ghost" id="stopEdit">${ic("stop")} Stop</button>
              <button class="btn ghost" id="save">${ic("save")} Save</button>
            </div>

            <div class="tools-h">AI tools</div>
            <div class="tools-actions col">
              <button class="btn" id="arrange">${ic("sparkle")} Auto-arrange</button>
              <button class="btn" id="suggestEdits">${ic("sparkle")} Suggested edits</button>
              <button class="btn" id="findShorts">${ic("film")} Find shorts</button>
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
            <div id="suggest" class="tool-panel" data-panel="suggest" hidden></div>
            <div id="shorts" class="tool-panel" data-panel="shorts" hidden></div>
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
  renderShorts();
  renderSuggestions();
  renderRuler();
  updateStats();
  wireTransport();
  wireToolsTabs();
  selectVideo(state.selected);
  $("#playEdit").onclick = playEdit;
  $("#stopEdit").onclick = stopEdit;
  $("#arrange").onclick = (e) => autoArrange(e.currentTarget);
  $("#findShorts").onclick = (e) => findShorts(e.currentTarget);
  $("#suggestEdits").onclick = (e) => findSuggestions(e.currentTarget);
  $("#directBtn").onclick = (e) => runDirectedEdit(e.currentTarget);
  $("#directInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); runDirectedEdit($("#directBtn")); }
  });
  $("#export").onclick = (e) => exportCut(e.currentTarget);
  $("#save").onclick = (e) => saveEdit(e.currentTarget);
  $("#importBtn").onclick = importFromUrl;
  $("#url").addEventListener("keydown", (e) => { if (e.key === "Enter") importFromUrl(); });
  $("#undoBtn").onclick = undo;
  $("#redoBtn").onclick = redo;
  $("#selDelete").onclick = deleteSelection;
  $("#selClear").onclick = clearSelection;
  $("#removeFillers").onclick = removeFillers;
  $("#trimPauses").onclick = toggleTrimPauses;
  $("#trimPauses").classList.toggle("accent", !!state.trimPausesAbove);
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
  $("#toolsTabs").querySelectorAll(".tool-tab").forEach((tab) => {
    tab.onclick = () => switchToolsTab(tab.dataset.tab);
  });
}
function switchToolsTab(name) {
  $("#toolsTabs")?.querySelectorAll(".tool-tab").forEach((t) => t.classList.toggle("on", t.dataset.tab === name));
  document.querySelectorAll(".tool-panel").forEach((p) => { p.hidden = p.dataset.panel !== name; });
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
  } else if (e.key === "Escape") {
    clearSelection();
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
    }

    const thumb = v.r2_key
      ? `<div class="vthumb"><img data-thumb-src="${esc(mediaUrl(v.r2_key))}" data-thumb-t="${Math.min(2, (v.duration || 4) / 4)}" alt="" /><span class="vthumb-play">${ic("play")}</span></div>`
      : `<div class="vthumb placeholder">${ic("video")}</div>`;

    row.innerHTML = `<div class="vrow-top">${thumb}<div class="vrow-info"><div class="vrow-line"><span class="vname">${esc(filenameOf(v.filename))}</span>${pill}</div>${extra}</div></div>`;
    if (v.id && v.status !== "uploading") row.onclick = () => selectVideo(v.id);
    const retryBtn = row.querySelector(".retry-btn");
    if (retryBtn) retryBtn.onclick = (e) => { e.stopPropagation(); retryVideo(v); };
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
    head.className = "tsec-head"; head.textContent = filenameOf(v.filename);
    head.onclick = () => selectVideo(v.id);
    sec.appendChild(head);
    const body = document.createElement("div");
    body.className = "tsec-body";
    // Cache a direct index → element lookup (populated below) so the playhead
    // highlighter never has to `querySelector` the DOM on every timeupdate —
    // that's an O(words) scan per tick, which is the difference between smooth
    // playback and visible stutter once a transcript runs into the thousands
    // of words.
    v._wordEls = new Array(v.words.length);
    groupIntoParagraphs(v.words).forEach((idxs) => {
      const p = document.createElement("p");
      p.className = "para";
      idxs.forEach((i, k) => {
        const w = v.words[i];
        const span = document.createElement("span");
        let cls = "word";
        if (w.deleted) cls += " deleted";
        else if (isFillerWord(w.text)) cls += " filler";
        if (v._selStart != null && i >= v._selStart && i <= v._selEnd) cls += " selected";
        span.className = cls;
        span.textContent = (k === 0 ? capitalizeFirst(w.text) : w.text) + " ";
        span.dataset.i = i;
        v._wordEls[i] = span;
        p.appendChild(span);
      });
      body.appendChild(p);
    });
    body.addEventListener("mousedown", (e) => onWordMouseDown(e, v));
    body.addEventListener("mouseover", (e) => onWordMouseOver(e, v));
    body.addEventListener("dblclick", (e) => onWordDbl(e, v));
    sec.appendChild(body);
    t.appendChild(sec);
  });
  highlightSelectedTranscript();
  runSearch($("#search")?.value || "");
}

// Break a long transcript into paragraphs at natural pauses (>1s) so it reads
// like a document instead of one unbroken wall of lowercase text. Visual only
// — capitalization is display-only and never mutates the underlying words.
function groupIntoParagraphs(words, gapThreshold = 1.0) {
  const paras = [];
  let cur = [];
  let lastEnd = null;
  words.forEach((w, i) => {
    if (lastEnd != null && w.start - lastEnd > gapThreshold && cur.length) { paras.push(cur); cur = []; }
    cur.push(i);
    lastEnd = w.end;
  });
  if (cur.length) paras.push(cur);
  return paras;
}
const capitalizeFirst = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// ── Search-in-transcript ─────────────────────────────────────────────
let searchMatches = [], searchIdx = -1;
function runSearch(q) {
  document.querySelectorAll(".word.match").forEach((el) => el.classList.remove("match", "match-active"));
  searchMatches = []; searchIdx = -1;
  const qq = q.trim().toLowerCase();
  if (qq.length >= 2) {
    document.querySelectorAll(".tsec-body .word").forEach((el) => {
      if (el.textContent.toLowerCase().includes(qq)) { el.classList.add("match"); searchMatches.push(el); }
    });
  }
  updateSearchCount();
}
function gotoMatch(idx) {
  if (!searchMatches.length) return;
  if (searchIdx >= 0 && searchMatches[searchIdx]) searchMatches[searchIdx].classList.remove("match-active");
  searchIdx = ((idx % searchMatches.length) + searchMatches.length) % searchMatches.length;
  const el = searchMatches[searchIdx];
  el.classList.add("match-active");
  el.scrollIntoView({ block: "center", behavior: "smooth" });
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
function undo() {
  const v = state.lastEditedVideo;
  if (!v || !v._history || !v._history.length) return;
  v._future = v._future || [];
  v._future.push(JSON.stringify(v.words));
  v.words = JSON.parse(v._history.pop());
  renderTranscript(); updateStats(); renderRuler();
}
function redo() {
  const v = state.lastEditedVideo;
  if (!v || !v._future || !v._future.length) return;
  v._history.push(JSON.stringify(v.words));
  v.words = JSON.parse(v._future.pop());
  renderTranscript(); updateStats(); renderRuler();
}

// ── Text selection (Descript-style: drag across words, then Delete to cut) ──
// A single click selects one word; dragging extends the selection; pressing
// Backspace/Delete cuts whatever's selected. Clicking a cut (struck-through)
// word restores it immediately — the one exception, since that's a quick,
// obviously-reversible undo gesture people expect to work in one click.
let dragState = null;
let selectedEls = [];

function setSelection(v, start, end) {
  selectedEls.forEach((el) => el.classList.remove("selected"));
  selectedEls = [];
  state.videos.forEach((o) => { if (o !== v) { o._selStart = null; o._selEnd = null; } });
  v._selStart = Math.min(start, end);
  v._selEnd = Math.max(start, end);
  const body = document.querySelector(`.tsec[data-vid="${v.id}"] .tsec-body`);
  if (body) {
    for (let i = v._selStart; i <= v._selEnd; i++) {
      const el = body.querySelector(`.word[data-i="${i}"]`);
      if (el) { el.classList.add("selected"); selectedEls.push(el); }
    }
  }
  updateSelectionHint();
}
function clearSelection() {
  selectedEls.forEach((el) => el.classList.remove("selected"));
  selectedEls = [];
  state.videos.forEach((v) => { v._selStart = null; v._selEnd = null; });
  updateSelectionHint();
}
function updateSelectionHint() {
  const bar = $("#selToolbar"); if (!bar) return;
  const n = selectedEls.length;
  bar.classList.toggle("show", n > 0);
  const countEl = $("#selCount");
  if (countEl) countEl.textContent = n > 0 ? `${n} word${n === 1 ? "" : "s"} selected` : "";
}
function deleteSelection() {
  const v = state.videos.find((x) => x._selStart != null);
  if (!v) return;
  snapshotHistory(v);
  for (let i = v._selStart; i <= v._selEnd; i++) v.words[i].deleted = true;
  clearSelection();
  renderTranscript(); updateStats(); renderRuler();
}

function onWordMouseDown(e, v) {
  const el = e.target.closest(".word"); if (!el) return;
  e.preventDefault(); // avoid native text-selection ghosting while dragging
  const i = +el.dataset.i;
  if (v.words[i].deleted) {
    snapshotHistory(v);
    v.words[i].deleted = false;
    renderTranscript(); updateStats(); renderRuler();
    return;
  }
  dragState = { v, anchor: i };
  setSelection(v, i, i);
}
function onWordMouseOver(e, v) {
  if (!dragState || dragState.v !== v) return;
  const el = e.target.closest(".word"); if (!el) return;
  setSelection(v, dragState.anchor, +el.dataset.i);
}
document.addEventListener("mouseup", () => { dragState = null; });

// Bulk-delete every filler word ("um", "uh", …) across all transcribed videos.
function removeFillers() {
  const ready = state.videos.filter((v) => v.status === "ready" && v.words);
  let count = 0;
  ready.forEach((v) => {
    const hasFiller = v.words.some((w) => !w.deleted && isFillerWord(w.text));
    if (!hasFiller) return;
    snapshotHistory(v);
    v.words.forEach((w) => { if (!w.deleted && isFillerWord(w.text)) { w.deleted = true; count++; } });
  });
  if (!count) { toast("No filler words found."); return; }
  renderTranscript(); updateStats(); renderRuler();
  toast(`Removed ${count} filler word${count === 1 ? "" : "s"}`, { type: "success" });
}

// Toggle hard-cutting internal pauses longer than the threshold (natural
// pauses are preserved by default now — see keptRanges).
function toggleTrimPauses() {
  state.trimPausesAbove = state.trimPausesAbove ? null : 1.5;
  renderProject();
  toast(state.trimPausesAbove ? "Trimming pauses longer than 1.5s" : "Pause trimming off");
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

function buildClips() {
  if (hasTimeline()) {
    const segs = [...(state.timeline.coldOpen || []), ...(state.timeline.body || [])];
    return segs.map((s) => {
      const v = state.videos.find((x) => x.id === s.videoId);
      return v && v.r2_key ? { videoId: s.videoId, r2_key: v.r2_key, start: s.start, end: s.end } : null;
    }).filter(Boolean);
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
  if (!hasTimeline()) { el.innerHTML = ""; return; }
  const t = state.timeline;
  const seg = (s, group, idx) => {
    const v = state.videos.find((x) => x.id === s.videoId);
    const name = v ? filenameOf(v.filename) : s.videoId;
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
    <div class="s-actions"><button class="btn small ghost sg-preview">${ic("play")} Preview</button><button class="btn small accent sg-apply">Add to timeline</button></div>
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
  setTimeout(() => { btn.textContent = "Add to timeline"; }, 1200);
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
      item.words = data.words; item.status = "ready"; item.stage = "";
      if (!state.selected) state.selected = item.id;
      renderProject();
      toast(`“${item.filename}” transcribed`, { type: "success" });
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

// ── boot ─────────────────────────────────────────────────────────────
$("#home").onclick = showProjects;
$("#home").onkeydown = (e) => { if (e.key === "Enter") showProjects(); };
function route() {
  const m = location.hash.match(/^#\/p\/([\w-]+)/);
  if (m) openProject(m[1]); else showProjects();
}
window.addEventListener("hashchange", route);
route();
