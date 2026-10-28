#!/usr/bin/env bash
#
# The one gate before a push.
#
# This exists because of a specific failure: each check was run by hand, the
# fidelity check printed "1 finding(s)", and the push happened anyway. Every
# check here already exits non-zero on its own — what was missing was one
# command whose exit code is the answer, so there is nothing to read past.
#
# `set -e` is deliberate: the first failure stops the run and its output is the
# last thing on screen, rather than being scrolled off by the checks after it.
set -euo pipefail

# ── What went unchecked ──────────────────────────────────────────────────
#
# Two stages below skip cleanly when there is no dev server, and the editor
# also skips when the account has no transcribed project to drive. Both skips
# are right — "a check that goes red for an absent dependency teaches people
# to ignore red" — and both used to exit 0, which meant THIS SCRIPT could
# print ALL CHECKS PASSED having rendered no HTML and driven no editor. The
# one command whose exit code is supposed to be the answer was answering a
# question nobody had asked.
#
# So a skipping stage now exits 78, this collects them, and the last line
# names them. `--strict` turns a skip into a failure; CI runs --strict, so
# nothing merges having checked less than it claims.
STRICT=0
[ "${1:-}" = "--strict" ] && STRICT=1
SKIPPED=""

stage() {
  local name="$1"; shift
  set +e
  "$@"
  local code=$?
  set -e
  if [ "$code" = 78 ]; then
    SKIPPED="$SKIPPED $name"
  elif [ "$code" != 0 ]; then
    exit "$code"
  fi
}

echo "── typecheck"
npm run --silent typecheck

echo "── tests"
# node --test exits 0 on a suite that could not even be loaded, so the exit
# code alone is not proof. The TAP summary is: require "# fail 0" verbatim.
out=$(npm test 2>&1) || { echo "$out"; exit 1; }
echo "$out" | grep -qE '^# fail 0$' || { echo "$out" | tail -40; echo; echo "TESTS FAILED"; exit 1; }
echo "$out" | grep -E '^# (tests|pass|fail) '

# The container is a separate process with its own module graph, and nothing
# above can see it: `node --check` parses it but never runs it, so a function
# the server calls at runtime can be deleted and every stage above stays green.
# That happened — twice in one day — and the second time it shipped.
echo "── container"
node scripts/check-container.cjs

# client.ts is 4,000 lines inside a String.raw template: not typechecked, not
# imported by any test, and `node --check` cannot parse a string. Three defects
# shipped out of it in one day and every one was found by driving a browser.
# This drives it. Skips cleanly when there is no dev server, like the string
# check below.
echo "── editor"
stage editor node scripts/check-editor.cjs

echo "── fidelity"
stage fidelity node scripts/check-fidelity.cjs

echo
if [ -n "$SKIPPED" ]; then
  echo "ALL CHECKS PASSED (SKIPPED:$SKIPPED)"
  if [ "$STRICT" = 1 ]; then
    echo
    echo "--strict: a skipped check is a check that did not run."
    exit 78
  fi
  echo "  Start \`npx wrangler dev --port 8787 --enable-containers=false\`, run"
  echo "  \`node scripts/seed-fixture.cjs\`, and re-run to check these too."
else
  echo "ALL CHECKS PASSED"
fi
echo
# The render is the one thing this cannot prove on its own: it needs ffmpeg,
# the encoder and a fixture host. `npm run check:render` says what is missing
# and skips cleanly, so it is a pointer here rather than a gate.
echo "  the export itself:  npm run check:render   (see scripts/check-render.cjs)"
# Two real renders and two ffmpeg fixture builds — minutes, not seconds, so it
# is a pointer like the one above rather than a stage. It is the only check in
# this repo that looks at a PIXEL: everything else reasons about the EDL, the
# plan or the DOM, which is how a 9:16 short shipped with the picture filling a
# third of the frame and the rest black.
echo "  what it looks like: npm run check:frame    (see scripts/check-frame.cjs)"
# Forced alignment: a 1.26 GB model and a torch install, which is why this is
# acceptance rather than a gate — a gate that cannot run is a gate people
# learn to skip. It is the only check that asks whether the words are
# actually WHERE the product says they are, and the band is one frame.
echo "  where the words are: npm run check:align  (see scripts/check-align.cjs)"
# The interchange file, read back by the library every NLE's importer is
# built on. Needs Python and a wheel, so it is a pointer rather than a stage.
# It is the only thing that can tell real OTIO from JSON that looks like it.
echo "  does it open:        npm run check:otio   (see scripts/check-otio.cjs)"
