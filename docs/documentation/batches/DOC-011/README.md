# Conversation and notification guide verification

Follow C07 and C08 for [issue #731](https://github.com/juggernog20/OpenLaw/issues/731).
The two guides are drafts. Author browser walkthroughs and independent review are not complete.

## App correction and validation build

The first author attempt against pilot source `d1d098ba` found a duplicate comment
in the open record panel after one successful post. The duplicate remained for at
least five seconds. A live read could include the new row before the posting
response appended it again. The same append path existed in the Portal.

Two regression tests delay the posting response until a live read has displayed the
comment. Both failed with two rows before the fix and passed with one row afterwards.
The record applet and Portal now merge the posting response by comment ID and retain
a newer row already received through a live read. These tests use the documentation
validation fixture only to load the test route; they do not verify a user guide.

The author will repeat the guide walkthroughs against a new committed lab build.
The earlier pilot remains available with its original data and images. Partial
walkthrough attempts are not successful guide evidence.

The edition uses one app commit for verified articles. The four articles previously
verified against the pilot are back in review while the app validation build changes:
`find-your-work`, `search-and-views`, `roles-and-access`, and `contributor-guide`.
Their existing evidence keeps its actual pilot commit and results. DOC-025 owns the
fresh acceptance runs against the final app baseline. This does not change their
historical verification result or permit copying it onto a new build identity.

## Draft coverage

C07 covers all four roles, with separate Legal and Portal controls for tiers, mentions,
attachments, corrections, and History. Filing an attachment is linked to DOC-017's
Document guide, where that procedure belongs.

C08 covers both bells, channel preferences, direct asks and replies, briefing choices,
timezones, reminder expectations, and recovery. Administrator lead-time configuration
is linked to DOC-021. Those links keep these articles in review until the targets and
all required independent checks pass.
