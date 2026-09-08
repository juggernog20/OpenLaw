# Configure sign-in, portal access, and email

Use **Settings → Security → Authentication** as an Administrator to choose staff sign-in and Business Portal access. An operator manages deployment settings and identity-provider configuration; operator is a responsibility, not an OpenLaw account role.

## Choose built-in sign-in

Select **Built-in** for staff email and password sign-in. The change applies immediately. Users manage their own password and optional two-factor authentication in [account settings](personal-settings.md).

Magic links are the Business Portal's sign-in method in built-in mode. The Authentication Settings switch cannot turn them off in that mode. The allowed-domain list and a working email relay are still needed for new Business Users to enter.

## Configure single sign-on

1. Have your identity-provider administrator create an OpenID Connect client for this instance. Obtain its issuer URL, client ID, client secret, and email domain. Use the app's configured public address for the callback. This version configures OIDC; it has no SAML setup interface.
2. Keep a working Administrator password and an existing Administrator session available while testing. Administrators retain password sign-in when OIDC is selected.
3. Select **Identity provider (OIDC)**. Enter **Provider ID**, **Issuer URL**, **Email domain**, **Client ID**, and **Client secret**. Select **Register provider**. Successful registration completes the pending switch to OIDC.
4. Copy the displayed callback URL into the identity provider's allowed redirect URLs. It ends in `/api/auth/sso/callback` and must match the instance address and scheme.
5. In a separate browser session, sign in through the identity provider with an invited staff account. Confirm the expected account and role. Provider registration checks discovery; it does not prove that a complete sign-in will succeed.

The identity provider establishes identity. OpenLaw retains the account's role and manages its own revocable sessions. Invite staff explicitly; matching an allowed email domain does not grant an uninvited person a staff role.

To update a registered provider, edit its fields and select **Save provider**. Leave **Client secret** blank to retain it, or supply a replacement to rotate it. The Provider ID is fixed after registration. Test a fresh sign-in after changes. If discovery fails, correct the issuer URL or its reachability and retry; a failed update should leave the previous provider configuration available. Use Administrator password sign-in to recover and select **Built-in** if needed.

## Control Business Portal entry

Add approved entries under **Allowed email domains** using **Add**; remove an entry with its removal control. Use domains such as `helix.example`, not full addresses. Check the saved list. OpenLaw checks this list every time it issues a magic link, not only the first time. Removing a domain, or leaving the list empty, stops everyone on that domain from getting a new sign-in link, including Business Users who signed in before. Tell the affected people before you narrow the list.

Narrowing the list does not by itself end Portal access. A session someone already holds keeps working, a link issued before the change still opens the Portal until it is used or expires, and an existing Business User who has an identity-provider account can still sign in through single sign-on. What the list always governs is entry by someone with no account yet: an unapproved address can neither receive a link nor establish an account through single sign-on. To end one person's access, archive the account or revoke its sessions. See [archive and restore a user](organisation-and-users.md#archive-and-restore-a-user).

In OIDC mode, **Magic-link sign-in** can be turned off to require identity-provider sign-in for requesters. They then need suitable identity-provider accounts. Turning off magic links does not itself disable OIDC Portal entry. Test the intended [Portal sign-in flow](portal-sign-in.md) with an allowed address and confirm that an unapproved address cannot establish a new account. Domain restrictions do not replace staff-role and record-access controls.

## Set up email before finishing the wizard

During [first-run setup](first-run.md), the **Outbound email** step shows the active configuration source.

1. If email is unset, enter an **SMTP relay URL** beginning with `smtp://` or `smtps://`, and a **From address** accepted by your relay. Credentials, if required, are part of the URL; obtain them from your operator and keep them out of screenshots and support messages.
2. Select **Save relay**. The saved URL is not displayed again.
3. Select **Send test email**, then check the signed-in Administrator's inbox. A saved relay alone does not prove delivery works.
4. If delivery fails, use **Replace relay**, correct the connection or sender details, save, and send another test. Check relay connectivity and its authentication and sender restrictions with your operator.
5. **Clear relay** removes the saved relay and stops email delivery when there is no environment override. Save a valid replacement before depending on invitations, magic links, or password reset emails.

Complete these checks before finishing the wizard or selecting **Set up later** on its Welcome or final invitation step. The completed welcome wizard cannot be reopened in this version, and there is no separate email Settings page. After completion, use the operator-managed deployment configuration to change or recover email delivery.

## Understand deployment precedence

When the deployment sets **SMTP_URL**, the wizard's relay settings are read-only: that environment value takes precedence over the stored relay. **SMTP_FROM** must also be set. An environment relay without a From address prevents delivery even if a complete relay was previously saved in the app.

The operator must apply the intended `SMTP_URL`, `SMTP_FROM`, and public `BASE_URL` consistently to the app and worker, then recreate the affected services and verify delivery. Follow [deployment configuration](deployment-configuration.md), including secret handling. To return to a stored relay, remove the environment override and restart with the updated configuration; verify which source is active before relying on it.

Authentication Settings do not configure [electronic signing](configure-signing.md) or [AI providers](configure-analysis.md). Those use their own integration settings.
