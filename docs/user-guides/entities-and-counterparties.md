# Maintain Entities and Counterparties

Register your own corporate Entities and select the external Counterparties on a Contract. For example, Helix Research Ltd is your Entity; Cedar Supply Ltd is a Counterparty.

## Before you start

Sign in as a Legal Team Member or Administrator. Contributors and Business Users do not have access to the Entities destination. A Confidential Entity requires an explicit Grant unless you are an Administrator; see [Entity structure and access](entity-structure-and-access.md).

Have the registered legal name and an available Entity type. Ask an Administrator to maintain missing [types and Fields](types-statuses-fields.md).

## Register and update an Entity

1. Open **Entities**. Its first view is **Calendar**; select **List** to browse the registry.
2. Check the existing records before creating another. Use **Type**, **Status**, **Jurisdiction**, or **Majority owner** to narrow the list; use **Clear all** to remove filters.
3. Select **Register entity**. Enter **Legal name** and choose **Entity type**.
4. Choose **Status** and enter the available identity details: **Formation jurisdiction**, **Formed on**, **Registration no.**, **Tax ID**, **Registered agent**, and **Registered address**. The Status defaults to **Active**.
5. Select **Register** and open the new Entity. On **Overview**, change an individual field and move focus away to save it. A selection saves when you choose it. Check the saved result before leaving.

Entity names are not unique. Registering the same legal name again creates another Entity; it does not update or merge the existing record. Compare jurisdiction and registration details before selecting a record.

**Active**, **Dormant**, **Dissolved**, and **Divested** describe the Entity's corporate Status. Choosing one does not archive it. Use [corporate records](entity-records.md) for Officers, Registrations, Holdings, Documents, and archive/restore.

## Select our Entity and the external Counterparties

1. Open a Contract you can edit. On **Overview**, choose the signing Entity in **Our entity**. Check its name after the change saves.
2. In **Counterparties**, type the external organization's name. Select an existing match when it represents the same organization.
3. If the name is new, select **Create "name"**. This creates the Counterparty and adds it to this Contract. The first Counterparty receives the **Primary** mark.
4. Add any other Counterparties individually. Select **Make primary** beside the one the Contract should be listed under.
5. To remove a Counterparty from this Contract, use its remove control, labeled **Take name off the contract**. If it was Primary, the next remaining Counterparty takes that mark. Removing the final one leaves no Counterparties on the Contract.

Removing a Counterparty from a Contract does not delete its shared record or remove it from other Contracts. These pickers let you find, create, add, and remove Counterparties on work records. This edition has no separate Counterparty administration page for renaming, merging, archiving, or restoring their shared records.

The picker matches names without regard to case and does not offer another creation for an exact existing name. A Counterparty already on the Contract is not offered again. Do not create a variant spelling to bypass an existing match.

## Recover from an unavailable choice or refused change

Check the message and your current record access. Restore an archived Entity before editing it; restore an archived Contract before changing its parties. Archived Entities and Counterparties are not offered for new selections, although an existing work record can retain its reference.

If an Entity type is no longer available, ask an Administrator for a live replacement. A type's in-use count includes archived Entities, so changing or archiving the type can require reassignment. That is a type-management restriction; an Entity can be archived while work records still reference it.
