/**
 * FOOTAGE THAT LIVES SOMEWHERE ELSE.
 *
 * "Point sources at a bucket you own" is on the landing page and in Settings,
 * and nothing implemented it. This is the connector: list an S3-compatible
 * bucket, work out which objects are footage, and hand back enough to make a
 * source row out of each.
 *
 * S3-COMPATIBLE RATHER THAN AN R2 BINDING, and the difference matters. A
 * binding is deploy-time configuration — one bucket, named in wrangler.jsonc,
 * the same for every account. That works for exactly one person. A key works
 * for everybody, and R2 speaks the S3 API, so the same code path reads the
 * owner's own R2 and a stranger's Backblaze without knowing the difference.
 *
 * READ-ONLY, AND IT NEVER WRITES. The only two verbs here are LIST and GET.
 * Somebody handing over a key to their own archive is trusting that, and it
 * should be checkable by reading this file rather than by taking our word.
 *
 * NOTHING IS COPIED. An imported source keeps pointing at the object where it
 * lives; Aldershot stores the read (transcript, moments, the index) and small
 * previews. That is `17-STORAGE-AND-NEOLOG.md`'s rule and it is also what
 * makes importing a large archive instant.
 */
import { AwsClient } from "aws4fetch";

/** Where somebody's footage lives, and the key that may read it. */
export interface BucketConn {
  /** `https://<account>.r2.cloudflarestorage.com`, or any S3 endpoint. */
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** R2 wants "auto"; real S3 wants a region. */
  region?: string;
}

export interface BucketObject {
  key: string;
  size: number;
  /** When the OBJECT was written — not when the video was shot. */
  uploadedAt: number | null;
}

/*
 * WHAT COUNTS AS FOOTAGE.
 *
 * A bucket is somebody's whole archive and will have thumbnails, JSON,
 * transcripts and junk in it. Importing all of it would make a library of
 * files nobody can cut.
 *
 * Extensions rather than content sniffing: listing gives us names and sizes
 * and nothing else, and fetching the head of every object in a thousand-object
 * bucket to find out what it is would make connecting slow and expensive for
 * a guess we can make from the name.
 */
const VIDEO = /\.(mp4|mov|m4v|mkv|webm|avi|mpg|mpeg|m2ts|mts)$/i;
const AUDIO = /\.(mp3|wav|m4a|aac|flac|ogg|opus)$/i;

export const isFootage = (key: string): boolean => VIDEO.test(key) || AUDIO.test(key);

/**
 * The XML ListObjectsV2 answers with, as objects.
 *
 * Hand-parsed because Workers has no XML parser and the shape here is three
 * fields deep. Non-greedy per `<Contents>` so a key containing the word
 * "Contents" cannot swallow the next entry — which a transcript file very
 * plausibly could.
 */
export function parseListing(xml: string): { objects: BucketObject[]; next: string | null } {
  const objects: BucketObject[] = [];
  for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const body = m[1];
    const key = /<Key>([\s\S]*?)<\/Key>/.exec(body)?.[1];
    if (!key) continue;
    const size = Number(/<Size>(\d+)<\/Size>/.exec(body)?.[1] ?? 0);
    const when = /<LastModified>([\s\S]*?)<\/LastModified>/.exec(body)?.[1];
    const at = when ? Date.parse(when) : NaN;
    objects.push({ key: unescapeXml(key), size, uploadedAt: Number.isFinite(at) ? at : null });
  }
  /* Only follow the cursor when the listing says it is truncated. A
     continuation token on a final page is a loop. */
  const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml);
  const token = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1] ?? null;
  return { objects, next: truncated && token ? unescapeXml(token) : null };
}

const unescapeXml = (s: string): string =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    /* Last, or an escaped entity in a key is decoded twice. */
    .replace(/&amp;/g, "&");

const clientFor = (conn: BucketConn) =>
  new AwsClient({
    accessKeyId: conn.accessKeyId,
    secretAccessKey: conn.secretAccessKey,
    service: "s3",
    region: conn.region || "auto",
  });

/**
 * Every object in the bucket, following the cursor.
 *
 * `cap` is a ceiling on PAGES, not objects, and it is here because an archive
 * with fifty thousand objects in it should not turn one press of Connect into
 * fifty round trips inside a Worker's time budget. The caller is told when it
 * stopped early rather than being handed a short list that looks complete.
 */
export async function listBucket(
  conn: BucketConn,
  opts: { prefix?: string; cap?: number; fetcher?: typeof fetch } = {},
): Promise<{ objects: BucketObject[]; truncated: boolean }> {
  const client = clientFor(conn);
  const call = opts.fetcher ?? fetch;
  const cap = opts.cap ?? 10;

  const all: BucketObject[] = [];
  let token: string | null = null;
  for (let page = 0; page < cap; page += 1) {
    const url = new URL(`${conn.endpoint.replace(/\/+$/, "")}/${conn.bucket}`);
    url.searchParams.set("list-type", "2");
    url.searchParams.set("max-keys", "1000");
    if (opts.prefix) url.searchParams.set("prefix", opts.prefix);
    if (token) url.searchParams.set("continuation-token", token);

    const signed = await client.sign(url.toString(), { method: "GET" });
    const res = await call(signed.url, { method: "GET", headers: signed.headers });
    if (!res.ok) throw new Error(`the bucket answered ${res.status}`);

    const { objects, next } = parseListing(await res.text());
    all.push(...objects);
    token = next;
    if (!token) return { objects: all, truncated: false };
  }
  return { objects: all, truncated: true };
}

/**
 * A URL the reader can fetch this object with, for a while.
 *
 * The transcribe path needs to hand a video to something that is not this
 * Worker, and it may not hold somebody's key while doing it. A presigned GET
 * is the whole permission: one object, one verb, and an expiry.
 */
export async function presignFromBucket(
  conn: BucketConn,
  key: string,
  expires = 7200,
): Promise<string> {
  const url = new URL(
    `${conn.endpoint.replace(/\/+$/, "")}/${conn.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`,
  );
  url.searchParams.set("X-Amz-Expires", String(expires));
  const signed = await clientFor(conn).sign(url.toString(), {
    method: "GET",
    aws: { signQuery: true },
  });
  return signed.url;
}
