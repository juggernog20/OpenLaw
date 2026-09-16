#!/usr/bin/env bash
# DOC-029 signing-standin: apply the stand-in overlay to the owned lab "sign-r1".
# Usage: up.sh up|down|ps. Run after `lab.mjs up sign-r1` and `lab.mjs seed sign-r1`.
# `down` removes only the stand-in and restores app/worker to the lab's own configuration;
# run it before `lab.mjs destroy sign-r1`.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../../../../.." && pwd)"
lab="$repo/.documentation-labs/sign-r1"
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
