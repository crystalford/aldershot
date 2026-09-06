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

/*
 * How long one 8MB part may take before we give up on that attempt.
 *
 * There was NO timeout here, and that is what stalled a 2.14GB upload halfway:
 * a single connection hung, fetch waited on it forever, and the loop had no way
 * to notice. It never failed, so nothing retried and nothing reported — the
 * chip simply stopped counting. A hung request has to become a failed request
 * before any retry policy means anything.
 */
function partTimeoutMs(partSize) {
  /* Scaled to the part, not fixed: parts are now sized for the file, so a
     multi-gigabyte upload uses 32-64MB parts and a flat 90s would abort a
     perfectly healthy one on a phone. 30s of slack plus 4s per megabyte is
     about 2Mbps sustained, well under any connection worth uploading on. */
  return 30000 + (partSize / (1024 * 1024)) * 4000;
}

/* Parts in flight at once. Sequential upload of a 2GB file is 268 round trips
   nose to tail, which is both slow and a long window in which something can
   go wrong. Four is enough to saturate a normal connection without burying a
   phone's radio. */
const CONCURRENCY = 4;

/* Presigned URLs, fetched a batch at a time and reused across retries. */
async function partUrls(sourceId, numbers) {
  const res = await fetch("/api/uploads/" + sourceId + "/part-urls", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ parts: numbers }),
  });
  if (!res.ok) return {};
  return (await res.json()).urls || {};
}

/**
 * Send one part straight to R2.
 *
 * The Worker never sees these bytes — its only job was to say who may write
 * here, which the presigned URL already carries. R2 answers with an ETag, which
 * is its receipt for the part; we hand that back so the server can record what
 * landed and complete the upload later. The ETag is only readable because the
 * bucket CORS policy exposes it (scripts/set-cors.mjs).
 */
async function putPartDirect(sourceId, url, n, chunk, timeoutMs) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method: "PUT", body: chunk, signal: ctl.signal });
      if (!res.ok) throw new Error("part " + n + " failed (" + res.status + ")");
      const etag = res.headers.get("etag");
      if (!etag) throw new Error("part " + n + " gave no etag");

      await fetch("/api/uploads/" + sourceId + "/parts/" + n + "/done", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ etag, bytes: chunk.size }),
      });
      return { partNumber: n, etag };
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error("part " + n + " failed");
}

async function putPart(sourceId, uploadId, n, chunk, timeoutMs) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    /* Abort rather than wait forever. This is the fix for the stall: a hung
       connection has to become a failed request before any retry can happen. */
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch("/api/uploads/" + sourceId + "/parts/" + n, {
        method: "PUT",
        headers: { "x-upload-id": uploadId, "content-type": "application/octet-stream" },
        body: chunk,
        signal: ctl.signal,
      });
      if (!res.ok) throw new Error("part " + n + " failed (" + res.status + ")");
      return await res.json();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error("part " + n + " failed");
}

async function uploadParts(job) {
  const { file, sourceId, uploadId, partSize, durationS } = job;
  const total = Math.ceil(file.size / partSize);

  /*
   * Ask the SERVER what it already holds rather than trusting what this
   * worker remembers. The worker may have been killed, or this may be an
   * entirely different session picking the file back up — in both cases the
   * only reliable record of what landed is the one the server wrote as each
   * part arrived. Same idea as YouTube's resumable upload, where the client
   * queries the offset instead of assuming it.
   */
  const done = new Map((job.doneParts || []).map((p) => [p.partNumber, p]));
  try {
    const state = await fetch("/api/uploads/" + sourceId + "/state").then((r) => (r.ok ? r.json() : null));
    if (state && state.parts) for (const p of state.parts) done.set(p.partNumber, p);
  } catch (err) {
    /* Falling back to what we remember is fine — worst case a part is sent
       twice, and the same part number simply replaces itself. */
  }
  const todo = [];
  for (let n = 1; n <= total; n++) if (!done.has(n)) todo.push(n);

  let cursor = 0;
  let failed = null;
  const timeoutMs = partTimeoutMs(partSize);
  const direct = job.mode === "direct";

  /* URLs are fetched in blocks so a long upload is not holding hundreds of
     write capabilities open from the start. */
  let urls = {};
  const urlFor = async (n) => {
    if (urls[n]) return urls[n];
    const block = todo.slice(todo.indexOf(n), todo.indexOf(n) + 32);
    urls = { ...urls, ...(await partUrls(sourceId, block)) };
    return urls[n];
  };

  /* Bytes already stored before this run, so a resumed upload reports true
     progress rather than restarting the speed maths from zero. */
  const bytesAt = (count) => Math.min(count * partSize, file.size);
  const startedAt = Date.now();
  const bytesAtStart = bytesAt(done.size);

  const report = () => {
    const sent = bytesAt(done.size);
    const elapsed = (Date.now() - startedAt) / 1000;
    /* Measured from bytes the server has actually accepted — never a timer,
       and never counting the parts still in flight. */
    const bps = elapsed > 0 ? (sent - bytesAtStart) / elapsed : 0;
    const left = file.size - sent;
    return broadcast({
      type: "upload-progress",
      sourceId,
      name: file.name,
      pct: Math.round((done.size / total) * 100),
      sent,
      totalBytes: file.size,
      bps,
      etaS: bps > 0 ? Math.round(left / bps) : null,
      /* The page keeps this so it can hand the work back if this worker is
         killed — Safari terminates service workers aggressively, and a 2GB
         upload is a long time to stay alive. */
      doneParts: [...done.values()],
    });
  };

  async function worker() {
    while (cursor < todo.length && !failed) {
      if (running.get(sourceId) === "cancelled") return;
      const n = todo[cursor++];
      try {
        const chunk = file.slice((n - 1) * partSize, n * partSize);
        let part;
        if (direct) {
          const url = await urlFor(n);
          if (!url) throw new Error("couldn't get an upload URL for part " + n);
          part = await putPartDirect(sourceId, url, n, chunk, timeoutMs);
        } else {
          part = await putPart(sourceId, uploadId, n, chunk, timeoutMs);
        }
        done.set(n, part);
        await report();
      } catch (err) {
        failed = err;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));

  if (running.get(sourceId) === "cancelled") {
    await fetch("/api/uploads/" + sourceId + "/abort", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uploadId }),
    }).catch(() => {});
    await broadcast({ type: "upload-cancelled", sourceId });
    return;
  }
  if (failed) throw failed;

  /* R2 wants the parts in order; concurrency finishes them out of order. */
  const parts = [...done.values()].sort((a, b) => a.partNumber - b.partNumber);

  const res = await fetch("/api/uploads/" + sourceId + "/complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ uploadId, parts, durationS }),
  });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) || {}).error || "couldn't finish the upload");

  const data = await res.json();
  await broadcast({
    type: "upload-done",
    sent: file.size,
    totalBytes: file.size,
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

  /* A resume is allowed to take over: the page only sends one when progress
     has stopped, which means either this worker was killed (and the map is
     empty anyway) or the previous run is wedged. Re-sending a part that is
     already stored is harmless — the same part number simply replaces it. */
  if (running.has(msg.sourceId) && !msg.resume) return;
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
