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
  pause: '<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>',
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
const state = { project: null, videos: [], timeline: null, shorts: null, suggestions: null, bridges: null, selected: null, trimPausesAbove: null, showCuts: false, textOnly: false, libraryTag: null };

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
  state.bridges = null;
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
          <div class="video-wrap" id="videoWrap">
            <video id="sel-player" playsinline></video>
            <div class="video-playbtn" id="videoPlayBtn" aria-hidden="true">${ic("play")}</div>
          </div>
          <div class="ruler" id="ruler"></div>

          <h1 class="doc-title" id="docTitle">Transcript</h1>

          <div class="sel-toolbar" id="selToolbar">
            <span id="selCount"></span>
            <span class="sel-toolbar-div"></span>
            <button class="chip-btn" id="selAddCut" title="Add this selection to the Cut list, where you can drag it into any order">Add to Cut</button>
            <button class="chip-btn" id="selSaveClip" title="Save this selection to the cross-project Clip Library">Save to Library</button>
            <button class="chip-btn" id="selDelete">Delete</button>
            <button class="chip-btn" id="selClear">Clear</button>
          </div>

          <div class="toolbar toolbar-edit">
            <button class="btn small ghost" id="undoBtn" title="Undo (Ctrl/Cmd+Z)">↶ Undo</button>
            <button class="btn small ghost" id="redoBtn" title="Redo (Ctrl/Cmd+Shift+Z)">↷ Redo</button>
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
  $("#arrange").onclick = (e) => autoArrange(e.currentTarget);
  $("#findShorts").onclick = (e) => findShorts(e.currentTarget);
  $("#findBridges").onclick = (e) => findBridges(e.currentTarget);
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
  $("#selAddCut").onclick = addSelectionToCut;
  $("#selSaveClip").onclick = saveSelectionToLibrary;
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
  $("#toolsTabs").querySelectorAll(".tool-tab").forEach((tab) => {
    tab.onclick = () => switchToolsTab(tab.dataset.tab);
  });
}
function switchToolsTab(name) {
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
    el.innerHTML = `<p class="empty small">No arranged cut yet. Use Auto-arrange/Direct the edit above, or select text in the transcript and choose <b>Add to Cut</b> — segments land here and you can drag ⠿ to reorder them.</p>`;
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
      <button class="seg-save" title="Save to the cross-project Clip Library">${ic("save")}</button>
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
      <div class="s-actions"><button class="btn small primary bridge-record">${ic("video")} Record this bridge</button></div>
    </div>`).join("")}
  </div>`;
  bridges.forEach((b, i) => {
    el.querySelector(`.suggestion[data-i="${i}"] .bridge-record`).onclick = (e) => recordAndInsertBridge(b, e.currentTarget);
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
    const item = await uploadAndTranscribeBridge(blob, (msg) => { btn.textContent = msg; });
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
      <div id="__recStatus" style="color:var(--dim);font-size:12.5px;">Choose camera + mic or voice only, then record.</div>
    `,
    dismissValue: null,
    onOpen: (card, done) => wireRecorder(card, done),
  });
}
function wireRecorder(card, done) {
  const video = card.querySelector("#__recPreview");
  const status = card.querySelector("#__recStatus");
  const foot = card.querySelector(".modal-foot");
  let stream = null, recorder = null, chunks = [], blob = null, timerInt = null, seconds = 0;

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
  const cleanup = () => { clearInterval(timerInt); if (stream) stream.getTracks().forEach((t) => t.stop()); };
  const showReady = () => {
    status.textContent = "Choose camera + mic or voice only, then record.";
    setButtons([
      { label: "Cancel", onClick: () => { cleanup(); done(null); } },
      { label: "Camera + mic", onClick: () => startRecording(true) },
      { label: "Voice only", variant: "primary", onClick: () => startRecording(false) },
    ]);
  };
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
      clearInterval(timerInt);
      status.textContent = "Review your take.";
      setButtons([
        { label: "Retake", onClick: () => { video.controls = false; video.removeAttribute("src"); showReady(); } },
        { label: "Use this take", variant: "primary", onClick: () => done(blob) },
      ]);
    };
    recorder.start();
    seconds = 0;
    status.textContent = "● Recording… 0:00";
    timerInt = setInterval(() => { seconds++; status.textContent = `● Recording… ${fmt(seconds)}`; }, 1000);
    setButtons([{ label: "Stop", variant: "danger", onClick: () => recorder.stop() }]);
  }
  showReady();
}

// Uploads a recorded Blob through the exact same pipeline any dropped-in
// video file uses (presign → direct-to-R2 PUT → confirm → server-side
// transcribe), so a recorded bridge becomes a completely normal project
// video — visible in the sidebar, editable like anything else.
async function uploadAndTranscribeBridge(blob, onProgress) {
  const file = new File([blob], `bridge-${Date.now()}.webm`, { type: blob.type || "video/webm" });
  onProgress?.("Reading…");
  const duration = await readDuration(file);
  onProgress?.("Uploading…");
  const pres = await fetch(`/api/projects/${state.project.id}/videos/presign`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ filename: file.name, contentType: file.type || "video/webm" }),
  }).then((r) => r.json());
  if (pres.error) throw new Error(pres.error);
  await putToR2(pres.uploadUrl, file, () => {});
  const video = await fetch(`/api/projects/${state.project.id}/videos/confirm`, {
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
    <div class="s-actions"><button class="btn small ghost sg-preview">${ic("play")} Preview</button><button class="btn small ghost sg-save">Save to Library</button><button class="btn small accent sg-apply">Add to timeline</button></div>
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
    title: "Save to Library",
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
    toast("Saved to Library", { type: "success" });
  } catch (err) { toast(err.message || "Couldn't save clip", { type: "error" }); }
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
  location.hash = "#/library";
  setCrumbs([{ label: "Library" }]); setStats(""); $("#headerActions").innerHTML = ""; state.project = null;
  stopLibraryPlayback();
  main.innerHTML = `<div class="loading"><span class="spinner"></span> Loading library…</div>`;
  let tags = [], clips = [];
  try {
    const [tagData, clipData] = await Promise.all([
      fetch("/api/clips/tags").then((r) => r.json()),
      fetch("/api/clips").then((r) => r.json()),
    ]);
    tags = tagData.tags || []; clips = clipData.clips || [];
  } catch { main.innerHTML = `<div class="pad"><p class="empty">Couldn't reach the server.</p></div>`; return; }

  main.innerHTML = `
    <section class="pad">
      <div class="row-between">
        <div><h1>Library</h1><div class="sub">Every clip you've saved, across every project — the reusable building blocks for a video essay.</div></div>
        <button class="btn primary" id="discoverBtn">${ic("sparkle")} Discover clips across my library</button>
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
      <div class="tag-rail" id="tagRail"></div>
      <input id="librarySearch" class="import-input" placeholder="Search clips by title or description…" style="max-width:340px;margin:14px 0;" autocomplete="off" />
      <div class="library-grid" id="libraryGrid"></div>
      <div id="discoverResults"></div>
    </section>`;
  renderTagRail(tags);
  renderLibraryGrid(clips);
  $("#discoverBtn").onclick = (e) => runDiscover(e.currentTarget);
  $("#composeBtn").onclick = (e) => runCompose(e.currentTarget);
  $("#composeInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); runCompose($("#composeBtn")); }
  });
  let searchDebounce = null;
  $("#librarySearch").addEventListener("input", () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(reloadLibraryGrid, 300);
  });
  const player = $("#libPreviewPlayer");
  player.addEventListener("play", () => { player.style.display = "block"; });
}

