// DOC-030 admin-org independent walkthrough.
// Written by the DOC-030 independent walkthrough agent (admin-org), adapted from
// DOC-029/admin-org/walkthrough-r2-1.mjs. It follows organisation-and-users (V-C36)
// and authentication-and-email (V-C37) against app commit 067c1646.
//
// Labs (all built from 067c1646 by scripts/documentation/lab.mjs):
//   work2  shared Helix lab, 43300 / 48425: organisation-and-users
//   auth2  owned Helix lab, 43310 / 48435: sign-in policy, domains, SSO, 2FA, instance address
//   auth2w owned unseeded lab, 43311 / 48436: first-run wizard email, email precedence,
//          last-Administrator safeguards, invitations without a mailer
// Deployment phases on the owned labs are applied with phase.sh between sections.
//
// Run from the worktree root, one section at a time:
//   LAB_PASSWORD=... node docs/documentation/batches/DOC-030/admin-org/walkthrough.mjs <section>
//   node docs/documentation/batches/DOC-030/admin-org/walkthrough.mjs merge
// The seed password comes only from the environment. Passwords for accounts this
// script creates are random, held in memory, and never written. Each section writes
// runs/<section>-<time>.json; `merge` builds walkthrough.json from the latest run of
// each section.
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { randomBytes, createHmac } from "node:crypto";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import path from "node:path";
import {
  chromium,
  here,
  root,
  articleHash,
  recorder,
  expect,
  sleep,
  signIn,
  waitMail,
  countMail,
  mailSearch,
  mailMessage,
  api,
  PASSWORD,
} from "./lib.mjs";

const section = process.argv[2];
const labInfo = (name) => {
  const lab = JSON.parse(readFileSync(path.join(root, ".documentation-labs", name, "lab.json")));
  return {
    name,
    app: lab.appUrl,
    mail: lab.mailUrl,
    project: lab.project,
    appImageId: lab.appImageId,
    engineImageId: lab.engineImageId,
  };
};
const WORK = labInfo("work2");
const AUTH = labInfo("auth2");
const WIZ = labInfo("auth2w");
const DANIEL = "daniel.okafor@helix.example";
const NADIA = "nadia.haddad@helix.example";
const JONAS = "jonas.weber@helix.example";
const stamp = Date.now().toString(36);
const newPassword = () => `Doc030-${randomBytes(12).toString("hex")}`;
const SET_PASSWORD = /https?:\/\/\S+\/auth\/set-password#token=[^\s)]+/;
const MAGIC = /https?:\/\/\S+\/api\/auth\/magic-link\/verify\?token=[^\s)]+/;
const O = "organisation-and-users";
const A3 = "authentication-and-email";

const SECTION_LAB = {
  org: WORK,
  wizardStored: WIZ,
  wizardIncomplete: WIZ,
  wizardEnv: WIZ,
  settingsIncomplete: WIZ,
  settingsStored: WIZ,
  guards: WIZ,
  policy: AUTH,
  sso: AUTH,
  twoFactor: AUTH,
  crossPage: AUTH,
  instancePinned: AUTH,
  instanceSaved: AUTH,
};

if (section === "merge") {
  merge();
  process.exit(0);
}

