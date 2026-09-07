#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
#
# The upgrade-fidelity gate (#260), run locally the way CI runs it.
#
# It fills a baseline install through the public API, stops the stack
# keeping the volumes, brings the working copy up against that same
# database and files, and checks every seeded record still reads back.
# What it is for, and why the comparison is what it is, is in
# upgrade-fidelity.mjs beside this file.
#
#   pnpm upgrade-fidelity              # newest release, else dev (its parent on dev)
#   BASELINE=v0.3.0 pnpm upgrade-fidelity
#
# It runs in its own compose project (`openlaw-upgrade`) on its own
# ports and volumes, so the instance you develop against on 3000 and the
# E2E suite's on 3100 are never touched. Volumes are destroyed at the
# end. Unlike the E2E suite, accumulated state would defeat the point:
# every run has to start from a fresh baseline install.
#
# AUTH_SECRET and OPENLAW_SECRET_KEY come from .env. The key in
# particular has to be the same value on both sides, or the credentials
# the baseline stored are unreadable after the upgrade by design rather
# than by fault (TECH-022).

set -euo pipefail
cd "$(dirname "$0")/../.."

BASELINE="$(node e2e/scripts/upgrade-baseline.mjs "${BASELINE:-}")"
APP_PORT="${APP_PORT:-3200}"
MAILPIT_HOST_PORT="${MAILPIT_PORT:-8225}"
SIGNING_STUB_PORT="${SIGNING_STUB_PORT:-8229}"
PROJECT=openlaw-upgrade
COMPOSE=(docker compose -p "$PROJECT" -f compose.yml -f compose.dev.yml)

WORKTREE="$(mktemp -d)/baseline"
FINGERPRINT="$(mktemp -d)/fingerprint.json"

cleanup() {
  PORT="$APP_PORT" MAILPIT_PORT="$MAILPIT_HOST_PORT" SIGNING_STUB_PORT="$SIGNING_STUB_PORT" \
    BASE_URL="http://localhost:$APP_PORT" "${COMPOSE[@]}" down -v >/dev/null 2>&1 || true
  git worktree remove --force "$WORKTREE" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Everything both halves need. BASE_URL matters: the app checks the
# Origin of a sign-in against it, and the verify signs in.
export PORT="$APP_PORT"
export MAILPIT_PORT="$MAILPIT_HOST_PORT"
export SIGNING_STUB_PORT
export BASE_URL="http://localhost:$APP_PORT"
export UPGRADE_BASE_URL="$BASE_URL"

wait_for_readyz() {
  for _ in $(seq 1 60); do
    if curl --connect-timeout 2 --max-time 5 -fsS "$BASE_URL/readyz" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "the $1 stack never answered /readyz on port $APP_PORT" >&2
  exit 1
}

echo "==> baseline: $BASELINE"
git worktree add --detach "$WORKTREE" "$BASELINE" >/dev/null
cp .env "$WORKTREE/.env"

echo "==> building and starting the baseline"
(cd "$WORKTREE" && "${COMPOSE[@]}" up -d --build >/dev/null)
wait_for_readyz baseline

echo "==> filling the baseline install"
node e2e/scripts/upgrade-fidelity.mjs seed --out "$FINGERPRINT"

# `down` without `-v`: the volumes are the install, and reusing them is
# the whole point.
echo "==> stopping the baseline, keeping its data"
(cd "$WORKTREE" && "${COMPOSE[@]}" down >/dev/null)

echo "==> building and starting the working copy against that data"
"${COMPOSE[@]}" up -d --build >/dev/null
wait_for_readyz upgraded

echo "==> checking every seeded record still reads back"
node e2e/scripts/upgrade-fidelity.mjs verify --in "$FINGERPRINT"
