# Send a Contract for electronic signature

Send a Document Version of the primary Document, follow its Envelope, and check the returned executed copy.

## Before you start

Sign in as a Legal Team Member or Administrator with access to an unarchived Contract. An Administrator must have [configured and enabled the Signing connector](configure-signing.md). Check the primary Document, its intended Document Version, the Signers' names and distinct email addresses, and any [unresolved approvals](contract-approvals.md).

Move the Contract to the intended Signature Status before sending if completion should advance it to Active. The send action itself does not move its Status. [Manual hand-off](manual-signing.md) remains available without a connector.

## Send the Envelope

1. Open **Approvals**, then select **Send for signature** on **Approvals & signing**.
2. Choose **Version**. Check the filename and Document Version number, including whether it is current. Only the primary Document goes out; supporting Documents and attachments are not included.
3. Enter every Signer's name and email. Use **Add signer** for another person or remove an unwanted row. Each Signer needs a distinct address.
4. Enter **Subject (optional)** if needed. A blank subject uses the Contract's name.
5. Select **Send envelope** and check the new **Out for signature** row, its Document Version, Signers, and sent time. **Cancel** does not send.

Everyone is asked at once and can sign in any order. Signers do not need OpenLaw accounts. One Contract can have only one live Envelope; another send is unavailable while it is out.

## Follow completion

The provider sends status updates. Watch the Envelope row and the header's signing status. **Signed** means the provider reported completion; the executed file can still be filing. Wait for **Executed copy**, open it, and check the returned paper on the original Document chain and its executed designation.

Successful filing creates and pins the executed Document Version. If the Contract is still in the Signature Stage, filing moves it to the first configured live Active Status. If someone has moved it to another Stage, completion does not overwrite that Stage. Check both the Envelope and Contract Status instead of treating them as the same fact.

## Withdraw, decline, or send again

The person who sent the Envelope, the Contract Owner, or an Administrator can void a live round. Open its actions and select **Void envelope**. Enter **Reason** and confirm, or cancel. The reason is recorded with the withdrawal. When the round is **Voided**, its Signers can no longer sign it and you may send a new round.

A provider-reported **Declined** round records that outcome and its reason. Review it, correct the paper or Signers as appropriate, and send a new Envelope. A declined or voided round stays in history and does not block another send. Neither outcome means the Contract itself was ended or archived.

## If signing is unavailable or fails

**Send for signature** is absent when the connector is unavailable or disabled, no primary Document is set, a live Envelope already exists, or your record is read-only. Check those conditions before asking an Administrator to inspect the connector.

If sending fails, read the displayed error and reload the Envelope list before retrying an uncertain result. If another sender won, read their live round instead of creating another Contract. If voiding is refused because the provider has already completed the round, reload and inspect the recorded outcome.

If the row says the executed copy could not be filed, obtain the intended executed file through your team's provider process and [file and mark it manually](manual-signing.md). Keep the C- reference and Envelope details when asking for help. A Signed row alone is not proof that OpenLaw has stored the executed file.
