# Prepare and send an Envelope in DocuSign from the Signatures tab

Draft for the `to-spec` testing-seam check. Intended GitHub triage label after that check: `ready-for-agent`.

## Problem Statement

A Legal Team Member can choose a Document Version and Signers in OpenLaw, but the current Send action immediately sends the Envelope. There is no opportunity to inspect the outgoing paper and position each Signer's signature boxes and other fields. Placement depends on shared document markers or is left to the Signers.

The user expects the familiar DocuSign preparation experience: choose what goes out and who signs, open the document in DocuSign, place the fields, send, and return to the Contract. Signatures now has its own tab; it should own this workflow.

## Solution

From Signatures, select the primary Document Version, Signers, and Subject. **Continue to DocuSign** creates a draft Envelope and opens DocuSign's field-placement screen. The sender assigns and positions fields, then sends in DocuSign or saves to continue later. OpenLaw returns to the same Contract's Signatures tab and reports only provider-confirmed status.

The initial experience uses a full-page redirect in the same browser tab. A saved draft can be resumed without re-uploading or losing saved field placement. A cancelled or interrupted browser session does not create another Envelope or falsely report a send. Existing Polling/Webhook updates and executed-copy filing complete the workflow.

Manual hand-off remains available without a Signing connector. Approvals remain a separate workflow, with the existing soft gate on Stage changes.

## User Stories

1. As a Legal Team Member, I want to begin signing from Signatures, so that the work has a clear home on the Contract.
2. As a Legal Team Member, I want to select an exact primary Document Version, so that the paper I prepare is the paper I intend to send.
3. As a Legal Team Member, I want to choose an OpenLaw user as a Signer, so that I do not have to retype a colleague's address.
4. As a Legal Team Member, I want to enter an external Signer's name and email, so that counterparties do not need OpenLaw accounts.
5. As a Legal Team Member, I want distinct addresses validated before preparation, so that accidental duplicate Signers are caught early.
6. As a Legal Team Member, I want the final dialog action to say Continue to DocuSign, so that I understand no invitation has been sent yet.
7. As a Legal Team Member, I want the document to open directly at field placement, so that I do not repeat the upload and Signer selection.
8. As a Legal Team Member, I want to position separate fields for each Signer, so that different people can sign in different places.
9. As a Legal Team Member, I want DocuSign's ordinary signature, initials, date, and text fields, so that I can prepare the agreement's signing requirements.
10. As a Legal Team Member, I want to review the full outgoing document, so that I can check field placement before sending.
11. As a Legal Team Member, I want to send from DocuSign when preparation is complete, so that the final action follows the familiar signing workflow.
12. As a Legal Team Member, I want to save and resume preparation, so that an interruption does not lose saved fields.
13. As a Legal Team Member, I want an expired launch link to open a fresh session on the same draft, so that retrying does not duplicate the Envelope.
14. As a Legal Team Member, I want to return to the same Signatures tab after leaving DocuSign, so that I can see the result in context.
15. As a Legal Team Member, I want drafts and unconfirmed outcomes to be distinct from Out for signature, so that I do not assume people have been emailed.
16. As a Legal Team Member, I want a preparation to remain discoverable after closing the browser, so that it is not stranded outside OpenLaw.
17. As a Legal Team Member, I want repeated clicks and retries to reuse one preparation, so that I do not send duplicate invitations.
18. As a Legal Owner, I want to see and resume a reachable Contract's preparation when appropriate, so that work can continue if its preparer is unavailable.
19. As a Legal Team Member, I want a clear message when another editor holds the draft, so that I do not overwrite their work or start another round.
20. As a Legal Team Member, I want to discard an unsent draft through DocuSign, so that I can abandon preparation without confusing it with voiding a sent Envelope.
21. As a Legal Team Member, I want the original Document Version and Signers preserved in the editor, so that OpenLaw's record continues to describe the outgoing paper.
22. As a Legal Team Member, I want a changed source Document or unavailable Version called out before resuming, so that I do not mistake an old draft for newly uploaded paper.
23. As a Legal Team Member, I want delayed confirmation to be explained, so that I do not click Send again while OpenLaw is waiting for the provider.
24. As a Legal Team Member, I want status to recover without a browser return, so that closing the page does not lose a successful send or completion.
25. As a Legal Team Member, I want the executed copy filed on the correct Document chain, so that the final paper is available beside its source.
26. As a Legal Team Member, I want a completed Envelope to advance the Contract only under the existing Signature Stage rule, so that signing does not overwrite a later lifecycle decision.
27. As a Legal Team Member, I want sent Envelope history and Void behavior preserved, so that existing Contracts continue to work after upgrade.
28. As an Administrator, I want account or connector changes prevented from stranding a preparation, so that I can operate the integration safely.
29. As an Administrator, I want preparation and provider-confirmed events recorded accurately, so that the Activity feed distinguishes intent from sending.
30. As an Administrator, I want no credentials or sender-session links exposed in logs or Activity, so that access to operational records does not grant access to a signing session.
31. As a user without signing permission, I want the same access rules enforced on direct API calls and returned links, so that knowing an Envelope ID grants no additional access.
32. As a self-hosting Administrator, I want preparation to work in Polling mode without a public Connect callback, so that this feature remains usable on a private deployment.
33. As a Legal Team Member using a small screen, I want a usable full-page editor and reliable return, so that preparation is not squeezed into a dialog.
34. As an Administrator handling a Signer erasure, I want new preparation data included in the established erasure process, so that this feature does not leave another copy of that person's details.

