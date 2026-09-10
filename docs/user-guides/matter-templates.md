# Configure Matter templates

Prepare reusable defaults, Tasks, and Key dates for new Matters. Sign in as an Administrator and have a live Matter type with the Fields the template should fill.

## Create and edit a template

1. Open your profile menu, select **Settings**, then **Matters**, **Templates**.
2. Choose **Matter type**, then **Add template**. Enter **Name** and an optional **Description**, then select **Add template**.
3. Open the template's **Edit** link. Under **Matter defaults**, choose **Priority**, **Risk**, and an optional **Title prefix**.
4. Under **Custom field defaults**, enter the values to suggest for this type's Fields.
5. Under **Tasks**, select **Add task**. Enter its title and, if needed, its due offset in days. Choose **Matter Manager** to assign it to the new Matter's manager, or **Unassigned**. Repeat and reorder the checklist as needed.
6. Under **Key dates**, select **Add key date**. Enter its label, offset in days, and optional note. Repeat and reorder as needed.
7. Select **Save template**. Wait for success, reopen the template, and confirm all four areas: details, Field defaults, Tasks, and Key dates.

Offsets are whole numbers from 0 to 3650. A Task with no due offset has no due date; a Key date needs an offset. Zero means the new Matter's creation date. Both direct creation and Request conversion calculate dates from the Matter's creation date in UTC, not the Request submission date or the viewer's local date. For example, a Matter created on September 8, 2026, with a two-day offset gets September 10, 2026.

A Task targeting **Matter Manager** remains unassigned if the new Matter has no manager. These defaults create ordinary Tasks and Key dates that the team can subsequently edit.

## Test both creation paths

First follow [Create a Matter](create-matter.md): choose the template's Matter type, select its template, inspect the suggested title, Priority, Risk, and Fields, and choose a Matter Manager. Create a fictional Matter. Check its Overview, Tasks, Task assignments, and Key dates.

Next configure a Matter-targeting [Request form](request-forms.md), submit a fictional Request, and follow [Convert a Request to a Contract or Matter](convert-request.md). Confirm the configured Matter type, or choose a type if the form left it to Legal, then select the template. Review carried answers and suggested defaults before confirming. Check the created Matter and its relative dates; conversion does not reuse the Request's age as the date anchor.

Conversion starts the title from the Request's Summary and Priority from its Urgency. It leaves Risk and Matter Manager unset, even when the template has a Risk default. A Manager-targeted Task is therefore unassigned after conversion. The template's title prefix and Priority do not replace the Request's title and Urgency. Set the Manager, Risk, and Task assignments on the created Matter when needed.

Values explicitly supplied at creation take precedence over template defaults. Clearing an optional Field in the creation dialog keeps it empty on the saved Matter. Untouched defaults still apply. Required Fields must have a value before creation.

## Change or archive a template

Edit and save the template to change future creations. Existing Matters, Tasks, Task assignments, and Key dates keep their own values. Test a new Matter after the change and compare it with one created earlier.

To archive the template, select its **Archive** control and confirm **Archive template**. Archiving removes it from new creation choices; existing Matters remain unchanged. Use **Show archived** and **Restore** to recover its saved definition. A template whose Matter type is unavailable cannot be used to create new work; choose a live type and matching template.

If a Field was detached from the template's type, the editor identifies its retained saved value. Reattach the Field to the type if that default should be available for new Matters again.

## Recover a failed save

The editor can save an earlier section before a later section fails. Read the error, reload, and inspect details, Field defaults, Tasks, and Key dates before retrying. Correct missing row names or invalid offsets. Do not assume that an error rolled back every change, or create another template just because the last section failed.
