// V-C05 personal-settings: followed from docs/user-guides/personal-settings.md for Administrator and Legal Team Member.
// The "DOC-029 access" fresh accounts change their own preferences; the other fresh account is the unchanged control.
// Jonas (Business User) checks that the View Business Portal control is absent.
import { deflateSync } from "node:zlib";
import {
  BASE,
  SEED,
  api,
  ensureStaffAccounts,
  newContext,
  passwordSignIn,
  sleep,
  sql,
  text,
  waitForLink,
} from "./lib-r1.mjs";

const A = "personal-settings";

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
/** A PNG of w x h pixels; noise=true makes it large and hard to compress. */
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
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * (w * 3 + 1) + 1 + x * 3;
      if (noise) {
        for (let k = 0; k < 3; k++) {
          seed = (seed * 1103515245 + 12345) & 0x7fffffff;
          raw[i + k] = seed & 0xff;
        }
      } else {
        raw[i] = 40;
        raw[i + 1] = 110;
        raw[i + 2] = 160;
      }
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 0 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function signInAs(email, password) {
  const c = await newContext();
  await c.page.goto(`${BASE}/auth/login`);
  await c.page.getByLabel("Email").fill(email);
  await c.page.getByLabel("Password").fill(password);
  await c.page.getByRole("button", { name: "Sign in", exact: true }).click();
  await c.page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 30000 });
  return c;
}

const saved = (scope) =>
  scope
    .getByText("Saved", { exact: true })
    .first()
    .waitFor({ timeout: 10000 })
    .then(
      () => true,
      () => false,
    );

