# Set up a new OpenLaw instance

Create your first Administrator account. Then use the onboarding wizard to set your organization, sign-in, outbound email, team, and connectors.

## Before you start

An operator must have [installed OpenLaw](install.md) and given you its address. Use the address that people will open in their browsers, so emailed links return to the right instance. This address can be private to your office network or VPN. Setup cannot finish without working outbound email. Have your email relay details ready if the operator has not configured email. For single sign-on, also have your identity provider's OpenID Connect client details. If you will require two-factor authentication, have an authenticator app ready.

This version has nine wizard steps: Welcome to OpenLaw, Your organization, Authentication, Business-user portal, Outbound email, Invite your team, E-signature, AI analysis, and Review. Each step shows its position, for example **Step 2 of 9**.

## Create the first Administrator

1. Open the instance address. On **Set up OpenLaw**, enter **Setup token**, **Name**, **Email**, **Password**, and **Confirm password**. The setup token proves that you, and not another person on the network, claim the first Administrator account. The operator reads it from the app log at first start, or sets it with `SETUP_TOKEN` before the start. Ask the operator for it.
2. Use at least eight characters for the password and enter the same value in both password fields. Select **Create Administrator**.
3. Correct any validation message and submit again. A successful setup signs you in and opens **Welcome to OpenLaw**.

Account setup is available only while the instance has no users. If setup has already been completed, use **Sign in** or ask an existing Administrator for an invitation. Do not create a new installation to recover an existing account. Follow [sign-in recovery](staff-sign-in.md).

## Work through the welcome steps

