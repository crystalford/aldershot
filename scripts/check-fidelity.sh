#!/usr/bin/env bash
# Spot-checks a curated set of exact prototype copy/markers against the real
# app, so a later refactor can't silently delete a fidelity fix without
# anyone noticing. This is a narrow safety net, not a substitute for
# docs/design/fidelity-checklist.md or for actually screenshotting a view
# with real data — a string existing in app.js doesn't prove the feature
# still works, only that nobody deleted the line.
#
# Usage: scripts/check-fidelity.sh   (run from the repo root)
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_JS="$ROOT/public/app.js"
STYLE_CSS="$ROOT/public/style.css"
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

# Desk / Archive / Threads / Discover / Sources
check "$APP_JS" "beatResolutionStatus" "Desk progress bar reflects resolution, not kind"
check "$SRC/threads.ts" "clipThreadMap" "Archive thread clustering (src)"
check "$APP_JS" "runAskArchive" "Ask the archive Q&A"
check "$SRC/threads.ts" "describeThread" "Threads kind/synopsis classification"
check "$APP_JS" "threadInitials" "Threads colored avatar"
check "$SRC/pipeline/reason.ts" "matchDiscoverToThreads" "Discover thread-tagging (src)"
check "$APP_JS" "discover-platform-row" "Discover thumbnail + platform framing"
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