export async function run(log, fx) {
  const admin = await passwordSignIn(SEED.daniel.email);
  await ensureStaffAccounts(fx, admin.page);
  const stamp = Date.now();
  const prefs = (id) =>
    sql(
      `select display_name||'|'||coalesce(timezone,'')||'|'||theme||'|'||(image is not null) from users where id='${id}'`,
    );

  for (const role of ["administrator", "legal_team_member"]) {
    const R = (step, expected, actual, pass) => log.record(A, role, step, expected, actual, pass);
    const acct = fx.accounts[role];
    const otherRole = role === "administrator" ? "legal_team_member" : "administrator";
    const otherBefore = prefs(fx.accounts[otherRole].userId);
    const c = await signInAs(acct.email, acct.password);
    const p = c.page;
    const device2 = await signInAs(acct.email, acct.password);

    // Update your profile.
    await p.getByRole("button", { name: acct.displayName, exact: true }).click();
    await p.getByRole("menuitem", { name: "Settings" }).click();
    await p.waitForURL(/\/settings/);
    await p.getByRole("link", { name: "Profile", exact: true }).click();
    await p.waitForURL(/\/settings\/profile/);
    const personalGroup = (await text(p.locator("body"))).includes("Personal");
    const edited = `${acct.displayName} edited`;
    await p.getByLabel("Full name").fill(edited);
    await p.getByLabel("Full name").blur();
    const nameSaved = await saved(p);
    const tz = p.getByRole("combobox", { name: "Timezone" });
    await tz.click();
    await tz.fill("Tokyo");
    await p.getByRole("option", { name: /Tokyo/ }).first().click();
    const tzSaved = await saved(p);
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
    const tzCleared = await saved(p);
    await sleep(1000);
    const dbTz = sql(`select coalesce(timezone,'null') from users where id='${acct.userId}'`);
    const emailInput = p.getByLabel("Email");
    const emailReadOnly =
      (await emailInput.count()) === 0 ||
      (await emailInput.isDisabled().catch(() => false)) ||
      (await emailInput.getAttribute("readonly").catch(() => null)) !== null;
    const bodyText = await text(p.locator("main"));
    const emailValue = (await emailInput.count())
      ? await emailInput.inputValue().catch(() => "")
      : "";
    const roleNote =
      bodyText.includes("Roles are managed in Organization → Users.") &&
      (emailValue === acct.email || bodyText.includes(acct.email));
    R(
      "Update your profile, steps 1-5, with Email and Role read-only",
      "Settings from the name menu; Profile under Personal; Full name saves on leaving the field; Timezone search and select saves; reload keeps both; Use browser timezone removes the preference; Email and Role are read-only",
      `Personal group ${personalGroup}; name Saved ${nameSaved}, after reload "${nameAfter}", header menu updated ${headerName}; timezone Saved ${tzSaved}, after reload "${tzAfter}"; Use browser timezone Saved ${tzCleared}, stored ${dbTz}; Email shown and not editable ${emailReadOnly}; Role note ${roleNote}`,
      personalGroup &&
        nameSaved &&
        nameAfter === edited &&
        headerName &&
        tzSaved &&
        /Tokyo/.test(tzAfter) &&
        tzCleared &&
        dbTz === "null" &&
        emailReadOnly &&
        roleNote,
    );

    // Profile photo.
    const fileInput = p.getByLabel("Upload a profile photo");
    const small = png(64, 64);
    const [chooser] = await Promise.all([
      p.waitForEvent("filechooser"),
      p.getByRole("button", { name: "Upload", exact: true }).click(),
    ]);
    await chooser.setFiles({
      name: "doc029-access-avatar.png",
      mimeType: "image/png",
      buffer: small,
    });
    const photoSaved = await saved(p);
    await sleep(1000);
    const imageStored =
      sql(`select image is not null from users where id='${acct.userId}'`) === "t";
    const big = png(700, 700, true);
    await fileInput.setInputFiles({
      name: "doc029-access-too-large.png",
      mimeType: "image/png",
      buffer: big,
    });
    const bigError = await p
      .getByText("The change could not be saved. Try again.")
      .first()
      .waitFor({ timeout: 8000 })
      .then(
        () => true,
        () => false,
      );
    R(
      "Profile photo: Upload a PNG within 1 MB; a larger file fails",
      "A JPG or PNG no larger than 1 MB saves; a failed update is reported",
      `64 px PNG (${small.length} bytes) Saved ${photoSaved}, stored ${imageStored}; ${big.length}-byte PNG shows The change could not be saved. Try again. ${bigError}`,
      photoSaved && imageStored && big.length > 1048576 && bigError,
    );

    // Choose a theme.
    await p.getByRole("link", { name: "Appearance", exact: true }).click();
    await p.waitForURL(/\/settings\/appearance/);
    const themes = {};
    for (const label of ["Warm", "Dark", "Light"]) {
      await p.getByRole("radio", { name: label }).check();
      const ok = await saved(p);
      await sleep(800);
      themes[label] = `${ok}/${sql(`select theme from users where id='${acct.userId}'`)}`;
    }
    await p.getByRole("radio", { name: "Dark" }).check();
    await saved(p);
    await sleep(800);
    await p.reload();
    await p.getByRole("radio", { name: "Dark" }).waitFor();
    const darkKept = await p.getByRole("radio", { name: "Dark" }).isChecked();
    const htmlTheme = await p.evaluate(
      () =>
        document.documentElement.getAttribute("data-theme") || document.documentElement.className,
    );
    const stillSignedIn = /\/settings\/appearance/.test(p.url());
    await p.getByRole("radio", { name: "Light" }).check();
    await saved(p);
    const otherAfter = prefs(fx.accounts[otherRole].userId);
    R(
      "Choose a theme, steps 1-3; another account unchanged",
      "Light, Warm and Dark each save for this account; reload keeps the choice; changing theme does not sign out; the other account's preferences stay the same",
      `Saved/stored: ${JSON.stringify(themes)}; Dark kept after reload ${darkKept} (document theme "${htmlTheme}"); still signed in ${stillSignedIn}; other ${otherRole} account name|timezone|theme|photo before "${otherBefore.split("|").slice(1).join("|")}", after "${otherAfter.split("|").slice(1).join("|")}", equal ${otherBefore === otherAfter}`,
      themes.Warm === "true/warm" &&
        themes.Dark === "true/dark" &&
        themes.Light === "true/light" &&
        darkKept &&
        stillSignedIn &&
        otherBefore === otherAfter,
    );

    // Open your own Portal view.
    await p.getByRole("link", { name: "View Business Portal", exact: true }).click();
    await p.waitForURL(/\/settings\/app-view/);
    await p
      .getByRole("link", { name: "View as business user" })
      .or(p.getByRole("button", { name: "View as business user" }))
      .first()
      .click();
    await p.waitForURL(/\/portal/, { timeout: 15000 });
    await sleep(2500);
    const banner = await p
      .getByText("Viewing as business user")
      .first()
      .isVisible()
      .catch(() => false);
    const bannerText = await p
      .getByText("You’re viewing your Portal work. Submissions, edits, and replies are real.")
      .isVisible()
      .catch(() => false);
    const portalHeader = await text(p.locator("header"));
    if (role === "administrator")
      await p.screenshot({
        path: new URL("./r1-administrator-portal-view-banner.png", import.meta.url).pathname,
      });
    const ownIdentity = portalHeader.includes(acct.email);
    const roleUnchanged = sql(`select role from users where id='${acct.userId}'`) === role;
    await p.getByRole("link", { name: "Return to legal view" }).click();
    const returned = await p.waitForURL(/\/settings\/app-view/, { timeout: 15000 }).then(
      () => true,
      () => false,
    );
    R(
      "Open your own Portal view, steps 1-4",
      "View Business Portal under Personal; View as business user opens the Portal with the Viewing as business user banner; it is your own identity and role; Return to legal view returns to View Business Portal",
      `Portal URL reached; banner ${banner}; banner text ${bannerText}; Portal header shows own email ${ownIdentity}; role unchanged ${roleUnchanged}; Return to legal view -> ${new URL(p.url()).pathname} ${returned}`,
      banner && bannerText && ownIdentity && roleUnchanged && returned,
    );

    // Change your password.
    await p.getByRole("link", { name: "Profile", exact: true }).click();
    await p.waitForURL(/\/settings\/profile/);
    const card = await p
      .getByText("Password & two-factor")
      .waitFor({ timeout: 15000 })
      .then(
        () => true,
        () => false,
      );
    const newPw = `Doc029-${role === "administrator" ? "admin" : "member"}-changed-${stamp}`;
    const openDialog = async () => {
      await p.getByRole("button", { name: "Change password" }).click();
      return p.getByRole("dialog");
    };
    let d = await openDialog();
    await d.getByLabel("Current password").fill(`${acct.password}-wrong`);
    await d.getByLabel("New password").fill(newPw);
    await d.getByRole("button", { name: "Save" }).click();
    const wrongMsg = await d
      .getByText(
        "The password could not be changed. Check your current password and use at least 8 characters.",
      )
      .waitFor({ timeout: 10000 })
      .then(
        () => true,
        () => false,
      );
    await d.getByLabel("Current password").fill(acct.password);
    await d.getByLabel("New password").fill("short1");
    await d.getByRole("button", { name: "Save" }).click();
    await sleep(2000);
    const shortMsg = await d
      .getByText(
        "The password could not be changed. Check your current password and use at least 8 characters.",
      )
      .isVisible()
      .catch(() => false);
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
    const oldRefused = await (async () => {
      const t = await newContext();
      await t.page.goto(`${BASE}/auth/login`);
      await t.page.getByLabel("Email").fill(acct.email);
      await t.page.getByLabel("Password").fill(acct.password);
      await t.page.getByRole("button", { name: "Sign in", exact: true }).click();
      const r = await t.page
        .getByText("Check your email and password.")
        .waitFor({ timeout: 10000 })
        .then(
          () => true,
          () => false,
        );
      await t.context.close();
      return r;
    })();
    acct.password = newPw;
    R(
      "Change your password, steps 1-3",
      "Password & two-factor shows Change password; a wrong current password or a short new password is refused; Save changes the password, keeps this session, and signs out other devices",
      `Card shown ${card}; wrong current password message ${wrongMsg}; 6-character new password refused ${shortMsg}; dialog closed after Save ${closed}; this session open after reload ${thisOpen}; other device sent to sign-in ${otherOut}; old password refused ${oldRefused}`,
      card && wrongMsg && shortMsg && closed && thisOpen && otherOut && oldRefused,
    );

    // End sessions.
    const device3 = await signInAs(acct.email, acct.password);
    await p.getByRole("button", { name: "Sign out other devices" }).click();
    const sessSaved = await saved(p);
    await sleep(1000);
    await device3.page.reload();
    const d3Out = await device3.page.waitForURL(/\/auth\/login/, { timeout: 15000 }).then(
      () => true,
      () => false,
    );
    await device3.context.close();
    await p.reload();
    const stillIn = /\/settings\/profile/.test(p.url());
    // Restore the name, then sign out through the name menu.
    await p.getByLabel("Full name").fill(acct.displayName);
    await p.getByLabel("Full name").press("Enter");
    const restored = await saved(p);
    await sleep(1000);
    await p.reload();
    await p.getByRole("button", { name: acct.displayName, exact: true }).click();
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
      "Sign out other devices saves and ends every other session; this one stays; Sign out ends the current session",
      `Saved ${sessSaved}; other device sent to sign-in ${d3Out}; this session still open ${stillIn}; name restored with Enter ${restored}; Sign out -> sign-in page ${outOk}; protected page afterwards requires sign-in ${staysOut}`,
      sessSaved && d3Out && stillIn && restored && outOk && staysOut,
    );
    await c.context.close();
  }

  // Password section absent for an account without a password (invited staff account signed in by an email link).
  {
    const email = `doc029.access.nopassword.${stamp}@helix.example`;
    const displayName = `DOC-029 access No Password Member ${stamp % 100000}`;
    const inv = await api(admin.page, "POST", "/auth/invites", {
      email,
      displayName,
      role: "legal_team_member",
    });
    fx.created.push(`legal_team_member account ${email} without a password`);
    const c = await newContext();
    await c.page.goto(`${BASE}/auth/login`);
    await c.page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await c.page.getByLabel("Email").fill(email);
    const since = Date.now();
    await c.page.getByRole("button", { name: "Send link" }).click();
    const m = await waitForLink(email, since, { subjectRe: /Sign in/, linkRe: /magic-link/ });
    await c.page.goto(m.link);
    const inApp = await c.page
      .waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 20000 })
      .then(
        () => true,
        () => false,
      );
    await c.page.goto(`${BASE}/settings/profile`);
    await c.page.getByText("Sessions").first().waitFor({ timeout: 15000 });
    const absent = (await c.page.getByText("Password & two-factor").count()) === 0;
    log.record(
      A,
      "legal_team_member",
      "Password & two-factor is absent for an account without a password",
      "Profile shows Password & two-factor only when the account has a password",
      `Invite ${inv.status}; email-link sign-in reached the app ${inApp}; Profile without a Password & two-factor card ${absent}`,
      inv.status === 201 && inApp && absent,
    );
    await c.context.close();
  }

  // Business Users do not have the View Business Portal control.
  {
    const c = await newContext();
    let ok = false;
    for (let i = 0; i < 4 && !ok; i++) {
      await c.page.goto(`${BASE}/portal/login`);
      await c.page.getByRole("button", { name: "Email me a sign-in link" }).click();
      await c.page.getByLabel("Email").fill(SEED.jonas.email);
      const since = Date.now();
      await c.page.getByRole("button", { name: "Send link" }).click();
      const m = await waitForLink(SEED.jonas.email, since, {
        subjectRe: /Sign in/,
        linkRe: /magic-link/,
      });
      if (!m?.link) continue;
      await c.page.goto(m.link);
      ok = await c.page
        .waitForURL(
          (u) => u.pathname.startsWith("/portal") && !u.pathname.startsWith("/portal/login"),
          { timeout: 20000 },
        )
        .then(
          () => true,
          () => false,
        );
    }
    const res = {};
    for (const path of ["/settings/app-view", "/settings/profile"]) {
      await c.page.goto(`${BASE}${path}`);
      await sleep(2000);
      res[path] = new URL(c.page.url()).pathname;
    }
    const noControl =
      (await c.page.getByText("View as business user").count()) === 0 &&
      (await c.page.getByText("Viewing as business user").count()) === 0;
    log.record(
      A,
      "business_user",
      "Business Users do not have the View Business Portal control",
      "A Business User cannot open the staff Settings view control",
      `Signed in ${ok}; ${JSON.stringify(res)}; View as business user control or banner shown ${!noControl}`,
      ok && Object.values(res).every((x) => x.startsWith("/portal")) && noControl,
    );
    await c.context.close();
  }
  await admin.context.close();
}
