# Documentation and provider integration into dev

Integration task [#795](https://github.com/juggernog20/OpenLaw/issues/795) combines the documentation feature and provider draft branch with dev after [#794](https://github.com/juggernog20/OpenLaw/pull/794). The sources remain drafts. This is not DOC-025 acceptance or DOC-027 publication.

The integration preserves dev migration history through 0094 and adds signing update mode as 0095. Existing connectors retain Webhook; new connectors default to Polling. It includes the provider model selector, in-app Help and formal documentation infrastructure, and the provider configuration drafts.

Eight guides changed: configure-signing, configure-analysis, deployment-configuration, contract-tasks-and-dates, matter-work, create-contract, reference and contributor-guide. Their evidence records now identify the new source hash and pending re-verification. Each previous evidence record is preserved byte-for-byte in a `previous-<article>.json` file here, including its original hashes, authors, reviewers, timestamps and observations. These are behavior changes, not copy-only clarifications. The older edition compatibility record remains historical and does not certify the combined dev application.

[Signing mode observations](author-signing-modes.json) record five author checks against a built app with real DocuSign developer authentication. No Envelope was sent and no callback was delivered. [Model selector observations](author-model-selector.json) record six author browser checks using a controlled HTTP provider fixture; no real model inference occurred. Both records retain their original source/build identities and observation times. They do not verify the newly assembled guide revisions.

DOC-022 (#742) still needs the remaining real-provider round trips and independent acceptance. DOC-025 (#745) must review the combined candidate and affected instructions, followed by the user's proofreading. DOC-027 (#747) remains open. The 56-article catalog and 55 coverage groups retain their original denominator; no article is promoted to verified or published by this integration.
