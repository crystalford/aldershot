/**
 * The client runtime, served at /app.js.
 *
 * Deliberately small: the design's interactions are simple enough that
 * hydration islands are plenty (07-CLAUDE-CODE-BRIEF.md §Stack). No framework.
 *
 * The keyboard map is from docs/archive/handoff-v2/10-ROUTES-AND-KEYS.md. Two rules from
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

/*
 * SAYING SO WHEN IT SAVED.
 *
 * Every gesture in the editor writes immediately — there is no Save button
 * and adding one would be wrong — and the page said nothing at all about it,
 * on a product where each click alters a video. Quiet, in the bar you are
 * already watching the runtime in, and only when there is something true to
 * report.
 */
let savedTimer = null;
function saved(state) {
  const el = document.querySelector("#saved-state");
  if (!el) return;
  clearTimeout(savedTimer);
  if (state === "saving") {
    el.hidden = false;
    el.textContent = "saving…";
    return;
  }
  if (state === "failed") {
    el.hidden = false;
    el.textContent = "not saved";
    return;
  }
  el.hidden = false;
  el.textContent = "saved";
  savedTimer = setTimeout(() => { el.hidden = true; }, 2200);
}
window.saved = saved;

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
/* Every wired player, by its video element, so a control rendered elsewhere
   on the page can put one into cut mode after the fact. */
