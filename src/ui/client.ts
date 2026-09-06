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

/* ── The editor ────────────────────────────────────────────────────────
   One surface, five gestures: strike a line, strike a word inside it, move a
   block, insert one, export. They were spread across four stages that felt
   like the same stage — see docs/decisions/blocks.md. */
const blocksEl = document.querySelector("#blocks");
if (blocksEl) {
  const projectId = blocksEl.getAttribute("data-project");
  const video = document.querySelector("#cut-video");
  const footRuntime = document.querySelector("#cut-runtime");
  const headRuntime = document.querySelector("#head-runtime");
  const headKept = document.querySelector("#head-kept");

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
  const retotal = (afterS) => {
    const kept = [...blocksEl.querySelectorAll(".blk")].filter((el) => el.dataset.struck !== "1");
    const ms = typeof afterS === "number"
      ? afterS * 1000
      : kept.reduce((n, el) => n + Number(el.getAttribute("data-ms") || 0), 0);
    if (footRuntime) footRuntime.textContent = kept.length + " kept · " + clock(ms);
    if (headRuntime) headRuntime.textContent = clock(ms);
    if (headKept) headKept.textContent = kept.length + " kept";
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

  const sendCut = async (payload) => {
    const res = await fetch("/api/projects/" + projectId + "/cuts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("That didn't save");
    return await res.json().catch(() => ({}));
  };

  blocksEl.addEventListener("click", async (e) => {
    const word = e.target.closest(".w");
    const strike = e.target.closest(".blk-strike");
    const move = e.target.closest(".blk-move");
    const play = e.target.closest(".blk-play");
    const insert = e.target.closest(".blk-insert");
    const row = e.target.closest(".blk");

    /* Play from here. Reading and watching are the same gesture, which is the
       whole claim — so the timecode is the control. */
    if (play && video) {
      video.currentTime = Number(play.getAttribute("data-start") || 0) / 1000;
      video.play().catch(() => {});
      return;
    }

    if (word && row && row.dataset.struck !== "1") {
      const seg = Number(word.getAttribute("data-block").slice(2));
      const idx = Number(word.getAttribute("data-word"));
      const gone = word.dataset.cut === "1";
      word.dataset.cut = gone ? "0" : "1";
      word.style.textDecoration = gone ? "" : "line-through";
      word.style.color = gone ? "" : "rgba(236,236,241,0.28)";
      try {
        const out = await sendCut({ kind: "word", seg, word: idx });
        retotal(out.afterS);
      } catch (err) {
        word.dataset.cut = gone ? "1" : "0";
        word.style.textDecoration = gone ? "line-through" : "";
        toast((err && err.message) || "That didn't save");
      }
      return;
    }

    if (strike && row) {
      if (row.dataset.busy === "1") return;
      const next = row.dataset.struck !== "1";
      row.dataset.busy = "1";
      paintBlock(row, next);
      retotal();
      try {
        const out = await sendCut({ kind: "segment", seg: Number(row.getAttribute("data-block").slice(2)), word: null });
        retotal(out.afterS);
      } catch (err) {
        paintBlock(row, !next);
        retotal();
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
        location.reload();
      } catch (err) {
        move.disabled = false;
        toast((err && err.message) || "Couldn't move that");
      }
      return;
    }

    if (insert) {
      insert.disabled = true;
      try {
        const res = await fetch("/api/projects/" + projectId + "/blocks/insert", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ at: Number(insert.getAttribute("data-at")), kind: "vo" }),
        });
        if (!res.ok) throw new Error("Couldn't add that");
        location.reload();
      } catch (err) {
        insert.disabled = false;
        toast((err && err.message) || "Couldn't add that");
      }
    }
  });
}

/* Ask the model which blocks are strong. An assist inside the editor rather
   than a separate place, which is what Clipping had become. */
