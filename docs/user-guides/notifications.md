# Manage notifications and reminders

Use the notification bell to return to work that needs your attention, and choose which updates also reach you by email or as a device notification.

## Open a notification

1. Select **Notifications** in the header. Its badge shows unread items, with **9+** for more than nine.
2. Read the items that load. A dot marks each unread item. Opening the panel does not mark items read.
3. Select an item to open its destination and mark it read. Most items open a Contract, Matter, Entity, or Request. The daily briefing item opens Home. A finished Conversion draft item opens the Request in the Inbox with its Convert dialog. An API key item opens the API keys or MCP settings page.
4. Use **Show older** to load earlier items. Use **Mark all read** to clear the unread items. That control appears only while you have unread items outside **Your approvals**.

Marking an item read does not complete its Task or Approval. An old notification does not preserve access to a record. If a link is unavailable, ask Legal to check your current access.

When someone acted through an MCP Client, the item names the person and the Client, for example "Nadia Haddad, via Claude,".

The Portal bell concerns your own Requests and the Contracts and Matters whose team you are on. A Request item opens the Request. After Legal converts the Request, the item opens the Contract or Matter while you stay on its team.

## Act on Your approvals

Open approvals addressed to you appear first in the bell, under **Your approvals**. When that group is present, the other items follow under **Earlier**.

- For a Contract Approval, select **Review** to open the approval. In the Portal, **Review** opens your Portal review page. See [Request and give approval](contract-approvals.md).
- For an API key request, an Administrator selects **Approve** or **Deny** in the row. See [Configure MCP](configure-mcp.md).

An open approval counts in the badge until it is handled, even after you read it. **Mark all read** leaves **Your approvals** in place, and the panel says so. An approval leaves the group when you answer it, when the requester cancels it, or when you can no longer reach its record.

## Change preferences outside the Portal

For an Administrator or Legal Team Member:

1. Open your profile menu and select **Settings**.
2. Under **Personal**, select **Notifications**.
3. In **Notification preferences**, change the **In-app**, **Email**, or **Push** switch for the event group you want.
4. Wait for the saved indication. Reload the page and confirm the choice if you are unsure it saved.

Changes apply to future events. Turning **Email** off keeps that group's bell items coming. Turning **In-app** off stops new events in that group, including their email and Push. It does not erase earlier items or recall mail already sent. **Push** reaches only browsers that you turned on under **Devices**.

| Group                        | What it covers                                                                                                                                                                                                            | Initial choice                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **Assigned to you**          | Direct asks such as Owner or Task assignments, Contract team additions, generated Contracts where you are the Legal Owner, Approvals, mentions, Request assignments, and API key requests and decisions that concern you. | In-app, Email, and Push on.                                    |
| **Activity on your records** | Supported Status, comment, Document, Version, and signature events on work where you are the Owner or Matter Manager, or have a team entry.                                                                               | In-app on; Email and Push off.                                 |
| **Dates approaching**        | Bell reminders for tracked Key dates, Contract notice deadlines and expiry, and Entity Obligations.                                                                                                                       | In-app and Push on. Briefing controls the date email sections. |
| **New requests**             | New Requests and unassigned Contracts arriving in the Inbox, and a Conversion draft that finished after you closed its dialog.                                                                                            | In-app on; Email and Push off.                                 |
| **Knowledge items**          | Newly published Knowledge Items in the eligible Legal user's daily briefing.                                                                                                                                              | Email on; no In-app or Push switch.                            |

A visible preference does not grant the underlying role or record access. Business Users can receive Key-date reminders on their Contracts and Matters, including a daily email summary. They do not receive Inbox arrivals or the staff briefing sections. Activity notifications go to the record's audience, not every Legal Team Member who could open it. Comment tiers and separately Confidential Documents can narrow that audience further.

Your own actions normally do not notify you. A Request receipt is an exception: submitting a Request can send its receipt to you. A mention uses **Assigned to you**, rather than a second ordinary-comment notification for the same person.

## Change Portal preferences

1. In the Portal header, select **Notification settings**.
2. Under **How we tell you about your work**, set **In-app**, **Email**, and **Push** for **Request updates**, **Assigned to you**, **Activity on your records**, and **Dates approaching**.
3. Wait for the saved indication and confirm the result after reloading if needed.

