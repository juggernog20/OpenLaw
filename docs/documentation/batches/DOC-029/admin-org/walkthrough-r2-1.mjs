// DOC-029 round 2 admin-org independent walkthrough (round 1 of round 2).
// Written by the DOC-029r2 independent walkthrough agent (admin-org, round 1), adapted
// from walkthrough-r1.mjs. It follows organisation-and-users (V-C36) and
// authentication-and-email (V-C37) against app commit 57e77e38.
//
// Run from the repository root, one section at a time:
//   LAB_PASSWORD=... mise exec -- node docs/documentation/batches/DOC-029/admin-org/walkthrough-r2-1.mjs org
//   LAB_PASSWORD=... AUTH_PASSWORD=... [OIDC_IP=...] mise exec -- node docs/documentation/batches/DOC-029/admin-org/walkthrough-r2-1.mjs <auth section>
// Passwords come only from the environment. Passwords for accounts this script
// creates are random or come from the environment, held in memory, and never written.
// Each section writes batches/DOC-029/admin-org/runs-r2/<section>-<time>.json.
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
const ADMIN_LAB = {
  app: "http://127.0.0.1:23300",
  mail: "http://127.0.0.1:23400",
  project: "openlaw-docs-41255c61-admin2",
};
const AUTH_LAB = {
  app: "http://127.0.0.1:23310",
  mail: "http://127.0.0.1:23410",
  project: "openlaw-docs-41255c61-adminorg-auth2",
};
const DANIEL = "daniel.okafor@helix.example";
const NADIA = "nadia.haddad@helix.example";
const stamp = Date.now().toString(36);
const newPassword = () => `Doc029-${randomBytes(12).toString("hex")}`;
const SET_PASSWORD = /https?:\/\/\S+\/auth\/set-password\?token=[^\s)]+/;
const MAGIC = /https?:\/\/\S+\/api\/auth\/magic-link\/verify\?token=[^\s)]+/;

