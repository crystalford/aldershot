/**
 * Presigned R2 URLs (S3 API) so the browser can upload huge files straight to
 * storage — bypassing the Worker's request-body size cap — and so AssemblyAI can
 * read a file directly. Needs the R2 API token secrets; returns null if absent.
 */
import { AwsClient } from "aws4fetch";
import type { Env } from "./env.ts";

const BUCKET = "aldershot-media";

function clientFor(env: Env): AwsClient | null {
  if (!env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_ACCOUNT_ID) return null;
  return new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: "s3",
    region: "auto",
  });
}

function objectUrl(env: Env, key: string): string {
  const path = key.split("/").map(encodeURIComponent).join("/");
  return `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${BUCKET}/${path}`;
}

async function presign(env: Env, key: string, method: "PUT" | "GET", expires: number): Promise<string | null> {
  const client = clientFor(env);
  if (!client) return null;
  const url = new URL(objectUrl(env, key));
  url.searchParams.set("X-Amz-Expires", String(expires));
  const signed = await client.sign(url.toString(), { method, aws: { signQuery: true } });
  return signed.url;
}

export const presignGet = (env: Env, key: string, expires = 7200) => presign(env, key, "GET", expires);

/* ── Multipart, over the S3 API ────────────────────────────────────────
 *
 * So the browser can PUT parts straight to R2 instead of streaming every byte
 * through the Worker. A 2GB upload is 2GB of Worker request body for no reason:
 * the Worker's only real job is to say who may write where, which is exactly
 * what a presigned URL is.
 *
 * The whole multipart has to live on the S3 API rather than the R2 binding,
 * because a presigned part URL must carry an uploadId the S3 endpoint issued.
 * Mixing the two would look right and fail at completion.
 */

/** R2 returns XML. One tag, no parser — the responses here are tiny. */
function tag(xml: string, name: string): string | null {
  const m = new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml);
  return m ? m[1] : null;
}

export function canPresign(env: Env): boolean {
  return Boolean(env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_ACCOUNT_ID);
}

export async function createMultipart(
  env: Env,
  key: string,
  contentType?: string,
): Promise<string | null> {
  const client = clientFor(env);
  if (!client) return null;

  const res = await client.fetch(`${objectUrl(env, key)}?uploads`, {
    method: "POST",
    headers: contentType ? { "content-type": contentType } : {},
  });
  if (!res.ok) {
    console.log(`[r2] createMultipart failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
    return null;
  }
  return tag(await res.text(), "UploadId");
}

/**
 * A URL the browser may PUT one part to.
 *
 * Short-lived on purpose: it is a bearer capability to write to this exact
 * object, and a long upload asks for fresh batches as it goes rather than
 * holding hundreds of long-lived write URLs.
 */
export async function presignPart(
  env: Env,
  key: string,
  uploadId: string,
  partNumber: number,
  expires = 3600,
): Promise<string | null> {
  const client = clientFor(env);
  if (!client) return null;
  const url = new URL(objectUrl(env, key));
  url.searchParams.set("partNumber", String(partNumber));
  url.searchParams.set("uploadId", uploadId);
  url.searchParams.set("X-Amz-Expires", String(expires));
  const signed = await client.sign(url.toString(), { method: "PUT", aws: { signQuery: true } });
  return signed.url;
}

export async function completeMultipart(
  env: Env,
  key: string,
  uploadId: string,
  parts: { partNumber: number; etag: string }[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const client = clientFor(env);
  if (!client) return { ok: false, error: "storage credentials are not configured" };

  /* ETags must be quoted exactly as R2 returned them, and the parts must be in
     order — S3 rejects the whole completion otherwise. */
  const body =
    "<CompleteMultipartUpload>" +
    parts
      .slice()
      .sort((a, b) => a.partNumber - b.partNumber)
      .map((p) => {
        const etag = p.etag.startsWith('"') ? p.etag : `"${p.etag}"`;
        return `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${etag}</ETag></Part>`;
      })
      .join("") +
    "</CompleteMultipartUpload>";

  const res = await client.fetch(`${objectUrl(env, key)}?uploadId=${encodeURIComponent(uploadId)}`, {
    method: "POST",
    body,
    headers: { "content-type": "application/xml" },
  });
  const text = await res.text();

  /* S3 can answer 200 and still carry an error in the body — a completion that
     failed but reported success would leave a truncated object behind. */
  if (!res.ok || text.includes("<Error>")) {
    return { ok: false, error: tag(text, "Message") || `completion failed (${res.status})` };
  }
  return { ok: true };
}

export async function abortMultipart(env: Env, key: string, uploadId: string): Promise<void> {
  const client = clientFor(env);
  if (!client) return;
  await client
    .fetch(`${objectUrl(env, key)}?uploadId=${encodeURIComponent(uploadId)}`, { method: "DELETE" })
    .catch(() => {});
}