const players = new Map();

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

  /*
   * WATCHING THE CUT.
   *
   * Null until the editor turns it on. When it is set, this player stops
   * being a window onto the whole source and becomes a window onto the EDIT:
   * the playhead skips whatever you struck, the clock counts the cut's
   * length rather than the video's, and the scrub bar spans the cut.
   *
   * The ranges come from GET /api/projects/:id/edl, which is the same builder
   * the export is cut from — so the preview cannot drift from the file. That
   * endpoint has existed since the editor was written, says in its own comment
   * that it is there so "the number a user sees and the video they get come
   * from the same place", and had never been called by anything.
   *
   * Each range carries where it starts in CUT time, so mapping either way is a
   * lookup rather than a scan.
   */
  let cut = null;

  /* Where in the cut is this moment of this file? Null if the moment is not
     in the cut at all — a struck line, or a different video. */
  const cutTimeOf = (key, srcT) => {
    if (!cut) return null;
    for (const r of cut.ranges) {
      if (r.key === key && srcT >= r.start - 0.02 && srcT < r.end) return r.at + (srcT - r.start);
    }
    return null;
  };

  /* And back: what should be on screen at this moment of the cut? */
  const sourceAt = (cutT) => {
    if (!cut || !cut.ranges.length) return null;
    for (const r of cut.ranges) {
      if (cutT < r.at + (r.end - r.start)) return { key: r.key, t: r.start + Math.max(0, cutT - r.at), range: r };
    }
    const last = cut.ranges[cut.ranges.length - 1];
    return { key: last.key, t: last.end, range: last };
  };

  const currentKey = () => (video.getAttribute("src") || "").replace("/media/", "");

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
    /* In cut mode the bar spans the EDIT, not the file. A cut of 1:21 made
       from a 3:05 video should show 1:21, which is the number already on the
       footer — two places saying different lengths about one thing is the
       confusion this is here to end. */
    if (cut) {
      const at = cutTimeOf(currentKey(), video.currentTime);
      const pos = at === null ? cut.lastAt || 0 : at;
      cut.lastAt = pos;
      const p = cut.total > 0 ? Math.min(100, Math.max(0, (pos / cut.total) * 100)) : 0;
      if (played) played.style.width = p + "%";
      if (knob) knob.style.left = p + "%";
      if (track) track.setAttribute("aria-valuenow", String(Math.round(p)));
      if (nowEl) nowEl.textContent = secs(pos);
      if (buffered) buffered.style.width = "0%";
      return;
    }

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
    if (cut) {
      if (durEl) durEl.textContent = secs(cut.total);
      return void paintBar();
    }
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

  /*
   * Put the playhead somewhere, in whichever file that somewhere lives in.
   *
   * A cut can contain ranges from more than one video — a clip pulled from
   * other footage, a voiceover you recorded — so moving through it sometimes
   * means changing the file. It stalls for a moment while the new one loads.
   * That is worth it: skipping those ranges silently would make the preview a
   * lie about the export, which is the one thing it exists not to be.
   */
  const goTo = (want) => {
    const src = "/media/" + want.key;
    if (video.getAttribute("src") === src) {
      video.currentTime = want.t;
      return;
    }
    const resume = !video.paused;
    video.setAttribute("src", src);
    video.addEventListener(
      "loadedmetadata",
      () => {
        video.currentTime = want.t;
        if (resume) video.play().catch(() => {});
      },
      { once: true },
    );
    video.load();
  };

  /*
   * THE NARRATION, played alongside the picture.
   *
   * A block of b-roll you talked over renders as the shot with your voice
   * mixed in and the shot's own audio ducked under it. The preview showed the
   * picture in SILENCE — so "Watch the cut", which exists on the claim that
   * what it plays is what you get, was lying about exactly the blocks that
   * needed it most.
   *
   * One element, reused. Created on demand so a cut with no narration in it
   * never makes one.
   */
  let voiceEl = null;
  let ducked = false;

  const voiceFor = () => {
    if (!voiceEl) {
      voiceEl = document.createElement("audio");
      voiceEl.preload = "metadata";
      /* IN the document, hidden. A detached element does play, but nothing can
         see it — not the page, not a test, not me. An audio element that only
         exists in a closure is the kind of thing that keeps playing after
         everything else has stopped and nobody can find out why. */
      voiceEl.hidden = true;
      voiceEl.setAttribute("data-cut-voice", "1");
      root.appendChild(voiceEl);
    }
    return voiceEl;
  };

  const stopVoice = () => {
    if (voiceEl) voiceEl.pause();
    if (ducked) {
      /* The bed comes back up, or every later block plays quiet. */
      video.volume = 1;
      ducked = false;
    }
  };

  /*
   * Keep the take with the picture.
   *
   * Called on the same timeupdate that drives the skip, so it re-seeks rather
   * than trusting two clocks to stay together — scrubbing, a range change and
   * a rate change all land here.
   */
  const syncVoice = (range) => {
    if (!cut || !range || !range.voice) return stopVoice();

    const el = voiceFor();
    const src = "/media/" + range.voice;
    if (el.getAttribute("src") !== src) {
      el.setAttribute("src", src);
      el.load();
    }

    const want = Math.max(0, video.currentTime - range.start);
    if (Math.abs(el.currentTime - want) > 0.25) el.currentTime = want;
    el.playbackRate = video.playbackRate;

    /*
     * DUCK THE BED, as the render does.
     *
     * The export sidechain-compresses the shot's own audio under the voice.
     * A browser cannot sidechain, but dropping the video's volume while the
     * take plays is the audible half of it and much closer than leaving both
     * at full, which is two people talking over each other.
     */
    if (!ducked) {
      video.volume = 0.25;
      ducked = true;
    }
    if (video.paused) el.pause();
    else el.play().catch(() => {});
  };

  /*
   * THE WHOLE MECHANIC.
   *
   * Run off the end of a kept range and jump to the start of the next one.
   * That is the entire preview: no render, no second file, and seeking is
   * cheap because the editor plays a 480p copy with a keyframe every two
   * seconds. At the last range it stops, because the cut is over even though
   * the video is not.
   */
  const skip = () => {
    if (!cut || !cut.ranges.length) return;
    const key = currentKey();
    const here = cut.ranges.findIndex(
      (r) => r.key === key && video.currentTime >= r.start - 0.02 && video.currentTime < r.end,
    );
    if (here >= 0) {
      /* Inside a kept range: this is where the narration lives or does not. */
      cut.lastIdx = here;
      syncVoice(cut.ranges[here]);
      return;
    }
    stopVoice();

    /* Not inside any kept range. Which one comes next in the cut? */
    const after = cut.ranges.find((r) => r.key === key && r.start > video.currentTime);
    const idx = after ? cut.ranges.indexOf(after) : cut.lastIdx + 1;
    const next = cut.ranges[idx];
    if (!next) {
      /* Past the end of the cut. Stop ON the last frame of it rather than
         wherever the playhead happens to be — leaving it parked on footage you
         struck is the preview showing you the one thing it exists to hide. */
      const last = cut.ranges[cut.ranges.length - 1];
      cut.lastAt = cut.total;
      video.pause();
      if (video.currentTime > last.end) goTo({ key: last.key, t: Math.max(last.start, last.end - 0.05) });
      paintBar();
      return;
    }
    cut.lastIdx = idx;
    goTo({ key: next.key, t: next.start });
  };

  video.addEventListener("play", paintFace);
  video.addEventListener("pause", () => { stopVoice(); paintFace(); });
  /* A take still playing after the picture has stopped is the kind of ghost
     this codebase keeps finding. */
  video.addEventListener("ended", () => { stopVoice(); paintFace(); });
  video.addEventListener("timeupdate", () => { if (cut) skip(); paintBar(); });
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
    const r = track.getBoundingClientRect();
    const at = Math.min(1, Math.max(0, (clientX - r.left) / r.width));

    /* Dragging the bar in cut mode moves you through the EDIT, so a drag to
       halfway lands halfway through the cut rather than halfway through the
       footage most of which is not in it. */
    if (cut) {
      const want = sourceAt(at * cut.total);
      if (want) goTo(want);
      return void paintBar();
    }

    const dur = video.duration;
    if (!Number.isFinite(dur) || dur <= 0) return;
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

  /*
   * Turning it on and off. Returned rather than exported, so the only way to
   * put a player into cut mode is to have a player.
   */
  const setCut = (ranges) => {
    stopVoice();
    if (!ranges || !ranges.length) {
      cut = null;
      paintDuration();
      return;
    }
    let at = 0;
    const list = ranges.map((r) => {
      /* voice travels with the range. Rebuilding these without it is how the
         narration got dropped the first time — the fetch carried it and this
         copied four fields out of five. */
      const one = { key: r.key, start: r.start, end: r.end, voice: r.voice || null, at };
      at += r.end - r.start;
      return one;
    });
    cut = { ranges: list, total: at, lastAt: 0, lastIdx: 0 };
    const first = list[0];
    goTo({ key: first.key, t: first.start });
    paintDuration();
  };

  fullBtn?.addEventListener("click", () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else if (video.requestFullscreen) void video.requestFullscreen().catch(() => {});
  });

  return { setCut };
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
          /* Seeking to where you already are fires nothing.
             A decoder sits at 0 after loadedmetadata, so data-at="0" set
             currentTime to 0, no seeked event ever came, and the frame sat out
             its four-second timeout and gave up — which is why the first block
             of every transcript and EVERY finished short showed a black box.
             40ms in is the same picture and is always a real seek. */
          shot.currentTime = at > 0.01 ? at : 0.04;
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
  /* Two spans now, not one. The kept count sits in the title row's mono
     note and the runtime is inside the Export button's own label — "Export
     0:20" — which is where One Take puts it. */
  const footRuntime = document.querySelector("#cut-runtime");
  const footKept = document.querySelector("#cut-kept");

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

  /* Most of the editor's blocks come out of ONE file, so their canvases carry
     no media and this is what they fall back to. A block pulled in from
     another video carries its own — see data-media on .blk-frame. */
  observeFrames = paintMoments(blocksEl.querySelectorAll(".blk-frame"), video?.getAttribute("src") || "");

  /*
   * PLAY THIS BLOCK, from whichever file it actually belongs to.
   *
   * Nearly every block is a range of this project's own video, and for those
   * this is a seek. But a clip pulled in from ANOTHER video is a different
   * file, and the editor did not know: the play button carried data-media and
   * the handler read only data-start, so pressing play on a pulled clip seeked
   * this project's video to the other video's timecode and played whatever
   * happened to be there.
   *
   * One player, not two. The src is swapped and swapped back, so wirePlayer's
   * scrub bar, the keyboard shortcuts and the follow-along all keep working on
   * the same element rather than being duplicated for a second one.
   *
   * homeSrc is captured once, before anything can have moved it.
   */
  const homeSrc = video ? video.getAttribute("src") || "" : "";
  const playFrom = (mediaKey, atMs) => {
    if (!video) return;
    const want = mediaKey ? "/media/" + mediaKey : homeSrc;
    const seek = () => {
      video.currentTime = atMs / 1000;
      video.play().catch(() => {});
    };
    if (video.getAttribute("src") === want) return seek();

    /* A fresh file has no duration yet, and seeking before metadata arrives
       does nothing at all — which would look exactly like a dead button. */
    video.setAttribute("src", want);
    video.addEventListener("loadedmetadata", seek, { once: true });
    video.load();
  };

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

      /*
       * WHAT WILL ACTUALLY BE CUT, WHICH IS NOT ALWAYS WHAT YOU SELECTED.
       *
       * Only own-source blocks carry segment indices. A clip pulled in from
       * another video is b:<ulid> and its words exist for READING -- the
       * render addresses it as one whole span (see blockRanges in
       * src/blocks.ts), so there is no way to cut inside it.
       *
       * The count and the saving used to be measured across every selected
       * word while only the own-source ones were sent. Drag across the seam
       * between your own footage and a pulled clip and the button promised to
       * cut twelve words and cut seven, with a runtime that never matched.
       * A number on a destructive button has to be the number.
       */
      const byBlock = new Map();
      const cuttable = [];
      let pulled = 0;
      for (const w of hit) {
        const block = w.el.getAttribute("data-block");
        if (!block.startsWith("s:")) { pulled++; continue; }
        cuttable.push(w);
        const seg = Number(block.slice(2));
        const idx = Number(w.el.getAttribute("data-word"));
        const run = byBlock.get(seg);
        if (run) { run.from = Math.min(run.from, idx); run.to = Math.max(run.to, idx); }
        else byBlock.set(seg, { seg, from: idx, to: idx });
      }
      const ranges = [...byBlock.values()];
      const rect = range.getBoundingClientRect();

      /* Nothing here can be cut, and the old code returned null — so the
         selection highlighted, no button appeared, and nothing said why. A
         control that does nothing in silence is the thing this codebase keeps
         arguing against; it says so instead. */
      if (!ranges.length) return pulled ? { ranges: [], count: 0, ms: 0, pulled, rect } : null;

      const ms = cuttable.reduce((n, w) => n + Math.max(0, w.e - w.s), 0);
      return { ranges, count: cuttable.length, ms, pulled, rect };
    };

    let pending = null;

    const place = () => {
      pending = selected();
      if (!pending) { action.hidden = true; return; }
      /* The count and the saving are both real — the same rule the clean-up
         chips follow — and "real" now means what will be cut, not what was
         highlighted. */
      action.textContent = pending.count
        ? "Cut " + pending.count + " word" + (pending.count === 1 ? "" : "s") + " · −" + clock(pending.ms)
        : "Pulled clips cut whole";
      action.disabled = !pending.count;
      action.style.opacity = pending.count ? "1" : ".55";
      action.style.cursor = pending.count ? "pointer" : "default";
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
      if (!pending || !pending.count) return;
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
  /* Seeded from the title row's kept note. It used to be seeded from a bar
     that carried both numbers in one string and had to be split apart; they
     are two elements now, so there is nothing to parse. */
  let keptTotal = Number((footKept?.textContent || "").replace(/[^0-9]/g, "")) || 0;

  const retotal = (afterS, keptFromServer) => {
    if (typeof keptFromServer === "number") keptTotal = keptFromServer;
    const ms = typeof afterS === "number"
      ? afterS * 1000
      : [...blocksEl.querySelectorAll(".blk")]
          .filter((el) => el.dataset.struck !== "1")
          .reduce((n, el) => n + Number(el.getAttribute("data-ms") || 0), 0);
    if (footKept) footKept.textContent = keptTotal + " kept";
    if (footRuntime) footRuntime.textContent = clock(ms);
  };

  /*
   * GO TO A BLOCK, loading the page as far as it if the reader has not
   * scrolled there.
   *
   * Published rather than duplicated, the same way window.cutSelection is: the
   * find panel walks its hits with this and the conversation's "Show me" jumps
   * to what a pass changed with it, and the two must never disagree about what
   * "go there" means. Also the only place that knows a block arriving late has
   * to be put into the word index and the frame observer.
   */
  window.goToBlock = async (blockId, index) => {
    if (!blockId || !blocksEl) return false;
    let el = blocksEl.querySelector('[data-block="' + blockId + '"]');
    if (!el) {
      /* Load until it is on the page. The server caps how much one request
         will send, so a very long jump takes a few — bounded, not a walk. */
      let guard = 0;
      while (!el && blocksEl.querySelector("#more-blocks") && guard++ < 12) {
        await loadMore(typeof index === "number" && index >= 0 ? index + 1 : undefined);
        el = blocksEl.querySelector('[data-block="' + blockId + '"]');
      }
      /* The highlight and the selection counter keep their own index of the
         words; blocks that arrive this way have to be in it too. */
      reindexWords();
      observeFrames(blocksEl.querySelectorAll(".blk-frame"));
    }
    if (!el) return false;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    here(el);
    return true;
  };

  /*
   * WHERE YOU ARE.
   *
   * The editor has never had a notion of a current block, which is why the +
   * had to be on all 120 seams at once and why nothing on the page could tell
   * you what you were working on. The block you click, play or strike is the
   * one you are on, and the seams either side of it show their +.
   *
   * By attribute, not :hover — a touch screen has no hover, and this product
   * has already shipped controls that did not exist on a phone once.
   */
  const here = (blk) => {
    if (!blocksEl) return;
    blocksEl.querySelectorAll('.blk[data-here="1"]').forEach((b) => b.removeAttribute("data-here"));
    blocksEl.querySelectorAll('.seam[data-here="1"]').forEach((sm) => sm.removeAttribute("data-here"));
    if (!blk) return;
    blk.setAttribute("data-here", "1");
    /* The seams that touch this block: the one before it and the one after. */
    for (const sm of [blk.previousElementSibling, blk.nextElementSibling]) {
      if (sm && sm.classList.contains("seam")) sm.setAttribute("data-here", "1");
    }
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
    /*
     * THE STRIKE BUTTON'S pill, not whichever one comes first.
     *
     * This asked for ".seg-pill" and there are two on a footage block: "Make
     * a short" is rendered before "Cut". So striking a line renamed the Make
     * a short button to "Add back" and left the button you had just pressed
     * still saying "Cut" — the row told you nothing had happened, on the
     * single most-used gesture in the product. It only showed on footage
     * blocks (a voiceover beat has no Make a short) and only after a strike,
     * and "Make a short" is invisible until hover on a pointer device, so
     * what you actually saw was a Cut button that would not change its mind.
     */
    const pill = el.querySelector(".blk-strike .seg-pill");
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
  /*
   * A LINE PARKED THE SAME WAY, for the same reason.
   *
   * runPass reloads the page a tick after it answers, so anything it says
   * there is said to a page that is about to be replaced. The one thing it
   * has to say — that Ask could not propose this pass because the pass is a
   * read — rides across in session storage and is said here, once.
   */
  const note = sessionStorage.getItem("pass-note:" + projectId);
  if (note) {
    sessionStorage.removeItem("pass-note:" + projectId);
    setTimeout(() => toast(note), 0);
  }

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

  /* Every cut in the editor goes through here — striking a line, a word
     selection, cut-all, the clean-ups — so it is the one honest place to say
     whether the work is on the server yet. */
  const sendCut = async (payload) => {
    window.saved("saving");
    let res;
    try {
      res = await fetch("/api/projects/" + projectId + "/cuts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      window.saved("failed");
      throw new Error("That didn't save — check your connection");
    }
    if (!res.ok) {
      window.saved("failed");
      throw new Error("That didn't save");
    }
    window.saved("ok");
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
      /* The slice must come back in the reading it is being appended into, or
         a long transcript turns into cards halfway down. #blocks says which. */
      const view = blocksEl.getAttribute("data-view") === "script" ? "script" : "blocks";
      const res = await fetch(
        "/api/projects/" + projectId + "/blocks?from=" + sentinel.getAttribute("data-from") +
          (until ? "&to=" + until : "") + "&view=" + view,
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
    /* Whatever you pressed, you are now on that block. Before the dispatch
       below, so it is true even for a press this handler ignores. */
    here(e.target.closest(".blk"));

    /* The model's reason is clamped to one line; pressing it shows the rest.
       Before the dispatch so it does not also seek or strike. */
    const whyEl = e.target.closest(".blk-why");
    if (whyEl) {
      const open = whyEl.style.webkitLineClamp === "unset";
      whyEl.style.webkitLineClamp = open ? "1" : "unset";
      whyEl.title = open ? "Show the whole reason" : "";
      return;
    }

    if (e.target.closest(".blk-text, .rec-live, audio")) return;
    const word = e.target.closest(".w");
    const strike = e.target.closest(".blk-strike");
    const short = e.target.closest(".blk-short");
    const picture = e.target.closest(".blk-picture");
    const rec = e.target.closest(".blk-record");
    const unrec = e.target.closest(".blk-unrecord");
    const tts = e.target.closest(".blk-tts");
    const move = e.target.closest(".blk-move");
    const play = e.target.closest(".blk-play");
    const insert = e.target.closest(".blk-insert");
    const seamOpen = e.target.closest(".seam-open");
    const seamClose = e.target.closest(".seam-close");
    const row = e.target.closest(".blk");

    /*
     * WHAT COULD GO ON THIS LINE.
     *
     * Invariant 8's other half: allowed() already refuses a generated
     * card over a claim, and nothing offered one. The panel opens under the
     * block and leads with the choice and its reason, then what was refused
     * and why — doc 08's premise is that a picture answers "why am I seeing
     * this", and the alternatives are half of that answer.
     *
     * No backticks: this file is one String.raw template.
     */
    if (picture) {
      const blk = picture.closest(".blk");
      const already = blk.querySelector(".pic-panel");
      if (already) { already.remove(); return; }

      const panel = document.createElement("div");
      panel.className = "pic-panel";
      panel.style.cssText =
        "margin:8px 0 2px;padding:10px 12px;border-radius:8px;background:#141418;font-size:12px;line-height:1.5;color:rgba(236,236,241,0.62)";
      panel.textContent = "Reading the line…";
      blk.appendChild(panel);

      try {
        /* The project id lives on the brief box, which is the only element
           on this page that carries it. body does not. */
        const box = document.getElementById("brief-box");
        const pid = box ? box.getAttribute("data-project") : "";
        if (!pid) { panel.textContent = "Could not read that line."; return; }
        const res = await fetch(
          "/api/projects/" + encodeURIComponent(pid) + "/pictures?block=" +
            encodeURIComponent(picture.getAttribute("data-block")),
        );
        const d = await res.json().catch(() => ({}));
        if (!res.ok) { panel.textContent = d.error || "Could not read that line."; return; }

        let html =
          '<div style="color:#ECECF1">' + escapeHtml(d.placed && d.placed.reason ? d.placed.reason : "") + "</div>";
        const refused = (d.placed && d.placed.refused) || [];
        if (refused.length) {
          html +=
            '<div style="margin-top:8px">Refused: ' +
            refused.map((r) => escapeHtml(r.reason)).join("; ") +
            "</div>";
        }
        /* The sources with nothing behind them, named. An empty list and an
           unbuilt source look identical and are not. */
        if (d.note) html += '<div style="margin-top:8px;color:rgba(236,236,241,0.42)">' + escapeHtml(d.note) + "</div>";
        panel.innerHTML = html;
      } catch {
        panel.textContent = "Could not read that line.";
      }
      return;
    }

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
      playFrom(play.getAttribute("data-media"), Number(play.getAttribute("data-start") || 0));
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
        /* Null media: a word belongs to THIS video's transcript, so this also
           brings the player home if a pulled clip left it on another file. */
        playFrom(null, at);
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
          body: JSON.stringify({ block: short.getAttribute("data-block"), aspect: "9:16", captionStyle: "Bold" }),
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error || "Couldn't make that");
        if (pill) pill.textContent = "in Exports";
        toast("Making it — it will be in Footage, under Exports.");
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

      await window.goToBlock(h.block, h.index);
    };

    hitsEl.addEventListener("click", (e) => {
      const row = e.target.closest(".find-hit");
      if (row) void goTo(Number(row.getAttribute("data-hit")));
    });

    /* Enter walks them, wrapping — the same as every find field there has
       ever been. This field only finds now; asking is the composer's job. */
    q.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || !hits.length) return;
      e.preventDefault();
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
const assist = document.querySelector(".asst");
if (assist) {
  const projectId = assist.getAttribute("data-project");
  const form = assist.querySelector(".pass-form");
  const field = form?.querySelector("[name=instruction]");
  const talk = assist.querySelector(".asst-talk");

  /* A conversation opens on its newest turn, like every other one. */
  if (talk) talk.scrollTop = talk.scrollHeight;

  /* A pass is queued work, so the page reloads into the running strip rather
     than pretending the answer is instant. */
  const runPass = async (instruction, btn, apply) => {
    /* A verb button holds spans — its name and sometimes a count — so swapping
       the BUTTON's textContent would eat them. The name is swapped instead. */
    const label = btn ? btn.querySelector("span:not([data-content])") || btn : null;
    const was = label ? label.textContent : "";
    if (btn) btn.disabled = true;
    if (label) label.textContent = "Starting…";
    try {
      const res = await fetch("/api/projects/" + projectId + "/passes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instruction, apply: apply === true }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || "That didn't start");
      /*
       * ASK: NOTHING HAPPENED YET, so do not reload.
       *
       * The dial is on Ask, the server worked out what the rule would do and
       * changed nothing, and the row below says so and waits. Reloading here
       * would throw the proposal away and show a cut that had not moved,
       * which reads as the button being broken.
       */
      if (out.proposal) {
        showProposal(out.proposal, (apply) => runPass(instruction, btn, apply));
        if (btn) btn.disabled = false;
        if (label) label.textContent = was;
        if (field) field.value = "";
        return;
      }
      /*
       * Ask on a project that has its own transcript: there was no rule to
       * propose in advance, so it ran. Said once rather than left to be
       * noticed — a setting that quietly means nothing on half the projects
       * is a setting nobody trusts.
       *
       * PARKED, NOT TOASTED HERE. The next line reloads the page, and a
       * toast posted a tick before a reload is a toast nobody sees. It
       * rides to the other side in the same place the pass undo does.
       */
      if (out.note) sessionStorage.setItem("pass-note:" + projectId, out.note);
      /*
       * A pass rewrites the cut, so it needs an undo — and it finishes minutes
       * after this reload, so the state to go back to is the one that exists
       * right now. Held under its own key and handed to the normal undo park
       * only when the job actually completes; the ordinary one is consumed on
       * the very next load, which would be this one.
       */
      if (out.before) {
        sessionStorage.setItem(
          "pass-undo:" + projectId,
          JSON.stringify({ label: "Ran a pass", before: out.before }),
        );
      }
      location.reload();
    } catch (err) {
      if (btn) btn.disabled = false;
      if (label) label.textContent = was;
      toast((err && err.message) || "That didn't start");
    }
  };

  /* Enter sends, Shift+Enter writes a new line — what every composer does,
     and the reason this is a textarea rather than an input: an instruction is
     a sentence and sometimes two. */
  field?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    form?.requestSubmit();
  });

  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    const instruction = (field?.value || "").trim();
    /* The server refuses an empty instruction with "say what you want"; say it
       here too rather than making the user wait for a round trip to hear it. */
    if (!instruction) { toast("Say what you want."); field?.focus(); return; }
    void runPass(instruction, form.querySelector("button[type=submit]"));
  });

  /* The assistant's mic. The behaviour is in wireMic, below. */
  wireMic(assist.querySelector(".asst-mic"), field, {
    dot: assist.querySelector(".asst-mic-dot"),
    label: assist.querySelector(".asst-mic-label"),
    hint: assist.querySelector(".asst-hint"),
    idleLabel: "Say it",
  });

  /* Show me what it changed. goToBlock is published by the editor so this and
     the find panel can never disagree about what "go there" means. */
  assist.querySelectorAll(".turn-show").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const found = await window.goToBlock(btn.getAttribute("data-block"));
      if (!found) toast("That line isn't in this cut any more.");
    });
  });

  /*
   * TAKING A PASS BACK, from the turn that did it.
   *
   * Undo for a pass was a toast that expired in six seconds, or Cmd-Z. The
   * owner does not use keyboard shortcuts, so the one action that rewrites
   * the whole cut at once was in practice permanent the moment they looked
   * away. The snapshot lives on the pass row now and the turn spends it.
   */
  assist.querySelectorAll(".turn-undo").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (btn.disabled) return;
      btn.disabled = true;
      const was = btn.textContent;
      btn.textContent = "Putting it back…";
      try {
        const res = await fetch("/api/passes/" + btn.getAttribute("data-pass") + "/undo", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId: btn.getAttribute("data-project") }),
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error || "That didn't work");
        location.reload();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = was;
        toast((err && err.message) || "That didn't work");
      }
    });
  });

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

  /*
   * THE VERBS.
   *
   * "Find the strong bits" had been dead since the assistant became a column:
   * the markup moved and its one line of handler did not follow it, so the
   * gold button on the most important control in the product did nothing at
   * all. That is most of why the feature "could be improved".
   *
   * Every verb press goes through runPass, the same path the composer uses,
   * and the sentence lands in the box on the way. That is the whole design
   * rule for these: no button does anything you could not type, so pressing
   * one teaches you what the box takes. It also means a verb you nearly want
   * is a starting point — the words are sitting there to be edited after the
   * pass comes back.
   */
  const press = (btn, instruction) => {
    if (!btn || btn.disabled) return;
    if (field) field.value = instruction;
    void runPass(instruction, btn);
  };

  for (const btn of assist.querySelectorAll(".verb-ask")) {
    btn.addEventListener("click", () => press(btn, btn.getAttribute("data-ask") || ""));
  }

  const findGood = assist.querySelector(".find-good");
  findGood?.addEventListener("click", () =>
    press(findGood, "keep only the good bits and cut everything else"),
  );

  /* Six in front, six one press away. It does not fold back up: someone who
     opened it wanted the long tail, and closing it again would hide the verb
     they are half way through reading. */
  const more = assist.querySelector(".verb-more");
  const rest = assist.querySelector(".verb-rest");
  more?.addEventListener("click", () => {
    if (rest) rest.hidden = false;
    more.hidden = true;
  });
}

