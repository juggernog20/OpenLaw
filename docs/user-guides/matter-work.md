# Manage Matter Tasks, Key dates, and relationships

Keep internal to-dos in **Tasks**, named deadlines in **Key dates**, and connections to other records in the Matter's relationship sections. Each serves a different purpose.

## Before you start

Use a Legal Team Member or Administrator account that can read the Matter. The Matter must be unarchived to change this work. A closed Matter stays editable. Business Users use the Portal and cannot open these sections; see [Portal record work](contributor-guide.md) for the actions they can take.

## Maintain Tasks

Open **Tasks** and select **Add Task**. Enter **Title**, optionally add **Description**, choose an **Assignee** and set **Due date**. Under **Comments & attachments**, you can use **Add a note** and add files. Task comments have no audience choice. Everyone who can access the Task can read them. Select **Add Task** to save. The assignee normally comes from the Matter team or its Matter Manager.

If you need another person, use the assignee picker's **Add someone to the team…** flow. In an add/edit dialog, stage the person with **Use this person** and save the Task to save both membership and assignment. **Cancel** or **Close** before saving does neither. On an existing row, **Add to team and assign** saves that explicit change immediately. The available audience-management permissions still apply, especially on Confidential work.

Use the row's completion control to mark a Task done or reopen it. The list hides done Tasks until you turn on **Show completed**. Turn it on to see or reopen a done Task. Select its title, or open the row's actions menu and select **Edit Task**, to open **Task details**. **Remove Task** in the same menu removes only a Task with no conversation history. Save an edit with **Save**; check the updated row and completed/total count. Removing an empty Task removes the row rather than marking it done. Clearing or changing the assignee leaves any team membership intact.

Select a Task title to open **Task details**. Its **Comments & attachments** conversation belongs to that Task and stays separate from the record conversation. The thread has no audience selector. It says **Visible to everyone who can access this task.** Older Legal Only Task comments stay readable to the same people. Originating Requesters do not receive Task comments. A Task with conversation history cannot be removed, including when its comments were deleted or redacted. Mark it done instead. An empty Task remains removable.

If the Task saves but its initial note or files fail, keep the dialog open and select **Retry note & attachments**. This retries the pending comment without creating another Task. Closing the dialog after a partial save keeps the Task that already saved.

Tasks are listed by due date, with undated Tasks last and saved display order breaking ties. An open, unarchived Matter's **Next deadline** chooses the earliest unfinished Task due date, including overdue Tasks, or upcoming Key date. A Task due date does not create a Key-date reminder.

## Maintain Key dates

Open **Key dates**, select **Add date**, and enter **Date**, **Event**, and any **Note**.

Under **Reminders**, **Global reminders** shows the organization's default lead times. **This date will remind** shows those defaults combined with this date's own lead times. To add one, enter **Additional lead time (days before)** and select **Add lead time**. Use whole days from 0 to 730; 0 means on the date. You can add up to 20 lead times. **Remove** removes an additional lead time. A person can set their own list in the **Reminder lead times** card of their notification settings. That list replaces the organization's defaults for their reminders. This date's additional lead times add to each recipient's list, and a lead time in both lists fires once.

Under **Recipients**, leave every checkbox clear to use the usual audience: the Matter Manager, Business Owner, and everyone on the Matter team. Select people to send this Key date's reminders only to those people. Their current access and notification preferences still apply; selecting someone grants no access. Active Business Users on the team are included; their reminders open the Matter in the Portal. Selected people who leave the team or become inactive are excluded. If none remain eligible, reminders do not fall back to everyone. To restore the default recipients, choose **Use the usual audience** or clear every recipient checkbox. The reset is available whenever people are selected. When a selected person has left the team, the dialog says so; if other selected people remain, it offers **Remove unavailable recipients**.

Select **Add date** to save. Use the row's actions for **Edit date** or **Remove date**; edits use **Save**, and removal asks for confirmation.

Check the saved date and event together. A **Needed by** date from creation or from the Overview Row is an ordinary Key date named Needed by. The **Key dates** header counts upcoming and overdue dates, and the **Key dates** tab shows the number of upcoming dates. Closed Matters retain their dates but contribute none to **Next deadline** or other active deadline surfaces until reopened. Key dates have no assignee. Their additional lead times and recipient choices affect reminders, while Tasks keep their own assignment and due-date behavior. See [notifications](notifications.md) for delivery timing and preferences.

Template Tasks and Key dates are ordinary rows after creation. Their relative dates have already become fixed dates, and later template or Manager changes do not reapply the template. Adjust the actual rows when the plan changes. See [creating from a template](create-matter.md).

## Connect related Matters

On **Overview**, find **Related Matters**. Use **Set parent** or **Change parent** to search by M-number or title and choose the intended parent, then confirm **Set parent**. A Matter can have one parent. A parent that would close a loop in the Matter hierarchy is refused. Use **New sub-Matter** to create a separate child with the current Matter as its parent. The **Create sub-Matter** dialog names the parent under **Parent:** and otherwise works like the normal creation form.

Use **Add related Matter** for a flat connection, select the intended Matter, and confirm **Add relation**. It appears on both Matters. **Remove** on a Parent or Related row removes that connection, not the other Matter. To detach a child, open the child and remove its Parent relationship.

These links do not copy the Matter Manager, team, Confidential flag, Documents, Fields, Tasks, or dates. There are no combined Task or deadline totals on the parent. Closing or archiving one record does not perform that action on its relatives. **Restricted Matter** identifies a relationship whose other record you cannot read; it provides no title or navigation.

## Link Contracts

On Overview, find **Linked Contracts** and select **Link Contract**. Search for the intended standalone Contract, select it, and select **Link**. **New contract** instead opens the Contract creation form with this Matter already chosen. You must be able to change both unarchived records. A Contract can link to one Matter at a time; use **Unlink** on its existing relationship before moving it to another Matter.

If one record is Confidential and the other is not, **Confidentiality differs** explains that the flags stay independent. Select **Leave them as they are** to dismiss this information. Linking changes neither flag; review each record separately if its audience needs changing. The link itself does not grant access or copy the Contract's contents. Archived Contracts are excluded from this list while their Matter link is retained. An inaccessible, non-archived linked Contract is shown as **Restricted contract**. See [Contract relationships](contract-relations-and-ending.md).

Check **History** after changes. If a save or relationship change fails, read the refusal, refresh the relevant record, and confirm the intended state before trying again. For paper that belongs to the Matter, use **Documents** and follow [uploading Documents and Versions](document-versions.md) and [reading Documents](document-previews.md).
