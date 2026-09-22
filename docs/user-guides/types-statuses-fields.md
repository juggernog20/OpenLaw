# Configure types, Statuses, and Fields

Configure the choices and information your organization uses on its records. Sign in as an Administrator, then open your profile menu and select **Settings**.

## Add and maintain types

1. Under **Organization**, select **Contracts**, **Matters**, **Entities**, or **Knowledge**, then **Types**.
2. Select **Add type**, enter a name, and select **Save**. Select **Cancel** to discard the draft. Use a fictional example such as **Supplier assessment** while testing.
3. Select the row's **Rename** control to change its display name. Where **Edit** is available, open it to change the description or select the **Form** tab. Leave a text field to save, and check the saved result.
4. Drag a reorder handle, or focus it and use the arrow keys, to change the display order.

A display name can change without breaking existing records or configuration. Configuration saves affect the organization immediately. Test a new definition before asking colleagues to rely on it.

To archive a type, select its **Archive** control and read the usage count. If records use it, choose the live replacement requested by the dialog, then confirm. Those records move to the replacement. Check that replacement's Fields and required information first. **Other** remains protected where provided. Contracts and Matters also have one **Default type**. You can rename it, but cannot archive or delete it. Create dialogs preselect it, and a Request type with a module-only destination reads its Form. Other types do not inherit that Form. Turn on **Show archived** and use **Restore** to make an archived definition available again; restoring it does not move reassigned records back.

Request types have destination settings and read the destination type's Form. See [Configure request types and forms](request-forms.md).

## Configure Statuses

For Contract Statuses, open **Contracts**, then **Statuses**. For Matter Statuses, open **Matters**, then **Statuses**. Select **Add status**, enter a name, and choose its Stage or Category. For a Matter Status in the Open Category, also choose its group: **Open**, **In progress**, or **Waiting**. A new Status uses **In progress** unless you choose another group. Select **Save status**, or select **Cancel** to discard the draft. Rename and reorder existing rows with their row controls.

| Setting         | Fixed structure                                                                                                                                      | Archive behavior                                                                                                                                                                                                                                                      |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract Status | Draft, Review, Approval, Signature, Active, and Ended Stages. A Status keeps the Stage chosen at creation.                                           | The built-in Statuses initially named Draft (Draft Stage), Active (Active Stage), and Expired (Ended Stage) are protected. Every Stage must retain a live Status. Move Contracts off another Status yourself before archiving it; this dialog does not reassign them. |
| Matter Status   | Open and Closed Categories. A Status keeps the Category chosen at creation. An Open-Category Status also has a group that you can change on its row. | Open and Closed are protected. Every Category must retain a live Status. For an in-use custom Status, choose a replacement in the same Category when archiving.                                                                                                       |

Renaming a Status changes its label, not its Stage, Category, or group. A Matter Status group sets how the Status is grouped and colored on Matter lists and records. It does not change whether the Matter is open or closed. To use a different mapping, create a new Status with the intended mapping and move the work deliberately. See [Change a Contract Status](contract-stages.md) and [Close, reopen, and archive Matters](matter-status-and-archive.md) for record-level consequences.

## Create a Field

Matter and Contract Fields settings show a **Default Fields** card that lists the built-in record columns, for example **Title**, as locked, read-only rows. Do not look for rename or archive controls on a built-in column; set its value on each record. **Default Fields** starts collapsed; select its heading to expand it. **Custom Fields** starts expanded underneath with the controls to add and manage your own Fields.

