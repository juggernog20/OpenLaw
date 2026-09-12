# Organize folders and upload in bulk

Use folders inside one Contract, Matter, or Entity to organize its Documents. Import several files together while keeping each file's success or failure visible.

## Before you start

Use a Legal Team Member or Administrator account with access to an unarchived owning record. Business Users can upload supporting paper at the record root, including multiple files, but cannot create folders, move Documents, or import a folder structure. Knowledge Folders organize Knowledge Items; they do not create Document folders inside an item.

## Create and maintain folders

1. Open the owning record's **Documents** tab and select **New folder**.
2. Enter **Name**, then **Save**. Expand the folder to read its Documents.
3. Use **Actions for the … folder** to **Rename**, **Move**, or create a **New folder inside**. Choose the destination in **Move into** and select **Move**.
4. To file an existing Document, use its **Actions** menu and **Move to folder**. Choose **File in** and select **Move**. The owning record itself is the destination for moving it out of folders.

A folder stays inside its owning record. Sibling names must be distinct without regard to case; blank names, slashes, and the exact names `.` and `..` are refused. A folder cannot move into itself or one of its descendants. Read the refusal and choose another name or destination.

**Delete** on a folder dissolves that folder: its contents move into its parent, or onto the record itself when it has no parent. Read the confirmation before proceeding. It does not permanently delete the Documents; [Document deletion](archive-and-delete-documents.md) is a separate action.

## Import several files

1. Select **Upload**, then **Choose files** and choose several files. You can also drop files on the Documents section or a folder.
2. Review the **Import … files** dialog. Check the displayed **Destination**: a picker imports at **Record root**; a drop uses the place where you dropped the files. The destination cannot be changed inside this dialog.
3. Select **Version kind**. It applies to every file in this import; bulk import does not collect individual Notes.
4. Select **Import … files**. Keep the dialog open while the import runs.
5. Read the final uploaded and failed counts, then select **Done**. Each successful file is a new Document at Version 1, not another round on an existing Document.

For another round of one Document, use [Add version](document-versions.md) instead.

## Keep a local folder structure

Use **Choose folder** in the Upload dialog, or drop a local folder onto the Documents section or an existing folder. Review the tree and destination before importing. The selected top-level folder and its nested structure are included. A matching existing folder path can be reused.

Dropping a folder can recreate empty folders. The folder picker carries files only, so empty folders do not survive that picker. If the browser cannot read part of a dropped tree, the dialog reports the unreadable folders; check the listed files before importing. Browser support and the chosen gesture determine whether folder paths are available.

## Recover a partial import

A failed file does not roll back successful files. Read each failed row. **Retry** on a row, or the dialog's **Retry … file(s)** action, retries eligible failed uploads without uploading successful rows again. A size or invalid-path refusal needs corrected input; the unchanged file is not offered a retry that would repeat the same refusal.

**Cancel remaining** stops queued work. Files already uploaded remain, and an upload already in progress may finish. Read the final counts before leaving. If a connection failure leaves you unsure whether a file arrived, inspect the record before starting a new import of the same files.

Text extraction and OCR continue in the background after upload. A processing failure is separate from an import failure; see [reading and downloading Documents](document-previews.md).
