// DOC-032 bridge replay of the admin-org walkthrough.
// This file is a copy of DOC-032/admin-org/walkthrough.mjs, replayed by the
// DOC-032 compatibility reviewer (bridge) on labs built from the release
// candidate ad345da5842c22b7d1012bf9f5d7d12dfdb4e496. No step, selector, check or
// expected text changed. What was adapted, and nothing else:
//   - helpers import from ./admin-org-replay/lib.mjs; lib.mjs, phase.sh and run.sh
//     there resolve the repository root one folder deeper;
//   - lab manifest names: firstrun -> bfr, aowiz -> bwiz, aoauth -> bao (labInfo,
//     overlayValue, the phase.sh call in instanceSaved, two error messages and
//     two result sentences); phase.sh and run.sh accept bfr, bwiz and bao only;
//     overlay-oidc.json starts the copied oidc-fixture.mjs;
//   - the seat label is "DOC-032 compatibility reviewer (bridge)";
//   - fixture record names "DOC-032 admin-org ..." are "DOC-032 bridge ...", and
//     throwaway account prefixes doc032-org-, doc032-wiz-, doc032-auth- are
//     doc032-bridge-org-, doc032-bridge-wiz-, doc032-bridge-auth-;
//   - run files and screenshots go to bridge/admin-org-replay/ (runs/ and *.png),
//     written logo fixtures to bridge/admin-org-replay/fixtures/, and `merge`
//     writes one log, bridge/admin-org-replay.json, that keeps every attempt;
//   - run.sh also appends the full console output to $SCRATCH_DIR (outside docs/);
//   - for the second bao sso attempt only: the Harbor staff address is
//     doc032-bridge-auth-harbor-r2-<stamp> and its OIDC subject is
//     doc032-idp-harbor-staff-r2, because attempt 1 had already created and linked
//     the first ones (see replayNotes in admin-org-replay.json).
// The original header follows.
//
// DOC-032 bridge independent walkthrough.
// Written by the DOC-032 independent walkthrough agent (admin-org), adapted from
// DOC-030/admin-org/walkthrough.mjs and DOC-030/first-run/walkthrough.mjs. It
// follows first-run (V-C35), organisation-and-users (V-C36) and
// authentication-and-email (V-C37) against app commit 4ca41822.
//
// Labs (all built from 4ca41822 by scripts/documentation/lab.mjs):
//   firstrun  unseeded, 43342 / 48442: the first-run lifecycle (sections fr*)
//   afr2      unseeded, 43372 / 48472: first-run Set up later lifecycle, then a reset
//             for Finish without Start blank (sections frLater, frFinish)
//   aoauth    owned Helix lab, 43351 / 48451: organisation-and-users, sign-in policy,
//             domains, SSO with two OIDC issuers, 2FA, instance address
//   aowiz     unseeded, 43371 / 48471: wizard email, email precedence, last-Administrator
//             safeguards, invitations without a mailer
// Organization-wide settings are changed only on these owned labs, never on `work`.
// Deployment phases are applied with phase.sh between sections.
//
// Run from the worktree root, one section at a time, inside a pasta network namespace
// (Chromium in the host namespace aborts requests with ERR_NETWORK_CHANGED whenever
// another lab adds a Docker network):
//   LAB_PASSWORD=... pasta --config-net -T <app>,<mail> -- \
//     node docs/documentation/batches/DOC-032/admin-org/walkthrough.mjs <section>
//   node docs/documentation/batches/DOC-032/admin-org/walkthrough.mjs merge
// The seed password comes only from the environment and is also used for the
// fictional accounts this script creates. The setup token is read from the lab's
// overlay.json at run time. Browser state stays in memory; nothing secret is written.
import { createRequire } from "node:module";
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
} from "./admin-org-replay/lib.mjs";

const section = process.argv[2];
const labInfo = (name) => {
  const file = path.join(root, ".documentation-labs", name, "lab.json");
  if (!existsSync(file)) return { name };
  const lab = JSON.parse(readFileSync(file));
  return {
    name,
    app: lab.appUrl,
    mail: lab.mailUrl,
    project: lab.project,
    appImageId: lab.appImageId,
    engineImageId: lab.engineImageId,
    createdAt: lab.createdAt,
    startedAt: lab.startedAt,
    seed: lab.seed,
  };
};
const AO = labInfo("bao");
const AW = labInfo("bwiz");
// FR_LAB lets a script rehearsal use another unseeded lab; evidence runs use firstrun.
const FR = labInfo(process.env.FR_LAB ?? "bfr");
const F2 = labInfo("afr2");
const DANIEL = "daniel.okafor@helix.example";
const NADIA = "nadia.haddad@helix.example";
const JONAS = "jonas.weber@helix.example";
const stamp = Date.now().toString(36);
const SET_PASSWORD = /https?:\/\/\S+\/auth\/set-password#token=[^\s)]+/;
const MAGIC = /https?:\/\/\S+\/api\/auth\/magic-link\/verify\?token=[^\s)]+/;
const F = "first-run";
const O = "organisation-and-users";
const A3 = "authentication-and-email";
const LOGO_TYPE_MESSAGE =
  "Logo must be a PNG, JPEG, WebP, or SVG image 5 MB or smaller. Pick another file.";
const LOGO_READ_MESSAGE =
  "The logo must be a readable PNG, JPEG, WebP or SVG with no more than 16 million pixels.";

const SECTION_LAB = {
  frSetup: FR,
  frOrg: FR,
  frAuth: FR,
  frEmail: FR,
  frInvites: FR,
  frConnectors: FR,
  frReview: FR,
  frAfter: FR,
  frEmailRow: FR,
  frLater: F2,
  frFinish: F2,
  frSkip: F2,
  org: AO,
  wizardStored: AW,
  wizardIncomplete: AW,
  wizardEnv: AW,
  settingsIncomplete: AW,
  settingsStored: AW,
  guards: AW,
  policy: AO,
  sso: AO,
  twoFactor: AO,
  crossPage: AO,
  instancePinned: AO,
  instanceSaved: AO,
  ssoRemove: AO,
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
  reviewer: "DOC-032 compatibility reviewer (bridge)",
  reviewerKind: "agent",
  labName: lab.name,
  labProject: lab.project,
  appUrl: lab.app,
  mailUrl: lab.mail,
  appImageId: lab.appImageId,
  engineImageId: lab.engineImageId,
  phase: process.env.PHASE ?? null,
  articleHashes: {
    [F]: articleHash(F),
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
        `${lab.project}-oidc-1`,
        "--format",
        "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    return "";
  }
})();
// The OIDC fixture is reachable on the lab network as "oidc"; the browser resolves
// that name to the fixture container's address. localhost is sent to 127.0.0.1 so a
// page can be opened at http://localhost:<port>, which is not the instance address.
const resolverRules = ["MAP localhost 127.0.0.1", ...(OIDC_IP ? [`MAP oidc ${OIDC_IP}`] : [])];
const browser = await chromium.launch({
  args: [`--host-resolver-rules=${resolverRules.join(",")}`],
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
function overlayValue(labName, key) {
  const overlay = JSON.parse(
    readFileSync(path.join(root, ".documentation-labs", labName, "overlay.json"), "utf8"),
  );
  return overlay.services.app.environment[key] ?? null;
}
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
  await row(page, email)
    .getByRole("button", { name: `More actions for ${email}` })
    .click();
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

const newPassword = () => `Doc032-${randomBytes(12).toString("hex")}`;

// ---------------------------------------------------------------------------
// V-C36 organisation-and-users on the owned seeded aoauth lab.
async function org() {
  const { app, mail } = AO;
  const admin = await context();
  await signIn(admin.page, app, DANIEL);
  const people = {
    a: {
      name: `DOC-032 bridge V-C36 Avery ${stamp}`,
      email: `doc032-bridge-org-a-${stamp}@helix.example`,
    },
    b: {
      name: `DOC-032 bridge V-C36 Bryn ${stamp}`,
      email: `doc032-bridge-org-b-${stamp}@helix.example`,
    },
    c: {
      name: `DOC-032 bridge V-C36 Casey ${stamp}`,
      email: `doc032-bridge-org-c-${stamp}@helix.example`,
      password: newPassword(),
    },
    bu: { email: `doc032-bridge-org-bu-${stamp}@helix.example` },
    bu0: { email: `doc032-bridge-org-bu0-${stamp}@helix.example` },
  };
  results.identities = [
    { role: "administrator", account: "Daniel Okafor (seeded)" },
    {
      role: "legal_team_member",
      account: "Nadia Haddad (seeded), unauthorized-administration check",
    },
    {
      role: "business_user",
      account: "Portal-created doc032-bridge-org-bu0 address, unauthorized-administration check",
    },
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
        email: `doc032-bridge-org-denied-${stamp}@helix.example`,
        displayName: "DOC-032 bridge V-C36 denied",
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
      // A fresh Portal-created Business User, so the seeded Business Users stay
      // untouched for the V-C37 sections on the same lab.
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

  const draftName = `DOC-032 bridge V-C36 Helix ${stamp}`;
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
      await box.fill("DOC-032 bridge unsaved draft");
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
        path.join(fx, "doc032-logo.svg"),
        '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#2f6f5e"/></svg>\n',
      );
      writeFileSync(
        path.join(fx, "doc032-not-an-image.txt"),
        "DOC-032 bridge fixture: not an image\n",
      );
      writeFileSync(
        path.join(fx, "doc032-unreadable.png"),
        "DOC-032 bridge fixture: PNG name, no image data\n",
      );
      writeFileSync(path.join(fx, "doc032-logo-64.png"), png(64, 64));
      const huge = path.join(scratch, "doc032-logo-4001x4001.png");
      writeFileSync(huge, png(4001, 4001));
      const big = path.join(scratch, "doc032-logo-over-5mb.png");
      writeFileSync(big, Buffer.concat([png(8, 8), Buffer.alloc(5 * 1024 * 1024 + 1024)]));
      await page.goto(`${app}/settings/general`);
      const upload = async (file) => {
        const chooser = page.waitForEvent("filechooser");
        await page.getByRole("button", { name: "Upload", exact: true }).click();
        await (await chooser).setFiles(file);
      };
      const TYPE = LOGO_TYPE_MESSAGE;
      const READ = LOGO_READ_MESSAGE;
      const seen = {};
      for (const [key, file, message] of [
        ["text file", path.join(fx, "doc032-not-an-image.txt"), TYPE],
        ["PNG over 5 MB", big, TYPE],
        ["unreadable .png", path.join(fx, "doc032-unreadable.png"), READ],
        ["4001 x 4001 PNG (16,008,001 pixels)", huge, READ],
      ]) {
        await page.reload();
        await upload(file);
        await page.getByText(message).waitFor({ timeout: 15000 });
        seen[key] = message === TYPE ? "5 MB message" : "readability message";
      }
      const afterRejects = (await api(page, app, "GET", "/api/v1/org/general")).data.general.logo;
      await page.reload();
      await upload(path.join(fx, "doc032-logo-64.png"));
      await page.getByText("Saved", { exact: true }).first().waitFor({ timeout: 15000 });
      const pngSaved = (await api(page, app, "GET", "/api/v1/org/general")).data.general.logo;
      await page.reload();
      await upload(path.join(fx, "doc032-logo.svg"));
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
        staff.text.includes(draftName) &&
          staff.logos.length === 1 &&
          staff.logos[0].startsWith("data:image/svg"),
        `staff ${JSON.stringify(staff)}`,
      );
      expect(
        portal.text.includes(draftName) && portal.logos.length === 1,
        `portal ${JSON.stringify(portal)}`,
      );
      expect(
        headerText.includes(draftName) && headerLogo >= 1,
        `header "${headerText.slice(0, 120)}" logo ${headerLogo}`,
      );
      expect(
        portalHeaderText.includes(draftName) && portalHeaderLogo >= 1,
        `portal header "${portalHeaderText.slice(0, 120)}" logo ${portalHeaderLogo}`,
      );
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
        .evaluateAll((els) =>
          els.map((e) => e.closest("label")?.innerText.trim() ?? e.getAttribute("aria-label")),
        );
      await dialog.getByRole("button", { name: "Cancel" }).click();
      sinceA = new Date(Date.now() - 2000);
      const d = await invite(page, people.a.name, people.a.email, "Legal team member");
      await d.waitFor({ state: "hidden" });
      const state = await rowState(page, people.a.email);
      inviteMail = await latestMail(mail, people.a.email, sinceA, SET_PASSWORD);
      expect(inviteMail, "no invitation email");
      const header = emailHeader(inviteMail);
      const action =
        /Set password/.test(inviteMail.html) && /expires in 1 hour/.test(inviteMail.html);
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
      expect(
        header.name === draftName && header.cid === "org-logo@openlaw",
        `email header ${JSON.stringify(header)}`,
      );
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
      expect(
        restoredName === original.name && restore.status === 200,
        `name ${restoredName} restore ${restore.status}`,
      );
      expect(
        staff.text.includes(original.name) && staff.logos.length === (original.logo ? 1 : 0),
        `staff ${JSON.stringify(staff)}`,
      );
      return `Typing "${original.name}" and leaving the field showed Saved and survived reload. The original logo (${original.logo === null ? "none" : "an image"}) was restored through PATCH /api/v1/org/general (${restore.status}) because the pane has no remove control. /auth/login then showed "${staff.text.slice(0, 80)}" with ${staff.logos.length} logo images. The organization identity of the owned lab was changed for about a minute.`;
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
      expect(
        locales.length === 1 && locales[0].trim() === "English (United States)",
        `locales ${locales}`,
      );
      expect(restored.startsWith(original.defaultTimezone), `restored ${restored}`);
      return `Default timezone saved America/Toronto and kept it after reload. Default locale offered only ${JSON.stringify(locales)}. The timezone was restored to ${original.defaultTimezone}.`;
    },
    admin.page,
  );

  await step(
    O,
    "administrator",
    "OpenLaw rejects an invalid address",
    "No row is created",
    async () => {
      const { page } = admin;
      await openUsers(page, app);
      const before = (await api(page, app, "GET", "/api/v1/users")).data.users.length;
      const d = await invite(
        page,
        "DOC-032 bridge V-C36 invalid",
        "doc032-bridge-org-invalid-address",
        "Legal team member",
      );
      await sleep(800);
      const stillOpen = await d.isVisible();
      const validation = await d.getByLabel("Email").evaluate((el) => el.validationMessage);
      await d.getByRole("button", { name: "Cancel" }).click();
      const apiTry = await api(page, app, "POST", "/api/v1/auth/invites", {
        email: "doc032 org@@helix",
        displayName: "DOC-032 bridge V-C36 invalid",
        role: "legal_team_member",
      });
      const after = (await api(page, app, "GET", "/api/v1/users")).data.users.length;
      expect(
        stillOpen && before === after && apiTry.status >= 400,
        `open ${stillOpen}, users ${before}->${after}, api ${apiTry.status}`,
      );
      return `The dialog stayed open with the browser message "${validation}" and no row was added (${before} users before and after). The invite route refused a malformed address with ${apiTry.status}.`;
    },
    admin.page,
  );

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
      expect(
        alert === "This user already exists with a different role." && n === 0,
        `alert "${alert}", mails ${n}`,
      );
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
      await row(page, people.a.email)
        .getByRole("button", { name: `Resend the invite to ${people.a.email}` })
        .click();
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
      expect(
        me.status === 200 && state.status === "Active" && state.roleControl,
        `${me.status} ${JSON.stringify(state)}`,
      );
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
      await row(page, people.b.email)
        .getByRole("button", { name: `Revoke the invite to ${people.b.email}` })
        .click();
      await row(page, people.b.email).waitFor({ state: "detached" });
      const listed = (await api(page, app, "GET", "/api/v1/users")).data.users.some(
        (u) => u.email === people.b.email,
      );
      expect(
        beforeState.status === "Invited" && !listed,
        `before ${JSON.stringify(beforeState)}, still listed ${listed}`,
      );
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
      await colleague.page
        .getByRole("heading", { name: "Users", level: 2 })
        .waitFor({ timeout: 15000 });
      expect(
        JSON.stringify(items) ===
          JSON.stringify(["Administrator", "Legal team member", "Business user"]),
        `items ${items}`,
      );
      expect(
        note === "Saved" && saved.role === "Administrator",
        `${note} ${JSON.stringify(saved)}`,
      );
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
      expect(
        beforeState.status === "Active" &&
          beforeState.role === "Business user" &&
          beforeState.roleControl,
        `before ${JSON.stringify(beforeState)}`,
      );
      expect(
        note === "Saved" &&
          promoted.status === "Active" &&
          promoted.roleControl &&
          promoted.role === "Legal team member",
        `promoted ${note} ${JSON.stringify(promoted)}`,
      );
      expect(
        meAfter.data?.user?.role === "legal_team_member",
        `me ${JSON.stringify(meAfter.data?.user?.role)}`,
      );
      expect(
        back.status === "Active" && back.role === "Business user" && back.roleControl,
        `back ${note2} ${JSON.stringify(back)}`,
      );
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
      expect(
        self.roleControl && !self.moreActions && !self.actions.includes("Archive"),
        JSON.stringify(self),
      );
      expect(
        r.status >= 400 && r.data?.detail === "You cannot archive yourself.",
        `self archive ${r.status} ${r.data?.detail}`,
      );
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
      expect(
        beforeMe.status === 200 && after.status === 401 && landed.startsWith("/auth/login"),
        `before ${beforeMe.status} after ${after.status} landed ${landed}`,
      );
      expect(
        state.status === "Active" && again.status === 200,
        `state ${JSON.stringify(state)} again ${again.status}`,
      );
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
        title: `DOC-032 bridge V-C36 offboarding contract ${stamp}`,
        contractTypeId: other.id,
        managerId: cId,
      });
      expect(
        created.status === 201 || created.status === 200,
        `create ${created.status} ${JSON.stringify(created.data)}`,
      );
      contractNumber = created.data.contract.number;
      people.c.id = cId;
      results.records = [
        `Contract ${contractNumber} "DOC-032 bridge V-C36 offboarding contract ${stamp}"`,
      ];
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
      await row(page, people.c.email)
        .getByRole("button", { name: `Archive ${people.c.email}` })
        .click();
      await row(page, people.c.email).waitFor({ state: "detached", timeout: 10000 });
      const after = await api(casey.page, app, "GET", "/api/v1/me");
      const fresh = await context();
      await fresh.page.goto(`${app}/auth/login`);
      await fresh.page.getByLabel("Email", { exact: true }).fill(people.c.email);
      await fresh.page.getByLabel("Password", { exact: true }).fill(people.c.password);
      await fresh.page.getByRole("button", { name: "Sign in", exact: true }).click();
      const alert = (
        await fresh.page.getByRole("alert").first().innerText({ timeout: 15000 })
      ).trim();
      const since = new Date(Date.now() - 1000);
      const linkPage = await requestMagicLink(fresh.page, app, people.c.email).catch(
        async () =>
          `(no confirmation) ${(await fresh.page.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 160)}`,
      );
      await sleep(3000);
      const links = await countMail(mail, people.c.email, since);
      await fresh.ctx.close();
      const contract = await api(page, app, "GET", `/api/v1/contracts/${contractNumber}`);
      const manager = contract.data?.contract?.manager;
      const switchAfter = await page.getByRole("switch", { name: "Show archived" }).count();
      expect(
        live.status === 200 && after.status === 401,
        `live ${live.status} after ${after.status}`,
      );
      expect(/archived/i.test(alert) && links === 0, `sign-in alert ${alert} links ${links}`);
      expect(
        manager?.id === people.c.id && manager?.archived === true,
        `manager ${JSON.stringify(manager)}`,
      );
      expect(switchAfter === 1, `switch after ${switchAfter}`);
      return `Archive removed the row from the ordinary list at once. The colleague's live session went from ${live.status} to ${after.status}. A new password sign-in showed "${alert}". A sign-in link request answered "${linkPage.slice(0, 140)}" and sent ${links} messages. Contract ${contractNumber} still named the archived colleague as Legal Owner (archived: ${manager.archived}). Show archived was present ${switchBefore ? "before (the seeded lab already held archived accounts) and " : ""}after the archive.`;
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
      await row(page, people.c.email)
        .getByRole("button", { name: `Restore ${people.c.email}` })
        .click();
      const note = await rowNote(page, people.c.email);
      const restored = await rowState(page, people.c.email);
      const old = await api(casey.page, app, "GET", "/api/v1/me");
      await signIn(casey.page, app, people.c.email, people.c.password);
      const again = await api(casey.page, app, "GET", "/api/v1/me");
      expect(
        archived.status === "Archived" && archived.actions.includes("Restore"),
        `archived ${JSON.stringify(archived)}`,
      );
      expect(
        restored.status === "Active" && old.status === 401 && again.status === 200,
        `restored ${JSON.stringify(restored)} old ${old.status} again ${again.status}`,
      );
      return `With Show archived on, the row read Archived with a Restore action. Restore showed "${note}" and the row read Active. The old browser session still got ${old.status}; a fresh password sign-in got ${again.status}.`;
    },
    admin.page,
  );

  await Promise.all([admin.ctx.close(), colleague.ctx.close(), casey.ctx.close(), bu.ctx.close()]);
}

// ---------------------------------------------------------------------------
// V-C37 authentication-and-email, and the V-C36 checks that need an owned lab.
// Fictional accounts this script creates use the lab password from the environment.
const AUTH_PASSWORD = PASSWORD;
const needAuthPassword = () => {};
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

// The aowiz first Administrator (a fictional first-run fixture).
const WIZ_ADMIN = {
  name: "DOC-032 bridge Avery Morgan",
  email: "doc032-bridge-wiz-admin@helix.example",
};
const WIZ_PENDING = "doc032-bridge-wiz-pending@helix.example";
const STORED_SENDER = "stored-relay@helix.example";
const STORED_NAME = "DOC-032 Stored";
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
  await signIn(c.page, AW.app, WIZ_ADMIN.email, AUTH_PASSWORD);
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
    .getByText(
      /^(Test email sent to \S+\. Check your inbox\.|The test email could not be sent\..*)$/,
    )
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
  const { app, mail } = AW;
  const admin = await context();
  await step(
    A3,
    "administrator",
    "First-run: create the first Administrator; Skip optional steps on the Welcome step opens Outbound email while email is not configured",
    "Outbound email step with the unset warning, no Set up later, Continue unavailable",
    async () => {
      const { page } = admin;
      await page.goto(`${app}/auth/setup`);
      await page.getByLabel("Setup token").fill(overlayValue("bwiz", "SETUP_TOKEN"));
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
      expect(
        /Set up outbound email to finish instance setup\. OpenLaw uses it for invitations, sign-in links, and notifications\./.test(
          text,
        ),
        text.slice(0, 300),
      );
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
          logos: await anon.page
            .locator("main")
            .getByRole("img", { name: "Organization logo" })
            .count(),
        };
        await anon.ctx.close();
      }
      const branding = await (await fetch(`${app}/api/v1/org/branding`)).json();
      expect(
        !branding.name &&
          Object.values(out).every((x) => x.start.startsWith("OpenLaw") && x.logos === 0),
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
      seen.securityOptions = (await f.security.locator("option").allInnerTexts()).map((x) =>
        x.trim(),
      );
      seen.authenticationOptions = (await f.authentication.locator("option").allInnerTexts()).map(
        (x) => x.trim(),
      );
      seen.initialAuthentication = (
        await f.authentication.locator("option:checked").innerText()
      ).trim();
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
            JSON.stringify(["Username and password", "None"]) &&
          seen.initialAuthentication === "Username and password",
        JSON.stringify(seen),
      );
      expect(
        seen.credentialsWithPassword.join() === "1,1" &&
          seen.credentialsWithNone.join() === "0,0" &&
          seen.senderFields.join() === "1,1",
        JSON.stringify(seen),
      );
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
      expect(
        out.every((x) => x.source === "unset" && !/Relay saved/.test(x.notice ?? "")),
        JSON.stringify(out),
      );
      return `Save relay results: ${JSON.stringify(out)}.`;
    },
    admin.page,
  );

  const smtpUser = "doc032-smtp-user";
  const smtpSecret = `doc032-${randomBytes(9).toString("hex")}`;
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
        [
          "--context",
          "default",
          "exec",
          `${AW.project}-postgres-1`,
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
      const n = await countMail(mail, WIZ_ADMIN.email, since);
      expect(/Relay saved\./.test(saved.match ?? ""), JSON.stringify(saved));
      expect(
        JSON.stringify(Object.keys(settings.data).sort()) ===
          JSON.stringify(["fromAddress", "source"]) && settings.data.source === "app",
        JSON.stringify(settings.data),
      );
      expect(
        !html.includes(smtpSecret) &&
          !html.includes(smtpUser) &&
          !JSON.stringify(settings.data).includes(smtpSecret),
        "credentials shown",
      );
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
      expect(
        Object.values(form).every((v) => v === ""),
        JSON.stringify(form),
      );
      expect(
        formGone === 0 && JSON.stringify(kept) === JSON.stringify(before),
        `form ${formGone} kept ${JSON.stringify(kept)}`,
      );
      expect(
        /Relay saved\./.test(saved.match ?? "") &&
          test === `Test email sent to ${WIZ_ADMIN.email}. Check your inbox.`,
        `${JSON.stringify(saved)} ${test}`,
      );
      expect(
        facts &&
          facts.subject === "OpenLaw test email" &&
          facts.headline &&
          facts.sentThrough?.startsWith("mailpit") &&
          facts.fromLine?.includes(STORED_SENDER) &&
          m.from === STORED_SENDER &&
          m.fromName === STORED_NAME &&
          !cont,
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
      expect(
        header.name === "OpenLaw" && header.cid === "openlaw-mark@openlaw",
        JSON.stringify(header),
      );
      return `On the unnamed bwiz instance a test email's header read "${header.name}" with the inline image ${header.cid}.`;
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
      await fillRelay(page, {
        ...WORKING_RELAY,
        host: "doc032-unreachable-relay.invalid",
        port: 2525,
      });
      const saved = await emailNotice(page);
      const failure = await sendTest(page);
      await page.getByRole("button", { name: "Replace relay" }).click();
      await fillRelay(page, WORKING_RELAY);
      await page.getByText("Relay saved.").first().waitFor();
      const since = new Date(Date.now() - 1000);
      const ok = await sendTest(page);
      const m = await latestMail(mail, WIZ_ADMIN.email, since, null);
      expect(
        /Relay saved\./.test(saved.match ?? "") && /could not be sent/.test(failure) && m,
        `${JSON.stringify(saved)} ${failure} ${!!m}`,
      );
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
      const reset = await api(page, app, "POST", "/api/v1/auth/password-setup", {
        email: WIZ_ADMIN.email,
      });
      await sleep(3000);
      const n = await countMail(mail, WIZ_ADMIN.email, since);
      await fillRelay(page, WORKING_RELAY);
      await page.getByText("Relay saved.").first().waitFor();
      const since2 = new Date(Date.now() - 1000);
      await sendTest(page);
      const m = await latestMail(mail, WIZ_ADMIN.email, since2, null);
      expect(
        source === "unset" && cont && n === 0,
        `source ${source}, continue disabled ${cont}, mails ${n}, reset ${reset.status}`,
      );
      expect(m, "no mail after replacement");
      return `Clear relay showed "Relay cleared. This instance can no longer send email." The source became ${source} and Continue was disabled. A password setup request answered ${reset.status}${reset.data?.detail ? ` ("${reset.data.detail}")` : ""} and Mailpit received ${n} messages. After a valid replacement was saved, a test message arrived again from ${m.from}.`;
    },
    admin.page,
  );
  await admin.ctx.close();
}