/* ── The nav bar's three controls ──────────────────────────────────────
   "Ask for anything", the "?" and the bell were rendered on every page and
   bound to nothing, while this very file caught Cmd-K and "?" and discarded
   them. The app had shortcuts and hid them behind a dead button. */

const palette = document.querySelector("#palette");
const paletteInput = document.querySelector("#paletteInput");
const paletteResults = document.querySelector("#paletteResults");
const keysheet = document.querySelector("#keysheet");

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
  for (const el of [palette, keysheet]) {
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
/*
 * #navSearch, #navKeys, #navNotif and the notification panel lived here.
 *
 * One Take's bar is the wordmark and the avatar, so all three buttons went
 * with it. Nothing they did went with them: Cmd-K still opens the palette,
 * "?" still opens the shortcut sheet, and what the bell listed is in the
 * room's working row — running work was already there, and what finished is
 * there now too.
 */

/* ── The project switcher ─────────────────────────────────────────────
   The caret beside the title. Rows are links, so this only opens and closes
   the panel — navigation works with the client switched off entirely, and a
   middle click opens a project in a new tab the way a person expects. */
const switcherBtn = $("#switcher");
const switcherPanel = $("#switcherPanel");
if (switcherBtn && switcherPanel) {
  const shut = () => {
    switcherPanel.hidden = true;
    switcherBtn.style.background = "";
  };
  const open = () => {
    switcherPanel.hidden = false;
    /* The prototype lights the trigger while the panel is down, which is
       the only thing on screen saying which control opened it. */
    switcherBtn.style.background = "#1C1C22";
  };
  switcherBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (switcherPanel.hidden) open(); else shut();
  });
  switcherBtn.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    if (switcherPanel.hidden) open(); else shut();
  });
  /* Anywhere else, and Escape. A panel that can only be closed by the
     control that opened it is one people click around. */
  document.addEventListener("click", (e) => {
    if (switcherPanel.hidden) return;
    if (switcherPanel.contains(e.target)) return;
    shut();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") shut();
  });
  /*
   * AND ON A ROW, because one of them leads where you already are.
   *
   * Most rows navigate and take the panel with them. The row for the
   * project you are IN, and "Your footage" while you are in the room, do
   * not — the browser loads the same page or nothing at all, and the panel
   * sits open over the title it came out of.
   */
  for (const row of switcherPanel.querySelectorAll(".switch-row, .switch-room")) {
    row.addEventListener("click", shut);
  }
}

