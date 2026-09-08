# Complete-suite release readiness

Task [#747](https://github.com/juggernog20/OpenLaw/issues/747). Publication is blocked.
Use this record with the [release checklist](../../RELEASE-CHECKLIST.md). This is
preparation for the complete edition, not a published manual or a proofreading handoff.

## Candidate and owner

The agreed target is `feature-review`, development edition
`documentation-development`, app version `0.0.1`, supported app commit
`6a8873dbda333fd9992eb77525d4bfa3f47af20d`. The application source digest is
`b7bc6323f8e3d95a4ee006eab289f434502dccfdb7aee4c5fcb2026e7c41cd30`.
Record the actual final distribution commit and content digest after all content
and acceptance evidence are assembled. Package version alone does not identify the build.

Blair Wentworth, @juggernog20, owns the handoff and ongoing
[maintenance](../../MAINTENANCE.md). The next full inventory review is due
2026-12-08. Use the existing public issue tracker and documentation correction
form for fictional reproductions; keep organization-specific access questions
with the reader's Administrator.

## Current evidence

The dated [preflight report](preflight.json) records the checked checkout and gate results. The
DOC-025 [G3](../DOC-025/G3.md), [G4](../DOC-025/G4.md) and
[coverage ledger](../DOC-025/coverage.json) retain the actual article evidence.
Do not relabel those historical observations as tests of the final edition.

There are 56 drafted guides: 54 on the feature branch and two provider drafts on
[PR #783](https://github.com/juggernog20/OpenLaw/pull/783). Valid article evidence
covers 54/56 articles and 53/55 groups, including P0 37/39 and P1 16/16.
There are 124 article/role/method requirements and seven additional shared
requirements. Catalog states remain 54 review and two scoped. The complete
publication gate fails. There are no accepted release exceptions or human proof signoffs.

## Destinations to complete

| Destination                                                    | Required final observation                                                                                                                            | Current result                                                                 |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Formal `/documentation` on the owned review instance           | Full normal edition, signed-out reading, navigation, search, edition details and links                                                                | Partial preview evidence retained in DOC-025; final check pending              |
| Staff `/help`                                                  | Administrator, Legal Team Member and Contributor discovery and audience boundaries                                                                    | Partial preview evidence retained; final check pending                         |
| Business Portal `/portal/help`                                 | Business User discovery and links from actual Portal pages                                                                                            | Partial preview evidence retained; final check pending                         |
| Retained standalone directory and archive outside the instance | Full edition while app is stopped, internet blocked, JavaScript disabled and optional asset absent; deliberate missing article detected and recovered | Partial retained-copy evidence exists; complete artifact and checksums pending |
| Clean installation of the candidate image                      | Applicable bundled edition and supported older-link behavior, with no draft placeholders                                                              | Complete normal-edition image check pending                                    |

These are route contracts, not live publication links. Record the actual final
origin and immutable artifact location after publication. The current local
preview is not the final edition. A production deployment or onward merge is a
separate release action.

## Finish in this order

1. Complete C42/C43 with disposable real provider configuration. DocuSign needs
   consent, account-level Connect, controlled Signer inboxes and an HTTPS callback,
   followed by the signing, reconciliation and rotation checks. The supported AI
   provider needs a bounded actual Analysis and failure check. Keep secrets in
   local configuration; record only redacted evidence. Finish independent review
   and merge PR #783 after its checks pass.
2. Reconcile all 56 article hashes, roles, required methods and build compatibility
   into DOC-025. Retain failures and retests. Promote catalog entries only when
   their evidence meets the editorial rules; do not reduce the denominator.
3. From a clean candidate, build the normal edition with all 56 eligible articles
   and zero missing-link warnings. The incremental build can produce this candidate
   before final publication evidence exists. Build the owned app image with its
   exact source commit and clean-state arguments. Retain the same edition outside
   the instance before stopping it for offline checks.
4. Follow every final discovery/offline requirement in the release checklist on
   that full normal edition. Include clean-install entry points, supported older
   links and absence of draft notices. Record actual observer identities, roles,
   methods, times, image/source identities and content digest. Preserve source
   audits separately from the independent acceptance.
5. Record matching `evidence/publication.json` only after those checks pass, then
   commit the evidence and verify the final clean distribution with `pnpm docs:check`,
   `pnpm docs:complete` and `pnpm docs:export`. Confirm the content digest still
   matches the observed edition. Retain the entire output and archive outside the
   instance with checksums and immutable locations; do not overwrite old editions.
6. Record actual served URLs, artifact checksums, final coverage, build identities,
   maintenance owner and any explicit release decisions in this record and #714.
   Close DOC-025/027 only after their requirements pass. Give the user the full
   assembled suite for proofreading; record that proof when it actually happens.

## Build-input correction

The actual Docker context omitted the batch files required by article compatibility
reviews. [Before/after validation](docker-context.json) reproduced 36 evidence
failures among the 54 retained guides. Including retained batch evidence in the
build context makes all 54 pass the same compiler evidence checks. Planning files
such as PLAN.md, MAINTENANCE.md and project.json remain excluded. The runtime
image copies compiled app output; this change does not add source evidence to the
public reader. The two provider drafts and final publication remain outside the
credited result.

To repeat the context check, export `COPY docs/documentation/ /metadata/` from a
`FROM scratch` Dockerfile with Buildx's local output and this repository as its
context. Run `verifyArticleEvidence` from `scripts/documentation/compiler.mjs`
against that exported metadata for each available canonical guide. This tests
Docker's actual ignore behavior instead of approximating its pattern rules.

## Author validation

On 2026-09-08, the task worktree passed 41 documentation/CI-tool tests, 19 static
tasks, normal and preview documentation builds, local Markdown links and the
Docker context before/after check. The full application suite passed all five
tasks without cache in 4m20.212s, including 2,890 API and 1,704 web tests.
The preview retains nine expected links to the two pending provider guides.
These results do not complete final guide acceptance or publication.
