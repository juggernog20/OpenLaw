// DOC-030 access-2 independent walkthrough: staff-sign-in (V-C01), find-your-work (V-C03),
// personal-settings (V-C05) and portal-knowledge (V-C11) on the shared work2 lab at 067c1646.
// Usage (worktree root): LAB_PASSWORD=... node docs/documentation/batches/DOC-030/access-2/walkthrough.mjs [staff] [home] [settings] [knowledge] [expired]
// Each run replaces the chosen articles' steps in walkthrough.json and keeps the others; "expired" appends a re-walk of one staff-sign-in step.
// No links, cookies, secrets, passwords or raw mail are written. Every record this script creates
// is named "DOC-030 access-2 <scenario> <timestamp>" or uses a doc030.access2.* throwaway address.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASE,
  MAIL,
  PROJECT,
  SEED,
  SEED_PASSWORD,
  TAG,
  api,
  close,
  freshStep,
  inviteAndActivate,
  mailSince,
  makeLog,
  must,
  newContext,
  pathOf,
  portalSignIn,
  seen,
  sharedBudget,
  signIn,
  sleep,
  sql,
  text,
  totp,
  waitForBudget,
  waitForLink,
  wrongCode,
} from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../..");
const STAMP = Date.now();
const log = makeLog();
const fx = { created: [], bu: null, productBugs: [] };
const sha = (b) => createHash("sha256").update(b).digest("hex");
const iso = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

