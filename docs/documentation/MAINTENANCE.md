# Maintain the documentation

Task [#746](https://github.com/juggernog20/OpenLaw/issues/746). Use this process to
maintain the canonical guides, staff and Business Portal Help, compiler, and
retained editions. Check the [G3](batches/DOC-025/G3.md) and
[G4](batches/DOC-025/G4.md) reports for the remaining provider and publication
requirements. This process does not mark the current suite published.

## Owners and review cadence

Blair Wentworth, [@juggernog20](https://github.com/juggernog20), is the accountable
maintainer for all catalog articles and coverage groups, Help delivery, edition
artifacts, feedback triage, and release decisions. This carries forward the named
maintainer in [AUDIT.md](AUDIT.md). A feature PR's author owns its documentation
updates. Name the technical reviewer and independent walkthrough reviewer in that
PR and the article evidence. These assignments do not claim that human review has
already happened.

| Work                 | When                                               | Required outcome                                                                                                               |
| -------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Documentation impact | Every feature, fix, configuration or deployment PR | Coverage IDs and article/evidence updates, or a specific no-impact reason                                                      |
| Essential content    | Every release candidate                            | Review all P0 groups against the candidate, including roles, prerequisites and recovery                                        |
| Complete inventory   | Quarterly while release cadence is unsettled       | Review the full catalog, coverage, ownership, links and supported editions; next review by 2026-12-08                          |
| Feedback             | Weekly maintainer triage                           | Link each actionable report to a coverage group and owning change; this is an internal cadence, not a support response promise |
| Changed screenshots  | With the affected UI change                        | Refresh the capture or remove it if text is sufficient; retain capture provenance                                              |

If another person takes ownership, record their name and GitHub account here and
in the release handoff. Assign a reviewer for the affected behavior before the
change lands. A different task label for the same author is not an independent
person or agent. Name comparison in the compiler is only a minimum check; the
reviewer must actually inspect the sources or follow the guide.

## Handle documentation impact in a PR

Use the [PR template](../../.github/pull_request_template.md). Start with the actual
change, then find the affected coverage IDs in [COVERAGE.md](COVERAGE.md) and article
IDs in [articles.json](articles.json). Check shared procedures and Help topic
bindings too. Examples:

- A changed Approval control affects C16 and may affect C49/C50. Update the
  canonical Approval guide and any reference claim, then recheck each required role.
- A storage configuration change affects C45 and may affect C44/C47/C48. The operator
  follows the changed path on an owned disposable deployment and verifies files.
- A test-only assertion change can have no reader impact if controls, behavior,
  permissions and deployment inputs are unchanged. State that reason and identify
  the tested area; do not leave a bare "none."

Behavior, permission, prerequisite or supported-build changes reopen affected
articles to `review`. Update instructions in the same release as the feature.
Technical tests support the change; they do not replace an independent guide
walkthrough. Every required role and verification method remains in the scenario
registry. A local provider fixture does not satisfy a live-provider setup check.

For copy-only wording changes, retain the original app build, observations and
walkthrough times. Record the old/new content hashes, review time, reviewer and
classification in `copyOnlyReview`. Do not invent a new walkthrough date. If an app
range changes behavior, recheck the affected actions. An independent compatibility
review can retain unaffected older observations under [PUBLISHING.md](PUBLISHING.md).
Preserve the authored source audit separately from its independent acceptance.

Missing or stale evidence keeps an article out of normal publication. The exception
is an article the edition's TECH-027 publication record names. That record makes the
article available with a validation-in-progress notice. It grants no evidence credit.
Record the failure against its coverage ID, correct it, and retain the retest beside the
failed attempt. A blocked group stays in the denominator. A release exception needs
Blair's explicit decision, reason, owner and future target; it does not turn an
unverified group into a pass or make `docs:complete` succeed.

## Review coverage locally

From the repository root, with the workspace dependencies installed:

```sh
node scripts/documentation/status.mjs
```

The command prints JSON and makes no network requests or repository changes. It
reads the current catalog, scenario requirements and article evidence. It reuses
compiler validation and checks that scenario observations are retained as local
files. A remote evidence reference needs a retained local record before this
report can credit it. Malformed requirements fail instead of reducing counts.

Read the results separately:

- `articles` names each owning task, catalog state, required role/method count and
  evidence failure. Only complete valid articles receive role/method credit.
- `coverage` requires every mapped article to pass. `priorities` separates P0 and P1.
- `distributionReview` checks the application digest against the recorded review.
- `completePublication` first requires valid retained article evidence, then runs
  the complete-suite compiler gate and checks retained shared observations. It can fail even
  when article evidence is valid, for example while content is still in review,
  the checkout has working changes, or final Help/offline evidence is missing.
- `sharedScenarios` retains the additional Help/offline requirements and their
  declared registry states. Preview observations do not complete the final edition.

A successful command exit means the report was generated, not that the suite is
ready. At the DOC-025 checkpoint the counts are 54 of 56 articles and 53 of 55
coverage groups with valid article evidence, 116 of 124 article/role/method
combinations, and seven additional shared combinations. Catalog states are 54
`review` and two `scoped`, so zero articles are published. Run the command again
for current counts. Keep dated reports with the release handoff and link them from
[#714](https://github.com/juggernog20/OpenLaw/issues/714); do not maintain a second
spreadsheet of article states.

## Findability and task-success targets

The [pilot](PILOT.md) provides a small agent baseline. Its
[author discovery record](pilot/author-discovery.json) records four queries at one
second each. The independent pilot found the same four answers but did not measure
query time separately. These are automation observations, not human task timings.

Retain the four regression queries: "form target," "assign request," "convert
request," and "submit request," with their recorded roles and Help entry points.
Also retain the previously failing "which version" query from DOC-025 for each app
role and the signed-out reader. The intended article must be found without a query
retry and open with its title focused. All required role journeys must succeed;
an unresolved required failure blocks its acceptance gate.

For controlled local automation, use five seconds from submitting a query on an
already loaded reader to finding its intended result as a provisional regression
budget. This gives margin over the pilot's coarse one-second observations. Record
browser, build, environment and timing boundaries; investigate a regression rather
than presenting the budget as a universal user response-time promise. Do not apply
it to installation, provider setup, first load or human reading time.

No human time-to-answer target has been validated. During the user's full-suite
proofreading, retain feedback they choose to provide, including unanswered tasks
and search wording. Use a later agreed human sample to set human targets. Do not
infer human speed from agent scripts or invent completion percentages.

## Feedback and corrections

Use the existing public [issue tracker](https://github.com/juggernog20/OpenLaw/issues)
and [documentation correction template](../../.github/ISSUE_TEMPLATE/documentation.md).
Ask for the guide/section, edition, role, fictional reproduction and expected versus
actual outcome. A failed query is useful only after private names have been removed.
Organization-specific access problems go through the reader's Administrator.

During triage, link duplicates, assign coverage IDs and an owner, and use the
[existing labels](../agents/triage-labels.md). Mark missing details as `needs-info`;
use `ready-for-agent` for a specified correction. A repeated failed query becomes a
findability regression case. Record a no-change decision with its reason. Verify
the correction in the same destination before closing the report.

There is no automatic report submission, reader analytics, query logging or new
telemetry service. Review the issue queue and retained acceptance records. Any
future telemetry proposal needs a separate product decision before implementation.

## Editions, links and screenshots

Keep article IDs stable when titles change. For an ID or heading move, add the
explicit alias to [redirects.json](redirects.json), check the old link and fragment,
and let the compiler reject loops or unavailable targets. Do not redirect an old
procedure to a different task merely to remove a missing-link error.

Record the supported app build, application digest, distribution commit, article
hashes and review identities separately. A compatibility review must describe the
actual source comparison and affected walkthroughs. Changing a hash to silence a
failure is not review. Keep the original observations and old edition artifacts.

Screenshots are optional. Use real captures with fictional data and meaningful alt
text. Record app/build, article/scenario, role, time, viewport and theme; exclude
credentials and private records. Refresh an image when a changed control makes it
misleading. Instructions must remain usable when the image is absent.

Release edition identifiers and artifacts are immutable. Installed older apps keep
their bundled edition; unknown requested editions remain explicit, with recovery
through a retained copy. Builds predating Help use the corresponding source guides
or retained export. Do not silently send them to a mutable latest edition.

When support for an edition ends, Blair records the affected app builds, date,
reason, migration route and retained artifact location in the release record.
Retirement stops new maintenance; it does not justify rewriting the old edition or
deleting an operator's recovery copy. Preserve supported aliases and the last
complete export. Any later artifact removal is a separate explicit decision.

## Release handoff

Use [RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md) for every edition. The current
project publishes only into the feature review environment under DOC-027. A
production release or merge into `dev` or `main` is a separate release action.
