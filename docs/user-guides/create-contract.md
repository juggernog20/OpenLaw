# Create and maintain a Contract

Create a Contract, record the parties, and give its Legal Owner and team the information they need.

## Before you start

Sign in as a Legal Team Member or Administrator with access to the intended work. Have a Contract type, its required information, and the names of our Entity and the Counterparties. An Entity is one of our own corporate entities; a Counterparty is on the other side of the deal. If the work began as a Request, follow [Convert a Request to a Contract or Matter](convert-request.md).

## Create the record

1. Open **Contracts** and select **Create contract**.
2. Enter **Title** and select **Contract type**. The Default type is selected first.
3. Check **Legal Owner**. It starts on you. Choose another Legal Team Member or Administrator, or choose **Unassigned**.
4. If the Contract belongs to broader Matter work, search in **Matter** by number or title and select the intended Matter. Leave it blank for a standalone Contract. A link does not copy access or other record details.
5. Complete the Intake and Creation Rows that the type's Form shows. They can include built-in Rows such as **Entity** and **Counterparties**, and the type's Fields. A Branch may reveal more Rows as you answer. A required Row needs an answer. A Row under a Branch whose condition does not hold is not asked and not required. Record Rows are completed after creation.
6. Turn on **Confidential — restrict to the contract team** before creating sensitive work.
7. Optionally, select **Attach documents** under **Documents**. When you add files, you can choose a **Document type** for them.
8. Select **Create**. The app opens the new Contract. Check its title, type, Legal Owner, and new C- reference. **Cancel** creates nothing.

The new Contract starts in the configured system Draft Status. The **Legal Owner** you chose is its Legal Owner. You are on its team as Creator. Default people set for the Contract type also join the team. Add the remaining details on the record. The C- reference stays the same when you rename or change its type.

The dialog uploads attached files after the Contract exists. If a file fails, the dialog shows **Record created. Some documents could not be uploaded.** The Contract is already created. Select **Retry failed uploads**, or select **Continue** to open the Contract and add the file there.

## Record the parties and ownership

On **Overview**, the **Contract** card shows the built-in Rows of the type's Form, in Form order. **Title** and **Contract type** come first. The other Rows can include **Description**, **Our entity**, **Counterparties**, **Department**, **Region**, **Priority**, **Risk**, the term Rows, **Value**, and **Needed by**. A Row under a Branch whose condition does not hold appears only while it holds a value. **Legal Owner**, **Business Owner**, **Days remaining**, **Last renewal**, and the Confidential switch follow the Rows. The Fields attached to the type are on **Fields**, not here.

Choose **Legal Owner** from the active Legal Team Members and Administrators. Choose **Business Owner** from any active person. **Unassigned** clears either owner. On a Confidential Contract, only an Administrator, the Contract's creator, or its Legal Owner can change the Legal Owner or name a Business Owner.

In **Our entity**, choose the Entity that is party to this Contract. **Not known yet** leaves our Entity unset. Choose **Department** and **Region** from the shared lists. A choice saves immediately. **No Department** and **No Region** clear them. An Administrator manages the Region list in **Settings** > **Regions**. Record **Priority**, **Risk**, and **Description** as needed. **Description** saves when you leave it; clearing it removes the text. In **Value**, enter the **Amount**, choose **Currency**, and check **Frequency**. If you choose **Other**, enter the **Custom cadence**. Leave the Value group or press Enter to save these parts together. Emptying the amount removes the value.

Under **Counterparties**, search and select each party. If a name is new, the list offers **Create "name"** with the typed name. Check the name before you select it. The first linked Counterparty is primary; use **Make primary** to change that designation. Removing a Counterparty from this Contract removes its link, not the Counterparty record.

Open **Contract team** in the activity bar and select **Add team member**. Choose **Person**, then **Add**. The roster has one membership row per person. Legal Owner, Business Owner and Creator appear as separate statements. Assigning a Business Owner automatically adds them to the team. Their membership row has no remove control while they are Business Owner. Change or clear that assignment before removing their membership; a former owner stays on the team until removed explicitly. Creator remains historical. A Business User on the team can work through the Portal. See [roles and record access](roles-and-access.md).

## Maintain the values

Select **Fields** for the Fields attached to this type. Fill the business information your team needs. Text values save when you leave the input or press Enter; choices save when selected. Wait for the save result before another change. Escape abandons an unsaved text edit. A long-text input uses Enter for a new line.

On **Overview**, changing **Contract type** may open **Change contract type** to request missing required Fields. Fill them and select **Change type**, or cancel. Check the new type and displayed Fields afterwards. [Manage Contract terms and renewals](terms-and-renewals.md) covers dates and value-related context; [Document Versions](document-versions.md) covers the paper.

## If a change is refused

Read the error next to the field or in the dialog. The create dialog creates nothing while it shows an error. A blank title shows **Name the contract.** A missing type shows **Pick a contract type.** A blank required Row shows an error that names it. Blank required answers also prevent re-typing. Archived Contract types are not offered. Choose a live available reference when an old one is archived. Reload the record to check what was saved before retrying an uncertain result.

An archived Contract must be restored before editing. If legal details are read-only, check your role and access. In the Portal, a Business User cannot create a Contract directly or assign its Legal Owner. A Generation of an Auto-Doc that targets a Contract type can create a Contract.

## Related guides

- [Change a Contract Status](contract-stages.md).
- [Manage Contract Tasks and Key dates](contract-tasks-and-dates.md).
- [Relate, end, and archive Contracts](contract-relations-and-ending.md).
