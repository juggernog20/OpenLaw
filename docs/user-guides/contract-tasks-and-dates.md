# Manage Contract Tasks and Key dates

Track who needs to do something and which dates need attention on a Contract.

## Before you start

Sign in as a Legal Team Member or Administrator with access to an unarchived Contract. A Task belongs to its assignee; the Contract's Legal Owner is a separate responsibility. A Key date has no individual assignee.

## Maintain Tasks

1. Open **Tasks** and select **Add task**.
2. Enter **Title** and, if useful, **Description**. Choose **Assignee** or **Unassigned**, and set **Due date** if needed. Under **Comments & attachments**, you can add an initial note and files. Everyone who can open the Task can read that note.
3. Select **Add task** and check the new row. **Cancel** before saving creates neither the Task nor a staged team addition.
4. Select the Task's checkbox to complete it. A completed Task leaves the list until you turn on **Show completed**. Select the checkbox again to reopen it. Check the done count, such as **1 of 3 done**, in the section header and the saved row.
5. Select the Task title, or **Edit task** in the row's actions menu, to open its details. Save an edit with **Save**. **Remove task**, in the same menu, removes a Task only when it has no conversation history.

Select the assignee's name or avatar to change who is responsible. The picker offers active people on the Contract team and its Legal Owner. It does not offer Business Users. If you can manage the team, **Add someone to the team…** lets you search another active staff member and confirm **Add to team and assign**. Read the access notice before confirming: this adds the person to the Contract team as well as assigning the Task. When creating or editing a Task, the picker instead offers **Use this person**; the team addition waits until you submit the Task form. Changing or clearing the assignee later does not remove that team membership.

Select a Task title to open **Task details**. Its **Comments & attachments** conversation belongs to that Task and stays separate from the record conversation. The composer has no audience choice. Everyone who can open the Task can read its comments, and earlier **Legal Only** Task comments stay readable to the same people. Originating Requesters do not receive Task comments. A Task with conversation history cannot be removed, including when its comments were deleted or redacted. Mark it done instead. An empty Task remains removable.

If the Task saves but its initial note or files fail, keep the dialog open and select **Retry note & attachments**. This retries the pending comment without creating another Task. Closing the dialog after a partial save keeps the Task that already saved.

Tasks keep the order in which they were added. A new Task goes to the end of the list. Completing, editing, or reassigning a Task does not move it. The current Contract Task screen has no reordering control, and dragging a row does not change the order.

## Maintain Key dates

1. Open **Key dates** and select **Add date**.
2. Enter **Date**, name the **Event**, and add a **Note** if useful.
3. Under **Reminders**, **Global reminders** lists the organization's default lead times, and **This date will remind** combines them with this date's additional lead times. To add one, enter **Additional lead time (days before)** and select **Add lead time**. Use whole days from 0 to 730; 0 means on the date. You can add up to 20 lead times. **Remove** removes an additional lead time; the global reminders still apply.
4. Leave the checkboxes under **Recipients** clear to use the usual audience: the Legal Owner, Business Owner, and everyone on the Contract team. The checkboxes include active Business Users on that team. Select people to send this Key date's reminders only to those people. Their current access and notification preferences still apply; selecting someone grants no access.
5. Select **Add date**, then check the date, event, and **Key date** source.
6. Use that row's actions to **Edit date** or **Remove date**. Cancel leaves the saved date unchanged.

Rows marked **Derived** come from the term. Change expiry or the notice period on **Overview** to change them; they are not editable as separate Key dates. The list combines those derived dates with your Key dates. Upcoming dates come first, nearest first. Past dates follow, most recent first. Task due dates remain separate from Key dates and do not create Key-date reminders. For an unarchived Contract that has not ended, the **Next deadline** column in the Contracts list chooses the earliest unfinished Task due date, including overdue Tasks, upcoming Key date, expiry date or notice deadline.

## Check reminders and your work

Home can show assigned open Tasks and approaching Contract dates in their respective sections. Follow their links back to the correct Task or Contract. A Task assignment and a Key date do not promise the same notification recipients or delivery time. Use [Manage notifications and reminders](notifications.md) for the shared rules, preferences, and cases where no email is sent.

Each Key date gets its own reminder, including when several on one Contract share a date. An archived or ended Contract sends no Key-date, expiry, or notice reminders. The reminder names its event. A lead time present in both the global and additional lists fires only once for that Key date. Selected recipients who leave the team or become inactive are excluded; an empty eligible selection does not fall back to everyone. Whenever recipients are selected, choose **Use the usual audience** or clear every checkbox to return to the default recipients. If a selected recipient has left the team, the dialog says so and offers **Remove unavailable recipients** while other selected people remain. Business Users receive these reminders through their Portal bell and a daily email summary, subject to their notification preferences.

Staff can replace the organization's default lead times with their own list in the **Reminder lead times** card under **Settings** → **Notifications**. Their reminders then use their own list plus this date's additional lead times. **This date will remind** does not show personal lists, so a recipient with their own list can get reminders on other days. Business Users use the organization's list.

## If an action is unavailable

An archived Contract is read-only; restore it before changing Tasks or dates. Tasks and Key dates remain in the full app; Business Users cannot open these sections. If a person disappears from the picker, check that they are active and on the team. If saving fails, read the error and reload to confirm what persisted before trying again.

[Manage Contract terms and renewals](terms-and-renewals.md) explains the term-derived dates. [Roles and record access](roles-and-access.md) explains team permissions.
