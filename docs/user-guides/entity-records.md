# Manage Holdings, Officers, and Registrations

Keep the corporate facts and supporting Documents on the Entity they describe. Holdings connect your Entities; Officers and Registrations belong to one Entity.

## Before you start

Sign in as a Legal Team Member or Administrator and open an Entity you can reach. Restore it before changing archived records. Both Entities in a new Holding must be reachable and live. An Officer role must be available; only an Administrator adds one, in [types, Statuses, and Fields](types-statuses-fields.md). See [roles and access](roles-and-access.md) and [Entity structure and access](entity-structure-and-access.md).

## Record Officers and resignations

1. On **Overview**, find **Officers** and select **Add officer**.
2. Enter **Officer name**, choose **Role**, and enter **Appointed on** if known. Optionally select **Linked user**; an Officer does not need an OpenLaw account.
3. Select **Add**. Check the saved name, role, and date.
4. Correct an existing row's text or date and move focus away to save. Choosing another role or linked user saves that selection.
5. To retain a resignation, enter **Resigned on**. Turn on **Show former** to read former Officers. Clear the resignation date if it was entered by mistake.

A resignation date cannot precede the appointment date. **Remove name** deletes the Officer entry; use the resignation date when the appointment should remain in the corporate history. Linking a user does not grant that person Entity access.

## Record additional Registrations

1. On **Overview**, find **Registrations** and select **Add registration**.
2. Enter **Jurisdiction**, then the available **Registration number** and **Registered agent**. Choose **Status**: **Active**, **Lapsed**, or **Withdrawn**.
3. Select **Add** and check the saved row. Edit text in the row and move focus away to save; a Status selection saves immediately.
4. Use **Remove jurisdiction registration** only when the Registration entry should be deleted.

The Entity's **Formation jurisdiction** remains separate. A Registration describes another registration or qualification and does not change where the Entity was formed. Removing a Registration detaches its linked Obligations; it does not delete those Obligations. Use [Entity obligations](entity-obligations.md) to maintain their dates and filings.

## Add or correct a Holding

1. Open the Entity's **Ownership** tab and select **Add Holding**.
2. Choose **Relationship**: **Owns this Entity** when the selected Entity is the owner, or **This Entity owns** when it is the owned Entity.
3. Find and select the other **Entity**, enter **Ownership percent**, and select **Add**.
4. Check **Owners** and **Owned Entities** on the two records. Correct a percentage in its row and move focus away to save.
5. Use **Remove name** to remove the Holding. Neither Entity is deleted.

Each Holding accepts a percentage from 0 to 100. A total over 100% across owners produces a warning but still saves; check and correct the recorded percentages. An Entity cannot own itself, duplicate the same directional Holding, or create an ownership loop. Holdings do not grant access or make one Entity a child record. Use the [ownership chart](entity-structure-and-access.md#read-the-ownership-chart) to read the structure.

## Keep the Entity's Documents

Open **Documents** and follow the shared [upload and Version instructions](document-versions.md), [folder and bulk-import guide](document-folders.md), and [preview/download guide](document-previews.md). New Entities have no pre-created statutory folders. Create the structure your organization needs. The Documents stay owned by this Entity, and its access restrictions still apply.

## Archive and restore an Entity

1. Open the Entity and select **Archive**. The action saves immediately. The Entity is marked **Archived**, leaves ordinary registry and picker results, and its editable controls become unavailable.
2. To find it again, open **Entities**, choose **List**, and turn on **Show archived**. Clear other filters if needed.
3. Open the Entity and select **Restore**. Confirm that its facts, relationships, and Documents remain and that its editing controls return.

Archiving preserves the Entity and its existing references; it does not delete its Documents or mean that the corporate Status is Dissolved. Archived Entities leave the compliance calendar and Home Obligation results. Restore the Entity before changing its Officers, Registrations, Holdings, Obligations, Documents, or Grants. If another person has already archived or restored it, reload and check the current state before retrying.
