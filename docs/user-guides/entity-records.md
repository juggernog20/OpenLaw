# Manage Holdings, Officers, and Registrations

Keep the corporate facts and supporting Documents on the Entity they describe. Holdings connect an Entity to its owners and to the Entities it owns; Officers and Registrations belong to one Entity.

## Before you start

Sign in as a Legal Team Member or Administrator and open an Entity you can reach. Restore it before changing archived records. Both Entities in a new Holding must be reachable and live. An Officer role must be available; only an Administrator adds one, in [types, Statuses, and Fields](types-statuses-fields.md). See [roles and access](roles-and-access.md) and [Entity structure and access](entity-structure-and-access.md).

## Record Officers and resignations

1. On **Overview**, find **Directors & Officers** and select **Add director or officer**.
2. Enter **Director or officer name**, choose **Role**, and enter **Appointed on** if known. Optionally select **Linked user**; an Officer does not need an OpenLaw account.
3. Select **Add**. Check the saved name, role, and date.
4. Correct an existing row's text or date and move focus away to save. Choosing another role or linked user saves that selection.
5. To retain a resignation, enter **Resigned on**. Turn on **Show former** to read former Officers. Clear the resignation date if it was entered by mistake.

A resignation date cannot precede the appointment date. The remove control deletes the Officer entry. Its label names the person, for example **Remove Ravi Menon**. Use it only for an entry made in error; use the resignation date when the appointment should remain in the corporate history. Linking a user does not grant that person Entity access.

## Record additional Registrations

1. On **Overview**, find **Registrations** and select **Add registration**.
2. Enter **Jurisdiction**, then the available **Registration number** and **Registered agent**. Choose **Status**: **Active**, **Lapsed**, or **Withdrawn**.
3. Select **Add** and check the saved row. Edit text in the row and move focus away to save; a Status selection saves immediately.
4. Use the remove control only when the Registration entry should be deleted. Its label names the jurisdiction, for example **Remove Delaware registration**.

The Entity's **Formation jurisdiction** remains separate. A Registration describes another registration or qualification and does not change where the Entity was formed. Removing a Registration detaches its linked Obligations; it does not delete those Obligations. Use [Entity obligations](entity-obligations.md) to maintain their dates and filings.

## Add or correct a Holding

A Holding records the percentage one owner holds of an Entity. The owner is another Entity or a named individual. If the Entity keeps a share register, OpenLaw writes its owner Holdings from the register entries. Record those owners in the [share register](entity-structure-and-access.md#keep-the-share-register). Use **Add Holding** for an Entity without a register and for the Entities this Entity owns.

1. Open the Entity's **Ownership** tab. Select **Add Holding** below **Holdings in other Entities**.
2. Keep **Owner type** set to **Entity**, then choose **Relationship**: **Owns this Entity** when the selected Entity is the owner, or **This Entity owns** when it is the owned Entity.
3. Find and select the other **Entity**, enter **Ownership percent**, and select **Add**. **Ownership percent** starts at 100.
4. To record a person who owns this Entity, choose **Individual** instead, enter their **Full name** and **Ownership percent**, and select **Add**. No Entity record or OpenLaw account is required. Names are recorded on each Holding; matching names are not automatically treated as the same person.
5. Check the result. An Entity this Entity owns appears under **Holdings in other Entities**. An owner of this Entity appears under **Declared owners not in the register**. That card appears only when such an owner exists. Correct a percentage in its row and move focus away to save.
6. To remove a Holding, use the remove control in its row. Its label names the other party, for example **Remove Helix Holdings Ltd**. Neither Entity is deleted. To correct an individual name, remove that Holding and add it again with the correct name.

A row marked **From register** comes from a share register. Its percentage and remove controls are unavailable. Select **From register** to open the register that produced it, and record an entry there to change it. When a register entry names an owner Entity that already has a hand-typed Holding, the register's Holding replaces it at that entry. A hand-typed individual stays beside the register's Holding, even when the names match. Remove the hand-typed row so that the person is not counted twice.

OpenLaw still accepts a hand-typed owner on an Entity that keeps a share register. It lists that owner under **Declared owners not in the register**. Prefer a register entry, so that the register stays the one record of that Entity's owners.

Each Holding accepts a percentage from 0 to 100. A total over 100% across owners produces a warning, such as **Ownership totals 120% for Helix Research Ltd.**, but still saves. Check and correct the recorded percentages. An Entity cannot own itself, duplicate the same directional Holding, or create an ownership loop. Holdings do not grant access or make one Entity a child record. Use the [ownership chart](entity-structure-and-access.md#read-the-ownership-chart) to read the structure.

## Keep the Entity's Documents

Open **Documents** and follow the shared [upload and Version instructions](document-versions.md), [folder and bulk-import guide](document-folders.md), and [preview/download guide](document-previews.md). New Entities have no pre-created statutory folders. Create the structure your organization needs. The Documents stay owned by this Entity, and its access restrictions still apply.

## Archive and restore an Entity

1. Open the Entity and select **Archive**. The action saves immediately. The Entity is marked **Archived**, leaves ordinary registry and picker results, and its editable controls become unavailable.
2. To find it again, open **Entities** and choose **List**. Select **Filter**, then **Show archived**. Clear other filters if needed.
3. Open the Entity and select **Restore**. Confirm that its facts, relationships, and Documents remain and that its editing controls return.

Archiving preserves the Entity and its existing references; it does not delete its Documents or mean that the corporate Status is Dissolved. Archived Entities leave the compliance calendar and Home Obligation results. Restore the Entity before changing its Officers, Registrations, Holdings, share register, Obligations, Documents, or Grants. If another person has already archived or restored it, reload and check the current state before retrying.
