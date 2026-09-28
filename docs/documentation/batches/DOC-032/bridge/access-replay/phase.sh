#!/usr/bin/env bash
# DOC-032 compatibility reviewer (bridge): a copy of DOC-032/access/phase.sh for access-replay.mjs.
# Adapted only: repository root depth (one folder deeper) and lab accs -> bacc.
# DOC-032 access walkthrough: applies one deployment phase to the owned lab `bacc` only.
# oidc: starts the two-issuer OIDC fixture (DOC-032/admin-org/oidc-fixture.mjs) beside the lab.
# base: recreates app and worker with the lab's own compose files (email relay from the environment).
# mail-off: recreates app and worker with SMTP_URL and SMTP_FROM empty, so OpenLaw cannot send email.
# Usage: phase.sh <oidc|base|mail-off>
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../../../../.." && pwd)
lab="$repo/.documentation-labs/bacc"
project=$(node -e "console.log(require('$lab/lab.json').project)")
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
files=(--file "$lab/source/compose.yml" --file "$lab/overlay.json")
services=(app worker)
case "$1" in
  base) ;;
  oidc)
    sed "s#__REPO__#$repo#" "$here/overlay-oidc.json" > "$work/oidc.json"
    files+=(--file "$work/oidc.json"); services=(oidc) ;;
  mail-off) files+=(--file "$here/overlay-mail-off.json") ;;
  *) echo "unknown phase $1" >&2; exit 1 ;;
esac
docker --context default compose --project-name "$project" --env-file "$lab/source/.env" "${files[@]}" \
  up --detach --no-build --no-deps --force-recreate --wait --wait-timeout 240 "${services[@]}"
echo "phase $1 applied to $project ($(date -u +%FT%TZ))"
