# Complete-suite release record

Task [#747](https://github.com/juggernog20/OpenLaw/issues/747). Use this record with
the [release checklist](../../RELEASE-CHECKLIST.md). The complete edition passed its
gates in DOC-029. The target is the development app, published by merging to `dev`.
A production deployment is a separate release action.

## Candidate and owner

- Edition: `documentation-development`, development channel, app version `0.0.1`.
- Supported app commit: `432dba3a835863091791fbac429a6a66777bdc40`.
- Application digest: `9e8b316321c219b1c2c68fb3dff63708a5f9be87f33455b687e52d6aa56ae13c`.
- Content digest: `09293453cbde7ba5da56f0e9e2fce299d5770bb1985e1535b81923c27a0c5277`.
- Distribution commit checked by V-HELP and V-OFFLINE: `366a78a83a4f7ece2e5d63a739b6cd6d2ebc0f57`.
  Later commits on the branch change only batch records and reports, not reader content.

Blair Wentworth, @juggernog20, owns the handoff and ongoing
[maintenance](../../MAINTENANCE.md). The next full inventory review is due
2026-12-08. Use the public issue tracker and the documentation correction form for
fictional reproductions. Organization-specific access questions go to the reader's
Administrator.

## Result

All 57 guides are `verified`, with valid evidence for 110 of 110 article, role and
method requirements across 56 of 56 coverage groups (P0 39/39, P1 17/17). V-HELP
and V-OFFLINE pass for all six shared requirements, recorded in
[publication.json](../../evidence/publication.json). `pnpm docs:check`,
`pnpm docs:complete` and `pnpm docs:export` pass on a clean distribution. The
[DOC-029 record](../DOC-029/README.md) describes the three verification rounds, and
the [G3](../DOC-025/G3.md) and [G4](../DOC-025/G4.md) reports pass.

| Destination                          | Final observation                                                                                                                                                                                     |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Formal `/documentation`              | Signed-out reading of all 57 guides, search, recovery for unknown articles, anchors and editions, and no data API calls                                                                               |
| Staff `/help`                        | Administrator and Legal Team Member discovery, contextual topics, audience boundaries, keyboard, themes, narrow layout and 200% zoom                                                                  |
| Business Portal `/portal/help`       | Business User discovery of the 12 Portal guides and the signed-out redirect with fragment                                                                                                             |
| Retained standalone edition          | Read and searched from disk with the instance stopped, internet blocked, JavaScript off and optional assets missing; a removed article failed the checksum check and recovered from the retained copy |
| Clean install of the candidate image | The V-HELP lab was a fresh install built from `366a78a8` and served the complete edition with no draft notices                                                                                        |

`redirects.json` holds no aliases, so there were no older links to follow. The
retained archive checksums are in publication.json. The archive the app image
serves differs in bytes from the `docs:export` archive in `redirect.js` and
`search.js` only, because the image build bundles the compiler.

## Open items

- Human proofreading of the assembled suite has not happened. Every check is an
  independent agent check.
- [#888](https://github.com/juggernog20/OpenLaw/issues/888): DocuSign Webhook mode
  against a live Connect callback.
- DES-073, PUBLISHING.md and `help-contexts.json` still describe the staff
  "Help with this page" link that `41390ca0` removed from the Inbox.

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
