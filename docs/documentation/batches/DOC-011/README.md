# Conversation and notification guide verification

Record C07 and C08 for [issue #731](https://github.com/juggernog20/OpenLaw/issues/731).
Both guides remain in review. The author walkthroughs below passed; independent
source review and walkthrough evidence are pending. Agent checks are not a human user study.

## Build and fixtures

The committed app is `a28331f779da3c8b9e9172dee3cc5b58c7170c7b`, served by the
`openlaw-docs-b8e31260-conversations` lab at `http://127.0.0.1:43302`. Mailpit is at
`http://127.0.0.1:48427`. Each evidence record includes the app and Document engine
image IDs. The draft reader runs at `http://127.0.0.1:43312`; normal Help excludes
these articles until verification and their linked dependencies are complete.

Daniel Okafor is the Administrator, Nadia Haddad the Legal Team Member, Ravi Menon
the Contributor, and Jonas Weber the Business User. Separate browser contexts use
fictional seed accounts. Contract C-33 and Matter M-22 originated from Jonas's
Requests R-17 and R-18; R-16 is unconverted. Daniel owns/manages the resulting work,
Nadia is a Member, and Ravi is a Contributor on both teams. All paper is fictional PDF.

The author created these fixtures through authenticated APIs. Fixture setup is not
proof of following the later configuration, intake, or record-creation guides.
Private fixture files and browser scripts are under `/tmp/openlaw-docs-run/731-*`.
No production accounts, customer data, or external email delivery are involved.

## Author walkthroughs

| Evidence                                       | Result                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Comments](author-comments.json)               | 25 checks: all three non-Portal roles posted at their available tiers on Contract and Matter with retrievable paper; Jonas saw only Full thread and replied on unconverted and converted Requests; selected mentions, widening/cancel, own edit/delete, Administrator redaction, and History passed.      |
| [Notifications](author-notifications.json)     | 24 checks across all four roles: preferences persisted, Email off preserved a bell item, Email on delivered to Mailpit, In-app off suppressed both new channels, links opened the correct destination, and failed saves/reads recovered.                                                                  |
| [Recovery](author-recovery.json)               | 12 checks across all four roles: file selection capped at five, removal restored capacity, a failed post retained text and paper, retry posted once, failed conversation reads recovered, and failed earlier-page reads retained the conversation and recovered.                                          |
| [Bell boundaries](author-bell-boundaries.json) | Five checks: each role's bell marked its first 25 items read, Mark all read cleared the remainder, and Show older loaded/focused more rows. Removing Ravi from C-33 hid its prior bell items and refused the old direct destination; restoring his entry restored access.                                 |
| [Morning](author-morning.json)                 | Nine checks across fresh Administrator, Legal Team Member, and Contributor accounts: a profile timezone before 08:00 deferred the briefing; changing it to an eligible timezone delivered the selected Tasks/Dates sections and a Home-linked bell; another round that local day sent no second briefing. |
| [Discovery](author-discovery.json)             | Both articles appeared through contextual Help for all four roles. Search, article/section focus, formal links, anonymous formal reading, and three themes at 320/720/1440 CSS pixels passed. These checks do not claim browser zoom or assistive technology acceptance.                                  |

Mail absence was observed for 2.5 seconds after the controlled event, paired with a
positive enabled-email delivery through the same running worker. These bounded checks
do not establish that an arbitrary external relay will never deliver late mail.
Notification settings were restored after each role's channel checks.

The morning test used fresh fictional accounts and a separate Contract containing
one due-today Key date and three assigned Tasks. It changed timezone and briefing
choices through the UI. The optional HTTP round trigger is disabled in this app;
the author queued `notification.morning-round` through the existing lab worker's
pg-boss connection and waited for each job to complete. The running worker used its
real clock, notifier, mailer, and queue. Neither the app image nor its immutable
configuration was changed. This fixture operation is not a user-facing scheduling procedure.

Each evidence file retains the guide hash read when that run began. The notification
guide later gained the same-date limitation below, and review then replaced one curly
apostrophe with a straight one; earlier records remain historical checks of their
recorded revision. Independent acceptance must cover the final text.

## App correction and known limitation

The first author attempt against pilot source `d1d098ba` found a duplicate comment
in the open record panel after one successful post. The duplicate remained for at
least five seconds. A live read could include the new row before the posting
response appended it again. The same append path existed in the Portal.

Two regression tests delay the posting response until a live read has displayed the
comment. Both failed with two rows before the fix and passed with one row afterwards.
The record applet and Portal now merge the posting response by comment ID and retain
a newer row already received through a live read. The two affected test files passed
all 354 tests. These regression tests do not replace guide walkthrough evidence.
The successful walkthroughs above ran against the new committed app containing the fix.

The morning checks also found that distinct Key dates sharing a record and date can
collapse into one named reminder. [Issue #760](https://github.com/juggernog20/OpenLaw/issues/760)
records the observed mail and current uniqueness rule for product triage. The guide
states this limitation and directs readers to the full Key dates list. This batch
does not change reminder identity or promise every same-date label appears in mail.

## Publication dependencies and baseline revalidation

C07 links attachment filing to DOC-017's Document guide. C08 links Administrator
lead-time configuration to DOC-021. These articles stay in review until those targets,
other linked guides, and required independent checks pass.

The edition uses one app commit for verified articles. Four articles previously
verified against the pilot are back in review after this app correction:
`find-your-work`, `search-and-views`, `roles-and-access`, and `contributor-guide`.
Their existing evidence retains its actual pilot commit and results. The earlier
pilot remains available with its original data and images. DOC-025 owns fresh
acceptance against the final baseline, as recorded in the
[handoff](https://github.com/juggernog20/OpenLaw/issues/745#issuecomment-5566873641).
This preserves the historical verification result without copying it onto a new build.

## Checks and first review

All 2,889 API tests and 1,702 web tests passed, along with all 19 static tasks and
33 documentation/build-tool tests. Normal and preview documentation builds passed.
The final Help discovery run followed completion of the API suite: running it while
test containers changed Docker networks produced Chromium `ERR_NETWORK_CHANGED`;
that interrupted attempt is not a successful verification record.

CodeRabbit completed its one review of this task with three findings. Two optional
style suggestions asked for imperative wording in the role prerequisites and channel
consequences. The current statements were retained: prerequisites compare role access,
and the channel paragraph explains the result of a choice rather than directing users
to disable a channel. The third reported duplicate mailbox/delivery guidance; inspection
found one such instruction in the guide, so no removal was warranted. No functional
finding was reported. Independent source review and walkthroughs remain pending.