document.querySelectorAll(".find-good").forEach((btn) => {
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Reading it…";
    try {
      const res = await fetch("/api/projects/" + btn.getAttribute("data-project") + "/passes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instruction: "find the strongest moments" }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) || {}).error || "That didn't start");
      location.reload();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "Find the strong bits";
      toast((err && err.message) || "That didn't start");
    }
  });
});

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
  /* The clip picker is looked up here rather than hoisted, because Build is
     the only surface that renders it. */
  const clipPick = document.querySelector("#clip-picker");
  let closed = false;
  for (const el of [palette, keysheet, notifpanel, clipPick]) {
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

document.addEventListener("keydown", (e) => {
  /* Escape closes whatever is open, from anywhere — including the palette's
     own input, which is a field, so this is checked before inField(). */
  if (e.key === "Escape" && closeOverlays()) { e.preventDefault(); return; }

  if (inField(e.target)) return;

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
function showUpload({ sourceId, name, pct, state, href, error, sent, totalBytes, bps, etaS }) {
  let el = document.querySelector("#uploadChip");
  if (!el) {
    el = document.createElement("div");
    el.id = "uploadChip";
    el.style.cssText =
      "position:fixed;left:20px;bottom:20px;z-index:60;display:flex;align-items:center;gap:12px;" +
      "padding:12px 16px;border-radius:9px;background:#141418;color:#ECECF1;" +
      "box-shadow:inset 0 0 0 1px rgba(255,255,255,0.08), 0 12px 40px rgba(0,0,0,0.45);" +
      "font-size:12.5px;max-width:min(420px,calc(100vw - 40px))";
    document.body.appendChild(el);
  }
  el.setAttribute("data-source", sourceId);

  const dot =
    state === "failed" ? "#E06A6A" : state === "done" ? "#5EC98F" : "#5EB8C9";

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
      ? error || "The upload stopped"
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

  el.innerHTML =
    '<span style="width:6px;height:6px;border-radius:50%;background:' + dot + ';flex:none;margin-top:3px"></span>' +
    '<span style="flex:1;min-width:0">' +
    '<span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + line + "</span>" +
    (detail
      ? '<span style="display:block;margin-top:3px;font-size:11px;color:rgba(236,236,241,0.45);font-family:\'IBM Plex Mono\',monospace">' + detail + "</span>"
      : "") +
    "</span>" +
    (state === "done" && href
      ? '<a href="' + href + '" style="flex:none;font-weight:600;padding:5px 11px;border-radius:5px;background:#1A1A1F;color:#ECECF1">Open</a>'
      : "") +
    (state === "failed"
      ? '<button id="uploadRetry" style="flex:none;font-weight:600;padding:5px 11px;border-radius:5px;background:#1A1A1F;color:#ECECF1;border:none;cursor:pointer;font-family:inherit">Retry</button>'
      : "") +
    (!state
      ? '<div style="position:absolute;left:0;right:0;bottom:0;height:2px;background:#232329;border-radius:0 0 9px 9px;overflow:hidden">' +
        '<div style="height:100%;width:' + pct + '%;background:#5EB8C9;transition:width .25s ease"></div></div>'
      : "");
  el.style.alignItems = "flex-start";

  /* Retry picks up from what the server already holds, so it is a resume and
     not a restart. */
  const retry = el.querySelector("#uploadRetry");
  if (retry) {
    retry.addEventListener("click", async () => {
      const job = inFlight.get(sourceId);
      const sw = await uploadWorker();
      if (!job || !sw) { toast("Choose the file again to carry on"); return; }
      retry.disabled = true;
      sw.postMessage({ ...job.msg, doneParts: job.doneParts, resume: true });
      watchUpload(sourceId);
      showUpload({ sourceId, name, pct: 0 });
    });
  }
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
  const takeFiles = (files) => {
    const list = [...(files || [])];
    if (!list.length) return;
    picked = list[0];
    attach(picked);
    if (list.length > 1) startUploads(list.slice(1));
  };
  composer.addEventListener("drop", (e) => takeFiles(e.dataTransfer?.files));
  $("#filePick")?.addEventListener("change", (e) => { takeFiles(e.target.files); e.target.value = ""; });
  $("#clearFile")?.addEventListener("click", () => { picked = null; attached.hidden = true; });

  /* Begin: upload the video, then follow it to where it is being read.
     The brief is carried along and stays with the source, so a failed read
     offers a retry that does not make the user retype it. */
  composer.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!picked) { brief.focus(); return; }

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
        body: JSON.stringify({ filename: picked.name, contentType: picked.type || "video/mp4", bytes: picked.size }),
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
      body: JSON.stringify({ filename: file.name, contentType: file.type || "video/mp4", bytes: file.size }),
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

/* Grabs a real frame from the video, client-side.
   "Real frames only — no gradients, no coloured blocks, no generated art
   placeholders." Extracting frames server-side needs ffmpeg in a container;
   the browser already has the file in hand, so the poster costs nothing and is
   a genuine frame of the actual video. Server-side frame extraction (one every
   5s, for clip thumbnails) still belongs in the container. */
function grabPoster(file, atSeconds) {
  return new Promise((resolve, reject) => {
    const el = document.createElement("video");
    el.preload = "metadata";
    el.muted = true;
    el.playsInline = true;
    const done = (v) => { URL.revokeObjectURL(el.src); resolve(v); };
    el.onloadedmetadata = () => {
      el.currentTime = Math.min(atSeconds, Math.max(0, (el.duration || 1) - 0.1));
    };
    el.onseeked = () => {
      try {
        const c = document.createElement("canvas");
        const w = 640;
        c.width = w;
        c.height = Math.round((el.videoHeight / el.videoWidth) * w) || 360;
        c.getContext("2d").drawImage(el, 0, 0, c.width, c.height);
        c.toBlob((b) => done(b), "image/jpeg", 0.82);
      } catch { done(null); }
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
const scoring = document.querySelector("#scoring");
if (scoring) {
  const projectId = scoring.getAttribute("data-project");
  const tick = async () => {
    try {
      const { jobs } = await (await fetch("/api/jobs")).json();
      const job = jobs.find((j) => j.ref_id === projectId);
      if (!job) { location.reload(); return; }
      const label = scoring.querySelector("span:last-child");
      if (label && job.stage_label) label.textContent = job.stage_label;
      setTimeout(tick, 2000);
    } catch { setTimeout(tick, 5000); }
  };
  setTimeout(tick, 1500);
}

/* ── Script mode: striking words ───────────────────────────────────────
   Clicking a word strikes that word; clicking the timecode strikes the line.
   Both route through doUndoable like every other edit, so ⌘Z reverts them.

   The struck state is applied optimistically and reconciled against the
   server's answer — the server owns the cut list, and letting the client
   compute it independently is how the two drift and the wrong video gets cut. */
const script = $("#script");
if (script) {
  const projectId = script.getAttribute("data-project");

  async function sendCut(payload) {
    const res = await fetch("/api/projects/" + projectId + "/cuts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("That didn't save");
    return res.json();
  }

  /* Re-paints from the server's cut list, which is the only authority. */
  function paint(cuts) {
    const cutLine = new Set();
    const cutWord = new Set();
    for (const c of cuts) {
      if (c.words === null) cutLine.add(c.seg);
      else for (let i = c.words[0]; i <= c.words[1]; i++) cutWord.add(c.seg + ":" + i);
    }
    script.querySelectorAll(".seg-row").forEach((row) => {
      const seg = Number(row.getAttribute("data-seg"));
      row.style.background = cutLine.has(seg) ? "transparent" : "#17171B";
    });
    script.querySelectorAll(".w").forEach((el) => {
      const seg = Number(el.getAttribute("data-seg"));
      const w = Number(el.getAttribute("data-word"));
      const struck = cutLine.has(seg) || cutWord.has(seg + ":" + w);
      el.style.textDecoration = struck ? "line-through" : "";
      el.style.color = struck ? "rgba(236,236,241,0.3)" : "";
    });
  }

  function runtimeLabel(seconds) {
    const s = Math.max(0, Math.round(seconds));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h > 0
      ? h + ":" + String(m).padStart(2, "0") + ":" + String(sec).padStart(2, "0")
      : m + ":" + String(sec).padStart(2, "0");
  }

  async function applyCut(payload, label) {
    try {
      const { cuts, afterS } = await sendCut(payload);
      paint(cuts);
      /* The "After your cuts" figure, refreshed from the server's own
         calculation rather than recomputed here — the render uses the
         server's ranges, so the number the user reads must come from the
         same place. */
      const stat = script.parentElement.querySelector("[data-after]");
      if (stat) stat.textContent = runtimeLabel(afterS);
    } catch (err) {
      toast(err.message || "That didn't save");
    }
  }

  script.addEventListener("click", async (e) => {
    const word = e.target.closest(".w");
    const segBtn = e.target.closest(".seg-cut");
    const shortBtn = e.target.closest(".make-short");

    /* Make a short out of the line you are reading, without leaving Script.
       The clip goes to Footage like any other, so the button confirms in
       place and links there rather than navigating away mid-edit. */
    if (shortBtn) {
      shortBtn.disabled = true;
      try {
        const res = await fetch("/api/projects/" + script.getAttribute("data-project") + "/shorts-from-line", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ segIdx: Number(shortBtn.getAttribute("data-seg")) }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Couldn't make that");
        shortBtn.textContent = data.made ? "Short made ✓" : "Already saved ✓";
        shortBtn.style.color = "#5EC98F";
      } catch (err) {
        shortBtn.disabled = false;
        toast(err.message || "Couldn't make that");
      }
      return;
    }

    if (word) {
      const payload = { kind: "word", seg: Number(word.getAttribute("data-seg")), word: Number(word.getAttribute("data-word")) };
      const struck = word.style.textDecoration === "line-through";
      window.doUndoable(struck ? "Put back" : "Cut", () => applyCut(payload), () => applyCut(payload));
      return;
    }
    if (segBtn) {
      const payload = { kind: "segment", seg: Number(segBtn.getAttribute("data-seg")), word: null };
      window.doUndoable("Line cut", () => applyCut(payload), () => applyCut(payload));
    }
  });

  document.querySelectorAll("#script ~ * .cleanup, .cleanup[data-kind='fillers-script']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      await applyCut({ kind: "fillers", seg: 0, word: null });
      btn.textContent = "Fillers removed ✓";
      btn.style.background = "transparent";
      btn.style.color = "#5EC98F";
    });
  });
}

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

/*
 * Keep/drop on an unassisted cut.
 *
 * The block IS a transcript line, so this posts the same cut model Script
 * uses — the two stages edit one thing rather than two.
 *
 * It repaints the block in place rather than reloading. A reload per line is
 * what this was, and on a 38-line transcript that is 38 full page loads to
 * make one edit, each one throwing away your scroll position. The toggle is
 * already a toggle server-side, so the optimistic flip is always the answer
 * the server is about to give; if the save fails it flips back and says so.
 */
const scratch = document.querySelector("#pick-scratch");
if (scratch) {
  const runtimeEl = document.querySelector("#scratch-runtime");

  /* Kept count and runtime, recomputed from the DOM — the blocks carry their
     own duration, so the total never drifts from what is on screen. */
  const setTotals = (n, ms) => {
    if (!runtimeEl) return;
    const secs = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(secs / 3600), mm = Math.floor((secs % 3600) / 60), ss = secs % 60;
    const clock = h > 0
      ? h + ":" + String(mm).padStart(2, "0") + ":" + String(ss).padStart(2, "0")
      : mm + ":" + String(ss).padStart(2, "0");
    runtimeEl.textContent = n + " kept \u00b7 " + clock;
    /* The header carries the same two numbers and is server-rendered, so
       without this the top of the page said "38 kept" while its own footer
       said 37. One edit, one count. */
    const hr = document.querySelector("#head-runtime");
    const hk = document.querySelector("#head-kept");
    if (hr) hr.textContent = clock;
    if (hk) hk.textContent = n + " kept";
  };

  /* The optimistic figure, from the blocks themselves — instant, and
     corrected by the server's answer a moment later. */
  const retotal = () => {
    let ms = 0;
    let n = 0;
    scratch.querySelectorAll("[data-seg-block]").forEach((el) => {
      if (el.getAttribute("data-kept") !== "1") return;
      n += 1;
      ms += Number(el.getAttribute("data-ms") || 0);
    });
    setTotals(n, ms);
  };

  const paint = (block, kept) => {
    const text = block.querySelector("[data-seg-text]");
    block.setAttribute("data-kept", kept ? "1" : "0");
    block.style.opacity = kept ? "" : ".5";
    if (text) text.style.textDecoration = kept ? "" : "line-through";
    const pill = block.querySelector(".seg-pill");
    if (pill) {
      pill.textContent = kept ? "Cut" : "Add back";
      pill.setAttribute("data-kept", kept ? "1" : "0");
    }
  };

  /* Clicking a line's frame seeks the player to it. Reading and watching are
     the same gesture here — that is the point of the surface. */
  const scratchVideo = document.querySelector("#scratch-video");

  /* No poster on this source? Take one from the video that is right here. */
  if (scratchVideo && scratchVideo.dataset.needsPoster === "1" && scratchVideo.dataset.source) {
    const grab = () => healPoster(scratchVideo, scratchVideo.dataset.source);
    if (scratchVideo.readyState >= 1) grab();
    else scratchVideo.addEventListener("loadedmetadata", grab, { once: true });
  }
  scratch.querySelectorAll(".seg-play").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!scratchVideo) return;
      scratchVideo.currentTime = Number(btn.getAttribute("data-start") || 0) / 1000;
      scratchVideo.play().catch(() => {});
    });
  });

  /* Both the line and the pill toggle it, so the whole row is the target. The
     in-flight guard lives on the BLOCK rather than the button, or clicking the
     text and then the pill would fire two toggles that cancel out. */
  scratch.querySelectorAll(".seg-keep").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const block = btn.closest("[data-seg-block]");
      if (!block || block.dataset.busy === "1") return;
      const next = block.getAttribute("data-kept") !== "1";

      block.dataset.busy = "1";
      paint(block, next);
      retotal();

      try {
        const res = await fetch("/api/projects/" + scratch.getAttribute("data-project") + "/cuts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind: "segment", seg: Number(btn.getAttribute("data-seg")), word: null }),
        });
        if (!res.ok) throw new Error("That didn't save");
        /* Correct to the server's own figure. The optimistic total above adds
           and subtracts whole segments, but a line can carry word-level trims
           made in Script, so the local guess drifts. afterS comes from the
           same function the render uses. */
        const out = await res.json().catch(() => null);
        if (out && typeof out.afterS === "number" && runtimeEl) {
          const n = scratch.querySelectorAll('[data-seg-block][data-kept="1"]').length;
          setTotals(n, out.afterS * 1000);
        }
      } catch (err) {
        paint(block, !next);
        retotal();
        toast((err && err.message) || "That didn't save");
      } finally {
        block.dataset.busy = "0";
      }
    });
  });
}

