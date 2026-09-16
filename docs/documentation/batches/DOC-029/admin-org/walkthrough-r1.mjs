// DOC-029 admin-org round 1 independent walkthrough.
// Written by the DOC-029 independent walkthrough agent (admin-org, round 1) from the article text.
// It follows organisation-and-users (V-C36), approver-groups (V-C55) and
// authentication-and-email (V-C37) as literally as a headless browser allows.
//
// Run from the repository root, one section at a time:
//   LAB_PASSWORD=... mise exec -- node docs/documentation/batches/DOC-029/admin-org/walkthrough-r1.mjs org
//   LAB_PASSWORD=... mise exec -- node docs/documentation/batches/DOC-029/admin-org/walkthrough-r1.mjs groups
//   LAB_PASSWORD=... mise exec -- node docs/documentation/batches/DOC-029/admin-org/walkthrough-r1.mjs <auth section>
// The seed password comes only from the environment. Passwords for accounts this
// script creates are random, held in memory, and never written.
// Each section writes batches/DOC-029/admin-org/runs/<section>-<time>.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { randomBytes, createHmac } from "node:crypto";
import path from "node:path";
import {
  chromium,
  here,
  articleHash,
  recorder,
  expect,
  sleep,
  signIn,
  waitMail,
  countMail,
  api,
} from "./lib.mjs";

const section = process.argv[2];
const ADMIN_LAB = { app: "http://127.0.0.1:23300", mail: "http://127.0.0.1:23400", project: "openlaw-docs-41255c61-admin" };
const AUTH_LAB = { app: "http://127.0.0.1:23310", mail: "http://127.0.0.1:23410", project: "openlaw-docs-41255c61-adminorg-auth" };
const DANIEL = "daniel.okafor@helix.example";
const NADIA = "nadia.haddad@helix.example";
const stamp = Date.now().toString(36);
const newPassword = () => `Doc029-${randomBytes(12).toString("hex")}`;
const SET_PASSWORD = /https?:\/\/\S+\/auth\/set-password\?token=[^\s)]+/;
const MAGIC = /https?:\/\/\S+\/api\/auth\/magic-link\/verify\?token=[^\s)]+/;

