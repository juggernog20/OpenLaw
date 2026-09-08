# Set up a new OpenLaw instance

Create your first Administrator account and choose how your team will sign in, receive email, and reach the Business Portal.

## Before you start

An operator must have [installed OpenLaw](install.md) and given you its address. Use the intended public address so emailed links return to the right instance. Have your email relay details ready if the operator has not configured email. For single sign-on, also have your identity provider's OpenID Connect client details.

This version has five welcome steps: Welcome, Authentication, Business-user portal, Outbound email, and Invite your team. Organization identity and module settings are configured afterward in Settings.

## Create the first Administrator

1. Open the instance address. On **Set up OpenLaw**, enter **Name**, **Email**, **Password**, and **Confirm password**.
2. Use at least eight characters for the password and enter the same value in both password fields. Select **Create Administrator**.
3. Correct any validation message and submit again. A successful setup signs you in and opens **Welcome to OpenLaw**.

Account setup is available only while the instance has no users. If setup has already been completed, use **Sign in** or ask an existing Administrator for an invitation. Do not create a new installation to recover an existing account; follow [sign-in recovery](staff-sign-in.md).

## Work through the welcome steps

1. Select **Get started**.
2. In **Authentication**, keep **Built-in sign-in** for email and password, or select **Single sign-on (OIDC)**. For OIDC, register the provider and copy its callback URL into your identity provider's configuration before continuing. See [sign-in configuration](authentication-and-email.md#configure-single-sign-on).
3. In **Business-user portal**, review magic-link sign-in and add each **Allowed email domains** entry using **Add**. Enter a domain such as `helix.example`, without an email username. An empty allowlist admits nobody new. The list also governs each new sign-in link, so narrowing it later affects people who signed in before. See [Portal entry](authentication-and-email.md#control-business-portal-entry) for its exact reach. Continue to save the choices.
4. In **Outbound email**, check whether email is set by the deployment environment. If it is unset, enter **SMTP relay URL** and **From address**, then select **Save relay**. Select **Send test email** and check your inbox before inviting anyone. See [email setup and recovery](authentication-and-email.md#set-up-email-before-finishing-the-wizard).
5. In **Invite your team**, enter each colleague's name and email, select the intended staff role, and send the invitation. You can invite more users later from **Settings → Users**. Finish to enter the app.

Use the step's continue or skip control to move on. Skipping does not supply missing email or identity-provider configuration: finish those settings before relying on the affected sign-in or invitation flow.

## Resume or finish later

Reloading an unfinished wizard returns to its Welcome step. Select **Get started** again; saved settings remain, but unsaved form entries and the current step do not. Check each saved choice before continuing.

On the Welcome step or the final invitation step, **Set up later** ends onboarding and enters the app. On the Authentication, Portal, and Email steps, it skips just that step without saving its unsaved choices. **Finish** on the last step ends onboarding. In this version, completion cannot be undone through the interface and the welcome wizard cannot be reopened. Authentication, domains, and users remain editable in Settings. There is no separate email Settings page in this version; after completion, an operator changes or recovers the relay through the [deployment configuration](deployment-configuration.md).

## Prepare the workspace

Open **Settings → General** to set your organization's name, logo, and default timezone. Follow [organization and user management](organisation-and-users.md), then configure [types, statuses, and Fields](types-statuses-fields.md) and [request forms](request-forms.md).

Before sending the app address to the team, activate a test invitation, check the intended sign-in method, and confirm a Business User can enter with an allowed address. A completed wizard means the setup steps were finished or skipped; it does not certify those later checks.