async function wizardIncomplete() {
  const { app, mail } = AW;
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
        email: "doc032-bridge-wiz-incomplete@helix.example",
        displayName: "DOC-032 bridge V-C37 incomplete",
        role: "legal_team_member",
      });
      await sleep(3000);
      const n = await countMail(mail, "doc032-bridge-wiz-incomplete@helix.example", since);
      expect(
        /The deployment environment sets SMTP_URL but not SMTP_FROM, so mail cannot be sent\. Set SMTP_FROM in the environment\./.test(
          text,
        ),
        text.slice(0, 300),
      );
      expect(
        !b.some((x) =>
          ["Save relay", "Replace relay", "Clear relay", "Send test email"].includes(x),
        ) && cont,
        `buttons ${b} continue ${cont}`,
      );
      expect(
        settings.data?.source === "env" && inv.status >= 400 && n === 0,
        `${JSON.stringify(settings.data)} invite ${inv.status} mails ${n}`,
      );
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
      expect(
        Object.values(out).every((b) => !b.includes("Email me a sign-in link")) &&
          methods.policy.legal.magicLink,
        JSON.stringify(out),
      );
      return `With Email magic link on in both groups (${JSON.stringify(methods.policy.legal)}) and emailConfigured ${methods.emailConfigured}, the pages offered ${JSON.stringify(out)}.`;
    },
    admin.page,
  );
  await admin.ctx.close();
}

async function wizardEnv() {
  const { app, mail } = AW;
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
      expect(
        /Outbound email is set by the deployment environment\. Mail is sent from DOC-032 Environment <env-relay@helix\.example>\./.test(
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
      const paneButtons = (await page.locator("main").getByRole("button").allInnerTexts())
        .map((x) => x.trim())
        .filter((x) => x && x !== "Advanced");
      const since = new Date(Date.now() - 1000);
      const test = await sendTest(page);
      const m = await latestMail(mail, WIZ_ADMIN.email, since, null);
      expect(
        /Managed by your deployment configuration\. Contact your system administrator to change the relay\./.test(
          text,
        ),
        text.slice(0, 300),
      );
      expect(
        /Sender: DOC-032 Environment <env-relay@helix\.example>/.test(text),
        text.slice(0, 300),
      );
      expect(
        m && m.from === ENV_SENDER && m.from !== STORED_SENDER,
        JSON.stringify(m && { from: m.from }),
      );
      expect(
        !paneButtons.some((x) => ["Save relay", "Replace relay", "Clear relay"].includes(x)) &&
          paneButtons.includes("Send test email"),
        `buttons ${paneButtons}`,
      );
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
      await page.getByLabel("Name").fill("DOC-032 bridge V-C37 pending colleague");
      await page.getByLabel("Email").fill(WIZ_PENDING);
      await page.getByRole("button", { name: "Send invite" }).click();
      const m = await latestMail(mail, WIZ_PENDING, since, SET_PASSWORD);
      expect(m && m.from === ENV_SENDER, JSON.stringify(m && { from: m.from }));
      return `The Invite your team step sent "${m.subject}" to ${WIZ_PENDING} from ${m.from}. The row stays pending for the resend check.`;
    },
    admin.page,
  );
  await step(
    F,
    "administrator",
    "first-run: Skip optional steps on the Welcome step with email configured ends onboarding and enters the app; it does not record the review; the wizard cannot be reopened",
    "Skip optional steps completes setup; /welcome redirects; the Setup checklist shows Review seeded types with Mark as reviewed",
    async () => {
      const { page } = admin;
      await page.goto(`${app}/welcome?step=welcome`);
      await page.getByRole("button", { name: "Skip optional steps" }).click();
      await page.waitForURL((u) => !u.pathname.startsWith("/welcome"), { timeout: 20000 });
      const landed = new URL(page.url()).pathname;
      await page.goto(`${app}/welcome`);
      await page.waitForLoadState("networkidle");
      const after = new URL(page.url()).pathname;
      const onboarding = (await api(page, app, "GET", "/api/v1/onboarding")).data;
      await page.goto(`${app}/settings/general`);
      await page.waitForLoadState("networkidle");
      const list = page.getByRole("list", { name: "Outstanding setup steps" });
      const rows = (await list.count())
        ? await list.locator("li").evaluateAll((items) =>
            items.map((li) => ({
              label: (
                li.querySelector("a")?.textContent ??
                li.childNodes[0]?.textContent ??
                ""
              ).trim(),
              href: li.querySelector("a")?.getAttribute("href") ?? null,
              markAsReviewed: [...li.querySelectorAll("button")].some(
                (b) => b.textContent.trim() === "Mark as reviewed",
              ),
            })),
          )
        : [];
      const review = rows.find((r) => r.label === "Review seeded types");
      expect(!after.startsWith("/welcome"), `after ${after}`);
      expect(
        onboarding.completed === true && onboarding.steps.review.done === false,
        JSON.stringify(onboarding),
      );
      expect(
        review?.markAsReviewed && review.href === null && !rows.some((r) => r.label === "Email"),
        JSON.stringify(rows),
      );
      return `Skip optional steps on the Welcome step, with email configured, completed setup and went to ${landed}. Opening /welcome again went to ${after}. The onboarding API reported completed ${onboarding.completed} and review done ${onboarding.steps.review.done}. The Setup checklist on Settings General listed ${JSON.stringify(rows)}: Review seeded types with Mark as reviewed and no Email row.`;
    },
    admin.page,
  );
  await admin.ctx.close();
}

async function settingsIncomplete() {
  const { app, mail } = AW;
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
      expect(
        /The deployment environment sets SMTP_URL but not SMTP_FROM, so mail cannot be sent\. Set SMTP_FROM in the environment\./.test(
          text,
        ) && disabled,
        `${text.slice(0, 300)} disabled ${disabled}`,
      );
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
      const newAddress = `doc032-bridge-wiz-nomail-${stamp}@helix.example`;
      const d = await invite(
        page,
        "DOC-032 bridge V-C36 no mailer",
        newAddress,
        "Legal team member",
      );
      const alert = (await d.getByRole("alert").innerText()).trim();
      await d.getByRole("button", { name: "Cancel" }).click();
      await openUsers(page, app);
      const added = await row(page, newAddress).count();
      await row(page, WIZ_PENDING)
        .getByRole("button", { name: `Resend the invite to ${WIZ_PENDING}` })
        .click();
      const resend = await rowNote(page, WIZ_PENDING);
      const after = (await api(page, app, "GET", "/api/v1/users")).data.users.length;
      // The deployment sets SMTP_URL here, so the message names the environment fix.
      expect(
        alert ===
          "The invite was not sent: this instance cannot send email. Set SMTP_URL and SMTP_FROM together in the environment.",
        alert,
      );
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
      expect(
        Object.values(out).every((b) => !b.includes("Email me a sign-in link")),
        JSON.stringify(out),
      );
      return `The pages offered ${JSON.stringify(out)}.`;
    },
    admin.page,
  );
  await admin.ctx.close();
}

async function settingsStored() {
  const { app, mail } = AW;
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
      expect(
        !/Managed by your deployment configuration/.test(text) &&
          /Sender: "?DOC-032 Stored"? <stored-relay@helix\.example>/.test(text),
        text.slice(0, 300),
      );
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
      const paneButtons = (await page.locator("main").getByRole("button").allInnerTexts())
        .map((x) => x.trim())
        .filter((x) => x && x !== "Advanced");
      const before = (await api(page, app, "GET", "/api/v1/email-settings")).data;
      await page.getByRole("button", { name: "Replace relay" }).click();
      const f = smtp(page);
      const form = {
        host: await f.host.inputValue(),
        senderEmail: await f.senderEmail.inputValue(),
        senderName: await f.senderName.inputValue(),
        username: await f.username.inputValue(),
      };
      await page.getByRole("button", { name: "Cancel" }).click();
      const kept = (await api(page, app, "GET", "/api/v1/email-settings")).data;
      await page.getByRole("button", { name: "Replace relay" }).click();
      await fillRelay(page, { ...WORKING_RELAY, host: "mailpit:1025" });
      const refused = await emailNotice(page);
      const afterRefused = (await api(page, app, "GET", "/api/v1/email-settings")).data;
      await page.getByRole("button", { name: "Cancel" }).click();
      await page.getByRole("button", { name: "Replace relay" }).click();
      await fillRelay(page, { ...WORKING_RELAY, senderName: "DOC-032 Stored Replacement" });
      const saved = await emailNotice(page);
      const since = new Date(Date.now() - 1000);
      await sendTest(page);
      const m = await latestMail(mail, WIZ_ADMIN.email, since, null);
      await page.getByRole("button", { name: "Replace relay" }).click();
      await fillRelay(page, WORKING_RELAY);
      await emailNotice(page);
      expect(
        JSON.stringify(paneButtons) === JSON.stringify(["Send test email", "Replace relay"]),
        `buttons ${paneButtons}`,
      );
      expect(
        Object.values(form).every((v) => v === "") &&
          JSON.stringify(kept) === JSON.stringify(before),
        `${JSON.stringify(form)} ${JSON.stringify(kept)}`,
      );
      expect(
        !/Relay saved/.test(refused.match ?? "") &&
          JSON.stringify(afterRefused) === JSON.stringify(before),
        `${JSON.stringify(refused)} ${JSON.stringify(afterRefused)}`,
      );
      expect(
        /Relay saved\./.test(saved.match ?? "") && m?.fromName === "DOC-032 Stored Replacement",
        `${JSON.stringify(saved)} ${JSON.stringify(m && { fromName: m.fromName })}`,
      );
      return `Pane buttons were ${JSON.stringify(paneButtons)} (no Clear relay). Replace relay opened an empty form ${JSON.stringify(form)}; Cancel kept ${JSON.stringify(kept)}. SMTP server mailpit:1025 was refused (${JSON.stringify(refused)}) and the relay stayed. A replacement with Sender name "DOC-032 Stored Replacement" showed "${saved.match}", and the next test arrived from "${m.fromName}" with no restart. The original relay was saved again.`;
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
      const cleared = await api(page, app, "PUT", "/api/v1/email-settings", {
        smtpUrl: null,
        smtpFrom: null,
      });
      await openUsers(page, app);
      const newAddress = `doc032-bridge-wiz-unset-${stamp}@helix.example`;
      const d = await invite(
        page,
        "DOC-032 bridge V-C36 unset mailer",
        newAddress,
        "Legal team member",
      );
      const alert = (await d.getByRole("alert").innerText()).trim();
      await d.getByRole("button", { name: "Cancel" }).click();
      await openSettingsPane(page, app, "Outbound email");
      const formShown = await smtp(page).host.count();
      await fillRelay(page, WORKING_RELAY);
      const saved = await emailNotice(page);
      const text = await paneText(page);
      await openUsers(page, app);
      const since = new Date(Date.now() - 1000);
      await row(page, WIZ_PENDING)
        .getByRole("button", { name: `Resend the invite to ${WIZ_PENDING}` })
        .click();
      const note = await rowNote(page, WIZ_PENDING);
      const m = await latestMail(mail, WIZ_PENDING, since, SET_PASSWORD);
      expect(
        cleared.status === 200 &&
          alert ===
            "The invite was not sent: this instance cannot send email. Set up outbound email in Settings → Advanced → Outbound email.",
        `${cleared.status} ${alert}`,
      );
      expect(
        formShown === 1 &&
          /Relay saved\./.test(saved.match ?? "") &&
          note === "Saved" &&
          m?.from === STORED_SENDER,
        `${formShown} ${JSON.stringify(saved)} ${note} ${JSON.stringify(m && { from: m.from })}`,
      );
      return `With no relay saved and no environment relay, Send invite showed "${alert}". Settings, Advanced, Outbound email showed the relay form; Save relay showed "${saved.match}" and the pane then read "${text.slice(0, 120)}". Resend invite on the pending row showed "${note}" and "${m.subject}" arrived from ${m.from}.`;
    },
    admin.page,
  );
  await admin.ctx.close();
}

