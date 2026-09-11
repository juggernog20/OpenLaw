# Archive, restore, or permanently delete Documents

Archive a Document to remove it from ordinary lists while keeping its Version history. Permanent deletion removes the entire Document and needs an Administrator.

## Before you start

Legal Team Members and Administrators can archive and restore Documents they can reach. Business Users can read permitted paper and supply supporting uploads, but cannot archive, restore, or delete it. Business Users have no managed-Document deletion controls.

Restore an archived owning record before changing its Documents through the normal record controls. Closing a Matter or ending a Contract is separate from archiving it.

## Archive a Document

1. Open the owning record's **Documents** tab, or a Knowledge Item's Documents section.
2. Find the Document, open its **Actions** menu, and select **Archive**.
3. Check that it leaves the normal list. Turn on **Show archived** to find its **Archived** row again.

Archive acts on the whole Document, including its Version chain. It preserves stored files and designations; it does not pick a replacement primary Document. It removes the Document from normal search and lists. Do not treat archive as permanent erasure or as a way to revoke every previously downloaded copy.

## Restore a Document

1. Turn on **Show archived** on its owning record, or in the [Documents repository](document-repository.md).
2. Find the archived Document and select **Restore** from its row's Actions menu, or use the repository's Restore action.
3. Check that the Document is live again and its Versions remain available. Its preserved primary or executed-copy designation comes back with it where applicable.

If restoration is refused because the owning record is archived, restore that record first. Read a stale-state message and reload if someone has already restored or archived the same Document.

## Permanently delete a Document

This action cannot be undone in the app. It removes every Version, the stored originals, and their derived preview and extracted-text data. It clears a primary Document reference pointing to this Document; another Document is not automatically chosen. Activity and Audit log records of the action remain. Copies already downloaded or separately supplied as attachments are not erased by this action.

1. Sign in as an Administrator and open the Document's owning record. Use **Show archived** if the Document is archived.
2. Open its **Actions** menu and select **Delete**.
3. Read **Delete this document?** and type the Document's displayed name in **Type … to confirm**. Check that this is the entire Document you intend to remove.
4. Select **Delete**. Check that the Document is gone; earlier Version links and downloads are no longer available. **Cancel** closes the dialog without deletion.

You cannot delete just one Version. Correct an ordinary Version kind or append a corrected file through [Version management](document-versions.md) when those actions fit the intended change.

## If deletion fails

Do not assume that a failed deletion preserved every file. A storage failure can leave the Document listed while some originals or previews have already been removed. Record the Document name and visible error and ask the deployment operator to investigate. An Administrator can retry the intended whole-Document deletion after the storage problem is corrected. That retry completes deletion; it does not restore missing files.