/*
 * THE MARK CYCLES, one colour per visit.
 *
 * MARK_PALETTE in tokens.ts, which is the prototype's own four:
 *
 *   const PAL = ["#5EB8C9", "#5EC98F", "#E06A6A", "#D9B36A"];
 *   markStart() { ... (parseInt(localStorage.getItem(k) || "-1", 10) + 1) % 4 }
 *
 * It is not a status light. The build read it as one — a lookup from the
 * surface you were on, gold for Home, cyan for the archive — which was right
 * for the retired design's several surfaces and wrong for a product with one
 * room. The owner spotted it from a screenshot: the build was gold where the
 * prototype was teal.
 *
 * The server paints the first of the four, so a browser with no storage at
 * all still gets a mark; this moves it to wherever the cycle had got to, and
 * hovering steps it on.
 */
const MARK_PALETTE = ["#5EB8C9", "#5EC98F", "#E06A6A", "#D9B36A"];
const markEl = document.querySelector("[data-mark]");
if (markEl) {
  const bars = markEl.querySelectorAll(".mark-bar");
  let at = 0;
  try {
    at = (parseInt(localStorage.getItem("aldershot.mark") || "-1", 10) + 1) % MARK_PALETTE.length;
    if (!Number.isFinite(at) || at < 0) at = 0;
    localStorage.setItem("aldershot.mark", String(at));
  } catch (err) {
    /* Private windows and blocked storage. The server's colour stands. */
    at = 0;
  }
  const paintMark = () => {
    for (const b of bars) b.style.background = MARK_PALETTE[at % MARK_PALETTE.length];
  };
  paintMark();
  markEl.addEventListener("mouseenter", () => { at = (at + 1) % MARK_PALETTE.length; paintMark(); });
}

/*
 * WAITING, honestly.
 *
 * "some doesn't even give you a time countdown .. like export right now just
 * says putting it together and like.. no % or anything."
 *
 * A render is one call into the encoder and nothing reports from inside it,
 * so there is no percentage to show and a bar filling on a timer would be a
 * lie dressed as measurement. What is true: how long it has been going, and —
 * once the account has finished three renders to learn a rate from — roughly
 * how long is left, from what its own renders actually took.
 *
 * The stripe slides rather than fills. It says "working" without claiming a
 * fraction, which is the honest shape for work whose end is not visible.
 */
document.querySelectorAll(".job-row").forEach((row) => {
  const clock = row.querySelector(".job-clock");
  const left = row.querySelector(".job-left");
  const stripe = row.querySelector(".job-stripe");
  const started = Number(row.getAttribute("data-started")) || Date.now();
  const eta = Number(row.getAttribute("data-eta")) || 0;

  const mmss = (ms) => {
    const t = Math.max(0, Math.round(ms / 1000));
    return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0");
  };

  let slide = 0;
  const tick = () => {
    const elapsed = Date.now() - started;
    if (clock) clock.textContent = mmss(elapsed);

    if (left && eta) {
      const remaining = eta - elapsed;
      /* Past the estimate is not a failure and must not read as one. Its own
         renders vary; saying "any moment" is truer than a negative number or
         a stuck zero. */
      left.textContent = remaining > 4000 ? "about " + mmss(remaining) + " left" : "any moment";
    }

    if (stripe) {
      slide = (slide + 1.6) % 134;
      stripe.style.marginLeft = Math.max(0, slide - 34) + "%";
      stripe.style.width = Math.min(34, 134 - slide) + "%";
    }
  };
  tick();
  setInterval(tick, 1000);
});

