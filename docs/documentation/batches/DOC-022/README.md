# DOC-022 provider configuration drafts

Task [#742](https://github.com/juggernog20/OpenLaw/issues/742), parent [#714](https://github.com/juggernog20/OpenLaw/issues/714). Two complete prose drafts cover C42/C43. This batch is **blocked on the remaining provider round trips and independent acceptance** and is not complete or approved for publication.

## Content

- [Configure the Signing connector](../../../user-guides/configure-signing.md): DocuSign account preparation, JWT consent, account-level Connect JSON/HMAC callbacks, save versus test versus full round-trip verification, manual optionality, disabled/removal behavior, rotation and recovery.
- [Configure the AI connector and Field prompts](../../../user-guides/configure-analysis.md): the separate AI analysis Settings destination, seven provider presets, endpoints/keys, core and catalog Field prompts, automatic triggers and actual bounded text flow, disabling, rotation and failure recovery.

Provider instructions were consulted on September 8, 2026. [Primary source records](primary-sources.json) identify the pages and what was checked. The initial local batch did not exercise a provider account. The resumed DocuSign checks below use the real developer account supplied by the user. The guides deliberately distinguish the configuration badge from a successful connection test and from a completed business workflow. No application code changes are included.

## Initial author observations

The author used the owned `openlaw-docs-b8e31260-configuration` lab at immutable source `6a8873dbda333fd9992eb77525d4bfa3f47af20d`, app image `sha256:01f561a674f91137c4e3bb0e0b267c3e1731361dc13182687a5026510b87d7bb`, engine image `sha256:1c2f7f6f03395c6cdf05c8e2ab716334a4248587ec655f3cbdfebefb8ffafbf7`. Each observation file records its actual time and article hashes.

| Record                               | Passing observations | Scope                                                                                                                                                                                                                                         |
| ------------------------------------ | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Local Settings](author-local.json)  | 7                    | Initial controls, fictional signing save/blank retention/disable/removal, seven AI preset forms, closed-loopback AI connection failure, key retention/removal, core prompt save/revert/reset, Legal Team Member and Contributor API refusals. |
| [Catalog Fields](author-fields.json) | 2                    | Contract-scoped prompt versus Global controls, saved prompt, exact Field attachments to a new Type, prompt edit and removal.                                                                                                                  |
| [Discovery](author-discovery.json)   | 3                    | Both Settings Help contexts, title search, outline heading focus, formal links, keyboard access, three themes at 320/720/1440 pixels, emulated 200% zoom, and anonymous formal discovery without app API requests.                            |

These are 12 successful author observations, not 12 independent reviewers or completed provider scenarios. No unsuccessful author attempts occurred in these recorded runs. Source inspection additionally checked the provider adapters, live connector resolvers, automatic Analysis triggers, target selection, writer behavior, and signing callback parsing.

The local signing credentials were newly generated fictional values and were never sent to DocuSign. The AI endpoint was an intentionally closed loopback port with a placeholder key. Its failure proves local network-error handling only. Both temporary connectors were removed after checking them, and the edited core prompt was reset to its original default. New fictional Field/Type definitions remain in the owned lab. No secrets are retained in these evidence files.

## Resumed DocuSign author checks

The user supplied a signed-in developer account on 2026-09-08. The author created
one dedicated validation integration, uploaded locally generated public RSA keys,
completed individual consent and created a Connect HMAC key. Secrets remain in
private local configuration and the encrypted owned test-instance connector.
[The setup record](author-live-signing-setup.json) identifies the actual scope.

[Live authentication](author-live-signing-auth.json) passed seven checks: intended
account, secret hiding after reload, blank-secret retention, invalid-key refusal,
key recovery, disabled-connector refusal and re-enabled authentication. These
observations use the same app source with the rebuilt app image recorded in that
file. Earlier observations keep their original image identity and timestamps.

RSA rotation retained its [first failed attempt](author-rsa-rotation-first.json)
and [successful retry](author-rsa-rotation-activated.json). The original public key
was removed only after the replacement authenticated. The replacement then passed
[a connection check](author-rsa-rotation-retired.json) and
[a fresh-driver check](author-rsa-rotation-fresh.json) after the original key was
retired. The latter saved the unchanged connector first to invalidate its cached
provider driver. The initial failure does not establish a fixed propagation delay.

