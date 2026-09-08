# DOC-022 provider configuration drafts

Task [#742](https://github.com/juggernog20/OpenLaw/issues/742), parent [#714](https://github.com/juggernog20/OpenLaw/issues/714). Two complete prose drafts cover C42/C43. This batch is **blocked on real disposable provider access** and is not complete or approved for publication.

## Content

- [Configure the Signing connector](../../../user-guides/configure-signing.md): DocuSign account preparation, JWT consent, account-level Connect JSON/HMAC callbacks, save versus test versus full round-trip verification, manual optionality, disabled/removal behavior, rotation and recovery.
- [Configure the AI connector and Field prompts](../../../user-guides/configure-analysis.md): the separate AI analysis Settings destination, seven provider presets, endpoints/keys, core and catalog Field prompts, automatic triggers and actual bounded text flow, disabling, rotation and failure recovery.

Provider instructions were consulted on September 8, 2026. [Primary source records](primary-sources.json) identify the pages and what was checked. No provider console or account has been exercised. The guides deliberately distinguish the configuration badge from a successful connection test and from a completed business workflow. No application code changes are included.

## Author observations

The author used the owned `openlaw-docs-b8e31260-configuration` lab at immutable source `6a8873dbda333fd9992eb77525d4bfa3f47af20d`, app image `sha256:01f561a674f91137c4e3bb0e0b267c3e1731361dc13182687a5026510b87d7bb`, engine image `sha256:1c2f7f6f03395c6cdf05c8e2ab716334a4248587ec655f3cbdfebefb8ffafbf7`. Each observation file records its actual time and article hashes.

| Record                               | Passing observations | Scope                                                                                                                                                                                                                                         |
| ------------------------------------ | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Local Settings](author-local.json)  | 7                    | Initial controls, fictional signing save/blank retention/disable/removal, seven AI preset forms, closed-loopback AI connection failure, key retention/removal, core prompt save/revert/reset, Legal Team Member and Contributor API refusals. |
| [Catalog Fields](author-fields.json) | 2                    | Contract-scoped prompt versus Global controls, saved prompt, exact Field attachments to a new Type, prompt edit and removal.                                                                                                                  |
| [Discovery](author-discovery.json)   | 3                    | Both Settings Help contexts, title search, outline heading focus, formal links, keyboard access, three themes at 320/720/1440 pixels, emulated 200% zoom, and anonymous formal discovery without app API requests.                            |

These are 12 successful author observations, not 12 independent reviewers or completed provider scenarios. No unsuccessful author attempts occurred in these recorded runs. Source inspection additionally checked the provider adapters, live connector resolvers, automatic Analysis triggers, target selection, writer behavior, and signing callback parsing.

The local signing credentials were newly generated fictional values and were never sent to DocuSign. The AI endpoint was an intentionally closed loopback port with a placeholder key. Its failure proves local network-error handling only. Both temporary connectors were removed after checking them, and the edited core prompt was reset to its original default. New fictional Field/Type definitions remain in the owned lab. No secrets are retained in these evidence files.

## Required live checks still blocked

| Scenario                          | Missing prerequisite                                                                                                                                     | Required remaining result                                                                                                                                                                      |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V-C42, Administrator and operator | Disposable DocuSign developer account, integration/consent and Connect access, controlled Signer inboxes, and an approved public HTTPS callback address. | Verify actual account setup and consent, connection test, completed Envelope and executed paper, invalid credentials, disable/re-enable, webhook/reconciliation recovery, and secret rotation. |
| V-C43, Administrator and operator | Disposable supported AI-provider account/key, model access, and a bounded fictional input.                                                               | Verify actual connection and Analysis output/evidence, core/catalog prompts, invalid key/model/endpoint, provider refusal, and disabling.                                                      |

Both required methods, `browser-walkthrough` and `live-provider-check`, remain blocked for each role. Local stand-ins from the earlier signing and Analysis workflow batches do not satisfy these requirements. Neither article is marked verified; the catalog remains draft, and the writing checklist remains unchecked. The 56-article/55-coverage-group complete-suite denominator is unchanged. No exception has been requested or accepted.

## Checks and review

Author repository checks passed: formatting, secret scanning, contrast/migration/version checks, documentation lint, and all 19 lint/typecheck tasks without cache reuse; documentation/CI tooling passed 33 tests. The full test suite passed all five tasks without cache reuse in 4m6.187s, including 2,890 API tests. No browser walkthrough ran concurrently with that suite.

The normal documentation build passed with zero warnings and excludes these drafts. The explicit preview passed with six known forward-link warnings to DOC-023 operator articles. Independent review is pending; its outcome will be recorded without changing the live-provider blocker.

CodeRabbit ran once for this task and returned six minor findings. Applied three terminology/clarity suggestions: Analysis run wording and explicit identification of the executed Document Version in both guides. Retained descriptive prose in the two internal status records and the tracked DOC-023 forward link. The pin describes a Version marked as executed, without claiming that the designation proves its contents are signed. These copy clarifications preserve the earlier author observations and their original hashes.
