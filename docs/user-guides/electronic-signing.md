# Send a Contract for electronic signature

Send a Document Version of the primary Document, follow its Envelope, and check the returned executed copy.

## Before you start

Sign in as a Legal Team Member or Administrator with access to an unarchived Contract and its primary Document. An Administrator must have [configured and enabled the Signing connector](configure-signing.md). Check the intended Document Version, the Signers' distinct email addresses, and any [unresolved approvals](contract-approvals.md). Signers do not need OpenLaw accounts. Everyone is asked at once and can sign in any order.

The default interface still offers **Send for signature**. The preparation interface, **Prepare Envelope** followed by **Continue to DocuSign**, is available only in an explicitly enabled acceptance lab. Its native editor restrictions have not yet passed the live account checks. The instructions below distinguish these interfaces. [Manual hand-off](manual-signing.md) remains available without a connector.

## Send with the default interface

1. Open **Signatures**, then select **Send for signature**.
2. Choose **Version**. Check the filename and Document Version number. Only the primary Document goes out; supporting Documents and attachments are not included.
3. Enter every Signer's name and email. Use **Add signer** for another person. Each Signer needs a distinct address.
4. Enter **Subject** if needed. A blank Subject uses the C- reference and title.
5. Select **Send envelope** and check the new **Out for signature** row. **Cancel** does not send.

This interface sends immediately. It uses the legacy `/sig/` signature anchor for every Signer. All Signers share those marks; this interface cannot assign distinct positions. The earlier live check covered one Signer and one visible anchor. Multiple Signers, hidden anchors and paper without anchors have not been verified live. Do not rely on this interface to ensure that each Signer has a distinct required signature field.

A confirmed direct send moves the Contract to its first configured live Signature Status, normally **Out for signature**. An uncertain result can recover later. Check the existing Envelope before trying another send.

## Prepare in the acceptance lab

Use fictional paper and two controlled Signer inboxes. The lab requires a non-administrator DocuSign integration user. Production account entitlements and editor controls still need their own verification.

1. Open **Signatures**, then select **Prepare Envelope**.
2. Choose **Version** and enter the Signers and **Subject**. Check these before continuing. A preparation retains this Version, Document chain, Signers and Subject.
3. Select **Continue to DocuSign**. OpenLaw saves an unsent preparation, then opens DocuSign in the same tab. If the editor cannot open, the preparation stays saved.
4. In DocuSign, select each Signer and place their signature, initials, date and text fields. Check every page, assignment and required-field setting before sending. New preparations do not use `/sig/` anchors.
5. Use the provider's save and close control to keep the draft, or send only after checking the paper and fields. Return to the Contract's **Signatures** tab and read the Envelope state.

The integration requests restrictions on recipients, Documents, pages, Subject, visibility and templates. Their enforcement through every native editor route is unverified. If a restricted change is possible, stop the lab send and report it. OpenLaw does not promise that DocuSign will refuse sending without expected fields, or that every Signer must have a signature field. Send Later availability is also account-specific and unverified.

Preparing, launching and returning do not move the Contract Stage. A browser return is not proof of sending. **Prepared by** names the OpenLaw preparer; it does not identify who later clicked Send under the shared provider identity.

## Save, Resume and discard a preparation

Return to **Signatures** and select **Resume in DocuSign** to request a fresh link for the same draft. The preparer, current Legal Owner or an Administrator can Resume if they still have the required access. A fresh link does not close an earlier provider session. If another editor holds the draft, finish that session before trying again. If OpenLaw asks you to sign in after returning, sign in as the person who opened the editor.

Saving, closing a browser or an expired launch link does not send or discard the Envelope. Use DocuSign's native Discard control to abandon a draft. OpenLaw records **Discarded** only after a provider check confirms it. A missing or inaccessible provider Envelope does not prove discard and keeps the preparation reserved. These native behaviors still need the live acceptance run.

**Scheduled in DocuSign** means a provider check found a scheduled draft. It has no Sent time and offers no Resume. Review its schedule in DocuSign. A finished scheduling job does not mean the Envelope is Signed. An Envelope restored outside OpenLaw is shown truthfully and must be reviewed in DocuSign; it can coexist with a newer round. Any live Envelope prevents a new local preparation or direct send.

A newer Document Version does not change saved paper. If the primary Document changes, restore the original as primary to Resume, or resolve the existing draft in DocuSign. If the original source becomes unavailable, ask the Legal Owner to check access, archival or erasure. Do not create a replacement Contract to bypass a reserved Envelope.

Logging out, losing access, archiving the Contract or turning off the connector refuses new OpenLaw launches. OpenLaw cannot close a DocuSign session already issued. Resolve that session in DocuSign if it must stop. Its actual remote lifetime remains unverified.

## Follow completion

With **Polling**, later status checks are normally about 15 to 20 minutes apart while the worker and provider are available. Returns, Resume and the worker share the read allowance, so returning need not update status immediately. **Refresh status** rereads OpenLaw's saved state. A lost browser return does not prevent later reconciliation.

With **Webhook**, signed provider notifications can update status and reconciliation recovers missed updates. Real signed Connect delivery and recovery remain a separate verification gap. Turning off the connector prevents new sends and launches but keeps reconciliation, accepted Webhook deliveries and executed-copy filing active with the saved credentials.

**Signed** means the provider reported completion; the executed file can still be filing. Wait for **Executed copy**, open it, and check the returned paper on the original Document chain and its executed designation. Repeated observations of the same completion do not create another executed copy.

Successful filing creates and pins the executed Document Version. If the Contract is still in the Signature Stage, filing moves it to the first configured live Active Status. A Contract in another Stage keeps its Status. A preparation does not enter the Signature Stage automatically when the provider sends it, so check the Contract Status separately.

## Withdraw, decline, or send again

The preparer or direct sender, the Contract's Legal Owner, or an Administrator with record access can void a sent round. Open its actions and select **Void envelope**. Enter **Reason** and confirm, or cancel. When the round is **Voided**, you may send a new round. Drafts use native Discard instead.

A provider-reported **Declined** round records that outcome and its reason. Review it, correct the paper or Signers as appropriate, and send a new Envelope. Earlier rounds remain in history. Neither outcome ends or archives the Contract.

## If signing is unavailable or fails

The create action is absent when the connector is unavailable or disabled, no readable primary Document is set, a live Envelope exists, or the Contract is archived. Resume also requires the original source and provider identity.

If creation has an uncertain result, wait for recovery and use **Refresh status**. OpenLaw keeps the same reservation and does not create another provider Envelope. If automatic recovery stops, ask an Administrator to follow the [interrupted creation procedure](https://github.com/juggernog20/OpenLaw/blob/4cdb988cbfded942fcc6282349c364ebd3088785/docs/DEPLOYMENT.md#interrupted-envelope-creation). If voiding is refused because the provider has already completed the round, wait for its confirmed outcome.

If the executed copy could not be filed, obtain the intended executed file through your team's provider process and [file and mark it manually](manual-signing.md). Keep the C- reference and local Envelope ID when asking for help. Exclude credentials, sender links and return tokens from support material.
