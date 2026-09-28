# Record a Contract signed outside OpenLaw

File the executed paper and record the Contract's Status when signature happens outside the app.

## Before you start

Sign in as a Legal Team Member or Administrator with access to an unarchived Contract. Have the final executed file and know which Document chain it belongs to. This workflow needs no Signing connector. Without one, the Contract's **Signatures** tab offers no **Send for signature** control. Check any [unresolved approvals](contract-approvals.md) before changing the Status.

## Hand off and file the executed copy

1. Use the Stage control to choose your organization's Signature Status, such as **Out for signature**. Arrange signature through your team's external process.
2. Once signed, open **Documents**. On the intended Document, use **Add version** to upload the executed file. If there is no Document yet, upload it as a new Document first.
3. Read or download the uploaded Document Version and check that it is the intended executed copy.
4. Open the Document's actions and select **Mark as executed copy**. For an earlier Document Version, use that Version's own actions. Check that **Executed** now appears beside that Version's number. This mark is the Executed pin. On a Contract with several Documents, also check that the intended contract paper is the primary Document.
5. Use the Stage control to choose the intended Active Status. If **Move past approval** appears, select **Move anyway** only if the override is appropriate, or **Cancel**. Then check the Status and Activity.

A Document Version's Document type and its Executed pin are separate. Choosing the **Executed** type during upload does not set the Executed pin. The **Type** column can read **Executed** while the Version number shows no **Executed** mark. Marking a Document Version as executed does not itself change the Contract's Status. A later upload can become current while the Executed pin still identifies the earlier signed Document Version.

If the parties sign in separate rounds, you can file each partly signed round with **Add version** and the **Partially signed** type. You can also move the Contract to the **Partially signed** Status, which is in the Signature Stage. Do not mark a partly signed Version as the executed copy. When the last party signs, file the fully signed Version and continue from step 3.

## Correct the wrong selection

Use **Unmark as executed copy** on the Document Version that carries the wrong Executed pin, or mark the correct Document Version, then check the resulting Executed pin. Keep the signed paper on its existing chain by using **Add version** for a new round. Follow [Work with Document Versions](document-versions.md) for upload, reader, and Document Version controls.

If you withdrew the external hand-off or the other side declined, record the outcome in the Contract's supported conversation or details and choose the appropriate Status. Manual hand-off creates no OpenLaw Envelope. The **Signatures** tab lists no signature request for it, and no provider update will arrive for it.

## If it does not work

Wait for the upload result and inspect any failure before changing the Status. A read-only or archived record will not offer the legal actions. Restore the Contract or ask someone with permission to act. If the wrong file was uploaded, an Administrator can remove that Version with **Delete version**, as [Work with Document Versions](document-versions.md) describes. The deletion cannot be undone. If the deleted Version carried the Executed pin, OpenLaw clears the pin, so mark the correct Version again. Otherwise, retain the C- reference and Document Version details when asking for help.

[Send a Contract for electronic signature](electronic-signing.md) covers the separate connector workflow.
