# Record a Contract signed outside OpenLaw

File the executed paper and record the Contract's Status when signature happens outside the app.

## Before you start

Sign in as a Legal Team Member or Administrator with access to an unarchived Contract. Have the final executed file and know which Document chain it belongs to. This workflow needs no Signing connector. Check any [unresolved approvals](contract-approvals.md) before changing the Status.

## Hand off and file the executed copy

1. Use the Stage control to choose your organization's Signature Status, such as **Out for signature**. Arrange signature through your team's external process.
2. Once signed, open **Documents**. On the intended Document, use **Add version** to upload the executed file. If there is no Document yet, upload it as a new Document first.
3. Read or download the uploaded Document Version and check that it is the intended executed copy.
4. Open that Document Version's actions and select **Mark as executed copy**. Check its executed designation. On a Contract with several Documents, also check that the intended contract paper is the primary Document.
5. Use the Stage control to choose the intended Active Status. Confirm a Soft gate override only if appropriate, then check the Status and Activity.

A Document Version's kind and its executed designation are separate. Choosing an Executed kind during upload does not set the executed designation automatically. Marking a Document Version as executed does not itself change the Contract's Status. A later upload can become current while the executed designation still identifies the earlier signed Document Version.

## Correct the wrong selection

Use **Unmark as executed copy** on the incorrectly designated Document Version, or mark the correct Document Version, then check the resulting designation. Keep the signed paper on its existing chain by using **Add version** for a new round. Follow [Work with Document Versions](document-versions.md) for upload, reader, and Document Version controls.

If you withdrew the external hand-off or the other side declined, record the outcome in the Contract's supported conversation or details and choose the appropriate Status. Manual hand-off creates no OpenLaw Envelope row. Do not expect a provider update to arrive for it.

## If it does not work

Wait for the upload result and inspect any failure before changing the Status. A read-only or archived record will not offer the legal actions. Restore the Contract or ask someone with permission to act. If the wrong file was uploaded, retain the C- reference and Document Version details when asking for help.

[Send a Contract for electronic signature](electronic-signing.md) covers the separate connector workflow.