/* The Build preview. Plays the real source, seeking to whichever beat you
   click — which is what the scrubber under it always looked like it did. */
const esVideo = document.querySelector("#es-video");
if (esVideo) {
  const toggle = document.querySelector("#es-toggle");
  /* Both icons are already in the button; this only swaps which is hidden.
     No SVG lives in this file — icons.ts is the only place they come from. */
  const paint = () => {
    const play = toggle?.querySelector("[data-play]");
    const pause = toggle?.querySelector("[data-pause]");
    if (!play || !pause) return;
    play.hidden = !esVideo.paused;
    pause.hidden = esVideo.paused;
  };
  toggle?.addEventListener("click", () => { esVideo.paused ? esVideo.play() : esVideo.pause(); });
  esVideo.addEventListener("play", paint);
  esVideo.addEventListener("pause", paint);

  document.querySelectorAll(".es-seek").forEach((seg) => {
    seg.addEventListener("click", () => {
      const at = Number(seg.getAttribute("data-at") || 0) / 1000;
      esVideo.currentTime = at;
      esVideo.play().catch(() => {});
    });
  });

  /* Space plays or pauses, which the surface has always claimed underneath it. */
  document.addEventListener("keydown", (e) => {
    if (e.key !== " " || inField(e.target)) return;
    e.preventDefault();
    esVideo.paused ? esVideo.play() : esVideo.pause();
  });
}

