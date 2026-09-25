# DocuSign Embedded Sending: research for OpenLaw

Researched 2026-09-25. Documentation and source review only; no live Envelope was created or sent. OpenLaw baseline: `105728f8f2d8a3105f397f3bab3bc7baa1dcee91`, plus the current working-tree Signatures tab changes.

## Recommendation

Use DocuSign's Embedded Sender View to prepare an Envelope. OpenLaw selects the primary Document Version and Signers, creates a provider draft, opens DocuSign's Tagger, and returns to Signatures after the sender sends or saves. Keep the final Send action in DocuSign, as agreed in the conversation. Start with a full-page redirect in the same browser tab.

This requires a durable preparation lifecycle. Replacing the current button with an external link would leave OpenLaw unable to distinguish a saved draft, a lost creation response, a send completed after the browser closed, or a cancelled editing session.

The companion [specification](../specs/docusign-embedded-sending.md) separates product decisions from the provider behavior still requiring a live demo check.

## Evidence and source selection

The Developer Center pages are partly client-rendered. Their text was supplemented with Context7's indexed official documentation, DocuSign's published OpenAPI specification, and its official sample application. Community posts and third-party implementation advice were not treated as API guarantees.

The OpenAPI revision inspected was [`858a3ae59b0edbc8beea4fa3a6d7fe803833dd68`](https://github.com/docusign/OpenAPI-Specifications/blob/858a3ae59b0edbc8beea4fa3a6d7fe803833dd68/esignature.rest.swagger-v2.1.json), dated 2026-07-03. The sample application revision was [`ca7aa2f627525f68d51d629f4defd53422891223`](https://github.com/docusign/sample-app-embeddedsending-node/tree/ca7aa2f627525f68d51d629f4defd53422891223), dated 2025-05-27. These are evidence snapshots, not reasons to pin a production API client to sample code.

## 1. The supported preparation sequence

DocuSign creates an unsent draft when an Envelope is created with `status=created`. The Sender View is available only while the provider Envelope is a draft. A request for a Sender View against a sent Envelope is refused with `ENVELOPE_INVALID_STATUS`. The preparation UI can start at the document field-placement screen rather than the document-upload screen. Sources: [create Envelope](https://developers.docusign.com/docs/esign-rest-api/reference/envelopes/envelopes/create/), [embedded sending walkthrough](https://developers.docusign.com/docs/esign-rest-api/how-to/embedded-sending/).

| Step                  | Provider operation                                               | OpenLaw responsibility                                                                |
| --------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Reserve preparation   | None yet                                                         | Persist intent, ownership, exact version, Signers, and idempotency identity           |
| Create draft          | `POST /accounts/{accountId}/envelopes`, `status=created`         | Save the provider ID before issuing a browser session                                 |
| Open editor           | `POST /accounts/{accountId}/envelopes/{envelopeId}/views/sender` | Authenticate and authorize the user; generate a fresh return correlation              |
| Place fields and send | DocuSign Sender View                                             | Keep the source Document and Signers fixed while allowing field placement             |
| Return                | Browser navigates to OpenLaw                                     | Authenticate, correlate, and request reconciliation; do not trust the event as status |
| Confirm and complete  | Provider read or verified Connect delivery                       | Apply the existing status, Activity, notification, and executed-copy pipeline         |

The base URI must come from the authenticated account discovery already implemented by the driver. Do not hard-code the demo host or a production data center. The browser return URL is separate from a Connect webhook: a private OpenLaw instance can receive the former through the user's browser without acquiring a public server callback.

## 2. Sender View settings

The modern request requires `viewAccess=envelope` and `returnUrl`; UX controls belong in `settings`. Older examples that modify the returned URL's query parameters should not be copied. [Embedded Views update](https://www.docusign.com/blog/developers/esignature-embedded-views-update)

Proposed settings, subject to the live acceptance checks:

| Setting                                       | Value     | Purpose                                                              |
| --------------------------------------------- | --------- | -------------------------------------------------------------------- |
| `startingScreen`                              | `Tagger`  | Open field placement directly                                        |
| `sendButtonAction`                            | `send`    | Let the sender send in DocuSign                                      |
| `showBackButton`                              | `false`   | Keep the session on field placement                                  |
| `showHeaderActions`                           | `false`   | Remove advanced editing actions, retaining the basic session actions |
| `showDiscardAction`                           | `true`    | Permit DocuSign's native draft discard; reconcile its outcome        |
| `recipientSettings.showEditRecipients`        | `false`   | Preserve the selected Signers                                        |
| `documentSettings.showEditDocuments`          | `false`   | Prevent adding, replacing, and deleting Documents                    |
| `documentSettings.showEditDocumentVisibility` | `false`   | Preserve who can see the Document                                    |
| `documentSettings.showEditPages`              | `false`   | Prevent page deletion or rotation                                    |
| `taggerSettings.paletteSections`              | `default` | Offer normal supported fields                                        |

The schema expresses these Boolean-style values as strings. Some other properties are reserved or unimplemented; do not assume that properties appearing in an SDK or example are supported controls. In particular, the sample sets `showAdvancedOptions` and several recipient/template options that the inspected reference marks reserved. Source: [Sender View API reference](https://developers.docusign.com/docs/esign-rest-api/reference/envelopes/envelopeviews/createsender/).

The Envelope definition also offers `recipientsLock` and `messageLock`. Evaluate them as additional controls for the chosen Signers and Subject, alongside the Sender View restrictions; document-edit restrictions remain important. A restricted UI must not be described as cryptographic proof that the source was never changed. Live verification must cover every exposed editing route. [Envelope definition](https://developers.docusign.com/docs/esign-rest-api/reference/envelopes/envelopes/create/)

## 3. Sender identity and authorization

Use the existing JWT Signing connector, its configured DocuSign integration user, and server-side token handling. The sender session runs with that provider identity. An OpenLaw user does not become a separate DocuSign sender merely by opening the session.

DocuSign recommends a service user with appropriate template access and without administrator privileges. Envelope-scoped views restrict writes to the named Envelope but can still expose secondary information, including templates, available to the API user. The restriction is therefore more specific than “this token reveals nothing else.” [Sender and Correct View security](https://developers.docusign.com/docs/esign-rest-api/esign101/concepts/embedding/embed-sender-correct-views/)

The current JWT consent model remains applicable: `signature` and `impersonation` consent for the configured user. Administrative consent is not the only supported consent method. API permissions and production entitlements still need verification for the deployment's actual account; this review does not establish pricing or contractual licensing rights. [JWT consent](https://www.docusign.com/blog/developers/oauth-jwt-granting-consent)

Implementation implication: separately record the OpenLaw preparation actor and browser session actor. Do not fabricate a human “sent by” attribution when the only evidence is a shared provider account's status change.

## 4. Browser return semantics and link lifetime

The Sender View return events are `send`, `save`, `cancel`, `error`, and `sessionEnd`. The return URL description uses lowercase examples; the settings description also uses `Send` and `Save`. Normalize recognized values case-insensitively, but use them only as navigation hints. A cancel return may omit the provider Envelope ID. Correlate through server-generated state, not the returned ID.

There is a separate mode, `sendButtonAction=redirect`, in which the main button becomes Continue and returns a save event. Save and Close can also save. Automatically sending whenever a save event arrives would therefore be incorrect. That mode would need a separate, deliberate OpenLaw final Send action and is not the agreed default. [Sender View API reference](https://developers.docusign.com/docs/esign-rest-api/reference/envelopes/envelopeviews/createsender/)

The current endpoint description says the launch URL expires after **10 minutes**; DocuSign's placement-strategy article says **five minutes** and describes it as single-use. Neither value is a reliable duration for an already-open editing session. Generate a new URL immediately before each launch or resume, never persist it as a reusable bookmark, and do not delete a draft when a link expires. Sources: [current reference snapshot](https://github.com/docusign/OpenAPI-Specifications/blob/858a3ae59b0edbc8beea4fa3a6d7fe803833dd68/esignature.rest.swagger-v2.1.json), [placement strategies](https://www.docusign.com/blog/developers/select-the-right-tab-placement-strategy-for-your-docusign-integration).

For the first version, a top-level redirect avoids popup blocking and iframe cookie, focus, and small-screen complications. This is an OpenLaw design choice. DocuSign supports iframes but advises against them on mobile; an iframe implementation would additionally need a return page with validated `postMessage` origin and source. [Sender View API reference](https://developers.docusign.com/docs/esign-rest-api/reference/envelopes/envelopeviews/createsender/)

## 5. Draft persistence, retries, and recovery

Persist a stable creation operation before calling DocuSign. A successful external create followed by a local failure must remain recoverable; it must not be interpreted as proof that no Envelope exists.

DocuSign's `transactionId` permits recovery by querying `transaction_ids` when the creation response is lost. Its provider retention is seven days. Keep a durable local idempotency record beyond that period and refuse to create another draft blindly after the lookup window has expired. The provider identifier supplements, rather than replaces, local concurrency control. [Transaction ID recovery](https://www.docusign.com/blog/developers/common-api-tasks-use-transactionid-to-find-the-envelope-you-created), [status-change search](https://developers.docusign.com/docs/esign-rest-api/reference/envelopes/envelopes/liststatuschanges/)

OpenLaw should reserve one outstanding preparation or sent Envelope per Contract. Creating, resuming, browser returns, existing direct-send clients, and recovery workers must share that invariant. A request with a reused idempotency key and different Document Version or Signers must be refused.

A fresh Sender View must reuse the provider Envelope ID, preserving placed fields. A provider edit-lock conflict should offer a retry of that same draft, not create another Envelope. DocuSign exposes explicit edit locks with a lock token; these are most relevant if OpenLaw later adds server-side editing between preparation and sending. They are not proof that issuing a second URL revokes an earlier browser session. [Envelope locks](https://developers.docusign.com/docs/esign-rest-api/esign101/concepts/envelopes/lock/)

## 6. Discard, cancellation, and scheduling are different outcomes

Closing the browser or returning with cancel does not establish deletion. Prefer the provider's native Discard action for the initial version. Keep the local preparation until provider evidence confirms its outcome.

The Folders API can move a draft into `recyclebin`, but the same operation against a sent or delivered Envelope **voids it**. A read-then-delete implementation racing a send could therefore withdraw a live Envelope without the intended Void action. Do not add a custom local discard endpoint that treats this as an unconditional draft-only operation. [Folders move API](https://developers.docusign.com/docs/esign-rest-api/reference/folders/folders/moveenvelopes/)

Provider deletion and restoration also exist. A missing result must be distinguished from wrong-account credentials and lost access; neither a network error nor a browser cancel should release the outstanding-round reservation. An externally restored or unexpectedly sent preparation requires visible reconciliation, not silent removal from history. [Delete and restore walkthrough](https://developers.docusign.com/docs/esign-rest-api/how-to/delete-restore-envelope/)

Scheduled sending is another important edge: an Envelope can remain `created` while its workflow is scheduled and waiting to send. Consequently, `created` alone does not always mean “editable, unscheduled draft.” The reference's reserved UI flags do not establish that Send Later can be disabled for every account. Detect workflow scheduling, retain the reservation, and show it truthfully if exposed by the account. Creating or editing schedules is outside the initial OpenLaw feature. [Scheduled sending states](https://developers.docusign.com/docs/esign-rest-api/esign101/concepts/recipients/scheduled-sending/)

## 7. Reconciliation and completion

DocuSign's published polling rule is no more than one read of a unique resource per 15 minutes. A browser return, reload, resume, and background worker must not each make an independent status request. Share a durable status-check claim and use cached state while the next check is not yet allowed. Do not assert an undocumented exemption for a user-triggered refresh. Connect is the supported alternative for prompt asynchronous changes. [API rate limits](https://www.docusign.com/blog/developers/dsdev-from-the-trenches-api-rate-limits)

Avoid spending the first status read immediately before launching a newly created draft: the creation response already establishes that state. Reserve the first eligible read for the return where possible. Subsequent sessions can legitimately show “Waiting for confirmation” until the next allowed check; no promise of immediate status in Polling mode is justified.

A browser return is not a signed provider notification. It must never create `envelope.sent` by itself or trigger executed-copy filing. Persist the provider ID before granting a session so an early webhook can match a known preparation. Handle a completion that arrives before a separate sent notification without manufacturing a browser actor.

OpenLaw already has Polling and Webhook modes, signed webhook verification, a shared idempotent transition, and executed-copy recovery. Extend those rather than introducing a browser-only source of truth. Live Connect delivery is still an existing verification gap, tracked in [#888](https://github.com/juggernog20/OpenLaw/issues/888); a stub test does not close it.

## 8. Current OpenLaw integration and changes required

| Existing area        | Current behavior                                                          | Required change                                                                                                          |
| -------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Signing adapter      | Send, void, status read, executed copy, webhook verification              | Add explicit preparation creation, launch/resume, and creation recovery capabilities                                     |
| DocuSign driver      | Creates with `status=sent`; adds the same `/sig/` anchor for every Signer | Create drafts for the interactive flow; use the native field editor; retain the existing direct-send contract separately |
| Envelope persistence | Four statuses; provider ID and Sent metadata assumed present              | Represent preparation before provider ID and before sending; preserve migrated sent history                              |
| Contract send route  | Provider call, then local insert, compensating void on failure            | Reserve intent first; persist draft ID before launching; recover uncertain outcomes                                      |
| Transition function  | Ignores repeated states and prevents changes after terminal outcomes      | Admit preparation-to-sent or preparation-to-completed events without duplicate Activity or filing                        |
| Reconciliation       | Selects only sent Envelopes                                               | Include outstanding preparations and share rate limiting with returns                                                    |
| Connector removal    | Blocks removal for sent Envelopes                                         | Include outstanding preparations and prevent account retargeting from stranding them                                     |
| Signatures tab       | Send dialog, history, void, executed-copy links                           | Continue to DocuSign, preparation display, resume, and pending confirmation                                              |

Code inspected: signing provider/driver and deterministic fake; Contract Envelope send, void, and completion routes/tests; shared provider contract tests; status transition and reconciliation; Envelope schema; Signing connector lifecycle; Signatures route and browser tests.

## 9. Decision records affected

- **CTR-013:** supersede the interactive immediate-send lifecycle, sent-only live-round reservation, and obsolete combined-card placement. Preserve provider independence, parallel Signers, manual hand-off, and automatic executed-copy filing.
- **DES-035 / DES-036 / DES-038:** reconcile the separate Signatures tab, new Continue action, draft row, and distinction between discarding a draft and voiding a sent Envelope.
- **TECH-013:** retain JWT; document the additional browser capability and least-privilege integration user.
- **TECH-007, September 8 addendum:** extend the existing durable polling claim to preparation and browser-return checks.
- **DD-017:** introduce explicit preparation Activity without claiming an unsent draft was sent; extend Signer erasure handling to any new payload carrying personal data.
- **CTR-014 / DOC-010 / CTR-021:** preserve Document Version provenance, lawful-erasure behavior, and archived-record semantics across an external session.
- **CONTEXT:** the Envelope definition currently starts at sent, and the Signer definition still excludes internal users despite CTR-013's September 25 addendum. Update these deliberately during implementation.

## 10. Live checks required before release

These are implementation acceptance work, not completed research results:

1. Use the configured non-administrator integration user to open Tagger with two Signers and a real multi-page Document.
2. Place separate signature, initials, date, and text fields; confirm their recipient assignment, required-field behavior, and persistence after Save and Close.
3. Confirm document replacement, page editing, recipient changes, Subject changes, and template application are unavailable under the chosen settings. Reserved flags must not be the only control.
4. Record actual send/save/cancel/error/session-end returns, parameter casing, missing Envelope ID behavior, and return after reauthentication.
5. Confirm native Discard, a reopened draft, editing conflicts, an expired launch link, and a sent Envelope refusing Sender View.
6. Determine whether Send Later is exposed by the deployment account. If it is, test scheduled state recovery rather than showing an unsent Envelope as sent.
7. Test the account's missing-field warnings. The editor's existence does not guarantee that every Signer must receive a signature field; do not invent a strict validation capability.
8. Confirm Polling behavior through the shared time budget; independently verify the live signed Connect path if Webhook mode is claimed.
9. Finish an Envelope, check the exact source Version and returned executed copy, and verify stage advancement only under the existing Signature-to-Active rule.
10. Exercise an already-open provider session after OpenLaw logout, access revocation, archive, and connector disable. Record the limitation: stopping new OpenLaw sessions does not necessarily invalidate a provider session already issued.

No live result, production entitlement, strict field-completeness guarantee, or immediate remote-session revocation is claimed by this research.
