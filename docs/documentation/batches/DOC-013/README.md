# Inbox and conversion guide verification

C12–C13 for [issue #733](https://github.com/juggernog20/OpenLaw/issues/733).
This batch completes the triage pilot and covers conversion of a Request to exactly one Contract or Matter.
The author walkthroughs below passed, and the independent source check and browser
walkthrough recorded at the end of this file passed all four scenario and role
combinations. Both articles stay in review only because linked guides are unpublished.
Agent checks are not a human user study.

## Build and fixtures

The immutable conversations lab runs app commit
`a28331f779da3c8b9e9172dee3cc5b58c7170c7b` at `http://127.0.0.1:43302`, with Mailpit
at `http://127.0.0.1:48427`. The draft reader is at `http://127.0.0.1:43312`.
Every record includes the app and Document engine image IDs, guide hashes, date,
role, actions, and observed results. This batch changes no app runtime code.

Separate contexts use Daniel Okafor as Administrator, Nadia Haddad as Legal Team
Member, Jonas Weber as Business User, Amara Nwosu as a second Business User, and
Ravi Menon as Contributor. All Requests, Entities, templates, and PDF files are
fictional. Private fixture setup and browser helpers live under
`/tmp/openlaw-docs-run/733-*`.

The author created request types, destination Fields, two Entities, and Matter
templates through authenticated setup APIs. Main conversion fixtures start with a
carried answer, a Request-only answer, a missing required answer, an Entity reference,
two original PDF attachments, and comments with paper at all three tiers. The Entity
was live when the setup API populated the Request and was then archived. This setup
does not claim that the Portal offers an Entity picker or prove Administrator
configuration procedures; later configuration batches own those guides.

Other fixtures cover a module-only target, an archived configured Contract type,
conversion to the other module, and a Matter template whose optional select value
was removed from the Field options after configuration. The good Matter template
sets defaults, one Task three days after creation, and one Key date five days after
creation. Its Task targets the Matter Manager role.

R-59 and R-68 remain undecided triage examples. R-77 is a historical Declined
fixture created through the API; no current Decline menu action is implied. Main
successful conversion records are C-50/M-33 for Daniel and C-51/M-34 for Nadia.
Each final walkthrough result names its own Request and resulting work references.
Earlier setup/debug runs left additional fictional records in this disposable lab.

## Author walkthroughs

| Evidence                             | Coverage                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Triage](author-triage.json)         | 19 checks: both roles reviewed New Requests and original paper; assigned, reassigned, canceled, and cleared without reserving work; recovered people-load and save failures; posted Full thread clarification; saw the three current Triage actions; canceled/refused blank resolution; resolved with a note while retaining the assignee and Portal conversation; filtered historical outcomes; and lost a competing resolution without posting the losing note. Contributor and Business User Inbox access were refused. |
| [Conversion](author-conversion.json) | 22 checks: each role converted to Contract and Matter after checking routing, carry/stay lists, required gaps, archived Entity replacement, Cancel, and template selection. Resulting record values, original Request values, two promoted Documents and their downloaded bytes, primary designation, retained comment attachments/tiers, Portal replies and reach, and template defaults/Task/Key date results passed.                                                                                                    |
| [Variants](author-variants.json)     | Ten checks: each role switched to the other module, chose a type for deferred routing, replaced an archived configured type, recovered from a stale optional template value using No template and a required answer, and received a real competing-conversion outcome from the second legal session.                                                                                                                                                                                                                       |
| [Discovery](author-discovery.json)   | Five checks: both roles found both guides through page Help, searched the title, followed focused article/section links and the formal link; anonymous formal reading made no app API calls. No horizontal overflow occurred in light/dark/warm at 320/720/1440 CSS pixels.                                                                                                                                                                                                                                                |

The competing-action checks hold the first browser's submission while the second
legal session records its outcome through the real API, then allow the pending
write to reach the server. The first dialog reports the real conflict and reads the
winner's result. Assignment recovery uses a controlled failed browser response;
successful retry writes through the app. The stale template check exercises a real
validation refusal, with the Request still undecided before recovery.

The good template's carried Request answer wins over its default, and the triager's
required answer wins over the template's required-field default. Its optional default
is present. The confirmed Title and High Urgency remain in effect despite a title
prefix, Low default Priority, and Critical default Risk on the template. The new
Matter has no Risk or Matter Manager. Its Task is unassigned, and the dates match three and
five days from the actual creation date in UTC. These are fixture checks of this
conversion flow, not acceptance of the later template-configuration guide.

## Guide correction and evidence limits

The author walkthrough corrected a shared instruction: a Contract has a **Fields**
tab, while a Matter exposes **Custom fields** on **Overview**. The final conversion
and discovery runs use the corrected guide hash. Other interrupted author attempts
were harness mistakes involving a combined error/Retry element, list pagination,
input values, and API envelope names; their incomplete results are not presented as
successful acceptance. The final records all passed against their recorded guide
bytes.

The Fable review seat's source check against the app commit changed three sentences
in the conversion guide after those runs: the Template control appears whenever a
Matter type is set rather than only when templates exist, the template re-review
sentence is now an instruction, and the refused template default recovery names
the case it covers. The conversion, variants, and discovery records keep the hash
they read (`78e63862…`); the current conversion guide hash is `09ba1d03…`. The
triage guide bytes did not change. As in DOC-012, independent acceptance must cover
the final text.