mkdirSync(path.join(here, "runs"), { recursive: true });
const outFile = path.join(
  here,
  "runs",
  `${section}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
);
const lab = SECTION_LAB[section];
if (!lab) throw new Error(`Unknown section ${section}`);
const { results, step, save } = recorder(outFile, {
  section,
  reviewer: "DOC-030 independent walkthrough agent (admin-org)",
  reviewerKind: "agent",
  labName: lab.name,
  labProject: lab.project,
  appUrl: lab.app,
  mailUrl: lab.mail,
  appImageId: lab.appImageId,
  engineImageId: lab.engineImageId,
  phase: process.env.PHASE ?? null,
  articleHashes: {
    [O]: articleHash(O),
    [A3]: articleHash(A3),
  },
});

const OIDC_IP = (() => {
  try {
    return execFileSync(
      "docker",
      [
        "--context",
        "default",
        "inspect",
        `${AUTH.project}-oidc-1`,
        "--format",
        "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    return "";
  }
})();
const browser = await chromium.launch({
  // The OIDC fixture is reachable on the auth2 lab network as "oidc"; the browser
  // resolves that name to the fixture container's address.
  args: OIDC_IP ? [`--host-resolver-rules=MAP oidc ${OIDC_IP}`] : [],
});
async function context() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  return { ctx, page };
}
const row = (page, email) => page.getByRole("row").filter({ hasText: email });
const shot = (page, name) => page.screenshot({ path: path.join(here, `${name}.png`) });
const pageText = async (page) => (await page.locator("main").innerText()).replace(/\s+/g, " ");
/** The main area without the settings rail. */
const paneText = async (page) => {
  const all = await pageText(page);
  const nav = page.locator("main").getByRole("navigation", { name: "Settings sections" });
  if (!(await nav.count())) return all;
  const rail = (await nav.innerText()).replace(/\s+/g, " ").trim();
  return all.replace(rail, "").trim();
};
const buttons = async (page) =>
  (await page.locator("main").getByRole("button").allInnerTexts())
    .map((x) => x.trim())
    .filter(Boolean);

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
  await page.getByRole("heading", { level: 1 }).first().waitFor();
  await page.waitForLoadState("networkidle");
  // A page whose only method is the sign-in link opens straight on its form.
  const choice = page.getByRole("button", { name: "Email me a sign-in link" }).first();
  if (await choice.count()) await choice.click();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send link" }).click();
  await page.getByRole("heading", { name: "Check your email" }).waitFor({ timeout: 15000 });
  return (await page.locator("main").innerText()).replace(/\s+/g, " ");
}

async function chooseRole(page, email, roleLabel) {
  await row(page, email)
    .getByRole("button", { name: new RegExp(`change the role of ${email.replace(/\./g, "\\.")}`) })
    .click();
  const items = await page.getByRole("menuitemradio").allInnerTexts();
  await page.getByRole("menuitemradio", { name: roleLabel }).click();
  return items.map((s) => s.trim());
}

async function rowNote(page, email) {
  const note = row(page, email).locator('[aria-live="polite"]').first();
  let t = "";
  for (let i = 0; i < 60; i++) {
    t = ((await note.count()) ? await note.innerText() : "").trim();
    if (t && t !== "Saving…") break;
    await sleep(150);
  }
  return t;
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
    moreActions: (await r.getByRole("button", { name: `More actions for ${email}` }).count()) > 0,
  };
}

async function signOutUser(page, email) {
  await row(page, email).getByRole("button", { name: `More actions for ${email}` }).click();
  const items = (await page.getByRole("menuitem").allInnerTexts()).map((s) => s.trim());
  await page.getByRole("menuitem", { name: "Sign out user" }).click();
  return items;
}

/** A readable PNG of width x height, one colour, compressed. */
function png(width, height) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 0; // greyscale
  const rowBytes = Buffer.alloc(width + 1, 0x80);
  rowBytes[0] = 0;
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) rowBytes.copy(raw, y * (width + 1));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Reads one message's header facts without storing the body. */
async function mailFacts(mail, id) {
  const m = await mailMessage(mail, id);
  return {
    subject: m.Subject,
    from: m.From?.Address,
    fromName: m.From?.Name,
    text: m.Text ?? "",
    html: m.HTML ?? "",
    inline: (m.Inline ?? []).map((x) => ({ file: x.FileName, cid: x.ContentID })),
  };
}
async function latestMail(mail, to, since, pattern, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const list = await mailSearch(mail, `to:"${to}"`);
    for (const m of list) {
      if (new Date(m.Created) < since) continue;
      const f = await mailFacts(mail, m.ID);
      const link = pattern ? f.text.match(pattern)?.[0] : null;
      if (!pattern || link) return { ...f, link };
    }
    await sleep(750);
  }
  return null;
}
/** The email layout header: the organization name and the inline logo it names. */
function emailHeader(f) {
  const header = f.html.match(/<img src="cid:([^"]+)"[^>]*>[\s\S]*?font-weight:600;[^>]*>([^<]*)</);
  return { cid: header?.[1] ?? null, name: header?.[2]?.trim() ?? null };
}

// ---------------------------------------------------------------------------
// V-C36 organisation-and-users on the shared work2 lab.
async function org() {
  const { app, mail } = WORK;
  const admin = await context();
  await signIn(admin.page, app, DANIEL);
  const people = {
    a: {
      name: `DOC-030 admin-org V-C36 Avery ${stamp}`,
      email: `doc030-org-a-${stamp}@helix.example`,
    },
    b: {
      name: `DOC-030 admin-org V-C36 Bryn ${stamp}`,
      email: `doc030-org-b-${stamp}@helix.example`,
    },
    c: {
      name: `DOC-030 admin-org V-C36 Casey ${stamp}`,
      email: `doc030-org-c-${stamp}@helix.example`,
      password: newPassword(),
    },
    bu: { email: `doc030-org-bu-${stamp}@helix.example` },
    bu0: { email: `doc030-org-bu0-${stamp}@helix.example` },
  };
  results.identities = [
    { role: "administrator", account: "Daniel Okafor (seeded)" },
    { role: "legal_team_member", account: "Nadia Haddad (seeded), unauthorized-administration check" },
    { role: "business_user", account: "Portal-created doc030-org-bu0 address, unauthorized-administration check" },
    { role: "business_user", account: "Jonas Weber (seeded), refused-invitation check only" },
    { role: "invited colleague", account: people.a.name, note: "activated by a sign-in link" },
    { role: "withdrawn invitation", account: people.b.name },
    { role: "invited colleague", account: people.c.name, note: "activated by Set password" },
    { role: "business_user", account: `${people.bu.email} (Portal-created)` },
  ];
  const before = await api(admin.page, app, "GET", "/api/v1/auth/allowed-domains");
  results.labState = { allowedDomains: before.data?.domains };

  await step(
    O,
    "legal_team_member",
    "Unauthorized administration: a Legal Team Member opens Settings General and Settings Users",
    "Lands on Profile; the users and invite APIs refuse",
    async () => {
      const n = await context();
      await signIn(n.page, app, NADIA);
      const out = {};
      for (const p of ["/settings/general", "/settings/users"]) {
        await n.page.goto(`${app}${p}`);
        await n.page.waitForLoadState("networkidle");
        out[p] = new URL(n.page.url()).pathname;
      }
      const heading = await n.page.getByRole("heading", { level: 2 }).first().innerText();
      const users = await api(n.page, app, "GET", "/api/v1/users");
      const inv = await api(n.page, app, "POST", "/api/v1/auth/invites", {
        email: `doc030-org-denied-${stamp}@helix.example`,
        displayName: "DOC-030 admin-org V-C36 denied",
        role: "legal_team_member",
      });
      await n.ctx.close();
      expect(
        out["/settings/general"] === "/settings/profile" &&
          out["/settings/users"] === "/settings/profile",
        `landed on ${JSON.stringify(out)}`,
      );
      expect(users.status === 403 && inv.status === 403, `users ${users.status}, invite ${inv.status}`);
      return `Settings General and Settings Users both sent Nadia to /settings/profile (first heading "${heading}"). GET /api/v1/users answered ${users.status}; POST /api/v1/auth/invites answered ${inv.status}.`;
    },
  );

  let buPortal;
  await step(
    O,
    "business_user",
    "Unauthorized administration: a Business User opens Settings",
    "Sent to the Portal",
    async () => {
      // A fresh Portal-created Business User: the shared lab's seeded Business
      // Users are rate limited by other walkthroughs (3 sign-in links per address
      // per 15 minutes).
      const j = await context();
      const since = new Date(Date.now() - 1000);
      await requestMagicLink(j.page, app, people.bu0.email, true);
      const m = await latestMail(mail, people.bu0.email, since, MAGIC);
      expect(m, "no Portal sign-in link");
      await j.page.goto(m.link);
      await j.page.waitForURL((u) => u.pathname.startsWith("/portal"), { timeout: 20000 });
      const out = {};
      for (const p of ["/settings", "/settings/general", "/settings/users"]) {
        await j.page.goto(`${app}${p}`);
        await j.page.waitForLoadState("networkidle");
        await sleep(300);
        out[p] = new URL(j.page.url()).pathname;
      }
      const users = await api(j.page, app, "GET", "/api/v1/users");
      buPortal = j;
      expect(
        Object.values(out).every((p) => p.startsWith("/portal")) && users.status === 403,
        `${JSON.stringify(out)} users ${users.status}`,
      );
      return `${people.bu0.email} entered through a Portal sign-in link on an allowed domain (${JSON.stringify(results.labState.allowedDomains)}) and is a Business User. Opening ${Object.keys(out).join(", ")} landed on ${JSON.stringify(out)}. GET /api/v1/users answered ${users.status}.`;
    },
  );

  const original = (await api(admin.page, app, "GET", "/api/v1/org/general")).data.general;
  results.restoreTargets = {
    organizationName: original.name,
    logoWasNull: original.logo === null,
    defaultTimezone: original.defaultTimezone,
  };

  async function signInBranding(p) {
    const anon = await context();
    await anon.page.goto(`${app}${p}`);
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

  const draftName = `DOC-030 admin-org V-C36 Helix ${stamp}`;
  await step(
    O,
    "administrator",
    "Update organization details step 2: Organization name saves on Enter, Escape restores before saving, reload keeps the saved value",
    "Saved status; Escape restores the previous name; value survives reload",
    async () => {
      const { page } = admin;
      await page.goto(`${app}/settings/general`);
      const box = page.getByRole("textbox", { name: "Organization name" });
      await box.fill(draftName);
      await box.press("Enter");
      await page.getByText("Saved", { exact: true }).first().waitFor();
      await page.reload();
      const afterEnter = await box.inputValue();
      await box.fill("DOC-030 admin-org unsaved draft");
      await box.press("Escape");
      const afterEscape = await box.inputValue();
      await page.reload();
      const afterEscapeReload = await box.inputValue();
      expect(afterEnter === draftName, `after Enter+reload: ${afterEnter}`);
      expect(
        afterEscape === draftName && afterEscapeReload === draftName,
        `after Escape: ${afterEscape} / ${afterEscapeReload}`,
      );
      return `Enter showed Saved and "${draftName}" survived reload. Escape on an unsaved draft put "${afterEscape}" back in the field, and after reload the saved name was still "${afterEscapeReload}".`;
    },
    admin.page,
  );

  const fx = path.join(here, "fixtures");
  const scratch = process.env.SCRATCH_DIR;
  let savedLogo;
  await step(
    O,
    "administrator",
    "Update organization details step 3: Upload beside Logo; wrong type or over 5 MB shows the 5 MB message; unreadable or over 16 million pixels shows the readability message; a supported file saves",
    "Four refusals with the quoted messages and no change; a PNG and an SVG save",
    async () => {
      const { page } = admin;
      if (!scratch) throw new Error("SCRATCH_DIR is required for the large fixtures");
      mkdirSync(fx, { recursive: true });
      writeFileSync(
        path.join(fx, "doc030-logo.svg"),
        '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#2f6f5e"/></svg>\n',
      );
      writeFileSync(path.join(fx, "doc030-not-an-image.txt"), "DOC-030 admin-org fixture: not an image\n");
      writeFileSync(path.join(fx, "doc030-unreadable.png"), "DOC-030 admin-org fixture: PNG name, no image data\n");
      writeFileSync(path.join(fx, "doc030-logo-64.png"), png(64, 64));
      const huge = path.join(scratch, "doc030-logo-4001x4001.png");
      writeFileSync(huge, png(4001, 4001));
      const big = path.join(scratch, "doc030-logo-over-5mb.png");
      writeFileSync(big, Buffer.concat([png(8, 8), Buffer.alloc(5 * 1024 * 1024 + 1024)]));
      await page.goto(`${app}/settings/general`);
      const upload = async (file) => {
        const chooser = page.waitForEvent("filechooser");
        await page.getByRole("button", { name: "Upload", exact: true }).click();
        await (await chooser).setFiles(file);
      };
      const TYPE =
        "That logo must be a PNG, JPEG, WebP, or SVG image 5 MB or smaller. Pick another file.";
      const READ =
        "The logo must be a readable PNG, JPEG, WebP or SVG with no more than 16 million pixels.";
      const seen = {};
      for (const [key, file, message] of [
        ["text file", path.join(fx, "doc030-not-an-image.txt"), TYPE],
        ["PNG over 5 MB", big, TYPE],
        ["unreadable .png", path.join(fx, "doc030-unreadable.png"), READ],
        ["4001 x 4001 PNG (16,008,001 pixels)", huge, READ],
      ]) {
        await page.reload();
        await upload(file);
        await page.getByText(message).waitFor({ timeout: 15000 });
        seen[key] = message === TYPE ? "5 MB message" : "readability message";
      }
      const afterRejects = (await api(page, app, "GET", "/api/v1/org/general")).data.general.logo;
      await page.reload();
      await upload(path.join(fx, "doc030-logo-64.png"));
      await page.getByText("Saved", { exact: true }).first().waitFor({ timeout: 15000 });
      const pngSaved = (await api(page, app, "GET", "/api/v1/org/general")).data.general.logo;
      await page.reload();
      await upload(path.join(fx, "doc030-logo.svg"));
      await page.getByText("Saved", { exact: true }).first().waitFor({ timeout: 15000 });
      await page.reload();
      savedLogo = (await api(page, app, "GET", "/api/v1/org/general")).data.general.logo;
      const removeControls = await page
        .locator("main")
        .getByRole("button", { name: /remove|delete|clear/i })
        .count();
      expect(afterRejects === original.logo, "a rejected file changed the logo");
      expect(String(pngSaved).startsWith("data:image/png"), `png ${String(pngSaved).slice(0, 30)}`);
      expect(
        String(savedLogo).startsWith("data:image/svg") && removeControls === 0,
        `saved ${String(savedLogo).slice(0, 30)} remove controls ${removeControls}`,
      );
      return `Refusals: ${JSON.stringify(seen)}; the saved logo stayed unchanged after them. The 5 MB message read "${TYPE}". The readability message read "${READ}". A 64 x 64 PNG then showed Saved, and an SVG showed Saved and was displayed beside Logo after reload. The General pane had ${removeControls} remove, delete or clear buttons.`;
    },
    admin.page,
  );

  await step(
    O,
    "administrator",
    "The saved Organization name and logo appear on the staff and Business Portal sign-in pages without an account, and in the staff app and Portal headers after sign-in",
    "Both sign-in pages show the name and an Organization logo image; both headers show them",
    async () => {
      const staff = await signInBranding("/auth/login");
      const portal = await signInBranding("/portal/login");
      await admin.page.goto(`${app}/`);
      await admin.page.waitForLoadState("networkidle");
      const header = admin.page.locator("header").first();
      const headerText = (await header.innerText()).replace(/\s+/g, " ");
      const headerLogo = await header.locator('img[src^="data:image/svg"]').count();
      await buPortal.page.goto(`${app}/portal`);
      await buPortal.page.waitForLoadState("networkidle");
      await sleep(500);
      const portalHeader = buPortal.page.locator("header").first();
      const portalHeaderText = (await portalHeader.innerText()).replace(/\s+/g, " ");
      const portalHeaderLogo = await portalHeader.locator('img[src^="data:image/svg"]').count();
      await buPortal.ctx.close();
      expect(
        staff.text.includes(draftName) && staff.logos.length === 1 && staff.logos[0].startsWith("data:image/svg"),
        `staff ${JSON.stringify(staff)}`,
      );
      expect(portal.text.includes(draftName) && portal.logos.length === 1, `portal ${JSON.stringify(portal)}`);
      expect(headerText.includes(draftName) && headerLogo >= 1, `header "${headerText.slice(0, 120)}" logo ${headerLogo}`);
      expect(portalHeaderText.includes(draftName) && portalHeaderLogo >= 1, `portal header "${portalHeaderText.slice(0, 120)}" logo ${portalHeaderLogo}`);
      return `In a browser with no session, /auth/login began "${staff.text.slice(0, 100)}" with ${staff.logos.length} image named Organization logo; /portal/login began "${portal.text.slice(0, 100)}" with ${portal.logos.length}. Signed in, the staff app header read "${headerText.slice(0, 80)}" with ${headerLogo} SVG logo image, and the Business User's Portal header read "${portalHeaderText.slice(0, 80)}" with ${portalHeaderLogo}.`;
    },
    admin.page,
  );

  let sinceA;
  let inviteMail;
  await step(
    O,
    "administrator",
    "Invite a colleague steps 1 to 3: Invite user, Display name, Email, Role Legal team member, Send invite",
    "Role offers Legal team member and Administrator; new Invited row; a Set password email that expires in 1 hour, with the organization name and logo in its header",
    async () => {
      const { page } = admin;
      await openUsers(page, app);
      await page.getByRole("button", { name: "Invite user" }).click();
      const dialog = page.getByRole("dialog", { name: "Invite user" });
      const radios = await dialog
        .getByRole("radio")
        .evaluateAll((els) => els.map((e) => e.closest("label")?.innerText.trim() ?? e.getAttribute("aria-label")));
      await dialog.getByRole("button", { name: "Cancel" }).click();
      sinceA = new Date(Date.now() - 2000);
      const d = await invite(page, people.a.name, people.a.email, "Legal team member");
      await d.waitFor({ state: "hidden" });
      const state = await rowState(page, people.a.email);
      inviteMail = await latestMail(mail, people.a.email, sinceA, SET_PASSWORD);
      expect(inviteMail, "no invitation email");
      const header = emailHeader(inviteMail);
      const action = /Set password/.test(inviteMail.html) && /expires in 1 hour/.test(inviteMail.html);
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
      expect(action, "no Set password action or 1 hour expiry line");
      expect(header.name === draftName && header.cid === "org-logo@openlaw", `email header ${JSON.stringify(header)}`);
      return `Role radios were ${JSON.stringify(radios)}. After Send invite the row read Invited with actions ${JSON.stringify(state.actions)} and no role control. Mailpit received "${inviteMail.subject}" with a Set password button and the line "The link expires in 1 hour". Its header named "${header.name}" and showed the inline image ${header.cid} (the uploaded logo, not the OpenLaw mark).`;
    },
    admin.page,
  );

  await step(
    O,
    "administrator",
    "Restore the organization name and logo; sign-in pages and email follow",
    "Original name saved by leaving the field; original logo restored",
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
      expect(restoredName === original.name && restore.status === 200, `name ${restoredName} restore ${restore.status}`);
      expect(
        staff.text.includes(original.name) && staff.logos.length === (original.logo ? 1 : 0),
        `staff ${JSON.stringify(staff)}`,
      );
      return `Typing "${original.name}" and leaving the field showed Saved and survived reload. The original logo (${original.logo === null ? "none" : "an image"}) was restored through PATCH /api/v1/org/general (${restore.status}) because the pane has no remove control. /auth/login then showed "${staff.text.slice(0, 80)}" with ${staff.logos.length} logo images. The shared organization identity was changed for about a minute.`;
    },
    admin.page,
  );

  await step(
    O,
    "administrator",
    "Update organization details steps 4 and 5: Default timezone saves; reload; Default locale offers English (United States) only",
    "Timezone saved and restored; one locale option",
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
      expect(locales.length === 1 && locales[0].trim() === "English (United States)", `locales ${locales}`);
      expect(restored.startsWith(original.defaultTimezone), `restored ${restored}`);
      return `Default timezone saved America/Toronto and kept it after reload. Default locale offered only ${JSON.stringify(locales)}. The timezone was restored to ${original.defaultTimezone}.`;
    },
    admin.page,
  );

  await step(O, "administrator", "OpenLaw rejects an invalid address", "No row is created", async () => {
    const { page } = admin;
    await openUsers(page, app);
    const before = (await api(page, app, "GET", "/api/v1/users")).data.users.length;
    const d = await invite(page, "DOC-030 admin-org V-C36 invalid", "doc030-org-invalid-address", "Legal team member");
    await sleep(800);
    const stillOpen = await d.isVisible();
    const validation = await d.getByLabel("Email").evaluate((el) => el.validationMessage);
    await d.getByRole("button", { name: "Cancel" }).click();
    const apiTry = await api(page, app, "POST", "/api/v1/auth/invites", {
      email: "doc030 org@@helix",
      displayName: "DOC-030 admin-org V-C36 invalid",
      role: "legal_team_member",
    });
    const after = (await api(page, app, "GET", "/api/v1/users")).data.users.length;
    expect(stillOpen && before === after && apiTry.status >= 400, `open ${stillOpen}, users ${before}->${after}, api ${apiTry.status}`);
    return `The dialog stayed open with the browser message "${validation}" and no row was added (${before} users before and after). The invite route refused a malformed address with ${apiTry.status}.`;
  }, admin.page);

  await step(
    O,
    "administrator",
    "Inviting an already pending address with the same role resends its invitation",
    "A new email; still one row",
    async () => {
      const { page } = admin;
      await openUsers(page, app);
      const since = new Date(Date.now() - 1000);
      const d = await invite(page, people.a.name, people.a.email, "Legal team member");
      await d.waitFor({ state: "hidden" });
      const m = await latestMail(mail, people.a.email, since, SET_PASSWORD);
      await openUsers(page, app);
      const rows = await row(page, people.a.email).count();
      expect(m && rows === 1, `mail ${!!m}, rows ${rows}`);
      return `The dialog closed, a new "${m.subject}" email arrived, and the table still had exactly ${rows} row for the address.`;
    },
    admin.page,
  );

  await step(
    O,
    "administrator",
    "An invitation that names a different role for a pending address is refused",
    `"This user already exists with a different role."; no email`,
    async () => {
      const { page } = admin;
      await openUsers(page, app);
      const since = new Date();
      const d = await invite(page, people.a.name, people.a.email, "Administrator");
      const alert = (await d.getByRole("alert").innerText()).trim();
      await d.getByRole("button", { name: "Cancel" }).click();
      await sleep(2500);
      const n = await countMail(mail, people.a.email, since);
      expect(alert === "This user already exists with a different role." && n === 0, `alert "${alert}", mails ${n}`);
      return `The dialog showed "${alert}" and Mailpit received ${n} messages.`;
    },
    admin.page,
  );

  await step(
    O,
    "administrator",
    "An invitation for an account that has already signed in is refused; a Business User's address gets the same refusal",
    `"This user has already activated their account." for Nadia and for Jonas`,
    async () => {
      const { page } = admin;
      const out = {};
      for (const [name, email] of [
        ["Nadia Haddad", NADIA],
        ["Jonas Weber", JONAS],
      ]) {
        await openUsers(page, app);
        const d = await invite(page, name, email, "Legal team member");
        out[email] = (await d.getByRole("alert").innerText()).trim();
        await d.getByRole("button", { name: "Cancel" }).click();
      }
      expect(
        Object.values(out).every((x) => x === "This user has already activated their account."),
        JSON.stringify(out),
      );
      return `Invite user answered ${JSON.stringify(out)}.`;
    },
    admin.page,
  );

  await step(
    O,
    "administrator",
    "Resend invite on the pending row sends a replacement link",
    "Row shows Saved; a new Set password email",
    async () => {
      const { page } = admin;
      await openUsers(page, app);
      const since = new Date(Date.now() - 1000);
      await row(page, people.a.email).getByRole("button", { name: `Resend the invite to ${people.a.email}` }).click();
      const note = await rowNote(page, people.a.email);
      const m = await latestMail(mail, people.a.email, since, SET_PASSWORD);
      expect(note === "Saved" && m, `note ${note} mail ${!!m}`);
      return `The row showed "${note}" and a new "${m.subject}" email arrived.`;
    },
    admin.page,
  );

  const colleague = await context();
  await step(
    O,
    "invited colleague",
    "Invite step 4: the first sign-in by a sign-in link (Legal User Authentication has Email magic link on) changes the row to Active",
    "Colleague signs in from the staff sign-in page; row Active with a role control",
    async () => {
      const { page } = colleague;
      const policy = (await (await fetch(`${app}/api/v1/auth/methods`)).json()).policy.legal;
      const since = new Date(Date.now() - 1000);
      const sent = await requestMagicLink(page, app, people.a.email);
      const m = await latestMail(mail, people.a.email, since, MAGIC);
      expect(m, "no magic link");
      await page.goto(m.link);
      await page.waitForLoadState("networkidle");
      const landed = new URL(page.url()).pathname;
      const me = await api(page, app, "GET", "/api/v1/me");
      await openUsers(admin.page, app);
      const state = await rowState(admin.page, people.a.email);
      expect(me.status === 200 && me.data.user.role === "legal_team_member", `me ${me.status}`);
      expect(state.status === "Active" && state.roleControl, JSON.stringify(state));
      return `Legal User Authentication was ${JSON.stringify(policy)}. The staff page said "${sent.slice(0, 140)}". Opening "${m.subject}" signed the colleague in (landed on ${landed}; role ${me.data.user.role}). Daniel's Users table then showed the row as ${state.status} with a role control and actions ${JSON.stringify(state.actions)}.`;
    },
    colleague.page,
  );

  const casey = await context();
  await step(
    O,
    "invited colleague",
    "Invite step 4: a colleague sets a password from the Set password email link; the row becomes Active",
    "Password set; password sign-in works; row Active",
    async () => {
      const { page } = admin;
      await openUsers(page, app);
      const since = new Date(Date.now() - 1000);
      const d = await invite(page, people.c.name, people.c.email, "Legal team member");
      await d.waitFor({ state: "hidden" });
      const m = await latestMail(mail, people.c.email, since, SET_PASSWORD);
      expect(m, "no invitation");
      await setPasswordFromLink(casey.page, m.link, people.c.password);
      await signIn(casey.page, app, people.c.email, people.c.password);
      const me = await api(casey.page, app, "GET", "/api/v1/me");
      await openUsers(page, app);
      const state = await rowState(page, people.c.email);
      expect(me.status === 200 && state.status === "Active" && state.roleControl, `${me.status} ${JSON.stringify(state)}`);
      return `"${m.subject}" arrived; "Password set" appeared; the colleague signed in with the new password (me ${me.status}). The row read ${state.status} with a role control.`;
    },
    casey.page,
  );

  await step(
    O,
    "invited colleague",
    "The activated Legal Team Member checks their access",
    "No administration: Users sends them to Profile",
    async () => {
      const { page } = colleague;
      await page.goto(`${app}/settings/users`);
      await page.waitForLoadState("networkidle");
      const p = new URL(page.url()).pathname;
      const invites = await page.getByRole("button", { name: "Invite user" }).count();
      expect(p === "/settings/profile" && invites === 0, `${p}, invite buttons ${invites}`);
      return `Settings Users sent the colleague to ${p}; no Invite user control was offered.`;
    },
    colleague.page,
  );

  await step(
    O,
    "administrator",
    "Revoke invite withdraws an unused invitation and removes the row",
    "The pending row is removed",
    async () => {
      const { page } = admin;
      await openUsers(page, app);
      const d = await invite(page, people.b.name, people.b.email, "Legal team member");
      await d.waitFor({ state: "hidden" });
      const beforeState = await rowState(page, people.b.email);
      await row(page, people.b.email).getByRole("button", { name: `Revoke the invite to ${people.b.email}` }).click();
      await row(page, people.b.email).waitFor({ state: "detached" });
      const listed = (await api(page, app, "GET", "/api/v1/users")).data.users.some((u) => u.email === people.b.email);
      expect(beforeState.status === "Invited" && !listed, `before ${JSON.stringify(beforeState)}, still listed ${listed}`);
      return `The Invited row for ${people.b.name} disappeared after Revoke invite, and GET /api/v1/users no longer listed the address.`;
    },
    admin.page,
  );

  await step(
    O,
    "administrator",
    "Change a role: the role control on an Active row offers three roles; Administrator applies on the colleague's next action without signing in again",
    "Administrator, Legal team member, Business user; colleague reaches Settings Users on next navigation",
    async () => {
      const { page } = admin;
      await openUsers(page, app);
      const items = await chooseRole(page, people.a.email, "Administrator");
      const note = await rowNote(page, people.a.email);
      await openUsers(page, app);
      const saved = await rowState(page, people.a.email);
      await colleague.page.goto(`${app}/settings/users`);
      await colleague.page.getByRole("heading", { name: "Users", level: 2 }).waitFor({ timeout: 15000 });
      expect(
        JSON.stringify(items) === JSON.stringify(["Administrator", "Legal team member", "Business user"]),
        `items ${items}`,
      );
      expect(note === "Saved" && saved.role === "Administrator", `${note} ${JSON.stringify(saved)}`);
      return `The role menu offered ${JSON.stringify(items)}. Choosing Administrator showed "${note}" and the reloaded row read ${saved.role}. The colleague's existing session opened Settings Users on its next navigation without signing in again.`;
    },
    admin.page,
  );

  await step(
    O,
    "administrator",
    "Change the role back to Legal team member",
    "The colleague loses administration on the next request",
    async () => {
      const { page } = admin;
      await openUsers(page, app);
      await chooseRole(page, people.a.email, "Legal team member");
      const note = await rowNote(page, people.a.email);
      const r = await api(colleague.page, app, "GET", "/api/v1/users");
      expect(note === "Saved" && r.status === 403, `${note} status ${r.status}`);
      return `The row showed "${note}" for Legal team member. The colleague's same session got ${r.status} from GET /api/v1/users on its next request.`;
    },
    admin.page,
  );

  const bu = await context();
  await step(
    O,
    "administrator",
    "Promote a Portal-created Business User to Legal team member: the row stays Active with its role control; return it to Business user",
    "Active Business user row; after promotion still Active with role control; access follows the role",
    async () => {
      const since = new Date(Date.now() - 1000);
      await requestMagicLink(bu.page, app, people.bu.email, true);
      const m = await latestMail(mail, people.bu.email, since, MAGIC);
      expect(m, "no Portal sign-in link");
      await bu.page.goto(m.link);
      await bu.page.waitForURL((u) => u.pathname.startsWith("/portal"), { timeout: 20000 });
      const { page } = admin;
      await openUsers(page, app);
      const beforeState = await rowState(page, people.bu.email);
      await chooseRole(page, people.bu.email, "Legal team member");
      const note = await rowNote(page, people.bu.email);
      await openUsers(page, app);
      const promoted = await rowState(page, people.bu.email);
      const meAfter = await api(bu.page, app, "GET", "/api/v1/me");
      await chooseRole(page, people.bu.email, "Business user");
      const note2 = await rowNote(page, people.bu.email);
      await openUsers(page, app);
      const back = await rowState(page, people.bu.email);
      expect(beforeState.status === "Active" && beforeState.role === "Business user" && beforeState.roleControl, `before ${JSON.stringify(beforeState)}`);
      expect(
        note === "Saved" && promoted.status === "Active" && promoted.roleControl && promoted.role === "Legal team member",
        `promoted ${note} ${JSON.stringify(promoted)}`,
      );
      expect(meAfter.data?.user?.role === "legal_team_member", `me ${JSON.stringify(meAfter.data?.user?.role)}`);
      expect(back.status === "Active" && back.role === "Business user" && back.roleControl, `back ${note2} ${JSON.stringify(back)}`);
      return `A Portal sign-in link created an ${beforeState.status} ${beforeState.role} row with a role control. Choosing Legal team member showed "${note}"; the row stayed ${promoted.status} with its role control and read ${promoted.role}, and the person's own session reported role ${meAfter.data.user.role} on its next request. Choosing Business user showed "${note2}" and the row returned to ${back.status} ${back.role}. The Invited branch did not occur, as the article says for a Business User who has signed in.`;
    },
    admin.page,
  );

  await step(
    O,
    "administrator",
    "Your own row has no Archive action and no … button; Administrators cannot archive themselves",
    `No row actions on Daniel's row; "You cannot archive yourself."`,
    async () => {
      const { page } = admin;
      await openUsers(page, app);
      const self = await rowState(page, DANIEL);
      const me = (await api(page, app, "GET", "/api/v1/me")).data.user;
      const r = await api(page, app, "POST", `/api/v1/users/${me.id}/archive`);
      expect(self.roleControl && !self.moreActions && !self.actions.includes("Archive"), JSON.stringify(self));
      expect(r.status >= 400 && r.data?.detail === "You cannot archive yourself.", `self archive ${r.status} ${r.data?.detail}`);
      return `Daniel's own row had a role control, no Archive and no "More actions for ${DANIEL}" button (buttons: ${JSON.stringify(self.actions)}). A direct archive request for his own account was refused with ${r.status}: "${r.data?.detail}".`;
    },
    admin.page,
  );

  await step(
    O,
    "administrator",
    "Sign out user from the row's … button (More actions for the email address); sessions stop; the account stays active and can sign in again",
    "Menu offers Sign out user; colleague's next request needs sign-in; row Active; password sign-in works",
    async () => {
      const { page } = admin;
      await openUsers(page, app);
      const beforeMe = await api(casey.page, app, "GET", "/api/v1/me");
      const items = await signOutUser(page, people.c.email);
      const note = await rowNote(page, people.c.email);
      const after = await api(casey.page, app, "GET", "/api/v1/me");
      await casey.page.goto(`${app}/`);
      await casey.page.waitForLoadState("networkidle");
      const landed = new URL(casey.page.url()).pathname;
      const state = await rowState(page, people.c.email);
      await signIn(casey.page, app, people.c.email, people.c.password);
      const again = await api(casey.page, app, "GET", "/api/v1/me");
      expect(JSON.stringify(items) === JSON.stringify(["Sign out user"]), `menu ${items}`);
      expect(beforeMe.status === 200 && after.status === 401 && landed.startsWith("/auth/login"), `before ${beforeMe.status} after ${after.status} landed ${landed}`);
      expect(state.status === "Active" && again.status === 200, `state ${JSON.stringify(state)} again ${again.status}`);
      return `The "More actions for ${people.c.email}" menu offered ${JSON.stringify(items)}; choosing it showed "${note}". The colleague's session went from ${beforeMe.status} to ${after.status} on /api/v1/me and the app sent it to ${landed}. The row stayed ${state.status}, and a password sign-in worked again (${again.status}).`;
    },
    admin.page,
  );

  let contractNumber;
  await step(
    O,
    "administrator",
    "Reassign work before archiving: fixture Contract with the colleague as Legal Owner",
    "Contract created (API fixture); checked after archive",
    async () => {
      const { page } = admin;
      const users = (await api(page, app, "GET", "/api/v1/users")).data.users;
      const cId = users.find((u) => u.email === people.c.email).id;
      const types = (await api(page, app, "GET", "/api/v1/contract-types")).data.contractTypes;
      const other = types.find((t) => t.slug === "other") ?? types[0];
      const created = await api(page, app, "POST", "/api/v1/contracts", {
        title: `DOC-030 admin-org V-C36 offboarding contract ${stamp}`,
        contractTypeId: other.id,
        managerId: cId,
      });
      expect(created.status === 201 || created.status === 200, `create ${created.status} ${JSON.stringify(created.data)}`);
      contractNumber = created.data.contract.number;
      people.c.id = cId;
      results.records = [`Contract ${contractNumber} "DOC-030 admin-org V-C36 offboarding contract ${stamp}"`];
      return `Created Contract ${contractNumber} with the colleague as Legal Owner through the API (fixture setup; the check follows the archive).`;
    },
    admin.page,
  );

  await step(
    O,
    "administrator",
    "Archive and restore steps 1 and 2: Archive on the row; it leaves the ordinary list; sessions end; new sign-in blocked; nothing is reassigned",
    "Row hidden; live session ends; password sign-in refused; no sign-in link; Legal Owner unchanged",
    async () => {
      const { page } = admin;
      await openUsers(page, app);
      const switchBefore = await page.getByRole("switch", { name: "Show archived" }).count();
      const live = await api(casey.page, app, "GET", "/api/v1/me");
      await row(page, people.c.email).getByRole("button", { name: `Archive ${people.c.email}` }).click();
      await row(page, people.c.email).waitFor({ state: "detached", timeout: 10000 });
      const after = await api(casey.page, app, "GET", "/api/v1/me");
      const fresh = await context();
      await fresh.page.goto(`${app}/auth/login`);
      await fresh.page.getByLabel("Email", { exact: true }).fill(people.c.email);
      await fresh.page.getByLabel("Password", { exact: true }).fill(people.c.password);
      await fresh.page.getByRole("button", { name: "Sign in", exact: true }).click();
      const alert = (await fresh.page.getByRole("alert").first().innerText({ timeout: 15000 })).trim();
      const since = new Date(Date.now() - 1000);
      const linkPage = await requestMagicLink(fresh.page, app, people.c.email).catch(async () =>
        `(no confirmation) ${(await fresh.page.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 160)}`,
      );
      await sleep(3000);
      const links = await countMail(mail, people.c.email, since);
      await fresh.ctx.close();
      const contract = await api(page, app, "GET", `/api/v1/contracts/${contractNumber}`);
      const manager = contract.data?.contract?.manager;
      const switchAfter = await page.getByRole("switch", { name: "Show archived" }).count();
      expect(live.status === 200 && after.status === 401, `live ${live.status} after ${after.status}`);
      expect(/archived/i.test(alert) && links === 0, `sign-in alert ${alert} links ${links}`);
      expect(manager?.id === people.c.id && manager?.archived === true, `manager ${JSON.stringify(manager)}`);
      expect(switchAfter === 1, `switch after ${switchAfter}`);
      return `Archive removed the row from the ordinary list at once. The colleague's live session went from ${live.status} to ${after.status}. A new password sign-in showed "${alert}". A sign-in link request answered "${linkPage.slice(0, 140)}" and sent ${links} messages. Contract ${contractNumber} still named the archived colleague as Legal Owner (archived: ${manager.archived}). Show archived was present ${switchBefore ? "before (the shared lab already held archived accounts) and " : ""}after the archive.`;
    },
    admin.page,
  );

  await step(
    O,
    "administrator",
    "Archive and restore steps 3 and 4: Show archived, Restore, and ask the user to sign in again",
    "Restored row Active; the revoked session stays revoked; a new sign-in works",
    async () => {
      const { page } = admin;
      await openUsers(page, app);
      await page.getByRole("switch", { name: "Show archived" }).click();
      const archived = await rowState(page, people.c.email);
      await row(page, people.c.email).getByRole("button", { name: `Restore ${people.c.email}` }).click();
      const note = await rowNote(page, people.c.email);
      const restored = await rowState(page, people.c.email);
      const old = await api(casey.page, app, "GET", "/api/v1/me");
      await signIn(casey.page, app, people.c.email, people.c.password);
      const again = await api(casey.page, app, "GET", "/api/v1/me");
      expect(archived.status === "Archived" && archived.actions.includes("Restore"), `archived ${JSON.stringify(archived)}`);
      expect(restored.status === "Active" && old.status === 401 && again.status === 200, `restored ${JSON.stringify(restored)} old ${old.status} again ${again.status}`);
      return `With Show archived on, the row read Archived with a Restore action. Restore showed "${note}" and the row read Active. The old browser session still got ${old.status}; a fresh password sign-in got ${again.status}.`;
    },
    admin.page,
  );

  await shot(admin.page, "org-users-restored");
  await Promise.all([admin.ctx.close(), colleague.ctx.close(), casey.ctx.close(), bu.ctx.close()]);
}

