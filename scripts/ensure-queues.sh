#!/usr/bin/env bash
#
# THE QUEUES THE WORKER BINDS, PROVISIONED IDEMPOTENTLY.
#
# A deploy fails outright on a queue named in wrangler.jsonc that does not
# exist — 'Queue "aldershot-jobs-dlq" does not exist' — so adding a consumer
# to that file is a deploy-breaking change unless the queue is created first.
#
# WHY THIS IS A SCRIPT AND NOT TEN LINES OF YAML. It used to be inline in
# deploy.yml, it was wrong, and nothing could run it. Deploy runs 237 and 238
# both died here in about thirty seconds:
#
#     ==> Queues (look up by name; create if missing)
#       creating aldershot-jobs
#       Queue name 'aldershot-jobs' is already taken. [code: 11009]
#
# The check listed every queue and parsed the JSON, and when the parse failed
# it fell back to an empty list — so every queue looked absent, the create was
# attempted, Cloudflare refused a name it already had, and `set -euo pipefail`
# ended the deploy. Two merges did not reach production because of it.
#
# ASK ABOUT THE QUEUE, DO NOT PARSE A LIST. `wrangler queues info <name>`
# exists in the version the deploy runs, and exit-code-on-one-resource is the
# shape of the R2 bucket check in deploy.yml, which is the only provisioning
# check in that file that has never failed. Why the list parse failed is still
# unknown; this removes the need to know.
#
# AND THE CREATE TOLERATES ONE FAILURE, NAMED. A taken name means the queue is
# there and `info` was wrong about it, which is survivable. Anything else — a
# quota, a permission, a typo'd name — fails the deploy, because silence over a
# provision that did not happen is invariant 7's shape of defect: the job
# reports success and the thing is broken.
#
# Testable with a stub `npx` on PATH; see test/ensure-queues.test.ts.
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: ensure-queues.sh <queue-name> [<queue-name> ...]" >&2
  exit 2
fi

for q in "$@"; do
  if npx wrangler queues info "$q" >/dev/null 2>&1; then
    echo "  $q is there"
    continue
  fi

  echo "  creating $q"
  if out="$(npx wrangler queues create "$q" 2>&1)"; then
    echo "  created $q"
  elif printf '%s' "$out" | grep -qiE 'already taken|11009'; then
    # `info` said no and the API says yes. The queue exists, which is all this
    # script is for, so carry on — but say so, because an `info` that is wrong
    # is worth seeing in a log rather than smoothing over.
    echo "  $q was already there ('info' did not see it) — carrying on"
  else
    printf '%s\n' "$out" >&2
    echo "Could not create queue $q, and not because it already existed." >&2
    exit 1
  fi
done
