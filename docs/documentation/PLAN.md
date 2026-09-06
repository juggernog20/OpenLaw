# Documentation project plan

Status: active implementation project. Initial plan prepared 2026-09-06; execution started 2026-09-07.

Project: [#714](https://github.com/juggernog20/OpenLaw/issues/714). See the
[release audit](AUDIT.md) for the selected build and corrections to the initial inventory.

Deliver a maintained documentation suite for OpenLaw through a searchable formal
documentation site and focused in-app Help for the staff app and Business Portal.
The project covers user guides, reference, Administrator guidance, and deployment
operations. Content should let each audience complete its work independently.

This project uses the [coverage matrix](COVERAGE.md) and [GitHub backlog](BACKLOG.md).
Task IDs map to published issues. Dates remain unset until the pilot establishes effort.

## Evidence and baseline

The initial inventory was checked against the route table, module files, glossary,
decision records, deployment guide, E2E inventory, and GitHub issue status. The
checkout was on `fix/home-all-tasks`, HEAD `88e6e8bb`, with substantial uncommitted
product and UI changes. This is a source inventory, not a browser walkthrough or
certification of a released build. Capture an immutable build before guide review.

The initial inventory recorded these differences. AUDIT.md resolves them for the
selected branch; this list retains the discovery context:

- The [implementation plan](../IMPLEMENTATION-PLAN.md) marks M33 incomplete, but
  [M33 #696](https://github.com/juggernog20/OpenLaw/issues/696) and its six children
  are closed. First-run onboarding is available for validation; it is not assumed
  to be waiting for implementation.
- [PRODUCT.md](../decision-records/PRODUCT.md) still describes Knowledge as deferred
  and broader intake channels as planned. Current routes include Knowledge and the
  Business Portal. Do not convert old roadmap statements into feature claims.
- Current settings include a separate AI analysis destination (SET-008), and the
  working tree changes App view and Matter statuses. Verify final labels and paths
  before capturing screenshots.
- No Help destination appears in the inspected route table. Help delivery is
  engineering work in this project, alongside content production.
- M34 remains unchecked in the implementation plan. No M34-titled issue was found
  in the tracker query; confirm the release baseline with the release owner.
- Existing enhancement issues
  [#360](https://github.com/juggernog20/OpenLaw/issues/360) (enhanced approvals) and
  [#207](https://github.com/juggernog20/OpenLaw/issues/207) (SharePoint mirror) remain
  open. Neither is a prerequisite for documenting the implemented workflows.

## Audiences and publication

| Audience            | Intended result                                           | Principal surfaces                             |
| ------------------- | --------------------------------------------------------- | ---------------------------------------------- |
| Business User       | Submit a Request, supply information, and follow progress | Portal Help and formal guides                  |
| Contributor         | Work within access to assigned Contracts and Matters      | Staff Help and formal guides                   |
| Legal Team Member   | Manage legal work across all implemented modules          | Staff Help and formal guides                   |
| Administrator       | Configure the organisation and manage access              | Settings Help and formal administration guides |
| Deployment operator | Install, maintain, upgrade, and recover an instance       | Formal operations documentation                |

Administrator and deployment operator are separate responsibilities even if one
person performs both. Assign named authors and reviewers when tickets are scheduled;
this plan does not assume staffing that has not been agreed.

Proposed formal navigation: Start here; Business Portal; Working with Legal;
Contracts; Matters; Documents; Entities; Knowledge; Administration; Deployment and
operations; Reference and troubleshooting. Task titles lead within each section.

Maintain one canonical source for procedural steps. Help may use a curated summary
or an extract with a stable link to the complete article. Every Help topic belongs
in the full suite. OpenLaw Help remains distinct from an organisation's Knowledge
Items. Preserve the existing `?` shortcut sheet (DES-010); a new Help entry point
must be designed explicitly.

## Scope and priority

The matrix is the release coverage baseline. One row is an outcome group, not
necessarily one article. Split groups into articles during information architecture
work; retain the coverage IDs so scope remains traceable.

- **P0:** essential onboarding, daily work, access/visibility, consequential actions,
  troubleshooting, and deployment/recovery. Required for the essential-journey gate.
- **P1:** the remaining implemented module and settings coverage. Required for the
  complete-suite gate; lower priority does not mean optional.
- **P2:** explicitly deferred expansion, outside the first complete-suite denominator.

Proposed P2 exclusions: multilingual editions beyond en-US, video courses, an AI
support assistant, interactive product tours, a full developer/contributor manual,
and a hand-authored API endpoint reference. Record existing OpenAPI and development
material as future inputs. Unsupported future features are excluded, including
ChatOps/email intake guides, enhanced approvals, and the SharePoint mirror.

## Delivery gates and order

| Gate                             | Demonstrable result                                                                                                                                                  | Required work                                            |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| G1 — Scope and design ready      | Every supported surface has coverage; audiences, navigation, publishing requirements, owners, and validation scenarios are agreed                                    | DOC-001–005                                              |
| G2 — Pilot verified              | An Administrator configures a request form, a Business User submits it, and Legal converts it to a Contract using guides discoverable from both publication surfaces | DOC-006–008                                              |
| G3 — Essential journeys verified | Each of the four app roles completes its P0 work; an operator completes the P0 operations scenarios                                                                  | All P0 content tickets, DOC-024, and DOC-025's P0 review |
| G4 — Complete suite released     | All P0/P1 coverage passes review against the target build and can be found from its agreed destinations                                                              | Remaining content, DOC-025/026, and DOC-027              |

Sequence: scope → information architecture and standards → publishing decision and
validation setup → publishing/Help foundations → pilot → content batches → release
validation. Foundations and content preparation may overlap once their dependencies
are resolved. Pilot articles count toward coverage and are extended in their owning
content tickets; do not create duplicate guides.

Estimate after G1 identifies article count and G2 measures effort. Record authoring,
technical review, walkthrough, revision, and integration effort separately; schedule
using reviewer capacity as well as writing capacity. Commit dates only after naming
owners, choosing the target release, and sizing the remaining backlog.

## Ownership and tracking

| Responsibility                                        | Accountable role                            |
| ----------------------------------------------------- | ------------------------------------------- |
| Scope, priority, release exceptions                   | Product owner                               |
| Inventory, navigation, terminology, editorial quality | Documentation lead                          |
| Behaviour and permission accuracy                     | Feature owner                               |
| Site, Help, search, links, version handling           | Web/platform engineer                       |
| Installation and restore validation                   | Deployment maintainer                       |
| Independent task walkthrough                          | Reviewer representing the intended audience |

The same person may cover several roles, but the walkthrough reviewer should not be
the procedural guide's author. Product owner and documentation lead review progress
weekly and before each gate, focusing on blocked coverage and verification failures.

Use one GitHub umbrella issue, six workstream parents, and the bounded tasks in the
backlog. Preserve local IDs when publishing and add issue links back to the matrix.
Reuse `documentation` and the repository's canonical triage labels. Future proposals
start at `needs-triage`; use `ready-for-agent` only after scope and dependencies are
resolved. GitHub assignments identify named owners; issue dependencies identify
blocking work. A Project board is optional, not a dependency.

Content lifecycle: Scoped → Ready → Draft → Product review → Walkthrough verified
→ Published. Reopen affected coverage when behaviour changes. A merged content PR
alone is not evidence of successful publication or walkthrough verification.

## Definition of done

Every procedural guide must have an audience, role/access prerequisites, expected
outcome, exact UI terminology, applicable configuration, and a supported app version.
It must explain important alternate outcomes and link to relevant recovery guidance.
Reference articles must identify the corresponding implemented behaviour and limits.

Before publication, record technical reviewer, independent walkthrough reviewer,
build/tag or commit, validation date, scenario result, and unresolved limitations.
Use repeatable fictional demo data, with separate role accounts. Screenshots are
optional where text is sufficient; when used, record their scenario/build and provide
useful alternative text. No real customer records or credentials belong in examples.

Check internal and external links, Help-to-article mappings, search discovery, keyboard
navigation, small screens, and the three app themes for embedded Help. Operations
guides need actual disposable-environment installation, upgrade, and restore evidence.
Reuse existing feature tests as supporting evidence; they do not replace following
the guide. Any behaviour/decision discrepancy blocks the affected instructions until
the feature owner resolves it.

## Publication decisions to settle in G1

DOC-004 should produce a concrete recommendation for the publishing stack, site
location/domain, canonical content format, build/deployment ownership, and app Help
presentation. Evaluate requirements before selecting products.

Decide whether Help must work without internet access, how self-hosted operators
serve the full suite, which docs version an older app links to, and what happens when
the external site is unavailable. Define public/signed-in access, audience-based
navigation, search boundaries, and the route/topic mapping. Help discovery must not
index an organisation's records or Knowledge content. Defer analytics unless useful
feedback cannot be collected through the agreed support channel.

## Maintenance and measures

DOC-026 adds a documentation-impact question to feature PR/release work, mapping
changed behaviour to coverage IDs. Update affected articles in the same release,
retain or redirect stable links, and record the version last verified. Review P0
content for every release and the full inventory each quarter while release cadence
is unsettled.

Gate measures: 100% of P0 coverage verified for G3; 100% of P0/P1 verified for G4;
zero unresolved broken internal links or Help mappings; no unresolved walkthrough
failure on a required scenario. Explicit deferrals need a reason, owner, and future
target and must remain visible in the denominator/report.

After launch, track recurring unanswered questions and search failures when an
approved feedback mechanism exists. Count task success and coverage, not article
volume. Baseline actual reader performance during the pilot before setting time-to-
answer targets.
