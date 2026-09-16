// V-C01 staff-sign-in: followed from docs/user-guides/staff-sign-in.md for Administrator and Legal Team Member.
// Each role uses a newly invited "DOC-029 access" account so seeded accounts keep their sign-in state.
import {
  BASE,
  SEED,
  api,
  freshStep,
  mailSince,
  newContext,
  passwordSignIn,
  sleep,
  sql,
  text,
  totp,
  waitForLink,
} from "./lib-r1.mjs";

const A = "staff-sign-in";

async function openSettingsProfile(page, displayName) {
  await page.getByRole("button", { name: displayName, exact: true }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await page.waitForURL(/\/settings/);
  const nav = page.getByRole("navigation").filter({ hasText: "Personal" });
  await (
    (await nav.count())
      ? nav.getByRole("link", { name: "Profile", exact: true })
      : page.getByRole("link", { name: "Profile", exact: true })
  )
    .first()
    .click();
  await page.waitForURL(/\/settings\/profile/);
  await page.getByText("Password & two-factor").waitFor();
}

async function signOutViaMenu(page, displayName) {
  await page.getByRole("button", { name: displayName, exact: true }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL(/\/auth\/login/, { timeout: 20000 });
}

async function fillLogin(page, email, password) {
  if (!/\/auth\/login/.test(page.url())) await page.goto(`${BASE}/auth/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

async function enroll(page, password) {
  await page.getByRole("button", { name: "Turn on two-factor" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Password").fill(password);
  await dialog.getByRole("button", { name: "Continue" }).click();
  await dialog.getByText("No camera? Enter this secret manually").waitFor({ timeout: 15000 });
  const qr = await dialog.locator("svg").count();
  const secret = (await text(dialog.getByText("No camera? Enter this secret manually")))
    .split(":")
    .pop()
    .trim();
  return { dialog, secret, qr };
}

export async function run(log, fx) {
  const admin = await passwordSignIn(SEED.daniel.email);
  const stamp = Date.now();
  for (const role of ["administrator", "legal_team_member"]) {
    const short = role === "administrator" ? "admin" : "member";
    const email = `doc029.access.${short}.${stamp}@helix.example`;
    const displayName = `DOC-029 access ${role === "administrator" ? "Administrator" : "Legal Team Member"} ${stamp % 100000}`;
    const pw1 = `Doc029-${short}-first-${stamp}`;
    const pw2 = `Doc029-${short}-reset-${stamp}`;
    fx.accounts[role] = { email, displayName, password: pw1 };
    const R = (step, expected, actual, pass) => log.record(A, role, step, expected, actual, pass);

    // Fixture: the Administrator invites the account (Settings > Users is covered by another guide).
    let since = Date.now();
    const inv = await api(admin.page, "POST", "/auth/invites", { email, displayName, role });
    const mail1 = await waitForLink(email, since, { subjectRe: /password/i });
    const userId = inv.body?.user?.id;
    fx.accounts[role].userId = userId;
    R(
      "fixture: invitation email arrives",
      "An invitation email with a set-password link",
      `API ${inv.status}; subject "${mail1?.subject}"; link present ${!!mail1?.link}`,
      inv.status === 201 && !!mail1?.link,
    );

    // Negative: expired link. Setup expires this account's token in the lab database.
    sql(
      `update verifications set expires_at = now() - interval '1 minute' where value = '${userId}'`,
    );
    const inv1 = await newContext();
    await inv1.page.goto(mail1.link);
    await inv1.page.getByLabel("New password").fill(pw1);
    await inv1.page.getByLabel("Confirm password").fill(pw1);
    await inv1.page.getByRole("button", { name: "Set password" }).click();
    const expiredMsg = inv1.page.getByText(
      "This link has expired or was already used. Ask for a new one.",
    );
    const expiredSeen = await expiredMsg.waitFor({ timeout: 10000 }).then(
      () => true,
      () => false,
    );
    R(
      "expired invitation link refused",
      "Expired link is refused; ask the Administrator for a fresh invitation",
      expiredSeen
        ? "Shown: This link has expired or was already used. Ask for a new one."
        : `Not shown; page: ${(await text(inv1.page.locator("main, body").first())).slice(0, 200)}`,
      expiredSeen,
    );

    // Negative: link missing part of its address.
    await inv1.page.goto(`${BASE}/auth/set-password`);
    const missing = await inv1.page
      .getByText("This link is not valid. Ask for a new invitation or password reset.")
      .waitFor({ timeout: 10000 })
      .then(
        () => true,
        () => false,
      );
    R(
      "invitation link without its token refused",
      "A link missing part of its address is refused",
      missing
        ? "Shown: This link is not valid. Ask for a new invitation or password reset."
        : "Not shown",
      missing,
    );

    // Fresh invitation (Administrator re-sends).
    since = Date.now();
    const resend = await api(admin.page, "POST", "/auth/invites", { email, displayName, role });
    const mail2 = await waitForLink(email, since, { subjectRe: /password/i });
    R(
      "fixture: Administrator sends a fresh invitation",
      "A new set-password email",
      `API ${resend.status}; subject "${mail2?.subject}"`,
      resend.status === 200 && !!mail2?.link,
    );

    // Steps 1-4 with a mismatch first.
    await inv1.page.goto(mail2.link);
    await inv1.page.getByLabel("New password").fill(pw1);
    await inv1.page.getByLabel("Confirm password").fill(pw1 + "x");
    await inv1.page.getByRole("button", { name: "Set password" }).click();
    const mismatch = await inv1.page
      .getByText("The passwords do not match.")
      .waitFor({ timeout: 8000 })
      .then(
        () => true,
        () => false,
      );
    R(
      "passwords that do not match are refused",
      "Mismatch is refused; correct and retry",
      mismatch ? "Shown: The passwords do not match." : "Not shown",
      mismatch,
    );
    await inv1.page.getByLabel("Confirm password").fill(pw1);
    await inv1.page.getByRole("button", { name: "Set password" }).click();
    const setOk = await inv1.page
      .getByText("Password set")
      .waitFor({ timeout: 15000 })
      .then(
        () => true,
        () => false,
      );
    const signInLink = inv1.page
      .getByRole("link", { name: "Sign in" })
      .or(inv1.page.getByRole("button", { name: "Sign in" }));
    const hasSignIn = setOk && (await signInLink.count()) > 0;
    R(
      "steps 1-5: set password, Password set, Sign in",
      "Password set appears with Sign in",
      `Password set ${setOk}; Sign in control ${hasSignIn}`,
      setOk && hasSignIn,
    );
    await signInLink.first().click();
    await inv1.page.waitForURL(/\/auth\/login/, { timeout: 15000 });

    // Step 6 with a wrong password first.
    await fillLogin(inv1.page, email, pw1 + "wrong");
    const wrongPw = await inv1.page
      .getByText("Check your email and password.")
      .waitFor({ timeout: 10000 })
      .then(
        () => true,
        () => false,
      );
    R(
      "incorrect password refused",
      "Wrong password is refused",
      wrongPw ? "Shown: Check your email and password." : "Not shown",
      wrongPw,
    );
    await fillLogin(inv1.page, email, pw1);
    await inv1.page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 20000 });
    const nameBtn = await inv1.page
      .getByRole("button", { name: displayName, exact: true })
      .waitFor({ timeout: 15000 })
      .then(
        () => true,
        () => false,
      );
    R(
      "step 6: sign in reaches the app with your name in the header",
      "Home opens; name menu shows the account name",
      `URL ${new URL(inv1.page.url()).pathname}; header name menu "${displayName}" ${nameBtn}`,
      nameBtn,
    );

    // Consumed link.
    const used = await newContext();
    await used.page.goto(mail2.link);
    await used.page.getByLabel("New password").fill(pw2);
    await used.page.getByLabel("Confirm password").fill(pw2);
    await used.page.getByRole("button", { name: "Set password" }).click();
    const usedRefused = await used.page
      .getByText("This link has expired or was already used. Ask for a new one.")
      .waitFor({ timeout: 10000 })
      .then(
        () => true,
        () => false,
      );
    R(
      "activation consumed the invitation link",
      "The used link is refused",
      usedRefused
        ? "Reopened link refused with the expired-or-used message"
        : "Reused link was not refused",
      usedRefused,
    );
    await used.context.close();

    // Turn on two-factor, steps 1-8.
    const page = inv1.page;
    await openSettingsProfile(page, displayName);
    const off0 = await page.getByText("Two-factor is off").count();
    const { dialog, secret, qr } = await enroll(page, pw1);
    await dialog.getByLabel("Code").fill("000000" === totp(secret) ? "111111" : "000000");
    await dialog.getByRole("button", { name: "Confirm" }).click();
    const enrollWrong = await dialog
      .getByText("Wrong code. Scan the QR code again and retry.")
      .waitFor({ timeout: 8000 })
      .then(
        () => true,
        () => false,
      );
    await freshStep();
    await dialog.getByLabel("Code").fill(totp(secret));
    await dialog.getByRole("button", { name: "Confirm" }).click();
    await dialog.getByText("Save these backup codes").waitFor({ timeout: 15000 });
    const dialogText = await text(dialog);
    const codes = [...new Set(dialogText.match(/\b[A-Za-z0-9]{5}-[A-Za-z0-9]{5}\b/g) ?? [])];
    await dialog.getByRole("button", { name: "Done" }).click();
    await dialog.waitFor({ state: "hidden" });
    const onMsg = await page
      .getByText("Two-factor is on")
      .waitFor({ timeout: 10000 })
      .then(
        () => true,
        () => false,
      );
    const reBtn =
      (await page.getByRole("button", { name: "Re-enroll" }).count()) > 0 &&
      (await page.getByRole("button", { name: "Turn off two-factor" }).count()) > 0;
    R(
      "Turn on two-factor steps 1-8 from Settings > Profile",
      "Password, QR code with manual secret, Code and Confirm, backup codes shown once, Done; Profile says two-factor is on",
      `Profile said off before: ${off0 > 0}; QR svg ${qr > 0}; manual secret shown ${secret.length >= 16}; wrong enrollment code refused ${enrollWrong}; backup codes shown ${codes.length}; Profile after Done: on ${onMsg}, Re-enroll and Turn off two-factor ${reBtn}`,
      off0 > 0 &&
        qr > 0 &&
        secret.length >= 16 &&
        enrollWrong &&
        codes.length === 10 &&
        onMsg &&
        reBtn,
    );

    // Sign in with a second factor.
    await signOutViaMenu(page, displayName);
    await fillLogin(page, email, pw1);
    await page.waitForURL(/\/auth\/two-factor/, { timeout: 15000 });
    const chTitle = await page.getByText("Two-factor authentication").first().isVisible();
    await page
      .getByLabel("Code")
      .fill(String((Number(totp(secret)) + 500000) % 1000000).padStart(6, "0"));
    await page.getByRole("button", { name: "Verify" }).click();
    const chWrong = await page
      .getByText("Wrong code. Try again, or restart sign-in.")
      .waitFor({ timeout: 10000 })
      .then(
        () => true,
        () => false,
      );
    await freshStep();
    await page.getByLabel("Code").fill(totp(secret));
    await page.getByRole("button", { name: "Verify" }).click();
    const chOk = await page
      .waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 20000 })
      .then(
        () => true,
        () => false,
      );
    R(
      "second factor: wrong code refused, current code accepted",
      "Challenge after password; wrong code refused; current code with Verify signs in",
      `Challenge page ${chTitle}; wrong code message ${chWrong}; after current code URL ${new URL(page.url()).pathname}`,
      chTitle && chWrong && chOk,
    );

    await signOutViaMenu(page, displayName);
    await fillLogin(page, email, pw1);
    await page.waitForURL(/\/auth\/two-factor/, { timeout: 15000 });
    await page.getByRole("button", { name: "Use a backup code" }).click();
    await page.getByLabel("Backup code").fill(codes[0]);
    await page.getByRole("button", { name: "Verify" }).click();
    const bOk = await page
      .waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 20000 })
      .then(
        () => true,
        () => false,
      );
    await signOutViaMenu(page, displayName);
    await fillLogin(page, email, pw1);
    await page.waitForURL(/\/auth\/two-factor/, { timeout: 15000 });
    await page.getByRole("button", { name: "Use a backup code" }).click();
    await page.getByLabel("Backup code").fill(codes[0]);
    await page.getByRole("button", { name: "Verify" }).click();
    await sleep(2500);
    const bReplay = /\/auth\/two-factor/.test(page.url());
    const bReplayMsg = await text(page.locator("main, body").first());
    R(
      "backup code works once; reuse refused",
      "Unused backup code signs in; the same code cannot be reused",
      `First use reached app ${bOk}; replay stayed on challenge ${bReplay} (${bReplayMsg.slice(0, 120)})`,
      bOk && bReplay,
    );

    // Sign out from the challenge page.
    await page.getByRole("button", { name: "Sign out" }).click();
    const chSignOut = await page.waitForURL(/\/auth\/login/, { timeout: 15000 }).then(
      () => true,
      () => false,
    );
    await page.goto(`${BASE}/`);
    await sleep(1500);
    const stillOut = /\/auth\//.test(page.url());
    R(
      "Sign out on the challenge page restarts sign-in",
      "Sign out on Two-factor authentication returns to sign-in",
      `Returned to ${new URL(page.url()).pathname}; opening / stays signed out ${stillOut}`,
      chSignOut && stillOut,
    );

    // Two devices: Sign out other devices.
    const signInWith2fa = async (p) => {
      await fillLogin(p, email, pw1);
      await p.waitForURL(/\/auth\/two-factor/, { timeout: 15000 });
      await freshStep();
      await p.getByLabel("Code").fill(totp(secret));
      await p.getByRole("button", { name: "Verify" }).click();
      await p.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 20000 });
    };
    await signInWith2fa(page);
    await sleep(31000); // a TOTP code works once per step window
    const other = await newContext();
    await other.page.goto(`${BASE}/auth/login`);
    await signInWith2fa(other.page);
    await openSettingsProfile(page, displayName);
    await page.getByRole("button", { name: "Sign out other devices" }).click();
    await sleep(2500);
    await other.page.reload();
    const otherOut = await other.page.waitForURL(/\/auth\/login/, { timeout: 15000 }).then(
      () => true,
      () => false,
    );
    await page.reload();
    await sleep(1500);
    const thisIn = /\/settings\/profile/.test(page.url());
    R(
      "Sign out other devices; revoked session returns to sign-in",
      "Other device goes to sign-in; this session stays",
      `Other device reload -> ${new URL(other.page.url()).pathname}; this device -> ${new URL(page.url()).pathname}`,
      otherOut && thisIn,
    );
    await other.context.close();

    // Re-enroll, abandon before confirming.
    await page.getByRole("button", { name: "Re-enroll" }).click();
    const d2 = page.getByRole("dialog");
    await d2.getByLabel("Password").fill(pw1);
    await d2.getByRole("button", { name: "Continue" }).click();
    await d2.getByText("No camera? Enter this secret manually").waitFor({ timeout: 15000 });
    const secret2 = (await text(d2.getByText("No camera? Enter this secret manually")))
      .split(":")
      .pop()
      .trim();
    await page.keyboard.press("Escape");
    await d2.waitFor({ state: "hidden" });
    await page.reload();
    const offAfterAbandon = await page
      .getByText("Two-factor is off")
      .waitFor({ timeout: 10000 })
      .then(
        () => true,
        () => false,
      );
    await signOutViaMenu(page, displayName);
    await fillLogin(page, email, pw1);
    const noChallenge = await page
      .waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 20000 })
      .then(
        () => true,
        () => false,
      );
    R(
      "Re-enroll turns off the old authenticator; closing before confirming leaves two-factor off",
      "New secret issued; abandoned re-enrollment leaves two-factor off",
      `New secret differs ${secret2 !== secret}; Profile off after closing ${offAfterAbandon}; password-only sign-in reached app ${noChallenge}`,
      secret2 !== secret && offAfterAbandon && noChallenge,
    );

    // Complete a re-enrollment, then Turn off two-factor (wrong password first).
    await openSettingsProfile(page, displayName);
    const e3 = await enroll(page, pw1);
    await freshStep();
    await e3.dialog.getByLabel("Code").fill(totp(e3.secret));
    await e3.dialog.getByRole("button", { name: "Confirm" }).click();
    await e3.dialog.getByText("Save these backup codes").waitFor({ timeout: 15000 });
    await e3.dialog.getByRole("button", { name: "Done" }).click();
    await page.getByRole("button", { name: "Turn off two-factor" }).click();
    const d3 = page.getByRole("dialog");
    await d3.getByLabel("Password").fill(pw1 + "nope");
    await d3.getByRole("button", { name: "Continue" }).click();
    const offWrong = await d3
      .getByText("Check your password.")
      .waitFor({ timeout: 8000 })
      .then(
        () => true,
        () => false,
      );
    await d3.getByLabel("Password").fill(pw1);
    await d3.getByRole("button", { name: "Continue" }).click();
    await d3.waitFor({ state: "hidden", timeout: 10000 });
    const offNow = await page
      .getByText("Two-factor is off")
      .waitFor({ timeout: 10000 })
      .then(
        () => true,
        () => false,
      );
    await signOutViaMenu(page, displayName);
    const backToLogin = /\/auth\/login/.test(page.url());
    await fillLogin(page, email, pw1);
    const pwOnly = await page
      .waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 20000 })
      .then(
        () => true,
        () => false,
      );
    R(
      "Turn off two-factor requires the password and removes the challenge; Sign out ends the session",
      "Wrong password refused; off after password; password-only sign-in; Sign out returns to sign-in",
      `Wrong password message ${offWrong}; Profile off ${offNow}; Sign out landed on sign-in ${backToLogin}; password-only sign-in reached app ${pwOnly}`,
      offWrong && offNow && backToLogin && pwOnly,
    );

    // Email me a sign-in link.
    await signOutViaMenu(page, displayName);
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await page.getByLabel("Email").fill(email);
    since = Date.now();
    await page.getByRole("button", { name: "Send link" }).click();
    const sent = await page
      .getByText("Check your email")
      .first()
      .waitFor({ timeout: 10000 })
      .then(
        () => true,
        () => false,
      );
    const ml = await waitForLink(email, since, { subjectRe: /Sign in/, linkRe: /magic-link/ });
    await page.goto(ml.link);
    const mlIn = await page
      .waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 20000 })
      .then(
        () => true,
        () => false,
      );
    await signOutViaMenu(page, displayName);
    await page.goto(ml.link);
    const mlExpired = await page
      .getByText("Sign-in link expired")
      .first()
      .waitFor({ timeout: 15000 })
      .then(
        () => true,
        () => false,
      );
    R(
      "Email me a sign-in link: newest email signs in once",
      "Link signs in; the same link cannot be used again",
      `Check your email ${sent}; subject "${ml?.subject}"; link signed in ${mlIn}; reuse -> ${new URL(page.url()).pathname} (Sign-in link expired ${mlExpired})`,
      sent && mlIn && mlExpired,
    );

    // Forgot password.
    await page.goto(`${BASE}/auth/login`);
    await page.getByRole("button", { name: "Set up or reset your password" }).click();
    await page.getByLabel("Email").fill(email);
    since = Date.now();
    await page.getByRole("button", { name: "Send password setup link" }).click();
    const neutral = await page
      .getByText(
        "If your email address is eligible, a password setup link is on its way. It expires in one hour.",
      )
      .waitFor({ timeout: 10000 })
      .then(
        () => true,
        () => false,
      );
    const reset = await waitForLink(email, since, { subjectRe: /password/i });
    const expiresRow = sql(
      `select round(extract(epoch from (expires_at - created_at))/60) from verifications where value = '${userId}' order by created_at desc limit 1`,
    );
    await page.goto(reset.link);
    await page.getByLabel("New password").fill(pw2);
    await page.getByLabel("Confirm password").fill(pw2);
    await page.getByRole("button", { name: "Set password" }).click();
    const resetSet = await page
      .getByText("Password set")
      .waitFor({ timeout: 15000 })
      .then(
        () => true,
        () => false,
      );
    await page.goto(`${BASE}/auth/login`);
    await fillLogin(page, email, pw1);
    const oldRefused = await page
      .getByText("Check your email and password.")
      .waitFor({ timeout: 10000 })
      .then(
        () => true,
        () => false,
      );
    await fillLogin(page, email, pw2);
    const newOk = await page
      .waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 20000 })
      .then(
        () => true,
        () => false,
      );
    fx.accounts[role].password = pw2;
    R(
      "Set up or reset your password",
      "Neutral Check your email; one-hour link sets a new password; sign-in works with it",
      `Neutral message ${neutral}; email "${reset?.subject}"; token lifetime ${expiresRow} min; Password set ${resetSet}; old password refused ${oldRefused}; new password reached app ${newOk}`,
      neutral && !!reset?.link && expiresRow === "60" && resetSet && oldRefused && newOk,
    );
    fx.contexts[role] = inv1;
  }

  // Neutral answer for an unknown address (no account): no mail.
  {
    const p = await newContext();
    const ghost = `doc029.access.nobody.${stamp}@outside-domain.example`;
    await p.page.goto(`${BASE}/auth/login`);
    await p.page.getByRole("button", { name: "Set up or reset your password" }).click();
    await p.page.getByLabel("Email").fill(ghost);
    const since = Date.now();
    await p.page.getByRole("button", { name: "Send password setup link" }).click();
    const neutral = await p.page
      .getByText("Check your email")
      .first()
      .waitFor({ timeout: 10000 })
      .then(
        () => true,
        () => false,
      );
    await sleep(5000);
    const n = (await mailSince(ghost, since)).length;
    log.record(
      A,
      "administrator",
      "Check your email does not confirm eligibility",
      "An address outside the allowed domains, with no account, gets the same neutral page and no email",
      `Neutral page ${neutral}; messages to the unknown address ${n}`,
      neutral && n === 0,
    );
    await p.context.close();
  }

  // Repeated wrong codes: the lab app runs with AUTH_RATE_LIMIT=off (lab configuration), so no wait time can appear.
  log.notRun(
    A,
    "legal_team_member",
    "repeated wrong codes show a wait time",
    "Follow any wait time shown after repeated failures",
    "Not observable: the lab app container sets AUTH_RATE_LIMIT=off, which disables the sign-in rate limiter that produces the 15-minute message. Eight wrong codes in an earlier partial run all showed Wrong code. Try again, or restart sign-in.",
  );

  // Organization method branches that need an org-wide policy change: the rendering only, with a mocked methods answer.
  {
    const policy = (legal, provider = null) => ({
      policy: {
        legal,
        business: { password: true, magicLink: true, sso: false, requireTwoFactor: false },
      },
      mode: "built_in",
      magicLinkEnabled: true,
      requireTwoFactor: false,
      emailConfigured: true,
      ssoProviderId: provider,
    });
    const probe = async (legal, provider = null) => {
      const c = await newContext();
      await c.page.route("**/api/v1/auth/methods", (route) =>
        route.fulfill({ json: policy(legal, provider) }),
      );
      await c.page.goto(`${BASE}/auth/login`);
      await c.page.getByRole("heading").first().waitFor();
      await sleep(800);
      return c;
    };
    const s = await probe(
      { password: false, magicLink: false, sso: true, requireTwoFactor: false },
      "doc029-mock-provider",
    );
    const ssoBtn = await s.page
      .getByRole("button", { name: "Continue with single sign-on" })
      .count();
    const adminBtn = await s.page.getByRole("button", { name: "Administrator sign-in" }).count();
    let adminForm = false;
    if (adminBtn) {
      await s.page.getByRole("button", { name: "Administrator sign-in" }).click();
      adminForm = (await s.page.getByLabel("Password").count()) > 0;
    }
    await s.context.close();
    const m = await probe({
      password: false,
      magicLink: true,
      sso: false,
      requireTwoFactor: false,
    });
    const mAdmin = await m.page.getByRole("button", { name: "Administrator sign-in" }).count();
    await m.context.close();
    const n = await newContext();
    await n.page.route("**/api/v1/auth/methods", (route) =>
      route.fulfill({
        json: {
          ...policy({ password: false, magicLink: false, sso: true, requireTwoFactor: false }),
          ssoProviderId: null,
        },
      }),
    );
    await n.page.goto(`${BASE}/auth/login`);
    await sleep(1500);
    const notConfigured = await text(n.page.locator("body"));
    await n.context.close();
    log.record(
      A,
      "administrator",
      "supplementary (mocked methods answer): single sign-on and Administrator sign-in controls render",
      "Continue with single sign-on and Administrator sign-in appear when staff password sign-in is off; Administrator sign-in opens the password form",
      `SSO primary: Continue with single sign-on ${ssoBtn > 0}, Administrator sign-in ${adminBtn > 0}, opens password form ${adminForm}; magic-link primary: Administrator sign-in ${mAdmin > 0}; unconfigured text present ${/Single sign-on is not configured yet/.test(notConfigured)}. Browser-side rendering only; the server policy was not changed.`,
      ssoBtn > 0 && adminBtn > 0 && adminForm && mAdmin > 0,
    );
  }
  await admin.context.close();
}