/* ── Build: the controls that were rendered and wired to nothing ───────
   Each of these looked operable and did nothing, which is worse than not
   shipping them. The endpoints all existed; the UI pointed at routes that
   were never defined, or at no route at all. */

/* "Run it" — an extra instruction against what the pass already found. */
document.querySelectorAll(".pass-composer").forEach((box) => {
  const input = box.querySelector(".pass-input");
  const run = box.querySelector(".pass-run");
  const go = async () => {
    const instruction = (input.value || "").trim();
    if (!instruction) { input.focus(); return; }
    run.disabled = true;
    const was = run.textContent;
    run.textContent = "Running…";
    try {
      const res = await fetch("/api/projects/" + box.getAttribute("data-project") + "/passes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instruction }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "That pass didn't run");
      location.reload();
    } catch (err) {
      run.disabled = false;
      run.textContent = was;
      toast(err.message || "That pass didn't run");
    }
  };
  run.addEventListener("click", go);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
});

/* "Add a beat" — the act chips set where it lands, the kind chips create it. */
document.querySelectorAll(".add-beat").forEach((chip) => {
  chip.addEventListener("click", async () => {
    const kind = chip.getAttribute("data-kind");
    if (!kind) return;
    const panel = chip.closest("#add-beat");
    const act = panel?.querySelector('input[name="act"]:checked')?.value || null;
    chip.disabled = true;
    try {
      const res = await fetch("/api/projects/" + chip.getAttribute("data-project") + "/beats", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, act }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Couldn't add that");
      location.reload();
    } catch (err) {
      chip.disabled = false;
      toast(err.message || "Couldn't add that");
    }
  });
});

/* The act chips are radios; the selected one has to look selected. */
document.querySelectorAll(".act-pick input").forEach((radio) => {
  radio.addEventListener("change", () => {
    document.querySelectorAll(".act-pick").forEach((l) => {
      l.style.background = l.querySelector("input")?.checked ? "#2E2E36" : "#232329";
    });
  });
});

/* Remove a beat. Undoable, like every other destructive edit here. */
document.querySelectorAll(".remove-beat").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const build = document.querySelector("#build");
    if (!build) return;
    btn.disabled = true;
    try {
      const res = await fetch(
        "/api/projects/" + build.getAttribute("data-project") + "/beats/" + btn.getAttribute("data-beat"),
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Couldn't remove that");
      location.reload();
    } catch (err) {
      btn.disabled = false;
      toast(err.message || "Couldn't remove that");
    }
  });
});

