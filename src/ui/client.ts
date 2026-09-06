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

/* ── Keyboard map (10-ROUTES-AND-KEYS.md) ─────────────────────────────── */
let goArmed = false;
const GO = { h: "/", p: "/projects", c: "/clipping", f: "/footage", s: "/settings" };

document.addEventListener("keydown", (e) => {
  if (inField(e.target)) return;

  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    return; /* search overlay lands with the Ask surface */
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    const r = undoStack.pop();
    if (r) r();
    return;
  }
  if (e.key === "?") { e.preventDefault(); return; }
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
      "font-family:'Instrument Sans',sans-serif;font-size:12.5px;max-width:min(420px,calc(100vw - 40px))";
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
    } catch { return; }
    if (!pending.length || document.querySelector("#uploadChip")) return;

    const p = pending[0];
    if (!p.total_bytes || !p.parts_done) return;

    const el = document.createElement("div");
    el.id = "uploadChip";
    el.style.cssText =
      "position:fixed;left:20px;bottom:20px;z-index:60;display:flex;align-items:center;gap:12px;" +
      "padding:12px 16px;border-radius:9px;background:#141418;color:#ECECF1;" +
      "box-shadow:inset 0 0 0 1px rgba(217,179,106,0.3), 0 12px 40px rgba(0,0,0,0.45);" +
      "font-family:'Instrument Sans',sans-serif;font-size:12.5px;max-width:min(460px,calc(100vw - 40px))";
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
  composer.addEventListener("drop", (e) => { picked = e.dataTransfer?.files?.[0] || picked; attach(picked); });
  $("#filePick")?.addEventListener("change", (e) => { picked = e.target.files?.[0] || null; attach(picked); });
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
document.querySelectorAll(".render-cut").forEach((btn) => {
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = "Putting it together…";
    try {
      const res = await fetch("/api/renders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: btn.getAttribute("data-project"), format: "mp4_1080", aspect: "16:9" }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || "That didn't render");
      toast("Rendering — it'll appear in Exports when it's done");
      btn.textContent = original;
      btn.disabled = false;
    } catch (err) {
      btn.textContent = original;
      btn.disabled = false;
      toast(err.message);
    }
  });
});

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
  const retotal = () => {
    if (!runtimeEl) return;
    let ms = 0;
    let n = 0;
    scratch.querySelectorAll("[data-seg-block]").forEach((el) => {
      if (el.getAttribute("data-kept") !== "1") return;
      n += 1;
      ms += Number(el.getAttribute("data-ms") || 0);
    });
    const secs = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(secs / 3600), mm = Math.floor((secs % 3600) / 60), ss = secs % 60;
    const clock = h > 0
      ? h + ":" + String(mm).padStart(2, "0") + ":" + String(ss).padStart(2, "0")
      : mm + ":" + String(ss).padStart(2, "0");
    runtimeEl.textContent = n + " kept \u00b7 " + clock;
  };

  const paint = (block, kept) => {
    const btn = block.querySelector(".seg-keep");
    const text = block.querySelector("[data-seg-text]");
    block.setAttribute("data-kept", kept ? "1" : "0");
    block.style.opacity = kept ? "" : ".55";
    if (text) text.style.textDecoration = kept ? "" : "line-through";
    if (btn) {
      btn.setAttribute("data-kept", kept ? "1" : "0");
      const pill = btn.querySelector(".seg-pill");
      if (pill) {
        pill.textContent = kept ? "Keeping" : "Add back";
        pill.setAttribute("data-kept", kept ? "1" : "0");
      }
    }
  };

  /* Clicking a line's frame seeks the player to it. Reading and watching are
     the same gesture here — that is the point of the surface. */
  const scratchVideo = document.querySelector("#scratch-video");
  scratch.querySelectorAll(".seg-play").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!scratchVideo) return;
      scratchVideo.currentTime = Number(btn.getAttribute("data-start") || 0) / 1000;
      scratchVideo.play().catch(() => {});
    });
  });

  scratch.querySelectorAll(".seg-keep").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const block = btn.closest("[data-seg-block]");
      if (!block || btn.disabled) return;
      const next = block.getAttribute("data-kept") !== "1";

      btn.disabled = true;
      paint(block, next);
      retotal();

      try {
        const res = await fetch("/api/projects/" + scratch.getAttribute("data-project") + "/cuts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind: "segment", seg: Number(btn.getAttribute("data-seg")), word: null }),
        });
        if (!res.ok) throw new Error("That didn't save");
      } catch (err) {
        paint(block, !next);
        retotal();
        toast((err && err.message) || "That didn't save");
      } finally {
        btn.disabled = false;
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

/* Footage's Upload button. It was a bare label with a file input and no
   handler at all, so the most obvious way into the product did nothing. */
const footageUpload = document.querySelector("#footageUpload");
if (footageUpload) {
  footageUpload.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
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
      if (!sw) { toast("Uploads need a modern browser here"); return; }
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
    } catch (err) {
      toast(err.message || "Couldn't add that video");
    }
  });
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
    const recBtn = e.target.closest(".record");

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

    if (recBtn) record(recBtn);
  });
}

/* "Generate it" on a beat that wants your voice.
   Recording is still the real answer and stays the primary button; this is
   for filling a beat so the whole cut can be watched before you commit to
   recording anything. */
document.querySelectorAll('.beat-action[data-action="Generate it"]').forEach((btn) => {
  btn.addEventListener("click", async () => {
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Generating…";
    try {
      const res = await fetch("/api/beats/" + btn.getAttribute("data-beat") + "/tts", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't generate that");
      location.reload();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = original;
      toast(err.message || "Couldn't generate that");
    }
  });
});

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
