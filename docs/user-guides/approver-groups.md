# Configure reusable Approver groups

Create a named set of colleagues that Legal can use when requesting Contract approvals. Sign in as an Administrator. Members may be any active user, including Business Users.

## Create a group

1. Open your profile menu, select **Settings**, then **Contracts**, **Approver groups**. Only an Administrator can open this page. Anyone else who opens its address goes to their profile settings.
2. Select **Add group**. Enter **Name** and an optional **Description** that explains when to use it.
3. Under **Members**, select the intended people. Business Users receive their requests under **Approvals** in the Portal navigation bar.
4. Select **Add group**. Reopen the row's **Edit** control and confirm the saved members.

Groups appear by name; they do not have a custom order or a sequential approval order.

## Apply and check the group

As an Administrator or Legal Team Member with access to an unarchived Contract:

1. Open **Approvals**, then **Approvals & signing**.
2. Select **Apply group** and choose the **Approver group**. If the Contract has a default group, the dialog starts on it.
3. Review the named people and any already-pending requests that will be skipped. Select **Apply group** in the dialog and check the resulting **Pending** rows.

Applying the group creates one Approval Request for each person it asks. Everyone can respond in any order. A member who has been archived is left out. A member who already has a pending request on this Contract is skipped.

On a Confidential Contract, staff approvers must already have access. If the primary Document is marked Confidential, staff approvers must also be in that Document's audience. Business approvers receive a focused review page with the Contract title and primary Document; they are not added to the Contract team and cannot see internal legal comments or other Documents. If a staff member lacks access, the whole action is refused and no request is created. A group with no active members, or with everyone already pending, is also refused.

See [Request and give approval](contract-approvals.md) for decisions, cancellation, and moving beyond the Approval Stage.

## Edit, archive, or restore a group

Open the group's **Edit** control, change its name, description, or Members, and select **Save**. A former member who is now archived appears as **Can no longer approve**. Remove that selection before saving a valid member list.

Existing Approval Requests retain their named people when a group is edited or archived. To change a pending request, use the Contract's cancellation and new-request controls; changing a group does not withdraw an earlier ask.

To stop offering the group, select its **Archive** control, read the confirmation, and select **Archive group**. No replacement is required. Use **Show archived**, then **Restore**, to offer it again, and review its members before applying it.

If saving the member list fails after the name or description saved, reopen the editor and inspect both before retrying. A renamed group alone is not proof that its membership change succeeded. The [Audit log](reminders-and-audit.md) records configuration changes.

## Defaults and override permissions

In **Settings → Contracts → Types**, open a type and select its **Approval defaults** tab. In the **Default approver group** card, choose the **Approver group**, or choose **No default group** to clear it. The choice saves when you select it. New Contracts of that type inherit this group. Changing or clearing it affects future Contracts only and never starts an approval request. Existing Contracts, re-typed Contracts, and active requests remain unchanged.

In **Settings → Contracts → Approver groups**, the **Approval permissions** card asks **Who can override a default approver group?** The initial setting is **Legal team members and administrators**. Choose **Administrators only** to restrict applying a different group on a Contract with a default. The choice saves when you select it. The API enforces this setting, including for pages opened before the setting changed. Contracts without a default still allow Legal to choose a group. This permission controls group selection; it does not change the separate permissions for individual approval requests, cancellation, or moving beyond Approval.

If a type's default group is archived, the type's card shows it with **(archived)** after its name. Choose another group for future Contracts. On a Contract that inherited the archived group, **Apply group** shows **Default group unavailable — contact an administrator**. Anyone who may override the default can choose another group there. Under **Administrators only**, a Legal Team Member must ask an Administrator.