/* Beat text. Saved on blur rather than per keystroke — this is prose being
   written, and a request per character would be absurd. */
document.querySelectorAll(".beat-text").forEach((box) => {
  let saved = box.value;
  box.addEventListener("blur", async () => {
    const text = box.value;
    if (text === saved) return;
    const build = document.querySelector("#build");
    if (!build) return;
    try {
      const res = await fetch(
        "/api/projects/" + build.getAttribute("data-project") + "/beats/" + box.getAttribute("data-beat"),
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) },
      );
      if (!res.ok) throw new Error("That didn't save");
      saved = text;
    } catch (err) {
      toast(err.message || "That didn't save");
    }
  });
});

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
    body: JSON.stringify({ filename: file.name, contentType: file.type || "video/mp4", bytes: file.size }),
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
 * Start several.
 *
 * You could only ever add one video at a time, because every picker was a bare
 * input with no multiple attribute and every handler read files[0]. Anyone
 * with a shoot to load had to sit through them one by one.
 *
 * Started in sequence rather than all at once: each one opens an R2 multipart
 * upload and the service worker already runs four parts concurrently, so
 * firing ten together would mean forty parallel connections fighting for the
 * same uplink and every file crawling. They queue, and the worker keeps going
 * across navigation regardless.
 */
async function startUploads(files) {
  const list = [...(files || [])].filter((f) => f && f.size > 0);
  if (!list.length) return;

  let failed = 0;
  for (const file of list) {
    try {
      await startUpload(file);
    } catch (err) {
      failed += 1;
      toast((err && err.message) || ("Couldn't add " + file.name));
    }
  }
  const ok = list.length - failed;
  if (list.length > 1 && ok > 0) toast(ok + " videos uploading — you can carry on browsing");
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

/**
 * Pick a clip for a beat.
 *
 * Four buttons offered this and none worked, and there was no route behind
 * them either — a beat's clip was fixed at creation. The overlay markup is
 * rendered by the page (hidden) so its colours stay tokens; this fills it.
 */
async function openClipPicker(beatId, projectId) {
  const picker = document.querySelector("#clip-picker");
  const list = document.querySelector("#clip-picker-list");
  if (!picker || !list) return;

  list.innerHTML = '<div class="pal-note">Loading…</div>';
  picker.hidden = false;

  try {
    const res = await fetch("/api/projects/" + projectId + "/clips");
    const { clips } = await res.json();
    if (!clips || !clips.length) {
      list.innerHTML = '<div class="pal-note">No clips in this footage yet — ask for a pass first.</div>';
      return;
    }
    const mmss = (ms) => {
      const t = Math.max(0, Math.round(ms / 1000));
      return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0");
    };
    list.innerHTML = clips
      .map(
        (c) =>
          '<button class="pal-row pick-clip" data-clip="' + c.id + '" style="width:100%;border:none;text-align:left;font-family:inherit">' +
          '<span class="pal-title">' + escapeHtml(c.quote) + "</span>" +
          '<span class="pal-sub">' + mmss(c.start_ms) + "</span></button>",
      )
      .join("");

    list.querySelectorAll(".pick-clip").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          const r = await fetch("/api/projects/" + projectId + "/beats/" + beatId, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ clipId: btn.getAttribute("data-clip") }),
          });
          if (!r.ok) throw new Error("That didn't attach");
          location.reload();
        } catch (err) {
          toast((err && err.message) || "That didn't attach");
        }
      });
    });
  } catch (err) {
    list.innerHTML = '<div class="pal-note">Couldn\'t load your clips.</div>';
  }
}

