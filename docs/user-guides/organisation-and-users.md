# Manage your organization and users

Keep your organization details current and give each person the access they need. Organization Settings require an Administrator.

## Update organization details

1. Open **Settings → General**.
2. Edit **Organization name** and press Enter or leave the field to save. Check the saved status; Escape restores the previous name before saving.
3. Select **Upload** beside **Logo** and choose a PNG, JPEG, WebP, or SVG image of 5 MB or smaller. Any other file shows "That logo must be a PNG, JPEG, WebP, or SVG image 5 MB or smaller. Pick another file." Choose a supported file and retry.
4. Select **Default timezone**. This supplies the organization default; signed-in users can set their own [account timezone](personal-settings.md).
5. Reload to confirm the saved values. **Default locale** currently offers **English (United States)** only.

The saved **Organization name** and logo also appear on the sign-in pages for staff and for the Business Portal, above the sign-in form. Anyone who opens a sign-in page can see them without an account. With no saved name, the sign-in pages show OpenLaw.

## Invite a colleague

1. Open **Settings → Users**, then **Invite user**.
2. Enter **Display name** and **Email**. Choose **Legal team member** or **Administrator** under **Role**. See [roles and access](roles-and-access.md) before granting administration rights.
3. Select **Send invite** and check the new **Invited** row. The recipient follows the email link to set a password. When **Legal User Authentication** has **Single sign-on (SSO)** turned on, an invited colleague can sign in through the identity provider using the matching email address instead.
4. Have the colleague sign in and check their access. The row becomes **Active** after the colleague sets a password or signs in through single sign-on. A sign-in with an email magic link alone does not activate the row. The row stays **Invited** and keeps its **Resend invite** and **Revoke invite** actions. Do not use **Revoke invite** on a row for a colleague who already works in OpenLaw.

Business Users enter through the [Business Portal](portal-sign-in.md); they are not a fourth staff-invitation choice. An allowed email domain does not grant a staff role.

If delivery fails, check the address and [outbound email](authentication-and-email.md). Use the pending row's **Resend invite** action to send a replacement link. **Revoke invite** withdraws an unused invitation. Use the latest email link after a resend. Invalid addresses and invitations for already activated accounts are rejected. Inviting an already pending address with the same role resends its invitation instead of creating a duplicate row. OpenLaw refuses an invitation that names a different role, and refuses a Business User's address, because that account already exists. Correct an invalid entry, or change the role on the existing row.

## Change a role or revoke sessions

Select the user's role in the Users table and choose the new role. The role control appears on **Active** rows only. Check the saved row. The new role applies on that person's next action; they do not have to sign in again. Role changes affect what the account can do; they do not transfer its assigned work.

This control also offers **Business user**, which the invitation form does not. Use it to give an existing Business User a staff role in place, or to return an active staff account to Portal-only access.

Check the row after you promote a Business User. If it still reads **Active**, that account was already activated and you can keep changing its role. If it reads **Invited**, the account has never set a password or signed in through your identity provider, so the promotion left a pending staff invitation and the row's role control is gone. Use the row's **Resend invite** action and ask the person to set a password from the emailed link. Where **Legal User Authentication** has **Single sign-on (SSO)** turned on, an invited account can activate by signing in through the identity provider instead. Either route returns the row to **Active** and brings its role control back.

Use the row's **Sign out user** action when that person should sign in again on every device. Existing sessions stop granting access. The account remains active and can sign in again with a sign-in method that its group allows. To prevent further sign-in, archive the account. Your own row has no **Sign out user** or **Archive** action.

Administrators cannot archive themselves. OpenLaw also prevents removing the last active Administrator through archival or demotion. Establish and verify another Administrator before reducing the remaining Administrator's role.

## Reassign work before archiving

Review the departing person's open work and explicitly assign a successor. Change [Contract Owner](create-contract.md), [Matter Manager and Participants](create-matter.md), [Task assignments](contract-tasks-and-dates.md), and [Obligation responsibility](entity-obligations.md) on the relevant records. Review pending [Approvals](contract-approvals.md) separately so they do not wait on an unavailable person.

Archiving a user does not bulk-reassign records, Tasks, Obligations, or Approvals. Historical authorship remains attached to the original person. Check each reassignment and tell the successor what needs attention before withdrawing access.

## Archive and restore a user

1. In **Settings → Users**, find the intended account and use **Archive** on that row.
2. Check that the row leaves the ordinary list. Archival blocks new sign-ins and revokes existing sessions.
3. Turn on **Show archived** to find archived accounts. Use the row's **Restore** action to reactivate the intended account.
4. Ask the restored user to sign in again. Previously revoked sessions stay revoked; restoration does not bring an old browser session back.

If an action is refused, read the message and check the account, your permissions, and the Administrator safeguards before retrying. If a colleague cannot access a record after a role change or restoration, check both their [role and record access](roles-and-access.md).
