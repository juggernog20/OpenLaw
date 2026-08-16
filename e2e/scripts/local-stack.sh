#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
#
# Local E2E run against the suite's OWN persistent stack (TECH-018): a
# separate compose project (`openlaw-e2e`) on its own ports and volumes,
# so the default-project instance — the human testing ground on
# 3000/8025 — is never touched by a test run. Volumes persist across
# runs on purpose: the accumulated-state property lives with the suite.
#
# Reset the suite's instance with:
#   docker compose -p openlaw-e2e -f compose.yml -f compose.dev.yml down -v
#
# AUTH_SECRET and OPENLAW_SECRET_KEY come from .env, like every compose
# invocation. Both have to stay put between runs: the volumes persist,
# and a changed OPENLAW_SECRET_KEY would leave the suite's saved signing
# connector unreadable (TECH-022).

set -euo pipefail
cd "$(dirname "$0")/../.."

APP_PORT="${APP_PORT:-3100}"
MAILPIT_HOST_PORT="${MAILPIT_HOST_PORT:-8125}"
# Where the M15 demo's signing stand-in listens on the host, and where
# the overlay tells both containers to dial. One value, so the stack and
# the suite cannot disagree about it.
SIGNING_STUB_PORT="${SIGNING_STUB_PORT:-8129}"

# Rebuild every run — the gate is only honest if the images carry the
# code being tested, not whatever was built last time.
PORT="$APP_PORT" BASE_URL="http://localhost:$APP_PORT" MAILPIT_PORT="$MAILPIT_HOST_PORT" \
  SIGNING_STUB_PORT="$SIGNING_STUB_PORT" \
  docker compose -p openlaw-e2e -f compose.yml -f compose.dev.yml up -d --build

# Timeouts on the probe itself: a connection that opens but never
# answers must count as "not ready", not hang the loop.
for _ in $(seq 1 60); do
  if curl --connect-timeout 2 --max-time 5 -fsS "http://localhost:$APP_PORT/readyz" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
curl --connect-timeout 2 --max-time 5 -fsS "http://localhost:$APP_PORT/readyz" >/dev/null || {
  echo "app never answered /readyz on port $APP_PORT" >&2
  exit 1
}

E2E_BASE_URL="http://localhost:$APP_PORT" E2E_MAILPIT_URL="http://localhost:$MAILPIT_HOST_PORT" \
  E2E_SIGNING_STUB_PORT="$SIGNING_STUB_PORT" \
  pnpm --filter @openlaw/e2e e2e

echo "suite's stack left running on http://localhost:$APP_PORT (project openlaw-e2e)"
