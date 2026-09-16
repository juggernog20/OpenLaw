// DOC-029 round 2 compatibility replay for approver-groups (V-C55).
// Adapted by the DOC-029r2 compatibility reviewer (admin-org) from
// batches/DOC-029/admin-org/walkthrough-r1.mjs, "groups" section only.
// Changes from round 1: lab URL and project (admin2, built from 57e77e38),
// reviewer name, record names ("DOC-029r2 admin-org ..."), output folder,
// and a final step that archives the groups this replay created.
//
// Run from the repository root:
//   LAB_PASSWORD=... mise exec -- node docs/documentation/batches/DOC-029/compat-r2/admin-org-r2/walkthrough-r2.mjs groups
// The seed password comes only from the environment. Passwords for accounts this
// script creates are random, held in memory, and never written.
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
} from "./lib-r2.mjs";

const section = process.argv[2];
const ADMIN_LAB = {
  app: "http://127.0.0.1:23300",
  mail: "http://127.0.0.1:23400",
  project: "openlaw-docs-41255c61-admin2",
};
const DANIEL = "daniel.okafor@helix.example";
const NADIA = "nadia.haddad@helix.example";
const stamp = Date.now().toString(36);
const newPassword = () => `Doc029-${randomBytes(12).toString("hex")}`;
const SET_PASSWORD = /https?:\/\/\S+\/auth\/set-password\?token=[^\s)]+/;
const MAGIC = /https?:\/\/\S+\/api\/auth\/magic-link\/verify\?token=[^\s)]+/;

