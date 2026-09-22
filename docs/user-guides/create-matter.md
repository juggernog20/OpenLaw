# Create a Matter and use a template

Create a Matter for a piece of legal work that needs its own Matter Manager, Tasks, Key dates, and records. A Contract can stand alone or be linked to a Matter when it forms part of that broader work.

## Before you start

Use a Legal Team Member or Administrator account. Have a title, a live Matter type, and the values that type requires. An Administrator controls the available [types and Fields](types-statuses-fields.md) and [Matter templates](matter-templates.md).

If the work arrived as a Request, use [Request conversion](convert-request.md) and continue on the Matter it creates. AI preparation can offer a reviewed Conversion draft with source evidence when enabled; manual conversion remains available. The converting person becomes Matter Manager. Check for existing work before creating another Matter for the same request.

## Create the Matter

Open **Matters** and select **New matter**. Enter **Title**, choose **Matter type**, and complete the Intake and Creation Rows shown from its Form. Branches can reveal more Rows as you answer. Fill every visible Row marked required. Record Rows are completed after creation. The **Matter Manager** starts with you. Keep that selection, choose another eligible person, or clear it to **Unassigned**. Matter Managers must be active Legal Team Members or Administrators.

Choose **Department** from the shared list, or leave **No Department** selected. Review **Priority**, **Risk**, **Description**, and **Confidential**. Priority starts at **Medium** and Risk at **Not assessed** unless a template supplies defaults. Complete any Entity or person reference Fields your type offers by selecting the intended record, rather than entering an identifier.

Under **Documents**, you can attach files with **Attach documents**. Select **Create**. The new Matter opens with its M- reference. If a file upload fails after the Matter is created, the dialog stays open with **Retry failed uploads** and **Continue**. The Matter already exists. Check the saved values and its initial open-category Status. The M- reference remains the same if you rename the Matter. **Cancel** leaves the dialog without creating it.

If creation is refused, read the message, fill the named missing or invalid values, and try again. An unavailable type, template, or reference may have changed since you opened the form; reopen it and choose a live option if necessary.

## Use a template

After choosing the Matter type, check **Matter template**. Choose a template explicitly to apply its defaults, Tasks and Key dates, or leave **No template** selected to create without one.

A template can prefill the title, Priority, Risk, and attached Fields, and the dialog tells you how many Tasks and Key dates it adds. Review those values before creating. Changing or removing the template resets Priority, Risk, and every Field value to the new template's defaults, or to empty values with **No template**. Field values you typed are replaced. A title you have typed is preserved unless it still matches the previous template's title prefix.

You can clear an optional Field that the selected template prefills. It stays empty on the saved Matter. Untouched defaults and replacement values are saved as shown. Required Fields must have a value before you can create the Matter.

After creation, open **Tasks** and **Key dates** and check the instantiated content. Relative offsets are resolved from the Matter's creation date in UTC: an offset of seven days creates a date seven calendar days after that date. A Task aimed at the Matter Manager is assigned to the Manager selected at creation; without a Manager it starts unassigned. A template does not choose the Matter's Status or create a team for you.

Later template edits do not change this Matter. Manage the copied Tasks, dates, and values on the Matter itself. See [Matter work](matter-work.md) for those controls.

## Set responsibility and maintain the record

On **Overview**, edit the normal controls for the title, type, **Matter Manager**, **Business Owner**, **Department**, **Region**, Priority, Risk, Description, and **Custom fields**. Rows follow the type Form order. A Row whose Branch no longer holds remains visible when it has a stored value. Choose **Region** from the shared list, or choose **No Region**. Both owner controls let you search for a person and show their avatar. Wait for each save result. Changing type can require a **Change matter type** dialog to fill the new type's required Fields; use **Change type** to confirm. A required value cannot be cleared. Values for Fields no longer attached to the type are retained but no longer shown there.

Open **Matter team** in the activity bar. Select **Add team member**, choose **Person**, then **Add**. The roster has one membership row per person, with Matter Manager, Business Owner and Creator as separate statements. Change owners through their Overview controls. Assigning a Business Owner automatically adds them to the team. Change or clear that assignment before removing their membership; a former owner stays on the team until removed explicitly.

On a Confidential Matter, the Administrator, Matter Manager, or Creator controls the audience. Being able to read or edit other Matter details does not necessarily let you change that audience. See [roles and access](roles-and-access.md) and [Portal record work](contributor-guide.md) before adding someone.

An Entity reference Field does not grant access to that Entity. Counterparties on a linked Contract remain part of that Contract; linking it does not copy its Fields, team, or Documents onto the Matter. Use [Matter relationships](matter-work.md) to connect the records. Open **History** to inspect recorded changes.