async function guards() {
  const { app, mail } = AW;
  const admin = await wizAdmin();
  const colleague = {
    name: "DOC-032 bridge V-C36 Jordan",
    email: `doc032-bridge-wiz-jordan-${stamp}@helix.example`,
    password: newPassword(),
  };
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
      const admins = (await api(page, app, "GET", "/api/v1/users")).data.users.filter(
        (u) => u.role === "administrator" && u.status !== "archived",
      ).length;
      expect(
        admins === 1 &&
          t === "You cannot demote the last Administrator." &&
          me.data.user.role === "administrator",
        `${admins} ${t} ${me.data.user.role}`,
      );
      expect(
        archive.data?.detail === "You cannot archive the last Administrator." &&
          !self.moreActions &&
          !self.actions.includes("Archive"),
        `${archive.status} ${archive.data?.detail} ${JSON.stringify(self)}`,
      );
      return `On bwiz ${WIZ_ADMIN.name} is the only active Administrator (${admins}). Choosing Legal team member on the own row showed "${t}" and the role stayed ${me.data.user.role}. The own row has no Archive and no … button, so the archive refusal was read from the archive route: ${archive.status} "${archive.data.detail}".`;
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
      const hadArchived = (await api(page, app, "GET", "/api/v1/users")).data.users.some(
        (u) => u.status === "archived",
      );
      const switchBefore = await page.getByRole("switch", { name: "Show archived" }).count();
      const since = new Date(Date.now() - 1000);
      const d = await invite(page, colleague.name, colleague.email, "Legal team member");
      await d.waitFor({ state: "hidden" });
      const m = await latestMail(mail, colleague.email, since, SET_PASSWORD);
      await setPasswordFromLink(c.page, m.link, colleague.password);
      await signIn(c.page, app, colleague.email, colleague.password);
      await openUsers(page, app);
      await row(page, colleague.email)
        .getByRole("button", { name: `Archive ${colleague.email}` })
        .click();
      await row(page, colleague.email).waitFor({ state: "detached" });
      const switchAfter = await page.getByRole("switch", { name: "Show archived" }).count();
      const live = await api(c.page, app, "GET", "/api/v1/me");
      await page.getByRole("switch", { name: "Show archived" }).click();
      await row(page, colleague.email)
        .getByRole("button", { name: `Restore ${colleague.email}` })
        .click();
      const note = await rowNote(page, colleague.email);
      const restored = await rowState(page, colleague.email);
      expect(
        !hadArchived && switchBefore === 0 && switchAfter === 1,
        `had ${hadArchived} before ${switchBefore} after ${switchAfter}`,
      );
      expect(
        live.status === 401 && restored.status === "Active",
        `live ${live.status} ${JSON.stringify(restored)}`,
      );
      return `With no archived accounts, the Users header had ${switchBefore} Show archived switch. After ${colleague.name} set a password, signed in and was archived, the switch appeared (${switchAfter}) and the colleague's session answered ${live.status}. Restore showed "${note}" and the row read ${restored.status}.`;
    },
    admin.page,
  );
  await step(
    A3,
    "administrator",
    "Empty allowed-domain list on a finished fresh install: the Business Portal Authentication switches show off and are unavailable; a staff account changed to Business user tries Business Portal sign-in (the source-review author's product-bug check)",
    "Switches off and unavailable; the Portal sign-in outcome is recorded",
    async () => {
      const { page } = admin;
      await openSettingsPane(page, app, "Authentication");
      const region = page.getByRole("region", { name: "Business Portal Authentication" });
      await region.waitFor();
      const switches = await region
        .getByRole("switch")
        .evaluateAll((els) =>
          els.map(
            (e) =>
              `${document.querySelector(`label[for="${e.id}"]`)?.innerText}:${e.getAttribute("aria-checked")}${e.disabled ? ":disabled" : ""}`,
          ),
        );
      const stored = (await api(page, app, "GET", "/api/v1/auth/methods")).data.policy.business;
      const domains = (await api(page, app, "GET", "/api/v1/auth/allowed-domains")).data.domains;
      await openUsers(page, app);
      await chooseRole(page, colleague.email, "Business user");
      const note = await rowNote(page, colleague.email);
      const b = await context();
      await b.page.goto(`${app}/portal/login`);
      await b.page.getByRole("heading", { level: 1 }).first().waitFor();
      await b.page.waitForLoadState("networkidle");
      const portalText = (await b.page.locator("main").innerText()).replace(/\s+/g, " ");
      const portalButtons = await buttons(b.page);
      let outcome = "no password form on the Business Portal page";
      if (await b.page.getByLabel("Password", { exact: true }).count()) {
        await b.page.getByLabel("Email", { exact: true }).fill(colleague.email);
        await b.page.getByLabel("Password", { exact: true }).fill(colleague.password);
        await b.page.getByRole("button", { name: "Sign in", exact: true }).click();
        await sleep(3000);
        outcome = `password form offered; after Sign in the page was ${new URL(b.page.url()).pathname}`;
      }
      const me = await api(b.page, app, "GET", "/api/v1/me");
      await b.ctx.close();
      results.productBugCheck = {
        switches,
        stored,
        domains,
        portalText: portalText.slice(0, 160),
        portalButtons,
        outcome,
        me: me.status,
        role: me.data?.user?.role ?? null,
      };
      expect(
        domains.length === 0 && switches.slice(0, 3).every((x) => x.endsWith(":false:disabled")),
        `${JSON.stringify(domains)} ${JSON.stringify(switches)}`,
      );
      return `Allowed email domains ${JSON.stringify(domains)}. The Business Portal Authentication switches read ${JSON.stringify(switches)}, while GET /api/v1/auth/methods stored business ${JSON.stringify(stored)}. ${colleague.email} was changed to Business user ("${note}"). The Business Portal sign-in page read "${portalText.slice(0, 120)}" with buttons ${JSON.stringify(portalButtons)}; ${outcome}; /api/v1/me answered ${me.status}${me.data?.user?.role ? ` as ${me.data.user.role}` : ""}.`;
    },
    admin.page,
  );
  await c.ctx.close();
  await admin.ctx.close();
}
// The aoauth sections share accounts, so they share one stamp (POLICY_STAMP).
const authStamp = process.env.POLICY_STAMP ?? stamp;
const authAccounts = {
  pending: `doc032-bridge-auth-pending-${authStamp}@helix.example`,
  offDomain: `doc032-bridge-auth-offdomain-${authStamp}@elsewhere.example`,
  ssoStaff: `doc032-bridge-auth-sso-${authStamp}@helix.example`,
  portalNew: `doc032-bridge-auth-portal-${authStamp}@northwind.example`,
  portalPassword: `doc032-bridge-auth-portal-pw-${authStamp}@northwind.example`,
  portalLate: `doc032-bridge-auth-portal-late-${authStamp}@northwind.example`,
  portalLateLink: `doc032-bridge-auth-portal-latelink-${authStamp}@northwind.example`,
  unapproved: `doc032-bridge-auth-unapproved-${authStamp}@unlisted.example`,
  uninvitedStaff: `doc032-bridge-auth-uninvited-${authStamp}@helix.example`,
  ssoBu: `doc032-bridge-auth-ssobu-${authStamp}@helix.example`,
  newcomer: `doc032-bridge-auth-newcomer-${authStamp}@helix.example`,
};
const authRegion = (page, name) => page.getByRole("region", { name });
async function openAuthentication(page, base = AO.app) {
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
  return (await api(page, AO.app, "GET", "/api/v1/auth/methods")).data.policy;
}
async function domainsNow(page) {
  return (await api(page, AO.app, "GET", "/api/v1/auth/allowed-domains")).data.domains;
}
async function addDomain(page, domain) {
  await page.getByLabel("Allowed email domains").fill(domain);
  await authRegion(page, "Business Portal Authentication")
    .getByRole("button", { name: "Add", exact: true })
    .click();
  await page.getByRole("button", { name: `Remove ${domain}` }).waitFor();
}
async function removeDomain(page, domain) {
  await page.getByRole("button", { name: `Remove ${domain}` }).click();
  await page.getByRole("button", { name: `Remove ${domain}` }).waitFor({ state: "detached" });
}
async function magicLinkFor(page, email, portal, since) {
  await requestMagicLink(page, AO.app, email, portal);
  return latestMail(AO.mail, email, since, MAGIC, 16);
}
async function passwordSetupRequest(page, email, portal = true) {
  await page.goto(`${AO.app}${portal ? "/portal/login" : "/auth/login"}`);
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
  await page.goto(`${AO.app}${portal ? "/portal/login" : "/auth/login"}`);
  await page.getByRole("heading", { level: 1 }).first().waitFor();
  await page.waitForLoadState("networkidle");
  const offered = await buttons(page);
  if (!(await page.getByLabel("Password", { exact: true }).count())) {
    const b = page
      .getByRole("button", { name: /Sign in with a password|Administrator sign-in/ })
      .first();
    // The page offers no password choice at all: record that as the outcome.
    if (!(await b.count())) {
      const me = await api(page, AO.app, "GET", "/api/v1/me");
      return {
        offered,
        outcome: "password-not-offered",
        alert: null,
        me: me.status,
        role: me.data?.user?.role,
        path: new URL(page.url()).pathname,
      };
    }
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
  await page.waitForLoadState("networkidle");
  const me = await api(page, AO.app, "GET", "/api/v1/me");
  return {
    offered,
    outcome,
    alert,
    me: me.status,
    role: me.data?.user?.role,
    path: new URL(page.url()).pathname,
  };
}
async function authAdmin() {
  const c = await context();
  await signIn(c.page, AO.app, DANIEL);
  return c;
}
const users = async (page) => (await api(page, AO.app, "GET", "/api/v1/users")).data.users;

async function policy() {
  const { app, mail } = AO;
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
  const expiryLink = await magicLinkFor(
    expiryCtx.page,
    "tom.iwu@helix.example",
    false,
    expirySince,
  );
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
          .evaluateAll((els) =>
            els.map(
              (e) =>
                `${document.querySelector(`label[for="${e.id}"]`)?.innerText}:${e.getAttribute("aria-checked")}${e.disabled ? ":disabled" : ""}`,
            ),
          );
      }
      const legal = authRegion(page, "Legal User Authentication");
      const ssoRow = legal
        .locator("div", { has: page.getByText("Single sign-on (SSO)", { exact: true }) })
        .last();
      await ssoRow.getByRole("button", { name: "More information" }).focus();
      const tip = page
        .getByRole("dialog")
        .or(page.locator("[data-radix-popper-content-wrapper]"))
        .first();
      await tip.waitFor({ timeout: 5000 });
      const tooltip = (await tip.innerText()).trim();
      await page.keyboard.press("Escape");
      const recovery = (await legal.innerText()).includes(
        "Administrators retain emergency password sign-in. Any required two-factor authentication still applies.",
      );
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
      expect(
        tooltip === "Configure an identity provider below to enable single sign-on." && recovery,
        `tooltip "${tooltip}" recovery ${recovery}`,
      );
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
      expect(
        Object.values(out).every(
          (x) =>
            x.second === "Enable at least one sign-in method." &&
            x.stored.password &&
            !x.stored.magicLink,
        ),
        JSON.stringify(out),
      );
      expect(
        after.legal.magicLink &&
          after.legal.password &&
          after.business.magicLink &&
          after.business.password,
        JSON.stringify(after),
      );
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
      expect(
        saved === "Saved" &&
          adminResult.me === 200 &&
          legalResult.me === 401 &&
          after.legal.password,
        `admin ${JSON.stringify(adminResult)} legal ${JSON.stringify(legalResult)}`,
      );
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
        [authAccounts.pending, "DOC-032 bridge V-C37 pending"],
        [authAccounts.offDomain, "DOC-032 bridge V-C37 off-domain"],
        [authAccounts.ssoStaff, "DOC-032 bridge V-C37 SSO staff"],
      ]) {
        const d = await invite(page, name, email, "Legal team member");
        await d.waitFor({ state: "hidden" });
      }
      await openUsers(page, app);
      const states = {};
      for (const e of [authAccounts.pending, authAccounts.offDomain, authAccounts.ssoStaff])
        states[e] = (await rowState(page, e)).status;
      expect(
        Object.values(states).every((s) => s === "Invited"),
        JSON.stringify(states),
      );
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
        out.push({
          email,
          sent: sent.match(/It expires in 5 minutes and works once\./)?.[0] ?? sent.slice(0, 120),
          me: me.status,
          role: me.data?.user?.role,
          mailLine: /expires in 5 minutes and can be used once/.test(m.html),
        });
        await c.ctx.close();
        if (email === authAccounts.pending) {
          const r = await context();
          await r.page.goto(m.link);
          await r.page.waitForLoadState("networkidle");
          const rme = await api(r.page, app, "GET", "/api/v1/me");
          const rtext = (await r.page.locator("main").innerText())
            .replace(/\s+/g, " ")
            .slice(0, 200);
          reuse = { path: new URL(r.page.url()).pathname, me: rme.status, text: rtext };
          await r.ctx.close();
        }
      }
      await openUsers(admin.page, app);
      const states = {};
      for (const e of [authAccounts.pending, authAccounts.offDomain])
        states[e] = (await rowState(admin.page, e)).status;
      expect(
        out.every((x) => x.me === 200 && x.role === "legal_team_member" && x.mailLine),
        JSON.stringify(out),
      );
      expect(
        Object.values(states).every((s) => s === "Active"),
        JSON.stringify(states),
      );
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
      await c.page
        .waitForURL((u) => u.pathname.startsWith("/portal"), { timeout: 20000 })
        .catch(() => {});
      await c.page.waitForLoadState("networkidle");
      const landed = new URL(c.page.url()).pathname;
      const me = await api(c.page, app, "GET", "/api/v1/me");
      await c.ctx.close();
      expect(
        landed.startsWith("/portal") && me.data?.user?.role === "business_user",
        `${landed} ${me.data?.user?.role}`,
      );
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
      expect(
        JSON.stringify(domains) === JSON.stringify(["helix.example", "northwind.example"]),
        JSON.stringify(domains),
      );
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
      await portalSession.page.waitForURL((u) => u.pathname.startsWith("/portal"), {
        timeout: 20000,
      });
      const me = await api(portalSession.page, app, "GET", "/api/v1/me");
      const u = await context();
      const since2 = new Date(Date.now() - 1000);
      const sent = await requestMagicLink(u.page, app, authAccounts.unapproved, true);
      await passwordSetupRequest(u.page, authAccounts.unapproved);
      await sleep(3000);
      const n = await countMail(mail, authAccounts.unapproved, since2);
      await u.ctx.close();
      const all = await users(admin.page);
      expect(
        me.data?.user?.role === "business_user" &&
          n === 0 &&
          !all.some((x) => x.email === authAccounts.unapproved),
        `role ${me.data?.user?.role}, mails ${n}`,
      );
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
      const earlier = await magicLinkFor(
        earlierCtx.page,
        authAccounts.portalNew,
        true,
        new Date(Date.now() - 1000),
      );
      const lateCtx = await context();
      const since2 = new Date(Date.now() - 1000);
      await passwordSetupRequest(lateCtx.page, authAccounts.portalLate);
      const late = await latestMail(mail, authAccounts.portalLate, since2, SET_PASSWORD);
      const lateLinkCtx = await context();
      const lateLink = await magicLinkFor(
        lateLinkCtx.page,
        authAccounts.portalLateLink,
        true,
        new Date(Date.now() - 1000),
      );
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
      await requestMagicLink(
        y.page,
        app,
        `doc032-bridge-auth-portal-after-${stamp}@northwind.example`,
        true,
      );
      await sleep(3000);
      obs.newAddressLinks = await countMail(
        mail,
        `doc032-bridge-auth-portal-after-${stamp}@northwind.example`,
        since4,
      );
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
      obs.latePasswordSetup = (await lateCtx.page.locator("main").innerText())
        .replace(/\s+/g, " ")
        .slice(0, 200);
      await lateCtx.ctx.close();
      await lateLinkCtx.page.goto(lateLink.link);
      await lateLinkCtx.page.waitForLoadState("networkidle");
      const lu = new URL(lateLinkCtx.page.url());
      obs.lateLink = `${lu.pathname}${lu.searchParams.get("error") ? `?error=${lu.searchParams.get("error")}` : ""} me ${(await api(lateLinkCtx.page, app, "GET", "/api/v1/me")).status}: ${(await lateLinkCtx.page.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 160)}`;
      await lateLinkCtx.ctx.close();
      const s = await context();
      const staff = await magicLinkFor(
        s.page,
        authAccounts.pending,
        false,
        new Date(Date.now() - 1000),
      );
      obs.staffLink = !!staff;
      await s.ctx.close();
      const all = await users(page);
      obs.lateAccounts = all.filter((u) =>
        [authAccounts.portalLate, authAccounts.portalLateLink].includes(u.email),
      ).length;
      await openAuthentication(page);
      await addDomain(page, "northwind.example");
      expect(
        obs.existingNewLink &&
          obs.existingNewLinkMe === 200 &&
          obs.newAddressLinks === 0 &&
          obs.heldSession === 200 &&
          obs.earlierLink.endsWith("me 200") &&
          pwr.me === 200,
        JSON.stringify(obs),
      );
      expect(
        obs.lateAccounts === 0 &&
          /Password setup is no longer available for this address\./.test(obs.latePasswordSetup) &&
          / me 401/.test(obs.lateLink) &&
          obs.staffLink,
        JSON.stringify(obs),
      );
      return `After Remove northwind.example: ${JSON.stringify(obs)}. The domain was added back.`;
    },
    admin.page,
  );

  async function businessSwitches(page) {
    return authRegion(page, "Business Portal Authentication")
      .getByRole("switch")
      .evaluateAll((els) =>
        els.map(
          (e) =>
            `${document.querySelector(`label[for="${e.id}"]`)?.innerText}:${e.getAttribute("aria-checked")}${e.disabled ? ":disabled" : ""}`,
        ),
      );
  }
  async function disabledReason(page, card, label) {
    const group = authRegion(page, card).getByRole("group", { name: label });
    await group.focus();
    const tip = page.getByRole("tooltip").first();
    await tip.waitFor({ timeout: 5000 });
    const text = (await tip.innerText()).trim();
    await page.keyboard.press("Escape");
    await group.blur();
    await sleep(300);
    return text;
  }
  async function portalPage() {
    const c = await context();
    await c.page.goto(`${app}/portal/login`);
    await c.page.getByRole("heading", { level: 1 }).first().waitFor();
    await c.page.waitForLoadState("networkidle");
    await sleep(300);
    const text = (await c.page.locator("main").innerText()).replace(/\s+/g, " ");
    const b = await buttons(c.page);
    await c.ctx.close();
    return { text: text.slice(0, 200), buttons: b };
  }

  let emptyDomains;
  await step(
    A3,
    "administrator",
    "Remove the last allowed domain: the card shows the no-domains message; Business sign-in methods show off and all four switches are unavailable with the domain tooltip; Require two-factor authentication keeps its value; Invite user offers staff roles only",
    `"No domains allowed yet. New users must be invited individually."; switches off and unavailable; tooltips; two invite roles`,
    async () => {
      const { page } = admin;
      await openAuthentication(page);
      emptyDomains = await domainsNow(page);
      const policyBefore = (await policyNow(page)).business;
      for (const d of emptyDomains) await removeDomain(page, d);
      await sleep(500);
      const text = (await authRegion(page, "Business Portal Authentication").innerText()).replace(
        /\s+/g,
        " ",
      );
      const switches = await businessSwitches(page);
      const stored = (await policyNow(page)).business;
      const tips = {
        "Email and password": await disabledReason(
          page,
          "Business Portal Authentication",
          "Email and password",
        ),
        "Single sign-on (SSO)": await disabledReason(
          page,
          "Business Portal Authentication",
          "Single sign-on (SSO)",
        ),
        "Require two-factor authentication": await disabledReason(
          page,
          "Business Portal Authentication",
          "Require two-factor authentication",
        ),
      };
      await page.reload();
      await authRegion(page, "Business Portal Authentication").waitFor();
      const switchesAfterReload = await businessSwitches(page);
      await openUsers(page, app);
      await page.getByRole("button", { name: "Invite user" }).click();
      const dialog = page.getByRole("dialog", { name: "Invite user" });
      const radios = await dialog
        .getByRole("radio")
        .evaluateAll((els) => els.map((e) => e.closest("label")?.innerText.trim()));
      await dialog.getByRole("button", { name: "Cancel" }).click();
      expect(
        text.includes("No domains allowed yet. New users must be invited individually."),
        text,
      );
      expect(
        switches.every((x) => x.endsWith(":disabled")) &&
          switches.slice(0, 3).every((x) => x.endsWith(":false:disabled")) &&
          JSON.stringify(switchesAfterReload) === JSON.stringify(switches),
        JSON.stringify({ switches, switchesAfterReload }),
      );
      expect(
        !stored.password &&
          !stored.magicLink &&
          !stored.sso &&
          stored.requireTwoFactor === policyBefore.requireTwoFactor &&
          switches[3] ===
            `Require two-factor authentication:${policyBefore.requireTwoFactor}:disabled`,
        `${JSON.stringify(policyBefore)} -> ${JSON.stringify(stored)}`,
      );
      expect(
        tips["Email and password"] ===
          "Add an allowed email domain to enable Business User sign-in options." &&
          tips["Require two-factor authentication"] ===
            "Add an allowed email domain to enable Business User sign-in options." &&
          tips["Single sign-on (SSO)"] ===
            "Add an allowed email domain and configure an identity provider to enable single sign-on.",
        JSON.stringify(tips),
      );
      expect(
        JSON.stringify(radios) === JSON.stringify(["Legal team member", "Administrator"]),
        `${radios}`,
      );
      return `Removed ${JSON.stringify(emptyDomains)}. The card read "No domains allowed yet. New users must be invited individually." Switches ${JSON.stringify(switches)} (same after reload). Stored business policy went from ${JSON.stringify(policyBefore)} to ${JSON.stringify(stored)}. Tooltips (no identity provider registered yet): ${JSON.stringify(tips)}. Invite user offered ${JSON.stringify(radios)}.`;
    },
    admin.page,
  );

  await step(
    A3,
    "business_user",
    "After the last domain is removed: the Business Portal sign-in page shows the unavailable message; an existing Business User can no longer sign in; a session already held keeps working",
    `"Sign-in is unavailable. Contact your administrator."; password sign-in refused; held session answers 200`,
    async () => {
      const portal = await portalPage();
      const c = await context();
      const staffPage = await passwordSignIn(
        c.page,
        authAccounts.portalPassword,
        AUTH_PASSWORD,
        false,
      );
      await c.ctx.close();
      const since = new Date(Date.now() - 1000);
      const m = await context();
      const linkReq = await requestMagicLink(m.page, app, authAccounts.portalPassword, false)
        .then((t) => ({ status: `"${t.slice(0, 90)}"` }))
        .catch((e) => ({ status: `no confirmation (${String(e).slice(0, 60)})` }));
      await sleep(3000);
      const links = await countMail(mail, authAccounts.portalPassword, since);
      await m.ctx.close();
      const held = await api(portalSession.page, app, "GET", "/api/v1/me");
      expect(
        portal.text.includes("Sign-in is unavailable. Contact your administrator.") &&
          !portal.buttons.includes("Sign in") &&
          !portal.buttons.includes("Email me a sign-in link"),
        JSON.stringify(portal),
      );
      expect(staffPage.me === 401 && links === 0, `${JSON.stringify(staffPage)} links ${links}`);
      expect(held.status === 200 && held.data.user.role === "business_user", `held ${held.status}`);
      return `The Business Portal sign-in page read "${portal.text.slice(0, 110)}" with buttons ${JSON.stringify(portal.buttons)}. ${authAccounts.portalPassword} tried Email and password on the staff page and was refused ("${staffPage.alert ?? staffPage.outcome}", me ${staffPage.me}); a sign-in link request on the staff page answered ${linkReq.status} and Mailpit received ${links} links. The Business User session held since earlier (${authAccounts.portalNew}) still answered ${held.status} as ${held.data.user.role}.`;
    },
    admin.page,
  );

  await step(
    A3,
    "administrator",
    "To reopen the Portal, add a domain, then turn on at least one method: adding a domain does not turn the methods back on",
    "After Add the switches are available but off and the Portal page stays unavailable; after turning on Email and password and Email magic link the Business User signs in again",
    async () => {
      const { page } = admin;
      await openAuthentication(page);
      for (const d of emptyDomains) await addDomain(page, d);
      await sleep(400);
      const switches = await businessSwitches(page);
      const stored = (await policyNow(page)).business;
      const portal = await portalPage();
      const a = await toggle(page, "Business Portal Authentication", "Email and password");
      const b = await toggle(page, "Business Portal Authentication", "Email magic link");
      const after = (await policyNow(page)).business;
      const c = await context();
      const pwr = await passwordSignIn(c.page, authAccounts.portalPassword, AUTH_PASSWORD, true);
      await c.ctx.close();
      expect(
        switches.slice(0, 2).every((x) => x.endsWith(":false")) &&
          !stored.password &&
          !stored.magicLink &&
          portal.text.includes("Sign-in is unavailable."),
        `${JSON.stringify(switches)} ${JSON.stringify(stored)} ${JSON.stringify(portal)}`,
      );
      expect(
        a === "Saved" && b === "Saved" && after.password && after.magicLink && pwr.me === 200,
        `${a} ${b} ${JSON.stringify(after)} ${JSON.stringify(pwr)}`,
      );
      return `After adding ${JSON.stringify(emptyDomains)} again, the switches read ${JSON.stringify(switches)} (available, methods off) and the Portal page still read "${portal.text.slice(0, 90)}". Turning on Email and password ("${a}") and Email magic link ("${b}") stored ${JSON.stringify(after)}, and ${authAccounts.portalPassword} signed in on the Portal page again (me ${pwr.me}, ${pwr.role}).`;
    },
    admin.page,
  );

  await step(
    A3,
    "administrator",
    "Require two-factor authentication under Business Portal Authentication keeps its value when the last domain is removed",
    "On before removal; after removal the switch shows on and unavailable and the stored value stays on",
    async () => {
      const { page } = admin;
      await openAuthentication(page);
      const on = await toggle(
        page,
        "Business Portal Authentication",
        "Require two-factor authentication",
      );
      for (const d of emptyDomains) await removeDomain(page, d);
      await sleep(400);
      const switches = await businessSwitches(page);
      const stored = (await policyNow(page)).business;
      for (const d of emptyDomains) await addDomain(page, d);
      await toggle(page, "Business Portal Authentication", "Email and password");
      await toggle(page, "Business Portal Authentication", "Email magic link");
      await toggle(page, "Business Portal Authentication", "Require two-factor authentication");
      const restored = (await policyNow(page)).business;
      const domains = await domainsNow(page);
      expect(
        on === "Saved" &&
          switches[3] === "Require two-factor authentication:true:disabled" &&
          stored.requireTwoFactor === true &&
          !stored.password,
        `${on} ${JSON.stringify(switches)} ${JSON.stringify(stored)}`,
      );
      expect(
        restored.password && restored.magicLink && !restored.requireTwoFactor,
        JSON.stringify(restored),
      );
      return `Require two-factor authentication was turned on ("${on}"). After removing every domain the switches read ${JSON.stringify(switches)} and the stored business policy was ${JSON.stringify(stored)}. The domains ${JSON.stringify(domains)}, Email and password, Email magic link and the two-factor value were restored (${JSON.stringify(restored)}).`;
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
      const earlier = await magicLinkFor(
        c.page,
        "clara.fontaine@helix.example",
        true,
        new Date(Date.now() - 1000),
      );
      await openAuthentication(page);
      const saved = await toggle(page, "Business Portal Authentication", "Email magic link");
      await c.page.goto(earlier.link);
      await c.page.waitForLoadState("networkidle");
      const me = await api(c.page, app, "GET", "/api/v1/me");
      const u = new URL(c.page.url());
      const landed = `${u.pathname}${u.search ? `?${[...u.searchParams.keys()].join("&")}` : ""}`;
      const landedText = (await c.page.locator("main").innerText())
        .replace(/\s+/g, " ")
        .slice(0, 200);
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
      expect(
        me.status === 401 &&
          !portalButtons.includes("Email me a sign-in link") &&
          pwr.me === 200 &&
          after.business.magicLink,
        `me ${me.status} buttons ${portalButtons} pw ${pwr.me}`,
      );
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
      const text = (await expiryCtx.page.locator("main").innerText())
        .replace(/\s+/g, " ")
        .slice(0, 200);
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
  const r = await fetch(OIDC_CONTROL, {
    method: "POST",
    body: JSON.stringify({ sub, email, name }),
  });
  return r.json();
}
const lastIssuer = async () => (await (await fetch(OIDC_CONTROL)).json()).lastIssuer;
/** Signs in through the identity provider in a fresh browser. With two or more
 * providers the page first asks for Email; the address decides the provider. */
async function ssoRoundTrip(portal, identity, keep = false) {
  await idpIdentity(...identity);
  const c = await context();
  const { page } = c;
  await page.goto(`${AO.app}${portal ? "/portal/login" : "/auth/login"}`);
  await page.getByRole("heading", { level: 1 }).first().waitFor();
  await page.waitForLoadState("networkidle");
  const start = page.url();
  const byEmail = (await page.locator("#sso-email").count()) > 0;
  if (byEmail) await page.locator("#sso-email").fill(identity[1]);
  await page.getByRole("button", { name: "Continue with single sign-on" }).click();
  await page
    .waitForURL(
      (u) =>
        u.href !== start &&
        u.host === new URL(AO.app).host &&
        !u.pathname.startsWith("/api/auth/sso") &&
        (!/\/(auth|portal)\/login$/.test(u.pathname) || u.searchParams.has("error")),
      { timeout: 30000 },
    )
    .catch(() => {});
  await page.waitForLoadState("networkidle");
  await sleep(500);
  const url = new URL(page.url());
  const me = await api(page, AO.app, "GET", "/api/v1/me");
  const alert = (
    await page
      .getByRole("alert")
      .allInnerTexts()
      .catch(() => [])
  )
    .map((x) => x.trim())
    .filter(Boolean);
  const result = {
    byEmail,
    issuer: await lastIssuer(),
    path:
      url.pathname +
      (url.searchParams.get("error") ? `?error=${url.searchParams.get("error")}` : ""),
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
  return (await api(page, AO.app, "GET", "/api/v1/auth/sso-providers")).data;
}
const identityProvider = (page) => authRegion(page, "Identity providers");
const providerHelp = (page) =>
  page.locator("p", { hasText: "Sign-in routes by the email domain a person enters" });
const PROVIDER_A = {
  name: "DOC-032 Helix IdP",
  providerId: "doc032-helix",
  issuer: "http://oidc:8080",
  domains: "helix.example",
  clientId: "doc032-client-a",
};
const PROVIDER_B = {
  name: "DOC-032 Harbor IdP",
  providerId: "doc032-harbor",
  issuer: "http://oidc:8082",
  domains: "harbor.example, ops.northwind.example",
  clientId: "doc032-client-b",
};
async function providerRows(page) {
  const list = identityProvider(page).getByRole("list").first();
  return list
    .locator(":scope > li")
    .evaluateAll((items) => items.map((li) => li.innerText.replace(/\s+/g, " ").trim()));
}
/** Add provider, fill the dialog, Register provider. Returns the dialog outcome. */
async function registerProvider(page, p) {
  await identityProvider(page).getByRole("button", { name: "Add provider" }).click();
  const dialog = page.getByRole("dialog", { name: "Add provider" });
  await dialog.waitFor();
  await dialog.getByLabel("Display name").fill(p.name);
  await dialog.getByLabel("Provider ID").fill(p.providerId);
  await dialog.getByLabel("Issuer URL").fill(p.issuer);
  await dialog.getByLabel("Email domains").fill(p.domains);
  await dialog.getByLabel("Client ID").fill(p.clientId);
  await dialog.getByLabel("Client secret").fill(p.secret ?? `fixture-${stamp}`);
  await dialog.getByRole("button", { name: "Register provider" }).click();
  const outcome = await Promise.race([
    dialog.waitFor({ state: "hidden", timeout: 30000 }).then(() => "closed"),
    dialog
      .getByRole("alert")
      .waitFor({ timeout: 30000 })
      .then(() => "alert"),
  ]).catch(() => "timeout");
  let alert = null;
  if (outcome === "alert") {
    alert = (await dialog.getByRole("alert").innerText()).trim();
    await dialog.getByRole("button", { name: "Cancel" }).click();
  }
  return { outcome, alert };
}
async function editProvider(page, name, fill) {
  await identityProvider(page)
    .getByRole("button", { name: `Edit ${name}` })
    .click();
  const dialog = page.getByRole("dialog", { name: `Edit ${name}` });
  await dialog.waitFor();
  const fields = {
    providerId: await dialog.getByLabel("Provider ID").count(),
    secretValue: await dialog.getByLabel("Client secret").inputValue(),
  };
  await fill(dialog);
  await dialog.getByRole("button", { name: "Save provider" }).click();
  const outcome = await Promise.race([
    dialog.waitFor({ state: "hidden", timeout: 30000 }).then(() => "closed"),
    dialog
      .getByRole("alert")
      .waitFor({ timeout: 30000 })
      .then(() => "alert"),
  ]).catch(() => "timeout");
  let alert = null;
  if (outcome === "alert") {
    alert = (await dialog.getByRole("alert").innerText()).trim();
    await dialog.getByRole("button", { name: "Cancel" }).click();
  }
  return { outcome, alert, fields };
}
async function callbackShown(page) {
  const code = providerHelp(page).locator("code");
  return (await code.count()) ? (await code.innerText()).trim() : null;
}
async function helpTooltip(page, scope, labelText) {
  const wrap = scope.locator("span", { has: page.locator("label", { hasText: labelText }) }).last();
  await wrap.getByRole("button", { name: "More information" }).focus();
  const tip = page
    .getByRole("tooltip")
    .or(page.locator("[data-radix-popper-content-wrapper]"))
    .first();
  await tip.waitFor({ timeout: 5000 });
  const text = (await tip.innerText()).trim();
  await page.keyboard.press("Escape");
  await sleep(300);
  return text;
}
const harborStaff = () => `doc032-bridge-auth-harbor-r2-${authStamp}@harbor.example`;

async function sso() {
  const { app } = AO;
  if (!OIDC_CONTROL) throw new Error("The bao OIDC fixture is not running");
  const admin = await authAdmin();
  const staffIdentity = [
    "doc032-idp-sso-staff",
    authAccounts.ssoStaff,
    "DOC-032 bridge V-C37 SSO staff",
  ];
  const harborIdentity = [
    "doc032-idp-harbor-staff-r2",
    harborStaff(),
    "DOC-032 bridge V-C37 Harbor staff",
  ];
  results.oidcFixture = `oauth2-mock-server 9.2.0 in container ${AO.project}-oidc-1 (${OIDC_IP}), issuers http://oidc:8080 and http://oidc:8082`;

  await step(
    A3,
    "administrator",
    "Configure single sign-on step 3: the Identity providers card, Add provider, and its fields; Register provider with an issuer that cannot be reached is refused",
    "Dialog with Display name, Provider ID, Issuer URL, Email domains, Client ID, Client secret; the comma help; refused; nothing registered",
    async () => {
      const { page } = admin;
      await openAuthentication(page);
      await identityProvider(page).getByRole("button", { name: "Add provider" }).click();
      const dialog = page.getByRole("dialog", { name: "Add provider" });
      await dialog.waitFor();
      const labels = await dialog
        .locator("label")
        .evaluateAll((ls) => ls.map((l) => l.innerText.trim()).filter(Boolean));
      const domainsHelp = await helpTooltip(page, dialog, "Email domains");
      await dialog.getByRole("button", { name: "Cancel" }).click();
      const r = await registerProvider(page, {
        ...PROVIDER_A,
        issuer: "http://doc032-unreachable-issuer.invalid:8080",
      });
      const providers = await providerNow(page);
      expect(
        [
          "Display name",
          "Provider ID",
          "Issuer URL",
          "Email domains",
          "Client ID",
          "Client secret",
        ].every((l) => labels.includes(l)),
        JSON.stringify(labels),
      );
      expect(/^Separate several domains with commas\./.test(domainsHelp), domainsHelp);
      expect(
        r.outcome === "alert" && providers.providers.length === 0,
        `${JSON.stringify(r)} ${JSON.stringify(providers)}`,
      );
      return `Add provider opened a dialog with the labels ${JSON.stringify(labels)}. The Email domains help read "${domainsHelp}". Register provider with an unreachable issuer showed "${r.alert}" in the dialog and no provider was stored.`;
    },
    admin.page,
  );

  await step(
    A3,
    "operator",
    "Configure single sign-on steps 1, 3 and 4: the operator's OIDC client (local fixture); Register provider; copy the displayed callback URL; registration turns on nothing; the secret is never returned",
    "Row with display name, domain and Configured; callback ends /api/auth/sso/callback on the instance address; SSO switches stay off but become available",
    async () => {
      const { page } = admin;
      await openAuthentication(page);
      const before = await policyNow(page);
      const r = await registerProvider(page, PROVIDER_A);
      const callback = await callbackShown(page);
      const helpText = (await providerHelp(page).innerText()).replace(/\s+/g, " ");
      const rows = await providerRows(page);
      const pol = await policyNow(page);
      const providers = await providerNow(page);
      const ssoSwitches = await page
        .getByRole("switch", { name: "Single sign-on (SSO)" })
        .evaluateAll((els) =>
          els.map((e) => `${e.getAttribute("aria-checked")}${e.disabled ? ":disabled" : ""}`),
        );
      const secretShown = JSON.stringify(providers).includes(`fixture-${stamp}`);
      expect(
        r.outcome === "closed" && callback === `${app}/api/auth/sso/callback`,
        `${JSON.stringify(r)} callback ${callback}`,
      );
      expect(
        rows.length === 1 &&
          rows[0].includes(PROVIDER_A.name) &&
          rows[0].includes("helix.example") &&
          rows[0].includes("Configured"),
        JSON.stringify(rows),
      );
      expect(
        JSON.stringify(pol) === JSON.stringify(before) && !pol.legal.sso && !secretShown,
        `pol ${JSON.stringify(pol)} secret ${secretShown}`,
      );
      expect(
        ssoSwitches.every((x) => x === "false"),
        `switches ${ssoSwitches}`,
      );
      return `Register provider closed the dialog. The card listed ${JSON.stringify(rows)}. Below the card: "${helpText.slice(0, 260)}". The instance address is BASE_URL ${app}. Both group policies were unchanged and both Single sign-on (SSO) switches were off and available (${JSON.stringify(ssoSwitches)}). GET /api/v1/auth/sso-providers did not contain the client secret.`;
    },
    admin.page,
  );

  await step(
    A3,
    "administrator",
    "Configure single sign-on steps 5 and 6: turn on SSO under Legal User Authentication; with one provider the sign-in page offers a single Continue with single sign-on button; an invited staff account signs in through the identity provider",
    "Single button, no email field; callback succeeds; role Legal team member; the invited row becomes Active",
    async () => {
      const { page } = admin;
      await openAuthentication(page);
      const saved = await toggle(page, "Legal User Authentication", "Single sign-on (SSO)");
      const r = await ssoRoundTrip(false, staffIdentity);
      await openUsers(page, app);
      const state = await rowState(page, authAccounts.ssoStaff);
      expect(
        saved === "Saved" &&
          !r.byEmail &&
          r.issuer === "http://oidc:8080" &&
          r.me === 200 &&
          r.role === "legal_team_member" &&
          state.status === "Active",
        `${saved} ${JSON.stringify(r)} ${JSON.stringify(state)}`,
      );
      return `The switch showed "${saved}". In a separate browser the staff sign-in page offered one Continue with single sign-on button and no Email field (by email: ${r.byEmail}). It went through ${r.issuer}/authorize and the OpenLaw callback to ${r.path}, signed in as ${r.role}. The invited row now read ${state.status} with a role control (${state.roleControl}).`;
    },
    admin.page,
  );

  await step(
    A3,
    "administrator",
    "Matching an allowed email domain does not grant an uninvited person a staff role",
    "No staff session and no staff account",
    async () => {
      const r = await ssoRoundTrip(false, [
        `doc032-idp-uninvited-${stamp}`,
        authAccounts.uninvitedStaff,
        "DOC-032 bridge V-C37 uninvited",
      ]);
      const created = (await users(admin.page)).find(
        (u) => u.email === authAccounts.uninvitedStaff,
      );
      const pol = await policyNow(admin.page);
      expect(
        !["administrator", "legal_team_member"].includes(r.role) &&
          !(created && created.role !== "business_user"),
        `${JSON.stringify(r)} ${JSON.stringify(created)}`,
      );
      return `With Business Portal SSO ${pol.business.sso ? "on" : "off"} and helix.example on the allowed list, ${authAccounts.uninvitedStaff} ended on ${r.path} with me ${r.me}${r.alert.length ? ` and "${r.alert.join(" ")}"` : ""}. Account created: ${created ? created.role : "none"}.`;
    },
    admin.page,
  );

  await step(
    A3,
    "administrator",
    "Update a registered provider: Edit {name}; Provider ID is fixed; Save provider with Client secret blank keeps it; a replacement rotates it; test a fresh sign-in after each",
    "No Provider ID field; the Client secret help; saved both times; SSO works after each",
    async () => {
      const { page } = admin;
      await openAuthentication(page);
      let hint = null;
      const blank = await editProvider(page, PROVIDER_A.name, async (dialog) => {
        hint = await helpTooltip(page, dialog, "Client secret");
        await dialog.getByLabel("Client ID").fill(`${PROVIDER_A.clientId}-${stamp}`);
      });
      const r1 = await ssoRoundTrip(false, staffIdentity);
      await page.reload();
      await identityProvider(page).waitFor();
      const rotated = await editProvider(page, PROVIDER_A.name, async (dialog) => {
        await dialog.getByLabel("Client secret").fill(`fixture-rotated-${stamp}`);
      });
      const r2 = await ssoRoundTrip(false, staffIdentity);
      expect(
        hint === "Leave blank to keep the current secret. Paste a new value to rotate." &&
          blank.fields.providerId === 0 &&
          blank.fields.secretValue === "" &&
          blank.outcome === "closed" &&
          rotated.outcome === "closed" &&
          r1.me === 200 &&
          r2.me === 200,
        `hint ${hint} blank ${JSON.stringify(blank)} rotated ${JSON.stringify(rotated)} r1 ${JSON.stringify(r1)} r2 ${JSON.stringify(r2)}`,
      );
      return `Edit ${PROVIDER_A.name} opened a dialog with no Provider ID field and an empty Client secret; its help read "${hint}". Saving a Client ID change with the secret blank closed the dialog; a fresh staff SSO sign-in worked (me ${r1.me}). Saving a replacement secret closed the dialog; another fresh sign-in worked (me ${r2.me}).`;
    },
    admin.page,
  );

  await step(
    A3,
    "administrator",
    "Update negative: an issuer that cannot be reached is refused and the previous provider configuration stays in place",
    "Refused; stored issuer unchanged; SSO still works",
    async () => {
      const { page } = admin;
      await openAuthentication(page);
      const r = await editProvider(page, PROVIDER_A.name, async (dialog) => {
        await dialog.getByLabel("Issuer URL").fill("http://doc032-unreachable-issuer.invalid:8080");
      });
      const p = (await providerNow(page)).providers.find(
        (x) => x.providerId === PROVIDER_A.providerId,
      );
      const s = await ssoRoundTrip(false, staffIdentity);
      expect(
        r.outcome === "alert" && p.issuer === "http://oidc:8080" && s.me === 200,
        `${JSON.stringify(r)} issuer ${p.issuer} ${JSON.stringify(s)}`,
      );
      return `Save provider with an unreachable issuer showed "${r.alert}" in the dialog. The stored issuer stayed ${p.issuer} and a fresh staff SSO sign-in still worked (me ${s.me}).`;
    },
    admin.page,
  );

  await step(
    A3,
    "administrator",
    "Several identity providers: register a second provider with two comma-separated domains; every provider uses the same callback URL",
    "Two rows; the second lists both domains and Configured; the callback is the same",
    async () => {
      const { page } = admin;
      await openAuthentication(page);
      const r = await registerProvider(page, PROVIDER_B);
      const callback = await callbackShown(page);
      const rows = await providerRows(page);
      const stored = (await providerNow(page)).providers.find(
        (x) => x.providerId === PROVIDER_B.providerId,
      );
      expect(
        r.outcome === "closed" && callback === `${app}/api/auth/sso/callback`,
        `${JSON.stringify(r)} ${callback}`,
      );
      expect(
        rows.length === 2 &&
          rows.some(
            (x) =>
              x.includes(PROVIDER_B.name) &&
              x.includes("harbor.example, ops.northwind.example") &&
              x.includes("Configured"),
          ),
        JSON.stringify(rows),
      );
      return `Register provider closed the dialog; the callback shown was ${callback}, the same as for the first provider. Rows: ${JSON.stringify(rows)}. Stored domains ${JSON.stringify(stored.domains)}.`;
    },
    admin.page,
  );

  await step(
    A3,
    "administrator",
    "An email domain can belong to one provider only: an exact domain, a subdomain, and a parent domain of another provider's domain are refused, naming the provider that holds it",
    "Three refusals, each naming the holder; nothing stored",
    async () => {
      const { page } = admin;
      await openAuthentication(page);
      const out = {};
      for (const [kind, domain] of [
        ["exact", "helix.example"],
        ["subdomain", "eu.harbor.example"],
        ["parent", "northwind.example"],
      ]) {
        out[kind] = await registerProvider(page, {
          name: `DOC-032 Overlap ${kind}`,
          providerId: `doc032-overlap-${kind}`,
          issuer: "http://oidc:8080",
          domains: domain,
          clientId: "doc032-overlap",
        });
      }
      const count = (await providerNow(page)).providers.length;
      expect(
        out.exact.alert?.includes(PROVIDER_A.name) ||
          out.exact.alert?.includes(PROVIDER_A.providerId),
        JSON.stringify(out),
      );
      expect(
        [out.subdomain, out.parent].every(
          (x) => x.alert?.includes(PROVIDER_B.name) || x.alert?.includes(PROVIDER_B.providerId),
        ) && count === 2,
        `${JSON.stringify(out)} providers ${count}`,
      );
      return `Refusals: ${JSON.stringify(out)}. The provider list still held ${count} providers.`;
    },
    admin.page,
  );

  await step(
    A3,
    "administrator",
    "With two or more providers, the sign-in page asks for the email address and opens the provider that serves its domain; an unserved domain shows the no-provider message and other methods stay available",
    "Email form with its hint; helix.example goes to the first issuer, harbor.example to the second; the unserved-domain message",
    async () => {
      const { page } = admin;
      await openUsers(page, app);
      const d = await invite(
        page,
        "DOC-032 bridge V-C37 Harbor staff",
        harborStaff(),
        "Legal team member",
      );
      await d.waitFor({ state: "hidden" });
      const anon = await context();
      await anon.page.goto(`${app}/auth/login`);
      await anon.page.getByRole("heading", { level: 1 }).first().waitFor();
      await anon.page.waitForLoadState("networkidle");
      const hint = (await anon.page.locator("main").innerText()).includes(
        "Enter your work email. Your organization's identity provider opens next.",
      );
      await anon.page.locator("#sso-email").fill(`someone-${stamp}@unlisted.example`);
      await anon.page.getByRole("button", { name: "Continue with single sign-on" }).click();
      const alert = anon.page.getByRole("alert").first();
      await alert.waitFor({ timeout: 15000 });
      const unserved = (await alert.innerText()).trim();
      const others = await buttons(anon.page);
      await anon.ctx.close();
      const helix = await ssoRoundTrip(false, staffIdentity);
      const harbor = await ssoRoundTrip(false, harborIdentity);
      await openUsers(page, app);
      const harborRow = await rowState(page, harborStaff());
      expect(hint, "no email hint");
      expect(
        unserved ===
          "No single sign-on provider is set up for unlisted.example. Check the address or contact your administrator." &&
          others.includes("Email me a sign-in link") &&
          others.includes("Sign in with a password"),
        `${unserved} ${JSON.stringify(others)}`,
      );
      expect(
        helix.byEmail && helix.issuer === "http://oidc:8080" && helix.me === 200,
        JSON.stringify(helix),
      );
      expect(
        harbor.byEmail &&
          harbor.issuer === "http://oidc:8082" &&
          harbor.me === 200 &&
          harbor.role === "legal_team_member" &&
          harborRow.status === "Active",
        `${JSON.stringify(harbor)} ${JSON.stringify(harborRow)}`,
      );
      return `The staff sign-in page read "Enter your work email. Your organization's identity provider opens next." with an Email field. An unlisted.example address showed "${unserved}", and the page still offered ${JSON.stringify(others)}. ${authAccounts.ssoStaff} was routed to ${helix.issuer} and signed in (${helix.role}). The invited ${harborStaff()} was routed to ${harbor.issuer} and signed in as ${harbor.role}; the row read ${harborRow.status}.`;
    },
    admin.page,
  );

  await step(
    A3,
    "administrator",
    "Missing credentials: a provider whose stored configuration lost its client ID shows Missing credentials; editing it and entering the client ID and secret again shows Configured",
    "Missing credentials chip after the fault; Configured after Save provider",
    async () => {
      const { page } = admin;
      // Fault injection on the owned lab: blank the second provider's stored OIDC configuration.
      const psql = (sql) =>
        execFileSync(
          "docker",
          [
            "--context",
            "default",
            "exec",
            `${AO.project}-postgres-1`,
            "psql",
            "-U",
            "openlaw",
            "-d",
            "openlaw",
            "-At",
            "-c",
            sql,
          ],
          { encoding: "utf8" },
        ).trim();
      const changed = psql(
        `update sso_providers set oidc_config = '{}' where provider_id = '${PROVIDER_B.providerId}' returning provider_id`,
      );
      await openAuthentication(page);
      const faulty = (await providerRows(page)).find((x) => x.includes(PROVIDER_B.name));
      const fixed = await editProvider(page, PROVIDER_B.name, async (dialog) => {
        await dialog.getByLabel("Client ID").fill(PROVIDER_B.clientId);
        await dialog.getByLabel("Client secret").fill(`fixture-repaired-${stamp}`);
      });
      await page.reload();
      await identityProvider(page).waitFor();
      const repaired = (await providerRows(page)).find((x) => x.includes(PROVIDER_B.name));
      const harbor = await ssoRoundTrip(false, harborIdentity);
      expect(
        changed.includes(PROVIDER_B.providerId) && faulty.includes("Missing credentials"),
        `${changed} ${faulty}`,
      );
      expect(
        fixed.outcome === "closed" && repaired.includes("Configured") && harbor.me === 200,
        `${JSON.stringify(fixed)} ${repaired} ${JSON.stringify(harbor)}`,
      );
      return `After blanking the stored configuration of ${PROVIDER_B.providerId} in the database, the row read "${faulty}". Edit, Client ID and Client secret entered again, and Save provider closed the dialog; the row read "${repaired}" and a Harbor staff sign-in worked again (me ${harbor.me}).`;
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
      const identity = [
        `doc032-idp-bu-${stamp}`,
        authAccounts.ssoBu,
        "DOC-032 bridge V-C37 Portal BU",
      ];
      const first = await ssoRoundTrip(true, identity);
      await removeDomain(page, "helix.example");
      const domains = await domainsNow(page);
      const afterRemoval = await ssoRoundTrip(true, identity);
      const refused = await ssoRoundTrip(true, [
        `doc032-idp-newcomer-${stamp}`,
        authAccounts.newcomer,
        "DOC-032 bridge V-C37 newcomer",
      ]);
      const created = (await users(page)).find((u) => u.email === authAccounts.newcomer);
      await openAuthentication(page);
      await addDomain(page, "helix.example");
      const pol = await policyNow(page);
      expect(
        first.me === 200 && first.role === "business_user" && first.path.startsWith("/portal"),
        `first ${JSON.stringify(first)}`,
      );
      expect(
        domains.length > 0 && afterRemoval.me === 200 && afterRemoval.role === "business_user",
        `after removal ${JSON.stringify(domains)} ${JSON.stringify(afterRemoval)}`,
      );
      expect(
        refused.me === 401 && !created,
        `newcomer ${JSON.stringify(refused)} ${JSON.stringify(created)}`,
      );
      return `${authAccounts.ssoBu} entered the Portal through a sign-in link. The Business Portal SSO switch showed "${saved}". Portal single sign-on (email form: ${first.byEmail}) reached ${first.path} as ${first.role}. After Remove helix.example (list ${JSON.stringify(domains)}, not empty), the same identity still signed in through single sign-on (${afterRemoval.path}, ${afterRemoval.role}). A new identity on the removed domain ended on ${refused.path}${refused.alert.length ? ` with "${refused.alert.join(" ")}"` : ""} and no account was created. helix.example was added back (Business SSO ${pol.business.sso}).`;
    },
    admin.page,
  );

  await step(
    A3,
    "administrator",
    "Recover from a failing provider: with only SSO on under Legal, Administrator password sign-in still works; turn on Email and password and turn off SSO",
    "Administrator sign-in link; admin password sign-in works; Legal Team Member password sign-in works again; SSO off",
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
      expect(
        pol1.legal.sso &&
          !pol1.legal.password &&
          !pol1.legal.magicLink &&
          adminResult.offered.includes("Administrator sign-in") &&
          adminResult.me === 200,
        `${JSON.stringify(pol1.legal)} ${JSON.stringify(adminResult)}`,
      );
      expect(
        pol2.legal.password && !pol2.legal.sso && !pol2.business.sso && legalResult.me === 200,
        `${JSON.stringify(pol2)} ${JSON.stringify(legalResult)}`,
      );
      return `With only Single sign-on (SSO) on for Legal users (${JSON.stringify(pol1.legal)}), the staff page offered ${JSON.stringify(adminResult.offered)} and Daniel still signed in with a password through Administrator sign-in (me ${adminResult.me}). Turning Email and password and Email magic link back on and SSO off in both cards gave ${JSON.stringify(pol2)}, and Nadia signed in with a password again (me ${legalResult.me}).`;
    },
    admin.page,
  );
  await admin.ctx.close();
}

async function twoFactor() {
  const { app, mail } = AO;
  needAuthPassword();
  const tfaAdmin = {
    name: "DOC-032 bridge V-C37 2FA admin",
    email: `doc032-bridge-auth-2fa-${stamp}@helix.example`,
  };
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
      await page
        .getByRole("link", { name: "Done" })
        .or(page.getByRole("button", { name: "Done" }))
        .first()
        .click();
      await page
        .waitForURL((u) => !u.pathname.startsWith("/auth/two-factor"), { timeout: 15000 })
        .catch(() => {});
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
      const prompt = await page
        .getByText("Enter the 6-digit code from your authenticator app.")
        .count();
      const before = await api(page, app, "GET", "/api/v1/users");
      await page.getByLabel("Code").fill(totp(uri));
      await page.getByRole("button", { name: "Verify" }).click();
      await page.waitForURL((u) => !u.pathname.startsWith("/auth/"), { timeout: 15000 });
      const after = await api(page, app, "GET", "/api/v1/users");
      await c.ctx.close();
      expect(
        prompt === 1 && before.status !== 200 && after.status === 200,
        `${prompt} ${before.status} ${after.status}`,
      );
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
      const m = await magicLinkFor(
        c.page,
        authAccounts.offDomain,
        false,
        new Date(Date.now() - 1000),
      );
      expect(m, "no magic link");
      await c.page.goto(m.link);
      await c.page.waitForLoadState("networkidle");
      await c.page.goto(`${app}/`);
      await c.page.waitForLoadState("networkidle");
      out.magicLink = {
        path: new URL(c.page.url()).pathname,
        work: (await api(c.page, app, "GET", "/api/v1/matters")).status,
      };
      await c.ctx.close();
      await openAuthentication(admin.page);
      await toggle(admin.page, "Legal User Authentication", "Single sign-on (SSO)");
      const s = await ssoRoundTrip(
        false,
        ["doc032-idp-sso-staff", authAccounts.ssoStaff, "DOC-032 bridge V-C37 SSO staff"],
        true,
      );
      await s.c.page.goto(`${app}/`);
      await s.c.page.waitForLoadState("networkidle");
      out.sso = {
        callback: s.path,
        me: s.me,
        setupRequired: s.twoFactorSetupRequired,
        path: new URL(s.c.page.url()).pathname,
        work: (await api(s.c.page, app, "GET", "/api/v1/matters")).status,
      };
      await s.c.ctx.close();
      await openAuthentication(admin.page);
      await toggle(admin.page, "Legal User Authentication", "Single sign-on (SSO)");
      await toggle(admin.page, "Legal User Authentication", "Email and password");
      const d = await context();
      const dr = await passwordSignIn(d.page, DANIEL, PASSWORD);
      out.emergencyPassword = {
        path: dr.path,
        work: (await api(d.page, app, "GET", "/api/v1/users")).status,
      };
      await d.ctx.close();
      await openAuthentication(admin.page);
      await toggle(admin.page, "Legal User Authentication", "Email and password");
      const pol = await policyNow(admin.page);
      expect(
        out.magicLink.path.startsWith("/auth/two-factor/enroll") && out.magicLink.work !== 200,
        JSON.stringify(out),
      );
      expect(
        out.sso.path.startsWith("/auth/two-factor/enroll") && out.sso.work !== 200,
        JSON.stringify(out),
      );
      expect(
        out.emergencyPassword.path.startsWith("/auth/two-factor") &&
          out.emergencyPassword.work !== 200 &&
          pol.legal.password &&
          !pol.legal.sso,
        JSON.stringify(out),
      );
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
      return `The switch showed "${saved}" (${JSON.stringify(pol.legal)}). The disposable Administrator's authenticator stays enrolled.`;
    },
    admin.page,
  );
  await daniel.ctx.close();
  await admin.ctx.close();
}