1. On **Welcome to OpenLaw**, select **Get started**.
2. In **Your organization**, enter **Organization name**. You can select **Upload** to add a PNG, JPEG, WebP, or SVG logo of 5 MB or smaller, and choose a **Default timezone**. **Default locale** offers only English (United States) in this version. Select **Continue** to save. The sign-in pages then show the saved organization name and logo.
3. In **Authentication**, choose how Administrators and Legal Team Members sign in. Turn on one or more of **Email and password**, **Email magic link**, and **Single sign-on (SSO)**. OpenLaw refuses a policy with no sign-in method. The **Single sign-on (SSO)** switch stays unavailable until a provider is registered. To register one, complete **Register your identity provider** and select **Register provider**. Copy the callback URL that OpenLaw shows into your identity provider's configuration. See [sign-in configuration](authentication-and-email.md#configure-single-sign-on).
4. If you turn on **Require two-factor authentication** in **Authentication** and select **Continue**, OpenLaw makes you set up two-factor authentication before you can continue. After setup, the wizard opens again at its Welcome step. Your saved choices remain.
5. In **Business-user portal**, use the same switches to choose the sign-in methods and the two-factor requirement for Business Users. Add each **Allowed email domains** entry using **Add**. Enter a domain such as `helix.example`, without an email username. An empty list prevents new email-based access. The list also governs each new sign-in link, so narrowing it later affects people who signed in before. See [Portal entry](authentication-and-email.md#control-business-portal-entry) for its exact reach. Select **Continue** to save the switches and the list.
6. In **Outbound email**, check the configuration source. If the deployment environment sets email, the step is read-only. If the step says that `SMTP_FROM` is not set, ask the operator to set it. If email is unset, enter **SMTP server**, **Port**, **Connection security**, **Authentication**, and **Sender email**. If **Authentication** is **Username and password**, also enter **SMTP username** and **SMTP password**. You can also enter a **Sender name (optional)**. Then select **Save relay**. For a relay saved in the app, select **Send test email** and check your inbox before inviting anyone. See [email setup and recovery](authentication-and-email.md#set-up-email-before-finishing-the-wizard). This step has no **Set up later**, and **Continue** stays unavailable until email is configured.
7. In **Invite your team**, enter each colleague's **Name** and **Email**. Select **Legal team member** or **Administrator**, then select **Send invite**. You can invite more users later from **Settings → Organization → Users**.
8. In **E-signature**, connect DocuSign, or select **Set up later** to keep the manual signing hand-off. See [Configure the Signing connector](configure-signing.md).
9. In **AI analysis**, connect your AI provider, or select **Set up later**. Without a connector, Contract analysis does not run. See [Configure the AI connector and Field prompts](configure-analysis.md).
10. In **Review**, check the row counts of the seeded lists and the reminder offsets. Matter fields, Contract fields, and Entity fields have separate rows. We recommend that you keep the seeded lists. To change a list, select its name. Settings then shows **Return to setup**, which opens **Review** again. To begin with empty lists instead, select **Start blank**. A dialog names each list and the number of rows it will remove. Select **Start blank** in the dialog to confirm. See [Start blank](#start-blank). Select **Finish** to record the review and enter the app.

On every step except Welcome to OpenLaw and Outbound email, **Set up later** moves on without saving that step's unsaved entries. Skipping does not supply missing identity-provider or connector configuration. Finish those settings before you rely on the affected sign-in, signing, or analysis flow.

## Start blank

**Start blank** on the **Review** step removes the seeded rows that OpenLaw does not need to run. Use it when your organization has its own vocabulary or a bulk import. It removes the rows in one step. The removed rows cannot be restored.

Start blank removes every seeded row from Matter types, Matter statuses, Contract types, Contract statuses, Entity types, Officer roles, Knowledge types, and Request types, except the rows OpenLaw needs. It keeps these rows:

- The **Other** row in Matter types, Contract types, Entity types, and Officer roles.
- The **Open** and **Closed** Matter statuses.
- The **Draft**, **Active**, and **Expired** Contract statuses.
- The default Fields: **Governing law**, **Jurisdiction**, and **Our position**.
- The reminder offsets.

After Start blank, the Contract Stages Review, Approval, and Signature hold no Status, and the Open Category holds only **Open**. Add your own Statuses in Settings. See [Configure Types, Statuses, and Fields](types-statuses-fields.md).

OpenLaw refuses Start blank in three cases. The dialog names the list that blocks it.

- Onboarding is complete.
- A list holds a row that you added. Remove the row first, or keep the seeded lists.
- A seeded row is in use by a record. Move the record first, or keep the seeded lists.

Start blank records the review, so the **Setup checklist** does not show **Review seeded types**. The audit log holds one entry for each emptied list, with the number of rows removed.

## Resume or finish later

Reloading the wizard page keeps the current step, because the step is part of the page address. Saved settings remain, but unsaved form entries do not. Check each saved choice before continuing. Until onboarding is complete, Home opens the wizard again at its Welcome step. While email is not configured, every app page opens the wizard at its Welcome step. Select **Get started** to continue from there.

On the Welcome step, **Skip optional steps** ends onboarding and enters the app. If email is not configured, it opens **Outbound email** instead. **Set up later** on **Review** also ends onboarding, but it does not record the review. **Finish** on Review records the review and ends onboarding. In this version, completion cannot be undone through the interface and the welcome wizard cannot be reopened. Organization details, authentication, domains, users, and both connectors remain editable in Settings. Manage an app-saved relay under **Settings → Advanced → Outbound email**. Deployment-managed relays are changed through the [deployment configuration](deployment-configuration.md).

While a step is still unfinished, **Settings → Organization → General** shows a **Setup checklist** card. Each row links to the Settings page that finishes that step, including **Outbound email**. If you skipped Review, select **Mark as reviewed** on **Review seeded types**.

## Prepare the workspace

Open **Settings → Organization → General** to check your organization's name, logo, and default timezone. Follow [organization and user management](organisation-and-users.md), then configure [types, statuses, and Fields](types-statuses-fields.md) and [request forms](request-forms.md).

Before sending the app address to the team, activate a test invitation, check the intended sign-in method, and confirm a Business User can enter with an allowed address. A completed wizard means the setup steps were finished or skipped. It does not certify those later checks.
