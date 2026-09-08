# Troubleshooting, reference, and support verification

Three canonical articles cover C49–C51 for [#744](https://github.com/juggernog20/OpenLaw/issues/744). They complete the writing inventory: 54 articles are on this task branch, with the remaining two integration drafts on PR #783. This is development review content. Technical review and independent walkthroughs remain pending. The user will proofread the assembled suite; no human feature-owner sign-off or publication is claimed.

## Build and method

Author browser actions used app source `6a8873dbda333fd9992eb77525d4bfa3f47af20d`, image `sha256:01f561a674f91137c4e3bb0e0b267c3e1731361dc13182687a5026510b87d7bb`, engine `sha256:1c2f7f6f03395c6cdf05c8e2ab716334a4248587ec655f3cbdfebefb8ffafbf7` and owned project `openlaw-docs-b8e31260-configuration` at 43332. The draft reader at 43333 serves the working documentation bytes over this immutable backend. Its edition declaration still names the earlier development baseline; the version guide expressly distinguishes the documentation declaration from the actual installed build. DOC-025 must reconcile final compatibility without changing historical evidence identities.

Separate authenticated browser contexts use Daniel Okafor as Administrator, Nadia Haddad as Legal Team Member, Ravi Menon as Contributor, and Jonas Weber as Business User. Operator reading uses the signed-out formal reader and a copied export. All data is fictional. API calls prepare a new Confidential Contract, supply team entries as the Administrator for the access-recovery fixture, and upload intentionally damaged Word content into a new Document. Actual visible states, recovery controls, Approval decisions, file downloads and their bytes are checked in the browser. No provider is contacted; disabled controls lead to the documented configuration escalation.

Each record captures its source article hashes and timestamps around awaited actions. These are author observations, not independent or human studies. Failed helper attempts remain, including ambiguous Edition details/Supported app locators, the Portal notification link mistaken for a button, the named Approval action's accessible label, and the Status list mistaken for a table. The first attempted damaged-file fixture was plain text with a Word filename; the engine converted it successfully, so the expected failure timed out. A later damaged ZIP archive produced the actual failure and completed the download recovery. The reference record checks the configured Status and opens Tasks; its action label also mentions Key dates, whose distinction was source-reviewed rather than separately exercised in that record. Successful later records retain the narrower meaning of the earlier observations rather than relabeling them.

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

## Remaining acceptance

Independent technical review and V-C49/V-C50/V-C51 walkthroughs must be recorded before this task merges. Full-suite tests and exact final-head CI are also required. C42/C43 remain blocked on PR #783 and are not waived by this navigation/reference batch. Final compatibility, whole-suite human proof and publication remain later gates.

## Author automated validation

Static checks passed all 19 tasks; documentation/CI tooling passed 33 tests. The full application suite passed all five tasks uncached in 4m59.445s, including 2,890 API tests and 1,704 web tests. Formatting, secret scanning, and the preview/export build passed after adding evidence. Preview reports nine known forward links to the two provider drafts on PR #783. These automated checks supplement the recorded reader walkthroughs.
