/**
 * Putting a container's response into R2.
 *
 * R2 refuses a stream whose length it does not know — "Provided readable
 * stream must have a known length (request/response body or readable half of
 * FixedLengthStream)". The container always sets Content-Length, and the
 * header always arrives, but the BODY does not survive as a known-length body
 * through the container proxy, so handing `res.body` straight to `put` throws.
 *
 * This is the fourth place that needed to know that. src/audio.ts worked it
 * out and wrote it down; src/proxy.ts copied it; the cut render and the short
 * render did not, and both failed at the very last step of a successful
 * encode — the owner's export ran the encoder for fifty-four seconds, produced
 * the file, and then reported "Couldn't put it together" because of this line.
 * A rule that lives in a comment in one file is a rule the next file breaks,
 * so it lives here now and there is one way to do it.
 *
 * Streamed rather than buffered by default: holding a finished mp4 in Worker
 * memory to hand it to R2 is a ceiling reachable from the export panel, where
 * 4K is offered with no length limit.
 */

/**
 * @param maxBufferBytes what to allow when the container declares no length at
 *   all. Buffering is the only option left then, so it is BOUNDED — a clear
 *   refusal beats an out-of-memory crash, which is the failure this avoids.
 */
export async function putFromResponse(
  bucket: R2Bucket,
  key: string,
  res: Response,
  opts: { contentType: string; maxBufferBytes?: number },
): Promise<number> {
  if (!res.body) throw new Error("the encoder returned no body");

  const declared = Number(res.headers.get("content-length") || 0);

  if (declared > 0) {
    const fixed = new FixedLengthStream(declared);
    /*
     * THIS IS WHAT THE CONTAINER BILL WAS.
     *
     * @cloudflare/containers decrements its in-flight counter inside
     * `res.body.pipeTo(writable).finally(...)`, and its sleep check reads:
     *
     *     if (this.inflightRequests > 0) { this.renewActivityTimeout(); return false; }
     *
     * — so a response body nobody finishes renews sleepAfter FOR EVER, and the
     * instance bills its whole ALLOCATED memory, awake and idle, until the
     * Durable Object is evicted. Twelve days of that read as $23.58 of
     * container memory against $0.10 of container vCPU.
     *
     * This function used to run `void res.body.pipeTo(fixed.writable)` and then
     * await the put. When the put rejected — an R2 error, a length ffmpeg did
     * not match — nothing ever read the other end and one machine was stranded
     * awake per failure.
     *
     * PUMPED BY HAND rather than piped, because pipeTo takes the one thing
     * needed to fix it: a handle to cancel with. Measured, not assumed —
     * aborting a pipeTo whose destination nobody reads does not release the
     * source, it hangs; cancelling our end of the body settles the container's
     * pipe immediately. So the reader is held, and cancelled on failure.
     *
     * The pump is not awaited on the failure path — it may still be blocked on
     * a write nobody is draining, and the cancel above has already done the
     * part that matters.
     */
    const reader = res.body.getReader();
    const writer = fixed.writable.getWriter();
    const pump = (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) { await writer.close(); return; }
        await writer.write(value);
      }
    })().catch(() => {
      /* The put below is what reports a failure to the caller; a pump that
         dies on the way is that same failure seen from the other end. */
    });

    try {
      const stored = await bucket.put(key, fixed.readable, {
        httpMetadata: { contentType: opts.contentType },
      });
      await pump;
      return stored?.size ?? declared;
    } catch (err) {
      await reader.cancel().catch(() => {});
      throw err;
    }
  }

  const cap = opts.maxBufferBytes ?? 128 * 1024 * 1024;
  const buf = await res.arrayBuffer();
  if (buf.byteLength > cap) {
    throw new Error("that came back too large to handle in one piece");
  }
  const stored = await bucket.put(key, buf, { httpMetadata: { contentType: opts.contentType } });
  return stored?.size ?? buf.byteLength;
}
