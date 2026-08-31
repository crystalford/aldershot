/**
 * The upload service worker.
 *
 * An upload used to run in the page that started it, so clicking any link
 * killed it — silently, mid-file, with the part loop simply ceasing to exist
 * along with its tab. The owner lost an upload that way, and the complaint was
 * exactly right: browsing the site is not cancelling anything.
 *
 * A service worker is the only thing in a browser that outlives the page that
 * started the work. The part loop lives here now; pages hand it a file and
 * then become optional. Navigate, close the tab and come back, land on a
 * different surface — the upload carries on, and whatever page is open picks
 * the progress back up because progress is broadcast to every client rather
 * than returned to one.
 *
 * The server side needed no changes at all: uploads were already R2 multipart
 * with an id and per-part retries. What was missing was somewhere durable to
 * run the loop.
 */

export const SW_JS = String.raw`
/* Take over without waiting for a reload, so the first upload of a session is
   covered rather than the second. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

/** Tell every open page, not just the one that started this. */
async function broadcast(message) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: "window" });
  for (const c of clients) c.postMessage(message);
}

/* One upload at a time, keyed by source id, so a double-click cannot start
   the same file twice. */
const running = new Map();

async function uploadParts(job) {
  const { file, sourceId, uploadId, partSize, durationS } = job;
  const total = Math.ceil(file.size / partSize);
  const parts = [];
  let sent = 0;

  for (let n = 1; n <= total; n++) {
    if (running.get(sourceId) === "cancelled") {
      await fetch("/api/uploads/" + sourceId + "/abort", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uploadId }),
      }).catch(() => {});
      await broadcast({ type: "upload-cancelled", sourceId });
      return;
    }

    const chunk = file.slice((n - 1) * partSize, n * partSize);
    let lastErr = null;

    /* Three attempts per part with a widening gap — the same policy the page
       used. A part is small enough that retrying it is cheap, which is the
       whole point of parts. */
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch("/api/uploads/" + sourceId + "/parts/" + n, {
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

    /* Progress is the fraction of bytes the server has actually accepted,
       never a timer. */
    sent += chunk.size;
    await broadcast({
      type: "upload-progress",
      sourceId,
      name: file.name,
      pct: Math.round((sent / file.size) * 100),
    });
  }

  const done = await fetch("/api/uploads/" + sourceId + "/complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ uploadId, parts, durationS }),
  });
  if (!done.ok) throw new Error((await done.json().catch(() => ({}))).error || "couldn't finish the upload");

  const data = await done.json();
  await broadcast({
    type: "upload-done",
    sourceId,
    name: file.name,
    href: "/sources/" + sourceId,
    jobId: data.jobId || null,
  });
}

self.addEventListener("message", (event) => {
  const msg = event.data || {};

  if (msg.type === "cancel-upload") {
    if (running.has(msg.sourceId)) running.set(msg.sourceId, "cancelled");
    return;
  }

  if (msg.type !== "start-upload") return;
  if (running.has(msg.sourceId)) return;
  running.set(msg.sourceId, "running");

  /*
   * waitUntil is what keeps this worker alive for the duration. Without it the
   * browser is free to shut the worker down between events — mid-upload — and
   * we would have rebuilt the original bug somewhere harder to see.
   */
  event.waitUntil(
    uploadParts(msg)
      .catch(async (err) => {
        await broadcast({
          type: "upload-failed",
          sourceId: msg.sourceId,
          name: msg.file && msg.file.name,
          error: (err && err.message) || "the upload stopped",
        });
      })
      .finally(() => running.delete(msg.sourceId)),
  );
});
`;