mkdirSync(path.join(here, "runs-r2"), { recursive: true });
const outFile = path.join(
  here,
  "runs-r2",
  `${section}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
);
const lab = section === "org" ? ADMIN_LAB : AUTH_LAB;
const { results, step, save } = recorder(outFile, {
  section,
  reviewer: "DOC-029r2 independent walkthrough agent (admin-org, round 1)",
  reviewerKind: "agent",
  labProject: lab.project,
  appUrl: lab.app,
  mailUrl: lab.mail,
  articleHashes: {
    "organisation-and-users": articleHash("organisation-and-users"),
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
  await row(page, email)
    .getByRole("button", { name: new RegExp(`change the role of ${email.replace(/\./g, "\\.")}`) })
    .click();
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
    status: /\bInvited\b/.test(text)
      ? "Invited"
      : /\bArchived\b/.test(text)
        ? "Archived"
        : /\bActive\b/.test(text)
          ? "Active"
          : "?",
    roleControl: (await r.getByRole("button", { name: /change the role of/ }).count()) > 0,
    role:
      ["Administrator", "Legal team member", "Business user"].find((x) => text.includes(x)) ?? null,
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
    a: {
      name: `DOC-029r2 admin-org Avery ${stamp}`,
      email: `doc029r2-org-a-${stamp}@helix.example`,
      password: newPassword(),
    },
    b: {
      name: `DOC-029r2 admin-org Bryn ${stamp}`,
      email: `doc029r2-org-b-${stamp}@helix.example`,
    },
    bu: { name: "", email: `doc029r2-org-bu-${stamp}@helix.example`, password: newPassword() },
  };
  results.identities = [
    { role: "administrator", account: "Daniel Okafor (seeded)" },
    {
      role: "legal_team_member",
      account: "Nadia Haddad (seeded), unauthorized-administration check",
    },
    { role: "invited colleague", account: `DOC-029r2 admin-org Avery ${stamp}` },
    { role: "withdrawn invitation", account: `DOC-029r2 admin-org Bryn ${stamp}` },
    { role: "business_user", account: `doc029r2-org-bu-${stamp}@helix.example (Portal-created)` },
  ];

  await step(
    A,
    "legal_team_member",
    "Unauthorized administration: open Settings General and Users as a Legal Team Member",
    "Redirected away; the users and invite APIs refuse",
    async () => {
      const n = await context();
      await signIn(n.page, app, NADIA);
      const out = {};
      for (const p of ["/settings/general", "/settings/users"]) {
        await n.page.goto(`${app}${p}`);
        await n.page.waitForLoadState("networkidle");
        out[p] = new URL(n.page.url()).pathname;
      }
      const users = await api(n.page, app, "GET", "/api/v1/users");
      const inv = await api(n.page, app, "POST", "/api/v1/auth/invites", {
        email: `doc029r2-org-denied-${stamp}@helix.example`,
        displayName: "DOC-029r2 admin-org denied",
        role: "legal_team_member",
      });
      await n.ctx.close();
      expect(
        out["/settings/general"] === "/settings/profile" &&
          out["/settings/users"] === "/settings/profile",
        `landed on ${JSON.stringify(out)}`,
      );
      expect(
        users.status === 403 && inv.status === 403,
        `users ${users.status}, invite ${inv.status}`,
      );
      return `Settings General and Users redirected Nadia to /settings/profile. GET /api/v1/users answered ${users.status}; POST /api/v1/auth/invites answered ${inv.status}.`;
    },
  );

  const original = (await api(admin.page, app, "GET", "/api/v1/org/general")).data.general;
  results.restoreTargets = {
    organizationName: original.name,
    logoWasNull: original.logo === null,
    defaultTimezone: original.defaultTimezone,
  };

  // Reads the brand block of a sign-in page in a context with no account.
  async function signInBranding(path) {
    const anon = await context();
    await anon.page.goto(`${app}${path}`);
    await anon.page.getByRole("heading", { level: 1 }).first().waitFor();
    await anon.page.waitForLoadState("networkidle");
    await sleep(500);
    const main = anon.page.locator("main");
    const text = (await main.innerText()).replace(/\s+/g, " ");
    const logos = await main
      .getByRole("img", { name: "Organization logo" })
      .evaluateAll((els) => els.map((e) => e.getAttribute("src")?.slice(0, 22)));
    await anon.ctx.close();
    return { text: text.slice(0, 200), logos };
  }

  let draftName;
  await step(
    A,
    "administrator",
    "Update organization details: Organization name saves on Enter, Escape restores, reload keeps the saved value",
    "Saved status; Escape restores the previous name before saving; value survives reload",
    async () => {
      const { page } = admin;
      await page.goto(`${app}/settings/general`);
      const box = page.getByRole("textbox", { name: "Organization name" });
      draftName = `DOC-029r2 admin-org Helix ${stamp}`;
      await box.fill(draftName);
      await box.press("Enter");
      await page.getByText("Saved", { exact: true }).first().waitFor();
      await page.reload();
      const afterEnter = await box.inputValue();
      await box.fill("DOC-029r2 admin-org unsaved draft");
      await box.press("Escape");
      const afterEscape = await box.inputValue();
      await page.reload();
      const afterEscapeReload = await box.inputValue();
      expect(afterEnter === draftName, `after Enter+reload: ${afterEnter}`);
      expect(
        afterEscape === draftName && afterEscapeReload === draftName,
        `after Escape: ${afterEscape} / ${afterEscapeReload}`,
      );
      return `Enter showed Saved and "${draftName}" survived reload. Escape put the saved name back in the field, and after reload the saved name was still "${draftName}".`;
    },
  );

  const fx = path.join(here, "fixtures-r2");
  const bigDir = process.env.SCRATCH_DIR;
  await step(
    A,
    "administrator",
    "Logo: Upload a PNG, JPEG, WebP, or SVG of 5 MB or smaller; any other file shows the rejection message; retry",
    "Text file and a PNG over 5 MB show the 5 MB message and change nothing; a 300 KB PNG and an SVG save",
    async () => {
      const { page } = admin;
      if (!bigDir) throw new Error("SCRATCH_DIR is required for the oversize fixture");
      mkdirSync(fx, { recursive: true });
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      );
      writeFileSync(
        path.join(fx, "doc029r2-logo.svg"),
        '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#2f6f5e"/></svg>\n',
      );
      writeFileSync(
        path.join(fx, "doc029r2-not-an-image.txt"),
        "DOC-029r2 admin-org fixture: not an image\n",
      );
      const mid = path.join(bigDir, "doc029r2-logo-300kb.png");
      const big = path.join(bigDir, "doc029r2-logo-over-5mb.png");
      writeFileSync(mid, Buffer.concat([png, Buffer.alloc(300 * 1024)]));
      writeFileSync(big, Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024 + 1024)]));
      await page.goto(`${app}/settings/general`);
      const upload = async (file) => {
        const chooser = page.waitForEvent("filechooser");
        await page.getByRole("button", { name: "Upload", exact: true }).click();
        await (await chooser).setFiles(file);
      };
      const MESSAGE =
        "That logo must be a PNG, JPEG, WebP, or SVG image 5 MB or smaller. Pick another file.";
      await upload(path.join(fx, "doc029r2-not-an-image.txt"));
      await page.getByText(MESSAGE).waitFor({ timeout: 8000 });
      await page.reload();
      await upload(big);
      await page.getByText(MESSAGE).waitFor({ timeout: 8000 });
      const afterRejects = (await api(page, app, "GET", "/api/v1/org/general")).data.general.logo;
      await page.reload();
      await upload(mid);
      await page.getByText("Saved", { exact: true }).first().waitFor({ timeout: 15000 });
      const midSaved = (await api(page, app, "GET", "/api/v1/org/general")).data.general.logo;
      await page.reload();
      await upload(path.join(fx, "doc029r2-logo.svg"));
      await page.getByText("Saved", { exact: true }).first().waitFor({ timeout: 15000 });
      await page.reload();
      const saved = (await api(page, app, "GET", "/api/v1/org/general")).data.general.logo;
      await page.getByRole("combobox", { name: "Default locale" }).waitFor();
      const imgs = await page.locator('img[src^="data:image/svg"]').count();
      expect(afterRejects === original.logo, "a rejected file changed the logo");
      expect(
        typeof midSaved === "string" &&
          midSaved.startsWith("data:image/png") &&
          midSaved.length > 300 * 1024,
        `300 KB logo ${String(midSaved).slice(0, 30)} len ${midSaved?.length}`,
      );
      expect(
        typeof saved === "string" && saved.startsWith("data:image/svg") && imgs >= 1,
        `saved logo ${String(saved).slice(0, 30)} imgs ${imgs}`,
      );
      return `A .txt file and a PNG of just over 5 MB each showed "${MESSAGE}" and left the logo unchanged. A 300 KB PNG then showed Saved and was stored as a PNG data URI (${midSaved.length} characters). An SVG showed Saved and, after reload, was displayed beside Logo.`;
    },
  );

  await step(
    A,
    "administrator",
    "The saved Organization name and logo appear on the staff and Business Portal sign-in pages without an account",
    "Both pages show the saved name and an Organization logo image",
    async () => {
      const staff = await signInBranding("/auth/login");
      const portal = await signInBranding("/portal/login");
      expect(
        staff.text.includes(draftName) &&
          staff.logos.length === 1 &&
          staff.logos[0].startsWith("data:image/svg"),
        `staff ${JSON.stringify(staff)}`,
      );
      expect(
        portal.text.includes(draftName) && portal.logos.length === 1,
        `portal ${JSON.stringify(portal)}`,
      );
      return `In a browser with no session, /auth/login began "${staff.text.slice(0, 120)}" with ${staff.logos.length} image named Organization logo; /portal/login began "${portal.text.slice(0, 120)}" with ${portal.logos.length} such image.`;
    },
  );

  await step(
    A,
    "administrator",
    "Restore the organization name and logo; the sign-in pages follow",
    "Original name saved by leaving the field; logo restored; sign-in pages show the original name and no logo",
    async () => {
      const { page } = admin;
      await page.goto(`${app}/settings/general`);
      const box = page.getByRole("textbox", { name: "Organization name" });
      await box.fill(original.name);
      await box.press("Tab");
      await page.getByText("Saved", { exact: true }).first().waitFor();
      await page.reload();
      const restoredName = await box.inputValue();
      // The pane has no remove control, so the recorded original logo is put back through the API.
      const restore = await api(page, app, "PATCH", "/api/v1/org/general", { logo: original.logo });
      const staff = await signInBranding("/auth/login");
      expect(
        restoredName === original.name && restore.status === 200,
        `name ${restoredName} restore ${restore.status}`,
      );
      expect(
        staff.text.includes(original.name) && staff.logos.length === (original.logo ? 1 : 0),
        `staff ${JSON.stringify(staff)}`,
      );
      return `Typing "${original.name}" and leaving the field showed Saved and survived reload. The original logo (${original.logo === null ? "none" : "an image"}) was restored through PATCH /api/v1/org/general (${restore.status}) because the pane has no remove control. /auth/login then showed "${staff.text.slice(0, 80)}" with ${staff.logos.length} logo images.`;
    },
  );

  await step(
    A,
    "administrator",
    "Default timezone saves and survives reload; Default locale offers English (United States) only",
    "Timezone saved; one locale option",
    async () => {
      const { page } = admin;
      await page.goto(`${app}/settings/general`);
      const tz = page.getByRole("combobox", { name: "Default timezone" });
      await tz.click();
      await tz.fill("Toronto");
      await tz.press("Enter");
      await page.getByText("Saved", { exact: true }).first().waitFor();
      await page.reload();
      const after = await tz.inputValue();
      const locales = await page
        .getByRole("combobox", { name: "Default locale" })
        .locator("option")
        .allInnerTexts();
      await tz.click();
      await tz.fill(original.defaultTimezone);
      await tz.press("Enter");
      await page.getByText("Saved", { exact: true }).first().waitFor();
      await page.reload();
      const restored = await tz.inputValue();
      expect(after.startsWith("America/Toronto"), `after reload ${after}`);
      expect(
        locales.length === 1 && locales[0].trim() === "English (United States)",
        `locales ${locales}`,
      );
      expect(restored.startsWith(original.defaultTimezone), `restored ${restored}`);
      return `Default timezone saved America/Toronto and kept it after reload. Default locale offered only ${JSON.stringify(locales)}. The timezone was restored to ${original.defaultTimezone}.`;
    },
  );

  let sinceA;
  await step(
    A,
    "administrator",
    "Invite a colleague: Invite user with Display name, Email, and Role Legal team member",
    "Role offers Legal team member and Administrator; Send invite adds an Invited row with Resend invite and Revoke invite; email arrives",
    async () => {
      const { page } = admin;
      await openUsers(page, app);
      await page.getByRole("button", { name: "Invite user" }).click();
      const dialog = page.getByRole("dialog", { name: "Invite user" });
      const radios = await dialog
        .getByRole("radio")
        .evaluateAll((els) => els.map((e) => e.closest("label")?.innerText.trim()));
      await dialog.getByRole("button", { name: "Cancel" }).click();
      sinceA = new Date(Date.now() - 2000);
      const d = await invite(page, people.a.name, people.a.email, "Legal team member");
      await d.waitFor({ state: "hidden" });
      const state = await rowState(page, people.a.email);
      const m = await waitMail(mail, people.a.email, sinceA, SET_PASSWORD);
      expect(
        JSON.stringify(radios) === JSON.stringify(["Legal team member", "Administrator"]),
        `radios ${radios}`,
      );
      expect(
        state.status === "Invited" &&
          !state.roleControl &&
          state.actions.includes("Resend invite") &&
          state.actions.includes("Revoke invite"),
        JSON.stringify(state),
      );
      expect(m, "no invitation email");
      return `Role radios were ${JSON.stringify(radios)}. After Send invite the row read Invited with actions ${JSON.stringify(state.actions)} and no role control. Mailpit received "${m.subject}" with a set-password link.`;
    },
  );

  await step(
    A,
    "administrator",
    "Invalid address is rejected",
    "No row is created for an invalid address",
    async () => {
      const { page } = admin;
      await openUsers(page, app);
      const before = (await api(page, app, "GET", "/api/v1/users")).data.users.length;
      const d = await invite(
        page,
        "DOC-029r2 admin-org invalid",
        "doc029r2-org-invalid-address",
        "Legal team member",
      );
      await sleep(800);
      const stillOpen = await d.isVisible();
      const validation = await d.getByLabel("Email").evaluate((el) => el.validationMessage);
      await d.getByRole("button", { name: "Cancel" }).click();
      const apiTry = await api(page, app, "POST", "/api/v1/auth/invites", {
        email: "doc029 org@@helix",
        displayName: "DOC-029r2 admin-org invalid",
        role: "legal_team_member",
      });
      const after = (await api(page, app, "GET", "/api/v1/users")).data.users.length;
      expect(
        stillOpen && before === after && apiTry.status >= 400,
        `open ${stillOpen}, users ${before}->${after}, api ${apiTry.status}`,
      );
      return `The dialog stayed open with the browser message "${validation}" and no row was added. The same invite route refused a malformed address with ${apiTry.status}.`;
    },
  );

  await step(
    A,
    "administrator",
    "Re-invite the pending address with the same role",
    "The invitation is resent; no duplicate row",
    async () => {
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
    },
  );

  await step(
    A,
    "administrator",
    "Re-invite the pending address with a different role",
    "Refused because the account already exists; no email",
    async () => {
      const { page } = admin;
      await openUsers(page, app);
      const since = new Date();
      const d = await invite(page, people.a.name, people.a.email, "Administrator");
      const alert = await d.getByRole("alert").innerText();
      await d.getByRole("button", { name: "Cancel" }).click();
      await sleep(2500);
      const n = await countMail(mail, people.a.email, since);
      expect(
        /already exists with a different role/.test(alert) && n === 0,
        `alert "${alert}", mails ${n}`,
      );
      return `The dialog showed "${alert}" and no email was sent.`;
    },
  );

  await step(A, "administrator", "Invite an already activated account", "Refused", async () => {
    const { page } = admin;
    await openUsers(page, app);
    const d = await invite(page, "Nadia Haddad", NADIA, "Legal team member");
    const alert = await d.getByRole("alert").innerText();
    await d.getByRole("button", { name: "Cancel" }).click();
    expect(/already activated/.test(alert), alert);
    return `The dialog showed "${alert}".`;
  });

  await step(
    A,
    "administrator",
    "Resend invite from the pending row",
    "A replacement link is emailed",
    async () => {
      const { page } = admin;
      await openUsers(page, app);
      const since = new Date(Date.now() - 1000);
      await row(page, people.a.email)
        .getByRole("button", { name: `Resend the invite to ${people.a.email}` })
        .click();
      await row(page, people.a.email).getByText("Saved", { exact: true }).waitFor();
      const m = await waitMail(mail, people.a.email, since, SET_PASSWORD);
      expect(m, "no resend email");
      people.a.latestLink = m.link;
      return `The row showed Saved and a new "${m.subject}" email arrived. Its link is the latest one and is used for activation below.`;
    },
  );

  const colleague = await context();
  await step(
    A,
    "invited colleague",
    "A magic-link sign-in alone does not activate the invited row",
    "The colleague signs in; the row stays Invited with Resend invite and Revoke invite",
    async () => {
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
      expect(
        state.status === "Invited" &&
          state.actions.includes("Resend invite") &&
          state.actions.includes("Revoke invite") &&
          !state.roleControl,
        JSON.stringify(state),
      );
      return `The staff sign-in page sent "${m.subject}". Opening the link signed the colleague in (landed on ${landed}; /api/v1/me ${me.status}). Daniel's Users table still showed the row as Invited with ${JSON.stringify(state.actions)} and no role control.`;
    },
  );

  await step(
    A,
    "invited colleague",
    "Set a password from the latest invitation link; the row becomes Active",
    "Password set; row Active with role control",
    async () => {
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
    },
  );

  await step(
    A,
    "invited colleague",
    "The activated Legal team member checks their access",
    "No administration: Users redirects and there is no Invite user",
    async () => {
      const { page } = colleague;
      await page.goto(`${app}/settings/users`);
      await page.waitForLoadState("networkidle");
      const p = new URL(page.url()).pathname;
      const invites = await page.getByRole("button", { name: "Invite user" }).count();
      expect(p === "/settings/profile" && invites === 0, `${p}, invite buttons ${invites}`);
      return `Settings Users redirected to ${p}; no Invite user control was offered.`;
    },
  );

  await step(
    A,
    "administrator",
    "Revoke invite withdraws an unused invitation",
    "The pending row is removed",
    async () => {
      const { page } = admin;
      await openUsers(page, app);
      const d = await invite(page, people.b.name, people.b.email, "Legal team member");
      await d.waitFor({ state: "hidden" });
      const before = await rowState(page, people.b.email);
      await row(page, people.b.email)
        .getByRole("button", { name: `Revoke the invite to ${people.b.email}` })
        .click();
      await row(page, people.b.email).waitFor({ state: "detached" });
      const list = (await api(page, app, "GET", "/api/v1/users")).data.users.some(
        (u) => u.email === people.b.email,
      );
      expect(
        before.status === "Invited" && !list,
        `before ${JSON.stringify(before)}, still listed ${list}`,
      );
      return `The Invited row for Bryn disappeared after Revoke invite, and GET /api/v1/users no longer listed the address.`;
    },
  );

  await step(
    A,
    "administrator",
    "Change a role: promote the colleague to Administrator; the change applies on their next action",
    "Role control offers three roles; colleague gains administration without signing in again",
    async () => {
      const { page } = admin;
      await openUsers(page, app);
      const items = await chooseRole(page, people.a.email, "Administrator");
      await row(page, people.a.email).getByText("Saved", { exact: true }).waitFor();
      await openUsers(page, app);
      const state = (await row(page, people.a.email).innerText()).includes("Administrator");
      await colleague.page.goto(`${app}/settings/users`);
      await colleague.page
        .getByRole("heading", { name: "Users", level: 2 })
        .waitFor({ timeout: 15000 });
      expect(
        JSON.stringify(items) ===
          JSON.stringify(["Administrator", "Legal team member", "Business user"]),
        `items ${items}`,
      );
      expect(state, "row did not read Administrator");
      return `The role menu offered ${JSON.stringify(items)}. Choosing Administrator showed Saved and the reloaded row read Administrator. The colleague's existing session opened Settings Users on its next navigation without signing in again.`;
    },
  );

  await step(
    A,
    "administrator",
    "Change the role back to Legal team member",
    "The colleague loses administration on the next request",
    async () => {
      const { page } = admin;
      await openUsers(page, app);
      await chooseRole(page, people.a.email, "Legal team member");
      await row(page, people.a.email).getByText("Saved", { exact: true }).waitFor();
      const r = await api(colleague.page, app, "GET", "/api/v1/users");
      expect(r.status === 403, `status ${r.status}`);
      return `The row saved Legal team member. The colleague's same session got ${r.status} from GET /api/v1/users on its next request.`;
    },
  );

  const bu = await context();
  await step(
    A,
    "administrator",
    "Promote a Portal-created Business User with no password: the row becomes Invited without a role control",
    "Invited row; Resend invite emails a link; setting a password returns Active with role control",
    async () => {
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
      const d = await invite(page, "DOC-029r2 admin-org BU", people.bu.email, "Legal team member");
      const alert = await d.getByRole("alert").innerText();
      await d.getByRole("button", { name: "Cancel" }).click();
      await chooseRole(page, people.bu.email, "Legal team member");
      await sleep(1500);
      await openUsers(page, app);
      const promoted = await rowState(page, people.bu.email);
      const since2 = new Date(Date.now() - 1000);
      await row(page, people.bu.email)
        .getByRole("button", { name: `Resend the invite to ${people.bu.email}` })
        .click();
      const inv = await waitMail(mail, people.bu.email, since2, SET_PASSWORD);
      expect(inv, "no resend email");
      const fresh = await context();
      await setPasswordFromLink(fresh.page, inv.link, people.bu.password);
      await fresh.ctx.close();
      await openUsers(page, app);
      const activated = await rowState(page, people.bu.email);
      expect(
        before.status === "Active" && before.roleControl && before.role === "Business user",
        `before ${JSON.stringify(before)}`,
      );
      expect(/already/i.test(alert), `invite alert ${alert}`);
      expect(
        promoted.status === "Invited" &&
          !promoted.roleControl &&
          promoted.actions.includes("Resend invite"),
        `promoted ${JSON.stringify(promoted)}`,
      );
      expect(
        activated.status === "Active" && activated.roleControl,
        `activated ${JSON.stringify(activated)}`,
      );
      return `The Portal sign-in link created an Active Business user row with a role control. Inviting that address as a Legal team member was refused with "${alert}". Promoting it to Legal team member turned the row Invited with ${JSON.stringify(promoted.actions)} and no role control. Resend invite sent "${inv.subject}"; after the password was set the row read Active with its role control back.`;
    },
  );

  await step(
    A,
    "administrator",
    "Return the activated account to Business user, then promote again",
    "An already activated account stays Active and keeps its role control",
    async () => {
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
      expect(
        back.status === "Active" &&
          back.roleControl &&
          again.status === "Active" &&
          again.roleControl,
        `back ${JSON.stringify(back)} again ${JSON.stringify(again)}`,
      );
      return `Returned to Business user the row stayed Active with a role control. Promoted again it stayed Active with its role control, as the article's "If it still reads Active" branch says. It was left as a Business user.`;
    },
  );

  await step(
    A,
    "administrator",
    "Your own row has no Sign out user or Archive action; self-archive is refused",
    "No row actions on Daniel's row; API refuses self archive",
    async () => {
      const { page } = admin;
      await openUsers(page, app);
      const self = await rowState(page, DANIEL);
      const me = (await api(page, app, "GET", "/api/v1/users")).data.users.find(
        (u) => u.email === DANIEL,
      );
      const r = await api(page, app, "POST", `/api/v1/users/${me.id}/archive`);
      expect(
        self.roleControl &&
          !self.actions.includes("Sign out user") &&
          !self.actions.includes("Archive"),
        JSON.stringify(self),
      );
      expect(r.status >= 400, `self archive ${r.status}`);
      return `Daniel's own row had a role control and no Sign out user or Archive action (buttons: ${JSON.stringify(self.actions)}). A direct archive request for his own account was refused with ${r.status}: "${r.data?.detail}".`;
    },
  );

  await step(
    A,
    "administrator",
    "Sign out user ends the colleague's sessions; the account stays active and can sign in again",
    "Colleague's next request needs sign-in; row Active; password sign-in works",
    async () => {
      const { page } = admin;
      await openUsers(page, app);
      const before = await api(colleague.page, app, "GET", "/api/v1/me");
      await row(page, people.a.email)
        .getByRole("button", { name: `Revoke all sessions of ${people.a.email}` })
        .click();
      await row(page, people.a.email).getByText("Saved", { exact: true }).waitFor();
      const after = await api(colleague.page, app, "GET", "/api/v1/me");
      await colleague.page.goto(`${app}/`);
      await colleague.page.waitForLoadState("networkidle");
      const landed = new URL(colleague.page.url()).pathname;
      const state = await rowState(page, people.a.email);
      await signIn(colleague.page, app, people.a.email, people.a.password);
      const again = await api(colleague.page, app, "GET", "/api/v1/me");
      expect(
        before.status === 200 && after.status === 401 && landed.startsWith("/auth/login"),
        `before ${before.status} after ${after.status} landed ${landed}`,
      );
      expect(
        state.status === "Active" && again.status === 200,
        `state ${JSON.stringify(state)} again ${again.status}`,
      );
      return `The visible action label was "Sign out user". The colleague's session went from ${before.status} to ${after.status} on /api/v1/me and the app sent it to ${landed}. The row stayed Active, and a password sign-in worked again (${again.status}).`;
    },
  );

  let contractNumber;
  await step(
    A,
    "administrator",
    "Archiving does not bulk-reassign work: a Contract keeps its Owner",
    "The archived person stays the Contract Owner until someone reassigns it",
    async () => {
      const { page } = admin;
      const users = (await api(page, app, "GET", "/api/v1/users")).data.users;
      const aId = users.find((u) => u.email === people.a.email).id;
      const types = (await api(page, app, "GET", "/api/v1/contract-types")).data.contractTypes;
      const other = types.find((t) => t.slug === "other") ?? types[0];
      const created = await api(page, app, "POST", "/api/v1/contracts", {
        title: `DOC-029r2 admin-org offboarding contract ${stamp}`,
        contractTypeId: other.id,
        managerId: aId,
      });
      expect(
        created.status === 201 || created.status === 200,
        `create ${created.status} ${JSON.stringify(created.data)}`,
      );
      contractNumber = created.data.contract.number;
      results.records = [
        ...(results.records ?? []),
        `Contract ${contractNumber} "DOC-029r2 admin-org offboarding contract ${stamp}"`,
      ];
      people.a.id = aId;
      return `Created Contract ${contractNumber} with the colleague as Legal Owner (prepared through the API; the check follows in the archive step).`;
    },
  );

  await step(
    A,
    "administrator",
    "Archive the colleague: the row leaves the ordinary list, sessions end, sign-in is blocked",
    "Row hidden; live session ends; password sign-in refused; Contract Owner unchanged",
    async () => {
      const { page } = admin;
      await openUsers(page, app);
      const live = await api(colleague.page, app, "GET", "/api/v1/me");
      await row(page, people.a.email)
        .getByRole("button", { name: `Archive ${people.a.email}` })
        .click();
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
      expect(
        live.status === 200 && after.status === 401,
        `live ${live.status} after ${after.status}`,
      );
      expect(/archived/i.test(alert), `sign-in alert ${alert}`);
      expect(
        manager?.id === people.a.id && manager?.archived === true,
        `manager ${JSON.stringify(manager)}`,
      );
      return `Archive removed the row from the ordinary list at once. The colleague's live session went from ${live.status} to ${after.status}. A new password sign-in showed "${alert}". Contract ${contractNumber} still named the archived colleague as Legal Owner (archived: ${manager.archived}); nothing was reassigned.`;
    },
  );

  await step(
    A,
    "administrator",
    "Show archived, Restore, and ask the user to sign in again",
    "Restored row Active; the revoked session stays revoked; a new sign-in works",
    async () => {
      const { page } = admin;
      await openUsers(page, app);
      await page.getByRole("switch", { name: "Show archived" }).click();
      const archived = await rowState(page, people.a.email);
      await row(page, people.a.email)
        .getByRole("button", { name: `Restore ${people.a.email}` })
        .click();
      await row(page, people.a.email).getByText("Saved", { exact: true }).waitFor();
      const restored = await rowState(page, people.a.email);
      const old = await api(colleague.page, app, "GET", "/api/v1/me");
      await signIn(colleague.page, app, people.a.email, people.a.password);
      const again = await api(colleague.page, app, "GET", "/api/v1/me");
      expect(
        archived.status === "Archived" && archived.actions.includes("Restore"),
        `archived ${JSON.stringify(archived)}`,
      );
      expect(
        restored.status === "Active" && old.status === 401 && again.status === 200,
        `restored ${JSON.stringify(restored)} old ${old.status} again ${again.status}`,
      );
      return `With Show archived on, the row read Archived with a Restore action. Restore showed Saved and the row read Active. The old browser session still got ${old.status}; a fresh password sign-in got ${again.status}.`;
    },
  );

  await shot(admin.page, "org-users-restored-r2");
  await Promise.all([admin.ctx.close(), colleague.ctx.close(), bu.ctx.close()]);
}

