# Archive, restore, or permanently delete Documents

Archive a Document to remove it from ordinary lists while keeping its Version history. Permanent deletion removes one Version at a time and needs an Administrator. Deleting a Document's last Version also removes the Document.

## Before you start

Legal Team Members and Administrators can archive and restore Documents they can reach. Business Users can read permitted paper and add Documents and Versions in the Portal, but cannot archive, restore, or delete it. Business Users have no managed-Document deletion controls. Only an Administrator sees **Delete version**; Legal Team Members do not.

Restore an archived owning record before changing its Documents through the normal record controls. Closing a Matter or ending a Contract is separate from archiving it.

## Archive a Document

1. Open the owning record's **Documents** tab, or a Knowledge Item's Documents section.
2. Find the Document, open its **Actions** menu, and select **Archive**.
3. Check that it leaves the normal list. Turn on **Show archived** to find its **Archived** row again.

To archive several live Documents, select their checkboxes and select **Archive** in the selection bar.

Archive acts on the whole Document, including its Version chain. It preserves stored files and designations; it does not pick a replacement primary Document. It removes the Document from normal search and lists. Do not treat archive as permanent erasure or as a way to revoke every previously downloaded copy.

## Restore a Document

1. Turn on **Show archived** on its owning record. In the [Documents repository](document-repository.md), select **Filter**, then **Show archived**.
2. Find the archived Document and select **Restore** from its row's Actions menu, or use the repository's Restore action. On the owning record, you can also select several archived Documents and select **Restore** in the selection bar.
3. Check that the Document is live again and its Versions remain available. Its preserved primary or executed-copy designation comes back with it where applicable.

If restoration is refused because the owning record is archived, restore that record first. Read a stale-state message and reload if someone has already restored or archived the same Document.

## Permanently delete a Version

This action cannot be undone in the app. It removes one Version, its stored original, its preview and extracted-text data, and any Comparison that uses it. The other Versions stay, and OpenLaw does not reuse the deleted Version number. If the Version carries the Executed pin, the pin is cleared. Activity and Audit log records of the action remain. Copies already downloaded or separately supplied as attachments are not erased by this action.

1. Sign in as an Administrator and open the Document's owning record. Use **Show archived** if the Document is archived.
2. To delete the current Version, open the Document's **Actions** menu and select **Delete version**. To delete an earlier Version, show the earlier Versions, open that Version's **Actions for version** menu, and select **Delete version**.
3. Read **Delete version N?**. It names the Version number and the Document. It says **All other versions will remain.**, or **This is the last version, so the document will also be removed.** Check that this is the Version you intend to remove, then type `delete` in **Type "delete" to confirm**.
4. Select **Delete version**. Check that the Version is gone and the other Versions remain; the deleted Version's links and downloads are no longer available. **Cancel** closes the dialog without deletion.

To delete a whole Document, delete its Versions one at a time. When you delete the last Version, OpenLaw also removes the Document. It clears a primary Document reference pointing to that Document; another Document is not automatically chosen.

To delete the current Version of several Documents, select their checkboxes and select **Delete versions** in the selection bar. The dialog says only the current Version of each selected Document is deleted, and asks you to type `delete`. A selected Document with one Version is removed.

OpenLaw refuses to delete a Version that a **Generated redline** Version was made from; delete the Generated redline Version first. If one Version only carries the wrong Document type, you do not need to delete it. Correct it in that Version's **Type** column, or append a corrected file as a new Version. [Version management](document-versions.md) explains both actions.

## If deletion fails

Do not assume that a failed deletion preserved every file. A storage failure can leave the Version listed while its original, previews, or Comparison files have already been removed. If someone renamed the Document while the dialog was open, OpenLaw refuses the deletion; reopen the record and try again. Record the Document name and visible error and ask the deployment operator to investigate. An Administrator can retry the intended Version deletion after the storage problem is corrected. That retry completes deletion; it does not restore missing files.