mkdirSync(path.join(here, "runs"), { recursive: true });
const outFile = path.join(
  here,
  "runs",
  `${section}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
);
const lab = ADMIN_LAB;
const { results, step, save } = recorder(outFile, {
  section,
  reviewer: "DOC-029r2 compatibility reviewer (admin-org)",
  reviewerKind: "agent",
  labProject: lab.project,
  appUrl: lab.app,
  mailUrl: lab.mail,
  articleHashes: { "approver-groups": articleHash("approver-groups") },
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
async function groups() {
  const A = "approver-groups";
  const { app, mail } = ADMIN_LAB;
  const admin = await context();
  await signIn(admin.page, app, DANIEL);
  const members = [
    {
      key: "m1",
      name: `DOC-029r2 admin-org Approver One ${stamp}`,
      email: `doc029r2-grp-one-${stamp}@helix.example`,
      password: newPassword(),
    },
    {
      key: "m2",
      name: `DOC-029r2 admin-org Approver Two ${stamp}`,
      email: `doc029r2-grp-two-${stamp}@helix.example`,
      password: newPassword(),
    },
  ];
  const groupName = `DOC-029r2 admin-org Group ${stamp}`;
  const records = [];
  results.identities = [
    { role: "administrator", account: "Daniel Okafor (seeded)" },
    { role: "legal_team_member", account: "Nadia Haddad (seeded)" },
    { role: "legal_team_member", account: members[0].name },
    { role: "legal_team_member", account: members[1].name },
  ];

  await step(
    A,
    "administrator",
    "Prepare two active Legal Team Members through Invite user and set-password links",
    "Both rows Active",
    async () => {
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
      expect(
        statuses.every((s) => s === "active"),
        JSON.stringify(statuses),
      );
      return `Invited and activated ${members.map((m) => m.name).join(" and ")}; both rows are active.`;
    },
  );

  await step(
    A,
    "legal_team_member",
    "Unauthorized configuration: a Legal Team Member cannot open or change Approver groups",
    "Redirected; API refuses",
    async () => {
      const n = await context();
      await signIn(n.page, app, NADIA);
      await n.page.goto(`${app}/settings/contracts/approver-groups`);
      await n.page.waitForLoadState("networkidle");
      const p = new URL(n.page.url()).pathname;
      const list = await api(n.page, app, "GET", "/api/v1/approver-groups");
      const create = await api(n.page, app, "POST", "/api/v1/approver-groups", {
        name: `DOC-029r2 admin-org denied ${stamp}`,
        memberIds: [],
      });
      await n.ctx.close();
      expect(
        p !== "/settings/contracts/approver-groups" && create.status === 403,
        `path ${p}, list ${list.status}, create ${create.status}`,
      );
      return `Nadia was sent to ${p}. GET /api/v1/approver-groups answered ${list.status}; POST answered ${create.status}.`;
    },
  );

  await step(
    A,
    "administrator",
    "Create a group: profile menu, Settings, Contracts, Approver groups, Add group",
    "Picker lists only Administrators and Legal team members; saved members show on Edit",
    async () => {
      const { page } = admin;
      await page.goto(`${app}/`);
      await page.getByRole("banner").getByRole("button", { name: "Daniel Okafor" }).click();
      await page.getByRole("menuitem", { name: "Settings" }).click();
      await page
        .getByRole("navigation", { name: "Settings sections" })
        .getByRole("link", { name: "Contracts" })
        .click();
      await page
        .getByRole("navigation", { name: "Contracts panes" })
        .getByRole("link", { name: "Approver groups" })
        .click();
      await page.getByRole("heading", { name: "Approver groups", level: 2 }).waitFor();
      const reachedAt = new URL(page.url()).pathname;
      await page.getByRole("button", { name: "Add group" }).click();
      const dialog = page.getByRole("dialog", { name: "Add approver group" });
      await dialog.getByLabel("Name").fill(groupName);
      await dialog
        .getByLabel("Description")
        .fill("DOC-029r2 admin-org walkthrough group. Use for reviewer checks only.");
      const candidateEmails = await dialog.locator("fieldset li").allInnerTexts();
      const users = (await api(page, app, "GET", "/api/v1/users")).data.users;
      const businessEmails = users.filter((u) => u.role === "business_user").map((u) => u.email);
      const offeredBusiness = candidateEmails.filter((t) =>
        businessEmails.some((e) => t.includes(e)),
      );
      for (const m of members)
        await dialog
          .getByRole("checkbox", { name: new RegExp(m.email.replace(/\./g, "\\.")) })
          .check();
      await dialog.getByRole("button", { name: "Add group" }).click();
      await dialog.waitFor({ state: "hidden" });
      await page.reload();
      await page.getByRole("button", { name: `Edit ${groupName}` }).click();
      const edit = page.getByRole("dialog", { name: `Edit ${groupName}` });
      const checked = [];
      for (const m of members)
        checked.push(
          await edit
            .getByRole("checkbox", { name: new RegExp(m.email.replace(/\./g, "\\.")) })
            .isChecked(),
        );
      await edit.getByRole("button", { name: "Cancel" }).click();
      const group = (
        await api(page, app, "GET", "/api/v1/approver-groups")
      ).data.approverGroups.find((g) => g.name === groupName);
      members.groupId = group.id;
      records.push(`Approver group "${groupName}"`);
      expect(reachedAt === "/settings/contracts/approver-groups", reachedAt);
      expect(offeredBusiness.length === 0, `business users offered: ${offeredBusiness}`);
      expect(
        checked.every(Boolean) && group.memberCount === 2,
        `checked ${checked}, count ${group.memberCount}`,
      );
      return `The profile menu path reached ${reachedAt}. The Members picker listed ${candidateEmails.length} people and none of the ${businessEmails.length} Business Users. After Add group and reload, Edit showed both chosen members checked (memberCount ${group.memberCount}).`;
    },
  );

  await step(
    A,
    "administrator",
    "Non-Member+ selection is refused",
    "A Business User cannot be saved as a member",
    async () => {
      const { page } = admin;
      const users = (await api(page, app, "GET", "/api/v1/users")).data.users;
      const businessUser = users.find((u) => u.role === "business_user" && u.status === "active");
      const r = await api(page, app, "PUT", `/api/v1/approver-groups/${members.groupId}/members`, {
        memberIds: [members[0].id, businessUser.id],
      });
      const group = (
        await api(page, app, "GET", "/api/v1/approver-groups")
      ).data.approverGroups.find((g) => g.id === members.groupId);
      expect(
        r.status >= 400 && group.memberCount === 2,
        `status ${r.status}, count ${group.memberCount}`,
      );
      return `The picker offers no Business User, so the refusal was checked on the member-list write the editor uses: adding a Business User was refused with ${r.status} ("${r.data?.detail}") and the group still had ${group.memberCount} members.`;
    },
  );

  async function newContract(label, extra = {}) {
    const types = (await api(admin.page, app, "GET", "/api/v1/contract-types")).data.contractTypes;
    const other = types.find((t) => t.slug === "other") ?? types[0];
    const title = `DOC-029r2 admin-org ${label} ${stamp}`;
    const r = await api(admin.page, app, "POST", "/api/v1/contracts", {
      title,
      contractTypeId: other.id,
      ...extra,
    });
    expect(r.data?.contract?.number, `create ${r.status} ${JSON.stringify(r.data)}`);
    records.push(`Contract ${r.data.contract.number} "${title}"`);
    return r.data.contract.number;
  }
  async function approvals(page, number) {
    const r = await api(page, app, "GET", `/api/v1/contracts/${number}/approvals`);
    return (r.data?.approvals ?? []).map((x) => ({
      approver: x.approver?.id ?? x.approverId,
      status: x.status,
      source: x.source,
      group: x.groupName ?? x.approverGroupName ?? x.group?.name ?? null,
    }));
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
  await step(
    A,
    "administrator",
    "Apply the group on a Contract and check the Pending rows",
    "Dialog names the people and warns about the snapshot; one Pending request per member",
    async () => {
      c1 = await newContract("approvals contract one");
      const { page } = admin;
      const { card, dialog } = await openApply(page, c1);
      const text = (await dialog.innerText()).replace(/\s+/g, " ");
      await dialog.getByRole("button", { name: "Apply group" }).click();
      await dialog.waitFor({ state: "hidden" });
      const rows = await approvals(page, c1);
      const pendingText = await card.getByText("Pending").count();
      expect(/Asks /.test(text) && members.every((m) => text.includes(m.name)), `dialog ${text}`);
      expect(
        /A later edit to the group leaves these requests as they are/.test(text),
        "no snapshot warning",
      );
      expect(
        rows.length === 2 &&
          rows.every((r) => r.status === "pending") &&
          members.every((m) => rows.some((r) => r.approver === m.id)),
        JSON.stringify(rows),
      );
      members.c1Rows = rows;
      return `On Contract ${c1}, Approvals then Approvals & signing offered Apply group. The dialog read: "${text.slice(0, 400)}". Applying created ${rows.length} pending requests, one per member (${pendingText} Pending labels in the card).`;
    },
  );

  await step(
    A,
    "administrator",
    "Applying again when every member already has a pending request is refused",
    "Refused; no new rows",
    async () => {
      const { page } = admin;
      const { dialog } = await openApply(page, c1);
      const text = (await dialog.innerText()).replace(/\s+/g, " ");
      const button = dialog.getByRole("button", { name: "Apply group" });
      const disabled = await button.isDisabled();
      let alert = "";
      if (!disabled) {
        await button.click();
        alert = await dialog
          .getByRole("alert")
          .innerText()
          .catch(() => "");
      }
      await page.keyboard.press("Escape");
      const direct = await api(page, app, "POST", `/api/v1/contracts/${c1}/approvals/group`, {
        groupId: members.groupId,
      });
      const rows = await approvals(page, c1);
      expect(
        /already has a request open/.test(text) && rows.length === 2 && direct.status >= 400,
        `text ${text}; rows ${rows.length}; direct ${direct.status}`,
      );
      return `The dialog read "Everybody in this group already has a request open." (Apply group disabled: ${disabled}${alert ? `, alert "${alert}"` : ""}). The apply route refused with ${direct.status} ("${direct.data?.detail}"); the Contract still had ${rows.length} requests.`;
    },
  );

  await step(
    A,
    "administrator",
    "A member with a pending request on the Contract is skipped",
    "Dialog says it skips one person; only the other member gets a request",
    async () => {
      const c2 = await newContract("approvals contract two");
      members.c2 = c2;
      const { page } = admin;
      const manual = await api(page, app, "POST", `/api/v1/contracts/${c2}/approvals`, {
        approverIds: [members[0].id],
      });
      expect(manual.status === 201, `manual ${manual.status}`);
      const { dialog } = await openApply(page, c2);
      const text = (await dialog.innerText()).replace(/\s+/g, " ");
      await dialog.getByRole("button", { name: "Apply group" }).click();
      await dialog.waitFor({ state: "hidden" });
      const rows = await approvals(page, c2);
      expect(/Skips 1 person who already has a request open/.test(text), text);
      expect(
        rows.length === 2 && rows.filter((r) => r.approver === members[0].id).length === 1,
        JSON.stringify(rows),
      );
      return `After one manual request for Approver One on Contract ${c2}, the dialog said "Skips 1 person who already has a request open." Applying left ${rows.length} requests: one each, no duplicate.`;
    },
  );

  await step(
    A,
    "administrator",
    "A member who is no longer a Legal Team Member refuses the whole action by name",
    "Refused by name; no Approval Request created; editor marks the member Can no longer approve",
    async () => {
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
      const flagged = await edit
        .locator("li")
        .filter({ hasText: members[1].email })
        .getByText("Can no longer approve")
        .count();
      const save = edit.getByRole("button", { name: "Save" });
      await save.click();
      const saveAlert = await edit
        .getByRole("alert")
        .innerText({ timeout: 5000 })
        .catch(() => "(no alert)");
      const stillOpen = await edit.isVisible();
      if (stillOpen) await page.keyboard.press("Escape");
      const kept = (
        await api(page, app, "GET", "/api/v1/approver-groups")
      ).data.approverGroups.find((g) => g.id === members.groupId);
      members.saveWithIneligible = {
        alert: saveAlert,
        dialogOpen: stillOpen,
        memberCount: kept.memberCount,
      };
      const c1Rows = await approvals(page, c1);
      expect(
        alert.includes(members[1].name) && rows.length === 0,
        `alert "${alert}", rows ${rows.length}`,
      );
      expect(flagged === 1, `flag count ${flagged}`);
      expect(JSON.stringify(c1Rows) === JSON.stringify(members.c1Rows), "earlier requests changed");
      return `With Approver Two changed to Business user, applying on Contract ${c3} showed "${alert}" and created ${rows.length} requests. The group editor marked Approver Two "Can no longer approve"; selecting Save with that member still ticked and nothing else changed showed ${saveAlert === "(no alert)" ? "no error" : `"${saveAlert}"`}, the dialog ${stillOpen ? "stayed open" : "closed"}, and the group still listed ${kept.memberCount} members. Contract ${c1}'s two earlier requests were unchanged.`;
    },
  );

  await step(
    A,
    "administrator",
    "Restore the member's role and apply again",
    "Both requests are created",
    async () => {
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
      expect(
        after.status === "Active" && rows.length === 2,
        `after ${JSON.stringify(after)}, rows ${rows.length}`,
      );
      return `Approver Two's row went back to Legal team member (row ${after.status}). Applying on Contract ${members.c3} then created ${rows.length} pending requests.`;
    },
  );

  await step(
    A,
    "administrator",
    "Confidential Contract: a member outside the audience refuses the whole action by name",
    "Refused by name; no requests",
    async () => {
      const c4 = await newContract("confidential approvals contract", { isConfidential: true });
      const { page } = admin;
      const { dialog } = await openApply(page, c4);
      await dialog.getByRole("button", { name: "Apply group" }).click();
      const alert = await dialog
        .getByRole("alert")
        .innerText({ timeout: 8000 })
        .catch(() => "(no alert)");
      await page.keyboard.press("Escape");
      const rows = await approvals(page, c4);
      expect(
        members.some((m) => alert.includes(m.name)) && rows.length === 0,
        `alert "${alert}", rows ${rows.length}`,
      );
      return `On Confidential Contract ${c4}, created by Daniel with neither approver in its audience, Apply group showed "${alert}" and created ${rows.length} requests.`;
    },
  );

  await step(
    A,
    "administrator",
    "Edit members, then archive and restore the group: earlier requests keep their named people",
    "Requests unchanged; archive confirmation needs no replacement; Show archived then Restore",
    async () => {
      const { page } = admin;
      const snapshot = await approvals(page, c1);
      await page.goto(`${app}/settings/contracts/approver-groups`);
      await page.getByRole("button", { name: `Edit ${groupName}` }).click();
      const edit = page.getByRole("dialog", { name: `Edit ${groupName}` });
      await edit
        .getByRole("checkbox", { name: new RegExp(members[1].email.replace(/\./g, "\\.")) })
        .uncheck();
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
        offered = JSON.stringify(
          await page
            .getByRole("dialog", { name: "Apply approver group" })
            .getByLabel("Approver group")
            .locator("option")
            .allInnerTexts(),
        );
        await page.keyboard.press("Escape");
      }
      await page.goto(`${app}/settings/contracts/approver-groups`);
      await page.getByRole("switch", { name: "Show archived" }).click();
      await page.getByRole("button", { name: `Restore ${groupName}` }).click();
      await page.getByRole("button", { name: `Edit ${groupName}` }).waitFor();
      const afterRestore = await approvals(page, c1);
      const group = (
        await api(page, app, "GET", "/api/v1/approver-groups")
      ).data.approverGroups.find((g) => g.id === members.groupId);
      const same = [afterEdit, afterArchive, afterRestore].every(
        (x) => JSON.stringify(x) === JSON.stringify(snapshot),
      );
      expect(same, "earlier requests changed");
      expect(/Archive group/.test(confirmText) && !/replace/i.test(confirmText), confirmText);
      expect(
        offered.startsWith("[") && !offered.includes(groupName),
        `archived group offered: ${offered}`,
      );
      expect(
        group.archivedAt === null && group.members.some((m) => m.email === NADIA),
        JSON.stringify(group),
      );
      return `Save replaced Approver Two with Nadia Haddad. The archive confirmation read "${confirmText}" and asked for no replacement. While archived the group was not in Contract ${members.c2}'s picker (${offered}). Show archived then Restore returned it. Contract ${c1}'s two requests and their named people were identical before the edit, after it, after archive, and after restore.`;
    },
  );

  await step(
    A,
    "administrator",
    "A group with no members is refused when applied",
    "Dialog says nobody to ask; no requests",
    async () => {
      const { page } = admin;
      const emptyName = `DOC-029r2 admin-org Empty group ${stamp}`;
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
      await page
        .getByRole("region", { name: "Approvals & signing" })
        .getByRole("button", { name: "Apply group" })
        .click();
      const apply = page.getByRole("dialog", { name: "Apply approver group" });
      await apply.getByLabel("Approver group").selectOption({ label: emptyName });
      const text = (await apply.innerText()).replace(/\s+/g, " ");
      await apply.getByRole("button", { name: "Apply group" }).click();
      const alert = await apply
        .getByRole("alert")
        .innerText({ timeout: 8000 })
        .catch(() => "(no alert)");
      await page.keyboard.press("Escape");
      const rows = await approvals(page, c);
      await page.goto(`${app}/settings/contracts/approver-groups`);
      await page.getByRole("button", { name: `Archive ${emptyName}` }).click();
      await page
        .getByRole("dialog", { name: `Archive ${emptyName}` })
        .getByRole("button", { name: "Archive group" })
        .click();
      expect(
        /nobody to ask/.test(text) && rows.length === 0 && alert !== "(no alert)",
        `text ${text}; alert ${alert}; rows ${rows.length}`,
      );
      return `A group saved with no Members showed "This group has nobody to ask." in the apply dialog. Apply group was refused with "${alert}" and Contract ${c} had ${rows.length} requests. The empty group was then archived.`;
    },
  );

  await step(
    A,
    "legal_team_member",
    "A Legal Team Member applies the group on a Contract they can open",
    "Requests created for the members who have none",
    async () => {
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
    },
  );

  await step(
    A,
    "administrator",
    "Clean up: archive the replay group",
    "Group archived; no other change",
    async () => {
      const { page } = admin;
      await page.goto(`${app}/settings/contracts/approver-groups`);
      await page.getByRole("button", { name: `Archive ${groupName}` }).click();
      await page
        .getByRole("dialog", { name: `Archive ${groupName}` })
        .getByRole("button", { name: "Archive group" })
        .click();
      await page.getByRole("button", { name: `Archive ${groupName}` }).waitFor({ state: "hidden" });
      const g = (
        await api(page, app, "GET", "/api/v1/approver-groups?includeArchived=true")
      ).data?.approverGroups?.find((x) => x.name === groupName);
      return `Archived "${groupName}" through its Archive control${g ? ` (archivedAt ${g.archivedAt ? "set" : "null"})` : ""}.`;
    },
  );
  results.records = records;
  await shot(admin.page, "groups-list-r2");
  await admin.ctx.close();
}

const sections = { groups };
try {
  if (!sections[section]) throw new Error(`Unknown section ${section}`);
  await sections[section]();
} finally {
  save();
  await browser.close();
  const failed = results.steps.filter((s) => s.result !== "pass").length;
  console.log(`${results.steps.length} steps, ${failed} not passed -> ${outFile}`);
}