// ---------------------------------------------------------------------------
// V-C37 authentication-and-email on the owned adminorg-auth lab.
const AUTH_ADMIN = {
  name: "DOC-029r2 admin-org Auth Admin",
  email: "doc029-auth-admin@helix.example",
};
function totp(uri) {
  const secret = new URL(uri).searchParams.get("secret");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of secret.replace(/=+$/, "").toUpperCase())
    bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1000000).padStart(6, "0");
}

const AUTH_PASSWORD = process.env.AUTH_PASSWORD;
const A3 = "authentication-and-email";
const STORED_FROM = "DOC-029r2 Stored <stored-relay@helix.example>";
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
    if (await page.getByRole("button", { name: "Get started" }).count())
      await page.getByRole("button", { name: "Get started" }).click();
    else if (await cont.count()) await cont.click();
    await sleep(500);
  }
  await page.getByRole("heading", { name: "Outbound email" }).waitFor();
}
const pageText = async (page) => (await page.locator("main").innerText()).replace(/\s+/g, " ");
const buttons = async (page) =>
  (await page.locator("main").getByRole("button").allInnerTexts())
    .map((x) => x.trim())
    .filter(Boolean);

const smtp = (page) => ({
  host: page.getByLabel("SMTP server"),
  port: page.getByLabel("Port", { exact: true }),
  security: page.getByLabel("Connection security"),
  authentication: page.getByLabel("Authentication", { exact: true }),
  username: page.getByLabel("SMTP username"),
  password: page.getByLabel("SMTP password"),
  senderName: page.getByLabel("Sender name (optional)"),
  senderEmail: page.getByLabel("Sender email"),
});
/** Fills the Outbound email form in the article's order and selects Save relay. */
async function fillRelay(
  page,
  { host, port, security, authentication, username, password, senderEmail, senderName },
) {
  const f = smtp(page);
  await f.host.fill(host);
  await f.security.selectOption({ label: security });
  if (port !== undefined) await f.port.fill(String(port));
  await f.authentication.selectOption({ label: authentication });
  if (authentication === "Username and password") {
    await f.username.fill(username);
    await f.password.fill(password);
  }
  await f.senderEmail.fill(senderEmail);
  if (senderName !== undefined) await f.senderName.fill(senderName);
  await page.getByRole("button", { name: "Save relay" }).click();
}
const WORKING_RELAY = {
  host: "mailpit",
  port: 1025,
  security: "None",
  authentication: "None",
  senderEmail: "stored-relay@helix.example",
  senderName: "DOC-029r2 Stored",
};
const STANDING_ALERT =
  /^(Set up outbound email to finish instance setup|Outbound email is set in the app|Outbound email is set by the deployment environment|The deployment environment sets SMTP_URL)/;
/** Waits for the result of Save relay or Clear relay: a notice or a new alert. */
async function emailNotice(page) {
  await sleep(400);
  for (let i = 0; i < 80; i++) {
    const t = await pageText(page);
    const m = t.match(
      /(Relay saved\.[^.]*\.|Relay cleared\.[^.]*\.|The relay could not be (saved|cleared)\.[^]*?\.(?= [A-Z]|$))/,
    );
    const alerts = (await page.locator("main").getByRole("alert").allInnerTexts())
      .map((x) => x.trim())
      .filter((x) => x && !STANDING_ALERT.test(x));
    if (m || alerts.length) return { match: m?.[0] ?? null, alerts };
    await sleep(250);
  }
  return { match: null, alerts: [] };
}
/** Selects Send test email and waits for its own result text. */
async function sendTest(page) {
  await page.getByRole("button", { name: "Send test email" }).click();
  const result = page
    .getByText(
      /^(Test email sent to \S+\. Check your inbox\.|The test email could not be sent\..*)$/,
    )
    .first();
  await result.waitFor({ timeout: 60000 });
  return (await result.innerText()).trim();
}

