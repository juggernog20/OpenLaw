# Manage notifications and reminders

Use the notification bell to return to work that needs your attention, and choose which updates also reach you by email.

## Open a notification

1. Select **Notifications** in the header. Its badge shows unread items, with **9+** for more than nine.
2. Read the items that load. Opening the panel marks those displayed items read.
3. Select an item to open its Contract, Matter, Entity, Request, or Home destination.
4. Use **Show older** to load earlier items. Use **Mark all read** to clear the remaining unread items when that control is available.

Marking an item read does not complete its Task or Approval. An old notification does not preserve access to a record. If a link is unavailable, ask Legal to check your current access.

The Portal bell concerns your own Requests. It returns you to the Request, including after Legal converts the work to a Contract or Matter.

## Change preferences outside the Portal

For an Administrator or Legal Team Member:

1. Open your profile menu and select **Settings**.
2. Under **Personal**, select **Notifications**.
3. In **Notification preferences**, change the **In-app** or **Email** switch for the event group you want.
4. Wait for the saved indication. Reload the page and confirm the choice if you are unsure it saved.

Changes apply to future events. Turning **Email** off keeps that group's bell items coming. Turning **In-app** off stops new events in that group, including their email. It does not erase earlier items or recall mail already sent.

| Group                        | What it covers                                                                                                                              | Initial choice                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **Assigned to you**          | Direct asks such as Owner or Task assignments, Approvals, mentions, and Request assignments.                                                | In-app and Email on.                                  |
| **Activity on your records** | Supported Status, comment, Document, Version, and signature events on work where you are the Owner or Matter Manager, or have a team entry. | In-app on; Email off.                                 |
| **Dates approaching**        | Bell reminders for tracked Key dates, Contract notice deadlines and expiry, and Entity Obligations.                                         | In-app on. Briefing controls the date email sections. |
| **New requests**             | New Requests arriving in the Inbox for Administrators and Legal Team Members.                                                               | In-app on; Email off.                                 |
| **Knowledge items**          | Newly published Knowledge Items in the eligible Legal user's daily briefing.                                                                | Email on; no In-app switch.                           |

A visible preference does not grant the underlying role or record access. A Business User does not receive Inbox arrivals or Legal-only Knowledge updates because a switch is present. Activity notifications go to the record's audience, not every Legal Team Member who could open it. Comment tiers and separately Confidential Documents can narrow that audience further.

Your own actions normally do not notify you. A Request receipt is an exception: submitting a Request can send its receipt to you. A mention uses **Assigned to you**, rather than a second ordinary-comment notification for the same person.

## Change Portal preferences

1. In the Portal header, select **Notification settings**.
2. Set **In-app** and **Email** for **Request updates**, **Mentions**, and **Activity on your records**.
3. Wait for the saved indication and confirm the result after reloading if needed.

Request updates and Mentions start on for both channels. Activity on your records starts on for In-app and off for Email. Request updates covers receipts, replies, status changes, and decisions on your own Requests. Mentions covers shared comments that name you. Record activity includes shared comments, supporting Documents, and Contract status changes. **Email** off leaves the bell on. **In-app** off stops both channels for new Request updates. The Portal offers only events for work you can reach and does not offer Briefing settings. Removing your team membership removes record notifications from your Portal bell.

## Set the daily briefing

Outside the Portal, open **Settings**, **Personal**, **Notifications** and find **Briefing**.

1. Choose the **Email** switches for **Approvals**, **Tasks**, **Dates**, **Obligations**, and **Intake**.
2. Use **Knowledge items** in the group above for that briefing section.
3. Wait for the saved indication after each change.

Approvals, Tasks, Dates, Obligations, and Knowledge start on. Intake starts off. Each section includes only work you are eligible to receive. Tasks covers assigned Tasks due today or overdue. An empty section is omitted, and an empty briefing sends no email.

These email switches do not hide Home sections or turn off the daily bell summary. That summary opens Home when the morning round finds Home-related work. A Knowledge-only briefing has no Home-linked bell summary.

Keep **Dates approaching**, **In-app** on to receive newly generated date reminders. The **Dates** and **Obligations** Briefing switches decide whether those reminders also appear in the email. Turning a briefing section on does not create a missing reminder or restore record access.

## Understand reminder timing

Direct notifications enter the delivery queue when the event happens. Date reminders are checked by an hourly morning process. It serves you after 8:00 a.m. in your saved profile timezone, once per local day for the briefing. It does not promise delivery at exactly 8:00 a.m.

Set your timezone in [Update your profile and personal settings](personal-settings.md). If you have no saved timezone, the morning process uses UTC, even if your browser displays local times. There is no personal send-hour or weekly schedule control.

Administrators configure reminder lead times for tracked dates. The initial list is seven days before, one day before, and on the date; your organization may have changed it. The date, eligible audience, current access, and your preferences determine whether you receive a reminder. Due-today and overdue Tasks in the briefing are separate from that lead-time list.

Legal Team Members and Administrators can also set additional lead times when adding or editing a Contract or Matter Key date. The dialog shows the global reminders and their combined schedule. Additional lead times are whole days from 0 to 730, with up to 20 per Key date. A lead time present in both lists produces one reminder; removing an additional lead time does not remove a global one. Contract expiry, notice deadlines, and Entity Obligations continue to use the global list.

A Key date's recipient checkboxes can narrow its reminders to selected people from the record's team, including its Owner or Matter Manager. With no selection, the usual record audience applies. Selected people must still be active and on the team when reminders are checked, and must retain access and permit the notification. If every selected person has left, reminders do not widen to the usual audience. Editing the Key date and choosing **Use the usual audience** restores that default explicitly.

Each Contract and Matter Key date gets its own reminder, even when several share the same record and date. The bell item and the briefing line both name the Key date. Repeated checks do not send the same reminder again, but each configured lead time and a rescheduled date can produce a new reminder.

See [Configure reminders and use the Audit log](reminders-and-audit.md) for the Administrator's configuration procedure. Changing a lead time affects later checks; it does not guarantee recovery of every reminder missed while the app or worker was stopped.

## If an update is missing

- If the bell reports **Notifications could not be read. Close this and open it again.**, reopen it. If only older items failed, retry **Show older**.
- If a preference save fails, check the displayed error. The switch returns to its earlier value. Retry after the connection recovers and confirm the saved choice.
- Check the event group and both switches. For a morning email, also check the relevant Briefing section and saved timezone.
- Check that the event addressed you. Being able to open a record alone does not put you on its notification audience. Your own edit normally produces no item for you.
- Ask Legal to check the record's team, audience, date, or Request status when necessary. An unavailable record may disappear from the bell after access changes.
- Check your mailbox's spam folder and filters. Ask your Administrator to check email configuration and delivery if expected mail does not arrive. A visible bell item does not prove that an email reached your inbox. Delivery retries can produce a duplicate email.

For an urgent reply, open the record or your Portal Request and use its [conversation](comments-and-activity.md). An email notification is a link back to the work, not a new intake channel.
