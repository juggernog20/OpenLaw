# Configure reminders and use the Audit log

Set the organization's reminder lead times and inspect recorded changes. Both tasks require an Administrator. Each person's email and bell preferences are configured separately in [Manage notifications and reminders](notifications.md).

## Set reminder lead times

1. Open your profile menu and select **Settings**.
2. Under **Organization**, select **Notifications**. Check that the page is **Reminder lead times**; **Personal**, **Notifications** changes only your preferences.
3. Select **Add lead time**, enter a whole number of days before the date, and press Enter. Zero means **On the day**.
4. Use a row's **Remove** control to remove an unwanted lead time. Drag its reorder handle, or focus the handle and use the arrow keys, to change the list's display order.
5. Wait for each save, then reload and confirm the final list.

The list accepts distinct whole numbers from 0 to 730, holds at most 20 entries, and must keep at least one. Reordering does not change which dates qualify. Changes save immediately for the organization and affect later reminder checks.

One list covers tracked Key dates, Contract notice deadlines and expiry, and Entity Obligation reminders. Task due dates and overdue Task briefing sections are separate. A lead time does not grant record access or force email delivery.

## Check delivery

Use a fictional record and an eligible colleague with the required record access and notification preferences. Set a tracked date the chosen number of days ahead. After the next morning processing round, check the colleague's bell and, if enabled, their briefing email. Inspect the record's full dates list as well: multiple Key dates on one record on the same date can share a reminder.

The hourly morning process serves each person after 8:00 a.m. in their saved profile timezone, once per local day for the briefing. An unset timezone uses UTC. The organization does not have a send-hour control here. **Dates approaching**, **In-app** must permit new date reminders; the **Dates** and **Obligations** Briefing switches govern those email sections. Empty briefings send no email.

Changing the schedule does not recall delivered reminders or guarantee catch-up for missed processing. If an expected reminder is absent, check the date, lead time, person's saved timezone, record audience, and preferences. Ask the deployment operator to check worker and email delivery if these are correct. A configuration entry in the Audit log proves the setting changed, not that a recipient received mail.

## Find a change in the Audit log

1. In **Settings**, open **Security**, then **Audit log**.
2. Use **Person** to select the actor, **Action** for the event, and **Record** for the record kind. These filters combine.
3. Use **From** and **To** to narrow the date range, and **Search** to narrow the available audit text. The date bounds use your browser's local calendar days.
4. Read the event, record, audience, and time. Where shown, inspect the before-and-after values.
5. Select **Show older** for more results, or **Clear filters** to start again.

The Audit log includes configuration events and recorded record-level activity, including Administrator-only events. Other app roles cannot open this settings log; their permitted record Activity remains a separate surface.

Select **Export CSV** to download the matching entries. Treat the file as a copy of the information available in this Audit log view and share it only with the intended recipient. Changing filters or leaving the app does not remove a downloaded file.

## If an entry is missing

Clear the filters, expand the dates, and check whether another person made the change. Search is not a search of all Contract, Matter, Document, or Knowledge content. A read, failed attempt, or email delivery need not have the same kind of audit entry as a successful configuration change. If the log reports that it could not be read, change a filter to retry. Record the action and approximate time when asking your operator to investigate.