async function crossPage() {
  const { app } = AO;
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
      const buOnStaff = await passwordSignIn(
        b.page,
        authAccounts.portalPassword,
        AUTH_PASSWORD,
        false,
      );
      await b.ctx.close();
      await openAuthentication(page);
      await toggle(page, "Legal User Authentication", "Email and password");
      const pol = await policyNow(page);
      expect(
        off === "Saved" &&
          legalOnPortal.me === 401 &&
          buOnStaff.me === 200 &&
          buOnStaff.role === "business_user" &&
          buOnStaff.path.startsWith("/portal") &&
          pol.legal.password,
        `${off} ${JSON.stringify(legalOnPortal)} ${JSON.stringify(buOnStaff)}`,
      );
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
      const onPortal = await passwordSignIn(
        a.page,
        authAccounts.portalPassword,
        AUTH_PASSWORD,
        true,
      );
      await a.ctx.close();
      const b = await context();
      const onStaff = await passwordSignIn(
        b.page,
        authAccounts.portalPassword,
        AUTH_PASSWORD,
        false,
      );
      await b.ctx.close();
      const c = await context();
      const link = await magicLinkFor(
        c.page,
        authAccounts.portalPassword,
        true,
        new Date(Date.now() - 1000),
      );
      await c.page.goto(link.link);
      await c.page
        .waitForURL((u) => u.pathname.startsWith("/portal"), { timeout: 20000 })
        .catch(() => {});
      const viaLink = (await api(c.page, AO.app, "GET", "/api/v1/me")).data?.user?.role;
      await c.ctx.close();
      await openAuthentication(page);
      await toggle(page, "Business Portal Authentication", "Email and password");
      const pol = await policyNow(page);
      expect(
        off === "Saved" &&
          onPortal.me === 401 &&
          onPortal.outcome === "password-not-offered" &&
          onStaff.me === 401 &&
          onStaff.outcome === "alert" &&
          viaLink === "business_user" &&
          pol.business.password,
        `${off} ${JSON.stringify(onPortal)} ${JSON.stringify(onStaff)} ${viaLink}`,
      );
      return `With Email and password off under Business Portal Authentication ("${off}"), the Portal page offered only ${JSON.stringify(onPortal.offered)}, with no password choice. On the staff page, where Legal users still have a password form, the Business User's password sign-in was refused with "${onStaff.alert}" (me ${onStaff.me}). A sign-in link still signed the same person in as ${viaLink}. Business password sign-in was turned back on.`;
    },
    admin.page,
  );
  await admin.ctx.close();
}

async function instanceField(page, base = AO.app) {
  await openSettingsPane(page, base, "Instance address");
  await page.getByLabel("Application address").waitFor();
  const text = await paneText(page);
  const field = page.getByLabel("Application address");
  return {
    text,
    summary: [
      text.match(
        /Application address (Default|Saved in OpenLaw|Deployment configuration)( · Read only)?/,
      )?.[0],
      text.match(/Active: \S+/)?.[0],
      text.match(/Saved changes are waiting for a restart\.[^.]*\./)?.[0],
    ]
      .filter(Boolean)
      .join("; "),
    value: (await field.count()) ? await field.inputValue() : null,
    readOnly: (await field.count())
      ? (await field.getAttribute("readonly")) !== null || (await field.isDisabled())
      : null,
  };
}
async function callbackNow(page, base = AO.app) {
  await openAuthentication(page, base);
  const r = await editProvider(page, PROVIDER_A.name, async (dialog) => {
    await dialog.getByLabel("Client ID").fill(`doc032-client-cb-${Date.now().toString(36)}`);
  });
  return {
    note: r.outcome === "closed" ? "Saved" : (r.alert ?? r.outcome),
    callback: r.outcome === "closed" ? await callbackShown(page) : null,
  };
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
      expect(
        /Deployment configuration/.test(f.text) &&
          /Read only/.test(f.text) &&
          cb.callback === `${AO.app}/api/auth/sso/callback`,
        `${f.text.slice(0, 400)} ${JSON.stringify(cb)}`,
      );
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
    args: [`--host-resolver-rules=MAP localhost:3000 127.0.0.1:${new URL(AO.app).port}`],
  });
  const mctx = await mappedBrowser.newContext({ viewport: { width: 1440, height: 1000 } });
  const admin = { ctx: mctx, page: await mctx.newPage() };
  const phase = (...names) => {
    const out = execFileSync(path.join(here, "phase.sh"), ["bao", ...names], {
      encoding: "utf8",
    });
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
      await anon.page.goto(`${AO.app}/auth/login`);
      await anon.page.getByLabel("Email", { exact: true }).fill(NADIA);
      await anon.page.getByLabel("Password", { exact: true }).fill(PASSWORD);
      await anon.page.getByRole("button", { name: "Sign in", exact: true }).click();
      await sleep(4000);
      const me = await api(anon.page, AO.app, "GET", "/api/v1/me");
      const alert = (await anon.page.getByRole("alert").allInnerTexts())
        .map((x) => x.trim())
        .filter(Boolean);
      await anon.ctx.close();
      await signIn(admin.page, DEFAULT_ADDRESS, DANIEL);
      const f = await instanceField(admin.page, DEFAULT_ADDRESS);
      expect(
        me.status === 401 &&
          !f.readOnly &&
          /Application address Default/.test(f.text) &&
          f.value === DEFAULT_ADDRESS,
        `me ${me.status} ${f.text.slice(0, 300)} value ${f.value} ro ${f.readOnly}`,
      );
      return `${note}. A password sign-in at ${AO.app} got me ${me.status}${alert.length ? ` with "${alert.join(" ")}"` : ""}. At ${DEFAULT_ADDRESS} Daniel signed in, and Instance address showed "${f.summary}" (field value "${f.value}", read-only ${f.readOnly}).`;
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
      await page.getByLabel("Application address").fill(AO.app);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      const notice = await page
        .getByText("Settings saved. Restart the API and worker to apply changes.")
        .innerText({ timeout: 15000 })
        .then((t) => t.trim())
        .catch(async () =>
          (await page.locator("main").getByRole("alert").allInnerTexts()).join(" | "),
        );
      expect(
        notice === "Settings saved. Restart the API and worker to apply changes.",
        `save answered "${notice}"`,
      );
      const after = await instanceField(page, DEFAULT_ADDRESS);
      const cb = await callbackNow(page, DEFAULT_ADDRESS);
      expect(
        /Saved changes are waiting for a restart/.test(after.text) &&
          cb.callback === `${DEFAULT_ADDRESS}/api/auth/sso/callback`,
        `${after.text.slice(0, 300)} ${JSON.stringify(cb)}`,
      );
      return `Entering ${AO.app} and Save showed "${notice}" The pane then showed "${after.summary}" (field value "${after.value}"). Before the restart, Save provider showed the callback ${cb.callback}.`;
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
      await signIn(c.page, AO.app, DANIEL);
      const f = await instanceField(c.page);
      const cb = await callbackNow(c.page);
      await c.ctx.close();
      expect(
        /Application address Saved in OpenLaw/.test(f.text) &&
          f.value === AO.app &&
          cb.callback === `${AO.app}/api/auth/sso/callback`,
        `${f.text.slice(0, 300)} ${f.value} ${JSON.stringify(cb)}`,
      );
      return `${note}. A password sign-in at ${AO.app} worked again. Instance address showed "${f.summary}" (field value "${f.value}"). Save provider showed the callback ${cb.callback}.`;
    },
  );
  await mappedBrowser.close();
}

async function ssoRemove() {
  const { app } = AO;
  if (!OIDC_CONTROL) throw new Error("The bao OIDC fixture is not running");
  const admin = await authAdmin();
  const harborIdentity = [
    "doc032-idp-harbor-staff-r2",
    harborStaff(),
    "DOC-032 bridge V-C37 Harbor staff",
  ];
  // Fixture reset: the lab's default policy with SSO on for Legal users.
  for (const group of ["legal", "business"])
    await api(admin.page, app, "PATCH", `/api/v1/auth/policy/${group}`, {
      password: true,
      magicLink: true,
      sso: group === "legal",
      requireTwoFactor: false,
    });
  results.startPolicy = await policyNow(admin.page);
  results.startProviders = (await providerNow(admin.page)).providers.map((p) => p.providerId);

  await step(
    A3,
    "administrator",
    "Remove {name} on a provider row deletes its configuration at once, with no confirmation; accounts that signed in through it keep their rows and sign in another way",
    "Row gone without a dialog; the other provider stays; SSO stays on; the Harbor staff row stays Active; a sign-in link still works for that account",
    async () => {
      const { page } = admin;
      await openAuthentication(page);
      let dialogs = 0;
      page.on("dialog", () => (dialogs += 1));
      await identityProvider(page)
        .getByRole("button", { name: `Remove ${PROVIDER_B.name}` })
        .click();
      await identityProvider(page)
        .getByRole("button", { name: `Remove ${PROVIDER_B.name}` })
        .waitFor({ state: "detached", timeout: 15000 });
      const confirmDialogs = dialogs + (await page.getByRole("alertdialog").count());
      const rows = await providerRows(page);
      const pol = await policyNow(page);
      await openUsers(page, app);
      const harborRow = await rowState(page, harborStaff());
      const viaIdp = await ssoRoundTrip(false, harborIdentity);
      const c = await context();
      const link = await magicLinkFor(c.page, harborStaff(), false, new Date(Date.now() - 1000));
      let viaLink = null;
      if (link) {
        await c.page.goto(link.link);
        await c.page.waitForLoadState("networkidle");
        viaLink = (await api(c.page, app, "GET", "/api/v1/me")).data?.user?.role ?? null;
      }
      await c.ctx.close();
      expect(
        confirmDialogs === 0 &&
          rows.length === 1 &&
          rows[0].includes(PROVIDER_A.name) &&
          pol.legal.sso,
        `${confirmDialogs} ${JSON.stringify(rows)} ${JSON.stringify(pol)}`,
      );
      expect(
        harborRow.status === "Active" && viaLink === "legal_team_member",
        `${JSON.stringify(harborRow)} link ${viaLink}`,
      );
      return `Remove ${PROVIDER_B.name} removed the row at once with ${confirmDialogs} confirmation dialogs; the card listed ${JSON.stringify(rows)} and Legal SSO stayed ${pol.legal.sso}. The Harbor staff row stayed ${harborRow.status}. With one provider left, Continue with single sign-on for the Harbor identity (by email: ${viaIdp.byEmail}) went to ${viaIdp.issuer} and ended on ${viaIdp.path} with me ${viaIdp.me}${viaIdp.alert.length ? ` and "${viaIdp.alert.join(" ")}"` : ""}. A sign-in link signed the same account in as ${viaLink}.`;
    },
    admin.page,
  );

  await step(
    A3,
    "administrator",
    "Removing the last provider turns off Single sign-on (SSO) under both Legal User Authentication and Business Portal Authentication; with another Legal method on, the staff sign-in page keeps it",
    "Both SSO switches off and unavailable; stored sso false in both groups; staff page offers the password form",
    async () => {
      const { page } = admin;
      await openAuthentication(page);
      const b = await toggle(page, "Business Portal Authentication", "Single sign-on (SSO)");
      const before = await policyNow(page);
      await identityProvider(page)
        .getByRole("button", { name: `Remove ${PROVIDER_A.name}` })
        .click();
      await identityProvider(page)
        .getByRole("button", { name: `Remove ${PROVIDER_A.name}` })
        .waitFor({ state: "detached", timeout: 15000 });
      await sleep(500);
      const switches = await page
        .getByRole("switch", { name: "Single sign-on (SSO)" })
        .evaluateAll((els) =>
          els.map((e) => `${e.getAttribute("aria-checked")}${e.disabled ? ":disabled" : ""}`),
        );
      const after = await policyNow(page);
      const anon = await context();
      await anon.page.goto(`${app}/auth/login`);
      await anon.page.getByRole("heading", { level: 1 }).first().waitFor();
      await anon.page.waitForLoadState("networkidle");
      const staffButtons = await buttons(anon.page);
      const passwordForm = await anon.page.getByLabel("Password", { exact: true }).count();
      await anon.ctx.close();
      expect(
        b === "Saved" && before.legal.sso && before.business.sso,
        `${b} ${JSON.stringify(before)}`,
      );
      expect(
        !after.legal.sso &&
          !after.business.sso &&
          switches.every((x) => x === "false:disabled") &&
          passwordForm === 1,
        `${JSON.stringify(after)} ${JSON.stringify(switches)} ${JSON.stringify(staffButtons)}`,
      );
      return `Before removal SSO was on in both groups (${JSON.stringify(before)}). Remove ${PROVIDER_A.name} (the last provider) left the card empty; both Single sign-on (SSO) switches read ${JSON.stringify(switches)} and the stored policy was ${JSON.stringify(after)}. The staff sign-in page offered the password form with buttons ${JSON.stringify(staffButtons)}.`;
    },
    admin.page,
  );

  await step(
    A3,
    "administrator",
    "If single sign-on was the only Legal method when the last provider is removed, the staff sign-in page shows the unavailable message and offers no Administrator sign-in link; recover from the still-open Administrator session",
    `"Sign-in is unavailable. Contact your administrator."; no Administrator sign-in; Email and password turned back on from the live session`,
    async () => {
      const { page } = admin;
      await openAuthentication(page);
      const reg = await registerProvider(page, PROVIDER_A);
      await toggle(page, "Legal User Authentication", "Single sign-on (SSO)");
      await toggle(page, "Legal User Authentication", "Email and password");
      await toggle(page, "Legal User Authentication", "Email magic link");
      const ssoOnly = (await policyNow(page)).legal;
      await identityProvider(page)
        .getByRole("button", { name: `Remove ${PROVIDER_A.name}` })
        .click();
      await identityProvider(page)
        .getByRole("button", { name: `Remove ${PROVIDER_A.name}` })
        .waitFor({ state: "detached", timeout: 15000 });
      const noMethod = (await policyNow(page)).legal;
      const anon = await context();
      await anon.page.goto(`${app}/auth/login`);
      await anon.page.getByRole("heading", { level: 1 }).first().waitFor();
      await anon.page.waitForLoadState("networkidle");
      await sleep(400);
      const text = (await anon.page.locator("main").innerText()).replace(/\s+/g, " ");
      const staffButtons = await buttons(anon.page);
      await anon.ctx.close();
      await openAuthentication(page);
      const on = await toggle(page, "Legal User Authentication", "Email and password");
      await toggle(page, "Legal User Authentication", "Email magic link");
      const restored = (await policyNow(page)).legal;
      const l = await context();
      const legalResult = await passwordSignIn(l.page, NADIA, PASSWORD);
      await l.ctx.close();
      expect(
        reg.outcome === "closed" &&
          ssoOnly.sso &&
          !ssoOnly.password &&
          !ssoOnly.magicLink &&
          !noMethod.sso,
        `${JSON.stringify(reg)} ${JSON.stringify(ssoOnly)} ${JSON.stringify(noMethod)}`,
      );
      expect(
        text.includes("Sign-in is unavailable. Contact your administrator.") &&
          !staffButtons.includes("Administrator sign-in"),
        `${text.slice(0, 200)} ${JSON.stringify(staffButtons)}`,
      );
      expect(
        on === "Saved" && restored.password && restored.magicLink && legalResult.me === 200,
        `${on} ${JSON.stringify(restored)} ${JSON.stringify(legalResult)}`,
      );
      return `The first provider was registered again and Legal User Authentication set to SSO only (${JSON.stringify(ssoOnly)}). Removing that last provider left Legal ${JSON.stringify(noMethod)}. A signed-out browser on the staff sign-in page read "${text.slice(0, 120)}" with buttons ${JSON.stringify(staffButtons)}, so no Administrator sign-in link. Daniel's open session turned Email and password ("${on}") and Email magic link back on (${JSON.stringify(restored)}), and Nadia signed in with a password (me ${legalResult.me}).`;
    },
    admin.page,
  );
  await admin.ctx.close();
}

