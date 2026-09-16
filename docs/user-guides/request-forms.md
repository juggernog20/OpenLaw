# Configure request types and forms

Configure forms that collect the information Legal needs for a Contract or Matter, and offer useful guidance before a Business User submits a Request.

## Before you start

- Sign in as an Administrator.
- Have live destination types and the Fields you want to collect. A Field must be attached to the destination Contract or Matter type if its answer should carry into that record. See [Configure types, Statuses, and Fields](types-statuses-fields.md).
- This example uses the fictional request type **Docs Contract review**, the Contract type **MSA**, and a Global **Deal value** Field. Use the names configured in your instance.

## Create the request type

1. Open your profile menu in the header and select **Settings**, then **Intake**, then **Request types**.
2. Select **Add request type**. Enter a display name and select **Save**. Select **Cancel** to discard the draft.
3. Select the new row's **Edit** control to open its form configuration.
4. Enter a **Description** that helps a Business User choose this form. Leave the field to save it, and check that the save succeeds.

Every submission creates a Request first. Legal chooses whether to convert it to a Contract or Matter, or resolve it in the thread. The **Target** column on the list shows each request type's routing default: a Contract or Matter type, a module alone, or **No target**. That default guides conversion and which Fields the form can attach. The form editor has no control to set or change it. A request type that you add here shows **No target**, so Legal chooses the Contract or Matter type at conversion.

The **Display name** can change. Rename or reorder request types from the list. Archiving a request type takes it out of the Portal's choices and closes its form. In this version the archive dialog reports no usage and offers no replacement, even when Requests still name the type. Those Requests keep that type and stay readable, so check what is still open before you archive. Use **Show archived**, then **Restore**, to offer the type again.

## Publish an estimated turnaround

In the request type editor, set **Target turnaround (business days)** to a whole number from 0 to 36,500, or leave it blank when no estimate is published. Leave the control or press Enter to save, then check the saved indication. Zero means the submission date. Business days are Monday–Friday in the organization's timezone; weekends are skipped and public holidays are not excluded.

Check the Portal's request-type card for this duration as general guidance before submission. Share updates through the Request conversation and track work deadlines on the resulting Contract or Matter.

## Choose the form fields

1. Under **Form fields**, select **Attach field** and choose a Field, such as **Deal value**.
2. Turn on that Field's **Required** checkbox if the Requester must answer it. Wait for the save to finish.
3. Repeat for the other Fields you need. Use the reorder controls to put them in a useful order; with a reorder control focused, the arrow keys move its Field.

Plan the form around its fixed basics: **Title**, **Description**, **Attachments**, **Department**, and **Urgency**. Title, Description, Department, and Urgency are required; attachments are optional. Department uses the shared list managed under **Settings → Organization → Departments** and carries into the converted record without a Field attachment. These basics cannot be removed or reordered here.

The Target decides which Fields **Attach field** offers. A Contract target offers Contract-scoped and Global Fields. A Matter target offers Matter-scoped and Global Fields. **No target** offers only Global Fields. A User Field cannot be required on a Portal form, because the Portal does not offer people for the Requester to choose. An Entity Field can be required; the Portal offers only Portal-listed Entities for it. **Detach** removes a form attachment without deleting its catalog definition or earlier answers.

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

Attaching a Field to the form does not attach it to the destination type. Check both configurations before relying on carry-through. For a Matter, also check any selected [Matter template](matter-templates.md): carried answers and explicit choices take precedence over its defaults, and its Tasks and Key dates use the new Matter's creation date.

## If it does not work

If the form is missing from the Portal, check that its request type is active. If a save reports an error, correct it and check the saved value before sharing the form.

If an answer appears under **Does not carry into the contract**, or **Does not carry into the matter**, during conversion, check whether the Field is attached to the selected destination type. That answer remains on the Request. Review any missing required destination Fields before confirming conversion.

If a configured destination type is archived, select a live type during conversion. Guidance that disappears may have an unpublished, archived, or unavailable Knowledge Item, or a placement on a different form. Test the Business User view after correcting it.

## Related guides

- [Submit a Request to Legal](submit-request.md).
- [Convert a Request to a Contract or Matter](convert-request.md).