Three Contract Fields in the **Custom Fields** list came with the installation: **Governing law**, **Jurisdiction**, and **Our position**. These are default Fields, which are catalog rows, not built-in columns. Rename a default Field and edit its description and AI prompt as you do for any Field. Do not try to archive one: each shows a lock in place of its archive control, and OpenLaw refuses the archive. Start blank in the first-run wizard keeps default Fields. See [Start blank](first-run.md#start-blank).

1. Open **Contracts**, **Matters**, or **Entities**, then **Fields**.
2. Select **Add field**. Enter **Name** and, if useful, **Description** as help for the person completing it.
3. Choose **Type**: Text, Long text, Number, Currency, Date, Boolean, Single select, Multi select, User, or Entity. The type cannot change after creation.
4. For a select Field, enter **Options**, one per line in the intended order. Portal visibility is set on each type Form Row after attachment.
5. Select **Add field**, then check the new row.

Fields belong to the area where you create them: Contracts, Matters, or Entities. A field can be attached to several types within that area. To collect similar information in another area, create a separate field there.

The Field catalog does not have reorder handles. Set order where Fields are attached to a type or form. Contract-scoped Fields other than User and Entity may also have an **AI prompt**; [Configure the AI connector and Field prompts](configure-analysis.md) covers that separate setup.

## Attach Fields and set requiredness

1. Open the module's **Types** tab, select **Edit** on the intended type, then select **Form**.
2. Select **Attach Field** and choose a Field from the same module. Use **Search fields** to filter the alphabetic list. **Create Field** opens a new Field definition without leaving the Form. If creation succeeds but attachment fails, use **Retry attaching** followed by the Field name.
3. Set the Row's switches. Each complete change saves immediately. Wait for **Saved** before leaving the page.
4. Use the Row's move handle to drag it, or focus the handle and use the arrow keys. Rows and Branches share one order. Title and Type stay pinned on Contract and Matter Forms.

| Switch                | Effect                                                                                                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| On intake form        | Collects the Row on every Request type that reads this destination Form, and again at creation. Turning it on for a Field also turns on Visible on Portal.                  |
| Required for creation | Requires an answer while the Row is active (at the root, or under a Branch whose condition holds), on the Intake form when included there and before the record is created. |
| Visible on Portal     | On the Field's Row for this type: lets a Business User who can reach the record read the value. It is locked on while On intake form is on. Built-in Rows have it fixed.    |

**Touchpoint** is derived from the switches and is never set separately. **Intake** means On intake form is on. **Creation** means Required for creation is on and On intake form is off. **Record** means both are off. The creation form collects Intake and Creation Rows. An optional Intake Row can be left empty; a Record Row is completed on the record.

Entity Forms show only **Required for creation**. They have Branches and Touchpoint, but no On intake form or Visible on Portal switch and no intake preview. Their native Entity columns remain on the existing create form. A User Row on intake cannot be required, because the Portal has no staff directory picker.

Visible on Portal belongs to the Row, so a Field can be visible on one type's Form and hidden on another's. **Detach** removes its Row and keeps the Field definition and stored values. **Archive** in the Field catalog hides the Field from live configuration and keeps its attachments and stored values for restoration. Use **Show archived**, then **Restore**, to recover the definition. Neither operation transfers answers to another Field. Built-in Rows cannot detach.

## Add conditional Rows with a Branch

For an NDA that collects an expiry date only for a fixed term:

1. Open the NDA type's **Form** tab. Turn on **On intake form** for **Term type** and **Expiry date**. Turn on **Required for creation** for Expiry date.
2. Select **Add condition** below the intended preceding Rows. Choose **Term type** as **Row**, **is** as **Operator**, and **Fixed** as **Value**. Choose **All** to require every condition or **Any** to accept any condition. The completed condition saves immediately.
3. Select the grip **Move Expiry date**, choose **Put under a condition…**, and choose **Show when all of: Term type is Fixed**. The Row moves under that Branch. Other Rows, including catalog Fields, can join it.
4. Select **Preview intake form**. Choose Fixed and check that Expiry date appears as required. Choose Evergreen and check that it disappears. **Submit request** tests validation here without sending a Request or uploading files.
5. Close the preview. Check the **Intake form** card on each affected Request type before sharing the change.

A condition can reference only Rows above its Branch. Keep its source on intake if the Requester must answer it. An unanswered source makes **is not** true; other operators are false. A source hidden by another Branch counts as unanswered. Ordered comparisons are available for number, money and date Rows. Money condition values use minor units, for example 5,000 for USD 50 or JPY 5,000.

Use **Edit conditions** to change the Branch. An incomplete new condition stays local; Escape discards it. A failed save offers **Retry condition change**. The Row's actions also offer **Move out**. **Remove branch** keeps its children. A move or detach that would leave a condition without a preceding source is refused beside the control.

Rows under a false Branch are not collected or required. Changing an answer can hide later Rows without erasing held answers. On a saved record, a Row with a value remains visible even when its Branch no longer holds, subject to Portal visibility and access rules.

## Maintain Officer roles

Open **Entities**, **Officer roles**. Use **Add role**, the row's **Rename** control, and its reorder handle. When archiving an in-use role, select its replacement and confirm **Archive role**. Usage and reassignment include resigned Officer entries as well as current appointments. **Other** cannot be archived. Restoring a role makes it selectable again without reversing the reassignment.

These roles describe Entity appointments; they do not grant app access. [Manage Entity records and Officers](entity-records.md) covers appointments, and [Manage your organization and users](organisation-and-users.md) covers app roles.

If a save is refused, read the error, reload the configuration, and resolve the stated usage or scope restriction. Other app roles cannot change these Administrator settings. Use the [Audit log](reminders-and-audit.md) to inspect recorded changes.
