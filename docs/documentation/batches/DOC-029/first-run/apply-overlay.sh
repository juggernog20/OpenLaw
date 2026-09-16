#!/usr/bin/env bash
# Recreate only the firstrun lab's app and worker with one extra email overlay.
# Usage: apply-overlay.sh <overlay.json | none>
set -euo pipefail
ROOT=/home/blairwentworth/.cache/openlaw-docs-status
LAB=$ROOT/.documentation-labs/firstrun
PROJECT=openlaw-docs-41255c61-firstrun
args=(--context default compose --project-name "$PROJECT" --env-file "$LAB/source/.env" --file "$LAB/source/compose.yml" --file "$LAB/overlay.json")
if [ "$1" != none ]; then args+=(--file "$1"); fi
docker "${args[@]}" up -d --no-deps --force-recreate app worker
for i in $(seq 1 90); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:23311/api/v1/auth/setup || true)
  [ "$code" = 200 ] && { echo "app ready"; exit 0; }
  sleep 2
done
echo "app not ready"; exit 1