/* ── Keyboard map (10-ROUTES-AND-KEYS.md) ─────────────────────────────── */
let goArmed = false;
const GO = { h: "/", p: "/footage?tab=edits", f: "/footage", s: "/settings" };

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
        ? "Transcribing " + name
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
        list.textContent = "Nothing transcribed yet — add a video and it starts.";
        return;
      }
      /*
       * EVERYTHING, as the first answer to "which video?".
       *
       * An edit has always begun with one file. This row begins one from the
       * whole library instead — it posts no sourceId, which the server reads
       * as "out of everything I have" and assembles from what matches. It is
       * first because it is the answer the sentence usually deserves: you said
       * what you wanted, not which file it was in.
       */
      list.innerHTML =
        '<button data-source="" style="display:flex;gap:12px;align-items:center;text-align:left;' +
        'padding:11px 12px;border-radius:8px;background:#1A1A1F;border:none;cursor:pointer;color:#ECECF1;' +
        'font-family:inherit;box-shadow:inset 0 0 0 1px rgba(217,179,106,.28)">' +
        '<span style="flex:none;width:54px;aspect-ratio:16/9;border-radius:4px;background:#0B0B0E;display:grid;place-items:center;' +
        'font-size:11px;color:rgba(236,236,241,.45)">all</span>' +
        '<span style="flex:1;min-width:0"><span style="display:block;font-size:13px">Everything I have shot</span>' +
        '<span style="display:block;font-size:11px;color:rgba(236,236,241,.45);margin-top:2px">Pulls the moments that match from every video</span>' +
        '</span></button>' +
        ready
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
   because they all read the same key, and there was no repair path that ever
   actually ran. Trying four points costs four seeks on a file the browser
   already has open, once, at upload. */
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

/*
 * There was a healPoster here — a repair path for a black poster, which had
 * ZERO call sites for its whole life. Deleted rather than wired up: it seeked
 * the visible player to a quarter in and then restored it to 0 rather than to
 * where the user actually was, so wiring it up would have yanked the playhead
 * out from under somebody. grabPoster already samples four points and scores
 * them (frameInterest), which is the real fix for a dark frame.
 */


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

/* ── Labelling: what backs what ───────────────────────────────────────
   Two hundred judgements is an hour of somebody's evening, so there is no
   confirmation and no save step: the answer IS the tap, and changing it is
   another tap. No reload either — reloading after every judgement would
   re-run retrieval and lose the reading position partway down a list. */
/* ── A pasted brief becomes rules ────────────────────────────────────
   The rules land in the pane on the left, each with the line saying what it
   is doing — that is the shortlist diff, in the place a person already
   looks. The reply adds the one thing the pane cannot say: whether the
   number asked for was reached. */
{
  const form = document.getElementById("brief-box");
  if (form) {
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const input = form.querySelector('input[name="brief"]');
      const brief = (input && input.value || "").trim();
      if (!brief) return;
      const btn = form.querySelector("button");
      if (btn) { btn.disabled = true; btn.style.opacity = ".5"; }
      try {
        const res = await fetch("/api/projects/" + form.getAttribute("data-project") + "/brief", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ brief }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          window.toast(body.error || "That didn't compile.");
          if (btn) { btn.disabled = false; btn.style.opacity = "1"; }
          return;
        }
        window.toast(
          body.rules + (body.rules === 1 ? " rule" : " rules") + " · " + body.kept + " kept" +
            (body.short ? " — " + body.short + " short of what you asked for" : ""),
        );
        window.location.reload();
      } catch {
        window.toast("That didn't compile.");
        if (btn) { btn.disabled = false; btn.style.opacity = "1"; }
      }
    });
  }
}

/* ── Keep a line as a short ──────────────────────────────────────────
   The Shorts tab grades every line and withholds none, so this is pressable
   on a Long shot too — the grade said what to expect and the person read it.
   It saves the line as a moment; rendering it is a separate press, because
   nothing renders until you say so. */
document.querySelectorAll(".short-line").forEach((btn) => {
  btn.addEventListener("click", async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.style.opacity = ".5";
    try {
      const res = await fetch("/api/projects/" + btn.getAttribute("data-project") + "/shorts-from-line", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ segIdx: Number(btn.getAttribute("data-seg")) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        window.toast(body.error || "That didn't save.");
        btn.disabled = false;
        btn.style.opacity = "1";
        return;
      }
      /* made:false is saveClips refusing an overlap, which means the moment
         is already in the library — not a failure, and saying "saved" would
         be the second kind of lie. (No backticks in this file: one ends the
         String.raw body and takes the whole client with it.) */
      btn.textContent = body.made ? "Kept" : "Already kept";
      window.toast(body.made ? "Kept it — it's in your Highlights." : "That one is already in your Highlights.");
    } catch {
      window.toast("That didn't save.");
      btn.disabled = false;
      btn.style.opacity = "1";
    }
  });
});

/* ── Ask the judge ───────────────────────────────────────────────────
   A job, so this starts it and leaves; the bell and the page's own reload
   are where it is watched, the same as every other long thing here. */
/*
 * DOCUMENTS — invariant 8's second tier.
 *
 * One PUT with the file as the body and the title and note as headers: a
 * scan of a letter is kilobytes, so the multipart dance a video needs would
 * be ceremony. The note is what the document SHOWS, and it is what makes it
 * proof — doc 08 wants "the document with its line marked" and nothing here
 * reads a PDF to find the line.
 *
 * No backticks: this file is one String.raw template.
 */
{
  const docPick = document.getElementById("docPick");
  const docNote = document.getElementById("docNote");
  const docState = document.getElementById("docState");

  if (docPick) {
    docPick.addEventListener("change", async () => {
      const file = docPick.files && docPick.files[0];
      if (!file) return;
      if (docState) docState.textContent = "Adding…";
      try {
        const res = await fetch("/api/documents", {
          method: "POST",
          headers: {
            "content-type": file.type || "application/octet-stream",
            "x-filename": encodeURIComponent(file.name).replace(/%20/g, " "),
            "x-title": encodeURIComponent(file.name.replace(/\.[^.]+$/, "")).replace(/%20/g, " "),
            "x-note": encodeURIComponent(docNote ? docNote.value : "").replace(/%20/g, " "),
          },
          body: file,
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (docState) docState.textContent = "";
          window.toast(d.error || "That could not be added.");
          return;
        }
        location.reload();
      } catch {
        if (docState) docState.textContent = "";
        window.toast("That could not be added.");
      }
    });
  }

  document.addEventListener("click", async (e) => {
    const mark = e.target.closest(".doc-mark");
    const put = e.target.closest(".doc-remove");
    if (!mark && !put) return;

    if (mark) {
      const row = mark.closest(".doc-row");
      const now = row ? row.querySelector("div > div").textContent : "";
      const said = window.prompt("What does this document show?", /Not marked yet/.test(now) ? "" : now);
      /* Cancel is null and must not clear the note; an empty string is a
         deliberate "I do not want to claim anything for it" and does. */
      if (said === null) return;
      try {
        const res = await fetch("/api/documents/" + encodeURIComponent(mark.getAttribute("data-doc")) + "/mark", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ note: said }),
        });
        if (!res.ok) throw new Error("no");
        location.reload();
      } catch {
        window.toast("That could not be saved.");
      }
      return;
    }

    /* Put away, not deleted — invariant 6. The row and the file stay; it
       stops being offered. So the confirm says that rather than warning
       about something irreversible, which it is not. */
    if (!window.confirm("Put this document away? It stops being offered; nothing is deleted.")) return;
    try {
      const res = await fetch("/api/documents/" + encodeURIComponent(put.getAttribute("data-doc")) + "/remove", {
        method: "POST",
      });
      if (!res.ok) throw new Error("no");
      location.reload();
    } catch {
      window.toast("That could not be put away.");
    }
  });
}

/*
 * ASK IT ANYTHING ABOUT YOUR FOOTAGE.
 *
 * The composer's text is a sentence about your footage either way; Ask sends
 * it as a question and the answer is the lines that say it, timed. No prose
 * is generated anywhere — see src/ask.ts — so everything rendered below is
 * either something somebody said, or the judge's own line about which
 * sentence did the saying.
 *
 * NO BACKTICKS IN THIS FILE. It is one String.raw template and a single
 * backtick ends it, so this builds its DOM by concatenation like
 * renderHits above.
 */
{
  const askBtn = document.getElementById("askBtn");
  const askPanel = document.getElementById("askPanel");
  const askLead = document.getElementById("askLead");
  const askLines = document.getElementById("askLines");
  const briefBox = document.getElementById("brief");

  function lineCard(l, backs) {
    /* The timestamp links into the source at that moment, and it came off
       the moment's own span — never from a model. Invariant 2. */
    const href = "/source/" + encodeURIComponent(l.sourceId) + "?t=" + Math.floor(l.atMs / 1000);
    const said = l.line || l.quote;
    return (
      '<div style="padding:10px 12px;border-radius:8px;background:' +
      (backs ? "#1A1A1F" : "#141418") + '">' +
      '<div style="font-size:14px;line-height:1.5;color:' +
      (backs ? "#ECECF1" : "rgba(236,236,241,0.62)") + '">“' +
      escapeHtml(said) + '”</div>' +
      '<div style="margin-top:6px;display:flex;gap:8px;align-items:baseline;font-size:12px;color:rgba(236,236,241,0.42)">' +
      '<a href="' + href + '" style="flex:none;color:rgba(236,236,241,0.62);text-decoration:none;font-variant-numeric:tabular-nums">' +
      escapeHtml(l.sourceTitle || "Untitled") + " · " + escapeHtml(l.atLabel) + "</a>" +
      (l.why ? '<span style="flex:1;min-width:0">' + escapeHtml(l.why) + "</span>" : "") +
      "</div></div>"
    );
  }

  if (askBtn && askPanel && askLead && askLines && briefBox) {
    askBtn.addEventListener("click", async () => {
      const q = briefBox.value.trim();
      if (!q) { window.toast("Ask a question about your footage."); return; }

      askPanel.hidden = false;
      askLead.textContent = "Reading your footage…";
      askLines.innerHTML = "";
      askBtn.disabled = true;
      askBtn.style.opacity = ".5";

      try {
        const res = await fetch("/api/ask", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ q: q }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          askLead.textContent = data.error || "That could not be asked just now.";
          return;
        }
        askLead.textContent = data.lead || "";
        /* What backs it first, then the near things — two groups, never
           interleaved, because a near miss shown as an answer is the false
           support the judge exists to stop. */
        const backs = (data.lines || []).map((l) => lineCard(l, true)).join("");
        const near = (data.nearby || []).map((l) => lineCard(l, false)).join("");
        askLines.innerHTML = backs + near;
      } catch {
        askLead.textContent = "That could not be asked just now.";
      } finally {
        askBtn.disabled = false;
        askBtn.style.opacity = "1";
      }
    });
  }
}

