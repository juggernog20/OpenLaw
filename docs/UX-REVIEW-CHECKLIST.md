# OpenLaw UX and functional review

This document is the manual end-to-end walk of the whole product. Blair walks every script in a running build and records what does not fit. It replaces the page-by-page inventory that came before it.

## How to use this document

- Each module below has numbered scripts. Each script is a numbered list of steps a human performs, in order. A step names the actor, the action and what they should see.
- A lettered sub-step (4a, 4b) is a fork. Walk every fork. A step with a quoted label names the exact UI text.
- A "Watch:" line marks something the code audit found half-built or inconsistent. Check it on the walk and record what you see.
- A "Notification:" line names the bell item, email or push that should fire at that step. Keep Mailpit or the relay inbox open beside the app.
- There are no checkboxes. Record feedback by adding a `Note:` line under the step. A script is done when every step has been walked and its notes resolved.
- Terms follow `CONTEXT.md`. Member+ means Administrator plus Legal Team Member. Stakeholder, Watcher and Contributor were removed by DD-023 and appear only in old activity narration.
- Each module's first script is the Administrator setup the later scripts depend on. Walk it first.

## Build basis

Branch `dev` at ee0e6eda on 2026-09-26, plus the uncommitted partial-signing work in the main checkout (migration 0181, the "Partially signed" Status, the new send-dialog question, and per-Version Document delete). Steps that depend on that work are marked WIP. Walk the build you actually run.

## Flagged before the walk

The code audit turned these up. Each is also marked inline with a "Watch:" line. They are listed here because they are product calls, not walk findings.

- Per-Version Document delete in the working tree contradicts DOC-001 and DOC-010, which say a Version is immutable. No UI calls whole-Document erasure any more. Deleting a pinned Version clears the Executed pin silently.
- Partial signing has no decision record and no `CONTEXT.md` entry. Every e2e envelope journey clicks send without answering the new question.
- Decline left the staff Triage menu on 2026-09-05, but the API route, the Portal "Declined" banner and the Inbox Status filter remain.
- Nobody is notified when an Approval request is approved or rejected. A rejected row counts as unresolved for good, even after a re-ask is approved.
- A direct send for signature skips the Soft gate and works from any Stage, pulling an Active or ended Contract back to Signature.
- Matter templates carry no Documents and no default people. Matter types have no Default people. A template cannot be applied to an existing Matter.
- No bell or email fires for Matter team added, Matter Manager assigned, status change, Close, Archive, or a Matter Document upload. Only Contracts notify on Documents.
- The Entity create dialog has no Confidential switch. Grants added through Manage access are logged admin_only and never show in the record History.
- A completed one-off Obligation cannot be reopened. The button says "Mark complete", the calendar says "Filed", ENT-006 says "Mark filed".
- The Auto-Doc Generation email sends a Business User to `/auto-docs/...`, which bounces them to the Portal home. Retry exists only on the Generations tab. Unpublish and Archive have no confirmation.
- The glossary says an Unassigned contract is claimed. The UI says "Assign" and lets anyone pick anyone. The email says "Claim it".
- Archived Knowledge Items vanish from the list with no Show archived. Restore puts a published Everyone Item straight back on the Portal.
- No Administrator action resets another person's lost authenticator, and Profile hides Re-enroll while two-factor is required.
- Archiving a user and revoking an invite act on one click with no reassignment guard, although SET-005 describes one.
- The Audit log Record filter cannot select Knowledge Item or Auto-Doc entries.
- Missing against earlier briefs: Remember me, return-to-page after sign-in, session length and password policy settings, logo or photo removal, a global create button, a System theme option, a density control, bulk actions and a search box on the Contracts and Matters lists, any Counterparty list or record screen.
- The old checklist still says Summary (now Title), "Register entity" (now "Add entity"), Contributor checks, and "Attach field" in the Request type editor (moved to the type Form).

## Contents

- 1. Authentication and first run
  - 1.1 First run on a clean instance, all nine wizard steps
  - 1.2 First run fast path
  - 1.3 Invite activation and TOTP enrolment
  - 1.4 Password sign-in and its failures
  - 1.5 Magic link sign-in
  - 1.6 Forgotten password and password setup
  - 1.7 Single sign-on
  - 1.8 Two-factor required by the organization
  - 1.9 Archived user, revoked sessions, sign out, session expiry
  - 1.10 Business User at the portal door
- 2. Settings, users and organization
  - 2.1 Settings layout and role gates
  - 2.2 General, Setup checklist, Currencies in use
  - 2.3 Users
  - 2.4 Departments and Regions
  - 2.5 Authentication
  - 2.6 Audit log
  - 2.7 Outbound email
  - 2.8 AI analysis
  - 2.9 E-signature
  - 2.10 Advanced settings
  - 2.11 Profile
  - 2.12 View Business Portal and API keys
- 3. Intake, Business Portal and Inbox
  - 3.1 Setup by the Administrator
  - 3.2 A Business User reaches the Portal for the first time
  - 3.3 The Portal home and the Request form
  - 3.4 Legal triages and talks to the Requester
  - 3.5 Disposition: Legal decides what the Request becomes
  - 3.6 Business User works on the record in the Portal
  - 3.7 Legal files thread paper onto the record
  - 3.8 Unassigned contracts from Auto-Docs
  - 3.9 A Business User answers an Approval request in the Portal
  - 3.10 Staff "View as business user"
  - 3.11 Requester notification settings
  - 3.12 Notification summary by step
- 4. Contracts
  - 4.1 Prerequisite setup (Administrator)
  - 4.2 Contracts list, filters and saved views (Legal Team Member)
  - 4.3 Creating a Contract
  - 4.4 Main lifecycle: from a new Contract to Active (Legal, Approvers, Signers)
  - 4.5 E-signature edge paths (Administrator, Legal)
  - 4.6 Term, renewal, Key dates and reminders (Legal)
  - 4.7 Relations, Matter link, comments and History (Legal)
  - 4.8 Confidential, permissions, Ending and Archiving
  - 4.9 Business User and Approver in the Portal
- 5. Matters
  - 5.1 Prerequisite setup by the Administrator
  - 5.2 The Matters list
  - 5.3 Create a Matter directly
  - 5.4 From a Business User's Request to a Matter
  - 5.5 Matter record Overview
  - 5.6 Team applet
  - 5.7 Documents tab
  - 5.8 Key dates, Next deadline and reminders
  - 5.9 Tasks
  - 5.10 Comments, mentions and filing
  - 5.11 History applet
  - 5.12 Closing, reopening, archiving and restore
  - 5.13 Business User in the Portal
  - 5.14 Access and negative checks, in one pass
  - 5.15 Notifications at a glance
- 6. Documents and Knowledge
  - 6.1 Prerequisite setup
  - 6.2 Settings: Document types
  - 6.3 Settings: Knowledge types
  - 6.4 Uploads on a record Documents tab
  - 6.5 Document rows: details, Type, confidentiality, archive, move
  - 6.6 Delete a Version and delete a Document
  - 6.7 Folders on a record
  - 6.8 The shared document reader
  - 6.9 Document Versions, primary, Executed pin
  - 6.10 Comparison
  - 6.11 The Documents destination
  - 6.12 Documents in record creation forms
  - 6.13 The Knowledge destination
  - 6.14 The Knowledge Item record
  - 6.15 Documents on the Portal for a Business User
  - 6.16 Knowledge on the Portal
- 7. Entities
  - 7.1 Prerequisite setup
  - 7.2 Entities destination: Calendar, List and Chart
  - 7.3 Create an Entity
  - 7.4 Entity record Overview: header and Registry card
  - 7.5 Share capital and Currencies in use
  - 7.6 Directors & Officers
  - 7.7 Registrations per jurisdiction
  - 7.8 Confidential and Grants
  - 7.9 Portal-listed Entity and the Business User
  - 7.10 Ownership without a share register
  - 7.11 Share register and cap table
  - 7.12 Share register refusals
  - 7.13 Obligations and the compliance calendar
  - 7.14 Documents tab
  - 7.15 Contracts and Matters tabs
  - 7.16 History
  - 7.17 Archive and restore an Entity
  - 7.18 Settings lifecycle with records in use
  - 7.19 Destination List and Chart in depth
  - 7.20 Cross-surface checks
- 8. Auto-Docs
  - 8.1 Prerequisites
  - 8.2 Legal creates an Auto-Doc and builds the form
  - 8.3 Legal configures Auto-Doc settings
  - 8.4 Publish, Unpublish, Archive, Restore, and erasure
  - 8.5 Legal generates in the app, with no target Contract Type
  - 8.6 A targeted Auto-Doc creates a Contract
  - 8.7 Filing
  - 8.8 The Portal
  - 8.9 Cross-checks after the run
- 9. App shell, Home and Search
  - 9.1 Shell tour for each role
  - 9.2 Keyboard and screen reader
  - 9.3 Mobile shell
  - 9.4 Theme in Appearance
  - 9.5 Errors, not found, help
  - 9.6 Populated Home for an Administrator
  - 9.7 Your Tasks
  - 9.8 Your dates calendar
  - 9.9 Home by role and when empty
  - 9.10 Live updates across two browsers
  - 9.11 Header search
  - 9.12 Results page
  - 9.13 Advanced search with a compound question
  - 9.14 Permission filtering and Recent
- 10. Notifications
  - 10.1 The bell
  - 10.2 Personal notification preferences
  - 10.3 Device notifications
  - 10.4 Organization notifications and reminders
  - 10.5 Emails each actor should receive
- 11. MCP
  - 11.1 Administrator turns MCP on and sets the ceiling
  - 11.2 A Legal Team Member gets an API key and connects a headless Client
  - 11.3 A Business User gets an API key from the Portal
  - 11.4 A Legal Team Member connects a chat Client by OAuth
  - 11.5 Administrator inspects Tool calls
- 12. Cross-cutting
  - 12.1 Managed tables, Columns and Views
  - 12.2 Common states
  - 12.3 Roles as the UI shows them
  - 12.4 Locale and time zone
  - 12.5 Device and input coverage

## 1. Authentication and first run

### 1.1 First run on a clean instance, all nine wizard steps

Actors: Administrator, then Invitee.

1. Administrator opens the root address of instance A while signed out. The app sends them to `/auth/setup`. The card reads "Set up OpenLaw".
   a. Administrator opens `/auth/login` instead. The app still sends them to `/auth/setup`.
   b. Administrator opens `/matters` or `/settings`. The app sends them to `/auth/setup`.
2. Administrator reads the hint: "Create the first Administrator account. This screen disables itself once a user exists."
3. Administrator opens the help icon on "Setup token" and reads where the token comes from, `SETUP_TOKEN` or the server log.
   Watch: the setup token field is required and is not in the product brief. Get the token from the operator before you start.
4. Administrator fills Setup token, Name, Email, Password and Confirm password.
   a. Administrator types two different passwords. The card shows "The passwords do not match." Nothing is sent.
   b. Administrator types a password under 8 characters. The browser refuses the submit.
   c. Administrator types a wrong setup token. The card shows the server's refusal in one sentence.
   d. Administrator types an invalid email. The browser refuses the submit.
5. Administrator presses "Create Administrator". The app signs them in and replaces the page with `/welcome`. Browser Back does not return to setup.
6. Administrator sees "Step 1 of 9", a "Help with this page" link, and the card "Welcome to OpenLaw". The intro says email is required and the other steps can be skipped.
7. Administrator presses "Get started". The URL gains `?step=organization`.
   a. Fork: Administrator presses "Skip optional steps" instead. Go to Script 1.2.
8. Your organization step. Administrator enters Organization name, chooses a logo with Upload, keeps Default locale "English (United States)", and searches for a Default timezone.
   a. Administrator uploads a file that is not PNG, JPEG, WebP or SVG, or is over 5 MB. The step shows "That logo must be a PNG, JPEG, WebP, or SVG image 5 MB or smaller. Pick another file."
   b. Administrator uploads a file the browser cannot read. The step shows "That file could not be read. Pick another one."
9. Administrator presses Continue. The organization saves and the step moves to Authentication.
   a. Administrator presses "Set up later". Nothing saves and the step moves on.
   b. Administrator presses Back. The step returns to the splash.
10. Authentication step. Administrator sees the Legal User switches: "Email and password", "Email magic link", "Single sign-on (SSO)" and "Require two-factor authentication".
    a. SSO is disabled until an identity provider exists. The hint says "Configure an identity provider below to enable single sign-on."
    b. Administrator fills "Register your identity provider": Provider ID, Issuer URL, Email domain, Client ID, Client secret. Administrator presses "Register provider". The step shows "Identity provider {id} is registered." and "Paste this callback URL into your IdP console: {url}". The SSO switch becomes available.
    c. Registration fails because the issuer cannot be discovered. The step shows "The identity provider could not be registered."
    d. Administrator turns every method off and presses Continue. The API refuses with "Enable at least one sign-in method."
11. Administrator presses Continue.
    a. Fork: "Require two-factor authentication" is on. The app saves the policy and goes straight to `/auth/two-factor/enroll`. Do Script 1.3 steps 9 to 13, then press Continue. The app goes to `/`, and Home sends the Administrator back to `/welcome`.
    Watch: after the forced enrolment the wizard reopens at Step 1, not at Authentication. Check that nothing already saved is lost.
12. Business-user portal step. Administrator sets the Business Portal switches, the same four as step 10, then adds allowed email domains with Add or Enter. Each domain appears with a "Remove {domain}" button.
    a. The list is empty. The step shows "No domains allowed yet. Magic-link sign-in is unavailable."
    b. Administrator removes a domain. It leaves the list before save.
13. Administrator presses Continue. Both the policy and the domain list save.
14. Outbound email step. The Administrator sees one of three states.
    a. Set by the environment with a sender. The step says "Outbound email is set by the deployment environment. Mail is sent from {from}."
    b. Set by the environment without `SMTP_FROM`. The step says mail cannot be sent until `SMTP_FROM` is set. Continue stays disabled.
    c. Not set. The step says "Set up outbound email to finish instance setup." and shows SMTP server, Port, Connection security (STARTTLS, TLS, None), Authentication (Username and password, None), SMTP username, SMTP password, Sender name (optional) and Sender email.
15. For state 14c, Administrator fills the relay and presses "Save relay". The step shows "Relay saved. The next email this instance sends will use it."
    a. The relay save fails. The step shows "The relay could not be saved."
16. Administrator presses "Send test email". The step shows "Test email sent to {email}. Check your inbox." Administrator receives "OpenLaw test email".
    a. The relay host is unreachable. The step shows "The test email could not be sent." with the reason from the server.
17. Administrator presses "Replace relay". The form reopens. "Keep current relay" cancels.
18. Administrator presses "Clear relay". The step shows "Relay cleared. This instance can no longer send email." Continue is disabled again. Save the relay again before you go on.
    Watch: "Set up later" is hidden on this step only. Confirm there is no way past Email without a working mailer.
19. Invite your team step. Administrator enters Name and Email, picks Role, and presses "Send invite". The step lists "1 invite sent: {email}".
    a. Only Legal Team Member and Administrator are offered. Business Users cannot be invited here.
    b. Administrator invites an address that already has an active account. The step shows the API's refusal.
    c. Email is not working. The step warns "Without outbound email, invited people will not receive their set-password link." and the API refuses the invite.
20. Invitee receives "Set your OpenLaw password". The link expires in 1 hour. Leave it for Script 1.3.
21. Administrator presses Continue to reach E-signature. The step explains that the manual hand-off stays available.
22. Administrator fills Environment (Demo or Production), Integration key, User ID, RSA private key and Connect HMAC secret. The step shows the Webhook URL to paste into DocuSign Connect.
    a. Administrator leaves Integration key or User ID blank and presses Continue. The step shows "Enter the integration key and the user ID from your DocuSign integration, or choose Set up later."
    b. A connector already exists. The step reads "DocuSign is connected in the demo environment, as integration key {key}." "Replace credentials" reopens the form. "Keep current credentials" closes it.
    Watch: the wizard has no Polling or Webhook choice. A new connector defaults to Polling, but the step labels the Connect HMAC secret "Required" and shows a Webhook URL. Compare with Script 2.9.
23. Administrator presses Continue or "Set up later" to reach AI analysis.
24. AI analysis step. Administrator picks a Provider (Anthropic, OpenAI, Azure OpenAI, Gemini, OpenRouter, Groq, Ollama, Custom endpoint), fills the API key, and picks a Model. Custom endpoint adds Protocol and Base URL. Azure adds Deployment endpoint.
    a. Ollama. The step says "Ollama does not require an API key."
    b. A Saved key exists for this destination. The step shows "Key saved" and "Forget key".
    c. Administrator presses Continue with no model. The step shows "Enter the model to analyze with, or choose Set up later."
25. Administrator presses Continue to reach Review.
26. Review step. Administrator reads the recommendation to keep the seeds, and a table of lists with row counts: Matter types, Matter statuses, Matter fields, Contract types, Contract statuses, Contract fields, Entity types, Entity fields, Director & Officer roles, Knowledge types, Request types and Reminder offsets.
27. Administrator follows a List link. The Settings pane opens with a "Return to setup" link at the top. Administrator presses it and returns to Review.
28. Fork: Administrator presses "Start blank".
    a. A dialog names each list and the rows it will remove, the rows it keeps, and warns the rows cannot be restored. Cancel closes it.
    b. Administrator confirms "Start blank". The step shows "Seeded rows removed. The counts below are current." The counts drop.
    c. On an instance where a list already has a user-created row or a seed row in use, the dialog shows the API's refusal and removes nothing.
29. Administrator presses Finish. The app records the review, completes onboarding and opens Home.
    a. Administrator presses "Set up later" on Review. Onboarding completes without the review mark. The Setup checklist keeps "Review seeded types".
30. Administrator opens `/welcome` again. The app sends them to `/`.
31. Administrator opens Settings > General. Check the Setup checklist against Script 2.2.

### 1.2 First run fast path

Actors: Administrator.

1. On a fresh instance, Administrator completes setup and lands on the splash.
2. Administrator presses "Skip optional steps".
   a. Email is not configured. The wizard opens the Outbound email step instead of finishing.
   b. Email is configured by the environment. The wizard completes onboarding and opens Home.
3. Administrator opens Settings > General. The Setup checklist lists every unfinished step. Authentication never appears.
4. Administrator signs out and back in. Home opens. The wizard does not reopen.
5. A Legal Team Member signs in while onboarding is still open. Home opens for them. Only an Administrator is sent to `/welcome`.

### 1.3 Invite activation and TOTP enrolment

Actors: Administrator, Invitee.

1. Administrator opens Settings > Users and presses "Invite user". A dialog asks for Display name, Email and Role.
2. Administrator picks Legal Team Member and presses "Send invite". The dialog closes. A new row shows status Invited and a dash for Last active.
3. Invitee receives "Set your OpenLaw password". The link carries the token after `#`, not in the query string.
4. Invitee opens the link. `/auth/set-password` shows "Set your password" and "At least 8 characters."
   a. Invitee opens the link with the token removed. The card shows "This link is not valid. Ask for a new invitation or password reset." Both fields and the button are disabled.
   b. Invitee waits more than 1 hour, then submits. The card shows "This link has expired or was already used. Ask for a new one."
   c. Invitee types two different passwords. The card shows "The passwords do not match."
   Watch: an invite link lives only 1 hour, the same as a reset link. Check whether that is long enough for a real invite.
5. Invitee sets a valid password and presses "Set password". The card shows "Password set" and a "Sign in" button.
6. Invitee opens the same link again and submits. The card shows the expired or used message.
7. Invitee presses "Sign in", enters email and password, and lands on Home.
8. Administrator reloads Users. The row shows Active and a recent Last active time.
9. Invitee opens Settings > Profile > "Turn on two-factor". A dialog asks for the password.
   a. Wrong password. The dialog shows "Check your password."
10. Invitee confirms the password. The dialog shows a QR code, the secret for manual entry, and a Code field.
11. Invitee enters a wrong code. The dialog shows "Wrong code. Scan the QR code again and retry."
12. Invitee enters a current code and presses Confirm. The dialog shows backup codes with a Copy button and a note that they show only now.
    a. Invitee presses Copy. The button reads "Copied".
    b. The browser blocks clipboard access. The dialog shows "Could not copy the codes. Copy them manually."
13. Invitee presses Done. Profile now says two-factor is on and offers "Re-enroll" and "Turn off two-factor".
14. Invitee signs out and signs in with the password. The app opens `/auth/two-factor`, "Enter the 6-digit code from your authenticator app."
15. Invitee enters a live code and presses Verify. Home opens.
16. Invitee signs out, signs in, and presses "Use a backup code". The hint changes to "Enter one of your backup codes. Each works once."
17. Invitee enters a backup code and presses Verify. Home opens.
18. Invitee repeats with the same backup code. The page shows "Wrong code. Try again, or restart sign-in."
19. Invitee presses "Use your authenticator app" to switch back, or "Sign out" to restart sign-in.
20. Invitee enters wrong codes until the lock. The page shows "Too many attempts. Wait 15 minutes, then try again."
21. Invitee opens `/auth/two-factor` directly in a fresh browser with no challenge. Any code fails with the same wrong-code text.
22. Invitee uses Profile > "Re-enroll". The dialog asks for the password once, turns the factor off and starts a new enrolment.
    a. Invitee abandons the new enrolment. Profile shows two-factor off and sign-in works with the password alone.
23. Invitee uses Profile > "Turn off two-factor" with the password. Profile shows two-factor off.
24. Administrator opens Settings > Advanced > Audit log. Entries exist for the invite, the enrolment, the re-enrolment and the disable. The sign-in challenge has no entry.

Invite edge paths, Administrator:

25. Administrator presses "Resend the invite to {email}" on an Invited row. The row shows Saved. A new "Set your OpenLaw password" arrives. The old link stops working.
26. Administrator presses "Revoke the invite to {email}". The row leaves the list at once. The emailed link no longer works.
    Watch: Revoke and Resend act on one click, with no confirmation.
27. With email broken, Administrator invites someone. The dialog shows the API detail and no Invited row appears. Resend on an old row shows the same detail beside the row.

### 1.4 Password sign-in and its failures

Actors: Legal Team Member, Administrator.

1. Legal Team Member opens `/auth/login`. The branded card shows the org logo and name, "Legal Portal" and "Powered by OpenLaw". The page renders Light even if the person chose Dark.
2. Legal Team Member enters email and password and presses "Sign in". Home opens.
   Watch: there is no "Remember me" control, and sign-in always lands on Home or the portal. A deep link opened while signed out is not restored after sign-in.
3. Legal Team Member enters a wrong password. The card shows "Check your email and password." The same text shows for an address with no account.
4. Legal Team Member enters a wrong password ten times within 15 minutes. The eleventh attempt, even with the right password, shows "Too many attempts. Wait 15 minutes, then try again."
5. After the window ends, the right password signs in. A correct password clears the count.
6. Legal Team Member opens `/auth/login` while signed in. The app sends them to Home. A Business User is sent to `/portal`.
7. Legal Team Member opens `/portal/login` while signed in. The app sends them to `/portal`.
8. The card offers links under the form depending on the Legal User policy: "Set up or reset your password" when email works, "Email me a sign-in link" when magic link is on, "Continue with single sign-on" when SSO is on.
9. Administrator turns off "Email and password" for Legal Users in Settings > Authentication. A Legal Team Member now sees the SSO or magic-link view first. The password form is reachable only through "Administrator sign-in".
10. The Legal Team Member tries the password form anyway. The card shows "Password sign-in is disabled for this account."
11. An Administrator uses "Administrator sign-in" with a password. The Administrator signs in. Break-glass sign-in stays open for Administrators.
12. Every sign-in method is off for a group, or only magic link is on and email is not configured. The card shows "Sign-in is unavailable. Contact your administrator."

### 1.5 Magic link sign-in

Actors: Business User, Legal Team Member.

1. Business User opens `/portal/login`. The card title reads "Business Portal sign-in".
2. Business User presses "Email me a sign-in link", or sees the magic-link view first. The card reads "Get a sign-in link" and "Enter your work email to get a single-use sign-in link."
3. Business User enters an address on an allowed domain and presses "Send link". The card shows "Check your email" and says the link expires in 5 minutes and works once.
4. Business User receives "Sign in to OpenLaw" and opens the link. A new account is created as a Business User. The portal first run opens.
5. Business User opens the same link again. The app shows `/auth/link-expired?portal=1`, "Sign-in link expired", with an email field to request a fresh link.
6. Business User requests a fresh link from that page. The page confirms and offers "Use a different email".
7. Business User waits more than 5 minutes before opening a link. The same expired page shows.
8. Someone enters an address on a domain that is not allowed. The card shows the same "Check your email" text. No mail is sent and no account is created.
9. Someone requests a fourth link for one address within 15 minutes. The request is refused. Thirty requests from one network address in 15 minutes are also refused.
10. Administrator removes the domain from the allowlist after a link was sent. The Business User opens the link. Sign-in fails.
11. Administrator turns off magic link for the Business Portal. An already-issued link fails. The magic-link option disappears from `/portal/login`.
12. With magic link off and no other method, `/auth/link-expired` shows "Request a new one from the sign-in page." and a "Back to sign-in" button.
13. Legal Team Member uses "Email me a sign-in link" on `/auth/login`. The link keeps their staff role. They land on Home.
    a. Two-factor is required for Legal Users. After the link, the app asks for the authenticator code at `/auth/two-factor`.
14. A sign-in link fails for another reason. The login card shows "This sign-in link could not be used. Request a new link or contact your administrator."

### 1.6 Forgotten password and password setup

Actors: Legal Team Member, Business User.

1. Legal Team Member opens `/auth/login` and presses "Set up or reset your password".
2. Legal Team Member enters their email and presses "Send password setup link". The card shows "If your email address is eligible, a password setup link is on its way. It expires in one hour."
3. Legal Team Member receives "Set your OpenLaw password", sets a new password, and presses "Sign in".
4. Every session that existed before the reset is ended. A second browser that was signed in now lands on sign-in at its next navigation.
5. Legal Team Member presses "Back to sign-in" from the email form and from the confirmation. The first view returns.
6. Someone requests too many links. The card shows "Too many password setup requests. Try again later."
7. Email is not configured. The link to "Set up or reset your password" is absent.
8. A Business User who signed in with magic link uses the same control on `/portal/login`. The email carries a portal set-password link. After "Password set", the "Sign in" button opens `/portal/login`.
9. The Business Portal password switch is turned off after the link was sent. Submitting shows "Password setup is no longer available for this address."

### 1.7 Single sign-on

Actors: Administrator, Legal Team Member, Business User. You need a test OIDC provider.

1. Administrator registers a provider in Settings > Authentication > Identity provider: Provider ID, Issuer URL, Email domain, Client ID, Client secret. Administrator presses "Register provider". The pane shows the callback URL to paste into the provider.
2. Administrator turns on "Single sign-on (SSO)" for Legal Users.
3. Legal Team Member opens `/auth/login`. The card shows "Continue with single sign-on" first.
4. Legal Team Member presses it and completes sign-in at the provider. Home opens. The account keeps its role.
5. Legal Team Member cancels at the provider. The login card shows "Single sign-on failed. Try again."
6. SSO is on but the provider was deleted. The card shows "Single sign-on is not configured yet. Use administrator sign-in."
7. An unknown person on an allowed domain signs in through the provider on the portal side. The account is created as a Business User.
8. Administrator edits the provider. Leaving Client secret blank keeps it. A new value rotates it. "Save provider" saves. A new issuer that cannot be discovered is refused and the old provider stays.
9. SSO is off for the person's group. Signing in through the provider shows a refusal.

### 1.8 Two-factor required by the organization

Actors: Administrator, Legal Team Member.

1. Administrator turns on "Require two-factor authentication" for Legal Users in Settings > Authentication. The hint says users must complete setup before accessing OpenLaw.
2. Legal Team Member without two-factor opens any staff page. The app sends them to `/auth/two-factor/enroll`. The card says "Your organization requires two-factor authentication." and offers "Sign out".
3. Legal Team Member enrols. The last step shows the backup codes and Done. After Done, the "enabled" view shows only Continue. "Turn off two-factor" is gone.
4. Legal Team Member opens Settings > Profile. The two-factor row shows "Required by your organization" and no Re-enroll or Turn off.
5. Legal Team Member signs in by magic link. The app still asks for the second factor.
6. Legal Team Member signs in by SSO. The provider's own policy applies. OpenLaw does not ask again.
7. Business Users are not affected unless the Business Portal switch is on. With it on, a passwordless Business User is sent to enrolment with `?portal=1`, and later magic links ask for a code.
8. Legal Team Member loses the phone and has no backup codes.
   Watch: no Administrator action resets another person's authenticator, and Profile hides Re-enroll while two-factor is required. Record how a locked-out person gets back in. A password reset does not remove the factor.
9. Administrator turns the requirement off. Profile shows Re-enroll and Turn off again.

### 1.9 Archived user, revoked sessions, sign out, session expiry

Actors: Administrator, Legal Team Member, two browsers.

1. Legal Team Member is signed in on browser 1 and browser 2.
2. Legal Team Member opens Profile > Sessions > "Sign out other devices" on browser 1. Browser 2 lands on sign-in at its next navigation. Browser 1 keeps working.
3. Administrator opens Settings > Users, opens "More actions for {email}" on the Legal Team Member row, and chooses "Sign out user". The row shows Saved. Both browsers land on sign-in at their next navigation.
   Watch: a page that stays open does not notice. It shows per-action errors, such as "The server could not be reached. Try again.", until the person navigates. Check what each screen says after a session ends.
4. Legal Team Member signs in again. It works.
5. Administrator presses "Archive {email}" on the row. The status becomes Archived. The row is hidden until "Show archived" is on. All sessions end at once.
   Watch: Archive acts on one click, with no confirmation and no reassignment of owned records, although SET-005 describes a reassignment guard.
6. The archived person tries password sign-in. The card shows "This account has been archived."
7. The archived person tries a magic link. The link does not sign them in.
8. The archived person tries SSO. The provider returns them to a sign-in error.
9. Administrator turns on "Show archived" and presses "Restore {email}". The status returns to Active. The person can sign in again.
10. Administrator tries to archive their own row. The row has no Archive control. The API also refuses "You cannot archive yourself."
11. Legal Team Member opens the user menu and presses "Sign out". The app ends the session, clears browser-local Recent searches, turns off device notifications for this browser, and opens `/auth/login`. Browser Back does not reopen the signed-in page.
12. Business User signs out from the portal. The portal opens `/portal/login`.
13. A session expires by time. The next navigation sends the person to `/auth/login`.
    Watch: no Administrator setting controls session length. The library default applies.

### 1.10 Business User at the portal door

Actors: Business User, Legal Team Member.

1. Business User signs in for the first time. The portal first run opens at `/portal/onboarding`, "Welcome to your Business Portal".
2. Business User sees Step 1 of 5: Department, "Name and photo", Theme, Notifications and "A short tour". Department is required when the Departments list has entries. The others offer Skip. Finish opens the portal home.
3. Business User opens a staff address such as `/`, `/matters`, `/settings/profile` or `/search`. Each one sends them to `/portal`.
4. Business User opens `/help`. The app sends them to `/portal/help`.
5. A Legal Team Member opens `/portal/onboarding`. The app sends them to Settings > Profile.
6. The portal auditor covers the portal after this point.

## 2. Settings, users and organization

### 2.1 Settings layout and role gates

Actors: Administrator, Legal Team Member, Business User.

1. Administrator opens `/settings`. It forwards to Profile.
2. Administrator reads the rail. Personal: Profile, Appearance, Notifications, API keys, View Business Portal. Organization: General, Regions, Departments, Users, Matters, Contracts, Intake, Entities, Knowledge, Documents, Auto-Docs, Notifications, AI analysis, Integrations, MCP, and an Advanced group.
3. Administrator expands Advanced: Outbound email, Authentication, Audit log, Instance, File uploads, Document storage, Document processing, MCP, System status. It opens on its own when one of its panes is active.
   Watch: SET-001 draws a Security group holding Authentication and Audit log. The build files them under Advanced with Outbound email.
4. Legal Team Member opens `/settings`. The rail shows Personal only, including View Business Portal.
5. Legal Team Member types `/settings/users`, `/settings/general` or `/settings/audit-log`. Each sends them to Profile.
6. Business User types `/settings/profile`. The app sends them to `/portal`.
7. A signed-out visitor opens `/settings`. The app sends them to `/auth/login`.

### 2.2 General, Setup checklist, Currencies in use

Actors: Administrator.

1. Administrator opens Settings > General. The "Setup checklist" card shows above Organization while any step is unfinished.
2. The rows are Organization, Business-user portal, Email, Invite your team, E-signature, AI analysis and "Review seeded types". Each row but Review links to its pane.
3. Administrator presses "Mark as reviewed". The row leaves the card.
4. Administrator clears the allowed domain list. The Business-user portal row returns without reopening the wizard.
5. When no step is left, the card is absent.
6. Organization card. Administrator edits Organization name and leaves the field. It saves on blur. An empty name reverts.
7. The new name shows in the sign-in card and in the next email header.
8. Administrator presses Upload and picks a logo. It saves at once and shows in the sign-in card.
   a. A wrong type or a file over 5 MB shows the logo refusal.
   Watch: there is no control to remove a logo once set.
9. Administrator reads Default locale. "English (United States)" is the only choice, with a note.
10. Administrator picks a Default timezone. The help says it is used for the daily digest and date displays until a user signs in.
11. Currencies in use card. Administrator presses "Add new currency", searches by code or name, and picks one. It joins the list.
    a. No match shows "No currencies match your search."
12. Administrator presses "Remove {code}". It leaves the list. Existing record values keep it.
13. Administrator opens a Contract value picker. Only listed currencies show. "Add new currency" in the picker adds one and returns to the unfinished form.
14. With no currencies, the card shows "No currencies added yet."
15. Administrator reloads. Everything holds.

### 2.3 Users

Actors: Administrator, Legal Team Member, Business User.

1. Administrator opens Settings > Users. The table shows User, Email, Role, Department, Status, Last active and Actions. A count reads "N users".
2. Rows show Active, Invited or Archived. Business Users show with role Business User.
3. Administrator presses "Invite user". See Script 1.3 steps 1 and 2.
   a. Administrator enters an invalid email. The browser refuses.
   b. Administrator enters an address that is already active. The dialog shows the API's refusal.
   c. Administrator presses Cancel. Nothing is created.
4. Administrator opens the Role select on a Legal Team Member and picks Administrator. The row shows Saved. The person gains Organization Settings on their next request.
5. Administrator promotes a Business User to Legal Team Member. On the next navigation that person reaches the staff app.
6. Administrator tries to demote the last Administrator. The row shows "You cannot demote the last Administrator."
7. Administrator demotes themself while another Administrator exists. The rail loses Organization on the next navigation.
8. Administrator sets a Department on a row with the Department picker. The row shows Saved. Archived rows have the picker disabled.
9. Administrator uses Resend, Revoke, Archive, "Sign out user" and Restore. See Scripts 1.3 and 1.9.
10. Administrator's own row has a Role select but no row actions.
11. "Show archived" appears only once an archived user exists.
12. Administrator reads the Audit log. Entries exist for each invite, resend, revoke, role change, archive, restore, session revoke and Department change.

### 2.4 Departments and Regions

Actors: Administrator.

1. Administrator opens Settings > Departments. With none live, a note says to add one so Business Users can pick it on Requests and in Portal setup.
2. Administrator presses "Add Department", types a name in "New Department name", and saves. The list stays alphabetical.
3. Administrator renames a Department with "Rename {name}". It moves to its new place in the list.
4. Administrator reads the in-use count, "N references".
5. Administrator presses "Archive {name}". The dialog warns that existing user and Contract references keep it and it leaves every picker. It offers a reassignment select with "No reassignment". "Archive Department" confirms.
6. Administrator turns on "Show archived" and uses "Restore {name}".
7. Administrator checks that an archived Department is gone from the Users picker and the Request form.
8. Repeat steps 2 to 7 in Settings > Regions. Region names are unique without regard to case. A rename updates Contracts and Matters that use it.

### 2.5 Authentication

Actors: Administrator.

1. Administrator opens Settings > Advanced > Authentication. Two groups show: "Legal User Authentication" and "Business Portal Authentication". Each has "Email and password", "Email magic link", "Single sign-on (SSO)" and "Require two-factor authentication".
2. The Legal group note says Administrators keep emergency password sign-in and required two-factor still applies.
3. Administrator flips a switch. It saves at once and shows a status note. Both groups lock while a save runs.
   a. Administrator turns off the last method. The note shows "Enable at least one sign-in method."
   b. SSO without a provider is disabled.
4. Administrator adds an allowed email domain with Add or Enter. Mixed case is stored in lower case.
   a. A duplicate is ignored.
   b. An invalid domain shows the API's refusal and the input stays.
5. Administrator removes a domain with "Remove {domain}".
6. The list is empty. The pane shows "No domains allowed yet. New users must be invited individually." Magic-link sign-in is closed to new addresses.
7. Identity provider card: see Script 1.7 steps 1 and 8.
8. Administrator checks each change on `/auth/login` and `/portal/login` in a private window.
   Watch: this pane has no password policy beyond the 8-character minimum, no session length and no lockout settings. The brief expects them.

### 2.6 Audit log

Actors: Administrator.

1. Administrator opens Settings > Advanced > Audit log. Tabs read "Audit log" and "Tool calls".
2. The table shows When, Person, Event, Record and Audience. Entries read as sentences. A change reads "{label}: {from} → {to}". A restricted audience shows a lock.
3. Administrator filters by Person, Action and Record, and sets From and To.
4. Administrator types in Search. It combines with the filters after a short pause.
5. Administrator presses "Clear filters". The full log returns.
6. Administrator presses "Show older". Older entries load under the same filters.
7. A filter set with no entries shows "No entry matches these filters."
8. The read fails. The pane shows "The audit log could not be read. Change a filter to try again."
9. Administrator presses "Export CSV". The browser downloads the filtered set. A new entry records the export.
10. Administrator checks that entries exist for Contracts, Matters, Documents, Requests, Users, Entities, Knowledge Items, Auto-Docs and settings changes.
    Watch: the Record filter offers Contract, Matter, Document, Request, User, Entity and System only. The log also holds Knowledge Item and Auto-Doc entries, which cannot be filtered and may show a raw type name.
11. Administrator opens a Confidential record's entries while not on its team. They do not show.
12. Tool calls tab: the MCP auditor covers it. Check only that it opens on the last 24 hours and that "Export CSV" works.

### 2.7 Outbound email

Actors: Administrator.

1. Administrator opens Settings > Advanced > Outbound email.
2. Environment-managed state. The pane says it is managed by the deployment and shows "Sender: {from}". Only "Send test email" is offered.
3. Environment set without `SMTP_FROM`. The pane shows that mail cannot be sent.
4. App-managed state. The pane shows the sender, "Send test email" and "Replace relay".
5. Administrator presses "Replace relay", fills the fields from Script 1.1 step 14c, and presses "Save relay". The pane shows "Relay saved. The next email this instance sends will use it."
   a. "Cancel" closes the form without saving.
6. Administrator presses "Send test email". The pane shows "Test email sent to {email}. Check your inbox."
7. Administrator saves a relay with a host that does not answer, then presses "Send test email". The pane shows "The test email could not be sent." with the reason.
8. Unset state. The form shows first.
   Watch: this pane has no "Clear relay". Only the wizard can clear an app relay.

### 2.8 AI analysis

Actors: Administrator. You need a working provider key, or Ollama.

1. Administrator opens Settings > AI analysis. Four cards start collapsed: Provider, Request conversion, Answer style, and the prompt cards. Request conversion shows only once a connector is saved.
2. Administrator expands Provider. The status reads "Not connected", "Connected" or "Turned off".
3. Administrator picks a Provider. A provider with a Saved key shows "(key saved)".
4. Administrator fills the API key. The hint says the key is write-only and encrypted.
   a. A Saved key exists. The field shows "Key saved" or "Key in use", and the hint says to leave it blank to use it.
   b. Administrator presses "Forget key" and confirms "Forget the Saved key". The pill goes. "Key in use" offers no Forget key.
5. Administrator presses "Load models". The list shows "Loading models…", then the models. Typing narrows it. Arrow keys and Enter pick one.
   a. Loading fails. The pane shows "Models could not be loaded. Try again or enter the model ID manually."
   b. Administrator uses "Enter model ID manually", then "Choose from list" to go back.
   c. After a reload, the saved model is missing from the list. The pane says it is kept until another is chosen.
   d. "Refresh models" re-reads the list.
6. Administrator sets "Output token limit per API call". A low value shows a warning about incomplete responses.
7. Administrator presses "Save connector". The card shows Connected.
8. Administrator presses "Test connection". The pane shows "Testing the connection…", then "Connection successful."
   a. A wrong key. The pane shows "The connection test failed. Check the connector and try again."
9. Administrator turns off "Use AI analysis". The status reads "Off since {when}". Contract analysis controls disappear from records. Turn it back on.
10. Request conversion card: "Prepare Matter conversions with AI", "Prepare Contract conversions with AI" and "Fill Contract Fields after conversion". Each saves at once.
11. Answer style card: "Few word summary", "1-2 sentence summary" and "Full clause text". A pick saves at once. With no connector, the card says "Connect an AI provider to choose an answer style."
12. Prompt cards: Conversion draft prompts and Contract analysis prompts. Administrator edits a prompt and saves. "Reset {label} to default" restores it. A link points to Contracts > Fields for custom Field prompts.
13. Administrator presses "Remove connector" and confirms "Remove the AI connector". The dialog says Saved keys stay on file. The status becomes Not connected. Cancel keeps it.

### 2.9 E-signature

Actors: Administrator. You need a DocuSign demo account or the signing stand-in.

1. Administrator opens Settings > Integrations. The E-signature tab opens. The DocuSign card shows "Not connected", "Connected" or "Turned off".
2. Administrator expands DocuSign and picks Environment, Demo or Production. Administrator fills Integration key, User ID and RSA private key.
3. Administrator picks "Signing updates": Polling or Webhook. Each option explains itself.
   a. Webhook adds "Connect HMAC secret" and "Public callback URL". The Webhook URL shows with Copy. Copy changes to "Copied".
4. Administrator presses "Save connector".
   a. Missing or wrong values show the API's refusal.
5. Administrator presses "Test connection". The pane shows "Testing the connection…", then "Connected to {account}."
   a. Wrong credentials. The pane shows "The connection test failed. Check the credentials and try again."
6. Administrator edits the connector. Leaving a secret blank keeps it. A new value rotates it.
7. Administrator turns off "Send for signature from records". The status reads "Off since {when}". New preparations and Resume links are refused. Outcomes still arrive.
8. Administrator opens a Contract. Signing controls are hidden or refused, and the manual hand-off still works.
9. Administrator presses "Remove connector". The dialog says the RSA key and the Connect secret are deleted. Cancel keeps it.
   a. Live Envelopes exist. Removal and account changes are refused, with the reason.
10. The Contracts auditor covers sending itself.

### 2.10 Advanced settings

Actors: Administrator.

1. Administrator opens Advanced > Instance. The pane shows "Application address" and "Instance address", with Current, Saved in OpenLaw and Default columns.
2. A value set by the deployment shows "Deployment configuration" and is read only.
3. Administrator changes a value that is not pinned and presses Save. The pane shows "Settings saved. Restart the API and worker to apply changes." and a "Restart required" note.
   a. An `http` endpoint that is not local or private is refused.
   b. A different value for a pinned key is refused.
4. Advanced > File uploads: "Maximum file size (MiB)". Save and upload a file over the old limit after restart.
5. Advanced > Document storage: "Store new documents in" Local filesystem, S3-compatible storage or Azure Blob Storage, with their fields. "Test connection" shows "Connection test passed." or "The connection test failed."
6. Advanced > Document processing: "Document service address", "Processing timeout" and "Comparison timeout". Test connection as above.
7. Advanced > MCP: "Calls per hour per credential" and "OAuth grant lifetime (days)". The MCP auditor covers the effect.
8. Advanced > System status: Database, API and Worker rows with Status and Last seen. A missing heartbeat shows "No recent heartbeat" and a warning. Refresh re-reads.
   Watch: there is no data retention, export or feature flag setting. The brief expects some.

### 2.11 Profile

Actors: Legal Team Member.

1. Legal Team Member opens Settings > Profile. Cards: Profile, Password & two-factor, Sessions.
2. Legal Team Member presses Upload under "Profile photo" and picks a JPG or PNG. The photo is resized and saved. The avatar changes in the header.
   a. A wrong type shows "Choose a JPG or PNG photo."
   b. Over 10 MB shows "Choose a photo smaller than 10 MB."
   c. An unreadable file shows "This photo could not be read. Try another JPG or PNG."
   Watch: there is no control to remove a photo. The portal first run has "Remove photo".
3. Legal Team Member edits Full name and leaves the field. It saves. An empty name is refused.
4. Email and Role are read only. The Role note reads "Roles are managed in Organization → Users."
5. Legal Team Member picks a Timezone. Dates across the app follow it after the save.
6. Legal Team Member presses "Change password". The dialog asks for Current password and New password and warns that saving signs out other devices.
   a. A wrong current password shows "Check your password."
   b. Cancel closes the dialog.
7. Legal Team Member saves. Other browsers land on sign-in at their next navigation. The card shows "Last changed {date}."
8. Two-factor: see Script 1.3 steps 9 to 13 and 22 to 23, and Script 1.8 step 4.
9. Sessions: "Sign out other devices". See Script 1.9 step 2.
10. A Legal Team Member who only uses magic link or SSO opens Profile. The Password & two-factor card is absent.
    Watch: that person cannot add a password or two-factor from Profile. The only way is "Set up or reset your password" on the sign-in page.

### 2.12 View Business Portal and API keys

Actors: Legal Team Member, Administrator.

1. Legal Team Member opens Settings > View Business Portal. The page explains that the portal shows their own Requests and that submissions are real.
2. Legal Team Member presses "View as business user". `/portal` opens with a "Viewing as business user" notice and "Return to legal view".
3. Legal Team Member reloads a portal page. The notice stays.
4. Legal Team Member presses "Return to legal view". Settings > View Business Portal opens.
5. A Business User never sees the notice or the control.
6. Legal Team Member opens Settings > API keys. The MCP auditor covers the request form, the key list and Connected Clients. Check only that the pane opens and that a Business User is sent to `/portal/settings/api-keys`.

## 3. Intake, Business Portal and Inbox

Scope: Request types, type Forms (Rows, Branches, Touchpoints), Deflection links, Portal entry and first run, the Portal home, the Request form, Request detail, Portal records and lists, Portal approvals, the Inbox and triage, "View as business user", and the notifications each actor receives.

Terms follow CONTEXT.md. Where a UI string holds an em dash, this file writes it as —. Member+ means Administrators and Legal Team Members. The Requester reads the status words Open, Read, In progress, Resolved and Declined. Staff read New, Read, Converted, Resolved and Declined. Quoted labels are the English strings in the code.

### 3.1 Setup by the Administrator

Actors: Administrator. A Legal Team Member for the negative checks.

1. Administrator opens Settings from the avatar menu. The app lands on Settings > Profile.
2. Administrator opens Settings > Organization > Security > Authentication. They find the "Business Portal Authentication" card.
3. Administrator turns on the "Email magic link" method for the Business Portal.
4. Administrator types a domain under "Allowed email domains" and clicks "Add". The domain appears in the list.
   4a. With no domains, the card says "No domains allowed yet. New users must be invited individually."
   4b. Administrator clicks "Remove {domain}". The domain leaves the list.
5. Administrator confirms outbound email works (Settings > Advanced > Outbound email). Without it the Portal cannot send sign-in links (Script 3.2, step 4c).
6. Administrator checks that Settings > Organization > Departments has at least one live Department.
   Watch: a Department is required on a Request only while one live Department exists. With none, the form says "No Departments are configured. You can submit without one; an Administrator can add Departments in Settings." and the Request saves with no Department.
7. Administrator opens an operating Entity at /entities/:id. In the "Portal" card they turn on the "Portal-listed" switch. The help reads "Business Users can pick this Entity by name on Portal forms."
   7a. Administrator creates a new Entity on /entities. The create dialog also shows the Portal-listed switch.
   7b. Administrator shows the "Portal-listed" column (Yes or No) in the Entities registry.
   7c. Administrator opens an archived Entity. The switch is disabled with "Archived Entities stay out of Portal pickers."
   7d. Administrator opens a Confidential Entity that is not listed. The switch is disabled with "Confidential Entities stay out of Portal pickers." A direct API call is refused with "A Confidential Entity cannot be Portal-listed."
   7e. Legal Team Member opens the same Entity. The switch is disabled with "Only an Administrator can change Portal-listed."
   Watch: marking a listed Entity Confidential does not clear Portal-listed. The switch stays on beside the Confidential help. It can be turned off but not back on. The Portal still hides the Entity.
8. Administrator opens "Intake" in the Settings rail. /settings/intake redirects to /settings/intake/request-types. The section shows tabs "Request types" and "Deflection links".
9. Administrator reads the "Request types" card. The count reads "{n} types". Columns are "Request type" and "Destination". A Destination cell reads "Contract · {type}" or "Matter · {type}", or "Default" when no type is named.
   Watch: the Destination cell shows an archived target type by its plain name, with no archived marker.
10. Administrator clicks "Add request type". An inline row opens with the "New request type name" box, "Save" (disabled while blank) and "Cancel".
11. Administrator types a name and clicks "Save". The row appears at once with the destination "Matter · Default".
    11a. Administrator saves a blank name. The row just closes.
    11b. Administrator saves a name that already exists. It is accepted.
    Watch: duplicate request type names are allowed.
    Watch: every new type defaults to Matter and the Default type. An Administrator who wants a Contract form must change it in the editor.
12. Administrator clicks the name ("Rename {name}"), edits it and presses Enter. They rename again and press Escape. The old name stays. A blank or unchanged name reverts.
13. Administrator drags a row by its grip. Then they focus a grip and use the arrow keys. The screen reader hears "{name} moved to position {p} of {total}." The order persists and shows on the Portal picker.
14. Administrator clicks "Edit {name}". The editor opens at /settings/intake/request-types/:typeId, with the back link "All request types".
15. Administrator edits "Display name" and "Description". Enter or blur saves, Escape reverts. The status note shows "Saving…" then "Saved".
16. Administrator sets "Target turnaround (business days)" to 5. The Portal picker later shows "Estimated turnaround: 5 business days".
    16a. Administrator enters 40000 or 1.5. The box says "Enter a whole number from 0 to 36,500 business days, or leave it blank."
    16b. Administrator clears the box. No turnaround shows on the Portal.
    Watch: the UI counts business days (Monday to Friday). The INT-003 addendum of 2026-09-10 says calendar days. Its help text also mentions "saved Request estimates", which the 2026-09-13 addendum removed.
17. Administrator sets "Default destination" to Contract. The help reads "Suggests where Legal converts this request. Legal can choose a different destination during triage." The second select becomes "Default contract type". Its first option is "Default".
18. Administrator picks the NDA type in "Default contract type".
    18a. Administrator switches to Matter. The Intake form card changes to the Matter Form's Rows. The "Edit form" link now points at the Matter type.
    18b. Administrator switches back to Contract and NDA. The NDA Rows return.
    18c. An Administrator archives the NDA contract type elsewhere, then reopens this editor. The select shows a disabled "{name} (unavailable)" option. Conversion treats the type as module only.
    18d. A direct API call with no module is refused with "A Request type needs a destination module. Pick Matter or Contract." One with an archived or wrong-module type is refused with "The target must be a live contract type."
    Watch: a change made while a save is running is dropped and the select snaps back without a message.
    Watch: if the module has no Default type or the saved target was deleted, the Intake form card shows its read error. "Retry" can never succeed and "Edit form" disappears.
19. Administrator reads the "Intake form" card. It names the destination type. It lists "Title" (Required), "Department" (Required), "Urgency" (Required), the Intake Rows in Form order with any Branch caption such as "Show when all of: Term type is Fixed", each marked "Required" or "Optional", and "Attachments" (Optional) last.
    19a. While it loads the card says "Loading Intake form…". If it fails it says "The Intake form could not be read." with "Retry".
20. Administrator clicks the eye button "Preview intake form". The dialog "Preview intake form" says "Preview only. No Request will be sent."
    20a. When more than one request type uses this Form, a "Request type" picker appears.
    20b. Administrator clicks "Submit request" with blanks. Each box shows "{field} is required."
    20c. Administrator fills the preview and submits. It says "Preview complete. No Request was sent". They click "Close".
    Watch: the fixed Urgency row says Required but the preview draws Urgency without a required mark.
21. Administrator opens an archived request type's editor by URL. It opens and can be edited with no archived banner.
    Watch: archived request types stay fully editable and the API accepts the edits.
22. Administrator clicks "Edit form". The app opens /settings/contracts/types/:id/form. The type tabs are "Details", "Form", "People" and "Approval defaults" (Matter types have "Details" and "Form"). The back link is "All types".
23. Administrator reads the Form. Headers are "Row", "On intake form", "Required for creation", "Visible on Portal" and "Touchpoint". Title and Type are pinned at the top with a lock ("Position and switches are fixed").
24. Administrator reads the built-in Rows (subtitle "Built-in"). Contract built-ins are Description, Entity, Counterparties, Department, Region, Priority, Risk, Term type, Effective date, Expiry date, Renewal period, Notice period, Value and Needed by. Matter built-ins are Description, Department, Region, Priority, Risk and Needed by. Their Visible on Portal shows a lock and "Fixed".
25. Administrator opens "Attach Field". They search with "Search fields" and pick a Field. A Row appears with the Field type as its subtitle.
    25a. With nothing to attach, the menu says "All Fields are attached" or "No Fields match".
    25b. Administrator clicks "Create Field" and makes a new catalog Field from the builder.
    25c. Administrator opens "Actions for {row}" > "Edit Field" and edits the Field.
    25d. Administrator clicks "Detach {row}". The Row goes at once. The Field and stored values stay in the catalog.
26. Administrator turns on "{Field}: On intake form". "Visible on Portal" turns on and locks with "Turn off On intake form first". Touchpoint reads Intake.
27. Administrator turns on "Required for creation" on a Row not on intake. Touchpoint reads Creation. With both off it reads Record.
    27a. Administrator attaches a User Field and turns on On intake form. Required for creation locks with "Required for creation is unavailable for {row} while it is on the intake form".
    27b. With Required for creation on first, On intake form locks with "Turn off Required for creation first".
    27c. An Entity Row may be both On intake form and Required.
28. Administrator clicks "Add condition". A Branch appears with the caption "Add a condition". The conditions editor opens.
29. Administrator picks "Row" = Term type, "Operator" = is, and "Value" = Fixed.
    29a. Only Rows above the Branch are offered. With none, the hint says "Add a Row above this Branch first".
    29b. For a number, money or date Row the operator list adds "is greater than" and "is less than". A money value is entered in minor units, with the hint "Enter minor units. For example, 5,000 JPY or 50 USD is 5,000 minor units."
    29c. Administrator clicks "Add another condition". The first time, it asks "Join the next condition with" AND or OR. Later conditions show the "Join conditions" select.
    29d. Administrator removes a condition with "Remove condition {n}".
    29e. Administrator presses Escape. A new Branch is dropped, an edited one returns to its saved state.
    29f. While a Branch has no complete condition, "Add condition" is disabled with "Complete the Branch condition first".
30. Administrator opens the grip menu on Expiry date and chooses "Put under a condition…". They pick the Branch in the dialog. Disallowed destinations are disabled with the reason.
31. Administrator repeats step 30 for Governing law. The Branch caption reads "Show when all of: Term type is Fixed".
    31a. Administrator chooses "Move out of the condition". At the root the item reads "Already at the root".
    31b. Administrator moves Term type below the Branch. The builder refuses with "Keep {row} above the Branch that uses it".
    31c. Administrator detaches Term type while the Branch uses it. The builder refuses with "Used by a Branch condition. Change the condition first".
    31d. Administrator uses "Add condition inside" to nest a Branch. They use "Add field into condition" in a Branch footer.
    31e. Administrator chooses "Remove condition" on the Branch menu. The Branch goes and its children stay in place, with no confirmation.
    31f. A failed save reverts the whole tree. "Retry condition change" appears after a failed condition save. After a Field is created but not attached, the footer says "{field} was created but could not be attached. Retry attachment."
    Watch: "Add condition", "Add condition inside" and "Remove condition" act on Branches, not on single conditions. The words read as if they add or remove one condition.
32. Administrator clicks "Preview intake form" in the builder. The same preview opens.
    32a. While the tree has a refusal, the button is disabled with no reason.
33. Administrator returns to the Request type editor. The Intake form card shows the new Rows and the Branch caption.
34. Administrator opens the "Deflection links" tab (/settings/intake/links). The help reads 'Shown under "Before you submit…" on the portal home. Links assigned to a request type show on that form instead.'
35. Administrator clicks "Add link". The dialog has "Target" (External address or Knowledge item), "Address", "Label" and "Placement".
36. Administrator picks External address, enters an https Address and a Label, sets Placement to the new request type, and clicks "Add link". The row shows the label, the address without its scheme, and a placement chip.
    36a. Administrator saves with no Label. The dialog says "Name the link."
    36b. Administrator enters "mailto:x" or "www.example.com". The dialog says "Enter a full web address that starts with http:// or https://."
    36c. Administrator picks Knowledge item and chooses nothing. The dialog says "Choose a Knowledge Item."
    36d. Administrator picks a Knowledge item. The picker offers only published, portal-readable, live items. The Label fills with the item title if it was empty.
    36e. Administrator sets Placement to "Portal home".
    36f. Administrator clicks "Cancel". Nothing saves.
37. Administrator clicks "Edit {name}", changes label, target and placement, and clicks "Save". An edit with no changes just closes.
    37a. Administrator tries to move a link onto an archived request type. The API refuses with "This request type is archived. Place the link on a live one, or on the portal home."
38. Administrator reorders links by grip drag and arrow keys.
39. Administrator clicks "Remove {name}". The link is deleted at once.
    Watch: there is no confirmation on Remove, although the help says removal is permanent.
40. Administrator unpublishes a Knowledge item that a link targets. The link disappears from the Portal but stays in Settings with the old title.
    Watch: the Settings row gives no hint that the link is hidden on the Portal.
41. Administrator reloads each Intake page. Every change is still there. There is no publish step.
42. Administrator clicks "Archive {name}" on a request type.
    42a. Unused type: the dialog says "{name} is not used by any requests" and "Archive type" works.
    42b. Used type: the dialog asks for a replacement in "Reassign # requests to". "Archive type" stays disabled until one is chosen. Those Requests move to it.
    42c. Used type with no other live type: "No other active type can take its requests. Add or restore another type first." The button stays disabled.
    42d. The note reads "The change applies immediately and is recorded in the audit log."
43. Administrator turns on "Show archived". The archived row shows "Archived" and "Restore {name}". Restoring adds it at the end of the order.
44. A requester opens the archived form's bookmark. The Portal sends them to /portal. The type is gone from the picker. Its per-type deflection links stop showing.
    Watch: an API DELETE for request types exists with no UI. It would remove the type's deflection links by cascade.
45. Legal Team Member opens Settings. The Organization group and the Intake entry are absent.
    45a. Legal Team Member opens /settings/intake/request-types and /settings/intake/links by URL. Each lands on /settings/profile.
    45b. The API refuses a Legal Team Member with "You do not have permission to perform this action."

### 3.2 A Business User reaches the Portal for the first time

Actors: new Business User on an allowlisted domain.

1. Business User opens /portal/enter. The app redirects to /portal/login.
2. Business User sees "Business Portal sign-in". It offers "Continue with single sign-on" when SSO is set, "Email me a sign-in link", and password sign-in when enabled.
3. Business User clicks "Email me a sign-in link". The heading becomes "Get a sign-in link".
4. Business User enters their Email and clicks "Send link". The card says "Check your email" and "If {email} is eligible, a sign-in link is on its way. It expires in 5 minutes and works once."
   4a. An address on a non-allowlisted domain gets the same screen and no email.
   4b. An archived account gets the same screen and no email.
   4c. With outbound email not set up, the send is refused with "Sign-in links are unavailable: this instance cannot send email. Contact your administrator." The sign-in card also hides the magic-link option.
   4d. With magic link turned off, the request is refused with "Magic-link sign-in is disabled."
   4e. Business User clicks "Back to sign-in" and uses another address.
5. Business User opens the link from the email.
   5a. Business User opens the same link again, or after 5 minutes. The app opens /auth/link-expired?portal=1 titled "Sign-in link expired". It says "The link has expired or was already used. Enter your email to get a fresh one." They enter "Email" and click "Send link". The confirmation offers "Use a different email". A failed send says "The link could not be sent. Try again."
   5b. With magic link off or no email, the page says "The link has expired or was already used. Request a new one from the sign-in page." with "Back to sign-in" to /portal/login.
6. The link creates the Business User and signs them in. The app lands on /portal/onboarding.
7. Business User sees "Welcome to your Business Portal", "Set up your profile and choose how you'd like to work with Legal." and "Step 1 of 5". The header has only the brand and "Sign out". The step is "Department", with "Choose the Department you work in. Legal uses this to share the right Auto-Docs with you." "Back" and "Continue" are disabled and there is no "Skip".
   7a. With no live Departments the Department step is absent and the run has 4 steps.
8. Business User picks a Department in "Choose your Department". It saves at once. "Continue" enables. They click it.
9. Business User sees "Name and photo" (Step 2 of 5). They use "Choose photo" (PNG or JPG, up to 1 MB), "Remove photo" and "Full name", or click "Skip".
   9a. A large or wrong file says "Choose a PNG or JPG photo no larger than 1 MB."
   9b. Business User clicks "Back" and returns to the Department step.
10. Business User sees "Theme" (Step 3 of 5). They pick Light, Warm or Dark, or click "Skip".
11. Business User sees "Notifications" (Step 4 of 5). The grid has In-app and Email only. They set channels or click "Skip".
12. Business User sees "A short tour" (Step 5 of 5). It describes Requests, Contracts, Matters and "Auto-Docs". They click "Finish". The app lands on /portal.
    12e. An Administrator archives the chosen Department before Finish. Finish says "Choose a live Department before finishing your first run." and returns to the Department step.
    Watch: "Skip" and "Continue" do the same thing. Skip keeps what was already saved, and Skip on the tour step completes onboarding.
    12a. Business User types /portal/contracts before finishing. The app returns them to /portal/onboarding.
    12b. Business User clicks "Sign out". The app lands on /portal/login. They sign in again and land on /portal.
    12c. Business User types /portal/onboarding after finishing. The app redirects to /portal.
    12d. Member+ staff who visit the Portal never see onboarding. Staff who type /portal/onboarding land on /settings/profile.
13. Business User types /inbox, /contracts, /search and /settings. Each ends at /portal. /settings/api-keys ends at /portal/settings/api-keys.
14. Business User types /portal/nothing. The Portal's own not-found page shows in Portal chrome with "Back to the portal".
15. Business User opens the "Help" link in the header. It opens /portal/help, which the onboarding gate also covers.

Watch: /portal/enter is only a redirect. The old checklist treats it as a page with its own form.
Watch: consent.tsx is /auth/consent, the MCP OAuth consent card (DD-029). It is not a Portal step. It sends a signed-out Business User to /auth/login, not /portal/login. The only Portal acknowledgement is per Auto-Doc ("I acknowledge this statement.", "Acknowledge and continue").

### 3.3 The Portal home and the Request form

Actors: Business User (Requester). Member+ receive notifications.

1. Business User opens /portal. The heading is "What do you need from Legal?" with "Help with this page". The header shows the brand ("Legal portal"), "Help", the theme menu, the bell, the "Notification settings" gear, their avatar and "Sign out".
   1a. If a home read fails, the page shows the route error "The portal home could not be read."
2. Business User reads the Portal navigation: "Requests", "Approvals", "Contracts", "Matters" and "Auto-Docs".
3. Business User opens the theme menu ("Theme: {theme}") and picks Light, Warm and Dark. The page changes at once and keeps the choice after a new sign-in.
   3a. If the save fails, the old theme returns with "The theme could not be saved. Please choose it again to retry."
4. Business User reads the "Request types" list. Each entry shows its description and "Estimated turnaround: {n} business days" when set.
   4a. With no live types the list says "No request types are available yet. Ask your legal team to open one."
5. Business User reads the "Before you submit" panel with home links, by label only.
   5a. Business User clicks an external link. It opens in a new tab and says "(opens in a new tab)" to screen readers.
   5b. Business User clicks a Knowledge link. The article opens in the same tab at /portal/knowledge/:id. It shows "From Legal", "Guidance", and "Documents" with "Download {filename}". "Your requests" returns home.
   5c. Business User opens a Knowledge link whose item was unpublished. The Portal returns them to /portal.
   5d. With no home links, the panel is absent.
6. Business User reads "Your requests" ("{n} requests"). Each row shows the R-number, title, type and date, "Legal Owner: {name}" or "Not assigned yet", and a pill (Open, Read, In progress, Resolved, Declined). A first-time user sees "You have not asked Legal for anything yet."
   Watch: INT-001 says the empty list points at the picker. It has no link or button.
7. Business User picks the NDA request type. The URL becomes /portal/new/{slug}. The page title is "New request" and the heading is the type name, with "All request types" to go back.
   7a. Business User opens /portal/new/unknown-slug or an archived slug. The Portal returns them to /portal.
8. Business User reads the "About your request" card. The order is "Title" (placeholder "Enter a descriptive title for your request"), "Department" (prefilled from their profile, placeholder "Choose a Department", editable per Request), "Urgency" (Low, Medium default, High, Critical), the Intake Rows, then "Attachments" ("Drop up to 20 files related to your request here.", "Choose files"). The footer says "You'll get email updates and can track progress here."
   8a. Description is not a fixed basic. It shows only while the Form's Description Row is On intake form, which is the default.
   8b. Department, Region and owning department Rows are selects with "Not set". A Boolean Row is a Yes or No select. A multi-select with no options says "This field has no options yet."
   8c. A Value Row asks Amount, Currency and Frequency (One time, Monthly, Annually). It refuses with "Enter the amount as a number." and "Pick a currency for the amount."
9. Business User reads the per-type "Before you submit" links above the form and follows one.
10. Business User clicks "Submit request" with nothing filled. An alert names every gap at once, "Fill {fields} first — the form requires them." Each empty box shows "{Label} is required." Required boxes carry a red star.
11. Business User fills Title and Description and picks Urgency High.
12. Business User sets "Term type" to Fixed. "Expiry date" and "Governing law" appear.
    12a. Business User submits without Expiry date. The box says "Expiry date is required."
    12b. Business User types Governing law, then sets Term type to Evergreen. Governing law hides. They set Fixed again. The typed value returns.
    12c. A Row under a false Branch is not collected and not enforced.
13. Business User opens an Entity picker. Only Portal-listed, non-Confidential, live Entities appear, by name.
    13a. A required Entity Row left empty is refused by name.
    13b. A stale or unlisted Entity is refused with "{field}: choose a Portal-listed Entity from the list."
14. Business User types in the Counterparties Row ("Find or create a counterparty"). It searches registry names ("Searching…"). The first pick is marked "Primary". They remove one with "Remove {name}". The picker disables at 50.
    14a. The search fails. It says "Could not load counterparties. Try searching again." With nothing to add it says "No counterparties to add."
    14b. Business User clicks 'Add new "{name}"' for a name that is not in the registry, then submits.
    Watch: the picker offers to create a new counterparty, but the API refuses picks outside the registry with "Counterparties: pick from the registry." Check which one is meant.
    14c. More than 50 is refused with "Counterparties: select up to 50 registry entries."
15. Business User types letters into a number Row. Only that box is marked with "{fieldName}: enter this as a number."
16. Business User reads a user-type Row. It shows only "Not set", with no directory. The Form builder never lets it be required on intake.
    16a. A stray answer to a Row the form does not show is refused with "That Row is not on the visible Request form."
17. Business User chooses files. Each shows "Remove {filename}". They remove one.
    17a. Business User picks more than 20 files. The form says "A request carries at most 20 files."
    17b. A file over the upload size limit is refused with the shared upload message.
18. Business User clicks "Submit request". The page says "Thanks! Your request has been submitted to legal." and "You can track your open requests through this portal", with "Open request" and "Back to the portal".
19. The page shows "Attaching your files…" while files upload one by one after the Request exists.
    19a. A file fails. The page says "This file did not attach. Add it to a reply on R-{n}." with a link to the composer, and names the file with the reason.
    19b. If the thread link is not available, the page says "This file did not attach. Quote R-{n} and send it to Legal another way."
    19c. Uploading more than 256 MB of attachments in one hour is refused with "Your attachments in the last hour have reached the 256 MB limit. Wait before attaching more."
20. Business User submits a 21st Request within one hour. The API refuses with "You have submitted 20 Requests in the last hour. Wait before submitting another."
21. A request type archived while the form is open is refused on submit with "That request type is not taking submissions."
22. Business User receives the receipt. The bell says "Legal has received your request R-{n}". The email subject is "We have your request: R-{n} · {title}" with "View request".
23. Every other live Member+ gets a bell item "{requester} submitted a new request: R-{n}" linking to /inbox/{n}. Email for this group ("New requests") is off by default. With it on, the subject is "New request: …" with "Triage request".
24. Business User clicks "Back to the portal". "Your requests" shows the Request with its type name, the pill "Open", and "Not assigned yet".

Watch: the old checklist calls the first field Summary. It is Title since INT-009.
Watch: no request type is backed by an Auto-Doc. Auto-Docs have their own Portal entry under "Auto-Docs".

### 3.4 Legal triages and talks to the Requester

Actors: Legal Team Member (triager), Administrator, Business User (Requester).

1. Legal Team Member opens "Inbox" from the Primary navigation (/inbox). The sub-bar reads "Inbox" and "{n} requests". The tabs are "Requests ({count})" and "Unassigned contracts ({count})".
2. Legal Team Member reads the Requests table. Columns are "Ref", "Title", "Type" (with a routing line such as "Contract · NDA"), "Requester", "Urgency", "Age" and "Status", plus the pinned "Triager" column. The default order is urgency, then oldest first.
3. Legal Team Member reads the default filter, Status New and Read.
   Watch: the 2026-09-05 addendum says the built-in filter is "Status: New". The code uses New and Read.
4. Legal Team Member clicks "Assign R-{n}". The dialog "Assign R-{n} for triage" says "Choose who should triage this request." It has "Search people", an "Unassigned" option, and live Administrators and Legal Team Members.
   4a. Legal Team Member picks themself and clicks "Save assignment". The button becomes their avatar ("Reassign R-{n}: {name}"). No notification fires for self-assignment.
   4b. Legal Team Member picks a colleague. The colleague gets "{actor} assigned you to triage R-{n}" (bell, email and push on by default).
   4c. Legal Team Member opens the avatar, picks someone else and clicks "Cancel". Nothing changes. "Save assignment" stays disabled until the choice changes.
   4d. Legal Team Member picks "Unassigned" and saves. The Assign button returns. No notification fires.
   4e. The people list fails. The dialog says "People could not be loaded." with "Retry". A search with no match says "No people match your search."
   4f. The current assignee was archived. The dialog says "{name} is no longer available to triage. Choose another person or clear the assignment."
   4g. The Request was decided meanwhile. Saving is refused with "This request has already been triaged. Its assignment cannot be changed."
   4h. The Requester's Request page and "Your requests" now show the assignee's name.
   Watch: the Portal labels the triage assignee "Legal Owner: {name}". The glossary reserves Legal Owner for a Contract's accountable person.
5. Legal Team Member uses "Filter". Status (New, Read, Converted, Resolved, Declined), Type, Urgency, Requester ("Me" plus past requesters) and "Received date" are offered. Choices inside one filter match any value.
   5a. Legal Team Member removes the Status filter. Decided Requests appear.
   5b. Legal Team Member sets a Received date range with an end before the start. The picker says "End date must be on or after start date."
   5c. A filter with no matches shows "No requests match these filters" and "Clear a filter to widen the list." "Clear all" recovers.
   5d. With the default filter and nothing waiting, the page says "Nothing is waiting" and "Every Request has been decided. New ones land here as they arrive, hottest and oldest first."
   5e. Legal Team Member clicks "Remove {filter} filter" on one chip.
6. Legal Team Member opens "Views". They use "Save as…", "Rename…", "Set as default", "Discard unsaved changes" and "Delete…". The delete dialog says "{name} is removed. The records in it are not touched."
   6a. A failed save says "The view could not be saved. Try again."
   6b. Legal Team Member reloads a filtered URL and uses Back and Forward. The filters and view return.
7. Legal Team Member opens "Columns". They hide and show columns, use "Move {column} earlier" and "later", "Fill the width" and "Reset columns". Title takes the spare width. Triager stays pinned.
8. Legal Team Member clicks a column header three times. It sorts ascending, descending, then back to the default.
9. Legal Team Member clicks "Show more" (50 per page). Filters stay, and the screen reader hears "{n} more requests. {total} shown."
   9a. A failed page read says "The next requests could not be read. Try again."
   9b. A failed filter read says "The Inbox could not be read. Try again." and keeps the old rows.
10. Legal Team Member opens the Request from its Title. The URL is /inbox/{n}.
11. The Request moves from New to Read. The Requester's banner changes to "Your request has been opened by the Legal team." No notification fires.
12. Legal Team Member reads the header. The breadcrumb reads "Inbox", then R-{n} and the title with the status pill. The assignee control shows the name.
13. Legal Team Member reads the "Overview" strip. It shows "Requester", "Type", "Converts to", "Department" (or "No Department"), "Urgency" and "Submitted".
14. Legal Team Member reads "Description" and "Form responses". A form with only basics says "This form collected nothing beyond the basics."
15. Legal Team Member reads "Attachments". They click a filename to preview it and use "Download {filename}". With none it says "No files travelled with this request."
16. Legal Team Member opens Comments. The composer offers "Legal Only" (default) and "Shared with requester". The audience lines are "Visible to Administrators and Legal Team Members." and "Visible to Legal and the requester."
    16a. Older Working team comments stay readable with their badge. Working Team is not offered.
17. Legal Team Member picks "Shared with requester", types in "Add a comment…" and clicks "Comment".
    17a. Legal Team Member posts at Legal Only. The Requester sees nothing and gets nothing.
    17b. Legal Team Member types "@" and uses the "People" and "Files" tabs. They pick a colleague. The chip says "Mentioned" with "Remove {name}". The colleague gets "You were mentioned on R-{n} · {title}".
    17c. Legal Team Member mentions someone who cannot see Legal Only. The dialog "Widen the audience?" says "{names} cannot see a Legal Only comment. Post it at Shared with requester instead…". They click "Cancel", then "Widen and post".
    17d. A person no tier reaches gives "{names} cannot be reached on this record at any audience you can post to. Take the mention out."
    17e. Legal Team Member clicks "Attach files" (up to 5), removes one, and posts files with text.
    17f. Legal Team Member opens "Comment actions" on their own comment. They use "Edit" ("Edit comment", "Save", "Cancel"). The comment shows "edited". They use "Delete" and confirm "Delete this comment?". It shows "Comment deleted by its author."
    17g. Administrator uses "Redact" on another person's comment and confirms "Redact this comment?". It shows "Comment removed by an Administrator."
    17h. A failed post says "The comment could not be posted. Try again." A failed thread read says "The conversation could not be read. Reopen the panel to try again." "Show older" loads earlier comments.
    Watch: comment attachments cannot be filed from a Request. Filing ("File to Contract", "File to Matter") exists only on the converted record (Script 3.7).
18. Business User receives "{actor} replied on your request R-{n}". The email subject is "Legal replied on R-{n} · {title}" with "Reply on the request".
19. Business User opens the Request from the email.
    19a. Signed out, the link lands on Portal sign-in. After the magic link they land on /portal, one click from the Request.
20. Business User reads /portal/requests/{n}. It shows "Your requests" (back), the title with its pill, "R-{n} · {type} · Submitted {date}", the owner card "Legal Owner" (or "Not assigned yet"), and the status banner. For New it reads "Legal has received your request. You'll get an email when the status changes.", for Read "Your request has been opened by the Legal team."
21. Business User reads "What you submitted". It shows Department, Description, Urgency, the answered Rows and attachment download links.
    21a. A Row the Administrator later detached is not shown. An Entity that became Confidential shows "Restricted Entity".
22. Business User opens Comments (it shows an unread badge). The empty thread says "Nothing has been said about this record yet…". They type in "Add a comment…", add up to 5 files with "Attach files", and click "Comment". There is no audience picker. The note reads "Visible to Legal and the requester." The comment shows "Shared with requester".
    22a. Business User types "@" and uses the People and Files tabs.
    22b. Business User edits and deletes their own comment from "Comment actions". There is no Redact in the Portal.
    22c. Business User opens "History". An empty one says "No shared history yet."
    22d. "Show older" loads older comments. A failed post says "The comment could not be posted. Try again."
23. Legal Team Member sees the reply. Posting changes no status.
24. Business User types another person's Request number. The Portal returns them to /portal. The API answers 404, the same as for a number that does not exist.
25. Administrator opens that Request at /portal/requests/{n}. They are refused too. The Portal shows only their own Requests.
26. Business User types /inbox/{n}. The app returns them to the Portal. A Member+ who types a bad number is returned to /inbox.

### 3.5 Disposition: Legal decides what the Request becomes

Actors: Legal Team Member, Business User, a second Legal Team Member for the race.

1. Legal Team Member clicks "Triage" on /inbox/{n}. The menu has "Convert to contract", "Convert to matter", a separator, and "Resolve request without converting".
   Watch: there is no Decline item. The API still accepts POST /requests/{n}/decline, and decline-dialog.tsx remains in the code but nothing imports it. The Inbox Status filter still offers Declined.

#### 4a. Convert to Contract

2. Legal Team Member chooses "Convert to contract".
3. If Contract preparation is on, the dialog "Conversion draft" opens first. It shows "Getting contract ready…", "The provider reads the Request and its attachments. A long attachment can take a few minutes." and a live "Working for {duration}."
   3a. The dialog says "You can close this and keep working. Preparation continues, and a notification tells you when the draft is ready." Legal Team Member clicks "Close". Later the bell says "The Conversion draft for R-{n} is ready to review". The link opens /inbox/{n}?convert=contract and the dialog again.
   3b. The draft fails. The dialog says "Preparation could not finish. Retry or continue manually." with "Cancel", "Continue manually" and "Retry". A failed draft left while pending sends "…could not finish" with "Open Convert".
   3c. Legal Team Member clicks "Continue manually". The form opens with Request defaults. No notification is asked for.
   3d. With preparation off, the form opens straight away.
   3e. If the Request is decided while the draft runs, no notification is sent.
4. Legal Team Member reads the form "Convert R-{n} to a contract". The line under it says "{request type} · submitted by {requester}".
5. Legal Team Member reads "Title" (prefilled), "Contract type" (from routing), and "Priority" (from Urgency). There is no Risk unless the Form has a Risk Row.
   5a. Legal Team Member clears Title and submits. The box says "Name the contract."
   5b. Legal Team Member clears the type. The form says "Pick a contract type."
6. Legal Team Member reads the Creation Rows in Form order. Intake answers are prefilled, including branched Rows.
   6a. A required Row left empty says "Fill {field} — this contract type requires it."
   6b. A bad number says "{fieldName}: enter this as a number."
   6c. An archived person or Entity carried from the Request shows "{value} is archived. Pick a live person to convert." Submitting without a new value says "Pick a live value for {field}."
   6d. Legal Team Member clears an optional value. It stays empty after conversion.
   6e. Legal Team Member changes the type. The Rows change, human edits on shared Rows survive, and preparation runs again for that type.
7. With a draft, Legal Team Member reviews AI suggestions. Each has an "Unverified" pill, a sparkle "View source evidence" and "Confirm".
   7a. The sparkle opens "Why this value" (or "No explanation was saved for this value.") and "Sources". An attachment source opens a panel with "Passage {current} of {total}", "Previous passage", "Next passage", "Download" and "Close the document".
   7b. A changed source says "The source is unavailable or has changed."
   7c. Legal Team Member edits a value or clicks "Confirm". The marker goes.
   7d. Legal Team Member toggles "Description" between "AI generated" and "Requester". With no requester text it says "The requester did not provide a description."
   7e. The form may show "Some attachments could not be fully read…", "Some Fields exceeded the preparation limit. Complete them manually." or "Some sources exceeded the reading limit and were omitted…". "Attachment reading details" lists each file as "{label}: {status} — {reason}".
   7f. "Conflicting sources need your review:" lists the values in conflict.
   7g. Legal Team Member clicks "Discard AI suggestions". Untouched values return to Request defaults. Human edits stay.
8. Legal Team Member reads "Documents". The Request's files are listed with "Download {name}". They add more with "Attach documents" or drag and drop, with a "Document type".
9. Legal Team Member clicks "Cancel" and reopens. Unsaved edits are gone.
10. Legal Team Member clicks "Convert to contract".
    10a. If extra documents fail after the record is made, the form says "Record created. Some documents could not be uploaded." with "Retry failed uploads" and "Continue".
    10b. A server refusal shows its message, or "The request could not be converted. Try again."
11. The page stays on the Request. The Status card shows "Converted", a link "C-{n}", and "Converted by {name} on {date}". The Triage menu, Comments and Attachments card are gone. The assignee is read only.
    Watch: after a successful conversion the page does not go to the new record. The only way on is the record link.
12. Legal Team Member opens C-{n}. It is in draft. The converter is Legal Owner and Creator. The Requester is Business Owner and on the team. Priority came from Urgency. The description was copied. Needed by is a Key date "Needed by". Each Request attachment is a root Document at version 1. The first one is the primary instrument. The conversation moved to the record with its tiers.
13. Business User gets "Your request R-{n} is now In progress". The email subject is "Your request is in progress: …".
14. Business User opens /portal/requests/{n}. The Portal redirects to /portal/contracts/{C}. The Request has left "Your requests".
    14a. If Legal removes the Requester from the new record's team, the old Request address sends them to /portal with no message.
    Watch: the Portal's converted banner "Legal is working on this. Follow it here." is almost never seen, because a converted Request redirects, shows the archived stub, or bounces home.

#### 4b. Convert to Matter

15. Legal Team Member chooses "Convert to matter" on another Request. The form has "Title", "Matter type", "Matter template" (starts at "No template"), "Priority" and the Matter's Creation Rows.
    15a. Legal Team Member picks a template, edits a Row, then picks "No template". The edit stays.
    15b. Changing the Matter type resets the template to "No template".
    15c. A template cannot go on a Contract conversion. The API refuses with "A matter template can only be applied to a matter conversion."
16. Legal Team Member converts. The converter becomes Matter Manager and Creator. The Requester becomes Business Owner and team member. The Matter is not Confidential.
17. Record Rows on the new Matter are prepared in the background and show Unverified markers when AI is on.
18. Business User is redirected from the Request address to /portal/matters/{M}.

#### 4c. Re-target

19. Inside the Convert form, Legal Team Member clicks "Convert to matter instead" (or "Convert to contract instead"). The form switches module in place and prepares again. Answers carry where the new type has a Row.
20. Legal Team Member can also open the other Convert item from the Triage menu directly.

#### 4d. Resolve without converting

21. Legal Team Member chooses "Resolve request without converting". The dialog "Resolve R-{n} without converting" says "Explain why this request can be closed without creating a contract or matter."
22. Legal Team Member leaves "Resolution note (required)" blank and clicks "Resolve request". The box says "Explain why this request is being resolved without converting."
23. Legal Team Member reads "This goes on the request's thread, and to the requester by email." They click "Cancel". Nothing changes.
24. Legal Team Member writes a note and clicks "Resolve request". The Request shows Resolved and the note is a Shared with requester comment.
    24a. A failed resolve says "The request could not be resolved. Try again."
25. Business User gets the note as a reply and "Your request R-{n} is now Resolved". The banner reads "Legal has answered this request and closed it. Attach new files to a reply." The Request stays in "Your requests".
    Watch: the note is a comment, so the Requester probably gets two emails, "Legal replied…" and "Your request is resolved…". Check whether that is wanted.
26. Business User replies on the resolved Request. The thread works. The status does not change.

#### 4e. Decline (historical only)

27. Open a seeded declined Request on the Portal. The banner reads "Legal declined this request." followed by the reason, then "Attach new files to a reply." The Requester had one email "Your request was declined: …" with the reason, and no status-change email.
28. Open the same Request in the Inbox. The Status card shows the reason as written.

#### 4f. Race and after-disposition paths

29. Two Legal Team Members open the Convert form on the same Request. The first converts. The second submits and sees "Somebody else already converted this request. It became C-{n}. Close this to read what they recorded." with "Close". The page behind has repainted.
    29a. The same happens in the Resolve dialog, with "Somebody else already resolved this request."
30. Business User tries to upload a file to a decided Request through the API. It is refused with "This Request has already been dispositioned. Attach new paper to a reply in its thread."
31. Legal Team Member removes the Status filter in the Inbox and opens the linked record from a converted row.
    31a. When the record is archived or out of the viewer's reach, the row has no link.

### 3.6 Business User works on the record in the Portal

Actors: Business User on the team, Legal Team Member, a colleague Business User.

1. Business User opens "Contracts" (/portal/contracts). The heading is "Your Contracts" with "Contracts you are on the team for." and "{shown} of {n} records".
2. Business User uses "Search Contracts" and "Search". The URL carries q=. "Clear search" resets.
3. Business User opens "Filter", picks a Type, and clicks "Apply". Filters are Type, Legal Owner, Stage and Expiry date.
4. Business User sorts by "Title". The URL carries sort=title.
5. Business User opens "Columns" and adds "Business Owner". Other columns are Reference, Counterparty, Type, Stage, Status, Legal Owner, Effective date, Expiry date and Value.
6. Business User opens "Matters" (/portal/matters). It shows "Your Matters" and "Matters you are on the team for." Filters are Type, Matter Manager, Status and "Lifecycle" (Open or Closed).
   6a. With no records the list says "No records are available to you" and "Records appear here when Legal adds you to their team."
   6b. With no matches it says "No records match your search or filters" and "Try another search or clear a filter to widen the list." with "Clear search and filters".
   6c. A failed update says "The list could not be updated. Try again."
   6d. A Confidential record they are not on never appears in lists or counts.
7. Business User opens the Contract. "Overview" shows Counterparty, Stage, Business Owner, Legal Owner, Department, Region, Term type, Value, Effective date, Expiry date, Renewal period and Notice deadline. Empty values read "Not recorded". There is no inline editing and no "Contract actions" menu.
   7a. Values written by AI carry Unverified markers and the note "Legal has not yet verified the values marked Unverified. Confirm them with Legal before relying on them."
   7b. An auto-renewing Contract past expiry shows "Renewal is pending confirmation by Legal."
8. Business User reads "Fields". Only Rows with Visible on Portal on appear, read only.
9. Business User reads "Original request". It shows "R-{n} · {requester} · Submitted {date}", "Urgency: {urgency}", the answers and links to the submitted paper.
10. Business User opens the team from "Contract team". The roster lists names with the statements Legal Owner, Business Owner and Creator.
11. Business User clicks "Add team member", picks a person in "Person" ("Choose a person"), and clicks "Add". The person appears once. There is no Remove button.
    11a. Adding someone already on the team is refused with "This person is already on the team." and adds no second row.
    11c. Business User clicks "Add" with nobody chosen. The dialog says "Pick a person." A failed add says "That person could not be added to the team."
    11b. On a Confidential record the add button is disabled with "Ask Legal to add members to a Confidential record."
    Watch: Portal record pages show no Confidential marker or notice anywhere.
    11c. A failed read says "The team could not be read." with "Try again".
12. Business User opens "Documents". Each Document shows its current Version, "Current", "Primary Document" on the Contract's main chain, and "Signed copy" on the executed Version.
13. Business User clicks the primary Document name. A reader opens with a preview ("Preparing this document for reading…" while it renders), "Download" and "Close the document". There is no Compare in the Portal.
14. Business User clicks "Add version". The "Upload documents" dialog shows "Add as" set to "New version of {name}", "Files to upload", "Kind" (on a Contract) and "Note (optional)". They click "Upload". "Version 2" appears. "1 earlier version" expands the history. Each Version has "Download {name}, version {n}".
    14a. Choosing two files for a new version says "Choose one file for a new version." Choosing none says "Choose a file to upload."
    14b. The new Version does not change the primary designation or the executed pin.
15. Business User clicks "Upload documents", drops files on "Drop files here or click to upload", and uploads them as "New documents". The page says "{n} files uploaded."
    15a. A failed upload says "That file could not be uploaded. Try again." with "Retry failed uploads".
    15b. Business User clicks "Cancel". Nothing uploads.
16. Business User uses "Search Documents", "Search" and "Clear". No match says "No Documents match your search." An empty record says "No Documents yet." A failed read says "The Documents could not be read." with "Try again". "Show more" loads more.
17. Business User opens Comments. Only Full Thread comments show, with the note "Visible to Legal and all Contract team members." They post one. Legal Only and Working Team comments never appear.
    17a. Business User closes the panel with a draft typed. The draft stays and focus returns to the Comments button.
18. Business User opens History. Only Full Thread entries and permitted changes show. An empty history says "No shared history yet."
19. Legal Team Member posts at "Contract Team" on the staff record. The Business User gets "replied on your request" on the bell and by email.
20. The colleague signs in and opens the same record.
21. Legal Team Member removes the Business User from the team.
    21a. The Business Owner cannot be removed until that assignment is cleared or changed.
22. Business User reloads. The page says "Contract not found" and "This Contract does not exist, or you cannot open it." The list no longer shows it. Old Request links and download links answer 404.
23. Legal Team Member archives a converted record. The Requester's old Request address shows "The record created from this Request was archived. Your original request is shown below." There is no thread or composer.
    23a. Restoring the record makes the address a redirect again.
    Watch: the archived stub drops the original attachments, although DD-023 says the original ask keeps them.
    Watch: Contract and Matter "not found" shows in the page, while a bad Request number redirects home. A failed Documents or work read throws the route error page.
24. Business User repeats steps 7 to 22 on a Matter. The Matter page shows "Matter Type", "Status", "Matter Manager", "Business Owner", "Region" and "Department". A missing one says "Matter not found".

### 3.7 Legal files thread paper onto the record

Actors: Business User, Legal Team Member.

1. Business User posts the counterparty's markup as a comment attachment on the record.
2. Legal Team Member opens the comment on the Contract and clicks "File to Contract" (or "File to Matter"). The "File attachment" dialog opens.
3. Legal Team Member picks "Destination" = "New Version on an existing Document". They pick the "Document" ("Choose the Document this round belongs to."), a "Type", and a "Note" ("What changed in this round"). They click "File".
   3a. Legal Team Member picks "New Document" with a "Document name" and "Type".
   3b. Legal Team Member clicks "Cancel". Nothing is filed.
   3c. A failed filing says "That attachment could not be filed. Try again." A failed Document list says "The Documents could not be loaded. Try again."
4. The comment now shows "Filed to {destination}" and links to "{title}, version {n}". The Documents tab shows the new Version.

### 3.8 Unassigned contracts from Auto-Docs

Actors: Business User, Legal Team Member.

1. Business User opens "Auto-Docs" in the Portal and generates a document from an Auto-Doc that targets a Contract Type with no matching Assignment rule.
2. A Contract is created in draft with no Legal Owner. Every live Member+ gets "{actor} generated {contract} from {autoDoc}; it needs a Legal Owner". Email is off by default. With it on, the subject is "Unassigned generated Contract: …" with a "Claim it" button.
3. Legal Team Member opens the Inbox tab "Unassigned contracts ({count})". The sub-bar reads "{n} unassigned Contracts".
4. Legal Team Member reads the columns "Ref", "Contract", "Auto-Doc" (or "Deleted Auto-Doc"), "Generated by" (or "Generation details deleted") and "Created", plus a pinned "Actions" column. There are no filters, views or column menu.
5. Legal Team Member clicks "Assign C-{n}". The dialog "Assign C-{n}" says "Choose the Legal Owner responsible for this contract." It lists live Member+ with name and email. There is no "Unassigned" option.
6. Legal Team Member picks a person and clicks "Save assignment". The row leaves and the count drops. The new Legal Owner gets an owner-assigned notification.
   6a. Someone else assigned it first. The queue re-reads and says "This Contract already has a Legal Owner."
   6b. The Contract was archived. The queue re-reads and says "No generated Contract is available with this number."
   6c. Any other failure says "The unassigned Contracts could not be updated. Try again."
7. With nothing waiting, the tab says "No generated contracts need a Legal Owner" and "Contracts created through Auto-Docs without a Legal Owner appear here. Assign them to a legal colleague."
   Watch: the email says "Claim it in the Inbox" and the API has a claim route, but the tab has no Claim button. Self-assignment goes through Assign.

### 3.9 A Business User answers an Approval request in the Portal

Actors: Legal Team Member, Business User named as approver.

1. Legal Team Member asks the Business User for approval on a Contract.
2. Business User opens "Approvals" (/portal/approvals). The heading is "Your approvals" with "Review Contracts awaiting your sign-off and revisit your decisions."
3. Business User reads the "Pending" tab. Columns are "Contract", "Requested by", "Requested" and "Status" (Pending, Approved, Rejected).
   3a. With none pending it says "You're all caught up" and "When someone asks for your approval, the request will appear here."
4. Business User uses "Search approvals" and "Search". No match says "No matching approvals" and "Try a different Contract title or requester name." "Next page" pages on.
5. Business User opens one (/portal/approvals/{id}). It shows "All approvals", "Approval request", "Requested by", "Requested" and "Primary document".
   5a. The document shows "Preparing document preview" and a "Download" link. When no preview is possible it says "Download the document to review it".
   5b. With no primary document it says "No document attached" and "No primary document is available. Contact the requester if you need a document to review."
6. Business User writes "Note (optional)" under "Your decision" and clicks "Approve". The status becomes Approved.
   6a. Business User clicks "Reject" on another. The status becomes Rejected.
   6b. A failed save says "Your decision could not be saved. Please try again." A decision made elsewhere first says "This approval request has already been decided."
   6c. Business User opens /portal/approvals/nonsense. The generic route error page shows outside Portal chrome.
   Watch: the approval detail has no link to the Contract, and the list pages forward only with "Next page".
7. Business User opens "Completed". The decided items are there. An empty tab says "No completed approvals yet".

### 3.10 Staff "View as business user"

Actors: Administrator, Legal Team Member.

1. Legal Team Member opens Settings > Personal > "View Business Portal" (/settings/app-view). It says "Open the intake portal as a Business User sees it: submit requests, track their progress, and talk to Legal. You’ll see your own requests, and anything you submit is real."
2. Legal Team Member clicks "View as business user". The Portal opens with the notice "Viewing as business user" and "You’re viewing your Portal work. Submissions, edits, and replies are real."
3. Legal Team Member sees only their own Requests. A fresh staff account sees "You have not asked Legal for anything yet."
4. Legal Team Member submits a Request. It lands in the Inbox under their name. Other Member+ are notified. The submitter is not notified as a triager.
5. Legal Team Member moves to a form, a Request, a Knowledge item and Notification settings, then reloads. "Return to legal view" stays available.
6. Legal Team Member clicks "Return to legal view". The app opens View Business Portal with the same account.
7. Legal Team Member opens a Portal record they are on. They get the Business User limits, including no member removal.
8. Business User checks that the staff notice and "Return to legal view" never appear for them. They open /settings/app-view and land on /settings/profile, which forwards to the Portal.
   Watch: the old checklist says "confirm a Contributor cannot see this pane". Contributor was removed by DD-023.

### 3.11 Requester notification settings

Actors: Business User.

1. Business User clicks the gear "Notification settings" (/portal/settings). The page says "Choose how Legal reaches you about your Requests, Contracts, and Matters." with "Your requests" to go back.
2. Business User reads "How we tell you about your work". There are 12 switches: "In-app", "Email" and "Push" for each group.
   2a. "Request updates" is "Receipts, replies, status changes, and decisions on the requests you submit."
   2b. "Assigned to you" is "Contract team additions and comments that mention you on your Contracts and Matters."
   2c. "Activity on your records" is "Shared comments and supporting Documents on your Contracts and Matters, and Contract status changes."
   2d. "Dates approaching" is "Key-date reminders on your Contracts and Matters. Email arrives in one daily summary."
3. Business User checks the defaults. "Request updates" has Email on. Push is on for every group except "Activity on your records".
4. Business User turns off "Request updates Email". Legal replies. No email arrives, but the bell item does.
5. Business User turns off the In-app channel and checks the dependent Email switch.
6. Business User reloads. The choices persist. Each change shows "Saving…" then "Saved". A failed save says "The change could not be saved. Try again."
7. Business User reads "Devices". They click "Turn on for this browser" and toggle "Show details in notifications". They "Revoke" a device.
   7a. The card may say "Notifications are on for this browser.", "No browsers have been turned on.", "This browser does not support device notifications…", or "Devices could not be read." with "Try again".
8. Business User opens the bell ("Notifications, {n} unread", capped at 9+). The panel "Notifications" shows a pinned "Your approvals" group with "Review", then "Earlier". They follow an item, click "Mark all read", and use "Show older".
   8b. With nothing, the panel says "Nothing to catch up on. News about your requests shows up here." A failed read says "Notifications could not be read. Close this and open it again."
   8a. A bell item for a converted Request follows the redirect to the record. After removal from the team it lands on "not found".
   Watch: the page also links to "API keys" (/portal/settings/api-keys). That is MCP, outside this area.

### 3.12 Notification summary by step

- Requester submits. Requester gets "Legal has received your request R-{n}" and the email "We have your request: …". Every other live Member+ gets "{requester} submitted a new request: R-{n}" (email off by default, "New request: …").
- Staff member opens a New Request. Status becomes Read. Nothing is sent.
- Triager assigned by someone else. That person gets "{actor} assigned you to triage R-{n}". Nothing for self-assignment, no change, or a clear.
- Legal replies at Shared with requester, on the Request or on the converted record. Requester (or team Business Users) get "{actor} replied on your request R-{n}" and "Legal replied on R-{n} · {title}". Legal Only replies send nothing to them.
- Requester replies. Nobody on the Portal side is notified of their own reply.
- Mention on a Request. The named Member+ gets "You were mentioned on R-{n} · {title}".
- Convert. Requester gets "Your request R-{n} is now In progress" and "Your request is in progress: …".
- Resolve. Requester gets the note as a reply and "Your request is resolved: …".
- Decline (API or historical only). Requester gets "Legal declined your request R-{n}" and "Your request was declined: …" with the reason. No status-change email.
- Conversion draft finished after the triager left. Triager gets "The Conversion draft for R-{n} is ready to review" or "…could not finish" (email off by default, "Conversion draft ready: …" with "Review draft", or "Open Convert").
- Unassigned generated Contract. Every live Member+ gets the "needs a Legal Owner" item (email off by default, with "Claim it").
- Unassigned Contract assigned. The new Legal Owner gets an owner-assigned notification.
- Staff personal settings also have a daily briefing "Intake" section, "Open Requests in the Inbox. Off by default."

## 4. Contracts

These scripts walk the Contracts module end to end, from setup to Archiving. A human follows them in a running build and checks what each step says they should see.

Build basis. Branch `dev` at ee0e6eda, plus the uncommitted work in the main checkout on 2026-09-26. That work adds two things. One is partial signing: migration `0181_partial-signing.sql`, a protected "Partially signed" Status, and a new question in the send dialog. The other is per-Version delete of Documents. A build without that work will not show them. Steps that depend on it are marked WIP.

Actors. Administrator, Legal Team Member (both are Member+), Business User, Approver (any active user named on an Approval request), Signer (a person asked to sign in DocuSign). "Legal" in a step means a Legal Team Member unless the step says otherwise.

Conventions. Text in double quotes is the exact UI label. "Expect" says what the actor should see. Lettered sub-steps are forks. A "Watch:" line flags something in the code that looks half-built or inconsistent. Check it on the walk.

Terms. Use CONTEXT.md terms. Stakeholder, Watcher and Contributor were removed by DD-023. A team row is plain membership with no tag. Do not look for Stakeholder or Watcher controls. Only old activity narration still names them.

Record layout, for orientation. The Contract record at `/contracts/{n}` has seven tabs: "Overview", "Fields", "Documents", "Approvals", "Signatures", "Key dates", "Tasks". Related contracts and the linked Matter sit on Overview. The side applet bar holds "Contract team", "Comments", "History" and, for an Administrator only, "Contract settings". There is no Relations tab and no History tab.

### 4.1 Prerequisite setup (Administrator)

Goal: configure every list and connector the later scripts use. Every settings change applies at once and writes an Audit log entry. Each pane says "The change applies immediately and is recorded in the audit log."

1. Administrator signs in and opens Settings from the user menu. Expect the "Organization" rail group.
   1a. Legal Team Member opens `/settings/contracts/types` by URL. Expect a redirect to `/settings/profile`. The API answers 403.
2. Administrator opens Settings > Contracts > "Types" at `/settings/contracts/types`. Expect tabs "Types", "Statuses", "Fields", "Approver groups". Expect the seeded types NDA, MSA, SOW, Sales, Vendor, Employment, License, Other and Default, each with "{n} contracts".
3. Administrator clicks "Add type", types a name in "New type name" and clicks "Save". Expect the new row at the bottom. Repeat and click "Cancel" to abandon one.
   Watch: a duplicate type name is accepted. Only the internal slug gets a suffix.
4. Administrator renames a type in place with "Rename {name}". Enter commits, Escape cancels.
5. Administrator drags a type by its grip to reorder it. Then focuses the grip and uses the arrow keys. Expect the announcement "{name} moved to position {position} of {total}."
6. Administrator archives an unused type with "Archive {name}" and "Archive type". Expect it to leave the list.
7. Administrator archives an in-use type. Expect "Reassign {n} contracts to" with a type select. Pick a target and confirm. Expect its Contracts to move and each to get a `contract.type_reassigned` History entry.
   7a. No other live type exists. Expect "No other active type can take its contracts. Add or restore another type first."
   7b. Try "Other". Expect a lock and "Other is system-protected and can't be archived".
   7c. Try "Default". Expect an Archive button, then a 409 refusal: "Default is the Default type and cannot be archived or deleted: module-only Requests need its Form."
   Watch: the help text names only Other as protected, but Default is protected too.
8. Administrator turns on "Show archived" and clicks "Restore {name}" on an archived type.
9. Administrator clicks "Edit {name}" on NDA. Expect the type editor at `/settings/contracts/types/{id}` with tabs "Details", "Form", "People", "Approval defaults" and the back link "All types".
10. Details tab. Administrator edits "Display name" and "Description". Blur or Enter saves, Escape reverts. Expect "{n} contracts use this type."
11. Form tab. Expect columns "Row", "On intake form", "Required for creation", "Visible on Portal", "Touchpoint". Title and Type show a lock and "Position and switches are fixed". Built-in Rows show Visible on Portal as fixed.
12. Administrator clicks "Attach Field", searches in "Search fields" and attaches a catalog Field. Expect "{field} attached." Expect "All Fields are attached" or "No Fields match" when nothing is left.
13. Administrator clicks "Create Field" from the Form and creates a Field in place.
    13a. Creation succeeds but attaching fails. Expect "{field} was created but could not be attached. Retry attachment." and "Retry attaching {field}".
14. Administrator switches "On intake form" on for a Field Row. Expect "Visible on Portal" to turn on with it. Try to turn Visible on Portal off. Expect "Turn off On intake form first".
15. Administrator switches "Required for creation" on for a Row. Expect Touchpoint to read Creation. A Row with neither switch reads Record. A user-type Field that is on intake cannot be required: expect "Required for creation is unavailable for {row} while it is on the intake form".
16. Administrator clicks "Add condition" to make a Branch. Sets "Show when all of:" or "Show when any of:" with a Row, operator and value. Operators are is, is not, is one of, is set, is greater than, is less than.
    16a. No Row above the Branch. Expect "Add a Row above this Branch first".
    16b. Try to move a Row used by a condition below its Branch. Expect "Keep {row} above the Branch that uses it". Try to detach it. Expect "Used by a Branch condition. Change the condition first".
17. Administrator uses a Row menu "Actions for {row}": "Edit Field", "Put under a condition…", "Move out of the condition", "Add condition inside", "Remove condition". Uses "Detach {row}" on a Field Row. Built-in Rows have no detach.
18. Administrator clicks "Preview intake form". Expect "Preview only. No Request will be sent." Submit shows "Preview complete. No Request was sent".
19. People tab. Administrator picks a person in "Default person" and clicks "Add person". Adds a Business User as a second default person. Reorders with "Move {name} up" and "Move {name} down". Removes one with "Remove {name}". Expect the help "These people join every new Contract of this Contract Type and receive a notification. Changes apply to future Contracts. Archived people are skipped."
    19a. Add the same person twice. Expect "This person is already a default person."
    19b. An archived default person shows "(Archived)" and is skipped at creation.
20. Approval defaults tab. Administrator picks a group in "Approver group" under "Default approver group". Expect the help "Applies to new Contracts of this type. Approval starts only when someone requests it." Do this after step 33 creates a group.
    20a. On an archived type the select is disabled. The API says "Restore this contract type before changing its default approver group."
21. Administrator opens "Statuses" at `/settings/contracts/statuses`. Expect "Contract statuses", "{n} statuses", and each row with a "Stage:" pill and "{n} contracts". Seeds: Draft, Internal review, With counterparty (formerly Redlining with counterparty), Awaiting approval, Out for signature, Active, Expired, Terminated. WIP: also "Partially signed" in the Signature Stage, with a lock.
22. Administrator clicks "Add status", types a name in "New status name", picks a Stage in "New status stage" and clicks "Save status".
    22a. No Stage picked. Expect "Pick a stage for the new status."
    22b. The Stage of a saved Status cannot be changed later. Check there is no control for it.
    Watch: a duplicate Status name is accepted.
23. Administrator renames and reorders Statuses as in steps 4 and 5. The order drives the record's "Move to" menu and the list's Status sort.
24. Administrator archives a Status.
    24a. Unused and not the last in its Stage. Expect "Archive status" to succeed.
    24b. In use. Expect "{name} is the status of {n} contracts. Move them to another status first." There is no reassignment.
    24c. Last live Status in its Stage. Expect "{name} is the last unarchived status in its stage", and the advice to add another first.
    24d. Draft, Active, Expired and, WIP, Partially signed show a lock: "{name} is system-protected and can't be archived".
25. Administrator opens "Fields" at `/settings/contracts/fields`. Expect the read-only "Default Fields" card and the "Custom Fields" list with columns "Field", "Type", "AI prompt".
26. Administrator clicks "Add field". Enters "Name", "Description", picks "Type" from Text, Long text, Number, Currency, Date, Boolean, Single select, Multi select, User, Entity. For a select type, enters "Options" one per line. Enters an "AI prompt". For Text or Long text, picks "Answer style". Clicks "Add field".
    26a. Blank name: "Name the field." No type: "Pick a type for the new field." Select with no options: "Add at least one option, one per line." Repeated option: "Options must be unique."
    26b. Pick "Full clause text" on a Text Field. Expect it disabled with "Full clause text needs a long text Field."
    26c. A User or Entity Field has no AI prompt box.
27. Administrator clicks "Edit {name}" on the new Field. Expect "The field type is immutable after creation." Renames in place with "Rename {name}".
28. Administrator archives a Field with "Archive {name}" and "Archive field". Expect the warning that attachments are kept but hidden until restore. Restores it with "Restore {name}".
    28a. Governing law, Jurisdiction and Our position show "{name} is a default Field and can't be archived".
29. Administrator opens Settings > Documents > "Contracts" at `/settings/documents/contracts`. Expect tabs "Matters", "Contracts", "Entities" and the list "Document types". Expect the six fixed types: Draft · ours, Draft · theirs, Redline · theirs, Redline · ours, Executed, Amendment. Each says "{name} has a fixed name. Its colour can be changed."
30. Administrator changes a fixed type's colour with "Colour for {name}". Expect "Saving colour…". Adds a type "Side letter" with "Add type". Reorders and renames it. Archives it and sees "{n} versions keep {name} as their type. It leaves the upload pickers."
    Watch: this pane spells "Colour" and the Fields dialog says "Organisation default", while the rest of the app uses US spelling.
31. Administrator opens "Approver groups" at `/settings/contracts/approver-groups`. Expect the "Approval permissions" card with "Who can override a default approver group?" set to "Legal team members and administrators".
32. Administrator switches it to "Administrators only". Expect it to save on change. Switch it back after Script 4.4 step 44b.
33. Administrator clicks "Add group". Enters "Name" "Commercial sign-off", a "Description", and ticks two members in "Members": one Legal Team Member and one Business User. Clicks "Add group". Expect "{n} members" on the row.
    33a. Blank name: "Name the group." Same name as a live group: "An approver group is already called that."
    33b. An archived member shows "Can no longer approve" and blocks the save: "{name} is archived and can't be a group member."
    Watch: the page help says "Only Administrators and Legal team members can be group members", but the member help and the API accept Business Users. The member help also says "Legal portal", which is not the product term.
34. Administrator creates a second group, then archives it with "Archive {name}" and "Archive group". Expect "{name} leaves the apply picker…" Restores it.
    34a. Restore onto a name a live group now holds. Expect "A live approver group is already called that. Rename that one first, then restore this one."
    Watch: archiving a group that is some type's default has no guard. The type editor then shows "{name} (archived)".
35. Administrator opens Settings > Organization > "AI analysis" at `/settings/ai-analysis`. Expects four collapsed cards plus the open "Request conversion" card once a connector exists.
36. Administrator expands "Provider". Picks a provider and "Protocol". Enters "Base URL" or "Deployment endpoint", "API key", clicks "Load models" and picks a "Model", or uses "Enter model ID manually". Sets "Output token limit per API call". Clicks "Save connector", then "Test connection". Expect "Connection successful." Expect the chip to read "Connected".
    36a. Wrong key. Expect a failure message and chip "Not connected".
    36b. Low token limit. Expect the warning that analyses are more likely to fail.
37. Administrator checks the "Use AI analysis" switch. Off shows "Off since {when}…". Leave it on.
38. Administrator turns on "Fill Contract Fields after conversion" and "Prepare Contract conversions with AI" in "Request conversion".
39. Administrator opens "Answer style" and picks "Few word summary", "1-2 sentence summary" or "Full clause text". Reloads. Expect the choice kept. Without a connector expect "Connect an AI provider to choose an answer style."
40. Administrator opens "Contract analysis prompts", edits one prompt, then uses "Reset to default". Hovers the help icon beside a label. Expect the format sentence tooltip after about half a second. Follows the "Contracts → Fields" link.
41. Administrator opens Settings > Organization > Integrations > "E-signature" at `/settings/integrations/e-signature`. Expands the "DocuSign" card. Expect chip "Not connected" and the intro that the manual path still works.
42. Administrator picks "Environment" Demo, "Signing updates" Polling, and enters "Integration key", "User ID" and "RSA private key". Clicks "Save connector", then "Test connection". Expect "Testing the connection…" then "Connected to {account}."
    42a. Missing RSA key: "Paste the RSA private key DocuSign issued for the integration."
    42b. Webhook mode without a secret: "Paste the DocuSign Connect HMAC secret before selecting Webhook."
    42c. Webhook mode with an http or query-string callback URL. Expect only a general refusal in the pane.
    42d. Bad credentials. Expect "The connection test failed." followed by a reason, for example "DocuSign refused the connector's credentials…".
    42e. Switch to Webhook with a secret and an HTTPS "Public callback URL". Save. Expect the read-only "Webhook URL" with "Copy". Click it and expect "Copied".
43. Administrator checks the switch "Send for signature from records" is on.
44. Administrator opens Settings > Organization > Notifications, "Reminder lead times". Expect the seeded 7, 1 and 0 days. Adds one, reorders, removes one. Try to remove the last one and expect a refusal.
45. Administrator confirms outbound email is configured, so emails in later scripts can be read in Mailpit or the real inbox.
46. Optional, fresh install only. In the onboarding wizard Review step at `/welcome`, "Start blank" removes seeded vocabulary. It keeps Other, Default, Draft, Active, Expired and, WIP, Partially signed.
    46a. After setup completes: "Instance setup is complete. Manage each list in Settings."
    Watch: Start blank removes every Review and Approval Status and, without WIP, every Signature Status. A later direct send then fails after DocuSign accepted, with "Configure a live Signature status before sending for signature."

### 4.2 Contracts list, filters and saved views (Legal Team Member)

1. Legal opens "Contracts" in the primary navigation at `/contracts`. Expect "Contracts" and "{n} contracts", or "{shown} of {total} contracts" when more rows exist.
   1a. Business User opens `/contracts`. Expect a redirect to `/`.
2. Expect eight default columns: "Reference", "Title", "Counterparty", "Type", "Status", "Value", "Owner", "Next deadline". Ended and archived Contracts are hidden.
3. Legal clicks a Title. Expect the record. Rows are not clickable elsewhere.
4. Legal clicks a Next deadline cell. Expect it to open the record's Tasks or Key dates tab. An AI-written date shows the Unverified marker.
5. Legal sorts by each sortable header: Reference, Title, Counterparty, Type, Status, Owner, and optional Risk, Priority, Starts, Expires, Our entity, Created, Updated. Expect ascending, descending, then off. Status sorts in the Administrator's order.
6. Legal opens "Columns". Shows the optional "Risk", "Priority", "Starts", "Expires", "Notice by", "Term left", "Term", "Our entity", "Created", "Updated". Expect Title to be checked and disabled. Uses "Move {column} earlier" and "Move {column} later".
7. Legal drags a column edge to resize it, then uses the arrow keys on "Width of the {column} column". Drags Title to a fixed width and expect "Fill the width" to appear. Clicks "Reset columns".
8. Legal opens "Filter". Searches in "Search filters". Adds "Owner" with "Me". Expect a chip and a matching count. Home's "Your Contracts" link should open the same Owner: Me view.
9. Legal adds "Owner" "Unassigned", then "Status" and "Type" with several values each. Expect "Matches any selected value" and "Apply".
   Watch: Status, Type and Owner choices come only from existing reachable Contracts. An unused Status is not offered.
10. Legal adds "Effective date" and "Expiry date" ranges, one with only "From". Expect "Includes both dates".
    10a. End before start: "End date must be on or after start date."
11. Legal adds "Show ended" and "Show archived". Expect ended and archived rows to appear. An archived row shows an "Archived" pill and an "Actions" column with "Restore".
12. Legal clicks "Restore" on an archived row. Expect it back in the live list.
    12a. Restore fails. Expect "{reference} could not be restored." or the server text.
13. Legal clicks a chip to edit it, removes one with "Remove {filter} filter", then "Clear all". Uses browser Back, Forward and refresh. Expect the filters, sort and view to follow the URL.
14. Legal scrolls to "Show more". Expect "{n} more contracts. {total} shown." and the list state kept.
    14a. Paging fails: "The next contracts could not be read. Try again."
15. Legal opens the Views menu. Expect "Default view". Changes a column and expect "Modified". Clicks "Save as…", keeps or edits the prefilled "{name} copy" and clicks "Save".
    15a. Same name as an existing view: "You already have a view with that name on this list."
    15b. 26th view: "A list holds at most 25 saved views."
16. Legal changes the saved view and clicks "Save". Then "Rename…" and "Rename". Then "Set as default" and expect "Opens here". Leaves and returns to `/contracts`. Expect the default view to open.
17. Legal clicks "Discard unsaved changes" after an edit. Expect the saved layout back.
18. Legal clicks "Delete…" and "Delete". Expect "{name} is removed. The records in it are not touched."
19. Legal applies filters that match nothing. Expect "No contracts match these filters" and "Clear a filter to widen the list." With only archived filter and none archived, expect "No archived contracts".
20. On an empty install, expect "No contracts yet" with a "Create contract" button.
    Watch: there is no free-text search box on the list, no row selection, no bulk actions and no export. Search is global at `/search`. The brief asked for bulk actions on this list; none exist.
    Watch: the column and filter say "Owner" while the record and create dialog say "Legal Owner".

### 4.3 Creating a Contract

#### A. Direct creation from the list

1. Legal clicks "Create contract". Expect the dialog "Create contract" with "Title" focused, "Contract type" preselected to the Default type, and "Legal Owner" seeded with the current user.
2. Legal clicks "Create" with the Title empty. Expect "Name the contract." Clears the type. Expect "Pick a contract type."
3. Legal types a Title and picks NDA. Expect NDA's Intake and Creation Rows to appear. Switch to MSA and back. Expect the Rows to change and drafts for NDA to be kept.
4. Legal fills the Rows. Built-ins can include "Description", "Entity", "Counterparties", "Department", "Region", "Priority", "Risk", "Term type", "Effective date", "Expiry date", "Renewal period", "Notice period", "Value", "Needed by".
   4a. Counterparties: type a new name and pick 'Add new "{name}"'. Type an existing name and pick it. Expect the first marked "Primary". Remove one with "Remove {name}".
   4b. Value: enter "Amount", "Currency", "Frequency" Other and a "Custom cadence". Leave the currency empty: "Pick a currency for the amount." Leave the cadence empty: "Enter a custom cadence." Type letters in the amount: "Enter the amount as a number."
   4c. Term type Evergreen: expect no expiry. Fixed term with a renewal period is refused by the server: "A renewal period applies only to an auto-renewing contract."
   4d. Leave a required custom Field empty. Expect "Fill {field}", then the rest of the sentence, and a star on the Row.
   4e. Leave a required built-in Row empty, such as Counterparties. Expect the client to let it through and the server to refuse with "Fill Counterparties."
   Watch: required built-in Rows are not checked in the dialog. The server message uses API labels, for example "Our entity", while the Row says "Entity".
5. Legal changes "Legal Owner" to a colleague, or to "Unassigned".
   Watch: the colleague picked here gets no notification. Only a change on the record or the Inbox Assign sends one.
6. Legal searches "Matter" by number or title and picks one. Clears it. Picks it again.
   6a. The search fails: "Eligible Matters could not be searched."
   6b. The Matter's Confidential flag differs from the switch. Expect "This Contract and Matter will have different Confidential flags…"
7. Legal leaves the "Confidential" switch off for now. Attaches two files with "Attach documents" or by drag and drop. Picks one "Document type" for both.
   Watch: one Document type applies to every attached file.
8. Legal clicks "Cancel". Expect no Contract. Repeats steps 1 to 7 and clicks "Create".
9. Expect "Record created. Uploading documents…", then the new record at `/contracts/{n}` in Status "Draft". Expect the first file to be the primary Document.
   9a. One upload fails. Expect "Record created. Some documents could not be uploaded." with "Retry failed uploads" and "Continue". Retry must not create a second Contract.
   9b. Server refusal. Expect "The contract could not be created." and the form kept.
   Watch: the Title field has no length cap. Over 200 characters returns a raw schema error.
10. Default people from Script 4.1 step 19 each receive "You were added to a Contract team" in the bell, an email "You were added to {title}" and a push. The Business User default person sees the Contract in the Portal.
11. Legal opens "History". Expect "created" and any "linked to Matter" and team-added entries.

#### B. From a Matter

12. Legal opens a Matter's linked Contracts card and clicks "New contract". Expect the create dialog with the Matter preselected. Create it. Expect both records to link.

#### C. From a converted Request

13. Business User submits a Request in the Portal whose Request type targets Contracts. Expect the Portal receipt.
14. Legal opens the Request in the Inbox, clicks "Triage", then "Convert to contract". Expect "Convert {reference} to a contract" and "{requestType} · submitted by {requester}".
15. With "Prepare Contract conversions with AI" on, expect "Getting contract ready…" and a Conversion draft. Closing the dialog keeps it working; the bell reports when it is ready.
    15a. Preparation fails: "Preparation could not finish. Retry or continue manually." Click "Continue manually".
    15b. Sources disagree: expect a conflict list. Click "Discard AI suggestions" on a second try.
16. Legal edits "Title", "Contract type", "Description", "Priority" and the type's creation Rows. Expect no Legal Owner and no Confidential control.
    16a. "Convert to matter instead" re-targets. Cancel it.
    16b. Archived person in a user Field: "{value} is archived. Pick a live person to convert."
17. Legal clicks "Convert to contract". Expect the Request page to link to the new Contract. The converter is Legal Owner. The Requester is Business Owner with a team row. Default people join and are notified.
    17a. Another Legal Team Member converted first: "Somebody else already converted this request." and "It became {record}."
    Watch: the Requester gets no team-added notification, only the Request status change.
18. Business User receives the Request status email. The Portal Request now redirects to the Contract.
19. With "Fill Contract Fields after conversion" on, expect a pending Analysis run on the new Contract. See Script 4.4 steps 13 to 20.

#### D. From an Auto-Doc Generation, and Unassigned contracts

20. Administrator has an Auto-Doc with "Target Contract Type", "Title pattern", "Our Entity", "Default Legal Owner" set to "None, leave unassigned", and one "Assignment rules" row. This is set up in the Auto-Docs audit.
21. Business User runs a Generation in the Portal with answers that match no rule. Expect "Created Contract: {contract}". The Contract is in Draft, the output is its primary Document and the Business User is Business Owner.
22. Every Member+ receives "A generated Contract needs a Legal Owner" in the bell. Email is opt-in.
23. Legal opens the Inbox tab "Unassigned contracts ({count})". Expect columns "Ref", "Contract", "Auto-Doc", "Generated by", "Created".
24. Legal clicks "Assign", searches in "Search people", picks a "Legal Owner" and clicks "Save assignment". Expect the row to leave the queue.
    24a. Someone assigned it first: "This Contract already has a Legal Owner."
25. The chosen Owner receives "You were assigned a Contract" and the email "You are now the owner of {title}".
26. A Generation whose rule matches instead sends the named Owner "A Contract was generated and you are its Legal Owner".
    Watch: the queue lists only Generation-made Contracts. A Contract created without an Owner in the dialog appears only under the list's Owner "Unassigned" filter.
    Watch: the API has a claim endpoint that no UI calls.

### 4.4 Main lifecycle: from a new Contract to Active (Legal, Approvers, Signers)

Start from the Contract created in Script 4.3C, with the Requester as Business Owner.

#### Overview and header

1. Legal checks the sub-bar. Expect the breadcrumb "Contracts", the icon, "C-{n}", the title, the Status pill and the Stage strip Draft, Review, Approval, Signature, Active, Ended.
2. Legal opens "Contract actions" and clicks "Copy link". Expect "Copied" for two seconds.
3. Legal clicks "Rename contract". Expect Overview with Title focused and selected. Types a new title and presses Enter. Expect "Saving…" then "Saved". Clears the title and blurs. Expect it to revert with no message.
4. Legal edits "Description". Escape abandons an unfinished edit. On a converted Contract a toggle shows the Requester's original description.
5. Legal changes "Contract type" to one with required Fields the record has not answered. Expect "Change contract type" and "{type} requires these fields. Fill them to change the type." Clicks "Cancel". Repeats, fills them and clicks "Change type".
6. Legal sets "Department", "Priority", "Risk" including "Not assessed", "Region" and "Our entity". An unreachable Entity reads "Restricted Entity".
7. Legal uses the Counterparties card. Types in "Find or create a counterparty" and picks 'Create "{name}"'. Adds a second one. Clicks "Make primary" on it. Removes the old primary with "Take {name} off the contract". Expect the flag to pass to the next one.
   7a. Two quick changes. Expect "One change at a time. Wait for the last one to save."
   7b. Add the same counterparty twice. Expect "That counterparty is already on this contract."
   Watch: there is no Counterparty list, record, edit, merge or archive anywhere. Counterparties are created only by typing a name.
8. Legal edits "Value". Clearing the amount clears the whole value. Escape reverts all parts.
9. Legal sets the Legal Owner with the "Legal Owner" picker, searching "Search people". The new Owner receives "{actor} made you the Owner of {contract}" and the email "You are now the owner of {title}". Clearing the Owner sends nothing.
   9a. Pick a Business User. Expect them not offered. The API would say "The Owner must be a live Administrator or Legal Team Member."
10. Legal sets the "Business Owner" to another person. Expect a team row for them and a "You were added to a Contract team" notification. The former Business Owner keeps their team row.
11. Legal opens the "Contract team" applet. Expect Legal Owner, Business Owner and Creator statement rows, then team rows. Clicks "Add team member", picks a "Person" and clicks "Add". The added person is notified.
    11a. No person picked: "Pick a person."
    11b. Remove the Business Owner's row. Expect no X on it. The API says "Change the Business Owner before removing this person from the team."
    11c. Remove another member with "Take {name} off the contract team". No notification is sent.

#### Tasks

12. Legal opens "Tasks". Expect "No tasks on this contract yet." Clicks "Add task". Enters "Title" "Review contract", a "Description", picks an "Assignee" and a "Due date". Adds a note in "Add a note" and a file with "Attach files". Clicks save.
    12a. Empty title: "Name what needs doing."
    12b. Assignee outside the team: pick "Add someone to the team…", search, then "Add to team and assign". Expect both the team row and the assignment. Cancel once and check nothing changed.
    12c. Note or files fail after the Task was created. Expect "Retry note & attachments", and no second Task on retry.
    Watch: adding someone to the team and assigning sends two notifications.
13. The assignee receives "{actor} assigned you a task on {contract}", the email "Task assigned: {task} ({contract title})" and a push.
    Watch: the email button opens Overview, not Tasks.
14. Legal clicks the task title. Expect "Task details" with its own comments. Posts a comment. Expect "Visible to everyone who can access this task."
15. Legal ticks the checkbox to complete it. Expect "{done} of {total} done" and the row hidden. Turns on "Show completed" and reopens it. Uses "Edit task". Tries "Remove task" on the commented task: "This Task has a conversation on it, so it cannot be removed. Mark it done instead." Removes an uncommented task with no confirm.

#### Fields tab and AI analysis

16. Legal opens "Fields". Expect the type's catalog Fields in Form order. With none: "This contract type attaches no fields. Add them in contract settings."
17. Legal edits each Field type: text, long text, number, currency, date, boolean ("Yes"/"No"), single select, multi select checkboxes, user and entity. Letters in a number: "{fieldName}: enter this as a number."
    Watch: the boolean control has no empty choice, so a Boolean cannot be cleared.
18. Legal opens "Contract actions" and clicks "Run analysis", or the button on the Fields header. Expect "Running…". The page keeps typed drafts while it polls.
    18a. No AI connector, or "Use AI analysis" off. Expect no "Run analysis" item.
    18b. No primary Document or no ready text. Expect a refusal shown on the Fields tab.
    Watch: the Fields header button shows even without a primary Document. A refusal from the menu shows only on the Fields tab.
19. The run ends ready. Expect Unverified markers on written values: core values on Overview, catalog Fields on Fields, dated events on Key dates with a purple chip "{n} unverified Key dates". Nothing is announced on success.
    19a. The run fails. Expect "Analysis failed: {reason}". A conversion run also shows "Retry Request-context Analysis".
    Watch: a run that wrote nothing gives no feedback. A run can stay pending for good if the worker dies, because there is no sweep.
    Watch: "Retry Request-context Analysis" shows even when the Administrator switch is off, and then fails with 409.
20. Legal clicks the sparkle "View AI evidence for {field}". Expect the Document reader with Find pre-filled on the quote. With no quote: "No source quote was saved for this field."
21. Legal clicks "Confirm" on one value. Expect its marker gone and others kept. Edits another value by hand. Expect its marker gone. Clicks "Confirm all" in the header.
    Watch: "Confirm all" also clears markers on Rows the page hides, such as Risk, Region and Department.
    Watch: clearing an AI value by hand silently blocks all future AI fills of that slot.
22. History shows "analysis completed" as OpenLaw, and each confirmation.

#### Documents, Versions and Comparison

23. Legal opens "Documents". Expect columns Name, Type, Version, Modified, and the header "Show archived", "New folder", "Upload".
24. Legal clicks "Upload" on a Contract with no Documents. Picks one Word file in "Choose files", sets "Type" "Draft · ours" and a "Note". Clicks "Upload". Expect a "Primary" pill and "{actor} made {title} the primary document" in History.
    24a. No file: "Choose a file to upload." Over 100 MB: "That file is over the 100 MB upload limit."
25. Legal uploads two more files at once, and a folder with "Choose folder". Expect the batch dialog "Import # files", "Destination", "Folder structure is kept" and one Type for all. Expect it to close when all succeed.
    25a. One file fails. Expect "Imported X of Y files", "Retry", "Retry # files", "Cancel remaining", "Done".
    25b. An unreadable folder: "# folders could not be read: {names}…"
26. Team members receive "{actor} added a document to {contract}" in the bell. Email is opt-in.
27. Legal clicks "New folder", names it and saves. Uses the folder menu for "Rename", "Move", "New subfolder", "Delete". Deleting says "Anything in it moves onto the contract itself. Nothing is deleted."
    27a. Errors: "Give the folder a name.", "A folder named {name} is already here.", "A folder cannot be named . or ..", "Folders can be nested 10 deep. Put this one higher up."
28. Legal moves a Document with "Move to folder", then drags another onto a folder row. Drags one back onto "Drop here to move out of folders".
29. Business User uploads the counterparty's redline in the Portal as a new Version of the primary Document with "Add version". See Script 4.9 step 5.
30. Legal uses the row menu "Add version" on the primary Document. Uploads the next Word draft, Type "Redline · ours", with a note. Expect Version 2 current and "Show the 1 earlier versions of {title}". Team members receive "A Document Version was added" notifications.
31. Legal corrects a Version's Type in the Type cell. Expect "{actor} changed the type of version {n} of {title}".
32. Legal uses "Edit details" to rename a Document and add a description. Blank name: "Give the document a name."
33. Legal clicks a Document name. Expect the reader panel with "v{n}", a "Compare" chip and "Download". For Word expect "Preparing this document for reading…" then the PDF rendition. Uses "Previous page", "Next page", "Zoom in", "Zoom out", and "Find in document" with Ctrl+F. Closes with Escape.
    33a. Unsupported file: "This file type does not open here. Download it to read it."
    33b. Email file: Subject, From, To, attachments and "Back to the message".
    Watch: Find uses the PDF text layer. A scanned PDF answers "No matches" even when OCR text exists.
    Watch: text extraction and OCR state are never shown.
34. Legal clicks "Compare with previous" in the row menu. Expect `/documents/{id}/compare` with "Preparing comparison", then "Changes" and "Compared document". Uses "Previous change" and "Next change". Expect wrap-around.
35. Legal opens the "v{from} → v{to}" pill and changes "Older" and "Newer".
    35a. A PDF against Word pair. Expect the text-mode banner "This comparison was built from extracted text, so formatting is not shown." and "Export needs two Word files."
    35b. A pair with a failed extraction. Expect "Comparison failed" and "Download {filename}" for each side. There is no retry.
    35c. Two identical files. Expect "No changes".
36. Legal clicks "Export track changes" on a Word pair. Expect a new Version "{title} v{from}-v{to} redline.docx" with a "Generated redline" pill and "Compares v{from} and v{to}". The button becomes "Open redline". Export again and expect no second Version.
    Watch: the redline becomes the current Version, so "Compare with previous" disappears from the current row.
37. Legal uses "Mark as executed copy" on a Version and then "Unmark as executed copy". Expect grey "Executed" text in the Version column. Leave nothing pinned.
38. Legal archives a supporting Document with "Archive". Turns on "Show archived" and clicks "Restore".
39. Legal selects several Documents with the checkboxes. Expect the toolbar "{count} selected", Move, Archive and "Clear selection".
40. Administrator uses "Delete version" on a superseded Version. Expect "Delete version {n}?" and a field that needs the word "delete". WIP.
    40a. The Version feeds a Generated redline: "A generated comparison version uses this version. Delete that comparison version first."
    40b. Deleting the last Version also removes the Document.
    Watch: per-Version delete contradicts DOC-001 and DOC-010, which say Versions are immutable. The UI no longer offers whole-Document erasure.
    Watch: deleting a pinned Version clears the executed pin with no History entry. Deleting an Envelope's source Version has no guard.
41. Legal marks one Document confidential with "Mark confidential". Expect the lock marker. A team outsider no longer sees it.

#### Approvals

42. Legal moves the Status to "Internal review", then "Awaiting approval" with the Stage pill "Move to" menu. Team members and the Business User see "{actor} changed the status of {contract} to {status}" in the bell. Email is opt-in.
43. Legal opens "Approvals". Expect "No approvals requested on this contract yet."
44. Legal clicks "Apply group". Expect "Apply approver group" with the type's default preselected. Expect "Asks {names}." Clicks "Apply group".
    44a. Default group archived: "Default group unavailable" in the option.
    44b. Policy "Administrators only" and viewer is Legal. Expect the select disabled with "Only an administrator can choose a different group."
    Watch: that policy does not restrict "Add approver", so Legal can still ask anyone.
45. Legal clicks "Add approver", ticks a Legal Team Member and clicks "Request approvals". Expect rows with "Pending" and "Requested by {name}". The tab chip reads "{n} open approvals".
    45a. Nobody picked: "Pick at least one approver."
    45b. A person with a pending ask is not offered. With nobody left: "Everybody who can approve this contract already has a request open."
    45c. On a Confidential Contract, a staff person outside the team: "{name} can't see this contract, so they can't be asked to approve it."
46. Each Approver receives "{actor} asked you to approve {contract}" pinned under "Your approvals" in the bell, a push, and the email "Approval requested: {title}" with "Review approval". The asker gets nothing.
    Watch: the staff email links to Overview, not the Approvals tab.
47. Legal Team Member Approver opens the Approvals tab, uses the row "…" menu, clicks "Approve", adds a "Note" and clicks "Approve". Expect "A decision is final. To change it, ask for a new approval." in the dialog, then "Approved" and the date.
    47a. Someone else tries to decide. Expect no menu.
48. Business User Approver decides in the Portal. See Script 4.9 steps 8 to 11. Choose "Reject" with a note there.
49. Legal sees "Rejected" appear without a reload.
    Watch: nobody is notified when an Approval request is decided.
50. Legal asks the rejecting Approver again with "Add approver". Expect a new pending row under the rejected one. The Approver approves it.
51. Legal cancels a pending request with "Cancel request". Expect it gone and "cancelled the approval request" in History. There is no confirmation.
    51a. Try to cancel a decided request. Expect no menu item.
52. Legal moves the Status to "Out for signature" while any row is pending or rejected. Expect the Soft gate "Move past approval" listing the unresolved approvers. Clicks "Cancel". Repeats and clicks "Move anyway". Expect two History entries: the status change and "moved this contract past approval, overriding {approvers}".
    Watch: an old rejected row counts as unresolved for good, even after the re-request is approved. The Soft gate fires on every crossing and the tab chip keeps counting it.

#### Sending for signature

53. Legal opens "Signatures". Expect "No signature requests on this contract yet." and the button "Send for signature".
    53a. No Signing connector, or the switch is off. Expect no button. Go to fork 56b.
    53b. No primary Document the viewer may see. Expect no button.
54. Legal clicks "Send for signature". Expect the dialog "Send for signature" with "Version" defaulting to the current Version, "Signers", the partial-signing question (WIP), "Subject" and "Send envelope".
55. Legal fills Signers. Types a colleague's name and picks them from "People in OpenLaw". Expect a chip "Uses their OpenLaw email". Adds an external Signer by name and email. Uses "Add signer" and "Remove signer {n}".
    55a. A blank name or email: "Give every signer a name and an email address."
    55b. Same email twice: "Each signer needs their own email address."
    55c. Archived user picked: "One of the people picked to sign is not an active user of this install…"
56. Legal answers "Will the agreement be fully signed when this DocuSign round is complete?" Expect "Send envelope" disabled until one is chosen. WIP.
    56a. Connector present. Choose "Yes, all required signatures will be in place". Click "Send envelope". Expect a row "Out for signature" with Signers, Document, Version and Sent date. The Contract moves to the first Signature Status. History: "{actor} sent this contract for signature".
    56a-i. DocuSign refuses: "The provider would not take the envelope…" No row is kept.
    56a-ii. DocuSign does not answer: "The provider did not confirm the envelope. It stays reserved on this contract until its outcome is known." The row reads "Creation uncertain". Click "Refresh status".
    56a-iii. A second send while a round is live: "This contract already has a live envelope…"
    Watch: sending works from any Stage. It pulls an Active or ended Contract back to Signature and skips the Soft gate.
    Watch: after an uncertain answer, a retry gets the live-envelope refusal. The web client drops the idempotency key.
    56b. No connector. Manual hand-off: move Status to "Out for signature", sign outside OpenLaw, upload the signed PDF with "Add version" and Type "Executed", use "Mark as executed copy", then move Status to "Active". No Envelope row is made.
57. Signer receives DocuSign's invitation. Subject is the dialog Subject, or "C-{n} {title}". Signer signs at the "/sig/" anchor or free-form.
    57a. Signer declines with a reason. Expect "Declined" with the reason under it. The Contract Stage does not change. Legal can send again.
    57b. Legal voids: row menu "Void envelope". Expect "Void envelope" and "The signers can no longer sign this round. The contract can be sent again straight after." Blank "Reason": "Say why this envelope is being voided." Expect "Voided" with the reason.
    57b-i. Someone other than the sender, Owner or Administrator. Expect no menu.
    57b-ii. DocuSign says it has already ended: "The provider says this envelope is no longer live…"
    Watch: the Void menu still shows while the connector is turned off, and the refusal wrongly says there is no connector.
58. All Signers sign. Within about 15 to 20 minutes in Polling mode, or at once with Webhook, expect "Signed" and "Filing the signed copy…".
59. Expect a new Version "{stem} (executed).pdf", Type Executed, authored by the sender, and pinned. History by OpenLaw: "added version {n}" and "pinned version {n} as the executed copy". The Contract moves to the first Active Status. The row shows the "Executed copy" link.
    59a. Filing fails: "The signed copy could not be filed. Upload it to the record instead." Use the manual hand-off steps.
60. Owner and team receive "Signing ended on {contract}" in the bell, and "A version was added to {contract}" and the status change. Emails are opt-in: "Signature complete: {title}".
    Watch: a Business User on the team never receives the signing-ended notice, only the status change and the new Version.
61. AI analysis runs again on the pinned Version if AI is on.

#### Partial signing (WIP)

62. Legal sends a round and answers "No, more signatures will still be needed". Help says the Contract will move to Partially signed and stay in the Signature Stage.
63. The round completes. Expect "{stem} (partially signed).pdf" with no Type, the note "Partially signed; additional signatures are required.", no pin and no analysis. The Contract moves to "Partially signed". The row link reads "Partially signed copy". The pill still reads "Signed".
    Watch: the Signatures row may stay on "Filing the signed copy…" until a reload, because the partial copy writes no event the tab listens to.
    Watch: partial signing has no decision record and no CONTEXT.md entry.
64. Legal sends the next round with "Yes". Expect the Contract to move back to "Out for signature". On completion expect the executed copy, the pin and Active.
    Watch: the "Yes" and "No" help promise a Status move that happens only while the Contract is still in the Signature Stage.
    Watch: every e2e envelope journey still clicks send without answering the new question, so they will fail.

### 4.5 E-signature edge paths (Administrator, Legal)

1. Administrator turns off "Send for signature from records". Expect "Off since {when}. New preparations and Resume links are refused…". Legal's Signatures tab loses the send button. A live round still gets status updates.
2. Administrator tries "Remove connector" while a round is live. Expect a 409 with the count and advice to turn the connector off.
3. Administrator rotates the RSA key for the same account. Expect success. Changes to another account while rounds are live. Expect the 409 about keeping the original account.
4. Administrator tests the connection while the connector is off. Expect "No e-signature connector is configured. Save the credentials first."
   Watch: that message is wrong for a connector that exists but is off.
5. Webhook mode. Send a forged or unsigned delivery to `/api/v1/signing/docusign/webhook`. Expect 401 "This delivery is not signed by this install's Connect key."
   Watch: an untracked real DocuSign status also gets 401, so DocuSign keeps retrying.
6. Webhook delivery fails, for example the gateway is down. Wait for the reconciliation sweep, which runs every 5 minutes with at least 15 minutes between reads of one Envelope. Expect the status to converge and the executed copy to file.
7. Administrator turns the connector back on. Expect sending to work again.
8. Administrator removes the connector after all rounds end. Confirm in "Remove the DocuSign connector". Expect "Not connected" and the manual path on records.
9. Signer erasure. Administrator calls `POST /api/v1/signer-erasures` with an external Signer's email. There is no UI. Expect counts in the answer. The Signatures row lists fewer Signers. History payloads show "[erased]".
   9a. A user's address: "That address belongs to a user of this install…"
   Watch: there is no UI for this and no tombstone on the row.

#### Preparation with Sender View (lab mode only)

This path is off unless the host sets `SIGNING_PREPARATION_ENABLED=true` with the stand-in or the live lab. Skip it on a normal build.

10. Legal clicks "Send for signature". Expect the dialog title "Prepare Envelope" and the submit "Continue to DocuSign".
    Watch: the header says "Send for signature" but the dialog says "Prepare Envelope". The user guides still say "Prepare Envelope".
11. Legal continues. Expect History "started preparing this contract's envelope", a row "Draft, not sent" with "Prepared by {name}", then DocuSign opens in the same tab on the field tagger.
12. Legal places fields and uses Save and Close. Expect the return route, sign-in if needed, and the Signatures tab with "Draft".
13. Legal clicks "Resume in DocuSign". Expect a fresh link and History "requested an editing session".
    13a. Another launch is in progress: "Another launch is in progress. Wait, then Resume this same Envelope from Signatures."
    13b. The primary Document changed since preparing: "The primary Document changed. This preparation still uses {document}, Version {version}…"
    13c. The connector is off: "The Signing connector is disabled…"
14. Legal clicks Send inside DocuSign. Expect "Waiting for confirmation", then "Out for signature" after a provider read.
    Watch: the working tree now moves the Contract Stage on this confirmed send. The #1172 addendum and the user guides say it does not.
15. Legal discards a draft with DocuSign's own Discard. Expect "Discarded" only after a provider read confirms it.
16. Open a forged or expired return link. Expect "This signing return is unavailable" and "Go to Home".
17. A Draft scheduled in DocuSign reads "Scheduled in DocuSign" with no Resume. A discarded round restored in DocuSign reads "Restored outside OpenLaw. Review this Envelope in DocuSign."
18. An uncertain creation shows "Creation uncertain", "Checks made: {attempts}" and "Next check no earlier than {time}". When recovery stops, expect "Automatic recovery has stopped. Ask your Administrator…"

### 4.6 Term, renewal, Key dates and reminders (Legal)

1. Legal sets "Term type" to "Auto-renewing", "Effective date", "Expiry date" a few days ahead, "Renewal period (months)" 12 and "Notice period (days)" 30 on Overview.
   1a. Change to "Evergreen". Expect the expiry cleared and shown read-only. The server refuses an expiry: "An evergreen contract has no expiry date."
   1b. Change to "Fixed term". Expect the renewal period cleared. Each clear appears in History.
   1c. Non-whole number: "Enter this as a number."
   Watch: nothing checks that expiry comes after the effective date.
2. Expect "Days remaining" to read "{n} days left", "Expires today" or "{n} days past expiry". Expect the "Term timeline" card with "Initial term", the Notice deadline mark and "Today".
3. Legal opens "Key dates". Expect derived rows "Current term expires" and the renewal notice deadline, marked Derived, and the chip "{n} upcoming dates".
4. Legal clicks "Add date". Enters "Date", "Event" and "Note". Adds an extra lead time and ticks recipients, including the Business User. Saves.
   4a. Missing date or event. Expect a refusal. Past dates are allowed.
   4b. Tick "Use the usual audience". Expect the recipients list cleared.
   Watch: the dialog's "Global reminders" line ignores each person's own lead times. An invalid extra lead time silently disables the save button.
5. Legal edits the date with "Edit date" and removes another with "Remove date". There is no confirm.
6. An AI-extracted Key date shows Unverified and "Confirm". Confirm it. Expect the purple chip to drop and the standard chip to rise if the date is upcoming.
7. Administrator triggers the morning round, or waits for local 08:00. Expect bell items "{keyDate} on {contract} is coming up", "The notice deadline on {contract} is coming up" and "{contract} is expiring", plus one briefing email "{n} dates on your contracts". The Business User receives only the Key date reminder.
   Watch: a Business User's reminder links to the Portal Contract, which has no Key dates list.
8. Legal lets the expiry pass. Expect the yellow banner "Renewal date passed" with "Review renewal". The Status does not change.
   Watch: nothing notifies anyone when an auto-renewing expiry passes.
9. Legal clicks "Review renewal", or "Renew" on the Approvals tab. Expect "Confirm renewal" with four choices.
   9a. "Confirm the roll". Expect "New expiry date" seeded to expiry plus the renewal period and "The term currently runs to {date}". Confirm. Expect the banner gone, "Last renewal" set, and a row under "Renewals" on the Approvals tab. A date that does not move forward is refused.
   9a-i. Another tab confirmed first. Expect a 409 and a reload. The term moves once.
   9b. "Paper as amendment". Expect the Documents tab with "Add version" open on the primary Document and Type Amendment. Absent when there is no primary Document.
   9c. "Create child contract". Expect "Create child contract" with "Prefilled from {reference} and born under it…". Create it. Expect the child under "Children" on the parent.
   9d. "New successor contract". Expect "Create successor contract" with "Prefilled from {reference} and linked as its renewal…". Create it. Expect "Renews" on the new record and "Renewed by" on the old.
   Watch: after 9b, 9c or 9d the old record's banner stays up until someone rolls or ends it. There is no undo and no decline choice.
   Watch: Renew is offered on an ended Contract.
10. Next deadline. Check the list column shows the earliest upcoming Key date, open dated Task, expiry or notice deadline, and opens its tab.

### 4.7 Relations, Matter link, comments and History (Legal)

1. Legal opens Overview "Related contracts". Expect "No related contracts." Clicks "Add link". Expect "Link contract", a search "Search by number or title…" and "Link type" Related, Renews or Amends. Links one of each.
   1a. Same link twice: "These two contracts are already linked that way."
   1b. Link to itself: "A contract cannot be linked to itself."
2. Legal opens the other Contract. Expect the reverse labels "Renewed by", "Amended by" and "Related".
3. Legal clicks "Remove link" with no confirm.
   Watch: removing from the "Renewed by" or "Amended by" side may fail.
   Watch: a link whose far Contract is archived cannot be removed. The card shows only "Could not unlink these contracts."
   Watch: when the immediate parent is a Restricted contract, "Set parent" stays hidden and "Remove parent" is absent, so the viewer can neither replace nor clear it.
4. Legal clicks "Set parent" and picks an MSA. Expect the breadcrumb "Contracts > C-{parent}". Tries to set a child as parent: "That contract already sits under this one. Pick another parent." Clicks "Remove parent".
5. Legal links a Confidential Contract to an open one. Expect "Flag as confidential?" with "No, leave it open" and "Flag as confidential".
6. A Legal Team Member outside a Confidential relative sees "Restricted contract" with no number or title. The breadcrumb shows "…".
7. Legal uses the "Matter" card to link a Matter, change it and "Unlink" it. A Confidential mismatch shows advice and "Leave them as they are". An unreachable Matter shows "Restricted matter".
   Watch: the "Restricted matter" message id is missing from en-US.json.
8. Legal opens "Comments". Picks the audience "Legal Only" or "Contract Team". Posts "Add a comment…" with "Comment". Expect the button disabled when empty.
9. Legal types "@" and picks a person outside the chosen audience. Expect "Widen the audience?" and "Widen and post". The mentioned person receives "{actor} mentioned you on {contract}" and the email "You were mentioned on {title}". Team members get "{actor} commented on {contract}" in the bell.
10. Legal attaches files, then uses "File to Contract" on one. Picks "New Document", then on another "New Version on an existing Document". Expect "Filed to {title}, version {n}".
11. Legal edits their own comment and sees "edited". Deletes it: "Delete this comment?" then "Comment deleted by its author."
12. Administrator redacts another person's comment: "Redact this comment?" then "Comment removed by an Administrator."
    Watch: email tier labels say Working Team and Full Thread while the composer says Contract Team.
13. Legal opens "History". Expect newest first, 25 at a time with "Show older", "{from} → {to}" lines, "OpenLaw" for system entries and "{actor}, via {client}," for MCP actions. Check entries from every script above appear.

### 4.8 Confidential, permissions, Ending and Archiving

#### Confidential

1. The Creator turns on the "Confidential" switch at the bottom of the Contract card. Expect the banner "Confidential contract", then "only the contract team and owner can access this contract", with "Manage team".
   1a. A team member who is not Administrator, Creator or Legal Owner. Expect the switch disabled.
2. An Administrator who is not on the team opens the Contract URL. Expect "Contract not found" and "C-{n} does not exist, or you cannot open it." The Contract is missing from the list, search, mention pickers and the Unassigned queue.
3. A plain team member opens "Contract team". Expect "Add team member" and every remove X drawn but disabled.
4. The Legal Owner adds the Administrator to the team. The Administrator reloads and sees the record at once. The Legal Owner removes them. The next request answers not found.
5. History and Comments rows show the Confidential marker. The list row shows a lock icon.
   Watch: the Creator keeps the right to change the flag after leaving the team, but cannot reach the record, so the right does nothing.
   Watch: stale comments say Administrators are always in a Confidential Document's audience. The code does not include them. An Administrator off the team who marks a Document confidential locks themselves out.

#### Permission denials

6. Business User opens `/contracts/{n}`. Expect a redirect to `/`. They use `/portal/contracts/{n}` instead.
7. Legal opens `/contracts/99999`. Expect "Contract not found". Opens `/contracts/abc`. Expect the error page "That is not a contract reference."
   Watch: a non-number goes to the error boundary, not the not-found page.
8. Legal opens `/contracts/{n}/foo`. Expect a redirect to Overview.
9. Legal Team Member looks for "Contract settings" in the applet bar. Expect it absent. Administrator sees it and it opens `/settings/contracts`.

#### Ending

10. Legal moves the Status to "Terminated". There is no confirm. Expect `ended_at` set, the renewal banner gone, "Run analysis" hidden, no Next deadline, and the Contract gone from the default list. "Show ended" brings it back.
11. Legal edits the description after Ending. Expect it saves.
12. Legal moves the Status back to "Active". Expect it back in the default list.
    Watch: Ending has no confirmation and no reason note. Matters have a closing note.

#### Archiving and restore

13. Legal opens "Contract actions" and clicks "Archive". There is no confirm. Expect "This contract is archived", an "Archived" pill, no Stage trigger, every input disabled, and the menu reduced to "Copy link" and "Restore".
    Watch: any Member+ who reaches the record can archive, including a plain team member on a Confidential Contract.
14. Legal checks each tab is read-only. Approvals has no buttons. Signatures refuses sends. Documents hides Upload, New folder, checkboxes and menus. The compare page still offers "Export track changes" and then fails with "This contract is archived. Restore it before changing its paper."
    Watch: "Show archived" is hidden on an archived Contract, so its archived Documents cannot be seen.
15. The Business User loses the Contract in the Portal. Pending Approval packets for it disappear. Bell and email for it are held back.
16. Legal clicks "Restore". Expect the record editable and back in the list.

### 4.9 Business User and Approver in the Portal

1. Business User signs in to the Portal and opens "Your Contracts" at `/portal/contracts`. Expect "Contracts you are on the team for.", a "Search Contracts" box and columns Type, Legal Owner, Stage, Expiry date. There is no create button.
2. Business User opens a Contract. Expect Overview facts: Counterparty, Stage, Business Owner, Legal Owner, Department, Region, Term type, Value, Effective date, Expiry date, Renewal period, Notice deadline. Unverified values carry a marker and the note "Legal has not yet verified the values marked Unverified…". A lapsed auto-renewal shows "Renewal is pending confirmation by Legal."
3. Business User checks "Fields". Expect only Rows with Visible on Portal on. Expect "Original request" with the Request reference.
4. Business User opens "Contract team" and clicks "Add team member". Adds a colleague. On a Confidential Contract expect no add.
5. Business User uses "Upload documents" and "Add version" on the primary Document, with "Kind" and "Note (optional)". Expect "Signed copy" on an executed Version.
   5a. Upload into a folder is refused: "Business Users may upload supporting Documents at the record root only."
   Watch: the Portal shows the old kind label, so a Version with an added Document type reads "General".
6. Business User posts a reply in Comments. It is Full Thread. Opens History and sees only shared entries, or "No shared history yet."
7. Business User not on the team opens a Contract URL. Expect "This Contract does not exist, or you cannot open it."
8. Approver who is a Business User receives the approval email "Approval requested: {title}" with "Review approval" and the line about the approval page. The Portal bell shows the item.
   Watch: the plain-text part of that email still says "on the record".
9. Approver opens "Approvals" at `/portal/approvals`. Expect "Your approvals", tabs "Pending" and "Completed", "Search approvals" and columns Contract, "Requested by", "Requested", "Status". Empty: "You're all caught up".
10. Approver opens the packet. Expect "All approvals", the primary Document with "Download" and a preview, "Approval request" and "Your decision" with "Note (optional)", "Reject" and "Approve". With no primary Document: "No document attached". A confidential primary Document shows nothing.
11. Approver clicks "Reject" with a note. Expect the decision to commit at once, then the pill, time and note. The item leaves the Portal bell.
    11a. Deciding twice: "This approval request has already been decided."
    11b. The request was cancelled: the packet shows "This approval request is unavailable."
    Watch: the Portal buttons have no "decision is final" warning. The staff dialog has one.
    Watch: the Portal pages have only "Next page", no way back.
    Watch: a staff Approver later removed from a Confidential team can still decide through `/portal/approvals`.
12. Business User receives status-change, new-Document and team-added notifications for team Contracts. They get no signing-ended notice.

## 5. Matters

Scope: the Matters list, Matter creation (direct, sub-Matter, from a Matter template, from a converted Request), the Matter record (Overview, Documents, Key dates, Tasks, relationships, linked Contracts, Team, Comments, History), Closing, Archiving, the Administrator settings behind them, and what a Business User on the team sees in the Portal.

Terms follow CONTEXT.md. Member+ means Administrators and Legal Team Members. Labels in quotes come from source strings or browser journeys on `dev` at ee0e6eda.

Build note. The `dev` working tree holds uncommitted partial-signing work. It changes document deletion on the Documents tab from "delete the whole Document" to "delete one Version". Steps below give the committed label first and the working-tree label as "WIP". Walk the build you actually run.

Actors used below:

- Administrator ("Ada"). Full app and Settings.
- Legal Team Member ("Lee"). Full app, no Settings > Organization.
- Second Legal Team Member ("Lou"). Used for Confidential and team checks.
- Business User ("Bea"). Portal only. Requester of the Request in Script 3.
- Second Business User ("Ben"). Used for Portal team additions.

### 5.1 Prerequisite setup by the Administrator

Actors: Administrator. Lee for the negative checks.

1. Ada opens Settings. The Organization rail group shows "Matters" and "Documents".
   1a. Lee opens Settings. The Organization group is absent. Lee types `/settings/matters/types` in the address bar. The app sends Lee to `/settings/profile`.
2. Ada opens Settings > Matters. The URL forwards to `/settings/matters/types`. The tab strip "Matters panes" shows "Types", "Statuses", "Fields", "Templates".
3. Ada reads the "Matter types" card. The seeds are Employment, Litigation, Regulatory, Commercial, Corporate, IP, Privacy, Advisory, Other and Default. Each row shows "{n} matters".
   Watch: help text says only "Other can't be archived". Nothing on the list marks the Default type.
4. Ada clicks "Add type", types "Investigation", presses Save. The row appears.
   4a. Ada clicks "Add type" and Cancel. Nothing is added.
   4b. Ada saves a blank name. The draft closes with no row.
   4c. Ada adds a second type with the same name. It is accepted.
   Watch: Matter types accept duplicate names.
5. Ada clicks the name "Rename Investigation", edits it, presses Enter. "Saving…" then "Saved". She starts another rename and presses Escape. The old name stays.
6. Ada reorders types by drag and by the grip with ArrowUp and ArrowDown. A screen reader hears "{name} moved to position {p} of {t}." The order persists after reload and shows in the New matter type picker.
7. Ada clicks "Archive {name}" on an unused type. The dialog says it can be archived without reassignment. She clicks "Archive type". The row leaves the list. "Show archived" appears. She turns it on, sees the row with an "Archived" pill, and restores it with "Restore {name}".
   7a. Ada archives a type in use. "Reassign {n} matters to" is required. "Archive type" stays disabled until she picks a live type. After archive, those Matters show the new type.
   7b. Ada tries to archive Other. It shows a lock: "Other is system-protected and can't be archived".
   7c. Ada archives the Default type. The dialog opens. The API refuses: "Default is the Default type and cannot be archived or deleted: module-only Requests need its Form."
   Watch: the UI offers Archive on the Default type and only the API refuses it.
8. Ada clicks "Edit Investigation". The editor opens at `/settings/matters/types/{id}` with tabs "Details" and "Form" and the back link "All types".
9. On Details, Ada edits "Display name" and "Description" and commits on blur. Escape reverts. The caption reads "{n} matters use this type." No slug shows.
   Watch: Description is a single-line input that holds up to 500 characters.
   Watch: Matter types have no Default people tab. Default people exist only on Contract types (CTR-026). `/people` shows "This section does not exist."
10. Ada opens the Form tab. Title and Type are pinned at the top with a lock, "Position and switches are fixed". The built-in Rows are Description, Department, Region, Priority, Risk and Needed by. On a new type only Description is On intake form.
11. Ada uses "Attach Field", searches, and picks a Matter Field. The Row appears with all three switches off. The screen reader hears "{field} attached."
    11a. Ada clicks "Create Field" in the builder. The Field dialog opens at Matter scope. She saves. The new Field is created and attached.
    11b. If the attach fails, the builder says "{field} was created but could not be attached. Retry attachment." She clicks "Retry attaching {field}".
12. Ada turns on "{row}: On intake form" for a Field Row. "Visible on Portal" turns on and locks with "Turn off On intake form first". The Touchpoint cell reads "Intake".
13. Ada turns on "Required for creation" on a different Row, not on intake. The Touchpoint reads "Creation". A Row with neither reads "Record".
    13a. Ada puts a user-type Field On intake form, then tries Required for creation. It is locked: "Required for creation is unavailable for {row} while it is on the intake form".
14. Ada turns on "Visible on Portal" for a Record Row she wants Business Users to read. Built-in Rows show a lock and "Fixed" in that column.
    Watch: turning On intake form on for the Department or Priority built-in Row changes nothing a requester sees. The Portal form always shows Department and Urgency as basics.
15. Ada clicks "Add condition". A Branch appears. She opens "Edit conditions", picks a "Row" above the Branch, an "Operator" ("is", "is not", "is one of", "is set", and for number, money or date "is greater than" and "is less than") and a "Value". The header reads "Show when all of: …".
    15a. Ada clicks "Add another condition". The app asks "Join the next condition with" AND or OR.
    15b. While a Branch is unfinished, "Add condition" is disabled with "Complete the Branch condition first".
    15c. Ada presses Escape on a new Branch draft. The draft is removed.
    15d. A Branch with no Row above it shows "Add a Row above this Branch first".
16. Ada uses a Row's grip menu, "Put under a condition…", and picks the Branch. The Row moves under it. "Move out of the condition" lifts it back to the root.
    16a. Ada tries to move a Row a condition uses below that Branch. The refusal reads "Keep {row} above the Branch that uses it".
    16b. Ada tries to detach a Row a condition uses. The refusal reads "Used by a Branch condition. Change the condition first".
17. Ada uses the Branch "..." menu, "Remove condition". The Branch goes and its children stay in place.
    Watch: testers may expect "Remove condition" to delete the children too.
18. Ada clicks "Preview intake form". The preview shows Title, Department, Urgency, the Intake Rows with live Branch logic, and Attachments. "Submit request" shows "Preview complete. No Request was sent".
    18a. With no Request type pointing at this Matter type, the heading reads "No Request type uses this Form yet".
    Watch: every Form change saves at once. There is no Save or Discard button. A failed save rolls the tree back and shows "Retry condition change" for a condition draft.
19. Ada opens Statuses. Seeds are Open, In progress, On hold and Closed. Open and Closed carry a lock.
    Watch: the seeded On hold status sits in the Open progression group, not Waiting.
20. Ada clicks "Add status", names it "Awaiting client", picks "New status category" Open and "New status group" Waiting, then "Save status".
    20a. Ada saves with no category. The error reads "Pick a category for the new status."
    20b. Ada adds a Closed-category status, "Settled". No group select appears. The row shows a "Closed" badge.
21. Ada changes "Group for {name}" on an open status. It saves at once. She renames a status and reorders by grip and arrow keys.
22. Ada archives an unused status. She archives a used status and must pick a replacement in the same category from "Reassign {n} matters to". "Archive status" stays disabled until she picks.
    Watch: the "last unarchived status in its category" message cannot be reached from the UI, because Open and Closed are protected.
23. Ada opens Fields. "Default Fields" is a collapsed read-only list of built-ins. "Custom Fields" is open.
    Watch: the card name "Default Fields" collides with the glossary term Default Field. Its list also differs from the Form's built-in Rows. Needed by is missing from it, and it calls the pinned Row "Matter type" where the builder says "Type".
24. Ada clicks "Add field". She enters "Name", "Description" and "Type". The Type list is Text, Long text, Number, Currency, Date, Boolean, Single select, Multi select, User, Entity. For a select type she fills "Options", one per line. She clicks "Add field".
    24a. Ada saves with no name: "Name the field." With no type: "Pick a type for the new field." A select with no options: "Add at least one option, one per line."
    24b. Ada enters two identical options. The API refuses: "Options must be unique."
    24c. Ada checks there is no AI prompt, no Answer style and no scope picker on a Matter Field.
25. Ada edits a Field with "Edit {name}". "Type" is read-only: "The field type is immutable after creation."
26. Ada archives a Field. The dialog says its attachments are kept and hidden until restore. She restores it.
    Watch: the dialog's "attached to # types" count adds every Matter that holds a value. One type and 40 Matters reads "attached to 41 types".
    Watch: archiving a Field that a Branch condition uses is not guarded. Check whether later Form saves fail with "Used by a Branch condition".
27. Ada opens Templates. She picks "Matter type" Investigation. The card "Matter templates" says "Templates pre-fill a new Matter. Editing or archiving one never changes an existing Matter."
    27a. With no Matter types at all, the page says "Add a Matter type before creating a template."
28. Ada clicks "Add template", enters "Name" and "Description", then "Add template". The row appears with pills "0 tasks", "0 dates", "0 fields". The editor does not open.
    28a. Ada adds a second template with the same name on the same type. The API refuses: "A template of this Matter type is already called that."
29. Ada clicks "Edit {name}". The editor shows "Template details", "Matter defaults", "Custom field defaults", "Tasks" and "Key dates".
30. In "Matter defaults" Ada sets "Priority" High, "Risk" Medium and "Title prefix" "Investigation: ".
31. In "Custom field defaults" Ada sets a value for each Field on the type.
    31a. For a Field no longer on the type, the card says "{field} is no longer attached to this Matter type. Its saved value ({value}) is retained."
32. In "Tasks" Ada clicks "Add task" three times. She fills "Task {n} title", "Task {n} due offset in days" (0 to 3650, blank means no due date) and "Task {n} role" ("Matter Manager" or "Unassigned"). She reorders with the grip and removes one row with "Remove {name}".
33. In "Key dates" Ada clicks "Add key date" twice. She fills "Key date {n} label", "Key date {n} offset in days" (required, 0 to 3650) and "Key date {n} note".
34. Ada clicks "Save template". It shows "Saved". The list pills now read "2 tasks", "2 dates" and the field count.
    34a. Ada leaves a task title blank or types an offset of 4000. The error reads "Give every row a name and use whole-number offsets from 0 to 3650 days."
    34b. Ada clears the template name: "Name the template."
    Watch: Save sends four writes in order. A failure part way leaves a partial save with "…Earlier changes may already be saved."
    Watch: "All templates" drops unsaved edits with no warning.
    Watch: Matter templates carry no Documents, no default people, no default Status, Department, Region, Confidentiality, Business Owner or Matter Manager. There are no task descriptions and no named assignees.
35. Ada archives the template: "Archive {name}?", "The template leaves new Matter creation. Existing Matters are unchanged…". She restores it.
    Watch: an archived template's editor URL still opens. Name, Description, Priority, Risk and Title prefix stay editable, but Save is disabled.
    Watch: templates of an archived Matter type cannot be reached. The type picker lists live types only.
36. Ada opens Settings > Documents. The URL forwards to `/settings/documents/matters`. Tabs are "Matters", "Contracts", "Entities". The Matter list starts empty.
37. Ada clicks "Add type" and adds "Advice memo" and "Evidence". She sets a colour with "Colour for {name}". She reorders them.
38. Ada archives "Evidence". The dialog says the Versions that use it keep it. It leaves the upload pickers.
39. Ada checks Settings > Organization for at least one live Department and one Region. The Matter Department and Region Rows read those lists.
40. Onboarding only, fresh install: on the wizard Review step, Ada may press "Start blank". It removes the non-protected seeded Matter types and statuses. It keeps Other, Default and the protected Open and Closed statuses.
    40a. Once a Matter exists or onboarding is complete, Start blank is refused.

### 5.2 The Matters list

Actors: Lee. Ada for saved-view checks. Bea for the negative check.

1. Lee opens Matters from the main navigation. The URL is `/matters`. The sub-bar says "Matters" and "{n} matters". Default columns are Matter, Title, Type, Status, Next deadline, Priority, Risk, Matter Manager, Opened. Closed and archived Matters are hidden.
   1a. Bea types `/matters`. She is sent to `/` and then to the Portal.
2. Lee reads a row. The title is a link. A Confidential Matter shows the Confidential marker. The Status chip colour follows its group: grey Open, blue In progress, amber Waiting, dark grey Closed. Risk with no value reads "Not assessed". No Matter Manager reads "Unassigned".
3. Lee clicks a Next deadline cell. A Key date opens the Key dates tab. A Task deadline opens the Tasks tab.
4. Lee clicks "Filter". He uses "Search filters" to find a property. The properties are Manager, Status, Type, Priority, Risk, Opened date, Next deadline, Incomplete, Show closed and Show archived.
   Watch: the UX checklist says Incomplete was removed. The code still offers it.
5. Lee picks Manager, searches choices, and picks "Me" and "Unassigned". He clicks "Apply". A chip appears. The count updates.
6. Lee adds Status (two values), Type and Risk "Not assessed". The count narrows.
7. Lee adds "Opened date" with From and To. He then edits it to only From. The chip reads "From {date}".
   7a. Lee sets To before From. The error reads "End date must be on or after start date."
8. Lee adds "Next deadline" with only To. The chip reads "Until {date}".
9. Lee removes one chip with "Remove {filter} filter". He clicks "Clear all".
10. Lee turns on "Show closed". Closed Matters appear. He turns on "Show archived". Archived Matters appear with an "Archived" pill.
11. Lee builds a filter that matches nothing. The empty state reads "No matters match these filters" and "Clear a filter to widen the list." No New matter button shows there.
12. Lee refreshes, then uses Back and Forward. The filters come back from the URL each time.
13. Lee sorts by Title, Type, Status, Priority, Risk, Matter Manager and Opened, each in both directions. Next deadline does not sort.
14. With more rows than one page, Lee clicks "Show more". The subtitle reads "{shown} of {total} matters". Filters and sort stay.
    14a. If the next page fails, the table foot reads "The next matters could not be read. Try again."
15. Lee opens "Columns". He hides Risk, moves Priority earlier with "Move {column} earlier", resizes a column by drag and by keyboard, toggles "Fill the width", then "Reset columns". Title cannot be hidden.
16. Lee opens "Views". He changes the layout. The menu shows "Modified". He clicks "Save as…", names the view "My open work" and saves.
    16a. Lee clicks "Discard unsaved changes". The saved layout returns.
    16b. Lee uses "Rename…", then "Set as default". The label "Opens here" moves to that view. He reloads `/matters`. It opens on that view.
    16c. Lee uses "Delete…". The dialog "Delete this view?" says the records are not touched. He cancels once, then deletes.
    16d. Lee clicks "Default view". The built-in layout returns.
17. Lee uses the global search box, "Search contracts, matters, documents…", to find a Matter by title. The result opens the record.
    17a. Lee opens advanced search and adds Matter conditions such as Type, Status, Matter Manager, Business Owner, Confidential and Next deadline.
    Watch: the Matters list has no search box of its own and no row selection or bulk actions. Search lives in the global search.
18. On an install with no Matters, the empty state reads "No matters yet", "Matters organize legal work that is not centered on a contract." and offers "New matter".

### 5.3 Create a Matter directly

Actors: Lee. Lou as the other staff person.

1. Lee clicks "New matter". The dialog "Create matter" opens. "Matter type" preselects the Default type. "Matter Manager" is Lee.
2. Lee types a "Title" and picks "Matter type" Investigation. The dialog redraws the type's Creation and Intake Rows.
3. Lee opens "Matter template". It starts on "No template". He picks the template from Script 0. The hint reads "Template adds 2 tasks and 2 key dates." The Title fills with the prefix. Field defaults fill.
   3a. Lee types his own title first, then picks a template. His title stays.
   3b. Lee changes the Matter type. The template resets to "No template".
   3c. Lee clears a Field the template filled. The saved Matter keeps it empty.
4. Lee changes "Matter Manager" to "Unassigned", then to Lou. Only Administrators and Legal Team Members are listed.
5. Lee answers each Row: Description, Department, Region, Priority, Risk, Needed by and custom Fields, as the Form shows them. A Row under a false Branch is hidden and not required.
   Watch: Priority and Risk show only if the type's Form collects them at creation. The seeded Form keeps them as Record Rows (journey 31).
6. Lee turns on "Confidential — restrict to the matter team".
7. Lee uses "Attach documents" and drops two files. He sets a "Document type" on one and removes the other with "Remove {name}".
8. Lee clicks "Create". The dialog shows "Record created. Uploading documents…", then "Uploaded". The new record opens at `/matters/{n}`.
   8a. An upload fails. The dialog reads "Record created. Some documents could not be uploaded." Lee clicks "Retry failed uploads". The Matter is not created twice.
9. Lee checks the record. Status is the first Open status. Opened is today. Closed reads "Still open". Tasks and Key dates from the template are present with dates resolved from today. Template tasks with the Matter Manager role are assigned to the Matter Manager.
10. Lee checks the Team applet. Lee is on the team with "Creator". Lou shows "Matter Manager".
    Notification: Lou gets "Task assigned: {task} (M-{n} · {title})" for each template Task assigned to the Matter Manager, if the assignee differs from Lee. Check whether template assignments fire it.
11. Validation, in a new dialog:
    11a. Lee clicks "Create" with no Title. The error reads "Fill Title."
    11b. Lee clears Matter type. The error names "Matter type".
    11c. Lee leaves a Required for creation Field empty. The error reads "Fill {field}."
    11d. Lee types letters in a Number Field. The error reads "Enter {field} as a number."
    11e. The server refuses. The dialog shows the server detail or "The matter could not be created." The draft stays.
12. Lee clicks "Cancel". Nothing is created. Staged files are discarded.
13. Sub-Matter. On a Matter Overview, Lee clicks "New sub-Matter" in "Related Matters". The dialog title is "Create sub-Matter" and it shows "Parent: M-{n} {title}". He creates it. The child opens. Its breadcrumb shows the parent reference.
    13a. The parent is archived. Creation is refused: "That parent Matter is archived. Restore it before using it."

Watch: the create dialog has no Business Owner picker. Business Owner is set only by conversion or on the record.
Watch: a template cannot be applied to an existing Matter. There is no path to test "template applied to a Matter that already has Tasks".

### 5.4 From a Business User's Request to a Matter

Actors: Bea, Lee. Ada set up a Request type whose destination is Matters > Investigation.

1. Bea signs in to the Portal and opens the Request type from the home list.
2. Bea fills "Title", "Department", "Urgency" and "Description", then the Intake Rows of the Investigation Form. A Branch Row appears only when its condition holds. She adds an attachment and clicks "Submit request".
   Notification: every Member+ subscribed to new requests gets a `request.submitted` bell and email.
3. Lee opens the Inbox and opens the Request at `/inbox/{n}`.
4. Lee opens "Triage" and picks "Convert to matter". The dialog "Convert R-{n} to a matter" opens.
   4a. If a Conversion draft is set up, the dialog shows "Getting matter ready…". Lee may close it. When the draft is ready he gets a bell and returns to the dialog.
   4b. The draft fails. The dialog reads "Preparation could not finish. Retry or continue manually." Lee picks "Continue manually".
5. Lee checks the fixed controls: "Title", "Matter type", "Priority" (from the requester's Urgency) and "Matter template". The template starts on "No template". Then the Intake and Creation Rows in Form order.
6. Lee picks the Investigation template and edits the title.
   6a. Lee uses "Convert to contract instead". The dialog re-targets. He switches back.
   6b. Lee leaves a required Row empty. Convert is refused and names the gap.
   6c. A person or Entity answer is now archived: "{value} is archived. Pick a live person to convert."
   6d. Another staff member converted it first: "Somebody else already converted this request."
7. Lee clicks "Convert to matter". The Matter opens.
8. Lee checks the Matter. Matter Manager is Lee. Business Owner is Bea. Bea is on the team. The Matter is not Confidential. Template Tasks and Key dates are present. A "Needed by" answer became a Key date labelled "Needed by".
   Watch: the convert dialog has no Matter Manager picker and no Confidential switch. The server sets the converter as Matter Manager and makes the Matter non-Confidential.
9. Lee opens Description. A toggle offers "Current" and "Requester", so he can read the requester's original text.
10. AI-prepared values carry the Unverified marker. Lee confirms one value. The marker clears for that value only.
    10a. Record Rows are prepared after conversion in a separate job. Lee waits and reloads. New values appear with the marker.
11. Bea opens her old Request address in the Portal. It redirects to `/portal/matters/{n}`. The Request is gone from Your Requests.
    Notification: Bea gets a requester update for the conversion. Check the bell and email wording.
12. Lee posts a comment at "Matter Team". Bea gets a `request.replied` bell for it, because this Matter came from her Request.
13. Lee archives the Matter. Bea opens the old Request address. She sees "The record created from this Request was archived. Your original request is shown below." There is no composer.
14. Lee restores the Matter. The old address redirects again.

### 5.5 Matter record Overview

Actors: Lee (Matter Manager), Lou (team member), Ada.

1. Lee opens a Matter. The header shows the "Matters" breadcrumb, the parent reference if any, the M-number, the title, the Status pill and the progression. Tabs are Overview, Documents, Key dates (count of upcoming dates) and Tasks (count of open Tasks). The applet bar shows "Matter team", Comments and History.
   1a. Ada sees a fourth applet, "Matter settings". It opens `/settings/matters/types`.
   Watch: the settings shortcut opens the type list, not this Matter's type.
2. Lee opens "Matter actions". It offers "Copy link", "Rename matter" and "Archive".
   2a. "Copy link" shows "Copied". The link points at this Matter.
   2b. "Rename matter" from another tab returns to Overview and selects the Title text.
3. Lee edits Title and presses Enter. "Saving…" then "Saved". The heading updates. He starts another edit and presses Escape. The old title returns. A blank title reverts.
4. The Owners card shows "Matter Manager" and "Business Owner".
5. Lee changes Matter Manager to Lou, then to Unassigned, then back to himself. Only Administrators and Legal Team Members are offered.
   5a. On a Confidential Matter, Lou (team member, not Creator or Manager) tries to name a Matter Manager. The API refuses with 403.
6. Lee sets Business Owner to Bea. Bea joins the team in the same save.
   6a. Lee changes Business Owner to Ben. Ben joins the team. Bea stays on the team until someone removes her.
   6b. Lee clears Business Owner. The team is unchanged.
7. The "Matter" card shows Title, then the Form Rows in order: Matter type, Description, Department, Region, Priority, Risk, Needed by and custom Fields.
8. Lee changes Matter type to one whose required Fields are all answered. It saves at once and redraws the Fields.
   8a. Lee picks a type with unanswered required Fields. The dialog "Change matter type to {type}" says "Complete the new type's required fields before changing it." He fills them and clicks "Change type".
   8b. He cancels the dialog. The type stays.
   8c. He types letters into a Number Field there: "{field} must be a number."
   8d. Values of Fields the new type does not have are kept and hidden. Changing back shows them again.
9. Lee edits Description, which grows with the text. Blur saves. Escape reverts.
10. Lee picks a Department with the Department picker and a Region from "No Region" plus the Region list.
    10a. A Region that was archived shows as a disabled choice with its old name.
11. Lee sets Priority (Low, Medium, High, Critical) and Risk (including "Not assessed").
12. Lee sets Needed by with the date picker. A Key date "Needed by" appears on the Key dates tab. Clearing it removes that Key date.
13. Lee edits each custom Field type: Text and Long text commit on blur or Enter; Number shows grouping separators when not focused; Currency; Date; Boolean; single and multi select; User; Entity. Escape reverts. A required Field shows "*".
    13a. Lee clears a required Field. The API refuses and the error shows under it.
    13b. A Row under a false Branch is hidden unless it holds a value. When it holds one, it still shows.
    13c. An Entity Field that points at a Confidential Entity Lee cannot reach shows "Restricted Entity".
14. Lee reads "Opened" and "Closed". Closed reads "Still open" while the Matter is open.
15. Lee opens "Confidentiality" and turns on "Confidential — restrict to the matter team". A banner appears: "Confidential matter — only the matter team and matter manager can access this matter." with "Manage team".
    15a. Lou (on the team but not Manager or Creator) sees the switch disabled and no "Manage team" link.
    15b. Lee turns Confidential off. The banner goes.
    Watch: the banner writes "matter manager" in lower case. The glossary term is Matter Manager.
16. In "Related Matters", Lee clicks "Set parent". The dialog searches "Search by matter number or title". He picks M-44 and clicks "Set parent". M-44 shows as "Parent" and in the breadcrumb.
    16a. Lee uses "Change parent" and picks a child of this Matter. The refusal reads "That parent would close a loop in the Matter hierarchy."
    16b. Lee clicks "Remove" on the parent. The parent clears.
17. Lee clicks "Add related Matter", searches, and adds M-60. It shows under "Related". The link shows on M-60 too.
    17a. Lee adds the same pair again: "These Matters are already related."
    17b. The search excludes this Matter. A Matter related to itself is refused: "A Matter cannot be related to itself."
    17c. Lee removes the related Matter with "Remove".
18. Lee follows the parent, a child under "Children" and a related Matter. Each opens its own record with its own Fields and applets.
    18a. A relative Lee cannot reach shows "Restricted Matter" with no number and no link. It has no Remove button.
19. In "Linked Contracts", Lee clicks "Link Contract", searches "Search by Contract number or title", picks one and clicks "Link". It appears with its status.
    19a. The Contract and the Matter have different Confidential flags. The dialog shows "Confidentiality differs" and "Leave them as they are". Linking changes neither flag.
    19b. A Contract already linked to another Matter is not offered. Lee must unlink it there first.
    19c. Lee clicks "Unlink". The Contract leaves the list.
20. Lee clicks "New contract". The Contract creation form opens with this Matter preselected. He cancels. Nothing is created. He tries again and creates it. The list refreshes with the new Contract.
    20a. The options fail to load: "The contract form could not be loaded. Try New contract again."
21. Lee archives a linked Contract from its own record. It disappears from Linked Contracts. He restores it. It returns.
22. From the Contract record, Lee uses "Link to Matter" to link a Contract to this Matter. The Matter's list shows it.
23. Lee opens a direct link to another Matter. The title, Fields and applets belong to the new record.
24. Lee visits `/matters/99999` and `/matters/{n}/unknown-tab`. The first shows "Matter not found", "M-99999 does not exist, or you cannot open it." and "Back to Matters". The second lands on Overview.

Not present on a Matter record (check the absence, do not look for controls):

- Counterparty. Matters have no Counterparty control. Watch: CONTEXT.md says a Counterparty can be on the other side of a Matter. No Matter UI records one.
- Entity link. There is no "Our entity" on a Matter. An Entity can only be held in an Entity-type custom Field.
- Urgency. Urgency lives on the Request. It seeds Priority at conversion and the Portal Original request block shows it.
- Category. Category is Open or Closed on the status, shown through the progression groups.
- Stakeholders and Watchers. DD-023 retired both. The team is one roster with no role tags.
  Watch: old History entries may still read "…to the team as Watcher" or "as Contributor".

### 5.6 Team applet

Actors: Lee (Matter Manager), Lou, Ada (not on a Confidential Matter), Bea.

1. Lee clicks "Matter team" in the applet bar. The roster shows one row per person. "Matter Manager", "Business Owner" and "Creator" appear as labels on the right person.
2. Lee clicks "Add team member". The dialog lists live people not on the team, all account types. He picks Lou and clicks "Add". Lou appears.
   2a. Lee clicks "Add" with no person: "Pick a person."
   2b. There is no role picker.
3. Lee adds Bea. Bea can now open the Matter in the Portal.
4. Lee clicks "Take Lou off the matter team". Lou is removed at once, with no confirmation.
5. The Business Owner row has no remove button.
   5a. Through the API, removing the Business Owner is refused: "Change the Business Owner before removing this person from the team."
6. Lee makes the Matter Confidential. Lou (team member only) opens the applet. "Add team member" is disabled and the remove buttons are disabled.
7. Ada is not on the Confidential Matter's team. She opens `/matters/{n}`. She gets "Matter not found". The Matter is absent from her list, search, Home and notifications.
   7a. Lee adds Ada to the team. Ada can now open it.
8. On an archived Matter, add and remove are gone. The API says "This matter is archived. Restore it before editing."
   Watch: no bell or email fires when someone is added to a Matter team or named Matter Manager.

### 5.7 Documents tab

Actors: Lee, Ada (Administrator), Lou.

1. Lee opens Documents. With no documents he sees "No documents on this matter yet." The header has "Show archived", "New folder" and "Upload".
2. Lee clicks "Upload". The dialog "Upload document" has "Choose files", "Choose folder", "Type" (No type plus Matter Document types), "Note" and "Upload". He picks one file, sets Type "Advice memo", types a note and clicks "Upload". The row shows name, Type, "v1", Modified and uploader.
   2a. Lee clicks "Upload" with no file: "Choose a file to upload."
   2b. Lee clicks Cancel. Nothing is uploaded.
   2c. The Type select is hidden when the Matter list of Document types is empty.
   Watch: Matters have no Primary Document and no executed pin. Those designations are Contract only.
3. Lee picks three files in "Choose files". The batch dialog "Import 3 files" opens with "Destination: Record root", one "Type" for all, and "Import 3 files". He imports. Progress shows "{x} of {n} files uploaded". The dialog closes when all succeed.
   3a. One file is over the size limit (100 MB by default). The result reads "Imported 2 of 3 files" and "1 file failed. The other 2 are on the matter." Lee clicks "Retry" or "Done".
   3b. Lee clicks "Cancel remaining" mid-import. Files in flight still finish.
4. Lee picks a folder with "Choose folder". The batch dialog says "Folder structure is kept". Folders are created on the Matter.
5. Lee drags files onto the page. The card shows an outline and the batch flow starts. He drags a file onto a folder row. It lands in that folder.
6. Lee clicks "New folder", names it and clicks "Save". He opens the folder menu "Actions for the {name} folder" and uses Rename, "New subfolder", Move ("Move into", with "None" meaning the root) and Delete.
   6a. Delete reads "Delete the {name} folder?" and "Anything in it moves onto the matter itself. Nothing is deleted."
   6b. A blank folder name: "Give the folder a name."
   Watch: the root is "None" in Move dialogs and "Record root" in the batch dialog.
7. Lee uses a document's "Actions for {title}" menu: "Add version", "Edit details", "Move to folder", "Mark confidential", "Archive", and "Compare with previous" once a second Version exists.
8. Lee uses "Add version", picks one file, adds a note and uploads. The row shows "v2". The chevron "Show the 1 earlier version of {title}" expands the history.
9. Lee uses "Edit details". He changes Name and Description and saves. A blank name: "Give the document a name."
10. Lee drags a document onto a folder, then onto "Drop here to move out of folders". It moves in and back out.
11. Lee clicks a document name. The reader opens beside the record at 1400px or wider, and over it on a narrow window. He uses Download, "Previous page", "Next page", "Zoom in" and "Zoom out" (50% to 300%), and "Find in document" (Ctrl+F or Cmd+F). He closes with the X or Escape.
    11a. A Word file shows "Preparing this document for reading…" first.
    11b. An email file shows Subject, From, To and its attachments. Lee opens an attachment and uses "Back to the message".
    11c. An unsupported file says "This file type does not open here. Download it to read it."
    11d. With the reader docked, Lee switches to the Tasks tab. The reader stays. With the reader covering the record, switching tabs closes it.
12. Lee clicks "Compare" in the reader. The compare page shows "v1 → v2" and the Changes list with "Previous change" and "Next change". For two Word files, "Export track changes" adds a generated redline Version.
13. Lee (uploader) clicks "Mark confidential". Lou, who is on the team but is not the uploader, Manager or an Administrator, does not see the option.
14. Lee clicks "Archive" on a document. It leaves the list with no confirmation. He turns on "Show archived", finds it with an "Archived" pill and uses "Restore".
15. Lee selects several rows. The bar shows "{n} selected", "Move", "Archive" and "Clear selection". He moves them into a folder, then archives them. With only archived rows selected, "Restore" appears.
16. Ada opens a document menu and clicks "Delete".
    16a. Committed: "Delete this document?". She must type `delete` in 'Type "delete" to confirm'. The whole Document and its Versions go.
    16b. WIP: "Delete version" opens "Delete version {n}?". The last Version also removes the Document.
    16c. Lee (Legal Team Member) has no Delete option.
17. On an archived Matter, the Documents tab has no Upload, no New folder, no drop target and no row menu writes.
    Notification: no bell or email fires for a Matter Document or Version upload. Only Contracts fire document events.

### 5.8 Key dates, Next deadline and reminders

Actors: Lee, Lou, Bea.

1. Lee opens Key dates. With none he sees "No Key dates on this Matter yet." He clicks "Add date".
2. The dialog "Add a Key date" has "Date", "Event", "Note" and "Reminders". He picks a date 10 days out, types "Response due", adds a note and saves with "Add date". The table shows it. The tally reads "{upcoming} upcoming · {overdue} overdue". The tab count rises.
   2a. No date: "Pick a date." No event: "Name what the date is."
   2b. Cancel adds nothing.
3. In "Reminders" Lee reads "Global reminders: {ladder}". He clicks "Add lead time" and sets "Additional lead time (days before)" to 3. The line "This date will remind: {ladder}" updates.
4. Under "Recipients" Lee picks Lou only. The help says an empty selection goes to the Matter Manager, the Business Owner and the team.
   4a. Lee picks "Use the usual audience" to clear the selection.
   4b. Lou leaves the team later. The dialog warns "Some selected recipients have left the team and will not be reminded." and offers "Remove unavailable recipients".
   4c. The ladder or team fails to load: "The current reminder ladder and team could not be loaded." with "Retry".
5. Lee uses "Actions for {label}", "Edit date". The dialog "Edit Key date" opens. He changes the date and saves. The table re-sorts.
6. Lee uses "Remove date". "Remove Key date?" reads "Remove {label} on {date}? This cannot be undone." He cancels once, then removes.
7. Lee adds a Key date in the past. It counts as overdue in the tally.
8. Lee checks the Matters list. Next deadline shows the earliest upcoming Key date or unfinished dated Task, whichever is earlier. An overdue Task counts. A past Key date does not.
9. Lee checks Home. "Your matters" lists open Matters he manages, with the next deadline. "Dates approaching" shows dates in the next 30 days. "View all {count}" opens the "Your dates" calendar with "Previous month", "Next month" and "Today".
10. Morning round: on the lead-time day, recipients get the reminder.
    Notification: bell "{keyDate} on {record} is coming up", push, and the email morning briefing "{n} dates on your matters". Business Users on the team receive it too when there is no recipient selection.
11. Lee closes the Matter. Key dates stay and stay editable. The Matter has no Next deadline and drops out of Home and the list deadline filter. Reopening restores them.
12. Lee archives the Matter. Add, Edit and Remove are gone. The API says "This matter is archived. Restore it before changing its Key dates."
13. Bea opens the Matter in the Portal. There is no Key dates section.

### 5.9 Tasks

Actors: Lee, Lou, Bea (on the team).

1. Lee opens Tasks. With none he sees "No Tasks on this Matter yet." He clicks "Add Task".
2. The dialog "Add a Task" has "Title", "Description", "Assignee", "Due date", and on the right "Add a note" and "Attach files". Lee fills all of them, assigns Lou, and clicks "Add Task".
   2a. No title: "Name what needs doing."
   2b. The Task saves but the note fails: "Task saved. Your note and attachments could not be added." The button becomes "Retry note & attachments". Retry does not create a second Task.
   2c. Cancel before save discards staged files.
   Notification: Lou gets "Task assigned: {task} (M-{n} · {title})" by bell, push and email. The link opens the Tasks tab.
   Watch: task-assigned links open the Tasks tab, not the Task. `?task={id}` does open the Task.
3. The list sorts by due date, undated last. The header reads "{done} of {total} done".
4. Lee clicks a Task title. "Task details" opens with the same fields and a Task thread under "Comments & attachments". He edits the description and saves.
5. Lee posts a note in the Task thread. The audience line reads "Visible to everyone who can access this task." It does not appear in the Matter's own Comments.
6. Lee clicks the assignee avatar on a row. "Assign task" opens with "Search people" and "Unassigned". He picks the Matter Manager, then "Unassigned".
7. Lee picks "Add someone to the team…" and chooses a Legal Team Member not on the team. The text reads "This person will join the team, gain access to this record, and be assigned this task." He clicks "Add to team and assign". The person joins the team and gets the Task.
   7a. He clicks "Back". Nothing changes.
   7b. In the Add or Edit dialog the button is "Use this person" with "Team membership and assignment are saved when you save the task." Cancelling the dialog changes nothing.
   7c. Business Users are not in the assignee list or the "Add someone" list.
   7d. On a Confidential Matter, Lou (team member only) can assign within the team, but "Add someone to the team…" is absent.
8. Lee ticks "Complete Task: {title}". The Task leaves the open list. He turns on "Show completed", finds it, and unticks "Reopen Task: {title}".
   Watch: the switch reads "Hide completed" while it is on. It names the action, not the state.
9. Lee uses "Actions for {title}", "Edit Task", then "Remove Task". Removal happens with no confirmation.
   9a. A Task with a thread cannot be removed: "This Task has a conversation on it, so it cannot be removed. Mark it done instead."
10. Lou opens Home. "Tasks assigned to you" lists the Task with "{title} · Matter M-{n}" and a due pill. He clicks "View all".
11. On `/home/tasks` ("Your Tasks"), Lou ticks the Task. It slides out and shows "Completed: {title}" with "Undo". He clicks Undo. It reads "Reopened: {title}". He uses "Load more Tasks" when there are many.
12. Lee closes the Matter. Tasks stay editable. Lee archives it. Tasks become read-only: "This matter is archived. Restore it before changing its Tasks."
13. Bea opens the Matter in the Portal. There is no Tasks section.

### 5.10 Comments, mentions and filing

Actors: Lee, Lou, Bea (on the team), Ada.

1. Lee clicks Comments. The composer "Add a comment…" has the audience switch "Legal Only" and "Matter Team". Matter Team is the default: "Visible to Legal and all Matter team members."
2. Lee posts at Matter Team.
   Notification: team members and the Matter Manager get a `comment.posted` bell, "New comment on M-{n} · {title}". Email is off by default. Bea, as the original Requester, gets `request.replied` instead.
3. Lee switches to Legal Only ("Visible to Administrators and Legal Team Members.") and posts. The row has a tint and a lock. Bea never sees it.
4. Lee types "@" and picks Lou from "People". Lou appears under "Mentioned". Lee removes the chip with "Remove {name}" and adds it again. He posts.
   Notification: Lou gets "You were mentioned on M-{n} · {title}" by bell, push and email.
5. Lee writes a Legal Only comment that mentions Bea. The prompt "Widen the audience?" names her. He clicks Cancel once, then "Widen and post". The comment posts at Matter Team.
   5a. Lee mentions someone who cannot see the record: "{names} cannot be reached on this record at any audience you can post to. Take the mention out."
6. Lee opens the "Files" tab in the "@" list, searches, and inserts a document link chip.
   Watch: the Files tab searches every Document in the org, so a reader may get a dead link.
7. Lee attaches files with "Attach files" ("Up to 5 files."). He removes one queued file and posts a files-only comment.
8. Lee opens an attachment preview and downloads it.
9. Lee clicks "File to Matter" on the attachment. In "File attachment" he picks "New Document", sets "Document name" and "Type", and clicks "File". The comment then shows "Filed to {title}, version 1". The link opens the reader.
   9a. He files another attachment as "New Version on an existing Document", with "Document" and "Note".
   9b. On a Legal Only comment, the "Confidential — restrict to the matter team" toggle starts on.
   9c. On an archived Matter, filing is refused: "This matter is archived. Restore it before filing paper."
   Watch: that toggle marks one Document, but its words describe the whole Matter.
10. Lee edits his own comment and saves. The row shows "edited". He deletes another of his own. The row reads "Comment deleted by its author."
11. Ada redacts Lou's comment. The row reads "Comment removed by an Administrator."
12. Lee scrolls up and uses "Show older".
    12a. The first load fails: "The conversation could not be read. Reopen the panel to try again."
13. On a Confidential Matter, every row has a lock and the composer says "Confidential matter — only the matter team and matter manager can read it."
    Watch: glossary tiers are Legal Only, Working Team and Full Thread. The Matter UI says "Legal Only", "Matter Team" and, for old rows, "Internal team".
    Watch: the composer still shows on an archived Matter. Check whether posting is refused.

### 5.11 History applet

Actors: Lee, Bea.

1. Lee clicks History. Entries are newest first. Each shows who, what and when, with "{from} → {to}" lines for changes. Hovering the time shows the full timestamp.
2. Lee checks entries for creation, status change, type change, Matter Manager change, team add and remove, Confidential set and clear, archive and restore, parent and related changes, Task and Key date changes, Document and folder changes, and comments.
3. After a Close, the status entry shows a "Closing note" block.
4. Lee uses "Show older" at the foot.
   4a. It fails: "The older entries could not be read. Try again."
   4b. The first page fails: "The history could not be read. Reopen the panel to try again."
5. Lee opens another Matter. The entries belong to that record.
6. A new Matter with no changes reads "Nothing has happened to this record yet. Every change to it shows up here."
7. Bea opens History in the Portal. She sees only Full Thread entries and Portal-visible changes. Legal Only and Working Team entries leave no trace. An empty feed reads "No shared history yet."

### 5.12 Closing, reopening, archiving and restore

Actors: Lee, Lou, Ada.

1. Lee clicks the progression, "{status} — move matter". The menu groups statuses under Open, In progress, Waiting and Closed. He picks On hold. It saves with no dialog. The pill reads "On hold". He refreshes. It stays.
2. Lee picks "Closed". The dialog "Close {title}?" asks for a required "Closing note". "Close matter" is disabled while the note is blank.
   2a. The Matter has open child Matters. The dialog lists them under "Open child Matters" with "These child Matters will stay open. Closing this parent changes none of them." A child Lee cannot reach shows as "Restricted Matter".
   2b. Lee clicks Cancel. The Matter stays open and the note is discarded.
3. Lee types a note and clicks "Close matter". The pill reads Closed. "Closed" shows today's date. The note shows in History.
4. Lee checks that a closed Matter stays writable. He edits a Field, adds a comment, uploads a Document, adds a Key date and a Task, and links a Contract.
5. Lee checks the list. The Matter is gone from the default view. "Show closed" brings it back.
6. Lee picks an Open status. The dialog "Reopen {title}?" says "The Matter returns to active surfaces. Its original opened date is preserved." He cancels once. The Matter stays closed. He confirms "Reopen matter". Closed reads "Still open". Opened is unchanged.
7. A stale page tries a plain status change on a closed Matter. The server answers with the reopen problem and the Reopen dialog opens.
8. Admin removes a status while Lee has the page open. Lee picks it: "That status is no longer available. Choose another status."
9. Lee opens "Matter actions", "Archive". "Archive {title}?" says "The matter leaves the default list. Its history and M-number are kept." He confirms.
10. The record shows an "Archived" pill. Every control is read-only: Title, Rows, Owners, progression, Confidentiality, relationships, Linked Contracts, Documents, Key dates, Tasks and Team. The API answers writes with "This matter is archived. Restore it before editing."
11. The Matter leaves the list. "Show archived" shows it. Bea loses it from Your Matters.
12. Lee uses "Matter actions", "Restore". "Restore {title}?" says it returns and becomes editable. It does.
    Watch: MTR-008 says an Administrator restores. The code lets any Member+ archive and restore.
13. Lou, who is not on a Confidential Matter, cannot close, archive or restore it. He cannot open it.
    Notification: no bell or email fires on status change, Close, Reopen, Archive or Restore.

### 5.13 Business User in the Portal

Actors: Bea (on the team), Ben (not on the team), Lee.

1. Bea opens "Matters" in the Portal navigation. "Your Matters" says "Matters you are on the team for." Columns are Reference, Title, Type, Status and Matter Manager.
2. Bea types in "Search Matters". The list narrows. She clears it with "Clear search".
3. Bea filters by Type, Matter Manager, Status and Lifecycle (Open or Closed). She sorts by column. She uses "Show more" when available.
   3a. A filter matches nothing: "No records match your search or filters" and "Clear search and filters".
   3b. Ben has no Matters: "No records are available to you" and "Records appear here when Legal adds you to their team."
4. Bea opens a Matter. The page shows the title, "Matter Type", "Status", "Matter Manager", "Business Owner", "Region" and "Department". Empty values read "Not recorded".
5. Bea reads the "Fields" section. It shows Description and only the Fields whose Row has Visible on Portal on. Nothing is editable.
   Watch: Priority and Risk do not show in the Portal.
6. Bea reads "Original request". It shows "R-{n} · {requester} · Submitted {date}", "Urgency: {urgency}", the original answers and the original files.
7. In "Documents", Bea clicks "Upload documents", picks files in "Files to upload" and clicks "Upload". The Documents appear.
   7a. She opens an existing Document, reads earlier Versions, and uses "Add version" with a "Note (optional)". The next Version becomes current.
   7b. She searches "Search by document name or filename".
   7c. She drops files onto the section.
   7d. She has no controls for folders, archive, delete, confidentiality or metadata.
8. Bea opens Comments. The composer offers only Full Thread. She posts. Legal Only and Working Team comments are absent.
   Notification: Lee and the team get `comment.posted`.
9. Bea edits and deletes her own comment.
10. Bea opens "Matter team". She sees the roster with Matter Manager, Business Owner and Creator labels and no remove buttons. She clicks "Add team member" and adds Ben. Ben can now open the Matter.
    10a. On a Confidential Matter, "Add team member" is disabled and the roster says "Ask Legal to add members to a Confidential record."
    10b. Adding someone already on the team is refused: "This person is already on the team."
11. Bea opens History. She sees shared entries only.
12. Ben types the Matter URL before he is added. He sees "This Matter does not exist, or you cannot open it."
13. Lee removes Bea from the team while her Portal page is open. Her next read or write fails. The Matter leaves her list.
14. Lee closes the Matter. Bea still reads it and can still upload and comment.
15. Lee archives the Matter. It leaves Bea's list. Its address shows "This Matter does not exist, or you cannot open it."
16. Lee uses "View Business Portal" from his own settings. He sees the Portal with the same Business User limits.
17. Bea has no Key dates, Tasks, Status, Type, owner, relationship or Confidential controls in the Portal.

### 5.14 Access and negative checks, in one pass

1. Bea opens `/matters`, `/matters/{n}`, `/home/tasks` and `/settings/matters/types`. Each sends her to the Portal.
2. Lee opens any `/settings/matters/*` or `/settings/documents/matters` URL. He is sent to `/settings/profile`.
3. Ada, not on a Confidential Matter's team and not its Matter Manager, cannot find it in the list, search, Home, Linked Contracts on another record, or relations. A relation to it reads "Restricted Matter" and a linked Contract list reads "Restricted contract".
4. Ada adds herself through another Matter's Task picker. She cannot, because the Matter is hidden from her.
5. Lou on a Confidential Matter team cannot flip Confidential, change the team, or name a Matter Manager.
6. On an archived Matter, every write route answers 409 with "…is archived. Restore it before…".
7. Lee tries to relate, parent or link through an archived Matter. The search leaves it out.
8. Lee tries to create a Matter with an archived template or type through a stale dialog: "The template must be live and belong to the selected matter type." or "The matter type must be a live matter type."

### 5.15 Notifications at a glance

| Event                                                    | Fires when                                               | Who gets it                                              | Channels                       |
| -------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------- | ------------------------------ |
| `matter.task_assigned`                                   | A Task gets or changes assignee                          | The new assignee, not the actor                          | Bell, push, email              |
| `comment.mentioned`                                      | A Matter or Task comment @mentions someone               | Mentioned people who can hear it                         | Bell, push, email              |
| `comment.posted`                                         | Any Matter or Task comment                               | Team and Matter Manager, by audience                     | Bell. Email opt-in             |
| `request.replied`                                        | Matter Team comment on a Matter converted from a Request | The Requester                                            | Requester channels             |
| `date.key_date_approaching`                              | Morning round on lead-time days                          | Selected recipients, or Manager, Business Owner and team | Bell, push, briefing email     |
| `request.submitted`, `request.conversion_draft_finished` | Request submitted; Conversion draft done                 | Member+                                                  | Bell and email per preferences |

Not fired for Matters: team added, Matter Manager assigned, Business Owner assigned, status change, Close, Reopen, Archive, Restore, Document or Version added.

## 6. Documents and Knowledge

These scripts cover the Documents destination, the shared Documents card on records, the document reader, uploads, folders, Document Versions, Comparison, Documents in record creation forms, the Knowledge destination and Knowledge Item record, and the Portal views of Documents and Knowledge.

Three actors appear. The Administrator and the Legal Team Member use the staff app. The Business User uses the Portal. "Member+" means Administrator or Legal Team Member.

Read this before you start. The checkout on `dev` holds uncommitted work that changes deletion. On this build, the row menu says "Delete version", not "Delete". An Administrator deletes one Document Version at a time. The Document goes only when its last Version goes. Script 6.6 covers it. The same uncommitted work adds partial signing to the executed copy. Script 6.8 flags it.

### 6.1 Prerequisite setup

1. Administrator: sign in. Open Settings > Organization > Users. Make sure these people exist and are active: Legal Team Member A, Legal Team Member B, and Business User C. Business User C needs a Portal allowlist domain.
2. Administrator: run Script 6.2 and Script 6.3 first, so that the type lists exist.
3. Legal Team Member A: create Contract "Doc Walk Contract". Make A the Owner. Add Business User C to the Contract team. Do not add Legal Team Member B.
4. Legal Team Member A: create a second Contract "Doc Walk Confidential". Turn on Confidential. Keep B off the team.
5. Legal Team Member A: create Matter "Doc Walk Matter". Add Business User C to the Matter team.
6. Administrator: register Entity "Doc Walk Entity Ltd".
7. Prepare these files on your computer:
   - two Word files, `nda-v1.docx` and `nda-v2.docx`, with a few changed paragraphs and a heading;
   - a text PDF, a scanned image-only PDF, a PNG, a JPG;
   - a PPTX, an `.eml` and an `.msg` that each carry a PDF attachment and a Word attachment;
   - an XLSX, a TXT, a ZIP, an SVG, and a TIFF;
   - a corrupt `.docx` to force a conversion failure. Rename a text file to `.docx`;
   - one file larger than the upload limit, which is `MAX_UPLOAD_MB`, default 100 MB;
   - a folder tree `legacy/` with `legacy/2019/a.pdf`, `legacy/2019/sub/b.docx`, `legacy/2020/c.pdf`, and one empty subfolder `legacy/empty/`.
8. Keep two browser profiles open: one staff session and one Portal session for Business User C.

### 6.2 Settings: Document types

Route: `/settings/documents` redirects to `/settings/documents/matters`. Only the Administrator reaches it. Other roles go to `/settings/profile`.

1. Administrator: open Settings > Documents. See three tabs: Matters, Contracts, Entities. There is no Knowledge tab.
2. Administrator: open the Matters tab. The list is empty. The help line says people pick a type at upload or leave it blank.
3. Administrator: click Add type. Type "Memo". Save. The row appears with a count.
   3a. Click Add type, type a name, then Cancel. Nothing is added.
4. Administrator: rename "Memo" inline to "Advice memo". Start another rename and cancel it. The old name stays.
5. Administrator: open the colour control on the row. Pick Blue. The swatch changes. Pick Automatic. It resets.
   5a. Colour save fails: see "The colour could not be saved. Try again."
6. Administrator: add two more Matter types. Drag one by its grip to reorder. Then focus a grip and use the arrow keys. A live message says "{name} moved to position N of M."
7. Administrator: open the Contracts tab. See the six fixed rows: Draft · ours, Draft · theirs, Redline · theirs, Redline · ours, Executed, Amendment. Each says "{name} has a fixed name. Its colour can be changed."
   7a. Try to rename a fixed row. Rename is locked.
   7b. Try to archive a fixed row. No archive action is offered.
8. Administrator: add an added Contract type "Side letter". Add an Entity type "Board resolution".
9. Administrator: archive "Advice memo" after Script 6.5 has used it. The dialog says how many versions keep the type and that it leaves the upload pickers. There is no reassignment step. Confirm. The row shows as archived with Restore.
   9a. Restore it. It returns to the pickers.
10. Administrator: note the audit line "The change applies immediately and is recorded in the audit log."
    Watch: the archive dialog carries reassign copy in its messages, but the Document types pane passes `archiveKeepsReferences`, so no reassign picker shows. Check the dialog reads cleanly.

### 6.3 Settings: Knowledge types

Route: `/settings/knowledge/types`. Administrator only.

1. Administrator: open Settings > Knowledge > Types. See the seeded types, for example Template, Precedent, Playbook, Article, unless Start blank removed them.
2. Administrator: add "FAQ". Rename it inline. Cancel an unfinished rename.
3. Administrator: reorder types by drag and by arrow keys.
4. Administrator: archive a type that no Knowledge Item uses. The dialog says it can be archived without reassignment.
5. Administrator: archive a type that Knowledge Items use. The dialog asks for a replacement type under "Reassign N knowledge items to".
   5a. No other active type exists: see "No other active type can take its knowledge items. Add or restore another type first." Archive is blocked.
   5b. Pick a replacement and confirm. The items move to the replacement type. History on each item shows a type reassignment.
   5c. Cancel. Nothing changes.
6. Legal Team Member A: open New Knowledge Item and a Knowledge Item record. Confirm the Type pickers show the new names and order.

### 6.4 Uploads on a record Documents tab

Use the Documents tab of "Doc Walk Contract" at `/contracts/:number/documents`. Repeat the short forks on the Matter at `/matters/:number/documents`, the Entity at `/entities/:id/documents`, and a Knowledge Item.

1. Legal Team Member A: open the Contract's Documents tab. The card says "No documents on this contract yet." The header shows a count badge of 0, Show archived, New folder, and Upload.
2. Legal Team Member A: click Upload. The dialog "Upload document" opens with Choose files, Choose folder, "No file chosen", Type, and Note.
   2a. Click Upload with no file. See "Choose a file to upload."
   2b. On a Matter, the Type list shows Matter types, or no Type field if the Matter list is empty.
   2c. On a Knowledge Item, there is no Type field and no Choose folder.
3. Legal Team Member A: choose `nda-v1.docx`. A file tile shows the name and size with a Remove control. Leave Type as "No type". Type a note. Click Upload.
   3a. Click Remove on the tile. The picker clears.
   3b. Click Cancel. Nothing is uploaded.
4. Legal Team Member A: see the row appear with name, Type, v1, Modified, the uploader avatar, and an actions menu. The first Contract Document gets the "Primary" pill.
   Notification: the Contract Owner and team, except the actor, get a bell "A added a document to Doc Walk Contract". Email is opt-in under "Activity on your records". A Confidential Document narrows who hears it.
   4a. Matter, Entity, and Knowledge uploads send no notification.
   Watch: only Contract-owned Documents notify. Check that this is the intended scope.
5. Legal Team Member A: click Upload, then Choose files, and pick three files at once. The single dialog closes and the batch dialog "Import 3 files" opens.
6. Legal Team Member A: in the batch dialog, check Destination "Record root", the list "What this import will create", the Type picker with "Applied to every file in this import. Notes are not collected in bulk.", and the info line "Uploaded files become searchable once processing finishes."
   6a. Click Cancel before import. Nothing is written.
   6b. Click "Import 3 files". The title changes to "Importing 3 files". Rows go Queued, Uploading, Done. See "N of 3 files uploaded" and "N uploading · N queued". The note says "Keep this dialog open until the import finishes."
   6c. All succeed. The dialog closes and the list refreshes.
7. Legal Team Member A: click Upload, then Choose folder, and pick `legacy/`. The batch dialog shows "Folder structure is kept" and a tree with folder counts.
   7a. Import. Folders 2019, 2019/sub, 2020, and empty are created. Files land in place.
   7b. An empty folder that cannot be created shows "Some empty folders of the dropped tree could not be created." The dialog stays open.
8. Legal Team Member A: drag the `legacy/` folder from the desktop onto the Documents card. The card outline highlights. The batch dialog opens with the Destination "Record root".
   8a. Drop onto a folder row instead. The folder row highlights. Destination names that folder.
   8b. Drop files anywhere on the page outside the card while no dialog is open. The same batch dialog opens.
   8c. A dropped folder the browser cannot read shows "1 folder could not be read: name. Check the list below, it may be missing files." The dialog stays open after import.
9. Legal Team Member A: import a batch that includes the over-limit file.
   9a. That row fails with "That file is over the 100 MB upload limit." It has no Retry button. The others land.
   9b. The dialog stays open with "Imported N of M files", "1 file failed. The other N are on the contract.", and the note "Retry uploads the selected file again. Files over the size limit must be reduced before retrying."
   9c. Click Done to dismiss the failure.
10. Legal Team Member A: import a batch and cut the network during upload. Rows fail with a retryable error.
    10a. Click Retry on one row. It re-sends only that file.
    10b. Click "Retry N files". Only failed rows re-send. Successful files are never sent twice.
    10c. All retries succeed. The dialog closes.
    10d. Click "Cancel remaining" during a run. Unsent rows read "Cancelled before it was uploaded." and are retryable.
11. Legal Team Member A: upload a file with the same name as an existing Document. A second, separate Document appears. No warning shows.
    Watch: nothing warns about duplicate names on upload. Only creation forms drop an identical staged file.
12. Legal Team Member A: upload each format from Script 6.1: text PDF, scanned PDF, PNG, JPG, PPTX, EML, MSG, XLSX, TXT, ZIP, SVG, TIFF, corrupt DOCX. Every file uploads. No type is refused. Script 6.7 covers how each one reads.
13. Legal Team Member A: archive the Contract, then open its Documents tab. Upload, New folder, Show archived, checkboxes, and row menus are gone. The reader and Compare still work.
    13a. An upload that reaches the API anyway is refused with "This contract is archived. Restore it before uploading."
14. Legal Team Member A: restore the Contract before you continue.

### 6.5 Document rows: details, Type, confidentiality, archive, move

1. Legal Team Member A: open a row's actions menu, "Actions for {title}". See, where they apply: Compare with previous, Make primary, Mark as executed copy, Add version, Edit details, Move to folder, Mark confidential, Archive, and, for the Administrator only, Delete version.
   1a. Matter and Entity rows have no Make primary and no executed items.
   1b. Knowledge rows say "Set as primary" and have no Move to folder and no executed items.
2. Legal Team Member A: choose Edit details. Change Name and Description. Save. The row shows the new name and a muted description line.
   2a. Clear the name and Save. See "Give the document a name."
   2b. Save fails. See "Those details could not be saved. Try again." Input stays.
3. Legal Team Member A: in the Type column, open the pill select "Type of version N of {title}". Pick "Draft · theirs". The pill colour changes. History records a type change.
   3a. Pick "No type". The pill clears.
   3b. An archived Type still shows on Versions that carry it and stays in that row's select.
   3c. A Generated redline row, an archived Document, an archived record, and a Knowledge row show the Type as plain read-only text. A Knowledge row shows the Item's Knowledge type.
4. Legal Team Member A, who uploaded the file or owns the Contract: choose Mark confidential. The confidential marker shows beside the name.
   4a. Legal Team Member B opens the same Contract. That row is absent. Nothing hints at it. The count badge omits it.
   4b. Choose Clear confidential mark. B sees the row again.
   4c. Legal Team Member B, who neither uploaded it nor owns the Contract, does not see Mark confidential at all.
   4d. On an Entity, mark a Document confidential. Legal Team Member B, who reaches the Entity, still sees it.
   Watch: the Entity arm of the audience rule ignores the flag, so the mark does not narrow anything on Entities.
   4e. Administrator, not on the Contract team and not Owner, marks a Document confidential. The row then disappears for that Administrator.
   Watch: DD-014's 2026-09-10 amendment says Administrators do not bypass the wall. The menu still lets them lock themselves out.
5. Legal Team Member A: choose Archive. The row leaves the list and the count drops.
   5a. Turn on Show archived. The row returns with an "Archived" pill. Its menu offers Restore only, plus Delete version for the Administrator.
   5b. Choose Restore. The pill goes.
6. Legal Team Member A: choose Move to folder. The dialog "Move {title}" has "File in" with None and each folder path. Pick a folder. Move.
   6a. Choose None to move it back to the record root.
   6b. Drag a row by its body onto a folder row. The folder highlights and the row moves.
   6c. While dragging, a floating target "Drop here to move out of folders" shows at the bottom left. Drop on it to move to the root.
   6d. Archived rows cannot be dragged.
7. Legal Team Member A: tick several row checkboxes, including rows inside an open folder. A toolbar shows "N selected", Move, Archive, Restore when every selected row is archived, Delete versions for the Administrator, and Clear selection.
   7a. Click Move. The dialog "Move N documents" offers None and folders. Confirm. One refresh follows.
   7b. Click Archive. Rows leave the list.
   7c. Mix live and archived rows. Move and Archive are disabled.
   7d. Tick "Select visible documents" in the header. It selects all visible rows. Tick again to clear. A partial selection shows the indeterminate state.
   7e. One row fails. The selection keeps only failed rows with "{title}: {detail}". "Updating documents…" shows while it runs.
   7f. On a Knowledge Item, the toolbar has no Move.
   Watch: the brief expected bulk Download and bulk Change type. Neither exists.
8. Legal Team Member A: click Show more under the list when more than one page exists. Focus lands on the first new row. A screen reader hears "N more documents. M shown."
   8a. Show more fails. See "The next documents could not be read. Try again."

### 6.6 Delete a Version and delete a Document

Uncommitted on this build. Administrator only.

1. Administrator: open a Contract Document with three Versions. Open the row menu. Choose Delete version. It targets the current Version.
2. Administrator: read the dialog "Delete version 3?". It says "Version 3 of {title} and its stored file will be removed. You cannot undo this." and "All other versions will remain."
   2a. Type anything other than `delete`. The Delete version button stays disabled.
   2b. Click Cancel. Nothing changes.
3. Administrator: type `delete` and confirm. The chain now shows v2 as current. History says "{actor} deleted version 3 of {title}".
4. Administrator: add a new Version. It becomes v4, not v3.
   Watch: numbers are never reused, so the chain now has a gap.
5. Administrator: expand earlier Versions. Open the menu on the v1 row, "Actions for version 1 of {title}". Choose Delete version.
   5a. A Generated redline was made from v1. The API refuses: "A generated comparison version uses this version. Delete that comparison version first."
   5b. Delete the Generated redline Version first, then v1. Both succeed. Stored Comparisons that used either Version are removed.
6. Administrator: on a Document with one Version, choose Delete version. The dialog says "This is the last version, so the document will also be removed." Confirm. The row disappears. History records the version deletion and the Document erasure.
7. Administrator: tick two Documents. Click Delete versions. The dialog "Delete 2 selected versions?" says only the current Version of each goes. Type `delete`. Confirm.
8. Administrator: delete the Version that holds the Executed pin. The Executed badge disappears.
   Watch: the pin clears silently. The same happens to an Envelope's source Version and a Contract analysis run's Version.
9. Administrator: try to delete a Version of an Auto-Doc template Document. The API refuses with "The template belongs to its Auto-Doc and cannot be removed separately."
10. Legal Team Member A: confirm Delete version is absent from every menu.
11. Administrator: open Settings > Security > Audit log. The erasure entries remain.
    Watch: DOC-010 and the glossary still say a Version is immutable and never deleted. The whole-Document erasure route still exists but no UI calls it now. Record a decision before this ships.

### 6.7 Folders on a record

Contracts, Matters, and Entities only. Knowledge Items have no Document folders.

1. Legal Team Member A: click New folder. Type "Correspondence". Save. The folder row appears above loose Documents with "Empty".
   1a. Save with a blank name. See "Give the folder a name."
   1b. Name it `..` or `.`. The API refuses: "A folder cannot be named . or .. ...".
   1c. Name it with a slash. See "A folder name cannot contain a slash. Make a folder inside instead."
   1d. Reuse a sibling's name in any case. See "A folder named {name} is already here."
2. Legal Team Member A: open the folder menu, "Actions for the {name} folder". See Rename, Move, New subfolder, Delete.
3. Legal Team Member A: choose New subfolder. The title reads "New folder in Correspondence". Save. The parent opens.
   3a. Nest 10 levels deep and try an 11th. See "Folders can be nested 10 deep. Put this one higher up."
4. Legal Team Member A: expand and collapse folders with the chevron. A folder with no visible Documents and no subfolders has no chevron. The row reads "N documents · N folders".
   4a. A folder whose only Documents are confidential and hidden from you reads "Empty".
   4b. Open a large folder. Skeleton rows show "Loading the documents in {name}". Then use "Show more in {name}".
5. Legal Team Member A: choose Rename. Change the name. Save.
6. Legal Team Member A: choose Move. The "Move into" select lists None and eligible folders. It never lists the folder itself or its descendants. Pick a parent. Move.
   6a. A move into itself through the API is refused: "A folder cannot be moved inside itself."
7. Legal Team Member A: choose Delete. The dialog says "Anything in it moves into {parent}. Nothing is deleted." For a top-level folder it says "Anything in it moves onto the contract itself. Nothing is deleted." Confirm. Contents move up.
   7a. Delete would put two same-named folders side by side. The API refuses. Check the message.
8. Legal Team Member A: archive the record. Folder menus and New folder disappear.

### 6.8 The shared document reader

Open each file from Script 6.4 step 12 by clicking its name.

1. Legal Team Member A: click the text PDF name. The reader opens beside or over the record. The header shows the title, "v1", and a close button. The toolbar shows the filename and Download.
   1a. At a container width of 1400 px or more the reader docks beside the record. Narrower, it overlays. Switch Contract tabs. The overlay closes. The docked reader stays.
2. Legal Team Member A: use Previous page and Next page. "Page X of Y" updates. Both buttons stop at the first and last page.
3. Legal Team Member A: use Zoom in and Zoom out. Zoom runs from 50% to 300% in seven steps and stops at each end.
4. Legal Team Member A: press Ctrl+F or Cmd+F, or click "Find in document". Type a word. See "1 of N". Use Next match and Previous match. Type a word that is not there. See "No matches". Press Escape to close Find. Press Ctrl+F again. The query is focused and selected. Close the reader. Browser Find works again.
5. Legal Team Member A: press Escape with Find closed. The reader closes. Focus returns to the name you clicked.
6. Legal Team Member A: click Download. The original file downloads with its original name.
7. Legal Team Member A: open the scanned PDF. The original scan renders.
   7a. Use Find for a word visible in the scan. See "No matches".
   Watch: OCR text feeds search and analysis only, never the reader. Nothing on the record shows OCR status. The only place to see it is Advanced search with the Document "Text state" condition: Pending, Ready, Failed, Unsupported.
   7b. Search the app header for a word from the scan after OCR finishes. The Document hit opens the reader with Find seeded from `find=`.
8. Legal Team Member A: open `nda-v1.docx`. See "Preparing this document for reading…". It then renders as a PDF with page and zoom controls.
   8a. Open the corrupt DOCX. After polling, see "This file could not be prepared for reading here. Download it to read it." and a Download link.
   8b. Stop the API during polling. After three unanswered polls the same failure card shows.
9. Legal Team Member A: open the PPTX. It converts and renders like Word.
10. Legal Team Member A: open the PNG and the JPG. The image draws inline with the filename as its label.
11. Legal Team Member A: open the EML and the MSG. See Subject, From, To, Cc, Bcc, Date, the body in a frame, and "N attachments".
    11a. Remote images in the body do not load.
    11b. Open the PDF attachment. It renders inside the reader. Click "Back to the message".
    11c. The Word attachment offers Download only.
    11d. A message with no body says "This message has no body." Missing addresses read "Not recorded". No subject reads "No subject".
    11e. A file named `.eml` that is not an email falls back to the failure card with Download.
12. Legal Team Member A: click the XLSX, TXT, ZIP, SVG, or TIFF name. Each downloads at once. None opens the reader.
    12a. Reach one of these through a deep link. The reader shows "This file type does not open here. Download it to read it."
13. Legal Team Member A: expand earlier Versions. Click an earlier filename. The reader header shows that Version number.
14. Legal Team Member A: open a Version that has a previous comparable Version. The header shows a Compare link. If a ready Comparison exists already, the link shows the change count instead.
    14a. v1 and Generated redline Versions show no Compare link.
15. Legal Team Member A: paste `/contracts/:number/documents?doc={id}&version={versionId}` into a new tab. The record opens with the reader on that Version.
    15a. Use a Version id that is not on that Document. The record opens with the reader closed. No message shows.
    Watch: the reader has no version switcher, rename, Type picker, or delete. Those live on the Documents card rows. The brief expected some of them in the reader.

### 6.9 Document Versions, primary, Executed pin

1. Legal Team Member A: open the row menu on `nda-v1.docx`. Choose Add version. The dialog "Add version" has Choose file, which takes one file, Type, and Note with the placeholder "What changed in this round". There is no Choose folder.
2. Legal Team Member A: choose `nda-v2.docx`. Pick Type "Redline · theirs". Note "Counterparty comments". Upload. The row now shows v2 as current, with the note under the name and a chevron "Show the 1 earlier version of {title}".
   Notification: the Contract audience, except the actor, gets "A added a version to Doc Walk Contract".
   2a. Note over 2000 characters is refused.
   2b. On an archived Document, Add version is not offered. The API says "This document is archived. Restore it before changing it."
3. Legal Team Member A: expand the chain. Superseded rows show the filename, Type, Version, Modified, uploader, and a Version menu.
4. Legal Team Member A: upload a second Document to the Contract. Open its menu. Choose Make primary. The "Primary" pill moves to it. The old primary loses it.
   4a. There is no way to clear the primary. This is by design on Contracts.
   4b. Matters and Entities have no primary.
5. Legal Team Member A: on the Contract's primary Document, choose Mark as executed copy on the current row. The Version cell shows "Executed".
   5a. Open an earlier Version's menu. Choose Mark as executed copy. The pin moves to that Version.
   5b. Choose Unmark as executed copy. The badge goes.
   5c. Pin a Version with Type "Draft · ours". It works. The pin never reads the Type.
6. Legal Team Member A: from the Contract renewal Amendment path, open the amendment flow. The Add version dialog opens on the primary Document with Type "Amendment" preselected.
   6a. The primary Document sits in a closed folder or an unloaded page. See "The primary Document is outside this list. Open its folder or load more Documents, then choose Add version on the primary Document and select Amendment."
7. E-signature connector, if configured: complete an Envelope on the primary Document. The executed copy lands as a new Version with Type Executed, the pin moves to it, and the Contract moves on from Signature.
   Notification: the Contract audience gets "A version was added to Doc Walk Contract" with no actor.
   Watch: uncommitted partial signing files a non-completing round as "(partially signed).pdf" with a note, no Executed type, and no pin.

### 6.10 Comparison

Route: `/documents/:documentId/compare?from={older}&to={newer}`. Member+ only.

1. Legal Team Member A: on the `nda` row with v1 and v2, choose Compare with previous. The page opens with the breadcrumb "Documents > Doc Walk Contract > Compare", a "v1 → v2" button, and a close control.
2. Legal Team Member A: see "Preparing comparison" and "Comparing both versions. This page will update when it is ready." The page polls every 1.5 seconds.
3. Legal Team Member A: when ready, see the Changes pane with a count, a list of changes with Inserted, Deleted, or Replaced, and the compared document. Inserted text is underlined green. Deleted text is struck through red.
4. Legal Team Member A: click a change in the list. The document scrolls to that paragraph and marks it. The list item is current.
5. Legal Team Member A: use Previous change and Next change.
   Watch: they wrap from last to first and first to last. The checklist expects first and last limits.
6. Legal Team Member A: click "v1 → v2". The popover shows Older and Newer selects. Only non-generated Versions show. Older lists Versions below Newer, and Newer lists Versions above Older. Pick another pair. The page loads that pair and starts a new Comparison if needed.
7. Legal Team Member A: click Export track changes.
   7a. Word pair, meaning both Versions are doc, docx, odt, or rtf: the button changes to Open redline. A new Version "{title} v1-v2 redline.docx" joins the chain with Type "Generated redline" and the line "Compares v1 and v2".
   Notification: the Contract audience gets "A added a version to Doc Walk Contract".
   7b. Click Open redline. The owning record's Documents tab opens with the reader on the redline.
   7c. Export the same pair again through the API. It returns the same Version and appends nothing.
   7d. PDF or mixed pair: the button is absent. The line "Export needs two Word files." shows. The page also shows "This comparison was built from extracted text, so formatting is not shown."
   7e. Export fails. See "The redline could not be exported."
   7f. Archived Document, Auto-Doc template, or a Comparison still pending: no export control shows.
8. Legal Team Member A: compare two identical Versions. See "No changes" and "These versions contain the same text."
9. Legal Team Member A: compare a scanned PDF v1 with a text PDF v2 while OCR is still running. The page stays on "Preparing comparison" until text extraction finishes, then shows the text result.
10. Legal Team Member A: compare two PNG Versions. See "Comparison failed" with "Version 1 does not support extracted text." and two "Download {filename}" links.
    10a. A Version whose text extraction failed gives "Version N text extraction failed."
    Watch: a failed Comparison is terminal for that pair. There is no retry. Only a poll failure invites you to open the page again.
11. Legal Team Member A: stop the API while the page is preparing. After three unanswered polls see "The comparison status could not be read. Try opening it again." with the download links.
12. Legal Team Member A: edit the URL.
    12a. Same Version for `from` and `to`: refused, "Choose two distinct versions to compare."
    12b. `from` newer than `to`: refused, "The older version must come before the newer version."
    12c. A Generated redline as either operand: refused, "A generated redline cannot be compared again."
    12d. A Version from a different Document: refused, "Both versions must belong to this document."
    12e. Missing `from` or `to`: "Choose two document versions to compare."
    Watch: every refusal lands on the generic route error page, not a friendly card.
13. Legal Team Member A: archive the Document, then reopen the Comparison. It still reads. Export is hidden.
14. Legal Team Member A: click the close control. The owning record's Documents tab opens.
15. Legal Team Member B: open the URL of a Comparison on a Confidential Document B cannot see. It behaves as if the Document does not exist.
16. Business User C: open any Comparison URL. The app redirects away.

### 6.11 The Documents destination

Route: `/documents`. Member+ only. A Business User is redirected.

1. Legal Team Member A: open Documents from the navigation. See the title, "N documents shown", the Recent block with five rows, the Filter bar, Views, Columns, and the managed table.
   1a. Recent means the five reachable Documents whose current Version was uploaded most recently. It hides while any filter is on.
   1b. Fresh install: "No documents yet" and "Upload to a record and it appears here." There is no upload control on this page.
2. Legal Team Member A: read the default columns: Title, Owning record, Type, Format, Size, Versions, Uploader, Uploaded. Archived rows carry an "Archived" pill. Confidential rows carry the marker.
3. Legal Team Member A: sort by Title, Owning record, Type, Format, Size, Uploader, and Uploaded, both directions. Versions does not sort.
4. Legal Team Member A: open the Filter menu. Choose Owner: Contracts, Matters, Entities, Auto-Docs, Knowledge.
   4a. Pick a Record. For a Contract or Matter it reads "{reference} · {title}". Choosing a Record of another owner clears the owner choice.
   4b. With a Contract, Matter, or Entity Record chosen, a Folder filter appears with "Record root" and folder paths. Changing the Record clears the Folder.
   4c. With a Knowledge Item or Auto-Doc Record, no Folder filter shows.
5. Legal Team Member A: filter by Format: PDF, Word, PowerPoint, Image, Email, Other. Pick two. They combine with OR.
6. Legal Team Member A: filter by Kind: General, Draft · ours, Draft · theirs, Redline · theirs, Redline · ours, Executed, Amendment, Generated redline.
   Watch: the Type column shows Document type names, but the Kind filter uses the fixed kinds. Every added type, such as "Side letter", files under General.
7. Legal Team Member A: filter by Counterparty and by Uploader. An archived uploader reads "{name} (archived)".
8. Legal Team Member A: set Uploaded from and to dates. Both ends are inclusive.
9. Legal Team Member A: turn on Show archived. Archived rows show. An Actions column appears with Restore on archived rows. Click Restore. The pill goes.
   9a. Restore fails. See "{title} could not be restored."
10. Legal Team Member A: remove one filter chip. Then click Clear filters.
    10a. Filters that match nothing show "No documents match these filters.", "Clear filters to return to the whole list.", and a Clear filters button.
11. Legal Team Member A: copy the URL with filters. Open it in a new tab. The same filters apply.
12. Legal Team Member A: use Views: Save as "My PDFs", Save, Rename, Set default, Reset, Delete. Reload. The default view opens.
13. Legal Team Member A: use Columns to hide Size and show it again. Title cannot be hidden.
14. Legal Team Member A: click Show more. Rows append and focus lands on the first new row.
    14a. Show more fails. See "The next Documents could not be read. Try again."
15. Legal Team Member A: click a row or a Recent entry. It opens the owning record's Documents tab with the reader on the current Version. Knowledge rows open `/knowledge/:id`. Auto-Doc rows open the Auto-Doc.
16. Legal Team Member A: drag a Contract row. A floating "Move to folder" panel lists that Contract's folders and None. Drop on a folder. See "Moved {title}."
    16a. Knowledge, Auto-Doc, and archived rows cannot be dragged.
    16b. Folder load fails. See "Retry loading folders".
17. Legal Team Member B: open Documents. Rows owned by "Doc Walk Confidential" are absent. Confidential Documents B is not named on are absent. Counts and filter options omit them.
18. Legal Team Member B: open a saved link to a row B cannot reach. The record page says it is not found.

### 6.12 Documents in record creation forms

Applies to New Matter, new sub-Matter, New Contract including renewal children and successors, Entity registration, New Knowledge Item, and intake Conversion.

1. Legal Team Member A: open New Contract. Find the Documents area with "Attach documents" and "or drag and drop files here".
2. Legal Team Member A: choose three files. Tiles show names and sizes, each with Remove. A "Document type" select appears with the Contract list.
   2a. Choose the same file twice. It is staged once.
   2b. Remove one tile.
   2c. On New Matter, the select shows Matter types, or does not show if the list is empty.
   2d. On New Knowledge Item, there is no Document type select.
   2e. On Conversion, the Request's existing attachments show as tiles with Download.
3. Legal Team Member A: click Cancel. Nothing is created and nothing uploads.
4. Legal Team Member A: fill the form again and create. See "Record created. Uploading documents…". Tiles turn to Uploaded.
   4a. All succeed. The dialog closes and the record opens.
   4b. One fails. See "Record created. Some documents could not be uploaded." with "Retry failed uploads" and Continue. Retry sends only failed files. The record is never created twice.
   4c. Click Continue with a failure left. The record opens without that file.

### 6.13 The Knowledge destination

Route: `/knowledge`. Member+ only.

1. Legal Team Member A: open Knowledge. On a blank library see "Build your Knowledge library", "Create guidance your legal team can find again.", and New item.
2. Legal Team Member A: see the folder tree on the left with "All Knowledge" and no folders.
3. Legal Team Member A: click Add folder. Type "Contracts playbooks". Click Add folder. It appears in the tree.
   3a. Blank name keeps the button disabled.
   3b. Same name as a sibling is refused, "A folder with that name already exists here."
4. Legal Team Member A: select the new folder. Click Add folder again and add "NDAs". It is created inside the selected folder.
   Watch: the Add folder dialog does not say it nests under the selected folder.
5. Legal Team Member A: with a folder selected, use "Move {name} up" and "Move {name} down". They swap siblings.
6. Legal Team Member A: click "Rename or move selected folder". Change the name. Change Parent folder to Library. Save folder.
   6a. Pick one of its own descendants as parent. Refused, "A folder cannot be moved inside itself."
7. Legal Team Member A: click "Delete selected folder". The dialog says "Its folders and items move to the parent folder. Nothing is deleted." Confirm. The tree selects the parent.
8. Legal Team Member A: open New > New Knowledge Item. Enter Title, pick Type, pick Folder, attach one file. Click Create item. The record opens.
   8a. No Knowledge types exist: see "An Administrator must add a Knowledge type first." Create stays disabled.
   8b. Cancel before create. Nothing is written.
9. Legal Team Member A: open New > New from files. Drop three files into the dialog or choose them. See "3 files selected". Pick Type and Folder. Click Create drafts.
   9a. Three draft Items appear, each titled from its filename, each with that file as its primary document. The page opens the first Item only.
   9b. Create fails. See "The files could not be added." or the API reason.
   Watch: dropping files on the Knowledge page itself does nothing. KNW-001 describes drop-to-create on the destination.
10. Legal Team Member A: read the list columns: Title with a Draft marker, Type, Format, State, Audience, Folder, Author, Updated, and an Actions column. Actions shows "Open preview" only when the Item has a primary document.
11. Legal Team Member A: filter by Type, State, Audience, Author, and Format. Click Clear filters.
    11a. No match: "No Knowledge items match these filters" and "Clear filters or choose another folder."
12. Legal Team Member A: select a folder. The list shows that folder and its descendants. Click All Knowledge to reset.
13. Legal Team Member A: sort by each sortable column, use Show more, and use Views and Columns as in Script 10.
14. Legal Team Member A: click "Open preview" in an Item's Actions. The Item opens with its primary document in the reader.
15. Business User C: open `/knowledge`. The app redirects away.

### 6.14 The Knowledge Item record

Route: `/knowledge/:id`.

1. Legal Team Member A: open a draft Item. The header shows the Knowledge breadcrumb, the title, a "Draft" marker, and "Knowledge Item actions".
2. Legal Team Member A: in the Knowledge item section, edit Title and press Enter. Press Escape during an edit to revert.
3. Legal Team Member A: change Type. Files on the Item now show the new Knowledge type in their Type column.
   3a. Administrator sees "Manage types…" beside Type. It opens Settings > Knowledge > Types. Legal Team Member A does not see it.
4. Legal Team Member A: change Folder, including Library.
5. Legal Team Member A: read "Primary document". Click it or its "Open preview" to open the reader.
   5a. An Item with no files shows "None".
6. Legal Team Member A: in the Documents card, upload a second file. The first file stays primary. On an Item with no primary, the first upload becomes primary.
7. Legal Team Member A: open the second file's menu. Choose "Set as primary". The Primary pill and the Primary document field move.
   Watch: there is no way to clear the primary pin in the UI. KNW-001 says Member+ may clear it.
8. Legal Team Member A: archive the primary Document.
   Watch: the archive route keeps the pin, so the Item may point at an archived Document. Check the record and the Portal article.
9. Legal Team Member A: add a Version, Edit details, Mark confidential, Archive, Restore, and Compare with previous, as in Scripts 6.5, 6.9 and 6.10. There is no New folder and no Move.
   9a. Legal Team Member A uploads a file and marks it confidential. The file disappears for A.
   Watch: only the Administrator reaches a confidential Knowledge Document. The uploader can lock themselves out.
10. Legal Team Member A: in Guidance, click Add guidance. Write Markdown with a heading, a list, a link, emphasis, and code. Click away. It saves on blur.
11. Legal Team Member A: click Preview. The Markdown renders. Raw HTML stays as text. Follow a link. Click Edit to return.
12. Legal Team Member A: open "Knowledge Item actions" and choose Publish. The Draft marker goes.
13. Legal Team Member A: set Audience to Everyone. The "On the portal" marker shows.
14. Administrator: add a deflection link to this Item. Settings > Intake > Deflection links > Add link. Choose "Knowledge item", pick the Item, enter Label, choose Placement "Portal home", then Add link. Only published, Everyone, live Items are listed.
15. Legal Team Member A: set Audience back to Legal Only. The dialog "Remove this from the portal?" says "1 deflection link points at this item..." Click Cancel. Nothing changes.
    15a. Click Continue. Audience changes. The link stays in Settings but drops off the Portal.
16. Legal Team Member A: choose Unpublish on a published Everyone Item with links. The same warning shows. Continue returns the Item to Draft.
17. Legal Team Member A: choose Archive. The dialog "Archive Knowledge Item" offers "Replaced by" with No replacement or a live Item. Cancel, then Archive with a replacement.
    17a. The replacement list fails to load. See "The replacement list could not be read. You can archive without naming one."
    17b. The header shows "Archived". Fields, Guidance, and Documents freeze.
    17c. Upload through the API is refused, "Restore this Knowledge Item before adding Documents."
    Watch: the Knowledge list hides archived Items and has no Show archived switch. You need a direct link, search, or History to get back.
    Watch: the replacement shows only in History. Nothing on the record or the Portal uses it.
18. Legal Team Member A: choose Restore. The Item returns with the state and Audience it had.
    Watch: a published Everyone Item goes straight back onto the Portal on restore, with no prompt.
19. Legal Team Member A: open History. See created, updated, published, unpublished, archived, restored, and Document entries. Load older entries. Close and reopen the applet.
20. Legal Team Member A: open `/knowledge/{bad id}`. See "Knowledge Item not found" and "Back to Knowledge".

### 6.15 Documents on the Portal for a Business User

Business User C is on the team of "Doc Walk Contract" and "Doc Walk Matter".

1. Business User C: sign in to the Portal. Open the Contract from the Portal home.
2. Business User C: find the Documents section. Each Document shows one current row with "Version N", the Type or kind pill, "Current", and "Signed copy" on the pinned Version. The primary Contract Document shows "Primary Document".
3. Business User C: click "N earlier versions". Earlier Versions list with their own Download.
4. Business User C: click a filename. The reader opens, as in Script 7. Close it with Escape.
5. Business User C: click Download on a Version. The file downloads.
6. Business User C: click "Add version" on the primary Document. The dialog "Upload documents" opens with "Add as" set to "New version of {name}", "Files to upload", Kind, and "Note (optional)".
   6a. Kind offers General and the six fixed kinds on Contracts only. The Matter has no Kind field.
   Watch: the Portal still speaks kinds, not Document types. A Version with an added type such as "Side letter" reads "General" on the Portal.
   6b. Choose two files for a version. See "Choose one file for a new version."
7. Business User C: choose one file, pick Redline · theirs, add a note, and click Upload. The row shows Version 2.
   Notification: the Contract audience gets "C added a version to Doc Walk Contract". A Matter upload notifies nobody.
8. Business User C: click Upload documents, or drop files on "Drop files here or click to upload". "Add as" defaults to "New documents". Upload two files. See "2 files uploaded."
   8a. One file fails. Its tile shows the error. Click "Retry failed uploads".
   8b. Click Cancel. Nothing uploads.
9. Business User C: type in "Search Documents" and click Search. Only matching Documents show. "No Documents match your search." shows when nothing matches. Click Clear.
   9a. The list fails. See "The Documents could not be read." and Try again.
10. Business User C: look for delete, archive, move, rename, Type, confidential, primary, executed, and Compare controls. None exist.
    10a. Call the archive or delete API directly. It is refused.
11. Business User C: open `/documents`, `/knowledge`, or a Comparison URL. The app redirects away.
12. Legal Team Member A: remove C from the Contract team. C can no longer open the Contract or its Documents.

### 6.16 Knowledge on the Portal

1. Business User C: open the Portal home. The "Before you submit" panel shows the deflection link from Script 6.14 step 14.
   1a. Links also show on a Request form when Placement names that Request type.
2. Business User C: click the link. `/portal/knowledge/:id` opens in the same tab. See the "From Legal" kicker, the title, a Documents card with each current Version and Download, then Guidance.
   2a. The primary file lists first. The body comes last. There is no author, folder, type, or edit control.
   2b. A confidential Document on the Item is absent. Its download link answers the same not-found as a missing article.
   2c. An external URL link opens in a new tab.
3. Business User C: click "Download {filename}". The file downloads.
4. Business User C: follow a Markdown link in Guidance.
5. Business User C: click "Your requests" or the brand. The Portal home opens.
6. Legal Team Member A: unpublish the Item, or set it Legal Only, or archive it.
7. Business User C: reload the Portal home. The link is gone. Open the saved article URL. The Portal redirects to its home with no error.

## 7. Entities

These scripts cover the Entities module. An Entity is one of our own corporate entities, not a Counterparty. Walk them in order. Each script assumes the scripts above it have run.

Actors used below:

- Admin A. An Administrator.
- Admin B. A second Administrator who never receives a Grant.
- Legal L1. A Legal Team Member.
- Legal L2. A second Legal Team Member.
- Business User U1. A Business User with Portal access.

Routes:

- Destination: `/entities` (Calendar), `/entities?view=list`, `/entities?view=chart`.
- Entity record: `/entities/:id` (Overview), `/ownership`, `/obligations`, `/documents`, `/contracts`, `/matters`.
- Settings: `/settings/entities/types`, `/settings/entities/types/:id` (Details) and `/form`, `/settings/entities/officer-roles`, `/settings/entities/fields`, `/settings/documents/entities`, Settings General for Currencies in use.

### 7.1 Prerequisite setup

1. Admin A signs in on a fresh install and reaches the `/welcome` Review step.
   - 1a. Keep the seeds. Entity types Corporation, LLC, Partnership, Branch and Other exist. Director & Officer roles Director, CEO, CFO, Secretary and Other exist.
   - 1b. Choose Start blank. Every Entity type and Director & Officer role except the protected Other row is gone. The Review acknowledgement is recorded with one activity-log row per emptied list.
   - 1c. After onboarding completes, or after any user-created row exists, Start blank is refused.
2. Admin A opens Settings General and the Currencies in use card. Admin A adds GBP and USD with Add new currency. Admin A removes one and sees that existing record values stay intact.
   - Watch: par value, share class par value and entry price all read this list. Check each picker after the change.
3. Admin A opens Settings, Entities, Types. Admin A sees the list title "Entity types", the count, and the in-use count per row.
4. Admin A clicks Add type, enters "Operating company", and saves. Admin A adds "Holding company" and then "Test type" and cancels the third.
5. Admin A renames "Holding company" inline, commits with Enter, then starts a second rename and cancels it with Escape.
6. Admin A reorders types by drag, then by focusing a handle and using the arrow keys. A live region says "{name} moved to position N of M."
7. Admin A hovers the archive control on Other and sees "Other is system-protected and can't be archived".
8. Admin A opens Settings, Entities, Fields. Admin A adds Entity Fields, one per data type: text ("Company secretary email"), long text, number ("Employee count"), money, currency, date ("Year end"), boolean ("Dormant filing exempt"), single select ("Filing tier", one option per line), multi select, user ("Relationship partner") and entity ("Parent guarantor").
   - Admin A fills name, description and the Business or Legal tag on each.
   - Admin A sees no AI extraction prompt field. Only Contract Fields take a prompt.
   - Admin A cancels one create, then saves one with a missing name and corrects the refusal.
   - Admin A renames a Field inline and cancels an unfinished rename.
   - Admin A edits name, description, tag and options, and sees that the data type is fixed.
9. Admin A opens the "Operating company" type with Edit. The Details section shows Display name, Description and "N entities use this type." Admin A edits both text fields, commits on blur, and cancels an edit with Escape.
10. Admin A opens the Form section.
    - Admin A clicks Attach Field, searches, and attaches "Filing tier", "Year end", "Employee count" and "Relationship partner".
    - Admin A turns on Required for creation on "Filing tier".
    - Admin A sees no On intake form column, no Visible on Portal column, and no Preview intake form button.
    - Admin A puts "Year end" under a condition: "Filing tier is Large". Admin A edits the condition, adds a Field into it, moves one out of the condition, and removes the condition.
    - Admin A tries to remove a Row that a Branch condition uses and sees "Used by a Branch condition. Change the condition first".
    - Admin A reorders Rows by drag and keyboard.
    - Admin A detaches a Field and confirms the catalog Field still exists.
    - When every Entity Field is attached, the picker says "All Fields are attached".
11. Admin A uses All types to go back, then opens the "Holding company" editor directly from the URL. The title and Rows change to that type.
12. Admin A opens Settings, Entities, Director & Officer roles. Admin A adds "General Counsel" and "Company Secretary", renames one, cancels a rename, and reorders with drag and arrow keys. Admin A hovers the archive control on Other and sees it is protected.
13. Admin A opens Settings, Documents, Entities. Admin A adds Entity document types "Certificate of incorporation", "Board resolution" and "Annual return". Admin A sets a colour on one, renames one, reorders, archives one, and restores it.
14. Admin A checks the organization reminder lead times in notification settings. Legal L1 sets personal lead times under My reminder lead times.
15. Negative. Legal L1 opens `/settings/entities/types` by URL and lands on `/settings/profile`. The same happens for the type editor. Legal L1 still sees the type names in the Add entity picker, because that picker reads a Member+ route.

### 7.2 Entities destination: Calendar, List and Chart

1. Legal L1 clicks Entities in the nav. The page opens on Calendar with the subtitle "0 entities" and the Compliance calendar card.
2. With no Entities, Legal L1 sees "No obligations yet" and "Obligations added to Entity records appear here." There is no Add obligation link yet, because no Entity exists.
3. Legal L1 clicks List. The empty state says "No Entities yet" with the registry explanation and an Add entity button.
4. Legal L1 clicks Chart and then back to Calendar. Each view reopens from its URL on reload and with browser Back.
   - Watch: the UX checklist still names the button "Register entity". The button reads "Add entity" and the dialog submit reads "Register".

### 7.3 Create an Entity

1. Legal L1 clicks Add entity on the List view. The dialog "Add entity" opens with focus on Legal name.
2. Legal L1 clicks Register with nothing filled. The dialog asks for the registered legal name.
3. Legal L1 types "Acme Holdings Ltd" and clicks Register again. The dialog says "Pick an entity type."
4. Legal L1 picks "Operating company". The type's required creation Rows appear, here "Filing tier". Status defaults to Active.
   - 4a. Legal L1 clicks Register without "Filing tier". The dialog says "Fill Filing tier."
   - 4b. Legal L1 picks "Large". The Branch opens and "Year end" appears. Legal L1 picks "Small" and "Year end" hides again.
   - Watch: any Field parse error reads "{field}: enter this as a number.", even for a non-number Field.
5. Legal L1 fills Formation jurisdiction "England and Wales", Formed on, Registration no., Tax ID, Registered agent and Registered address.
6. Legal L1 sees no Portal-listed switch. Only an Administrator sees it.
7. Legal L1 attaches one file in the attachments area and clicks Register. The dialog switches to the upload view, finishes, and closes. The new row appears in name order in the List.
8. Legal L1 opens Add entity again and clicks Cancel. Nothing is created.
9. Admin A creates "Acme UK Operations Ltd" with the same dialog. Admin A sees the Portal-listed switch with help "Business Users can pick this Entity by name on Portal forms." Admin A leaves it off.
10. Admin A creates "Acme Group plc" (type "Holding company"), "Acme US Inc" (jurisdiction "Delaware") and "Project Falcon BidCo" (the later Confidential Entity).
11. The creator of each Entity receives a Grant. The History applet shows the grant entry and "entity.created".
    - Watch: there is no Confidential switch in the create dialog. Confidentiality is set only on the record after creation.

### 7.4 Entity record Overview: header and Registry card

1. Legal L1 opens "Acme Holdings Ltd". The subbar shows the Entities breadcrumb, the building icon, the legal name, and the Active status pill. Six tabs show: Overview, Ownership, Obligations, Documents, Contracts (count) and Matters (count).
2. Legal L1 edits Legal name inline and commits with Enter. A saved note shows. Legal L1 clears Legal name and commits. The save is refused because Legal name is required. Legal L1 presses Escape and the saved value returns.
3. Legal L1 changes Entity type to "Holding company". The Fields card changes to that type's Rows.
   - 3a. The new type has a required Row with no value. The save is refused and the old type stays.
4. Legal L1 changes Status through Active, Dormant, Dissolved and Divested. The pill follows. History records "entity.status_changed" each time.
5. Legal L1 edits Formation jurisdiction, Formed on, Registration no., Tax ID, Registered agent and Registered address. Each commits on blur or Enter and reverts with Escape. Blank clears the value.
6. Legal L1 edits the Fields card. Each attached Field commits on its own. A hidden Branch Row appears only when its condition holds, or when it already holds a value. A number Field with letters shows "Enter this as a number." beside the control and never saves.
7. Legal L1 sets the entity Field "Parent guarantor" to "Acme Group plc" and the user Field "Relationship partner" to Legal L2.
8. Legal L1 navigates straight from this record to another Entity record by URL. The title, fields and tabs change to the new Entity.

### 7.5 Share capital and Currencies in use

1. Legal L1 finds the Share capital card on Overview. It shows Authorized shares, Issued shares, Par value and Currency on one row on a wide screen.
2. Legal L1 enters 1000000 in Authorized shares. It reads with thousands separators after commit.
3. Legal L1 enters "-5" in Issued shares. The card says "Enter a whole number of zero or more." Legal L1 corrects it to 1000.
4. Legal L1 types a Par value before choosing a Currency. Nothing saves until a Currency is chosen. The API refusal is "Choose a currency for the par value."
5. Legal L1 picks GBP and enters 0.01. It saves. Legal L1 enters 0.001. The card says "Enter a non-negative amount with up to 2 decimal places."
6. Legacy data fork. On an Entity whose par value predates the currency column, the card says "Stored minor units; the original currency is unknown." Picking a currency opens "Confirm par value currency" with the converted amount. Legal L1 clicks Cancel once, then "Confirm amount and currency".

### 7.6 Directors & Officers

1. Legal L1 finds the Directors & Officers card. It says "No current directors or officers."
2. Legal L1 clicks "Add director or officer". Add stays disabled until a name and a role exist.
3. Legal L1 types "Jane" in the name picker. It offers matching users under People and "Use "Jane Smith" without linking a user".
   - 3a. Legal L1 picks Legal L2 from People. The row shows "User linked".
   - 3b. Legal L1 types "Jane Smith" and uses the name without a link. This Officer has no OpenLaw account.
4. Legal L1 picks Role "Director", sets Appointed on, and clicks Add. The row appears at the top. Legal L1 adds a second Officer as "Company Secretary" and cancels a third.
5. Legal L1 edits an Officer's name, role and Appointed on inline.
6. Legal L1 sets Resigned on to a date before Appointed on. The save is refused with "The resignation date cannot be before the appointment date."
7. Legal L1 sets a valid Resigned on. The row leaves the list while Show former is off.
8. Legal L1 turns on Show former. The resigned Officer returns with its dates.
9. Legal L1 clicks the trash icon on an Officer. The row goes at once.
   - Watch: there is no removal confirmation for an Officer.
10. Negative. An Officer whose role is later archived keeps that role in its selector (see Script 7.18).

### 7.7 Registrations per jurisdiction

1. Legal L1 finds the Registrations card. It says "No additional registrations."
2. Legal L1 clicks Add registration and fills Jurisdiction "Delaware", Registration number, Registered agent and Status Active. Legal L1 clicks Add.
3. Legal L1 adds "New York" with Status Lapsed and "Ireland" with Status Withdrawn.
4. Legal L1 tries to add a registration with no Jurisdiction. It is refused.
5. Legal L1 edits the "New York" row's number, agent and status inline, and moves it from Lapsed back to Active.
6. After Script 7.13 adds an Obligation linked to "Delaware", the row shows "Linked obligations" with "{label} due {date}" as a link to the Obligations tab.
7. Legal L1 removes the "Ireland" registration with the trash icon. It goes at once.
   - Watch: there is no removal confirmation for a Registration.
8. Legal L1 removes a Registration that an Obligation points at. The Obligation stays on the calendar with no Registration.
   - Watch: a Lapsed Registration raises nothing. No warning, badge or reminder is tied to the Lapsed status. Check that this is intended.

### 7.8 Confidential and Grants

1. Legal L1 opens "Acme Holdings Ltd" (Legal L1 created it and holds a Grant). The Confidentiality card shows the Confidential toggle (the restrict-to-access-list wording) and a Manage access button.
2. Legal L1 clicks Manage access. The dialog "Confidential access" lists Legal L1. It says "Only people listed here can access this entity when it is confidential. Administrators also need a grant."
3. Legal L1 picks Legal L2 under Person and clicks Grant access. Legal L2 joins the list. The candidates list offers only live Legal Team Members and Administrators. Business Users are never offered.
4. Legal L1 removes Legal L2 and adds Legal L2 back.
5. Legal L1 turns on Confidential. The record shows the Confidential banner with a link to the access section, and the Confidential marker next to the name.
6. Negative. Legal L1 opens "Project Falcon BidCo" as its creator, removes their own Grant while no other Grant exists, and tries to turn on Confidential. The API refuses with "Grant at least one person access before making this entity confidential."
7. Negative. On a Confidential Entity with one live grantee, the grantee tries to remove the last Grant. The dialog shows "Grant another person access before removing the last person from a confidential entity."
8. Admin A turns on Confidential for "Project Falcon BidCo" and makes sure Admin A holds a Grant.
9. Admin B (no Grant) opens the Entities List. "Project Falcon BidCo" is absent. The count excludes it. Search, the calendar, the Entity pickers, and the Portal-listed read omit it.
10. Admin B opens `/entities/{falconId}` by URL. The page says "Entity not found" and "This Entity does not exist, or you cannot open it."
11. Admin B opens the Chart. A Holding edge to Falcon draws a "Confidential Entity" placeholder node.
    - Watch: the Chart says "Confidential Entity". The Ownership tab, pickers and Fields say "Restricted Entity" for the same case.
12. Admin B opens an open Entity that owns Falcon. The Holdings card shows "Restricted Entity" with no link and no controls.
13. Legal L2 (no Grant on Falcon) sees the same as Admin B. Legal L2 cannot grant themselves access.
14. Admin A opens an open Entity where Admin A has no Grant. The toggle is enabled and Manage access shows, because an Administrator manages open Entities.
    - Watch: Grants added on an open Entity have no visible effect until it becomes Confidential. The dialog does not say so.
15. Legal L2 opens an open Entity where Legal L2 has no Grant. The toggle is disabled and there is no Manage access button.
16. Admin A clears Confidential on Falcon. Legal L2 and Admin B now see it everywhere.
17. Legal L1 opens History on the Entity.
    - Watch: Grants added through Manage access write admin_only activity, so they never show in the record History. The creator's own Grant writes legal_only and does show. The two are inconsistent.
18. Admin A archives Falcon and opens Manage access. Grant changes are refused with "This entity is archived. Restore it before changing grants."

### 7.9 Portal-listed Entity and the Business User

1. Legal L1 opens "Acme UK Operations Ltd". The Portal card shows the Portal-listed switch disabled and "Only an Administrator can change Portal-listed."
2. Admin A turns Portal-listed on. History records "entity.portal_listed_set". The List view's Portal-listed column reads Yes.
3. Admin A opens "Project Falcon BidCo" while it is Confidential and not listed. The switch is disabled with "Confidential Entities stay out of Portal pickers."
4. Negative. A direct API write of portalListed true on a Confidential Entity is refused with "A Confidential Entity cannot be Portal-listed."
5. Admin A lists an open Entity, then turns on Confidential for it. The flag stays on, and the switch stays enabled so Admin A can clear it. The Entity leaves every Portal picker.
6. Admin A sets up the picker. Admin A creates an entity-typed Field "Signing Entity" in Contracts or Matters Fields. Admin A attaches it to a Contract type Form with On intake form and Required for creation on. Admin A creates a Request type whose destination is that Contract type.
7. Business User U1 opens the Portal and the Request form for that Request type. The "Signing Entity" picker is required. It lists "Acme UK Operations Ltd" by name only. It does not list "Acme Group plc", Falcon, or any archived Entity.
8. Business User U1 picks the Entity, fills Title and Description, and clicks Submit request. The page says "Thanks! Your request has been submitted to legal."
9. Race fork. Admin A archives the Entity, or clears Portal-listed, after U1 loads the form and before U1 submits. The submit is refused with "Signing Entity: choose a Portal-listed Entity from the list."
10. Legal L1 opens the Request in the Inbox and sees the picked Entity. After conversion, the Field value lands on the new record.
11. Auto-Doc fork. Admin A places an Entity picker on an Auto-Doc form. U1 sees the same Portal-listed names only.
12. Admin A restores the archived Entity. It returns to the picker because the flag was kept.
13. Negative. Business User U1 has no Entities nav item. Opening `/entities` or an Entity record URL returns U1 home. The API refuses the list, the type read and the write.

### 7.10 Ownership without a share register

1. Legal L1 opens "Acme UK Operations Ltd", Ownership tab. It shows "No share register yet", "Add a share class, then record the first allotment. Holders come from the entries.", New share class and a disabled Record entry. There is no timeline and no reconciliation line. The "Holdings in other Entities" card shows below.
2. Legal L1 clicks Add Holding. The dialog asks for Owner type Entity or Individual.
3. Entity owner. Legal L1 chooses Entity, Relationship "Owns this Entity", searches "Acme Group", picks it, enters 60, and clicks Add.
   - Watch: without a register, owner Holdings list under the title "Declared owners not in the register". That list appears only once a row exists. There is no plain Owners list.
4. Legal L1 adds a second owner "Acme US Inc" at 50. A warning says "Ownership totals 110% for Acme UK Operations Ltd." The Holding still saves.
5. Legal L1 edits the 50 to 40. The warning clears.
6. Individual owner. Legal L1 chooses Individual, enters Full name "Maria Lopez" and 10, and clicks Add. The row is marked Individual and has no link.
7. Owned side. Legal L1 opens "Acme Group plc", Ownership tab, clicks Add Holding, chooses "This Entity owns", picks "Acme Holdings Ltd", and enters 100.
8. Negative. Legal L1 tries to make "Acme Holdings Ltd" own "Acme Group plc". The API refuses with "This holding would create a loop: ...".
9. Negative. Legal L1 adds the same pair twice. The API says "These Entities already have this Holding." An Entity picking itself gets "An Entity cannot own itself."
10. Negative. Legal L1 submits Add Holding with no Entity ("Pick an Entity.") or no name ("Enter the individual's name.").
11. Legal L1 removes a Holding from the owned side, then from the owner side. Each goes at once and the list refreshes.
    - Watch: no confirmation on Holding removal.
12. The record breadcrumb on "Acme UK Operations Ltd" now shows "Acme Group plc" as the majority owner link. With an Individual as majority owner, the crumb is plain text. With a Restricted Entity as the largest owner, no owner crumb shows.

### 7.11 Share register and cap table

1. Legal L1 opens "Acme Holdings Ltd", Ownership tab, and clicks New share class. The "Share classes" dialog opens.
2. Legal L1 saves with no name and sees "Give the class a name." Legal L1 creates "Ordinary" with Authorized shares 1000, Votes per share 1, Par value 0.01, Currency GBP and a Rights summary. Legal L1 creates "Preference" with Votes per share 0.
   - 2a. A Par value with no Currency says "Pick the par value's currency."
   - 2b. Negative votes say "Votes per share must be zero or more."
   - 2c. A duplicate name is refused with "A share class named Ordinary already exists on this Entity."
3. Legal L1 edits "Preference" and saves. Each row reads "{authorized} authorized · {votes} votes per share · {entries} entries", or "no cap" when Authorized is empty.
4. Allotment. Legal L1 clicks Record entry. The dialog shows Entry kind, Effective date, To, Class, Shares, Price per share, Currency, Consideration, Distinctive numbers, Resolution reference, Note, and a Certificates section.
   - Legal L1 picks Allotment. From is hidden.
   - For To, Legal L1 picks "Entity from the registry…" and "Acme Group plc".
   - Class Ordinary, Shares 600, a Price and Currency, Consideration "Cash", Distinctive numbers "1-600", Resolution reference "BR-2024-01".
   - Under Certificates, Legal L1 clicks Issue certificate and enters No. "1", holder To, Shares 600, Nos. "1-600".
   - Legal L1 clicks "Enter in register".
5. The register now shows the "Register as of" card with a timeline tick, prev and next, a date button, and a disabled "Reset to today". The reconciliation line says the register does not agree with Share capital, naming 1,000 declared and 600 in the register.
6. Second allotment. Legal L1 allots 400 Ordinary to "New individual…" "Maria Lopez", with Certificate 2. The reconciliation line now says "Today the register agrees with Share capital: 1,000 issued."
7. Register of members. The card shows "2 holders · 2 classes · derived from 2 register entries", Export register and Share classes buttons. There is no Add holder control. Each row shows Holder (with "Entity · jurisdiction" or "Individual"), Class, Shares, % of class, % voting, live Certificates, and Member since. Each class closes with "Total Ordinary" and "{outstanding} outstanding · {treasury} in treasury · par £0.01 · {rights}".
8. Transfer. Legal L1 records a Transfer of 100 Ordinary from "Acme Group plc" to "Maria Lopez". Under Cancel, Legal L1 ticks Certificate 1. Legal L1 issues Certificate 3 (500 to From) and Certificate 4 (100 to To).
9. Buyback. Legal L1 records a Buyback of 50 from "Maria Lopez", cancels her Certificate 4 and issues Certificate 5 for the balance to From. A Treasury row appears under Ordinary with "Held by the company" and no vote percent.
10. Cancellation from treasury. Legal L1 records a Cancellation, leaves From as "Treasury (shares the company holds)", and cancels 20. Issued and treasury both fall by 20.
11. Cancellation from a holder. Legal L1 records a Cancellation from "Maria Lopez" of 10 and cancels and reissues her certificate.
12. Conversion. Legal L1 records a Conversion from "Acme Group plc": From class Ordinary, To class Preference, Shares 100. Legal L1 cancels Certificate 3 and issues one certificate in the To class and one for the Ordinary balance.
13. Holders derived. The Holder filter and member rows list only holders that some entry names. A holder no entry or certificate names is pruned.
14. Entries table. The "Register of allotments and transfers" card lists #, Date, Entry pill (Allotment, Transfer, Buyback, Conversion, Cancellation), From, To, Class (with "→ Preference" on a conversion), Shares, Distinctive nos., Consideration, Cert. issued, Cert. cancelled, and Resolution.
    - Watch: Resolution renders as plain text. DES-088 says it is a link.
15. Filters. Legal L1 filters entries by Class, Entry kind, Holder and Effective date. The filters live in the URL. "No entries match these filters." shows when nothing matches.
16. Register read to a date. Legal L1 clicks the previous-entry button. The URL gains `?asOf=`. The members card reads "Register of members at {date}". The Change to today column shows plus, minus or a dash. Later entries dim, and "Entries after {date} are dimmed" shows. The reconciliation line adds "At {date} the register showed {issued} issued, from N entries of M."
17. Legal L1 opens the date button, picks any day in the DES-048 picker, clicks a timeline tick, then clicks Reset to today. The `asOf` param clears.
18. Edit an entry. Legal L1 opens Edit entry on the transfer, changes the quantity, and saves. The register replays and Holdings re-project.
19. Remove an entry. Legal L1 clicks Remove on the latest entry. The dialog says "Remove entry {number} from the register?" and "The register is replayed without it and its number is not reused. This cannot be undone." Legal L1 cancels once, then confirms. The next new entry takes a new number.
20. Exports. Legal L1 clicks Export register while scrubbed to a past date, then Export on the entries card. Two CSV files download: members at that date and all entries.
21. Holdings projected From register. Legal L1 opens "Acme Group plc", Ownership tab. The "Holdings in other Entities" card shows "Acme Holdings Ltd" with the percent of outstanding shares across all classes, treasury excluded. The row has a "From register" pill, its controls are disabled, and it links to the register. Hovering says "Derived from the share register. Record an entry there to change it."
    - 21a. Entity with a register. Owner Holdings are read-only From register. A manual owner row the register now names is taken over. A manual owner the register does not name lists under "Declared owners not in the register".
    - 21b. Entity without a register. Owner Holdings are typed by hand as in Script 9.
    - Watch: Add Holding still offers "Owns this Entity" on an Entity that has a register. That adds a manual owner beside the register.
22. Chart. The projected Holdings draw in the Chart like any Holding. Maria Lopez draws as an individual terminal owner.
23. Authorized overrun. Legal L1 allots past 1,000 authorized Ordinary. The entry commits and a warning says "{issued} Ordinary shares are issued against 1,000 authorized."
24. Share class archive. The archive control on a class with entries is disabled with "This class has register entries." Legal L1 archives an unused class. It leaves the dialog.
    - Watch: archived classes do not list in the dialog, and there is no restore.
25. History. The register writes six `entity_share_*` actions. They appear on this Entity and on each Entity holder the entry names.

### 7.12 Share register refusals

1. Legal L1 tries Record entry with no class. Record entry is disabled until a live class exists.
2. Shares 0 or "1.5" says "Enter a whole number of shares, one or more."
3. No class picked says "Pick a share class."
4. A transfer with no From says "Pick the holder the shares come from." No To says "Pick the holder the shares go to."
5. A transfer to the same holder is refused with "A transfer needs two different holders."
6. Transfer more shares than the Holder has. The API refuses with "Entry N would take a holder's balance below zero." The refusal prints inside the dialog.
7. Back-dated oversell. Legal L1 records a transfer dated before the allotment that funds it. The replay refuses it the same way.
8. A price with no currency says "Pick the price's currency."
9. Cancel a Certificate twice. Legal L1 records a second entry that cancels Certificate 1 again. The API refuses with "Certificate 1 was already cancelled by another entry."
10. Cancel a certificate that belongs to another holder or class. The API refuses with "Entry N cancels certificate X, which belongs to another holder or class."
11. The Cancel list is empty when From has no live certificate in the class, and says "The holder the shares come from has no live certificate in this class."
12. Issue a certificate number that exists. The API refuses with "Certificate X already exists on this register." Listing a number twice says "Certificate X is listed twice."
13. Issued certificates that exceed the holding. The API refuses with "After entry N, a holder's live certificates would cover more shares than they hold."
14. An issued certificate with no number or share count says "Each issued certificate needs a number and a share count."
15. A conversion to the same class is refused with "A conversion needs two different classes."
16. The issuer as its own holder is refused with "An Entity cannot hold its own shares."
17. Ownership loop. Legal L1 allots shares of "Acme Group plc" to "Acme Holdings Ltd", which Group already owns. The API refuses with "This entry would create an ownership loop: ...".
18. Edit an early entry whose certificate a later entry cancelled. The API refuses with "Certificate X, issued by this entry, was cancelled by a later entry. Change that entry first." Remove behaves the same.
19. Restricted holder. Legal L2 without a Grant on Falcon edits an entry that names Falcon as holder and changes that side. The API refuses with "This entry names an Entity you cannot see. That holder stays until someone who can see the Entity changes it." Falcon shows as "Restricted Entity" in members and entries.
20. Archived class. An entry that names an archived class is refused with "This share class is archived."

### 7.13 Obligations and the compliance calendar

1. Legal L1 opens "Acme Holdings Ltd", Obligations tab. It says "No obligations for this Entity." and "Add the first due date when it is known."
2. Legal L1 clicks Add obligation. The dialog has Due date, Label, Repeat every (months), Registration, Assignee, Matter and Note.
3. Recurring. Legal L1 adds "Confirmation statement", due in 5 days, repeat 12, Assignee Legal L2, and saves.
4. One-off. Legal L1 adds "Change of registered office filing", no repeat, Registration "Delaware", Assignee none, Matter picked from the reachable Matters list.
5. Negative. The API refuses a Registration from another Entity, an assignee who is not a live Legal Team Member or Administrator, and a Matter that is not live and reachable.
6. Overdue. Legal L1 adds "Annual accounts" with a due date last week.
7. Legal L1 opens a row's actions menu and uses Edit to change label, date, repeat, assignee and Registration. Legal L1 clears the Matter and the Registration. The dialog button reads "Save changes".
8. Mark complete, recurring. Legal L1 clicks Mark complete on "Confirmation statement". The dialog says "Completing this occurrence moves the due date forward by 12 months until it is after the completion date. The recurring obligation stays open." Completed on defaults to today. Legal L1 cancels once and then confirms. The due date moves forward one year.
9. Catch-up. On a monthly Obligation six months overdue, Legal L1 marks it complete today. The due date jumps forward until it is after today. One "entity_obligation.filed" entry is written, not six.
10. Mark complete, one-off. The dialog says "This marks the one-off obligation as complete." After confirm, the row shows "Completed {date}" and has no actions.
    - Watch: the button says "Mark complete" and the dialog says "Completed on". The calendar pill says "Filed" and ENT-006 says "Mark filed". Pick one word.
    - Watch: a completed one-off cannot be reopened, edited or deleted from the UI.
    - Negative. A second complete on the same one-off is refused with "This one-off obligation is already filed."
11. Delete. Legal L1 opens actions and clicks Delete. The row goes at once.
    - Watch: there is no delete confirmation.
12. Legal L1 opens Entities. The Calendar lists open Obligations across all reachable Entities. Overdue rows come first in the severe colour, then by due date. Columns are Due date, Obligation, Entity, Assignee (or "Unassigned") and Repeat ("Every 12 months" or "One-off").
13. Legal L1 clicks an Obligation label and lands on that Entity's Obligations tab. Legal L1 clicks an Entity name and lands on the Overview.
14. Legal L1 filters by Entity, Assignee, Due date range and Show completed. The URL carries the filters. Completed one-offs show with a "Filed" pill.
15. Legal L1 clears the filters with Clear all. With no match, the page says "No obligations match" and "Change or clear the filters to see other due dates."
16. Legal L1 switches to Month. The filters stay. Legal L1 uses Previous month, Next month and Today. Obligations sit on their due day. Overdue ones use the severe colour. Legal L1 clicks one and lands on its Obligations tab.
17. Legal L1 types in the name search. The calendar narrows to Entities whose names match. The search stays when switching to List or Chart.
18. Empty-state link. On an install with Entities and no Obligations, the calendar shows an Add obligation link to the first live Entity's Obligations tab.
19. Reminders. The morning round runs on each reminder lead time before a due date.
    - Legal L2 (the assignee) gets a bell notification "date.obligation_approaching" and the item in the daily briefing email.
    - An unassigned Obligation goes to every Administrator who can reach the Entity.
    - An assignee who cannot reach the Entity (for example after the Entity turned Confidential) is replaced by the Administrator fallback.
    - Watch: an unassigned Obligation on a Confidential Entity reaches only Administrators with a Grant. Legal Team Member grantees get nothing. With no Administrator grantee, nobody is told.
    - Obligations on archived Entities and completed one-offs raise nothing.
20. Home. Legal L2 opens Home. The "Entity obligations" card lists their open Obligations as "{entity} · Due {date}", with Overdue marked. Admin A also sees unassigned rows and rows whose assignee cannot reach the Entity. Each links to the Obligations tab.
21. The List view's Next obligation column shows the soonest open Obligation per Entity.

### 7.14 Documents tab

1. Legal L1 opens the Documents tab. It says "No documents on this Entity yet." The file attached at creation shows if Script 7.3 step 7 ran.
2. Legal L1 uploads a document, picks Entity document type "Certificate of incorporation", adds a note, and submits. Legal L1 cancels a second composer.
3. Legal L1 adds a version to it with Add version.
4. Legal L1 uses Choose files and Choose folder, and drags a folder onto the card. A batch import review opens.
5. Legal L1 creates a New folder, a New subfolder, renames, moves a document into it with Move to folder, and drags one back to the root ("Drop here to move out of folders").
6. Legal L1 deletes a folder. The dialog says "Anything in it moves onto the Entity itself. Nothing is deleted."
7. Legal L1 opens a version in the reader panel, uses Compare with previous, and closes the panel.
8. Legal L1 uses Edit details, archives a document, shows archived documents, restores it, and deletes one with typed-name confirmation. Legal L1 deletes one version.
9. Admin A archives an Entity document type. Existing versions keep the label. The upload picker no longer offers it.
10. Legal L2 without a Grant opens a document link from a Confidential Entity. It is refused.
    - Watch: check whether Mark confidential is offered on Entity documents, and to whom. An Entity has no team to be the named audience.
    - Watch: the Documents card on an archived Entity gets no frozen flag from the record page. Check that uploads are blocked.

### 7.15 Contracts and Matters tabs

1. Legal L1 creates a Contract and sets Our entity to "Acme Holdings Ltd". The Contracts tab count rises by one and the row opens the Contract.
2. Legal L1 changes that Contract's Our entity to another Entity. The count falls.
3. Legal L1 attaches the entity Field "Parent guarantor" to a Matter type, creates a Matter, and sets the Field to "Acme Holdings Ltd". The Matters tab lists it.
4. Admin A detaches that Field from the Matter type. The Matter still lists until the value is cleared.
5. A Confidential Contract or Matter that Legal L2 cannot reach is omitted from Legal L2's tab and count, with no placeholder.
6. Legal L1 uses the Columns menu and Show more on each tab. With no rows, the tab says "No linked records." A failed read says "The linked records could not be read." with Try again.
7. An archived Contract or Matter still lists. Check its styling.

### 7.16 History

1. Legal L1 opens the History applet on the Entity record. Entries include entity.created, entity.updated, entity.status_changed, confidentiality changes, entity.portal_listed_set, entity_officer._, entity_registration._, entity_holding._, entity_obligation._ (with the filed cycle date and the new due date), entity_share_* and entity.type_reassigned.
2. Legal L1 loads older entries, closes the applet and reopens it.
3. Legal L2 without a Grant cannot read the History of a Confidential Entity.
   - Watch: the Entity record has no comments applet. Only History is mounted.

### 7.17 Archive and restore an Entity

1. Legal L1 clicks Archive on "Acme US Inc". It archives at once. The Archived pill shows and the note says "This entity is archived. Restore it to edit."
   - Watch: there is no archive confirmation, and any Legal Team Member can archive.
2. Every Overview control, the Officers and Registrations edits, Add Holding, Share classes, Record entry, entry Edit and Remove, and Add obligation are disabled or hidden. The Portal help says "Archived Entities stay out of Portal pickers."
3. API writes are refused with "This entity is archived. Restore it before editing." Holdings say "...before changing Holdings." The register says "...before changing its register."
4. The Entity leaves the Calendar, the Entity pickers, the Portal picker and reminders. Holding and add-picker candidates exclude it ("Pick a live Entity from the registry.").
5. Legal L1 opens the List, turns on Show archived, and sees the row dimmed with an Archived marker and a Restore button in the Actions column. Legal L1 clicks Restore.
6. Legal L1 archives again and uses Restore on the record header. A second Restore through the API says "This entity is not archived."

### 7.18 Settings lifecycle with records in use

1. Admin A archives an unused Entity type. It goes at once.
2. Admin A archives "Holding company", which Entities use, including an archived Entity. The dialog asks "Reassign N entities to" a live type. The count includes archived Entities. Admin A cancels once, then picks "Operating company" and clicks Archive type. Each moved Entity gets "entity.type_reassigned" in History. The audit log gets one "entity_type.archived" with the count and target.
3. The archived type leaves the Add entity picker. An Entity that still shows an archived type keeps it as a fallback option on its Overview.
4. Admin A restores the archived type.
5. Admin A archives an in-use Director & Officer role with a replacement. Affected Officers show the replacement role. An Officer whose role was archived without reassignment keeps the old role label.
6. Admin A archives an Entity Field. The dialog explains that stored values are kept. The Field leaves the Form and the Fields card.
7. Negative. A direct create with an archived type is refused with "The entity type must be a live entity type." An Officer with an archived role is refused with "The officer role must be a live role."

### 7.19 Destination List and Chart in depth

1. Legal L1 opens List. Columns are Legal name, Type, Jurisdiction, Registration no., Status, Portal-listed, Next obligation and Created. The subtitle reads "N entities shown".
2. Legal L1 filters by Type, Status, Jurisdiction, Majority owner and Show archived. Legal L1 removes one chip and uses Clear all. "No Entities match these filters" shows with Clear filters.
3. Legal L1 sorts by a column and uses Show more when more rows exist. Focus lands on the first new row.
4. Legal L1 uses the Views menu to save a view, Save as, rename, set it as default, reset, and delete. Legal L1 hides and reorders columns with the Columns menu. Reloading `/entities?view=list` opens the default view.
5. Legal L1 searches by name and clears the search with the X button or Escape.
6. Legal L1 opens Chart. The hint says "Drag to move · Scroll to zoom · Single click to highlight entity · Double click to open entity."
7. Legal L1 drags to pan, scrolls to zoom, uses Zoom in, Zoom out, "Reset zoom to 100%", Fit to window and the overview map.
8. Legal L1 single-clicks a node. Its owners and owned Entities highlight and others dim. Legal L1 clicks Clear highlight. Legal L1 double-clicks a node and lands on the record.
9. Keyboard. Arrow keys pan, Shift+arrow pans further, plus and minus zoom, 0 fits, Space highlights, Enter opens, and Escape clears.
10. Legal L1 searches "Acme UK". The chart keeps the matching Entity with its ownership chain. A search with no match says "No entities match your search."
11. Legal L1 clicks Export chart. Legal L1 picks Structure to export ("Current chart (all search results)" or one Entity with its owners and owned Entities through all levels), ticks Entity information fields (Entity type, Jurisdiction, Status, Formation date, Registration number, Tax ID, Registered agent, Registered address, Authorized shares, Issued shares, Par value, Directors & Officers, and custom Fields), toggles Ownership percentages, sets a Chart title, and picks PDF or PowerPoint. Legal L1 uses Fit preview and "Preview at actual size", then Download chart.
12. A Confidential Entity the exporter cannot reach keeps its placeholder in the file.

### 7.20 Cross-surface checks

1. Legal L1 finds an Entity through global search and through Advanced Search. Majority owner and Next obligation date filter the same rows the List does.
2. A user connected through MCP lists Entities and reads one Entity. A Confidential Entity without a Grant is absent.
3. Legal L1 picks a Signing Entity on a Contract. A Confidential Entity Legal L1 cannot reach shows as "Restricted Entity" when it is already set.

## 8. Auto-Docs

An Auto-Doc is one approved Word template, the form that fills it, and the settings that govern its use. Legal builds it in the app at `/auto-docs`. Business Users fill it in the Portal at `/portal/auto-docs`. Each fill is a Generation. A Generation can create a Contract, and its output can be Filed to a Matter or Contract.

These scripts follow the code on `dev` as of 2026-09-26. Terms follow `CONTEXT.md`. Actors are:

- Administrator. Owns Settings and the only erasure act.
- Legal Team Member. A Member or an Administrator. The code calls this Member+.
- Legal Team Member 2. A second Member+, used for Assignment rules and the Unassigned contracts tab.
- Business User A. In the Sales Department.
- Business User B. In no audience, used for negative paths.

`docs/UX-REVIEW-CHECKLIST.md` has no Auto-Doc coverage. These scripts are the only walk for this module.

Out of scope here: MCP tools over Auto-Docs, Contract signature after creation (ADO-011), and the Contract record beyond what a Generation writes onto it. No Auto-Doc-backed Request types exist in code.

### 8.1 Prerequisites

1. Administrator opens Settings, Departments. Administrator makes sure Sales and Procurement exist.
2. Administrator opens Settings, Users. Administrator creates Legal Team Member, Legal Team Member 2, Business User A, and Business User B. Administrator sets Business User A's Department to Sales and leaves Business User B with none.
3. Administrator makes sure one Contract Type is live, for example "NDA".
4. Administrator makes sure one catalog Field has a scope that admits `contract` and is attached to that Contract Type.
5. Administrator makes sure one Entity is live, Portal-listed, and not Confidential. Administrator makes a second Entity that is not Portal-listed, for the fixed-Entity warning later.
6. Legal Team Member creates one Matter and one Contract. Legal Team Member adds Business User A to the team of each. These are the Filing destinations for the Portal.
7. Administrator confirms SMTP is configured. Locally this is Mailpit. Keep a second run with SMTP unconfigured for the email edge path.
8. Administrator opens Settings, Auto-Docs, at `/settings/auto-docs`. Administrator sees the help list: the frequency applies to all Auto-Docs, each Auto-Doc can use its own text, and changing the text asks for a new acknowledgement.
   Watch: this page is in the Organization settings group. Only an Administrator sees it. A Member who types the address lands on Settings, Profile.
9. Administrator opens "Acknowledgement frequency". The choices are "No acknowledgement required", "Before every generation", "Once per person for each Auto-Doc", and "Once per person across all Auto-Docs". The seeded default is once per person for each Auto-Doc.
10. Administrator edits "Default acknowledgement text", for example "Do not edit the generated document. Ask Legal for changes."
11. Administrator clicks "Save settings". Administrator sees "Settings saved."
    11a. Administrator clears the text. The "Save settings" button is disabled.
    11b. The save fails. Administrator sees "Could not save these settings. Try again." or the server's reason.
12. Business User A signs in to the Portal for the first time. The Portal sends them to `/portal/onboarding`. Business User A picks Sales in "Department" and clicks "Continue". The copy says Legal uses this to share the right Auto-Docs.
13. Business User A skips "Name and photo", "Theme", and "Notifications", then clicks "Finish". They land on `/portal`. The Portal nav shows "Auto-Docs".
14. Business User A signs out and in again. The first run does not repeat.

### 8.2 Legal creates an Auto-Doc and builds the form

#### The Auto-Docs list

1. Legal Team Member clicks "Auto-Docs" in the app nav. Business Users never see this entry. A Business User who types `/auto-docs` is sent to `/portal`.
2. Legal Team Member sees the heading, "Download starter template (.docx)", a search box, filters, a column menu, and "Create Auto-Doc".
3. With no Auto-Docs, the page says "Create an Auto-Doc to start with a Word template."
4. Legal Team Member clicks "Download starter template (.docx)". The browser saves `OpenLaw-Auto-Doc-Starter.docx`. Legal Team Member opens it in Word to see the marker syntax.
5. Legal Team Member clicks "Create Auto-Doc". A dialog asks for "Name", required, up to 200 characters, and "Description", optional.
   5a. The create fails. The dialog shows "Could not create the Auto-Doc. Please try again." or the server's reason.
6. Legal Team Member types "Mutual NDA" and a description, then clicks "Create". The app opens `/auto-docs/<id>`, the Overview tab. The state pill reads "Draft".
7. The History applet on the right lists "created" for this Auto-Doc.

#### Record chrome

8. The sub-bar reads "Auto-Docs > Mutual NDA", then the Draft pill. On the right are "Publish", disabled until a file and a form exist, and the "Auto-Doc actions" menu.
9. Tabs are Overview, Form, Settings, and Generations. Form shows an orphaned-field count. Generations shows a Generation count.
10. Legal Team Member opens `/auto-docs/<id>/nonsense`. The app redirects to the bare record address.
11. Legal Team Member opens `/auto-docs/<unknown id>`. The page says "Auto-Doc not found" and "This Auto-Doc does not exist, or you cannot open it." with a way back to Auto-Docs.
12. Legal Team Member clicks the name in the sub-bar. It becomes a text box. Legal Team Member renames it and presses Enter. The name saves. Escape reverts. An empty name is refused.
13. Legal Team Member opens the actions menu and picks "Copy link". The sub-bar says "Link copied" for two seconds.
14. On Overview, the About card holds "Description". Legal Team Member edits it and tabs away. It saves on blur. Escape reverts.
15. The Publication card says "Not published." and has no Publish button yet.

#### Upload the Word file

16. Legal Team Member opens the Form tab. The template pane says "Upload a Word file to start the form." It links to "How to write an Auto-Doc template", which opens `/help/auto-doc-template`.
17. Legal Team Member clicks "Upload version". The dialog title is "Upload version", with a drop zone for "One .docx file" and "Choose file".
    Watch: the dialog is titled "Upload version" on the very first upload too.
18. Legal Team Member drops two files, or one `.pdf`. The dialog says "Choose a single Word document (.docx)."
19. Legal Team Member chooses a `.docx` that holds `{{counterparty_name}}`, `{{signing_date|date:MMMM D, YYYY}}`, `{{amount|currency:USD}}`, and `{{#block arbitration}} ... {{/block}}`. The file name and size appear with "Remove file" and "Change file".
20. Legal Team Member clicks "Upload". The button reads "Uploading...".
21. The dialog shows "File version 1 uploaded", "Placeholders detected" and "Blocks detected" counts, and "3 form fields created."
22. Legal Team Member clicks "Done" or the close X.
23. The template pane header shows the file name, "File version 1", and "3 Placeholders, 1 Block". It has "Open" and "Upload version".
24. The pane draws the file as paragraphs. Each Placeholder is a chip. A Placeholder with a form field is blue. A Placeholder with no form field is red. Each Block opening reads "arbitration · always", and its end reads "end arbitration" with a green left rule. Header, footer, footnote, and endnote text show under their own labels.
25. The Fields card lists one row per Placeholder, in document order. Each row shows its type. The directives set the type: the date directive makes a Date field and the currency directive makes a Currency field. The rest are Text.
26. The Clauses card lists one row per Block, "Always included". It says "A Block with no rule is always included."

Upload refusals. Each one is a red alert inside the dialog and quotes the offending text. No Version is written.

27. Legal Team Member uploads a file with an unclosed `{{name`. The dialog says "Unclosed Placeholder brace" and quotes it.
    27a. A stray `}}`. The dialog says "A marker closes without an opening brace".
    27b. `{{#block arbitration}}` with no `{{/block}}`. The dialog says "Unclosed Block".
    27c. `{{/block}}` with no opening tag. The dialog says "A Block closes without an opening tag".
    27d. `{{Counterparty Name}}`. The dialog says "Use a valid slug for the Placeholder or Block name".
    27e. `{{amount|currency:XYZ}}` or `{{x|bogus}}`. The dialog names the supported directives or "Use a supported currency code".
    27f. A macro file, a DDE or INCLUDETEXT field, or an external template link. The dialog names the part and the reason, for example "The Word file carries a macro project".
    27g. A file over the upload limit. The dialog says the template exceeds the upload limit.
28. Legal Team Member uploads a valid `.docx` with no Placeholders and no Blocks. The upload succeeds with 0 and 0 and "No new form fields." The Clauses card says "This file has no Blocks."
    Watch: nothing warns that a file with no Placeholders makes a form that fills nothing. Publish still succeeds with an empty form.

#### Edit form fields

Every commit on this tab writes a new form version. There is no Save button.

29. Legal Team Member clicks a Placeholder chip in the template pane. The matching field row is selected and its editor opens. Clicking a chip from another tab switches to the Form tab.
30. Legal Team Member clicks the pencil "Edit Counterparty name" on a row. The field card opens under the row. The pencil becomes a chevron that closes it.
31. Legal Team Member changes "Label" and presses Enter. The row and the card rename. An empty label is refused.
32. Legal Team Member edits "Template placeholder", the slug. The caption says "Must match the Placeholder in the file."
    32a. Legal Team Member types `Bad Slug` or a slug another field holds. The card says "Use lowercase letters, digits, and underscores, unique on this form." and reverts.
    32b. Legal Team Member renames the slug of a field that a Placeholder uses. The chip in the pane turns red, and the field becomes orphaned. Clause rules that named the old slug follow the rename.
33. Legal Team Member opens "Type" and walks the nine types: Text, Long text, Number, Currency, Date, Yes or no, Single select, Multi select, Entity.
    Watch: ADO-003 also lists a `user` type. The editor does not offer it.
34. Legal Team Member picks Single select. An "Options" box appears with "Option 1". Legal Team Member types "United States" and "United Kingdom", one per line, and tabs away.
    34a. Blank or duplicate options. The card says "Give the field distinct, non-empty options."
35. Legal Team Member fills "Help text". It saves on blur.
36. Legal Team Member opens "Map to". The choices are "No map", Contract attributes, and Catalog Fields. The attributes are Title, Primary Counterparty name, Our Entity, Owning department, Region, Value, Effective date, Expiry date, and Term type.
37. Legal Team Member maps Counterparty name to "Primary Counterparty name". The row caption reads "Text · Primary Counterparty name".
38. Legal Team Member maps Amount to "Value". "Currency" and "Cadence" pickers appear. Legal Team Member picks USD and Annually.
39. Legal Team Member maps one field to the catalog Field from Script 0.
    39a. That catalog Field is later archived. The map reads "Unavailable catalog Field".
40. Legal Team Member ticks "Required".
41. The card footer shows usage, for example "Used by 1 Clause rule" or "Used by no rule", and a "Remove" button.
42. Legal Team Member clicks "Add field" under the Fields card. A row "New field" with slug `field_1` appears and opens. Legal Team Member makes it a non-document field, for example "Purpose", Long text.
43. Legal Team Member drags a row by its grip to reorder. The order saves as a form version.
44. Legal Team Member removes the non-document field "Purpose" with the row's remove button. It goes at once.
45. Legal Team Member removes a field whose Placeholder is still in the file. A dialog asks "Remove Counterparty name?" and says "Publish will refuse until the file changes or the field is back." Legal Team Member cancels. Then Legal Team Member removes it for real. The chip turns red.
46. Legal Team Member clicks "Add field" and restores the field with the same slug.
47. The "Compare versions" button appears on the Fields card once two form versions exist.

#### Clause rules

48. Legal Team Member clicks the "arbitration" Block tag in the pane, or "Edit the rule for arbitration" in the Clauses card. The rule editor opens.
49. "Include" has "Always" and "When a rule matches". "When a rule matches" is disabled if the form has no fields or the Block is not in the current file.
50. Legal Team Member picks "When a rule matches". "Form field", "Operator", and "Value" appear.
51. Legal Team Member picks Jurisdiction, operator "Equals", value United States. The row caption reads "Included when Jurisdiction equals United States". The pane tag reads "arbitration · when ...".
52. Legal Team Member walks each operator.
    52a. "Is one of". Value becomes a multi-select for select fields, or a list editor for Date, Number, and Currency fields.
    52b. "Is set". The value control disappears.
    52c. "Is not". One value.
    52d. On a text field the value is typed and commits when focus leaves the rule. An invalid value blocks the commit with the browser's message.
53. Legal Team Member sets Include back to "Always". The rule is removed.
54. Legal Team Member uploads a file version without the arbitration Block while a rule still names it. The Clauses card shows "1 missing". The row reads "Not in file version 2". The rule editor says "The current file has no Block with this name. Remove the rule or publish an earlier file version."
55. Legal Team Member saves a rule for a Block the file lacks through a direct form save. The server refuses with the Block's name.

#### Re-upload and orphans

56. Legal Team Member uploads a second file version that drops `{{amount}}` and adds `{{seat}}`.
57. The dialog reports "1 form field created." and "1 field no longer has a placeholder in this file. Your existing fields have been kept for review."
58. The Form tab count shows "1 orphaned". The Fields card shows a red "1 orphaned" pill. The Amount row reads "No Placeholder in file version 2". The Amount field keeps its type and map.
59. The pane header now reads "File version 2". The footer shows "Earlier versions (1)".
60. Legal Team Member expands "Earlier versions (1)". Each row shows its number, file name, age, "Open", and "Download".
    Watch: the current file version has "Open" but no "Download" link in the pane.
61. Legal Team Member clicks "Open" on a version. The Document panel opens beside the record with that version. Closing it returns to the builder. The panel can dock or cover the page.
62. Legal Team Member clicks "Compare files". The shared Comparison view opens, previous version against newest. "Close comparison" returns.
    Watch: "Compare files" only compares the two newest versions. Other pairs need the Document panel.
63. Legal Team Member clicks "Compare versions". The dialog has "From" and "To", preset to the two newest form versions. It lists changes such as "Added jurisdiction", "Retyped", "Relabelled", "Reordered", "Map changed", "Clause rule changed", with before and after values. Two equal versions say "These form versions have no structural changes." Legal Team Member clicks "Close".
64. The History applet lists "template uploaded" and "form saved" entries.
65. Legal Team Member searches the app for a word from the template. The template Document appears as an Auto-Doc result. Opening it lands on the Auto-Doc record with the Document panel open at that version and the word found.

### 8.3 Legal configures Auto-Doc settings

1. Legal Team Member opens the Settings tab. Four cards appear: Reach, Acknowledgement, Output, and Contract creation. Each control commits on its own and shows "Saving" and "Saved".

#### Reach

2. "Audience" has "Legal only", "Selected", and "Everyone". The default is Legal only.
3. Legal Team Member picks "Selected". Two multi-selects appear, "People" and "Departments", with the caption that a named person or anyone in a named Department sees the Auto-Doc in the Portal.
4. Legal Team Member selects Sales in Departments. It saves.
5. Legal Team Member selects Business User B in People, then deselects them.
6. A selected person who is later archived shows as "Unavailable person". An archived Department shows as "Archived Department".
7. Portal warnings for Legal show on this card as warning text. See step 24.

#### Acknowledgement

8. The card says "Acknowledgement frequency can be adjusted in Organization Auto-Doc Settings", with a link.
   Watch: the link goes to `/settings/auto-docs`, which only an Administrator can open. A Member is sent to Settings, Profile.
9. "Text" has two radios: "Organization's text", which shows the org default below it, and "Custom text".
10. Legal Team Member picks "Custom text". A text box opens, prefilled with the org text, and the choice saves at once. The caption says "Changing the text asks everyone to acknowledge it again."
11. Legal Team Member edits the custom text and tabs away. It saves. An empty custom text is refused.
12. Legal Team Member switches back to "Organization's text". The custom text is cleared.
    Watch: ADO-008 and `CONTEXT.md` still say an Auto-Doc may require no acknowledgement and has its own frequency. The UX revision moved frequency to the organisation. There is no per-Auto-Doc "none". The glossary entry needs the same update.

#### Output

13. "Formats" has "Word", "PDF", and "Word and PDF". The default is Word and PDF.
14. "Cover note" is Markdown. Legal Team Member types a note with a list and a link and tabs away. A rendered preview appears under the box. The caption says it goes in the email with the files.

#### Contract creation

15. "Target Contract Type" has "No target Contract Type" and each live Type. With no target, the caption says "Without a target, a Generation's file stays on the Generation until it is Filed."
16. Legal Team Member picks NDA. Four more controls appear: "Title pattern", "Our Entity", "Default Legal Owner", and the "Assignment rules" table.
    Watch: these four hide again if the target is cleared. Check that their saved values survive a clear and re-pick.
17. Legal Team Member types "NDA - " in "Title pattern", then clicks "Insert title variable", the lightning button. A menu lists the form fields by label. Legal Team Member picks Counterparty name. `{{counterparty_name}}` lands at the cursor. It saves on blur.
    17a. With no form fields, the menu says "Add form fields to make variables available."
    17b. A pattern that names a missing slug, or has a broken brace, is refused at Publish.
18. "Our Entity" has "From the form" and each live Entity. Legal Team Member picks the non-Portal-listed Entity from Script 0.
19. "Default Legal Owner" has "None, leave unassigned" and each live Member+. It saves on pick.
20. The Assignment rules table says "The first matching rule names the Legal Owner. Without a match or a default, the Contract remains unassigned."
21. Legal Team Member clicks "Add rule". The dialog has "Form field", "Operator", "Value", and "Legal Owner". Legal Team Member builds "Jurisdiction equals United States" to Legal Team Member 2 and clicks "Save". The row reads the rule as a sentence with the Legal Owner as its caption.
    21a. "Add rule" is missing when the form has no fields, when no live Member+ exists, or when the Auto-Doc already has 100 rules.
22. Legal Team Member adds a second rule, then drags it above the first. The order saves.
23. Legal Team Member clicks the pencil on a rule, "Edit rule 1", changes the value, and saves. Legal Team Member removes one rule with "Remove rule 2".
    23a. A rule's Legal Owner is later archived. The row reads "Unavailable Legal Owner".
    23b. A rule names a field that the latest form removed. The dialog shows "Missing field".
24. Legal Team Member sets Audience to Everyone. The Contract creation card now shows the fixed-Entity warning: the fixed Entity must be live, Portal-listed and non-Confidential. Legal Team Member switches "Our Entity" to "From the form". The warning goes.
    24a. A saved Assignment rule names a field that the Live Form lacks. The Reach card warns "Publish a Form that matches the saved Assignment rules before generating this Auto-Doc."
    24b. The target Contract Type is archived. The picker shows "Archived Contract Type", and the Reach card warns "Choose a live target Contract Type before generating this Auto-Doc."
25. The History applet lists each settings edit with before and after values.

### 8.4 Publish, Unpublish, Archive, Restore, and erasure

1. Legal Team Member returns to Overview. The Publication card says "Not published." and now has "Publish".
2. Legal Team Member clicks "Publish" in the sub-bar. The dialog has "File version" and "Form version", preset to the newest of each, and the caption "Later edits leave this pair unchanged until you publish again."
3. While a Placeholder has no form field, Legal Team Member clicks "Publish". The dialog refuses with one message that names every gap at once, for example: "This pair cannot be published. Add a form field for Placeholder "amount". Clause rule "arbitration" names a Block this file does not hold."
   3a. A directive does not fit its field type. The gap reads like: Set "Signing date" to a date field for Placeholder "{{signing_date|date:...}}".
   3b. A Clause rule names a field or an option that no longer exists.
   3c. A Value map lacks its currency or cadence, or a map points at an answer of the wrong kind.
   3d. The title pattern names a missing field.
   3e. An Assignment rule names a missing field.
   3f. An orphaned form field does not block Publish.
4. Legal Team Member fixes the gaps, or picks File version 1 in the dialog, and clicks "Publish".
5. The state pill reads "Published". The sub-bar "Publish" button becomes "Generate". The Publication card reads "Live since <date>: file version N, form version M."
6. Legal Team Member makes one more form edit. The Publication card warns "Form version M+1 is newer than the currently published form." and shows "Publish" again. The same applies to a newer file version, or to both.
7. Legal Team Member opens the actions menu and picks "Publish new pair". The dialog opens.
   7a. Legal Team Member leaves the live pair selected. The "Publish" button is disabled. A direct call gets "This file and form pair is already published. Choose a new pair or Unpublish first."
8. Legal Team Member publishes the newer form. The Live since line updates. The History applet lists "published".
9. Legal Team Member picks "Unpublish" from the actions menu. It happens at once.
   Watch: Unpublish and Archive have no confirmation dialog.
10. The pill reads "Draft". The Publication card says "Not published." Every file version and form version is still there.
11. Legal Team Member publishes again, then picks "Archive" from the menu. The pill reads "Archived". The Publication card says "Archived."
12. The archived record is read-only. The name is not clickable, Description is disabled, "Upload version" and "Add field" are gone, every field and settings control is disabled, and Publish is gone. The menu shows "Restore" in place of "Archive".
    12a. A direct edit gets "Restore this Auto-Doc before editing it."
13. Legal Team Member returns to the Auto-Docs list. The archived Auto-Doc is hidden. Legal Team Member sets the State filter to "Archived" or "All states". It appears.
14. Legal Team Member opens it and picks "Restore". The pill reads "Draft", not Published. Legal Team Member publishes again for the next scripts.

#### List filters and columns

15. Legal Team Member types in "Search Auto-Docs" and clicks "Search". The list narrows. The URL carries `q`.
16. Legal Team Member walks the "State" filter: "Draft and published" by default, "All states", "Draft", "Published", "Archived".
17. Legal Team Member walks the "Audience" filter: Legal only, Selected, Everyone.
18. Legal Team Member walks the "Target Contract Type" filter: "No target Contract Type" and each Type.
19. No match shows "No Auto-Docs match your search and filters" and "Try another search or clear a filter to widen the list."
20. The default columns are Name with description under it, State, Audience, Target Contract Type, Output formats, and Updated. Legal Team Member opens the column menu and adds Default Legal Owner, Fixed Entity, Created, and Published. Legal Team Member sorts by a column header. The foot reads "N Auto-Docs". Clicking a row opens the record.
    Watch: column and sort choices are not saved. A reload resets them. There is no Views menu here, unlike the Inbox.

#### Administrator erasure

21. Legal Team Member, as a Member, opens the actions menu. There is no "Delete Auto-Doc".
22. Administrator opens the actions menu on a test Auto-Doc that has Generations, a created Contract, and a Filing. "Delete Auto-Doc" is shown in red below a separator. It also shows on an archived Auto-Doc.
23. Administrator picks it. The dialog "Delete this Auto-Doc?" says the Auto-Doc, its template versions, forms, saved Generation answers, and output files will be permanently deleted. It says created Contracts and Filed Documents stay on their records and must be deleted separately.
24. Administrator types `delete`. "Delete" enables. Administrator clicks it. The app returns to `/auto-docs`. The Auto-Doc is gone.
    24a. Someone renamed the Auto-Doc in another tab first. The dialog shows "This Auto-Doc was renamed. Reload it before deleting."
25. Administrator opens the created Contract. It still stands, with its primary Document.
26. Administrator opens the Inbox, Unassigned contracts. A row from this Auto-Doc shows "Deleted Auto-Doc" and "Generation details deleted".
27. Administrator opens the Documents destination, filters the owner to Auto-Docs, and tries to delete a template Document through the generic delete. The server refuses with "Manage this template through its Auto-Doc."

### 8.5 Legal generates in the app, with no target Contract Type

Setup: a published Auto-Doc with no target Type, Formats "Word and PDF", and a cover note.

1. Legal Team Member clicks "Generate" in the record's sub-bar. The page `/auto-docs/<id>/generate` opens. The sub-bar reads "Auto-Docs > Mutual NDA > Generate". The description shows above the form.
2. Each form field shows its label, help text, and a control that fits its type: text box, text area, number box, date picker, Yes or No select, single select, multi-select, and an Entity select. Required fields say "Required".
3. Legal Team Member leaves a required date empty and clicks "Generate". The page says 'Fill "Signing date" first.' Other required fields rely on the browser's own prompt.
   Watch: the Member form checks only required dates by name. The Portal form checks every required field by name.
4. Legal Team Member fills every field and clicks "Generate". The button area says "Generating your document...".
5. The page moves to `/auto-docs/<id>/generations/<gid>`, titled "Generation". It shows the Auto-Doc name, the state, the person and time, and "File version N, form version M".
6. The state reads "Pending", then "Ready". The page polls every 1.5 seconds while work is owed.
7. "Download Word" appears once the fill is done. "Download PDF" appears when the PDF conversion finishes.
8. Legal Team Member downloads both. The Word file keeps the template's formatting. The Placeholders are filled. The date prints in the directive's format. The currency prints with its symbol and separators. The arbitration Block is kept or dropped by its Clause rule.
9. The email line reads "Email pending", then "Email sent · <date>".
10. Legal Team Member receives an email with subject "Mutual NDA is ready". It reads "Your generated Mutual NDA is attached.", shows the cover note, attaches `Mutual NDA.docx` and `Mutual NDA.pdf`, and has a "Download your files" button.
    10a. SMTP is unconfigured. The Generation still becomes Ready. The page says "Email was not sent because SMTP is not configured. The downloads are ready."
    10b. The email fails for good. The Generation becomes Failed with "Email could not be sent. Retry this Generation."
11. Legal Team Member opens the record's Generations tab. The count went up by one. Each row shows the person, a state pill, the time, the pair, "Generate again", downloads, email line, and a "File" button.
12. Legal Team Member clicks the person's name. The Generation page opens.
13. Legal Team Member clicks "Generate again". The form opens at `?from=<gid>` with the old answers filled in.
    13a. The form changed since that Generation. Answers that no longer fit show under "Previous answers" with "These answers no longer fit the current form. They are kept here so you can copy them into the new fields."
    Watch: "Generate again" shows on the Generations tab and the Generation page even when the Auto-Doc is unpublished or archived. The form page then shows the refusal.
14. The History applet on the Auto-Doc lists "generated".

#### Generation refusals and failures

15. Legal Team Member opens the Generate page, then Unpublishes the Auto-Doc in another tab, then clicks "Generate". The page says '"Mutual NDA" is not published. Your answers have not been submitted.' The answers stay on screen with "Review current form".
16. Legal Team Member publishes a new pair in another tab while the form is open, then clicks "Generate". The page says the published form or template has changed and the answers have not been submitted. Legal Team Member clicks "Review current form". The form reloads. Answers that still fit stay. The rest move to "Previous answers".
17. Legal Team Member opens `/auto-docs/<id>/generate` on a draft Auto-Doc. The page shows only the refusal and "Review current form", which refuses again.
18. Legal Team Member starts six Generations fast. The sixth says "You have 5 Generations still in progress. Wait for them to finish before starting another."
19. Many fills queue at once. A Generation is refused with "OpenLaw is filling as many documents as it can right now. Try again in a moment."
20. A fill fails, for example a template stored before screening that now fails the screen. The Generation reads "Failed" with a plain reason, such as "The Word document could not be generated. Try again."
21. Legal Team Member opens the Generations tab. The failed row has "Retry". Legal Team Member clicks it. The row goes Pending, then Ready. The History applet lists "generation retried".
    21a. The Generation's Entity was archived since. Retry says 'The Entity used for "<label>" is no longer available.'
    21b. A Ready Generation has no Retry button.
    Watch: the single Generation page shows the failure but has no Retry button. Retry is only on the Generations tab.
22. A fill that hangs over five minutes is swept to Failed so Legal can retry it.

### 8.6 A targeted Auto-Doc creates a Contract

Setup: the Auto-Doc targets NDA, has the title pattern "NDA - {{counterparty_name}}", Counterparty name mapped to Primary Counterparty name, Amount mapped to Value with USD and Annually, one Assignment rule "Jurisdiction equals United States" to Legal Team Member 2, and no default Legal Owner. It is published with Audience "Selected: Sales".

#### Legal generates with a rule match

1. Legal Team Member opens Generate. Below the fields is "Business Owner" with "Leave unassigned" and each person.
2. Entity fields are optional on a targeted form. With a fixed Entity, no Entity field shows at all.
   Watch: Legal's "Required" tick on an Entity field is ignored on a targeted Auto-Doc. Nothing in the editor says so.
3. Legal Team Member fills Counterparty name "Acme & Sons", Jurisdiction "United States", Amount "12345.67", picks a Business Owner, and clicks "Generate".
4. The Generation page shows "Created Contract: NDA - Acme & Sons" as a link.
5. Legal Team Member 2 gets the notification "<Legal Team Member> generated NDA - Acme & Sons from Mutual NDA and you are its Legal Owner", and an email titled "Generated Contract assigned to you: NDA - Acme & Sons" with "Open contract".
6. People set as default people on the NDA Type get the "added to the team" notification.
7. Legal Team Member opens the Contract. It is in `draft`. The title follows the pattern. The Legal Owner is Legal Team Member 2. The Business Owner is the person picked. The primary Counterparty is Acme & Sons, matched by name or created. Value is 12,345.67 USD annually. Mapped catalog Fields are filled.
8. The Contract's primary Document is the generated Word file, Version 1, kind draft ours. The Documents list marks it as generated.
9. The Contract's Activity opens with "<actor> created this contract from Auto-Doc Mutual NDA (Generation ...)" and "<actor> added generated Mutual NDA".
10. The Generation's own "Download Word" still gives the frozen copy. It is a separate file from the Contract's Document.
    10a. Legal Team Member picks no Business Owner. The Contract has none.

#### No rule matches: Unassigned contract

11. Legal Team Member generates again with Jurisdiction "United Kingdom". No rule matches and there is no default.
12. Every live Member+ gets "<actor> generated NDA - ... from Mutual NDA; it needs a Legal Owner" and an email "Unassigned generated Contract: ..." that says "Claim it in the Inbox." with a "Claim it" button.
13. Legal Team Member 2 opens the Inbox. The tabs are "Requests" and "Unassigned contracts (1)". Legal Team Member 2 opens the second tab. The URL gets `?tab=unassigned-contracts`.
14. The table shows Ref, Contract, Auto-Doc, Generated by, and Created, with an "Assign" button pinned on each row. The header reads "1 unassigned Contract".
15. Legal Team Member 2 clicks "Assign". The dialog "Assign NDA-..." says "Choose the Legal Owner responsible for this contract." and lists people with a "Search people" box.
    15a. People fail to load. The dialog says "People could not be loaded." with "Retry".
    15b. A search with no match says "No people match your search."
16. Legal Team Member 2 picks themself and clicks "Save assignment". The row leaves the tab. The count drops.
    Watch: the glossary and the email say "claim". The UI says "Assign" and lets the person pick anyone, not only themself.
17. Legal Team Member 2 picks Legal Team Member instead on another row. Legal Team Member gets "You were assigned a Contract". A person who assigns themself gets no notification.
    17a. Someone else assigned it first. The tab refreshes and shows the server's reason.
18. The tab has "Show more" when there are more rows than one page.
19. With nothing waiting, the tab says "No generated contracts need a Legal Owner" and "Contracts created through Auto-Docs without a Legal Owner appear here. Assign them to a legal colleague."
20. Legal Team Member generates a third unassigned Contract, then sets its Legal Owner from the Contract record instead. It leaves the Unassigned contracts tab the same way.
21. Until someone claims it, the expiry and notice reminders for an unassigned generated Contract go to every Member+. After the claim they go to the Legal Owner. Check this with a Contract whose expiry is near.

#### Assignment edge paths

22. Legal Team Member sets a default Legal Owner and generates with no rule match. The Contract goes to the default. Nothing lands on the Unassigned tab.
23. The matching rule's Legal Owner is archived or demoted before Generation. The Contract is created with no Legal Owner and waits on the Unassigned tab. It does not fall through to the next rule.
24. Mapping errors at Generation. Each is a refusal on the form with the answers kept:
    24a. The title comes out empty or too long.
    24b. The Owning department answer names no live Department, or matches more than one. The second says "Choose its id."
    Watch: Owning department is matched from a typed name. The "Choose its id" message makes no sense to a Business User, who cannot see ids.
    24c. A date answer is not a real date, or an evergreen term has an expiry date.
    24d. The target Contract Type was archived. The refusal says "The target Contract Type is no longer available."
25. A failed Contract transaction leaves no partial Contract. The Generation reads "The Contract could not be created. Retry this Generation." Retry creates the Contract once and never a second.

### 8.7 Filing

#### Filing chosen on the Member generation form

1. Legal Team Member opens Generate on a non-targeted Auto-Doc. Legal Team Member ticks "File to a record". The picker appears: "Search Matters and Contracts" and "Filing destination".
2. Legal Team Member types part of the Matter's title. The destination list refreshes after a short pause. Entries read "Matter #12: <title>" or "Contract #34: <title>".
   2a. The options fail to load. The picker says "Could not read Filing destinations. Change the search to try again."
3. "Generate" stays disabled until a destination is picked. Legal Team Member picks the Matter and clicks "Generate".
   Watch: the form's picker never offers "New Contract". Filing to a new Contract only works after Generation, from the File dialog.
4. The Generation page says "Filing is preparing. The Document will appear on your chosen record." while the output is prepared. For PDF, this waits on the conversion.
5. The Filings list on the Generation page shows "Matter #12: <title>", the time, and the format.
6. Legal Team Member opens the Matter. A new Document holds the output, Version 1, marked generated. The Matter's Activity says "<actor> added generated ...".

#### Filing after Generation, in the app

7. On a Ready Generation, Legal Team Member clicks "File". The dialog "File Mutual NDA" says "Filing creates a new Document. This Generation keeps its original output."
8. The dialog has the destination picker, "File format" with Word and PDF as allowed by the Generation's formats, and the Filing history so far.
9. Legal Team Member picks a Contract and Word, and clicks "File". The dialog closes. The Filings list grows. The Contract's team gets the "document added" notification.
10. The first Member+ Filing to a Contract with no primary Document takes the primary designation.
11. Legal Team Member files the same Generation again to a second record. Each Filing makes its own Document.
12. Legal Team Member picks "New Contract". A "Contract Type" select appears. Legal Team Member picks NDA and clicks "File". A new draft Contract is created from the original answers and maps, with its own provenance. The Generation's automatic Contract link, if any, does not change.
13. Refusals inside the dialog:
    13a. PDF is picked but not ready. The dialog says "This format is still preparing. File it when it is ready." and "File" is disabled.
    13b. The destination was archived. "Restore this record before Filing to it."
    13c. The destination is no longer reached. "This Filing destination is not available to you."
    13d. A Filing is already running. "This Generation already has a Filing in progress."
    13e. The Filing fails. The Generation page says "Filing failed. Choose a destination to try again." The output stays.
14. Legal Team Member erases the filed Document on its record. The Filings entry stays and says "The filed Document was deleted."
15. A viewer who no longer reaches a destination sees "Destination no longer available to you" in the Filings list.
16. A Generation that created a Contract which is now Confidential disappears from the Generations tab for Members who are not on that Contract's team. Its downloads, retry, and Filing refuse for them too.
    Watch: the Generations tab count then differs between Members. Check that this reads as intended.
17. Archive the Auto-Doc. Its Generations stay readable, and "File" still works.

#### Business User Filing in the Portal

18. Business User A opens one of their Ready Generations in the Portal and clicks "File".
19. The destination list holds only Matters and Contracts where Business User A has a team row. There is no "New Contract".
20. Business User A picks the Matter from Script 8.1 and a format, and clicks "File". The Filings list shows the Matter link, which opens the Portal Matter page.
21. The Document on the Matter is a supporting Document. A Business User Filing never takes the primary designation.
22. Business User A is removed from the Matter's team. The Filings entry reads "Destination no longer available to you".

### 8.8 The Portal

Setup: the targeted Auto-Doc from Script 8.6 is published with Audience "Selected: Sales". Formats are Word and PDF. The org frequency is "Once per person for each Auto-Doc".

#### The library

1. Business User A clicks "Auto-Docs" in the Portal nav. The page shows "Create documents from Legal's approved templates, then find and download your finished documents here."
2. Two views sit in a toggle: "Template library" with a count, and "Your documents".
3. The library table shows Template, Description, Format ("Word · PDF", "PDF", or "Word"), and a "Generate" button per row, sorted by name.
4. Business User A searches in "Search templates". The list narrows. No match says "No matching templates" and "Try a different template name or description."
   Watch: the library count keeps the full number while a search narrows the list.
5. A reached Auto-Doc with a Legal-side problem shows the warning "Legal needs to update this Auto-Doc before you can generate it. Please contact Legal." in the Description column and "Unavailable" instead of "Generate".
6. Business User B, in no audience, opens the library. It says "Your template library is on its way" and "No Auto-Docs are available to you yet."
   Watch: "on its way" suggests something is coming. For a person outside every audience, nothing is.
7. Business User B opens `/portal/auto-docs/<id>/generate` from a shared link. The page says "This Auto-Doc is not available to you."

#### Acknowledgement

8. Business User A clicks "Generate". The page is titled "Before you generate". It shows the Auto-Doc name, the acknowledgement text, a checkbox "I acknowledge this statement.", and "Acknowledge and continue", disabled until ticked. A "Back to Auto-Docs" link sits on top.
9. Business User A does not tick the box and clicks "Back to Auto-Docs". Nothing is recorded. There is no Decline button. Leaving is the only way to decline.
10. Business User A ticks and clicks "Acknowledge and continue". The heading changes to "Generate Mutual NDA" and the form appears.
11. An Administrator opens the Auto-Doc's History as an Administrator. An "acknowledged" entry holds the exact text shown. A Member does not see it.
12. Business User A leaves and comes back. Under "once per Auto-Doc" the form opens at once.
    12a. Frequency "Before every generation". The prompt shows every time. Reloading the form before generating asks again.
    12b. Frequency "Once per person across all Auto-Docs". After one acknowledgement, other Auto-Docs using the same text skip the prompt. An Auto-Doc with custom text still asks.
    12c. Frequency "No acknowledgement required". The prompt never shows.
    12d. Legal edits the text while Business User A has the prompt open. Clicking "Acknowledge and continue" says "The acknowledgement has changed. Read the current text before continuing."
    12e. Legal edits the text after Business User A acknowledged. The next visit asks again. Restoring the old words also asks again.
    12f. A submit with a stale or missing acknowledgement says "Acknowledge the current text before generating. Your answers have not been submitted."
13. Legal Team Member opens the Portal URL as a Member+. No acknowledgement is asked.

#### Fill and generate

14. The form shows the description, each field with a "*" on required ones, help text, and the Portal Entity picker, which lists only Portal-listed Entities. With a fixed Entity, no Entity field shows.
15. Business User A leaves a required field empty and clicks "Generate". The page says 'Fill "<label>" first.'
16. Business User A fills the form and clicks "Generate".
17. The page "Your generated document" shows the Auto-Doc name, a state pill, "Created Contract: NDA - ..." linking to `/portal/contracts/<n>`, "Download Word", then "Download PDF", the email line, "File", and "Generate again". The page polls while work is owed.
18. Business User A gets the email "Mutual NDA is ready" with both files and the cover note.
    Watch: the email's "Download your files" link points at the app route `/auto-docs/<id>/generations/<gid>`. A Business User who clicks it is sent to the Portal home, not to their Generation.
19. Business User A opens Your Contracts. The new Contract is there, because Business User A is its Business Owner and holds a team row.
    19a. A Business User cannot choose another Business Owner. A crafted request is refused with "Your generated Contract names you as Business Owner."
20. Business User A opens "Your documents". The table shows Document, Created, Status, and Downloads, newest first. "Show more" loads older rows.
    20a. With none yet, it says "No documents generated yet", "Your generated documents will appear here.", and "Browse templates".
21. Business User A clicks a row. The Generation page opens. "Generate again" opens the form prefilled. Answers that no longer fit show under "Previous answers".
22. A failed Generation shows its plain reason. There is no Retry in the Portal. Legal retries it from the app.
23. The status refresh fails. The page says "Could not refresh the document status. Try again." with "Try again".

#### Lifecycle and reach changes seen from the Portal

24. Business User A opens the form. Legal Team Member Unpublishes. Business User A clicks "Generate". The page says '"Mutual NDA" is no longer published. Your answers have not been submitted.' The answers stay.
25. Business User A reloads the library. The Auto-Doc is gone. "Your documents" still lists the old Generations, and their downloads work. The Generation page hides "Generate again".
26. Legal Team Member publishes a new pair while Business User A has the form open. Business User A clicks "Generate" and gets the changed-pair refusal. Business User A clicks "Review current form". The form reloads. Changed answers move to "Previous answers". Business User A generates.
27. Legal Team Member Archives the Auto-Doc. Same as Unpublish in the Portal. Old Generations stay.
28. Legal Team Member removes Sales from the audience, or sets it to Legal only. Business User A loses the library row and also loses their old Generations. Opening one says "This Generation is not available to you."
29. An Administrator archives the Sales Department. Business User A loses reach through it.
30. An Administrator archives or changes Business User A's role while the form is open. Submit says "Your access has changed. Reload this page before continuing."
31. Legal fixes the Entity to one that is not Portal-listed on an Everyone Auto-Doc. The library row turns "Unavailable" with the contact-Legal message. A direct submit gets the same message.

### 8.9 Cross-checks after the run

1. Legal Team Member opens the Auto-Doc's History applet. Each verb from the run appears: created, updated, template uploaded, form saved, published, unpublished, archived, restored, generated, generation retried, filed. Acknowledged appears only for an Administrator.
2. Legal Team Member opens the Generations tab and checks it against the Portal's "Your documents" for Business User A.
   Watch: the app has no per-person view of Generations and no paging on the Generations tab. Per-person history exists only in the Portal.
3. Legal Team Member checks that Legal-only Auto-Docs still show their Assignment warnings on the Settings tab.
4. Legal Team Member checks that a Generation's downloads keep the formats and cover note it was made with, after the Output settings change.

## 9. App shell, Home and Search

### 9.1 Shell tour for each role

Actors: Administrator, Legal Team Member.

1. Administrator signs in. The header shows the scale mark with "openlaw workspace", the search box, the Help icon, the notification bell and the avatar.
2. Administrator reads the top nav: Home, Inbox, My Tasks, Matters, Contracts, Documents, Entities, Knowledge, Auto-Docs. The current page is marked.
3. Administrator opens each nav item in turn. Each page opens with its own browser tab title.
4. Administrator presses the brand mark. Home opens.
5. Administrator opens the avatar menu. It shows the name and email, "Settings" and "Sign out".
6. Administrator presses Settings. `/settings` forwards to `/settings/profile`.
7. Legal Team Member signs in and reads the same nav. Every item shows. The Settings rail shows Personal only.
8. Administrator looks for a global create button.
   Watch: the header has no global create control. Creation lives on each destination. Record whether that is expected.
9. Administrator opens a Matter or Contract record. The activity bar on the right shows the applets. Opening one opens its panel. Pressing it again or pressing Escape closes it. A badge count reads out as "{label} ({count})". The record auditors cover what is inside.

### 9.2 Keyboard and screen reader

Actors: Administrator.

1. Administrator loads any staff page and presses Tab once. "Skip to content" appears. Enter moves focus to the main region.
2. Administrator presses `/`. Focus moves to the header search.
3. Administrator presses `?` outside a text field. The "Keyboard shortcuts" dialog lists Global keys and "In menus and dialogs" keys. Escape closes it. Focus returns.
4. Administrator tabs through the header, the nav, the page and the applets. Every control shows a focus ring.
5. Administrator opens a menu or dialog and presses Escape. It closes and focus returns to the trigger.
6. With a screen reader, Administrator checks landmarks: banner, the "Primary" nav, main, and "Settings sections" on Settings pages.
7. Administrator checks that the bell button reads "Notifications, N unread".
8. Administrator turns on reduced motion in the OS. Transitions become instant.

### 9.3 Mobile shell

Actors: Legal Team Member on a phone, or a window under 768 px wide.

1. Legal Team Member opens Home. The top nav is replaced by "Open navigation".
2. Legal Team Member opens the drawer. It is titled "Navigation" and lists the same destinations.
3. Legal Team Member picks Matters. The drawer closes and Matters opens. Browser Back returns to Home.
4. Legal Team Member opens the drawer and widens the window past 768 px. The drawer closes and the top nav returns.
5. Legal Team Member opens any dialog. It fills the screen.
6. Legal Team Member opens Settings. The rail becomes one horizontal strip that scrolls.
7. Legal Team Member checks that no page scrolls sideways.

### 9.4 Theme in Appearance

Actors: Legal Team Member.

1. Legal Team Member opens Settings > Appearance. The Theme group offers Light, Warm and Dark, with the note that it is personal.
2. Legal Team Member picks Dark. The shell repaints at once.
3. Legal Team Member reloads and opens another page. Dark stays.
4. Legal Team Member picks a theme with the keyboard only. It works.
5. Legal Team Member signs out. The sign-in page is Light. After sign-in, Dark returns.
   Watch: there is no System option and no density control. DES-002 defers OS detection. The brief asks for both, so record them as absent.

### 9.5 Errors, not found, help

Actors: Administrator, Business User.

1. Administrator opens `/nothing-here`. The staff shell shows "Page not found", "There is nothing at this address." and "Back to Home".
2. Administrator opens `/settings/nothing`. The Settings layout shows the not-found pane inside the rail.
3. Administrator opens `/matters/999999`. The page shows "Matter not found" and says the record does not exist or cannot be opened, with "Back to Matters". Repeat for a Contract, an Entity and a Knowledge Item.
4. Business User opens `/portal/nothing`. The portal shows not-found with "Back to the portal".
5. Administrator stops the API and navigates. The crash page shows "Something went wrong.", "The page could not load. Reload to try again.", Reload and Back to Home.
6. The app is updated while a tab is open, and a lazy part fails to load. The part shows "This part of OpenLaw was updated. Reload to continue." with Reload.
7. Administrator presses the Help icon in the header. The help reader opens at the topic for the current page, filtered to the Administrator audience.
8. Legal Team Member does the same. The reader shows Legal Team Member guides.
9. A signed-out visitor opens `/help`. The app sends them to `/documentation`.
10. The session check fails while opening help. The page shows "Help session unavailable" and "All documentation".
11. On the wizard, the "Help with this page" link opens the matching article in `/documentation`.

### 9.6 Populated Home for an Administrator

Actors: Administrator on instance B.

1. Administrator opens Home. Cards show in this order when they have items: Approvals waiting on you, Tasks assigned to you, Dates approaching, Entity obligations, Inbox, Your contracts, Your matters. A card with nothing in it is absent. Each card shows up to four rows.
2. Approvals card. Each row reads "Requested by {name} · Contract C-{n}" with "Awaiting you". Administrator opens a row. The Contract's Approvals tab opens.
   a. Administrator presses "View all N".
   Watch: View all opens the whole Contracts list, not a list of approvals waiting on you.
3. Tasks card. Administrator opens a Task. The record's Tasks tab opens with the Task. "View all N" opens `/home/tasks`. See Script 9.7.
4. Dates approaching card. Rows show key dates, "Current term expires" and "Renewal notice deadline" entries. A derived date shows "Derived". Administrator opens a row. The record's Key dates tab opens.
5. Administrator presses "View all N" on Dates. See Script 9.8.
6. Entity obligations card. Rows read "{entity} · Due {date}", with "Overdue" and "Unassigned" pills. The Administrator also sees unassigned obligations and obligations whose assignee cannot reach the Entity. A row opens the Entity's Obligations tab. View all opens `/entities`.
7. Inbox card. Rows read "{reference} · {request type} · {requester}" and "{urgency} urgency". A row opens the Request. View all opens `/inbox`.
8. Your contracts card. Rows read "Contract C-{n} · {stage}", the next date or "No upcoming date", and "Renewal pending confirmation" where it applies. View all opens `/contracts?owner=me`.
9. Your matters card. Rows read "Matter M-{n} · {status}" and the next deadline or "No upcoming deadline". View all opens `/matters?manager=me`.
10. Administrator completes a Task on its record and comes back. Home no longer shows it, without a reload.
11. Administrator decides an approval or triages a Request, then comes back. Check that the cards and counts follow.

### 9.7 Your Tasks

Actors: Legal Team Member.

1. Legal Team Member opens "My Tasks" in the nav, or View all on the Tasks card. The page is "Your Tasks".
2. Rows sort by due date. Undated Tasks come last with "No due date". Overdue Tasks show "Overdue".
3. Legal Team Member presses "Complete Task: {title}". The checkmark shows, the row fades out, and the count drops. A message says "Completed: {title}" with Undo.
4. Legal Team Member presses Undo. The Task returns to its place. The message says "Reopened: {title}".
   a. Undo fails. The page shows "The Task could not be reopened. Please try Undo again."
5. Legal Team Member turns on "Show completed". Completed Tasks show with "Reopen Task: {title}".
6. Legal Team Member presses "Load more Tasks" at the end of the list.
   a. The next page fails. The page shows "More Tasks could not be loaded. Please try again."
7. Legal Team Member opens a Task title. The record's Tasks tab opens.
8. With no Tasks, the page shows "No open Tasks assigned to you." or, with completed shown, "No Tasks assigned to you."

### 9.8 Your dates calendar

Actors: Legal Team Member.

1. Legal Team Member presses View all on Dates approaching. A wide dialog "Your dates" opens on this month.
2. Legal Team Member uses "Previous month", "Next month" and "Today".
3. Legal Team Member picks a marked day. The list narrows to that day. "Show whole month" restores the month.
4. Legal Team Member opens a date from the list. The record's Key dates tab opens.
5. Legal Team Member presses "Close calendar" or Escape. Focus returns to View all.
6. The read fails. The dialog shows "Dates could not be loaded." and "Try again". An empty month shows "No dates in this period."

### 9.9 Home by role and when empty

Actors: Administrator, Legal Team Member, Business User.

1. Legal Team Member opens Home. The obligations card shows only obligations assigned to them. Other cards match their own work.
2. A new Legal Team Member with no work opens Home. The page shows "Welcome to OpenLaw", "Nothing is waiting on you." and "Go to a destination" with links for the nav items their role holds.
3. Business User opens `/`. The app sends them to `/portal`. Business Users have no Home.
4. Administrator on an instance with onboarding open opens `/`. The app sends them to `/welcome`.

### 9.10 Live updates across two browsers

Actors: Legal Team Member on browser 1, Business User on browser 2.

1. Legal Team Member leaves Home open on browser 1.
2. Business User submits a new Request on browser 2.
3. Browser 1 Inbox card count rises without a reload. The bell badge rises too.
4. Legal Team Member stops the network briefly, then restores it. Home re-reads its cards after the reconnect.
5. Two Legal Team Members have the same Contract open. One posts a comment. The other sees it appear in Comments without a reload. The Activity applet follows too.
6. Pages without a live connection, such as lists and Settings, do not update until a reload. Record any page where you expected a live update.

### 9.11 Header search

Actors: Legal Team Member.

1. Legal Team Member presses `/` or clicks the header search. The placeholder reads "Search contracts, matters, documents…" with the key hint.
2. With the box empty and focused, a list shows two groups, "Recent" and "Saved". Recent holds up to five questions from this browser. Saved holds the person's saved searches.
3. Legal Team Member types a title word. After a short pause the list shows "Searching…", then matches with a kind label: Contract, Matter, Document, Entity, Counterparty, Request, Knowledge Item or Auto-Doc.
4. Legal Team Member types a record number such as C-23 or M-29. The record is the first match.
5. Legal Team Member uses the arrow keys, then Enter. The highlighted result opens.
6. Legal Team Member presses Escape. The list closes and the typed words stay.
7. Legal Team Member types a word and presses Enter with nothing highlighted, or picks "See all results". `/search?aq=...` opens.
8. Legal Team Member picks "Advanced search…". The Advanced search dialog opens with the typed words. See Script 9.13.
9. Legal Team Member types a word with no matches. The list shows "No matches" and "No matches for "{query}". Try another word or record number."
10. The API is down. The list shows "Search could not load" and "The server did not answer. Try again in a moment."

### 9.12 Results page

Actors: Legal Team Member.

1. Legal Team Member lands on `/search?aq=...`. The title reads "Search results for "{query}"" and a count reads "N matches". The count is the exact total, not a page count.
2. The kind chips show All and each kind. Legal Team Member picks Contract. Only Contracts show. Conditions for other kinds are dropped.
3. Word chips such as "All of these words: {value}" and "Search in: {scope}" show. Removing a chip re-runs the search.
4. Legal Team Member opens Sort and picks Relevance, Newest, Oldest, Title or "Expiry soonest".
5. Legal Team Member opens a Document result. The owning record opens at the version, with the find box filled with the words.
6. Legal Team Member presses "Show more". The next 25 load.
   a. The next page fails. The page shows "The next results could not be read. Try again."
7. Legal Team Member uses Back and Forward. The question and kind return each time. Copying the URL into another tab gives the same answer.
8. Legal Team Member opens `/search` with no question. The page title reads "Search contracts, matters, documents, entities, counterparties, and requests".
9. The URL names a custom Field that no longer exists. The page shows "Unavailable Field conditions were removed." and runs the rest.

### 9.13 Advanced search with a compound question

Actors: Administrator.

1. Administrator presses "Advanced search" in the header. The dialog shows Words, "Search in", Kinds, conditions and a live Preview.
2. Administrator fills Words rows: "All of these words", "This exact phrase", "Any of these words" and "None of these words".
   a. A row over 200 characters shows "Search words rows must be 200 characters or fewer."
3. Administrator sets "Search in": Titles and numbers, Record text, Document contents.
   a. Administrator clears all three. The dialog shows "Choose at least one search scope." and Search is disabled.
4. Administrator picks Kinds. The help says "Only selected kinds are searched." With none, it says "No kinds selected searches every kind."
5. Administrator presses "Add condition", picks Contract, then Properties such as Status, Type, Owner, Counterparty, Signing Entity, Effective date, Expiry date, Notice deadline, Confidential, "Show ended" and "Show archived". Fields lists custom Fields.
6. Administrator builds "Contract Expiry date in the next 90 days". The relative operators include today, this week, this month, this quarter, this year, "in the last N days" and "in the next N days".
7. Administrator adds a second condition, "Contract Governing law contains Delaware", and sets "Match all" or "Match any".
8. The Preview updates with "N matches" and "Showing the first {count} of {total}". An empty question shows "Build your search".
9. Administrator adds 20 conditions. A 21st is refused with "A search can have at most 20 conditions."
10. Administrator presses "Save search". The "Save this search" dialog asks for Name. Save creates it.
    a. A duplicate name is refused. The dialog shows "The view could not be saved. Try again."
11. Administrator presses Search. The results page opens and each condition shows as a chip, such as "Edit Contract Expiry date in the next 90 days".
12. Administrator reloads. The same question and total return.
13. Administrator presses a chip to edit it in the dialog, or removes it.
14. Administrator goes Home, focuses the header search, and picks the saved search under Saved. The same results page opens.
15. In the dialog, Administrator opens the saved search menu: "Rename…", "Save as…", "Delete…", "Discard unsaved changes". A changed question shows "Modified" with Save.
16. Administrator deletes it. The confirm reads "Delete this saved search?" and says the records are not touched.
17. Administrator presses Clear. The dialog empties.
18. Legal Team Member signs in. They do not see the Administrator's saved searches. Saved searches are private.

### 9.14 Permission filtering and Recent

Actors: Administrator, Legal Team Member.

1. Administrator marks a Contract Confidential and is not on its team. The Administrator searches its title. It does not show.
2. A Legal Team Member on the team searches the same title. It shows.
3. A Legal Team Member off the team searches its number. No match. No placeholder shows.
4. Legal Team Member runs three searches, then focuses the empty header box. Recent lists them, newest first, at most five.
5. Legal Team Member signs out and back in on the same browser. Recent is empty.
6. Legal Team Member opens the same account on another browser. Recent is empty there. It is browser-local.

## 10. Notifications

### 10.1 The bell

Actors: Administrator, Legal Team Member.

1. Legal Team Member sees the bell badge. It counts unread items and caps at "9+".
2. Legal Team Member opens the bell. "Your approvals" is pinned at the top when they have open approvals. Below are "Unread" and "Earlier" groups.
3. Legal Team Member opens an item. The record, tab, Task or Request opens. The item becomes read. The badge drops.
4. Legal Team Member presses "Mark all read". Unread items become read. The note says "Mark all read leaves Your approvals in place." Approvals still count.
5. Legal Team Member presses "Show older".
   a. It fails. The panel shows "The older notifications could not be read. Try again."
6. The first read fails. The panel shows "Notifications could not be read. Close this and open it again." Close and reopen reads again.
7. With nothing, the panel shows "Nothing to catch up on. News about your records shows up here."
8. A Contract approval appears under Your approvals with "Review". Review opens the Contract's Approvals tab. The item leaves the group only once decided.
9. Administrator receives an API key request under Your approvals. It shows Read or Write, then Deny and Approve. Approve or Deny acts in the bell.
   a. The action fails. The item shows "The request could not be handled. Try again."
10. A new notification arrives while the bell is closed. The badge rises without a reload.
11. A person is removed from a Confidential record's team. An older item for that record opens nothing and shows no link.

### 10.2 Personal notification preferences

Actors: Legal Team Member, Administrator.

1. Legal Team Member opens Settings > Notifications. The "Notification preferences" grid shows event groups by channel: In-app, Email, Push.
2. Rows: "Assigned to you", "Activity on your records", "Dates approaching", "New requests", "Knowledge items".
   a. "Dates approaching" shows no Email switch here. Its email is the daily briefing.
   b. "Knowledge items" shows "Email only".
3. Check the defaults. Assigned to you: In-app, Email and Push on. Activity on your records: In-app on only. Dates approaching: In-app and Push on. New requests: In-app on only. Knowledge items: email on.
4. Legal Team Member turns off In-app for Assigned to you. The Email and Push switches for that row are disabled. The status note shows Saved.
5. Legal Team Member reloads. The choices hold.
6. A save fails. The note shows the error and the switch returns to its saved value.
7. Legal Team Member scrolls to Devices. See Script 10.3.
8. Legal Team Member scrolls to "Your reminder lead times". The switch "Use the organization's default lead times" is on and shows the org list.
9. Legal Team Member turns it off, presses "Add lead time", enters days before the date, and saves. Removing a lead time shows "Remove {label}".
   a. A duplicate shows "{label} is already on the list."
   b. A number outside the range shows "Enter a whole number of days between 0 and {max}."
   c. At the limit, the add shows "The list holds at most {max} lead times. Remove one first."
10. Legal Team Member scrolls to Briefing. Sections: Approvals, Tasks, Dates, Obligations, Intake, Knowledge items, as offered for the role. The note says the switches change the email only. Intake is off by default.
11. Legal Team Member turns off Tasks in Briefing. The next morning's briefing has no Tasks section. Home and the bell summary still show Tasks.

### 10.3 Device notifications

Actors: Legal Team Member on a browser that supports Web Push, Business User.

1. Legal Team Member opens Settings > Notifications > Devices. The card explains that turning In-app off also silences Push.
2. Legal Team Member presses "Turn on for this browser". The browser asks for permission.
   a. Legal Team Member blocks it. The card names the steps for this browser, such as Chrome, Edge, Firefox or Safari, to allow it.
   b. The browser has no support. The card says so. On iPhone or iPad it says to add OpenLaw to the Home Screen.
3. Legal Team Member allows it. The card shows "Notifications are on for this browser." The device row reads "{browser} on {platform}" with "Last seen {time}" and "Revoke".
4. Legal Team Member turns on the Push switch for "Activity on your records".
5. Another person comments on the Legal Team Member's Contract. An OS notification appears with the record name.
6. Legal Team Member turns off "Show details in notifications". The next OS notification uses a generic sentence, such as "A comment was posted on a record".
7. Legal Team Member clicks an OS notification. The app opens the item and the bell item becomes read.
8. Legal Team Member presses Revoke on this browser. The row leaves the list and the browser stops receiving.
9. Legal Team Member signs out. Device notifications for this browser stop.
10. Business User opens `/portal/settings`. The same Devices card and the "Request updates" row show.
    Watch: there is no "send a test notification" control. The public-address guard runs on the server only: an endpoint on a private address is refused and pruned, with nothing shown in the pane. Test with a real notification and check the device list after.

### 10.4 Organization notifications and reminders

Actors: Administrator.

1. Administrator opens Settings > Organization > Notifications, at `/settings/reminders`. The "Reminder lead times" card lists lead times, such as "7 days before", "1 day before" and "On the day".
2. Administrator presses "Add lead time", enters a whole number of days, and saves. 0 means "On the day".
3. Administrator reorders lead times by drag and by arrow keys. A live message says "{label} moved to position {n} of {total}."
4. Administrator removes a lead time. The last one cannot be removed and shows "{label} is the only lead time and can't be removed".
5. Duplicate, negative or too-large values show their own message. A failed save can be retried.
6. Administrator reads the "Comment emails" card and the switch "Include comment words in email". The help says it applies to everyone.
7. Administrator turns it off. A mention email now links to the record without the comment's words. Turned on, the email carries the words.
   Watch: the comment words switch lives here, not in Outbound email as the brief says.
   Watch: this pane has one lead-time list. There are no separate settings for Next deadline, Key date or Obligation reminders, and no digest time. Key dates can add their own lead times on the record.

### 10.5 Emails each actor should receive

Walk these alongside the scripts above and check each arrives once, with the org logo or the OpenLaw mark in the header.

1. Invite: "Set your OpenLaw password" to the Invitee. The link expires in 1 hour.
2. Password setup or reset: "Set your OpenLaw password". The link expires in 1 hour.
3. Magic link: "Sign in to OpenLaw". The link expires in 5 minutes and works once.
4. Test send: "OpenLaw test email" to the signed-in Administrator.
5. Approval requested: an immediate email to the approver. Check it as Administrator and as Legal Team Member, with and without a logo.
6. Task assigned: "Task assigned: {task} ({record})" at once, if Email is on for Assigned to you.
7. Request assigned for triage: "Request assigned for triage: {request}".
8. Comment or mention: the email carries the words only while the org switch is on.
9. API key request outcome: "API key request approved" or "denied" to the requester.
10. Daily briefing: one morning email with the sections the person kept on. Dates approaching arrive here, not as separate emails.
11. Requester events for a Business User: received, replied, status changed, declined.
12. Turn off Email for a group, repeat its trigger, and confirm no email arrives while the bell item still does.

## 11. MCP

### 11.1 Administrator turns MCP on and sets the ceiling

1. Administrator opens Settings > Organization > MCP. The rail entry sits after Integrations and before Advanced. A Legal Team Member opening the same URL is refused with "Only an Administrator can change MCP settings."
2. Administrator reads the master switch "Enable MCP" in the off state. Every row below is inert while it is off.
3. Administrator turns Enable MCP on. The change applies at once and lands in the Audit log at admin_only.
4. Administrator reads the two group rows, Legal Users and Business Users. Each has an "OAuth Clients" toggle and an "API keys" toggle. All four start off.
5. Administrator turns Legal Users > API keys on. Turn Business Users > API keys on as well for the Portal scripts below.
6. Administrator turns Legal Users > OAuth Clients on.
   6a. Server reachable from the internet on HTTPS: the row shows "Reachable".
   6b. Server not reachable: the row shows "Not reachable" with the failed checks (HTTPS scheme, IPv4 record, Public IPv4 address) and a link "How to set this up". The toggle still saves.
7. Administrator opens Allowed Clients. Seeded rows: Claude, Claude Code, ChatGPT, Microsoft 365 Copilot. Each is a Published identity and is not editable. Each has an Enable toggle.
8. Administrator turns one seeded Client off, then back on.
9. Administrator clicks Add Client to make a Registered client. Enter a Client name and one or more Callback URLs (Add callback URL). Click Generate secret. Read the Client id and the one-time secret with Copy. Read the warning that the secret is not shown again. Click Done.
   9a. Invalid callback URL: "The Client could not be saved. Check the callback URLs and try again."
10. Administrator clicks Edit on the Registered client, changes a callback URL, saves. Click Rotate secret and confirm the old secret stops working while grants stay.
11. Administrator clicks Delete Client on the Registered client and confirms.
12. Administrator opens Toolset ceiling. Tick and untick Toolsets (contracts, matters, requests, documents, tasks, knowledge, workspace, team, administration). Team and Administration start off and are Administrators only. The guide Toolset is always on and is not listed.
13. Administrator turns the org-wide Read-only switch on and reads "No Client may write, even if its API key allows writes." Turn it off again later for the write scripts.
14. Administrator sets API key lifetime to a whole number of days between 1 and 365. Enter 0 or 400 and read the validation message. Default is 90.
15. Administrator reads "Tool calls in the last day" and follows the link to Audit log > Tool calls, filtered to the last day.
16. Administrator opens Settings > Organization > Advanced and reads the MCP calls-per-hour rate limit (default 600) and the OAuth grant lifetime. If the environment pins either, the field is read-only with a pinned note.

### 11.2 A Legal Team Member gets an API key and connects a headless Client

1. Legal Team Member opens Settings > Personal > API keys. With Legal Users > API keys off, the request form is hidden. Turn it on as Administrator and reload.
2. Legal Team Member reads "Connect a headless Client", the Server address with Copy address, and "Send this key in the x-api-key header."
3. Legal Team Member clicks Request an API key. Enter a Client name (free text, for example Claude Code). Tick Toolsets from the ceiling. Nothing is pre-selected. Choose Read or Write. Add an optional note. Read "Expires N days after approval" as a fact from the org lifetime. Click Send request.
   3a. No Toolset in the ceiling: "No Toolsets are available for your account. Ask an Administrator to enable a Toolset you can use."
   3b. Org Read-only is on: only Read is offered.
4. Legal Team Member reads the request in the pending list with status Pending approval and a Cancel request button. Cancel one request and read status Cancelled. Send another.
5. Every Administrator gets a bell item in Your approvals and an email "API key request needs approval" (plain text). The bell badge counts it until handled, read or not.
6. Administrator opens the request from the bell or from Settings > Organization > MCP > API key requests. Read requester, Client name, Toolsets, scope and note.
   6a. Administrator clicks Approve with an optional note. The requester gets the email "API key request was approved" and a bell item.
   6b. Administrator clicks Deny with an optional note. The requester gets "API key request was denied". The row shows Denied.
   6c. An Administrator requests a key themselves. It approves itself and the Audit log records that.
7. Legal Team Member returns to Settings > Personal > API keys and reads "Your key is ready" with the key shown once, Copy and Copied, and "Approved by {name} on {date}. OpenLaw will not show this key again." Reload the page and confirm the key is gone.
8. Legal Team Member connects Claude Code with the server address and the key in the x-api-key header, following docs/user-guides/connect-headless-client.md. For Claude Desktop or Cowork use the stdio mcp-remote entry in the same guide.
9. Client lists Tools. Only Tools inside the grant appear (chosen Toolsets, read or write, account type, ceiling). Call openlaw_whoami and read your own name.
10. Client reads: openlaw_contracts_list, openlaw_contract_get, openlaw_matters_list, openlaw_search, openlaw_documents_list, openlaw_document_read, openlaw_knowledge_search, openlaw_vocabulary, openlaw_docs_search.
11. Client writes with a Write key: openlaw_matter_create, openlaw_matter_update, openlaw_matter_set_status, openlaw_contract_create, openlaw_contract_set_status, openlaw_task_create, openlaw_task_update, openlaw_comment_post, openlaw_document_upload, openlaw_request_submit, openlaw_request_assign, openlaw_auto_doc_generate.
12. Legal Team Member opens the Matter the Client created. The Activity feed and History name the person "via Claude Code". Comments posted by the Client carry the same attribution.
13. Client calls a Tool outside the grant. Result is a clear refusal. Audit log > Tool calls shows outcome "Outside the grant".
14. Client with a Read key tries a write Tool. Outcome "Read-only" or "Outside the grant".
15. Client asks for a Confidential Contract the person is not on. Outcome "Not found". Nothing leaks.
16. Client exceeds the calls-per-hour limit. Outcome "Rate limited".
17. Legal Team Member reads the key in the Active keys list with name, Toolsets, scope, Expires, Last used. Click Revoke API key, read "This Client will lose access immediately", confirm. The next Client call fails.
18. Administrator opens Settings > Organization > MCP > Active keys and grants, reads every key and grant with Owner, Client, Toolsets, Scope, Last used, and revokes somebody else's key.
19. Administrator changes the Toolset ceiling while a Client holds a listen stream. The Client receives a tools list changed notification and re-lists Tools.
20. Wait for or simulate key expiry. The row shows Expired and the Client is refused.

### 11.3 A Business User gets an API key from the Portal

1. Administrator turns Business Users > API keys on.
2. Business User opens Portal settings and follows the API keys link to /portal/settings/api-keys.
3. Business User requests a key. Read "They can see only their own Requests and Auto-Docs, portal Knowledge, and records they are on." Toolsets offered are the Portal-safe subset.
4. Administrator approves from Your approvals.
5. Business User copies the key once and connects a Client.
6. Client lists their own Requests, Auto-Docs, portal Knowledge and records they hold a team row on. A staff Tool such as openlaw_audit_log_query is absent from tools/list.
7. Client calls openlaw_request_submit and the Request appears in the Inbox with the Business User as Requester, via the Client.

### 11.4 A Legal Team Member connects a chat Client by OAuth

1. Administrator has Legal Users > OAuth Clients on and Claude enabled in Allowed Clients. The server passes the reachability check (HTTPS, public address).
2. Legal Team Member adds the OpenLaw connector inside Claude (claude.ai, Claude Desktop or Cowork) with the server address, following docs/user-guides/connect-claude.md. Repeat later for ChatGPT and Microsoft 365 Copilot with their guides.
3. Browser opens the OpenLaw consent page "{client} wants to work in OpenLaw as you". Sign in if needed.
4. Read the Client row (Published identity or Registered client, Allowed Client badge). Read "This Client can never see or change what you cannot."
5. Under "What {client} may use" tick Toolsets from the ceiling. Nothing is pre-selected. Under "How far {client} may go" choose Read only or Read and write.
   5a. Click Deny. The Client reports the refusal. Nothing is granted.
   5b. Click Allow with nothing ticked. Read "Nothing is selected for you."
   5c. Click Allow with Toolsets ticked. The browser returns to the Client and it lists Tools.
6. Negative consent states: MCP off ("MCP is off for this organization."), group toggle off ("OAuth Clients are off for your account type."), Client not on the list, Client turned off in the list, stale request ("This consent request has expired or changed. Start again from your Client.").
7. Client reads a record resource (openlaw://matters/M-1, openlaw://inbox, openlaw://vocabulary, openlaw://document-versions/{id}) and gets a prompt (summarize_record, triage_inbox). Attach a Matter in the chat and run summarize_record.
8. Client subscribes to a record. Legal Team Member changes the Matter in the browser. The Client receives a resource updated notification.
9. Client adds and removes a colleague on a Matter team. Matter History names the Client for both changes.
10. Legal Team Member opens Settings > Personal > API keys > Connected Clients. Read Client, Toolsets, scope, Granted date, Last used. Click Disconnect {client}, read "A new consent is needed to connect again", confirm. The Client's next call fails.
11. Administrator revokes another person's OAuth grant from the Organization table with Revoke OAuth grant.
12. Business User path: Administrator turns Business Users > OAuth Clients on. Business User consents from the Portal. Consent page says "You can disconnect {client} later from Portal settings → API keys."

### 11.5 Administrator inspects Tool calls

1. Administrator opens Settings > Organization > Security > Audit log > Tool calls tab.
2. Read rows for Tool calls, resource reads and prompt gets, each with actor, Client, Tool, outcome, time.
3. Use Narrow Tool calls: actor, Client, Tool, from, to. Clear filters.
4. Read every outcome value at least once across the scripts above: Success, Pending, Rate limited, Forbidden, Outside the grant, Read-only, Unknown Tool, Invalid arguments, Validation error, Not found, Acknowledgement required, Generation limit reached, Result too large, Internal error.
5. Read the matching admin_only Audit log entries for MCP setting changes, key approvals and denials, revocations and Allowed Client edits.
6. An Administrator's Client calls openlaw_audit_log_query and openlaw_settings_get with the Administration Toolset and reads the same entries.

Watch: the Tool calls list has no export. Check whether the main Audit log export covers it.
Watch: the API key emails are plain text by design (M43 follow-up).

## 12. Cross-cutting

### 12.1 Managed tables, Columns and Views

Actors: Legal Team Member. Run on Matters, Contracts, Documents, Inbox, Entities List and Knowledge.

1. Legal Team Member opens Columns. Optional columns show and hide. Mandatory columns cannot be hidden.
2. Legal Team Member uses "Move {column} earlier" and "Move {column} later".
3. Legal Team Member drags a column edge to resize it. With focus on the edge, arrow keys resize it within limits.
4. Legal Team Member turns on "Fill the width", then "Reset columns".
5. Legal Team Member sorts a header both ways. The sort mark shows.
6. Legal Team Member opens Views. "Default view" and saved views show. The one marked "Opens here" is the default.
7. Legal Team Member changes filters or columns. The view shows "Modified" with Save.
8. Legal Team Member uses "Save as…", names a view, and saves.
   a. A duplicate name shows "The view could not be saved. Try again."
9. Legal Team Member uses "Rename…", "Set as default" and "Delete…". Delete asks "Delete this view?" and says the records are not touched.
10. Legal Team Member uses "Discard unsaved changes". The saved layout returns.
11. Legal Team Member reloads, follows a view URL, and uses Back and Forward. Views from one destination do not appear on another.
12. A filter set with no rows shows "No rows match the current filters."

### 12.2 Common states

Actors: any.

1. Loading. Route pages render nothing until the loader answers. Some cards show "Loading…" text. Record any page that looks frozen.
2. Empty. Check Home, Your Tasks, the bell, search, Users with no archived rows, Departments, Regions and Currencies for their empty text.
3. Error. Stop the API. Inline actions show "The server could not be reached. Try again." Page loads show the crash page.
4. Offline. Turn off the network in dev tools and act.
   Watch: there is no offline indicator. Each action fails on its own.
5. Pending. Double-click every save and send button. It disables while pending and never saves twice.
6. Restricted. A 404 record page says the record does not exist or cannot be opened. It never says which.

### 12.3 Roles as the UI shows them

Actors: Administrator, Legal Team Member, Business User.

1. Administrator sees all nav items, Organization Settings, the Setup checklist, the Audit log, "Your approvals" for API key requests, and unassigned obligations on Home.
2. Legal Team Member sees all nav items, Personal Settings with View Business Portal, and their own Home cards. Organization URLs send them to Profile.
3. Business User sees only the portal. Every staff URL sends them to `/portal`. `/settings` is refused, Personal included.
4. Change a role in Users and repeat steps 1 to 3 for the changed person without signing out. The new role applies on the next navigation.
5. Check that the Contributor role appears nowhere except in old audit entries.
   Watch: the older UX checklist still asks for Contributor checks. DD-023 removed the role.

### 12.4 Locale and time zone

Actors: Administrator, Legal Team Member.

1. Administrator checks that every string is in English (United States). No other locale exists.
2. Administrator sets the org Default timezone. A Legal Team Member with no personal timezone sees dates in the browser's zone in the app. The daily briefing uses the org zone.
3. Legal Team Member sets a personal Timezone in Profile. Dates in lists, Home and the audit log follow it.
4. Check relative stamps in Users Last active: minutes, hours and days within a week, then a short date.

### 12.5 Device and input coverage

Actors: any.

1. Repeat Scripts 1.4, 9.6, 9.11 and 2.3 on a phone-width window.
2. Repeat Scripts 1.1, 9.7, 9.13 and 2.5 with the keyboard only.
3. Repeat Scripts 1.4, 9.2, 9.6 and 10.1 with a screen reader. Check the page title per screen, the step region on each wizard step, live status notes on Settings saves, and the bell count.
4. Check the auth screens and the wizard in Light only, and the shell in Light, Warm and Dark.

## Appendix. Sources audited

Each module's scripts were built from these files, plus `CONTEXT.md`, the decision records and the browser journeys under `e2e/tests`.

### Intake, Business Portal and Inbox

- /home/blairwentworth/projects/OpenLaw/CONTEXT.md
- /home/blairwentworth/projects/OpenLaw/docs/UX-REVIEW-CHECKLIST.md
- /home/blairwentworth/projects/OpenLaw/docs/decision-records/DECISIONS-INTAKE.md and DECISIONS.md (DD-021, DD-023 to DD-028)
- /home/blairwentworth/projects/OpenLaw/apps/web/src/router.tsx
- /home/blairwentworth/projects/OpenLaw/apps/web/src/routes/inbox.tsx, inbox-request.tsx, settings-request-types.tsx, settings-request-type-editor.tsx, settings-intake-links.tsx, settings-app-view.tsx, login.tsx, portal.tsx, portal-entry.tsx, portal-onboarding.tsx (via journey), portal-request-form.tsx, portal-request.tsx, portal-contracts.tsx, portal-matters.tsx, portal-contract.tsx, portal-matter.tsx, portal-approvals.tsx, portal-knowledge.tsx, portal-settings.tsx, consent.tsx (header)
- /home/blairwentworth/projects/OpenLaw/apps/web/src/components/inbox/_, unassigned-contracts.tsx, intake/_, portal/_, comments/_, type-form/*, taxonomy-types-pane.tsx, list-editor.tsx, notification-preferences.tsx
- /home/blairwentworth/projects/OpenLaw/apps/web/src/lib/portal-onboarding.ts, lib/comments.ts
- /home/blairwentworth/projects/OpenLaw/apps/api/src/modules/requests/* (routes.ts, service.ts, disposition.ts, convert.ts, convert-form.ts, resolve.ts, decline.ts, assignment.ts, request-detail.ts, inbox.ts, unassigned-contracts.ts, conversion-draft.ts), modules/portal/counterparties.ts, modules/request-types, modules/intake-links, modules/entities/routes.ts, lib/type-form-routes.ts, lib/notifications/catalog.ts and email.ts, auth/instance.ts, lib/org-settings.ts, modules/auth/routes.ts
- /home/blairwentworth/projects/OpenLaw/messages/en-US.json
- /home/blairwentworth/projects/OpenLaw/e2e/tests/25-m19-demo, 26-m20-demo, 27-m21-demo, 28-m21a-demo, 42-portal-contracts, 43-portal-record-lists, 44-portal-applets, 45-portal-documents, 46-portal-onboarding, 47-portal-entities, 61-m39-type-form (.spec.ts)

### Contracts

- CONTEXT.md; docs/UX-REVIEW-CHECKLIST.md, Contracts, Contract record and Organization Contracts sections
- docs/decision-records/DECISIONS-CONTRACTS.md, CTR-001 to CTR-026 and the 2026-09-26 CTR-013 addenda; docs/decision-records/DECISIONS-DOCUMENTS.md, DOC-003 and DOC-010
- apps/web/src/routes: contracts.tsx, contract-record.tsx, document-compare.tsx, signing-return.tsx, settings-contract-types.tsx, settings-contract-type-editor.tsx, settings-contract-statuses.tsx, settings-contract-fields.tsx, settings-approver-groups.tsx, settings-document-types.tsx, settings-e-signature.tsx, portal-contract.tsx, portal-contracts.tsx, portal-approvals.tsx
- apps/web/src/components: contracts/_, approvals/approvals-signing-card.tsx, documents/_, tasks/_, comments/_, activity/_, table/_, type-form/_, portal/_, unassigned-contracts.tsx, contract-type-people.tsx, approval-default-settings.tsx, confidential-toggle.tsx, confidential-banner.tsx
- apps/web/src/lib: envelopes.ts, documents.ts, activity.ts, record-filters.ts
- apps/api/src/modules: contracts, contract-types, contract-statuses, contract-approvals, approver-groups, contract-envelopes, signing-connector, signing-webhook, signer-erasure, contract-analysis, ai-field-prompts, contract-key-dates, contract-tasks, contract-relations, contract-matters, counterparties, documents, requests (convert, unassigned-contracts), auto-docs, portal/approvals
- apps/api/src/lib: signing/*, soft-gate.ts, contract-access.ts, document-erasure.ts, document-versions.ts, notifications/catalog.ts, notifier.ts, email.ts
- apps/api/src/pipeline: executed-copy.ts, automatic-contract-analysis.ts, reconciliation.ts, document-comparison.ts, text-extraction.ts
- packages/db/migrations/0181_partial-signing.sql (uncommitted); packages/shared/src/start-blank.ts, activity.ts
- messages/en-US.json
- e2e/tests: 14-m8-demo, 16-m10-demo, 17-m11-demo, 20-m14-demo, 21-m15-demo, 22-m16-demo, 23-m17-demo, 38-m31-demo, 39-m32-demo, 39-m32-text-compare, 41-contract-status-menu, 48-contract-default-people, 59-m37-answer-style, 59-ai-prompt-format, 62-m43-approval-email, 1171 to 1177 envelope specs

### Matters

- CONTEXT.md
- docs/UX-REVIEW-CHECKLIST.md (Matters, Matter record, Organization > Matters, shared sections)
- docs/decision-records/DECISIONS-MATTERS.md (MTR-001 to MTR-018 and addenda)
- docs/decision-records/DECISIONS.md (DD-014, DD-023, DD-024, DD-026, DD-028)
- apps/web/src/routes/matters.tsx, matter-record.tsx, home-tasks.tsx, portal-matters.tsx, portal-matter.tsx, portal-request.tsx, inbox-request.tsx
- apps/web/src/routes/settings-matter-types.tsx, settings-matter-type-editor.tsx, settings-matter-statuses.tsx, settings-matter-templates.tsx, settings-matter-template-editor.tsx, settings-contract-fields.tsx, settings-document-types.tsx
- apps/web/src/components/matters/_, components/tasks/_, components/documents/_, components/comments/_, components/activity/activity-applet.tsx, components/type-form/_, components/portal/_, components/table/_, components/intake/convert-dialog.tsx, components/record-team-applet.tsx, components/confidential-_.tsx, components/key-date-reminder-fields.tsx, components/home/*
- apps/api/src/modules/matters, matter-tasks, matter-key-dates, matter-relations, matter-types, matter-statuses, matter-templates, contract-matters, fields, document-types, portal (matters.ts, applets.ts, record-work.ts), requests/convert.ts
- apps/api/src/lib/matter-team.ts, matter-access.ts, notifications/catalog.ts
- e2e/tests/29-m22-demo, 30-m23-demo, 31-m24-demo, 43-portal-record-lists, 44-portal-applets, 45-portal-documents, 61-m39-type-form

### Documents and Knowledge

- `CONTEXT.md`
- `docs/UX-REVIEW-CHECKLIST.md`, sections Documents, Document comparison, Knowledge, Knowledge item, Organization Knowledge Types, Portal knowledge item, Documents in record creation forms, Shared document reader, uploads, and folders
- `docs/decision-records/DECISIONS-DOCUMENTS.md`, DOC-001 to DOC-015 and addenda
- `docs/decision-records/DECISIONS-KNOWLEDGE.md`, KNW-001 to KNW-005
- `docs/decision-records/DECISIONS.md`, DD-014 Administrator amendment
- `apps/web/src/routes/documents.tsx`, `document-compare.tsx`, `knowledge.tsx`, `knowledge-record.tsx`, `portal-knowledge.tsx`, `settings-document-types.tsx`, `settings-knowledge-types.tsx`
- `apps/web/src/components/documents/`: `documents-card.tsx`, `bulk-document-actions.tsx`, `batch-dialog.tsx`, `create-attachments.tsx`, `doc-panel.tsx`, `pdf-preview.tsx`, `email-preview.tsx`, `document-filter-bar.tsx`, `documents-columns.tsx`, `document-drop-folders.tsx`
- `apps/web/src/components/knowledge/knowledge-columns.tsx`, `apps/web/src/components/portal/documents-section.tsx`, `deflection-panel.tsx`, `apps/web/src/components/taxonomy-types-pane.tsx`
- `apps/web/src/lib/documents.ts`, `batch-upload.ts`, `notifications.ts`, `roles.ts`
- `apps/api/src/modules/documents/routes.ts`, `upload-service.ts`, `folders.ts`; `apps/api/src/modules/knowledge/routes.ts`, `service.ts`; `apps/api/src/modules/intake-links/routes.ts`; `apps/api/src/modules/portal/routes.ts`
- `apps/api/src/lib/document-erasure.ts`, `document-versions.ts`, `uploads.ts`, `contract-access.ts`, `doc-engine/engine.ts`, `notifications/notifier.ts`, `notifications/catalog.ts`
- `apps/api/src/pipeline/document-comparison.ts`, `executed-copy.ts`
- `packages/db/src/schema/` foreign keys on `document_versions`
- Uncommitted working-tree diff on `dev` for version deletion and partial signing
- Browser journeys: `e2e/tests/18-m12-demo`, `35-m28-demo`, `39-m32-demo`, `39-m32-text-compare`, `45-portal-documents`; titles only for `17-m11-demo`, `19-m13-demo`, `33-m26-demo`

### Entities

- CONTEXT.md
- docs/UX-REVIEW-CHECKLIST.md (Entities, Entity record, Organization Entities)
- docs/decision-records/DECISIONS-ENTITIES.md (ENT-001 to ENT-011)
- docs/decision-records/DECISIONS-DESIGN.md (DES-088)
- docs/decision-records/DECISIONS.md (DD-014 amendment of 10 September 2026)
- apps/web/src/routes/entities.tsx
- apps/web/src/routes/entity-record.tsx
- apps/web/src/routes/settings-entity-types.tsx, settings-entity-type-editor.tsx, settings-officer-roles.tsx, settings-contract-fields.tsx, settings-document-types.tsx
- apps/web/src/components/entities/* (officers-card, officer-name-input, registrations-card, share-capital-card, entity-fields-card, entity-grants-dialog, ownership-card, share-register-tab, share-classes-dialog, share-entry-dialog, obligations-panel, linked-records-table, entities-columns, entity-filter-definitions, entity-chart, entity-chart-export-dialog, entity-chart-export-model)
- apps/web/src/components/type-editor-sections.tsx, type-form/builder.tsx, currencies-settings-card.tsx, home/obligations-card.tsx, documents/documents-card.tsx
- apps/web/src/router.tsx
- apps/api/src/modules/entities/routes.ts, grant-routes.ts, record-routes.ts, holding-routes.ts, share-register-routes.ts, obligation-routes.ts
- apps/api/src/lib/entity-access.ts, share-register.ts, portal-entities.ts, activity.ts
- apps/api/src/pipeline/morning-round.ts, apps/api/src/lib/notifications/notifier.ts and catalog.ts
- apps/api/src/modules/home/sections/obligations.ts
- e2e/tests/13-m7-demo.spec.ts, 34-m27-demo.spec.ts, 47-portal-entities.spec.ts, 58-m36-share-register.spec.ts

### Auto-Docs

- `CONTEXT.md`, Auto-Docs section
- `docs/decision-records/DECISIONS-AUTO-DOCS.md`, ADO-001 to ADO-013 and addenda
- `docs/decision-records/DECISIONS.md`, DD-022
- `docs/UX-REVIEW-CHECKLIST.md`, no Auto-Doc coverage
- `apps/web/src/routes/auto-docs.tsx`, `auto-doc-record.tsx`, `auto-doc-generate.tsx`, `auto-doc-generation.tsx`, `portal-auto-docs.tsx`, `settings-auto-docs.tsx`, `inbox.tsx`, `settings.tsx`, `router.tsx`
- `apps/web/src/components/auto-docs/*.tsx`
- `apps/web/src/components/unassigned-contracts.tsx`, `components/inbox/contract-assignment-dialog.tsx`, `components/inbox/unassigned-contracts-columns.tsx`
- `apps/web/src/components/shell/destinations.ts`, `components/portal/portal-nav.tsx`, `routes/portal-onboarding.tsx`
- `apps/web/src/lib/auto-docs.ts`, `lib/notifications.ts`, `lib/activity.ts`
- `apps/api/src/modules/auto-docs/routes.ts`, `forms.ts`, `generations.ts`, `contract-destination.ts`, `create-contract.ts`, `assignment.ts`, `filings.ts`, `filed-document.ts`, `portal-policy.ts`, `erasure.ts`
- `apps/api/src/modules/portal/auto-docs.ts`
- `apps/api/src/lib/auto-doc-template.ts`, `lib/docx-package.ts`
- `apps/api/src/pipeline/generation-delivery.ts`
- `apps/api/src/lib/notifications/generation-template.ts`, `notifier.ts`, `email.ts`
- `e2e/tests/49-auto-doc-editor.spec.ts` through `57-auto-doc-demo.spec.ts`

### Authentication, shell, Home, Search, notifications and Settings

- `CONTEXT.md`
- `docs/UX-REVIEW-CHECKLIST.md`
- `docs/decision-records/DECISIONS-SETTINGS.md` (SET-001 to SET-014)
- `docs/decision-records/DECISIONS-NOTIFICATIONS.md` (NOT-001 to NOT-010)
- `docs/decision-records/DECISIONS-DESIGN.md` (DES-001, DES-002, DES-010, DES-011)
- `apps/web/src/router.tsx`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/keyboard.ts`, `apps/web/src/lib/recent-searches.ts`, `apps/web/src/lib/roles.ts`, `apps/web/src/lib/help-topics.ts`
- `apps/web/src/routes/`: `setup`, `login`, `two-factor`, `two-factor-enroll`, `set-password`, `link-expired`, `welcome`, `auth-layout`, `error-page`, `not-found`, `help`, `home`, `home-tasks`, `search`, `settings`, `settings-general`, `settings-users`, `settings-departments`, `settings-regions`, `settings-authentication`, `settings-audit-log`, `settings-tool-calls`, `settings-email`, `settings-ai-analysis`, `settings-e-signature`, `settings-advanced`, `settings-profile`, `settings-app-view`, `settings-appearance`, `settings-notifications`, `settings-reminders`, `settings-api-keys`, `portal-onboarding`, `portal-settings`
- `apps/web/src/components/`: `shell/*`, `home/*`, `search/*`, `table/*`, `notification-bell.tsx`, `notification-preferences.tsx`, `notification-devices.tsx`, `my-reminder-lead-times.tsx`, `authentication-options.tsx`, `smtp-settings-fields.tsx`, `currencies-settings-card.tsx`, `currency-select.tsx`, `taxonomy-types-pane.tsx`, `two-factor.tsx`, `magic-link-request.tsx`, `ai-*.tsx`, `documentation/help-link.tsx`
- `apps/api/src/auth/instance.ts`, `apps/api/src/auth/limits.ts`, `apps/api/src/auth/authentication-policy.ts`
- `apps/api/src/modules/`: `auth` tests and routes, `users/routes.ts`, `onboarding/routes.ts`, `email-settings/routes.ts`, `home/sections/*`, `notifications`, `lib/notifications/catalog.ts`, `lib/notifications/email.ts`
- `packages/db/src/schema/activity.ts`
- `messages/en-US.json`
- `e2e/tests/`: `00-m33-demo`, `01-bootstrap`, `02-password-sign-in`, `03-invite-activation-totp`, `04-magic-link`, `05-app-shell`, `06-theme`, `07-mobile-shell`, `08-accessibility`, `10-settings`, `11-m5-demo`, `59-m38-device-notifications`, `62-m44-close`, `62-m43-approval-email`