// ---------------------------------------------------------------------------
// V-C35 first-run on the unseeded firstrun lab (and afr2 for the other lifecycles).
const pwExpect = createRequire(path.join(root, "e2e/package.json"))(
  "@playwright/test",
).expect.configure({ timeout: 15000 });
const FR_ADMIN = { name: "Avery Morgan", email: "avery.morgan@harbor.example" };
const ORG_NAME = "Harbor Legal DOC-032";
const TOKEN_MESSAGE =
  "The setup token is missing or wrong. Copy it from the server log, or from the SETUP_TOKEN environment variable.";
const ORIGIN_MESSAGE = "This request did not come from this OpenLaw instance's own origin.";
const SCRATCH = process.env.SCRATCH_DIR;
const frState = (l) => path.join(SCRATCH, `state-${l.name}.json`);
const frTotpFile = (l) => path.join(SCRATCH, `totp-${l.name}.txt`);
const frButton = (page, name) => page.getByRole("button", { name, exact: true });

/** One step of the first-run walk. A failed step ends the section unless it is marked independent. */
async function frStep(action, expected, fn, pg, { independent = false } = {}) {
  const entry = await step(F, "administrator", action, expected, fn, pg);
  if (entry.result !== "pass" && !independent) throw new Error(`stopped after: ${action}`);
  return entry;
}
async function frContext(l, { fresh = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    ...(!fresh && existsSync(frState(l)) ? { storageState: frState(l) } : {}),
  });
  return { ctx, page: await ctx.newPage() };
}
async function frSave(l, ctx) {
  mkdirSync(SCRATCH, { recursive: true });
  await ctx.storageState({ path: frState(l) });
}
const stepTitle = async (page) => (await page.locator("main h1").first().innerText()).trim();
async function expectStep(page, title, n) {
  await pwExpect(page.getByText(`Step ${n} of 8`, { exact: true })).toBeVisible();
  await pwExpect.poll(() => stepTitle(page)).toBe(title);
  return `Step ${n} of 8: ${title}`;
}
const where = (page) => {
  const u = new URL(page.url());
  return `${u.pathname}${u.search}`;
};
async function getJson(page, l, p) {
  // A fetch from a blank page has no origin; open the app first.
  if (!page.url().startsWith(l.app)) await page.goto(`${l.app}/api/v1/auth/methods`);
  const r = await api(page, l.app, "GET", p);
  expect(r.status === 200, `GET ${p} answered ${r.status}`);
  return r.data;
}
async function needsSetup(l) {
  return (await (await fetch(`${l.app}/api/v1/auth/setup`)).json()).needsSetup;
}
async function mailTo(l, address) {
  const list = await mailSearch(l.mail, `to:"${address}"`);
  return { count: list.length, subjects: list.map((m) => m.Subject), messages: list };
}
async function waitMailCount(l, address, atLeast = 1) {
  for (let i = 0; i < 60; i += 1) {
    const found = await mailTo(l, address);
    if (found.count >= atLeast) return found;
    await sleep(500);
  }
  throw new Error(`No mail reached ${address}`);
}
/** The newest message to an address: its header shows the organization name and the inline logo. */
async function mailHeaderFacts(l, address) {
  const found = await waitMailCount(l, address);
  const m = await mailMessage(l.mail, found.messages[0].ID);
  const inline = (m.Inline ?? []).map((part) => ({
    contentId: part.ContentID,
    contentType: part.ContentType,
  }));
  const header = emailHeader({ html: m.HTML ?? "" });
  return { subject: m.Subject, header, inline };
}
async function frSignIn(l, page, totpSecret) {
  await page.goto(`${l.app}/auth/login`);
  await page.getByLabel("Email", { exact: true }).fill(FR_ADMIN.email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/auth/login"), { timeout: 20000 });
  if (new URL(page.url()).pathname.startsWith("/auth/two-factor") && totpSecret) {
    await page.getByLabel("Code").fill(frTotp(totpSecret));
    await page.getByRole("button", { name: "Verify" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/auth/two-factor"), { timeout: 20000 });
  }
}
function frTotp(secret) {
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
async function outstandingRows(page) {
  const list = page.getByRole("list", { name: "Outstanding setup steps" });
  if (!(await list.count())) return [];
  return list.locator("li").evaluateAll((items) =>
    items.map((li) => {
      const a = li.querySelector("a");
      return {
        label: (a ? a.textContent : (li.childNodes[0]?.textContent ?? li.textContent)).trim(),
        href: a ? a.getAttribute("href") : null,
        markAsReviewed: [...li.querySelectorAll("button")].some(
          (b) => b.textContent.trim() === "Mark as reviewed",
        ),
      };
    }),
  );
}
async function reviewTable(page) {
  return page.locator("main table tbody tr").evaluateAll((trs) =>
    trs.map((tr) => ({
      list: tr.querySelector("th a")?.textContent.trim(),
      href: tr.querySelector("th a")?.getAttribute("href"),
      rows: tr.querySelector("td")?.textContent.trim(),
    })),
  );
}
const countsOf = (rows) => Object.fromEntries(rows.map((r) => [r.list, r.rows]));
async function switchStates(scope) {
  return scope
    .getByRole("switch")
    .evaluateAll((els) =>
      els.map(
        (e) =>
          `${document.querySelector(`label[for="${e.id}"]`)?.innerText}:${e.getAttribute("aria-checked")}${e.disabled ? ":disabled" : ""}`,
      ),
    );
}
/** The section body under one of the Authentication step's collapsible headings. */
function authSection(page, name) {
  return page.getByRole("heading", { name, level: 2 }).locator("xpath=..");
}
async function openAuthSection(page, name) {
  const toggle = page.getByRole("button", { name, exact: true });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  return authSection(page, name).first();
}
async function fillSetup(
  page,
  { token, name = FR_ADMIN.name, email = FR_ADMIN.email, password, confirm },
) {
  await page.getByLabel("Setup token").fill(token);
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password", { exact: true }).fill(confirm);
}
/** Submits the setup form and reports whether a POST reached the app. */
async function submitSetup(page) {
  const sent = [];
  const listener = (r) => {
    if (r.url().endsWith("/api/v1/auth/setup") && r.method() === "POST") sent.push(r.url());
  };
  page.on("request", listener);
  await frButton(page, "Create Administrator").click();
  await sleep(1200);
  page.off("request", listener);
  return sent.length;
}
async function landsOnWizard(l, page, p) {
  await page.goto(`${l.app}${p}`);
  await page.waitForLoadState("networkidle");
  const at = where(page);
  expect(at.startsWith("/welcome"), `${p} ended at ${at}`);
  return `${p} -> ${at} (${(await page.getByText(/^Step \d+ of 8$/).innerText()).trim()}: ${await stepTitle(page)})`;
}
async function brandOnSignIn(l) {
  const c = await context();
  await c.page.goto(`${l.app}/auth/login`);
  await c.page.getByRole("heading", { level: 1 }).first().waitFor();
  await c.page.waitForLoadState("networkidle");
  await sleep(400);
  const text = (await c.page.locator("main").innerText()).replace(/\s+/g, " ");
  const logos = c.page.getByRole("img", { name: "Organization logo" });
  const logoCount = await logos.count();
  const logoLoaded = logoCount
    ? await logos.first().evaluate((img) => img.complete && img.naturalWidth > 0)
    : false;
  await c.ctx.close();
  return { start: text.slice(0, 60), logoCount, logoLoaded };
}
async function headerBrand(page) {
  const header = page.locator("header").first();
  await header.waitFor();
  const text = (await header.innerText()).replace(/\s+/g, " ");
  const img = header.locator("img").first();
  const src = (await header.locator("img").count()) ? await img.getAttribute("src") : null;
  return { text: text.slice(0, 80), logo: Boolean(src?.startsWith("data:image/png")) };
}

async function frSetup() {
  const l = lab;
  const token = overlayValue(l.name, "SETUP_TOKEN");
  const { ctx, page } = await frContext(l, { fresh: true });
  results.labState = { needsSetup: await needsSetup(l) };

  await frStep(
    "Create the first Administrator step 1: open the instance address on a fresh instance",
    "Set up OpenLaw shows Setup token, Name, Email, Password, Confirm password and Create Administrator",
    async () => {
      expect(await needsSetup(l), "instance already has users");
      await page.goto(`${l.app}/`);
      await pwExpect(page).toHaveURL(/\/auth\/setup$/);
      await pwExpect(page.getByRole("heading", { name: "Set up OpenLaw" })).toBeVisible();
      await pwExpect(page.getByLabel("Setup token")).toBeVisible();
      for (const label of ["Name", "Email", "Password", "Confirm password"])
        await pwExpect(page.getByLabel(label, { exact: true })).toBeVisible();
      await pwExpect(frButton(page, "Create Administrator")).toBeVisible();
      return `/ redirected to ${where(page)}, which showed Set up OpenLaw with Setup token, Name, Email, Password, Confirm password and Create Administrator.`;
    },
    page,
  );

  await frStep(
    "Before you start: open OpenLaw from another address (localhost instead of the instance address 127.0.0.1) and submit the setup form",
    `OpenLaw refuses to save and shows "${ORIGIN_MESSAGE}"`,
    async () => {
      const other = await context();
      const wrong = l.app.replace("127.0.0.1", "localhost");
      await other.page.goto(`${wrong}/auth/setup`);
      await pwExpect(other.page.getByLabel("Setup token")).toBeVisible();
      await fillSetup(other.page, { token, password: PASSWORD, confirm: PASSWORD });
      await frButton(other.page, "Create Administrator").click();
      await pwExpect(other.page.getByText(ORIGIN_MESSAGE)).toBeVisible();
      const at = other.page.url();
      await other.ctx.close();
      expect(await needsSetup(l), "a user was created from the wrong origin");
      return `At ${at}, Create Administrator showed "${ORIGIN_MESSAGE}" and needsSetup stayed true.`;
    },
    page,
  );

  await frStep(
    "Step 3: leave Setup token empty and select Create Administrator",
    "An empty required field stops the form before it is sent; no account is created",
    async () => {
      await page.goto(`${l.app}/auth/setup`);
      await fillSetup(page, { token: "", password: PASSWORD, confirm: PASSWORD });
      const sent = await submitSetup(page);
      const field = page.getByLabel("Setup token");
      const missing = await field.evaluate((el) => el.validity.valueMissing);
      const note = await field.evaluate((el) => el.validationMessage);
      expect(missing && sent === 0 && (await needsSetup(l)), `missing ${missing} sent ${sent}`);
      return `The browser stopped the form with "${note}" on Setup token. No POST /api/v1/auth/setup was sent and needsSetup stayed true.`;
    },
    page,
  );

  await frStep(
    "Step 3: an email address that is not valid",
    `"Enter a valid email address."; the form is not sent`,
    async () => {
      await fillSetup(page, {
        token,
        email: "avery.morgan@harbor",
        password: PASSWORD,
        confirm: PASSWORD,
      });
      const sent = await submitSetup(page);
      const note = await page
        .getByLabel("Email", { exact: true })
        .evaluate((el) => el.validationMessage);
      expect(note === "Enter a valid email address." && sent === 0, `"${note}" sent ${sent}`);
      return `With Email "avery.morgan@harbor", Create Administrator was stopped with the field message "${note}" and no request was sent.`;
    },
    page,
  );

  await frStep(
    "Step 2 and 3: a password shorter than eight characters",
    `"Passwords must be 8 characters or more."; the form is not sent`,
    async () => {
      await fillSetup(page, { token, password: "Short12", confirm: "Short12" });
      const sent = await submitSetup(page);
      const note = await page
        .getByLabel("Password", { exact: true })
        .evaluate((el) => el.validationMessage);
      expect(
        note === "Passwords must be 8 characters or more." && sent === 0,
        `"${note}" sent ${sent}`,
      );
      expect(await needsSetup(l), "a user was created");
      return `A seven-character password in both fields was stopped with the field message "${note}" and no request was sent.`;
    },
    page,
  );

  await frStep(
    "Step 3: when OpenLaw accepts the token, a green check mark appears in the field and a screen reader announces Setup token verified; a wrong token shows the token message",
    `A visible green check mark and the accessible description "Setup token verified" for the correct token; neither for a wrong one; "${TOKEN_MESSAGE}"`,
    async () => {
      await page.getByLabel("Setup token").fill(token);
      await sleep(1500);
      const field = page.getByLabel("Setup token");
      const read = () =>
        field.evaluate((el) => {
          const description = (el.getAttribute("aria-describedby") ?? "")
            .split(" ")
            .map((id) => document.getElementById(id)?.textContent?.trim())
            .filter(Boolean)
            .join(" ");
          const icon = el.parentElement?.querySelector("svg");
          const box = icon?.getBoundingClientRect();
          const wrap = icon?.parentElement;
          return {
            description,
            checkMark: icon
              ? {
                  visible:
                    box.width > 4 &&
                    box.height > 4 &&
                    getComputedStyle(icon).visibility !== "hidden",
                  size: `${box.width} x ${box.height}`,
                  color: getComputedStyle(wrap).color,
                  className: wrap.className,
                }
              : null,
          };
        });
      const correct = await read();
      // The token box is masked: the setup token never reaches the batch folder.
      await page.locator("form").screenshot({
        path: path.join(here, "fr-setup-token-verified.png"),
        mask: [page.getByLabel("Password", { exact: true }), page.getByLabel("Confirm password")],
        style: "#setupToken { color: transparent !important; }",
      });
      await page.getByLabel("Setup token").fill("wrong-token-doc032");
      await sleep(1500);
      const wrong = await read();
      await fillSetup(page, { token: "wrong-token-doc032", password: PASSWORD, confirm: PASSWORD });
      await frButton(page, "Create Administrator").click();
      await pwExpect(page.getByText(TOKEN_MESSAGE)).toBeVisible();
      expect(await needsSetup(l), "a user was created");
      results.tokenVerifiedRendering = { correct, wrong };
      expect(
        correct.description === "Setup token verified" &&
          correct.checkMark?.visible &&
          /status-success/.test(correct.checkMark.className),
        JSON.stringify(correct),
      );
      expect(!wrong.description && !wrong.checkMark, JSON.stringify(wrong));
      return `The correct token showed a check mark (${correct.checkMark.size} px, ${correct.checkMark.color}, class "${correct.checkMark.className}") inside the Setup token box and gave the box the accessible description "${correct.description}" (screenshot fr-setup-token-verified.png, token text hidden). A wrong token showed no check mark and no description, and Create Administrator showed "${TOKEN_MESSAGE}".`;
    },
    page,
  );

  await frStep(
    "Step 3: a wrong setup token is refused with the token message",
    `"${TOKEN_MESSAGE}"; no account`,
    async () => {
      await page.goto(`${l.app}/auth/setup`);
      await fillSetup(page, { token: "wrong-token-doc032", password: PASSWORD, confirm: PASSWORD });
      await frButton(page, "Create Administrator").click();
      await pwExpect(page.getByText(TOKEN_MESSAGE)).toBeVisible();
      expect(await needsSetup(l), "a user was created");
      return `The page showed "${TOKEN_MESSAGE}" and needsSetup stayed true.`;
    },
    page,
  );

  await frStep(
    "Step 3: different values in Password and Confirm password",
    `"The passwords do not match."; no account`,
    async () => {
      await fillSetup(page, { token, password: PASSWORD, confirm: `${PASSWORD}x` });
      await frButton(page, "Create Administrator").click();
      await pwExpect(page.getByText("The passwords do not match.")).toBeVisible();
      expect(await needsSetup(l), "a user was created");
      return 'The page showed "The passwords do not match." and needsSetup stayed true.';
    },
    page,
  );

  await frStep(
    "Step 3: the form keeps your entries in this browser tab if you reload, until setup succeeds",
    "After reload the fields hold the same values; a new tab starts empty",
    async () => {
      await fillSetup(page, { token, password: PASSWORD, confirm: PASSWORD });
      await sleep(500);
      await page.reload();
      await pwExpect(page.getByLabel("Setup token")).toBeVisible();
      const read = async (p) => ({
        token: (await p.getByLabel("Setup token").inputValue()) === token,
        name: await p.getByLabel("Name", { exact: true }).inputValue(),
        email: await p.getByLabel("Email", { exact: true }).inputValue(),
        password: (await p.getByLabel("Password", { exact: true }).inputValue()) === PASSWORD,
        confirm: (await p.getByLabel("Confirm password").inputValue()) === PASSWORD,
      });
      const afterReload = await read(page);
      const tab = await ctx.newPage();
      await tab.goto(`${l.app}/auth/setup`);
      await pwExpect(tab.getByLabel("Setup token")).toBeVisible();
      const newTab = await read(tab);
      await tab.close();
      expect(
        afterReload.token &&
          afterReload.name === FR_ADMIN.name &&
          afterReload.email === FR_ADMIN.email &&
          afterReload.password &&
          afterReload.confirm,
        JSON.stringify(afterReload),
      );
      expect(!newTab.token && newTab.name === "" && newTab.email === "", JSON.stringify(newTab));
      return `After reload the same tab held ${JSON.stringify(afterReload)} (token and passwords compared, not recorded). A new tab in the same browser started with ${JSON.stringify(newTab)}.`;
    },
    page,
  );

  await frStep(
    "Step 3: correct the entries and select Create Administrator",
    "A successful setup signs you in and opens Welcome to OpenLaw (Step 1 of 8)",
    async () => {
      await fillSetup(page, { token, password: PASSWORD, confirm: PASSWORD });
      await frButton(page, "Create Administrator").click();
      await pwExpect(page).toHaveURL(/\/welcome(\?|$)/);
      const at = await expectStep(page, "Welcome to OpenLaw", 1);
      const me = await getJson(page, l, "/api/v1/me");
      expect(me.user.role === "administrator", `role ${me.user.role}`);
      await pwExpect(frButton(page, "Get started")).toBeVisible();
      await pwExpect(frButton(page, "Skip optional steps")).toBeVisible();
      expect((await frButton(page, "Set up later").count()) === 0, "Welcome shows Set up later");
      await frSave(l, ctx);
      return `Signed in as ${me.user.displayName} (administrator) at ${where(page)}. ${at}. The step shows Get started and Skip optional steps, and no Set up later.`;
    },
    page,
  );

  await frStep(
    "Account setup is available only while the instance has no users",
    "A signed-out visitor to /auth/setup lands on Sign in; the setup API answers 409",
    async () => {
      const other = await context();
      await other.page.goto(`${l.app}/auth/setup`);
      await pwExpect(other.page).toHaveURL(/\/auth\/login$/);
      const res = await other.ctx.request.post(`${l.app}/api/v1/auth/setup`, {
        headers: { origin: l.app },
        data: {
          email: "second.admin@harbor.example",
          displayName: "Second Admin DOC-032",
          password: randomBytes(9).toString("hex"),
          setupToken: token,
        },
      });
      const body = await res.json().catch(() => ({}));
      await other.ctx.close();
      expect(res.status() === 409, `setup API ${res.status()}`);
      return `/auth/setup redirected to /auth/login. The setup API answered 409 "${body.detail}".`;
    },
    page,
  );

  await frStep(
    "Setup cannot finish without outbound email: while email is not configured, app pages open the wizard",
    "Home, Settings and Matters open /welcome",
    async () => {
      const out = [];
      for (const p of ["/", "/settings/general", "/matters", "/settings/email"])
        out.push(await landsOnWizard(l, page, p));
      return out.join("; ");
    },
    page,
  );

  await frStep(
    "Welcome step: Skip optional steps while the environment sets SMTP_URL but not SMTP_FROM",
    "Outbound email opens (Step 4 of 8); it says SMTP_FROM is not set; read-only; no Set up later; Continue unavailable",
    async () => {
      await page.goto(`${l.app}/welcome?step=welcome`);
      await expectStep(page, "Welcome to OpenLaw", 1);
      await frButton(page, "Skip optional steps").click();
      const at = await expectStep(page, "Outbound email", 4);
      const warning = (await page.getByText(/sets SMTP_URL but not SMTP_FROM/).innerText()).trim();
      expect((await frButton(page, "Set up later").count()) === 0, "Set up later shown");
      for (const name of ["Save relay", "Send test email"])
        expect((await frButton(page, name).count()) === 0, `${name} shown`);
      await pwExpect(frButton(page, "Continue")).toBeDisabled();
      const onboarding = await getJson(page, l, "/api/v1/onboarding");
      expect(!onboarding.completed, "onboarding completed");
      return `${at} at ${where(page)}. It said "${warning}" No Set up later, Save relay or Send test email; Continue disabled; onboarding not complete.`;
    },
    page,
  );

  await frStep(
    "Finish is refused while outbound email is not configured: open Review and select Finish, then Set up later",
    "Each opens Outbound email; onboarding stays open; the completion API answers 409",
    async () => {
      const out = [];
      for (const name of ["Finish", "Set up later"]) {
        await page.goto(`${l.app}/welcome?step=review`);
        await expectStep(page, "Review", 8);
        await frButton(page, name).click();
        const at = await expectStep(page, "Outbound email", 4);
        await sleep(800);
        const onboarding = await getJson(page, l, "/api/v1/onboarding");
        expect(!onboarding.completed && !onboarding.steps.review.done, JSON.stringify(onboarding));
        out.push(
          `${name} on Review opened ${at}; completed ${onboarding.completed}, review done ${onboarding.steps.review.done}`,
        );
      }
      const res = await api(page, l.app, "POST", "/api/v1/onboarding/complete");
      expect(res.status === 409, `complete ${res.status}`);
      out.push(`the completion API answered 409 "${res.data?.detail}"`);
      await frSave(l, ctx);
      return out.join(". ") + ".";
    },
    page,
  );
  await ctx.close();
}

async function frOrg() {
  const l = lab;
  const { ctx, page } = await frContext(l);
  await frStep(
    "After the operator removes email from the environment, open Home and other app pages",
    "The session is still signed in and every app page opens the wizard",
    async () => {
      const out = [];
      for (const p of ["/", "/settings/users", "/requests", "/contracts"])
        out.push(await landsOnWizard(l, page, p));
      const settings = await getJson(page, l, "/api/v1/email-settings");
      return `${out.join("; ")}. Email source "${settings.source}".`;
    },
    page,
  );

  const brandBefore = await brandOnSignIn(l);
  await frStep(
    "Work through the welcome steps step 1: on Welcome to OpenLaw select Get started",
    "Your organization opens as Step 2 of 8",
    async () => {
      await page.goto(`${l.app}/welcome?step=welcome`);
      await frButton(page, "Get started").click();
      const at = await expectStep(page, "Your organization", 2);
      return `${at} at ${where(page)}. Before any organization save, Sign in showed ${JSON.stringify(brandBefore)}.`;
    },
    page,
  );

  const big = path.join(SCRATCH, "doc032-fr-logo-over-5mb.png");
  const huge = path.join(SCRATCH, "doc032-fr-logo-over-16mp.png");
  const ok = path.join(SCRATCH, "doc032-fr-logo-256.png");
  const gif = path.join(SCRATCH, "doc032-fr-logo.gif");
  writeFileSync(big, Buffer.concat([png(8, 8), Buffer.alloc(5 * 1024 * 1024 + 1024)]));
  writeFileSync(huge, png(4100, 4000));
  writeFileSync(ok, png(256, 256));
  writeFileSync(
    gif,
    Buffer.from("R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==", "base64"),
  );
  const upload = async (file) => {
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      frButton(page, "Upload").click(),
    ]);
    await chooser.setFiles(file);
  };

  await frStep(
    "Step 2: Default locale; Upload refuses a file that is not a PNG, JPEG, WebP or SVG, and one over 5 MB",
    `Default locale offers only English (United States); "${LOGO_TYPE_MESSAGE}"`,
    async () => {
      const options = await page.getByLabel("Default locale").locator("option").allInnerTexts();
      await upload(gif);
      await pwExpect(page.getByText(LOGO_TYPE_MESSAGE)).toBeVisible();
      await upload(big);
      await pwExpect(page.getByText(LOGO_TYPE_MESSAGE)).toBeVisible();
      const preview = await page.getByRole("img", { name: "Organization logo" }).count();
      expect(
        options.length === 1 && options[0].trim() === "English (United States)" && preview === 0,
        `${JSON.stringify(options)} preview ${preview}`,
      );
      return `Default locale offered ${JSON.stringify(options)}. A GIF and a PNG over 5 MB were refused with "${LOGO_TYPE_MESSAGE}" and no preview showed.`;
    },
    page,
  );

  await frStep(
    "Step 2: a PNG under 5 MB with more than 16 million pixels; Organization name; Continue",
    `Continue shows "${LOGO_READ_MESSAGE}" and nothing is saved`,
    async () => {
      await upload(huge);
      await pwExpect(page.getByRole("img", { name: "Organization logo" })).toBeVisible();
      await page.getByLabel("Organization name").fill(ORG_NAME);
      await frButton(page, "Continue").click();
      await pwExpect(page.getByText(LOGO_READ_MESSAGE)).toBeVisible();
      const at = await expectStep(page, "Your organization", 2);
      const general = (await getJson(page, l, "/api/v1/org/general")).general;
      expect(
        general.logo === null && general.name !== ORG_NAME,
        JSON.stringify({ ...general, logo: !!general.logo }),
      );
      return `A 4100 x 4000 PNG (16.4 million pixels) showed a preview. Continue showed "${LOGO_READ_MESSAGE}" and stayed at ${at}; the saved organization kept no logo and the name "${general.name}".`;
    },
    page,
  );

  await frStep(
    "Step 2: export the image again (a 256 x 256 PNG), choose a Default timezone, then select Set up later",
    "The wizard moves to Authentication without saving the unsaved organization entries",
    async () => {
      await upload(ok);
      await pwExpect(page.getByText(LOGO_READ_MESSAGE)).toHaveCount(0);
      const tz = page.getByRole("combobox", { name: "Default timezone" });
      await tz.click();
      await tz.fill("Lisbon");
      await page
        .getByRole("option", { name: /Lisbon/ })
        .first()
        .click();
      await frButton(page, "Set up later").click();
      const at = await expectStep(page, "Authentication", 3);
      const general = (await getJson(page, l, "/api/v1/org/general")).general;
      expect(general.name !== ORG_NAME && general.logo === null, "saved by Set up later");
      return `${at}. The saved organization still had the name "${general.name}", no logo and timezone ${general.defaultTimezone}.`;
    },
    page,
  );

  await frStep(
    "Resume: Back keeps the unfinished entries; Continue saves Organization name, logo and Default timezone",
    "After Back the name, logo and timezone drafts are still there; Continue saves them and opens Authentication",
    async () => {
      await frButton(page, "Back").click();
      await expectStep(page, "Your organization", 2);
      const kept = {
        name: await page.getByLabel("Organization name").inputValue(),
        logo: await page.getByRole("img", { name: "Organization logo" }).count(),
        timezone: await page.getByRole("combobox", { name: "Default timezone" }).inputValue(),
      };
      await frButton(page, "Continue").click();
      const at = await expectStep(page, "Authentication", 3);
      const general = (await getJson(page, l, "/api/v1/org/general")).general;
      expect(
        kept.name === ORG_NAME && kept.logo === 1 && /Lisbon/.test(kept.timezone),
        JSON.stringify(kept),
      );
      expect(
        general.name === ORG_NAME &&
          general.defaultTimezone === "Europe/Lisbon" &&
          general.logo?.startsWith("data:image/png"),
        JSON.stringify({ ...general, logo: String(general.logo).slice(0, 20) }),
      );
      return `After Back the step still held ${JSON.stringify(kept)}. Continue opened ${at}; the API read back name "${general.name}", timezone ${general.defaultTimezone}, locale ${general.defaultLocale} and a PNG logo.`;
    },
    page,
  );

  await frStep(
    "Step 2: the sign-in pages and the app header then show the saved organization name and logo",
    "The staff sign-in page shows the saved name and logo",
    async () => {
      const after = await brandOnSignIn(l);
      expect(
        after.start.startsWith(ORG_NAME) && after.logoCount === 1 && after.logoLoaded,
        JSON.stringify(after),
      );
      return `Before the save, Sign in showed ${JSON.stringify(brandBefore)}. After it, ${JSON.stringify(after)}.`;
    },
    page,
  );

  await frStep(
    "Resume or finish later: the wizard keeps unfinished entries and the current step in this browser tab when you reload or visit Help, and returning to the wizard resumes the last step",
    "An unsaved name survives reload and a Help visit; Home reopens Your organization, not Welcome",
    async () => {
      await page.goto(`${l.app}/welcome?step=organization`);
      await expectStep(page, "Your organization", 2);
      await page.getByLabel("Organization name").fill("Unsaved Name DOC-032");
      await sleep(300);
      await page.reload();
      await expectStep(page, "Your organization", 2);
      const afterReload = await page.getByLabel("Organization name").inputValue();
      await page.getByRole("link", { name: "Help with this page" }).click();
      await page.waitForLoadState("networkidle");
      const help = where(page);
      await page.goBack();
      await expectStep(page, "Your organization", 2);
      const afterHelp = await page.getByLabel("Organization name").inputValue();
      await page.goto(`${l.app}/`);
      await page.waitForLoadState("networkidle");
      const resumed = `${where(page)} (${await stepTitle(page)})`;
      const resumedName = await page.getByLabel("Organization name").inputValue();
      const saved = (await getJson(page, l, "/api/v1/org/general")).general.name;
      await page.getByLabel("Organization name").fill(ORG_NAME);
      expect(
        afterReload === "Unsaved Name DOC-032" && afterHelp === "Unsaved Name DOC-032",
        `${afterReload} / ${afterHelp}`,
      );
      expect(
        /step=organization/.test(resumed) && resumedName === "Unsaved Name DOC-032",
        `${resumed} ${resumedName}`,
      );
      expect(saved === ORG_NAME, `saved ${saved}`);
      return `The unsaved name "${afterReload}" survived reload. Help with this page opened ${help}; browser Back returned to Your organization with "${afterHelp}". Opening / went to ${resumed} with the same unsaved name. The server still held "${saved}" (drafts do not save settings). The field was set back to the saved name.`;
    },
    page,
  );
  await frSave(l, ctx);
  await ctx.close();
}

async function frAuth() {
  const l = lab;
  const { ctx, page } = await frContext(l);
  const legalSwitch = (name) =>
    authSection(page, "Legal Users").getByRole("switch", { name, exact: true });
  const businessSwitch = (name) =>
    authSection(page, "Business Users").getByRole("switch", { name, exact: true });
  const setSwitch = async (sw, on) => {
    if (((await sw.getAttribute("aria-checked")) === "true") !== on) await sw.click();
  };
  const providersList = () =>
    page.getByRole("list", { name: "Registered identity providers" }).locator(":scope > li");
  const providerRowsText = async () =>
    (await providersList().count())
      ? (await providersList().allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim())
      : [];
  const registerInWizard = async (p) => {
    const box = authSection(page, "Identity providers");
    await box.getByLabel("Display name").fill(p.name);
    await box.getByLabel("Provider ID").fill(p.providerId);
    await box.getByLabel("Issuer URL").fill(p.issuer);
    await box.getByLabel("Email domains").fill(p.domains);
    await box.getByLabel("Client ID").fill(p.clientId);
    await box.getByLabel("Client secret").fill(randomBytes(12).toString("hex"));
    await frButton(page, "Register provider").click();
  };
  const methodsNow = async () => (await getJson(page, l, "/api/v1/auth/methods")).policy;
  const domainsSaved = async () => (await getJson(page, l, "/api/v1/auth/allowed-domains")).domains;
  const methodsBefore = await methodsNow();
  results.startPolicy = methodsBefore;
  const HARBOR = {
    name: "Harbor IdP",
    providerId: "harbor-idp",
    issuer: "http://oidc:8080",
    domains: "harbor.example",
    clientId: "doc032-first-run-client",
  };
  const HARBOR_EU = {
    name: "Harbor EU IdP",
    providerId: "harbor-eu",
    issuer: "http://oidc:8082",
    domains: "eu-harbor.example",
    clientId: "doc032-first-run-client-eu",
  };

  await frStep(
    "Step 3: open Authentication; Legal Users and Business Users start collapsed",
    "Step 3 of 8; the Legal Users, Business Users and Identity providers sections are collapsed",
    async () => {
      await page.goto(`${l.app}/welcome?step=authentication`);
      const at = await expectStep(page, "Authentication", 3);
      const expanded = {};
      for (const n of ["Legal Users", "Business Users", "Identity providers"])
        expanded[n] = await frButton(page, n).getAttribute("aria-expanded");
      const hint = (await page.locator("main").innerText()).includes(
        "Legal Users and Business Users can use different sign-in methods.",
      );
      expect(
        expanded["Legal Users"] === "false" && expanded["Business Users"] === "false" && hint,
        JSON.stringify(expanded),
      );
      return `${at} at ${where(page)} in a new browser tab. aria-expanded: ${JSON.stringify(expanded)}. The step said "Legal Users and Business Users can use different sign-in methods."`;
    },
    page,
  );

  await frStep(
    "An old link to the Business-user portal step opens Authentication with Business Users expanded (the registry's nine-step Business-user portal step)",
    "/welcome?step=portal lands on Authentication (Step 3 of 8) with Business Users expanded",
    async () => {
      await page.goto(`${l.app}/welcome?step=portal`);
      await page.waitForLoadState("networkidle");
      const at = await expectStep(page, "Authentication", 3);
      const business = await frButton(page, "Business Users").getAttribute("aria-expanded");
      expect(
        business === "true" && /step=authentication/.test(where(page)),
        `${where(page)} ${business}`,
      );
      await frButton(page, "Business Users").click();
      return `/welcome?step=portal went to ${where(page)} (${at}) with Business Users aria-expanded ${business}. The section was collapsed again.`;
    },
    page,
  );

  await frStep(
    "Step 3: expand Legal Users, turn off every sign-in method, select Continue",
    `OpenLaw refuses a Legal Users policy with no sign-in method: "Enable at least one sign-in method."`,
    async () => {
      await openAuthSection(page, "Legal Users");
      const initial = await switchStates(authSection(page, "Legal Users"));
      await setSwitch(legalSwitch("Email and password"), false);
      await setSwitch(legalSwitch("Email magic link"), false);
      await frButton(page, "Continue").click();
      await pwExpect(page.getByText("Enable at least one sign-in method.")).toBeVisible();
      const at = await expectStep(page, "Authentication", 3);
      const after = await methodsNow();
      expect(
        JSON.stringify(after.legal) === JSON.stringify(methodsBefore.legal),
        JSON.stringify(after),
      );
      await setSwitch(legalSwitch("Email and password"), true);
      await setSwitch(legalSwitch("Email magic link"), true);
      return `Legal Users switches at first: ${JSON.stringify(initial)}. With both email methods off, Continue showed "Enable at least one sign-in method." and stayed at ${at}; the saved Legal policy was unchanged (${JSON.stringify(after.legal)}). Both email methods were turned back on.`;
    },
    page,
  );

  await frStep(
    "Step 3: the Single sign-on (SSO) switch stays unavailable until a provider is registered; Identity providers shows Register your identity provider",
    "SSO disabled with the configure tooltip; the form fields and Register provider",
    async () => {
      const sso = legalSwitch("Single sign-on (SSO)");
      const disabled = await sso.isDisabled();
      const help = await helpTooltip(
        page,
        authSection(page, "Legal Users"),
        "Single sign-on (SSO)",
      );
      await openAuthSection(page, "Identity providers");
      const box = authSection(page, "Identity providers");
      const heading = (
        await box
          .getByText(/^(Register your identity provider|Add another identity provider)$/)
          .innerText()
      ).trim();
      const labels = await box
        .locator("label")
        .evaluateAll((ls) => ls.map((x) => x.innerText.trim()));
      expect(
        disabled && help === "Configure an identity provider below to enable single sign-on.",
        `${disabled} ${help}`,
      );
      expect(heading === "Register your identity provider", heading);
      expect(
        [
          "Display name",
          "Provider ID",
          "Issuer URL",
          "Email domains",
          "Client ID",
          "Client secret",
        ].every((x) => labels.includes(x)) &&
          (await frButton(page, "Register provider").count()) === 1,
        JSON.stringify(labels),
      );
      return `Single sign-on (SSO) was disabled; its help read "${help}". Identity providers showed "${heading}" with ${JSON.stringify(labels)} and Register provider.`;
    },
    page,
  );

  await frStep(
    "Step 3: complete Register your identity provider and select Register provider; copy the callback URL; the list shows the provider; the heading changes to Add another identity provider",
    "Registered notice with the callback URL on the instance address; a row with name, domains and Configured; SSO switch available",
    async () => {
      await registerInWizard(HARBOR);
      await pwExpect(
        page.getByText(`Identity provider ${HARBOR.name} is registered.`),
      ).toBeVisible();
      const callback = (
        await page.getByText(/Paste this callback URL into your IdP console:/).innerText()
      ).trim();
      const rows = await providerRowsText();
      const box = authSection(page, "Identity providers");
      const heading = (
        await box
          .getByText(/^(Register your identity provider|Add another identity provider)$/)
          .innerText()
      ).trim();
      const removeButton = await page
        .getByRole("button", { name: `Remove ${HARBOR.name}` })
        .count();
      await pwExpect(legalSwitch("Single sign-on (SSO)")).toBeEnabled();
      expect(callback.endsWith(`${l.app}/api/auth/sso/callback`), callback);
      expect(
        rows.length === 1 &&
          rows[0].includes(HARBOR.name) &&
          rows[0].includes("harbor.example") &&
          rows[0].includes("Configured"),
        JSON.stringify(rows),
      );
      expect(
        heading === "Add another identity provider" && removeButton === 1,
        `${heading} ${removeButton}`,
      );
      return `The step showed "Identity provider ${HARBOR.name} is registered." and "${callback}". Rows: ${JSON.stringify(rows)}, with a "Remove ${HARBOR.name}" button. The form heading now read "${heading}". The Legal Users SSO switch became available. The issuer is the local OpenID Connect fixture on the lab network.`;
    },
    page,
  );

  await frStep(
    "Step 3: a second provider; each email domain can belong to one provider",
    "A second row; a third registration for harbor.example is refused",
    async () => {
      await registerInWizard(HARBOR_EU);
      await pwExpect(
        page.getByText(`Identity provider ${HARBOR_EU.name} is registered.`),
      ).toBeVisible();
      await registerInWizard({ ...HARBOR, name: "Harbor Duplicate IdP", providerId: "harbor-dup" });
      const alert = page
        .getByRole("alert")
        .filter({ hasText: /harbor\.example/ })
        .first();
      await alert.waitFor({ timeout: 20000 });
      const refusal = (await alert.innerText()).trim();
      const rows = await providerRowsText();
      await authSection(page, "Identity providers").getByLabel("Display name").fill("");
      expect(rows.length === 2 && /Harbor IdP/.test(refusal), `${refusal} ${JSON.stringify(rows)}`);
      return `${HARBOR_EU.name} registered; rows ${JSON.stringify(rows)}. A third provider for harbor.example was refused with "${refusal}".`;
    },
    page,
  );

  await frStep(
    "Step 3: removing the last provider turns off Single sign-on (SSO) for both groups",
    "With Legal SSO saved on: Remove the second provider keeps SSO; Remove the last provider turns it off and makes the switch unavailable; register the provider again",
    async () => {
      await setSwitch(legalSwitch("Single sign-on (SSO)"), true);
      await frButton(page, "Continue").click();
      await expectStep(page, "Outbound email", 4);
      const saved = await methodsNow();
      await frButton(page, "Back").click();
      await expectStep(page, "Authentication", 3);
      await openAuthSection(page, "Identity providers");
      await openAuthSection(page, "Legal Users");
      await page.getByRole("button", { name: `Remove ${HARBOR_EU.name}` }).click();
      await page
        .getByRole("button", { name: `Remove ${HARBOR_EU.name}` })
        .waitFor({ state: "detached" });
      const afterFirst = {
        policy: (await methodsNow()).legal.sso,
        switch: await switchStates(authSection(page, "Legal Users")),
      };
      await page.getByRole("button", { name: `Remove ${HARBOR.name}` }).click();
      await page
        .getByRole("button", { name: `Remove ${HARBOR.name}` })
        .waitFor({ state: "detached" });
      await sleep(400);
      const afterLast = await methodsNow();
      const legalSwitches = await switchStates(authSection(page, "Legal Users"));
      const heading = (
        await authSection(page, "Identity providers")
          .getByText(/^(Register your identity provider|Add another identity provider)$/)
          .innerText()
      ).trim();
      await registerInWizard(HARBOR);
      await pwExpect(
        page.getByText(`Identity provider ${HARBOR.name} is registered.`),
      ).toBeVisible();
      expect(
        saved.legal.sso && afterFirst.policy,
        `${JSON.stringify(saved.legal)} ${JSON.stringify(afterFirst)}`,
      );
      expect(
        !afterLast.legal.sso &&
          !afterLast.business.sso &&
          legalSwitches.includes("Single sign-on (SSO):false:disabled"),
        `${JSON.stringify(afterLast)} ${JSON.stringify(legalSwitches)}`,
      );
      return `Continue saved Legal SSO on (${JSON.stringify(saved.legal)}) and opened Outbound email; Back returned to Authentication. Remove ${HARBOR_EU.name} left Legal SSO ${afterFirst.policy}. Remove ${HARBOR.name} (the last provider) stored ${JSON.stringify({ legal: afterLast.legal.sso, business: afterLast.business.sso })} for SSO, the Legal switches read ${JSON.stringify(legalSwitches)} and the form heading returned to "${heading}". ${HARBOR.name} was registered again.`;
    },
    page,
  );

  await frStep(
    "Step 5: Business Users: with no domain the switches are unavailable; an entry with an email username; Add a domain to enable the switches",
    `"Add a domain to enable sign-in options."; switches unavailable; the username entry is not saved; harbor.example enables the switches`,
    async () => {
      await openAuthSection(page, "Business Users");
      const box = authSection(page, "Business Users");
      const empty = (await box.innerText()).includes("Add a domain to enable sign-in options.");
      const before = await switchStates(box);
      await box.getByLabel("Allowed email domains").fill("rowan@harbor.example");
      await frButton(page, "Add").click();
      await sleep(300);
      let usernameOutcome = "not added to the draft list";
      if (await page.getByRole("button", { name: "Remove rowan@harbor.example" }).count()) {
        await frButton(page, "Continue").click();
        await sleep(1500);
        const alerts = (await page.getByRole("alert").allInnerTexts()).join(" | ");
        usernameOutcome = `added to the draft list; Continue stayed on ${await stepTitle(page)} with "${alerts}"`;
        if ((await stepTitle(page)) !== "Authentication") await frButton(page, "Back").click();
        await expectStep(page, "Authentication", 3);
        await openAuthSection(page, "Business Users");
        await page.getByRole("button", { name: "Remove rowan@harbor.example" }).click();
      }
      const savedDomains = await domainsSaved();
      await box.getByLabel("Allowed email domains").fill("harbor.example");
      await frButton(page, "Add").click();
      await pwExpect(page.getByRole("button", { name: "Remove harbor.example" })).toBeVisible();
      const after = await switchStates(box);
      expect(
        empty && before.every((x) => x.endsWith(":disabled")),
        `${empty} ${JSON.stringify(before)}`,
      );
      expect(!savedDomains.includes("rowan@harbor.example"), JSON.stringify(savedDomains));
      expect(
        after.slice(0, 2).every((x) => !x.endsWith(":disabled")),
        JSON.stringify(after),
      );
      return `With no domain the section said "Add a domain to enable sign-in options." and the switches read ${JSON.stringify(before)}. An entry "rowan@harbor.example" was ${usernameOutcome}; the saved list was ${JSON.stringify(savedDomains)}. After Add harbor.example the switches read ${JSON.stringify(after)}.`;
    },
    page,
  );

  await frStep(
    "Step 5: while at least one domain is listed, OpenLaw refuses a Business Users policy with no sign-in method",
    `Continue shows "Enable at least one sign-in method." and the Business policy is unchanged`,
    async () => {
      for (const n of ["Email and password", "Email magic link", "Single sign-on (SSO)"])
        if (await businessSwitch(n).isEnabled()) await setSwitch(businessSwitch(n), false);
      await frButton(page, "Continue").click();
      await pwExpect(page.getByText("Enable at least one sign-in method.")).toBeVisible();
      const at = await expectStep(page, "Authentication", 3);
      const saved = await methodsNow();
      const domains = await domainsSaved();
      expect(saved.business.password || saved.business.magicLink, JSON.stringify(saved.business));
      return `With harbor.example listed and every Business method off, Continue showed "Enable at least one sign-in method." and stayed at ${at}. Saved Business policy ${JSON.stringify(saved.business)}; saved domains ${JSON.stringify(domains)} (the list is saved before the policy).`;
    },
    page,
  );

  await frStep(
    "Step 5: removing the last domain turns off the Business sign-in methods and makes the switches unavailable; Require two-factor authentication keeps its value; adding a domain again leaves the methods off",
    "Methods off and unavailable; 2FA shows on; after Add the methods are available but off",
    async () => {
      const box = authSection(page, "Business Users");
      await setSwitch(businessSwitch("Email magic link"), true);
      await setSwitch(businessSwitch("Require two-factor authentication"), true);
      const before = await switchStates(box);
      await page.getByRole("button", { name: "Remove harbor.example" }).click();
      await sleep(300);
      const removed = await switchStates(box);
      await box.getByLabel("Allowed email domains").fill("harbor.example");
      await frButton(page, "Add").click();
      await pwExpect(page.getByRole("button", { name: "Remove harbor.example" })).toBeVisible();
      const readded = await switchStates(box);
      await setSwitch(businessSwitch("Require two-factor authentication"), false);
      expect(
        removed.slice(0, 3).every((x) => x.endsWith(":false:disabled")) &&
          removed[3] === "Require two-factor authentication:true:disabled",
        JSON.stringify(removed),
      );
      expect(
        readded.slice(0, 2).every((x) => x.endsWith(":false")) &&
          readded[3] === "Require two-factor authentication:true",
        JSON.stringify(readded),
      );
      return `Before: ${JSON.stringify(before)}. After Remove harbor.example: ${JSON.stringify(removed)}. After adding harbor.example again: ${JSON.stringify(readded)}. Require two-factor authentication for Business Users was turned off again.`;
    },
    page,
  );

  await frStep(
    "Set up later on Authentication moves on without saving the step's unsaved entries; Back keeps the drafts",
    "Outbound email opens; the saved domains and Business policy are unchanged; after Back the draft domain is still listed",
    async () => {
      const box = authSection(page, "Business Users");
      await setSwitch(businessSwitch("Email magic link"), true);
      await box.getByLabel("Allowed email domains").fill("unsaved.example");
      await frButton(page, "Add").click();
      const savedBefore = {
        domains: await domainsSaved(),
        business: (await methodsNow()).business,
      };
      await frButton(page, "Set up later").click();
      const at = await expectStep(page, "Outbound email", 4);
      const savedAfter = { domains: await domainsSaved(), business: (await methodsNow()).business };
      await frButton(page, "Back").click();
      await expectStep(page, "Authentication", 3);
      await openAuthSection(page, "Business Users");
      const draftKept = await page.getByRole("button", { name: "Remove unsaved.example" }).count();
      await page.getByRole("button", { name: "Remove unsaved.example" }).click();
      expect(
        JSON.stringify(savedBefore) === JSON.stringify(savedAfter),
        `${JSON.stringify(savedBefore)} -> ${JSON.stringify(savedAfter)}`,
      );
      expect(
        !savedAfter.domains.includes("unsaved.example") && draftKept === 1,
        `${JSON.stringify(savedAfter)} draft ${draftKept}`,
      );
      return `Set up later opened ${at}. Saved state stayed ${JSON.stringify(savedAfter)}. After Back the draft still listed unsaved.example, which was then removed.`;
    },
    page,
  );

  await frStep(
    "Steps 4 and 5: Business Users with helix.example and harbor.example and Email magic link; Legal Users with Require two-factor authentication; Continue",
    "Continue saves both groups and the list, then makes the Administrator enroll",
    async () => {
      const box = authSection(page, "Business Users");
      await box.getByLabel("Allowed email domains").fill("helix.example");
      await frButton(page, "Add").click();
      await pwExpect(page.getByRole("button", { name: "Remove helix.example" })).toBeVisible();
      await setSwitch(businessSwitch("Email magic link"), true);
      await openAuthSection(page, "Legal Users");
      await setSwitch(legalSwitch("Single sign-on (SSO)"), false);
      await setSwitch(legalSwitch("Require two-factor authentication"), true);
      await frButton(page, "Continue").click();
      await page.waitForURL(/\/auth\/two-factor\/enroll$/, { timeout: 20000 });
      await pwExpect(
        page.getByText("Your organization requires two-factor authentication."),
      ).toBeVisible();
      const policy = (await (await fetch(`${l.app}/api/v1/auth/methods`)).json()).policy;
      const domains = (await api(page, l.app, "GET", "/api/v1/auth/allowed-domains")).data?.domains;
      expect(
        policy.legal.requireTwoFactor && policy.legal.password && policy.legal.magicLink,
        JSON.stringify(policy.legal),
      );
      expect(policy.business.magicLink, JSON.stringify(policy.business));
      return `Continue saved Legal ${JSON.stringify(policy.legal)} and Business ${JSON.stringify(policy.business)} (domains read from the enrollment page: ${JSON.stringify(domains ?? "refused until enrollment")}), and opened ${where(page)} with "Your organization requires two-factor authentication."`;
    },
    page,
  );

  await frStep(
    "Step 4: after enrollment the wizard resumes at Outbound email; your saved choices remain",
    "Outbound email (Step 4 of 8); saved domains and both policies",
    async () => {
      await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
      const [enable] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes("/two-factor/enable") && r.request().method() === "POST",
        ),
        frButton(page, "Turn on two-factor").click(),
      ]);
      const secret = new URL((await enable.json()).totpURI).searchParams.get("secret");
      writeFileSync(frTotpFile(l), secret, { mode: 0o600 });
      await page.getByLabel("Code", { exact: true }).fill(frTotp(secret));
      await frButton(page, "Confirm").click();
      await pwExpect(page.getByText(/Two-factor authentication is on\./)).toBeVisible();
      await page.getByRole("link", { name: "Done", exact: true }).click();
      await page.waitForURL(/\/welcome/, { timeout: 20000 });
      await page.waitForLoadState("networkidle");
      const at = await expectStep(page, "Outbound email", 4);
      const landed = where(page);
      const domains = await domainsSaved();
      const policy = await methodsNow();
      expect(
        JSON.stringify([...domains].sort()) ===
          JSON.stringify(["harbor.example", "helix.example"]) && policy.legal.requireTwoFactor,
        `${JSON.stringify(domains)} ${JSON.stringify(policy)}`,
      );
      return `A generated code turned two-factor on. Done led to ${landed}: ${at}. Saved domains ${JSON.stringify(domains)}; Legal ${JSON.stringify(policy.legal)}; Business ${JSON.stringify(policy.business)}.`;
    },
    page,
  );
  await frSave(l, ctx);
  await ctx.close();
}

