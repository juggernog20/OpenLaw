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
# One flag for where the data lives:
#
#   --isolated  run a second instance beside the usual one. It gets its
#               own containers, its own database volume, its own blob
#               directory and its own block of ports, all named after
#               this checkout's directory. Use it to keep a worktree's
#               branch away from the instance you demo from. The new
#               instance starts empty, so this seeds it.
#   --offset N  place that block by hand, if the derived one collides.
#
# Without --isolated every checkout reaches the same instance, which is
# the point: a worktree is a branch of the code, not a second database.
#
# Anything else on the command line goes to the seed as it is, so
# `pnpm dev:hot --fresh --scale medium` is a smaller reseed.
#
# Browse the app on the web port. Vite proxies /api to the API, so the
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

original_args=("$@")
action=start

seed=false
fresh=false
isolated=false
offset=""
seed_args=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --stop) action=stop ;;
    --down) action=down ;;
    --seed) seed=true ;;
    --fresh) fresh=true; seed=true ;;
    # An instance of its own starts with an empty database. Seeding it
    # is the only way it has anything on its screens, and the seed only
    # touches an empty instance, so asking for one asks for the other.
    --isolated) isolated=true; seed=true ;;
    --offset)
      if [[ $# -lt 2 ]]; then
        echo "error: --offset needs a number." >&2
        exit 1
      fi
      offset="$2"
      shift
      ;;
    --offset=*) offset="${1#*=}" ;;
    *) seed_args+=("$1") ;;
  esac
  shift
done

# Compose names the containers and the database volume after the
# project, and it defaults that name to the directory it runs in. A
# worktree is a different directory, so the default quietly builds a
# second, empty instance and the data you were working with looks lost.
# Name the instance here instead. Every checkout reaches the same one,
# because a worktree is a branch of the code and not a second database.
if $isolated; then
  slug="$(printf '%s' "$(basename "$root")" \
    | tr '[:upper:]' '[:lower:]' \
    | tr -c 'a-z0-9' '-' \
    | sed 's/-\{2,\}/-/g; s/^-//; s/-$//')"
  instance="openlaw-${slug:-worktree}"
else
  if [[ -n "$offset" ]]; then
    echo "error: --offset moves an instance of its own. Add --isolated." >&2
    exit 1
  fi
  instance="openlaw"
fi
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$instance}"

# Where this instance's ports sit. The shared one keeps the numbers
# everything else in the repo documents. An instance of its own takes a
# block above them, derived from its name rather than from whatever is
# free: the same checkout has to land on the same ports every run, or
# the next run starts a third instance and leaves this one's data
# behind.
if $isolated; then
  if [[ -z "$offset" ]]; then
    offset=$(( ($(printf '%s' "$instance" | cksum | cut -d' ' -f1) % 80) + 1 ))
  fi
  if ! [[ "$offset" =~ ^[0-9]+$ ]] || (( offset < 1 || offset > 80 )); then
    echo "error: --offset takes a whole number from 1 to 80." >&2
    exit 1
  fi
else
  offset=0
fi

compose=(docker compose -f compose.yml -f compose.dev.yml -f compose.hostdev.yml)

if [[ "$action" != start ]]; then
  node scripts/dev-processes.mjs stop "$COMPOSE_PROJECT_NAME"
  if [[ "$action" == down ]]; then
    "${compose[@]}" stop postgres doc-engine mailpit
  fi
  exit 0
fi

# Mark the whole loop before setup, so another terminal can stop it even
# during install or startup. Children retain the marker across Turbo's
# separate process groups and after their parents exit.
if [[ -z "${OPENLAW_DEV_RUN:-}" ]]; then
  exec node scripts/dev-processes.mjs run "$COMPOSE_PROJECT_NAME" \
    bash "$root/scripts/dev-hot.sh" "${original_args[@]}"
fi

# A git worktree starts without the two things this loop cannot run
# without. .env and node_modules are both gitignored, so checking a
# branch out into a worktree gives you neither, and the first thing you
# see is compose refusing to interpolate AUTH_SECRET. Set them up here
# rather than send you to a README.
if [[ ! -f .env ]]; then
  # `git worktree list` prints the main checkout first.
  main_checkout="$(git worktree list --porcelain 2>/dev/null | sed -n '1s/^worktree //p')"
  if [[ -n "$main_checkout" && "$main_checkout" != "$root" && -f "$main_checkout/.env" ]]; then
    # Copy it, never generate a new one, when the main checkout has one.
    # Every loop on this machine shares one database, and
    # OPENLAW_SECRET_KEY is what decrypts the credentials stored in it.
    # A second key reads those columns as noise.
    echo "==> no .env here. Copying the one from $main_checkout"
    cp "$main_checkout/.env" .env
  else
    echo "==> no .env here. Writing one from .env.example with new secrets"
    cp .env.example .env
    for name in AUTH_SECRET OPENLAW_SECRET_KEY; do
      secret="$(openssl rand -base64 32)"
      # The example file leaves both empty. Fill the empty line, and
      # leave a value alone if someone put one there.
      awk -v name="$name" -v secret="$secret" \
        '$0 == name "=" { print name "=" secret; next } { print }' .env > .env.tmp
      mv .env.tmp .env
    done
  fi
