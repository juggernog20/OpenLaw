# Entity guide verification

C31, C32, C52, and C53 for [issue #738](https://github.com/juggernog20/OpenLaw/issues/738). Four canonical guides cover Entities/Counterparties, corporate records, Obligations, and structure/access. Author checks passed. Independent technical review and all 8 required scenario/role walkthroughs remain pending; per-article evidence is explicitly not-run.

## Build and method

The isolated entities lab runs immutable app source `8539f4ccb2cd435ab28d5b7402c7c0af141b70c9`, app image `sha256:800689bba1e0bd183d33760b14e4775a593d23d1cf9ded4ad752e788e60bd818`, and engine image `sha256:b69fd318f42ddbb78e8531a4b7151bcd58d9788b367a26d528d41c5bebfa792f`. Its project is `openlaw-docs-b8e31260-entities`; app/mail ports are 43306/48431 and draft Help preview is 43318. It was freshly seeded with fictional Helix data. API fixtures prepare records and read back results; browser steps operate actual controls. Each record includes exact guide hashes, build identity, and actual UTC timestamps. Fixed example filing dates are controlled fictional inputs, not the machine clock.

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

All 62 author checks passed against the recorded guide hashes. After those runs, three corrections changed `A Holdings relationship` to `A Holding relationship`, made the Obligation label placeholders explicit, and pointed the corporate-records prerequisite at the Administrator's Officer role list rather than the app-role guide. The author records retain their actual earlier hashes; per-article evidence records the current hashes and still awaits independent review and fresh required walkthroughs. No new browser run is claimed for those three corrections. Independent reviewers must perform fresh walkthroughs, not reclassify these records.

Both legal roles registered and updated Entities; duplicate legal names created distinct records, while a blank name was refused. Both selected Our entity and created/reused/promoted/removed Counterparties through the actual Contract controls. Corporate Status did not archive the Entity; existing references survived archive/restore. Contributors were refused the Entity destination and API.

Corporate checks covered Officer appointment/resignation dates, former Officers, additional Registrations, reciprocal Holdings, saved over-100 totals with warnings, loop/duplicate/self restrictions, Entity Document upload and original-byte download, and archive/restore of populated records. Supplemental browser actions removed an Officer, removed a Registration while retaining its Obligation, and removed a Holding while retaining both Entities. The Contributor Officer user link did not confer Entity access.

Obligation checks covered recurring and one-off creation, optional links, filtered Calendar and Home, month navigation, filing History, late-cycle advancement, completed-item filtering, date/recurrence refusals, and archived-owner restrictions. A September 30, 2025 annual due date filed October 5, 2026 advanced to September 30, 2027. Reads did not advance it. A filed one-off retained its due date and refused repeat filing. A disposable open schedule was corrected and deleted without removing its Entity Document.

Structure checks covered three capital values, negative/fractional refusal, blank values, keyboard chart navigation, Contract and Matter roll-ups, retained links after an Administrator API fixture detached an Entity Field, and separate Confidential audiences. The Matter Entity value was selected in Create matter. A known Holding displayed Restricted Entity without granting access. Hidden Contract rows and counts remained excluded. Administrator Grant/remove/clear-flag actions changed the Legal reader's Entity access without unlocking the linked Confidential Contract.

## App findings

[Calendar filter bug #773](https://github.com/juggernog20/OpenLaw/issues/773) blocked the documented Entity-only/date-filter workflow on the previous a28331f7 lab: the loader forwarded empty optional values and the API refused them. This task includes the four-line optional-query normalization fix and two UI regression cases. Those two cases failed before the fix; all six calendar tests and web typechecking passed after it. The fresh immutable 8539f4cc lab passed both legal-role calendar and completed-filter browser workflows. Earlier a28331f7 attempts are retained privately and are not represented as runs on the new build.

[Existing Matter Field issue #774](https://github.com/juggernog20/OpenLaw/issues/774) prevents choosing a new Entity in a blank Entity-valued Field on Matter Overview. Create matter offers the live Entity choices and was used in the successful browser checks. The structure guide describes reading saved roll-up links; it does not claim the broken Overview selection works. Configuration coverage and final acceptance must retain this known limitation.

Earlier harness attempts corrected actual control names, date blur handling, and the Contract creation API shape. Only complete passing runs are included here.

## Discovery and remaining verification

Both legal roles found each applicable guide through Entity page Help, searched its exact title, followed an outline link with focused heading, and opened the formal reader. Actual Help pages were checked at 320/720/1440 CSS pixels in Light/Dark/Warm, with keyboard focus and emulated 200 percent zoom; no horizontal overflow occurred. The anonymous formal index listed all four guides and made zero application API requests.

The guide suite remains in feature review. Independent review, eight required scenario/role walkthroughs, DOC-025 full-suite acceptance, and DOC-027 publication/export remain ahead. The types and Fields guide is a forward dependency. The user will proofread after the full suite is assembled.

## Repository validation

The author pass completed all 19 static tasks, all 33 documentation/CI tooling tests, normal and preview documentation builds, and the full uncached workspace suite (five tasks; 2,889 API and 1,704 web tests; 4m18.594s). Independent review and final commit CI remain pending.

CodeRabbit ran once and completed with four minor findings. The glossary singular and explicit dynamic Obligation labels were corrected as described above. A later review pass found the corporate-records prerequisite sending a reader who needs a missing Officer role to the app-role guide, which does not cover that list; the prerequisite now links the Administrator taxonomy guide instead. The same pass relabelled one supplemental step from `api-check` to `automated-test`, the standard's name for a scripted check that is not a browser action; what the step did is unchanged. Suggestions to turn the two internal verification-status paragraphs into second-person instructions were not applied: those paragraphs report project/evidence status, while the reader guides already use direct procedural steps.
