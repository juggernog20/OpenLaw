#!/usr/bin/env bash
# DOC-030 admin-org walkthrough driver. Runs one lab's sections in order and applies
# the deployment phases between them. Needs LAB_PASSWORD, AUTH_PASSWORD,
# POLICY_STAMP and SCRATCH_DIR in the environment (never written to docs/).
# Usage: run.sh work2 | auth2w | auth2
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../../../.." && pwd)
cd "$repo"
w() { PHASE="$1" node "$here/walkthrough.mjs" "$2" 2>&1 | grep -E "PASS|FAIL|steps,"; }
case "$1" in
  work2)
    w "shared work2 lab as created (no phase change)" org ;;
  auth2w)
    "$here/phase.sh" auth2w stored | tail -1
    w "stored: SMTP_URL and SMTP_FROM empty (overlay-mail-stored.json); first run" wizardStored
    "$here/phase.sh" auth2w incomplete | tail -1
    w "incomplete: SMTP_URL set, SMTP_FROM empty (overlay-mail-incomplete.json); wizard open; stored relay saved" wizardIncomplete
    "$here/phase.sh" auth2w env | tail -1
    w "env: SMTP_URL smtp://mailpit:1025 and SMTP_FROM DOC-030 Environment <env-relay@helix.example> (overlay-mail-env.json); stored relay saved" wizardEnv
    "$here/phase.sh" auth2w incomplete | tail -1
    w "incomplete: SMTP_URL set, SMTP_FROM empty (overlay-mail-incomplete.json); wizard finished" settingsIncomplete
    "$here/phase.sh" auth2w stored | tail -1
    w "stored again: environment override removed, app and worker recreated (overlay-mail-stored.json)" settingsStored
    w "stored (overlay-mail-stored.json)" guards ;;
  auth2)
    "$here/phase.sh" auth2 oidc | tail -1
    w "base lab environment (SMTP_URL smtp://mailpit:1025, SMTP_FROM OpenLaw <legal@helix.example>, BASE_URL http://127.0.0.1:43310); OIDC fixture running" policy
    w "base lab environment; OIDC fixture running" sso
    w "base lab environment; OIDC fixture running" twoFactor
    w "base lab environment" crossPage
    w "base lab environment (BASE_URL set by the deployment)" instancePinned
    w "base, then baseurl-unset applied twice by the section (overlay-baseurl-unset.json)" instanceSaved
    "$here/phase.sh" auth2 base | tail -1 ;;
  *) echo "usage: run.sh work2|auth2w|auth2" >&2; exit 1 ;;
esac
