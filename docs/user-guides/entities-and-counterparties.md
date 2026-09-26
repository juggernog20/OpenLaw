# Maintain Entities and Counterparties

Register your own corporate Entities and select the external Counterparties on a Contract. For example, Helix Research Ltd is your Entity; Cedar Supply Ltd is a Counterparty.

## Before you start

Sign in as a Legal Team Member or Administrator. Business Users do not have access to the Entities destination. If a Business User opens an Entities address, OpenLaw returns them to their home page. A Confidential Entity requires a Grant for every person, including Administrators; see [Entity structure and access](entity-structure-and-access.md).

Have the registered legal name and an available Entity type. Ask an Administrator to maintain missing [types and Fields](types-statuses-fields.md).

## Register and update an Entity

1. Open **Entities**. Its first view is **Calendar**; select **List** to browse the registry.
2. Check the existing records before creating another. Use **Search entities by name** to find a name. To narrow the list, select **Filter**, choose **Type**, **Status**, **Jurisdiction**, or **Majority owner**, pick one value, and select **Apply**. Each active filter shows as a chip. Use **Clear all** to remove every filter.
3. Select **Add entity**. Enter **Legal name** and choose **Entity type**.
4. Choose **Status** and enter the available identity details: **Formation jurisdiction**, **Formed on**, **Registration no.**, **Tax ID**, **Registered agent**, and **Registered address**. The Status defaults to **Active**.
5. If the chosen Entity type's Form marks Fields as required for creation, the dialog shows them after the identity details. Fill each one. Other Fields of the type go on the record after you register it.
6. Administrators can turn on **Portal-listed** to make the Entity selectable by name on Business Portal forms. It is off by default. You can change it later in the **Portal** card on **Overview**.
7. Optionally, use **Attach documents** to add files. If your organization has Document types for Entities, choose one **Document type** for the attached files.
8. Select **Register** and open the new Entity. You receive a Grant for the Entity that you add. On **Overview**, change an individual field and move focus away to save it. A selection saves when you choose it. Check the saved result before leaving.

If the dialog shows **Name the entity — its registered legal name.** or **Pick an entity type.**, fill the missing value and select **Register** again. **Fill** followed by a Field name means a required Field is empty.

Entity names are not unique. Registering the same legal name again creates another Entity; it does not update or merge the existing record. Compare jurisdiction and registration details before selecting a record.

**Active**, **Dormant**, **Dissolved**, and **Divested** describe the Entity's corporate Status. Choosing one does not archive it. Use [corporate records](entity-records.md) for Officers, Registrations, Holdings, Documents, and archive/restore.

## Select our Entity and the external Counterparties

1. Open a Contract you can edit. On **Overview**, choose the signing Entity in **Our entity**. Check its name after the change saves. Choose **Not known yet** to clear it.
2. In **Counterparties**, type the external organization's name. Select an existing match when it represents the same organization.
3. If the name is new, select **Create "Cedar Supply Ltd"**. The option shows the name you typed. This creates the Counterparty and adds it to this Contract. The first Counterparty receives the **Primary** mark.
4. Add any other Counterparties individually. Select **Make primary** beside the one the Contract should be listed under.
5. To remove a Counterparty from this Contract, use its remove control. Its label names the organization, for example **Take Cedar Supply Ltd off the contract**. If it was Primary, the next remaining Counterparty takes that mark. Removing the final one leaves no Counterparties on the Contract.

Removing a Counterparty from a Contract does not delete its shared record or remove it from other Contracts. These pickers let you find, create, add, and remove Counterparties on work records. This edition has no separate Counterparty administration page for renaming, merging, archiving, or restoring their shared records.

The picker matches names without regard to case and does not offer another creation for an exact existing name. A Counterparty already on the Contract is not offered again. Do not create a variant spelling to bypass an existing match.

## Recover from an unavailable choice or refused change

Check the message and your current record access. Restore an archived Entity before editing it; restore an archived Contract before changing its parties. Archived Entities and Counterparties are not offered for new selections, although an existing work record can retain its reference.

If **Our entity** or **Counterparties** is missing from a Contract's **Overview**, check the Contract type's Form. A Row placed under a Branch whose condition does not hold stays hidden until it has a value.

If an Entity type is no longer available, ask an Administrator for a live replacement. A type's in-use count includes archived Entities, so changing or archiving the type can require reassignment. That is a type-management restriction; an Entity can be archived while work records still reference it.
