# Configure request types and forms

Configure forms that collect the information Legal needs for a Contract or Matter, and offer useful guidance before a Business User submits a Request.

## Before you start

- Sign in as an Administrator.
- Have live destination types and the Fields you want to collect. A Field must be attached to the destination Contract or Matter type if its answer should carry into that record. See [Configure types, Statuses, and Fields](types-statuses-fields.md).
- This example uses the fictional request type **Docs Contract review**, the Contract type **MSA**, and its **Owning department** Field. Use the names configured in your instance.

## Create the request type

1. Open your profile menu in the header and select **Settings**, then **Intake**, then **Request types**.
2. Select **Add request type**. Enter a display name and press Enter.
3. Select the new row's **Edit** control to open its form configuration.
4. Enter a **Description** that helps a Business User choose this form. Leave the field to save it, and check that the save succeeds.
5. In **Target**, choose the intended type under **Contract**, such as **MSA**. Check the explanation below the control: it should say that conversion creates a Contract of that type. Changes save as you make them.

Choose **Matter** and a specific Matter type for a Matter form. Choose **Contract** or **Matter** without a specific type when Legal should select that module's type at conversion; the explanation then says that the reviewer picks the type. **No target** is for work Legal answers in the thread. Its explanation says that conversion creates no record, and Triage resolves such a Request without converting it. Converting one anyway is a deliberate re-target, and the Request is kept. A **No target** form offers only Global Fields for new attachments. Every submission creates a Request first; the target does not create a Contract or Matter automatically.

The **Display name** can change; **Slug** stays fixed. Rename or reorder request types from the list. Archiving a request type takes it out of the Portal's choices and closes its form. In this version the archive dialog reports no usage and offers no replacement, even when Requests still name the type. Those Requests keep that type and stay readable, so check what is still open before you archive. Use **Show archived**, then **Restore**, to offer the type again.

## Choose the form fields

1. Under **Form fields**, select **Attach field** and choose a Field, such as **Owning department**.
2. Turn on that Field's **Required** checkbox if the Requester must answer it. Wait for the save to finish.
3. Repeat for the other Fields you need. Use the reorder controls to put them in a useful order; with a reorder control focused, the arrow keys move its Field.

Plan the form around its fixed basics: **Summary**, **Description**, **Attachments**, and **Urgency**. Summary, Description, and Urgency are required; attachments are optional. These basics cannot be removed or reordered here.

Choose Contract-scoped or Global Fields for a Contract form, and Matter-scoped or Global Fields for a Matter form. User and Entity Fields cannot be required on a Portal form, because the Portal does not offer those records for the Requester to choose. **Detach** removes a form attachment without deleting its catalog definition or earlier answers.

Changing the target changes which Fields can be attached. If an existing attachment conflicts with the new target, resolve the reported conflict before retrying; do not assume changing the target converted earlier Requests or moved their answers.

## Offer guidance before submission

1. Open **Settings**, **Intake**, **Deflection links**, then select **Add link**.
2. Choose **Target**. For **External address**, enter a full **Address** beginning with `https://` or `http://`. For **Knowledge item**, choose an eligible published Knowledge Item.
3. Enter **Label** as a useful description of the answer or guidance.
4. Choose **Placement**: **Portal home**, or the particular request type whose form needs this guidance. Select **Add link**.
5. Open the Portal as a Business User and check **Before you submit** on the chosen destination. Follow the link and confirm the intended guidance is accessible.

Use **Edit** to change a link and its placement. Reorder links with their handles. **Remove** deletes the link immediately; there is no archive or restore for links. It does not delete the Knowledge Item or external page.

Knowledge guidance must remain published and available to Business Users. See [Publish Knowledge for colleagues and the Portal](publish-knowledge.md). An external link opens another site; its availability and access requirements are separate from OpenLaw.

## Check the result

Test one Contract form and one Matter form. Open the Portal and select the request type. Confirm that the description, guidance, Fields, order, and required markers match your configuration. Try submitting with a required answer missing, then supply valid fictional answers and submit. Have a Legal Team Member or Administrator convert the Request and check each intended answer on the new record.

Attaching a Field to the form does not attach it to the destination type. Check both configurations before relying on carry-through. For a Matter, also check any selected [Matter template](matter-templates.md): carried answers and explicit choices take precedence over its defaults, and its Tasks and Key dates use the new Matter's creation date.

## If it does not work

If the form is missing from the Portal, check that its request type is active. If the target is marked archived, choose a live target and test the form again. If a save reports an error, correct it and check the saved value before sharing the form.

If an answer appears under **Does not carry into the contract**, or **Does not carry into the matter**, during conversion, check whether the Field is attached to the selected destination type. That answer remains on the Request. Review any missing required destination Fields before confirming conversion.

An archived configured target needs a deliberate live choice; do not rely on a silent switch to another module. Correct the target in Settings and reload the form. Guidance that disappears may have an unpublished, archived, or unavailable Knowledge Item, or a placement on a different form. Test the Business User view after correcting it.

## Related guides

- [Submit a Request to Legal](submit-request.md).
- [Convert a Request to a Contract or Matter](convert-request.md).
