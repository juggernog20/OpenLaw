# Document guide verification

C26–C28, C30, and C54 for [issue #737](https://github.com/juggernog20/OpenLaw/issues/737). Five canonical guides cover Document Versions and conversation filing, folders/import, previews/downloads, repository discovery, and archive/restore/deletion. Author checks passed. Independent review and all 16 required scenario/role walkthroughs remain pending; article evidence is explicitly not-run.

## Build and method

The conversations lab runs immutable app source `a28331f779da3c8b9e9172dee3cc5b58c7170c7b`, app image `sha256:7434e1b1802330e3f3499a0fba3dfcc0b8a04fc875561071e17f4ad5a1c29c0d`, and engine image `sha256:16ab8ea3bcaf1d43619d6e3cff879d2f313c5e366a36a7ae285a5baa7ae15ed0`. Its project is `openlaw-docs-b8e31260-conversations`; app/mail ports are 43302/48427 and the draft Help preview is 43312. No app runtime or immutable deployment input changes are included.

Separate browser contexts represent fictional Daniel Okafor (Administrator), Nadia Haddad (Legal Team Member), Ravi Menon (Contributor), and Jonas Weber (Business User). API calls prepare fictional records and read back results. Procedures credited as browser checks operate actual controls; deliberate API or browser-network fixtures are named in each record. Guide hashes and actual UTC times accompany every run. Screenshots are unnecessary for these text procedures. These are agent walkthroughs, not human user studies or feature-owner approvals.

## Author records

| Record                                           | Checks |
| ------------------------------------------------ | -----: |
| [versions](author-versions.json)                 |     15 |
| [folders](author-folders.json)                   |     12 |
| [previews](author-previews.json)                 |     27 |
| [repository](author-repository.json)             |      9 |
| [supplement](author-supplement.json)             |      5 |
| [boundaries](author-boundaries.json)             |      6 |
| [discovery](author-discovery.json)               |     16 |
| [portal-discovery](author-portal-discovery.json) |      1 |

All 91 author checks passed against the current guide hashes. The independent review below must use fresh walkthroughs rather than reclassifying these author checks.

## Findings and boundaries

Single uploads and appends preserve Version order, bytes, notes, and provenance. Hand-set kind correction is distinct from the executed-copy pin; a new Document Version leaves an older pin intact. Primary designation moves between separate Documents. Contributors upload supporting Documents, cannot append to a primary Contract Document, and have no kind, folder, archive, restore, or deletion controls. Contract conversation filing offers New Document or New Version, retains the attachment and Filed to marker, and is a legal-role action; Matter comments do not expose it.

Both legal roles created nested folders, renamed/moved them, hit invalid-name and cycle restrictions, moved Documents, and dissolved a folder without deleting its paper. Both legal roles and the Contributor completed a two-file import with one deliberately injected 503 response: the good file survived, and Retry resent only the failed file. A native directory filechooser preserved top-level/nested file paths and omitted empty directories. The import destination is a readout fixed by the gesture, not a selector; the guide was corrected before the final walkthrough.

All staff roles read PDF, converted Word/PowerPoint, a scanned PDF with verified OCR output, PNG, and EML; each browser download matched the uploaded bytes. Download-only rows download directly. A deliberately corrupt DOCX container reached failed rendition; its original still downloaded, and appending a valid Word file produced a readable v2 while retaining v1. Plain text merely named .docx converted successfully, so that early fixture did not count as a processing failure. The final failure fixture is a malformed ZIP container.

The Business User downloaded their own Request attachment and current published Knowledge files, with no staff repository or Version controls. Portal Knowledge lists downloads and has no in-app Document preview; the draft was corrected accordingly. Draft, Legal-only, and archived Knowledge links were refused. Repository checks covered all four owner arms, current-Version landing, composed filters, Confidential owner exclusions, role restrictions, archived-row restoration, and empty-result recovery.

Archive/restore retained the chain and designations for both legal roles. The Administrator's incorrect typed name disabled Delete, Cancel preserved the Document, and correct confirmation removed all three Version downloads and the row. Legal and Contributor direct deletion attempts were refused. Archived owning-record setup removed upload controls, and restoring that owned fixture returned them. Per-blob storage inspection is not claimed by these browser download checks.

## Discovery and remaining verification

Each staff role found all five applicable guides through Help from the repository or a record's Documents tab, searched their exact titles, followed outline links with focused headings, and opened formal documentation. The Business User did the same for the preview/download guide from a Request's Help. Theme/layout checks covered Light, Dark, and Warm at 320, 720, and 1440 CSS pixels without horizontal overflow. An anonymous formal-index check made no application API requests.

An initial discovery attempt found the temporary preview stopped; it was restarted before successful runs. Help searches retain contextual topic filters, so the completed checks enter Help from each guide's appropriate record/repository/Request surface. Earlier harness attempts also corrected a switch versus checkbox assumption, an automatically expanded folder, plain-text email rendering, and two equivalent Download links on a failure card. Only complete passing runs appear in the records.

Independent source review, all 16 scenario/role walkthroughs, and independent keyboard/zoom checks remain pending. DOC-025 governs full-suite acceptance, and DOC-027 publishes the feature-review edition and export. Shared Knowledge/operator links remain dependencies until their own batches land. User proofreading is scheduled after the complete suite is assembled.

## Repository validation

Author static checks passed (19 tasks), along with 33 documentation/CI tooling tests and normal/preview documentation builds. The full workspace suite passed in 4 minutes 21 seconds: 176 API files / 2,889 tests, 97 web files / 1,702 tests, all five Turbo tasks successful. CodeRabbit completed once. Independent review and final commit CI remain pending. The repository walkthrough and staff Help discovery were rerun after the role-name capitalization correction; all author records match final guide bytes.

## CodeRabbit disposition

The single CodeRabbit run raised thirteen findings. Three terminology suggestions are applied to this evidence record: Document Versions and conversation filing are named separately, supporting Documents and new Document Versions replace ambiguous references, and Legal-only names the tested Knowledge audience.

The minor checklist and major whole-record imperative rewrites are declined. These files report completed and pending verification states; changing them to instructions would make those states less clear. User-facing procedures already use direct action language. No behavioral guide change was needed.

The remaining suggestions were assessed against the source and browser results. The repository guide now capitalizes Legal Team Member consistently. The proposed Owner-to-Owning-record label change is declined: the actual filter is labeled Owner. References to Legal name the department and can include an Administrator, so replacing them with only Legal Team Member would narrow the recovery guidance. Expected-result strings retain the scenario registry wording; input files that fail an import are not yet logical Documents. Contributor root-only upload is already explicit in the folder guide and linked Version guidance. These suggestions do not justify inventing controls or changing the meaning of the required scenarios.
