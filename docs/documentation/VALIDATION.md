# Documentation verification setup

Task: [#725](https://github.com/juggernog20/OpenLaw/issues/725).
Use [scenarios.json](scenarios.json) with the
[editorial evidence rules](EDITORIAL.md). These are scenario specifications;
`not-run` means that no article walkthrough has been credited.
The [environment readiness record](environment-readiness.json) records the actual
role sign-in and helper isolation checks for this preparation task.

## The authoring instance

The [lab helper](../../scripts/documentation/lab.mjs) creates a separate Compose
project from an archived Git commit. Its database, stored files, app image, engine
image, and Mailpit instance belong to that project. App and mail ports bind to
loopback. The helper uses the local default Docker context and excludes inherited
deployment variables, so a caller's database, storage, mail, or Compose settings
cannot redirect the lab to their ordinary development instance.

The helper does not use `dev:hot`, `stack:reset`, or the shared `openlaw-e2e` project.
It generates private instance keys and preserves them with the lab until destruction.
It checks ownership and source/configuration digests before managing an existing
lab. Keep its files private under the ignored `.documentation-labs/` directory.
Never put that directory, browser session state, or raw mail messages in a PR.

From the repository root, with Docker access and the workspace Node/pnpm versions:

```sh
node scripts/documentation/lab.mjs create authoring --commit <full-commit>
node scripts/documentation/lab.mjs up authoring
node scripts/documentation/lab.mjs seed authoring
node scripts/documentation/lab.mjs status authoring
```

Substitute a committed revision for `<full-commit>`. Without `--commit`, create
resolves and records the current HEAD. It never builds the working tree. `up`
builds from the archived snapshot, labels the images with that revision, and records
the image IDs. Editing a snapshot or its configuration makes the helper refuse
further management until the recorded inputs are restored.

Default app address: `http://127.0.0.1:43300`.
Default Mailpit address: `http://127.0.0.1:48425`.
If either port is occupied, choose two free ports when creating another named lab:

```sh
node scripts/documentation/lab.mjs create onboarding --commit <full-commit> --app-port 43301 --mail-port 48426
node scripts/documentation/lab.mjs up onboarding
```

Leave an onboarding lab unseeded to exercise first-run setup. A named lab cannot
be recreated over existing state, and seeding requires an empty instance. A failed
seed records failure; destroy and recreate that disposable lab before retrying.
Do not seed a production instance or an operator's populated upgrade fixture.

```sh
node scripts/documentation/lab.mjs stop authoring
node scripts/documentation/lab.mjs up authoring
```

`stop` preserves data. `up` starts the same lab again. When the lab is no longer
needed, the following command removes its containers, volumes, private keys, and
snapshot directory. It leaves locally built image layers cached:

```sh
node scripts/documentation/lab.mjs destroy authoring
```

The project name includes a repository-path fingerprint and the chosen lab name.
The helper refuses unknown ownership and a pre-existing project when creating a
lab. Destruction only applies to that named lab. Record its actual project name
from `status` before any manual fault-injection command. Never use an unqualified
`docker compose down -v` during this work.

## Repeatable fictional data and accounts

Use the existing [Helix seed](../../scripts/seed/index.mjs), light profile, random
seed 7. It creates base plans for 30 Contracts, 18 Matters, and 15 Requests, plus
the work produced by their dispositions. It also creates Entities, Knowledge,
Documents, teams, configurations, comments, and notifications. Do not assert those
base-plan counts as final database totals.

The seed intentionally uses dates relative to the current UTC day. Record its
start/end timestamps and the organization's `Europe/London` timezone. Randomized
choices repeat; UUIDs, activity timestamps, and calendar dates do not form a
byte-identical database image. Use named scenario fixtures and their actual dates
in evidence, not a hard-coded record UUID or an assumed "today" from the author’s
local timezone.

Use these separate browser contexts for the primary role checks:

| Role              | Fictional account                            | Entry                                       |
| ----------------- | -------------------------------------------- | ------------------------------------------- |
| Administrator     | Daniel Okafor, `daniel.okafor@helix.example` | Password sign-in                            |
| Legal Team Member | Nadia Haddad, `nadia.haddad@helix.example`   | Password sign-in                            |
| Contributor       | Ravi Menon, `ravi.menon@helix.example`       | Password sign-in                            |
| Business User     | Jonas Weber, `jonas.weber@helix.example`     | New magic link read from this lab's Mailpit |

The existing seed's disposable password is `correct-horse-battery`. This is a demo
credential, never a deployment recommendation. Use Priya Raman and Amara Nwosu
from the same seed as comparison readers for access tests. A private/incognito
window alone is not enough if several roles share its session; use distinct
browser contexts or browser profiles. Do not publish cookies or authentication
links. Request a new link and identify its new mail message rather than reusing a
spent seed message.

Use a fictional first Administrator such as Avery Morgan in unseeded first-run
scenarios. That is a separate fixture from the seed's bootstrap Administrator.
Use Daniel's account for Administrator screenshots of the populated lab.

The base lab has a disabled AI connector and no Signing connector. The seed's
`--skip-ai` path must not wait for nonexistent Analysis runs. This task corrects
that pre-existing seed wait. The base lab deliberately makes unavailable-integration
behavior easy to test; additional provider fixtures are specified below.

Before a mutating scenario, create records named for its scenario/run, such as
`Docs V-C16 approval review`, and record the resulting references privately. Give
each access scenario explicit team/Grant assignments; do not assume that a random
seeded record grants a chosen person access. Use separate records for irreversible
dispositions or deletion. Recreate a lab when its accumulated changes make the
scenario's prerequisites ambiguous.

## Coverage and scenario records

[scenarios.json](scenarios.json) contains 58 scenarios covering all 55 groups and
56 planned articles. C17 has separate Manual hand-off and electronic-signing
scenarios. `V-HELP` and `V-OFFLINE` are shared publication checks in addition to the
article cases. The registry lists prerequisites, actions, observable results,
negative checks, roles, and required verification methods.

Every listed role needs its applicable walkthrough or a documented role-specific
refusal check. Do not record one successful Administrator run as passing every
role. Evidence identifies the scenario, role, method, actual result, app build,
article content hash, time, and reviewer. Where a scenario needs another actor,
record both identities and which browser context performed each action. The
registry's `roles` are reader/verification roles, not new application roles;
`operator` and `anonymous` do not belong in the app's permission model.

Negative checks are part of the required scenario. Turn broad cases into the
article's concrete checklist before writing, using its implemented UI labels and
source references. Record each outcome separately when several cases could pass
or fail independently. The registry is the minimum required coverage; it does not
limit a reviewer who finds another material variant.

Use [the verification template](templates/verification.json) for article evidence.
Keep supporting traces, screenshots, commands, and output at stable recorded
locations. Copy only sanitized evidence into the repository or review artifact.
Keep raw browser traces and environment files private: even a fictional fixture
can carry a live session token. Evidence records are build inputs for verification,
not public reader content.

Environment readiness, existing feature tests, technical review, and article
walkthroughs are different records. A successful seed or sign-in smoke check does
not complete C01/C02 or verify any unwritten article. An independent reviewer must
follow the actual article against its recorded build; identify an agent walkthrough
as such. Record elapsed task time and discovery failures during the pilot and the
independent installation, without labeling an agent run a human user study.

## Failure fixtures and providers

| Case                              | Fixture and boundary                                                                                                                                  |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visibility/reach                  | Distinct role contexts, two teams, confidential work, and explicit Entity Grants; attempt direct links as allowed and denied readers                  |
| Expired or revoked authentication | Controlled disposable tokens/sessions; any test-only expiry manipulation is fixture setup, not a user recovery instruction                            |
| Missing integration               | The base lab's disabled AI connector and unconfigured Signing connector                                                                               |
| Analysis success/failure          | Dedicated local provider fixture using existing E2E/seed provider seams and known fictional text; label the mode in evidence                          |
| Signing states                    | Dedicated signing stand-in with explicit deployment configuration in an isolated fixture; never point real credentials at it                          |
| Failed processing                 | Small supported, unsupported, and intentionally invalid files; stop the owned doc-engine only for the fault case, then restore it and verify recovery |
| Lost race                         | Two browser contexts attempt disposition or editing of the same disposable record; inspect the documented refusal/re-read                             |
| Partial upload                    | One valid and one failing file, with per-item results; retain evidence that the valid file survived                                                   |

Do not turn the immutable base lab into another environment by editing its files
in place. Create a separately identified scenario fixture for a different deployment
configuration and record its actual inputs. The existing
[signing](../../e2e/tests/docusign.ts) and
[AI](../../e2e/tests/openai.ts) E2E helpers are implementation inputs, not permission
to run the entire shared E2E suite against the authoring lab or reuse its ports.
Bind any fixture server appropriately for its own container network and avoid
the seed AI server's host-loopback address when the worker lives in another container.

Local stand-ins verify OpenLaw workflow handling. C42 and C43 additionally require
real provider-account checks against current primary provider instructions. A
successful simulated connection never satisfies those setup scenarios. Use only
disposable provider accounts, fictional inputs, and controlled test recipients.
Record actual provider/model/account-environment identity without credentials.

Real DocuSign developer and AI-provider test access has been requested during this
task and is not yet confirmed. Keep those checks pending until the configuration
is available; the remaining local preparation can proceed. Do not mark blocked
provider setup as passed or reduce the complete-suite denominator.

## Independent operator scenarios

The authoring helper uses a mail catcher and disables authentication rate limits.
It is not the production installation procedure and cannot by itself verify C44.
Use separate disposable projects for the following guide walkthroughs:

1. **Fresh installation (V-C44):** choose immutable candidate images and an empty
   target. An independent operator follows the actual installation article from
   its prerequisites, records elapsed time, and reaches a usable first-run state.
   Verify the documented production defaults and local reverse-proxy contract.
2. **Configuration (V-C45):** exercise each claimed configuration path, including
   filesystem and local S3-compatible storage, and verify files and effective
   behavior. Keep secrets out of reported output. A configuration that merely
   parses is not demonstrated operation.
3. **Populated upgrade (V-C46):** pin an earlier supported source/image and a
   candidate, populate the former, then follow the upgrade article. Record both
   identities, migration outcome, account/reach checks, representative records,
   file hashes, and usable encrypted configuration. Select the earlier baseline
   before the operator article's review; this planning task does not invent a
   release tag. The existing upgrade-fidelity machinery is supporting evidence.
4. **Restore (V-C47):** retain a coherent database/file backup and required keys
   separately. Restore into a different empty target and verify app access,
   permissions, file hashes, and encrypted configuration. Test a missing/wrong-key
   or missing-file case, then recover with the correct inputs. Do not assume that
   downgrading a migrated database is supported.
5. **Diagnostics (V-C48):** induce one controlled failure at a time, follow the
   guide, restore the service, and confirm recovery. Preserve the original fixture
   when testing a recovery that could destroy data.

## Captures and final acceptance

Capture the real app only after the scenario reaches a known state. Record article
ID, scenario/role, app commit/image, time, theme, viewport, and the image's purpose.
Use meaningful alt text and keep steps understandable without the image. Exclude
credential editors, mail tokens, browser storage, unrelated records, and raw logs.
Screenshots are optional when text is sufficient.

For Help, test Light/Dark/Warm, keyboard operation, 200% zoom, and narrow layouts.
Record search queries and whether they found the intended answer. For offline
acceptance, first block internet access while the instance remains reachable; then
stop the instance and read a retained standalone copy from disk. Test its complete
index and prose without JavaScript too. Record these as distinct outcomes.

After Help implementation, select a new committed verification build and recreate
the relevant fixtures. The current preparation build predates Help. Content-only
changes carry their own hashes and compatibility review as specified in
[PUBLISHING.md](PUBLISHING.md). DOC-025 reviews every required result and DOC-027
records the actual publication environment and export. Neither a merged writing
PR nor a passing environment smoke check completes those gates.
