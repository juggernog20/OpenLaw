#!/usr/bin/env bash
# DOC-029 round 2 compatibility replay: apply the signing stand-in overlay to the owned lab "sign-r2".
# Copy of rewalk/signing/up.sh. Only the lab name and the path to server.mjs and the overlay changed.
# Usage: up.sh up|down|ps. Run after `lab.mjs up sign-r2` and `lab.mjs seed sign-r2`.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../../../../.." && pwd)"
lab="$repo/.documentation-labs/sign-r2"
project="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).project)' "$lab/lab.json")"
export STANDIN_IMAGE="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).appImage)' "$lab/lab.json")"
export STANDIN_SERVER="$here/../../rewalk/signing/server.mjs"
base=(docker --context default compose --project-name "$project" --env-file "$lab/source/.env" --file "$lab/source/compose.yml" --file "$lab/overlay.json")
case "${1:-}" in
  up) "${base[@]}" --file "$here/../../rewalk/signing/signing-overlay.yml" up --detach --no-build --wait --wait-timeout 180 app worker signing-standin ;;
  down)
    "${base[@]}" --file "$here/../../rewalk/signing/signing-overlay.yml" rm --stop --force signing-standin
    "${base[@]}" up --detach --no-build --wait --wait-timeout 180 app worker ;;
  ps) "${base[@]}" --file "$here/../../rewalk/signing/signing-overlay.yml" ps ;;
  *) echo "usage: up.sh up|down|ps" >&2; exit 2 ;;
esac