async function frEmail() {
  const l = lab;
  const { ctx, page } = await frContext(l);
  await frStep(
    "Step 6: in Outbound email check the configuration source while email is unset",
    "The relay form with SMTP server, Port, Connection security, Authentication, Sender name (optional), Sender email and Save relay; no Set up later; Continue unavailable",
    async () => {
      await page.goto(`${l.app}/welcome?step=email`);
      await expectStep(page, "Outbound email", 4);
      const unset = (
        await page.getByText(/Set up outbound email to finish instance setup/).innerText()
      ).trim();
      for (const label of [
        "SMTP server",
        "Port",
        "Connection security",
        "Authentication",
        "Sender name (optional)",
        "Sender email",
      ])
        await pwExpect(page.getByLabel(label, { exact: true })).toBeVisible();
      await pwExpect(frButton(page, "Save relay")).toBeVisible();
      expect((await frButton(page, "Set up later").count()) === 0, "Set up later shown");
      expect(
        (await frButton(page, "Send test email").count()) === 0,
        "Send test email before a relay",
      );
      await pwExpect(frButton(page, "Continue")).toBeDisabled();
      return `The step said "${unset}" and showed the relay fields and Save relay; no Set up later or Send test email; Continue disabled.`;
    },
    page,
  );
  await frStep(
    "Step 6: Authentication Username and password asks for SMTP username and SMTP password; a URL in SMTP server is refused",
    "Both fields show and are required; a URL host is not saved",
    async () => {
      const f = smtp(page);
      await f.authentication.selectOption({ label: "Username and password" });
      await pwExpect(f.username).toBeVisible();
      await pwExpect(f.password).toBeVisible();
      await f.host.fill("mailpit");
      await f.senderEmail.fill("legal@harbor.example");
      await frButton(page, "Save relay").click();
      await sleep(800);
      const missing = [
        await f.username.evaluate((el) => el.validity.valueMissing),
        await f.password.evaluate((el) => el.validity.valueMissing),
      ];
      await f.authentication.selectOption({ label: "None" });
      await f.host.fill("https://mail.harbor.example");
      await f.security.selectOption({ label: "None" });
      await f.port.fill("1025");
      await frButton(page, "Save relay").click();
      await sleep(1500);
      const alerts = (await page.locator("main").getByRole("alert").allInnerTexts()).join(" | ");
      const settings = await getJson(page, l, "/api/v1/email-settings");
      expect(
        missing.every(Boolean) && settings.source === "unset",
        `${missing} ${settings.source}`,
      );
      return `With Username and password, SMTP username and SMTP password were required (${JSON.stringify(missing)}). SMTP server "https://mail.harbor.example" was not saved (source "${settings.source}"; messages "${alerts.slice(0, 200)}").`;
    },
    page,
  );
  await frStep(
    "Step 6: enter the relay and select Save relay; select Send test email and check the inbox",
    "Relay saved; Continue available; the test email arrives with the organization name and logo in its header",
    async () => {
      const f = smtp(page);
      await f.host.fill("mailpit");
      await f.security.selectOption({ label: "None" });
      await f.port.fill("1025");
      await f.authentication.selectOption({ label: "None" });
      await f.senderName.fill("Harbor Legal");
      await f.senderEmail.fill("legal@harbor.example");
      await frButton(page, "Save relay").click();
      await pwExpect(
        page.getByText("Relay saved. The next email this instance sends will use it."),
      ).toBeVisible();
      await pwExpect(frButton(page, "Continue")).toBeEnabled();
      expect((await frButton(page, "Set up later").count()) === 0, "Set up later after save");
      const before = (await mailTo(l, FR_ADMIN.email)).count;
      await frButton(page, "Send test email").click();
      await pwExpect(
        page.getByText(`Test email sent to ${FR_ADMIN.email}. Check your inbox.`),
      ).toBeVisible();
      await waitMailCount(l, FR_ADMIN.email, before + 1);
      const facts = await mailHeaderFacts(l, FR_ADMIN.email);
      await frButton(page, "Replace relay").click();
      const draftCleared =
        (await f.host.inputValue()) === "" && (await f.senderEmail.inputValue()) === "";
      await frButton(page, "Keep current relay").click();
      expect(
        facts.header.name === ORG_NAME &&
          facts.header.cid === "org-logo@openlaw" &&
          facts.inline.some((x) => x.contentId === "org-logo@openlaw"),
        JSON.stringify(facts),
      );
      expect(draftCleared, "relay draft kept after save");
      return `Save relay showed "Relay saved. The next email this instance sends will use it."; Continue became available. Send test email showed "Test email sent to ${FR_ADMIN.email}. Check your inbox." Mailpit received "${facts.subject}"; its header named "${facts.header.name}" with the inline image ${facts.header.cid}. Replace relay then opened an empty form (the saved credential cleared its draft); Keep current relay closed it.`;
    },
    page,
  );
  await frSave(l, ctx);
  await ctx.close();
}