Request updates, Assigned to you, and Dates approaching start on for all three channels. Activity on your records starts on for In-app and off for Email and Push.

- **Request updates** covers receipts, replies, status changes, and decisions on your own Requests.
- **Assigned to you** covers Contract team additions and shared comments that mention you on your Contracts and Matters. It also carries Contract Approval requests addressed to you and decisions on your own API key requests. The row text does not name these two.
- **Activity on your records** covers shared comments, supporting Documents, and Contract status changes on those records.
- **Dates approaching** covers Contract and Matter Key-date reminders, with one daily email summary linking to your Portal records. Its Email switch controls that summary.

**Email** off leaves the bell on. **In-app** off stops all three channels for new events in that group. The Portal offers only events for work you can reach. It has no Briefing settings and no Reminder lead times card. Removing your team membership removes record notifications from your Portal bell.

Shared comments work differently on a Contract or Matter that Legal converted from your Request. Your conversation with Legal continues on that record. A shared comment there reaches you as a reply under **Request updates**, not under **Activity on your records**. The bell item says that the person replied on your request, and the email subject starts with **Legal replied on**. To stop that email, turn off **Email** for **Request updates**. Turning off **Email** for **Activity on your records** does not stop it. Team members who did not raise the Request get the same comment under **Activity on your records**.

## Turn on device notifications

A device notification appears on your computer or phone, even when OpenLaw is closed. The **Push** switches control it. It is available in the staff app and in the Portal.

1. Open **Settings**, **Personal**, **Notifications**, or the Portal's **Notification settings**.
2. In **Devices**, select **Turn on for this browser**.
3. Allow notifications when the browser asks. The card then says **Notifications are on for this browser.** and lists the browser with its last-seen time.
4. Check that **Push** is on for the event groups you want.

Select a device notification to open the same destination as its bell item. This marks the item read. Receiving a device notification does not mark it read. OpenLaw shows no device notification for an item you already read, or while an OpenLaw window has focus. The notification reads its text through your session when it arrives. If you can no longer reach the record, no notification appears.

**Show details in notifications** is on at first. Turn it off to replace record names with a general sentence, such as "Legal replied on your Request". The choice applies to all your browsers.

Each browser is tied to the session that turned it on. When you sign out, or an Administrator ends that session, the browser stops receiving device notifications. Turn them on again after you sign in. Select **Revoke** beside a browser to stop its notifications at once. You can register up to ten browsers.

If the browser does not support device notifications, the card says so. On iPhone or iPad, add OpenLaw to your Home Screen and open it there first. If you blocked notifications, the card tells you where to allow them in your browser settings.

## Read comment emails

A mention, comment, or reply email includes the comment's words. OpenLaw reads the words when it sends the email, so it includes an edit made before the send. If the author deletes the comment, or an Administrator redacts it, before the send, the email has no words. A comment over 280 characters is cut and ends with **…**. Select **Read the full comment** to open it on the record. The email does not include or name attachments.

Staff emails show the comment's visibility tier beside its author, as **Legal Only**, **Working Team**, or **Full Thread**. Portal emails and Task comment emails show no tier. Only people who can read the comment on its thread receive the email.

A later delete or redaction does not recall an email that was already sent. An Administrator can turn comment words off for the whole organization. See [Configure reminders and use the Audit log](reminders-and-audit.md). With the setting off, these emails link to the record without the words.

Each email's footer says why you received it and links to your notification settings.

## Set the daily briefing

Outside the Portal, open **Settings**, **Personal**, **Notifications** and find **Briefing**.

1. Choose the **Email** switches for **Approvals**, **Tasks**, **Dates**, **Obligations**, and **Intake**.
2. Use **Knowledge items** in the group above for that briefing section.
3. Wait for the saved indication after each change.

Approvals, Tasks, Dates, Obligations, and Knowledge start on. Intake starts off. Each section includes only work you are eligible to receive. Tasks covers assigned Tasks due today or overdue. An empty section is omitted, and an empty briefing sends no email. When a section has more rows than the email shows, its **View all** link opens Home.

These email switches do not hide Home sections or turn off the daily bell summary. That summary opens Home when the morning round finds Home-related work. A Knowledge-only briefing has no Home-linked bell summary.

