# Manage Matter Tasks, Key dates, and relationships

Keep internal to-dos in **Tasks**, named deadlines in **Key dates**, and connections to other records in the Matter's relationship sections. Each serves a different purpose.

## Before you start

Use a Legal Team Member or Administrator account that can read the Matter. The Matter must be unarchived to change this work. A closed Matter stays editable. Contributors can read these sections but cannot change Tasks, Key dates, or relationships; see [Contributor work](contributor-guide.md) for the actions they can take.

## Maintain Tasks

Open **Tasks** and select **Add Task**. Enter **Title**, optionally choose an **Assignee** and **Due date (optional)**, then select **Add Task**. The assignee normally comes from the Matter team or its Matter Manager.

If you need another person, use the assignee picker's **Add someone to the team…** flow. In an add/edit dialog, stage the person with **Use this person** and save the Task to save both membership and assignment. **Cancel** does neither. On an existing row, **Add to team and assign** saves that explicit change immediately. The available audience-management permissions still apply, especially on Confidential work.

Use the row's completion control to mark a Task done or reopen it. Its actions offer **Edit Task**, **Move up**, **Move down**, and **Remove Task**. Save an edit with **Save**; check the updated row and completed/total count. Removing a Task removes the row rather than marking it done. Clearing or changing the assignee leaves any team membership intact.

Task due dates are internal targets. They do not become the Matter's Next deadline or create Key-date reminders. Discuss the work in the Matter's [comments](comments-and-activity.md); a Task has no separate discussion thread.

## Maintain Key dates

Open **Key dates**, select **Add date**, and enter **Date**, **Event**, and any **Note (optional)**. Select **Add date** to save. Use the row's actions for **Edit date** or **Remove date**; edits use **Save**, and removal asks for confirmation.

Check the saved date and event together. An open, unarchived Matter marks its earliest eligible upcoming Key date **Next**; overdue dates are marked **Overdue**. Closed Matters retain their dates but contribute none to active deadline surfaces until reopened. Key dates have no assignee or per-date reminder schedule. See [notifications](notifications.md) for reminder behavior.

Template Tasks and Key dates are ordinary rows after creation. Their relative dates have already become fixed dates, and later template or Manager changes do not reapply the template. Adjust the actual rows when the plan changes. See [creating from a template](create-matter.md).

## Connect related Matters

On **Overview**, find **Related Matters**. Use **Set parent** or **Change parent** to search by M-number or title and choose the intended parent, then confirm **Set parent**. A Matter can have one parent; a loop back to itself is refused. Use **New sub-Matter** to create a separate child with the current Matter as its parent, then complete the normal creation form.

Use **Add related Matter** for a flat connection, select the intended Matter, and confirm **Add relation**. It appears on both Matters. **Remove** on a Parent or Related row removes that connection, not the other Matter. To detach a child, open the child and remove its Parent relationship.

These links do not copy the Matter Manager, team, Confidential flag, Documents, Fields, Tasks, or dates. There are no combined Task or deadline totals on the parent. Closing or archiving one record does not perform that action on its relatives. **Restricted Matter** identifies a relationship whose other record you cannot read; it provides no title or navigation.

## Link Contracts

On Overview, find **Linked Contracts** and select **Link Contract**. Search for the intended standalone Contract, select it, and confirm the link. You must be able to change both unarchived records. A Contract can link to one Matter at a time; use **Unlink** on its existing relationship before moving it to another Matter.

If one record is Confidential and the other is not, **Confidentiality differs** explains that the flags stay independent. Select **Leave them as they are** to dismiss this information. Linking changes neither flag; review each record separately if its audience needs changing. The link itself does not grant access or copy the Contract's contents. An inaccessible linked Contract is shown as **Restricted contract**. See [Contract relationships](contract-relations-and-ending.md).

Check **History** after changes. If a save or relationship change fails, read the refusal, refresh the relevant record, and confirm the intended state before trying again. For paper that belongs to the Matter, use **Documents** and follow [uploading Documents and Versions](document-versions.md) and [reading Documents](document-previews.md).
