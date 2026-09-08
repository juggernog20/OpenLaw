# Configure types, Statuses, and Fields

Configure the choices and information your organization uses on its records. Sign in as an Administrator, then open your profile menu and select **Settings**.

## Add and maintain types

1. Under **Organization**, select **Contracts**, **Matters**, **Entities**, or **Knowledge**, then **Types**.
2. Select **Add type**, enter a name, and press Enter. Use a fictional example such as **Supplier assessment** while testing.
3. Select the row's **Rename** control to change its display name. Where **Edit** is available, open it to change the description and attached Fields. Leave a text field to save, and check the saved result.
4. Drag a reorder handle, or focus it and use the arrow keys, to change the display order.

A display name can change; the type's **Slug** stays fixed. Configuration saves affect the organization immediately. Test a new definition before asking colleagues to rely on it.

To archive a type, select its **Archive** control and read the usage count. If records use it, choose the live replacement requested by the dialog, then confirm. Those records move to the replacement. Check that replacement's Fields and required information first. **Other** is protected where it is provided as the module's fallback. Turn on **Show archived** and use **Restore** to make an archived definition available again; restoring it does not move reassigned records back.

Request types have their own form and target settings. See [Configure request types and forms](request-forms.md).

## Configure Statuses

For Contract Statuses, open **Contracts**, then **Statuses**. For Matter Statuses, open **Matters**, then **Statuses**. Select **Add status**, enter a name, choose its Stage or Category, and press Enter. Rename and reorder existing rows with their row controls.

| Setting         | Fixed structure                                                                                            | Archive behavior                                                                                                                                                                                                                                                      |
| --------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract Status | Draft, Review, Approval, Signature, Active, and Ended Stages. A Status keeps the Stage chosen at creation. | The built-in Statuses initially named Draft (Draft Stage), Active (Active Stage), and Expired (Ended Stage) are protected. Every Stage must retain a live Status. Move Contracts off another Status yourself before archiving it; this dialog does not reassign them. |
| Matter Status   | Open and Closed Categories. A Status keeps the Category chosen at creation.                                | Open and Closed are protected. Every Category must retain a live Status. For an in-use custom Status, choose a replacement in the same Category when archiving.                                                                                                       |

Renaming a Status changes its label, not its Stage or Category. To use a different mapping, create a new Status with the intended mapping and move the work deliberately. See [Change a Contract Status](contract-stages.md) and [Close, reopen, and archive Matters](matter-status-and-archive.md) for record-level consequences.

## Create a Field

1. Open **Contracts**, **Matters**, or **Entities**, then **Fields**.
2. Select **Add field**. Enter **Name** and, if useful, **Description** as help for the person completing it.
3. Choose **Type**: Text, Long text, Number, Date, Boolean, Single select, Multi select, User, or Entity. The type cannot change after creation.
4. Choose **Scope** for this module or **Global**, and a **Tag** of Business or Legal. For a select Field, enter **Options**, one per line in the intended order.
5. Select **Add field**, then check the new row.

Global Fields share one definition across modules. In **Edit**, you can promote a module Field to Global. Narrowing it back to a module is refused while another module attaches it; detach those attachments first if narrowing is intended. Stored values are retained. After any failed multi-part save, reopen the editor to check which changes saved before retrying.

The Field catalog does not have reorder handles. Set order where Fields are attached to a type or form. Contract-scoped Fields may also have an **AI prompt**; [Configure the AI connector and Field prompts](configure-analysis.md) covers that separate setup.

## Attach Fields and set requiredness

1. Open the module's **Types** tab and select **Edit** on the intended type.
2. Under **Attached fields**, select **Attach field** and choose an eligible module or Global Field.
3. Turn on its **Required** checkbox if it must be supplied. Reorder the attached Fields with their handles.
4. Create a fictional record of this type, first leaving a required Field empty, then supplying a valid value. Confirm the accepted record contains the intended information.

Requiredness belongs to this attachment. It is checked at creation and when changing a record's type; setting it does not fill missing information on old records. The Request form's requiredness is a separate setting. A Field collected on a Request must also be attached to the destination type to carry through conversion.

**Detach** removes an attachment while keeping the Field definition and stored values. **Archive** in the Field catalog hides the Field from live configuration and keeps its attachments and stored values for restoration. Neither operation transfers answers to another Field. Use **Show archived**, then **Restore**, to recover the definition.

In this version, an Entity-valued Field left blank when creating a Matter may offer no Entity choices on that Matter's Overview. Choose the Entity during initial creation when possible. Do not assume an empty picker means the Entity was deleted; ask your Administrator to investigate an existing Matter that needs correction.

## Maintain Officer roles

Open **Entities**, **Officer roles**. Use **Add role**, the row's **Rename** control, and its reorder handle. When archiving an in-use role, select its replacement and confirm **Archive role**. Usage and reassignment include resigned Officer entries as well as current appointments. **Other** cannot be archived. Restoring a role makes it selectable again without reversing the reassignment.

These roles describe Entity appointments; they do not grant app access. [Manage Entity records and Officers](entity-records.md) covers appointments, and [Manage your organization and users](organisation-and-users.md) covers app roles.

If a save is refused, read the error, reload the configuration, and resolve the stated usage or scope restriction. Other app roles cannot change these Administrator settings. Use the [Audit log](reminders-and-audit.md) to inspect recorded changes.