// ---------- shared browser helpers ----------
async function openMenu(page, displayName) {
  await page.getByRole("button", { name: displayName, exact: true }).click();
  return page.getByRole("menu");
}
async function signOutViaMenu(page, displayName) {
  await openMenu(page, displayName);
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL(/\/auth\/login/, { timeout: 20000 });
}
async function openProfile(page, displayName) {
  await openMenu(page, displayName);
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await page.waitForURL(/\/settings/);
  const personal = page.getByRole("navigation").filter({ hasText: "Personal" }).first();
  await personal.getByRole("link", { name: "Profile", exact: true }).click();
  await page.waitForURL(/\/settings\/profile/);
  await page.getByLabel("Full name").waitFor({ timeout: 15000 });
}
async function fillLogin(page, email, password) {
  if (!/\/auth\/login/.test(page.url())) await page.goto(`${BASE}/auth/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}
const leftAuth = (page, timeout = 20000) =>
  page
    .waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout })
    .then(
      () => true,
      () => false,
    );

// A TOTP code is accepted once per 30-second step; wait for a new step before reusing a secret.
const lastStep = new Map();
async function code(secret) {
  await freshStep();
  let step = Math.floor(Date.now() / 30000);
  if (lastStep.get(secret) === step) {
    await sleep(30000 - (Date.now() % 30000) + 600);
    step = Math.floor(Date.now() / 30000);
  }
  lastStep.set(secret, step);
  return totp(secret);
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
async function confirmEnroll(page, dialog, secret) {
  await dialog.getByLabel("Code").fill(await code(secret));
  await dialog.getByRole("button", { name: "Confirm" }).click();
  await dialog.getByText("Save these backup codes").waitFor({ timeout: 15000 });
  const codes = [
    ...new Set((await text(dialog)).match(/\b[A-Za-z0-9]{5}-[A-Za-z0-9]{5}\b/g) ?? []),
  ];
  await dialog.getByRole("button", { name: "Done" }).click();
  await dialog.waitFor({ state: "hidden" });
  return codes;
}

/** The public branding answer and whether the name shows above the heading and form. */
async function brandingAbove(page, headingText) {
  const b = await fetch(`${BASE}/api/v1/org/branding`)
    .then((r) => r.json())
    .catch(() => null);
  const name = b?.name?.trim() ?? "";
  const nameLoc = page.locator("main p", { hasText: name || "OpenLaw" }).first();
  await nameLoc.waitFor({ timeout: 15000 }).catch(() => {});
  const nameBox = name ? await nameLoc.boundingBox().catch(() => null) : null;
  const headBox = await page
    .getByRole("heading", { name: headingText, exact: true })
    .first()
    .boundingBox()
    .catch(() => null);
  const formBox = await page
    .locator("form")
    .first()
    .boundingBox()
    .catch(() => null);
  const logoCount = await page.getByRole("img", { name: "Organization logo" }).count();
  const above = !!(
    nameBox &&
    headBox &&
    nameBox.y + nameBox.height <= headBox.y &&
    (!formBox || nameBox.y + nameBox.height <= formBox.y)
  );
  return {
    apiName: name,
    apiLogo: b?.logo ? "saved" : "none",
    nameShown: !!nameBox,
    above,
    logoCount,
  };
}

/** Business User context shared by the Portal checks (JIT-provisioned throwaway address). */
async function businessUser() {
  if (fx.bu) return fx.bu;
  const email = `doc030.access2.bu.${STAMP}@helix.example`;
  const c = await portalSignIn(email);
  // Fixture: finish the Portal first run through the API (Department Engineering), as a seeded Business User has.
  const dept = sql(
    `select id from departments where display_name='Engineering' and archived_at is null limit 1`,
  );
  must(
    await api(c.page, "PATCH", "/portal/onboarding/department", { departmentId: dept }),
    "onboarding department",
  );
  must(await api(c.page, "POST", "/portal/onboarding/complete", {}), "onboarding complete");
  fx.bu = { ...c, email, departmentId: dept };
  fx.created.push(
    `Business User ${email} (JIT-provisioned by a Portal sign-in link; Portal first run finished through the API with Department Engineering)`,
  );
  return fx.bu;
}

// =====================================================================================
// V-C01 staff-sign-in
// =====================================================================================
async function staffSignIn(admin) {
  const A = "staff-sign-in";
  for (const role of ["administrator", "legal_team_member"]) {
    const short = role === "administrator" ? "admin" : "member";
    const email = `doc030.access2.c01.${short}.${STAMP}@helix.example`;
    const displayName = `${TAG} V-C01 ${STAMP} ${role === "administrator" ? "Administrator" : "Legal Team Member"}`;
    const pw1 = `Doc030-${short}-first-${STAMP}`;
    const pw2 = `Doc030-${short}-reset-${STAMP}`;
    const R = (step, expected, actual, pass, page) =>
      log.record(A, role, step, expected, actual, pass, page);

    // Fixture: the seeded Administrator invites the account through the API.
    let since = Date.now();
    const inv = await api(admin.page, "POST", "/auth/invites", { email, displayName, role });
    const userId = inv.body?.user?.id;
    fx.created.push(`${role} account ${email} (${displayName})`);
    const mail1 = await waitForLink(email, since, {
      subjectRe: /password/i,
      linkRe: /set-password/,
    });
    const html1 = await (async () => {
      const list = await mailSince(email, since, /password/i);
      const m = await fetch(`${MAIL}/api/v1/message/${list[0].ID}`).then((x) => x.json());
      return (m.HTML ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    })();
    const fragment = !!mail1?.link && new URL(mail1.link).hash.startsWith("#token=");
    R(
      "Accept a password invitation, step 1: the invitation email",
      "Email Set your OpenLaw password with a Set password control; the link expires in one hour",
      `Invite API ${inv.status}; subject "${mail1?.subject}"; HTML has a Set password control ${/Set password/.test(html1)}; text says "${(mail1?.text.match(/The link expires in one hour\./) ?? ["(no expiry line)"])[0]}"; link opens /auth/set-password with the token in the URL fragment ${fragment}`,
      inv.status === 201 &&
        mail1?.subject === "Set your OpenLaw password" &&
        /Set password/.test(html1) &&
        /The link expires in one hour\./.test(mail1?.text ?? "") &&
        fragment,
      "Mailpit",
    );

    // If it does not work: an expired link. Test preparation expires this account's own token.
    sql(
      `update verifications set expires_at = now() - interval '1 minute' where value = '${userId}'`,
    );
    const c1 = await newContext();
    const p = c1.page;
    await p.goto(mail1.link);
    await p.getByLabel("New password").fill(pw1);
    await p.getByLabel("Confirm password").fill(pw1);
    await p.getByRole("button", { name: "Set password" }).click();
    const expired = await seen(
      p.getByText("This link has expired or was already used. Ask for a new one."),
    );
    R(
      "If it does not work: an expired invitation link",
      "This link has expired or was already used. Ask for a new one.",
      expired
        ? "Shown: This link has expired or was already used. Ask for a new one."
        : `Not shown: ${(await text(p.locator("main"))).slice(0, 200)}`,
      expired,
      "/auth/set-password",
    );

    // Only part of the link opened: the fragment is missing.
    await p.goto(`${BASE}/auth/set-password`);
    const partial = await seen(
      p.getByText("This link is not valid. Ask for a new invitation or password reset."),
    );
    R(
      "If it does not work: the browser opened only part of the link",
      "This link is not valid. Ask for a new invitation or password reset.",
      partial
        ? "Opening /auth/set-password without the #token fragment showed: This link is not valid. Ask for a new invitation or password reset."
        : `Not shown: ${(await text(p.locator("main"))).slice(0, 200)}`,
      partial,
      "/auth/set-password",
    );

    since = Date.now();
    const resend = await api(admin.page, "POST", "/auth/invites", { email, displayName, role });
    const mail2 = await waitForLink(email, since, {
      subjectRe: /password/i,
      linkRe: /set-password/,
    });
    R(
      "fixture: the Administrator sends a fresh invitation",
      "A new Set your OpenLaw password email",
      `Invite API ${resend.status}; subject "${mail2?.subject}"`,
      resend.status < 300 && !!mail2?.link,
      "Mailpit",
    );

    // Steps 1-5, with a mismatch first.
    await p.goto(mail2.link);
    await p.getByLabel("New password").fill(pw1);
    await p.getByLabel("Confirm password").fill(`${pw1}x`);
    await p.getByRole("button", { name: "Set password" }).click();
    const mismatch = await seen(p.getByText("The passwords do not match."));
    R(
      "If it does not work: passwords that do not match",
      "The passwords do not match.",
      mismatch ? "Shown: The passwords do not match." : "Not shown",
      mismatch,
      "/auth/set-password",
    );
    const hint = await text(p.locator("main"));
    await p.getByLabel("Confirm password").fill(pw1);
    await p.getByRole("button", { name: "Set password" }).click();
    const setOk = await seen(p.getByText("Password set", { exact: true }), 15000);
    const signInCtl = p
      .getByRole("link", { name: "Sign in", exact: true })
      .or(p.getByRole("button", { name: "Sign in", exact: true }));
    const hasSignIn = setOk && (await signInCtl.count()) > 0;
    R(
      "Accept a password invitation, steps 2-5",
      "New password (at least eight characters), Confirm password, Set password, then Password set with Sign in",
      `Form hint mentions eight characters ${/8 characters/.test(hint)}; Password set ${setOk}; Sign in control ${hasSignIn}`,
      setOk && hasSignIn,
      "/auth/set-password",
    );
    await signInCtl.first().click();
    await p.waitForURL(/\/auth\/login/, { timeout: 15000 });

    const brand = await brandingAbove(p, "Sign in");
    R(
      "Introduction: the sign-in page shows the organization's name above the form, and its logo if saved",
      "Organization name above the Sign in form; a logo only when the Administrator saved one",
      `Public branding answer name "${brand.apiName}", logo ${brand.apiLogo}; name shown ${brand.nameShown}; above the Sign in heading and form ${brand.above}; Organization logo images ${brand.logoCount}`,
      brand.apiName.length > 0 &&
        brand.nameShown &&
        brand.above &&
        (brand.apiLogo === "saved" ? brand.logoCount === 1 : brand.logoCount === 0),
      "/auth/login",
    );

    // Step 6 with a wrong password first.
    await fillLogin(p, email, `${pw1}wrong`);
    const wrongPw = await seen(p.getByText("Check your email and password."));
    await fillLogin(p, email, pw1);
    const in6 = await leftAuth(p);
    const landed = pathOf(p);
    const menu = await openMenu(p, displayName);
    const menuText = await text(menu);
    await p.keyboard.press("Escape");
    const orgName = await p
      .getByRole("banner")
      .getByText(brand.apiName, { exact: true })
      .isVisible()
      .catch(() => false);
    await p.setViewportSize({ width: 700, height: 900 });
    await sleep(500);
    const orgNarrow = await p
      .getByRole("banner")
      .getByText(brand.apiName, { exact: true })
      .isVisible()
      .catch(() => false);
    await p.setViewportSize({ width: 1440, height: 900 });
    R(
      "Accept a password invitation, step 6 and the check after it",
      "Wrong password shows Check your email and password.; Email and Password with Sign in reach the app; the name menu (photo or initials) shows name and email; a wide window shows the organization's name in the header",
      `Wrong password message ${wrongPw}; landed on ${landed} ${in6}; name menu "${menuText}"; organization name "${brand.apiName}" in the header at 1440 px ${orgName}, at 700 px ${orgNarrow}`,
      wrongPw &&
        in6 &&
        landed === "/" &&
        menuText.includes(displayName) &&
        menuText.includes(email) &&
        orgName &&
        !orgNarrow,
      "/",
    );

    const used = await newContext();
    await used.page.goto(mail2.link);
    await used.page.getByLabel("New password").fill(pw2);
    await used.page.getByLabel("Confirm password").fill(pw2);
    await used.page.getByRole("button", { name: "Set password" }).click();
    const usedRefused = await seen(
      used.page.getByText("This link has expired or was already used. Ask for a new one."),
    );
    await used.context.close();
    R(
      "A successful activation consumes the invitation link",
      "Reopening the used link shows This link has expired or was already used. Ask for a new one.",
      usedRefused
        ? "The used link was refused with the expired-or-used message"
        : "The used link was not refused",
      usedRefused,
      "/auth/set-password",
    );

    // Turn on two-factor authentication, steps 1-8.
    await openProfile(p, displayName);
    const off0 = await seen(p.getByText("Two-factor is off"), 5000);
    const e1 = await enroll(p, pw1);
    await e1.dialog.getByLabel("Code").fill(wrongCode(e1.secret));
    await e1.dialog.getByRole("button", { name: "Confirm" }).click();
    const enrollWrong = await seen(
      e1.dialog.getByText("Wrong code. Scan the QR code again and retry."),
      8000,
    );
    const codes = await confirmEnroll(p, e1.dialog, e1.secret);
    const onMsg = await seen(p.getByText("Two-factor is on"));
    R(
      "Turn on two-factor authentication, steps 1-8",
      "Settings from the name menu; Profile under Personal; Turn on two-factor; Password and Continue; QR code or manual secret; Code and Confirm; backup codes; Done; Profile says two-factor is on",
      `Profile said off before ${off0}; QR ${e1.qr > 0}; manual secret shown ${e1.secret.length >= 16}; wrong code refused ${enrollWrong}; backup codes shown ${codes.length}; after Done Profile says on ${onMsg}`,
      off0 && e1.qr > 0 && e1.secret.length >= 16 && enrollWrong && codes.length === 10 && onMsg,
      "/settings/profile",
    );

    // Sign in with a second factor.
    await signOutViaMenu(p, displayName);
    await fillLogin(p, email, pw1);
    const chOpen = await p.waitForURL(/\/auth\/two-factor/, { timeout: 15000 }).then(
      () => true,
      () => false,
    );
    const chTitle = await seen(p.getByRole("heading", { name: "Two-factor authentication" }));
    await p.getByLabel("Code").fill(wrongCode(e1.secret));
    await p.getByRole("button", { name: "Verify" }).click();
    const chWrong = await seen(p.getByText("Wrong code. Try again, or restart sign-in."));
    await p.getByLabel("Code").fill(await code(e1.secret));
    await p.getByRole("button", { name: "Verify" }).click();
    const chOk = await leftAuth(p);
    R(
      "Sign in with a second factor, steps 1-3",
      "Password sign-in opens Two-factor authentication; a wrong code shows Wrong code. Try again, or restart sign-in.; the current Code with Verify signs in",
      `Challenge ${chOpen && chTitle}; wrong code message ${chWrong}; current code reached ${pathOf(p)} ${chOk}`,
      chOpen && chTitle && chWrong && chOk,
      "/auth/two-factor",
    );

    await signOutViaMenu(p, displayName);
    await fillLogin(p, email, pw1);
    await p.waitForURL(/\/auth\/two-factor/, { timeout: 15000 });
    await p.getByRole("button", { name: "Use a backup code" }).click();
    await p.getByLabel("Backup code").fill(codes[0]);
    await p.getByRole("button", { name: "Verify" }).click();
    const bOk = await leftAuth(p);
    await signOutViaMenu(p, displayName);
    await fillLogin(p, email, pw1);
    await p.waitForURL(/\/auth\/two-factor/, { timeout: 15000 });
    await p.getByRole("button", { name: "Use a backup code" }).click();
    await p.getByLabel("Backup code").fill(codes[0]);
    await p.getByRole("button", { name: "Verify" }).click();
    const replayMsg = await seen(p.getByText("Wrong code. Try again, or restart sign-in."));
    const bReplay = /\/auth\/two-factor/.test(p.url());
    await p.getByRole("button", { name: "Sign out" }).click();
    const chOut = await p.waitForURL(/\/auth\/login/, { timeout: 15000 }).then(
      () => true,
      () => false,
    );
    await p.goto(`${BASE}/`);
    await sleep(1500);
    const stillOut = /\/auth\//.test(p.url());
    R(
      "Use a backup code once; Sign out on the challenge restarts sign-in",
      "An unused Backup code with Verify signs in; the same code cannot be reused; Sign out returns to sign-in",
      `First use reached the app ${bOk}; reuse stayed on the challenge ${bReplay} with Wrong code. Try again, or restart sign-in. ${replayMsg}; Sign out -> sign-in ${chOut}; / afterwards needs sign-in ${stillOut}`,
      bOk && bReplay && replayMsg && chOut && stillOut,
      "/auth/two-factor",
    );

    // End or recover a session: Sign out other devices.
    const signIn2fa = async (pg) => {
      await fillLogin(pg, email, pw1);
      await pg.waitForURL(/\/auth\/two-factor/, { timeout: 15000 });
      await pg.getByLabel("Code").fill(await code(e1.secret));
      await pg.getByRole("button", { name: "Verify" }).click();
      return leftAuth(pg);
    };
    await signIn2fa(p);
    const other = await newContext();
    await other.page.goto(`${BASE}/auth/login`);
    const otherIn = await signIn2fa(other.page);
    await openProfile(p, displayName);
    await p.getByRole("button", { name: "Sign out other devices" }).click();
    const sessSaved = await seen(p.getByText("Saved", { exact: true }));
    await sleep(1000);
    await other.page.reload();
    const otherOut = await other.page.waitForURL(/\/auth\/login/, { timeout: 15000 }).then(
      () => true,
      () => false,
    );
    await p.reload();
    await sleep(1500);
    const thisIn = /\/settings\/profile/.test(p.url());
    await other.context.close();
    R(
      "End or recover a session: Sign out other devices; a revoked session goes to sign-in",
      "The other browser's session ends and reload sends it to sign-in; this session stays",
      `Second browser signed in ${otherIn}; Saved ${sessSaved}; second browser reload -> sign-in ${otherOut}; this browser still on Profile ${thisIn}`,
      otherIn && otherOut && thisIn,
      "/settings/profile",
    );

    // Re-enroll: abandon before confirming.
    await p.getByRole("button", { name: "Re-enroll" }).click();
    const d2 = p.getByRole("dialog");
    await d2.getByLabel("Password").fill(pw1);
    await d2.getByRole("button", { name: "Continue" }).click();
    await d2.getByText("No camera? Enter this secret manually").waitFor({ timeout: 15000 });
    const secret2 = (await text(d2.getByText("No camera? Enter this secret manually")))
      .split(":")
      .pop()
      .trim();
    await p.keyboard.press("Escape");
    await d2.waitFor({ state: "hidden" });
    await p.reload();
    const offAfterAbandon = await seen(p.getByText("Two-factor is off"));
    await signOutViaMenu(p, displayName);
    await fillLogin(p, email, pw1);
    const noChallenge = await leftAuth(p);
    R(
      "Re-enroll turns off the old authenticator; closing before a new code leaves two-factor off",
      "A new secret; after closing the dialog Profile says two-factor is off and the password alone signs in",
      `New secret differs ${secret2 !== e1.secret}; Profile off ${offAfterAbandon}; password-only sign-in reached the app ${noChallenge}`,
      secret2 !== e1.secret && offAfterAbandon && noChallenge,
      "/settings/profile",
    );

    // Turn off two-factor needs the password.
    await openProfile(p, displayName);
    const e3 = await enroll(p, pw1);
    await confirmEnroll(p, e3.dialog, e3.secret);
    await p.getByRole("button", { name: "Turn off two-factor" }).click();
    const d3 = p.getByRole("dialog");
    await d3.getByLabel("Password").fill(`${pw1}nope`);
    await d3.getByRole("button", { name: "Continue" }).click();
    const offWrong = await seen(d3.getByText("Check your password."), 8000);
    await d3.getByLabel("Password").fill(pw1);
    await d3.getByRole("button", { name: "Continue" }).click();
    await d3.waitFor({ state: "hidden", timeout: 10000 });
    const offNow = await seen(p.getByText("Two-factor is off"));
    await signOutViaMenu(p, displayName);
    const back = /\/auth\/login/.test(p.url());
    await fillLogin(p, email, pw1);
    const pwOnly = await leftAuth(p);
    R(
      "Turn off two-factor requires the password; Sign out in the name menu ends the session",
      "A wrong password is refused; the right one turns two-factor off; password sign-in has no challenge; Sign out returns to sign-in",
      `Wrong password message Check your password. ${offWrong}; Profile off ${offNow}; Sign out -> sign-in ${back}; password-only sign-in ${pwOnly}`,
      offWrong && offNow && back && pwOnly,
      "/settings/profile",
    );

    // Email me a sign-in link, then the three-per-address budget.
    await signOutViaMenu(p, displayName);
    await waitForBudget(4);
    await p.getByRole("button", { name: "Email me a sign-in link" }).click();
    await p.getByLabel("Email").fill(email);
    since = Date.now();
    await p.getByRole("button", { name: "Send link" }).click();
    const sent1 = await seen(p.getByText("Check your email"));
    const ml1 = await waitForLink(email, since, { subjectRe: /Sign in/i, linkRe: /magic-link/ });
    const mailHtml = await (async () => {
      const list = await mailSince(email, since, /Sign in/i);
      const m = await fetch(`${MAIL}/api/v1/message/${list[0].ID}`).then((x) => x.json());
      return (m.HTML ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    })();
    await p.goto(ml1.link);
    const mlIn = await leftAuth(p);
    await signOutViaMenu(p, displayName);
    await p.goto(ml1.link);
    const expiredPage = await seen(p.getByRole("heading", { name: "Sign-in link expired" }), 15000);
    const expiredText = await text(p.locator("main"));
    R(
      "Use your organization's sign-in method: Email me a sign-in link",
      "Email, Send link, Check your email; Sign in in the newest email signs in within five minutes; the link works once, and a used link opens Sign-in link expired",
      `Check your email ${sent1}; subject "${ml1?.subject}"; email has a Sign in control ${/Sign in/.test(mailHtml)} and says 5 minutes ${/5 minutes|five minutes/i.test(ml1?.text ?? "")}; link signed in ${mlIn}; reuse opened "${expiredText.slice(0, 140)}"`,
      sent1 && mlIn && expiredPage && /Sign in/.test(mailHtml),
      "/auth/link-expired",
    );

    // On Sign-in link expired: enter the email to get a new link.
    await p.locator("main").getByLabel("Email").fill(email);
    since = Date.now();
    await p.getByRole("button", { name: "Send link" }).click();
    const sent2 = await seen(p.getByText("Check your email"));
    const ml2 = await waitForLink(email, since, { subjectRe: /Sign in/i, linkRe: /magic-link/ });
    await p.goto(ml2.link);
    const ml2In = await leftAuth(p);
    await signOutViaMenu(p, displayName);
    await p.goto(ml1.link);
    await p.getByRole("heading", { name: "Sign-in link expired" }).waitFor({ timeout: 15000 });
    const expiredControls = await p
      .locator("main")
      .locator("a, button, input")
      .evaluateAll((els) =>
        els
          .map((e) =>
            e.tagName === "INPUT" ? `input ${e.getAttribute("type")}` : e.textContent.trim(),
          )
          .filter(Boolean),
      );
    const backCtl = p
      .getByRole("link", { name: "Back to sign-in" })
      .or(p.getByRole("button", { name: "Back to sign-in" }));
    const hasBack = (await backCtl.count()) > 0;
    let backToSignIn = false;
    if (hasBack) {
      await backCtl.first().click();
      backToSignIn = await p.waitForURL(/\/auth\/login/, { timeout: 10000 }).then(
        () => true,
        () => false,
      );
    }
    R(
      "Sign-in link expired: enter your email there to get a new link, or select Back to sign-in",
      "The email field on Sign-in link expired sends a new link that signs in; a Back to sign-in control returns to the sign-in page",
      `Enter your email: Check your email ${sent2}; new email "${ml2?.subject}"; new link signed in ${ml2In}. Back to sign-in: the page's controls are [${expiredControls.join(", ")}]; Back to sign-in present ${hasBack}${hasBack ? `, returned to sign-in ${backToSignIn}` : ""}. The organization has sign-in links on, and link-expired.tsx shows Back to sign-in only when sign-in links are off or email cannot be sent.`,
      sent2 && ml2In && hasBack && backToSignIn,
      "/auth/link-expired",
    );

    // Budget: a third request is accepted, the fourth is refused.
    const requestLink = async () => {
      await p.goto(`${BASE}/auth/login`);
      await p.getByRole("button", { name: "Email me a sign-in link" }).click();
      await p.getByLabel("Email").fill(email);
      await p.getByRole("button", { name: "Send link" }).click();
      await sleep(1500);
      return text(p.locator("main"));
    };
    const third = await requestLink();
    const fourth = await requestLink();
    R(
      "Sign-in link budget: three links for one email address in 15 minutes",
      "The fourth request shows Too many sign-in link requests. Try again later.",
      `Third request: "${third.slice(0, 90)}"; fourth request: "${fourth.slice(0, 160)}"`,
      third.includes("Check your email") &&
        fourth.includes("Too many sign-in link requests. Try again later."),
      "/auth/login",
    );

    // Forgotten password: session revocation and the setup-request budget.
    const holder = await newContext();
    await holder.page.goto(`${BASE}/auth/login`);
    await fillLogin(holder.page, email, pw1);
    const holderIn = await leftAuth(holder.page);
    await p.goto(`${BASE}/auth/login`);
    await p.getByRole("button", { name: "Set up or reset your password" }).click();
    await p.getByLabel("Email").fill(email);
    since = Date.now();
    await p.getByRole("button", { name: "Send password setup link" }).click();
    const neutral = await seen(p.getByText("Check your email"));
    const reset = await waitForLink(email, since, {
      subjectRe: /password/i,
      linkRe: /set-password/,
    });
    const expiresRow = sql(
      `select round(extract(epoch from (expires_at - created_at))/60) from verifications where value = '${userId}' order by created_at desc limit 1`,
    );
    await p.goto(reset.link);
    await p.getByLabel("New password").fill(pw2);
    await p.getByLabel("Confirm password").fill(pw2);
    await p.getByRole("button", { name: "Set password" }).click();
    const resetSet = await seen(p.getByText("Password set", { exact: true }), 15000);
    await holder.page.reload();
    const holderOut = await holder.page.waitForURL(/\/auth\/login/, { timeout: 15000 }).then(
      () => true,
      () => false,
    );
    await holder.context.close();
    await p.goto(`${BASE}/auth/login`);
    await fillLogin(p, email, pw1);
    const oldRefused = await seen(p.getByText("Check your email and password."));
    await fillLogin(p, email, pw2);
    const newOk = await leftAuth(p);
    R(
      "If you forgot your password: Set up or reset your password",
      "Email and Send password setup link; Check your email; Set password in the email within one hour sets a new password; the new password signs out every session",
      `Check your email ${neutral}; email "${reset?.subject}"; token lifetime ${expiresRow} min; Password set ${resetSet}; a browser signed in before the reset was sent to sign-in on reload ${holderIn && holderOut}; old password refused ${oldRefused}; new password signed in ${newOk}`,
      neutral &&
        reset?.subject === "Set your OpenLaw password" &&
        expiresRow === "60" &&
        resetSet &&
        holderIn &&
        holderOut &&
        oldRefused &&
        newOk,
      "/auth/set-password",
    );
    await signOutViaMenu(p, displayName);
    const setupRequest = async () => {
      await p.goto(`${BASE}/auth/login`);
      await p.getByRole("button", { name: "Set up or reset your password" }).click();
      await p.getByLabel("Email").fill(email);
      await p.getByRole("button", { name: "Send password setup link" }).click();
      await sleep(1500);
      return text(p.locator("main"));
    };
    await waitForBudget(3, "password-setup");
    const s2 = await setupRequest();
    const s3 = await setupRequest();
    const s4 = await setupRequest();
    R(
      "Password setup budget: three setup emails for one email address in 15 minutes",
      "The fourth request shows Too many password setup requests. Try again later.",
      `Second: "${s2.slice(0, 60)}"; third: "${s3.slice(0, 60)}"; fourth: "${s4.slice(0, 120)}"`,
      s2.includes("Check your email") &&
        s3.includes("Check your email") &&
        s4.includes("Too many password setup requests. Try again later."),
      "/auth/login",
    );

    // Wrong passwords: a success before the limit resets the count; ten close password sign-in.
    await p.goto(`${BASE}/auth/login`);
    for (let i = 0; i < 9; i++) {
      await fillLogin(p, email, `${pw2}-wrong-${i}`);
      await p.getByText("Check your email and password.").waitFor({ timeout: 10000 });
    }
    const before = sql(
      `select count(*) from verifications where identifier = 'password-sign-in-failures:' || encode(sha256(convert_to(lower('${email}'),'UTF8')),'hex') and expires_at > now()`,
    );
    await fillLogin(p, email, pw2);
    const resetOk = await leftAuth(p);
    const after = sql(
      `select count(*) from verifications where identifier = 'password-sign-in-failures:' || encode(sha256(convert_to(lower('${email}'),'UTF8')),'hex') and expires_at > now()`,
    );
    await signOutViaMenu(p, displayName);

    // Two-factor lockout while the account has two-factor on.
    await openProfileAfterSignIn(p, email, pw2, displayName);
    const e4 = await enroll(p, pw2);
    await confirmEnroll(p, e4.dialog, e4.secret);
    await signOutViaMenu(p, displayName);
    const attempts = [];
    let locked = false;
    for (let round = 0; round < 3 && !locked; round++) {
      await fillLogin(p, email, pw2);
      await p.waitForURL(/\/auth\/two-factor/, { timeout: 15000 });
      for (let i = 0; i < 5 && !locked; i++) {
        await p.getByLabel("Code").fill(wrongCode(e4.secret));
        await p.getByRole("button", { name: "Verify" }).click();
        await sleep(1200);
        const body = await text(p.locator("main"));
        const msg = body.includes("Too many attempts. Wait 15 minutes, then try again.")
          ? "locked"
          : body.includes("Wrong code. Try again, or restart sign-in.")
            ? "wrong"
            : "other";
        attempts.push(msg);
        if (msg === "locked") locked = true;
      }
      if (!locked) {
        await p.getByRole("button", { name: "Sign out" }).click();
        await p.waitForURL(/\/auth\/login/, { timeout: 15000 });
      }
    }
    let rightRefused = false;
    if (locked) {
      await p.getByLabel("Code").fill(await code(e4.secret));
      await p.getByRole("button", { name: "Verify" }).click();
      await sleep(1500);
      rightRefused =
        (await text(p.locator("main"))).includes(
          "Too many attempts. Wait 15 minutes, then try again.",
        ) && /\/auth\/two-factor/.test(p.url());
      await p.getByRole("button", { name: "Sign out" }).click();
      await p.waitForURL(/\/auth\/login/, { timeout: 15000 });
    }
    const wrongBeforeLock = attempts.filter((a) => a === "wrong").length;
    R(
      "Sign in with a second factor: after 10 wrong codes the page shows Too many attempts",
      "Wrong codes show Wrong code. Try again, or restart sign-in.; after 10 wrong codes the page shows Too many attempts. Wait 15 minutes, then try again.",
      `Attempt messages in order (Sign out and password sign-in between rounds): ${attempts.join(", ")}; wrong-code messages before the lock ${wrongBeforeLock}; the current code during the lock was also refused ${rightRefused}`,
      locked && wrongBeforeLock === 10 && rightRefused,
      "/auth/two-factor",
    );

    // Ten wrong passwords close password sign-in for the address.
    const pwMsgs = [];
    for (let i = 0; i < 11; i++) {
      await fillLogin(p, email, `${pw2}-bad-${i}`);
      await sleep(1200);
      const body = await text(p.locator("main"));
      pwMsgs.push(
        body.includes("Too many attempts. Wait 15 minutes, then try again.")
          ? "locked"
          : body.includes("Check your email and password.")
            ? "wrong"
            : "other",
      );
    }
    await fillLogin(p, email, pw2);
    await sleep(2000);
    const correctLocked =
      /\/auth\/login/.test(p.url()) &&
      (await text(p.locator("main"))).includes(
        "Too many attempts. Wait 15 minutes, then try again.",
      );
    R(
      "End or recover a session: wrong passwords and the 15-minute lock",
      "A wrong password shows Check your email and password.; a successful sign-in before the limit resets the count; after 10 wrong passwords the page shows Too many attempts. Wait 15 minutes, then try again., even for the correct password",
      `9 wrong passwords left a live failure counter (${before} row); the correct password then signed in ${resetOk} and the counter rows became ${after}. Then 11 wrong passwords showed: ${pwMsgs.join(", ")}; the correct password afterwards stayed on sign-in with Too many attempts ${correctLocked}`,
      before === "1" &&
        resetOk &&
        after === "0" &&
        pwMsgs.slice(0, 10).every((m) => m === "wrong") &&
        pwMsgs[10] === "locked" &&
        correctLocked,
      "/auth/login",
    );
    await c1.context.close();
  }

  // Check your email does not confirm eligibility (address outside the allowed domains, no account).
  {
    const c = await newContext();
    const ghost = `doc030.access2.nobody.${STAMP}@outside-domain.example`;
    await c.page.goto(`${BASE}/auth/login`);
    await c.page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await c.page.getByLabel("Email").fill(ghost);
    let since = Date.now();
    await c.page.getByRole("button", { name: "Send link" }).click();
    const n1 = await seen(c.page.getByText("Check your email"));
    await c.page.goto(`${BASE}/auth/login`);
    await c.page.getByRole("button", { name: "Set up or reset your password" }).click();
    await c.page.getByLabel("Email").fill(ghost);
    await c.page.getByRole("button", { name: "Send password setup link" }).click();
    const n2 = await seen(c.page.getByText("Check your email"));
    await sleep(5000);
    const mails = (await mailSince(ghost, since)).length;
    log.record(
      A,
      "administrator",
      "Check your email appears whether or not the address is eligible",
      "An ineligible address gets the same Check your email page for Send link and Send password setup link, and no email",
      `Sign-in link: Check your email ${n1}; password setup: Check your email ${n2}; messages to the address ${mails}`,
      n1 && n2 && mails === 0,
      "/auth/login",
    );
    await c.context.close();
  }

  // This sign-in link could not be used: a throwaway Legal Team Member archived after requesting a link.
  {
    const email = `doc030.access2.c01.archived.${STAMP}@helix.example`;
    const acct = await inviteAndActivate(admin.page, {
      email,
      displayName: `${TAG} V-C01 ${STAMP} Archived Member`,
      role: "legal_team_member",
      password: `Doc030-archived-${STAMP}`,
    });
    fx.created.push(`legal_team_member account ${email}, archived by this walkthrough`);
    await waitForBudget(1);
    const c = await newContext();
    await c.page.goto(`${BASE}/auth/login`);
    await c.page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await c.page.getByLabel("Email").fill(email);
    const since = Date.now();
    await c.page.getByRole("button", { name: "Send link" }).click();
    const m = await waitForLink(email, since, { subjectRe: /Sign in/i, linkRe: /magic-link/ });
    const arch = await api(admin.page, "POST", `/users/${acct.userId}/archive`);
    await c.page.goto(m.link);
    await sleep(2500);
    const where = pathOf(c.page);
    const shown = await seen(
      c.page.getByText(
        "This sign-in link could not be used. Request a new link or contact your administrator.",
      ),
    );
    log.record(
      A,
      "legal_team_member",
      "If the sign-in page shows This sign-in link could not be used",
      "OpenLaw refuses the sign-in for an archived account and the sign-in page shows This sign-in link could not be used. Request a new link or contact your administrator.",
      `Link emailed ${!!m?.link}; account archived by the Administrator (API ${arch.status}) before the link was opened; the link ended on ${where}; message shown ${shown}`,
      !!m?.link && arch.status === 200 && where === "/auth/login" && shown,
      "/auth/login",
    );
    await c.context.close();
  }

  // Organization-wide method branches: browser rendering with a mocked methods answer only.
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
    const probe = async (answer) => {
      const c = await newContext();
      await c.page.route("**/api/v1/auth/methods", (route) => route.fulfill({ json: answer }));
      await c.page.goto(`${BASE}/auth/login`);
      await c.page.getByRole("heading").first().waitFor();
      await sleep(800);
      return c;
    };
    const s = await probe(
      policy(
        { password: false, magicLink: false, sso: true, requireTwoFactor: false },
        "doc030-mock-provider",
      ),
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
    const x = await newContext();
    await x.page.route("**/api/v1/auth/methods", (route) =>
      route.fulfill({
        json: policy({ password: true, magicLink: false, sso: false, requireTwoFactor: false }),
      }),
    );
    await x.page.goto(`${BASE}/auth/link-expired`);
    await x.page.getByRole("heading", { name: "Sign-in link expired" }).waitFor({ timeout: 15000 });
    const offBack = (await x.page.getByRole("link", { name: "Back to sign-in" }).count()) > 0;
    const offEmail = (await x.page.getByLabel("Email").count()) > 0;
    await x.context.close();
    log.record(
      A,
      "administrator",
      "supplementary (mocked methods answer): Sign-in link expired when sign-in links are off",
      "Observation for the author: which control Sign-in link expired shows when staff sign-in links are off",
      `With staff sign-in links off: Back to sign-in ${offBack}; Email field ${offEmail}. Browser rendering only; the server policy was not changed.`,
      offBack && !offEmail,
      "/auth/link-expired",
    );
    const n = await probe(
      policy({ password: false, magicLink: false, sso: true, requireTwoFactor: false }, null),
    );
    const notConfigured = (await text(n.page.locator("body"))).includes(
      "Single sign-on is not configured yet",
    );
    await n.context.close();
    log.record(
      A,
      "administrator",
      "supplementary (mocked methods answer): Continue with single sign-on, Single sign-on is not configured yet, Administrator sign-in",
      "The controls render as the guide names them; Administrator sign-in opens the password form",
      `Continue with single sign-on ${ssoBtn > 0}; Administrator sign-in ${adminBtn > 0}, opens the password form ${adminForm}; Single sign-on is not configured yet shown when no provider ${notConfigured}. Browser rendering only; the server policy was not changed.`,
      ssoBtn > 0 && adminBtn > 0 && adminForm && notConfigured,
      "/auth/login",
    );
  }
}