The browser executable expected by the pinned Playwright package was missing from
the shared cache. The author installed it into a private documentation cache and
ran these checks there. This did not change the app, dependency lockfile, or another
workspace's browser cache.

The layout checks measure CSS pixels; they do not establish browser zoom or
assistive technology acceptance. External email delivery is not claimed. The Portal
walkthroughs prove Requester reach as a secondary actor; C12 and C13 require the
Legal Team Member and Administrator, four scenario/role combinations in total.

## Publication dependencies

The conversion guide links to Matter templates (DOC-021), Document Versions
(DOC-017), and request-form configuration (DOC-021). Shared conversation and
notification guides also retain publication dependencies. Both articles stay in
review until independent acceptance and these linked guides are complete. DOC-025
owns final-edition baseline acceptance.

## Review and automated checks

CodeRabbit ran once and reported eight findings. The author corrected shared
result wording that had incorrectly described Matter template checks in Contract
steps, then reran all 56 checks against the revised guides. A triage harness assumption
that a recently resolved Request appeared on the first page failed as the fixture
list grew; explicit Status filtering passed in the final run. The guides now lead with the configured target
and reserve re-targeting for a mis-routed Request. The proposed **Re-target** menu
label was rejected: the current UI exposes the two conversion actions instead.
Role references now distinguish Contract Owner and Matter Manager. The literal
**Triage assignee** label remains because it is the current Request UI. Explanations
of outcomes remain declarative where an imperative would misrepresent behavior.

The initial full suite passed four workspaces and 2,888 of 2,889 API tests. One
notification test observed the delivered email before its database delivery stamp;
the isolated notification file then passed all 20 tests. No runtime change was made
for this unrelated timing failure. The full API rerun then passed all 2,889 tests in 176 files. The other four
workspaces had passed in the initial run, including all 1,702 web tests. All 19
static checks, 33 documentation-tool tests, and normal/preview builds passed.

## Independent walkthrough

A different agent, the Fable review seat, first checked both guides against the
committed app source and then followed them with its own Playwright scripts on
September 7, 2026, against the committed conversations lab, Mailpit, and the preview
reader. It reused the sign-in helpers, the lab connection details, and the author's
type, Field, and template identifiers, not the author's steps or assertions. It created
its own Entities and twenty fresh fictional Requests, R-108 to R-127, with three
replacements (R-128 to R-130) for Requests its earlier runs had decided. The sanitized
step records are in [independent-walkthrough.json](independent-walkthrough.json) and
[independent-discovery.json](independent-discovery.json); the per-article evidence
files under `docs/documentation/evidence/` cite them. All four scenario and role
combinations passed against the final guide bytes, including the corrected conversion
guide (`09ba1d03…`). This is an agent walkthrough, not a human user study, and it does
not stand in for the feature owner's approval.

| Scenario | Role              | Result | Notes                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------- | ----------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V-C12    | Administrator     | pass   | R-108 review and download; list-row Assign, avatar reassign, Cancel, Unassigned; people-load Retry and failed save; Full thread and Legal only reach; three Triage actions and no Decline; blank note refused; R-129 resolved with the note, assignee kept, Portal reply, email; Status filter to R-77 Declined; R-110 competing resolution by Nadia; Ravi and Jonas refused the Inbox.                           |
| V-C12    | Legal Team Member | pass   | The same path on R-118, R-119, R-120, with Daniel as the other session.                                                                                                                                                                                                                                                                                                                                           |
| V-C13    | Administrator     | pass   | R-130 to C-59 and R-112 to M-39 with three-tier paper, dialog refusals, Cancel, Fields and Custom fields, promoted Documents and primary, retained thread, Portal reach after a later Version, Jonas and Amara refused; template defaults, unassigned Task and Key date; R-113 re-target to M-40, R-114 deferred to C-60, R-115 archived type to C-61, R-116 refused default to M-41, R-117 won by Nadia as C-62. |
| V-C13    | Legal Team Member | pass   | The same path on R-121 to C-63, R-122 to M-42, R-123 to M-43, R-124 to C-64, R-125 to C-65, R-126 to M-44, and R-127 won by Daniel as C-66.                                                                                                                                                                                                                                                                       |

The walkthrough changed no guide text. Six earlier reviewer steps failed on harness
locators, not on the app or the guides: an alert whose text sits beside its Retry
button, the retained assignee's span that also carries the avatar initials, a list-row
control already reading Reassign after a prior run, the dialog's single "Priority High"
line, and a Document versions read route that does not exist. Each run was repeated on
unchanged guide bytes and the failed steps are retained in the record with their run tag.

Three observations are recorded rather than guide faults. The retained assignee is
visible immediately after resolution, before any reload. The stale template default is
refused by the API as "<Field>: pick one of the options." while the dialog shows no box
for that optional Field, which is the case the guide's second refusal paragraph covers.
Converts to reads the bare module for a module-only request type and for one whose
configured type was archived, and the dialog then offers the live type picker.

Discovery passed on the preview reader for both roles: Help with this page from the
Inbox and from a Request, exact-title and phrase search, title and section focus, the
related-guide links, formal reading of both guides, anonymous formal reading without
API calls, and no horizontal overflow in light, warm, and dark at 320, 720, and 1440
CSS pixels. The committed lab's normal Help lists neither article.