// ---------------------------------------------------------------------------
// V-C37 authentication-and-email, and the V-C36 checks that need an owned lab.
const AUTH_PASSWORD = process.env.AUTH_PASSWORD;
const needAuthPassword = () => {
  if (!AUTH_PASSWORD) throw new Error("AUTH_PASSWORD is required for the owned-lab sections");
};
function labEnvValue(labName, key) {
  const env = readFileSync(path.join(root, ".documentation-labs", labName, "source", ".env"), "utf8");
  return env.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1] ?? null;
}
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

// The auth2w first Administrator (a fictional first-run fixture).
const WIZ_ADMIN = { name: "DOC-030 admin-org Avery Morgan", email: "doc030-wiz-admin@helix.example" };
const WIZ_PENDING = "doc030-wiz-pending@helix.example";
const STORED_SENDER = "stored-relay@helix.example";
const STORED_NAME = "DOC-030 Stored";
const ENV_SENDER = "env-relay@helix.example";
const WORKING_RELAY = {
  host: "mailpit",
  port: 1025,
  security: "None",
  authentication: "None",
  senderEmail: STORED_SENDER,
  senderName: STORED_NAME,
};

async function wizAdmin() {
  needAuthPassword();
  const c = await context();
  await signIn(c.page, WIZ.app, WIZ_ADMIN.email, AUTH_PASSWORD);
  return c;
}
async function emailStep(page, base) {
  await page.goto(`${base}/welcome?step=email`);
  await page.getByRole("heading", { name: "Outbound email" }).first().waitFor();
  await page.waitForLoadState("networkidle");
}
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
async function fillRelay(page, { host, port, security, authentication, username, password, senderEmail, senderName }) {
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
const STANDING_ALERT =
  /^(Set up outbound email to finish instance setup|Outbound email is set in the app|Outbound email is set by the deployment environment|The deployment environment sets SMTP_URL|Managed by your deployment configuration)/;
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
async function sendTest(page) {
  await page.getByRole("button", { name: "Send test email" }).click();
  const result = page
    .getByText(/^(Test email sent to \S+\. Check your inbox\.|The test email could not be sent\..*)$/)
    .first();
  await result.waitFor({ timeout: 60000 });
  return (await result.innerText()).trim();
}
/** The facts of an OpenLaw test email, read in memory. */
function testMailFacts(f) {
  const body = f.html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
  return {
    subject: f.subject,
    from: `${f.fromName ? `${f.fromName} ` : ""}<${f.from}>`,
    headline: /Outbound email works/.test(body),
    sentThrough: body.match(/Sent through\s+(\S+)/)?.[1] ?? null,
    fromLine: body.match(/\bFrom\s+(.*?<?[^\s<>]+@[^\s<>]+>?)/)?.[1] ?? null,
    header: emailHeader(f),
  };
}
async function openSettingsPane(page, base, linkName) {
  await page.goto(`${base}/settings/general`);
  const nav = page.getByRole("navigation", { name: "Settings sections" });
  const advanced = nav.getByRole("button", { name: "Advanced" });
  if ((await advanced.getAttribute("aria-expanded")) !== "true") await advanced.click();
  await nav.getByRole("link", { name: linkName, exact: true }).click();
  await page.waitForLoadState("networkidle");
}
async function signInLinkOffered(base) {
  const out = {};
  for (const p of ["/auth/login", "/portal/login"]) {
    const anon = await context();
    await anon.page.goto(`${base}${p}`);
    await anon.page.getByRole("heading", { level: 1 }).first().waitFor();
    await anon.page.waitForLoadState("networkidle");
    await sleep(400);
    out[p] = await buttons(anon.page);
    await anon.ctx.close();
  }
  return out;
}

async function wizardStored() {
  needAuthPassword();
  const { app, mail } = WIZ;
  const admin = await context();
  await step(
    A3,
    "administrator",
    "First-run: create the first Administrator; Skip optional steps on the Welcome step opens Outbound email while email is not configured",
    "Outbound email step with the unset warning, no Set up later, Continue unavailable",
    async () => {
      const { page } = admin;
      await page.goto(`${app}/auth/setup`);
      await page.getByLabel("Setup token").fill(labEnvValue("auth2w", "SETUP_TOKEN"));
      await page.getByLabel("Name").fill(WIZ_ADMIN.name);
      await page.getByLabel("Email").fill(WIZ_ADMIN.email);
      await page.getByLabel("Password", { exact: true }).fill(AUTH_PASSWORD);
      await page.getByLabel("Confirm password").fill(AUTH_PASSWORD);
      await page.getByRole("button", { name: "Create Administrator" }).click();
      await page.waitForURL((u) => u.pathname.startsWith("/welcome"), { timeout: 20000 });
      await page.getByRole("button", { name: "Skip optional steps" }).click();
      await page.getByRole("heading", { name: "Outbound email" }).first().waitFor();
      const text = await paneText(page);
      const b = await buttons(page);
      const cont = page.getByRole("button", { name: "Continue" });
      expect(/Set up outbound email to finish instance setup\. OpenLaw uses it for invitations, sign-in links, and notifications\./.test(text), text.slice(0, 300));
      expect(!b.includes("Set up later") && (await cont.isDisabled()), `buttons ${b}`);
      const u = new URL(page.url());
      return `The first Administrator was created with the lab's setup token and landed on /welcome. Skip optional steps opened ${u.pathname}${u.search} with "Set up outbound email to finish instance setup. OpenLaw uses it for invitations, sign-in links, and notifications." The step had no Set up later (buttons ${JSON.stringify(b)}) and Continue was disabled.`;
    },
    admin.page,
  );

  await step(
    O,
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
          logos: await anon.page.locator("main").getByRole("img", { name: "Organization logo" }).count(),
        };
        await anon.ctx.close();
      }
      const branding = await (await fetch(`${app}/api/v1/org/branding`)).json();
      expect(
        !branding.name && Object.values(out).every((x) => x.start.startsWith("OpenLaw") && x.logos === 0),
        `${JSON.stringify(branding)} ${JSON.stringify(out)}`,
      );
      return `The organization had no saved name (GET /api/v1/org/branding ${JSON.stringify(branding)}). In a browser with no session: ${JSON.stringify(out)}.`;
    },
    admin.page,
  );

  await step(
    A3,
    "administrator",
    "Wizard email steps 1 to 3: SMTP server, Port (starts at 587, follows Connection security until changed), Connection security, Authentication",
    "587; 465 for TLS; 25 for None; 587 for STARTTLS; a changed port stays; credentials fields only with Username and password",
    async () => {
      const { page } = admin;
      const f = smtp(page);
      const seen = {};
      seen.initial = await f.port.inputValue();
      seen.securityOptions = (await f.security.locator("option").allInnerTexts()).map((x) => x.trim());
      seen.authenticationOptions = (await f.authentication.locator("option").allInnerTexts()).map((x) => x.trim());
      seen.initialAuthentication = (await f.authentication.locator("option:checked").innerText()).trim();
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
      seen.senderFields = [await f.senderName.count(), await f.senderEmail.count()];
      await emailStep(page, app);
      expect(seen.initial === "587" && seen.tls === "465" && seen.none === "25" && seen.starttls === "587" && seen.changedThenTls === "2525", JSON.stringify(seen));
      expect(
        JSON.stringify(seen.securityOptions) === JSON.stringify(["STARTTLS", "TLS", "None"]) &&
          JSON.stringify(seen.authenticationOptions) === JSON.stringify(["Username and password", "None"]) &&
          seen.initialAuthentication === "Username and password",
        JSON.stringify(seen),
      );
      expect(seen.credentialsWithPassword.join() === "1,1" && seen.credentialsWithNone.join() === "0,0" && seen.senderFields.join() === "1,1", JSON.stringify(seen));
      return `Observed ${JSON.stringify(seen)}. The step was reloaded afterwards.`;
    },
    admin.page,
  );

  await step(
    A3,
    "administrator",
    "Wizard email step 1 negative: SMTP server with an smtp:// prefix or a port is refused",
    "Not saved; source stays unset",
    async () => {
      const { page } = admin;
      const out = [];
      for (const host of ["smtp://mailpit", "mailpit:1025"]) {
        await emailStep(page, app);
        await fillRelay(page, { ...WORKING_RELAY, host });
        const n = await emailNotice(page);
        const settings = await api(page, app, "GET", "/api/v1/email-settings");
        out.push({ host, notice: n.match, alerts: n.alerts, source: settings.data?.source });
      }
      expect(out.every((x) => x.source === "unset" && !/Relay saved/.test(x.notice ?? "")), JSON.stringify(out));
      return `Save relay results: ${JSON.stringify(out)}.`;
    },
    admin.page,
  );

  const smtpUser = "doc030-smtp-user";
  const smtpSecret = `doc030-${randomBytes(9).toString("hex")}`;
  await step(
    A3,
    "administrator",
    "Wizard email steps 4 to 6 with STARTTLS and Username and password: Save relay stores the credentials encrypted and never returns them; the TLS upgrade must succeed before delivery",
    "Relay saved; no credentials in the page or API; stored value not plain text; Send test email fails; nothing delivered",
    async () => {
      const { page } = admin;
      await emailStep(page, app);
      await fillRelay(page, {
        host: "mailpit",
        security: "STARTTLS",
        port: 1025,
        authentication: "Username and password",
        username: smtpUser,
        password: smtpSecret,
        senderEmail: STORED_SENDER,
        senderName: STORED_NAME,
      });
      const saved = await emailNotice(page);
      const text = await paneText(page);
      const settings = await api(page, app, "GET", "/api/v1/email-settings");
      const html = await page.content();
      const stored = execFileSync(
        "docker",
        ["--context", "default", "exec", `${WIZ.project}-postgres-1`, "psql", "-U", "openlaw", "-d", "openlaw", "-At", "-c", "select smtp_url from org_settings"],
        { encoding: "utf8" },
      );
      const storedPlain = stored.includes(smtpSecret) || stored.includes(smtpUser) || stored.includes("mailpit");
      const since = new Date(Date.now() - 1000);
      const test = await sendTest(page);
      await sleep(3000);
      const n = await countMail(mail, WIZ_ADMIN.email, since);
      expect(/Relay saved\./.test(saved.match ?? ""), JSON.stringify(saved));
      expect(
        JSON.stringify(Object.keys(settings.data).sort()) === JSON.stringify(["fromAddress", "source"]) && settings.data.source === "app",
        JSON.stringify(settings.data),
      );
      expect(!html.includes(smtpSecret) && !html.includes(smtpUser) && !JSON.stringify(settings.data).includes(smtpSecret), "credentials shown");
      expect(!storedPlain && stored.trim().length > 0, "stored value readable");
      expect(/The test email could not be sent\./.test(test) && n === 0, `${test} mails ${n}`);
      return `Save relay showed "${saved.match}". The step read "${text.match(/Outbound email is set in the app\.[^.]*\.[^.]*\./)?.[0]}". GET /api/v1/email-settings returned only ${JSON.stringify(settings.data)}; neither the page nor the API contained the SMTP username or password. org_settings.smtp_url held a ${stored.trim().length}-character value without the host, username or password in plain text. Send test email against Mailpit, which offers no STARTTLS, showed "${test}" and Mailpit received ${n} messages.`;
    },
    admin.page,
  );

  await step(
    A3,
    "administrator",
    "Wizard email steps 6 and 7: Replace relay opens an empty form; Keep current relay closes it; replace with None and None; Send test email",
    `"Test email sent to" the Administrator; OpenLaw test email with Outbound email works, Sent through and From; Continue available`,
    async () => {
      const { page } = admin;
      const before = (await api(page, app, "GET", "/api/v1/email-settings")).data;
      await page.getByRole("button", { name: "Replace relay" }).click();
      const f = smtp(page);
      const form = {
        host: await f.host.inputValue(),
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
      const since = new Date(Date.now() - 1000);
      const test = await sendTest(page);
      const m = await latestMail(mail, WIZ_ADMIN.email, since, null);
      const facts = m && testMailFacts(m);
      const cont = await page.getByRole("button", { name: "Continue" }).isDisabled();
      expect(Object.values(form).every((v) => v === ""), JSON.stringify(form));
      expect(formGone === 0 && JSON.stringify(kept) === JSON.stringify(before), `form ${formGone} kept ${JSON.stringify(kept)}`);
      expect(/Relay saved\./.test(saved.match ?? "") && test === `Test email sent to ${WIZ_ADMIN.email}. Check your inbox.`, `${JSON.stringify(saved)} ${test}`);
      expect(
        facts && facts.subject === "OpenLaw test email" && facts.headline && facts.sentThrough?.startsWith("mailpit") && facts.fromLine?.includes(STORED_SENDER) && m.from === STORED_SENDER && m.fromName === STORED_NAME && !cont,
        `${JSON.stringify(facts)} continue disabled ${cont}`,
      );
      return `Replace relay opened an empty form ${JSON.stringify(form)}. Keep current relay closed it and the settings stayed ${JSON.stringify(kept)}. Replace relay with SMTP server mailpit, Port 1025, None, None, Sender email ${STORED_SENDER} and Sender name ${STORED_NAME} showed "${saved.match}". Send test email showed "${test}". Mailpit received "${facts.subject}" from ${facts.from}; the body said Outbound email works, Sent through ${facts.sentThrough}, From ${facts.fromLine}. Continue became available.`;
    },
    admin.page,
  );

  await step(
    O,
    "administrator",
    "Emails with no organization name and no logo show OpenLaw and the OpenLaw mark in their header",
    "Test email header names OpenLaw with the OpenLaw mark",
    async () => {
      const since = new Date(Date.now() - 1000);
      await sendTest(admin.page);
      const m = await latestMail(mail, WIZ_ADMIN.email, since, null);
      const header = emailHeader(m);
      expect(header.name === "OpenLaw" && header.cid === "openlaw-mark@openlaw", JSON.stringify(header));
      return `On the unnamed auth2w instance a test email's header read "${header.name}" with the inline image ${header.cid}.`;
    },
    admin.page,
  );

  await step(
    A3,
    "administrator",
    "Wizard email step 7: a relay that cannot be reached saves but fails its test; Replace relay again with all details and retest",
    "A saved relay alone does not prove delivery; the corrected relay delivers",
    async () => {
      const { page } = admin;
      await page.getByRole("button", { name: "Replace relay" }).click();
      await fillRelay(page, { ...WORKING_RELAY, host: "doc030-unreachable-relay.invalid", port: 2525 });
      const saved = await emailNotice(page);
      const failure = await sendTest(page);
      await page.getByRole("button", { name: "Replace relay" }).click();
      await fillRelay(page, WORKING_RELAY);
      await page.getByText("Relay saved.").first().waitFor();
      const since = new Date(Date.now() - 1000);
      const ok = await sendTest(page);
      const m = await latestMail(mail, WIZ_ADMIN.email, since, null);
      expect(/Relay saved\./.test(saved.match ?? "") && /could not be sent/.test(failure) && m, `${JSON.stringify(saved)} ${failure} ${!!m}`);
      return `An unreachable SMTP server saved with "${saved.match}", but Send test email showed "${failure}". Replace relay, all details entered again, Save relay, and a second test showed "${ok}" and delivered "${m.subject}" from ${m.from}.`;
    },
    admin.page,
  );

  await step(
    A3,
    "administrator",
    "Wizard email step 8: Clear relay removes the saved relay and stops delivery when there is no environment override; save a valid replacement",
    "Relay cleared; source unset; Continue unavailable; no mail; replacement delivers",
    async () => {
      const { page } = admin;
      await page.getByRole("button", { name: "Clear relay" }).click();
      await page.getByText("Relay cleared. This instance can no longer send email.").waitFor();
      const source = (await api(page, app, "GET", "/api/v1/email-settings")).data?.source;
      const cont = await page.getByRole("button", { name: "Continue" }).isDisabled();
      const since = new Date();
      const reset = await api(page, app, "POST", "/api/v1/auth/password-setup", { email: WIZ_ADMIN.email });
      await sleep(3000);
      const n = await countMail(mail, WIZ_ADMIN.email, since);
      await fillRelay(page, WORKING_RELAY);
      await page.getByText("Relay saved.").first().waitFor();
      const since2 = new Date(Date.now() - 1000);
      await sendTest(page);
      const m = await latestMail(mail, WIZ_ADMIN.email, since2, null);
      expect(source === "unset" && cont && n === 0, `source ${source}, continue disabled ${cont}, mails ${n}, reset ${reset.status}`);
      expect(m, "no mail after replacement");
      return `Clear relay showed "Relay cleared. This instance can no longer send email." The source became ${source} and Continue was disabled. A password setup request answered ${reset.status}${reset.data?.detail ? ` ("${reset.data.detail}")` : ""} and Mailpit received ${n} messages. After a valid replacement was saved, a test message arrived again from ${m.from}.`;
    },
    admin.page,
  );
  await admin.ctx.close();
}

