# Configure reusable Approver groups

Create a named set of colleagues that Legal can use when requesting Contract approvals. Sign in as an Administrator. Members must be active Administrators or Legal Team Members.

## Create a group

1. Open your profile menu, select **Settings**, then **Contracts**, **Approver groups**.
2. Select **Add group**. Enter **Name** and an optional **Description** that explains when to use it.
3. Under **Members**, select the intended people. Contributors and Business Users cannot be group approvers.
4. Select **Add group**. Reopen the row's **Edit** control and confirm the saved members.

Groups appear by name; they do not have a custom order or a sequential approval order.

## Apply and check the group

As an Administrator or Legal Team Member with access to an unarchived Contract:

1. Open **Approvals**, then **Approvals & signing**.
2. Select **Apply group** and choose the **Approver group**.
3. Review the named people and any already-pending requests that will be skipped. Confirm the action and check the resulting **Pending** rows.

Applying the group creates individual Approval Requests for its current eligible members. Everyone can respond in any order. The group does not grant access to a Confidential Contract. Resolve access or membership problems before applying it.

See [Request and give approval](contract-approvals.md) for decisions, cancellation, and moving beyond the Approval Stage.

## Edit, archive, or restore a group

Open the group's **Edit** control, change its name, description, or Members, and select **Save**. A former member who is now archived or has a lower app role appears as **Can no longer approve**. Remove that selection before saving a valid member list.

Existing Approval Requests retain their named people when a group is edited or archived. To change a pending request, use the Contract's cancellation and new-request controls; changing a group does not withdraw an earlier ask.

To stop offering the group, select its **Archive** control, read the confirmation, and select **Archive group**. No replacement is required. Use **Show archived**, then **Restore**, to offer it again, and review its members before applying it.

If saving the member list fails after the name or description saved, reopen the editor and inspect both before retrying. A renamed group alone is not proof that its membership change succeeded. The [Audit log](reminders-and-audit.md) records configuration changes.
