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

export const presignPut = (env: Env, key: string, expires = 3600) => presign(env, key, "PUT", expires);
export const presignGet = (env: Env, key: string, expires = 7200) => presign(env, key, "GET", expires);