async function wizardIncomplete() {
  const { app, mail } = WIZ;
  const admin = await wizAdmin();
  await step(
    A3,
    "operator",
    "Deployment precedence: SMTP_URL without SMTP_FROM prevents delivery even though a complete relay is saved in the app; the wizard shows the warning",
    "Warning; no relay form; no Send test email; Continue unavailable; an invitation is refused",
    async () => {
      const { page } = admin;
      await page.goto(`${app}/settings/general`);
      await page.waitForLoadState("networkidle");
      const forced = new URL(page.url()).pathname;
      await emailStep(page, app);
      const text = await paneText(page);
      const b = await buttons(page);
      const settings = await api(page, app, "GET", "/api/v1/email-settings");
      const cont = await page.getByRole("button", { name: "Continue" }).isDisabled();
      const since = new Date(Date.now() - 1000);
      const inv = await api(page, app, "POST", "/api/v1/auth/invites", {
        email: "doc030-wiz-incomplete@helix.example",
        displayName: "DOC-030 admin-org V-C37 incomplete",
        role: "legal_team_member",
      });
      await sleep(3000);
      const n = await countMail(mail, "doc030-wiz-incomplete@helix.example", since);
      expect(/The deployment environment sets SMTP_URL but not SMTP_FROM, so mail cannot be sent\. Set SMTP_FROM in the environment\./.test(text), text.slice(0, 300));
      expect(!b.some((x) => ["Save relay", "Replace relay", "Clear relay", "Send test email"].includes(x)) && cont, `buttons ${b} continue ${cont}`);
      expect(settings.data?.source === "env" && inv.status >= 400 && n === 0, `${JSON.stringify(settings.data)} invite ${inv.status} mails ${n}`);
      return `Opening Settings sent the Administrator to ${forced} (email setup is required while the wizard is open). The Outbound email step read "The deployment environment sets SMTP_URL but not SMTP_FROM, so mail cannot be sent. Set SMTP_FROM in the environment." Its buttons were ${JSON.stringify(b)}; Continue was disabled. GET /api/v1/email-settings answered ${JSON.stringify(settings.data)}. An invitation through the invite route answered ${inv.status} ("${inv.data?.detail}") and Mailpit received ${n} messages.`;
    },
    admin.page,
  );
  await step(
    A3,
    "administrator",
    "When outbound email is not configured, the sign-in pages do not offer Email me a sign-in link",
    "No Email me a sign-in link on the staff or Portal page",
    async () => {
      const out = await signInLinkOffered(app);
      const methods = await (await fetch(`${app}/api/v1/auth/methods`)).json();
      expect(Object.values(out).every((b) => !b.includes("Email me a sign-in link")) && methods.policy.legal.magicLink, JSON.stringify(out));
      return `With Email magic link on in both groups (${JSON.stringify(methods.policy.legal)}) and emailConfigured ${methods.emailConfigured}, the pages offered ${JSON.stringify(out)}.`;
    },
    admin.page,
  );
  await admin.ctx.close();
}

async function wizardEnv() {
  const { app, mail } = WIZ;
  const admin = await wizAdmin();
  await step(
    A3,
    "operator",
    "Deployment sets SMTP_URL and SMTP_FROM: the wizard step names the environment source and sender, with no relay form and no Send test email",
    "Environment message; no Save relay, Replace relay, Clear relay or Send test email; a save is refused",
    async () => {
      const { page } = admin;
      await emailStep(page, app);
      const text = await paneText(page);
      const b = await buttons(page);
      const put = await api(page, app, "PUT", "/api/v1/email-settings", {
        host: "mailpit",
        port: 1025,
        security: "none",
        authentication: { type: "none" },
        senderName: STORED_NAME,
        senderEmail: STORED_SENDER,
      });
      expect(/Outbound email is set by the deployment environment\. Mail is sent from DOC-030 Environment <env-relay@helix\.example>\./.test(text), text.slice(0, 300));
      expect(!b.some((x) => ["Save relay", "Replace relay", "Clear relay", "Send test email"].includes(x)), `buttons ${b}`);
      expect(put.status >= 400, `PUT ${put.status}`);
      return `The Outbound email step read "${text.match(/Outbound email is set by the deployment environment\.[^.]*\.[^.]*\./)?.[0]}". Its buttons were ${JSON.stringify(b)}. A direct save answered ${put.status}${put.data?.detail ? ` ("${put.data.detail}")` : ""}.`;
    },
    admin.page,
  );
  await step(
    A3,
    "operator",
    "Settings, Advanced, Outbound email with an environment relay: Managed by your deployment configuration; only Send test email; the test arrives from the environment sender, not the stored relay",
    "Managed message; Sender line; one button; test mail from env-relay@helix.example",
    async () => {
      const { page } = admin;
      await openSettingsPane(page, app, "Outbound email");
      const text = await paneText(page);
      const paneButtons = (await page.locator("main").getByRole("button").allInnerTexts()).map((x) => x.trim()).filter((x) => x && x !== "Advanced");
      const since = new Date(Date.now() - 1000);
      const test = await sendTest(page);
      const m = await latestMail(mail, WIZ_ADMIN.email, since, null);
      expect(/Managed by your deployment configuration\. Contact your system administrator to change the relay\./.test(text), text.slice(0, 300));
      expect(/Sender: DOC-030 Environment <env-relay@helix\.example>/.test(text), text.slice(0, 300));
      expect(m && m.from === ENV_SENDER && m.from !== STORED_SENDER, JSON.stringify(m && { from: m.from }));
      expect(!paneButtons.some((x) => ["Save relay", "Replace relay", "Clear relay"].includes(x)) && paneButtons.includes("Send test email"), `buttons ${paneButtons}`);
      return `The pane at ${new URL(page.url()).pathname} read "Managed by your deployment configuration. Contact your system administrator to change the relay." and "${text.match(/Sender: [^>]*>/)?.[0]}". Pane buttons: ${JSON.stringify(paneButtons)}. Send test email showed "${test}" and the message arrived from ${m.fromName} <${m.from}> although the stored relay (${STORED_SENDER}) was still saved.`;
    },
    admin.page,
  );
  await step(
    A3,
    "operator",
    "Invite your team from the wizard while the environment relay is active: the invitation arrives from the environment sender",
    "Set password email from env-relay@helix.example",
    async () => {
      const { page } = admin;
      await page.goto(`${app}/welcome?step=invites`);
      await page.getByRole("heading", { name: "Invite your team" }).first().waitFor();
      const since = new Date(Date.now() - 1000);
      await page.getByLabel("Name").fill("DOC-030 admin-org V-C37 pending colleague");
      await page.getByLabel("Email").fill(WIZ_PENDING);
      await page.getByRole("button", { name: "Send invite" }).click();
      const m = await latestMail(mail, WIZ_PENDING, since, SET_PASSWORD);
      expect(m && m.from === ENV_SENDER, JSON.stringify(m && { from: m.from }));
      return `The Invite your team step sent "${m.subject}" to ${WIZ_PENDING} from ${m.from}. The row stays pending for the resend check.`;
    },
    admin.page,
  );
  await step(
    A3,
    "administrator",
    "Finish the wizard with email configured; it does not reopen",
    "Skip optional steps completes setup; /welcome redirects",
    async () => {
      const { page } = admin;
      await page.goto(`${app}/welcome?step=welcome`);
      await page.getByRole("button", { name: "Skip optional steps" }).click();
      await page.waitForURL((u) => !u.pathname.startsWith("/welcome"), { timeout: 20000 });
      const landed = new URL(page.url()).pathname;
      await page.goto(`${app}/welcome`);
      await page.waitForLoadState("networkidle");
      const after = new URL(page.url()).pathname;
      expect(!after.startsWith("/welcome"), `after ${after}`);
      return `Skip optional steps on the Welcome step, with email configured, completed setup and went to ${landed}. Opening /welcome again went to ${after}.`;
    },
    admin.page,
  );
  await admin.ctx.close();
}

async function settingsIncomplete() {
  const { app, mail } = WIZ;
  const admin = await wizAdmin();
  await step(
    A3,
    "operator",
    "Settings, Advanced, Outbound email with SMTP_URL but no SMTP_FROM: the incomplete warning; Send test email unavailable",
    "Managed message and the SMTP_FROM warning; Send test email disabled",
    async () => {
      const { page } = admin;
      await openSettingsPane(page, app, "Outbound email");
      const text = await paneText(page);
      const test = page.getByRole("button", { name: "Send test email" });
      const disabled = await test.isDisabled();
      expect(/The deployment environment sets SMTP_URL but not SMTP_FROM, so mail cannot be sent\. Set SMTP_FROM in the environment\./.test(text) && disabled, `${text.slice(0, 300)} disabled ${disabled}`);
      return `The pane read "${text.slice(0, 260)}". Send test email was ${disabled ? "disabled" : "enabled"}.`;
    },
    admin.page,
  );
  await step(
    O,
    "administrator",
    "If OpenLaw cannot send email, Send invite and Resend invite show the not-sent message; no Invited row is added",
    `"The invite was not sent: this instance cannot send email." with both remedies`,
    async () => {
      const { page } = admin;
      await openUsers(page, app);
      const before = (await api(page, app, "GET", "/api/v1/users")).data.users.length;
      const newAddress = `doc030-wiz-nomail-${stamp}@helix.example`;
      const d = await invite(page, "DOC-030 admin-org V-C36 no mailer", newAddress, "Legal team member");
      const alert = (await d.getByRole("alert").innerText()).trim();
      await d.getByRole("button", { name: "Cancel" }).click();
      await openUsers(page, app);
      const added = await row(page, newAddress).count();
      await row(page, WIZ_PENDING).getByRole("button", { name: `Resend the invite to ${WIZ_PENDING}` }).click();
      const resend = await rowNote(page, WIZ_PENDING);
      const after = (await api(page, app, "GET", "/api/v1/users")).data.users.length;
      // The deployment sets SMTP_URL here, so the message names the environment fix.
      expect(alert === "The invite was not sent: this instance cannot send email. Set SMTP_URL and SMTP_FROM together in the environment.", alert);
      expect(/^The invite was not sent: this instance cannot send email\./.test(resend), resend);
      expect(added === 0 && before === after, `added ${added} ${before}->${after}`);
      return `With SMTP_URL set and SMTP_FROM empty, Send invite showed "${alert}" and no row was added (${before} users before and after). Resend invite on the pending row showed "${resend}".`;
    },
    admin.page,
  );
  await step(
    A3,
    "administrator",
    "When outbound email is not configured, the sign-in pages do not offer Email me a sign-in link (finished instance)",
    "No Email me a sign-in link",
    async () => {
      const out = await signInLinkOffered(app);
      expect(Object.values(out).every((b) => !b.includes("Email me a sign-in link")), JSON.stringify(out));
      return `The pages offered ${JSON.stringify(out)}.`;
    },
    admin.page,
  );
  await admin.ctx.close();
}

