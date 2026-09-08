# Manage your organization and users

Keep your organization details current and give each person the access they need. Organization Settings require an Administrator.

## Update organization details

1. Open **Settings → General**.
2. Edit **Organization name** and press Enter or leave the field to save. Check the saved status; Escape restores the previous name before saving.
3. Select **Upload** beside **Logo** and choose a supported image. If the image is rejected, correct its format or size and retry.
4. Select **Default timezone**. This supplies the organization default; signed-in users can set their own [account timezone](personal-settings.md).
5. Reload to confirm the saved values. **Default locale** currently offers **English (United States)** only.

## Invite a colleague

1. Open **Settings → Users**, then **Invite user**.
2. Enter **Display name** and **Email**. Choose **Legal team member**, **Contributor**, or **Administrator** under **Role**. See [roles and access](roles-and-access.md) before granting administration rights.
3. Select **Send invite** and check the new **Invited** row. The recipient follows the email link to set a password for built-in sign-in. With OIDC configured, an invited colleague can sign in through the identity provider using the matching email address.
4. Have the colleague sign in and check their access. The row becomes **Active** after activation/sign-in.

Business Users enter through the [Business Portal](portal-sign-in.md); they are not a fourth staff-invitation choice. An allowed email domain does not grant a staff role.

If delivery fails, check the address and [outbound email](authentication-and-email.md). Use the pending row's **Resend invite** action to send a replacement link. **Revoke invite** withdraws an unused invitation. Use the latest email link after a resend. Invalid addresses and invitations for already activated accounts are rejected. Inviting an already pending address with the same role resends its invitation instead of creating a duplicate row. OpenLaw refuses an invitation that names a different role, and refuses a Business User's address, because that account already exists. Correct an invalid entry, or change the role on the existing row.

## Change a role or revoke sessions

Select the user's role in the Users table and choose the new role. Check the saved row. The new role applies on that person's next action; they do not have to sign in again. Role changes affect what the account can do; they do not transfer its assigned work.

This control also offers **Business user**, which the invitation form does not. Use it to give an existing Business User a staff role in place, or to return a staff account to Portal-only access.

Use the row's **Revoke all sessions** action when that person should sign in again on every device. Existing sessions stop granting access. The account remains active and can sign in again using its configured method. To prevent further sign-in, archive the account.

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