Keep **Dates approaching**, **In-app** on to receive newly generated date reminders. The **Dates** and **Obligations** Briefing switches decide whether those reminders also appear in the email. Turning a briefing section on does not create a missing reminder or restore record access.

## Set your own reminder lead times

Administrators and Legal Team Members can choose how far ahead they hear about expiries, notice deadlines, Key dates, and Entity Obligations.

1. Open **Settings**, **Personal**, **Notifications** and find **Reminder lead times**.
2. Turn off **Use the organization's default lead times**. Your list starts as a copy of the organization's list.
3. Enter a number of days before the date and select **Add lead time**. To take a lead time out, select its remove control.
4. Wait for the saved indication.

A lead time is a whole number of days from 0 to 730. Your list holds 1 to 20 lead times, so you cannot remove the last one. Your list replaces the organization's list for your reminders only. Turn **Use the organization's default lead times** back on to delete your list and use the organization's list again. Business Users have no such card. They use the organization's list.

## Understand reminder timing

Direct notifications enter the delivery queue when the event happens. Date reminders are checked by an hourly morning process. It serves you after 8:00 a.m. in your saved profile timezone, once per local day for the briefing. It does not promise delivery at exactly 8:00 a.m. The device notification for a date reminder is sent when the reminder is created. Its email waits for the briefing.

Set your timezone in [Manage your profile and preferences](personal-settings.md). If you have no saved timezone, the morning process uses UTC, even if your browser displays local times. There is no personal send-hour or weekly schedule control.

Administrators configure the organization's reminder lead times for tracked dates. The initial list is seven days before, one day before, and on the date; your organization may have changed it. Staff can replace it with their own list. The date, eligible audience, current access, and your preferences determine whether you receive a reminder. Due-today and overdue Tasks in the briefing are separate from that lead-time list.

Legal Team Members and Administrators can also set additional lead times when adding or editing a Contract or Matter Key date. The dialog shows the organization's list as **Global reminders** and the combined schedule as **This date will remind**. Additional lead times are whole days from 0 to 730, with up to 20 per Key date. They add to the list that applies to each recipient. A recipient with their own list gets that list plus the Key date's lead times, and the dialog does not show that schedule. A lead time present in both lists produces one reminder. Removing an additional lead time does not remove one from the recipient's list. Contract expiry, notice deadlines, and Entity Obligations use only the recipient's list.

A Key date's default recipients are the Contract Legal Owner or Matter Manager, the Business Owner, and everyone on the record team, including Business Users. Its recipient checkboxes can narrow reminders to selected owners or members. With no selection, the default audience applies. Selected people must still be active and on the team when reminders are checked, and must retain access and permit the notification. If every selected person has left, reminders do not widen to the usual audience. Choose **Use the usual audience**, available whenever recipients are selected, or clear all checkboxes to restore that default explicitly.

Each Contract and Matter Key date gets its own reminder, even when several share the same record and date. The bell item and the briefing line both name the Key date. Repeated checks do not send the same reminder again, but each configured lead time and a rescheduled date can produce a new reminder.

See [Configure reminders and use the Audit log](reminders-and-audit.md) for the Administrator's configuration procedure. Changing a lead time affects later checks; it does not guarantee recovery of every reminder missed while the app or worker was stopped.

## If an update is missing

- If the bell reports **Notifications could not be read. Close this and open it again.**, reopen it. If only older items failed, retry **Show older**.
- If a preference save fails, check the displayed error. The switch returns to its earlier value. Retry after the connection recovers and confirm the saved choice.
- Check the event group and its switches. For a morning email, also check the relevant Briefing section, your reminder lead times, and your saved timezone.
- For a missing device notification, check that **Devices** lists this browser and that **Push** is on for the group. Check that the browser and the operating system allow notifications. No device notification appears while an OpenLaw window has focus.
- Check that the event addressed you. Being able to open a record alone does not put you on its notification audience. Your own edit normally produces no item for you.
- Ask Legal to check the record's team, audience, date, or Request status when necessary. An unavailable record may disappear from the bell after access changes.
- Check your mailbox's spam folder and filters. Ask your Administrator to check email configuration and delivery if expected mail does not arrive. A visible bell item does not prove that an email reached your inbox. Delivery retries can produce a duplicate email or device notification.

For an urgent reply, open the record or your Portal Request and use its [conversation](comments-and-activity.md). An email notification is a link back to the work, not a new intake channel.
