#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
#
# The hot-reload dev loop: the stack's backing services in Docker, the
# three apps as watch processes on the host (`pnpm dev:hot`).
#
#   web     http://localhost:5173   Vite, hot module reload
#   api     http://localhost:3000   tsx watch, restarts on save
#   worker  no port                 tsx watch, restarts on save
#   mail    http://localhost:8025   Mailpit, every sent link lands here
#
# Two flags, for an instance with something on its screens:
#
#   --seed    once the API answers, run `pnpm seed:demo` beside the
#             loop. Only an empty instance is seeded, so restarting the
#             loop with the flag never doubles the data up.
#   --fresh   drop the database volume and the blob directory first,
#             then seed. This is the reseed: what was there is gone.
#
# Anything else on the command line goes to the seed as it is, so
# `pnpm dev:hot --fresh --scale medium` is a smaller reseed.
#
# Browse the app on 5173. Vite proxies /api to the API on 3000, so the
# session cookie stays same-origin (TECH-008).
#
# What this file sets is the host half of the environment: where the
# services are, now that they are on 127.0.0.1 instead of a compose
# network. The secrets stay in .env, which the api and worker watch
# processes read for themselves (`--env-file-if-exists`). A value
# already exported in your shell wins over both.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

seed=false
fresh=false
seed_args=()
for argument in "$@"; do
  case "$argument" in
    --seed) seed=true ;;
    --fresh) fresh=true; seed=true ;;
    *) seed_args+=("$argument") ;;
  esac
done

# A second loop beside a running one is the confusing failure: the
# containers restart, then the api dies on EADDRINUSE while the web
# client of the *first* loop keeps answering on 5173. Stop here instead,
# and say which loop is already up.
for port in 3000 5173; do
  if ss -ltn "sport = :$port" 2>/dev/null | grep -q LISTEN; then
    echo "error: port $port is already in use — a dev loop is probably already running." >&2
    echo "       Browse http://localhost:5173, or Ctrl-C that loop before starting this one." >&2
    exit 1
  fi
done

compose=(docker compose -f compose.yml -f compose.dev.yml -f compose.hostdev.yml)

# Blobs cannot go to the stack's named volume: it belongs to the
# container's user, not yours. A host process gets its own directory, so
# files uploaded to the built stack are not readable from this loop and
# the other way round.
export STORAGE_PATH="${STORAGE_PATH:-$root/.storage}"

if $fresh; then
  echo "==> dropping the database volume and $STORAGE_PATH"
  # The volume and the blobs are one instance. A fresh database beside
  # the previous run's uploads is a cupboard of files nothing points at.
  "${compose[@]}" down -v
  rm -rf "$STORAGE_PATH"
fi

echo "==> starting postgres, doc-engine, mailpit"
# The service list is not optional: a bare `up` would also start the
# built app and worker containers, which would take the API's port and
# the worker's jobs out from under the watch processes.
"${compose[@]}" up -d postgres doc-engine mailpit

echo "==> waiting for postgres"
for _ in $(seq 1 60); do
  if "${compose[@]}" exec -T postgres pg_isready -U openlaw -d openlaw >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

# The same database the built stack uses. The containers and these
# processes share one volume, so the instance's accumulated state is
# there either way.
export DATABASE_URL="${DATABASE_URL:-postgres://openlaw:openlaw@127.0.0.1:${POSTGRES_PORT:-55432}/openlaw}"
export DOC_ENGINE_URL="${DOC_ENGINE_URL:-http://127.0.0.1:${DOC_ENGINE_PORT:-8080}}"
export SMTP_URL="${SMTP_URL:-smtp://127.0.0.1:${MAILPIT_SMTP_PORT:-1025}}"
export SMTP_FROM="${SMTP_FROM:-OpenLaw <openlaw@localhost>}"
# Where the seed reads the mail the loop sends. Moves with MAILPIT_PORT,
# like everything else here.
export SEED_MAILPIT_URL="${SEED_MAILPIT_URL:-http://127.0.0.1:${MAILPIT_PORT:-8025}}"
# Same reason as the dev overlay: a dev loop replays sign-in far faster
# than a human, and better-auth's limits would lock you out of your own
# app. Never a deployment's setting.
export AUTH_RATE_LIMIT="${AUTH_RATE_LIMIT:-off}"
# Loopback only. Fastify's default reaches every interface, and this
# loop runs with rate limiting off and a mail catcher behind it, not a
# thing to put on the LAN. Vite proxies from the same host.
export HOST="${HOST:-127.0.0.1}"

mkdir -p "$STORAGE_PATH"

if $seed; then
  echo "==> seeding once the api answers (only if the instance is empty)"
  # The seed waits for the API on its own (`--wait`), so it can start
  # now and the watch processes take the foreground. Its lines carry a
  # prefix, because they land between turbo's. A background job in a
  # non-interactive shell ignores Ctrl-C, so a seed that is mid-run
  # when the loop stops ends by itself: its next request finds no API.
  (
    node scripts/seed/index.mjs --wait --only-if-empty "${seed_args[@]}" 2>&1 \
      | sed -u 's/^/[seed] /'
  ) &
fi

echo "==> web http://localhost:5173   api http://localhost:3000   mail http://localhost:${MAILPIT_PORT:-8025}"
# The three apps only. @openlaw/doc-engine has a watch script of its
# own, and running it here would fight the container above for port
# 8080, and lose anyway on a host without LibreOffice and OCRmyPDF.
exec pnpm dev --filter=@openlaw/api --filter=@openlaw/worker --filter=@openlaw/web
