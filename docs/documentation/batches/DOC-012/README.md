# Portal guide verification

C09–C11 for [issue #732](https://github.com/juggernog20/OpenLaw/issues/732).
This batch extends the submission pilot and adds Request follow-up and Portal
Knowledge guides. The author walkthroughs below passed, and the independent source
review and browser walkthrough recorded at the end of this file passed all three
scenarios. The articles stay in review only because linked guides are unpublished.
Agent checks are not a human user study.

## Build and fixtures

The immutable conversations lab runs app commit
`a28331f779da3c8b9e9172dee3cc5b58c7170c7b` at `http://127.0.0.1:43302` with
Mailpit at `http://127.0.0.1:48427`. The draft reader is at
`http://127.0.0.1:43312`. Every evidence file records the app and Document engine
image IDs, date, role, guide hashes, actions, and observed results. No app runtime
change was needed in this batch.

Jonas Weber is the Business User; Amara Nwosu is a second Business User used for
negative checks. Nadia Haddad acts as the Legal Team Member and Daniel Okafor as
the Administrator. Separate browser contexts sign in with fictional seed accounts.
Requests R-29 through R-33 cover Open, Contract conversion, Matter conversion,
resolution, and decline. Additional Requests exercise real form submission.
All attached paper and organization guidance are fictional.

The author prepared active request types, a required question, Request attachments,
and Knowledge Items with primary and supporting Documents through authenticated
APIs. Configuration setup is not acceptance of the later Administrator guides.
Legal replies were posted through the UI; disposition was applied through the API
while the Business User followed the Portal guide. The later intake batch owns
Legal's conversion, resolution, and decline controls.

Knowledge fixtures cover published Everyone, draft, Legal-only, and archived
items. Links were configured while the items were eligible, then the restricted
fixtures were made unavailable. The external-link fixture points to a missing
local website address, with no production or external provider involved. Private
fixture helpers and detailed run output are under `/tmp/openlaw-docs-run/732-*`.

## Author walkthroughs

| Evidence                             | Result                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Submission](author-submission.json) | Six checks covering active form and guidance, missing required answers without a POST, Medium default, 20-file selection/removal, a single saved Request with supplied answers and exact original file, reported upload failure with a successful Request, disposition during upload with reply recovery, and unknown-form recovery.                                           |
| [Follow-up](author-follow.json)      | Twenty checks across Open, Contract conversion, Matter conversion, Resolved, and Declined: own Request and saved values, Legal replies at all three tiers with only Full thread visible, correct status and reason/resolution, later replies and downloadable files, unchanged status after reply, other Requester's Request/file refusal, and unavailable staff destinations. |
| [Knowledge](author-knowledge.json)   | Eight checks: home/form guidance filtering, same-tab internal link, primary-first and supporting downloads, written guidance, draft/restricted/archived item and file refusal, current Version update and revocation of a saved download, broken external link without losing form answers, and signed-out refusal.                                                            |
| [Recovery](author-recovery.json)     | Five checks: failed reply retains text and paper, real retry posts once, failed conversation and earlier-page reads recover, and later Document Versions on both converted record types leave the original Request attachment bytes unchanged.                                                                                                                                 |
| [Discovery](author-discovery.json)   | Five checks covering contextual Help for all three articles, title search, title/section focus, formal links, canonical Portal notification preferences, anonymous formal index without app API calls, and three themes at 320/720/1440 CSS pixels without horizontal overflow.                                                                                                |

Submission recovery uses a controlled browser 413 response to exercise a rejected
attachment; the Request is created by the real API. A separate real race resolves
a saved Request before its attachment upload reaches the API, then follows the
reply link and sends the paper on the same Request. Neither case resubmits the
whole form. This does not claim a production deployment's particular upload limit.

The Knowledge Version check uploads new bytes, confirms that the current download
changes, unpublishes the item and confirms refusal, then restores publication and
the fixture's original current filename for independent testing. Downloaded files
already on a user's computer are outside the app's update process.

Review edits after these runs changed the submission and follow-up guide bytes:
the optional-question sentence, the Send precondition, and the statuses that show
the reply link. The evidence keeps the hashes it read; independent acceptance must
cover the final text, as in DOC-011.

The inline **Help with this page** entry is available on the form and Request
pages. Knowledge uses the Portal header **Help**, which supplies the Knowledge
context. The status banner's attachment link scrolls to the reply form; it does
not put typing focus in the textarea. The guide does not promise that focus.
Layout checks are CSS-pixel measurements, not browser zoom or assistive technology
acceptance.

## Publication dependencies

