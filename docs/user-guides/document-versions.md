# Upload Documents and add Document Versions

Keep every Version of the same paper in one Document. Each upload adds an immutable Document Version, so an earlier Version remains available to read and download.

## Before you start

Open a Contract, Matter, Entity, or Knowledge Item you can reach. Legal Team Members and Administrators can manage its Documents. Business Users on a Contract or Matter team can upload Documents and add Versions in the Portal, including a new Version of a Contract's primary Document. They cannot correct a Version's Document type, change designations or folders, or archive or delete paper. An archived owning record must be restored before uploading.

Every Document belongs to one owning record. Start on that record, not the central Documents repository. Business Users supply Request or comment attachments through the [Business Portal](follow-request.md); those attachments are not automatically managed Documents.

A Document Version can carry one Document type. The type is optional. An Administrator keeps one type list each for Matters, Contracts, and Entities: open your profile menu, select **Settings**, then **Documents**. The Contract list starts with six fixed types: **Draft · ours**, **Draft · theirs**, **Redline · theirs**, **Redline · ours**, **Executed**, and **Amendment**. The Matter and Entity lists start empty. Until an Administrator adds a type there, a Matter or Entity upload has no **Type** control. A Knowledge Item has no type list; its files show the item's Knowledge type.

## Upload a new Document

1. Open the record's **Documents** tab. On a Knowledge Item, use its Documents section.
2. Select **Upload**. In the **Upload document** dialog, select **Choose files** and choose one file for a new Document. Selecting several files opens the [bulk import](document-folders.md) dialog instead.
3. If the dialog shows **Type**, choose the type that describes the paper, or leave **No type**. **Type** always starts on **No type**. Optionally enter a **Note** explaining this Version.
4. Select **Upload**. Check the new row and its **v1** Version. The filename supplies the initial Document name; a Legal Team Member or Administrator can use the row's **Actions** menu, **Edit details**, and **Save** to change its name and description.

On a Contract with no primary Document, the first Document a Legal Team Member or Administrator uploads becomes the primary Document. On a Knowledge Item with no primary paper, the first Document becomes its primary paper.

Any file type can be stored, subject to the deployment's upload limit. [Preview support](document-previews.md) is narrower. A successful upload can still be processing for preview or text search.

## Add another Version and read the history

1. Find the existing Document. Open its **Actions** menu and select **Add version**.
2. In **Add version**, use **Choose file**. Choose a **Type** if the dialog shows it, and enter a **Note** if useful. The new Version does not copy the earlier Version's type. Select **Upload**.
3. Check that the Document's Version number increased. Select the arrow beside the Document name to show earlier Versions, then select a filename to read that Version. Check the Version number in the reader before downloading.

Uploading the same paper as a new Document creates a separate chain. OpenLaw does not merge those chains. An added Version preserves the earlier file's bytes, note, author, and place in the history; it does not overwrite them. There is no individual-Version delete action.

The **Type** column shows each Version's Document type. A Legal Team Member or Administrator can correct a type from that column while the record and the Document are unarchived. Choose another type from the record's list, or **No type**. The correction changes the type only. The bytes, note, author, Version number, and Executed pin stay the same. Where the record's list is empty and a Version has no type, the column shows a dash and offers no choice.

You cannot correct every Version. A **Generated redline** from a [Comparison export](compare-versions.md) has no type and shows **Generated redline**. It is read-only, and no upload list offers it. A Version that an Auto-Doc generated is also read-only. On a Knowledge Item, the column shows the item's Knowledge type. The column offers a choice there, but OpenLaw refuses the change and the Version keeps its label. To change that label, change the Knowledge Item's **Type**; see [Knowledge authoring](create-knowledge.md).

## Configure Document type colours

An Administrator can open **Settings → Documents**, choose **Matters**, **Contracts**, or **Entities**, and select the colour swatch beside a Document type. Choose a colour to save it immediately, or **Automatic** to restore its default. Built-in Contract types keep their fixed names but can have any of the available colours.

The colour applies to existing and future Versions carrying that type, including archived types, in record Documents, the Documents repository, and the Business Portal. Colours adapt to the selected theme and do not change a Version's kind or the Executed pin.

## Primary Document and the Executed pin

On a Contract, the **Primary** mark identifies its principal Document; **Make primary** moves that designation to another Document. **Mark as executed copy** sets the Executed pin on one Version, including an earlier Version in the expanded chain. **Unmark as executed copy** clears it. A later upload does not move an existing Executed pin merely by becoming the newest Version. The **Executed** type is separate from the pin. Choosing that type does not set the pin, and correcting a Version's type does not move it.

Use [manual signing](manual-signing.md) or [electronic signing](electronic-signing.md) for the complete Contract workflow. A Matter or Entity has no Primary mark and no Executed pin. Knowledge has its own **Set as primary** action for choosing the paper its readers see; see [Knowledge authoring](create-knowledge.md). Business Users cannot change these designations.

## File a Contract or Matter conversation attachment

A Legal Team Member or Administrator can file an unfiled attachment from a reached, unarchived Contract's or Matter's **Comments** panel:

1. Find the attachment in its comment and select **File to Contract** or **File to Matter**. You can also select the attachment name to open its preview, then select the same action there.
2. In **File attachment**, choose **Destination**: **New Document**, or **New Version on an existing Document**.
3. Enter **Document name** for a new Document, or choose the existing **Document** and optionally enter a **Note** for a new Version. If the dialog shows **Type**, choose a type or leave **No type**. For a new Document, review the Confidential switch. On a Contract it reads **Confidential — restrict to the contract team**. On a Matter it reads **Confidential — restrict to the matter team**. A Legal Only attachment starts with that switch turned on.
4. Select **File** and check the **Filed to** result and the destination Version.

The comment and its attachment retain their conversation audience; filing also creates managed paper governed by the owning record and Document access. Check [roles and access](roles-and-access.md) before filing paper for a different audience. Business Users can supply permitted comment attachments but do not get the filing action.

## Recover from a refusal

Read the upload message before retrying. Choose a smaller file if the deployment rejects its size. Reopen the record if its access or archive state changed. A refused upload or type correction adds no Version and leaves the chain as it was. If **Type** does not offer the type you need, ask an Administrator to add it to the module's list. Business Users should ask Legal to change a designation, move paper, or correct a type. For a failed preview after a successful upload, keep the uploaded Version and follow [preview recovery](document-previews.md).
