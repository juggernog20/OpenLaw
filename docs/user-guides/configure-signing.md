# Configure the Signing connector

Connect DocuSign so your team can send a Contract's primary Document for electronic signature and receive the executed copy in OpenLaw. [Manual hand-off](manual-signing.md) remains available without a connector.

## Before you start

Use an Administrator account in OpenLaw. The app and worker need outbound HTTPS access to DocuSign. Choose **Polling** if the install has no public callback. Choose **Webhook** if the operator has a public HTTPS gateway for signed DocuSign notifications. Both modes send the selected Document to DocuSign for signing.

Prepare a DocuSign integration key, the sending user's **User ID**, that integration's RSA private key, and, for Webhook mode, a Connect HMAC secret. Keep them in your organization's secret store. OpenLaw stores the two secrets encrypted and never displays their saved values. The operator must retain the install's encryption key with its recovery materials; see [deployment configuration](deployment-configuration.md).

Start in a DocuSign developer account with fictional paper and test Signers whose inboxes you control. Choose **Demo** for that account. **Production** requires the corresponding production integration, user and consent, plus Connect configuration for Webhook mode; changing this selector does not promote a developer integration.

## Prepare the DocuSign account

1. In the provider account, create or select the integration and obtain its integration key and RSA key pair. Record the sending user's API User ID, rather than their email address. Follow [DocuSign's JWT consent instructions](https://www.docusign.com/blog/developers/oauth-jwt-granting-consent).
2. Grant the integration consent to act as that user with the `signature` and `impersonation` scopes. For individual consent, enable the integration's authorization-code grant and register the exact redirect URI used in the consent request. This redirect is for consent; it is **not** OpenLaw's Connect webhook.
3. Sign in to OpenLaw and open **Settings → Organization → Integrations → E-signature**. Expand **DocuSign** if collapsed. Choose **Signing updates**. New connectors default to **Polling**, which needs no Connect subscription or HMAC secret. For Polling, continue to [Save and test the connector](#save-and-test-the-connector).
4. For **Webhook**, enter **Public callback URL** if the gateway address differs from the app address. The operator must forward POST requests to `/api/v1/signing/docusign/webhook` and preserve the body and signature headers. This allows the app itself to keep its private address. OpenLaw does not create the gateway. Leaving this field blank uses the app address, which must then be publicly reachable over HTTPS.
5. In DocuSign, configure an account-level Connect subscription that includes the sending user's Envelopes and sends their status changes to the public callback URL. Use JSON notifications with envelope data, including the Envelope ID and envelope summary status. OpenLaw does not create this subscription when you save the connector. Follow [DocuSign's account-level Connect configuration instructions](https://www.docusign.com/blog/developers/common-api-tasks-add-custom-connect-configuration-programmatically).
6. Enable HMAC signing on that subscription and obtain the shared secret to enter in OpenLaw. Follow [DocuSign's JSON and HMAC instructions](https://www.docusign.com/blog/developers/event-notifications-using-json-sim-and-hmac). An unsigned delivery, a mismatched secret, or an incompatible payload will not update a Contract.

For an individual-consent request in Demo, the provider's authorization address has this form. Replace `CLIENT_ID` with the integration key and `ENCODED_REGISTERED_URI` with the URL-encoded registered redirect URI before opening it in the intended user's browser:

```text
https://account-d.docusign.com/oauth/auth?response_type=code&scope=signature%20impersonation&client_id=CLIENT_ID&redirect_uri=ENCODED_REGISTERED_URI
```

The production consent host is `account.docusign.com`. OpenLaw uses JWT after consent; there is no authorization code to paste into its Settings form. Provider console options and account entitlements can differ, so use the linked provider instructions for account-side changes.

## Save and test the connector

1. In **E-signature**, choose **Environment** to match the account you prepared.
2. Enter **Integration key** and **User ID**.
3. Paste **RSA private key**. For **Webhook**, also paste **Connect HMAC secret**. Select **Save connector**. A newly saved connector is enabled. For Webhook, copy the saved **Webhook URL** and check that the Connect subscription uses that exact address.
4. Select **Test connection**. Wait for **Connected to …** and check that the named account is the intended one. If the sending user belongs to several accounts, OpenLaw uses the provider's default account, or the first returned account when none is marked default. There is no separate Account ID selector in this form.
5. Follow [electronic signing](electronic-signing.md) with fictional paper and controlled test Signers. Complete the Envelope in DocuSign. In Polling mode, allow the next reconciliation check to run. Then check the **Signed** Envelope, **Executed copy**, and that the returned Document Version is marked as the executed copy on the original Document chain. Check the Contract's Status separately.

The **Connected** badge means a connector is saved and enabled. It does not prove that its credentials work. A successful connection test reaches the provider account; it does not prove that Connect callbacks reach the install or that the executed copy can be filed. Complete the round trip before relying on the connector.

## Choose or change how updates arrive

| Signing updates | Requirements                                                             | Timing                                                                                                     |
| --------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Polling         | Outbound HTTPS access to DocuSign. No public callback or Connect secret. | Later status checks are normally about 15 to 20 minutes apart while the worker and provider are available. |
| Webhook         | Public HTTPS gateway and a Connect subscription with HMAC signing.       | Updates arrive when DocuSign delivers them. Reconciliation checks recover missed notifications.            |

The first check can run sooner than later checks. A stopped worker or provider outage can make updates take longer. Both modes use the same completion and executed-copy filing paths.

Change **Signing updates**, complete any required fields and select **Save connector**. No restart is needed. Switching modes keeps credentials and outstanding Envelopes. Existing connectors retain Webhook after the upgrade that adds this setting. Polling mode refuses inbound webhook updates even if a Connect secret was saved earlier. If you stop using Connect, disable the old subscription in DocuSign to stop its delivery attempts.

## Turn off, reconnect, or remove

Turn off **Send for signature from records** to stop offering new sends while retaining the credentials. OpenLaw also stops processing this connector's callbacks and reconciliation while it is off. This does not void Envelopes already held by DocuSign: Signers may still act there. To withdraw a round, [void its Envelope](electronic-signing.md) while the connector is available.

Turn the switch back on to resume. Recheck outstanding rounds and their executed copies; do not send a replacement just because OpenLaw was temporarily behind. **Test connection** cannot succeed while the connector is off, even though the button remains available in this pane. Saving changed credentials on an existing disabled connector does not turn it back on.

Select **Remove connector** and confirm only when its credentials should be deleted from OpenLaw. Removal is refused while any Envelope is live. Finish or void those rounds first. Reconnecting after removal requires the RSA private key again, plus the Connect secret for Webhook. Removing the connector does not revoke the integration or its credentials in DocuSign.

## Rotate secrets or change accounts

For either saved secret, a blank input keeps the current value; pasting a new value and selecting **Save connector** replaces it. Reloading the pane shows blank secret inputs again, not the stored secret. Keep replacement values in your secret store, not in a Contract comment or support attachment.

Coordinate an RSA key rotation with the provider integration, save its new private key, and test the connection before retiring the old provider key. For a Connect HMAC rotation, arrange overlapping signed deliveries with the old and new provider keys where supported, save the new shared secret in OpenLaw, and verify an actual status delivery before retiring the old key. A connection test alone does not test HMAC signing.

Finish or void outstanding rounds before changing the integration, sending user, or environment. The form permits these edits; credentials for another account may leave earlier rounds unreachable. Check the returned account name and complete another controlled round after the change.

## If setup or completion fails

| Symptom                                           | Check and recovery                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Settings is unavailable                           | Use an Administrator account. A Legal Team Member can send from a reached Contract but cannot configure the connector.                                                                                                                                                                                                                                                                                       |
| Save is refused                                   | Supply the RSA private key and required account identifiers. Webhook also requires a Connect secret. A stored secret can be kept by leaving its field blank.                                                                                                                                                                                                                                                 |
| Connection test fails                             | Turn the connector on. Check Demo versus Production, integration key, User ID, RSA key, and consent for that user. Ask the operator to check outbound access. Save a correction before testing again.                                                                                                                                                                                                        |
| Test reaches the wrong account                    | Check the sending user's default provider account and chosen environment. Resolve this before sending paper.                                                                                                                                                                                                                                                                                                 |
| Provider status changed but OpenLaw did not       | Check that the connector and worker are on. For Polling, allow the next scheduled check and check outbound access. For Webhook, check the public callback address and that DocuSign can reach it over HTTPS. Check the Connect subscription's user coverage, JSON envelope data, and HMAC secret. After correction, use the provider's delivery recovery controls and allow OpenLaw's reconciliation to run. |
| **Signed** appears without a usable executed copy | Check the filing result on the Contract. Ask the operator to inspect the failure using the C- reference and Envelope ID. If necessary, obtain the intended executed paper through the provider and [file it manually](manual-signing.md). Do not equate a Signed row with a stored file.                                                                                                                     |

When escalating, provide the environment, time, C- reference, Envelope ID, and displayed error. Exclude private keys, HMAC secrets, access tokens, and the Contract's contents unless your team's support process specifically requires the paper.
