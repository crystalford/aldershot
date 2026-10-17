/**
 * A SMALL XML READER, because there is no parser in this runtime.
 *
 * Workers have no DOMParser and no XMLHttpRequest. Scout's two keyless
 * adapters both speak RSS — a YouTube channel feed and a podcast feed — so
 * something has to read it, and the choice is a dependency or forty lines.
 *
 * REGEX ON XML IS A KNOWN TRAP and this is deliberately not a general parser.
 * It reads a KNOWN SHAPE: a flat list of entries, each with text children and
 * attributes. It does not do namespaces properly, nested elements of the same
 * name, or document validity, and it would be wrong to use it on a document
 * whose shape is not already known. What it does do is the four things that
 * actually break a naive version, each of which is in a real feed:
 *
 *   CDATA containing the closing tag. A podcast description is wrapped in
 *   CDATA precisely so it can contain "</description>", and a reader that
 *   matched the first closing tag would truncate at it.
 *
 *   Attributes containing a closing angle bracket. A URL with an entity in it
 *   is common and a tag matcher that stops at the first ">" cuts the tag.
 *
 *   Entities. "&amp;" in a URL is the normal way to write "&" in XML, and a
 *   link that keeps the entity is a link that 404s.
 *
 *   Self-closing tags. "<podcast:transcript url="…"/>" carries everything in
 *   its attributes and has no text at all.
 */

/** The five XML entities, plus numeric ones. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    /* Ampersand LAST, or "&amp;lt;" decodes twice and becomes "<". */
    .replace(/&amp;/g, "&");
}

/** CDATA out, entities decoded, whitespace collapsed at the edges. */
export function unwrap(inner: string): string {
  const parts: string[] = [];
  let at = 0;
  while (at < inner.length) {
    const open = inner.indexOf("<![CDATA[", at);
    if (open < 0) {
      parts.push(decodeEntities(inner.slice(at)));
      break;
    }
    parts.push(decodeEntities(inner.slice(at, open)));
    const close = inner.indexOf("]]>", open + 9);
    if (close < 0) {
      /* An unterminated CDATA section: everything after it is literal text. */
      parts.push(inner.slice(open + 9));
      break;
    }
    /* Not decoded — CDATA means "these characters, as they are". */
    parts.push(inner.slice(open + 9, close));
    at = close + 3;
  }
  return parts.join("").trim();
}

export interface XmlTag {
  /** Everything between the angle brackets of the opening tag. */
  raw: string;
  /**
   * Everything between the tags, EXACTLY AS IT ARRIVED — CDATA markers and
   * entities intact.
   *
   * Raw on purpose, and the reason is a bug this had. `inner` used to be
   * unwrapped, and then reading a feed meant `tags(xml, "item")` followed by
   * `text(item.inner, "description")` — by which point the CDATA markers were
   * gone and the `</description>` that CDATA exists to protect had become a
   * plain closing tag. The description truncated there, which looks like a
   * short description rather than like an error.
   *
   * So nesting reads `inner` and anything wanting the words reads `text`.
   */
  inner: string;
  /** The text between the tags, CDATA unwrapped and entities decoded. */
  text: string;
}

/**
 * Where the opening tag ends, skipping over quoted attribute values.
 *
 * A ">" inside a quoted attribute is not the end of the tag. Returns -1 when
 * the tag never closes, which is a truncated download rather than a document.
 */
function endOfTag(xml: string, from: number): number {
  let quote = "";
  for (let i = from; i < xml.length; i++) {
    const c = xml[i];
    if (quote) {
      if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === ">") return i;
  }
  return -1;
}

/**
 * Every `<name>` element at any depth, in document order.
 *
 * CDATA is skipped when looking for the closing tag, which is the whole
 * reason this is not two `indexOf` calls.
 */
export function tags(xml: string, name: string): XmlTag[] {
  const out: XmlTag[] = [];
  const open = new RegExp("<" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?=[\\s/>])", "g");
  let m: RegExpExecArray | null;
  while ((m = open.exec(xml))) {
    const tagEnd = endOfTag(xml, m.index);
    if (tagEnd < 0) break;
    const raw = xml.slice(m.index + 1, tagEnd);
    if (raw.endsWith("/")) {
      out.push({ raw: raw.slice(0, -1), inner: "", text: "" });
      open.lastIndex = tagEnd + 1;
      continue;
    }

    /* Walk forward for the closing tag, stepping over CDATA. */
    const closing = "</" + name;
    let at = tagEnd + 1;
    let close = -1;
    while (at < xml.length) {
      const cdata = xml.indexOf("<![CDATA[", at);
      const found = xml.indexOf(closing, at);
      if (found < 0) break;
      if (cdata >= 0 && cdata < found) {
        const end = xml.indexOf("]]>", cdata + 9);
        if (end < 0) break;
        at = end + 3;
        continue;
      }
      close = found;
      break;
    }
    if (close < 0) {
      out.push({ raw, inner: "", text: "" });
      open.lastIndex = tagEnd + 1;
      continue;
    }
    const inner = xml.slice(tagEnd + 1, close);
    out.push({ raw, inner, text: unwrap(inner) });
    open.lastIndex = close + closing.length;
  }
  return out;
}

/** An attribute off an opening tag, decoded. Null when it is not there. */
export function attr(raw: string, name: string): string | null {
  const re = new RegExp("\\b" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*=\\s*(\"([^\"]*)\"|'([^']*)')", "i");
  const m = raw.match(re);
  if (!m) return null;
  return decodeEntities(m[2] ?? m[3] ?? "");
}

/** The first `<name>`'s text, unwrapped and decoded, or "". */
export function text(xml: string, name: string): string {
  return tags(xml, name)[0]?.text ?? "";
}
