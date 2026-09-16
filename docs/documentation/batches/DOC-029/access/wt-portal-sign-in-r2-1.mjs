// V-C02 portal-sign-in: followed from docs/user-guides/portal-sign-in.md as Business Users.
// A new "DOC-029r2 access" Business User exercises first sign-in, onboarding and link reuse; Jonas and Amara
// use separate contexts for record isolation and shared-record pages.
import { BASE, SEED, api, brandingAbove, passwordSignIn, brandingMockRender, mailSince, newContext, sleep, sql, text, waitForLink } from "./lib-r2-1.mjs";

const A = "portal-sign-in";
const ROLE = "business_user";

async function requestPortalLink(page, email) {
  await page.goto(`${BASE}/portal/login`);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await page.getByText("Get a sign-in link").first().waitFor();
  await page.getByLabel("Email").fill(email);
  const since = Date.now();
  await page.getByRole("button", { name: "Send link" }).click();
  await page.getByText("Check your email").first().waitFor({ timeout: 15000 });
  return since;
}

/** Magic-link sign-in with retries: another agent sharing the lab may sign the same seeded person in. */
async function portalSignIn(email) {
  const c = await newContext();
  for (let i = 0; i < 4; i++) {
    const since = await requestPortalLink(c.page, email);
    const m = await waitForLink(email, since, { subjectRe: /Sign in/, linkRe: /magic-link/ });
    if (!m?.link) continue;
    await c.page.goto(m.link);
    const ok = await c.page.waitForURL((u) => u.pathname.startsWith("/portal") && !u.pathname.startsWith("/portal/login"), { timeout: 20000 }).then(() => true, () => false);
    if (ok) return c;
  }
  throw new Error(`portal sign-in failed for ${email}`);
}