async function emailStored() {
  const { app, mail } = AUTH_LAB;
  results.phase =
    "stored: SMTP_URL and SMTP_FROM empty for app and worker (overlay-phase-stored.json)";
  const admin = await context();
  await step(
    A3,
    "administrator",
    "First-run: create the first Administrator; the wizard needs email before it can finish",
    "Welcome wizard opens; Skip optional steps on Welcome opens Outbound email while email is unset; no Set up later; Continue unavailable",
    async () => {
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
      return `The first Administrator was created and landed on /welcome. Skip optional steps on the Welcome step opened Outbound email (${new URL(page.url()).pathname}${new URL(page.url()).search}) with "Set up outbound email to finish instance setup...". The step had no Set up later (buttons ${JSON.stringify(b)}) and Continue was disabled.`;
    },
  );

  await step(
    "organisation-and-users",
    "administrator",
    "With no saved Organization name, the sign-in pages show OpenLaw",
    "Staff and Portal sign-in pages show OpenLaw and no logo",
    async () => {
      const out = {};
      for (const p of ["/auth/login", "/portal/login"]) {
        const anon = await context();
        await anon.page.goto(`${app}${p}`);
        await anon.page.getByRole("heading", { level: 1 }).first().waitFor();
        await anon.page.waitForLoadState("networkidle");
        await sleep(500);
        const t = (await anon.page.locator("main").innerText()).replace(/\s+/g, " ");
        out[p] = {
          start: t.slice(0, 60),
          logos: await anon.page
            .locator("main")
            .getByRole("img", { name: "Organization logo" })
            .count(),
        };
        await anon.ctx.close();
      }
      const branding = await (await fetch(`${app}/api/v1/org/branding`)).json();
      expect(
        branding.name === "" &&
          Object.values(out).every((x) => x.start.startsWith("OpenLaw") && x.logos === 0),
        `${JSON.stringify(branding)} ${JSON.stringify(out)}`,
      );
      return `On the unseeded lab the organization had no saved name (GET /api/v1/org/branding ${JSON.stringify(branding)}). In a browser with no session: ${JSON.stringify(out)}.`;
    },
  );

  await step(
    A3,
    "administrator",
    "Outbound email form: Port starts at 587 and follows Connection security until changed; Authentication shows or hides SMTP username and SMTP password",
    "587, 465 for TLS, 25 for None, back to 587; a changed port stays; credentials fields only with Username and password",
    async () => {
      const { page } = admin;
      const f = smtp(page);
      const seen = {};
      seen.initial = await f.port.inputValue();
      seen.securityOptions = (await f.security.locator("option").allInnerTexts()).map((x) =>
        x.trim(),
      );
      seen.authenticationOptions = (await f.authentication.locator("option").allInnerTexts()).map(
        (x) => x.trim(),
      );
      seen.initialAuthentication = await f.authentication.locator("option:checked").innerText();
      await f.security.selectOption({ label: "TLS" });
      seen.tls = await f.port.inputValue();
      await f.security.selectOption({ label: "None" });
      seen.none = await f.port.inputValue();
      await f.security.selectOption({ label: "STARTTLS" });
      seen.starttls = await f.port.inputValue();
      await f.port.fill("2525");
      await f.security.selectOption({ label: "TLS" });
      seen.changedThenTls = await f.port.inputValue();
      seen.credentialsWithPassword = [await f.username.count(), await f.password.count()];
      await f.authentication.selectOption({ label: "None" });
      seen.credentialsWithNone = [await f.username.count(), await f.password.count()];
      await page.goto(`${app}/welcome?step=email`);
      await page.getByRole("heading", { name: "Outbound email" }).waitFor();
      expect(
        seen.initial === "587" &&
          seen.tls === "465" &&
          seen.none === "25" &&
          seen.starttls === "587" &&
          seen.changedThenTls === "2525",
        JSON.stringify(seen),
      );
      expect(
        JSON.stringify(seen.securityOptions) === JSON.stringify(["STARTTLS", "TLS", "None"]) &&
          JSON.stringify(seen.authenticationOptions) ===
            JSON.stringify(["Username and password", "None"]),
        JSON.stringify(seen),
      );
      expect(
        seen.credentialsWithPassword.join() === "1,1" && seen.credentialsWithNone.join() === "0,0",
        JSON.stringify(seen),
      );
      return `Observed ${JSON.stringify(seen)}. The page was reloaded afterwards and stayed on Outbound email.`;
    },
  );

  await step(
    A3,
    "administrator",
    "SMTP server with an smtp:// prefix or a port is refused",
    "Not saved; source stays unset",
    async () => {
      const { page } = admin;
      const out = [];
      for (const host of ["smtp://mailpit", "mailpit:1025"]) {
        await page.reload();
        await page.getByRole("heading", { name: "Outbound email" }).waitFor();
        await fillRelay(page, { ...WORKING_RELAY, host });
        const n = await emailNotice(page);
        const settings = await api(page, app, "GET", "/api/v1/email-settings");
        out.push({ host, notice: n.match, alerts: n.alerts, source: settings.data?.source });
      }
      expect(
        out.every((x) => x.source === "unset" && !/Relay saved/.test(x.notice ?? "")),
        JSON.stringify(out),
      );
      return `Save relay results: ${JSON.stringify(out)}.`;
    },
  );

  const smtpUser = "doc029r2-smtp-user";
  const smtpSecret = `doc029r2-${randomBytes(9).toString("hex")}`;
  await step(
    A3,
    "administrator",
    "Save relay with STARTTLS and Username and password; credentials are never returned; the test fails because the relay offers no TLS upgrade",
    "Relay saved; the page and API show no credentials; stored value is not plain text; Send test email fails and nothing is delivered",
    async () => {
      const { page } = admin;
      await page.reload();
      await page.getByRole("heading", { name: "Outbound email" }).waitFor();
      await fillRelay(page, {
        host: "mailpit",
        security: "STARTTLS",
        port: 1025,
        authentication: "Username and password",
        username: smtpUser,
        password: smtpSecret,
        senderEmail: "stored-relay@helix.example",
        senderName: "DOC-029r2 Stored",
      });
      const saved = await emailNotice(page);
      const text = await pageText(page);
      const settings = await api(page, app, "GET", "/api/v1/email-settings");
      const html = await page.content();
      const { execFileSync } = await import("node:child_process");
      const stored = execFileSync(
        "docker",
        [
          "--context",
          "default",
          "exec",
          `${AUTH_LAB.project}-postgres-1`,
          "psql",
          "-U",
          "openlaw",
          "-d",
          "openlaw",
          "-At",
          "-c",
          "select smtp_url from org_settings",
        ],
        { encoding: "utf8" },
      );
      const storedPlain =
        stored.includes(smtpSecret) || stored.includes(smtpUser) || stored.includes("mailpit");
      const since = new Date(Date.now() - 1000);
      const test = await sendTest(page);
      await sleep(3000);
      const n = await countMail(mail, AUTH_ADMIN.email, since);
      expect(/Relay saved\./.test(saved.match ?? ""), JSON.stringify(saved));
      expect(
        JSON.stringify(Object.keys(settings.data).sort()) ===
          JSON.stringify(["fromAddress", "source"]) && settings.data.source === "app",
        JSON.stringify(settings.data),
      );
      expect(
        !html.includes(smtpSecret) &&
          !text.includes(smtpUser) &&
          !JSON.stringify(settings.data).includes(smtpSecret),
        "credentials shown",
      );
      expect(!storedPlain && stored.trim().length > 0, "stored value readable");
      expect(/The test email could not be sent\./.test(test) && n === 0, `${test} mails ${n}`);
      return `Save relay showed "${saved.match}". The step read "${text.match(/Outbound email is set in the app\.[^.]*\.[^.]*\./)?.[0]}". GET /api/v1/email-settings returned only ${JSON.stringify(Object.keys(settings.data))} (${JSON.stringify(settings.data)}); neither the page nor the API contained the SMTP username or password. The org_settings.smtp_url column held a ${stored.trim().length}-character value that did not contain the host, username or password in plain text. Send test email against Mailpit, which offers no STARTTLS, showed "${test}" and Mailpit received ${n} messages.`;
    },
  );

  await step(
    A3,
    "administrator",
    "Replace relay opens an empty form; Keep current relay closes it without a change; replace with None and None and send a test",
    "Empty form; Keep current relay leaves the relay unchanged; Relay saved; test message arrives from the Sender email with the Sender name",
    async () => {
      const { page } = admin;
      const before = (await api(page, app, "GET", "/api/v1/email-settings")).data;
      await page.getByRole("button", { name: "Replace relay" }).click();
      const f = smtp(page);
      const form = {
        host: await f.host.inputValue(),
        port: await f.port.inputValue(),
        security: await f.security.locator("option:checked").innerText(),
        authentication: await f.authentication.locator("option:checked").innerText(),
        username: await f.username.inputValue(),
        password: await f.password.inputValue(),
        senderName: await f.senderName.inputValue(),
        senderEmail: await f.senderEmail.inputValue(),
      };
      await page.getByRole("button", { name: "Keep current relay" }).click();
      const formGone = await f.host.count();
      const kept = (await api(page, app, "GET", "/api/v1/email-settings")).data;
      await page.getByRole("button", { name: "Replace relay" }).click();
      await fillRelay(page, WORKING_RELAY);
      const saved = await emailNotice(page);
      const text = await pageText(page);
      const since = new Date(Date.now() - 1000);
      const test = await sendTest(page);
      const m = await waitMail(mail, AUTH_ADMIN.email, since, null);
      const cont = await page.getByRole("button", { name: "Continue" }).isDisabled();
      expect(
        form.host === "" &&
          form.username === "" &&
          form.password === "" &&
          form.senderName === "" &&
          form.senderEmail === "",
        JSON.stringify(form),
      );
      expect(
        formGone === 0 && JSON.stringify(kept) === JSON.stringify(before),
        `form ${formGone} kept ${JSON.stringify(kept)}`,
      );
      expect(
        /Relay saved\./.test(saved.match ?? "") &&
          /Outbound email is set in the app\. Mail is sent from/.test(text),
        `${JSON.stringify(saved)} ${text.slice(0, 200)}`,
      );
      expect(
        m && m.from === "stored-relay@helix.example" && m.fromName === "DOC-029r2 Stored" && !cont,
        `${JSON.stringify(m)} continue disabled ${cont}`,
      );
      return `Replace relay opened ${JSON.stringify(form)}. Keep current relay closed the form and the settings stayed ${JSON.stringify(kept)}. Replace relay with SMTP server mailpit, Port 1025, Connection security None, Authentication None, Sender email stored-relay@helix.example and Sender name DOC-029r2 Stored showed "${saved.match}" and "${text.match(/Outbound email is set in the app\.[^.]*\.[^.]*\./)?.[0]}". Send test email showed "${test}" and Mailpit received "${m.subject}" from ${m.fromName} <${m.from}>. Continue became available.`;
    },
  );

  await step(
    A3,
    "administrator",
    "Replace relay with a server that cannot be reached; the saved relay fails its test; Replace relay again with all details and retest",
    "Relay saved alone does not prove delivery; the corrected relay delivers",
    async () => {
      const { page } = admin;
      await page.getByRole("button", { name: "Replace relay" }).click();
      await fillRelay(page, {
        ...WORKING_RELAY,
        host: "doc029r2-unreachable-relay.invalid",
        port: 2525,
      });
      const saved = await emailNotice(page);
      await page.getByRole("button", { name: "Send test email" }).click();
      const failure = (
        await page.getByText("The test email could not be sent.").innerText({ timeout: 60000 })
      ).trim();
      await page.getByRole("button", { name: "Replace relay" }).click();
      await fillRelay(page, WORKING_RELAY);
      await page.getByText("Relay saved.").waitFor();
      const since = new Date(Date.now() - 1000);
      await page.getByRole("button", { name: "Send test email" }).click();
      await page.getByText(`Test email sent to ${AUTH_ADMIN.email}`).waitFor();
      const m = await waitMail(mail, AUTH_ADMIN.email, since, null);
      expect(
        /Relay saved\./.test(saved.match ?? "") && m,
        `${JSON.stringify(saved)} ${JSON.stringify(m)}`,
      );
      return `An unreachable SMTP server saved with "${saved.match}", but Send test email showed "${failure}". Replace relay, all details entered again, Save relay, and a second test delivered "${m.subject}" from ${m.from}.`;
    },
  );

  await step(
    A3,
    "administrator",
    "Clear relay stops email delivery when there is no environment override; save a valid replacement",
    "Source unset, Continue unavailable, no mail; saved replacement restores delivery",
    async () => {
      const { page } = admin;
      await page.getByRole("button", { name: "Clear relay" }).click();
      await page.getByText("Relay cleared. This instance can no longer send email.").waitFor();
      const source = (await api(page, app, "GET", "/api/v1/email-settings")).data?.source;
      const cont = await page.getByRole("button", { name: "Continue" }).isDisabled();
      const since = new Date();
      const reset = await api(page, app, "POST", "/api/v1/auth/password-setup", {
        email: AUTH_ADMIN.email,
      });
      await sleep(3000);
      const n = await countMail(mail, AUTH_ADMIN.email, since);
      await fillRelay(page, WORKING_RELAY);
      await page.getByText("Relay saved.").waitFor();
      const since2 = new Date(Date.now() - 1000);
      await page.getByRole("button", { name: "Send test email" }).click();
      const m = await waitMail(mail, AUTH_ADMIN.email, since2, null);
      expect(
        source === "unset" && cont && n === 0,
        `source ${source}, continue disabled ${cont}, mails ${n}, reset ${reset.status}`,
      );
      expect(m, "no mail after replacement");
      return `Clear relay showed "Relay cleared. This instance can no longer send email." The source became ${source} and Continue was disabled again. A password setup request for the Administrator answered ${reset.status}${reset.data?.detail ? ` ("${reset.data.detail}")` : ""} and no message arrived. After a valid replacement was saved, a test message arrived again from ${m.from}.`;
    },
  );
  await admin.ctx.close();
}

