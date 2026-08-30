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

      const data = await uploadResumable(picked, durationS, (pct) => {
        button.textContent = "Uploading " + pct + "%";
      });

      /* A quarter of the way in, past titles and black frames.
         Awaited, not fired-and-forgotten: navigating away cancels an in-flight
         request, which silently loses every poster. Bounded so a slow decode
         never holds the user on this page — a missing poster is a blank
         thumbnail, which is honest; a fake one is not. */
      button.textContent = "Reading…";
      await Promise.race([
        grabPoster(picked, Math.max(1, (durationS || 8) * 0.25))
          .then((blob) =>
            blob &&
            fetch("/api/sources/" + data.source.id + "/poster", {
              method: "POST",
              headers: { "content-type": "image/jpeg" },
              body: blob,
            }),
          )
          .catch(() => {}),
        new Promise((r) => setTimeout(r, 4000)),
      ]);

      location.href = "/sources/" + data.source.id;
    } catch (err) {
      button.disabled = false;
      button.textContent = original;
      toast(err.message || "Couldn't add that video");
    }
  });
}

/* Sends the file to R2 in 8MB parts.
   A 45-180 minute source is gigabytes, so this is not an optimisation: a
   single PUT cannot carry it, and without parts one blip means starting the
   whole upload again. Each part retries on its own, and progress is the
   fraction of bytes actually accepted — never a timer. */
async function uploadResumable(file, durationS, onProgress) {
  const start = await fetch("/api/uploads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ filename: file.name, contentType: file.type || "video/mp4" }),
  }).then((r) => r.json());

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