async function settingsStored() {
  const { app, mail } = WIZ;
  const admin = await wizAdmin();
  await step(
    A3,
    "operator",
    "Return to a stored relay: remove the environment override and restart; Settings shows the app relay and a test arrives from the stored sender",
    "No Managed message; Sender line names the stored relay; test mail from stored-relay@helix.example",
    async () => {
      const { page } = admin;
      await openSettingsPane(page, app, "Outbound email");
      const text = await paneText(page);
      const since = new Date(Date.now() - 1000);
      const test = await sendTest(page);
      const m = await latestMail(mail, WIZ_ADMIN.email, since, null);
      expect(!/Managed by your deployment configuration/.test(text) && /Sender: "?DOC-030 Stored"? <stored-relay@helix\.example>/.test(text), text.slice(0, 300));
      expect(m?.from === STORED_SENDER, JSON.stringify(m && { from: m.from }));
      return `After the override was removed and app and worker were recreated, the pane read "${text.slice(0, 160)}". Send test email showed "${test}" and the message came from ${m.fromName} <${m.from}>.`;
    },
    admin.page,
  );
  await step(
    A3,
    "administrator",
    "Settings, Advanced, Outbound email: Replace relay opens the same form empty; Cancel keeps the current relay; no Clear relay; a replacement applies to the next email without a restart",
    "Buttons Send test email and Replace relay; empty form; Cancel; saved change used by the next test",
    async () => {
      const { page } = admin;
      await openSettingsPane(page, app, "Outbound email");
      // The settings rail's Advanced disclosure sits in main too; it is not a pane button.
      const paneButtons = (await page.locator("main").getByRole("button").allInnerTexts()).map((x) => x.trim()).filter((x) => x && x !== "Advanced");
      const before = (await api(page, app, "GET", "/api/v1/email-settings")).data;
      await page.getByRole("button", { name: "Replace relay" }).click();
      const f = smtp(page);
      const form = { host: await f.host.inputValue(), senderEmail: await f.senderEmail.inputValue(), senderName: await f.senderName.inputValue(), username: await f.username.inputValue() };
      await page.getByRole("button", { name: "Cancel" }).click();
      const kept = (await api(page, app, "GET", "/api/v1/email-settings")).data;
      await page.getByRole("button", { name: "Replace relay" }).click();
      await fillRelay(page, { ...WORKING_RELAY, host: "mailpit:1025" });
      const refused = await emailNotice(page);
      const afterRefused = (await api(page, app, "GET", "/api/v1/email-settings")).data;
      await page.getByRole("button", { name: "Cancel" }).click();
      await page.getByRole("button", { name: "Replace relay" }).click();
      await fillRelay(page, { ...WORKING_RELAY, senderName: "DOC-030 Stored Replacement" });
      const saved = await emailNotice(page);
      const since = new Date(Date.now() - 1000);
      await sendTest(page);
      const m = await latestMail(mail, WIZ_ADMIN.email, since, null);
      await page.getByRole("button", { name: "Replace relay" }).click();
      await fillRelay(page, WORKING_RELAY);
      await emailNotice(page);
      expect(JSON.stringify(paneButtons) === JSON.stringify(["Send test email", "Replace relay"]), `buttons ${paneButtons}`);
      expect(Object.values(form).every((v) => v === "") && JSON.stringify(kept) === JSON.stringify(before), `${JSON.stringify(form)} ${JSON.stringify(kept)}`);
      expect(!/Relay saved/.test(refused.match ?? "") && JSON.stringify(afterRefused) === JSON.stringify(before), `${JSON.stringify(refused)} ${JSON.stringify(afterRefused)}`);
      expect(/Relay saved\./.test(saved.match ?? "") && m?.fromName === "DOC-030 Stored Replacement", `${JSON.stringify(saved)} ${JSON.stringify(m && { fromName: m.fromName })}`);
      return `Pane buttons were ${JSON.stringify(paneButtons)} (no Clear relay). Replace relay opened an empty form ${JSON.stringify(form)}; Cancel kept ${JSON.stringify(kept)}. SMTP server mailpit:1025 was refused (${JSON.stringify(refused)}) and the relay stayed. A replacement with Sender name "DOC-030 Stored Replacement" showed "${saved.match}", and the next test arrived from "${m.fromName}" with no restart. The original relay was saved again.`;
    },
    admin.page,
  );
  await step(
    O,
    "administrator",
    "If OpenLaw cannot send email and the deployment does not set it, the not-sent message names Settings, Advanced, Outbound email; saving a relay there fixes it",
    `"The invite was not sent: this instance cannot send email. Set up outbound email in Settings → Advanced → Outbound email."; after Save relay the resend arrives`,
    async () => {
      const { page } = admin;
      // Fixture: no relay saved. The Settings pane has no Clear relay, so the wizard's
      // clear request is sent through the API.
      const cleared = await api(page, app, "PUT", "/api/v1/email-settings", { smtpUrl: null, smtpFrom: null });
      await openUsers(page, app);
      const newAddress = `doc030-wiz-unset-${stamp}@helix.example`;
      const d = await invite(page, "DOC-030 admin-org V-C36 unset mailer", newAddress, "Legal team member");
      const alert = (await d.getByRole("alert").innerText()).trim();
      await d.getByRole("button", { name: "Cancel" }).click();
      await openSettingsPane(page, app, "Outbound email");
      const formShown = await smtp(page).host.count();
      await fillRelay(page, WORKING_RELAY);
      const saved = await emailNotice(page);
      const text = await paneText(page);
      await openUsers(page, app);
      const since = new Date(Date.now() - 1000);
      await row(page, WIZ_PENDING).getByRole("button", { name: `Resend the invite to ${WIZ_PENDING}` }).click();
      const note = await rowNote(page, WIZ_PENDING);
      const m = await latestMail(mail, WIZ_PENDING, since, SET_PASSWORD);
      expect(cleared.status === 200 && alert === "The invite was not sent: this instance cannot send email. Set up outbound email in Settings → Advanced → Outbound email.", `${cleared.status} ${alert}`);
      expect(formShown === 1 && /Relay saved\./.test(saved.match ?? "") && note === "Saved" && m?.from === STORED_SENDER, `${formShown} ${JSON.stringify(saved)} ${note} ${JSON.stringify(m && { from: m.from })}`);
      return `With no relay saved and no environment relay, Send invite showed "${alert}". Settings, Advanced, Outbound email showed the relay form; Save relay showed "${saved.match}" and the pane then read "${text.slice(0, 120)}". Resend invite on the pending row showed "${note}" and "${m.subject}" arrived from ${m.from}.`;
    },
    admin.page,
  );
  await admin.ctx.close();
}

async function guards() {
  const { app, mail } = WIZ;
  const admin = await wizAdmin();
  const colleague = { name: "DOC-030 admin-org V-C36 Jordan", email: `doc030-wiz-jordan-${stamp}@helix.example`, password: newPassword() };
  await step(
    O,
    "administrator",
    "Last Administrator safeguard: the only active Administrator cannot be demoted, and archiving that account is refused",
    `"You cannot demote the last Administrator." and "You cannot archive the last Administrator."`,
    async () => {
      const { page } = admin;
      await openUsers(page, app);
      await chooseRole(page, WIZ_ADMIN.email, "Legal team member");
      const t = await rowNote(page, WIZ_ADMIN.email);
      const me = await api(page, app, "GET", "/api/v1/me");
      const self = await rowState(page, WIZ_ADMIN.email);
      const archive = await api(page, app, "POST", `/api/v1/users/${me.data.user.id}/archive`);
      const admins = (await api(page, app, "GET", "/api/v1/users")).data.users.filter((u) => u.role === "administrator" && u.status !== "archived").length;
      expect(admins === 1 && t === "You cannot demote the last Administrator." && me.data.user.role === "administrator", `${admins} ${t} ${me.data.user.role}`);
      expect(archive.data?.detail === "You cannot archive the last Administrator." && !self.moreActions && !self.actions.includes("Archive"), `${archive.status} ${archive.data?.detail} ${JSON.stringify(self)}`);
      return `On auth2w ${WIZ_ADMIN.name} is the only active Administrator (${admins}). Choosing Legal team member on the own row showed "${t}" and the role stayed ${me.data.user.role}. The own row has no Archive and no … button, so the archive refusal was read from the archive route: ${archive.status} "${archive.data.detail}".`;
    },
    admin.page,
  );
  const c = await context();
  await step(
    O,
    "administrator",
    "Show archived appears once at least one account is archived; archive and restore a colleague",
    "No switch before; switch after; Restore returns the row to Active",
    async () => {
      const { page } = admin;
      await openUsers(page, app);
      const hadArchived = (await api(page, app, "GET", "/api/v1/users")).data.users.some((u) => u.status === "archived");
      const switchBefore = await page.getByRole("switch", { name: "Show archived" }).count();
      const since = new Date(Date.now() - 1000);
      const d = await invite(page, colleague.name, colleague.email, "Legal team member");
      await d.waitFor({ state: "hidden" });
      const m = await latestMail(mail, colleague.email, since, SET_PASSWORD);
      await setPasswordFromLink(c.page, m.link, colleague.password);
      await signIn(c.page, app, colleague.email, colleague.password);
      await openUsers(page, app);
      await row(page, colleague.email).getByRole("button", { name: `Archive ${colleague.email}` }).click();
      await row(page, colleague.email).waitFor({ state: "detached" });
      const switchAfter = await page.getByRole("switch", { name: "Show archived" }).count();
      const live = await api(c.page, app, "GET", "/api/v1/me");
      await page.getByRole("switch", { name: "Show archived" }).click();
      await row(page, colleague.email).getByRole("button", { name: `Restore ${colleague.email}` }).click();
      const note = await rowNote(page, colleague.email);
      const restored = await rowState(page, colleague.email);
      expect(!hadArchived && switchBefore === 0 && switchAfter === 1, `had ${hadArchived} before ${switchBefore} after ${switchAfter}`);
      expect(live.status === 401 && restored.status === "Active", `live ${live.status} ${JSON.stringify(restored)}`);
      return `With no archived accounts, the Users header had ${switchBefore} Show archived switch. After ${colleague.name} set a password, signed in and was archived, the switch appeared (${switchAfter}) and the colleague's session answered ${live.status}. Restore showed "${note}" and the row read ${restored.status}.`;
    },
    admin.page,
  );
  await c.ctx.close();
  await admin.ctx.close();
}

