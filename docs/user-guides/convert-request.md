# Convert a Request to a Contract or Matter

Create work from a Request and check the values, paper, and conversation that follow it.

## Before you start

Sign in as a Legal Team Member or Administrator. [Review the undecided Request](triage-requests.md), its answers, conversation and attachments. Have a live destination Type and any required information. An Administrator controls [request forms](request-forms.md), destination Fields, [Matter templates](matter-templates.md) and the three independent [AI conversion switches](configure-analysis.md).

## Choose the destination and review the Convert dialog

1. Open the Request from **Inbox**, open **Triage**, then select **Convert to contract** or **Convert to matter**. Re-target only when the work belongs in the other module.
2. With preparation enabled for that module, wait for **Getting contract ready** or **Getting matter ready**. The Conversion draft can use eligible saved Request answers, current Full thread messages and readable attachments. Explicit conversation corrections can override earlier answers. Long documents are read in sections and their cited findings are combined. Restricted or unreadable sources can still leave gaps. Review the warnings and conflicting facts yourself.
3. Review the editable Title, Type, Description, Priority, **Needed by**, attached Fields and, for Contracts, Counterparty. Values added or changed by AI carry **Unverified**, a purple border and a sparkle. Values copied unchanged from the Request retain their ordinary appearance. Open a sparkle to read its saved explanation and supporting passages. An attachment opens above the Convert dialog, which retains your work. Close the reader to return to that value. The explanation is generated during preparation and saved with its citations; opening the sparkle makes no new model call.
4. Choose or confirm the live destination Type. Changing Type prepares its Fields again. Human edits, confirmations and explicit clears stay in place. If preparation fails, retry it or continue manually. With the module's switch off, ordinary manual conversion opens directly. You can also return to manual conversion from preparation.
5. Review answers that carry into the record and those that stay only on the Request. Complete every required Field. Replace an archived carried person or Entity with a live reference, or explicitly clear the Field if it is optional. For a Matter, choose **Matter template** or leave **No template** selected, then review its Field defaults. AI does not choose a template.
6. Select **Convert to contract** or **Convert to matter**. This decides the Request and creates one record. **Cancel** leaves the Request undecided.

Use the switch beside **Description** to compare the **AI generated** or **Current** text with the **Requester** version. The requester’s description is read-only. Switching views preserves your edits and does not replace either description. **Discard AI suggestions** in the dialog header removes untouched AI suggestions while keeping your edits.

Switching modules prepares the new destination only when its own switch is enabled. Check the Type, required answers and any template again before submitting. You cannot convert a decided Request a second time.

## Check the resulting work

Open the C- or M- reference under **Outcome**. Check the Title, Type, Priority, Description and **Needed by** Key date. Check **Fields** on a Contract or **Custom fields** on a Matter. The record receives the reviewed Description, including an explicit clear; the original Request retains its submitted answers and Description.

On the resulting record, the same **Current / Requester** switch remains available while you can access the original Request, including after AI values are confirmed or edited. Records created without a Request have no requester version.

The converting person becomes the Contract Owner or Matter Manager. A Contract also receives the Requester as its initial Business Owner. Risk remains unset. Review ownership, access and team membership before sharing the record.

Each original Request attachment becomes a separate Document at the record root with its first Version. On a Contract, the first promoted attachment becomes the primary Document if none is set. Matters have no primary Document. Comment attachments remain in the conversation until filed as Documents. Comments keep their visibility tiers and original identities. The Requester can keep the R- address, which now redirects to the record. Original attachment links follow the record's current Document access.

Conversion adds the Requester as Business Owner and team member on the new Contract or Matter. Their Portal Request address redirects to that record and the Request leaves Your requests. Original request preserves their ask. The full-app Inbox detail shows only the original envelope, who converted it, when, and a link to the record. Continue conversation and Document work on the record.

Unchanged accepted proposals remain **Unverified** on the new record. Select a sparkle to inspect the original source. Document Versions open in the same-page doc panel, which docks when space permits. Multiple citations let you choose the source. Request answers and messages show the relevant cited passages and the saved explanation, when available. Confirm a checked value or edit its normal control. These actions remain available when preparation is disabled. Changed, deleted or inaccessible evidence has an unavailable state.

## When you apply a Matter template

Template Field defaults fill values not supplied by the Request or the reviewed answers in the Convert dialog. Carried answers and dialog answers take precedence; an explicit clear keeps an optional Field empty. After changing the template, review the displayed defaults again and complete every required Field.

Conversion keeps the Title and Priority reviewed in the dialog. A template's title prefix, default Priority and default Risk do not replace them in this flow; Risk remains unset. The converting person becomes Matter Manager, so Tasks configured for **Matter Manager** are assigned to that person. Review and assign any other Tasks after creation.

The template can create Tasks and Key dates relative to the Matter's creation date in UTC, not the Request's submission date. A Task without a due offset has no due date. Check the new Matter's Tasks, assignments and Key dates, including any separate **Needed by** date. These are ordinary records that you can subsequently edit. See [Matter templates](matter-templates.md) for how an Administrator configures the defaults and checklist.

## Fill Contract Fields after conversion

The independent **Fill Contract Fields after conversion** switch starts a background Analysis run after successful Contract creation. It also works when Convert dialog preparation is off. It uses the confirmed Type's current core and prompted catalog Fields, saved Request answers, eligible conversation and readable supporting sources. The Contract's **AI analysis** card reports progress, completion, source omissions or failure. The page refreshes completed values while retaining typed drafts.

A failed Analysis run does not undo conversion. Check the Type, sources and AI settings, then select **Retry Request-context Analysis**. Existing human values, confirmations, explicit Convert dialog clears and edits made while Analysis runs are preserved. Review new Unverified values using [Contract analysis](contract-analysis.md). Ordinary manual Contract analysis remains available under its original controls.

## If conversion is refused

Read the error and complete the named Title, Type or required Fields. Replace an archived carried reference using the offered control, or explicitly clear an optional Field. Preparation cannot bypass normal creation checks.

If the dialog names an unavailable configured value but offers no way to replace it, cancel and ask an Administrator to check the destination Fields or template. If a template default is refused, choose another live template or **No template**, then answer the required Fields yourself. Review the resulting values before trying again.

If another person decided first, close the dialog and read the recorded Outcome. A losing conversion creates no second record. If the response is uncertain, reopen the original Request and check its Outcome before retrying. Do not manually create another Contract or Matter to work around a stale dialog or an uncertain response.

An answer listed as not carrying stays on the Request. Check the destination Type's Field configuration before assuming the resulting record contains it. If promoted paper or conversation appears wrong, retain the R- and C-/M- references when asking for help.

## Related guides

- [Assign and triage Requests](triage-requests.md).
- [Follow a Request and reply to Legal](follow-request.md).
- [Choose who can read a comment](comments-and-activity.md).
- [Work with Document Versions](document-versions.md).