function renderTagRail(tags) {
  const el = $("#tagRail"); if (!el) return;
  if (!tags.length) { el.innerHTML = ""; return; }
  el.innerHTML = tags.map((t) =>
    `<span class="tag-chip${state.libraryTag === t.tag ? " on" : ""}" data-tag="${esc(t.tag)}">${esc(t.tag)} <span class="tag-count">${t.count}</span></span>`,
  ).join("");
  el.querySelectorAll(".tag-chip").forEach((chip) => {
    chip.onclick = () => {
      state.libraryTag = state.libraryTag === chip.dataset.tag ? null : chip.dataset.tag;
      renderTagRail(tags);
      reloadLibraryGrid();
    };
  });
}

async function reloadLibraryGrid() {
  const params = new URLSearchParams();
  if (state.libraryTag) params.set("tag", state.libraryTag);
  const q = $("#librarySearch")?.value.trim();
  if (q) params.set("q", q);
  let clips = [];
  try { clips = (await fetch(`/api/clips?${params}`).then((r) => r.json())).clips || []; } catch { /* leave grid as-is */ }
  renderLibraryGrid(clips);
}

function renderLibraryGrid(clips) {
  const el = $("#libraryGrid"); if (!el) return;
  if (!clips.length) {
    el.innerHTML = `<p class="empty small">No clips saved yet — select text in a project's transcript and choose <b>Save to Library</b>, save a Suggested Edit, or run Discover above.</p>`;
    return;
  }
  el.innerHTML = clips.map((c, i) => clipCard(c, i)).join("");
  clips.forEach((c, i) => {
    const card = el.querySelector(`.clip-card[data-i="${i}"]`);
    card.querySelector(".clip-preview").onclick = () => previewClipSegments(c.segments);
    card.querySelector(".clip-add-project").onclick = () => addClipToProject(c);
    card.querySelector(".clip-delete").onclick = () => deleteLibraryClip(c.id);
    hydrateSegLabels(card, c.segments);
  });
}
function clipCard(c, i) {
  const segParts = c.segments.map((s, si) => `<span class="sg-seg" data-seg="${si}">${fmt(s.start)}</span>`).join(`<span class="sg-arrow">→</span>`);
  return `<div class="clip-card" data-i="${i}">
    <div class="sg-top"><span class="sg-type ${c.kind === "ai-detected" ? "theme" : "callback"}">${c.kind === "ai-detected" ? "AI-detected" : "Manual"}</span><span class="sg-title">${esc(c.title)}</span></div>
    ${c.description ? `<div class="sg-why">${esc(c.description)}</div>` : ""}
    <div class="sg-segs">${segParts}</div>
    ${c.tags.length ? `<div class="tag-rail small">${c.tags.map((t) => `<span class="tag-chip">${esc(t)}</span>`).join("")}</div>` : ""}
    <div class="s-actions">
      <button class="btn small ghost clip-preview">${ic("play")} Preview</button>
      <button class="btn small accent clip-add-project">${ic("plus")} Add to project</button>
      <button class="btn small danger clip-delete">Delete</button>
    </div>
  </div>`;
}
async function deleteLibraryClip(id) {
  if (!(await UI.confirm({ title: "Delete this clip?", message: "This removes it from the Library permanently — it doesn't affect the source video.", confirmText: "Delete", danger: true }))) return;
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
    <div class="s-actions"><button class="btn small ghost sg-preview">${ic("play")} Preview</button><button class="btn small accent sg-save">Save to Library</button></div>
  </div>`;
}

// ── boot ─────────────────────────────────────────────────────────────
$("#home").onclick = showProjects;
$("#home").onkeydown = (e) => { if (e.key === "Enter") showProjects(); };
$("#libraryNav").onclick = showLibrary;
function route() {
  if (location.hash === "#/library") return showLibrary();
  const m = location.hash.match(/^#\/p\/([\w-]+)/);
  if (m) openProject(m[1]); else showProjects();
}
window.addEventListener("hashchange", route);
route();