## Implementation Decisions

### 1. Preserve the agreed product boundary

- OpenLaw owns the selected primary Document Version, Signers, Subject, access rules, durable preparation, and Contract record. DocuSign owns field placement and the final Send action.
- Use Embedded Sender View, not Recipient View, Correct View, Console View, or an OpenLaw-built field editor. Recipients continue using the existing emailed signing journey; do not add embedded-recipient identifiers or change delivery channels.
- The interactive flow starts with no automatically inserted shared `/sig/` fields. A sender explicitly places fields per Signer. Existing historical Envelopes and the existing direct-send API contract are not rewritten.
- Signers remain parallel. Do not add routing order, reminders, templates, per-Signer progress, or a new approval gate.

### 2. Establish a durable preparation before contacting DocuSign

- Extend the Envelope lifecycle to represent preparing, draft, confirmed sent, existing completed outcomes, and provider-confirmed discarded preparation. A confirmed creation refusal may be settled as failed; a timeout is not a confirmed refusal.
- Persist preparation actor, Contract, Document Version, Document chain, resolved Signer snapshot, Subject, provider environment/account identity, and a stable idempotency key before external creation. Provider ID and sent metadata may be absent only in appropriate pre-send states.
- Create the provider Envelope with draft status. Save its ID durably before returning a sender-session URL. Do not create a sent Activity entry, populate a fictitious Sent timestamp, or advance the Stage at preparation time.
- Reserve one outstanding preparation or sent Envelope per Contract at the database boundary. Existing direct-send requests participate in the same reservation. Do not hold a database transaction open over an external request.
- Matching retries return the existing operation. Reusing a key for different inputs returns a typed conflict. A crash or lost create response enters recoverable uncertainty and keeps the reservation.
- Send DocuSign a stable transaction ID. Recover an uncertain create through the provider's transaction lookup within its documented seven-day window. Retain local idempotency beyond that window; unresolved older attempts require explicit operator resolution rather than blind recreation.

### 3. Define the application operations

- **Prepare:** authenticated write accepting the existing exact Version, Signer, and Subject inputs plus an idempotency identity. Returns the durable Envelope/preparation state; accepted pending work remains distinguishable from a completed draft.
- **Launch or resume:** authenticated write for an existing preparation. Returns a fresh short-lived sender-session URL only after the provider ID is durable and current permissions/configuration permit editing. It never uploads another document or creates another Envelope.
- **Return and reconcile:** the browser return is navigation. After authentication, the application consumes a server-generated session correlation through its ordinary protected write boundary and requests a permitted provider check. No state-changing send or discard is performed by trusting a GET query parameter.
- **Read:** the existing Contract signing read includes preparation state, permissions to resume, last confirmed status, and pending confirmation. Route loaders continue to read OpenLaw state rather than repeatedly polling DocuSign.
- Use the existing typed problem response conventions for conflicts, unavailable connectors, stale sessions, uncertain provider outcomes, and non-editable Envelopes. Regenerate the API client when contracts change.
- Preserve the existing explicit direct-send API for compatibility, but remove it from the new interactive UI path. It must honor the outstanding preparation reservation; there is no fallback that silently sends when the editor fails to open.

### 4. Use current Sender View controls

