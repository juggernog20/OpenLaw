# Upload Documents and add Document Versions

Keep every Version of the same paper in one Document. Each upload adds an immutable Document Version, so an earlier Version remains available to read and download.

## Before you start

Open a Contract, Matter, Entity, or Knowledge Item you can reach. Legal Team Members and Administrators can manage its Documents. Business Users can supply supporting Documents on Contracts and Matters they have been added to, but cannot append to a Contract's primary Document or administer existing paper. An archived owning record must be restored before uploading.

Every Document belongs to one owning record. Start on that record, not the central Documents repository. Business Users supply Request or comment attachments through the [Business Portal](follow-request.md); those attachments are not automatically managed Documents.

## Upload a new Document

1. Open the record's **Documents** tab. On a Knowledge Item, use its Documents section.
2. Select **Upload**, then **Choose files**. Choose one file for a new Document. Selecting several files opens the [bulk import](document-folders.md) dialog instead.
3. Select **Kind** and optionally enter a **Note** explaining this Version. Choose the kind that describes the paper, such as **Draft · ours**, **Draft · theirs**, **Redline · theirs**, **Redline · ours**, **Executed**, or **Amendment**.
4. Select **Upload**. Check the new row and its **v1** Version. The filename supplies the initial Document name; a Legal Team Member or Administrator can use the row's **Actions** menu, **Edit details**, and **Save** to change its name and description.

Any file type can be stored, subject to the deployment's upload limit. [Preview support](document-previews.md) is narrower. A successful upload can still be processing for preview or text search.

## Add another Version and read the history

1. Find the existing Document. Open its **Actions** menu and select **Add version**.
2. Use **Choose file**, select **Kind**, and enter a **Note** if useful. Select **Upload**.
3. Check that the Document's Version number increased. Expand the row to see earlier Versions, then select a filename to read that Version. Check the Version number in the reader before downloading.

Uploading the same paper as a new Document creates a separate chain. OpenLaw does not merge those chains. An added Version preserves the earlier file's bytes, note, author, and place in the history; it does not overwrite them. There is no individual-Version delete action.

A Legal Team Member or Administrator can correct the **Kind** control on an existing hand-set Version. This changes its classification, not its bytes and not the Executed pin. **Generated redline** is reserved for a [Comparison export](compare-versions.md), cannot be selected for an ordinary upload, and cannot be corrected to or from another kind.

## Primary Document and the Executed pin

On a Contract, the **Primary** mark identifies its principal Document; **Make primary** moves that designation to another Document. **Mark as executed copy** sets the Executed pin on one Version, including an earlier Version in the expanded chain. **Unmark as executed copy** clears it. A later upload does not move an existing Executed pin merely by becoming the newest Version. Changing a Version's kind is separate from moving the pin.

Use [manual signing](manual-signing.md) or [electronic signing](electronic-signing.md) for the complete Contract workflow. A Matter or Entity has no Primary mark and no Executed pin. Knowledge has its own **Set as primary** action for choosing the paper its readers see; see [Knowledge authoring](create-knowledge.md). Business Users cannot change these designations.

## File a Contract conversation attachment

A Legal Team Member or Administrator can file an unfiled attachment from a reached, unarchived Contract's **Comments** panel:

1. Find the attachment in its comment and select **File**.
2. In **File attachment**, choose **Destination**: **New Document**, or **New Version on an existing Document**.
3. Enter **Document name** for a new Document, or choose the existing **Document** and optionally enter a **Note** for a new Version. Select **Kind**. For a new Document, review **Confidential — restrict to the contract team**; a Legal Only attachment starts with that switch turned on.
4. Select **File** and check the **Filed to** result and the destination Version.

The comment and its attachment retain their conversation audience; filing also creates managed paper governed by the owning record and Document access. Check [roles and access](roles-and-access.md) before filing paper for a different audience. Business Users can supply permitted comment attachments but do not get the filing action. Matter comments do not offer this Contract filing workflow.

## Recover from a refusal

Read the upload message before retrying. Choose a smaller file if the deployment rejects its size. Reopen the record if its access or archive state changed. Business Users should ask Legal to update a primary Document, move paper, or correct a kind. For a failed preview after a successful upload, keep the uploaded Version and follow [preview recovery](document-previews.md).
