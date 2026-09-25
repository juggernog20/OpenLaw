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
proofreading is recorded. The owner took part in one live claude.ai session,
recorded below. 60 of 62 guides are verified.

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

configure-analysis ran against a real OpenRouter key on its own lab, with the
model `openai/gpt-oss-120b`. The key came from the owner's saved connector and
went into no file. Three Analysis runs wrote the expected Fields. The invalid
key, model and endpoint each produced the documented refusal. The first walk
failed one step: the guide asked the reader to check the run's model, and no page
shows it. The step now points at the connector's saved **Model**. The walk is in
[analysis-live](analysis-live/).

connect-claude and the public part of deployment-configuration ran in a joint
session with the owner, in [claude-live](claude-live/). A lab was exposed through
Tailscale Funnel with fresh passwords, so the seed password could not sign in.
claude.ai connected as Nadia Haddad twice (once read and write, once read only),
as Daniel Okafor and as Jonas Weber. Each connection called `openlaw_whoami`,
`openlaw_docs_search` and `openlaw_docs_read` as that person, from Anthropic's
address range. After each Disconnect, the next call got 401.

The session found two guide errors, now fixed:

- claude.ai's custom connector flow has changed. It is now **Add**, **Add custom
  connector**, Name and MCP server URL, **Continue**, **Use Claude's published
  identity**, **Add**, then **Connect**. It has no Client ID or secret fields.
- claude.ai never reached an origin on port 8443, even though every check the
  guide names passed there. On port 443 it connected. The public profile now says
  to serve on 443, and connect-claude has a troubleshooting row for claude.ai's
  "Couldn't reach this address".

One round connected as Nadia again instead of Daniel, because the browser still
held her OpenLaw session and the consent page skipped sign-in. The guide's "Sign
in to OpenLaw if asked" is accurate. The walk counts that round as a second
Legal Team Member round.

A local lab covered what needs no vendor: existing grants refused when MCP, an
account group or the Client is turned off, a Client removed mid-flow, and Claude
Code's loopback callbacks. The Claude Code CLI round was not run, by owner
decision.

The Funnel first failed for about two hours. Tailscale's relays closed every
connection without contacting the node, after the node's control connection had
reset. It recovered without a change on this machine. Tailscale is the likely
place to report it.

ChatGPT and Microsoft 365 Copilot were not tested. The owner chose to verify
Claude only in this batch. connect-chatgpt and connect-microsoft-365-copilot stay
in **review** under DOC-031, with V-M41-C60 and V-M41-C61 pending. They keep the
development warning "Documentation review is pending" until DOC-031 lands.

## Scenario registry

Each scenario whose every role and method passed in the new evidence now records
DOC-030 acceptance. The earlier records credited DOC-025. 66 of 68 scenarios
pass. V-M41-C60 and V-M41-C61 wait for DOC-031.

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
- Past three magic-link requests per address in 15 minutes, the app sends no
  mail but still shows "Check your email". The owner read it as an expired link.
- On a plain-HTTP instance, turning on
  OAuth Clients gets a 400 and the page shows no error.

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
finishes migrating and restarts once; the upload refusal says 1 MB for a 1 MiB
limit; the API never removes its heartbeat row; the Contract record never names
the model an Analysis ran; the MCP reachability pill fails when the app resolves
its own hostname through a private resolver. A large profile photo broke Settings >
Profile, and dev fixed it after the pinned commit (`7abd2a8f`).
