# Contract guide verification

C14–C20 for [issue #734](https://github.com/juggernog20/OpenLaw/issues/734).
Eight guides cover creating and maintaining Contracts, Status changes, approvals,
manual and electronic signing, terms and renewals, Tasks and Key dates, and
relationships, ending, and archiving. All 137 author checks passed on the recorded
article hashes. Independent technical review and the 16 scenario/role walkthroughs
remain pending. Agent checks are not a human user study or a feature owner's approval.

## Build and fixtures

Both isolated fixtures run unchanged app source
`a28331f779da3c8b9e9172dee3cc5b58c7170c7b`. Every author record includes the app and
Document engine image IDs, article hashes, times, roles, actions, and outcomes.
This batch changes no app runtime code.

The conversations lab runs at `http://127.0.0.1:43302`, with Mailpit at
`http://127.0.0.1:48427`. Its draft reader is at `http://127.0.0.1:43312`.
Signing is unconfigured there. Separate browser sessions use Daniel Okafor as
Administrator, Nadia Haddad as Legal Team Member, Ravi Menon as Contributor,
and Priya Raman as another Legal Team Member. Test Contracts, Matters, Fields,
types, Entities, Counterparties, Approver groups, and all paper are fictional.
Setup APIs prepare prerequisites; they do not count as following the future
Administrator configuration guides. Final actions name their own C- references.
Earlier interrupted runs left additional fictional records in these disposable labs.
Private setup and browser helpers remain under `/tmp/openlaw-docs-run/734-*`.

### Electronic signing fixture

The dedicated `signing-workflow` lab runs at `http://127.0.0.1:43303`, with Mailpit
at `http://127.0.0.1:48428` and a draft reader at `http://127.0.0.1:43314`.
Its separate database, storage, worker, mail service, and local provider use the
same immutable application and engine images as the conversations lab.
[Signing fixture provenance](signing-fixture.json) records those identities,
source/configuration digests, and declared provider mode. Its custom Compose
configuration is separate from the managed conversations lab.

The provider is a local DocuSign protocol stand-in based on the pinned app
revision's E2E provider fixture, with an internal-network account URL. The app
and worker point to that provider. Private loopback controls simulate outage,
completion, and decline; signed callbacks reach the real app webhook and the
normal worker files the executed PDF. Provider keys are generated fixture keys.
No real provider account, signer invitation, or external signing transaction is
involved. This satisfies the declared C17 workflow mode; it does not satisfy C42
or verify the provider setup guide. No credentials or callback secrets are published.

## Author walkthroughs

| Evidence                                           | Checks | Results covered                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------- | -----: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Creation](author-create.json)                     |      6 | Required inputs, archived choices, Cancel, Confidential creation, optional Matter link, default Draft/unassigned Owner, independent access, and saved Owner/Entity/Priority/Risk/Description.                                                                                                             |
| [Maintenance](author-maintain.json)                |     12 | Counterparty creation/linking/primary selection/removal, grouped Value save/clear, business and legal Fields, canceled/required edits, type changes, team role removal, Contributor legal-field refusal, and failed-save recovery.                                                                        |
| [Stages](author-stages.json)                       |     10 | All six Stages, configured Status mapping/rename, regression, Signature without an Envelope, Ended edits/History, archive/restore, and Contributor refusal.                                                                                                                                               |
| [Approvals](author-approvals.json)                 |     16 | Parallel named requests, selection/Cancel, individual decisions/notes, wrong-person refusal including Administrator, final decisions, Soft gate override, group membership snapshot/deduplication, requester/Owner cancellation, inaccessible Confidential approvers, and archive freeze.                 |
| [Manual signing](author-manual.json)               |     12 | Unconfigured hand-off, failed upload/retry, Executed kind versus designation, mark/unmark, historical executed PDF bytes after a later upload, explicit Active change, zero Envelopes, and Contributor refusal.                                                                                           |
| [Electronic signing](author-electronic.json)       |     16 | Missing primary/disabled connector, invalid Signers/Cancel, provider outage/retry, selected older primary PDF bytes, second-live refusal, void audience/reason/Cancel, decline, executed filing/pin/bytes, duplicate callback, Signature→Active, preservation of Review, and Contributor/archive refusal. |
| [Terms and renewals](author-terms.json)            |     16 | All term types and clearing rules, real calendar choices, derived notice, month-end proposal, invalid/duplicate/competing rolls, preserved entered date, renewal history, Amendment Version, child/successor prefill and independent responsibility/access, and Contributor/archive refusal.              |
| [Tasks and Key dates](author-tasks.json)           |     16 | Creation/edit/removal, completion/reopening, staged team addition/Cancel, explicit row assignment and retained membership, displayed order, derived versus manual dates, separate same-day events, failed-save recovery, Home Task/date destinations, and Contributor/archive refusal.                    |
| [Relations and ending](author-relations.json)      |     16 | Parent/Cancel/cycle, all typed links and direction, duplicate/self refusal, selective unlinking, Matter relinking and flag advice, Restricted contract, optional confidentiality suggestion, Show ended, Show archived, independent linked work, restore/reopen, and Contributor refusal.                 |
| [Help and formal discovery](author-discovery.json) |     17 | Eight guides in both roles through contextual header Help, title search, focused headings/sections, and formal links; three themes at 320/720/1440 CSS pixels without horizontal overflow; all eight titles available anonymously without app API calls.                                                  |