mkdirSync(path.join(here, "runs"), { recursive: true });
const outFile = path.join(here, "runs", `${section}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
const lab = section === "org" || section === "groups" ? ADMIN_LAB : AUTH_LAB;
const { results, step, save } = recorder(outFile, {
  section,
  reviewer: "DOC-029 independent walkthrough agent (admin-org, round 1)",
  reviewerKind: "agent",
  labProject: lab.project,
  appUrl: lab.app,
  mailUrl: lab.mail,
  articleHashes: {
    "organisation-and-users": articleHash("organisation-and-users"),
    "approver-groups": articleHash("approver-groups"),
    "authentication-and-email": articleHash("authentication-and-email"),
  },
});

const browser = await chromium.launch({
  // The local OIDC fixture is reachable on the lab network as "oidc"; the
  // browser resolves that name to the fixture container's address.
  args: process.env.OIDC_IP ? [`--host-resolver-rules=MAP oidc ${process.env.OIDC_IP}`] : [],
});
async function context() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  return { ctx, page };
}
const row = (page, email) => page.getByRole("row").filter({ hasText: email });
const shot = (page, name) => page.screenshot({ path: path.join(here, `${name}.png`) });

async function setPasswordFromLink(page, link, password) {
  await page.goto(link);
  await page.getByLabel("New password").fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Set password" }).click();
  await page.getByText("Password set").waitFor({ timeout: 15000 });
}

async function openUsers(page, base) {
  await page.goto(`${base}/settings/users`);
  await page.getByRole("heading", { name: "Users", level: 2 }).waitFor();
  await page.getByRole("table").waitFor();
}

async function invite(page, name, email, roleLabel) {
  await page.getByRole("button", { name: "Invite user" }).click();
  const dialog = page.getByRole("dialog", { name: "Invite user" });
  await dialog.getByLabel("Display name").fill(name);
  await dialog.getByLabel("Email").fill(email);
  await dialog.getByRole("radio", { name: roleLabel }).check();
  await dialog.getByRole("button", { name: "Send invite" }).click();
  return dialog;
}

async function requestMagicLink(page, base, email, portal = false) {
  await page.goto(`${base}${portal ? "/portal/login" : "/auth/login"}`);
  await page.getByRole("button", { name: "Email me a sign-in link" }).first().click();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send link" }).click();
  await page.getByRole("heading", { name: "Check your email" }).waitFor({ timeout: 15000 });
}

async function chooseRole(page, email, roleLabel) {
  await row(page, email).getByRole("button", { name: new RegExp(`change the role of ${email.replace(/\./g, "\\.")}`) }).click();
  const items = await page.getByRole("menuitemradio").allInnerTexts();
  await page.getByRole("menuitemradio", { name: roleLabel }).click();
  return items.map((s) => s.trim());
}

async function rowState(page, email) {
  const r = row(page, email);
  if ((await r.count()) === 0) return { present: false };
  const text = (await r.innerText()).replace(/\s+/g, " ");
  return {
    present: true,
    status: /\bInvited\b/.test(text) ? "Invited" : /\bArchived\b/.test(text) ? "Archived" : /\bActive\b/.test(text) ? "Active" : "?",
    roleControl: (await r.getByRole("button", { name: /change the role of/ }).count()) > 0,
    role: ["Administrator", "Legal team member", "Business user"].find((x) => text.includes(x)) ?? null,
    actions: (await r.getByRole("button").allInnerTexts()).map((s) => s.trim()).filter(Boolean),
  };
}

// ---------------------------------------------------------------------------
// V-C36 organisation-and-users on the shared admin lab.
async function org() {
  const A = "organisation-and-users";
  const { app, mail } = ADMIN_LAB;
  const admin = await context();
  await signIn(admin.page, app, DANIEL);
  const people = {
    a: { name: `DOC-029 admin-org Avery ${stamp}`, email: `doc029-org-a-${stamp}@helix.example`, password: newPassword() },
    b: { name: `DOC-029 admin-org Bryn ${stamp}`, email: `doc029-org-b-${stamp}@helix.example` },
    bu: { name: "", email: `doc029-org-bu-${stamp}@helix.example`, password: newPassword() },
  };
  results.identities = [
    { role: "administrator", account: "Daniel Okafor (seeded)" },
    { role: "legal_team_member", account: "Nadia Haddad (seeded), unauthorized-administration check" },
    { role: "invited colleague", account: `DOC-029 admin-org Avery ${stamp}` },
    { role: "withdrawn invitation", account: `DOC-029 admin-org Bryn ${stamp}` },
    { role: "business_user", account: `doc029-org-bu-${stamp}@helix.example (Portal-created)` },
  ];

  await step(A, "legal_team_member", "Unauthorized administration: open Settings General and Users as a Legal Team Member", "Redirected away; the users and invite APIs refuse", async () => {
    const n = await context();
    await signIn(n.page, app, NADIA);
    const out = {};
    for (const p of ["/settings/general", "/settings/users"]) {
      await n.page.goto(`${app}${p}`);
      await n.page.waitForLoadState("networkidle");
      out[p] = new URL(n.page.url()).pathname;
    }
    const users = await api(n.page, app, "GET", "/api/v1/users");
    const inv = await api(n.page, app, "POST", "/api/v1/auth/invites", { email: `doc029-org-denied-${stamp}@helix.example`, displayName: "DOC-029 admin-org denied", role: "legal_team_member" });
    await n.ctx.close();
    expect(out["/settings/general"] === "/settings/profile" && out["/settings/users"] === "/settings/profile", `landed on ${JSON.stringify(out)}`);
    expect(users.status === 403 && inv.status === 403, `users ${users.status}, invite ${inv.status}`);
    return `Settings General and Users redirected Nadia to /settings/profile. GET /api/v1/users answered ${users.status}; POST /api/v1/auth/invites answered ${inv.status}.`;
  });

  const original = (await api(admin.page, app, "GET", "/api/v1/org/general")).data.general;
  results.restoreTargets = { organizationName: original.name, logoWasNull: original.logo === null, defaultTimezone: original.defaultTimezone };

  await step(A, "administrator", "Update organization details: Organization name saves on Enter, Escape restores, leaving the field saves", "Saved status; Escape restores the previous name before saving; values survive reload", async () => {
    const { page } = admin;
    await page.goto(`${app}/settings/general`);
    const box = page.getByRole("textbox", { name: "Organization name" });
    const draft = `DOC-029 admin-org Helix ${stamp}`;
    await box.fill(draft);
    await box.press("Enter");
    await page.getByText("Saved", { exact: true }).first().waitFor();
    await page.reload();
    const afterEnter = await box.inputValue();
    await box.fill("DOC-029 admin-org unsaved draft");
    await box.press("Escape");
    const afterEscape = await box.inputValue();
    await page.reload();
    const afterEscapeReload = await box.inputValue();
    await box.fill(original.name);
    await box.press("Tab");
    await page.getByText("Saved", { exact: true }).first().waitFor();
    await page.reload();
    const restored = await box.inputValue();
    expect(afterEnter === draft, `after Enter+reload: ${afterEnter}`);
    expect(afterEscape === draft && afterEscapeReload === draft, `after Escape: ${afterEscape} / ${afterEscapeReload}`);
    expect(restored === original.name, `restore by leaving field: ${restored}`);
    return `Enter showed Saved and "${draft}" survived reload. Escape put the saved name back in the field and nothing new saved. Typing the original name and leaving the field showed Saved; after reload the name was the original "${original.name}" again.`;
  });

  await step(A, "administrator", "Logo: Upload a supported image; a rejected file shows an error and can be retried", "PNG saves; unsupported type and oversize files are refused", async () => {
    const { page } = admin;
    const fx = path.join(here, "fixtures");
    mkdirSync(fx, { recursive: true });
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    writeFileSync(path.join(fx, "doc029-logo.png"), png);
    writeFileSync(path.join(fx, "doc029-not-an-image.txt"), "DOC-029 admin-org fixture: not an image\n");
    writeFileSync(path.join(fx, "doc029-logo-too-large.png"), Buffer.concat([png, Buffer.alloc(300 * 1024)]));
    await page.goto(`${app}/settings/general`);
    const upload = async (file) => {
      const chooser = page.waitForEvent("filechooser");
      await page.getByRole("button", { name: "Upload", exact: true }).click();
      await (await chooser).setFiles(path.join(fx, file));
    };
    await upload("doc029-not-an-image.txt");
    await page.getByText("The change could not be saved. Try again.").waitFor();
    await upload("doc029-logo-too-large.png");
    await page.getByText("The change could not be saved. Try again.").waitFor();
    const afterRejects = (await api(page, app, "GET", "/api/v1/org/general")).data.general.logo;
    await upload("doc029-logo.png");
    await page.getByText("Saved", { exact: true }).first().waitFor();
    await page.reload();
    const saved = (await api(page, app, "GET", "/api/v1/org/general")).data.general.logo;
    await page.getByRole("combobox", { name: "Default locale" }).waitFor();
    const imgs = await page.locator('img[src^="data:image/png"]').count();
    expect(imgs === 1, `logo images in pane: ${imgs}`);
    // Restore: the pane has no remove control, so the recorded original (none) is put back through the API.
    const restore = await api(page, app, "PATCH", "/api/v1/org/general", { logo: original.logo });
    expect(afterRejects === original.logo, "a rejected file changed the logo");
    expect(typeof saved === "string" && saved.startsWith("data:image/png"), `saved logo ${String(saved).slice(0, 30)}`);
    expect(restore.status === 200, `restore ${restore.status}`);
    return `A .txt file and a 300 KB PNG each showed "The change could not be saved. Try again." and left the logo unchanged. Retrying with a 1x1 PNG showed Saved, and after reload the logo was a PNG data URI displayed as an image beside Logo. The original empty logo was restored through PATCH /api/v1/org/general (${restore.status}) because the pane has no remove control.`;
  });

  await step(A, "administrator", "Default timezone saves and survives reload; Default locale offers English (United States) only", "Timezone saved; one locale option", async () => {
    const { page } = admin;
    await page.goto(`${app}/settings/general`);
    const tz = page.getByRole("combobox", { name: "Default timezone" });
    await tz.click();
    await tz.fill("Toronto");
    await tz.press("Enter");
    await page.getByText("Saved", { exact: true }).first().waitFor();
    await page.reload();
    const after = await tz.inputValue();
    const locales = await page.getByRole("combobox", { name: "Default locale" }).locator("option").allInnerTexts();
    await tz.click();
    await tz.fill(original.defaultTimezone);
    await tz.press("Enter");
    await page.getByText("Saved", { exact: true }).first().waitFor();
    await page.reload();
    const restored = await tz.inputValue();
    expect(after.startsWith("America/Toronto"), `after reload ${after}`);
    expect(locales.length === 1 && locales[0].trim() === "English (United States)", `locales ${locales}`);
    expect(restored.startsWith(original.defaultTimezone), `restored ${restored}`);
    return `Default timezone saved America/Toronto and kept it after reload. Default locale offered only ${JSON.stringify(locales)}. The timezone was restored to ${original.defaultTimezone}.`;
  });

  let sinceA;
  await step(A, "administrator", "Invite a colleague: Invite user with Display name, Email, and Role Legal team member", "Role offers Legal team member and Administrator; Send invite adds an Invited row with Resend invite and Revoke invite; email arrives", async () => {
    const { page } = admin;
    await openUsers(page, app);
    await page.getByRole("button", { name: "Invite user" }).click();
    const dialog = page.getByRole("dialog", { name: "Invite user" });
    const radios = await dialog.getByRole("radio").evaluateAll((els) => els.map((e) => e.closest("label")?.innerText.trim()));
    await dialog.getByRole("button", { name: "Cancel" }).click();
    sinceA = new Date(Date.now() - 2000);
    const d = await invite(page, people.a.name, people.a.email, "Legal team member");
    await d.waitFor({ state: "hidden" });
    const state = await rowState(page, people.a.email);
    const m = await waitMail(mail, people.a.email, sinceA, SET_PASSWORD);
    expect(JSON.stringify(radios) === JSON.stringify(["Legal team member", "Administrator"]), `radios ${radios}`);
    expect(state.status === "Invited" && !state.roleControl && state.actions.includes("Resend invite") && state.actions.includes("Revoke invite"), JSON.stringify(state));
    expect(m, "no invitation email");
    return `Role radios were ${JSON.stringify(radios)}. After Send invite the row read Invited with actions ${JSON.stringify(state.actions)} and no role control. Mailpit received "${m.subject}" with a set-password link.`;
  });

  await step(A, "administrator", "Invalid address is rejected", "No row is created for an invalid address", async () => {
    const { page } = admin;
    await openUsers(page, app);
    const before = (await api(page, app, "GET", "/api/v1/users")).data.users.length;
    const d = await invite(page, "DOC-029 admin-org invalid", "doc029-org-invalid-address", "Legal team member");
    await sleep(800);
    const stillOpen = await d.isVisible();
    const validation = await d.getByLabel("Email").evaluate((el) => el.validationMessage);
    await d.getByRole("button", { name: "Cancel" }).click();
    const apiTry = await api(page, app, "POST", "/api/v1/auth/invites", { email: "doc029 org@@helix", displayName: "DOC-029 admin-org invalid", role: "legal_team_member" });
    const after = (await api(page, app, "GET", "/api/v1/users")).data.users.length;
    expect(stillOpen && before === after && apiTry.status >= 400, `open ${stillOpen}, users ${before}->${after}, api ${apiTry.status}`);
    return `The dialog stayed open with the browser message "${validation}" and no row was added. The same invite route refused a malformed address with ${apiTry.status}.`;
  });

  await step(A, "administrator", "Re-invite the pending address with the same role", "The invitation is resent; no duplicate row", async () => {
    const { page } = admin;
    await openUsers(page, app);
    const since = new Date(Date.now() - 1000);
    const d = await invite(page, people.a.name, people.a.email, "Legal team member");
    await d.waitFor({ state: "hidden" });
    const m = await waitMail(mail, people.a.email, since, SET_PASSWORD);
    await openUsers(page, app);
    const rows = await row(page, people.a.email).count();
    expect(m && rows === 1, `mail ${!!m}, rows ${rows}`);
    return `The dialog closed, a new "${m.subject}" email arrived, and the table still had exactly ${rows} row for the address.`;
  });

  await step(A, "administrator", "Re-invite the pending address with a different role", "Refused because the account already exists; no email", async () => {
    const { page } = admin;
    await openUsers(page, app);
    const since = new Date();
    const d = await invite(page, people.a.name, people.a.email, "Administrator");
    const alert = await d.getByRole("alert").innerText();
    await d.getByRole("button", { name: "Cancel" }).click();
    await sleep(2500);
    const n = await countMail(mail, people.a.email, since);
    expect(/already exists with a different role/.test(alert) && n === 0, `alert "${alert}", mails ${n}`);
    return `The dialog showed "${alert}" and no email was sent.`;
  });

  await step(A, "administrator", "Invite an already activated account", "Refused", async () => {
    const { page } = admin;
    await openUsers(page, app);
    const d = await invite(page, "Nadia Haddad", NADIA, "Legal team member");
    const alert = await d.getByRole("alert").innerText();
    await d.getByRole("button", { name: "Cancel" }).click();
    expect(/already activated/.test(alert), alert);
    return `The dialog showed "${alert}".`;
  });

  await step(A, "administrator", "Resend invite from the pending row", "A replacement link is emailed", async () => {
    const { page } = admin;
    await openUsers(page, app);
    const since = new Date(Date.now() - 1000);
    await row(page, people.a.email).getByRole("button", { name: `Resend the invite to ${people.a.email}` }).click();
    await row(page, people.a.email).getByText("Saved", { exact: true }).waitFor();
    const m = await waitMail(mail, people.a.email, since, SET_PASSWORD);
    expect(m, "no resend email");
    people.a.latestLink = m.link;
    return `The row showed Saved and a new "${m.subject}" email arrived. Its link is the latest one and is used for activation below.`;
  });

  const colleague = await context();
  await step(A, "invited colleague", "A magic-link sign-in alone does not activate the invited row", "The colleague signs in; the row stays Invited with Resend invite and Revoke invite", async () => {
    const { page } = colleague;
    const since = new Date(Date.now() - 1000);
    await requestMagicLink(page, app, people.a.email);
    const m = await waitMail(mail, people.a.email, since, MAGIC);
    expect(m, "no magic link");
    await page.goto(m.link);
    await page.waitForLoadState("networkidle");
    const landed = new URL(page.url()).pathname;
    const me = await api(page, app, "GET", "/api/v1/me");
    await openUsers(admin.page, app);
    const state = await rowState(admin.page, people.a.email);
    expect(!landed.startsWith("/auth/login"), `landed ${landed}`);
    expect(state.status === "Invited" && state.actions.includes("Resend invite") && state.actions.includes("Revoke invite") && !state.roleControl, JSON.stringify(state));
    return `The staff sign-in page sent "${m.subject}". Opening the link signed the colleague in (landed on ${landed}; /api/v1/me ${me.status}). Daniel's Users table still showed the row as Invited with ${JSON.stringify(state.actions)} and no role control.`;
  });

  await step(A, "invited colleague", "Set a password from the latest invitation link; the row becomes Active", "Password set; row Active with role control", async () => {
    const { page } = colleague;
    await setPasswordFromLink(page, people.a.latestLink, people.a.password);
    const check = await context();
    await signIn(check.page, app, people.a.email, people.a.password);
    const me = await api(check.page, app, "GET", "/api/v1/me");
    await check.ctx.close();
    expect(me.status === 200, `password sign-in ${me.status}`);
    await openUsers(admin.page, app);
    const state = await rowState(admin.page, people.a.email);
    expect(state.status === "Active" && state.roleControl, JSON.stringify(state));
    return `"Password set" appeared and the colleague signed in with the new password. The row read Active with a role control and actions ${JSON.stringify(state.actions)}.`;
  });

  await step(A, "invited colleague", "The activated Legal team member checks their access", "No administration: Users redirects and there is no Invite user", async () => {
    const { page } = colleague;
    await page.goto(`${app}/settings/users`);
    await page.waitForLoadState("networkidle");
    const p = new URL(page.url()).pathname;
    const invites = await page.getByRole("button", { name: "Invite user" }).count();
    expect(p === "/settings/profile" && invites === 0, `${p}, invite buttons ${invites}`);
    return `Settings Users redirected to ${p}; no Invite user control was offered.`;
  });

  await step(A, "administrator", "Revoke invite withdraws an unused invitation", "The pending row is removed", async () => {
    const { page } = admin;
    await openUsers(page, app);
    const d = await invite(page, people.b.name, people.b.email, "Legal team member");
    await d.waitFor({ state: "hidden" });
    const before = await rowState(page, people.b.email);
    await row(page, people.b.email).getByRole("button", { name: `Revoke the invite to ${people.b.email}` }).click();
    await row(page, people.b.email).waitFor({ state: "detached" });
    const list = (await api(page, app, "GET", "/api/v1/users")).data.users.some((u) => u.email === people.b.email);
    expect(before.status === "Invited" && !list, `before ${JSON.stringify(before)}, still listed ${list}`);
    return `The Invited row for Bryn disappeared after Revoke invite, and GET /api/v1/users no longer listed the address.`;
  });

  await step(A, "administrator", "Change a role: promote the colleague to Administrator; the change applies on their next action", "Role control offers three roles; colleague gains administration without signing in again", async () => {
    const { page } = admin;
    await openUsers(page, app);
    const items = await chooseRole(page, people.a.email, "Administrator");
    await row(page, people.a.email).getByText("Saved", { exact: true }).waitFor();
    await openUsers(page, app);
    const state = (await row(page, people.a.email).innerText()).includes("Administrator");
    await colleague.page.goto(`${app}/settings/users`);
    await colleague.page.getByRole("heading", { name: "Users", level: 2 }).waitFor({ timeout: 15000 });
    expect(JSON.stringify(items) === JSON.stringify(["Administrator", "Legal team member", "Business user"]), `items ${items}`);
    expect(state, "row did not read Administrator");
    return `The role menu offered ${JSON.stringify(items)}. Choosing Administrator showed Saved and the reloaded row read Administrator. The colleague's existing session opened Settings Users on its next navigation without signing in again.`;
  });

  await step(A, "administrator", "Change the role back to Legal team member", "The colleague loses administration on the next request", async () => {
    const { page } = admin;
    await openUsers(page, app);
    await chooseRole(page, people.a.email, "Legal team member");
    await row(page, people.a.email).getByText("Saved", { exact: true }).waitFor();
    const r = await api(colleague.page, app, "GET", "/api/v1/users");
    expect(r.status === 403, `status ${r.status}`);
    return `The row saved Legal team member. The colleague's same session got ${r.status} from GET /api/v1/users on its next request.`;
  });

  const bu = await context();
  await step(A, "administrator", "Promote a Portal-created Business User with no password: the row becomes Invited without a role control", "Invited row; Resend invite emails a link; setting a password returns Active with role control", async () => {
    const since = new Date(Date.now() - 1000);
    await requestMagicLink(bu.page, app, people.bu.email, true);
    const m = await waitMail(mail, people.bu.email, since, MAGIC);
    expect(m, "no Portal sign-in link");
    await bu.page.goto(m.link);
    await bu.page.waitForURL((u) => u.pathname.startsWith("/portal"), { timeout: 20000 });
    const { page } = admin;
    await openUsers(page, app);
    const before = await rowState(page, people.bu.email);
    // Negative check: an invitation naming a Business User's address is refused.
    const d = await invite(page, "DOC-029 admin-org BU", people.bu.email, "Legal team member");
    const alert = await d.getByRole("alert").innerText();
    await d.getByRole("button", { name: "Cancel" }).click();
    await chooseRole(page, people.bu.email, "Legal team member");
    await sleep(1500);
    await openUsers(page, app);
    const promoted = await rowState(page, people.bu.email);
    const since2 = new Date(Date.now() - 1000);
    await row(page, people.bu.email).getByRole("button", { name: `Resend the invite to ${people.bu.email}` }).click();
    const inv = await waitMail(mail, people.bu.email, since2, SET_PASSWORD);
    expect(inv, "no resend email");
    const fresh = await context();
    await setPasswordFromLink(fresh.page, inv.link, people.bu.password);
    await fresh.ctx.close();
    await openUsers(page, app);
    const activated = await rowState(page, people.bu.email);
    expect(before.status === "Active" && before.roleControl && before.role === "Business user", `before ${JSON.stringify(before)}`);
    expect(/already/i.test(alert), `invite alert ${alert}`);
    expect(promoted.status === "Invited" && !promoted.roleControl && promoted.actions.includes("Resend invite"), `promoted ${JSON.stringify(promoted)}`);
    expect(activated.status === "Active" && activated.roleControl, `activated ${JSON.stringify(activated)}`);
    return `The Portal sign-in link created an Active Business user row with a role control. Inviting that address as a Legal team member was refused with "${alert}". Promoting it to Legal team member turned the row Invited with ${JSON.stringify(promoted.actions)} and no role control. Resend invite sent "${inv.subject}"; after the password was set the row read Active with its role control back.`;
  });

  await step(A, "administrator", "Return the activated account to Business user, then promote again", "An already activated account stays Active and keeps its role control", async () => {
    const { page } = admin;
    await openUsers(page, app);
    await chooseRole(page, people.bu.email, "Business user");
    await row(page, people.bu.email).getByText("Saved", { exact: true }).waitFor();
    await openUsers(page, app);
    const back = await rowState(page, people.bu.email);
    await chooseRole(page, people.bu.email, "Legal team member");
    await row(page, people.bu.email).getByText("Saved", { exact: true }).waitFor();
    await openUsers(page, app);
    const again = await rowState(page, people.bu.email);
    await chooseRole(page, people.bu.email, "Business user");
    await row(page, people.bu.email).getByText("Saved", { exact: true }).waitFor();
    expect(back.status === "Active" && back.roleControl && again.status === "Active" && again.roleControl, `back ${JSON.stringify(back)} again ${JSON.stringify(again)}`);
    return `Returned to Business user the row stayed Active with a role control. Promoted again it stayed Active with its role control, as the article's "If it still reads Active" branch says. It was left as a Business user.`;
  });

  await step(A, "administrator", "Your own row has no Sign out user or Archive action; self-archive is refused", "No row actions on Daniel's row; API refuses self archive", async () => {
    const { page } = admin;
    await openUsers(page, app);
    const self = await rowState(page, DANIEL);
    const me = (await api(page, app, "GET", "/api/v1/users")).data.users.find((u) => u.email === DANIEL);
    const r = await api(page, app, "POST", `/api/v1/users/${me.id}/archive`);
    expect(self.roleControl && !self.actions.includes("Sign out user") && !self.actions.includes("Archive"), JSON.stringify(self));
    expect(r.status >= 400, `self archive ${r.status}`);
    return `Daniel's own row had a role control and no Sign out user or Archive action (buttons: ${JSON.stringify(self.actions)}). A direct archive request for his own account was refused with ${r.status}: "${r.data?.detail}".`;
  });

  await step(A, "administrator", "Sign out user ends the colleague's sessions; the account stays active and can sign in again", "Colleague's next request needs sign-in; row Active; password sign-in works", async () => {
    const { page } = admin;
    await openUsers(page, app);
    const before = await api(colleague.page, app, "GET", "/api/v1/me");
    await row(page, people.a.email).getByRole("button", { name: `Revoke all sessions of ${people.a.email}` }).click();
    await row(page, people.a.email).getByText("Saved", { exact: true }).waitFor();
    const after = await api(colleague.page, app, "GET", "/api/v1/me");
    await colleague.page.goto(`${app}/`);
    await colleague.page.waitForLoadState("networkidle");
    const landed = new URL(colleague.page.url()).pathname;
    const state = await rowState(page, people.a.email);
    await signIn(colleague.page, app, people.a.email, people.a.password);
    const again = await api(colleague.page, app, "GET", "/api/v1/me");
    expect(before.status === 200 && after.status === 401 && landed.startsWith("/auth/login"), `before ${before.status} after ${after.status} landed ${landed}`);
    expect(state.status === "Active" && again.status === 200, `state ${JSON.stringify(state)} again ${again.status}`);
    return `The visible action label was "Sign out user". The colleague's session went from ${before.status} to ${after.status} on /api/v1/me and the app sent it to ${landed}. The row stayed Active, and a password sign-in worked again (${again.status}).`;
  });

  let contractNumber;
  await step(A, "administrator", "Archiving does not bulk-reassign work: a Contract keeps its Owner", "The archived person stays the Contract Owner until someone reassigns it", async () => {
    const { page } = admin;
    const users = (await api(page, app, "GET", "/api/v1/users")).data.users;
    const aId = users.find((u) => u.email === people.a.email).id;
    const types = (await api(page, app, "GET", "/api/v1/contract-types")).data.contractTypes;
    const other = types.find((t) => t.slug === "other") ?? types[0];
    const created = await api(page, app, "POST", "/api/v1/contracts", { title: `DOC-029 admin-org offboarding contract ${stamp}`, contractTypeId: other.id, managerId: aId });
    expect(created.status === 201 || created.status === 200, `create ${created.status} ${JSON.stringify(created.data)}`);
    contractNumber = created.data.contract.number;
    results.records = [...(results.records ?? []), `Contract ${contractNumber} "DOC-029 admin-org offboarding contract ${stamp}"`];
    people.a.id = aId;
    return `Created Contract ${contractNumber} with the colleague as Legal Owner (prepared through the API; the check follows in the archive step).`;
  });

  await step(A, "administrator", "Archive the colleague: the row leaves the ordinary list, sessions end, sign-in is blocked", "Row hidden; live session ends; password sign-in refused; Contract Owner unchanged", async () => {
    const { page } = admin;
    await openUsers(page, app);
    const live = await api(colleague.page, app, "GET", "/api/v1/me");
    await row(page, people.a.email).getByRole("button", { name: `Archive ${people.a.email}` }).click();
    await row(page, people.a.email).waitFor({ state: "detached", timeout: 10000 });
    const after = await api(colleague.page, app, "GET", "/api/v1/me");
    const fresh = await context();
    await fresh.page.goto(`${app}/auth/login`);
    await fresh.page.getByLabel("Email", { exact: true }).fill(people.a.email);
    await fresh.page.getByLabel("Password", { exact: true }).fill(people.a.password);
    await fresh.page.getByRole("button", { name: "Sign in", exact: true }).click();
    const alert = await fresh.page.getByRole("alert").first().innerText({ timeout: 15000 });
    await fresh.ctx.close();
    const contract = await api(page, app, "GET", `/api/v1/contracts/${contractNumber}`);
    const manager = contract.data?.contract?.manager;
    expect(live.status === 200 && after.status === 401, `live ${live.status} after ${after.status}`);
    expect(/archived/i.test(alert), `sign-in alert ${alert}`);
    expect(manager?.id === people.a.id && manager?.archived === true, `manager ${JSON.stringify(manager)}`);
    return `Archive removed the row from the ordinary list at once. The colleague's live session went from ${live.status} to ${after.status}. A new password sign-in showed "${alert}". Contract ${contractNumber} still named the archived colleague as Legal Owner (archived: ${manager.archived}); nothing was reassigned.`;
  });

  await step(A, "administrator", "Show archived, Restore, and ask the user to sign in again", "Restored row Active; the revoked session stays revoked; a new sign-in works", async () => {
    const { page } = admin;
    await openUsers(page, app);
    await page.getByRole("switch", { name: "Show archived" }).click();
    const archived = await rowState(page, people.a.email);
    await row(page, people.a.email).getByRole("button", { name: `Restore ${people.a.email}` }).click();
    await row(page, people.a.email).getByText("Saved", { exact: true }).waitFor();
    const restored = await rowState(page, people.a.email);
    const old = await api(colleague.page, app, "GET", "/api/v1/me");
    await signIn(colleague.page, app, people.a.email, people.a.password);
    const again = await api(colleague.page, app, "GET", "/api/v1/me");
    expect(archived.status === "Archived" && archived.actions.includes("Restore"), `archived ${JSON.stringify(archived)}`);
    expect(restored.status === "Active" && old.status === 401 && again.status === 200, `restored ${JSON.stringify(restored)} old ${old.status} again ${again.status}`);
    return `With Show archived on, the row read Archived with a Restore action. Restore showed Saved and the row read Active. The old browser session still got ${old.status}; a fresh password sign-in got ${again.status}.`;
  });

  await shot(admin.page, "org-users-restored");
  await Promise.all([admin.ctx.close(), colleague.ctx.close(), bu.ctx.close()]);
}