No Envelope has been sent. A permitted test recipient and a public HTTPS callback
are still needed for the complete Signing workflow. No Connect subscription,
callback/reconciliation recovery, executed-copy filing or HMAC rotation is claimed.
These author checks do not complete either required role/method scenario or the
independent walkthrough. AI-provider access remains unavailable.

## Required live checks still blocked

| Scenario                          | Missing prerequisite                                                                                                                                                 | Required remaining result                                                                                                                                     |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V-C42, Administrator and operator | Approved test Signer inbox and public HTTPS callback address. Developer account access, authentication and RSA rotation are now available and checked by the author. | Complete the Envelope/executed-copy round trip, callback/reconciliation recovery and HMAC rotation. Finish independent verification of every required action. |
| V-C43, Administrator and operator | Disposable supported AI-provider account/key, model access, and a bounded fictional input.                                                                           | Verify actual connection and Analysis output/evidence, core/catalog prompts, invalid key/model/endpoint, provider refusal, and disabling.                     |

Both required methods, `browser-walkthrough` and `live-provider-check`, remain blocked for each role. Local stand-ins from the earlier signing and Analysis workflow batches do not satisfy these requirements. Neither article is marked verified; the catalog remains draft, and the writing checklist remains unchecked. The 56-article/55-coverage-group complete-suite denominator is unchanged. No exception has been requested or accepted.

## Initial checks and review

Author repository checks passed: formatting, secret scanning, contrast/migration/version checks, documentation lint, and all 19 lint/typecheck tasks without cache reuse; documentation/CI tooling passed 33 tests. The full test suite passed all five tasks without cache reuse in 4m6.187s, including 2,890 API tests. No browser walkthrough ran concurrently with that suite.

The normal documentation build passed with zero warnings and excludes these drafts. The explicit preview passed with six known forward-link warnings to DOC-023 operator articles. Independent technical source review is complete; required independent browser/live-provider walkthroughs remain blocked.

CodeRabbit ran once for this task and returned six minor findings. Applied three terminology/clarity suggestions: Analysis run wording and explicit identification of the executed Document Version in both guides. Retained descriptive prose in the two internal status records and the tracked DOC-023 forward link. The pin describes a Version marked as executed, without claiming that the designation proves its contents are signed. These copy clarifications preserve the earlier author observations and their original hashes.

Code review found one further error and corrected it: `configure-analysis` told the reader to expand the **Field prompts** card, but that card is not a disclosure and draws no expand control. The step now says where the card sits and that it is always open. The article's recorded hash was updated with it. This corrects an incorrect navigation instruction; earlier local records retain their original article hashes. The initial live-provider blocker stayed open; the resumed author checks above record subsequent progress.

Opus 5 performed the independent technical review as an agent and pushed the correction in `bff63ce5`. The source review completed at `2026-09-08T07:23:33.934Z`. The reviewer ran the full suite after the correction: five tasks passed without cache reuse, including 176 API files and 2,890 API tests. Formatting, secret scanning, documentation lint/build, and 33 documentation tooling tests also passed. No independent browser or live-provider walkthrough was performed, and no human feature-owner sign-off or final proofreading is claimed.

The two author role-refusal observations used API requests from authenticated Playwright contexts, without browser navigation. Their method is now accurately labelled `automated-test`; their original results and timestamps are retained. The other ten author observations include browser interactions. This classification does not satisfy any blocked required method.

Initial consistency follow-up: SET-008 said both AI cards start collapsed, but the actual Field prompts card is non-collapsible. DOC-025 has since corrected the decision wording. The guide follows the implemented control. The reviewer also noted that pre-M31 catalog Fields with reserved core slugs are excluded from Analysis targets; new Fields cannot use those slugs. That historical-install case belongs in the final troubleshooting/reference review.

## Resumed repository checks

After bringing this branch up to the reviewed feature checkpoint, all 41
current documentation/CI-tool tests passed. Documentation lint, formatting,
secret scanning and diff checks passed. The normal build still excludes
unverified articles. The complete 56-draft preview now builds without missing-link
warnings. No application source changed, and no new full application test run is
claimed for this evidence-only update. The new live observations are authored
checks awaiting independent acceptance with the remaining end-to-end work.

## Dev integration source update

The [dev integration record](../dev-integration/README.md) supersedes the current setup instructions in these drafts: Signing now offers Polling and Webhook, and AI settings offer model discovery and selection. The prior checks above remain historical. The updated articles require re-verification. Polling does not require a public callback, and an approved test recipient is already available; the remaining blocker is the actual provider round trips and independent acceptance, including a usable real AI configuration.