- Set envelope-scoped view access, an application-generated return URL, Tagger as the starting screen, and Send as the main action. Disable the Back button and advanced header actions.
- Disable recipient edits, document changes, document visibility edits, and page edits. Preserve the selected Subject using the documented Envelope message lock; evaluate recipient locking alongside the view restrictions.
- Keep the normal field palette and basic save/close controls. Permit the provider's native Discard action. Do not rely on SDK properties marked reserved in the current API reference.
- Keep the launch URL opaque and unchanged. Generate it just before each launch; never reuse it as a stored draft URL. No application countdown assumes a specific editing-session duration from a launch-link expiry.
- Use a top-level redirect in the same browser tab. The return destination is the Contract's Signatures tab, reached through the authenticated return handler.

### 5. Make browser returns untrusted, correlated navigation

- Generate unpredictable, expiring return state bound to the authenticated OpenLaw user, local Envelope, provider account/environment, and launch attempt. Accept only the application's configured return origin and route; no caller-supplied arbitrary return destination.
- Correlation must work without a returned provider Envelope ID. Reject mismatched, altered, expired, or replayed state without making another Envelope or changing its status. A repeated return may safely display current state.
- Recognize send, save, cancel, error, and session-end hints case-insensitively. Missing or unknown events are also safe: navigate and show authoritative state when available.
- Expired OpenLaw authentication requires sign-in before showing Contract details or requesting reconciliation. Recheck reach after sign-in and on every launch.
- Never equate a save or cancel hint with a send or discard. Do not auto-send on a save return. Only a provider API response or verified provider notification confirms status.
- Treat launch URLs and correlation secrets as credentials: no Activity payloads, analytics, persistent browser storage, or ordinary request/response logging. Use no-store responses and a suitable referrer policy on hand-off/return surfaces.

### 6. Reuse the provider seam and status transition

- Add draft creation, fresh sender-session creation, and uncertain-creation recovery to the existing signing-provider boundary. Extend the deterministic fake and shared provider contract tests. Keep DocuSign-specific UX settings inside its adapter.
- Use the existing JWT integration user and discovered API base URI. The browser receives neither an OAuth access token nor the RSA key. Setup guidance calls for a suitable non-administrator provider user; production account entitlement is verified separately.
- Extend the shared status transition to accept provider-confirmed sending from a draft and direct completion from a preparation if earlier events were missed. Existing terminal sent-history outcomes must not regress on late messages.
- Draft/discard handling must not treat provider deletion, provider terminal outcome, and inability to read an Envelope as the same fact. A discarded draft restored outside OpenLaw is an exception requiring visible reconciliation, not a reason to ignore a later authenticated send event.
- Preserve exactly-once logical Activity, notifications, executed-copy enqueueing, and filing across duplicate/reordered webhooks, browser returns, and polling.
- Only provider `completed` means OpenLaw's completed signing outcome. Do not confuse DocuSign's intermediate `signed` state with completed filing.

### 7. Share the provider-read budget

- Extend the existing durable per-Envelope reconciliation claim to preparations and browser-triggered checks. Maintain at least 15 minutes between repeated provider reads of the same resource, including failure/restart handling.
- Use the draft creation response as initial evidence, avoiding a redundant read before its first launch. On return, perform a check only if eligible; otherwise retain cached provider state with a visible waiting-for-confirmation indication.
- In Polling mode, no public webhook is required. A successful browser redirect does not justify a new rapid polling loop or an undocumented user-action exception.
- In Webhook mode, retain HMAC verification and the configured public callback. Include the relevant sending events in setup guidance; retain reconciliation when deliveries are absent, early, or missed.
- An account-exposed scheduled send may remain provider-created with a scheduled workflow. Preserve the outstanding reservation and show a scheduled/pending condition; do not report it as sent or erase its schedule. Providing scheduling controls is out of scope.

### 8. Resume, discard, and competing sessions

- Resume the same provider draft and its saved fields. A current provider lock or non-editable status produces a recoverable conflict, not another draft.
- The preparer, reachable Contract Legal Owner, or reachable Administrator may resume. All require the existing legal-side role and Contract reach; Administrator status alone is not a bypass for a Confidential Contract.
- Coordinate launch attempts locally and handle provider locks. Do not claim that a second launch URL revokes an already-open session. Prove competing-browser behavior in the live acceptance check and avoid promising exclusive editing beyond the provider's actual controls.
- Offer native Discard in DocuSign. Release the outstanding reservation only after authoritative confirmation of the outcome, retaining its history. A browser cancel or closure preserves the preparation.
- Do not implement discard as an unconditional move to the provider recycle bin: that operation can void an Envelope if sending wins a race. A future custom discard operation would need separately demonstrated race-safe provider semantics.
- If a draft cannot be found or reached, retain an actionable recovery state until account identity and the outcome are resolved. Never abandon uncertain external work merely because it has become old.