{
  const ask = document.getElementById("ask-judge");
  if (ask) {
    ask.addEventListener("click", async () => {
      if (ask.disabled) return;
      ask.disabled = true;
      ask.style.opacity = ".5";
      try {
        const res = await fetch("/api/eval/judge", { method: "POST" });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          window.toast(body.error || "The judge could not be asked.");
          ask.disabled = false;
          ask.style.opacity = "1";
          return;
        }
        window.toast("Judging " + body.claims + " claim" + (body.claims === 1 ? "" : "s") + " — reload when it finishes.");
      } catch {
        window.toast("The judge could not be asked.");
        ask.disabled = false;
        ask.style.opacity = "1";
      }
    });
  }
}

document.querySelectorAll(".eval-say").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const row = btn.parentElement;
    const verdict = btn.getAttribute("data-verdict");
    try {
      const res = await fetch(
        "/api/eval/" + btn.getAttribute("data-claim") + "/" + btn.getAttribute("data-clip"),
        /* WHO IS ANSWERING rides with the answer. It is read off the form
           on the page rather than held in a variable, so switching labeller
           and then tapping without reloading cannot file the answer under
           the person who was here before. */
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            verdict,
            by: (document.querySelector('input[name="by"]') || {}).value || "",
          }),
        },
      );
      if (!res.ok) { window.toast("That didn't save."); return; }
      /* The chosen one lights; the other two go quiet. Done here rather than
         by reloading, because the page is a list you are working down. */
      if (row) {
        row.querySelectorAll(".eval-say").forEach((b) => {
          const on = b === btn;
          b.style.background = on ? b.getAttribute("data-on-bg") || "rgba(94,201,143,0.14)" : "#1A1A1F";
          b.style.color = on ? b.getAttribute("data-on-fg") || "#5EC98F" : "rgba(236,236,241,0.7)";
        });
      }
    } catch {
      window.toast("That didn't save.");
    }
  });
});

/* ── The plan: keep or cut a beat, then the two steps past the stop ───
   The flow stops exactly once, here, and nothing downstream runs until the
   beats are answered — which is why Find the footage and Cut it are separate
   presses rather than one that does both. */
const planPost = async (url, btn, go) => {
  if (btn.disabled) return;
  btn.disabled = true;
  btn.style.opacity = ".5";
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      window.toast(out.error || "That didn't work.");
      btn.disabled = false;
      btn.style.opacity = "";
      return;
    }
    go(out);
  } catch {
    window.toast("That didn't work.");
    btn.disabled = false;
    btn.style.opacity = "";
  }
};

document.querySelectorAll(".beat-keep").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const plan = btn.closest("[data-plan]");
    if (!plan) return;
    const next = btn.getAttribute("data-kept") !== "1";
    try {
      await fetch("/api/plans/" + plan.getAttribute("data-plan") + "/beats/" + btn.getAttribute("data-beat"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kept: next }),
      });
      location.reload();
    } catch {
      window.toast("That didn't change.");
    }
  });
});

document.querySelectorAll(".plan-find").forEach((btn) => {
  btn.addEventListener("click", () =>
    planPost("/api/plans/" + btn.getAttribute("data-plan") + "/find", btn, () => location.reload()),
  );
});

document.querySelectorAll(".plan-cut").forEach((btn) => {
  btn.addEventListener("click", () =>
    planPost("/api/plans/" + btn.getAttribute("data-plan") + "/cut", btn, (out) => {
      location.href = out.href || "/";
    }),
  );
});

/* ── The footage tab: add a video to this cut ─────────────────────────
   The same gesture as attaching before the project existed. Its moments are
   judged by the rules already on the board the moment it lands, so the whole
   cut is re-produced and the page reloads. */
document.querySelectorAll(".add-source").forEach((btn) => {
  btn.addEventListener("click", async () => {
    if (btn.disabled) return;
    const project = btn.closest("[data-project]");
    if (!project) return;
    btn.disabled = true;
    btn.style.opacity = ".5";
    try {
      const res = await fetch("/api/projects/" + project.getAttribute("data-project") + "/attach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceId: btn.getAttribute("data-source") }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({}));
        window.toast(error || "That didn't change.");
        btn.disabled = false;
        btn.style.opacity = "";
        return;
      }
      location.reload();
    } catch {
      window.toast("That didn't change.");
      btn.disabled = false;
      btn.style.opacity = "";
    }
  });
});

/* ── The footage tab: keep or cut a moment by hand ────────────────────
   Every row's note promises this — "out · rule 02 · click to keep" — and it
   shipped once on a div with no handler, which is a sentence on screen
   telling somebody to do something that does nothing. A hand decision
   overrides every rule above it, so the whole cut is re-produced and the page
   reloads: membership AND order may have changed, and a partial DOM update
   would be a second answer to what the cut is. */
document.querySelectorAll(".moment-hand").forEach((row) => {
  row.addEventListener("click", async () => {
    if (row.disabled) return;
    const project = row.closest("[data-project]");
    if (!project) return;
    /* An "out" row keeps; an "in" row cuts. Pressing the same one twice takes
       the hand back rather than pinning it the other way. */
    const keep = row.getAttribute("data-in") !== "1";
    row.disabled = true;
    row.style.opacity = ".4";
    try {
      const res = await fetch(
        "/api/projects/" + project.getAttribute("data-project") + "/moments/" + row.getAttribute("data-moment"),
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ keep }) },
      );
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({}));
        window.toast(error || "That didn't change.");
        row.disabled = false;
        row.style.opacity = "";
        return;
      }
      location.reload();
    } catch {
      window.toast("That didn't change.");
      row.disabled = false;
      row.style.opacity = "";
    }
  });
});

/* ── The room: the MAKE cards ──────────────────────────────────────────
   Each card writes the sentence you would have typed and leaves the cursor
   at the end of it. They shipped once as links to a query the server never
   read — six controls that looked like they started something and reloaded
   the page unchanged — which is why they are buttons now and why the fidelity
   gate grew a rule about hrefs nobody reads. */
document.querySelectorAll(".make-card").forEach((card) => {
  card.addEventListener("click", () => {
    const brief = $("#brief");
    if (!brief) return;
    brief.value = card.getAttribute("data-make") || "";
    brief.focus();
    /* At the END, because half of these are openings to finish — "a video
       about ", "every time I mention " — and dropping the cursor at the
       start would put the typing in front of the sentence. */
    brief.setSelectionRange(brief.value.length, brief.value.length);
    brief.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
});

/* ── The room: the Scout row ───────────────────────────────────────────
   Two controls in one row, so the press has to be told apart. The pill
   cycles the preference; the row seeds the composer with Scout, find
   so the next thing you do is ask him for something.

   THE WORDS COME FROM THE SERVER. outside.ts holds the pill labels and the
   three lines, and this file is one String.raw template with no
   interpolation in it, so restating them here would mean two copies that
   disagree the day one is reworded. The row carries all three states as
   data attributes and this reads the one the server names back. */
const scoutRow = $("#scoutRow");
if (scoutRow) {
  const pill = $("#scoutPref");
  const line = $("#scoutRowLine");
  const paint = (pref) => {
    if (!pref) return;
    const nextPill = scoutRow.getAttribute("data-pill-" + pref);
    const nextLine = scoutRow.getAttribute("data-line-" + pref);
    /* An unknown state repaints nothing rather than emptying the row. */
    if (nextPill === null || nextLine === null) return;
    pill.setAttribute("data-pref", pref);
    pill.textContent = nextPill;
    line.textContent = nextLine;
  };
  const cycle = async () => {
    if (pill.dataset.busy === "1") return;
    pill.dataset.busy = "1";
    const from = pill.getAttribute("data-pref");
    try {
      const r = await fetch("/api/account/outside", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error("no");
      paint(j.pref);
      /* Somebody else moved it in another tab. The pill now shows the
         truth; saying so is better than a press that looks ignored. */
      if (j.stale) window.toast("Scout was already set to " + pill.textContent + ".");
    } catch {
      window.toast("That didn't change.");
    }
    pill.dataset.busy = "0";
  };
  pill.addEventListener("click", (e) => { e.stopPropagation(); cycle(); });
  pill.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    e.stopPropagation();
    cycle();
  });
  const seed = () => {
    const brief = $("#brief");
    if (!brief) return;
    brief.value = "Scout, find ";
    brief.focus();
    brief.setSelectionRange(brief.value.length, brief.value.length);
    brief.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  scoutRow.addEventListener("click", seed);
  scoutRow.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    seed();
  });
}

