/**
 * ULIDs. The data model specifies them for every id (03-DATA-MODEL.md), and
 * their lexicographic sortability by creation time is load-bearing: it makes
 * `ORDER BY id` a valid chronological order without a second index.
 */

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32, no I/L/O/U

function encodeTime(now: number, len: number): string {
  let out = "";
  for (let i = len - 1; i >= 0; i--) {
    const mod = now % 32;
    out = ENCODING[mod] + out;
    now = (now - mod) / 32;
  }
  return out;
}

function encodeRandom(len: number): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) out += ENCODING[bytes[i] % 32];
  return out;
}

export function ulid(now = Date.now()): string {
  return encodeTime(now, 10) + encodeRandom(16);
}
