# Matter guide verification

C22–C24 for [issue #736](https://github.com/juggernog20/OpenLaw/issues/736).
Three separate articles cover creation/templates, Status and archive lifecycle,
and Tasks, Key dates, and relationships. Author checks passed. The Fable review
seat then checked the guides against the app source and walked all six
scenario/role combinations independently; the per-article evidence records read
`pass`.

## Build and evidence

The fictional conversations lab runs app source
`a28331f779da3c8b9e9172dee3cc5b58c7170c7b`, app image
`sha256:7434e1b1802330e3f3499a0fba3dfcc0b8a04fc875561071e17f4ad5a1c29c0d`,
and engine image
`sha256:16ab8ea3bcaf1d43619d6e3cff879d2f313c5e366a36a7ae285a5baa7ae15ed0`.
Its project is `openlaw-docs-b8e31260-conversations`; app/mail ports are
43302/48427 and the draft Help preview is 43312. This change edits no app runtime
or immutable lab input. Guide hashes and actual UTC check times are in the
records below. Organization timezone is Europe/London; template offsets are
resolved from the Matter's UTC creation date.

Fictional Daniel Okafor (Administrator) and Nadia Haddad (Legal Team Member)
followed each guide in distinct browser contexts. Ravi Menon (Contributor) and
Priya Raman (a separate Legal Team Member) supplied permission checks. API calls
prepared prerequisites and read back saved state; the procedures credited as
walkthroughs used the actual browser controls. No screenshots are necessary to
follow these text guides. Agent checks are not a human user study or owner approval.

| Author record                      | Checks | Coverage                                                                                                                                                    |
| ---------------------------------- | -----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Creation](author-create.json)     |     14 | Required Fields, direct creation, references, Manager/team permissions, type changes, templates, relative dates, stale template and optional-clear recovery |
| [Lifecycle](author-lifecycle.json) |     12 | Same-Category Status, renamed labels, Close/Reopen, child advisory, writable closed work, archive/restore, filters and Contributor refusals                 |
| [Matter work](author-work.json)    |     18 | Task assignment/team expansion, completion/order/edit/removal, Key dates, hierarchy and flat relations, linked Contracts and access boundaries              |
| [Discovery](author-discovery.json) |      7 | Six role/article Help searches and formal links, heading focus, three themes at three widths, anonymous formal index                                        |

The 51 author checks identify tested guide bytes. Detailed outcomes distinguish
the acting role from fixture setup and from a different reader's refusal check.
The independent walkthrough below is recorded separately and is what marks the
per-article evidence records passed.

## Corrections and limits

The release uses fixed open/closed Categories with configurable Status labels.
The inline Status selector stays in the current Category; Close/Reopen have
separate dialogs. Closing is editable, retains child/Contract states and Tasks,
and removes active deadline eligibility. Archive freezes changes. Restore of a
closed Matter preserves its closed Status, so both Show archived and Show closed
may be needed to find it. Both legal roles verified these behaviors, superseding
older inventory assumptions about lifecycle and Administrator-only restore.

