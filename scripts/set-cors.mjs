// Configure R2 bucket CORS so the browser can PUT directly to storage.
// Runs in the deploy Action with the R2 API credentials. No-op if unset.
import { AwsClient } from "aws4fetch";

const acct = process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
const id = process.env.R2_ACCESS_KEY_ID;
const secret = process.env.R2_SECRET_ACCESS_KEY;
if (!acct || !id || !secret) {
  console.log("  (skip CORS — R2 credentials not set)");
  process.exit(0);
}

const client = new AwsClient({ accessKeyId: id, secretAccessKey: secret, service: "s3", region: "auto" });
const cors =
  "<CORSConfiguration><CORSRule>" +
  "<AllowedOrigin>*</AllowedOrigin>" +
  "<AllowedMethod>PUT</AllowedMethod><AllowedMethod>GET</AllowedMethod><AllowedMethod>HEAD</AllowedMethod>" +
  "<AllowedHeader>*</AllowedHeader><ExposeHeader>ETag</ExposeHeader><MaxAgeSeconds>3600</MaxAgeSeconds>" +
  "</CORSRule></CORSConfiguration>";

const url = `https://${acct}.r2.cloudflarestorage.com/aldershot-media?cors`;
const res = await client.fetch(url, { method: "PUT", body: cors, headers: { "content-type": "application/xml" } });
console.log("  R2 CORS:", res.status);
if (!res.ok) console.log(await res.text());
