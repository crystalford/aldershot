#!/usr/bin/env bash
# Aldershot one-time setup + deploy.
# Prereq: run `npx wrangler login` first (or set CLOUDFLARE_API_TOKEN).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Installing dependencies"
npm install

echo "==> Creating R2 bucket (ok if it already exists)"
npx wrangler r2 bucket create aldershot-media || true

echo "==> Ensuring the D1 database exists"
if ! npx wrangler d1 info aldershot >/dev/null 2>&1; then
  npx wrangler d1 create aldershot
fi

echo "==> Reading the D1 database id"
DB_ID="$(npx wrangler d1 info aldershot --json 2>/dev/null \
  | node -pe 'try { JSON.parse(require("fs").readFileSync(0)).uuid || "" } catch { "" }')"

if [ -z "$DB_ID" ]; then
  echo "!! Could not read the D1 id automatically."
  echo "   Run: npx wrangler d1 info aldershot"
  echo "   then replace \"TODO\" in wrangler.jsonc with the id and re-run this script."
  exit 1
fi

echo "==> Wiring database_id ($DB_ID) into wrangler.jsonc"
node -e '
  const fs = require("fs");
  const f = "wrangler.jsonc";
  const id = process.argv[1];
  let s = fs.readFileSync(f, "utf8");
  s = s.replace(/("database_id":\s*")TODO(")/, `$1${id}$2`);
  fs.writeFileSync(f, s);
' "$DB_ID"

echo "==> Applying migrations to remote D1"
npx wrangler d1 migrations apply aldershot --remote

echo "==> Deploying"
npx wrangler deploy

echo ""
echo "==> Done. Your project console is live at the workers.dev URL printed above."
