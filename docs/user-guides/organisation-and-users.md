# Manage your organization and users

Keep your organization details current and give each person the access they need. Organization Settings require an Administrator. A Legal Team Member who opens **Settings → General** or **Settings → Users** lands on **Profile** instead. A Business User who opens Settings is sent to the Portal.

## Update organization details

1. Open **Settings → General**.
2. Edit **Organization name** and press Enter or leave the field to save. Check the saved status; Escape restores the previous name before saving.
3. Select **Upload** beside **Logo** and choose a PNG, JPEG, WebP, or SVG image of 5 MB or smaller. Any other file shows "That logo must be a PNG, JPEG, WebP, or SVG image 5 MB or smaller. Pick another file." Choose a supported file and retry. OpenLaw also refuses an image that it cannot read or that has more than 16 million pixels. It then shows "The logo must be a readable PNG, JPEG, WebP or SVG with no more than 16 million pixels." Resize or export the image again and retry.
4. Select **Default timezone**. This supplies the organization default; signed-in users can set their own [account timezone](personal-settings.md).
5. Reload to confirm the saved values. **Default locale** currently offers **English (United States)** only.

The saved **Organization name** and logo appear on the sign-in pages for staff and for the Business Portal, above the sign-in form. Anyone who opens a sign-in page can see them without an account. With no saved name, the sign-in pages show OpenLaw. The name and logo also appear in the header of the staff app and of the Portal after sign-in.

Emails from OpenLaw show the organization name and logo in their header. This includes invitations, sign-in links, test emails, and notifications. With no logo, the header shows the OpenLaw mark. With no name, it shows OpenLaw. The **General** pane has no control to remove a logo; upload a replacement image instead. Logos saved before email logos existed get their email copy during upgrade. If the old image cannot be read, emails show the OpenLaw mark until you upload the logo again from a readable file.

## Invite a colleague

1. Open **Settings → Users**, then **Invite user**.
2. Enter **Display name** and **Email**. Choose **Legal team member** or **Administrator** under **Role**. See [roles and access](roles-and-access.md) before granting administration rights.
3. Select **Send invite** and check the new **Invited** row. The recipient gets a **Set password** email link, which expires in 1 hour.
4. Have the colleague sign in and check their access. The first sign-in by any method changes the row to **Active**. The colleague can set a password from the email link. When **Legal User Authentication** has **Email magic link** turned on, the colleague can instead request a sign-in link on the staff sign-in page. When it has **Single sign-on (SSO)** turned on, the colleague can sign in through the identity provider with the matching email address.

Business Users enter through the [Business Portal](portal-sign-in.md); they are not a third choice in the invitation form. An allowed email domain does not grant a staff role.

If delivery fails, check the address and [outbound email](authentication-and-email.md). If OpenLaw cannot send email, **Send invite** and **Resend invite** show "The invite was not sent: this instance cannot send email." The message then names the fix: set up outbound email in **Settings → Advanced → Outbound email**, or set `SMTP_URL` and `SMTP_FROM` together when the deployment sets email. No **Invited** row is added until the invitation is sent. Use the pending row's **Resend invite** action to send a replacement link. **Revoke invite** withdraws an unused invitation and removes the row. Use the latest email link after a resend.

OpenLaw rejects an invalid address. It also refuses an invitation for an account that has already signed in, with "This user has already activated their account." A Business User's address gets the same refusal. Inviting an already pending address with the same role resends its invitation instead of creating a duplicate row. An invitation that names a different role for a pending address is refused with "This user already exists with a different role." Correct an invalid entry, or change the role on the existing row after it becomes **Active**.

## Change a role or revoke sessions

Select the user's role in the Users table and choose the new role. The role control appears on **Active** rows only. Check the saved row. The new role applies on that person's next action; they do not have to sign in again. Role changes affect what the account can do; they do not transfer its assigned work.

This control also offers **Business user**, which the invitation form does not. Use it to give an existing Business User a staff role in place, or to return an active staff account to Portal-only access.

Check the row after you promote a Business User. A Business User account normally exists because that person signed in, so the row stays **Active** and keeps its role control. If it reads **Invited**, the account has never signed in, so the promotion left a pending staff invitation and the row's role control is gone. Use the row's **Resend invite** action and ask the person to sign in, for example by setting a password from the emailed link. The first sign-in returns the row to **Active** and brings its role control back.

To sign a person out on every device, select the row's **…** button. Its accessible name is "More actions for" followed by the email address. Choose **Sign out user**. Existing sessions stop granting access. The account remains active and can sign in again with a sign-in method that its group allows. To prevent further sign-in, archive the account. Your own row has no **Archive** action and no **…** button.

Administrators cannot archive themselves. OpenLaw also prevents removing the last active Administrator. Archiving shows "You cannot archive the last Administrator." A role change shows "You cannot demote the last Administrator." Establish and verify another Administrator before reducing the remaining Administrator's role.

## Reassign work before archiving

Review the departing person's open work and explicitly assign a successor. Change the Contract's [Legal Owner](create-contract.md), the [Matter Manager and Matter team](create-matter.md), [Task assignees](contract-tasks-and-dates.md), and [Obligation assignees](entity-obligations.md) on the relevant records. Review pending [Approvals](contract-approvals.md) separately so they do not wait on an unavailable person.

Archiving a user does not bulk-reassign records, Tasks, Obligations, or Approvals. Historical authorship remains attached to the original person. Check each reassignment and tell the successor what needs attention before withdrawing access.

## Archive and restore a user

1. In **Settings → Users**, find the intended account and use **Archive** on that row.
2. Check that the row leaves the ordinary list. Archival blocks new sign-ins and revokes existing sessions.
3. Turn on **Show archived** to find archived accounts. The switch appears once at least one account is archived. Use the row's **Restore** action to reactivate the intended account.
4. Ask the restored user to sign in again. Previously revoked sessions stay revoked; restoration does not bring an old browser session back.

If an action is refused, read the message beside the row and check the account, your permissions, and the Administrator safeguards before retrying. If a colleague cannot access a record after a role change or restoration, check both their [role and record access](roles-and-access.md).
