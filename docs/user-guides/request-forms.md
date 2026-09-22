# Configure request types and forms

Configure forms that collect the information Legal needs for a Contract or Matter, and offer useful guidance before a Business User submits a Request.

## Before you start

- Sign in as an Administrator.
- Have a live destination Contract or Matter type. Its Form holds the Rows you want to collect. See [Configure types, Statuses, and Fields](types-statuses-fields.md).
- This example uses the fictional request type **Docs Contract review**, the Contract type **MSA**, and a Contract **Deal value** Field. Use the names configured in your instance.

## Create the request type

1. Open your profile menu in the header and select **Settings**, then **Intake**, then **Request types**.
2. Select **Add request type**. Enter a display name and select **Save**. Select **Cancel** to discard the draft.
3. Select the new row's **Edit** control to open its form configuration.
4. Enter a **Description** that helps a Business User choose this form. Leave the field to save it, and check that the save succeeds.

Every submission creates a Request first. Legal chooses whether to convert it to a Contract or Matter, or resolve it in the thread. The **Destination** column shows the suggested destination for each request type.

## Set the default destination

1. In the request type editor, choose **Default destination**: **Contract** or **Matter**. A module is required.
2. For Contract or Matter, optionally select a **Default contract type** or **Default matter type**. Leave this as **Default** to use the module's Default type Form.
3. Check the saved indication. Changing the destination module clears its previous type selection. An archived selection is shown as unavailable; choose a live replacement.

This supplies the initial choice during conversion. It does not automatically create a record, and Legal can choose a different destination. New request types start with a Matter destination.

The **Intake form** card reads the destination type's Form. Changing the destination refreshes the card. Several Request types can use one Form while keeping their own display names, descriptions, and turnaround. A renamed Default type appears under its current name in the card and its edit link.

The **Display name** can change. Rename or reorder request types from the list. Archiving a request type takes it out of the Portal's choices and closes its form. The archive dialog shows how many Requests use the type. If it is used, choose a live replacement before archiving; those Requests move to the replacement. Check the replacement’s Fields and routing first. Use **Show archived**, then **Restore**, to offer the type again.

## Publish an estimated turnaround

In the request type editor, set **Target turnaround (business days)** to a whole number from 0 to 36,500, or leave it blank when no estimate is published. Leave the control or press Enter to save, then check the saved indication. Zero means the submission date. Business days are Monday–Friday in the organization's timezone; weekends are skipped and public holidays are not excluded.

Check the Portal's request-type card for this duration as general guidance before submission. Share updates through the Request conversation and track work deadlines on the resulting Contract or Matter.

## Read and preview the Intake form

The **Intake form** card is read-only. It lists **Title**, **Department**, and **Urgency** first, the destination type's Intake Rows in order, and **Attachments** last. Each Row says **Required** or **Optional**. Branch headers describe the conditions for their children. The card shows those children so you can inspect the whole configuration before answering anything.

1. Select the eye button, **Preview intake form**.
2. Check the Request type's display name and description in the preview.
3. Answer a Row used by a Branch condition. Check that its child Rows appear when the condition holds and disappear when it no longer holds.
4. Select **Submit request** to try validation. This preview sends no Request and uploads no files.
5. Close the dialog or press Escape to return to the eye button. Preview answers are discarded.

## Choose the Intake Rows

1. Select **Edit on MSA**, or the destination type's current name, at the bottom of the card. This opens its **Form** tab. A module-only destination links to its Default type.
2. Configure the Rows and Branches there. See [the switches, Touchpoint and Branch example](types-statuses-fields.md#attach-fields-and-set-requiredness). Turn on **On intake form** for Rows that a Requester should answer. For a Field, this also turns on **Visible on Portal**, which stays locked on until On intake form is off. Use **Required for creation** for a required answer.
3. Return to the Request type editor and check its **Intake form** card and preview.

The Request type has no separate attach menu, Required checkbox, or Row order. Edits to the destination Form affect every Request type that reads it. A User Row on intake cannot be required because the Portal has no staff directory picker. Entity Rows use the Portal-listed Entities.

Title, Department, and Urgency are fixed basics. Attachments are optional and fixed last. Description is an ordinary built-in Row on the destination Form. Department uses the shared list managed under **Settings → Organization → Departments**.

## Collect built-in Contract Rows

The Contract type's Form includes built-in Rows such as **Counterparties**, **Effective date**, **Expiry date**, **Term type**, and **Value**. Turn on **On intake form** on the Rows needed for this Request type. They collect native record values without a separate catalog Field.

**Value** is one Row with amount, currency, and cadence controls. **Counterparties** uses the registry picker. These Rows share the same Branch and required settings as other Form Rows. Internal values such as Status and Legal Owner are not intake questions.

## Offer guidance before submission

1. Open **Settings**, **Intake**, **Deflection links**, then select **Add link**.
2. Choose **Target**. For **External address**, enter a full **Address** beginning with `https://` or `http://`. For **Knowledge item**, choose an eligible published Knowledge Item.
3. Enter **Label** as a useful description of the answer or guidance.
4. Choose **Placement**: **Portal home**, or the particular request type whose form needs this guidance. Select **Add link**.
5. Open the Portal as a Business User and check **Before you submit** on the chosen destination. Follow the link and confirm the intended guidance is accessible.

Use **Edit** to change a link and its placement. Reorder links with their handles. **Remove** deletes the link immediately; there is no archive or restore for links. It does not delete the Knowledge Item or external page.

Knowledge guidance must remain published and available to Business Users. See [Publish Knowledge for colleagues and the Portal](publish-knowledge.md). An external link opens another site; its availability and access requirements are separate from OpenLaw.

## Check the result

Test one form that Legal converts to a Contract and one that Legal converts to a Matter. Open the Portal and select the request type. Confirm that the description, guidance, Fields, order, and required markers match your configuration. Try submitting with a required answer missing, then supply valid fictional answers and submit. Have a Legal Team Member or Administrator convert the Request and check each intended answer on the new record.

The Intake Rows already belong to the destination type's Form. If Legal changes the destination during conversion, check that the new type has the Rows needed to receive the answers. For a Matter, also check any selected [Matter template](matter-templates.md): carried answers and explicit choices take precedence over its defaults, and its Tasks and Key dates use the new Matter's creation date.

## If it does not work

If the form is missing from the Portal, check that its request type is active. If a save reports an error, correct it and check the saved value before sharing the form.

If an answer appears under **Does not carry into the contract**, or **Does not carry into the matter**, during conversion, check whether the Field is attached to the selected destination type. That answer remains on the Request. Review any missing required destination Fields before confirming conversion.

If the Intake form card cannot be read, use **Retry**. If the destination type is archived or unavailable, choose a live destination in the Request type editor. Guidance that disappears may have an unpublished, archived, or unavailable Knowledge Item, or a placement on a different form. Test the Business User view after correcting it.

## Related guides

- [Submit a Request to Legal](submit-request.md).
- [Convert a Request to a Contract or Matter](convert-request.md).