Browser actions perform the documented user flows. Readback APIs verify saved
values, access refusals, and exact downloaded file bytes. Controlled failed browser
responses exercise upload, Field, and Key date recovery. Approval and renewal
conflict cases use actual other-session or setup API writes and real refusals.
Electronic outage and callbacks use only the declared local provider controls.

For electronic signing, the selected older primary Version is compared with the
PDF received by the provider; supporting paper is separate. Returned executed
paper is compared with the provider's exact output. Repeat completion produces
no additional Version. Signers are fictional external addresses without app accounts.
An independently changed Review Stage survives subsequent successful completion.
Help discovery for this article uses the conversations draft reader; its electronic
workflow proof comes exclusively from the dedicated signing fixture.

## Corrections and limits

The walkthroughs corrected the creation instruction: **Create** returns to the
Contracts list, where the reader opens the new row. Value fields commit as a group.
The record's Activity is opened with **History**. A historical Document Version
shows its original filename. Contributor responses omit legal-tagged Fields and
refuse legal-field edits; supporting upload permission is a separate capability.

After a competing renewal edit, the dialog refreshes the current expiry while
retaining the entered new date. The guide now distinguishes those dates and says
to cancel/reopen for a fresh proposal. After uploading the first primary Document,
the walkthrough reloads before reopening **Renew** to expose the amendment route.
Renewal radio choices were exercised by clicking their visible labels.

Task and Key date creation use **Add task** and **Add date**; edits use **Save**.
The staged assignee picker uses **Use this person**, while direct row assignment
uses **Add to team and assign**. Home's date destination opens a calendar dialog;
it is separate from the assigned-Tasks page. This batch does not claim a new
reminder-delivery test: the notification guide owns those rules and evidence.
The known same-Contract/same-day reminder limitation remains tracked in
[#760](https://github.com/juggernog20/OpenLaw/issues/760).

V-C19 originally requested Task reordering. The current Contract Task screen has
no reordering control, so the scenario now verifies displayed order and the
absence of such a control. The API's reorder operation is not presented as a user
procedure and no UI feature was added for this documentation batch.

A list walkthrough initially failed to find Ended work after enabling the flag.
A separate read confirmed the saved Ended record and the API's inclusion behavior;
a fresh all-records list showed it. Final walkthroughs explicitly start with the
all-records view, then use **Filter** → **Show ended**, and pass in both roles.
The guide tells readers to review other filters/saved views. This is not a claim
that the separate navigation/list issue #751 has been fixed.

Other interrupted runs involved harness assumptions about API field/envelope names,
async save settlement, counted navigation labels, historical filename labels,
radio hit targets, modal titles, the symmetric Related direction, and the header
Help entry. Final records include only the completed runs and the guide hashes they ran
against.

Two guides changed after their author walkthroughs, during the Fable review. The
electronic-signing guide now says a blank subject uses the C- reference and title,
which is the send route's default. The relations guide now names the
**Flag as confidential?** prompt and says that accepting it sets the other
Contract's Confidential flag; the author run only declined that prompt. Both
article evidence records carry the new hashes and a limitation naming the edit.
The author records keep the hashes they ran against. The independent walkthrough
covers the current bytes.

The articles stay in review pending independent verification and linked guides.
Dependencies include Document Versions (DOC-017), analysis (DOC-015), Matter
creation (DOC-016), Approver groups (DOC-021), Signing connector setup (DOC-022),
and the shared conversation/notification/access guides' publication requirements.
DOC-025 owns final acceptance against the supported publication build.

## Repository validation

The full workspace suite passed: 2,889 API tests across 176 files and 1,702 web
tests across 97 files, with all five Turbo tasks successful. All 19 static tasks
and all 33 documentation/tooling tests passed. Normal and preview documentation
builds passed. Preview reports ten links to unpublished targets owned by later
writing batches; independent article acceptance remains pending.

## CodeRabbit disposition

CodeRabbit ran once and reported eleven findings. The substantive clarification
was applied: an Amendment kind does not set an executed designation. The renewal
guide links to explicit marking and explains that selecting another Document
Version replaces the chain's existing designation. The affected walkthrough now
checks the old designation surviving upload and the explicit replacement.

Minor changes expand Counterparty and Document Version terminology, use Approval
Requests in the approval guide, give the Task's actual ISO date/timezone, and
identify all 16 pending independent scenario/role walkthroughs. Author evidence
narration was normalized without changing the recorded execution times or outcomes.
The affected guide walkthroughs were rerun and passed against their new hashes.

The suggestion to call both renewal relationships Renews was rejected: a child
uses the parent chain, and a successor uses the Renews typed link. The evidence
now names each one. The request to make this record's opening imperative was
rejected because it reports verification results rather than instructing a reader.
