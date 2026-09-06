// Configure R2 bucket CORS (so the browser can PUT directly to storage) via the
// Cloudflare API, using the deploy token — which has R2 edit permission, unlike
// an object-scoped R2 token. No-op if unset.
const acct = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!acct || !token) {
  console.log("  (skip CORS — no Cloudflare token)");
  process.exit(0);
}

const body = {
  rules: [
    {
      allowed: { origins: ["*"], methods: ["GET", "PUT", "HEAD"], headers: ["*"] },
      exposeHeaders: ["ETag"],
      maxAgeSeconds: 3600,
    },
  ],
};

const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}/r2/buckets/aldershot-media/cors`, {
  method: "PUT",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify(body),
});
console.log("  R2 CORS:", res.status);
if (!res.ok) console.log((await res.text()).slice(0, 500));
