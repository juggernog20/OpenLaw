#!/usr/bin/env bash
# Copy of DOC-032/admin-org/run.sh for the DOC-032 bridge replay. Adapted: the
# repository root is one folder deeper, the script is ../admin-org-replay.mjs, the
# labs are bfr, bwiz and bao, and the full console output is also appended to
# $SCRATCH_DIR/replay-<lab>.log (outside docs/).
# DOC-032 admin-org walkthrough driver. Runs one lab's sections in order and applies
# the deployment phases between them. Needs LAB_PASSWORD and SCRATCH_DIR in the
# environment (never written to docs/). Each section runs in a pasta network
# namespace that forwards only that lab's app and mail ports.
# Usage: run.sh bao | bwiz | bfr
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../../../../.." && pwd)
cd "$repo"
ports() { node -e "const l=require('$repo/.documentation-labs/$1/lab.json');console.log(l.appPort+','+l.mailPort)"; }
w() {
  local lab=$1 phase=$2 section=$3
  PHASE="$phase" pasta --config-net -T "$(ports "$lab")" -- \
    node "$here/../admin-org-replay.mjs" "$section" 2>&1 | tee -a "$SCRATCH_DIR/replay-$lab.log" | grep -E "PASS|FAIL|steps,"
}
case "$1" in
  bao)
    "$here/phase.sh" bao oidc | tail -1
    w bao "base lab environment; OIDC fixture with two issuers running" org
    w bao "base lab environment; OIDC fixture running" policy
    w bao "base lab environment; OIDC fixture running" sso
    w bao "base lab environment; OIDC fixture running" twoFactor
    w bao "base lab environment" crossPage
    w bao "base lab environment (BASE_URL set by the deployment)" instancePinned
    w bao "base, then baseurl-unset applied twice by the section (overlay-baseurl-unset.json)" instanceSaved
    "$here/phase.sh" bao base | tail -1
    w bao "base lab environment; OIDC fixture running" ssoRemove ;;
  bwiz)
    "$here/phase.sh" bwiz stored | tail -1
    w bwiz "stored: SMTP_URL and SMTP_FROM empty (overlay-mail-stored.json); first run" wizardStored
    "$here/phase.sh" bwiz incomplete | tail -1
    w bwiz "incomplete: SMTP_URL set, SMTP_FROM empty (overlay-mail-incomplete.json); wizard open; stored relay saved" wizardIncomplete
    "$here/phase.sh" bwiz env | tail -1
    w bwiz "env: SMTP_URL smtp://mailpit:1025 and SMTP_FROM DOC-032 Environment <env-relay@helix.example> (overlay-mail-env.json); stored relay saved" wizardEnv
    "$here/phase.sh" bwiz incomplete | tail -1
    w bwiz "incomplete: SMTP_URL set, SMTP_FROM empty (overlay-mail-incomplete.json); wizard finished" settingsIncomplete
    "$here/phase.sh" bwiz stored | tail -1
    w bwiz "stored again: environment override removed, app and worker recreated (overlay-mail-stored.json)" settingsStored
    w bwiz "stored (overlay-mail-stored.json)" guards ;;
  bfr)
    "$here/phase.sh" bfr oidc | tail -1
    "$here/phase.sh" bfr incomplete | tail -1
    w bfr "incomplete: SMTP_URL set, SMTP_FROM empty (overlay-mail-incomplete.json); OIDC fixture running" frSetup
    "$here/phase.sh" bfr stored | tail -1
    w bfr "unset: SMTP_URL and SMTP_FROM empty (overlay-mail-stored.json)" frOrg
    w bfr "unset (overlay-mail-stored.json); OIDC fixture running" frAuth
    w bfr "unset (overlay-mail-stored.json)" frEmail
    w bfr "app-saved relay; unset environment (overlay-mail-stored.json)" frInvites
    w bfr "app-saved relay; model-list stand-in on the OIDC fixture" frConnectors
    w bfr "app-saved relay" frReview
    w bfr "app-saved relay; onboarding complete" frAfter
    "$here/phase.sh" bfr incomplete | tail -1
    w bfr "incomplete after completion (overlay-mail-incomplete.json)" frEmailRow
    "$here/phase.sh" bfr base | tail -1 ;;
  *) echo "usage: run.sh bao|bwiz|bfr" >&2; exit 1 ;;
esac
