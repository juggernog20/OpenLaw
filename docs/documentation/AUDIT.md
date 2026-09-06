# Documentation release audit

Task: [#721](https://github.com/juggernog20/OpenLaw/issues/721). Date: 2026-09-07.

## Selected baseline

The documentation feature starts at `2a153fc5e768dcd92ae8309e0fe050759ec472db`, the
latest committed `origin/fix/home-all-tasks` revision when execution started. The
original checkout and its uncommitted changes remain outside this worktree. This is
a development build, not a published release. Guides will name that status until
a release version is assigned. New Help code will be verified on feature-branch
revisions that descend from this baseline.

The `dev` branch is a different line of development. Its M33 and authentication
upgrade changes are not ancestors of this baseline. Closed issues describe work
completed on their target branch, not necessarily behaviour in this checkout.
Before the documentation feature merges onward, repeat the changed-feature audit
against the destination branch and refresh affected instructions.

## Findings and dispositions

| Finding                                                                                | Evidence in the selected build                                                                                            | Disposition                                                                                                                                                                  |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M33 issues are closed, but the expanded wizard is absent here                          | `apps/web/src/routes/welcome.tsx` defines welcome, authentication, portal, email, and invites; compare closed #696 on dev | C35 documents those implemented steps and links to Settings for other setup. Do not describe a Review step or skipped-step checklist in this build. DOC-020 owns the guide.  |
| App view is in uncommitted work only                                                   | `apps/web/src/router.tsx` has profile and appearance, but no app-view route                                               | C05 uses the baseline's existing Business Portal navigation. DOC-009 must use its actual label.                                                                              |
| Matter Status work is in progress elsewhere                                            | Baseline Matter statuses use open/closed Categories                                                                       | C23/C38 use that model. DOC-016/021 must recheck after integration.                                                                                                          |
| Knowledge is implemented despite the older product scope text                          | Knowledge routes, KNW built addenda, and M28 E2E                                                                          | Include C11/C33/C34. Do not copy the old deferred claim into user guides.                                                                                                    |
| Portal intake is implemented; broader intake channels are not                          | Portal and Request routes; future-feature decisions                                                                       | Cover portal submission and Inbox disposition only. No Slack, Teams, or email-parser setup guides.                                                                           |
| Inbox assignment exists                                                                | Request assignment API and Inbox request page                                                                             | Add assignment to C12. Document the implemented Resolve outcome and requester conversation in C10/C12.                                                                       |
| Entity obligations were omitted from the initial matrix                                | `components/entities/obligations-panel.tsx`, ENT-006 and its built addendum                                               | Add C52 at P0, including filing and human-confirmed recurrence. DOC-018 owns it.                                                                                             |
| Entity share capital, Grants, chart, and linked-record roll-ups need explicit coverage | Entity record components; ENT-003/004/007                                                                                 | Add C53 at P1. DOC-018 owns it, with access review from DOC-010.                                                                                                             |
| Document permanent deletion needs its own outcome                                      | `components/documents/documents-card.tsx` implements Administrator typed confirmation                                     | Add C54 at P0 alongside archive/restore. DOC-017 owns it.                                                                                                                    |
| Help is not implemented                                                                | No Help route in the baseline route table                                                                                 | DOC-004/006/007 specify and build it. Existing `?` shortcut discovery remains.                                                                                               |
| Release and support locations are not assigned                                         | M34 release work is not completed in this branch                                                                          | Use development-version metadata and an app-bundled documentation candidate. DOC-004 decides delivery. Do not invent a production hostname or claim a tagged release exists. |

## Coverage check

The matrix now contains 54 outcome groups, including three additions from this
audit. All retain stable IDs and owning tasks. P0 has 39 groups; P1 has 15.
No implemented group has been deferred to reduce the release denominator.

The audit inspected route entries for Home/Tasks, Inbox, Contracts, Matters,
Documents/Comparison, Entities, Knowledge, search, onboarding/authentication, every
Settings child, and every Portal child. It also inspected the record component
families and relevant decision addenda for controls without their own route.
The matrix evidence index supplies module-level source links. Article work must
identify the exact actions, prerequisites, limits, and role variants it verifies.

Source inventory is complete for this task. Browser scenarios and independent
walkthroughs have not run and remain assigned to DOC-005 and the content tickets.
Provider-connected validation and the independent operator's timed install remain
explicit requirements. Simulated providers and code review alone cannot satisfy them.

## Responsibility assignments

| Work                                      | Execution owner                        | Reviewer / decision owner                                                             |
| ----------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------- |
| Inventory, article map, standards, guides | Codex                                  | Fable reviews each task; Blair owns product scope                                     |
| Help and publishing code                  | Codex                                  | CodeRabbit and Fable; Blair owns product decisions                                    |
| Role walkthroughs and evidence            | Codex executes isolated role scenarios | Fable independently checks scenario/evidence quality; do not claim a human user study |
| Deployment and recovery procedures        | Codex                                  | Fable technical review; independent operator install evidence tracked separately      |
| Final release and maintenance             | Blair as repository maintainer         | Feature deliverables and review evidence prepared by Codex                            |

The execution request authorizes routine design and implementation choices. Record
those choices in the task output and accepted decision files. Ask only when missing
external access or a material preference prevents a concrete result. No production
release, main/dev merge, or human-validation claim is implied by these assignments.

## Validation commands

Formatting and local source links were checked after importing the planning files.
`pnpm typecheck` passed across all workspace packages. The initial full test run
could not access the Docker socket because this session did not include the already
assigned docker group. Run container-backed checks in a child shell with that group:

```sh
newgrp docker <<'SH'
pnpm exec turbo run test --continue -- --maxWorkers=4
SH
```

The four-worker limit bounds concurrent test containers. This runs all package test
suites; it is not a selected-file check. Final results belong in the task PR.
CodeRabbit's attempted review disconnected with `WebSocket closed` before returning
findings. The required Fable review remains a separate pre-merge step.
