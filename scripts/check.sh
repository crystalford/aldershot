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

echo "── fidelity"
node scripts/check-fidelity.cjs

echo
echo "ALL CHECKS PASSED"
