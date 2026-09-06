# Authoring and review standards

Task: [#723](https://github.com/juggernog20/OpenLaw/issues/723). Applies to every
article in [articles.json](articles.json) and its Help presentation.

## Write for the person doing the task

Lead with the result. State the required role, record access, configuration, and
starting point before the steps. Use short, active sentences and one action per
numbered step. Name the control someone must use and the result they should see.
Use the exact visible label, including its capitalization, when naming a control.
Do not require readers to understand database columns, route handlers, adapters,
review tools, or the documentation build process to complete an app task.

Use en-US spelling, dates, and punctuation in authored content. Prefer explicit
example dates such as "September 7, 2026" to ambiguous numeric dates. The app may
format a date differently for a reader's locale. Distinguish a civil date from a
timestamp when it affects a deadline or a reminder. State a currency when an example
uses money. Do not infer a timezone or a legal deadline from a screenshot.

Headings use sentence case. Avoid promotional claims, decorative icons, and generic
introductions. Use lists for steps or parallel items and tables for comparisons.
Explain a consequential action next to its step. A warning should identify the
actual consequence, such as removing every Document Version, not give generic legal
or security advice. Keep troubleshooting close to the task or link to a precise
symptom in the troubleshooting article.

## Vocabulary and UI labels

[CONTEXT.md](../../CONTEXT.md) defines domain terms. Module decisions and current
code establish their behavior. A UI label may use different capitalization from
the domain term; quote the actual label in a step and keep the domain term in the
explanation. If the UI and the accepted decision disagree, record the discrepancy
and ask the feature owner to resolve it before publishing the affected claim.

| Use                                     | Preserve this distinction                                                                             |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Request                                 | The business submission before disposition; not a Contract or Matter                                  |
| Contract / Matter                       | Different work objects, even when a Request can become either                                         |
| Entity / Counterparty                   | Our corporate entity versus an external organization                                                  |
| Document / Document Version             | Managed logical record versus immutable file snapshot                                                 |
| Request attachment / comment attachment | Paper provided through that channel; do not call it a managed Document before it is filed or promoted |
| Contributor                             | A defined app role with reached-record access; not a generic guest                                    |
| Stage / Status / Category               | Contract backbone, configured label, and this baseline's Matter open/closed grouping                  |
| Legal Only / Working Team / Full Thread | Actual visibility tiers; do not substitute "privileged" or "public"                                   |
| Unverified value                        | A usable value carrying analysis evidence, not a pending proposal                                     |
| Signing connector / AI connector        | OpenLaw's configured connection; distinguish it from the external provider                            |
| Knowledge Item                          | Organization content; distinguish it from OpenLaw product Help                                        |

Do not turn software behavior into a legal conclusion. A confidentiality flag
controls access in OpenLaw. A visibility-tier name does not establish privilege.
An Analysis run does not replace a person's verification of extracted values.
Describe the implemented controls and their observable effects.

## Article forms

Use the smallest template that supports the task. Delete unused sections before
publication; never ship placeholders or empty headings.

| Kind            | Template                                        | Required substance                                                           |
| --------------- | ----------------------------------------------- | ---------------------------------------------------------------------------- |
| How-to          | [Task guide](templates/how-to.md)               | Result, prerequisites, steps, expected outcome, important variants, recovery |
| Explanation     | [Explanation](templates/explanation.md)         | Concept, meaningful example, boundaries, links to actions                    |
| Reference       | [Reference](templates/reference.md)             | Scope/version, facts with conditions, limits, links to procedures            |
| Troubleshooting | [Troubleshooting](templates/troubleshooting.md) | Symptom, checks, cause where established, recovery, escalation               |

Use stable article IDs from the catalog. The publishing decision determines their
source location and URLs. Keep reader content separate from internal review evidence.
Use ordinary Markdown headings, paragraphs, lists, tables, code fences, and links.
Rendering support and any further syntax restrictions are settled in DOC-004/006.
Do not add embedded scripts, trackers, or raw interactive HTML to an article.

## Canonical content and Help

Write procedural steps once. A short Help introduction can explain why an article
is relevant to the current page; the procedure comes from the canonical article.
Shared instructions live in the subjects listed in [NAVIGATION.md](NAVIGATION.md).
Link to them rather than copying another module's steps.

Make role variants explicit. A Business User should not be told to open the Inbox;
a Contributor should not be told to use an action reserved for Member+ users. A guide may explain
why an action is unavailable without offering a bypass. Operator instructions may
contain commands and configuration names because those are the operator's controls.

Documentation search and Help do not search the organization's records or Knowledge
Items. Examples must not imply that reading an Administrator guide grants access to
Administrator settings. Audience metadata controls discovery, not app permissions.

## Examples, screenshots, and accessibility

Use fictional people and records, preferably the repeatable Helix demo dataset.
Never use a real customer's Contract, Request, email address, or credentials in an
example. Code examples use clearly identified placeholders for instance-specific
values; private keys and tokens must not appear in captures, logs, or published prose.

A screenshot is optional. Include one when layout or a visual distinction is hard
to explain in text. A useful screenshot has a specific purpose, a stable scenario,
the app build and theme recorded with its evidence, and meaningful alternative text.
Keep the steps understandable without seeing the image. Avoid text that only says
"click the red button" or relies on position alone.

Capture the real app using fictional records and the stated role. Do not create a
mock screenshot of a control that does not exist. Keep screenshots focused on the
relevant area and confirm that cropped context does not hide a prerequisite or
visibility warning. Recheck screenshots after a label, layout, or permission change.

Check heading order, descriptive links, keyboard use, zoom/narrow layouts, and Help
contrast in all three app themes. Write link labels that name the destination.
Code fences identify their language; commands must be copyable after substituting
documented placeholders. Do not put commands in images.

## Metadata and evidence

Use the catalog for stable discovery metadata. Record support and validation
information for every published article. Use the fields in
[the verification record](templates/verification.json) as the starting form.
This file is a template, not evidence that its placeholder scenario passed.

Record article ID, content hash, app source/build identity, environment, author,
technical reviewer, independent walkthrough reviewer, dates, source references,
scenarios and results, evidence locations, and limitations. Label the verification
method: source inspection, browser walkthrough, automated test, container operation,
or live-provider check. An existing feature test is supporting evidence; it does not
prove that the written steps can be followed.

The app build and content hash identify different things. Record the actual tested
app source revision and the exact article bytes. If the build includes uncommitted
app code, it is not a release-verification build. Draft content can be tested against
a committed app build, provided its hash is recorded separately. DOC-004/006 define
the build mechanism and DOC-005 defines reproducible scenarios.

The walkthrough reviewer must be independent of the author. An agent can perform
that check, but name it as an agent walkthrough. Do not call it a human user study.
Record what it actually did. A provider stand-in proves local workflow handling,
not real provider account setup or consent. A backup file alone is not a successful
restore; restored app records, files, and required encrypted configuration must work.

## State transitions and completion

| Catalogue state | Evidence required to enter it                                                            |
| --------------- | ---------------------------------------------------------------------------------------- |
| `scoped`        | Audience, intended outcome, owning task, and coverage are mapped                         |
| `ready`         | Dependencies, sources, prerequisites, and validation scenario are available              |
| `draft`         | Complete initial prose exists and the author has checked the steps                       |
| `review`        | Author checks pass and technical/independent review is underway                          |
| `verified`      | Technical review and required walkthrough scenarios pass against recorded content/build  |
| `published`     | Verified content is available through its agreed destinations and live links/search work |

The issue workflow may show more detail than these catalog states. Use GitHub as
the live scheduling record. Update article checklists individually. A group mapped
to several articles is verified only when all required articles and scenarios pass.
A writing batch PR can contain several articles, but each needs its own evidence.

Do not check a failed, skipped, or unavailable scenario as passed. Record the blocker
and retain it in the coverage report. A release exception needs a specific reason,
owner, and target plus explicit product-owner acceptance. It does not erase the
unverified requirement or make the complete-suite denominator smaller.

## Reopening and maintenance

Behaviour, permissions, prerequisites, or supported-version changes reopen affected
articles to `review`. Identify their coverage IDs in the feature issue/PR and rerun
the relevant walkthroughs before publishing updated instructions. Preserve stable
article links or add redirects when an article must move.

For a copy-only correction that changes no action, prerequisite, result, or meaning,
a reviewer may retain prior walkthrough evidence. Record that classification, the
new content hash, and the earlier evidence reference. Do not claim a fresh walkthrough
was run. Screenshots have their own build/scenario records and may need replacement
even when the text is unchanged.

The documentation lead owns consistency; feature owners own behavior accuracy;
the release maintainer owns version alignment. DOC-026 implements PR/release checks
and the ongoing review cadence. DOC-025 checks coverage and independent acceptance
before the final publication task.
