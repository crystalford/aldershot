/**
 * Putting a container's response into R2.
 *
 * "Couldn't put it together: Provided readable stream must have a known length
 * (request/response body or readable half of FixedLengthStream)."
 *
 * The encode had SUCCEEDED. Fifty-four seconds of work on four vCPUs, the file
 * made, and the export failed on the line that stores it — because R2 refuses
 * a stream whose length it does not know, and the container's Content-Length
 * header arrives but the body does not survive as a known-length body through
 * the container proxy.
 *
 * src/audio.ts worked this out and wrote it down in a comment. src/proxy.ts
 * copied the comment. The cut render and the short render did neither, so both
 * were broken in the same way at the same line. A rule that lives in a comment
 * in one file is a rule the next file breaks, so it lives in one function now
 * and this is what pins it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { putFromResponse } from "../src/r2stream.ts";

/** An R2 that records what it was handed, and refuses what the real one does. */
function fakeR2() {
  const puts: Array<{ key: string; kind: string; bytes: number }> = [];
  return {
    puts,
    async put(key: string, body: unknown, _o: unknown) {
      if (body instanceof ReadableStream) {
        /* The real R2 throws exactly here for a stream it cannot measure. Our
           FixedLengthStream readable is marked by the shim below. */
        if (!(body as { __known?: boolean }).__known) {
          throw new Error("Provided readable stream must have a known length (request/response body or readable half of FixedLengthStream)");
        }
        let bytes = 0;
        const reader = body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.length;
        }
        puts.push({ key, kind: "stream", bytes });
        return { size: bytes };
      }
      const bytes = (body as ArrayBuffer).byteLength;
      puts.push({ key, kind: "buffer", bytes });
      return { size: bytes };
    },
  };
}

/* Workers' FixedLengthStream, thin enough to test the shape that matters:
   a readable R2 will accept, and a writable the body pipes into. */
class FakeFixedLengthStream {
  readable: ReadableStream;
  writable: WritableStream;
  constructor(_len: number) {
    const ts = new TransformStream();
    this.readable = ts.readable;
    (this.readable as { __known?: boolean }).__known = true;
    this.writable = ts.writable;
  }
}
(globalThis as { FixedLengthStream?: unknown }).FixedLengthStream = FakeFixedLengthStream;

const bodyOf = (n: number) =>
  new ReadableStream({
    start(c) { c.enqueue(new Uint8Array(n)); c.close(); },
  });

test("a declared length is streamed, never buffered", async () => {
  const r2 = fakeR2();
  const res = new Response(bodyOf(2048), { headers: { "content-length": "2048", "content-type": "video/mp4" } });
  const size = await putFromResponse(r2 as never, "u/1/renders/x.mp4", res, { contentType: "video/mp4" });

  assert.equal(r2.puts.length, 1);
  assert.equal(r2.puts[0].kind, "stream", "a finished 4K export was held in Worker memory");
  assert.equal(size, 2048);
});

test("the stream handed to R2 is one R2 accepts", async () => {
  /*
   * The regression itself. Passing res.body straight through looks correct,
   * works nowhere, and fails only at the very end of a long successful encode
   * — which is the most expensive moment to find out.
   */
  const r2 = fakeR2();
  const res = new Response(bodyOf(64), { headers: { "content-length": "64" } });
  await assert.doesNotReject(
    () => putFromResponse(r2 as never, "k", res, { contentType: "video/mp4" }),
    "R2 refused the stream — this is the export failing at its last line",
  );
});

test("no declared length falls back to a BOUNDED buffer", async () => {
  const r2 = fakeR2();
  const res = new Response(bodyOf(100));
  const size = await putFromResponse(r2 as never, "k", res, { contentType: "video/mp4" });
  assert.equal(r2.puts[0].kind, "buffer");
  assert.equal(size, 100);
});

test("an unmeasurable body larger than the bound is refused, not crashed into", async () => {
  /* A clear refusal beats an out-of-memory crash, which reads as an encoder
     fault rather than as the Worker running out of room. */
  const r2 = fakeR2();
  const res = new Response(bodyOf(4096));
  await assert.rejects(
    () => putFromResponse(r2 as never, "k", res, { contentType: "video/mp4", maxBufferBytes: 1024 }),
    /too large/,
  );
  assert.equal(r2.puts.length, 0, "it stored a truncated file rather than refusing");
});

test("a response with no body at all is a readable failure", async () => {
  const r2 = fakeR2();
  await assert.rejects(
    () => putFromResponse(r2 as never, "k", new Response(null, { status: 204 }), { contentType: "video/mp4" }),
    /no body/,
  );
});

test("a failed store releases the body instead of stranding a container", async () => {
  /*
   * THE CONTAINER BILL, AS AN INVARIANT.
   *
   * Twelve days of Cloudflare: $23.58 of container MEMORY against $0.10 of
   * container vCPU. Read together those two numbers say 218 hours of instances
   * awake and 1.4 vCPU-hours of work done inside them — 0.16% utilisation. The
   * machines were not encoding. They were awake and idle, billing their whole
   * ALLOCATED memory, because memory bills on allocation x wall-clock while
   * vCPU bills only on what is consumed.
   *
   * The mechanism is in @cloudflare/containers:
   *
   *     res.body.pipeTo(writable).finally(() => this.decrementInflight());
   *     ...
   *     isActivityExpired() {
   *       if (this.inflightRequests > 0) { this.renewActivityTimeout(); return false; }
   *
   * pipeTo settles only when a body is fully read OR cancelled. Abandon one and
   * it stalls on backpressure, the counter never returns to zero, and
   * sleepAfter is renewed for the life of the Durable Object. ONE abandoned
   * response body is ONE machine billing all day for nothing.
   *
   * This function had exactly that shape: `void res.body.pipeTo(fixed.writable)`
   * followed by an awaited `bucket.put`. When the put rejected — an R2 error, a
   * length ffmpeg did not match — nothing ever read the other end.
   *
   * Silent, which is why it is a test and not a comment: the feature works, no
   * page changes and nothing else fails. It just bills.
   */
  let released = false;
  /*
   * A body big enough to still be arriving when the put fails — which is the
   * only case that can leak. A small one drains before anything goes wrong,
   * and a fully-drained body settles the container's pipe by itself. This is a
   * render, so "still arriving" is the normal case.
   */
  const body = new ReadableStream({
    pull(c) { c.enqueue(new Uint8Array(65536)); },
    cancel() { released = true; },
  });
  const res = new Response(body, { headers: { "content-length": "99999999" } });
  const angry = { put: async () => { throw new Error("R2 said no"); } };

  await assert.rejects(
    () => putFromResponse(angry as never, "u/1/renders/x.mp4", res, { contentType: "video/mp4" }),
    /R2 said no/,
    "the failure must still reach the caller",
  );
  assert.equal(released, true, "and the body must be released on the way out");
});

test("and a store that works drains it rather than cancelling it", async () => {
  /* So the fix cannot be "cancel everything": a cancelled body on the success
     path is a truncated file, which is the worse bug of the two. */
  const r2 = fakeR2();
  const res = new Response(bodyOf(2048), { headers: { "content-length": "2048" } });
  assert.equal(await putFromResponse(r2 as never, "u/1/renders/y.mp4", res, { contentType: "video/mp4" }), 2048);
  assert.equal(r2.puts[0].bytes, 2048, "every byte must reach R2");
});