// ---- auth2: sign-in policy, domains, SSO, two-factor, instance address ----
// The auth2 sections share accounts, so they share one stamp (POLICY_STAMP).
const authStamp = process.env.POLICY_STAMP ?? stamp;
const authAccounts = {
  pending: `doc030-auth-pending-${authStamp}@helix.example`,
  offDomain: `doc030-auth-offdomain-${authStamp}@elsewhere.example`,
  ssoStaff: `doc030-auth-sso-${authStamp}@helix.example`,
  portalNew: `doc030-auth-portal-${authStamp}@northwind.example`,
  portalPassword: `doc030-auth-portal-pw-${authStamp}@northwind.example`,
  portalLate: `doc030-auth-portal-late-${authStamp}@northwind.example`,
  portalLateLink: `doc030-auth-portal-latelink-${authStamp}@northwind.example`,
  unapproved: `doc030-auth-unapproved-${authStamp}@unlisted.example`,
  uninvitedStaff: `doc030-auth-uninvited-${authStamp}@helix.example`,
  ssoBu: `doc030-auth-ssobu-${authStamp}@helix.example`,
  newcomer: `doc030-auth-newcomer-${authStamp}@helix.example`,
};
const authRegion = (page, name) => page.getByRole("region", { name });
async function openAuthentication(page, base = AUTH.app) {
  await openSettingsPane(page, base, "Authentication");
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
  return (await api(page, AUTH.app, "GET", "/api/v1/auth/methods")).data.policy;
}
async function domainsNow(page) {
  return (await api(page, AUTH.app, "GET", "/api/v1/auth/allowed-domains")).data.domains;
}
async function addDomain(page, domain) {
  await page.getByLabel("Allowed email domains").fill(domain);
  await authRegion(page, "Business Portal Authentication").getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: `Remove ${domain}` }).waitFor();
}
async function removeDomain(page, domain) {
  await page.getByRole("button", { name: `Remove ${domain}` }).click();
  await page.getByRole("button", { name: `Remove ${domain}` }).waitFor({ state: "detached" });
}
async function magicLinkFor(page, email, portal, since) {
  await requestMagicLink(page, AUTH.app, email, portal);
  return latestMail(AUTH.mail, email, since, MAGIC, 16);
}
async function passwordSetupRequest(page, email, portal = true) {
  await page.goto(`${AUTH.app}${portal ? "/portal/login" : "/auth/login"}`);
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
  await page.goto(`${AUTH.app}${portal ? "/portal/login" : "/auth/login"}`);
  await page.getByRole("heading", { level: 1 }).first().waitFor();
  await page.waitForLoadState("networkidle");
  const offered = await buttons(page);
  if (!(await page.getByLabel("Password", { exact: true }).count())) {
    const b = page.getByRole("button", { name: /Sign in with a password|Administrator sign-in/ }).first();
    // The page offers no password choice at all: record that as the outcome.
    if (!(await b.count())) {
      const me = await api(page, AUTH.app, "GET", "/api/v1/me");
      return { offered, outcome: "password-not-offered", alert: null, me: me.status, role: me.data?.user?.role, path: new URL(page.url()).pathname };
    }
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
  await page.waitForLoadState("networkidle");
  const me = await api(page, AUTH.app, "GET", "/api/v1/me");
  return { offered, outcome, alert, me: me.status, role: me.data?.user?.role, path: new URL(page.url()).pathname };
}
async function authAdmin() {
  const c = await context();
  await signIn(c.page, AUTH.app, DANIEL);
  return c;
}
const users = async (page) => (await api(page, AUTH.app, "GET", "/api/v1/users")).data.users;

async function policy() {
  const { app, mail } = AUTH;
  const admin = await authAdmin();
  results.identities = [
    { role: "administrator", account: "Daniel Okafor (seeded)" },
    { role: "legal_team_member", account: "Nadia Haddad (seeded)" },
    { role: "business_user", account: "Felix Brandt (seeded)" },
    ...Object.entries(authAccounts).map(([k, v]) => ({ key: k, account: v })),
  ];
  // A link for the expiry check, opened at the end of this section.
  const expiryCtx = await context();
  const expirySince = new Date(Date.now() - 1000);
  const expiryLink = await magicLinkFor(expiryCtx.page, "tom.iwu@helix.example", false, expirySince);
  const expiryIssued = Date.now();

  await step(
    A3,
    "administrator",
    "Open Settings, Advanced, Authentication: two policy cards with four switches; SSO unavailable before a provider is registered, with its help tooltip; the emergency password line",
    "Legal User Authentication and Business Portal Authentication; four labelled switches; SSO disabled; tooltip text",
    async () => {
      const { page } = admin;
      await openAuthentication(page);
      const out = {};
      for (const card of ["Legal User Authentication", "Business Portal Authentication"]) {
        out[card] = await authRegion(page, card)
          .getByRole("switch")
          .evaluateAll((els) => els.map((e) => `${document.querySelector(`label[for="${e.id}"]`)?.innerText}:${e.getAttribute("aria-checked")}${e.disabled ? ":disabled" : ""}`));
      }
      const legal = authRegion(page, "Legal User Authentication");
      const ssoRow = legal.locator("div", { has: page.getByText("Single sign-on (SSO)", { exact: true }) }).last();
      await ssoRow.getByRole("button", { name: "More information" }).focus();
      const tip = page.getByRole("dialog").or(page.locator("[data-radix-popper-content-wrapper]")).first();
      await tip.waitFor({ timeout: 5000 });
      const tooltip = (await tip.innerText()).trim();
      await page.keyboard.press("Escape");
      const recovery = (await legal.innerText()).includes("Administrators retain emergency password sign-in. Any required two-factor authentication still applies.");
      const labels = ["Email and password", "Email magic link", "Single sign-on (SSO)", "Require two-factor authentication"];
      for (const card of Object.keys(out)) {
        expect(JSON.stringify(out[card].map((x) => x.split(":")[0])) === JSON.stringify(labels), `${card} ${out[card]}`);
        expect(out[card][2].endsWith(":disabled"), `${card} SSO ${out[card][2]}`);
      }
      expect(tooltip === "Configure an identity provider below to enable single sign-on." && recovery, `tooltip "${tooltip}" recovery ${recovery}`);
      return `The rail's Advanced group expanded to Authentication (${new URL(page.url()).pathname}). Switches: ${JSON.stringify(out)}. The SSO help tooltip read "${tooltip}". The Legal card said "Administrators retain emergency password sign-in. Any required two-factor authentication still applies."`;
    },
    admin.page,
  );

  await step(
    A3,
    "administrator",
    "Keep at least one sign-in method on in each card: a policy with no method is refused",
    `"Enable at least one sign-in method." in both cards; stored policy unchanged`,
    async () => {
      const { page } = admin;
      const out = {};
      for (const card of ["Legal User Authentication", "Business Portal Authentication"]) {
        await openAuthentication(page);
        const first = await toggle(page, card, "Email magic link");
        const second = await toggle(page, card, "Email and password");
        const pol = await policyNow(page);
        await page.reload();
        await authRegion(page, card).waitFor();
        await toggle(page, card, "Email magic link");
        out[card] = { first, second, stored: card.startsWith("Legal") ? pol.legal : pol.business };
      }
      const after = await policyNow(page);
      expect(Object.values(out).every((x) => x.second === "Enable at least one sign-in method." && x.stored.password && !x.stored.magicLink), JSON.stringify(out));
      expect(after.legal.magicLink && after.legal.password && after.business.magicLink && after.business.password, JSON.stringify(after));
      return `Observed ${JSON.stringify(out)}. Email magic link was turned back on in both cards (${JSON.stringify(after)}).`;
    },
    admin.page,
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
      const adminResult = await passwordSignIn(a.page, DANIEL, PASSWORD);
      await a.ctx.close();
      const l = await context();
      const legalResult = await passwordSignIn(l.page, NADIA, PASSWORD);
      await l.ctx.close();
      await openAuthentication(page);
      await toggle(page, "Legal User Authentication", "Email and password");
      const after = await policyNow(page);
      expect(saved === "Saved" && adminResult.me === 200 && legalResult.me === 401 && after.legal.password, `admin ${JSON.stringify(adminResult)} legal ${JSON.stringify(legalResult)}`);
      return `With Email and password off ("${saved}"), the staff page offered ${JSON.stringify(adminResult.offered)}. Daniel (Administrator with a password) signed in with a password (me ${adminResult.me}, role ${adminResult.role}). Nadia (Legal Team Member) was refused: "${legalResult.alert ?? legalResult.outcome}" (me ${legalResult.me}). Email and password was turned back on.`;
    },
    admin.page,
  );

  await step(
    A3,
    "administrator",
    "Prepare staff: invite a pending Legal Team Member on helix.example, one on a domain that is not allowed, and one for single sign-on",
    "Three Invited rows",
    async () => {
      const { page } = admin;
      await openUsers(page, app);
      for (const [email, name] of [
        [authAccounts.pending, "DOC-030 admin-org V-C37 pending"],
        [authAccounts.offDomain, "DOC-030 admin-org V-C37 off-domain"],
        [authAccounts.ssoStaff, "DOC-030 admin-org V-C37 SSO staff"],
      ]) {
        const d = await invite(page, name, email, "Legal team member");
        await d.waitFor({ state: "hidden" });
      }
      await openUsers(page, app);
      const states = {};
      for (const e of [authAccounts.pending, authAccounts.offDomain, authAccounts.ssoStaff]) states[e] = (await rowState(page, e)).status;
      expect(Object.values(states).every((s) => s === "Invited"), JSON.stringify(states));
      return `Rows: ${JSON.stringify(states)}. Allowed domains: ${JSON.stringify(await domainsNow(page))}.`;
    },
    admin.page,
  );

  await step(
    A3,
    "administrator",
    "Email magic link: a pending staff invitation gets a sign-in link, even off the allowed domains; the first sign-in through a link activates it; the link expires in 5 minutes and works once",
    "Links arrive; sign-ins succeed as Legal team member; rows Active; a reused link fails",
    async () => {
      const out = [];
      let reuse;
      for (const email of [authAccounts.pending, authAccounts.offDomain]) {
        const c = await context();
        const since = new Date(Date.now() - 1000);
        const sent = await requestMagicLink(c.page, app, email);
        const m = await latestMail(mail, email, since, MAGIC, 16);
        expect(m, `no link for ${email}`);
        await c.page.goto(m.link);
        await c.page.waitForLoadState("networkidle");
        const me = await api(c.page, app, "GET", "/api/v1/me");
        out.push({ email, sent: sent.match(/It expires in 5 minutes and works once\./)?.[0] ?? sent.slice(0, 120), me: me.status, role: me.data?.user?.role, mailLine: /expires in 5 minutes and can be used once/.test(m.html) });
        await c.ctx.close();
        if (email === authAccounts.pending) {
          const r = await context();
          await r.page.goto(m.link);
          await r.page.waitForLoadState("networkidle");
          const rme = await api(r.page, app, "GET", "/api/v1/me");
          const rtext = (await r.page.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 200);
          reuse = { path: new URL(r.page.url()).pathname, me: rme.status, text: rtext };
          await r.ctx.close();
        }
      }
      await openUsers(admin.page, app);
      const states = {};
      for (const e of [authAccounts.pending, authAccounts.offDomain]) states[e] = (await rowState(admin.page, e)).status;
      expect(out.every((x) => x.me === 200 && x.role === "legal_team_member" && x.mailLine), JSON.stringify(out));
      expect(Object.values(states).every((s) => s === "Active"), JSON.stringify(states));
      expect(reuse.me === 401, JSON.stringify(reuse));
      return `Allowed domains held only helix.example. ${JSON.stringify(out)}. Rows after sign-in: ${JSON.stringify(states)}. Opening the spent link again in a new browser gave ${JSON.stringify(reuse)}.`;
    },
    admin.page,
  );

  await step(
    A3,
    "administrator",
    "A Business User who signs in on the staff sign-in page lands in the Portal",
    "Seeded Business User requests a link on /auth/login and lands under /portal",
    async () => {
      const c = await context();
      const since = new Date(Date.now() - 1000);
      const m = await magicLinkFor(c.page, "felix.brandt@helix.example", false, since);
      expect(m, "no link");
      await c.page.goto(m.link);
      await c.page.waitForURL((u) => u.pathname.startsWith("/portal"), { timeout: 20000 }).catch(() => {});
      await c.page.waitForLoadState("networkidle");
      const landed = new URL(c.page.url()).pathname;
      const me = await api(c.page, app, "GET", "/api/v1/me");
      await c.ctx.close();
      expect(landed.startsWith("/portal") && me.data?.user?.role === "business_user", `${landed} ${me.data?.user?.role}`);
      return `Felix Brandt requested a link on the staff sign-in page; opening it landed on ${landed} as ${me.data.user.role}.`;
    },
    admin.page,
  );

  await step(
    A3,
    "administrator",
    "Control Business Portal entry: Add northwind.example under Allowed email domains; Remove control; saved list survives reload",
    "Saved; Remove northwind.example; reload keeps it",
    async () => {
      const { page } = admin;
      await openAuthentication(page);
      await addDomain(page, "northwind.example");
      await page.reload();
      await page.getByRole("button", { name: "Remove northwind.example" }).waitFor();
      const domains = await domainsNow(page);
      expect(JSON.stringify(domains) === JSON.stringify(["helix.example", "northwind.example"]), JSON.stringify(domains));
      return `After Add, northwind.example appeared with a "Remove northwind.example" control and stayed after reload (${JSON.stringify(domains)}).`;
    },
    admin.page,
  );

  let portalSession;
  await step(
    A3,
    "administrator",
    "A new Portal entrant on an allowed domain gets a link and a Business User account; an unapproved address gets no sign-in link or password setup link and no account",
    "Allowed address becomes a Business User; unapproved address: neutral page, no mail, no account",
    async () => {
      portalSession = await context();
      const since = new Date(Date.now() - 1000);
      const m = await magicLinkFor(portalSession.page, authAccounts.portalNew, true, since);
      expect(m, "no link for allowed entrant");
      await portalSession.page.goto(m.link);
      await portalSession.page.waitForURL((u) => u.pathname.startsWith("/portal"), { timeout: 20000 });
      const me = await api(portalSession.page, app, "GET", "/api/v1/me");
      const u = await context();
      const since2 = new Date(Date.now() - 1000);
      const sent = await requestMagicLink(u.page, app, authAccounts.unapproved, true);
      await passwordSetupRequest(u.page, authAccounts.unapproved);
      await sleep(3000);
      const n = await countMail(mail, authAccounts.unapproved, since2);
      await u.ctx.close();
      const all = await users(admin.page);
      expect(me.data?.user?.role === "business_user" && n === 0 && !all.some((x) => x.email === authAccounts.unapproved), `role ${me.data?.user?.role}, mails ${n}`);
      return `${authAccounts.portalNew} got "${m.subject}", opened the Portal and is a ${me.data.user.role}. ${authAccounts.unapproved} saw "${sent.slice(0, 120)}" and the neutral password-setup confirmation, but Mailpit received ${n} messages and no account exists.`;
    },
    admin.page,
  );

  await step(
    A3,
    "administrator",
    "A Business User sets a password through the Portal password setup link and signs in with Email and password",
    "Password setup email; password sign-in reaches the Portal",
    async () => {
      const c = await context();
      const since = new Date(Date.now() - 1000);
      await passwordSetupRequest(c.page, authAccounts.portalPassword);
      const m = await latestMail(mail, authAccounts.portalPassword, since, SET_PASSWORD);
      expect(m, "no password setup mail");
      await setPasswordFromLink(c.page, m.link, AUTH_PASSWORD);
      const r = await passwordSignIn(c.page, authAccounts.portalPassword, AUTH_PASSWORD, true);
      await c.ctx.close();
      expect(r.me === 200 && r.role === "business_user", JSON.stringify(r));
      return `"${m.subject}" arrived, the password was set, and Email and password sign-in on the Portal page reached ${r.path} as ${r.role}.`;
    },
    admin.page,
  );

  await step(
    A3,
    "administrator",
    "Remove the domain: new accounts on it are refused, while existing Business Users keep signing in (new link, held session, earlier link, password)",
    "Existing BU gets a new link; session, earlier link and password still work; a new address gets no link; a new address refused at password setup completion and at link redemption; staff unaffected",
    async () => {
      const { page } = admin;
      const earlierCtx = await context();
      const earlier = await magicLinkFor(earlierCtx.page, authAccounts.portalNew, true, new Date(Date.now() - 1000));
      const lateCtx = await context();
      const since2 = new Date(Date.now() - 1000);
      await passwordSetupRequest(lateCtx.page, authAccounts.portalLate);
      const late = await latestMail(mail, authAccounts.portalLate, since2, SET_PASSWORD);
      const lateLinkCtx = await context();
      const lateLink = await magicLinkFor(lateLinkCtx.page, authAccounts.portalLateLink, true, new Date(Date.now() - 1000));
      expect(earlier && late && lateLink, "could not prepare earlier links");
      await openAuthentication(page);
      await removeDomain(page, "northwind.example");
      const obs = {};
      const since3 = new Date(Date.now() - 1000);
      const x = await context();
      await requestMagicLink(x.page, app, authAccounts.portalNew, true);
      const fresh = await latestMail(mail, authAccounts.portalNew, since3, MAGIC, 16);
      obs.existingNewLink = !!fresh;
      if (fresh) {
        await x.page.goto(fresh.link);
        await x.page.waitForLoadState("networkidle");
        obs.existingNewLinkMe = (await api(x.page, app, "GET", "/api/v1/me")).status;
      }
      await x.ctx.close();
      const since4 = new Date(Date.now() - 1000);
      const y = await context();
      await requestMagicLink(y.page, app, `doc030-auth-portal-after-${stamp}@northwind.example`, true);
      await sleep(3000);
      obs.newAddressLinks = await countMail(mail, `doc030-auth-portal-after-${stamp}@northwind.example`, since4);
      await y.ctx.close();
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
      obs.latePasswordSetup = (await lateCtx.page.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 200);
      await lateCtx.ctx.close();
      await lateLinkCtx.page.goto(lateLink.link);
      await lateLinkCtx.page.waitForLoadState("networkidle");
      const lu = new URL(lateLinkCtx.page.url());
      obs.lateLink = `${lu.pathname}${lu.searchParams.get("error") ? `?error=${lu.searchParams.get("error")}` : ""} me ${(await api(lateLinkCtx.page, app, "GET", "/api/v1/me")).status}: ${(await lateLinkCtx.page.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 160)}`;
      await lateLinkCtx.ctx.close();
      const s = await context();
      const staff = await magicLinkFor(s.page, authAccounts.pending, false, new Date(Date.now() - 1000));
      obs.staffLink = !!staff;
      await s.ctx.close();
      const all = await users(page);
      obs.lateAccounts = all.filter((u) => [authAccounts.portalLate, authAccounts.portalLateLink].includes(u.email)).length;
      await openAuthentication(page);
      await addDomain(page, "northwind.example");
      expect(obs.existingNewLink && obs.existingNewLinkMe === 200 && obs.newAddressLinks === 0 && obs.heldSession === 200 && obs.earlierLink.endsWith("me 200") && pwr.me === 200, JSON.stringify(obs));
      expect(obs.lateAccounts === 0 && /Password setup is no longer available for this address\./.test(obs.latePasswordSetup) && / me 401/.test(obs.lateLink) && obs.staffLink, JSON.stringify(obs));
      return `After Remove northwind.example: ${JSON.stringify(obs)}. The domain was added back.`;
    },
    admin.page,
  );

  await step(
    A3,
    "administrator",
    "With an empty list, the card shows the no-domains message; Invite user offers staff roles only; existing Business Users keep signing in",
    `"No domains allowed yet. New users must be invited individually."; two invite roles; existing BU password sign-in works`,
    async () => {
      const { page } = admin;
      await openAuthentication(page);
      const before = await domainsNow(page);
      for (const d of before) await removeDomain(page, d);
      const text = (await authRegion(page, "Business Portal Authentication").innerText()).replace(/\s+/g, " ");
      const message = text.includes("No domains allowed yet. New users must be invited individually.");
      const pw = await context();
      const pwr = await passwordSignIn(pw.page, authAccounts.portalPassword, AUTH_PASSWORD, true);
      await pw.ctx.close();
      await openUsers(page, app);
      await page.getByRole("button", { name: "Invite user" }).click();
      const dialog = page.getByRole("dialog", { name: "Invite user" });
      const radios = await dialog.getByRole("radio").evaluateAll((els) => els.map((e) => e.closest("label")?.innerText.trim()));
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await openAuthentication(page);
      for (const d of before) await addDomain(page, d);
      const after = await domainsNow(page);
      expect(message && pwr.me === 200 && JSON.stringify(radios) === JSON.stringify(["Legal team member", "Administrator"]), `${message} ${JSON.stringify(pwr)} ${radios}`);
      expect(JSON.stringify(after) === JSON.stringify(before), JSON.stringify(after));
      return `With every domain removed the card read "No domains allowed yet. New users must be invited individually." An existing Business User still signed in with a password (me ${pwr.me}). Invite user offered ${JSON.stringify(radios)}, so no Business User can be invited. The list was restored to ${JSON.stringify(after)}.`;
    },
    admin.page,
  );

  await step(
    A3,
    "administrator",
    "Turn off Email magic link under Business Portal Authentication: links sent earlier stop working; the Portal page offers other methods; a Business User with a password still signs in",
    "Earlier link gives no session; no magic-link choice; password sign-in works",
    async () => {
      const { page } = admin;
      const c = await context();
      const earlier = await magicLinkFor(c.page, "clara.fontaine@helix.example", true, new Date(Date.now() - 1000));
      await openAuthentication(page);
      const saved = await toggle(page, "Business Portal Authentication", "Email magic link");
      await c.page.goto(earlier.link);
      await c.page.waitForLoadState("networkidle");
      const me = await api(c.page, app, "GET", "/api/v1/me");
      const u = new URL(c.page.url());
      const landed = `${u.pathname}${u.search ? `?${[...u.searchParams.keys()].join("&")}` : ""}`;
      const landedText = (await c.page.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 200);
      await c.page.goto(`${app}/portal/login`);
      await c.page.getByRole("heading", { name: "Business Portal sign-in" }).waitFor();
      await c.page.waitForLoadState("networkidle");
      const portalButtons = await buttons(c.page);
      await c.ctx.close();
      const p = await context();
      const pwr = await passwordSignIn(p.page, authAccounts.portalPassword, AUTH_PASSWORD, true);
      await p.ctx.close();
      await openAuthentication(page);
      await toggle(page, "Business Portal Authentication", "Email magic link");
      const after = await policyNow(page);
      expect(me.status === 401 && !portalButtons.includes("Email me a sign-in link") && pwr.me === 200 && after.business.magicLink, `me ${me.status} buttons ${portalButtons} pw ${pwr.me}`);
      return `Turning off Email magic link showed "${saved}". Opening Clara Fontaine's link sent before the change landed on ${landed} with "${landedText}" and no session (me ${me.status}). The Portal sign-in page offered ${JSON.stringify(portalButtons)}. A Business User with a password still signed in (me ${pwr.me}). Email magic link was turned back on.`;
    },
    admin.page,
  );

  await step(
    A3,
    "administrator",
    "A sign-in link expires after 5 minutes",
    "A link opened more than 5 minutes after it was sent gives no session",
    async () => {
      const wait = expiryIssued + 5 * 60 * 1000 + 15000 - Date.now();
      if (wait > 0) await sleep(wait);
      await expiryCtx.page.goto(expiryLink.link);
      await expiryCtx.page.waitForLoadState("networkidle");
      const me = await api(expiryCtx.page, app, "GET", "/api/v1/me");
      const text = (await expiryCtx.page.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 200);
      const age = Math.round((Date.now() - expiryIssued) / 1000);
      expect(me.status === 401, `me ${me.status}`);
      return `A staff sign-in link for Tom Iwu opened ${age} seconds after it was sent landed on ${new URL(expiryCtx.page.url()).pathname} with "${text}" and no session (me ${me.status}).`;
    },
    expiryCtx.page,
  );
  await expiryCtx.ctx.close();
  await portalSession.ctx.close();
  await admin.ctx.close();
}

