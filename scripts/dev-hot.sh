#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
#
# The hot-reload dev loop: the stack's backing services in Docker, the
# three apps as watch processes on the host (`pnpm dev:hot`).
#
#   web     http://localhost:5173   Vite, hot module reload
#   api     http://localhost:3000   tsx watch, restarts on save
#   worker  no port                 tsx watch, restarts on save
#   mail    http://localhost:8025   Mailpit, used when no relay is configured
#
# Two flags, for an instance with something on its screens:
#
#   --seed    once the API answers, run `pnpm seed:demo` beside the
#             loop. Only an empty instance is seeded, so restarting the
#             loop with the flag never doubles the data up.
#   --fresh   drop the database volume and the blob directory first,
#             then seed. This is the reseed: what was there is gone.
#
# Choose how another checkout runs:
#
#   --worktree  run this checkout's web and API on their own ports, using
#               the shared database, uploads, and backing services. Jobs
#               are handled by the worker in the usual dev loop.
#   --isolated  run a second instance beside the usual one. It gets its
#               own containers, its own database volume, its own blob
#               directory and its own block of ports, all named after
#               this checkout's directory. Use it to keep a worktree's
#               branch away from the instance you demo from. The new
#               instance starts empty, so this seeds it.
#   --offset N  place that block by hand, if the derived one collides.
#
#   --smtp-in-app  configure email through the wizard instead of pinning
#                  Mailpit in the environment. Normal restarts detect a saved
#                  relay automatically; this flag also enables first-time setup.
#
# Without either flag, use the shared instance and the usual web/API ports.
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
worktree=false
smtp_in_app=false
offset=""
seed_args=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --stop) action=stop ;;
    --down) action=down ;;
    --seed) seed=true ;;
    --fresh) fresh=true; seed=true ;;
    --smtp-in-app) smtp_in_app=true ;;
    --worktree) worktree=true ;;
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

if $worktree && { $isolated || $fresh || $seed; }; then
  echo "error: --worktree shares existing data and cannot be combined with --isolated, --fresh, or --seed." >&2
  exit 1
fi

if $seed && $smtp_in_app; then
  echo "error: --smtp-in-app cannot be combined with --seed, --fresh, or --isolated." >&2
  exit 1
fi

# Compose names the containers and the database volume after the
# project, and it defaults that name to the directory it runs in. A
# worktree is a different directory, so the default quietly builds a
# second, empty instance and the data you were working with looks lost.
# Name the instance here instead. Every checkout reaches the same one,
# because a worktree is a branch of the code and not a second database.
if $isolated || $worktree; then
  slug="$(printf '%s' "$(basename "$root")" \
    | tr '[:upper:]' '[:lower:]' \
    | tr -c 'a-z0-9' '-' \
    | sed 's/-\{2,\}/-/g; s/^-//; s/-$//')"
  instance="openlaw-${slug:-worktree}"
else
  if [[ -n "$offset" ]]; then
    echo "error: --offset needs --worktree or --isolated." >&2
    exit 1
  fi
  instance="openlaw"
fi
if $worktree; then
  export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-openlaw}"
  checkout_id="$(printf '%s' "$root" | cksum | cut -d' ' -f1)"
  loop_instance="${COMPOSE_PROJECT_NAME}-worktree-${checkout_id}"
else
  export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$instance}"
  loop_instance="$COMPOSE_PROJECT_NAME"
fi

# Where this instance's ports sit. The shared one keeps the numbers
# everything else in the repo documents. An instance of its own takes a
# block derived from its name, so URLs stay stable across restarts.
# Compose's project name keeps the containers and data attached to the
# same instance even when --offset changes its ports.
if $isolated || $worktree; then
  if [[ -z "$offset" ]]; then
    port_instance="$instance"
    if $worktree; then
      port_instance="$loop_instance"
    fi
    offset=$(( ($(printf '%s' "$port_instance" | cksum | cut -d' ' -f1) % 80) + 1 ))
  fi
  if ! [[ "$offset" =~ ^[0-9]+$ ]] || (( offset < 1 || offset > 80 )); then
    echo "error: --offset takes a whole number from 1 to 80." >&2
    exit 1
  fi
else
  offset=0
fi

# Keep fresh starts and shutdowns on the rootless engine when its socket
# is available. An explicitly selected host or context still wins.
if [[ -z "${DOCKER_HOST:-}" && -z "${DOCKER_CONTEXT:-}" ]]; then
  podman_socket="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/podman/podman.sock"
  if [[ -S "$podman_socket" ]]; then
    export DOCKER_HOST="unix://$podman_socket"
  fi
fi

compose=(docker compose -f compose.yml -f compose.dev.yml -f compose.hostdev.yml)
if [[ "$action" != stop ]]; then
  echo "==> container connection: ${DOCKER_CONTEXT:-${DOCKER_HOST:-Docker CLI default}}"
fi

if [[ "$action" != start ]]; then
  node scripts/dev-processes.mjs stop "$loop_instance"
  if [[ "$action" == down ]]; then
    if $worktree; then
      echo "==> shared backing services left running"
    else
      "${compose[@]}" stop postgres doc-engine mailpit
    fi
  fi
  exit 0
fi