async function emailEnv() {
  const { app, mail } = AUTH_LAB;
  results.phase =
    "env: SMTP_URL smtp://mailpit:1025 and SMTP_FROM DOC-029 Environment <env-relay@helix.example> (overlay-phase-env.json), stored relay still saved";
  const admin = await authAdmin();
  await step(
    A3,
    "operator",
    "Deployment sets SMTP_URL and SMTP_FROM: the wizard relay settings are read-only and the environment wins",
    "No Save relay, Replace relay or Clear relay; mail is sent from the environment sender, not the stored one",
    async () => {
      const { page } = admin;
      await emailStep(page);
      const text = await pageText(page);
      const b = await buttons(page);
      const put = await api(page, app, "PUT", "/api/v1/email-settings", {
        smtpUrl: "smtp://mailpit:1025",
        smtpFrom: STORED_FROM,
      });
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("heading", { name: "Invite your team" }).waitFor();
      const invitee = "doc029-auth-env-invite@helix.example";
      const since = new Date(Date.now() - 1000);
      await page.getByLabel("Name").fill("DOC-029r2 admin-org Auth Env Invite");
      await page.getByLabel("Email").fill(invitee);
      await page.getByRole("button", { name: "Send invite" }).click();
      const m = await waitMail(mail, invitee, since, SET_PASSWORD);
      expect(
        /Outbound email is set by the deployment environment\. Mail is sent from DOC-029 Environment/.test(
          text,
        ),
        text.slice(0, 300),
      );
      expect(
        !b.some((x) =>
          ["Save relay", "Replace relay", "Clear relay", "Send test email"].includes(x),
        ),
        `buttons ${b}`,
      );
      expect(put.status >= 400, `PUT ${put.status}`);
      expect(m && m.from === ENV_FROM, JSON.stringify(m));
      return `The Outbound email step read "Outbound email is set by the deployment environment. Mail is sent from DOC-029 Environment <${ENV_FROM}>." with the hint that settings saved here never apply. Its buttons were ${JSON.stringify(b)}; there was no Save relay, Replace relay, Clear relay or Send test email. A direct save attempt answered ${put.status}. An invitation from the Invite your team step arrived from ${m.from}, not from the stored stored-relay@helix.example.`;
    },
  );
  await admin.ctx.close();
}

async function emailIncomplete() {
  const { app, mail } = AUTH_LAB;
  results.phase =
    "incomplete: SMTP_URL set, SMTP_FROM empty (overlay-phase-incomplete.json), complete stored relay still saved";
  const admin = await authAdmin();
  await step(
    A3,
    "operator",
    "SMTP_URL without SMTP_FROM prevents delivery even though a complete relay is stored in the app",
    "Warning shown; no message is sent",
    async () => {
      const { page } = admin;
      await emailStep(page);
      const text = await pageText(page);
      const settings = await api(page, app, "GET", "/api/v1/email-settings");
      const invitee = "doc029-auth-incomplete-invite@helix.example";
      const since = new Date(Date.now() - 1000);
      const cont = page.getByRole("button", { name: "Continue" });
      let inviteResult = "Continue was disabled, so the invite step could not be reached";
      if (await cont.isDisabled()) {
        const r = await api(page, app, "POST", "/api/v1/auth/invites", {
          email: invitee,
          displayName: "DOC-029r2 admin-org Auth Incomplete Invite",
          role: "legal_team_member",
        });
        await sleep(4000);
        inviteResult += `. A direct invitation through the Users invite route answered ${r.status}${r.data?.detail ? ` ("${r.data.detail}")` : ""}`;
      }
      if (!(await cont.isDisabled())) {
        await cont.click();
        await page.getByRole("heading", { name: "Invite your team" }).waitFor();
        await page.getByLabel("Name").fill("DOC-029r2 admin-org Auth Incomplete Invite");
        await page.getByLabel("Email").fill(invitee);
        await page.getByRole("button", { name: "Send invite" }).click();
        await sleep(4000);
        inviteResult = `the invite step answered "${(await pageText(page)).match(/(The invite could not be sent\.[^.]*\.?|\d+ invites? sent:[^A-Z]*)/)?.[0] ?? "(no status text)"}"`;
      }
      const n = await countMail(mail, invitee, since);
      expect(
        /sets SMTP_URL but not SMTP_FROM, so mail cannot be sent/.test(text),
        text.slice(0, 300),
      );
      expect(
        settings.data?.source === "env" && n === 0,
        `source ${settings.data?.source}, mails ${n}`,
      );
      return `The step warned "The deployment environment sets SMTP_URL but not SMTP_FROM, so mail cannot be sent. Set SMTP_FROM in the environment." The source was ${settings.data.source} with from ${settings.data.fromAddress}. ${inviteResult}, and Mailpit received ${n} messages for that address.`;
    },
  );
  await admin.ctx.close();
}