const OIDC_CONTROL = OIDC_IP ? `http://${OIDC_IP}:8081/identity` : null;
async function idpIdentity(sub, email, name) {
  const r = await fetch(OIDC_CONTROL, { method: "POST", body: JSON.stringify({ sub, email, name }) });
  return r.json();
}
async function ssoRoundTrip(portal, identity, keep = false) {
  await idpIdentity(...identity);
  const c = await context();
  const { page } = c;
  await page.goto(`${AUTH.app}${portal ? "/portal/login" : "/auth/login"}`);
  await page.getByRole("heading", { level: 1 }).first().waitFor();
  await page.waitForLoadState("networkidle");
  const start = page.url();
  await page.getByRole("button", { name: "Continue with single sign-on" }).click();
  await page
    .waitForURL(
      (u) =>
        u.href !== start &&
        u.host === new URL(AUTH.app).host &&
        !u.pathname.startsWith("/api/auth/sso") &&
        (!/\/(auth|portal)\/login$/.test(u.pathname) || u.searchParams.has("error")),
      { timeout: 30000 },
    )
    .catch(() => {});
  await page.waitForLoadState("networkidle");
  await sleep(500);
  const url = new URL(page.url());
  const me = await api(page, AUTH.app, "GET", "/api/v1/me");
  const alert = (await page.getByRole("alert").allInnerTexts().catch(() => [])).map((x) => x.trim()).filter(Boolean);
  const result = {
    path: url.pathname + (url.searchParams.get("error") ? `?error=${url.searchParams.get("error")}` : ""),
    me: me.status,
    role: me.data?.user?.role ?? null,
    twoFactorSetupRequired: me.data?.user?.twoFactorSetupRequired ?? null,
    alert,
  };
  if (keep) return { ...result, c };
  await c.ctx.close();
  return result;
}
async function providerNow(page) {
  return (await api(page, AUTH.app, "GET", "/api/v1/auth/sso-providers")).data;
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
  const { app } = AUTH;
  if (!OIDC_CONTROL) throw new Error("The auth2 OIDC fixture is not running");
  needAuthPassword();
  const admin = await authAdmin();
  const staffIdentity = ["doc030-idp-sso-staff", authAccounts.ssoStaff, "DOC-030 admin-org V-C37 SSO staff"];
  results.oidcFixture = `oauth2-mock-server 9.2.0 in container ${AUTH.project}-oidc-1 (${OIDC_IP}), issuer http://oidc:8080`;

  await step(
    A3,
    "administrator",
    "Configure single sign-on step 3 negative: Register provider with an issuer that cannot be reached",
    "Refused; nothing registered",
    async () => {
      const { page } = admin;
      await openAuthentication(page);
      const box = identityProvider(page);
      await box.getByLabel("Provider ID").fill("doc030-oidc");
      await box.getByLabel("Issuer URL").fill("http://doc030-unreachable-issuer.invalid:8080");
      await box.getByLabel("Email domain").fill("helix.example");
      await box.getByLabel("Client ID").fill("doc030-client");
      await box.getByLabel("Client secret").fill(`fixture-${stamp}`);
      await box.getByRole("button", { name: "Register provider" }).click();
      const note = await providerNote(page);
      const providers = await providerNow(page);
      expect(providers.providers.length === 0 && note !== "Saved", `note ${note}; ${JSON.stringify(providers)}`);
      return `Register provider with an unreachable issuer showed "${note}" and no provider was stored.`;
    },
    admin.page,
  );

  await step(
    A3,
    "operator",
    "Configure single sign-on steps 1, 3 and 4: the operator's OIDC client (local fixture); Register provider; copy the displayed callback URL; registration turns on nothing; the secret is never returned",
    "Saved; callback ends /api/auth/sso/callback on the instance address; SSO switches stay off but become available; Provider ID fixed",
    async () => {
      const { page } = admin;
      const box = identityProvider(page);
      await box.getByLabel("Issuer URL").fill("http://oidc:8080");
      await box.getByLabel("Client secret").fill(`fixture-${stamp}`);
      await box.getByRole("button", { name: "Register provider" }).click();
      const note = await providerNote(page);
      const callbackText = (await box.innerText()).match(/Paste this callback URL into your IdP console: \S+/)?.[0];
      const callback = (await box.locator("code").innerText()).trim();
      const pol = await policyNow(page);
      const providers = await providerNow(page);
      await page.reload();
      await identityProvider(page).waitFor();
      const idField = await identityProvider(page).getByLabel("Provider ID").count();
      const saveLabel = await identityProvider(page).getByRole("button", { name: "Save provider" }).count();
      const ssoSwitches = await page.getByRole("switch", { name: "Single sign-on (SSO)" }).evaluateAll((els) => els.map((e) => `${e.getAttribute("aria-checked")}${e.disabled ? ":disabled" : ""}`));
      const secretShown = JSON.stringify(providers).includes(`fixture-${stamp}`);
      expect(note === "Saved" && callback === `${app}/api/auth/sso/callback`, `note ${note}; callback ${callback}`);
      expect(!pol.legal.sso && !pol.business.sso && idField === 0 && saveLabel === 1 && !secretShown, `pol ${JSON.stringify(pol)} id ${idField} secret ${secretShown}`);
      expect(ssoSwitches.every((x) => x === "false"), `switches ${ssoSwitches}`);
      return `Register provider showed Saved and "${callbackText}". The instance address is BASE_URL ${app}. Both Single sign-on (SSO) switches stayed off and became available (${JSON.stringify(ssoSwitches)}). GET /api/v1/auth/sso-providers did not contain the client secret. After reload the Provider ID field was gone and the button read Save provider.`;
    },
    admin.page,
  );

  await step(
    A3,
    "administrator",
    "Configure single sign-on steps 5 and 6: turn on SSO under Legal User Authentication; in a separate browser an invited staff account signs in through the identity provider",
    "Callback succeeds; role Legal team member; the invited row becomes Active",
    async () => {
      const { page } = admin;
      await openAuthentication(page);
      const saved = await toggle(page, "Legal User Authentication", "Single sign-on (SSO)");
      const r = await ssoRoundTrip(false, staffIdentity);
      await openUsers(page, app);
      const state = await rowState(page, authAccounts.ssoStaff);
      expect(saved === "Saved" && r.me === 200 && r.role === "legal_team_member" && state.status === "Active", `${saved} ${JSON.stringify(r)} ${JSON.stringify(state)}`);
      return `The switch showed "${saved}". In a separate browser, Continue with single sign-on went through the fixture's authorize endpoint and the OpenLaw callback to ${r.path}, signed in as ${r.role}. The invited row now read ${state.status} with a role control (${state.roleControl}).`;
    },
    admin.page,
  );

  await step(
    A3,
    "administrator",
    "Matching an allowed email domain does not grant an uninvited person a staff role",
    "No staff session and no staff account",
    async () => {
      const r = await ssoRoundTrip(false, [`doc030-idp-uninvited-${stamp}`, authAccounts.uninvitedStaff, "DOC-030 admin-org V-C37 uninvited"]);
      const created = (await users(admin.page)).find((u) => u.email === authAccounts.uninvitedStaff);
      const pol = await policyNow(admin.page);
      expect(!["administrator", "legal_team_member"].includes(r.role) && !(created && created.role !== "business_user"), `${JSON.stringify(r)} ${JSON.stringify(created)}`);
      return `With Business Portal SSO ${pol.business.sso ? "on" : "off"} and helix.example on the allowed list, ${authAccounts.uninvitedStaff} ended on ${r.path} with me ${r.me}${r.alert.length ? ` and "${r.alert.join(" ")}"` : ""}. Account created: ${created ? created.role : "none"}.`;
    },
    admin.page,
  );

  await step(
    A3,
    "administrator",
    "Update a registered provider: Save provider with Client secret blank keeps it; a replacement rotates it; test a fresh sign-in after each",
    "Saved both times; SSO works after each; the Client secret help tooltip",
    async () => {
      const { page } = admin;
      await openAuthentication(page);
      const box = identityProvider(page);
      const secretLabel = box.locator("span", { has: page.getByText("Client secret", { exact: true }) }).last();
      await secretLabel.getByRole("button", { name: "More information" }).focus();
      const tip = page.locator("[data-radix-popper-content-wrapper]").first();
      await tip.waitFor({ timeout: 5000 });
      const hint = (await tip.innerText()).trim();
      await page.keyboard.press("Escape");
      await box.getByLabel("Client ID").fill(`doc030-client-${stamp}`);
      await box.getByRole("button", { name: "Save provider" }).click();
      const blank = await providerNote(page);
      const r1 = await ssoRoundTrip(false, staffIdentity);
      await page.reload();
      await identityProvider(page).getByLabel("Client secret").fill(`fixture-rotated-${stamp}`);
      await identityProvider(page).getByRole("button", { name: "Save provider" }).click();
      const rotated = await providerNote(page);
      const r2 = await ssoRoundTrip(false, staffIdentity);
      expect(hint === "Leave blank to keep the current secret. Paste a new value to rotate." && blank === "Saved" && rotated === "Saved" && r1.me === 200 && r2.me === 200, `hint ${hint} blank ${blank} rotated ${rotated} r1 ${JSON.stringify(r1)} r2 ${JSON.stringify(r2)}`);
      return `The Client secret help tooltip read "${hint}". Saving a Client ID change with a blank secret showed ${blank}; a fresh staff SSO sign-in worked (me ${r1.me}). Saving a replacement secret showed ${rotated}; another fresh sign-in worked (me ${r2.me}).`;
    },
    admin.page,
  );

  await step(
    A3,
    "administrator",
    "Update negative: an issuer that cannot be reached is refused and the previous provider configuration stays available",
    "Refused; stored issuer unchanged; SSO still works",
    async () => {
      const { page } = admin;
      await openAuthentication(page);
      const box = identityProvider(page);
      await box.getByLabel("Issuer URL").fill("http://doc030-unreachable-issuer.invalid:8080");
      await box.getByRole("button", { name: "Save provider" }).click();
      const note = await providerNote(page);
      const p = (await providerNow(page)).providers[0];
      const r = await ssoRoundTrip(false, staffIdentity);
      expect(note !== "Saved" && p.issuer === "http://oidc:8080" && r.me === 200, `note ${note} issuer ${p.issuer} ${JSON.stringify(r)}`);
      return `Save provider with an unreachable issuer showed "${note}". The stored issuer stayed ${p.issuer} and a fresh staff SSO sign-in still worked (me ${r.me}).`;
    },
    admin.page,
  );

  await step(
    A3,
    "administrator",
    "Turn on SSO under Business Portal Authentication: an existing Business User signs in through the identity provider, and still can after its domain is removed; a new identity on the removed domain is refused",
    "Portal before and after narrowing; newcomer refused with no account",
    async () => {
      const { page } = admin;
      const c = await context();
      const m = await magicLinkFor(c.page, authAccounts.ssoBu, true, new Date(Date.now() - 1000));
      expect(m, "no Portal link for the helix.example Business User");
      await c.page.goto(m.link);
      await c.page.waitForURL((u) => u.pathname.startsWith("/portal"), { timeout: 20000 });
      await c.ctx.close();
      await openAuthentication(page);
      const saved = await toggle(page, "Business Portal Authentication", "Single sign-on (SSO)");
      const identity = [`doc030-idp-bu-${stamp}`, authAccounts.ssoBu, "DOC-030 admin-org V-C37 Portal BU"];
      const first = await ssoRoundTrip(true, identity);
      await removeDomain(page, "helix.example");
      const domains = await domainsNow(page);
      const afterRemoval = await ssoRoundTrip(true, identity);
      const refused = await ssoRoundTrip(true, [`doc030-idp-newcomer-${stamp}`, authAccounts.newcomer, "DOC-030 admin-org V-C37 newcomer"]);
      const created = (await users(page)).find((u) => u.email === authAccounts.newcomer);
      await openAuthentication(page);
      await page.getByLabel("Allowed email domains").fill("helix.example");
      await authRegion(page, "Business Portal Authentication").getByRole("button", { name: "Add", exact: true }).click();
      await page.getByRole("button", { name: "Remove helix.example" }).waitFor();
      expect(first.me === 200 && first.role === "business_user" && first.path.startsWith("/portal"), `first ${JSON.stringify(first)}`);
      expect(afterRemoval.me === 200 && afterRemoval.role === "business_user", `after removal ${JSON.stringify(afterRemoval)}`);
      expect(refused.me === 401 && !created, `newcomer ${JSON.stringify(refused)} ${JSON.stringify(created)}`);
      return `${authAccounts.ssoBu} entered the Portal through a sign-in link. The Business Portal SSO switch showed "${saved}". Portal single sign-on for that Business User reached ${first.path} as ${first.role}. After Remove helix.example (list ${JSON.stringify(domains)}), the same identity still signed in through single sign-on (${afterRemoval.path}, ${afterRemoval.role}). A new identity on the removed domain ended on ${refused.path}${refused.alert.length ? ` with "${refused.alert.join(" ")}"` : ""} and no account was created. helix.example was added back.`;
    },
    admin.page,
  );

  await step(
    A3,
    "administrator",
    "Recover: with only SSO on under Legal, Administrator password sign-in still works; turn on Email and password and turn off SSO",
    "Admin password sign-in works; Legal Team Member password sign-in works again; SSO off",
    async () => {
      const { page } = admin;
      await openAuthentication(page);
      await toggle(page, "Legal User Authentication", "Email magic link");
      await toggle(page, "Legal User Authentication", "Email and password");
      const pol1 = await policyNow(page);
      const a = await context();
      const adminResult = await passwordSignIn(a.page, DANIEL, PASSWORD);
      await a.ctx.close();
      await openAuthentication(page);
      await toggle(page, "Legal User Authentication", "Email and password");
      await toggle(page, "Legal User Authentication", "Email magic link");
      await toggle(page, "Legal User Authentication", "Single sign-on (SSO)");
      await toggle(page, "Business Portal Authentication", "Single sign-on (SSO)");
      const pol2 = await policyNow(page);
      const l = await context();
      const legalResult = await passwordSignIn(l.page, NADIA, PASSWORD);
      await l.ctx.close();
      expect(pol1.legal.sso && !pol1.legal.password && !pol1.legal.magicLink && adminResult.me === 200, `${JSON.stringify(pol1.legal)} ${JSON.stringify(adminResult)}`);
      expect(pol2.legal.password && !pol2.legal.sso && !pol2.business.sso && legalResult.me === 200, `${JSON.stringify(pol2)} ${JSON.stringify(legalResult)}`);
      return `With only Single sign-on (SSO) on for Legal users (${JSON.stringify(pol1.legal)}), the staff page offered ${JSON.stringify(adminResult.offered)} and Daniel still signed in with a password (me ${adminResult.me}). Turning Email and password and Email magic link back on and SSO off in both cards gave ${JSON.stringify(pol2)}, and Nadia signed in with a password again (me ${legalResult.me}).`;
    },
    admin.page,
  );
  await admin.ctx.close();
}

