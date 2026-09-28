#!/usr/bin/env bash
# DOC-032 contracts: apply the signing stand-in overlay to an owned lab (default c16sign).
# Usage: up.sh up|down|ps [lab]. Run after `lab.mjs up <lab>` and `lab.mjs seed <lab>`.
# `down` removes the stand-in and restores app and worker to the lab's own configuration;
# run it before `lab.mjs destroy <lab>`.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../../../../.." && pwd)"
name="${2:-c16sign}"
lab="$repo/.documentation-labs/$name"
field() { node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1]))[process.argv[2]])' "$lab/lab.json" "$1"; }
project="$(field project)"
export STANDIN_IMAGE="$(field appImage)"
export STANDIN_BUNDLE="/tmp/doc032-contracts-standin-$name.mjs"
base=(docker --context default compose --project-name "$project" --env-file "$lab/source/.env" --file "$lab/source/compose.yml" --file "$lab/overlay.json")
case "${1:-}" in
  up)
    esbuild="$(ls -d "$repo"/node_modules/.pnpm/esbuild@0.25.*/node_modules/esbuild/bin/esbuild | head -1)"
    "$esbuild" "$here/standin-entry.mjs" --bundle --platform=node --format=esm --target=node24 --outfile="$STANDIN_BUNDLE" --log-level=warning
    chmod 644 "$STANDIN_BUNDLE"
    "${base[@]}" --file "$here/signing-overlay.yml" up --detach --no-build --wait --wait-timeout 180 app worker signing-standin ;;
  down)
    "${base[@]}" --file "$here/signing-overlay.yml" rm --stop --force signing-standin
    "${base[@]}" up --detach --no-build --wait --wait-timeout 180 app worker
    rm -f "$STANDIN_BUNDLE" ;;
  ps) "${base[@]}" --file "$here/signing-overlay.yml" ps ;;
  *) echo "usage: up.sh up|down|ps [lab]" >&2; exit 2 ;;
esac