### 9. Document identity, access changes, and connector lifecycle

- Bind the Envelope to the selected immutable Version and its original Document chain. A new Version does not silently replace the prepared paper. If the primary Document changes, show the original source explicitly and require deliberate resolution before another launch.
- Refuse new launches for an archived Contract, lost Contract reach, erased source Version, or disabled/mismatched connector. A provider session already issued may continue to exist: do not claim that OpenLaw logout or disable revokes it remotely.
- Continue reconciling a known external outcome even if the browser user is no longer authorized. Do not expose Contract details to that user; use existing background completion and archival rules.
- Extend connector removal guards to outstanding preparations and uncertain creations. Prevent changing environment/account identity while such work is outstanding; credential rotation for the same identity remains supported. Disabling keeps the records and pauses new launches as today.
- A provider ID must never be interpreted through an unrelated account after reconfiguration. New preparations retain account/environment identity; define an upgrade-compatible handling path for older sent history without inventing historical account facts.
- Preserve the existing source-erasure and executed-copy rules. Field values remain provider-side except insofar as they appear in the executed Document; this feature does not add form-field extraction into Contract Fields.

### 10. Activity, migration, and documentation

- Add preparation/session/discard Activity only for actual actions, and keep sent Activity tied to provider evidence. Record the preparer and session actor separately; do not assume the last person to open a shared-account session was the final sender.
- Avoid duplicating Signer personal data across new Activity payloads where a stable local reference is enough. Any new retained names/addresses must be covered by the existing external-Signer erasure process.
- Migrate existing sent, signed, declined, and voided rows without changing their meaning, timestamps, executed-copy references, or display. Audit read models, filters, constraints, connector counts, and recovery jobs for assumptions that every Envelope is already sent.
- Existing Status changes and the Approval soft gate remain independent of launching a preparation. Opening or sending does not itself move the Contract Stage. Successful executed-copy filing retains the existing conditional advancement to Active.
- Update the user guides, Signing connector setup, glossary, API documentation, and affected decision records as part of implementation. Keep superseded decisions rather than deleting them.

## Testing Decisions

Use existing seams and test observable behavior. The principal application acceptance seam is the Contract signing HTTP API with a real test database and the injected signing provider. Retain a small browser journey for navigation, and the existing shared provider contract suite for the external protocol. A mocked provider cannot verify DocuSign's actual editor controls.

### Application acceptance at the existing HTTP seam

1. Preparing validates reach, legal-side role, archived state, exact primary Document Version, internal/external Signers, distinct addresses, and connector availability without sending an invitation.
2. The provider ID is durable before a launch URL is returned. Drafts have no sent Activity or fictitious Sent timestamp, and they do not advance the Stage.
3. Repeated clicks, concurrent callers, matching retries, and the legacy direct-send operation cannot create two outstanding rounds. Different inputs with the same idempotency key are refused.
4. A lost provider response or stopped process recovers the same draft through stable correlation. Expired transaction lookup does not trigger blind recreation.
5. Resume preserves the provider ID and placed-field behavior exposed by the fake. Lock conflicts and already-sent drafts never create another Envelope.
6. Valid browser returns request reconciliation; forged, replayed, wrong-user, wrong-account, missing-ID, and unknown-event returns never fabricate status or leak Contract data.
7. Save, cancel, error, session end, closed browser, and native discard have distinct results. A save never causes a send. Pending or ambiguous outcomes retain the reservation.
8. Verified sent/completed updates arriving before the browser return, in reverse order, or repeatedly produce one logical Activity transition and one executed copy.
9. Repeated browser reloads, resumes, and overlapping workers respect one durable provider-read budget, including after restart and connector mode changes.
10. Scheduled provider-created Envelopes remain reserved and are not displayed as sent. Wrong-account errors, transient outages, and provider deletion do not collapse into one status.
11. Source replacement, erasure, access revocation, archive, connector disable/removal, and identity changes follow the stated restrictions without losing externally completed work.
12. Migration keeps existing sent history, Void, executed-copy filing, Signer erasure, and manual hand-off working.

Prior art is the existing Contract Envelope send/void/completion/reconciliation suites, signed-webhook suite, connector lifecycle tests, and Signer-erasure tests. Extend these rather than adding another orchestration layer only for tests.

### Browser behavior

