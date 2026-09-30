# Manage Holdings, Officers, and Registrations

Keep the corporate facts and supporting Documents on the Entity they describe. Holdings connect an Entity to its owners and to the Entities it owns; Officers and Registrations belong to one Entity.

## Before you start

Sign in as a Legal Team Member or Administrator and open an Entity you can reach. Restore it before changing archived records. OpenLaw writes Holdings from share registers, so you record an owner in the owned Entity's register. An Officer role must be available; only an Administrator adds one, in [types, Statuses, and Fields](types-statuses-fields.md). See [roles and access](roles-and-access.md) and [Entity structure and access](entity-structure-and-access.md).

## Record Officers and resignations

1. On **Overview**, find **Directors & Officers** and select **Add director or officer**.
2. In **Director or officer name**, start typing. The list shows matching OpenLaw users. Select a user to fill the name and link that user. A linked name shows a person icon.
3. To record someone without an OpenLaw account, type the full name and choose **Use "Helena Marsh" without linking a user**, or press Enter. Typing over a name removes its user link.
4. Choose **Role** and enter **Appointed on** if known. **Add** is available when the name and role have values. Select **Add**, then check the saved name, role, and date.
5. To correct an existing row, change its name the same way, or change its date and move focus away. The row saves when you select a name or leave the field. Choosing another role saves that selection. If a save fails, the row shows the saved value again.
6. To retain a resignation, enter **Resigned on**. Turn on **Show former** to read former Officers. Clear the resignation date if it was entered by mistake.

A resignation date cannot precede the appointment date. The remove control deletes the Officer entry. Its label names the person, for example **Remove Ravi Menon**. Use it only for an entry made in error; use the resignation date when the appointment should remain in the corporate history. Linking a user does not grant that person Entity access.

## Record additional Registrations

1. On **Overview**, find **Registrations** and select **Add registration**.
2. Enter **Jurisdiction**, then the available **Registration number** and **Registered agent**. Choose **Status**: **Active**, **Lapsed**, or **Withdrawn**.
3. Select **Add** and check the saved row. Edit text in the row and move focus away to save; a Status selection saves immediately.
4. Use the remove control only when the Registration entry should be deleted. Its label names the jurisdiction, for example **Remove Delaware registration**.

The Entity's **Formation jurisdiction** remains separate. A Registration describes another registration or qualification and does not change where the Entity was formed. Removing a Registration detaches its linked Obligations; it does not delete those Obligations. Use [Entity obligations](entity-obligations.md) to maintain their dates and filings.

## Read an Entity's Holdings

A Holding records the percentage one owner holds of an Entity. The owner is another Entity or a named individual. OpenLaw writes every Holding from a share register. You cannot add, edit, or remove a Holding by hand. To record an owner of an Entity, record an entry in that Entity's [share register](entity-structure-and-access.md#keep-the-share-register).

1. Open the Entity's **Ownership** tab.
2. To see who owns this Entity, read **Register of members**. Each Holder on the register is an owner.
3. To see what this Entity owns, read **Holdings in other Entities**. Each row shows the owned Entity and the percentage this Entity holds. An Entity you cannot reach shows as **Restricted Entity**.
4. To change a row, select **From register**. OpenLaw opens the share register of the owned Entity. Record or correct an entry there.

When this Entity owns no other Entities, the card reads **This Entity owns no other Entities. A Holding appears here when the share register of another Entity records shares for this Entity.**

An Entity with no share register has no owners in OpenLaw and stands alone on the ownership chart. To connect it, open its **Ownership** tab, add a share class, and record an allotment to its owner. For an Entity without shares, such as a branch or a limited liability company, name the class after the interest the owner holds, for example **Membership units**.

Holdings do not grant access or make one Entity a child record. An Entity cannot hold its own shares, and the register refuses an entry that would create an ownership loop. Use the [ownership chart](entity-structure-and-access.md#read-the-ownership-chart) to read the structure.

## Keep the Entity's Documents

Open **Documents** and follow the shared [upload and Version instructions](document-versions.md), [folder and bulk-import guide](document-folders.md), and [preview/download guide](document-previews.md). New Entities have no pre-created statutory folders. Create the structure your organization needs. The Documents stay owned by this Entity, and its access restrictions still apply.

## Archive and restore an Entity

1. Open the Entity and select **Archive**. The action saves immediately. The Entity is marked **Archived**, leaves ordinary registry and picker results, and its editable controls become unavailable.
2. To find it again, open **Entities** and choose **List**. Select **Filter**, then **Show archived**. Clear other filters if needed.
3. Open the Entity and select **Restore**. Confirm that its facts, relationships, and Documents remain and that its editing controls return.

Archiving preserves the Entity and its existing references; it does not delete its Documents or mean that the corporate Status is Dissolved. Archived Entities leave the compliance calendar and Home Obligation results. Restore the Entity before changing its Officers, Registrations, Holdings, share register, Obligations, Documents, or Grants. If another person has already archived or restored it, reload and check the current state before retrying.