/*
 * THE PROPOSAL ROW — what it would do, waiting to be agreed to.
 *
 * Only ever shown on Ask. The diff is the point of it: a row that said only
 * "6 moments · 4:12" leaves the reader to remember what it is now, and the
 * consequence of a rule IS the difference, so both ends travel with it.
 *
 * Nothing has been written when this appears. Leave it discards a proposal
 * and not an edit, which is why the second button is not called Undo.
 */
function showProposal(p, decide) {
  const row = $("#proposal");
  if (!row) return;
  const rule = $("#proposalRule");
  const diff = $("#proposalDiff");
  const add = $("#proposalAdd");
  const bin = $("#proposalBin");

  rule.textContent = (p.rules || []).join(" ") || p.instruction;
  /* No diff when the current state could not be worked out — say nothing
     rather than half a comparison. */
  diff.textContent = p.from && p.to
    ? p.from.kept + " moments \u00b7 " + clockOf(p.from.secs) + "  \u2192  " + p.to.kept + " moments \u00b7 " + clockOf(p.to.secs)
    : "";
  row.hidden = false;

  const close = () => { row.hidden = true; add.onclick = null; bin.onclick = null; };
  add.onclick = () => { close(); decide(true); };
  bin.onclick = close;
}

/* m:ss, the one format this product shows a runtime in. */
function clockOf(secs) {
  const n = Math.max(0, Math.round(secs || 0));
  return Math.floor(n / 60) + ":" + String(n % 60).padStart(2, "0");
}

/*
 * THE ASSISTANT COLUMN STOPS ABOVE THE EXPORT BAR.
 *
 * The column is sticky and viewport-tall, the bar is sticky to the bottom
 * and paints over whatever is beneath it, and the composer lives at the foot
 * of the column. So the column's height has to be "from where it starts to
 * where the bar starts".
 *
 * CSS CANNOT READ THE FIRST OF THOSE. A sticky top only applies once the
 * page has scrolled; before that the column begins wherever the content
 * above it ends, and that moves with the title, the rules and anything else
 * the page is carrying. shell.ts subtracts a constant, which is right for
 * exactly one header — it was wrong by 13px on a project with one more rule
 * than the one it was tuned against, and the composer sat under the bar
 * until you scrolled. check-editor.cjs asserts the two never overlap and is
 * the only reason that was ever noticed.
 *
 * So it is measured here, where both numbers exist. On load and on resize,
 * never on scroll: scrolling only pins the column HIGHER, which gives it
 * more room than this, and resizing a column while somebody scrolls is a
 * jitter nobody asked for.
 */
const aside = $(".asst");
if (aside) {
  /*
   * NO BAR ANY MORE. It used to stop above the sticky export bar; the bar
   * is gone — One Take has no such thing and its Export is in the title row
   * — so the column simply runs to the bottom of the window. That is 55px
   * the conversation did not have, which is most of what it was short of.
   */
  let fitted = "";
  const fitAside = () => {
    /*
     * WHERE THE COLUMN STARTS RIGHT NOW, not where it starts at the top of
     * the page.
     *
     * It is sticky: scrolling pins it at 88px and hands it another 160 of
     * height. Sizing it once for the unscrolled position cost it that room
     * for the whole session to be correct for the first moment — and the
     * room is what the conversation is short of.
     */
    const startsAt = Math.max(0, aside.getBoundingClientRect().top);
    /* 360 is the floor shell.ts already sets: below that the conversation
       has no room and a scrollbar is the better answer than a crush. */
    const room = Math.max(360, window.innerHeight - startsAt);
    const want = room + "px";
    /* Only when it actually changes. The observer below watches the page,
       and the page contains this column — writing the same height back
       every time would be a loop that never settles. */
    if (want === fitted) return;
    fitted = want;
    aside.style.height = want;

  };
  fitAside();
  window.addEventListener("resize", fitAside);
  /*
   * AND AGAIN WHENEVER THE PAGE ABOVE IT MOVES.
   *
   * Both numbers this depends on settle late. The bar is 53px before the
   * fonts load and 55px after; the column's own start shifts by a pixel or
   * two as the conversation above it fills in. Sized once on load, the
   * composer finished two pixels under the bar — still under the bar, and
   * check-editor.cjs said so.
   *
   * A couple of pixels of safety margin would have hidden that rather than
   * fixed it. Both numbers are live, so both are read live.
   */
  if (window.ResizeObserver) new ResizeObserver(fitAside).observe(document.body);
  /* And on scroll, because that is when it pins and the number changes.
     Passive, and a no-op once the height stops moving. */
  window.addEventListener("scroll", fitAside, { passive: true });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitAside);
}

/* ── The room: the composer's dial and its mic ────────────────────────
   The dial cycles Ask → Recommend → Auto. Its words come from the server for
   the same reason the Scout row's do: this file is one String.raw template
   with no interpolation in it, so a second copy of them here would disagree
   the day one is reworded. All three ride on the button. */
const askMode = $("#askMode");
if (askMode) {
  const askModeLabel = $("#askModeLabel");
  const paintMode = (mode) => {
    if (!mode) return;
    const label = askMode.getAttribute("data-label-" + mode);
    const hint = askMode.getAttribute("data-hint-" + mode);
    if (label === null || hint === null) return;
    askMode.setAttribute("data-mode", mode);
    askMode.title = hint;
    askModeLabel.textContent = label;
  };
  askMode.addEventListener("click", async () => {
    if (askMode.dataset.busy === "1") return;
    askMode.dataset.busy = "1";
    try {
      const r = await fetch("/api/account/ask-mode", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from: askMode.getAttribute("data-mode") }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error("no");
      paintMode(j.mode);
      if (j.stale) window.toast("That was already set to " + askModeLabel.textContent + ".");
    } catch {
      window.toast("That didn't change.");
    }
    askMode.dataset.busy = "0";
  });
}

/* The room composer's mic — the same wiring as the assistant's, which is why
   it is the same function and the same classes. It fills #brief and does not
   press Run it. */
const roomComposer = $("#composer");
if (roomComposer) {
  wireMic(roomComposer.querySelector(".asst-mic"), $("#brief"), {
    dot: roomComposer.querySelector(".asst-mic-dot"),
    label: roomComposer.querySelector(".asst-mic-label"),
    hint: null,
    idleLabel: "Say it",
  });
}

/* ── The rules pane: switch one off ───────────────────────────────────
   Invariant 1: a cut is re-produced from rules. So this does not patch the
   document it disagrees with — it tells the server the rule's new state and
   reloads, because the whole cut may have changed membership AND order and
   a partial DOM update would be a second, drifting answer to what the cut is.

   NOT routed through doUndoable. A toggle is its own inverse and is already
   reversible by pressing it again; an undo entry would be a second way to say
   the same thing that could disagree with the first. */
document.querySelectorAll(".rule-toggle").forEach((btn) => {
  btn.addEventListener("click", async () => {
    if (btn.disabled) return;
    const project = btn.closest("[data-project]");
    if (!project) return;
    const next = btn.getAttribute("data-on") !== "1";
    btn.disabled = true;
    btn.style.opacity = ".5";
    try {
      const res = await fetch(
        "/api/projects/" + project.getAttribute("data-project") + "/rules/" + btn.getAttribute("data-rule"),
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ on: next }) },
      );
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({}));
        window.toast(error || "That didn't change.");
        btn.disabled = false;
        btn.style.opacity = "";
        return;
      }
      location.reload();
    } catch {
      /* Offline or the worker died. Say so and put the control back, rather
         than leaving a greyed-out row that looks like it worked. */
      window.toast("That didn't change.");
      btn.disabled = false;
      btn.style.opacity = "";
    }
  });
});

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
    /* By class. This asked for "div > div", which on a card is the media
       box's first child and not the words at all. */
    const quote = row.querySelector(".clip-quote");
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
        body: JSON.stringify({ instruction, apply: apply === true }),
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
      if (!job) {
        clearInterval(tickClock);
        /* The pass has landed, so the snapshot taken when it started becomes
           the undo the next page offers. */
        const held = sessionStorage.getItem("pass-undo:" + projectId);
        if (held) {
          sessionStorage.removeItem("pass-undo:" + projectId);
          sessionStorage.setItem("undo:" + projectId, held);
        }
        location.reload();
        return;
      }
      if (label && job.stage_label) label.textContent = job.stage_label;
      if (typeof job.pct === "number") {
        if (bar) bar.style.width = job.pct + "%";
        /* Zero is not a measurement — see the note beside shownPct in
           src/ui/pages/cut.ts. A one-window pass has no fraction to give
           until it is finished, and printing 0 beside a running clock reads
           as a stalled product. */
        if (pctEl) pctEl.textContent = job.pct > 0 ? job.pct + "%" : "";
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
          enhance: data.get("enhance") === "1",
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
      if (!busy) { clearInterval(tick); location.reload(); return; }

      /* The stage moves while it works — "putting it together", then "saving
         it" — and this only ever reloaded at the end, so the row said the same
         four words for the whole encode however long that was. */
      for (const r of renders || []) {
        if (r.state !== "queued" && r.state !== "running") continue;
        const row = exportsEl.querySelector('.job-row[data-render="' + r.id + '"]');
        const label = row && row.querySelector("[data-stage]");
        if (label && r.stage_label) label.textContent = r.stage_label;
      }
    } catch (err) {
      /* A blip is not a reason to stop watching; the next tick tries again. */
    }
  }, 4000);
}

