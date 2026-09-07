/**
 * The client runtime, served at /app.js.
 *
 * Deliberately small: the design's interactions are simple enough that
 * hydration islands are plenty (07-CLAUDE-CODE-BRIEF.md §Stack). No framework.
 *
 * The keyboard map is from design/docs/10-ROUTES-AND-KEYS.md. Two rules from
 * that doc are load-bearing and easy to get wrong:
 *   1. Keyboard actions and their mouse equivalents must route through the
 *      SAME undo-wrapped handler, or ⌘Z reverts only half of them.
 *   2. Never bind keys while focus is in an input or textarea.
 */

export const CLIENT_JS = String.raw`
const $ = (s, r = document) => r.querySelector(s);

function inField(el) {
  if (!el) return false;
  const t = el.tagName;
  return t === "INPUT" || t === "TEXTAREA" || el.isContentEditable;
}

/* ── Toasts ───────────────────────────────────────────────────────────────
   Bottom centre, #1A1A1F, one line, an Undo action (02-DESIGN-SYSTEM).
   Nothing hard-deletes, so a destructive action always posts one of these. */
export function toast(message, onUndo) {
  const host = $("#toasts");
  if (!host) return;
  const el = document.createElement("div");
  el.style.cssText =
    "display:flex;align-items:center;gap:14px;background:#1A1A1F;color:#ECECF1;" +
    "font-size:12.5px;padding:11px 14px;border-radius:9px;" +
    "box-shadow:0 0 0 1px rgba(255,255,255,0.06), 0 12px 40px rgba(0,0,0,0.4);" +
    "animation:popIn .18s cubic-bezier(.2,.7,.3,1) both";
  const text = document.createElement("span");
  text.textContent = message;
  el.appendChild(text);
  if (onUndo) {
    const undo = document.createElement("span");
    undo.textContent = "Undo";
    undo.setAttribute("role", "button");
    undo.tabIndex = 0;
    undo.style.cssText = "cursor:pointer;font-weight:600;color:#D9B36A;white-space:nowrap";
    undo.onclick = () => { onUndo(); el.remove(); };
    el.appendChild(undo);
  }
  host.appendChild(el);
  setTimeout(() => el.remove(), 6000);
}
window.toast = toast;

/* ── Undo stack ───────────────────────────────────────────────────────────
   Every mutation goes through here so ⌘Z reverts all of them, not half. */
const undoStack = [];
window.doUndoable = function (label, apply, revert) {
  apply();
  undoStack.push(revert);
  toast(label, () => { const r = undoStack.pop(); if (r) r(); });
};

/* Put it back, from Settings' deleted pile. */
document.querySelectorAll(".trash-restore").forEach((btn) => {
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      const res = await fetch("/api/" + btn.getAttribute("data-kind") + "/" + btn.getAttribute("data-id") + "/restore", { method: "POST" });
      if (!res.ok) throw new Error("That didn't restore");
      location.reload();
    } catch (err) {
      btn.disabled = false;
      toast((err && err.message) || "That didn't restore");
    }
  });
});

/* Your name, saved on blur. No Save button, same as everything else here. */
const acctName = document.querySelector("#acctName");
if (acctName) {
  let last = acctName.value;
  const save = async () => {
    const name = acctName.value.trim();
    if (name === last.trim()) return;
    last = name;
    try {
      const res = await fetch("/api/account/name", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error("That didn't save");
      toast(name ? "Saved" : "Name cleared");
    } catch (err) {
      toast((err && err.message) || "That didn't save");
    }
  };
  acctName.addEventListener("blur", save);
  acctName.addEventListener("keydown", (e) => { if (e.key === "Enter") acctName.blur(); });
}

/* Closing the account. It asks for the address rather than for a click: this
   takes everything and there is no bin behind it. */
const closeAccountBtn = document.querySelector("#closeAccount");
if (closeAccountBtn) {
  closeAccountBtn.addEventListener("click", async () => {
    const email = closeAccountBtn.getAttribute("data-email") || "";
    const typed = prompt("This removes every video, edit and export, permanently.\n\nType " + email + " to confirm.");
    if (typed === null) return;
    closeAccountBtn.disabled = true;
    try {
      const res = await fetch("/api/account/close", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: typed }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || "That didn't work");
      location.href = "/";
    } catch (err) {
      closeAccountBtn.disabled = false;
      toast((err && err.message) || "That didn't work");
    }
  });
}

/* Empty the bin. The whole point of a bin, and it could only be emptied one
   item at a time. Irreversible, so it asks — and it says what it will free. */
const emptyBin = document.querySelector("#empty-bin");
if (emptyBin) {
  emptyBin.addEventListener("click", async () => {
    const n = document.querySelectorAll(".trash-purge").length;
    if (!confirm("Delete " + n + " item" + (n === 1 ? "" : "s") + " for good? This frees the storage and cannot be undone.")) return;
    emptyBin.disabled = true;
    emptyBin.textContent = "Emptying…";
    try {
      const res = await fetch("/api/trash/empty", { method: "POST" });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || "That didn't empty");
      const mb = Math.round((out.freedBytes || 0) / 1e6);
      toast(mb > 0 ? out.removed + " deleted — " + mb + " MB freed" : out.removed + " deleted");
      setTimeout(() => location.reload(), 900);
    } catch (err) {
      emptyBin.disabled = false;
      emptyBin.textContent = "Empty the bin";
      toast((err && err.message) || "That didn't empty");
    }
  });
}

/* Delete for good. The one irreversible action in the product, so it is the
   one place a confirm is right — everywhere else a dialog would be theatre
   in front of something Undo already covers. */
document.querySelectorAll(".trash-purge").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const label = btn.getAttribute("data-label") || "this";
    if (!confirm("Delete " + label + " for good? This frees the storage and cannot be undone.")) return;
    btn.disabled = true;
    try {
      const res = await fetch("/api/" + btn.getAttribute("data-kind") + "/" + btn.getAttribute("data-id") + "/purge", { method: "POST" });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || "That didn't delete");
      const mb = Math.round((out.freedBytes || 0) / 1e6);
      toast(mb > 0 ? label + " deleted — " + mb + " MB freed" : label + " deleted");
      const row = btn.closest("[data-item-row]");
      if (row) row.remove();
    } catch (err) {
      btn.disabled = false;
      toast((err && err.message) || "That didn't delete");
    }
  });
});

/* ── Selecting several ────────────────────────────────────────────────
   Every list could only act on one row, which is fine until the product has
   made a mess and you have to clear it up an item at a time. */
const selBar = document.querySelector("#sel-bar");
if (selBar) {
  const boxes = [...document.querySelectorAll(".sel-item")];
  const count = document.querySelector("#sel-count");
  const noun = selBar.getAttribute("data-noun") || "item";

  const chosen = () => boxes.filter((b) => b.checked);

  const refresh = () => {
    const n = chosen().length;
    selBar.hidden = n === 0;
    if (count) count.textContent = n + " " + noun + (n === 1 ? "" : "s") + " selected";
  };

  boxes.forEach((b) => b.addEventListener("change", refresh));

  document.querySelector("#sel-clear").addEventListener("click", () => {
    boxes.forEach((b) => { b.checked = false; });
    refresh();
  });

  document.querySelector("#sel-delete").addEventListener("click", async () => {
    const picked = chosen();
    if (!picked.length) return;
    const btn = document.querySelector("#sel-delete");
    btn.disabled = true;
    btn.textContent = "Deleting…";

    /* One request each, against the route a single delete already uses — a
       bulk endpoint would be a second way to delete things, and the second way
       is always the one that misses a rule the first one enforces. */
    const done = [];
    for (const box of picked) {
      const kind = box.getAttribute("data-kind");
      const id = box.getAttribute("data-id");
      try {
        const res = await fetch("/api/" + kind + "/" + id + "/delete", { method: "POST" });
        if (res.ok) {
          done.push({ kind, id });
          const row = box.closest("[data-item-row]");
          if (row) row.remove();
        }
      } catch (err) {
        /* Keep going: one failure should not strand the rest of the batch. */
      }
    }

    btn.disabled = false;
    btn.textContent = "Delete";
    refresh();

    if (!done.length) { toast("Nothing was deleted"); return; }

    /* Undo puts back everything the batch took, in one gesture — the same
       promise a single delete makes. */
    toast(done.length + " " + noun + (done.length === 1 ? "" : "s") + " deleted", async () => {
      for (const d of done) {
        await fetch("/api/" + d.kind + "/" + d.id + "/restore", { method: "POST" }).catch(() => {});
      }
      location.reload();
    });
  });

  refresh();
}

/* ── Rename and delete ─────────────────────────────────────────────────
   The verbs every platform has and this one had none of. Projects rendered
   "Branch a version" and "Archive" as <span> elements — decoration shaped
   like controls — and nothing anywhere could rename or remove an edit, so
   four accidental edits of one video were permanent. */

/** Close every open item menu. One at a time, like every menu anywhere. */
function closeItemMenus(except) {
  document.querySelectorAll(".item-menu-pop").forEach((el) => {
    if (el !== except) el.hidden = true;
  });
}
document.addEventListener("click", (e) => {
  if (!e.target.closest(".item-menu")) closeItemMenus(null);
});

document.querySelectorAll(".item-menu").forEach((menu) => {
  const pop = menu.querySelector(".item-menu-pop");
  const kind = menu.getAttribute("data-kind");
  const id = menu.getAttribute("data-id");
  const noun = menu.getAttribute("data-noun") || "item";

  menu.querySelector(".item-menu-open").addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const opening = pop.hidden;
    closeItemMenus(pop);
    pop.hidden = !opening;
  });

  menu.querySelector(".item-rename").addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    pop.hidden = true;
    const current = menu.getAttribute("data-title") || "";
    const next = prompt("Name this " + noun, current);
    /* null is cancel; an unchanged name is not a change worth a request. */
    if (next === null || next.trim() === current.trim()) return;
    if (!next.trim()) { toast("Give it a name"); return; }
    try {
      const res = await fetch("/api/" + kind + "/" + id + "/rename", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: next }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) || {}).error || "That didn't save");
      location.reload();
    } catch (err) {
      toast((err && err.message) || "That didn't save");
    }
  });

  /* Duplicate. Only edits have one, so the button may not be there. */
  const dupBtn = menu.querySelector(".item-duplicate");
  if (dupBtn) {
    dupBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      pop.hidden = true;
      try {
        const res = await fetch("/api/projects/" + id + "/duplicate", { method: "POST" });
        const out = await res.json().catch(() => ({}));
        if (!res.ok || !out.href) throw new Error(out.error || "That didn't copy");
        /* Straight into the copy: the reason you duplicated is to work on it. */
        location.href = out.href;
      } catch (err) {
        toast((err && err.message) || "That didn't copy");
      }
    });
  }

  menu.querySelector(".item-delete").addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    pop.hidden = true;
    try {
      const res = await fetch("/api/" + kind + "/" + id + "/delete", { method: "POST" });
      if (!res.ok) throw new Error("That didn't delete");
      const { label } = await res.json();

      /* Undo instead of a confirm dialog. The delete is reversible, so asking
         "are you sure" first would train people to click through dialogs; the
         honest thing is to do it and offer the way back. */
      toast((label || "That " + noun) + " deleted", async () => {
        await fetch("/api/" + kind + "/" + id + "/restore", { method: "POST" });
        location.reload();
      });

      /* Take the row off the page rather than reloading — the reload would
         throw away the toast that undoes it. */
      const row = menu.closest("[data-item-row]") || menu.parentElement;
      if (row) row.remove();
    } catch (err) {
      toast((err && err.message) || "That didn't delete");
    }
  });
});

/*
 * Draw a moment of a video onto a canvas.
 *
 * Per-moment stills are not extracted anywhere on the server — a clip's
 * frame_r2_key is the SOURCE's poster — so every clip from one video wore the
 * same image, and when that video opens on black (both of the owner's do)
 * every card was a black rectangle. A hidden video is seeked to each moment in
 * turn and drawn to its canvas.
 *
 * This was the editor's, for block rows. Clipping needed exactly the same
 * thing for short cards, and the subtle parts — one decode at a time, only for
 * what is on screen, a timeout so one unseekable moment cannot wedge the
 * queue, silence on failure — are not worth having two of.
 *
 * Each canvas carries data-at (milliseconds). data-media names its own file;
 * without one it uses defaultSrc, which is how the editor works since all its
 * blocks come from the same source. Returns a function that takes on canvases
 * that arrive later.
 */
/*
 * The player, driven from the video rather than by it.
 *
 * Everything here reads video.currentTime and writes to it; nothing keeps a
 * second idea of where the video is. That is what lets the transcript, the
 * per-block play buttons and this bar all agree without knowing about each
 * other — and it is why replacing the browser's controls changed nothing
 * about the editing gestures.
 *
 * A ROOT rather than the page's only player: Clipping puts one of these on
 * every card. Every part is optional, so a card can carry a compact bar —
 * play, scrub, position, fullscreen — without a duration or a speed control it
 * has no room for.
 */
function wirePlayer(root, video) {
  const playBtn = root.querySelector(".pl-play");
  const iPlay = root.querySelector(".pl-i-play");
  const iPause = root.querySelector(".pl-i-pause");
  const track = root.querySelector(".pl-track");
  const played = root.querySelector(".pl-played");
  const buffered = root.querySelector(".pl-buffer");
  const knob = root.querySelector(".pl-knob");
  const nowEl = root.querySelector(".pl-now");
  const durEl = root.querySelector(".pl-dur");
  const rateBtn = root.querySelector(".pl-rate");
  const fullBtn = root.querySelector(".pl-full");

  const secs = (n) => {
    const t = Math.max(0, Math.floor(n || 0));
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
    return h > 0
      ? h + ":" + String(m).padStart(2, "0") + ":" + String(sec).padStart(2, "0")
      : m + ":" + String(sec).padStart(2, "0");
  };

  const paintFace = () => {
    const playing = !video.paused && !video.ended;
    if (iPlay) iPlay.hidden = playing;
    if (iPause) iPause.hidden = !playing;
    if (playBtn) playBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
  };

  const paintBar = () => {
    const dur = video.duration;
    if (!Number.isFinite(dur) || dur <= 0) return;
    const pct = Math.min(100, Math.max(0, (video.currentTime / dur) * 100));
    if (played) played.style.width = pct + "%";
    if (knob) knob.style.left = pct + "%";
    if (track) track.setAttribute("aria-valuenow", String(Math.round(pct)));
    if (nowEl) nowEl.textContent = secs(video.currentTime);

    /* The buffered range that covers the playhead — not range zero, which on
       a seeked file is whatever was loaded first and usually somewhere
       else entirely. */
    if (!buffered) return;
    let end = 0;
    for (let i = 0; i < video.buffered.length; i++) {
      if (video.buffered.start(i) <= video.currentTime && video.buffered.end(i) >= video.currentTime) {
        end = video.buffered.end(i);
      }
    }
    buffered.style.width = Math.min(100, (end / dur) * 100) + "%";
  };

  const paintDuration = () => {
    if (durEl && Number.isFinite(video.duration)) durEl.textContent = secs(video.duration);
    paintBar();
  };

  playBtn?.addEventListener("click", async () => {
    if (!video.paused) return void video.pause();
    try {
      await video.play();
    } catch (err) {
      /* Autoplay policy, usually. A press is a gesture, so this is rare. */
      return void toast("That won't play here.");
    }
    /*
     * A clip can point past the end of its own file — a source replaced, or
     * bounds written before trimming clamped them — and then play() resolves,
     * nothing happens, and the button looks broken. Say so rather than sit
     * there: silence is the thing this codebase keeps getting wrong.
     */
    setTimeout(() => {
      if (video.paused && !video.ended) {
        toast(video.error ? "That video wouldn't load." : "There's nothing at that point in the video.");
      }
    }, 700);
  });

  video.addEventListener("play", paintFace);
  video.addEventListener("pause", paintFace);
  video.addEventListener("ended", paintFace);
  video.addEventListener("timeupdate", paintBar);
  video.addEventListener("progress", paintBar);
  video.addEventListener("loadedmetadata", paintDuration);
  if (Number.isFinite(video.duration)) paintDuration();
  paintFace();

  /*
   * Scrubbing, with a pointer capture.
   *
   * Without the capture, dragging past the edge of the bar drops the drag
   * where it landed and leaves the playhead wherever it happened to be —
   * which on a narrow bar is most drags.
   */
  const seekTo = (clientX) => {
    const dur = video.duration;
    if (!Number.isFinite(dur) || dur <= 0) return;
    const r = track.getBoundingClientRect();
    const at = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    video.currentTime = at * dur;
    paintBar();
  };

  let dragging = false;
  track?.addEventListener("pointerdown", (e) => {
    dragging = true;
    track.setPointerCapture(e.pointerId);
    seekTo(e.clientX);
  });
  track?.addEventListener("pointermove", (e) => { if (dragging) seekTo(e.clientX); });
  track?.addEventListener("pointerup", (e) => {
    dragging = false;
    try { track.releasePointerCapture(e.pointerId); } catch (err) { /* already gone */ }
  });
  track?.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") { e.preventDefault(); video.currentTime = Math.max(0, video.currentTime - 5); }
    else if (e.key === "ArrowRight") { e.preventDefault(); video.currentTime = video.currentTime + 5; }
  });

  /* Speed, because reviewing an hour of footage at 1x is most of the hour.
     A cycle rather than a menu: four values is not a list worth opening. */
  const RATES = [1, 1.25, 1.5, 2, 0.5];
  let rateAt = 0;
  rateBtn?.addEventListener("click", () => {
    rateAt = (rateAt + 1) % RATES.length;
    video.playbackRate = RATES[rateAt];
    const span = rateBtn.querySelector("span");
    if (span) span.textContent = RATES[rateAt] + "\u00D7";
  });

  fullBtn?.addEventListener("click", () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else if (video.requestFullscreen) void video.requestFullscreen().catch(() => {});
  });
}

function paintMoments(canvases, defaultSrc) {
  const list = [...canvases];
  if (!list.length) return () => {};

  /* Same origin, so the canvas is never tainted. Setting crossOrigin would
     force a CORS preflight that can only turn a working load into a failure. */
  const decoders = new Map();
  const decoderFor = (src) => {
    let d = decoders.get(src);
    if (d) return d;
    const v = document.createElement("video");
    v.src = src;
    v.muted = true;
    v.playsInline = true;
    v.preload = "metadata";
    /* Seeking a video that has no metadata yet does nothing, so every frame
       would sit out its four-second timeout and give up. The editor's version
       waited for loadedmetadata before it started observing at all; here each
       decoder carries its own wait, because a page can be drawing moments out
       of several different files. */
    d = {
      video: v,
      ready: new Promise((resolve) => {
        if (v.readyState >= 1) return resolve();
        v.addEventListener("loadedmetadata", () => resolve(), { once: true });
        v.addEventListener("error", () => resolve(), { once: true });
        setTimeout(resolve, 8000);
      }),
    };
    v.load();
    decoders.set(src, d);
    return d;
  };

  const queue = [];
  let running = false;

  const drain = async () => {
    if (running || !queue.length) return;
    running = true;
    while (queue.length) {
      const canvas = queue.shift();
      const src = canvas.getAttribute("data-media")
        ? "/media/" + canvas.getAttribute("data-media")
        : defaultSrc;
      if (!src) continue;
      const at = Number(canvas.getAttribute("data-at") || 0) / 1000;
      const decoder = decoderFor(src);
      await decoder.ready;
      const shot = decoder.video;
      try {
        await new Promise((resolve, reject) => {
          const done = () => { cleanup(); resolve(); };
          const fail = () => { cleanup(); reject(new Error("seek")); };
          const cleanup = () => {
            shot.removeEventListener("seeked", done);
            shot.removeEventListener("error", fail);
            clearTimeout(timer);
          };
          /* A moment that will not seek must not stall the queue behind it for
             ever; the rest of the rows still deserve their frames. */
          const timer = setTimeout(fail, 4000);
          shot.addEventListener("seeked", done, { once: true });
          shot.addEventListener("error", fail, { once: true });
          shot.currentTime = at;
        });
        drawCover(canvas, shot);
        canvas.dataset.painted = "1";
      } catch (err) {
        /* No frame for this one. Every card is still complete without it. */
      }
    }
    running = false;
  };

  const watch = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting || e.target.dataset.painted === "1" || e.target.dataset.queued === "1") continue;
      e.target.dataset.queued = "1";
      queue.push(e.target);
    }
    void drain();
  }, { rootMargin: "300px" });

  /* More rows arrive as you scroll a long transcript; they have to be taken on
     by the same observer and the same one-at-a-time queue, or a long source
     would either paint nothing after the first window or start a second video
     decoding in parallel with this one. */
  const observe = (els) => [...els].forEach((c) => watch.observe(c));
  observe(list);
  return observe;
}

/* ── The editor ────────────────────────────────────────────────────────
   One surface, five gestures: strike a line, strike a word inside it, move a
   block, insert one, export. They were spread across four stages that felt
   like the same stage — see docs/decisions/blocks.md. */
const blocksEl = document.querySelector("#blocks");
if (blocksEl) {
  const projectId = blocksEl.getAttribute("data-project");
  /* Which footage this cut is made from, so the clip picker can leave it out:
     a moment from THIS video is already a block and only wants moving. */
  const sourceId = blocksEl.getAttribute("data-source");
  const video = document.querySelector("#cut-video");
  const footRuntime = document.querySelector("#cut-runtime");
  const headRuntime = document.querySelector("#head-runtime");
  const headKept = document.querySelector("#head-kept");

  /*
   * Paint each block its own frame.
   *
   * Per-block stills are not extracted anywhere — a clip points at the
   * source's own poster — so a server-rendered thumbnail would put the SAME
   * image on all 24 rows, which is worse than none. A second, hidden video on
   * the same source is seeked to each block in turn and drawn to its canvas.
   *
   * Same origin, so the canvas is never tainted. One at a time and only for
   * rows that come into view: 24 simultaneous seeks on a 4K source is a way to
   * lock the tab. Every failure is silent by design — the badge and the
   * timecode are already on the button, so a row with no frame is still a
   * complete, legible control.
   */
  /* Assigned by paintFrames and by the word indexer, and called whenever a new
     window of blocks is appended. Empty until then, so the loader can call
     them unconditionally. */
  /* Takes on canvases that arrive with a later window of blocks. Empty until
     paintMoments has run, so the loader can call it unconditionally. */
  let observeFrames = () => {};
  let reindexWords = () => {};

  /* The editor's blocks all come out of one file, so its canvases carry only
     a time and the source is passed in. */
  observeFrames = paintMoments(blocksEl.querySelectorAll(".blk-frame"), video?.getAttribute("src") || "");

  /*
   * The word being spoken lights up, and a selection can be cut.
   *
   * These are the two gestures that make editing by text worth doing, and the
   * reason the owner wants this at all: "i like editing via text". Neither
   * existed — you could click one word at a time and nothing on the page ever
   * told you where the video was in the transcript.
   */
  if (blocksEl.querySelector(".w") && video) {
    /* Sorted, and REBUILT whenever more blocks arrive — a long transcript is
       loaded a window at a time, and an index captured once would leave the
       highlight and the selection counter blind to everything after the first
       screenful. A pointer walks it rather than searching every frame, because
       timeupdate fires several times a second and 35,000 words rescanned each
       time is a page that stutters while it plays. */
    let timed = [];
    const indexWords = () => {
      timed = [...blocksEl.querySelectorAll(".w")]
        .map((el) => ({ el, s: Number(el.getAttribute("data-s")), e: Number(el.getAttribute("data-e")) }))
        .filter((w) => Number.isFinite(w.s) && Number.isFinite(w.e))
        .sort((a, b) => a.s - b.s);
      cursor = 0;
    };

    let lit = null;
    let cursor = 0;
    indexWords();
    reindexWords = indexWords;

    /*
     * The transcript FOLLOWS the video.
     *
     * The highlight was painted and never scrolled to, so fifteen seconds into
     * playback the lit word was off screen and stayed there for the rest of
     * the video. This is the difference between an editor and a document with
     * a video stuck to it.
     *
     * With the rule every follow-along needs: the moment you scroll yourself,
     * following stops, because a page that scrolls back while you are reading
     * somewhere else is a page you are fighting. The control says which it is
     * doing and puts it back.
     */
    let following = true;
    let selfScrolled = 0;

    /*
     * The way back to the playhead, offered only when there IS one.
     *
     * "what is this follow along button?" — a fair question, because it
     * appeared on any scroll whether or not anything was playing. On a paused
     * page, which is most of the time, scrolling summoned an unexplained
     * button into the dead space below the export bar. It now exists only
     * while the video is running, which is the only moment following means
     * anything, and it says what pressing it does rather than naming a mode.
     */
    const followBtn = document.createElement("button");
    followBtn.type = "button";
    followBtn.hidden = true;
    followBtn.textContent = "Back to what's playing";
    followBtn.style.cssText =
      "position:fixed;z-index:56;left:50%;transform:translateX(-50%);bottom:96px;font-size:12px;font-weight:600;" +
      "padding:8px 15px;border-radius:5px;background:#ECECF1;color:#131316;border:none;cursor:pointer;" +
      "white-space:nowrap;box-shadow:0 8px 24px rgba(0,0,0,.5)";
    followBtn.addEventListener("click", () => {
      following = true;
      followBtn.hidden = true;
      lit = null;
      light();
    });
    document.body.appendChild(followBtn);

    /* Nothing to follow when nothing is playing, so the offer goes away with
       the playhead — including when the video simply reaches its end. */
    const stopOffering = () => { followBtn.hidden = true; };
    video.addEventListener("pause", stopOffering);
    video.addEventListener("ended", stopOffering);

    window.addEventListener(
      "scroll",
      () => {
        /* Our own scrollIntoView fires this event too. Anything within a beat
           of a scroll we asked for is ours, not the reader's. */
        if (Date.now() - selfScrolled < 700) return;
        if (!following) return;
        following = false;
        /* Scrolling a paused page is just reading. It is not a decision to
           stop following something that is not moving. */
        if (!video.paused && !video.ended) followBtn.hidden = false;
      },
      { passive: true },
    );


    const light = () => {
      const ms = video.currentTime * 1000;
      /* Walk from where we were: forward while behind, back if the user
         seeked. Both directions, or scrubbing backwards leaves it stuck. */
      while (cursor > 0 && timed[cursor].s > ms) cursor--;
      while (cursor < timed.length - 1 && timed[cursor + 1].s <= ms) cursor++;

      const w = timed[cursor];
      const on = w && ms >= w.s - 60 && ms <= w.e + 120 ? w.el : null;
      if (on === lit) return;
      if (lit) { lit.style.background = ""; lit.style.color = lit.dataset.cut === "1" ? "rgba(236,236,241,0.28)" : ""; }
      if (on && on.dataset.cut !== "1") {
        on.style.background = "rgba(94,201,143,0.16)";
        on.style.color = "#5EC98F";
      }
      lit = on;

      /* Only while it is actually playing. Scrubbing to look at something is
         not a request to be moved somewhere else, and neither is a paused
         video sitting on a word. */
      if (on && following && !video.paused) {
        selfScrolled = Date.now();
        on.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    };
    video.addEventListener("timeupdate", light);
    video.addEventListener("seeked", light);

    /* A seek you asked for is a place you want to be, so following resumes —
       clicking a word to jump there and then not being taken there is the
       gesture failing. */
    video.addEventListener("seeking", () => {
      following = true;
      followBtn.hidden = true;
    });

    /*
     * Select words, cut them.
     *
     * A native selection is used rather than a custom one, so double-click to
     * take a word and drag to take a phrase both come for free, on touch as
     * well as with a mouse. The action floats at the selection instead of
     * living on a keyboard shortcut, which is the only way it is findable.
     */
    const action = document.createElement("button");
    action.type = "button";
    action.hidden = true;
    action.style.cssText =
      "position:absolute;z-index:20;font-size:12px;font-weight:600;padding:6px 12px;border-radius:5px;" +
      "background:#ECECF1;color:#131316;border:none;cursor:pointer;white-space:nowrap;box-shadow:0 6px 18px rgba(0,0,0,.45)";
    document.body.appendChild(action);

    /* Which words the selection actually covers, grouped into one run per
       line — the server takes runs, because cuts are per-segment ranges. */
    const selected = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
      const range = sel.getRangeAt(0);
      const hit = timed.filter((w) => w.el.dataset.cut !== "1" && range.intersectsNode(w.el));
      if (!hit.length) return null;

      const byBlock = new Map();
      for (const w of hit) {
        const block = w.el.getAttribute("data-block");
        /* Only footage blocks carry segment indices; an inserted block has a
           ULID and no words, so it can never be in here. */
        if (!block.startsWith("s:")) continue;
        const seg = Number(block.slice(2));
        const idx = Number(w.el.getAttribute("data-word"));
        const run = byBlock.get(seg);
        if (run) { run.from = Math.min(run.from, idx); run.to = Math.max(run.to, idx); }
        else byBlock.set(seg, { seg, from: idx, to: idx });
      }
      const ranges = [...byBlock.values()];
      if (!ranges.length) return null;

      const ms = hit.reduce((n, w) => n + Math.max(0, w.e - w.s), 0);
      return { ranges, count: hit.length, ms, rect: range.getBoundingClientRect() };
    };

    let pending = null;

    const place = () => {
      pending = selected();
      if (!pending) { action.hidden = true; return; }
      /* The count and the saving are both real — the same rule the clean-up
         chips follow. */
      action.textContent =
        "Cut " + pending.count + " word" + (pending.count === 1 ? "" : "s") + " · −" + clock(pending.ms);
      action.hidden = false;
      const r = pending.rect;
      action.style.top = window.scrollY + r.top - 38 + "px";
      action.style.left = Math.max(8, window.scrollX + r.left + r.width / 2 - action.offsetWidth / 2) + "px";
    };

    document.addEventListener("selectionchange", () => {
      /* Debounced to the next frame: selectionchange fires per character as
         you drag, and measuring the selection each time is wasted work. */
      requestAnimationFrame(place);
    });

    action.addEventListener("mousedown", (e) => e.preventDefault());

    /* Backspace does what the floating button does. Published rather than
       duplicated, so the key and the button can never cut differently. */
    window.cutSelection = () => {
      place();
      if (pending) action.click();
    };

    action.addEventListener("click", async () => {
      if (!pending) return;
      const { ranges } = pending;
      action.hidden = true;
      try {
        const out = await sendCut({ kind: "range", ranges });
        /* Repaint exactly the words that were cut, rather than reloading and
           throwing away the scroll position mid-edit. */
        for (const r of ranges) {
          for (const w of timed) {
            if (w.el.getAttribute("data-block") !== "s:" + r.seg) continue;
            const i = Number(w.el.getAttribute("data-word"));
            if (i < r.from || i > r.to) continue;
            w.el.dataset.cut = "1";
            w.el.style.textDecoration = "line-through";
            w.el.style.color = "rgba(236,236,241,0.28)";
            w.el.style.background = "";
          }
        }
        window.getSelection()?.removeAllRanges();
        retotal(out.afterS, out.kept);
        undoable("Cut " + pending.count + " word" + (pending.count === 1 ? "" : "s"), out.before);
      } catch (err) {
        toast((err && err.message) || "That didn't save");
      }
    });
  }

  const clock = (ms) => {
    const s2 = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(s2 / 3600), m = Math.floor((s2 % 3600) / 60), sec = s2 % 60;
    return h > 0
      ? h + ":" + String(m).padStart(2, "0") + ":" + String(sec).padStart(2, "0")
      : m + ":" + String(sec).padStart(2, "0");
  };

  /* Optimistic, from the blocks on screen; corrected by the server's own
     figure when a cut comes back, because a line can carry word-level strikes
     this sum does not know about. */
  /*
   * The kept count is the WHOLE cut's, not the window's.
   *
   * This counted .blk elements in the DOM, which was the whole transcript
   * until long sources started loading a window at a time — then striking one
   * line on a three-hour podcast reported "479 kept" instead of "2699",
   * because 479 was simply how far the reader had scrolled.
   *
   * The server's own figure is authoritative and comes back with every cut;
   * the local step is optimistic and gets corrected a moment later.
   */
  let keptTotal = Number((headKept?.textContent || "").replace(/[^0-9]/g, "")) || 0;

  const retotal = (afterS, keptFromServer) => {
    if (typeof keptFromServer === "number") keptTotal = keptFromServer;
    const ms = typeof afterS === "number"
      ? afterS * 1000
      : [...blocksEl.querySelectorAll(".blk")]
          .filter((el) => el.dataset.struck !== "1")
          .reduce((n, el) => n + Number(el.getAttribute("data-ms") || 0), 0);
    if (footRuntime) footRuntime.textContent = keptTotal + " kept · " + clock(ms);
    if (headRuntime) headRuntime.textContent = clock(ms);
    if (headKept) headKept.textContent = keptTotal + " kept";
  };

  const paintBlock = (el, struck) => {
    el.dataset.struck = struck ? "1" : "0";
    el.style.opacity = struck ? ".5" : "";
    el.querySelectorAll(".w").forEach((w) => {
      /* A struck LINE strikes every word visually, but must not overwrite a
         word's own state — putting the line back has to restore exactly what
         was struck inside it. */
      if (struck) { w.style.textDecoration = "line-through"; w.style.color = "rgba(236,236,241,0.28)"; }
      else if (w.dataset.cut !== "1") { w.style.textDecoration = ""; w.style.color = ""; }
    });
    const text = el.querySelector("[data-content]");
    if (text) text.style.textDecoration = struck ? "line-through" : "";
    const pill = el.querySelector(".seg-pill");
    if (pill) {
      pill.textContent = struck ? "Add back" : "Cut";
      pill.setAttribute("data-kept", struck ? "0" : "1");
    }
  };

  /*
   * Undo, for the gestures that change the cut.
   *
   * doUndoable has existed since the first delete shipped and the editor never
   * called it once — striking a word, cutting a phrase across three lines,
   * moving a block and taking out every "um" were all irreversible except by
   * doing the inverse by hand. On a product whose pitch is editing by text
   * that is the gap you notice first.
   *
   * A SNAPSHOT rather than an inverse per gesture: each mutation hands back
   * the cuts and order it replaced, and Undo posts them straight back. An
   * inverse per gesture is how an undo stack drifts out of step with the thing
   * it is undoing, and this one covers gestures not written yet.
   */
  /*
   * An Undo that survives a reload.
   *
   * Moving a block and running a clean-up both reload — one reorders the
   * whole list, the other restrikes words all over the transcript, and
   * repainting either by hand is how the page and the server drift. A toast
   * does not survive that, so the snapshot is parked and picked up here, once.
   */
  const parked = sessionStorage.getItem("undo:" + projectId);
  if (parked) {
    sessionStorage.removeItem("undo:" + projectId);
    try {
      const { label, before } = JSON.parse(parked);
      setTimeout(() => undoable(label, before), 0);
    } catch {
      /* A snapshot we cannot read is one we cannot honour; say nothing rather
         than offer an Undo that would do something unpredictable. */
    }
  }

  const undoable = (label, before) => {
    if (!before) return;
    window.doUndoable(label, () => {}, async () => {
      try {
        const res = await fetch("/api/projects/" + projectId + "/restore", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(before),
        });
        if (!res.ok) throw new Error("Couldn't undo that");
        location.reload();
      } catch (err) {
        toast((err && err.message) || "Couldn't undo that");
      }
    });
  };

  const sendCut = async (payload) => {
    const res = await fetch("/api/projects/" + projectId + "/cuts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("That didn't save");
    return await res.json().catch(() => ({}));
  };

  /* The line an inserted block says, saved when you look away rather than on
     every keystroke — a request per character is not an autosave, it is a
     flood. Focus is never stolen and nothing reloads, so you can write, tab
     to Record it, and speak. */
  blocksEl.addEventListener(
    "blur",
    async (e) => {
      const field = e.target.closest?.(".blk-text");
      if (!field) return;
      const next = field.value.trim();
      if (next === (field.dataset.saved ?? field.defaultValue.trim())) return;
      try {
        const res = await fetch("/api/beats/" + field.getAttribute("data-beat") + "/text", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: next }),
        });
        if (!res.ok) throw new Error("That didn't save");
        field.dataset.saved = next;
      } catch (err) {
        toast((err && err.message) || "That didn't save");
      }
    },
    true,
  );

  /*
   * More of a long transcript, as you reach it.
   *
   * A three-hour podcast is 2,700 blocks and 35,100 word spans — 13.2 MB in
   * one response, with a canvas each queued for a video seek. The server sends
   * a window and this fetches the next one just before you get there.
   *
   * The HTML comes from the server, rendered by the same blockRow the first
   * window used, so there is no second copy of a block's markup here to drift
   * from it. Every gesture is delegated on #blocks, so appended rows are live
   * with nothing to re-bind — only the two things that keep their own index of
   * the words and canvases need telling.
   */
  const loadMore = async (until) => {
    const sentinel = blocksEl.querySelector("#more-blocks");
    if (!sentinel || sentinel.dataset.busy === "1") return;
    sentinel.dataset.busy = "1";
    try {
      /* until is a jump: find a word two thousand blocks in and asking for
         120 at a time is seventeen round trips before the line is readable.
         The server caps the span, so this is a hint and not a demand. */
      const res = await fetch(
        "/api/projects/" + projectId + "/blocks?from=" + sentinel.getAttribute("data-from") +
          (until ? "&to=" + until : ""),
      );
      if (!res.ok) throw new Error("Couldn't load the rest");
      const out = await res.json();
      sentinel.insertAdjacentHTML("beforebegin", out.html);

      if (out.more) {
        sentinel.setAttribute("data-from", String(out.to));
        const left = out.total - out.to;
        const label = sentinel.querySelector("span");
        if (label) label.textContent = left + " more line" + (left === 1 ? "" : "s");
        sentinel.dataset.busy = "0";
      } else {
        sentinel.remove();
      }

      reindexWords();
      observeFrames(blocksEl.querySelectorAll(".blk-frame"));
    } catch (err) {
      sentinel.dataset.busy = "0";
      toast((err && err.message) || "Couldn't load the rest");
    }
  };

  if (blocksEl.querySelector("#more-blocks")) {
    /* A long rootMargin so the next window is already on its way by the time
       the end of this one is on screen — the scroll should not stop. */
    const nearEnd = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) void loadMore(); },
      { rootMargin: "1200px" },
    );
    nearEnd.observe(blocksEl.querySelector("#more-blocks"));
  }

  blocksEl.addEventListener("click", async (e) => {
    /* Typing in a block, scrubbing its take, or using the live recorder is not
       clicking the row. Without this the delegation below treats all three as
       a press on the block itself. */
    if (e.target.closest(".blk-text, .rec-live, audio")) return;
    const word = e.target.closest(".w");
    const strike = e.target.closest(".blk-strike");
    const short = e.target.closest(".blk-short");
    const rec = e.target.closest(".blk-record");
    const unrec = e.target.closest(".blk-unrecord");
    const tts = e.target.closest(".blk-tts");
    const move = e.target.closest(".blk-move");
    const play = e.target.closest(".blk-play");
    const insert = e.target.closest(".blk-insert");
    const seamOpen = e.target.closest(".seam-open");
    const seamClose = e.target.closest(".seam-close");
    const row = e.target.closest(".blk");

    /* Give this block your voice. record() handles the whole take and only
       touches the server once you stop, so an abandoned one costs nothing. */
    if (rec) { void record(rec); return; }

    /* Throw a take away, so a block can go back to empty rather than only
       ever being recorded over. */
    if (unrec) {
      unrec.disabled = true;
      try {
        const res = await fetch("/api/beats/" + unrec.closest(".blk-rec").getAttribute("data-beat") + "/unrecord", { method: "POST" });
        if (!res.ok) throw new Error("Couldn't remove that");
        location.reload();
      } catch (err) {
        unrec.disabled = false;
        toast((err && err.message) || "Couldn't remove that");
      }
      return;
    }

    /* Or have it spoken, so the cut can be watched end to end before you
       commit to recording anything. */
    if (tts) {
      if (tts.dataset.busy === "1") return;
      tts.dataset.busy = "1";
      const was = tts.textContent;
      tts.textContent = "Speaking it…";
      try {
        const res = await fetch("/api/beats/" + tts.closest(".blk-rec").getAttribute("data-beat") + "/tts", { method: "POST" });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error || "That didn't work");
        location.reload();
      } catch (err) {
        tts.dataset.busy = "0";
        tts.textContent = was;
        toast((err && err.message) || "That didn't work");
      }
      return;
    }

    /* Play from here. Reading and watching are the same gesture, which is the
       whole claim — so the timecode is the control. */
    if (play && video) {
      video.currentTime = Number(play.getAttribute("data-start") || 0) / 1000;
      video.play().catch(() => {});
      return;
    }

    /*
     * Clicking a word SEEKS to it. It used to strike it.
     *
     * That is Descript's model and it is the right one: a transcript you can
     * click into is a scrub bar made of words, and deleting has to be a
     * deliberate gesture rather than something a stray click does to your
     * video. Cutting is now select-then-cut, which is also how you take out a
     * phrase rather than a word at a time.
     */
    if (word && video) {
      const at = Number(word.getAttribute("data-s") || 0);
      if (at || word.getAttribute("data-s")) {
        video.currentTime = at / 1000;
        video.play().catch(() => {});
      }
      return;
    }

    if (strike && row) {
      if (row.dataset.busy === "1") return;
      const next = row.dataset.struck !== "1";
      row.dataset.busy = "1";
      paintBlock(row, next);
      /* One block changed, so the total moves by one — recounting the DOM
         would only ever count what has been scrolled into. */
      retotal(undefined, keptTotal + (next ? -1 : 1));
      try {
        /* The BLOCK id, not a number parsed out of it. A beat's id is a ULID,
           and Number(ULID) is NaN — which the server accepted and then threw
           away, so striking a block you inserted did nothing. */
        const id = row.getAttribute("data-block");
        const out = await sendCut({ kind: "segment", block: id, seg: Number(id.slice(2)), word: null });
        retotal(out.afterS, out.kept);
        undoable(next ? "Cut" : "Put back", out.before);
      } catch (err) {
        paintBlock(row, !next);
        retotal(undefined, keptTotal + (next ? 1 : -1));
        toast((err && err.message) || "That didn't save");
      } finally {
        row.dataset.busy = "0";
      }
      return;
    }

    if (move) {
      move.disabled = true;
      try {
        const res = await fetch("/api/projects/" + projectId + "/blocks/move", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ block: move.getAttribute("data-block"), dir: Number(move.getAttribute("data-dir")) }),
        });
        if (!res.ok) throw new Error("Couldn't move that");
        /* Parked for the page that is about to load: a reload throws away the
           toast, so the snapshot has to outlive it. */
        const out = await res.json().catch(() => ({}));
        if (out.before) sessionStorage.setItem("undo:" + projectId, JSON.stringify({ label: "Moved", before: out.before }));
        location.reload();
      } catch (err) {
        move.disabled = false;
        toast((err && err.message) || "Couldn't move that");
      }
      return;
    }

    /* Make a vertical short of this one block. The OpusClip half of the idea,
       on the surface you are already editing rather than a place of its own.
       It renders in the background, so the button reports where it went
       instead of freezing the row. */
    if (short) {
      if (short.dataset.busy === "1") return;
      short.dataset.busy = "1";
      const pill = short.querySelector(".seg-pill");
      const label = pill ? pill.textContent : "";
      if (pill) pill.textContent = "making it…";
      try {
        const res = await fetch("/api/projects/" + projectId + "/blocks/short", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ block: short.getAttribute("data-block"), aspect: "9:16" }),
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error || "Couldn't make that");
        if (pill) pill.textContent = "in Clipping";
        toast("Making it — it'll be in Clipping.");
      } catch (err) {
        short.dataset.busy = "0";
        if (pill) pill.textContent = label;
        toast((err && err.message) || "Couldn't make that");
      }
      return;
    }

    /*
   * Pull a moment out of your library into this cut.
   *
   * The seam's third option. A clip from ANOTHER video is material that is in
   * no segment here, which is why it becomes a block carrying its own file and
   * range rather than a pointer — a moment from THIS video is already a block
   * and only wants moving.
   *
   * Built here rather than rendered on every page: it is one overlay used by
   * one gesture, and shipping its markup with every editor load is the kind of
   * weight the block windowing just removed.
   */
  const pickClip = async (insert) => {
    const at = Number(insert.getAttribute("data-at")) || 0;
    let box = document.querySelector("#pick-moment");
    if (!box) {
      box = document.createElement("div");
      box.id = "pick-moment";
      box.style.cssText =
        "position:fixed;inset:0;z-index:70;background:rgba(8,8,10,.72);display:flex;" +
        "align-items:flex-start;justify-content:center;padding:8vh 20px";
      box.addEventListener("click", (e) => { if (e.target === box) box.hidden = true; });
      document.body.appendChild(box);
    }
    box.hidden = false;
    box.innerHTML =
      '<div style="width:min(560px,100%);max-height:76vh;overflow:auto;border-radius:11px;background:#141418;' +
      'box-shadow:inset 0 0 0 1px rgba(255,255,255,.08), 0 24px 60px rgba(0,0,0,.5);padding:16px 18px">' +
      '<div style="font-size:12.5px;font-weight:600;color:rgba(236,236,241,.45);margin-bottom:10px">Pull from anywhere</div>' +
      '<div id="pick-moment-list" style="display:flex;flex-direction:column;gap:6px">Looking…</div></div>';

    const list = box.querySelector("#pick-moment-list");
    try {
      const res = await fetch("/api/moments?not=" + encodeURIComponent(sourceId || ""));
      const out = await res.json();
      const moments = out.moments || [];
      if (!moments.length) {
        list.textContent = "Nothing kept from your other videos yet.";
        return;
      }
      const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
      const clock = (ms) => {
        const s2 = Math.round(ms / 1000);
        return Math.floor(s2 / 60) + ":" + String(s2 % 60).padStart(2, "0");
      };
      list.innerHTML = moments
        .map(
          (m) =>
            '<button data-clip="' + esc(m.id) + '" style="display:flex;gap:12px;align-items:flex-start;text-align:left;' +
            'padding:11px 12px;border-radius:8px;background:#17171B;border:none;cursor:pointer;color:#ECECF1;font-family:inherit">' +
            '<span style="flex:none;width:54px;aspect-ratio:16/9;border-radius:4px;overflow:hidden;background:#0B0B0E">' +
            (m.frame ? '<img loading="lazy" src="/media/' + esc(m.frame) + '" style="width:100%;height:100%;object-fit:cover"/>' : "") +
            "</span>" +
            '<span style="flex:1;min-width:0">' +
            '<span style="display:block;font-size:13px;line-height:1.45">' + esc(String(m.quote).slice(0, 110)) + "</span>" +
            '<span style="display:block;margin-top:3px;font-size:11px;color:rgba(236,236,241,.4)">' +
            esc(m.source) + " · " + clock(m.ms) + "</span></span></button>",
        )
        .join("");

      list.querySelectorAll("[data-clip]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          btn.disabled = true;
          try {
            const r = await fetch("/api/projects/" + projectId + "/blocks/insert", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ at, kind: "clip", clipId: btn.getAttribute("data-clip") }),
            });
            if (!r.ok) throw new Error("Couldn't add that");
            location.reload();
          } catch (err) {
            btn.disabled = false;
            toast((err && err.message) || "Couldn't add that");
          }
        });
      });
    } catch {
      list.textContent = "Couldn't reach your library just now.";
    }
  };

  /* The seam ASKS now. It used to insert a voice block silently, with no
       choice at all, while the design offers several things to put there. */
    if (seamOpen) {
      const opts = seamOpen.parentElement.querySelector(".seam-opts");
      blocksEl.querySelectorAll(".seam-opts").forEach((o) => { if (o !== opts) o.hidden = true; });
      blocksEl.querySelectorAll(".seam-open").forEach((o) => { o.hidden = false; });
      opts.hidden = false;
      seamOpen.hidden = true;
      return;
    }

    if (seamClose) {
      const seam = seamClose.closest(".seam");
      seam.querySelector(".seam-opts").hidden = true;
      seam.querySelector(".seam-open").hidden = false;
      return;
    }

    if (insert) {
      const kind = insert.getAttribute("data-kind") || "vo";
      /* A clip comes from somewhere else in your library, so it needs picking
         before anything is inserted. */
      if (kind === "clip") { void pickClip(insert); return; }

      insert.disabled = true;
      try {
        const res = await fetch("/api/projects/" + projectId + "/blocks/insert", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ at: Number(insert.getAttribute("data-at")), kind }),
        });
        if (!res.ok) throw new Error("Couldn't add that");
        location.reload();
      } catch (err) {
        insert.disabled = false;
        toast((err && err.message) || "Couldn't add that");
      }
    }
  });

  /*
   * Find a word in this cut, and cut every place it is said.
   *
   * The palette searches the whole library and navigates away, which is the
   * opposite of what you want mid-edit: inside a 48-minute transcript there
   * was no way to reach "sponsor" but scrolling, and no way to act on all of
   * them. This is most of what editing by text means in practice.
   *
   * Server-side, because the editor holds a WINDOW of a long transcript and
   * the interesting matches are usually past it. A hit carries the index of
   * its block, so jumping loads exactly that far and no further.
   */
  const findEl = document.querySelector(".find");
  if (findEl) {
    const q = findEl.querySelector(".find-q");
    const countEl = findEl.querySelector(".find-count");
    const cutAll = findEl.querySelector(".find-cut");
    const hitsEl = findEl.querySelector(".find-hits");

    let hits = [];
    let atHit = -1;
    let timer = null;
    let seq = 0;

    const rowStyle =
      "display:block;width:100%;text-align:left;border:none;background:transparent;cursor:pointer;" +
      "padding:7px 9px;border-radius:5px;font-family:inherit;font-size:12.5px;line-height:1.5;color:rgba(236,236,241,0.55)";

    const paint = (savedMs) => {
      countEl.textContent = hits.length ? hits.length + " found" : "";
      hitsEl.innerHTML = hits
        .map(
          (h, i) =>
            '<button class="find-hit" data-hit="' + i + '" style="' + rowStyle + '">' +
            '<span style="font-family:ui-monospace,monospace;color:rgba(236,236,241,0.32);margin-right:8px">' +
            clock(h.start_ms) + "</span>" +
            escapeHtml(h.before) + ' <span style="color:#ECECF1;background:rgba(217,179,106,0.22)">' +
            escapeHtml(h.hit) + "</span> " + escapeHtml(h.after) + "</button>",
        )
        .join("");

      /* The count and the saving are real or the button is not offered — the
         same rule the clean-up chips follow. */
      if (hits.length) {
        cutAll.hidden = false;
        cutAll.textContent =
          "Cut all " + hits.length + " \u00B7 \u2212" + clock(savedMs || 0);
      } else {
        cutAll.hidden = true;
      }
    };

    const clear = () => {
      hits = [];
      atHit = -1;
      paint(0);
    };

    const search = async () => {
      const text = q.value.trim();
      if (text.length < 2) { clear(); return; }
      const mine = ++seq;
      try {
        const res = await fetch(
          "/api/projects/" + projectId + "/find?q=" + encodeURIComponent(text),
        );
        const out = await res.json().catch(() => ({}));
        /* Ignore a slow answer to an old query, or the results you see are
           whichever request happened to finish last. */
        if (mine !== seq) return;
        hits = out.matches || [];
        atHit = -1;
        paint(out.savedMs);
      } catch (err) {
        if (mine === seq) clear();
      }
    };

    q.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(search, 160);
    });

    /* Go to one, loading as far as it if the reader has not scrolled there.
       The video seeks first: it can go anywhere immediately, and it is the
       thing that tells you whether this is the right one. */
    const goTo = async (i) => {
      const h = hits[i];
      if (!h) return;
      atHit = i;
      if (video) video.currentTime = h.start_ms / 1000;

      let el = blocksEl.querySelector('[data-block="' + h.block + '"]');
      if (!el && h.index >= 0) {
        /* Load until it is on the page. The server caps how much one request
           will send, so a very long jump takes a few — bounded, not a walk. */
        let guard = 0;
        while (!el && blocksEl.querySelector("#more-blocks") && guard++ < 12) {
          await loadMore(h.index + 1);
          el = blocksEl.querySelector('[data-block="' + h.block + '"]');
        }
        /* The highlight and the selection counter keep their own index of the
           words; blocks that arrive this way have to be in it too. */
        reindexWords();
        observeFrames(blocksEl.querySelectorAll(".blk-frame"));
      }
      if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
    };

    hitsEl.addEventListener("click", (e) => {
      const row = e.target.closest(".find-hit");
      if (row) void goTo(Number(row.getAttribute("data-hit")));
    });

    q.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || !hits.length) return;
      e.preventDefault();
      /* Enter walks them, wrapping — the same as every find field. */
      void goTo((atHit + 1) % hits.length);
    });

    cutAll.addEventListener("click", async () => {
      if (!hits.length) return;
      const n = hits.length;
      cutAll.disabled = true;
      try {
        const out = await sendCut({
          kind: "range",
          ranges: hits.map((h) => ({ seg: h.seg, from: h.from, to: h.to })),
        });
        /* A cut this wide restrikes words all over the transcript, so the page
           is rebuilt rather than repainted by hand — the same call the move
           and the clean-ups make, and the snapshot is parked so Undo outlives
           the reload. */
        if (out.before) {
          sessionStorage.setItem(
            "undo:" + projectId,
            JSON.stringify({ label: "Cut " + n + " match" + (n === 1 ? "" : "es"), before: out.before }),
          );
        }
        location.reload();
      } catch (err) {
        cutAll.disabled = false;
        toast((err && err.message) || "That didn't save");
      }
    });
  }
}

/* Ask the model which blocks are strong. An assist inside the editor rather
   than a separate place, which is what Clipping had become. */
/*
 * The assist panel.
 *
 * Everything that tells the model what to do lives here, and all of it
 * already existed on the server with nothing calling it: POST /passes takes
 * any sentence, and the cuts route has understood "fillers" and "pauses"
 * since it was written.
 */
const assist = document.querySelector(".assist");
if (assist) {
  const projectId = assist.getAttribute("data-project");
  const form = assist.querySelector(".pass-form");
  const field = form?.querySelector("input[name=instruction]");

  /* A pass is queued work, so the page reloads into the running strip rather
     than pretending the answer is instant. */
  const runPass = async (instruction, btn) => {
    const was = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "Starting…"; }
    try {
      const res = await fetch("/api/projects/" + projectId + "/passes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instruction }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || "That didn't start");
      location.reload();
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = was; }
      toast((err && err.message) || "That didn't start");
    }
  };

  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    const instruction = (field?.value || "").trim();
    /* The server refuses an empty instruction with "say what you want"; say it
       here too rather than making the user wait for a round trip to hear it. */
    if (!instruction) { toast("Say what you want."); field?.focus(); return; }
    void runPass(instruction, form.querySelector("button[type=submit]"));
  });

  /* The examples fill the field rather than firing, so you can edit one into
     what you actually meant — which is usually the point of an example. */
  assist.querySelectorAll(".pass-eg").forEach((eg) => {
    eg.addEventListener("click", () => {
      if (!field) return;
      field.value = eg.textContent.trim();
      field.focus();
    });
  });

  const findGood = assist.querySelector(".find-good");
  findGood?.addEventListener("click", () => void runPass("find the strongest moments", findGood));

  /*
   * The clean-ups are NOT model calls — they are the transcript's own filler
   * words and its own gaps, found in code. So they apply at once and the
   * runtime updates in place; there is nothing to wait for.
   */
  const cleanUp = async (btn, kind) => {
    if (btn.disabled) return;
    btn.disabled = true;
    const label = btn.querySelector("span");
    const was = label ? label.textContent : "";
    if (label) label.textContent = "Working…";
    try {
      const res = await fetch("/api/projects/" + projectId + "/cuts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      if (!res.ok) throw new Error("That didn't save");
      const out = await res.json().catch(() => ({}));
      if (out.before) {
        sessionStorage.setItem(
          "undo:" + projectId,
          JSON.stringify({ label: kind === "fillers" ? "Fillers removed" : "Silences tightened", before: out.before }),
        );
      }
      /* Reload: this restrikes words all over the transcript, and repainting
         every one of them by hand is how the page and the server drift. */
      location.reload();
    } catch (err) {
      btn.disabled = false;
      if (label) label.textContent = was;
      toast((err && err.message) || "That didn't save");
    }
  };

  const fillers = assist.querySelector(".clean-fillers");
  fillers?.addEventListener("click", () => void cleanUp(fillers, "fillers"));
  const pauses = assist.querySelector(".clean-pauses");
  pauses?.addEventListener("click", () => void cleanUp(pauses, "pauses"));
}

/* ── The nav bar's three controls ──────────────────────────────────────
   "Ask for anything", the "?" and the bell were rendered on every page and
   bound to nothing, while this very file caught Cmd-K and "?" and discarded
   them. The app had shortcuts and hid them behind a dead button. */

const palette = document.querySelector("#palette");
const paletteInput = document.querySelector("#paletteInput");
const paletteResults = document.querySelector("#paletteResults");
const keysheet = document.querySelector("#keysheet");
const notifpanel = document.querySelector("#notifpanel");

function toggle(el, on) {
  if (!el) return false;
  const next = on === undefined ? el.hidden : !on;
  el.hidden = !next ? true : false;
  el.hidden = on === undefined ? !el.hidden : !on;
  return true;
}

/** Closes anything open. Returns whether there was something to close. */
function closeOverlays() {
  let closed = false;
  for (const el of [palette, keysheet, notifpanel]) {
    if (el && !el.hidden) { el.hidden = true; closed = true; }
  }
  return closed;
}

function openPalette() {
  if (!palette) return;
  closeOverlays();
  palette.hidden = false;
  if (paletteInput) { paletteInput.value = ""; paletteInput.focus(); }
  if (paletteResults) paletteResults.innerHTML = "";
  renderHits(null);
}

function renderHits(hits) {
  if (!paletteResults) return;
  if (hits === null) {
    paletteResults.innerHTML =
      '<div class="pal-note">Videos, edits and clips. Try a word someone said.</div>';
    return;
  }
  if (!hits.length) {
    /* Not a dead end: the words did not match, but the meaning search might,
       and that is one click away rather than a thing you have to know about. */
    const q = encodeURIComponent(paletteInput ? paletteInput.value : "");
    paletteResults.innerHTML =
      '<div class="pal-note">Nothing with those words. ' +
      '<a href="/footage?tab=moments&mode=meaning&q=' + q + '">Search by meaning →</a></div>';
    return;
  }
  paletteResults.innerHTML = hits
    .map(
      (h, i) =>
        '<a class="pal-row" data-hit="' + i + '" href="' + h.href + '">' +
        '<span class="pal-title">' + escapeHtml(h.title) + "</span>" +
        '<span class="pal-sub">' + escapeHtml(h.sub) + "</span></a>",
    )
    .join("");
  markActive(0);
}

function escapeHtml(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

let active = 0;
function rows() {
  return paletteResults ? [...paletteResults.querySelectorAll("[data-hit]")] : [];
}
function markActive(i) {
  const all = rows();
  if (!all.length) return;
  active = (i + all.length) % all.length;
  all.forEach((el, n) => {
    el.setAttribute("data-active", n === active ? "1" : "0");
    if (n === active) el.scrollIntoView({ block: "nearest" });
  });
}

if (paletteInput) {
  /* Debounced: a query per keystroke would be a query per keystroke. */
  let timer = null;
  let seq = 0;
  paletteInput.addEventListener("input", () => {
    clearTimeout(timer);
    const q = paletteInput.value.trim();
    if (!q) { renderHits(null); return; }
    timer = setTimeout(async () => {
      const mine = ++seq;
      try {
        const res = await fetch("/api/search?q=" + encodeURIComponent(q));
        const data = await res.json();
        /* Ignore a slow answer to an old query — otherwise the results you
           see are whichever request happened to finish last. */
        if (mine === seq) renderHits(data.hits || []);
      } catch (err) {
        if (mine === seq) renderHits([]);
      }
    }, 140);
  });

  paletteInput.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); markActive(active + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); markActive(active - 1); }
    else if (e.key === "Enter") {
      const el = rows()[active];
      if (el) { e.preventDefault(); location.href = el.getAttribute("href"); }
    }
  });
}

/* Clicking the scrim closes; clicking the panel must not. */
for (const el of [palette, keysheet]) {
  if (el) el.addEventListener("click", (e) => { if (e.target === el) closeOverlays(); });
}
if (notifpanel) {
  const back = notifpanel.querySelector("[data-close]");
  if (back) back.addEventListener("click", closeOverlays);
}

const navSearch = document.querySelector("#navSearch");
if (navSearch) navSearch.addEventListener("click", openPalette);

const navKeys = document.querySelector("#navKeys");
if (navKeys) navKeys.addEventListener("click", () => {
  const open = keysheet && keysheet.hidden;
  closeOverlays();
  if (keysheet && open) keysheet.hidden = false;
});

/* The bell. Its gold dot claimed news for months with nothing behind it. */
const navNotif = document.querySelector("#navNotif");
const notifDot = navNotif ? navNotif.querySelector("span") : null;
const notifBody = document.querySelector("#notifBody");

function notifRow(label, sub, tone, href) {
  const inner =
    '<span class="notif-dot" data-tone="' + tone + '"></span>' +
    '<span class="pal-title">' + escapeHtml(label) + "</span>" +
    '<span class="pal-sub">' + escapeHtml(sub) + "</span>";
  return href
    ? '<a class="notif-row" href="' + href + '">' + inner + "</a>"
    : '<div class="notif-row">' + inner + "</div>";
}

async function loadNotifications() {
  if (!notifBody) return;
  try {
    const res = await fetch("/api/notifications");
    if (!res.ok) throw new Error("no");
    const { running, done } = await res.json();
    const rowsHtml = []
      .concat((running || []).map((j) => notifRow(j.stage_label || j.type, "running", "run", null)))
      .concat(
        (done || []).map((j) =>
          notifRow(
            j.state === "failed" ? (j.error || "Something failed") : (j.stage_label || j.type),
            j.state === "failed" ? "failed" : "done",
            j.state === "failed" ? "fail" : "done",
            null,
          ),
        ),
      );
    notifBody.innerHTML = rowsHtml.length ? rowsHtml.join("") : '<div class="pal-note">Nothing running.</div>';
    /* The dot means something now: it is only there when work is. */
    if (notifDot) notifDot.hidden = !(running || []).length;
  } catch (err) {
    notifBody.innerHTML = '<div class="pal-note">Couldn\'t load that.</div>';
  }
}

if (navNotif) {
  navNotif.addEventListener("click", () => {
    const open = notifpanel && notifpanel.hidden;
    closeOverlays();
    if (notifpanel && open) { notifpanel.hidden = false; loadNotifications(); }
  });
  /* Settle the dot on load rather than leaving it permanently lit. */
  loadNotifications();
}

/* ── Keyboard map (10-ROUTES-AND-KEYS.md) ─────────────────────────────── */
let goArmed = false;
const GO = { h: "/", p: "/projects", c: "/clipping", f: "/footage", s: "/settings" };

/*
 * The editor's own keys.
 *
 * There was a key map — g h, g p, ⌘K, ⌘Z, ? — and the one surface where you
 * repeat a gesture a thousand times had none of it. Space did not play.
 *
 * These are live only when the editor is on the page, and the ? sheet lists
 * them only then, because a sheet promising keys you do not have is the same
 * bug as a button that does nothing.
 */
const cutVideo = document.querySelector("#cut-video");

document.addEventListener("keydown", (e) => {
  /* Escape closes whatever is open, from anywhere — including the palette's
     own input, which is a field, so this is checked before inField(). */
  if (e.key === "Escape" && closeOverlays()) { e.preventDefault(); return; }

  /* ⌘F is the browser's find, and inside a transcript loaded a window at a
     time it searches the part you can already see. This one searches the
     whole cut, so it takes the key — and only where it exists. */
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
    const q = document.querySelector(".find-q");
    if (q) { e.preventDefault(); q.focus(); q.select(); return; }
  }

  if (inField(e.target)) return;

  if (cutVideo && !e.metaKey && !e.ctrlKey && !e.altKey) {
    /* Space is the one key everyone tries first. */
    if (e.key === " ") {
      e.preventDefault();
      if (cutVideo.paused) cutVideo.play().catch(() => {});
      else cutVideo.pause();
      return;
    }
    if (e.key === "ArrowLeft") { e.preventDefault(); cutVideo.currentTime = Math.max(0, cutVideo.currentTime - 5); return; }
    if (e.key === "ArrowRight") { e.preventDefault(); cutVideo.currentTime = cutVideo.currentTime + 5; return; }

    /* J K L, from every editor since tape. K stops rather than toggling,
       because that is what it does everywhere else. */
    const k = e.key.toLowerCase();
    if (k === "k") { e.preventDefault(); cutVideo.pause(); return; }
    if (k === "l") {
      e.preventDefault();
      cutVideo.playbackRate = cutVideo.paused || cutVideo.playbackRate >= 2 ? 1 : Math.min(2, cutVideo.playbackRate * 2);
      cutVideo.play().catch(() => {});
      return;
    }
    if (k === "j") {
      e.preventDefault();
      cutVideo.pause();
      cutVideo.currentTime = Math.max(0, cutVideo.currentTime - 2);
      return;
    }

    /* Cut what you have selected, without reaching for the floating button.
       It only fires when there IS a selection, so Backspace on a page with
       nothing chosen does nothing rather than something surprising. */
    if (e.key === "Backspace" || e.key === "Delete") {
      const sel = window.getSelection();
      const btn = window.cutSelection;
      if (btn && sel && !sel.isCollapsed) { e.preventDefault(); btn(); return; }
    }
  }

  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    openPalette();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    const r = undoStack.pop();
    if (r) r();
    return;
  }
  if (e.key === "?") { e.preventDefault(); toggle(keysheet); return; }
  if (e.key === "Escape") { goArmed = false; return; }

  /* G then a letter navigates. */
  if (!e.metaKey && !e.ctrlKey && !e.altKey) {
    if (goArmed) {
      const dest = GO[e.key.toLowerCase()];
      goArmed = false;
      if (dest) { e.preventDefault(); location.href = dest; }
      return;
    }
    if (e.key.toLowerCase() === "g") { goArmed = true; setTimeout(() => (goArmed = false), 1200); }
  }
});

/* ── Uploads that survive navigation ───────────────────────────────────
   The part loop lives in a service worker (src/ui/sw.ts), because that is the
   only thing in a browser that outlives the page which started it. Everything
   below is the page's half: hand over the file, then render whatever progress
   the worker broadcasts — on any surface, not just the one that began it. */

/**
 * The file, kept somewhere that outlives the page.
 *
 * "when i click away browsing the site it cancels the upload" — reported
 * twice, and the service worker was supposed to have fixed it. It had not,
 * for a reason that only shows up once you follow the whole chain:
 *
 *   1. The page hands the File to the worker and remembers it in inFlight.
 *   2. You navigate. That page is destroyed, and inFlight with it.
 *   3. watchUpload -- the stall timer that re-sends a wedged upload -- reads
 *      inFlight, so on the new page it returns immediately and there is NO
 *      recovery for anything already running.
 *   4. Chrome does not keep a service worker alive indefinitely for a message
 *      event's waitUntil. On a multi-gigabyte upload it gets terminated
 *      mid-file, and by then nothing anywhere is watching.
 *
 * So the upload stops, silently, and the next page you land on offers you
 * "Finish it" and asks you to pick the same file again. Which reads exactly
 * like being cancelled for browsing your own site.
 *
 * The file goes in IndexedDB, which belongs to the origin rather than to any
 * page. Any page, on any surface, can then find an interrupted upload and
 * restart it without asking you for anything.
 */
const UPLOAD_DB = "aldershot-uploads";

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(UPLOAD_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains("files")) req.result.createObjectStore("files");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbRun(mode, fn) {
  /* Private windows and blocked site-data both throw here. An upload that
     cannot be parked is still an upload -- it just loses the ability to
     resume itself, which is what we had before. */
  try {
    const db = await idb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("files", mode);
      const out = fn(tx.objectStore("files"));
      tx.oncomplete = () => resolve(out && out.result !== undefined ? out.result : undefined);
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    return undefined;
  }
}

const parkFile = (id, file) => idbRun("readwrite", (st) => st.put(file, id));
const takeFile = (id) => idbRun("readonly", (st) => st.get(id));
const dropFile = (id) => idbRun("readwrite", (st) => st.delete(id));

let swReady = null;
async function uploadWorker() {
  if (!("serviceWorker" in navigator)) return null;
  if (!swReady) {
    swReady = navigator.serviceWorker
      .register("/sw.js")
      .then(() => navigator.serviceWorker.ready)
      .then((reg) => reg.active)
      .catch(() => null);
  }
  return await swReady;
}

/* A single persistent chip, bottom-left, present on every page while an
   upload is in flight. It is deliberately not a toast: a toast implies
   something that has happened, and this is something still happening. */
/**
 * Turn what the worker reports into something a person can act on.
 *
 * The worker's own messages are true and useless: "part 7 failed (503)",
 * "part 12 gave no etag". They went straight to the user, in a product whose
 * own rule is that a failure has to read like a sentence and say what to do
 * next. The raw text is kept for the console, never for the chip.
 */
function uploadError(raw) {
  const t = String(raw || "");
  if (/\b(4\d\d)\b/.test(t) && !/408|429/.test(t)) {
    return "That upload was refused. Try adding the video again.";
  }
  if (/429/.test(t)) return "Too many at once — give it a minute and carry on.";
  if (/\b5\d\d\b|etag|no upload URL|couldn't get/i.test(t)) {
    return "The connection dropped partway. Pick up where it left off.";
  }
  if (/abort|timeout|network|failed to fetch/i.test(t)) {
    return "The connection dropped partway. Pick up where it left off.";
  }
  return "That upload stopped before it finished.";
}

/**
 * ONE ROW PER UPLOAD.
 *
 * There was a single #uploadChip, looked up by id and overwritten by whoever
 * spoke last — so five files uploading produced one line flickering between
 * five names with a progress bar jumping between five percentages, and no way
 * to tell which was which or stop any of them.
 */
/* Uploads the user stopped. A cancel removes the row, and the progress
   messages already in flight would otherwise put it straight back — the
   worker takes a moment to notice, and every tick calls showUpload. */
const cancelled = new Set();

function uploadRow(sourceId) {
  let host = document.querySelector("#uploads");
  if (!host) {
    host = document.createElement("div");
    host.id = "uploads";
    host.style.cssText =
      "position:fixed;left:20px;bottom:20px;z-index:60;display:flex;flex-direction:column-reverse;gap:8px;" +
      "max-width:min(420px,calc(100vw - 40px))";
    document.body.appendChild(host);
  }
  let el = host.querySelector('[data-source="' + sourceId + '"]');
  if (!el) {
    el = document.createElement("div");
    el.setAttribute("data-source", sourceId);
    el.style.cssText =
      "position:relative;display:flex;align-items:flex-start;gap:12px;padding:12px 16px;border-radius:9px;" +
      "background:#141418;color:#ECECF1;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.08), 0 12px 40px rgba(0,0,0,0.45);" +
      "font-size:12.5px";
    host.appendChild(el);
  }
  return el;
}

function showUpload({ sourceId, name, pct, state, href, error, sent, totalBytes, bps, etaS }) {
  if (cancelled.has(sourceId)) return;
  const el = uploadRow(sourceId);
  const dot = state === "failed" ? "#E06A6A" : state === "done" ? "#5EC98F" : "#5EB8C9";

  /* A long upload needs to answer "how long is this going to take?", not just
     "is it moving?". Size, rate and time left are all measured from bytes the
     server has accepted — never a timer. */
  const size = (n) =>
    n >= 1e9 ? (n / 1e9).toFixed(1) + " GB" : Math.max(1, Math.round(n / 1e6)) + " MB";
  const eta = (s) => {
    if (s == null || !isFinite(s) || s <= 0) return "";
    if (s < 60) return "about " + Math.max(5, Math.round(s / 5) * 5) + "s left";
    const m = Math.round(s / 60);
    return m < 60 ? "about " + m + " min left" : "about " + Math.round(m / 60) + "h left";
  };

  const line =
    state === "failed"
      ? uploadError(error)
      : state === "done"
        ? "Reading " + name
        : "Uploading " + name;

  const detail =
    state || !totalBytes
      ? ""
      : [
          pct + "%",
          size(sent || 0) + " of " + size(totalBytes),
          bps > 0 ? size(bps) + "/s" : "",
          eta(etaS),
        ]
          .filter(Boolean)
          .join("  ·  ");

  const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

  el.innerHTML =
    '<span style="width:6px;height:6px;border-radius:50%;background:' + dot + ';flex:none;margin-top:3px"></span>' +
    '<span style="flex:1;min-width:0">' +
    '<span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(line) + "</span>" +
    (detail
      ? '<span style="display:block;margin-top:3px;font-size:11px;color:rgba(236,236,241,0.45);font-family:\'IBM Plex Mono\',monospace">' + detail + "</span>"
      : "") +
    "</span>" +
    (state === "done" && href
      ? '<a href="' + esc(href) + '" style="flex:none;font-weight:600;padding:5px 11px;border-radius:5px;background:#1A1A1F;color:#ECECF1">Open</a>'
      : "") +
    (state === "failed"
      ? '<button data-act="retry" style="flex:none;font-weight:600;padding:5px 11px;border-radius:5px;background:#1A1A1F;color:#ECECF1;border:none;cursor:pointer;font-family:inherit">Pick it up</button>'
      : "") +
    /* Stopping a 4 GB file you chose by mistake. The worker has handled
       cancel-upload since it was written and NOTHING ever sent one, so the
       only way out was to close the tab and leave the parts in R2. */
    (!state
      ? '<button data-act="cancel" aria-label="Stop this upload" style="flex:none;padding:2px 6px;border:none;background:none;color:rgba(236,236,241,0.4);cursor:pointer;font-family:inherit;font-size:14px;line-height:1">×</button>'
      : "") +
    (!state
      ? '<div style="position:absolute;left:0;right:0;bottom:0;height:2px;background:#232329;border-radius:0 0 9px 9px;overflow:hidden">' +
        '<div style="height:100%;width:' + pct + '%;background:#5EB8C9;transition:width .25s ease"></div></div>'
      : "");

  el.querySelector('[data-act="cancel"]')?.addEventListener("click", async () => {
    cancelled.add(sourceId);
    el.remove();
    inFlight.delete(sourceId);
    void dropFile(sourceId);
    const sw = await uploadWorker();
    sw?.postMessage({ type: "cancel-upload", sourceId });
    toast("Stopped.");
  });

  /*
   * Retry resumes from what the server already holds.
   *
   * It used to read inFlight, which is page-local — so after a navigation the
   * job was gone and it said "Choose the file again to carry on" with no file
   * picker attached, a dead end on exactly the failure it exists for. It falls
   * back to the parked copy, which is the whole reason files are parked.
   */
  el.querySelector('[data-act="retry"]')?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const sw = await uploadWorker();
      if (!sw) throw new Error("no worker");
      const job = inFlight.get(sourceId);
      if (job) {
        sw.postMessage({ ...job.msg, doneParts: job.doneParts, resume: true });
      } else {
        const parked = await takeFile(sourceId);
        if (!parked) throw new Error("no parked copy");
        const pending = await fetch("/api/uploads/pending").then((r) => r.json()).catch(() => ({}));
        const row = (pending.pending || []).find((p) => p.source_id === sourceId);
        if (!row) throw new Error("nothing to resume");
        const msg = {
          type: "start-upload",
          file: parked,
          sourceId,
          uploadId: row.upload_id,
          partSize: row.part_size,
          mode: row.mode,
          resume: true,
        };
        inFlight.set(sourceId, { msg, doneParts: [], timer: null });
        sw.postMessage(msg);
      }
      watchUpload(sourceId);
      showUpload({ sourceId, name, pct: 0 });
    } catch {
      btn.disabled = false;
      toast("That one can't be picked up here — add the video again.");
    }
  });
}

/* What the page remembers about an upload it started, so it can hand the work
   back if the worker stops. Safari terminates service workers aggressively and
   a multi-gigabyte upload is a long time to stay alive; the page is the thing
   still holding the File, so the page is what can restart it. */
const inFlight = new Map();

/* If no progress arrives for this long, assume the worker is gone or wedged
   and resume from the parts we know landed. Generous, because a slow part on a
   phone is normal and restarting too eagerly wastes the connection. */
const STALL_MS = 60000;

function watchUpload(sourceId) {
  const job = inFlight.get(sourceId);
  if (!job) return;
  clearTimeout(job.timer);
  job.timer = setTimeout(async () => {
    const sw = await uploadWorker();
    if (!sw || !inFlight.has(sourceId)) return;
    const j = inFlight.get(sourceId);
    /* resume:true lets this take over a run that is stuck. Parts already
       stored are skipped, so the cost of being wrong is a little bandwidth. */
    sw.postMessage({ ...j.msg, doneParts: j.doneParts, resume: true });
    watchUpload(sourceId);
  }, STALL_MS);
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (e) => {
    const m = e.data || {};
    if (m.type === "upload-progress") {
      const job = inFlight.get(m.sourceId);
      if (job && m.doneParts) job.doneParts = m.doneParts;
      watchUpload(m.sourceId);
      showUpload(m);
    }
    else if (m.type === "upload-done") {
      const job = inFlight.get(m.sourceId);
      if (job) clearTimeout(job.timer);
      inFlight.delete(m.sourceId);
      /* The bytes are in R2; the parked copy is just taking up the browser's
         storage quota now. */
      dropFile(m.sourceId);
      showUpload({ ...m, state: "done" });
      /* The read starts server-side the moment the upload completes, so the
         chip stays as the way back in rather than yanking the user off
         whatever they were looking at. */
    } else if (m.type === "upload-failed") {
      /* The job is KEPT, not deleted: Retry needs the File, and the server
         still holds every part that landed, so retrying resumes. */
      const job = inFlight.get(m.sourceId);
      if (job) clearTimeout(job.timer);
      showUpload({ ...m, state: "failed" });
    } else if (m.type === "upload-cancelled") {
      const job = inFlight.get(m.sourceId);
      if (job) clearTimeout(job.timer);
      inFlight.delete(m.sourceId);
      dropFile(m.sourceId);
      document.querySelector("#uploadChip")?.remove();
    }
  });
  /* Register early so the worker is live before the first upload, not after. */
  uploadWorker();

  /*
   * Offer to finish anything left hanging.
   *
   * The server keeps every part that landed, so an upload interrupted by a
   * crash, a closed tab, or a flat battery is genuinely resumable — but only
   * the browser can supply the file again, since a page cannot hold onto one
   * across sessions. So we ask, name the file, and say how far it got.
   *
   * The file is checked by name AND size before continuing: resuming with a
   * different file would splice two videos together into something that looks
   * fine until you play it.
   */
  (async () => {
    let pending = [];
    try {
      const res = await fetch("/api/uploads/pending");
      if (!res.ok) return;
      pending = (await res.json()).pending || [];
    } catch (err) { return; }
    if (!pending.length || document.querySelector("#uploadChip")) return;

    const p = pending[0];

    /*
     * ADOPT IT. No button, no asking for the file again.
     *
     * The file was parked in IndexedDB when the upload started, so whichever
     * page you happen to be on can hand it back to the worker and carry on
     * from whatever the server already holds. This is the whole point of the
     * exercise: browsing your own site is not cancelling anything, and it
     * should not cost you a click to prove it.
     */
    const parked = await takeFile(p.source_id);
    if (parked && parked.size === p.total_bytes) {
      const sw = await uploadWorker();
      if (sw) {
        const msg = {
          type: "start-upload",
          file: parked,
          sourceId: p.source_id,
          uploadId: p.upload_id,
          partSize: p.part_size,
          mode: p.mode,
          durationS: p.duration_s || 0,
          resume: true,
        };
        inFlight.set(p.source_id, { msg, doneParts: [], timer: null });
        sw.postMessage(msg);
        watchUpload(p.source_id);
        showUpload({
          sourceId: p.source_id,
          name: p.filename || "A video",
          pct: Math.min(99, Math.round((p.parts_done * p.part_size * 100) / (p.total_bytes || 1))),
          totalBytes: p.total_bytes,
          sent: p.parts_done * p.part_size,
        });
        return;
      }
    }

    /* No parked copy — a different browser, cleared site data, or a private
       window. Then we genuinely do have to ask, and this is the old path. */
    if (!p.total_bytes || !p.parts_done) return;

    const el = document.createElement("div");
    el.id = "uploadChip";
    el.style.cssText =
      "position:fixed;left:20px;bottom:20px;z-index:60;display:flex;align-items:center;gap:12px;" +
      "padding:12px 16px;border-radius:9px;background:#141418;color:#ECECF1;" +
      "box-shadow:inset 0 0 0 1px rgba(217,179,106,0.3), 0 12px 40px rgba(0,0,0,0.45);" +
      "font-size:12.5px;max-width:min(460px,calc(100vw - 40px))";
    const done = Math.round((p.parts_done * p.part_size * 100) / p.total_bytes);
    el.innerHTML =
      '<span style="width:6px;height:6px;border-radius:50%;background:#D9B36A;flex:none"></span>' +
      '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
      (p.filename || "A video") + " stopped at " + Math.min(99, done) + "%</span>" +
      '<label style="flex:none;font-weight:600;padding:5px 11px;border-radius:5px;background:#1A1A1F;cursor:pointer">Finish it' +
      '<input type="file" accept="video/*" id="resumePick" style="display:none"/></label>' +
      '<button id="resumeDrop" style="flex:none;background:none;border:none;color:rgba(236,236,241,0.4);cursor:pointer;font-family:inherit">Discard</button>';
    document.body.appendChild(el);

    el.querySelector("#resumeDrop").addEventListener("click", async () => {
      el.remove();
      dropFile(p.source_id);
      await fetch("/api/uploads/" + p.source_id + "/abort", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }).catch(() => {});
    });

    el.querySelector("#resumePick").addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.name !== p.filename || file.size !== p.total_bytes) {
        toast("That is a different file — pick " + p.filename);
        return;
      }
      const state = await fetch("/api/uploads/" + p.source_id + "/state").then((r) => r.json());
      const sw = await uploadWorker();
      if (!sw) { toast("Couldn't restart that upload"); return; }
      const msg = {
        type: "start-upload",
        file,
        sourceId: p.source_id,
        uploadId: state.uploadId,
        partSize: state.partSize,
        mode: state.mode,
        durationS: 0,
        resume: true,
      };
      inFlight.set(p.source_id, { msg, doneParts: state.parts, timer: null });
      sw.postMessage({ ...msg, doneParts: state.parts });
      watchUpload(p.source_id);
      showUpload({ sourceId: p.source_id, name: file.name, pct: 0, totalBytes: file.size, sent: 0 });
    });
  })();
}

/* ── Home composer ────────────────────────────────────────────────────── */
const composer = $("#composer");
if (composer) {
  const brief = $("#brief");

  document.querySelectorAll("[data-chip]").forEach((chip) => {
    chip.addEventListener("click", () => {
      brief.value = chip.getAttribute("data-chip");
      brief.focus();
    });
  });

  /* Drop a video anywhere on the composer. The gold inset ring is the
     prototype's own drag state, not an invention. */
  const hint = $("#dropHint");
  const show = (on) => { if (hint) hint.hidden = !on; };
  ["dragenter", "dragover"].forEach((ev) =>
    composer.addEventListener(ev, (e) => { e.preventDefault(); show(true); }),
  );
  ["dragleave", "drop"].forEach((ev) =>
    composer.addEventListener(ev, (e) => { e.preventDefault(); show(false); }),
  );

  const attached = $("#attached");
  const attachedName = $("#attachedName");
  const attachedMeta = $("#attachedMeta");
  function attach(file) {
    if (!file) return;
    attachedName.textContent = file.name;
    attachedMeta.textContent = (file.size / 1e9 >= 1)
      ? (file.size / 1e9).toFixed(1) + " GB"
      : Math.round(file.size / 1e6) + " MB";
    attached.hidden = false;
  }
  let picked = null;
  /* The composer takes ONE video plus a brief, because the brief is about
     that video. Drop several and the first is attached; the rest are not
     thrown away — they start uploading, which is what you meant by dropping
     them. (startUploads is a hoisted function declaration, defined below.) */
  /*
   * One file is a request; several are a dump.
   *
   * Selecting five uploaded FOUR — the first was parked in the composer strip
   * waiting for a Begin that might never come, and navigating away lost it
   * silently. So: one file is attached, because a brief needs something to be
   * about; more than one goes straight up, because nobody typing a sentence
   * means it about five videos at once.
   */
  const takeFiles = (files) => {
    const list = [...(files || [])];
    if (!list.length) return;
    if (list.length === 1) {
      picked = list[0];
      attach(picked);
      return;
    }
    picked = null;
    attached.hidden = true;
    void startUploads(list);
  };
  composer.addEventListener("drop", (e) => takeFiles(e.dataTransfer?.files));
  $("#filePick")?.addEventListener("change", (e) => { takeFiles(e.target.files); e.target.value = ""; });
  $("#clearFile")?.addEventListener("click", () => { picked = null; attached.hidden = true; });

  /* Begin: upload the video, then follow it to where it is being read.
     The brief is carried along and stays with the source, so a failed read
     offers a retry that does not make the user retype it. */
  /*
   * A BRIEF WITH NO FILE is not nothing — it is a brief about footage you
   * already have.
   *
   * This offers your videos and runs the brief against the one you pick.
   * /api/begin has taken {sourceId, brief} and read the intent since it was
   * written; the front door was simply the one place that could not reach it.
   */
  const pickSource = async () => {
    let box = document.querySelector("#pick-source");
    if (!box) {
      box = document.createElement("div");
      box.id = "pick-source";
      box.style.cssText =
        "position:fixed;inset:0;z-index:70;background:rgba(8,8,10,.72);display:flex;" +
        "align-items:flex-start;justify-content:center;padding:8vh 20px";
      box.addEventListener("click", (e) => { if (e.target === box) box.hidden = true; });
      document.body.appendChild(box);
    }
    box.hidden = false;
    box.innerHTML =
      '<div style="width:min(520px,100%);max-height:76vh;overflow:auto;border-radius:11px;background:#141418;' +
      'box-shadow:inset 0 0 0 1px rgba(255,255,255,.08), 0 24px 60px rgba(0,0,0,.5);padding:16px 18px">' +
      '<div style="font-size:12.5px;font-weight:600;color:rgba(236,236,241,.45);margin-bottom:10px">Which video?</div>' +
      '<div id="pick-source-list" style="display:flex;flex-direction:column;gap:6px">Looking…</div></div>';

    const list = box.querySelector("#pick-source-list");
    try {
      const out = await (await fetch("/api/sources")).json();
      /* Only what can actually be worked on: a brief against a video that has
         not been read yet has nothing to read. */
      const ready = (out.sources || []).filter((sv) => sv.transcript_state === "ready");
      if (!ready.length) {
        list.textContent = "Nothing read yet — add a video and it starts reading.";
        return;
      }
      list.innerHTML = ready
        .map(
          (sv) =>
            '<button data-source="' + escapeHtml(sv.id) + '" style="display:flex;gap:12px;align-items:center;text-align:left;' +
            'padding:11px 12px;border-radius:8px;background:#17171B;border:none;cursor:pointer;color:#ECECF1;font-family:inherit">' +
            '<span style="flex:none;width:54px;aspect-ratio:16/9;border-radius:4px;overflow:hidden;background:#0B0B0E">' +
            (sv.poster_r2_key ? '<img loading="lazy" src="/media/' + escapeHtml(sv.poster_r2_key) + '" style="width:100%;height:100%;object-fit:cover"/>' : "") +
            "</span>" +
            '<span style="flex:1;min-width:0;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
            escapeHtml(sv.title) + "</span></button>",
        )
        .join("");

      list.addEventListener("click", async (e) => {
        const row = e.target.closest("[data-source]");
        if (!row) return;
        row.disabled = true;
        try {
          const res = await fetch("/api/begin", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sourceId: row.getAttribute("data-source"), brief: brief.value.trim() }),
          });
          const done = await res.json();
          if (!res.ok) throw new Error(done.error || "That didn't start");
          location.href = done.href || "/";
        } catch (err) {
          row.disabled = false;
          toast((err && err.message) || "That didn't start");
        }
      });
    } catch (err) {
      list.textContent = "Couldn't reach your footage.";
    }
  };

  composer.addEventListener("submit", async (e) => {
    e.preventDefault();

    /*
     * NEVER SILENTLY NOTHING.
     *
     * This was if (!picked) { brief.focus(); return; } — type a sentence,
     * press the front page's only button, and it moved the cursor. No message,
     * no explanation, nothing to do next. The placeholder even reads "or drop
     * a video in first", which says the file is optional.
     */
    if (!picked) {
      if (brief.value.trim()) return void pickSource();
      toast("Add a video, or say what you want.");
      brief.focus();
      return;
    }

    const button = composer.querySelector('button[type="submit"]');
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Uploading…";

    try {
      /* The duration is measured here rather than server-side: the browser
         already has the file, and the cap has to be checked in source minutes
         BEFORE any money is spent reading it. */
      const durationS = await readDuration(picked).catch(() => 0);

      const start = await fetch("/api/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        /* The sentence goes WITH the file. It used to be dropped here — the
           handler cleared brief.value and returned, so "Begin →" began
           nothing. It cannot be acted on until there is a transcript, and this
           page may be long gone by then, so it rides on the source. */
        body: JSON.stringify({
          filename: picked.name,
          contentType: picked.type || "video/mp4",
          bytes: picked.size,
          brief: brief.value.trim(),
        }),
      }).then((r) => r.json());
      if (start.error) throw new Error(start.error);

      /*
       * The poster is grabbed and sent NOW, before the bytes go up, because it
       * only needs the local file and this page might not exist by the time
       * the upload finishes. It used to run after the upload, which meant
       * navigating away lost it.
       */
      grabPoster(picked, Math.max(1, (durationS || 8) * 0.25))
        .then((blob) =>
          blob &&
          fetch("/api/sources/" + start.source.id + "/poster", {
            method: "POST",
            headers: { "content-type": "image/jpeg" },
            body: blob,
          }),
        )
        .catch(() => {});

      /*
       * Hand the file to the service worker and stop being responsible for it.
       * The worker outlives this page, so clicking a link no longer cancels
       * the upload — which is what it used to do, silently.
       */
      const sw = await uploadWorker();
      if (sw) {
        /*
         * Park a copy before handing it over.
         *
         * The worker outlives a navigation but not its own termination —
         * Safari, or a long file. Adoption on the next page load reads the
         * parked copy; without one there is nothing to adopt and the user
         * gets "stopped at 62% / Finish it", i.e. re-pick the same file.
         *
         * startUpload (Footage) has always done this. THE COMPOSER NEVER DID,
         * so the fix for "when i click away browsing the site it cancels the
         * upload" was missing from the one path most uploads go through.
         */
        await parkFile(start.source.id, picked).catch(() => {});

        const msg = {
          type: "start-upload",
          file: picked,
          sourceId: start.source.id,
          uploadId: start.uploadId,
          partSize: start.partSize,
          mode: start.mode,
          durationS,
        };
        inFlight.set(start.source.id, { msg, doneParts: [], timer: null });
        sw.postMessage(msg);
        watchUpload(start.source.id);
        showUpload({ sourceId: start.source.id, name: picked.name, pct: 0 });
        button.disabled = false;
        button.textContent = original;
        picked = null;
        attached.hidden = true;
        brief.value = "";
        return;
      }

      /*
       * No service worker — an old browser, or an insecure origin. Fall back to
       * uploading in the page, and WARN before leaving, because here it really
       * would be cancelled. A warning is worse than the worker and much better
       * than losing the file with no word.
       */
      const guard = (ev) => { ev.preventDefault(); ev.returnValue = ""; };
      window.addEventListener("beforeunload", guard);
      try {
        await uploadResumable(picked, durationS, (pct) => {
          button.textContent = "Uploading " + pct + "%";
        }, start);
        location.href = "/sources/" + start.source.id;
      } finally {
        window.removeEventListener("beforeunload", guard);
      }
    } catch (err) {
      button.disabled = false;
      button.textContent = original;
      toast(err.message || "Couldn't add that video");
    }
  });
}

/* Edit / React to it, wherever a source is listed.
   These are how you get from "I uploaded a video" to "I am editing it", which
   previously had no route at all: a source row linked to a transcript page and
   stopped there. */
document.querySelectorAll(".source-go").forEach((btn) => {
  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = "Opening…";
    try {
      const res = await fetch("/api/begin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceId: btn.getAttribute("data-source"),
          brief: btn.getAttribute("data-brief") || "",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't open that");
      location.href = data.href;
    } catch (err) {
      btn.disabled = false;
      btn.textContent = original;
      toast(err.message || "Couldn't open that");
    }
  });
});

/* "Open" on a source in the editor intake: start a cut from footage that is
   already here, then follow the editor where the server says it lives. */
document.querySelectorAll(".open-source").forEach((btn) => {
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      const res = await fetch("/api/begin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceId: btn.getAttribute("data-source"), brief: "" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't open that");
      location.href = data.href;
    } catch (err) {
      btn.disabled = false;
      toast(err.message || "Couldn't open that");
    }
  });
});

/* The editor intake's brief chips. "Skip the brief" submits with nothing
   written, which the intent parser reads as a plain cut. */
document.querySelectorAll(".intake-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    const brief = $("#brief");
    if (!brief) return;
    brief.value = chip.getAttribute("data-brief") || "";
    chip.closest("form")?.requestSubmit();
  });
});

/* Sends the file to R2 in 8MB parts.
   A 45-180 minute source is gigabytes, so this is not an optimisation: a
   single PUT cannot carry it, and without parts one blip means starting the
   whole upload again. Each part retries on its own, and progress is the
   fraction of bytes actually accepted — never a timer. */
async function uploadResumable(file, durationS, onProgress, started) {
  /* "started" is passed by the composer, which has already opened the upload
     so it could send the poster early. Without it we open one here — the
     Clipping drop zone still calls it that way.
     NB: no backticks in this file's comments; it is a String.raw template. */
  const start =
    started ||
    (await fetch("/api/uploads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      /* The duration rides along here too, so the minutes cap refuses before
         the bytes on this path as well — it is the one an old browser and the
         Clipping drop zone take. */
      body: JSON.stringify({
        filename: file.name,
        contentType: file.type || "video/mp4",
        bytes: file.size,
        durationS: await readDuration(file).catch(() => 0),
      }),
    }).then((r) => r.json()));

  const { source, uploadId, partSize } = start;
  const total = Math.ceil(file.size / partSize);
  const parts = [];

  try {
    for (let n = 1; n <= total; n++) {
      const chunk = file.slice((n - 1) * partSize, n * partSize);
      let lastErr;
      /* Three attempts per part with a widening gap. A part is small enough
         that retrying it is cheap, which is the entire point of parts. */
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch("/api/uploads/" + source.id + "/parts/" + n, {
            method: "PUT",
            headers: { "x-upload-id": uploadId, "content-type": "application/octet-stream" },
            body: chunk,
          });
          if (!res.ok) throw new Error("part " + n + " failed");
          parts.push(await res.json());
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        }
      }
      if (lastErr) throw lastErr;
      onProgress(Math.round((n / total) * 100));
    }

    const done = await fetch("/api/uploads/" + source.id + "/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uploadId, parts, durationS: Math.round(durationS) }),
    });
    const result = await done.json();
    if (!done.ok) throw new Error(result.error || "Upload failed");
    return result;
  } catch (err) {
    /* Release the parts R2 is holding rather than leaving them to bill. */
    fetch("/api/uploads/" + source.id + "/abort", {
      method: "POST",
      headers: { "x-upload-id": uploadId },
    }).catch(() => {});
    throw err;
  }
}

/*
 * Draw a video into a canvas WITHOUT stretching it.
 *
 * drawImage(video, 0, 0, w, h) scales the source to fill, so a 9:16 phone
 * video drawn into a 16:9 thumbnail comes out squashed — every clip card of
 * vertical footage showed a face half its real width. The frames these
 * canvases hold are the only picture of a moment anywhere in the product, so
 * they have to be the shape the camera saw.
 *
 * Cover, not contain: the canvas is filled and the overflow is cropped
 * evenly, which is what object-fit:cover does for the <img> and <video>
 * elements beside them. Letterboxing instead would put black bars inside a
 * card that is already a rectangle on a dark page.
 */
function drawCover(canvas, video) {
  const ctx = canvas.getContext("2d");
  const sw = video.videoWidth;
  const sh = video.videoHeight;
  if (!sw || !sh) return;

  const want = canvas.width / canvas.height;
  const have = sw / sh;
  let cw = sw;
  let ch = sh;
  if (have > want) cw = sh * want;       /* too wide: take a centre column */
  else ch = sw / want;                   /* too tall: take a centre band */

  ctx.drawImage(video, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, canvas.width, canvas.height);
}

/*
 * How much is going on in a frame — brightness, and how varied it is.
 *
 * A frame can be bright and empty (a white flash) or dark and interesting, so
 * neither number decides alone. Sampled sparsely because this runs several
 * times per upload and the answer does not need every pixel.
 */
function frameInterest(canvas) {
  try {
    const d = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0;
    let sumSq = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 64) {
      const lum = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      sum += lum;
      sumSq += lum * lum;
      n++;
    }
    if (!n) return 0;
    const mean = sum / n;
    const variance = Math.max(0, sumSq / n - mean * mean);
    /* A frame nobody could see anything in is worth nothing, however varied
       the noise in it happens to be. */
    if (mean < 6) return 0;
    return mean + Math.sqrt(variance) * 2;
  } catch (err) {
    return 0;
  }
}

/* Grabs a real frame from the video, client-side.
   "Real frames only — no gradients, no coloured blocks, no generated art
   placeholders." Extracting frames server-side needs ffmpeg in a container;
   the browser already has the file in hand, so the poster costs nothing and is
   a genuine frame of the actual video. Server-side frame extraction (one every
   5s, for clip thumbnails) still belongs in the container.

   SEVERAL frames, and the best of them. This took one, a quarter of the way
   in, and on footage that opens dark that is a black card — which is what both
   of the owner's videos showed in Footage, on Home and in Clipping's picker,
   because they all read the same key. The repair path, healPoster, only ever
   runs in the editor, so a bad poster on a video you never open stayed bad for
   ever. Trying four points costs four seeks on a file the browser already has
   open, once, at upload. */
function grabPoster(file, atSeconds) {
  return new Promise((resolve, reject) => {
    const el = document.createElement("video");
    el.preload = "metadata";
    el.muted = true;
    el.playsInline = true;

    const canvas = document.createElement("canvas");
    const draw = () => drawCover(canvas, el);

    let points = [];
    let at = 0;
    let bestAt = -1;
    let bestScore = -1;
    /* The last pass seeks back to the winner and encodes THAT, rather than
       whichever frame happened to be current when the loop ended. */
    let encoding = false;

    const finish = (blob) => { URL.revokeObjectURL(el.src); resolve(blob); };

    const next = () => {
      if (at < points.length) return void (el.currentTime = points[at++]);
      if (bestAt < 0) return finish(null);
      encoding = true;
      el.currentTime = bestAt;
    };

    el.onloadedmetadata = () => {
      const dur = el.duration || 1;
      const w = 640;
      canvas.width = w;
      canvas.height = Math.round((el.videoHeight / el.videoWidth) * w) || 360;

      /* Spread across the video, and never the very first frame: a fade-in
         from black is the single most likely thing to be there. The caller's
         own point stays as one of the candidates. */
      const cap = (t) => Math.min(Math.max(0.05, t), Math.max(0.05, dur - 0.1));
      points = [...new Set([atSeconds, dur * 0.15, dur * 0.45, dur * 0.7].map(cap))];
      next();
    };

    el.onseeked = () => {
      try {
        draw();
      } catch (err) {
        /* This one gave us nothing. The others still might. */
        return next();
      }
      if (encoding) return void canvas.toBlob((b) => finish(b), "image/jpeg", 0.82);

      const score = frameInterest(canvas);
      if (score > bestScore) { bestScore = score; bestAt = el.currentTime; }
      next();
    };

    el.onerror = () => { URL.revokeObjectURL(el.src); reject(new Error("unreadable")); };
    el.src = URL.createObjectURL(file);
  });
}

/**
 * Heals a missing poster from the video that is already on screen.
 *
 * A poster is only ever grabbed in the browser at upload time. If that failed
 * — a codec the browser could not decode, a tab closed before it ran, a file
 * picked on a phone — the source had no poster and no way to ever get one, so
 * it stayed a black rectangle in Footage for good. There is no server-side
 * frame extractor to fall back on.
 *
 * The editor has the actual video loaded, which is a frame grabber we are
 * already paying for. So a source with no poster gets one the first time
 * anybody opens it, using the same endpoint the upload path uses.
 */
async function healPoster(video, sourceId) {
  try {
    const at = Math.max(1, (video.duration || 8) * 0.25);
    await new Promise((resolve, reject) => {
      const onSeek = () => { video.removeEventListener("seeked", onSeek); resolve(); };
      video.addEventListener("seeked", onSeek);
      video.addEventListener("error", reject, { once: true });
      video.currentTime = Math.min(at, Math.max(0, (video.duration || 1) - 0.1));
      setTimeout(reject, 8000);
    });

    const c = document.createElement("canvas");
    const w = 640;
    c.width = w;
    c.height = Math.round((video.videoHeight / video.videoWidth) * w) || 360;
    c.getContext("2d").drawImage(video, 0, 0, c.width, c.height);

    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.82));
    if (!blob) return;
    await fetch("/api/sources/" + sourceId + "/poster", {
      method: "POST",
      headers: { "content-type": "image/jpeg" },
      body: blob,
    });
  } catch (err) {
    /* Cross-origin taint, a codec the browser will not decode, a seek that
       never lands. A missing poster is cosmetic; failing to fix it must not
       be louder than the thing it was fixing. */
  } finally {
    /* Put the playhead back wherever it was, so healing a poster does not
       silently scrub the video the user is about to watch. */
    try { video.currentTime = 0; } catch (e) {}
  }
}

/* Reads a video's real duration without uploading it first. */
function readDuration(file) {
  return new Promise((resolve, reject) => {
    const el = document.createElement("video");
    el.preload = "metadata";
    el.onloadedmetadata = () => { URL.revokeObjectURL(el.src); resolve(el.duration || 0); };
    el.onerror = () => { URL.revokeObjectURL(el.src); reject(new Error("unreadable")); };
    el.src = URL.createObjectURL(file);
  });
}

/* ── The editor: keep and drop ─────────────────────────────────────────
   Every change goes through doUndoable, so ⌘Z reverts it and the toast's
   Undo does exactly the same thing — one path, not two that drift apart. */
document.querySelectorAll(".keep-toggle").forEach((btn) => {
  btn.addEventListener("click", () => {
    const id = btn.getAttribute("data-clip");
    const wasKept = btn.getAttribute("data-kept") === "1";
    const next = !wasKept;

    const apply = () => setKept(id, next);
    const revert = () => setKept(id, wasKept);

    window.doUndoable(next ? "Kept" : "Dropped", apply, revert);
  });
});

function setKept(clipId, kept) {
  const row = document.querySelector('[data-clip="' + clipId + '"][data-kept]');
  const btn = document.querySelector('.keep-toggle[data-clip="' + clipId + '"]');
  if (row) {
    row.setAttribute("data-kept", kept ? "1" : "0");
    row.style.opacity = kept ? "" : ".55";
    const quote = row.querySelector("div > div");
    if (quote) {
      quote.style.textDecoration = kept ? "" : "line-through";
      quote.style.textDecorationColor = kept ? "" : "rgba(236,236,241,0.35)";
    }
  }
  if (btn) {
    btn.setAttribute("data-kept", kept ? "1" : "0");
    const pill = btn.querySelector("span");
    if (pill) {
      pill.textContent = kept ? "Keeping" : "Add back";
      pill.style.background = kept ? "rgba(94,201,143,0.14)" : "#232329";
      pill.style.color = kept ? "#5EC98F" : "rgba(236,236,241,0.7)";
      pill.style.fontWeight = kept ? "600" : "500";
    }
  }
  /* Autosave: every edit writes immediately. There is no Save button in this
     design and adding one would be wrong (10-ROUTES-AND-KEYS.md §Autosave). */
  fetch("/api/clips/" + clipId + "/keep", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kept }),
  }).catch(() => toast("That didn't save — check your connection"));
}

/* An extra pass against what it already found. */
const passForm = document.querySelector(".pass-form");
if (passForm) {
  passForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = passForm.querySelector('input[name="instruction"]');
    const button = passForm.querySelector('button[type="submit"]');
    const instruction = input.value.trim();
    if (!instruction) return;

    button.disabled = true;
    button.textContent = "Running…";
    try {
      const res = await fetch("/api/projects/" + passForm.getAttribute("data-project") + "/passes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instruction }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "That pass didn't run");
      location.reload();
    } catch (err) {
      button.disabled = false;
      button.textContent = "Run it";
      toast(err.message);
    }
  });
}

/* Waiting on a scoring pass. */
/*
 * A pass, while it runs.
 *
 * The poll used to rewrite a label and drop job.pct on the floor, which is
 * why "Find the strong bits" looked like nothing was happening: the label is
 * set once when the job is created and never changes on its own.
 *
 * Everything here is measured. The bar is windows of transcript finished, and
 * the clock is elapsed time shown AS elapsed time — next to the bar, never
 * driving it.
 */
const scoring = document.querySelector("#scoring");
if (scoring) {
  const projectId = scoring.getAttribute("data-project");
  const label = document.querySelector("#scoring-label");
  const bar = document.querySelector("#scoring-bar");
  const pctEl = document.querySelector("#scoring-pct");
  const clockEl = document.querySelector("#scoring-clock");
  const startedAt = Date.now();

  const tickClock = setInterval(() => {
    const s2 = Math.round((Date.now() - startedAt) / 1000);
    if (clockEl) clockEl.textContent = Math.floor(s2 / 60) + ":" + String(s2 % 60).padStart(2, "0");
  }, 1000);

  const tick = async () => {
    try {
      const { jobs } = await (await fetch("/api/jobs")).json();
      const job = (jobs || []).find((j) => j.ref_id === projectId);
      /* Gone from the active list means finished, one way or the other. The
         reload is what brings the scores onto the blocks. */
      if (!job) { clearInterval(tickClock); location.reload(); return; }
      if (label && job.stage_label) label.textContent = job.stage_label;
      if (typeof job.pct === "number") {
        if (bar) bar.style.width = job.pct + "%";
        if (pctEl) pctEl.textContent = job.pct + "%";
      }
      setTimeout(tick, 2000);
    } catch { setTimeout(tick, 5000); }
  };
  setTimeout(tick, 1500);
}

/* ── Script mode: striking words ───────────────────────────────────────
   Clicking a word strikes that word; clicking the timecode strikes the line.
   Both route through doUndoable like every other edit, so ⌘Z reverts them.

/* The transcript-editor handler lived here, bound to #script and .seg-cut —
 * the markup of script.ts, deleted with the four-stage editor. The live
 * word and line gestures are the .blk delegation further up this file. */

/* Clean up, from the Pick surface. Same server-side cut model as Script — the
   two surfaces are different views of one edit, not two edits. */
document.querySelectorAll(".cleanup[data-project]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const kind = btn.getAttribute("data-kind");
    if (kind !== "fillers" && kind !== "pauses") { toast("Not wired up yet"); return; }
    btn.disabled = true;
    const label = btn.querySelector("span");
    try {
      const res = await fetch("/api/projects/" + btn.getAttribute("data-project") + "/cuts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, seg: 0, word: null }),
      });
      if (!res.ok) throw new Error("That didn't apply");
      /* Reload so every number on the page — the chip sublabels, the kept
         count, the runtime — comes back from the server together. Patching
         them individually is how they drift apart. */
      location.reload();
    } catch (err) {
      btn.disabled = false;
      toast(err.message);
    }
  });
});

/* Export. Every render is a new version — the old one is never replaced. */
/* "Export as" opens the choice it always implied. It used to post mp4_1080 and
   16:9 straight away — hardcoded — so vertical was unreachable and 4K, the
   thing Settings sells, could not be picked. */
const exportPanel = document.querySelector("#export-panel");
document.querySelectorAll(".export-open").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!exportPanel) return;
    exportPanel.hidden = !exportPanel.hidden;
    if (!exportPanel.hidden) exportPanel.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
});

if (exportPanel) {
  exportPanel.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submit = exportPanel.querySelector("button[type=submit]");
    const data = new FormData(exportPanel);
    submit.disabled = true;
    submit.textContent = "Putting it together…";
    try {
      const res = await fetch("/api/renders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: exportPanel.getAttribute("data-project"),
          format: data.get("format"),
          aspect: data.get("aspect"),
          captionStyle: data.get("captionStyle"),
        }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || "That didn't render");
      /* Reload so the export appears in the list below, which is where it
         lives now — the old code toasted about an "Exports" that never was. */
      location.reload();
    } catch (err) {
      submit.disabled = false;
      submit.textContent = "Export";
      toast((err && err.message) || "That didn't render");
    }
  });

  /* No JS repaint for the chips: .exp-chip:has(input:checked) in the shell's
     CSS does it, which keeps the colours as tokens rather than hexes the
     client would have to hardcode. */
}

/* An export in flight. Polls only while something is actually working —
   data-working is 0 once every render has finished, and then this does
   nothing at all rather than talking to the server for ever. */
const exportsEl = document.querySelector("#exports");
if (exportsEl && exportsEl.getAttribute("data-working") === "1") {
  const project = exportsEl.getAttribute("data-project");
  const tick = setInterval(async () => {
    try {
      const res = await fetch("/api/projects/" + project + "/renders");
      if (!res.ok) return;
      const { renders } = await res.json();
      const busy = (renders || []).some((r) => r.state === "queued" || r.state === "running");
      if (!busy) { clearInterval(tick); location.reload(); }
    } catch (err) {
      /* A blip is not a reason to stop watching; the next tick tries again. */
    }
  }, 4000);
}

/* Subscribe, or manage an existing subscription. Both are a redirect to
   Stripe's own hosted page — no card fields ever live on this origin. */
const planAction = document.querySelector("#planAction");
if (planAction) {
  /* Arriving from the landing page's "Start with Studio": the plan was chosen
     before there was an account to attach it to, so checkout opens itself
     here rather than asking again for something already asked. */
  if (new URLSearchParams(location.search).get("checkout") === "studio" &&
      planAction.getAttribute("data-mode") === "checkout") {
    setTimeout(() => planAction.click(), 0);
  }
  planAction.addEventListener("click", async () => {
    planAction.disabled = true;
    const was = planAction.textContent;
    planAction.textContent = "One moment…";
    try {
      const res = await fetch("/api/billing/" + planAction.getAttribute("data-mode"), { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || "That didn't open");
      location.href = data.url;
    } catch (err) {
      planAction.disabled = false;
      planAction.textContent = was;
      toast((err && err.message) || "That didn't open");
    }
  });
}

/* The Build preview player lived here, bound to #es-video and #es-toggle,
 * both from build.ts, deleted with the four-stage editor. The editor's own
 * player is #cut-video. */

/* ── Build: the controls that were rendered and wired to nothing ───────
   Each of these looked operable and did nothing, which is worse than not
   shipping them. The endpoints all existed; the UI pointed at routes that
   were never defined, or at no route at all. */






/**
 * Start uploading one file.
 *
 * Lifted out of Footage's change handler so every entry point shares it —
 * the button, a drop, and the bulk path below. It was inline and therefore
 * single-file by construction.
 */
async function startUpload(file) {
  const durationS = await readDuration(file).catch(() => 0);
  const start = await fetch("/api/uploads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ filename: file.name, contentType: file.type || "video/mp4", bytes: file.size, durationS }),
  }).then((r) => r.json());
  if (start.error) throw new Error(start.error);

  grabPoster(file, Math.max(1, (durationS || 8) * 0.25))
    .then((blob) =>
      blob &&
      fetch("/api/sources/" + start.source.id + "/poster", {
        method: "POST",
        headers: { "content-type": "image/jpeg" },
        body: blob,
      }),
    )
    .catch(() => {});

  const sw = await uploadWorker();
  if (!sw) throw new Error("Uploads need a modern browser here");

  /* Parked before the worker is told about it, so an upload can always be
     picked back up even if this page goes away one second later. */
  await parkFile(start.source.id, file);

  const msg = {
    type: "start-upload",
    file,
    sourceId: start.source.id,
    uploadId: start.uploadId,
    partSize: start.partSize,
    mode: start.mode,
    durationS,
  };
  inFlight.set(start.source.id, { msg, doneParts: [], timer: null });
  sw.postMessage(msg);
  watchUpload(start.source.id);
  showUpload({ sourceId: start.source.id, name: file.name, pct: 0, totalBytes: file.size, sent: 0 });
  return start.source.id;
}

/**
 * Start several — really in sequence this time.
 *
 * You could only ever add one video at a time, because every picker was a bare
 * input with no multiple attribute and every handler read files[0].
 *
 * The loop said it queued them and did not: await startUpload(file) only
 * waits as far as sw.postMessage, which returns the instant the message is
 * posted. All N then ran together in the worker at four parts each — ten files
 * really was forty parallel connections fighting for one uplink, with every
 * file crawling and the account's 20-an-hour limit tripped on the way.
 *
 * So this waits for each upload to actually FINISH, watching the same
 * broadcasts the chips do. A failure does not stop the queue: the rest of the
 * shoot should still go up, and the one that failed keeps its own row with a
 * way to pick it up.
 */
const UPLOAD_QUEUE_LIMIT = 2;

function whenSettled(sourceId) {
  return new Promise((resolve) => {
    const done = (e) => {
      const m = e.data || {};
      if (m.sourceId !== sourceId) return;
      if (m.type === "upload-done" || m.type === "upload-failed" || m.type === "upload-cancelled") {
        navigator.serviceWorker.removeEventListener("message", done);
        resolve(m.type);
      }
    };
    navigator.serviceWorker.addEventListener("message", done);
    /* Never wait for ever: if the worker dies mid-file the watchdog surfaces
       it, and the queue has to keep moving regardless. */
    setTimeout(() => {
      navigator.serviceWorker.removeEventListener("message", done);
      resolve("timeout");
    }, 30 * 60 * 1000);
  });
}

async function startUploads(files) {
  const list = [...(files || [])].filter((f) => f && f.size > 0);
  if (!list.length) return;
  if (list.length > 1) toast(list.length + " videos queued — you can carry on browsing");

  let failed = 0;
  const lane = [];
  for (const file of list) {
    /* A couple at a time: enough to keep the uplink busy while one file is
       finishing its last part, not enough to starve them all. */
    while (lane.length >= UPLOAD_QUEUE_LIMIT) await Promise.race(lane);
    let id;
    try {
      id = await startUpload(file);
    } catch (err) {
      failed += 1;
      toast((err && err.message) || ("Couldn't add " + file.name));
      continue;
    }
    const p = whenSettled(id).then((how) => {
      if (how === "upload-failed") failed += 1;
      lane.splice(lane.indexOf(p), 1);
    });
    lane.push(p);
  }
  await Promise.allSettled(lane);

  const ok = list.length - failed;
  if (list.length > 1) toast(ok + " of " + list.length + " uploaded" + (failed ? " — the rest kept their row" : ""));
}

/* Footage's Upload button. It was a bare label with a file input and no
   handler at all, so the most obvious way into the product did nothing. */
const footageUpload = document.querySelector("#footageUpload");
if (footageUpload) {
  footageUpload.addEventListener("change", (e) => {
    startUploads(e.target.files);
    /* Clear it, or picking the same file twice in a row fires no change
       event and looks like the button broke. */
    e.target.value = "";
  });
}

/* Drop anywhere on Footage. The grid is the obvious target and was inert. */
const footageDrop = document.querySelector("#footage-grid");
if (footageDrop) {
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  footageDrop.addEventListener("dragover", stop);
  footageDrop.addEventListener("drop", (e) => { stop(e); startUploads(e.dataTransfer?.files); });
}

/*
 * The clip picker lived here — openPicker(), #clip-picker, #clip-picker-list
 * and .pick-clip — rendered only by build.ts, which went with the
 * four-stage editor. It is the machinery behind the seam's "A clip"
 * option, which the one editor does not offer yet; git has it when that
 * is built, and a copy nothing can reach is worse than no copy.
 */



/* "Generate it" on a beat that wants your voice.
   Recording is still the real answer and stays the primary button; this is
   for filling a beat so the whole cut can be watched before you commit to
   recording anything. */
/* The standalone "Generate it" binding lived here. It is handled by the
   delegated router above now, which also reaches "Generate" — the same job
   under a shorter label, which was dead because only the longer one was bound. */

/*
 * In-browser recording for an inserted block.
 *
 * Nothing reaches the server until you press Stop & keep, so a take you
 * abandon costs nothing and leaves nothing behind — and Cancel is a real way
 * out rather than "record over it".
 *
 * The bars are the microphone, not decoration. An AnalyserNode over the live
 * stream drives 24 heights per frame, which is the difference between knowing
 * the mic is working and hoping it is. This was a button with no waveform, no
 * clock and no cancel; the design was in the prototype the whole time.
 */
async function record(button) {
  const panel = button.closest(".blk-rec");
  if (!panel || panel.dataset.recording === "1") return;

  const idle = panel.querySelector(".rec-idle");
  const live = panel.querySelector(".rec-live");
  const clock = panel.querySelector(".rec-clock");
  const bars = [...panel.querySelectorAll(".rec-bar")];
  const beatId = panel.getAttribute("data-beat");

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    /* Denied, or no microphone at all. Both are the user's to fix and neither
       is an error in the page, so say what happened and stay put. */
    toast("Couldn't reach your microphone — check the browser's permission for this site.");
    return;
  }

  panel.dataset.recording = "1";
  idle.hidden = true;
  live.hidden = false;

  const chunks = [];
  const started = Date.now();
  const recorder = new MediaRecorder(stream);
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  /* The meter. A separate AudioContext from anything else on the page, closed
     with the take so the microphone light goes out when recording stops. */
  let audio = null;
  let frame = 0;
  try {
    audio = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audio.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.6;
    audio.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    const draw = () => {
      analyser.getByteFrequencyData(data);
      for (let i = 0; i < bars.length; i++) {
        /* 3px is the resting height in the prototype, 18px the row's own
           height, so a bar never pushes the panel taller than it starts. */
        const v = data[Math.floor((i / bars.length) * data.length)] / 255;
        bars[i].style.height = (3 + Math.round(v * 15)) + "px";
      }
      frame = requestAnimationFrame(draw);
    };
    draw();
  } catch {
    /* No Web Audio: the bars simply do not move. Everything else still works,
       which is better than refusing to record. */
  }

  const tick = setInterval(() => {
    const s2 = Math.round((Date.now() - started) / 1000);
    clock.textContent = Math.floor(s2 / 60) + ":" + String(s2 % 60).padStart(2, "0");
  }, 250);

  const teardown = () => {
    clearInterval(tick);
    if (frame) cancelAnimationFrame(frame);
    if (audio) audio.close().catch(() => {});
    stream.getTracks().forEach((t) => t.stop());
    panel.dataset.recording = "0";
    live.hidden = true;
    idle.hidden = false;
    bars.forEach((b) => { b.style.height = "3px"; });
    clock.textContent = "0:00";
  };

  let keeping = true;

  recorder.onstop = async () => {
    const ms = Date.now() - started;
    teardown();
    if (!keeping) return;

    /* A tap on Stop is not a take. Saving a 200ms blip would leave a beat
       looking filled with nothing in it. */
    if (ms < 400 || !chunks.length) {
      toast("That was too short to keep.");
      return;
    }

    const stopBtn = panel.querySelector(".rec-stop");
    if (stopBtn) stopBtn.textContent = "Saving…";
    try {
      const res = await fetch("/api/beats/" + beatId + "/record", {
        method: "POST",
        headers: { "content-type": "audio/webm", "x-duration-ms": String(ms) },
        body: new Blob(chunks, { type: "audio/webm" }),
      });
      if (!res.ok) throw new Error("That take didn't save");
      location.reload();
    } catch (err) {
      if (stopBtn) stopBtn.textContent = "Stop & keep";
      toast((err && err.message) || "That take didn't save");
    }
  };

  const stop = (keep) => {
    keeping = keep;
    if (recorder.state !== "inactive") recorder.stop();
    else teardown();
  };

  live.querySelector(".rec-stop").addEventListener("click", () => stop(true), { once: true });
  live.querySelector(".rec-cancel").addEventListener("click", () => stop(false), { once: true });
  recorder.start();
}

/*
 * "Make a short" on a moment in Footage.
 *
 * The same route Clipping's own card uses — a moment is a moment wherever you
 * are looking at it, and there is no second renderer.
 */
document.querySelectorAll(".moment-short").forEach((btn) => {
  btn.addEventListener("click", async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    const was = btn.textContent;
    btn.textContent = "Making it…";
    try {
      const res = await fetch("/api/clips/" + btn.getAttribute("data-clip") + "/render", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ aspect: "9:16", captionStyle: "None" }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || "That didn't start");
      toast("Making it — it'll show up here when it's done.");
    } catch (err) {
      btn.disabled = false;
      btn.textContent = was;
      toast((err && err.message) || "That didn't start");
    }
  });
});

/* Clipping's drop zone. The video lands in Footage like any other source —
   the surface says so — and then this page reopens on it, so the drop and the
   clip run are one gesture rather than two. Reuses the same resumable upload
   and real-frame poster grab as the Home composer; a video dropped here must
   not arrive with a worse record of itself than one dropped there. */
const clipDrop = document.querySelector("#clipDrop");
if (clipDrop) {
  const pick = clipDrop.querySelector("#clipFilePick");
  const label = clipDrop.querySelector("span");
  const original = label ? label.innerHTML : "";

  const send = async (file) => {
    if (!file) return;
    if (label) label.textContent = "Uploading…";
    try {
      const durationS = await readDuration(file).catch(() => 0);

      const start = await fetch("/api/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type || "video/mp4", bytes: file.size, durationS }),
      }).then((r) => r.json());
      if (start.error) throw new Error(start.error);

      /* Poster first, from the local file, so navigating away cannot lose it. */
      grabPoster(file, Math.max(1, (durationS || 8) * 0.25))
        .then((blob) =>
          blob &&
          fetch("/api/sources/" + start.source.id + "/poster", {
            method: "POST",
            headers: { "content-type": "image/jpeg" },
            body: blob,
          }),
        )
        .catch(() => {});

      /* Same worker as the composer. A drop here used to die on navigation for
         exactly the same reason, and would have been easy to miss once the
         composer was fixed. */
      const sw = await uploadWorker();
      if (sw) {
        const msg = {
          type: "start-upload",
          file,
          sourceId: start.source.id,
          uploadId: start.uploadId,
          partSize: start.partSize,
          mode: start.mode,
          durationS,
        };
        inFlight.set(start.source.id, { msg, doneParts: [], timer: null });
        sw.postMessage(msg);
        watchUpload(start.source.id);
        showUpload({ sourceId: start.source.id, name: file.name, pct: 0 });
        if (label) label.innerHTML = original;
        return;
      }

      const guard = (ev) => { ev.preventDefault(); ev.returnValue = ""; };
      window.addEventListener("beforeunload", guard);
      try {
        await uploadResumable(file, durationS, (pct) => {
          if (label) label.textContent = "Uploading " + pct + "%";
        }, start);
        location.href = "/clipping?source=" + start.source.id;
      } finally {
        window.removeEventListener("beforeunload", guard);
      }
    } catch (err) {
      if (label) label.innerHTML = original;
      toast(err.message || "Couldn't add that video");
    }
  };

  pick?.addEventListener("change", (e) => send(e.target.files?.[0]));
  ["dragenter", "dragover"].forEach((ev) =>
    clipDrop.addEventListener(ev, (e) => {
      e.preventDefault();
      clipDrop.style.boxShadow = "inset 0 0 0 1px rgba(217,179,106,0.45)";
    }),
  );
  ["dragleave", "drop"].forEach((ev) =>
    clipDrop.addEventListener(ev, (e) => {
      e.preventDefault();
      clipDrop.style.boxShadow = "inset 0 0 0 1px rgba(255,255,255,0.05)";
    }),
  );
  clipDrop.addEventListener("drop", (e) => send(e.dataTransfer?.files?.[0]));
}

/* Make the video of one short. Rendering costs money, so it happens when you
   ask and not because a scoring pass found something. */
/*
 * CLIPPING'S CARDS.
 *
 * Each paints its own moment rather than wearing the source's first frame,
 * and each gets its own player — the same two pieces the editor uses, called
 * per card. Footage's clip grid carries exactly the same three parts, so it is
 * the same block rather than a second copy of it.
 */
const shortCards = document.querySelectorAll("[data-short], [data-moment]");
if (shortCards.length) paintMoments(document.querySelectorAll(".short-frame"), "");

/*
 * EVERY player bar on the page, wired to the video it belongs to.
 *
 * There were three call sites — the editor reached for the page's only
 * .player, the cards looped their own, and the source page had a bar that
 * nothing wired at all, so /sources/:id shipped with a player made of dead
 * buttons. Nobody had opened that page; the conventions check found it.
 *
 * A bar belongs to the video nearest it: inside the same wrapper if there is
 * one, otherwise the page's own. One rule, so a fourth surface that renders
 * the markup works without anybody remembering to add a fourth case.
 */
const allVideos = document.querySelectorAll("video");
document.querySelectorAll(".player").forEach((bar) => {
  const own = (bar.parentElement || document).querySelector("video");
  /* Falling back to the page's first video is only safe when there IS only
     one. On a grid of cards it would wire one card's bar to another card's
     video, and pressing play would start something else entirely. */
  const video = own || (allVideos.length === 1 ? allVideos[0] : null);
  if (video) wirePlayer(bar, video);
});

/*
 * ADJUST — the verb the clipper never had.
 *
 * Everything a short is can be changed before a render is spent on it: where
 * it starts and ends, by a second at a time or by pointing at the words. The
 * server writes start_ms and end_ms, which is exactly what renderShort builds
 * its plan from, so a trimmed clip renders trimmed with nothing downstream
 * needing to know.
 */
const adjust = document.querySelector("#adjust");
if (adjust) {
  /*
   * OUT OF THE PAGE BODY, or it is not fixed to anything.
   *
   * The shell animates each surface in with viewIn, which leaves a transform
   * on the wrapper — and a transformed ancestor becomes the containing block
   * for position:fixed. So the sheet laid itself out against the whole scrolled
   * page instead of the viewport: the scrim covered everything and the panel
   * was a thousand pixels below the fold. That is why the shell's own overlays
   * (the palette, the key sheet) are rendered outside the page body, and this
   * one has to be too — it belongs to Clipping, so it ships with the page and
   * moves itself rather than being hoisted into the shell.
   */
  document.body.appendChild(adjust);
  const wordsEl = adjust.querySelector(".adj-words");
  const headEl = adjust.querySelector(".adj-head");
  const tailEl = adjust.querySelector(".adj-tail");
  const fromEl = adjust.querySelector(".adj-from");
  const durEl = adjust.querySelector(".adj-dur");
  const frame = adjust.querySelector(".adj-frame");
  const capWrap = adjust.querySelector(".adj-cap");
  const whyWrap = adjust.querySelector(".adj-why");
  const whyHead = adjust.querySelector(".adj-why-head");
  const whyText = adjust.querySelector(".adj-why-text");
  const well = adjust.querySelector(".adj-well");

  let clip = null;
  /* The bounds as edited here, saved when they settle rather than on every
     press of a stepper — five taps on + is one clip, not five writes. */
  let start = 0;
  let end = 0;
  let saveTimer = null;
  let pendingWord = null;
  let decoder = null;

  const secs = (ms) => {
    const t = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
    return h > 0
      ? h + ":" + String(m).padStart(2, "0") + ":" + String(sec).padStart(2, "0")
      : m + ":" + String(sec).padStart(2, "0");
  };

  /* The frame at the in-point, so the preview is of the short you are about to
     make rather than of wherever it used to begin. */
  const drawFrame = () => {
    if (!clip || !frame || !decoder) return;
    const done = () => {
      try {
        drawCover(frame, decoder);
      } catch (err) {
        /* No frame. The sheet is complete without one. */
      }
    };
    decoder.addEventListener("seeked", done, { once: true });
    decoder.currentTime = start / 1000;
  };

  const paint = () => {
    if (!clip) return;
    if (headEl) headEl.textContent = secs(start);
    if (tailEl) tailEl.textContent = secs(end);
    if (fromEl) fromEl.textContent = "from " + secs(start);
    if (durEl) durEl.textContent = secs(end - start);

    wordsEl.querySelectorAll("[data-s]").forEach((w) => {
      const ws = Number(w.getAttribute("data-s"));
      const we = Number(w.getAttribute("data-e"));
      const inside = we > start && ws < end;
      w.style.color = inside ? "#ECECF1" : "rgba(236,236,241,0.32)";
      w.style.background = inside ? "rgba(94,201,143,0.14)" : "transparent";
    });
  };

  const save = async () => {
    if (!clip) return;
    try {
      const res = await fetch("/api/clips/" + clip.id + "/trim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ start_ms: Math.round(start), end_ms: Math.round(end) }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || "That didn't save");
      /* The server clamps to the video and refuses a clip of nothing, so what
         it sends back is the truth about the bounds, not what was asked. */
      start = out.start_ms;
      end = out.end_ms;
      paint();
    } catch (err) {
      toast((err && err.message) || "That didn't save");
    }
  };

  const queueSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 400);
  };

  const nudge = (which, deltaMs) => {
    if (!clip) return;
    if (which === "head") start = Math.max(0, Math.min(start + deltaMs, end - 500));
    else end = Math.max(start + 500, end + deltaMs);
    pendingWord = null;
    paint();
    drawFrame();
    queueSave();
  };

  const open = async (clipId) => {
    adjust.hidden = false;
    wordsEl.innerHTML = "";
    clip = null;
    try {
      const res = await fetch("/api/clips/" + clipId);
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || "Couldn't open that");
      clip = out;
      start = out.start_ms;
      end = out.end_ms;
      pendingWord = null;

      /* Why the model liked it, when a model picked it at all. A clip you
         chose yourself was not scored, and saying "0" about it is the bug this
         whole card was carrying. */
      if (whyWrap) {
        const scored = out.score != null && out.score > 0;
        whyWrap.hidden = !(scored || out.origin === "manual");
        if (whyHead) whyHead.textContent = scored ? "Why it scored " + out.score : "Yours";
        if (whyText) whyText.textContent = scored ? (out.why || "") : "You picked this one — it was never scored.";
      }

      wordsEl.innerHTML = (out.words || [])
        .map(
          (w) =>
            '<span data-s="' + w.s + '" data-e="' + w.e + '" style="padding:1px 5px;border-radius:4px;cursor:pointer">' +
            escapeHtml(w.w) + "</span>",
        )
        .join("");

      if (capWrap) {
        /* What the caption will look like, in the style chosen on the page —
           the preview exists so the short can be judged before it is paid for. */
        const form = document.querySelector(".clip-form");
        const style = form ? new FormData(form).get("captionStyle") : "None";
        capWrap.hidden = style === "None";
        const span = capWrap.querySelector("span");
        if (span) span.textContent = (out.quote || "").split(/\s+/).slice(0, 6).join(" ");
        if (span && style === "Clean") {
          span.style.background = "transparent";
          span.style.color = "#ECECF1";
          span.style.fontWeight = "600";
        }
        const aspect = String((form ? new FormData(form).get("aspect") : "9:16") || "9:16");
        if (well) well.style.aspectRatio = aspect.replace(":", "/");
        /* The canvas has to be the chosen shape too, or drawCover crops to
           9:16 and the browser then stretches that into a 1:1 well — the
           preview would be lying about the thing it exists to show. */
        const [aw, ah] = aspect.split(":").map(Number);
        if (frame && aw && ah) {
          frame.width = 270;
          frame.height = Math.round((270 * ah) / aw);
        }
      }

      if (decoder) decoder.remove();
      decoder = document.createElement("video");
      decoder.src = "/media/" + out.sourceKey;
      decoder.muted = true;
      decoder.playsInline = true;
      decoder.preload = "metadata";
      decoder.addEventListener("loadedmetadata", drawFrame, { once: true });
      decoder.load();

      paint();
    } catch (err) {
      adjust.hidden = true;
      toast((err && err.message) || "Couldn't open that");
    }
  };

  document.querySelectorAll(".short-edit").forEach((btn) => {
    btn.addEventListener("click", () => void open(btn.getAttribute("data-clip")));
  });

  adjust.querySelectorAll("[data-close]").forEach((el) => {
    el.addEventListener("click", () => {
      adjust.hidden = true;
      /* Any pending nudge is written before the sheet goes, or closing it
         quickly after a tap would lose the trim. */
      clearTimeout(saveTimer);
      if (clip) void save().then(() => location.reload());
    });
  });

  adjust.querySelector(".adj-head-minus")?.addEventListener("click", () => nudge("head", -1000));
  adjust.querySelector(".adj-head-plus")?.addEventListener("click", () => nudge("head", 1000));
  adjust.querySelector(".adj-tail-minus")?.addEventListener("click", () => nudge("tail", -1000));
  adjust.querySelector(".adj-tail-plus")?.addEventListener("click", () => nudge("tail", 1000));

  /*
   * Trim by word. The first click sets the start; the second sets the end.
   *
   * The prototype uses right-click for the end, which is unreachable on a
   * phone and hidden on a desktop. Two clicks in a row say the same thing and
   * the line above the words explains it.
   */
  wordsEl.addEventListener("click", (e) => {
    const w = e.target.closest("[data-s]");
    if (!w || !clip) return;
    const ws = Number(w.getAttribute("data-s"));
    const we = Number(w.getAttribute("data-e"));

    if (pendingWord === null) {
      start = ws;
      end = Math.max(we, ws + 500);
      pendingWord = ws;
    } else {
      /* A second word before the first is a start, not a backwards clip. */
      if (we <= pendingWord) { start = ws; end = Math.max(we, ws + 500); pendingWord = ws; }
      else { end = we; pendingWord = null; }
    }
    paint();
    drawFrame();
    queueSave();
  });

  adjust.querySelector(".adj-reset")?.addEventListener("click", () => {
    if (!clip) return;
    start = clip.start_ms;
    end = clip.end_ms;
    pendingWord = null;
    paint();
    drawFrame();
    queueSave();
  });

  /* Make it from here, so the sheet is somewhere you finish rather than
     somewhere you pass through. */
  adjust.querySelector(".adj-make")?.addEventListener("click", async () => {
    if (!clip) return;
    clearTimeout(saveTimer);
    await save();
    const card = document.querySelector('[data-short="' + clip.id + '"] .make-short');
    adjust.hidden = true;
    if (card) card.click();
    else location.reload();
  });
}

document.querySelectorAll(".make-short").forEach((btn) => {
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    const was = btn.textContent;
    btn.textContent = "Making it…";
    /*
     * Shape and Captions, as chosen on the page.
     *
     * These used to live inside the SCAN form, which only exists once you have
     * picked a video to scan — so on the page you actually land on there was
     * no form to read and this sent captionStyle "None", while the lede above
     * it promised "captions burned in". The settings are their own form now
     * and are on the page either way.
     */
    const form = document.querySelector(".clip-form");
    const data = form ? new FormData(form) : null;
    try {
      const res = await fetch("/api/clips/" + btn.getAttribute("data-clip") + "/render", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          aspect: data ? data.get("aspect") : "9:16",
          captionStyle: data ? data.get("captionStyle") : "None",
        }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) || {}).error || "That didn't start");
      location.reload();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = was;
      toast((err && err.message) || "That didn't start");
    }
  });
});

/* A short being made. Polls only while one actually is, and stops when none
   are — the same rule as the exports list. */
if (document.querySelector('[data-short][data-state="queued"], [data-short][data-state="running"]')) {
  const tick = setInterval(async () => {
    try {
      const res = await fetch("/api/jobs");
      if (!res.ok) return;
      const { jobs } = await res.json();
      if (!(jobs || []).some((j) => j.type === "render")) { clearInterval(tick); location.reload(); }
    } catch (err) {
      /* A blip is not a reason to stop watching. */
    }
  }, 4000);
}

/* ── Clipping ──────────────────────────────────────────────────────────
   Two ways to find a moment: a scored batch, or a search for one it missed.
   Both start a job the page then follows. */
/* The chips are radios, so keyboard and form semantics come for free; the
   visual state has to follow the checked one. Both forms have them — how a
   short comes out (.clip-form) and what to look for (.clip-scan) — so this is
   bound to each rather than to one of them. */
document.querySelectorAll(".clip-form, .clip-scan").forEach((form) => {
  form.addEventListener("change", () => {
    form.querySelectorAll("input[type=radio]").forEach((input) => {
      const chip = input.nextElementSibling;
      if (!chip) return;
      chip.style.background = input.checked ? "#2E2E36" : "#17171B";
      chip.style.color = input.checked ? "#ECECF1" : "rgba(236,236,241,0.55)";
    });
  });
});

const clipForm = document.querySelector(".clip-scan");
if (clipForm) {
  clipForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const button = clipForm.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = "Finding clips…";
    const data = new FormData(clipForm);
    try {
      const res = await fetch("/api/shorts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceId: clipForm.getAttribute("data-source"),
          length: data.get("length"),
          count: Number(data.get("count")),
          /* Shape and Captions were on the form and never left the page: the
             client did not send them, /api/shorts had no field for them, and
             ShortsOpts had none either. They are the render's, not the search's
             — carried on each short's own render request. */
        }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || "That didn't run");
      location.reload();
    } catch (err) {
      button.disabled = false;
      button.textContent = "Find clips";
      toast(err.message);
    }
  });
}

const askForm = document.querySelector(".clip-ask");
if (askForm) {
  askForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = askForm.querySelector('input[name="q"]');
    const button = askForm.querySelector('button[type="submit"]');
    const q = input.value.trim();
    if (!q) return;
    button.disabled = true;
    button.textContent = "Looking…";
    try {
      const res = await fetch("/api/shorts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceId: askForm.getAttribute("data-source"), query: q }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || "That didn't run");
      location.reload();
    } catch (err) {
      button.disabled = false;
      button.textContent = "Find it";
      toast(err.message);
    }
  });
}

/* Following a Clipping run. */
const clipJob = $("#clipping-job");
if (clipJob) {
  const sourceId = clipJob.getAttribute("data-source");
  const tick = async () => {
    try {
      const { jobs } = await (await fetch("/api/jobs")).json();
      const job = jobs.find((j) => j.ref_id === sourceId);
      if (!job) { location.reload(); return; }
      const label = clipJob.querySelector("span:last-child");
      if (label && job.stage_label) label.textContent = job.stage_label;
      setTimeout(tick, 2000);
    } catch { setTimeout(tick, 5000); }
  };
  setTimeout(tick, 1500);
}

/* ── Watching a source being read ──────────────────────────────────────
   Polls the job rather than guessing, and reloads once the transcript is
   actually there. Nothing here animates on a timer. */
const reading = $("#reading");
if (reading) {
  const sourceId = reading.getAttribute("data-source");
  const tick = async () => {
    try {
      const res = await fetch("/api/jobs");
      const { jobs } = await res.json();
      const job = jobs.find((j) => j.ref_id === sourceId);
      if (!job) { location.reload(); return; }
      const label = reading.querySelector("span:last-child");
      if (label && job.stage_label) {
        label.textContent = job.pct > 0 ? job.stage_label + " — " + job.pct + "%" : job.stage_label;
      }
      setTimeout(tick, 2000);
    } catch {
      setTimeout(tick, 5000);
    }
  };
  setTimeout(tick, 1500);
}
`;
