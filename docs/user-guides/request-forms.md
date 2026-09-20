# Configure request types and forms

Configure forms that collect the information Legal needs for a Contract or Matter, and offer useful guidance before a Business User submits a Request.

## Before you start

- Sign in as an Administrator.
- Have live destination types and the Fields you want to collect. A Field must be attached to the destination Contract or Matter type if its answer should carry into that record. See [Configure types, Statuses, and Fields](types-statuses-fields.md).
- This example uses the fictional request type **Docs Contract review**, the Contract type **MSA**, and a Contract **Deal value** Field. Use the names configured in your instance.

## Create the request type

1. Open your profile menu in the header and select **Settings**, then **Intake**, then **Request types**.
2. Select **Add request type**. Enter a display name and select **Save**. Select **Cancel** to discard the draft.
3. Select the new row's **Edit** control to open its form configuration.
4. Enter a **Description** that helps a Business User choose this form. Leave the field to save it, and check that the save succeeds.

Every submission creates a Request first. Legal chooses whether to convert it to a Contract or Matter, or resolve it in the thread. The **Default destination** column shows the suggested destination for each request type.

## Set the default destination

1. In the request type editor, choose **Default destination**: **Contract**, **Matter**, or **Decide during triage**.
2. For Contract or Matter, optionally select a **Default contract type** or **Default matter type**. Leave this as **Decide during triage** if Legal should select the type for each request.
3. Check the saved indication. Changing the destination module clears its previous type selection. An archived selection is shown as unavailable; choose a live replacement.

This supplies the initial choice during conversion. It does not automatically create a record, and Legal can choose a different destination. New request types start with **Decide during triage**.

The destination also determines which Fields can be added to the form. It does not attach Fields by itself. When you attach a Field that the default destination type does not have, the editor asks whether to attach it there too. If existing form Fields are incompatible with a new destination, the change is refused and names the Fields to detach; the saved destination and attachments remain unchanged.

The **Display name** can change. Rename or reorder request types from the list. Archiving a request type takes it out of the Portal's choices and closes its form. The archive dialog shows how many Requests use the type. If it is used, choose a live replacement before archiving; those Requests move to the replacement. Check the replacement’s Fields and routing first. Use **Show archived**, then **Restore**, to offer the type again.

## Publish an estimated turnaround

In the request type editor, set **Target turnaround (business days)** to a whole number from 0 to 36,500, or leave it blank when no estimate is published. Leave the control or press Enter to save, then check the saved indication. Zero means the submission date. Business days are Monday–Friday in the organization's timezone; weekends are skipped and public holidays are not excluded.

Check the Portal's request-type card for this duration as general guidance before submission. Share updates through the Request conversation and track work deadlines on the resulting Contract or Matter.

## Choose the form fields

1. Under **Form fields**, select **Attach field** and choose a Field, such as **Deal value**.
   Fields are listed alphabetically. Use **Search fields** at the top of the menu to filter by name.
   If the form has a default destination type that does not have this Field, the editor asks **Attach {Field} to {type} too?**. Choose **Attach to both** so the answer carries into the converted record, or **Form only**.
2. Turn on that Field's **Required** checkbox if the Requester must answer it. Wait for the save to finish.
3. Repeat for the other Fields you need. Use the reorder controls to put them in a useful order; with a reorder control focused, the arrow keys move its Field.

To create a Field while editing the form, choose **Attach field → Add new field**. Enter its name, type, description, and any other details, then select **Add field**. It is saved to the catalog and attached to this form. Contract and Matter destinations use their matching catalog; with **Decide during triage**, choose **Contract fields** or **Matter fields** in the dialog. Contract fields other than User and Entity also support an AI prompt.

Every form includes **Title**, **Description**, **Attachments**, **Department**, and **Urgency**. Drag their reorder handles, or focus a handle and use the arrow keys, to position them anywhere among the attached Fields. The Business Portal displays the saved order. These basics cannot be removed, and their required settings cannot be changed: Title, Description, and Urgency are required; Department is required when departments are available; attachments are optional. Department uses the shared list managed under **Settings → Organization → Departments** and carries into the converted record without a Field attachment.

The default destination decides which Fields **Attach field** offers. A Contract target offers Contract Fields. A Matter target offers Matter Fields. **Decide during triage** without a destination module offers Contract and Matter Fields, so you can build the questionnaire before deciding where requests will be converted. A User Field cannot be required on a Portal form, because the Portal does not offer people for the Requester to choose. An Entity Field can be required; the Portal offers only Portal-listed Entities for it. **Detach** removes a form attachment without deleting its catalog definition or earlier answers.

## Collect default contract fields

For a **Contract** destination or **Decide during triage**, the picker also offers protected questions marked **Default**: Our entity, Counterparties, Effective date, Expiry date, Term type, Renewal period (months), Notice period (days), Value amount, Value currency, and Value frequency. Attach, require, detach, and reorder these like other form questions. Their definitions cannot be renamed or archived.

These answers populate the Contract’s existing fields during conversion; they do not create custom fields on the Contract. Counterparties uses a searchable lookup with **Add new** when the name is not found. Select multiple counterparties; the first becomes primary. Remove a selection using its remove button. Existing selections keep their registry identity, and new names are added to the directory when Legal converts the request. Our entity offers only Portal-listed Entities. A renewal period requires an auto-renewing term; supplying a renewal period without a term type means auto-renewing. An evergreen term cannot have an expiry date.

To collect a complete **Value**, attach **Value amount**, **Value currency**, and **Value frequency**. Enter the amount in full currency units, such as 1500.50. All three must be answered for the value to populate the Contract; partial answers remain on the Request. The conversion dialog identifies answers that carry and those that remain on the Request.

If Legal converts the Request into a Matter, these contract-specific answers remain on the Request. Submitted default answers remain readable even if the question is later detached. Internal fields such as Reference, Status, and Legal Owner are not intake questions.

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

Attaching a Field to the form does not attach it to the destination type on its own. When the form has a default destination type and that type lacks the Field, the editor asks **Attach {Field} to {type} too?** Choose **Attach to both** to put the Field on the form and on the destination type in one step, or **Form only** to leave the destination type as it is. A Field marked **Default** is never asked about, because it carries on its own. Check both configurations before relying on carry-through for Fields attached earlier. For a Matter, also check any selected [Matter template](matter-templates.md): carried answers and explicit choices take precedence over its defaults, and its Tasks and Key dates use the new Matter's creation date.

## If it does not work

If the form is missing from the Portal, check that its request type is active. If a save reports an error, correct it and check the saved value before sharing the form.

If an answer appears under **Does not carry into the contract**, or **Does not carry into the matter**, during conversion, check whether the Field is attached to the selected destination type. That answer remains on the Request. Review any missing required destination Fields before confirming conversion.

If a configured destination type is archived, select a live type during conversion. Guidance that disappears may have an unpublished, archived, or unavailable Knowledge Item, or a placement on a different form. Test the Business User view after correcting it.

## Related guides

- [Submit a Request to Legal](submit-request.md).
- [Convert a Request to a Contract or Matter](convert-request.md).