// ---------------------------------------------------------------------------
// V-C55 approver-groups on the shared admin lab.
async function groups() {
  const A = "approver-groups";
  const { app, mail } = ADMIN_LAB;
  const admin = await context();
  await signIn(admin.page, app, DANIEL);
  const members = [
    { key: "m1", name: `DOC-029 admin-org Approver One ${stamp}`, email: `doc029-grp-one-${stamp}@helix.example`, password: newPassword() },
    { key: "m2", name: `DOC-029 admin-org Approver Two ${stamp}`, email: `doc029-grp-two-${stamp}@helix.example`, password: newPassword() },
  ];
  const groupName = `DOC-029 admin-org Group ${stamp}`;
  const records = [];
  results.identities = [
    { role: "administrator", account: "Daniel Okafor (seeded)" },
    { role: "legal_team_member", account: "Nadia Haddad (seeded)" },
    { role: "legal_team_member", account: members[0].name },
    { role: "legal_team_member", account: members[1].name },
  ];

  await step(A, "administrator", "Prepare two active Legal Team Members through Invite user and set-password links", "Both rows Active", async () => {
    await openUsers(admin.page, app);
    for (const m of members) {
      const since = new Date(Date.now() - 1000);
      const d = await invite(admin.page, m.name, m.email, "Legal team member");
      await d.waitFor({ state: "hidden" });
      const link = await waitMail(mail, m.email, since, SET_PASSWORD);
      const c = await context();
      await setPasswordFromLink(c.page, link.link, m.password);
      await c.ctx.close();
    }
    const users = (await api(admin.page, app, "GET", "/api/v1/users")).data.users;
    for (const m of members) m.id = users.find((u) => u.email === m.email)?.id;
    const statuses = members.map((m) => users.find((u) => u.id === m.id)?.status);
    expect(statuses.every((s) => s === "active"), JSON.stringify(statuses));
    return `Invited and activated ${members.map((m) => m.name).join(" and ")}; both rows are active.`;
  });

  await step(A, "legal_team_member", "Unauthorized configuration: a Legal Team Member cannot open or change Approver groups", "Redirected; API refuses", async () => {
    const n = await context();
    await signIn(n.page, app, NADIA);
    await n.page.goto(`${app}/settings/contracts/approver-groups`);
    await n.page.waitForLoadState("networkidle");
    const p = new URL(n.page.url()).pathname;
    const list = await api(n.page, app, "GET", "/api/v1/approver-groups");
    const create = await api(n.page, app, "POST", "/api/v1/approver-groups", { name: `DOC-029 admin-org denied ${stamp}`, memberIds: [] });
    await n.ctx.close();
    expect(p !== "/settings/contracts/approver-groups" && create.status === 403, `path ${p}, list ${list.status}, create ${create.status}`);
    return `Nadia was sent to ${p}. GET /api/v1/approver-groups answered ${list.status}; POST answered ${create.status}.`;
  });

  await step(A, "administrator", "Create a group: profile menu, Settings, Contracts, Approver groups, Add group", "Picker lists only Administrators and Legal team members; saved members show on Edit", async () => {
    const { page } = admin;
    await page.goto(`${app}/`);
    await page.getByRole("banner").getByRole("button", { name: "Daniel Okafor" }).click();
    await page.getByRole("menuitem", { name: "Settings" }).click();
    await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "Contracts" }).click();
    await page.getByRole("navigation", { name: "Contracts panes" }).getByRole("link", { name: "Approver groups" }).click();
    await page.getByRole("heading", { name: "Approver groups", level: 2 }).waitFor();
    const reachedAt = new URL(page.url()).pathname;
    await page.getByRole("button", { name: "Add group" }).click();
    const dialog = page.getByRole("dialog", { name: "Add approver group" });
    await dialog.getByLabel("Name").fill(groupName);
    await dialog.getByLabel("Description").fill("DOC-029 admin-org walkthrough group. Use for reviewer checks only.");
    const candidateEmails = await dialog.locator("fieldset li").allInnerTexts();
    const users = (await api(page, app, "GET", "/api/v1/users")).data.users;
    const businessEmails = users.filter((u) => u.role === "business_user").map((u) => u.email);
    const offeredBusiness = candidateEmails.filter((t) => businessEmails.some((e) => t.includes(e)));
    for (const m of members) await dialog.getByRole("checkbox", { name: new RegExp(m.email.replace(/\./g, "\\.")) }).check();
    await dialog.getByRole("button", { name: "Add group" }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.reload();
    await page.getByRole("button", { name: `Edit ${groupName}` }).click();
    const edit = page.getByRole("dialog", { name: `Edit ${groupName}` });
    const checked = [];
    for (const m of members) checked.push(await edit.getByRole("checkbox", { name: new RegExp(m.email.replace(/\./g, "\\.")) }).isChecked());
    await edit.getByRole("button", { name: "Cancel" }).click();
    const group = (await api(page, app, "GET", "/api/v1/approver-groups")).data.approverGroups.find((g) => g.name === groupName);
    members.groupId = group.id;
    records.push(`Approver group "${groupName}"`);
    expect(reachedAt === "/settings/contracts/approver-groups", reachedAt);
    expect(offeredBusiness.length === 0, `business users offered: ${offeredBusiness}`);
    expect(checked.every(Boolean) && group.memberCount === 2, `checked ${checked}, count ${group.memberCount}`);
    return `The profile menu path reached ${reachedAt}. The Members picker listed ${candidateEmails.length} people and none of the ${businessEmails.length} Business Users. After Add group and reload, Edit showed both chosen members checked (memberCount ${group.memberCount}).`;
  });

  await step(A, "administrator", "Non-Member+ selection is refused", "A Business User cannot be saved as a member", async () => {
    const { page } = admin;
    const users = (await api(page, app, "GET", "/api/v1/users")).data.users;
    const businessUser = users.find((u) => u.role === "business_user" && u.status === "active");
    const r = await api(page, app, "PUT", `/api/v1/approver-groups/${members.groupId}/members`, { memberIds: [members[0].id, businessUser.id] });
    const group = (await api(page, app, "GET", "/api/v1/approver-groups")).data.approverGroups.find((g) => g.id === members.groupId);
    expect(r.status >= 400 && group.memberCount === 2, `status ${r.status}, count ${group.memberCount}`);
    return `The picker offers no Business User, so the refusal was checked on the member-list write the editor uses: adding a Business User was refused with ${r.status} ("${r.data?.detail}") and the group still had ${group.memberCount} members.`;
  });

  async function newContract(label, extra = {}) {
    const types = (await api(admin.page, app, "GET", "/api/v1/contract-types")).data.contractTypes;
    const other = types.find((t) => t.slug === "other") ?? types[0];
    const title = `DOC-029 admin-org ${label} ${stamp}`;
    const r = await api(admin.page, app, "POST", "/api/v1/contracts", { title, contractTypeId: other.id, ...extra });
    expect(r.data?.contract?.number, `create ${r.status} ${JSON.stringify(r.data)}`);
    records.push(`Contract ${r.data.contract.number} "${title}"`);
    return r.data.contract.number;
  }
  async function approvals(page, number) {
    const r = await api(page, app, "GET", `/api/v1/contracts/${number}/approvals`);
    return (r.data?.approvals ?? []).map((x) => ({ approver: x.approver?.id ?? x.approverId, status: x.status, source: x.source, group: x.groupName ?? x.approverGroupName ?? x.group?.name ?? null }));
  }
  async function openApply(page, number) {
    await page.goto(`${app}/contracts/${number}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("link", { name: /^Approvals/ }).click();
    await page.waitForURL(/\/approvals$/);
    const card = page.getByRole("region", { name: "Approvals & signing" });
    await card.getByRole("button", { name: "Apply group" }).click();
    const dialog = page.getByRole("dialog", { name: "Apply approver group" });
    await dialog.getByLabel("Approver group").selectOption({ label: groupName });
    return { card, dialog };
  }

  let c1;
  await step(A, "administrator", "Apply the group on a Contract and check the Pending rows", "Dialog names the people and warns about the snapshot; one Pending request per member", async () => {
    c1 = await newContract("approvals contract one");
    const { page } = admin;
    const { card, dialog } = await openApply(page, c1);
    const text = (await dialog.innerText()).replace(/\s+/g, " ");
    await dialog.getByRole("button", { name: "Apply group" }).click();
    await dialog.waitFor({ state: "hidden" });
    const rows = await approvals(page, c1);
    const pendingText = await card.getByText("Pending").count();
    expect(/Asks /.test(text) && members.every((m) => text.includes(m.name)), `dialog ${text}`);
    expect(/A later edit to the group leaves these requests as they are/.test(text), "no snapshot warning");
    expect(rows.length === 2 && rows.every((r) => r.status === "pending") && members.every((m) => rows.some((r) => r.approver === m.id)), JSON.stringify(rows));
    members.c1Rows = rows;
    return `On Contract ${c1}, Approvals then Approvals & signing offered Apply group. The dialog read: "${text.slice(0, 400)}". Applying created ${rows.length} pending requests, one per member (${pendingText} Pending labels in the card).`;
  });

  await step(A, "administrator", "Applying again when every member already has a pending request is refused", "Refused; no new rows", async () => {
    const { page } = admin;
    const { dialog } = await openApply(page, c1);
    const text = (await dialog.innerText()).replace(/\s+/g, " ");
    const button = dialog.getByRole("button", { name: "Apply group" });
    const disabled = await button.isDisabled();
    let alert = "";
    if (!disabled) {
      await button.click();
      alert = await dialog.getByRole("alert").innerText().catch(() => "");
    }
    await page.keyboard.press("Escape");
    const direct = await api(page, app, "POST", `/api/v1/contracts/${c1}/approvals/group`, { groupId: members.groupId });
    const rows = await approvals(page, c1);
    expect(/already has a request open/.test(text) && rows.length === 2 && direct.status >= 400, `text ${text}; rows ${rows.length}; direct ${direct.status}`);
    return `The dialog read "Everybody in this group already has a request open." (Apply group disabled: ${disabled}${alert ? `, alert "${alert}"` : ""}). The apply route refused with ${direct.status} ("${direct.data?.detail}"); the Contract still had ${rows.length} requests.`;
  });

  await step(A, "administrator", "A member with a pending request on the Contract is skipped", "Dialog says it skips one person; only the other member gets a request", async () => {
    const c2 = await newContract("approvals contract two");
    members.c2 = c2;
    const { page } = admin;
    const manual = await api(page, app, "POST", `/api/v1/contracts/${c2}/approvals`, { approverIds: [members[0].id] });
    expect(manual.status === 201, `manual ${manual.status}`);
    const { dialog } = await openApply(page, c2);
    const text = (await dialog.innerText()).replace(/\s+/g, " ");
    await dialog.getByRole("button", { name: "Apply group" }).click();
    await dialog.waitFor({ state: "hidden" });
    const rows = await approvals(page, c2);
    expect(/Skips 1 person who already has a request open/.test(text), text);
    expect(rows.length === 2 && rows.filter((r) => r.approver === members[0].id).length === 1, JSON.stringify(rows));
    return `After one manual request for Approver One on Contract ${c2}, the dialog said "Skips 1 person who already has a request open." Applying left ${rows.length} requests: one each, no duplicate.`;
  });

  await step(A, "administrator", "A member who is no longer a Legal Team Member refuses the whole action by name", "Refused by name; no Approval Request created; editor marks the member Can no longer approve", async () => {
    const c3 = await newContract("approvals contract three");
    members.c3 = c3;
    const { page } = admin;
    await openUsers(page, app);
    await chooseRole(page, members[1].email, "Business user");
    await row(page, members[1].email).getByText("Saved", { exact: true }).waitFor();
    const { dialog } = await openApply(page, c3);
    await dialog.getByRole("button", { name: "Apply group" }).click();
    const alert = await dialog.getByRole("alert").innerText();
    await page.keyboard.press("Escape");
    const rows = await approvals(page, c3);
    await page.goto(`${app}/settings/contracts/approver-groups`);
    await page.getByRole("button", { name: `Edit ${groupName}` }).click();
    const edit = page.getByRole("dialog", { name: `Edit ${groupName}` });
    const flagged = await edit.locator("li").filter({ hasText: members[1].email }).getByText("Can no longer approve").count();
    const save = edit.getByRole("button", { name: "Save" });
    await save.click();
    const saveAlert = await edit.getByRole("alert").innerText({ timeout: 5000 }).catch(() => "(no alert)");
    const stillOpen = await edit.isVisible();
    if (stillOpen) await page.keyboard.press("Escape");
    const kept = (await api(page, app, "GET", "/api/v1/approver-groups")).data.approverGroups.find((g) => g.id === members.groupId);
    members.saveWithIneligible = { alert: saveAlert, dialogOpen: stillOpen, memberCount: kept.memberCount };
    const c1Rows = await approvals(page, c1);
    expect(alert.includes(members[1].name) && rows.length === 0, `alert "${alert}", rows ${rows.length}`);
    expect(flagged === 1, `flag count ${flagged}`);
    expect(JSON.stringify(c1Rows) === JSON.stringify(members.c1Rows), "earlier requests changed");
    return `With Approver Two changed to Business user, applying on Contract ${c3} showed "${alert}" and created ${rows.length} requests. The group editor marked Approver Two "Can no longer approve"; selecting Save with that member still ticked and nothing else changed showed ${saveAlert === "(no alert)" ? "no error" : `"${saveAlert}"`}, the dialog ${stillOpen ? "stayed open" : "closed"}, and the group still listed ${kept.memberCount} members. Contract ${c1}'s two earlier requests were unchanged.`;
  });

  await step(A, "administrator", "Restore the member's role and apply again", "Both requests are created", async () => {
    const { page } = admin;
    await openUsers(page, app);
    const before = await rowState(page, members[1].email);
    if (before.roleControl) {
      await chooseRole(page, members[1].email, "Legal team member");
      await sleep(1500);
    }
    await openUsers(page, app);
    const after = await rowState(page, members[1].email);
    const { dialog } = await openApply(page, members.c3);
    await dialog.getByRole("button", { name: "Apply group" }).click();
    await dialog.waitFor({ state: "hidden" });
    const rows = await approvals(page, members.c3);
    expect(after.status === "Active" && rows.length === 2, `after ${JSON.stringify(after)}, rows ${rows.length}`);
    return `Approver Two's row went back to Legal team member (row ${after.status}). Applying on Contract ${members.c3} then created ${rows.length} pending requests.`;
  });

  await step(A, "administrator", "Confidential Contract: a member outside the audience refuses the whole action by name", "Refused by name; no requests", async () => {
    const c4 = await newContract("confidential approvals contract", { isConfidential: true });
    const { page } = admin;
    const { dialog } = await openApply(page, c4);
    await dialog.getByRole("button", { name: "Apply group" }).click();
    const alert = await dialog.getByRole("alert").innerText({ timeout: 8000 }).catch(() => "(no alert)");
    await page.keyboard.press("Escape");
    const rows = await approvals(page, c4);
    expect(members.some((m) => alert.includes(m.name)) && rows.length === 0, `alert "${alert}", rows ${rows.length}`);
    return `On Confidential Contract ${c4}, created by Daniel with neither approver in its audience, Apply group showed "${alert}" and created ${rows.length} requests.`;
  });

  await step(A, "administrator", "Edit members, then archive and restore the group: earlier requests keep their named people", "Requests unchanged; archive confirmation needs no replacement; Show archived then Restore", async () => {
    const { page } = admin;
    const snapshot = await approvals(page, c1);
    await page.goto(`${app}/settings/contracts/approver-groups`);
    await page.getByRole("button", { name: `Edit ${groupName}` }).click();
    const edit = page.getByRole("dialog", { name: `Edit ${groupName}` });
    await edit.getByRole("checkbox", { name: new RegExp(members[1].email.replace(/\./g, "\\.")) }).uncheck();
    await edit.getByRole("checkbox", { name: /nadia\.haddad@helix\.example/ }).check();
    await edit.getByRole("button", { name: "Save" }).click();
    await edit.waitFor({ state: "hidden" });
    const afterEdit = await approvals(page, c1);
    await page.getByRole("button", { name: `Archive ${groupName}` }).click();
    const confirm = page.getByRole("dialog", { name: `Archive ${groupName}` });
    const confirmText = (await confirm.innerText()).replace(/\s+/g, " ");
    await confirm.getByRole("button", { name: "Archive group" }).click();
    await confirm.waitFor({ state: "hidden" });
    const afterArchive = await approvals(page, c1);
    await page.goto(`${app}/contracts/${members.c2}`);
    await page.getByRole("link", { name: /^Approvals/ }).click();
    const card = page.getByRole("region", { name: "Approvals & signing" });
    await card.getByRole("button", { name: "Add approver" }).waitFor();
    let offered = "(no Apply group button)";
    if (await card.getByRole("button", { name: "Apply group" }).count()) {
      await card.getByRole("button", { name: "Apply group" }).click();
      offered = JSON.stringify(await page.getByRole("dialog", { name: "Apply approver group" }).getByLabel("Approver group").locator("option").allInnerTexts());
      await page.keyboard.press("Escape");
    }
    await page.goto(`${app}/settings/contracts/approver-groups`);
    await page.getByRole("switch", { name: "Show archived" }).click();
    await page.getByRole("button", { name: `Restore ${groupName}` }).click();
    await page.getByRole("button", { name: `Edit ${groupName}` }).waitFor();
    const afterRestore = await approvals(page, c1);
    const group = (await api(page, app, "GET", "/api/v1/approver-groups")).data.approverGroups.find((g) => g.id === members.groupId);
    const same = [afterEdit, afterArchive, afterRestore].every((x) => JSON.stringify(x) === JSON.stringify(snapshot));
    expect(same, "earlier requests changed");
    expect(/Archive group/.test(confirmText) && !/replace/i.test(confirmText), confirmText);
    expect(offered.startsWith("[") && !offered.includes(groupName), `archived group offered: ${offered}`);
    expect(group.archivedAt === null && group.members.some((m) => m.email === NADIA), JSON.stringify(group));
    return `Save replaced Approver Two with Nadia Haddad. The archive confirmation read "${confirmText}" and asked for no replacement. While archived the group was not in Contract ${members.c2}'s picker (${offered}). Show archived then Restore returned it. Contract ${c1}'s two requests and their named people were identical before the edit, after it, after archive, and after restore.`;
  });

  await step(A, "administrator", "A group with no members is refused when applied", "Dialog says nobody to ask; no requests", async () => {
    const { page } = admin;
    const emptyName = `DOC-029 admin-org Empty group ${stamp}`;
    await page.goto(`${app}/settings/contracts/approver-groups`);
    await page.getByRole("button", { name: "Add group" }).click();
    const dialog = page.getByRole("dialog", { name: "Add approver group" });
    await dialog.getByLabel("Name").fill(emptyName);
    await dialog.getByRole("button", { name: "Add group" }).click();
    await dialog.waitFor({ state: "hidden" });
    records.push(`Approver group "${emptyName}" (archived at the end of this step)`);
    const c = await newContract("empty group contract");
    await page.goto(`${app}/contracts/${c}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("link", { name: /^Approvals/ }).click();
    await page.getByRole("region", { name: "Approvals & signing" }).getByRole("button", { name: "Apply group" }).click();
    const apply = page.getByRole("dialog", { name: "Apply approver group" });
    await apply.getByLabel("Approver group").selectOption({ label: emptyName });
    const text = (await apply.innerText()).replace(/\s+/g, " ");
    await apply.getByRole("button", { name: "Apply group" }).click();
    const alert = await apply.getByRole("alert").innerText({ timeout: 8000 }).catch(() => "(no alert)");
    await page.keyboard.press("Escape");
    const rows = await approvals(page, c);
    await page.goto(`${app}/settings/contracts/approver-groups`);
    await page.getByRole("button", { name: `Archive ${emptyName}` }).click();
    await page.getByRole("dialog", { name: `Archive ${emptyName}` }).getByRole("button", { name: "Archive group" }).click();
    expect(/nobody to ask/.test(text) && rows.length === 0 && alert !== "(no alert)", `text ${text}; alert ${alert}; rows ${rows.length}`);
    return `A group saved with no Members showed "This group has nobody to ask." in the apply dialog. Apply group was refused with "${alert}" and Contract ${c} had ${rows.length} requests. The empty group was then archived.`;
  });

  await step(A, "legal_team_member", "A Legal Team Member applies the group on a Contract they can open", "Requests created for the members who have none", async () => {
    const n = await context();
    await signIn(n.page, app, NADIA);
    const c5 = await newContract("legal apply contract");
    const { dialog } = await openApply(n.page, c5);
    const text = (await dialog.innerText()).replace(/\s+/g, " ");
    await dialog.getByRole("button", { name: "Apply group" }).click();
    await dialog.waitFor({ state: "hidden" });
    const rows = await approvals(n.page, c5);
    await n.ctx.close();
    expect(rows.length === 2, `rows ${rows.length}`);
    return `Nadia opened Contract ${c5}, Approvals, Approvals & signing, Apply group. The dialog read "${text.slice(0, 200)}" and applying created ${rows.length} pending requests.`;
  });

  results.records = records;
  await shot(admin.page, "groups-list");
  await admin.ctx.close();
}

// ---------------------------------------------------------------------------
// V-C37 authentication-and-email on the owned adminorg-auth lab.
const AUTH_ADMIN = { name: "DOC-029 Auth Admin", email: "doc029-auth-admin@helix.example" };
function totp(uri) {
  const secret = new URL(uri).searchParams.get("secret");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of secret.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1000000)).padStart(6, "0");
}

const AUTH_PASSWORD = process.env.AUTH_PASSWORD;
const A3 = "authentication-and-email";
const STORED_FROM = "DOC-029 Stored <stored-relay@helix.example>";
const ENV_FROM = "env-relay@helix.example";
const authAccounts = {
  admin: AUTH_ADMIN.email,
  legal: "doc029-auth-legal@helix.example",
  ssoStaff: "doc029-auth-sso@helix.example",
  offDomainStaff: "doc029-auth-staff@elsewhere.example",
  portalNew: `doc029-auth-portal-${stamp}@northwind.example`,
  portalPassword: `doc029-auth-portal-pw-${stamp}@northwind.example`,
  portalLate: `doc029-auth-portal-late-${stamp}@northwind.example`,
  unapproved: `doc029-auth-unapproved-${stamp}@unlisted.example`,
  jit: `doc029-auth-jit-${stamp}@northwind.example`,
  uninvitedStaff: `doc029-auth-uninvited-${stamp}@helix.example`,
};
async function authAdmin() {
  if (!AUTH_PASSWORD) throw new Error("AUTH_PASSWORD is required for the auth lab sections");
  const c = await context();
  await signIn(c.page, AUTH_LAB.app, AUTH_ADMIN.email, AUTH_PASSWORD);
  return c;
}
async function emailStep(page) {
  await page.goto(`${AUTH_LAB.app}/welcome`);
  await page.waitForLoadState("networkidle");
  for (let i = 0; i < 8; i++) {
    if (await page.getByRole("heading", { name: "Outbound email" }).count()) break;
    const cont = page.getByRole("button", { name: "Set up later" });
    if (await page.getByRole("button", { name: "Get started" }).count()) await page.getByRole("button", { name: "Get started" }).click();
    else if (await cont.count()) await cont.click();
    await sleep(500);
  }
  await page.getByRole("heading", { name: "Outbound email" }).waitFor();
}
const pageText = async (page) => (await page.locator("main").innerText()).replace(/\s+/g, " ");
const buttons = async (page) => (await page.locator("main").getByRole("button").allInnerTexts()).map((x) => x.trim()).filter(Boolean);

async function emailStored() {
  const { app, mail } = AUTH_LAB;
  results.phase = "stored: SMTP_URL and SMTP_FROM empty for app and worker (overlay-phase-stored.json)";
  const admin = await context();
  await step(A3, "administrator", "First-run: create the first Administrator; the wizard needs email before it can finish", "Welcome wizard opens; Skip optional steps on Welcome opens Outbound email while email is unset", async () => {
    const { page } = admin;
    await page.goto(`${app}/auth/setup`);
    await page.getByLabel("Name").fill(AUTH_ADMIN.name);
    await page.getByLabel("Email").fill(AUTH_ADMIN.email);
    await page.getByLabel("Password", { exact: true }).fill(AUTH_PASSWORD);
    await page.getByLabel("Confirm password").fill(AUTH_PASSWORD);
    await page.getByRole("button", { name: "Create Administrator" }).click();
    await page.waitForURL((u) => u.pathname.startsWith("/welcome"), { timeout: 20000 });
    await page.getByRole("button", { name: "Skip optional steps" }).click();
    await page.getByRole("heading", { name: "Outbound email" }).waitFor();
    const text = await pageText(page);
    const b = await buttons(page);
    const cont = page.getByRole("button", { name: "Continue" });
    expect(/Set up outbound email to finish instance setup/.test(text), text.slice(0, 300));
    expect(!b.includes("Set up later") && (await cont.isDisabled()), `buttons ${b}`);
    return `The first Administrator was created and landed on /welcome. Skip optional steps on the Welcome step opened Outbound email with "Set up outbound email to finish instance setup...". The step had no Set up later (buttons ${JSON.stringify(b)}) and Continue was disabled.`;
  });

  await step(A3, "administrator", "Outbound email: an SMTP relay URL that does not begin with smtp:// or smtps:// is refused", "Refused; source stays unset", async () => {
    const { page } = admin;
    await page.getByLabel("SMTP relay URL").fill("http://mailpit:1025");
    await page.getByLabel("From address").fill(STORED_FROM);
    await page.getByRole("button", { name: "Save relay" }).click();
    const alert = await page.locator("main").getByRole("alert").first().innerText({ timeout: 8000 });
    const settings = await api(page, app, "GET", "/api/v1/email-settings");
    expect(settings.data?.source === "unset", JSON.stringify(settings.data));
    return `Saving http://mailpit:1025 showed "${alert.trim()}". The email settings source stayed ${settings.data.source}.`;
  });

  await step(A3, "administrator", "Save relay, then Send test email to the signed-in Administrator", "Saved; URL not shown again; test message arrives from the stored From address", async () => {
    const { page } = admin;
    await page.getByLabel("SMTP relay URL").fill("smtp://mailpit:1025");
    await page.getByLabel("From address").fill(STORED_FROM);
    await page.getByRole("button", { name: "Save relay" }).click();
    await page.getByText("Relay saved.").waitFor();
    const text = await pageText(page);
    const inputs = await page.locator("main input").evaluateAll((els) => els.map((e) => e.value));
    const since = new Date(Date.now() - 1000);
    await page.getByRole("button", { name: "Send test email" }).click();
    await page.getByText(`Test email sent to ${AUTH_ADMIN.email}`).waitFor();
    const m = await waitMail(mail, AUTH_ADMIN.email, since, null);
    const cont = await page.getByRole("button", { name: "Continue" }).isDisabled();
    expect(/Outbound email is set in the app\. Mail is sent from/.test(text) && !text.includes("smtp://mailpit") && !inputs.some((v) => v.includes("smtp://")), text.slice(0, 300));
    expect(m && m.from === "stored-relay@helix.example", JSON.stringify(m));
    expect(!cont, "Continue still disabled");
    return `"Relay saved." appeared and the step read "Outbound email is set in the app. Mail is sent from ${STORED_FROM}." No field or text showed the relay URL. Send test email showed "Test email sent to ${AUTH_ADMIN.email}" and Mailpit received "${m.subject}" from ${m.from}. Continue became available.`;
  });

  await step(A3, "administrator", "Replace relay with a relay that cannot deliver; the test fails; replace again and retest", "Saved relay alone does not prove delivery; a corrected relay delivers", async () => {
    const { page } = admin;
    await page.getByRole("button", { name: "Replace relay" }).click();
    await page.getByLabel("SMTP relay URL").fill("smtp://doc029-unreachable-relay.invalid:2525");
    await page.getByLabel("From address").fill(STORED_FROM);
    await page.getByRole("button", { name: "Save relay" }).click();
    await page.getByText("Relay saved.").waitFor();
    await page.getByRole("button", { name: "Send test email" }).click();
    const failure = await page.getByText("The test email could not be sent.").innerText({ timeout: 60000 });
    await page.getByRole("button", { name: "Replace relay" }).click();
    await page.getByLabel("SMTP relay URL").fill("smtp://mailpit:1025");
    await page.getByLabel("From address").fill(STORED_FROM);
    await page.getByRole("button", { name: "Save relay" }).click();
    await page.getByText("Relay saved.").waitFor();
    const since = new Date(Date.now() - 1000);
    await page.getByRole("button", { name: "Send test email" }).click();
    await page.getByText(`Test email sent to ${AUTH_ADMIN.email}`).waitFor();
    const m = await waitMail(mail, AUTH_ADMIN.email, since, null);
    expect(m, "no message after correction");
    return `An unreachable relay saved with "Relay saved.", but Send test email showed "${failure.trim()}". Replace relay with the working relay, save, and a second test delivered "${m.subject}" from ${m.from}.`;
  });

  await step(A3, "administrator", "Clear relay stops email delivery when there is no environment override; save a valid replacement", "Source unset, Continue unavailable, no mail; saved replacement restores delivery", async () => {
    const { page } = admin;
    await page.getByRole("button", { name: "Clear relay" }).click();
    await page.getByText("Relay cleared. This instance can no longer send email.").waitFor();
    const source = (await api(page, app, "GET", "/api/v1/email-settings")).data?.source;
    const cont = await page.getByRole("button", { name: "Continue" }).isDisabled();
    const since = new Date();
    const reset = await api(page, app, "POST", "/api/v1/auth/password-setup", { email: AUTH_ADMIN.email });
    await sleep(3000);
    const n = await countMail(mail, AUTH_ADMIN.email, since);
    await page.getByLabel("SMTP relay URL").fill("smtp://mailpit:1025");
    await page.getByLabel("From address").fill(STORED_FROM);
    await page.getByRole("button", { name: "Save relay" }).click();
    await page.getByText("Relay saved.").waitFor();
    const since2 = new Date(Date.now() - 1000);
    await page.getByRole("button", { name: "Send test email" }).click();
    const m = await waitMail(mail, AUTH_ADMIN.email, since2, null);
    expect(source === "unset" && cont && n === 0 && reset.status >= 400, `source ${source}, continue disabled ${cont}, mails ${n}, reset ${reset.status}`);
    expect(m, "no mail after replacement");
    return `Clear relay showed "Relay cleared. This instance can no longer send email." The source became ${source} and Continue was disabled again. A password setup request for the Administrator answered ${reset.status} ("${reset.data?.detail}") and no message arrived. After a valid replacement was saved, a test message arrived again.`;
  });
  await admin.ctx.close();
}

