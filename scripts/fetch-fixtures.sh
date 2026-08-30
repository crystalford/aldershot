#!/usr/bin/env bash
# Caches the third-party assets the fidelity harness needs, so screenshots
# render with the real typeface and the prototype boots without network.
#
# Without this, BOTH the build and the prototype fall back to a system font and
# every type comparison is meaningless — which is worse than not comparing.
set -euo pipefail

DIR="${FIXTURE_DIR:-/tmp/claude-0/-home-user-aldershot/0bebe197-45d2-5def-a9b7-d7e7d2e7e6b2/scratchpad}"
mkdir -p "$DIR/fonts" "$DIR/cdn-cache"

echo "→ prototype runtime (React/ReactDOM/Babel, loaded from unpkg at runtime)"
curl -sS -o "$DIR/cdn-cache/react.js"     "https://unpkg.com/react@18.3.1/umd/react.production.min.js"
curl -sS -o "$DIR/cdn-cache/react-dom.js" "https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js"
curl -sS -o "$DIR/cdn-cache/babel.js"     "https://unpkg.com/@babel/standalone@7.29.0/babel.min.js"

echo "→ Instrument Sans + IBM Plex Mono"
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
CSS="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
curl -sS -A "$UA" "$CSS" -o "$DIR/fonts/fonts.css"

: > "$DIR/fonts/map.txt"
grep -o "https://fonts.gstatic.com/[^)]*" "$DIR/fonts/fonts.css" | sort -u | while read -r url; do
  name="$(printf '%s' "$url" | md5sum | cut -c1-12).woff2"
  curl -sS "$url" -o "$DIR/fonts/$name"
  echo "$url $name" >> "$DIR/fonts/map.txt"
done

echo "✔ cached $(wc -l < "$DIR/fonts/map.txt") font files to $DIR"
