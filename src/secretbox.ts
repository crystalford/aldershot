/**
 * A SECRET SOMEBODY ELSE OWNS, AT REST.
 *
 * Connecting your own bucket means handing Aldershot a read-only key to your
 * archive, and that key has to be stored to be used again. Storing it as
 * plaintext in D1 would mean one read of one table is every connected
 * customer's storage — so it is encrypted, and the only thing in the database
 * is ciphertext.
 *
 * AES-GCM, keyed off the same `SESSION_SECRET` that signs sessions. Not
 * because one key for two jobs is ideal, but because the alternative is a
 * second secret that a deployment can forget to set — and a missing
 * encryption key that silently falls back to a constant is worse than
 * sharing one that is already required to exist and already fails loudly
 * when it does not.
 *
 * GCM rather than CBC: it authenticates as well as encrypts, so a tampered
 * row fails to open instead of decrypting to rubbish that then gets signed
 * into a request to somebody's bucket.
 *
 * THE IV IS RANDOM PER SEAL and travels with the ciphertext. Reusing one
 * across two values under the same key is the classic way to lose a stream
 * cipher's secrecy entirely.
 */
import { secretOf } from "./auth.ts";
import type { Env } from "./env.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();

async function keyFor(env: Env): Promise<CryptoKey> {
  /* A passphrase is not a key. SHA-256 gives AES the 32 bytes it wants from
     whatever length the secret happens to be. */
  const material = await crypto.subtle.digest("SHA-256", enc.encode(secretOf(env)));
  return crypto.subtle.importKey("raw", material, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

const b64 = (bytes: Uint8Array): string => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};

const unb64 = (s: string): Uint8Array =>
  Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

/** Ciphertext, with its IV in front of it. Safe to put in a column. */
export async function seal(env: Env, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyFor(env), enc.encode(plain)),
  );
  const out = new Uint8Array(iv.length + body.length);
  out.set(iv, 0);
  out.set(body, iv.length);
  return b64(out);
}

/**
 * The plaintext again, or null.
 *
 * Null rather than a throw, for every way it can fail: a row written under a
 * different SESSION_SECRET, a truncated column, a tampered one. The caller's
 * honest answer is the same in all of them — this connection cannot be used,
 * reconnect it — and that is a sentence, not a stack trace.
 */
export async function open(env: Env, sealed: string): Promise<string | null> {
  try {
    const raw = unb64(sealed);
    if (raw.length <= 12) return null;
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: raw.slice(0, 12) },
      await keyFor(env),
      raw.slice(12),
    );
    return dec.decode(plain);
  } catch {
    return null;
  }
}
