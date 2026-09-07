/**
 * Talking to the encoder.
 *
 * One place, because there are two callers — a cut (src/render-job.ts) and a
 * short (src/short-render.ts) — and they had drifted into two different
 * conversations with the same container.
 *
 * The conversation used to be a single fetch held open for the whole encode.
 * That is why an export sat at 30%: `runRender` advanced the job to 30, called
 * the container, and had nothing further to say until the mp4 came back. The
 * owner watched 30% for long enough to conclude the product was broken, and he
 * was right to.
 *
 * So the container runs the render as a job of its own and this polls it. The
 * percentage that reaches the user is parts finished out of parts total,
 * measured inside the encoder — the rule this codebase already holds itself
 * to (04-API-AND-JOBS.md: "the percentages must be real").
 */

/** What the container will answer with while it works. */
export interface EncodeStatus {
  stage: string;
  pct: number;
  done: number;
  total: number;
  error: string | null;
  ready: boolean;
}

/** Anything that can be fetched like a container: the binding, or RENDER_URL. */
export interface Encoder {
  fetch(url: string, init?: RequestInit): Promise<Response>;
}

/**
 * How often to ask.
 *
 * Fast at first, because a short is often finished within a few seconds and
 * the card should not sit on a stale number for ten of them; slower after
 * that, because a long export would otherwise spend a thousand subrequests on
 * asking. Every poll also resets the container's sleepAfter, which is what
 * keeps a long encode's instance awake.
 */
const POLL_FAST_MS = 2_000;
const POLL_SLOW_MS = 8_000;
const FAST_FOR_MS = 60_000;
const MAX_POLLS = 400;

export class EncodeError extends Error {}

/**
 * Not a failure — a decision.
 *
 * Separate from EncodeError so the caller does not overwrite the reason the
 * user is already looking at. Stop has already written "You stopped this."
 * onto both rows; the job must not then report that the encoder broke.
 */
export class Cancelled extends Error {}

/**
 * Runs one encode and hands back the response holding the mp4.
 *
 * `onProgress` is called with the container's own measured fraction, and only
 * when it changes — a caller writing to D1 on every poll would be writing the
 * same row twenty times.
 *
 * `deadlineMs` is a real deadline rather than a fetch timeout: the old code
 * put an AbortSignal on one long fetch, which could only fire if the container
 * never answered at all. A container that answers and then wedges mid-encode
 * was invisible. This watches the clock across the whole conversation.
 */
export async function encode(
  encoder: Encoder,
  plan: unknown,
  opts: {
    deadlineMs: number;
    onProgress?: (status: EncodeStatus) => void | Promise<void>;
    /*
     * Has the user given up on this?
     *
     * Asked between polls rather than watched, because there is nothing to
     * watch — the Stop route writes to D1 from a different request. Returning
     * true here ends the conversation immediately, so the queue consumer stops
     * holding an invocation open for work nobody wants.
     */
    cancelled?: () => Promise<boolean>;
    /* Both injectable so the deadline can be tested without waiting for it. */
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  },
): Promise<Response> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const startedAt = now();

  const started = await encoder.fetch("http://container/render", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(plan),
    signal: AbortSignal.timeout(60_000),
  });
  if (!started.ok) {
    const detail = await started.text().catch(() => "");
    throw new EncodeError(detail.slice(0, 200) || `The encoder wouldn't start it (${started.status})`);
  }
  const { id } = (await started.json()) as { id?: string };
  if (!id) throw new EncodeError("The encoder didn't say what it was working on.");

  let lastPct = -1;
  /* A Worker gets a bounded number of subrequests, and a clock that misbehaves
     must not be able to spend them all on asking the same question. */
  let polls = 0;
  for (;;) {
    const elapsed = now() - startedAt;
    if (elapsed > opts.deadlineMs || ++polls > MAX_POLLS) {
      throw new EncodeError("The encoder didn't finish in time. It may be busy — try the export again.");
    }
    await sleep(elapsed < FAST_FOR_MS ? POLL_FAST_MS : POLL_SLOW_MS);

    const res = await encoder.fetch(`http://container/render/status?id=${id}`, {
      signal: AbortSignal.timeout(30_000),
    });
    /*
     * A container that has been recycled has forgotten this render. There is
     * nothing to wait for and nothing to collect, so say so rather than
     * polling a 404 until the deadline.
     */
    if (res.status === 404) throw new EncodeError("The encoder restarted partway through. Try the export again.");
    if (!res.ok) throw new EncodeError(`The encoder stopped answering (${res.status})`);

    const status = (await res.json()) as EncodeStatus;
    if (status.error) throw new EncodeError(`Couldn't put it together: ${String(status.error).slice(0, 200)}`);
    if (await opts.cancelled?.()) throw new Cancelled("You stopped this.");
    if (status.pct !== lastPct) {
      lastPct = status.pct;
      await opts.onProgress?.(status);
    }
    if (status.ready) break;
  }

  const result = await encoder.fetch(`http://container/render/result?id=${id}`, {
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  if (!result.ok || !result.body) {
    const detail = await result.text().catch(() => "");
    throw new EncodeError(detail.slice(0, 200) || `Couldn't collect the finished video (${result.status})`);
  }
  return result;
}

/**
 * The encoder for this piece of work.
 *
 * RENDER_URL exists so the render can be exercised in development, where
 * Cloudflare Containers need a Docker daemon that a sandbox usually does not
 * have. `node container/render.mjs` is a plain HTTP server — point this at it
 * and the whole path runs for real, which is how the concat, the burned-in
 * captions, the aspect sizing and the voiceover card were finally verified
 * instead of reasoned about.
 *
 * RENDER_URL WINS when it is set, because the binding can exist and still not
 * work — wrangler dev declares it whether or not containers are enabled, and
 * calling it then fails with "Containers have not been enabled for this
 * Durable Object class". Setting the variable is a deliberate act; production
 * never does, so the binding is used there.
 *
 * `name` decides WHICH instance. It must be unique per piece of work: keyed by
 * project, two exports of the same edit landed on one container and the second
 * queued behind the first — which is exactly what the owner saw, "one at 30%
 * and the others just I guess queued".
 */
export function encoderFor(
  /* Structurally typed rather than `Env`, so the tests can hand it a stub —
     but `RENDER` is the DO namespace as declared, not a widened one, because
     a namespace parameterised on its class does not assign to a bare one. */
  env: { RENDER?: { idFromName(name: string): DurableObjectId; get(id: DurableObjectId): unknown }; RENDER_URL?: string },
  name: string,
): Encoder | null {
  if (env.RENDER_URL) {
    const base = env.RENDER_URL;
    return {
      fetch: (u: string, init?: RequestInit) =>
        fetch(`${base}${new URL(u).pathname}${new URL(u).search}`, init),
    };
  }
  if (!env.RENDER) return null;
  return env.RENDER.get(env.RENDER.idFromName(name)) as unknown as Encoder;
}
