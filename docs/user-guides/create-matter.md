# Create a Matter and use a template

Create a Matter for a piece of legal work that needs its own Matter Manager, Tasks, Key dates, and records. A Contract can stand alone or be linked to a Matter when it forms part of that broader work.

## Before you start

Use a Legal Team Member or Administrator account. Have a title, a live Matter type, and the values that type requires. An Administrator controls the available [types and Fields](types-statuses-fields.md) and [Matter templates](matter-templates.md).

If the work arrived as a Request, use [Request conversion](convert-request.md) and continue on the Matter it creates. Check for existing work before creating another Matter for the same request.

## Create the Matter

Open **Matters** and select **New matter**. Enter **Title**, choose **Matter type**, and fill every Field marked required. Choose a **Matter Manager** or leave **Unassigned** until someone takes responsibility. Matter Managers must be active Legal Team Members or Administrators.

Review **Priority**, **Risk**, **Description**, and **Confidential**. Priority starts at **Medium** and Risk at **Not assessed** unless a template supplies defaults. Complete any Entity or person reference Fields your type offers by selecting the intended record, rather than entering an identifier.

Select **Create**. The new Matter opens with its M- reference. Check the saved values and its initial open-category Status. The M- reference remains the same if you rename the Matter. **Cancel** leaves the dialog without creating it.

If creation is refused, read the message, fill the named missing or invalid values, and try again. An unavailable type, template, or reference may have changed since you opened the form; reopen it and choose a live option if necessary.

## Use a template

After choosing the Matter type, check **Template (optional)**. A type with one available template selects it automatically. With several templates, choose the one that fits; choose **No template** to create without one.

A template can prefill the title, Priority, Risk, and attached Fields, and the dialog tells you how many Tasks and Key dates it adds. Review those values before creating. Changing or removing the template resets its Priority, Risk, and Field defaults; a title you have typed is preserved unless it still matches the previous template's title prefix.

You can clear an optional Field that the selected template prefills. It stays empty on the saved Matter. Untouched defaults and replacement values are saved as shown. Required Fields must have a value before you can create the Matter.

After creation, open **Tasks** and **Key dates** and check the instantiated content. Relative offsets are resolved from the Matter's creation date in UTC: an offset of seven days creates a date seven calendar days after that date. A Task aimed at the Matter Manager is assigned to the Manager selected at creation; without a Manager it starts unassigned. A template does not choose the Matter's Status or create a team for you.

Later template edits do not change this Matter. Manage the copied Tasks, dates, and values on the Matter itself. See [Matter work](matter-work.md) for those controls.

## Set responsibility and maintain the record

On **Overview**, edit the normal controls for the title, type, **Matter Manager**, Priority, Risk, Description, and **Custom fields**. Wait for each save result. Changing type can require a **Change matter type** dialog to fill the new type's required Fields; use **Change type** to confirm. A required value cannot be cleared. Values for Fields no longer attached to the type are retained but no longer shown there.

On Overview, find **Matter team** and use **Add team member**, choose the person and their role, then **Add to team**. The roster groups each person's roles. Removing one removable role leaves their other roles intact; Creator and Matter Manager are shown as responsibility labels. Changing the Manager is separate from adding or removing team roles.

On a Confidential Matter, the Administrator, Matter Manager, or Creator controls the audience. Being able to read or edit other Matter details does not necessarily let you change that audience. See [roles and access](roles-and-access.md) and [Contributor work](contributor-guide.md) before adding someone.

An Entity reference Field does not grant access to that Entity. Counterparties on a linked Contract remain part of that Contract; linking it does not copy its Fields, team, or Documents onto the Matter. Use [Matter relationships](matter-work.md) to connect the records. Open **History** to inspect recorded changes.
