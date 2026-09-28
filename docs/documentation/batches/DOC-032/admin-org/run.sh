#!/usr/bin/env bash
# DOC-032 admin-org walkthrough driver. Runs one lab's sections in order and applies
# the deployment phases between them. Needs LAB_PASSWORD and SCRATCH_DIR in the
# environment (never written to docs/). Each section runs in a pasta network
# namespace that forwards only that lab's app and mail ports.
# Usage: run.sh aoauth | aowiz | firstrun | afr2
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../../../.." && pwd)
cd "$repo"
ports() { node -e "const l=require('$repo/.documentation-labs/$1/lab.json');console.log(l.appPort+','+l.mailPort)"; }
w() {
  local lab=$1 phase=$2 section=$3
  PHASE="$phase" pasta --config-net -T "$(ports "$lab")" -- \
    node "$here/walkthrough.mjs" "$section" 2>&1 | grep -E "PASS|FAIL|steps,"
}
case "$1" in
  aoauth)
    "$here/phase.sh" aoauth oidc | tail -1
    w aoauth "base lab environment; OIDC fixture with two issuers running" org
    w aoauth "base lab environment; OIDC fixture running" policy
    w aoauth "base lab environment; OIDC fixture running" sso
    w aoauth "base lab environment; OIDC fixture running" twoFactor
    w aoauth "base lab environment" crossPage
    w aoauth "base lab environment (BASE_URL set by the deployment)" instancePinned
    w aoauth "base, then baseurl-unset applied twice by the section (overlay-baseurl-unset.json)" instanceSaved
    "$here/phase.sh" aoauth base | tail -1
    w aoauth "base lab environment; OIDC fixture running" ssoRemove ;;
  aowiz)
    "$here/phase.sh" aowiz stored | tail -1
    w aowiz "stored: SMTP_URL and SMTP_FROM empty (overlay-mail-stored.json); first run" wizardStored
    "$here/phase.sh" aowiz incomplete | tail -1
    w aowiz "incomplete: SMTP_URL set, SMTP_FROM empty (overlay-mail-incomplete.json); wizard open; stored relay saved" wizardIncomplete
    "$here/phase.sh" aowiz env | tail -1
    w aowiz "env: SMTP_URL smtp://mailpit:1025 and SMTP_FROM DOC-032 Environment <env-relay@helix.example> (overlay-mail-env.json); stored relay saved" wizardEnv
    "$here/phase.sh" aowiz incomplete | tail -1
    w aowiz "incomplete: SMTP_URL set, SMTP_FROM empty (overlay-mail-incomplete.json); wizard finished" settingsIncomplete
    "$here/phase.sh" aowiz stored | tail -1
    w aowiz "stored again: environment override removed, app and worker recreated (overlay-mail-stored.json)" settingsStored
    w aowiz "stored (overlay-mail-stored.json)" guards ;;
  firstrun)
    "$here/phase.sh" firstrun oidc | tail -1
    "$here/phase.sh" firstrun incomplete | tail -1
    w firstrun "incomplete: SMTP_URL set, SMTP_FROM empty (overlay-mail-incomplete.json); OIDC fixture running" frSetup
    "$here/phase.sh" firstrun stored | tail -1
    w firstrun "unset: SMTP_URL and SMTP_FROM empty (overlay-mail-stored.json)" frOrg
    w firstrun "unset (overlay-mail-stored.json); OIDC fixture running" frAuth
    w firstrun "unset (overlay-mail-stored.json)" frEmail
    w firstrun "app-saved relay; unset environment (overlay-mail-stored.json)" frInvites
    w firstrun "app-saved relay; model-list stand-in on the OIDC fixture" frConnectors
    w firstrun "app-saved relay" frReview
    w firstrun "app-saved relay; onboarding complete" frAfter
    "$here/phase.sh" firstrun incomplete | tail -1
    w firstrun "incomplete after completion (overlay-mail-incomplete.json)" frEmailRow
    "$here/phase.sh" firstrun base | tail -1 ;;
  afr2)
    w afr2 "lab default email environment (SMTP_URL and SMTP_FROM set)" frLater ;;
  afr2-finish)
    w afr2 "lab default email environment, fresh database after the reset" frFinish ;;
  afr2-skip)
    w afr2 "lab default email environment, fresh database after the reset" frSkip ;;
  *) echo "usage: run.sh aoauth|aowiz|firstrun|afr2|afr2-finish|afr2-skip" >&2; exit 1 ;;
esac
