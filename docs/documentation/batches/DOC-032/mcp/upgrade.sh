#!/usr/bin/env bash
# DOC-032 mcp: the operator's upgrade of the owned mcpup lab from 067c1646 (the DOC-030
# pin, before M42) to the DOC-032 pin 4ca41822, following docs/user-guides/upgrade.md.
# lab.mjs cannot switch commits, so this runs plain `docker compose` against the lab's own
# Compose project and volumes. The operator's "git checkout --detach <target>" is modelled
# as a second committed snapshot: `git archive 4ca41822` extracted into a scratch
# installation directory outside the worktree, with a copy of the lab's .env (same keys,
# OPENLAW_BUILD_COMMIT set to the target). The lab's own 067c1646 snapshot and recorded
# configuration stay untouched, so `lab.mjs destroy mcpup` still works.
# Run by phase-m42up.mjs; every command and its exit status goes to stdout.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../../.." && pwd)"
LAB="$ROOT/.documentation-labs/mcpup"
SCRATCH="$HOME/.cache/openlaw-doc032-mcp/upgrade"
TARGET_SRC="$SCRATCH/target-src"
PROJECT="openlaw-docs-9d2b1705-mcpup"
TARGET=4ca41822b685a2a1e58a38b4f25e421cf735c54e
STAGE="${1:-all}"
umask 077
mkdir -p "$SCRATCH"
chmod 700 "$SCRATCH"

say() { printf '\n$ %s\n' "$*"; }
running() {
  docker --context default compose --project-name "$PROJECT" --env-file "$LAB/source/.env" \
    --file "$LAB/source/compose.yml" --file "$LAB/overlay.json" "$@"
}
target() {
  docker --context default compose --project-name "$PROJECT" --env-file "$TARGET_SRC/.env" \
    --file "$TARGET_SRC/compose.yml" --file "$SCRATCH/overlay.json" "$@"
}

if [[ "$STAGE" == all || "$STAGE" == prepare ]]; then
  echo "## Before you start: record the running installation"
  say "running build revision (lab.json sourceCommit)"
  node -e "console.log(require('$LAB/lab.json').sourceCommit)"
  say "docker compose images"
  running images
  say "docker compose ps"
  running ps --format '{{.Service}} {{.Image}} {{.State}}'
  say "docker volume ls (project volumes)"
  docker --context default volume ls --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Name}}'

  echo "## Prepare the target without changing the live data"
  say "select the target: git archive $TARGET | tar -x -C <target installation directory>"
  rm -rf "$TARGET_SRC"
  (umask 022 && mkdir -p "$TARGET_SRC")
  # umask 022 as in an ordinary checkout: the image copies these modes, and a first attempt
  # under this script's umask 077 built an app image whose non-root user could not read
  # its own packages (ERR_MODULE_NOT_FOUND at start, before any migration ran).
  (umask 022 && git -C "$ROOT" archive --format=tar "$TARGET" | tar -x -C "$TARGET_SRC")
  echo "extracted $(git -C "$ROOT" rev-parse "$TARGET^{commit}")"
  # Step 2: the same .env with OPENLAW_BUILD_COMMIT set to the target; keys unchanged.
  cp "$LAB/source/.env" "$TARGET_SRC/.env"
  printf 'OPENLAW_BUILD_COMMIT=%s\nOPENLAW_BUILD_DIRTY=false\n' "$TARGET" >> "$TARGET_SRC/.env"
  # The per-revision image tags, as the installation guide recommends.
  node -e "
    const o = require('$LAB/overlay.json');
    o.services.app.image = '$PROJECT-app:${TARGET:0:12}';
    o.services.worker.image = '$PROJECT-app:${TARGET:0:12}';
    o.services['doc-engine'].image = '$PROJECT-engine:${TARGET:0:12}';
    require('fs').writeFileSync('$SCRATCH/overlay.json', JSON.stringify(o, null, 2));
  "
  say "docker compose config --quiet"
  target config --quiet && echo "config ok"
  say "docker compose build app doc-engine"
  target build app doc-engine 2>&1 | tail -n 4
  say "app and worker resolve to the same new image"
  target config --format json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const c=JSON.parse(s).services;console.log('app',c.app.image,'worker',c.worker.image,'doc-engine',c['doc-engine'].image)})"
  say "docker image inspect (new app and engine image ids)"
  docker --context default image inspect "$PROJECT-app:${TARGET:0:12}" --format '{{.Id}}'
  docker --context default image inspect "$PROJECT-engine:${TARGET:0:12}" --format '{{.Id}}'
  say "running containers unchanged after the build"
  running ps --format '{{.Service}} {{.Image}} {{.State}}'
  echo "## Step 3: deployment settings. APP_BIND=127.0.0.1 is already in .env (lab.mjs); no proxy (TRUSTED_PROXIES unset); default container ceilings; VAPID unset."
fi

if [[ "$STAGE" == all || "$STAGE" == backup ]]; then
  echo "## Step 4: coherent backup (backup-and-restore.md)"
  BACKUP_DIR="$SCRATCH/backup-$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$BACKUP_DIR"
  chmod 700 "$BACKUP_DIR"
  say "docker compose stop app worker"
  running stop app worker
  running ps --all --format '{{.Service}} {{.State}}'
  say "pg_dump > database.dump"
  running exec -T postgres pg_dump -U openlaw -d openlaw --format=custom > "$BACKUP_DIR/database.dump"
  say "tar the file volume > files.tar.gz"
  running run -T --rm --no-deps app tar -czf - -C /var/lib/openlaw/files . > "$BACKUP_DIR/files.tar.gz"
  node -e "console.log(require('$LAB/lab.json').sourceCommit)" > "$BACKUP_DIR/app-source.txt"
  running images --format json > "$BACKUP_DIR/images.json"
  say "pg_restore --list; tar -tzf; sha256sum"
  running exec -T postgres pg_restore --list < "$BACKUP_DIR/database.dump" > "$BACKUP_DIR/database-contents.txt"
  tar -tzf "$BACKUP_DIR/files.tar.gz" > "$BACKUP_DIR/file-contents.txt"
  (cd "$BACKUP_DIR" && sha256sum database.dump files.tar.gz > SHA256SUMS && cat SHA256SUMS)
  echo "database entries: $(wc -l < "$BACKUP_DIR/database-contents.txt"); file entries: $(wc -l < "$BACKUP_DIR/file-contents.txt")"
fi

if [[ "$STAGE" == rollback ]]; then
  # Only after a failed start that ran no migration: the running build's images again.
  say "docker compose up -d --no-build --pull never (running build)"
  running up -d --no-build --pull never 2>&1 | tail -n 6
  running ps --format '{{.Service}} {{.Image}} {{.State}}'
fi

if [[ "$STAGE" == all || "$STAGE" == start ]]; then
  echo "## Start and verify the upgrade, step 1"
  say "docker compose up -d --no-build --pull never"
  target up -d --no-build --pull never 2>&1 | tail -n 12
  say "docker compose ps"
  target ps --format '{{.Service}} {{.Image}} {{.State}}'
  say "docker compose port app 3000"
  target port app 3000 || true
fi

if [[ "$STAGE" == logs ]]; then
  # Logs stay local: only migration and error lines are printed.
  say "docker compose logs --tail=100 app worker (migration and error lines only)"
  target logs --no-color --tail=400 app worker 2>&1 | grep -iE "migrat|error|reconciled" | cut -c1-240 | tail -n 30 || true
  say "docker compose ps"
  target ps --format '{{.Service}} {{.Image}} {{.State}} {{.Status}}'
fi
