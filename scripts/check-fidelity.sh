#!/usr/bin/env bash
# Spot-checks a curated set of exact prototype copy/markers against the real
# app, so a later refactor can't silently delete a fidelity fix without
# anyone noticing. This is a narrow safety net, not a substitute for
# docs/design/fidelity-checklist.md or for actually screenshotting a view
# with real data — a string existing in app.js doesn't prove the feature
# still works, only that nobody deleted the line.
#
# Usage: scripts/check-fidelity.sh   (run from the repo root)
#
# ── Rendering the prototype itself, for a real screenshot diff ─────────────
# The prototype (docs' design-handoff .dc.html) is a real interactive React
# app, not a static mockup — but it loads React/ReactDOM/Babel from unpkg.com
# at runtime, which a sandboxed browser can't always reach directly. To
# render it in Playwright:
#   1. curl the three CDN URLs referenced in support.js to local files:
#      https://unpkg.com/react@18.3.1/umd/react.production.min.js
#      https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js
#      https://unpkg.com/@babel/standalone@7.29.0/babel.min.js
#   2. In Playwright, page.route('https://unpkg.com/**', ...) and fulfill
#      each from the local file instead of continuing the network request.
#   3. page.goto('file:///path/to/Aldershot v2.dc.html') and screenshot.
# This is the only way to catch chrome-level drift (rail labels, icon order,
# an invented header element) that per-feature grep/behavior checks miss
# entirely — see "Global chrome" in fidelity-checklist.md for what this
# caught on 2026-08-12 that months of grep-based checks did not.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_JS="$ROOT/public/app.js"
STYLE_CSS="$ROOT/public/style.css"
HTML="$ROOT/public/index.html"
SRC="$ROOT/src"

fail=0
pass=0

check() {
  local file="$1" pattern="$2" label="$3"
  if grep -qF -- "$pattern" "$file" 2>/dev/null; then
    pass=$((pass + 1))
  else
    echo "MISSING: $label"
    echo "  expected in $file: $pattern"
    fail=$((fail + 1))
  fi
}

echo "── Fidelity spot-check ──────────────────────────────────────"

# Global chrome
check "$APP_JS" "rail-btn-label" "Rail nav items have visible text labels"
check "$APP_JS" '{ view: "clipping", label: "Clipping", icon: "scissors" },
  { view: "studio"' "Rail nav order matches prototype (Clipping before Studio)"
check "$HTML" 'mark-tile">A<' "Rail logo is the bordered 'A' mark, not a filled icon tile"
check "$HTML" 'rail-icon-btn" id="paletteTrigger"' "Search is a small rail icon, not a header bar"
check "$STYLE_CSS" ".bar:has(.crumbs:empty)" "Header bar collapses when empty (no invented persistent search bar)"

# Desk / Archive / Threads / Discover / Sources
check "$APP_JS" "beatResolutionStatus" "Desk progress bar reflects resolution, not kind"
check "$SRC/threads.ts" "clipThreadMap" "Archive thread clustering (src)"
check "$APP_JS" "runAskArchive" "Ask the archive Q&A"
check "$SRC/threads.ts" "describeThread" "Threads kind/synopsis classification"
check "$APP_JS" "threadInitials" "Threads colored avatar"
check "$APP_JS" "thread-name-input" "Threads inline rename"
check "$SRC/pipeline/reason.ts" "matchDiscoverToThreads" "Discover thread-tagging (src)"
check "$APP_JS" "discover-row-thumb" "Discover thumbnail + platform framing, horizontal row layout"
check "$APP_JS" "discover-search-bar" "Discover inline search icon"
check "$APP_JS" "quickAddSourceUrl" "Sources quick-add URL"
check "$APP_JS" "SOURCE_STATUS_LABEL" "Sources status pills/filters"
check "$SRC/pipeline/reason.ts" "summarizeTranscript" "Sources AI-summary callout (src)"

# Essays
check "$APP_JS" "computeEssayStage" "Essays List stage grouping"
check "$APP_JS" "ESSAY_ANGLE_CHOICES" "Essays wizard Angle step"
check "$APP_JS" "essay-rail" "Builder right rail"
check "$APP_JS" "railNoteSend" "Notes tab chat-drafting"
check "$APP_JS" "needsHint" "Per-act guidance text"
check "$APP_JS" "readiness-bar-wrap" "Premise production-readiness bar"
check "$APP_JS" "tensionArcSVG" "Script tension-arc SVG"
check "$APP_JS" "assembleOverlay" "Assemble preview overlay"
check "$APP_JS" "assemble-music-lane" "Assemble Music lane"
check "$APP_JS" "exportTitle" "Export publish metadata"

# Studio / Generative / Clipping
check "$APP_JS" "ai-suggested" "Studio persistent suggestion tint"
check "$APP_JS" "sendStudioShortToArchive" "Studio Clip-candidates Send to Archive"
check "$APP_JS" "tools-subcopy" "Studio section subcopy"
check "$SRC/generative.ts" "shotTypeDuration" "Generative per-shot duration (src)"
check "$APP_JS" "genResolutionRow" "Generative Resolution setting"
check "$APP_JS" "withThreads=1" "Generative saved-feed resolved-thread coloring"
check "$APP_JS" "reel-mark-score" "Clipping score badge"
check "$APP_JS" "Sent to Archive" "Clipping past-tense Send-to-Archive label"
check "$APP_JS" "clipRenderShortGrid" "Clipping persistent card grid"
check "$APP_JS" "short-card-format" "Clipping format badge"

# Settings / Help / Trash / Palette
check "$APP_JS" "showSettingsView" "Settings real tabs"
check "$SRC/index.ts" "/api/settings/usage" "Settings real usage numbers (src)"
check "$APP_JS" "openHelpModal" "Help modal"
check "$APP_JS" "openOnboardingTour" "Onboarding tour"
check "$APP_JS" "Deleted essays and sources" "Trash subtitle copy"
check "$APP_JS" 'hint: "Essay"' "Command palette Essay jump"

echo "────────────────────────────────────────────────────────────"
echo "$pass passed, $fail missing"
[ "$fail" -eq 0 ]