async function openProfileAfterSignIn(page, email, password, displayName) {
  await fillLogin(page, email, password);
  await leftAuth(page);
  await openProfile(page, displayName);
}

// =====================================================================================
// V-C03 find-your-work
// =====================================================================================
const ORDER = [
  "Inbox",
  "Entity obligations",
  "Approvals waiting on you",
  "Tasks assigned to you",
  "Dates approaching",
  "Your contracts",
  "Your matters",
];
async function homeSections(p) {
  await p.waitForURL(`${BASE}/`);
  await p
    .locator("main h2")
    .first()
    .waitFor({ timeout: 20000 })
    .catch(() => {});
  await sleep(1500);
  const h2 = await p.locator("main h2").evaluateAll((els) => els.map((e) => e.textContent.trim()));
  return h2.filter((t) => ORDER.includes(t));
}
const inOrder = (shown) => {
  const idx = shown.map((t) => ORDER.indexOf(t));
  return idx.every((v, i) => i === 0 || v > idx[i - 1]);
};
const nav = (p) => p.getByRole("navigation", { name: "Primary" });

async function findYourWork(admin) {
  const A = "find-your-work";
  const S = `${TAG} V-C03 ${STAMP}`;
  const users = must(await api(admin.page, "GET", "/users"), "users").users;
  const uid = (email) => users.find((u) => u.email === email)?.id;
  const nda = must(await api(admin.page, "GET", "/contract-types"), "types").contractTypes.find(
    (t) => t.displayName === "NDA",
  ).id;

  // Fixtures: a Contract with a Task for each seeded account, and a Confidential Contract.
  const home = must(
    await api(admin.page, "POST", "/contracts", {
      title: `${S} Home contract`,
      contractTypeId: nda,
      managerId: uid(SEED.daniel.email),
    }),
    "contract",
  ).contract;
  const conf = must(
    await api(admin.page, "POST", "/contracts", {
      title: `${S} confidential contract`,
      contractTypeId: nda,
      managerId: uid(SEED.daniel.email),
      isConfidential: true,
    }),
    "confidential",
  ).contract;
  fx.created.push(
    `Contract C-${home.number} ${home.title}`,
    `Confidential Contract C-${conf.number} ${conf.title}`,
  );
  const seededTask = {};
  for (const [role, email] of [
    ["administrator", SEED.daniel.email],
    ["legal_team_member", SEED.nadia.email],
  ]) {
    const title = `${S} Home task ${role}`;
    must(
      await api(admin.page, "POST", `/contracts/${home.number}/tasks`, {
        title,
        assigneeId: uid(email),
        addToTeam: true,
        dueDate: iso(-400),
      }),
      "task",
    );
    seededTask[role] = title;
  }

  // Fresh accounts: one Administrator with a Grant, one without, one Legal Team Member.
  const acct = {};
  for (const [key, role] of [
    ["admin", "administrator"],
    ["nogrant", "administrator"],
    ["member", "legal_team_member"],
  ]) {
    acct[key] = await inviteAndActivate(admin.page, {
      email: `doc030.access2.c03.${key}.${STAMP}@helix.example`,
      displayName: `${S} ${key === "admin" ? "Administrator" : key === "nogrant" ? "Administrator without Grant" : "Legal Team Member"}`,
      role,
      password: `Doc030-c03-${key}-${STAMP}`,
    });
    fx.created.push(`${role} account ${acct[key].email}`);
  }

  // Entity obligations fixtures, written by the fresh Administrator through the API.
  const fa = await signIn(acct.admin.email, acct.admin.password);
  const etype = {
    id: sql(`select id from entity_types where display_name='Other' and archived_at is null`),
  };
  const e1 = must(
    await api(fa.page, "POST", "/entities", {
      legalName: `${S} open entity`,
      entityTypeId: etype.id,
    }),
    "entity 1",
  ).entity;
  const e2 = must(
    await api(fa.page, "POST", "/entities", {
      legalName: `${S} confidential entity`,
      entityTypeId: etype.id,
    }),
    "entity 2",
  ).entity;
  must(
    await api(fa.page, "PATCH", `/entities/${e2.id}`, { isConfidential: true }),
    "confidential entity",
  );
  const ob = async (entity, label, due, assigneeId) =>
    must(
      await api(fa.page, "POST", `/entities/${entity.id}/obligations`, {
        label,
        nextDueOn: due,
        assigneeId,
      }),
      label,
    ).obligation;
  const oUn = await ob(e1, `${S} unassigned obligation`, "2001-01-01", null);
  const oMember = await ob(e1, `${S} member obligation`, "2001-01-02", acct.member.userId);
  const oNoReach = await ob(
    e2,
    `${S} unreachable-assignee obligation`,
    "2001-01-03",
    acct.nogrant.userId,
  );
  const oFuture = await ob(e1, `${S} member future obligation`, iso(20), acct.member.userId);
  fx.created.push(
    `Entities "${e1.legalName}" and Confidential "${e2.legalName}" (Grant: the fresh Administrator) with four Obligations; both Entities archived at the end`,
  );

  // Inbox fixture: a Business User submits one Request per role.
  const bu = await businessUser();
  const lq = {
    id: sql(`select id from request_types where slug='legal_question' and archived_at is null`),
  };
  const reqs = {};
  for (const role of ["administrator", "legal_team_member"]) {
    reqs[role] = must(
      await api(bu.page, "POST", "/requests", {
        requestTypeId: lq.id,
        departmentId: bu.departmentId,
        title: `${S} inbox request ${role}`,
        description: "DOC-030 access-2 fixture for the Home Inbox check.",
        urgency: "critical",
      }),
      "request",
    ).request;
    fx.created.push(`Request R-${reqs[role].number} ${reqs[role].title}`);
  }

  for (const [role, seed] of [
    ["administrator", SEED.daniel],
    ["legal_team_member", SEED.nadia],
  ]) {
    const R = (step, expected, actual, pass, page) =>
      log.record(A, role, step, expected, actual, pass, page);
    const s = role === "administrator" ? admin : await signIn(seed.email);
    const p = s.page;

    // Open work from Home, steps 1-5, and the section order.
    await nav(p).getByRole("link", { name: "Home", exact: true }).click();
    const shown = await homeSections(p);
    const homeApi = must(await api(p, "GET", "/home"), "home").sections;
    const noZero = homeApi.every((x) => x.total > 0);
    const taskRow = p
      .getByRole("region", { name: "Tasks assigned to you" })
      .getByRole("link", { name: new RegExp(seededTask[role]) });
    const taskOnCard = await taskRow.isVisible().catch(() => false);
    await taskRow.click();
    await p.waitForURL(new RegExp(`/contracts/${home.number}/tasks`), { timeout: 15000 });
    await sleep(1200);
    const head = await text(p.getByRole("region", { name: home.title }));
    const numberTitle = head.includes(`C-${home.number}`) && head.includes(home.title);
    const sections = p.getByRole("navigation", { name: "Contract sections" });
    await sections.getByRole("link", { name: "Fields" }).click();
    const fieldsOk = await p.waitForURL(new RegExp(`/contracts/${home.number}/fields`)).then(
      () => true,
      () => false,
    );
    await sections.getByRole("link", { name: "Documents" }).click();
    const docsOk = await p.waitForURL(new RegExp(`/contracts/${home.number}/documents`)).then(
      () => true,
      () => false,
    );
    await nav(p).getByRole("link", { name: "Home", exact: true }).click();
    const backHome = await p.waitForURL(`${BASE}/`).then(
      () => true,
      () => false,
    );
    R(
      "Open work from Home, steps 1-5, and the section order",
      "Home shows only sections with work, Inbox and Entity obligations first, then Approvals, Tasks, Dates, Your contracts, Your matters; a Task title opens its record; number and title show; Fields and Documents open; Home returns",
      `Sections on screen: ${shown.join(" > ")} (documented order ${inOrder(shown)}); API sections ${homeApi.map((x) => `${x.type}:${x.total}`).join(", ")} (none empty ${noZero}); fixture Task on the card ${taskOnCard}; opened C-${home.number} with number and title ${numberTitle}; Fields ${fieldsOk}; Documents ${docsOk}; Home ${backHome}`,
      inOrder(shown) &&
        shown[0] === "Inbox" &&
        noZero &&
        taskOnCard &&
        numberTitle &&
        fieldsOk &&
        docsOk &&
        backHome,
      "/",
    );

    // Inbox: New and Read Requests; View all counts both; opening a New Request makes it Read.
    const mine = reqs[role];
    const inboxTotal0 = homeApi.find((x) => x.type === "inbox")?.total ?? 0;
    const card = p.getByRole("region", { name: "Inbox" });
    const viewAll = card.getByRole("link", { name: /^View all \d+$/ });
    const viewAllLabel = await text(viewAll);
    const statusCounts = sql(
      `select string_agg(status||':'||n, ',' order by status) from (select status, count(*) n from requests where archived_at is null and status in ('new','read') group by status) x`,
    );
    await viewAll.click();
    await p.waitForURL(/\/inbox/, { timeout: 15000 });
    await sleep(2000);
    const row = p
      .locator("main")
      .getByRole("link", { name: new RegExp(mine.title) })
      .first();
    const listed = await row.isVisible().catch(() => false);
    const before = sql(`select status from requests where id='${mine.id}'`);
    await row.click();
    await p.waitForURL(new RegExp(`/inbox/${mine.number}`), { timeout: 15000 });
    await sleep(2000);
    const afterOpen = sql(`select status from requests where id='${mine.id}'`);
    await nav(p).getByRole("link", { name: "Home", exact: true }).click();
    await homeSections(p);
    const homeApi2 = must(await api(p, "GET", "/home"), "home").sections;
    const inboxTotal1 = homeApi2.find((x) => x.type === "inbox")?.total ?? 0;
    const newRead = Number(
      sql(`select count(*) from requests where archived_at is null and status in ('new','read')`),
    );
    await p
      .getByRole("region", { name: "Inbox" })
      .getByRole("link", { name: /^View all \d+$/ })
      .click();
    await p.waitForURL(/\/inbox/, { timeout: 15000 });
    await sleep(2000);
    const stillListed = await p
      .locator("main")
      .getByRole("link", { name: new RegExp(mine.title) })
      .first()
      .isVisible()
      .catch(() => false);
    R(
      "Inbox: Requests with the status New or Read; View all counts both; opening a New Request makes it Read and it stays in Inbox",
      "View all counts New and Read Requests; the fixture Request is New before an Administrator or Legal Team Member opens it and Read after; it stays in Inbox",
      `Home card "${viewAllLabel}" with New/Read in the database ${statusCounts} (API total ${inboxTotal0}); fixture R-${mine.number} listed on the Inbox list ${listed}, status ${before} before opening and ${afterOpen} after; Home Inbox total after ${inboxTotal1} against ${newRead} New or Read Requests in the database; the Read Request is still on the Inbox list ${stillListed}`,
      viewAllLabel === `View all ${inboxTotal0}` &&
        listed &&
        before === "new" &&
        afterOpen === "read" &&
        inboxTotal1 === newRead &&
        stillListed,
      "/inbox",
    );
    await nav(p).getByRole("link", { name: "Home", exact: true }).click();
    await homeSections(p);

    // Section contents that can be checked against record data.
    const me = uid(seed.email);
    const cRows = homeApi.find((x) => x.type === "contracts")?.rows ?? [];
    const mRows = homeApi.find((x) => x.type === "matters")?.rows ?? [];
    const cMgr = cRows.map((r) =>
      sql(`select manager_id from contracts where number=${r.contract?.number ?? r.number}`),
    );
    const mMgr = mRows.map((r) =>
      sql(`select manager_id from matters where number=${r.matter?.number ?? r.number}`),
    );
    const tRows = homeApi.find((x) => x.type === "tasks")?.rows ?? [];
    R(
      "Section contents: Your contracts by Owner, Your matters by Matter Manager, open Tasks",
      "Your contracts rows have you as Owner; Your matters rows have you as Matter Manager; Tasks rows are open",
      `Your contracts ${cRows.length} rows, all owned by this account ${cMgr.every((m) => m === me)}; Your matters ${mRows.length} rows, all managed by this account ${mMgr.every((m) => m === me)}; Task rows open ${tRows.every((t) => !t.isDone)}`,
      cMgr.every((m) => m === me) && mMgr.every((m) => m === me) && tRows.every((t) => !t.isDone),
      "/",
    );

    // Dates approaching.
    const datesJson = JSON.stringify(homeApi.find((x) => x.type === "dates") ?? {});
    const taskInDates =
      datesJson.includes(seededTask[role]) || datesJson.includes(`"number":${home.number}`);
    const dcard = p.getByRole("region", { name: "Dates approaching" });
    let yourDates = false;
    if (await dcard.isVisible().catch(() => false)) {
      await dcard
        .getByRole("button", { name: /^View all \d+$/ })
        .or(dcard.getByRole("link", { name: /^View all \d+$/ }))
        .first()
        .click();
      yourDates = await seen(p.getByRole("dialog").getByText("Your dates"), 8000);
      const dialogText = yourDates ? await text(p.getByRole("dialog")) : "";
      yourDates = yourDates && !dialogText.includes(seededTask[role]);
      await p.keyboard.press("Escape");
      await sleep(500);
    }
    R(
      "Task due dates do not feed Dates approaching; View all opens Your dates",
      "The fixture Task's due date is absent from Dates approaching and Your dates; View all opens Your dates",
      `Fixture Task or its Contract in Dates approaching ${taskInDates}; Your dates opened without the Task ${yourDates}`,
      !taskInDates && yourDates,
      "/",
    );

    // Keyboard navigation, the empty search list, and Help.
    await p.locator("body").click({ position: { x: 5, y: 500 } });
    await p.keyboard.press("?");
    const sheet = await seen(p.getByRole("dialog").getByText("Keyboard shortcuts"), 5000);
    await p.keyboard.press("Escape");
    const sheetClosed = await p
      .getByRole("dialog")
      .waitFor({ state: "hidden", timeout: 5000 })
      .then(
        () => true,
        () => false,
      );
    await p.getByRole("button", { name: seed.name, exact: true }).click();
    const menuOpen = await p.getByRole("menu").isVisible();
    await p.keyboard.press("Escape");
    const menuClosed = await p
      .getByRole("menu")
      .waitFor({ state: "hidden", timeout: 5000 })
      .then(
        () => true,
        () => false,
      );
    const box = p.getByRole("combobox", { name: "Search" });
    await p.locator("body").click({ position: { x: 5, y: 500 } });
    await p.keyboard.press("/");
    const focused = await box.evaluate((el) => el === document.activeElement);
    await p.keyboard.type("?/x");
    await sleep(400);
    const typed = await box.inputValue();
    const noSheet = !(await p
      .getByRole("dialog")
      .filter({ hasText: "Keyboard shortcuts" })
      .isVisible()
      .catch(() => false));
    // Record a recent search: search the Home contract title and open See all results.
    await box.fill(`${S} Home`);
    const list = p.getByRole("listbox", { name: "Search results" });
    await list.getByRole("option", { name: /See all results/ }).waitFor({ timeout: 10000 });
    await list.getByRole("option", { name: /See all results/ }).dispatchEvent("pointerdown");
    await p.waitForURL(/\/search/, { timeout: 15000 });
    await sleep(1500);
    await nav(p).getByRole("link", { name: "Home", exact: true }).click();
    await homeSections(p);
    await p.locator("body").click({ position: { x: 5, y: 500 } });
    await p.keyboard.press("/");
    await sleep(800);
    const histOpen = await list.isVisible().catch(() => false);
    const groups = histOpen
      ? await list.getByRole("group").evaluateAll((g) => g.map((x) => x.getAttribute("aria-label")))
      : [];
    const recentEntry = list.getByRole("group", { name: "Recent" }).getByRole("option").first();
    const recentLabel = histOpen ? await text(recentEntry) : "";
    const advanced =
      histOpen && (await list.getByRole("option", { name: "Advanced search…" }).count()) > 0;
    await p.keyboard.press("Escape");
    const escClosed = await list.waitFor({ state: "hidden", timeout: 5000 }).then(
      () => true,
      () => false,
    );
    await p.locator("body").click({ position: { x: 5, y: 500 } });
    await p.keyboard.press("/");
    await recentEntry.waitFor({ timeout: 5000 }).catch(() => {});
    await recentEntry.dispatchEvent("pointerdown").catch(() => {});
    const ran = await p.waitForURL(/\/search/, { timeout: 10000 }).then(
      () => true,
      () => false,
    );
    await sleep(1500);
    const ranHome = (await text(p.locator("main"))).includes(home.title);
    R(
      "Keyboard navigation: ?, Escape, / and the empty search list with Saved, Recent and Advanced search…",
      "? opens Keyboard shortcuts; Escape closes a dialog, a menu and the search list; / focuses record search; typing in a field keeps ? and /; with a recent search the empty box opens Recent (and Saved when present) and Advanced search…; selecting an entry runs that search",
      `Sheet ${sheet}, closed by Escape ${sheetClosed}; name menu ${menuOpen}, closed by Escape ${menuClosed}; / focused Search ${focused}; typed "${typed}" with no sheet ${noSheet}; after one search the empty box opened a list ${histOpen} with groups [${groups.join(", ")}], first Recent entry "${recentLabel}", Advanced search… ${advanced}; Escape closed the list ${escClosed}; selecting the Recent entry opened /search ${ran} and listed the Home contract ${ranHome}`,
      sheet &&
        sheetClosed &&
        menuOpen &&
        menuClosed &&
        focused &&
        typed === "?/x" &&
        noSheet &&
        histOpen &&
        groups.includes("Recent") &&
        advanced &&
        escClosed &&
        ran &&
        ranHome,
      "/",
    );

    await nav(p).getByRole("link", { name: "Contracts" }).focus();
    await p.keyboard.press("Tab");
    const tabMoved = await p.evaluate(() => document.activeElement?.textContent?.trim());
    await nav(p).getByRole("link", { name: "Contracts" }).focus();
    await p.keyboard.press("Enter");
    const enterOk = await p.waitForURL(/\/contracts$/, { timeout: 10000 }).then(
      () => true,
      () => false,
    );
    await p.goto(`${BASE}/`);
    await homeSections(p);
    await p.getByRole("banner").getByRole("link", { name: "Help" }).click();
    await p.waitForURL(/\/help/);
    await p.getByRole("searchbox", { name: "Search documentation" }).fill("Find your work on Home");
    await p.getByRole("searchbox", { name: "Search documentation" }).press("Enter");
    await p
      .locator("main")
      .getByRole("link", { name: "Find your work on Home" })
      .first()
      .waitFor({ timeout: 15000 })
      .catch(() => {});
    const helpText = await text(p.locator("main"));
    R(
      "Tab and Enter; Help opens product instructions and its search searches guides",
      "Tab moves focus; Enter activates a focused link; Help in the header opens guides; its search finds the guide and not records",
      `Tab moved focus to "${tabMoved}"; Enter on Contracts opened /contracts ${enterOk}; Help at ${pathOf(p)}; guide found ${helpText.includes("Find your work on Home")}; fixture Contract title in Help ${helpText.includes(home.title)}`,
      !!tabMoved &&
        enterOk &&
        helpText.includes("Find your work on Home") &&
        !helpText.includes(home.title),
      "/help",
    );

    // Unavailable records.
    const nf = {};
    for (const [pth, title, back, ref] of [
      ["/contracts/999999", "Contract not found", "Back to Contracts", "C-999999"],
      ["/matters/999999", "Matter not found", "Back to Matters", "M-999999"],
      ...(role === "legal_team_member"
        ? [
            [
              `/contracts/${conf.number}`,
              "Contract not found",
              "Back to Contracts",
              `C-${conf.number}`,
            ],
          ]
        : []),
    ]) {
      await p.goto(`${BASE}${pth}`);
      const t = await seen(p.getByText(title), 15000);
      const body = await text(p.locator("body"));
      const said = body.includes(`${ref} does not exist, or you cannot open it.`);
      const leaked = body.includes(conf.title);
      await p.getByRole("link", { name: back }).click();
      const returned = await p
        .waitForURL(new RegExp(`${back.endsWith("Contracts") ? "/contracts" : "/matters"}$`), {
          timeout: 10000,
        })
        .then(
          () => true,
          () => false,
        );
      nf[pth] = { title: t, message: said, backLink: returned, leaked };
    }
    R(
      "If a record becomes unavailable: Contract not found and Matter not found",
      "The page says the record does not exist or you cannot open it; Back to Contracts or Back to Matters returns to the list; nothing about a Confidential record leaks",
      JSON.stringify(nf).replace(/"/g, "'"),
      Object.values(nf).every((v) => v.title && v.message && v.backLink && !v.leaked),
      "/contracts/:number",
    );
    if (role !== "administrator") await s.context.close();
  }

  // Entity obligations with the fresh accounts.
  {
    const rowsOf = async (p) => {
      const card = p.getByRole("region", { name: "Entity obligations" });
      if (!(await card.isVisible().catch(() => false))) return null;
      return card
        .getByRole("listitem")
        .evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim()));
    };
    const labelIn = (rows, o) => (rows ?? []).some((r) => r.includes(o.label));
    // Administrator with a Grant on the Confidential Entity.
    await fa.page.goto(`${BASE}/`);
    const faShown = await homeSections(fa.page);
    const faRows = await rowsOf(fa.page);
    const unRow = (faRows ?? []).find((r) => r.includes(oUn.label)) ?? "";
    await fa.page
      .getByRole("region", { name: "Entity obligations" })
      .getByRole("link", { name: new RegExp(oUn.label) })
      .first()
      .click();
    const opened = await fa.page
      .waitForURL(new RegExp(`/entities/${e1.id}/obligations`), { timeout: 15000 })
      .then(
        () => true,
        () => false,
      );
    log.record(
      A,
      "administrator",
      "Entity obligations for an Administrator: Unassigned and unreachable-assignee Obligations, overdue first",
      "An Administrator with a Grant sees Unassigned Obligations and Obligations whose assignee cannot reach the (Confidential) Entity, overdue first; not an Obligation assigned to a Legal Team Member who can reach it; a row opens the Entity's Obligations",
      `Sections ${faShown.join(" > ")}; card rows: ${JSON.stringify(faRows)}; Unassigned row "${unRow}" marked Unassigned ${/Unassigned/.test(unRow)}; unreachable-assignee Obligation listed ${labelIn(faRows, oNoReach)}; member-assigned Obligation listed ${labelIn(faRows, oMember)}; row opened /entities/<id>/obligations ${opened}`,
      inOrder(faShown) &&
        faShown.indexOf("Entity obligations") <= 1 &&
        /Unassigned/.test(unRow) &&
        /Overdue/.test(unRow) &&
        labelIn(faRows, oNoReach) &&
        !labelIn(faRows, oMember) &&
        opened,
      "/",
    );
    // Administrator without a Grant, who is the unreachable Obligation's assignee.
    const fb = await signIn(acct.nogrant.email, acct.nogrant.password);
    await homeSections(fb.page);
    const fbRows = await rowsOf(fb.page);
    const danielRows = await (async () => {
      await admin.page.goto(`${BASE}/`);
      await homeSections(admin.page);
      return rowsOf(admin.page);
    })();
    log.record(
      A,
      "administrator",
      "Entity obligations: an Administrator needs a Grant to see a Confidential Entity's Obligations",
      "An Administrator without a Grant does not see the Confidential Entity's Obligation, even when assigned to it; Unassigned Obligations on open Entities still show",
      `Administrator without a Grant (the assignee): Confidential Entity Obligation listed ${labelIn(fbRows, oNoReach)}, Unassigned listed ${labelIn(fbRows, oUn)}; Daniel Okafor (no Grant): Confidential Entity Obligation listed ${labelIn(danielRows, oNoReach)}, Unassigned listed ${labelIn(danielRows, oUn)}`,
      !labelIn(fbRows, oNoReach) &&
        labelIn(fbRows, oUn) &&
        !labelIn(danielRows, oNoReach) &&
        labelIn(danielRows, oUn),
      "/",
    );
    await fb.context.close();
    // Legal Team Member: own Obligations only.
    const fm = await signIn(acct.member.email, acct.member.password);
    const fmShown = await homeSections(fm.page);
    const fmRows = await rowsOf(fm.page);
    const fmApi = must(await api(fm.page, "GET", "/home"), "home").sections.find(
      (x) => x.type === "obligations",
    );
    log.record(
      A,
      "legal_team_member",
      "Entity obligations for a Legal Team Member: open Obligations assigned to you, overdue first",
      "Only Obligations assigned to this Legal Team Member on reachable Entities, overdue first; no Unassigned rows",
      `Sections ${fmShown.join(" > ")}; card rows: ${JSON.stringify(fmRows)}; total ${fmApi?.total}; overdue member Obligation first ${(fmRows ?? [])[0]?.includes(oMember.label)}; future member Obligation listed ${labelIn(fmRows, oFuture)}; Unassigned listed ${labelIn(fmRows, oUn)}`,
      inOrder(fmShown) &&
        fmApi?.total === 2 &&
        (fmRows ?? [])[0]?.includes(oMember.label) &&
        labelIn(fmRows, oFuture) &&
        !labelIn(fmRows, oUn),
      "/",
    );
    await fm.context.close();
  }

  // Your Tasks with the fresh Administrator and Legal Team Member.
  for (const [role, key] of [
    ["administrator", "admin"],
    ["legal_team_member", "member"],
  ]) {
    const R = (step, expected, actual, pass, page) =>
      log.record(A, role, step, expected, actual, pass, page);
    const a = acct[key];
    const c = key === "admin" ? fa : await signIn(a.email, a.password);
    const p = c.page;
    await p.goto(`${BASE}/`);
    await homeSections(p);

    // The empty search list with a saved search: this fresh account runs one search in the
    // browser, and test setup saves that question as a search view through the API.
    {
      const box = p.getByRole("combobox", { name: "Search" });
      const list = p.getByRole("listbox", { name: "Search results" });
      await p.locator("body").click({ position: { x: 5, y: 500 } });
      await p.keyboard.press("/");
      await box.fill(`${S} confidential`);
      await list.getByRole("option", { name: /See all results/ }).waitFor({ timeout: 10000 });
      await list.getByRole("option", { name: /See all results/ }).dispatchEvent("pointerdown");
      await p.waitForURL(/\/search/, { timeout: 15000 });
      await sleep(1500);
      const recent = await p.evaluate(
        (id) => JSON.parse(localStorage.getItem(`openlaw.recent-searches.${id}`) ?? "[]"),
        a.userId,
      );
      const savedName = `${S} saved search ${key}`;
      const sv = await api(p, "POST", "/list-views", {
        surface: "search",
        name: savedName,
        config: { ...recent[0], words: { ...recent[0].words, all: `${S} Home` } },
        isDefault: false,
      });
      fx.created.push(`Saved search "${savedName}" for ${a.email}`);
      await nav(p).getByRole("link", { name: "Home", exact: true }).click();
      await homeSections(p);
      await p.locator("body").click({ position: { x: 5, y: 500 } });
      await p.keyboard.press("/");
      await sleep(1000);
      const groups = (await list.isVisible().catch(() => false))
        ? await list
            .getByRole("group")
            .evaluateAll((g) => g.map((x) => x.getAttribute("aria-label")))
        : [];
      const entry = list
        .getByRole("group", { name: "Saved" })
        .getByRole("option", { name: new RegExp(savedName) });
      const hasEntry = (await entry.count()) > 0;
      await entry
        .first()
        .dispatchEvent("pointerdown")
        .catch(() => {});
      const ran = await p.waitForURL(/\/search/, { timeout: 10000 }).then(
        () => true,
        () => false,
      );
      await sleep(1500);
      const ranHome = (await text(p.locator("main"))).includes(home.title);
      R(
        "Keyboard navigation: with a saved search the empty box opens Saved and Recent groups; selecting the Saved entry runs it",
        "The list has Saved and Recent groups and Advanced search…; selecting the saved search runs it at once",
        `Saved view API ${sv.status}; groups [${groups.join(", ")}]; saved entry listed ${hasEntry}; selecting it opened /search ${ran} and listed the Home contract ${ranHome}`,
        sv.status < 300 &&
          groups[0] === "Saved" &&
          groups.includes("Recent") &&
          hasEntry &&
          ran &&
          ranHome,
        "/",
      );
      await p.goto(`${BASE}/`);
      await homeSections(p);
    }

    await nav(p).getByRole("link", { name: "My Tasks" }).click();
    await p.waitForURL(/\/home\/tasks/);
    const empty = await seen(p.getByText("No open Tasks assigned to you."), 15000);
    await p.goto(`${BASE}/`);
    const sectionsNow = await homeSections(p);
    const noCard = !sectionsNow.includes("Tasks assigned to you");
    R(
      "Open all your Tasks: an empty list and an absent Home card",
      "No open Tasks assigned to you. on Your Tasks; no Tasks assigned to you card on Home",
      `Empty message ${empty}; Home sections ${sectionsNow.join(" > ") || "none"}; Tasks card absent ${noCard}`,
      empty && noCard,
      "/home/tasks",
    );
    const titles = [];
    for (let i = 0; i < 55; i++) {
      const dated = i < 53;
      const title = `${S} Task ${String(i + 1).padStart(2, "0")} ${dated ? "dated" : "undated"} ${role}`;
      const due = dated ? iso(5 + (53 - i)) : null;
      must(
        await api(admin.page, "POST", `/contracts/${home.number}/tasks`, {
          title,
          assigneeId: a.userId,
          addToTeam: true,
          dueDate: due,
        }),
        "task",
      );
      titles.push({ title, due });
    }
    fx.created.push(`55 Tasks on C-${home.number} assigned to ${a.email}`);
    await p.goto(`${BASE}/`);
    const tcard = p.getByRole("region", { name: "Tasks assigned to you" });
    await tcard.waitFor({ timeout: 15000 });
    await tcard.getByRole("link", { name: "View all 55" }).click();
    const viaViewAll = await p.waitForURL(/\/home\/tasks/).then(
      () => true,
      () => false,
    );
    await p.getByText("Your Tasks").first().waitFor();
    await sleep(1500);
    const rows = () =>
      p
        .locator("main li")
        .filter({ hasText: `${S} Task` })
        .filter({ hasText: role });
    const before = await rows().count();
    const more = p.getByRole("button", { name: "Load more Tasks" });
    const hasMore = await more.isVisible();
    await more.click();
    await sleep(2500);
    const after = await rows().count();
    const shownTitles = await rows().evaluateAll((els) =>
      els.map((e) => e.innerText.split("\n")[0].trim()),
    );
    const expected = [...titles]
      .sort((x, y) =>
        (x.due ?? "9999") < (y.due ?? "9999") ? -1 : (x.due ?? "9999") > (y.due ?? "9999") ? 1 : 0,
      )
      .map((t) => t.title);
    const idx = expected.map((t) => shownTitles.findIndex((x) => x.includes(t)));
    const ordered = idx.every((v, i) => v >= 0 && (i === 0 || v > idx[i - 1]));
    const undatedLast = shownTitles.slice(-2).every((x) => x.includes("undated"));
    R(
      "Open all your Tasks, steps 1-3: View all, Your Tasks, Load more Tasks, due-date order",
      "View all with the count opens Your Tasks; Load more Tasks adds the next page; Tasks follow due date with undated Tasks last",
      `View all 55 opened /home/tasks ${viaViewAll}; rows ${before}, then ${after} after Load more Tasks (shown ${hasMore}); due-date order ${ordered}; last two undated ${undatedLast}`,
      viaViewAll && hasMore && before === 50 && after === 55 && ordered && undatedLast,
      "/home/tasks",
    );
    const t1 = titles[52].title;
    await p.getByRole("checkbox", { name: `Complete Task: ${t1}` }).click();
    const done = await seen(p.getByText(`Completed: ${t1}`));
    await p.getByRole("button", { name: "Undo" }).click();
    await sleep(2000);
    const undone = sql(`select is_done from contract_tasks where title='${t1}'`) === "f";
    await p.getByRole("checkbox", { name: `Complete Task: ${t1}` }).click();
    await p.getByText(`Completed: ${t1}`).waitFor({ timeout: 10000 });
    await sleep(1500);
    const gone = (await p.locator("main li").filter({ hasText: t1 }).count()) === 0;
    const toggle = p
      .getByRole("switch", { name: "Show completed" })
      .or(p.getByRole("checkbox", { name: "Show completed" }));
    await toggle.first().click();
    await sleep(2500);
    const hideLabel = (await p.getByText("Hide completed").count()) > 0;
    const completedShown = (await p.locator("main li").filter({ hasText: t1 }).count()) > 0;
    await p.getByRole("checkbox", { name: `Reopen Task: ${t1}` }).click();
    const reopened = await seen(p.getByText(`Reopened: ${t1}`));
    const dbOpen = sql(`select is_done from contract_tasks where title='${t1}'`) === "f";
    await p
      .getByRole("switch", { name: "Hide completed" })
      .or(p.getByRole("checkbox", { name: "Hide completed" }))
      .first()
      .click();
    await sleep(2000);
    const showBack = (await p.getByText("Show completed").count()) > 0;
    R(
      "Your Tasks: complete, Undo, Show completed and Hide completed, reopen",
      "Completion shows Completed with Undo; Undo reopens; Show completed adds completed Tasks and the label says Hide completed; clearing a completed Task's control shows Reopened",
      `Completed ${done}; Undo reopened ${undone}; completed row left the open list ${gone}; Show completed: label Hide completed ${hideLabel}, completed row listed ${completedShown}; Reopened ${reopened}, open in the database ${dbOpen}; switch off, label Show completed ${showBack}`,
      done && undone && gone && hideLabel && completedShown && reopened && dbOpen && showBack,
      "/home/tasks",
    );
    await p
      .locator("main li")
      .filter({ hasText: titles[51].title })
      .getByRole("link")
      .first()
      .click();
    const owning = await p
      .waitForURL(new RegExp(`/contracts/${home.number}/tasks`), { timeout: 15000 })
      .then(
        () => true,
        () => false,
      );
    await nav(p).getByRole("link", { name: "Home", exact: true }).click();
    const homeBack = await p.waitForURL(`${BASE}/`).then(
      () => true,
      () => false,
    );
    R(
      "Open all your Tasks, steps 2 and 4: a Task title opens its owning record; Home returns",
      "The Task title opens the Contract; Home in the app navigation returns",
      `Opened /contracts/${home.number}/tasks ${owning}; Home ${homeBack}`,
      owning && homeBack,
      "/home/tasks",
    );
    if (key !== "admin") await c.context.close();
  }

  // Welcome to OpenLaw: no live account in this lab has zero sections (Inbox always has New Requests),
  // so the rendering is checked with a mocked empty Home answer in the browser only.
  {
    const c = await signIn(acct.member.email, acct.member.password);
    await c.page.route("**/api/v1/home", (route) => route.fulfill({ json: { sections: [] } }));
    await c.page.goto(`${BASE}/`);
    const welcome = await seen(c.page.getByText("Welcome to OpenLaw"), 10000);
    log.record(
      A,
      "legal_team_member",
      "supplementary (mocked empty Home answer): Welcome to OpenLaw when nothing matches",
      "Home shows Welcome to OpenLaw when no section has work",
      `Welcome to OpenLaw shown ${welcome}. Browser rendering only: every live staff account here has at least the Inbox section.`,
      welcome,
      "/",
    );
    await c.context.close();
  }

  // Clean up the Entity fixtures so other walkthroughs' Home pages are not crowded.
  for (const e of [e1, e2]) await api(fa.page, "POST", `/entities/${e.id}/archive`, {});
  await fa.context.close().catch(() => {});
}

