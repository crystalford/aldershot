/**
 * Lightweight "import from URL" resolver — turns a page/link into a directly
 * fetchable media URL, server-side, with no downloader binary.
 *
 * Supported today: Rumble (via its public embed API) and direct media links
 * (.mp4/.webm/.mov/.m4a…). YouTube & friends deliberately obfuscate their
 * streams and need the yt-dlp engine (Route 2) — not handled here.
 */
const UA = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "accept-language": "en-US,en;q=0.9",
};

export interface Resolved {
  mediaUrl: string;
  filename: string;
  contentType?: string;
}

const DIRECT = /\.(mp4|m4v|mov|webm|mkv|m4a|mp3|wav|ogg)(\?|#|$)/i;

export async function resolveMedia(pageUrl: string): Promise<Resolved> {
  let u: URL;
  try { u = new URL(pageUrl); } catch { throw new Error("that doesn't look like a valid URL"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("only http(s) links are supported");

  if (DIRECT.test(u.pathname)) {
    return { mediaUrl: pageUrl, filename: decodeURIComponent(u.pathname.split("/").pop() || "video") };
  }
  if (/(^|\.)rumble\.com$/i.test(u.hostname)) return resolveRumble(pageUrl);

  throw new Error(
    "unsupported link — paste a Rumble link or a direct .mp4 URL. (YouTube and most other sites need the yt-dlp engine.)",
  );
}

async function resolveRumble(pageUrl: string): Promise<Resolved> {
  const html = await fetch(pageUrl, { headers: UA }).then((r) => r.text());

  // If Rumble served the server a bot-check/challenge instead of the page.
  if (html.length < 1500 || /just a moment|cf-browser-verification|challenge-platform|captcha|enable javascript/i.test(html)) {
    throw new Error("Rumble blocked the server from reading that page (bot check). This link needs the yt-dlp engine.");
  }

  // Find the embed id: prefer a full embedJS URL, then many known patterns.
  let id = html.match(/rumble\.com\/embedJS\/[^"'\s\\]*\bv=([\w.-]+)/i)?.[1];
  if (!id) {
    for (const p of [
      /rumble\.com\/embed\/([\w.-]+?)[\/"']/i,
      /"embedUrl"\s*:\s*"[^"]*\/embed\/([\w.-]+?)[\/"]/i,
      /\bRumble\(\s*["']play["']\s*,\s*\{[^}]*?["']video["']\s*:\s*["']([\w.-]+?)["']/i,
      /["']embedId["']\s*:\s*["']([\w.-]+?)["']/i,
      /\bdata-(?:video-)?id\s*=\s*["']([\w.-]+?)["']/i,
      /["']video["']\s*:\s*["']([a-z0-9]{4,12})["']/i,
    ]) { const m = html.match(p); if (m) { id = m[1]; break; } }
  }
  if (!id) throw new Error("couldn't find the Rumble video id on that page (Rumble may have changed their page layout)");

  const meta: any = await fetch(`https://rumble.com/embedJS/u3/?request=video&ver=2&v=${encodeURIComponent(id)}`, { headers: UA })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  if (!meta) throw new Error(`Rumble embed API didn't return data for id "${id}"`);

  // meta.ua.mp4 is a map of quality -> url | { url, meta }
  const mp4 = meta?.ua?.mp4 ?? meta?.ua?.webm;
  if (!mp4 || typeof mp4 !== "object") throw new Error("Rumble returned no downloadable formats");
  const quality = Object.keys(mp4).filter((k) => /^\d+$/.test(k)).sort((a, b) => Number(b) - Number(a))[0]
    || Object.keys(mp4)[0];
  const entry = mp4[quality];
  const url = typeof entry === "string" ? entry : entry?.url;
  if (!url) throw new Error("couldn't extract a Rumble media URL");

  const title = String(meta?.title || "rumble-video").replace(/[^\w \-]+/g, "").trim().slice(0, 80) || "rumble-video";
  return { mediaUrl: url, filename: `${title}.mp4`, contentType: "video/mp4" };
}