[Issue #770](https://github.com/juggernog20/OpenLaw/issues/770) records a reproduced
application defect: an optional template Field cleared during creation receives
its template default again on the saved Matter. Both roles verified that clearing
it on Overview persists; the guide explains that workaround and nonempty overrides.
The application fix is separate from this documentation task.

The Matter/Contract link shows **Confidentiality differs**, with an informational
**Leave them as they are** action; it does not offer to set a flag. This differs
from the Contract-to-Contract relationship suggestion. The Matter guide uses the
actual link dialog and confirms that both flags stay independent. Counterparties
remain on linked Contracts; the Matter creation form has no Counterparty control.
Entity and person references do not grant access to their referenced records.

Early author attempts stopped on harness assumptions: a disabled audience button
was initially expected to be absent; the Counterparty setup route and the
Confidentiality dialog's M-/C- references required correction. Completed records
come from fresh complete runs after those corrections. Disposable earlier records
remain in the owned lab. Existing known app issues are not presented as fixed.

Shared Document and administrator configuration guides are scheduled later in the
program. Their links remain publication dependencies. Request conversion and
Contributor guidance are linked rather than duplicated. DOC-025 still governs
final suite acceptance and DOC-027 governs actual publication.

## Independent walkthrough

The Fable review seat first checked each guide's claims against the committed app
source at `a28331f7` (the creation body and template instantiation, the lifecycle
handler, the Key date Next rule, the relation and Contract-link routes, and the
role guards), then followed the three guides with its own Playwright scripts on
September 7, 2026, in the same conversations lab. It reused the author's Matter
types, Fields, templates, Statuses, Entity and Contract type by identifier, not
the author's steps or assertions. Every walked record was created fresh with a
`Rev` prefix.

C22 ran as Administrator and Legal Team Member: refused creation for a missing
title and a missing required Field, direct Confidential creation with Entity and
person references (the referenced person could not read the Matter), Overview
edits including a refused required clear and Change matter type, explicit team
roles with Priya Raman as the outsider, the single template's auto-selection and
No template reset, template creation with UTC offsets and the Manager-targeted
Task, the #770 optional-default return and its Overview workaround, a template
archived while the form was open, and the Contributor's refusal.

C23 ran as both roles: the open-only Status control with a relabelled open
Status, the Close dialog with a plain child and a Confidential child (Restricted
Matter for the Legal Team Member), Cancel and confirm, writes while closed, Show
closed, Reopen Cancel and confirm with the Key date back on Next, Archive Cancel
and confirm with the child and linked Contract unaffected, both filters to find
a closed archived Matter, Restore Cancel and confirm, the Contributor's read
without lifecycle controls, and History.

C24 ran as both roles: the blank Task refusal, staging a person through Add
someone to the team… with Cancel and with save, Add to team and assign on a row,
completion, Move down, Edit Task and Remove Task, Key dates with Overdue, Next
and Upcoming states and the confirmed removal, the closed Matter's dates, Set
parent with Cancel, the refused loop, a flat relation on both records and its
removal, New sub-Matter, Restricted Matter for an unreadable relation, Link
Contract with Confidentiality differs and Leave them as they are, Restricted
contract for the Contributor, the refused second link, Unlink and the move, the
Contributor's read-only sections, and the archive freeze and Restore.

The discovery run checked, for both roles, the contextual Help topics from the
Matters list and a Matter record, exact-title search, heading focus for the title,
an outline section and a direct section link, and the full documentation link;
signed out, the formal index and search list all three guides with no
application API request, and the three articles fit 320, 720 and 1440 CSS pixels
in the light, dark and warm themes without horizontal overflow.

All 44 walkthrough steps and 7 discovery steps passed. They are in
[independent-walkthrough.json](independent-walkthrough.json) and
[independent-discovery.json](independent-discovery.json); the per-article
evidence files under `docs/documentation/evidence/` cite them, together with the
two supplementary records below, and now read `pass`. Earlier reviewer runs
failed on harness assumptions (a number Field is a spinbutton, the Key dates tab
needed a reload after Reopen, the Filter button is renamed once a filter is
active, a completed Task's checkbox is named Reopen
Task, and the Contributor sees a parent he is not on as Restricted Matter), not
on app or guide behaviour; the records name them and hold only the completed
runs. No guide text changed because of the walkthrough. This is an agent
walkthrough, not a human user study, and it does not stand in for the feature
owner's approval.

## Template content check

The C22 walkthrough's template-edit step changed only the template description
and the Matter Manager. A supplementary run,
[independent-template-content.json](independent-template-content.json), edits
the owned single-template fixture's actual content. For each reader role: the
role created a Matter from the template in the browser and its copied rows were
read; the Administrator's API session then replaced the template's Tasks and Key
dates (Task 1 title and offset 3 to 5, Key date 2 label and offset 7 to 9); the
role reloaded the earlier Matter's Tasks and Key dates tabs and the rows were
unchanged, field for field; the role created a fresh Matter and it copied the
edited title at +5 and the edited label at +9; the Administrator's API session
put the saved content back and the read-back equalled the pre-run copy on every
compared field. The fixture steps are marked separately from the role's browser
steps. This is reviewer fixture setup through the lab's own template, not
acceptance of the DOC-021 administrator guide, and no immutable deployment input
changed.

## Keyboard operation and 200% zoom

VALIDATION.md asks Help checks to cover keyboard operation and 200% zoom. The
discovery record above covers themes, widths and focus; the supplementary
[independent-accessibility.json](independent-accessibility.json) covers the
rest for both reader roles and all three guides. Keyboard only: Tab from the Help
index to the guide link and Enter opened it with the title focused (a solid
3 px focus ring on the link); Tab to an outline section and Enter moved to the
section with its heading focused; Tab to the search box, the typed title and
Enter listed the guide and Tab plus Enter opened it; Tab to the full
documentation link and Enter opened the formal page with the title focused. For
zoom, the run emulated 200% as a 640 by 450 CSS-pixel viewport at device pixel
ratio 2, which is the layout Chromium produces for a 1280 by 900 window at its
200% zoom setting; Playwright has no zoom menu, so the browser's own control was
not operated. At that layout each Help article and its formal page fit without
horizontal overflow, paragraphs computed at 14 px and titles at 32 px, and the
search box, outline and full documentation link stayed visible and worked.

## Repository validation

After the browser runs and the evidence records, the review seat ran the full
workspace suite in the foreground
(`pnpm exec turbo run test --continue -- --maxWorkers=8`, inside the docker
group with the prebuilt `openlaw-doc-engine:test` image): 176 API test files
with 2,889 tests and 97 web test files with 1,702 tests passed, all five Turbo
tasks successful, exit code 0, in 3 minutes 56 seconds. The documentation build
in its normal and preview forms, the 24 documentation tooling tests, prettier,
the documentation lint, and secretlint on the new records also passed.

## CodeRabbit disposition

The single CodeRabbit run raised five findings. The terminology suggestion is
applied: the creation guide names the Matter Manager explicitly. The two status
prose suggestions are declined because these are evidence reports, not user
procedures; descriptive pending/pass statements preserve their meaning.

The two major suggestions to remove Restricted Matter descriptions are not valid
for this build. MTR-015 and the Closing addendum specify restricted relationship
placeholders that carry no title, number, or navigation. The actual Related
Matters card and Close dialog
render **Restricted Matter** without the title, number, or navigation, and the
Legal browser checks verify that result plus direct 404. The guides retain the
implemented label so readers can understand what they see; they do not claim
every Confidential Matter is inaccessible. No application access policy changes
are included here.