// =====================================================================================
// V-C05 personal-settings
// =====================================================================================
function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
/** A w x h RGB PNG; noise=true makes it large (stored deflate) and hard to compress. */
function png(w, h, noise = false) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let seed = 7;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * (w * 3 + 1) + 1 + x * 3;
      for (let k = 0; k < 3; k++) {
        if (noise === "gradient")
          raw[i + k] = [Math.floor((x * 255) / w), Math.floor((y * 255) / h), 140][k];
        else if (noise) {
          seed = (seed * 1103515245 + 12345) & 0x7fffffff;
          raw[i + k] = seed & 0xff;
        } else raw[i + k] = [40, 110, 160][k];
      }
    }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 0 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const savedNote = (scope) => seen(scope.getByText("Saved", { exact: true }), 10000);

async function personalSettings(admin) {
  const A = "personal-settings";
  const S = `${TAG} V-C05 ${STAMP}`;
  const acct = {};
  for (const [role, short] of [
    ["administrator", "admin"],
    ["legal_team_member", "member"],
  ]) {
    acct[role] = await inviteAndActivate(admin.page, {
      email: `doc030.access2.c05.${short}.${STAMP}@helix.example`,
      displayName: `${S} ${role === "administrator" ? "Administrator" : "Legal Team Member"}`,
      role,
      password: `Doc030-c05-${short}-${STAMP}`,
    });
    fx.created.push(`${role} account ${acct[role].email}`);
  }
  const prefs = (id) =>
    sql(
      `select display_name||'|'||coalesce(timezone,'')||'|'||theme||'|'||(image is not null) from users where id='${id}'`,
    );

  for (const role of ["administrator", "legal_team_member"]) {
    const R = (step, expected, actual, pass, page) =>
      log.record(A, role, step, expected, actual, pass, page);
    const a = acct[role];
    const otherRole = role === "administrator" ? "legal_team_member" : "administrator";
    const otherBefore = prefs(acct[otherRole].userId);
    const c = await signIn(a.email, a.password);
    const p = c.page;
    const device2 = await signIn(a.email, a.password);

    // Personal group.
    await p.getByRole("button", { name: a.displayName, exact: true }).click();
    await p.getByRole("menuitem", { name: "Settings" }).click();
    await p.waitForURL(/\/settings/);
    const personalNav = p.getByRole("navigation").filter({ hasText: "Personal" }).first();
    const entries = await personalNav
      .getByRole("link")
      .evaluateAll((as) => as.map((x) => x.textContent.trim()));
    const personalEntries = entries.slice(0, entries.indexOf("View Business Portal") + 1);
    await personalNav.getByRole("link", { name: "API keys", exact: true }).click();
    const apiKeys = await p.waitForURL(/\/settings\/api-keys/, { timeout: 10000 }).then(
      () => true,
      () => false,
    );
    const apiKeysText = (await text(p.locator("main"))).slice(0, 140);
    R(
      "Personal lists Profile, Appearance, Notifications and API keys, then View Business Portal",
      "The Personal group has exactly those five entries in that order; API keys opens its pane",
      `Settings navigation links: ${entries.join(", ")}; Personal entries ${personalEntries.join(", ")}; API keys opened ${pathOf(p)} ${apiKeys} ("${apiKeysText}")`,
      JSON.stringify(personalEntries) ===
        JSON.stringify([
          "Profile",
          "Appearance",
          "Notifications",
          "API keys",
          "View Business Portal",
        ]) && apiKeys,
      "/settings",
    );

    // Update your profile, steps 1-5.
    await personalNav.getByRole("link", { name: "Profile", exact: true }).click();
    await p.waitForURL(/\/settings\/profile/);
    const edited = `${a.displayName} edited`;
    await p.getByLabel("Full name").fill(edited);
    await p.getByLabel("Full name").press("Enter");
    const nameSaved = await savedNote(p);
    const tz = p.getByRole("combobox", { name: "Timezone" });
    await tz.click();
    await tz.fill("Tokyo");
    await p.getByRole("option", { name: /Tokyo/ }).first().click();
    const tzSaved = await savedNote(p);
    await sleep(1000);
    await p.reload();
    await p.getByLabel("Full name").waitFor();
    const nameAfter = await p.getByLabel("Full name").inputValue();
    const tzAfter = await tz.inputValue();
    const headerName = await p
      .getByRole("button", { name: edited, exact: true })
      .isVisible()
      .catch(() => false);
    await tz.click();
    await p
      .getByRole("option", { name: /Use browser timezone/ })
      .first()
      .click();
    const tzCleared = await savedNote(p);
    await sleep(1000);
    const dbTz = sql(`select coalesce(timezone,'null') from users where id='${a.userId}'`);
    // Restore the name by leaving the field.
    await p.getByLabel("Full name").fill(a.displayName);
    await p.getByLabel("Full name").blur();
    const blurSaved = await savedNote(p);
    await sleep(800);
    const dbName = sql(`select display_name from users where id='${a.userId}'`);
    R(
      "Update your profile, steps 1-5",
      "Settings from the name menu; Profile under Personal; Full name saves with Enter or on leaving the field; Timezone search and select saves; Saved shows; reload keeps both; Use browser timezone removes the preference",
      `Name saved with Enter ${nameSaved}, after reload "${nameAfter}", header name menu updated ${headerName}; timezone Saved ${tzSaved}, after reload "${tzAfter}"; Use browser timezone Saved ${tzCleared}, stored ${dbTz}; name restored by leaving the field Saved ${blurSaved}, stored "${dbName}"`,
      nameSaved &&
        nameAfter === edited &&
        headerName &&
        tzSaved &&
        /Tokyo/.test(tzAfter) &&
        tzCleared &&
        dbTz === "null" &&
        blurSaved &&
        dbName === a.displayName,
      "/settings/profile",
    );

    // Email and Role; the More information icon beside Role.
    const email = p.getByLabel("Email");
    const emailRO =
      (await email.getAttribute("readonly")) !== null && (await email.inputValue()) === a.email;
    const roleHelp = p
      .locator("span.inline-flex")
      .filter({ has: p.locator("label", { hasText: /^Role$/ }) })
      .getByRole("button", { name: "More information" })
      .first();
    const tipText = p
      .getByText("Roles are managed in Organization → Users.")
      .filter({ visible: true });
    await roleHelp.hover();
    await sleep(700);
    let tip = await seen(tipText, 3000);
    if (!tip) {
      await roleHelp.click();
      tip = await seen(tipText, 3000);
    }
    await p.keyboard.press("Escape");
    const roleEditable =
      (await p.getByRole("combobox", { name: "Role", exact: true }).count()) +
      (await p.getByLabel("Role", { exact: true }).count());
    R(
      "Email and Role are read-only; the More information icon beside Role",
      "Email is read-only; Role has no control; More information beside Role says Roles are managed in Organization → Users.",
      `Email read-only with the account email ${emailRO}; Role editable controls ${roleEditable}; More information popover text shown ${tip}`,
      emailRO && roleEditable === 0 && tip,
      "/settings/profile",
    );

    // Profile photo.
    const fileInput = p.getByLabel("Upload a profile photo");
    const hint = await seen(p.getByText("JPG or PNG, up to 10 MB. Resized automatically."), 3000);
    const accept = await fileInput.getAttribute("accept");
    const small = png(64, 64);
    const [chooser] = await Promise.all([
      p.waitForEvent("filechooser"),
      p.getByRole("button", { name: "Upload", exact: true }).click(),
    ]);
    await chooser.setFiles({
      name: "doc030-access2-avatar.png",
      mimeType: "image/png",
      buffer: small,
    });
    const smallSaved = await savedNote(p);
    await sleep(1000);
    await sleep(3000);
    const large = png(1800, 1800, "gradient");
    await fileInput.setInputFiles({
      name: "doc030-access2-large.png",
      mimeType: "image/png",
      buffer: large,
    });
    const largeSaved = await savedNote(p);
    await sleep(1500);
    const stored = sql(`select image from users where id='${a.userId}'`);
    const storedBytes = Buffer.from(stored.slice(stored.indexOf(",") + 1), "base64");
    const storedW = storedBytes.readUInt32BE(16);
    const storedH = storedBytes.readUInt32BE(20);
    await p.reload();
    const profileReloads = await seen(p.getByLabel("Full name"), 15000);
    const huge = png(1900, 1900, true);
    await fileInput.setInputFiles({
      name: "doc030-access2-huge.png",
      mimeType: "image/png",
      buffer: huge,
    });
    const tooBig = await seen(p.getByText("Choose a photo smaller than 10 MB."), 8000);
    await fileInput.setInputFiles({
      name: "doc030-access2.gif",
      mimeType: "image/gif",
      buffer: Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00;", "binary"),
    });
    const wrongType = await seen(p.getByText("Choose a JPG or PNG photo."), 8000);
    R(
      "Change your photo: Upload a JPG or PNG up to 10 MB; larger files and other types are refused",
      "Hint JPG or PNG, up to 10 MB. Resized automatically.; a large photo is scaled down and saved with Saved; a file over 10 MB shows Choose a photo smaller than 10 MB.; another type shows Choose a JPG or PNG photo.",
      `Hint ${hint}; picker filter "${accept}"; ${small.length}-byte PNG via Upload saved ${smallSaved}; ${(large.length / 1048576).toFixed(1)} MB 1800x1800 gradient PNG saved ${largeSaved}, stored as a ${storedW}x${storedH} image of ${storedBytes.length} bytes, Profile reloads ${profileReloads}; ${(huge.length / 1048576).toFixed(1)} MB PNG refused with the 10 MB message ${tooBig}; a GIF set on the input past the picker's JPG/PNG filter refused with Choose a JPG or PNG photo. ${wrongType}`,
      hint &&
        smallSaved &&
        largeSaved &&
        profileReloads &&
        Math.max(storedW, storedH) <= 512 &&
        storedBytes.length <= 1048576 &&
        large.length > 1048576 &&
        large.length < 10485760 &&
        huge.length > 10485760 &&
        tooBig &&
        wrongType,
      "/settings/profile",
    );

    // Choose a theme.
    await personalNav.getByRole("link", { name: "Appearance", exact: true }).click();
    await p.waitForURL(/\/settings\/appearance/);
    const themes = {};
    for (const label of ["Warm", "Dark", "Light"]) {
      await p.getByRole("radio", { name: label }).check();
      const ok = await savedNote(p);
      await sleep(800);
      themes[label] = `${ok}/${sql(`select theme from users where id='${a.userId}'`)}`;
    }
    await p.getByRole("radio", { name: "Dark" }).check();
    await savedNote(p);
    await sleep(800);
    await p.reload();
    await p.getByRole("radio", { name: "Dark" }).waitFor();
    const darkKept = await p.getByRole("radio", { name: "Dark" }).isChecked();
    const stillIn = /\/settings\/appearance/.test(p.url());
    await p.getByRole("radio", { name: "Light" }).check();
    await savedNote(p);
    const otherAfter = prefs(acct[otherRole].userId);
    R(
      "Choose a theme, steps 1-3; another account's preferences unchanged",
      "Light, Warm and Dark each save for this account; reload keeps the choice; changing the theme does not sign out; the other account is unchanged",
      `Saved/stored ${JSON.stringify(themes)}; Dark kept after reload ${darkKept}; still signed in ${stillIn}; other ${otherRole} account name|timezone|theme|photo unchanged ${otherBefore === otherAfter} ("${otherAfter.split("|").slice(1).join("|")}")`,
      themes.Warm === "true/warm" &&
        themes.Dark === "true/dark" &&
        themes.Light === "true/light" &&
        darkKept &&
        stillIn &&
        otherBefore === otherAfter,
      "/settings/appearance",
    );

    // Open your own Portal view.
    await personalNav.getByRole("link", { name: "View Business Portal", exact: true }).click();
    const paneUrl = await p.waitForURL(/\/settings\/app-view/).then(
      () => true,
      () => false,
    );
    await p
      .getByRole("link", { name: "View as business user" })
      .or(p.getByRole("button", { name: "View as business user" }))
      .first()
      .click();
    await p.waitForURL(/\/portal/, { timeout: 15000 });
    const banner = await seen(p.getByText("Viewing as business user"), 10000);
    const header = await text(p.locator("header").first());
    const roleUnchanged = sql(`select role from users where id='${a.userId}'`) === role;
    await p.getByRole("link", { name: "Return to legal view" }).click();
    const returned = await p.waitForURL(/\/settings\/app-view/, { timeout: 15000 }).then(
      () => true,
      () => false,
    );
    const stillSignedIn = !/\/auth\//.test(p.url());
    R(
      "Open your own Portal view, steps 1-4",
      "View Business Portal is its own Personal pane at /settings/app-view; View as business user opens the Portal with the Viewing as business user banner; own identity and role; Return to legal view returns to View Business Portal",
      `Pane /settings/app-view ${paneUrl}; banner ${banner}; Portal header shows the account ${header.includes(a.displayName) || header.includes(a.email)}; role unchanged ${roleUnchanged}; Return to legal view -> ${pathOf(p)} ${returned}; still signed in ${stillSignedIn}`,
      paneUrl && banner && roleUnchanged && returned && stillSignedIn,
      "/settings/app-view",
    );

    // Change your password.
    await personalNav.getByRole("link", { name: "Profile", exact: true }).click();
    await p.waitForURL(/\/settings\/profile/);
    const card = await seen(p.getByText("Password & two-factor"), 15000);
    const newPw = `Doc030-c05-${role === "administrator" ? "admin" : "member"}-changed-${STAMP}`;
    await p.getByRole("button", { name: "Change password" }).click();
    const d = p.getByRole("dialog");
    const note = await text(d);
    await d.getByLabel("Current password").fill(`${a.password}-wrong`);
    await d.getByLabel("New password").fill(newPw);
    await d.getByRole("button", { name: "Save" }).click();
    const errText =
      "The password could not be changed. Check your current password and use at least 8 characters.";
    const wrongMsg = await seen(d.getByText(errText));
    await d.getByLabel("Current password").fill(a.password);
    await d.getByLabel("New password").fill("short1");
    await d.getByRole("button", { name: "Save" }).click();
    await sleep(2000);
    const shortMsg = await d
      .getByText(errText)
      .isVisible()
      .catch(() => false);
    const shortOpen = await d.isVisible();
    await d.getByLabel("New password").fill(newPw);
    await d.getByRole("button", { name: "Save" }).click();
    const closed = await d.waitFor({ state: "hidden", timeout: 10000 }).then(
      () => true,
      () => false,
    );
    await sleep(1500);
    await p.reload();
    const thisOpen = /\/settings\/profile/.test(p.url());
    await device2.page.reload();
    const otherOut = await device2.page.waitForURL(/\/auth\/login/, { timeout: 15000 }).then(
      () => true,
      () => false,
    );
    await device2.context.close();
    a.password = newPw;
    R(
      "Change your password, steps 1-3",
      "Change password asks for Current password and New password; a wrong current password or fewer than 8 characters is refused; Save changes it, keeps this session and signs out other devices",
      `Card ${card}; dialog says "${note.slice(0, 120)}"; wrong current password message ${wrongMsg}; 6-character password refused ${shortMsg && shortOpen}; dialog closed after Save ${closed}; this session open ${thisOpen}; other device sent to sign-in ${otherOut}`,
      card && wrongMsg && shortMsg && shortOpen && closed && thisOpen && otherOut,
      "/settings/profile",
    );

    // End sessions.
    const device3 = await signIn(a.email, a.password);
    await p.getByRole("button", { name: "Sign out other devices" }).click();
    const sessSaved = await savedNote(p);
    await sleep(1000);
    await device3.page.reload();
    const d3Out = await device3.page.waitForURL(/\/auth\/login/, { timeout: 15000 }).then(
      () => true,
      () => false,
    );
    await device3.context.close();
    await p.reload();
    const stillOpen = /\/settings\/profile/.test(p.url());
    await p.getByRole("button", { name: a.displayName, exact: true }).click();
    await p.getByRole("menuitem", { name: "Sign out" }).click();
    const outOk = await p.waitForURL(/\/auth\/login/, { timeout: 15000 }).then(
      () => true,
      () => false,
    );
    await p.goto(`${BASE}/settings/profile`);
    await sleep(1500);
    const staysOut = /\/auth\//.test(p.url());
    R(
      "End sessions: Sign out other devices and Sign out",
      "Sign out other devices ends every other session and this one stays; Sign out in the name menu ends the current session",
      `Saved ${sessSaved}; other device sent to sign-in ${d3Out}; this session open ${stillOpen}; Sign out -> sign-in ${outOk}; Profile afterwards needs sign-in ${staysOut}`,
      d3Out && stillOpen && outOk && staysOut,
      "/settings/profile",
    );
    await c.context.close();
  }

  // Password & two-factor is absent for an account without a password (email-link sign-in).
  {
    const email = `doc030.access2.c05.nopassword.${STAMP}@helix.example`;
    const inv = await api(admin.page, "POST", "/auth/invites", {
      email,
      displayName: `${S} No Password Member`,
      role: "legal_team_member",
    });
    fx.created.push(`legal_team_member account ${email} without a password`);
    await waitForBudget(1);
    const c = await newContext();
    await c.page.goto(`${BASE}/auth/login`);
    await c.page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await c.page.getByLabel("Email").fill(email);
    const since = Date.now();
    await c.page.getByRole("button", { name: "Send link" }).click();
    const m = await waitForLink(email, since, { subjectRe: /Sign in/i, linkRe: /magic-link/ });
    await c.page.goto(m.link);
    const inApp = await leftAuth(c.page);
    await c.page.goto(`${BASE}/settings/profile`);
    await c.page.getByText("Sessions").first().waitFor({ timeout: 15000 });
    const absent = (await c.page.getByText("Password & two-factor").count()) === 0;
    log.record(
      A,
      "legal_team_member",
      "If this password section is absent",
      "Profile shows Password & two-factor only when the account has a password",
      `Invite ${inv.status}; sign-in link reached the app ${inApp}; Profile without Password & two-factor ${absent}`,
      inv.status === 201 && inApp && absent,
      "/settings/profile",
    );
    await c.context.close();
  }

  // Product bug reproduction (not a guide step): a photo that stays large after resizing breaks Profile.
  {
    const b = await inviteAndActivate(admin.page, {
      email: `doc030.access2.c05.photobug.${STAMP}@helix.example`,
      displayName: `${S} Photo Bug Member`,
      role: "legal_team_member",
      password: `Doc030-c05-photobug-${STAMP}`,
    });
    fx.created.push(`legal_team_member account ${b.email} (photo bug reproduction)`);
    const c = await signIn(b.email, b.password);
    const p = c.page;
    const errors = [];
    p.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 120)));
    await p.goto(`${BASE}/settings/profile`);
    await p.getByLabel("Full name").waitFor({ timeout: 15000 });
    const noisy = png(1500, 1500, true);
    await p
      .getByLabel("Upload a profile photo")
      .setInputFiles({ name: "doc030-access2-detailed.png", mimeType: "image/png", buffer: noisy });
    const ok = await savedNote(p);
    await sleep(1500);
    const len = Number(sql(`select length(image) from users where id='${b.userId}'`));
    await p.reload();
    await sleep(4000);
    const body = await text(p.locator("main, body").first());
    const broken = body.includes("Something went wrong. The page could not load.");
    fx.productBugs.push({
      article: A,
      summary:
        "On 067c1646 a profile photo that is still large after the browser resizes it (here a 512x512 detailed PNG stored as a ~1 MB data URL) saves with Saved, but afterwards Settings > Profile shows Something went wrong. The page could not load. The session endpoint GET /api/auth/get-session answers with a set-auth-jwt response header that carries the whole photo (about 1.4 MB measured on the lab), which Chromium refuses (ERR_RESPONSE_HEADERS_TOO_BIG). Home and other pages still load; the person has no way to remove the photo. dev commit 7abd2a8f (PR #1158, after the pinned commit) stops the jwt plugin from sending set-auth-jwt.",
      reproduction: `As ${b.email}: Settings > Profile > Upload a ${(noisy.length / 1048576).toFixed(1)} MB 1500x1500 noisy PNG; Saved ${ok}; stored data URL ${len} characters; reload Profile: error page ${broken}; console: ${
        errors
          .filter((e) => /HEADERS_TOO_BIG/.test(e))
          .slice(0, 1)
          .join("") || errors.slice(0, 1).join("")
      }`,
      observedAt: new Date().toISOString(),
    });
    console.log(`PRODUCT BUG reproduced ${ok && broken}`);
    await c.context.close();
  }

  // Business Users do not have the control; Settings sends them to the Portal.
  {
    const bu = await businessUser();
    const res = {};
    for (const pth of ["/settings", "/settings/app-view", "/settings/profile"]) {
      await bu.page.goto(`${BASE}${pth}`);
      await sleep(2000);
      res[pth] = pathOf(bu.page);
    }
    const none =
      (await bu.page.getByText("View as business user").count()) === 0 &&
      (await bu.page.getByText("View Business Portal").count()) === 0;
    log.record(
      A,
      "business_user",
      "Business Users do not have the View Business Portal control",
      "Settings sends a Business User to the Portal; no View Business Portal or View as business user control",
      `Business User ${bu.email}: ${JSON.stringify(res)}; control text present ${!none}`,
      Object.values(res).every((x) => x.startsWith("/portal")) && none,
      "/portal",
    );
  }
}

