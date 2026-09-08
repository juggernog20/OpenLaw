# Troubleshooting, reference, and support verification

Three canonical articles cover C49–C51 for [#744](https://github.com/juggernog20/OpenLaw/issues/744). They complete the writing inventory: 54 articles are on this task branch, with the remaining two integration drafts on PR #783. This is development review content. An independent agent reviewer has now recorded the V-C49, V-C50 and V-C51 walkthroughs; see [Independent review](#independent-review). The user will proofread the assembled suite; no human feature-owner sign-off or publication is claimed.

## Build and method

Author browser actions used app source `6a8873dbda333fd9992eb77525d4bfa3f47af20d`, image `sha256:01f561a674f91137c4e3bb0e0b267c3e1731361dc13182687a5026510b87d7bb`, engine `sha256:1c2f7f6f03395c6cdf05c8e2ab716334a4248587ec655f3cbdfebefb8ffafbf7` and owned project `openlaw-docs-b8e31260-configuration` at 43332. The draft reader at 43333 serves the working documentation bytes over this immutable backend. Its edition declaration still names the earlier development baseline; the version guide expressly distinguishes the documentation declaration from the actual installed build. DOC-025 must reconcile final compatibility without changing historical evidence identities.

Separate authenticated browser contexts use Daniel Okafor as Administrator, Nadia Haddad as Legal Team Member, Ravi Menon as Contributor, and Jonas Weber as Business User. Operator reading uses the signed-out formal reader and a copied export. All data is fictional. API calls prepare a new Confidential Contract, supply team entries as the Administrator for the access-recovery fixture, and upload intentionally damaged Word content into a new Document. Actual visible states, recovery controls, Approval decisions, file downloads and their bytes are checked in the browser. No provider is contacted; disabled controls lead to the documented configuration escalation.

Each record captures its source article hashes and timestamps around awaited actions. These are author observations, not independent or human studies. An author record that stops at a failed step keeps no completion time and no overall flag, so read its steps for the outcome; the independent records below carry `passed` either way. Failed helper attempts remain, including ambiguous Edition details/Supported app locators, the Portal notification link mistaken for a button, the named Approval action's accessible label, and the Status list mistaken for a table. The first attempted damaged-file fixture was plain text with a Word filename; the engine converted it successfully, so the expected failure timed out. A later damaged ZIP archive produced the actual failure and completed the download recovery. The reference record checks the configured Status and opens Tasks; its action label also mentions Key dates, whose distinction was source-reviewed rather than separately exercised in that record. Successful later records retain the narrower meaning of the earlier observations rather than relabeling them.

## Author observations

| Record                                           | Passing observations | Failed attempts |
| ------------------------------------------------ | -------------------: | --------------: |
| [approval-first](author-approval-first.json)     |                    0 |               1 |
| [approval](author-approval.json)                 |                    2 |               0 |
| [discovery-first](author-discovery-first.json)   |                    1 |               1 |
| [discovery](author-discovery.json)               |                   21 |               0 |
| [discovery-second](author-discovery-second.json) |                    3 |               1 |
| [files](author-files.json)                       |                    1 |               1 |
| [files-retry](author-files-retry.json)           |                    3 |               0 |
| [offline](author-offline.json)                   |                    2 |               0 |
| [recovery](author-recovery.json)                 |                    4 |               0 |
| [reference-first](author-reference-first.json)   |                    0 |               1 |
| [reference](author-reference.json)               |                    1 |               0 |
| [symptoms](author-symptoms.json)                 |                    5 |               1 |

Discovery follows actual header Help for all four roles, representative queries, focused article headings, formal links, edition details, 320px layouts in Light/Dark/Warm, unknown editions and missing articles. Anonymous reading issues no app API calls. Blocking the external tracker demonstrates returning to usable local prose. The complete export is copied outside the instance and read under `file://` with networking offline, with and without JavaScript. This check does not stop the shared configuration lab; it proves independence through disk loading and offline browser contexts.

Access checks first observe the generic refusal as two roles, then supply a qualifying team entry and follow Reload to the same record. Contributor legal controls stay absent. A real overlong filename refusal is corrected before uploading once. Approval checks separate the requesting Administrator's cancel permission from the named Legal Team Member's actual decision. Unconfigured Signing and Analysis remain configuration checks, not live-provider verification. The damaged Word archive shows actual pending/failed preview states, preserves the original download bytes, and creates no extra Version; a stored text file downloads directly. Notification checks open the staff and Portal preference surfaces; actual email delivery was verified in earlier canonical notification/configuration batches and is not retested here.

## Source review scope

The author compared the reference to CONTEXT.md, verified canonical role, Contributor, Document, workflow, notification and configuration guides, the fixed roles/Stage/Category vocabulary, the upload limit and filename validation in `apps/api/src/lib/uploads.ts`, and MIME/extension routing in `apps/api/src/lib/render-family.ts`. The version instructions were checked against `documentation-reader.tsx`, `edition.json` and the accepted publishing/support policy. The declared supported build, distribution commit and content digest have different meanings and are described separately. No support email, SLA, implicit latest-version redirect, sequential approval chain or provider assurance is invented.

## Independent review

A second agent, working from the article text rather than the author's scripts, reviewed the source and then followed each article in the browser. It runs the review seat for this task and is not the author. Its source pass corrected one thing before the walkthroughs began: the reference article's title read "file behaviour", against the en-US rule in EDITORIAL.md and against the article's own "File behavior and limits" heading. That correction landed in commit `2570232a` together with the batch-record link and this record's note about aborted runs. Every other claim it checked against `messages/en-US.json`, `apps/api/src/lib/uploads.ts`, `apps/api/src/lib/render-family.ts`, the notifier, `CONTEXT.md` and the canonical guides held.

The walkthroughs used the same immutable backend at 43332 and the working documentation preview at 43333, one isolated browser context per identity, and Playwright 1.62.1 Chromium. Article bytes were the current ones, hashed in each record.

| Record                                                                | Passing observations | Failed attempts |
| --------------------------------------------------------------------- | -------------------: | --------------: |
| [discovery](independent-discovery.json)                               |                   28 |               0 |
| [symptoms](independent-symptoms.json)                                 |                    7 |               0 |
| [symptoms-second](independent-symptoms-second.json)                   |                    6 |               4 |
| [symptoms-retry](independent-symptoms-retry.json)                     |                    4 |               1 |
| [approval-decision](independent-approval-decision.json)               |                    1 |               0 |
| [reference](independent-reference.json)                               |                    9 |               3 |
| [reference-retry](independent-reference-retry.json)                   |                    3 |               0 |
| [versions](independent-versions.json)                                 |                    4 |              12 |
| [versions-retry](independent-versions-retry.json)                     |                   17 |               0 |
| [comparison-and-roles](independent-comparison-and-roles.json)         |                    2 |               0 |
| [operator-reference](independent-operator-reference.json)             |                    2 |               1 |
| [operator-reference-retry](independent-operator-reference-retry.json) |                    3 |               0 |

The reviewer's first discovery run has no JSON record: a later run of the same script name overwrote it. Its verbatim console output is retained as
[independent-discovery-first-tool-output.txt](independent-discovery-first-tool-output.txt), with provenance and its known gaps in
[independent-discovery-first.capture.json](independent-discovery-first.capture.json). The root recovered those bytes from this session's tool_result event at 2026-09-08T11:36:21.561Z; the run's own timestamps, article hashes and build block are gone and are not reconstructed. That run recorded 18 passes and 8 failures: for each of the four app roles the query "which version" did not find the support guide, and the reviewer looked for a recovery link named "roles and record access" when the article's actual link text is "your role and record access". The later run replaced "which version" with "version information". That is a search fallback the reviewer chose, not evidence that "which version" now succeeds; it was never rerun and is expected to keep failing for the reason given below.

Every failed attempt in those records is a reviewer harness fault, not an article defect, and each was corrected and rerun on unchanged article bytes. The reviewer read the article title by the wrong link text, expected an Approve control on the row instead of inside the row's actions menu and its confirmation dialog, expected a Counterparty field where the app says "Counterparties" and "Our entity", read the article's own prose where it meant the Edition details panel, and first built a damaged Word fixture out of prose text, which the document engine converted successfully. A real ZIP container with random content produced the failure the article describes. Two later corrections came from the root's read of these records rather than from a failing step. The first comparison check only reached the Compare control and its summary over-read that as proof that comparing adds no Version; the check was finished properly afterwards. The first operator check listed the roles existing users hold, which cannot establish the set of roles the app permits; it was corroborated afterwards against the actual role control and the source enum. One further observation is search behavior rather than content: local documentation search is a strict all-words match, so a query carrying a function word the article does not use, such as "which version", finds nothing while "version information" and "report a defect" both reach the guide. That behavior is shared by every article and Help still lists the guide by title.

What the walkthroughs actually reached: the four app roles found all three guides through their own header Help and through representative queries, followed the full-documentation link, and reached the named recovery guides. Signed-out formal reading needed no app session. The Contributor was refused a Confidential Contract with the article's generic "Something went wrong." and Reload, and the same link opened after the Administrator added the team entry the article tells the reader to ask for. An over-long filename and a 105 MiB file were both refused with copy a reader can act on, the second naming "over the 100 MB upload limit". A damaged archive reached the pending and then the failed preparation message while its original still downloaded byte for byte. The named approver decided once, through a dialog that itself says "A decision is final. To change it, ask for a new approval.", and an unresolved request raised the "Move past approval" warning. Edition details gave the edition, supported app, distribution commit, content digest and publication target; an unknown edition was reported rather than silently replaced; missing articles and missing sections each offered their named recovery. With the external tracker blocked the support article stayed readable, and the downloaded standalone edition opened from disk in an offline browser context with and without JavaScript. An actual Comparison was computed and read on the seeded three-Version Word Document on C-21: the pair v1 → v2 reached the ready state and showed the counterparty's inserted wording, the chain still held three Versions afterwards, and reopening the pair added none. The Administrator's role control offers only Administrator, Legal team member, Contributor and Business user, and `packages/db/src/schema/auth.ts` declares the same four in `USER_ROLES`; the two are recorded separately as a browser walkthrough and a source inspection. An operator with no app account read the reference itself in the signed-out formal reader, including the Deployment operator row and the `MAX_UPLOAD_MB` fact, with no app API calls.

Signing and Analysis were observed unconfigured. That is the state the articles send the reader to escalate, and it is not evidence about any live provider.

## Remaining acceptance

C42/C43 real-provider checks remain blocked on [#742](https://github.com/juggernog20/OpenLaw/issues/742) and PR #783 and are not waived by this batch. Final whole-suite compatibility, the user's proofread of the assembled suite, and publication remain DOC-025 and DOC-027 gates, so the three articles stay at catalog status `review`.

## Author automated validation

Static checks passed all 19 tasks; documentation/CI tooling passed 33 tests. The full application suite passed all five tasks uncached in 4m59.445s, including 2,890 API tests and 1,704 web tests. Formatting, secret scanning, and the preview/export build passed after adding evidence. Preview reports nine known forward links to the two provider drafts on PR #783. These automated checks supplement the recorded reader walkthroughs.