async function emailEnv() {
  const { app, mail } = AUTH_LAB;
  results.phase = "env: SMTP_URL smtp://mailpit:1025 and SMTP_FROM DOC-029 Environment <env-relay@helix.example> (overlay-phase-env.json), stored relay still saved";
  const admin = await authAdmin();
  await step(A3, "operator", "Deployment sets SMTP_URL and SMTP_FROM: the wizard relay settings are read-only and the environment wins", "No Save relay, Replace relay or Clear relay; mail is sent from the environment sender, not the stored one", async () => {
    const { page } = admin;
    await emailStep(page);
    const text = await pageText(page);
    const b = await buttons(page);
    const put = await api(page, app, "PUT", "/api/v1/email-settings", { smtpUrl: "smtp://mailpit:1025", smtpFrom: STORED_FROM });
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("heading", { name: "Invite your team" }).waitFor();
    const invitee = "doc029-auth-env-invite@helix.example";
    const since = new Date(Date.now() - 1000);
    await page.getByLabel("Name").fill("DOC-029 Auth Env Invite");
    await page.getByLabel("Email").fill(invitee);
    await page.getByRole("button", { name: "Send invite" }).click();
    const m = await waitMail(mail, invitee, since, SET_PASSWORD);
    expect(/Outbound email is set by the deployment environment\. Mail is sent from DOC-029 Environment/.test(text), text.slice(0, 300));
    expect(!b.some((x) => ["Save relay", "Replace relay", "Clear relay", "Send test email"].includes(x)), `buttons ${b}`);
    expect(put.status >= 400, `PUT ${put.status}`);
    expect(m && m.from === ENV_FROM, JSON.stringify(m));
    return `The Outbound email step read "Outbound email is set by the deployment environment. Mail is sent from DOC-029 Environment <${ENV_FROM}>." with the hint that settings saved here never apply. Its buttons were ${JSON.stringify(b)}; there was no Save relay, Replace relay, Clear relay or Send test email. A direct save attempt answered ${put.status}. An invitation from the Invite your team step arrived from ${m.from}, not from the stored stored-relay@helix.example.`;
  });
  await admin.ctx.close();
}