/* Clicking the scrim closes the picker, like every other overlay here. */
const clipPickerEl = document.querySelector("#clip-picker");
if (clipPickerEl) {
  clipPickerEl.addEventListener("click", (e) => { if (e.target === clipPickerEl) clipPickerEl.hidden = true; });
}

/* ── Build: beats, seams, recording ────────────────────────────────────
   The seam is how anything gets inserted mid-piece; recording happens in the
   browser and only reaches the server once the user has a take they want. */
const build = $("#build");
if (build) {
  const projectId = build.getAttribute("data-project");

  build.addEventListener("click", async (e) => {
    const seamBtn = e.target.closest(".seam");
    const moveBtn = e.target.closest(".move-beat");
    /*
     * ROUTED ON data-action, not on a class.
     *
     * actionButton renders every beat action as .beat-action, and this
     * listener used to look for .record — a class Build has never rendered.
     * So the recording handler and POST /api/beats/:id/record both existed
     * and could not be reached from anywhere: you could not record a
     * voiceover at all, which is the one thing Build uniquely offers.
     *
     * Routing on the label the button already carries fixes every action at
     * once and cannot drift from the markup the way a parallel class can.
     */
    const actionBtn = e.target.closest(".beat-action");
    const action = actionBtn ? actionBtn.getAttribute("data-action") : null;

    if (seamBtn) {
      /* A seam inserts a beat that needs the user's voice — the common case.
         The block appears immediately with Record on it. */
      try {
        const res = await fetch("/api/projects/" + projectId + "/beats", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ at: Number(seamBtn.getAttribute("data-at")), kind: "vo" }),
        });
        if (!res.ok) throw new Error("Couldn't add that");
        location.reload();
      } catch (err) { toast(err.message); }
      return;
    }

    if (moveBtn) {
      try {
        const res = await fetch(
          "/api/projects/" + projectId + "/beats/" + moveBtn.getAttribute("data-beat") + "/move",
          { method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ dir: Number(moveBtn.getAttribute("data-dir")) }) },
        );
        if (!res.ok) throw new Error("Couldn't move that");
        location.reload();
      } catch (err) { toast(err.message); }
      return;
    }

    if (action === "Record" || action === "Record reaction") {
      record(actionBtn);
      return;
    }

    if (action === "Redo") {
      /* Throw the take away, then go straight back into recording — "Redo"
         means do it again, not "now find the record button". */
      try {
        const res = await fetch("/api/projects/" + projectId + "/beats/" + actionBtn.getAttribute("data-beat"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ clearMedia: true }),
        });
        if (!res.ok) throw new Error("Couldn't clear that take");
        record(actionBtn);
      } catch (err) {
        toast((err && err.message) || "Couldn't clear that take");
      }
      return;
    }

    if (action === "Generate" || action === "Generate it") {
      /* "Generate" and "Generate it" are the same job; only "Generate it" was
         ever bound, so the shorter label was dead on every beat that used it. */
      const original = actionBtn.textContent;
      actionBtn.disabled = true;
      actionBtn.textContent = "Generating…";
      try {
        const res = await fetch("/api/beats/" + actionBtn.getAttribute("data-beat") + "/tts", { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Couldn't generate that");
        location.reload();
      } catch (err) {
        actionBtn.disabled = false;
        actionBtn.textContent = original;
        toast((err && err.message) || "Couldn't generate that");
      }
      return;
    }

    if (action === "Swap clip" || action === "Swap" || action === "Pick from Footage" || action === "Pick a clip") {
      openClipPicker(actionBtn.getAttribute("data-beat"), projectId);
      return;
    }
  });
}

