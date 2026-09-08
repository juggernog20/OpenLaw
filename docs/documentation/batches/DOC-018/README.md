# Entity guide verification

C31, C32, C52, and C53 for [issue #738](https://github.com/juggernog20/OpenLaw/issues/738). Four canonical guides cover Entities/Counterparties, corporate records, Obligations, and structure/access. Author checks passed. An independent review seat then ran all 8 required scenario/role walkthroughs and a discovery pass against the final guide content; every per-article evidence record now reads `pass`. DOC-025 whole-suite acceptance and DOC-027 publication are still ahead, so the catalog stays in feature review.

## Build and method

The isolated entities lab runs immutable app source `8539f4ccb2cd435ab28d5b7402c7c0af141b70c9`, app image `sha256:800689bba1e0bd183d33760b14e4775a593d23d1cf9ded4ad752e788e60bd818`, and engine image `sha256:b69fd318f42ddbb78e8531a4b7151bcd58d9788b367a26d528d41c5bebfa792f`. Its project is `openlaw-docs-b8e31260-entities`; app/mail ports are 43306/48431 and draft Help preview is 43318. It was freshly seeded with fictional Helix data. API fixtures prepare records and read back results; browser steps operate actual controls. Each author record includes the guide hashes it ran against, build identity, and actual UTC timestamps. The independent records carry build identity and actual UTC timestamps from their runs; their `articleHashes` were associated afterwards from the committed guides, with the association stated in each record's `articleHashesNote`. Fixed example filing dates are controlled fictional inputs, not the machine clock.

Separate browser contexts represent Daniel Okafor (Administrator), Nadia Haddad (Legal Team Member), and Ravi Menon (Contributor). Anonymous formal-reader checks use another context. These are agent walkthroughs, not human user studies or feature-owner approvals. Screenshots are unnecessary for these text procedures.

## Author records

| Record                                 | Checks |
| -------------------------------------- | -----: |
| [core](author-core.json)               |      9 |
| [corporate](author-corporate.json)     |     12 |
| [obligations](author-obligations.json) |     11 |
| [structure](author-structure.json)     |     10 |
| [supplement](author-supplement.json)   |     11 |
| [discovery](author-discovery.json)     |      9 |

All 62 author checks passed against the recorded guide hashes. After those runs, three corrections changed `A Holdings relationship` to `A Holding relationship`, made the Obligation label placeholders explicit, and pointed the corporate-records prerequisite at the Administrator's Officer role list rather than the app-role guide. The author records retain their actual earlier hashes, and no new author browser run is claimed for those three corrections. The independent walkthroughs below then ran against the corrected content, so per-article evidence carries the current hashes and a completed independent review rather than a reclassification of these author records.

Both legal roles registered and updated Entities; duplicate legal names created distinct records, while a blank name was refused. Both selected Our entity and created/reused/promoted/removed Counterparties through the actual Contract controls. Corporate Status did not archive the Entity; existing references survived archive/restore. Contributors were refused the Entity destination and API.

Corporate checks covered Officer appointment/resignation dates, former Officers, additional Registrations, reciprocal Holdings, saved over-100 totals with warnings, loop/duplicate/self restrictions, Entity Document upload and original-byte download, and archive/restore of populated records. Supplemental browser actions removed an Officer, removed a Registration while retaining its Obligation, and removed a Holding while retaining both Entities. The Contributor Officer user link did not confer Entity access.

Obligation checks covered recurring and one-off creation, optional links, filtered Calendar and Home, month navigation, filing History, late-cycle advancement, completed-item filtering, date/recurrence refusals, and archived-owner restrictions. A September 30, 2025 annual due date filed October 5, 2026 advanced to September 30, 2027. Reads did not advance it. A filed one-off retained its due date and refused repeat filing. A disposable open schedule was corrected and deleted without removing its Entity Document.

Structure checks covered three capital values, negative/fractional refusal, blank values, keyboard chart navigation, Contract and Matter roll-ups, retained links after an Administrator API fixture detached an Entity Field, and separate Confidential audiences. The Matter Entity value was selected in Create matter. A known Holding displayed Restricted Entity without granting access. Hidden Contract rows and counts remained excluded. Administrator Grant/remove/clear-flag actions changed the Legal reader's Entity access without unlocking the linked Confidential Contract.

## App findings

[Calendar filter bug #773](https://github.com/juggernog20/OpenLaw/issues/773) blocked the documented Entity-only/date-filter workflow on the previous a28331f7 lab: the loader forwarded empty optional values and the API refused them. This task includes the four-line optional-query normalization fix and two UI regression cases. Those two cases failed before the fix; all six calendar tests and web typechecking passed after it. The fresh immutable 8539f4cc lab passed both legal-role calendar and completed-filter browser workflows. Earlier a28331f7 attempts are retained privately and are not represented as runs on the new build.

[Existing Matter Field issue #774](https://github.com/juggernog20/OpenLaw/issues/774) prevents choosing a new Entity in a blank Entity-valued Field on Matter Overview. Create matter offers the live Entity choices and was used in the successful browser checks. The structure guide describes reading saved roll-up links; it does not claim the broken Overview selection works. Configuration coverage and final acceptance must retain this known limitation.

Earlier harness attempts corrected actual control names, date blur handling, and the Contract creation API shape. Only complete passing runs are included here.

## Independent walkthrough

A separate review seat worked through each guide's documented procedures, notes and recovery guidance in fresh browser contexts against the same immutable lab, after the copy corrections above. Each record's steps name exactly what was exercised; the per-article evidence summarizes the core results and links the complete records rather than restating every step. It built its own disposable fictional records rather than reusing the author fixtures, which their own recovery checks had already changed or deleted. Infrastructure helpers were reused; the reader steps and assertions were written independently.

| Record                                                    | Scenario  | Steps | Started (UTC)            | Finished (UTC)           | Roles                                         |
| --------------------------------------------------------- | --------- | ----: | ------------------------ | ------------------------ | --------------------------------------------- |
| [c31](independent-c31.json)                               | V-C31     |    25 | 2026-09-07T23:40:45.292Z | 2026-09-07T23:41:57.757Z | legal_team_member, administrator, contributor |
| [c32](independent-c32.json)                               | V-C32     |    34 | 2026-09-08T00:33:07.980Z | 2026-09-08T00:35:24.265Z | legal_team_member, administrator              |
| [c52](independent-c52.json)                               | V-C52     |    26 | 2026-09-08T00:40:29.638Z | 2026-09-08T00:42:59.307Z | legal_team_member, administrator              |
| [c53](independent-c53.json)                               | V-C53     |    21 | 2026-09-08T00:47:58.877Z | 2026-09-08T00:49:09.320Z | legal_team_member, administrator              |
| [discovery](independent-discovery.json)                   | discovery |    15 | 2026-09-08T00:55:05.216Z | 2026-09-08T00:56:19.268Z | legal_team_member, administrator, anonymous   |
| [c53-linked-work](independent-c53-linked-work.json)       | V-C53     |    11 | 2026-09-08T01:11:11.012Z | 2026-09-08T01:11:18.691Z | legal_team_member, administrator              |
| [discovery-coverage](independent-discovery-coverage.json) | discovery |    11 | 2026-09-08T01:12:05.073Z | 2026-09-08T01:14:28.654Z | legal_team_member, administrator, anonymous   |

All 143 independent steps passed. Every step names the role that performed it, the actual observed result, and its own UTC timestamps.

V-C31 registered Entities with their identity details, confirmed Status defaults to Active and that choosing Dormant does not archive, proved a repeated legal name makes a second distinct registry row, and drove Our entity and the Counterparty picker through create, Primary, Make primary and "Take name off the contract". Its negatives: a blank Legal name is refused with "Name the entity — its registered legal name."; the picker offers no second record for an existing name in another case and does not re-offer a party already on the Contract; a Contributor is sent away from /entities, is offered no Entities item in the navigation, and is refused by the API.

V-C32 recorded Officers, Registrations, Holdings, an Entity-owned Document, and archive/restore. A resignation before the appointment is refused with "The resignation date cannot be before the appointment date." and leaves the appointment untouched. Removing a Registration detaches its Obligation instead of deleting it. The Holding picker leaves out the Entity itself and any Entity already in a Holding with it, so neither self-ownership nor a repeat can be chosen; a loop through a third Entity is refused with a message naming the whole path. Two owners at 60% both save and raise the "Ownership totals 120%" warning, which clears when one row is corrected. A fictional certificate uploaded as Executed reached v1 on its Entity, stayed off a sibling Entity, and survived archive and restore alongside the Obligation.

V-C52 created a recurring schedule and a one-off, refused a 1,201-month and a zero-month recurrence and a blank Label, and confirmed the calendar leads with overdue rows and keeps its filters across Month, Previous month, Next month, Today and the due-date list. Reading the calendar and Home neither filed nor advanced a past-due item. The guide's worked example held exactly: a 2025-09-30 annual schedule filed 2026-10-05 advanced to 2027-09-30, and History recorded the filing. A filed one-off kept its due date, locked its row, withdrew Mark filed and returned only under Include completed. An impossible date window produced the empty state and its Clear all. Archiving the owning Entity removed its Obligations from the calendar and Home.

V-C53 saved the three share-capital values on focus change, abandoned an edit on Escape, and refused "-5" and "12.5" with "Enter a whole number of zero or more." without replacing the stored 10000. The chart drew the recorded 75% and 25% edges, panned and zoomed from the keyboard, fitted back with zero and with Fit to window, and opened a named Entity from its node. A Legal Team Member met the Confidentiality card with its switch disabled, no Manage access control, and a refused write. A Confidential Contract signed by a reachable Entity contributed neither a row nor a count for the reader who cannot reach it. Turning on Confidential left the Administrator's access intact and reduced the reader's known Holding to "Restricted Entity" with no link and no reachable address; a Grant opened that Entity alone and not the linked Confidential Contract; Remove restored the restriction while keeping the recorded Holding; clearing the flag opened the Entity without a Grant.

The discovery pass ran in two parts. The first ([independent-discovery.json](independent-discovery.json)) reached each guide from the Entity destination's Help and found all four by exact title, then sampled one guide per property: the outline on `entity-obligations`, themes and widths on `entity-records`, zoom on `entities-and-counterparties`, and the formal-reader link on `entity-structure-and-access`. The second ([independent-discovery-coverage.json](independent-discovery-coverage.json)) extended every one of those properties to all four guides for both legal roles, so the sampling is no longer load-bearing.

Together they establish, for each of the four guides and both roles: no horizontal overflow at 320, 720 and 1440 CSS pixels in Light, Dark and Warm (36 checks per role); no overflow at an emulated 200 percent zoom; arrival focus on the article's H1, with Shift+Tab reaching its outline link with a visible focus indicator and Enter following it to the section; and a "Read this article in the full documentation" link that opens that same guide. The shell's "Skip to content" link was activated by keyboard, not merely observed: tabbing to it and pressing Enter moved focus to `main#main`. A fresh anonymous context visited the formal index and all four guide pages and issued no request under `/api/` at all, neither `/api/v1/` nor `/api/auth/`, with no password field anywhere.

### Linked work and counts

The first V-C53 record's linked-work step checked Contract **rows** only. Its original text also quoted a tab label that a `/Contracts/` link lookup had taken from the global navigation rather than the Entity record tab, and its Legal Team Member wording claimed an absent **count** that was never measured. Both steps are corrected in place with their original text retained under each step's `correction` key, and the counts are measured afresh in [independent-c53-linked-work.json](independent-c53-linked-work.json).

That supplement builds one Entity carrying four fixtures: an open and a Confidential Contract through **Our entity**, and an open and a Confidential Matter through a saved Entity-valued Field. Read from the Entity record tabs by their own `href`, the Administrator's badges report "2 linked Contracts" and "2 linked Matters" while the Legal Team Member's report "1 linked Contract" and "1 linked Matter" — short by exactly the one record each that reader cannot reach. The counts endpoint was read only to corroborate the badge the reader sees. Both roles opened a rolled-up Matter from the Entity and landed on that Matter's own record.

An Administrator fixture then detached the Entity-valued Field from its Matter type. The roll-up survived for both roles: the row stayed, the badge still read "2 linked Matters" for the Administrator and "1 linked Matter" for the Legal Team Member, and the Legal reader still opened the Matter. That is the behaviour the guide describes.

Issue [#774](https://github.com/juggernog20/OpenLaw/issues/774) still prevents choosing an Entity in a blank Entity-valued Field on Matter Overview, so these fixtures saved their Entity value through the API. Nothing here claims that picker works, and the limitation is repeated in the affected article's evidence.

### Harness notes

Three infrastructure facts cost several harness passes and are recorded so a later reviewer does not rediscover them. A single Tab moves between a date control's segments rather than out of it, so a date commits only when focus actually leaves the field; the walkthrough clicks the section heading, which is the transition the guide describes. The Add Holding suggestion list overlays the dialog footer while it is open, so Cancel is unreachable until the list closes; Escape dismisses the dialog cleanly. The "Pick a person" select in Confidential access names every eligible reader, so the grant list has to be read through its own Remove control rather than the dialog's text.

## Discovery and remaining verification

Both legal roles found each applicable guide through Entity page Help, searched its exact title, followed an outline link with focused heading, and opened the formal reader. Actual Help pages were checked at 320/720/1440 CSS pixels in Light/Dark/Warm, with keyboard focus and emulated 200 percent zoom; no horizontal overflow occurred. The anonymous formal index listed all four guides and made zero application API requests.

The guide suite remains in feature review. DOC-025 full-suite acceptance and DOC-027 publication/export remain ahead. The types and Fields guide is a forward dependency for the two guides that link it. The user will proofread after the full suite is assembled.

## Repository validation

The author pass completed all 19 static tasks, all 33 documentation/CI tooling tests, normal and preview documentation builds, and the full uncached workspace suite (five tasks; 2,889 API and 1,704 web tests; 4m18.594s). The independent pass re-ran the documentation and static checks and the full workspace suite after its own changes.

The one open CodeRabbit thread asks for this README in second-person imperative. It is not applied: this file records what happened, and an evidence record states results rather than instructing a reader. The reader guides themselves already use direct procedural steps. CodeRabbit ran once and completed with four minor findings. The glossary singular and explicit dynamic Obligation labels were corrected as described above. A later review pass found the corporate-records prerequisite sending a reader who needs a missing Officer role to the app-role guide, which does not cover that list; the prerequisite now links the Administrator taxonomy guide instead. The same pass relabelled one supplemental step from `api-check` to `automated-test`, the standard's name for a scripted check that is not a browser action; what the step did is unchanged. Suggestions to turn the two internal verification-status paragraphs into second-person instructions were not applied: those paragraphs report project/evidence status, while the reader guides already use direct procedural steps.