# Mark the whole loop before setup, so another terminal can stop it even
# during install or startup. Children retain the marker across Turbo's
# separate process groups and after their parents exit.
if [[ -z "${OPENLAW_DEV_RUN:-}" ]]; then
  exec node scripts/dev-processes.mjs run "$loop_instance" \
    bash "$root/scripts/dev-hot.sh" "${original_args[@]}"
fi

# A git worktree starts without the two things this loop cannot run
# without. .env and node_modules are both gitignored, so checking a
# branch out into a worktree gives you neither, and the first thing you
# see is compose refusing to interpolate AUTH_SECRET. Set them up here
# rather than send you to a README.
# `git worktree list` prints the main checkout first.
main_checkout="$(git worktree list --porcelain 2>/dev/null | sed -n '1s/^worktree //p')" || main_checkout=""
if $worktree && [[ -z "$main_checkout" && -z "${STORAGE_PATH:-}" ]]; then
  echo "error: cannot find the main checkout's uploads. Set STORAGE_PATH to the shared blob directory." >&2
  exit 1
fi
if [[ ! -f .env ]]; then
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

# First-run setup asks for a token (TECH-031). The seed and the E2E
# helpers read it from .env, so a file without one stops the seed with
# a message instead of an Administrator. A copied .env from before the
# token existed lacks the line too, so this runs after both branches.
if ! grep -q '^SETUP_TOKEN=.' .env; then
  echo "==> no SETUP_TOKEN in .env. Adding one for first-run setup"
  token="$(openssl rand -base64 24 | tr '+/' '-_' | tr -d '=')"
  if grep -q '^#\?SETUP_TOKEN=' .env; then
    awk -v token="$token" \
      '$0 ~ /^#?SETUP_TOKEN=/ { print "SETUP_TOKEN=" token; next } { print }' .env > .env.tmp
    mv .env.tmp .env
  else
    printf '\nSETUP_TOKEN=%s\n' "$token" >> .env
  fi
fi

if [[ ! -d node_modules ]]; then
  echo "==> no node_modules here. Installing, which takes a minute, once per worktree"
  pnpm install
fi

export PORT="${PORT:-$((3000 + offset))}"
export WEB_PORT="${WEB_PORT:-$((5173 + offset))}"
# Isolated databases stay below Linux's usual ephemeral client-port
# range (32768–60999). A connection using 55432 + offset as its source
# port can prevent Docker from binding even when no listener is there.
postgres_base=55432
infra_offset=0
if $isolated; then
  postgres_base=15432
  infra_offset="$offset"
fi
export POSTGRES_PORT="${POSTGRES_PORT:-$((postgres_base + infra_offset))}"
export DOC_ENGINE_PORT="${DOC_ENGINE_PORT:-$((8080 + infra_offset))}"
export MAILPIT_PORT="${MAILPIT_PORT:-$((8025 + infra_offset))}"
export MAILPIT_SMTP_PORT="${MAILPIT_SMTP_PORT:-$((1025 + infra_offset))}"

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
    if $worktree; then
      echo "       Stop it with pnpm dev:stop --worktree, or move it with --offset N." >&2
    elif $isolated; then
      echo "       Stop it with pnpm dev:stop --isolated, or move it with --offset N." >&2
    else
      echo "       Stop it with pnpm dev:stop, then run pnpm dev:hot again." >&2
      echo "       Add --worktree to share its data on separate ports, or --isolated for separate data." >&2
    fi
    exit 1
  fi
done

# Blobs cannot go to the stack's named volume: it belongs to the
# container's user, not yours. A host process gets its own directory, so
# files uploaded to the built stack are not readable from this loop and
# the other way round.
if $worktree; then
  export STORAGE_PATH="${STORAGE_PATH:-$main_checkout/.storage}"
  echo "==> worktree $root: sharing $COMPOSE_PROJECT_NAME and uploads at $STORAGE_PATH"
else
  export STORAGE_PATH="${STORAGE_PATH:-$root/.storage}"
fi

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
if $worktree; then
  # Another checkout owns these containers; its running configuration wins.
  "${compose[@]}" up -d --no-recreate postgres doc-engine mailpit
else
  "${compose[@]}" up -d postgres doc-engine mailpit
fi

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
# Only the default development fallback yields to a saved relay. Explicit
# SMTP configuration stays pinned; seeded runs always capture mail locally.
smtp_mode="$(node scripts/dev-smtp.mjs "$smtp_in_app" "$seed")"
case "$smtp_mode" in
  app)
    # Empty exports also override values read from .env by the watch processes.
    export SMTP_URL=""
    export SMTP_FROM=""
    echo "==> email uses the relay configured in the app"
    ;;
  env)
    export SMTP_URL
    export SMTP_FROM="${SMTP_FROM:-OpenLaw <openlaw@localhost>}"
    echo "==> email uses the explicitly configured environment relay"
    ;;
  mailpit)
    export SMTP_URL="smtp://127.0.0.1:${MAILPIT_SMTP_PORT:-1025}"
    export SMTP_FROM="OpenLaw <openlaw@localhost>"
    echo "==> email captured by Mailpit at http://localhost:$MAILPIT_PORT"
    ;;
esac
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

if $worktree; then
  echo "==> background jobs use the worker in the shared dev loop (pnpm dev:hot)"
  wait "$dev_pid"
  exit 0
fi

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