async function twoFactor() {
  const { app, mail } = AUTH;
  needAuthPassword();
  const tfaAdmin = { name: "DOC-030 admin-org V-C37 2FA admin", email: `doc030-auth-2fa-${stamp}@helix.example` };
  const daniel = await authAdmin();
  let uri = null;
  const admin = await context();
  await step(
    A3,
    "administrator",
    "Prepare a disposable Administrator with a password and no authenticator",
    "Invited as Administrator; password set",
    async () => {
      await openUsers(daniel.page, app);
      const since = new Date(Date.now() - 1000);
      const d = await invite(daniel.page, tfaAdmin.name, tfaAdmin.email, "Administrator");
      await d.waitFor({ state: "hidden" });
      const m = await latestMail(mail, tfaAdmin.email, since, SET_PASSWORD);
      await setPasswordFromLink(admin.page, m.link, AUTH_PASSWORD);
      await signIn(admin.page, app, tfaAdmin.email, AUTH_PASSWORD);
      const me = await api(admin.page, app, "GET", "/api/v1/me");
      expect(me.data?.user?.role === "administrator", JSON.stringify(me.data?.user?.role));
      return `${tfaAdmin.name} was invited as Administrator, set a password and signed in (${me.data.user.role}).`;
    },
    admin.page,
  );

  await step(
    A3,
    "administrator",
    "Turn on Require two-factor authentication under Legal User Authentication as an Administrator with no authenticator: OpenLaw asks for set-up before continuing",
    "Enrolment page with the organization requirement; API refused until enrolment; enrolment reaches the app",
    async () => {
      const { page } = admin;
      await openAuthentication(page);
      const before = (await (await fetch(`${app}/api/v1/auth/methods`)).json()).policy.legal;
      await authRegion(page, "Legal User Authentication").getByRole("switch", { name: "Require two-factor authentication" }).click();
      await page.waitForURL((u) => u.pathname.startsWith("/auth/two-factor/enroll"), { timeout: 15000 });
      const pol = (await (await fetch(`${app}/api/v1/auth/methods`)).json()).policy.legal;
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
      await page.getByRole("link", { name: "Done" }).or(page.getByRole("button", { name: "Done" })).first().click();
      await page.waitForURL((u) => !u.pathname.startsWith("/auth/two-factor"), { timeout: 15000 }).catch(() => {});
      await page.waitForLoadState("networkidle");
      const allowed = await api(page, app, "GET", "/api/v1/auth/allowed-domains");
      expect(!before.requireTwoFactor && pol.requireTwoFactor, `policy ${JSON.stringify(before)} -> ${JSON.stringify(pol)}`);
      expect(required === 1 && blocked.status === 403 && allowed.status === 200, `${required} ${blocked.status} ${allowed.status}`);
      return `Require two-factor authentication was off. Selecting it under Legal User Authentication saved it on and took the Administrator to /auth/two-factor/enroll with "Your organization requires two-factor authentication."; an admin API call answered ${blocked.status} ("${blocked.data?.detail}"). After Turn on two-factor, a code, Confirm and Done, the Administrator reached ${new URL(page.url()).pathname} and the same API answered ${allowed.status}.`;
    },
    admin.page,
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
      await page.getByLabel("Email", { exact: true }).fill(tfaAdmin.email);
      await page.getByLabel("Password", { exact: true }).fill(AUTH_PASSWORD);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.waitForURL((u) => u.pathname.startsWith("/auth/two-factor"), { timeout: 15000 });
      const prompt = await page.getByText("Enter the 6-digit code from your authenticator app.").count();
      const before = await api(page, app, "GET", "/api/v1/users");
      await page.getByLabel("Code").fill(totp(uri));
      await page.getByRole("button", { name: "Verify" }).click();
      await page.waitForURL((u) => !u.pathname.startsWith("/auth/"), { timeout: 15000 });
      const after = await api(page, app, "GET", "/api/v1/users");
      await c.ctx.close();
      expect(prompt === 1 && before.status !== 200 && after.status === 200, `${prompt} ${before.status} ${after.status}`);
      return `A fresh password sign-in went to /auth/two-factor with "Enter the 6-digit code from your authenticator app." Before the code an admin API call answered ${before.status}; after Verify it answered ${after.status}.`;
    },
    admin.page,
  );

  await step(
    A3,
    "administrator",
    "Required two-factor authentication applies to email magic links and to single sign-on, and to Administrator emergency password sign-in",
    "Magic-link and SSO sign-ins of staff without an authenticator are sent to set-up; Daniel's password sign-in with Email and password off is sent to set-up",
    async () => {
      const out = {};
      const c = await context();
      const m = await magicLinkFor(c.page, authAccounts.offDomain, false, new Date(Date.now() - 1000));
      expect(m, "no magic link");
      await c.page.goto(m.link);
      await c.page.waitForLoadState("networkidle");
      await c.page.goto(`${app}/`);
      await c.page.waitForLoadState("networkidle");
      out.magicLink = { path: new URL(c.page.url()).pathname, work: (await api(c.page, app, "GET", "/api/v1/matters")).status };
      await c.ctx.close();
      await openAuthentication(admin.page);
      await toggle(admin.page, "Legal User Authentication", "Single sign-on (SSO)");
      const s = await ssoRoundTrip(false, ["doc030-idp-sso-staff", authAccounts.ssoStaff, "DOC-030 admin-org V-C37 SSO staff"], true);
      await s.c.page.goto(`${app}/`);
      await s.c.page.waitForLoadState("networkidle");
      out.sso = { callback: s.path, me: s.me, setupRequired: s.twoFactorSetupRequired, path: new URL(s.c.page.url()).pathname, work: (await api(s.c.page, app, "GET", "/api/v1/matters")).status };
      await s.c.ctx.close();
      await openAuthentication(admin.page);
      await toggle(admin.page, "Legal User Authentication", "Single sign-on (SSO)");
      await toggle(admin.page, "Legal User Authentication", "Email and password");
      const d = await context();
      const dr = await passwordSignIn(d.page, DANIEL, PASSWORD);
      out.emergencyPassword = { path: dr.path, work: (await api(d.page, app, "GET", "/api/v1/users")).status };
      await d.ctx.close();
      await openAuthentication(admin.page);
      await toggle(admin.page, "Legal User Authentication", "Email and password");
      const pol = await policyNow(admin.page);
      expect(out.magicLink.path.startsWith("/auth/two-factor/enroll") && out.magicLink.work !== 200, JSON.stringify(out));
      expect(out.sso.path.startsWith("/auth/two-factor/enroll") && out.sso.work !== 200, JSON.stringify(out));
      expect(out.emergencyPassword.path.startsWith("/auth/two-factor") && out.emergencyPassword.work !== 200 && pol.legal.password && !pol.legal.sso, JSON.stringify(out));
      return `Observed ${JSON.stringify(out)}. Legal SSO was turned off and Email and password turned back on (${JSON.stringify(pol.legal)}).`;
    },
    admin.page,
  );

  await step(
    A3,
    "administrator",
    "Turn off Require two-factor authentication",
    "Policy saved off",
    async () => {
      const { page } = admin;
      await openAuthentication(page);
      const saved = await toggle(page, "Legal User Authentication", "Require two-factor authentication");
      const pol = await policyNow(page);
      expect(saved === "Saved" && !pol.legal.requireTwoFactor, `${saved} ${JSON.stringify(pol.legal)}`);
      return `The switch showed "${saved}" (${JSON.stringify(pol.legal)}). The disposable Administrator's authenticator stays enrolled.`;
    },
    admin.page,
  );
  await daniel.ctx.close();
  await admin.ctx.close();
}

async function crossPage() {
  const { app } = AUTH;
  needAuthPassword();
  const admin = await authAdmin();
  // Fixture reset: start from the lab's default policy (every method on, no 2FA).
  const start = await policyNow(admin.page);
  results.startPolicy = start;
  for (const group of ["legal", "business"]) {
    const want = { password: true, magicLink: true, sso: false, requireTwoFactor: false };
    if (JSON.stringify(start[group]) !== JSON.stringify(want))
      await api(admin.page, app, "PATCH", `/api/v1/auth/policy/${group}`, want);
  }
  results.resetPolicy = await policyNow(admin.page);
  await step(
    A3,
    "administrator",
    "OpenLaw checks the account's actual role, whichever sign-in page the person opened",
    "With Legal password sign-in off, a Legal Team Member is refused on the Portal page too; a Business User with a password signs in on the staff page and lands in the Portal",
    async () => {
      const { page } = admin;
      await openAuthentication(page);
      const off = await toggle(page, "Legal User Authentication", "Email and password");
      const l = await context();
      const legalOnPortal = await passwordSignIn(l.page, NADIA, PASSWORD, true);
      await l.ctx.close();
      const b = await context();
      const buOnStaff = await passwordSignIn(b.page, authAccounts.portalPassword, AUTH_PASSWORD, false);
      await b.ctx.close();
      await openAuthentication(page);
      await toggle(page, "Legal User Authentication", "Email and password");
      const pol = await policyNow(page);
      expect(off === "Saved" && legalOnPortal.me === 401 && buOnStaff.me === 200 && buOnStaff.role === "business_user" && buOnStaff.path.startsWith("/portal") && pol.legal.password, `${off} ${JSON.stringify(legalOnPortal)} ${JSON.stringify(buOnStaff)}`);
      return `With Email and password off under Legal User Authentication, Nadia's password sign-in on the Business Portal page was refused ("${legalOnPortal.alert ?? legalOnPortal.outcome}"; me ${legalOnPortal.me}). A Business User's password sign-in on the staff page succeeded and landed on ${buOnStaff.path} (${buOnStaff.role}). Legal password sign-in was turned back on.`;
    },
    admin.page,
  );
  await step(
    A3,
    "administrator",
    "Business Users sign in only with the methods enabled under Business Portal Authentication",
    "With Business Email and password off, a Business User with a password is refused on the Portal and staff pages; a sign-in link still works",
    async () => {
      const { page } = admin;
      await openAuthentication(page);
      const off = await toggle(page, "Business Portal Authentication", "Email and password");
      const a = await context();
      const onPortal = await passwordSignIn(a.page, authAccounts.portalPassword, AUTH_PASSWORD, true);
      await a.ctx.close();
      const b = await context();
      const onStaff = await passwordSignIn(b.page, authAccounts.portalPassword, AUTH_PASSWORD, false);
      await b.ctx.close();
      const c = await context();
      const link = await magicLinkFor(c.page, authAccounts.portalPassword, true, new Date(Date.now() - 1000));
      await c.page.goto(link.link);
      await c.page.waitForURL((u) => u.pathname.startsWith("/portal"), { timeout: 20000 }).catch(() => {});
      const viaLink = (await api(c.page, AUTH.app, "GET", "/api/v1/me")).data?.user?.role;
      await c.ctx.close();
      await openAuthentication(page);
      await toggle(page, "Business Portal Authentication", "Email and password");
      const pol = await policyNow(page);
      expect(off === "Saved" && onPortal.me === 401 && onPortal.outcome === "password-not-offered" && onStaff.me === 401 && onStaff.outcome === "alert" && viaLink === "business_user" && pol.business.password, `${off} ${JSON.stringify(onPortal)} ${JSON.stringify(onStaff)} ${viaLink}`);
      return `With Email and password off under Business Portal Authentication ("${off}"), the Portal page offered only ${JSON.stringify(onPortal.offered)}, with no password choice. On the staff page, where Legal users still have a password form, the Business User's password sign-in was refused with "${onStaff.alert}" (me ${onStaff.me}). A sign-in link still signed the same person in as ${viaLink}. Business password sign-in was turned back on.`;
    },
    admin.page,
  );
  await admin.ctx.close();
}

async function instanceField(page, base = AUTH.app) {
  await openSettingsPane(page, base, "Instance address");
  await page.getByLabel("Application address").waitFor();
  const text = await paneText(page);
  const field = page.getByLabel("Application address");
  return {
    text,
    summary: [
      text.match(/Application address (Default|Saved in OpenLaw|Deployment configuration)( · Read only)?/)?.[0],
      text.match(/Active: \S+/)?.[0],
      text.match(/Saved changes are waiting for a restart\.[^.]*\./)?.[0],
    ]
      .filter(Boolean)
      .join("; "),
    value: (await field.count()) ? await field.inputValue() : null,
    readOnly: (await field.count()) ? (await field.getAttribute("readonly")) !== null || (await field.isDisabled()) : null,
  };
}
async function callbackNow(page, base = AUTH.app) {
  await openAuthentication(page, base);
  const box = identityProvider(page);
  await box.getByLabel("Client ID").fill(`doc030-client-cb-${Date.now().toString(36)}`);
  await box.getByRole("button", { name: "Save provider" }).click();
  const note = await providerNote(page);
  return { note, callback: note === "Saved" ? (await box.locator("code").innerText()).trim() : null };
}

async function instancePinned() {
  const admin = await authAdmin();
  await step(
    A3,
    "operator",
    "Instance address set by the deployment: Application address shows Deployment configuration and Read only; the SSO callback uses it",
    "Deployment configuration; Read only; active BASE_URL; callback on it",
    async () => {
      const f = await instanceField(admin.page);
      const cb = await callbackNow(admin.page);
      expect(/Deployment configuration/.test(f.text) && /Read only/.test(f.text) && cb.callback === `${AUTH.app}/api/auth/sso/callback`, `${f.text.slice(0, 400)} ${JSON.stringify(cb)}`);
      return `Settings, Advanced, Instance address showed "${f.summary}" (field value ${f.value}, read-only ${f.readOnly}). Save provider then showed the callback ${cb.callback}.`;
    },
    admin.page,
  );
  await admin.ctx.close();
}

async function instanceSaved() {
  // With BASE_URL unset the API falls back to http://localhost:3000 and refuses
  // requests from any other origin. An Administrator therefore reaches the instance
  // at that address: a second browser maps localhost:3000 to this lab's port.
  const DEFAULT_ADDRESS = "http://localhost:3000";
  const mappedBrowser = await chromium.launch({
    args: [`--host-resolver-rules=MAP localhost:3000 127.0.0.1:${new URL(AUTH.app).port}`],
  });
  const mctx = await mappedBrowser.newContext({ viewport: { width: 1440, height: 1000 } });
  const admin = { ctx: mctx, page: await mctx.newPage() };
  const phase = (...names) => {
    const out = execFileSync(path.join(here, "phase.sh"), ["auth2", ...names], { encoding: "utf8" });
    return out.trim().split("\n").pop();
  };
  await step(
    A3,
    "operator",
    "The operator removes BASE_URL from the deployment and restarts; Application address becomes editable and the API falls back to its default",
    "Field editable with source Default; sign-in works only at the default address",
    async () => {
      const note = phase("baseurl-unset");
      await sleep(2000);
      const anon = await context();
      await anon.page.goto(`${AUTH.app}/auth/login`);
      await anon.page.getByLabel("Email", { exact: true }).fill(NADIA);
      await anon.page.getByLabel("Password", { exact: true }).fill(PASSWORD);
      await anon.page.getByRole("button", { name: "Sign in", exact: true }).click();
      await sleep(4000);
      const me = await api(anon.page, AUTH.app, "GET", "/api/v1/me");
      const alert = (await anon.page.getByRole("alert").allInnerTexts()).map((x) => x.trim()).filter(Boolean);
      await anon.ctx.close();
      await signIn(admin.page, DEFAULT_ADDRESS, DANIEL);
      const f = await instanceField(admin.page, DEFAULT_ADDRESS);
      expect(me.status === 401 && !f.readOnly && /Application address Default/.test(f.text) && f.value === DEFAULT_ADDRESS, `me ${me.status} ${f.text.slice(0, 300)} value ${f.value} ro ${f.readOnly}`);
      return `${note}. A password sign-in at ${AUTH.app} got me ${me.status}${alert.length ? ` with "${alert.join(" ")}"` : ""}. At ${DEFAULT_ADDRESS} Daniel signed in, and Instance address showed "${f.summary}" (field value "${f.value}", read-only ${f.readOnly}).`;
    },
    admin.page,
  );
  await step(
    A3,
    "administrator",
    "An Administrator saves Application address; it waits for a restart of the API and worker",
    "Save shows the restart notice and the pending notice; the callback still uses the old address",
    async () => {
      const { page } = admin;
      await instanceField(page, DEFAULT_ADDRESS);
      await page.getByLabel("Application address").fill(AUTH.app);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      const notice = await page
        .getByText("Settings saved. Restart the API and worker to apply changes.")
        .innerText({ timeout: 15000 })
        .then((t) => t.trim())
        .catch(async () => (await page.locator("main").getByRole("alert").allInnerTexts()).join(" | "));
      expect(notice === "Settings saved. Restart the API and worker to apply changes.", `save answered "${notice}"`);
      const after = await instanceField(page, DEFAULT_ADDRESS);
      const cb = await callbackNow(page, DEFAULT_ADDRESS);
      expect(/Saved changes are waiting for a restart/.test(after.text) && cb.callback === `${DEFAULT_ADDRESS}/api/auth/sso/callback`, `${after.text.slice(0, 300)} ${JSON.stringify(cb)}`);
      return `Entering ${AUTH.app} and Save showed "${notice}" The pane then showed "${after.summary}" (field value "${after.value}"). Before the restart, Save provider showed the callback ${cb.callback}.`;
    },
    admin.page,
  );
  await step(
    A3,
    "operator",
    "After the API and worker restart, the saved Application address is active: new sign-ins and the SSO callback use it",
    "Saved in OpenLaw; sign-in at the saved address works; callback on it",
    async () => {
      const note = phase("baseurl-unset");
      await sleep(2000);
      const c = await context();
      await signIn(c.page, AUTH.app, DANIEL);
      const f = await instanceField(c.page);
      const cb = await callbackNow(c.page);
      await c.ctx.close();
      expect(/Application address Saved in OpenLaw/.test(f.text) && f.value === AUTH.app && cb.callback === `${AUTH.app}/api/auth/sso/callback`, `${f.text.slice(0, 300)} ${f.value} ${JSON.stringify(cb)}`);
      return `${note}. A password sign-in at ${AUTH.app} worked again. Instance address showed "${f.summary}" (field value "${f.value}"). Save provider showed the callback ${cb.callback}.`;
    },
  );
  await mappedBrowser.close();
}


function merge() {
  const dir = path.join(here, "runs");
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : [];
  const latest = {};
  for (const f of files) latest[f.replace(/-\d{4}-\d\d-\d\dT.*$/, "")] = f;
  const order = Object.keys(SECTION_LAB);
  const runs = order
    .filter((s) => latest[s])
    .map((s) => ({ file: `runs/${latest[s]}`, ...JSON.parse(readFileSync(path.join(dir, latest[s]))) }));
  const steps = runs.flatMap((r) =>
    r.steps.map((s) => ({ section: r.section, phase: r.phase, ...s })),
  );
  const out = {
    batch: "DOC-030",
    group: "admin-org",
    reviewer: "DOC-030 independent walkthrough agent (admin-org)",
    reviewerKind: "agent",
    appCommit: "067c1646829df85e62b809ee9157921e867c84e7",
    labs: [WORK, AUTH, WIZ].map((l) => ({
      name: l.name,
      project: l.project,
      appUrl: l.app,
      mailUrl: l.mail,
      appImageId: l.appImageId,
      engineImageId: l.engineImageId,
    })),
    articleHashes: { [O]: articleHash(O), [A3]: articleHash(A3) },
    sections: runs.map((r) => ({
      section: r.section,
      lab: r.labName,
      phase: r.phase,
      file: r.file,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      steps: r.steps.length,
      failed: r.steps.filter((s) => s.result !== "pass").length,
    })),
    counts: {
      steps: steps.length,
      pass: steps.filter((s) => s.result === "pass").length,
      fail: steps.filter((s) => s.result !== "pass").length,
    },
    productBugs: [],
    guideFailures: [],
    steps,
  };
  const prior = path.join(here, "walkthrough.json");
  if (existsSync(prior)) {
    const old = JSON.parse(readFileSync(prior));
    out.productBugs = old.productBugs ?? [];
    out.guideFailures = old.guideFailures ?? [];
    out.limitations = old.limitations ?? [];
  }
  writeFileSync(prior, JSON.stringify(out, null, 2) + "\n");
  console.log(`${out.counts.steps} steps, ${out.counts.fail} failed -> walkthrough.json`);
}

try {
  const sections = {
    org,
    wizardStored,
    wizardIncomplete,
    wizardEnv,
    settingsIncomplete,
    settingsStored,
    guards,
    policy,
    sso,
    twoFactor,
    crossPage,
    instancePinned,
    instanceSaved,
  };
  const fn = sections[section];
  if (!fn) throw new Error(`Unknown section ${section}`);
  await fn();
} finally {
  save();
  await browser.close();
  const failed = results.steps.filter((s) => s.result !== "pass").length;
  console.log(`${results.steps.length} steps, ${failed} not passed -> ${outFile}`);
}
