# GitHub implementation backlog

Execution project: [#714](https://github.com/juggernog20/OpenLaw/issues/714). See the
[plan](PLAN.md) for gates and the [matrix](COVERAGE.md) for coverage IDs and sources.
The linked issues below track task status. The task headings retain stable planning IDs.

## Published task links

- [DOC-001 #721](https://github.com/juggernog20/OpenLaw/issues/721): Reconcile the coverage inventory to a target release
- [DOC-002 #722](https://github.com/juggernog20/OpenLaw/issues/722): Define article structure and Help topic mapping
- [DOC-003 #723](https://github.com/juggernog20/OpenLaw/issues/723): Establish content and review standards
- [DOC-004 #724](https://github.com/juggernog20/OpenLaw/issues/724): Specify publishing, versioning, and Help behaviour
- [DOC-005 #725](https://github.com/juggernog20/OpenLaw/issues/725): Prepare demo data and verification scenarios
- [DOC-006 #726](https://github.com/juggernog20/OpenLaw/issues/726): Build the canonical documentation publishing path
- [DOC-007 #727](https://github.com/juggernog20/OpenLaw/issues/727): Add staff and Business Portal Help entry points
- [DOC-008 #728](https://github.com/juggernog20/OpenLaw/issues/728): Author and validate the intake pilot across both surfaces
- [DOC-009 #729](https://github.com/juggernog20/OpenLaw/issues/729): Account access, navigation, search, and personal settings
- [DOC-010 #730](https://github.com/juggernog20/OpenLaw/issues/730): Roles, confidential access, and Contributor work
- [DOC-011 #731](https://github.com/juggernog20/OpenLaw/issues/731): Conversations, activity, and notifications
- [DOC-012 #732](https://github.com/juggernog20/OpenLaw/issues/732): Complete Business Portal guides
- [DOC-013 #733](https://github.com/juggernog20/OpenLaw/issues/733): Complete Inbox and conversion guides
- [DOC-014 #734](https://github.com/juggernog20/OpenLaw/issues/734): Contract lifecycle guides
- [DOC-015 #735](https://github.com/juggernog20/OpenLaw/issues/735): Analysis and Document Comparison guides
- [DOC-016 #736](https://github.com/juggernog20/OpenLaw/issues/736): Matter work guides
- [DOC-017 #737](https://github.com/juggernog20/OpenLaw/issues/737): Document handling and repository guides
- [DOC-018 #738](https://github.com/juggernog20/OpenLaw/issues/738): Entity and Counterparty guides
- [DOC-019 #739](https://github.com/juggernog20/OpenLaw/issues/739): Knowledge authoring, publishing, and audience guides
- [DOC-020 #740](https://github.com/juggernog20/OpenLaw/issues/740): First-run, users, authentication, and email administration
- [DOC-021 #741](https://github.com/juggernog20/OpenLaw/issues/741): Taxonomies, Fields, templates, intake, and reminder administration
- [DOC-022 #742](https://github.com/juggernog20/OpenLaw/issues/742): E-signature and AI analysis configuration guides
- [DOC-023 #743](https://github.com/juggernog20/OpenLaw/issues/743): Consolidate and validate deployment operations
- [DOC-024 #744](https://github.com/juggernog20/OpenLaw/issues/744): Troubleshooting, reference, versions, and support navigation
- [DOC-025 #745](https://github.com/juggernog20/OpenLaw/issues/745): Run independent coverage and findability acceptance
- [DOC-026 #746](https://github.com/juggernog20/OpenLaw/issues/746): Establish release maintenance and ownership
- [DOC-027 #747](https://github.com/juggernog20/OpenLaw/issues/747): Publish the complete suite and verify the release

## Umbrella and workstream parents

Proposed umbrella title: **Documentation — complete user guides, in-app Help, and
formal documentation**.

Umbrella outcome: people in each OpenLaw role can complete the matrix's workflows
using Help and formal documentation for their app version, and operators can deploy,
upgrade, and recover an instance. Completion requires G4, not merely merged articles.

| Parent ID / proposed title                                | Child tasks          | Accountable role                           | Completion                                                                       |
| --------------------------------------------------------- | -------------------- | ------------------------------------------ | -------------------------------------------------------------------------------- |
| DOC-E1 — Scope, inventory, and release baseline           | DOC-001              | Documentation lead + product owner         | Coverage, release baseline, exclusions, and responsibility assignments agreed    |
| DOC-E2 — Navigation and editorial standards               | DOC-002–003          | Documentation lead                         | Article map and author/reviewer standards agreed                                 |
| DOC-E3 — Publishing and Help delivery                     | DOC-004, DOC-006–007 | Web/platform engineer                      | Canonical content reaches both surfaces and version/access behaviour is verified |
| DOC-E4 — Pilot and core user journeys                     | DOC-008–017          | Documentation lead + feature owners        | Pilot and allocated coverage verified; P0 subset passes by G3                    |
| DOC-E5 — Complete modules, administration, and operations | DOC-018–024          | Documentation lead + deployment maintainer | Allocated P0/P1 coverage verified; existing deployment material consolidated     |
| DOC-E6 — Verification, maintenance, and release           | DOC-005, DOC-025–027 | Documentation lead + release owner         | All gate evidence recorded; publication and future ownership established         |

When publishing, create/link the umbrella and workstream parents first, then children
with their dependency links. Use `documentation` on all issues and `enhancement` on
Help/publishing implementation where appropriate. Proposed issues start at
`needs-triage`; do not mark downstream work ready until its dependencies are met.
G1–G4 may be tracker milestones if useful; no dates are proposed yet.

Each content task below is an authoring batch with explicit coverage. At G1, split
any batch that needs more than three independently reviewable guides into article
children, keeping the batch as their parent and retaining coverage IDs. Estimate
article children after the pilot. This avoids treating a whole module as one writing
assignment while leaving final article boundaries to the navigation work.

## Required issue fields

Every published task carries: outcome; parent workstream; coverage IDs; audience;
destinations; priority/gate; source evidence; prerequisites; dependencies; named
author/implementer and technical/walkthrough reviewers; acceptance checklist; and
verification build/date/results. Use matrix values for audience, destinations,
priority, and source evidence rather than making conflicting copies of them.

All content batches inherit the plan's definition of done. They depend on DOC-008's
pilot findings before bulk authoring. DOC-025 reviews completed batches incrementally;
it does not postpone all review until the end. A P1 row in a mixed batch is required
for G4 even if that batch's P0 rows have passed G3.

## DOC-001 — Reconcile the coverage inventory to a target release

Owner: documentation lead; reviewer: product owner. Parent: DOC-E1. Gate: G1.
Dependencies: none. Coverage: C01–C54, audit only.

- [ ] Select and record the app build/release baseline and compare its reachable
      routes, dialogs, settings, and role-specific surfaces with every matrix row.
- [ ] Resolve the recorded M33, Knowledge, intake-channel, App view, Matter Status,
      and release-status discrepancies; link evidence and record active UI churn.
- [ ] Confirm scope/exclusions, name workstream owners and reviewers, identify
      missing workflows, and retain reasons/targets for any proposed deferrals.

## DOC-002 — Define article structure and Help topic mapping

Owner: documentation lead; reviewer: product/design owner. Parent: DOC-E2. Gate: G1.
Dependencies: DOC-001. Coverage: C01–C54, mapping only.

- [ ] Produce navigation and article IDs/slugs around tasks; map every coverage row
      to articles and every planned Help entry to canonical content.
- [ ] Identify which material is a guide, explanation, reference, or troubleshooting
      article; define shared material so related modules link to one procedure.
- [ ] Walk representative readers through finding a portal, Contributor, Legal,
      Administrator, and operator answer; resolve gaps and separate Help from Knowledge.

## DOC-003 — Establish content and review standards

Owner: documentation lead; reviewer: product owner. Parent: DOC-E2. Gate: G1.
Dependencies: DOC-001; coordinate with DOC-002.

- [ ] Define short templates for task guides, explanations, reference, and
      troubleshooting, including prerequisites, expected outcome, and recovery links.
- [ ] Adopt CONTEXT.md vocabulary and actual UI labels; specify en-US conventions,
      screenshot/alt-text rules, fictional example data, and supported-build metadata.
- [ ] Define technical review and independent walkthrough evidence, issue lifecycle,
      and how changed behaviour reopens previously verified content.

## DOC-004 — Specify publishing, versioning, and Help behaviour

Owner: web/platform engineer; reviewers: documentation lead and product owner.
Parent: DOC-E3. Gate: G1. Dependencies: DOC-002–003.

- [ ] Recommend a concrete content format, publishing stack, hosting/domain strategy,
      build owner, and search approach against requirements and maintenance effort.
- [ ] Settle public/signed-in access, self-hosted/offline requirements, older app
      versions, external-site failure behaviour, stable links/redirects, and support links.
- [ ] Specify staff/portal Help presentation, topic mappings, keyboard/mobile behaviour,
      and the boundary excluding organisation records from documentation search;
      preserve the existing shortcut sheet. Record accepted product/design/technical
      decisions in the repository's established decision files when settled.

## DOC-005 — Prepare demo data and verification scenarios

Owner: documentation lead; reviewers: QA/feature owners and deployment maintainer.
Parent: DOC-E6. Gate: G1. Dependencies: DOC-001–003.

- [ ] Specify a repeatable demo environment using fictional records and separate
      Administrator, Legal Team Member, Contributor, and Business User accounts;
      use the existing seed as an input, with an isolated disposable instance.
- [ ] Map coverage to scenarios with prerequisites and expected results, including
      visibility boundaries, unavailable integrations, failed processing, and recovery.
- [ ] Define screenshot capture and evidence recording plus disposable installation,
      populated-upgrade, and restore scenarios. Distinguish provider stand-ins from
      real connector-setup validation; do not treat a simulated connection as proof
      that provider configuration instructions work.

## DOC-006 — Build the canonical documentation publishing path

Owner: web/platform engineer; reviewer: documentation lead. Parent: DOC-E3. Gate: G2.
Dependencies: DOC-004–005.

- [ ] Build the agreed content collection, navigation, preview, and publication path
      with validation fixtures; verify headings, metadata, links, and search indexing.
- [ ] Demonstrate one canonical procedure feeding the formal article and selected
      Help content without separately maintained procedural copies.
- [ ] Exercise version routing, deployment ownership, redirects, accessibility, and
      the agreed self-hosted/offline policy. Provide a preview for pilot review.

## DOC-007 — Add staff and Business Portal Help entry points

Owner: web engineer; reviewers: product/design owner and documentation lead.
Parent: DOC-E3. Gate: G2. Dependencies: DOC-006.

- [ ] Implement the agreed Help destination and contextual entry points for both
      shells, with topic discovery, audience-appropriate navigation, and full-guide links.
- [ ] Verify topic mappings, focus/keyboard behaviour, narrow layouts, and all three
      app themes; preserve `?` shortcut discovery and keep Knowledge distinct.
- [ ] Verify version selection, unauthorised/unavailable states, external-site failure
      behaviour, and the agreed search boundary using representative content fixtures.

## DOC-008 — Author and validate the intake pilot across both surfaces

Owner: documentation lead; reviewers: intake feature owner and independent role users.
Parent: DOC-E4. Gate: G2. Dependencies: DOC-003, DOC-005–007.
Coverage: pilot subsets of C40, C09, C12, C13.

- [ ] Produce the linked pilot guides: configure a request form and Contract target;
      submit a Request with paper; triage and convert it to a Contract.
- [ ] Follow the instructions as Administrator, Business User, and Legal Team Member;
      verify collected values, paper, and conversation reach their expected destination.
- [ ] Check discovery in Help and formal docs, record effort/rework/findability,
      revise the templates and estimate remaining work. Pass article ownership to
      DOC-012/013/021; leave untested variants explicitly unverified.

## DOC-009 — Account access, navigation, search, and personal settings

Owner: documentation author; reviewers: auth/shell owners and audience representative.
Parent: DOC-E4. Gates: G3/G4 by row. Dependencies: DOC-008.
Coverage: C01–C05.

- [ ] Cover staff invitation/sign-in and portal entry separately, including two-factor
      setup, expired links, and the configured authentication mode.
- [ ] Verify Home, all Tasks, record navigation, search/text hits, list views, and
      shortcuts with roles whose visible work differs.
- [ ] Verify profile/session preferences and final App view labels against the
      selected build; link notification preferences to DOC-011's canonical guidance.

## DOC-010 — Roles, confidential access, and Contributor work

Owner: documentation author; reviewer: access-control feature owner and Contributor.
Parent: DOC-E4. Gate: G3. Dependencies: DOC-008. Coverage: C06, C25.

- [ ] Explain the difference between role permissions and record reach, including
      Administrator access and Contributor team membership.
- [ ] Validate permitted Contributor Fields, supporting Documents, and conversation
      actions on a reached Contract and Matter, plus unavailable legal actions.
- [ ] Verify missing/restricted record examples and portal boundaries with separate
      accounts; provide role-specific Help extracts from canonical access guidance.

## DOC-011 — Conversations, activity, and notifications

Owner: documentation author; reviewers: comments/notification owners and role users.
Parent: DOC-E4. Gate: G3. Dependencies: DOC-008; coordinate with DOC-010.
Coverage: C07–C08.

- [ ] Verify visibility tiers, mentions, edit/delete behaviour, paper on comments,
      and activity reading across staff, Contributor, and requester views.
- [ ] Explain bell/email preferences, direct asks and scheduled reminders using
      actual trigger/recipient rules and personal timezones where applicable.
- [ ] Follow a notification into the correct record/Request and test troubleshooting
      paths for missing access or delivery; link Administrator lead-time configuration.

## DOC-012 — Complete Business Portal guides

Owner: documentation author; reviewers: portal feature owner and Business User.
Parent: DOC-E4. Gates: G3/G4 by row. Dependencies: DOC-008.
Coverage: C09–C11.

- [ ] Extend the pilot with form validation, attachments, progress states, and
      responding to Legal before and after Request conversion.
- [ ] Verify the requester view for Contract and Matter conversion, Resolve, and
      Decline, including further paper and conversation boundaries.
- [ ] Cover available Knowledge guidance and portal settings through canonical links;
      validate the portal's complete Help path without assuming staff access.

## DOC-013 — Complete Inbox and conversion guides

Owner: documentation author; reviewer: intake owner and Legal Team Member.
Parent: DOC-E4. Gate: G3. Dependencies: DOC-008. Coverage: C12–C13.

- [ ] Extend the pilot across Convert, Resolve, and Decline with their visible outcomes.
- [ ] Verify Contract and Matter conversion, required-field gaps, unavailable configured
      values, applicable templates, and the fate of collected values and paper.
- [ ] Explain the retained requester conversation/access and verify results from
      both sides; cross-link requester guidance and configuration prerequisites.

## DOC-014 — Contract lifecycle guides

Owner: documentation author; reviewers: Contract/signing owners and Legal Team Member.
Parent: DOC-E4. Gates: G3/G4 by row. Dependencies: DOC-008.
Coverage: C14–C20. Split into article children in DOC-002 before scheduling.

- [ ] Verify creation, Owner/team, Entity/Counterparties, Fields, Stage/Status
      progression, approvals, and the advisory sign-off gate; exclude enhanced approvals.
- [ ] Walk manual hand-off and configured e-signature through their distinct outcomes,
      including withdrawal/decline and the executed Document; link connector setup.
- [ ] Verify term/notice/renewal scenarios, Tasks/Key dates, relations, and end/archive/
      restore distinctions. Each article records its own scenario and build evidence.

## DOC-015 — Analysis and Document Comparison guides

Owner: documentation author; reviewers: analysis/Comparison owners and Legal user.
Parent: DOC-E4. Gates: G3/G4 by row. Dependencies: DOC-008.
Coverage: C21, C29.

- [ ] Verify Analysis run prerequisites, triggering/reruns, evidence, individual
      Unverified value confirmation/editing, failures, and operational effects of values.
- [ ] Walk supported Word and text Comparisons, operand selection, reading changes,
      and Generated redline export; verify permissions and unsupported-format outcomes.
- [ ] Link provider configuration, processing troubleshooting, and Document Versions;
      keep analysis and Comparison as distinct tasks with separately verified articles.

## DOC-016 — Matter work guides

Owner: documentation author; reviewer: Matter owner and Legal Team Member.
Parent: DOC-E4. Gates: G3/G4 by row. Dependencies: DOC-008.
Coverage: C22–C24.

- [ ] Verify direct/template creation, Matter Manager/team, required Fields, and
      references to intake-created Matters.
- [ ] Verify the release's actual Status model, closing behaviour, archive and restore;
      replace any pre-change assumptions from the working-tree inventory.
- [ ] Walk Tasks, Key dates, Matter relationships, linked Contracts, and relative
      template content; link shared Document and Contributor guidance.

## DOC-017 — Document handling and repository guides

Owner: documentation author; reviewers: Document owner and permitted role users.
Parent: DOC-E4. Gates: G3/G4 by row. Dependencies: DOC-008.
Coverage: C26–C28, C30, C54.

- [ ] Verify upload, new Versions and kinds, executed-file behaviour, and filing paper
      from a conversation; keep requester attachments distinct from managed Documents.
- [ ] Walk folders/bulk upload, supported previews/downloads, processing/OCR failure,
      and partial upload recovery with appropriate permission variants.
- [ ] Verify the central repository's current ownership scope, filters, and Version
      landing behaviour; link Comparison rather than duplicate its instructions.

## DOC-018 — Entity and Counterparty guides

Owner: documentation author; reviewer: Entity owner and Legal Team Member.
Parent: DOC-E5. Gate: G4. Dependencies: DOC-008. Coverage: C31–C32, C52–C53.

- [ ] Verify creating and maintaining our Entities, and selecting/maintaining external
      Counterparties through the actual picker surfaces.
- [ ] Walk Holdings, Officers, Registrations, and Entity-owned Documents with their
      actual relationship and permission rules.
- [ ] Verify archive/restore and in-use restrictions; link configurable types/Officer
      roles and shared Documents guidance and verify the implemented Entity obligations calendar separately from Matter dates.

## DOC-019 — Knowledge authoring, publishing, and audience guides

Owner: documentation author; reviewers: Knowledge owner, Legal and Business users.
Parent: DOC-E5. Gates: G3/G4 by row. Dependencies: DOC-008.
Coverage: C33–C34.

- [ ] Verify file-first and guidance authoring, primary/supporting Documents, folders,
      and item types against the built Knowledge model.
- [ ] Walk publication, unpublication, archive/restore, and portal audience changes;
      check item and file access from both staff and Business Portal accounts.
- [ ] Link portal guidance and intake deflection configuration; clearly distinguish
      organisation-authored Knowledge Items from OpenLaw product Help.

## DOC-020 — First-run, users, authentication, and email administration

Owner: documentation author; reviewers: auth/settings owner and Administrator.
Parent: DOC-E5. Gate: G3. Dependencies: DOC-008. Coverage: C35–C37.

- [ ] Walk the selected baseline first-run wizard on a fresh instance and use Settings
      for remaining configuration. The expanded M33 wizard/checklist exists on dev
      but is absent from this baseline; document only implemented steps and recheck
      onboarding before the documentation feature merges onto a different baseline.
- [ ] Verify organisation settings, invitations, role changes, session revocation,
      user archive/reassignment, and last-Administrator restrictions.
- [ ] Walk supported authentication/domain/email configuration and environment
      precedence; link operator configuration and connector articles as prerequisites.

## DOC-021 — Taxonomies, Fields, templates, intake, and reminder administration

Owner: documentation author; reviewers: module/settings owners and Administrator.
Parent: DOC-E5. Gates: G3/G4 by row. Dependencies: DOC-008.
Coverage: C38–C41. Split into article children in DOC-002 before scheduling.

- [ ] Verify types, Statuses, Fields and requiredness, Officer roles, rename/reorder/
      archive restrictions, and retained values using the release's actual settings.
- [ ] Verify Matter template defaults/relative content; extend the intake pilot to
      remaining target/form variants, Knowledge/external guidance, and conversion gaps.
- [ ] Verify organisation reminder settings and audit-log access/filtering; cross-link
      personal notifications and preserve separate user versus Administrator instructions.

## DOC-022 — E-signature and AI analysis configuration guides

Owner: documentation author; reviewers: connector owners and Administrator/operator.
Parent: DOC-E5. Gate: G3. Dependencies: DOC-008. Coverage: C42–C43.

- [ ] Verify e-signature setup, connection checks, callbacks, disabling, and failure
      recovery against the supported provider/configuration; explain manual optionality.
- [ ] Verify AI provider setup, Field prompts, connection/failure behaviour, disabling,
      and actual provider data flow; use the separate AI analysis Settings destination.
- [ ] Record validation with appropriate provider test accounts and current primary
      provider instructions when writing. Link user workflows and operator secrets
      guidance; do not publish working credentials or unsupported privacy claims.

## DOC-023 — Consolidate and validate deployment operations

Owner: documentation author/deployment maintainer; reviewer: independent operator.
Parent: DOC-E5. Gate: G3. Dependencies: DOC-008; coordinate with DOC-020/022.
Coverage: C44–C48. Split into install/configure, upgrade, restore, and diagnostics children.

- [ ] Inventory and reuse README/DEPLOYMENT.md material in the canonical suite with
      stable links; verify production configuration and a clean installation, timed
      against M34's under-an-hour goal by someone other than the author.
- [ ] Perform a populated upgrade and an isolated restore of database, stored files,
      and required secrets; verify login, records, downloads, and credential decryption.
      State supported recovery procedures without promising an untested downgrade.
- [ ] Validate selected startup/migration/email/storage/processing/worker diagnostics;
      distinguish runtime Administrator settings from deployment-owned configuration.

## DOC-024 — Troubleshooting, reference, versions, and support navigation

Owner: documentation author; reviewers: relevant feature owners and role users.
Parent: DOC-E5. Gates: G3/G4 by row. Dependencies: DOC-008; consume DOC-009–023
findings as batches complete. Coverage: C49–C51.

- [ ] Build symptom-led troubleshooting with checks, recovery, and escalation for
      each audience; link canonical module instructions rather than repeat them.
- [ ] Assemble the glossary and permissions/configuration/file-behaviour references
      from verified articles and source constants, with feature-owner review.
- [ ] Make app/docs version, known limitations, and the agreed reporting/support route
      discoverable on both surfaces; test representative queries and Help links.

## DOC-025 — Run independent coverage and findability acceptance

Owner: documentation lead; reviewers: independent role users and deployment maintainer.
Parent: DOC-E6. Gates: G3 and G4. Dependencies: DOC-005/008 and each reviewed batch;
P0 closure requires all P0 batch portions; final closure requires DOC-009–024 complete.
Coverage: C01–C54, independent verification.

- [ ] Follow every required procedural scenario as the stated role on the recorded
      build and review references; record failures against coverage IDs and retest fixes.
- [ ] Verify Help/site discovery, links, search, keyboard use, mobile layouts, theme
      compatibility, and version selection, including portal/Contributor boundaries.
- [ ] Produce separate G3 and G4 reports with coverage counts, evidence, explicit
      deferrals, and remaining failures; do not equate existing feature tests with
      proof that a reader can follow the instructions.

## DOC-026 — Establish release maintenance and ownership

Owner: documentation lead; reviewers: product owner and release maintainer.
Parent: DOC-E6. Gate: G4. Dependencies: DOC-003–004, DOC-008.

- [ ] Add documentation-impact handling to feature PR/release work, including affected
      coverage IDs, expected article updates, and reasoned no-impact outcomes.
- [ ] Assign ongoing owners and review cadence; define version metadata, redirects,
      screenshot refresh, stale-content handling, and retirement of unsupported versions.
- [ ] Define a lightweight feedback/reporting and coverage dashboard process; set
      reader-performance targets from pilot evidence and avoid unapproved telemetry.

## DOC-027 — Publish the complete suite and verify the release

Owner: release maintainer; reviewers: documentation lead and product owner.
Parent: DOC-E6. Gate: G4. Dependencies: DOC-025–026 and resolved target-release details.

- [ ] Publish reviewed content for the chosen app version using DOC-006's process and
      verify actual live Help links, site navigation, search, and operator access.
- [ ] Record final coverage, any explicitly accepted release exceptions, version/build,
      publication locations, maintenance owners, and release evidence in the umbrella.
- [ ] Confirm that a clean install links to its applicable docs, that supported older
      links behave as designed, and that published pages contain no draft placeholders.

## Proposed first scheduling batch

Schedule DOC-001 first. Then DOC-002 and DOC-003 can proceed together; DOC-004 and
DOC-005 follow their respective inputs. Review G1 before scheduling infrastructure
and the pilot. These five tickets prepare the project before guide writing. Execution continues
through the remaining tickets as their dependencies and gate evidence are satisfied.