- Verify Signatures → selection dialog → Continue to DocuSign → external launch → authenticated return → draft/confirmed status.
- Verify saved preparation and Resume, expired session recovery, actionable errors, narrow-screen behavior, and no send action appearing in Approvals.
- Assert accessible labels, focus on return, and displayed outcomes. Avoid assertions about private React state, exact class names, or duplicated implementation conditions.

### Provider contract and live proof

- Extend the shared fake/DocuSign contract with draft creation, recovery, launch eligibility, and provider status changes. Driver protocol tests cover the current request shape, secure host validation, stable transaction identity, and bounded errors.
- Before release, perform a recorded DocuSign developer-account walkthrough with two Signers: field assignment, save/resume, native discard, final send, return events, restricted editing, missing-field warnings, locks, expired links, and any exposed Send Later behavior.
- Verify the real executed copy and source Version. Verify Polling mode independently from Webhook mode. Existing issue #888 tracks the live Connect delivery gap and must not be represented as completed by local stubs.
- Record actual behavior of already-open sessions after local access or configuration changes. If the account cannot enforce the essential Document/Signer restrictions, stop rollout and revise the design; do not silently ship a weaker provenance guarantee.

## Out of Scope

- Implementing this feature during the research/specification task.
- Building an OpenLaw signature-field editor or introducing a DocuSign JavaScript signing widget.
- Embedded recipient signing, per-user DocuSign OAuth, account-wide Console access, or new signing providers.
- Template creation/management, Document generation, bulk sending, recipient routing order, reminders, and per-Signer progress.
- An OpenLaw scheduling UI, post-send correction, or new Contract approval policies.
- A second final Send screen in OpenLaw. Changing to the provider's redirect/Continue mode requires a deliberate product revision.
- A strict guarantee that every Signer has a signature field: the native editor's actual validation is tested and documented, but no unsupported API switch is invented.
- Immediate revocation of a provider session already issued, or control over changes made independently in the DocuSign account.
- Pricing or licensing commitments on behalf of DocuSign.

## Further Notes

This specification follows the user's agreed flow. Its durable-state, recovery, and restriction choices are implementation proposals derived from the documentation and existing code; they have not been validated against a live provider account.

Decision-record amendments required at implementation:

- **CTR-013:** interactive immediate-send becomes prepare/edit/send; the one-outstanding-round rule includes preparation; the provider adapter remains neutral and manual hand-off remains available.
- **DES-035, DES-036, DES-038:** Signatures is its own tab, with preparation/resume and provider-native draft discard separate from Void.
- **TECH-013 / TECH-007:** retain JWT and the durable polling limit; add the browser launch and return behavior.
- **DD-017 / CTR-014 / CTR-021 / DOC-010:** record real events and preserve provenance, archival, and erasure behavior.
- Update the glossary's sent-only Envelope definition and outdated exclusion of internal Signers, consistent with the September 25 CTR-013 addendum.

Research: [DocuSign Embedded Sending investigation](../research/docusign-embedded-sending.md).

Primary documentation:

- [Embedded sending walkthrough](https://developers.docusign.com/docs/esign-rest-api/how-to/embedded-sending/)
- [Sender View API reference](https://developers.docusign.com/docs/esign-rest-api/reference/envelopes/envelopeviews/createsender/)
- [Sender/Correct View security and UX controls](https://developers.docusign.com/docs/esign-rest-api/esign101/concepts/embedding/embed-sender-correct-views/)
- [Current OpenAPI evidence snapshot](https://github.com/docusign/OpenAPI-Specifications/blob/858a3ae59b0edbc8beea4fa3a6d7fe803833dd68/esignature.rest.swagger-v2.1.json)
- [Transaction ID recovery](https://www.docusign.com/blog/developers/common-api-tasks-use-transactionid-to-find-the-envelope-you-created)
- [API polling limits](https://www.docusign.com/blog/developers/dsdev-from-the-trenches-api-rate-limits)
- [Scheduled sending states](https://developers.docusign.com/docs/esign-rest-api/esign101/concepts/recipients/scheduled-sending/)
- [Folders move semantics](https://developers.docusign.com/docs/esign-rest-api/reference/folders/folders/moveenvelopes/)
- [Official Embedded Sending sample](https://github.com/docusign/sample-app-embeddedsending-node/tree/ca7aa2f627525f68d51d629f4defd53422891223)

DocuSign sources disagree on the launch URL lifetime (five versus ten minutes), and event casing differs within the reference. The design deliberately depends on neither a fixed lifetime nor one event casing. Live verification is required for account-specific UI controls and session behavior.
