#!/usr/bin/env bash
# DOC-030 contracts-c: apply the signing stand-in overlay to the owned lab "c3sign".
# Copy of DOC-029/rewalk/signing/up.sh with the lab name and folder changed.
# The shared lab work2 is never touched: the stand-in needs DOCUSIGN_BASE_URL and SIGNING_STANDIN
# on app and worker, which recreates both containers.
# Usage: up.sh up|down|ps. Run after `lab.mjs up c3sign` and `lab.mjs seed c3sign`.
# `down` removes the stand-in and restores app/worker to the lab's own configuration;
# run it before `lab.mjs destroy c3sign`.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../../../../.." && pwd)"
lab="$repo/.documentation-labs/c3sign"
project="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).project)' "$lab/lab.json")"
export STANDIN_IMAGE="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).appImage)' "$lab/lab.json")"
export STANDIN_SERVER="$here/server.mjs"
base=(docker --context default compose --project-name "$project" --env-file "$lab/source/.env" --file "$lab/source/compose.yml" --file "$lab/overlay.json")
case "${1:-}" in
  up) "${base[@]}" --file "$here/signing-overlay.yml" up --detach --no-build --wait --wait-timeout 180 app worker signing-standin ;;
  down)
    "${base[@]}" --file "$here/signing-overlay.yml" rm --stop --force signing-standin
    "${base[@]}" up --detach --no-build --wait --wait-timeout 180 app worker ;;
  ps) "${base[@]}" --file "$here/signing-overlay.yml" ps ;;
  *) echo "usage: up.sh up|down|ps" >&2; exit 2 ;;
esac