export async function run(log, fx) {
  const R = (step, expected, actual, pass) => log.record(A, ROLE, step, expected, actual, pass);
  const stamp = Date.now();

  // ---- New Business User: Get a sign-in link, onboarding, sign out, reuse, fresh link.
  const buEmail = `doc029r2.access.wt.business.${stamp}@helix.example`;
  const buName = `DOC-029r2 access Business User ${stamp % 100000}`;
  fx.accounts.business_user = { email: buEmail, displayName: buName };
  const bu = await newContext();
  await bu.page.goto(`${BASE}/portal`);
  await bu.page.waitForURL(/\/portal\/login|\/auth\/login/, { timeout: 15000 }).catch(() => {});
  const fromPortal = new URL(bu.page.url()).pathname;
  await bu.page.goto(`${BASE}/portal/enter`);
  await bu.page.waitForURL(/\/portal\/login/, { timeout: 15000 });
  const title = await bu.page.getByText("Business Portal sign-in").first().isVisible();
  const brand = await brandingAbove(bu.page, "Business Portal sign-in");
  R(
    "step 1: organization name, and logo if saved, above Business Portal sign-in",
    "The Portal sign-in page shows the organization's name above Business Portal sign-in; a logo only when one is saved",
    `Public branding answer name "${brand.apiName}", logo ${brand.apiLogo}; name shown ${brand.nameShown}; above Business Portal sign-in ${brand.above}; Organization logo images ${brand.logoCount}`,
    brand.apiName.length > 0 && brand.nameShown && brand.above && (brand.apiLogo === "saved" ? brand.logoCount === 1 : brand.logoCount === 0),
  );
  const pwForm = (await bu.page.getByLabel("Password").count()) > 0;
  await bu.page.getByRole("button", { name: "Email me a sign-in link" }).click();
  const getLink = await bu.page.getByText("Get a sign-in link").first().isVisible();
  await bu.page.getByLabel("Email").fill(buEmail);
  let since = Date.now();
  await bu.page.getByRole("button", { name: "Send link" }).click();
  const check = await bu.page.getByText(`If ${buEmail} is eligible, a sign-in link is on its way. It expires in 5 minutes and works once.`).waitFor({ timeout: 15000 }).then(() => true, () => false);
  R(
    "steps 1-5: Business Portal sign-in, Email me a sign-in link, Get a sign-in link, Send link, Check your email",
    "Sign-in page titled Business Portal sign-in shows the password form; Email me a sign-in link opens Get a sign-in link; Send link shows the neutral Check your email",
    `/portal while signed out -> ${fromPortal}; /portal/enter -> /portal/login; title ${title}; password form first ${pwForm}; Get a sign-in link ${getLink}; neutral Check your email with 5-minute text ${check}`,
    title && pwForm && getLink && check,
  );
  const first = await waitForLink(buEmail, since, { subjectRe: /Sign in/, linkRe: /magic-link/ });
  const lifetime = sql(`select round(extract(epoch from (expires_at - created_at))/60) from verifications where value like '%${buEmail}%' order by created_at desc limit 1`);
  await bu.page.goto(first.link);
  await bu.page.waitForURL(/\/portal/, { timeout: 20000 });
  const onboarding = await bu.page.getByText("We need to learn a little about you").first().waitFor({ timeout: 15000 }).then(() => true, () => false);
  const onbUrl = new URL(bu.page.url()).pathname;
  await bu.page.screenshot({ path: new URL("./r2-1-business-user-onboarding.png", import.meta.url).pathname });
  const continueBtn = bu.page.getByRole("button", { name: "Continue" });
  const disabledBeforeDept = await continueBtn.isDisabled();
  const noSkipOnDept = (await bu.page.getByRole("button", { name: "Skip" }).count()) === 0;
  const options = await bu.page.locator("#first-run-department option").allInnerTexts();
  await bu.page.locator("#first-run-department").selectOption({ index: 1 });
  await sleep(800);
  await continueBtn.click();
  await bu.page.getByLabel("Full name").waitFor();
  await bu.page.getByLabel("Full name").fill(buName);
  await bu.page.getByLabel("Full name").blur();
  await sleep(1200);
  const skips = [];
  for (let i = 0; i < 6; i++) {
    const finish = bu.page.getByRole("button", { name: "Finish" });
    if (await finish.isVisible().catch(() => false)) break;
    const heading = await text(bu.page.locator("#first-run-step"));
    await bu.page.getByRole("button", { name: "Skip" }).click();
    skips.push(heading);
    await sleep(600);
  }
  const finishVisible = await bu.page.getByRole("button", { name: "Finish" }).isVisible();
  await bu.page.getByRole("button", { name: "Finish" }).click();
  await bu.page.waitForURL((u) => u.pathname === "/portal" || u.pathname === "/portal/", { timeout: 20000 });
  await sleep(1500);
  const headerIdentity = await text(bu.page.locator("header"));
  const identityOk = headerIdentity.includes(buEmail) && headerIdentity.includes(buName);
  R(
    "step 6 and first visit: link opens the Portal after We need to learn a little about you",
    "Link works within five minutes; first visit shows onboarding; Department required; later steps offer Skip; Finish opens the Portal under that email identity",
    `Link lifetime ${lifetime} min; onboarding at ${onbUrl} ${onboarding}; Continue disabled until Department chosen ${disabledBeforeDept} (${options.length - 1} Departments), no Skip on Department ${noSkipOnDept}; name step then Skip on: ${skips.join(", ")}; Finish shown ${finishVisible}; landed ${new URL(bu.page.url()).pathname}; header shows the new name and email ${identityOk}`,
    onboarding && disabledBeforeDept && noSkipOnDept && finishVisible && identityOk && lifetime === "5",
  );
  fx.created.push(`Business User ${buEmail} (${buName}), created by first Portal sign-in`);

  await bu.page.getByRole("banner").getByRole("button", { name: "Sign out" }).click();
  const signOutLogin = await bu.page.waitForURL(/\/portal\/login/, { timeout: 15000 }).then(() => true, () => false);
  await bu.page.goto(`${BASE}/portal/requests`).catch(() => {});
  await bu.page.goto(`${BASE}/portal`);
  await sleep(1500);
  const stillOut = /login/.test(bu.page.url());
  R("Sign out in the Portal header", "Sign out returns to the Portal sign-in page", `Returned to /portal/login ${signOutLogin}; opening /portal afterwards -> ${new URL(bu.page.url()).pathname}`, signOutLogin && stillOut);

  await bu.page.goto(first.link);
  const expired = await bu.page.getByText("Sign-in link expired").first().waitFor({ timeout: 15000 }).then(() => true, () => false);
  const expiredUrl = new URL(bu.page.url());
  await bu.page.getByLabel("Email").fill(buEmail);
  since = Date.now();
  await bu.page.getByRole("button", { name: "Send link" }).click();
  await bu.page.getByText("Check your email").first().waitFor({ timeout: 15000 });
  const second = await waitForLink(buEmail, since, { subjectRe: /Sign in/, linkRe: /magic-link/ });
  await bu.page.goto(second.link);
  const back = await bu.page.waitForURL((u) => u.pathname === "/portal" || u.pathname === "/portal/", { timeout: 20000 }).then(() => true, () => false);
  const noOnboardingAgain = !(await bu.page.getByText("We need to learn a little about you").isVisible().catch(() => false));
  R(
    "Replace an expired or used link: old email after sign-out, Sign-in link expired, Email, Send link, new link once",
    "A used link opens Sign-in link expired with Email and Send link; the new email link opens the Portal",
    `Reused link -> ${expiredUrl.pathname}${expiredUrl.search} (Sign-in link expired ${expired}); new email subject "${second?.subject}"; new link opened the Portal ${back}; onboarding not repeated ${noOnboardingAgain}`,
    expired && expiredUrl.search.includes("portal=1") && back && noOnboardingAgain,
  );
  await bu.context.close();

  // ---- Address outside the allowed domains.
  {
    const c = await newContext();
    const outsider = `doc029r2.access.wt.${stamp}@outside-domain.example`;
    const s = await requestPortalLink(c.page, outsider);
    await sleep(6000);
    const n = (await mailSince(outsider, s)).length;
    R("address outside the allowed domains", "Neutral Check your email; no link arrives", `Check your email shown; messages to ${outsider.replace(String(stamp), "<stamp>")}: ${n}`, n === 0);
    await c.context.close();
  }

  // ---- Password setup from the Portal sign-in page for a new allowed-domain address (the steps under "When email links are switched off").
  {
    const c = await newContext();
    const pwEmail = `doc029r2.access.wt.business-pw.${stamp}@helix.example`;
    const pw = `Doc029-portal-${stamp}`;
    await c.page.goto(`${BASE}/portal/login`);
    await c.page.getByRole("button", { name: "Set up or reset your password" }).click();
    await c.page.getByLabel("Email").fill(pwEmail);
    const s = Date.now();
    await c.page.getByRole("button", { name: "Send password setup link" }).click();
    const neutral = await c.page.getByText("password setup link is on its way. It expires in one hour.").first().waitFor({ timeout: 10000 }).then(() => true, () => false);
    const m = await waitForLink(pwEmail, s, { subjectRe: /password/i });
    await c.page.goto(m.link);
    await c.page.getByLabel("New password").fill(pw);
    await c.page.getByLabel("Confirm password").fill(pw);
    await c.page.getByRole("button", { name: "Set password" }).click();
    const set = await c.page.getByText("Password set").waitFor({ timeout: 15000 }).then(() => true, () => false);
    await c.page.goto(`${BASE}/portal/login`);
    await c.page.getByLabel("Email").fill(pwEmail);
    await c.page.getByLabel("Password").fill(pw);
    await c.page.getByRole("button", { name: "Sign in", exact: true }).click();
    const inPortal = await c.page.waitForURL((u) => u.pathname.startsWith("/portal") && !u.pathname.startsWith("/portal/login"), { timeout: 20000 }).then(() => true, () => false);
    R(
      "Set up or reset your password, then Email and Password with Sign in",
      "Send password setup link; the one-hour email link sets a password; Email and Password with Sign in open the Portal",
      `Neutral one-hour message ${neutral}; subject "${m?.subject}"; Password set ${set}; password sign-in reached ${new URL(c.page.url()).pathname}`,
      neutral && set && inPortal,
    );
    fx.created.push(`Business User ${pwEmail}, created by Portal password setup (left at onboarding)`);
    await c.context.close();
  }

  // ---- Jonas: own Requests, isolation, staff pages, Contracts, Matters, record pages, conversion redirect.
  const jonasId = sql(`select id from users where email='${SEED.jonas.email}'`);
  const amaraId = sql(`select id from users where email='${SEED.amara.email}'`);
  // Round 2: a converted Request leaves the Requests list (its address redirects to the record), so pick an open one.
  const amaraReq = sql(`select number from requests where requester_id='${amaraId}' and status<>'converted' order by (status='new') desc, number limit 1`);
  const amaraTitle = sql(`select title from requests where number=${amaraReq}`);
  const jonasReq = sql(`select number from requests where requester_id='${jonasId}' and status<>'converted' order by number limit 1`);
  const jonasReqTitle = sql(`select title from requests where number=${jonasReq}`);
  const converted = sql(`select r.number||'|'||c.number from requests r join contracts c on c.id=r.converted_contract_id join contract_team t on t.contract_id=c.id and t.user_id='${jonasId}' where r.requester_id='${jonasId}' and c.archived_at is null order by r.number limit 1`).split("|");
  const archivedC = sql(`select c.number from contract_team t join contracts c on c.id=t.contract_id where t.user_id='${jonasId}' and c.archived_at is not null order by c.number limit 1`);
  const primaryC = sql(`select c.number from contract_team t join contracts c on c.id=t.contract_id where t.user_id='${jonasId}' and c.archived_at is null and c.primary_document_id is not null order by c.number limit 1`);
  const teamMatter = sql(`select m.number from matter_team t join matters m on m.id=t.matter_id where t.user_id='${jonasId}' and m.archived_at is null order by m.number limit 1`);

  // Round 2 fixture: Show more appears only past 25 rows. When Jonas's current-team Contracts do not exceed 25 in the
  // shared lab, the seeded Administrator creates "DOC-029r2 access" Contracts through the API with Jonas on the team.
  {
    const current = Number(sql(`select count(*) from contract_team t join contracts c on c.id=t.contract_id where t.user_id='${jonasId}' and c.archived_at is null`));
    const typeId = sql(`select id from contract_types where display_name='NDA' and archived_at is null limit 1`);
    const need = Math.max(0, 27 - current);
    const made = [];
    if (need) {
      const admin = await passwordSignIn(SEED.daniel.email);
      for (let i = 0; i < need; i++) {
        const c = await api(admin.page, "POST", "/contracts", { title: `DOC-029r2 access Show more fixture ${i + 1} ${stamp % 100000}`, contractTypeId: typeId });
        const n = c.body?.contract?.number;
        const t = n ? await api(admin.page, "POST", `/contracts/${n}/team`, { userId: jonasId }) : { status: 0 };
        made.push(`C-${n}:${c.status}/${t.status}`);
      }
      await admin.context.close();
      fx.created.push(`${need} Contracts named DOC-029r2 access Show more fixture, with Jonas Weber on the team (${made.join(", ")})`);
    }
    R("fixture: more than 25 current-team Contracts for Jonas", "Enough Contracts exist for Show more to appear", `Current-team Contracts before ${current}; created ${need} (${made.join(", ")})`, made.every((m) => /:201\/20\d$/.test(m)));
  }

  const jonas = await portalSignIn(SEED.jonas.email);
  const jp = jonas.page;
  await jp.goto(`${BASE}/portal`);
  await sleep(2000);
  const homeText = await text(jp.locator("main"));
  const ownVisible = homeText.includes(jonasReqTitle.slice(0, 30));
  const header = await text(jp.locator("header"));
  R("Portal lists that person's Requests (Jonas)", "The Portal opens under Jonas's identity and lists his Requests", `Header shows ${SEED.jonas.email} ${header.includes(SEED.jonas.email)}; own Request R-${jonasReq} listed ${ownVisible}`, header.includes(SEED.jonas.email) && ownVisible);

  await jp.goto(`${BASE}/portal/requests/${amaraReq}`);
  await sleep(2000);
  const blocked = new URL(jp.url()).pathname;
  const leaked = (await text(jp.locator("main"))).includes(amaraTitle.slice(0, 30));
  R("another Business User's Request link does not grant access", "Amara's Request number returns Jonas to the Portal without showing it", `/portal/requests/${amaraReq} -> ${blocked}; Amara's Request title shown ${leaked}`, (blocked === "/portal" || blocked === "/portal/") && !leaked);

  const staffPaths = {};
  for (const p of ["/inbox", "/contracts", "/matters"]) {
    await jp.goto(`${BASE}${p}`);
    await sleep(1500);
    staffPaths[p] = new URL(jp.url()).pathname;
  }
  R("Business Users cannot enter the staff Inbox, Contracts, or Matters pages", "Staff pages send the Business User to the Portal", JSON.stringify(staffPaths), Object.values(staffPaths).every((p) => p.startsWith("/portal")));

  // Read your Contracts.
  await jp.goto(`${BASE}/portal`);
  await jp.getByRole("navigation", { name: "Portal" }).getByRole("link", { name: "Contracts" }).click();
  await jp.waitForURL(/\/portal\/contracts/);
  await jp.getByRole("heading", { name: "Your Contracts" }).waitFor({ timeout: 15000 });
  await sleep(1500);
  let listText = await text(jp.locator("main"));
  const archivedShown = archivedC ? new RegExp(`\\bC-${archivedC}\\b`).test(listText) : false;
  const showMore = jp.getByRole("button", { name: "Show more" });
  const hasMore = await showMore.isVisible().catch(() => false);
  const rowsBefore = await jp.locator("main a[href*='/portal/contracts/']").count();
  if (hasMore) {
    await showMore.click();
    await sleep(2000);
  }
  const rowsAfter = await jp.locator("main a[href*='/portal/contracts/']").count();
  listText = await text(jp.locator("main"));
  const archivedShownAfter = archivedC ? new RegExp(`\\bC-${archivedC}\\b`).test(listText) : false;
  R(
    "Contracts in the navigation bar: Your Contracts, current-team rows, Show more",
    "List titled Your Contracts holds non-archived Contracts whose teams include you; Show more loads more",
    `Heading Your Contracts; archived team Contract C-${archivedC} listed ${archivedShown || archivedShownAfter}; Show more shown ${hasMore}; row links ${rowsBefore} -> ${rowsAfter}`,
    !archivedShown && !archivedShownAfter && hasMore && rowsAfter > rowsBefore,
  );

  await jp.goto(`${BASE}/portal/contracts`);
  await jp.getByRole("heading", { name: "Your Contracts" }).waitFor();
  await sleep(1000);
  for (let i = 0; i < 6 && !(await jp.locator(`main a[href$='/portal/contracts/${primaryC}']`).count()); i++) {
    await jp.getByRole("button", { name: "Show more" }).click();
    await sleep(1500);
  }
  await jp.locator(`main a[href$='/portal/contracts/${primaryC}']`).first().click();
  await jp.waitForURL(new RegExp(`/portal/contracts/${primaryC}$`));
  await sleep(2500);
  const cText = await text(jp.locator("main"));
  const labels = ["Counterparty", "Stage", "Business Owner", "Legal Owner", "Value", "Effective date", "Expiry date", "Fields", "Documents"];
  const missingLabels = labels.filter((l) => !cText.includes(l));
  const primaryLabel = await jp.getByText("Primary Document", { exact: true }).first().isVisible().catch(() => false);
  const downloadLink = jp.getByRole("link", { name: /^Download .+, version \d+$/ }).first();
  const downloadName = await downloadLink.getAttribute("aria-label").catch(() => null);
  let downloaded = null;
  if (downloadName) {
    const [dl] = await Promise.all([jp.waitForEvent("download", { timeout: 20000 }).catch(() => null), downloadLink.click()]);
    downloaded = dl ? dl.suggestedFilename().length > 0 : false;
  }
  const docButton = jp.locator("li", { hasText: "Primary Document" }).locator("button.text-link").first();
  const docTitle = await text(docButton);
  await docButton.click();
  await sleep(2500);
  const panel = jp.getByRole("complementary", { name: new RegExp(`^${docTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}, version \\d+$`) });
  const reader = await panel.isVisible().catch(() => false);
  const readerText = reader ? await text(panel) : "";
  if (reader) await panel.getByRole("button", { name: "Close the document" }).click();
  await sleep(500);
  const refShown = cText.includes(`C-${primaryC}`);
  const applets = {};
  for (const n of ["Comments", "History", "Contract team"]) applets[n] = (await jp.getByRole("toolbar", { name: "Applets" }).getByRole("button", { name: new RegExp(`^${n}( \\(\\d+\\))?$`) }).count()) > 0;
  await jp.getByRole("link", { name: "Your Contracts" }).first().click();
  const backToList = await jp.waitForURL(/\/portal\/contracts$/, { timeout: 10000 }).then(() => true, () => false);
  R(
    "open a Contract: reference, fields, Documents with Primary Document, read and download, applets, Your Contracts",
    "Contract page shows its C- reference, Counterparty, Stage, owners, terms, dates and Value; Documents marks the Primary Document; the name opens the reader; the download control downloads; Comments, History and Contract team applets; Your Contracts returns",
    `C-${primaryC} reference ${refShown}; missing labels ${JSON.stringify(missingLabels)}; Primary Document label ${primaryLabel}; reader opened for "${docTitle}" ${reader} (${readerText.slice(0, 80)}); download control "${downloadName}" downloaded ${downloaded}; applets ${JSON.stringify(applets)}; Your Contracts returned to list ${backToList}`,
    refShown && missingLabels.length === 0 && primaryLabel && reader && downloaded && Object.values(applets).every(Boolean) && backToList,
  );

  // Open your Matters.
  await jp.getByRole("navigation", { name: "Portal" }).getByRole("link", { name: "Matters" }).click();
  await jp.waitForURL(/\/portal\/matters/);
  await sleep(1500);
  for (let i = 0; i < 6 && !(await jp.locator(`main a[href$='/portal/matters/${teamMatter}']`).count()); i++) {
    await jp.getByRole("button", { name: "Show more" }).click();
    await sleep(1500);
  }
  await jp.locator(`main a[href$='/portal/matters/${teamMatter}']`).first().click();
  await jp.waitForURL(new RegExp(`/portal/matters/${teamMatter}$`));
  await sleep(2500);
  const mText = await text(jp.locator("main"));
  const mLabels = ["Matter Type", "Status", "Matter Manager", "Business Owner", "Fields", "Documents"];
  const mMissing = mLabels.filter((l) => !mText.includes(l));
  const mApplets = {};
  for (const n of ["Comments", "History", "Matter team"]) mApplets[n] = (await jp.getByRole("toolbar", { name: "Applets" }).getByRole("button", { name: new RegExp(`^${n}( \\(\\d+\\))?$`) }).count()) > 0;
  R(
    "open a Matter: reference, Matter Type, Status, Matter Manager, Business Owner, applets",
    "Matter page shows M- reference, Matter Type, Status, Matter Manager and Business Owner, with Fields, Documents and the Comments, History and Matter team applets",
    `M-${teamMatter} reference ${mText.includes(`M-${teamMatter}`)}; missing labels ${JSON.stringify(mMissing)}; applets ${JSON.stringify(mApplets)}`,
    mText.includes(`M-${teamMatter}`) && mMissing.length === 0 && Object.values(mApplets).every(Boolean),
  );

  // Conversion: the Request address redirects to the record, with Original request.
  await jp.goto(`${BASE}/portal/requests/${converted[0]}`);
  await jp.waitForURL(new RegExp(`/portal/contracts/${converted[1]}`), { timeout: 15000 }).catch(() => {});
  await sleep(2500);
  const convUrl = new URL(jp.url()).pathname;
  const original = (await text(jp.locator("main"))).includes("Original request");
  R("a converted Request address redirects to its record", "R- address opens the new Contract, which shows Original request", `/portal/requests/${converted[0]} -> ${convUrl}; Original request section ${original}`, convUrl === `/portal/contracts/${converted[1]}` && original);
  await jonas.context.close();

  // ---- Amara: separate context sees her own Request, not Jonas's.
  const amara = await portalSignIn(SEED.amara.email);
  await amara.page.goto(`${BASE}/portal`);
  await sleep(2000);
  const aText = await text(amara.page.locator("main"));
  const aHeader = await text(amara.page.locator("header"));
  await amara.page.goto(`${BASE}/portal/requests/${jonasReq}`);
  await sleep(2000);
  const aBlocked = new URL(amara.page.url()).pathname;
  const aLeak = (await text(amara.page.locator("main"))).includes(jonasReqTitle.slice(0, 30));
  R(
    "second Business User context (Amara) sees only her own work",
    "Amara's session opens as Amara; her Request is listed; Jonas's Request link does not open",
    `Header shows ${SEED.amara.email} ${aHeader.includes(SEED.amara.email)}; own R-${amaraReq} listed ${aText.includes(amaraTitle.slice(0, 30))}; Jonas's title on home ${aText.includes(jonasReqTitle.slice(0, 30))}; /portal/requests/${jonasReq} -> ${aBlocked}, title shown ${aLeak}`,
    aHeader.includes(SEED.amara.email) && aText.includes(amaraTitle.slice(0, 30)) && !aText.includes(jonasReqTitle.slice(0, 30)) && aBlocked.replace(/\/$/, "") === "/portal" && !aLeak,
  );
  await amara.context.close();

  // ---- Branches that need an organization-wide policy change: page rendering with a mocked methods answer.
  {
    const methods = (business) => ({ policy: { legal: { password: true, magicLink: true, sso: false, requireTwoFactor: false }, business }, mode: "built_in", magicLinkEnabled: true, requireTwoFactor: false, emailConfigured: true, ssoProviderId: null });
    const view = async (path, business) => {
      const c = await newContext();
      await c.page.route("**/api/v1/auth/methods", (route) => route.fulfill({ json: methods(business) }));
      await c.page.goto(`${BASE}${path}`);
      await sleep(2000);
      const t = await text(c.page.locator("body"));
      const buttons = await c.page.getByRole("button").allInnerTexts();
      const links = await c.page.getByRole("link").allInnerTexts();
      await c.context.close();
      return { t, buttons, links };
    };
    const off = await view("/portal/login", { password: true, magicLink: false, sso: false, requireTwoFactor: false });
    const none = await view("/portal/login", { password: false, magicLink: false, sso: false, requireTwoFactor: false });
    const exp = await view("/auth/link-expired?portal=1", { password: true, magicLink: false, sso: false, requireTwoFactor: false });
    const offOk = !off.buttons.some((b) => /Email me a sign-in link/.test(b)) && off.buttons.some((b) => /Set up or reset your password/.test(b)) && /Password/.test(off.t);
    const noneOk = /Sign-in is unavailable\. Contact your administrator\./.test(none.t);
    const expOk = [...exp.links, ...exp.buttons].some((b) => /Back to sign-in/.test(b)) && !/Send link/.test(exp.buttons.join("|"));
    R(
      "supplementary (mocked methods answer): email links switched off",
      "No Email me a sign-in link; Email, Password and Set up or reset your password; no method shows Sign-in is unavailable. Contact your administrator.; the expired-link page offers only Back to sign-in",
      `Links off: no Email me a sign-in link and password setup shown ${offOk}; no method message ${noneOk}; expired-link page Back to sign-in only ${expOk}. Browser-side rendering only; the server policy was not changed.`,
      offOk && noneOk && expOk,
    );
  }
  {
    const m = await brandingMockRender("/portal/login", "Business Portal sign-in");
    R(
      "supplementary (mocked branding answer): Portal logo above Business Portal sign-in, failed logo hidden, no saved name",
      "A saved logo shows above Business Portal sign-in with the name; a logo that fails to load is hidden; with no saved name the page shows OpenLaw",
      `${JSON.stringify(m)}. Browser-side rendering only; the organization settings were not changed.`,
      m.savedLogoShownAbove && m.brokenLogoHidden && m.noNameShowsOpenLaw,
    );
  }
}
