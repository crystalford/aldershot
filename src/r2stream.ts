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
    /* pipeTo runs ALONGSIDE the put rather than before it, or the two deadlock
       waiting on each other. Deliberately not awaited here. */
    void res.body.pipeTo(fixed.writable);
    const stored = await bucket.put(key, fixed.readable, {
      httpMetadata: { contentType: opts.contentType },
    });
    return stored?.size ?? declared;
  }

  const cap = opts.maxBufferBytes ?? 128 * 1024 * 1024;
  const buf = await res.arrayBuffer();
  if (buf.byteLength > cap) {
    throw new Error("that came back too large to handle in one piece");
  }
  const stored = await bucket.put(key, buf, { httpMetadata: { contentType: opts.contentType } });
  return stored?.size ?? buf.byteLength;
}
