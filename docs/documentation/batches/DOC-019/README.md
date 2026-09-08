# Knowledge guide verification

Two canonical guides cover C33 and C34 for [#739](https://github.com/juggernog20/OpenLaw/issues/739): Knowledge authoring and publication/audience control. They serve staff Help and the formal reader. Author walkthroughs and the independent technical and browser review are complete. The catalog remains in feature review for DOC-025 acceptance and DOC-027 publication/export.

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

The authoring and initial publication records carry the earlier `create-knowledge` hash. The changed archival explanation is verified in the supplement and current-files records against that corrected guide hash; no claim is made that the earlier authoring run followed the corrected paragraph. A later copy-only terminology correction changed three references from "paper" to "Document" without changing actions or meaning. All author records retain their actual hashes; no fresh walkthrough is claimed for that copy edit. The independent walkthrough must use the final committed guide bytes.

Review then corrected `publish-knowledge` step 3, which asked for an "internal Knowledge link" without naming a control. The initial publication record already walked that path as Settings / Intake / Deflection links, so the guide now names it, together with the Add link fields, and it uses the CONTEXT.md term "deflection link" throughout. The field names are read from `apps/web/src/routes/settings-intake-links.tsx`; the independent walkthrough must confirm them. The `publish-knowledge` evidence hash was refreshed; the author publication records keep the earlier hash.

A prior attempt on app source `8539f4cc` exposed the archived-record failure below. It is not credited as corrected-build verification. Harness corrections also narrowed a Type locator that matched a table header and replaced an immediate switch-state assertion with a wait for its asynchronous saved state. These were probe corrections, not app changes.

## App correction

[#776](https://github.com/juggernog20/OpenLaw/issues/776) blocked the restore instructions: after archiving and reloading a Knowledge Item, its record read succeeded but its Documents list returned 404, sending the page to the error boundary. The Member+ Documents read now permits an archived owning item. Uploads remain frozen, lower roles remain refused, and Portal article/file access remains unavailable while archived.

The regression failed before the change and passed afterward. Together with existing Knowledge and Portal cases, seven tests passed. The regression checks both legal roles' retained Document reads, Contributor/Business refusal, archived upload refusal, Portal article/download denial, and successful download after restore. The author browser runs then reopened and restored archived records for both roles on the corrected immutable build. The OpenAPI description and generated client were refreshed.

## Independent review

An independent review seat followed both final guides in this same immutable lab, in its own browser contexts, with its own fixtures named for each run. Its records are [V-C33](independent-c33.json) (27 steps, 2026-09-08T02:22:27.924Z to 2026-09-08T02:23:00.137Z), [V-C34](independent-c34.json) (18 steps, 2026-09-08T02:25:32.714Z to 2026-09-08T02:26:13.212Z) and [discovery](independent-discovery.json) (13 steps, 2026-09-08T02:27:02.064Z to 2026-09-08T02:27:24.151Z). Every step passed. Each record captures the guide hashes at its own run start, and those hashes are the bytes committed on this branch.

V-C33 was walked for both the Administrator and the Legal Team Member: file-first creation into Library, title and type persistence through a reload, guidance-only creation with rendered Markdown, a supporting upload with the primary choice moved to it, folders and their cycle-safe parent choices, sibling reordering, moving an item by its Folder field, independent list filters, and folder dissolution that kept both items and Documents. Its negative checks were the separately prepared archived Knowledge type absent from both type pickers, an archived item that disabled Title, Type, Folder and Audience and offered no Upload (a direct upload answered 409), Manage types… offered only to the Administrator, and a Contributor left on Home with 403 for the record and its Documents.

V-C34 was walked for both publishers, with Jonas Weber and Amara Nwosu each signed in to their own Business Portal context and Ravi Menon as a Contributor comparison reader. Draft and published Legal Only items stayed off the portal; Everyone plus the Deflection links configuration put the article and both file downloads in front of the Portal readers, with bytes equal to the uploaded PDF and DOCX; Legal Only, Unpublish and Archive each removed the article, the Before you submit link and both saved Document download addresses, which is the scenario's direct-link negative check; Restore returned the published Everyone state, both Documents and the recorded replacement; a named replacement did not redirect the old portal address; and a browser with no session was sent to Portal sign-in.

Discovery covered both guides for both roles on the draft preview: contextual Help offered `create-knowledge` on the Knowledge list and both guides on a Knowledge record, exact-title search opened each article with its h1 focused, outline links focused their headings, the formal link reached `/documentation/<id>`, and the Help panel was reachable and operable by keyboard alone. Neither guide overflowed horizontally in light, dark and warm themes at 320, 720 and 1440 CSS pixels or at emulated 200 percent zoom. Help search for a fictional Knowledge Item title answered "No matching articles", which is the separation `create-knowledge` claims. Signed out, both guide titles were listed in `/documentation` and one opened with zero application API requests.

Two observations came out of the independent runs. The library's folder up/down control ignores a click while another folder request is still in flight, so one reorder needed a second click before the saved order moved; the guide's sentence about those controls is still accurate, and this is left for the feature owner. The `publish-knowledge` step 3 correction was exercised end to end: Settings, Intake, Deflection links, Add link, Target "Knowledge item", Label and Placement all carry the names the guide now uses.

Timestamps in every record here, the author's and the independent seat's, are actual `new Date().toISOString()` reads taken around each awaited action; short local operations complete in well under a second, and no timing is inferred or typed by hand.

## Application changes since the tested build

The lab runs app source `6a8873db` and was not rebuilt. Commit `611a5b93` on this branch touches the same Knowledge paper read only by removing an unused selected `archivedAt` column and adding comments, and adds one test comment; it changes no request handling, no response and no label, so every walkthrough recorded here holds for it. DOC-025 re-pins the whole suite to one candidate build.

## Remaining publication dependencies

Independent walkthrough and technical review are recorded; both per-article evidence records read `pass`. What is left is not verification of these two guides: `create-knowledge` links `types-statuses-fields` (DOC-021), `publish-knowledge` names the Deflection links settings that C40 (DOC-021) will document, the scenario registry keeps its aggregate `not-run` until DOC-025, and the catalog stays in feature review until DOC-025 acceptance and DOC-027 publication.

## Checks and tooling

The author static pass completed all 19 tasks, and all 33 documentation/CI tooling tests passed. Normal and preview documentation builds passed. The full uncached workspace suite passed all five tasks, including 2,890 API and 1,704 web tests, in 3m51.095s. A later response-schema assertion improvement passed all four Knowledge Document tests; it changes test validation only.

The independent seat then ran the same checks against its own commits, with no browsers running: the uncached full workspace suite passed all 5 tasks in 4m5.402s, including 2,890 API tests in 176 files and 1,704 web tests in 97 files. The normal and preview documentation builds passed, the preview build's only Knowledge warning being the known `types-statuses-fields` forward link; the 33 documentation and CI tooling tests passed; Prettier and secretlint passed over the evidence, the records and both guides.

CodeRabbit ran once. Its response-schema and Document-terminology suggestions were applied. Its suggestion to turn this evidence README into second-person imperative instructions was not applied: the README records actual outcomes, while the user guides give instructions.

DOC-021 will extend the linked request-form configuration guidance. DOC-025 must review compatibility with the final app candidate while retaining these actual build identities. The user will proofread after the full suite is assembled.
