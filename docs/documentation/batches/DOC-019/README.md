# Knowledge guide verification

Two canonical guides cover C33 and C34 for [#739](https://github.com/juggernog20/OpenLaw/issues/739): Knowledge authoring and publication/audience control. They serve staff Help and the formal reader. Author walkthroughs are complete; independent technical and browser review is pending. The catalog remains in feature review for DOC-025 acceptance and DOC-027 publication/export.

## Build and actors

The isolated `knowledge` lab runs committed app source `6a8873dbda333fd9992eb77525d4bfa3f47af20d` in project `openlaw-docs-b8e31260-knowledge`, at app/mail ports 43308/48432. The draft Help preview uses 43320. Its app image is `sha256:01f561a674f91137c4e3bb0e0b267c3e1731361dc13182687a5026510b87d7bb`; the engine image is `sha256:1c2f7f6f03395c6cdf05c8e2ab716334a4248587ec655f3cbdfebefb8ffafbf7`. Source and configuration are immutable, and the lab was separately seeded with fictional Helix data. The older conversations lab was stopped to release its owned networks; its database, files, configuration, and snapshot remain intact.

Separate browser contexts represent Daniel Okafor (Administrator), Nadia Haddad (Legal Team Member), Jonas Weber (Business User), and Ravi Menon (Contributor). Anonymous reading uses another context. These are agent walkthroughs, not human user studies or feature-owner approval. No screenshots are needed for the text procedures.

Browser actions follow the actual controls. API calls prepare explicitly named fixtures or corroborate saved results; they do not substitute for the reader actions. Each record captures its content hashes at the start, app identity, actual UTC timestamps, and per-step outcomes. Supporting files use fictional text or repository test fixtures.

## Author outcomes

| Record                                            | Successful checks | Scope                                                                                                                                                                                     |
| ------------------------------------------------- | ----------------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Authoring](author-authoring.json)                |                12 | Both roles: file-first and guidance-only creation, title/guidance persistence, primary paper, descendant filtering, types, folder rename/dissolution                                      |
| [Initial publication](author-publishing.json)     |                 7 | Administrator publication, audience confirmation/cancellation, configured Portal links, primary/supporting downloads, unpublication, live edits, archive/reload/restore                   |
| [Legal publication](author-publishing-legal.json) |                 9 | Same publication journey as Legal; Contributor staff refusal and anonymous Portal sign-in requirement                                                                                     |
| [Supplement](author-supplement.json)              |                 6 | Both roles: primary Document archive/restore, archived type exclusion, blank-title refusal, folder movement and reordering                                                                |
| [Current files](author-current-files.json)        |                 2 | Both roles add v2 without republishing; Business Portal downloads its exact bytes and offers no Version-history picker                                                                    |
| [Discovery](author-discovery.json)                |                 5 | Both guides for both roles: contextual Help, title search, focused outline headings, formal links, three themes, narrow layouts/zoom; anonymous formal discovery without app API requests |

These records contain 41 successful checks. The initial publication record also retains one failed expectation: the draft incorrectly claimed archiving primary paper cleared its designation. The app preserved the designation, as the existing Document guide explains. The guide was corrected, and the supplement then verified archive/restore with the retained designation for both roles. The original record remains incomplete/failed rather than being relabeled as an entirely successful run. Its seven earlier passing publication steps remain individually recorded.

The authoring and initial publication records carry the earlier `create-knowledge` hash. The changed archival explanation is verified in the supplement and current-files records against that corrected guide hash; no claim is made that the earlier authoring run followed the corrected paragraph. A later copy-only terminology correction changed three references from “paper” to “Document” without changing actions or meaning. All author records retain their actual hashes; no fresh walkthrough is claimed for that copy edit. The independent walkthrough must use the final committed guide bytes.

A prior attempt on app source `8539f4cc` exposed the archived-record failure below. It is not credited as corrected-build verification. Harness corrections also narrowed a Type locator that matched a table header and replaced an immediate switch-state assertion with a wait for its asynchronous saved state. These were probe corrections, not app changes.

## App correction

[#776](https://github.com/juggernog20/OpenLaw/issues/776) blocked the restore instructions: after archiving and reloading a Knowledge Item, its record read succeeded but its Documents list returned 404, sending the page to the error boundary. The Member+ Documents read now permits an archived owning item. Uploads remain frozen, lower roles remain refused, and Portal article/file access remains unavailable while archived.

The regression failed before the change and passed afterward. Together with existing Knowledge and Portal cases, seven tests passed. The regression checks both legal roles' retained Document reads, Contributor/Business refusal, archived upload refusal, Portal article/download denial, and successful download after restore. The author browser runs then reopened and restored archived records for both roles on the corrected immutable build. The OpenAPI description and generated client were refreshed.

## Remaining review and publication

Independent technical review and all four required scenario/role walkthroughs remain pending. The reviewer must also verify Business Portal primary/supporting file access and removal, and the two guides' Help/formal presentation. Per-article evidence deliberately remains `not-run` until that independent work is recorded.

The author static pass completed all 19 tasks, and all 33 documentation/CI tooling tests passed. Normal and preview documentation builds passed. The full uncached workspace suite passed all five tasks, including 2,890 API and 1,704 web tests, in 3m51.095s. A later response-schema assertion improvement passed all four Knowledge Document tests; it changes test validation only.

CodeRabbit ran once. Its response-schema and Document-terminology suggestions were applied. Its suggestion to turn this evidence README into second-person imperative instructions was not applied: the README records actual outcomes, while the user guides give instructions.

The types/Fields guide is a forward publication dependency. DOC-021 will extend the linked request-form configuration guidance. DOC-025 must review compatibility with the final app candidate while retaining these actual build identities. The user will proofread after the full suite is assembled.