// =====================================================================================
// V-C11 portal-knowledge
// =====================================================================================
function pdf(marker) {
  const t = `DOC-030 access-2 fictional file ${marker}`;
  const stream = `BT /F1 12 Tf 72 720 Td (${t}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out +=
    `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out);
}
const pdfFile = (name) => ({ name, mimeType: "application/pdf", buffer: pdf(name) });
async function downloadVia(page, locator) {
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 20000 }),
    locator.click(),
  ]);
  const p = await dl.path();
  return { filename: dl.suggestedFilename(), bytes: readFileSync(p) };
}

async function portalKnowledge(admin) {
  const A = "portal-knowledge";
  const RB = "business_user";
  const S = `${TAG} V-C11 ${STAMP}`;
  const D = admin.page;
  const article = sql(
    `select id from knowledge_types where display_name='Article' and archived_at is null limit 1`,
  );
  const K = {};
  async function item(key, { audience, publish, archive, docs, body, confidential = [] }) {
    const title = `${S} ${key}`;
    const it = must(
      await api(D, "POST", "/knowledge", { title, knowledgeTypeId: article }),
      `create ${key}`,
    ).knowledgeItem;
    const uploaded = [];
    for (const name of docs) {
      const d = must(
        await api(D, "POST", `/knowledge/${it.id}/documents`, undefined, { file: pdfFile(name) }),
        `upload ${name}`,
      ).document;
      uploaded.push({ id: d.id, name });
      await sleep(1100);
    }
    const patch = { audience };
    if (body) patch.body = body;
    if (uploaded.length) patch.primaryDocumentId = uploaded.at(-1).id;
    must(await api(D, "PATCH", `/knowledge/${it.id}`, patch), `patch ${key}`);
    for (const i of confidential)
      must(
        await api(D, "PATCH", `/documents/${uploaded[i].id}`, { isConfidential: true }),
        `flag ${key}`,
      );
    if (publish) must(await api(D, "POST", `/knowledge/${it.id}/publish`, {}), `publish ${key}`);
    if (archive) must(await api(D, "POST", `/knowledge/${it.id}/archive`, {}), `archive ${key}`);
    K[key] = { id: it.id, title, docs: uploaded };
    fx.created.push(
      `Knowledge Item "${title}" (${audience}, ${publish ? "published" : "draft"}${archive ? ", archived" : ""}, ${docs.length} Documents${confidential.length ? `, ${confidential.length} marked Confidential` : ""})`,
    );
  }
  await item("guidance", {
    audience: "everyone",
    publish: true,
    docs: [`doc030-supporting-${STAMP}.pdf`, `doc030-primary-${STAMP}.pdf`],
    body: "Read this DOC-030 guidance before you ask Legal for a review.\n\nSend the latest draft with your Request.",
  });
  await item("confidential primary", {
    audience: "everyone",
    publish: true,
    docs: [`doc030-open-supporting-${STAMP}.pdf`, `doc030-confidential-primary-${STAMP}.pdf`],
    confidential: [1],
    body: "DOC-030 guidance whose primary Document is Confidential.",
  });
  await item("all confidential", {
    audience: "everyone",
    publish: true,
    docs: [`doc030-only-confidential-${STAMP}.pdf`],
    confidential: [0],
    body: "DOC-030 guidance whose only Document is Confidential.",
  });
  await item("restricted", {
    audience: "legal_only",
    publish: true,
    docs: [`doc030-restricted-${STAMP}.pdf`],
  });
  await item("draft", {
    audience: "everyone",
    publish: false,
    docs: [`doc030-draft-${STAMP}.pdf`],
  });
  await item("archived", {
    audience: "everyone",
    publish: true,
    archive: true,
    docs: [`doc030-archived-${STAMP}.pdf`],
  });

  const bu = await businessUser();
  const page = bu.page;
  const R = (step, expected, actual, pass, pg) =>
    log.record(A, RB, step, expected, actual, pass, pg);

  // Steps 1-3 and 5-6 from Before you submit on the Portal home.
  await page.goto(`${BASE}/portal`);
  const panel = page.getByRole("region", { name: "Before you submit" });
  await panel.waitFor({ timeout: 15000 });
  const homeLinks = await panel.getByRole("link").evaluateAll((as) =>
    as.map((a) => ({
      label: a.childNodes[0]?.textContent?.trim(),
      href: a.getAttribute("href"),
      target: a.getAttribute("target"),
      domain:
        a.parentElement?.querySelector("span[aria-hidden]")?.textContent ??
        a.querySelector("span")?.textContent ??
        null,
    })),
  );
  const staffList = must(await api(D, "GET", "/knowledge?limit=100"), "knowledge").knowledgeItems;
  const knowledgeLinks = homeLinks.filter((l) => l.href?.startsWith("/portal/knowledge/"));
  const eligible = knowledgeLinks.every((l) => {
    const k = staffList.find((x) => x.id === l.href.split("/").at(-1));
    return k && k.state === "published" && k.audience === "everyone" && !k.archivedAt;
  });
  await page.goto(`${BASE}/portal/new/contract_review`);
  await page.getByRole("heading", { level: 1 }).first().waitFor();
  const formPanel = page.getByRole("region", { name: "Before you submit" });
  const formLinks = (await formPanel.count())
    ? await formPanel.getByRole("link").evaluateAll((as) => as.map((a) => a.getAttribute("href")))
    : [];
  R(
    "Open guidance and Documents, step 1: Before you submit on the Portal home and a request form",
    "Before you submit lists only eligible guidance; the links can differ between the home page and a form",
    `Home links: ${homeLinks.map((l) => `${l.label} -> ${l.href}${l.target ? ` (${l.target}, shows "${l.domain}")` : ""}`).join("; ")}; every Knowledge link is a published Everyone item ${eligible}; Contract review form links [${formLinks.join(", ")}] differ from home ${JSON.stringify(formLinks) !== JSON.stringify(homeLinks.map((l) => l.href))}`,
    knowledgeLinks.length > 0 &&
      eligible &&
      JSON.stringify(formLinks) !== JSON.stringify(homeLinks.map((l) => l.href)),
    "/portal",
  );

  await page.goto(`${BASE}/portal`);
  const first = knowledgeLinks[0];
  const tabs = page.context().pages().length;
  await page
    .getByRole("region", { name: "Before you submit" })
    .getByRole("link", { name: first.label })
    .first()
    .click();
  await page.waitForURL(new RegExp(`${first.href}$`), { timeout: 15000 });
  const main = page.getByRole("main");
  const kicker = await text(main.getByText("From Legal", { exact: true }));
  const h1 = await text(main.getByRole("heading", { level: 1 }));
  const kickerAbove = await (async () => {
    const a = await main.getByText("From Legal", { exact: true }).boundingBox();
    const b = await main.getByRole("heading", { level: 1 }).boundingBox();
    return !!(a && b && a.y < b.y);
  })();
  const gCount = await main.getByRole("region", { name: "Guidance" }).count();
  const dCount = await main.getByRole("region", { name: "Documents" }).count();
  let seededDl = "no Documents on this item";
  if (dCount) {
    const d = await downloadVia(
      page,
      main
        .getByRole("region", { name: "Documents" })
        .getByRole("link", { name: /^Download / })
        .first(),
    );
    seededDl = `downloaded ${d.filename} (${d.bytes.length} bytes)`;
  }
  const sameTab = page.context().pages().length === tabs;
  await main.getByRole("link", { name: "Your requests" }).click();
  const home = await page.waitForURL(/\/portal$/, { timeout: 10000 }).then(
    () => true,
    () => false,
  );
  R(
    "Open guidance and Documents, steps 2-6 from a Before you submit link",
    "The Knowledge link opens in the same tab; From Legal above the title; Documents with Download and Guidance when present; Your requests returns to the Portal home",
    `"${first.label}" opened ${first.href} in the same tab ${sameTab}; "${kicker}" above "${h1}" ${kickerAbove}; Guidance section ${gCount > 0}; Documents section ${dCount > 0}, ${seededDl}; Your requests -> /portal ${home}`,
    sameTab &&
      kicker === "From Legal" &&
      kickerAbove &&
      h1.length > 0 &&
      (gCount > 0 || dCount > 0) &&
      home,
    "/portal/knowledge/:id",
  );

  // A Portal Knowledge link Legal shares: primary first, current Version, no picker or reader.
  const G = K.guidance;
  await page.goto(`${BASE}/portal/knowledge/${G.id}`);
  await main.getByRole("heading", { level: 1, name: G.title }).waitFor({ timeout: 15000 });
  const docs = main.getByRole("region", { name: "Documents" });
  const names = (await docs.getByRole("listitem").allInnerTexts()).map((n) =>
    n
      .replace(/\s+/g, " ")
      .replace(/Download$/, "")
      .trim(),
  );
  const pItem = must(
    await api(page, "GET", `/portal/knowledge/${G.id}`),
    "portal item",
  ).knowledgeItem;
  const got = [];
  for (const d of pItem.documents) {
    const dl = await downloadVia(
      page,
      docs.getByRole("link", { name: `Download ${d.currentVersion.originalFilename}` }),
    );
    got.push(
      sha(dl.bytes) === sha(pdf(d.currentVersion.originalFilename))
        ? `${dl.filename} matches`
        : `${dl.filename} differs`,
    );
  }
  const combos = await main.getByRole("combobox").count();
  const frames = await main.locator("iframe, embed, object").count();
  const guidance = await text(main.getByRole("region", { name: "Guidance" }));
  R(
    "Open guidance and Documents, steps 4-5: primary Document first, Download gives the current Version, Guidance",
    "The primary Document (uploaded second) is listed first; Download gives each current Version; no version picker or embedded reader; Guidance shows the written instructions",
    `Documents order: ${names.join(" | ")}; downloads: ${got.join("; ")}; version pickers ${combos}; embedded readers ${frames}; Guidance "${guidance}"`,
    names[0] === G.docs[1].name &&
      names[1] === G.docs[0].name &&
      got.every((g) => g.endsWith("matches")) &&
      combos === 0 &&
      frames === 0 &&
      guidance.includes("Send the latest draft"),
    "/portal/knowledge/:id",
  );

  // Confidential Documents do not appear, even as the primary Document, and their addresses do not work.
  const C = K["confidential primary"];
  await page.goto(`${BASE}/portal/knowledge/${C.id}`);
  await main.getByRole("heading", { level: 1, name: C.title }).waitFor({ timeout: 15000 });
  const cNames = (
    await main.getByRole("region", { name: "Documents" }).getByRole("listitem").allInnerTexts()
  ).map((n) =>
    n
      .replace(/\s+/g, " ")
      .replace(/Download$/, "")
      .trim(),
  );
  const cApi = must(
    await api(page, "GET", `/portal/knowledge/${C.id}`),
    "confidential item",
  ).knowledgeItem;
  const openUrl = cApi.documents[0]?.currentVersion?.downloadUrl ?? "";
  const confUrl = openUrl.replace(C.docs[0].id, C.docs[1].id);
  const confStatus = (await page.request.get(`${BASE}${confUrl}`)).status();
  const openStatus = (await page.request.get(`${BASE}${openUrl}`)).status();
  const staffPrimary =
    must(await api(D, "GET", `/knowledge/${C.id}`), "staff item").knowledgeItem.primaryDocument
      ?.id === C.docs[1].id;
  const AC = K["all confidential"];
  await page.goto(`${BASE}/portal/knowledge/${AC.id}`);
  await main.getByRole("heading", { level: 1, name: AC.title }).waitFor({ timeout: 15000 });
  const acDocs = await main.getByRole("region", { name: "Documents" }).count();
  const acGuidance = await main.getByRole("region", { name: "Guidance" }).count();
  R(
    "A Document that Legal marked Confidential does not appear, even when it is the primary Document; its download address does not work",
    "The Confidential primary is absent and the supporting Document shows; the Confidential Document's address answers 404 while the open one works",
    `Staff primary is the Confidential Document ${staffPrimary}; Portal Documents list: ${cNames.join(" | ")}; Confidential Document address HTTP ${confStatus}; open Document address HTTP ${openStatus}. Observation: an item whose only Document is Confidential shows no Documents section (${acDocs === 0}) and keeps its Guidance (${acGuidance > 0}).`,
    staffPrimary &&
      cNames.length === 1 &&
      cNames[0] === C.docs[0].name &&
      confStatus === 404 &&
      openStatus === 200,
    "/portal/knowledge/:id",
  );

  // A new Version replaces the file behind Download and a saved address.
  const primary = pItem.documents[0];
  const savedUrl = primary.currentVersion.downloadUrl;
  const vname = `doc030-primary-v2-${STAMP}.pdf`;
  const up = await api(D, "POST", `/documents/${primary.id}/versions`, undefined, {
    file: pdfFile(vname),
  });
  await page.goto(`${BASE}/portal/knowledge/${G.id}`);
  const dl2 = await downloadVia(
    page,
    main
      .getByRole("region", { name: "Documents" })
      .getByRole("link", { name: `Download ${vname}` }),
  );
  const savedBytes = await page.request.get(`${BASE}${savedUrl}`).then((r) => r.body());
  R(
    "Unavailable guidance: a file downloaded earlier does not update; Download gives the current Version",
    "After Legal adds a Version, reload lists the new file and Download and the saved address serve it",
    `Version upload HTTP ${up.status}; Download gave ${dl2.filename} with the new bytes ${sha(dl2.bytes) === sha(pdf(vname))}; saved address now serves the new bytes ${sha(savedBytes) === sha(pdf(vname))}`,
    up.status < 300 && sha(dl2.bytes) === sha(pdf(vname)) && sha(savedBytes) === sha(pdf(vname)),
    "/portal/knowledge/:id",
  );

  // Draft, restricted, archived and unknown items and their files.
  const out = [];
  let allOk = true;
  for (const [label, id] of [
    ["draft", K.draft.id],
    ["restricted", K.restricted.id],
    ["archived", K.archived.id],
    ["unknown", "01a0aaad-0000-7000-8000-000000000000"],
  ]) {
    await page.goto(`${BASE}/portal/knowledge/${id}`);
    const back = await page.waitForURL(/\/portal$/, { timeout: 15000 }).then(
      () => true,
      () => false,
    );
    const a = await api(page, "GET", `/portal/knowledge/${id}`);
    let fileStatus = "n/a";
    if (label !== "unknown")
      fileStatus = (
        await page.request.get(
          `${BASE}/api/v1/portal/knowledge/${id}/documents/${K[label].docs[0].id}/download`,
        )
      ).status();
    const ok = back && a.status === 404 && (label === "unknown" || fileStatus === 404);
    allOk &&= ok;
    out.push(`${label}: page -> ${pathOf(page)}, item HTTP ${a.status}, file HTTP ${fileStatus}`);
  }
  R(
    "Draft, restricted, archived and unknown items do not open; the same check applies to their files",
    "Each item returns to the Portal home; item and file addresses answer 404",
    out.join("; "),
    allOk,
    "/portal",
  );

  // A saved download address follows the item's availability.
  must(await api(D, "POST", `/knowledge/${G.id}/unpublish`, {}), "unpublish");
  let s1;
  let back1;
  try {
    await page.goto(`${BASE}/portal/knowledge/${G.id}`);
    back1 = await page.waitForURL(/\/portal$/, { timeout: 15000 }).then(
      () => true,
      () => false,
    );
    s1 = (await page.request.get(`${BASE}${savedUrl}`)).status();
  } finally {
    must(await api(D, "POST", `/knowledge/${G.id}/publish`, {}), "republish");
  }
  const s2 = (await page.request.get(`${BASE}${savedUrl}`)).status();
  R(
    "An internal Knowledge link returns you to the Portal home when the item is no longer available, including a saved download address",
    "After Legal unpublishes, the page returns home and the saved address answers 404; republishing restores it",
    `Unpublished: page -> /portal ${back1}, saved address HTTP ${s1}; republished: HTTP ${s2}`,
    back1 && s1 === 404 && s2 === 200,
    "/portal",
  );

  // External link: new tab, website shown; a failed website does not block the Request form.
  await page.goto(`${BASE}/portal`);
  const ext = homeLinks.find((l) => l.target === "_blank");
  if (!ext) {
    log.notRun(
      A,
      RB,
      "External links open in a new tab",
      "An external Before you submit link",
      "The seeded Portal home has no external link.",
    );
  } else {
    const [popup] = await Promise.all([
      page.context().waitForEvent("page"),
      page
        .getByRole("region", { name: "Before you submit" })
        .getByRole("link", { name: new RegExp(ext.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })
        .first()
        .click(),
    ]);
    await popup.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
    const popupUrl = popup.url();
    const popupText = await popup
      .evaluate(() => document.body?.innerText?.slice(0, 80) ?? "")
      .catch((e) => `error: ${e.message.split("\n")[0]}`);
    await popup.close();
    const stayed = pathOf(page) === "/portal";
    await page
      .getByRole("list", { name: "Request types" })
      .getByRole("link", { name: /Legal question/ })
      .click();
    await page.getByLabel(/^Title/).fill(`${S} request after an external link`);
    await page
      .getByLabel(/^Description/)
      .fill("DOC-030 access-2: the external website did not load.");
    await page.getByRole("button", { name: "Submit request" }).click();
    const thanks = await seen(
      page.getByText("Thanks! Your request has been submitted to legal."),
      15000,
    );
    await sleep(1000);
    const num = sql(
      `select number from requests where title='${S} request after an external link'`,
    );
    const head =
      thanks && num
        ? `Thanks! Your request has been submitted to legal. (R-${num})`
        : `no confirmation; page ${pathOf(page)}`;
    fx.created.push(`Request R-${num} "${S} request after an external link"`);
    R(
      "External links: the website shows beneath the label and opens in a new tab; a broken website does not block the Request",
      "A new tab opens; the original tab stays on the Portal; the Request can still be submitted",
      `"${ext.label}" shows "${ext.domain}" beneath it; new tab at ${popupUrl} ("${String(popupText).replace(/\s+/g, " ")}"); original tab on /portal ${stayed}; the Legal question form then confirmed "${head}"`,
      stayed && thanks && !!num && !!ext.domain,
      "/portal",
    );
  }

  // No staff Knowledge library or editing controls.
  await page.goto(`${BASE}/portal`);
  await page
    .getByRole("navigation", { name: "Portal" })
    .getByRole("link")
    .first()
    .waitFor({ timeout: 15000 });
  const portalNav = await page
    .getByRole("navigation", { name: "Portal" })
    .getByRole("link")
    .evaluateAll((as) => as.map((a) => a.textContent.trim()));
  await page.goto(`${BASE}/knowledge`);
  await sleep(2500);
  const where = pathOf(page);
  const staffApi = await api(page, "GET", "/knowledge");
  await page.goto(`${BASE}/portal/knowledge/${G.id}`);
  await main.getByRole("heading", { level: 1 }).waitFor();
  const editing = await main.getByRole("button", { name: /Edit|Publish|Archive|Upload/ }).count();
  R(
    "The Portal does not offer the staff Knowledge library or its editing controls",
    "No Knowledge entry in the Portal navigation; the staff Knowledge address sends a Business User to the Portal; no editing controls on the item page",
    `Portal navigation: ${portalNav.join(", ")}; /knowledge ended at ${where}; staff list API HTTP ${staffApi.status}; editing buttons ${editing}`,
    !portalNav.some((n) => /Knowledge/i.test(n)) &&
      where.startsWith("/portal") &&
      staffApi.status >= 400 &&
      editing === 0,
    "/portal",
  );

  // Everyone still needs a signed-in Portal session.
  {
    const c = await newContext();
    await c.page.goto(`${BASE}/portal/knowledge/${G.id}`);
    const toLogin = await c.page.waitForURL(/\/portal\/login/, { timeout: 15000 }).then(
      () => true,
      () => false,
    );
    const a = (await c.context.request.get(`${BASE}/api/v1/portal/knowledge/${G.id}`)).status();
    const f = (await c.context.request.get(`${BASE}${savedUrl}`)).status();
    await c.context.close();
    log.record(
      A,
      "anonymous",
      "Before you start: Everyone still requires a signed-in Portal session",
      "A signed-out browser goes to the Portal sign-in; item and file answer 401",
      `Page -> /portal/login ${toLogin}; item HTTP ${a}; file HTTP ${f}`,
      toLogin && a === 401 && f === 401,
      "/portal/login",
    );
  }

  // Help search does not search organization Knowledge.
  await page.goto(`${BASE}/portal/help`);
  const box = page
    .getByRole("searchbox")
    .or(page.getByRole("textbox", { name: /search/i }))
    .first();
  await box.waitFor({ timeout: 15000 });
  await box.fill(G.title);
  await box.press("Enter");
  await sleep(2000);
  const hit = await page.getByRole("link", { name: G.title }).count();
  R(
    "Before you start: searching product Help does not search organization Knowledge",
    "Help search for the guidance title finds no Knowledge Item",
    `Help at ${pathOf(page)}; links named "${G.title}" ${hit}; page starts "${(await text(page.getByRole("main"))).slice(0, 120)}"`,
    hit === 0,
    "/portal/help",
  );
}

// =====================================================================================
// V-C01 staff-sign-in, re-walk of the corrected Sign-in link expired paragraph
// =====================================================================================
async function staffExpiredRewalk(admin) {
  const A = "staff-sign-in";
  const STEP =
    "Re-walk after the author's correction: Sign-in link expired shows Email and Send link while sign-in links are on and email works, otherwise only Back to sign-in";
  for (const role of ["administrator", "legal_team_member"]) {
    const short = role === "administrator" ? "admin" : "member";
    const a = await inviteAndActivate(admin.page, {
      email: `doc030.access2.c01r.${short}.${STAMP}@helix.example`,
      displayName: `${TAG} V-C01 ${STAMP} re-walk ${role === "administrator" ? "Administrator" : "Legal Team Member"}`,
      role,
      password: `Doc030-c01r-${short}-${STAMP}`,
    });
    fx.created.push(`${role} account ${a.email} (${a.displayName})`);
    const c = await newContext();
    const p = c.page;
    await waitForBudget(2);
    // Links on (the lab's real setting): a used link opens Sign-in link expired.
    await p.goto(`${BASE}/auth/login`);
    await p.getByRole("button", { name: "Email me a sign-in link" }).click();
    await p.getByLabel("Email").fill(a.email);
    let since = Date.now();
    await p.getByRole("button", { name: "Send link" }).click();
    const ml1 = await waitForLink(a.email, since, { subjectRe: /Sign in/i, linkRe: /magic-link/ });
    await p.goto(ml1.link);
    const in1 = await leftAuth(p);
    await signOutViaMenu(p, a.displayName);
    await p.goto(ml1.link);
    const expired = await seen(p.getByRole("heading", { name: "Sign-in link expired" }), 15000);
    const controls = await p
      .locator("main")
      .locator("a, button, input")
      .evaluateAll((els) =>
        els
          .map((e) =>
            e.tagName === "INPUT" ? `input ${e.getAttribute("type")}` : e.textContent.trim(),
          )
          .filter(Boolean),
      );
    const hasEmail = (await p.locator("main").getByLabel("Email").count()) > 0;
    const hasSend = (await p.getByRole("button", { name: "Send link" }).count()) > 0;
    const hasBack =
      (await p
        .getByRole("link", { name: "Back to sign-in" })
        .or(p.getByRole("button", { name: "Back to sign-in" }))
        .count()) > 0;
    await p.locator("main").getByLabel("Email").fill(a.email);
    since = Date.now();
    await p.getByRole("button", { name: "Send link" }).click();
    const sent = await seen(p.getByText("Check your email"));
    const ml2 = await waitForLink(a.email, since, { subjectRe: /Sign in/i, linkRe: /magic-link/ });
    await p.goto(ml2.link);
    const in2 = await leftAuth(p);
    await signOutViaMenu(p, a.displayName);
    // Links off: the shared setting is not changed; the browser gets a mocked methods answer.
    const off = await newContext();
    await off.page.route("**/api/v1/auth/methods", async (route) => {
      const real = await route.fetch();
      const json = await real.json();
      json.policy.legal.magicLink = false;
      await route.fulfill({ json });
    });
    await off.page.goto(`${BASE}/auth/link-expired`);
    const offTitle = await seen(
      off.page.getByRole("heading", { name: "Sign-in link expired" }),
      15000,
    );
    const offControls = await off.page
      .locator("main")
      .locator("a, button, input")
      .evaluateAll((els) =>
        els
          .map((e) =>
            e.tagName === "INPUT" ? `input ${e.getAttribute("type")}` : e.textContent.trim(),
          )
          .filter(Boolean),
      );
    const offEmail = (await off.page.locator("main").getByLabel("Email").count()) > 0;
    await off.page.getByRole("link", { name: "Back to sign-in" }).click();
    const offBack = await off.page.waitForURL(/\/auth\/login/, { timeout: 10000 }).then(
      () => true,
      () => false,
    );
    await off.page.getByLabel("Email").fill(a.email);
    await off.page.getByLabel("Password").fill(a.password);
    await off.page.getByRole("button", { name: "Sign in", exact: true }).click();
    const otherMethod = await leftAuth(off.page);
    await off.context.close();
    await c.context.close();
    log.record(
      A,
      role,
      STEP,
      "Links on: a used link opens Sign-in link expired with Email and Send link (no Back to sign-in), and Send link gets a new link that signs in. Links off: the page shows only Back to sign-in, which returns to sign-in for another method",
      `Links on (live lab setting): first link signed in ${in1}; reused link opened Sign-in link expired ${expired} with controls [${controls.join(", ")}]: Email ${hasEmail}, Send link ${hasSend}, Back to sign-in ${hasBack}; Send link showed Check your email ${sent}; new email "${ml2?.subject}" signed in ${in2}. Links off (mocked methods answer in the browser only; the shared setting was not changed): Sign-in link expired ${offTitle} with controls [${offControls.join(", ")}], Email field ${offEmail}; Back to sign-in returned to sign-in ${offBack}; password sign-in as another method reached the app ${otherMethod}`,
      in1 &&
        expired &&
        hasEmail &&
        hasSend &&
        !hasBack &&
        sent &&
        in2 &&
        offTitle &&
        !offEmail &&
        offBack &&
        otherMethod,
      "/auth/link-expired",
    );
  }
}

// =====================================================================================
// Runner
// =====================================================================================
const MODULES = {
  staff: ["staff-sign-in", staffSignIn],
  home: ["find-your-work", findYourWork],
  settings: ["personal-settings", personalSettings],
  knowledge: ["portal-knowledge", portalKnowledge],
  // Appends to staff-sign-in instead of replacing its steps; supersedes the failed expired-link steps.
  expired: [
    "staff-sign-in",
    staffExpiredRewalk,
    {
      append: true,
      supersedes:
        "Sign-in link expired: enter your email there to get a new link, or select Back to sign-in",
    },
  ],
};
const chosen = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(MODULES);
if (!SEED_PASSWORD) throw new Error("LAB_PASSWORD is required");
const lab = JSON.parse(readFileSync(path.join(root, ".documentation-labs/work2/lab.json"), "utf8"));
const running = Object.fromEntries(
  ["app", "worker", "doc-engine"].map((svc) => [
    svc,
    execFileSync("docker", ["inspect", "-f", "{{.Image}}", `${PROJECT}-${svc}-1`], {
      encoding: "utf8",
    }).trim(),
  ]),
);
const hashes = Object.fromEntries(
  Object.values(MODULES).map(([id]) => [
    id,
    execFileSync("sha256sum", [path.join(root, `docs/user-guides/${id}.md`)], {
      encoding: "utf8",
    }).split(" ")[0],
  ]),
);
const startedAt = new Date().toISOString();
const budgetAtStart = {
  magicLink: sharedBudget("magic-link"),
  passwordSetup: sharedBudget("password-setup"),
};
const admin = await signIn(SEED.daniel.email);
for (const name of chosen) {
  const [id, fn] = MODULES[name];
  try {
    await fn(admin);
  } catch (e) {
    console.error(
      String(e.stack ?? e.message)
        .split("\n")
        .slice(0, 6)
        .join("\n"),
    );
    log.record(
      id,
      "-",
      "script error",
      "module completes",
      `${String(e.message).split("\n")[0]}`,
      false,
    );
  }
}
await close();
// Cleanup for a module that stopped early: archive this walkthrough's own Entities so their
// ancient Obligations do not sit at the top of other walkthroughs' Home pages.
sql(
  `update entities set archived_at = now() where legal_name like '${TAG} %' and archived_at is null`,
);

const out = path.join(here, "walkthrough.json");
const prior = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : { runs: [], steps: [] };
const ids = chosen.map((n) => MODULES[n][0]);
const replaced = chosen.filter((n) => !MODULES[n][2]?.append).map((n) => MODULES[n][0]);
const supersedes = chosen.map((n) => MODULES[n][2]?.supersedes).filter(Boolean);
const superseded = [
  ...(prior.supersededSteps ?? []),
  ...prior.steps
    .filter((s) => supersedes.includes(s.step))
    .map((s) => ({
      ...s,
      supersededAt: new Date().toISOString(),
      supersededBecause:
        "The author corrected the guide paragraph (staff-sign-in.md 29d19f72); the step was walked again against the corrected text.",
    })),
];
const steps = [
  ...prior.steps.filter((s) => !replaced.includes(s.article) && !supersedes.includes(s.step)),
  ...log.steps,
];
const run = {
  articles: ids,
  startedAt,
  finishedAt: new Date().toISOString(),
  stamp: STAMP,
  articleContentSha256: Object.fromEntries(ids.map((id) => [id, hashes[id]])),
  sharedSignInBudgetsAtStart: budgetAtStart,
  created: fx.created,
  productBugs: fx.productBugs,
  summary: {
    total: log.steps.length,
    passed: log.steps.filter((s) => s.result === "pass").length,
    failed: log.steps.filter((s) => s.result === "fail").length,
    notRun: log.steps.filter((s) => s.result === "not-run").length,
  },
};
const doc = {
  batch: "DOC-030",
  group: "access-2",
  walkthroughReviewer: "DOC-030 independent walkthrough agent (access-2)",
  reviewerKind: "agent",
  appCommit: lab.sourceCommit,
  environment: lab.project,
  lab: {
    name: lab.name,
    project: lab.project,
    appUrl: BASE,
    mailUrl: MAIL,
    appImageId: lab.appImageId,
    engineImageId: lab.engineImageId,
    seed: lab.seed,
    runningImages: running,
  },
  browser:
    "Playwright 1.63.0 Chromium (node_modules/.pnpm), headless, 1440x900, one isolated context per account or device",
  runs: [
    ...prior.runs.filter((r) => !r.articles.every((a) => replaced.includes(a))),
    { ...run, append: replaced.length === 0 },
  ],
  productBugs: [
    ...(prior.productBugs ?? []).filter((b) => !replaced.includes(b.article)),
    ...fx.productBugs,
  ],
  summary: Object.fromEntries(
    Object.values(MODULES).map(([id]) => {
      const s = steps.filter((x) => x.article === id);
      return [
        id,
        {
          steps: s.length,
          passed: s.filter((x) => x.result === "pass").length,
          failed: s.filter((x) => x.result === "fail").length,
          notRun: s.filter((x) => x.result === "not-run").length,
        },
      ];
    }),
  ),
  steps,
  supersededSteps: superseded,
};
writeFileSync(out, JSON.stringify(doc, null, 2) + "\n");
console.log(JSON.stringify(run.summary), "->", path.relative(root, out));
