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

echo "── fidelity"
node scripts/check-fidelity.cjs

echo
echo "ALL CHECKS PASSED"
echo
# The render is the one thing this cannot prove on its own: it needs ffmpeg,
# the encoder and a fixture host. `npm run check:render` says what is missing
# and skips cleanly, so it is a pointer here rather than a gate.
echo "  the export itself:  npm run check:render   (see scripts/check-render.cjs)"