The canonical conversation guide links onward to Document handling (DOC-017), and
notification preferences link to Administrator reminder settings (DOC-021). These
transitive targets still prevent publication. DOC-025 owns acceptance against the
final edition baseline. This batch does not republish the earlier pilot evidence
as if it had been run on the current app.

## Review and checks

CodeRabbit completed its one review with seven findings. Its major finding was
valid: the author harness read the address before detail navigation finished and
recorded `R-NaN` in three submission results. The revised harness waits for the
numeric Request address and checks it against both the confirmation link and the
matching home-list link. The successful rerun replaces the invalid report; this
was a verification-record fault, not a Request creation fault.

The six minor suggestions were not applied. Request and comment attachments are
not managed Documents before promotion or filing; changing those terms would
violate the editorial glossary. Downloaded file bytes and private local fixture
files also are not Document records. Knowledge audience and comment visibility
are distinct concepts. The role prerequisite states an enforced access boundary,
not an instruction asking users to obey one. The internal evidence README reports
completed checks and fixture scope, so rewriting it as user commands would obscure
what was actually tested.

All 2,889 API tests and 1,702 web tests passed (all five test tasks), along with
all 19 static tasks and 33 documentation/build-tool tests. Normal and preview
documentation builds passed.

## Independent walkthrough

A different agent, the Fable review seat, first checked the three guides against the
committed app source and then followed them with its own Playwright scripts on
September 7, 2026, against the committed conversations lab, Mailpit, and the preview
reader. It reused the fixture identifiers, the sign-in helpers, and the lab connection
details, not the author's steps or assertions. It created fresh fictional Requests
R-46 to R-50 for the five outcomes and R-51 to R-58 through the form. The sanitized
step records are in [independent-walkthrough.json](independent-walkthrough.json) and
[independent-discovery.json](independent-discovery.json); the per-article evidence
files under `docs/documentation/evidence/` cite them. All three scenarios passed
against the final guide bytes. This is an agent walkthrough, not a human user study,
and it does not stand in for the feature owner's approval.

| Scenario | Role          | Result | Notes                                                                                                                                                                                                                                                                                                                                                        |
| -------- | ------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| V-C09    | Business User | pass   | Type chosen from Before you submit; empty form refused with the questions named and no request sent; Medium default and the four urgencies; 21 files kept as 20 with Remove; complete submission with a PDF, confirmation, Open request, and the home list; aborted upload, decline during upload with the reply link, unknown form, and aborted submission. |
| V-C10    | Business User | pass   | Open, Contract, Matter, Resolved, and Declined Requests: status, banner, reason, Full thread replies and paper only, original attachment bytes, Send needing a message, replies with paper read by Legal, the banner reply link, Amara and staff destinations refused, later Document Versions, Show earlier replies, and all three recovery paths.          |
| V-C11    | Business User | pass   | Eligible guidance only on home and form; same-tab internal link; primary first with current-Version downloads; Guidance; broken external link in a new tab with the form kept; draft, restricted, archived, and unknown items and files refused alike; new Version, unpublish, republish; signed-out refusal.                                                |

The walkthrough removed one sentence from the submission guide. The form's number
question is a native number control that holds an empty value for letters, so the
form reports a missing answer and the "enter this as a number" refusal cannot be
produced by typing in Chromium. The submission and discovery walkthroughs were rerun
in full against the corrected bytes; the records list both tested hashes.

One step in the first follow-up run failed on a reviewer harness assertion: after 55
extra Full thread markers, the newest page no longer carried the reply text the check
looked for. The step is retained in the record, and the two recovery checks were rerun
against unchanged guide bytes and passed. The Knowledge Documents check was rerun with
a filename-keyed byte comparison after its first wording proved ambiguous.

Two observations are recorded rather than guide faults. Deflection links show the
Administrator's label, not the item title; the guide already tells the reader to check
the title under From Legal. The fixture's unavailable external address is served by the
lab app as a not-found route rather than failing at the network; the new-tab and
retained-form checks hold either way. Help with this page on a Portal Request lists
only the follow-up guide, while the Portal header Help combines topics.

Discovery passed on the preview reader: Help with this page from the form and from a
Request, the Portal header Help from the Knowledge and settings pages, search, title
and section focus, the Notification preferences link landing on Change Portal
preferences, anonymous formal reading of all three guides without API calls, and no
horizontal overflow in light, warm, and dark at 320, 720, and 1440 CSS pixels. The
committed lab's normal Help lists none of the review articles. Dispositions and
Knowledge Version changes were applied through the API as staff; DOC-013 and the
Knowledge batches own those controls. The Knowledge fixture's eligibility, filename,
and body were restored afterwards.