async function emailRestored() {
  const { app, mail } = AUTH_LAB;
  results.phase =
    "stored again: override removed and app and worker recreated (overlay-phase-stored.json)";
  const admin = await authAdmin();
  await step(
    A3,
    "operator",
    "Remove the environment override and restart: the stored relay is active again",
    "Step reads set in the app; test mail from the stored sender",
    async () => {
      const { page } = admin;
      await emailStep(page);
      const text = await pageText(page);
      const since = new Date(Date.now() - 1000);
      await page.getByRole("button", { name: "Send test email" }).click();
      const m = await waitMail(mail, AUTH_ADMIN.email, since, null);
      expect(
        /Outbound email is set in the app\. Mail is sent from "DOC-029r2 Stored"/.test(text) &&
          m?.from === "stored-relay@helix.example",
        `${text.slice(0, 200)} ${JSON.stringify(m)}`,
      );
      return `After the override was removed, the step read "Outbound email is set in the app. Mail is sent from ${STORED_FROM}." and a test message arrived from ${m.from}.`;
    },
  );

  await step(
    A3,
    "administrator",
    "Replace relay with an SMTP server that includes a port; the stored relay stays active; Keep current relay",
    "The save is refused; the stored relay stays active",
    async () => {
      const { page } = admin;
      await page.getByRole("button", { name: "Replace relay" }).click();
      await fillRelay(page, { ...WORKING_RELAY, host: "mailpit:1025" });
      const n = await emailNotice(page);
      const settings = await api(page, app, "GET", "/api/v1/email-settings");
      await page.getByRole("button", { name: "Keep current relay" }).click();
      const since = new Date(Date.now() - 1000);
      await page.getByRole("button", { name: "Send test email" }).click();
      const m = await waitMail(mail, AUTH_ADMIN.email, since, null);
      expect(
        settings.data?.source === "app" &&
          !/Relay saved/.test(n.match ?? "") &&
          m?.from === "stored-relay@helix.example",
        `source ${settings.data?.source}; ${JSON.stringify(n)} ${JSON.stringify(m)}`,
      );
      return `Saving SMTP server mailpit:1025 did not save (${JSON.stringify(n)}); the source stayed ${settings.data.source} from ${settings.data.fromAddress}. Keep current relay closed the form, and a test message still arrived from ${m.from}.`;
    },
  );

  await step(
    A3,
    "administrator",
    "Finish the wizard; it cannot be reopened and there is no separate email Settings page",
    "Welcome redirects after completion; Settings has no email page",
    async () => {
      const { page } = admin;
      for (let i = 0; i < 10; i++) {
        if (!new URL(page.url()).pathname.startsWith("/welcome")) break;
        const finish = page.getByRole("button", { name: "Finish" });
        if (await finish.count()) {
          await finish.click();
          break;
        }
        if (await page.getByRole("heading", { name: "Outbound email" }).count())
          await page.getByRole("button", { name: "Continue" }).click();
        else await page.getByRole("button", { name: "Set up later" }).click();
        await sleep(600);
      }
      await page.waitForURL((u) => !u.pathname.startsWith("/welcome"), { timeout: 20000 });
      await page.goto(`${app}/welcome`);
      await page.waitForLoadState("networkidle");
      const after = new URL(page.url()).pathname;
      await page.goto(`${app}/settings/general`);
      await page
        .getByRole("navigation", { name: "Settings sections" })
        .getByRole("button", { name: "Security" })
        .click();
      const nav = (
        await page.getByRole("navigation", { name: "Settings sections" }).innerText()
      ).replace(/\s+/g, " ");
      await page.goto(`${app}/settings/email`);
      await page.waitForLoadState("networkidle");
      const emailPage = (await pageText(page)).slice(0, 120);
      expect(!after.startsWith("/welcome") && !/\bEmail\b/.test(nav), `after ${after}; nav ${nav}`);
      return `Set up later on the remaining optional steps and Finish completed the wizard. Opening /welcome again went to ${after}. The Settings rail read "${nav}" with no email entry; /settings/email showed "${emailPage}".`;
    },
  );
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
    const pw = page
      .getByRole("button", { name: /Sign in with a password|Administrator sign-in/ })
      .first();
    if (await pw.count()) await pw.click();
  }
  await page.getByRole("button", { name: "Set up or reset your password" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send password setup link" }).click();
  await page
    .getByText(/If your email address is eligible, a password setup link is on its way/)
    .waitFor({ timeout: 15000 });
}
async function passwordSignIn(page, email, password, portal = false) {
  await page.goto(`${AUTH_LAB.app}${portal ? "/portal/login" : "/auth/login"}`);
  await page.getByRole("heading", { level: 1 }).first().waitFor();
  await page.waitForLoadState("networkidle");
  if (!(await page.getByLabel("Password", { exact: true }).count())) {
    const b = page
      .getByRole("button", { name: /Sign in with a password|Administrator sign-in/ })
      .first();
    await b.click();
  }
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const outcome = await Promise.race([
    page
      .waitForURL((u) => !/\/(auth|portal)\/login/.test(u.pathname), { timeout: 15000 })
      .then(() => "signed-in"),
    page
      .getByRole("alert")
      .first()
      .waitFor({ timeout: 15000 })
      .then(() => "alert"),
  ]).catch(() => "timeout");
  const alert =
    outcome === "alert" ? (await page.getByRole("alert").first().innerText()).trim() : null;
  const me = await api(page, AUTH_LAB.app, "GET", "/api/v1/me");
  return {
    outcome,
    alert,
    me: me.status,
    role: me.data?.user?.role,
    path: new URL(page.url()).pathname,
  };
}

async function policy() {
  const { app, mail } = AUTH_LAB;
  const admin = await authAdmin();
  results.identities = Object.entries(authAccounts).map(([k, v]) => ({ key: k, account: v }));

  await step(
    A3,
    "administrator",
    "Prepare staff: invite a Legal Team Member who sets a password, and two colleagues who stay invited",
    "Rows exist with the expected status",
    async () => {
      const { page } = admin;
      await openUsers(page, app);
      const since = new Date(Date.now() - 1000);
      for (const [email, name] of [
        [authAccounts.legal, "DOC-029r2 admin-org Auth Legal"],
        [authAccounts.ssoStaff, "DOC-029r2 admin-org Auth SSO Staff"],
        [authAccounts.offDomainStaff, "DOC-029r2 admin-org Auth Off-domain Staff"],
      ]) {
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
      for (const e of [authAccounts.legal, authAccounts.ssoStaff, authAccounts.offDomainStaff])
        states[e] = (await rowState(page, e)).status;
      expect(
        states[authAccounts.legal] === "Active" &&
          states[authAccounts.ssoStaff] === "Invited" &&
          states[authAccounts.offDomainStaff] === "Invited",
        JSON.stringify(states),
      );
      return `Rows: ${JSON.stringify(states)}.`;
    },
  );

  await step(
    A3,
    "administrator",
    "Open Settings, Security, Authentication: two policy cards with four switches; SSO unavailable before a provider is registered",
    "Legal User Authentication and Business Portal Authentication cards; Single sign-on (SSO) disabled",
    async () => {
      const { page } = admin;
      await openAuthentication(page);
      const out = {};
      for (const card of ["Legal User Authentication", "Business Portal Authentication"]) {
        const sw = authRegion(page, card).getByRole("switch");
        out[card] = await sw.evaluateAll((els) =>
          els.map(
            (e) =>
              `${document.querySelector(`label[for="${e.id}"]`)?.innerText}:${e.getAttribute("aria-checked")}${e.disabled ? ":disabled" : ""}`,
          ),
        );
      }
      const labels = [
        "Email and password",
        "Email magic link",
        "Single sign-on (SSO)",
        "Require two-factor authentication",
      ];
      for (const card of Object.keys(out)) {
        expect(
          JSON.stringify(out[card].map((x) => x.split(":")[0])) === JSON.stringify(labels),
          `${card} ${out[card]}`,
        );
        expect(out[card][2].endsWith(":disabled"), `${card} SSO ${out[card][2]}`);
      }
      return `Settings rail Security expanded to Authentication. Switches: ${JSON.stringify(out)}.`;
    },
  );

  await step(
    A3,
    "administrator",
    "Allowed email domains: Add an approved domain and check the saved list",
    "Saved; survives reload",
    async () => {
      const { page } = admin;
      await openAuthentication(page);
      const empty = await page
        .getByText("No domains allowed yet. Magic-link sign-in is unavailable.")
        .count();
      await page.getByLabel("Allowed email domains").fill("northwind.example");
      await authRegion(page, "Business Portal Authentication")
        .getByRole("button", { name: "Add" })
        .click();
      await page.getByRole("button", { name: "Remove northwind.example" }).waitFor();
      await page.reload();
      await page.getByRole("button", { name: "Remove northwind.example" }).waitFor();
      const domains = (await api(page, app, "GET", "/api/v1/auth/allowed-domains")).data.domains;
      expect(
        empty === 1 && JSON.stringify(domains) === JSON.stringify(["northwind.example"]),
        `${empty} ${domains}`,
      );
      return `The empty list read "No domains allowed yet. Magic-link sign-in is unavailable." After Add, northwind.example appeared with a "Remove northwind.example" control and stayed after reload (${JSON.stringify(domains)}).`;
    },
  );

  await step(
    A3,
    "administrator",
    "A policy with no sign-in method is refused",
    "Enable at least one sign-in method.",
    async () => {
      const { page } = admin;
      await openAuthentication(page);
      const first = await toggle(page, "Legal User Authentication", "Email magic link");
      const second = await toggle(page, "Legal User Authentication", "Email and password");
      const pol = await policyNow(page);
      await page.reload();
      await authRegion(page, "Legal User Authentication").waitFor();
      const restored = await toggle(page, "Legal User Authentication", "Email magic link");
      const after = await policyNow(page);
      expect(
        /Enable at least one sign-in method\./.test(second) &&
          pol.legal.password === true &&
          pol.legal.magicLink === false,
        `${first} / ${second} / ${JSON.stringify(pol.legal)}`,
      );
      expect(after.legal.magicLink && after.legal.password, JSON.stringify(after.legal));
      return `Turning off Email magic link showed "${first}". Turning off Email and password as the last method showed "${second}" and the stored Legal policy kept password on. Email magic link was turned back on ("${restored}").`;
    },
  );

  await step(
    A3,
    "administrator",
    "Emergency password sign-in: Email and password off under Legal User Authentication",
    "An Administrator with a password still signs in; a Legal Team Member cannot",
    async () => {
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
      expect(
        adminResult.me === 200 && legalResult.me === 401 && after.legal.password,
        `admin ${JSON.stringify(adminResult)} legal ${JSON.stringify(legalResult)}`,
      );
      return `With Email and password off ("${saved}"), the Administrator signed in with a password (me ${adminResult.me}, role ${adminResult.role}). The Legal Team Member with a password was refused (${legalResult.alert ?? legalResult.outcome}; me ${legalResult.me}). Email and password was turned back on.`;
    },
  );

  await step(
    A3,
    "legal_team_member",
    "Email magic link under Legal User Authentication: existing staff get a link even when their domain is not allowed",
    "Staff on helix.example and elsewhere.example receive links; an invited staff row stays Invited after magic-link sign-in",
    async () => {
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
    },
  );

  let portalSession;
  await step(
    A3,
    "business_user",
    "New Portal entrant on an allowed domain gets a link; an unapproved address gets no link or password setup link",
    "Allowed address becomes a Business User; unapproved address gets no mail and no account",
    async () => {
      portalSession = await context();
      const since = new Date(Date.now() - 1000);
      const m = await magicLinkFor(portalSession.page, authAccounts.portalNew, true, since);
      expect(m, "no link for allowed entrant");
      await portalSession.page.goto(m.link);
      await portalSession.page.waitForURL((u) => u.pathname.startsWith("/portal"), {
        timeout: 20000,
      });
      const me = await api(portalSession.page, app, "GET", "/api/v1/me");
      const u = await context();
      const since2 = new Date(Date.now() - 1000);
      await requestMagicLink(u.page, app, authAccounts.unapproved, true);
      await passwordSetupRequest(u.page, authAccounts.unapproved);
      await sleep(3000);
      const n = await countMail(mail, authAccounts.unapproved, since2);
      await u.ctx.close();
      const users = (await api(admin.page, app, "GET", "/api/v1/users")).data.users;
      expect(
        me.data?.user?.role === "business_user" &&
          n === 0 &&
          !users.some((x) => x.email === authAccounts.unapproved),
        `role ${me.data?.user?.role}, mails ${n}`,
      );
      return `${authAccounts.portalNew} got "${m.subject}", opened the Portal and is a ${me.data.user.role}. ${authAccounts.unapproved} saw the neutral "Check your email" and password-setup confirmations, but Mailpit received ${n} messages and no account exists.`;
    },
  );

  await step(
    A3,
    "business_user",
    "A Business User sets a password through the Portal password setup link and signs in with Email and password",
    "Password setup email; password sign-in reaches the Portal",
    async () => {
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
    },
  );

  await step(
    A3,
    "administrator",
    "Remove the domain: no new links for anyone on it, but existing access continues as the article describes",
    "Existing Business User gets no new link; held session, earlier link, and password sign-in still work; new-address setup refused at completion; staff unaffected",
    async () => {
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
      obs.lateCompletion = (await lateCtx.page.locator("main").innerText())
        .replace(/\s+/g, " ")
        .slice(0, 200);
      await lateCtx.ctx.close();
      const since4 = new Date(Date.now() - 1000);
      const s = await context();
      await requestMagicLink(s.page, app, authAccounts.legal, false);
      obs.staffLink = !!(await waitMail(mail, authAccounts.legal, since4, MAGIC, 16));
      await s.ctx.close();
      const users = (await api(page, app, "GET", "/api/v1/users")).data.users;
      obs.lateAccount = users.some((u) => u.email === authAccounts.portalLate);
      await page.getByLabel("Allowed email domains").fill("northwind.example");
      await authRegion(page, "Business Portal Authentication")
        .getByRole("button", { name: "Add" })
        .click();
      await page.getByRole("button", { name: "Remove northwind.example" }).waitFor();
      expect(
        obs.newLinkMails === 0 &&
          obs.heldSession === 200 &&
          obs.earlierLink.endsWith("me 200") &&
          pwr.me === 200,
        JSON.stringify(obs),
      );
      expect(
        !obs.lateAccount &&
          /Password setup is no longer available for this address\./.test(obs.lateCompletion) &&
          !/Sign in with your new password/.test(obs.lateCompletion) &&
          obs.staffLink,
        JSON.stringify(obs),
      );
      return `After Remove northwind.example the list read "No domains allowed yet...". Observed: ${JSON.stringify(obs)}. The domain was added back.`;
    },
  );

  await step(
    A3,
    "administrator",
    "Turn off Email magic link under Business Portal Authentication: earlier links stop working and the Portal page offers other methods",
    "Earlier link refused; no magic-link choice on the Portal page; password sign-in still works",
    async () => {
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
      const landedText = (await c.page.locator("body").innerText())
        .replace(/\s+/g, " ")
        .slice(0, 160);
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
      expect(
        me.status === 401 &&
          portalButtons.length > 0 &&
          !portalButtons.includes("Email me a sign-in link") &&
          pwr.me === 200 &&
          after.business.magicLink,
        `me ${me.status} landed ${landed} buttons ${portalButtons} pw ${pwr.me}`,
      );
      return `Turning off Email magic link showed "${saved}". Opening the link sent before the change stayed on ${landed}, which answered "${landedText}", with no session (me ${me.status}). The Portal sign-in page offered ${JSON.stringify(portalButtons)}, with no magic-link choice. The Business User with a password still signed in (me ${pwr.me}). Email magic link was turned back on.`;
    },
  );

  await portalSession.ctx.close();
  await admin.ctx.close();
}

const OIDC_CONTROL = process.env.OIDC_IP ? `http://${process.env.OIDC_IP}:8081/identity` : null;
async function idpIdentity(sub, email, name) {
  const r = await fetch(OIDC_CONTROL, {
    method: "POST",
    body: JSON.stringify({ sub, email, name }),
  });
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
  await page
    .waitForURL(
      (u) =>
        u.href !== start &&
        u.host === new URL(AUTH_LAB.app).host &&
        !u.pathname.startsWith("/api/auth/sso") &&
        (!/\/(auth|portal)\/login$/.test(u.pathname) || u.searchParams.has("error")),
      { timeout: 30000 },
    )
    .catch(() => {});
  await page.waitForLoadState("networkidle");
  const url = new URL(page.url());
  const me = await api(page, AUTH_LAB.app, "GET", "/api/v1/me");
  const alert = (
    await page
      .getByRole("alert")
      .allInnerTexts()
      .catch(() => [])
  )
    .map((x) => x.trim())
    .filter(Boolean);
  await c.ctx.close();
  return {
    path:
      url.pathname +
      (url.searchParams.get("error") ? `?error=${url.searchParams.get("error")}` : ""),
    me: me.status,
    role: me.data?.user?.role ?? null,
    alert,
  };
}
async function providerNow(page) {
  return (
    (await api(page, AUTH_LAB.app, "GET", "/api/v1/auth/sso-providers")).data.providers[0] ?? null
  );
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
  const staffIdentity = [
    "doc029-idp-sso-staff",
    authAccounts.ssoStaff,
    "DOC-029r2 admin-org Auth SSO Staff",
  ];

  if (!process.env.SSO_SKIP_REGISTER)
    await step(
      A3,
      "administrator",
      "Register provider with an issuer that cannot be reached",
      "Refused; nothing registered",
      async () => {
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
        expect(
          provider === null && note !== "Saved",
          `note ${note}; provider ${JSON.stringify(provider)}`,
        );
        return `Register provider with an unreachable issuer showed "${note}" and no provider was stored.`;
      },
    );

  if (!process.env.SSO_SKIP_REGISTER)
    await step(
      A3,
      "administrator",
      "Register provider against the local OpenID Connect fixture; copy the callback URL; registration turns on nothing",
      "Saved; callback ends /api/auth/sso/callback on the instance address; SSO switches stay off; Provider ID fixed",
      async () => {
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
        const saveLabel = await identityProvider(page)
          .getByRole("button", { name: "Save provider" })
          .count();
        const ssoSwitches = await page
          .getByRole("switch", { name: "Single sign-on (SSO)" })
          .evaluateAll((els) =>
            els.map((e) => `${e.getAttribute("aria-checked")}${e.disabled ? ":disabled" : ""}`),
          );
        expect(
          note === "Saved" && callback === `${app}/api/auth/sso/callback`,
          `note ${note}; callback ${callback}`,
        );
        expect(
          !pol.legal.sso && !pol.business.sso && idField === 0 && saveLabel === 1,
          `pol ${JSON.stringify(pol)} id ${idField}`,
        );
        expect(
          ssoSwitches.every((x) => x === "false"),
          `switches ${ssoSwitches}`,
        );
        return `Register provider showed Saved and "Paste this callback URL into your IdP console: ${callback}". Both Single sign-on (SSO) switches stayed off but became available (${JSON.stringify(ssoSwitches)}). After reload the Provider ID field was gone and the button read Save provider.`;
      },
    );

  await step(
    A3,
    "legal_team_member",
    "Turn on Single sign-on (SSO) under Legal User Authentication; an invited staff account signs in through the identity provider",
    "Callback succeeds; role Legal team member retained; row becomes Active",
    async () => {
      const { page } = admin;
      await openAuthentication(page);
      const saved = await toggle(page, "Legal User Authentication", "Single sign-on (SSO)");
      const r = await ssoRoundTrip(false, staffIdentity);
      await openUsers(page, app);
      const state = await rowState(page, authAccounts.ssoStaff);
      expect(
        r.me === 200 && r.role === "legal_team_member" && state.status === "Active",
        `${JSON.stringify(r)} ${JSON.stringify(state)}`,
      );
      return `The switch saved ("${saved}"). In a separate browser, Continue with single sign-on went through the fixture's authorize endpoint and the OpenLaw callback to ${r.path}, signed in as ${r.role}. The invited row now read ${state.status} with a role control (${state.roleControl}).`;
    },
  );

  await step(
    A3,
    "administrator",
    "An uninvited identity on a matching email domain gets no staff role",
    "No staff session; no staff account",
    async () => {
      const r = await ssoRoundTrip(false, [
        `doc029-idp-uninvited-${stamp}`,
        authAccounts.uninvitedStaff,
        "DOC-029r2 admin-org Auth Uninvited",
      ]);
      const users = (await api(admin.page, app, "GET", "/api/v1/users")).data.users;
      const created = users.find((u) => u.email === authAccounts.uninvitedStaff);
      expect(
        !(r.role === "administrator" || r.role === "legal_team_member") &&
          !(created && created.role !== "business_user"),
        `${JSON.stringify(r)} ${JSON.stringify(created)}`,
      );
      return `With Business Portal single sign-on off, ${authAccounts.uninvitedStaff} (matching the provider's helix.example domain, not an allowed Portal domain) ended on ${r.path} with me ${r.me}${r.alert.length ? ` and "${r.alert.join(" ")}"` : ""}. Account created: ${created ? created.role : "none"}.`;
    },
  );

  await step(
    A3,
    "administrator",
    "Save provider with Client secret left blank, then with a replacement secret; test a fresh sign-in after each",
    "Saved both times; staff SSO still works",
    async () => {
      const { page } = admin;
      await openAuthentication(page);
      const box = identityProvider(page);
      const hint = await box
        .getByText("Leave blank to keep the current secret. Paste a new value to rotate.")
        .count();
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
      expect(
        hint === 1 && blank === "Saved" && rotated === "Saved" && r1.me === 200 && r2.me === 200,
        `hint ${hint} blank ${blank} rotated ${rotated} r1 ${JSON.stringify(r1)} r2 ${JSON.stringify(r2)}`,
      );
      return `The Client secret hint read "Leave blank to keep the current secret. Paste a new value to rotate." Saving a Client ID change with a blank secret showed ${blank}; a fresh staff SSO sign-in worked (me ${r1.me}). Saving a replacement secret showed ${rotated}; another fresh sign-in worked (me ${r2.me}). Stored client ID: ${provider.clientId}.`;
    },
  );

  await step(
    A3,
    "administrator",
    "Update the issuer to one that cannot be reached",
    "Refused; the previous provider stays usable",
    async () => {
      const { page } = admin;
      await openAuthentication(page);
      const box = identityProvider(page);
      await box.getByLabel("Issuer URL").fill("http://doc029-unreachable-issuer.invalid:8080");
      await box.getByRole("button", { name: "Save provider" }).click();
      const note = await providerNote(page);
      const provider = await providerNow(page);
      const r = await ssoRoundTrip(false, staffIdentity);
      expect(
        note !== "Saved" && provider.issuer === "http://oidc:8080" && r.me === 200,
        `note ${note} issuer ${provider.issuer} ${JSON.stringify(r)}`,
      );
      return `Save provider with an unreachable issuer showed "${note}". The stored issuer stayed ${provider.issuer} and a fresh staff SSO sign-in still worked (me ${r.me}).`;
    },
  );

  await step(
    A3,
    "business_user",
    "Turn on Single sign-on (SSO) under Business Portal Authentication; an existing Business User signs in through the identity provider, and still can after the domain is removed",
    "Existing Business User on the provider's email domain enters the Portal before and after narrowing the list; no staff role is granted",
    async () => {
      const { page } = admin;
      const bu = `doc029-auth-bu-${stamp}@helix.example`;
      await openAuthentication(page);
      await page.getByLabel("Allowed email domains").fill("helix.example");
      await authRegion(page, "Business Portal Authentication")
        .getByRole("button", { name: "Add" })
        .click();
      await page.getByRole("button", { name: "Remove helix.example" }).waitFor();
      const c = await context();
      const since = new Date(Date.now() - 1000);
      const m = await magicLinkFor(c.page, bu, true, since);
      expect(m, "no Portal link for the helix.example Business User");
      await c.page.goto(m.link);
      await c.page.waitForURL((u) => u.pathname.startsWith("/portal"), { timeout: 20000 });
      await c.ctx.close();
      const saved = await toggle(page, "Business Portal Authentication", "Single sign-on (SSO)");
      const identity = [`doc029-idp-bu-${stamp}`, bu, "DOC-029r2 admin-org Auth Portal BU"];
      const first = await ssoRoundTrip(true, identity);
      await page.getByRole("button", { name: "Remove helix.example" }).click();
      await page
        .getByRole("button", { name: "Remove helix.example" })
        .waitFor({ state: "detached" });
      const afterRemoval = await ssoRoundTrip(true, identity);
      const newcomer = `doc029-auth-newcomer-${stamp}@helix.example`;
      const refused = await ssoRoundTrip(true, [
        `doc029-idp-newcomer-${stamp}`,
        newcomer,
        "DOC-029r2 admin-org Auth Newcomer",
      ]);
      const users = (await api(page, app, "GET", "/api/v1/users")).data.users;
      const created = users.find((u) => u.email === newcomer);
      const domains = (await api(page, app, "GET", "/api/v1/auth/allowed-domains")).data.domains;
      expect(first.me === 200 && first.role === "business_user", `first ${JSON.stringify(first)}`);
      expect(
        afterRemoval.me === 200 && afterRemoval.role === "business_user",
        `after removal ${JSON.stringify(afterRemoval)}`,
      );
      expect(
        refused.me === 401 && !created,
        `newcomer ${JSON.stringify(refused)} ${JSON.stringify(created)}`,
      );
      return `helix.example was added, and ${bu} entered the Portal through a sign-in link. The Business Portal SSO switch saved ("${saved}"). Portal single sign-on for that existing Business User reached ${first.path} as ${first.role}. After Remove helix.example (list now ${JSON.stringify(domains)}), the same identity still signed in through single sign-on (${afterRemoval.path}, ${afterRemoval.role}). A never-seen identity on the removed domain ended on ${refused.path}${refused.alert.length ? ` with "${refused.alert.join(" ")}"` : ""} and no account was created.`;
    },
  );

  await step(
    A3,
    "administrator",
    "Recover: Administrator password sign-in with Email and password off under Legal, then turn on Email and password and turn off SSO",
    "Admin password sign-in works; staff login returns to password; SSO off",
    async () => {
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
      expect(
        pol1.legal.sso && !pol1.legal.password && !pol1.legal.magicLink && adminResult.me === 200,
        `${off} ${JSON.stringify(pol1.legal)} ${JSON.stringify(adminResult)}`,
      );
      expect(
        pol2.legal.password && !pol2.legal.sso && !pol2.business.sso && legalResult.me === 200,
        `${JSON.stringify(pol2)} ${JSON.stringify(legalResult)}`,
      );
      return `With only Single sign-on (SSO) on for Legal users (${JSON.stringify(pol1.legal)}), the Administrator still signed in with a password (me ${adminResult.me}). Turning Email and password and Email magic link back on and SSO off in both cards gave ${JSON.stringify(pol2)}, and the Legal Team Member signed in with a password again (me ${legalResult.me}).`;
    },
  );
  await admin.ctx.close();
}

async function twoFactor() {
  const { app } = AUTH_LAB;
  let uri = null;
  const admin = await authAdmin();
  await step(
    A3,
    "administrator",
    "Turn on Require two-factor authentication under Legal User Authentication as an Administrator with no authenticator; OpenLaw asks for set-up before continuing",
    "The switch leads to enrolment with the organization requirement; API calls are refused until enrolment; enrolment then reaches the app",
    async () => {
      const { page } = admin;
      await openAuthentication(page);
      const before = (await (await fetch(`${app}/api/v1/auth/methods`)).json()).policy.legal;
      await authRegion(page, "Legal User Authentication")
        .getByRole("switch", { name: "Require two-factor authentication" })
        .click();
      await page.waitForURL((u) => u.pathname.startsWith("/auth/two-factor/enroll"), {
        timeout: 15000,
      });
      const pol = (await (await fetch(`${app}/api/v1/auth/methods`)).json()).policy.legal;
      const blocked = await api(page, app, "GET", "/api/v1/auth/allowed-domains");
      const required = await page
        .getByText("Your organization requires two-factor authentication.")
        .count();
      page.on("response", async (res) => {
        if (res.url().includes("/two-factor/enable") && res.ok()) uri = (await res.json()).totpURI;
      });
      await page.getByLabel("Password").fill(AUTH_PASSWORD);
      await page.getByRole("button", { name: "Turn on two-factor" }).click();
      await page.getByLabel("Code").waitFor();
      for (let i = 0; i < 20 && !uri; i++) await sleep(250);
      await page.getByLabel("Code").fill(totp(uri));
      await page.getByRole("button", { name: "Confirm" }).click();
      // Done is a link or a button depending on how the enrolment page was reached.
      await page
        .getByRole("link", { name: "Done" })
        .or(page.getByRole("button", { name: "Done" }))
        .first()
        .click();
      await page.waitForLoadState("networkidle");
      const allowed = await api(page, app, "GET", "/api/v1/auth/allowed-domains");
      expect(
        !before.requireTwoFactor && pol.requireTwoFactor,
        `policy ${JSON.stringify(before)} -> ${JSON.stringify(pol)}`,
      );
      expect(
        required === 1 && blocked.status === 403 && allowed.status === 200,
        `${required} ${blocked.status} ${allowed.status}`,
      );
      return `Require two-factor authentication was off (${JSON.stringify(before)}). Selecting it under Legal User Authentication saved it on and took the Administrator straight to /auth/two-factor/enroll with "Your organization requires two-factor authentication."; an admin API call answered ${blocked.status} ("${blocked.data?.detail}"). After Turn on two-factor, a code, Confirm and Done, the Administrator reached ${new URL(page.url()).pathname} and the same API answered ${allowed.status}.`;
    },
  );

  await step(
    A3,
    "administrator",
    "Each new session must prove a code",
    "A fresh password sign-in asks for a code",
    async () => {
      const c = await context();
      const { page } = c;
      await page.goto(`${app}/auth/login`);
      await page.getByLabel("Email", { exact: true }).fill(AUTH_ADMIN.email);
      await page.getByLabel("Password", { exact: true }).fill(AUTH_PASSWORD);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.waitForURL((u) => u.pathname.startsWith("/auth/two-factor"), { timeout: 15000 });
      const prompt = await page
        .getByText("Enter the 6-digit code from your authenticator app.")
        .count();
      const before = await api(page, app, "GET", "/api/v1/me");
      await page.getByLabel("Code").fill(totp(uri));
      await page.getByRole("button", { name: "Verify" }).click();
      await page.waitForURL((u) => !u.pathname.startsWith("/auth/"), { timeout: 15000 });
      const after = await api(page, app, "GET", "/api/v1/me");
      await c.ctx.close();
      expect(
        prompt === 1 && before.status !== 200 && after.status === 200,
        `${prompt} ${before.status} ${after.status}`,
      );
      return `A fresh password sign-in went to ${"/auth/two-factor"} with "Enter the 6-digit code from your authenticator app." Before the code /api/v1/me answered ${before.status}; after Verify it answered ${after.status}.`;
    },
  );

  await step(
    A3,
    "legal_team_member",
    "Required two-factor applies to email magic links too",
    "A Legal Team Member without an authenticator is sent to set one up after a magic-link sign-in",
    async () => {
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
      expect(
        p.startsWith("/auth/two-factor/enroll") && work.status !== 200,
        `path ${p} matters ${work.status}`,
      );
      return `After the magic-link sign-in the Legal Team Member was sent to ${p}; /api/v1/me reported setup required (${me.data?.user?.twoFactorSetupRequired}), and a work API call (/api/v1/matters) answered ${work.status}.`;
    },
  );

  await step(
    A3,
    "administrator",
    "Turn off Require two-factor authentication",
    "Policy saved off",
    async () => {
      const { page } = admin;
      await openAuthentication(page);
      const saved = await toggle(
        page,
        "Legal User Authentication",
        "Require two-factor authentication",
      );
      const pol = await policyNow(page);
      expect(
        saved === "Saved" && !pol.legal.requireTwoFactor,
        `${saved} ${JSON.stringify(pol.legal)}`,
      );
      return `The switch saved off (${JSON.stringify(pol.legal)}). The Administrator's own authenticator stays enrolled.`;
    },
  );

  await step(
    "organisation-and-users",
    "administrator",
    "Last Administrator safeguard: the only Administrator cannot be demoted",
    "Refused with a message",
    async () => {
      const { page } = admin;
      await openUsers(page, app);
      await chooseRole(page, AUTH_ADMIN.email, "Legal team member");
      const note = row(page, AUTH_ADMIN.email).locator('[aria-live="polite"]');
      let t = "";
      for (let i = 0; i < 40; i++) {
        t = (await note.innerText()).trim();
        if (t && t !== "Saving…") break;
        await sleep(150);
      }
      const me = await api(page, app, "GET", "/api/v1/me");
      const archiveRefusal = await api(
        page,
        app,
        "POST",
        `/api/v1/users/${me.data.user.id}/archive`,
      );
      const admins = (await api(page, app, "GET", "/api/v1/users")).data.users.filter(
        (u) => u.role === "administrator" && u.status !== "archived",
      ).length;
      expect(
        admins === 1 &&
          /You cannot demote the last Administrator\./.test(t) &&
          me.data.user.role === "administrator",
        `${admins} ${t} ${me.data.user.role}`,
      );
      return `On the owned lab, where ${AUTH_ADMIN.name} is the only active Administrator (${admins}), choosing Legal team member on the own row showed "${t}" and the role stayed ${me.data.user.role}. Archiving the same account through the API was refused with ${archiveRefusal.status} ("${archiveRefusal.data?.detail}").`;
    },
  );

  await step(
    A3,
    "administrator",
    "Turn on Require two-factor authentication as an Administrator who has no authenticator",
    "OpenLaw asks that Administrator to set one up before continuing",
    async () => {
      const { page } = admin;
      await openUsers(page, app);
      await chooseRole(page, authAccounts.legal, "Administrator");
      await row(page, authAccounts.legal).getByText("Saved", { exact: true }).waitFor();
      const second = await context();
      await signIn(second.page, app, authAccounts.legal, AUTH_PASSWORD);
      await openAuthentication(second.page);
      await authRegion(second.page, "Legal User Authentication")
        .getByRole("switch", { name: "Require two-factor authentication" })
        .click();
      await second.page.waitForURL((u) => u.pathname.startsWith("/auth/two-factor/enroll"), {
        timeout: 15000,
      });
      const required = await second.page
        .getByText("Your organization requires two-factor authentication.")
        .count();
      await second.ctx.close();
      await openAuthentication(page);
      const off = await toggle(
        page,
        "Legal User Authentication",
        "Require two-factor authentication",
      );
      await openUsers(page, app);
      await chooseRole(page, authAccounts.legal, "Legal team member");
      await row(page, authAccounts.legal).getByText("Saved", { exact: true }).waitFor();
      const pol = await policyNow(page);
      expect(
        required === 1 && !pol.legal.requireTwoFactor,
        `${required} ${JSON.stringify(pol.legal)}`,
      );
      return `The Legal Team Member was temporarily made an Administrator. In their own session, selecting Require two-factor authentication under Legal User Authentication took them straight to /auth/two-factor/enroll with "Your organization requires two-factor authentication." The enrolled Administrator then turned the switch off ("${off}") and returned the colleague to Legal team member.`;
    },
  );
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
  await step(
    A3,
    "legal_team_member",
    "OpenLaw checks the account's actual role, whichever sign-in page the person opened",
    "With Legal password sign-in off, a Legal Team Member is refused on the Portal page too; a Business User with a password can use the staff page",
    async () => {
      const { page } = admin;
      await openAuthentication(page);
      const off = await toggle(page, "Legal User Authentication", "Email and password");
      const l = await context();
      const legalOnPortal = await passwordSignIn(l.page, authAccounts.legal, AUTH_PASSWORD, true);
      await l.ctx.close();
      const users = (await api(page, app, "GET", "/api/v1/users")).data.users;
      const bu = users
        .filter((u) => u.email.startsWith("doc029-auth-portal-pw-") && u.role === "business_user")
        .pop();
      const b = await context();
      const buOnStaff = await passwordSignIn(b.page, bu.email, AUTH_PASSWORD, false);
      await b.ctx.close();
      await openAuthentication(page);
      const on = await toggle(page, "Legal User Authentication", "Email and password");
      const pol = await policyNow(page);
      expect(
        off === "Saved" &&
          legalOnPortal.me === 401 &&
          buOnStaff.me === 200 &&
          buOnStaff.role === "business_user" &&
          pol.legal.password,
        `${off} ${JSON.stringify(legalOnPortal)} ${JSON.stringify(buOnStaff)} ${on}`,
      );
      return `With Email and password off under Legal User Authentication, the Legal Team Member's password sign-in on the Business Portal page was refused (${legalOnPortal.alert ?? legalOnPortal.outcome}; me ${legalOnPortal.me}). With Business Portal password sign-in on, the Business User's password sign-in on the staff page succeeded (me ${buOnStaff.me}, ${buOnStaff.role}, landed ${buOnStaff.path}). Legal password sign-in was turned back on.`;
    },
  );
  await step(
    A3,
    "administrator",
    "An identity with no account is refused when it first redeems a link issued before its domain was removed",
    "No session and no account",
    async () => {
      const { page } = admin;
      const newcomer = `doc029-auth-newlink-${stamp}@northwind.example`;
      const c = await context();
      const since2 = new Date(Date.now() - 1000);
      const m = await magicLinkFor(c.page, newcomer, true, since2);
      expect(m, "no link while the domain was allowed");
      await openAuthentication(page);
      await page.getByRole("button", { name: "Remove northwind.example" }).click();
      await page
        .getByRole("button", { name: "Remove northwind.example" })
        .waitFor({ state: "detached" });
      await c.page.goto(m.link);
      await c.page.waitForLoadState("networkidle");
      const landed =
        new URL(c.page.url()).pathname +
        (new URL(c.page.url()).searchParams.get("error")
          ? `?error=${new URL(c.page.url()).searchParams.get("error")}`
          : "");
      const text = (await c.page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 160);
      const me = await api(c.page, app, "GET", "/api/v1/me");
      await c.ctx.close();
      const created = (await api(page, app, "GET", "/api/v1/users")).data.users.find(
        (u) => u.email === newcomer,
      );
      await page.getByLabel("Allowed email domains").fill("northwind.example");
      await authRegion(page, "Business Portal Authentication")
        .getByRole("button", { name: "Add" })
        .click();
      await page.getByRole("button", { name: "Remove northwind.example" }).waitFor();
      expect(me.status === 401 && !created, `me ${me.status} created ${JSON.stringify(created)}`);
      return `A never-seen address on northwind.example got "${m.subject}" while the domain was allowed. After Remove northwind.example, opening that link ended on ${landed} ("${text}") with no session (me ${me.status}) and no account. The domain was added back.`;
    },
  );
  await admin.ctx.close();
}

const sections = {
  org,
  emailStored,
  emailEnv,
  emailIncomplete,
  emailRestored,
  policy,
  sso,
  twoFactor,
  crossPage,
};
try {
  if (!sections[section]) throw new Error(`Unknown section ${section}`);
  await sections[section]();
} finally {
  save();
  await browser.close();
  const failed = results.steps.filter((s) => s.result !== "pass").length;
  console.log(`${results.steps.length} steps, ${failed} not passed -> ${outFile}`);
}