/* "Generate it" on a beat that wants your voice.
   Recording is still the real answer and stays the primary button; this is
   for filling a beat so the whole cut can be watched before you commit to
   recording anything. */
/* The standalone "Generate it" binding lived here. It is handled by the
   delegated router above now, which also reaches "Generate" — the same job
   under a shorter label, which was dead because only the longer one was bound. */

/* In-browser recording for a vo or react beat.
   Recording never touches the server until the user stops — a take they
   abandon should cost nothing and leave nothing behind. */
async function record(button) {
  if (button.dataset.recording === "1") return;

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    toast("Couldn't reach your microphone");
    return;
  }

  const beatId = button.getAttribute("data-beat");
  const chunks = [];
  const started = Date.now();
  const recorder = new MediaRecorder(stream);
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  const original = button.textContent;
  button.dataset.recording = "1";
  button.textContent = "Stop & keep";

  recorder.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    button.dataset.recording = "0";
    button.textContent = "Saving…";
    try {
      const blob = new Blob(chunks, { type: "audio/webm" });
      const res = await fetch("/api/beats/" + beatId + "/record", {
        method: "POST",
        headers: { "content-type": "audio/webm", "x-duration-ms": String(Date.now() - started) },
        body: blob,
      });
      if (!res.ok) throw new Error("That take didn't save");
      location.reload();
    } catch (err) {
      button.textContent = original;
      toast(err.message);
    }
  };

  recorder.start();
  const stop = () => { if (recorder.state !== "inactive") recorder.stop(); };
  button.addEventListener("click", stop, { once: true });
}

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
        body: JSON.stringify({ filename: file.name, contentType: file.type || "video/mp4", bytes: file.size }),
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
document.querySelectorAll(".make-short").forEach((btn) => {
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    const was = btn.textContent;
    btn.textContent = "Making it…";
    /* The Shape and Captions chips on this page were decorative — the client
       never sent them and the API had no field for them. They drive the render
       now; with no form on the page (the library view) a short is vertical
       with no captions, which is what a short is. */
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
const clipForm = document.querySelector(".clip-form");
if (clipForm) {
  /* The chips are radios, so keyboard and form semantics come for free; the
     visual state has to follow the checked one. */
  clipForm.addEventListener("change", () => {
    clipForm.querySelectorAll("input[type=radio]").forEach((input) => {
      const chip = input.nextElementSibling;
      if (!chip) return;
      chip.style.background = input.checked ? "#2E2E36" : "#17171B";
      chip.style.color = input.checked ? "#ECECF1" : "rgba(236,236,241,0.55)";
    });
  });

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
