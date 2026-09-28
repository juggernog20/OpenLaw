#!/usr/bin/env bash
# DOC-032 admin-org walkthrough: applies one deployment phase to an owned lab
# only. It recreates app and worker with the lab's own compose files plus the
# named overlays, or starts the OIDC fixture beside them.
# Usage: phase.sh <lab> <oidc|base|stored|incomplete|env|baseurl-unset> [more overlays]
# Labs: aoauth (seeded), aowiz and afr2 (unseeded), firstrun (unseeded, batch-owned for this seat).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../../../.." && pwd)
lab_name=$1; shift
case "$lab_name" in aoauth|aowiz|afr2|firstrun) ;; *) echo "owned labs only" >&2; exit 1 ;; esac
lab="$repo/.documentation-labs/$lab_name"
project=$(node -e "console.log(require('$lab/lab.json').project)")
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
files=(--file "$lab/source/compose.yml" --file "$lab/overlay.json")
services=(app worker)
for phase in "$@"; do
  case "$phase" in
    base) ;;
    oidc)
      sed "s#__REPO__#$repo#" "$here/overlay-oidc.json" > "$work/oidc.json"
      files+=(--file "$work/oidc.json"); services=(oidc) ;;
    stored|incomplete|env) files+=(--file "$here/overlay-mail-$phase.json") ;;
    baseurl-unset) files+=(--file "$here/overlay-baseurl-unset.json") ;;
    *) echo "unknown phase $phase" >&2; exit 1 ;;
  esac
done
docker --context default compose --project-name "$project" --env-file "$lab/source/.env" "${files[@]}" \
  up --detach --no-build --no-deps --force-recreate --wait --wait-timeout 240 "${services[@]}"
echo "phase $* applied to $project ($(date -u +%FT%TZ))"