fi

if [[ ! -d node_modules ]]; then
  echo "==> no node_modules here. Installing, which takes a minute, once per worktree"
  pnpm install
fi

export PORT="${PORT:-$((3000 + offset))}"
export WEB_PORT="${WEB_PORT:-$((5173 + offset))}"
export POSTGRES_PORT="${POSTGRES_PORT:-$((55432 + offset))}"
export DOC_ENGINE_PORT="${DOC_ENGINE_PORT:-$((8080 + offset))}"
export MAILPIT_PORT="${MAILPIT_PORT:-$((8025 + offset))}"
export MAILPIT_SMTP_PORT="${MAILPIT_SMTP_PORT:-$((1025 + offset))}"

# Where Vite sends /api, and the Origin it signs the request with, which
# better-auth compares against its own base URL (TECH-008). Both follow
# the API's port.
export DEV_API_ORIGIN="${DEV_API_ORIGIN:-http://localhost:$PORT}"
# Emailed links. Left unset the API falls back to localhost:3000, which
# belongs to another instance once this one has moved off it.
export BASE_URL="${BASE_URL:-$DEV_API_ORIGIN}"

# A second loop beside a running one is the confusing failure: the
# containers restart, then the api dies on EADDRINUSE while the web
# client of the *first* loop keeps answering. Stop here instead, and say
# which loop is already up.
for port in "$PORT" "$WEB_PORT"; do
  if ss -ltn "sport = :$port" 2>/dev/null | grep -q LISTEN; then
    echo "error: port $port is already in use. A dev loop is probably already running." >&2
    if $isolated; then
      echo "       Stop it with pnpm dev:stop --isolated, or move it with --offset N." >&2
    else
      echo "       Stop it with pnpm dev:stop, then run pnpm dev:hot again." >&2
      echo "       To run this checkout beside that one instead, add --isolated." >&2
    fi
    exit 1
  fi
done

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

echo "==> instance $COMPOSE_PROJECT_NAME: starting postgres, doc-engine, mailpit"
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
# Which API the seed signs in to. Left unset it falls back to port 3000,
# which belongs to the shared instance: an isolated loop would then wait
# for an API that never answers on its port, or worse, seed a whole org
# into the instance that does answer there.
export SEED_BASE_URL="${SEED_BASE_URL:-$DEV_API_ORIGIN}"
# Where the seed tells you to sign in. The API address is the wrong one
# to print for this loop, because Vite serves the app on its own port.
export SEED_WEB_URL="${SEED_WEB_URL:-http://localhost:$WEB_PORT}"
# Same reason as the dev overlay: a dev loop replays sign-in far faster
# than a human, and better-auth's limits would lock you out of your own
# app. Never a deployment's setting.
export AUTH_RATE_LIMIT="${AUTH_RATE_LIMIT:-off}"
# Loopback only. Fastify's default reaches every interface, and this
# loop runs with rate limiting off and a mail catcher behind it, not a
# thing to put on the LAN. Vite proxies from the same host.
export HOST="${HOST:-127.0.0.1}"

mkdir -p "$STORAGE_PATH"

# Keep background jobs out of the terminal's foreground process group.
# dev-processes.mjs owns cleanup, including children that create new groups.
set -m

if $seed; then
  echo "==> seeding once the api answers (only if the instance is empty)"
  (
    node scripts/seed/index.mjs --wait --only-if-empty "${seed_args[@]}" 2>&1 \
      | sed -u 's/^/[seed] /'
  ) &
fi

echo "==> web http://localhost:$WEB_PORT   api http://localhost:$PORT   mail http://localhost:$MAILPIT_PORT"
# The API and the web client only. @openlaw/doc-engine has a watch
# script of its own, and running it here would fight the container above
# for port 8080, and lose anyway on a host without LibreOffice and
# OCRmyPDF. The worker starts further down, and not here, for a reason
# of its own.
pnpm dev --filter=@openlaw/api --filter=@openlaw/web &
dev_pid=$!

# The worker waits for the API, because the API is the one process that
# migrates the database (TECH-005) and it listens only once that is
# done. Started beside the API instead, the worker reads a table the
# migration has not created yet, and it exits rather than retry: that is
# the right answer for a deployment, where migrations are their own
# step, but here it leaves a loop whose jobs nothing takes. tsx watch
# does not bring it back until a file under apps/worker changes, so the
# failure is quiet and it lasts.
(
  for _ in $(seq 1 120); do
    if ss -ltn "sport = :$PORT" 2>/dev/null | grep -q LISTEN; then
      break
    fi
    sleep 1
  done
  pnpm dev --filter=@openlaw/worker
) &

wait "$dev_pid"
