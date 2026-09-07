# Convert a Request to a Contract or Matter

Create work from a Request and check the values, paper, and conversation that follow it.

## Before you start

Sign in as a Legal Team Member or Administrator. [Review the undecided Request](triage-requests.md) and its attachments first. Have a live destination type and any required information the Portal form did not collect. An Administrator configures [request forms](request-forms.md), destination Fields, and optional [Matter templates](matter-templates.md).

## Choose the destination and complete the form

1. Open the Request from **Inbox**. Check **Converts to**, then open **Triage** and select the matching **Convert to contract** or **Convert to matter** action. Select the other action only to re-target a mis-routed Request.
2. Check **Title**, which starts with the Request's Summary, and edit it if needed. Check **Priority**, taken from the Request's Urgency. Change Priority on the resulting record if needed; this dialog does not edit it.
3. Check **Contract type** or **Matter type**. A live type configured for that module is fixed here. If the form left the type open, its configured type was archived, or you chose the other module, choose a live type now.
4. For a Matter, check **Template (optional)** if templates are available. Use **No template** to create without one, or select the intended template and review its Task and Key date counts. A type with one template can select it automatically, so check this control before confirming.
5. Review **Carries into the contract** or **Carries into the matter**. Collected answers carry where the destination type has the corresponding Fields. Review **Does not carry into the contract** or **Does not carry into the matter** for answers that remain on the Request only.
6. Complete the required Fields the form did not collect. If a carried person or Entity is marked archived, choose the live replacement requested by the dialog. Carried answers are otherwise shown for review; optional record Fields can be completed after conversion.
7. Select **Convert to contract** or **Convert to matter** to confirm. This decides the Request and creates one record. **Cancel** leaves the Request undecided.

To change modules before confirming, select **Convert to matter instead** or **Convert to contract instead** and review the new destination and required answers. Choosing the other module keeps the original Request. It does not first create work in the configured module, and it does not let you convert an already decided Request a second time.

## Check the resulting work

Open the C- or M- reference under **Outcome**. Check the Title, type, and Priority. On a Contract, select **Fields** to check the carried and completed answers. On a Matter, read **Custom fields** on **Overview**. The original Request retains its submitted answers. Its Description is not copied into the new Contract's or Matter's Description.

The new work needs its own ownership and risk choices. The person assigned during triage does not become the Contract Owner or Matter Manager, and the new record has no Risk set. Review the record's access and team before sharing its address.

Select **Documents**. Each original Request attachment becomes a separate Document at the record root with its first Version. On a Contract, the first promoted attachment becomes the primary Document if none is set. Matters have no primary Document designation. Comment attachments remain in the conversation rather than automatically becoming Documents.

Open **Comments** and check the retained conversation. Its visibility tiers still apply. The Requester keeps the same R- address in the Portal, sees **In progress**, and can read and reply in the Full thread. They retain the original Request attachment downloads, including after Legal uploads later Document Versions. Conversion does not grant a Business User access to the Contract or Matter page.

## When you apply a Matter template

Template Field defaults fill values not supplied by the Request or your answers in the dialog. A carried answer or an answer you enter takes precedence. Changing templates should prompt a fresh review of the displayed defaults and counts before confirming.

Conversion keeps the Title you confirmed and the Request's Urgency as Priority; a template's title prefix, default Priority, and default Risk do not replace them in this flow. Risk remains unset. The template can create Tasks and Key dates relative to the Matter's creation date. Check those dates on the new Matter. Tasks configured for the Matter Manager start unassigned because conversion does not set a Matter Manager; assign the work explicitly.

## If conversion is refused

Complete any marked Title, type, or required Field. Replace an archived carried reference using the offered control, even if that Field is optional on the destination type.

If the dialog names an unavailable configured value but offers no way to replace it, cancel and ask an Administrator to check the destination Fields or template. For an unavailable template, reopen the dialog and choose a live template or **No template**. Confirm that the chosen configuration meets all required Fields before trying again.

If someone else decided first, close the dialog and read their recorded outcome. A losing conversion creates no second record. If the response is uncertain, reopen the original Request before retrying instead of manually creating another Contract or Matter.

An answer listed as not carrying stays on the Request. Check the destination type's Field configuration before assuming that the resulting record contains it. If promoted paper or conversation appears wrong, retain the R- and C-/M- references when asking for help.

## Related guides

- [Assign and triage Requests](triage-requests.md).
- [Follow a Request and reply to Legal](follow-request.md).
- [Choose who can read a comment](comments-and-activity.md).
- [Work with Document Versions](document-versions.md).