async function frInvites() {
  const l = lab;
  const { ctx, page } = await frContext(l);
  await frStep(
    "Setup checklist: while a step is unfinished, Settings, Organization, General lists only the unfinished steps",
    "Rows for the unfinished steps only; each row except Review seeded types links to Settings; Review seeded types has Mark as reviewed",
    async () => {
      await page.goto(`${l.app}/settings/general`);
      await page.waitForLoadState("networkidle");
      expect(new URL(page.url()).pathname === "/settings/general", where(page));
      await pwExpect(page.getByText("Setup checklist", { exact: true })).toBeVisible();
      const rows = await outstandingRows(page);
      const labels = rows.map((r) => r.label);
      expect(
        JSON.stringify(labels) ===
          JSON.stringify(["Invite your team", "E-signature", "AI analysis", "Review seeded types"]),
        JSON.stringify(rows),
      );
      const review = rows.find((r) => r.label === "Review seeded types");
      expect(review.href === null && review.markAsReviewed, JSON.stringify(review));
      for (const r of rows.filter((x) => x.label !== "Review seeded types"))
        expect(r.href?.startsWith("/settings/"), `${r.label} ${r.href}`);
      return `With Organization, Business-user portal and Email done, the Setup checklist rows were ${JSON.stringify(rows)}.`;
    },
    page,
  );
  await frStep(
    "Signing out clears the remaining drafts",
    "An unsent invitation draft is gone after sign-out and sign-in; the wizard opens at Welcome",
    async () => {
      await page.goto(`${l.app}/welcome?step=invites`);
      await expectStep(page, "Invite your team", 5);
      await page.getByLabel("Name", { exact: true }).fill("Draft Person DOC-032");
      await sleep(300);
      await page.reload();
      await expectStep(page, "Invite your team", 5);
      const kept = await page.getByLabel("Name", { exact: true }).inputValue();
      await page.goto(`${l.app}/settings/general`);
      await page.getByRole("button", { name: FR_ADMIN.name }).click();
      await page.getByRole("menuitem", { name: "Sign out" }).click();
      await page.waitForURL(/\/auth\/login/, { timeout: 20000 });
      await frSignIn(l, page, readFileSync(frTotpFile(l), "utf8").trim());
      await page.goto(`${l.app}/welcome`);
      await page.waitForLoadState("networkidle");
      const resumed = `${where(page)} (${await stepTitle(page)})`;
      await page.goto(`${l.app}/welcome?step=invites`);
      await expectStep(page, "Invite your team", 5);
      const after = await page.getByLabel("Name", { exact: true }).inputValue();
      expect(kept === "Draft Person DOC-032" && after === "", `${kept} / ${after}`);
      expect(/Welcome to OpenLaw/.test(resumed), resumed);
      await frSave(l, ctx);
      return `The unsent Name "${kept}" survived a reload. After Sign out from the user menu and a new sign-in (password and authenticator code), /welcome opened ${resumed} and Invite your team showed Name "${after}".`;
    },
    page,
  );
  await frStep(
    "Step 7: in Invite your team enter Name and Email, select Legal team member, select Send invite",
    "Name, Email, Legal team member, Administrator, Send invite; the invitation email header shows the organization name and logo",
    async () => {
      const roles = await page.locator("main fieldset button").allInnerTexts();
      await page.getByLabel("Name", { exact: true }).fill("Rowan Lee");
      await page.getByLabel("Email", { exact: true }).fill("rowan.lee@harbor.example");
      await frButton(page, "Legal team member").click();
      await frButton(page, "Send invite").click();
      await pwExpect(page.getByText(/1 invite sent:/)).toBeVisible();
      const facts = await mailHeaderFacts(l, "rowan.lee@harbor.example");
      expect(
        JSON.stringify(roles.map((r) => r.trim())) ===
          JSON.stringify(["Legal team member", "Administrator"]),
        JSON.stringify(roles),
      );
      expect(
        facts.header.name === ORG_NAME && facts.header.cid === "org-logo@openlaw",
        JSON.stringify(facts),
      );
      return `Role choices ${JSON.stringify(roles)}. Send invite showed "1 invite sent:". Mailpit received "${facts.subject}" with header "${facts.header.name}" and the inline image ${facts.header.cid}.`;
    },
    page,
  );
  await frStep(
    "Step 7: invite an Administrator",
    "The invitation is sent with the Administrator role",
    async () => {
      await page.getByLabel("Name", { exact: true }).fill("Sam Ortiz");
      await page.getByLabel("Email", { exact: true }).fill("sam.ortiz@harbor.example");
      await frButton(page, "Administrator").click();
      await frButton(page, "Send invite").click();
      await pwExpect(page.getByText(/2 invites sent:/)).toBeVisible();
      const mail = await waitMailCount(l, "sam.ortiz@harbor.example");
      const sam = (await getJson(page, l, "/api/v1/users")).users.find(
        (u) => u.email === "sam.ortiz@harbor.example",
      );
      expect(sam?.role === "administrator", JSON.stringify(sam));
      return `Send invite showed "2 invites sent:"; Mailpit received ${JSON.stringify(mail.subjects)}; the Users API role for Sam Ortiz is ${sam.role}.`;
    },
    page,
  );
  await frStep(
    "Set up later on Invite your team does not send a typed invitation",
    "E-signature opens (Step 6 of 8); no mail for the unsent address",
    async () => {
      await page.getByLabel("Name", { exact: true }).fill("Unsent Person");
      await page.getByLabel("Email", { exact: true }).fill("unsent.person@harbor.example");
      await frButton(page, "Set up later").click();
      const at = await expectStep(page, "E-signature (DocuSign Integration)", 6);
      await sleep(2000);
      const mail = await mailTo(l, "unsent.person@harbor.example");
      expect(mail.count === 0, "unsent invitation delivered");
      return `${at}. Mailpit had no message for unsent.person@harbor.example.`;
    },
    page,
  );
  await frSave(l, ctx);
  await ctx.close();
}

async function frConnectors() {
  const l = lab;
  const { ctx, page } = await frContext(l);
  const { generateKeyPairSync } = await import("node:crypto");
  // A throwaway RSA key made in memory for the failing connection test; never written.
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({
    type: "pkcs1",
    format: "pem",
  });
  const connector = async () =>
    (await getJson(page, l, "/api/v1/signing-connectors/docusign")).connector;

  await frStep(
    "Step 8: E-signature (DocuSign Integration): Environment, Integration key, User ID, RSA private key; Test DocuSign connection below the credentials; the Signing updates card",
    "The fields; the test button after the credentials and unavailable until key, user ID and private key exist; Update method Polling by default, Webhook adds Public callback URL and Connect HMAC secret",
    async () => {
      await page.goto(`${l.app}/welcome?step=e-signature`);
      const at = await expectStep(page, "E-signature (DocuSign Integration)", 6);
      const envOptions = await page.getByLabel("Environment").locator("option").allInnerTexts();
      const order = await page.evaluate(() => {
        const key =
          document.getElementById("welcome-ds-private-key") ??
          [...document.querySelectorAll("textarea")].pop();
        const test = [...document.querySelectorAll("button")].find(
          (b) => b.textContent.trim() === "Test DocuSign connection",
        );
        return key && test
          ? key.compareDocumentPosition(test) & Node.DOCUMENT_POSITION_FOLLOWING
            ? "below"
            : "above"
          : "not found";
      });
      const test = frButton(page, "Test DocuSign connection");
      const disabledEmpty = await test.isDisabled();
      await page.getByLabel("Integration key").fill("doc032-integration-key");
      await page
        .getByLabel("User ID", { exact: true })
        .fill("5d1b5f3e-0000-4000-8000-000000000032");
      const disabledNoKey = await test.isDisabled();
      const updates = page.getByRole("region", { name: "Signing updates" });
      const mode = await updates.getByLabel("Update method").inputValue();
      const modes = await updates.getByLabel("Update method").locator("option").allInnerTexts();
      await updates.getByLabel("Update method").selectOption({ label: "Webhook" });
      const webhookFields = {
        url: await updates.getByLabel("Public callback URL").count(),
        secret: await updates.getByLabel("Connect HMAC secret (from DocuSign)").count(),
      };
      const text = (await updates.innerText()).replace(/\s+/g, " ");
      expect(
        order === "below" && disabledEmpty && disabledNoKey,
        `${order} ${disabledEmpty} ${disabledNoKey}`,
      );
      expect(
        mode === "polling" && JSON.stringify(modes) === JSON.stringify(["Polling", "Webhook"]),
        `${mode} ${modes}`,
      );
      expect(webhookFields.url === 1 && webhookFields.secret === 1, JSON.stringify(webhookFields));
      expect(
        /Localhost and private addresses cannot receive DocuSign updates/.test(text),
        text.slice(0, 300),
      );
      return `${at}. Environment offered ${JSON.stringify(envOptions)}. Test DocuSign connection is ${order} the RSA private key and was unavailable with no credentials (${disabledEmpty}) and without a private key (${disabledNoKey}). Update method defaulted to ${mode} (${JSON.stringify(modes)}); Webhook added Public callback URL and Connect HMAC secret (from DocuSign). The card said "${text.match(/Use a public HTTPS endpoint[^.]*\.[^.]*\.[^.]*\./)?.[0]}"`;
    },
    page,
  );

  await frStep(
    "Step 8: Test DocuSign connection saves the credentials and checks account access without leaving the step; failures show the connection error; the Signing updates choices stay unsaved",
    "The step stays; an error shows; the connector holds the credentials with Polling; the Webhook draft remains after reload",
    async () => {
      const updates = page.getByRole("region", { name: "Signing updates" });
      await updates
        .getByLabel("Public callback URL")
        .fill("https://signing.harbor.example/api/v1/webhooks/docusign");
      await updates
        .getByLabel("Connect HMAC secret (from DocuSign)")
        .fill(randomBytes(12).toString("hex"));
      await page.getByLabel("RSA private key").fill(rsa);
      await frButton(page, "Test DocuSign connection").click();
      const testing = page.getByText("Testing the connection…");
      await testing.waitFor({ timeout: 15000 }).catch(() => {});
      await testing.waitFor({ state: "detached", timeout: 120000 });
      await sleep(500);
      const alerts = (await page.locator("main").getByRole("alert").allInnerTexts()).map((x) =>
        x.trim(),
      );
      const connected = await page.getByText(/^Connected to .* as .*\.$/).count();
      const failureText = alerts.filter((x) => !/^DocuSign is (connected|configured)/.test(x));
      const outcome = connected
        ? (await page.getByText(/^Connected to .* as .*\.$/).innerText()).trim()
        : failureText.join(" | ");
      expect(!connected && failureText.length > 0, `test outcome ${JSON.stringify(alerts)}`);
      const at = await stepTitle(page);
      const saved = await connector();
      await page.reload();
      await expectStep(page, "E-signature (DocuSign Integration)", 6);
      const draftMode = await page
        .getByRole("region", { name: "Signing updates" })
        .getByLabel("Update method")
        .inputValue();
      const summary = (await page.locator("main").innerText()).match(
        /DocuSign is (connected|configured)[^.]*\./,
      )?.[0];
      expect(at === "E-signature (DocuSign Integration)", at);
      expect(
        saved.configured &&
          saved.integrationKey === "doc032-integration-key" &&
          saved.updateMode === "polling",
        JSON.stringify({ ...saved }),
      );
      expect(draftMode === "webhook", draftMode);
      results.signingTest = { outcome };
      return `Test DocuSign connection kept the step open and showed "${outcome}" (fictional credentials; a successful test needs a real DocuSign account). The connector then held integration key ${saved.integrationKey}, environment ${saved.environment}, configured ${saved.configured}, update method ${saved.updateMode}. After reload the step read "${summary}" and Update method still showed the ${draftMode} draft.`;
    },
    page,
  );

  await frStep(
    "Step 8: signing update choices save on Continue; Polling needs only outbound access",
    "With Webhook and a localhost callback, Continue's outcome is recorded; with Polling, Continue saves Polling and opens AI analysis",
    async () => {
      const updates = page.getByRole("region", { name: "Signing updates" });
      await updates
        .getByLabel("Public callback URL")
        .fill("https://localhost/api/v1/webhooks/docusign");
      await updates
        .getByLabel("Connect HMAC secret (from DocuSign)")
        .fill(randomBytes(12).toString("hex"));
      await frButton(page, "Continue").click();
      await sleep(2500);
      const localTitle = await stepTitle(page);
      const localAlert = (await page.locator("main").getByRole("alert").allInnerTexts()).join(
        " | ",
      );
      const afterLocal = await connector();
      if (localTitle !== "E-signature (DocuSign Integration)") {
        await frButton(page, "Back").click();
        await expectStep(page, "E-signature (DocuSign Integration)", 6);
      }
      await page
        .getByRole("region", { name: "Signing updates" })
        .getByLabel("Update method")
        .selectOption({ label: "Polling" });
      await frButton(page, "Continue").click();
      const at = await expectStep(page, "AI analysis", 7);
      const saved = await connector();
      results.webhookLocalhost = {
        localTitle,
        localAlert,
        updateMode: afterLocal.updateMode,
        webhookUrl: afterLocal.webhookUrl,
      };
      expect(saved.updateMode === "polling", JSON.stringify(saved));
      return `Continue with Webhook and https://localhost/... ${localTitle === "E-signature (DocuSign Integration)" ? `stayed on the step with "${localAlert}"` : `moved to ${localTitle}`}; the connector then read update method ${afterLocal.updateMode}${afterLocal.webhookUrl ? ` and URL ${afterLocal.webhookUrl}` : ""}. Polling and Continue saved update method ${saved.updateMode} and opened ${at}.`;
    },
    page,
  );

  const modelsRequests = async () => {
    const r = await fetch(`http://${OIDC_IP}:8083/count`).catch(() => null);
    return r ? (await r.json()).modelRequests : null;
  };
  await frStep(
    "Step 9 and Resume: in AI analysis connect a provider; the loaded model list stays in this tab on reload; a different endpoint uses its own list",
    "Load models lists the stand-in's models; after reload they are still listed; another Base URL shows no list; the original Base URL shows its list again",
    async () => {
      await page.getByLabel("Provider").selectOption({ label: "Custom endpoint" });
      await page
        .getByLabel("Protocol")
        .selectOption({ label: "OpenAI-compatible chat completions" });
      await page.getByLabel("Base URL").fill("http://oidc:8083/v1");
      await page.getByLabel("API key").fill(`doc032-${randomBytes(6).toString("hex")}`);
      const before = await modelsRequests();
      await frButton(page, "Load models").click();
      await pwExpect(frButton(page, "Refresh models")).toBeVisible({ timeout: 30000 });
      const optionsOf = async () => {
        const combo = page.getByRole("combobox", { name: "Model" });
        await combo.click();
        const opts = (await page.getByRole("listbox").getByRole("option").allInnerTexts()).map(
          (x) => x.trim(),
        );
        await page.keyboard.press("Escape");
        return opts;
      };
      const loaded = await optionsOf();
      await page.reload();
      await expectStep(page, "AI analysis", 7);
      const afterReload = {
        refresh: await frButton(page, "Refresh models").count(),
        options: await optionsOf(),
      };
      await page.getByLabel("Base URL").fill("http://oidc:8083/v2");
      await sleep(300);
      const otherEndpoint = {
        refresh: await frButton(page, "Refresh models").count(),
        load: await frButton(page, "Load models").count(),
      };
      await page.getByLabel("Base URL").fill("http://oidc:8083/v1");
      await sleep(300);
      const back = { refresh: await frButton(page, "Refresh models").count() };
      const after = await modelsRequests();
      expect(
        loaded.some((x) => x.includes("doc032-model-a")),
        JSON.stringify(loaded),
      );
      expect(
        afterReload.refresh === 1 && afterReload.options.some((x) => x.includes("doc032-model-a")),
        JSON.stringify(afterReload),
      );
      expect(
        otherEndpoint.refresh === 0 && otherEndpoint.load === 1 && back.refresh === 1,
        `${JSON.stringify(otherEndpoint)} ${JSON.stringify(back)}`,
      );
      return `Custom endpoint, OpenAI-compatible chat completions, Base URL http://oidc:8083/v1 (a model-list stand-in on the lab network) and an API key; Load models listed ${JSON.stringify(loaded)}. After reload the tab still listed ${JSON.stringify(afterReload.options)} with Refresh models. Base URL .../v2 showed Load models and no list; back on .../v1 the list returned. The stand-in counted ${before} -> ${after} model requests.`;
    },
    page,
  );

  await frStep(
    "Resume: model lists remain available after saving the API key; Refresh models fetches an updated list",
    "Continue saves the connector and opens Review; back on AI analysis the saved connector's list is available and Refresh models adds the stand-in's new model",
    async () => {
      const combo = page.getByRole("combobox", { name: "Model" });
      await combo.click();
      await page
        .getByRole("listbox")
        .getByRole("option", { name: /doc032-model-a/ })
        .first()
        .click();
      await frButton(page, "Continue").click();
      await sleep(1500);
      const next = await stepTitle(page);
      const alerts = (await page.locator("main").getByRole("alert").allInnerTexts()).join(" | ");
      const saved = (await getJson(page, l, "/api/v1/ai-connector")).connector;
      results.aiSave = { next, alerts, configured: saved.configured, model: saved.model };
      expect(next === "Review", `Continue stayed on ${next} with "${alerts}"`);
      await frButton(page, "Back").click();
      await expectStep(page, "AI analysis", 7);
      const summary =
        (await page.locator("main").innerText()).match(/AI features use [^.]*\./)?.[0] ?? null;
      const replace = frButton(page, "Replace credentials");
      if (await replace.count()) await replace.click();
      const listed = await frButton(page, "Refresh models").count();
      const before = await modelsRequests();
      if (listed) await frButton(page, "Refresh models").click();
      await sleep(2000);
      await combo.click();
      const refreshed = (await page.getByRole("listbox").getByRole("option").allInnerTexts()).map(
        (x) => x.trim(),
      );
      await page.keyboard.press("Escape");
      const after = await modelsRequests();
      if (await frButton(page, "Keep current credentials").count())
        await frButton(page, "Keep current credentials").click();
      expect(
        listed === 1 && after > before && refreshed.some((x) => /doc032-model-refreshed/.test(x)),
        `listed ${listed} ${before}->${after} ${JSON.stringify(refreshed)}`,
      );
      return `Continue saved the connector (configured ${saved.configured}, model ${saved.model}) and opened Review. Back on AI analysis the step read "${summary}". After Replace credentials the saved key's model list was still available with Refresh models; Refresh models made the stand-in answer again (${before} -> ${after} requests) and the list became ${JSON.stringify(refreshed)}. Keep current credentials closed the form.`;
    },
    page,
    { independent: true },
  );
  await frSave(l, ctx);
  await ctx.close();
}

