# Create and organize Knowledge Items

Build your organization's library of templates, precedents, playbooks, and guidance. Each Knowledge Item has its own title, type, optional guidance, and Documents.

## Before you start

Sign in as a Legal Team Member or Administrator and open **Knowledge**. An Administrator must have configured at least one active Knowledge type. Business Users cannot author or browse the staff Knowledge library; Business Users read items made available through the [Business Portal](portal-knowledge.md).

Knowledge contains your organization's know-how. OpenLaw **Help** contains product instructions. Help search does not search your Knowledge Items or their files.

## Start with files

1. Select **New**, then **New from files**.
2. Use **Drop files here or choose files** to select your files. Choose a **Type** and **Folder**, or leave the folder as **Library**.
3. Select **Create drafts**. Each file creates a separate draft Knowledge Item, named after the file, with its own Document selected as primary. The first item opens; return to **Knowledge** to find the others.
4. Review **Title**, **Type**, and **Folder** on the record. A title saves when you press Enter or leave the field; a selected type or folder saves when changed. Check the saved result before moving on.

Use this path for separate library entries. To put several Documents on one item, create that item first and upload its supporting files in the **Documents** section.

## Start with guidance

1. In **Knowledge**, select **New**, then **New Knowledge Item**.
2. Enter **Title**, choose **Type** and **Folder**, and select **Create item**. The item starts as **Draft**, with **Audience** set to **Legal Only**.
3. Under **Guidance**, select **Add guidance**. Enter your instructions in **Guidance in Markdown**. Headings, lists, emphasis, code, and links are supported.
4. Select **Preview** to save when the editor loses focus and inspect the rendered guidance. Select **Edit** to return to the source. Reload the item to confirm the saved text if a save is uncertain.

Guidance can stand alone without a Document. Do not use raw HTML for formatting. Edits to an already published item take effect in place; there is no separate item revision awaiting publication. [Unpublish](publish-knowledge.md#withdraw-or-restrict-an-item) first if Portal readers should not see your edits yet.

## Add Documents and choose the primary

1. In the item's **Documents** section, [upload a new Document](document-versions.md#upload-a-new-document) or add a Version to an existing Document.
2. Open the desired Document's **Actions** menu and select **Set as primary**. Check its **Primary** mark and the **Primary document** control above the Documents section.
3. Select **Open preview** to read the primary Document's current Version. Other Documents remain supporting Documents and keep their own Version histories.

The primary choice changes presentation; it does not make supporting files private. When an item becomes available in the Portal, readers can download the current Version of every available Document on it. Check all supporting files before [publishing](publish-knowledge.md).

A Knowledge Item's Documents use a flat list. Knowledge Folders organize whole items, not the files inside an item. Use the Document row's actions for [archive, restore, and permanent deletion](archive-and-delete-documents.md). Archiving a Document preserves its Versions and designation; restoring it returns that Document to the ordinary list. Archiving does not choose a replacement primary Document.

## Organize the library

1. Select **All Knowledge** for the whole library, or a folder to see its items and descendants. **Type**, **State**, **Audience**, **Author**, and **Format** can narrow the list separately; clear restrictive filters if an item seems missing.
2. Select **Add folder**, enter **Folder name**, and select **Add folder** in the dialog. A selected folder becomes the parent; choose **All Knowledge** first to create a top-level folder.
3. Select a folder and use **Rename or move selected folder**. Change **Folder name** or **Parent folder**, then select **Save folder**. The folder itself and its descendants are excluded from the parent choices, preventing a cycle.
4. Use the selected folder's up/down controls to change its order among sibling folders. To move an item, open the item and change its **Folder**.
5. To dissolve a folder, select it, choose **Delete selected folder**, read the confirmation, and select **Delete folder**. Its items and child folders move to its parent; no Knowledge Item or Document is deleted.

Use [saved views and global search](search-and-views.md) when you need a repeatable list or a search across item text and processed Document text. A folder selection is a list filter, not an access restriction.

## Recover from an unavailable choice

If no type is available, ask an Administrator to configure Knowledge types. Administrators can use **Manage types…** beside **Type** on the record; see [types and Fields](types-statuses-fields.md). Archived types are unavailable for new selection. Reload before choosing a replacement if someone changed the available types or folders while you were editing.

An archived Knowledge Item cannot be edited or receive uploads. Follow [restore](publish-knowledge.md#archive-and-restore) before continuing. If an upload succeeds but its preview is still processing or fails, follow [Document preview recovery](document-previews.md#processing-scans-and-failed-previews).
