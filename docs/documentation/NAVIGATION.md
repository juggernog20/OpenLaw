# Article structure and Help mapping

Task: [#722](https://github.com/juggernog20/OpenLaw/issues/722).
Baseline: the [release audit](AUDIT.md). Status: article map ready for the publishing
design and pilot. This is not a claim that articles or Help pages are published.

## Catalogue

[articles.json](articles.json) maps all 55 coverage groups to 56 planned articles in
11 sections. Manual signature hand-off and electronic signing have separate articles
because they have different prerequisites. Together they cover C17. Other groups
currently have one article each; the pilot may justify splitting longer groups.

Each article has a stable ID, task-oriented title, section, content kind, audience,
publication destinations, priority, coverage IDs, owning task, and contextual Help
keys. IDs become canonical slugs. A later title change must not change its slug.
The publishing design owns the final URL structure and rendering format.

The coverage table names the article IDs for each row. Article entries are the
independently reviewable children of their owning writing batch. Track these child
deliverables as article checklists in their batch issue. Split out an article issue
when it needs a different owner or dependency. The batch retains its coverage gate
and is complete only when every article is verified. The catalogue supplies each
child's title, audience, source coverage, and destinations.

Do not change all articles to Published when their batch merges. Each article keeps
its own content and validation status. Both C17 articles must pass before C17 counts
as verified. The same rule applies when a future group spans several articles.

## Formal navigation

| Section                       | Reader's reason to open it                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Start here                    | Set up an account, find work, search, and change personal preferences                                      |
| Business Portal               | Sign in, submit a Request, follow it, and read shared Knowledge                                            |
| Working with Legal            | Understand access, contribute to shared work, comment, handle notifications, and triage Requests           |
| Contracts                     | Create and progress a Contract through approval, signature, analysis, term management, and end of life     |
| Matters                       | Create and manage a Matter and its work                                                                    |
| Documents                     | Upload, organise, read, compare, archive, and delete Documents                                             |
| Entities                      | Maintain our corporate records, structure, obligations, and access                                         |
| Knowledge                     | Create and publish the organisation's Knowledge Items                                                      |
| Administration                | Configure the organisation, people, taxonomies, forms, and the optional Signing connector and AI connector |
| Deployment and operations     | Install, configure, upgrade, recover, and diagnose an instance                                             |
| Reference and troubleshooting | Look up unfamiliar terms or resolve a problem                                                              |

Keep the full table of contents available. Role-specific starting paths help a
reader choose where to begin; they are not a substitute for the complete index.
Administrator instructions describe product configuration, not organisation secrets.
Documentation audience filtering is a discovery aid and must not be treated as an
authorisation boundary.

## Role starting paths

| Reader              | First article    | Common next articles                                                                    |
| ------------------- | ---------------- | --------------------------------------------------------------------------------------- |
| Business User       | `portal-sign-in` | `submit-request`, `follow-request`, `portal-knowledge`                                  |
| Contributor         | `staff-sign-in`  | `contributor-guide`, `roles-and-access`, `comments-and-activity`, `document-versions`   |
| Legal Team Member   | `staff-sign-in`  | `find-your-work`, `triage-requests`, `create-contract`, `create-matter`                 |
| Administrator       | `first-run`      | `organisation-and-users`, `authentication-and-email`, `request-forms`                   |
| Deployment operator | `install`        | `deployment-configuration`, `upgrade`, `backup-and-restore`, `operator-troubleshooting` |

An Administrator may also need every Legal Team Member workflow. A deployment
operator may have no app account. Portal readers should find their answers without
opening staff-only application pages. The formal documentation's access policy is
settled in DOC-004; links to app actions must still respect the app's own guards.

## In-app Help

Staff Help offers the user's starting path, article discovery, and links to the
complete suite. Business Portal Help starts with portal tasks and shared subjects
such as comments, file previews, notifications, and access problems.

Context keys in the catalogue identify the place where an answer is useful. They
are product concepts, not new app routes. For example, `contracts.signing` maps to
both signing articles, `inbox.convert` maps to conversion guidance, and
`settings.intake` maps to request configuration. DOC-004/007 connect these keys to
actual buttons, page links, or record sections. A key may have several articles.

The current metadata is an inventory of useful entry points. It does not require
putting a Help button beside every Field. Start with a discoverable Help section in
each shell and contextual links for the pilot. Add other links where they reduce
search effort without crowding the task. Every contextual link must resolve to a
registered article and have a general Help fallback if its context is unavailable.

Retain `/`, Escape, and `?` as specified by the current shortcut contract. In
particular, `?` continues to open keyboard shortcuts. The Knowledge destination
continues to hold organisation-authored Knowledge Items, not this product manual.

## Canonical shared instructions

| Subject                                  | Canonical article                         | Other guides link here for details                          |
| ---------------------------------------- | ----------------------------------------- | ----------------------------------------------------------- |
| Roles and confidential reach             | `roles-and-access`                        | Module, Contributor, and unavailable-record guides          |
| Visibility tiers and paper on comments   | `comments-and-activity`                   | Portal, triage, Contract, and Matter guides                 |
| Notifications                            | `notifications`                           | Task, date, approval, portal, and Entity obligation guides  |
| Document Versions                        | `document-versions`                       | Contract, Matter, Entity, Knowledge, and signing guides     |
| File reading and processing              | `document-previews`                       | Upload, Comparison, portal, and troubleshooting guides      |
| Signing connector and AI connector setup | `configure-signing`, `configure-analysis` | User signing and analysis guides                            |
| Deployment configuration                 | `deployment-configuration`                | First-run, authentication, email, and provider setup guides |

A module guide explains the relevant outcome and links to shared steps. Help may
display a task summary, selected canonical sections, or the full article. It must
not maintain a second copy of the procedure. Article type is independent of length:
how-to articles lead with a task; explanations establish concepts; references list
facts; troubleshooting starts with symptoms and points to a verified resolution.

## Navigation walkthrough

This is a desk walkthrough of the proposed structure, not a browser usability study.
The checks below establish that the planned routes to answers exist in the catalogue.
DOC-008 and DOC-025 must test real discovery after Help and articles exist.

| Reader and question                                         | Proposed path                                                                         | Catalogue check                                                                           |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Business User: how do I ask Legal to review a document?     | Portal Help → Submit a Request to Legal → full article                                | `submit-request` includes Business User, portal Help, formal docs, and C09                |
| Contributor: why can I comment but not send for signature?  | Staff Help → Work on a shared Contract or Matter → Understand roles and record access | Both articles include Contributor and staff Help; signing stays a separate Legal workflow |
| Legal Team Member: what happens when I convert a Request?   | Inbox conversion Help → Convert a Request to a Contract or Matter                     | `inbox.convert` maps to C13; requester follow-up links to C10                             |
| Administrator: where do I change the request form?          | Administration → Configure request types and forms                                    | `request-forms` includes Administrator, Settings context, and C40                         |
| Operator: how do I recover the database and uploaded files? | Deployment and operations → Back up and restore OpenLaw                               | `backup-and-restore` includes operator and formal docs, independent of staff Help         |

All five paths resolve in the proposed catalogue. Use the role name Contributor
throughout and keep app Knowledge distinct from Help in editorial review. Search
synonyms such as "request form", "can't access", and "restore files" should be
checked during the pilot; they are not evidence that a search implementation
already exists.

## Validation and hand-off

The catalogue was checked for unique IDs, existing section IDs, valid coverage IDs,
complete coverage, owning-task consistency, and destination/audience mappings from
the matrix. Every Help article also targets formal documentation. Operator-only
articles have no staff or portal context keys. No user guide content was written
for this task.

DOC-003 defines the author/reviewer template. DOC-004 resolves rendering, search,
URLs, access, and version policy. DOC-006 makes the catalogue buildable. DOC-008
tests `request-forms`, `submit-request`, `triage-requests`, and `convert-request` as
one connected pilot before the remaining writing batches start.