/*
 * WATCH THE CUT.
 *
 * The editor has always played the ORIGINAL. Striking a line greys it out and
 * changes a number, and that is the whole feedback you get — so the one
 * question a text editor for video should answer instantly, does my cut
 * actually flow, could only be answered by exporting the file and watching it.
 *
 * The ranges come from the server, not from the DOM. /api/projects/:id/edl is
 * the same builder the export is cut from, which is what makes this a preview
 * rather than an impression: if it plays, that is what you get.
 */
document.addEventListener("click", async (e) => {
  const btn = e.target && e.target.closest && e.target.closest(".pl-cut");
  if (!btn) return;
  e.preventDefault();

  const video = document.querySelector("#cut-video");
  const api = video && players.get(video);
  if (!api) return void toast("There's nothing to play yet.");

  /* Off again: back to the whole video, wherever it happens to be. */
  if (btn.getAttribute("aria-pressed") === "true") {
    api.setCut(null);
    btn.setAttribute("aria-pressed", "false");
    btn.textContent = "Watch the cut";
    return;
  }

  btn.disabled = true;
  try {
    const res = await fetch("/api/projects/" + btn.getAttribute("data-project") + "/edl");
    if (!res.ok) throw new Error("no edl");
    const { cuts } = await res.json();
    const ranges = (cuts || []).map((c) => ({
      /* previewKey is the editing copy; sourceKey is the master the render
         uses. Playing the master here would scrub gigabytes. */
      key: c.previewKey || c.sourceKey,
      start: c.start_ms / 1000,
      end: c.end_ms / 1000,
      /* Narration recorded over this shot. The export mixes it in; a preview
         that showed the picture in silence would be lying about the file. */
      voice: c.voiceKey || null,
    }));
    if (!ranges.length) {
      return void toast("There's nothing kept to watch yet.");
    }
    api.setCut(ranges);
    btn.setAttribute("aria-pressed", "true");
    btn.textContent = "Whole video";
  } catch (err) {
    toast("Couldn't work out the cut.");
  } finally {
    btn.disabled = false;
  }
});

/*
 * STOP.
 *
 * There was no way to stop anything in this product — not an export, not a
 * pass. When one wedged, the only way out was to edit the database, and the
 * owner had to ask for that. A row you can only wait on is a row that can
 * trap you.
 *
 * Delegated from the document rather than bound per row, because the export
 * strip repaints itself as renders finish and a handler bound to a row that
 * has been replaced is a dead button.
 *
 * The reload is the point: the server has written the failure and its reason,
 * so the page re-reads it rather than this inventing a state to draw.
 */
document.addEventListener("click", async (e) => {
  const stop = e.target && e.target.closest && e.target.closest(".job-stop, .pass-stop");
  if (!stop) return;
  e.preventDefault();
  if (stop.disabled) return;
  stop.disabled = true;
  stop.textContent = "Stopping";

  const render = stop.getAttribute("data-render");
  const project = stop.getAttribute("data-project");
  const url = render
    ? "/api/renders/" + render + "/stop"
    : "/api/projects/" + project + "/pass/stop";
  try {
    const res = await fetch(url, { method: "POST" });
    if (!res.ok) throw new Error("stop failed");
    location.reload();
  } catch (err) {
    /* It is still running, so say so rather than leaving a dead control. */
    stop.disabled = false;
    stop.textContent = "Stop";
  }
});

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
 * One renderer, wherever you press it: this and the editor's per-block button
 * reach the same route. Captions are ON, because a short is the one export
 * that is watched with the sound off — both callers sent "None" here, so
 * every short this product has ever made came out bare while the landing page
 * promised "captions burned in".
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
        body: JSON.stringify({ aspect: "9:16", captionStyle: "Bold" }),
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

/*
 * FRAMES FOR CLIPS AND FINISHED EXPORTS.
 *
 * Each paints its own moment rather than wearing the source's first frame —
 * the same piece the editor uses for block rows, called wherever a card or a
 * row needs a picture of itself.
 */
/* Gated on the canvases themselves, not on something else being on the page.
   This asked for [data-short], [data-moment] first — which the finished-short
   cards do not carry — so a page showing only shorts you had MADE matched
   nothing, the painter never ran, and every frame stayed black. The thing to
   ask about is the thing you are about to paint. */
const shortFrames = document.querySelectorAll(".short-frame");
if (shortFrames.length) paintMoments(shortFrames, "");

/*
 * WATCHING A FINISHED EXPORT WITHOUT LEAVING THE PAGE.
 *
 * Exports listed a file, a size and a Download button, and that was the whole
 * row: the only way to see whether a render came out right was to fetch it and
 * open it in something else. The frame is a button now, and this is what it
 * does. One at a time, because two videos playing over each other is never
 * what anybody meant.
 *
 * No aspect is passed in. A video with a real src carries its own intrinsic
 * shape, so max-width and max-height frame a 9:16 short and a 16:9 cut
 * correctly without either being told which it is.
 */
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".exp-play");
  if (!btn) return;
  const item = btn.closest(".exp-item");
  const stage = item && item.querySelector(".exp-stage");
  if (!stage) return;

  const shut = (s) => { s.hidden = true; s.innerHTML = ""; };
  document.querySelectorAll(".exp-stage").forEach((s) => { if (s !== stage) shut(s); });

  if (!stage.hidden) return shut(stage);

  const v = document.createElement("video");
  v.src = "/media/" + btn.getAttribute("data-media");
  v.controls = true;
  v.autoplay = true;
  v.playsInline = true;
  v.style.cssText = "max-width:100%;max-height:60vh;background:#000;border-radius:9px;display:block";

  const wrap = document.createElement("div");
  wrap.style.cssText = "display:flex;justify-content:center";
  wrap.appendChild(v);

  stage.innerHTML = "";
  stage.appendChild(wrap);
  stage.hidden = false;
});

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
  if (video) players.set(video, wirePlayer(bar, video));
});

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

/*
 * SAYING THE INSTRUCTION INSTEAD OF TYPING IT.
 *
 * Nothing in this market does this — the search for it turns up only voice
 * OUTPUT, text-to-speech and cloning. The reason it is worth having and the
 * reason it must NOT fire the thing it is attached to are the same one:
 * editing is issue-then-review, voice is good at issuing and bad at
 * reviewing, and review is where the time goes. So the words land in the box
 * and you press the button yourself.
 *
 * Same getUserMedia and MediaRecorder the beat recorder uses, and the same
 * blinking red dot, because it means the same thing.
 *
 * ONE COPY, TWO COMPOSERS. The project assistant had this and the room's
 * composer did not, which is the prototype's mic missing from the front
 * door. A second copy of a MediaRecorder dance is a second place for the
 * stream not to be released, so the parts are passed in and the behaviour
 * is not.
 */
function wireMic(mic, field, parts) {
  if (!mic || !navigator.mediaDevices) return;
  const dot = parts.dot;
  const label = parts.label;
  const hint = parts.hint;
  const hintWas = hint ? hint.textContent : "";
  let rec = null;
  let stream = null;

  const say = (t) => { if (label) label.textContent = t; };
  const note = (t) => { if (hint) hint.textContent = t; };
  const idle = () => {
    if (dot) dot.hidden = true;
    say(parts.idleLabel);
    mic.disabled = false;
  };

  const stop = () => {
    if (rec && rec.state !== "inactive") rec.stop();
    if (stream) stream.getTracks().forEach((t) => t.stop());
    rec = null;
    stream = null;
  };

  mic.addEventListener("click", async () => {
    if (rec) { stop(); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      toast("I could not reach the microphone.");
      return;
    }
    const chunks = [];
    rec = new MediaRecorder(stream);
    rec.addEventListener("dataavailable", (e) => { if (e.data && e.data.size) chunks.push(e.data); });
    rec.addEventListener("stop", async () => {
      if (dot) dot.hidden = true;
      /* NOT "Listening" — it has stopped listening, that is why we are here.
         The hint below says what is happening; the button must not disagree
         with it. */
      say("Working…");
      mic.disabled = true;
      note("Working out what you said…");
      try {
        const blob = new Blob(chunks, { type: "audio/webm" });
        /* Nothing to send is not an error worth a toast — you pressed twice. */
        if (blob.size < 1200) { idle(); note(hintWas); return; }
        const res = await fetch("/api/dictate", {
          method: "POST",
          headers: { "content-type": "audio/webm" },
          body: blob,
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error || "I did not catch that");
        if (field) {
          /* Appended, not replaced: pressing it twice adds a second
             sentence rather than throwing the first one away. */
          const now = (field.value || "").trim();
          field.value = now ? now + " " + out.text : out.text;
          field.focus();
          field.dispatchEvent(new Event("input", { bubbles: true }));
        }
        note(hintWas);
      } catch (err) {
        note(hintWas);
        toast((err && err.message) || "I did not catch that");
      } finally {
        idle();
      }
    });
    rec.start();
    if (dot) dot.hidden = false;
    say("Stop");
    note("Listening — press again when you are done.");
  });
}

`;
