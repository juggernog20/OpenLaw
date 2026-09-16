#!/usr/bin/env bash
# Applies one deployment phase to the owned adminorg-auth lab only.
# Usage: phase.sh <base|stored|incomplete|env> <oidc-dir>
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../../../.." && pwd)
lab="$repo/.documentation-labs/adminorg-auth"
project=openlaw-docs-41255c61-adminorg-auth
phase=$1; oidc=$2
work=$(mktemp -d)
sed "s#__OIDC_DIR__#$oidc#" "$here/overlay-networks.json" > "$work/networks.json"
files=(--file "$lab/source/compose.yml" --file "$lab/overlay.json" --file "$work/networks.json")
[ "$phase" != base ] && files+=(--file "$here/overlay-phase-$phase.json")
docker --context default compose --project-name "$project" --env-file "$lab/source/.env" "${files[@]}" up --detach --no-build --wait --wait-timeout 240 app worker oidc postgres mailpit doc-engine
sha256sum "$here/overlay-networks.json" ${phase:+$( [ "$phase" != base ] && echo "$here/overlay-phase-$phase.json")}
rm -rf "$work"
