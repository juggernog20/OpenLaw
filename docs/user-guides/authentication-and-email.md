# Configure sign-in, portal access, and email

Use **Settings → Advanced → Authentication** as an Administrator to choose how Administrators, Legal Team Members, and Business Users sign in. An operator manages deployment settings and identity-provider configuration; operator is a responsibility, not an OpenLaw account role.

## Choose sign-in methods for each group

The pane has two policy cards. **Legal User Authentication** applies to Administrators and Legal Team Members. **Business Portal Authentication** applies to Business Users. Each card has the switches **Email and password**, **Email magic link**, **Single sign-on (SSO)**, and **Require two-factor authentication**. Each change applies immediately. OpenLaw checks the enabled methods against the account's actual role, whichever sign-in page the person opened.

Keep at least one sign-in method on in each card. OpenLaw refuses a policy with no method and shows "Enable at least one sign-in method." The **Single sign-on (SSO)** switch stays unavailable until you register an identity provider.

Administrators retain emergency password sign-in when **Email and password** is off under **Legal User Authentication**. This works only for an Administrator who has a password. Any required two-factor authentication still applies.

**Require two-factor authentication** applies to every enabled sign-in method in that group, including single sign-on and email magic links. A person without an authenticator app must set one up before they can use OpenLaw, and each new session must prove a code. If you turn it on under **Legal User Authentication** and you have no authenticator, OpenLaw asks you to set one up before you continue. Users set up and manage their own factor from [two-factor authentication](staff-sign-in.md#turn-on-two-factor-authentication) and [account settings](personal-settings.md).

Existing active accounts can get a sign-in link when **Email magic link** is enabled for their role and outbound email is configured. This includes Business Users invited individually. The allowed-domain list controls new Portal accounts; it does not restrict existing accounts.

## Configure single sign-on

1. Have your identity-provider administrator create an OpenID Connect client for this instance. Obtain its issuer URL, client ID, client secret, and email domain. Use the app's configured public address for the callback. This version configures OIDC; it has no SAML setup interface.
2. Keep a working Administrator password and an existing Administrator session available while testing. Administrators retain password sign-in when password sign-in is off.
3. In the **Identity provider** card, enter **Provider ID**, **Issuer URL**, **Email domain**, **Client ID**, and **Client secret**. Select **Register provider**. Registration does not turn on single sign-on for any group.
4. Copy the displayed callback URL into the identity provider's allowed redirect URLs. It ends in `/api/auth/sso/callback` and must match the instance address and scheme.
5. Turn on **Single sign-on (SSO)** under **Legal User Authentication**. Turn it on under **Business Portal Authentication** too if Business Users sign in through the identity provider.
6. In a separate browser session, sign in through the identity provider with an invited staff account. Confirm the expected account and role. Provider registration checks discovery; it does not prove that a complete sign-in will succeed.

The identity provider establishes identity. OpenLaw retains the account's role and manages its own revocable sessions. Invite staff explicitly; matching an allowed email domain does not grant an uninvited person a staff role.

To update a registered provider, edit its fields and select **Save provider**. Leave **Client secret** blank to retain it, or supply a replacement to rotate it. The Provider ID is fixed after registration. Test a fresh sign-in after changes. If discovery fails, correct the issuer URL or its reachability and retry; a failed update should leave the previous provider configuration available. To recover, use Administrator password sign-in, turn on **Email and password** under **Legal User Authentication**, and turn off **Single sign-on (SSO)** if needed.

## Control Business Portal entry

Add approved entries under **Allowed email domains** using **Add**; remove an entry with its **Remove** control. Use domains such as `helix.example`, not full addresses. Check the saved list. OpenLaw checks this list before sending a magic link to an address with no account, and again before creating the account. Removing a domain prevents new accounts on that domain; existing active users can still sign in using the methods enabled for their role. Archive an individual account to stop that person signing in.

Narrowing the list does not by itself end Portal access. For existing accounts, a session someone already holds keeps working, and a link issued before the change still opens the Portal until it is used or expires. A Business User who has a password can still sign in with **Email and password**, and one who has an identity-provider account can still sign in through single sign-on, if **Business Portal Authentication** allows that method. What the list always governs is entry by someone with no account yet. An unapproved address gets no new sign-in link or password setup link. An identity with no account is refused when it first tries to redeem a link, complete password setup, or arrive through the single sign-on callback. Archive an account to prevent new sign-ins and revoke its existing sessions. Use **Sign out user** when the person should sign in again. See [archive and restore a user](organisation-and-users.md#archive-and-restore-a-user) and [change a role or revoke sessions](organisation-and-users.md#change-a-role-or-revoke-sessions).

Under **Business Portal Authentication**, turn off **Email magic link** to require another method for Business Users. They then need a password or a suitable identity-provider account. Turning off **Email magic link** also stops sign-in links that were sent earlier. Test the intended [Portal sign-in flow](portal-sign-in.md) with an allowed address and confirm that an unapproved address cannot establish a new account. Domain restrictions do not replace staff-role and record-access controls.

## Set up email before finishing the wizard

During [first-run setup](first-run.md), the **Outbound email** step shows the active configuration source.

1. If email is unset, enter the **SMTP server** supplied by your email administrator. Enter only the host name or IP address, with no `smtp://` prefix and no port. Enter the **Port**.
2. Choose **Connection security**: STARTTLS (usually port 587), TLS (usually port 465), or None for a relay configured without encryption. **Port** starts at 587. If you have not changed it, it follows your **Connection security** choice.
3. Choose **Authentication**. Keep **Username and password** and enter **SMTP username** and **SMTP password**, or choose **None** when your internal relay accepts the app without credentials.
4. Enter a **Sender email** that your relay accepts. **Sender name (optional)** sets the display name on sent email.
5. Select **Save relay**. OpenLaw stores the credentials encrypted and never returns them to the browser. With STARTTLS, the TLS upgrade must succeed before authentication or delivery.
6. Select **Send test email**, then check the signed-in Administrator's inbox. A saved relay alone does not prove delivery works.
7. If delivery fails, use **Replace relay**. The form opens empty, so enter all the connection, authentication, and sender details again. Save, and send another test. **Keep current relay** closes the form without a change. Check relay connectivity and its authentication and sender restrictions with your operator.
8. **Clear relay** removes the saved relay and stops email delivery when there is no environment override. Save a valid replacement before depending on invitations, magic links, or password reset emails.

The wizard cannot finish until email is configured. The **Outbound email** step has no **Set up later**, and **Continue** stays unavailable until email is configured. **Skip optional steps** on the Welcome step opens **Outbound email** while email is not configured. A configured relay does not prove delivery, so complete these checks before you continue. After setup, open **Settings → Advanced → Outbound email** to configure or replace an app-managed relay and send a test email. **Replace relay** opens the same connection and sender form; enter all details again because saved credentials are never returned. **Cancel** keeps the current relay. Successful changes apply to the next email without restarting the app.

## Understand deployment precedence

When the deployment sets **SMTP_URL**, the relay settings in both the wizard and Settings are read-only: that environment value takes precedence over the stored relay. **SMTP_FROM** must also be set. An environment relay without a From address prevents delivery even if a complete relay was previously saved in the app.

The operator must apply the intended `SMTP_URL`, `SMTP_FROM`, and public `BASE_URL` consistently to the app and worker, then recreate the affected services and verify delivery. Follow [deployment configuration](deployment-configuration.md), including secret handling. To return to a stored relay, remove the environment override and restart with the updated configuration; verify which source is active before relying on it.

Authentication Settings do not configure [electronic signing](configure-signing.md) or [AI providers](configure-analysis.md). Those use their own integration settings.