async function emailIncomplete() {
  const { app, mail } = AUTH_LAB;
  results.phase = "incomplete: SMTP_URL set, SMTP_FROM empty (overlay-phase-incomplete.json), complete stored relay still saved";
  const admin = await authAdmin();
  await step(A3, "operator", "SMTP_URL without SMTP_FROM prevents delivery even though a complete relay is stored in the app", "Warning shown; no message is sent", async () => {
    const { page } = admin;
    await emailStep(page);
    const text = await pageText(page);
    const settings = await api(page, app, "GET", "/api/v1/email-settings");
    const invitee = "doc029-auth-incomplete-invite@helix.example";
    const since = new Date(Date.now() - 1000);
    const cont = page.getByRole("button", { name: "Continue" });
    let inviteResult = "Continue was disabled, so the invite step could not be reached";
    if (await cont.isDisabled()) {
      const r = await api(page, app, "POST", "/api/v1/auth/invites", { email: invitee, displayName: "DOC-029 Auth Incomplete Invite", role: "legal_team_member" });
      await sleep(4000);
      inviteResult += `. A direct invitation through the Users invite route answered ${r.status}${r.data?.detail ? ` ("${r.data.detail}")` : ""}`;
    }
    if (!(await cont.isDisabled())) {
      await cont.click();
      await page.getByRole("heading", { name: "Invite your team" }).waitFor();
      await page.getByLabel("Name").fill("DOC-029 Auth Incomplete Invite");
      await page.getByLabel("Email").fill(invitee);
      await page.getByRole("button", { name: "Send invite" }).click();
      await sleep(4000);
      inviteResult = `the invite step answered "${(await pageText(page)).match(/(The invite could not be sent\.[^.]*\.?|\d+ invites? sent:[^A-Z]*)/)?.[0] ?? "(no status text)"}"`;
    }
    const n = await countMail(mail, invitee, since);
    expect(/sets SMTP_URL but not SMTP_FROM, so mail cannot be sent/.test(text), text.slice(0, 300));
    expect(settings.data?.source === "env" && n === 0, `source ${settings.data?.source}, mails ${n}`);
    return `The step warned "The deployment environment sets SMTP_URL but not SMTP_FROM, so mail cannot be sent. Set SMTP_FROM in the environment." The source was ${settings.data.source} with from ${settings.data.fromAddress}. ${inviteResult}, and Mailpit received ${n} messages for that address.`;
  });
  await admin.ctx.close();
}

async function emailRestored() {
  const { app, mail } = AUTH_LAB;
  results.phase = "stored again: override removed and app and worker recreated (overlay-phase-stored.json)";
  const admin = await authAdmin();
  await step(A3, "operator", "Remove the environment override and restart: the stored relay is active again", "Step reads set in the app; test mail from the stored sender", async () => {
    const { page } = admin;
    await emailStep(page);
    const text = await pageText(page);
    const since = new Date(Date.now() - 1000);
    await page.getByRole("button", { name: "Send test email" }).click();
    const m = await waitMail(mail, AUTH_ADMIN.email, since, null);
    expect(/Outbound email is set in the app\. Mail is sent from DOC-029 Stored/.test(text) && m?.from === "stored-relay@helix.example", `${text.slice(0, 200)} ${JSON.stringify(m)}`);
    return `After the override was removed, the step read "Outbound email is set in the app. Mail is sent from ${STORED_FROM}." and a test message arrived from ${m.from}.`;
  });

  await step(A3, "administrator", "Replace relay with a URL that does not begin with smtp:// or smtps://", "The save is refused with a message; the stored relay stays active", async () => {
    const { page } = admin;
    await page.getByRole("button", { name: "Replace relay" }).click();
    await page.getByLabel("SMTP relay URL").fill("http://mailpit:1025");
    await page.getByLabel("From address").fill(STORED_FROM);
    const before = await pageText(page);
    await page.getByRole("button", { name: "Save relay" }).click();
    await sleep(2500);
    const after = await pageText(page);
    const added = after.replace(before, "").trim() || after.match(/(The relay could not be saved\.[^]*?\.|[^.]*smtp:\/\/[^.]*\.)/)?.[0];
    const alerts = await page.locator("main").getByRole("alert").allInnerTexts();
    const settings = await api(page, app, "GET", "/api/v1/email-settings");
    await page.getByRole("button", { name: "Keep current relay" }).click();
    expect(settings.data?.source === "app" && !alerts.some((x) => /Relay saved/.test(x)), `source ${settings.data?.source}; alerts ${alerts}`);
    return `Saving http://mailpit:1025 did not save: the step's alerts read ${JSON.stringify(alerts)} and the source stayed ${settings.data.source} from ${settings.data.fromAddress}. Keep current relay closed the form.`;
  });

  await step(A3, "administrator", "Finish the wizard; it cannot be reopened and there is no separate email Settings page", "Welcome redirects after completion; Settings has no email page", async () => {
    const { page } = admin;
    for (let i = 0; i < 10; i++) {
      if (!new URL(page.url()).pathname.startsWith("/welcome")) break;
      const finish = page.getByRole("button", { name: "Finish" });
      if (await finish.count()) { await finish.click(); break; }
      if (await page.getByRole("heading", { name: "Outbound email" }).count()) await page.getByRole("button", { name: "Continue" }).click();
      else await page.getByRole("button", { name: "Set up later" }).click();
      await sleep(600);
    }
    await page.waitForURL((u) => !u.pathname.startsWith("/welcome"), { timeout: 20000 });
    await page.goto(`${app}/welcome`);
    await page.waitForLoadState("networkidle");
    const after = new URL(page.url()).pathname;
    await page.goto(`${app}/settings/general`);
    await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Security" }).click();
    const nav = (await page.getByRole("navigation", { name: "Settings sections" }).innerText()).replace(/\s+/g, " ");
    await page.goto(`${app}/settings/email`);
    await page.waitForLoadState("networkidle");
    const emailPage = (await pageText(page)).slice(0, 120);
    expect(!after.startsWith("/welcome") && !/\bEmail\b/.test(nav), `after ${after}; nav ${nav}`);
    return `Set up later on the remaining optional steps and Finish completed the wizard. Opening /welcome again went to ${after}. The Settings rail read "${nav}" with no email entry; /settings/email showed "${emailPage}".`;
  });
  await admin.ctx.close();
}

