# Set up your account and sign in

Use these steps for an Administrator or Legal Team Member account. Ask your Administrator for the OpenLaw address and an invitation. Business Users should follow [Sign in to the Business Portal](portal-sign-in.md).

## Accept a password invitation

1. Open your invitation email and follow its set-password link.
2. Enter **New password** with at least eight characters.
3. Enter the same value in **Confirm password**.
4. Select **Set password**.
5. Wait for **Password set**, then select **Sign in**.
6. Enter your **Email** and **Password**, then select **Sign in**.

Check your name in the header. Your role and record access determine the work you can open. An Administrator may first see organization setup if it is unfinished.

If the passwords do not match, correct them and try again. If the link has expired, was already used, or is missing part of its address, ask the Administrator for a fresh invitation. A successful activation consumes the invitation link. Use the sign-in page for later visits.

## Use your organization's sign-in method

If the page offers **Continue with single sign-on**, select it and complete your organization's identity-provider sign-in. Ask your Administrator about a failed sign-in or an account that has not been allowed access. If the page says **Single sign-on is not configured yet**, no identity provider is connected. Ask your Administrator which method to use.

**Administrator sign-in** opens the password form when single sign-on is the main method. Only an Administrator can sign in with a password in that mode. A Legal Team Member who tries it sees **Password sign-in is disabled while single sign-on is required.** and must use the single sign-on method instead.

If **Email me a sign-in link** is available, you can request a link with your work email. Follow the newest email within five minutes. It works once. This option depends on the organization's authentication settings and email delivery.

## Turn on two-factor authentication

Use this section after password sign-in. You need your current password and an authenticator app that supports six-digit codes.

1. Open your name menu in the header and select **Settings**.
2. Open **Profile** under **Personal**.
3. In **Password & two-factor**, select **Turn on two-factor**.
4. Enter **Password**, then select **Continue**.
5. Scan the QR code with your authenticator app, or enter the displayed secret manually in that app.
6. Enter the app's current code in **Code**, then select **Confirm**.
7. Save the backup codes somewhere you can reach if you lose the authenticator. Each code works once, and this screen shows them only now.
8. Select **Done**.

Check that Profile says two-factor is on. Enrollment takes effect after you confirm a valid code. It adds a challenge to password sign-in. Your identity provider controls any challenge during single sign-on.

## Sign in with a second factor

1. Sign in with your email and password.
2. On **Two-factor authentication**, enter the current **Code** from your authenticator.
3. Select **Verify**.

If you cannot use the authenticator, select **Use a backup code**, enter an unused **Backup code**, and select **Verify**. A code that already worked cannot be reused.

For a wrong code, check that you used the current code for this OpenLaw account and try again. Restart sign-in if the challenge no longer works. Follow any wait time shown after repeated failures. If you have neither your authenticator nor an unused backup code, contact your Administrator.

To replace the authenticator while signed in, open Profile and select **Re-enroll**. Confirm your password, complete the new enrollment, and keep the new backup codes. **Turn off two-factor** also requires your password and removes the extra challenge from password sign-in.

## End or recover a session

Open your name menu and select **Sign out** to end the current session. To end sessions on other devices while keeping this one, use **Settings** → **Profile** → **Sign out other devices**.

If an expired or revoked session sends you to sign-in, sign in again with the configured method. If access still fails, ask the Administrator to check your account. For an incorrect password, check the email and password you entered. Ask for help if you cannot recover access; the sign-in page does not offer a password-reset form.
