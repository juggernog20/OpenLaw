# Suite re-verification at 067c1646

Issue: [#1157](https://github.com/juggernog20/OpenLaw/issues/1157).

Dev moved a long way after DOC-029. M37 to M44 added answer styles, device
notifications, type Forms, MCP, API keys, OAuth Clients, the email layout and
advanced search. The development build then warned that the application
compatibility review was stale. DOC-030 checks every guide again against one
pinned build. The edition now pins app commit
`067c1646829df85e62b809ee9157921e867c84e7`, with application digest
`34696f76…3c0d`.

Every check here is an independent agent check. No human user study or human
proofreading is recorded. The owner took part in one live session, recorded below.

## How the batch ran

A triage agent read the app diff from both DOC-029 base commits,
[triage.json](triage.json). It mapped the changes to each guide. Of the 23 guides
whose text still matched their evidence, 16 needed a fresh walkthrough and 7
could carry a compatibility review.

Each article group then had two seats. A source-review author agent read the code
at the pinned commit and corrected the guide. Across 59 reviews the authors made
444 corrections and confirmed 546 claims. A separate walkthrough agent then
followed the corrected guide on a lab, as every role and method the scenario
registry names. When a walkthrough failed, the author fixed the guide and the
walker ran the changed steps again. The group folders hold each
`technical-review.json`, `walkthrough.mjs`, `walkthrough.json` and screenshots.
The briefs for each seat are the `BRIEF-*.md` files.

The walkthroughs sent these guides back to their authors: first-run,
staff-sign-in, contract-analysis, search-and-views, entity-structure-and-access,
and the four operator guides. In the operator guides, the claims about
`TRUSTED_PROXIES` and a wrong `OPENLAW_SECRET_KEY` did not match the running app.
All passed on their second walk.

The 7 compatibility reviews replayed the DOC-029 scripts on the new lab,
[compat/compat.json](compat/compat.json). All 7 are compatible. For
configure-signing, no signing code the guide describes changed, so the DOC-029
live DocuSign observation still applies.

Most walkthroughs used the shared lab `openlaw-docs-80ceef9e-work2` (Helix light
seed, random seed 7). First-run used an empty lab. The operator,
authentication and MCP-on-LAN guides used labs of their own, named in each
evidence record.

Glossary and operator changes outside the guides: seven `CONTEXT.md`
definitions, `docs/DEPLOYMENT.md` and `.env.example`.

The documentation lab helper wrote `PORT` as `127.0.0.1:<port>`. Compose
publishes on `${APP_BIND}:${PORT}`, so `up` failed. `lab.mjs` now writes the bare
port.

## Live providers

<!-- TODO: configure-analysis live OpenRouter result, connect-claude joint session,
V-M41-PUBLIC. -->

ChatGPT and Microsoft 365 Copilot were not tested. The owner chose to verify Claude
only in this batch. connect-chatgpt and connect-microsoft-365-copilot stay
unverified, and V-M41-C60 and V-M41-C61 stay pending.

## Scenario registry

Each scenario whose every role and method passed in the new evidence now records
DOC-030 acceptance. The earlier records credited DOC-025.

<!-- TODO: final counts. -->

## Publication checks

<!-- TODO: V-HELP and V-OFFLINE on the distribution commit. -->

## Owner rulings wanted

These are registry or wording questions, not guide errors.

- Comment emails use the stored tier names Legal Only, Working Team and Full
  Thread. Thread badges say Contract Team, Matter Team and Internal team. Which
  names should the email use?
- V-C55's negative check "Non-Member+ selections are refused" no longer matches
  CTR-012.
- V-C38 does not cover Document types. Add them there, or move them to a documents
  scenario?
- V-C25 asks a Business User to edit permitted business Fields. Portal Fields are
  read-only under DD-026, so the check cannot run.
- V-C37 asks for a SAML check. The app has no SAML setup.

## Product notes

The authors and walkers recorded app defects. They are not guide errors, and the
guides describe the built behavior. The owner chooses which become issues. The
most serious first:

- A wrong `OPENLAW_SECRET_KEY` never stops startup. Saved Advanced values revert
  to defaults with no warning. TECH-022 expects a refusal. Under the same wrong
  key, `reset-advanced-settings` exits 0 and erases every section's saved values,
  not only the named one.
- The API ignores SIGTERM. `docker compose stop` exits 137 and leaves the API
  heartbeat row.
- No startup warning when `TRUSTED_PROXIES` matches no real proxy address. The
  per-IP sign-in lockout then applies to the proxy, which locks out everyone
  behind it.
- The Portal record Fields card ignores Branch conditions (DD-028). The Change
  contract type dialog demands a required Field Row under a false Branch.
- A built-in Department Row on the intake Form makes the Portal ask Department
  twice. Legal sees the first answer, and conversion writes the second.
- Request-context Analysis writes Risk, Region and Department with Unverified
  markers, but Overview shows no marker or Confirm, and Confirm all never counts
  them.
- A Legal Team Member can mark their own Knowledge Document confidential, lose
  access and not clear it.
- Add Holding accepts a hand-typed owner on an Entity with a share register
  (ENT-011).
- The Portal lists a Request type whose destination type is archived. Opening it
  shows the generic error page.
- The Portal API key request may offer a Business User the Administration Toolset.
  Check against DD-029 and SET-014.
- On a plain-HTTP LAN origin, Copy in "Your key is ready" and the Client secret
  dialog throws, and "Copy failed" never shows.
- The personal API keys table has no Last used column (SET-014).

Smaller copy and layout defects: the Key date dialog shows only the organization
lead times; the Convert dialog no longer names answers that stay on the Request;
the header search parses `or` and `-` but the results page does not; the Knowledge
Item Type picker refuses every choice; blank Issued shares still claims the
register agrees; register rows use icon buttons, not the row menu; the Business
User consent caption names "Portal settings"; Portal notification rows omit
Contract Approval requests and API key decisions; Start blank copy omits Default
type and says "Remove them first" with no delete control; "Organisation default"
is British spelling; the Portal says Legal Owner; the Portal Matters icon is the
Approvals icon; Matter search ignores the M- prefix and does not rank an exact
number first; generic refusals for an unreachable OIDC issuer and a bad SMTP
server; raw Term type values in the Portal; two different notices for removed
search conditions; History prints "someone" for register Holdings; the column
resize strip is 4px wide; entry numbers are padded in one place only; the Field
archive dialog counts records as types; the worker reads settings before the app
finishes migrating and restarts once. A large profile photo broke Settings >
Profile, and dev fixed it after the pinned commit (`7abd2a8f`).