const authRegion = (page, name) => page.getByRole("region", { name });
async function openAuthentication(page) {
  await page.goto(`${AUTH_LAB.app}/settings/general`);
  const nav = page.getByRole("navigation", { name: "Settings sections" });
  await nav.getByRole("button", { name: "Security" }).click();
  await nav.getByRole("link", { name: "Authentication" }).click();
  await authRegion(page, "Legal User Authentication").waitFor();
}
async function toggle(page, card, label) {
  const region = authRegion(page, card);
  await region.getByRole("switch", { name: label }).click();
  const note = region.locator('[aria-live="polite"]').first();
  for (let i = 0; i < 40; i++) {
    const t = (await note.innerText()).trim();
    if (t && t !== "Saving…") return t;
    await sleep(150);
  }
  return (await note.innerText()).trim();
}
async function policyNow(page) {
  return (await api(page, AUTH_LAB.app, "GET", "/api/v1/auth/methods")).data.policy;
}
async function magicLinkFor(page, email, portal, since) {
  await requestMagicLink(page, AUTH_LAB.app, email, portal);
  return waitMail(AUTH_LAB.mail, email, since, MAGIC, 16);
}
async function passwordSetupRequest(page, email, portal = true) {
  await page.goto(`${AUTH_LAB.app}${portal ? "/portal/login" : "/auth/login"}`);
  await page.getByRole("heading", { level: 1 }).first().waitFor();
  await page.waitForLoadState("networkidle");
  const setup = page.getByRole("button", { name: "Set up or reset your password" });
  if (!(await setup.count())) {
    const pw = page.getByRole("button", { name: /Sign in with a password|Administrator sign-in/ }).first();
    if (await pw.count()) await pw.click();
  }
  await page.getByRole("button", { name: "Set up or reset your password" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send password setup link" }).click();
  await page.getByText(/If your email address is eligible, a password setup link is on its way/).waitFor({ timeout: 15000 });
}
async function passwordSignIn(page, email, password, portal = false) {
  await page.goto(`${AUTH_LAB.app}${portal ? "/portal/login" : "/auth/login"}`);
  await page.getByRole("heading", { level: 1 }).first().waitFor();
  await page.waitForLoadState("networkidle");
  if (!(await page.getByLabel("Password", { exact: true }).count())) {
    const b = page.getByRole("button", { name: /Sign in with a password|Administrator sign-in/ }).first();
    await b.click();
  }
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const outcome = await Promise.race([
    page.waitForURL((u) => !/\/(auth|portal)\/login/.test(u.pathname), { timeout: 15000 }).then(() => "signed-in"),
    page.getByRole("alert").first().waitFor({ timeout: 15000 }).then(() => "alert"),
  ]).catch(() => "timeout");
  const alert = outcome === "alert" ? (await page.getByRole("alert").first().innerText()).trim() : null;
  const me = await api(page, AUTH_LAB.app, "GET", "/api/v1/me");
  return { outcome, alert, me: me.status, role: me.data?.user?.role, path: new URL(page.url()).pathname };
}

async function policy() {
  const { app, mail } = AUTH_LAB;
  const admin = await authAdmin();
  results.identities = Object.entries(authAccounts).map(([k, v]) => ({ key: k, account: v }));

  await step(A3, "administrator", "Prepare staff: invite a Legal Team Member who sets a password, and two colleagues who stay invited", "Rows exist with the expected status", async () => {
    const { page } = admin;
    await openUsers(page, app);
    const since = new Date(Date.now() - 1000);
    for (const [email, name] of [[authAccounts.legal, "DOC-029 Auth Legal"], [authAccounts.ssoStaff, "DOC-029 Auth SSO Staff"], [authAccounts.offDomainStaff, "DOC-029 Auth Off-domain Staff"]]) {
      if ((await rowState(page, email)).present) continue;
      const d = await invite(page, name, email, "Legal team member");
      await d.waitFor({ state: "hidden" });
    }
    if ((await rowState(page, authAccounts.legal)).status === "Invited") {
      const link = await waitMail(mail, authAccounts.legal, since, SET_PASSWORD);
      const c = await context();
      await setPasswordFromLink(c.page, link.link, AUTH_PASSWORD);
      await c.ctx.close();
    }
    await openUsers(page, app);
    const states = {};
    for (const e of [authAccounts.legal, authAccounts.ssoStaff, authAccounts.offDomainStaff]) states[e] = (await rowState(page, e)).status;
    expect(states[authAccounts.legal] === "Active" && states[authAccounts.ssoStaff] === "Invited" && states[authAccounts.offDomainStaff] === "Invited", JSON.stringify(states));
    return `Rows: ${JSON.stringify(states)}.`;
  });

  await step(A3, "administrator", "Open Settings, Security, Authentication: two policy cards with four switches; SSO unavailable before a provider is registered", "Legal User Authentication and Business Portal Authentication cards; Single sign-on (SSO) disabled", async () => {
    const { page } = admin;
    await openAuthentication(page);
    const out = {};
    for (const card of ["Legal User Authentication", "Business Portal Authentication"]) {
      const sw = authRegion(page, card).getByRole("switch");
      out[card] = await sw.evaluateAll((els) => els.map((e) => `${document.querySelector(`label[for="${e.id}"]`)?.innerText}:${e.getAttribute("aria-checked")}${e.disabled ? ":disabled" : ""}`));
    }
    const labels = ["Email and password", "Email magic link", "Single sign-on (SSO)", "Require two-factor authentication"];
    for (const card of Object.keys(out)) {
      expect(JSON.stringify(out[card].map((x) => x.split(":")[0])) === JSON.stringify(labels), `${card} ${out[card]}`);
      expect(out[card][2].endsWith(":disabled"), `${card} SSO ${out[card][2]}`);
    }
    return `Settings rail Security expanded to Authentication. Switches: ${JSON.stringify(out)}.`;
  });

  await step(A3, "administrator", "Allowed email domains: Add an approved domain and check the saved list", "Saved; survives reload", async () => {
    const { page } = admin;
    await openAuthentication(page);
    const empty = await page.getByText("No domains allowed yet. Magic-link sign-in is unavailable.").count();
    await page.getByLabel("Allowed email domains").fill("northwind.example");
    await authRegion(page, "Business Portal Authentication").getByRole("button", { name: "Add" }).click();
    await page.getByRole("button", { name: "Remove northwind.example" }).waitFor();
    await page.reload();
    await page.getByRole("button", { name: "Remove northwind.example" }).waitFor();
    const domains = (await api(page, app, "GET", "/api/v1/auth/allowed-domains")).data.domains;
    expect(empty === 1 && JSON.stringify(domains) === JSON.stringify(["northwind.example"]), `${empty} ${domains}`);
    return `The empty list read "No domains allowed yet. Magic-link sign-in is unavailable." After Add, northwind.example appeared with a "Remove northwind.example" control and stayed after reload (${JSON.stringify(domains)}).`;
  });

  await step(A3, "administrator", "A policy with no sign-in method is refused", "Enable at least one sign-in method.", async () => {
    const { page } = admin;
    await openAuthentication(page);
    const first = await toggle(page, "Legal User Authentication", "Email magic link");
    const second = await toggle(page, "Legal User Authentication", "Email and password");
    const pol = await policyNow(page);
    await page.reload();
    await authRegion(page, "Legal User Authentication").waitFor();
    const restored = await toggle(page, "Legal User Authentication", "Email magic link");
    const after = await policyNow(page);
    expect(/Enable at least one sign-in method\./.test(second) && pol.legal.password === true && pol.legal.magicLink === false, `${first} / ${second} / ${JSON.stringify(pol.legal)}`);
    expect(after.legal.magicLink && after.legal.password, JSON.stringify(after.legal));
    return `Turning off Email magic link showed "${first}". Turning off Email and password as the last method showed "${second}" and the stored Legal policy kept password on. Email magic link was turned back on ("${restored}").`;
  });

  await step(A3, "administrator", "Emergency password sign-in: Email and password off under Legal User Authentication", "An Administrator with a password still signs in; a Legal Team Member cannot", async () => {
    const { page } = admin;
    await openAuthentication(page);
    const saved = await toggle(page, "Legal User Authentication", "Email and password");
    const a = await context();
    const adminResult = await passwordSignIn(a.page, AUTH_ADMIN.email, AUTH_PASSWORD);
    await a.ctx.close();
    const l = await context();
    const legalResult = await passwordSignIn(l.page, authAccounts.legal, AUTH_PASSWORD);
    await l.ctx.close();
    await toggle(page, "Legal User Authentication", "Email and password");
    const after = await policyNow(page);
    expect(adminResult.me === 200 && legalResult.me === 401 && after.legal.password, `admin ${JSON.stringify(adminResult)} legal ${JSON.stringify(legalResult)}`);
    return `With Email and password off ("${saved}"), the Administrator signed in with a password (me ${adminResult.me}, role ${adminResult.role}). The Legal Team Member with a password was refused (${legalResult.alert ?? legalResult.outcome}; me ${legalResult.me}). Email and password was turned back on.`;
  });

  await step(A3, "legal_team_member", "Email magic link under Legal User Authentication: existing staff get a link even when their domain is not allowed", "Staff on helix.example and elsewhere.example receive links; an invited staff row stays Invited after magic-link sign-in", async () => {
    const out = [];
    for (const email of [authAccounts.legal, authAccounts.offDomainStaff]) {
      const c = await context();
      const since = new Date(Date.now() - 1000);
      const m = await magicLinkFor(c.page, email, false, since);
      expect(m, `no link for ${email}`);
      await c.page.goto(m.link);
      await c.page.waitForLoadState("networkidle");
      const me = await api(c.page, app, "GET", "/api/v1/me");
      out.push(`${email}: link received, me ${me.status} role ${me.data?.user?.role}`);
      expect(me.status === 200, `${email} me ${me.status}`);
      await c.ctx.close();
    }
    await openUsers(admin.page, app);
    const state = await rowState(admin.page, authAccounts.offDomainStaff);
    expect(state.status === "Invited", JSON.stringify(state));
    return `Allowed domains held only northwind.example. ${out.join("; ")}. The off-domain colleague's row still read Invited after the magic-link sign-in.`;
  });

  let portalSession;
  await step(A3, "business_user", "New Portal entrant on an allowed domain gets a link; an unapproved address gets no link or password setup link", "Allowed address becomes a Business User; unapproved address gets no mail and no account", async () => {
    portalSession = await context();
    const since = new Date(Date.now() - 1000);
    const m = await magicLinkFor(portalSession.page, authAccounts.portalNew, true, since);
    expect(m, "no link for allowed entrant");
    await portalSession.page.goto(m.link);
    await portalSession.page.waitForURL((u) => u.pathname.startsWith("/portal"), { timeout: 20000 });
    const me = await api(portalSession.page, app, "GET", "/api/v1/me");
    const u = await context();
    const since2 = new Date(Date.now() - 1000);
    await requestMagicLink(u.page, app, authAccounts.unapproved, true);
    await passwordSetupRequest(u.page, authAccounts.unapproved);
    await sleep(3000);
    const n = await countMail(mail, authAccounts.unapproved, since2);
    await u.ctx.close();
    const users = (await api(admin.page, app, "GET", "/api/v1/users")).data.users;
    expect(me.data?.user?.role === "business_user" && n === 0 && !users.some((x) => x.email === authAccounts.unapproved), `role ${me.data?.user?.role}, mails ${n}`);
    return `${authAccounts.portalNew} got "${m.subject}", opened the Portal and is a ${me.data.user.role}. ${authAccounts.unapproved} saw the neutral "Check your email" and password-setup confirmations, but Mailpit received ${n} messages and no account exists.`;
  });

  await step(A3, "business_user", "A Business User sets a password through the Portal password setup link and signs in with Email and password", "Password setup email; password sign-in reaches the Portal", async () => {
    const c = await context();
    const since = new Date(Date.now() - 1000);
    await passwordSetupRequest(c.page, authAccounts.portalPassword);
    const m = await waitMail(mail, authAccounts.portalPassword, since, SET_PASSWORD);
    expect(m, "no password setup mail");
    await setPasswordFromLink(c.page, m.link, AUTH_PASSWORD);
    const r = await passwordSignIn(c.page, authAccounts.portalPassword, AUTH_PASSWORD, true);
    await c.ctx.close();
    expect(r.me === 200 && r.role === "business_user", JSON.stringify(r));
    return `"${m.subject}" arrived, the password was set, and Email and password sign-in on the Portal page reached ${r.path} as ${r.role}.`;
  });

  await step(A3, "administrator", "Remove the domain: no new links for anyone on it, but existing access continues as the article describes", "Existing Business User gets no new link; held session, earlier link, and password sign-in still work; new-address setup refused at completion; staff unaffected", async () => {
    const { page } = admin;
    const earlierCtx = await context();
    const since = new Date(Date.now() - 1000);
    const earlier = await magicLinkFor(earlierCtx.page, authAccounts.portalNew, true, since);
    const lateCtx = await context();
    const since2 = new Date(Date.now() - 1000);
    await passwordSetupRequest(lateCtx.page, authAccounts.portalLate);
    const late = await waitMail(mail, authAccounts.portalLate, since2, SET_PASSWORD);
    expect(earlier && late, "could not prepare earlier links");
    await openAuthentication(page);
    await page.getByRole("button", { name: "Remove northwind.example" }).click();
    await page.getByText("No domains allowed yet. Magic-link sign-in is unavailable.").waitFor();
    const obs = {};
    const since3 = new Date(Date.now() - 1000);
    const x = await context();
    await requestMagicLink(x.page, app, authAccounts.portalNew, true);
    await sleep(3000);
    obs.newLinkMails = await countMail(mail, authAccounts.portalNew, since3);
    await x.ctx.close();
    obs.heldSession = (await api(portalSession.page, app, "GET", "/api/v1/me")).status;
    await earlierCtx.page.goto(earlier.link);
    await earlierCtx.page.waitForLoadState("networkidle");
    obs.earlierLink = `${new URL(earlierCtx.page.url()).pathname} me ${(await api(earlierCtx.page, app, "GET", "/api/v1/me")).status}`;
    await earlierCtx.ctx.close();
    const pw = await context();
    const pwr = await passwordSignIn(pw.page, authAccounts.portalPassword, AUTH_PASSWORD, true);
    obs.passwordSignIn = `me ${pwr.me} ${pwr.role}`;
    await pw.ctx.close();
    await lateCtx.page.goto(late.link);
    await lateCtx.page.getByLabel("New password").fill(AUTH_PASSWORD);
    await lateCtx.page.getByLabel("Confirm password").fill(AUTH_PASSWORD);
    await lateCtx.page.getByRole("button", { name: "Set password" }).click();
    await sleep(2500);
    obs.lateCompletion = (await lateCtx.page.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 200);
    await lateCtx.ctx.close();
    const since4 = new Date(Date.now() - 1000);
    const s = await context();
    await requestMagicLink(s.page, app, authAccounts.legal, false);
    obs.staffLink = !!(await waitMail(mail, authAccounts.legal, since4, MAGIC, 16));
    await s.ctx.close();
    const users = (await api(page, app, "GET", "/api/v1/users")).data.users;
    obs.lateAccount = users.some((u) => u.email === authAccounts.portalLate);
    await page.getByLabel("Allowed email domains").fill("northwind.example");
    await authRegion(page, "Business Portal Authentication").getByRole("button", { name: "Add" }).click();
    await page.getByRole("button", { name: "Remove northwind.example" }).waitFor();
    expect(obs.newLinkMails === 0 && obs.heldSession === 200 && obs.earlierLink.endsWith("me 200") && pwr.me === 200, JSON.stringify(obs));
    expect(!obs.lateAccount && /Password setup is no longer available for this address\./.test(obs.lateCompletion) && !/Sign in with your new password/.test(obs.lateCompletion) && obs.staffLink, JSON.stringify(obs));
    return `After Remove northwind.example the list read "No domains allowed yet...". Observed: ${JSON.stringify(obs)}. The domain was added back.`;
  });

  await step(A3, "administrator", "Turn off Email magic link under Business Portal Authentication: earlier links stop working and the Portal page offers other methods", "Earlier link refused; no magic-link choice on the Portal page; password sign-in still works", async () => {
    const { page } = admin;
    const c = await context();
    const since = new Date(Date.now() - 1000);
    const earlier = await magicLinkFor(c.page, authAccounts.portalNew, true, since);
    await openAuthentication(page);
    const saved = await toggle(page, "Business Portal Authentication", "Email magic link");
    await c.page.goto(earlier.link);
    await c.page.waitForLoadState("networkidle");
    const me = await api(c.page, app, "GET", "/api/v1/me");
    const landed = new URL(c.page.url()).pathname;
    const landedText = (await c.page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 160);
    await c.page.goto(`${app}/portal/login`);
    await c.page.getByRole("heading", { name: "Business Portal sign-in" }).waitFor();
    await c.page.waitForLoadState("networkidle");
    const portalButtons = await buttons(c.page);
    await c.ctx.close();
    const p = await context();
    const pwr = await passwordSignIn(p.page, authAccounts.portalPassword, AUTH_PASSWORD, true);
    await p.ctx.close();
    await toggle(page, "Business Portal Authentication", "Email magic link");
    const after = await policyNow(page);
    expect(me.status === 401 && portalButtons.length > 0 && !portalButtons.includes("Email me a sign-in link") && pwr.me === 200 && after.business.magicLink, `me ${me.status} landed ${landed} buttons ${portalButtons} pw ${pwr.me}`);
    return `Turning off Email magic link showed "${saved}". Opening the link sent before the change stayed on ${landed}, which answered "${landedText}", with no session (me ${me.status}). The Portal sign-in page offered ${JSON.stringify(portalButtons)}, with no magic-link choice. The Business User with a password still signed in (me ${pwr.me}). Email magic link was turned back on.`;
  });

  await portalSession.ctx.close();
  await admin.ctx.close();
}

const OIDC_CONTROL = process.env.OIDC_IP ? `http://${process.env.OIDC_IP}:8081/identity` : null;
async function idpIdentity(sub, email, name) {
  const r = await fetch(OIDC_CONTROL, { method: "POST", body: JSON.stringify({ sub, email, name }) });
  return r.json();
}
async function ssoRoundTrip(portal, identity) {
  await idpIdentity(...identity);
  const c = await context();
  const { page } = c;
  await page.goto(`${AUTH_LAB.app}${portal ? "/portal/login" : "/auth/login"}`);
  await page.getByRole("heading", { level: 1 }).first().waitFor();
  await page.waitForLoadState("networkidle");
  const start = page.url();
  await page.getByRole("button", { name: "Continue with single sign-on" }).click();
  await page.waitForURL((u) => u.href !== start && u.host === new URL(AUTH_LAB.app).host && !u.pathname.startsWith("/api/auth/sso") && (!/\/(auth|portal)\/login$/.test(u.pathname) || u.searchParams.has("error")), { timeout: 30000 }).catch(() => {});
  await page.waitForLoadState("networkidle");
  const url = new URL(page.url());
  const me = await api(page, AUTH_LAB.app, "GET", "/api/v1/me");
  const alert = (await page.getByRole("alert").allInnerTexts().catch(() => [])).map((x) => x.trim()).filter(Boolean);
  await c.ctx.close();
  return { path: url.pathname + (url.searchParams.get("error") ? `?error=${url.searchParams.get("error")}` : ""), me: me.status, role: me.data?.user?.role ?? null, alert };
}
async function providerNow(page) {
  return (await api(page, AUTH_LAB.app, "GET", "/api/v1/auth/sso-providers")).data.providers[0] ?? null;
}
const identityProvider = (page) => authRegion(page, "Identity provider");
async function providerNote(page) {
  const note = identityProvider(page).locator('[aria-live="polite"]').first();
  for (let i = 0; i < 60; i++) {
    const t = (await note.innerText()).trim();
    if (t && t !== "Saving…") return t;
    await sleep(250);
  }
  return (await note.innerText()).trim();
}

async function sso() {
  const { app } = AUTH_LAB;
  if (!OIDC_CONTROL) throw new Error("OIDC_IP is required");
  const admin = await authAdmin();
  const staffIdentity = ["doc029-idp-sso-staff", authAccounts.ssoStaff, "DOC-029 Auth SSO Staff"];

  if (!process.env.SSO_SKIP_REGISTER) await step(A3, "administrator", "Register provider with an issuer that cannot be reached", "Refused; nothing registered", async () => {
    const { page } = admin;
    await openAuthentication(page);
    const box = identityProvider(page);
    await box.getByLabel("Provider ID").fill("doc029-oidc");
    await box.getByLabel("Issuer URL").fill("http://doc029-unreachable-issuer.invalid:8080");
    await box.getByLabel("Email domain").fill("helix.example");
    await box.getByLabel("Client ID").fill("doc029-client");
    await box.getByLabel("Client secret").fill(`fixture-${stamp}`);
    await box.getByRole("button", { name: "Register provider" }).click();
    const note = await providerNote(page);
    const provider = await providerNow(page);
    expect(provider === null && note !== "Saved", `note ${note}; provider ${JSON.stringify(provider)}`);
    return `Register provider with an unreachable issuer showed "${note}" and no provider was stored.`;
  });

  if (!process.env.SSO_SKIP_REGISTER) await step(A3, "administrator", "Register provider against the local OpenID Connect fixture; copy the callback URL; registration turns on nothing", "Saved; callback ends /api/auth/sso/callback on the instance address; SSO switches stay off; Provider ID fixed", async () => {
    const { page } = admin;
    const box = identityProvider(page);
    await box.getByLabel("Issuer URL").fill("http://oidc:8080");
    await box.getByLabel("Client secret").fill(`fixture-${stamp}`);
    await box.getByRole("button", { name: "Register provider" }).click();
    const note = await providerNote(page);
    const callback = (await box.locator("code").innerText()).trim();
    const pol = await policyNow(page);
    await page.reload();
    await identityProvider(page).waitFor();
    const idField = await identityProvider(page).getByLabel("Provider ID").count();
    const saveLabel = await identityProvider(page).getByRole("button", { name: "Save provider" }).count();
    const ssoSwitches = await page.getByRole("switch", { name: "Single sign-on (SSO)" }).evaluateAll((els) => els.map((e) => `${e.getAttribute("aria-checked")}${e.disabled ? ":disabled" : ""}`));
    expect(note === "Saved" && callback === `${app}/api/auth/sso/callback`, `note ${note}; callback ${callback}`);
    expect(!pol.legal.sso && !pol.business.sso && idField === 0 && saveLabel === 1, `pol ${JSON.stringify(pol)} id ${idField}`);
    expect(ssoSwitches.every((x) => x === "false"), `switches ${ssoSwitches}`);
    return `Register provider showed Saved and "Paste this callback URL into your IdP console: ${callback}". Both Single sign-on (SSO) switches stayed off but became available (${JSON.stringify(ssoSwitches)}). After reload the Provider ID field was gone and the button read Save provider.`;
  });

  await step(A3, "legal_team_member", "Turn on Single sign-on (SSO) under Legal User Authentication; an invited staff account signs in through the identity provider", "Callback succeeds; role Legal team member retained; row becomes Active", async () => {
    const { page } = admin;
    await openAuthentication(page);
    const saved = await toggle(page, "Legal User Authentication", "Single sign-on (SSO)");
    const r = await ssoRoundTrip(false, staffIdentity);
    await openUsers(page, app);
    const state = await rowState(page, authAccounts.ssoStaff);
    expect(r.me === 200 && r.role === "legal_team_member" && state.status === "Active", `${JSON.stringify(r)} ${JSON.stringify(state)}`);
    return `The switch saved ("${saved}"). In a separate browser, Continue with single sign-on went through the fixture's authorize endpoint and the OpenLaw callback to ${r.path}, signed in as ${r.role}. The invited row now read ${state.status} with a role control (${state.roleControl}).`;
  });

  await step(A3, "administrator", "An uninvited identity on a matching email domain gets no staff role", "No staff session; no staff account", async () => {
    const r = await ssoRoundTrip(false, [`doc029-idp-uninvited-${stamp}`, authAccounts.uninvitedStaff, "DOC-029 Auth Uninvited"]);
    const users = (await api(admin.page, app, "GET", "/api/v1/users")).data.users;
    const created = users.find((u) => u.email === authAccounts.uninvitedStaff);
    expect(!(r.role === "administrator" || r.role === "legal_team_member") && !(created && created.role !== "business_user"), `${JSON.stringify(r)} ${JSON.stringify(created)}`);
    return `With Business Portal single sign-on off, ${authAccounts.uninvitedStaff} (matching the provider's helix.example domain, not an allowed Portal domain) ended on ${r.path} with me ${r.me}${r.alert.length ? ` and "${r.alert.join(" ")}"` : ""}. Account created: ${created ? created.role : "none"}.`;
  });

  await step(A3, "administrator", "Save provider with Client secret left blank, then with a replacement secret; test a fresh sign-in after each", "Saved both times; staff SSO still works", async () => {
    const { page } = admin;
    await openAuthentication(page);
    const box = identityProvider(page);
    const hint = await box.getByText("Leave blank to keep the current secret. Paste a new value to rotate.").count();
    await box.getByLabel("Client ID").fill(`doc029-client-${stamp}`);
    await box.getByRole("button", { name: "Save provider" }).click();
    const blank = await providerNote(page);
    const r1 = await ssoRoundTrip(false, staffIdentity);
    await page.reload();
    await identityProvider(page).getByLabel("Client secret").fill(`fixture-rotated-${stamp}`);
    await identityProvider(page).getByRole("button", { name: "Save provider" }).click();
    const rotated = await providerNote(page);
    const r2 = await ssoRoundTrip(false, staffIdentity);
    const provider = await providerNow(page);
    expect(hint === 1 && blank === "Saved" && rotated === "Saved" && r1.me === 200 && r2.me === 200, `hint ${hint} blank ${blank} rotated ${rotated} r1 ${JSON.stringify(r1)} r2 ${JSON.stringify(r2)}`);
    return `The Client secret hint read "Leave blank to keep the current secret. Paste a new value to rotate." Saving a Client ID change with a blank secret showed ${blank}; a fresh staff SSO sign-in worked (me ${r1.me}). Saving a replacement secret showed ${rotated}; another fresh sign-in worked (me ${r2.me}). Stored client ID: ${provider.clientId}.`;
  });

  await step(A3, "administrator", "Update the issuer to one that cannot be reached", "Refused; the previous provider stays usable", async () => {
    const { page } = admin;
    await openAuthentication(page);
    const box = identityProvider(page);
    await box.getByLabel("Issuer URL").fill("http://doc029-unreachable-issuer.invalid:8080");
    await box.getByRole("button", { name: "Save provider" }).click();
    const note = await providerNote(page);
    const provider = await providerNow(page);
    const r = await ssoRoundTrip(false, staffIdentity);
    expect(note !== "Saved" && provider.issuer === "http://oidc:8080" && r.me === 200, `note ${note} issuer ${provider.issuer} ${JSON.stringify(r)}`);
    return `Save provider with an unreachable issuer showed "${note}". The stored issuer stayed ${provider.issuer} and a fresh staff SSO sign-in still worked (me ${r.me}).`;
  });

  await step(A3, "business_user", "Turn on Single sign-on (SSO) under Business Portal Authentication; an existing Business User signs in through the identity provider, and still can after the domain is removed", "Existing Business User on the provider's email domain enters the Portal before and after narrowing the list; no staff role is granted", async () => {
    const { page } = admin;
    const bu = `doc029-auth-bu-${stamp}@helix.example`;
    await openAuthentication(page);
    await page.getByLabel("Allowed email domains").fill("helix.example");
    await authRegion(page, "Business Portal Authentication").getByRole("button", { name: "Add" }).click();
    await page.getByRole("button", { name: "Remove helix.example" }).waitFor();
    const c = await context();
    const since = new Date(Date.now() - 1000);
    const m = await magicLinkFor(c.page, bu, true, since);
    expect(m, "no Portal link for the helix.example Business User");
    await c.page.goto(m.link);
    await c.page.waitForURL((u) => u.pathname.startsWith("/portal"), { timeout: 20000 });
    await c.ctx.close();
    const saved = await toggle(page, "Business Portal Authentication", "Single sign-on (SSO)");
    const identity = [`doc029-idp-bu-${stamp}`, bu, "DOC-029 Auth Portal BU"];
    const first = await ssoRoundTrip(true, identity);
    await page.getByRole("button", { name: "Remove helix.example" }).click();
    await page.getByRole("button", { name: "Remove helix.example" }).waitFor({ state: "detached" });
    const afterRemoval = await ssoRoundTrip(true, identity);
    const newcomer = `doc029-auth-newcomer-${stamp}@helix.example`;
    const refused = await ssoRoundTrip(true, [`doc029-idp-newcomer-${stamp}`, newcomer, "DOC-029 Auth Newcomer"]);
    const users = (await api(page, app, "GET", "/api/v1/users")).data.users;
    const created = users.find((u) => u.email === newcomer);
    const domains = (await api(page, app, "GET", "/api/v1/auth/allowed-domains")).data.domains;
    expect(first.me === 200 && first.role === "business_user", `first ${JSON.stringify(first)}`);
    expect(afterRemoval.me === 200 && afterRemoval.role === "business_user", `after removal ${JSON.stringify(afterRemoval)}`);
    expect(refused.me === 401 && !created, `newcomer ${JSON.stringify(refused)} ${JSON.stringify(created)}`);
    return `helix.example was added, and ${bu} entered the Portal through a sign-in link. The Business Portal SSO switch saved ("${saved}"). Portal single sign-on for that existing Business User reached ${first.path} as ${first.role}. After Remove helix.example (list now ${JSON.stringify(domains)}), the same identity still signed in through single sign-on (${afterRemoval.path}, ${afterRemoval.role}). A never-seen identity on the removed domain ended on ${refused.path}${refused.alert.length ? ` with "${refused.alert.join(" ")}"` : ""} and no account was created.`;
  });

  await step(A3, "administrator", "Recover: Administrator password sign-in with Email and password off under Legal, then turn on Email and password and turn off SSO", "Admin password sign-in works; staff login returns to password; SSO off", async () => {
    const { page } = admin;
    await openAuthentication(page);
    await toggle(page, "Legal User Authentication", "Email magic link");
    const off = await toggle(page, "Legal User Authentication", "Email and password");
    const pol1 = await policyNow(page);
    const a = await context();
    const adminResult = await passwordSignIn(a.page, AUTH_ADMIN.email, AUTH_PASSWORD);
    await a.ctx.close();
    await openAuthentication(page);
    await toggle(page, "Legal User Authentication", "Email and password");
    await toggle(page, "Legal User Authentication", "Email magic link");
    await toggle(page, "Legal User Authentication", "Single sign-on (SSO)");
    await toggle(page, "Business Portal Authentication", "Single sign-on (SSO)");
    const pol2 = await policyNow(page);
    const l = await context();
    const legalResult = await passwordSignIn(l.page, authAccounts.legal, AUTH_PASSWORD);
    await l.ctx.close();
    expect(pol1.legal.sso && !pol1.legal.password && !pol1.legal.magicLink && adminResult.me === 200, `${off} ${JSON.stringify(pol1.legal)} ${JSON.stringify(adminResult)}`);
    expect(pol2.legal.password && !pol2.legal.sso && !pol2.business.sso && legalResult.me === 200, `${JSON.stringify(pol2)} ${JSON.stringify(legalResult)}`);
    return `With only Single sign-on (SSO) on for Legal users (${JSON.stringify(pol1.legal)}), the Administrator still signed in with a password (me ${adminResult.me}). Turning Email and password and Email magic link back on and SSO off in both cards gave ${JSON.stringify(pol2)}, and the Legal Team Member signed in with a password again (me ${legalResult.me}).`;
  });
  await admin.ctx.close();
}

async function twoFactor() {
  const { app } = AUTH_LAB;
  let uri = null;
  // Attempt 1 of this section turned the Legal policy on and the pane left for
  // enrolment before the script could read the saved note. The policy stayed on,
  // so this run starts from that recorded state instead of turning it on again.
  const admin = await context();
  await step(A3, "administrator", "With Require two-factor authentication on under Legal User Authentication, an Administrator without an authenticator must set one up before continuing", "Sign-in leads to enrolment with the organization requirement; enrolment then reaches the app", async () => {
    const { page } = admin;
    const pol = (await (await fetch(`${app}/api/v1/auth/methods`)).json()).policy;
    expect(pol.legal.requireTwoFactor, `policy ${JSON.stringify(pol.legal)}`);
    await page.goto(`${app}/auth/login`);
    await page.getByLabel("Email", { exact: true }).fill(AUTH_ADMIN.email);
    await page.getByLabel("Password", { exact: true }).fill(AUTH_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL((u) => u.pathname.startsWith("/auth/two-factor/enroll"), { timeout: 15000 });
    const blocked = await api(page, app, "GET", "/api/v1/auth/allowed-domains");
    const required = await page.getByText("Your organization requires two-factor authentication.").count();
    page.on("response", async (res) => {
      if (res.url().includes("/two-factor/enable") && res.ok()) uri = (await res.json()).totpURI;
    });
    await page.getByLabel("Password").fill(AUTH_PASSWORD);
    await page.getByRole("button", { name: "Turn on two-factor" }).click();
    await page.getByLabel("Code").waitFor();
    for (let i = 0; i < 20 && !uri; i++) await sleep(250);
    await page.getByLabel("Code").fill(totp(uri));
    await page.getByRole("button", { name: "Confirm" }).click();
    await page.getByRole("button", { name: "Done" }).click();
    await page.waitForLoadState("networkidle");
    const me = await api(page, app, "GET", "/api/v1/me");
    const allowed = await api(page, app, "GET", "/api/v1/auth/allowed-domains");
    expect(required === 1 && blocked.status === 403 && allowed.status === 200, `${required} ${blocked.status} ${allowed.status}`);
    return `The Legal policy had requireTwoFactor on. A password sign-in went to /auth/two-factor/enroll with "Your organization requires two-factor authentication."; an admin API call answered ${blocked.status} ("${blocked.data?.detail}"). After Turn on two-factor, a code, Confirm and Done, the Administrator reached ${new URL(page.url()).pathname} and the same API answered ${allowed.status}.`;
  });

  await step(A3, "administrator", "Each new session must prove a code", "A fresh password sign-in asks for a code", async () => {
    const c = await context();
    const { page } = c;
    await page.goto(`${app}/auth/login`);
    await page.getByLabel("Email", { exact: true }).fill(AUTH_ADMIN.email);
    await page.getByLabel("Password", { exact: true }).fill(AUTH_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL((u) => u.pathname.startsWith("/auth/two-factor"), { timeout: 15000 });
    const prompt = await page.getByText("Enter the 6-digit code from your authenticator app.").count();
    const before = await api(page, app, "GET", "/api/v1/me");
    await page.getByLabel("Code").fill(totp(uri));
    await page.getByRole("button", { name: "Verify" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/auth/"), { timeout: 15000 });
    const after = await api(page, app, "GET", "/api/v1/me");
    await c.ctx.close();
    expect(prompt === 1 && before.status !== 200 && after.status === 200, `${prompt} ${before.status} ${after.status}`);
    return `A fresh password sign-in went to ${"/auth/two-factor"} with "Enter the 6-digit code from your authenticator app." Before the code /api/v1/me answered ${before.status}; after Verify it answered ${after.status}.`;
  });

  await step(A3, "legal_team_member", "Required two-factor applies to email magic links too", "A Legal Team Member without an authenticator is sent to set one up after a magic-link sign-in", async () => {
    const c = await context();
    const since = new Date(Date.now() - 1000);
    const m = await magicLinkFor(c.page, authAccounts.legal, false, since);
    expect(m, "no magic link");
    await c.page.goto(m.link);
    await c.page.waitForLoadState("networkidle");
    await c.page.goto(`${app}/`);
    await c.page.waitForLoadState("networkidle");
    const p = new URL(c.page.url()).pathname;
    const me = await api(c.page, app, "GET", "/api/v1/me");
    const work = await api(c.page, app, "GET", "/api/v1/matters");
    await c.ctx.close();
    expect(p.startsWith("/auth/two-factor/enroll") && work.status !== 200, `path ${p} matters ${work.status}`);
    return `After the magic-link sign-in the Legal Team Member was sent to ${p}; /api/v1/me reported setup required (${me.data?.user?.twoFactorSetupRequired}), and a work API call (/api/v1/matters) answered ${work.status}.`;
  });

  await step(A3, "administrator", "Turn off Require two-factor authentication", "Policy saved off", async () => {
    const { page } = admin;
    await openAuthentication(page);
    const saved = await toggle(page, "Legal User Authentication", "Require two-factor authentication");
    const pol = await policyNow(page);
    expect(saved === "Saved" && !pol.legal.requireTwoFactor, `${saved} ${JSON.stringify(pol.legal)}`);
    return `The switch saved off (${JSON.stringify(pol.legal)}). The Administrator's own authenticator stays enrolled.`;
  });

  await step("organisation-and-users", "administrator", "Last Administrator safeguard: the only Administrator cannot be demoted", "Refused with a message", async () => {
    const { page } = admin;
    await openUsers(page, app);
    await chooseRole(page, AUTH_ADMIN.email, "Legal team member");
    const note = row(page, AUTH_ADMIN.email).locator('[aria-live="polite"]');
    let t = "";
    for (let i = 0; i < 40; i++) { t = (await note.innerText()).trim(); if (t && t !== "Saving…") break; await sleep(150); }
    const me = await api(page, app, "GET", "/api/v1/me");
    const archiveRefusal = await api(page, app, "POST", `/api/v1/users/${me.data.user.id}/archive`);
    const admins = (await api(page, app, "GET", "/api/v1/users")).data.users.filter((u) => u.role === "administrator" && u.status !== "archived").length;
    expect(admins === 1 && /You cannot demote the last Administrator\./.test(t) && me.data.user.role === "administrator", `${admins} ${t} ${me.data.user.role}`);
    return `On the owned lab, where ${AUTH_ADMIN.name} is the only active Administrator (${admins}), choosing Legal team member on the own row showed "${t}" and the role stayed ${me.data.user.role}. Archiving the same account through the API was refused with ${archiveRefusal.status} ("${archiveRefusal.data?.detail}").`;
  });

  await step(A3, "administrator", "Turn on Require two-factor authentication as an Administrator who has no authenticator", "OpenLaw asks that Administrator to set one up before continuing", async () => {
    const { page } = admin;
    await openUsers(page, app);
    await chooseRole(page, authAccounts.legal, "Administrator");
    await row(page, authAccounts.legal).getByText("Saved", { exact: true }).waitFor();
    const second = await context();
    await signIn(second.page, app, authAccounts.legal, AUTH_PASSWORD);
    await openAuthentication(second.page);
    await authRegion(second.page, "Legal User Authentication").getByRole("switch", { name: "Require two-factor authentication" }).click();
    await second.page.waitForURL((u) => u.pathname.startsWith("/auth/two-factor/enroll"), { timeout: 15000 });
    const required = await second.page.getByText("Your organization requires two-factor authentication.").count();
    await second.ctx.close();
    await openAuthentication(page);
    const off = await toggle(page, "Legal User Authentication", "Require two-factor authentication");
    await openUsers(page, app);
    await chooseRole(page, authAccounts.legal, "Legal team member");
    await row(page, authAccounts.legal).getByText("Saved", { exact: true }).waitFor();
    const pol = await policyNow(page);
    expect(required === 1 && !pol.legal.requireTwoFactor, `${required} ${JSON.stringify(pol.legal)}`);
    return `The Legal Team Member was temporarily made an Administrator. In their own session, selecting Require two-factor authentication under Legal User Authentication took them straight to /auth/two-factor/enroll with "Your organization requires two-factor authentication." The enrolled Administrator then turned the switch off ("${off}") and returned the colleague to Legal team member.`;
  });
  await admin.ctx.close();
}

async function crossPage() {
  const { app, mail } = AUTH_LAB;
  // The Administrator enrolled an authenticator in the twoFactor section and the
  // script keeps no secret, so this section signs the Administrator in with a
  // staff email magic link.
  const admin = await context();
  const since = new Date(Date.now() - 1000);
  const link = await magicLinkFor(admin.page, AUTH_ADMIN.email, false, since);
  await admin.page.goto(link.link);
  await admin.page.waitForLoadState("networkidle");
  await step(A3, "legal_team_member", "OpenLaw checks the account's actual role, whichever sign-in page the person opened", "With Legal password sign-in off, a Legal Team Member is refused on the Portal page too; a Business User with a password can use the staff page", async () => {
    const { page } = admin;
    await openAuthentication(page);
    const off = await toggle(page, "Legal User Authentication", "Email and password");
    const l = await context();
    const legalOnPortal = await passwordSignIn(l.page, authAccounts.legal, AUTH_PASSWORD, true);
    await l.ctx.close();
    const users = (await api(page, app, "GET", "/api/v1/users")).data.users;
    const bu = users.filter((u) => u.email.startsWith("doc029-auth-portal-pw-") && u.role === "business_user").pop();
    const b = await context();
    const buOnStaff = await passwordSignIn(b.page, bu.email, AUTH_PASSWORD, false);
    await b.ctx.close();
    await openAuthentication(page);
    const on = await toggle(page, "Legal User Authentication", "Email and password");
    const pol = await policyNow(page);
    expect(off === "Saved" && legalOnPortal.me === 401 && buOnStaff.me === 200 && buOnStaff.role === "business_user" && pol.legal.password, `${off} ${JSON.stringify(legalOnPortal)} ${JSON.stringify(buOnStaff)} ${on}`);
    return `With Email and password off under Legal User Authentication, the Legal Team Member's password sign-in on the Business Portal page was refused (${legalOnPortal.alert ?? legalOnPortal.outcome}; me ${legalOnPortal.me}). With Business Portal password sign-in on, the Business User's password sign-in on the staff page succeeded (me ${buOnStaff.me}, ${buOnStaff.role}, landed ${buOnStaff.path}). Legal password sign-in was turned back on.`;
  });
  await step(A3, "administrator", "An identity with no account is refused when it first redeems a link issued before its domain was removed", "No session and no account", async () => {
    const { page } = admin;
    const newcomer = `doc029-auth-newlink-${stamp}@northwind.example`;
    const c = await context();
    const since2 = new Date(Date.now() - 1000);
    const m = await magicLinkFor(c.page, newcomer, true, since2);
    expect(m, "no link while the domain was allowed");
    await openAuthentication(page);
    await page.getByRole("button", { name: "Remove northwind.example" }).click();
    await page.getByRole("button", { name: "Remove northwind.example" }).waitFor({ state: "detached" });
    await c.page.goto(m.link);
    await c.page.waitForLoadState("networkidle");
    const landed = new URL(c.page.url()).pathname + (new URL(c.page.url()).searchParams.get("error") ? `?error=${new URL(c.page.url()).searchParams.get("error")}` : "");
    const text = (await c.page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 160);
    const me = await api(c.page, app, "GET", "/api/v1/me");
    await c.ctx.close();
    const created = (await api(page, app, "GET", "/api/v1/users")).data.users.find((u) => u.email === newcomer);
    await page.getByLabel("Allowed email domains").fill("northwind.example");
    await authRegion(page, "Business Portal Authentication").getByRole("button", { name: "Add" }).click();
    await page.getByRole("button", { name: "Remove northwind.example" }).waitFor();
    expect(me.status === 401 && !created, `me ${me.status} created ${JSON.stringify(created)}`);
    return `A never-seen address on northwind.example got "${m.subject}" while the domain was allowed. After Remove northwind.example, opening that link ended on ${landed} ("${text}") with no session (me ${me.status}) and no account. The domain was added back.`;
  });
  await admin.ctx.close();
}

const sections = { org, groups, emailStored, emailEnv, emailIncomplete, emailRestored, policy, sso, twoFactor, crossPage };
try {
  if (!sections[section]) throw new Error(`Unknown section ${section}`);
  await sections[section]();
} finally {
  save();
  await browser.close();
  const failed = results.steps.filter((s) => s.result !== "pass").length;
  console.log(`${results.steps.length} steps, ${failed} not passed -> ${outFile}`);
}
