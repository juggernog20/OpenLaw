# Configure reusable Approver groups

Create a named set of colleagues that Legal can use when requesting Contract approvals. Sign in as an Administrator. Members may be any active user, including Business Users.

## Create a group

1. Open your profile menu, select **Settings**, then **Contracts**, **Approver groups**.
2. Select **Add group**. Enter **Name** and an optional **Description** that explains when to use it.
3. Under **Members**, select the intended people. Business Users receive their requests in the Legal portal.
4. Select **Add group**. Reopen the row's **Edit** control and confirm the saved members.

Groups appear by name; they do not have a custom order or a sequential approval order.

## Apply and check the group

As an Administrator or Legal Team Member with access to an unarchived Contract:

1. Open **Approvals**, then **Approvals & signing**.
2. Select **Apply group** and choose the **Approver group**.
3. Review the named people and any already-pending requests that will be skipped. Confirm the action and check the resulting **Pending** rows.

Applying the group creates one Approval Request for each person it asks. Everyone can respond in any order. A member who has been archived is left out. A member who already has a pending request on this Contract is skipped.

On a Confidential Contract, staff approvers must already have access. Business approvers receive a focused review page with the Contract title and primary Document; they are not added to the Contract team and cannot see internal legal comments or other Documents. If a staff member lacks access, the whole action is refused. A group with no active members, or with everyone already pending, is also refused.

See [Request and give approval](contract-approvals.md) for decisions, cancellation, and moving beyond the Approval Stage.

## Edit, archive, or restore a group

Open the group's **Edit** control, change its name, description, or Members, and select **Save**. A former member who is now archived appears as **Can no longer approve**. Remove that selection before saving a valid member list.

Existing Approval Requests retain their named people when a group is edited or archived. To change a pending request, use the Contract's cancellation and new-request controls; changing a group does not withdraw an earlier ask.

To stop offering the group, select its **Archive** control, read the confirmation, and select **Archive group**. No replacement is required. Use **Show archived**, then **Restore**, to offer it again, and review its members before applying it.

If saving the member list fails after the name or description saved, reopen the editor and inspect both before retrying. A renamed group alone is not proof that its membership change succeeded. The [Audit log](reminders-and-audit.md) records configuration changes.

## Defaults and override permissions

In **Settings → Contracts → Types**, open a type and choose its **Default approver group** below **People**. New Contracts inherit this group. Changing or clearing it affects future Contracts only and never starts an approval request. Existing Contracts and active requests remain unchanged.

In **Settings → Contracts → Approver groups → Approval permissions**, choose who may override the default group. The initial setting is **Legal team members and administrators**. Choose **Administrators only** to restrict applying a different group on a Contract with a default. The API enforces this setting, including for pages opened before the setting changed. Contracts without a default still allow Legal to choose a group. This permission controls group selection; it does not change the separate permissions for individual approval requests, cancellation, or moving beyond Approval.

If a default group is archived, an Administrator can select another group when requesting approval. Update the type's default for future Contracts as well.