async function frReview() {
  const l = lab;
  const { ctx, page } = await frContext(l);
  let reviewRows;
  let fixtureMatter;
  let fieldCountBefore;
  await frStep(
    "Step 10: in Review check the row counts of the seeded lists and the reminder offsets",
    "Rows for each seeded list including separate Matter fields, Contract fields and Entity fields rows; reminder offsets; the recommendation; Start blank and Finish",
    async () => {
      await page.goto(`${l.app}/welcome?step=review`);
      await expectStep(page, "Review", 8);
      reviewRows = await reviewTable(page);
      const lists = reviewRows.map((r) => r.list);
      for (const name of [
        "Matter types",
        "Matter statuses",
        "Matter fields",
        "Contract types",
        "Contract statuses",
        "Contract fields",
        "Entity types",
        "Director & Officer roles",
        "Entity fields",
        "Knowledge types",
        "Request types",
        "Reminder offsets",
      ])
        expect(lists.includes(name), `no ${name} in ${JSON.stringify(lists)}`);
      const hint = (await page.getByText(/We recommend that you start with/).innerText()).trim();
      await pwExpect(frButton(page, "Start blank")).toBeVisible();
      await pwExpect(frButton(page, "Finish")).toBeVisible();
      const onboarding = await getJson(page, l, "/api/v1/onboarding");
      expect(!onboarding.completed && !onboarding.steps.review.done, JSON.stringify(onboarding));
      return `Review rows ${JSON.stringify(reviewRows.map((r) => `${r.list}: ${r.rows}`))}. It said "${hint.slice(0, 120)}..." Start blank and Finish were shown.`;
    },
    page,
  );
  await frStep(
    "Step 10: select a list name; Settings shows Return to setup, which opens Review again",
    "Contract fields and Reminder offsets open Settings with Return to setup back to Review",
    async () => {
      const target = reviewRows.find((r) => r.list === "Contract fields");
      await page.getByRole("link", { name: "Contract fields", exact: true }).click();
      await pwExpect(page).toHaveURL(`${l.app}${target.href}`);
      const link = page.getByRole("link", { name: "Return to setup", exact: true });
      await pwExpect(link).toBeVisible();
      await link.click();
      const at = await expectStep(page, "Review", 8);
      await page.getByRole("link", { name: "Reminder offsets", exact: true }).click();
      await pwExpect(page).toHaveURL(/\/settings\/reminders$/);
      await page.getByRole("link", { name: "Return to setup", exact: true }).click();
      await expectStep(page, "Review", 8);
      return `Contract fields opened ${target.href} with Return to setup, which opened ${at}. Reminder offsets opened /settings/reminders and Return to setup returned to Review.`;
    },
    page,
  );
  await frStep(
    "Fixture: a Matter that uses a seeded Matter type (API, as the Administrator)",
    "One seeded Matter type is in use",
    async () => {
      const types = await getJson(page, l, "/api/v1/matter-types?includeArchived=true");
      fieldCountBefore = (await getJson(page, l, "/api/v1/fields?includeArchived=true")).fields
        .length;
      const candidates = types.matterTypes.filter(
        (t) => t.isSystemDefault && !["other", "default"].includes(t.slug),
      );
      const tried = [];
      for (const seeded of candidates) {
        const res = await api(page, l.app, "POST", "/api/v1/matters", {
          title: "DOC-032 first-run in-use Matter",
          matterTypeId: seeded.id,
        });
        if (res.status === 201) {
          fixtureMatter = { number: res.data.matter.number, type: seeded.displayName };
          break;
        }
        tried.push(`${seeded.displayName}: ${res.status}`);
      }
      expect(fixtureMatter, `no Matter: ${tried.join("; ")}`);
      results.records = [`Matter ${fixtureMatter.number} "DOC-032 first-run in-use Matter"`];
      return `Created Matter ${fixtureMatter.number} "DOC-032 first-run in-use Matter" with the seeded Matter type "${fixtureMatter.type}". ${fieldCountBefore} Fields existed before Start blank.`;
    },
    page,
  );
  await frStep(
    "Start blank: the dialog names each list and the rows it will remove; its Kept: sentence names only Draft, Active and Expired and it does not count Partially signed; a seeded row in use refuses it, naming the list, and nothing is removed",
    "Eight lists with counts; the Kept: sentence as the guide describes it; the refusal names Matter types; counts unchanged",
    async () => {
      await page.goto(`${l.app}/welcome?step=review`);
      await expectStep(page, "Review", 8);
      const before = countsOf(await reviewTable(page));
      await frButton(page, "Start blank").click();
      const dialog = page.getByRole("dialog", { name: "Start blank" });
      await pwExpect(dialog).toBeVisible();
      const items = await dialog
        .locator("ul li")
        .evaluateAll((lis) => lis.map((li) => li.innerText.replace(/\s+/g, " ").trim()));
      const kept = (await dialog.getByText(/^Kept:/).innerText()).trim();
      expect(items.length === 8, JSON.stringify(items));
      const statusesInDialog = Number(
        items.find((x) => x.startsWith("Contract statuses"))?.match(/(\d+) rows?$/)?.[1],
      );
      const statusesTotal = Number(before["Contract statuses"]);
      expect(
        /the Draft, Active, and Expired contract statuses/.test(kept) &&
          !/Partially signed/i.test(kept),
        `Kept sentence: ${kept}`,
      );
      expect(
        statusesInDialog === statusesTotal - 4,
        `dialog ${statusesInDialog} of ${statusesTotal} Contract statuses`,
      );
      await dialog.getByRole("button", { name: "Start blank", exact: true }).click();
      const alert = dialog.getByRole("alert");
      await pwExpect(alert).toBeVisible();
      const reason = (await alert.innerText()).trim();
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      const after = countsOf(await reviewTable(page));
      expect(
        /Matter types/.test(reason) && JSON.stringify(before) === JSON.stringify(after),
        `${reason}`,
      );
      results.startBlankKeptText = kept;
      return `The dialog listed ${JSON.stringify(items)} and said "${kept}": it names Draft, Active and Expired only, and its Contract statuses count (${statusesInDialog} of ${statusesTotal}) leaves four rows, so Partially signed is not counted for removal. Confirm showed "${reason}". Cancel closed it; the counts were unchanged.`;
    },
    page,
  );
  await frStep(
    "Move the record first (fixture: re-type the Matter to Default through the API), then Start blank and confirm",
    `The dialog closes; Review shows "Seeded rows removed. The counts below are current."; onboarding is not complete; the review is recorded`,
    async () => {
      const def = (await getJson(page, l, "/api/v1/matter-types")).matterTypes.find(
        (t) => t.slug === "default",
      );
      const open = (await getJson(page, l, "/api/v1/matter-statuses")).matterStatuses.find(
        (s) => s.slug === "open",
      );
      const moved = await api(page, l.app, "PATCH", `/api/v1/matters/${fixtureMatter.number}`, {
        matterTypeId: def.id,
      });
      expect(moved.status === 200, `re-type ${moved.status}`);
      if (!JSON.stringify(moved.data).includes(open.id))
        await api(page, l.app, "PATCH", `/api/v1/matters/${fixtureMatter.number}`, {
          statusId: open.id,
        });
      await page.goto(`${l.app}/welcome?step=review`);
      await expectStep(page, "Review", 8);
      const before = await reviewTable(page);
      await frButton(page, "Start blank").click();
      const dialog = page.getByRole("dialog", { name: "Start blank" });
      await dialog.getByRole("button", { name: "Start blank", exact: true }).click();
      await pwExpect(dialog).toHaveCount(0);
      await pwExpect(
        page.getByText("Seeded rows removed. The counts below are current."),
      ).toBeVisible();
      const after = await reviewTable(page);
      const onboarding = await getJson(page, l, "/api/v1/onboarding");
      expect(!onboarding.completed && onboarding.steps.review.done, JSON.stringify(onboarding));
      return `Matter ${fixtureMatter.number} moved to the Default type. Confirm closed the dialog and Review showed "Seeded rows removed. The counts below are current." Counts before ${JSON.stringify(before.map((r) => `${r.list}: ${r.rows}`))}; after ${JSON.stringify(after.map((r) => `${r.list}: ${r.rows}`))}. Onboarding completed false, review done true.`;
    },
    page,
  );
  await frStep(
    "Start blank keeps: Other, Default, Open and Closed, Draft, Partially signed, Active and Expired, every Field, the reminder offsets; Review and Approval Stages hold no Status, the Signature Stage holds only Partially signed, the Open Category holds only Open",
    "The kept rows as the guide lists them",
    async () => {
      const q = "?includeArchived=true";
      const slugs = async (p, key) =>
        (await getJson(page, l, `${p}${q}`))[key].map((r) => r.slug).sort();
      const kept = {
        matterTypes: await slugs("/api/v1/matter-types", "matterTypes"),
        contractTypes: await slugs("/api/v1/contract-types", "contractTypes"),
        entityTypes: await slugs("/api/v1/entity-types", "entityTypes"),
        officerRoles: await slugs("/api/v1/officer-roles", "officerRoles"),
        knowledgeTypes: await slugs("/api/v1/knowledge/types", "knowledgeTypes"),
        requestTypes: await slugs("/api/v1/request-types", "requestTypes"),
      };
      const ms = (await getJson(page, l, `/api/v1/matter-statuses${q}`)).matterStatuses;
      const cs = (await getJson(page, l, `/api/v1/contract-statuses${q}`)).contractStatuses;
      const fields = (await getJson(page, l, `/api/v1/fields${q}`)).fields;
      const offsets = (await getJson(page, l, "/api/v1/org/reminder-offsets")).offsets;
      const byStage = {};
      for (const s of cs) (byStage[s.stage] ??= []).push(s.slug);
      const fieldNames = fields.map((f) => f.displayName ?? f.name);
      expect(
        JSON.stringify(kept.matterTypes) === JSON.stringify(["default", "other"]),
        JSON.stringify(kept),
      );
      expect(
        JSON.stringify(kept.contractTypes) === JSON.stringify(["default", "other"]),
        JSON.stringify(kept),
      );
      expect(
        JSON.stringify(kept.entityTypes) === JSON.stringify(["other"]) &&
          JSON.stringify(kept.officerRoles) === JSON.stringify(["other"]),
        JSON.stringify(kept),
      );
      expect(
        kept.knowledgeTypes.length === 0 && kept.requestTypes.length === 0,
        JSON.stringify(kept),
      );
      expect(
        JSON.stringify(ms.map((s) => s.slug).sort()) === JSON.stringify(["closed", "open"]),
        JSON.stringify(ms.map((s) => s.slug)),
      );
      expect(
        JSON.stringify(ms.filter((s) => s.category === "open").map((s) => s.slug)) ===
          JSON.stringify(["open"]),
        "Open Category",
      );
      expect(
        JSON.stringify(cs.map((s) => s.slug).sort()) ===
          JSON.stringify(["active", "draft", "expired", "partially_signed"]),
        JSON.stringify(cs.map((s) => s.slug)),
      );
      expect(
        !byStage.review &&
          !byStage.approval &&
          JSON.stringify(byStage.signature) === JSON.stringify(["partially_signed"]),
        JSON.stringify(byStage),
      );
      expect(
        ["Governing law", "Jurisdiction", "Our position"].every((n) => fieldNames.includes(n)) &&
          fields.length === fieldCountBefore,
        `${fields.length}/${fieldCountBefore}`,
      );
      return `Types kept ${JSON.stringify(kept)}. Matter statuses ${JSON.stringify(ms.map((s) => `${s.slug}/${s.category}`))}. Contract statuses by Stage ${JSON.stringify(byStage)}. ${fields.length} of ${fieldCountBefore} Fields remain, including Governing law, Jurisdiction and Our position. Reminder offsets ${JSON.stringify(offsets)}.`;
    },
    page,
    { independent: true },
  );
  await frStep(
    "Start blank records the review: the Setup checklist has no Review seeded types; the Audit log has one entry per emptied list naming the list and the number removed",
    "No Review seeded types row; eight Start blank entries",
    async () => {
      const p2 = await ctx.newPage();
      await p2.goto(`${l.app}/settings/general`);
      await p2.waitForLoadState("networkidle");
      const rows = await outstandingRows(p2);
      await openSettingsPane(p2, l.app, "Audit log");
      await pwExpect(p2).toHaveURL(/\/settings\/audit-log/);
      await sleep(800);
      const text = await p2.locator("main").innerText();
      const lines = text
        .split("\n")
        .filter((x) => /chose Start blank/.test(x))
        .map((x) => x.trim());
      await p2.close();
      expect(!rows.some((r) => r.label === "Review seeded types"), JSON.stringify(rows));
      expect(lines.length === 8, JSON.stringify(lines));
      for (const list of [
        "matter types",
        "matter statuses",
        "contract types",
        "contract statuses",
        "entity types",
        "officer roles",
        "knowledge types",
        "request types",
      ])
        expect(
          lines.filter((x) => x.includes(`from ${list}`)).length === 1,
          `no single entry for ${list}`,
        );
      return `Setup checklist rows ${JSON.stringify(rows.map((r) => r.label))}. The audit log held ${lines.length} Start blank entries: ${JSON.stringify(lines)}.`;
    },
    page,
    { independent: true },
  );
  await frStep(
    "Start blank is refused when a list holds a row you added; Settings has no control that deletes a row",
    "The refusal names Matter types; counts unchanged; no Delete control",
    async () => {
      await page.goto(`${l.app}/welcome?step=review`);
      await expectStep(page, "Review", 8);
      await page.getByRole("link", { name: "Matter types", exact: true }).click();
      await pwExpect(page).toHaveURL(/\/settings\/matters\/types$/);
      await frButton(page, "Add type").click();
      await page.getByLabel("New type name", { exact: true }).fill("DOC-032 first-run Advisory");
      await frButton(page, "Save").click();
      await pwExpect(page.getByText("DOC-032 first-run Advisory").first()).toBeVisible();
      const labels = await page
        .getByRole("button")
        .evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-label") ?? b.textContent.trim()));
      await page.getByRole("link", { name: "Return to setup", exact: true }).click();
      await expectStep(page, "Review", 8);
      const before = countsOf(await reviewTable(page));
      await frButton(page, "Start blank").click();
      const dialog = page.getByRole("dialog", { name: "Start blank" });
      await dialog.getByRole("button", { name: "Start blank", exact: true }).click();
      const alert = dialog.getByRole("alert");
      await pwExpect(alert).toBeVisible();
      const reason = (await alert.innerText()).trim();
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      const after = countsOf(await reviewTable(page));
      expect(!labels.some((x) => /^Delete/i.test(x ?? "")), JSON.stringify(labels));
      expect(
        /Matter types/.test(reason) && JSON.stringify(before) === JSON.stringify(after),
        reason,
      );
      return `Settings, Matter types added "DOC-032 first-run Advisory" (Add type, New type name, Save); no Delete control. Start blank then showed "${reason}" and the counts stayed ${JSON.stringify(before)}.`;
    },
    page,
    { independent: true },
  );
  await frStep(
    "Start blank is refused when onboarding is already complete (another tab selects Finish); Finish records the review and enters the app",
    "The dialog shows the reason and removes nothing; the other tab's Finish opened Home",
    async () => {
      await page.goto(`${l.app}/welcome?step=review`);
      await expectStep(page, "Review", 8);
      await frButton(page, "Start blank").click();
      const dialog = page.getByRole("dialog", { name: "Start blank" });
      await pwExpect(dialog).toBeVisible();
      const other = await ctx.newPage();
      await other.goto(`${l.app}/welcome?step=review`);
      await expectStep(other, "Review", 8);
      await frButton(other, "Finish").click();
      await pwExpect(other).toHaveURL(`${l.app}/`);
      await other.close();
      const onboarding = await getJson(page, l, "/api/v1/onboarding");
      await dialog.getByRole("button", { name: "Start blank", exact: true }).click();
      const alert = dialog.getByRole("alert");
      await pwExpect(alert).toBeVisible();
      const reason = (await alert.innerText()).trim();
      const types = await getJson(page, l, "/api/v1/matter-types?includeArchived=true");
      expect(onboarding.completed && onboarding.steps.review.done, JSON.stringify(onboarding));
      expect(
        /complete/i.test(reason) &&
          types.matterTypes.some((t) => t.displayName === "DOC-032 first-run Advisory"),
        reason,
      );
      return `Finish in a second tab opened Home; the onboarding API reported completed true and review done true. Confirming Start blank in the first tab showed "${reason}" and the Matter types list was unchanged (${types.matterTypes.length} rows).`;
    },
    page,
  );
  await frSave(l, ctx);
  await ctx.close();
}

async function frAfter() {
  const l = lab;
  const { ctx, page } = await frContext(l);
  await frStep(
    "After Finish the welcome wizard cannot be reopened",
    "/welcome and /welcome?step=review open Home",
    async () => {
      const out = [];
      for (const target of ["/welcome", "/welcome?step=review"]) {
        await page.goto(`${l.app}${target}`);
        await page.waitForLoadState("networkidle");
        const at = new URL(page.url()).pathname;
        expect(at === "/", `${target} ended at ${at}`);
        out.push(`${target} -> ${at}`);
      }
      return out.join("; ");
    },
    page,
  );
  await frStep(
    "Step 2 and Prepare the workspace: the app header shows the saved name and logo; Settings keeps the organization, users, authentication and connectors editable; the checklist lists only unfinished steps",
    "Header name and PNG logo; General shows the saved values; Users lists the invitations; the connector pages open; an app-saved relay is managed under Settings, Advanced, Outbound email",
    async () => {
      await page.goto(`${l.app}/`);
      await page.waitForLoadState("networkidle");
      const brand = await headerBrand(page);
      await page.goto(`${l.app}/settings/general`);
      await pwExpect(page.getByLabel("Organization name")).toHaveValue(ORG_NAME);
      const tz = await page.getByRole("combobox", { name: "Default timezone" }).inputValue();
      const rows = await outstandingRows(page);
      await page.goto(`${l.app}/settings/users`);
      await pwExpect(page.getByText("Rowan Lee")).toBeVisible();
      await pwExpect(page.getByText("Sam Ortiz")).toBeVisible();
      const unsent = await page.getByText("Unsent Person").count();
      const opened = [];
      for (const p of [
        "/settings/authentication",
        "/settings/integrations/e-signature",
        "/settings/ai-analysis",
      ]) {
        await page.goto(`${l.app}${p}`);
        await page.waitForLoadState("networkidle");
        opened.push(`${p} -> ${new URL(page.url()).pathname}`);
      }
      await openSettingsPane(page, l.app, "Outbound email");
      const sender = (
        await page
          .getByText(/^Sender: /)
          .first()
          .innerText()
      ).trim();
      const managed = await page.getByText(/Managed by your deployment configuration/).count();
      const controls = [];
      for (const name of ["Send test email", "Replace relay", "Clear relay"])
        if (await frButton(page, name).count()) controls.push(name);
      expect(brand.text.includes(ORG_NAME) && brand.logo, JSON.stringify(brand));
      expect(
        unsent === 0 &&
          managed === 0 &&
          opened.every((x) => x.split(" -> ")[0] === x.split(" -> ")[1]),
        `${unsent} ${managed} ${opened}`,
      );
      return `Header ${JSON.stringify(brand)}. General showed "${ORG_NAME}" and Default timezone "${tz}". Setup checklist rows after Finish: ${JSON.stringify(rows)}. Users listed Rowan Lee and Sam Ortiz and not the unsent entry. ${opened.join("; ")}. Outbound email showed "${sender}" with ${JSON.stringify(controls)} and no deployment-managed note.`;
    },
    page,
  );
  await ctx.close();
}

async function frEmailRow() {
  const l = lab;
  const { ctx, page } = await frContext(l);
  await frStep(
    "After completion, with the environment setting SMTP_URL but not SMTP_FROM, the Setup checklist shows Email; the Email row opens Settings, Advanced, Outbound email",
    "Email row linking /settings/email, which shows the SMTP_FROM warning",
    async () => {
      await page.goto(`${l.app}/settings/general`);
      await page.waitForLoadState("networkidle");
      const rows = await outstandingRows(page);
      const email = rows.find((r) => r.label === "Email");
      expect(email?.href === "/settings/email", JSON.stringify(rows));
      await page
        .getByRole("list", { name: "Outstanding setup steps" })
        .getByRole("link", { name: "Email", exact: true })
        .click();
      await pwExpect(page).toHaveURL(/\/settings\/email$/);
      const text = (
        await page
          .getByText(/sets SMTP_URL but not SMTP_FROM/)
          .first()
          .innerText()
      ).trim();
      return `Setup checklist rows ${JSON.stringify(rows)}. The Email row opened ${where(page)}, which said "${text}".`;
    },
    page,
  );
  await ctx.close();
}

async function frWalkToReview(l, page) {
  await expectStep(page, "Welcome to OpenLaw", 1);
  await frButton(page, "Get started").click();
  await expectStep(page, "Your organization", 2);
  await frButton(page, "Set up later").click();
  await expectStep(page, "Authentication", 3);
  await frButton(page, "Set up later").click();
  await expectStep(page, "Outbound email", 4);
  const envText = (
    await page.getByText(/Outbound email is set by the deployment environment/).innerText()
  ).trim();
  const noLater = (await frButton(page, "Set up later").count()) === 0;
  const fields = await page.getByLabel("SMTP server").count();
  await pwExpect(frButton(page, "Continue")).toBeEnabled();
  await frButton(page, "Continue").click();
  await expectStep(page, "Invite your team", 5);
  await frButton(page, "Set up later").click();
  await expectStep(page, "E-signature (DocuSign Integration)", 6);
  await frButton(page, "Set up later").click();
  await expectStep(page, "AI analysis", 7);
  await frButton(page, "Set up later").click();
  await expectStep(page, "Review", 8);
  return { envText, noLater, fields };
}
async function frCreateAdmin(l, page) {
  expect(await needsSetup(l), "instance already has users");
  await page.goto(`${l.app}/`);
  await pwExpect(page).toHaveURL(/\/auth\/setup$/);
  await fillSetup(page, {
    token: overlayValue(l.name, "SETUP_TOKEN"),
    password: PASSWORD,
    confirm: PASSWORD,
  });
  await frButton(page, "Create Administrator").click();
  await pwExpect(page).toHaveURL(/\/welcome(\?|$)/);
}

async function frLater() {
  const l = lab;
  const { ctx, page } = await frContext(l, { fresh: true });
  await frStep(
    "Set up later on every step: create the first Administrator with email set by the deployment, then Set up later from Your organization to Review",
    "Each Set up later moves on; Outbound email is read-only with no Set up later and Continue available; Set up later on Review ends onboarding without recording the review",
    async () => {
      await frCreateAdmin(l, page);
      const seen = await frWalkToReview(l, page);
      await frButton(page, "Set up later").click();
      await pwExpect(page).toHaveURL(`${l.app}/`);
      await page.waitForLoadState("networkidle");
      const onboarding = await getJson(page, l, "/api/v1/onboarding");
      await page.goto(`${l.app}/welcome`);
      await page.waitForLoadState("networkidle");
      const reopened = new URL(page.url()).pathname;
      expect(seen.noLater && seen.fields === 0, JSON.stringify(seen));
      expect(
        onboarding.completed && !onboarding.steps.review.done && reopened === "/",
        `${JSON.stringify(onboarding)} ${reopened}`,
      );
      return `Outbound email said "${seen.envText}" with no relay fields, no Set up later, and Continue available. Set up later on Review opened Home; the onboarding API reported completed true and review done false; /welcome then opened ${reopened}.`;
    },
    page,
  );
  await frStep(
    "Setup checklist after skipping: rows Organization, Business-user portal, Invite your team, E-signature, AI analysis and Review seeded types; Business-user portal opens Settings, Advanced, Authentication; Mark as reviewed",
    "Rows as listed with Settings links; Mark as reviewed removes Review seeded types; the portal row opens /settings/authentication",
    async () => {
      await page.goto(`${l.app}/settings/general`);
      await page.waitForLoadState("networkidle");
      const rows = await outstandingRows(page);
      const labels = rows.map((r) => r.label);
      expect(
        JSON.stringify(labels) ===
          JSON.stringify([
            "Organization",
            "Business-user portal",
            "Invite your team",
            "E-signature",
            "AI analysis",
            "Review seeded types",
          ]),
        JSON.stringify(rows),
      );
      for (const r of rows.filter((x) => x.label !== "Review seeded types"))
        expect(r.href?.startsWith("/settings/"), `${r.label} ${r.href}`);
      const list = page.getByRole("list", { name: "Outstanding setup steps" });
      await list
        .locator("li", { hasText: "Review seeded types" })
        .getByRole("button", { name: "Mark as reviewed" })
        .click();
      await pwExpect(list.getByText("Review seeded types")).toHaveCount(0);
      const onboarding = await getJson(page, l, "/api/v1/onboarding");
      await list.getByRole("link", { name: "Business-user portal" }).click();
      await pwExpect(page).toHaveURL(/\/settings\/authentication$/);
      const current = await page
        .getByRole("navigation", { name: "Settings sections" })
        .locator('a[aria-current="page"]')
        .allInnerTexts();
      expect(onboarding.steps.review.done === true, JSON.stringify(onboarding.steps.review));
      return `Rows before: ${JSON.stringify(rows)}. Mark as reviewed removed Review seeded types and the API reported review done true. The Business-user portal row opened ${where(page)} (Settings nav current ${JSON.stringify(current)}, under Advanced).`;
    },
    page,
  );
  await ctx.close();
}

async function frFinish() {
  const l = lab;
  const { ctx, page } = await frContext(l, { fresh: true });
  await frStep(
    "Finish on Review without Start blank records the review and ends onboarding",
    "Home opens; review done true; the checklist has no Review seeded types row",
    async () => {
      await frCreateAdmin(l, page);
      await frWalkToReview(l, page);
      const before = await getJson(page, l, "/api/v1/onboarding");
      await frButton(page, "Finish").click();
      await pwExpect(page).toHaveURL(`${l.app}/`);
      await page.waitForLoadState("networkidle");
      const onboarding = await getJson(page, l, "/api/v1/onboarding");
      await page.goto(`${l.app}/settings/general`);
      await page.waitForLoadState("networkidle");
      const rows = await outstandingRows(page);
      expect(!before.completed && !before.steps.review.done, JSON.stringify(before));
      expect(
        onboarding.completed &&
          onboarding.steps.review.done &&
          !rows.some((r) => r.label === "Review seeded types"),
        `${JSON.stringify(onboarding)} ${JSON.stringify(rows)}`,
      );
      return `Reached Review with completed ${before.completed} and review done ${before.steps.review.done}. Finish opened Home; the API then reported completed ${onboarding.completed} and review done ${onboarding.steps.review.done}. Setup checklist rows ${JSON.stringify(rows.map((r) => r.label))}.`;
    },
    page,
  );
  await ctx.close();
}

async function frSkip() {
  const l = lab;
  const { ctx, page } = await frContext(l, { fresh: true });
  await frStep(
    "Resume or finish later: on the Welcome step, Skip optional steps ends onboarding and enters the app when email is configured; it does not record the review; the wizard cannot be reopened",
    "Home opens; completed true and review done false; /welcome opens Home; the Setup checklist shows Review seeded types with Mark as reviewed and no Email row",
    async () => {
      await frCreateAdmin(l, page);
      await expectStep(page, "Welcome to OpenLaw", 1);
      await frButton(page, "Skip optional steps").click();
      await pwExpect(page).toHaveURL(`${l.app}/`);
      await page.waitForLoadState("networkidle");
      const onboarding = await getJson(page, l, "/api/v1/onboarding");
      await page.goto(`${l.app}/welcome`);
      await page.waitForLoadState("networkidle");
      const reopened = new URL(page.url()).pathname;
      await page.goto(`${l.app}/settings/general`);
      await page.waitForLoadState("networkidle");
      const rows = await outstandingRows(page);
      const review = rows.find((r) => r.label === "Review seeded types");
      expect(
        onboarding.completed && !onboarding.steps.review.done && reopened === "/",
        `${JSON.stringify(onboarding)} ${reopened}`,
      );
      expect(
        review?.markAsReviewed && review.href === null && !rows.some((r) => r.label === "Email"),
        JSON.stringify(rows),
      );
      return `With email set by the deployment, Skip optional steps opened Home. The onboarding API reported completed ${onboarding.completed} and review done ${onboarding.steps.review.done}; /welcome then opened ${reopened}. Setup checklist rows ${JSON.stringify(rows)}.`;
    },
    page,
  );
  await ctx.close();
}

function merge() {
  const dir = path.join(here, "runs");
  const files = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .sort()
    : [];
  // Every attempt is kept. The last attempt of a section is its result; earlier
  // attempts are listed under supersededAttempts with their steps.
  const bySection = {};
  for (const f of files) {
    const r = {
      file: `admin-org-replay/runs/${f}`,
      ...JSON.parse(readFileSync(path.join(dir, f))),
    };
    (bySection[r.section] ??= []).push(r);
  }
  for (const list of Object.values(bySection))
    list.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const order = Object.keys(SECTION_LAB);
  const runs = order.filter((s) => bySection[s]).map((s) => bySection[s].at(-1));
  const superseded = order.flatMap((s) => (bySection[s] ?? []).slice(0, -1));
  const steps = runs.flatMap((r) =>
    r.steps.map((s) => ({ section: r.section, phase: r.phase, ...s })),
  );
  const out = {
    batch: "DOC-032",
    group: "admin-org",
    replayOf: "DOC-032/admin-org/walkthrough.mjs",
    reviewer: "DOC-032 compatibility reviewer (bridge)",
    reviewerKind: "agent",
    appCommit: "ad345da5842c22b7d1012bf9f5d7d12dfdb4e496",
    walkedCommit: "4ca41822b685a2a1e58a38b4f25e421cf735c54e",
    labs: [FR, AW, AO].map((l) => ({
      name: l.name,
      project: l.project,
      appUrl: l.app,
      mailUrl: l.mail,
      appImageId: l.appImageId,
      engineImageId: l.engineImageId,
      createdAt: l.createdAt,
      startedAt: l.startedAt,
      seed: l.seed ?? null,
    })),
    articleHashes: { [F]: articleHash(F), [O]: articleHash(O), [A3]: articleHash(A3) },
    sections: runs.map((r) => ({
      section: r.section,
      lab: r.labName,
      phase: r.phase,
      file: r.file,
      attempts: bySection[r.section].length,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      steps: r.steps.length,
      failed: r.steps.filter((s) => s.result !== "pass").length,
    })),
    counts: Object.fromEntries(
      [F, O, A3].map((a) => {
        const own = steps.filter((s) => s.article === a);
        return [
          a,
          {
            steps: own.length,
            pass: own.filter((s) => s.result === "pass").length,
            fail: own.filter((s) => s.result !== "pass").length,
          },
        ];
      }),
    ),
    replayNotes: [],
    steps,
    supersededAttempts: superseded.map((r) => ({
      section: r.section,
      lab: r.labName,
      phase: r.phase,
      file: r.file,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      steps: r.steps,
    })),
  };
  const log = path.join(here, "..", "admin-org-replay.json");
  if (existsSync(log)) {
    const old = JSON.parse(readFileSync(log));
    out.replayNotes = old.replayNotes ?? [];
  }
  writeFileSync(log, JSON.stringify(out, null, 2) + "\n");
  console.log(`${steps.length} steps -> admin-org-replay.json ${JSON.stringify(out.counts)}`);
}

try {
  const sections = {
    frSetup,
    frOrg,
    frAuth,
    frEmail,
    frInvites,
    frConnectors,
    frReview,
    frAfter,
    frEmailRow,
    frLater,
    frFinish,
    frSkip,
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
    ssoRemove,
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
