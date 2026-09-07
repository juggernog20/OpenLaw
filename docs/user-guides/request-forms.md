# Configure request types and forms

Configure a form that collects the information Legal needs and targets a Contract type.

## Before you start

- Sign in as an Administrator.
- Have a live Contract type and the Fields you want to collect. A Field must be attached to the destination Contract type if its answer should carry into that Contract.
- This example uses the fictional request type **Docs Contract review**, the Contract type **MSA**, and its **Owning department** Field. Use the names configured in your instance.

## Create the request type

1. Open your profile menu in the header and select **Settings**, then **Intake**, then **Request types**.
2. Select **Add request type**. Enter a display name and press Enter.
3. Select the new row's **Edit** control to open its form configuration.
4. Enter a **Description** that helps a Business User choose this form. Leave the field to save it, and check that the save succeeds.
5. In **Target**, choose the intended type under **Contract**, such as **MSA**. Check the explanation below the control: it should say that conversion creates a Contract of that type. Changes save as you make them.

Choose **Contract** without a specific type when Legal should select the Contract type at conversion. Expect submission to create a Request first; Legal creates the Contract when they convert it.

## Choose the form fields

1. Under **Form fields**, select **Attach field** and choose a Field, such as **Owning department**.
2. Turn on that Field's **Required** checkbox if the Requester must answer it. Wait for the save to finish.
3. Repeat for the other Fields you need. Use the reorder controls to put them in a useful order; with a reorder control focused, the arrow keys move its Field.

Plan the form around its fixed basics: **Summary**, **Description**, **Attachments**, and **Urgency**. Summary, Description, and Urgency are required; attachments are optional. These basics cannot be removed or reordered here.

Choose Contract-scoped or global Fields for a Contract form. Keep User and Entity Fields optional on a Portal form, because the Portal does not offer those records for the Requester to choose.

## Check the result

Open the Portal and select the request type. Confirm that the description, Fields, order, and required markers match your configuration. Submit a fictional Request, then have a Legal Team Member convert it and check that each intended answer reached the Contract.

Attaching a Field to the form does not attach it to the destination Contract type. Check both configurations before relying on carry-through.

## If it does not work

If the form is missing from the Portal, check that its request type is active. If the target is marked archived, choose a live target and test the form again. If a save reports an error, correct it and check the saved value before sharing the form.

If an answer appears under **Does not carry into the contract** during conversion, check whether the Field is attached to the selected Contract type. That answer remains on the Request; it is not silently discarded.

## Related guides

- [Submit a Request to Legal](submit-request.md).
- [Convert a Request to a Contract](convert-request.md).
